-- ACT investigation files: their own database wall (ACT Director gap B2; Fauzan, 23 Nov 2026: "Do the gap").
-- Investigation files are rows of prima.act_audits with data->>'kind' = 'investigation' (masterplan item 241). Before
-- this module the only wall on prima.act_audits was 'act', which group leadership also holds, so at database level a
-- leader's session could read an investigation file even though the service refuses it. After it, an investigation
-- row is read or written only by a session holding the 'act_staff' wall: ACT department staff (Director, Manager,
-- Auditors, Enforcement), never group leadership. The rest of prima.act_audits (workflow audits, report reviews,
-- timings, field checks) keeps the existing 'act' wall unchanged. Team limits stay in the service on top.
-- Repeat-safe. Run only with infra/run-db-migration.sh, staging first, with the CEO's go-ahead.
BEGIN;
DROP POLICY IF EXISTS act_investigation_wall ON prima.act_audits;
CREATE POLICY act_investigation_wall ON prima.act_audits AS RESTRICTIVE
  USING (data->>'kind' IS DISTINCT FROM 'investigation' OR prima.has_wall('act_staff'))
  WITH CHECK (data->>'kind' IS DISTINCT FROM 'investigation' OR prima.has_wall('act_staff'));
COMMIT;
