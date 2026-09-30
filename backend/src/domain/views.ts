import type { Prisma } from "@prisma/client";
import {
  bulkCounts,
  unitWarranty,
  type Attachment,
  type BulkImportView,
  type BulkRow,
  type BulkRowStatus,
  type ClaimSource,
  type ClaimStatus,
  type Coverage,
  type DealerView,
  type IntegrationDirection,
  type IntegrationMessage,
  type IntegrationStatus,
  type IntegrationSystem,
  type IsoDate,
  type IssueType,
  type ModelView,
  type Notification,
  type RegistrationChannel,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationStatus,
  type RegistrationView,
  type Resolution,
  type RowErrors,
  type Unit,
  type UnitEvent,
  type UnitEventType,
  type UnitView,
  type VoidReason,
  type WarrantyClaimView,
  type WarrantyExtension,
} from "@wms/domain";
import type { Actor } from "../common/auth/context";
import { fromDbDate, fromDbDateOpt, opt } from "../common/db/dates";

// Database rows -> the API shapes in shared/wms-domain (views.ts), which the frontend reads. Absent values are
// omitted (never null), exactly as the domain's optional fields. Warranty status is always computed here, for
// "today", by the shared rules — the same functions the frontend and its tests use.

export interface ViewCtx {
  user: Actor;
  today: IsoDate;
  /** Public URL of a stored file (Attachment.url). */
  fileUrl: (id: string) => string;
}

const iso = (d: Date) => d.toISOString();
const isoOpt = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

/** Money columns (numeric) as numbers for the API; whole cents are exact in a double. */
export const moneyOf = (value: Prisma.Decimal): number => Number(value.toFixed(2));
const money = (value: Prisma.Decimal | null) => (value === null ? undefined : moneyOf(value));

// ── Attachments ───────────────────────────────────────────────────────────────

export type AttachmentRow = Prisma.AttachmentGetPayload<object>;

export const toAttachment = (row: AttachmentRow, vc: Pick<ViewCtx, "fileUrl">): Attachment => ({
  id: row.id,
  name: row.name,
  mime: row.mime,
  size: row.size,
  url: vc.fileUrl(row.id),
  uploadedBy: row.uploadedBy,
  createdAt: iso(row.createdAt),
});

/** Keeps the order of `ids` and drops ids with no row. */
export const attachmentsInOrder = (
  ids: readonly string[],
  byId: ReadonlyMap<string, AttachmentRow>,
  vc: Pick<ViewCtx, "fileUrl">,
): Attachment[] =>
  ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toAttachment(row, vc)] : [];
  });

// ── Catalogue and organisation ─────────────────────────────────────────────────

export const modelInclude = { category: true } satisfies Prisma.ModelInclude;
export type ModelRow = Prisma.ModelGetPayload<{ include: typeof modelInclude }>;

export const toModelView = (row: ModelRow): ModelView => ({
  id: row.id,
  code: row.code,
  categoryId: row.categoryId,
  name: row.name,
  description: row.description,
  imageUrl: row.imageUrl ?? undefined,
  warrantyMonths: row.warrantyMonths,
  serialPattern: row.serialPattern,
  batchPattern: row.batchPattern,
  listPrice: moneyOf(row.listPrice),
  repairCost: moneyOf(row.repairCost),
  warrantyBudget: moneyOf(row.warrantyBudget),
  claimQuota: row.claimQuota,
  categoryName: row.category.name,
});

type DealerRow = Prisma.DealerGetPayload<object>;

export const toDealer = (row: DealerRow) => ({
  id: row.id,
  name: row.name,
  city: row.city,
  state: row.state,
  distributorId: opt(row.distributorId),
});

export const toDealerView = (
  row: Prisma.DealerGetPayload<{ include: { distributor: true } }>,
): DealerView => ({
  ...toDealer(row),
  distributorName: opt(row.distributor?.name),
});

// ── Registered products ───────────────────────────────────────────────────────

