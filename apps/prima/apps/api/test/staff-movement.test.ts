// P93 (Fitri, 9 Nov 2026): the clock-in that told people to go out and clock in again, the distance at log-out, and
// movement out of station, in the database itself: the per-person lock (opening Prima and checking in at the same
// moment), idempotent check-in and check-out, readings sent twice or queued offline, and who sees whose movement (own,
// team, refused). Uses a throwaway local database and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, fromMs, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-09';
const NOW = myt(TODAY, '08:00');
const OWNER = 'u-fauzan';
const STAFF = 'u-ae-arsh';
const PEER = 'u-ae-arsh-2';
const MANAGER = 'u-cm-arsh';
const OTHER_MANAGER = 'u-cm-sasa';
const OTC_SQL = readFileSync(resolve(__dirname, '../../../../db/modules/owner-test-checkin-v1.sql'), 'utf8');
/** The mock Arrow Shield office (its base), and points north of it. */
const OFFICE = { lat: 3.1073, lng: 101.6067 };
const north = (m: number) => ({ lat: OFFICE.lat + m / 111_195, lng: OFFICE.lng });

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('staff clock and movement (database)', () => {
  let db: Db;
  const t = { now: NOW };
  const at = () => t.now;
  const later = (min: number) => (t.now = fromMs(Date.parse(t.now) + min * 60_000));
  const fix = (p: { lat: number; lng: number }, accuracyM = 10) => ({ ...p, accuracyM, capturedAt: t.now });

  before(async () => {
    await resetDb(URL, NOW);
    await admin(OTC_SQL);
    db = new Db();
    // Open the pool's connections one by one first: on a busy test machine four new connections at the same instant can
    // take longer than the connection timeout, which is not what the race test is about.
    const held = [];
    for (let i = 0; i < 4; i++) held.push(await db.pool.connect());
    for (const c of held) c.release();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('opening Prima and checking in at the same moment (twice) make one clock and one check-in, with no error', async () => {
    const results = await Promise.all([
      db.asUser(STAFF, (svc, u) => svc.staffSessionStart(u), at),
      db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'in', fix(OFFICE)), at),
      db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'in', fix(north(20))), at),
      db.asUser(STAFF, (svc, u) => svc.staffSessionStart(u), at),
    ]);
    const checks = results.slice(1, 3) as { already: boolean; event: { id: string } }[];
    assert.equal(checks.filter((r) => r.already).length, 1);
    assert.equal(checks[0].event.id, checks[1].event.id);
    const open = await admin(`SELECT count(*)::int AS n FROM prima.staff_clocks WHERE data->>'userId' = $1 AND data->'out' = 'null'::jsonb`, [STAFF]);
    assert.equal(open.rows[0].n, 1);
    const events = await admin(`SELECT count(*)::int AS n FROM prima.checkin_events WHERE data->>'userId' = $1`, [STAFF]);
    assert.equal(events.rows[0].n, 1);
  });

  it('keeps readings sent twice once, takes readings queued offline, and records the trip out of the office', async () => {
    // 08:10 at the office, 08:20 to 08:50 two kilometres away, back at 09:00.
    for (const [m, p] of [
      [10, north(5)],
      [10, north(2_000)],
      [10, north(2_010)],
      [10, north(2_020)],
      [10, north(8)],
    ] as const) {
      later(m);
      const r = await db.asUser(STAFF, (svc, u) => svc.staffPing(u, fix(p)), at);
      assert.equal(r.accepted, true);
    }
    // The last one again (a retry on a weak signal): kept once.
    later(2);
    const again = await db.asUser(STAFF, (svc, u) => svc.staffPing(u, { ...north(8), accuracyM: 10, capturedAt: fromMs(Date.parse(t.now) - 2 * 60_000) }), at);
    assert.equal(again.accepted, false);
    // Two readings kept on the phone without signal, sent together; one of them twice.
    later(15);
    const q = [
      { ...north(6), accuracyM: 12, capturedAt: fromMs(Date.parse(t.now) - 10 * 60_000) },
      { ...north(6), accuracyM: 12, capturedAt: fromMs(Date.parse(t.now) - 10 * 60_000) },
      { ...north(4), accuracyM: 12, capturedAt: fromMs(Date.parse(t.now) - 5 * 60_000) },
    ];
    assert.deepEqual(await db.asUser(STAFF, (svc, u) => svc.staffPings(u, q), at), { accepted: 2, skipped: 1 });
    const pings = await admin(`SELECT count(*)::int AS n FROM prima.location_pings WHERE data->>'userId' = $1`, [STAFF]);
    assert.equal(pings.rows[0].n, 7);
    const mine = await db.asUser(STAFF, (svc, u) => svc.myStaffClock(u), at);
    const m = mine.today!.movement!;
    assert.equal(m.measure, 'measured');
    assert.equal(m.outsideMin, 30);
    assert.ok(m.distanceM > 3_900 && m.distanceM < 4_200, `distance ${m.distanceM}`);
    assert.deepEqual(
      m.flags.map((f) => f.kind),
      ['out_of_station'],
    );
  });

  it('shows the movement to the person and their manager, and to nobody else', async () => {
    const mgr = await db.asUser(MANAGER, (svc, u) => svc.staffClockBoard(u), at);
    const item = mgr.reviews.find((r) => r.userId === STAFF);
    assert.ok(item, 'the manager sees the out-of-station item');
    assert.equal(item!.kind, 'out_of_station');
    const detail = await db.asUser(MANAGER, (svc, u) => svc.staffClockDetail(u, item!.clockId), at);
    assert.ok(detail.movement!.route.length >= 5);
    assert.deepEqual(
      detail.movement!.periods.map((p) => p.state),
      ['inside', 'outside', 'inside'],
    );
    // Own record: yes.
    const own = await db.asUser(STAFF, (svc, u) => svc.staffClockDetail(u, item!.clockId), at);
    assert.equal(own.movement!.outsideMin, 30);
    // A colleague, another company's manager, and the staff member on the board: refused.
    await assert.rejects(db.asUser(PEER, (svc, u) => svc.staffClockDetail(u, item!.clockId), at), (e) => e instanceof AccessDenied || /not found|Clock record/i.test(String(e)));
    await assert.rejects(db.asUser(OTHER_MANAGER, (svc, u) => svc.staffClockDetail(u, item!.clockId), at), (e) => e instanceof AccessDenied || /not found|Clock record/i.test(String(e)));
    await assert.rejects(db.asUser(STAFF, (svc, u) => svc.staffClockBoard(u), at), (e) => e instanceof AccessDenied);
    const other = await db.asUser(OTHER_MANAGER, (svc, u) => svc.staffClockBoard(u), at);
    assert.equal(other.reviews.some((r) => r.userId === STAFF), false);
    // The database itself keeps another company's readings from that manager.
    const seen = await db.asUser(OTHER_MANAGER, async (_svc, _u, store) => (await store.list('locationPings', { userId: STAFF })).length, at);
    assert.equal(seen, 0);
  });

  it('checks out once: a second check-out returns the first, and readings after it are not kept', async () => {
    later(5);
    const out = await db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'out', fix(OFFICE)), at);
    assert.equal(out.already, false);
    const again = await db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'out', fix(OFFICE)), at);
    assert.equal(again.already, true);
    assert.equal(again.event.id, out.event.id);
    await assert.rejects(db.asUser(STAFF, (svc, u) => svc.staffPing(u, fix(OFFICE)), at), /only while you are clocked in/);
    later(10);
    assert.deepEqual(await db.asUser(STAFF, (svc, u) => svc.staffPings(u, [{ ...OFFICE, accuracyM: 10, capturedAt: t.now }]), at), { accepted: 0, skipped: 1 });
  });

  it("ends the owner's TEST check-in at sign-out, and a second test check-in returns the open one", async () => {
    const a = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.start(u, fix(OFFICE, 8)), at);
    later(1);
    const b = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.start(u, fix(OFFICE, 8)), at);
    assert.equal(b.id, a.id);
    later(1);
    await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.ping(u, fix(north(300), 9)), at);
    later(30);
    await db.asUser(OWNER, (svc, u) => svc.staffSessionEnd(u), at);
    const mine = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.mine(u), at);
    assert.equal(mine.open, null);
    const s = mine.sessions.find((x) => x.id === a.id)!;
    assert.equal(s.endedBy, 'sign_out');
    // Ended at its last reading, not at the sign-out 30 minutes later.
    assert.equal(Date.parse(s.endedAt!), Date.parse(s.trail.at(-1)!.at));
    assert.ok(s.movement.distanceM > 250 && s.movement.distanceM < 350, `distance ${s.movement.distanceM}`);
  });
});
