// P81: past attendance from the monthly PDF reports (attendance-reports.ts): matching, saving once, replacing a month,
// who may import and see it, and the view's sums. Synthetic people and reports only.
import { describe, expect, it } from 'vitest';
import {
  AttendanceReportError,
  MemoryStore,
  PrimaService,
  attendanceStrip,
  dayKind,
  employeeKey,
  employeeTotals,
  generateDataset,
  matchEmployee,
  myt,
  normaliseCompanyName,
  normalisePersonName,
  type ParsedAttendanceReport,
  type ReportDay,
  type ReportEmployee,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user, ar: svc.attendanceReports };
}

const zero = { flat: 0, attendance: 0, shift: 0, meal: 0, transport: 0, other1: 0, other2: 0, health: 0 };
function day(date: string, o: Partial<ReportDay> = {}): ReportDay {
  const off = !!o.reason;
  return { date, clocks: [], in: off ? null : '08:00', out: off ? null : '17:00', shift: 'S1', normalH: off ? 0 : 8, lateH: 0, earlyH: 0, actualH: off ? 0 : 8, ot: [0, 0, 0, 0], allow: { ...zero }, reason: null, page: 1, ...o };
}
function emp(company: string, name: string, code: string | null, days: ReportDay[], extra: Partial<ReportEmployee> = {}): ReportEmployee {
  return { company, empCode: code, name, designation: 'GUARD', department: null, periodFrom: '2026-09-01', periodTo: '2026-09-30', pages: [1], days, totals: null, monthly: null, ...extra };
}
const sept = (f: (d: number) => Partial<ReportDay> = () => ({})) => Array.from({ length: 30 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`, f(i + 1)));
const report = (employees: ReportEmployee[]): ParsedAttendanceReport => ({ title: 'Individual Attendance Report With Monthly Allowance', pages: employees.length + 1, employees, unreadable: [{ page: employees.length + 1, reason: 'There is no text on this page (it may be a scanned image).' }], warnings: [] });
const SHA1 = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

describe('names, days and strips', () => {
  it('compares names and companies the way HR writes them', () => {
    expect(normalisePersonName("Siti bt. Ali @ O'Neil")).toBe(normalisePersonName('SITI BINTI ALI O NEIL'));
    expect(normalisePersonName('Raju a/l Muthu')).toBe('RAJU AL MUTHU');
    expect(normaliseCompanyName('Arrow Shield Security SN BHD (PIC- someone)')).toBe('ARROW SHIELD SECURITY SDN BHD');
    expect(normaliseCompanyName('Eagle  999 Sdn. Bhd.')).toBe('EAGLE 999 SDN BHD');
  });

  it('reads each day the way the report means it, and leaves unknown codes as codes', () => {
    expect(dayKind(day('2026-09-01'))).toBe('present');
    expect(dayKind(day('2026-09-01', { reason: 'RES' }))).toBe('rest');
    expect(dayKind(day('2026-09-01', { reason: 'ABS', in: '08:20' }))).toBe('absent');
    expect(dayKind(day('2026-09-01', { reason: 'ABS', in: '08:20', out: '09:00' }))).toBe('absent');
    expect(dayKind(day('2026-09-01', { reason: 'ALAM', in: '14:00', out: '17:30', actualH: 3 }))).toBe('present');
    expect(dayKind(day('2026-09-01', { reason: 'MATN' }))).toBe('leave');
    expect(dayKind(day('2026-09-01', { reason: 'PH' }))).toBe('holiday');
    expect(dayKind({ in: null, out: null, actualH: 0, reason: null })).toBe('none');
    const days = [day('2026-09-01', { lateH: 0.25 }), day('2026-09-02', { reason: 'ABS' }), day('2026-09-03', { reason: 'AL' }), day('2026-09-04', { earlyH: 0.5 })];
    expect(attendanceStrip('2026-09', days)).toBe('LAVE' + '.'.repeat(26));
    const t = employeeTotals({ days, monthly: { attendance: 10, health: 0, transport: 5, meal: 0, other1: 0, other2: 0 } });
    expect(t).toMatchObject({ present: 2, absent: 1, leave: 1, lateCount: 1, lateMin: 15, earlyCount: 1, earlyMin: 30, monthlyAllowances: 15 });
  });

  it('matches by a remembered choice, then staff number, then a unique exact name; never a guess', () => {
    const people = [
      { id: 'p1', name: 'Synthetic Ahmad bin Ali', staffNo: 'SG-001' },
      { id: 'p2', name: 'Synthetic Twin', staffNo: 'SG-002' },
      { id: 'p3', name: 'Synthetic Twin', staffNo: 'SG-003' },
    ];
    expect(matchEmployee({ empCode: 'sg001', name: 'someone else' }, people, new Map())).toEqual({ personId: 'p1', how: 'staff_no' });
    expect(matchEmployee({ empCode: 'X9', name: 'SYNTHETIC AHMAD B. ALI' }, people, new Map())).toEqual({ personId: 'p1', how: 'name' });
    expect(matchEmployee({ empCode: null, name: 'Synthetic Twin' }, people, new Map())).toEqual({ personId: null, how: null });
    expect(matchEmployee({ empCode: 'X9', name: 'Synthetic Twin' }, people, new Map([['code:X9', 'p3']]))).toEqual({ personId: 'p3', how: 'remembered' });
    expect(matchEmployee({ empCode: 'X9', name: 'Nobody' }, people, new Map([['code:X9', 'gone']]))).toEqual({ personId: null, how: null });
  });
});

describe('importing a month', () => {
  function setup() {
    const f = fresh();
    const co = f.ds.companies.find((c) => c.id === 'co-sasa')!;
    const staff = f.ds.people.filter((p) => p.companyId === co.id);
    const once = (p: (typeof staff)[number]) => staff.filter((q) => normalisePersonName(q.name) === normalisePersonName(p.name)).length === 1;
    const byNo = staff.find((p) => p.staffNo && staff.filter((q) => q.staffNo === p.staffNo).length === 1)!;
    const byName = staff.find((p) => p.id !== byNo.id && once(p))!;
    const parsed = report([
      emp(co.name.toUpperCase(), 'Printed Name Differs', byNo.staffNo, sept((d) => (d === 6 || d === 7 ? { reason: 'RES' } : d === 9 ? { lateH: 1.5 } : d === 10 ? { reason: 'ABS' } : d === 11 ? { ot: [0, 2, 0, 0] } : {}))),
      emp(co.name, byName.name, 'NOPE-1', sept((d) => (d % 3 === 0 ? { lateH: 0.5 } : {}))),
      emp(co.name, 'Synthetic Stranger', 'NOPE-2', sept()),
    ]);
    return { ...f, co, byNo, byName, parsed };
  }

  it('previews where each employee goes without saving anything', async () => {
    const { ds, ar, user, co, byNo, byName, parsed } = setup();
    const p = await ar.preview(user('u-pwvsb-hr'), parsed, { sha256: SHA1 });
    expect(p.month).toBe('2026-09');
    // Two spellings of the company on the report: both go to the same Prima company (and are saved as one import).
    expect(p.companies).toEqual([
      expect.objectContaining({ companyId: co.id, how: 'name', canImport: true, employees: 1, matched: 1, unmatched: 0, existing: null }),
      expect.objectContaining({ companyId: co.id, how: 'name', canImport: true, employees: 2, matched: 1, unmatched: 1, existing: null }),
    ]);
    expect(p.rows.map((r) => [r.personId, r.how])).toEqual([[byNo.id, 'staff_no'], [byName.id, 'name'], [null, null]]);
    expect(p.unreadable).toHaveLength(1);
    expect(p.canSave).toBe(true);
    expect(ds.attendanceImports).toHaveLength(0);
  });

  it('saves the month once, refuses the same file again, and replaces the month only when asked', async () => {
    const { ds, ar, user, co, parsed } = setup();
    const hr = user('u-pwvsb-hr');
    const auditBefore = ds.audit.length;
    const first = await ar.save(hr, parsed, { name: 'sept.pdf', size: 1000, sha256: SHA1 }, {}, false);
    expect(first.imports).toEqual([expect.objectContaining({ companyId: co.id, employees: 3, days: 90, matched: 2, unmatched: 1, replacedId: null })]);
    expect(ds.attendanceDays).toHaveLength(90);
    expect(ds.attendanceDays.every((d) => d.companyId === co.id && d.importId === first.imports[0].id)).toBe(true);
    expect(ds.audit.length).toBe(auditBefore + 1);
    expect(ds.audit.at(-1)!.summary).not.toMatch(/Stranger/);

    await expect(ar.save(hr, parsed, { name: 'sept.pdf', size: 1000, sha256: SHA1 }, {}, true)).rejects.toMatchObject({ status: 409, code: 'same_file' });
    expect(await ar.fileKnown(hr, SHA1)).toMatchObject({ month: '2026-09', companyName: co.name });

    await expect(ar.save(hr, parsed, { name: 'sept-v2.pdf', size: 1000, sha256: SHA2 }, {}, false)).rejects.toMatchObject({ status: 409, code: 'needs_replace' });
    expect(ds.attendanceImports).toHaveLength(1);

    const second = await ar.save(hr, parsed, { name: 'sept-v2.pdf', size: 1000, sha256: SHA2 }, {}, true);
    expect(second.imports[0].replacedId).toBe(first.imports[0].id);
    expect(ds.attendanceImports.map((i) => i.status)).toEqual(['replaced', 'active']);
    // Nothing deleted: the old rows stay, the view reads only the active import.
    expect(ds.attendanceDays).toHaveLength(180);
    const o = await ar.overview(hr, {});
    expect(o.imports.map((i) => i.id)).toEqual([second.imports[0].id]);
    expect(o.rows).toHaveLength(3);
  });

  it('adds the month up for the view: tiles, trend, breakdowns and who is often late', async () => {
    const { ar, user, co, byName, parsed } = setup();
    const hr = user('u-pwvsb-hr');
    await ar.save(hr, parsed, { name: 'sept.pdf', size: 1000, sha256: SHA1 }, {}, false);
    const o = await ar.overview(hr, {});
    expect(o.month).toBe('2026-09');
    expect(o.months).toEqual(['2026-09']);
    expect(o.kpi).toMatchObject({ employees: 3, absent: 1, lateCount: 1 + 10, lateMin: 90 + 10 * 30, ot: [0, 2, 0, 0] });
    expect(o.kpi.present).toBe(30 - 3 + 30 + 30);
    expect(o.trend).toEqual([expect.objectContaining({ month: '2026-09', employees: 3 })]);
    expect(o.byCompany).toEqual([expect.objectContaining({ id: co.id, employees: 3 })]);
    expect(o.oftenLate[0]).toMatchObject({ personId: byName.id, totals: expect.objectContaining({ lateCount: 10 }) });
    expect(o.unmatched).toBe(1);
    expect(o.canImport).toBe(true);
    expect((await ar.overview(hr, { q: 'stranger' })).rows.map((r) => r.name)).toEqual(['Synthetic Stranger']);
    const dep = o.rows[0].department;
    expect((await ar.overview(hr, { department: dep })).rows.every((r) => r.department === dep)).toBe(true);

    const row = o.rows.find((r) => r.personId === byName.id)!;
    const p = await ar.person(hr, row.importId, row.key);
    expect(p.days).toHaveLength(30);
    expect(p.days[2]).toMatchObject({ date: '2026-09-03', lateMin: 30, kind: 'present' });
    expect(p.history.map((h) => h.month)).toEqual(['2026-09']);
    expect(p.person?.id).toBe(byName.id);
  });

  it('HR matches an unmatched employee once; the match is used for the view and every later import', async () => {
    const { ds, ar, user, co, parsed } = setup();
    const hr = user('u-pwvsb-hr');
    await ar.save(hr, parsed, { name: 'sept.pdf', size: 1000, sha256: SHA1 }, {}, false);
    const [u] = await ar.unmatched(hr);
    expect(u).toMatchObject({ companyId: co.id, name: 'Synthetic Stranger', key: 'code:NOPE2', months: ['2026-09'], days: 30 });
    const pick = ds.people.find((p) => p.companyId === co.id && p.name !== parsed.employees[1].name)!;
    expect((await ar.staffSearch(hr, co.id, pick.name.toLowerCase())).some((s) => s.id === pick.id)).toBe(true);
    expect((await ar.staffSearch(hr, co.id, pick.staffNo)).map((s) => s.id)).toContain(pick.id);
    await expect(ar.match(hr, co.id, u.key, ds.people.find((p) => p.companyId !== co.id)!.id)).rejects.toMatchObject({ code: 'other_company' });
    await ar.match(hr, co.id, u.key, pick.id);
    expect(await ar.unmatched(hr)).toHaveLength(0);
    expect((await ar.overview(hr, {})).rows.find((r) => r.key === u.key)?.personId).toBe(pick.id);
    // October's report: the stranger is matched by the remembered choice.
    const oct = report([emp(co.name, 'Synthetic Stranger', 'NOPE-2', [day('2026-10-01')], { periodFrom: '2026-10-01', periodTo: '2026-10-31' })]);
    const pv = await ar.preview(hr, oct, { sha256: SHA2 });
    expect(pv.rows[0]).toMatchObject({ personId: pick.id, how: 'remembered' });
    expect(ds.audit.filter((a) => a.action === 'attendance.report.match')).toHaveLength(1);
  });

  it('HR, the company manager and the owner import; others do not, and nobody imports for a company they cannot see', async () => {
    const { ar, user, co, parsed } = setup();
    for (const id of ['u-sv-sasa', 'u-it-mgr']) {
      await expect(ar.preview(user(id), parsed, { sha256: SHA1 })).rejects.toMatchObject({ status: 403 });
      await expect(ar.save(user(id), parsed, { name: 'x.pdf', size: 1, sha256: SHA1 }, {}, false)).rejects.toBeInstanceOf(AttendanceReportError);
    }
    // Another company's manager: the report's company is not theirs.
    const other = await ar.preview(user('u-cm-arsh'), parsed, { sha256: SHA1 });
    expect(other.companies[0]).toMatchObject({ companyId: null, canImport: false });
    await expect(ar.save(user('u-cm-arsh'), parsed, { name: 'x.pdf', size: 1, sha256: SHA1 }, {}, false)).rejects.toMatchObject({ code: 'no_company' });
    await expect(ar.save(user('u-cm-arsh'), parsed, { name: 'x.pdf', size: 1, sha256: SHA1 }, { [parsed.employees[0].company]: co.id }, false)).rejects.toMatchObject({ code: 'company_hidden' });
    // The company's own manager and the owner may.
    expect((await ar.preview(user('u-cm-sasa'), parsed, { sha256: SHA1 })).canSave).toBe(true);
    const saved = await ar.save(user('u-fauzan'), parsed, { name: 'x.pdf', size: 1, sha256: SHA1 }, {}, false);
    expect(saved.imports[0].companyId).toBe(co.id);
    // Seeing it: the manager yes; another company's manager and a supervisor see nothing of it.
    expect((await ar.overview(user('u-cm-sasa'), {})).rows).toHaveLength(3);
    expect((await ar.overview(user('u-cm-arsh'), {})).rows).toHaveLength(0);
    expect((await ar.overview(user('u-sv-sasa'), {})).rows).toHaveLength(0);
    await expect(ar.overview(user('u-cm-arsh'), { companyId: co.id })).rejects.toThrow(/Not allowed/);
    await expect(ar.person(user('u-cm-arsh'), saved.imports[0].id, employeeKey(parsed.employees[0]))).rejects.toMatchObject({ status: 404 });
    await expect(ar.match(user('u-sv-sasa'), co.id, 'code:NOPE2', 'p')).rejects.toThrow(/Not allowed/);
  });

  it('a company chosen by hand is used when the printed name does not match', async () => {
    const { ar, user, co } = setup();
    const parsed = report([emp('SYNTHETIC PRINTED HOLDINGS', 'Synthetic One', null, sept())]);
    const hr = user('u-pwvsb-hr');
    const p = await ar.preview(hr, parsed, { sha256: SHA1 });
    expect(p.companies[0]).toMatchObject({ companyId: null, canImport: false });
    expect(p.canSave).toBe(false);
    expect(p.choices.some((c) => c.id === co.id)).toBe(true);
    const p2 = await ar.preview(hr, parsed, { sha256: SHA1 }, { 'SYNTHETIC PRINTED HOLDINGS': co.id });
    expect(p2.companies[0]).toMatchObject({ companyId: co.id, how: 'chosen', canImport: true });
    expect(p2.canSave).toBe(true);
  });
});
