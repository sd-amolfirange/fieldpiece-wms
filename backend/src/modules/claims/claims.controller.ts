import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  CLAIM_SOURCES,
  CLAIM_STATUSES,
  ISSUE_TYPES,
  RESOLUTIONS,
  type ClaimStatus,
  type Paginated,
  type WarrantyClaimView,
} from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import type { RawQuery } from "../../common/http/list-query";
import { ClaimsService } from "./claims.service";

const ALL = ["admin", "dealer", "distributor", "customer"] as const;

@ApiTags("claims")
@Controller("claims")
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @Roles(...ALL)
  @ApiOperation({
    summary: "Warranty claims in the caller's scope",
    description: "`q` matches claim id, serial, batch, model, customer and dealer. Newest first by default.",
  })
  @ApiQuery({ name: "status", required: false, enum: CLAIM_STATUSES })
  @ApiQuery({ name: "source", required: false, enum: CLAIM_SOURCES })
  @ApiQuery({ name: "issueType", required: false, enum: ISSUE_TYPES })
  @ApiOkResponse({ description: "Paginated<WarrantyClaimView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<WarrantyClaimView>> {
    return this.claims.list(ctx, query);
  }

  @Get("counts")
  @Roles(...ALL)
  @ApiOperation({ summary: "Claim counts by status (count tiles)" })
  @ApiOkResponse({ description: "Record<ClaimStatus, number>" })
  counts(@Ctx() ctx: RequestCtx): Promise<Record<ClaimStatus, number>> {
    return this.claims.counts(ctx);
  }

  @Get(":id")
  @Roles(...ALL)
  @ApiOperation({ summary: "Warranty claim with the product's coverage, evidence and history" })
  @ApiOkResponse({ description: "WarrantyClaimView" })
  get(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<WarrantyClaimView> {
    return this.claims.get(ctx, id);
  }

  @Post()
  @HttpCode(200)
  @Roles(...ALL)
  @ApiOperation({
    summary: "File a warranty claim",
    description:
      "On a registered product the caller can see. The server records the coverage on the day of filing. " +
      "`422` validation.issueType / validation.describeFault; `409 not_registered`; `409 claim_open`.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitSerial", "issueType", "description"],
      properties: {
        unitSerial: { type: "string" },
        issueType: { type: "string", enum: [...ISSUE_TYPES] },
        description: { type: "string", minLength: 10 },
        attachmentIds: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiOkResponse({ description: "WarrantyClaimView" })
  create(@Ctx() ctx: RequestCtx, @Body() body: unknown): Promise<WarrantyClaimView> {
    return this.claims.create(ctx, body ?? {});
  }

  @Post(":id/transitions")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Move a claim to its next status (warranty desk)",
    description:
      "`start_review`; `approve` with a resolution (REPAIR, REPLACE, CREDIT; CREDIT needs creditAmount); `reject` " +
      "with a reason; `close` (REPLACE needs replacementSerial; a credit is posted to Finance). `409 invalid_transition`.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["start_review", "approve", "reject", "close"] },
        resolution: { type: "string", enum: [...RESOLUTIONS] },
        creditAmount: { type: "number" },
        reason: { type: "string" },
        note: { type: "string" },
        replacementSerial: { type: "string" },
        replacementBatchNumber: { type: "string" },
      },
    },
  })
  @ApiOkResponse({ description: "WarrantyClaimView" })
  transition(
    @Ctx() ctx: RequestCtx,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<WarrantyClaimView> {
    return this.claims.transition(ctx, id, body ?? {});
  }
}
