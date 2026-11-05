import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

/**
 * Catalogue assertions for the two Central Admin modules (Arisha main review, 2 Nov 2026). Read-only: they report what
 * a database has; they install, grant or change nothing. The release gate (apps/api/src/release-catalog.ts) runs them as
 * the restricted runtime role for modules central_admin_walls and central_admin_panel (review round 2). Codes only, never
 * raw catalogue text.
 */
export const CENTRAL_ADMIN_WALLS: readonly (readonly [table: string, wall: string])[] = [
  ['corp_profiles', 'corporate'],
  ['corp_filings', 'corporate'],
  ['corp_changes', 'corporate'],
  ['corp_audits', 'corporate'],
  ['legal_matters', 'legal'],
  ['gov_mandates', 'mandates'],
];

type Q = Pick<PoolClient, 'query'>;
const squash = (v: unknown) => String(v ?? '').replace(/\s+/g, '');

async function rls(client: Q, table: string) {
  const r = await client.query(
    `SELECT c.relrowsecurity AS on, c.relforcerowsecurity AS force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'prima' AND c.relname = $1 AND c.relkind = 'r'`,
    [table],
  );
  return r.rows[0] as { on: boolean; force: boolean } | undefined;
}

async function policy(client: Q, table: string, name: string) {
  const r = await client.query(`SELECT permissive, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'prima' AND tablename = $1 AND policyname = $2`, [
    table,
    name,
  ]);
  return r.rows as { permissive: string; cmd: string; qual: string | null; with_check: string | null }[];
}

/** central_admin_walls: a RESTRICTIVE wall policy on each of the six tables, for every command, on forced RLS. */
export async function centralAdminWallsProblems(client: Q): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const [table, wall] of CENTRAL_ADMIN_WALLS) {
      const t = await rls(client, table);
      if (!t) {
        out.push(`WALLS_TABLE_MISSING:${table}`);
        continue;
      }
      if (!t.on || !t.force) out.push(`WALLS_RLS_NOT_FORCED:${table}`);
      const p = await policy(client, table, 'central_admin_wall');
      const want = `prima.has_wall('${wall}'::text)`;
      if (p.length !== 1) out.push(`WALLS_POLICY_MISSING:${table}`);
      else if (
        p[0].permissive !== 'RESTRICTIVE' ||
        p[0].cmd !== 'ALL' ||
        squash(p[0].qual) !== squash(`${want}`) ||
        squash(p[0].with_check) !== squash(`${want}`)
      )
        out.push(`WALLS_POLICY_DRIFT:${table}`);
    }
  } catch {
    return ['WALLS_CATALOG_UNREADABLE'];
  }
  return out;
}

