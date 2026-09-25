// Carrier auto-detection from a tracking number (frontend Section 8.6). Pure; best-effort heuristics.
// TODO: replace with the carrier tracking API once chosen. [CONFIRM integrations]

export type Carrier = "UPS" | "FedEx" | "USPS" | "DHL";

export function detectCarrier(trackingNumber: string): Carrier | null {
  const t = trackingNumber.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "UPS";
  if (/^(94|93|92|95)\d{18,20}$/.test(t) || /^[A-Z]{2}\d{9}US$/.test(t)) return "USPS";
  if (/^\d{12}$|^\d{15}$|^\d{20}$/.test(t)) return "FedEx";
  if (/^\d{10}$/.test(t)) return "DHL";
  return null;
}
