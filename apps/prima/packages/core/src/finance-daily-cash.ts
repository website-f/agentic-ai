import { AccessDenied } from "./access";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinActor } from "./finance";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { User } from "./types";



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
  /** Missing on lists made before 6 Nov 2026: such a person cannot be approved until Finance sets how they are paid. */
  pay?: FinDailyPayMethod;
  account?: FinDailyPayAccount | null;
  cash?: FinDailyCashListing | null;
}

/** Special cash-buffer ledger: never a source of amounts for man-hours or staff/guard payslips
 * (Fauzan, 7 Nov 2026). Keep FD approval, CEO/COO custody, receipts, reconciliation and audit here.
 * This reporting separation neither changes earned wages/hours nor establishes tax/statutory treatment. */
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
  /** Each day paid: in cash by the COO or CEO (method missing or 'cash'), or by transfer recorded by Finance with its reference. */
  payouts: {
    id: Id;
    personId: Id;
    day: IsoDate;
    amount: number;
    proof: string[];
    sign: FinSign;
    method?: FinDailyPayMethod;
    ref?: string;
    /** The signed receipt for a cash payment, uploaded by the Director Office (a file in evidenceDocs). */
    receipt?: (FinSign & { docId: Id; name: string; sha256: string }) | null;
  }[];
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
  /** The Director Office, who lists people for cash (Fauzan, 6 Nov 2026). */
  directorOffice?: boolean;
  /** The COO, the only one who approves a stamped consent letter (Fauzan, 6 Nov 2026). */
  consentApprover?: boolean;
  /** 'coo' or 'ceo' for a collector, for the record of a cash decision. */
  tier?: 'coo' | 'ceo' | null;
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
/** Cash paid out by the COO or CEO (transfers are separate: they never touch the cash withdrawn). */
export const finDailyCashPaid = (l: FinDailyCashList) => round2(l.payouts.filter(isCashPayout).reduce((n, p) => n + p.amount, 0));
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
          l.payouts.filter((x) => isCashPayout(x) && x.sign.byId === userId).reduce((n, x) => n + x.amount, 0),
      );

