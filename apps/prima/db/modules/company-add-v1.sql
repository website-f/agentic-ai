-- Add a company from the app (Fitri package N4, Fauzan 13 Nov 2026). Separate reviewed module; never run implicitly
-- during startup. NOT yet registered in db/release-manifest.json: the CEO-run migration and the combined release review
-- add it. Today prima_app may only read and (CEO) update company rows; this lets the CEO, holding the company_add
-- wall, insert a new company row as a draft. Updates, deletes and every other role are unchanged.
BEGIN;
DROP POLICY IF EXISTS company_ceo_insert ON prima.companies;
CREATE POLICY company_ceo_insert ON prima.companies FOR INSERT TO prima_app
  WITH CHECK (prima.has_wall('company_add')
              AND data->>'verificationStatus' = 'draft'
              AND data->>'draftById' = current_setting('app.user_id', true));
GRANT INSERT ON prima.companies TO prima_app;
COMMIT;
