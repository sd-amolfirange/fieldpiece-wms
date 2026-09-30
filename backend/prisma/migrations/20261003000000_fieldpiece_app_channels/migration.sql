-- Fieldpiece's own apps (Overwatch, Job Link) as registration channels, and each product linked to the registration
-- that started its warranty (for the product's registration channel and the A01 "Fieldpiece apps" figures).

-- A product whose registration no longer exists keeps its warranty; only the link is dropped, so the key can be added.
UPDATE "units" u
SET "registration_id" = NULL
WHERE u."registration_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "registrations" r WHERE r."id" = u."registration_id");

-- CreateIndex
CREATE INDEX "units_registration_id_idx" ON "units"("registration_id");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: checks. Keep in step with shared/wms-domain (types.ts: REGISTRATION_CHANNELS, PARTNER_CHANNELS).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "registrations" DROP CONSTRAINT "registrations_channel_check";
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_channel_check"
  CHECK ("channel" IN ('DEALER', 'BULK', 'PORTAL', 'WEB', 'EMAIL', 'ERP', 'API', 'RETAIL', 'OVERWATCH', 'JOBLINK'));

ALTER TABLE "partner_clients" DROP CONSTRAINT "partner_clients_channel_check";
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_channel_check"
  CHECK ("channel" IN ('API', 'RETAIL', 'ERP', 'OVERWATCH', 'JOBLINK'));
