// What is missing or drifted in the database for foreign-worker recruitment steps (db/modules/fw-recruit-v1.sql).
// Names only, never data. Proposed for the release manifest; no install is authorized.
import type { PoolClient } from 'pg';

export async function fwRecruitProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const t = await client.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege('prima_app', c.oid, 'SELECT') AS can_select, has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
            has_table_privilege('prima_app', c.oid, 'UPDATE') AS can_update, has_table_privilege('prima_app', c.oid, 'DELETE') AS can_delete,
            (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'c') AS checks
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'fw_recruit_files' AND c.relkind = 'r'`,
  );
  if (t.rows.length !== 1) return ['Table prima.fw_recruit_files is missing.'];
  const r = t.rows[0];
  if (!r.rls || !r.forced) out.push('prima.fw_recruit_files does not force row security.');
  if (!r.can_select || !r.can_insert || !r.can_update) out.push('The app role cannot read and record recruitment files.');
  if (r.can_delete) out.push('The app role may delete recruitment files.');
  if (r.checks < 4) out.push('A recruitment file constraint is missing.');
  const p = await client.query(
    `SELECT policyname, permissive, roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'fw_recruit_files'`,
  );
  const wall = p.rows.find((x) => x.policyname === 'company_wall');
  if (p.rows.length !== 1 || !wall) out.push('prima.fw_recruit_files must have exactly its company wall policy.');
  else {
    const want = '(company_id = ANY (prima.visible_companies()))';
    if (wall.permissive !== 'PERMISSIVE' || wall.cmd !== 'ALL' || JSON.stringify(wall.roles) !== '["public"]' || wall.qual !== want || wall.with_check !== want)
      out.push('The recruitment company wall differs from the reviewed module.');
  }
  return out;
}
