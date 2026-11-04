-- Prima Secure App, Wave 1 schema.
--
-- Each table keeps the record as JSONB plus the columns the database needs to enforce
-- rules itself: the primary key and company_id. Row-level security on company_id is the
-- company wall (master plan 6.3): the app role can only see companies listed in the
-- per-transaction setting app.company_ids, which the API sets from the user's grants.
--
-- JSONB rows are a deliberate Wave 1 choice while discovery confirms the real data model
-- (ADR 0002). Hot fields get expression indexes; columns get promoted once stable.

BEGIN;

-- Role the API switches to for every request. It owns nothing and bypasses nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS prima;
GRANT USAGE ON SCHEMA prima TO prima_app;

-- Companies visible to the current transaction.
CREATE OR REPLACE FUNCTION prima.visible_companies() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.company_ids', true), ''), ','), ARRAY[]::text[])
$$;

-- Tenant tables: one shape for all.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','sites','posts','people','credentials','licences','shifts',
                           'attendance','cases','checkpoints','scans','tenders','quotations',
                           'vaults','firearms','arms_movements','armed_jobs','dealer_licences','vault_watches',
                           'vault_events','ammo_stocks','arms_agreements','arms_requests',
                           'insurance_policies','insurance_claims','insurance_guarantees','phone_extensions','phone_calls','site_systems','site_alarms','attendance_followups','evidence_photos','site_visits','evidence_docs','leave_requests','socso_claims','fw_renewals','fwm_tasks',
                           'hostels','hostel_stays','hostel_bills','utility_charges','staff_claims','trip_approvals','ja_records','staff_pay_runs','fin_status','contracts','branch_settlements','branch_actions','corp_profiles','corp_filings','corp_changes','credit_loans','credit_defaults','pur_suppliers','pur_requests','stock_items','stock_issues','gov_mandates','grc_obligations','osh_assessments','corp_audits','legal_matters','sales_leads','pay_changes']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS prima.%1$I (
        id         text PRIMARY KEY,
        company_id text NOT NULL,
        data       jsonb NOT NULL,
        CHECK (data->>'id' = id),
        CHECK (data->>'companyId' = company_id)
      );
      CREATE INDEX IF NOT EXISTS %1$s_company_idx ON prima.%1$I (company_id);
      CREATE INDEX IF NOT EXISTS %1$s_data_idx ON prima.%1$I USING gin (data jsonb_path_ops);
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS company_wall ON prima.%1$I;
      CREATE POLICY company_wall ON prima.%1$I
        USING (company_id = ANY (prima.visible_companies()))
        WITH CHECK (company_id = ANY (prima.visible_companies()));
      GRANT SELECT, INSERT, UPDATE ON prima.%1$I TO prima_app;
    $f$, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS shifts_site_date_idx ON prima.shifts ((data->>'siteId'), (data->>'date'));
CREATE INDEX IF NOT EXISTS shifts_person_idx ON prima.shifts ((data->>'personId'));
CREATE INDEX IF NOT EXISTS attendance_person_idx ON prima.attendance ((data->>'personId'));

-- Companies: the wall is on the company's own id.
CREATE TABLE IF NOT EXISTS prima.companies (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id)
);
ALTER TABLE prima.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.companies FORCE ROW LEVEL SECURITY;
-- All authorized users may read their permitted companies. Company master writes are
-- a separate CEO-only database policy, not merely a UI or service-layer check.
DROP POLICY IF EXISTS company_wall ON prima.companies;
DROP POLICY IF EXISTS company_read ON prima.companies;
DROP POLICY IF EXISTS company_ceo_update ON prima.companies;
DROP POLICY IF EXISTS company_privileged_seed_insert ON prima.companies;
-- Bootstrap/schema-owner users already have INSERT privilege; only those users may seed companies.
-- prima_app never receives INSERT privilege, and is explicitly excluded by the insert policy.
CREATE POLICY company_privileged_seed_insert ON prima.companies FOR INSERT
  WITH CHECK (current_user <> 'prima_app');
CREATE POLICY company_read ON prima.companies FOR SELECT
  USING (id = ANY (prima.visible_companies()));
CREATE POLICY company_ceo_update ON prima.companies FOR UPDATE
  USING (id = ANY (prima.visible_companies()) AND current_setting('app.user_id', true) = 'u-fauzan')
  WITH CHECK (id = ANY (prima.visible_companies()) AND current_setting('app.user_id', true) = 'u-fauzan');
GRANT SELECT, UPDATE ON prima.companies TO prima_app;

