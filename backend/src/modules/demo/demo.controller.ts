import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ClaimView, ComplaintView, RegistrationView } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Public, Roles } from "../../common/auth/decorators";
import { ClaimsService } from "../claims";
import { ComplaintsService } from "../complaints";
import { DemoService } from "./demo.service";

const body = (b: unknown) => (b ?? {}) as Record<string, unknown>;

/** Mounted only when DEMO_FEATURES_ENABLED=true (never in production). */
@ApiTags("demo")
@Controller()
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly complaints: ComplaintsService,
    private readonly claims: ClaimsService,
  ) {}

  @Get("auth/demo-accounts")
  @Public()
  @ApiOperation({ summary: "Demo only: accounts for the sign-in page's picker", description: "Not mounted in production." })
  @ApiOkResponse({ description: "`{ email, label, password }[]`" })
  accounts() {
    return this.demo.accounts();
  }

  @Post("simulate/reset")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: replace all data with the seed, dated from today" })
  @ApiOkResponse({ description: "`{ ok: true }`" })
  reset(@Ctx() ctx: RequestCtx) {
    return this.demo.reset(ctx);
  }

  @Post("simulate/erp-invoice")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: an ERP sales invoice with 3 new serials (W6)" })
  @ApiOkResponse({ description: "RegistrationView[]" })
  erpInvoice(@Ctx() ctx: RequestCtx): Promise<RegistrationView[]> {
    return this.demo.erpInvoice(ctx);
  }

  @Post("simulate/registration-email")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: a registration email with the invoice attached (W6)" })
  @ApiOkResponse({ description: "RegistrationView" })
  registrationEmail(@Ctx() ctx: RequestCtx): Promise<RegistrationView> {
    return this.demo.registrationEmail(ctx);
  }

  @Post("simulate/job-result")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: the service system's job result for a WITH_SERVICE complaint (W3)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["complaintId"],
      properties: { complaintId: { type: "string" }, partType: { type: "string", enum: ["COMPRESSOR", "PCB"] } },
    },
  })
  @ApiOkResponse({ description: "ComplaintView" })
  jobResult(@Ctx() ctx: RequestCtx, @Body() payload: unknown): Promise<ComplaintView> {
    return this.complaints.recordJobResult(ctx, body(payload));
  }

  @Post("simulate/oem-decision")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: the manufacturer's decision on a SUBMITTED claim (W3)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["claimId", "decision"],
      properties: {
        claimId: { type: "string" },
        decision: { type: "string", enum: ["APPROVED", "REJECTED"] },
        reason: { type: "string" },
      },
    },
  })
  @ApiOkResponse({ description: "ClaimView" })
  oemDecision(@Ctx() ctx: RequestCtx, @Body() payload: unknown): Promise<ClaimView> {
    return this.claims.oemDecision(ctx, body(payload));
  }
}
