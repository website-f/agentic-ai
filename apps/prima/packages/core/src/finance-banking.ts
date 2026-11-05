// Fixed deposits and bank charges (Fauzan, 2 Nov 2026: yes to suggestions 15 and 16).
//
// 15. Each fixed deposit is listed with its bank, amount, rate and maturity, checked by a second person (money), and
//     Prima warns before it matures so someone decides to renew or uplift it. Prima finds the placement leaving the
//     current account and the uplift (principal and interest) coming back on the bank statement. "Where the money sits"
//     is the last statement balance of each account plus the deposits placed.
// 16. Each month Prima adds up the bank's charges and fees on every statement. The team leader (or the FD/CEO) records
//     what the bank agreed per account; a month above it needs a reviewer's explanation (refund asked, or why it is right).

import { AccessDenied } from './access';
import { isoDate, noSecrets, requireReason, text } from './finance';
import type { FinCashCtx } from './finance-cash';
import { RULES } from './rules';
import { BadRequest, NotFound } from './service';
import { addDays, daysBetween } from './time';
import type { FinSign, FinStatement, FinStatus, Id, IsoDate } from './types';

export interface FinFixedDeposit {
  id: Id;
  companyId: Id;
  bank: string;
  /** The certificate or account number, last digits only. */
  refMasked: string;
  /** The current account it was placed from and is paid back into. */
  bankId: Id;
  amount: number;
  /** Interest rate a year, %. */
  rate: number;
  placedOn: IsoDate;
  maturesOn: IsoDate;
  status: 'pending' | 'placed' | 'uplifted' | 'closed';
  added: FinSign & { doc: string };
  checked: FinSign | null;
  /** Each renewal: the old maturity, the new one and its rate. */
  renewals: (FinSign & { from: IsoDate; to: IsoDate; rate: number; amount: number })[];
  /** Placement seen leaving the current account. */
  placedSeen: { statementId: Id; lineId: Id; date: IsoDate } | null;
  /** Uplift asked of the bank (on maturity or early, with a reason). */
  uplift: (FinSign & { on: IsoDate }) | null;
  /** Principal and interest seen coming back. */
  upliftSeen: { statementId: Id; lineId: Id; date: IsoDate; amount: number } | null;
}

export interface FinChargeTerms {
  bankId: Id;
  /** What the bank agreed: the most its charges and fees should come to in a month, RM. */
  monthlyMax: number;
  note: string;
  set: FinSign;
}

export interface FinChargeReview {
  bankId: Id;
  period: string;
  charges: number;
  explained: FinSign;
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

const money = (v: unknown, what: string, zero = false): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || (!zero && n === 0) || n > 1_000_000_000) throw new BadRequest(`${what}: give an amount in RM.`);
  return Math.round(n * 100) / 100;
};

/** Interest to maturity at a simple yearly rate, as Malaysian banks quote fixed deposits (actual days / 365). */
export function finFdInterest(amount: number, rate: number, from: IsoDate, to: IsoDate): number {
  return Math.round(((amount * rate) / 100) * (daysBetween(from, to) / 365) * 100) / 100;
}

