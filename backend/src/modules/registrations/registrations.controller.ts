import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { IfMatch, setEtag } from "../../common/http/concurrency";
import { ApiErrors } from "../../common/http/swagger";
import {
  CertificateUrlDto,
  CreateRegistrationDto,
  ImportStatusDto,
  RegistrationDetailDto,
  RegistrationDto,
  RegistrationListQueryDto,
  RegistrationPageDto,
  StartImportDto,
  VoidRegistrationDto,
} from "./dto";
import { IMPORT_TEMPLATE_HEADERS, RegistrationImportService } from "./registration-import.service";
import { RegistrationsService } from "./registrations.service";

@ApiTags("registrations")
@ApiBearerAuth("jwt")
@Controller()
export class RegistrationsController {
  constructor(
    private readonly registrations: RegistrationsService,
    private readonly imports: RegistrationImportService,
  ) {}

  @Get("registrations")
  @ApiOperation({
    summary: "List registrations",
    description: "Scoped: own (technician), own org (distributor), all (staff).",
  })
  @ApiOkResponse({ type: RegistrationPageDto })
  @ApiErrors()
  list(@Ctx() ctx: RequestContext, @Query() query: RegistrationListQueryDto) {
    return this.registrations.list(ctx.user, query);
  }

  @Post("registrations")
  @Roles("technician", "distributor", "claims_agent", "admin")
  @ApiOperation({
    summary: "Register a product",
    description: "Supports Idempotency-Key. A duplicate active serial returns 409 with `details.ownedByYou`.",
  })
  @ApiCreatedResponse({ type: RegistrationDto })
  @ApiErrors({
    409: [ErrorCode.REGISTRATION_DUPLICATE_SERIAL],
    422: [
      ErrorCode.PRODUCT_NOT_FOUND,
      ErrorCode.SERIAL_FORMAT_INVALID,
      ErrorCode.PURCHASE_IN_FUTURE,
      ErrorCode.PURCHASE_BEFORE_LAUNCH,
      ErrorCode.PROOF_OF_PURCHASE_REQUIRED,
      ErrorCode.CUSTOMER_REQUIRED,
      ErrorCode.ATTACHMENT_NOT_CLEAN,
      ErrorCode.POLICY_NOT_FOUND,
    ],
  })
  create(@Ctx() ctx: RequestContext, @Body() body: CreateRegistrationDto) {
    return this.registrations.create(ctx, body);
  }

  @Get("registrations/import-template")
  @Roles("distributor", "admin")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="registration-import-template.csv"')
  @ApiOperation({ summary: "Bulk import CSV template" })
  @ApiProduces("text/csv")
  @ApiErrors()
  template(): string {
    return `${IMPORT_TEMPLATE_HEADERS.join(",")}\nSC680-100500,SC680,2026-03-01,Jordan Lee,Northside Heating & Air,jordan@example.com,555-0100,12 Main St,,Fresno,CA,93650,US\n`;
  }

  @Post("registrations/imports")
  @Roles("distributor", "admin")
  @Throttle({ writes: { limit: 5, ttl: 3_600_000 } }) // Section 11.4 (per user; per-org is a TODO)
  @ApiOperation({
    summary: "Start a bulk import",
    description: "Async. Poll GET /imports/{jobId}. Max 10,000 rows.",
  })
  @ApiCreatedResponse({ type: ImportStatusDto })
  @ApiErrors({ 422: [ErrorCode.ATTACHMENT_INVALID, ErrorCode.ATTACHMENT_NOT_CLEAN] })
  startImport(@Ctx() ctx: RequestContext, @Body() body: StartImportDto) {
    return this.imports.start(ctx, body.attachmentId);
  }

  @Get("imports/:jobId")
  @Roles("distributor", "admin")
  @ApiOperation({ summary: "Import job status", description: "Progress plus a link to the error report." })
  @ApiOkResponse({ type: ImportStatusDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  importStatus(@Ctx() ctx: RequestContext, @Param("jobId", ParseUUIDPipe) jobId: string) {
    return this.imports.status(ctx.user, jobId);
  }

  @Get("registrations/:id")
  @ApiOperation({ summary: "Get a registration", description: "Returns an ETag for If-Match." })
  @ApiOkResponse({ type: RegistrationDetailDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  async get(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const registration = await this.registrations.get(ctx.user, id);
    setEtag(reply, registration.version);
    return registration;
  }

  @Post("registrations/:id/void")
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Void a registration", description: "Requires If-Match. Audited and alerted." })
  @ApiOkResponse({ type: RegistrationDto })
  @ApiErrors({
    404: [ErrorCode.NOT_FOUND],
    409: [ErrorCode.STALE_VERSION, ErrorCode.CONFLICT],
    428: [ErrorCode.PRECONDITION_REQUIRED],
  })
  async void(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: VoidRegistrationDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const registration = await this.registrations.void(ctx, id, version, body.reason);
    setEtag(reply, registration.version);
    return registration;
  }

  @Get("registrations/:id/certificate")
  @ApiOperation({ summary: "Warranty certificate", description: "Signed URL to the PDF (5-minute expiry)." })
  @ApiOkResponse({ type: CertificateUrlDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 409: [ErrorCode.CERTIFICATE_NOT_READY] })
  certificate(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.registrations.certificateUrl(ctx.user, id);
  }
}
