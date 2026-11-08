-- Integration release boundary: PROPOSED ONLY. This file is not in the current
-- five-module release manifest. Earlier pinned-module descriptions below are
-- historical; installing this module needs separate review and authorization.
-- Central Admin walls, Phase 5A part 2 (Fauzan, 1 Nov 2026). A pinned module in db/release-manifest.json (id
-- central_admin_walls), installed only by an authorized owner with the reviewed selected-module command
-- (apps/api/src/module-install.ts). It stays out of the base schema so the reviewed IT pilot base is unchanged. Not
-- installed anywhere by this file.
--
-- The six Central Admin tables already carry the company wall. This RESTRICTIVE wall is added on top of it (it narrows,
-- never widens), so a central department with a company grant for other work (HR, FWM, arms, CMS, transport) or a site
-- user does not read company secretary records, legal matters or mandates. The API sends the walls with every request
-- (packages/core/src/access.ts, dataWalls):
--   corporate: the company's manager and admin executives, group leaders, the company secretary, PWVSB legal and ACT;
--   legal:     the same, except the company secretary;
--   mandates:  PWVSB legal, group leaders and the company manager.
-- The service still decides who may change what. Repeat-safe: it replaces its own policies only.
BEGIN;
DO $$
DECLARE
  w record;
BEGIN
  FOR w IN SELECT * FROM (VALUES ('corp_profiles', 'corporate'), ('corp_filings', 'corporate'), ('corp_changes', 'corporate'),
                                 ('corp_audits', 'corporate'), ('legal_matters', 'legal'), ('gov_mandates', 'mandates')) AS v(tbl, wall)
  LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS central_admin_wall ON prima.%1$I;
      CREATE POLICY central_admin_wall ON prima.%1$I AS RESTRICTIVE USING (prima.has_wall(%2$L)) WITH CHECK (prima.has_wall(%2$L));
    $f$, w.tbl, w.wall);
  END LOOP;
END $$;
COMMIT;
