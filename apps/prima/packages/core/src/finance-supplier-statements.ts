import { AccessDenied } from "./access";
import { noSecrets } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { addDays } from "./time";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";


type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FinSupplierCheck {
  id: Id;
  payeeId: Id;
  supplier: string;
  /** YYYY-Qn */
  quarter: string;
  /** What the supplier's statement says the company owes at the quarter end. */
  statementBalance: number;
  /** The supplier's creditor balance in SQL Account at the same day. */
  ledgerBalance: number;
  diff: number;
  doc: string;
  /** Why they differ (invoices in transit, payments not yet seen by the supplier, disputes). */
  explanation: string | null;
  prepared: FinSign;
  reviewed: FinSign | null;
}

/** The last full quarter before today, and the day it ended. */
export function finLastQuarter(today: IsoDate): { quarter: string; endOn: IsoDate } {
  const y = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const [yy, qq] = q === 0 ? [y - 1, 4] : [y, q];
  const endMonth = qq * 3;
  const last = new Date(Date.UTC(yy, endMonth, 0)).getUTCDate();
  return { quarter: `${yy}-Q${qq}`, endOn: `${yy}-${String(endMonth).padStart(2, '0')}-${last}` };
}

/** The biggest suppliers by money released to them in the 12 months to the quarter end. */
export function finBigSuppliers(f: FinStatus, endOn: IsoDate) {
  const from = addDays(endOn, -365);
  const paid = new Map<Id, number>();
  for (const p of f.payments ?? [])
    if (p.status === 'released' && p.payeeKind === 'supplier' && p.payeeId && p.releasedOn && p.releasedOn > from && p.releasedOn <= endOn)
      paid.set(p.payeeId, (paid.get(p.payeeId) ?? 0) + p.amount);
  return [...paid.entries()]
    .map(([payeeId, amount]) => ({ payeeId, supplier: (f.payees ?? []).find((x) => x.id === payeeId)?.name ?? payeeId, paid12m: r2(amount) }))
    .sort((a, b) => b.paid12m - a.paid12m)
    .slice(0, RULES.financeSupplierStatements.value.topSuppliers);
}

export function finSupplierStatementsView(f: FinStatus, today: IsoDate) {
  const { quarter, endOn } = finLastQuarter(today);
  const dueOn = addDays(endOn, RULES.financeSupplierStatements.value.dueDays);
  const checks = f.supplierChecks ?? [];
  const rows = finBigSuppliers(f, endOn).map((s) => ({ ...s, check: checks.find((c) => c.payeeId === s.payeeId && c.quarter === quarter) ?? null }));
  return {
    quarter,
    endOn,
    dueOn,
    late: today > dueOn,
    rows,
    earlier: checks
      .filter((c) => c.quarter !== quarter)
      .slice(-20)
      .reverse(),
  };
}

export function finSupplierStatementAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  if (!ctx.a || ctx.a.kind === 'viewer' || ctx.a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
  const list = f.supplierChecks ?? [];
  if (action === 'record') {
    const { quarter, endOn } = finLastQuarter(ctx.today);
    const big = finBigSuppliers(f, endOn).find((x) => x.payeeId === input.payeeId) ?? null;
    const payee = (f.payees ?? []).find((x) => x.id === input.payeeId);
    if (!payee) throw new NotFound('Supplier');
    if (list.some((c) => c.payeeId === payee.id && c.quarter === quarter)) throw new BadRequest(`${payee.name} is already checked for ${quarter}.`);
    const money = (v: unknown, what: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1_000_000_000) throw new BadRequest(`${what}: give an amount in RM.`);
      return r2(n);
    };
    const statementBalance = money(input.statementBalance, "Supplier's statement balance");
    const ledgerBalance = money(input.ledgerBalance, 'SQL Account creditor balance');
    const diff = r2(statementBalance - ledgerBalance);
    const explanation = Math.abs(diff) >= 0.005 ? requireReason(input.comment, `explain the RM${diff.toFixed(2)} difference`) : null;
    const c: FinSupplierCheck = {
      id: `sst-${f.companyId}-${quarter}-${payee.id}`,
      payeeId: payee.id,
      supplier: payee.name,
      quarter,
      statementBalance,
      ledgerBalance,
      diff,
      doc: noSecrets(text(input.doc, "Supplier's statement (file name)", 3, 200), 'Document'),
      explanation,
      prepared: ctx.sign(),
      reviewed: null,
    };
    return {
      patch: { supplierChecks: [...list, c] },
      action: 'finance.supplier.statement',
      summary: `${payee.name} ${quarter}: statement RM${statementBalance.toFixed(2)}, SQL Account RM${ledgerBalance.toFixed(2)}${diff ? `, difference RM${diff.toFixed(2)}: ${explanation}` : ', agreed'}${big ? '' : ' (not in the top list)'}.`,
      result: c,
    };
  }
  if (action === 'review') {
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO reviews it)');
    const c = list.find((x) => x.id === input.checkId);
    if (!c) throw new NotFound('Supplier statement check');
    if (c.reviewed) throw new BadRequest('Already reviewed.');
    if (c.prepared.byId === ctx.user.id) throw new AccessDenied('view', '(nobody reviews their own check)');
    const next = { ...c, reviewed: ctx.sign(text(input.comment, 'What you looked at', 5, 300)) };
    return {
      patch: { supplierChecks: list.map((x) => (x.id === c.id ? next : x)) },
      action: 'finance.supplier.reviewed',
      summary: `${c.supplier} ${c.quarter} statement check reviewed.`,
      result: next,
    };
  }
  throw new BadRequest('Unknown action.');
}

/** Close exception: the last quarter's biggest suppliers not all checked and reviewed by the due day. */
export function finSupplierStatementExceptions(f: FinStatus, today: IsoDate) {
  const v = finSupplierStatementsView(f, today);
  if (!v.late) return [];
  return v.rows
    .filter((r) => !r.check?.reviewed)
    .map((r) => ({
      key: `supstmt:${v.quarter}:${r.payeeId}`,
      text: `${r.supplier}: ${v.quarter} supplier statement not ${r.check ? 'reviewed' : 'checked against SQL Account'}`,
    }));
}

export function finSupplierStatementHome(f: FinStatus, today: IsoDate, userId: Id, reviewer: boolean) {
  const v = finSupplierStatementsView(f, today);
  return {
    toCheck: v.rows.filter((r) => !r.check).length,
    toReview: reviewer ? v.rows.filter((r) => r.check && !r.check.reviewed && r.check.prepared.byId !== userId).length : 0,
  };
}