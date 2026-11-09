// Catalogue check for the optional pay formulas module (db/modules/pay-formulas-v1.sql). Modelled on
// item-register-readiness.ts. Names only, never data; installs nothing. The expected tables, policy names and app-role
// rights are read from the pinned module file itself, so the check cannot drift from what the module creates: each table
// must exist, force row security, carry every policy the file creates, give prima_app exactly the rights the file grants
// and never DELETE or TRUNCATE.
import type { PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPTIONAL_MODULE_SPECS, releaseRoot } from './release-artifact';

type Client = Pick<PoolClient, 'query'>;
type Right = 'SELECT' | 'INSERT' | 'UPDATE';

/** What a module file creates: its own tables, every (table, policy) pair and the rights granted to prima_app. */
export interface ModuleShape {
  tables: string[];
  policies: Array<[table: string, policy: string]>;
  grants: Record<string, Right[]>;
}

const names = (list: string) => [...list.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]);
const rights = (list: string) => list.split(',').map((x) => x.trim().toUpperCase()).filter((x): x is Right => x === 'SELECT' || x === 'INSERT' || x === 'UPDATE');

/** Reads the module's own DDL: CREATE TABLE, CREATE POLICY and GRANT ... TO prima_app, including the
 * `FOREACH t IN ARRAY ARRAY[...] LOOP ... %1$I ... END LOOP` blocks the pay modules use for several tables at once. */
export function moduleShape(sql: string): ModuleShape {
  let text = sql.replace(/--[^\n]*/g, '');
  const shape: ModuleShape = { tables: [], policies: [], grants: {} };
  const grant = (table: string, list: string) => {
    shape.grants[table] = [...new Set([...(shape.grants[table] ?? []), ...rights(list)])];
  };
  for (const m of text.matchAll(/CREATE TABLE IF NOT EXISTS prima\.([a-z_][a-z0-9_]*)/g)) shape.tables.push(m[1]);
  for (const loop of text.matchAll(/FOREACH\s+t\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]\s+LOOP([\s\S]*?)END LOOP;/g)) {
    for (const table of names(loop[1])) {
      for (const p of loop[2].matchAll(/CREATE POLICY ([a-z_][a-z0-9_]*) ON prima\.%1\$I/g)) shape.policies.push([table, p[1]]);
      for (const g of loop[2].matchAll(/GRANT ([A-Z, ]+) ON prima\.%1\$I TO prima_app/g)) grant(table, g[1]);
    }
  }
  text = text.replace(/FOREACH\s+t\s+IN\s+ARRAY\s+ARRAY\[[^\]]*\]\s+LOOP[\s\S]*?END LOOP;/g, '');
  for (const p of text.matchAll(/CREATE POLICY ([a-z_][a-z0-9_]*) ON prima\.([a-z_][a-z0-9_]*)/g)) shape.policies.push([p[2], p[1]]);
  for (const g of text.matchAll(/GRANT ([A-Z, ]+) ON prima\.([a-z_][a-z0-9_]*) TO prima_app/g)) grant(g[2], g[1]);
  shape.tables = [...new Set(shape.tables)];
  return shape;
}

const shapes = new Map<string, ModuleShape>();
/** The shape of one optional module's pinned file; cached, read once. */
export function optionalModuleShape(id: 'pay_formulas' | 'guard_pay', root = releaseRoot()): ModuleShape {
  const spec = OPTIONAL_MODULE_SPECS.find((m) => m.id === id)!;
  const file = resolve(root, spec.path);
  let shape = shapes.get(file);
  if (!shape) {
    shape = moduleShape(readFileSync(file, 'utf8'));
    if (!shape.tables.length) throw Error('Module file has no tables.');
    shapes.set(file, shape);
  }
  return shape;
}

/** Problems for every table and policy of one module file; empty when its catalogue matches the file. */
export async function moduleShapeProblems(client: Client, shape: ModuleShape, file: string): Promise<string[]> {
  const out: string[] = [];
  for (const table of shape.tables) {
    const q = `prima.${table}`;
    const r = await client.query(
      `SELECT c.relkind = 'r' AS is_table, c.relrowsecurity AND c.relforcerowsecurity AS rls,
              has_table_privilege('prima_app', c.oid, 'SELECT') AS can_select, has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
              has_table_privilege('prima_app', c.oid, 'UPDATE') AS can_update,
              has_table_privilege('prima_app', c.oid, 'DELETE') OR has_table_privilege('prima_app', c.oid, 'TRUNCATE') AS too_much
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = $1`,
      [table],
    );
    const x = r.rows[0];
    if (!x || x.is_table !== true) {
      out.push(`${q} is missing: apply ${file} in its own authorized install step.`);
      continue;
    }
    if (x.rls !== true) out.push(`Row-level security is not forced on ${q}.`);
    const want = new Set(shape.grants[table] ?? []);
    if (!x.can_select || !x.can_insert || !want.has('SELECT') || !want.has('INSERT')) out.push(`The app role cannot read and record ${q}.`);
    if (want.has('UPDATE') && !x.can_update) out.push(`The app role cannot change ${q}.`);
    if (!want.has('UPDATE') && x.can_update) out.push(`The app role may change ${q}; it must be add-only.`);
    if (x.too_much) out.push(`The app role may delete from ${q}.`);
  }
  const tables = [...new Set(shape.policies.map(([t]) => t))];
  const have = await client.query(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'prima' AND tablename = ANY($1::text[])`, [tables]);
  const present = new Set(have.rows.map((p) => `${p.tablename}.${p.policyname}`));
  for (const [table, policy] of shape.policies) if (!present.has(`${table}.${policy}`)) out.push(`prima.${table} is missing its ${policy} policy.`);
  return [...new Set(out)];
}

/** What is missing or drifted for the pay formulas module; empty when ready. */
export async function payFormulasProblems(client: Client): Promise<string[]> {
  let shape: ModuleShape;
  try {
    shape = optionalModuleShape('pay_formulas');
  } catch {
    return ['The pay formulas module file db/modules/pay-formulas-v1.sql could not be read.'];
  }
  return moduleShapeProblems(client, shape, 'db/modules/pay-formulas-v1.sql');
}
