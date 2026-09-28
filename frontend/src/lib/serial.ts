import { normalizeSerial } from "./format";

/** Generic serial format: 6-20 letters, digits or dashes (e.g. 251406233). Each model has its own, stricter one. */
export const DEFAULT_SERIAL_PATTERN = "^[A-Z0-9-]{6,20}$";

export function isValidSerial(value: string, pattern: string = DEFAULT_SERIAL_PATTERN): boolean {
  return new RegExp(pattern).test(normalizeSerial(value));
}
