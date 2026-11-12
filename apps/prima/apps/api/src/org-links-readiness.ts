// What is missing in the database for the hand-over layer (db/modules/org-links-v1.sql). Names only, never data.
import type { Pool } from 'pg';
import { ORG_LINKS_CATALOG } from './org-links-catalog';
import { ORG_CENTRAL_EMPLOYER_E5 } from './central-employers-readiness';

const TABLES = ['org_events', 'org_tasks', 'org_notices', 'org_imports'];
const ENTRY_CHECKS = ['org_event_matches_audit', 'org_task_matches_event', 'org_notice_matches_task', 'org_finance_team', 'org_run_by'];
const INNER_CHECKS = ['org_is_this_transactions_audit', 'org_desk_people', 'org_joining_state', 'org_finance_people'];
// Catalogue checks (plain functions over a fixed list, no table reads): present, and not callable by the app role.
const ROUTE_CHECKS = ['org_flow_starts', 'org_flow_target_ok', 'org_central_employer', 'org_flow_to_keyer'];
export const ORG_LINKS_POLICIES = [
  'org_events.org_events_read',
  'org_events.org_events_add',
  'org_events.org_events_owner_read',
  'org_tasks.org_tasks_read',
  'org_tasks.org_tasks_add',
  'org_tasks.org_tasks_close',
  'org_tasks.org_tasks_owner_read',
  'org_notices.org_notices_read',
  'org_notices.org_notices_add',
  'org_notices.org_notices_mark',
  'org_imports.org_imports_read',
  'org_imports.org_imports_add',
];
const POLICIES = ORG_LINKS_POLICIES;

