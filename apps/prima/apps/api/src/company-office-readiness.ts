// What is missing or drifted in the database for the company office (db/modules/company-office-v1.sql). Names only,
// never data. An empty list means the module is installed exactly as reviewed.
//
// Every definition is compared in full against the attested text below (PostgreSQL's own normalised form, read with
// pg_get_expr / pg_get_constraintdef / pg_get_indexdef), never by substring: a policy that still mentions
// visible_companies() but adds "OR true" is drift, and so is a CHECK that keeps its name but changes its expression.
// The policy must also be bound (pg_depend) to the base function prima.visible_companies(), whose body is pinned too.
import type { Pool } from 'pg';

/** The reviewed definitions (Arisha main review, 3 Nov 2026). `prima.` is stripped before comparing, so the result does
 * not depend on the reader's search_path. */
export const COMPANY_OFFICE_ATTESTED = {
  table: 'prima.company_desks',
  owner: 'not prima_app',
  columns: [
    ['id', 'text', true],
    ['company_id', 'text', true],
    ['data', 'jsonb', true],
  ] as [string, string, boolean][],
  rls: { enabled: true, forced: true },
  policies: {
    company_wall: {
      permissive: true,
      roles: ['public'],
      cmd: '*',
      using: '(company_id = ANY (visible_companies()))',
      check: '(company_id = ANY (visible_companies()))',
    },
  } as Record<string, { permissive: boolean; roles: string[]; cmd: string; using: string; check: string }>,
  constraints: {
    company_desks_pkey: 'PRIMARY KEY (id)',
    company_desks_id_matches: "CHECK (((data ->> 'id'::text) = id))",
    company_desks_company_matches: "CHECK (((data ->> 'companyId'::text) = company_id))",
    company_desks_id_format: "CHECK ((id = ((('desk-'::text || company_id) || '-'::text) || (data ->> 'desk'::text))))",
    company_desks_desk_known:
      "CHECK (((data ->> 'desk'::text) = ANY (ARRAY['people'::text, 'clients'::text, 'tenders'::text, 'licences'::text, 'cases'::text, 'office'::text])))",
  } as Record<string, string>,
  indexes: {
    company_desks_pkey: 'CREATE UNIQUE INDEX company_desks_pkey ON company_desks USING btree (id)',
    company_desks_company_idx: 'CREATE INDEX company_desks_company_idx ON company_desks USING btree (company_id)',
  } as Record<string, string>,
  /** Table privileges by grantee; nobody else (not PUBLIC) holds any. */
  grants: { prima_app: ['INSERT', 'SELECT', 'UPDATE'] } as Record<string, string[]>,
  triggers: [] as string[],
  /** The base function the wall is bound to (db/migrations/001_init.sql, base sha256 4b4cf4d3…ed78fe). */
  visibleCompanies: {
    signature: 'visible_companies()',
    result: 'text[]',
    language: 'sql',
    volatility: 's',
    securityDefiner: false,
    body: "SELECT coalesce(string_to_array(nullif(current_setting('app.company_ids', true), ''), ','), ARRAY[]::text[])",
  },
};

