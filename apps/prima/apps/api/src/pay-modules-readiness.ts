// P85: what is missing or drifted for the pay formulas and guard pay modules (db/modules/pay-formulas-v1.sql,
// db/modules/guard-pay-v1.sql). Names only, never data. Each table must exist, force row security, carry its walls,
// let the app role read and record, and never let it delete.
import type { PoolClient } from 'pg';

type Client = Pick<PoolClient, 'query'>;

async function tableProblems(client: Client, table: string, policies: string[]): Promise<string[]> {
  const t = await client.query(
    `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege('prima_app', c.oid, 'SELECT') AS can_select, has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
            has_table_privilege('prima_app', c.oid, 'DELETE') AS can_delete
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = $1 AND c.relkind = 'r'`,
    [table],
  );
  if (t.rows.length !== 1) return [`Table prima.${table} is missing.`];
  const out: string[] = [];
  const r = t.rows[0];
  if (!r.rls || !r.forced) out.push(`prima.${table} does not force row security.`);
  if (!r.can_select || !r.can_insert) out.push(`The app role cannot read and record prima.${table}.`);
  if (r.can_delete) out.push(`The app role may delete from prima.${table}.`);
  const p = await client.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'prima' AND tablename = $1`, [table]);
  const have = new Set(p.rows.map((x) => x.policyname as string));
  for (const want of policies) if (!have.has(want)) out.push(`prima.${table} is missing its ${want} policy.`);
  return out;
}

export async function payFormulasProblems(client: Client): Promise<string[]> {
  const out: string[] = [];
  for (const t of ['pay_formulas', 'pay_formula_uses', 'pay_law_versions']) out.push(...(await tableProblems(client, t, ['dept_wall'])));
  for (const t of ['site_hours_approvals', 'public_holiday_lists']) out.push(...(await tableProblems(client, t, ['company_wall'])));
  return out;
}

export async function guardPayProblems(client: Client): Promise<string[]> {
  const out: string[] = [];
  for (const t of ['guard_pay_runs', 'guard_pay_advances', 'guard_loans']) out.push(...(await tableProblems(client, t, ['company_wall'])));
  out.push(...(await tableProblems(client, 'statutory_versions', ['statutory_read', 'statutory_write', 'statutory_update'])));
  return out;
}
