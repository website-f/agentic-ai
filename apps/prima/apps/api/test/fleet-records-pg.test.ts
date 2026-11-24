// Accidents, summonses and driver licences on PostgreSQL (Transport check, Fauzan "Do the gap", 23 Nov 2026). Before the
// module runs the screens say Not installed and vehicles still go out; after it, records are kept, never deleted, and a
// saved record changes only by being closed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = () => ({ kind: 'document' as const, name: `Fleet ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic fleet ${n}`).toString('base64')}` });

describe('Fleet records (PostgreSQL)', () => {
  let db: Db;
  const as = <T>(id: string, fn: (svc: PrimaService, u: User) => Promise<T>) => db.asUser(id, fn, () => NOW);
  const sql = async (q: string) => {
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      return await c.query(q);
    } finally {
      await c.end();
    }
  };
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says Not installed until the module is run, and vehicles still go out', async () => {
    const r = await as('u-transport', (svc, u) => svc.fleetRecords(u));
    assert.equal(r.installed, false);
    await assert.rejects(as('u-transport', (svc, u) => svc.fleetRecordAct(u, 'licence', { driverUserId: 'u-it-lead', classes: 'D', expiresOn: '2028-01-01' }, [doc()])), /not installed/);
    const board = await as('u-transport', (svc, u) => svc.fleetBoard(u));
    assert.ok(board.today.length > 0);
    await sql(readFileSync(resolve(__dirname, '../../../../db/modules/fleet-records-v1.sql'), 'utf8'));
    await db.onModuleDestroy();
    db = new Db();
  });

  it('keeps accidents, summonses and licences; the OGM sees them; nothing is deleted or rewritten', async () => {
    const lic = await as('u-transport', (svc, u) => svc.fleetRecordAct(u, 'licence', { driverUserId: 'u-it-lead', classes: 'D', expiresOn: '2028-01-01' }, [doc()]));
    const sum = await as('u-transport', (svc, u) => svc.fleetRecordAct(u, 'summons', { vehicleId: 'veh-inas-1', at: myt(TODAY, '08:00'), issuer: 'JPJ', ref: 'JPJ-9', what: 'Seat belt' }, [doc()]));
    const ogm = await as('u-ogm', (svc, u) => svc.fleetRecords(u));
    assert.equal(ogm.records.length, 2);
    // The driver sees only their own licence.
    const mine = await as('u-it-lead', (svc, u) => svc.fleetRecords(u));
    assert.deepEqual(mine.records.map((r) => r.id), [lic.id]);
    await assert.rejects(
      sql(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.group_user', 'on', true); DELETE FROM prima.fleet_records WHERE id = '${sum.id}'; COMMIT;`),
      /permission denied/,
    );
    await assert.rejects(sql(`UPDATE prima.fleet_records SET data = jsonb_set(data, '{ref}', '"X"') WHERE id = '${sum.id}'`), /not changed/);
    const closed = await as('u-transport', (svc, u) => svc.fleetRecordAct(u, 'close', { id: sum.id, outcome: 'PAID', note: 'Paid at the counter' }, [doc()]));
    assert.equal(closed.status, 'closed');
    await assert.rejects(sql(`UPDATE prima.fleet_records SET data = jsonb_set(data, '{status}', '"open"') WHERE id = '${sum.id}'`), /not changed/);
  });
});
