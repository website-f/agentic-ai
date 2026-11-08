/**
 * RBA readiness (Fauzan, 8 Nov 2026, "Yes" to the build order after the RBA Code of Conduct v8.0 checklist review):
 *
 *  2. The trace review: ACT picks about 20 workers, foreign guards first, and lines up roster, clock, overtime, pay,
 *     payslip and bank payment for one month. "Does the document say the same thing as what actually happened?"
 *  3. One worker master file page for each foreign worker, in the checklist's nine folders, filled from records Prima
 *     already keeps. A missing record shows as missing, never as fine.
 *  5. A staff ethics declaration, signed once on entering service (Fauzan, 8 Nov 2026).
 *  7. The monthly RBA dashboard with the checklist's nine targets. A target with no data source is unknown, not green.
 *
 * Pure functions only; the service reads the records and checks who may see them. Nothing here pays, files, certifies
 * or contacts anyone. The thresholds are in RULES.RBA-READY (approved by Fauzan, 8 Nov 2026).
 */
import type { GuardPayLine, GuardPayRun } from './guard-pay';
import type { Attendance, Credential, FwRecruitFile, FwRenewal, FwWelfareCheck, HostelStay, IsoDate, Person, RbaTraceRow, Shift, StaffTraining } from './types';
import { addDays, dateOf } from './time';

const r1 = (n: number) => Math.round(n * 10) / 10;
const hoursBetween = (a: string, b: string) => {
  const h = (Date.parse(b) - Date.parse(a)) / 3_600_000;
  return h > 0 && h < 24 ? h : 0;
};

// ---------- 2. Trace review ----------

export interface TraceInput {
  person: Person;
  /** YYYY-MM */
  period: string;
  /** The person's published shifts in the month. */
  shifts: Shift[];
  /** The person's attendance in the month. */
  attendance: Attendance[];
  run: GuardPayRun | null;
  line: GuardPayLine | null;
  today: IsoDate;
  normalHoursPerDay: number;
  /** Hours of difference that count as a mismatch (roster against clock, overtime clocked against paid). */
  toleranceHours: number;
}

/** The 7th of the month after the period: wages are due by then (EA s.19). */
export function wagesDueOn(period: string): IsoDate {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
}

/** One worker's month, line by line, and where the records disagree. */
export function traceRow(i: TraceInput): RbaTraceRow {
  const p = i.person;
  const rosterHours = i.shifts.reduce((n, s) => n + hoursBetween(s.start, s.end), 0);
  const rosterDays = new Set(i.shifts.map((s) => s.date)).size;
  const perDay = new Map<IsoDate, number>();
  for (const a of i.attendance) {
    if (!a.clockIn || !a.clockOut) continue;
    const d = dateOf(a.clockIn);
    perDay.set(d, (perDay.get(d) ?? 0) + hoursBetween(a.clockIn, a.clockOut));
  }
  const clockedHours = [...perDay.values()].reduce((n, h) => n + h, 0);
  const clockedDays = [...perDay.values()].filter((h) => h > 0).length;
  const clockedOtHours = [...perDay.values()].reduce((n, h) => n + Math.max(0, h - i.normalHoursPerDay), 0);
  const noClockOut = i.attendance.filter((a) => a.clockIn && !a.clockOut).length;
  const mismatches: string[] = [];
  if (Math.abs(rosterHours - clockedHours) > i.toleranceHours)
    mismatches.push(`The roster says ${r1(rosterHours)} hours; the clock says ${r1(clockedHours)} hours.`);
  if (noClockOut) mismatches.push(`${noClockOut} shift${noClockOut === 1 ? '' : 's'} with no clock-out.`);
  const line = i.line;
  const run = i.run;
  let paid: RbaTraceRow['paid'] = 'no_run';
  if (!line || !run) {
    if (clockedDays) mismatches.push('Worked this month, but no pay run line.');
  } else {
    if (line.daysWorked !== clockedDays) mismatches.push(`Clocked on ${clockedDays} days; paid for ${line.daysWorked} days worked.`);
    if (Math.abs(line.otHours - clockedOtHours) > i.toleranceHours)
      mismatches.push(`Overtime clocked about ${r1(clockedOtHours)} hours; overtime paid ${r1(line.otHours)} hours.`);
    paid = run.paid ? 'paid' : run.trial ? 'trial' : 'not_paid';
    if (paid === 'not_paid' && i.today > wagesDueOn(i.period)) mismatches.push(`Not paid by ${wagesDueOn(i.period)}.`);
    if (line.accountProblem) mismatches.push(`Pay account: ${line.accountProblem}`);
  }
  return {
    personId: p.id,
    staffNo: p.staffNo,
    name: p.name,
    nationality: p.nationality,
    rosterHours: r1(rosterHours),
    rosterDays,
    clockedHours: r1(clockedHours),
    clockedDays,
    clockedOtHours: r1(clockedOtHours),
    payDays: line ? line.daysWorked : null,
    payOtHours: line ? line.otHours : null,
    net: line ? line.net : null,
    paid,
    bankRef: run?.paid?.bankRef ?? null,
    accountProblem: line?.accountProblem ?? null,
    mismatches,
    outcome: null,
  };
}

