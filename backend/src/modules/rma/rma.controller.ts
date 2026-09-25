import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { IfMatch, setEtag } from "../../common/http/concurrency";
import { ApiErrors } from "../../common/http/swagger";
import {
  CancelDto,
  CompleteDto,
  InspectDto,
  ReceiveDto,
  RmaDto,
  RmaListQueryDto,
  RmaPageDto,
  ShipInboundDto,
  type RmaResponse,
} from "./dto";
import { RmaService } from "./rma.service";

const LIFECYCLE_ERRORS = {
  404: [ErrorCode.NOT_FOUND],
  409: [ErrorCode.RMA_INVALID_TRANSITION, ErrorCode.CLAIM_INVALID_TRANSITION, ErrorCode.STALE_VERSION],
  428: [ErrorCode.PRECONDITION_REQUIRED],
} as const;

@ApiTags("rma")
@ApiBearerAuth("jwt")
@Controller("rmas")
export class RmaController {
  constructor(private readonly rmas: RmaService) {}

  @Get()
  @Roles("claims_agent", "service_center", "admin")
  @ApiOperation({ summary: "List RMAs", description: "Service centers see RMAs routed to them." })
  @ApiOkResponse({ type: RmaPageDto })
  @ApiErrors()
  list(@Ctx() ctx: RequestContext, @Query() query: RmaListQueryDto) {
    return this.rmas.list(ctx.user, query);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get an RMA",
    description: "Customers can read the RMA for their own claim (to ship the unit).",
  })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  async get(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.get(ctx.user, id));
  }

  @Post(":id/ship-inbound")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Record inbound shipment",
    description: "ISSUED -> IN_TRANSIT. Carrier is detected when omitted.",
  })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors(LIFECYCLE_ERRORS)
  async shipInbound(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: ShipInboundDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.shipInbound(ctx, id, version, body));
  }

  @Post(":id/receive")
  @Roles("service_center", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Receive the unit", description: "-> RECEIVED." })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors(LIFECYCLE_ERRORS)
  async receive(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: ReceiveDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.receive(ctx, id, version, body.note));
  }

  @Post(":id/inspect")
  @Roles("service_center", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Log the inspection", description: "Findings, root cause and parts used." })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors(LIFECYCLE_ERRORS)
  async inspect(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: InspectDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.inspect(ctx, id, version, body));
  }

  @Post(":id/complete")
  @Roles("service_center", "claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Complete the RMA",
    description: "Moves the claim to REPAIRED / REPLACED / CREDITED. A replacement registers the new serial.",
  })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors({
    ...LIFECYCLE_ERRORS,
    422: [ErrorCode.REPLACEMENT_SERIAL_REQUIRED, ErrorCode.CREDIT_AMOUNT_REQUIRED],
  })
  async complete(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: CompleteDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.complete(ctx, id, version, body));
  }

  @Post(":id/cancel")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel the RMA", description: "Only before the unit arrives. The claim closes." })
  @ApiOkResponse({ type: RmaDto })
  @ApiErrors(LIFECYCLE_ERRORS)
  async cancel(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: CancelDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.rmas.cancel(ctx, id, version, body.reason));
  }

  private withEtag(reply: FastifyReply, rma: RmaResponse): RmaResponse {
    setEtag(reply, rma.version);
    return rma;
  }
}
