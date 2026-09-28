import { normalizeBatchValue, normalizeSerialValue, SERIAL_PATTERN } from "@wms/domain";

// What the QR label on a product encodes: the registration page with the serial, model and batch filled in.
// A phone's camera app opens it directly (W2); the in-app scanner reads the same payload.

export interface QrPayload {
  serial: string;
  modelCode?: string;
  batchNumber?: string;
}

export function registerUrl(origin: string, serial: string, modelCode: string, batchNumber?: string): string {
  const url = new URL("/register", origin);
  url.searchParams.set("serial", serial);
  url.searchParams.set("model", modelCode);
  if (batchNumber) url.searchParams.set("batch", batchNumber);
  return url.toString();
}

/** Accepts the label URL or a bare serial number; returns null for anything else. */
export function parseQrPayload(text: string): QrPayload | null {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    const serial = normalizeSerialValue(url.searchParams.get("serial") ?? "");
    if (!SERIAL_PATTERN.test(serial)) return null;
    const model = url.searchParams.get("model")?.trim().toUpperCase();
    const batch = normalizeBatchValue(url.searchParams.get("batch") ?? "");
    return { serial, modelCode: model || undefined, ...(batch ? { batchNumber: batch } : {}) };
  } catch {
    const serial = normalizeSerialValue(raw);
    return SERIAL_PATTERN.test(serial) ? { serial } : null;
  }
}
