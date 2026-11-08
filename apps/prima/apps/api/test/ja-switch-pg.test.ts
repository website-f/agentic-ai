// Switch-over from JA on a real local PostgreSQL: the records sit behind the company wall, and a whole switch runs
// through the database store (locks, transactions, audit chain). Synthetic data only; the database is reset.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';
import { addDays, dateOf } from '@prima/core';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function asApp(companyIds: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companyIds]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } finally {
    await c.end();
  }
}

describe('switch-over from JA on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('runs one area from side by side to switched and back, with records behind the company wall', async () => {
    const today = dateOf(nowMyt());
    const from = addDays(today, -35);
    const to = addDays(from, 29);
    await db.asUser('u-coo', (svc, u) => svc.jaSwitchAct(u, 'co-arsh', 'incidents', 'start', { from, note: 'PG pilot' }));
    const staged = await db.asUser('u-act-aud1', (svc, u) =>
      svc.jaImportStage(u, {
        companyId: 'co-arsh',
        kind: 'incidents',
        from,
        to,
        fileName: 'arsh.csv',
        rows: [{ externalId: 'PG-1', occurredAt: `${addDays(from, 2)}T03:00:00+08:00`, siteCode: 'NOSITE', category: 'Theft', severity: 'P2', status: 'closed', summary: 'Synthetic' }],
      }),
    );
    await assert.rejects(
      db.asUser('u-act-aud1', (svc, u) => svc.jaImportDecide(u, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'Checked' })),
      /Not allowed/,
    );
    await db.asUser('u-audit', (svc, u) => svc.jaImportDecide(u, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'Checked' }));
    let r = await db.asUser('u-audit', (svc, u) => svc.jaSwitchReport(u, 'co-arsh', 'incidents'));
    assert.deepEqual(r.comparison!.jaMissingDays, []);
    const keys = r.comparison!.differences.map((d) => d.key);
    assert.ok(keys.includes('incidents:PG-1'));
    for (const key of keys)
      await db.asUser('u-coo', (svc, u) => svc.jaSwitchAct(u, 'co-arsh', 'incidents', 'explain', { key, kind: 'explained', note: 'Synthetic difference explained' }));
    r = await db.asUser('u-audit', (svc, u) => svc.jaSwitchReport(u, 'co-arsh', 'incidents'));
    await db.asUser('u-audit', (svc, u) => svc.jaSwitchAct(u, 'co-arsh', 'incidents', 'check', { reportHash: r.reportHash, note: 'Checked on PG' }));
    const done = await db.asUser('u-fauzan', (svc, u) => svc.jaSwitchAct(u, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'Synthetic switch on PG' }));
    assert.equal(done.state, 'prima');

    // The wall: Sasa's sign-in cannot read Arrow Shield's switch or history rows, Arrow Shield's can.
    const sasa = await asApp('co-sasa', `SELECT id FROM prima.ja_records WHERE id LIKE 'ja:switch:co-arsh:%' OR id LIKE 'ja:hist:incidents:co-arsh:%'`);
    assert.equal(sasa.rowCount, 0);
    const arsh = await asApp('co-arsh', `SELECT id FROM prima.ja_records WHERE id LIKE 'ja:switch:co-arsh:%' OR id LIKE 'ja:hist:incidents:co-arsh:%'`);
    assert.equal(arsh.rowCount, 2);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.jaSwitchReport(u, 'co-arsh', 'incidents')), /Not allowed/);

    const back = await db.asUser('u-fauzan', (svc, u) => svc.jaSwitchAct(u, 'co-arsh', 'incidents', 'undo', { reason: 'Synthetic undo on PG' }));
    assert.equal(back.state, 'ja');
    const audit = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.action.startsWith('ja.')));
    assert.deepEqual(
      audit.map((a) => a.action).filter((a) => a !== 'ja.ingest'),
      ['ja.switch.start', 'ja.import.stage', 'ja.import.approve', ...keys.map(() => 'ja.switch.explain'), 'ja.switch.check', 'ja.switch.switch', 'ja.switch.undo'],
    );
  });

  it('keeps the numbers the ACT Director sets on the database; the COO reads them, a company sign-in does not', async () => {
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.jaSwitchSettings(u, { values: { sideBySideDays: 14 }, reason: 'Shorter pilot please' })), /Not allowed/);
    await db.asUser('u-audit', (svc, u) => svc.jaSwitchSettings(u, { values: { sideBySideDays: 14 }, reason: 'Two weeks for the PG test' }));
    await db.asUser('u-audit', (svc, u) => svc.jaSwitchSettings(u, { values: { incidentMatchMin: 45 }, reason: 'Second change on the PG test' }));
    const lead = await db.asUser('u-audit', (svc, u) => svc.jaSwitchBoard(u));
    assert.equal(lead.settings.sideBySideDays, 14);
    assert.equal(lead.settings.incidentMatchMin, 45);
    assert.equal(lead.settingsHistory.length, 2);
    const coo = await db.asUser('u-coo', (svc, u) => svc.jaSwitchBoard(u));
    assert.equal(coo.settings.sideBySideDays, 14);
    assert.equal(coo.canSetSettings, false);
    const cm = await db.asUser('u-cm-sasa', (svc, u) => svc.jaSwitchBoard(u));
    assert.equal(cm.settingsShown, false);
    // The group record itself stays behind the company wall for a company sign-in.
    const hidden = await asApp('co-sasa', `SELECT id FROM prima.ja_records WHERE id = 'ja:settings'`);
    assert.equal(hidden.rowCount, 0);
  });

  it('keeps a newer copy of a JA feed record on the database (an update never carries the id or company)', async () => {
    const send = (updatedAt: string, severity: string) =>
      db.asUser('u-ja-sync', (svc, u) =>
        svc.jaIngest(
          u,
          'incident',
          [{ externalId: 'PG-FEED-1', company: 'ARSH', updatedAt, occurredAt: '2026-10-01T03:00:00+08:00', category: 'Theft', severity, status: 'open', summary: 'Synthetic' }],
          [],
        ),
      );
    assert.deepEqual(await send('2026-10-01T04:00:00+08:00', 'P3'), { accepted: 1, rejected: [] });
    assert.deepEqual(await send('2026-10-01T05:00:00+08:00', 'P2'), { accepted: 1, rejected: [] });
    const row = await asApp('co-arsh', `SELECT data FROM prima.ja_records WHERE id = 'ja:incident:co-arsh:PG-FEED-1'`);
    assert.equal(row.rows[0].data.incident.severity, 'P2');
    assert.equal(row.rows[0].data.companyId, 'co-arsh');
  });
});
