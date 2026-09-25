import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import { AttachmentsService } from "./attachments.service";
import { AttachmentDto, DownloadUrlResponseDto, UploadUrlRequestDto, UploadUrlResponseDto } from "./dto";

@ApiTags("attachments")
@ApiBearerAuth("jwt")
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post("upload-url")
  @Throttle({ writes: { limit: 30, ttl: 60_000 } }) // Section 11.4
  @ApiOperation({
    summary: "Get a presigned upload URL",
    description:
      "PUT the file straight to storage (5-minute URL, type and length pinned), then call confirm.",
  })
  @ApiCreatedResponse({ type: UploadUrlResponseDto })
  @ApiErrors({ 413: [ErrorCode.PAYLOAD_TOO_LARGE] })
  createUploadUrl(@Ctx() ctx: RequestContext, @Body() body: UploadUrlRequestDto) {
    return this.attachments.createUploadUrl(ctx.user, body);
  }

  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirm an upload",
    description: "Verifies the stored object and queues the virus scan.",
  })
  @ApiOkResponse({ type: AttachmentDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 422: [ErrorCode.ATTACHMENT_UPLOAD_MISMATCH] })
  confirm(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.attachments.confirm(ctx, id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Attachment metadata", description: "Poll this for scanStatus after confirming." })
  @ApiOkResponse({ type: AttachmentDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  get(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.attachments.get(ctx.user, id);
  }

  @Get(":id/download-url")
  @ApiOperation({
    summary: "Get a presigned download URL",
    description: "5-minute expiry, clean files only, scoped.",
  })
  @ApiOkResponse({ type: DownloadUrlResponseDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 422: [ErrorCode.ATTACHMENT_NOT_CLEAN] })
  downloadUrl(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.attachments.downloadUrl(ctx.user, id);
  }
}
