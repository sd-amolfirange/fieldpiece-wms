import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthUser, RequestContext } from "../../common/auth/auth-user";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { Clock } from "../../common/time/clock";
import { parseIsoDate } from "../../common/time/utc-date";
import { addressSchema, emailSchema, isoDateString, serialNumber } from "../../common/validation/schemas";
import type { DomainEvent } from "../../infra/outbox/outbox.service";
import { OutboxService } from "../../infra/outbox/outbox.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { BlobStorage } from "../../infra/storage/blob-storage";
import { AttachmentsService } from "../attachments";
import { AuditService } from "../audit";
import { PoliciesService } from "../policies";
import { computeWarranty } from "../warranty";
import type { ImportStatus } from "./dto";
import { checkRegistrationRules } from "./registration-rules";

// Bulk registration import (build guide Section 8.6).

export const MAX_IMPORT_ROWS = 10_000;
const BATCH_SIZE = 500;
const STATUS_TTL_SECONDS = 7 * 24 * 3600;
const statusKey = (jobId: string) => `import:${jobId}`;

/** One CSV row. Same validation as the single endpoint, flattened. Download the template for headers. */
const rowSchema = z.object({
  serialNumber,
  sku: z.string().trim().toUpperCase().min(1),
  purchaseDate: isoDateString,
  contactName: z.string().trim().min(1).max(160),
  companyName: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => v || null),
  email: z
    .union([z.literal(""), emailSchema])
    .optional()
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  line1: addressSchema.shape.line1,
  line2: z.string().trim().max(200).optional(),
  city: addressSchema.shape.city,
  region: addressSchema.shape.region,
  postalCode: addressSchema.shape.postalCode,
  country: addressSchema.shape.country,
});
type ImportRow = z.infer<typeof rowSchema>;

export const IMPORT_TEMPLATE_HEADERS = Object.keys(rowSchema.shape);

export interface ImportJob {
  jobId: string;
  attachmentId: string;
  userId: string;
  organizationId: string | null;
}

interface StoredStatus extends Record<string, string> {
  state: ImportStatus["state"];
  userId: string;
  total: string;
  processed: string;
  succeeded: string;
  failed: string;
  message: string;
  errorKey: string;
}

