// Time slip (Fauzan, 4 Nov 2026, rule HR-TIME-SLIP) in the database itself: the separate module SQL, the company
// wall on slips, the HR-only setting, and HR closing a slip into annual leave under row-level security.
// Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, addDays, myt, type TimeSlip } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const COS = 'u-cos';
const ask = { date: TODAY, from: '14:00', to: '16:00', reason: 'Bank appointment' };

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

/** One statement as the runtime role with the session settings the API sets. */
async function asApp(sql: string, params: unknown[], s: { userId: string; group: boolean; companies?: string }) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [s.companies ?? '']);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [s.userId]);
    await c.query(`SELECT set_config('app.group_user', $1, true)`, [s.group ? 'on' : 'off']);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('time slip (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/time-slip-v1.sql'), 'utf8'));
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs both tables with forced row-level security and no delete for the runtime role', async () => {
    const r = await admin(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname IN ('time_slips', 'time_slip_settings') ORDER BY 1`,
    );
    assert.deepEqual(
      r.rows.map((x) => [x.relname, x.relrowsecurity, x.relforcerowsecurity, x.del]),
      [
        ['time_slip_settings', true, true, false],
        ['time_slips', true, true, false],
      ],
    );
  });

  it('routes, approves and walls slips through the real store', async () => {
    const s = await db.asUser('u-it-ex3', (svc, u) => svc.requestTimeSlip(u, ask), at(NOW));
    assert.equal(s.companyId, null);
    const done = (await db.asUser('u-it-mgr', (svc, u) => svc.decideTimeSlip(u, s.id, true, 'Fine'), at(NOW))) as TimeSlip;
    assert.equal(done.status, 'approved');
    const a = await db.asUser('u-ae-arsh', (svc, u) => svc.requestTimeSlip(u, ask), at(NOW));
    assert.equal(a.companyId, 'co-arsh');
    // Another company's manager sees neither slip, at the database and on the board.
    const other = await db.asUser('u-cm-sasa', (svc, u) => svc.timeSlipBoard(u), at(NOW));
    assert.equal(other.rows.length, 0);
    // The row is not even visible to them, so it is not found; deciding is refused either way.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.decideTimeSlip(u, a.id, true, 'ok'), at(NOW)), /not found/);
    const own = await db.asUser('u-cm-arsh', (svc, u) => svc.timeSlipBoard(u), at(NOW));
    assert.deepEqual(
      own.rows.map((r) => r.slip.id),
      [a.id],
    );
    // A company user never reads a central staff slip row directly.
    const direct = await asApp('SELECT count(*)::int AS n FROM prima.time_slips WHERE company_id IS NULL', [], { userId: 'u-cm-arsh', group: false, companies: 'co-arsh' });
    assert.equal(direct.rows[0].n, 0);
  });

  it('lets everyone read the approver setting but only group users write it, and the service only HR', async () => {
    await assert.rejects(
      asApp(`INSERT INTO prima.time_slip_settings (id, company_id, data) VALUES ('x', NULL, '{}'::jsonb)`, [], { userId: 'u-cm-arsh', group: false, companies: 'co-arsh' }),
      /row-level security/,
    );
    await assert.rejects(
      db.asUser('u-it-mgr', (svc, u) => svc.setTimeSlipApprover(u, 'hr', 'Because'), at(NOW)),
      (e) => e instanceof AccessDenied,
    );
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.setTimeSlipApprover(u, 'hr', 'Pilot: HR approves'), at(NOW));
    const mine = await db.asUser('u-ae-arsh', (svc, u) => svc.myTimeSlips(u), at(NOW));
    assert.equal(mine.approver?.label, 'HR');
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.setTimeSlipApprover(u, 'head', 'Back to the default'), at(NOW));
  });

  it('closes a slip after 30 days into half a day of annual leave when HR opens the board', async () => {
    const later = myt(addDays(TODAY, 31), '09:00');
    // Two HR people open the board at the same moment, in two database transactions (Arisha review 4 Nov): the slip
    // row lock makes the second wait and re-read, so leave is taken once and neither open fails.
    const [one, two] = await Promise.all([
      db.asUser('u-pwvsb-hr', (svc, u) => svc.timeSlipBoard(u), at(later)),
      db.asUser(COS, (svc, u) => svc.timeSlipBoard(u), at(later)),
    ]);
    assert.equal(one.settled + two.settled, 1);
    const leave = await admin(`SELECT data FROM prima.leave_requests WHERE data->>'timeSlipId' IS NOT NULL`);
    assert.equal(leave.rows.length, 1);
    assert.equal(leave.rows[0].data.kind, 'ANNUAL');
    assert.equal(leave.rows[0].data.days, 0.5);
    const again = await db.asUser('u-pwvsb-hr', (svc, u) => svc.timeSlipBoard(u), at(later));
    assert.equal(again.settled, 0);
  });
});