function readPeople(v: unknown, from: IsoDate, to: IsoDate, today: IsoDate, sign: () => FinSign): FinDailyCashPerson[] {
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
    const { pay, account } = readPay(p, name, today, sign);
    if (pay === 'cash' && dailyRate > R().maxDailyRate)
      throw new BadRequest(`${name}: the daily rate is above ${rm(R().maxDailyRate)}, the most paid in cash; pay by bank or e-wallet instead.`);
    const all = datesBetween(from, to);
    const days = Array.isArray(p.days)
      ? [...new Set(p.days.map((d, k) => isoDate(d, `${name}: day ${k + 1}`)))].sort()
      : typeof p.dayCount === 'number'
        ? all.slice(0, Math.max(0, Math.floor(p.dayCount)))
        : all;
    if (!days.length) throw new BadRequest(`${name}: give the days to be paid.`);
    if (days.some((d) => d < from || d > to)) throw new BadRequest(`${name}: every day is between ${from} and ${to}.`);
    return { id: `p${n}`, name, idLast4, work, dailyRate, days, amount: round2(dailyRate * days.length), pay, account, cash: null };
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
    const people = readPeople(input.people, from, to, ctx.today, () => ctx.sign());
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

  // ----- How each person is paid (Fauzan, 6 Nov 2026) -----
  const personOf = () => {
    const p = l.people.find((x) => x.id === input.personId);
    if (!p) throw new BadRequest('Choose a person on this list.');
    return p;
  };
  const savePerson = (p: FinDailyCashPerson, act: string, summary: string, logText: string) =>
    out({ ...l, people: l.people.map((x) => (x.id === p.id ? p : x)), log: [...l.log, logOf(logText)] }, act, summary);
  const beforeApproval = () => {
    if (l.status !== 'draft' && l.status !== 'to_approve') throw new BadRequest('This is decided before the Finance Director approves the list.');
  };
  if (action === 'listCash' || action === 'unlistCash') {
    // The Director Office lists a person for cash with the reason ("The list will be collected and submited by director office staff").
    if (!ctx.directorOffice) throw new AccessDenied('view', '(only the Director Office lists people for cash)');
    beforeApproval();
    const p = personOf();
    if (p.pay !== 'cash') throw new BadRequest(`${p.name} is paid by ${p.pay === 'ewallet' ? 'e-wallet' : 'bank'}; Finance asks for cash first.`);
    if (action === 'unlistCash') {
      if (!p.cash || p.cash.decision) throw new BadRequest('Only a listing not yet decided by the COO or the CEO is taken off.');
      return savePerson({ ...p, cash: null }, 'unlistCash', `Daily cash ${l.id}: ${p.name} taken off the cash list.`, `${p.name} taken off the cash list by the Director Office`);
    }
    if (p.cash && (!p.cash.decision || p.cash.decision.give)) throw new BadRequest(`${p.name} is already listed for cash.`);
    const reason = noSecrets(text(input.reason, 'Why this person needs cash', 5, 300), 'Reason');
    // "Director list will send cash person list per site per name and the amount."
    const site = noSecrets(text(input.site, 'The site', 2, 120), 'Site');
    const amount = money(input.amount, 'Cash amount');
    if (amount > p.amount + 0.005) throw new BadRequest(`${p.name}'s approved pay on this list is ${rm(p.amount)}; the cash cannot be more.`);
    return savePerson(
      { ...p, cash: { reason, site, amount, listed: ctx.sign(reason), decision: null } },
      'listCash',
      `Daily cash ${l.id}: ${p.name} (${site}) listed for ${rm(amount)} cash by the Director Office: ${reason}`,
      `${p.name} (${site}) listed for ${rm(amount)} cash by the Director Office: ${reason}`,
    );
  }
  if (action === 'decideCash') {
    // "Only coo and ceo can give the cash if there is a need for it."
    collector(ctx);
    beforeApproval();
    const p = personOf();
    if (p.pay !== 'cash' || !p.cash || p.cash.decision) throw new BadRequest(`${p.name} is not waiting for a cash decision.`);
    if (p.cash.listed.byId === ctx.user.id) throw new AccessDenied('view', '(whoever listed the person does not decide the cash)');
    const note = requireComment(input.comment, 'decide');
    const give = input.give === true;
    const tier = ctx.tier ?? 'ceo';
    return savePerson(
      { ...p, cash: { ...p.cash, decision: { ...ctx.sign(note), give, tier } } },
      'decideCash',
      `Daily cash ${l.id}: cash for ${p.name} ${give ? 'given' : 'refused'} by the ${tier.toUpperCase()}: ${note}`,
      `Cash for ${p.name} ${give ? 'given' : 'refused'} by the ${tier.toUpperCase()}: ${note}`,
    );
  }
  if (action === 'approveConsent') {
    // "Consent letter must be approve by coo. The letter must have notory stamp by pesuruhjaya sumpah."
    if (!ctx.consentApprover) throw new AccessDenied('view', '(only the COO approves a consent letter)');
    beforeApproval();
    const p = personOf();
    const c = p.account?.consent;
    if (!p.account || !c) throw new BadRequest(`No consent letter is recorded for ${p.name}.`);
    if (c.approved) throw new BadRequest('That consent letter is already approved.');
    if (c.recorded.byId === ctx.user.id) throw new AccessDenied('view', '(whoever recorded the letter does not approve it)');
    const note = requireComment(input.comment, 'approve the consent letter');
    return savePerson(
      { ...p, account: { ...p.account, consent: { ...c, approved: ctx.sign(note) } } },
      'approveConsent',
      `Daily cash ${l.id}: consent letter ${c.docRef} for ${p.name} (Commissioner for Oaths ${c.oaths.commissioner}) approved: ${note}`,
      `Consent letter ${c.docRef} for ${p.name}'s pay into ${p.account.holderName}'s account approved: ${note}`,
    );
  }
  if (action === 'receipt') {
    // "Signed paper of the receive collected and upload as proof. Upload done by director office."
    if (!ctx.directorOffice) throw new AccessDenied('view', '(only the Director Office uploads the signed receipts)');
    const x = l.payouts.find((y) => y.id === input.payoutId);
    if (!x || !isCashPayout(x)) throw new NotFound('Cash payment');
    if (x.receipt) throw new BadRequest('That payment already has its signed receipt.');
    const doc = input.doc as { id: Id; name: string; sha256: string } | undefined;
    if (!doc?.id || !doc.sha256) throw new BadRequest('Attach the signed receipt (PDF, JPEG or PNG).');
    const p = l.people.find((y) => y.id === x.personId)!;
    const receipt = { ...ctx.sign(), docId: doc.id, name: doc.name, sha256: doc.sha256 };
    return out(
      { ...l, payouts: l.payouts.map((y) => (y.id === x.id ? { ...y, receipt } : y)), log: [...l.log, logOf(`Signed receipt for ${p.name}, ${x.day} uploaded: ${doc.name} (SHA-256 ${doc.sha256.slice(0, 12)})`)] },
      'receipt',
      `Daily cash ${l.id}: signed receipt for ${p.name} ${x.day} ${rm(x.amount)} uploaded by the Director Office.`,
    );
  }
  if (action === 'transfer') {
    // Bank or e-wallet: Finance records each day's transfer with its reference. The FD who approved does not pay.
    finance(ctx);
    notApprover(ctx, l);
    if (!['approved', 'with_collector', 'returned'].includes(l.status)) throw new BadRequest('Transfers are made after the Finance Director approves the list.');
    const p = personOf();
    if (p.pay !== 'bank' && p.pay !== 'ewallet') throw new BadRequest(`${p.name} is paid in cash by the COO or the CEO, not by transfer.`);
    const check = finDailyCashPersonCheck(p);
    if (check.problem) throw new BadRequest(`${p.name}: ${check.problem}.`);
    const day = isoDate(input.day, 'Day worked');
    if (!p.days.includes(day)) throw new BadRequest(`${p.name} is not listed for ${day}.`);
    if (day > ctx.today) throw new BadRequest('Pay for a day once it has come.');
    if (l.payouts.some((x) => x.personId === p.id && x.day === day)) throw new BadRequest(`${p.name} is already paid for ${day}.`);
    const amount = money(input.amount ?? p.dailyRate, 'Amount transferred');
    if (amount > p.dailyRate + 0.005) throw new BadRequest(`${p.name}'s approved daily rate is ${rm(p.dailyRate)}.`);
    if (paidTo(l, p.id) + amount > p.amount + 0.005) throw new BadRequest(`${p.name}'s approved total is ${rm(p.amount)}.`);
    const ref = noSecrets(text(input.ref, 'Transfer reference', 2, 60), 'Reference');
    const x = { id: `pay${l.payouts.length + 1}`, personId: p.id, day, amount, proof: [], sign: ctx.sign(), method: p.pay, ref };
    return out(
      { ...l, payouts: [...l.payouts, x], log: [...l.log, logOf(`Paid ${p.name} ${rm(amount)} for ${day} by ${p.pay === 'ewallet' ? 'e-wallet' : 'bank'} (${ref})`)] },
      'transfer',
      `Daily cash ${l.id}: ${p.name} paid ${rm(amount)} for ${day} to ${p.account!.bank} ${p.account!.accountMasked} (${ref}).`,
    );
  }

  if (action === 'edit') {
    finance(ctx);
    if (l.status !== 'draft') throw new BadRequest('Only a list not yet sent (or returned by the FD) can be changed.');
    const people = carryOver(readPeople(input.people, l.from, l.to, ctx.today, () => ctx.sign()), l.people);
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
    // Bank or e-wallet only; cash only when listed and given; a third-party account only with the COO-approved letter.
    const blocked = l.people.map((p) => ({ p, problem: finDailyCashPersonCheck(p).problem })).filter((x) => x.problem);
    if (blocked.length)
      throw new BadRequest(
        `Not every person can be paid yet: ${blocked
          .slice(0, 5)
          .map((x) => `${x.p.name}: ${x.problem}`)
          .join('; ')}${blocked.length > 5 ? `; and ${blocked.length - 5} more` : ''}.`,
      );
    const c = requireComment(input.comment);
    return out(
      { ...l, status: 'approved', approved: ctx.sign(c), log: [...l.log, logOf(`Approved by the FD: ${c}`)] },
      'approve',
      `Daily cash list ${l.id} approved by the FD, ${rm(l.total)}: ${c}`,
    );
  }
  if (action === 'cancel') {
    finance(ctx);
    if (!['draft', 'to_approve', 'approved'].includes(l.status) || l.withdrawals.length || l.payouts.length)
      throw new BadRequest('A list is cancelled before any cash is withdrawn or anyone is paid; after that, settle or close it.');
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
    // Only the pay of people the COO or CEO gave cash to is withdrawn; everyone else is paid by transfer.
    const cashTotal = finDailyCashCashTotal(l);
    if (cashTotal < 0.005) throw new BadRequest('Nobody on this list is paid in cash: pay each person by bank or e-wallet transfer.');
    if (finDailyCashWithdrawn(l) + amount > cashTotal + 0.005)
      throw new BadRequest(`That is more than the approved cash of ${rm(cashTotal)} (already withdrawn ${rm(finDailyCashWithdrawn(l))}).`);
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
    if (!finDailyCashGiven(p)) throw new BadRequest(`${p.name} is paid by bank or e-wallet; cash only for people the COO or the CEO gave cash to.`);
    const day = isoDate(input.day, 'Day worked');
    if (!p.days.includes(day)) throw new BadRequest(`${p.name} is not listed for ${day}.`);
    if (day > ctx.today) throw new BadRequest('Pay for a day once it has come.');
    if (l.payouts.some((x) => x.personId === p.id && x.day === day)) throw new BadRequest(`${p.name} is already paid for ${day}.`);
    const amount = money(input.amount ?? p.dailyRate, 'Cash paid');
    if (amount > p.dailyRate + 0.005) throw new BadRequest(`${p.name}'s approved daily rate is ${rm(p.dailyRate)}.`);
    if (paidTo(l, p.id) + amount > finDailyCashAmountOf(p) + 0.005) throw new BadRequest(`${p.name}'s cash on this list is ${rm(finDailyCashAmountOf(p))}.`);
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
    // The signed receipt itself is uploaded by the Director Office afterwards (Fauzan, 6 Nov 2026); a sheet number is optional.
    const idCheck = typeof input.idLast4 === 'string' ? input.idLast4.trim().toUpperCase() : '';
    if (idCheck !== p.idLast4) throw new BadRequest(`Check ${p.name}'s IC or passport: the last 4 characters do not match the list.`);
    const x = { id: `pay${l.payouts.length + 1}`, personId: p.id, day, amount, proof, sign: ctx.sign(), method: 'cash' as const, receipt: null };
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
  if (action === 'settle' && !l.withdrawals.length && finDailyCashCashTotal(l) < 0.005) {
    // A list paid only by transfer is closed by Finance once it has ended: no cash to count.
    finance(ctx);
    notApprover(ctx, l);
    if (l.status !== 'approved') throw new BadRequest('That list is not waiting to be closed.');
    if (ctx.today < l.to) throw new BadRequest(`Close the list once it ends on ${l.to}.`);
    const unpaid = round2(l.total - finDailyCashTransferred(l));
    const c = unpaid >= 0.005 ? requireReason(input.comment, `close the list with ${rm(unpaid)} of the approved pay not transferred`) : String(input.comment ?? '').trim().slice(0, 300);
    return out(
      {
        ...l,
        status: 'settled',
        settled: { ...ctx.sign(c), counted: 0, depositRef: '-', difference: 0 },
        log: [...l.log, logOf(`Closed: transferred ${rm(finDailyCashTransferred(l))} of ${rm(l.total)}${c ? `: ${c}` : ''}`)],
      },
      'settle',
      `Daily cash ${l.id} closed: ${rm(finDailyCashTransferred(l))} transferred of ${rm(l.total)} approved.`,
    );
  }
  if (action === 'settle') {
    // Finance (not the collector) counts the cash given back and banks it.
    finance(ctx);
    if (l.status !== 'returned' || !l.giveBack) throw new BadRequest('That list is not waiting to be settled.');
    const missing = finDailyCashNoReceipt(l).length;
    if (missing) throw new BadRequest(`${missing} cash payment(s) have no signed receipt yet: the Director Office uploads them first.`);
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
  const live = ['approved', 'with_collector', 'returned'].includes(l.status);
  const transferPeople = l.people.filter((p) => p.pay === 'bank' || p.pay === 'ewallet');
  return {
    settleBy,
    lateSettle: (['with_collector', 'returned'].includes(l.status) || (l.status === 'approved' && !l.withdrawals.length && finDailyCashCashTotal(l) < 0.005)) && today > settleBy,
    /** People who cannot be approved yet (no usable account, cash not given, consent not approved). */
    blocked: ['draft', 'to_approve'].includes(l.status) ? l.people.filter((p) => finDailyCashPersonCheck(p).problem).length : 0,
    /** Days already come that a bank or e-wallet person is not yet paid for. */
    transfersDue: live ? transferPeople.reduce((n, p) => n + p.days.filter((d) => d <= today && !l.payouts.some((x) => x.personId === p.id && x.day === d)).length, 0) : 0,
    /** Cash payments with no signed receipt uploaded by the Director Office. */
    noReceipt: finDailyCashNoReceipt(l).length,
    /** A list paid only by transfer, ended and not closed. */
    toClose: l.status === 'approved' && !l.withdrawals.length && finDailyCashCashTotal(l) < 0.005 && today >= l.to,
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
    else if (ended && s.toClose)
      out.push({ key: `dcash:${l.id}:open`, text: `Daily cash ${l.id} (${l.from} to ${l.to}): transfers not closed${s.lateSettle ? ` (due ${s.settleBy})` : ''}` });
    for (const w of l.withdrawals)
      if (!w.statement && w.on.slice(0, 7) <= period)
        out.push({ key: `dcash:${l.id}:${w.id}`, text: `Daily cash ${l.id}: withdrawal ${w.ref} ${rm(w.amount)} not found on the bank statement` });
    if (s.noReceipt)
      out.push({ key: `dcash:${l.id}:receipt`, text: `Daily cash ${l.id}: ${s.noReceipt} cash payment(s) without the signed receipt (Director Office to upload)` });
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
    toPrepare: lists.filter((l) => l.status === 'approved' && finDailyCashWithdrawn(l) < finDailyCashCashTotal(l) - 0.005).length,
    toTransfer: lists.filter((l) => finDailyCashState(l, today).transfersDue > 0).length,
    toClose: lists.filter((l) => finDailyCashState(l, today).toClose).length,
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
          ? l.people.filter((p) => finDailyCashGiven(p) && p.days.includes(today) && !l.payouts.some((x) => x.personId === p.id && x.day === today)).map((p) => p.id)
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
      transferred: finDailyCashTransferred(l),
      cashTotal: finDailyCashCashTotal(l),
      held: finDailyCashHeld(l),
      state: finDailyCashState(l, today),
      checks: Object.fromEntries(l.people.map((p) => [p.id, finDailyCashPersonCheck(p)])) as Record<Id, { problem: string | null; flags: string[] }>,
    }));
}

