// Daily cash pay (Fauzan, 2 Nov 2026): "There is one cash payment. We have daily cash buffer that need to be paid. If
// not, they dont want to work. So create a system that this type of people can be paid. Cash will be collected by coo
// or ceo to be paid." and "Only fd can approve this. They need to list it for the week or month. Before than prepare
// cash."
//
// The flow, per company and per week or month:
//   1. Finance lists the people to be paid in cash: name, last 4 of the IC or passport, the work, the daily rate and
//      the days. Prima adds it up.
//   2. Only the Finance Director approves the list, with a comment, and never a list they prepared. The CEO does not
//      approve it (Fauzan's words: "Only fd").
//   3. Only then Finance prepares the cash: the withdrawal from the company's bank, never more than the approved total,
//      later found on the bank statement.
//   4. Finance hands the cash to the COO or the CEO, who counts it and confirms the amount in Prima.
//   5. The COO or CEO pays each listed person, each day: at most the approved daily rate, only on the listed days, only
//      people on the list, with proof (the signed or thumb-printed pay sheet, or a photo of it).
//   6. At the end of the week or month the COO or CEO returns the unpaid cash. Someone in Finance (not the collector)
//      counts it and records the bank deposit. Withdrawn = paid + returned; any difference needs a reason and the FD's
//      acceptance. An unsettled list, a withdrawal not on the bank statement or an unaccepted difference stops the close.
// Prima never approves or pays: every step is a person's, with a comment where a decision is made.
import { AccessDenied } from './access';
import { isoDate, noSecrets, requireComment, requireReason, text, type FinActor } from './finance';
import { RULES } from './rules';
import { BadRequest, NotFound } from './service';
import { addDays, daysBetween } from './time';
import type { FinSign, FinStatus, Id, IsoDate, User } from './types';

const R = () => RULES.financeDailyCash.value;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type FinDailyCashStatus = 'draft' | 'to_approve' | 'approved' | 'with_collector' | 'returned' | 'settled' | 'cancelled';

export interface FinDailyCashPerson {
  id: Id;
  name: string;
  /** Last 4 characters of the IC or passport, checked by the payer at each payment. Never the full number. */
  idLast4: string;
  work: string;
  dailyRate: number;
  /** The days this person may be paid for, inside the list's dates. */
  days: IsoDate[];
  amount: number;
}

export interface FinDailyCashList {
  id: Id;
  period: 'week' | 'month';
  from: IsoDate;
  to: IsoDate;
  purpose: string;
  bankId: Id;
  status: FinDailyCashStatus;
  people: FinDailyCashPerson[];
  total: number;
  prepared: FinSign;
  submitted: FinSign | null;
  /** The Finance Director's approval (only the FD; never the preparer). */
  approved: FinSign | null;
  returnedForChange: FinSign | null;
  /** Everyone who changed the people, days or amounts (Arisha main, 3 Nov 2026: an editor never approves the list). */
  edits?: FinSign[];
  withdrawals: { id: Id; on: IsoDate; amount: number; ref: string; sign: FinSign; statement: { statementId: Id; lineId: Id; date: IsoDate } | null }[];
  /** Cash handed by Finance to the COO or CEO, and their own count. */
  handovers: { id: Id; on: IsoDate; amount: number; toId: Id; toName: string; sign: FinSign; received: (FinSign & { counted: number }) | null }[];
  payouts: { id: Id; personId: Id; day: IsoDate; amount: number; proof: string[]; sign: FinSign }[];
  /** Each holder (COO or CEO) gives back their own unpaid cash (Arisha main, 3 Nov 2026: split custody). */
  giveBacks?: (FinSign & { amount: number })[];
  /** All the unpaid cash given back: set once every holder has given back theirs (the total of `giveBacks`). */
  giveBack: (FinSign & { amount: number }) | null;
  /** Finance counts the cash given back and banks it; the difference, if any, is explained and accepted by the FD. */
  settled: (FinSign & { counted: number; depositRef: string; difference: number }) | null;
  differenceAccepted: FinSign | null;
  log: { text: string; by: string; at: string }[];
}

