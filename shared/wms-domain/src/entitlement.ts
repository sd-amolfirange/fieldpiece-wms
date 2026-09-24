import type { Entitlement, IsoDate, PartType, Unit } from "./types";
import { currentPart, currentParts, isCovered, partWarranty } from "./warranty";

// Entitlement for a complaint on `unit`, decided by the WMS before the service visit:
// - Void or unregistered units: everything chargeable, no manufacturer claim;
// - while the UNIT warranty is active, it covers every part (and labour if the template says so);
// - after that, a part is covered while its own warranty is active and it covers parts;
// - labour follows the UNIT part only.

export function entitlementFor(
  unit: Pick<Unit, "parts" | "void">,
  today: IsoDate,
): Entitlement {
  const chargeable = (reason: Entitlement["reason"]): Entitlement => ({
    parts: "CHARGEABLE",
    labour: "CHARGEABLE",
    coveredPartTypes: [],
    claimable: false,
    reason,
  });

  if (unit.void) return chargeable("VOID");
  const fitted = currentParts(unit);
  if (!fitted.length) return chargeable("NOT_REGISTERED");

  const unitPart = currentPart(unit, "UNIT");
  const unitActive =
    !!unitPart && isCovered(partWarranty(unitPart, today).status);

  const covered = new Set<PartType>();
  for (const part of fitted) {
    const active = isCovered(partWarranty(part, today).status);
    if (unitActive && unitPart?.coversParts) covered.add(part.partType);
    else if (active && part.coversParts) covered.add(part.partType);
  }

  const parts = covered.size ? "COVERED" : "CHARGEABLE";
  const labour =
    unitActive && unitPart?.coversLabour ? "COVERED" : "CHARGEABLE";
  const coveredCount = [parts, labour].filter((c) => c === "COVERED").length;

  return {
    parts,
    labour,
    coveredPartTypes: fitted
      .map((p) => p.partType)
      .filter((t) => covered.has(t)),
    claimable: coveredCount > 0,
    reason:
      coveredCount === 2
        ? "FULL"
        : coveredCount === 1
          ? "PARTIAL"
          : "NOTHING_ACTIVE",
  };
}
