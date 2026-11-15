import { DEFAULT_PAY_LAW, ORP_DIVISOR, guardOtHoursPerDay, guardWorkedHours, type PayFormula, type PayLawSettings } from './pay-formulas';
import { eisShare, epfShare, hrdLevy, lindungShare, otherShares, payAccountCheck, pcbEstimate, periodEnd, socsoShare } from './payroll';
import { DEFAULT_STATUTORY, type StatutorySettings } from './statutory';
import { holidayPayLost } from './public-holidays';
import { ageOn } from './time';
import { hybridPay, hybridSettingsCheck, type HybridDuty, type HybridSettings, type LumpSumAgreement, type RosterStatus, type allowanceLines } from './roster-engine';
import type { Attendance, Id, IsoDate, IsoDateTime, LeaveRequest, Nationality, PayAccount, Person, PersonRole, Shift, UtilityCharge } from './types';

/**
 * Prima's own monthly guard pay run (Fauzan, 5 Nov 2026, third audit item 1: "Build"). Guards, stationed officers and
 * patrolling officers are paid from their attendance under the ACT pay formula used where they work (PR #112). HR
 * prepares each company's month, the COO approves (rule PAY-COO-GUARD, Fauzan 26 Oct 2026), and Finance pays through
 * the bank. Prima drafts the bank file and the statutory lists; it never pays or files anything itself.
 *
 * While the JA Group app still pays guards, a run is a side-by-side trial: Finance cannot mark it paid and the bank file
 * says it must not be uploaded (rule PAY-GUARD, primaPays off; Fauzan, 8 Nov 2026: Prima takes over on switchDate 2027-08-01).
 */

// Pre-repair unpaid snapshots must be recalculated before approval or payment.
// 3 (B1b, 14 Nov 2026): every line carries hours recorded vs hours paid; older drafts must be recalculated.
export const GUARD_PAY_CALCULATION_VERSION = 3;

export type GuardPayStage = 'draft' | 'submitted' | 'approved' | 'paid';

export interface GuardPayStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

/** One line of a guard's pay: what it is, how many, at what rate. Overtime lines are not wages for EPF. */
export interface GuardPayItem {
  label: string;
  kind: 'basic' | 'unpaid' | 'ot' | 'rest_day' | 'holiday' | 'allowance' | 'extra' | 'advance' | 'loan' | 'arrival';
  qty: number | null;
  unit: 'day' | 'hour' | null;
  rate: number | null;
  amount: number;
}

export interface GuardPayLine {
  calculationVersion?: number;
  /** Holds are calculation/data problems, distinct from advisory legal flags. */
  holds?: string[];
  /** Part O exception list (unverified duties, roster leave not backed by a leave record): shown, never holding the line. */
  exceptions?: string[];
  /**
   * Absences still waiting for the OD/OGM decision (paid or unpaid). Fauzan, 15 Nov 2026 ("Only that guard's pay
   * waits"): such a line is kept out of the company's run, which pays everyone else; the guard is paid in a later run
   * for the same month once the OD/OGM decides.
   */
  waiting?: string[];
  missingFormulaSites?: Id[];
  personId: Id;
  staffNo: string;
  name: string;
  role: PersonRole;
  age: number;
  nationality: Nationality;
  /** The site the guard worked most days at this month; its formula pays the month. */
  mainSiteId: Id | null;
  mainSiteName: string;
  formulaCode: string | null;
  formulaVersion: number | null;
  formulaName: string;
  /** Where the formula choice came from: site, company, region or the whole group. */
  formulaScope: string | null;
  // Days, from locked attendance, approved leave and the holidays HR entered for the month.
  fullMonthDays: number;
  daysWorked: number;
  normalDays: number;
  restDaysWorked: number;
  holidaysWorked: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unpaidDays: number;
  otHours: number;
  dailyRate: number;
  hourlyRate: number;
  items: GuardPayItem[];
  gross: number;
  /** Gross less overtime: EPF is not charged on overtime (KWSP). */
  epfWages: number;
  epfEe: number;
  epfEr: number;
  socsoEe: number;
  socsoEr: number;
  /** LINDUNG 24 Jam, employee only, kept apart from normal SOCSO (Fauzan, 27 Oct 2026). */
  lindungEe: number;
  lindungRate: number;
  lindungStatus: 'deducted' | 'opted_out' | 'not_started';
  eisEe: number;
  eisEr: number;
  hrd: number;
  pcb: number;
  pcbSource: 'estimate' | 'entered';
  /** Hostel utility excess HR chose to deduct this month (contract utility clause). */
  utilityIds: Id[];
  utility: number;
  /** One-off minus items HR entered with a reason, taken after the statutory shares. */
  otherDeductions: number;
  /** New contribution types the CEO added (Fauzan, 6 Nov 2026), employee and employer shares. */
  others?: { code: string; name: string; payee: string; ee: number; er: number }[];
  /** Wage advances paid this month (Fauzan, 6 Nov 2026), taken back from the net pay. */
  advance?: number;
  advanceIds?: Id[];
  /** Approved advance and loan scheme repayments taken this month (Fauzan, 6 Nov 2026), within the 50% cap. */
  loan?: number;
  arrivalParts?: { id: string; amount: number; balanceBefore: number; totalDisbursed: number; policyId: string; recoveryAccount: string }[];
  loanParts?: { id: Id; amount: number }[];
  /** The public holidays this line was paid on (the guard list of the main site's state), and any lost under s.60D(2). */
  holidayDates?: IsoDate[];
  holidaysLost?: IsoDate[];
  deductions: number;
  net: number;
  bank: PayAccount | null;
  /** Why the account cannot be paid into (no account, or someone else's without written consent); null when it can. */
  accountProblem?: string | null;
  /** Shifts that cannot be paid yet, by reason, so HR can chase the supervisor. */
  unlockedShifts: number;
  noClockOut: number;
  flags: string[];
  /**
   * B1b (Fauzan, 11 Nov 2026: "Salary and total working hours must match"). Hours recorded (locked attendance inside
   * the shift, plus paid leave and paid holidays at their set hours) beside hours paid (normal, overtime, rest-day and
   * public-holiday hours). A line that does not match is held: fix the attendance or leave record, never the pay line.
   */
  hours?: GuardPayHours;
}

export interface GuardPayHours {
  recorded: number;
  paid: number;
  /** Of the hours recorded: duty hours from locked attendance, and paid leave and holiday hours at the set hours. */
  duty: number;
  leave: number;
  holiday: number;
  /** Of the hours paid. */
  normal: number;
  ot: number;
  restDay: number;
  publicHoliday: number;
  match: boolean;
  /** Why the hours could not be compared (no formula, or the formula has no shift length). */
  notCompared?: string;
}

/** B1b: a clock-in or clock-out within this many minutes of the shift time counts as on time (G5 grace, 10 minutes). */
export const HOURS_GRACE_MIN = 10;