export interface FinDailyCashCtx {
  user: User;
  /** The Finance actor, or null for the COO (who is not a Finance actor). */
  a: FinActor | null;
  /** True for the COO or the CEO: the only people who may collect and pay the cash. */
  collector: boolean;
  today: IsoDate;
  sign: (comment?: string) => FinSign;
  /** Prima accounts by id. */
  userById: (id: Id) => User | undefined;
  /** Is this account the COO or the CEO? */
  isCollector: (u: User) => boolean;
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

function money(v: unknown, field: string, allowZero = false): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new BadRequest(`${field} must be ${allowZero ? 'RM0.00 or more' : 'more than RM0.00'}.`);
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new BadRequest(`${field} has at most 2 decimal places (sen).`);
  return round2(n);
}
const rm = (n: number) => `RM${n.toFixed(2)}`;
const finance = (ctx: FinDailyCashCtx) => {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff do this)');
  return ctx.a;
};
const collector = (ctx: FinDailyCashCtx) => {
  if (!ctx.collector) throw new AccessDenied('view', '(only the COO or the CEO collects and pays the daily cash)');
};
/**
 * Cash custody (Arisha main's review, 2 Nov 2026): the FD who approved the list never handles its cash, and whoever
 * withdrew or handed over the cash does not count it when it comes back.
 */
const notApprover = (ctx: FinDailyCashCtx, l: FinDailyCashList) => {
  if (l.approved?.byId === ctx.user.id) throw new AccessDenied('view', '(whoever approved the list does not handle its cash)');
};
const datesBetween = (from: IsoDate, to: IsoDate) => {
  const out: IsoDate[] = [];
  for (let d = from; d <= to && out.length < 40; d = addDays(d, 1)) out.push(d);
  return out;
};

export const finDailyCashWithdrawn = (l: FinDailyCashList) => round2(l.withdrawals.reduce((n, w) => n + w.amount, 0));
export const finDailyCashHanded = (l: FinDailyCashList) => round2(l.handovers.reduce((n, h) => n + h.amount, 0));
export const finDailyCashPaid = (l: FinDailyCashList) => round2(l.payouts.reduce((n, p) => n + p.amount, 0));
const paidTo = (l: FinDailyCashList, personId: Id) => round2(l.payouts.filter((p) => p.personId === personId).reduce((n, p) => n + p.amount, 0));
/** Cash the collector is holding: received from Finance, less paid out and given back. */
export const finDailyCashHeld = (l: FinDailyCashList) =>
  round2(l.handovers.reduce((n, h) => n + (h.received?.counted ?? 0), 0) - finDailyCashPaid(l) - (l.giveBack?.amount ?? finDailyCashGivenBack(l)));
/** What the holders have given back so far, each their own. */
export const finDailyCashGivenBack = (l: FinDailyCashList) => round2((l.giveBacks ?? []).reduce((n, g) => n + g.amount, 0));
/** Whether this person has already given back their own cash on the list. */
export const finDailyCashGaveBack = (l: FinDailyCashList, userId: Id) => (l.giveBacks ?? []).some((g) => g.byId === userId);
/**
 * Cash one person actually holds (Arisha main, 3 Nov 2026): what was handed to them and they counted, less what they paid
 * out. Only the person who holds the cash pays from it or gives it back.
 */
export const finDailyCashHeldBy = (l: FinDailyCashList, userId: Id) =>
  l.giveBack || finDailyCashGaveBack(l, userId)
    ? 0
    : round2(
        l.handovers.filter((h) => h.toId === userId).reduce((n, h) => n + (h.received?.counted ?? 0), 0) -
          l.payouts.filter((x) => x.sign.byId === userId).reduce((n, x) => n + x.amount, 0),
      );

