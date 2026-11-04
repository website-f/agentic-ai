#!/bin/sh
# P65: Prima Secure's database, once, on prima-db's first start (docker-entrypoint-initdb.d).
# Prima's own runbook (apps/prima/docs, db-setup.ts, module-install.ts): the schema is owned by
# a NON-superuser (row-level security is FORCEd and its SECURITY DEFINER functions assume it),
# which holds prima_app WITH ADMIN (db-setup grants it to the runtime login prima_api, which
# db-setup itself creates) and SET (module-install switches to it). The superuser is only
# used here.
set -eu
: "${PRIMA_OWNER_PASSWORD:?PRIMA_OWNER_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -v owner_pw="$PRIMA_OWNER_PASSWORD" \
     --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE prima_app NOLOGIN;
-- CREATEDB too, as Prima's Azure owner had: db-setup restates NOCREATEDB on its runtime login,
-- which PostgreSQL 16 only allows a role that has CREATEDB itself.
CREATE ROLE prima_owner LOGIN CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD :'owner_pw';
GRANT prima_app TO prima_owner WITH ADMIN OPTION, INHERIT FALSE, SET TRUE;
CREATE DATABASE prima OWNER prima_owner;
REVOKE CONNECT, TEMPORARY ON DATABASE prima FROM PUBLIC;
GRANT CONNECT ON DATABASE prima TO prima_owner;
SQL