const A = COMPANY_OFFICE_ATTESTED;
const norm = (s: unknown) =>
  String(s ?? '')
    .replace(/\bprima\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function companyOfficeProblems(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const t = await pool.query(
    `SELECT c.oid, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'prima' AND c.relname = 'company_desks' AND c.relkind = 'r'`,
  );
  const tab = t.rows[0];
  if (!tab) return ['Table prima.company_desks is missing (run db/modules/company-office-v1.sql).'];
  const oid = tab.oid;
  if (!tab.rls || !tab.forced) out.push('Row-level security is not forced on prima.company_desks.');
  if (tab.owner === 'prima_app') out.push('prima.company_desks is owned by the app role, so its row security can be bypassed.');

  // Columns: exactly the attested names, types and NOT NULL.
  const cols = await pool.query(
    `SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS notnull
       FROM pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    [oid],
  );
  const colKey = (r: { name: string; type: string; notnull: boolean }) => `${r.name} ${r.type}${r.notnull ? ' not null' : ''}`;
  const haveCols = cols.rows.map(colKey).join(', ');
  const wantCols = A.columns.map(([name, type, notnull]) => colKey({ name, type, notnull })).join(', ');
  if (haveCols !== wantCols) out.push(`Columns of prima.company_desks differ from the reviewed definition.`);

  // Policies: exactly one, the company wall, with the attested mode, roles, command and expressions.
  const pol = await pool.query(
    `SELECT p.oid, p.polname AS name, p.polpermissive AS permissive, p.polcmd AS cmd,
            ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r ORDER BY 1)::text[] AS roles,
            pg_get_expr(p.polqual, p.polrelid) AS using, pg_get_expr(p.polwithcheck, p.polrelid) AS check
       FROM pg_policy p WHERE p.polrelid = $1`,
    [oid],
  );
  for (const [name, want] of Object.entries(A.policies)) {
    const p = pol.rows.find((x) => x.name === name);
    if (!p) {
      out.push(`Policy company_desks.${name} is missing.`);
      continue;
    }
    if (p.permissive !== want.permissive || p.cmd !== want.cmd || (p.roles as string[]).join(',') !== want.roles.join(','))
      out.push(`Policy company_desks.${name} has a different mode, command or roles from the reviewed definition.`);
    if (norm(p.using) !== norm(want.using) || norm(p.check) !== norm(want.check))
      out.push(`Policy company_desks.${name} no longer matches the reviewed company wall exactly.`);
  }
  for (const p of pol.rows.filter((x) => !(x.name in A.policies))) out.push(`Unexpected policy company_desks.${p.name}.`);

  // The wall must be bound to the base function itself, and that function must be the reviewed one.
  const fn = await pool.query(
    `SELECT p.oid, p.oid::regprocedure::text AS signature, pg_get_function_result(p.oid) AS result, l.lanname AS language,
            p.provolatile AS volatility, p.prosecdef AS definer, p.prosrc AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'prima' AND p.proname = 'visible_companies'`,
  );
  const vc = A.visibleCompanies;
  if (fn.rows.length !== 1) out.push('Base function prima.visible_companies() is missing or overloaded.');
  else {
    const f = fn.rows[0];
    if (
      norm(f.signature) !== vc.signature ||
      f.result !== vc.result ||
      f.language !== vc.language ||
      f.volatility !== vc.volatility ||
      f.definer !== vc.securityDefiner ||
      norm(f.body) !== norm(vc.body)
    )
      out.push('Base function prima.visible_companies() differs from the reviewed definition.');
    const wall = pol.rows.find((x) => x.name === 'company_wall');
    if (wall) {
      const dep = await pool.query(
        `SELECT 1 FROM pg_depend WHERE classid = 'pg_policy'::regclass AND objid = $1 AND refclassid = 'pg_proc'::regclass AND refobjid = $2`,
        [wall.oid, f.oid],
      );
      if (!dep.rowCount) out.push('Policy company_desks.company_wall is not bound to prima.visible_companies().');
    }
  }

  // Constraints: exactly the attested set, each with its exact definition.
  const con = await pool.query(`SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1`, [oid]);
  for (const [name, def] of Object.entries(A.constraints)) {
    const c = con.rows.find((x) => x.name === name);
    if (!c) out.push(`Constraint ${name} is missing on prima.company_desks.`);
    else if (norm(c.def) !== norm(def)) out.push(`Constraint ${name} on prima.company_desks differs from the reviewed definition.`);
  }
  for (const c of con.rows.filter((x) => !(x.name in A.constraints))) out.push(`Unexpected constraint ${c.name} on prima.company_desks.`);

  // Indexes.
  const idx = await pool.query(
    `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = $1`,
    [oid],
  );
  for (const [name, def] of Object.entries(A.indexes)) {
    const i = idx.rows.find((x) => x.name === name);
    if (!i) out.push(`Index ${name} is missing on prima.company_desks.`);
    else if (norm(i.def) !== norm(def)) out.push(`Index ${name} on prima.company_desks differs from the reviewed definition.`);
  }
  for (const i of idx.rows.filter((x) => !(x.name in A.indexes))) out.push(`Unexpected index ${i.name} on prima.company_desks.`);

  // Grants: every non-owner privilege, by grantee (PUBLIC included).
  const acl = await pool.query(
    `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, a.privilege_type AS priv
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = $1 AND a.grantee <> c.relowner`,
    [oid],
  );
  const have: Record<string, string[]> = {};
  for (const r of acl.rows) (have[r.grantee] ??= []).push(r.priv);
  const names = new Set([...Object.keys(have), ...Object.keys(A.grants)]);
  for (const g of names) {
    const h = (have[g] ?? []).sort().join(',');
    const w = (A.grants[g] ?? []).slice().sort().join(',');
    if (h === w) continue;
    if ((have[g] ?? []).some((p) => p === 'DELETE' || p === 'TRUNCATE')) out.push(`${g} may delete rows from prima.company_desks.`);
    else if (!A.grants[g]) out.push(`${g} holds privileges on prima.company_desks that were not reviewed.`);
    else out.push(`${g} privileges on prima.company_desks differ from the reviewed SELECT, INSERT, UPDATE.`);
  }
  // The app role should not be able to read through via a column-level grant either.
  const colAcl = await pool.query(`SELECT 1 FROM pg_attribute WHERE attrelid = $1 AND attacl IS NOT NULL LIMIT 1`, [oid]);
  if (colAcl.rowCount) out.push('Column-level privileges exist on prima.company_desks that were not reviewed.');

  // Triggers: none reviewed.
  const trg = await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal`, [oid]);
  for (const r of trg.rows) if (!A.triggers.includes(r.tgname)) out.push(`Unexpected trigger ${r.tgname} on prima.company_desks.`);

  return out;
}

