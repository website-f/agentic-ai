import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import type { ParsedAttendanceReport, ReportDay } from '@prima/core';
import { AttendanceReportsController, AttendanceUploads } from '../src/attendance-reports.controller';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

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

const zero = { flat: 0, attendance: 0, shift: 0, meal: 0, transport: 0, other1: 0, other2: 0, health: 0 };
const day = (date: string, o: Partial<ReportDay> = {}): ReportDay => {
  const off = !!o.reason;
  return { date, clocks: [], in: off ? null : '08:00', out: off ? null : '17:00', shift: 'S1', normalH: off ? 0 : 8, lateH: 0, earlyH: 0, actualH: off ? 0 : 8, ot: [0, 0, 0, 0], allow: { ...zero }, reason: null, page: 1, ...o };
};
const month = (m: string, len: number, f: (d: number) => Partial<ReportDay> = () => ({})) => Array.from({ length: len }, (_, i) => day(`${m}-${String(i + 1).padStart(2, '0')}`, f(i + 1)));
const report = (company: string, code: string, m: string, days: ReportDay[]): ParsedAttendanceReport => ({
  title: 'Individual Attendance Report (synthetic)',
  pages: 1,
  employees: [{ company, empCode: code, name: 'Synthetic P112 Guard', designation: 'GUARD', department: null, periodFrom: `${m}-01`, periodTo: days[days.length - 1].date, pages: [1], days, totals: null, monthly: null }],
  unreadable: [],
  warnings: [],
});
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();

// P112 (Fitri, 17 Nov 2026): HR gets the Attendance day sheet (read-only), and each person's attendance over a period
// (GET /api/attendance-reports/person-period, and the overview's from/to), on PostgreSQL with row level security.
describe('P112 attendance for HR under PostgreSQL walls', () => {
  let db: Db;
  let uploads: AttendanceUploads;
  let ctl: AttendanceReportsController;
  let importId = '';
  let key = '';
  before(async () => {
    await resetDb(URL);
    db = new Db();
    uploads = new AttendanceUploads();
    ctl = new AttendanceReportsController(db, uploads);
    const co = (await admin<{ name: string }>(`SELECT data->>'name' AS name FROM prima.companies WHERE id = 'co-sasa'`))[0].name;
    const code = 'SYNP112';
    const sept = month('2026-09', 30, (d) => (d === 9 ? { lateH: 0.5 } : d === 10 ? { reason: 'ABS' } : d === 15 ? { reason: 'MC' } : {}));
    const oct = month('2026-10', 31, (d) => (d === 2 ? { lateH: 0.25 } : d === 7 ? { ot: [0, 2, 0, 0] } : {}));
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.attendanceReports.save(u, report(co, code, '2026-09', sept), { name: 'p112-sep.pdf', size: 1, sha256: 'e'.repeat(64) }, {}, false));
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.attendanceReports.save(u, report(co, code, '2026-10', oct), { name: 'p112-oct.pdf', size: 1, sha256: 'f'.repeat(64) }, {}, false));
    const o = await ctl.overview('u-pwvsb-hr', '2026-10');
    importId = o.rows[0].importId;
    key = o.rows[0].key;
  });
  after(async () => {
    uploads.onModuleDestroy();
    await db.onModuleDestroy();
  });

  it('HR reads one person over a period of days across two reports', async () => {
    const v = await ctl.personPeriod('u-pwvsb-hr', importId, key, '2026-09-01', '2026-10-31');
    assert.deepEqual(v.reportMonths, ['2026-09', '2026-10']);
    assert.equal(v.days.length, 61);
    assert.deepEqual(
      v.months.map((m) => m.month),
      ['2026-09', '2026-10'],
    );
    assert.equal(v.kpi.absent, 1);
    assert.equal(v.kpi.mc, 1);
    assert.equal(v.kpi.lateCount, 2);
    assert.equal(v.kpi.lateMin, 45);
    assert.equal(v.kpi.otHours, 2);
    assert.equal(v.kpi.present, 59);
    assert.equal(v.kpi.rate, Math.round((59 / 60) * 1000) / 10);
  });

  it('the overview adds the months of a period up per person', async () => {
    const o = await ctl.overview('u-pwvsb-hr', undefined, 'co-sasa', undefined, undefined, '2026-09', '2026-10');
    assert.deepEqual(o.period, { from: '2026-09', to: '2026-10' });
    const r = o.rows.find((x) => x.key === key)!;
    assert.equal(r.months, 2);
    assert.equal(r.totals.present, 59);
    await assert.rejects(async () => ctl.overview('u-pwvsb-hr', undefined, undefined, undefined, undefined, '2026-10', '2026-09'), (e) => status(e) === 400);
    await assert.rejects(async () => ctl.overview('u-pwvsb-hr', undefined, undefined, undefined, undefined, '2026-9', '2026-10'), (e) => status(e) === 400);
  });

  it('refuses bad days, and Finance, a guard and another company manager', async () => {
    await assert.rejects(async () => ctl.personPeriod('u-pwvsb-hr', importId, key, '2026-09-01', ''), (e) => status(e) === 400);
    await assert.rejects(async () => ctl.personPeriod('u-pwvsb-hr', importId, key, '2026-10-31', '2026-09-01'), (e) => status(e) === 400);
    await assert.rejects(async () => ctl.personPeriod('u-pwvsb-hr', importId, key, '2024-01-01', '2026-10-31'), (e) => status(e) === 400);
    const finance = (await admin<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'department' = 'finance' AND (data->>'integration') IS NULL AND data->>'leadership' IS NULL LIMIT 1`))[0].id;
    const guard = (await admin<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'role' = 'guard' LIMIT 1`))[0].id;
    for (const uid of [finance, guard, 'u-cm-arsh']) {
      await assert.rejects(async () => ctl.personPeriod(uid, importId, key, '2026-09-01', '2026-09-30'), (e) => status(e) === 404, uid);
      assert.equal((await ctl.overview(uid, undefined, undefined, undefined, undefined, '2026-09', '2026-10')).rows.length, 0, uid);
    }
  });

  it('HR opens the day sheet and its alerts read-only; Finance and a guard are refused', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    const sheet = await db.asUser('u-pwvsb-hr', (svc, u) => svc.attendance(u, 'co-sasa', today));
    assert.equal(sheet.canLock, false);
    assert.equal(sheet.canFollowUp, false);
    assert.equal(sheet.canDiscipline, false);
    assert.equal(sheet.canReplace, false);
    const alerts = await db.asUser('u-pwvsb-hr', (svc, u) => svc.attendanceAlerts(u, 'co-sasa'));
    assert.equal(alerts.canFollowUp, false);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.lockAttendance(u, 'co-sasa', '2026-10-01')), /Not allowed/);
    const finance = (await admin<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'department' = 'finance' AND (data->>'integration') IS NULL AND data->>'leadership' IS NULL LIMIT 1`))[0].id;
    const guard = (await admin<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'role' = 'guard' LIMIT 1`))[0].id;
    for (const uid of [finance, guard]) await assert.rejects(db.asUser(uid, (svc, u) => svc.attendance(u, 'co-sasa', today)), uid);
  });

  it('without a grant for the company, HR sees neither the day sheet nor the person', async () => {
    await admin(`DELETE FROM prima.grants WHERE data->>'userId' = 'u-pwvsb-hr' AND data->>'companyId' = 'co-sasa'`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.attendance(u, 'co-sasa', today)), /Not allowed/);
    await assert.rejects(async () => ctl.personPeriod('u-pwvsb-hr', importId, key, '2026-09-01', '2026-09-30'), (e) => status(e) === 404);
  });
});
