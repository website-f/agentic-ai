// Asset Management extras (Fauzan, 5 Nov 2026, rule AM-EXTRAS) against a real local PostgreSQL: before the optional
// module is applied nothing is read and every save is refused; after it, the team works under the Asset Management
// wall, outsiders and ACT cannot write, and every step is audited. Uses the same throwaway local database as
// rls.test.ts and resets it. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { amExtrasProblems } from '../src/am-extras-readiness';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** One statement as the API's runtime role with the given walls. */
async function asApp(walls: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

const moduleSql = () => readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'modules', 'am-extras-v1.sql'), 'utf8');

describe('Asset Management extras on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('reads nothing and refuses saves before the module is applied', async () => {
    const b = await db.asUser('u-asset-dir', (svc, u) => svc.amExtras.board(u));
    assert.equal(b.installed, false);
    assert.deepEqual(b.contractors, []);
    await assert.rejects(
      db.asUser('u-asset-mm', (svc, u) => svc.amExtras.act(u, 'contractor', 'add', '', { name: 'PG Contractor (test)', ssmNo: '000001-PG', trades: ['GENERAL'] })),
      /not set up in this database/,
    );
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      assert.ok((await amExtrasProblems(c)).some((p) => /am-extras-v1\.sql/.test(p)));
    } finally {
      await c.end();
    }
  });

  it('after the module: the team works under the wall, Finance banks, outsiders and ACT cannot write, every step audited', async () => {
    await admin(moduleSql());
    await admin(moduleSql()); // repeat-safe
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      assert.deepEqual(await amExtrasProblems(c), []);
    } finally {
      await c.end();
    }

    // Contractors: added by the team, approved by the Asset Director.
    const k = await db.asUser('u-asset-mm', (svc, u) => svc.amExtras.act(u, 'contractor', 'add', '', { name: 'PG Contractor (test)', ssmNo: '000001-PG', trades: ['GENERAL'] }));
    await db.asUser('u-asset-dir', (svc, u) => svc.amExtras.act(u, 'contractor', 'decide', k.id, { status: 'active', version: 1 }));
    await assert.rejects(
      db.asUser('u-finance-am', (svc, u) => svc.amExtras.act(u, 'contractor', 'add', '', { name: 'Not team (test)', ssmNo: '000002-PG', trades: ['GENERAL'] })),
      AccessDenied,
    );
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.amExtras.board(u)), AccessDenied);

    // A resort booking: the Asset Director sets the price list, the team books and takes the deposit, Finance banks it.
    // The seeded taxes stay: RM800 room + 8% service tax + RM3 x 4 room-nights state fee = RM876, so 30% is RM262.80.
    await db.asUser('u-asset-dir', (svc, u) => svc.amExtras.act(u, 'resort', 'rates', 'am-p-1', { capacity: { ROOM: 2 }, rates: { ROOM: 200 } }));
    const bk = await db.asUser('u-asset-rx1', (svc, u) =>
      svc.amExtras.act(u, 'booking', 'add', '', { propertyId: 'am-p-1', type: 'ROOM', qty: 2, checkIn: '2099-01-10', checkOut: '2099-01-12', guest: 'PG Guest (test)', phone: '012-345 6789' }),
    );
    await assert.rejects(
      db.asUser('u-asset-rx1', (svc, u) =>
        svc.amExtras.act(u, 'booking', 'add', '', { propertyId: 'am-p-1', type: 'ROOM', qty: 1, checkIn: '2099-01-11', checkOut: '2099-01-12', guest: 'PG Guest 2 (test)', phone: '012-345 6780' }),
      ),
      /Not enough/,
    );
    const paid = (await db.asUser('u-asset-rx1', (svc, u) => svc.amExtras.act(u, 'booking', 'step', bk.id, { step: 'pay', amount: 270, method: 'TRANSFER', ref: 'IBG-PG' }))) as unknown as {
      payments: { id: string; on: string }[];
    };
    await db.asUser('u-asset-rx1', (svc, u) => svc.amExtras.act(u, 'booking', 'step', bk.id, { step: 'confirm' }));
    // Bank on the service-recorded receipt day (MYT), which can differ from the runner's UTC day.
    await db.asUser('u-finance-am', (svc, u) => svc.amExtras.act(u, 'booking', 'bank', bk.id, { paymentId: paid.payments[0].id, on: paid.payments[0].on, slipRef: 'STMT-PG' }));
    // Housekeeping on the numbered rooms: a room is not taken out of sale when that would oversell a booked night.
    await db.asUser('u-asset-rx1', (svc, u) => svc.amExtras.act(u, 'room', 'step', 'am-p-1', { step: 'status', roomNo: 'R01', hk: 'dirty' }));
    await assert.rejects(
      db.asUser('u-asset-rx1', (svc, u) => svc.amExtras.act(u, 'room', 'step', 'am-p-1', { step: 'out', roomNo: 'R02', from: '2099-01-09', until: '2099-01-11', reason: 'Leak (test)' })),
      /too few/,
    );
    const room = await admin<{ hk: string }>(`SELECT r->>'hk' AS hk FROM prima.am_properties, jsonb_array_elements(data->'stay'->'rooms') r WHERE id = 'am-p-1' AND r->>'no' = 'R01'`);
    assert.equal(room[0]?.hk, 'dirty');
    // House rules are set in the app by the Asset Director only, and stored on the property row.
    await assert.rejects(
      db.asUser('u-asset-rx1', (svc, u) => svc.amExtras.act(u, 'resort', 'policy', 'am-p-1', { sstRegistered: true, checkInTime: '15:00', checkOutTime: '12:00', freeCancelDays: 7, lateCancelKeepPct: 50, noShowKeepPct: 100 })),
      AccessDenied,
    );
    await db.asUser('u-asset-dir', (svc, u) =>
      svc.amExtras.act(u, 'resort', 'policy', 'am-p-1', { sstRegistered: false, motacNo: 'MOTAC-PG (test)', motacExpiresOn: '2099-12-31', checkInTime: '15:00', checkOutTime: '12:00', freeCancelDays: 7, lateCancelKeepPct: 50, noShowKeepPct: 100 }),
    );
    const pol = await admin<{ t: string }>(`SELECT data->'stay'->'policy'->>'checkOutTime' AS t FROM prima.am_properties WHERE id = 'am-p-1'`);
    assert.equal(pol[0]?.t, '12:00');

    // Planned maintenance raises a real work order row.
    const pm = await db.asUser('u-asset-mm', (svc, u) =>
      svc.amExtras.act(u, 'pm', 'add', '', { propertyId: 'am-p-9', task: 'PG fire check (test)', trade: 'FIRE', everyMonths: 12, nextDueOn: new Date().toISOString().slice(0, 10), statutory: true }),
    );
    const r = (await db.asUser("u-asset-mm", (svc, u) => svc.amExtras.act(u, "pm", "raise", "", {}))) as unknown as { raised: { planId: string; workOrderId: string }[] };
    const mine = r.raised.find((x) => x.planId === pm.id)!;
    assert.ok(mine);
    const [wo] = await admin<{ source: string }>(`SELECT data->>'source' AS source FROM prima.am_work_orders WHERE id = $1`, [mine.workOrderId]);
    assert.equal(wo.source, 'planned');

    // The wall itself: without asset_write nothing is inserted, ACT (asset_read only) reads, nobody deletes.
    await assert.rejects(asApp('asset_read', `INSERT INTO prima.am_contractors (id, data) VALUES ('x', '{"id":"x"}')`), /row-level security|permission/);
    assert.equal(Number((await asApp('', `SELECT count(*) AS n FROM prima.am_contractors`)).rows[0].n), 0);
    assert.ok(Number((await asApp('asset_read', `SELECT count(*) AS n FROM prima.am_contractors`)).rows[0].n) >= 1);
    await assert.rejects(asApp('asset_read,asset_write', `DELETE FROM prima.am_bookings`), /permission denied/);

    const audit = await admin<{ action: string }>(`SELECT data->>'action' AS action FROM prima.audit WHERE data->>'action' LIKE 'asset.%' ORDER BY seq`);
    const actions = audit.map((a) => a.action);
    for (const a of ['asset.contractor.add', 'asset.contractor.active', 'asset.resort.rates', 'asset.booking.add', 'asset.booking.pay', 'asset.booking.confirm', 'asset.booking.banked', 'asset.room.status', 'asset.resort.policy', 'asset.pm.add', 'asset.pm.raised'])
      assert.ok(actions.includes(a), `audited ${a}`);
  });
});