const RUN_LINK_SETTER =
  "(EXISTS ( SELECT 1 FROM prima.users u WHERE ((u.id = current_setting('app.user_id'::text, true)) AND ((((u.data ->> 'role'::text) = 'pwvsb_officer'::text) AND ((u.data ->> 'leadership'::text) = 'cos'::text)) OR (((u.data ->> 'role'::text) = 'director'::text) AND ((u.data ->> 'opsTier'::text) = 'ceo'::text))))))";
const ON_SETTER_WALL = '(id = ANY (prima.visible_companies()))';
const PARENT_ON_SETTER_WALL = "(((data ->> 'runByCompanyId'::text) IS NULL) OR ((data ->> 'runByCompanyId'::text) = ANY (prima.visible_companies())))";

/** The reviewed definitions of db/modules/company-run-links-v1.sql (companies run by another company's office, 3 Nov 2026). */
export const COMPANY_RUN_LINKS_ATTESTED = {
  columns: [
    ['id', 'text', true],
    ['data', 'jsonb', true],
  ] as [string, string, boolean][],
  policies: {
    run_links_read: { permissive: true, roles: ['public'], cmd: 'r', using: 'true', check: '' },
    run_links_setter_insert: {
      permissive: true,
      roles: ['public'],
      cmd: 'a',
      using: '',
      check: `(${RUN_LINK_SETTER} AND ${ON_SETTER_WALL} AND ${PARENT_ON_SETTER_WALL})`,
    },
    run_links_setter_update: {
      permissive: true,
      roles: ['public'],
      cmd: 'w',
      using: `(${RUN_LINK_SETTER} AND ${ON_SETTER_WALL})`,
      check: `(${RUN_LINK_SETTER} AND ${ON_SETTER_WALL} AND ${PARENT_ON_SETTER_WALL})`,
    },
  } as Record<string, { permissive: boolean; roles: string[]; cmd: string; using: string; check: string }>,
  constraints: {
    company_run_links_pkey: 'PRIMARY KEY (id)',
    company_run_links_id_matches: "CHECK ((((data ->> 'id'::text) = id) AND ((data ->> 'companyId'::text) = id)))",
    company_run_links_not_self: "CHECK ((((data ->> 'runByCompanyId'::text) IS NULL) OR ((data ->> 'runByCompanyId'::text) <> id)))",
  } as Record<string, string>,
  indexes: { company_run_links_pkey: 'CREATE UNIQUE INDEX company_run_links_pkey ON company_run_links USING btree (id)' } as Record<string, string>,
  grants: { prima_app: ['INSERT', 'SELECT', 'UPDATE'] } as Record<string, string[]>,
};

