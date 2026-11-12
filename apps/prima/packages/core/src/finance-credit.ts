import type { FinSettingsValues } from "./types";
import { AccessDenied } from "./access";
import { isLead } from "./finance";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { ClientAccount } from "./types";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FinCreditLimit {
  clientAccountId: Id;
  client: string;
  limit: number;
  set: FinSign;
  /** The client's balance from SQL Account's customer statement or ageing, kept by Finance. */
  balance: { owed: number; oldestUnpaidOn: IsoDate | null; asOf: IsoDate; source: string; by: string; byId: Id; at: IsoDateTime } | null;
}

/** A post added for a client Finance warned about, with Operations' reason, until a Finance reviewer has seen it. */
export interface FinCreditOverride {
  id: Id;
  clientAccountId: Id;
  client: string;
  siteId: Id;
  post: string;
  warning: string;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  seen: FinSign | null;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Whether Prima should warn before more posts are added for this client. */
export function finCreditStatus(f: FinStatus | null, client: ClientAccount, today: IsoDate, s?: Partial<FinSettingsValues>) {
  const r = { ...RULES.financeCredit.value, overdueDays: s?.creditOverdueDays ?? RULES.financeCredit.value.overdueDays, balanceStaleDays: s?.creditStaleDays ?? RULES.financeCredit.value.balanceStaleDays };
  const c = (f?.creditLimits ?? []).find((x) => x.clientAccountId === client.id) ?? null;
  const reasons: string[] = [];
  const owed = c?.balance?.owed ?? null;
  if (c && owed != null && owed > c.limit) reasons.push(`owes RM${owed.toFixed(2)}, over its credit limit of RM${c.limit.toFixed(2)}`);
  // Over 90 days: from Finance's balance, an open invoice case, or the billing status the company keeps.
  const before = addDays(today, -r.overdueDays);
  const oldest = [
    c?.balance?.oldestUnpaidOn ?? null,
    ...(f?.arCases ?? [])
      .filter((x) => x.outstanding > 0 && !['closed', 'written_off', 'recovered', 'reissued'].includes(x.status) && norm(x.customer) === norm(client.name))
      .map((x) => x.invoiceDate),
    client.billing && client.billing.overdueAmount > 0 && client.billing.overdueDays > 0 ? addDays(client.billing.asOf, -client.billing.overdueDays) : null,
  ]
    .filter((x): x is IsoDate => !!x)
    .sort()[0];
  if (oldest && oldest < before) reasons.push(`has an invoice unpaid for ${daysBetween(oldest, today)} days`);
  const stale = !!c && (!c.balance || daysBetween(c.balance.asOf, today) > r.balanceStaleDays);
  return { limit: c?.limit ?? null, owed, oldestUnpaidOn: oldest ?? null, asOf: c?.balance?.asOf ?? null, stale, warn: reasons.length > 0, reasons };
}

export function finCreditWarning(client: ClientAccount, reasons: string[]) {
  return `Finance warning: ${client.name} ${reasons.join(' and ')}. Check with Finance before adding posts. To add it anyway, give the reason; Finance sees it.`;
}

export function finCreditAction(ctx: FinCashCtx, f: FinStatus, clients: ClientAccount[], action: string, input: Record<string, unknown>): Out<unknown> {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
  const list = f.creditLimits ?? [];
  const client = clients.find((c) => c.id === input.clientAccountId && c.companyId === f.companyId);
  if (action === 'seen') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO)');
    const o = (f.creditOverrides ?? []).find((x) => x.id === input.overrideId);
    if (!o) throw new NotFound('Post added after a warning');
    if (o.seen) throw new BadRequest('Already seen.');
    const next = { ...o, seen: ctx.sign(text(input.comment, 'What Finance does about it (chase payment, agreed with the client)', 5, 300)) };
    return {
      patch: { creditOverrides: (f.creditOverrides ?? []).map((x) => (x.id === o.id ? next : x)) },
      action: 'finance.credit.seen',
      summary: `Post ${o.post} for ${o.client} seen by Finance: ${next.seen.comment}`,
      result: next,
    };
  }
  if (!client) throw new NotFound('Client');
  const old = list.find((x) => x.clientAccountId === client.id) ?? null;
  const save = (c: FinCreditLimit | null) => ({
    creditLimits: c ? (old ? list.map((x) => (x.clientAccountId === client.id ? c : x)) : [...list, c]) : list.filter((x) => x.clientAccountId !== client.id),
  });
  if (action === 'limit') {
    // Fauzan, 2 Nov 2026: "Fd or ceo" set credit limits.
    if (!ctx.a || !isLead(ctx.a)) throw new AccessDenied('view', '(the Finance Director or the CEO sets a credit limit)');
    const limit = Number(input.limit);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1_000_000_000) throw new BadRequest('Credit limit: give an amount in RM.');
    const why = requireReason(input.comment, `set ${client.name}'s credit limit (e.g. two months' billing)`);
    const c: FinCreditLimit = { clientAccountId: client.id, client: client.name, limit: r2(limit), set: ctx.sign(why), balance: old?.balance ?? null };
    return {
      patch: save(c),
      action: 'finance.credit.limit',
      summary: `${client.name}: credit limit ${old ? `RM${old.limit.toFixed(2)} to ` : ''}RM${c.limit.toFixed(2)}: ${why}`,
      result: c,
    };
  }
  if (action === 'balance') {
    if (!old) throw new BadRequest('Set the credit limit first.');
    const owed = Number(input.owed);
    if (!Number.isFinite(owed) || owed < 0 || owed > 1_000_000_000) throw new BadRequest('Owed now: give an amount in RM.');
    const oldestUnpaidOn = input.oldestUnpaidOn ? isoDate(input.oldestUnpaidOn, 'Oldest unpaid invoice date') : null;
    if (owed > 0 && !oldestUnpaidOn) throw new BadRequest('Give the date of the oldest unpaid invoice.');
    if (oldestUnpaidOn && oldestUnpaidOn > ctx.today) throw new BadRequest('The invoice date cannot be in the future.');
    const sign = ctx.sign();
    // Not money moving: whoever reads the statement records it (trust-staff rule, 2 Nov 2026).
    const c: FinCreditLimit = {
      ...old,
      balance: {
        owed: r2(owed),
        oldestUnpaidOn: owed > 0 ? oldestUnpaidOn : null,
        asOf: ctx.today,
        source: noSecrets(text(input.source ?? 'SQL Account customer statement', 'Where it comes from', 3, 120), 'Source'),
        by: sign.by,
        byId: sign.byId,
        at: sign.at,
      },
    };
    return {
      patch: save(c),
      action: 'finance.credit.balance',
      summary: `${client.name}: owes RM${c.balance!.owed.toFixed(2)}${c.balance!.oldestUnpaidOn ? `, oldest unpaid ${c.balance!.oldestUnpaidOn}` : ''}.`,
      result: c,
    };
  }
  if (action === 'remove') {
    if (!ctx.a || !isLead(ctx.a)) throw new AccessDenied('view', '(the Finance Director or the CEO)');
    if (!old) throw new NotFound('Credit limit');
    const why = requireReason(input.comment, 'remove the limit');
    return { patch: save(null), action: 'finance.credit.removed', summary: `${client.name}: credit limit removed: ${why}`, result: null };
  }
  throw new BadRequest('Unknown action.');
}

