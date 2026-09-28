#!/bin/sh
# Runs once, when the Postgres volume is first created. The app connects as the least-privilege role wms_app
# (rows only, no DDL); migrations run as the owner (POSTGRES_USER). Table grants are in the first migration.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE wms_app LOGIN PASSWORD :'app_password';
ALTER ROLE wms_app SET statement_timeout = '5s';
ALTER ROLE wms_app SET idle_in_transaction_session_timeout = '30s';
GRANT CONNECT ON DATABASE wms_hvac TO wms_app;
SQL