function readPeople(v: unknown, from: IsoDate, to: IsoDate): FinDailyCashPerson[] {
  const list = Array.isArray(v) ? v : [];
  if (!list.length) throw new BadRequest('List at least one person to be paid in cash.');
  if (list.length > R().maxPeople) throw new BadRequest(`At most ${R().maxPeople} people on one list.`);
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const name = noSecrets(text(p.name, `Person ${n}: name`, 2, 120), 'Name');
    const idLast4 = typeof p.idLast4 === 'string' ? p.idLast4.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{4}$/.test(idLast4)) throw new BadRequest(`Person ${n}: give only the last 4 characters of the IC or passport.`);
    const key = `${name.toUpperCase()}|${idLast4}`;
    if (seen.has(key)) throw new BadRequest(`${name} is on the list twice.`);
    seen.add(key);
    const work = noSecrets(text(p.work, `Person ${n}: work or site`, 2, 120), 'Work');
    const dailyRate = money(p.dailyRate, `${name}: daily rate`);
    if (dailyRate > R().maxDailyRate) throw new BadRequest(`${name}: the daily rate is above ${rm(R().maxDailyRate)}; pay by bank instead.`);
    const all = datesBetween(from, to);
    const days = Array.isArray(p.days)
      ? [...new Set(p.days.map((d, k) => isoDate(d, `${name}: day ${k + 1}`)))].sort()
      : typeof p.dayCount === 'number'
        ? all.slice(0, Math.max(0, Math.floor(p.dayCount)))
        : all;
    if (!days.length) throw new BadRequest(`${name}: give the days to be paid.`);
    if (days.some((d) => d < from || d > to)) throw new BadRequest(`${name}: every day is between ${from} and ${to}.`);
    return { id: `p${n}`, name, idLast4, work, dailyRate, days, amount: round2(dailyRate * days.length) };
  });
}

