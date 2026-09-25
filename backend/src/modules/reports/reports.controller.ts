import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ApiErrors } from "../../common/http/swagger";
import {
  ClaimRateDto,
  ClaimsSummaryDto,
  CostDto,
  FailureCategoriesDto,
  ReportFiltersDto,
  ResolutionTimeDto,
} from "./dto";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@ApiBearerAuth("jwt")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("claims-summary")
  @Roles("claims_agent", "admin", "distributor")
  @ApiOperation({
    summary: "Claims summary and KPIs",
    description: "Distributors get their own organisation only.",
  })
  @ApiOkResponse({ type: ClaimsSummaryDto })
  @ApiErrors()
  claimsSummary(@Ctx() ctx: RequestContext, @Query() filters: ReportFiltersDto) {
    return this.reports.claimsSummary(ctx.user, filters);
  }

  @Get("claim-rate-by-sku")
  @Roles("claims_agent", "admin")
  @ApiOperation({
    summary: "Claim rate by SKU",
    description: "Claims in the period / registrations, sorted by rate.",
  })
  @ApiOkResponse({ type: ClaimRateDto })
  @ApiErrors()
  claimRate(@Ctx() ctx: RequestContext, @Query() filters: ReportFiltersDto) {
    return this.reports.claimRateBySku(ctx.user, filters);
  }

  @Get("failure-categories")
  @Roles("claims_agent", "admin")
  @ApiOperation({ summary: "Failure category breakdown" })
  @ApiOkResponse({ type: FailureCategoriesDto })
  @ApiErrors()
  failureCategories(@Ctx() ctx: RequestContext, @Query() filters: ReportFiltersDto) {
    return this.reports.failureCategories(ctx.user, filters);
  }

  @Get("resolution-time")
  @Roles("claims_agent", "admin")
  @ApiOperation({ summary: "Average resolution time by week" })
  @ApiOkResponse({ type: ResolutionTimeDto })
  @ApiErrors()
  resolutionTime(@Ctx() ctx: RequestContext, @Query() filters: ReportFiltersDto) {
    return this.reports.resolutionTime(ctx.user, filters);
  }

  @Get("cost")
  @Roles("claims_agent", "admin")
  @ApiOperation({ summary: "Cost by resolution type", description: "RMA counts and credit totals." })
  @ApiOkResponse({ type: CostDto })
  @ApiErrors()
  cost(@Ctx() ctx: RequestContext, @Query() filters: ReportFiltersDto) {
    return this.reports.cost(ctx.user, filters);
  }
}
