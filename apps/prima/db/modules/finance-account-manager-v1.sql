-- Finance Account Manager accounts (Fauzan, 23 Nov 2026, Finance study D1: "It sit below FD, it do what FD
-- delegated"). Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json: Fitri
-- runs it with infra/run-db-migration.sh, staging first, AFTER accounts-access-v1 and marketing-accounts-v1, and only
-- with Fauzan's go-ahead.
--
-- It adds no table. It replaces prima.acc_templates() with the marketing-accounts-v1 list plus one kind of account, so
-- that IT or HR can prepare a Finance Account Manager in Accounts and Access and the HR Director or the CEO approves
-- it. The account has no Finance team and no Finance role: what it may do is what the Finance Director delegates in
-- Finance settings (kept on PWVSB's Finance row). Must equal ACCOUNT_TEMPLATES in packages/core/src/accounts-access.ts
-- (checked by apps/api/test/accounts-access-pg.test.ts). Safe to run again.
BEGIN;
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
  ('cos_office', '{"role":"pwvsb_officer","department":"chief_of_staff"}'::jsonb),
  ('marketing_manager', '{"role":"pwvsb_officer","department":"marketing","marketingRole":"manager"}'::jsonb),
  ('marketing_deputy', '{"role":"pwvsb_officer","department":"marketing","marketingRole":"deputy"}'::jsonb),
  ('marketing_executive', '{"role":"pwvsb_officer","department":"marketing","marketingRole":"executive"}'::jsonb),
  ('finance_account_manager', '{"role":"pwvsb_officer","department":"finance","financeAccountManager":true}'::jsonb)
 ) AS t(key, shape)
$$;
COMMIT;
