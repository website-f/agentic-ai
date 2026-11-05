import type { PoolClient } from 'pg';

/** Tables the Special Ops add-on (db/modules/special-ops-v1.sql) walls off. */
export const SPECIAL_OPS_ARMS_TABLES = ['vaults', 'firearms', 'arms_movements', 'armed_jobs', 'dealer_licences', 'vault_watches', 'vault_events', 'ammo_stocks', 'arms_agreements', 'arms_requests'];
export const SPECIAL_OPS_DEPT_TABLES: Record<string, 'arms' | 'cms'> = { arms_suppliers: 'arms', supplier_items: 'arms', cms_staff: 'cms', cms_shifts: 'cms' };

const norm = (x: unknown) => String(x ?? '').replace(/::text(\[\])?/g, '').replace(/[\s()]/g, '');

/** The only policies allowed on the walled tables after install: the base company wall plus the add-on walls. */
const COMPANY_WALL = 'company_id = ANY (prima.visible_companies())';

/**
 * The helper functions every wall on these tables relies on (inherited from the base schema). Each must keep exactly this
 * body, stay a STABLE SQL function with no function-level settings (proconfig empty), run as the caller (never SECURITY
 * DEFINER) and be owned by a role prima_app cannot act as.
 */
export const SPECIAL_OPS_BOUNDARY_FUNCTIONS: Record<string, string> = {
  has_wall: "SELECT w = ANY (coalesce(string_to_array(nullif(current_setting('app.walls', true), ''), ','), ARRAY[]::text[]))",
  visible_companies: "SELECT coalesce(string_to_array(nullif(current_setting('app.company_ids', true), ''), ','), ARRAY[]::text[])",
};

/**
 * Read-only catalogue check that the Special Ops add-on is installed exactly as proposed (db/proposed/special-ops-modules.json).
 * Catalogue only: it installs nothing and reads no work data. An empty list means the module's boundary is in place.
 */
