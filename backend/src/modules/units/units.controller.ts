import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  EXTENSION_PLANS,
  VOID_REASONS,
  WARRANTY_STATUSES,
  type Coverage,
  type ExtensionQuote,
  type Paginated,
  type UnitView,
} from "@wms/domain";
import type { FastifyReply } from "fastify";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { CookieAuth, Ctx, Roles } from "../../common/auth/decorators";
import { contentDisposition } from "../../common/http/file-response";
import type { RawQuery } from "../../common/http/list-query";
import { UNIT_CHANNEL_FILTERS, UnitsService } from "./units.service";

@ApiTags("units")
@Controller("units")
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Registered products in the caller's scope",
    description:
      "A04, DL04, CU02. `q` matches serial, batch, customer, dealer and model. `channel` is the channel of the " +
      "registration that started the warranty; APPS = either Fieldpiece app (OVERWATCH, JOBLINK). Default sort " +
      "`serial`.",
  })
  @ApiQuery({ name: "status", required: false, enum: WARRANTY_STATUSES })
  @ApiQuery({ name: "dealerId", required: false })
  @ApiQuery({ name: "channel", required: false, enum: UNIT_CHANNEL_FILTERS })
  @ApiOkResponse({ description: "Paginated<UnitView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<UnitView>> {
    return this.units.list(ctx, query);
  }

  @Get(":serial")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Product with its warranty status for today", description: "404 if not visible." })
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

  @Get(":serial/coverage")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Whether a warranty claim on this product would be covered today" })
  @ApiOkResponse({ description: "Coverage" })
  coverage(@Ctx() ctx: RequestCtx, @Param("serial") serial: string): Promise<Coverage> {
    return this.units.coverage(ctx, serial);
  }

  @Get(":serial/extension")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Extended-warranty offer for this product today",
    description:
      "Plans of 12, 24 or 36 more months (up to 36 in total) with price and new end date, while the warranty is " +
      "registered, not void, not replaced and still in force; otherwise `eligible: false` with a `reason`. " +
      "404 if not visible.",
  })
  @ApiOkResponse({ description: "ExtensionQuote" })
  extensionQuote(@Ctx() ctx: RequestCtx, @Param("serial") serial: string): Promise<ExtensionQuote> {
    return this.units.extensionQuote(ctx, serial);
  }

  @Post(":serial/extensions")
  @HttpCode(200)
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Buy an extended warranty",
    description:
      "`months` must be one of the offer's plans (`422` validation.extensionPlan). `409 not_extendable` when the " +
      "product can't be extended (not registered, void, replaced, expired, or already extended 36 months). Moves " +
      "the warranty end date, notifies the product's followers (`unit_extended`) and invoices it through Finance.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["months"],
      properties: { months: { type: "integer", enum: EXTENSION_PLANS.map((p) => p.months) } },
    },
  })
  @ApiOkResponse({ description: "UnitView with the new warranty end and `extensions`" })
  extend(@Ctx() ctx: RequestCtx, @Param("serial") serial: string, @Body() body: unknown): Promise<UnitView> {
    return this.units.extend(ctx, serial, body ?? {});
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
  voidWarranty(
    @Ctx() ctx: RequestCtx,
    @Param("serial") serial: string,
    @Body() body: unknown,
  ): Promise<UnitView> {
    return this.units.voidWarranty(ctx, serial, body ?? {});
  }
}
