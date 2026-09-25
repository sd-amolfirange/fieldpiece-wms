import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { DashboardSummary } from "@wms/domain";
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
    description: "A union by `role`. `dealerId` (distributors only) narrows every number to one of its dealers.",
  })
  @ApiQuery({ name: "dealerId", required: false })
  @ApiOkResponse({ description: "DashboardSummary" })
  summary(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<DashboardSummary> {
    return this.dashboard.summary(ctx, queryString(query, "dealerId"));
  }
}
