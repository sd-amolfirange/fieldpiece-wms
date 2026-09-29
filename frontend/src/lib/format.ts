import { format, isValid, parseISO } from "date-fns";
import { enUS, es, fr } from "date-fns/locale";

// UI formatting rules (Section 3.6). Dates show in the US style, "Sep 23, 2026"; API payloads stay ISO 8601.

const dateLocales = { en: enUS, es, fr } as const;
type AppLanguage = keyof typeof dateLocales;

function toDate(value: string | Date): Date {
  return typeof value === "string" ? parseISO(value) : value;
}

function dateLocale(lang: string) {
  const base = lang.split("-")[0] as AppLanguage;
  return dateLocales[base] ?? enUS;
}

export function formatDate(value: string | Date | null | undefined, lang = "en"): string {
  if (!value) return "";
  const date = toDate(value);
  if (!isValid(date)) return "";
  return format(date, "PP", { locale: dateLocale(lang) });
}

export function formatDateTime(value: string | Date | null | undefined, lang = "en"): string {
  if (!value) return "";
  const date = toDate(value);
  if (!isValid(date)) return "";
  return format(date, "PP, p", { locale: dateLocale(lang) });
}

/** ISO date (yyyy-MM-dd) for API payloads and <input type="date">. */
export function toIsoDate(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

export function formatMoney(amount: number, currency: string, lang = "en"): string {
  return new Intl.NumberFormat(lang, { style: "currency", currency }).format(amount);
}

export function formatNumber(value: number, lang = "en", options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(lang, options).format(value);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function padId(prefix: string, id: string | number): string {
  const raw = String(id);
  if (raw.startsWith(`${prefix}-`)) return raw;
  return `${prefix}-${raw.padStart(6, "0")}`;
}

/** CLM-000123. Always render in the mono font. */
export const formatClaimId = (id: string | number) => padId("CLM", id);

/** Serial numbers: trimmed, uppercased, inner whitespace removed. */
export function normalizeSerial(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** "SC680-263510101": the model code and serial number as one label, wherever a product is listed. */
export function formatModelSerial(modelCode: string | undefined, serial: string): string {
  // Serials are stored MODEL-NUMBER; only an older bare number gets the model code added.
  return modelCode && !serial.startsWith(`${modelCode}-`) ? `${modelCode}-${serial}` : serial;
}
