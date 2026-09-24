import { addMonthsIso, daysBetween } from "./dates";
import type { IsoDate, Model, ModelPart, PartType, Unit, UnitPart, WarrantyStatus } from "./types";

// Warranty rules (docs/Demo workflows.md):
// - every part has its own warranty: end = start + the model template's months, compared with today;
// - the end day itself is still covered;
// - "Expiring soon" means 30 days or fewer remain;
// - Void overrides everything;
// - a replacement part starts a fresh warranty on the replacement date.

export const EXPIRING_SOON_DAYS = 30;

export interface PartWarranty {
  status: WarrantyStatus;
  daysRemaining: number;
}

export function partWarranty(
  part: Pick<UnitPart, "warrantyEnd" | "replacedAt">,
  today: IsoDate,
  { voided = false }: { voided?: boolean } = {},
): PartWarranty {
  if (voided) return { status: "VOID", daysRemaining: 0 };
  if (part.replacedAt) return { status: "EXPIRED", daysRemaining: 0 };
  const days = daysBetween(today, part.warrantyEnd);
  if (days < 0) return { status: "EXPIRED", daysRemaining: 0 };
  return { status: days <= EXPIRING_SOON_DAYS ? "EXPIRING_SOON" : "ACTIVE", daysRemaining: days };
}

/** Parts currently fitted (replaced parts stay on the unit as history). */
export const currentParts = (unit: Pick<Unit, "parts">) => unit.parts.filter((p) => !p.replacedAt);

export const currentPart = (unit: Pick<Unit, "parts">, partType: PartType) =>
  currentParts(unit).find((p) => p.partType === partType);

export const isCovered = (status: WarrantyStatus) => status === "ACTIVE" || status === "EXPIRING_SOON";

/** Overall unit status: the UNIT part's warranty, Void, or Pending when the unit isn't registered yet. */
export function unitWarranty(unit: Pick<Unit, "parts" | "void">, today: IsoDate): PartWarranty {
  if (unit.void) return { status: "VOID", daysRemaining: 0 };
  const unitPart = currentPart(unit, "UNIT");
  if (!unitPart) return { status: "PENDING", daysRemaining: 0 };
  return partWarranty(unitPart, today);
}

/** Warranty starts at installation when known, otherwise at purchase (docs: "usually from the installation date"). */
export const warrantyStartDate = (unit: Pick<Unit, "installDate" | "purchaseDate">) =>
  unit.installDate ?? unit.purchaseDate;

function partFromTemplate(line: ModelPart, id: string, start: IsoDate, serial?: string): UnitPart {
  return {
    id,
    partType: line.partType,
    serial: line.serialised ? serial : undefined,
    warrantyStart: start,
    warrantyEnd: addMonthsIso(start, line.warrantyMonths),
    coversParts: line.coversParts,
    coversLabour: line.coversLabour,
  };
}

/** Selecting a model attaches every part of its template, each with its own warranty period. */
export function buildUnitParts(
  model: Pick<Model, "parts">,
  start: IsoDate,
  { serials = {}, idPrefix }: { serials?: Partial<Record<PartType, string>>; idPrefix: string },
): UnitPart[] {
  return model.parts.map((line) =>
    partFromTemplate(line, `${idPrefix}-${line.partType.toLowerCase()}`, start, serials[line.partType]),
  );
}

/** Closes the fitted part of `partType` and adds the replacement with a fresh warranty from `date`. */
export function replacePart(
  parts: UnitPart[],
  line: ModelPart,
  { newSerial, date, newId }: { newSerial: string; date: IsoDate; newId: string },
): UnitPart[] {
  const old = parts.find((p) => p.partType === line.partType && !p.replacedAt);
  const replacement: UnitPart = {
    ...partFromTemplate({ ...line, serialised: true }, newId, date, newSerial),
    replacesSerial: old?.serial,
  };
  return [
    ...parts.map((p) => (p === old ? { ...p, replacedAt: date, replacedBySerial: newSerial } : p)),
    replacement,
  ];
}
