import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Public, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import {
  AttachProductImageDto,
  CreateProductDto,
  ProductDto,
  ProductImageUploadDto,
  ProductImageUploadResponseDto,
  ProductListQueryDto,
  ProductPageDto,
  UpdateProductDto,
} from "./dto";
import { ProductImagesService } from "./product-images.service";
import { ProductsService } from "./products.service";

/** Each upload gets a new key and so a new URL: a URL's bytes never change. */
const IMMUTABLE = "public, max-age=31536000, immutable";

@ApiTags("products")
@ApiBearerAuth("jwt")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImagesService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Product catalogue", description: "Includes the warranty term in effect today." })
  @ApiOkResponse({ type: ProductPageDto })
  @ApiErrors()
  list(@Query() query: ProductListQueryDto) {
    return this.products.list(query);
  }

  @Get(":sku")
  @ApiOperation({ summary: "Get a product by SKU" })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  get(@Param("sku") sku: string) {
    return this.products.getBySku(sku);
  }

  @Post()
  @Roles("admin")
  @ApiOperation({ summary: "Add a product" })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiErrors({ 409: [ErrorCode.CONFLICT] })
  create(@Ctx() ctx: RequestContext, @Body() body: CreateProductDto) {
    return this.products.create(ctx, body);
  }

  @Patch(":sku")
  @Roles("admin")
  @ApiOperation({ summary: "Update a product" })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  update(@Ctx() ctx: RequestContext, @Param("sku") sku: string, @Body() body: UpdateProductDto) {
    return this.products.update(ctx, sku, body);
  }

  @Get(":sku/image")
  @Public()
  // Catalogue photos aren't sensitive and pages show many at once, so they skip the public daily cap.
  @SkipThrottle({ publicDaily: true })
  @ApiOperation({
    summary: "Product photo",
    description: "Use the versioned `imageUrl` from the product; responses under it are cacheable forever.",
  })
  @ApiProduces("image/png", "image/jpeg", "image/webp")
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] }, { isPublic: true })
  async image(
    @Param("sku") sku: string,
    @Query("v") requestedVersion: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.images.open(sku);
    const etag = `"${file.version}"`;
    // A stale ?v= still gets today's photo, but only briefly cached so it can't pin the old URL to it.
    const cacheControl = requestedVersion === file.version ? IMMUTABLE : "public, max-age=60";
    void reply
      .header("ETag", etag)
      .header("Cache-Control", cacheControl)
      // Helmet defaults to same-origin; the web app runs on another origin and must be able to show it.
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .header("X-Content-Type-Options", "nosniff");
    if (ifNoneMatch === etag) {
      file.stream.destroy();
      await reply.status(304).send();
      return;
    }
    await reply
      .header("Content-Type", file.contentType)
      .header("Content-Length", file.size)
      .send(file.stream);
  }

  @Post(":sku/image/upload-url")
  @Roles("admin")
  @Throttle({ writes: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: "Start a product photo upload",
    description: "Returns a presigned PUT (5 min). Upload the file, then call PUT /products/{sku}/image.",
  })
  @ApiCreatedResponse({ type: ProductImageUploadResponseDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  createImageUpload(@Param("sku") sku: string, @Body() body: ProductImageUploadDto) {
    return this.images.createUploadUrl(sku, body);
  }

  @Put(":sku/image")
  @Roles("admin")
  @ApiOperation({
    summary: "Use an uploaded photo",
    description: "Checks size and file type, then swaps it in.",
  })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 422: [ErrorCode.ATTACHMENT_INVALID, ErrorCode.VALIDATION_FAILED] })
  attachImage(@Ctx() ctx: RequestContext, @Param("sku") sku: string, @Body() body: AttachProductImageDto) {
    return this.images.attach(ctx, sku, body.key);
  }

  @Delete(":sku/image")
  @Roles("admin")
  @ApiOperation({ summary: "Remove the product photo" })
  @ApiOkResponse({ type: ProductDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  removeImage(@Ctx() ctx: RequestContext, @Param("sku") sku: string) {
    return this.images.remove(ctx, sku);
  }
}
