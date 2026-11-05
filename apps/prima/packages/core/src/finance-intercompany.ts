// Intercompany balances agreed on both sides every month (Fauzan, 2 Nov 2026: yes to suggestion 12, "Intercompany:
// management fees, recharges and loans between companies agreed on both sides every month"; not the transfer pricing
// file, suggestion 20, "no need for now").
//
// Each company's Finance team records, for the month, its balance in SQL Account with each other group company, by kind
// (management fee, recharge, loan, other): positive when the other company owes it, negative when it owes the other.
// Both sides together must come to RM0.00. Prima pairs them up: agreed when they do; otherwise it shows who has not
// recorded, or the difference. A difference is fixed by correcting a side (the usual case: one side has not booked an
// invoice) or explained by a reviewer who entered neither side (for example cash in transit at the month end). A pair
// with a balance last month must be recorded again this month. Anything not agreed or explained stops the close of
// both companies. The entries are kept on PWVSB's Finance row, which every Finance person can read, so each side sees
// the other's figure; Prima shows each person only the pairs of companies they act on.
import { AccessDenied } from './access';
import { noSecrets, requireReason, text } from './finance';
import { RULES } from './rules';
import { BadRequest } from './service';
import type { FinSign, FinStatus, Id, User } from './types';

const R = () => RULES.financeIntercompany.value;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type FinIcKind = 'management_fee' | 'recharge' | 'loan' | 'other';
export const FIN_IC_KINDS: FinIcKind[] = ['management_fee', 'recharge', 'loan', 'other'];

export interface FinIcEntry {
  id: Id;
  /** YYYY-MM: the month-end balance. */
  period: string;
  /** The company whose books this is. */
  companyId: Id;
  /** The other group company. */
  withId: Id;
  kind: FinIcKind;
  /** Positive: the other company owes this one. Negative: this one owes the other. */
  balance: number;
  /** The SQL Account intercompany account or document the figure comes from. */
  sqlRef: string;
  sign: FinSign;
  /** Earlier figures for the same month (corrections), newest last. */
  history: { balance: number; sqlRef: string; by: string; at: string }[];
}

export interface FinIcExplain {
  period: string;
  /** The pair, in sorted order, and the kind. */
  a: Id;
  b: Id;
  kind: FinIcKind;
  /** The difference explained; a later change to either side needs a new explanation. */
  difference: number;
  reason: string;
  sign: FinSign;
}

export type FinIcPairStatus = 'agreed' | 'explained' | 'missing' | 'differs';

export interface FinIcPair {
  period: string;
  a: Id;
  b: Id;
  kind: FinIcKind;
  aEntry: FinIcEntry | null;
  bEntry: FinIcEntry | null;
  /** a's balance + b's balance; RM0.00 when agreed. */
  difference: number | null;
  status: FinIcPairStatus;
  /** Who has not recorded (missing only). */
  missing: Id[];
  explained: FinIcExplain | null;
  /** Carried from last month: the pair had a balance then, and nobody has recorded this month. */
  carried: boolean;
}

export interface FinIcCtx {
  user: User;
  /** May the person record for this company (they act on its books)? */
  actsOn: (companyId: Id) => boolean;
  /** Reviewer: the deputy, the team leader, the FD or the CEO. */
  reviewer: boolean;
  /** Group companies by id (name), for checking the other side. */
  companyName: (id: Id) => string | null;
  /** The latest month that may be recorded (the month being closed or earlier). */
  maxPeriod: string;
  sign: (comment?: string) => FinSign;
}

type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };

const prevPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const KIND_LABEL: Record<FinIcKind, string> = { management_fee: 'management fee', recharge: 'recharges', loan: 'loan', other: 'other' };
const rm = (n: number) => `RM${n.toFixed(2)}`;

