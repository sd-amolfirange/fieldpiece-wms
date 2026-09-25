// Serial-number rules shared by registrations, the public lookup and imports (Section 8.2).
// [CONFIRM] the real serial formats per SKU with Fieldpiece.

export function normalizeSerial(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/**
 * Does this (normalised) serial belong to the product? Uses the product's regex when set, otherwise
 * falls back to the serial starting with the SKU.
 */
export function serialMatchesProduct(
  serial: string,
  product: { sku: string; serialPattern: string | null },
): boolean {
  if (product.serialPattern) return new RegExp(product.serialPattern).test(serial);
  return serial.startsWith(product.sku);
}
