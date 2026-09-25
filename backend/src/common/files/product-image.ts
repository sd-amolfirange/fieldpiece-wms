// Product photos (ADR-008): stored under products/<SKU>/<uuid> and served by GET /products/{sku}/image.
// A new upload gets a new key, so the URL changes with it and browsers can cache each URL forever.

export const PRODUCT_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type ProductImageMime = (typeof PRODUCT_IMAGE_MIME)[number];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const productImageKey = (sku: string, id: string) => `products/${sku}/${id}`;

/** True only for a key this product could have been given, so an admin can't attach someone else's object. */
export const isProductImageKey = (sku: string, key: string) =>
  new RegExp(`^products/${sku.replace(/[^A-Z0-9-]/g, "")}/${UUID}$`).test(key);

/** The last key segment: changes on every upload, so it doubles as the cache-busting version and ETag. */
export const productImageVersion = (imageKey: string) => imageKey.slice(imageKey.lastIndexOf("/") + 1);

export function productImageUrl(
  api: { API_PUBLIC_URL: string; API_PREFIX: string },
  sku: string,
  imageKey: string | null,
): string | null {
  if (!imageKey) return null;
  const base = api.API_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/${api.API_PREFIX}/products/${encodeURIComponent(sku)}/image?v=${productImageVersion(imageKey)}`;
}