export function finFdAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff keep fixed deposits)');
  const list = f.fixedDeposits ?? [];
  const save = (d: FinFixedDeposit) => ({ fixedDeposits: list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d] });
  if (action === 'add') {
    if (!f.banks.some((b) => b.id === input.bankId)) throw new BadRequest('Choose the current account it was placed from.');
    const placedOn = isoDate(input.placedOn, 'Placed on');
    const maturesOn = isoDate(input.maturesOn, 'Matures on');
    if (maturesOn <= placedOn) throw new BadRequest('The maturity is not after the placement.');
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 20) throw new BadRequest('Rate: the yearly interest rate in %, e.g. 2.65.');
    const refMasked = noSecrets(text(input.refMasked, 'Certificate or account, last 4 digits', 4, 12), 'Reference');
    if (/\d{6,}/.test(refMasked)) throw new BadRequest('Only the last 4 digits, never the full number.');
    const d: FinFixedDeposit = {
      id: `fd-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`,
      companyId: f.companyId,
      bank: noSecrets(text(input.bank, 'Bank', 2, 60), 'Bank'),
      refMasked,
      bankId: input.bankId as Id,
      amount: money(input.amount, 'Amount placed'),
      rate: Math.round(rate * 100) / 100,
      placedOn,
      maturesOn,
      status: 'pending',
      added: { ...ctx.sign(), doc: noSecrets(text(input.doc, 'The placement confirmation (file name)', 3, 200), 'Document') },
      checked: null,
      renewals: [],
      placedSeen: null,
      uplift: null,
      upliftSeen: null,
    };
    return {
      patch: save(d),
      action: 'finance.fd.added',
      summary: `Fixed deposit ${d.bank} ${refMasked} RM${d.amount.toFixed(2)} at ${d.rate}% to ${maturesOn}; waiting for a second person to check.`,
      result: d,
    };
  }
  const d = list.find((x) => x.id === input.fdId);
  if (!d) throw new NotFound('Fixed deposit');
  if (action === 'check') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks it)');
    if (d.status !== 'pending') throw new BadRequest('Nothing to check.');
    if (d.added.byId === ctx.user.id) throw new AccessDenied('view', '(nobody checks what they entered)');
    const next: FinFixedDeposit = { ...d, status: 'placed', checked: ctx.sign(text(input.comment, 'What you checked it against', 5, 300)) };
    return { patch: save(next), action: 'finance.fd.checked', summary: `Fixed deposit ${d.bank} ${d.refMasked} checked.`, result: next };
  }
  if (d.status === 'pending') throw new BadRequest('A second person checks it first.');
  if (action === 'renew') {
    if (d.status !== 'placed') throw new BadRequest('Only a placed deposit is renewed.');
    if (daysBetween(ctx.today, d.maturesOn) > RULES.financeBanking.value.maturityAlertDays)
      throw new BadRequest(`Renew within ${RULES.financeBanking.value.maturityAlertDays} days of maturity.`);
    const to = isoDate(input.to, 'New maturity');
    if (to <= d.maturesOn) throw new BadRequest('The new maturity is not later.');
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 20) throw new BadRequest('Rate: the new yearly interest rate in %.');
    // Interest is usually added to the principal on renewal; the new amount is what the bank's renewal advice says.
    const amount = money(input.amount ?? d.amount, 'Amount renewed');
    const next: FinFixedDeposit = {
      ...d,
      amount,
      rate,
      maturesOn: to,
      renewals: [...d.renewals, { ...ctx.sign(text(input.doc, 'Renewal advice (file name)', 3, 200)), from: d.maturesOn, to, rate, amount }],
    };
    return {
      patch: save(next),
      action: 'finance.fd.renewed',
      summary: `Fixed deposit ${d.bank} ${d.refMasked} renewed to ${to} at ${rate}% (RM${amount.toFixed(2)}).`,
      result: next,
    };
  }
  if (action === 'uplift') {
    if (d.status !== 'placed') throw new BadRequest('Only a placed deposit is uplifted.');
    const early = ctx.today < d.maturesOn;
    const why = early ? requireReason(input.comment, 'uplift it before maturity (interest may be lost)') : '';
    const next: FinFixedDeposit = { ...d, status: 'uplifted', uplift: { ...ctx.sign(why), on: ctx.today } };
    return {
      patch: save(next),
      action: 'finance.fd.uplifted',
      summary: `Fixed deposit ${d.bank} ${d.refMasked}: uplift asked${early ? ` early: ${why}` : ''}. Prima looks for the money on the bank statement.`,
      result: next,
    };
  }
  if (action === 'close') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO closes it)');
    if (d.status !== 'uplifted') throw new BadRequest('Uplift it first.');
    const why = d.upliftSeen ? '' : requireReason(input.comment, 'close it without the money seen on the statement');
    const next: FinFixedDeposit = { ...d, status: 'closed' };
    return { patch: save(next), action: 'finance.fd.closed', summary: `Fixed deposit ${d.bank} ${d.refMasked} closed${why ? `: ${why}` : ''}.`, result: next };
  }
  throw new BadRequest('Unknown action.');
}

