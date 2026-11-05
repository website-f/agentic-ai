// Packaging proposal for the two Central Admin modules (Arisha main review, 2 Nov 2026): pinned hashes, dependency
// order, catalogue assertions and the permissions that result, proved on the throwaway local database only. Nothing
// here writes db/release-manifest.json or touches any shared database. Mock data only. Round 2: both modules are now in the
// manifest, so this also proves the manifest entries match the proposal's install order and hashes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type PoolClient } from 'pg';
import { PrimaService } from '@prima/core';
import { PgStore } from '../src/pg-store';
import { resetDb } from '../src/reset-db';
import {
  centralAdminDelegationsProblems,
  centralAdminLegalHoldsProblems,
  centralAdminPanelProblems,
  centralAdminWallsProblems,
  LEGAL_HOLD_FUNCTION_BODY_SHA,
  legalHoldFunctionBodySha,
} from '../src/central-admin-readiness';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const proposal = JSON.parse(read('db/proposed/central-admin-modules.json').toString()) as {
  base: { path: string; sha256: string };
  modules: { id: string; path: string; sha256: string; requires: string[] }[];
};
const manifest = JSON.parse(read('db/release-manifest.json').toString()) as {
  base: { sha256: string };
  modules: { id: string; path: string; sha256: string; requires: string[] }[];
};

async function withClient<T>(fn: (c: Client) => Promise<T>) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const install = (id: string) => withClient((c) => c.query(read(proposal.modules.find((m) => m.id === id)!.path).toString()));
const problems = () =>
  withClient(async (c) => ({
    walls: await centralAdminWallsProblems(c),
    panel: await centralAdminPanelProblems(c),
    delegations: await centralAdminDelegationsProblems(c),
    holds: await centralAdminLegalHoldsProblems(c),
  }));

describe('Central Admin module packaging proposal (files)', () => {
  it('pins the reviewed legal-hold function body that the readiness check compares (review round 5b)', () => {
    const sql = read('db/modules/central-admin-legal-holds-v1.sql').toString();
    const at = sql.indexOf('CREATE OR REPLACE FUNCTION prima.lh_preserve()');
    const start = sql.indexOf('$$', at) + 2;
    assert.equal(legalHoldFunctionBodySha(sql.slice(start, sql.indexOf('$$', start))), LEGAL_HOLD_FUNCTION_BODY_SHA);
  });

  it('pins the bytes of the base and each module, on the same base as the release manifest', () => {
    assert.equal(proposal.base.sha256, manifest.base.sha256);
    assert.equal(sha(read(proposal.base.path)), proposal.base.sha256);
    for (const m of proposal.modules) {
      assert.match(m.sha256, /^[a-f0-9]{64}$/);
      assert.equal(sha(read(m.path)), m.sha256, `${m.id} bytes differ from the proposal`);
    }
  });
  it('declares its dependencies in install order, and the release manifest carries the same entries after the IT modules', () => {
    const ids = proposal.modules.map((m) => m.id);
    assert.deepEqual(ids, ['central_admin_walls', 'central_admin_panel', 'central_admin_delegations', 'central_admin_legal_holds']);
    assert.equal(new Set(ids).size, ids.length);
    const pinned = ids.map((id) => manifest.modules.find((m) => m.id === id)!);
    assert.deepEqual(
      pinned.map(({ id, path, sha256, requires }) => ({ id, path, sha256, requires })),
      proposal.modules.map(({ id, path, sha256, requires }) => ({ id, path, sha256, requires })),
    );
    proposal.modules.forEach((m, i) => m.requires.forEach((r) => assert.ok(ids.indexOf(r) > -1 && ids.indexOf(r) < i, `${m.id} needs ${r} first`)));
  });
  it('keeps both modules free of destructive or grant-widening statements', () => {
    for (const m of proposal.modules) {
      const sql = read(m.path).toString().replace(/--.*$/gm, '');
      assert.doesNotMatch(sql, /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|GRANT\s+ALL|GRANT\s+DELETE|SECURITY\s+DEFINER|ALTER\s+ROLE|CREATE\s+ROLE)\b/i, m.id);
    }
  });
});

