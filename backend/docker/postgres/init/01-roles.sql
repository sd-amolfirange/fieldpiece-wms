-- Runs once, when the Postgres volume is first created. Table grants are in the first migration, because they
-- need the tables to exist.

-- The app connects as a least-privilege role, never as the owner. Migrations run as wms_owner.
CREATE ROLE wms_app LOGIN PASSWORD 'localdev';
CREATE ROLE wms_readonly LOGIN PASSWORD 'localdev';   -- reporting / BI

-- Guard rails.
ALTER ROLE wms_app SET statement_timeout = '5s';
ALTER ROLE wms_app SET idle_in_transaction_session_timeout = '30s';

-- Application database, plus separate ones for the browser tests (test:ui) and the API e2e suite (test:e2e), so
-- tests never touch dev data or each other.
CREATE DATABASE wms_hvac OWNER wms_owner;
CREATE DATABASE wms_hvac_test OWNER wms_owner;
CREATE DATABASE wms_hvac_e2e OWNER wms_owner;
GRANT CONNECT ON DATABASE wms_hvac, wms_hvac_test, wms_hvac_e2e TO wms_app, wms_readonly;
