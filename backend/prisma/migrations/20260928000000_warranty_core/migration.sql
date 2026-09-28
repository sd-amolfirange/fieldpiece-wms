-- Warranty-core redesign (docs/adr/ADR-012-warranty-core.md):
-- - Fieldpiece catalogue: product categories replace brands; one warranty per model, from the purchase date;
-- - registered products carry a batch number and their own warranty dates (part-level warranties removed);
-- - US addresses (state, ZIP) for customers, dealers and distributors;
-- - one warranty claim replaces complaint -> service job -> manufacturer claim; RMA numbers removed;
-- - new registration channels (WEB, API, RETAIL) and partner API clients.
--
-- The existing rows are demo data only: they are cleared here and reloaded by `npm run db:seed`.
-- A live system would need a data migration instead of this TRUNCATE.
TRUNCATE TABLE
  "notifications", "auth_sessions", "users", "claim_events", "claims", "job_results", "complaint_events",
  "complaints", "bulk_import_rows", "bulk_imports", "registrations", "unit_events", "unit_parts", "units",
  "integration_messages", "attachments", "customers", "dealers", "distributors", "model_parts", "models", "brands"
CASCADE;

-- DropForeignKey
ALTER TABLE "claim_events" DROP CONSTRAINT "claim_events_claim_id_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_brand_id_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_dealer_id_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_unit_serial_fkey";

-- DropForeignKey
ALTER TABLE "complaint_events" DROP CONSTRAINT "complaint_events_complaint_id_fkey";

-- DropForeignKey
ALTER TABLE "complaints" DROP CONSTRAINT "complaints_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "complaints" DROP CONSTRAINT "complaints_dealer_id_fkey";

-- DropForeignKey
ALTER TABLE "complaints" DROP CONSTRAINT "complaints_unit_serial_fkey";

-- DropForeignKey
ALTER TABLE "job_results" DROP CONSTRAINT "job_results_complaint_id_fkey";

-- DropForeignKey
ALTER TABLE "model_parts" DROP CONSTRAINT "model_parts_model_id_fkey";

-- DropForeignKey
ALTER TABLE "models" DROP CONSTRAINT "models_brand_id_fkey";

-- DropForeignKey
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "unit_parts" DROP CONSTRAINT "unit_parts_unit_serial_fkey";

-- DropForeignKey
ALTER TABLE "units" DROP CONSTRAINT "units_brand_id_fkey";

-- DropIndex
DROP INDEX "models_brand_id_idx";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "state" TEXT NOT NULL,
ADD COLUMN     "zip" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "dealers" ADD COLUMN     "state" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "state" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "models" DROP COLUMN "brand_id",
DROP COLUMN "capacity",
DROP COLUMN "type",
ADD COLUMN     "batch_pattern" TEXT NOT NULL,
ADD COLUMN     "category_id" TEXT NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "serial_pattern" TEXT NOT NULL,
ADD COLUMN     "warranty_months" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "registrations" DROP COLUMN "batch_id",
DROP COLUMN "install_date",
DROP COLUMN "location",
ADD COLUMN     "batch_number" TEXT,
ADD COLUMN     "customer_state" TEXT,
ADD COLUMN     "customer_zip" TEXT,
ADD COLUMN     "import_id" TEXT,
ADD COLUMN     "place_of_purchase" TEXT;

-- AlterTable
ALTER TABLE "units" DROP COLUMN "brand_id",
DROP COLUMN "install_date",
DROP COLUMN "location",
ADD COLUMN     "batch_number" TEXT,
ADD COLUMN     "place_of_purchase" TEXT,
ADD COLUMN     "replaced_by_serial" TEXT,
ADD COLUMN     "replaces_serial" TEXT,
ADD COLUMN     "warranty_end" DATE,
ADD COLUMN     "warranty_start" DATE;

-- DropTable
DROP TABLE "brands";

-- DropTable
DROP TABLE "claim_events";

-- DropTable
DROP TABLE "claims";

-- DropTable
DROP TABLE "complaint_events";

-- DropTable
DROP TABLE "complaints";

-- DropTable
DROP TABLE "job_results";

-- DropTable
DROP TABLE "model_parts";

