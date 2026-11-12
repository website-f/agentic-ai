// P65: Prima Secure's database setup, run by the one-shot `prima-setup` service before every
// start of `prima-api` (same image). Prima's own tools do the work, exactly as its runbook says
// (apps/prima/docs/RELEASE_MODULE_INSTALLATION.md):
//   1. db-setup (as the schema owner): the base schema (idempotent), the first clean-slate
//      settings on an empty database, and the runtime login prima_api.
//   2. module-install, for each module of the release manifest, with the exact release and
//      module hashes it prints itself. An installed module is a no-op; a drifted one is refused
//      (and so is this start: prima-api then stays down rather than run on a wrong schema).
'use strict';
const { execFileSync } = require('node:child_process');

const cwd = process.env.PRIMA_API_DIR || '/app/apps/api';
const run = (args) => execFileSync('node', args, { cwd, stdio: 'inherit', env: process.env });

run(['dist/src/db-setup.js']);
// P96: the pay formulas and guard pay modules are OPTIONAL (Fauzan, 8 Nov 2026): installed later as their own step, never
// here. They are not in the release manifest and need a different confirmation; this list is a second lock.
const NEVER_HERE = new Set(['pay_formulas', 'guard_pay']);
function installModules() {
  const plan = JSON.parse(execFileSync('node', ['dist/src/module-install.js'], { cwd, env: process.env }).toString());
  for (const m of plan.manifest.modules) {
    if (NEVER_HERE.has(m.id)) throw new Error(`the release lists the optional module ${m.id}; it is installed only as its own step`);
    console.log(`prima-setup: module ${m.id}`);
    run([
      'dist/src/module-install.js',
      '--module', m.id,
      '--release-sha', plan.releaseSha256,
      '--module-sha', m.sha256,
      '--confirm', 'INSTALL_SELECTED_MODULE',
    ]);
  }
}
// P88: the boss's release candidate changed three things inside modules the office database already has (an installed
// module is never re-run): payroll Finance may read statutory rates, and the IT cleanup and rental correction scopes
// know the pgl company. Each is repeat-safe (CREATE OR REPLACE, DROP POLICY IF EXISTS) and runs only where its module
// is installed, as the schema owner, in one transaction, BEFORE the module checks: the release catalogue pins these
// function bodies, so an installed module is only recognised once its functions match the release.
const REFRESH = [
  {
    "when": "to_regprocedure('prima.ic_scope(text,text)') IS NOT NULL",
    "sql": "CREATE OR REPLACE FUNCTION prima.ic_scope(uid text,company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$\n SELECT coalesce(EXISTS(SELECT 1 FROM prima.users u WHERE u.id=uid AND prima.ic_actor(uid,false) AND u.data->'companyIds' ? company AND (company IN ('pwvsb','merdeka','goodwill','sasateam','pgl') OR EXISTS(SELECT 1 FROM prima.companies c WHERE c.id=company))),false)\n$$;",
    "what": "IT cleanup scope also covers the pgl company"
  },
  {
    "when": "to_regprocedure('prima.rc_scope(text,text)') IS NOT NULL",
    "sql": "CREATE OR REPLACE FUNCTION prima.rc_scope(uid text,company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$\n SELECT coalesce(EXISTS(SELECT 1 FROM prima.users u WHERE u.id=uid AND u.data->'companyIds' ? company AND (company IN ('pwvsb','merdeka','goodwill','sasateam','pgl') OR EXISTS(SELECT 1 FROM prima.companies c WHERE c.id=company))),false)\n$$;",
    "what": "rental correction scope also covers the pgl company"
  },
  {
    "when": "to_regclass('prima.statutory_versions') IS NOT NULL",
    "sql": "DROP POLICY IF EXISTS statutory_read ON prima.statutory_versions;\nCREATE POLICY statutory_read ON prima.statutory_versions FOR SELECT USING (prima.has_wall('act') OR prima.has_wall('pay_read') OR prima.has_wall('statutory_read'));",
    "what": "payroll Finance reads statutory rates (statutory_read wall)"
  }
];
// P90: the office's own repeat-safe modules (CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS), run on
// every start as the schema owner, each file in its own transaction (the file holds BEGIN and COMMIT). A second run changes
// nothing. They add new tables only; no existing table, row or policy is changed.
//   owner-test-checkin-v1.sql: the owner's TEST check-in and check-out with the route between (never attendance or pay).
//   clock-snaps-v1.sql (P97): the staff check-in and check-out face photos, seen only by the person, their manager and HR.
//   guard-pay-preparers-v1.sql (P100 B1): who prepares each company's guard pay run, named by its Company Manager.
//   cash-stand-ins-v1.sql (P100 B2): the CEO lets the Finance Director stand in on cash decisions (dates or one request).
//   staff-ot-v1.sql (P100 C12 + J3): staff and CMS overtime lines HR approves for the staff payroll.
const OFFICE_MODULES = ['owner-test-checkin-v1.sql', 'clock-snaps-v1.sql', 'guard-pay-preparers-v1.sql', 'cash-stand-ins-v1.sql', 'staff-ot-v1.sql'];
(async () => {
  const { Client } = require(require.resolve('pg', { paths: [cwd] }));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    for (const s of REFRESH) {
      const on = (await c.query(`SELECT (${s.when}) AS ok`)).rows[0].ok;
      if (!on) continue;
      await c.query(s.sql);
      console.log(`prima-setup: refreshed: ${s.what}`);
    }
    await c.query('COMMIT');
    const dir = require('node:path').resolve(cwd, '../../db/modules');
    for (const f of OFFICE_MODULES) {
      await c.query(require('node:fs').readFileSync(require('node:path').join(dir, f), 'utf8'));
      console.log(`prima-setup: office module ${f} in place`);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
  installModules();
  console.log('prima-setup: base and all modules in place');
})().catch((e) => { console.error('prima-setup: module refresh failed:', e.message); process.exit(1); });
