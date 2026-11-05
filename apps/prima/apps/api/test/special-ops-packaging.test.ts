// Packaging proposal for the Special Ops add-on (Arisha main review, 2 Nov 2026): pinned hashes, order after the release
// manifest, no destructive statements, and the catalogue check proved on the throwaway local database only. Nothing here
// touches db/release-manifest.json or any shared database. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { specialOpsModuleProblems } from '../src/special-ops-readiness';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const proposal = JSON.parse(read('db/proposed/special-ops-modules.json').toString()) as {
  base: { path: string; sha256: string };
  after: string[];
  modules: { id: string; path: string; sha256: string; requires: string[] }[];
};
const manifest = JSON.parse(read('db/release-manifest.json').toString()) as { base: { sha256: string }; modules: { id: string }[] };
const sql = (c: Client, text: string) => c.query(text);
async function withClient<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const install = () => withClient((c) => sql(c, read(proposal.modules[0].path).toString()));
const problems = () => withClient((c) => specialOpsModuleProblems(c));

describe('Special Ops module packaging proposal (files)', () => {
  it('pins the bytes of the base and the module, on the same base as the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    assert.equal(sha(read(proposal.base.path)), proposal.base.sha256);
    for (const m of proposal.modules) assert.equal(sha(read(m.path)), m.sha256, `${m.id} bytes differ from the proposal`);
  });
  it('comes after every manifest module and is pinned in the combined manifest after the modules before it', () => {
    assert.deepEqual(proposal.after, manifest.modules.slice(0, manifest.modules.findIndex((x) => x.id === proposal.modules[0].id)).map((m) => m.id));
    for (const m of proposal.modules) {
      const pinned = (manifest.modules as Array<{ id: string; path?: string; sha256?: string }>).find((x) => x.id === m.id);
      assert.ok(pinned, `${m.id} is in the combined manifest`);
      assert.deepEqual({ path: pinned.path, sha256: pinned.sha256 }, { path: m.path, sha256: m.sha256 });
    }
  });
  it('has no destructive or grant-widening statement', () => {
    const text = read(proposal.modules[0].path).toString().replace(/--.*$/gm, '');
    assert.doesNotMatch(text, /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|GRANT\s+ALL|GRANT\s+DELETE|SECURITY\s+DEFINER|ALTER\s+ROLE|CREATE\s+ROLE)\b/i);
  });
});

