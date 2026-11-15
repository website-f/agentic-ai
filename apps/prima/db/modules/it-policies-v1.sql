-- Merdeka Network IT policies, the records part (Fitri package Part Q6-Q23, Fauzan's answers 13-14 Nov 2026):
-- purchase requests from any department, technical assessments, quote details and recommendations, Finance budget
-- checks, receiving (GRN) and quarantine, register details before handover, disposal records with three approvals,
-- the data wipe log, refurbishment and end-of-life reviews, rental agreements per company and returns, the Microsoft
-- 365 account register and account requests, new domains and domain security, and the IP register.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration (infra/run-db-migration.sh) and the combined release review add it. Nothing is deleted.
-- Walls:
--   read:   IT, ACT audit, the COO and the CEO (prima.it_record_permission('read')); Finance and the other IT-asset
--           readers for purchase, asset and agreement kinds; the PDPA officer for the wipe log (read only); the
--           requester and the named line manager for their own requests; company managers for their own company's
--           IP rows, agreements and disposals; CoS/DCoS for account requests and disposals (it_policy_party wall).
--   insert: IT staff; anyone for their own request (request, account request, domain request) as 'submitted';
--           Finance (it_policy_party) for a budget check.
--   update: IT staff; the it_policy_party wall (approvers); the named line manager on an account request.
--   Identity, kind and reference never change; history only grows (append-only), checked by a trigger.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.it_policy_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings','request','assessment','quoteInfo','budget','grn','assetDetail','disposal','wipe','refurb','eol','agreement','rentalReturn','m365','acctReq','domainReq','domainSec','ip','webProject')),
  CHECK (jsonb_typeof(data->'history') = 'array')
);
ALTER TABLE prima.it_policy_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.it_policy_recs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS itp_read ON prima.it_policy_recs;
DROP POLICY IF EXISTS itp_insert ON prima.it_policy_recs;
DROP POLICY IF EXISTS itp_update ON prima.it_policy_recs;
CREATE POLICY itp_read ON prima.it_policy_recs FOR SELECT
  USING (prima.it_record_permission('read')
         OR (data->>'kind' IN ('assessment','quoteInfo','budget','grn','assetDetail','disposal','agreement','rentalReturn') AND prima.it_record_permission('asset_read'))
         OR (data->>'kind' = 'wipe' AND EXISTS (SELECT 1 FROM prima.users u WHERE u.id = current_setting('app.user_id', true) AND u.data->>'department' = 'pdpa'))
         OR data->>'requesterId' = current_setting('app.user_id', true)
         OR data->>'lineManagerId' = current_setting('app.user_id', true)
         -- V8 (Part V): the content owner and content approver named on a new website request.
         OR (data->>'kind' = 'webProject' AND current_setting('app.user_id', true) IN (data->'d'->>'contentOwnerId', data->'d'->>'contentApproverId', data->'d'->>'businessOwnerId'))
         OR (data->>'kind' IN ('acctReq','disposal','budget','agreement','ip','domainReq','webProject') AND prima.has_wall('it_policy_party')
             AND (data->>'kind' NOT IN ('ip','agreement','webProject') OR data->>'companyId' = ANY (prima.visible_companies()) OR prima.it_record_permission('asset_read'))));
CREATE POLICY itp_insert ON prima.it_policy_recs FOR INSERT
  WITH CHECK (prima.it_record_permission('write')
         OR (data->>'kind' IN ('request','acctReq','domainReq','webProject') AND data->>'status' = 'submitted' AND data->>'requesterId' = current_setting('app.user_id', true))
         OR (data->>'kind' = 'budget' AND prima.has_wall('it_policy_party')));
CREATE POLICY itp_update ON prima.it_policy_recs FOR UPDATE
  USING (prima.it_record_permission('write') OR prima.has_wall('it_policy_party') OR data->>'lineManagerId' = current_setting('app.user_id', true)
         OR (data->>'kind' = 'webProject' AND current_setting('app.user_id', true) IN (data->'d'->>'contentOwnerId', data->'d'->>'contentApproverId')))
  WITH CHECK (prima.it_record_permission('write') OR prima.has_wall('it_policy_party') OR data->>'lineManagerId' = current_setting('app.user_id', true)
         OR (data->>'kind' = 'webProject' AND current_setting('app.user_id', true) IN (data->'d'->>'contentOwnerId', data->'d'->>'contentApproverId')));

-- Append-only history; identity, kind, reference and creation never change.
CREATE OR REPLACE FUNCTION prima.itp_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IT policy records are never deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data->'kind' IS DISTINCT FROM OLD.data->'kind' OR NEW.data->'ref' IS DISTINCT FROM OLD.data->'ref'
       OR NEW.data->'at' IS DISTINCT FROM OLD.data->'at' OR NEW.data->'byId' IS DISTINCT FROM OLD.data->'byId' THEN
      RAISE EXCEPTION 'IT policy record identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(NEW.data->'history') <= jsonb_array_length(OLD.data->'history')
       OR (NEW.data->'history') - (jsonb_array_length(NEW.data->'history') - 1) IS DISTINCT FROM OLD.data->'history'
       OR (NEW.data->>'version')::int <> (OLD.data->>'version')::int + 1 THEN
      RAISE EXCEPTION 'IT policy history is append-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS itp_guard ON prima.it_policy_recs;
CREATE TRIGGER itp_guard BEFORE UPDATE OR DELETE ON prima.it_policy_recs FOR EACH ROW EXECUTE FUNCTION prima.itp_guard();

GRANT SELECT, INSERT, UPDATE ON prima.it_policy_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.it_policy_recs FROM prima_app;
COMMIT;
