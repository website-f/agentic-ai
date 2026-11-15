// Part P19-P39 on PostgreSQL (Fitri package, 14 Nov 2026): staff stays and short stays under the database walls. The
// applicant reads the homestay houses and only their own request; another department sees nothing; the occupant alone
// acknowledges damage and inserts only their own recovery; staff payroll reads recoveries; a company manager sees no
// short-stay records. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, SS_CHECKLIST } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-18', '10:00');
const PHOTO = (n: string) => 'data:image/jpeg;base64,' + Buffer.from(`photo-${n}`).toString('base64');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('P19-P39 short stays (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    for (const m of ['am-extras-v1', 'short-stays-v1']) await admin(readFileSync(resolve(__dirname, `../../../../db/modules/${m}.sql`), 'utf8'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('walls hold from request to consented recovery', async () => {
    const clock = { t: NOW };
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn as never, () => clock.t) as Promise<T>;
    const r = (await as('u-ogm', (svc, u) => svc.shortStays.request(u, { propertyId: 'am-p-hs1', checkIn: '2026-11-20', checkOut: '2026-11-21', persons: 1, purpose: 'Site audit', occupants: [{ userId: 'u-pwvsb-ops' }], work: true, priceSeen: 300 }))) as { id: string };
    // Another department and a company manager see nothing.
    assert.equal(((await as('u-pwvsb-hr', (svc) => svc.store.list('stayRequests', {}))) as unknown[]).length, 0);
    assert.equal(((await as('u-cm-sasa', (svc) => svc.store.list('amBookings', {}).catch(() => []))) as unknown[]).length, 0);
    // The applicant cannot write a booking or a request in someone else's name.
    await assert.rejects(as('u-ogm', (svc) => svc.store.insert('stayRequests', { id: 'x1', requesterId: 'u-cos', status: 'submitted' })), /row-level security|permission denied/);
    const c = (await as('u-asset-rx1', (svc, u) => svc.shortStays.requestCheck(u, r.id, { outcome: 'confirm' }))) as { bookingId: string };
    await as('u-asset-re1', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'prepare', ticks: [...SS_CHECKLIST], photos: [PHOTO('a'), PHOTO('b')] }));
    clock.t = myt('2026-11-20', '15:00');
    await as('u-asset-rx1', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'checkin', keys: 2, to: 'Penerima (mock)' }));
    clock.t = myt('2026-11-21', '11:00');
    await as('u-asset-rx1', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'checkout', keysBack: 2 }));
    await as('u-asset-rx1', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'after', ticks: [...SS_CHECKLIST], photos: [PHOTO('c'), PHOTO('d')], missing: ['Plates'] }));
    await as('u-asset-dir', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'damage', what: 'Two plates', amount: 16, reason: 'Broken by the occupant', photo: PHOTO('p'), staffUserId: 'u-pwvsb-ops' }));
    const req = (await as('u-pwvsb-ops', (svc) => svc.store.get('stayRequests', r.id))) as { damages: { id: string }[] };
    assert.equal(req.damages.length, 1);
    // Someone else cannot insert a recovery for the occupant; the occupant's own acknowledgement does.
    await assert.rejects(as('u-cms-head', (svc) => svc.store.insert('ssRecs', { id: 'rcv-x', kind: 'recovery', userId: 'u-pwvsb-ops', status: 'due' })), /row-level security|permission denied/);
    await as('u-pwvsb-ops', (svc, u) => svc.shortStays.acknowledge(u, r.id, { damageId: req.damages[0].id, consent: true }));
    const pid = (await admin(`SELECT data->>'personId' AS p FROM prima.users WHERE id = 'u-pwvsb-ops'`)).rows[0].p as string;
    const due = (await as('u-pwvsb-hr', (svc) => svc.shortStays.recoveriesDue(pid))) as unknown[];
    assert.equal(due.length, 1);
    assert.equal(((await as('u-cms-head', (svc) => svc.shortStays.recoveriesDue(pid))) as unknown[]).length, 0);
    // The team closes the stay once the acknowledgement is in.
    await as('u-asset-rx1', (svc, u) => svc.shortStays.step(u, c.bookingId, { step: 'close' }));
  });
});
