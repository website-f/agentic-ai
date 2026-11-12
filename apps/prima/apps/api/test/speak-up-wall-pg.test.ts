// H2 (Fauzan, 11 Nov 2026: build the wall, add it to the release list and install it; "Yes. But HR can see it"): the
// speak-up reports table behind its own database wall (db/modules/speak-up-wall-v1.sql), proved on a real local
// PostgreSQL. A guard, a company manager and a read-only account read 0 reports; the handler reads their own; another
// handler only while it is closing; a named reporter only their own; HR reads them, read only, but never one naming
// them; an anonymous reporter comes back by receipt code only; leaders and ACT get counts, never text; numbers come
// from a database sequence; 8 replies sent at once are all kept. Synthetic data only; the test resets the database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import type { WhistleReport } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/speak-up-wall-v1.sql'), 'utf8');
const REPORTER = 'u-it-ex3';
const HR = 'u-pwvsb-hr';
const CM = 'u-cm-sasa';
const LEADER = 'u-coo';

describe('speak-up reports behind the database wall (PostgreSQL)', () => {
  let db: Db;
  let owner: Client;
  let guard: string;
  let anon: { code: string; id: string };
  let named: { code: string; id: string };
  let namesHr: { code: string; id: string };
  const idOf = async (code: string) => (await owner.query("SELECT id FROM prima.whistle_reports WHERE data->>'code' = $1", [code])).rows[0].id as string;
  const rowsAs = (uid: string) => db.asUser(uid, async (_svc, _u, store) => (await store.list('whistleReports', {})).map((r) => r.id));
  const report = (uid: string, input: { anonymous: boolean; implicatedUserIds?: string[]; summary?: string }) =>
    db.asUser(uid, (svc, u) =>
      svc.submitWhistle(u, {
        anonymous: input.anonymous,
        companyId: null,
        category: 'MISCONDUCT',
        summary: input.summary ?? 'A synthetic report: cash asked for better shifts at a site, twice last month.',
        implicatedUserIds: input.implicatedUserIds ?? [],
      }),
    );

  before(async () => {
    await resetDb(URL);
    owner = new Client({ connectionString: URL });
    await owner.connect();
    await owner.query(SQL);
    await owner.query(SQL); // repeat-safe: the office's prima-setup runs it on every start
    db = new Db();
    guard = (await owner.query("SELECT id FROM prima.users WHERE data->>'role' = 'guard' ORDER BY id LIMIT 1")).rows[0].id as string;
    const a = await report(REPORTER, { anonymous: true });
    anon = { code: a.code, id: await idOf(a.code) };
    const n = await report(REPORTER, { anonymous: false, summary: 'A synthetic named report: overtime sheets changed after signing.' });
    named = { code: n.code, id: await idOf(n.code) };
    const h = await report('u-ae-arsh', { anonymous: false, implicatedUserIds: [HR], summary: 'A synthetic report naming the HR officer in a leave dispute.' });
    namesHr = { code: h.code, id: await idOf(h.code) };
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('installs forced row-level security, rules for the API role only, and a sequence for numbers', async () => {
    const c = await owner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'prima.whistle_reports'::regclass`);
    assert.deepEqual(c.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
    const p = await owner.query(`SELECT policyname, roles::text AS roles FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'whistle_reports' AND policyname <> 'su_owner' ORDER BY 1`);
    assert.deepEqual(p.rows, [
      { policyname: 'su_insert', roles: '{prima_app}' },
      { policyname: 'su_read', roles: '{prima_app}' },
      { policyname: 'su_update', roles: '{prima_app}' },
    ]);
    // The seed holds SU-0001.. ; new reports continue after the highest number, from the sequence, with a random ending.
    const seeded = Number((await owner.query("SELECT max(substring(data->>'code' from 4 for 4)::int) AS n FROM prima.whistle_reports WHERE data->>'code' ~ '^SU-[0-9]{4}-[A-Z0-9]{3}$'")).rows[0].n);
    assert.match(anon.code, /^SU-\d{4}-[A-Z2-9]{8}$/);
    assert.equal(Number(anon.code.slice(3, 7)), seeded + 1);
    assert.equal(Number(namesHr.code.slice(3, 7)), seeded + 3);
    // Anonymous means anonymous in the database: no reporter id or name can be stored on an anonymous report.
    const stored = (await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [anon.id])).rows[0].data as WhistleReport;
    assert.equal(stored.reporterId, null);
    await assert.rejects(owner.query(`UPDATE prima.whistle_reports SET data = data || '{"reporterId":"u-it-ex3"}' WHERE id = $1`, [anon.id]), /su_anonymous/);
  });

  it('a guard, a company manager and a read-only account read 0 reports', async () => {
    assert.deepEqual(await rowsAs(guard), []);
    assert.deepEqual(await rowsAs(CM), []);
    // A view-only office account (the company secretary) reads none either.
    assert.deepEqual(await rowsAs('u-cosec'), []);
    // A database account given SELECT for reporting, even with a forged office session, has no rule at all.
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_test_reader') THEN CREATE ROLE prima_test_reader NOLOGIN; END IF; END $$`);
    await owner.query('GRANT USAGE ON SCHEMA prima TO prima_test_reader');
    await owner.query('GRANT SELECT ON prima.whistle_reports TO prima_test_reader');
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL ROLE prima_test_reader');
      await owner.query(`SELECT set_config('app.user_id', 'u-audit', true), set_config('app.user_role', 'pwvsb_officer', true), set_config('app.walls', 'speak_up_hr,speak_up_handler', true)`);
      assert.equal((await owner.query('SELECT * FROM prima.whistle_reports')).rowCount, 0);
      await assert.rejects(owner.query(`SELECT prima.speak_up_status($1)`, [anon.code]), /permission denied/);
    } finally {
      await owner.query('ROLLBACK');
    }
    // The API role with an empty session (no sign-in) reads nothing and cannot open a code.
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL ROLE prima_app');
      assert.equal((await owner.query('SELECT * FROM prima.whistle_reports')).rowCount, 0);
      assert.equal((await owner.query('SELECT prima.speak_up_status($1) AS r', [anon.code])).rows[0].r, null);
    } finally {
      await owner.query('ROLLBACK');
    }
    // Nobody but the API role can call the functions or take a number.
    const g = await owner.query(`SELECT has_function_privilege('public', 'prima.speak_up_reply(text,text,boolean,text,date,integer)', 'EXECUTE') AS f,
      has_sequence_privilege('prima_test_reader', 'prima.speak_up_number_seq', 'USAGE') AS s`);
    assert.deepEqual(g.rows[0], { f: false, s: false });
  });

  it('the handler reads their own report; another handler only while it is closing; a named reporter only their own', async () => {
    const handler = (await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [anon.id])).rows[0].data as WhistleReport;
    assert.equal(handler.handlerId, 'u-audit');
    assert.ok((await rowsAs('u-audit')).includes(anon.id));
    assert.ok(!(await rowsAs('u-chair')).includes(anon.id));
    // The reporter of the named report reads it, never the anonymous one they also sent (it does not carry their id).
    const mine = await rowsAs(REPORTER);
    assert.ok(mine.includes(named.id));
    assert.ok(!mine.includes(anon.id));
    assert.ok(!mine.includes(namesHr.id));
    // Another handler cannot change a report that is not theirs.
    await assert.rejects(db.asUser('u-chair', (svc, u) => svc.whistleMessage(u, anon.id, 'Synthetic: a message from the wrong handler.')), /not found/i);
    // The handler proposes an outcome; now the second handler reads and reviews it.
    await db.asUser('u-audit', (svc, u) => svc.whistleStep(u, anon.id, 'close', 'Synthetic: supervisor warned and moved.'));
    assert.ok((await rowsAs('u-chair')).includes(anon.id));
    const g = await db.asUser('u-chair', (svc, u) => svc.grcBoard(u));
    assert.ok(g.toReview.some((t) => t.report.id === anon.id));
    await db.asUser('u-chair', (svc, u) => svc.whistleReview(u, anon.id, false, 'Synthetic: ask the site supervisor too.'));
    assert.equal(((await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [anon.id])).rows[0].data as WhistleReport).status, 'investigating');
    // HR cannot change a report, even one it reads.
    await assert.rejects(db.asUser(HR, (svc, u) => svc.whistleStep(u, named.id, 'note', 'Synthetic HR note')), /not found/i);
    await assert.rejects(db.asUser(HR, (_svc, _u, store) => store.update('whistleReports', named.id, { status: 'closed' })), /Not found/);
  });

  it('HR reads reports, read only, but never one where they are named', async () => {
    const seen = await rowsAs(HR);
    assert.ok(seen.includes(anon.id) && seen.includes(named.id));
    assert.ok(!seen.includes(namesHr.id), 'a report naming the HR officer stays hidden from them');
    const g = await db.asUser(HR, (svc, u) => svc.grcBoard(u));
    assert.ok(g.hrReports);
    const a = g.hrReports.find((r) => r.id === anon.id);
    assert.ok(a);
    assert.equal(a.anonymous, true);
    assert.equal(a.reporterName, null);
    assert.ok(!g.hrReports.some((r) => r.id === namesHr.id));
    // Someone outside HR gets no HR list.
    assert.equal((await db.asUser(CM, (svc, u) => svc.grcBoard(u))).hrReports, null);
  });

  it('a receipt code opens status and messages of that one report and adds a reply; a wrong code opens nothing', async () => {
    await db.asUser('u-audit', (svc, u) => svc.whistleMessage(u, anon.id, 'Synthetic: which site, and roughly when?'));
    // Anyone holding the code (here a guard's sign-in) reads where it stands, never the report itself.
    const st = await db.asUser(guard, (svc) => svc.whistleStatus(anon.code));
    assert.equal(st.code, anon.code);
    assert.equal(st.status, 'investigating');
    assert.equal(st.messages.at(-1)?.text, 'Synthetic: which site, and roughly when?');
    for (const k of ['summary', 'notes', 'handlerId', 'implicatedUserIds', 'reporterId', 'companyId']) assert.ok(!(k in st), `${k} must not reach a code holder`);
    const raw = await db.asUser(guard, async (_svc, _u, store) => store.speakUpStatus!(anon.code));
    assert.deepEqual(Object.keys(raw ?? {}).sort(), ['at', 'closedAt', 'code', 'messages', 'outcome', 'status']);
    await assert.rejects(db.asUser(guard, (svc) => svc.whistleStatus('SU-9999-AAAAAAAA')), /not found/i);
    await assert.rejects(db.asUser(guard, (svc, u) => svc.whistleReply(u, 'SU-9999-AAAAAAAA', 'Synthetic reply to nothing.', false)), /not found/i);
    await db.asUser(REPORTER, (svc, u) => svc.whistleReply(u, anon.code, 'Synthetic: Port Klang, early October.', false));
    const g = await db.asUser('u-audit', (svc, u) => svc.grcBoard(u));
    assert.equal(g.handled.find((h) => h.report.id === anon.id)?.replyWaiting, true);
    // The audit trail never carries what was written.
    const audit = await owner.query("SELECT summary FROM prima.audit_log WHERE entity_id = $1", [anon.id]).catch(() => null);
    if (audit) for (const r of audit.rows) assert.ok(!/Port Klang/.test(String(r.summary)));
  });

  it('8 replies sent at the same moment through the receipt code are all kept', async () => {
    const before = ((await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [anon.id])).rows[0].data as WhistleReport).messages ?? [];
    const replies = Array.from({ length: 8 }, (_, i) => `Synthetic reporter reply at once number ${i + 1}.`);
    await Promise.all(replies.map((t) => db.asUser(REPORTER, (svc, u) => svc.whistleReply(u, anon.code, t, false))));
    const after = ((await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [anon.id])).rows[0].data as WhistleReport).messages ?? [];
    const texts = after.map((m) => m.text);
    for (const t of replies) assert.ok(texts.includes(t), `lost: ${t}`);
    assert.equal(after.length, before.length + 8);
  });

  it('retaliation reopens a closed report through the code; a closed report takes no ordinary reply', async () => {
    await db.asUser('u-audit', (svc, u) => svc.whistleStep(u, named.id, 'close', 'Synthetic: sheets corrected and staff briefed.'));
    await db.asUser('u-chair', (svc, u) => svc.whistleReview(u, named.id, true, 'Agreed, synthetic proof on file'));
    await assert.rejects(db.asUser(REPORTER, (svc, u) => svc.whistleReply(u, named.code, 'Synthetic: one more thing to add.', false)), /closed/);
    await db.asUser(REPORTER, (svc, u) => svc.whistleReply(u, named.code, 'Synthetic: my shifts were cut after I reported.', true));
    const r = (await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [named.id])).rows[0].data as WhistleReport;
    assert.equal(r.status, 'investigating');
    assert.ok(r.notes.some((n) => n.text === 'Reopened: the reporter reported retaliation.'));
  });

  it('leaders and ACT get counts, never the text', async () => {
    // A leader who handles nothing reads no report rows at all.
    assert.deepEqual(await rowsAs(LEADER), []);
    const g = await db.asUser(LEADER, (svc, u) => svc.grcBoard(u));
    assert.ok(g.whistleStats);
    const total = Number((await owner.query("SELECT count(*) AS n FROM prima.whistle_reports WHERE data->>'status' <> 'closed'")).rows[0].n);
    assert.equal(g.whistleStats.open, total);
    assert.ok(g.whistleStats.retaliation >= 1);
    const sig = await db.asUser(LEADER, async (_svc, _u, store) => store.speakUpSignals!());
    const text = JSON.stringify(sig);
    for (const leak of ['Synthetic', 'cash asked', 'u-it-ex3', 'summary', 'handlerId', 'companyId', 'text']) assert.ok(!text.includes(leak), `counts carry no ${leak}`);
    // Without the counts wall the function gives nothing.
    assert.deepEqual(await db.asUser(CM, async (_svc, _u, store) => store.speakUpSignals!()), []);
    assert.equal((await db.asUser(CM, (svc, u) => svc.grcBoard(u))).whistleStats, null);
  });
});
