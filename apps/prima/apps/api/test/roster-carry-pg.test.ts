// Fauzan's audit of 4b708ae (14 Nov 2026), roster findings, against a real local PostgreSQL:
// P1: a replacement roster never shortens a completed duty (the times the actual was recorded against are kept, and
//     payroll counts 720 minutes, not 480);
// P2: a completed day the replacement draft had taken off is restored at publication (the update carries no identity
//     fields, which the database refuses). Synthetic data only, on a disposable database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { monthDates, myt, rosterPayInput, type Attendance, type RosterStatus } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const SITE = 'st-sasa-001';

type Line = { personId: string; date: string; planned: RosterStatus; plannedStart?: string; plannedEnd?: string };
function lines(a: string, b: string, month: string): Line[] {
  return monthDates(month).flatMap((date, i) => {
    const on = i % 2 === 0 ? a : b;
    const off = i % 2 === 0 ? b : a;
    return [
      { personId: on, date, planned: 'WORK_D' as RosterStatus, plannedStart: `${date}T08:00:00+08:00`, plannedEnd: `${date}T20:00:00+08:00` },
      { personId: off, date, planned: 'OFF_REST' as RosterStatus },
    ];
  });
}

describe('roster replacement keeps completed duties (audit of 4b708ae)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps the completed times through publication and payroll, and restores a completed day taken off a draft', async () => {
    // A month after the current one, so every step can be dated inside it.
    const now = new Date(Date.now() + 8 * 3_600_000);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    // The first of the month: no earlier day of the month is fixed yet, so a later draft may move the guard off it.
    const D = `${next}-01`;
    let clock = myt(`${next}-01`, '06:00');
    const as = <R>(uid: string, fn: Parameters<Db['asUser']>[1]) => db.asUser(uid, fn as never, () => clock) as Promise<R>;

    const admin = new Client({ connectionString: URL });
    await admin.connect();
    await admin.query(readFileSync(join(__dirname, '../../../../db/modules/guard-roster-v1.sql'), 'utf8'));
    const people = await admin.query(`SELECT data->>'id' AS id FROM prima.people WHERE data->>'companyId' = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' ORDER BY data->>'staffNo' LIMIT 3`);
    const a = (await admin.query(`SELECT data->>'personId' AS p FROM prima.users WHERE id = 'u-guard-sasa-1'`)).rows[0].p as string;
    await admin.end();
    const [b, c] = people.rows.map((r) => r.id as string).filter((x) => x !== a);

    // The contract needs 08:00-16:00; the roster first books a longer 08:00-20:00 day, then a replacement shortens it.
    const coverage = { effectiveFrom: `${next}-01`, calendar: { kind: 'every_day' }, shifts: [{ code: 'D', start: '08:00', end: '16:00', posts: 1 }], minActive: 1, armed: false, clientLimits: {}, billing: 'fixed_monthly_post', breakPermissionRef: null, reason: 'Synthetic contract schedule', documentRef: 'CONTRACT-SYNTHETIC' };
    await as('u-opsdir', (svc, u) => svc.saveSiteCoverage(u, SITE, coverage as never));
    const publish = async (days: Line[], reason?: string, again?: Line[]) => {
      const v = await as<{ version: { id: string } }>('u-om-klang', (svc, u) => svc.saveRosterDraft(u, SITE, next, { days, ...(reason ? { changeReason: reason } : {}) } as never));
      if (again) await as('u-om-klang', (svc, u) => svc.saveRosterDraft(u, SITE, next, { days: again, changeReason: reason } as never));
      await as('u-om-klang', (svc, u) => svc.rosterStep(u, v.version.id, 'submit', 'Synthetic ready'));
      await as('u-opsdir', (svc, u) => svc.rosterStep(u, v.version.id, 'publish', 'Checked'));
      return v.version.id;
    };
    const base = lines(a, b, next);
    await publish(base);

    // The guard works 08:00-20:00 on D; the OM records it that evening.
    clock = myt(D, '21:00');
    const board = await as<{ days: { id: string; personId: string; date: string; planned: string }[] }>('u-om-klang', (svc, u) => svc.rosterBoard(u, SITE, next));
    const day = board.days.find((d) => d.personId === a && d.date === D && d.planned === 'WORK_D')!;
    assert.ok(day, 'the guard works on D');
    await as('u-om-klang', (svc, u) => svc.recordRosterActual(u, day.id, 'WORK_D'));

    // P1: a replacement that says 08:00-16:00 for that completed day keeps the 08:00-20:00 record.
    const shorter = base.map((l) => (l.personId === a && l.date === D ? { ...l, plannedEnd: `${D}T16:00:00+08:00` } : l));
    const v2 = await publish(shorter, 'Synthetic shorter day');
    const rows = await as<{ id: string; personId: string; date: string; plannedStart: string | null; plannedEnd: string | null; actual: string | null; removed: boolean; rosterVersionId: string }[]>('u-opsdir', (_svc, _u, store) => store.list('rosterDays', { rosterVersionId: v2 } as never));
    const kept = rows.find((r) => r.personId === a && r.date === D)!;
    assert.equal(kept.actual, 'WORK_D');
    assert.equal(kept.plannedEnd, `${D}T20:00:00+08:00`);
    const data = await as<{ versions: never[]; days: never[] }>('u-opsdir', async (_svc, _u, store) => ({ versions: (await store.list('rosterVersions', { siteId: SITE } as never)) as never[], days: (await store.list('rosterDays', {} as never)) as never[] }));
    const att: Attendance = { id: 'att-synthetic-1', companyId: 'co-sasa', siteId: SITE, shiftId: null, personId: a, deviceId: 'dev-synthetic', clockIn: `${D}T08:00:00+08:00`, clockOut: `${D}T20:00:00+08:00`, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true };
    const pay = rosterPayInput({ personId: a, month: next, versions: data.versions, days: data.days, attendance: [att], breaks: [], coverage: [], allowances: [], lumpSums: [], armedUntil: null, employedDays: monthDates(next).length })!;
    assert.equal(pay.duties.find((d) => d.date === D)!.workedMinutes, 720);

    // P2: a draft that first has the guard, then hands all the guard's days to a third guard, is published: the
    // guard's completed day comes back on the new version.
    const without = base.map((l) => (l.personId === a ? { ...l, personId: c } : l));
    const v3 = await publish(base, 'Synthetic second change', without);
    const rows3 = await as<typeof rows>('u-opsdir', (_svc, _u, store) => store.list('rosterDays', { rosterVersionId: v3 } as never));
    const back = rows3.find((r) => r.personId === a && r.date === D)!;
    assert.equal(back.id, `rd-${v3}-${a}-${D}`);
    assert.equal(back.removed, false);
    assert.equal(back.actual, 'WORK_D');
    assert.equal(back.plannedEnd, `${D}T20:00:00+08:00`);
    assert.equal(back.rosterVersionId, v3);
  });
});
