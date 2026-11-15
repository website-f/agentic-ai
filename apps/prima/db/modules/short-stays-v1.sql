-- Short stays on the Asset Management homestay houses (Fitri package Part P19-P39, Fauzan 14 Nov 2026): staff stay
-- requests from Government Operations and HQ departments, and the short-stay records (settings, enquiries, Airbnb
-- payouts, complaints, cleaning, inventory counts, cleaner comparisons, consented staff damage recoveries).
-- Bookings themselves stay in prima.am_bookings (module am-extras-v1): one engine, one calendar per house.
-- Separate reviewed module; never run implicitly during startup. NOT yet registered in db/release-manifest.json: the
-- CEO-run migration and the combined release review add it. Nothing is deleted.
-- Walls:
--   stay_requests: the Asset Management wall, the applicant, and the named occupants (to acknowledge damage).
--   short_stay_recs: the Asset Management wall; a staff member inserts only their own consented recovery; staff
--     payroll (ss_recovery wall) reads recoveries; everyone reads the settings row (the staff rate).
--   am_properties: applicants (ss_requester wall) read homestay houses only, to choose one.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.stay_requests (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE IF NOT EXISTS prima.short_stay_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'kind' IN ('settings', 'enquiry', 'payout', 'complaint', 'clean', 'recovery', 'count', 'cleaner'))
);
ALTER TABLE prima.stay_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.stay_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.short_stay_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.short_stay_recs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ss_req_read ON prima.stay_requests;
DROP POLICY IF EXISTS ss_req_insert ON prima.stay_requests;
DROP POLICY IF EXISTS ss_req_update ON prima.stay_requests;
CREATE POLICY ss_req_read ON prima.stay_requests FOR SELECT
  USING (prima.has_wall('asset_read') OR data->>'requesterId' = current_setting('app.user_id', true)
         OR (data->'occupantUserIds') ? current_setting('app.user_id', true));
CREATE POLICY ss_req_insert ON prima.stay_requests FOR INSERT
  WITH CHECK (data->>'requesterId' = current_setting('app.user_id', true) AND data->>'status' = 'submitted');
CREATE POLICY ss_req_update ON prima.stay_requests FOR UPDATE
  USING (prima.has_wall('asset_write') OR data->>'requesterId' = current_setting('app.user_id', true)
         OR (data->'occupantUserIds') ? current_setting('app.user_id', true))
  WITH CHECK (prima.has_wall('asset_write') OR data->>'requesterId' = current_setting('app.user_id', true)
         OR (data->'occupantUserIds') ? current_setting('app.user_id', true));

DROP POLICY IF EXISTS ss_rec_read ON prima.short_stay_recs;
DROP POLICY IF EXISTS ss_rec_insert ON prima.short_stay_recs;
DROP POLICY IF EXISTS ss_rec_update ON prima.short_stay_recs;
CREATE POLICY ss_rec_read ON prima.short_stay_recs FOR SELECT
  USING (prima.has_wall('asset_read') OR data->>'kind' = 'settings'
         OR (data->>'kind' = 'recovery' AND (prima.has_wall('ss_recovery') OR data->>'userId' = current_setting('app.user_id', true))));
CREATE POLICY ss_rec_insert ON prima.short_stay_recs FOR INSERT
  WITH CHECK (prima.has_wall('asset_write')
         OR (data->>'kind' = 'recovery' AND data->>'status' = 'due' AND data->>'userId' = current_setting('app.user_id', true)));
CREATE POLICY ss_rec_update ON prima.short_stay_recs FOR UPDATE
  USING (prima.has_wall('asset_write')) WITH CHECK (prima.has_wall('asset_write'));

DROP POLICY IF EXISTS ss_homestay_read ON prima.am_properties;
CREATE POLICY ss_homestay_read ON prima.am_properties FOR SELECT
  USING (data->>'kind' = 'HOMESTAY' AND prima.has_wall('ss_requester'));

GRANT SELECT, INSERT, UPDATE ON prima.stay_requests, prima.short_stay_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.stay_requests, prima.short_stay_recs FROM prima_app;
COMMIT;
