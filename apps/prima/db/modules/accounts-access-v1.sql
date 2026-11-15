-- Accounts and Access (Fauzan, 15 Nov 2026, "Build it now"). Separate reviewed module; never run implicitly during
-- startup. NOT on db/release-manifest.json: Fitri runs it with infra/run-db-migration.sh, staging first, like the other
-- off-list modules. It needs only the base schema.
--
-- Until now the app role could read accounts (prima.users) and company access (prima.grants) but never add or change
-- them; only offboarding (prima.close_access) could close them. This module adds:
--   prima.account_requests        one request per batch of account changes: IT (IT Manager, IT Lead, IT Executive) or
--                                 central HR prepares it; the HR Director (Chief of Staff or Deputy) or the CEO approves or
--                                 returns it with a comment, never their own. Nothing is deleted.
--   prima.apply_account_request   the ONLY way the app writes accounts and grants besides close_access. It runs once, by
--                                 the approver, in the approval's transaction, and checks every rule again here: allowed
--                                 kinds of account only (never a leader, the CEO, a system feed, a device or a guard),
--                                 never the approver's or preparer's own account, a leader's account only with the CEO,
--                                 one Microsoft account and one HR record per Prima account, companies that exist.
BEGIN;
CREATE TABLE prima.account_requests(id text PRIMARY KEY, data jsonb NOT NULL);
ALTER TABLE prima.account_requests ADD CONSTRAINT accr_id CHECK (data->>'id' = id);
ALTER TABLE prima.account_requests ADD CONSTRAINT accr_status CHECK (data->>'status' IN ('waiting','approved','returned'));
ALTER TABLE prima.account_requests ADD CONSTRAINT accr_not_self CHECK (data->>'status' = 'waiting' OR (data->>'decidedById' IS NOT NULL AND data->>'decidedById' <> data->>'preparedById'));
ALTER TABLE prima.account_requests ADD CONSTRAINT accr_applied CHECK (coalesce(data->'applied','null'::jsonb) = 'null'::jsonb OR data->>'status' = 'approved');

-- The kinds of account the app may create, with their fixed fields. Must equal ACCOUNT_TEMPLATES in
-- packages/core/src/accounts-access.ts (checked by apps/api/test/accounts-access-pg.test.ts).
CREATE OR REPLACE FUNCTION prima.acc_templates() RETURNS TABLE(key text, shape jsonb) LANGUAGE sql IMMUTABLE AS $$
 SELECT * FROM (VALUES
  ('company_manager', '{"role":"company_manager"}'::jsonb),
  ('admin_exec', '{"role":"admin_exec"}'::jsonb),
  ('ops_om', '{"role":"pwvsb_officer","department":"operations","opsTier":"om"}'::jsonb),
  ('ops_regional', '{"role":"pwvsb_officer","department":"operations","opsTier":"regional"}'::jsonb),
  ('ops_staff', '{"role":"pwvsb_officer","department":"operations"}'::jsonb),
  ('hr', '{"role":"pwvsb_officer","department":"hr"}'::jsonb),
  ('it_manager', '{"role":"pwvsb_officer","department":"it","itRole":"manager"}'::jsonb),
  ('it_lead', '{"role":"pwvsb_officer","department":"it","itRole":"lead"}'::jsonb),
  ('it_executive', '{"role":"pwvsb_officer","department":"it","itRole":"executive"}'::jsonb),
  ('finance_staff', '{"role":"pwvsb_officer","department":"finance"}'::jsonb),
  ('finance_leader', '{"role":"pwvsb_officer","department":"finance","financeRole":"leader"}'::jsonb),
  ('finance_deputy', '{"role":"pwvsb_officer","department":"finance","financeRole":"deputy"}'::jsonb),
  ('finance_data_entry', '{"role":"pwvsb_officer","department":"finance","financeRole":"data_entry"}'::jsonb),
  ('fwm_manager', '{"role":"pwvsb_officer","department":"fwm","fwmRole":"manager"}'::jsonb),
  ('fwm_deputy', '{"role":"pwvsb_officer","department":"fwm","fwmRole":"deputy"}'::jsonb),
  ('fwm_executive', '{"role":"pwvsb_officer","department":"fwm","fwmRole":"executive"}'::jsonb),
  ('fwm_despatch', '{"role":"pwvsb_officer","department":"fwm","fwmRole":"despatch"}'::jsonb),
  ('proc_manager', '{"role":"pwvsb_officer","department":"procurement","procRole":"manager"}'::jsonb),
  ('proc_executive', '{"role":"pwvsb_officer","department":"procurement","procRole":"executive"}'::jsonb),
  ('proc_storekeeper', '{"role":"pwvsb_officer","department":"procurement","procRole":"storekeeper"}'::jsonb),
  ('act_manager', '{"role":"pwvsb_officer","department":"audit","actRole":"manager"}'::jsonb),
  ('act_auditor', '{"role":"pwvsb_officer","department":"audit","actRole":"auditor"}'::jsonb),
  ('act_enforcement', '{"role":"pwvsb_officer","department":"audit","actRole":"enforcement"}'::jsonb),
  ('arms_control', '{"role":"pwvsb_officer","department":"arms_control"}'::jsonb),
  ('cms', '{"role":"pwvsb_officer","department":"cms"}'::jsonb),
  ('transport', '{"role":"pwvsb_officer","department":"transport"}'::jsonb),
  ('pdpa', '{"role":"pwvsb_officer","department":"pdpa"}'::jsonb),
  ('legal', '{"role":"pwvsb_officer","department":"legal"}'::jsonb),
  ('director_office', '{"role":"pwvsb_officer","department":"director_office"}'::jsonb),
  ('asset_staff', '{"role":"pwvsb_officer","department":"asset"}'::jsonb),
  ('cos_office', '{"role":"pwvsb_officer","department":"chief_of_staff"}'::jsonb)
 ) AS t(key, shape)