/** How one person on the list is paid (Fauzan, 6 Nov 2026): bank account or e-wallet; cash only by exception. */
export type FinDailyPayMethod = 'bank' | 'ewallet' | 'cash';

/**
 * The account a person is paid into. Prima keeps only the bank or e-wallet name and the last 4 digits; the full
 * number stays with Finance and the bank portal.
 */
export interface FinDailyPayAccount {
  kind: 'bank' | 'ewallet';
  /** The bank, or the e-wallet provider. */
  bank: string;
  accountMasked: string;
  /** Whose account: the person's own, a joint account, an immediate relative's or a close friend's. */
  holder: 'own' | 'joint' | 'relative' | 'friend';
  holderName: string | null;
  relationship: string | null;
  /**
   * For a relative's or friend's account: the person's consent letter, stamped by a Commissioner for Oaths and
   * approved by the COO. Finance records it from the signed letter; the account is used only once the COO approves.
   */
  consent: {
    docRef: string;
    signedOn: IsoDate;
    oaths: { commissioner: string; stampRef: string; stampedOn: IsoDate };
    recorded: FinSign;
    approved: FinSign | null;
  } | null;
}

/** A cash exception: listed by the Director Office with the reason, then given (or refused) by the COO or the CEO. */
export interface FinDailyCashListing {
  reason: string;
  /** The site the person works at, and the cash to be paid to them on this list (at most their approved pay). */
  site?: string;
  amount?: number;
  listed: FinSign;
  decision: (FinSign & { give: boolean; tier: 'coo' | 'ceo' }) | null;
}
const isCashPayout = (x: FinDailyCashList['payouts'][number]) => (x.method ?? 'cash') === 'cash';
/** Paid by bank transfer or e-wallet, recorded by Finance. */
export const finDailyCashTransferred = (l: FinDailyCashList) => round2(l.payouts.filter((x) => !isCashPayout(x)).reduce((n, p) => n + p.amount, 0));
/** The approved pay of the people given cash: the most that may be withdrawn. */
export const finDailyCashCashTotal = (l: FinDailyCashList) => round2(l.people.filter((p) => finDailyCashGiven(p)).reduce((n, p) => n + finDailyCashAmountOf(p), 0));
/** The cash a person given cash may be paid on this list: the Director Office's amount, else their approved pay. */
export const finDailyCashAmountOf = (p: FinDailyCashPerson) => round2(Math.min(p.amount, p.cash?.amount ?? p.amount));
/** Cash payments still waiting for the signed receipt from the Director Office. */
export const finDailyCashNoReceipt = (l: FinDailyCashList) => l.payouts.filter((x) => isCashPayout(x) && !x.receipt);

