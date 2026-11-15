// Merdeka Network IT policies (Fitri package Part Q, 13-14 Nov 2026): the IT module made to match the IT department's
// written policies (ticket policy IT-POL-004, procurement and inventory, disposal IT-POL-005, Microsoft 365 and domains,
// intellectual property IT-POL-001) and Fauzan's answers Q-X1 to Q-X9. Every number is a rule value (rules.ts IT-WATCH,
// IT-BUY, IT-JOBS) or a setting the IT Manager changes with a reason. Synthetic test data only.
import { RULES } from './rules';
import { addDays, dateOf, daysBetween, fromMs, myt, toMs, weekday } from './time';
import type { Id, IsoDate, IsoDateTime, ItPurchase, ItTicket, ItTicketCategory, ItTicketPriority, StaffClaim } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Tickets (Q1-Q5)
// ---------------------------------------------------------------------------------------------------------------

export const IT_TICKET_CATEGORIES: ItTicketCategory[] = ['DEVICE', 'SOFTWARE', 'NETWORK', 'EMAIL', 'M365', 'SECURITY', 'PROCUREMENT', 'ACCOUNT', 'PRIMA', 'WEBSITE', 'SOCIAL', 'OTHER'];
export const IT_TICKET_PRIORITIES: ItTicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** Screen words in BM (staff screens are BM by default). */
export const IT_CATEGORY_BM: Record<ItTicketCategory, string> = {
  DEVICE: 'Perkakasan',
  SOFTWARE: 'Perisian',
  NETWORK: 'Rangkaian',
  EMAIL: 'E-mel',
  M365: 'M365',
  SECURITY: 'Keselamatan',
  PROCUREMENT: 'Perolehan',
  ACCOUNT: 'Akaun',
  PRIMA: 'Prima',
  WEBSITE: 'Laman web',
  SOCIAL: 'Media sosial',
  OTHER: 'Lain-lain',
};

/** The policy's examples, shown as help text when choosing how urgent it is. */
export const IT_PRIORITY_HELP: Record<ItTicketPriority, string> = {
  P1: 'Kritikal: internet terputus, M365 tidak berfungsi untuk semua, pelayan rosak, ransomware.',
  P2: 'Tinggi: e-mel tidak berfungsi, pemacu kongsi tidak boleh dibuka, beberapa pengguna terjejas.',
  P3: 'Sederhana: seorang pengguna ada jalan lain (pencetak, Outlook, Teams).',
  P4: 'Rendah: pasang perisian, monitor baharu, panduan kata laluan.',
};

/** The working day: office hours on a weekday that is not a public holiday. */
export function isWorkingDay(d: IsoDate, holidays: Set<IsoDate>): boolean {
  const wd = weekday(d);
  return wd !== 0 && wd !== 6 && !holidays.has(d);
}

/** Add office minutes (8.30-5.30 by default, Monday to Friday, public holidays left out) to a time. */
export function addOfficeMinutes(at: IsoDateTime, minutes: number, holidays: Set<IsoDate>, hours = RULES.it.value.officeHours): IsoDateTime {
  let t = toMs(at);
  let left = minutes;
  for (let guard = 0; guard < 800; guard++) {
    const d = dateOf(fromMs(t));
    const open = toMs(myt(d, hours.start));
    const close = toMs(myt(d, hours.end));
    if (!isWorkingDay(d, holidays) || t >= close) {
      t = toMs(myt(addDays(d, 1), hours.start));
      continue;
    }
    if (t < open) t = open;
    const avail = (close - t) / 60_000;
    if (left <= avail) return fromMs(t + left * 60_000);
    left -= avail;
    t = toMs(myt(addDays(d, 1), hours.start));
  }
  return fromMs(t);
}

/** The office minutes in one working day (9 hours by default). */
export function officeDayMinutes(hours = RULES.it.value.officeHours): number {
  const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  return m(hours.end) - m(hours.start);
}

/** When the first response is due: P1-P3 in clock minutes; P4 in working days within office hours. */
export function ticketResponseDue(t: Pick<ItTicket, 'at' | 'priority'>, holidays: Set<IsoDate>): IsoDateTime {
  const r = RULES.it.value;
  if (t.priority === 'P4') return addOfficeMinutes(t.at, r.p4ResponseWorkingDays * officeDayMinutes(), holidays);
  return fromMs(toMs(t.at) + r.responseMinutes[t.priority] * 60_000);
}

