import { Inject, Injectable } from "@nestjs/common";
import type { Attachment } from "@wms/domain";
import type { Readable } from "node:stream";
import type { Actor } from "../../common/auth/context";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import { matchesSignature } from "../../common/files/file-signature";
import type { UploadedFile } from "../../common/http/multipart";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { scopeWhere } from "../../domain/scope";
import { type AttachmentRow, toAttachment } from "../../domain/views";

/** Photos, videos and PDFs (api-contract §5.5). SVG is refused: it can carry script. */
const ALLOWED = /^(image\/|video\/|application\/pdf$)/;
const REFUSED = new Set(["image/svg+xml"]);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: BlobStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Public URL of a stored file, as Attachment.url (the frontend uses it in <img src> and links). */
  readonly fileUrl = (id: string) => `/${this.env.API_PREFIX}/files/${encodeURIComponent(id)}`;

  get maxUploadBytes(): number {
    return this.env.UPLOAD_MAX_BYTES;
  }

  get tooLargeMessage(): string {
    return `Files can be up to ${Math.round(this.env.UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`;
  }

  /** POST /uploads: checks type and content, stores the bytes, records the attachment. */
  async upload(user: Actor, file: UploadedFile | undefined, name: string | undefined, now: Date): Promise<Attachment> {
    if (!file || !file.buffer.length) throw AppError.validation("Choose a file to upload.");
    const mime = file.mime.toLowerCase();
    const unsupported = () => new AppError(415, "unsupported_type", "Upload a photo, video or PDF.");
    if (!ALLOWED.test(mime) || REFUSED.has(mime)) throw unsupported();
    if (file.buffer.length > this.env.UPLOAD_MAX_BYTES) throw new AppError(413, "too_large", this.tooLargeMessage);
    if (matchesSignature(mime, file.buffer.subarray(0, 32)) === false) throw unsupported();
    return this.store(this.prisma, { name: (name?.trim() || file.fileName).slice(0, 255), mime, buffer: file.buffer, uploadedBy: user.id }, now);
  }

  /** Stores bytes the system itself produced (simulator photos and invoices) or a checked upload. */
  async store(
    db: Db,
    input: { name: string; mime: string; buffer: Buffer; uploadedBy: string },
    now: Date,
  ): Promise<Attachment> {
    const id = await nextId(db, "ATT");
    const storageKey = `attachments/${id}`;
    await this.storage.put(storageKey, input.buffer, input.mime);
    const row = await db.attachment.create({
      data: {
        id,
        name: input.name,
        mime: input.mime,
        size: input.buffer.length,
        storageKey,
        uploadedBy: input.uploadedBy,
        createdAt: now,
      },
    });
    return toAttachment(row, this);
  }

  /** GET /files/:id: the uploader, admins, or anyone who can see a record that references the file. */
  async open(user: Actor, id: string): Promise<{ attachment: AttachmentRow; stream: Readable }> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment || !(await this.canView(user, attachment))) throw AppError.notFound("File");
    const stream = await this.storage.getStream(attachment.storageKey);
    if (!stream) throw AppError.notFound("File");
    return { attachment, stream };
  }

  private async canView(user: Actor, attachment: AttachmentRow): Promise<boolean> {
    if (user.role === "admin" || attachment.uploadedBy === user.id) return true;
    const scope = scopeWhere(user);
    const has = { has: attachment.id };
    const [registration, complaint, unit, job] = await Promise.all([
      this.prisma.registration.findFirst({ where: { attachmentIds: has, ...scope }, select: { id: true } }),
      this.prisma.complaint.findFirst({ where: { attachmentIds: has, ...scope }, select: { id: true } }),
      this.prisma.unit.findFirst({ where: { attachmentIds: has, ...scope }, select: { serial: true } }),
      this.prisma.jobResult.findFirst({ where: { photoIds: has, complaint: scope }, select: { id: true } }),
    ]);
    return !!(registration || complaint || unit || job);
  }

  /** Only files the caller uploaded (or any, for admins) can be linked to a new record. */
  async assertOwn(db: Db, user: Actor, ids: readonly string[] = []): Promise<void> {
    if (!ids.length) return;
    const rows = await db.attachment.findMany({ where: { id: { in: [...ids] } }, select: { id: true, uploadedBy: true } });
    const own = new Set(rows.filter((a) => user.role === "admin" || a.uploadedBy === user.id).map((a) => a.id));
    if (ids.some((id) => !own.has(id))) {
      throw new AppError(422, "invalid_attachment", "One of the files couldn't be found. Upload it again.");
    }
  }

  /** Attachment rows by id, for views. */
  async byIds(db: Db, ids: readonly string[]): Promise<Map<string, AttachmentRow>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await db.attachment.findMany({ where: { id: { in: unique } } });
    return new Map(rows.map((r) => [r.id, r]));
  }
}