@Injectable()
export class RegistrationImportService {
  private readonly logger = new Logger(RegistrationImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: BlobStorage,
    private readonly attachments: AttachmentsService,
    private readonly policies: PoliciesService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ── API side ─────────────────────────────────────────────────────

  async start(ctx: RequestContext, attachmentId: string): Promise<ImportStatus> {
    const attachment = await this.attachments.findRaw(attachmentId);
    if (!attachment || attachment.uploadedBy !== ctx.user.id || attachment.ownerType !== "import") {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_INVALID,
        "Upload the CSV first, then start the import.",
      );
    }
    if (attachment.scanStatus !== "CLEAN") {
      throw AppError.unprocessable(
        ErrorCode.ATTACHMENT_NOT_CLEAN,
        "The file is still being checked. Try again in a moment.",
      );
    }
    const jobId = randomUUID();
    await this.writeStatus(jobId, {
      state: "queued",
      userId: ctx.user.id,
      total: "0",
      processed: "0",
      succeeded: "0",
      failed: "0",
      message: "",
      errorKey: "",
    });
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.add(tx, {
        aggregate: "import",
        aggregateId: jobId,
        type: "registration.import_requested",
        payload: { jobId, attachmentId, userId: ctx.user.id, organizationId: ctx.user.organizationId },
      });
      await this.audit.record(tx, ctx, {
        action: "registration.import_requested",
        entity: "import",
        entityId: jobId,
        after: { attachmentId },
      });
    });
    return this.status(ctx.user, jobId);
  }

  async status(user: AuthUser, jobId: string): Promise<ImportStatus> {
    let raw: Record<string, string>;
    try {
      raw = await this.redis.client.hgetall(statusKey(jobId));
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        "Import status is unavailable right now.",
      );
    }
    if (!raw.state || (raw.userId !== user.id && !user.has("admin"))) throw AppError.notFound("Import");
    const errorReportUrl = raw.errorKey
      ? await this.storage.presignGet({
          key: raw.errorKey,
          expiresInSeconds: 300,
          downloadName: `import-errors-${jobId}.csv`,
        })
      : null;
    return {
      jobId,
      state: raw.state as ImportStatus["state"],
      total: Number(raw.total ?? 0),
      processed: Number(raw.processed ?? 0),
      succeeded: Number(raw.succeeded ?? 0),
      failed: Number(raw.failed ?? 0),
      message: raw.message || null,
      errorReportUrl,
    };
  }

  // ── Worker side ──────────────────────────────────────────────────

  /** Streams the CSV (never loads it all into memory), validates each row, inserts valid rows in batches. */
  async run(job: ImportJob): Promise<void> {
    const attachment = await this.attachments.findRaw(job.attachmentId);
    if (!attachment) return this.fail(job.jobId, "The uploaded file is gone. Upload it again.");
    await this.redis.client.hset(statusKey(job.jobId), { state: "running" });

    const today = this.clock.now();
    const products = new Map(
      (await this.prisma.product.findMany({ where: { deletedAt: null, isActive: true } })).map((p) => [
        p.sku,
        p,
      ]),
    );
    const errors: { line: number; serialNumber: string; error: string }[] = [];
    const seen = new Set<string>();
    let batch: { line: number; row: ImportRow; productId: string }[] = [];
    let total = 0;
    let succeeded = 0;

    const flush = async () => {
      if (!batch.length) return;
      const inserted = await this.insertBatch(job, batch, today, errors);
      succeeded += inserted;
      batch = [];
      await this.redis.client.hset(statusKey(job.jobId), {
        processed: String(total),
        succeeded: String(succeeded),
        failed: String(errors.length),
      });
    };

    const parser = (await this.storage.getStream(attachment.storageKey)).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }),
    );
    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      total += 1;
      const line = total + 1; // header is line 1
      if (total > MAX_IMPORT_ROWS) {
        await flush();
        return this.fail(
          job.jobId,
          `Files can have up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows. Split the file and try again.`,
        );
      }
      const parsed = rowSchema.safeParse(record);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        errors.push({
          line,
          serialNumber: record.serialNumber ?? "",
          error: `${issue?.path.join(".")}: ${issue?.message}`,
        });
        continue;
      }
      const row = parsed.data;
      const product = products.get(row.sku) ?? null;
      const violation = checkRegistrationRules({
        serial: row.serialNumber,
        purchaseDate: parseIsoDate(row.purchaseDate),
        today,
        product,
      });
      const dupKey = `${row.sku}:${row.serialNumber}`;
      if (violation || !product) {
        errors.push({
          line,
          serialNumber: row.serialNumber,
          error: violation?.message ?? "Unknown product.",
        });
      } else if (seen.has(dupKey)) {
        errors.push({
          line,
          serialNumber: row.serialNumber,
          error: "This serial appears more than once in the file.",
        });
      } else {
        seen.add(dupKey);
        batch.push({ line, row, productId: product.id });
        if (batch.length >= BATCH_SIZE) await flush();
      }
    }
    await flush();

    let errorKey = "";
    if (errors.length) {
      errorKey = `imports/${job.jobId}/errors.csv`;
      const csv = stringify(errors, { header: true, columns: ["line", "serialNumber", "error"] });
      await this.storage.put(errorKey, Buffer.from(csv, "utf8"), "text/csv");
    }
    await this.redis.client.hset(statusKey(job.jobId), {
      state: "completed",
      total: String(total),
      processed: String(total),
      succeeded: String(succeeded),
      failed: String(errors.length),
      errorKey,
    });
    this.logger.log({ jobId: job.jobId, total, succeeded, failed: errors.length }, "Import finished");
  }

  /**
   * Inserts one batch in a transaction with ON CONFLICT DO NOTHING on the active-serial index, then emits
   * outbox events for the rows that actually landed.
   */
  private async insertBatch(
    job: ImportJob,
    batch: { line: number; row: ImportRow; productId: string }[],
    today: Date,
    errors: { line: number; serialNumber: string; error: string }[],
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.registration.findMany({
        where: {
          status: "ACTIVE",
          OR: batch.map((b) => ({
            productId: b.productId,
            serialNumber: { equals: b.row.serialNumber, mode: "insensitive" as const },
          })),
        },
        select: { productId: true, serialNumber: true },
      });
      const taken = new Set(existing.map((e) => `${e.productId}:${e.serialNumber.toUpperCase()}`));

      const customers: Prisma.CustomerCreateManyInput[] = [];
      const registrations: (Prisma.RegistrationCreateManyInput & { id: string })[] = [];
      for (const { line, row, productId } of batch) {
        if (taken.has(`${productId}:${row.serialNumber}`)) {
          errors.push({ line, serialNumber: row.serialNumber, error: "This unit is already registered." });
          continue;
        }
        const policy = await this.policies.policyFor(tx, productId, parseIsoDate(row.purchaseDate));
        if (!policy) {
          errors.push({
            line,
            serialNumber: row.serialNumber,
            error: "No warranty policy covers this purchase date.",
          });
          continue;
        }
        const warranty = computeWarranty({
          purchaseDate: parseIsoDate(row.purchaseDate),
          registeredAt: today,
          policy,
        });
        const customerId = randomUUID();
        customers.push({
          id: customerId,
          distributorId: job.organizationId,
          companyName: row.companyName,
          contactName: row.contactName,
          email: row.email,
          phone: row.phone,
          address: {
            line1: row.line1,
            line2: row.line2,
            city: row.city,
            region: row.region,
            postalCode: row.postalCode,
            country: row.country,
          },
        });
        registrations.push({
          id: randomUUID(),
          serialNumber: row.serialNumber,
          productId,
          customerId,
          distributorId: job.organizationId,
          policyId: policy.id,
          purchaseDate: parseIsoDate(row.purchaseDate),
          warrantyStart: warranty.start,
          warrantyEnd: warranty.end,
          createdBy: job.userId,
        });
      }
      if (!registrations.length) return 0;

      await tx.customer.createMany({ data: customers });
      await tx.registration.createMany({ data: registrations, skipDuplicates: true });
      // A parallel request can still win the race; only emit events for rows that landed.
      const landed = await tx.registration.findMany({
        where: { id: { in: registrations.map((r) => r.id) } },
        select: { id: true },
      });
      const events: DomainEvent[] = landed.map((r) => ({
        aggregate: "registration",
        aggregateId: r.id,
        type: "registration.created",
        payload: { registrationId: r.id, importJobId: job.jobId },
      }));
      await this.outbox.addMany(tx, events);
      await this.audit.record(tx, null, {
        action: "registration.imported",
        entity: "import",
        entityId: job.jobId,
        after: { count: landed.length, byUser: job.userId },
      });
      return landed.length;
    });
  }

  private async fail(jobId: string, message: string): Promise<void> {
    await this.redis.client.hset(statusKey(jobId), { state: "failed", message });
  }

  private async writeStatus(jobId: string, status: StoredStatus): Promise<void> {
    try {
      await this.redis.client
        .multi()
        .hset(statusKey(jobId), status)
        .expire(statusKey(jobId), STATUS_TTL_SECONDS)
        .exec();
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        "Imports are unavailable right now. Try again shortly.",
      );
    }
  }
}