export interface TicketResponseState {
  responseDue: IsoDateTime;
  respondedAt: IsoDateTime | null;
  /** Response late: answered after the target, or still not answered and past it. */
  responseLate: boolean;
  /** Minutes past the response target while still unanswered (0 when answered or not yet late). */
  unansweredLateMinutes: number;
  /** "Respons: dalam masa / lewat" (pending while not yet answered and not late). */
  responseLabel: 'dalam masa' | 'lewat' | 'menunggu';
  /** "Selesai": the resolved time, for information only (Q-X1: the old fix limits are not targets). */
  resolvedAt: IsoDateTime | null;
}

export function ticketResponse(t: ItTicket, now: IsoDateTime, holidays: Set<IsoDate>): TicketResponseState {
  const responseDue = ticketResponseDue(t, holidays);
  // A request resolved without a separate first response was answered when it was resolved.
  const respondedAt = t.firstResponseAt ?? t.resolvedAt ?? null;
  const responseLate = respondedAt ? respondedAt > responseDue : now > responseDue;
  const unansweredLateMinutes = !respondedAt && now > responseDue ? (toMs(now) - toMs(responseDue)) / 60_000 : 0;
  return { responseDue, respondedAt, responseLate, unansweredLateMinutes, responseLabel: respondedAt ? (responseLate ? 'lewat' : 'dalam masa') : responseLate ? 'lewat' : 'menunggu', resolvedAt: t.resolvedAt };
}

/**
 * Confirmation of a fix (Q-X2): only the person closes it. Reminders on day 3 and day 5 after it was resolved; after
 * the last reminder the IT Manager sees it "menunggu pengesahan" and chases.
 */
export function ticketConfirmState(t: ItTicket, today: IsoDate): { state: 'confirmed' | 'waiting' | 'reminder' | 'chase' | null; daysWaiting: number; reminderDay: number | null } {
  if (t.status !== 'resolved' || !t.resolvedAt) return { state: null, daysWaiting: 0, reminderDay: null };
  if (t.confirmedAt) return { state: 'confirmed', daysWaiting: 0, reminderDay: null };
  const days = daysBetween(dateOf(t.resolvedAt), today);
  const marks = RULES.it.value.confirmReminderDays;
  const last = marks[marks.length - 1] ?? 5;
  const hit = [...marks].reverse().find((d) => days >= d) ?? null;
  return { state: days > last ? 'chase' : hit != null ? 'reminder' : 'waiting', daysWaiting: days, reminderDay: hit };
}

/** A SECURITY request starts at P1 or P2; IT may lower it with a reason (Q2). */
export function securityPriority(p: ItTicketPriority): ItTicketPriority {
  return p === 'P1' ? 'P1' : 'P2';
}

/** Same person, same category, still open, raised in the last 24 hours: "Ini masalah yang sama?" (Q3, a prompt, not a block). */
export function ticketDuplicateOf(tickets: ItTicket[], userId: Id, category: ItTicketCategory, now: IsoDateTime): ItTicket | null {
  const since = toMs(now) - 24 * 3_600_000;
  return (
    tickets
      .filter((t) => t.raisedById === userId && !t.raisedFor && t.category === category && t.status !== 'resolved' && toMs(t.at) >= since)
      .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
  );
}

/** Root cause is needed to resolve a P1 or SECURITY request (Q4). */
export function rootCauseRequired(t: Pick<ItTicket, 'priority' | 'category'>): boolean {
  return t.priority === 'P1' || t.category === 'SECURITY';
}

export interface ItServiceReport {
  month: string;
  opened: number;
  resolved: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  respondedInTimePct: number | null;
  /** Q-X1: no resolve target any more; kept as a count of tickets resolved in the month for information. */
  confirmedPct: number | null;
  reopened: number;
  /** Still open with the first response missed (past the response target, no response). */
  openPastLimit: number;
  waitingConfirmation: number;
  holidaysSet: boolean;
  csv: string;
}

