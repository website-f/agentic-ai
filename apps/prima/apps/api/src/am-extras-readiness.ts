import type { PoolClient } from 'pg';

/** Tables of the optional Asset Management extras module (db/modules/am-extras-v1.sql). */
export const AM_EXTRAS_TABLES = ['am_contractors', 'am_lettings', 'am_meters', 'am_bookings', 'am_harvests', 'am_pm_plans'] as const;

/** Whether every table of the module exists. */
export async function amExtrasInstalled(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  const r = await client.query(`SELECT bool_and(to_regclass('prima.' || t) IS NOT NULL) AS ok FROM unnest($1::text[]) t`, [AM_EXTRAS_TABLES as unknown as string[]]);
  return r.rows[0]?.ok === true;
}

/** What is missing or wrong in the database for the module; empty when ready. */
export async function amExtrasProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  for (const t of AM_EXTRAS_TABLES) {
    const r = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS has,
              coalesce((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = to_regclass($1)), false) AS rls,
              (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass($1) AND polname IN ('dept_read','dept_insert','dept_update')) AS walls,
              to_regclass($1) IS NOT NULL AND has_table_privilege('prima_app', $1, 'SELECT') AND has_table_privilege('prima_app', $1, 'INSERT') AND has_table_privilege('prima_app', $1, 'UPDATE') AS rights,
              to_regclass($1) IS NOT NULL AND (has_table_privilege('prima_app', $1, 'DELETE') OR has_table_privilege('prima_app', $1, 'TRUNCATE')) AS too_much`,
      [`prima.${t}`],
    );
    const x = r.rows[0];
    if (!x.has) {
      out.push(`prima.${t} is missing: apply db/modules/am-extras-v1.sql in an authorized migration.`);
      continue;
    }
    if (!x.rls) out.push(`Row-level security is not forced on prima.${t}.`);
    if (Number(x.walls) !== 3) out.push(`The Asset Management wall policies are missing on prima.${t}.`);
    if (!x.rights) out.push(`The app role cannot read, add or change prima.${t}.`);
    if (x.too_much) out.push(`The app role may delete from prima.${t}.`);
  }
  return out;
}
