// E5 (Fauzan, 11 Nov 2026): what the database must hold for db/modules/central-employers-v1.sql. Names and function
// bodies only, never data. The module re-states the hand-over layer's central-employer rule (org-links-v1.sql), so the
// org_links catalogue accepts either that rule's first body or the E5 body (ORG_CENTRAL_EMPLOYER_E5).
import type { Pool } from 'pg';

/** Every central employer: PWVSB, Merdeka Network, Goodwill Empire, Sasa Team and Perfect Global Logistics. */
export const CENTRAL_EMPLOYERS_E5 = ['pwvsb', 'merdeka', 'goodwill', 'sasateam', 'pgl'] as const;
/** The org_links catalogue line of prima.org_central_employer once the E5 module is installed (see org-links-readiness). */
export const ORG_CENTRAL_EMPLOYER_E5 = 'org_central_employer(company text)|false|i|search_path=pg_catalog|3093fd9a87c685f5331b6137a0a8f123';

const BODIES: Record<string, string> = {
  ce_central_employers: `\n  SELECT ARRAY[${CENTRAL_EMPLOYERS_E5.map((x) => `'${x}'`).join(', ')}]::text[]\n`,
  org_central_employer: `\n  SELECT company IN (${CENTRAL_EMPLOYERS_E5.map((x) => `'${x}'`).join(', ')})\n`,
};

export async function centralEmployersProblems(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const out: string[] = [];
  const r = await pool.query(
    `SELECT p.proname AS name, p.prosrc AS src, p.prosecdef AS definer, p.provolatile AS volatile,
            coalesce(array_to_string(p.proconfig, ','), '') AS config,
            has_function_privilege('prima_app', p.oid, 'EXECUTE') AS app
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'prima' AND p.proname = ANY($1)`,
    [Object.keys(BODIES)],
  );
  for (const [name, body] of Object.entries(BODIES)) {
    const rows = r.rows.filter((x) => x.name === name);
    if (rows.length !== 1) {
      out.push(`Function prima.${name} is missing (run db/modules/central-employers-v1.sql).`);
      continue;
    }
    const f = rows[0];
    if (f.src !== body) out.push(`Function prima.${name} does not list every central employer.`);
    if (f.definer) out.push(`Function prima.${name} must not run as the owner.`);
    if (f.volatile !== 'i') out.push(`Function prima.${name} must be immutable.`);
    if (f.config !== 'search_path=pg_catalog') out.push(`Function prima.${name} must pin its search path.`);
    if (f.app) out.push(`The app role may run prima.${name} directly.`);
  }
  return out;
}