/** The monthly IT service report (Q5): numbers only, no ranking of staff. */
export function itServiceReport(tickets: ItTicket[], month: string, now: IsoDateTime, holidays: Set<IsoDate>, holidaysSet: boolean): ItServiceReport {
  const inMonth = (t: IsoDateTime | null | undefined) => !!t && t.slice(0, 7) === month;
  const opened = tickets.filter((t) => inMonth(t.at));
  const resolved = tickets.filter((t) => t.status === 'resolved' && inMonth(t.resolvedAt));
  const byCategory: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const t of opened) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
  }
  const answered = opened.map((t) => ticketResponse(t, now, holidays)).filter((r) => r.respondedAt);
  const inTime = answered.filter((r) => !r.responseLate).length;
  const confirmed = resolved.filter((t) => t.confirmedAt).length;
  const openPastLimit = tickets.filter((t) => t.status !== 'resolved' && ticketResponse(t, now, holidays).unansweredLateMinutes > 0).length;
  const waitingConfirmation = resolved.filter((t) => !t.confirmedAt).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const r: Omit<ItServiceReport, 'csv'> = {
    month,
    opened: opened.length,
    resolved: resolved.length,
    byCategory,
    byPriority,
    respondedInTimePct: pct(inTime, answered.length),
    confirmedPct: pct(confirmed, resolved.length),
    reopened: opened.reduce((n, t) => n + (t.reopened ?? 0), 0),
    openPastLimit,
    waitingConfirmation,
    holidaysSet,
  };
  const lines = [
    'measure,value',
    `month,${month}`,
    `opened,${r.opened}`,
    `resolved,${r.resolved}`,
    `responded_in_time_pct,${r.respondedInTimePct ?? ''}`,
    `confirmed_by_person_pct,${r.confirmedPct ?? ''}`,
    `reopened,${r.reopened}`,
    `open_past_response_target,${r.openPastLimit}`,
    `waiting_confirmation,${r.waitingConfirmation}`,
    ...Object.entries(byCategory).map(([k, v]) => `category_${k},${v}`),
    ...Object.entries(byPriority).map(([k, v]) => `priority_${k},${v}`),
  ];
  return { ...r, csv: lines.join('\n') };
}

// ---------------------------------------------------------------------------------------------------------------
// Staff claims for IT items (Q15)
// ---------------------------------------------------------------------------------------------------------------

/** An IT purchase the CEO approved (the last approval before buying). */
export function itPurchaseApproved(p: ItPurchase): boolean {
  return p.status !== 'rejected' && !!p.ceoStep && p.ceoStep.decision !== 'reject';
}

/** "Tiada PO IT yang diluluskan" when an IT equipment or software claim has no approved IT purchase; null otherwise. */
export function claimItPoNote(c: Pick<StaffClaim, 'kind' | 'itPurchaseRef'>, purchases: ItPurchase[]): string | null {
  if (c.kind !== 'IT_EQUIPMENT') return null;
  const p = c.itPurchaseRef ? purchases.find((x) => x.ref === c.itPurchaseRef) : undefined;
  return p && itPurchaseApproved(p) ? null : 'Tiada PO IT yang diluluskan';
}

/**
 * V10 (IT briefing 22 Oct 2026, "no buying a Microsoft or any software subscription for the company outside the IT
 * purchase"): a staff claim that looks like a software subscription shows "perlu kelulusan IT" to the approver. A
 * warning only, never a block (an IT equipment claim without an approved IT purchase is already refused, Q15).
 */
export function claimSoftwareNote(c: Pick<StaffClaim, 'kind' | 'note'> & { description?: string | null }): string | null {
  const text = `${c.note ?? ''} ${c.description ?? ''}`;
  return /subscri|langganan|software|perisian|microsoft|office\s*365|m365|adobe|licen[cs]e|lesen\s+perisian|saas|cloud\s+storage/i.test(text) ? 'Langganan perisian: perlu kelulusan IT' : null;
}

/** V10: what the IT briefing forbids, in plain BM, for the IT guide card and the policy library text (Q24). */
export const IT_FORBIDDEN = [
  'Jangan kongsi kata laluan dengan sesiapa, termasuk rakan sekerja dan IT.',
  'Emel syarikat dibuka hanya selepas kelulusan (permohonan akaun M365, kelulusan CoS).',
  'Jangan guna emel peribadi untuk kerja syarikat.',
  'Jangan beli langganan Microsoft atau perisian lain untuk syarikat di luar pembelian IT.',
] as const;
