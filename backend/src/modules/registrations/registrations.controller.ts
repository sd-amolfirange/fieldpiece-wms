import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  REGISTRATION_CHANNELS,
  REGISTRATION_FLAGS,
  REGISTRATION_STATUSES,
  type BulkImportView,
  type Paginated,
  type RegistrationView,
} from "@wms/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { CookieAuth, Ctx, Roles } from "../../common/auth/decorators";
import { contentDisposition } from "../../common/http/file-response";
import type { RawQuery } from "../../common/http/list-query";
import { readMultipart } from "../../common/http/multipart";
import { BulkImportsService } from "./bulk-imports.service";
import { RegistrationsService } from "./registrations.service";
import { templateCsv, templateXlsx } from "./sheets";

const ALL = ["admin", "dealer", "distributor", "customer"] as const;
const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;

@ApiTags("registrations")
@Controller("registrations")
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  @Roles(...ALL)
  @ApiOperation({
    summary: "Registration inbox (A02) / the customer's own (CU02)",
    description: "`q` matches serial, customer, model code and dealer. Newest first by default.",
  })
  @ApiQuery({ name: "status", required: false, enum: REGISTRATION_STATUSES })
  @ApiQuery({ name: "channel", required: false, enum: REGISTRATION_CHANNELS })
  @ApiQuery({ name: "flag", required: false, enum: REGISTRATION_FLAGS })
  @ApiOkResponse({ description: "Paginated<RegistrationView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<RegistrationView>> {
    return this.registrations.list(ctx, query);
  }

  @Post()
  @HttpCode(200)
  @Roles(...ALL)
  @ApiOperation({
    summary: "Register a unit (CU01, DL03)",
    description:
      "Customer: always PENDING (needs purchaseDate and an invoice). Dealer, distributor, admin: approved at once " +
      "unless the serial is already registered; other problems answer 422 with `rowErrors.<code>` field errors.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        serial: { type: "string" },
        modelCode: { type: "string" },
        installDate: { type: "string", format: "date" },
        purchaseDate: { type: "string", format: "date" },
        customerName: { type: "string" },
        customerPhone: { type: "string" },
        customerEmail: { type: "string" },
        city: { type: "string" },
        invoiceNumber: { type: "string" },
        location: { type: "string" },
        dealerId: { type: "string" },
        attachmentIds: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiOkResponse({ description: "RegistrationView" })
  create(@Ctx() ctx: RequestCtx, @Body() payload: unknown): Promise<RegistrationView> {
    return this.registrations.create(ctx, payload);
  }

  @Post("bulk-approve")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Approve several pending registrations", description: "Skips duplicates, decided rows and unknown models." })
  @ApiBody({ schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } } })
  @ApiOkResponse({ description: "`{ approved, skipped }`" })
  bulkApprove(@Ctx() ctx: RequestCtx, @Body() payload: unknown) {
    return this.registrations.bulkApprove(ctx, body(payload).ids);
  }

  @Get(":id")
  @Roles(...ALL)
  @ApiOperation({ summary: "Registration (A03)", description: "Includes `duplicateOf` (admins) when the serial is registered." })
  @ApiOkResponse({ description: "RegistrationView" })
  get(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<RegistrationView> {
    return this.registrations.get(ctx, id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Approve", description: "`409 duplicate_serial`, `409 not_pending`, `409 unknown_model`." })
  @ApiOkResponse({ description: "RegistrationView" })
  approve(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<RegistrationView> {
    return this.registrations.approveOne(ctx, id);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Reject with a reason", description: "`422` validation.reasonRequired." })
  @ApiBody({ schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } })
  @ApiOkResponse({ description: "RegistrationView" })
  reject(@Ctx() ctx: RequestCtx, @Param("id") id: string, @Body() payload: unknown): Promise<RegistrationView> {
    return this.registrations.reject(ctx, id, body(payload).reason);
  }

  @Post(":id/merge")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Merge a duplicate into the existing unit", description: "`409 nothing_to_merge`." })
  @ApiOkResponse({ description: "RegistrationView" })
  merge(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<RegistrationView> {
    return this.registrations.merge(ctx, id);
  }
}

@ApiTags("bulk-imports")
@Controller("bulk-imports")
export class BulkImportsController {
  constructor(private readonly bulk: BulkImportsService) {}

  @Get("template.csv")
  @Roles(...ALL)
  @CookieAuth()
  @ApiOperation({ summary: "CSV template" })
  async templateCsv(@Res() reply: FastifyReply): Promise<void> {
    await reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", contentDisposition("attachment", "registration-template.csv"))
      .send(templateCsv());
  }

  @Get("template.xlsx")
  @Roles(...ALL)
  @CookieAuth()
  @ApiOperation({ summary: "Excel template" })
  async templateXlsx(@Res() reply: FastifyReply): Promise<void> {
    await reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", contentDisposition("attachment", "registration-template.xlsx"))
      .send(await templateXlsx());
  }

  @Post()
  @HttpCode(201)
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({
    summary: "Upload a sheet (DL02)",
    description: "Multipart: `file` (.xlsx or .csv, 5 MB), optional `name`, `dealerId` (distributor or admin).",
  })
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ description: "BulkImportView" })
  async upload(@Ctx() ctx: RequestCtx, @Req() request: FastifyRequest): Promise<BulkImportView> {
    const form = await readMultipart(request, this.bulk.maxBytes, this.bulk.tooLargeMessage);
    return this.bulk.create(ctx, form.file, { name: form.fields.name, dealerId: form.fields.dealerId });
  }

  @Get()
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Upload history", description: "Newest first." })
  @ApiOkResponse({ description: "BulkImportView[]" })
  list(@Ctx() ctx: RequestCtx): Promise<BulkImportView[]> {
    return this.bulk.list(ctx);
  }

  @Get(":id")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "One upload with its rows" })
  @ApiOkResponse({ description: "BulkImportView" })
  get(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<BulkImportView> {
    return this.bulk.get(ctx, id);
  }

  @Put(":id/rows")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Resubmit fixed rows", description: "Only rows in ERROR are re-checked." })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { type: "object", properties: { rowNumber: { type: "integer" }, values: { type: "object" } } },
        },
      },
    },
  })
  @ApiOkResponse({ description: "BulkImportView" })
  resubmit(@Ctx() ctx: RequestCtx, @Param("id") id: string, @Body() payload: unknown): Promise<BulkImportView> {
    return this.bulk.resubmit(ctx, id, body(payload).rows);
  }
}
