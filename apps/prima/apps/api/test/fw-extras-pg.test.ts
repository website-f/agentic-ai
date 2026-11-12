// E8 Foreign workers (Fauzan, 11 Nov 2026) through the real store as the runtime role: a check-in and a check-out memo
// on the existing hostel_stays table under the company wall, the FWM Manager's approval, and the wrong role refused.
// Throwaway local database, reset. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, addDays, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const paper = (n: number) => ({ kind: 'document' as const, name: `Memo ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 fw-pg ${n}`).toString('base64')}` });

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('E8 hostel stays and check-out memo (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('checks in, memos and approves through the real store; the wrong role and another company are refused', async () => {
    const board = await db.asUser('u-fwm-ex1', (svc, u) => svc.fwExtras.staysBoard(u), at(NOW));
    const h = board.hostels.find((x) => x.candidates.length > 0)!;
    const stay = (await db.asUser('u-fwm-ex1', (svc, u) => svc.fwExtras.act(u, 'check_in', { hostelId: h.hostel.id, personId: h.candidates[0].id, from: TODAY }), at(NOW))) as { id: string };
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.fwExtras.act(u, 'check_in', { hostelId: h.hostel.id, personId: h.candidates[1]?.id ?? h.candidates[0].id, from: TODAY }), at(NOW)), /not found|Not allowed|different/i);
    const memo = { stayId: stay.id, outOn: addDays(TODAY, 2), reason: 'LEFT_COMPANY', keyReturned: true, beddingReturned: true, lockerCleared: true, roomOk: true, damage: '', owedNote: '', workerAck: 'SIGNED', proof: [paper(1)] };
    await db.asUser('u-fwm-ex1', (svc, u) => svc.fwExtras.act(u, 'memo', memo), at(NOW));
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.fwExtras.act(u, 'memo_decide', { stayId: stay.id, approve: true, note: 'Mine' }), at(NOW)), (e) => e instanceof AccessDenied);
    await db.asUser('u-fwm-mgr', (svc, u) => svc.fwExtras.act(u, 'memo_decide', { stayId: stay.id, approve: true, note: 'Signed copy seen' }), at(NOW));
    const row = await admin(`SELECT data FROM prima.hostel_stays WHERE id = $1`, [stay.id]);
    assert.equal(row.rows[0].data.to, addDays(TODAY, 2));
    assert.equal(row.rows[0].data.checkout.decided.approve, true);
  });
});
