-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "product_family" AS ENUM ('meters', 'gauges', 'vacuum', 'leak_detection', 'combustion', 'airflow', 'recovery', 'other');

-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'RMA_ISSUED', 'IN_TRANSIT', 'RECEIVED', 'REPAIRED', 'REPLACED', 'CREDITED', 'CLOSED');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" "product_family" NOT NULL,
    "serial_pattern" TEXT,
    "launch_date" DATE,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID,
    "base_months" INTEGER NOT NULL,
    "registration_bonus_months" INTEGER NOT NULL DEFAULT 0,
    "registration_window_days" INTEGER,
    "coverage" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_categories" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requires_photo" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "failure_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_ref" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idp_subject" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "organization_id" UUID,
    "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "distributor_id" UUID,
    "company_name" TEXT,
    "contact_name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "address" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serial_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "distributor_id" UUID,
    "policy_id" UUID NOT NULL,
    "purchase_date" DATE NOT NULL,
    "warranty_start" DATE NOT NULL,
    "warranty_end" DATE NOT NULL,
    "status" "registration_status" NOT NULL DEFAULT 'ACTIVE',
    "replaces_registration_id" UUID,
    "certificate_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- Human-readable IDs (Section 5.1). Gaps are meaningless.
CREATE SEQUENCE "claim_display_seq";

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_no" TEXT NOT NULL DEFAULT ('CLM-'::text || lpad((nextval('claim_display_seq'::regclass))::text, 6, '0'::text)),
    "registration_id" UUID NOT NULL,
    "failure_category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "failure_date" DATE NOT NULL,
    "in_warranty" BOOLEAN NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'DRAFT',
    "preferred_resolution" TEXT,
    "resolution" TEXT,
    "rejection_reason" TEXT,
    "return_address" JSONB,
    "assigned_to" UUID,
    "sla_due_at" TIMESTAMPTZ(6),
    "sla_breach_notified_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "claim_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "claim_status",
    "to_status" "claim_status",
    "comment" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

CREATE SEQUENCE "rma_display_seq";