/** B1b: hours on one locked shift, inside the shift times, less the unpaid rest when the guard is relieved. */
export function attendedHours(a: Attendance, shift: Shift | undefined, unpaidRestHours: number, excused: { late?: boolean; early?: boolean } = {}): number {
  if (!a.clockIn || !a.clockOut) return 0;
  let start = Date.parse(a.clockIn);
  let end = Date.parse(a.clockOut);
  if (shift) {
    const s0 = Date.parse(shift.start);
    const e0 = Date.parse(shift.end);
    const g = HOURS_GRACE_MIN * 60_000;
    // Early arrival or staying late is not counted (overtime comes from the formula or the roster engine's verified
    // minutes); a few minutes late in or early out within the grace counts as on time.
    // A late arrival or early leave the company excused with a reason and proof (attendance follow-up) counts in full.
    if (start < s0 || start - s0 <= g || excused.late) start = s0;
    if (end > e0 || e0 - end <= g || excused.early) end = e0;
  }
  const h = Math.max(0, (end - start) / 3_600_000);
  return r2(Math.max(0, h - (h > unpaidRestHours ? unpaidRestHours : 0)));
}

export interface GuardPayRun {
  id: Id;
  companyId: Id;
  /** YYYY-MM */
  period: string;
  stage: GuardPayStage;
  /** Public holidays in the month, entered by HR from the gazette for the company's states. Nothing is assumed. */
  holidays: { date: IsoDate; label: string }[];
  lines: GuardPayLine[];
  prepared: GuardPayStep;
  submitted: GuardPayStep | null;
  approved: GuardPayStep | null;
  /** Finance records the bank's reference once paid, and confirms the PCB was checked in LHDN's e-PCB. */
  paid: (GuardPayStep & { bankRef: string; paidOn: IsoDate; pcbChecked: true }) | null;
  returns: (GuardPayStep & { from: GuardPayStage })[];
  /** True while the JA Group app still pays guards: the run is compared, not paid. */
  trial: boolean;
  /**
   * Where the holidays came from: 'yearly' is the guard holiday lists the Operations Director or OGM set for the year
   * (per state, PR #112); 'hr' is HR's own entry for a company with no yearly list. Staff holidays are separate.
   */
  holidaySource?: 'yearly' | 'hr' | 'none';
  /** Sites worked this month whose man-hours are over the allowed total without OD/OGM approval (flag, not a hold). */
  sitesOver?: { siteId: Id; siteName: string; overBy: number; approver: 'ops_director' | 'ogm' }[];
  /** Guards to be paid in cash this month: listed by the Director Office, decided by the COO or the CEO. */
  cash?: GuardPayCash[];
  /**
   * Fauzan, 15 Nov 2026: guards whose absence still waits for the OD/OGM decision are kept out of this run (it pays
   * everyone else). Each is paid in a later run for the same month once decided. Kept for the screen; never paid here.
   */
  waiting?: GuardPayLine[];
  /** A later run: the company's main run for the month whose waiting guards this run pays. */
  laterOf?: Id;
  /** Unpaid listings replaced by DOA; retain every original decision and the reason for replacement. */
  cashHistory?: { entry: GuardPayCash; superseded: GuardPayStep }[];
}

/**
 * Cash pay (Fauzan, 6 Nov 2026): "Cash are not acceptable ... Only coo and ceo can give the cash if there is a need for
 * it. The list will be collected and submited by director office staff."
 */
export interface GuardPayCash {
  approvalVersion?: 2;
  approvedSiteId?: Id | null;
  personId: Id;
  staffNo: string;
  name: string;
  reason: string;
  listedBy: string;
  listedById: Id;
  listedAt: IsoDateTime;
  /** The COO's or CEO's decision: give in cash, or not (the guard then needs an account). */
  decision: (GuardPayStep & { give: boolean; tier: 'coo' | 'ceo' }) | null;
  /** The list is per site, per name and amount (Fauzan, 6 Nov 2026): the guard's main site and the net pay when listed. */
  siteName?: string;
  amount?: number;
  /** The CEO or COO hands the cash out, on a date. */
  handedOut?: (GuardPayStep & { on: IsoDate; tier: 'coo' | 'ceo' }) | null;
  /** The guard's signed receipt paper, uploaded by the Director Office as proof. */
  receipt?: { docId: Id; name: string; sha256: string; uploadedBy: string; uploadedById: Id; uploadedAt: IsoDateTime } | null;
}

/**
 * A wage advance (Fauzan, 6 Nov 2026): "There can be advance that usually be paid on the 20th of the month. That can be
 * set by om the amount for each guard or bulk decision follow site zon or region and also date. Approve once by ogm or
 * od. Need one more approval if there is changes." EA s.22: an advance may not exceed the wages earned in the month
 * before (not legal advice). The advance goes to the same bank account or e-wallet, and is taken back in the month's pay.
 */
export interface GuardPayAdvance {
  id: Id;
  companyId: Id;
  personId: Id;
  staffNo: string;
  name: string;
  /** YYYY-MM: the month it is paid in and taken back from. */
  period: string;
  payOn: IsoDate;
  amount: number;
  /** How the OM set it: one guard, or in bulk for a site, a zone (branch) or a region. */
  basis: 'guard' | 'site' | 'zone' | 'region';
  basisLabel: string;
  batchId: Id;
  /** The site the guard works at, for the approver (Operations Director for private, OGM for government). */
  siteId: Id | null;
  approverTier: 'ops_director' | 'ogm';
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  /** 1 when set; each change after that adds one and needs one more approval. */
  version: number;
  set: GuardPayStep;
  approvals: (GuardPayStep & { version: number; amount: number; payOn: IsoDate })[];
  changes: (GuardPayStep & { from: { amount: number; payOn: IsoDate }; to: { amount: number; payOn: IsoDate } })[];
  paid: (GuardPayStep & { bankRef: string; paidOn: IsoDate }) | null;
  /** Last month's gross pay when it was set (EA s.22 cap), or null when not known. */
  lastMonthGross: number | null;
  flags: string[];
}


/**
 * The advance and loan scheme (Fauzan, 6 Nov 2026, IWAY item 4: "Yes. Approve by cos and ceo. Finance must be notify
 * and monitored about this."). Separate from the wage advance paid on the 20th. Each record has a limit, a purpose, a
 * repayment period and the worker's signature; the pay run deducts only against these records, and all deductions
 * together stay within 50% of wages (EA s.24(8)). HR records it, the Chief of Staff approves, then the CEO; Finance is
 * told at each step and pays it out and watches the balance.
 */