/** True when this person is paid in cash: listed by the Director Office and given by the COO or CEO. */
export const finDailyCashGiven = (p: FinDailyCashPerson) => p.pay === 'cash' && !!p.cash?.decision?.give;

/**
 * Why a person cannot be paid yet (Fauzan, 6 Nov 2026), or null when they can; and what the approver should know.
 * Mirrors the guard pay run's account check (PR #120) for people who are not on the staff records.
 */
export function finDailyCashPersonCheck(p: FinDailyCashPerson): { problem: string | null; flags: string[] } {
  const flags: string[] = [];
  if (!p.pay) return { problem: 'No payment method: give a bank account or e-wallet (cash only when the Director Office lists them)', flags };
  if (p.pay === 'cash') {
    if (!p.cash) return { problem: 'Cash asked for: waiting for the Director Office to list them with the reason', flags };
    if (!p.cash.decision) return { problem: 'Listed for cash by the Director Office: waiting for the COO or the CEO', flags };
    if (!p.cash.decision.give) return { problem: `Cash refused by ${p.cash.decision.by}: give a bank account or e-wallet`, flags };
    flags.push(
      `Paid in cash${p.cash.amount != null ? ` up to RM${p.cash.amount.toFixed(2)}` : ''}${p.cash.site ? ` at ${p.cash.site}` : ''}: listed by ${p.cash.listed.by} (${p.cash.reason}), given by ${p.cash.decision.by}`,
    );
    return { problem: null, flags };
  }
  const acc = p.account;
  if (!acc) return { problem: 'No bank account or e-wallet given', flags };
  if (acc.kind === 'ewallet') flags.push(`Paid to an e-wallet (${acc.bank}): EA s.25 names a bank account; legal point for the CEO`);
  if (acc.holder === 'relative' || acc.holder === 'friend') {
    const who = `${acc.holderName || 'someone else'}${acc.relationship ? `, ${acc.relationship}` : ''}`;
    if (!acc.consent) return { problem: `Paid into ${who}'s account with no written consent on file`, flags };
    if (!acc.consent.oaths.commissioner || !acc.consent.oaths.stampRef)
      return { problem: `Consent letter for ${who}'s account has no Commissioner for Oaths stamp recorded`, flags };
    if (!acc.consent.approved) return { problem: `Consent letter for ${who}'s account is waiting for the COO's approval`, flags };
    flags.push(
      `Paid into ${who}'s account: consent letter ${acc.consent.docRef}, stamped by Commissioner for Oaths ${acc.consent.oaths.commissioner}, approved by ${acc.consent.approved.by}. EA s.25 wants the worker's own or joint account; legal point for the CEO`,
    );
  }
  return { problem: null, flags };
}