/** Every pair for the month, from both sides' entries, explanations and last month's balances. */
export function finIcPairs(g: Pick<FinStatus, 'intercompany' | 'icExplained'>, period: string): FinIcPair[] {
  const entries = g.intercompany ?? [];
  const key = (a: Id, b: Id, k: FinIcKind) => `${a}|${b}|${k}`;
  const pairs = new Map<string, { a: Id; b: Id; kind: FinIcKind; carried: boolean }>();
  for (const e of entries.filter((x) => x.period === period)) {
    const [a, b] = [e.companyId, e.withId].sort();
    pairs.set(key(a, b, e.kind), { a, b, kind: e.kind, carried: false });
  }
  // A balance last month that nobody has recorded this month.
  for (const e of entries.filter((x) => x.period === prevPeriod(period) && Math.abs(x.balance) >= 0.005)) {
    const [a, b] = [e.companyId, e.withId].sort();
    if (!pairs.has(key(a, b, e.kind))) pairs.set(key(a, b, e.kind), { a, b, kind: e.kind, carried: true });
  }
  const of = (c: Id, w: Id, k: FinIcKind) => entries.find((x) => x.period === period && x.companyId === c && x.withId === w && x.kind === k) ?? null;
  return [...pairs.values()].map(({ a, b, kind, carried }) => {
    const aEntry = of(a, b, kind);
    const bEntry = of(b, a, kind);
    const missing = [...(aEntry ? [] : [a]), ...(bEntry ? [] : [b])];
    const difference = aEntry && bEntry ? round2(aEntry.balance + bEntry.balance) : null;
    const explained =
      difference == null
        ? null
        : ((g.icExplained ?? []).find((x) => x.period === period && x.a === a && x.b === b && x.kind === kind && Math.abs(x.difference - difference) < 0.005) ??
          null);
    // Both sides at RM0.00 with nothing left between them is agreed too.
    const status: FinIcPairStatus = missing.length ? 'missing' : Math.abs(difference!) < 0.005 ? 'agreed' : explained ? 'explained' : 'differs';
    return { period, a, b, kind, aEntry, bEntry, difference, status, missing, explained, carried };
  });
}

/** Close exceptions for one company's month: every pair with it that is not agreed or explained. */
export function finIcExceptions(
  g: Pick<FinStatus, 'intercompany' | 'icExplained'> | null | undefined,
  companyId: Id,
  period: string,
  nameOf: (id: Id) => string = (x) => x,
) {
  if (!g) return [];
  return finIcPairs(g, period)
    .filter((p) => (p.a === companyId || p.b === companyId) && (p.status === 'missing' || p.status === 'differs'))
    .map((p) => {
      const other = p.a === companyId ? p.b : p.a;
      const what =
        p.status === 'differs'
          ? `the two sides differ by ${rm(Math.abs(p.difference!))}`
          : p.missing.includes(companyId)
            ? p.carried
              ? 'there was a balance last month; record this month'
              : 'record this company’s side'
            : `${nameOf(other)} has not recorded its side`;
      return { key: `ic:${p.a}:${p.b}:${p.kind}:${p.status}`, text: `Intercompany ${KIND_LABEL[p.kind]} with ${nameOf(other)}, ${period}: ${what}` };
    });
}

