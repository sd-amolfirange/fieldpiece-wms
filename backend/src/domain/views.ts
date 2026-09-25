import type { Prisma } from "@prisma/client";
import {
  partWarranty,
  unitWarranty,
  type Attachment,
  type BulkImportView,
  type BulkRow,
  type BulkRowStatus,
  type ClaimStatus,
  type ClaimView,
  type ComplaintSource,
  type ComplaintStatus,
  type ComplaintView,
  type DealerView,
  type Entitlement,
  type FinancePostingStatus,
  type IntegrationDirection,
  type IntegrationMessage,
  type IntegrationStatus,
  type IntegrationSystem,
  type IsoDate,
  type JobResultView,
  type ModelView,
  type Notification,
  type PartType,
  type RegistrationChannel,
  type RegistrationFlag,
  type RegistrationRowInput,
  type RegistrationStatus,
  type RegistrationView,
  type ReplacedPart,
  type RowErrors,
  type Unit,
  type UnitEvent,
  type UnitEventType,
  type UnitPart,
  type UnitView,
  type VoidReason,
  bulkCounts,
} from "@wms/domain";
import type { Actor } from "../common/auth/context";
import { fromDbDate, fromDbDateOpt, opt } from "../common/db/dates";
import { canSeeClaim } from "./scope";

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

/** Keeps the order of `ids` and drops ids with no row (as the mock does). */
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

export const modelInclude = {
  brand: true,
  parts: { orderBy: { position: "asc" } },
} satisfies Prisma.ModelInclude;
export type ModelRow = Prisma.ModelGetPayload<{ include: typeof modelInclude }>;

export const toModelView = (row: ModelRow): ModelView => ({
  id: row.id,
  code: row.code,
  brandId: row.brandId,
  name: row.name,
  capacity: row.capacity,
  type: row.type,
  parts: row.parts.map((p) => ({
    partType: p.partType as PartType,
    warrantyMonths: p.warrantyMonths,
    coversParts: p.coversParts,
    coversLabour: p.coversLabour,
    serialised: p.serialised,
  })),
  brandName: row.brand.name,
});

type DealerRow = Prisma.DealerGetPayload<object>;

export const toDealer = (row: DealerRow) => ({
  id: row.id,
  name: row.name,
  city: row.city,
  distributorId: opt(row.distributorId),
});

export const toDealerView = (row: Prisma.DealerGetPayload<{ include: { distributor: true } }>): DealerView => ({
  ...toDealer(row),
  distributorName: opt(row.distributor?.name),
});

// ── Units ─────────────────────────────────────────────────────────────────────

export const unitInclude = {
  model: { include: { brand: true } },
  dealer: true,
  customer: true,
  parts: { orderBy: { position: "asc" } },
  events: { orderBy: { id: "asc" } },
} satisfies Prisma.UnitInclude;
export type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;

type UnitPartRow = Prisma.UnitPartGetPayload<object>;
type UnitEventRow = Prisma.UnitEventGetPayload<object>;

export const toUnitPart = (p: UnitPartRow): UnitPart => ({
  id: p.id,
  partType: p.partType as PartType,
  serial: opt(p.serial),
  warrantyStart: fromDbDate(p.warrantyStart),
  warrantyEnd: fromDbDate(p.warrantyEnd),
  coversParts: p.coversParts,
  coversLabour: p.coversLabour,
  replacedAt: fromDbDateOpt(p.replacedAt),
  replacedBySerial: opt(p.replacedBySerial),
  replacesSerial: opt(p.replacesSerial),
});

export const toUnitEvent = (e: UnitEventRow): UnitEvent => ({
  at: iso(e.at),
  type: e.type as UnitEventType,
  byName: e.byName,
  text: opt(e.text),
  reason: opt(e.reason) as VoidReason | undefined,
  refId: opt(e.refId),
});

/** The stored unit as the domain type (parts, void, history), for the shared warranty and entitlement rules. */
export function toUnit(row: Omit<UnitRow, "model" | "dealer" | "customer">): Unit {
  return {
    serial: row.serial,
    modelId: row.modelId,
    brandId: row.brandId,
    dealerId: opt(row.dealerId),
    customerId: opt(row.customerId),
    location: opt(row.location),
    installDate: fromDbDateOpt(row.installDate),
    purchaseDate: fromDbDateOpt(row.purchaseDate),
    parts: row.parts.map(toUnitPart),
    void:
      row.voidReason && row.voidedAt
        ? {
            reason: row.voidReason as VoidReason,
            note: opt(row.voidNote),
            by: row.voidedBy ?? "",
            byName: row.voidedByName ?? "",
            at: iso(row.voidedAt),
          }
        : undefined,
    registrationId: opt(row.registrationId),
    attachmentIds: row.attachmentIds,
    history: row.events.map(toUnitEvent),
  };
}

