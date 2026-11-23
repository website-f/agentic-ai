// P65: Prima Secure's database setup, run by the one-shot `prima-setup` service before every
// start of `prima-api` (same image). Prima's own tools do the work, exactly as its runbook says
// (apps/prima/docs/RELEASE_MODULE_INSTALLATION.md). This is the office's equivalent of Fauzan's
// infra/run-db-migration.sh. In order, each step repeat-safe (a second run changes nothing):
//   1. db-setup (as the schema owner): the base schema (idempotent), the first clean-slate
//      settings on an empty database, and the runtime login prima_api.
//   2. REFRESH: function bodies the release pins, restated where their module is installed (P88).
//   3. RETIRE (P105): the office's own P100 builds of handover items that Fauzan built himself
//      upstream are taken out of the database, ONLY where their table is empty (else this start stops).
//   4. The office's own repeat-safe modules (owner TEST check-in, clock face photos).
//   5. module-install, for each module of the release manifest (upstream's 32 plus the office's
//      QR item register part two), with the exact release and module hashes it prints itself. An
//      installed module is a no-op; a drifted one is refused (and so is this start: prima-api then
//      stays down rather than run on a wrong schema).
//   6. The 24 modules off the release list that Fauzan approved (15 Nov 2026: "Let him run the 24
//      package"), in his order, each once: a module whose marker is already in the database is skipped.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cwd = process.env.PRIMA_API_DIR || '/app/apps/api';
const MODULES_DIR = path.resolve(cwd, '../../db/modules');
const run = (args) => execFileSync('node', args, { cwd, stdio: 'inherit', env: process.env });
const readModule = (f) => fs.readFileSync(path.join(MODULES_DIR, f), 'utf8');

