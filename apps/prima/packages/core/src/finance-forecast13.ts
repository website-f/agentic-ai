// The 13-week cash forecast per company (Fauzan, 2 Nov 2026: yes to suggestion 13, "13-week cash forecast per
// company: payroll dates, the 15th statutory payments, expected government receipts").
//
// Prima fills the forecast from what it already holds, week by week from this Monday:
//   - the opening balance: each bank's last statement closing, less payments released after it (as in "cash needed");
//   - money out: payments prepared, reviewed or approved (by their due date; overdue ones in week 1), every regular
//     payment due (instalments, bills, rent, insurance, EPF, PERKESO, PCB and HRD on the 15th, zakat), the staff payroll
//     on its usual pay day at last month's net pay, and approved daily cash lists not yet withdrawn;
//   - money in: government claims not yet paid, on their expected date (overdue ones in week 1).
// Finance adds what Prima cannot know (client collections, guard payroll from JA, a loan drawdown) as lines with a
// date and a note. Each week a reviewer looks it over and says so with a comment. A week that ends below zero is shown
// to the Finance Director and the CEO. A forecast; Prima never moves money.
import { AccessDenied } from './access';
import { finCashNeed, isoDate, noSecrets, requireComment, requireReason, text, type FinActor } from './finance';
import { finDailyCashWithdrawn } from './finance-daily-cash';
import { finRegularDues, finRegularExpected } from './finance-regular';
import { RULES } from './rules';
import { BadRequest, NotFound } from './service';
import { addDays, daysBetween } from './time';
import type { FinSign, FinStatus, Id, IsoDate, StaffPayRun, User } from './types';

const R = () => RULES.financeForecast13.value;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface FinCash13Line {
  id: Id;
  direction: 'in' | 'out';
  on: IsoDate;
  amount: number;
  label: string;
  /** Repeats every week or every month until this day (inclusive); null for once. */
  repeat: { every: 'week' | 'month'; until: IsoDate } | null;
  sign: FinSign;
  removed: FinSign | null;
}

export interface FinCash13Item {
  on: IsoDate;
  amount: number;
  label: string;
  source: 'payment' | 'regular' | 'payroll' | 'daily_cash' | 'govt' | 'manual';
  /** The amount is a guess (last month's bill or pay run). */
  estimate: boolean;
  /** The date has passed and it is still open: counted in week 1. */
  overdue: boolean;
}

/** The Monday on or before a day. */
export function finWeekStart(d: IsoDate): IsoDate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