export async function orgLinksProblems(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const r = await pool.query(
    `SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            has_table_privilege('prima_app', c.oid, 'INSERT') AS can_insert,
            has_table_privilege('prima_app', c.oid, 'DELETE') AS can_delete
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'prima' AND c.relname = ANY($1)`,
    [TABLES],
  );
  for (const t of TABLES) {
    const row = r.rows.find((x) => x.name === t);
    if (!row) out.push(`Table prima.${t} is missing (run db/modules/org-links-v1.sql).`);
    else {
      if (!row.rls || !row.forced) out.push(`Row-level security is off on prima.${t}.`);
      if (!row.can_insert) out.push(`The app role cannot add rows to prima.${t}.`);
      if (row.can_delete) out.push(`The app role may delete rows from prima.${t}.`);
    }
  }
  // Only a trigger that fires in normal sessions counts ('O' origin or 'A' always); a disabled or replica-only one does not.
  const g = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgname IN ('org_task_guard', 'org_notice_guard') AND NOT tgisinternal AND tgenabled IN ('O', 'A')`,
  );
  for (const t of ['org_task_guard', 'org_notice_guard'])
    if (!g.rows.some((x) => x.tgname === t)) out.push(t === 'org_task_guard' ? 'The hand-over guard trigger is missing.' : 'The notice guard trigger is missing.');
  // The provenance checks: present, definer, and only the three entry checks callable by the app role.
  const f = await pool.query(
    `SELECT p.proname AS name, p.prosecdef AS definer, has_function_privilege('prima_app', p.oid, 'EXECUTE') AS app
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'prima' AND p.proname = ANY($1)`,
    [[...ENTRY_CHECKS, ...INNER_CHECKS, ...ROUTE_CHECKS]],
  );
  for (const name of ROUTE_CHECKS) {
    const row = f.rows.find((x) => x.name === name);
    if (!row) out.push(`Catalogue check prima.${name} is missing.`);
    else if (row.app) out.push(`The app role may run prima.${name} directly.`);
  }
  for (const name of [...ENTRY_CHECKS, ...INNER_CHECKS]) {
    const row = f.rows.find((x) => x.name === name);
    if (!row) out.push(`Provenance check prima.${name} is missing.`);
    else {
      if (!row.definer) out.push(`Provenance check prima.${name} does not run as the owner.`);
      if (ENTRY_CHECKS.includes(name) && !row.app) out.push(`The app role cannot run prima.${name}.`);
      if (INNER_CHECKS.includes(name) && row.app) out.push(`The app role may run prima.${name} directly.`);
    }
  }
  // Every policy the module defines, by name; a missing or extra policy is drift.
  const pol = await pool.query(
    `SELECT tablename || '.' || policyname AS name FROM pg_policies WHERE schemaname = 'prima' AND tablename = ANY($1)`,
    [TABLES],
  );
  const have = new Set(pol.rows.map((x) => x.name as string));
  for (const want of POLICIES) if (!have.has(want)) out.push(`Policy ${want} is missing.`);
  for (const extra of [...have].filter((x) => !POLICIES.includes(x))) out.push(`Unexpected policy ${extra}.`);
  // Not names only: every policy's command, mode, roles and wording, every trigger's table, function, timing and
  // firing mode, and every function's body, settings and owner-run flag must equal the reviewed install.
  const live = await orgLinksCatalog(pool);
  for (const kind of ['policies', 'triggers', 'functions'] as const) {
    const want = new Map(ORG_LINKS_CATALOG[kind].map((x) => [x.split('|')[0], x]));
    const got = new Map(live[kind].map((x) => [x.split('|')[0], x]));
    for (const [k, x] of got) {
      if (!want.has(k)) out.push(`Unexpected ${CATALOG_LABEL[kind].toLowerCase()} ${k}.`);
      // E5 (db/modules/central-employers-v1.sql) re-states the central-employer rule with every central employer.
      else if (want.get(k) !== x && !(kind === 'functions' && x === ORG_CENTRAL_EMPLOYER_E5)) out.push(`${CATALOG_LABEL[kind]} ${k} differs from the reviewed module.`);
    }
    for (const k of want.keys()) if (!got.has(k)) out.push(`${CATALOG_LABEL[kind]} ${k} is missing.`);
  }
  return [...new Set(out)];
}

const CATALOG_LABEL = { policies: 'Policy', triggers: 'Trigger', functions: 'Function' } as const;

/**
 * The module's own catalogue entries as one line each, keyed by name: what the database will actually enforce, not
 * what the objects are called. Compared with ORG_LINKS_CATALOG (src/org-links-catalog.ts, from a clean install).
 */
export async function orgLinksCatalog(pool: Pick<Pool, 'query'>): Promise<{ policies: string[]; triggers: string[]; functions: string[] }> {
  const p = await pool.query(
    // The schema owner's name differs per database; it is shown as <owner>.
    `SELECT p.tablename || '.' || p.policyname || '|' || p.cmd || '|' || p.permissive || '|' ||
            array_to_string(ARRAY(SELECT CASE WHEN r = t.tableowner THEN '<owner>' ELSE r::text END FROM unnest(p.roles) r ORDER BY 1), ',') || '|' ||
            coalesce(p.qual, '') || '|' || coalesce(p.with_check, '') AS x
       FROM pg_policies p JOIN pg_tables t ON t.schemaname = p.schemaname AND t.tablename = p.tablename
      WHERE p.schemaname = 'prima' AND p.tablename = ANY($1) ORDER BY 1`,
    [TABLES],
  );
  const t = await pool.query(
    `SELECT c.relname || '.' || g.tgname || '|' || g.tgfoid::regproc::text || '|' || g.tgtype::text || '|' || g.tgenabled::text AS x
       FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'prima' AND NOT g.tgisinternal AND (g.tgname LIKE 'org\\_%' OR c.relname = ANY($1)) ORDER BY 1`,
    [TABLES],
  );
  const f = await pool.query(
    `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef::text || '|' || p.provolatile::text || '|' ||
            coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc) AS x
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'prima' AND p.proname LIKE 'org\\_%' ORDER BY 1`,
  );
  return { policies: p.rows.map((r) => r.x), triggers: t.rows.map((r) => r.x), functions: f.rows.map((r) => r.x) };
}
