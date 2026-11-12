-- E5 (Fauzan, 11 Nov 2026 handover: "PGL is also an employer of staff", needs a database rule change, installed through
-- the CEO-run migration). Perfect Global Logistics Sdn Bhd ('pgl', Fauzan 5 Nov 2026) employs the Transport department,
-- like PWVSB, Merdeka Network, Goodwill Empire and Sasa Team: a central employer with no company office.
--
-- The service already treats all five as central employers (packages/core/src/access.ts CENTRAL_EMPLOYER_IDS), and the
-- base schema and the IT cleanup and rental correction scopes already accept 'pgl'. One database rule still knew only
-- PWVSB and Merdeka: the hand-over layer's prima.org_central_employer (db/modules/org-links-v1.sql), which refuses a
-- company-office hand-over line for a central employer. This module makes that rule know every central employer, so the
-- database refuses a company-office line for a PGL (or Goodwill Empire, or Sasa Team) staff member exactly as the
-- service never writes one. Nothing else changes: no table, no policy, no row.
--
-- prima.ce_central_employers() is the one list (the marker the module installer looks for, prefix ce_); the hand-over
-- rule keeps its own fixed list so it stays a plain immutable check. Neither is callable by the app role.
-- Requires org_links. Repeat-safe (CREATE OR REPLACE); a second run changes nothing.
BEGIN;
CREATE OR REPLACE FUNCTION prima.ce_central_employers() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT ARRAY['pwvsb', 'merdeka', 'goodwill', 'sasateam', 'pgl']::text[]
$$;
CREATE OR REPLACE FUNCTION prima.org_central_employer(company text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT company IN ('pwvsb', 'merdeka', 'goodwill', 'sasateam', 'pgl')
$$;
REVOKE ALL ON FUNCTION prima.ce_central_employers(), prima.org_central_employer(text) FROM PUBLIC;
COMMIT;
