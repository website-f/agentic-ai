// Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report
// needed"). On the make day (the 1st, rule RPT-AUTO) Prima works out each monthly report from the records already in
// Prima for the month just ended, so nobody types it: the company monthly reports to the Director Office, every central
// department's monthly report on the ACT standard form, each client's service report, and the group report for the CEO.
// The owner keys in only what Prima cannot know (a short note per section) and sends it. Deterministic: no AI, no
// provider call, nothing guessed. A figure Prima cannot read (module not installed, wall closed) is shown as "Not
// available", never as zero.
import { simplePdf } from './simple-pdf';
import type { Filter, Range, Row } from './store';
import type { Id, IsoDate, IsoDateTime, TableName, User } from './types';

export type AutoReportKind = 'company' | 'department' | 'client' | 'group';

/** The group report for the CEO and the client service report are not on the Director Office's list of reports. */
export const GROUP_REPORT_ID = 'group-ceo-monthly';
export const CLIENT_REPORT_ID = 'client-service-monthly';

export interface AutoReportSection {
  title: string;
  /** What Prima worked out from its own records. Empty when the section needs the owner's words. */
  lines: string[];
  /** The owner's own words for this section (Key in), at most 600 characters. */
  note?: string;
  /** Where the part comes from: Prima's records (default), a part the Director Office added, or the owner's own part. */
  source?: 'prima' | 'added' | 'own';
  /** Set by the Director Office: the part must have something (Prima's figures or the owner's words) before sending. */
  must?: boolean;
  /** What the Director Office wants in an added part. */
  hint?: string;
  /** The owner left this optional part out of their report (it stays listed so they can put it back). */
  hidden?: boolean;
}

/**
 * What a monthly report must have and what is added to it, set by the Director Office per report (Fauzan, 23 Nov
 * 2026: "At director office adminstrator can set what must have and what need added in each report"). The owner may
 * still leave out optional parts and add their own parts ("Let they customize follow thier preference"); their choice
 * is carried to the next month.
 */
export interface AutoReportLayout {
  /** The report: a reportDefs id, CLIENT_REPORT_ID or GROUP_REPORT_ID. */
  id: string;
  /** Prima's parts in the order shown: must (always in, needs content to send), optional (owner may leave out) or off. */
  parts: { title: string; use: 'must' | 'optional' | 'off' }[];
  /** Parts the owner keys in, with what the Director Office wants written. */
  added: { title: string; hint: string; must: boolean }[];
  /** The owner may add parts of their own. */
  ownParts: boolean;
  by: string;
  at: IsoDateTime;
  note: string;
  history: { at: IsoDateTime; by: string; note: string }[];
}

/** The owner's own choices, carried from last month's report. */
export interface AutoReportPrefs {
  hidden: string[];
  own: string[];
}

/** Apply the Director Office's layout and the owner's own choices to the parts Prima worked out. */
export function applyLayout(fresh: AutoReportSection[], layout: AutoReportLayout | null, prefs: AutoReportPrefs | null): AutoReportSection[] {
  let out: AutoReportSection[];
  if (!layout) out = fresh.map((s) => ({ ...s, source: 'prima' as const }));
  else {
    const byTitle = new Map(fresh.map((s) => [s.title, s]));
    const listed = new Set(layout.parts.map((p) => p.title));
    out = [];
    for (const p of layout.parts) {
      const s = byTitle.get(p.title);
      if (s && p.use !== 'off') out.push({ ...s, source: 'prima', must: p.use === 'must' || undefined });
    }
    // A part Prima began to make after the layout was set is shown, as optional.
    for (const s of fresh) if (!listed.has(s.title)) out.push({ ...s, source: 'prima' });
    for (const a of layout.added) out.push({ title: a.title, lines: [], source: 'added', must: a.must || undefined, hint: a.hint || undefined });
  }
  if (prefs) {
    const hide = new Set(prefs.hidden);
    out = out.map((s) => (!s.must && hide.has(s.title) ? { ...s, hidden: true } : s));
    if (!layout || layout.ownParts) for (const t of prefs.own) if (!out.some((s) => s.title === t)) out.push({ title: t, lines: [], source: 'own' });
  }
  return out;
}

/** The owner's choices as they stand on a report, to carry to next month. */
export function prefsOf(sections: AutoReportSection[]): AutoReportPrefs {
  return { hidden: sections.filter((s) => s.hidden).map((s) => s.title), own: sections.filter((s) => s.source === 'own').map((s) => s.title) };
}

/** Must-have parts with nothing in them (no figures from Prima and no words from the owner). */
export function missingMust(sections: AutoReportSection[]): string[] {
  return sections.filter((s) => s.must && !s.hidden && !s.lines.length && !s.note).map((s) => s.title);
}

