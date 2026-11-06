// P81: the attendance report parser (attendance-pdf.ts) on SYNTHETIC PDFs in the InfoTech layout. No real report.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { employeeTotals, totalsAddUp } from '@prima/core';
import { parseAttendancePdf } from '../src/attendance-pdf';
import { pdfOf, synDay, syntheticReport, type SynEmployee } from './synthetic-attendance-pdf';

const MM = '03';
const YYYY = '2026';
const month = (n: number, f: (d: number) => Parameters<typeof synDay>[3] = () => ({})) => Array.from({ length: n }, (_, i) => synDay(i + 1, MM, YYYY, f(i + 1)));

const alice: SynEmployee = {
  code: 'SYN0001',
  name: 'SYNTHETIC ALICE BINTI EXAMPLE',
  designation: 'ADMIN EXECUTIVE',
  days: month(31, (d) => (d === 7 || d === 8 ? { reason: 'RES' } : d === 10 ? { reason: 'ABS' } : d === 11 ? { reason: 'AL' } : d === 12 ? { late: 0.5, in: '8.30' } : d === 13 ? { early: 1, out: '16.00' } : d === 14 ? { ot: [0, 2, 0, 0], meal: 5 } : {})),
  monthly: [50, 0, 30, 0, 0, 12.5],
};

