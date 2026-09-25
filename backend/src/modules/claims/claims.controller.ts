import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { IfMatch, setEtag } from "../../common/http/concurrency";
import { ApiErrors } from "../../common/http/swagger";
import { ClaimsService } from "./claims.service";
import {
  ApproveClaimDto,
  AssignClaimDto,
  ClaimDetailDto,
  ClaimEventDto,
  ClaimEventPageDto,
  ClaimEventsQueryDto,
  ClaimListQueryDto,
  ClaimPageDto,
  CommentDto,
  CreateClaimDto,
  MessageDto,
  OptionalMessageDto,
  RejectClaimDto,
  UpdateClaimDto,
  type ClaimDetail,
} from "./dto";

const TRANSITION_ERRORS = {
  404: [ErrorCode.NOT_FOUND],
  409: [ErrorCode.CLAIM_INVALID_TRANSITION, ErrorCode.STALE_VERSION],
  428: [ErrorCode.PRECONDITION_REQUIRED],
} as const;

/**
 * Claims. Non-CRUD actions are sub-resources (Section 6.1). Every mutation needs If-Match and accepts an
 * Idempotency-Key; responses carry the new ETag.
 */
@ApiTags("claims")
@ApiBearerAuth("jwt")
@Controller("claims")
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @ApiOperation({
    summary: "List claims",
    description: "Scoped to the caller. Lookup by display number: ?displayNo=CLM-000123",
  })
  @ApiOkResponse({ type: ClaimPageDto })
  @ApiErrors()
  list(@Ctx() ctx: RequestContext, @Query() query: ClaimListQueryDto) {
    return this.claims.list(ctx.user, query);
  }

  @Post()
  @Roles("technician", "distributor", "claims_agent", "admin")
  @ApiOperation({ summary: "Create a draft claim" })
  @ApiCreatedResponse({ type: ClaimDetailDto })
  @ApiErrors({
    422: [ErrorCode.REGISTRATION_NOT_FOUND, ErrorCode.FAILURE_DATE_INVALID, ErrorCode.ATTACHMENT_NOT_CLEAN],
  })
  async create(
    @Ctx() ctx: RequestContext,
    @Body() body: CreateClaimDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.create(ctx, body));
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get a claim",
    description: "Includes `allowedActions` for the caller, and an ETag.",
  })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  async get(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.get(ctx.user, id));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a claim", description: "Only in DRAFT or NEEDS_INFO." })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({
    404: [ErrorCode.NOT_FOUND],
    409: [ErrorCode.CLAIM_NOT_EDITABLE, ErrorCode.STALE_VERSION],
    428: [ErrorCode.PRECONDITION_REQUIRED],
  })
  async update(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: UpdateClaimDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.update(ctx, id, version, body));
  }

  @Post(":id/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Submit a draft", description: "DRAFT -> SUBMITTED. Starts the SLA clock." })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ ...TRANSITION_ERRORS, 422: [ErrorCode.PHOTO_REQUIRED] })
  async submit(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.submit(ctx, id, version));
  }

  @Post(":id/assign")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Assign an agent", description: "Send assigneeId null to unassign." })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ ...TRANSITION_ERRORS, 422: [ErrorCode.ASSIGNEE_INVALID] })
  async assign(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: AssignClaimDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.assign(ctx, id, version, body.assigneeId));
  }

  @Post(":id/start-review")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Start review",
    description: "SUBMITTED -> IN_REVIEW. Assigns the caller if unassigned.",
  })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors(TRANSITION_ERRORS)
  async startReview(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.startReview(ctx, id, version));
  }

  @Post(":id/request-info")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask the customer for more information", description: "IN_REVIEW -> NEEDS_INFO." })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ ...TRANSITION_ERRORS, 422: [ErrorCode.MESSAGE_REQUIRED] })
  async requestInfo(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: MessageDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.requestInfo(ctx, id, version, body.message));
  }

  @Post(":id/respond")
  @Roles("technician", "distributor")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Respond to a request for information", description: "NEEDS_INFO -> IN_REVIEW." })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors(TRANSITION_ERRORS)
  async respond(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: MessageDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.respond(ctx, id, version, body.message));
  }

  @Post(":id/approve")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Approve a claim",
    description: "IN_REVIEW -> APPROVED -> RMA_ISSUED, creating the RMA atomically.",
  })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ ...TRANSITION_ERRORS, 422: [ErrorCode.RESOLUTION_REQUIRED] })
  async approve(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: ApproveClaimDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.approve(ctx, id, version, body.resolution, body.comment));
  }

  @Post(":id/reject")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reject a claim",
    description: "A reason and a message to the customer are required.",
  })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors({ ...TRANSITION_ERRORS, 422: [ErrorCode.REASON_REQUIRED] })
  async reject(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: RejectClaimDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.reject(ctx, id, version, body.reason, body.message));
  }

  @Post(":id/close")
  @Roles("claims_agent", "admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Close a resolved or rejected claim" })
  @ApiOkResponse({ type: ClaimDetailDto })
  @ApiErrors(TRANSITION_ERRORS)
  async close(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @IfMatch() version: number,
    @Body() body: OptionalMessageDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withEtag(reply, await this.claims.close(ctx, id, version, body.message));
  }

  @Get(":id/events")
  @ApiOperation({
    summary: "Claim timeline",
    description: "Keyset-paginated. Internal notes are hidden from customers.",
  })
  @ApiOkResponse({ type: ClaimEventPageDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  events(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ClaimEventsQueryDto,
  ) {
    return this.claims.events(ctx.user, id, query.after, query.limit);
  }

  @Post(":id/comments")
  @ApiOperation({ summary: "Add a comment", description: "`internal: true` is for staff only." })
  @ApiCreatedResponse({ type: ClaimEventDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  comment(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: CommentDto) {
    return this.claims.comment(ctx, id, body.comment, body.internal);
  }

  private withEtag(reply: FastifyReply, claim: ClaimDetail): ClaimDetail {
    setEtag(reply, claim.version);
    return claim;
  }
}
