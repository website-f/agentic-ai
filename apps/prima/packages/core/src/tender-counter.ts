import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { Quotation } from "./types";
import type { Tender } from "./types";


/** A tender counts as entered once the bid was lodged (with the slip) or an outcome was recorded after lodging. */
export function tenderEntered(t: Tender): boolean {
  return (
    !!t.submission ||
    t.status === "submitted" ||
    t.status === "won" ||
    t.status === "lost"
  );
}

/** The month a tender was entered: the day the slip was recorded, or the closing date for older records without it. */
export function tenderEnteredOn(
  t: Tender,
): { on: IsoDate; fromClosing: boolean } | null {
  if (!tenderEntered(t)) return null;
  if (t.submission?.at)
    return { on: t.submission.at.slice(0, 10), fromClosing: false };
  return { on: t.closesOn, fromClosing: true };
}

/** The day a win was recorded, or the closing date for older records without it. */
export function tenderWonOn(
  t: Tender,
): { on: IsoDate; fromClosing: boolean } | null {
  if (t.status !== "won") return null;
  if (t.outcome?.status === "won" && t.outcome.at)
    return { on: t.outcome.at.slice(0, 10), fromClosing: false };
  return { on: t.closesOn, fromClosing: true };
}

/** 'YYYY-MM' for the month of a date. */
export function monthKey(d: IsoDate): string {
  return d.slice(0, 7);
}

/** Six-month periods follow the calendar (and financial) year: 'YYYY-H1' is January to June, 'YYYY-H2' July to December. */
export function halfKey(d: IsoDate): string {
  return `${d.slice(0, 4)}-H${Number(d.slice(5, 7)) <= 6 ? 1 : 2}`;
}

