import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { INTEGRATION_STATUSES, INTEGRATION_SYSTEMS, type IntegrationMessage } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import type { Paginated, RawQuery } from "../../common/http/list-query";
import { IntegrationLog } from "./integration-log.service";

@ApiTags("integrations")
@Roles("admin")
@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly log: IntegrationLog) {}

  @Get()
  @ApiOperation({ summary: "Integration log (A12)", description: "Every message in and out, newest first." })
  @ApiQuery({ name: "system", required: false, enum: INTEGRATION_SYSTEMS })
  @ApiQuery({ name: "direction", required: false, enum: ["IN", "OUT"] })
  @ApiQuery({ name: "status", required: false, enum: INTEGRATION_STATUSES })
  @ApiOkResponse({ description: "Paginated<IntegrationMessage>" })
  list(@Query() query: RawQuery): Promise<Paginated<IntegrationMessage>> {
    return this.log.list(query);
  }

  @Post(":id/retry")
  @HttpCode(200)
  @ApiOperation({
    summary: "Retry a failed message",
    description: "Sends a FAILED message again (attempts + 1). `409 not_failed` for other messages.",
  })
  @ApiOkResponse({ description: "The updated IntegrationMessage" })
  retry(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<IntegrationMessage> {
    return this.log.retry(id, ctx.now);
  }
}