/** The placement leaving the current account, and the uplift coming back, found on the statements. */
export function finMatchFds(statements: FinStatement[], fds: FinFixedDeposit[], at: string) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  let found = 0;
  const near = (a: IsoDate, b: IsoDate, days: number) => Math.abs(daysBetween(a, b)) <= days;
  const take = (bankId: Id, ok: (l: FinStatement['lines'][number]) => boolean) => {
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts) if (st.bankId === bankId) st.lines.forEach((l, i) => !l.match && ok(l) && cands.push({ st, i }));
    return cands.length === 1 ? cands[0] : null;
  };
  const next = fds.map((d) => {
    let out = d;
    if (!d.placedSeen && d.status !== 'pending') {
      const p = take(d.bankId, (l) => l.amount < 0 && Math.abs(-l.amount - d.amount) < 0.005 && near(l.date, d.placedOn, 3));
      if (p) {
        const line = p.st.lines[p.i];
        p.st.lines[p.i] = { ...line, match: { kind: 'fd', fdId: d.id, by: 'Prima', at } };
        out = { ...out, placedSeen: { statementId: p.st.id, lineId: line.id, date: line.date } };
        found += 1;
      }
    }
    if (!d.upliftSeen && d.status === 'uplifted') {
      const from = d.uplift!.on < d.maturesOn ? d.uplift!.on : d.maturesOn;
      const most = d.amount + finFdInterest(d.amount, d.rate, d.renewals.length ? d.renewals[d.renewals.length - 1].from : d.placedOn, d.maturesOn) + 0.005;
      // At least the principal (less if broken early is not expected); at most principal plus full interest.
      const p = take(d.bankId, (l) => l.amount >= d.amount - 0.005 && l.amount <= most && l.date >= addDays(from, -3) && l.date <= addDays(from, 30));
      if (p) {
        const line = p.st.lines[p.i];
        p.st.lines[p.i] = { ...line, match: { kind: 'fd', fdId: d.id, by: 'Prima', at } };
        out = { ...out, upliftSeen: { statementId: p.st.id, lineId: line.id, date: line.date, amount: line.amount } };
        found += 1;
      }
    }
    return out;
  });
  return { statements: sts, fds: next, found };
}

export function finUnmatchFds(fds: FinFixedDeposit[], hit: (m: { statementId: Id; lineId: Id }) => boolean): FinFixedDeposit[] {
  return fds.map((d) => ({
    ...d,
    placedSeen: d.placedSeen && hit(d.placedSeen) ? null : d.placedSeen,
    upliftSeen: d.upliftSeen && hit(d.upliftSeen) ? null : d.upliftSeen,
  }));
}

/** Is this statement line a bank charge or fee (not interest earned)? */
export function finIsCharge(l: { description: string; ref: string; amount: number }): boolean {
  if (l.amount >= 0) return false;
  const t = `${l.description} ${l.ref}`.toUpperCase();
  return RULES.financeBanking.value.chargeWords.some((w) => t.includes(w));
}

/** Each account's charges for a month, against what the bank agreed. */
export function finCharges(f: FinStatus, period: string) {
  return f.banks.map((b) => {
    const st = (f.statements ?? []).find((x) => x.bankId === b.id && x.period === period) ?? null;
    const charges = st ? Math.round(st.lines.filter(finIsCharge).reduce((n, l) => n - l.amount, 0) * 100) / 100 : null;
    const terms = (f.chargeTerms ?? []).find((t) => t.bankId === b.id) ?? null;
    const review = (f.chargeReviews ?? []).find((r) => r.bankId === b.id && r.period === period) ?? null;
    const over = charges != null && terms != null && charges > terms.monthlyMax + 0.005;
    return {
      bankId: b.id,
      bank: `${b.bank} ${b.accountMasked}`,
      period,
      charges,
      lines: st ? st.lines.filter(finIsCharge).map((l) => ({ date: l.date, description: l.description, amount: -l.amount })) : [],
      terms,
      over,
      review,
      toExplain: over && !review,
    };
  });
}

