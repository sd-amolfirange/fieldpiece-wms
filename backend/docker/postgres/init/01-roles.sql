-- Runs once when the Postgres volume is first created (build guide Section 2.2).
-- Extensions are created by the first Prisma migration (schema.prisma `extensions`), not here, so Prisma
-- doesn't see them as drift.

-- The app connects as a least-privilege role, never as the owner.
CREATE ROLE wms_app LOGIN PASSWORD 'localdev';
CREATE ROLE wms_readonly LOGIN PASSWORD 'localdev';   -- reporting / BI
GRANT CONNECT ON DATABASE wms TO wms_app, wms_readonly;

-- Guard rails from Section 9.2.
ALTER ROLE wms_app SET statement_timeout = '5s';
ALTER ROLE wms_app SET idle_in_transaction_session_timeout = '30s';

-- Separate database for the e2e suite, so tests never touch dev data.
CREATE DATABASE wms_test OWNER wms_owner;
GRANT CONNECT ON DATABASE wms_test TO wms_app, wms_readonly;

-- Table grants happen in a migration that runs after the tables exist (Section 5.6).
