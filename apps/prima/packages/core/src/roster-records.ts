/**
 * Guard roster records (Part O screens; Fauzan 13-14 Nov 2026). The stored rows of db/modules/guard-roster-v1.sql and
 * the pure step that turns them into the roster input of one guard's month in the pay run. The rules themselves live
 * in roster-engine.ts. Nothing here is switched on: the module is not on the release list (installing it needs the
 * CEO's go-ahead) and the lump-sum pay is used at a site only after the CEO switches it on there.
 */
import type { Attendance, Id, IsoDate, IsoDateTime } from './types';
import {
  addDaysIso,
  allowanceLines, allowanceLostDays,
  isDuty,
  lumpSumActive,
  monthDates,
  workedMinutes,
  type BreakPlan,
  type ComplianceEvidence,
  type GuardAllowance,
  type HybridDuty,
  type LumpSumAgreement,
  type RosterDay,
  type RosterStatus,
  type RosterVersion,
  type SiteCoverage,
} from './roster-engine';

/** A site's contract coverage from a date (OD private / OGM government), plus the site's roster set-up. */
export interface SiteCoverageRow extends SiteCoverage {
  id: Id;
  companyId: Id;
  setAt: IsoDateTime;
  /** The person named as the site's Area/Zone Supervisor (verify step); null = no verify step at this site. */
  areaSupervisorId: Id | null;
  /** Break plan; used only with the client's written permission (breakPermissionRef). */
  breakPlan: BreakPlan | null;
  /** The CEO's per-site switch for the agreed lump-sum pay (Fauzan, 14 Nov 2026). Off until he switches it on. */
  lumpSumSwitch: { on: boolean; byId: Id; at: IsoDateTime; reason: string } | null;
}

export interface RosterVersionRow extends RosterVersion {
  createdAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
  replacedById: Id | null;
  /** The checker's result at the last save, for the list (the board re-runs it). */
  lastCheck: { blocks: number; red: number; amber: number; at: IsoDateTime } | null;
}

/** A corrected actual: the OM proposes with evidence and a reason, the OD/OGM (a different person) approves. */
export interface ActualCorrection {
  to: RosterStatus;
  proposedById: Id;
  proposedAt: IsoDateTime;
  evidence: string;
  reason: string;
  approvedById: Id | null;
  approvedAt: IsoDateTime | null;
}

export interface RosterDayRow extends RosterDay {
  id: Id;
  companyId: Id;
  rosterVersionId: Id;
  /** A draft line taken off before publishing (the app has no DELETE). */
  removed: boolean;
  actualById: Id | null;
  actualCorrection: ActualCorrection | null;
  /** ABS only: the OM records it, the OD/OGM decides whether it is unpaid, with a reason (PO-5). Set once. */
  absDecision: { unpaid: boolean; byId: Id; at: IsoDateTime; reason: string } | null;
}

export interface AttendanceBreakRow {
  id: Id;
  companyId: Id;
  siteId: Id;
  personId: Id;
  rosterDayId: Id;
  date: IsoDate;
  slot: string;
  start: IsoDateTime;
  end: IsoDateTime;
  relieved: boolean;
  interruptedMinutes: number;
  recordedById: Id;
  recordedAt: IsoDateTime;
  /** The supervisor's confirmation; never the guard themself. */
  confirmedById: Id | null;
  confirmedAt: IsoDateTime | null;
}

export interface RosterEvidenceRow extends ComplianceEvidence {
  companyId: Id;
  recordedAt: IsoDateTime;
  /** ACT's check (PO-5: recorded by the OD/OGM, checked by ACT). Set once; the record itself is never edited. */
  actCheck?: { byId: Id; at: IsoDateTime; result: 'ok' | 'query'; note: string } | null;
}

export interface GuardAllowanceRow extends GuardAllowance {
  companyId: Id;
  personId: Id;
  proposedById: Id;
  proposedAt: IsoDateTime;
  reason: string;
  verifiedAt: IsoDateTime | null;
  approvedAt: IsoDateTime | null;
  /** Refused at the HR Director or COO step, with the reason. */
  refused: { byId: Id; at: IsoDateTime; reason: string } | null;
}

