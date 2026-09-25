-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_parts" (
    "model_id" TEXT NOT NULL,
    "part_type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "warranty_months" INTEGER NOT NULL,
    "covers_parts" BOOLEAN NOT NULL,
    "covers_labour" BOOLEAN NOT NULL,
    "serialised" BOOLEAN NOT NULL,

    CONSTRAINT "model_parts_pkey" PRIMARY KEY ("model_id","part_type")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "distributor_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dealers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT NOT NULL,
    "phone_key" TEXT,
    "email_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dealer_id" TEXT,
    "distributor_id" TEXT,
    "customer_id" TEXT,
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "serial" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "customer_id" TEXT,
    "location" TEXT,
    "install_date" DATE,
    "purchase_date" DATE,
    "registration_id" TEXT,
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "void_reason" TEXT,
    "void_note" TEXT,
    "voided_by" TEXT,
    "voided_by_name" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("serial")
);

-- CreateTable
CREATE TABLE "unit_parts" (
    "id" TEXT NOT NULL,
    "unit_serial" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "part_type" TEXT NOT NULL,
    "serial" TEXT,
    "warranty_start" DATE NOT NULL,
    "warranty_end" DATE NOT NULL,
    "covers_parts" BOOLEAN NOT NULL,
    "covers_labour" BOOLEAN NOT NULL,
    "replaced_at" DATE,
    "replaced_by_serial" TEXT,
    "replaces_serial" TEXT,

    CONSTRAINT "unit_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_events" (
    "id" BIGSERIAL NOT NULL,
    "unit_serial" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "type" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "text" TEXT,
    "reason" TEXT,
    "ref_id" TEXT,

    CONSTRAINT "unit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serial" TEXT NOT NULL,
    "model_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "customer_email" TEXT,
    "customer_city" TEXT,
    "customer_id" TEXT,
    "dealer_id" TEXT,
    "install_date" DATE,
    "purchase_date" DATE,
    "invoice_number" TEXT,
    "location" TEXT,
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submitted_by" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "duplicate_of_serial" TEXT,
    "reject_reason" TEXT,
    "reviewed_by_name" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "batch_id" TEXT,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_imports" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_import_rows" (
    "import_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "registration_id" TEXT,

    CONSTRAINT "bulk_import_rows_pkey" PRIMARY KEY ("import_id","row_number")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "unit_serial" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "raised_by" TEXT NOT NULL,
    "raised_by_name" TEXT NOT NULL,
    "dealer_id" TEXT,
    "customer_id" TEXT,
    "description" TEXT NOT NULL,
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "entitlement" JSONB NOT NULL,
    "service_request_id" TEXT,
    "job_result_id" TEXT,
    "claim_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_events" (
    "id" BIGSERIAL NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "complaint_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_results" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "technician" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "parts_replaced" JSONB NOT NULL,
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sign_off_name" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "job_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT,
    "unit_serial" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "status" TEXT NOT NULL,
    "rma_number" TEXT,
    "amount" INTEGER,
    "job_result_id" TEXT,
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parts_replaced" JSONB NOT NULL,
    "finance_posting" TEXT NOT NULL,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" BIGSERIAL NOT NULL,
    "claim_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_messages" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "params" JSONB,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "models_code_key" ON "models"("code");

-- CreateIndex
CREATE INDEX "models_brand_id_idx" ON "models"("brand_id");

-- CreateIndex
CREATE INDEX "dealers_distributor_id_idx" ON "dealers"("distributor_id");

-- CreateIndex
CREATE INDEX "customers_phone_key_idx" ON "customers"("phone_key");

-- CreateIndex
CREATE INDEX "customers_email_key_idx" ON "customers"("email_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "units_dealer_id_idx" ON "units"("dealer_id");

-- CreateIndex
CREATE INDEX "units_customer_id_idx" ON "units"("customer_id");

-- CreateIndex
CREATE INDEX "units_model_id_idx" ON "units"("model_id");

-- CreateIndex
CREATE INDEX "unit_parts_unit_serial_idx" ON "unit_parts"("unit_serial");

-- CreateIndex
CREATE INDEX "unit_events_unit_serial_at_idx" ON "unit_events"("unit_serial", "at");

-- CreateIndex
CREATE INDEX "unit_events_at_idx" ON "unit_events"("at" DESC);

-- CreateIndex
CREATE INDEX "registrations_status_submitted_at_idx" ON "registrations"("status", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "registrations_submitted_at_idx" ON "registrations"("submitted_at" DESC);

-- CreateIndex
CREATE INDEX "registrations_dealer_id_idx" ON "registrations"("dealer_id");

-- CreateIndex
CREATE INDEX "registrations_customer_id_idx" ON "registrations"("customer_id");

-- CreateIndex
CREATE INDEX "registrations_serial_idx" ON "registrations"("serial");

-- CreateIndex
CREATE INDEX "bulk_imports_dealer_id_created_at_idx" ON "bulk_imports"("dealer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "complaints_status_created_at_idx" ON "complaints"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at" DESC);

-- CreateIndex
CREATE INDEX "complaints_dealer_id_idx" ON "complaints"("dealer_id");

-- CreateIndex
CREATE INDEX "complaints_customer_id_idx" ON "complaints"("customer_id");

-- CreateIndex
CREATE INDEX "complaints_unit_serial_idx" ON "complaints"("unit_serial");

-- CreateIndex
CREATE INDEX "complaint_events_complaint_id_at_idx" ON "complaint_events"("complaint_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "job_results_complaint_id_key" ON "job_results"("complaint_id");

-- CreateIndex
CREATE INDEX "claims_status_created_at_idx" ON "claims"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "claims_created_at_idx" ON "claims"("created_at" DESC);

-- CreateIndex
CREATE INDEX "claims_brand_id_idx" ON "claims"("brand_id");

-- CreateIndex
CREATE INDEX "claims_dealer_id_idx" ON "claims"("dealer_id");

-- CreateIndex
CREATE INDEX "claim_events_claim_id_at_idx" ON "claim_events"("claim_id", "at");

-- CreateIndex
CREATE INDEX "integration_messages_created_at_idx" ON "integration_messages"("created_at" DESC);

-- CreateIndex
CREATE INDEX "integration_messages_system_status_idx" ON "integration_messages"("system", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments"("uploaded_by");

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_parts" ADD CONSTRAINT "model_parts_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_parts" ADD CONSTRAINT "unit_parts_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_events" ADD CONSTRAINT "unit_events_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bulk_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bulk_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_results" ADD CONSTRAINT "job_results_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_unit_serial_fkey" FOREIGN KEY ("unit_serial") REFERENCES "units"("serial") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: what Prisma can't express. Keep in step with shared/wms-domain/src/types.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enumerations (the domain's string unions).
ALTER TABLE "model_parts" ADD CONSTRAINT "model_parts_part_type_check" CHECK ("part_type" IN ('UNIT', 'COMPRESSOR', 'PCB'));
ALTER TABLE "model_parts" ADD CONSTRAINT "model_parts_months_check" CHECK ("warranty_months" BETWEEN 1 AND 600);
ALTER TABLE "unit_parts" ADD CONSTRAINT "unit_parts_part_type_check" CHECK ("part_type" IN ('UNIT', 'COMPRESSOR', 'PCB'));
ALTER TABLE "unit_parts" ADD CONSTRAINT "unit_parts_dates_check" CHECK ("warranty_end" >= "warranty_start");
ALTER TABLE "units" ADD CONSTRAINT "units_void_reason_check"
  CHECK ("void_reason" IS NULL OR "void_reason" IN ('UNAUTHORISED_REPAIR', 'MISSED_SERVICING', 'PHYSICAL_DAMAGE', 'OTHER'));
ALTER TABLE "units" ADD CONSTRAINT "units_void_complete_check"
  CHECK (("void_reason" IS NULL) = ("voided_at" IS NULL));
ALTER TABLE "unit_events" ADD CONSTRAINT "unit_events_type_check"
  CHECK ("type" IN ('registered', 'part_replaced', 'voided', 'complaint_raised', 'claim_created', 'note'));
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_channel_check"
  CHECK ("channel" IN ('DEALER', 'PORTAL', 'EMAIL', 'ERP', 'BULK'));
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_flags_check"
  CHECK ("flags" <@ ARRAY['EXCEPTION', 'DUPLICATE', 'MODEL_MISMATCH']::TEXT[]);
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_rejected_reason_check"
  CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL);
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_status_check"
  CHECK ("status" IN ('REGISTERED', 'FIXED', 'ERROR', 'REVIEW'));
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_source_check" CHECK ("source" IN ('CUSTOMER', 'DEALER', 'ADMIN'));
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_status_check" CHECK ("status" IN ('NEW', 'WITH_SERVICE', 'RESOLVED'));
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_status_check"
  CHECK ("status" IN ('NEW', 'WITH_SERVICE', 'RESOLVED'));
ALTER TABLE "claims" ADD CONSTRAINT "claims_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'));
ALTER TABLE "claims" ADD CONSTRAINT "claims_finance_posting_check"
  CHECK ("finance_posting" IN ('NOT_POSTED', 'POSTED', 'FAILED'));
ALTER TABLE "claims" ADD CONSTRAINT "claims_amount_check" CHECK ("amount" IS NULL OR "amount" > 0);
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_amount_check" CHECK ("status" = 'DRAFT' OR "amount" IS NOT NULL);
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'));
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_system_check"
  CHECK ("system" IN ('CRM', 'ERP', 'FINANCE', 'SERVICE', 'OEM', 'EMAIL'));
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_direction_check" CHECK ("direction" IN ('IN', 'OUT'));
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_status_check"
  CHECK ("status" IN ('PENDING', 'SUCCESS', 'FAILED'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size_check" CHECK ("size" >= 0);

-- A login belongs to the organisation its role implies, and to no other.
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('admin', 'dealer', 'distributor', 'customer'));
ALTER TABLE "users" ADD CONSTRAINT "users_org_check" CHECK (
  ("role" = 'admin' AND "dealer_id" IS NULL AND "distributor_id" IS NULL AND "customer_id" IS NULL) OR
  ("role" = 'dealer' AND "dealer_id" IS NOT NULL AND "distributor_id" IS NULL AND "customer_id" IS NULL) OR
  ("role" = 'distributor' AND "distributor_id" IS NOT NULL AND "dealer_id" IS NULL AND "customer_id" IS NULL) OR
  ("role" = 'customer' AND "customer_id" IS NOT NULL AND "dealer_id" IS NULL AND "distributor_id" IS NULL)
);
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));

-- One fitted part of each type per unit; replaced parts stay as history.
CREATE UNIQUE INDEX "unit_parts_fitted_key" ON "unit_parts" ("unit_serial", "part_type") WHERE "replaced_at" IS NULL;

-- A unit can't be registered twice through the same registration.
CREATE UNIQUE INDEX "units_registration_id_key" ON "units" ("registration_id") WHERE "registration_id" IS NOT NULL;

-- File visibility checks look up which record references an attachment.
CREATE INDEX "units_attachment_ids_idx" ON "units" USING GIN ("attachment_ids");
CREATE INDEX "registrations_attachment_ids_idx" ON "registrations" USING GIN ("attachment_ids");
CREATE INDEX "complaints_attachment_ids_idx" ON "complaints" USING GIN ("attachment_ids");
CREATE INDEX "job_results_photo_ids_idx" ON "job_results" USING GIN ("photo_ids");
CREATE INDEX "registrations_flags_idx" ON "registrations" USING GIN ("flags");

-- Readable ids ("REG-1001"). One sequence per prefix; src/common/db/ids.ts maps prefixes to these names.
CREATE SEQUENCE "id_seq_reg" START 1001;
CREATE SEQUENCE "id_seq_cus" START 1001;
CREATE SEQUENCE "id_seq_cmp" START 1001;
CREATE SEQUENCE "id_seq_sr" START 1001;
CREATE SEQUENCE "id_seq_job" START 1001;
CREATE SEQUENCE "id_seq_clm" START 1001;
CREATE SEQUENCE "id_seq_msg" START 1001;
CREATE SEQUENCE "id_seq_ntf" START 1001;
CREATE SEQUENCE "id_seq_att" START 1001;
CREATE SEQUENCE "id_seq_blk" START 1001;
CREATE SEQUENCE "id_seq_usr" START 1001;
-- Counters that aren't ids: ERP invoice numbers and replacement-part serials in the simulator.
CREATE SEQUENCE "counter_erpinv" START 1;
CREATE SEQUENCE "counter_newpart" START 1;

-- Least privilege: the app role reads and writes rows, never changes the schema. The roles are created by
-- docker/postgres/init (locally) or by the DBA (elsewhere).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_app') THEN
    GRANT USAGE ON SCHEMA public TO wms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wms_app;
    REVOKE ALL ON TABLE "_prisma_migrations" FROM wms_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO wms_app;
    -- Tables and sequences added by later migrations get the same rights.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO wms_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_readonly') THEN
    GRANT USAGE ON SCHEMA public TO wms_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO wms_readonly;
    REVOKE ALL ON TABLE "_prisma_migrations", "auth_sessions" FROM wms_readonly;
    REVOKE SELECT ON TABLE "users" FROM wms_readonly;
  END IF;
END
$$;
