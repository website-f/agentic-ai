// P97 (Fitri, 11 Nov 2026: "where is the face scan/snap?"): the check-in and check-out face photos in the database
// itself: the repeat-safe module SQL, forced row-level security, the person and their manager or HR reading a photo and a
// colleague or another company's manager never, the photo kept only while clocked in through a check-in, the phone's
// notes and readings, and the shift route answered at check-out. Uses a throwaway local database and resets it. Mock data
// only (synthetic photo text, never a real face).
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
const TODAY = '2026-11-11';
const NOW = myt(TODAY, '08:00');
const STAFF = 'u-ae-arsh';
const PEER = 'u-ae-arsh-2';
const MANAGER = 'u-cm-arsh';
const OTHER_MANAGER = 'u-cm-sasa';
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/clock-snaps-v1.sql'), 'utf8');
const OFFICE = { lat: 3.1073, lng: 101.6067 };
const north = (m: number) => ({ lat: OFFICE.lat + m / 111_195, lng: OFFICE.lng });
const JPEG = `data:image/jpeg;base64,${'Q'.repeat(3000)}`;
const DESC = Array.from({ length: 128 }, (_, i) => Math.round(Math.cos(i + 1) * 1000) / 10000);

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

/** A raw read as the runtime role, as a given sign-in (the wall the database itself keeps). */
async function asApp(sql: string, params: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', 'arsh,sasa', true), set_config('app.user_id', $1, true), set_config('app.group_user', 'on', true)`, [userId]);
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

describe('check-in face photos (database, row-level security)', () => {
  let db: Db;
  const t = { now: NOW };
  const at = () => t.now;
  const later = (min: number) => (t.now = fromMs(Date.parse(t.now) + min * 60_000));
  const fix = (m: number) => ({ ...north(m), accuracyM: 10, capturedAt: t.now });

  before(async () => {
    await resetDb(URL, NOW);
    await admin(SQL);
    // Repeat-safe: the office's prima-setup runs it on every start.
    await admin(SQL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs one table with forced row-level security and no delete for the runtime role', async () => {
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'clock_snaps'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  let clockId = '';
  it('keeps the photo with the check-in, the readings and notes while clocked in, and answers the route at check-out', async () => {
    const r = await db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'in', { ...fix(5), face: { image: JPEG, descriptor: DESC, live: true } }), at);
    assert.equal(r.photo.kept, true);
    assert.equal(r.photo.snap?.mode, 'photo');
    later(10);
    await db.asUser(STAFF, (svc, u) => svc.staffPing(u, fix(8)), at);
    const hidden = t.now;
    later(45);
    // Readings kept offline and the phone's note that Prima went to the background.
    const sent = await db.asUser(STAFF, (svc, u) => svc.staffPings(u, [fix(10)], [{ at: hidden, kind: 'hidden' }]), at);
    assert.deepEqual(sent, { accepted: 1, skipped: 0, notes: 1 });
    later(10);
    const o = await db.asUser(STAFF, (svc, u) => svc.checkIn(u, 'out', { ...fix(6), face: { image: JPEG, descriptor: DESC, live: false } }), at);
    assert.equal(o.photo.snap?.review?.status, 'open');
    assert.deepEqual(o.photo.snap?.review?.why, ['not_live']);
    clockId = o.clock!.id;
    const d = await db.asUser(STAFF, (svc, u) => svc.staffClockDetail(u, clockId), at);
    assert.deepEqual(
      d.snaps.map((s) => [s.kind, s.image === JPEG]),
      [
        ['in', true],
        ['out', true],
      ],
    );
    assert.ok(d.movement!.segments.length > 0);
    assert.deepEqual(
      d.movement!.gaps.map((g) => g.cause),
      ['closed'],
    );
    // Nothing after the clock-out: a later note or reading is not kept.
    later(5);
    const after = await db.asUser(STAFF, (svc, u) => svc.staffPings(u, [fix(9)], [{ at: t.now, kind: 'hidden' }]), at);
    assert.deepEqual(after, { accepted: 0, skipped: 1, notes: 0 });
  });

  it('shows the photos to the person, their manager and HR only; the database itself agrees', async () => {
    const mgr = await db.asUser(MANAGER, (svc, u) => svc.clockSnapReviews(u), at);
    assert.deepEqual(
      mgr.open.map((s) => s.userId),
      [STAFF],
    );
    const other = await db.asUser(OTHER_MANAGER, (svc, u) => svc.clockSnapReviews(u), at);
    assert.equal(other.open.length, 0);
    await assert.rejects(
      db.asUser(PEER, (svc, u) => svc.clockSnapReviews(u), at),
      (e) => e instanceof AccessDenied,
    );
    // Raw reads as the runtime role: own yes, the manager yes, a colleague and another company's manager no.
    const count = async (uid: string) => (await asApp(`SELECT count(*)::int AS n FROM prima.clock_snaps WHERE data->>'userId' = $1`, [STAFF], uid)).rows[0].n;
    assert.equal(await count(STAFF), 2);
    assert.equal(await count(MANAGER), 2);
    assert.equal(await count(PEER), 0);
    assert.equal(await count(OTHER_MANAGER), 0);
    // A colleague cannot write a photo in someone else's name.
    await assert.rejects(
      asApp(`INSERT INTO prima.clock_snaps (id, company_id, data) VALUES ('cs-x', 'arsh', $1::jsonb)`, [JSON.stringify({ id: 'cs-x', companyId: 'arsh', userId: STAFF, kind: 'in', mode: 'none', image: '' })], PEER),
      /row-level security/,
    );
  });

  it('lets the manager decide with a comment, never their own, and another company manager not at all', async () => {
    const list = await db.asUser(MANAGER, (svc, u) => svc.clockSnapReviews(u), at);
    const id = list.open[0].id;
    await assert.rejects(
      db.asUser(OTHER_MANAGER, (svc, u) => svc.decideClockSnap(u, id, 'cleared', 'fine'), at),
      (e) => e instanceof AccessDenied || /not found|Face photo/i.test(String(e)),
    );
    const d = await db.asUser(MANAGER, (svc, u) => svc.decideClockSnap(u, id, 'cleared', 'Saw them at the desk'), at);
    assert.equal(d.review?.status, 'cleared');
    assert.equal((await db.asUser(MANAGER, (svc, u) => svc.clockSnapReviews(u), at)).open.length, 0);
  });

  it('a database without the module still checks in, and says the photo was not kept', async () => {
    await admin('DROP TABLE prima.clock_snaps');
    later(60 * 14);
    const r = await db.asUser(PEER, (svc, u) => svc.checkIn(u, 'in', { ...fix(5), face: { image: JPEG, descriptor: DESC, live: true } }), at);
    assert.equal(r.event.outcome, 'accepted');
    assert.deepEqual(r.photo, { kept: false, snap: null });
    await admin(SQL);
  });
});
