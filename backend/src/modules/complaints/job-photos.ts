import type { Complaint, PartType } from "@wms/domain";

// Stand-ins for what the service system sends back with a job result (A13 simulator).

export const PART_NAMES: Record<PartType, string> = { UNIT: "unit", COMPRESSOR: "compressor", PCB: "PCB" };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Placeholder job photo (SVG), stored as an attachment. Text is escaped; the file is served sandboxed. */
export function jobPhotoSvg(caption: string, serial: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="#e8e8e9"/><rect x="170" y="110" width="300" height="220" rx="24" fill="#8e8e8c"/>
<circle cx="320" cy="220" r="70" fill="#5e5e5c"/><text x="320" y="400" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#12130d">${esc(caption)}</text>
<text x="320" y="440" font-family="monospace" font-size="22" text-anchor="middle" fill="#3e3e3e">${esc(serial)}</text></svg>`;
}

/** Which part the technician replaces: the one asked for, else the first covered key part, else the compressor. */
export function partToReplace(
  complaint: Pick<Complaint, "entitlement">,
  requested?: PartType,
): Exclude<PartType, "UNIT"> {
  if (requested && requested !== "UNIT") return requested;
  const covered = complaint.entitlement.coveredPartTypes.find((p): p is "COMPRESSOR" | "PCB" => p !== "UNIT");
  return covered ?? "COMPRESSOR";
}

/** Serial of the replacement part, e.g. "CP-260925-01". */
export const newPartSerial = (partType: Exclude<PartType, "UNIT">, today: string, seq: number) =>
  `${partType === "PCB" ? "PCB" : "CP"}-${today.replace(/-/g, "").slice(2)}-${String(seq).padStart(2, "0")}`;
