import { Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from "@nestjs/swagger";
import type { Attachment } from "@wms/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { CookieAuth, Ctx } from "../../common/auth/decorators";
import { contentDisposition, fileHeaders } from "../../common/http/file-response";
import { readMultipart } from "../../common/http/multipart";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { FilesService } from "./files.service";

@ApiTags("files")
@Controller()
export class FilesController {
  constructor(
    private readonly files: FilesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post("uploads")
  @HttpCode(201)
  @ApiOperation({
    summary: "Upload a file",
    description: "Multipart: `file`, optional `name`. Photos, videos and PDF; 15 MB by default (UPLOAD_MAX_BYTES).",
  })
  @ApiConsumes("multipart/form-data")
  @ApiCreatedResponse({ description: "Attachment" })
  @ApiPayloadTooLargeResponse({ description: "`too_large`" })
  @ApiUnsupportedMediaTypeResponse({ description: "`unsupported_type`" })
  async upload(@Ctx() ctx: RequestCtx, @Req() request: FastifyRequest): Promise<Attachment> {
    const form = await readMultipart(request, this.files.maxUploadBytes, this.files.tooLargeMessage);
    return this.files.upload(ctx.user, form.file, form.fields.name, ctx.now);
  }

  @Get("files/:id")
  @CookieAuth()
  @ApiOperation({
    summary: "Download a file",
    description:
      "Visible to the uploader, admins and anyone who can see a record that references it. Accepts the bearer " +
      "token or the session cookie (for <img src> and plain links).",
  })
  @ApiOkResponse({ description: "The file, `Content-Disposition: inline`" })
  async download(
    @Ctx() ctx: RequestCtx,
    @Param("id") id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { attachment, stream } = await this.files.open(ctx.user, id);
    fileHeaders(reply, attachment.mime, contentDisposition("inline", attachment.name), this.env.CORS_ORIGINS);
    await reply.send(stream);
  }
}