/** Add, change and send a list (Finance); approve or return it (FD only); prepare, hand over, pay, give back and settle the cash. */
export function finDailyCashAction(ctx: FinDailyCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  const lists = f.dailyCash ?? [];
  const now = ctx.sign().at;
  const logOf = (t: string) => ({ text: t.slice(0, 400), by: ctx.user.name, at: now });

  if (action === 'add') {
    finance(ctx);
    const period = input.period === 'month' ? 'month' : input.period === 'week' ? 'week' : null;
    if (!period) throw new BadRequest('Choose a week or a month.');
    const from = isoDate(input.from, 'First day');
    const to = isoDate(input.to, 'Last day');
    const span = daysBetween(from, to) + 1;
    if (span < 1 || span > (period === 'week' ? 7 : 31))
      throw new BadRequest(period === 'week' ? 'A week list covers 1 to 7 days.' : 'A month list covers at most 31 days.');
    if (from < addDays(ctx.today, -R().backdateDays)) throw new BadRequest('The list is made before the work, or at most a few days after it starts.');
    const bank = (f.banks ?? []).find((b) => b.id === input.bankId);
    if (!bank) throw new BadRequest('Choose the company bank account the cash will come from.');
    const purpose = noSecrets(text(input.purpose, 'Why these people are paid in cash', R().reasonMin, 300), 'Purpose');
    const people = readPeople(input.people, from, to);
    if (
      lists.some(
        (l) =>
          l.status !== 'cancelled' &&
          l.from <= to &&
          l.to >= from &&
          l.people.some((p) => people.some((q) => q.name.toUpperCase() === p.name.toUpperCase() && q.idLast4 === p.idLast4)),
      )
    )
      throw new BadRequest('Someone on this list is already on another cash list for the same days.');
    const l: FinDailyCashList = {
      id: `dcash-${f.companyId}-${String(lists.length + 1).padStart(3, '0')}`,
      period,
      from,
      to,
      purpose,
      bankId: bank.id,
      status: 'draft',
      people,
      total: round2(people.reduce((n, p) => n + p.amount, 0)),
      prepared: ctx.sign(),
      submitted: null,
      approved: null,
      returnedForChange: null,
      withdrawals: [],
      handovers: [],
      payouts: [],
      giveBack: null,
      settled: null,
      differenceAccepted: null,
      log: [],
    };
    l.log.push(logOf(`Listed ${people.length} people for ${from} to ${to}, total ${rm(l.total)}`));
    return {
      patch: { dailyCash: [...lists, l] },
      action: 'finance.dailycash.add',
      summary: `Daily cash list ${l.id}: ${people.length} people, ${from} to ${to}, ${rm(l.total)}.`,
      result: l,
    };
  }

  const l = lists.find((x) => x.id === input.listId);
  if (!l) throw new NotFound('Daily cash list');
  const save = (n: FinDailyCashList) => lists.map((x) => (x.id === l.id ? n : x));
  const out = (n: FinDailyCashList, act: string, summary: string): Out<FinDailyCashList> => ({
    patch: { dailyCash: save(n) },
    action: `finance.dailycash.${act}`,
    summary,
    result: n,
  });

  if (action === 'edit') {
    finance(ctx);
    if (l.status !== 'draft') throw new BadRequest('Only a list not yet sent (or returned by the FD) can be changed.');
    const people = readPeople(input.people, l.from, l.to);
    const total = round2(people.reduce((n, p) => n + p.amount, 0));
    return out(
      {
        ...l,
        people,
        total,
        edits: [...(l.edits ?? []), ctx.sign()],
        log: [...l.log, logOf(`Changed by ${ctx.user.name}: ${people.length} people, ${rm(total)}`)],
      },
      'edit',
      `Daily cash list ${l.id} changed: ${rm(total)}.`,
    );
  }
  if (action === 'submit') {
    finance(ctx);
    if (l.status !== 'draft') throw new BadRequest('That list is not waiting to be sent.');
    return out(
      { ...l, status: 'to_approve', submitted: ctx.sign(), log: [...l.log, logOf('Sent to the Finance Director')] },
      'submit',
      `Daily cash list ${l.id} sent to the FD: ${rm(l.total)}.`,
    );
  }
  if (action === 'approve' || action === 'return') {
    const a = finance(ctx);
    if (a.kind !== 'director') throw new AccessDenied('view', '(only the Finance Director approves the daily cash list)');
    if (l.status !== 'to_approve') throw new BadRequest('That list is not waiting for approval.');
    if (l.prepared.byId === ctx.user.id || l.submitted?.byId === ctx.user.id) throw new AccessDenied('view', '(nobody approves a list they prepared)');
    // Independent review (Arisha main, 3 Nov 2026): whoever changed the people, days or amounts does not approve it.
    if (action === 'approve' && (l.edits ?? []).some((e) => e.byId === ctx.user.id))
      throw new AccessDenied('view', '(nobody approves a list they changed: return it instead; any exception route needs separate authorisation)');
    if (action === 'return') {
      const why = requireReason(input.comment, 'return the list');
      return out(
        { ...l, status: 'draft', returnedForChange: ctx.sign(why), log: [...l.log, logOf(`Returned by the FD: ${why}`)] },
        'return',
        `Daily cash list ${l.id} returned: ${why}`,
      );
    }
    const c = requireComment(input.comment);
    return out(
      { ...l, status: 'approved', approved: ctx.sign(c), log: [...l.log, logOf(`Approved by the FD: ${c}`)] },
      'approve',
      `Daily cash list ${l.id} approved by the FD, ${rm(l.total)}: ${c}`,
    );
  }
  if (action === 'cancel') {
    finance(ctx);
    if (!['draft', 'to_approve', 'approved'].includes(l.status) || l.withdrawals.length)
      throw new BadRequest('A list is cancelled before any cash is withdrawn; after that, settle it.');
    const why = requireReason(input.comment, 'cancel the list');
    return out({ ...l, status: 'cancelled', log: [...l.log, logOf(`Cancelled: ${why}`)] }, 'cancel', `Daily cash list ${l.id} cancelled: ${why}`);
  }
  if (action === 'withdraw') {
    // Prepare the cash, only after the FD's approval and never more than the approved total.
    finance(ctx);
    notApprover(ctx, l);
    if (l.status !== 'approved' && l.status !== 'with_collector') throw new BadRequest('Cash is prepared only after the Finance Director approves the list.');
    const on = isoDate(input.on, 'Date withdrawn');
    if (on > ctx.today || on < l.approved!.at.slice(0, 10)) throw new BadRequest('The withdrawal is dated between the approval and today.');
    const amount = money(input.amount, 'Cash withdrawn');
    if (finDailyCashWithdrawn(l) + amount > l.total + 0.005)
      throw new BadRequest(`That is more than the approved ${rm(l.total)} (already withdrawn ${rm(finDailyCashWithdrawn(l))}).`);
    const ref = noSecrets(text(input.ref, 'Cheque or withdrawal reference', 2, 60), 'Reference');
    const w = { id: `w${l.withdrawals.length + 1}`, on, amount, ref, sign: ctx.sign(), statement: null };
    return out(
      { ...l, withdrawals: [...l.withdrawals, w], log: [...l.log, logOf(`Cash withdrawn ${on} ${rm(amount)} (${ref})`)] },
      'withdraw',
      `Daily cash ${l.id}: ${rm(amount)} withdrawn ${on} (${ref}).`,
    );
  }
  if (action === 'bank') {
    // The withdrawal found on the bank statement.
    finance(ctx);
    const w = l.withdrawals.find((x) => x.id === input.withdrawalId);
    if (!w) throw new NotFound('Withdrawal');
    if (w.statement) throw new BadRequest('That withdrawal is already found on the statement.');
    const statements = f.statements ?? [];
    const st = statements.find((x) => x.id === input.statementId && x.bankId === l.bankId);
    const line = st?.lines.find((x) => x.id === input.lineId);
    if (!st || !line) throw new NotFound("Bank statement line from the list's account");
    if (line.match) throw new BadRequest('That bank line is already matched.');
    if (line.amount >= 0 || Math.abs(-line.amount - w.amount) >= 0.005) throw new BadRequest(`The bank line must be money out of ${rm(w.amount)}.`);
    const sign = ctx.sign();
    const lines = st.lines.map((x) =>
      x.id === line.id
        ? { ...x, match: { kind: 'other' as const, note: `Daily cash ${l.id} withdrawal ${w.ref}`, by: sign.by, byId: sign.byId, at: sign.at } }
        : x,
    );
    const n = {
      ...l,
      withdrawals: l.withdrawals.map((x) => (x.id === w.id ? { ...x, statement: { statementId: st.id, lineId: line.id, date: line.date } } : x)),
      log: [...l.log, logOf(`Withdrawal ${w.ref} found on the bank statement ${line.date}`)],
    };
    return {
      patch: { dailyCash: save(n), statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)) },
      action: 'finance.dailycash.bank',
      summary: `Daily cash ${l.id}: withdrawal ${w.ref} found on the statement.`,
      result: n,
    };
  }
  if (action === 'handover') {
    // Finance gives the cash to the COO or the CEO.
    finance(ctx);
    notApprover(ctx, l);
    if (l.status !== 'approved' && l.status !== 'with_collector') throw new BadRequest('Cash is handed over after approval and withdrawal.');
    const to = ctx.userById(String(input.toId ?? ''));
    if (!to || !ctx.isCollector(to)) throw new BadRequest('Daily cash is handed only to the COO or the CEO.');
    if (to.id === ctx.user.id) throw new AccessDenied('view', '(the cash is handed to someone else)');
    if (finDailyCashGaveBack(l, to.id))
      throw new BadRequest(`${to.name} has already given back their cash on this list; hand it to the other collector or bank it.`);
    const amount = money(input.amount, 'Cash handed over');
    if (finDailyCashHanded(l) + amount > finDailyCashWithdrawn(l) + 0.005)
      throw new BadRequest(`Only ${rm(round2(finDailyCashWithdrawn(l) - finDailyCashHanded(l)))} withdrawn cash is not yet handed over.`);
    const on = isoDate(input.on ?? ctx.today, 'Date handed over');
    if (on > ctx.today) throw new BadRequest('The handover is today or earlier.');
    const h = { id: `h${l.handovers.length + 1}`, on, amount, toId: to.id, toName: to.name, sign: ctx.sign(), received: null };
    return out(
      { ...l, status: 'with_collector', handovers: [...l.handovers, h], log: [...l.log, logOf(`${rm(amount)} handed to ${to.name}`)] },
      'handover',
      `Daily cash ${l.id}: ${rm(amount)} handed to ${to.name}, to count and confirm.`,
    );
  }
  if (action === 'received') {
    // The COO or CEO counts what they were given.
    collector(ctx);
    const h = l.handovers.find((x) => x.id === input.handoverId);
    if (!h || h.toId !== ctx.user.id) throw new NotFound('Cash handed to you');
    if (h.received) throw new BadRequest('You already confirmed that cash.');
    const counted = money(input.counted, 'Cash you counted', true);
    const short = Math.abs(counted - h.amount) >= 0.005;
    const c = short
      ? requireReason(input.comment, `confirm ${rm(counted)} when Finance handed over ${rm(h.amount)}`)
      : String(input.comment ?? '')
          .trim()
          .slice(0, 300);
    const n = {
      ...l,
      handovers: l.handovers.map((x) => (x.id === h.id ? { ...x, received: { ...ctx.sign(c), counted } } : x)),
      log: [...l.log, logOf(`${ctx.user.name} counted ${rm(counted)}${short ? ` (handed ${rm(h.amount)}): ${c}` : ''}`)],
    };
    return out(n, 'received', `Daily cash ${l.id}: ${ctx.user.name} counted ${rm(counted)}${short ? `, not the ${rm(h.amount)} handed over` : ''}.`);
  }
  if (action === 'pay') {
    collector(ctx);
    if (l.status !== 'with_collector') throw new BadRequest('That list has no cash with the COO or CEO.');
    const p = l.people.find((x) => x.id === input.personId);
    if (!p) throw new BadRequest('Only people on the approved list are paid.');
    const day = isoDate(input.day, 'Day worked');
    if (!p.days.includes(day)) throw new BadRequest(`${p.name} is not listed for ${day}.`);
    if (day > ctx.today) throw new BadRequest('Pay for a day once it has come.');
    if (l.payouts.some((x) => x.personId === p.id && x.day === day)) throw new BadRequest(`${p.name} is already paid for ${day}.`);
    const amount = money(input.amount ?? p.dailyRate, 'Cash paid');
    if (amount > p.dailyRate + 0.005) throw new BadRequest(`${p.name}'s approved daily rate is ${rm(p.dailyRate)}.`);
    if (paidTo(l, p.id) + amount > p.amount + 0.005) throw new BadRequest(`${p.name}'s approved total is ${rm(p.amount)}.`);
    // The actual custodian (Arisha main, 3 Nov 2026): only cash handed to this person and counted by them is paid out by them.
    const mine = finDailyCashHeldBy(l, ctx.user.id);
    if (amount > mine + 0.005)
      throw new BadRequest(
        mine > 0.005
          ? `You hold ${rm(mine)} of this list's cash.`
          : "You hold none of this list's cash: only the person it was handed to (and who counted it) pays from it.",
      );
    const proof = (Array.isArray(input.proof) ? input.proof : typeof input.proof === 'string' && input.proof.trim() ? [input.proof] : [])
      .slice(0, 5)
      .map((d, i) => noSecrets(text(d, `Proof ${i + 1}`, 2, 300), 'Proof'));
    if (!proof.length) throw new BadRequest('Attach the proof: the pay sheet the person signed or thumb-printed, or a photo of it.');
    const idCheck = typeof input.idLast4 === 'string' ? input.idLast4.trim().toUpperCase() : '';
    if (idCheck !== p.idLast4) throw new BadRequest(`Check ${p.name}'s IC or passport: the last 4 characters do not match the list.`);
    const x = { id: `pay${l.payouts.length + 1}`, personId: p.id, day, amount, proof, sign: ctx.sign() };
    return out(
      { ...l, payouts: [...l.payouts, x], log: [...l.log, logOf(`Paid ${p.name} ${rm(amount)} for ${day}`)] },
      'pay',
      `Daily cash ${l.id}: ${p.name} paid ${rm(amount)} for ${day}.`,
    );
  }
  if (action === 'giveBack') {
    // The COO or CEO returns what was not paid, at the end of the week or month (or earlier).
    collector(ctx);
    if (l.status !== 'with_collector') throw new BadRequest('That list has no cash with the COO or CEO.');
    if (!l.handovers.some((h) => h.toId === ctx.user.id)) throw new AccessDenied('view', '(only the person the cash was handed to gives it back)');
    if (l.handovers.some((h) => h.toId === ctx.user.id && !h.received)) throw new BadRequest('Confirm every cash handover to you first.');
    if (finDailyCashGaveBack(l, ctx.user.id)) throw new BadRequest('You have already given back your cash on this list.');
    // Split custody (Arisha main, 3 Nov 2026): each holder gives back only their own cash, on their own; the list is returned to
    // Finance for one settlement once every holder has given back.
    const amount = money(input.amount, 'Cash given back', true);
    const held = finDailyCashHeldBy(l, ctx.user.id);
    const c =
      Math.abs(amount - held) >= 0.005
        ? requireReason(input.comment, `give back ${rm(amount)} when Prima shows ${rm(held)} unpaid with you`)
        : String(input.comment ?? '')
            .trim()
            .slice(0, 300);
    const giveBacks = [...(l.giveBacks ?? []), { ...ctx.sign(c), amount }];
    const holders = [...new Set(l.handovers.map((h) => h.toId))];
    const waiting = holders.filter((id) => !giveBacks.some((g) => g.byId === id));
    const total = round2(giveBacks.reduce((n, g) => n + g.amount, 0));
    const done = !waiting.length;
    return out(
      {
        ...l,
        status: done ? 'returned' : l.status,
        giveBacks,
        giveBack: done ? { ...ctx.sign(c), amount: total } : null,
        log: [
          ...l.log,
          logOf(
            `${ctx.user.name} gave back ${rm(amount)} unpaid cash${c ? `: ${c}` : ''}${done ? (giveBacks.length > 1 ? `; all holders have given back, ${rm(total)} in all` : '') : `; waiting for ${waiting.map((id) => l.handovers.find((h) => h.toId === id)!.toName).join(', ')}`}`,
          ),
        ],
      },
      'giveBack',
      `Daily cash ${l.id}: ${rm(amount)} unpaid cash given back to Finance by ${ctx.user.name}${done ? '' : ' (another holder still to give back)'}.`,
    );
  }
  if (action === 'settle') {
    // Finance (not the collector) counts the cash given back and banks it.
    finance(ctx);
    if (l.status !== 'returned' || !l.giveBack) throw new BadRequest('That list is not waiting to be settled.');
    if (ctx.collector || l.giveBack.byId === ctx.user.id || l.handovers.some((h) => h.toId === ctx.user.id))
      throw new AccessDenied('view', '(someone other than the COO or CEO who held the cash counts it)');
    notApprover(ctx, l);
    if (l.withdrawals.some((w) => w.sign.byId === ctx.user.id) || l.handovers.some((h) => h.sign.byId === ctx.user.id))
      throw new AccessDenied('view', '(whoever withdrew or handed over the cash does not count it back; someone else in Finance does)');
    if (Math.abs(finDailyCashHanded(l) - finDailyCashWithdrawn(l)) >= 0.005)
      throw new BadRequest('Hand over or bank all the withdrawn cash first; the list is settled on everything withdrawn.');
    const counted = money(input.counted, 'Cash counted', true);
    const depositRef = counted > 0 ? noSecrets(text(input.depositRef, 'Bank deposit reference', 2, 60), 'Deposit reference') : '-';
    const difference = round2(finDailyCashWithdrawn(l) - finDailyCashPaid(l) - counted);
    const c =
      Math.abs(difference) >= 0.005
        ? requireReason(input.comment, `settle with ${rm(difference)} not accounted for`)
        : String(input.comment ?? '')
            .trim()
            .slice(0, 300);
    const n: FinDailyCashList = {
      ...l,
      status: Math.abs(difference) >= 0.005 ? 'returned' : 'settled',
      settled: { ...ctx.sign(c), counted, depositRef, difference },
      log: [
        ...l.log,
        logOf(
          `Counted ${rm(counted)} given back, banked ${depositRef}; paid ${rm(finDailyCashPaid(l))} of ${rm(finDailyCashWithdrawn(l))} withdrawn${difference ? `, difference ${rm(difference)}: ${c}` : ''}`,
        ),
      ],
    };
    return out(
      n,
      'settle',
      `Daily cash ${l.id} settled: paid ${rm(finDailyCashPaid(l))}, given back ${rm(counted)}${difference ? `, difference ${rm(difference)} for the FD` : ''}.`,
    );
  }
  if (action === 'acceptDifference') {
    const a = finance(ctx);
    if (a.kind !== 'director') throw new AccessDenied('view', '(only the Finance Director accepts a daily cash difference)');
    if (!l.settled || Math.abs(l.settled.difference) < 0.005 || l.differenceAccepted) throw new BadRequest('That list has no difference to accept.');
    if (l.settled.byId === ctx.user.id) throw new AccessDenied('view', '(nobody accepts their own count)');
    const c = requireComment(input.comment, 'accept the difference');
    return out(
      { ...l, status: 'settled', differenceAccepted: ctx.sign(c), log: [...l.log, logOf(`FD accepted the ${rm(l.settled.difference)} difference: ${c}`)] },
      'accept',
      `Daily cash ${l.id}: FD accepted the ${rm(l.settled.difference)} difference: ${c}`,
    );
  }
  throw new BadRequest('Unknown daily cash action.');
}