function installModules() {
  const plan = JSON.parse(execFileSync('node', ['dist/src/module-install.js'], { cwd, env: process.env }).toString());
  for (const m of plan.manifest.modules) {
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

// P105 (Fitri, 15 Nov 2026: where the office and Fauzan built the same handover item, Fauzan's wins). The office's P100
// builds of those items are retired from the database before the release and the 24 modules install Fauzan's own.
// Each table goes ONLY when it is empty; otherwise this start stops with the table named, and nothing is changed (one
// transaction). Repeat-safe: on a database without them (a new one, or a second run) every step is a no-op.
//   tables: the office tables of items upstream rebuilt (dropped with their own policies, indexes and triggers).
//   sameName: tables upstream's own modules create with the same name; only the office's shape (marked by its
//     constraint) goes, so upstream's module then creates its own (guard-pay-preparers-v1, uniform-requests-v1).
//   functions/policies: the office's helpers and walls on tables that stay.
const RETIRE = {
  tables: [
    'staff_ot_lines', 'item_warranty_claims', 'bulk_loads', 'cash_stand_ins', 'guard_signin_batches',
    'staff_resignations', 'vehicle_transfers', 'qms_pikm_records', 'alert_prefs',
  ],
  sameName: [
    { table: 'guard_pay_preparers', mark: 'gpp_id', what: 'guard pay preparers (B1)' },
    { table: 'stock_requests', mark: 'ur_id', what: 'uniform requests (I1)' },
  ],
  // By name (every signature): none of these names is used by upstream.
  functions: [
    'gpp_namer', 'gpp_reader', 'sot_hr', 'bl_overseer', 'bl_loader', 'csi_role', 'gsb_role', 'gsb_pin', 'gsb_create', 'vt_role',
    'purge_location_readings',
    // speak-up (H2): the office's wall on prima.whistle_reports; the reports themselves stay.
    'speak_up_status', 'speak_up_reply', 'speak_up_signals', 'su_signed_in',
    // E5: upstream's org-links keeps its own central-employer rule (restored below).
    'ce_central_employers',
  ],
  policies: [
    ['whistle_reports', 'su_owner'], ['whistle_reports', 'su_read'], ['whistle_reports', 'su_insert'], ['whistle_reports', 'su_update'],
    ['location_pings', 'location_retention_owner'], ['guard_pings', 'guard_ping_retention_owner'], ['clock_snaps', 'clock_snap_retention_owner'],
  ],
  constraints: [['whistle_reports', 'su_anonymous']],
  indexes: ['whistle_reports_code_idx'],
  sequences: ['speak_up_number_seq'],
};

async function retire(c) {
  const exists = async (sql, args) => (await c.query(sql, args)).rows[0].ok === true;
  // Row-level security is FORCEd on these tables and the schema owner has no policy on them, so a plain count as the owner
  // would read none. Inside this transaction the force is lifted first (the owner then reads every row); a table that
  // holds rows stops everything and the ROLLBACK puts the force back.
  const empty = async (t) => {
    await c.query(`ALTER TABLE prima.${t} NO FORCE ROW LEVEL SECURITY`);
    return (await c.query(`SELECT NOT EXISTS (SELECT 1 FROM prima.${t}) AS ok`)).rows[0].ok === true;
  };
  const drop = async (t, what) => {
    if (!(await empty(t))) throw new Error(`the office table prima.${t} (${what}) still holds rows; nothing was changed. Move or clear them first.`);
    await c.query(`DROP TABLE prima.${t}`);
    console.log(`prima-setup: retired the office's empty table ${t} (${what})`);
  };
  for (const t of RETIRE.tables)
    if (await exists('SELECT to_regclass($1) IS NOT NULL AS ok', [`prima.${t}`])) await drop(t, 'office P100 build');
  for (const s of RETIRE.sameName) {
    const office = await exists(
      "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = to_regclass($2)) AS ok", [s.mark, `prima.${s.table}`]);
    if (office) await drop(s.table, `the office's ${s.what}; upstream's module makes its own`);
  }
  for (const [t, p] of RETIRE.policies)
    if (await exists('SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polname = $1 AND polrelid = to_regclass($2)) AS ok', [p, `prima.${t}`])) {
      await c.query(`DROP POLICY ${p} ON prima.${t}`);
      console.log(`prima-setup: retired the office policy ${p} on ${t}`);
    }
  for (const [t, k] of RETIRE.constraints)
    if (await exists('SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = to_regclass($2)) AS ok', [k, `prima.${t}`])) {
      await c.query(`ALTER TABLE prima.${t} DROP CONSTRAINT ${k}`);
      console.log(`prima-setup: retired the office constraint ${k} on ${t}`);
    }
  for (const i of RETIRE.indexes) await c.query(`DROP INDEX IF EXISTS prima.${i}`);
  for (const q of RETIRE.sequences) await c.query(`DROP SEQUENCE IF EXISTS prima.${q}`);
  // Functions last: a dropped table took its own policies and triggers with it, and the policies above used some.
  const fns = await c.query(
    "SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'prima' AND p.proname = ANY($1::text[])",
    [RETIRE.functions]);
  for (const { f } of fns.rows) {
    await c.query(`DROP FUNCTION ${f}`);
    console.log(`prima-setup: retired the office function ${f}`);
  }
  // E5: the office restated org-links' central-employer rule with all five central employers; upstream's org-links
  // fingerprint pins its own body, so it is put back exactly as db/modules/org-links-v1.sql writes it.
  if (await exists("SELECT to_regprocedure('prima.org_central_employer(text)') IS NOT NULL AS ok")) {
    const m = /CREATE OR REPLACE FUNCTION prima\.org_central_employer\(company text\)[\s\S]*?\n\$\$;/.exec(readModule('org-links-v1.sql'));
    if (!m) throw new Error('org-links-v1.sql has no org_central_employer definition');
    const cur = (await c.query("SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('prima.org_central_employer(text)')")).rows[0].prosrc;
    if (cur.includes("'pgl'")) {
      await c.query(m[0]);
      console.log('prima-setup: restored org-links\' central-employer rule (the office E5 version retired)');
    }
  }
  // H1: the office's RBA committee roster (rba-committee-roster-v1) is the same table upstream's rba-readiness-v1 now
  // makes, but with two CHECKs named by the office. Where RBA is installed, the names are made upstream's (same checks);
  // where it is not, the empty roster table goes so that the release installs RBA whole.
  if (await exists("SELECT to_regclass('prima.rba_committee_rosters') IS NOT NULL AS ok")) {
    const named = (await c.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'prima.rba_committee_rosters'::regclass AND conname IN ('rba_roster_id','rba_roster_company')")).rows.map((r) => r.conname);
    if (named.length) {
      if (await exists("SELECT to_regclass('prima.rba_committees') IS NOT NULL AS ok")) {
        if (named.includes('rba_roster_id')) await c.query('ALTER TABLE prima.rba_committee_rosters RENAME CONSTRAINT rba_roster_id TO rba_committee_rosters_check');
        if (named.includes('rba_roster_company')) await c.query('ALTER TABLE prima.rba_committee_rosters RENAME CONSTRAINT rba_roster_company TO rba_committee_rosters_check1');
        console.log("prima-setup: RBA committee roster checks renamed to upstream's");
      } else await drop('rba_committee_rosters', "the office's RBA committee roster; the release installs RBA whole");
    }
  }
}

// P90/P97: the office's own repeat-safe modules (CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS), run
// on every start as the schema owner, each file in its own transaction (the file holds BEGIN and COMMIT). They add new
// tables only; no existing table, row or policy is changed.
//   owner-test-checkin-v1.sql: the owner's TEST check-in and check-out with the route between (never attendance or pay).
//   clock-snaps-v1.sql (P97): the staff check-in and check-out face photos, seen only by the person, their manager and HR.
const OFFICE_MODULES = ['owner-test-checkin-v1.sql', 'clock-snaps-v1.sql'];

// P105: the 24 modules off the release list, in Fauzan's order (15 Nov 2026; apps/prima/db/office-non-release.json, which
// scripts/office-module-allowances.cjs also reads), after the release modules (some need one: arms-policies after
// special_ops, legal holds v2 after legal holds v1). Each is upstream's reviewed file, run once as the schema owner in
// its own transaction (the file holds BEGIN and COMMIT), as infra/run-db-migration.sh's operator runs it. A module is
// skipped when its marker (a table, function, policy or constraint only it makes) is already there, so a second start
// changes nothing. The release check accepts exactly what two of them change on release tables (business walls on the
// tender tables, the CEO's read of bulk loads): apps/api/src/office-module-allowances.ts. Not here: accounts-access-v1
// (PR #144, after the 24; waits for Fauzan's go-ahead).
const NON_RELEASE = JSON.parse(fs.readFileSync(path.resolve(MODULES_DIR, '../office-non-release.json'), 'utf8')).modules;
// P126: Fauzan's off-list modules from main c5268831 (org chart lines, shared login list, old files, helper, AI budget,
// company papers, Marketing accounts, Microsoft use board, office buying, ACT walls; accounts-access-v1 first). Each file
// says "only with Fauzan's go-ahead", so they run only when the operator sets PRIMA_PENDING_MODULES=1 for that run.
const PENDING = JSON.parse(fs.readFileSync(path.resolve(MODULES_DIR, '../office-pending.json'), 'utf8')).modules;

async function withClient(fn) {
  const { Client } = require(require.resolve('pg', { paths: [cwd] }));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function nonRelease(c) {
  const list = process.env.PRIMA_PENDING_MODULES === '1' ? [...NON_RELEASE, ...PENDING] : NON_RELEASE;
  for (const { file, marker } of list) {
    if ((await c.query(`SELECT (${marker}) AS ok`)).rows[0].ok === true) continue;
    await c.query(readModule(file));
    console.log(`prima-setup: module ${file} installed`);
  }
}

(async () => {
  run(['dist/src/db-setup.js']);
  await withClient(async (c) => {
    await c.query('BEGIN');
    for (const s of REFRESH) {
      const on = (await c.query(`SELECT (${s.when}) AS ok`)).rows[0].ok;
      if (!on) continue;
      await c.query(s.sql);
      console.log(`prima-setup: refreshed: ${s.what}`);
    }
    await retire(c);
    await c.query('COMMIT');
    for (const f of OFFICE_MODULES) {
      await c.query(readModule(f));
      console.log(`prima-setup: office module ${f} in place`);
    }
  });
  installModules();
  await withClient(nonRelease);
  console.log('prima-setup: base and all modules in place');
})().catch((e) => { console.error('prima-setup: stopped:', e.message); process.exit(1); });