function addMonthsDay(d: IsoDate, k: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

/** The staff payroll dates in the window: the usual pay day (from the last paid run, else the rule's day) at last month's net pay. */
function payrollItems(runs: StaffPayRun[], from: IsoDate, to: IsoDate, today: IsoDate): FinCash13Item[] {
  const sorted = [...runs].sort((a, b) => b.period.localeCompare(a.period));
  const last = sorted[0];
  if (!last) return [];
  const net = round2(last.lines.reduce((n, l) => n + l.net, 0));
  if (net <= 0) return [];
  const paid = sorted.find((r) => r.paid);
  const day = paid ? Number(paid.paid!.paidOn.slice(8, 10)) : R().payDay;
  const out: FinCash13Item[] = [];
  for (let k = -1; k <= 4; k++) {
    const on = addMonthsDay(`${from.slice(0, 7)}-${String(day).padStart(2, '0')}`, k);
    if (on > to) break;
    // The run for the month before the pay day's month (pay is for the month just worked).
    const [y, m] = on.split('-').map(Number);
    const p = new Date(Date.UTC(y, m - 2, 1));
    const period = `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`;
    const run = runs.find((r) => r.period === period);
    if (run?.paid) continue;
    if (on < from && !run) continue;
    const amount = run ? round2(run.lines.reduce((n, l) => n + l.net, 0)) : net;
    out.push({ on: on < today ? today : on, amount, label: `Staff payroll ${period} (net pay)`, source: 'payroll', estimate: !run, overdue: on < today });
  }
  return out;
}

/** Everything Prima expects in and out from today to the end of the 13th week. */
export function finCash13Items(f: FinStatus, runs: StaffPayRun[], today: IsoDate) {
  const start = finWeekStart(today);
  const end = addDays(start, 13 * 7 - 1);
  const out: FinCash13Item[] = [];
  const inn: FinCash13Item[] = [];
  const counted = new Set<Id>();
  for (const p of f.payments ?? []) {
    if (!['prepared', 'reviewed', 'approved'].includes(p.status) || p.dueOn > end) continue;
    counted.add(p.id);
    out.push({
      on: p.dueOn < today ? today : p.dueOn,
      amount: p.amount,
      label: `${p.payee}: ${p.purpose}`.slice(0, 120),
      source: 'payment',
      estimate: false,
      overdue: p.dueOn < today,
    });
  }
  for (const r of f.regular ?? []) {
    if (r.status !== 'active') continue;
    const dues = finRegularDues(r, end);
    let lastKnown: number | null = null;
    for (const d of dues) {
      const exp = finRegularExpected(r, d);
      if (exp != null) lastKnown = exp;
      const done = d.debited || (d.paymentId && ((f.payments ?? []).find((p) => p.id === d.paymentId)?.status === 'released' || counted.has(d.paymentId)));
      if (done || d.dueOn < addDays(today, -R().regularLookBackDays)) continue;
      const amount = exp ?? lastKnown;
      if (amount == null) continue;
      out.push({
        on: d.dueOn < today ? today : d.dueOn,
        amount,
        label: `${r.name} (${d.period})`,
        source: 'regular',
        estimate: exp == null,
        overdue: d.dueOn < today,
      });
    }
  }
  out.push(...payrollItems(runs, start, end, today));
  for (const l of f.dailyCash ?? []) {
    if (!['to_approve', 'approved', 'with_collector'].includes(l.status)) continue;
    const left = round2(l.total - finDailyCashWithdrawn(l));
    if (left > 0.005 && l.from <= end)
      out.push({
        on: l.from < today ? today : l.from,
        amount: left,
        label: `Daily cash ${l.from} to ${l.to}`,
        source: 'daily_cash',
        estimate: l.status === 'to_approve',
        overdue: false,
      });
  }
  for (const c of f.govtClaims ?? []) {
    if (c.status === 'paid' || c.status === 'cancelled' || c.expectedBy > end) continue;
    inn.push({
      on: c.expectedBy < today ? today : c.expectedBy,
      amount: c.amount,
      label: `${c.agency}: ${c.invoiceNo}`,
      source: 'govt',
      estimate: false,
      overdue: c.expectedBy < today,
    });
  }
  for (const m of f.cash13 ?? []) {
    if (m.removed) continue;
    const dates: IsoDate[] = [];
    let d = m.on;
    for (let i = 0; i < 60 && d <= end; i++) {
      if (d >= today || !m.repeat) dates.push(d);
      if (!m.repeat) break;
      d = m.repeat.every === 'month' ? addMonthsDay(m.on, i + 1) : addDays(d, 7);
      if (d > m.repeat.until) break;
    }
    for (const d of dates)
      (m.direction === 'in' ? inn : out).push({
        on: d < today ? today : d,
        amount: m.amount,
        label: m.label,
        source: 'manual',
        estimate: false,
        overdue: d < today,
      });
  }
  return { start, end, out, in: inn };
}

/** The 13 weeks: opening balance, money in and out, and each week's closing. */
export function finCash13(f: FinStatus, runs: StaffPayRun[], today: IsoDate) {
  const banks = finCashNeed(f, today);
  const known = banks.filter((b) => b.balance != null);
  const opening = round2(known.reduce((n, b) => n + (b.balance ?? 0), 0));
  const items = finCash13Items(f, runs, today);
  let bal = opening;
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const from = addDays(items.start, i * 7);
    const to = addDays(from, 6);
    const inWeek = (x: FinCash13Item) => (i === 0 ? x.on <= to : x.on >= from && x.on <= to);
    const ins = items.in.filter(inWeek);
    const outs = items.out.filter(inWeek);
    const moneyIn = round2(ins.reduce((n, x) => n + x.amount, 0));
    const moneyOut = round2(outs.reduce((n, x) => n + x.amount, 0));
    const open = bal;
    bal = round2(bal + moneyIn - moneyOut);
    return { week: i + 1, from, to, opening: open, moneyIn, moneyOut, closing: bal, ins, outs };
  });
  // With no statement loaded at all there is no real opening balance: no shortfall is claimed.
  const short = known.length ? (weeks.find((w) => w.closing < 0) ?? null) : null;
  const review = [...(f.cash13Reviews ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  return {
    opening,
    banks: banks.map((b) => ({ bank: b.bank, balance: b.balance, asOf: b.balanceAsOf })),
    noStatement: banks.filter((b) => b.balance == null).map((b) => b.bank),
    weeks,
    firstShort: short ? { week: short.week, from: short.from, closing: short.closing } : null,
    lowest: weeks.reduce((m, w) => Math.min(m, w.closing), opening),
    review,
    reviewDue: !review || daysBetween(review.at.slice(0, 10), today) >= R().reviewDays,
    lines: (f.cash13 ?? []).filter((x) => !x.removed),
  };
}

export interface FinCash13Ctx {
  user: User;
  a: FinActor;
  reviewer: boolean;
  today: IsoDate;
  sign: (comment?: string) => FinSign;
}

/** Add or remove a line Finance knows about; a reviewer marks the week's forecast as looked over. */
export function finCash13Action(ctx: FinCash13Ctx, f: FinStatus, runs: StaffPayRun[], action: string, input: Record<string, unknown>) {
  if (ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff do this)');
  const lines = f.cash13 ?? [];
  if (action === 'add') {
    const direction = input.direction === 'in' ? 'in' : input.direction === 'out' ? 'out' : null;
    if (!direction) throw new BadRequest('Money in or money out?');
    const on = isoDate(input.on, 'Date expected');
    if (on > addDays(ctx.today, 13 * 7)) throw new BadRequest('The forecast covers 13 weeks.');
    const amount = typeof input.amount === 'number' ? input.amount : Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new BadRequest('The amount must be more than RM0.00.');
    const label = noSecrets(text(input.label, 'What it is', 3, 120), 'What it is');
    const every: 'week' | 'month' | null = input.every === 'week' ? 'week' : input.every === 'month' ? 'month' : null;
    const repeat = every ? { every, until: isoDate(input.until, 'Repeat until') } : null;
    if (repeat && repeat.until < on) throw new BadRequest('Repeat until a day after the first one.');
    const l: FinCash13Line = {
      id: `c13-${f.companyId}-${String(lines.length + 1).padStart(3, '0')}`,
      direction,
      on,
      amount: round2(amount),
      label,
      repeat,
      sign: ctx.sign(),
      removed: null,
    };
    return {
      patch: { cash13: [...lines, l] },
      action: 'finance.cash13.add',
      summary: `13-week forecast: ${direction === 'in' ? 'money in' : 'money out'} RM${l.amount.toFixed(2)} on ${on}${repeat ? `, every ${repeat.every} to ${repeat.until}` : ''}: ${label}`,
      result: l,
    };
  }
  if (action === 'remove') {
    const l = lines.find((x) => x.id === input.lineId && !x.removed);
    if (!l) throw new NotFound('Forecast line');
    const why = requireReason(input.comment, 'remove the line');
    return {
      patch: { cash13: lines.map((x) => (x.id === l.id ? { ...x, removed: ctx.sign(why) } : x)) },
      action: 'finance.cash13.remove',
      summary: `13-week forecast: removed "${l.label}": ${why}`,
      result: null,
    };
  }
  if (action === 'review') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO reviews the forecast)');
    const c = requireComment(input.comment, 'review the forecast');
    const v = finCash13(f, runs, ctx.today);
    const r = { ...ctx.sign(c), lowest: v.lowest, firstShortWeek: v.firstShort?.week ?? null };
    return {
      patch: { cash13Reviews: [...(f.cash13Reviews ?? []), r].slice(-60) },
      action: 'finance.cash13.review',
      summary: `13-week forecast reviewed: lowest week RM${v.lowest.toFixed(2)}${v.firstShort ? `, short from week ${v.firstShort.week}` : ''}: ${c}`,
      result: r,
    };
  }
  throw new BadRequest('Unknown forecast action.');
}