-- Users and authority grants are read before the wall is set, by the API's own role.
-- The app role may read them (to show names) but never change them.
CREATE TABLE IF NOT EXISTS prima.users (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.grants (
  id         text PRIMARY KEY,
  company_id text NOT NULL,
  data       jsonb NOT NULL
);
-- CMS command centre roster: PWVSB staff, not a company's, so outside the company wall.
CREATE TABLE IF NOT EXISTS prima.cms_shifts (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.cms_staff (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.cms_settings (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
-- Reports to the Director Office (Fauzan, 25 Oct 2026): the list, and who sent what when. A company's report file
-- stays behind its company wall in evidence_docs; these rows hold only who sent which report and when.
CREATE TABLE IF NOT EXISTS prima.report_defs (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
-- Joint tender entries (Fauzan, 26 Oct 2026): which group companies enter the same tender and who checks whom.
-- Holds no prices or files: each company's bid stays behind its own wall in tenders and evidence_docs.
CREATE TABLE IF NOT EXISTS prima.tender_groups (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.report_submissions (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
-- Meetings (Fauzan, 25 Oct 2026): a company's meeting stays behind its company wall; a group meeting has no company.
CREATE TABLE IF NOT EXISTS prima.meetings (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.meetings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meeting_wall ON prima.meetings;
CREATE POLICY meeting_wall ON prima.meetings
  USING (company_id IS NULL OR company_id = ANY (prima.visible_companies()))
  WITH CHECK (company_id IS NULL OR company_id = ANY (prima.visible_companies()));
GRANT SELECT, INSERT, UPDATE ON prima.meetings TO prima_app;
-- Staff clock (Fauzan, 26 Oct 2026): each staff member's own clock-in and location while clocked in.
-- A company's staff stay behind the company wall; PWVSB central staff (no company) are seen by group users;
-- everyone sees their own records.
CREATE TABLE IF NOT EXISTS prima.staff_clocks (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.location_pings (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.staff_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.staff_clocks FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.location_pings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_clock_wall ON prima.staff_clocks;
CREATE POLICY staff_clock_wall ON prima.staff_clocks
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS location_ping_wall ON prima.location_pings;
CREATE POLICY location_ping_wall ON prima.location_pings
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON prima.staff_clocks, prima.location_pings TO prima_app;
-- Working from home (Fauzan, 27 Oct 2026): the arrangement and each home day. Same wall as the staff clock; the
-- manager writes the answer and the review on a staff member's row, so writes follow the same wall.
CREATE TABLE IF NOT EXISTS prima.remote_arrangements (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.remote_days (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.remote_arrangements ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.remote_arrangements FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.remote_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.remote_days FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS remote_arrangement_wall ON prima.remote_arrangements;
CREATE POLICY remote_arrangement_wall ON prima.remote_arrangements
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS remote_day_wall ON prima.remote_days;
CREATE POLICY remote_day_wall ON prima.remote_days
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON prima.remote_arrangements, prima.remote_days TO prima_app;
-- Remote and branch work plan (Fauzan, 27 Oct 2026): tasks, check-ins, help, one-to-ones, playbook sign-offs, branch checklists and visits.
CREATE TABLE IF NOT EXISTS prima.work_tasks (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.work_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.work_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_tasks_wall ON prima.work_tasks;
CREATE POLICY work_tasks_wall ON prima.work_tasks
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.work_check_ins (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.work_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.work_check_ins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_check_ins_wall ON prima.work_check_ins;
CREATE POLICY work_check_ins_wall ON prima.work_check_ins
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.help_requests (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.help_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.help_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS help_requests_wall ON prima.help_requests;
CREATE POLICY help_requests_wall ON prima.help_requests
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.one_on_ones (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.one_on_ones ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.one_on_ones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS one_on_ones_wall ON prima.one_on_ones;
CREATE POLICY one_on_ones_wall ON prima.one_on_ones
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.playbook_signoffs (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.playbook_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.playbook_signoffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS playbook_signoffs_wall ON prima.playbook_signoffs;
CREATE POLICY playbook_signoffs_wall ON prima.playbook_signoffs
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.branch_checks (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.branch_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.branch_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_checks_wall ON prima.branch_checks;
CREATE POLICY branch_checks_wall ON prima.branch_checks
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
CREATE TABLE IF NOT EXISTS prima.branch_visits (
  id         text PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL
);
ALTER TABLE prima.branch_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.branch_visits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_visits_wall ON prima.branch_visits;
CREATE POLICY branch_visits_wall ON prima.branch_visits
  USING (company_id = ANY (prima.visible_companies())
         OR (company_id IS NULL AND current_setting('app.group_user', true) = 'on')
         OR data->>'userId' = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE ON prima.work_tasks, prima.work_check_ins, prima.help_requests, prima.one_on_ones, prima.playbook_signoffs, prima.branch_checks, prima.branch_visits TO prima_app;
-- Tender protocol for the whole group, set by the Director Office Administrator (Fauzan, 25 Oct 2026).
CREATE TABLE IF NOT EXISTS prima.tender_protocols (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
-- Arms suppliers are dealt with by PWVSB Arms Control for the whole group.
CREATE TABLE IF NOT EXISTS prima.arms_suppliers (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.supplier_items (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT ON prima.users, prima.grants, prima.cms_shifts, prima.cms_staff, prima.cms_settings, prima.tender_protocols, prima.report_defs, prima.report_submissions, prima.arms_suppliers, prima.supplier_items TO prima_app;
-- Arms Control sets the CMS roster and parameters (Fauzan, 25 Oct 2026); the service checks who may.
GRANT INSERT, UPDATE ON prima.cms_shifts, prima.cms_settings TO prima_app;
-- The Director Office sets the tender protocol; the service checks who may.
GRANT INSERT, UPDATE ON prima.tender_protocols, prima.report_defs TO prima_app;
GRANT INSERT ON prima.report_submissions TO prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.tender_groups TO prima_app;
-- Mileage rates per vehicle per month (Fauzan, 26 Oct 2026): set by the Chief of Staff, read by every claimant.
CREATE TABLE IF NOT EXISTS prima.claim_rates (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.claim_rates TO prima_app;
-- Memos (Fauzan, 26 Oct 2026): group-wide; the Chief of Staff publishes to staff, the COO to guards and officers.
CREATE TABLE IF NOT EXISTS prima.memos (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.memos TO prima_app;
-- PDPA cases (Fauzan, 26 Oct 2026): breaches, client consent and social media, run by the PDPA officer.
CREATE TABLE IF NOT EXISTS prima.pdpa_cases (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.pdpa_cases TO prima_app;
-- PDPA rights: each company's DPO and people's data requests; group-wide, run by the PDPA officer.
CREATE TABLE IF NOT EXISTS prima.pdpa_dpos (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.pdpa_requests (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.pdpa_dpos, prima.pdpa_requests TO prima_app;
-- Continuity: systems, their three copies in Malaysia, and drills; run by IT, watched by group leadership.
CREATE TABLE IF NOT EXISTS prima.bcm_systems (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.bcm_drills (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.bcm_systems, prima.bcm_drills TO prima_app;
-- Office door readings from the access-control system through CMS, to check the staff clock (Fauzan, 27 Oct 2026).
CREATE TABLE IF NOT EXISTS prima.door_events (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT ON prima.door_events TO prima_app;
-- Monthly depreciation journals Finance posted in SQL Account, per owner entity.
CREATE TABLE IF NOT EXISTS prima.am_depn_postings (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT ON prima.am_depn_postings TO prima_app;
-- ACT (Audit, Compliance and Transformation): findings, workflow audits and improvements, group-wide.
CREATE TABLE IF NOT EXISTS prima.act_findings (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.act_audits (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.act_improvements (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.act_findings, prima.act_audits, prima.act_improvements TO prima_app;
-- Fleet (Fauzan, 26 Oct 2026): every company vehicle and staff requests, run by the Transport head.
CREATE TABLE IF NOT EXISTS prima.vehicles (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS prima.vehicle_requests (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.vehicles, prima.vehicle_requests TO prima_app;
-- Group products sold or rented to clients, with personal data details and certificates (Fauzan, 26 Oct 2026).
CREATE TABLE IF NOT EXISTS prima.products (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.products TO prima_app;
-- Client board (Fauzan, 26 Oct 2026): onboarding, offboarding, visits, reports, satisfaction, documents and billing.
CREATE TABLE IF NOT EXISTS prima.client_accounts (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.client_accounts TO prima_app;
-- Operation claims and office requests (Fauzan, 26 Oct 2026).
CREATE TABLE IF NOT EXISTS prima.expense_requests (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON prima.expense_requests TO prima_app;
-- JA Group app deliveries (Fauzan, 26 Oct 2026): one row per delivery, what was kept and what was refused.
CREATE TABLE IF NOT EXISTS prima.ja_syncs (
  id   text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT SELECT, INSERT ON prima.ja_syncs TO prima_app;
-- Asset Management (Fauzan, 26 Oct 2026): group property and assets, no company column. No group company may see these;
-- the service lets in only the Asset Management team, group leadership and the finance staff who oversee it.
CREATE TABLE IF NOT EXISTS prima.am_units (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.am_work_orders (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.am_assets (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.am_properties (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.am_units, prima.am_work_orders, prima.am_assets, prima.am_properties TO prima_app;
-- IT department (Fauzan, 27 Oct 2026): central, no company column; the service decides who sees what.
CREATE TABLE IF NOT EXISTS prima.it_assets (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_domains (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_tickets (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_onboarding (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_tender_tasks (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_purchases (id text PRIMARY KEY, data jsonb NOT NULL);
-- IT pilot (Fauzan, 28 Oct 2026): jobs given with proof, and the systems the CEO owns with who may sign in (never passwords).
CREATE TABLE IF NOT EXISTS prima.it_jobs (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_accounts (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_access_requests (id text PRIMARY KEY, data jsonb NOT NULL);
-- Pilot (28 Oct 2026): group companies holding MOF IT codes, and IT settings (tender executive, IT Manager away).
CREATE TABLE IF NOT EXISTS prima.it_code_holders (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_settings (id text PRIMARY KEY, data jsonb NOT NULL);
-- Merdeka Network Sdn Bhd (28 Oct 2026): owns every device and bills each company its monthly rent.
CREATE TABLE IF NOT EXISTS prima.it_rental_bills (id text PRIMARY KEY, data jsonb NOT NULL);
-- Each person's acceptance of the confidentiality rule (Fauzan, 28 Oct 2026, rule SEC-CONFIDENTIAL).
CREATE TABLE IF NOT EXISTS prima.confidentiality_acks (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.confidentiality_acks TO prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.it_assets, prima.it_domains, prima.it_tickets, prima.it_onboarding, prima.it_tender_tasks, prima.it_purchases, prima.it_jobs, prima.it_accounts, prima.it_access_requests, prima.it_code_holders, prima.it_settings, prima.it_rental_bills TO prima_app;
-- Group website management (Fauzan, 27 Oct 2026): run by IT across companies; a domain can serve more than one company,
-- so no company column. The service limits each person to the companies assigned to them.
CREATE TABLE IF NOT EXISTS prima.web_companies (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_domains (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_sites (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_reviews (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_checks (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_issues (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_dns_changes (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_notices (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.web_settings (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.web_companies, prima.web_domains, prima.web_sites, prima.web_reviews, prima.web_checks, prima.web_issues, prima.web_dns_changes, prima.web_notices, prima.web_settings TO prima_app;
-- Speak-up reports and the gifts register (V15): group-wide, no company column; the service shows a report only to its
-- handler, never to anyone named in it.
CREATE TABLE IF NOT EXISTS prima.whistle_reports (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.gift_entries (id text PRIMARY KEY, data jsonb NOT NULL);
GRANT SELECT, INSERT, UPDATE ON prima.whistle_reports, prima.gift_entries TO prima_app;

-- Audit log: append-only, hash-chained. The app role can insert and read its companies'
-- entries but can never update or delete. Group-level entries have no company.
CREATE TABLE IF NOT EXISTS prima.audit (
  seq        bigint PRIMARY KEY,
  company_id text,
  data       jsonb NOT NULL,
  CHECK ((data->>'seq')::bigint = seq)
);
ALTER TABLE prima.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_read ON prima.audit;
CREATE POLICY audit_read ON prima.audit FOR SELECT
  USING (company_id IS NULL OR company_id = ANY (prima.visible_companies()));
DROP POLICY IF EXISTS audit_write ON prima.audit;
CREATE POLICY audit_write ON prima.audit FOR INSERT
  WITH CHECK (company_id IS NULL OR company_id = ANY (prima.visible_companies()));
GRANT SELECT, INSERT ON prima.audit TO prima_app;

-- The schema owner reads the whole log, so prima.audit_head (which runs as the owner) finds the true head even when the
-- request can see only some companies' entries. On Azure the owner is not a superuser, so without this the head would
-- be the last entry the request can see. No login reaches the owner role except through these functions.
DROP POLICY IF EXISTS audit_owner_read ON prima.audit;
CREATE POLICY audit_owner_read ON prima.audit FOR SELECT TO CURRENT_USER USING (true);
-- The chain head must be global even though a user only reads their companies' entries.
-- This function returns it and holds a transaction lock so appends are strictly ordered.
CREATE OR REPLACE FUNCTION prima.audit_head(OUT seq bigint, OUT hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = prima, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('prima.audit'));
  SELECT a.seq, a.data->>'hash' INTO seq, hash FROM prima.audit a ORDER BY a.seq DESC LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION prima.audit_head() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.audit_head() TO prima_app;

-- Nobody, including the owner through the app, rewrites history.
CREATE OR REPLACE FUNCTION prima.audit_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_no_update ON prima.audit;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON prima.audit
  FOR EACH ROW EXECUTE FUNCTION prima.audit_no_change();

-- Which version of this file the database was last set up with (sha256 of the file), written by the database setup
-- job (db-setup.ts) after it runs this file. The API reads it at start-up and refuses to run on an older schema, so a
-- routine deploy never has to run a migration with administrator rights.
CREATE TABLE IF NOT EXISTS prima.schema_info (
  id               int PRIMARY KEY CHECK (id = 1),
  migration_sha256 text NOT NULL,
  applied_at       timestamptz NOT NULL
);
GRANT SELECT ON prima.schema_info TO prima_app;

-- Submitted Arisha proposals are not operational records. Application authorization
-- further restricts authors/reviewers; the database retains the tenant wall.
CREATE TABLE IF NOT EXISTS prima.arisha_drafts (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id)
);
ALTER TABLE prima.arisha_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.arisha_drafts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draft_wall ON prima.arisha_drafts;
CREATE POLICY draft_wall ON prima.arisha_drafts USING (
  (data->>'companyId' = ANY(prima.visible_companies())) OR
  (data->>'companyId' IS NULL AND current_setting('app.group_user', true) = 'on')
) WITH CHECK (
  (data->>'companyId' = ANY(prima.visible_companies())) OR
  (data->>'companyId' IS NULL AND current_setting('app.group_user', true) = 'on')
);
GRANT SELECT, INSERT, UPDATE ON prima.arisha_drafts TO prima_app;

-- Arisha's reviewed handoff into the T9 IT import (Fauzan, 31 Oct 2026). Only the CEO's own account (u-fauzan) keeps
-- reviews, and only its own; the database checks this, not only the API. The app role has no right to remove a review: a
-- closed one only clears its reviewed rows after its keeping time, and only through prima.tidy_it_import_reviews, which
-- audits every change. A review moves forward only (reviewing -> committed, abandoned or expired), and a closed review
-- never reopens or changes what it imported. Every check below is written so that a missing key fails it.
CREATE TABLE IF NOT EXISTS prima.it_import_reviews (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (coalesce(jsonb_typeof(data) = 'object' AND data ?& ARRAY['id', 'actorId', 'kind', 'parts', 'counts', 'reviewedHash',
    'previewToken', 'status', 'version', 'receipt', 'createdAt', 'updatedAt', 'expiresAt', 'purgeAfter', 'purged', 'requestHash'], false)),
  CHECK (coalesce(data->>'id' = id, false)),
  CHECK (coalesce(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)),
  CHECK (coalesce(jsonb_typeof(data->'actorId') = 'string', false)),
  CHECK (coalesce(data->>'kind' IN ('tickets', 'jobs'), false)),
  CHECK (coalesce(data->>'status' IN ('reviewing', 'committed', 'abandoned', 'expired'), false)),
  CHECK (coalesce(jsonb_typeof(data->'parts') = 'array' AND jsonb_typeof(data->'counts') = 'object', false)),
  CHECK (coalesce(jsonb_typeof(data->'version') = 'number' AND (data->>'version') ~ '^[1-9][0-9]{0,8}$', false)),
  CHECK (coalesce(data->>'reviewedHash' ~ '^[0-9a-f]{64}$' AND data->>'requestHash' ~ '^[0-9a-f]{64}$', false)),
  CHECK (coalesce(jsonb_typeof(data->'previewToken') = 'string' AND length(data->>'previewToken') BETWEEN 1 AND 200, false)),
  CHECK (coalesce(jsonb_typeof(data->'purged') = 'boolean', false)),
  CHECK (coalesce(jsonb_typeof(data->'receipt') IN ('null', 'object'), false)),
  CHECK (coalesce(data->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' AND data->>'updatedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' AND data->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$', false)),
  CHECK (coalesce(jsonb_typeof(data->'purgeAfter') = 'null' OR (data->>'purgeAfter') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$', false))
);
CREATE OR REPLACE FUNCTION prima.is_ceo_request() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM prima.users u
                  WHERE u.id = current_setting('app.user_id', true)
                    AND u.data->>'opsTier' = 'ceo'
                    AND NOT (u.data ? 'integration' AND u.data->>'integration' IS NOT NULL))
$$;
ALTER TABLE prima.it_import_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.it_import_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_own ON prima.it_import_reviews;
CREATE POLICY review_own ON prima.it_import_reviews
  USING (data->>'actorId' = 'u-fauzan' AND data->>'actorId' = current_setting('app.user_id', true) AND prima.is_ceo_request())
  WITH CHECK (data->>'actorId' = 'u-fauzan' AND data->>'actorId' = current_setting('app.user_id', true) AND prima.is_ceo_request());
-- The retention function below runs as the schema owner (the role running this setup), which this policy alone admits;
-- the app role never gets it.
DROP POLICY IF EXISTS review_tidy ON prima.it_import_reviews;
CREATE POLICY review_tidy ON prima.it_import_reviews TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION prima.it_import_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN OLD.data END;
  n jsonb := NEW.data;
  kept text[] := ARRAY['id', 'actorId', 'kind', 'createdAt', 'expiresAt', 'requestHash'];
  k text;
  -- Expiry and clearing happen only inside the retention function, which runs as the table's owner and audits them.
  by_tidy boolean := current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF n->>'status' IS DISTINCT FROM 'reviewing' OR n->'version' IS DISTINCT FROM '1'::jsonb OR n->'purged' IS DISTINCT FROM 'false'::jsonb
       OR n->'receipt' IS DISTINCT FROM 'null'::jsonb OR n->'purgeAfter' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'A new review starts open, at version 1, with nothing imported' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY kept LOOP
    IF NOT (n ? k) OR n->k IS DISTINCT FROM o->k THEN
      RAISE EXCEPTION 'A review keeps its owner, kind, start and expiry times' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF o->>'status' = 'reviewing' THEN
    IF n->>'status' IS NOT DISTINCT FROM 'expired' THEN
      -- Expiry: only by the retention function, only after its time, kept for 30 days from that time; only the
      -- status, the change time and the keeping time move.
      IF NOT by_tidy OR (o->>'expiresAt')::timestamptz > now()
         OR (n->>'purgeAfter')::timestamptz IS DISTINCT FROM (o->>'expiresAt')::timestamptz + interval '30 days'
         OR (n - '{status,updatedAt,purgeAfter}'::text[]) IS DISTINCT FROM (o - '{status,updatedAt,purgeAfter}'::text[]) THEN
        RAISE EXCEPTION 'A review expires only after its time, unchanged, through the retention job' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF (n->>'version')::bigint IS DISTINCT FROM (o->>'version')::bigint + 1 THEN
      RAISE EXCEPTION 'A review change must raise its version by one' USING ERRCODE = '23514';
    END IF;
    IF n->'purged' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'An open review keeps its rows' USING ERRCODE = '23514';
    END IF;
    IF n->>'status' IS NOT DISTINCT FROM 'reviewing' THEN
      IF n->'receipt' IS DISTINCT FROM 'null'::jsonb OR n->'purgeAfter' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'An open review has nothing imported' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Closing (committed or abandoned): the reviewed rows, fingerprint and preview stay exactly as approved or left,
    -- and the keeping time runs from now.
    IF n->>'status' NOT IN ('committed', 'abandoned') OR jsonb_typeof(n->'purgeAfter') IS DISTINCT FROM 'string'
       OR (n->>'purgeAfter')::timestamptz NOT BETWEEN now() + interval '29 days' AND now() + interval '31 days'
       OR n->'parts' IS DISTINCT FROM o->'parts' OR n->'counts' IS DISTINCT FROM o->'counts'
       OR n->'reviewedHash' IS DISTINCT FROM o->'reviewedHash' OR n->'previewToken' IS DISTINCT FROM o->'previewToken'
       OR (n->>'status' = 'committed' AND jsonb_typeof(n->'receipt') IS DISTINCT FROM 'object')
       OR (n->>'status' = 'abandoned' AND n->'receipt' IS DISTINCT FROM 'null'::jsonb) THEN
      RAISE EXCEPTION 'A review closes as it was reviewed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- A closed review: only clearing its reviewed rows, once, after its keeping time, by the retention function.
  -- Everything else stays, and each part keeps its extraction, source label, fingerprint and admission time.
  IF NOT by_tidy OR o->'purged' IS DISTINCT FROM 'false'::jsonb OR n->'purged' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(o->'purgeAfter') IS DISTINCT FROM 'string' OR (o->>'purgeAfter')::timestamptz > now()
     OR (n - '{parts,purged,updatedAt}'::text[]) IS DISTINCT FROM (o - '{parts,purged,updatedAt}'::text[])
     OR n->'parts' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(p || '{"rows": []}'::jsonb ORDER BY i), '[]'::jsonb)
                                       FROM jsonb_array_elements(o->'parts') WITH ORDINALITY AS e(p, i)) THEN
    RAISE EXCEPTION 'A closed review does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS it_import_review_guard ON prima.it_import_reviews;
CREATE TRIGGER it_import_review_guard BEFORE INSERT OR UPDATE ON prima.it_import_reviews
  FOR EACH ROW EXECUTE FUNCTION prima.it_import_review_guard();
GRANT SELECT, INSERT, UPDATE ON prima.it_import_reviews TO prima_app;
-- Appends one entry to the audit chain from inside the database, hashed exactly as packages/core/src/audit.ts does
-- (SHA-256 of the JSON array [seq, prevHash, at, actor, companyId, action, entity, entityId, summary]). Internal: no
-- role but the owner may call it; it exists so retention can never change a review without recording it.
CREATE OR REPLACE FUNCTION prima.audit_append_internal(actor text, action text, entity text, entity_id text, summary text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = prima, pg_temp AS $$
DECLARE
  prev_seq bigint;
  prev_hash text;
  at text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  seq bigint;
  hash text;
BEGIN
  SELECT h.seq, h.hash INTO prev_seq, prev_hash FROM prima.audit_head() h;
  seq := coalesce(prev_seq, 0) + 1;
  prev_hash := coalesce(prev_hash, repeat('0', 64));
  hash := encode(sha256(convert_to('[' || seq::text || ',' || to_json(prev_hash)::text || ',' || to_json(at)::text || ','
            || to_json(actor)::text || ',null,' || to_json(action)::text || ',' || to_json(entity)::text || ','
            || to_json(entity_id)::text || ',' || to_json(summary)::text || ']', 'UTF8')), 'hex');
  INSERT INTO prima.audit (seq, company_id, data)
  VALUES (seq, NULL, jsonb_build_object('at', at, 'actor', actor, 'companyId', NULL, 'action', action, 'entity', entity,
          'entityId', entity_id, 'summary', summary, 'seq', seq, 'prevHash', prev_hash, 'hash', hash));
END $$;
REVOKE ALL ON FUNCTION prima.audit_append_internal(text, text, text, text, text) FROM PUBLIC;
-- Retention (Fauzan, 31 Oct 2026: open 24 hours, keep 30 days). One statement each, so a review being approved at the
-- same moment is either approved first (and is no longer open) or expired first (and the approval is refused). Called
-- by the CEO's own review requests and by the daily job (npm run reviews:tidy, which sets app.job), and by nobody else.
-- Each change is written to the audit chain here, in the same transaction, so even a direct call cannot skip it; the
-- entry holds the review ID, kind and outcome, never a value. Expired reviews are kept 30 days from their expiry time.
CREATE OR REPLACE FUNCTION prima.tidy_it_import_reviews(by text) RETURNS TABLE (review_id text, review_kind text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = prima, pg_temp AS $$
DECLARE
  stamp text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  r record;
BEGIN
  IF by IS NULL OR length(btrim(by)) < 2 OR length(by) > 120 THEN
    RAISE EXCEPTION 'Say who is running the review clean-up' USING ERRCODE = '22023';
  END IF;
  IF NOT ((current_setting('app.user_id', true) = 'u-fauzan' AND prima.is_ceo_request())
          OR current_setting('app.job', true) IS NOT DISTINCT FROM 'review-tidy') THEN
    RAISE EXCEPTION 'Only the CEO''s own requests or the daily job tidy import reviews' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    WITH expired AS (
      UPDATE prima.it_import_reviews t
         SET data = t.data || jsonb_build_object('status', 'expired', 'updatedAt', stamp, 'purgeAfter',
               to_char(((t.data->>'expiresAt')::timestamptz + interval '30 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       WHERE t.data->>'status' = 'reviewing' AND (t.data->>'expiresAt')::timestamptz <= now()
      RETURNING t.id, t.data->>'kind' AS kind, 'expired'::text AS what)
    SELECT * FROM expired ORDER BY id
  LOOP
    PERFORM prima.audit_append_internal(btrim(by), 'it.import.review.' || CASE r.what WHEN 'expired' THEN 'expire' ELSE 'purge' END,
      'it_import_review', r.id, '{"kind":' || to_json(r.kind)::text || ',"outcome":' || to_json(r.what)::text || '}');
    review_id := r.id; review_kind := r.kind; outcome := r.what;
    RETURN NEXT;
  END LOOP;
  FOR r IN
    WITH cleared AS (
      UPDATE prima.it_import_reviews t
         SET data = t.data || jsonb_build_object('purged', true, 'updatedAt', stamp, 'parts',
               (SELECT coalesce(jsonb_agg(p || '{"rows": []}'::jsonb ORDER BY i), '[]'::jsonb)
                  FROM jsonb_array_elements(t.data->'parts') WITH ORDINALITY AS e(p, i)))
       WHERE t.data->>'status' <> 'reviewing' AND t.data->'purged' = 'false'::jsonb
         AND (t.data->>'purgeAfter')::timestamptz <= now()
      RETURNING t.id, t.data->>'kind' AS kind, 'purged'::text AS what)
    SELECT * FROM cleared ORDER BY id
  LOOP
    PERFORM prima.audit_append_internal(btrim(by), 'it.import.review.' || CASE r.what WHEN 'expired' THEN 'expire' ELSE 'purge' END,
      'it_import_review', r.id, '{"kind":' || to_json(r.kind)::text || ',"outcome":' || to_json(r.what)::text || '}');
    review_id := r.id; review_kind := r.kind; outcome := r.what;
    RETURN NEXT;
  END LOOP;
  RETURN;
END $$;
REVOKE ALL ON FUNCTION prima.tidy_it_import_reviews(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.tidy_it_import_reviews(text) TO prima_app;

-- Central IT register boundaries. These records are associations, NOT company access grants.
-- Role checks read the server-selected user; arbitrary app.walls/company_ids do not grant IT access.
CREATE OR REPLACE FUNCTION prima.it_record_permission(need text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
 SELECT coalesce(bool_or(
   coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
   AND (coalesce(u.data->>'accessClosedFrom','') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))
   AND CASE need
    WHEN 'read' THEN u.data->>'department' IN ('it','audit') OR u.data->>'opsTier' IN ('ceo','coo')
    WHEN 'asset_read' THEN NOT (coalesce(u.data->>'department','') IN ('hr','chief_of_staff')) AND (u.data->>'department' IN ('it','audit') OR u.data->>'opsTier' IN ('ceo','coo') OR u.data->>'leadership' = 'finance_director'
      OR u.data->>'role' = 'director' OR (u.data->>'role' = 'pwvsb_officer' AND (u.data->>'department' IN ('asset','finance') OR coalesce(u.data->>'leadership','') <> '')))
    WHEN 'write' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead','executive')
    WHEN 'manual' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead','executive')
    WHEN 'manager' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'it' AND u.data->>'itRole' = 'manager'
    WHEN 'lead' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead')
    WHEN 'ceo' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'opsTier' = 'ceo'
    ELSE false END),false)
 FROM prima.users u WHERE u.id = current_setting('app.user_id',true)
$$;
REVOKE ALL ON FUNCTION prima.it_record_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.it_record_permission(text) TO prima_app;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['it_onboarding','it_accounts','it_assets'] LOOP
  EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS it_register_read ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_register_read ON prima.%I FOR SELECT USING (prima.it_record_permission(%L))',t,CASE WHEN t='it_assets' THEN 'asset_read' ELSE 'read' END);
  EXECUTE format('DROP POLICY IF EXISTS it_register_insert ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_register_insert ON prima.%I FOR INSERT WITH CHECK (prima.it_record_permission(''write''))',t);
  EXECUTE format('DROP POLICY IF EXISTS it_register_update ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_register_update ON prima.%I FOR UPDATE USING (prima.it_record_permission(''write'') %s) WITH CHECK (prima.it_record_permission(''write'') %s)',t,CASE WHEN t='it_accounts' THEN 'OR prima.it_record_permission(''ceo'')' ELSE '' END,CASE WHEN t='it_accounts' THEN 'OR prima.it_record_permission(''ceo'')' ELSE '' END);
  -- Setup owner may seed/migrate; runtime role can never inherit this policy's owner role.
  EXECUTE format('DROP POLICY IF EXISTS it_register_setup ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_register_setup ON prima.%I TO CURRENT_USER USING (true) WITH CHECK (true)',t);
  EXECUTE format('REVOKE DELETE, TRUNCATE ON prima.%I FROM prima_app',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION prima.it_register_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
DECLARE k text; m jsonb := NEW.data->'manual'; o jsonb; old_step jsonb; new_step jsonb; step_changes integer := 0; step_index integer; c jsonb; v jsonb; allowed text[]; company text; canonical_old text; serial_key text; maxlen integer; minlen integer; procurement_admitted boolean := false;
BEGIN
 -- Administrative migration/seed is separate from application writes.
 IF current_user <> 'prima_app' THEN RETURN NEW; END IF;
 -- Same serialization key as the core create/correction transaction; raw writes cannot race serial checks.
 IF TG_TABLE_NAME='it_assets' AND (TG_OP='INSERT' OR NEW.data->'serial' IS DISTINCT FROM OLD.data->'serial') THEN PERFORM pg_advisory_xact_lock(hashtext('it-manual:create')); END IF;
 IF NEW.id IS DISTINCT FROM NEW.data->>'id' OR (TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id) THEN
  RAISE EXCEPTION 'IT record identity is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='it_assets' AND (TG_OP='INSERT' OR NEW.data->'serial' IS DISTINCT FROM OLD.data->'serial') THEN
   serial_key := regexp_replace(normalize(NEW.data->>'serial',NFKC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]','','g');
   IF serial_key<>'' AND serial_key !~ '^[A-Za-z0-9._:/+\-]+$' THEN RAISE EXCEPTION 'Known serial must normalize to ASCII identifier characters' USING ERRCODE='23514'; END IF;
   IF serial_key<>'' AND EXISTS(SELECT 1 FROM prima.it_assets a WHERE a.id<>NEW.id AND octet_length(regexp_replace(normalize(a.data->>'serial',NFKC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]','','g')) <> length(regexp_replace(normalize(a.data->>'serial',NFKC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]','','g'))) THEN
    RAISE EXCEPTION 'Reconcile ambiguous legacy identifiers before changing a known serial' USING ERRCODE='23514'; END IF;
   serial_key := upper(serial_key COLLATE "C");
   IF serial_key<>'' AND (serial_key !~ '[A-Z0-9]' OR EXISTS(SELECT 1 FROM prima.it_assets a WHERE a.id<>NEW.id AND upper(regexp_replace(normalize(a.data->>'serial',NFKC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]','','g'))=serial_key)) THEN
    RAISE EXCEPTION 'Serial is invalid or already recorded' USING ERRCODE='23514'; END IF;
  END IF;
 -- Correction is a distinct, version-bound operation; lifecycle allowlists below cannot mutate its evidence.
 IF TG_OP='INSERT' AND NEW.data ? 'correction' THEN
  RAISE EXCEPTION 'A new record cannot claim a prior correction' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.data->'correction' IS DISTINCT FROM OLD.data->'correction' THEN
  c := NEW.data->'correction';
  IF NOT prima.it_record_permission('write') OR jsonb_typeof(c) IS DISTINCT FROM 'object'
     OR NOT (c ?& ARRAY['version','at','byId','reason','requestId','previousHash'])
     OR (SELECT count(*) FROM jsonb_object_keys(c)) <> 6
     OR jsonb_typeof(c->'version') IS DISTINCT FROM 'number' OR coalesce(c->>'version','') !~ '^[1-9][0-9]*$'
     OR (c->>'version')::numeric > 9007199254740991
     OR (c->>'version')::numeric <> coalesce((OLD.data#>>'{correction,version}')::numeric,0)+1
     OR jsonb_typeof(c->'byId') IS DISTINCT FROM 'string' OR c->>'byId' IS DISTINCT FROM current_setting('app.user_id',true)
     OR jsonb_typeof(c->'at') IS DISTINCT FROM 'string' OR coalesce(c->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
     OR (c->>'at')::timestamptz > statement_timestamp()+interval '5 minutes'
     OR jsonb_typeof(c->'reason') IS DISTINCT FROM 'string' OR length(btrim(c->>'reason')) NOT BETWEEN 3 AND 500
     OR jsonb_typeof(c->'requestId') IS DISTINCT FROM 'string' OR coalesce(c->>'requestId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(c->'previousHash') IS DISTINCT FROM 'string' OR coalesce(c->>'previousHash','') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Correction evidence must be exact, actor-bound and consecutively versioned' USING ERRCODE='23514';
  END IF;
  -- Inline canonical JSON token walk: no grant to another module's private helper.
  WITH RECURSIVE nodes(v,path,prefix) AS (
   SELECT OLD.data, ARRAY[]::integer[], ''::text
   UNION ALL
   SELECT child.v, n.path||child.ord::integer,
     (CASE WHEN child.ord>1 THEN ',' ELSE '' END)||coalesce(to_jsonb(child.k)::text||':','')
   FROM nodes n CROSS JOIN LATERAL (
    SELECT value AS v,key AS k,row_number() OVER(ORDER BY key COLLATE "C") AS ord FROM jsonb_each(CASE WHEN jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END)
    UNION ALL
    SELECT value,NULL::text,ord FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v)='array' THEN n.v ELSE '[]'::jsonb END) WITH ORDINALITY a(value,ord)
   ) child
  ), tokens AS (
   SELECT token_node.path||0 AS path,token_node.prefix||CASE jsonb_typeof(token_node.v) WHEN 'object' THEN '{' WHEN 'array' THEN '[' ELSE token_node.v::text END AS token FROM nodes token_node
   UNION ALL SELECT token_node.path||2147483647,CASE jsonb_typeof(token_node.v) WHEN 'object' THEN '}' ELSE ']' END FROM nodes token_node WHERE jsonb_typeof(token_node.v) IN ('object','array')
  ) SELECT string_agg(canonical_tokens.token,'' ORDER BY canonical_tokens.path) INTO canonical_old FROM tokens canonical_tokens;
  IF c->>'previousHash' IS DISTINCT FROM encode(sha256(convert_to(canonical_old,'UTF8')),'hex') THEN
   RAISE EXCEPTION 'Correction source changed; reload before editing' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='it_assets' THEN
   IF OLD.data->>'status'='disposed' THEN RAISE EXCEPTION 'Disposed stock is immutable' USING ERRCODE='23514'; END IF;
   company := OLD.data->>'ownerId';
   IF company='unlinked' THEN
    IF OLD.data#>'{manual,companyId}' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unlinked stock needs manual provenance' USING ERRCODE='23514'; END IF;
   ELSIF company IS NULL OR NOT EXISTS(SELECT 1 FROM prima.users u WHERE u.id=current_setting('app.user_id',true) AND u.data->'companyIds' ? company AND (company IN ('pwvsb','merdeka') OR EXISTS(SELECT 1 FROM prima.companies co WHERE co.id=company))) THEN
    RAISE EXCEPTION 'Correction company is unavailable' USING ERRCODE='23514';
   END IF;
   allowed := ARRAY['serial','model','location','warrantyTo'];
  ELSIF TG_TABLE_NAME='it_accounts' AND OLD.data#>>'{manual,kind}'='system' THEN
   IF NOT prima.it_record_permission('lead') AND OLD.data#>>'{manual,createdById}' IS DISTINCT FROM current_setting('app.user_id',true) THEN
    RAISE EXCEPTION 'Only creator or IT lead corrects this system' USING ERRCODE='23514'; END IF;
   IF NEW.data->'name' IS DISTINCT FROM OLD.data->'name' AND (OLD.data->'reviewedOn' IS DISTINCT FROM 'null'::jsonb OR OLD.data->'access' IS DISTINCT FROM '[]'::jsonb) THEN
    RAISE EXCEPTION 'Reviewed systems cannot be renamed' USING ERRCODE='23514'; END IF;
   allowed := ARRAY['name','note'];
  ELSIF TG_TABLE_NAME='it_onboarding' AND OLD.data#>>'{manual,kind}'='intake' THEN
   IF NOT prima.it_record_permission('lead') AND OLD.data->>'ownerStaffId' IS DISTINCT FROM current_setting('app.user_id',true) THEN
    RAISE EXCEPTION 'Only assigned IT or lead corrects this intake' USING ERRCODE='23514'; END IF;
   IF jsonb_typeof(OLD.data->'steps') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.data->'steps') step WHERE step->'doneAt' IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'Intake with recorded work cannot be corrected' USING ERRCODE='23514'; END IF;
   IF OLD.data#>'{manual,personUserId}' IS DISTINCT FROM 'null'::jsonb AND NEW.data->'personName' IS DISTINCT FROM OLD.data->'personName' THEN
    RAISE EXCEPTION 'Linked person name is immutable' USING ERRCODE='23514'; END IF;
   allowed := ARRAY['on','jobTitle','personName'];
  ELSE RAISE EXCEPTION 'This record has no correction path' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME<>'it_assets' THEN
   IF OLD.data#>'{manual,companyId}' IS DISTINCT FROM 'null'::jsonb AND NOT EXISTS(SELECT 1 FROM prima.companies co JOIN prima.users u ON u.id=current_setting('app.user_id',true) WHERE co.id=OLD.data#>>'{manual,companyId}' AND u.data->'companyIds' ? co.id) THEN
    RAISE EXCEPTION 'Correction company is unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  IF (NEW.data-(allowed||ARRAY['correction'])) IS DISTINCT FROM (OLD.data-(allowed||ARRAY['correction']))
     OR (NEW.data-'correction') IS NOT DISTINCT FROM (OLD.data-'correction') THEN
   RAISE EXCEPTION 'Correction changes only the exact editable details' USING ERRCODE='23514'; END IF;
  FOREACH k IN ARRAY allowed||ARRAY['reason'] LOOP
   v := CASE WHEN k='reason' THEN c->k ELSE NEW.data->k END;
   IF k IN ('warrantyTo','on') THEN
    IF k='warrantyTo' AND v='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$'
       OR (v#>>'{}') NOT BETWEEN '1900-01-01' AND '2199-12-31'
       OR to_char((v#>>'{}')::date,'YYYY-MM-DD') IS DISTINCT FROM (v#>>'{}')
       OR (k='warrantyTo' AND coalesce(NEW.data->>'boughtOn','')<>'' AND (v#>>'{}')<NEW.data->>'boughtOn') THEN
     RAISE EXCEPTION 'Correction date is invalid' USING ERRCODE='23514'; END IF;
   ELSE
    maxlen := CASE k WHEN 'location' THEN 160 WHEN 'note' THEN 500 WHEN 'reason' THEN 500 ELSE 120 END;
    minlen := CASE WHEN k IN ('name','jobTitle','personName') THEN 2 WHEN k='reason' THEN 3 ELSE 0 END;
    IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(v#>>'{}')>maxlen OR length(btrim(v#>>'{}'))<minlen
       OR (v#>>'{}') ~ '[[:cntrl:]]' OR (v#>>'{}') ~* '(password|passwd|secret|access[_ -]?token|api[_ -]?key)\s*[:=]|bearer\s+\S+' THEN
     RAISE EXCEPTION 'Correction text is invalid or contains credentials' USING ERRCODE='23514'; END IF;
   END IF;
  END LOOP;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='it_onboarding' THEN
   IF (NEW.data->'ownerStaffId' IS DISTINCT FROM OLD.data->'ownerStaffId' AND NOT prima.it_record_permission('lead'))
      OR (NEW.data->'steps' IS DISTINCT FROM OLD.data->'steps' AND coalesce(OLD.data->>'ownerStaffId','') NOT IN ('',current_setting('app.user_id',true)) AND NOT prima.it_record_permission('lead')) THEN
    RAISE EXCEPTION 'Only assigned IT or its lead changes this checklist' USING ERRCODE='23514'; END IF;
   IF (NEW.data - ARRAY['steps','ownerStaffId']) IS DISTINCT FROM (OLD.data - ARRAY['steps','ownerStaffId']) THEN
    RAISE EXCEPTION 'Onboarding identity is immutable' USING ERRCODE='23514'; END IF;
   IF NEW.data->'steps' IS DISTINCT FROM OLD.data->'steps' THEN
    IF jsonb_typeof(NEW.data->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.data->'steps') <> jsonb_array_length(OLD.data->'steps') THEN
     RAISE EXCEPTION 'Checklist step identities are immutable' USING ERRCODE='23514'; END IF;
    FOR step_index IN 0..jsonb_array_length(OLD.data->'steps')-1 LOOP
     old_step := OLD.data->'steps'->step_index; new_step := NEW.data->'steps'->step_index;
     IF new_step IS DISTINCT FROM old_step THEN
      step_changes := step_changes + 1;
      IF (new_step - ARRAY['doneAt','by','byId','evidenceRef','version','changedById','changedAt','reopenReason']) IS DISTINCT FROM (old_step - ARRAY['doneAt','by','byId','evidenceRef','version','changedById','changedAt','reopenReason'])
         OR jsonb_typeof(new_step->'version') IS DISTINCT FROM 'number'
         OR coalesce(new_step->>'version','') !~ '^[0-9]+$'
         OR (new_step->>'version')::numeric > 9007199254740991
         OR (new_step->>'version')::bigint <> coalesce((old_step->>'version')::bigint,0)+1
         OR new_step->>'changedById' IS DISTINCT FROM current_setting('app.user_id',true)
         OR jsonb_typeof(new_step->'changedAt') IS DISTINCT FROM 'string'
         OR (new_step->>'changedAt')::timestamptz IS NULL THEN
       RAISE EXCEPTION 'Checklist step version or actor is invalid' USING ERRCODE='23514'; END IF;
      IF new_step->>'doneAt' IS NOT NULL THEN
       IF old_step->>'doneAt' IS NOT NULL OR jsonb_typeof(new_step->'doneAt') IS DISTINCT FROM 'string' OR (new_step->>'doneAt')::timestamptz IS NULL
          OR jsonb_typeof(new_step->'evidenceRef') IS DISTINCT FROM 'string'
          OR length(btrim(coalesce(new_step->>'evidenceRef',''))) NOT BETWEEN 3 AND 500
          OR new_step->>'byId' IS DISTINCT FROM current_setting('app.user_id',true)
          OR new_step->>'by' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id=current_setting('app.user_id',true))
          OR new_step->>'reopenReason' IS NOT NULL THEN
        RAISE EXCEPTION 'Recorded checklist work requires actor and evidence' USING ERRCODE='23514'; END IF;
      ELSE
       IF old_step->>'doneAt' IS NULL OR new_step->>'by' IS NOT NULL OR new_step->>'byId' IS NOT NULL OR new_step->>'evidenceRef' IS NOT NULL
          OR jsonb_typeof(new_step->'reopenReason') IS DISTINCT FROM 'string'
          OR length(btrim(coalesce(new_step->>'reopenReason',''))) NOT BETWEEN 3 AND 500 THEN
        RAISE EXCEPTION 'Reopening requires a reason and clears current completion evidence' USING ERRCODE='23514'; END IF;
      END IF;
     END IF;
    END LOOP;
    IF step_changes <> 1 THEN RAISE EXCEPTION 'Change one exact checklist step at a time' USING ERRCODE='23514'; END IF;
   END IF;
  ELSIF TG_TABLE_NAME='it_assets' THEN
   IF NEW.data->>'status'='disposed' AND OLD.data->>'status' IS DISTINCT FROM 'disposed' AND (NOT prima.it_record_permission('manager') OR OLD.data->>'status' IS DISTINCT FROM 'disposal_pending') THEN
    RAISE EXCEPTION 'Only IT Manager confirms pending disposal' USING ERRCODE='23514'; END IF;
   IF (NEW.data - ARRAY['status','assignedTo','lastCheckedOn','disposal','maintenance','nextServiceOn']) IS DISTINCT FROM (OLD.data - ARRAY['status','assignedTo','lastCheckedOn','disposal','maintenance','nextServiceOn']) THEN
    RAISE EXCEPTION 'Asset identity is immutable' USING ERRCODE='23514'; END IF;
  ELSE
   IF prima.it_record_permission('ceo') THEN
    IF (NEW.data - ARRAY['access','reviewedOn']) IS DISTINCT FROM (OLD.data - ARRAY['access','reviewedOn']) THEN
     RAISE EXCEPTION 'Use the existing CEO access decision only' USING ERRCODE='23514'; END IF;
   ELSE
    IF (NEW.data - 'manual') IS DISTINCT FROM (OLD.data - 'manual') THEN
     RAISE EXCEPTION 'IT metadata cannot alter system access or ownership' USING ERRCODE='23514'; END IF;
    o := OLD.data->'manual';
    IF NOT prima.it_record_permission('lead') AND o->>'itResponsibleId' IS DISTINCT FROM current_setting('app.user_id',true) THEN
     RAISE EXCEPTION 'Only assigned IT or its lead updates guidance' USING ERRCODE='23514'; END IF;
    IF coalesce(m->>'state','') NOT IN ('recorded','guidance_given','manually_checked')
       OR length(btrim(coalesce(m->>'guidanceNote',''))) < 3
       OR (m->>'state' <> 'recorded' AND length(btrim(coalesce(m->>'evidence',''))) < 3)
       OR (m->>'state' = 'manually_checked' AND (NOT prima.it_record_permission('manager') OR o->>'state' IS DISTINCT FROM 'guidance_given'
         OR coalesce(o->>'guidanceById','') = '' OR o->>'guidanceById' = current_setting('app.user_id',true)
         OR o->>'itResponsibleId' = current_setting('app.user_id',true)
         OR m->>'checkedById' IS DISTINCT FROM current_setting('app.user_id',true)))
       OR (m->>'state' <> 'manually_checked' AND coalesce(m->'checkedById','null'::jsonb) <> 'null'::jsonb)
       OR (m->>'state' = 'guidance_given' AND m->>'guidanceById' IS DISTINCT FROM current_setting('app.user_id',true))
       OR (m->>'state' <> 'guidance_given' AND coalesce(m->'guidanceById','null'::jsonb) IS DISTINCT FROM coalesce(o->'guidanceById','null'::jsonb))
       OR jsonb_typeof(m->'receipts') IS DISTINCT FROM 'array' OR jsonb_typeof(o->'receipts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(m->'receipts') <> jsonb_array_length(o->'receipts')+1
       OR ((m->'receipts') - (jsonb_array_length(m->'receipts')-1)) IS DISTINCT FROM o->'receipts'
       OR m->'receipts'->-1->>'userId' IS DISTINCT FROM current_setting('app.user_id',true)
       OR m->'receipts'->-1->'version' IS DISTINCT FROM m->'version' THEN
     RAISE EXCEPTION 'Guidance evidence and independent checker must match the acting person' USING ERRCODE='23514'; END IF;
    IF NOT prima.it_record_permission('manual') OR o->>'kind' IS DISTINCT FROM 'guidance'
       OR (m - ARRAY['version','state','evidence','guidanceNote','nextReviewOn','guidanceById','checkedById','updatedAt','receipts']) IS DISTINCT FROM (o - ARRAY['version','state','evidence','guidanceNote','nextReviewOn','guidanceById','checkedById','updatedAt','receipts'])
       OR coalesce((m->>'version')::integer,0) <> coalesce((o->>'version')::integer,0)+1 THEN
     RAISE EXCEPTION 'Guidance identity is immutable and versioned' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='it_onboarding' THEN
  IF coalesce(NEW.data->>'kind','') NOT IN ('join','leave') OR NEW.data->'steps' IS DISTINCT FROM
   (CASE WHEN NEW.data->>'kind'='join' THEN '[{"key":"identity","label":"Confirm identity and approved request","doneAt":null,"by":null},{"key":"accounts","label":"Record account setup evidence","doneAt":null,"by":null},{"key":"device","label":"Record device handover","doneAt":null,"by":null},{"key":"prima","label":"Record Prima access evidence","doneAt":null,"by":null},{"key":"training","label":"Record Microsoft 365 training","doneAt":null,"by":null}]'::jsonb ELSE '[{"key":"identity","label":"Confirm leaving instruction and date","doneAt":null,"by":null},{"key":"accounts","label":"Record external account closure evidence","doneAt":null,"by":null},{"key":"device","label":"Record device return","doneAt":null,"by":null},{"key":"prima","label":"Refer Prima closure to authorized HR/CEO","doneAt":null,"by":null},{"key":"handover","label":"Record handover evidence","doneAt":null,"by":null}]'::jsonb END) THEN
   RAISE EXCEPTION 'New intake starts with the exact uncompleted checklist, without claimed evidence or approval' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' AND m IS NULL THEN
  -- Optional separately reviewed procurement module, absent => no partial-receipt admission.
  IF TG_TABLE_NAME='it_assets' AND to_regprocedure('prima.ip_asset_admitted(jsonb)') IS NOT NULL THEN
   EXECUTE 'SELECT prima.ip_asset_admitted($1)' INTO procurement_admitted USING NEW.data;
  END IF;
  IF TG_TABLE_NAME <> 'it_assets' OR NEW.data->>'status' IS DISTINCT FROM 'spare' OR NEW.data->'assignedTo' IS DISTINCT FROM 'null'::jsonb
     OR (NOT coalesce(procurement_admitted,false) AND NOT EXISTS (SELECT 1 FROM prima.it_purchases p WHERE p.id=NEW.data->>'purchaseId' AND p.data->>'status'='received'
      AND p.data->>'ownerId'=NEW.data->>'ownerId' AND (p.data->'received'->'assetIds') ? NEW.id)) THEN
   RAISE EXCEPTION 'New stock needs manual admission or the existing received-purchase path' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='it_accounts' THEN
  IF NEW.data->'access' IS DISTINCT FROM '[]'::jsonb OR NEW.data->'reviewedOn' IS DISTINCT FROM 'null'::jsonb
     OR NEW.data->'mfa' IS DISTINCT FROM 'null'::jsonb OR NEW.data->>'masterKeptAt' IS DISTINCT FROM ''
     OR NOT EXISTS (SELECT 1 FROM prima.users u WHERE u.id=NEW.data->>'ownerId' AND u.data->>'opsTier'='ceo' AND u.data->>'role'='pwvsb_officer' AND u.data->>'name'=NEW.data->>'owner'
       AND coalesce(u.data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb)) THEN
   RAISE EXCEPTION 'A system starts with no access or provisioning claim and its CEO owner' USING ERRCODE='23514'; END IF;
 END IF;
 IF m IS NOT NULL THEN
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR m->>'connection' IS DISTINCT FROM 'not_connected'
     OR coalesce(m->>'state','') NOT IN ('recorded','guidance_given','manually_checked') THEN
   RAISE EXCEPTION 'Manual records are not connected' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF NOT prima.it_record_permission('manual')
      OR m->>'createdById' IS DISTINCT FROM current_setting('app.user_id',true)
      OR coalesce(m->>'createdAt','') !~ '^\d{4}-\d{2}-\d{2}T'
      OR m->'version' IS DISTINCT FROM '1'::jsonb OR m->>'state' IS DISTINCT FROM 'recorded'
      OR (TG_TABLE_NAME='it_onboarding' AND m->>'kind' IS DISTINCT FROM 'intake')
      OR (TG_TABLE_NAME='it_assets' AND m->>'kind' IS DISTINCT FROM 'asset')
      OR (TG_TABLE_NAME='it_accounts' AND coalesce(m->>'kind','') NOT IN ('system','guidance')) THEN
    RAISE EXCEPTION 'Manual admission identity is invalid' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='it_assets' AND (NEW.data->>'status' IS DISTINCT FROM 'spare' OR NEW.data->'assignedTo' IS DISTINCT FROM 'null'::jsonb
       OR NEW.data->'purchaseId' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'disposal' IS DISTINCT FROM 'null'::jsonb
       OR NEW.data->'maintenance' IS DISTINCT FROM '[]'::jsonb OR m->>'provenance' IS DISTINCT FROM 'existing_stock') THEN
    RAISE EXCEPTION 'Opening stock starts unassigned without a fabricated purchase or disposal' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='it_accounts' AND m->>'kind'='guidance' AND
      (coalesce(m->'checkedById','null'::jsonb) <> 'null'::jsonb OR coalesce(m->'guidanceById','null'::jsonb) <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'Guidance starts unconfirmed' USING ERRCODE='23514'; END IF;
   IF NOT (m ? 'companyId') OR jsonb_typeof(m->'companyId') NOT IN ('null','string') OR
      (TG_TABLE_NAME IN ('it_assets','it_onboarding') AND NEW.data->>'ownerId' IS DISTINCT FROM coalesce(m->>'companyId','unlinked')) OR (m->'companyId' <> 'null'::jsonb AND NOT EXISTS (SELECT 1 FROM prima.companies c WHERE c.id=m->>'companyId')) THEN
    RAISE EXCEPTION 'Manual company association must be a known company or explicitly pending' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION prima.it_register_guard() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['it_onboarding','it_accounts','it_assets'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS it_register_guard ON prima.%I',t);
  EXECUTE format('CREATE TRIGGER it_register_guard BEFORE INSERT OR UPDATE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.it_register_guard()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION prima.it_manual_receipt_valid(row_id text, d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, prima AS $$
 SELECT coalesce(d ?& ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at']
  AND (d - ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at']) = '{}'::jsonb
  AND d->>'id'=row_id AND row_id=(d->>'userId')||':'||(d->>'requestId')
  AND d->>'requestId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND d->>'kind' IN ('intake','system','guidance','asset') AND d->>'hash' ~ '^[0-9a-f]{64}$'
  AND d->>'outcome' IN ('committed','rejected')
  AND ((d->>'outcome'='committed' AND jsonb_typeof(d->'recordId')='string' AND length(d->>'recordId')>0 AND jsonb_typeof(d->'version')='number' AND d->>'version' ~ '^[1-9][0-9]{0,8}$' AND d->'message'='null'::jsonb)
   OR (d->>'outcome'='rejected' AND d->'recordId'='null'::jsonb AND d->'version'='null'::jsonb AND jsonb_typeof(d->'message')='string'))
  AND d->>'at' ~ '^\d{4}-\d{2}-\d{2}T',false)
$$;
REVOKE ALL ON FUNCTION prima.it_manual_receipt_valid(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.it_manual_receipt_valid(text,jsonb) TO prima_app;
CREATE TABLE IF NOT EXISTS prima.it_manual_receipts (
 id text PRIMARY KEY,
 data jsonb NOT NULL,
 CONSTRAINT it_manual_receipt_shape CHECK (prima.it_manual_receipt_valid(id,data))
);
ALTER TABLE prima.it_manual_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.it_manual_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS it_manual_owner ON prima.it_manual_receipts;
CREATE POLICY it_manual_owner ON prima.it_manual_receipts FOR SELECT USING (data->>'userId'=current_setting('app.user_id',true) AND prima.it_record_permission('manual'));
DROP POLICY IF EXISTS it_manual_insert ON prima.it_manual_receipts;
CREATE POLICY it_manual_insert ON prima.it_manual_receipts FOR INSERT WITH CHECK (data->>'userId'=current_setting('app.user_id',true) AND prima.it_record_permission('manual'));
DROP POLICY IF EXISTS it_manual_setup ON prima.it_manual_receipts;
CREATE POLICY it_manual_setup ON prima.it_manual_receipts TO CURRENT_USER USING (true) WITH CHECK (true);
REVOKE ALL ON prima.it_manual_receipts FROM prima_app;
GRANT SELECT, INSERT ON prima.it_manual_receipts TO prima_app;

-- Explicit IT rental and recorded six-calendar-month inspections. No scheduled health assertion.
CREATE TABLE IF NOT EXISTS prima.it_rental_rates(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_asset_inspections(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.it_operational_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prima.it_operations_permission(need text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(coalesce(u.data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb)
 AND (coalesce(u.data->>'accessClosedFrom','')='' OR u.data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))
 AND CASE need
 WHEN 'read' THEN coalesce(u.data->>'department','') NOT IN ('hr','chief_of_staff') AND (prima.it_record_permission('manual') OR u.data->>'opsTier' IN ('ceo','coo') OR u.data->>'department'='audit' OR u.data->>'leadership'='finance_director')
 WHEN 'finance' THEN u.data->>'leadership'='finance_director' AND coalesce(u.data->>'department','') NOT IN ('it','audit','hr','chief_of_staff') AND coalesce(u.data->>'opsTier','') NOT IN ('ceo','coo')
 ELSE false END),false) FROM prima.users u WHERE u.id=current_setting('app.user_id',true)
$$;
REVOKE ALL ON FUNCTION prima.it_operations_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.it_operations_permission(text) TO prima_app;
DO $$ DECLARE t text; r text; w text; BEGIN
 FOREACH t IN ARRAY ARRAY['it_rental_rates','it_asset_inspections','it_rental_bills','it_operational_receipts'] LOOP
  EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
  r:=CASE WHEN t='it_operational_receipts' THEN 'data->>''userId''=current_setting(''app.user_id'',true) AND prima.it_record_permission(''manual'')' ELSE 'prima.it_operations_permission(''read'')' END;
  w:=CASE WHEN t='it_rental_rates' THEN 'prima.it_record_permission(''manager'')' WHEN t='it_operational_receipts' THEN r ELSE 'prima.it_record_permission(''manual'')' END;
  EXECUTE format('DROP POLICY IF EXISTS it_ops_read ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_ops_read ON prima.%I FOR SELECT USING (%s)',t,r);
  EXECUTE format('DROP POLICY IF EXISTS it_ops_insert ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_ops_insert ON prima.%I FOR INSERT WITH CHECK (%s)',t,w);
  EXECUTE format('DROP POLICY IF EXISTS it_ops_setup ON prima.%I',t);
  EXECUTE format('CREATE POLICY it_ops_setup ON prima.%I TO CURRENT_USER USING (true) WITH CHECK (true)',t);
  EXECUTE format('REVOKE ALL ON prima.%I FROM prima_app',t);
  EXECUTE format('GRANT SELECT,INSERT ON prima.%I TO prima_app',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS it_ops_paid ON prima.it_rental_bills;
CREATE POLICY it_ops_paid ON prima.it_rental_bills FOR UPDATE USING(prima.it_operations_permission('finance')) WITH CHECK(prima.it_operations_permission('finance'));
GRANT UPDATE ON prima.it_rental_bills TO prima_app;
CREATE UNIQUE INDEX IF NOT EXISTS it_rate_version_unique ON prima.it_rental_rates ((data->>'version'));
CREATE UNIQUE INDEX IF NOT EXISTS it_inspection_version_unique ON prima.it_asset_inspections ((data->>'assetId'),(data->>'version'));
CREATE UNIQUE INDEX IF NOT EXISTS it_bill_period_unique ON prima.it_rental_bills ((data->>'companyId'),(data->>'period'));
CREATE OR REPLACE FUNCTION prima.it_operations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=NEW.data; a text:=current_setting('app.user_id',true); today date:=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date; n integer; rate jsonb; item jsonb; asset jsonb; job jsonb; subtotal numeric:=0; computed jsonb; kind text; cnt integer; price numeric; dt date;
BEGIN
 IF current_user<>'prima_app' THEN RETURN NEW; END IF;
 IF NEW.id IS DISTINCT FROM d->>'id' THEN RAISE EXCEPTION 'IT operation identity mismatch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME<>'it_rental_bills' OR NOT prima.it_operations_permission('finance') OR NEW.id IS DISTINCT FROM OLD.id OR (d-'paid') IS DISTINCT FROM (OLD.data-'paid') OR coalesce(OLD.data->'paid','null'::jsonb)<>'null'::jsonb OR jsonb_typeof(d->'paid') IS DISTINCT FROM 'object' OR ((d->'paid')-ARRAY['by','at','ref'])<>'{}'::jsonb OR length(trim(coalesce(d#>>'{paid,ref}','')))<3 OR d#>>'{paid,by}' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id=a) OR ((d#>>'{paid,at}')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date IS DISTINCT FROM today THEN RAISE EXCEPTION 'Only Finance may record payment; snapshot immutable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='it_operational_receipts' THEN
  IF NOT prima.it_record_permission('manual') OR d->>'userId' IS DISTINCT FROM a OR NEW.id IS DISTINCT FROM a||':'||(d->>'requestId') OR coalesce(d->>'requestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR coalesce(d->>'hash','')!~'^[0-9a-f]{64}$' OR coalesce(d->>'kind','') NOT IN ('rental_rates','rental_bill','rental_history','asset_inspection') OR (d-ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at'])<>'{}'::jsonb OR (d->>'at')::timestamptz IS NULL THEN RAISE EXCEPTION 'Invalid operation receipt'; END IF;
  IF ((d->>'outcome'='committed' AND length(coalesce(d->>'recordId',''))>0 AND coalesce(d->>'version','')~'^[1-9][0-9]{0,8}$' AND d->'message'='null'::jsonb) OR (d->>'outcome'='rejected' AND d->'recordId'='null'::jsonb AND d->'version'='null'::jsonb AND jsonb_typeof(d->'message')='string')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid terminal operation receipt'; END IF;
  RETURN NEW;
 END IF;
 IF NOT prima.it_record_permission('manual') THEN RAISE EXCEPTION 'IT actor required'; END IF;
 IF TG_TABLE_NAME IN ('it_rental_rates','it_asset_inspections') THEN
  IF d->>'byId' IS DISTINCT FROM a OR (d->>'at')::timestamptz IS NULL OR length(trim(coalesce(d->>'evidence','')))<3 OR coalesce(d->>'version','')!~'^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'Actor, evidence and version required'; END IF;
 END IF;
 IF TG_TABLE_NAME='it_rental_rates' THEN
  IF NOT prima.it_record_permission('manager') OR d->>'currency' IS DISTINCT FROM 'MYR' OR jsonb_typeof(d->'monthly') IS DISTINCT FROM 'object' OR d->'monthly'='{}'::jsonb THEN RAISE EXCEPTION 'Manager rate approval required'; END IF;
  dt:=(d->>'effectiveOn')::date;
  IF dt IS NULL OR to_char(dt,'YYYY-MM-DD') IS DISTINCT FROM d->>'effectiveOn' OR extract(day FROM dt)<>1 THEN RAISE EXCEPTION 'Monthly effective date required'; END IF;
  SELECT coalesce(max((data->>'version')::integer),0)+1 INTO n FROM prima.it_rental_rates;
  IF (d->>'version')::integer<>n THEN RAISE EXCEPTION 'Stale rate version'; END IF;
  FOR kind,item IN SELECT key,value FROM jsonb_each(d->'monthly') LOOP
   IF kind NOT IN ('LAPTOP','DESKTOP','PHONE','TABLET','PRINTER','NETWORK','CCTV','OTHER') OR jsonb_typeof(item)<>'number' OR (item::text)::numeric<0 OR (item::text)::numeric>10000000 OR trunc((item::text)::numeric,2)<>(item::text)::numeric THEN RAISE EXCEPTION 'Invalid MYR rate'; END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='it_asset_inspections' THEN
  SELECT data INTO asset FROM prima.it_assets WHERE id=d->>'assetId' FOR SHARE;
  SELECT data INTO job FROM prima.it_jobs WHERE id=d->>'jobId' FOR SHARE;
  IF job IS NULL OR job->>'assigneeId' IS DISTINCT FROM a OR coalesce(job->>'status','') NOT IN ('todo','doing','returned') THEN RAISE EXCEPTION 'Own assigned open inspection job required'; END IF;
  IF asset IS NULL OR asset->>'status'='disposed' OR coalesce(d->>'condition','') NOT IN ('healthy','attention','unsafe') OR length(trim(coalesce(d->>'findings','')))<3 OR (d->>'condition'<>'healthy' AND length(trim(coalesce(d->>'followUp','')))<3) THEN RAISE EXCEPTION 'Inspection evidence required'; END IF;
  dt:=(d->>'inspectedOn')::date;
  IF dt IS NULL OR to_char(dt,'YYYY-MM-DD') IS DISTINCT FROM d->>'inspectedOn' OR dt>today OR d->>'nextDueOn' IS DISTINCT FROM to_char(dt+interval '6 months','YYYY-MM-DD') THEN RAISE EXCEPTION 'Invalid inspection due date'; END IF;
  SELECT coalesce(max((data->>'version')::integer),0)+1 INTO n FROM prima.it_asset_inspections WHERE data->>'assetId'=d->>'assetId';
  IF (d->>'version')::integer<>n OR EXISTS(SELECT 1 FROM prima.it_asset_inspections WHERE data->>'assetId'=d->>'assetId' AND data->>'inspectedOn'>d->>'inspectedOn') THEN RAISE EXCEPTION 'Stale inspection'; END IF;
 ELSIF TG_TABLE_NAME='it_rental_bills' THEN
  IF d->>'createdById' IS DISTINCT FROM a OR d->>'issuedBy' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id=a) OR (d->>'issuedAt')::timestamptz IS NULL OR coalesce(d->>'requestId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR d->>'currency' IS DISTINCT FROM 'MYR' OR d->'paid' IS DISTINCT FROM 'null'::jsonb OR coalesce(d->>'source','') NOT IN ('configured_rates','historical_record') OR length(trim(coalesce(d->>'evidence','')))<3 OR length(trim(coalesce(d->>'invoiceRef','')))<3 OR NOT EXISTS(SELECT 1 FROM prima.companies WHERE id=d->>'companyId') THEN RAISE EXCEPTION 'Explicit rental billing data required'; END IF;
  dt:=((d->>'period')||'-01')::date;
  IF dt IS NULL OR to_char(dt,'YYYY-MM') IS DISTINCT FROM d->>'period' OR dt>date_trunc('month',today) OR jsonb_typeof(d->'total') IS DISTINCT FROM 'number' OR (d->>'total')::numeric<0 OR trunc((d->>'total')::numeric,2)<>(d->>'total')::numeric THEN RAISE EXCEPTION 'Invalid monthly bill'; END IF;
  IF d->>'source'='historical_record' THEN
   IF d->'lines' IS DISTINCT FROM '[]'::jsonb OR d->'assetSnapshot' IS DISTINCT FROM '[]'::jsonb OR d->'rateId' IS DISTINCT FROM 'null'::jsonb OR d->'rateVersion' IS DISTINCT FROM 'null'::jsonb OR d->'rateEffectiveOn' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'History must not invent rates or assets'; END IF;
  ELSE
   SELECT data INTO rate FROM prima.it_rental_rates WHERE data->>'effectiveOn'<=to_char(dt,'YYYY-MM-DD') ORDER BY data->>'effectiveOn' DESC,(data->>'version')::integer DESC LIMIT 1;
   IF rate IS NULL OR d->>'rateId' IS DISTINCT FROM rate->>'id' OR d->'rateVersion' IS DISTINCT FROM rate->'version' OR d->'rateEffectiveOn' IS DISTINCT FROM rate->'effectiveOn' OR jsonb_typeof(d->'assetSnapshot') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'assetSnapshot')=0 THEN RAISE EXCEPTION 'Applicable rate and asset snapshot required'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(d->'assetSnapshot'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(d->'assetSnapshot') x) THEN RAISE EXCEPTION 'Duplicate asset snapshot'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(d->'assetSnapshot') ORDER BY value->>'id' LOOP
    SELECT data INTO asset FROM prima.it_assets WHERE id=item->>'id' FOR SHARE;
    IF asset IS NULL OR item->>'version' IS DISTINCT FROM encode(sha256(convert_to('['||coalesce((asset->'id')::text,'null')||','||coalesce((asset->'tag')::text,'null')||','||coalesce((asset->'kind')::text,'null')||','||coalesce((asset->'ownerId')::text,'null')||','||coalesce((asset->'status')::text,'null')||','||coalesce((asset->'assignedTo')::text,'null')||','||coalesce(nullif((asset#>'{manual,version}')::text,'null'),'0')||CASE WHEN asset ? 'correction' THEN ','||(asset#>'{correction,version}')::text ELSE '' END||']','UTF8')),'hex') OR asset->>'ownerId' IS DISTINCT FROM d->>'companyId' OR coalesce(asset->>'status','') NOT IN ('in_use','repair') OR (item-ARRAY['version']) IS DISTINCT FROM jsonb_build_object('id',asset->>'id','tag',asset->>'tag','kind',asset->>'kind','ownerId',asset->>'ownerId','status',asset->>'status') OR EXISTS(SELECT 1 FROM prima.it_rental_bills b, LATERAL jsonb_array_elements(coalesce(b.data->'assetSnapshot','[]'::jsonb)) x WHERE b.data->>'period'=d->>'period' AND x->>'id'=item->>'id') THEN RAISE EXCEPTION 'Asset snapshot stale or already billed'; END IF;
   END LOOP;
   computed:='[]'::jsonb;
   FOR kind,cnt IN SELECT x->>'kind',count(*)::integer FROM jsonb_array_elements(d->'assetSnapshot') x GROUP BY x->>'kind' ORDER BY x->>'kind' LOOP
    price:=(rate->'monthly'->>kind)::numeric;
    IF price IS NULL THEN RAISE EXCEPTION 'Missing approved rate'; END IF;
    computed:=computed||jsonb_build_array(jsonb_build_object('kind',kind,'count',cnt,'rate',price,'amount',price*cnt));subtotal:=subtotal+price*cnt;
   END LOOP;
   IF d->'lines' IS DISTINCT FROM computed OR (d->>'total')::numeric<>subtotal THEN RAISE EXCEPTION 'Immutable billing calculation mismatch'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION prima.it_operations_guard() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['it_rental_rates','it_asset_inspections','it_rental_bills','it_operational_receipts'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS it_operations_guard ON prima.%I',t);
 EXECUTE format('CREATE TRIGGER it_operations_guard BEFORE INSERT OR UPDATE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.it_operations_guard()',t);
END LOOP; END $$;

-- HR/IT staged coordination only. No user, grant or Microsoft identity mutation.
CREATE TABLE IF NOT EXISTS prima.hr_it_requests(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.hr_it_approvals(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.hr_it_delegations(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.hr_it_authority_mappings(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS prima.hr_it_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prima.hr_it_active(u jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(u IS NOT NULL AND coalesce(u->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND u->>'role'<>'site_device' AND (coalesce(u->>'accessClosedFrom','')='' OR u->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD')),false)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_role(u jsonb,k text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(prima.hr_it_active(u) AND CASE k WHEN 'hr' THEN u->>'department'='hr' WHEN 'cos' THEN u->>'leadership'='cos' WHEN 'lead' THEN u->>'role'='pwvsb_officer' AND u->>'department'='it' AND u->>'itRole'='lead' WHEN 'manager' THEN u->>'role'='pwvsb_officer' AND u->>'department'='it' AND u->>'itRole'='manager' WHEN 'executive' THEN u->>'role'='pwvsb_officer' AND u->>'department'='it' AND u->>'itRole'='executive' ELSE false END,false)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_mapping(m jsonb,u text,k text,c text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(m->>'userId'=u AND m->>'kind'=k AND m->>'companyId'=c AND m->'active'='true'::jsonb AND (m->>'validFrom')::date<=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date AND (m->'validUntil'='null'::jsonb OR (m->>'validUntil')::date>=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),false)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_delegated(d jsonb,u jsonb,r jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(prima.hr_it_role(u,'executive') AND d->>'delegateId'=u->>'id' AND d->>'requestId'=r->>'id' AND d->>'targetKey'=(r#>>'{subject,kind}')||':'||(r#>>'{subject,id}') AND d->>'task' IN ('collect_identity_details','prepare_link_request') AND d->>'status'='approved' AND (d->>'expiresAt')::timestamptz>now() AND EXISTS(SELECT 1 FROM prima.users WHERE id=d->>'approvedById' AND prima.hr_it_role(data,'manager')) AND EXISTS(SELECT 1 FROM prima.users WHERE id=d->>'requestedById' AND prima.hr_it_role(data,'lead')),false)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_visible(r jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(prima.hr_it_active(u.data) AND (r->>'targetUserId'=u.id OR (r#>>'{subject,kind}'='hr_person' AND r#>>'{subject,id}'=u.data->>'personId') OR prima.hr_it_role(u.data,'lead') OR prima.hr_it_role(u.data,'manager') OR prima.hr_it_role(u.data,'cos') OR (prima.hr_it_role(u.data,'hr') AND u.data->'companyIds' ? (r->>'companyId')) OR EXISTS(SELECT 1 FROM prima.hr_it_authority_mappings m WHERE prima.hr_it_mapping(m.data,u.id,'company_head',r->>'companyId') OR prima.hr_it_mapping(m.data,u.id,'hr_administrator',r->>'companyId')) OR EXISTS(SELECT 1 FROM prima.hr_it_delegations d WHERE prima.hr_it_delegated(d.data,u.data,r))),false) FROM prima.users u WHERE u.id=current_setting('app.user_id',true)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_mapping_visible(m jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
 SELECT coalesce(prima.hr_it_active(u.data) AND (m->>'userId'=u.id OR prima.hr_it_role(u.data,'lead') OR prima.hr_it_role(u.data,'manager') OR prima.hr_it_role(u.data,'cos') OR (prima.hr_it_role(u.data,'hr') AND u.data->'companyIds' ? (m->>'companyId')) OR EXISTS(SELECT 1 FROM prima.hr_it_requests r WHERE r.data->>'companyId'=m->>'companyId' AND prima.hr_it_visible(r.data))),false) FROM prima.users u WHERE u.id=current_setting('app.user_id',true)
$$;
CREATE OR REPLACE FUNCTION prima.hr_it_canonical(j jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,prima AS $$
DECLARE result text; BEGIN
 IF jsonb_typeof(j)='object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||prima.hr_it_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(j); RETURN result;
 ELSIF jsonb_typeof(j)='array' THEN SELECT '['||coalesce(string_agg(prima.hr_it_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(j) WITH ORDINALITY a(value,ord);RETURN result; END IF;
 RETURN j::text;
END $$;
CREATE OR REPLACE FUNCTION prima.hr_it_subject_current(r jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
DECLARE u jsonb;p jsonb;n integer;BEGIN
 IF r#>>'{subject,kind}'='existing_user' THEN SELECT data INTO u FROM prima.users WHERE id=r#>>'{subject,id}';IF u IS NULL OR NOT coalesce(u->'companyIds' ? (r->>'companyId'),false) THEN RETURN false;END IF;
 ELSIF r#>>'{subject,kind}'='hr_person' THEN SELECT data INTO p FROM prima.people WHERE id=r#>>'{subject,id}';IF p IS NULL OR p->>'companyId' IS DISTINCT FROM r->>'companyId' THEN RETURN false;END IF;SELECT count(*) INTO n FROM prima.users WHERE data->>'personId'=r#>>'{subject,id}';IF n>1 THEN RETURN false;END IF;SELECT data INTO u FROM prima.users WHERE data->>'personId'=r#>>'{subject,id}';
 ELSE RETURN false;END IF;
 RETURN coalesce((u->>'id' IS NOT DISTINCT FROM r->>'targetUserId') AND (u IS NULL OR (coalesce(u->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND u->>'role' NOT IN ('director','site_device') AND coalesce(u->>'leadership','')='' AND coalesce(u->>'opsTier','') NOT IN ('ceo','coo') AND NOT(prima.hr_it_role(u,'lead') OR prima.hr_it_role(u,'manager') OR prima.hr_it_role(u,'executive')) AND NOT EXISTS(SELECT 1 FROM prima.hr_it_authority_mappings z WHERE prima.hr_it_mapping(z.data,u->>'id','company_head',z.data->>'companyId') OR prima.hr_it_mapping(z.data,u->>'id','hr_administrator',z.data->>'companyId')) AND coalesce(u->'companyIds' ? (r->>'companyId'),false) AND (r->>'workflow'='offboard' OR prima.hr_it_active(u)))),false);
END $$;
CREATE OR REPLACE FUNCTION prima.hr_it_latest_approval(r jsonb,k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
DECLARE x jsonb;u jsonb;m jsonb;BEGIN
 SELECT data INTO x FROM prima.hr_it_approvals WHERE data->>'requestId'=r->>'id' AND data->'version'=r->'version' AND data->'hash'=r->'hash' AND data->>'kind'=k ORDER BY (data->>'sequence')::integer DESC LIMIT 1;
 SELECT data INTO u FROM prima.users WHERE id=x->>'actorId';
 IF x IS NULL OR x->>'decision'<>'approve' OR NOT prima.hr_it_active(u) OR x->>'actorId' IN (r->>'createdById',coalesce(r->>'targetUserId','')) OR (r#>>'{subject,kind}'='hr_person' AND u->>'personId'=r#>>'{subject,id}') THEN RETURN NULL;END IF;
 IF k='cos' THEN IF NOT prima.hr_it_role(u,'cos') THEN RETURN NULL;END IF;
 ELSE SELECT data INTO m FROM prima.hr_it_authority_mappings WHERE id=x->>'mappingId';IF m IS NULL OR m->'version' IS DISTINCT FROM x->'mappingVersion' OR NOT prima.hr_it_mapping(m,u->>'id',CASE WHEN k='hr_review' THEN 'hr_administrator' ELSE 'company_head' END,r->>'companyId') THEN RETURN NULL;END IF;END IF;
 RETURN x;
END $$;
CREATE OR REPLACE FUNCTION prima.hr_it_validate(t text,o jsonb,d jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,prima AS $$
DECLARE a text:=current_setting('app.user_id',true);u jsonb;r jsonb;p jsonb;last jsonb;act text;m jsonb;v jsonb;peer jsonb;target jsonb;delegate jsonb;requester jsonb;approver jsonb;n integer;own boolean;scope boolean;valid boolean;h text;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:hr-it'));
 -- Stabilize authority rows while deciding; app never writes these tables.
 PERFORM 1 FROM prima.users ORDER BY id FOR SHARE;
 PERFORM 1 FROM prima.hr_it_authority_mappings ORDER BY id FOR SHARE;
 SELECT data INTO u FROM prima.users WHERE id=a;
 IF NOT coalesce(prima.hr_it_active(u),false) THEN RAISE EXCEPTION 'Active human actor required';END IF;
 IF t='hr_it_receipts' THEN
  IF o IS NOT NULL OR d->>'userId' IS DISTINCT FROM a OR d->>'id' IS DISTINCT FROM a||':'||(d->>'operationId') OR coalesce(d->>'operationId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR coalesce(d->>'hash','')!~'^[0-9a-f]{64}$' OR coalesce(d->>'kind','') NOT IN ('collection','request','edit','submit','technical','self_details','scope_review','hr_review','delegation_request','delegation_decision','cancel') OR (d->>'at')::timestamptz IS NULL THEN RAISE EXCEPTION 'Invalid receipt';END IF;
  IF ((d->>'outcome'='committed' AND length(coalesce(d->>'recordId',''))>0 AND coalesce(d->>'version','')~'^[1-9][0-9]{0,8}$' AND d->'message'='null'::jsonb) OR (d->>'outcome'='rejected' AND d->'recordId'='null'::jsonb AND d->'version'='null'::jsonb AND jsonb_typeof(d->'message')='string')) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid terminal receipt';END IF;RETURN;
 END IF;
 IF t='hr_it_requests' THEN
  p:=jsonb_build_object('proposedRole',d->'proposedRole','startOn',d->'startOn','reason',d->'reason','technical',d->'technical','collectedDetails',d->'collectedDetails','selfDetails',d->'selfDetails','status',d->'status');
  IF coalesce(d->>'workflow','') NOT IN ('onboard','offboard') OR coalesce(d->>'proposedRole','') NOT IN ('pwvsb_officer','company_manager','admin_exec','supervisor','guard') OR coalesce(d->>'version','')!~'^[1-9][0-9]{0,8}$' OR jsonb_typeof(d->'history') IS DISTINCT FROM 'array' OR (d->>'startOn')::date IS NULL OR to_char((d->>'startOn')::date,'YYYY-MM-DD') IS DISTINCT FROM d->>'startOn' OR coalesce(d->>'status','') NOT IN ('draft','submitted','cancelled') OR length(trim(coalesce(d->>'reason','')))<3 THEN RAISE EXCEPTION 'Invalid staged scope';END IF;
  n:=jsonb_array_length(d->'history');last:=d->'history'->(n-1);act:=last->>'action';
  h:=encode(sha256(convert_to(prima.hr_it_canonical(jsonb_build_object('workflow',d->'workflow','subject',d->'subject','targetUserId',d->'targetUserId','companyId',d->'companyId','version',d->'version','payload',p)),'UTF8')),'hex');
  IF n<>(d->>'version')::integer OR d->>'hash' IS DISTINCT FROM h OR last->>'hash' IS DISTINCT FROM h OR last->'version' IS DISTINCT FROM d->'version' OR last->>'byId' IS DISTINCT FROM a OR last->'payload' IS DISTINCT FROM p OR (last->>'at')::timestamptz IS NULL THEN RAISE EXCEPTION 'Invalid immutable revision';END IF;
  IF o IS NULL AND (d->>'createdAt')::timestamptz IS NULL THEN RAISE EXCEPTION 'Creation timestamp required';END IF;
  scope:=coalesce(prima.hr_it_role(u,'hr') AND u->'companyIds' ? (d->>'companyId'),false);
  own:=coalesce(d->>'targetUserId'=a OR (d#>>'{subject,kind}'='hr_person' AND u->>'personId'=d#>>'{subject,id}'),false);
  IF o IS NULL THEN
   IF NOT scope OR own OR act IS DISTINCT FROM 'request' OR d->'version'<>'1'::jsonb OR d->>'createdById' IS DISTINCT FROM a OR d->>'status' IS DISTINCT FROM 'draft' OR d->'selfDetails' IS DISTINCT FROM 'null'::jsonb OR d->'collectedDetails' IS DISTINCT FROM 'null'::jsonb OR d->'technical' IS DISTINCT FROM '{"tenantId":null,"oid":null,"upnLabel":"","evidenceRef":"","recordedById":null,"delegationId":null}'::jsonb THEN RAISE EXCEPTION 'Scoped HR creates draft only';END IF;
  ELSE
   IF (d-ARRAY['proposedRole','startOn','reason','technical','collectedDetails','selfDetails','status','version','hash','history']) IS DISTINCT FROM (o-ARRAY['proposedRole','startOn','reason','technical','collectedDetails','selfDetails','status','version','hash','history']) OR (d->>'version')::integer<>(o->>'version')::integer+1 OR ((d->'history')-(n-1)) IS DISTINCT FROM o->'history' OR (o->>'status'='cancelled' AND act<>'delegation_decision') THEN RAISE EXCEPTION 'Identity and history immutable';END IF;
   IF act IN ('edit','submit','cancel') THEN
    IF NOT scope OR d->'technical' IS DISTINCT FROM o->'technical' OR d->'selfDetails' IS DISTINCT FROM o->'selfDetails' OR d->'collectedDetails' IS DISTINCT FROM o->'collectedDetails' OR (act='edit' AND d->>'status'<>'draft') OR (act='submit' AND (d->>'status'<>'submitted' OR (p-'status') IS DISTINCT FROM ((last->'payload')-'status'))) THEN RAISE EXCEPTION 'Scoped HR revision required';END IF;
    IF act IN ('submit','cancel') AND (d-ARRAY['status','reason','version','hash','history']) IS DISTINCT FROM (o-ARRAY['status','reason','version','hash','history']) THEN RAISE EXCEPTION 'Invalid submit/cancel fields';END IF;
    IF act='submit' AND d->'reason' IS DISTINCT FROM o->'reason' THEN RAISE EXCEPTION 'Submit cannot edit reason';END IF;
    IF act='cancel' AND d->>'status'<>'cancelled' THEN RAISE EXCEPTION 'Cancellation required';END IF;
   ELSIF act='self_details' THEN
    IF NOT own OR (d-ARRAY['selfDetails','version','hash','history']) IS DISTINCT FROM (o-ARRAY['selfDetails','version','hash','history']) OR d#>>'{selfDetails,byId}' IS DISTINCT FROM a THEN RAISE EXCEPTION 'Self details only';END IF;
   ELSIF act='collection' THEN
    IF own OR (d-ARRAY['collectedDetails','version','hash','history']) IS DISTINCT FROM (o-ARRAY['collectedDetails','version','hash','history']) OR d#>>'{collectedDetails,byId}' IS DISTINCT FROM a THEN RAISE EXCEPTION 'Collection-only revision required';END IF;
    IF prima.hr_it_role(u,'lead') THEN IF d#>'{collectedDetails,delegationId}' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Lead cannot impersonate delegation';END IF;
    ELSE SELECT data INTO v FROM prima.hr_it_delegations WHERE id=d#>>'{collectedDetails,delegationId}';IF NOT coalesce(prima.hr_it_delegated(v,u,d),false) OR v->>'task' IS DISTINCT FROM 'collect_identity_details' THEN RAISE EXCEPTION 'Current collection-only delegation required';END IF;END IF;
   ELSIF act='technical' THEN
    IF own OR (d-ARRAY['technical','version','hash','history']) IS DISTINCT FROM (o-ARRAY['technical','version','hash','history']) OR d#>>'{technical,recordedById}' IS DISTINCT FROM a THEN RAISE EXCEPTION 'Technical-only revision required';END IF;
    IF prima.hr_it_role(u,'lead') THEN IF d#>'{technical,delegationId}' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Lead cannot impersonate delegation';END IF;
    ELSE SELECT data INTO v FROM prima.hr_it_delegations WHERE id=d#>>'{technical,delegationId}';IF NOT coalesce(prima.hr_it_delegated(v,u,d),false) OR v->>'task' IS DISTINCT FROM 'prepare_link_request' THEN RAISE EXCEPTION 'Current bounded delegation required';END IF;END IF;
    IF coalesce(d#>>'{technical,tenantId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR d#>>'{technical,tenantId}' IS DISTINCT FROM nullif(current_setting('app.hr_it_tenant',true),'') OR coalesce(d#>>'{technical,oid}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR d#>>'{technical,oid}'='00000000-0000-0000-0000-000000000000' THEN RAISE EXCEPTION 'Trusted tenant and object ID required';END IF;
    IF EXISTS(SELECT 1 FROM prima.users WHERE lower(data->>'entraOid')=d#>>'{technical,oid}' AND id IS DISTINCT FROM d->>'targetUserId') OR EXISTS(SELECT 1 FROM prima.users WHERE id=d->>'targetUserId' AND coalesce(data->>'entraOid','')<>'' AND lower(data->>'entraOid') IS DISTINCT FROM d#>>'{technical,oid}') OR EXISTS(SELECT 1 FROM prima.hr_it_requests x WHERE x.id<>d->>'id' AND x.data->>'status'<>'cancelled' AND x.data#>>'{technical,oid}'=d#>>'{technical,oid}' AND x.data->'subject' IS DISTINCT FROM d->'subject') THEN RAISE EXCEPTION 'Identity reconciliation required';END IF;
   ELSIF act IN ('delegation_request','delegation_decision') THEN
    IF p IS DISTINCT FROM jsonb_build_object('proposedRole',o->'proposedRole','startOn',o->'startOn','reason',o->'reason','technical',o->'technical','collectedDetails',o->'collectedDetails','selfDetails',o->'selfDetails','status',o->'status') OR (act='delegation_request' AND NOT prima.hr_it_role(u,'lead')) OR (act='delegation_decision' AND NOT prima.hr_it_role(u,'manager')) THEN RAISE EXCEPTION 'Delegation revision cannot alter scope';END IF;
   ELSE RAISE EXCEPTION 'Unsupported revision';END IF;
  END IF;
  IF act NOT IN ('cancel','delegation_decision') AND NOT coalesce(prima.hr_it_subject_current(d),false) THEN RAISE EXCEPTION 'Authoritative subject changed';END IF;
  IF d->>'status'<>'cancelled' AND EXISTS(SELECT 1 FROM prima.hr_it_requests x WHERE x.id<>d->>'id' AND x.data->>'status'<>'cancelled' AND x.data->>'companyId'=d->>'companyId' AND (x.data->'subject'=d->'subject' OR (d->>'targetUserId' IS NOT NULL AND x.data->>'targetUserId'=d->>'targetUserId'))) THEN RAISE EXCEPTION 'Active subject request already exists';END IF;
  RETURN;
 END IF;
 SELECT data INTO r FROM prima.hr_it_requests WHERE id=d->>'requestId' FOR UPDATE;
 IF r IS NULL THEN RAISE EXCEPTION 'Request unavailable';END IF;
 own:=coalesce(r->>'targetUserId'=a OR (r#>>'{subject,kind}'='hr_person' AND u->>'personId'=r#>>'{subject,id}'),false);
 IF t='hr_it_delegations' THEN
  IF o IS NULL THEN
   SELECT data INTO delegate FROM prima.users WHERE id=d->>'delegateId';
   IF NOT prima.hr_it_role(u,'lead') OR r->>'status'='cancelled' OR NOT prima.hr_it_subject_current(r) OR NOT coalesce(prima.hr_it_role(delegate,'executive'),false) OR d->>'delegateId'=r->>'targetUserId' OR d->>'targetKey' IS DISTINCT FROM (r#>>'{subject,kind}')||':'||(r#>>'{subject,id}') OR coalesce(d->>'task','') NOT IN ('collect_identity_details','prepare_link_request') OR d->>'status' IS DISTINCT FROM 'requested' OR d->>'requestedById' IS DISTINCT FROM a OR d->'version' IS DISTINCT FROM '1'::jsonb OR (d->>'expiresAt')::timestamptz<=now() OR (d->>'expiresAt')::timestamptz>now()+interval '7 days' OR (d->>'expiresAt')::timestamptz IS NULL OR d->'approvedById' IS DISTINCT FROM 'null'::jsonb OR d->'approvedAt' IS DISTINCT FROM 'null'::jsonb OR d->'revokedById' IS DISTINCT FROM 'null'::jsonb OR d->'revokedAt' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Lead bounded delegation request required';END IF;
  ELSE
   IF NOT prima.hr_it_role(u,'manager') OR o->>'status'='revoked' OR (d->>'version')::integer<>(o->>'version')::integer+1 OR (d-ARRAY['version','status','approvedById','approvedAt','revokedById','revokedAt','note']) IS DISTINCT FROM (o-ARRAY['version','status','approvedById','approvedAt','revokedById','revokedAt','note']) THEN RAISE EXCEPTION 'Manager decision only';END IF;
   IF d->>'status'='approved' THEN
    SELECT data INTO delegate FROM prima.users WHERE id=d->>'delegateId';SELECT data INTO requester FROM prima.users WHERE id=d->>'requestedById';
    IF o->>'status'<>'requested' OR r->>'status'='cancelled' OR NOT prima.hr_it_subject_current(r) OR NOT coalesce(prima.hr_it_role(delegate,'executive'),false) OR NOT coalesce(prima.hr_it_role(requester,'lead'),false) OR a IN(d->>'requestedById',d->>'delegateId') OR (d->>'expiresAt')::timestamptz<=now() OR d->>'approvedById' IS DISTINCT FROM a OR d->'revokedById' IS DISTINCT FROM o->'revokedById' OR d->'revokedAt' IS DISTINCT FROM o->'revokedAt' THEN RAISE EXCEPTION 'Independent current approval required';END IF;
   ELSIF d->>'status'='revoked' THEN IF d->>'revokedById' IS DISTINCT FROM a OR d->'approvedById' IS DISTINCT FROM o->'approvedById' OR d->'approvedAt' IS DISTINCT FROM o->'approvedAt' THEN RAISE EXCEPTION 'Invalid revocation';END IF;
   ELSE RAISE EXCEPTION 'Invalid delegation transition';END IF;
  END IF;RETURN;
 END IF;
 IF t='hr_it_approvals' THEN
  IF o IS NOT NULL OR own OR a=r->>'createdById' OR r->>'status'<>'submitted' OR NOT prima.hr_it_subject_current(r) OR d->>'actorId' IS DISTINCT FROM a OR d->'version' IS DISTINCT FROM r->'version' OR d->'hash' IS DISTINCT FROM r->'hash' OR length(trim(coalesce(d->>'note','')))<3 OR coalesce(r#>>'{technical,oid}','')='' OR r#>>'{technical,tenantId}' IS DISTINCT FROM nullif(current_setting('app.hr_it_tenant',true),'') THEN RAISE EXCEPTION 'Independent exact-scope review required';END IF;
  IF NOT EXISTS(SELECT 1 FROM prima.users c,prima.users b,prima.hr_it_authority_mappings bm WHERE prima.hr_it_role(c.data,'cos') AND prima.hr_it_active(b.data) AND c.id<>b.id AND c.id NOT IN(r->>'createdById',coalesce(r->>'targetUserId','')) AND b.id NOT IN(r->>'createdById',coalesce(r->>'targetUserId','')) AND NOT(coalesce(c.data->>'personId','')=coalesce(r#>>'{subject,id}','') AND r#>>'{subject,kind}'='hr_person') AND NOT(coalesce(b.data->>'personId','')=coalesce(r#>>'{subject,id}','') AND r#>>'{subject,kind}'='hr_person') AND prima.hr_it_mapping(bm.data,b.id,'company_head',r->>'companyId')) OR NOT EXISTS(SELECT 1 FROM prima.users z,prima.hr_it_authority_mappings zm WHERE prima.hr_it_active(z.data) AND z.id NOT IN(r->>'createdById',coalesce(r->>'targetUserId','')) AND prima.hr_it_mapping(zm.data,z.id,'hr_administrator',r->>'companyId')) THEN RAISE EXCEPTION 'Authority setup incomplete';END IF;
  SELECT coalesce(max((data->>'sequence')::integer),0)+1 INTO n FROM prima.hr_it_approvals WHERE data->>'requestId'=r->>'id';IF (d->>'sequence')::integer IS DISTINCT FROM n THEN RAISE EXCEPTION 'Stale approval sequence';END IF;
  IF d->>'kind'='cos' THEN IF NOT prima.hr_it_role(u,'cos') OR d->'mappingId' IS DISTINCT FROM 'null'::jsonb OR d->'mappingVersion' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Current CoS required';END IF;peer:=prima.hr_it_latest_approval(r,'company_head');
  ELSIF d->>'kind' IN ('company_head','hr_review') THEN SELECT data INTO m FROM prima.hr_it_authority_mappings WHERE id=d->>'mappingId';IF m IS NULL OR m->'version' IS DISTINCT FROM d->'mappingVersion' OR NOT prima.hr_it_mapping(m,a,CASE WHEN d->>'kind'='hr_review' THEN 'hr_administrator' ELSE 'company_head' END,r->>'companyId') THEN RAISE EXCEPTION 'Current explicit scoped mapping required';END IF;peer:=prima.hr_it_latest_approval(r,'cos');
  ELSE RAISE EXCEPTION 'Invalid approval kind';END IF;
  IF d->>'kind' IN('cos','company_head') AND (peer->>'actorId'=a OR coalesce(d->>'decision','') NOT IN('approve','return')) THEN RAISE EXCEPTION 'Two distinct scope approvers required';END IF;
  IF d->>'kind'='hr_review' THEN v:=prima.hr_it_latest_approval(r,'company_head');IF peer IS NULL OR v IS NULL OR peer->>'actorId'=v->>'actorId' OR (d->>'sequence')::integer<=greatest((peer->>'sequence')::integer,(v->>'sequence')::integer) OR d->>'decision' IS DISTINCT FROM 'approve' THEN RAISE EXCEPTION 'Current dual approvals required';END IF;END IF;
  RETURN;
 END IF;
 RAISE EXCEPTION 'Unsupported coordination table';
END $$;
CREATE OR REPLACE FUNCTION prima.hr_it_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,prima AS $$
BEGIN
 IF current_user<>'prima_app' THEN RETURN NEW;END IF;
 IF NEW.id IS DISTINCT FROM NEW.data->>'id' OR (TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id) THEN RAISE EXCEPTION 'Immutable identity required';END IF;
 PERFORM prima.hr_it_validate(TG_TABLE_NAME,CASE WHEN TG_OP='UPDATE' THEN OLD.data ELSE NULL END,NEW.data);RETURN NEW;
END $$;
DO $$ DECLARE f regprocedure; BEGIN FOREACH f IN ARRAY ARRAY['prima.hr_it_active(jsonb)'::regprocedure,'prima.hr_it_role(jsonb,text)'::regprocedure,'prima.hr_it_mapping(jsonb,text,text,text)'::regprocedure,'prima.hr_it_delegated(jsonb,jsonb,jsonb)'::regprocedure,'prima.hr_it_visible(jsonb)'::regprocedure,'prima.hr_it_mapping_visible(jsonb)'::regprocedure,'prima.hr_it_canonical(jsonb)'::regprocedure,'prima.hr_it_subject_current(jsonb)'::regprocedure,'prima.hr_it_latest_approval(jsonb,text)'::regprocedure,'prima.hr_it_validate(text,jsonb,jsonb)'::regprocedure,'prima.hr_it_guard()'::regprocedure] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f); END LOOP;END $$;
GRANT EXECUTE ON FUNCTION prima.hr_it_visible(jsonb),prima.hr_it_mapping_visible(jsonb),prima.hr_it_validate(text,jsonb,jsonb),prima.hr_it_active(jsonb) TO prima_app;
DO $$ DECLARE t text;r text;BEGIN FOREACH t IN ARRAY ARRAY['hr_it_requests','hr_it_approvals','hr_it_delegations','hr_it_authority_mappings','hr_it_receipts'] LOOP
 EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
 r:=CASE WHEN t='hr_it_requests' THEN 'prima.hr_it_visible(data)' WHEN t='hr_it_receipts' THEN 'data->>''userId''=current_setting(''app.user_id'',true)' WHEN t='hr_it_authority_mappings' THEN 'prima.hr_it_mapping_visible(data)' ELSE format('EXISTS(SELECT 1 FROM prima.hr_it_requests r WHERE r.id=%I.data->>''requestId'' AND prima.hr_it_visible(r.data))',t) END;
 EXECUTE format('DROP POLICY IF EXISTS hr_it_read ON prima.%I',t);EXECUTE format('CREATE POLICY hr_it_read ON prima.%I FOR SELECT USING (%s)',t,r);
 EXECUTE format('DROP POLICY IF EXISTS hr_it_setup ON prima.%I',t);EXECUTE format('CREATE POLICY hr_it_setup ON prima.%I TO CURRENT_USER USING(true) WITH CHECK(true)',t);
 EXECUTE format('REVOKE ALL ON prima.%I FROM prima_app',t);EXECUTE format('GRANT SELECT ON prima.%I TO prima_app',t);
 IF t<>'hr_it_authority_mappings' THEN
  EXECUTE format('DROP POLICY IF EXISTS hr_it_insert ON prima.%I',t);EXECUTE format('CREATE POLICY hr_it_insert ON prima.%I FOR INSERT WITH CHECK(true)',t);
  EXECUTE format('GRANT INSERT ON prima.%I TO prima_app',t);
  EXECUTE format('DROP TRIGGER IF EXISTS hr_it_guard ON prima.%I',t);EXECUTE format('CREATE TRIGGER hr_it_guard BEFORE INSERT OR UPDATE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.hr_it_guard()',t);
 END IF;
 IF t IN ('hr_it_requests','hr_it_delegations') THEN
  EXECUTE format('DROP POLICY IF EXISTS hr_it_update ON prima.%I',t);EXECUTE format('CREATE POLICY hr_it_update ON prima.%I FOR UPDATE USING (%s) WITH CHECK(true)',t,r);EXECUTE format('GRANT UPDATE ON prima.%I TO prima_app',t);
 END IF;
END LOOP;END $$;
CREATE OR REPLACE FUNCTION prima.hr_it_mapping_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,prima AS $$
BEGIN
 IF current_user='prima_app' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Authority mapping administrative version process required';END IF;
 IF NEW.id IS DISTINCT FROM NEW.data->>'id' OR coalesce(NEW.data->>'kind','') NOT IN ('company_head','hr_administrator') OR coalesce(NEW.data->>'version','')!~'^[1-9][0-9]{0,8}$' OR coalesce(NEW.data->>'companyId','')='' OR coalesce(NEW.data->>'userId','')='' OR jsonb_typeof(NEW.data->'active') IS DISTINCT FROM 'boolean' OR (NEW.data->>'validFrom')::date IS NULL OR (NEW.data->'validUntil' IS DISTINCT FROM 'null'::jsonb AND (NEW.data->>'validUntil')::date<(NEW.data->>'validFrom')::date) OR length(trim(coalesce(NEW.data->>'provenance','')))<3 THEN RAISE EXCEPTION 'Invalid authority mapping';END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' OR NEW.data->'companyId' IS DISTINCT FROM OLD.data->'companyId' OR NEW.data->'userId' IS DISTINCT FROM OLD.data->'userId' OR (NEW.data->>'version')::integer<>(OLD.data->>'version')::integer+1) THEN RAISE EXCEPTION 'Immutable mapping identity and increasing version required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION prima.hr_it_mapping_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS hr_it_mapping_guard ON prima.hr_it_authority_mappings;
CREATE TRIGGER hr_it_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.hr_it_authority_mappings FOR EACH ROW EXECUTE FUNCTION prima.hr_it_mapping_guard();
CREATE UNIQUE INDEX IF NOT EXISTS hr_it_mapping_identity ON prima.hr_it_authority_mappings ((data->>'kind'),(data->>'companyId'),(data->>'userId'));
CREATE UNIQUE INDEX IF NOT EXISTS hr_it_subject_active ON prima.hr_it_requests ((data#>>'{subject,kind}'),(data#>>'{subject,id}'),(data->>'companyId')) WHERE data->>'status'<>'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS hr_it_target_active ON prima.hr_it_requests ((data->>'targetUserId'),(data->>'companyId')) WHERE data->>'status'<>'cancelled' AND data->>'targetUserId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_it_approval_sequence ON prima.hr_it_approvals ((data->>'requestId'),(data->>'sequence'));

-- Department walls (pre-publication review R2, Fauzan 31 Oct 2026). These group-wide department tables have no company
-- column, so the company wall cannot keep them apart. The API sets app.walls on every request to the walls the person
-- passes (packages/core/src/access.ts, dataWalls); a row comes through only on a wall the person holds, so a mistake in a
-- screen cannot show one department's records to another. The IT pilot tables are not walled yet (next step), so the
-- IT pilot is not affected.
CREATE OR REPLACE FUNCTION prima.has_wall(w text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT w = ANY (coalesce(string_to_array(nullif(current_setting('app.walls', true), ''), ','), ARRAY[]::text[]))
$$;
DO $$
DECLARE
  t text;
  w record;
BEGIN
  -- One wall for reading and writing: PDPA (officer, leadership, Operations Director) and continuity (IT, leadership).
  FOR w IN SELECT * FROM (VALUES ('pdpa_cases', 'pdpa'), ('pdpa_dpos', 'pdpa'), ('pdpa_requests', 'pdpa'),
                                 ('bcm_systems', 'bcm'), ('bcm_drills', 'bcm'), ('act_audits', 'act')) AS v(tbl, wall)
  LOOP
    EXECUTE format($f$
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_wall ON prima.%1$I;
      CREATE POLICY dept_wall ON prima.%1$I USING (prima.has_wall(%2$L)) WITH CHECK (prima.has_wall(%2$L));
    $f$, w.tbl, w.wall);
  END LOOP;
  -- ACT findings and improvements: ACT and leadership, and the person who owns the finding or improvement.
  FOREACH t IN ARRAY ARRAY['act_findings', 'act_improvements']
  LOOP
    EXECUTE format($f$
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_wall ON prima.%1$I;
      CREATE POLICY dept_wall ON prima.%1$I
        USING (prima.has_wall('act') OR data->>'ownerUserId' = current_setting('app.user_id', true))
        WITH CHECK (prima.has_wall('act') OR data->>'ownerUserId' = current_setting('app.user_id', true));
    $f$, t);
  END LOOP;
  -- Asset Management: its team, leadership and Finance read and write; ACT reads only, to audit.
  FOREACH t IN ARRAY ARRAY['am_units', 'am_work_orders', 'am_assets', 'am_properties', 'am_depn_postings']
  LOOP
    EXECUTE format($f$
      ALTER TABLE prima.%1$I ENABLE ROW LEVEL SECURITY;
      ALTER TABLE prima.%1$I FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS dept_read ON prima.%1$I;
      DROP POLICY IF EXISTS dept_insert ON prima.%1$I;
      DROP POLICY IF EXISTS dept_update ON prima.%1$I;
      CREATE POLICY dept_read ON prima.%1$I FOR SELECT USING (prima.has_wall('asset_read'));
      CREATE POLICY dept_insert ON prima.%1$I FOR INSERT WITH CHECK (prima.has_wall('asset_write'));
      CREATE POLICY dept_update ON prima.%1$I FOR UPDATE USING (prima.has_wall('asset_write')) WITH CHECK (prima.has_wall('asset_write'));
    $f$, t);
  END LOOP;
END $$;

-- Offboarding (pre-publication review R3, Fauzan 31 Oct 2026). The API may read accounts and grants but never change
-- them, except through this one function: it closes an account from a day and ends its company grants the day before.
-- Only a request carrying the 'offboard' wall (HR, the HR Director, the CEO) may call it; nobody closes their own
-- access, and the CEO's account and system feeds are never closed here. The API writes the audit entry.
CREATE OR REPLACE FUNCTION prima.close_access(target text, from_day date, closed jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = prima, pg_temp AS $$
DECLARE
  n integer;
  last_day text := to_char(from_day - 1, 'YYYY-MM-DD');
BEGIN
  IF NOT prima.has_wall('offboard') THEN
    RAISE EXCEPTION 'Only HR, the HR Director or the CEO closes access' USING ERRCODE = '42501';
  END IF;
  IF target = current_setting('app.user_id', true) THEN
    RAISE EXCEPTION 'Nobody closes their own access' USING ERRCODE = '42501';
  END IF;
  UPDATE prima.users
     SET data = data || jsonb_build_object('accessClosedFrom', to_char(from_day, 'YYYY-MM-DD'), 'accessClosed', closed)
   WHERE id = target
     AND data->>'opsTier' IS DISTINCT FROM 'ceo'
     AND NOT (data ? 'integration')
     AND (data->>'accessClosedFrom' IS NULL OR data->>'accessClosedFrom' > to_char(from_day, 'YYYY-MM-DD'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account cannot be closed from this day' USING ERRCODE = '42501';
  END IF;
  UPDATE prima.grants
     SET data = jsonb_set(data, '{validTo}', to_jsonb(greatest(last_day, data->>'validFrom')))
   WHERE data->>'userId' = target AND data->>'validTo' > last_day;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION prima.close_access(text, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.close_access(text, date, jsonb) TO prima_app;

COMMIT;