const personKey = (p: { name: string; idLast4: string }) => `${p.name.toUpperCase()}|${p.idLast4}`;
const accountKey = (a: FinDailyPayAccount | null | undefined) =>
  a ? [a.kind, a.bank.toUpperCase(), a.accountMasked, a.holder, (a.holderName ?? '').toUpperCase(), a.consent?.docRef ?? '', a.consent?.oaths.stampRef ?? ''].join('|') : '';

/** Read how one person is paid. Prima keeps only the last 4 digits of the account. */
function readPay(p: Record<string, unknown>, name: string, today: IsoDate, sign: () => FinSign): { pay: FinDailyPayMethod; account: FinDailyPayAccount | null } {
  const pay = p.pay === 'bank' || p.pay === 'ewallet' || p.pay === 'cash' ? p.pay : null;
  if (!pay) throw new BadRequest(`${name}: choose how they are paid: bank account or e-wallet (cash only when the Director Office lists them).`);
  if (pay === 'cash') return { pay, account: null };
  const acc = (p.account ?? {}) as Record<string, unknown>;
  const bank = noSecrets(text(acc.bank, `${name}: ${pay === 'ewallet' ? 'e-wallet' : 'bank'}`, 2, 60), 'Bank');
  const last4 = typeof acc.last4 === 'string' ? acc.last4.trim() : '';
  if (!/^\d{4}$/.test(last4)) throw new BadRequest(`${name}: give only the last 4 digits of the ${pay === 'ewallet' ? 'e-wallet' : 'account'} number.`);
  const holder = acc.holder === 'joint' || acc.holder === 'relative' || acc.holder === 'friend' ? acc.holder : 'own';
  let holderName: string | null = null;
  let relationship: string | null = null;
  let consent: FinDailyPayAccount['consent'] = null;
  if (holder === 'relative' || holder === 'friend') {
    holderName = noSecrets(text(acc.holderName, `${name}: the account holder's name`, 2, 80), 'Holder');
    relationship = noSecrets(text(acc.relationship, `${name}: how the account holder is related`, 2, 40), 'Relationship');
    const docRef = noSecrets(text(acc.consentRef, `${name}: the signed consent letter's reference`, 2, 60), 'Consent letter');
    const signedOn = isoDate(acc.signedOn, `${name}: date the consent letter was signed`);
    // Fauzan, 6 Nov 2026: "The letter must have notory stamp by pesuruhjaya sumpah".
    const commissioner = noSecrets(text(acc.commissioner, `${name}: the Commissioner for Oaths (Pesuruhjaya Sumpah) who stamped the letter`, 2, 80), 'Commissioner');
    const stampRef = noSecrets(text(acc.stampRef, `${name}: the Commissioner for Oaths stamp number`, 2, 40), 'Stamp number');
    const stampedOn = isoDate(acc.stampedOn, `${name}: date the letter was stamped`);
    if (signedOn > today || stampedOn > today || stampedOn < signedOn)
      throw new BadRequest(`${name}: the letter is signed, then stamped by the Commissioner for Oaths, both by today.`);
    consent = { docRef, signedOn, oaths: { commissioner, stampRef, stampedOn }, recorded: sign(), approved: null };
  } else if (holder === 'joint') {
    holderName = typeof acc.holderName === 'string' && acc.holderName.trim() ? noSecrets(text(acc.holderName, 'Joint holder', 2, 80), 'Holder') : null;
  }
  return { pay, account: { kind: pay, bank, accountMasked: `****${last4}`, holder, holderName, relationship, consent } };
}

