# ADR 0002: JSONB rows with row-level security for Wave 1

Date: 2026-10-24. Status: Accepted for Wave 1, to revisit after discovery.

## Decision
Each table stores the record as JSONB plus the columns the database must enforce: the
primary key and `company_id`. Row-level security on `company_id` is the company wall. The
API switches to the `prima_app` role and sets `app.company_ids` per transaction from the
user's grants.

## Why
Discovery has not yet confirmed the real data model of the 38 companies. JSONB lets
fields change without migrations during the pilot, while the wall that matters legally
(no record crossing companies) is enforced by PostgreSQL itself.

## Consequences
Fields used for heavy filtering get expression indexes now and become real columns once
stable. Reporting and SQL Account links will read through views.