export interface AutoReport {
  id: Id;
  /** The Director Office report (reportDefs id), or GROUP_REPORT_ID / CLIENT_REPORT_ID. */
  defId: string;
  name: string;
  kind: AutoReportKind;
  /** The month reported, YYYY-MM. */
  period: string;
  companyId: Id | null;
  department: string | null;
  clientId: Id | null;
  /** The company, department or client the report is for. */
  scopeName: string;
  /** The day it must reach the Director Office (or the client), from the report list. */
  due: IsoDate;
  madeAt: IsoDateTime;
  madeBy: string;
  version: number;
  sections: AutoReportSection[];
  /** Papers the owner added (Upload), sent with the report where the report takes more than one file. */
  extras: { name: string; data: string; by: string; at: IsoDateTime }[];
  status: 'made' | 'sent';
  sent: { by: string; byId: Id; at: IsoDateTime; checked: boolean; note: string } | null;
  history: { at: IsoDateTime; by: string; note: string }[];
}

/** Reads rows; null when the table is not installed or this sign-in may not read it. */
export type ReadRows = <T extends TableName>(table: T, filter?: Filter<T>, range?: Range<T>) => Promise<Row<T>[] | null>;

export function reportMonthBefore(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export function reportMonthAfter(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function monthName(ym: string): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
const inMonth = (at: string | null | undefined, m: string) => !!at && at.slice(0, 7) === m;
const NA = 'Not available (not installed or not readable here)';
const n = (v: number) => v.toLocaleString('en-MY');
const rm = (v: number) => `RM ${v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lastDay = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const plusDays = (d: IsoDate, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/** One block of figures, or the line saying it could not be read. */
async function block(lines: string[], f: () => Promise<string[] | null>) {
  try {
    const got = await f();
    if (got === null) lines.push(NA);
    else lines.push(...got);
  } catch {
    lines.push(NA);
  }
}

// ---------- the figures ----------

export interface Scope {
  month: string;
  /** Companies the report covers (one company, or every company the reader may see). */
  companyIds: Id[];
}

async function peopleLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const people = await read('people', { companyId: s.companyIds });
  if (!people) return null;
  const end = lastDay(s.month);
  const onBooks = people.filter((p) => p.hiredOn <= end && p.status !== 'left');
  const joined = people.filter((p) => inMonth(p.hiredOn, s.month));
  const left = people.filter((p) => p.status === 'left' && inMonth((p as { leftOn?: string | null }).leftOn ?? null, s.month));
  const foreign = onBooks.filter((p) => p.nationality !== 'MY').length;
  return [
    `Headcount at month end: ${n(onBooks.length)} (${n(onBooks.length - foreign)} local, ${n(foreign)} foreign)`,
    `Joined in the month: ${n(joined.length)}`,
    `Left in the month: ${n(left.length)}`,
  ];
}

async function leaveLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const leave = await read('leaveRequests', { companyId: s.companyIds });
  if (!leave) return null;
  const m = leave.filter((l) => l.status === 'approved' && (inMonth(l.from, s.month) || inMonth(l.to, s.month)));
  const days = (k: (kind: string) => boolean) => m.filter((l) => k(l.kind)).reduce((t, l) => t + (l.days || 0), 0);
  const pending = leave.filter((l) => l.status === 'pending').length;
  return [
    `Leave approved in the month: ${n(m.length)} requests, ${n(days(() => true))} days (${n(days((k) => k === 'MEDICAL' || k === 'HOSPITAL'))} sick or hospital days)`,
    `Leave still waiting for a decision: ${n(pending)}`,
  ];
}

async function dutyLines(read: ReadRows, s: Scope, siteIds?: Id[]): Promise<string[] | null> {
  const from = `${s.month}-01`;
  const before = `${reportMonthAfter(s.month)}-01`;
  const shifts = await read('shifts', { companyId: s.companyIds }, { field: 'date', from, before });
  const att = await read('attendance', { companyId: s.companyIds }, { field: 'clockIn', from: plusDays(from, -1), before: plusDays(before, 1) });
  if (!shifts || !att) return null;
  const sites = siteIds ? new Set(siteIds) : null;
  const planned = shifts.filter((x) => x.status === 'published' && x.personId && (!sites || sites.has(x.siteId)));
  const came = new Set(att.filter((a) => a.clockIn && a.shiftId).map((a) => a.shiftId as Id));
  const past = planned.filter((x) => x.end <= `${before}T00:00:00`);
  const noShow = past.filter((x) => !came.has(x.id)).length;
  const pct = past.length ? Math.round(((past.length - noShow) / past.length) * 1000) / 10 : null;
  return [
    `Shifts planned: ${n(planned.length)}`,
    `Shifts attended: ${n(past.length - noShow)}${pct === null ? '' : ` (${pct}%)`}`,
    `No-shows: ${n(noShow)}`,
  ];
}

async function caseLines(read: ReadRows, s: Scope, siteIds?: Id[]): Promise<string[] | null> {
  const cases = await read('cases', { companyId: s.companyIds });
  if (!cases) return null;
  const sites = siteIds ? new Set(siteIds) : null;
  const mine = cases.filter((c) => !sites || (c.siteId && sites.has(c.siteId)));
  const opened = mine.filter((c) => inMonth(c.openedAt, s.month));
  const sev = (v: string) => opened.filter((c) => c.severity === v).length;
  const closedIn = mine.filter((c) => (c.status === 'closed' || c.status === 'resolved') && c.events.some((e) => inMonth(e.at, s.month) && /clos|resol/i.test(`${e.action} ${e.note ?? ''}`))).length;
  const end = `${lastDay(s.month)}T23:59:59`;
  const openAtEnd = mine.filter((c) => c.openedAt <= end && c.status !== 'closed' && c.status !== 'resolved').length;
  return [
    `Incidents and cases opened: ${n(opened.length)} (P1 ${sev('P1')}, P2 ${sev('P2')}, P3 ${sev('P3')}, P4 ${sev('P4')})`,
    `Cases closed in the month: ${n(closedIn)}`,
    `Cases from the month or before still open today: ${n(openAtEnd)}`,
  ];
}

async function clientLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const acc = await read('clientAccounts', { companyId: s.companyIds });
  if (!acc) return null;
  const active = acc.filter((a) => a.stage === 'active' || a.stage === 'offboarding');
  const complaints = acc.flatMap((a) => a.complaints ?? []);
  const newC = complaints.filter((c) => inMonth(c.at, s.month)).length;
  const fixed = complaints.filter((c) => inMonth(c.resolvedAt, s.month)).length;
  const ratings = acc.flatMap((a) => a.ratings).filter((r) => inMonth(r.at, s.month));
  const avg = ratings.length ? (ratings.reduce((t, r) => t + r.score, 0) / ratings.length).toFixed(1) : null;
  const sent = acc.filter((a) => a.reports.some((r) => r.period === s.month)).length;
  return [
    `Clients served: ${n(active.length)}`,
    `Client complaints received: ${n(newC)}, resolved: ${n(fixed)}`,
    `Client satisfaction: ${avg ? `${avg} out of 5 from ${ratings.length} ratings` : 'no rating recorded'}`,
    `Client service reports already sent for the month: ${n(sent)} of ${n(active.length)}`,
  ];
}

async function moneyLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const acc = await read('clientAccounts', { companyId: s.companyIds });
  const claims = await read('staffClaims', { companyId: s.companyIds });
  const pur = await read('purRequests', { companyId: s.companyIds });
  if (!acc && !claims && !pur) return null;
  const out: string[] = [];
  if (acc) {
    const inv = acc.flatMap((a) => a.invoices ?? []).filter((i) => i.period === s.month);
    const overdue = acc.reduce((t, a) => t + (a.billing?.overdueAmount ?? 0), 0);
    out.push(`Client invoices recorded for the month: ${n(inv.length)}, ${rm(inv.reduce((t, i) => t + (i.amount || 0), 0))}`);
    out.push(`Client money overdue (latest billing status): ${rm(overdue)}`);
  } else out.push(`Client billing: ${NA}`);
  if (claims) {
    const paid = claims.filter((c) => inMonth(c.paid?.at, s.month));
    out.push(`Staff claims paid: ${n(paid.length)}, ${rm(paid.reduce((t, c) => t + (c.allowed || 0), 0))}`);
  } else out.push(`Staff claims: ${NA}`);
  if (pur) {
    const approved = pur.filter((p) => p.approvals.some((a) => inMonth((a as { at?: string }).at, s.month)) && ['approved', 'ordered', 'received', 'posted'].includes(p.status));
    out.push(`Purchases approved: ${n(approved.length)}, ${rm(approved.reduce((t, p) => t + (p.total || 0), 0))}`);
  } else out.push(`Purchases: ${NA}`);
  out.push('Profit and loss, bank balances and aged debtors are kept in SQL Account: attach them with Upload or key in the totals.');
  return out;
}

async function visitLines(read: ReadRows, s: Scope, siteIds?: Id[]): Promise<string[] | null> {
  const v = await read('siteVisits', { companyId: s.companyIds });
  if (!v) return null;
  const sites = siteIds ? new Set(siteIds) : null;
  const m = v.filter((x) => inMonth(x.startedAt, s.month) && (!sites || sites.has(x.siteId)));
  return [`Site visits by officers and managers: ${n(m.length)}`];
}

async function tenderLines(read: ReadRows, s: Scope, marketingOnly = false): Promise<string[] | null> {
  const t = await read('tenders', { companyId: s.companyIds });
  if (!t) return null;
  const pool = marketingOnly ? t.filter((x) => x.desk === 'MARKETING') : t;
  const sent = pool.filter((x) => inMonth(x.submission?.at, s.month)).length;
  const won = pool.filter((x) => x.outcome?.status === 'won' && inMonth(x.outcome.at, s.month)).length;
  const lost = pool.filter((x) => x.outcome?.status === 'lost' && inMonth(x.outcome.at, s.month)).length;
  const closing = pool.filter((x) => x.closesOn > lastDay(s.month) && x.closesOn <= plusDays(lastDay(s.month), 30) && !x.submission).length;
  return [`Tenders submitted: ${n(sent)}; won: ${n(won)}; lost: ${n(lost)}`, `Tenders closing in the next 30 days not yet submitted: ${n(closing)}`];
}

/** Licences, permits and insurance ending in the 90 days after the month. */
async function datesDueLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const end = lastDay(s.month);
  const until = plusDays(end, 90);
  const out: string[] = [];
  const lic = await read('licences', { companyId: s.companyIds });
  if (lic) out.push(`Company licences ending in the next 90 days: ${n(lic.filter((l) => (l as { expiresOn?: string | null }).expiresOn && (l as { expiresOn: string }).expiresOn > end && (l as { expiresOn: string }).expiresOn <= until).length)}`);
  const cred = await read('credentials', { companyId: s.companyIds });
  if (cred) out.push(`Staff permits and cards ending in the next 90 days: ${n(cred.filter((c) => c.expiresOn && c.expiresOn > end && c.expiresOn <= until).length)}`);
  const ins = await read('insurancePolicies', { companyId: s.companyIds });
  if (ins) out.push(`Insurance policies ending in the next 90 days: ${n(ins.filter((p) => p.status !== 'cancelled' && p.expiresOn > end && p.expiresOn <= until).length)}`);
  return out.length ? out : null;
}

async function reportsSentLines(read: ReadRows, s: Scope): Promise<string[] | null> {
  const subs = await read('reportSubmissions');
  if (!subs) return null;
  const ids = new Set(s.companyIds);
  const m = subs.filter((x) => x.companyId && ids.has(x.companyId) && inMonth(x.at, s.month));
  return [`Reports sent to the Director Office in the month: ${n(m.length)}`];
}

/** Work tasks of a set of people (a department's staff): done, open, overdue. */
async function workLines(read: ReadRows, month: string, userIds: Id[]): Promise<string[] | null> {
  const tasks = await read('workTasks', { userId: userIds });
  if (!tasks) return null;
  const end = `${lastDay(month)}T23:59:59`;
  const done = tasks.filter((t) => (t.status === 'done' || t.status === 'accepted') && inMonth(t.evidence?.at ?? t.review?.at ?? null, month)).length;
  const open = tasks.filter((t) => t.createdAt <= end && (t.status === 'open' || t.status === 'returned'));
  const late = open.filter((t) => t.dueAt < end).length;
  return [`Work done in the month: ${n(done)}`, `Work still open at month end: ${n(open.length)}`, `Of which overdue: ${n(late)}`];
}

async function meetingLines(read: ReadRows, month: string, department: string | null, companyIds: Id[] | null): Promise<string[] | null> {
  const meetings = await read('meetings');
  if (!meetings) return null;
  const ids = companyIds ? new Set(companyIds) : null;
  const m = meetings.filter((x) => inMonth(x.start, month) && x.status === 'held' && (department ? x.department === department : ids ? !!x.companyId && ids.has(x.companyId) : true));
  return [`Meetings held: ${n(m.length)}; minutes in: ${n(m.filter((x) => x.minutes).length)}`];
}

/** The figures ACT checks for each department (rule RPT-MONTHLY checks), worked out from Prima's own records. */
async function departmentFigures(read: ReadRows, dept: string, s: Scope): Promise<string[]> {
  const out: string[] = [];
  const m = s.month;
  switch (dept) {
    case 'operations':
      await block(out, () => dutyLines(read, s));
      await block(out, () => caseLines(read, s));
      await block(out, () => visitLines(read, s));
      break;
    case 'hr':
      await block(out, () => peopleLines(read, s));
      await block(out, () => leaveLines(read, s));
      await block(out, async () => {
        const pc = await read('payChanges', { companyId: s.companyIds });
        if (!pc) return null;
        return [`Pay changes verified: ${n(pc.filter((p) => p.status === 'verified' && inMonth(p.decidedAt, m)).length)}; still waiting: ${n(pc.filter((p) => p.status === 'pending').length)}`];
      });
      break;
    case 'arms_control':
      await block(out, async () => {
        const fa = await read('firearms', { companyId: s.companyIds });
        const mv = await read('armsMovements', { companyId: s.companyIds });
        if (!fa || !mv) return null;
        const onReg = fa.filter((f) => !f.offRegister);
        const issued = mv.filter((x) => inMonth(x.issuedAt, m));
        const late = issued.filter((x) => !x.returnedAt || x.returnedAt > x.dueBack).length;
        return [`Firearms on the register: ${n(onReg.length)}; missing: ${n(onReg.filter((f) => f.missingSince).length)}`, `Firearms issued in the month: ${n(issued.length)}; returned late or not yet: ${n(late)}`];
      });
      break;
    case 'chief_of_staff':
      await block(out, async () => {
        const pol = await read('insurancePolicies', { companyId: s.companyIds });
        const cl = await read('insuranceClaims', { companyId: s.companyIds });
        if (!pol || !cl) return null;
        const end = lastDay(m);
        return [
          `Insurance policies in force: ${n(pol.filter((p) => p.status !== 'cancelled' && p.startsOn <= end && p.expiresOn >= end).length)}`,
          `Premiums paid in the month: ${n(pol.filter((p) => inMonth(p.premiumPaidOn, m)).length)}`,
          `Claims opened: ${n(cl.filter((c) => inMonth(c.incidentOn, m)).length)}; settled: ${n(cl.filter((c) => inMonth(c.settledOn, m)).length)}`,
        ];
      });
      break;
    case 'cms':
      await block(out, async () => {
        const al = await read('siteAlarms', { companyId: s.companyIds });
        const calls = await read('phoneCalls', { companyId: s.companyIds });
        const disp = await read('siteDispatches', { companyId: s.companyIds });
        if (!al) return null;
        const a = al.filter((x) => inMonth(x.at, m));
        return [
          `Alarms received: ${n(a.length)}; closed: ${n(a.filter((x) => x.status === 'closed').length)}; reviewed as false: ${n(a.filter((x) => x.falseReview?.agree).length)}`,
          `Calls logged: ${calls ? n(calls.filter((x) => inMonth(x.at, m)).length) : NA}`,
          `Dispatches sent: ${disp ? n(disp.filter((x) => inMonth(x.sentAt, m)).length) : NA}`,
        ];
      });
      break;
    case 'director_office':
      await block(out, () => tenderLines(read, s));
      await block(out, () => meetingLines(read, m, null, null));
      await block(out, async () => {
        const subs = await read('reportSubmissions');
        if (!subs) return null;
        return [`Reports received from companies and departments in the month: ${n(subs.filter((x) => inMonth(x.at, m)).length)}`];
      });
      break;
    case 'fwm':
      await block(out, async () => {
        const r = await read('fwRenewals', { companyId: s.companyIds });
        if (!r) return null;
        return [`Permit renewals submitted: ${n(r.filter((x) => inMonth(x.submittedOn, m)).length)}; finished: ${n(r.filter((x) => inMonth(x.doneAt, m)).length)}`];
      });
      await block(out, () => datesDueLines(read, s));
      break;
    case 'pdpa':
      await block(out, async () => {
        const r = await read('pdpaRequests', { companyId: s.companyIds });
        if (!r) return null;
        return [`Data requests received: ${n(r.filter((x) => inMonth(x.receivedOn, m)).length)}; closed: ${n(r.filter((x) => inMonth(x.closed?.at, m)).length)}; open past due: ${n(r.filter((x) => x.status === 'open' && x.dueOn <= lastDay(m)).length)}`];
      });
      break;
    case 'transport':
      await block(out, async () => {
        const v = await read('vehicles', { companyId: s.companyIds });
        const r = await read('vehicleRequests', { companyId: s.companyIds });
        if (!v) return null;
        const end = lastDay(m);
        const until = plusDays(end, 90);
        const dueSoon = v.filter((x) => Object.values(x.renewals ?? {}).some((d) => d && d > end && d <= until)).length;
        return [
          `Vehicles: ${n(v.length)}; service overdue: ${n(v.filter((x) => x.service?.dueOn && x.service.dueOn <= end).length)}; road tax or insurance due in 90 days: ${n(dueSoon)}`,
          `Vehicle bookings in the month: ${r ? n(r.filter((x) => inMonth(x.requestedAt, m)).length) : NA}`,
        ];
      });
      break;
    case 'asset':
      await block(out, async () => {
        const w = await read('amWorkOrders');
        if (!w) return null;
        return [`Repair and maintenance jobs raised: ${n(w.filter((x) => inMonth(x.raisedOn, m)).length)}; done: ${n(w.filter((x) => inMonth(x.doneOn, m)).length)}; open: ${n(w.filter((x) => x.status !== 'done').length)}`];
      });
      break;
    case 'finance':
      await block(out, () => moneyLines(read, s));
      await block(out, async () => {
        const runs = await read('staffPayRuns', { companyId: s.companyIds });
        if (!runs) return null;
        return [`Staff payroll runs paid in the month: ${n(runs.filter((r) => inMonth(r.paid?.paidOn, m)).length)}`];
      });
      break;
    case 'it':
      await block(out, async () => {
        const t = await read('itTickets');
        if (!t) return null;
        const end = `${lastDay(m)}T23:59:59`;
        return [
          `Help requests opened: ${n(t.filter((x) => inMonth(x.at, m)).length)}; resolved: ${n(t.filter((x) => inMonth(x.resolvedAt, m)).length)}`,
          `Still open at month end: ${n(t.filter((x) => x.at <= end && (!x.resolvedAt || x.resolvedAt > end)).length)}`,
        ];
      });
      await block(out, async () => {
        const a = await read('itAssets');
        if (!a) return null;
        return [`Devices in use: ${n(a.filter((x) => x.status === 'in_use').length)}; in repair: ${n(a.filter((x) => x.status === 'repair').length)}; lost or stolen: ${n(a.filter((x) => x.status === 'lost' || x.status === 'stolen').length)}`];
      });
      break;
    case 'legal':
      await block(out, async () => {
        const l = await read('legalMatters', { companyId: s.companyIds });
        if (!l) return null;
        const end = lastDay(m);
        return [
          `Legal matters open: ${n(l.filter((x) => x.status === 'open').length)}; new in the month: ${n(l.filter((x) => inMonth(x.openedOn, m)).length)}`,
          `Court or legal dates in the next 30 days: ${n(l.filter((x) => x.nextDate && x.nextDate.on > end && x.nextDate.on <= plusDays(end, 30)).length)}`,
        ];
      });
      break;
    case 'audit':
      await block(out, async () => {
        const f = await read('actFindings');
        const a = await read('actAudits');
        if (!f) return null;
        return [
          `ACT findings opened: ${n(f.filter((x) => inMonth(x.raisedAt, m)).length)}; closed: ${n(f.filter((x) => x.status === 'closed' && x.checks.some((c) => inMonth(c.at, m))).length)}; open: ${n(f.filter((x) => x.status !== 'closed').length)}`,
          `Reviews and audits done: ${a ? n(a.filter((x) => inMonth(x.doneOn, m) && x.kind !== 'investigation').length) : NA}`,
        ];
      });
      break;
    case 'procurement':
      await block(out, async () => {
        const p = await read('purRequests', { companyId: s.companyIds });
        if (!p) return null;
        const got = p.filter((x) => inMonth(x.at, m));
        return [
          `Purchase requests raised: ${n(got.length)}, ${rm(got.reduce((t, x) => t + (x.total || 0), 0))}`,
          `Goods received in the month: ${n(p.filter((x) => x.grn && inMonth((x.grn as { at?: string }).at, m)).length)}; waiting for approval now: ${n(p.filter((x) => x.status === 'awaiting_approval').length)}`,
        ];
      });
      break;
    case 'marketing':
      await block(out, () => tenderLines(read, s, true));
      break;
    default:
      break;
  }
  return out;
}

/** Which kind of section an ACT standard-form heading is, by its words (ACT may reword or add sections). */
function sectionKind(title: string): string {
  const t = title.toLowerCase();
  for (const [k, words] of [
    ['summary', ['summary']],
    ['figures', ['figure', 'target', 'kpi']],
    ['work', ['work done', 'work still', 'overdue']],
    ['money', ['money', 'spending', 'budget', 'payment']],
    ['people', ['people', 'headcount', 'joiner', 'leaver']],
    ['compliance', ['compliance', 'licence', 'permit']],
    ['risk', ['risk', 'incident', 'complaint']],
    ['improve', ['improvement']],
    ['decide', ['decision', 'help needed']],
  ] as [string, string[]][])
    if (words.some((w) => t.includes(w))) return k;
  return 'other';
}

const KEY_IN = 'Prima has no record for this part: key in a short note, or leave it blank.';

export interface DepartmentInput {
  dept: string;
  sections: string[];
  scope: Scope;
  /** The department's staff (for work, people and improvements). */
  staff: Pick<User, 'id' | 'name'>[];
}

/** A central department's monthly report on the ACT standard form. */
export async function buildDepartmentReport(read: ReadRows, i: DepartmentInput): Promise<AutoReportSection[]> {
  const figures = await departmentFigures(read, i.dept, i.scope);
  const ids = i.staff.map((u) => u.id);
  const work: string[] = [];
  await block(work, () => workLines(read, i.scope.month, ids));
  const people: string[] = [`Department staff on Prima: ${n(i.staff.length)}`];
  await block(people, async () => {
    const lr = await read('leaveRequests');
    if (!lr) return null;
    // Leave of central staff is recorded against their staff record; counted only when it can be matched by name.
    const names = new Set(i.staff.map((u) => u.name));
    const people = await read('people');
    if (!people) return null;
    const pids = new Set(people.filter((p) => names.has(p.name)).map((p) => p.id));
    const m = lr.filter((l) => pids.has(l.personId) && l.status === 'approved' && (inMonth(l.from, i.scope.month) || inMonth(l.to, i.scope.month)));
    return [`Leave taken by department staff: ${n(m.reduce((t, l) => t + (l.days || 0), 0))} days`];
  });
  const compliance: string[] = [];
  await block(compliance, async () => {
    const f = await read('actFindings');
    if (!f) return null;
    const own = f.filter((x) => ids.includes(x.ownerUserId));
    return [`ACT findings on this department: ${n(own.filter((x) => x.status !== 'closed').length)} open, ${n(own.filter((x) => x.status === 'closed' && x.checks.some((c) => inMonth(c.at, i.scope.month))).length)} closed in the month`];
  });
  if (['fwm', 'hr', 'chief_of_staff', 'legal'].includes(i.dept)) await block(compliance, () => datesDueLines(read, i.scope));
  const improve: string[] = [];
  await block(improve, async () => {
    const im = await read('actImprovements');
    if (!im) return null;
    const own = im.filter((x) => ids.includes(x.ownerUserId));
    return [`Improvements done in the month: ${n(own.filter((x) => inMonth(x.result?.at, i.scope.month)).length)}; still in progress: ${n(own.filter((x) => !x.result).length)}`];
  });
  const meetings: string[] = [];
  await block(meetings, () => meetingLines(read, i.scope.month, i.dept, null));
  const risk = figures.filter((l) => /incident|case|alarm|complaint|missing|lost|late|overdue/i.test(l));
  const money = figures.filter((l) => /RM |paid|premium|purchase|payroll/i.test(l));
  const summary = [...figures.filter((l) => l !== NA).slice(0, 3), ...work.slice(0, 1)].slice(0, 5);
  return i.sections.map((title) => {
    switch (sectionKind(title)) {
      case 'summary':
        return { title, lines: summary };
      case 'figures':
        return { title, lines: figures.length ? figures : [KEY_IN] };
      case 'work':
        return { title, lines: [...work, ...meetings] };
      case 'money':
        return { title, lines: money.length ? money : [KEY_IN] };
      case 'people':
        return { title, lines: people };
      case 'compliance':
        return { title, lines: compliance };
      case 'risk':
        return { title, lines: risk.length ? risk : ['No incident, alarm or complaint recorded against this department in Prima.'] };
      case 'improve':
        return { title, lines: improve };
      default:
        return { title, lines: [] };
    }
  });
}

/** A company's monthly report to the Director Office. The report list names it; the blocks follow its name. */
export async function buildCompanyReport(read: ReadRows, def: { id: string; name: string; detail: string }, scope: Scope): Promise<AutoReportSection[]> {
  const text = `${def.id} ${def.name} ${def.detail}`.toLowerCase();
  const wants = (w: string[]) => w.some((x) => text.includes(x));
  const sec = async (title: string, ...fs: (() => Promise<string[] | null>)[]) => {
    const lines: string[] = [];
    for (const f of fs) await block(lines, f);
    return { title, lines };
  };
  const out: AutoReportSection[] = [];
  const money = wants(['account', 'billing', 'collection', 'profit', 'finance', 'debtor']);
  const hr = wants(['hr', 'headcount', 'statutory', 'epf', 'socso', 'joiner']);
  const all = !money && !hr;
  if (money || all) out.push(await sec('Money: billing, collections, claims and purchases', () => moneyLines(read, scope)));
  if (hr || all) {
    out.push(await sec('People: headcount, joiners and leavers', () => peopleLines(read, scope)));
    out.push(await sec('Leave', () => leaveLines(read, scope)));
  }
  if (hr) {
    out.push(
      await sec('Statutory payments', async () => {
        const runs = await read('staffPayRuns', { companyId: scope.companyIds });
        if (!runs) return null;
        const paid = runs.filter((r) => inMonth(r.paid?.paidOn, scope.month));
        return [`Staff payroll paid in the month: ${n(paid.length)} run(s)`, 'EPF, SOCSO, EIS and PCB receipts: attach the payment slips with Upload.'];
      }),
    );
  }
  if (all) {
    out.push(await sec('Operations: duty, no-shows, visits', () => dutyLines(read, scope), () => visitLines(read, scope)));
    out.push(await sec('Incidents and cases', () => caseLines(read, scope)));
    out.push(await sec('Clients', () => clientLines(read, scope)));
    out.push(await sec('Tenders', () => tenderLines(read, scope)));
    out.push(await sec('Licences, permits and insurance due', () => datesDueLines(read, scope)));
  }
  out.push({ title: 'Notes from the company', lines: [] });
  return out;
}

/** The monthly service report for one client: its sites only. */
export async function buildClientReport(read: ReadRows, client: { id: Id; name: string; siteIds: Id[]; companyId: Id }, scope: Scope): Promise<AutoReportSection[]> {
  const sec = async (title: string, ...fs: (() => Promise<string[] | null>)[]) => {
    const lines: string[] = [];
    for (const f of fs) await block(lines, f);
    return { title, lines };
  };
  const sites = await read('sites', { companyId: [client.companyId] });
  const names = sites ? sites.filter((x) => client.siteIds.includes(x.id)).map((x) => x.name) : [];
  return [
    { title: 'Sites covered', lines: names.length ? names : [`${n(client.siteIds.length)} site(s)`] },
    await sec('Guarding: shifts and attendance', () => dutyLines(read, scope, client.siteIds)),
    await sec('Incidents at your sites', () => caseLines(read, scope, client.siteIds)),
    await sec('Supervision visits', () => visitLines(read, scope, client.siteIds)),
    await sec('Your requests and complaints', async () => {
      const acc = await read('clientAccounts', { companyId: [client.companyId] });
      const a = acc?.find((x) => x.id === client.id);
      if (!a) return null;
      const c = a.complaints ?? [];
      const r = a.requests ?? [];
      return [
        `Complaints received: ${n(c.filter((x) => inMonth(x.at, scope.month)).length)}; resolved: ${n(c.filter((x) => inMonth(x.resolvedAt, scope.month)).length)}`,
        `Requests received: ${n(r.filter((x) => inMonth((x as { at?: string }).at, scope.month)).length)}`,
      ];
    }),
    { title: 'Remarks from the operations team', lines: [] },
  ];
}

/** The group report for the CEO: every company and department in one page. */
export async function buildGroupReport(read: ReadRows, scope: Scope, depts: string[]): Promise<AutoReportSection[]> {
  const sec = async (title: string, ...fs: (() => Promise<string[] | null>)[]) => {
    const lines: string[] = [];
    for (const f of fs) await block(lines, f);
    return { title, lines };
  };
  return [
    await sec('People across the group', () => peopleLines(read, scope), () => leaveLines(read, scope)),
    await sec('Operations', () => dutyLines(read, scope), () => caseLines(read, scope), () => visitLines(read, scope)),
    await sec('Clients', () => clientLines(read, scope)),
    await sec('Money recorded in Prima', () => moneyLines(read, scope)),
    await sec('Tenders', () => tenderLines(read, scope)),
    await sec('Licences, permits and insurance due', () => datesDueLines(read, scope)),
    await sec('Monthly reports', async () => {
      const auto = await read('autoReports');
      const subs = await read('reportSubmissions');
      if (!auto || !subs) return null;
      const made = auto.filter((a) => a.period === scope.month && a.defId !== GROUP_REPORT_ID);
      const sent = made.filter((a) => a.sent);
      return [
        `Reports Prima made for the month: ${n(made.length)}; sent: ${n(sent.length)}; sent by Prima without a check: ${n(sent.filter((a) => !a.sent!.checked).length)}`,
        `Central departments on the report list: ${n(depts.length)}`,
      ];
    }),
    { title: 'Decisions or help needed from the CEO', lines: [] },
  ];
}

// ---------- the papers ----------

function header(r: AutoReport): string[] {
  return [
    r.name,
    `${r.scopeName} - ${monthName(r.period)}`,
    `Made by Prima from its own records on ${r.madeAt.slice(0, 10)} (version ${r.version}). Due ${r.due}.`,
    r.sent ? `Sent by ${r.sent.by} on ${r.sent.at.slice(0, 10)}${r.sent.checked ? '' : ' (sent by Prima on the due day, not checked by the owner)'}.` : 'Not sent yet.',
    '',
  ];
}

/** The report as a printable PDF (data URI). */
export function autoReportPdf(r: AutoReport): { name: string; data: string } {
  const lines = header(r);
  r.sections.filter((s) => !s.hidden).forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    for (const l of s.lines) lines.push(`   - ${l}`);
    if (s.note) lines.push(`   Note: ${s.note}`);
    if (s.hint && !s.note) lines.push(`   Wanted: ${s.hint}`);
    if (!s.lines.length && !s.note) lines.push(s.must ? '   (must have: nothing keyed in)' : '   (nothing keyed in)');
    lines.push('');
  });
  if (r.extras.length) lines.push(`Papers attached: ${r.extras.map((x) => x.name).join(', ')}`);
  const bytes = simplePdf(lines);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { name: `${r.name} ${r.scopeName} ${r.period}.pdf`.replace(/[^A-Za-z0-9 ._-]+/g, '').slice(0, 120), data: `data:application/pdf;base64,${btoa(bin)}` };
}

/** The report as a spreadsheet (CSV): one row per line. */
export function autoReportCsv(r: AutoReport): { name: string; data: string } {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['Report', 'For', 'Month', 'Section', 'Line'].map(q).join(',')];
  for (const s of r.sections.filter((x) => !x.hidden)) {
    for (const l of s.lines) rows.push([r.name, r.scopeName, r.period, s.title, l].map(q).join(','));
    if (s.note) rows.push([r.name, r.scopeName, r.period, s.title, `Note: ${s.note}`].map(q).join(','));
  }
  return { name: `${r.name} ${r.scopeName} ${r.period}.csv`.replace(/[^A-Za-z0-9 ._-]+/g, '').slice(0, 120), data: rows.join('\n') };
}