/**
 * Keep what others already decided for the same person when Finance changes the list: the Director Office's cash
 * listing and the COO's or CEO's decision (while they are still to be paid in cash), and the COO's approval of a
 * consent letter (only for the very same account and letter).
 */
function carryOver(next: FinDailyCashPerson[], prev: FinDailyCashPerson[]): FinDailyCashPerson[] {
  return next.map((p) => {
    const old = prev.find((q) => personKey(q) === personKey(p));
    if (!old) return p;
    if (p.pay === 'cash' && old.pay === 'cash' && old.cash) return { ...p, cash: old.cash };
    if (p.account?.consent && old.account?.consent?.approved && accountKey(p.account) === accountKey(old.account))
      return { ...p, account: { ...p.account, consent: { ...p.account.consent, recorded: old.account.consent.recorded, approved: old.account.consent.approved } } };
    return p;
  });
}

/**
 * What waits for the Director Office (people to list for cash), the COO or CEO (cash to give or refuse) and the COO
 * (consent letters to approve), on lists not yet approved (Fauzan, 6 Nov 2026).
 */
/** Cash payments waiting for the Director Office to upload the signed receipt (Fauzan, 6 Nov 2026). */
export function finDailyCashReceiptsDue(f: FinStatus) {
  return (f.dailyCash ?? [])
    .filter((l) => l.status !== 'cancelled')
    .flatMap((l) =>
      finDailyCashNoReceipt(l).map((x) => {
        const p = l.people.find((y) => y.id === x.personId);
        return { companyId: f.companyId, listId: l.id, payoutId: x.id, name: p?.name ?? '', idLast4: p?.idLast4 ?? '', site: p?.cash?.site ?? p?.work ?? '', day: x.day, amount: x.amount, paidBy: x.sign.by };
      }),
    );
}

