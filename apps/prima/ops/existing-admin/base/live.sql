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

COMMIT;