export function toUnitView(row: UnitRow, today: IsoDate): UnitView {
  const unit = toUnit(row);
  const overall = unitWarranty(unit, today);
  return {
    ...unit,
    modelCode: row.model.code,
    modelName: row.model.name,
    capacity: row.model.capacity,
    unitType: row.model.type,
    brandName: row.model.brand.name,
    dealerName: opt(row.dealer?.name),
    customerName: opt(row.customer?.name),
    status: overall.status,
    daysRemaining: overall.daysRemaining,
    parts: unit.parts.map((part) => ({ ...part, ...partWarranty(part, today, { voided: !!unit.void }) })),
  };
}

// ── Registrations ─────────────────────────────────────────────────────────────

export const registrationInclude = { dealer: true } satisfies Prisma.RegistrationInclude;
export type RegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

/**
 * `duplicateOf` (the existing unit, for the A03 comparison) is shown to admins only, as in the mock.
 */
export function toRegistrationView(
  row: RegistrationRow,
  vc: Pick<ViewCtx, "user" | "today">,
  duplicateOf?: UnitRow | null,
): RegistrationView {
  return {
    id: row.id,
    channel: row.channel as RegistrationChannel,
    status: row.status as RegistrationStatus,
    flags: row.flags as RegistrationFlag[],
    serial: row.serial,
    modelCode: row.modelCode,
    customer: {
      name: row.customerName,
      phone: opt(row.customerPhone),
      email: opt(row.customerEmail),
      city: opt(row.customerCity),
    },
    customerId: opt(row.customerId),
    dealerId: opt(row.dealerId),
    installDate: fromDbDateOpt(row.installDate),
    purchaseDate: fromDbDateOpt(row.purchaseDate),
    invoiceNumber: opt(row.invoiceNumber),
    location: opt(row.location),
    attachmentIds: row.attachmentIds,
    submittedBy: row.submittedBy,
    submittedByName: row.submittedByName,
    submittedAt: iso(row.submittedAt),
    duplicateOfSerial: opt(row.duplicateOfSerial),
    rejectReason: opt(row.rejectReason),
    reviewedByName: opt(row.reviewedByName),
    reviewedAt: isoOpt(row.reviewedAt),
    batchId: opt(row.batchId),
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

// ── Job results (evidence on complaints and claims) ───────────────────────────

export type JobResultRow = Prisma.JobResultGetPayload<object>;

/** Job result with its photos and each new part's warranty end (read from the unit's replacement part). */
export function toJobResultView(
  job: JobResultRow,
  unitParts: readonly UnitPartRow[],
  attachments: ReadonlyMap<string, AttachmentRow>,
  vc: Pick<ViewCtx, "fileUrl">,
): JobResultView {
  const replaced = job.partsReplaced as unknown as ReplacedPart[];
  const photos = attachmentsInOrder(job.photoIds, attachments, vc);
  return {
    id: job.id,
    complaintId: job.complaintId,
    technician: job.technician,
    completedAt: iso(job.completedAt),
    partsReplaced: replaced.map((p) => {
      const end = unitParts.find((x) => x.serial === p.newSerial)?.warrantyEnd;
      return { ...p, newWarrantyEnd: end ? fromDbDate(end) : undefined };
    }),
    photoIds: job.photoIds,
    photos,
    signOffName: job.signOffName,
    notes: opt(job.notes),
  };
}

// ── Complaints ────────────────────────────────────────────────────────────────

export const complaintInclude = {
  unit: { include: { model: { include: { brand: true } }, parts: { orderBy: { position: "asc" } } } },
  dealer: true,
  customer: true,
  events: { orderBy: { id: "asc" } },
  jobResult: true,
} satisfies Prisma.ComplaintInclude;
export type ComplaintRow = Prisma.ComplaintGetPayload<{ include: typeof complaintInclude }>;

/** Everything a complaint view looks up besides its own row, loaded once per page. */
export interface ComplaintLookups {
  attachments: ReadonlyMap<string, AttachmentRow>;
  /** Claim id -> status and scope columns. */
  claims: ReadonlyMap<string, { status: string; dealerId: string | null }>;
}

export function toComplaintView(row: ComplaintRow, lookups: ComplaintLookups, vc: ViewCtx): ComplaintView {
  const claim = row.claimId ? lookups.claims.get(row.claimId) : undefined;
  return {
    id: row.id,
    unitSerial: row.unitSerial,
    source: row.source as ComplaintSource,
    raisedBy: row.raisedBy,
    raisedByName: row.raisedByName,
    dealerId: opt(row.dealerId),
    customerId: opt(row.customerId),
    description: row.description,
    attachmentIds: row.attachmentIds,
    status: row.status as ComplaintStatus,
    entitlement: row.entitlement as unknown as Entitlement,
    serviceRequestId: opt(row.serviceRequestId),
    jobResultId: opt(row.jobResultId),
    claimId: opt(row.claimId),
    createdAt: iso(row.createdAt),
    history: row.events.map((e) => ({
      at: iso(e.at),
      status: e.status as ComplaintStatus,
      byName: e.byName,
      text: opt(e.text),
    })),
    modelCode: row.unit.model.code,
    modelName: row.unit.model.name,
    brandName: row.unit.model.brand.name,
    dealerName: opt(row.dealer?.name),
    customerName: opt(row.customer?.name),
    attachments: attachmentsInOrder(row.attachmentIds, lookups.attachments, vc),
    jobResult: row.jobResult ? toJobResultView(row.jobResult, row.unit.parts, lookups.attachments, vc) : undefined,
    claimStatus:
      claim && canSeeClaim(vc.user, { dealerId: claim.dealerId }) ? (claim.status as ClaimStatus) : undefined,
  };
}

/** Attachment ids a page of complaints needs (their own files and the job photos). */
export const complaintAttachmentIds = (rows: readonly ComplaintRow[]) =>
  rows.flatMap((r) => [...r.attachmentIds, ...(r.jobResult?.photoIds ?? [])]);

// ── Claims ────────────────────────────────────────────────────────────────────

export const claimInclude = {
  brand: true,
  dealer: true,
  unit: { include: { model: true, customer: true, parts: { orderBy: { position: "asc" } } } },
  events: { orderBy: { id: "asc" } },
} satisfies Prisma.ClaimInclude;
export type ClaimRow = Prisma.ClaimGetPayload<{ include: typeof claimInclude }>;

export interface ClaimLookups {
  attachments: ReadonlyMap<string, AttachmentRow>;
  /** Complaint id -> description. */
  complaints: ReadonlyMap<string, string>;
  jobResults: ReadonlyMap<string, JobResultRow>;
}

export function toClaimView(row: ClaimRow, lookups: ClaimLookups, vc: ViewCtx): ClaimView {
  const job = row.jobResultId ? lookups.jobResults.get(row.jobResultId) : undefined;
  return {
    id: row.id,
    complaintId: opt(row.complaintId),
    unitSerial: row.unitSerial,
    brandId: row.brandId,
    dealerId: opt(row.dealerId),
    status: row.status as ClaimStatus,
    rmaNumber: opt(row.rmaNumber),
    amount: opt(row.amount),
    jobResultId: opt(row.jobResultId),
    photoIds: row.photoIds,
    partsReplaced: row.partsReplaced as unknown as ReplacedPart[],
    financePosting: row.financePosting as FinancePostingStatus,
    rejectReason: opt(row.rejectReason),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    history: row.events.map((e) => ({
      at: iso(e.at),
      status: e.status as ClaimStatus,
      byName: e.byName,
      text: opt(e.text),
    })),
    brandName: row.brand.name,
    dealerName: opt(row.dealer?.name),
    modelCode: row.unit.model.code,
    customerName: opt(row.unit.customer?.name),
    complaintDescription: row.complaintId ? lookups.complaints.get(row.complaintId) : undefined,
    jobResult: job ? toJobResultView(job, row.unit.parts, lookups.attachments, vc) : undefined,
  };
}

// ── Integration log and notifications ─────────────────────────────────────────

export const toIntegrationMessage = (row: Prisma.IntegrationMessageGetPayload<object>): IntegrationMessage => ({
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