export function finDailyCashDecisions(f: FinStatus, user: User, who: { directorOffice: boolean; collector: boolean; consentApprover: boolean }) {
  return (f.dailyCash ?? [])
    .filter((l) => l.status === 'draft' || l.status === 'to_approve')
    .map((l) => ({
      id: l.id,
      companyId: f.companyId,
      from: l.from,
      to: l.to,
      purpose: l.purpose,
      status: l.status,
      people: l.people
        .map((p) => {
          const need: 'list' | 'decide' | 'consent' | null =
            who.directorOffice && p.pay === 'cash' && (!p.cash || (p.cash.decision && !p.cash.decision.give))
              ? 'list'
              : who.collector && p.pay === 'cash' && p.cash && !p.cash.decision && p.cash.listed.byId !== user.id
                ? 'decide'
                : who.consentApprover && p.account?.consent && !p.account.consent.approved && p.account.consent.recorded.byId !== user.id
                  ? 'consent'
                  : null;
          return { id: p.id, name: p.name, idLast4: p.idLast4, work: p.work, dailyRate: p.dailyRate, days: p.days.length, amount: p.amount, pay: p.pay ?? null, account: p.account ?? null, cash: p.cash ?? null, need, listedByMe: !!p.cash && p.cash.listed.byId === user.id && !p.cash.decision };
        })
        .filter((p) => p.need || p.listedByMe),
    }))
    .filter((l) => l.people.length);
}