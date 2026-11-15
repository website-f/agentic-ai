// Speak-up reports database wall (Fitri package H2, Fauzan 11 Nov 2026: "Yes. But HR can see it.") on a real local
// PostgreSQL. Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const modulePath = (name: string) => resolve(__dirname, `../../../../db/modules/${name}.sql`);

describe('speak-up reports wall on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  const report = (uid: string, anonymous: boolean, implicated: string[] = []) =>
    db.asUser(uid, (svc, u) => svc.submitWhistle(u, { anonymous, companyId: null, category: 'MISCONDUCT', summary: 'A synthetic report: cash asked for better shifts at a sample site.', implicatedUserIds: implicated }));
  const idOf = async (code: string) => (await owner.query("SELECT id FROM prima.whistle_reports WHERE data->>'code' = $1", [code])).rows[0].id as string;
  const visible = (uid: string) => db.asUser(uid, async (_svc, _u, store) => (await store.list('whistleReports', {})).map((r) => r.code));
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('walls the reports: handler, reviewer, own reports, HR not named; receipt code only for the anonymous', async () => {
    const before = await report('u-it-ex3', false);
    const sql = readFileSync(modulePath('speak-up-wall-v1'), 'utf8');
    await owner.query(sql);
    await owner.query(sql); // repeat-safe
    const named = await report('u-it-ex2', false);
    const anon = await report('u-it-ex1', true, ['u-pwvsb-hr']);
    // Numbers keep counting after the reports already there.
    assert.ok(Number(named.code.split('-')[1]) > Number(before.code.split('-')[1]));
    const guard = (await owner.query("SELECT id FROM prima.users WHERE data->>'role' = 'guard' LIMIT 1")).rows[0]?.id as string | undefined;
    for (const uid of ['u-cm-sasa', ...(guard ? [guard] : [])]) assert.deepEqual(await visible(uid), [], `${uid} reads no reports`);
    // A read-only database role reads nothing even with a forged session.
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_test_reader') THEN CREATE ROLE prima_test_reader NOLOGIN; END IF; END $$`);
    await owner.query('GRANT USAGE ON SCHEMA prima TO prima_test_reader');
    await owner.query('GRANT SELECT ON prima.whistle_reports TO prima_test_reader');
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL ROLE prima_test_reader');
      await owner.query(`SELECT set_config('app.user_id', 'u-audit', true), set_config('app.walls', 'speak_up_hr', true)`);
      assert.equal((await owner.query('SELECT * FROM prima.whistle_reports')).rowCount, 0);
    } finally {
      await owner.query('ROLLBACK');
    }
    // The handler reads their reports; another handler does not until one is closing.
    assert.ok((await visible('u-audit')).includes(named.code));
    assert.ok(!(await visible('u-chair')).includes(named.code));
    // A named reporter reads only their own report; the anonymous reporter reads none by listing.
    assert.deepEqual(await visible('u-it-ex2'), [named.code]);
    assert.deepEqual(await visible('u-it-ex1'), []);
    // HR reads them, never one where they are named; HR cannot change one.
    const hr = await visible('u-pwvsb-hr');
    assert.ok(hr.includes(named.code) && !hr.includes(anon.code));
    const hrBoard = await db.asUser('u-pwvsb-hr', (svc, u) => svc.grcBoard(u));
    assert.ok(hrBoard.hrReads.some((r) => r.code === named.code) && !hrBoard.hrReads.some((r) => r.code === anon.code));
    const namedId = await idOf(named.code);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.whistleStep(u, namedId, 'note', 'HR tries to write')), /not found/i);
    // Receipt code: status and messages only; a wrong code gets nothing.
    const s = await db.asUser('u-it-ex1', (svc) => svc.whistleStatus(anon.code));
    assert.equal(s.status, 'received');
    assert.ok(!('summary' in (s as object)) && !('reporterId' in (s as object)));
    await assert.rejects(db.asUser('u-it-ex1', (svc) => svc.whistleStatus('SU-9999-ZZZ')), /not found/i);
    // Eight replies at once through the receipt code are all kept.
    const texts = Array.from({ length: 8 }, (_, i) => `Synthetic anonymous reply number ${i + 1}.`);
    await Promise.all(texts.map((t) => db.asUser('u-it-ex1', (svc, u) => svc.whistleReply(u, anon.code, t, false))));
    const kept = ((await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [await idOf(anon.code)])).rows[0].data.messages as { text: string }[]).map((m) => m.text);
    for (const t of texts) assert.ok(kept.includes(t), `lost: ${t}`);
    // Leaders get counts, not text.
    const ceo = await db.asUser('u-fauzan', (svc, u) => svc.grcBoard(u));
    assert.ok(ceo.whistleStats && ceo.whistleStats.open >= 3);
    assert.ok(!ceo.handled.some((h) => h.report.code === named.code));
    // The handler proposes an outcome; a second handler reviews and closes it, and the reporter sees the outcome.
    await db.asUser('u-audit', (svc, u) => svc.whistleStep(u, namedId, 'close', 'Synthetic outcome: warning issued.'));
    assert.ok((await visible('u-chair')).includes(named.code));
    const closed = await db.asUser('u-chair', (svc, u) => svc.whistleReview(u, namedId, true, 'Agree, evidence is on file'));
    assert.equal(closed.status, 'closed');
    const mine = await db.asUser('u-it-ex2', (svc, u) => svc.grcBoard(u));
    assert.equal(mine.mine.find((m) => m.code === named.code)?.outcome, 'Synthetic outcome: warning issued.');
  });
});