export async function specialOpsModuleProblems(client: Pick<PoolClient, 'query'>): Promise<string[]> {
  try {
    const out: string[] = [];
    const all = [...SPECIAL_OPS_ARMS_TABLES, ...Object.keys(SPECIAL_OPS_DEPT_TABLES)];
    const role = await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'prima_app'`);
    if (role.rows.length !== 1) return ['SPECIAL_OPS_ROLE_BOUNDARY'];
    if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) out.push('SPECIAL_OPS_ROLE_BOUNDARY');
    // Inherited too: prima_app must not be a member (directly or through other roles) of a superuser or RLS-bypassing role.
    const inherited = await client.query(
      `SELECT r.rolname FROM pg_roles r WHERE r.rolname <> 'prima_app' AND pg_has_role('prima_app', r.oid, 'MEMBER') AND (r.rolsuper OR r.rolbypassrls)`,
    );
    for (const r of inherited.rows) out.push(`SPECIAL_OPS_ROLE_INHERITS:${r.rolname}`);
    const schema = await client.query(`SELECT has_schema_privilege('prima_app', 'prima', 'CREATE') c`);
    if (schema.rows[0]?.c) out.push('SPECIAL_OPS_SCHEMA_CREATE_GRANTED');
    const rel = await client.query(
      `SELECT c.relname, c.relrowsecurity rls, c.relforcerowsecurity forced, pg_has_role('prima_app', c.relowner, 'MEMBER') app_owns,
              has_table_privilege('prima_app', c.oid, 'INSERT') ins, has_table_privilege('prima_app', c.oid, 'UPDATE') upd,
              has_table_privilege('prima_app', c.oid, 'DELETE') del, has_table_privilege('prima_app', c.oid, 'TRUNCATE') trunc
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = ANY($1)`,
      [all],
    );
    if (rel.rows.length !== all.length) return ['SPECIAL_OPS_TABLES_MISSING'];
    if (rel.rows.some((r) => !r.rls || !r.forced)) out.push('SPECIAL_OPS_RLS_NOT_FORCED');
    // An owner (or a member of the owner role) can switch row security off: prima_app must never be either.
    for (const r of rel.rows) if (r.app_owns) out.push(`SPECIAL_OPS_TABLE_OWNER:${r.relname}`);
    if (rel.rows.some((r) => r.del || r.trunc)) out.push('SPECIAL_OPS_DELETE_GRANTED');
    if (['arms_suppliers', 'supplier_items', 'cms_staff'].some((t) => !rel.rows.some((r) => r.relname === t && r.ins && r.upd))) out.push('SPECIAL_OPS_WRITE_GRANT_MISSING');
    const pol = await client.query(
      `SELECT c.relname, p.polname, p.polpermissive, p.polcmd, p.polroles, pg_get_expr(p.polqual, p.polrelid) qual, pg_get_expr(p.polwithcheck, p.polrelid) chk
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'prima' AND c.relname = ANY($1)`,
      [all],
    );
    const ok = (r: { polcmd: string; polroles: unknown; qual: string; chk: string }, wall: string) =>
      r.polcmd === '*' && JSON.stringify(r.polroles) === JSON.stringify([0]) && norm(r.qual) === norm(`prima.has_wall('${wall}')`) && norm(r.chk) === norm(`prima.has_wall('${wall}')`);
    for (const t of SPECIAL_OPS_ARMS_TABLES) {
      const rows = pol.rows.filter((r) => r.relname === t && r.polname === 'arms_wall');
      if (rows.length !== 1 || rows[0].polpermissive || !ok(rows[0], 'arms')) out.push(`SPECIAL_OPS_ARMS_WALL:${t}`);
    }
    for (const [t, wall] of Object.entries(SPECIAL_OPS_DEPT_TABLES)) {
      const rows = pol.rows.filter((r) => r.relname === t && r.polname === 'dept_wall');
      if (rows.length !== 1 || !rows[0].polpermissive || !ok(rows[0], wall)) out.push(`SPECIAL_OPS_DEPT_WALL:${t}`);
    }
    // The inherited company wall on the arms tables must still be the base one: permissive, for everyone, every command.
    for (const t of SPECIAL_OPS_ARMS_TABLES) {
      const rows = pol.rows.filter((r) => r.relname === t && r.polname === 'company_wall');
      const r = rows[0];
      if (rows.length !== 1 || !r.polpermissive || r.polcmd !== '*' || JSON.stringify(r.polroles) !== JSON.stringify([0]) || norm(r.qual) !== norm(COMPANY_WALL) || norm(r.chk) !== norm(COMPANY_WALL))
        out.push(`SPECIAL_OPS_COMPANY_WALL:${t}`);
    }
    // Any other policy is unexpected. A permissive one widens access (permissive policies are ORed together); a
    // restrictive one changes behaviour nobody reviewed. Both are reported.
    const allowed = (t: string) => (SPECIAL_OPS_ARMS_TABLES.includes(t) ? ['arms_wall', 'company_wall'] : ['dept_wall']);
    for (const r of pol.rows) if (!allowed(r.relname).includes(r.polname)) out.push(`SPECIAL_OPS_UNEXPECTED_POLICY:${r.relname}.${r.polname}${r.polpermissive ? ' (permissive)' : ''}`);
    // The functions the walls call: same body, runs as the caller, not owned by a role prima_app can act as.
    const fns = await client.query(
      `SELECT p.proname, p.prosrc, p.prosecdef, p.proconfig, p.provolatile, l.lanname, pg_has_role('prima_app', p.proowner, 'MEMBER') app_owns
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'prima' AND p.proname = ANY($1)`,
      [Object.keys(SPECIAL_OPS_BOUNDARY_FUNCTIONS)],
    );
    for (const [name, body] of Object.entries(SPECIAL_OPS_BOUNDARY_FUNCTIONS)) {
      const rows = fns.rows.filter((r) => r.proname === name);
      if (rows.length !== 1) {
        out.push(`SPECIAL_OPS_FUNCTION:${name}`);
        continue;
      }
      const f = rows[0];
      if (norm(f.prosrc) !== norm(body)) out.push(`SPECIAL_OPS_FUNCTION_CHANGED:${name}`);
      if (f.prosecdef) out.push(`SPECIAL_OPS_FUNCTION_DEFINER:${name}`);
      if (f.app_owns) out.push(`SPECIAL_OPS_FUNCTION_OWNER:${name}`);
      // Approved configuration: none. A function-level SET (for example app.walls or search_path) runs in place of the
      // caller's setting, so a has_wall with its own app.walls would pass every wall while the body still matches.
      if (f.proconfig !== null && !(Array.isArray(f.proconfig) && f.proconfig.length === 0)) out.push(`SPECIAL_OPS_FUNCTION_CONFIG:${name}`);
      if (f.lanname !== 'sql' || f.provolatile !== 's') out.push(`SPECIAL_OPS_FUNCTION_KIND:${name}`);
    }
    return out;
  } catch {
    return ['SPECIAL_OPS_SCHEMA_UNAVAILABLE'];
  }
}