/** Names only: what is missing or drifted for db/modules/company-run-links-v1.sql. Empty when installed as reviewed. */
export async function companyRunLinkProblems(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const R = COMPANY_RUN_LINKS_ATTESTED;
  const T = 'prima.company_run_links';
  const out: string[] = [];
  const t = await pool.query(
    `SELECT c.oid, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'prima' AND c.relname = 'company_run_links' AND c.relkind = 'r'`,
  );
  const tab = t.rows[0];
  if (!tab) return [`Table ${T} is missing (run db/modules/company-run-links-v1.sql).`];
  const oid = tab.oid;
  if (!tab.rls || !tab.forced) out.push(`Row-level security is not forced on ${T}.`);
  if (tab.owner === 'prima_app') out.push(`${T} is owned by the app role, so its row security can be bypassed.`);
  const cols = await pool.query(
    `SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS notnull
       FROM pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    [oid],
  );
  const key = (n: string, ty: string, nn: boolean) => `${n} ${ty}${nn ? ' not null' : ''}`;
  if (cols.rows.map((r) => key(r.name, r.type, r.notnull)).join(', ') !== R.columns.map(([n, ty, nn]) => key(n, ty, nn)).join(', '))
    out.push(`Columns of ${T} differ from the reviewed definition.`);
  const pol = await pool.query(
    `SELECT p.polname AS name, p.polpermissive AS permissive, p.polcmd AS cmd,
            ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r ORDER BY 1)::text[] AS roles,
            pg_get_expr(p.polqual, p.polrelid) AS using, pg_get_expr(p.polwithcheck, p.polrelid) AS check
       FROM pg_policy p WHERE p.polrelid = $1`,
    [oid],
  );
  for (const [name, want] of Object.entries(R.policies)) {
    const p = pol.rows.find((x) => x.name === name);
    if (!p) out.push(`Policy company_run_links.${name} is missing.`);
    else if (
      p.permissive !== want.permissive ||
      p.cmd !== want.cmd ||
      (p.roles as string[]).join(',') !== want.roles.join(',') ||
      norm(p.using) !== norm(want.using) ||
      norm(p.check) !== norm(want.check)
    )
      out.push(`Policy company_run_links.${name} differs from the reviewed definition.`);
  }
  for (const p of pol.rows.filter((x) => !(x.name in R.policies))) out.push(`Unexpected policy company_run_links.${p.name}.`);
  const con = await pool.query(`SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1`, [oid]);
  for (const [name, def] of Object.entries(R.constraints)) {
    const c = con.rows.find((x) => x.name === name);
    if (!c) out.push(`Constraint ${name} is missing on ${T}.`);
    else if (norm(c.def) !== norm(def)) out.push(`Constraint ${name} on ${T} differs from the reviewed definition.`);
  }
  for (const c of con.rows.filter((x) => !(x.name in R.constraints))) out.push(`Unexpected constraint ${c.name} on ${T}.`);
  const idx = await pool.query(
    `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = $1`,
    [oid],
  );
  for (const [name, def] of Object.entries(R.indexes)) {
    const i = idx.rows.find((x) => x.name === name);
    if (!i) out.push(`Index ${name} is missing on ${T}.`);
    else if (norm(i.def) !== norm(def)) out.push(`Index ${name} on ${T} differs from the reviewed definition.`);
  }
  for (const i of idx.rows.filter((x) => !(x.name in R.indexes))) out.push(`Unexpected index ${i.name} on ${T}.`);
  const acl = await pool.query(
    `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee, a.privilege_type AS priv
       FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = $1 AND a.grantee <> c.relowner`,
    [oid],
  );
  const have: Record<string, string[]> = {};
  for (const r of acl.rows) (have[r.grantee] ??= []).push(r.priv);
  for (const g of new Set([...Object.keys(have), ...Object.keys(R.grants)])) {
    if ((have[g] ?? []).sort().join(',') === (R.grants[g] ?? []).slice().sort().join(',')) continue;
    if ((have[g] ?? []).some((p) => p === 'DELETE' || p === 'TRUNCATE')) out.push(`${g} may delete rows from ${T}.`);
    else out.push(`${g} privileges on ${T} differ from the reviewed SELECT, INSERT, UPDATE.`);
  }
  if ((await pool.query(`SELECT 1 FROM pg_attribute WHERE attrelid = $1 AND attacl IS NOT NULL LIMIT 1`, [oid])).rowCount)
    out.push(`Column-level privileges exist on ${T} that were not reviewed.`);
  for (const r of (await pool.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal`, [oid])).rows)
    out.push(`Unexpected trigger ${r.tgname} on ${T}.`);
  return out;
}