export function finChargeAction(ctx: FinCashCtx, f: FinStatus, openPeriod: string, action: string, input: Record<string, unknown>): Out<unknown> {
  const b = f.banks.find((x) => x.id === input.bankId);
  if (!b) throw new BadRequest("Choose one of the company's bank accounts.");
  if (action === 'terms') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO records what the bank agreed)');
    const t: FinChargeTerms = {
      bankId: b.id,
      monthlyMax: money(input.monthlyMax, 'Most the charges should come to in a month', true),
      note: noSecrets(text(input.note, "The bank's tariff or letter it is from", 3, 300), 'Note'),
      set: ctx.sign(),
    };
    return {
      patch: { chargeTerms: [...(f.chargeTerms ?? []).filter((x) => x.bankId !== b.id), t] },
      action: 'finance.charges.terms',
      summary: `${b.bank} ${b.accountMasked}: charges agreed up to RM${t.monthlyMax.toFixed(2)} a month (${t.note}).`,
      result: t,
    };
  }
  if (action === 'explain') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO explains it)');
    const period = typeof input.period === 'string' && /^\d{4}-\d{2}$/.test(input.period) ? input.period : openPeriod;
    const row = finCharges(f, period).find((x) => x.bankId === b.id)!;
    if (!row.over) throw new BadRequest('The charges are within what the bank agreed; nothing to explain.');
    if (row.review) throw new BadRequest('Already explained.');
    const r: FinChargeReview = {
      bankId: b.id,
      period,
      charges: row.charges!,
      explained: ctx.sign(requireReason(input.comment, 'explain the charges (refund asked, or why they are right)')),
    };
    return {
      patch: { chargeReviews: [...(f.chargeReviews ?? []), r] },
      action: 'finance.charges.explained',
      summary: `${b.bank} ${b.accountMasked} ${period}: charges RM${r.charges.toFixed(2)} above RM${row.terms!.monthlyMax.toFixed(2)} explained: ${r.explained.comment}`,
      result: r,
    };
  }
  throw new BadRequest('Unknown action.');
}

/** Where the money sits: each account's last statement balance, and the deposits placed. */
export function finBankingView(f: FinStatus, period: string, today: IsoDate) {
  const alert = RULES.financeBanking.value.maturityAlertDays;
  const fds = (f.fixedDeposits ?? []).map((d) => ({
    ...d,
    interest: finFdInterest(d.amount, d.rate, d.renewals.length ? d.renewals[d.renewals.length - 1].from : d.placedOn, d.maturesOn),
    decide: d.status === 'placed' && daysBetween(today, d.maturesOn) <= alert,
    matured: d.status === 'placed' && d.maturesOn < today,
  }));
  const accounts = f.banks.map((b) => {
    const last = (f.statements ?? []).filter((x) => x.bankId === b.id).sort((x, y) => y.period.localeCompare(x.period))[0] ?? null;
    return { bankId: b.id, bank: `${b.bank} ${b.accountMasked}`, balance: last?.closing ?? null, asAt: last?.period ?? null };
  });
  const placed = fds.filter((d) => d.status === 'placed' || d.status === 'pending').reduce((n, d) => n + d.amount, 0);
  return {
    fds,
    accounts,
    placed: Math.round(placed * 100) / 100,
    current: Math.round(accounts.reduce((n, a) => n + (a.balance ?? 0), 0) * 100) / 100,
    charges: finCharges(f, period),
    period,
  };
}

export function finBankingHome(f: FinStatus, period: string, today: IsoDate, userId: Id, reviewer: boolean) {
  const v = finBankingView(f, period, today);
  return {
    fdDecide: v.fds.filter((d) => d.decide && !d.matured).length,
    fdMatured: v.fds.filter((d) => d.matured).length,
    fdToCheck: reviewer ? v.fds.filter((d) => d.status === 'pending' && d.added.byId !== userId).length : 0,
    chargesOver: reviewer ? v.charges.filter((c) => c.toExplain).length : 0,
  };
}