export function finCreditView(f: FinStatus, clients: ClientAccount[], today: IsoDate, s?: Partial<FinSettingsValues>) {
  return {
    clients: clients
      .filter((c) => c.companyId === f.companyId && c.stage !== 'ended')
      .map((c) => ({ id: c.id, name: c.name, ...finCreditStatus(f, c, today, s) }))
      .sort((a, b) => Number(b.warn) - Number(a.warn) || Number(b.limit != null) - Number(a.limit != null) || a.name.localeCompare(b.name)),
    overrides: (f.creditOverrides ?? []).filter((o) => !o.seen || daysBetween(o.at.slice(0, 10), today) <= 60).sort((a, b) => b.at.localeCompare(a.at)),
    overdueDays: s?.creditOverdueDays ?? RULES.financeCredit.value.overdueDays,
  };
}

export function finCreditHome(f: FinStatus, clients: ClientAccount[], today: IsoDate, reviewer: boolean, s?: Partial<FinSettingsValues>) {
  const mine = clients.filter((c) => c.companyId === f.companyId);
  return {
    overridesToSee: reviewer ? (f.creditOverrides ?? []).filter((o) => !o.seen).length : 0,
    balanceStale: (f.creditLimits ?? []).filter(
      (c) => mine.some((x) => x.id === c.clientAccountId) && finCreditStatus(f, mine.find((x) => x.id === c.clientAccountId)!, today, s).stale,
    ).length,
  };
}