/** A stable mix for the month, so each month's sample differs but the same month gives the same sample. */
const mix = (s: string) => {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619) >>> 0;
  return h;
};

/** The sample: active guards and officers, foreign workers first, then the rest, up to `size`. */
export function pickTraceSample(people: Person[], period: string, size: number): Person[] {
  const pool = people.filter((p) => p.role !== 'office' && p.status !== 'left');
  const order = (list: Person[]) => [...list].sort((a, b) => mix(`${period}|${a.id}`) - mix(`${period}|${b.id}`) || a.id.localeCompare(b.id));
  return [...order(pool.filter((p) => p.nationality !== 'MY')), ...order(pool.filter((p) => p.nationality === 'MY'))].slice(0, size);
}

// ---------- 3. Worker master file ----------

export type FolderState = 'ok' | 'missing' | 'in_ja' | 'na';

export interface WorkerFolder {
  key: string;
  label: string;
  state: FolderState;
  detail: string;
}

export interface WorkerFileInput {
  person: Person;
  today: IsoDate;
  renewals: FwRenewal[];
  recruit: FwRecruitFile | null;
  /** The newest pay line with its period and whether it was paid. */
  pay: { period: string; line: GuardPayLine; paid: boolean; trial: boolean } | null;
  /** Clock-ins in the last 30 days. */
  attendance30: number;
  /** Published shifts in the last 30 days and the next 7. */
  shifts30: number;
  stays: HostelStay[];
  /** The newest hostel inspection date for the hostel the worker lives in, if any. */
  hostelInspectedOn: IsoDate | null;
  training: StaffTraining[];
  credentials: Credential[];
  welfare: FwWelfareCheck[];
  disciplineCount: number;
}

export const WORKER_FOLDERS: { key: string; label: string }[] = [
  { key: 'identity', label: '01 Identity' },
  { key: 'recruitment', label: '02 Recruitment' },
  { key: 'employment', label: '03 Employment' },
  { key: 'payroll', label: '04 Payroll' },
  { key: 'attendance', label: '05 Attendance' },
  { key: 'accommodation', label: '06 Accommodation' },
  { key: 'training', label: '07 Training' },
  { key: 'grievance', label: '08 Grievance and discipline' },
  { key: 'exit', label: '09 Exit' },
];

