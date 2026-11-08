-- Integration release boundary: PROPOSED ONLY. This file is not in the current
-- five-module release manifest. Earlier pinned-module descriptions below are
-- historical; installing this module needs separate review and authorization.
-- Central Admin 5D panel firms (Fauzan, 2 Nov 2026: the audit firm panel is keyed in by staff). A pinned module in
-- db/release-manifest.json (id central_admin_panel, requires central_admin_walls). Not installed anywhere by this file;
-- only an authorized owner installs it with the reviewed selected-module command.
-- Until then the API reads the starting list from rule COR-SECRETARY and refuses to add firms.
--
-- One group-level table, no company column. Read and write need the corporate or legal wall (packages/core/src/access.ts,
-- dataWalls); the service decides who keeps which kind (Central Admin: audit and secretary firms; PWVSB legal: law
-- firms). Rows are never deleted: a firm taken off the panel keeps its record. Repeat-safe.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.panel_firms (id text PRIMARY KEY, data jsonb NOT NULL);
ALTER TABLE prima.panel_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.panel_firms FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.panel_firms FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.panel_firms TO prima_app;
DROP POLICY IF EXISTS panel_firms_wall ON prima.panel_firms;
CREATE POLICY panel_firms_wall ON prima.panel_firms
  USING (prima.has_wall('corporate') OR prima.has_wall('legal'))
  WITH CHECK (prima.has_wall('corporate') OR prima.has_wall('legal'));
COMMIT;
