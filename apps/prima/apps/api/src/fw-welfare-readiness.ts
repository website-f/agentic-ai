// What is missing or drifted in the database for foreign-worker welfare checks (db/modules/fw-welfare-v1.sql).
// Names only, never data. Added at the combined merge (R14b) so the module can join the one release manifest.
import type { PoolClient } from 'pg';

export async function fwWelfareProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const t = await client.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege('prima_app', c.oid, 'SELECT') AS can_select, has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
            has_table_privilege('prima_app', c.oid, 'UPDATE') AS can_update, has_table_privilege('prima_app', c.oid, 'DELETE') AS can_delete,
            (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'c') AS checks
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'fw_welfare_checks' AND c.relkind = 'r'`,
  );
  if (t.rows.length !== 1) return ['Table prima.fw_welfare_checks is missing.'];
  const r = t.rows[0];
  if (!r.rls || !r.forced) out.push('prima.fw_welfare_checks does not force row security.');
  if (!r.can_select || !r.can_insert || !r.can_update) out.push('The app role cannot read and record welfare checks.');
  if (r.can_delete) out.push('The app role may delete welfare checks.');
  if (r.checks < 4) out.push('A welfare check constraint is missing.');
  const p = await client.query(
    `SELECT policyname, permissive, roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'fw_welfare_checks'`,
  );
  const wall = p.rows.find((x) => x.policyname === 'company_wall');
  if (p.rows.length !== 1 || !wall) out.push('prima.fw_welfare_checks must have exactly its company wall policy.');
  else {
    const want = '(company_id = ANY (prima.visible_companies()))';
    if (wall.permissive !== 'PERMISSIVE' || wall.cmd !== 'ALL' || JSON.stringify(wall.roles) !== '["public"]' || wall.qual !== want || wall.with_check !== want)
      out.push('The welfare company wall differs from the reviewed module.');
  }
  return out;
}
