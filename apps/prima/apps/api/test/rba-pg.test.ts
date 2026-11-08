// RBA readiness against a real local PostgreSQL (Fauzan, 8 Nov 2026, "Yes" to the RBA build order): the new tables
// (proposed module rba-readiness-v1, on top of client-codes-v1) sit behind the company wall; ACT runs the trace review,
// the Chief of Staff names the committee, staff sign the ethics declaration, and speak-up messages keep the reporter
// anonymous. Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { ETHICS_STATEMENTS, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const modulePath = (name: string) => resolve(__dirname, `../../../../db/modules/${name}.sql`);

describe('RBA readiness on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    // Before the module is installed: the screens say so in words and homes still open.
    await assert.rejects(db.asUser('u-it-ex3', (svc, u) => svc.ethicsBoard(u)), /not installed/);
    const cos = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cos'")).rows[0].data as User;
    await db.asUser('u-cos', (svc, u) => svc.home(u, cos.companyIds[0]));
    for (const m of ['client-codes-v1', 'rba-readiness-v1']) {
      const sql = readFileSync(modulePath(m), 'utf8');
      await owner.query(sql);
      await owner.query(sql); // repeat-safe
    }
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('staff sign the yearly ethics declaration once; ACT reviews declared interests', async () => {
    const d = await db.asUser('u-it-ex3', (svc, u) =>
      svc.signEthicsDeclaration(u, { statements: ETHICS_STATEMENTS.map((s) => s.key), interests: 'My cousin works at a synthetic supplier' }),
    );
    const row = await owner.query('SELECT company_id FROM prima.ethics_declarations WHERE id = $1', [d.id]);
    assert.equal(row.rowCount, 1);
    await assert.rejects(db.asUser('u-it-ex3', (svc, u) => svc.signEthicsDeclaration(u, { statements: ETHICS_STATEMENTS.map((s) => s.key), interestsNone: true })), /already signed/);
    const reviewed = await db.asUser('u-audit', (svc, u) => svc.reviewEthicsInterests(u, d.id, { action: 'managed', note: 'Kept out of that supplier quote (synthetic)' }));
    assert.equal(reviewed.review?.action, 'managed');
    const mine = await db.asUser('u-it-ex3', (svc, u) => svc.ethicsBoard(u));
    assert.ok(mine.mine);
  });

  it('the Chief of Staff names the committee on PWVSB record; nobody else can', async () => {
    await assert.rejects(db.asUser('u-audit', (svc, u) => svc.nameRbaCommittee(u, { memberUserIds: ['u-opsdir', 'u-cm-sasa'] })));
    const c = await db.asUser('u-cos', (svc, u) => svc.nameRbaCommittee(u, { memberUserIds: ['u-opsdir', 'u-cm-sasa'], note: 'synthetic' }));
    const row = await owner.query('SELECT company_id FROM prima.rba_committees WHERE id = $1', [c.id]);
    assert.equal(row.rows[0].company_id, 'pwvsb');
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.rbaBoard(u));
    assert.equal(b.committee.current?.id, c.id);
    // The Operations Director reads every company's readiness through the database wall.
    const cm = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cm-arsh'")).rows[0].data as User;
    const od = await db.asUser('u-opsdir', (svc, u) => svc.rbaBoard(u, cm.companyIds[0]));
    assert.equal(od.companyId, cm.companyIds[0]);
    assert.equal(od.dashboard.length, 9);
    // A company head on the committee still reads only their own company.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.rbaBoard(u, cm.companyIds[0])));
  });

  it('ACT runs and settles a trace review; another company cannot read it', async () => {
    const cm = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cm-sasa'")).rows[0].data as User;
    const companyId = cm.companyIds[0];
    const today = await db.asUser('u-audit', (svc) => Promise.resolve(svc.today()));
    const period = today.slice(0, 7);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.runRbaTrace(u, companyId, period)));
    const t = await db.asUser('u-audit', (svc, u) => svc.runRbaTrace(u, companyId, period));
    assert.ok(t.rows.length > 0 && t.rows.length <= 20);
    const row = await owner.query('SELECT company_id FROM prima.rba_trace_reviews WHERE id = $1', [t.id]);
    assert.equal(row.rows[0].company_id, companyId);
    const bad = t.rows.find((r) => r.mismatches.length);
    if (bad) {
      const s = await db.asUser('u-audit', (svc, u) => svc.settleRbaTraceRow(u, t.id, bad.personId, { kind: 'finding', note: 'Clock and roster disagree, to correct (synthetic)' }));
      assert.equal(s.rows.find((r) => r.personId === bad.personId)?.outcome?.kind, 'finding');
    }
    const seen = await db.asUser('u-cm-sasa', (svc, u) => svc.rbaTraceBoard(u, companyId));
    assert.equal(seen.reviews.length, 1);
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.rbaTraceBoard(u, companyId)));
  });

  it('worker files and the dashboard open for FWM and the company; the OM has none', async () => {
    const cm = (await owner.query("SELECT data FROM prima.users WHERE id = 'u-cm-sasa'")).rows[0].data as User;
    const companyId = cm.companyIds[0];
    const f = await db.asUser('u-fwm-mgr', (svc, u) => svc.workerFiles(u, companyId));
    assert.equal(f.contractsMissing, null);
    assert.equal(f.folders.length, 9);
    const c = await db.asUser('u-cm-sasa', (svc, u) => svc.workerFiles(u, companyId));
    assert.ok(Array.isArray(c.contractsMissing));
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.workerFiles(u, companyId)));
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.rbaBoard(u, companyId));
    assert.equal(b.dashboard.length, 9);
    assert.ok(b.dashboard.every((k) => k.state !== 'green' || k.value !== null));
  });

  it('speak-up: the handler and an anonymous reporter talk by receipt code; retaliation reopens a closed report', async () => {
    const { code } = await db.asUser('u-it-ex3', (svc, u) =>
      svc.submitWhistle(u, { anonymous: true, companyId: null, category: 'MISCONDUCT', summary: 'A synthetic report: cash asked for better shifts at a site.', implicatedUserIds: [] }),
    );
    const id = (await owner.query("SELECT id FROM prima.whistle_reports WHERE data->>'code' = $1", [code])).rows[0].id as string;
    await db.asUser('u-audit', (svc, u) => svc.whistleMessage(u, id, 'Which site, and roughly when? (synthetic)'));
    await db.asUser('u-it-ex3', (svc, u) => svc.whistleReply(u, code, 'Port Klang, early October (synthetic).', false));
    const g = await db.asUser('u-audit', (svc, u) => svc.grcBoard(u));
    assert.equal(g.handled.find((h) => h.report.id === id)?.replyWaiting, true);
    await db.asUser('u-audit', (svc, u) => svc.whistleStep(u, id, 'close', 'Supervisor warned and moved (synthetic).'));
    await db.asUser('u-chair', (svc, u) => svc.whistleReview(u, id, true, 'Agreed, proof on file'));
    await db.asUser('u-it-ex3', (svc, u) => svc.whistleReply(u, code, 'My shifts were cut after I reported (synthetic).', true));
    const st = await db.asUser('u-it-ex3', (svc) => svc.whistleStatus(code));
    assert.equal(st.status, 'investigating');
    assert.equal(st.messages.length, 3);
    const stored = (await owner.query('SELECT data FROM prima.whistle_reports WHERE id = $1', [id])).rows[0].data as { reporterId: string | null };
    assert.equal(stored.reporterId, null);
    const audit = await owner.query("SELECT actor, summary FROM prima.audit_log WHERE entity_id = $1 AND action LIKE 'grc.whistle.%'", [id]).catch(() => null);
    if (audit) for (const r of audit.rows) assert.ok(!/shifts were cut|Port Klang/.test(String(r.summary)));
  });
});