describe('Special Ops module packaging proposal (throwaway database)', () => {
  before(async () => {
    await resetDb(URL);
  });
  it('reports the boundary missing on the base, and in place after install (twice: idempotent)', async () => {
    const base = await problems();
    assert.ok(base.includes('SPECIAL_OPS_RLS_NOT_FORCED'));
    assert.ok(base.some((p) => p.startsWith('SPECIAL_OPS_ARMS_WALL:')));
    await install();
    assert.deepEqual(await problems(), []);
    await install();
    assert.deepEqual(await problems(), []);
  });
  it('notices a removed wall or a widened grant', async () => {
    await withClient((c) => sql(c, 'DROP POLICY arms_wall ON prima.firearms; GRANT DELETE ON prima.cms_staff TO prima_app'));
    const p = await problems();
    assert.ok(p.includes('SPECIAL_OPS_ARMS_WALL:firearms'));
    assert.ok(p.includes('SPECIAL_OPS_DELETE_GRANTED'));
    await withClient((c) => sql(c, 'REVOKE DELETE ON prima.cms_staff FROM prima_app'));
    await install();
    assert.deepEqual(await problems(), []);
  });
  it('notices an extra permissive policy, a changed company wall and an unexpected restrictive policy (Arisha 22:55Z)', async () => {
    await withClient((c) =>
      sql(
        c,
        `CREATE POLICY open_read ON prima.firearms FOR SELECT USING (true);
         CREATE POLICY open_all ON prima.cms_staff USING (true) WITH CHECK (true);
         CREATE POLICY extra_restrict ON prima.vaults AS RESTRICTIVE USING (true);
         ALTER POLICY company_wall ON prima.armed_jobs USING (true);`,
      ),
    );
    const p = await problems();
    assert.ok(p.includes('SPECIAL_OPS_UNEXPECTED_POLICY:firearms.open_read (permissive)'), p.join('; '));
    assert.ok(p.includes('SPECIAL_OPS_UNEXPECTED_POLICY:cms_staff.open_all (permissive)'));
    assert.ok(p.includes('SPECIAL_OPS_UNEXPECTED_POLICY:vaults.extra_restrict'));
    assert.ok(p.includes('SPECIAL_OPS_COMPANY_WALL:armed_jobs'));
    await withClient((c) =>
      sql(
        c,
        `DROP POLICY open_read ON prima.firearms; DROP POLICY open_all ON prima.cms_staff; DROP POLICY extra_restrict ON prima.vaults;
         ALTER POLICY company_wall ON prima.armed_jobs USING (company_id = ANY (prima.visible_companies()));`,
      ),
    );
    assert.deepEqual(await problems(), []);
  });
  it('notices inherited boundary changes: wall functions, function owner, table owner, role membership, schema create', async () => {
    const original = await withClient(async (c) => (await c.query(`SELECT pg_get_functiondef('prima.has_wall(text)'::regprocedure) d`)).rows[0].d as string);
    await withClient((c) =>
      sql(
        c,
        `CREATE OR REPLACE FUNCTION prima.has_wall(w text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
         ALTER FUNCTION prima.visible_companies() SECURITY DEFINER;
         ALTER TABLE prima.dealer_licences OWNER TO prima_app;
         CREATE ROLE so_uat_bypass NOLOGIN BYPASSRLS; CREATE ROLE so_uat_middle NOLOGIN;
         GRANT so_uat_bypass TO so_uat_middle; GRANT so_uat_middle TO prima_app;
         GRANT CREATE ON SCHEMA prima TO prima_app;`,
      ),
    );
    const p = await problems();
    for (const want of [
      'SPECIAL_OPS_FUNCTION_CHANGED:has_wall',
      'SPECIAL_OPS_FUNCTION_DEFINER:visible_companies',
      'SPECIAL_OPS_TABLE_OWNER:dealer_licences',
      'SPECIAL_OPS_ROLE_INHERITS:so_uat_bypass',
      'SPECIAL_OPS_SCHEMA_CREATE_GRANTED',
    ])
      assert.ok(p.includes(want), `${want} not reported: ${p.join('; ')}`);
    await withClient((c) =>
      sql(
        c,
        `${original};
         ALTER FUNCTION prima.visible_companies() SECURITY INVOKER;
         ALTER TABLE prima.dealer_licences OWNER TO postgres;
         REVOKE so_uat_middle FROM prima_app; DROP ROLE so_uat_middle; DROP ROLE so_uat_bypass;
         REVOKE CREATE ON SCHEMA prima FROM prima_app;`,
      ),
    );
    assert.deepEqual(await problems(), []);
  });
  it('notices a wall function given its own settings, with the body unchanged (Arisha 03:12Z)', async () => {
    // Proof first that the setting really overrides the caller: with it, has_wall('arms') is true for a caller with no walls.
    const asCaller = () =>
      withClient(async (c) => {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.walls', '', true)`);
        const r = (await c.query(`SELECT prima.has_wall('arms') ok`)).rows[0].ok as boolean;
        await c.query('ROLLBACK');
        return r;
      });
    assert.equal(await asCaller(), false);
    await withClient((c) => sql(c, `ALTER FUNCTION prima.has_wall(text) SET app.walls = 'arms,cms'`));
    assert.equal(await asCaller(), true, 'the function-level setting overrides the caller');
    let p = await problems();
    assert.ok(p.includes('SPECIAL_OPS_FUNCTION_CONFIG:has_wall'), p.join('; '));
    assert.ok(!p.includes('SPECIAL_OPS_FUNCTION_CHANGED:has_wall'), 'the body is unchanged, so only the configuration check can catch it');
    await withClient((c) => sql(c, `ALTER FUNCTION prima.has_wall(text) RESET ALL; ALTER FUNCTION prima.visible_companies() SET search_path = public`));
    p = await problems();
    assert.ok(p.includes('SPECIAL_OPS_FUNCTION_CONFIG:visible_companies'), p.join('; '));
    await withClient((c) => sql(c, `ALTER FUNCTION prima.visible_companies() RESET ALL; ALTER FUNCTION prima.has_wall(text) VOLATILE`));
    assert.ok((await problems()).includes('SPECIAL_OPS_FUNCTION_KIND:has_wall'));
    await withClient((c) => sql(c, `ALTER FUNCTION prima.has_wall(text) STABLE`));
    assert.equal(await asCaller(), false);
    assert.deepEqual(await problems(), []);
  });
  describe('permissions that result', () => {
    let db: Db;
    before(() => {
      db = new Db();
    });
    after(async () => {
      await db.onModuleDestroy();
    });
    it('Arms Control reads firearms and the supplier file; Finance and a company of another group see none', async () => {
      const arms = await db.asUser('u-pwvsb-arms', async (_s, _u, store) => store.list('firearms'));
      assert.ok(arms.length > 0);
      assert.equal((await db.asUser('u-fd', async (_s, _u, store) => store.list('firearms'))).length, 0);
      assert.equal((await db.asUser('u-fd', async (_s, _u, store) => store.list('armsSuppliers'))).length, 0);
      const file = await db.asUser('u-pwvsb-arms', (svc, u) => svc.armsSupplierFile(u));
      assert.ok(Array.isArray(file.suppliers));
      const other = await db.asUser('u-cm-arsh', async (_s, _u, store) => store.list('firearms'));
      assert.ok(other.every((f) => f.companyId === 'co-arsh'));
    });
  });
});