/** What is outstanding on a list, for home and the close. */
export function finDailyCashState(l: FinDailyCashList, today: IsoDate) {
  const settleBy = addDays(l.to, R().settleDays);
  const unbanked = l.withdrawals.filter((w) => !w.statement && daysBetween(w.on, today) > R().statementDays).length;
  return {
    settleBy,
    lateSettle: ['with_collector', 'returned'].includes(l.status) && today > settleBy,
    unbanked,
    unconfirmed: l.handovers.filter((h) => !h.received).length,
    differenceOpen: !!l.settled && Math.abs(l.settled.difference) >= 0.005 && !l.differenceAccepted,
  };
}

/** Close exceptions for the month: lists not settled in time, withdrawals not on the statement, differences not accepted. */
export function finDailyCashExceptions(f: FinStatus, period: string, today: IsoDate) {
  const out: { key: string; text: string }[] = [];
  for (const l of f.dailyCash ?? []) {
    if (l.status === 'cancelled' || l.from.slice(0, 7) > period) continue;
    const s = finDailyCashState(l, today);
    const ended = l.to.slice(0, 7) <= period;
    if (ended && ['approved', 'with_collector', 'returned'].includes(l.status) && l.withdrawals.length)
      out.push({ key: `dcash:${l.id}:open`, text: `Daily cash ${l.id} (${l.from} to ${l.to}): cash not settled${s.lateSettle ? ` (due ${s.settleBy})` : ''}` });
    for (const w of l.withdrawals)
      if (!w.statement && w.on.slice(0, 7) <= period)
        out.push({ key: `dcash:${l.id}:${w.id}`, text: `Daily cash ${l.id}: withdrawal ${w.ref} ${rm(w.amount)} not found on the bank statement` });
    if (s.differenceOpen)
      out.push({ key: `dcash:${l.id}:diff`, text: `Daily cash ${l.id}: ${rm(l.settled!.difference)} not accounted for, waiting for the FD` });
  }
  return out;
}