-- DropTable
DROP TABLE "unit_parts";

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dealer_id" TEXT,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "partner_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" TEXT NOT NULL,
    "unit_serial" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "raised_by" TEXT NOT NULL,
    "raised_by_name" TEXT NOT NULL,
    "dealer_id" TEXT,
    "customer_id" TEXT,
    "issue_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "coverage" JSONB NOT NULL,
    "resolution" TEXT,
    "credit_amount" DECIMAL(12,2),
    "replacement_serial" TEXT,
    "replacement_batch_number" TEXT,
    "decision_note" TEXT,
    "reject_reason" TEXT,
    "reviewed_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_events" (
    "id" BIGSERIAL NOT NULL,
    "claim_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "warranty_claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_clients_key_hash_key" ON "partner_clients"("key_hash");

-- CreateIndex
CREATE INDEX "warranty_claims_status_created_at_idx" ON "warranty_claims"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "warranty_claims_created_at_idx" ON "warranty_claims"("created_at" DESC);

-- CreateIndex
CREATE INDEX "warranty_claims_dealer_id_idx" ON "warranty_claims"("dealer_id");

-- CreateIndex
CREATE INDEX "warranty_claims_customer_id_idx" ON "warranty_claims"("customer_id");

-- CreateIndex
CREATE INDEX "warranty_claims_unit_serial_idx" ON "warranty_claims"("unit_serial");

-- CreateIndex
CREATE INDEX "warranty_claims_attachment_ids_idx" ON "warranty_claims" USING GIN ("attachment_ids");

-- CreateIndex
CREATE INDEX "warranty_claim_events_claim_id_at_idx" ON "warranty_claim_events"("claim_id", "at");

-- CreateIndex
CREATE INDEX "models_category_id_idx" ON "models"("category_id");

-- CreateIndex
CREATE INDEX "units_warranty_end_idx" ON "units"("warranty_end");

-- CreateIndex
CREATE INDEX "units_batch_number_idx" ON "units"("batch_number");

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bulk_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_events" ADD CONSTRAINT "warranty_claim_events_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "warranty_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: checks Prisma can't express. Keep in step with shared/wms-domain/src/types.ts.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "models" ADD CONSTRAINT "models_warranty_months_check" CHECK ("warranty_months" BETWEEN 1 AND 120);
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_state_check" CHECK ("state" ~ '^[A-Z]{2}$');
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_state_check" CHECK ("state" ~ '^[A-Z]{2}$');
ALTER TABLE "customers" ADD CONSTRAINT "customers_state_check" CHECK ("state" = '' OR "state" ~ '^[A-Z]{2}$');

ALTER TABLE "units" DROP CONSTRAINT "units_void_reason_check";
ALTER TABLE "units" ADD CONSTRAINT "units_void_reason_check"
  CHECK ("void_reason" IS NULL OR "void_reason" IN ('UNAUTHORIZED_REPAIR', 'MISUSE', 'PHYSICAL_DAMAGE', 'OTHER'));
ALTER TABLE "units" ADD CONSTRAINT "units_warranty_dates_check"
  CHECK (("warranty_start" IS NULL) = ("warranty_end" IS NULL) AND ("warranty_end" IS NULL OR "warranty_end" >= "warranty_start"));

ALTER TABLE "unit_events" DROP CONSTRAINT "unit_events_type_check";
ALTER TABLE "unit_events" ADD CONSTRAINT "unit_events_type_check"
  CHECK ("type" IN ('registered', 'voided', 'claim_filed', 'claim_closed', 'replaced', 'note'));

ALTER TABLE "registrations" DROP CONSTRAINT "registrations_channel_check";
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_channel_check"
  CHECK ("channel" IN ('DEALER', 'BULK', 'PORTAL', 'WEB', 'EMAIL', 'ERP', 'API', 'RETAIL'));

ALTER TABLE "integration_messages" DROP CONSTRAINT "integration_messages_system_check";
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_system_check"
  CHECK ("system" IN ('ERP', 'EMAIL', 'PARTNER', 'CRM', 'FINANCE'));

ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_channel_check" CHECK ("channel" IN ('API', 'RETAIL', 'ERP'));

ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_source_check" CHECK ("source" IN ('CUSTOMER', 'DEALER', 'ADMIN'));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_status_check"
  CHECK ("status" IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_issue_type_check"
  CHECK ("issue_type" IN ('NO_POWER', 'INACCURATE_READING', 'DISPLAY', 'CONNECTIVITY', 'LEAK_OR_PRESSURE', 'MECHANICAL', 'OTHER'));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_resolution_check"
  CHECK ("resolution" IS NULL OR "resolution" IN ('REPAIR', 'REPLACE', 'CREDIT'));
-- Approved and closed claims say how they're settled; a credit has an amount; a rejection has a reason.
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_decided_check"
  CHECK ("status" NOT IN ('APPROVED', 'CLOSED') OR "resolution" IS NOT NULL);
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_credit_check"
  CHECK (("resolution" = 'CREDIT') = ("credit_amount" IS NOT NULL) AND ("credit_amount" IS NULL OR "credit_amount" > 0));
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_rejected_check"
  CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL);
ALTER TABLE "warranty_claim_events" ADD CONSTRAINT "warranty_claim_events_status_check"
  CHECK ("status" IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'));

-- Sequences of the removed service workflow.
DROP SEQUENCE IF EXISTS "id_seq_cmp";
DROP SEQUENCE IF EXISTS "id_seq_sr";
DROP SEQUENCE IF EXISTS "id_seq_job";
DROP SEQUENCE IF EXISTS "counter_newpart";

-- New tables get the app role's rights through the default privileges set in the first migration. Tables created
-- by a role other than the one that set them wouldn't, so grant explicitly as well.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "product_categories", "partner_clients", "warranty_claims",
      "warranty_claim_events" TO wms_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO wms_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_readonly') THEN
    GRANT SELECT ON "product_categories", "warranty_claims", "warranty_claim_events" TO wms_readonly;
  END IF;
END
$$;