-- CreateTable
CREATE TABLE "rmas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_no" TEXT NOT NULL DEFAULT ('RMA-'::text || lpad((nextval('rma_display_seq'::regclass))::text, 6, '0'::text)),
    "claim_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "service_center_id" UUID,
    "ship_to" JSONB NOT NULL,
    "inbound_carrier" TEXT,
    "inbound_tracking" TEXT,
    "outbound_carrier" TEXT,
    "outbound_tracking" TEXT,
    "inspection_notes" TEXT,
    "root_cause" TEXT,
    "parts_used" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "replacement_serial" TEXT,
    "credit_amount" DECIMAL(12,2),
    "credit_currency" CHAR(3),
    "completed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "scan_status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_ip" INET,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "warranty_policies_product_id_effective_from_idx" ON "warranty_policies"("product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "users_idp_subject_key" ON "users"("idp_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE INDEX "registrations_customer_idx" ON "registrations"("customer_id");

-- CreateIndex
CREATE INDEX "registrations_distributor_end_idx" ON "registrations"("distributor_id", "warranty_end");

-- CreateIndex
CREATE UNIQUE INDEX "claims_display_no_key" ON "claims"("display_no");

-- CreateIndex
CREATE INDEX "claims_assignee_idx" ON "claims"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "claims_registration_idx" ON "claims"("registration_id");

-- CreateIndex
CREATE INDEX "claims_created_by_idx" ON "claims"("created_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "claims_created_at_brin" ON "claims" USING BRIN ("created_at");

-- CreateIndex
CREATE INDEX "claim_events_claim_idx" ON "claim_events"("claim_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rmas_display_no_key" ON "rmas"("display_no");

-- CreateIndex
CREATE UNIQUE INDEX "rmas_claim_id_key" ON "rmas"("claim_id");

-- CreateIndex
CREATE INDEX "rmas_sc_status_idx" ON "rmas"("service_center_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_owner_idx" ON "attachments"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_occurred_at_idx" ON "audit_log"("entity", "entity_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "warranty_policies" ADD CONSTRAINT "warranty_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "warranty_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_replaces_registration_id_fkey" FOREIGN KEY ("replaces_registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_failure_category_fkey" FOREIGN KEY ("failure_category") REFERENCES "failure_categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rmas" ADD CONSTRAINT "rmas_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rmas" ADD CONSTRAINT "rmas_service_center_id_fkey" FOREIGN KEY ("service_center_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════
-- Hand-written: objects Prisma can't express (build guide Section 5.2).
-- If a later `prisma migrate dev` emits DROP statements for any of these, delete them from that migration.
-- ════════════════════════════════════════════════════════════════════

-- ── CHECK constraints ────────────────────────────────────────────────
ALTER TABLE "warranty_policies"
  ADD CONSTRAINT "warranty_policies_base_months_check" CHECK (base_months BETWEEN 0 AND 240),
  ADD CONSTRAINT "warranty_policies_bonus_check" CHECK (registration_bonus_months >= 0),
  ADD CONSTRAINT "warranty_policies_window_check" CHECK (registration_window_days IS NULL OR registration_window_days >= 0),
  ADD CONSTRAINT "warranty_policies_dates_check" CHECK (effective_to IS NULL OR effective_to > effective_from);

-- Only one policy is active per product at a time.
ALTER TABLE "warranty_policies" ADD CONSTRAINT "no_overlapping_policies"
  EXCLUDE USING gist (
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date)) WITH &&
  );

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_type_check" CHECK (type IN ('fieldpiece','distributor','service_center'));

ALTER TABLE "users"
  ADD CONSTRAINT "users_roles_check"
  CHECK (roles <@ ARRAY['technician','distributor','claims_agent','service_center','admin']::text[]);

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_purchase_date_check" CHECK (purchase_date <= current_date),
  ADD CONSTRAINT "registrations_warranty_dates_check" CHECK (warranty_end >= warranty_start);

ALTER TABLE "claims"
  ADD CONSTRAINT "claims_description_check" CHECK (char_length(description) BETWEEN 30 AND 5000),
  ADD CONSTRAINT "claims_resolution_check" CHECK (resolution IN ('repair','replace','credit','none')),
  ADD CONSTRAINT "claims_preferred_resolution_check" CHECK (preferred_resolution IN ('repair','replace','credit')),
  ADD CONSTRAINT "claims_rejection_reason_check" CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL);

ALTER TABLE "claim_events"
  ADD CONSTRAINT "claim_events_type_check"
  CHECK (type IN ('created','status_changed','comment','attachment_added','assigned'));

ALTER TABLE "rmas"
  ADD CONSTRAINT "rmas_type_check" CHECK (type IN ('repair','replace','credit')),
  ADD CONSTRAINT "rmas_status_check"
    CHECK (status IN ('ISSUED','IN_TRANSIT','RECEIVED','INSPECTED','COMPLETED','CANCELLED')),
  ADD CONSTRAINT "rmas_credit_check" CHECK (credit_amount IS NULL OR (credit_amount >= 0 AND credit_currency IS NOT NULL));

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_owner_type_check" CHECK (owner_type IN ('registration','claim','rma','import')),
  ADD CONSTRAINT "attachments_scan_status_check" CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','ERROR')),
  ADD CONSTRAINT "attachments_size_check" CHECK (size_bytes > 0);

-- ── Partial, expression and trigram indexes ──────────────────────────
CREATE INDEX "customers_distributor_idx" ON "customers" (distributor_id) WHERE deleted_at IS NULL;
CREATE INDEX "customers_search_trgm" ON "customers"
  USING gin ((coalesce(company_name, '') || ' ' || contact_name) gin_trgm_ops);

-- One ACTIVE registration per physical unit.
CREATE UNIQUE INDEX "registrations_active_serial_uq"
  ON "registrations" (product_id, upper(serial_number)) WHERE status = 'ACTIVE';
CREATE INDEX "registrations_serial_trgm" ON "registrations" USING gin (upper(serial_number) gin_trgm_ops);

CREATE INDEX "claims_queue_idx" ON "claims" (status, sla_due_at)
  WHERE status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO');

CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" (id) WHERE published_at IS NULL;
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" (created_at);

-- ── Audit partitions ─────────────────────────────────────────────────
-- A default partition catches anything the monthly job hasn't created yet; the maintenance job in the
-- worker creates the next months ahead of time.
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;

-- ── Privileges (Section 5.6) ─────────────────────────────────────────
-- Skipped where the roles don't exist (e.g. a throwaway CI database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_app') THEN
    GRANT USAGE ON SCHEMA public TO wms_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO wms_app;
    REVOKE UPDATE, DELETE ON audit_log, claim_events FROM wms_app;
    GRANT DELETE ON idempotency_keys, outbox_events TO wms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO wms_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wms_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wms_readonly') THEN
    GRANT USAGE ON SCHEMA public TO wms_readonly;
    -- TODO: grant SELECT on PII-masking views only, once the BI views exist (Section 11.5).
  END IF;
END
$$;