/** Counts for Finance home. */
export function finDailyCashHome(f: FinStatus, user: User, a: FinActor, today: IsoDate) {
  const lists = (f.dailyCash ?? []).filter((l) => l.status !== 'cancelled');
  return {
    toApprove:
      a.kind === 'director' ? lists.filter((l) => l.status === 'to_approve' && l.prepared.byId !== user.id && l.submitted?.byId !== user.id).length : 0,
    toPrepare: lists.filter((l) => l.status === 'approved' && finDailyCashWithdrawn(l) < l.total - 0.005).length,
    toSettle: lists.filter((l) => l.status === 'returned' && !l.settled).length,
    lateSettle: lists.filter((l) => finDailyCashState(l, today).lateSettle).length,
    differences: a.kind === 'director' ? lists.filter((l) => finDailyCashState(l, today).differenceOpen).length : 0,
  };
}

/** The collector's own view: cash handed to them, people to pay, and what to give back. */
export function finDailyCashCollectorView(f: FinStatus, user: User, today: IsoDate) {
  return (f.dailyCash ?? [])
    .filter((l) => l.handovers.some((h) => h.toId === user.id) && (l.status === 'with_collector' || daysBetween(l.to, today) <= 31))
    .map((l) => ({
      ...l,
      held: finDailyCashHeldBy(l, user.id),
      paid: finDailyCashPaid(l),
      toConfirm: l.handovers.filter((h) => h.toId === user.id && !h.received).map((h) => h.id),
      dueToday:
        l.status === 'with_collector'
          ? l.people.filter((p) => p.days.includes(today) && !l.payouts.some((x) => x.personId === p.id && x.day === today)).map((p) => p.id)
          : [],
      giveBackDue: l.status === 'with_collector' && today >= l.to && !finDailyCashGaveBack(l, user.id),
      gaveBack: finDailyCashGaveBack(l, user.id),
    }));
}

/** Finance's view of the lists. */
export function finDailyCashView(f: FinStatus, today: IsoDate) {
  return [...(f.dailyCash ?? [])]
    .sort(
      (a, b) =>
        Number(b.status !== 'settled' && b.status !== 'cancelled') - Number(a.status !== 'settled' && a.status !== 'cancelled') || b.from.localeCompare(a.from),
    )
    .slice(0, 40)
    .map((l) => ({
      ...l,
      withdrawn: finDailyCashWithdrawn(l),
      handed: finDailyCashHanded(l),
      paid: finDailyCashPaid(l),
      held: finDailyCashHeld(l),
      state: finDailyCashState(l, today),
    }));
}
