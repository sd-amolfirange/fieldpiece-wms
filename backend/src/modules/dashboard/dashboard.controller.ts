import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { DashboardSummary, FinanceSummary } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import { queryString, type RawQuery } from "../../common/http/list-query";
import { DashboardService } from "./dashboard.service";

@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Dashboard numbers for the caller's role (A01, DL01, customer home)",
    description:
      "A union by `role`. `dealerId` (distributors only) narrows every number to one of its dealers.",
  })
  @ApiQuery({ name: "dealerId", required: false })
  @ApiOkResponse({ description: "DashboardSummary" })
  summary(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<DashboardSummary> {
    return this.dashboard.summary(ctx, queryString(query, "dealerId"));
  }

  @Get("finance")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({
    summary: "Warranty cost, extension revenue and model quotas over the last 12 months (finance insights)",
    description:
      "Admin: everything; dealer and distributor: their dealers' claims, extensions and products. `dealerId` " +
      "(distributors only) narrows to one of its dealers. Cost counts approved and closed claims filed in the period.",
  })
  @ApiQuery({ name: "dealerId", required: false })
  @ApiOkResponse({ description: "FinanceSummary" })
  finance(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<FinanceSummary> {
    return this.dashboard.finance(ctx, queryString(query, "dealerId"));
  }
}