export interface GuardLoan {
  id: Id;
  companyId: Id;
  personId: Id;
  staffNo: string;
  name: string;
  kind: 'advance' | 'loan';
  /** The most that may be lent (approved), and what is actually paid out (no more than the limit). */
  limit: number;
  amount: number;
  purpose: string;
  /** Repayment period in months, and the monthly repayment (the last one takes what is left). */
  months: number;
  instalment: number;
  /** YYYY-MM: the first pay month it is taken back from. */
  firstPeriod: string;
  /** The worker's signed agreement (paper or e-signature reference); no record without it. */
  signature: { docRef: string; signedOn: IsoDate; recordedBy: string; recordedById: Id; recordedAt: string };
  status: 'pending_cos' | 'pending_ceo' | 'approved' | 'paid_out' | 'settled' | 'rejected' | 'cancelled';
  requested: GuardPayStep;
  cos: GuardPayStep | null;
  ceo: GuardPayStep | null;
  /** Rejected by the Chief of Staff or the CEO, or cancelled by HR, with the reason. */
  rejected: (GuardPayStep & { tier: 'cos' | 'ceo' | 'hr' }) | null;
  paidOut: (GuardPayStep & { bankRef: string; paidOn: IsoDate }) | null;
  /** Repayments taken in paid pay runs; the balance is the amount less these. */
  repaid: { period: string; runId: Id; amount: number }[];
  balance: number;
  /** Finance notices: when Finance was told, and what. */
  financeNotices: { at: string; text: string }[];
  flags: string[];
}

