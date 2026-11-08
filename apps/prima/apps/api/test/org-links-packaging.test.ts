/**
 * Packaging proposal for the hand-over module (Arisha main review, 2 Nov 2026): pinned bytes, base, dependency order,
 * catalogue check, repeat-safety and drift, on a disposable localhost PostgreSQL only. Nothing here touches
 * db/release-manifest.json or any shared database. Synthetic rows only.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { migrationSql } from '../src/schema';
import { writeFileSync } from 'node:fs';
import { orgLinksCatalog, orgLinksProblems } from '../src/org-links-readiness';
import { ORG_LINKS_CATALOG } from '../src/org-links-catalog';

const ROOT = resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../..' : '.');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const proposal = JSON.parse(read('db/proposed/org-links-module.json').toString()) as {
  base: { path: string; sha256: string };
  after: string[];
  modules: { id: string; path: string; sha256: string; requires: string[] }[];
};
const manifest = JSON.parse(read('db/release-manifest.json').toString()) as { base: { sha256: string }; modules: { id: string }[] };

describe('hand-over module packaging proposal (files)', () => {
  it('pins the bytes of the module on the same base as the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    assert.equal(sha(read(proposal.base.path)), proposal.base.sha256);
    for (const m of proposal.modules) assert.equal(sha(read(m.path)), m.sha256, `${m.id} bytes differ from the proposal`);
  });
  it('installs after every manifest module and stays out of the manifest until approved', () => {
    // Agentic Office: the office release activates this module (its database already has it). It must sit in the
    // manifest after everything upstream installs first, with the proposal's exact bytes. Upstream keeps it a proposal.
    const order = manifest.modules.map((m) => m.id);
    for (const m of proposal.modules) {
      const at = order.indexOf(m.id);
      const pinned = (manifest.modules as Array<{ id: string; path?: string; sha256?: string }>)[at];
      if (at < 0) continue; // still a proposal here: nothing to check beyond the after list
      assert.deepEqual({ path: pinned.path, sha256: pinned.sha256 }, { path: m.path, sha256: m.sha256 });
    }
    for (const id of proposal.after ?? []) assert.ok(order.includes(id), `${id} is installed before this proposal`);
    for (const m of proposal.modules) { const at = order.indexOf(m.id); if (at >= 0) for (const id of proposal.after ?? []) assert.ok(order.indexOf(id) < at, `${id} before ${m.id}`); }
  });
  it('has no destructive or grant-widening statement; it drops only its own policies and triggers to replace them', () => {
    for (const m of proposal.modules) {
      const sql = read(m.path).toString().replace(/--.*$/gm, '');
      assert.doesNotMatch(sql, /\b(DROP\s+TABLE|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM|GRANT\s+ALL|GRANT\s+DELETE|ALTER\s+ROLE|CREATE\s+ROLE|DISABLE\s+ROW)\b/i);
      for (const d of sql.match(/DROP\s+(POLICY|TRIGGER)\s+IF\s+EXISTS\s+(\w+)/gi) ?? []) assert.match(d, /\borg_\w+$/i, d);
    }
  });
});

const BASE = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(BASE).hostname)) throw Error('Requires disposable localhost PostgreSQL');
const DB = 'prima_org_links_pack_test';
const OWNER = 'prima_org_links_pack_owner';
const url = new URL(BASE);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
async function owner<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
/** The local superuser, for placing and counting a synthetic row past row security. */
async function su<T>(fn: (c: Client) => Promise<T>) {
  const u = new URL(BASE);
  u.pathname = '/' + DB;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const install = () => owner((c) => c.query(read('db/modules/org-links-v1.sql').toString()));

describe('hand-over module packaging proposal (throwaway database)', () => {
  before(async () => {
    const c = new Client({ connectionString: BASE });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
      if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount)
        await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
      if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
      await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    } finally {
      await c.end();
    }
    await owner(async (a) => {
      assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
      await a.query(migrationSql());
      await a.query(`GRANT prima_app TO ${OWNER}`);
    });
  });
  after(async () => {
    const c = new Client({ connectionString: BASE });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    } finally {
      await c.end();
    }
  });

  it('reports the module missing on the base, installs as a non-superuser owner, and is repeat-safe with rows kept', async () => {
    const before = await owner(orgLinksProblems);
    assert.ok(before.some((x) => /prima\.org_tasks is missing/.test(x)), JSON.stringify(before));
    await install();
    const cat = await owner(orgLinksCatalog);
    if (process.env.ORG_LINKS_WRITE_CATALOG === '1')
      writeFileSync(
        resolve(ROOT, 'apps/api/src/org-links-catalog.ts'),
        readFileSync(resolve(ROOT, 'apps/api/src/org-links-catalog.ts'), 'utf8').replace(/export const ORG_LINKS_CATALOG[\s\S]*$/, `export const ORG_LINKS_CATALOG: { policies: string[]; triggers: string[]; functions: string[] } = ${JSON.stringify(cat, null, 2)};\n`),
      );
    // The reviewed catalogue in the API is exactly what a clean install produces.
    assert.deepEqual(cat, ORG_LINKS_CATALOG);
    assert.deepEqual(await owner(orgLinksProblems), []);
    await su((c) => c.query(`INSERT INTO prima.org_imports(id,data) VALUES('oimp-syn', '{"id":"oimp-syn","fingerprint":"syn","byId":"x"}')`));
    await install();
    assert.deepEqual(await owner(orgLinksProblems), []);
    assert.equal((await su((c) => c.query(`SELECT 1 FROM prima.org_imports WHERE id='oimp-syn'`))).rowCount, 1);
  });

  it('notices drift: a dropped policy, a widened grant, a disabled guard, an exposed inner check, a definer removed', async () => {
    const drift = [
      ['DROP POLICY org_notices_read ON prima.org_notices', /Policy org_notices\.org_notices_read is missing/],
      ['CREATE POLICY org_tasks_extra ON prima.org_tasks FOR SELECT USING (true)', /Unexpected policy org_tasks\.org_tasks_extra/],
      ['GRANT DELETE ON prima.org_events TO prima_app', /may delete rows from prima\.org_events/],
      ['ALTER TABLE prima.org_notices DISABLE TRIGGER org_notice_guard', /notice guard trigger is missing/],
      ['GRANT EXECUTE ON FUNCTION prima.org_desk_people(text, text, text) TO prima_app', /may run prima\.org_desk_people directly/],
      ['GRANT EXECUTE ON FUNCTION prima.org_flow_target_ok(text, text, text, text) TO prima_app', /may run prima\.org_flow_target_ok directly/],
      ['ALTER TABLE prima.org_tasks ENABLE REPLICA TRIGGER org_task_guard', /hand-over guard trigger is missing/],
      ['ALTER TABLE prima.org_tasks ENABLE ALWAYS TRIGGER org_task_guard', /Trigger org_tasks\.org_task_guard differs/],
      ['ALTER POLICY org_tasks_add ON prima.org_tasks WITH CHECK (prima.org_task_matches_event(data) OR true)', /Policy org_tasks\.org_tasks_add differs/],
      ['ALTER POLICY org_notices_read ON prima.org_notices TO PUBLIC USING (true)', /Policy org_notices\.org_notices_read differs/],
      ["CREATE OR REPLACE FUNCTION prima.org_flow_target_ok(flow text, desk text, kind text, task text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT true $$", /Function org_flow_target_ok\(flow text, desk text, kind text, task text\) differs/],
      ["CREATE FUNCTION prima.org_extra() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$", /Unexpected function org_extra\(\)/],
      ['ALTER FUNCTION prima.org_task_matches_event(jsonb) SECURITY INVOKER', /org_task_matches_event does not run as the owner/],
    ] as const;
    for (const [sql, want] of drift) {
      await owner(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(sql);
          const p = await orgLinksProblems(c);
          assert.ok(p.some((x) => want.test(x)), `${sql} -> ${JSON.stringify(p)}`);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    }
    assert.deepEqual(await owner(orgLinksProblems), []);
  });
});
