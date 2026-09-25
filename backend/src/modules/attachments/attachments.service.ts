import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { Attachment } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { claimScope, registrationScope, rmaScope } from "../../common/auth/scope";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { Clock } from "../../common/time/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { type Db, PrismaService, type Tx } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { AttachmentsRepository } from "./attachments.repository";
import type { AttachmentResponse } from "./dto";
import {
  ALLOWED_MIME,
  IMAGE_MIME,
  matchesSignature,
  maxBytesFor,
  type OwnerType,
  storageKeyFor,
} from "./file-policy";

const URL_TTL_SECONDS = 300; // 5 min for both upload and download URLs (Section 8.5)
const SNIFF_BYTES = 512;

export function toAttachmentResponse(a: Attachment): AttachmentResponse {
  return {
    id: a.id,
    ownerType: a.ownerType as OwnerType,
    ownerId: a.ownerId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: Number(a.sizeBytes),
    scanStatus: a.scanStatus as AttachmentResponse["scanStatus"],
    uploaded: a.uploadedAt !== null,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AttachmentsRepository,
    private readonly storage: BlobStorage,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Validates type and size, records a PENDING row and returns a presigned PUT. */
  async createUploadUrl(
    user: AuthUser,
    input: { fileName: string; mimeType: string; sizeBytes: number; ownerType: OwnerType },
  ) {
    if (input.ownerType === "import" && !user.hasAny("distributor", "admin")) throw AppError.forbidden();
    if (!ALLOWED_MIME[input.ownerType].includes(input.mimeType)) {
      throw new AppError(
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        `That file type isn't accepted here. Use ${ALLOWED_MIME[input.ownerType].join(", ")}.`,
      );
    }
    const max = maxBytesFor(input.mimeType, this.env.UPLOAD_MAX_BYTES);
    if (input.sizeBytes > max) {
      throw new AppError(
        ErrorCode.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        `Files can be up to ${Math.round(max / 1024 / 1024)} MB.`,
      );
    }

    const id = randomUUID();
    const now = this.clock.now();
    const attachment = await this.repo.create(this.prisma, {
      id,
      ownerType: input.ownerType,
      storageKey: storageKeyFor(input.ownerType, id, now),
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      uploadedBy: user.id,
    });
    let presigned;
    try {
      presigned = await this.storage.presignPut({
        key: attachment.storageKey,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresInSeconds: URL_TTL_SECONDS,
      });
    } catch (err) {
      this.logger.error({ err }, "Storage unavailable");
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        "Uploads are unavailable right now. Try again shortly.",
      );
    }
    return {
      attachment: toAttachmentResponse(attachment),
      uploadUrl: presigned.url,
      method: "PUT" as const,
      headers: presigned.headers,
      expiresAt: new Date(now.getTime() + URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** The client finished the PUT: verify the object matches what was declared, then queue the scan. */
  async confirm(ctx: RequestContext, id: string): Promise<AttachmentResponse> {
    const attachment = await this.repo.findById(this.prisma, id);
    if (!attachment || attachment.uploadedBy !== ctx.user.id) throw AppError.notFound("Attachment");
    if (attachment.uploadedAt) return toAttachmentResponse(attachment); // idempotent

    const head = await this.storage.head(attachment.storageKey);
    if (!head) {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_UPLOAD_MISMATCH,
        "We didn't receive the file. Upload it again.",
      );
    }
    if (
      head.size !== Number(attachment.sizeBytes) ||
      (head.contentType && head.contentType !== attachment.mimeType)
    ) {
      await this.storage.delete(attachment.storageKey);
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_UPLOAD_MISMATCH,
        "The uploaded file doesn't match what was declared.",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.repo.update(tx, id, { uploadedAt: this.clock.now() });
      await this.outbox.add(tx, {
        aggregate: "attachment",
        aggregateId: id,
        type: "attachment.uploaded",
        payload: { attachmentId: id },
      });
      return row;
    });
    return toAttachmentResponse(updated);
  }

  async get(user: AuthUser, id: string): Promise<AttachmentResponse> {
    return toAttachmentResponse(await this.getVisible(user, id));
  }

  async downloadUrl(user: AuthUser, id: string) {
    const attachment = await this.getVisible(user, id);
    if (attachment.scanStatus !== "CLEAN") {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_NOT_CLEAN,
        "This file is still being checked. Try again in a moment.",
      );
    }
    const url = await this.storage.presignGet({
      key: attachment.storageKey,
      expiresInSeconds: URL_TTL_SECONDS,
      downloadName: attachment.fileName,
    });
    return { url, expiresAt: new Date(this.clock.now().getTime() + URL_TTL_SECONDS * 1000).toISOString() };
  }

  forOwner(db: Db, ownerType: OwnerType, ownerId: string): Promise<AttachmentResponse[]> {
    return this.repo.forOwner(db, ownerType, ownerId).then((rows) => rows.map(toAttachmentResponse));
  }

  /** Number of clean images on a claim, for the photo-required rule. */
  async cleanImageCount(db: Db, ownerType: OwnerType, ownerId: string): Promise<number> {
    const rows = await this.repo.forOwner(db, ownerType, ownerId);
    return rows.filter((a) => a.scanStatus === "CLEAN" && IMAGE_MIME.has(a.mimeType)).length;
  }

  /**
   * Links uploaded attachments to their owner inside the caller's transaction. Every file must be the
   * caller's own, of the right owner type, unlinked, and scanned CLEAN (Section 8.2 rule 4).
   */
  async link(tx: Tx, user: AuthUser, ids: string[], ownerType: OwnerType, ownerId: string): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const rows = await this.repo.findMany(tx, unique);
    const invalid = unique.filter((id) => {
      const a = rows.find((r) => r.id === id);
      return (
        !a ||
        a.uploadedBy !== user.id ||
        a.ownerType !== ownerType ||
        (a.ownerId !== null && a.ownerId !== ownerId)
      );
    });
    if (invalid.length) {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_INVALID,
        "One or more files can't be attached here.",
        {
          attachmentIds: invalid.map((id) => `${id} is not one of your uploads for this ${ownerType}.`),
        },
      );
    }
    const notClean = rows.filter((a) => a.scanStatus !== "CLEAN");
    if (notClean.length) {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_NOT_CLEAN,
        "Some files are still being checked. Try again in a moment.",
        {
          attachmentIds: notClean.map((a) => `${a.fileName} is ${a.scanStatus.toLowerCase()}.`),
        },
      );
    }
    await this.repo.link(tx, unique, ownerId);
  }

  /**
   * Worker job: checks magic bytes and marks CLEAN / INFECTED. Idempotent.
   * TODO: call the AV engine (ClamAV sidecar or Defender for Storage) before marking CLEAN. [CONFIRM]
   * TODO: strip EXIF GPS before serving thumbnails. [CONFIRM] whether originals must be kept.
   */
  async scan(id: string): Promise<"CLEAN" | "INFECTED" | "SKIPPED"> {
    const attachment = await this.repo.findById(this.prisma, id);
    if (!attachment || attachment.scanStatus !== "PENDING") return "SKIPPED";
    const head = await this.storage.readStart(attachment.storageKey, SNIFF_BYTES);
    const ok = matchesSignature(attachment.mimeType, head);
    if (!ok) {
      await this.storage.delete(attachment.storageKey);
      this.logger.warn(
        { attachmentId: id, mime: attachment.mimeType },
        "Rejected upload: content doesn't match type",
      );
    }
    await this.repo.update(this.prisma, id, { scanStatus: ok ? "CLEAN" : "INFECTED" });
    return ok ? "CLEAN" : "INFECTED";
  }

  /** Raw row for the worker (imports read the CSV by storage key). */
  findRaw(id: string): Promise<Attachment | null> {
    return this.repo.findById(this.prisma, id);
  }

  private async getVisible(user: AuthUser, id: string): Promise<Attachment> {
    const attachment = await this.repo.findById(this.prisma, id);
    if (!attachment) throw AppError.notFound("Attachment");
    if (attachment.uploadedBy === user.id) return attachment;
    const visible =
      attachment.ownerId !== null &&
      (await this.repo.ownerVisible(this.prisma, attachment.ownerType, attachment.ownerId, {
        claim: claimScope(user),
        registration: registrationScope(user),
        rma: rmaScope(user),
      }));
    if (!visible) throw AppError.notFound("Attachment");
    return attachment;
  }
}
