-- IT department gaps (Fauzan, 23 Nov 2026: "Do the gap", study "IT department in Prima: how it works and the gaps").
-- Separate reviewed module; never run implicitly during startup. NOT on db/release-manifest.json: Fauzan runs it with
-- infra/run-db-migration.sh after the merge, with the other off-list modules. It needs only the base schema.
--
-- B3: a company manager sees the IT devices their company rents from Merdeka Network and the monthly rental bills.
-- prima.it_assets and prima.it_rental_bills keep their own row rules and readiness checks unchanged: this module adds
-- no policy to them. It adds one read-only definer function that returns, for ONE company, only a few columns, and only
-- when the signed-in person is an active company manager holding that company.
BEGIN;
CREATE OR REPLACE FUNCTION prima.it_company_rentals(company text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM prima.users u
    WHERE u.id = current_setting('app.user_id', true)
      AND u.data->>'role' = 'company_manager'
      AND coalesce(u.data->'integration', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)
      AND (coalesce(u.data->>'accessClosedFrom', '') = '' OR u.data->>'accessClosedFrom' > to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
      AND u.data->'companyIds' ? company)
  AND EXISTS (SELECT 1 FROM prima.companies c WHERE c.id = company)
 THEN jsonb_build_object(
   'companyId', company,
   'devices', coalesce((SELECT jsonb_agg(jsonb_build_object('tag', a.data->>'tag', 'kind', a.data->>'kind', 'model', a.data->>'model',
        'status', a.data->>'status', 'assignedTo', a.data->'assignedTo', 'location', a.data->>'location') ORDER BY a.data->>'tag')
      FROM prima.it_assets a WHERE a.data->>'ownerId' = company AND a.data->>'status' IN ('in_use', 'repair')), '[]'::jsonb),
   'bills', coalesce((SELECT jsonb_agg(x.b ORDER BY x.period DESC) FROM (
      SELECT b.data->>'period' period, jsonb_build_object('period', b.data->>'period', 'total', (b.data->>'total')::numeric,
        'invoiceRef', b.data->>'invoiceRef', 'paid', coalesce(b.data->'paid', 'null'::jsonb) <> 'null'::jsonb, 'issuedAt', b.data->'issuedAt') b
      FROM prima.it_rental_bills b WHERE b.data->>'companyId' = company ORDER BY b.data->>'period' DESC LIMIT 24) x), '[]'::jsonb))
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION prima.it_company_rentals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.it_company_rentals(text) TO prima_app;
COMMIT;