describe('attendance report parser (synthetic PDF)', () => {
  it('reads employees, days, totals and the monthly block in the plain layout', async () => {
    const bob: SynEmployee = { code: 'SYN0002', name: 'SYNTHETIC BOB BIN SAMPLE', designation: 'NONE', days: month(31, (d) => (d % 7 === 0 ? { reason: 'RES' } : {})) };
    const pdf = syntheticReport({ company: 'SYNTHETIC GUARD SDN BHD', from: `01-${MM}-${YYYY}`, to: `31-${MM}-${YYYY}`, employees: [alice, bob] });
    const pages: number[] = [];
    const r = await parseAttendancePdf(pdf, (p) => pages.push(p.page));
    assert.deepEqual(pages, [1, 2]);
    assert.equal(r.pages, 2);
    assert.match(r.title ?? '', /Individual Attendance Report/);
    assert.deepEqual(r.unreadable, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.employees.length, 2);
    const [a, b] = r.employees;
    assert.equal(a.company, 'SYNTHETIC GUARD SDN BHD');
    assert.equal(a.empCode, 'SYN0001');
    assert.equal(a.name, 'SYNTHETIC ALICE BINTI EXAMPLE');
    assert.equal(a.designation, 'ADMIN EXECUTIVE');
    assert.equal(b.designation, null, 'NONE is no designation');
    assert.equal(a.periodFrom, '2026-03-01');
    assert.equal(a.periodTo, '2026-03-31');
    assert.equal(a.days.length, 31);
    const d12 = a.days.find((d) => d.date === '2026-03-12')!;
    assert.equal(d12.in, '08:30');
    assert.equal(d12.out, '17:00');
    assert.equal(d12.shift, 'S01');
    assert.equal(d12.lateH, 0.5);
    const d14 = a.days.find((d) => d.date === '2026-03-14')!;
    assert.deepEqual(d14.ot, [0, 2, 0, 0]);
    assert.equal(d14.allow.meal, 5);
    assert.equal(a.days.find((d) => d.date === '2026-03-10')!.reason, 'ABS');
    assert.equal(a.days.find((d) => d.date === '2026-03-07')!.in, null, '0.00 is no time');
    assert.deepEqual(a.monthly, { attendance: 50, health: 0, transport: 30, meal: 0, other1: 0, other2: 12.5 });
    assert.equal(totalsAddUp(a), true);
    const t = employeeTotals(a);
    assert.equal(t.present, 31 - 4);
    assert.equal(t.rest, 2);
    assert.equal(t.absent, 1);
    assert.equal(t.leave, 1);
    assert.equal(t.lateCount, 1);
    assert.equal(t.lateMin, 30);
    assert.equal(t.earlyCount, 1);
    assert.equal(t.earlyMin, 60);
    assert.equal(t.ot[1], 2);
    assert.equal(t.monthlyAllowances, 92.5);
  });

  it('reads the "Actual Clock" layout, an employee over two pages and a monthly block on its own page', async () => {
    const carol: SynEmployee = {
      code: 'SYN0003',
      name: 'SYNTHETIC CAROL',
      designation: 'GUARD',
      days: month(31, (d) => (d === 2 ? { clocks: ['7.58', '12.01', '13.00', '17.02'], in: '7.58', out: '17.02' } : {})),
      splitAfter: 20,
      monthlyOnNextPage: true,
      monthly: [10, 0, 0, 0, 0, 0],
    };
    const pdf = syntheticReport({ company: 'SYNTHETIC GUARD SDN BHD', from: `01-${MM}-${YYYY}`, to: `31-${MM}-${YYYY}`, employees: [carol, alice], clocks: true });
    const r = await parseAttendancePdf(pdf);
    assert.deepEqual(r.unreadable, []);
    assert.equal(r.employees.length, 2);
    const c = r.employees[0];
    assert.equal(c.days.length, 31);
    assert.deepEqual(c.pages, [1, 2, 3]);
    assert.deepEqual(c.days[1].clocks, ['07:58', '12:01', '13:00', '17:02']);
    assert.equal(c.days[1].in, '07:58');
    assert.deepEqual(c.days[0].clocks, []);
    assert.equal(c.monthly?.attendance, 10);
    assert.equal(totalsAddUp(c), true);
    assert.equal(r.employees[1].days.length, 31);
    assert.equal(totalsAddUp(r.employees[1]), true);
  });

  it('lists unreadable pages with the reason and flags totals that do not add up', async () => {
    const wrong: SynEmployee = { ...alice, code: 'SYN0004', wrongTotals: true };
    const blank: { x: number; y: number; s: string }[] = [];
    const junk = [{ x: 40, y: 40, s: 'Some other document altogether' }];
    const orphan = [{ x: 12, y: 132, s: '01-03-2026' }, { x: 89, y: 132, s: 'Sun' }, { x: 130, y: 132, s: '8.00' }, { x: 160, y: 132, s: '17.00' }];
    const pdf = syntheticReport({ company: 'SYNTHETIC GUARD SDN BHD', from: `01-${MM}-${YYYY}`, to: `31-${MM}-${YYYY}`, employees: [wrong], extraPages: [blank, junk] });
    const r = await parseAttendancePdf(pdf);
    assert.equal(r.employees.length, 1);
    assert.equal(totalsAddUp(r.employees[0]), false);
    assert.deepEqual(
      r.unreadable.map((u) => u.page),
      [2, 3],
    );
    assert.match(r.unreadable[0].reason, /no text/);
    assert.match(r.unreadable[1].reason, /Nothing on this page/);
    // Day rows before any employee line.
    const r2 = await parseAttendancePdf(pdfOf([orphan]));
    assert.equal(r2.employees.length, 0);
    assert.match(r2.unreadable[0]?.reason ?? '', /no employee line/);
  });

  it('leaves out a day row it cannot split and says so, keeping the rest', async () => {
    const days = month(5);
    days[2] = { ...days[2], in: 'xx' };
    const pdf = syntheticReport({ company: 'SYNTHETIC GUARD SDN BHD', from: `01-${MM}-${YYYY}`, to: `31-${MM}-${YYYY}`, employees: [{ code: 'SYN0005', name: 'SYNTHETIC DAN', designation: 'GUARD', days }] });
    const r = await parseAttendancePdf(pdf);
    assert.equal(r.employees[0].days.length, 4);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0].reason, /03-03-2026/);
    assert.equal(totalsAddUp(r.employees[0]), false, 'a left-out row shows as totals that do not add up');
  });

  it('refuses a file that is not a PDF', async () => {
    await assert.rejects(parseAttendancePdf(new Uint8Array(Buffer.from('not a pdf at all'))), /could not be opened as a PDF/);
  });

  it('reads a long report quickly with bounded memory', async () => {
    const emps: SynEmployee[] = Array.from({ length: 300 }, (_, i) => ({ code: `SYN${String(i + 10).padStart(4, '0')}`, name: `SYNTHETIC PERSON ${i}`, designation: 'GUARD', days: month(31) }));
    const pdf = syntheticReport({ company: 'SYNTHETIC GUARD SDN BHD', from: `01-${MM}-${YYYY}`, to: `31-${MM}-${YYYY}`, employees: emps });
    const t0 = Date.now();
    const r = await parseAttendancePdf(pdf);
    assert.equal(r.employees.length, 300);
    assert.equal(r.employees.reduce((n, e) => n + e.days.length, 0), 300 * 31);
    assert.ok(Date.now() - t0 < 60_000, 'well under a minute for 300 pages');
  });
});
