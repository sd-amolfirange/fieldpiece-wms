import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { CLAIM_STATUSES, type ClaimStatus, type ClaimView, type Paginated } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import type { RawQuery } from "../../common/http/list-query";
import { ClaimsService } from "./claims.service";

@ApiTags("claims")
@Controller("claims")
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({
    summary: "Claims (A09, DL07)",
    description: "`q` matches id, serial, RMA number and brand. Dealers and distributors get their own, read-only.",
  })
  @ApiQuery({ name: "status", required: false, enum: CLAIM_STATUSES })
  @ApiQuery({ name: "brandId", required: false })
  @ApiOkResponse({ description: "Paginated<ClaimView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<ClaimView>> {
    return this.claims.list(ctx, query);
  }

  @Get("counts")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Claim counts by status (A09 tiles)" })
  @ApiOkResponse({ description: "Record<ClaimStatus, number>" })
  counts(@Ctx() ctx: RequestCtx): Promise<Record<ClaimStatus, number>> {
    return this.claims.counts(ctx);
  }

  @Get(":id")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Claim with the job result as evidence (A10)" })
  @ApiOkResponse({ description: "ClaimView" })
  get(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<ClaimView> {
    return this.claims.get(ctx, id);
  }

  @Post(":id/transitions")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Move a claim to its next status",
    description:
      "`submit` (needs amount > 0; rmaNumber optional) writes the OEM submission; `mark_paid` posts to Finance. " +
      "`422` validation.amount / validation.reasonRequired; `409 invalid_transition`.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["submit", "approve", "reject", "mark_paid"] },
        rmaNumber: { type: "string" },
        amount: { type: "number" },
        reason: { type: "string" },
      },
    },
  })
  @ApiOkResponse({ description: "ClaimView" })
  transition(@Ctx() ctx: RequestCtx, @Param("id") id: string, @Body() body: unknown): Promise<ClaimView> {
    return this.claims.transition(ctx, id, body ?? {});
  }
}
