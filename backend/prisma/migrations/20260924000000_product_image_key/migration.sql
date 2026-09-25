-- Product photos move into our own object storage (ADR-008) and are served by GET /products/{sku}/image,
-- so the column now holds a storage key, not an external URL. Existing values were external URLs: drop them.
ALTER TABLE "products" RENAME COLUMN "image_url" TO "image_key";
UPDATE "products" SET "image_key" = NULL WHERE "image_key" IS NOT NULL;
ALTER TABLE "products"
  ADD CONSTRAINT "products_image_key_format" CHECK ("image_key" IS NULL OR "image_key" ~ '^products/[A-Z0-9-]+/[0-9a-f-]{36}$');
