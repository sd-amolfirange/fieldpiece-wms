-- Service centers need a ship-to address for RMAs.
ALTER TABLE "organizations" ADD COLUMN "address" JSONB;