export interface LumpSumRow extends LumpSumAgreement {
  companyId: Id;
  proposedAt: IsoDateTime;
  /** The agreement text the guard reads and signs (BM or English); its SHA-256 is the signed document hash. */
  text: string;
  approvedAt: IsoDateTime | null;
  refusedAt: IsoDateTime | null;
}

/** The agreement wording, built from the figures only (no names): what the guard reads before signing. */
export function lumpSumText(a: { target: number; from: string; to: string | null; siteName: string; language: LumpSumAgreement['language'] }): string {
  const until = a.to ? a.to : a.language === 'ms' ? 'sehingga ditarik balik' : 'until withdrawn';
  if (a.language === 'ms')
    return [
      `Perjanjian gaji pukal: RM${a.target.toFixed(2)} sebulan (kasar, sebelum elaun yang dinyatakan berasingan) di ${a.siteName}, dari ${a.from}, ${until}.`,
      'Saya tetap dibayar sekurang-kurangnya apa yang wajib di bawah undang-undang dan formula tapak: jika jumlah itu lebih tinggi, jumlah yang lebih tinggi dibayar.',
      'Persetujuan ini tidak mengetepikan hak berkanun saya. Saya boleh menarik balik persetujuan ini untuk bulan berikutnya.',
    ].join(' ');
  return [
    `Lump-sum pay agreement: RM${a.target.toFixed(2)} a month (gross, before separately named allowances) at ${a.siteName}, from ${a.from}, ${until}.`,
    'I am always paid at least what the law and the site formula make due: if that is higher, the higher amount is paid.',
    'This agreement does not waive any statutory right. I may withdraw it for the following month.',
  ].join(' ');
}

/** The published version of a site's month, if any. */
export function publishedVersion(versions: RosterVersionRow[], siteId: Id, month: string): RosterVersionRow | null {
  return versions.find((v) => v.siteId === siteId && v.month === month && v.status === 'published') ?? null;
}

/** The current working version of a site's month: the open draft/submitted/verified one, else the published one. */
export function currentVersion(versions: RosterVersionRow[], siteId: Id, month: string): RosterVersionRow | null {
  const mine = versions.filter((v) => v.siteId === siteId && v.month === month).sort((a, b) => b.version - a.version);
  return mine.find((v) => v.status === 'draft' || v.status === 'submitted' || v.status === 'verified') ?? mine.find((v) => v.status === 'published') ?? null;
}

/**
 * The roster leave status an approved leave record gives a date (O1, review of PR #141 D3): UNPAID is UPL, sick leave
 * MC, hospital leave HOSP, any other paid leave AL. Absence reasons are not leave. Only approved records count.
 */
export function rosterLeaveOn(leaves: { personId: Id; status: string; kind: string; from: IsoDate; to?: IsoDate | null; days: number }[], personId: Id) {
  const mine = leaves.filter((l) => l.personId === personId && l.status === 'approved' && l.kind !== 'ABSENCE_REASON' && l.days > 0);
  return (date: IsoDate): 'UPL' | 'AL' | 'MC' | 'HOSP' | null => {
    const l = mine.find((x) => x.from <= date && (x.to || x.from) >= date);
    if (!l) return null;
    return l.kind === 'UNPAID' ? 'UPL' : l.kind === 'SICK' ? 'MC' : l.kind === 'HOSPITAL' ? 'HOSP' : 'AL';
  };
}

/**
 * One guard's month for the pay run's roster engine (O8): published days only, the actual status, verified minutes per
 * duty from attendance and confirmed breaks, ABS decisions, approved allowances and the signed lump sum (only where the
 * CEO has switched it on for the site). A duty with no clock-out is not verified yet (exception, paid once verified).
 */
