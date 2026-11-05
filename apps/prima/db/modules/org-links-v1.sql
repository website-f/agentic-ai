-- Hand-overs between departments and real-data import receipts (connect-departments, 2 Nov 2026).
-- Separate reviewed module; never run implicitly during startup. Repeat-safe: a second run replaces only its own
-- functions, triggers and policies and keeps every row. The CEO runs it (infra/run-db-migration.sh pattern)
-- and only then sets PRIMA_ORG_LINKS=true. It changes no existing table and moves no money.
--
-- Who sees what:
--   org_events   ACT and group leadership (the 'act' wall).
--   org_tasks    the named receivers of each hand-over, plus ACT and group leadership.
--   org_notices  only the person the notice is for.
--   org_imports  the person who imported, plus ACT and group leadership.
-- Provenance: an event is accepted only for the audit entry this same transaction inserted (its row's xmin is this
-- transaction, still in progress; same sequence, action and record; newest; audit lock held); a hand-over only for such an event, one per desk, to real open accounts; a
-- notice only for one of that hand-over's receivers. An old audit entry cannot be replayed into new hand-overs.
-- Nobody may delete. A hand-over changes only from open to closed, by one of its receivers, under their own name. An import receipt is written once per file fingerprint.
BEGIN;

CREATE TABLE IF NOT EXISTS prima.org_events (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE IF NOT EXISTS prima.org_tasks (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE IF NOT EXISTS prima.org_notices (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE IF NOT EXISTS prima.org_imports (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE UNIQUE INDEX IF NOT EXISTS org_event_once ON prima.org_events (((data->>'auditSeq')::bigint), (data->>'flowId'));
CREATE UNIQUE INDEX IF NOT EXISTS org_import_once ON prima.org_imports ((data->>'fingerprint'));
CREATE INDEX IF NOT EXISTS org_tasks_receivers ON prima.org_tasks USING gin ((data->'userIds'));
CREATE INDEX IF NOT EXISTS org_notices_user ON prima.org_notices ((data->>'userId'));

-- Internal checks that read across walls; they return a yes or no, never rows.
-- org_is_this_transactions_audit: the audit row was inserted by this very transaction. Its xmin is a transaction that
-- is still in progress, and a row of another in-progress transaction is never visible, so a visible in-progress row
-- can only be this transaction's own (including its savepoints). In addition it is the newest entry and this
-- transaction holds the audit append lock (prima.audit_head takes it until commit). An older entry, committed by an
-- earlier request, fails the first test even when it is still the newest and the lock is taken by hand.
CREATE OR REPLACE FUNCTION prima.org_is_this_transactions_audit(s bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  WITH cur AS (SELECT pg_current_xact_id_if_assigned()::text::bigint AS x)
  SELECT EXISTS (
           SELECT 1 FROM prima.audit a, cur
            WHERE a.seq = s AND cur.x IS NOT NULL AND a.xmin::text::bigint >= 3
              AND pg_xact_status(((CASE
                    WHEN a.xmin::text::bigint - (cur.x & 4294967295) > 2147483648 THEN ((cur.x >> 32) - 1) << 32
                    WHEN (cur.x & 4294967295) - a.xmin::text::bigint > 2147483648 THEN ((cur.x >> 32) + 1) << 32
                    ELSE (cur.x >> 32) << 32 END) | a.xmin::text::bigint)::text::xid8) = 'in progress')
     AND s = (SELECT max(a.seq) FROM prima.audit a)
     AND EXISTS (SELECT 1 FROM pg_locks l
                  WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                    AND l.objid = (hashtext('prima.audit')::bigint & 4294967295)::oid)
$$;
-- Finance receivers for a company (Fauzan, 3 Nov 2026, G5; deskPeople 'finance'): the leader and deputy of the Finance
-- team recorded on that company's Finance status (fin-<company>.team); the Finance Director when no team is recorded or
-- that team has nobody open yet.
CREATE OR REPLACE FUNCTION prima.org_finance_team(company text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT (f.data->>'team')::integer FROM prima.fin_status f
   WHERE company IS NOT NULL AND f.id = 'fin-' || company AND jsonb_typeof(f.data->'team') = 'number'
     AND (f.data->>'team') ~ '^[0-9]{1,3}$'
$$;
-- The office running a company (Company office module, company_run_links): set, not itself, and not itself run by
-- another office. NULL until that module is applied. The same rule as orgRunByOf in packages/core/src/org-links.ts.
CREATE OR REPLACE FUNCTION prima.org_run_by(company text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE parent text; grand text;
BEGIN
  IF company IS NULL OR to_regclass('prima.company_run_links') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT data->>''runByCompanyId'' FROM prima.company_run_links WHERE id = $1' INTO parent USING company;
  IF parent IS NULL OR parent = '' OR parent = company THEN RETURN NULL; END IF;
  EXECUTE 'SELECT data->>''runByCompanyId'' FROM prima.company_run_links WHERE id = $1' INTO grand USING parent;
  IF coalesce(grand, '') <> '' THEN RETURN NULL; END IF;
  RETURN parent;
END
$$;
CREATE OR REPLACE FUNCTION prima.org_finance_people(company text, day text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  WITH open AS (
    SELECT u.id, u.data FROM prima.users u
     WHERE coalesce(u.data->>'integration', '') = '' AND coalesce(u.data->>'role', '') <> 'site_device'
       AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > day)),
  team AS (SELECT to_jsonb(prima.org_finance_team(company)) AS t),
  members AS (
    SELECT o.id FROM open o, team
     WHERE o.data->>'role' = 'pwvsb_officer' AND o.data->>'department' = 'finance'
       AND o.data->>'financeRole' IN ('leader', 'deputy') AND o.data->'financeTeam' = team.t)
  SELECT CASE WHEN EXISTS (SELECT 1 FROM members) THEN (SELECT array_agg(id ORDER BY id) FROM members)
    ELSE coalesce((SELECT array_agg(id ORDER BY id) FROM open WHERE data->>'leadership' = 'finance_director'), '{}'::text[]) END
$$;
-- The receivers of a desk on a day, as the API names them (deskPeople in packages/core/src/org-links.ts): open human
-- accounts only (no system feed, no site device, no closed account); Finance = org_finance_people; company office = that company's manager and admin executives, plus those without a branch of the office running it (org_run_by); FWM without despatch; Procurement without
-- storekeepers; COO/CEO by tier; Chief of Staff office incl. CoS and deputy; other desks = their department's officers.
CREATE OR REPLACE FUNCTION prima.org_desk_people(desk text, company text, day text) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT prima.org_finance_people(company, day) WHERE desk = 'finance'
  UNION ALL
  SELECT coalesce(array_agg(u.id ORDER BY u.id), '{}'::text[]) FROM prima.users u WHERE desk <> 'finance' AND u.id IN (SELECT u.id FROM prima.users u
   WHERE coalesce(u.data->>'integration', '') = ''
     AND coalesce(u.data->>'role', '') <> 'site_device'
     AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > day)
     AND coalesce(CASE desk
       WHEN 'company_office' THEN company IS NOT NULL AND u.data->>'role' IN ('company_manager', 'admin_exec')
         AND (coalesce(u.data->'companyIds' ? company, false)
           OR (coalesce(u.data->>'branchId', '') = '' AND coalesce(u.data->'companyIds' ? prima.org_run_by(company), false)))
       WHEN 'coo' THEN u.data->>'opsTier' = 'coo'
       WHEN 'ceo' THEN u.data->>'opsTier' = 'ceo'
       WHEN 'chief_of_staff' THEN u.data->>'leadership' IN ('cos', 'deputy_cos')
         OR (u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'chief_of_staff')
       WHEN 'fwm' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'fwm' AND coalesce(u.data->>'fwmRole', '') <> 'despatch'
       WHEN 'procurement' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'procurement'
         AND coalesce(u.data->>'procRole', '') <> 'storekeeper'
       WHEN 'act' THEN u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = 'audit'
       ELSE desk IN ('hr', 'it', 'asset', 'legal', 'pdpa', 'cms', 'transport', 'director_office')
         AND u.data->>'role' = 'pwvsb_officer' AND u.data->>'department' = desk
     END, false))
$$;
-- BEGIN GENERATED org routes (apps/api/src/org-links-routes.ts from ORG_FLOWS; do not edit by hand)
-- An event may name a flow only when its audit action starts that flow (exact, or a prefix ending in "."),
-- and never for a confidential action.
CREATE OR REPLACE FUNCTION prima.org_flow_starts(flow text, act text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM (VALUES
    ('grc.whistle'),
    ('arms.'),
    ('hr.case_'),
    ('pdpa.'),
    ('staff.face_'),
    ('person.pin'),
    ('user.access.review'),
    ('it.access.'),
    ('confidentiality.'),
    ('file.open')
    ) n(p) WHERE p = act OR (right(p, 1) IN ('.', '_') AND starts_with(act, p)))
  AND EXISTS (
    SELECT 1 FROM (VALUES
    ('staff_join', 'record.add.officeStaff'),
    ('staff_leave', 'user.access.close'),
    ('pay_change', 'pay.change.request'),
    ('bank_change', 'pay.bank.request'),
    ('staff_claim', 'claims.submit'),
    ('expense', 'expense.submit'),
    ('purchase', 'pur.request'),
    ('purchase', 'it.purchase'),
    ('store_issue', 'store.issue'),
    ('store_dispute', 'store.handover.disputed'),
    ('it_rental_bill', 'it.rental.bill'),
    ('hostel_bill', 'hostel.bill'),
    ('hostel_paid', 'finance.hostel.paid'),
    ('hostel_paid', 'hostel.paid'),
    ('fw_renewal', 'fwm.renewal'),
    ('socso', 'socso.start'),
    ('case_serious', 'case.raise'),
    ('osh_high', 'grc.osh'),
    ('client_add', 'client.add'),
    ('client_offboard', 'client.offboard'),
    ('contract_add', 'contract.add'),
    ('contract_change', 'contract.update'),
    ('client_invoice', 'client.invoice'),
    ('client_invoice', 'finance.billing.invoice'),
    ('credit_loan', 'credit.loan'),
    ('legal_matter', 'legal.matter'),
    ('asset_disposal', 'asset.disposal.'),
    ('branch_settlement', 'branch.settlement'),
    ('ar_writeoff', 'finance.ar.writeoff'),
    ('payee_changed', 'finance.payee.changed'),
    ('guarantee_called', 'finance.guarantee.called'),
    ('guarantee_called', 'finance.guarantee.claimed'),
    ('osh_incident', 'hr.osh_incident'),
    ('licence_renewal_fee', 'renewal.fee'),
    ('licence_renewed', 'renewal.renewed')
    ) s(f, a) WHERE f = flow AND (a = act OR (right(a, 1) = '.' AND starts_with(act, a))))
$$;
-- A hand-over may go only to a desk its flow names, with that line's kind and words.
CREATE OR REPLACE FUNCTION prima.org_flow_target_ok(flow text, desk text, kind text, task text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
    ('staff_join', 'hr', 'todo', 'Open the HR/IT joining request for this person, so IT can prepare the account and device.'),
    ('staff_join', 'it', 'todo', 'Prepare the Microsoft account, device and Prima access through the joining intake.'),
    ('staff_join', 'finance', 'todo', 'Add the new staff to the staff payroll; the salary account is verified separately.'),
    ('staff_join', 'chief_of_staff', 'todo', 'Check the new staff is added to the group medical and insurance cover.'),
    ('staff_join', 'company_office', 'info', 'A new staff member is joining your company.'),
    ('staff_leave', 'it', 'todo', 'Disable the Microsoft account and collect devices and access cards.'),
    ('staff_leave', 'finance', 'todo', 'Prepare the final pay and stop the salary from the leaving date.'),
    ('staff_leave', 'procurement', 'info', 'Collect any uniform or equipment issued to the leaver.'),
    ('pay_change', 'finance', 'info', 'A pay change is waiting for approval; it reaches payroll once approved.'),
    ('bank_change', 'finance', 'todo', 'Verify the new salary account with the staff before the next pay run.'),
    ('staff_claim', 'finance', 'info', 'A staff claim is on its way; it joins the payment list once approved.'),
    ('expense', 'finance', 'info', 'An expense is on its way; it joins the payment list once approved.'),
    ('purchase', 'finance', 'info', 'A purchase is being approved; expect the supplier invoice and payment.'),
    ('store_issue', 'finance', 'info', 'A Goodwill billing line was added for this company (rental or sale).'),
    ('store_issue', 'company_office', 'info', 'Equipment was issued to one of your guards; it will be billed by Goodwill.'),
    ('store_dispute', 'procurement', 'todo', 'Resolve the disputed hand-over with the OM and the guard.'),
    ('store_dispute', 'act', 'info', 'An equipment hand-over was disputed.'),
    ('it_rental_bill', 'finance', 'todo', 'Record the Merdeka rental invoice in SQL Account for this company.'),
    ('it_rental_bill', 'company_office', 'info', 'Merdeka sent this month’s device rental bill.'),
    ('hostel_bill', 'finance', 'todo', 'Pay the hostel bill by its due date and record the payment once.'),
    ('hostel_paid', 'fwm', 'info', 'The hostel bill is paid; the record is on the bill.'),
    ('fw_renewal', 'finance', 'todo', 'Prepare payment of the levy and renewal fees for this renewal.'),
    ('fw_renewal', 'company_office', 'info', 'A permit renewal was submitted for one of your workers.'),
    ('socso', 'finance', 'info', 'A SOCSO claim may change sick pay (EA s.60F(4)); hold the affected days until settled.'),
    ('socso', 'company_office', 'info', 'A SOCSO claim was started for one of your staff.'),
    ('case_serious', 'cms', 'info', 'A serious case was raised at a site; watch it until closed.'),
    ('case_serious', 'chief_of_staff', 'todo', 'Check whether an insurance claim or notice to the insurer is needed.'),
    ('case_serious', 'coo', 'info', 'A serious case was raised at a site.'),
    ('osh_high', 'hr', 'todo', 'The OSH coordinator reviews the high risks and the controls.'),
    ('client_add', 'finance', 'todo', 'Open the customer in SQL Account with the e-Invoice details.'),
    ('client_add', 'cms', 'info', 'A new client and its sites are coming on; prepare monitoring.'),
    ('client_offboard', 'finance', 'todo', 'Final invoice, deposit refund and guarantee release for this client.'),
    ('client_offboard', 'procurement', 'todo', 'Collect Goodwill equipment from the client’s sites.'),
    ('client_offboard', 'it', 'todo', 'Collect site devices and close site system accounts.'),
    ('client_offboard', 'cms', 'info', 'Stop monitoring the client’s sites on the last day.'),
    ('contract_add', 'finance', 'todo', 'Set up the billing schedule from the contract.'),
    ('contract_add', 'chief_of_staff', 'todo', 'Check insurance and the performance guarantee cover the contract.'),
    ('contract_add', 'procurement', 'todo', 'Prepare equipment for the new site’s guards.'),
    ('contract_add', 'hr', 'info', 'A new contract needs manpower; see the mobilisation plan.'),
    ('contract_add', 'cms', 'info', 'A new site will need monitoring from its start date.'),
    ('contract_change', 'finance', 'info', 'A contract changed; check the billing schedule.'),
    ('client_invoice', 'finance', 'info', 'An invoice went out; expect the receipt in the bank statement.'),
    ('credit_loan', 'legal', 'todo', 'Prepare the loan agreement and stamping.'),
    ('credit_loan', 'company_office', 'info', 'A PWVSB loan to your company was recorded.'),
    ('legal_matter', 'company_office', 'info', 'A legal matter was opened for your company.'),
    ('legal_matter', 'finance', 'info', 'A legal matter was opened; consider a provision.'),
    ('asset_disposal', 'finance', 'todo', 'Post the disposal in SQL Account.'),
    ('branch_settlement', 'finance', 'todo', 'Pay the branch manager’s share as approved.'),
    ('ar_writeoff', 'act', 'info', 'A receivable was written off.'),
    ('ar_writeoff', 'company_office', 'info', 'A client debt of your company was written off.'),
    ('payee_changed', 'act', 'info', 'Payee bank details changed (fraud watch).'),
    ('guarantee_called', 'legal', 'todo', 'Review the guarantee call and the contract position.'),
    ('guarantee_called', 'company_office', 'info', 'A guarantee of your company was called or claimed.'),
    ('osh_incident', 'chief_of_staff', 'todo', 'Check whether an insurance claim is needed.'),
    ('licence_renewal_fee', 'finance', 'todo', 'Pay the renewal fee so the submission is not held up.'),
    ('licence_renewed', 'legal', 'info', 'A licence was renewed; update tender and contract papers that quote it.'),
    ('licence_renewed', 'company_office', 'info', 'Your licence was renewed; use the new copy in tenders.'),
    ('ja_feeds', 'cms', 'info', 'No-shows and SOS alerts within 1 minute.'),
    ('ja_feeds', 'finance', 'info', 'Guard pay summary per company for payment and SQL Account.'),
    ('sql_account', 'act', 'info', 'Postings missing in SQL Account show as ACT signals.')
    ) t(f, d, k, x) WHERE f = flow AND d = desk AND k = kind AND x = task)
$$;
-- A line that is the keyer's own next step (toKeyer) also goes to the person who keyed the record.
CREATE OR REPLACE FUNCTION prima.org_flow_to_keyer(flow text, desk text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM (VALUES
    ('staff_join', 'hr')
    ) k(f, d) WHERE f = flow AND d = desk)
$$;
-- A central employer has no company office: a company-office line is never written for one (isCentralEmployer).
CREATE OR REPLACE FUNCTION prima.org_central_employer(company text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT company IN ('pwvsb', 'merdeka')
$$;
-- END GENERATED org routes
CREATE OR REPLACE FUNCTION prima.org_event_matches_audit(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT EXISTS (
    SELECT 1 FROM prima.audit a
     WHERE a.seq = (d->>'auditSeq')::bigint
       AND a.data->>'action' = d->>'action'
       AND a.data->>'entityId' = d->>'entityId'
       AND a.data->>'entity' = d->>'entity'
       AND a.company_id IS NOT DISTINCT FROM d->>'companyId')
    AND d->>'id' = 'oe-' || (d->>'auditSeq') || '-' || (d->>'flowId')
    AND prima.org_is_this_transactions_audit((d->>'auditSeq')::bigint)
    AND prima.org_flow_starts(d->>'flowId', d->>'action')
$$;
-- A hand-over: for an event of this same request, one per desk its flow names (with that line's kind and words), open,
-- to exactly the desk's people on the audit day less the person who keyed it; a company office line only when the
-- company has an office.
CREATE OR REPLACE FUNCTION prima.org_task_matches_event(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT EXISTS (
    SELECT 1 FROM prima.org_events e JOIN prima.audit a ON a.seq = (e.data->>'auditSeq')::bigint
     WHERE e.id = d->>'eventId' AND e.data->>'flowId' = d->>'flowId' AND e.data->>'entityId' = d->>'entityId'
       AND e.data->>'entity' = d->>'entity'
       AND e.data->>'companyId' IS NOT DISTINCT FROM d->>'companyId'
       AND d->>'id' = 'ot-' || (e.data->>'auditSeq') || '-' || (e.data->>'flowId') || '-' || (d->>'desk')
       AND prima.org_is_this_transactions_audit((e.data->>'auditSeq')::bigint)
       AND jsonb_typeof(d->'userIds') = 'array'
       AND ARRAY(SELECT x FROM jsonb_array_elements_text(d->'userIds') r(x) ORDER BY x)
         = ARRAY(SELECT x FROM unnest(prima.org_desk_people(d->>'desk', e.data->>'companyId', left(a.data->>'at', 10))) p(x)
                  WHERE prima.org_flow_to_keyer(d->>'flowId', d->>'desk')
                     OR NOT EXISTS (SELECT 1 FROM prima.users w WHERE w.id = p.x AND w.data->>'name' = a.data->>'actor')
                  ORDER BY x))
    AND prima.org_flow_target_ok(d->>'flowId', d->>'desk', d->>'kind', d->>'task')
    AND d->>'status' = 'open' AND coalesce(d->'closed', 'null'::jsonb) = 'null'::jsonb
    AND (d->>'desk' <> 'company_office' OR (d->>'companyId' IS NOT NULL AND NOT prima.org_central_employer(d->>'companyId')))
    AND d->'unassigned' = to_jsonb(jsonb_array_length(d->'userIds') = 0)
$$;
-- A notice: one per receiver of a hand-over of this same request.
CREATE OR REPLACE FUNCTION prima.org_notice_matches_task(d jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT EXISTS (
    SELECT 1 FROM prima.org_tasks t JOIN prima.org_events e ON e.id = t.data->>'eventId'
     WHERE t.id = d->>'taskId' AND t.data->'userIds' ? (d->>'userId')
       AND prima.org_is_this_transactions_audit((e.data->>'auditSeq')::bigint))
    AND d->>'id' = 'on-' || (d->>'taskId') || '-' || (d->>'userId')
    AND coalesce(d->'readAt', 'null'::jsonb) = 'null'::jsonb AND d->>'channel' = 'in_app'
$$;
-- The joining evidence for IT's "new office staff joins" hand-over: the HR/IT joining request (prima.hr_it_requests,
-- base) for that person in that company. 'ready' when a submitted onboarding request carries the Microsoft identity IT
-- recorded (technical.oid and who recorded it); 'cancelled' when every such request was cancelled by HR; 'waiting' when
-- one is open without IT's record; 'missing' when HR has not opened one. Owner-run; answers one word, never the row.
CREATE OR REPLACE FUNCTION prima.org_joining_state(company text, person text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM prima.hr_it_requests r WHERE r.data->>'workflow' = 'onboard' AND r.data->>'companyId' = company
                   AND r.data#>>'{subject,kind}' = 'hr_person' AND r.data#>>'{subject,id}' = person AND r.data->>'status' = 'submitted'
                   AND coalesce(r.data#>>'{technical,oid}', '') <> '' AND coalesce(r.data#>>'{technical,recordedById}', '') <> '') THEN 'ready'
    WHEN EXISTS (SELECT 1 FROM prima.hr_it_requests r WHERE r.data->>'workflow' = 'onboard' AND r.data->>'companyId' = company
                   AND r.data#>>'{subject,kind}' = 'hr_person' AND r.data#>>'{subject,id}' = person AND r.data->>'status' <> 'cancelled') THEN 'waiting'
    WHEN EXISTS (SELECT 1 FROM prima.hr_it_requests r WHERE r.data->>'workflow' = 'onboard' AND r.data->>'companyId' = company
                   AND r.data#>>'{subject,kind}' = 'hr_person' AND r.data#>>'{subject,id}' = person) THEN 'cancelled'
    ELSE 'missing' END
$$;
REVOKE ALL ON FUNCTION prima.org_joining_state(text, text), prima.org_is_this_transactions_audit(bigint), prima.org_desk_people(text, text, text), prima.org_finance_people(text, text), prima.org_finance_team(text), prima.org_run_by(text), prima.org_flow_starts(text, text),
  prima.org_flow_target_ok(text, text, text, text), prima.org_central_employer(text), prima.org_flow_to_keyer(text, text), prima.org_event_matches_audit(jsonb),
  prima.org_task_matches_event(jsonb), prima.org_notice_matches_task(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.org_event_matches_audit(jsonb), prima.org_task_matches_event(jsonb), prima.org_notice_matches_task(jsonb), prima.org_finance_team(text), prima.org_run_by(text) TO prima_app;

-- A hand-over changes only from open to done or not needed, by one of its receivers, under their own name and id.
-- IT's joining hand-over is bound to the HR/IT joining request (org_joining_state).
-- A notice changes only its read time, once.
-- Owner-run so it can ask org_joining_state; it decides only from OLD, NEW and the session's own user id.
CREATE OR REPLACE FUNCTION prima.org_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE me text := current_setting('app.user_id', true);
BEGIN
  IF TG_TABLE_NAME = 'org_tasks' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR (NEW.data - 'status' - 'closed') IS DISTINCT FROM (OLD.data - 'status' - 'closed')
       OR OLD.data->>'status' <> 'open'
       OR NEW.data->>'status' NOT IN ('done', 'not_needed')
       OR NOT (OLD.data->'userIds' ? me)
       OR NEW.data#>>'{closed,byId}' IS DISTINCT FROM me
       OR NEW.data#>>'{closed,by}' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id = me)
       OR length(coalesce(NEW.data#>>'{closed,note}', '')) < 3 THEN
      RAISE EXCEPTION 'A hand-over is closed once, by its receiver, with a note';
    END IF;
    -- The joining hand-overs follow the HR/IT joining request, not a note (joiningAllows in org-links.ts):
    -- IT done only once its identity record is on the submitted request; HR done once the request is open;
    -- either not needed only when HR cancelled it.
    IF OLD.data->>'flowId' = 'staff_join' AND OLD.data->>'desk' IN ('it', 'hr')
       AND NOT (CASE
             WHEN NEW.data->>'status' <> 'done' THEN prima.org_joining_state(OLD.data->>'companyId', OLD.data->>'entityId') = 'cancelled'
             WHEN OLD.data->>'desk' = 'it' THEN prima.org_joining_state(OLD.data->>'companyId', OLD.data->>'entityId') = 'ready'
             ELSE prima.org_joining_state(OLD.data->>'companyId', OLD.data->>'entityId') IN ('ready', 'waiting') END) THEN
      RAISE EXCEPTION 'The joining hand-over closes from the HR/IT joining request';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR (NEW.data - 'readAt') IS DISTINCT FROM (OLD.data - 'readAt')
       OR coalesce(OLD.data->'readAt', 'null'::jsonb) <> 'null'::jsonb
       OR OLD.data->>'userId' IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'A notice is marked read once, by its own person';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS org_task_guard ON prima.org_tasks;
CREATE TRIGGER org_task_guard BEFORE UPDATE ON prima.org_tasks FOR EACH ROW EXECUTE FUNCTION prima.org_task_guard();
DROP TRIGGER IF EXISTS org_notice_guard ON prima.org_notices;
CREATE TRIGGER org_notice_guard BEFORE UPDATE ON prima.org_notices FOR EACH ROW EXECUTE FUNCTION prima.org_task_guard();

ALTER TABLE prima.org_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_events FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.org_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.org_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_notices FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.org_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.org_imports FORCE ROW LEVEL SECURITY;

-- Writers do not need to read back: ids come from the audit sequence, so each is written once (the unique index
-- refuses a replay). Reads are limited as described at the top.
DROP POLICY IF EXISTS org_events_read ON prima.org_events;
CREATE POLICY org_events_read ON prima.org_events FOR SELECT USING (prima.has_wall('act'));
DROP POLICY IF EXISTS org_events_add ON prima.org_events;
CREATE POLICY org_events_add ON prima.org_events FOR INSERT WITH CHECK (prima.org_event_matches_audit(data));

DROP POLICY IF EXISTS org_tasks_read ON prima.org_tasks;
CREATE POLICY org_tasks_read ON prima.org_tasks FOR SELECT
  USING (prima.has_wall('act') OR data->'userIds' ? current_setting('app.user_id', true));
DROP POLICY IF EXISTS org_tasks_add ON prima.org_tasks;
CREATE POLICY org_tasks_add ON prima.org_tasks FOR INSERT WITH CHECK (prima.org_task_matches_event(data));
DROP POLICY IF EXISTS org_tasks_close ON prima.org_tasks;
CREATE POLICY org_tasks_close ON prima.org_tasks FOR UPDATE
  USING (data->'userIds' ? current_setting('app.user_id', true))
  WITH CHECK (data->'userIds' ? current_setting('app.user_id', true));

DROP POLICY IF EXISTS org_notices_read ON prima.org_notices;
CREATE POLICY org_notices_read ON prima.org_notices FOR SELECT
  USING (data->>'userId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS org_notices_add ON prima.org_notices;
CREATE POLICY org_notices_add ON prima.org_notices FOR INSERT WITH CHECK (prima.org_notice_matches_task(data));
DROP POLICY IF EXISTS org_notices_mark ON prima.org_notices;
CREATE POLICY org_notices_mark ON prima.org_notices FOR UPDATE
  USING (data->>'userId' = current_setting('app.user_id', true))
  WITH CHECK (data->>'userId' = current_setting('app.user_id', true));

DROP POLICY IF EXISTS org_imports_read ON prima.org_imports;
CREATE POLICY org_imports_read ON prima.org_imports FOR SELECT
  USING (prima.has_wall('act') OR data->>'byId' = current_setting('app.user_id', true));
DROP POLICY IF EXISTS org_imports_add ON prima.org_imports;
CREATE POLICY org_imports_add ON prima.org_imports FOR INSERT
  WITH CHECK (data->>'byId' = current_setting('app.user_id', true));

-- The schema owner reads events and hand-overs, so the provenance checks above (which run as the owner) see the row
-- they check against even when the request cannot. No login reaches the owner role except through those functions.
DROP POLICY IF EXISTS org_events_owner_read ON prima.org_events;
CREATE POLICY org_events_owner_read ON prima.org_events FOR SELECT TO CURRENT_USER USING (true);
DROP POLICY IF EXISTS org_tasks_owner_read ON prima.org_tasks;
CREATE POLICY org_tasks_owner_read ON prima.org_tasks FOR SELECT TO CURRENT_USER USING (true);

GRANT SELECT, INSERT ON prima.org_events, prima.org_imports TO prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.org_tasks, prima.org_notices TO prima_app;

COMMIT;
