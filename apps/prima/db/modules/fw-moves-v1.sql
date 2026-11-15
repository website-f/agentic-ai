-- Foreign worker hostel / site moves, hostel needs, hostel inventory, checks, damage / loss and maintenance
-- (Fitri package Part P, FWM papers S1-S7 / T1-T3, Fauzan 13-14 Nov 2026). Separate reviewed module; never run
-- implicitly during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined
-- release review add it. Nothing is deleted: a move or need is cancelled or rejected with a reason.
-- Walls: the employer's or the new site's company (company wall), FWM / COO / CEO / group leaders / ACT (fw_hostel
-- wall). Asset Management (hostel_need_am wall) reads only approved needs and approved repairs, which carry the
-- hostel's name and address only (no residents, no worker names).
BEGIN;
CREATE TABLE prima.fw_moves (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE prima.hostel_needs (id text PRIMARY KEY, data jsonb NOT NULL, CHECK (data->>'id' = id));
CREATE TABLE prima.hostel_recs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (id = 'fw-hostel' OR data->>'kind' IN ('inventory', 'check', 'count', 'damage', 'maint'))
);
ALTER TABLE prima.fw_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.fw_moves FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.hostel_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.hostel_needs FORCE ROW LEVEL SECURITY;
ALTER TABLE prima.hostel_recs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.hostel_recs FORCE ROW LEVEL SECURITY;

CREATE POLICY fw_move_wall ON prima.fw_moves
  USING (prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies()) OR data->>'newCompanyId' = ANY (prima.visible_companies()))
  WITH CHECK (prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies()) OR data->>'newCompanyId' = ANY (prima.visible_companies()));

CREATE POLICY hostel_need_wall ON prima.hostel_needs
  USING (prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies())
         OR (prima.has_wall('hostel_need_am') AND data->>'status' IN ('approved', 'ordered', 'delivered', 'received')))
  WITH CHECK (prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies())
         OR (prima.has_wall('hostel_need_am') AND data->>'status' IN ('ordered', 'delivered')));

CREATE POLICY hostel_rec_wall ON prima.hostel_recs
  USING (id = 'fw-hostel' OR prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies())
         OR (prima.has_wall('hostel_need_am') AND data->>'kind' = 'maint' AND data->>'status' IN ('approved', 'ordered', 'done', 'closed')))
  WITH CHECK ((id = 'fw-hostel' AND prima.has_wall('fw_hostel')) OR prima.has_wall('fw_hostel') OR data->>'companyId' = ANY (prima.visible_companies())
         OR (prima.has_wall('hostel_need_am') AND data->>'kind' = 'maint' AND data->>'status' IN ('ordered', 'closed')));

GRANT SELECT, INSERT, UPDATE ON prima.fw_moves, prima.hostel_needs, prima.hostel_recs TO prima_app;
REVOKE DELETE, TRUNCATE ON prima.fw_moves, prima.hostel_needs, prima.hostel_recs FROM prima_app;
COMMIT;
