#!/bin/sh
# First boot only (empty data volume). Gives Temporal its own login and its own two
# databases so it never touches the app database, and enables the app's extensions.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE temporal LOGIN PASSWORD '${TEMPORAL_DB_PASSWORD}';
CREATE DATABASE temporal OWNER temporal;
CREATE DATABASE temporal_visibility OWNER temporal;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