$$;

-- Who the signed-in person is, read from the stored account (never from the request).
CREATE OR REPLACE FUNCTION prima.acc_role(uid text, need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(
   coalesce(u.data->'integration','null'::jsonb) IN ('false'::jsonb,'null'::jsonb) AND u.data->>'role' NOT IN ('site_device','guard')
   AND (coalesce(u.data->>'accessClosedFrom','') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))
   AND CASE need
     WHEN 'prepare' THEN u.data->>'role' = 'pwvsb_officer' AND (u.data->>'department' = 'hr' OR (u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead','executive')))
     WHEN 'approve' THEN (u.data->>'role' = 'pwvsb_officer' AND u.data->>'leadership' IN ('cos','deputy_cos')) OR (u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier' = 'ceo')
     WHEN 'read' THEN (u.data->>'role' = 'pwvsb_officer' AND (u.data->>'department' = 'hr' OR (u.data->>'department' = 'it' AND u.data->>'itRole' IN ('manager','lead','executive')) OR u.data->>'leadership' IN ('cos','deputy_cos')))
       OR (u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier' = 'ceo')
     ELSE false END), false)
 FROM prima.users u WHERE u.id = uid
$$;
REVOKE ALL ON FUNCTION prima.acc_role(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.acc_role(text,text) TO prima_app;

-- The company list for preparing access (id, code and name only): IT usually sees no company itself.
CREATE OR REPLACE FUNCTION prima.acc_companies() RETURNS TABLE(id text, code text, name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT c.id, c.data->>'code', c.data->>'name' FROM prima.companies c
  WHERE prima.acc_role(current_setting('app.user_id', true), 'read') ORDER BY c.data->>'name'
$$;
REVOKE ALL ON FUNCTION prima.acc_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.acc_companies() TO prima_app;

-- The app may change only the decision fields of a waiting request; the applied mark is written by the function below.
CREATE OR REPLACE FUNCTION prima.acc_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
DECLARE k text[] := ARRAY['status','decidedById','decidedBy','decidedAt','comment'];
BEGIN
  IF current_user = 'prima_app' AND ((NEW.data - k) IS DISTINCT FROM (OLD.data - k) OR OLD.data->>'status' <> 'waiting') THEN
    RAISE EXCEPTION 'Only the decision of a waiting request may change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER acc_request_guard BEFORE UPDATE ON prima.account_requests FOR EACH ROW EXECUTE FUNCTION prima.acc_request_guard();

CREATE OR REPLACE FUNCTION prima.apply_account_request(req text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE
  me text := current_setting('app.user_id', true);
  today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  q jsonb; approver jsonb; tgt jsonb; it jsonb; a jsonb; shape jsonb; u jsonb; patch jsonb; p jsonb;
  short text; uid text; gid text; until date; n int := 0; g int := 0; office boolean; leader boolean;
  users_out jsonb := '[]'; grants_out jsonb := '[]'; ended_out jsonb := '[]'; result jsonb;
  oid text; nm text; ttl text;
BEGIN
  SELECT data INTO q FROM prima.account_requests WHERE id = req FOR UPDATE;
  IF q IS NULL OR q->>'status' <> 'approved' OR q->>'decidedById' IS DISTINCT FROM me OR q->>'preparedById' = me
     OR coalesce(q->'applied','null'::jsonb) <> 'null'::jsonb OR NOT prima.acc_role(me, 'approve') THEN
    RAISE EXCEPTION 'Only the approver applies an approved request, once' USING ERRCODE = '42501';
  END IF;
  SELECT data INTO approver FROM prima.users WHERE id = me;
  until := (q->>'accessUntil')::date;
  IF until <= today OR until > today + 1100 THEN RAISE EXCEPTION 'Company access runs at most 3 years' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(q->'items') <> 'array' OR jsonb_array_length(q->'items') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Between 1 and 200 lines' USING ERRCODE = '42501'; END IF;
  short := substr(req, 5, 12);
  -- One account change at a time across the group.
  PERFORM pg_advisory_xact_lock(hashtext('prima:accounts'));
  FOR it IN SELECT value FROM jsonb_array_elements(q->'items') LOOP
    n := n + 1;
    nm := btrim(coalesce(it->>'name', '')); ttl := btrim(coalesce(it->>'title', ''));
    oid := lower(nullif(btrim(coalesce(it->>'entraOid', '')), ''));
    IF oid IS NOT NULL AND (oid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR EXISTS (SELECT 1 FROM prima.users WHERE lower(data->>'entraOid') = oid)) THEN
      RAISE EXCEPTION 'Line %: Microsoft account missing or already linked', n USING ERRCODE = '42501';
    END IF;
    IF it->>'personId' IS NOT NULL THEN
      SELECT data INTO p FROM prima.people WHERE id = it->>'personId';
      IF p IS NULL OR p->>'role' <> 'office' OR EXISTS (SELECT 1 FROM prima.users WHERE data->>'personId' = it->>'personId')
         OR it->>'personId' = approver->>'personId' THEN
        RAISE EXCEPTION 'Line %: HR record missing, already joined or your own', n USING ERRCODE = '42501';
      END IF;
    END IF;
    IF it->>'op' = 'create' THEN
      SELECT t.shape INTO shape FROM prima.acc_templates() t WHERE t.key = it->>'template';
      IF shape IS NULL OR length(nm) NOT BETWEEN 3 AND 160 OR length(ttl) NOT BETWEEN 2 AND 160 THEN
        RAISE EXCEPTION 'Line %: kind of account, name or title not allowed', n USING ERRCODE = '42501';
      END IF;
      office := shape->>'role' IN ('company_manager','admin_exec');
      IF jsonb_typeof(coalesce(it->'access','[]')) <> 'array'
         OR (office AND (jsonb_array_length(coalesce(it->'access','[]')) <> 0 OR NOT EXISTS (SELECT 1 FROM prima.companies WHERE id = it->>'companyId')))
         OR (NOT office AND jsonb_array_length(coalesce(it->'access','[]')) = 0) THEN
        RAISE EXCEPTION 'Line %: company or company access not allowed', n USING ERRCODE = '42501';
      END IF;
      uid := 'u-acc-' || short || '-' || n;
      u := shape || jsonb_build_object('id', uid, 'name', nm, 'title', ttl, 'siteIds', '[]'::jsonb, 'accountRequestId', req,
             'companyIds', CASE WHEN office THEN jsonb_build_array(it->>'companyId') ELSE '[]'::jsonb END);
      IF it->>'personId' IS NOT NULL THEN u := u || jsonb_build_object('personId', it->>'personId'); END IF;
      IF oid IS NOT NULL THEN u := u || jsonb_build_object('entraOid', oid); END IF;
      IF it->>'directoryId' IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM prima.users WHERE data->>'directoryId' = it->>'directoryId') THEN
          RAISE EXCEPTION 'Line %: that staff directory line already has an account', n USING ERRCODE = '42501';
        END IF;
        u := u || jsonb_build_object('directoryId', it->>'directoryId');
      END IF;
      IF shape ? 'financeRole' THEN
        IF coalesce(it->>'financeTeam','') !~ '^[1-7]$' THEN RAISE EXCEPTION 'Line %: Finance team 1 to 7', n USING ERRCODE = '42501'; END IF;
        u := u || jsonb_build_object('financeTeam', (it->>'financeTeam')::int);
      END IF;
      IF shape->>'actRole' IN ('auditor','enforcement') THEN
        IF coalesce(it->>'actTeam','') NOT IN ('1','2') THEN RAISE EXCEPTION 'Line %: ACT team 1 or 2', n USING ERRCODE = '42501'; END IF;
        u := u || jsonb_build_object('actTeam', (it->>'actTeam')::int);
      END IF;
      IF shape->>'opsTier' IN ('om','regional') THEN
        IF it->>'opsSector' IS NOT NULL THEN
          IF it->>'opsSector' NOT IN ('government','private') THEN RAISE EXCEPTION 'Line %: side', n USING ERRCODE = '42501'; END IF;
          u := u || jsonb_build_object('opsSector', it->>'opsSector');
        END IF;
        IF jsonb_typeof(it->'regionIds') <> 'array' OR jsonb_array_length(it->'regionIds') = 0
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(it->'regionIds') r WHERE jsonb_typeof(r) <> 'string') THEN
          RAISE EXCEPTION 'Line %: regions', n USING ERRCODE = '42501';
        END IF;
        u := u || jsonb_build_object('regionIds', it->'regionIds');
      END IF;
      IF shape->>'opsTier' = 'om' THEN
        IF jsonb_typeof(it->'areaStates') <> 'array' OR jsonb_array_length(it->'areaStates') = 0
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(it->'areaStates') r WHERE jsonb_typeof(r) <> 'string') THEN
          RAISE EXCEPTION 'Line %: states', n USING ERRCODE = '42501';
        END IF;
        u := u || jsonb_build_object('areaStates', it->'areaStates');
      END IF;
      INSERT INTO prima.users (id, data) VALUES (uid, u);
      users_out := users_out || to_jsonb(uid);
      FOR a IN SELECT value FROM jsonb_array_elements(coalesce(it->'access','[]')) LOOP
        IF a->>'scope' NOT IN ('act','monitor') OR NOT EXISTS (SELECT 1 FROM prima.companies WHERE id = a->>'companyId') THEN
          RAISE EXCEPTION 'Line %: company access', n USING ERRCODE = '42501';
        END IF;
        g := g + 1; gid := 'gr-acc-' || short || '-' || g;
        INSERT INTO prima.grants (id, company_id, data) VALUES (gid, a->>'companyId', jsonb_build_object('id', gid, 'userId', uid,
          'companyId', a->>'companyId', 'scope', a->>'scope', 'basis', 'Accounts and Access ' || req,
          'validFrom', to_char(today, 'YYYY-MM-DD'), 'validTo', to_char(until, 'YYYY-MM-DD')));
        grants_out := grants_out || to_jsonb(gid);
      END LOOP;
    ELSIF it->>'op' = 'update' THEN
      SELECT data INTO tgt FROM prima.users WHERE id = it->>'userId' FOR UPDATE;
      IF tgt IS NULL OR coalesce(tgt->'integration','null'::jsonb) NOT IN ('false'::jsonb,'null'::jsonb)
         OR tgt->>'role' IN ('site_device','guard') OR tgt->>'opsTier' = 'ceo' OR tgt->>'id' IN (me, q->>'preparedById')
         OR (coalesce(tgt->>'accessClosedFrom','') <> '' AND tgt->>'accessClosedFrom' <= to_char(today, 'YYYY-MM-DD')) THEN
        RAISE EXCEPTION 'Line %: this account is not changed here', n USING ERRCODE = '42501';
      END IF;
      leader := tgt->>'role' = 'director' OR coalesce(tgt->>'leadership','') <> '' OR tgt->>'opsTier' IN ('ogm','ops_director','coo');
      IF leader AND approver->>'opsTier' IS DISTINCT FROM 'ceo' THEN
        RAISE EXCEPTION 'Line %: a leader''s account needs the CEO', n USING ERRCODE = '42501';
      END IF;
      patch := '{}'::jsonb;
      IF it->>'name' IS NOT NULL THEN
        IF length(nm) NOT BETWEEN 3 AND 160 THEN RAISE EXCEPTION 'Line %: name', n USING ERRCODE = '42501'; END IF;
        patch := patch || jsonb_build_object('name', nm);
      END IF;
      IF it->>'title' IS NOT NULL THEN
        IF length(ttl) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Line %: title', n USING ERRCODE = '42501'; END IF;
        patch := patch || jsonb_build_object('title', ttl);
      END IF;
      IF oid IS NOT NULL THEN
        IF coalesce(tgt->>'entraOid','') <> '' THEN RAISE EXCEPTION 'Line %: already linked', n USING ERRCODE = '42501'; END IF;
        patch := patch || jsonb_build_object('entraOid', oid);
      END IF;
      IF it->>'personId' IS NOT NULL THEN
        IF coalesce(tgt->>'personId','') <> '' THEN RAISE EXCEPTION 'Line %: already joined to an HR record', n USING ERRCODE = '42501'; END IF;
        patch := patch || jsonb_build_object('personId', it->>'personId');
      END IF;
      IF patch <> '{}'::jsonb THEN UPDATE prima.users SET data = data || patch WHERE id = tgt->>'id'; END IF;
      FOR a IN SELECT value FROM jsonb_array_elements(coalesce(it->'addAccess','[]')) LOOP
        IF tgt->>'role' <> 'pwvsb_officer' OR a->>'scope' NOT IN ('act','monitor')
           OR NOT EXISTS (SELECT 1 FROM prima.companies WHERE id = a->>'companyId')
           OR EXISTS (SELECT 1 FROM prima.grants WHERE data->>'userId' = tgt->>'id' AND data->>'companyId' = a->>'companyId' AND data->>'validTo' >= to_char(today, 'YYYY-MM-DD')) THEN
          RAISE EXCEPTION 'Line %: company access', n USING ERRCODE = '42501';
        END IF;
        g := g + 1; gid := 'gr-acc-' || short || '-' || g;
        INSERT INTO prima.grants (id, company_id, data) VALUES (gid, a->>'companyId', jsonb_build_object('id', gid, 'userId', tgt->>'id',
          'companyId', a->>'companyId', 'scope', a->>'scope', 'basis', 'Accounts and Access ' || req,
          'validFrom', to_char(today, 'YYYY-MM-DD'), 'validTo', to_char(until, 'YYYY-MM-DD')));
        grants_out := grants_out || to_jsonb(gid);
      END LOOP;
      FOR a IN SELECT value FROM jsonb_array_elements(coalesce(it->'endAccess','[]')) LOOP
        UPDATE prima.grants SET data = jsonb_set(data, '{validTo}', to_jsonb(greatest(to_char(today - 1, 'YYYY-MM-DD'), data->>'validFrom')))
         WHERE id = a #>> '{}' AND data->>'userId' = tgt->>'id' AND data->>'validTo' >= to_char(today, 'YYYY-MM-DD');
        IF NOT FOUND THEN RAISE EXCEPTION 'Line %: that access is not current', n USING ERRCODE = '42501'; END IF;
        ended_out := ended_out || a;
      END LOOP;
    ELSE
      RAISE EXCEPTION 'Line %: unknown change', n USING ERRCODE = '42501';
    END IF;
  END LOOP;
  result := jsonb_build_object('at', q->'decidedAt', 'users', users_out, 'grants', grants_out, 'ended', ended_out);
  UPDATE prima.account_requests SET data = data || jsonb_build_object('applied', result) WHERE id = req;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION prima.apply_account_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.apply_account_request(text) TO prima_app;

DO $install$
BEGIN
  ALTER TABLE prima.account_requests ENABLE ROW LEVEL SECURITY;
  ALTER TABLE prima.account_requests FORCE ROW LEVEL SECURITY;
  EXECUTE format('CREATE POLICY accr_owner ON prima.account_requests FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
  REVOKE ALL ON prima.account_requests FROM PUBLIC, prima_app;
  GRANT SELECT, INSERT, UPDATE ON prima.account_requests TO prima_app;
  CREATE POLICY accr_read ON prima.account_requests FOR SELECT TO prima_app USING (prima.acc_role(current_setting('app.user_id', true), 'read'));
  CREATE POLICY accr_insert ON prima.account_requests FOR INSERT TO prima_app WITH CHECK (
    data->>'status' = 'waiting' AND data->>'preparedById' = current_setting('app.user_id', true)
    AND coalesce(data->'applied','null'::jsonb) = 'null'::jsonb AND data->'decidedById' = 'null'::jsonb
    AND prima.acc_role(current_setting('app.user_id', true), 'prepare'));
  CREATE POLICY accr_decide ON prima.account_requests FOR UPDATE TO prima_app
    USING (data->>'status' = 'waiting' AND prima.acc_role(current_setting('app.user_id', true), 'approve'))
    WITH CHECK (data->>'status' IN ('approved','returned') AND data->>'decidedById' = current_setting('app.user_id', true)
      AND data->>'preparedById' <> current_setting('app.user_id', true) AND coalesce(data->'applied','null'::jsonb) = 'null'::jsonb);
END
$install$;
COMMIT;
