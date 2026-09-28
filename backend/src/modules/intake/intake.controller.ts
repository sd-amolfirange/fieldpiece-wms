import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { IntakeInfo, ModelView, PartnerClientView } from "@wms/domain";
import type { FastifyRequest } from "fastify";
import type { SystemCtx } from "../../common/auth/context";
import { Public, Roles } from "../../common/auth/decorators";
import { readMultipart } from "../../common/http/multipart";
import { PartnerRateLimit, PublicFormRateLimit } from "../../common/http/throttling";
import { isoDateIn } from "../../common/time/business-date";
import { Clock } from "../../common/time/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { CatalogService } from "../catalog";
import { FilesService } from "../files";
import { IntakeService, type PublicRegistrationFields } from "./intake.service";
import { PartnerClientsService } from "./partner-clients.service";

const PUBLIC_FIELDS: readonly (keyof PublicRegistrationFields)[] = [
  "serial",
  "batchNumber",
  "modelCode",
  "purchaseDate",
  "placeOfPurchase",
  "invoiceNumber",
  "customerName",
  "customerEmail",
  "customerPhone",
  "city",
  "state",
  "zip",
  "website",
];

@ApiTags("registration intake")
@Controller()
export class IntakeController {
  constructor(
    private readonly intake: IntakeService,
    private readonly partners: PartnerClientsService,
    private readonly catalog: CatalogService,
    private readonly files: FilesService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private systemCtx(): SystemCtx {
    const now = this.clock.now();
    return { now, today: isoDateIn(this.env.APP_TIMEZONE, now) };
  }

  // ── Registration hub ───────────────────────────────────────────────────────

  @Get("intake")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Where registrations can come in (registration hub)" })
  @ApiOkResponse({ description: "IntakeInfo" })
  info(): IntakeInfo {
    return this.intake.info();
  }

  // ── Public registration form ───────────────────────────────────────────────

  @Get("public/models")
  @Public()
  @ApiOperation({ summary: "Product models for the public registration form" })
  @ApiOkResponse({ description: "ModelView[]" })
  publicModels(): Promise<ModelView[]> {
    return this.catalog.models();
  }

  @Post("public/registrations")
  @HttpCode(200)
  @Public()
  @PublicFormRateLimit()
  @ApiOperation({
    summary: "Register a product without an account (public web form)",
    description:
      "Multipart: the registration fields and `file` (proof of purchase: photo or PDF). Always reviewed by the " +
      "warranty desk. Rate-limited per IP (PUBLIC_FORM_LIMIT_PER_HOUR).",
  })
  @ApiConsumes("multipart/form-data")
  @ApiOkResponse({ description: '`{ registrationId, status: "PENDING" }`' })
  @ApiTooManyRequestsResponse({ description: "`rate_limited`" })
  async publicRegistration(@Req() request: FastifyRequest) {
    const form = await readMultipart(request, this.files.maxUploadBytes, this.files.tooLargeMessage);
    const fields: PublicRegistrationFields = {};
    for (const key of PUBLIC_FIELDS) {
      const value = form.fields[key];
      if (typeof value === "string") fields[key] = value.slice(0, 200);
    }
    return this.intake.publicRegistration(this.systemCtx(), fields, form.file);
  }

  // ── Partner API ────────────────────────────────────────────────────────────

  @Post("partner/v1/registrations")
  @HttpCode(200)
  @Public()
  @PartnerRateLimit()
  @ApiOperation({
    summary: "Send registrations from a partner system (distributor ERP, marketplace, retailer)",
    description:
      "Authenticate with `X-Api-Key`. Body: one registration, or `{ registrations: [...] }` (up to 500). Each item: " +
      "serial, batchNumber, modelCode, purchaseDate, customer { name, email, phone, city, state, zip }, " +
      "invoiceNumber, placeOfPurchase. Clean items are registered at once; a serial that's already registered goes " +
      "to review; others come back with row errors.",
  })
  @ApiHeader({ name: "X-Api-Key", required: true })
  @ApiOkResponse({ description: "`{ results: [{ index, serial, status, registrationId?, errors? }] }`" })
  @ApiUnauthorizedResponse({ description: "`invalid_api_key`" })
  async partnerRegistrations(@Headers("x-api-key") apiKey: string | undefined, @Body() body: unknown) {
    const ctx = this.systemCtx();
    const client = await this.partners.authenticate(apiKey, ctx.now);
    return this.intake.partnerRegistrations(ctx, client, body);
  }

  // ── Email intake (mail provider webhook) ───────────────────────────────────

  @Post("inbound/email")
  @HttpCode(202)
  @Public()
  @PartnerRateLimit()
  @ApiOperation({
    summary: "Inbound registration email (mail provider webhook)",
    description:
      "Called by the mail provider for every message to INBOUND_EMAIL_ADDRESS, with `X-Inbound-Secret`. JSON: " +
      "{ from, to, subject, text, attachments: [{ filename, contentType, contentBase64 }] }. Off (404) until " +
      "INBOUND_EMAIL_SECRET is set.",
  })
  @ApiHeader({ name: "X-Inbound-Secret", required: true })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        subject: { type: "string" },
        text: { type: "string" },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string" },
              contentType: { type: "string" },
              contentBase64: { type: "string" },
            },
          },
        },
      },
    },
  })
  inboundEmail(@Headers("x-inbound-secret") secret: string | undefined, @Body() body: unknown) {
    this.intake.assertInboundSecret(secret);
    return this.intake.inboundEmail(this.systemCtx(), body ?? {});
  }

  // ── Partner keys (admin) ───────────────────────────────────────────────────

  @Get("admin/partner-clients")
  @Roles("admin")
  @ApiOperation({ summary: "Partner systems allowed to use the partner API" })
  @ApiOkResponse({ description: "PartnerClientView[]" })
  listPartners(): Promise<PartnerClientView[]> {
    return this.partners.list();
  }

  @Post("admin/partner-clients")
  @HttpCode(201)
  @Roles("admin")
  @ApiOperation({
    summary: "Add a partner system",
    description: "Returns its API key once; only a hash is kept.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["name", "channel"],
      properties: {
        name: { type: "string" },
        channel: { type: "string", enum: ["API", "RETAIL", "ERP"] },
        dealerId: { type: "string" },
      },
    },
  })
  @ApiCreatedResponse({ description: "`{ client: PartnerClientView, apiKey }`" })
  createPartner(@Body() body: unknown) {
    return this.partners.create(body ?? {}, this.clock.now());
  }

  @Patch("admin/partner-clients/:id")
  @Roles("admin")
  @ApiOperation({ summary: "Turn a partner's key on or off" })
  @ApiBody({ schema: { type: "object", required: ["active"], properties: { active: { type: "boolean" } } } })
  @ApiOkResponse({ description: "PartnerClientView" })
  setPartnerActive(@Param("id") id: string, @Body() body: unknown): Promise<PartnerClientView> {
    return this.partners.setActive(id, (body as { active?: unknown } | null)?.active === true);
  }
}
