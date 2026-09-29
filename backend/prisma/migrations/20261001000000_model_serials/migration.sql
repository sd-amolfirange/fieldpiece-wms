-- Serials are stored as MODEL-NUMBER ("SC680-251406233"), so the same label number on two models never collides and
-- every screen, export and API shows the model with the serial. Existing bare numbers get their model's code.
-- unit_events.unit_serial and warranty_claims.unit_serial follow the units primary key (ON UPDATE CASCADE).
-- Rows that already carry a prefix (anything but digits) are left alone, so this is safe to re-run on a copy.

-- Products: the key, and the links between an original and its replacement (same model).
UPDATE "units" u
SET "serial" = m."code" || '-' || u."serial"
FROM "models" m
WHERE m."id" = u."model_id" AND u."serial" ~ '^[0-9]+$';

UPDATE "units" u
SET "replaces_serial" = m."code" || '-' || u."replaces_serial"
FROM "models" m
WHERE m."id" = u."model_id" AND u."replaces_serial" ~ '^[0-9]+$';

UPDATE "units" u
SET "replaced_by_serial" = m."code" || '-' || u."replaced_by_serial"
FROM "models" m
WHERE m."id" = u."model_id" AND u."replaced_by_serial" ~ '^[0-9]+$';

-- Registrations carry the model code they were submitted with.
UPDATE "registrations"
SET "serial" = "model_code" || '-' || "serial"
WHERE "serial" ~ '^[0-9]+$' AND "model_code" <> '';

UPDATE "registrations"
SET "duplicate_of_serial" = "model_code" || '-' || "duplicate_of_serial"
WHERE "duplicate_of_serial" ~ '^[0-9]+$' AND "model_code" <> '';

-- A replacement is the same model as the claimed product (unit_serial is already renamed by the cascade).
UPDATE "warranty_claims" c
SET "replacement_serial" = m."code" || '-' || c."replacement_serial"
FROM "units" u
JOIN "models" m ON m."id" = u."model_id"
WHERE u."serial" = c."unit_serial" AND c."replacement_serial" ~ '^[0-9]+$';

-- The model's serial pattern now describes the number part only (unchanged: "^\d{9}$").