/** Where each folder of a foreign worker's file stands, from the records Prima keeps. */
export function workerFile(i: WorkerFileInput): WorkerFolder[] {
  const p = i.person;
  const f = (key: string, state: FolderState, detail: string): WorkerFolder => ({ key, label: WORKER_FOLDERS.find((x) => x.key === key)!.label, state, detail });
  const latest = (paper: FwRenewal['paper']) => i.renewals.filter((r) => r.paper === paper).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0] ?? null;
  const passport = latest('PASSPORT');
  const permit = latest('PLKS_PERMIT');
  const idMissing = [!passport ? 'passport' : passport.expiresOn < i.today ? 'passport expired' : '', !permit ? 'work permit' : permit.expiresOn < i.today ? 'work permit expired' : ''].filter(Boolean);
  const agreement = (p.hiringDocs ?? []).find((d) => d.kind === 'AGREEMENT' && d.docIds.length);
  const contractStep = i.recruit?.steps.CONTRACT;
  const langs = contractStep?.languages ?? [];
  const recruitSteps = i.recruit ? (['AGENCY_LICENCE', 'EMBASSY', 'INTERVIEW', 'AGE', 'CONTRACT'] as const).filter((s) => !i.recruit!.steps[s]?.passed) : null;
  const fee = i.welfare.filter((w) => w.kind === 'ARRIVAL_FEE');
  const openFee = fee.some((w) => w.status === 'open');
  const passportCheck = i.welfare.filter((w) => w.kind === 'PASSPORT').sort((a, b) => b.checkedOn.localeCompare(a.checkedOn))[0] ?? null;
  const stay = i.stays.find((s) => s.from <= i.today && (!s.to || s.to >= i.today)) ?? null;
  const csg = i.credentials.some((c) => c.type === 'CSG_TRAINING');
  const openConcerns = i.welfare.filter((w) => w.kind === 'WELFARE' && w.status === 'open').length;
  return [
    f(
      'identity',
      idMissing.length ? 'missing' : 'ok',
      idMissing.length
        ? `No ${idMissing.join(', ')} on the FWM board`
        : `Passport to ${passport!.expiresOn}, permit to ${permit!.expiresOn}${passportCheck ? `; passport held by the ${passportCheck.heldBy ?? 'worker'} (checked ${passportCheck.checkedOn})` : '; no passport location check yet'}`,
    ),
    f(
      'recruitment',
      !i.recruit ? 'missing' : recruitSteps!.length || openFee || !fee.length ? 'missing' : 'ok',
      !i.recruit
        ? 'No recruitment steps record (recruited before Prima, or not linked)'
        : [recruitSteps!.length ? `Steps not passed: ${recruitSteps!.join(', ').toLowerCase().replace(/_/g, ' ')}` : 'All recruitment steps passed', !fee.length ? 'no arrival fee check' : openFee ? 'a fee found is not repaid yet' : 'no fee paid'].join('; '),
    ),
    f(
      'employment',
      agreement && (p.nationality === 'MY' || langs.length) ? 'ok' : 'missing',
      [agreement ? 'Signed agreement on file' : 'No signed agreement on file', p.nationality === 'MY' ? '' : langs.length ? `contract in ${langs.join(', ')}` : 'contract language not recorded'].filter(Boolean).join('; '),
    ),
    f(
      'payroll',
      i.pay ? (i.pay.trial ? 'in_ja' : i.pay.paid ? 'ok' : 'missing') : 'in_ja',
      i.pay ? `${i.pay.period}: net RM${i.pay.line.net.toFixed(2)}, ${i.pay.line.otHours} overtime hours; ${i.pay.trial ? 'trial run, JA paid' : i.pay.paid ? 'paid with bank reference' : 'not paid yet'}` : 'No Prima pay run; JA pays guards today',
    ),
    f('attendance', i.attendance30 ? 'ok' : i.shifts30 ? 'missing' : 'in_ja', i.attendance30 ? `${i.attendance30} clock-ins in 30 days, ${i.shifts30} shifts rostered` : i.shifts30 ? `${i.shifts30} shifts rostered but no clock-in` : 'No Prima roster or clock-in; JA keeps it today'),
    f(
      'accommodation',
      !stay ? 'na' : i.hostelInspectedOn && i.hostelInspectedOn >= addDays(i.today, -365) ? 'ok' : 'missing',
      !stay ? 'Not living in a company hostel' : i.hostelInspectedOn ? `Living in the hostel since ${stay.from}; hostel inspected ${i.hostelInspectedOn}` : `Living in the hostel since ${stay.from}; no hostel inspection in the last year`,
    ),
    f('training', csg || i.training.length ? 'ok' : 'missing', [csg ? 'CSG done' : 'No CSG record', i.training.length ? `${i.training.length} training record${i.training.length === 1 ? '' : 's'}` : ''].filter(Boolean).join('; ')),
    f(
      'grievance',
      openConcerns ? 'missing' : 'ok',
      `${openConcerns} open welfare concern${openConcerns === 1 ? '' : 's'}; ${i.disciplineCount} discipline step${i.disciplineCount === 1 ? '' : 's'}`,
    ),
    f('exit', p.status === 'left' ? 'missing' : 'na', p.status === 'left' ? 'Left: attach the final pay and the repatriation or transfer papers on the FWM board' : 'Still working'),
  ];
}

// ---------- 5. Staff ethics declaration (once, on entering service) ----------

export const ETHICS_STATEMENTS: { key: string; text: string }[] = [
  { key: 'bribery', text: 'I will not give or take a bribe, kickback or improper gift, and I will report any offer (MACC Act 2009).' },
  { key: 'gifts', text: 'I will declare gifts and hospitality as the group rules say.' },
  { key: 'confidential', text: 'I will keep client and worker information confidential and use it only for my work.' },
  { key: 'respect', text: 'I will not harass, threaten or discriminate against anyone at work.' },
  { key: 'speakup', text: 'I know how to report a concern without giving my name, and I will not punish anyone who reports one.' },
  { key: 'interests', text: 'I have declared below every interest that could conflict with my work, or that I have none.' },
];

// ---------- 7. Monthly RBA dashboard ----------

export interface RbaKpi {
  key: string;
  label: string;
  /** Percent for the 100% targets, a count for the zero targets; null when there is no data to count from. */
  value: number | null;
  target: number;
  unit: 'pct' | 'count';
  state: 'green' | 'red' | 'unknown';
  detail: string;
}

/** A 100% target: green only at the target, unknown with nothing to count. */
export function pctKpi(key: string, label: string, done: number, of: number, detail: string): RbaKpi {
  if (!of) return { key, label, value: null, target: 100, unit: 'pct', state: 'unknown', detail: `${detail} (nothing to count yet)` };
  const value = Math.floor((done / of) * 1000) / 10;
  return { key, label, value, target: 100, unit: 'pct', state: done >= of ? 'green' : 'red', detail: `${done} of ${of}. ${detail}` };
}

/** A zero target: green only at zero, unknown when there is no data source. */
export function zeroKpi(key: string, label: string, count: number | null, detail: string): RbaKpi {
  if (count === null) return { key, label, value: null, target: 0, unit: 'count', state: 'unknown', detail };
  return { key, label, value: count, target: 0, unit: 'count', state: count === 0 ? 'green' : 'red', detail };
}