/** central_admin_panel: prima.panel_firms with forced RLS, the corporate-or-legal wall, and no DELETE for the app. */
export async function centralAdminPanelProblems(client: Q): Promise<string[]> {
  const out: string[] = [];
  try {
    const t = await rls(client, 'panel_firms');
    if (!t) return ['PANEL_TABLE_MISSING'];
    if (!t.on || !t.force) out.push('PANEL_RLS_NOT_FORCED');
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'prima' AND table_name = 'panel_firms' ORDER BY column_name`,
    );
    if (
      JSON.stringify(cols.rows) !==
      JSON.stringify([
        { column_name: 'data', data_type: 'jsonb', is_nullable: 'NO' },
        { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      ])
    )
      out.push('PANEL_SHAPE_DRIFT');
    const priv = await client.query(
      `SELECT p, has_table_privilege('prima_app', 'prima.panel_firms', p) AS ok FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
    );
    const has = Object.fromEntries(priv.rows.map((r: { p: string; ok: boolean }) => [r.p, r.ok]));
    if (!has.SELECT || !has.INSERT || !has.UPDATE) out.push('PANEL_APP_GRANT_MISSING');
    if (has.DELETE || has.TRUNCATE) out.push('PANEL_APP_CAN_DELETE');
    // Read the ACL directly: information_schema hides PUBLIC grants from the restricted runtime role the release gate uses.
    const pub = await client.query(
      `SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'prima.panel_firms'::regclass AND a.grantee = 0`,
    );
    if (pub.rows[0].n) out.push('PANEL_PUBLIC_GRANT');
    const p = await policy(client, 'panel_firms', 'panel_firms_wall');
    const want = `(prima.has_wall('corporate'::text) OR prima.has_wall('legal'::text))`;
    if (p.length !== 1) out.push('PANEL_POLICY_MISSING');
    else if (p[0].permissive !== 'PERMISSIVE' || p[0].cmd !== 'ALL' || squash(p[0].qual) !== squash(want) || squash(p[0].with_check) !== squash(want))
      out.push('PANEL_POLICY_DRIFT');
    const others = await client.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'panel_firms' AND policyname <> 'panel_firms_wall'`,
    );
    if (others.rows[0].n) out.push('PANEL_EXTRA_POLICY');
  } catch {
    return ['PANEL_CATALOG_UNREADABLE'];
  }
  return out;
}

/**
 * central_admin_delegations (masterplan §243): prima.delegations and prima.critical_roles, each with forced RLS, the
 * company wall and its RESTRICTIVE wall (mandates-or-delegate for delegations, mandates only for critical roles), the
 * app may read, add and change but never delete, and no PUBLIC grant.
 */
export async function centralAdminDelegationsProblems(client: Q): Promise<string[]> {
  try {
    return [
      ...(await registerTableProblems(client, 'delegations', 'DELEGATIONS', 'delegations_wall', `(prima.has_wall('mandates'::text) OR ((data ->> 'delegateId'::text) = current_setting('app.user_id'::text, true)))`)),
      ...(await registerTableProblems(client, 'critical_roles', 'CRITICAL_ROLES', 'critical_roles_wall', `prima.has_wall('mandates'::text)`)),
    ];
  } catch {
    return ['DELEGATIONS_CATALOG_UNREADABLE'];
  }
}

async function registerTableProblems(client: Q, table: string, code: string, wallName: string, wantUsing: string): Promise<string[]> {
  const out: string[] = [];
  const t = await rls(client, table);
  if (!t) return [`${code}_TABLE_MISSING`];
  if (!t.on || !t.force) out.push(`${code}_RLS_NOT_FORCED`);
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'prima' AND table_name = $1 ORDER BY column_name`,
    [table],
  );
  if (
    JSON.stringify(cols.rows) !==
    JSON.stringify([
      { column_name: 'company_id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'data', data_type: 'jsonb', is_nullable: 'NO' },
      { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
    ])
  )
    out.push(`${code}_SHAPE_DRIFT`);
  const priv = await client.query(
    `SELECT p, has_table_privilege('prima_app', $1, p) AS ok FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
    [`prima.${table}`],
  );
  const has = Object.fromEntries(priv.rows.map((r: { p: string; ok: boolean }) => [r.p, r.ok]));
  if (!has.SELECT || !has.INSERT || !has.UPDATE) out.push(`${code}_APP_GRANT_MISSING`);
  if (has.DELETE || has.TRUNCATE) out.push(`${code}_APP_CAN_DELETE`);
  const pub = await client.query(
    `SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = $1::regclass AND a.grantee = 0`,
    [`prima.${table}`],
  );
  if (pub.rows[0].n) out.push(`${code}_PUBLIC_GRANT`);
  const company = await policy(client, table, 'company_wall');
  const wantCompany = `(company_id = ANY (prima.visible_companies()))`;
  if (company.length !== 1) out.push(`${code}_COMPANY_WALL_MISSING`);
  else if (
    company[0].permissive !== 'PERMISSIVE' ||
    company[0].cmd !== 'ALL' ||
    squash(company[0].qual) !== squash(wantCompany) ||
    squash(company[0].with_check) !== squash(wantCompany)
  )
    out.push(`${code}_COMPANY_WALL_DRIFT`);
  const wall = await policy(client, table, wallName);
  const wantCheck = `prima.has_wall('mandates'::text)`;
  if (wall.length !== 1) out.push(`${code}_WALL_MISSING`);
  else if (wall[0].permissive !== 'RESTRICTIVE' || wall[0].cmd !== 'ALL' || squash(wall[0].qual) !== squash(wantUsing) || squash(wall[0].with_check) !== squash(wantCheck))
    out.push(`${code}_WALL_DRIFT`);
  const others = await client.query(
    `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'prima' AND tablename = $1 AND policyname NOT IN ('company_wall', $2)`,
    [table, wallName],
  );
  if (others.rows[0].n) out.push(`${code}_EXTRA_POLICY`);
  return out;
}

/**
 * central_admin_legal_holds (masterplan §125): prima.legal_holds (company wall, legal wall to add and change) and
 * prima.legal_hold_versions (company wall, legal wall to read, append only), forced RLS, no PUBLIC grant, and the
 * lh_preserve trigger on every holdable table, running as the caller (not SECURITY DEFINER).
 */
export async function centralAdminLegalHoldsProblems(client: Q): Promise<string[]> {
  const out: string[] = [];
  try {
    const want = {
      legal_holds: { privs: ['SELECT', 'INSERT', 'UPDATE'], policies: { legal_holds_add: ['INSERT', null, `prima.has_wall('legal'::text)`], legal_holds_change: ['UPDATE', `prima.has_wall('legal'::text)`, `prima.has_wall('legal'::text)`] } },
      legal_hold_versions: { privs: ['SELECT', 'INSERT'], policies: { legal_hold_versions_read: ['SELECT', `prima.has_wall('legal'::text)`, null] } },
    } as const;
    for (const [table, w] of Object.entries(want)) {
      const code = table.toUpperCase();
      const t = await rls(client, table);
      if (!t) {
        out.push(`${code}_TABLE_MISSING`);
        continue;
      }
      if (!t.on || !t.force) out.push(`${code}_RLS_NOT_FORCED`);
      const priv = await client.query(
        `SELECT p, has_table_privilege('prima_app', $1, p) AS ok FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
        [`prima.${table}`],
      );
      const has = Object.fromEntries(priv.rows.map((r: { p: string; ok: boolean }) => [r.p, r.ok]));
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) if (!!has[p] !== (w.privs as readonly string[]).includes(p)) out.push(`${code}_APP_GRANT_DRIFT`);
      const pub = await client.query(
        `SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a WHERE c.oid = $1::regclass AND a.grantee = 0`,
        [`prima.${table}`],
      );
      if (pub.rows[0].n) out.push(`${code}_PUBLIC_GRANT`);
      const company = await policy(client, table, 'company_wall');
      const wantCompany = `(company_id = ANY (prima.visible_companies()))`;
      if (company.length !== 1 || company[0].permissive !== 'PERMISSIVE' || company[0].cmd !== 'ALL' || squash(company[0].qual) !== squash(wantCompany) || squash(company[0].with_check) !== squash(wantCompany))
        out.push(`${code}_COMPANY_WALL_DRIFT`);
      for (const [name, [cmd, qual, check]] of Object.entries(w.policies)) {
        const p = await policy(client, table, name);
        if (p.length !== 1 || p[0].permissive !== 'RESTRICTIVE' || p[0].cmd !== cmd || squash(p[0].qual) !== squash(qual) || squash(p[0].with_check) !== squash(check)) out.push(`${code}_WALL_DRIFT`);
      }
      const others = await client.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'prima' AND tablename = $1 AND policyname <> 'company_wall' AND NOT (policyname = ANY ($2::text[]))`,
        [table, Object.keys(w.policies)],
      );
      if (others.rows[0].n) out.push(`${code}_EXTRA_POLICY`);
    }
    // Review round 5b: the function body and settings are compared with the reviewed module text, not only its name.
    const fn = await client.query(
      `SELECT p.prosecdef AS definer, p.prosrc AS src, l.lanname AS lang, p.proconfig AS config, p.pronargs AS nargs, format_type(p.prorettype, NULL) AS returns
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'prima' AND p.proname = 'lh_preserve'`,
    );
    if (fn.rows.length !== 1) out.push('LEGAL_HOLD_TRIGGER_FUNCTION_MISSING');
    else {
      const f = fn.rows[0];
      if (f.definer) out.push('LEGAL_HOLD_TRIGGER_DEFINER');
      if (
        legalHoldFunctionBodySha(String(f.src ?? '')) !== LEGAL_HOLD_FUNCTION_BODY_SHA ||
        f.lang !== 'plpgsql' ||
        f.nargs !== 0 ||
        f.returns !== 'trigger' ||
        JSON.stringify(f.config ?? []) !== JSON.stringify(['search_path=pg_catalog, prima'])
      )
        out.push('LEGAL_HOLD_TRIGGER_FUNCTION_CHANGED');
    }
    // Each trigger must be BEFORE, FOR EACH ROW, on UPDATE and DELETE only, unconditional and enabled.
    const trg = await client.query(
      `SELECT c.relname AS tbl, t.tgtype::int AS type, t.tgqual IS NULL AS unconditional, t.tgenabled::text AS enabled, p.proname AS fn, pn.nspname AS fn_schema
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'prima' AND t.tgname = 'lh_preserve' ORDER BY 1`,
    );
    const tables = ['cases', 'contracts', 'corp_profiles', 'evidence_docs', 'evidence_photos', 'insurance_claims', 'people'];
    type Trg = { tbl: string; type: number; unconditional: boolean; enabled: string; fn: string; fn_schema: string };
    const rows = trg.rows as Trg[];
    if (JSON.stringify(rows.map((r) => r.tbl)) !== JSON.stringify(tables)) out.push('LEGAL_HOLD_TRIGGERS_MISSING');
    if (rows.some((r) => r.type !== LEGAL_HOLD_TRIGGER_TYPE || !r.unconditional || r.enabled !== 'O' || r.fn !== 'lh_preserve' || r.fn_schema !== 'prima'))
      out.push('LEGAL_HOLD_TRIGGER_EVENTS');
  } catch {
    return ['LEGAL_HOLDS_CATALOG_UNREADABLE'];
  }
  return out;
}

/** pg_trigger.tgtype for BEFORE (2) + FOR EACH ROW (1) + DELETE (8) + UPDATE (16); no INSERT (4) or TRUNCATE (32). */
export const LEGAL_HOLD_TRIGGER_TYPE = 27;

/**
 * sha256 of the reviewed prima.lh_preserve() body in db/modules/central-admin-legal-holds-v1.sql, whitespace collapsed.
 * The packaging test recomputes it from the module file, so the two cannot drift silently.
 */
export const LEGAL_HOLD_FUNCTION_BODY_SHA = 'bce106ace2b9d6dd16dbcdce40cfacbaf45e96814205402d0608da8d3d8fdfb6';

export function legalHoldFunctionBodySha(src: string): string {
  return createHash('sha256').update(src.replace(/\s+/g, ' ').trim()).digest('hex');
}
