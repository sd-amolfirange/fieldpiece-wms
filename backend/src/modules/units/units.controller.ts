import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { VOID_REASONS, WARRANTY_STATUSES, type Entitlement, type Paginated, type UnitView } from "@wms/domain";
import type { FastifyReply } from "fastify";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { CookieAuth, Ctx, Roles } from "../../common/auth/decorators";
import { contentDisposition } from "../../common/http/file-response";
import type { RawQuery } from "../../common/http/list-query";
import { UnitsService } from "./units.service";

@ApiTags("units")
@Controller("units")
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Units in the caller's scope",
    description: "A04, DL04, CU02. `q` matches serial, customer, dealer and model code. Default sort `serial`.",
  })
  @ApiQuery({ name: "status", required: false, enum: WARRANTY_STATUSES })
  @ApiQuery({ name: "dealerId", required: false })
  @ApiOkResponse({ description: "Paginated<UnitView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<UnitView>> {
    return this.units.list(ctx, query);
  }

  @Get(":serial")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Unit with part-wise warranty status for today", description: "404 if not visible." })
  @ApiOkResponse({ description: "UnitView" })
  get(@Ctx() ctx: RequestCtx, @Param("serial") serial: string): Promise<UnitView> {
    return this.units.get(ctx, serial);
  }

  @Get(":serial/certificate.pdf")
  @Roles("admin", "dealer", "distributor", "customer")
  @CookieAuth()
  @ApiOperation({ summary: "Warranty certificate PDF", description: "Bearer token or the session cookie." })
  @ApiOkResponse({ description: "application/pdf" })
  async certificate(
    @Ctx() ctx: RequestCtx,
    @Param("serial") serial: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { serial: normalized, pdf } = await this.units.certificate(ctx, serial);
    await reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", contentDisposition("attachment", `warranty-${normalized}.pdf`))
      .header("Cache-Control", "private, no-store")
      .send(pdf);
  }

  @Get(":serial/entitlement")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "What a complaint on this unit would be entitled to today (CU04, DL06)" })
  @ApiOkResponse({ description: "Entitlement" })
  entitlement(@Ctx() ctx: RequestCtx, @Param("serial") serial: string): Promise<Entitlement> {
    return this.units.entitlement(ctx, serial);
  }

  @Post(":serial/void")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Void the warranty (W5)",
    description: "`422` validation.voidReason; `409 already_void`; `409 not_registered`.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["reason"],
      properties: { reason: { type: "string", enum: [...VOID_REASONS] }, note: { type: "string" } },
    },
  })
  @ApiOkResponse({ description: "UnitView with `void` set" })
  voidWarranty(@Ctx() ctx: RequestCtx, @Param("serial") serial: string, @Body() body: unknown): Promise<UnitView> {
    return this.units.voidWarranty(ctx, serial, body ?? {});
  }
}
