import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  bulkCounts,
  hasErrors,
  needsAdminReview,
  normalizeSerialValue,
  type BulkImportView,
  type BulkRowStatus,
  type RegistrationRowInput,
} from "@wms/domain";
import type { Ctx } from "../../common/auth/context";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import type { UploadedFile } from "../../common/http/multipart";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { dealerIdFor, requireRole } from "../../domain/scope";
import { bulkImportInclude, toBulkImportView, toBulkRow } from "../../domain/views";
import { CatalogService } from "../catalog";
import { Notifier } from "../notifications";
import { rowInput, rowToFields } from "./registration-input";
import { RegistrationsService } from "./registrations.service";
import { readSheet, rowsFromMatrix } from "./sheets";

// DL02 bulk import (api-contract §5.4): every row is checked against the product master; clean rows are registered
// at once, a serial that's already registered goes to admin review, anything else waits for an inline fix.
// Each row is decided in its own transaction, so a large file never holds one long transaction.

interface RowToProcess {
  rowNumber: number;
  values: RegistrationRowInput;
}

@Injectable()
export class BulkImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly registrations: RegistrationsService,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get maxBytes(): number {
    return this.env.BULK_IMPORT_MAX_BYTES;
  }

  get tooLargeMessage(): string {
    return `Sheets can be up to ${Math.round(this.env.BULK_IMPORT_MAX_BYTES / (1024 * 1024))} MB.`;
  }

  async create(
    ctx: Ctx,
    file: UploadedFile | undefined,
    fields: { name?: string; dealerId?: string },
  ): Promise<BulkImportView> {
    requireRole(ctx.user, "admin", "dealer", "distributor");
    if (!file) throw AppError.validation("Choose a file to upload.");
    const fileName = (fields.name?.trim() || file.fileName).slice(0, 255);
    if (!/\.(xlsx|csv)$/i.test(fileName)) {
      throw new AppError(415, "unsupported_type", "Upload an Excel (.xlsx) or CSV file.");
    }
    let values: RegistrationRowInput[];
    try {
      values = rowsFromMatrix(await readSheet(fileName, file.buffer));
    } catch {
      throw new AppError(415, "unsupported_type", "The file couldn't be read. Use the template and try again.");
    }
    const dealerId = dealerIdFor(ctx.user, fields.dealerId?.trim() || undefined, await this.catalog.dealerIds());
    if (!values.length) throw new AppError(422, "empty_file", "The file has no rows. Use the template and try again.");
    if (values.length > this.env.BULK_IMPORT_MAX_ROWS) {
      throw AppError.validation(`The file has more than ${this.env.BULK_IMPORT_MAX_ROWS} rows. Split it and try again.`);
    }

    const id = await nextId(this.prisma, "BLK");
    await this.prisma.bulkImport.create({
      data: {
        id,
        fileName,
        dealerId,
        uploadedBy: ctx.user.id,
        uploadedByName: ctx.user.name,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        rows: {
          createMany: {
            data: values.map((v, i) => ({ rowNumber: i + 2, values: v as Prisma.InputJsonValue, errors: {}, status: "ERROR" })),
          },
        },
      },
    });
    await this.processRows(ctx, id, dealerId, values.map((v, i) => ({ rowNumber: i + 2, values: v })), "REGISTERED");
    return this.get(ctx, id);
  }

  async list(ctx: Ctx): Promise<BulkImportView[]> {
    requireRole(ctx.user, "admin", "dealer", "distributor");
    const allowed = ctx.user.visibleDealerIds;
    const rows = await this.prisma.bulkImport.findMany({
      where: allowed === null ? {} : { dealerId: { in: allowed } },
      include: bulkImportInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map(toBulkImportView);
  }

  async get(ctx: Ctx, id: string): Promise<BulkImportView> {
    requireRole(ctx.user, "admin", "dealer", "distributor");
    const batch = await this.prisma.bulkImport.findUnique({ where: { id }, include: bulkImportInclude });
    const allowed = ctx.user.visibleDealerIds;
    if (!batch || (allowed !== null && !allowed.includes(batch.dealerId))) throw AppError.notFound("Upload");
    return toBulkImportView(batch);
  }

  /** Re-checks only the fixed rows, in place: no re-upload of the whole file. */
  async resubmit(ctx: Ctx, id: string, rawRows: unknown): Promise<BulkImportView> {
    const batch = await this.get(ctx, id);
    const updates = Array.isArray(rawRows) ? rawRows.slice(0, this.env.BULK_IMPORT_MAX_ROWS) : [];
    const rows: RowToProcess[] = [];
    for (const update of updates) {
      const u = (update ?? {}) as { rowNumber?: unknown; values?: unknown };
      const row = batch.rows.find((r) => r.rowNumber === u.rowNumber && r.status === "ERROR");
      if (!row || rows.some((r) => r.rowNumber === row.rowNumber)) continue;
      rows.push({ rowNumber: row.rowNumber, values: { ...row.values, ...rowInput(u.values) } });
    }
    await this.processRows(ctx, id, batch.dealerId, rows, "FIXED");
    return this.get(ctx, id);
  }

  private async processRows(
    ctx: Ctx,
    batchId: string,
    dealerId: string,
    rows: RowToProcess[],
    success: BulkRowStatus,
  ): Promise<void> {
    // Serials already accepted from this file (registered or sent to review) count as "seen" for duplicates.
    const others = await this.prisma.bulkImportRow.findMany({
      where: { importId: batchId, status: { not: "ERROR" }, rowNumber: { notIn: rows.map((r) => r.rowNumber) } },
      select: { values: true },
    });
    const seen = new Set(others.map((r) => normalizeSerialValue((r.values as RegistrationRowInput).serial)));

    for (const row of rows) {
      await this.prisma.tx(async (tx) => {
        const context = await this.registrations.rowContext(tx, ctx.today, row.values.serial, seen);
        const errors = this.registrations.validateRow(row.values, context);
        const fields = rowToFields(row.values);
        const extra = { dealerId, purchaseDate: fields.installDate, batchId };
        const by = { id: ctx.user.id, name: ctx.user.name };
        let status: BulkRowStatus;
        let registrationId: string | undefined;
        if (needsAdminReview(errors)) {
          registrationId = await this.registrations.insert(tx, { ...fields, ...extra, duplicateOfSerial: fields.serial }, "BULK", by, ctx.now);
          await this.registrations.sendToReview(tx, registrationId, fields.serial, ["DUPLICATE", "EXCEPTION"], ctx.now);
          status = "REVIEW";
        } else if (hasErrors(errors)) {
          status = "ERROR";
        } else {
          const customerId = await this.registrations.customerIdFor(tx, fields.customer, ctx.now);
          registrationId = await this.registrations.insert(tx, { ...fields, ...extra, customerId }, "BULK", by, ctx.now);
          await this.registrations.approve(tx, ctx, registrationId, "Auto-approved (dealer bulk upload)", {
            notifyDealer: false,
          });
          status = success;
        }
        await tx.bulkImportRow.update({
          where: { importId_rowNumber: { importId: batchId, rowNumber: row.rowNumber } },
          data: {
            values: row.values as Prisma.InputJsonValue,
            errors: (status === "ERROR" || status === "REVIEW" ? errors : {}),
            status,
            registrationId: registrationId ?? null,
          },
        });
      });
      seen.add(normalizeSerialValue(row.values.serial));
    }

    const batch = await this.prisma.bulkImport.update({
      where: { id: batchId },
      data: { updatedAt: ctx.now },
      include: { rows: true },
    });
    const counts = bulkCounts(batch.rows.map(toBulkRow));
    await this.notifier.notify(this.prisma, [ctx.user.id], "bulk_processed", ctx.now, {
      params: { file: batch.fileName, registered: counts.registered, errors: counts.errors, review: counts.review },
      link: `/registrations/bulk?batch=${batchId}`,
    });
  }
}
