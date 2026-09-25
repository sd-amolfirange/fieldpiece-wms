import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Notification } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx } from "../../common/auth/decorators";
import { Notifier } from "./notifier.service";

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifier: Notifier) {}

  @Get()
  @ApiOperation({ summary: "The caller's latest notifications", description: "Newest first, at most 30." })
  @ApiOkResponse({ description: "Notification[]" })
  list(@Ctx() ctx: RequestCtx): Promise<Notification[]> {
    return this.notifier.latest(ctx.user.id);
  }

  @Post("read")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark notifications read", description: "No ids = all of the caller's notifications." })
  @ApiBody({ schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } } })
  @ApiOkResponse({ description: "`{ ok: true }`" })
  async markRead(@Ctx() ctx: RequestCtx, @Body() body: unknown): Promise<{ ok: true }> {
    const raw = (body as { ids?: unknown } | null)?.ids;
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : undefined;
    await this.notifier.markRead(ctx.user.id, ids);
    return { ok: true };
  }
}