/** Record this company's month-end balance with another company, or explain a difference (a reviewer who entered neither side). */
export function finIcAction(ctx: FinIcCtx, g: FinStatus, companyId: Id, action: string, input: Record<string, unknown>): Out<unknown> {
  if (!ctx.actsOn(companyId)) throw new AccessDenied('view', '(Finance for this company records its intercompany balances)');
  const period = typeof input.period === 'string' && /^\d{4}-\d{2}$/.test(input.period) ? input.period : null;
  if (!period) throw new BadRequest('Give the month (YYYY-MM).');
  if (period > ctx.maxPeriod) throw new BadRequest(`Record month-end balances up to ${ctx.maxPeriod}.`);
  const withId = typeof input.withId === 'string' ? input.withId : '';
  if (!withId || withId === companyId || !ctx.companyName(withId)) throw new BadRequest('Choose the other group company.');
  const kind = FIN_IC_KINDS.find((k) => k === input.kind);
  if (!kind) throw new BadRequest(`Kind must be one of: ${FIN_IC_KINDS.join(', ')}.`);
  const entries = g.intercompany ?? [];
  if (action === 'record') {
    const raw = typeof input.balance === 'number' ? input.balance : Number(input.balance);
    if (!Number.isFinite(raw) || Math.abs(raw) > 1e9) throw new BadRequest('The balance must be an amount (negative when this company owes the other).');
    if (Math.abs(Math.round(raw * 100) - raw * 100) > 1e-6) throw new BadRequest('The balance has at most 2 decimal places (sen).');
    const balance = round2(raw);
    const sqlRef = noSecrets(text(input.sqlRef, 'SQL Account account or document', 2, 80), 'SQL Account reference');
    const old = entries.find((x) => x.period === period && x.companyId === companyId && x.withId === withId && x.kind === kind);
    const sign = ctx.sign(
      String(input.comment ?? '')
        .trim()
        .slice(0, 300),
    );
    const e: FinIcEntry = old
      ? { ...old, balance, sqlRef, sign, history: [...old.history, { balance: old.balance, sqlRef: old.sqlRef, by: old.sign.by, at: old.sign.at }].slice(-20) }
      : { id: `ic-${period}-${companyId}-${withId}-${kind}`, period, companyId, withId, kind, balance, sqlRef, sign, history: [] };
    const next = old ? entries.map((x) => (x === old ? e : x)) : [...entries, e];
    const pair = finIcPairs({ intercompany: next, icExplained: g.icExplained }, period).find(
      (p) => p.kind === kind && [p.a, p.b].includes(companyId) && [p.a, p.b].includes(withId),
    )!;
    return {
      patch: { intercompany: next },
      action: 'finance.intercompany.record',
      summary: `Intercompany ${KIND_LABEL[kind]} ${period}: ${ctx.companyName(companyId) ?? companyId} with ${ctx.companyName(withId)}, ${rm(balance)} (${sqlRef}); ${pair.status === 'agreed' ? 'agreed with the other side' : pair.status === 'missing' ? 'waiting for the other side' : `differs by ${rm(Math.abs(pair.difference ?? 0))}`}.`,
      result: pair,
    };
  }
  if (action === 'explain') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO explains a difference)');
    const [a, b] = [companyId, withId].sort();
    const pair = finIcPairs(g, period).find((p) => p.a === a && p.b === b && p.kind === kind);
    if (!pair || pair.status !== 'differs') throw new BadRequest('That pair has no difference to explain.');
    if (pair.aEntry!.sign.byId === ctx.user.id || pair.bEntry!.sign.byId === ctx.user.id)
      throw new AccessDenied('view', '(someone who entered neither side explains the difference)');
    if (Math.abs(pair.difference!) > R().explainMax)
      throw new BadRequest(`A difference above ${rm(R().explainMax)} is corrected in SQL Account, not explained.`);
    const reason = requireReason(input.comment, 'explain the difference');
    const x: FinIcExplain = { period, a, b, kind, difference: pair.difference!, reason, sign: ctx.sign(reason) };
    const list = [...(g.icExplained ?? []).filter((y) => !(y.period === period && y.a === a && y.b === b && y.kind === kind)), x];
    return {
      patch: { icExplained: list },
      action: 'finance.intercompany.explain',
      summary: `Intercompany ${KIND_LABEL[kind]} ${period}, ${ctx.companyName(a)} and ${ctx.companyName(b)}: ${rm(pair.difference!)} explained: ${reason}`,
      result: { ...pair, status: 'explained', explained: x },
    };
  }
  throw new BadRequest('Unknown intercompany action.');
}

/** The pairs a person may see (companies they act on), for the last three months, with names. */
export function finIcView(g: Pick<FinStatus, 'intercompany' | 'icExplained'> | null | undefined, companyId: Id, periods: string[], nameOf: (id: Id) => string) {
  if (!g) return [];
  return periods.flatMap((period) =>
    finIcPairs(g, period)
      .filter((p) => p.a === companyId || p.b === companyId)
      .map((p) => {
        const mine = p.a === companyId ? p.aEntry : p.bEntry;
        const theirs = p.a === companyId ? p.bEntry : p.aEntry;
        const withId = p.a === companyId ? p.b : p.a;
        return {
          period,
          withId,
          with: nameOf(withId),
          kind: p.kind,
          mine: mine ? { balance: mine.balance, sqlRef: mine.sqlRef, by: mine.sign.by, at: mine.sign.at } : null,
          theirs: theirs ? { balance: theirs.balance, sqlRef: theirs.sqlRef, by: theirs.sign.by, at: theirs.sign.at } : null,
          difference: p.difference,
          status: p.status,
          carried: p.carried,
          explained: p.explained ? { reason: p.explained.reason, by: p.explained.sign.by } : null,
          enteredBy: [p.aEntry?.sign.byId, p.bEntry?.sign.byId].filter(Boolean) as Id[],
        };
      }),
  );
}