/** What a loan record asks of this month's pay: the instalment, or what is left when less. */
export function loanDue(l: GuardLoan, period: string): number {
  if (l.status !== 'paid_out' || period < l.firstPeriod || l.balance <= 0) return 0;
  if (l.repaid.some((x) => x.period === period)) return 0;
  return r2(Math.min(l.instalment, l.balance));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The work date of an attendance record: the shift's date, else the clock-in day in Malaysia. */
export function attendanceDate(a: Attendance, shift: Shift | undefined): IsoDate | null {
  if (shift) return shift.date;
  if (!a.clockIn) return null;
  return new Date(Date.parse(a.clockIn) + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** Leave days that fall in the month: a leave across two months counts in each for its own days, never more than its total. */
export function leaveDaysIn(l: LeaveRequest, period: string): number {
  const start = `${period}-01`;
  const end = periodEnd(period);
  const from = l.from > start ? l.from : start;
  const to = (l.to || l.from) < end ? l.to || l.from : end;
  if (from > to) return 0;
  const span = Math.round((Date.parse(`${l.to || l.from}T00:00:00Z`) - Date.parse(`${l.from}T00:00:00Z`)) / 86_400_000) + 1;
  const inside = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  // Working days are spread over the calendar span; whole leave inside the month keeps its own count.
  return inside >= span ? l.days : Math.min(l.days, Math.round((l.days * inside) / span));
}

export interface GuardPayInput {
  person: Person;
  period: string;
  /** This person's attendance with the shift each belongs to. */
  attendance: { a: Attendance; shift?: Shift; excused?: { late?: boolean; early?: boolean } }[];
  leaves: LeaveRequest[];
  holidays: IsoDate[];
  /** The formula for each site this person worked at (null: no formula set there). */
  formulaAt: (siteId: Id) => { formula: PayFormula; scope: string } | null;
  /** The company's formula (company, region, group), for a month of paid leave with no shift. */
  formulaFallback?: () => { formula: PayFormula; scope: string } | null;
  siteName: (siteId: Id) => string;
  utility: UtilityCharge[];
  /** HR's own entries kept across a recalculation. */
  kept?: { extra: { label: string; amount: number }[]; pcb: number | null } | null;
  lastBank?: string | null;
  /** The month is not over yet: days still to come are not deducted. */
  monthOpen?: boolean;
  /** The guard holiday dates for the main site (state list, else company list); when given, used in place of `holidays`. */
  holidaysFor?: (siteId: Id | null) => IsoDate[];
  /** The days this person was rostered this month, for the s.60D(2) check (absent without leave next to a holiday). */
  rostered?: IsoDate[];
  /** Advances to take back this month. */
  advances?: { id: Id; amount: number; payOn: IsoDate; paid: boolean }[];
  /** Approved, paid-out advance and loan scheme records with a repayment due this month (the only loan deductions). */
  loans?: { id: Id; label: string; due: number }[];
  /** A note when a site this person worked at is over its man-hours without approval. */
  siteOver?: (siteId: Id) => string | null;
  /** The CEO's pay law day divisor for the month (EA s.60I: 26 unless the law changes). */
  divisor?: number;
  /** The CEO's statutory settings for the month (EPF, SOCSO, EIS, LINDUNG, HRD and any new contribution). */
  statutory?: StatutorySettings;
  /** The CEO's pay law for the month (minimum wage and its announced next step); defaults when not given. */
  payLaw?: PayLawSettings;
  /**
   * Roster engine sites (Part O): the published roster days, verified duty minutes, ABS days the OD/OGM decided are
   * unpaid, approved allowances and any signed lump-sum agreement. Used only when the main site's formula payMode is
   * 'roster_hybrid' or 'hourly'.
   */
  roster?: {
    /** The roster site with the most days: its formula is used even before the supervisor locks attendance (D1). */
    siteId?: Id;
    /** Roster leave days not backed by an approved leave record (they were treated as ABS waiting for a decision). */
    leaveMismatches?: { date: IsoDate; status: RosterStatus; record: RosterStatus | null }[];
    /** Review S1: last month's ABS days decided unpaid after that month's run was submitted: deducted this month. */
    lateUnpaid?: IsoDate[];
    days: { date: IsoDate; planned: RosterStatus; actual: RosterStatus | null }[];
    duties: HybridDuty[];
    absDecidedUnpaid: IsoDate[];
    /** ABS days decided paid; an ABS day in neither list waits for the OD/OGM decision and holds the line. */
    absDecidedPaid?: IsoDate[];
    allowances?: ReturnType<typeof allowanceLines>;
    lumpSum?: LumpSumAgreement | null;
  };
}

/** The engine settings from a guard formula (defaults keep the law's statutory method). */
export function hybridSettingsFrom(a: PayFormula['amounts']): HybridSettings {
  return {
    basicMonthly: a.basicMonthly,
    normalHoursPerDay: a.normalHoursPerDay,
    workDaysPerWeek: a.workDaysPerWeek,
    otNormalRate: a.otNormalRate,
    otRestDayRate: a.otRestDayRate,
    otPublicHolidayRate: a.otPublicHolidayRate,
    restDayDays: a.restDayDays,
    publicHolidayDays: a.publicHolidayDays,
    otRateBase: a.otRateBase ?? 'statutory',
    otFixedBase: a.otFixedBase,
    otRateRounding: a.otRateRounding ?? 'exact',
    restDayExtraTreatment: a.restDayExtraTreatment ?? 'same_as_rest_day',
    restDayNormalRateBase: a.restDayNormalRateBase ?? 'statutory',
    restDayOtMultiplier: a.restDayOtMultiplier ?? a.otRestDayRate,
    normalWorkingDaysPerMonth: a.normalWorkingDaysPerMonth ?? ORP_DIVISOR,
    incompleteMonthMethod: a.incompleteMonthMethod ?? 'working_days',
    hourlyRate: a.hourlyRate,
  };
}

/**
 * One guard's month. Rates follow EA s.60I through the formula: daily = basic / 26, hourly = daily / normal hours.
 * - A day counts once it has a clock-in and a clock-out and the supervisor has locked it (W11).
 * - Approved paid leave and every public holiday HR entered fill the month like a worked day, without overtime.
 * - Worked days past the full month (after paid leave) are rest days worked; days on a holiday HR entered are holidays.
 * - Days short of the full month are unpaid at the daily rate (never more than the basic).
 * - Overtime is the formula's overtime hours a shift on each day worked, at the formula's rates.
 */
export function buildGuardPayLine(i: GuardPayInput): GuardPayLine {
  const p = i.person;
  const end = periodEnd(i.period);
  const divisor = i.divisor ?? ORP_DIVISOR;
  const st = i.statutory ?? DEFAULT_STATUTORY;
  const age = ageOn(p.dob, end);
  const flags: string[] = [];
  const holds: string[] = [];
  const waiting: string[] = [];
  const exceptions: string[] = [];
  const inMonth = i.attendance.filter(({ a, shift }) => attendanceDate(a, shift)?.slice(0, 7) === i.period);
  let unlockedShifts = 0;
  let noClockOut = 0;
  const daysBySite = new Map<Id, Set<IsoDate>>();
  const worked = new Set<IsoDate>();
  const siteOn = new Map<IsoDate, Id>();
  let doubles = 0;
  for (const { a, shift } of inMonth) {
    const d = attendanceDate(a, shift)!;
    if (!a.clockIn || !a.clockOut) {
      noClockOut += 1;
      continue;
    }
    if (!a.locked) {
      unlockedShifts += 1;
      continue;
    }
    if (worked.has(d)) doubles += 1;
    worked.add(d);
    if (!siteOn.has(d)) siteOn.set(d, a.siteId);
    if (!daysBySite.has(a.siteId)) daysBySite.set(a.siteId, new Set());
    daysBySite.get(a.siteId)!.add(d);
  }
  const sites = [...daysBySite.entries()].sort((x, y) => y[1].size - x[1].size || x[0].localeCompare(y[0]));
  const mainSiteId = sites[0]?.[0] ?? null;
  const missingFormulaSites = sites.filter(([s]) => !i.formulaAt(s)).map(([s]) => s);
  if (missingFormulaSites.length) holds.push(`No pay formula for worked site(s): ${missingFormulaSites.map(i.siteName).join(', ')}. ACT must set a formula before submission.`);
  // No shift but approved paid leave: paid on the company's formula (company, region, group). No shift and no leave: nothing.
  const leaveOnly = !mainSiteId && i.leaves.some((l) => l.personId === p.id && l.status === 'approved' && l.kind !== 'UNPAID' && l.kind !== 'ABSENCE_REASON' && l.days > 0 && l.from <= end && (l.to || l.from) >= `${i.period}-01`);
  // Part O (review of PR #141, D1): a guard on a roster engine site is paid from the published roster's site formula even
  // when the supervisor has not locked attendance yet; the basic is guaranteed, never RM0 for a missing lock.
  const rosterChoice = i.roster?.siteId ? i.formulaAt(i.roster.siteId) : null;
  const rosterEngine = !!rosterChoice && (rosterChoice.formula.amounts.payMode === 'roster_hybrid' || rosterChoice.formula.amounts.payMode === 'hourly');
  const chosen = rosterEngine ? rosterChoice : mainSiteId ? i.formulaAt(mainSiteId) : leaveOnly ? (i.formulaFallback?.() ?? null) : null;
  const f = chosen?.formula ?? null;
  // How a month at more than one site is paid is the ACT Director's choice on the main site's formula (Fauzan, 5 Nov 2026:
  // "Every formula can set by act director"): the main site's formula for the whole month, or each day at its own site's.
  const perSite = f?.amounts.multiSite === 'per_site';
  if (sites.length > 1 && f) {
    const other = sites
      .slice(1)
      .map(([s]) => ({ s, f: i.formulaAt(s) }))
      .filter((x) => x.f?.formula.code !== f.code);
    if (other.length)
      flags.push(
        perSite
          ? `Also worked at ${other.map((x) => `${i.siteName(x.s)} (${x.f ? x.f.formula.code : 'no formula, payment held'})`).join(', ')}: each day's overtime and extra pay at its own site's formula`
          : `Also worked at ${other.map((x) => `${i.siteName(x.s)} (${x.f ? x.f.formula.code : 'no formula'})`).join(', ')}: the whole month is paid on ${f.code} from ${i.siteName(mainSiteId!)}`,
      );
  }

  const holidayList = i.holidaysFor ? i.holidaysFor(mainSiteId) : i.holidays;
  const allHolidays = new Set(holidayList.filter((d) => d.slice(0, 7) === i.period));
  // EA s.60D(2): absent without leave on the working day just before or after a holiday loses that holiday's pay. Only
  // once the month is over, only for a holiday not worked, and only against rostered days with no attendance or leave.
  const holidaysLost: IsoDate[] = [];
  if (!i.monthOpen && i.rostered?.length) {
    const present = new Set(inMonth.map(({ a, shift }) => attendanceDate(a, shift)!));
    const onLeave = (d: IsoDate) => i.leaves.some((l) => l.personId === p.id && l.status === 'approved' && l.from <= d && (l.to || l.from) >= d);
    const workingDays = [...new Set(i.rostered)].filter((d) => !allHolidays.has(d));
    const awol = new Set(workingDays.filter((d) => !present.has(d) && !onLeave(d)));
    for (const h of [...allHolidays].sort()) if (!worked.has(h) && awol.size && holidayPayLost(h, workingDays, awol)) holidaysLost.push(h);
  }
  const holidaySet = new Set([...allHolidays].filter((d) => !holidaysLost.includes(d)));
  // Count known calendar dates once. A leave record with fewer days than its range does not tell us
  // which dates are leave. Preserve an isolated, whole-month count, but hold intersecting or split
  // records for HR to supply dated leave rather than guessing the work/rest-day allocation.
  const approvedLeave = i.leaves.filter((l) => l.personId === p.id && l.status === 'approved' && l.kind !== 'ABSENCE_REASON' && l.days > 0 && l.from <= end && (l.to || l.from) >= `${i.period}-01`);
  const leaveDates = (l: LeaveRequest) => {
    const from = l.from < `${i.period}-01` ? `${i.period}-01` : l.from;
    const to = (l.to || l.from) > end ? end : l.to || l.from;
    const out: IsoDate[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const paidHolidayDates = f?.amounts.holidaysArePaidDays === false ? new Set<IsoDate>() : holidaySet;
  const paidLeave = new Set<IsoDate>();
  const unpaidLeave = new Set<IsoDate>();
  let undatedPaid = 0;
  let undatedUnpaid = 0;
  for (const l of approvedLeave) {
    const dates = leaveDates(l);
    const span = (Date.parse(`${l.to || l.from}T00:00:00Z`) - Date.parse(`${l.from}T00:00:00Z`)) / 86_400_000 + 1;
    const paid = l.kind !== 'UNPAID';
    if (l.days !== span) {
      const overlap = dates.some((d) => worked.has(d) || paidHolidayDates.has(d) || approvedLeave.some((other) => other !== l && other.from <= d && (other.to || other.from) >= d));
      if (l.days > span || dates.length !== span || overlap) {
        holds.push(`Leave ${l.id}: the paid/unpaid dates are unclear. HR must resolve the overlapping or cross-month leave dates before submission.`);
        continue;
      }
      if (paid) undatedPaid += l.days;
      else undatedUnpaid += l.days;
      continue;
    }
    for (const d of dates) {
      if (worked.has(d) || paidHolidayDates.has(d)) continue;
      (paid ? paidLeave : unpaidLeave).add(d);
    }
  }
  if ([...paidLeave].some((d) => unpaidLeave.has(d))) holds.push('Paid and unpaid leave overlap. HR must resolve the leave dates before submission.');
  const paidLeaveDays = paidLeave.size + undatedPaid;
  const unpaidLeaveDays = unpaidLeave.size + undatedUnpaid;
  const dates = [...worked].sort();
  const holidayWorkedDates = dates.filter((d) => holidaySet.has(d));
  const ordinaryDates = dates.filter((d) => !holidaySet.has(d));
  const holidaysWorked = holidayWorkedDates.length;
  const ordinary = ordinaryDates.length;

  const items: GuardPayItem[] = [];
  const add = (label: string, kind: GuardPayItem['kind'], qty: number | null, unit: GuardPayItem['unit'], rate: number | null, amount: number) => {
    if (qty === 0 || amount === 0) return;
    items.push({ label, kind, qty: qty == null ? null : r2(qty), unit, rate: rate == null ? null : r2(rate), amount: r2(amount) });
  };
  let full = 26;
  let daily = 0;
  let hourly = 0;
  let restDays = 0;
  let normalDays = ordinary;
  let unpaidDays = 0;
  let otHours = 0;
  // B1b: hours recorded beside hours paid.
  let hours: GuardPayHours | undefined;
  const engineMode = f?.amounts.payMode === 'roster_hybrid' || f?.amounts.payMode === 'hourly' ? f.amounts.payMode : null;
  if (f && engineMode) {
    // Part O: basic guaranteed, OT from verified minutes, rest-day pay only from the published roster. The old
    // count-based method below stays exactly as it is for every site not on the engine.
    const a = f.amounts;
    const hs = hybridSettingsFrom(a);
    // The CEO's pay law for the month (review of PR #141, D5), never a figure in code. The announced next step counts
    // once gazetted. The hourly minimum moves with the monthly one (RM8.72 at RM1,700, Minimum Wages Order 2024).
    const pl = i.payLaw ?? DEFAULT_PAY_LAW;
    const next = pl.nextMinimumWage;
    const minimumMonthly = next && next.gazetted && next.from <= i.period ? next.amount : pl.minimumWage;
    const law = { divisor, minimumMonthly, minimumHourly: Math.round(((8.72 * minimumMonthly) / 1700) * 100) / 100 };
    if (next && !next.gazetted && next.from <= i.period && a.basicMonthly < next.amount) flags.push(`From ${next.from} the minimum wage is announced at RM${next.amount}; raise the basic once it is gazetted.`);
    daily = a.basicMonthly / hs.normalWorkingDaysPerMonth;
    hourly = a.basicMonthly / divisor / a.normalHoursPerDay;
    full = hs.normalWorkingDaysPerMonth;
    const check = hybridSettingsCheck(hs, engineMode, law);
    for (const x of check.refuse) holds.push(`Formula ${f.code}: ${x}`);
    if (!i.roster) holds.push(`Formula ${f.code} is on the roster engine: the published roster and verified duty hours are needed before submission.`);
    else {
      const holidayDates = new Set(holidaySet);
      const r = hybridPay({
        month: i.period,
        mode: engineMode,
        settings: hs,
        law,
        days: i.roster.days,
        duties: i.roster.duties.map((d) => ({ ...d, publicHoliday: d.publicHoliday || holidayDates.has(d.date) })),
        absDecidedUnpaid: i.roster.absDecidedUnpaid,
        absDecidedPaid: i.roster.absDecidedPaid ?? [],
        joinedOn: p.hiredOn,
        leftOn: p.leaving?.lastDayOn ?? null,
        allowances: i.roster.allowances,
        lumpSum: i.roster.lumpSum,
      });
      const kindOf = { basic: 'basic', unpaid: 'unpaid', ot: 'ot', rest_day: 'rest_day', holiday: 'holiday', allowance: 'allowance', topup: 'extra', hourly: 'basic' } as const;
      for (const x of r.items) items.push({ label: x.label, kind: kindOf[x.kind], qty: x.qty, unit: x.unit, rate: x.rate, amount: x.amount });
      otHours = r2(r.otMinutes / 60);
      unpaidDays = r.unpaidDays;
      restDays = r.items.find((x) => x.kind === 'rest_day')?.qty ?? 0;
      normalDays = ordinary - restDays;
      flags.push(`Roster engine (${engineMode}): ${r.method}`, ...r.flags, ...check.flags);
      // O8 step 7 (review of PR #141, D2): an unverified duty goes to the exception list; verified wages are never held.
      if (r.unverified.length) {
        exceptions.push(...r.unverified.map((d) => `Duty ${d} not verified yet: the OM verifies the hours; its overtime or rest-day pay is added once verified.`));
        flags.push(`${r.unverified.length} duty(ies) not verified yet: on the exception list, the rest of the month is paid.`);
      }
      // Review S1: an absence decided unpaid after last month's run was submitted comes off this month at the daily rate.
      // Fauzan's audit of 4b708ae (P1): an absence waiting for the OD/OGM decision holds this guard's pay until it is
      // decided (paid or unpaid). Fauzan, 15 Nov 2026: only that guard's pay waits; the rest of the company is paid.
      for (const d of r.absPending) waiting.push(`Absence on ${d} waits for the OD/OGM decision (paid or unpaid): this guard is paid in a later run once it is decided.`);
      const late = engineMode === 'hourly' ? [] : (i.roster.lateUnpaid ?? []);
      if (late.length) {
        add(`Absence last month decided unpaid after that month was submitted (${late.join(', ')})`, 'unpaid', late.length, 'day', -r2(daily), -Math.min(hs.basicMonthly, r2(late.length * daily)));
        unpaidDays += late.length;
        flags.push(`${late.length} absence day(s) from last month decided unpaid after that run was submitted: deducted this month.`);
      }
      for (const m of i.roster.leaveMismatches ?? [])
        exceptions.push(m.record ? `${m.date}: roster shows ${m.status}, the approved leave record says ${m.record}; the leave record is used.` : `${m.date}: roster shows ${m.status} with no approved leave record; treated as absent waiting for the OD/OGM decision.`);
      // Verified duty minutes are the record; unverified duties are held above and left out of both sides.
      const duty = r2(i.roster.duties.filter((d) => d.date.slice(0, 7) === i.period && d.workedMinutes !== null).reduce((n, d) => n + (d.workedMinutes ?? 0), 0) / 60);
      const normal = r2(r.normalMinutes / 60), otH = r2(r.otMinutes / 60), restH = r2(r.restDayMinutes / 60), phH = r2(r.holidayMinutes / 60);
      const paidH = r2(normal + otH + restH + phH);
      hours = { recorded: duty, paid: paidH, duty, leave: 0, holiday: 0, normal, ot: otH, restDay: restH, publicHoliday: phH, match: Math.abs(duty - paidH) < 0.01 };
    }
    if (f.lawFlags.length) flags.push(`Formula ${f.code} has ${f.lawFlags.length} labour law flag${f.lawFlags.length === 1 ? '' : 's'} (see Pay formulas)`);
  } else if (f) {
    const a = f.amounts;
    full = a.fullMonthDays ?? 26;
    daily = a.basicMonthly / divisor;
    hourly = daily / a.normalHoursPerDay;
    // Public holidays are paid days in the month, worked or not (EA s.60D), unless ACT set the formula otherwise.
    const paidHolidays = a.holidaysArePaidDays === false ? 0 : Math.min(holidaySet.size, full);
    const room = Math.max(0, full - paidLeaveDays - paidHolidays);
    restDays = Math.max(0, ordinary - room);
    normalDays = ordinary - restDays;
    // A month not over yet only deducts the unpaid leave already approved; the rest is counted at month end.
    const short = Math.max(0, full - normalDays - paidLeaveDays - paidHolidays);
    unpaidDays = i.monthOpen ? Math.min(unpaidLeaveDays, full) : a.deductShortDays === false ? Math.min(unpaidLeaveDays + holidaysLost.length, full) : short;
    add('Basic pay', 'basic', null, null, null, a.basicMonthly);
    add('Days not worked (unpaid)', 'unpaid', unpaidDays, 'day', -daily, -Math.min(a.basicMonthly, unpaidDays * daily));
    // The last ordinary days past the room are the rest days worked.
    const restSet = new Set(ordinaryDates.slice(ordinaryDates.length - restDays));
    type Cat = 'normal' | 'rest' | 'holiday';
    const groups = new Map<string, { formula: PayFormula; cat: Cat; days: number }>();
    for (const d of dates) {
      const own = perSite ? i.formulaAt(siteOn.get(d)!)?.formula : f;
      // Missing formulas hold the run; never silently substitute the main-site rate.
      if (!own) continue;
      const cat: Cat = holidaySet.has(d) ? 'holiday' : restSet.has(d) ? 'rest' : 'normal';
      const key = `${own.code}|${cat}`;
      const g = groups.get(key) ?? { formula: own, cat, days: 0 };
      g.days += 1;
      groups.set(key, g);
    }
    const codes = new Set([...groups.values()].map((g) => g.formula.code));
    const order: Cat[] = ['normal', 'rest', 'holiday'];
    for (const g of [...groups.values()].sort((x, y) => order.indexOf(x.cat) - order.indexOf(y.cat) || x.formula.code.localeCompare(y.formula.code))) {
      const fa = g.formula.amounts;
      const gd = fa.basicMonthly / divisor;
      const gh = gd / fa.normalHoursPerDay;
      const perDay = guardOtHoursPerDay(fa);
      const tag = codes.size > 1 ? ` (${g.formula.code})` : '';
      otHours += perDay * g.days;
      if (g.cat === 'normal') add(`Overtime, working days${tag}`, 'ot', perDay * g.days, 'hour', gh * fa.otNormalRate, perDay * g.days * gh * fa.otNormalRate);
      if (g.cat === 'rest') {
        add(`Rest day worked${tag}`, 'rest_day', g.days, 'day', gd * fa.restDayDays, g.days * gd * fa.restDayDays);
        add(`Overtime, rest days${tag}`, 'ot', perDay * g.days, 'hour', gh * fa.otRestDayRate, perDay * g.days * gh * fa.otRestDayRate);
      }
      if (g.cat === 'holiday') {
        add(`Public holiday worked${tag}`, 'holiday', g.days, 'day', gd * fa.publicHolidayDays, g.days * gd * fa.publicHolidayDays);
        add(`Overtime, public holidays${tag}`, 'ot', perDay * g.days, 'hour', gh * fa.otPublicHolidayRate, perDay * g.days * gh * fa.otPublicHolidayRate);
      }
    }
    for (const x of a.fixedAllowances ?? []) {
      add(x.label, 'allowance', null, null, null, x.amount);
      // C1b (Fauzan, 11 Nov 2026): paid leave is paid at basic pay only, so the allowance is not paid on leave days.
      if (paidLeaveDays > 0 && x.amount > 0) {
        const perDay = x.amount / divisor;
        add(`${x.label}: not paid on leave days`, 'allowance', paidLeaveDays, 'day', -perDay, -Math.min(x.amount, paidLeaveDays * perDay));
      }
    }
    if (f.lawFlags.length) flags.push(`Formula ${f.code} has ${f.lawFlags.length} labour law flag${f.lawFlags.length === 1 ? '' : 's'} (see Pay formulas)`);
    // B1b: hours paid, from the same groups, beside hours recorded from the locked attendance.
    const noShift = [...groups.values()].find((g) => !(g.formula.amounts.shiftHours! > 0));
    if (noShift) hours = { recorded: 0, paid: 0, duty: 0, leave: 0, holiday: 0, normal: 0, ot: 0, restDay: 0, publicHoliday: 0, match: true, notCompared: `Formula ${noShift.formula.code} has no shift length, so hours cannot be compared. ACT to set the shift hours.` };
    else {
      let normal = 0, otH = 0, restH = 0, phH = 0;
      for (const g of groups.values()) {
        const fa = g.formula.amounts;
        const nh = Math.min(fa.normalHoursPerDay, guardWorkedHours(fa)) * g.days;
        const oh = guardOtHoursPerDay(fa) * g.days;
        otH += oh;
        if (g.cat === 'normal') normal += nh;
        else if (g.cat === 'rest') restH += nh;
        else phH += nh;
      }
      let duty = 0;
      for (const { a: att, shift, excused } of inMonth) {
        if (!att.clockIn || !att.clockOut || !att.locked) continue;
        const own = perSite ? i.formulaAt(att.siteId)?.formula : f;
        if (!own) continue;
        duty += attendedHours(att, shift, own.amounts.restRelieved ? (own.amounts.restHours ?? 0) : 0, excused);
      }
      const leaveH = paidLeaveDays * a.normalHoursPerDay;
      const holidayH = (a.holidaysArePaidDays === false ? 0 : [...holidaySet].filter((d) => !worked.has(d)).length) * a.normalHoursPerDay;
      const paidH = r2(normal + otH + restH + phH + leaveH + holidayH);
      const recorded = r2(duty + leaveH + holidayH);
      hours = { recorded, paid: paidH, duty: r2(duty), leave: r2(leaveH), holiday: r2(holidayH), normal: r2(normal), ot: r2(otH), restDay: r2(restH), publicHoliday: r2(phH), match: Math.abs(recorded - paidH) < 0.01 };
    }
  } else if (worked.size) {
    flags.push('No pay formula is set for the main site: ACT must set one before this line can be paid');
  }
  if (hours && !hours.match)
    holds.push(
      hours.paid > hours.recorded
        ? `Hours paid (${hours.paid}) are more than the hours recorded (${hours.recorded}): correct the attendance or leave record (with its own approval and reason). A guard is never paid for hours attendance does not show.`
        : `Hours paid (${hours.paid}) do not match the hours recorded (${hours.recorded}): correct the attendance or leave record (with its own approval and reason), not the pay line.`,
    );
  const extra = i.kept?.extra ?? [];
  for (const x of extra) add(x.label, 'extra', null, null, null, x.amount);
  const advances = (i.advances ?? []).filter((x) => x.paid);
  for (const x of advances) add(`Advance paid ${x.payOn}`, 'advance', null, null, null, -x.amount);

  // A one-off minus item (uniform, advance) is taken from the net pay after the statutory shares; it never lowers the
  // wages EPF, SOCSO or tax are counted on.
  const isDeduction = (x: GuardPayItem) => (x.kind === 'extra' || x.kind === 'advance' || x.kind === 'loan') && x.amount < 0;
  const gross = r2(items.filter((x) => !isDeduction(x)).reduce((n, x) => n + x.amount, 0));
  const otherDeductions = r2(-items.filter((x) => isDeduction(x) && x.kind === 'extra').reduce((n, x) => n + x.amount, 0));
  const advance = r2(Math.max(0, -items.filter((x) => x.kind === 'advance').reduce((n, x) => n + x.amount, 0)));
  // EPF is never charged on overtime (KWSP). Whether rest-day and holiday day pay is EPF wages is the ACT Director's
  // setting on the formula (default yes).
  const noEpf = new Set<GuardPayItem['kind']>(f?.amounts.epfOnRestHolidayPay === false ? ['ot', 'rest_day', 'holiday'] : ['ot']);
  const ot = r2(items.filter((x) => noEpf.has(x.kind) && !isDeduction(x)).reduce((n, x) => n + x.amount, 0));
  const epfWages = r2(gross - ot);
  const epf = epfShare(epfWages, age, p.nationality, st);
  const socso = socsoShare(gross, age, st);
  const eis = eisShare(gross, age, p.nationality, st);
  const lindung = lindungShare(gross, i.period, p.nationality, p.lindungOptOut === true, st);
  const otPay = r2(items.filter((x) => x.kind === 'ot').reduce((n, x) => n + x.amount, 0));
  const others = otherShares(st, gross, otPay, age, p.nationality);
  const othersEe = r2(others.reduce((n, o) => n + o.ee, 0));
  const fixed = items.filter((x) => x.kind === 'basic' || x.kind === 'allowance' || x.kind === 'unpaid').reduce((n, x) => n + x.amount, 0);
  const pcb = i.kept?.pcb ?? pcbEstimate(gross, epf.ee, socso.ee + eis.ee);
  const utilityRows = i.utility.filter((c) => c.personId === p.id && c.decision === 'DEDUCTION' && c.payrollMonth === i.period);
  const utility = r2(utilityRows.reduce((n, c) => n + c.share, 0));
  // Advance and loan scheme repayments (Fauzan, 6 Nov 2026): taken only against an approved record, and all the
  // deductions the employer makes together (one-off items, hostel utilities, wage advances and these repayments) stay
  // within half of the month's wages (EA s.24(8); confirmed by Fauzan, 11 Nov 2026 round 3 Q3: EPF, SOCSO and PCB are outside the cap). What does
  // not fit waits for next month; the record's balance stays.
  const cap = r2(Math.max(0, gross) * 0.5);
  const before = r2(utility + otherDeductions + advance);
  let room = r2(Math.max(0, cap - before));
  const loanParts: { id: Id; amount: number }[] = [];
  for (const l of i.loans ?? []) {
    const take = r2(Math.min(l.due, room));
    room = r2(room - take);
    if (take > 0) {
      loanParts.push({ id: l.id, amount: take });
      add(l.label, 'loan', null, null, null, -take);
    }
    if (take < l.due) flags.push(`${l.label}: RM${(l.due - take).toFixed(2)} not taken this month (deductions kept within 50% of wages); the balance stays on the record`);
  }
  const loan = r2(loanParts.reduce((n, x) => n + x.amount, 0));
  if (before > cap) holds.push(`Deductions RM${before.toFixed(2)} are more than half the wages (RM${cap.toFixed(2)}): EA s.24(8), resolve before submitting`);
  const deductions = r2(epf.ee + socso.ee + lindung.ee + eis.ee + pcb + utility + otherDeductions + advance + loan + othersEe);
  const net = r2(gross - deductions);

  if (!worked.size && !paidLeaveDays) flags.push('No locked, completed shift this month');
  if (unlockedShifts) flags.push(`${unlockedShifts} shift${unlockedShifts === 1 ? '' : 's'} not locked by the supervisor yet: not counted`);
  if (noClockOut) flags.push(`${noClockOut} shift${noClockOut === 1 ? '' : 's'} with no clock-out: not counted until fixed`);
  if (doubles) flags.push(`${doubles} day${doubles === 1 ? '' : 's'} with two shifts: counted once`);
  if (restDays) flags.push(`${restDays} rest day${restDays === 1 ? '' : 's'} worked (days past the full month of ${full})`);
  if (unpaidDays && !i.monthOpen) flags.push(`${unpaidDays} day${unpaidDays === 1 ? '' : 's'} short of the full month: deducted`);
  const account = payAccountCheck(p.bank);
  if (account.problem && net > 0) flags.push(`${account.problem}: ordinary wages require a verified account or separate CEO-approved wage-cash listing; additional DOA support does not replace wages`);
  flags.push(...account.flags);
  if (p.bank?.consent && p.bank.consent.recordedAt.slice(0, 7) === i.period) flags.push(`Written consent recorded this month by ${p.bank.consent.recordedBy}`);
  if (account.problem) {
    // Already flagged above.
  } else if (p.bank && i.lastBank && i.lastBank !== p.bank.accountMasked) flags.push(`Salary account changed since last month (was ${i.lastBank})`);
  else if (p.bankChangedOn?.slice(0, 7) === i.period) flags.push(`Salary account changed on ${p.bankChangedOn}`);
  if (p.hiredOn.slice(0, 7) === i.period) flags.push('Joined this month: check the days to pay');
  if (p.status === 'left') flags.push('Has left: final pay, check any notice pay or deductions');
  if (age >= 60) flags.push('Aged 60 or over: EPF and SOCSO at the older rates, no EIS');
  if (p.nationality === 'MY' && p.lindungOptOut == null && lindung.status === 'deducted') flags.push('LINDUNG 24 Jam deducted: opt-out choice not recorded');
  if (net < 0) flags.push('Deductions are more than the pay: check before submitting');
  if (utility) flags.push(`Hostel utility deduction RM${utility.toFixed(2)} (approved by HR)`);
  if (advance) flags.push(`Advance RM${advance.toFixed(2)} taken back`);
  if (i.advances?.some((x) => !x.paid)) flags.push('An approved advance is not marked paid yet: not deducted from this run');
  for (const h of holidaysLost) flags.push(`No pay for the public holiday on ${h}: absent without leave on the working day before or after (EA s.60D(2))`);
  for (const s of [...daysBySite.keys()]) {
    const note = i.siteOver?.(s);
    if (note) flags.push(note);
  }

  return {
    calculationVersion: GUARD_PAY_CALCULATION_VERSION,
    holds,
    ...(exceptions.length ? { exceptions } : {}),
    ...(waiting.length ? { waiting } : {}),
    hours,
    missingFormulaSites,
    personId: p.id,
    staffNo: p.staffNo,
    name: p.name,
    role: p.role,
    age,
    nationality: p.nationality,
    mainSiteId,
    mainSiteName: mainSiteId ? i.siteName(mainSiteId) : '',
    formulaCode: f?.code ?? null,
    formulaVersion: f?.version ?? null,
    formulaName: f?.name ?? 'No formula',
    formulaScope: chosen?.scope ?? null,
    fullMonthDays: full,
    daysWorked: worked.size,
    normalDays,
    restDaysWorked: restDays,
    holidaysWorked,
    paidLeaveDays,
    unpaidLeaveDays,
    unpaidDays,
    otHours: r2(otHours),
    dailyRate: r2(daily),
    hourlyRate: r2(hourly),
    items,
    gross,
    epfWages,
    epfEe: epf.ee,
    epfEr: epf.er,
    socsoEe: socso.ee,
    socsoEr: socso.er,
    lindungEe: lindung.ee,
    lindungRate: lindung.rate,
    lindungStatus: lindung.status,
    eisEe: eis.ee,
    eisEr: eis.er,
    hrd: hrdLevy(Math.max(0, fixed), p.nationality, st),
    others,
    pcb,
    pcbSource: i.kept?.pcb == null ? 'estimate' : 'entered',
    utilityIds: utilityRows.map((c) => c.id),
    utility,
    otherDeductions,
    advance,
    advanceIds: advances.map((x) => x.id),
    loan,
    loanParts,
    holidayDates: [...allHolidays].sort(),
    holidaysLost,
    deductions,
    net,
    bank: p.bank ?? null,
    accountProblem: account.problem,
    unlockedShifts,
    noClockOut,
    flags: [...flags, ...holds, ...waiting],
  };
}

/** Existing employer-recovery cap only; statutory shares and PCB remain outside it pending legal review. */
export function guardPayOverDeductionCap(l: GuardPayLine): boolean {
  return r2(l.utility + l.otherDeductions + (l.advance ?? 0) + (l.loan ?? 0)) > r2(Math.max(0, l.gross) * 0.5);
}

export function guardPayTotals(lines: GuardPayLine[]) {
  const sum = (k: keyof GuardPayLine) => r2(lines.reduce((n, l) => n + ((l[k] as number | undefined) ?? 0), 0));
  const otherCodes = new Map<string, { code: string; name: string; payee: string; ee: number; er: number }>();
  for (const l of lines)
    for (const o of l.others ?? []) {
      const t = otherCodes.get(o.code) ?? { code: o.code, name: o.name, payee: o.payee, ee: 0, er: 0 };
      t.ee = r2(t.ee + o.ee);
      t.er = r2(t.er + o.er);
      otherCodes.set(o.code, t);
    }
  const othersEr = r2([...otherCodes.values()].reduce((n, o) => n + o.er, 0));
  const employer = r2(sum('epfEr') + sum('socsoEr') + sum('eisEr') + sum('hrd') + othersEr);
  return {
    headcount: lines.length,
    gross: sum('gross'),
    net: sum('net'),
    otHours: sum('otHours'),
    epf: r2(sum('epfEe') + sum('epfEr')),
    epfEe: sum('epfEe'),
    epfEr: sum('epfEr'),
    socso: r2(sum('socsoEe') + sum('socsoEr')),
    socsoEe: sum('socsoEe'),
    socsoEr: sum('socsoEr'),
    lindung: sum('lindungEe'),
    eis: r2(sum('eisEe') + sum('eisEr')),
    eisEe: sum('eisEe'),
    eisEr: sum('eisEr'),
    pcb: sum('pcb'),
    hrd: sum('hrd'),
    utility: sum('utility'),
    others: [...otherCodes.values()],
    employer,
    cost: r2(sum('gross') + employer),
    noFormula: lines.filter((l) => (l.missingFormulaSites?.length ?? 0) > 0 || (!l.formulaCode && (l.daysWorked > 0 || l.paidLeaveDays > 0))).length,
    held: lines.filter((l) => l.holds?.length || guardPayOverDeductionCap(l)).length,
    /** Only lines with pay to send need a salary account; a nil line stays on the run but out of the bank file. */
    noBank: lines.filter((l) => (l.accountProblem !== undefined ? !!l.accountProblem : !l.bank) && l.net > 0).length,
    advance: sum('advance'),
    loan: sum('loan'),
    otherDeductions: sum('otherDeductions'),
    nil: lines.filter((l) => l.net <= 0).length,
    unlocked: lines.reduce((n, l) => n + l.unlockedShifts + l.noClockOut, 0),
    pcbEstimated: lines.filter((l) => l.pcbSource === 'estimate' && l.pcb > 0).length,
    flagged: lines.filter((l) => l.flags.length).length,
  };
}

/** Roles paid in the guard run: guards, stationed officers and patrolling officers (COO approves their salary). */
export const GUARD_PAY_ROLES: PersonRole[] = ['guard', 'supervisor', 'patrol_officer'];