export function rosterPayInput(i: {
  personId: Id;
  month: string;
  versions: RosterVersionRow[];
  days: RosterDayRow[];
  attendance: Attendance[];
  breaks: AttendanceBreakRow[];
  coverage: SiteCoverageRow[];
  allowances: GuardAllowanceRow[];
  lumpSums: LumpSumRow[];
  armedUntil: IsoDate | null;
  employedDays: number;
  /** The site's normal working days a month, for the daily cut of fixed allowances (default 26). */
  normalWorkingDays?: number;
  /**
   * The approved leave on a date, from HR's leave records (O1: leave comes from the leave records, never typed twice).
   * When given, a roster AL/MC/HOSP/UPL day with no approved leave behind it is treated as ABS waiting for the OD/OGM
   * decision (paid until decided), and an approved leave day the roster does not show is applied (review of PR #141, D3).
   */
  leaveOn?: (date: IsoDate) => 'UPL' | 'AL' | 'MC' | 'HOSP' | null;
  /** When last month's guard pay run was submitted (review S1); null or absent while it is still a draft. */
  lateCutoff?: IsoDateTime | null;
}): {
  /** The roster site with the most days this month: the pay run reads its formula even before attendance is locked. */
  siteId: Id;
  /** Roster days whose leave status had no approved leave record (shown to HR and the OM). */
  leaveMismatches: { date: IsoDate; status: RosterStatus; record: RosterStatus | null }[];
  /** Review S1: last month's ABS days the OD/OGM decided unpaid after that month's run was submitted (paid then). */
  lateUnpaid: IsoDate[];
  days: { date: IsoDate; planned: RosterStatus; actual: RosterStatus | null }[];
  duties: HybridDuty[];
  absDecidedUnpaid: IsoDate[];
  absDecidedPaid: IsoDate[];
  allowances: ReturnType<typeof allowanceLines>;
  lumpSum: LumpSumAgreement | null;
} | null {
  const published = new Set(i.versions.filter((v) => v.month === i.month && v.status === 'published').map((v) => v.id));
  const raw = i.days.filter((d) => d.personId === i.personId && !d.removed && published.has(d.rosterVersionId) && d.date.slice(0, 7) === i.month);
  if (!raw.length) return null;
  const leaveMismatches: { date: IsoDate; status: RosterStatus; record: RosterStatus | null }[] = [];
  const LEAVE: readonly RosterStatus[] = ['AL', 'MC', 'HOSP', 'UPL'];
  const mine = !i.leaveOn
    ? raw
    : raw.map((d) => {
        const st = d.actual ?? d.planned;
        const rec = i.leaveOn!(d.date);
        if (LEAVE.includes(st)) {
          if (rec === st) return d;
          // A leave status the leave records do not back: never deducted or paid as leave; ABS waits for the OD/OGM.
          leaveMismatches.push({ date: d.date, status: st, record: rec });
          return rec ? { ...d, actual: rec } : { ...d, actual: 'ABS' as RosterStatus, absDecision: d.absDecision ?? null };
        }
        // Approved leave on a day the roster shows otherwise: the leave record is applied unless the guard worked it.
        if (rec && !isDuty(d.actual)) {
          if (isDuty(d.planned) || d.actual) leaveMismatches.push({ date: d.date, status: st, record: rec });
          return { ...d, actual: rec };
        }
        return d;
      });
  const siteCount = new Map<Id, number>();
  for (const d of mine) siteCount.set(d.siteId, (siteCount.get(d.siteId) ?? 0) + 1);
  const siteId = [...siteCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  // The coverage in force on each duty's own date: a later version (say December's) never changes an earlier month
  // (review of PR #141, 14 Nov 2026).
  const coverageOf = (siteId: Id, date: IsoDate) =>
    i.coverage.filter((c) => c.siteId === siteId && c.effectiveFrom.slice(0, 10) <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  const dates = new Set(monthDates(i.month));
  const days = mine.filter((d) => dates.has(d.date)).map((d) => ({ date: d.date, planned: d.planned, actual: d.actual }));
  const duties: HybridDuty[] = [];
  for (const d of mine) {
    const worked = d.actual ?? d.planned;
    if (!isDuty(worked) || !d.plannedStart || !d.plannedEnd) continue;
    const a = i.attendance.find((x) => x.personId === d.personId && x.siteId === d.siteId && !!x.clockIn && Math.abs(Date.parse(x.clockIn) - Date.parse(d.plannedStart!)) < 6 * 3_600_000);
    const cov = coverageOf(d.siteId, d.date);
    // Review S2: the "one guard on the post" break rule counts the guards on the same post (the site when no post is set).
    const shiftGuards = i.days.filter((x) => x.siteId === d.siteId && (d.postId ? x.postId === d.postId : true) && x.date === d.date && !x.removed && published.has(x.rosterVersionId) && x.plannedStart === d.plannedStart && isDuty(x.actual ?? x.planned)).length;
    let minutes: number | null = null;
    if (a?.clockIn && a.clockOut && d.actual) {
      // Breaks follow the person, date and site, so a replacement roster version keeps the breaks recorded on the
      // version it replaced (review of PR #141); the same break recorded twice counts once.
      const seenBreaks = new Set<string>();
      const br = i.breaks
        .filter((b) => (b.rosterDayId === d.id || (b.personId === d.personId && b.date === d.date && b.siteId === d.siteId)) && !seenBreaks.has(`${b.start}|${b.end}`) && !!seenBreaks.add(`${b.start}|${b.end}`))
        .map((b) => ({ start: b.start, end: b.end, confirmedBySupervisor: !!b.confirmedById, relieved: b.relieved, interruptedMinutes: b.interruptedMinutes }));
      minutes = workedMinutes({ plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, clockIn: a.clockIn, clockOut: a.clockOut, breaks: br, plan: cov?.breakPlan ?? null, guardsOnPost: shiftGuards, breakPermission: !!cov?.breakPermissionRef }).worked;
    }
    duties.push({ date: d.date, siteId: d.siteId, planned: d.planned, workedMinutes: minutes, publicHoliday: false, ownerRole: 'OM' });
  }
  const absDecidedUnpaid = mine.filter((d) => d.actual === 'ABS' && d.absDecision?.unpaid).map((d) => d.date);
  const absDecidedPaid = mine.filter((d) => d.actual === 'ABS' && d.absDecision && !d.absDecision.unpaid).map((d) => d.date);
  const allowances = allowanceLines(
    i.allowances.filter((a) => a.personId === i.personId && !a.refused),
    mine.map((d) => ({ date: d.date, status: d.actual ?? d.planned, armedPost: !!coverageOf(d.siteId, d.date)?.armed, companyTransport: false, trips: 0 })),
    i.month,
    { armedUntil: i.armedUntil },
    i.employedDays,
    { days: allowanceLostDays(days, absDecidedUnpaid), divisor: i.normalWorkingDays ?? 26 },
  );
  const lump = i.lumpSums.find((l) => l.personId === i.personId && lumpSumActive(l, i.month) && !!l.approvedById && coverageOf(l.siteId, monthDates(i.month).at(-1)!)?.lumpSumSwitch?.on === true) ?? null;
  // Review S1: an absence paid while it waited for the decision, and decided unpaid only after last month's run was
  // submitted, is deducted this month (one day each). Before submission the recalculation of that month takes it.
  const prev = addDaysIso(`${i.month}-01`, -1).slice(0, 7);
  const prevPublished = new Set(i.versions.filter((v) => v.month === prev && v.status === 'published').map((v) => v.id));
  const lateUnpaid = i.lateCutoff
    ? [...new Set(i.days.filter((d) => d.personId === i.personId && !d.removed && prevPublished.has(d.rosterVersionId) && d.date.slice(0, 7) === prev && d.actual === 'ABS' && d.absDecision?.unpaid && d.absDecision.at > i.lateCutoff!).map((d) => d.date))].sort()
    : [];
  return { siteId, leaveMismatches, lateUnpaid, days, duties, absDecidedUnpaid, absDecidedPaid, allowances, lumpSum: lump };
}

/**
 * Auto-roster proposal (O13; Fauzan 14 Nov 2026 "Build it also"). Prima PROPOSES a month; the OM reviews and saves it as
 * a draft, and it goes through the normal chain. It never saves or publishes by itself.
 * - Pattern 5 on / 2 off (IKEA style) or 6 on / 1 off (school style). The first OFF of each cycle is the rest day.
 * - Fixed teams: each guard keeps a day or night team in proportion to the posts.
 * - Staggered OFF days: each guard starts the cycle on a different day, counted from a fixed date, so the cycle carries
 *   on across months without a break (the cross-month check still runs on the result).
 * - Fair counts: a guard who already has more duties than the others over the last months starts on the later offset.
 * - A guard beyond the posts needed that day is marked as an extra OFF (OFF_ADD), never a ghost duty.
 */
export function proposeRoster(i: {
  month: string;
  coverage: SiteCoverage[];
  siteId: Id;
  personIds: Id[];
  pattern: '5on2off' | '6on1off';
  /** Duties per guard over the previous months, for fairness (more duties = later start). */
  pastDuties?: Record<Id, number>;
  /** Dates a guard is not available (leave, before joining, after leaving): marked PENDING for the OM to fill. */
  unavailable?: Record<Id, IsoDate[]>;
}): { lines: { personId: Id; date: IsoDate; planned: RosterStatus; plannedStart: IsoDateTime | null; plannedEnd: IsoDateTime | null }[]; uncovered: { date: IsoDate; shift: 'D' | 'N'; short: number }[] } {
  const cycle = 7;
  const work = i.pattern === '5on2off' ? 5 : 6;
  const dates = monthDates(i.month);
  const need: Record<IsoDate, { D: number; N: number }> = {};
  for (const d of dates) {
    const c = [...i.coverage].filter((x) => x.siteId === i.siteId && x.effectiveFrom <= d).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    need[d] = { D: 0, N: 0 };
    if (!c) continue;
    const covered = c.calendar.kind === 'every_day' || (c.calendar.kind === 'weekdays' ? c.calendar.weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) : c.calendar.dates.includes(d));
    if (covered) for (const s of c.shifts) need[d][s.code] += s.posts;
  }
  const latest = [...i.coverage].filter((x) => x.siteId === i.siteId && x.effectiveFrom <= dates.at(-1)!).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const shiftOf = (code: 'D' | 'N') => latest?.shifts.find((s) => s.code === code) ?? null;
  const dayPosts = shiftOf('D')?.posts ?? 0;
  const nightPosts = shiftOf('N')?.posts ?? 0;
  // Fair order: fewer past duties first (earlier offsets give slightly more duties in a month).
  const people = [...i.personIds].sort((a, b) => (i.pastDuties?.[a] ?? 0) - (i.pastDuties?.[b] ?? 0) || a.localeCompare(b));
  const nightCount = dayPosts + nightPosts ? Math.round((people.length * nightPosts) / (dayPosts + nightPosts)) : 0;
  const team = new Map<Id, 'D' | 'N'>(people.map((p, k) => [p, k < people.length - nightCount ? 'D' : 'N']));
  const offset = new Map<Id, number>();
  // Spread the starts evenly over the cycle so OFF days overlap as little as possible.
  for (const t of ['D', 'N'] as const) {
    const members = people.filter((p) => team.get(p) === t);
    members.forEach((p, k) => offset.set(p, Math.floor((k * cycle) / Math.max(1, members.length)) % cycle));
  }
  const anchor = Date.parse('2026-01-05T00:00:00Z'); // a Monday; cycles count from here so months chain
  const times = (date: IsoDate, code: 'D' | 'N') => {
    const s = shiftOf(code);
    if (!s) return { plannedStart: null, plannedEnd: null };
    const endDate = s.end <= s.start ? addDaysIso(date, 1) : date;
    return { plannedStart: `${date}T${s.start}:00+08:00`, plannedEnd: `${endDate}T${s.end}:00+08:00` };
  };
  const lines: ReturnType<typeof proposeRoster>['lines'] = [];
  const uncovered: ReturnType<typeof proposeRoster>['uncovered'] = [];
  for (const d of dates) {
    const n = Math.round((Date.parse(`${d}T00:00:00Z`) - anchor) / 86_400_000);
    for (const t of ['D', 'N'] as const) {
      let filled = 0;
      for (const p of people.filter((x) => team.get(x) === t)) {
        if (i.unavailable?.[p]?.includes(d)) {
          lines.push({ personId: p, date: d, planned: 'PENDING', plannedStart: null, plannedEnd: null });
          continue;
        }
        const pos = (((n + offset.get(p)!) % cycle) + cycle) % cycle;
        if (pos >= work) {
          lines.push({ personId: p, date: d, planned: pos === work ? 'OFF_REST' : 'OFF_ADD', plannedStart: null, plannedEnd: null });
        } else if (filled < need[d][t]) {
          filled++;
          lines.push({ personId: p, date: d, planned: t === 'D' ? 'WORK_D' : 'WORK_N', ...times(d, t) });
        } else lines.push({ personId: p, date: d, planned: 'OFF_ADD', plannedStart: null, plannedEnd: null });
      }
      if (filled < need[d][t]) uncovered.push({ date: d, shift: t, short: need[d][t] - filled });
    }
  }
  return { lines, uncovered };
}

/**
 * Review of PR #141 (14 Nov 2026): when a roster version replaces a published one, the completed records of the old
 * version (recorded actual, the corrected actual, the ABS decision) carry over to the same person and date, so payroll
 * never loses a verified duty. A completed day the new version left out is kept as its own line.
 */
export function carryCompletedDays(oldDays: RosterDayRow[], newDays: RosterDayRow[], newVersionId: Id): { update: { id: Id; patch: Partial<RosterDayRow> }[]; insert: RosterDayRow[] } {
  const done = oldDays.filter((d) => !d.removed && (d.actual || d.actualCorrection || d.absDecision));
  const byKey = new Map(newDays.filter((d) => !d.removed).map((d) => [`${d.personId}|${d.date}|${d.siteId}`, d]));
  const update: { id: Id; patch: Partial<RosterDayRow> }[] = [];
  const insert: RosterDayRow[] = [];
  for (const o of done) {
    const n = byKey.get(`${o.personId}|${o.date}|${o.siteId}`);
    const patch: Partial<RosterDayRow> = {};
    if (n) {
      if (!n.actual && o.actual) Object.assign(patch, { actual: o.actual, actualById: o.actualById });
      if (!n.actualCorrection && o.actualCorrection) patch.actualCorrection = o.actualCorrection;
      if (!n.absDecision && o.absDecision) patch.absDecision = o.absDecision;
      // The duty times the actual was recorded against stay with it, whatever the new version planned (Fauzan's audit
      // of 4b708ae, P1: a completed 08:00-20:00 duty must never be recalculated on new 08:00-16:00 times).
      if (o.actual && o.plannedStart && (n.plannedStart !== o.plannedStart || n.plannedEnd !== o.plannedEnd || n.planned !== o.planned))
        Object.assign(patch, { plannedStart: o.plannedStart, plannedEnd: o.plannedEnd, planned: o.planned, postId: o.postId });
      if (Object.keys(patch).length) update.push({ id: n.id, patch });
    } else {
      const id = `rd-${newVersionId}-${o.personId}-${o.date}`;
      // Restoring a line the draft had taken off: identity fields are never in an update (the database refuses them;
      // Fauzan's audit P2).
      if (newDays.some((d) => d.id === id)) {
        const { id: _id, companyId: _co, ...rest } = o;
        void _id;
        void _co;
        update.push({ id, patch: { ...rest, rosterVersionId: newVersionId, removed: false } });
      }
      else insert.push({ ...o, id, rosterVersionId: newVersionId, removed: false });
    }
  }
  return { update, insert };
}