describe('Central Admin module packaging proposal (throwaway database)', () => {
  before(async () => {
    await resetDb(URL);
  });
  after(async () => {
    await resetDb(URL);
  });

  it('reports the modules missing on the base, installs walls, panel and delegations, and is repeat-safe', async () => {
    let p = await problems();
    assert.ok(p.walls.length === 6 && p.walls.every((x) => x.startsWith('WALLS_POLICY_MISSING')), JSON.stringify(p.walls));
    assert.deepEqual(p.panel, ['PANEL_TABLE_MISSING']);
    assert.deepEqual(p.delegations, ['DELEGATIONS_TABLE_MISSING', 'CRITICAL_ROLES_TABLE_MISSING']);
    assert.deepEqual(p.holds, ['LEGAL_HOLDS_TABLE_MISSING', 'LEGAL_HOLD_VERSIONS_TABLE_MISSING', 'LEGAL_HOLD_TRIGGER_FUNCTION_MISSING', 'LEGAL_HOLD_TRIGGERS_MISSING']);
    await install('central_admin_walls');
    p = await problems();
    assert.deepEqual(p.walls, []);
    assert.deepEqual(p.panel, ['PANEL_TABLE_MISSING']);
    await install('central_admin_panel');
    await install('central_admin_walls');
    await install('central_admin_panel');
    await install('central_admin_delegations');
    await install('central_admin_delegations');
    await install('central_admin_legal_holds');
    await install('central_admin_legal_holds');
    assert.deepEqual(await problems(), { walls: [], panel: [], delegations: [], holds: [] });
  });

  const asUser = (walls: string, userId: string, companies: string, sql: string, params: unknown[] = []) =>
    withClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', $1, true), set_config('app.user_id', $2, true), set_config('app.company_ids', $3, true)`, [walls, userId, companies]);
        return await c.query(sql, params);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  // Commits as the app role (for multi-step proofs); the throwaway database is reset after this file.
  const asUserCommit = (walls: string, userId: string, companies: string, sql: string, params: unknown[] = []) =>
    withClient(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL ROLE prima_app');
        await c.query(`SELECT set_config('app.walls', $1, true), set_config('app.user_id', $2, true), set_config('app.company_ids', $3, true)`, [walls, userId, companies]);
        const r = await c.query(sql, params);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });

  it('critical posts: only the mandates wall reads or writes them, inside the company wall, never deletes', async () => {
    const row = `INSERT INTO prima.critical_roles (id, company_id, data) VALUES ('cr-x', 'co-a', '{"id":"cr-x","companyId":"co-a"}')`;
    await assert.rejects(asUser('corporate,legal', 'u-y', 'co-a', row), /row-level security/);
    await assert.rejects(asUser('mandates', 'u-y', 'co-b', row), /row-level security/);
    assert.equal((await asUser('mandates', 'u-y', 'co-a', row)).rowCount, 1);
    await withClient((c) => c.query(`INSERT INTO prima.critical_roles (id, company_id, data) VALUES ('cr-1', 'co-a', '{"id":"cr-1","companyId":"co-a"}')`));
    assert.equal((await asUser('', 'u-y', 'co-a', `SELECT id FROM prima.critical_roles`)).rowCount, 0);
    assert.equal((await asUser('mandates', 'u-y', 'co-a', `SELECT id FROM prima.critical_roles`)).rowCount, 1);
    await assert.rejects(asUser('mandates', 'u-y', 'co-a', `DELETE FROM prima.critical_roles`), /permission denied/);
  });

  it('legal hold: only the legal wall places or releases; a held record keeps every earlier version and cannot be deleted; staff changes still go through', async () => {
    const hold = (id: string, refId: string) =>
      `INSERT INTO prima.legal_holds (id, company_id, data) VALUES ('${id}', 'co-a', '{"id":"${id}","companyId":"co-a","tbl":"cases","refId":"${refId}","matterId":"lm-1","released":null}')`;
    await assert.rejects(asUser('corporate,mandates', 'u-staff', 'co-a', hold('lh-x', 'cs-1')), /row-level security/);
    await assert.rejects(asUser('legal', 'u-legal', 'co-b', hold('lh-x', 'cs-1')), /row-level security/);
    await assert.rejects(
      asUser('legal', 'u-legal', 'co-a', `INSERT INTO prima.legal_holds (id, company_id, data) VALUES ('lh-y', 'co-a', '{"id":"lh-y","companyId":"co-a","tbl":"users","refId":"u-1"}')`),
      /check constraint/,
    );
    await withClient((c) =>
      c.query(`INSERT INTO prima.cases (id, company_id, data) VALUES ('cs-1', 'co-a', '{"id":"cs-1","companyId":"co-a","title":"Mock case","status":"open"}'),
                                                                   ('cs-2', 'co-a', '{"id":"cs-2","companyId":"co-a","title":"Other mock case","status":"open"}')`),
    );
    await asUserCommit('legal', 'u-legal', 'co-a', hold('lh-1', 'cs-1'));
    // Staff (no legal wall) see the hold exists (needed by the trigger) but not the versions; their change goes through.
    assert.equal((await asUser('', 'u-staff', 'co-a', `SELECT id FROM prima.legal_holds`)).rowCount, 1);
    await asUserCommit('', 'u-staff', 'co-a', `UPDATE prima.cases SET data = data || '{"status":"closed"}' WHERE id = 'cs-1'`);
    await asUserCommit('', 'u-staff', 'co-a', `UPDATE prima.cases SET data = data || '{"title":"Renamed"}' WHERE id = 'cs-1'`);
    await asUserCommit('', 'u-staff', 'co-a', `UPDATE prima.cases SET data = data || '{"status":"closed"}' WHERE id = 'cs-2'`);
    assert.equal((await asUser('', 'u-staff', 'co-a', `SELECT id FROM prima.legal_hold_versions`)).rowCount, 0, 'versions are for the legal wall only');
    const v = await asUser('legal', 'u-legal', 'co-a', `SELECT data FROM prima.legal_hold_versions ORDER BY data->>'at', id`);
    assert.equal(v.rowCount, 2, 'two changes to the held case, none for the case without a hold');
    assert.deepEqual(
      v.rows.map((r) => [r.data.refId, r.data.holdId, r.data.byId, r.data.before.status]).sort(),
      [
        ['cs-1', 'lh-1', 'u-staff', 'closed'],
        ['cs-1', 'lh-1', 'u-staff', 'open'],
      ],
    );
    // No one changes or removes a kept version; a held record cannot be deleted even by the table owner.
    await assert.rejects(asUser('legal', 'u-legal', 'co-a', `UPDATE prima.legal_hold_versions SET data = data`), /permission denied/);
    await assert.rejects(asUser('legal', 'u-legal', 'co-a', `DELETE FROM prima.legal_hold_versions`), /permission denied/);
    await assert.rejects(withClient((c) => c.query(`DELETE FROM prima.cases WHERE id = 'cs-1'`)), /on legal hold/);
    // Staff cannot release; legal releases; then changes are no longer kept.
    assert.equal((await asUser('', 'u-staff', 'co-a', `UPDATE prima.legal_holds SET data = data || '{"released":{"by":"x"}}'`)).rowCount, 0);
    await asUserCommit('legal', 'u-legal', 'co-a', `UPDATE prima.legal_holds SET data = data || '{"released":{"by":"Legal (mock)"}}' WHERE id = 'lh-1'`);
    await asUserCommit('', 'u-staff', 'co-a', `UPDATE prima.cases SET data = data || '{"title":"After release"}' WHERE id = 'cs-1'`);
    assert.equal((await asUser('legal', 'u-legal', 'co-a', `SELECT id FROM prima.legal_hold_versions`)).rowCount, 2);
  });

  it('lets a mandates reader or the named delegate read a delegation line, writes only with the mandates wall, never deletes', async () => {
    const asApp = (walls: string, userId: string, companies: string, sql: string) =>
      withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('SET LOCAL ROLE prima_app');
          await c.query(`SELECT set_config('app.walls', $1, true), set_config('app.user_id', $2, true), set_config('app.company_ids', $3, true)`, [
            walls,
            userId,
            companies,
          ]);
          return await c.query(sql);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    const row = `INSERT INTO prima.delegations (id, company_id, data) VALUES ('dl-x', 'pwvsb', '{"id":"dl-x","companyId":"pwvsb","delegateId":"u-x"}')`;
    await assert.rejects(asApp('corporate', 'u-y', 'pwvsb', row), /row-level security/);
    await assert.rejects(asApp('mandates', 'u-y', 'co-other', row), /row-level security/);
    assert.equal((await asApp('mandates', 'u-y', 'pwvsb', row)).rowCount, 1);
    await withClient((c) => c.query(`INSERT INTO prima.delegations (id, company_id, data) VALUES ('dl-1', 'pwvsb', '{"id":"dl-1","companyId":"pwvsb","delegateId":"u-x"}')`));
    const read = `SELECT id FROM prima.delegations`;
    assert.equal((await asApp('', 'u-x', 'pwvsb', read)).rowCount, 1, 'the named delegate reads their line');
    assert.equal((await asApp('', 'u-y', 'pwvsb', read)).rowCount, 0, 'anyone else without the wall reads nothing');
    assert.equal((await asApp('mandates', 'u-y', 'co-other', read)).rowCount, 0, 'the company wall still applies');
    await assert.rejects(asApp('', 'u-x', 'pwvsb', `UPDATE prima.delegations SET data = data || '{"scope":"x"}' WHERE id = 'dl-1'`), /row-level security/);
    await assert.rejects(asApp('mandates', 'u-y', 'pwvsb', `DELETE FROM prima.delegations`), /permission denied/);
  });

  it('gives the app role read, add and change on panel firms behind the walls, and never delete', async () => {
    const asApp = (walls: string, sql: string) =>
      withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('SET LOCAL ROLE prima_app');
          await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
          return await c.query(sql);
        } finally {
          await c.query('ROLLBACK');
        }
      });
    const row = `INSERT INTO prima.panel_firms (id, data) VALUES ('pf-x', '{"id":"pf-x"}')`;
    await assert.rejects(asApp('', row), /row-level security/);
    await assert.rejects(asApp('act,pdpa,asset_read,mandates', row), /row-level security/);
    assert.equal((await asApp('corporate', row)).rowCount, 1);
    assert.equal((await asApp('legal', row)).rowCount, 1);
    await assert.rejects(asApp('corporate', `DELETE FROM prima.panel_firms`), /permission denied/);
    await assert.rejects(asApp('corporate', `TRUNCATE prima.panel_firms`), /permission denied|must be owner/);
  });

  it('two Finance Directors linking the same SQL Account reference at once: the second waits and is refused (review round 5b)', async () => {
    // Real service on PgStore, one transaction per connection as a request runs. The owner connection is used so the
    // proof is about the lock, not the walls (RLS is proved above). Two different firms, so no shared row lock exists.
    const now = () => new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00');
    const tx = async <T>(c: Client, fn: (svc: PrimaService) => Promise<T>) => {
      await c.query('BEGIN');
      return fn(new PrimaService(new PgStore(c as unknown as PoolClient), now));
    };
    const once = <T>(fn: (svc: PrimaService) => Promise<T>) =>
      withClient(async (c) => {
        try {
          const v = await tx(c, fn);
          await c.query('COMMIT');
          return v;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });
    const invoiceIds: { firmId: string; invoiceId: string }[] = [];
    for (const n of [1, 2]) {
      const f = await once(async (svc) =>
        svc.addPanelFirm(await svc.user('u-dcos'), { kind: 'AUDIT', name: `Race firm ${n} (mock)`, regNo: `RF ${n} (mock)`, appointedOn: '2026-01-10' }),
      );
      await once(async (svc) =>
        svc.adviserMoneyStep(await svc.user('u-dcos'), f.id, 'invoice', { no: `R-${n}`, on: '2026-10-15', amount: 100, forWhat: 'Race filing (mock)', companyId: 'co-sasa' }),
      );
      const invoiceId = (await once(async (svc) => svc.panelBoard(await svc.user('u-fd')))).firms.find((x) => x.firm.id === f.id)!.invoices[0].invoice.id;
      await once(async (svc) =>
        svc.adviserMoneyStep(await svc.user('u-cm-sasa'), f.id, 'accept', { invoiceId, evidenceRef: 'Receipt (mock)', note: 'Filing done (mock)' }),
      );
      await once(async (svc) => svc.adviserMoneyStep(await svc.user('u-fd'), f.id, 'check', { invoiceId, result: 'passed', note: 'Fine (mock)' }));
      invoiceIds.push({ firmId: f.id, invoiceId });
    }
    const a = new Client({ connectionString: URL });
    const b = new Client({ connectionString: URL });
    await a.connect();
    await b.connect();
    try {
      const ap = { entityId: 'co-sasa', postedOn: '2026-10-20' };
      await tx(a, async (svc) => svc.adviserMoneyStep(await svc.user('u-fd'), invoiceIds[0].firmId, 'ap', { ...ap, invoiceId: invoiceIds[0].invoiceId, apRef: 'PI-77 (mock)' }));
      // A has linked but not committed. B uses the same reference written differently and must wait for A.
      let settled = false;
      const second = tx(b, async (svc) =>
        svc.adviserMoneyStep(await svc.user('u-fd'), invoiceIds[1].firmId, 'ap', { ...ap, invoiceId: invoiceIds[1].invoiceId, apRef: 'pi 77 (MOCK)' }),
      ).finally(() => (settled = true));
      second.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(settled, false, 'the second link waits for the first');
      await a.query('COMMIT');
      await assert.rejects(second, /already linked to another adviser invoice/);
      await b.query('ROLLBACK');
    } finally {
      await a.end();
      await b.end();
    }
    const linked = (await withClient((c) => c.query(`SELECT count(*)::int AS n FROM prima.panel_firms, jsonb_array_elements(data->'invoices') i WHERE i->'ap' IS NOT NULL AND i->'ap' <> 'null'::jsonb`))).rows[0].n;
    assert.equal(linked, 1);
  });

  it('notices drift: a dropped wall or a widened panel grant fails the catalogue check', async () => {
    await withClient((c) => c.query(`DROP POLICY central_admin_wall ON prima.legal_matters`));
    await withClient((c) => c.query(`GRANT DELETE ON prima.panel_firms TO prima_app`));
    const p = await problems();
    assert.deepEqual(p.walls, ['WALLS_POLICY_MISSING:legal_matters']);
    assert.deepEqual(p.panel, ['PANEL_APP_CAN_DELETE']);
    await withClient((c) => c.query(`ALTER POLICY panel_firms_wall ON prima.panel_firms USING (true)`));
    assert.ok((await problems()).panel.includes('PANEL_POLICY_DRIFT'));
    await withClient((c) => c.query(`GRANT SELECT ON prima.panel_firms TO PUBLIC`));
    assert.ok((await problems()).panel.includes('PANEL_PUBLIC_GRANT'));
    await withClient((c) => c.query(`ALTER POLICY delegations_wall ON prima.delegations USING (true)`));
    await withClient((c) => c.query(`GRANT DELETE ON prima.delegations TO prima_app`));
    const d = (await problems()).delegations;
    assert.ok(d.includes('DELEGATIONS_WALL_DRIFT') && d.includes('DELEGATIONS_APP_CAN_DELETE'), JSON.stringify(d));
  });

  it('notices a legal-hold function body or trigger event that was changed while keeping the names (review round 5b)', async () => {
    assert.deepEqual((await problems()).holds, []);
    // Same name, same settings, not a definer: only the body is emptied.
    await withClient((c) =>
      c.query(
        `CREATE OR REPLACE FUNCTION prima.lh_preserve() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$ BEGIN IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$`,
      ),
    );
    assert.deepEqual((await problems()).holds, ['LEGAL_HOLD_TRIGGER_FUNCTION_CHANGED']);
    await install('central_admin_legal_holds');
    assert.deepEqual((await problems()).holds, []);
    // Same trigger name and function, but it no longer fires on DELETE (so a held record could be deleted).
    await withClient((c) => c.query(`DROP TRIGGER lh_preserve ON prima.cases; CREATE TRIGGER lh_preserve BEFORE UPDATE ON prima.cases FOR EACH ROW EXECUTE FUNCTION prima.lh_preserve()`));
    assert.deepEqual((await problems()).holds, ['LEGAL_HOLD_TRIGGER_EVENTS']);
    await withClient((c) => c.query(`DROP TRIGGER lh_preserve ON prima.people; CREATE TRIGGER lh_preserve AFTER UPDATE OR DELETE ON prima.people FOR EACH ROW EXECUTE FUNCTION prima.lh_preserve()`));
    assert.deepEqual((await problems()).holds, ['LEGAL_HOLD_TRIGGER_EVENTS']);
    await install('central_admin_legal_holds');
    assert.deepEqual((await problems()).holds, []);
  });
});
