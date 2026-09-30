-- AlterTable
ALTER TABLE "models" ADD COLUMN     "claim_quota" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "list_price" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "repair_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "warranty_budget" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "warranty_extensions" (
    "id" TEXT NOT NULL,
    "unit_serial" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "previous_end" DATE NOT NULL,
    "new_end" DATE NOT NULL,
    "sold_by" TEXT NOT NULL,
    "sold_by_name" TEXT NOT NULL,
    "dealer_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warranty_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warranty_extensions_unit_serial_created_at_idx" ON "warranty_extensions"("unit_serial", "created_at");

-- CreateIndex
CREATE INDEX "warranty_extensions_created_at_idx" ON "warranty_extensions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "warranty_extensions_dealer_id_idx" ON "warranty_extensions"("dealer_id");

-- AddForeignKey
ALTER TABLE "warranty_extensions" ADD CONSTRAINT "warranty_extensions_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_extensions" ADD CONSTRAINT "warranty_extensions_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: backfill, checks, id sequence and grants. Keep in step with shared/wms-domain (types.ts, finance.ts).
-- ─────────────────────────────────────────────────────────────────────────────

-- Finance values of the existing catalogue (USD list prices; repair = 30 % and the yearly warranty budget = 2.5 x the
-- list price, 3 claims a year expected), as the seed sets them. [CONFIRM with Fieldpiece Finance]
UPDATE "models" m
SET "list_price" = p.list_price,
    "repair_cost" = ROUND(p.list_price * 0.3),
    "warranty_budget" = ROUND(p.list_price * 2.5),
    "claim_quota" = 3
FROM (VALUES
  ('SC680', 329), ('SC480', 239), ('SC260', 139), ('SM482V', 1199), ('SM382V', 899), ('JL3KH6', 749),
  ('VP87', 699), ('MR45', 1349), ('MG44', 189), ('DR82', 449), ('SRS1', 369), ('STA2', 299)
) AS p(code, list_price)
WHERE m."code" = p.code AND m."list_price" = 0;

ALTER TABLE "models" ADD CONSTRAINT "models_finance_check" CHECK (
  "list_price" >= 0 AND "repair_cost" >= 0 AND "warranty_budget" >= 0 AND "claim_quota" BETWEEN 0 AND 10000
);

ALTER TABLE "warranty_extensions" ADD CONSTRAINT "warranty_extensions_months_check" CHECK ("months" BETWEEN 1 AND 36);
ALTER TABLE "warranty_extensions" ADD CONSTRAINT "warranty_extensions_price_check" CHECK ("price" >= 0);
ALTER TABLE "warranty_extensions" ADD CONSTRAINT "warranty_extensions_dates_check" CHECK ("new_end" > "previous_end");

ALTER TABLE "unit_events" DROP CONSTRAINT "unit_events_type_check";
ALTER TABLE "unit_events" ADD CONSTRAINT "unit_events_type_check"
  CHECK ("type" IN ('registered', 'voided', 'claim_filed', 'claim_closed', 'replaced', 'extended', 'note'));

-- Readable ids ("EXT-1001"); src/common/db/ids.ts maps the prefix to this sequence.
CREATE SEQUENCE "id_seq_ext" START 1001;

-- New tables get the app role's rights through the default privileges set in the first migration. Tables created
-- by a role other than the one that set them wouldn't, so grant explicitly as well.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "warranty_extensions" TO wms_app;
    GRANT USAGE, SELECT, UPDATE ON SEQUENCE "id_seq_ext" TO wms_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_readonly') THEN
    GRANT SELECT ON "warranty_extensions" TO wms_readonly;
  END IF;
END
$$;
