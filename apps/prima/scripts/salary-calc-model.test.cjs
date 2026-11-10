// P97: the salary calculator's deduction and employer estimate is the guard pay run's own statutory sums. For the same
// month of work, the calculator's EPF, SOCSO, EIS, LINDUNG, PCB, HRD, deductions, net pay and employer share equal what
// buildGuardPayLine (core guard-pay.ts) works out. Synthetic people and shifts only. Needs `npm run build -w @prima/core`.
// Run: node --test scripts/salary-calc-model.test.cjs (from apps/prima).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const core = require('../packages/core/dist/index.js');

const src = fs.readFileSync(path.join(__dirname, '../apps/web/src/views/salary-calc-model.ts'), 'utf8');
const model = {};
vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: model,
  require: (id) => {
    if (id === '@prima/core') return core;
    throw Error(id);
  },
});

const PERIOD = '2026-10';
const NOW = core.myt('2026-11-05', '10:00');
const formula = (amounts) => ({ id: 'pf-t', code: 'T-1', version: 1, kind: 'guard_shift', name: 'Test 12-hour', effectiveFrom: '2026-10', amounts, status: 'live', reason: 'test', preparedBy: 't', preparedById: 't', preparedAt: NOW, decidedBy: 't', decidedById: 't', decidedAt: NOW, decisionNote: null, lawFlags: [] });
const person = (over = {}) => ({ id: 'p1', companyId: 'c1', branchId: 'b1', staffNo: 'T001', name: 'Test Guard', nationality: 'MY', idMasked: '****', dob: '1990-01-01', phone: '', role: 'guard', status: 'active', hiredOn: '2025-01-01', faceEnrolledOn: null, lindungOptOut: false, bank: { bank: 'Test Bank', accountMasked: '****0001' }, ...over });
const days = (n) =>
  Array.from({ length: n }, (_, k) => {
    const date = `2026-10-${String(1 + k).padStart(2, '0')}`;
    const shift = { id: `sh-${date}`, companyId: 'c1', siteId: 's1', postId: 'x', personId: 'p1', date, start: core.myt(date, '07:00'), end: core.myt(date, '19:00'), status: 'published' };
    return { a: { id: `at-${date}`, companyId: 'c1', siteId: 's1', shiftId: shift.id, personId: 'p1', deviceId: 'd', clockIn: shift.start, clockOut: shift.end, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true }, shift };
  });
const payLine = (n, amounts, p) =>
  core.buildGuardPayLine({ person: person(p), period: PERIOD, attendance: days(n), leaves: [], holidays: [], formulaAt: () => ({ formula: formula(amounts), scope: 'Whole group' }), siteName: (id) => id, utility: [] });

const std = core.standardGuardAmounts(2);
const cases = [
  { name: 'Malaysian, full month', worked: 26, calc: { daysWorked: '26' }, amounts: std },
  { name: 'Malaysian, two rest days worked', worked: 28, calc: { daysWorked: '26', restDaysWorked: '2' }, amounts: std },
  { name: 'Malaysian, 2.5 h rest, short month', worked: 22, calc: { daysWorked: '22' }, amounts: core.standardGuardAmounts(2.5) },
  { name: 'Nepali worker', worked: 26, calc: { daysWorked: '26' }, amounts: std, p: { nationality: 'NP' }, about: { nationality: 'NP' } },
  { name: 'aged 60 or over', worked: 26, calc: { daysWorked: '26' }, amounts: std, p: { dob: '1965-01-01' }, about: { ageGroup: 'from60' } },
  { name: 'LINDUNG opted out', worked: 26, calc: { daysWorked: '26' }, amounts: std, p: { lindungOptOut: true }, about: { lindungOptOut: true } },
  {
    name: 'ACT formula with an allowance, rest-day pay outside EPF',
    worked: 27,
    calc: { daysWorked: '26', restDaysWorked: '1' },
    amounts: { ...std, basicMonthly: 2400, fixedAllowances: [{ label: 'Site allowance', amount: 200 }], epfOnRestHolidayPay: false },
  },
];

for (const c of cases)
  test(`calculator estimate equals the guard pay run: ${c.name}`, () => {
    const l = payLine(c.worked, c.amounts, c.p);
    const m = model.salaryCalcModel(c.amounts, String(c.amounts.basicMonthly), { ...model.START_DAYS, ...c.calc }, core.DEFAULT_PAY_LAW, { ...model.START_ABOUT, ...c.about }, PERIOD);
    const ded = Object.fromEntries(m.deductions.map((d) => [d.key, d.amount]));
    const er = Object.fromEntries(m.employer.map((d) => [d.key, d.amount]));
    assert.equal(m.calc.gross, l.gross, 'gross');
    assert.equal(m.epfWages, l.epfWages, 'EPF wages');
    assert.deepEqual(
      { epf: ded.epf, socso: ded.socso, eis: ded.eis, lindung: ded.lindung, pcb: ded.pcb },
      { epf: l.epfEe, socso: l.socsoEe, eis: l.eisEe, lindung: l.lindungEe, pcb: l.pcb },
      'employee shares',
    );
    assert.deepEqual({ epf: er.epf, socso: er.socso, eis: er.eis, hrd: er.hrd }, { epf: l.epfEr, socso: l.socsoEr, eis: l.eisEr, hrd: l.hrd }, 'employer shares');
    assert.equal(m.totalDeductions, l.deductions, 'deductions');
    assert.equal(m.net, l.net, 'net pay');
    const lineEmployer = Math.round((l.epfEr + l.socsoEr + l.eisEr + l.hrd) * 100) / 100;
    assert.equal(m.totalEmployer, lineEmployer, 'employer share');
  });

test('the full-month standard case reads as the pay run test expects (RM 2,550 gross, EPF on RM 1,700 only)', () => {
  const m = model.salaryCalcModel(std, '1,700.00', model.START_DAYS, core.DEFAULT_PAY_LAW, model.START_ABOUT, PERIOD);
  assert.equal(m.calc.gross, 2550);
  assert.equal(m.epfWages, 1700);
  assert.equal(m.deductions.find((d) => d.key === 'epf').amount, 187);
  assert.equal(m.deductions.find((d) => d.key === 'socso').amount, 12.75);
  assert.equal(m.employerCost, Math.round((m.calc.gross + m.totalEmployer) * 100) / 100);
});
