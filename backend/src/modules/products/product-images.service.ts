import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { RequestContext } from "../../common/auth/auth-user";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { matchesSignature } from "../../common/files/file-signature";
import {
  isProductImageKey,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIME,
  productImageKey,
  productImageVersion,
} from "../../common/files/product-image";
import { Clock } from "../../common/time/clock";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { AuditService } from "../audit";
import type { ProductImageUploadDto, ProductImageUploadResponse, ProductResponse } from "./dto";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

const UPLOAD_URL_TTL_SECONDS = 300;
const SNIFF_BYTES = 16;

export interface ProductImageFile {
  stream: Readable;
  contentType: string;
  size: number;
  version: string;
}

/**
 * Product photos. Admins upload straight to storage with a presigned PUT, then attach the key; the API checks
 * size and magic bytes before the product points at it. Everyone else only reads through `open`.
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductsRepository,
    private readonly products: ProductsService,
    private readonly storage: BlobStorage,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async createUploadUrl(sku: string, input: ProductImageUploadDto): Promise<ProductImageUploadResponse> {
    const product = await this.requireProduct(sku);
    const key = productImageKey(product.sku, randomUUID());
    const { url, headers } = await this.storage.presignPut({
      key,
      contentType: input.contentType,
      contentLength: input.contentLength,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    const expiresAt = new Date(this.clock.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
    return { key, uploadUrl: url, method: "PUT", headers, expiresAt };
  }

  async attach(ctx: RequestContext, sku: string, key: string): Promise<ProductResponse> {
    const product = await this.requireProduct(sku);
    if (!isProductImageKey(product.sku, key)) {
      throw AppError.unprocessable(
        ErrorCode.VALIDATION_FAILED,
        "That upload doesn't belong to this product.",
        {
          key: ["Request a new upload URL for this product."],
        },
      );
    }
    await this.verifyUpload(key);

    await this.prisma.$transaction(async (tx) => {
      await this.repo.update(tx, product.id, { imageKey: key });
      await this.audit.record(tx, ctx, {
        action: "product.image_changed",
        entity: "product",
        entityId: product.id,
        before: { imageKey: product.imageKey },
        after: { imageKey: key },
      });
    });
    await this.afterChange(product.imageKey);
    return this.products.getBySku(product.sku);
  }

  async remove(ctx: RequestContext, sku: string): Promise<ProductResponse> {
    const product = await this.requireProduct(sku);
    if (product.imageKey) {
      await this.prisma.$transaction(async (tx) => {
        await this.repo.update(tx, product.id, { imageKey: null });
        await this.audit.record(tx, ctx, {
          action: "product.image_removed",
          entity: "product",
          entityId: product.id,
          before: { imageKey: product.imageKey },
        });
      });
      await this.afterChange(product.imageKey);
    }
    return this.products.getBySku(product.sku);
  }

  /** Public read. The key always comes from the database, never from the request. */
  async open(sku: string): Promise<ProductImageFile> {
    const product = await this.repo.findBySku(this.prisma, sku.toUpperCase());
    if (!product?.imageKey) throw AppError.notFound("Product image");
    const head = await this.storage.head(product.imageKey);
    if (!head) throw AppError.notFound("Product image");
    return {
      stream: await this.storage.getStream(product.imageKey),
      contentType: head.contentType ?? "application/octet-stream",
      size: head.size,
      version: productImageVersion(product.imageKey),
    };
  }

  private async requireProduct(sku: string) {
    const product = await this.repo.findBySku(this.prisma, sku.toUpperCase());
    if (!product) throw AppError.notFound("Product");
    return product;
  }

  /** Rejects (and deletes) anything too big or whose bytes don't match an allowed image type. */
  private async verifyUpload(key: string): Promise<void> {
    const head = await this.storage.head(key);
    if (!head) {
      throw AppError.unprocessable(ErrorCode.ATTACHMENT_INVALID, "The upload didn't finish. Try again.");
    }
    const mime = head.contentType ?? "";
    const allowed = (PRODUCT_IMAGE_MIME as readonly string[]).includes(mime);
    const valid =
      allowed &&
      head.size <= PRODUCT_IMAGE_MAX_BYTES &&
      matchesSignature(mime, await this.storage.readStart(key, SNIFF_BYTES));
    if (!valid) {
      await this.storage.delete(key);
      throw AppError.unprocessable(ErrorCode.ATTACHMENT_INVALID, "Use a PNG, JPEG or WebP image up to 5 MB.");
    }
  }

  /** Cache first, then the old object. A failed delete only leaves an orphan, so it's logged, not thrown. */
  private async afterChange(previousKey: string | null): Promise<void> {
    await this.products.invalidate();
    if (!previousKey) return;
    await this.storage.delete(previousKey).catch((err: unknown) => {
      this.logger.warn({ err, key: previousKey }, "Couldn't delete the replaced product image");
    });
  }
}
