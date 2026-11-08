import type { PoolClient } from 'pg';

/** Tables of the optional cleaning and duty plan module (db/modules/cleaning-ops-v1.sql). */
export const CLEANING_OPS_TABLES = ['cleaning_sites', 'cleaning_days', 'cleaning_stock', 'site_kits', 'duty_plans', 'guard_terms'] as const;

/** Whether every table of the module exists. */
export async function cleaningOpsInstalled(client: PoolClient): Promise<boolean> {
  const r = await client.query(
    `SELECT bool_and(to_regclass('prima.' || t) IS NOT NULL) AS ok FROM unnest($1::text[]) t`,
    [CLEANING_OPS_TABLES as unknown as string[]],
  );
  return r.rows[0]?.ok === true;
}

/** What is missing or wrong in the database for the module; empty when ready. */
export async function cleaningOpsProblems(client: PoolClient): Promise<string[]> {
  const out: string[] = [];
  for (const t of CLEANING_OPS_TABLES) {
    const r = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS has,
              coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass($1)), false) AS rls,
              EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass($1) AND polname = 'company_wall') AS wall,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'SELECT') AND has_table_privilege('prima_app', $1, 'INSERT') AND has_table_privilege('prima_app', $1, 'UPDATE') AS rights,
              to_regclass($1) IS NOT NULL AND (has_table_privilege('prima_app', $1, 'DELETE') OR has_table_privilege('prima_app', $1, 'TRUNCATE')) AS too_much`,
      [`prima.${t}`],
    );
    const x = r.rows[0];
    if (!x.has) {
      out.push(`prima.${t} is missing: apply db/modules/cleaning-ops-v1.sql in an authorized migration.`);
      continue;
    }
    if (!x.rls) out.push(`Row-level security is not forced on prima.${t}.`);
    if (!x.wall) out.push(`The company wall policy is missing on prima.${t}.`);
    if (!x.rights) out.push(`The app role cannot read, add or change prima.${t}.`);
    if (x.too_much) out.push(`The app role may delete from prima.${t}.`);
  }
  return out;
}