/** The last n months up to and including today's, oldest first. */
export function lastMonths(today: IsoDate, n: number): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** The last n six-month periods up to and including today's, oldest first. */
export function lastHalves(today: IsoDate, n: number): string[] {
  let y = Number(today.slice(0, 4));
  let h = Number(today.slice(5, 7)) <= 6 ? 1 : 2;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-H${h}`);
    h -= 1;
    if (h === 0) {
      h = 2;
      y -= 1;
    }
  }
  return out;
}

export function halfLabel(key: string): string {
  const [y, h] = key.split("-H");
  return h === "1" ? `Jan-Jun ${y}` : `Jul-Dec ${y}`;
}

export interface TenderCounterStaff {
  userId: Id;
  name: string;
  /** Tenders this person prepared and signed as preparer that were then lodged, by month ('YYYY-MM'). */
  completedByMonth: Record<string, number>;
  /** The same, by six-month period ('YYYY-H1' / 'YYYY-H2'). */
  completedByHalf: Record<string, number>;
  /** Tenders this person signed as the company manager that were then lodged, by six-month period. */
  verifiedByHalf: Record<string, number>;
}

export interface TenderCounterCompany {
  companyId: Id;
  /** Tenders entered (lodged), by month. */
  enteredByMonth: Record<string, number>;
  /** Tenders entered, by six-month period. */
  enteredByHalf: Record<string, number>;
  /** Tenders won, by six-month period. */
  wonByHalf: Record<string, number>;
  /** Tenders lodged whose result is not recorded yet (status still 'submitted'). */
  awaitingResult: number;
  /** Older records counted by their closing date because the slip or result date was not recorded. */
  datedByClosing: number;
  staff: TenderCounterStaff[];
}

function bump(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Counts one company's tenders. Months and periods with nothing stay out of the records (read as zero). */
export function countCompanyTenders(
  companyId: Id,
  tenders: Tender[],
): TenderCounterCompany {
  const out: TenderCounterCompany = {
    companyId,
    enteredByMonth: {},
    enteredByHalf: {},
    wonByHalf: {},
    awaitingResult: 0,
    datedByClosing: 0,
    staff: [],
  };
  const staff = new Map<Id, TenderCounterStaff>();
  const person = (userId: Id, name: string) => {
    let s = staff.get(userId);
    if (!s) {
      s = {
        userId,
        name,
        completedByMonth: {},
        completedByHalf: {},
        verifiedByHalf: {},
      };
      staff.set(userId, s);
    }
    return s;
  };
  for (const t of tenders) {
    if (t.companyId !== companyId) continue;
    const entered = tenderEnteredOn(t);
    if (!entered) continue;
    bump(out.enteredByMonth, monthKey(entered.on));
    bump(out.enteredByHalf, halfKey(entered.on));
    if (t.status === "submitted") out.awaitingResult += 1;
    const won = tenderWonOn(t);
    if (won) bump(out.wonByHalf, halfKey(won.on));
    if (entered.fromClosing || won?.fromClosing) out.datedByClosing += 1;
    // A bid can be sent back and signed again; each person counts once per tender.
    const preparer = [...(t.verifications ?? [])]
      .reverse()
      .find((v) => v.level === "PREPARER");
    if (preparer) {
      const s = person(preparer.userId, preparer.by);
      bump(s.completedByMonth, monthKey(entered.on));
      bump(s.completedByHalf, halfKey(entered.on));
    }
    const manager = [...(t.verifications ?? [])]
      .reverse()
      .find((v) => v.level === "MANAGER");
    if (manager)
      bump(
        person(manager.userId, manager.by).verifiedByHalf,
        halfKey(entered.on),
      );
  }
  out.staff = [...staff.values()].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** A quotation counts as sent once marked sent; accepted or rejected ones were sent first. */
export function quotationSentOn(
  q: Quotation,
): { on: IsoDate; estimated: boolean } | null {
  if (q.status !== "sent" && q.status !== "accepted" && q.status !== "rejected")
    return null;
  if (q.sent?.at) return { on: q.sent.at.slice(0, 10), estimated: false };
  return { on: (q.approvedAt ?? q.preparedAt).slice(0, 10), estimated: true };
}

/** The day the client accepted, or the sent date for older records without it. */
export function quotationAcceptedOn(
  q: Quotation,
): { on: IsoDate; estimated: boolean } | null {
  if (q.status !== "accepted") return null;
  if (q.decided?.status === "accepted" && q.decided.at)
    return { on: q.decided.at.slice(0, 10), estimated: false };
  const sent = quotationSentOn(q);
  return sent ? { on: sent.on, estimated: true } : null;
}

export interface QuotationCounterStaff {
  userId: Id;
  name: string;
  /** Quotations this person prepared that were sent to the client, by month. */
  sentByMonth: Record<string, number>;
  /** The same, by six-month period. */
  sentByHalf: Record<string, number>;
  /** Of those, accepted by the client, by six-month period (dated by acceptance). */
  acceptedByHalf: Record<string, number>;
}

export interface QuotationCounterCompany {
  companyId: Id;
  sentByMonth: Record<string, number>;
  sentByHalf: Record<string, number>;
  acceptedByHalf: Record<string, number>;
  /** Sent and still waiting for the client's answer. */
  awaitingAnswer: number;
  /** Older records dated by approval or preparation because the sent or answer date was not recorded. */
  estimatedDates: number;
  staff: QuotationCounterStaff[];
}

/** Counts one company's quotations and proposals sent and accepted. */
export function countCompanyQuotations(
  companyId: Id,
  quotations: Quotation[],
): QuotationCounterCompany {
  const out: QuotationCounterCompany = {
    companyId,
    sentByMonth: {},
    sentByHalf: {},
    acceptedByHalf: {},
    awaitingAnswer: 0,
    estimatedDates: 0,
    staff: [],
  };
  const staff = new Map<Id, QuotationCounterStaff>();
  for (const q of quotations) {
    if (q.companyId !== companyId) continue;
    const sent = quotationSentOn(q);
    if (!sent) continue;
    bump(out.sentByMonth, monthKey(sent.on));
    bump(out.sentByHalf, halfKey(sent.on));
    if (q.status === "sent") out.awaitingAnswer += 1;
    const accepted = quotationAcceptedOn(q);
    if (accepted) bump(out.acceptedByHalf, halfKey(accepted.on));
    if (sent.estimated || accepted?.estimated) out.estimatedDates += 1;
    let s = staff.get(q.preparedById);
    if (!s) {
      s = {
        userId: q.preparedById,
        name: q.preparedBy,
        sentByMonth: {},
        sentByHalf: {},
        acceptedByHalf: {},
      };
      staff.set(q.preparedById, s);
    }
    bump(s.sentByMonth, monthKey(sent.on));
    bump(s.sentByHalf, halfKey(sent.on));
    if (accepted) bump(s.acceptedByHalf, halfKey(accepted.on));
  }
  out.staff = [...staff.values()].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}