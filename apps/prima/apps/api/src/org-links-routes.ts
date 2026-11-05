// The hand-over catalogue (ORG_FLOWS in packages/core/src/org-links.ts) as database checks.
// db/modules/org-links-v1.sql carries this text between the GENERATED markers; a test fails when the two differ,
// so the database can never accept a desk, a task line or a starting action the catalogue does not have.
import { GROUP_EMPLOYER_ID, IT_COMPANY_ID, NEVER_ROUTED, ORG_FLOWS } from '@prima/core';

export const ROUTES_BEGIN = '-- BEGIN GENERATED org routes (apps/api/src/org-links-routes.ts from ORG_FLOWS; do not edit by hand)';
export const ROUTES_END = '-- END GENERATED org routes';

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function rows(values: string[][]): string {
  return values.map((v) => `    (${v.map(q).join(', ')})`).join(',\n');
}

/** The SQL block, exactly as it must appear in the module file. */
export function orgRoutesSql(): string {
  const starts: string[][] = [];
  const targets: string[][] = [];
  const keyer: string[][] = [];
  for (const f of ORG_FLOWS) {
    for (const a of f.actions) starts.push([f.id, a]);
    for (const t of f.targets) targets.push([f.id, t.desk, t.kind, t.task]);
    for (const t of f.targets) if (t.toKeyer) keyer.push([f.id, t.desk]);
  }
  return [
    ROUTES_BEGIN,
    '-- An event may name a flow only when its audit action starts that flow (exact, or a prefix ending in "."),',
    '-- and never for a confidential action.',
    'CREATE OR REPLACE FUNCTION prima.org_flow_starts(flow text, act text) RETURNS boolean',
    'LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$',
    '  SELECT NOT EXISTS (',
    '    SELECT 1 FROM (VALUES',
    rows(NEVER_ROUTED.map((p) => [p])),
    "    ) n(p) WHERE p = act OR (right(p, 1) IN ('.', '_') AND starts_with(act, p)))",
    '  AND EXISTS (',
    '    SELECT 1 FROM (VALUES',
    rows(starts),
    "    ) s(f, a) WHERE f = flow AND (a = act OR (right(a, 1) = '.' AND starts_with(act, a))))",
    '$$;',
    '-- A hand-over may go only to a desk its flow names, with that line\'s kind and words.',
    'CREATE OR REPLACE FUNCTION prima.org_flow_target_ok(flow text, desk text, kind text, task text) RETURNS boolean',
    'LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$',
    '  SELECT EXISTS (',
    '    SELECT 1 FROM (VALUES',
    rows(targets),
    '    ) t(f, d, k, x) WHERE f = flow AND d = desk AND k = kind AND x = task)',
    '$$;',
    "-- A line that is the keyer's own next step (toKeyer) also goes to the person who keyed the record.",
    'CREATE OR REPLACE FUNCTION prima.org_flow_to_keyer(flow text, desk text) RETURNS boolean',
    'LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$',
    '  SELECT EXISTS (',
    '    SELECT 1 FROM (VALUES',
    rows(keyer),
    '    ) k(f, d) WHERE f = flow AND d = desk)',
    '$$;',
    '-- A central employer has no company office: a company-office line is never written for one (isCentralEmployer).',
    'CREATE OR REPLACE FUNCTION prima.org_central_employer(company text) RETURNS boolean',
    'LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$',
    `  SELECT company IN (${[GROUP_EMPLOYER_ID, IT_COMPANY_ID].map(q).join(', ')})`,
    '$$;',
    ROUTES_END,
  ].join('\n');
}

/** The block as found in the module text, or null. */
export function routesBlockOf(sql: string): string | null {
  const a = sql.indexOf(ROUTES_BEGIN);
  const b = sql.indexOf(ROUTES_END);
  return a < 0 || b < a ? null : sql.slice(a, b + ROUTES_END.length);
}
