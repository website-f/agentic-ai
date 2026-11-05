// Section 240 through the real API service on PostgreSQL with the company wall on: two officers pressing at once, two
// closers racing, and what a company manager can and cannot read. The module SQL is applied to the throwaway local
// database only (it is not part of the release). Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const moduleSql = () => readFileSync(resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? '../../db/modules/fw-welfare-v1.sql' : 'db/modules/fw-welfare-v1.sql'), 'utf8');
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${Date.now()}`).toString('base64')}` });

describe('foreign worker welfare checks on PostgreSQL', () => {
  let db: Db;
  let worker: string;
  let today: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(moduleSql());
    worker = (await db.pool.query("SELECT id FROM prima.people WHERE company_id='co-sasa' AND data->>'nationality'='NP' AND data->>'status'<>'left' ORDER BY id LIMIT 1")).rows[0].id;
    today = (await db.asUser('u-fwm-ex1', async (svc) => svc.today()));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('two officers recording the arrival fee at once leave exactly one record', async () => {
    const r = await Promise.allSettled([
      db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwCheck(u, worker, { kind: 'ARRIVAL_FEE', checkedOn: today, agency: 'UAT Agency', paidAnything: false }, [])),
      db.asUser('u-fwm-ex2', (svc, u) => svc.recordFwCheck(u, worker, { kind: 'ARRIVAL_FEE', checkedOn: today, agency: 'UAT Agency', paidAnything: true, amount: 900, paidTo: 'UAT broker' }, [])),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    const rows = await db.pool.query("SELECT 1 FROM prima.fw_welfare_checks WHERE data->>'personId'=$1 AND data->>'kind'='ARRIVAL_FEE'", [worker]);
    assert.equal(rows.rowCount, 1);
  });

  it('two closers racing on one follow-up: one closes, the other is refused', async () => {
    const c = await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwCheck(u, worker, { kind: 'WELFARE', checkedOn: today, concerns: ['HEALTH'], note: 'UAT cough for two weeks' }, []));
    const r = await Promise.allSettled([
      db.asUser('u-fwm-ex2', (svc, u) => svc.closeFwCheck(u, c.id, { note: 'Taken to the clinic.' }, [])),
      db.asUser('u-fwm-mgr', (svc, u) => svc.closeFwCheck(u, c.id, { note: 'Seen by the doctor.' }, [])),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    const rejected = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(rejected.reason?.message), /not open/);
  });

  it('the Sasa company manager reads passport custody only; Inas reads nothing of Sasa', async () => {
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwCheck(u, worker, { kind: 'WELFARE', checkedOn: today, concerns: ['PAY'], note: 'UAT pay late twice' }, []));
    const pass = await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwCheck(u, worker, { kind: 'PASSPORT', checkedOn: today, heldBy: 'company' }, []));
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.fwmWelfare(u));
    const text = JSON.stringify(board);
    for (const secret of ['UAT pay late', 'UAT broker', 'UAT Agency', '"amount":900']) assert.ok(!text.includes(secret), secret);
    assert.deepEqual(board.open.map((o) => o.check.id), [pass.id]);
    const seen = (await db.asUser('u-cm-sasa', (svc, u) => svc.auditLog(u))).entries.filter((e) => e.action.startsWith('fwm.check'));
    assert.ok(seen.every((e) => e.action === 'fwm.check.passport'), JSON.stringify(seen.map((e) => e.action)));
    const inas = await db.asUser('u-cm-inas', (svc, u) => svc.fwmWelfare(u));
    assert.ok(!inas.workers.some((w) => w.person.id === worker));
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.closeFwCheck(u, pass.id, { note: 'Given back to the worker.', custody: 'worker' }, [pdf('r.pdf')])));
    // The FWM Manager closes it with the signed receipt; the company manager then sees it closed.
    await db.asUser('u-fwm-mgr', (svc, u) => svc.closeFwCheck(u, pass.id, { note: 'Given back to the worker.', custody: 'worker' }, [pdf('receipt.pdf')]));
    const after = await db.asUser('u-cm-sasa', (svc, u) => svc.fwmWelfare(u));
    assert.equal(after.open.length, 0);
    assert.equal(after.workers.find((w) => w.person.id === worker)?.passportHolder, 'worker');
    assert.equal(after.closed.length, 0);
    const lead = await db.asUser('u-fwm-mgr', (svc, u) => svc.fwmWelfare(u));
    assert.ok(lead.closed.some((x) => x.check.id === pass.id && x.check.custodyAfter === 'worker'));
  });
});