export const unitInclude = {
  model: { include: { category: true } },
  dealer: true,
  customer: true,
  registration: { select: { channel: true } },
  events: { orderBy: { id: "asc" } },
  extensions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.UnitInclude;
export type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;

export const toWarrantyExtension = (e: Prisma.WarrantyExtensionGetPayload<object>): WarrantyExtension => ({
  id: e.id,
  months: e.months,
  price: moneyOf(e.price),
  previousEnd: fromDbDate(e.previousEnd),
  newEnd: fromDbDate(e.newEnd),
  soldBy: e.soldBy,
  soldByName: e.soldByName,
  dealerId: opt(e.dealerId),
  at: iso(e.createdAt),
});

type UnitEventRow = Prisma.UnitEventGetPayload<object>;

export const toUnitEvent = (e: UnitEventRow): UnitEvent => ({
  at: iso(e.at),
  type: e.type as UnitEventType,
  byName: e.byName,
  text: opt(e.text),
  reason: opt(e.reason) as VoidReason | undefined,
  refId: opt(e.refId),
});

type VoidColumns = Pick<UnitRow, "voidReason" | "voidNote" | "voidedBy" | "voidedByName" | "voidedAt">;

/** The void record of a stored product, if it was voided. */
export const voidRecordOf = (row: VoidColumns): Unit["void"] =>
  row.voidReason && row.voidedAt
    ? {
        reason: row.voidReason as VoidReason,
        note: opt(row.voidNote),
        by: row.voidedBy ?? "",
        byName: row.voidedByName ?? "",
        at: iso(row.voidedAt),
      }
    : undefined;

/** The stored product as the domain type, for the shared warranty rules. */
export function toUnit(row: Omit<UnitRow, "model" | "dealer" | "customer" | "registration">): Unit {
  return {
    serial: row.serial,
    batchNumber: opt(row.batchNumber),
    modelId: row.modelId,
    dealerId: opt(row.dealerId),
    customerId: opt(row.customerId),
    purchaseDate: fromDbDateOpt(row.purchaseDate),
    placeOfPurchase: opt(row.placeOfPurchase),
    warrantyStart: fromDbDateOpt(row.warrantyStart),
    warrantyEnd: fromDbDateOpt(row.warrantyEnd),
    void: voidRecordOf(row),
    registrationId: opt(row.registrationId),
    replacesSerial: opt(row.replacesSerial),
    replacedBySerial: opt(row.replacedBySerial),
    attachmentIds: row.attachmentIds,
    history: row.events.map(toUnitEvent),
    extensions: row.extensions.map(toWarrantyExtension),
  };
}

export function toUnitView(row: UnitRow, today: IsoDate): UnitView {
  const unit = toUnit(row);
  const warranty = unitWarranty(unit, today);
  return {
    ...unit,
    modelCode: row.model.code,
    modelName: row.model.name,
    modelDescription: row.model.description,
    modelImageUrl: opt(row.model.imageUrl),
    categoryName: row.model.category.name,
    dealerName: opt(row.dealer?.name),
    customerName: opt(row.customer?.name),
    status: warranty.status,
    daysRemaining: warranty.daysRemaining,
    registrationChannel: row.registration?.channel as RegistrationChannel | undefined,
  };
}

// ── Registrations ─────────────────────────────────────────────────────────────

export const registrationInclude = { dealer: true } satisfies Prisma.RegistrationInclude;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

/** `duplicateOf` (the existing product, for the A03 comparison) is shown to admins only. */
export function toRegistrationView(
  row: RegistrationRow,
  vc: Pick<ViewCtx, "user" | "today">,
  duplicateOf?: UnitRow | null,
  modelImages?: ReadonlyMap<string, string | undefined>,
): RegistrationView {
  return {
    id: row.id,
    channel: row.channel as RegistrationChannel,
    status: row.status as RegistrationStatus,
    flags: row.flags as RegistrationFlag[],
    serial: row.serial,
    batchNumber: opt(row.batchNumber),
    modelCode: row.modelCode,
    modelImageUrl: modelImages?.get(row.modelCode),
    customer: {
      name: row.customerName,
      phone: opt(row.customerPhone),
      email: opt(row.customerEmail),
      city: opt(row.customerCity),
      state: opt(row.customerState),
      zip: opt(row.customerZip),
    },
    customerId: opt(row.customerId),
    dealerId: opt(row.dealerId),
    purchaseDate: fromDbDateOpt(row.purchaseDate),
    invoiceNumber: opt(row.invoiceNumber),
    placeOfPurchase: opt(row.placeOfPurchase),
    attachmentIds: row.attachmentIds,
    submittedBy: row.submittedBy,
    submittedByName: row.submittedByName,
    submittedAt: iso(row.submittedAt),
    duplicateOfSerial: opt(row.duplicateOfSerial),
    rejectReason: opt(row.rejectReason),
    reviewedByName: opt(row.reviewedByName),
    reviewedAt: isoOpt(row.reviewedAt),
    importId: opt(row.importId),
    dealerName: opt(row.dealer?.name),
    duplicateOf: duplicateOf && vc.user.role === "admin" ? toUnitView(duplicateOf, vc.today) : undefined,
  };
}

// ── Bulk imports ──────────────────────────────────────────────────────────────

export const bulkImportInclude = {
  dealer: true,
  rows: { orderBy: { rowNumber: "asc" } },
} satisfies Prisma.BulkImportInclude;
export type BulkImportRowSet = Prisma.BulkImportGetPayload<{ include: typeof bulkImportInclude }>;

export function toBulkRow(row: Prisma.BulkImportRowGetPayload<object>): BulkRow {
  return {
    rowNumber: row.rowNumber,
    values: row.values as RegistrationRowInput,
    errors: row.errors as RowErrors,
    status: row.status as BulkRowStatus,
    registrationId: opt(row.registrationId),
  };
}

export function toBulkImportView(row: BulkImportRowSet): BulkImportView {
  const rows = row.rows.map(toBulkRow);
  return {
    id: row.id,
    fileName: row.fileName,
    dealerId: row.dealerId,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedByName,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    rows,
    dealerName: row.dealer.name,
    counts: bulkCounts(rows),
  };
}

// ── Warranty claims ───────────────────────────────────────────────────────────

export const claimInclude = {
  unit: { include: { model: { include: { category: true } } } },
  dealer: true,
  customer: true,
  events: { orderBy: { id: "asc" } },
} satisfies Prisma.WarrantyClaimInclude;
export type ClaimRow = Prisma.WarrantyClaimGetPayload<{ include: typeof claimInclude }>;

export function toClaimView(
  row: ClaimRow,
  attachments: ReadonlyMap<string, AttachmentRow>,
  vc: Pick<ViewCtx, "fileUrl" | "today">,
): WarrantyClaimView {
  const warranty = unitWarranty(
    {
      warrantyEnd: fromDbDateOpt(row.unit.warrantyEnd),
      void: voidRecordOf(row.unit),
      replacedBySerial: opt(row.unit.replacedBySerial),
    },
    vc.today,
  );
  return {
    id: row.id,
    unitSerial: row.unitSerial,
    source: row.source as ClaimSource,
    raisedBy: row.raisedBy,
    raisedByName: row.raisedByName,
    dealerId: opt(row.dealerId),
    customerId: opt(row.customerId),
    issueType: row.issueType as IssueType,
    description: row.description,
    attachmentIds: row.attachmentIds,
    status: row.status as ClaimStatus,
    coverage: row.coverage as unknown as Coverage,
    resolution: opt(row.resolution) as Resolution | undefined,
    creditAmount: money(row.creditAmount),
    replacementSerial: opt(row.replacementSerial),
    replacementBatchNumber: opt(row.replacementBatchNumber),
    decisionNote: opt(row.decisionNote),
    rejectReason: opt(row.rejectReason),
    reviewedByName: opt(row.reviewedByName),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    history: row.events.map((e) => ({
      at: iso(e.at),
      status: e.status as ClaimStatus,
      byName: e.byName,
      text: opt(e.text),
    })),
    batchNumber: opt(row.unit.batchNumber),
    modelCode: row.unit.model.code,
    modelName: row.unit.model.name,
    modelImageUrl: opt(row.unit.model.imageUrl),
    categoryName: row.unit.model.category.name,
    dealerName: opt(row.dealer?.name),
    customerName: opt(row.customer?.name),
    purchaseDate: fromDbDateOpt(row.unit.purchaseDate),
    warrantyEnd: fromDbDateOpt(row.unit.warrantyEnd),
    warrantyStatus: warranty.status,
    attachments: attachmentsInOrder(row.attachmentIds, attachments, vc),
  };
}

// ── Integration log and notifications ─────────────────────────────────────────

export const toIntegrationMessage = (
  row: Prisma.IntegrationMessageGetPayload<object>,
): IntegrationMessage => ({
  id: row.id,
  system: row.system as IntegrationSystem,
  direction: row.direction as IntegrationDirection,
  type: row.type,
  status: row.status as IntegrationStatus,
  payload: row.payload,
  attempts: row.attempts,
  lastError: opt(row.lastError),
  refId: opt(row.refId),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

export const toNotification = (row: Prisma.NotificationGetPayload<object>): Notification => ({
  id: row.id,
  userId: row.userId,
  key: row.key,
  params: (row.params as Record<string, string | number> | null) ?? undefined,
  link: opt(row.link),
  createdAt: iso(row.createdAt),
  read: row.read,
});
