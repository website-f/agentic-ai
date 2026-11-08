import { AccessDenied } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { centralEmployerName } from "./access";
import { isActHead } from "./access";
import { tenantCompanyIds } from "./access";
import { periodEnd } from "./payroll";
import { RULES } from "./rules";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import { FIN_PLAN_LINES } from "./types";
import type { PurRequest } from "./types";
import type { PurSupplier } from "./types";
import type { Contract } from "./types";
import type { FinApprover } from "./types";
import type { FinSubject } from "./types";
import type { FinArCase } from "./types";
import type { FinBankAccount } from "./types";
import type { FinClose } from "./types";
import type { FinExternalApproval } from "./types";
import type { FinPackItem } from "./types";
import type { FinPackKind } from "./types";
import type { FinPayeeKind } from "./types";
import type { FinPayment } from "./types";
import type { FinBankRec } from "./types";
import type { FinLedgerLine } from "./types";
import type { FinSettingsValues } from "./types";
import type { FinApprovalMethod } from "./types";
import type { FinPlanLine } from "./types";
import type { FinRequest } from "./types";
import type { FinStatement } from "./types";
import type { FinStatus } from "./types";
import type { FinStep } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { RefusedAfterSave } from "./service";
import type { HomeItem } from "./service";
import { finRegularExceptions } from "./finance-regular";
import { finRegularForPayment } from "./finance-regular";
import { finRegularLink } from "./finance-regular";
import { finCashExceptions } from "./finance-cash";
import { finDuplicateAcross } from "./finance-cash";
import { finMandateOf } from "./finance-cash";
import { finMandateRelease } from "./finance-cash";
import { finPettyFreeTopUp } from "./finance-cash";
import { finBillingDue } from "./finance-billing";
import { finMoneyInExceptions } from "./finance-billing";
import { finStampExceptions } from "./finance-stamp";
import { finDailyCashExceptions } from "./finance-daily-cash";
import { finYearEndExceptions } from "./finance-yearend";
import { finSupplierStatementExceptions } from "./finance-supplier-statements";
import { finIcExceptions } from "./finance-intercompany";
import { finIcPairs } from "./finance-intercompany";
import { FIN_FS_LABELS } from "./finance-ledger";
import { finFsTests } from "./finance-ledger";


export const FIN_PAYEE_KINDS: FinPayeeKind[] = ['supplier', 'statutory', 'payroll', 'tax', 'intercompany', 'other'];
/** Tests that must be exactly RM0.00 before a close is approved (V6). */
export const FIN_ZERO_TESTS = ['FS-01', 'FS-02', 'FS-06'];

// ---------- Who is acting ----------

/**
 * Who joins Prima for the Finance rollout (Phase 2): the Finance Director and every Finance team member. The API lets
 * them sign in only when FINANCE_ROLLOUT=true is set; it is off by default, so the IT pilot is unchanged until the
 * CEO decides to start Phase 2.
 */
export function inFinanceRollout(user: User): boolean {
  if (user.integration || user.role !== 'pwvsb_officer') return false;
  return user.leadership === 'finance_director' || (user.department === 'finance' && user.financeTeam != null && !!user.financeRole);
}

/** What a person may do in Finance. 'viewer' is the Chairman, the Vice Chairman and the ACT head: they look, never act. */
export interface FinActor {
  kind: 'ceo' | 'director' | 'leader' | 'deputy' | 'data_entry' | 'viewer' | 'coo';
  team: number | null;
}

/**
 * The COO approves payments for the departments he directly monitors (Fauzan, 1 Nov 2026). He is not a Finance actor:
 * finActor never returns 'coo'. He reaches payments only through the narrow COO queue (cooDesk / cooStep), which lets
 * him approve or return COO-subject payments that Finance has reviewed, and nothing else.
 */
export function isFinCoo(user: User): boolean {
  return !user.integration && user.role === 'pwvsb_officer' && user.opsTier === 'coo';
}
const COO_ACTOR: FinActor = { kind: 'coo', team: null };
export const FIN_SUBJECTS: FinSubject[] = ['finance', 'operations', 'it', 'fwm', 'inventory', 'transport', 'goodwill'];

export function finActor(user: User): FinActor | null {
  if (user.integration) return null;
  if (user.opsTier === 'ceo' && (user.role === 'director' || user.role === 'pwvsb_officer')) return { kind: 'ceo', team: null };
  if (user.role !== 'pwvsb_officer') return null;
  if (user.leadership === 'finance_director') return { kind: 'director', team: null };
  if (user.leadership === 'chairman' || user.leadership === 'vice_chairman' || isActHead(user)) return { kind: 'viewer', team: null };
  if (user.department === 'finance' && user.financeTeam != null && user.financeRole)
    return { kind: user.financeRole, team: user.financeTeam };
  return null;
}

/** The CEO and the Finance Director act on every company; team members act on their own team's companies. */
export function actsOn(a: FinActor, f: FinStatus): boolean {
  if (a.kind === 'ceo' || a.kind === 'director' || a.kind === 'coo') return true;
  if (a.kind === 'viewer') return false;
  return a.team === f.team;
}
export const isLead = (a: FinActor) => a.kind === 'ceo' || a.kind === 'director';

/**
 * Who must approve a payment (rule FIN-PAY). Fauzan, 1 Nov 2026: approval is by subject matter and only the Finance
 * Director, the CEO and the COO approve anything; for Finance payments that is the Finance Director or the CEO, at any
 * amount. Team leaders and deputies review; they never approve. The amount is kept for the CEO's notice of large payments.
 */
export function finApproverFor(subject: FinSubject = 'finance'): FinApprover {
  return RULES.financePayments.value.cooSubjects.includes(subject) ? 'coo' : 'director';
}

/**
 * Whether this person may approve at that level. Finance payments: the Finance Director or the CEO (older 'leader' and
 * 'ceo' records included). COO-subject payments: the COO or the CEO, never the Finance Director.
 */
export function finCoversApproval(a: FinActor, needs: FinApprover): boolean {
  if (needs === 'coo') return a.kind === 'coo' || a.kind === 'ceo';
  return isLead(a);
}

/** The comment every approval needs (Fauzan, 31 Oct 2026: "at least a comment"). */
export function requireComment(text: unknown, what = 'approve'): string {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) throw new BadRequest(`Write a comment to ${what} (a short one is fine).`);
  return t.slice(0, 500);
}

/** A return, a cancellation or a reopening says what is wrong. */
export function requireReason(text: unknown, what: string): string {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < RULES.financePayments.value.reasonMin)
    throw new BadRequest(`Say why you ${what} (at least ${RULES.financePayments.value.reasonMin} characters), so the preparer knows what to fix.`);
  return t.slice(0, 500);
}

export function text(v: unknown, field: string, min: number, max: number): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < min) throw new BadRequest(`${field} is needed.`);
  if (t.length > max) throw new BadRequest(`${field} is too long (at most ${max} characters).`);
  return t;
}

export function isoDate(v: unknown, field: string): IsoDate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
    throw new BadRequest(`${field} must be a date (YYYY-MM-DD).`);
  return v;
}

/** Bank account numbers and passwords never belong in a payment record. */
export function noSecrets(v: string, field: string): string {
  if (/\b(a\/c|acc(ount)?\.? ?(no|number)?)\b[^\d]{0,6}\d[\d\s-]{7,}/i.test(v) || /password|passcode|\bpin\b|\btac\b/i.test(v))
    throw new BadRequest(`${field} looks like it holds an account number or a password. Keep those in the bank portal.`);
  return v;
}

// ---------- Monthly bank and payment packs ----------

// ---------- Group Finance settings (Fauzan, 1 Nov 2026: the Finance Director sets them) ----------

/** The rule defaults, used until the Finance Director sets a value. */
/** Finance has seven teams under the Finance Director (Fauzan, 27 Oct 2026). */
export const FIN_TEAMS = 7;

export function finDefaults(): FinSettingsValues {
  const pay = RULES.financePayments.value;
  const ctl = RULES.financeControls.value;
  return {
    approvalExpiryDays: pay.approvalExpiryDays,
    bankPackByDay: pay.bankPackByDay,
    paymentPackByDay: pay.paymentPackByDay,
    monthlyPackByDay: ctl.monthlyPackByDay,
    ageingByDay: ctl.ageingByDay,
    forecastByDay: ctl.forecastByDay,
    eInvoiceCheckByDay: RULES.financeEInvoice.value.checkByDay,
    matchDays: ctl.matchDays,
    unclearedDays: ctl.unclearedDays,
    varianceMinRm: ctl.varianceMinRm,
    variancePct: ctl.variancePct,
    sstThreshold: RULES.financeSst.value.threshold,
    writeOffMinEvidence: RULES.financeReceivables.value.writeOffMinEvidence,
    selfBilledBy: 'Not decided yet (Finance Director to set)',
    approvalMethod: 'prima',
    escalateAfterDays: 3,
    closeApproveByDay: 15,
    varianceByDay: 15,
    // Optimum but reasonable (Fauzan, 1 Nov 2026), office minutes from when the work arrives, queue included:
    // review = open the request, check payee, SQL document, amount and invoice (about 10 min) plus a short queue;
    // approvals (FD, CEO, COO) are not timed (Fauzan, 1 Nov 2026): staff work ends at their own part;
    // release = key in the bank portal, second authoriser, record the reference (about 10 min);
    // rework = fix what the return asked (usually a missing document).
    // Petty cash limits (Fauzan, 2 Nov 2026: "will be set in app by fd").
    pettyVoucherMax: RULES.financeCash.value.pettyVoucherMax,
    pettyFloatMax: RULES.financeCash.value.pettyFloatMax,
    // Next year's budget is due by this day of December (Fauzan, 2 Nov 2026: "10 december for next year").
    budgetByDecDay: 10,
    kpiReviewMinutes: 15,
    kpiReleaseMinutes: 20,
    kpiReworkMinutes: 20,
    kpiCloseReviewMinutes: 90,
    kpiFirstPassPct: 90,
  };
}

/** The allowed range for each number the Finance Director sets, and what it means on the screen. */
export const FIN_SETTING_LIMITS: Record<Exclude<keyof FinSettingsValues, 'selfBilledBy' | 'approvalMethod'>, [number, number, string]> = {
  approvalExpiryDays: [1, 180, 'Days an approval stays valid before release'],
  bankPackByDay: [1, 28, 'Bank pack due (day of next month)'],
  paymentPackByDay: [1, 28, 'Payment pack due (day of next month)'],
  monthlyPackByDay: [1, 28, 'Monthly audit file due (day of next month)'],
  ageingByDay: [1, 28, 'Ageing recorded by (day of next month)'],
  forecastByDay: [1, 28, 'Quarterly forecast by (day of the month after the quarter ends)'],
  eInvoiceCheckByDay: [1, 28, 'e-Invoice check recorded by (day of next month)'],
  matchDays: [0, 14, 'Days either side to match a bank line to a payment automatically'],
  unclearedDays: [1, 30, 'Days before a released payment not on the statement is an exception'],
  varianceMinRm: [0, 10_000_000, 'Budget variance to explain: at least RM'],
  variancePct: [0, 100, 'Budget variance to explain: at least %'],
  sstThreshold: [0, 100_000_000, 'SST registration threshold, taxable services over 12 months (RM)'],
  writeOffMinEvidence: [1, 10, 'Pieces of evidence needed for a bad debt write-off'],
  escalateAfterDays: [1, 30, 'Days a payment may wait for review or approval before the FD and the CEO are told'],
  closeApproveByDay: [1, 28, 'Month-end close approved by (day of next month)'],
  varianceByDay: [1, 28, 'Budget variances explained by (day of next month)'],
  pettyVoucherMax: [1, 100_000, 'Petty cash: one voucher at most (RM)'],
  pettyFloatMax: [1, 1_000_000, 'Petty cash: largest float an office may keep (RM)'],
  budgetByDecDay: [1, 31, "Next year's budget submitted by (day of December)"],
  kpiReviewMinutes: [1, 2400, 'KPI target (provisional): review within office minutes of the work reaching the reviewer'],
  kpiReleaseMinutes: [1, 2400, 'KPI target (provisional): release within office minutes of approval'],
  kpiReworkMinutes: [1, 2400, 'KPI target (provisional): resubmit within office minutes of a return'],
  kpiCloseReviewMinutes: [1, 2400, 'KPI target (provisional): review the month-end close within office minutes'],
  kpiFirstPassPct: [0, 100, 'KPI target (provisional): % accepted first time, without a return'],
};

/** The settings in force: the Finance Director's values over the rule defaults. They live on PWVSB's own row. */
export function finSettingsOf(group: Pick<FinStatus, 'settings'> | null | undefined): FinSettingsValues {
  return { ...finDefaults(), ...(group?.settings?.values ?? {}) };
}

function nextMonthDay(period: string, day: number): IsoDate {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The items a bank pack and a payment pack hold for one month. */
export function finPackTemplate(f: Pick<FinStatus, 'banks'>, pack: 'bank' | 'payment' | 'monthly', period: string, s: FinSettingsValues = finDefaults()): FinPackItem[] {
  const r = s;
  const base = { status: 'todo' as const, by: null, at: null, period };
  if (pack === 'bank') {
    const dueOn = nextMonthDay(period, r.bankPackByDay);
    return [
      ...f.banks.flatMap((b) => [
        { ...base, id: `bank-${period}-stmt-${b.id}`, label: `Bank statement, ${b.bank} ${b.accountMasked}, ${period}`, dueOn },
        { ...base, id: `bank-${period}-rec-${b.id}`, label: `SQL Account bank reconciliation, ${b.bank} ${b.accountMasked}, ${period}`, dueOn },
      ]),
      { ...base, id: `bank-${period}-open`, label: `Unpresented cheques and uncredited deposits, ${period}`, dueOn },
      { ...base, id: `bank-${period}-signed`, label: `Signed reconciliation summary for every account, ${period}`, dueOn },
    ];
  }
  if (pack === 'monthly') {
    // What the external auditor asks for at year end, kept up every month so the audit is not late (Fauzan, 31 Oct 2026).
    const dueOn = nextMonthDay(period, s.monthlyPackByDay);
    return [
      ['tb', 'Trial balance and general ledger exported from SQL Account and filed'],
      ['ageing', 'Customer and supplier ageing filed and agreed to the ledger'],
      ['fa', 'Fixed asset additions and disposals with invoices; asset register updated'],
      ['payroll', 'Payroll agreed to the ledger: EPF, SOCSO, EIS, PCB and HRD Corp paid and reconciled'],
      ['sst', 'Service tax: invoices agree to the SST listing; return and payment filed when due'],
      ['accruals', 'Accruals, prepayments and deposits schedule updated'],
      ['contracts', 'New or renewed client contracts, leases, loans and hire purchase agreements filed'],
      ['minutes', 'Board minutes and resolutions for the month filed'],
      ['interco', 'Balances with PWVSB and group companies agreed both sides'],
      ['ar-confirm', 'Large or old customer balances followed up in writing'],
    ].map(([k, label]) => ({ ...base, id: `mon-${period}-${k}`, label: `${label}, ${period}`, dueOn }));
  }
  const dueOn = nextMonthDay(period, r.paymentPackByDay);
  return [
    { ...base, id: `pay-${period}-pv`, label: `Payment voucher listing from SQL Account, ${period}`, dueOn },
    { ...base, id: `pay-${period}-support`, label: `Invoices and Prima approvals for every payment, ${period}`, dueOn },
    { ...base, id: `pay-${period}-release`, label: `Bank release confirmations, ${period}`, dueOn },
    { ...base, id: `pay-${period}-statutory`, label: `EPF, SOCSO, EIS, PCB and HRD Corp payment receipts, ${period}`, dueOn },
  ];
}

/**
 * Cash needed (automation, 1 Nov 2026): for each bank account, the approved payments not yet released that fall due in
 * the next 7 and 30 days (overdue ones included) against the last known balance: the latest loaded statement's closing,
 * less payments released after that statement. A shortfall is a warning; Prima never moves money.
 */
export function finCashNeed(f: FinStatus, today: IsoDate) {
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);
  return f.banks.map((b) => {
    const st = [...(f.statements ?? [])].filter((x) => x.bankId === b.id).sort((x, y) => y.period.localeCompare(x.period))[0] ?? null;
    const asOf = st ? periodEnd(st.period) : null;
    const after = st ? (f.payments ?? []).filter((p) => p.bankId === b.id && p.status === 'released' && !!p.releasedOn && p.releasedOn > asOf!).reduce((n, p) => n + p.amount, 0) : 0;
    const balance = st ? Math.round((st.closing - after) * 100) / 100 : null;
    const open = (f.payments ?? []).filter((p) => p.bankId === b.id && p.status === 'approved');
    const due7 = Math.round(open.filter((p) => p.dueOn <= in7).reduce((n, p) => n + p.amount, 0) * 100) / 100;
    const due30 = Math.round(open.filter((p) => p.dueOn <= in30).reduce((n, p) => n + p.amount, 0) * 100) / 100;
    return {
      bankId: b.id,
      bank: `${b.bank} ${b.accountMasked}`,
      balance,
      balanceAsOf: asOf,
      due7,
      due30,
      short7: balance == null ? null : Math.max(0, Math.round((due7 - balance) * 100) / 100),
      short30: balance == null ? null : Math.max(0, Math.round((due30 - balance) * 100) / 100),
    };
  });
}

/**
 * Budget check on a payment (automation, 1 Nov 2026): the year's approved budget for its line against what is already
 * spent or committed: actuals for closed months plus Prima payments on that line due in months without actuals (not
 * cancelled). Over budget is a warning for the reviewer and the approver, never a block or an approval.
 */
export function finBudgetCheck(f: FinStatus, p: FinPayment): { line: FinPlanLine; year: number; budget: number; committed: number; over: number } | null {
  if (!p.budgetLine) return null;
  const year = Number(p.dueOn.slice(0, 4));
  const plan = (f.plans ?? []).find((x) => x.year === year && x.budget.status === 'approved');
  if (!plan) return null;
  const line = p.budgetLine;
  const budget = (plan.budget.months[line] ?? []).reduce((n, x) => n + x, 0);
  const actuals = plan.actuals[line] ?? [];
  const actualSpent = actuals.reduce<number>((n, x) => n + (x ?? 0), 0);
  const open = (f.payments ?? []).filter(
    (x) => x.budgetLine === line && x.status !== 'cancelled' && Number(x.dueOn.slice(0, 4)) === year && actuals[Number(x.dueOn.slice(5, 7)) - 1] == null,
  );
  const committed = Math.round((actualSpent + open.reduce((n, x) => n + x.amount, 0)) * 100) / 100;
  return { line, year, budget, committed, over: Math.max(0, Math.round((committed - budget) * 100) / 100) };
}

/**
 * Guardrail (Fauzan, 1 Nov 2026: "they can do it. Maybe a guardrail to monitor it"): the reviewer may also record the
 * release. That is allowed, never blocked, but each such payment is listed for the Finance Director and the CEO.
 */
export function finPaymentWatch(p: FinPayment): string[] {
  const out: string[] = [];
  const reviewer = reviewerOf(p.steps)?.byId;
  const releaser = lastBy(p.steps, ['released'])?.byId;
  if (p.status === 'released' && reviewer && releaser && reviewer === releaser) out.push('Reviewed and released by the same person');
  return out;
}

/** Who Prima signs as when it does a step by itself (never an approval). */
export const FIN_AUTO = { by: 'Prima (automatic)', byId: 'prima:auto' } as const;

/**
 * Fills pack items from what Prima already holds (Fauzan, 1 Nov 2026: "1. Ok"). Returns, per item id, what it
 * contains. An item is filled only when everything it needs is in Prima; otherwise staff prepare it as before.
 */
export type FinPackFill = { lines: string[]; by: Id[]; key: string };
const fpKey = (lines: string[]) => {
  let h = 5381;
  for (const ch of lines.join('\n')) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(16);
};
const fill = (lines: string[], by: (Id | null | undefined)[]): FinPackFill => ({ lines, by: [...new Set(by.filter((x): x is Id => !!x))], key: fpKey(lines) });

export function finPackAuto(f: FinStatus, pack: FinPackKind, period: string, now: IsoDateTime): Map<Id, FinPackFill> {
  const out = new Map<Id, FinPackFill>();
  if (pack === 'bank') {
    let allRecs = true;
    const recBy: Id[] = [];
    for (const b of f.banks) {
      const st = (f.statements ?? []).find((x) => x.bankId === b.id && x.period === period);
      if (st) out.set(`bank-${period}-stmt-${b.id}`, fill([`Statement loaded by ${st.loaded.by} (${st.loaded.source}), opening RM${st.opening.toFixed(2)}, closing RM${st.closing.toFixed(2)}, ${st.lines.length} lines, version ${st.version ?? 1}`], [st.loaded.byId]));
      const rec = (f.bankRecs ?? []).find((x) => x.bankId === b.id && x.period === period);
      const rst = rec ? (f.statements ?? []).find((x) => x.id === rec.statementId) : null;
      const res = rec && rst ? finBankRecResult(rst, rec, now) : null;
      const good = !!rec && !!res && !finBankRecStale(f, rec) && Math.abs(res.difference) < 0.005 && !res.unexplained.length && !!rec.reviewed;
      if (good) {
        const by = [...(rec!.contributors ?? [rec!.run.byId]), rec!.reviewed!.byId];
        recBy.push(...by);
        out.set(`bank-${period}-rec-${b.id}`, fill([`Prima reconciliation balanced to RM0.00 (revision ${rec!.rev ?? 1}), run by ${rec!.run.by}, reviewed by ${rec!.reviewed!.by}: ${rec!.reviewed!.comment}`], by));
      } else allRecs = false;
    }
    if (f.banks.length && allRecs) out.set(`bank-${period}-open`, fill(['Payments not yet presented and deposits not yet credited, as listed in each balanced Prima reconciliation'], recBy));
    return out;
  }
  if (pack === 'payment') {
    const released = (f.payments ?? []).filter((p) => p.status === 'released' && p.releasedOn?.slice(0, 7) === period);
    if (released.length) {
      const by = released.flatMap((p) => p.steps.map((x) => x.byId));
      const ok = released.every((p) => p.evidence.length && p.steps.some((x) => x.step === 'approved' && x.comment.trim()));
      if (ok)
        out.set(
          `pay-${period}-support`,
          fill(
            released.map((p) => {
              const ap = [...p.steps].reverse().find((x) => x.step === 'approved')!;
              return `${p.id} ${p.payee} RM${p.amount.toFixed(2)}: approved by ${ap.by} (${ap.comment}); ${p.evidence.length} document(s)`;
            }),
            by,
          ),
        );
      if (released.every((p) => p.bankRef)) out.set(`pay-${period}-release`, fill(released.map((p) => `${p.id}: bank reference ${p.bankRef}, released ${p.releasedOn}`), by));
    }
    return out;
  }
  if (pack === 'monthly') {
    const age = (f.ageing ?? []).find((x) => x.period === period);
    if (age?.reviewed) out.set(`mon-${period}-ageing`, fill([`Ageing from ${age.source}, reviewed by ${age.reviewed.by}: ${age.reviewed.comment}`], [age.prepared.byId, age.reviewed.byId]));
    const ret = (f.sst?.returns ?? []).find((r) => r.to === period);
    if (ret?.reviewed && ret.filed)
      out.set(`mon-${period}-sst`, fill([`SST-02 ${ret.from} to ${ret.to}: declared RM${ret.declared.toFixed(2)}, reviewed by ${ret.reviewed.by}, filed ${ret.filed.filedOn} (ack ${ret.filed.ackRef})`], [ret.prepared.byId, ret.reviewed.byId, ret.filed.byId]));
  }
  return out;
}

/**
 * Approvals not released in time go back to the preparer by themselves (Fauzan, 1 Nov 2026: "2. Ok"): the payment is
 * returned with a system step saying why, so nobody has to press Return. The preparer resubmits; it is approved again.
 */
/**
 * A payment prepared from a company head's request (Fauzan, 1 Nov 2026) that is returned (or lapses) sends the request
 * back to its creator too: the whole chain approves it again before Finance can pay it.
 */
export function finReturnRequest(requests: FinRequest[] | undefined, p: FinPayment, who: { by: string; byId: Id }, at: IsoDateTime, comment: string): FinRequest[] | undefined {
  if (!p.requestId || !requests) return requests;
  return requests.map((r) =>
    r.id === p.requestId && r.status === 'approved' ? { ...r, status: 'returned' as const, steps: [...r.steps, { step: 'returned' as const, ...who, at, comment: `Payment ${p.id} returned: ${comment}` }] } : r,
  );
}

export function finApplyLapses(f: FinStatus, today: IsoDate, s: FinSettingsValues, at: IsoDateTime): { f: FinStatus; lapsed: FinPayment[] } {
  const lapsed: FinPayment[] = [];
  const payments = (f.payments ?? []).map((p) => {
    if (p.status !== 'approved') return p;
    const ap = approverOf(p.steps)?.at;
    const exp = p.expiresOn ?? (ap ? dateOf(fromMs(toMs(ap) + Math.min(s.approvalExpiryDays, RULES.financePayments.value.approvalExpiryDays) * 86_400_000)) : null);
    if (!exp || today < exp) return p;
    const next: FinPayment = {
      ...p,
      status: 'returned',
      steps: [...p.steps, { step: 'returned', ...FIN_AUTO, at, comment: `Approval lapsed on ${exp}: not released in time. Resubmit for a fresh approval.` }],
    };
    lapsed.push(next);
    return next;
  });
  let requests = f.requests;
  for (const p of lapsed) requests = finReturnRequest(requests, p, FIN_AUTO, at, `approval lapsed on ${p.expiresOn ?? 'its lapse day'}`);
  return { f: lapsed.length ? { ...f, payments, requests } : f, lapsed };
}

/** The stored pack items, plus this month's template items not touched yet. */
export function finPackItems(f: FinStatus, pack: FinPackKind, period: string, s: FinSettingsValues = finDefaults(), now?: IsoDateTime): FinPackItem[] {
  if (pack === 'audit') return f.audit;
  if (pack === 'tax') return f.tax;
  const stored = f[pack] ?? [];
  const auto = now ? finPackAuto(f, pack, period, now) : new Map<Id, FinPackFill>();
  const missing = finPackTemplate(f, pack, period, s)
    .filter((t) => !stored.some((s) => s.id === t.id))
    .map((t) => {
      const a = auto.get(t.id);
      return a ? { ...t, status: 'prepared' as const, by: FIN_AUTO.by, at: now ?? null, preparedById: FIN_AUTO.byId, auto: a.lines, autoBy: a.by, autoKey: a.key } : t;
    });
  // Review finding (1 Nov 2026): a review stands for the version it read. When what Prima filled has changed since, the
  // item goes back to prepared (needing a new review) and shows it changed; the earlier review stays in the audit log.
  const kept = now
    ? stored.map((i) => {
        if (i.preparedById !== FIN_AUTO.byId || !i.autoKey || (i.status !== 'reviewed' && i.status !== 'prepared')) return i;
        const a = auto.get(i.id);
        if (a && a.key === i.autoKey) return i;
        if (!a) return { ...i, status: 'todo' as const, autoChanged: true, preparedById: null, contributorReview: null };
        return { ...i, status: 'prepared' as const, auto: a.lines, autoBy: a.by, autoKey: a.key, autoChanged: true, reviewedById: null, contributorReview: null };
      })
    : stored;
  return [...kept, ...missing];
}

// ---------- Automatic bank reconciliation (Fauzan, 1 Nov 2026) ----------

const recNorm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
const near = (a: IsoDate, b: IsoDate, days: number) => Math.abs(daysBetween(a, b)) <= days;
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Pairs bank statement lines with SQL Account ledger lines. First by reference (the SQL document or cheque number
 * appears on the bank line, or the bank reference in the SQL entry) with the same amount within 45 days; then by the
 * same amount within the match window when only one candidate exists each way; then one bank line against several
 * ledger lines of one day that add up to it (a payroll or supplier batch, or several receipts banked together).
 */
export function finAutoReconcile(st: FinStatement, ledger: FinLedgerLine[], matchDays: number): { lineIds: Id[]; ledgerIds: Id[]; how: 'reference' | 'amount_date' }[] {
  const out: { lineIds: Id[]; ledgerIds: Id[]; how: 'reference' | 'amount_date' }[] = [];
  const usedL = new Set<Id>();
  const usedS = new Set<Id>();
  const lines = [...(st as FinStatement & { carried?: FinStatement['lines'] }).carried ?? [], ...st.lines].filter((l) => !same(l.amount, 0));
  const free = () => ledger.filter((g) => !usedL.has(g.id));
  for (const l of lines) {
    const text = recNorm(`${l.ref} ${l.description}`);
    const ref = recNorm(l.ref);
    const c = free().filter((g) => {
      if (!same(g.amount, l.amount) || !near(g.date, l.date, 45)) return false;
      const doc = recNorm(g.docNo);
      return (doc.length >= 3 && text.includes(doc)) || (ref.length >= 4 && recNorm(`${g.docNo} ${g.description}`).includes(ref));
    });
    if (c.length === 1) {
      usedL.add(c[0].id);
      usedS.add(l.id);
      out.push({ lineIds: [l.id], ledgerIds: [c[0].id], how: 'reference' });
    }
  }
  for (const l of lines.filter((x) => !usedS.has(x.id))) {
    const c = free().filter((g) => same(g.amount, l.amount) && near(g.date, l.date, matchDays));
    if (c.length !== 1) continue;
    const back = lines.filter((x) => !usedS.has(x.id) && same(x.amount, c[0].amount) && near(x.date, c[0].date, matchDays));
    if (back.length !== 1) continue;
    usedL.add(c[0].id);
    usedS.add(l.id);
    out.push({ lineIds: [l.id], ledgerIds: [c[0].id], how: 'amount_date' });
  }
  // A bank item carried from last month is usually posted late in SQL Account: same amount, posted after it, within 45 days.
  for (const l of lines.filter((x) => !usedS.has(x.id) && (x as { carriedFrom?: string }).carriedFrom)) {
    const c = free().filter((g) => same(g.amount, l.amount) && g.date >= l.date && near(g.date, l.date, 45));
    if (c.length !== 1) continue;
    usedL.add(c[0].id);
    usedS.add(l.id);
    out.push({ lineIds: [l.id], ledgerIds: [c[0].id], how: 'amount_date' });
  }
  for (const l of lines.filter((x) => !usedS.has(x.id))) {
    const byDay = new Map<IsoDate, FinLedgerLine[]>();
    for (const g of free().filter((g) => Math.sign(g.amount) === Math.sign(l.amount) && near(g.date, l.date, matchDays))) byDay.set(g.date, [...(byDay.get(g.date) ?? []), g]);
    const hits = [...byDay.values()].filter((gs) => gs.length > 1 && same(gs.reduce((n, g) => n + g.amount, 0), l.amount));
    if (hits.length !== 1) continue;
    hits[0].forEach((g) => usedL.add(g.id));
    usedS.add(l.id);
    out.push({ lineIds: [l.id], ledgerIds: hits[0].map((g) => g.id), how: 'amount_date' });
  }
  return out;
}

/** What is left after matching, and whether the bank and the books agree once timing items are allowed for. */
/**
 * Why a reconciliation no longer stands, or null. Its statement was replaced after it was run, or the earlier month it
 * carried items from was changed, replaced or itself went stale (review finding, Arisha main, 1 Nov 2026).
 */
export function finBankRecStale(f: FinStatus, rec: FinBankRec): string | null {
  const st = (f.statements ?? []).find((x) => x.id === rec.statementId);
  if (st && (rec.statementVersion ?? 1) !== (st.version ?? 1)) return `the ${rec.period} statement was replaced after this reconciliation was run`;
  const from = rec.carriedFromRec;
  if (!from) return null;
  const prev = (f.bankRecs ?? []).find((x) => x.id === from.id);
  if (!prev || (prev.rev ?? 1) !== from.rev || (prev.statementVersion ?? 1) !== from.statementVersion)
    return `the ${prev?.period ?? 'earlier'} reconciliation it carries items from changed after this one was run`;
  const up = finBankRecStale(f, prev);
  return up ? `it carries items from a reconciliation that no longer stands (${up})` : null;
}

export function finBankRecResult(st: FinStatement, rec: FinBankRec, now: IsoDateTime) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const mL = new Set(rec.pairs.flatMap((p) => p.ledgerIds));
  const mS = new Set(rec.pairs.flatMap((p) => p.lineIds));
  const today = dateOf(now);
  const outstanding = rec.ledger.filter((g) => !mL.has(g.id) && g.amount < 0);
  const inTransit = rec.ledger.filter((g) => !mL.has(g.id) && g.amount > 0);
  const bankOnly = [...(rec.carriedBank ?? []), ...st.lines].filter((l) => !mS.has(l.id) && !same(l.amount, 0));
  const explained = new Map(rec.explained.map((e) => [e.lineId, e]));
  const sum = (xs: { amount: number }[]) => r2(xs.reduce((n, x) => n + x.amount, 0));
  // Bank closing + deposits not yet credited − payments not yet presented = book closing + bank items not yet in the books.
  const adjustedBank = r2(st.closing + sum(inTransit) + sum(outstanding));
  const adjustedBook = r2(rec.ledgerClosing + sum(bankOnly));
  return {
    matchedLines: mS.size,
    lines: st.lines.length + (rec.carriedBank?.length ?? 0),
    outstanding,
    inTransit,
    bankOnly: bankOnly.map((l) => ({ ...l, explained: explained.get(l.id) ?? null })),
    unexplained: bankOnly.filter((l) => !explained.has(l.id)),
    // Payments in the books for more than 60 days but never seen at the bank (stale cheques, failed transfers).
    stale: [...outstanding, ...inTransit].filter((g) => daysBetween(g.date, today) > 60),
    statementClosing: st.closing,
    ledgerClosing: rec.ledgerClosing,
    adjustedBank,
    adjustedBook,
    difference: r2(adjustedBank - adjustedBook),
  };
}

// ---------- The month-end close ----------

export interface FinCloseCheck {
  period: string;
  /** Must be fixed in SQL Account or attached before the close can be prepared or approved. */
  blockers: string[];
  /** Must each be explained before the close is prepared. */
  exceptions: { key: string; text: string; explained: string | null }[];
  /** Approval also needs the bank pack reviewed. */
  bankPackOpen: number;
  /** What Prima confirmed by itself (automation A9, 2 Nov 2026): ticked on the close list so staff work only on the rest. */
  done: string[];
}

export function finCloseCheck(
  f: FinStatus,
  close: FinClose | null,
  period: string,
  now: IsoDateTime,
  s: FinSettingsValues = finDefaults(),
  contracts: Contract[] | null = null,
  /** PWVSB's Finance row, which holds the group's intercompany balances (Fauzan, 2 Nov 2026). */
  group: FinStatus | null = null,
  nameOf: (id: Id) => string = (x) => x,
): FinCloseCheck {
  const fin = RULES.finance.value;
  const end = periodEnd(period);
  const blockers: string[] = [];
  const done: string[] = [];
  if (!f.sqlLastAt || (toMs(now) - toMs(f.sqlLastAt)) / 3_600_000 > fin.staleHours)
    blockers.push(`No figures from SQL Account in the last ${fin.staleHours} hours: the books are Unknown until it sends them.`);
  else done.push(`Figures from SQL Account received in the last ${fin.staleHours} hours`);
  if (!f.closedTo || f.closedTo < end) blockers.push(`Close ${period} in SQL Account first (closed to ${f.closedTo ?? 'never'}).`);
  else done.push(`${period} closed in SQL Account`);
  for (const b of f.banks) {
    // Automatic reconciliation (Fauzan, 1 Nov 2026): a reviewed Prima reconciliation that balances to RM0.00 stands
    // for the SQL Account reconciliation and its report; one that is run but not finished blocks the close.
    const rec = (f.bankRecs ?? []).find((x) => x.bankId === b.id && x.period === period);
    const st = rec ? (f.statements ?? []).find((x) => x.id === rec.statementId) : null;
    const res = rec && st ? finBankRecResult(st, rec, now) : null;
    if (rec && res) {
      const stale = finBankRecStale(f, rec);
      if (stale) blockers.push(`${b.bank} ${b.accountMasked}: run the ${period} reconciliation again (${stale}).`);
      else if (Math.abs(res.difference) >= 0.005) blockers.push(`${b.bank} ${b.accountMasked}: the reconciliation is off by RM${res.difference.toFixed(2)}.`);
      else if (res.unexplained.length) blockers.push(`${b.bank} ${b.accountMasked}: ${res.unexplained.length} bank item(s) not in SQL Account need posting or explaining.`);
      else if (!rec.reviewed) blockers.push(`${b.bank} ${b.accountMasked}: the ${period} reconciliation is waiting for review.`);
      else done.push(`${b.bank} ${b.accountMasked}: reconciled in Prima to RM0.00 and reviewed`);
      continue;
    }
    const recOk = !!b.reconciledTo && b.reconciledTo >= end;
    const refOk = !!close?.bankRecRefs.some((r) => r.bankId === b.id);
    if (!recOk) blockers.push(`${b.bank} ${b.accountMasked} is not reconciled to ${end} in SQL Account.`);
    if (!refOk) blockers.push(`Attach the SQL Account bank reconciliation report for ${b.bank} ${b.accountMasked}, or reconcile it in Prima.`);
    if (recOk && refOk) done.push(`${b.bank} ${b.accountMasked}: reconciled in SQL Account, report attached`);
  }
  // Statement agreement (masterplan item 76, Fauzan 3 Nov 2026): reviewed figures for the month take the place of earlier
  // reported results; FS-11 comes from Prima's own intercompany pairs (each open pair is already its own exception).
  const icGroup = group ?? (f.companyId === GROUP_EMPLOYER_ID ? f : null);
  const fsTests = finFsTests(
    f,
    period,
    icGroup
      ? finIcPairs(icGroup, period)
          .filter((x) => x.a === f.companyId || x.b === f.companyId)
          .map((x) => ({ status: x.status, diff: x.difference ?? 0 }))
      : null,
  );
  for (const id of FIN_ZERO_TESTS) {
    const t = fsTests.find((x) => x.id === id);
    if (!t || t.diff == null) blockers.push(`${id} has not been run.`);
    else if (Math.abs(t.diff) >= 0.005) blockers.push(`${id} ${t.label} is off by RM${t.diff.toFixed(2)}; it must be RM0.00.`);
    else done.push(`${id} ${t.label} at RM0.00`);
  }
  const raw: { key: string; text: string }[] = [];
  const p = f.posting;
  if (p.period === period) {
    if (p.billed - p.billedPosted > 0.5)
      raw.push({ key: 'gap:billed', text: `RM${(p.billed - p.billedPosted).toFixed(2)} billed in Prima not posted as sales invoices` });
    if (p.staffPayPaid && !p.staffPayPosted) raw.push({ key: 'gap:staffpay', text: 'Staff payroll paid but the journal is not posted' });
    if (p.guardPayPaid && !p.guardPayPosted) raw.push({ key: 'gap:guardpay', text: 'Guard payroll paid but the journal is not posted' });
    if (p.supplierBillsUnposted) raw.push({ key: 'gap:supplier', text: `${p.supplierBillsUnposted} supplier bill(s) received but not posted` });
  }
  for (const t of fsTests.filter((x) => !FIN_ZERO_TESTS.includes(x.id))) {
    if (t.na) done.push(`${t.id} ${t.label}: not applicable (${t.na})`);
    else if (t.from === 'intercompany') {
      if (t.diff != null && Math.abs(t.diff) < 0.005) done.push(`${t.id} ${t.label}`);
    } else if (t.diff == null) raw.push({ key: `test:${t.id}`, text: `${t.id} ${t.label} not run` });
    else if (Math.abs(t.diff) >= 0.005) raw.push({ key: `test:${t.id}`, text: `${t.id} ${t.label} off by RM${t.diff.toFixed(2)}` });
    else if (t.from === 'figures') done.push(`${t.id} ${t.label} at RM0.00`);
  }
  // Part 2 (31 Oct 2026): ageing every month, bank statements loaded and every payment seen leaving the bank.
  const ctl = s;
  const age = (f.ageing ?? []).find((x) => x.period === period);
  if (!age) blockers.push(`Record the customer and supplier ageing for ${period} from SQL Account.`);
  else {
    const arDiff = ageTotal(age.ar) - age.glAr;
    const apDiff = ageTotal(age.ap) - age.glAp;
    // Lighter check L2 (Fauzan, 2 Nov 2026): ageing that agrees to the ledger to RM0.00 needs no separate review.
    const agrees = Math.abs(arDiff) < 0.005 && Math.abs(apDiff) < 0.005;
    if (!age.reviewed && !agrees) blockers.push(`The ${period} ageing is waiting for review.`);
    if (agrees) done.push(`Customer and supplier ageing agree to the ledger to RM0.00${age.reviewed ? ' and reviewed' : ' (no review needed)'}`);
    if (Math.abs(arDiff) >= 0.005) raw.push({ key: 'age:ar', text: `Customer ageing differs from the ledger by RM${arDiff.toFixed(2)}` });
    if (Math.abs(apDiff) >= 0.005) raw.push({ key: 'age:ap', text: `Supplier ageing differs from the ledger by RM${apDiff.toFixed(2)}` });
  }
  for (const b of f.banks) {
    const st = (f.statements ?? []).find((x) => x.bankId === b.id && x.period === period);
    if (!st) {
      blockers.push(`Load the ${period} bank statement for ${b.bank} ${b.accountMasked} so payments can be matched.`);
      continue;
    }
    if (!st.lines.some((x) => x.amount < 0 && !x.match)) done.push(`${b.bank} ${b.accountMasked}: statement loaded, every payment out matched or explained`);
    for (const l of st.lines.filter((x) => x.amount < 0 && !x.match))
      raw.push({ key: `stmt:${l.id}`, text: `${b.bank} ${b.accountMasked}: RM${(-l.amount).toFixed(2)} left the bank on ${l.date} with no approved Prima payment (${l.description})` });
  }
  // Check after payment (Fauzan, 1 Nov 2026): every released payment in the month passes Prima's automatic check or the
  // failure is explained before the close.
  for (const p of f.payments ?? []) {
    if (p.status !== 'released' || !p.releasedOn || p.releasedOn.slice(0, 7) !== period) continue;
    const chk = finAfterPayment(f, p, s);
    if (chk.status === 'fail' || chk.status === 'review')
      raw.push({
        key: `afterpay:${p.id}`,
        text: `Check after payment ${chk.status === 'fail' ? 'failed' : 'needs a person to compare'} for ${p.payee} RM${p.amount.toFixed(2)} (${p.id}): ${chk.checks
          .filter((c) => c.ok === false || (c.ok === null && c.key !== 'bank'))
          .map((c) => c.label + (c.detail ? ` (${c.detail})` : ''))
          .join('; ')}`,
      });
  }
  for (const p of f.payments ?? []) {
    if (p.status !== 'released' || p.cleared || !p.releasedOn || p.releasedOn > end) continue;
    if ((toMs(now) - toMs(`${p.releasedOn}T00:00:00+08:00`)) / 86_400_000 >= ctl.unclearedDays)
      raw.push({ key: `uncleared:${p.id}`, text: `${p.payee} RM${p.amount.toFixed(2)} released on ${p.releasedOn} is not on the bank statement` });
  }
  // Regular payments and guarantees (Fauzan, 2 Nov 2026): every due date in the month paid or seen on the statement.
  const regEx = finRegularExceptions(f, period, dateOf(now), ctl);
  raw.push(...regEx);
  if (!regEx.length && (f.regular ?? []).some((r) => r.status === 'active')) done.push('Every regular payment due in the month paid or seen on the statement');
  // Advances, petty cash and company cards (Fauzan, 2 Nov 2026).
  const cashEx = finCashExceptions(f, period, dateOf(now));
  raw.push(...cashEx);
  // Money in (Fauzan, 2 Nov 2026): every contract billed, government claims followed up, money in allocated.
  const inEx = finMoneyInExceptions(f, contracts, period, dateOf(now));
  raw.push(...inEx);
  // Stamp duty (Fauzan, 2 Nov 2026): agreements stamped in time, certificates checked, refunds of cancelled ones followed.
  raw.push(...finStampExceptions(f, dateOf(now)));
  // Daily cash pay (Fauzan, 2 Nov 2026): every list's cash settled, withdrawals on the statement, differences accepted by the FD.
  raw.push(...finDailyCashExceptions(f, period, dateOf(now)));
  // Withholding tax paid to LHDN on time, prepayments and accruals posted (Fauzan, 2 Nov 2026).
  raw.push(...finYearEndExceptions(f, period, dateOf(now)));
  // The biggest suppliers' statements agreed each quarter (Fauzan, 2 Nov 2026: suggestion 11).
  raw.push(...finSupplierStatementExceptions(f, dateOf(now)));
  // Intercompany balances agreed on both sides (Fauzan, 2 Nov 2026).
  raw.push(...finIcExceptions(group ?? (f.companyId === GROUP_EMPLOYER_ID ? f : null), f.companyId, period, nameOf));
  if (contracts && !inEx.some((e) => e.key.startsWith('bill:')) && finBillingDue(contracts, f.companyId, period).length) done.push(`Every contract that ran in ${period} has its invoice in SQL Account, or a checked reason`);
  if (!cashEx.length && ((f.pettyCash ?? []).some((x) => x.status === 'active') || (f.cards ?? []).some((x) => x.status === 'active')))
    done.push('Petty cash counted and agreed, card statements reviewed, no advance overdue');
  // e-Invoice (1 Nov 2026): every sales document validated by LHDN and the consolidated e-Invoice in on time.
  const ei = f.einvoice;
  if (ei?.setup?.required) {
    const ev = RULES.financeEInvoice.value;
    const m = ei.months.find((x) => x.period === period);
    if (!m) blockers.push(`Record the ${period} e-Invoice check from SQL Account (MyInvois Transaction).`);
    else {
      if (!m.reviewed) blockers.push(`The ${period} e-Invoice check is waiting for review.`);
      const open = m.invalid + m.submitting + m.notSubmitted;
      if (open > 0) blockers.push(`${open} sales document(s) for ${period} are not validated by LHDN (invalid ${m.invalid}, stuck ${m.submitting}, not submitted ${m.notSubmitted}).`);
      if (m.consolidatedNeeded && !m.consolidated) blockers.push(`Submit the ${period} consolidated e-Invoice in SQL Account.`);
      const byDay = `${nextMonthDay(period, ev.consolidateByDay)}`;
      if (m.consolidated && m.consolidated.submittedOn > byDay)
        raw.push({ key: 'einv:late', text: `The consolidated e-Invoice was submitted on ${m.consolidated.submittedOn}, after ${byDay}` });
      if (m.largeInConsolidated > 0)
        raw.push({ key: 'einv:large', text: `${m.largeInConsolidated} sale(s) above RM${ev.singleTxnMax.toLocaleString('en-MY')} went into the consolidated e-Invoice instead of their own` });
      if (m.selfBilledValid < m.selfBilledNeeded)
        raw.push({ key: 'einv:self', text: `${m.selfBilledNeeded - m.selfBilledValid} self-billed e-Invoice(s) not issued (foreign suppliers, agents)` });
      if (m.suppliersWithout > 0) raw.push({ key: 'einv:supp', text: `${m.suppliersWithout} supplier invoice(s) posted with no validated e-Invoice (proof of expense for tax)` });
      if (m.lateCancels > 0) raw.push({ key: 'einv:cancel', text: `${m.lateCancels} e-Invoice(s) cancelled after 72 hours instead of a credit note` });
    }
  }
  // Invoice problems (1 Nov 2026): every invoice unpaid 90+ days has a case, and every case is followed up.
  for (const c of f.arCases ?? [])
    for (const r of c.receipts ?? [])
      if (!r.matched && r.on <= end && (toMs(now) - toMs(`${r.on}T00:00:00+08:00`)) / 86_400_000 >= ctl.unclearedDays)
        raw.push({ key: `receipt:${r.id}`, text: `Customer receipt RM${r.amount.toFixed(2)} (${r.ref}) for invoice ${c.invoiceNo}, recorded by ${r.by} for ${r.on}, is not on the bank statement` });
  for (const c of (f.arCases ?? []).filter((x) => finArStale(x, now)))
    raw.push({ key: `ar:stale:${c.id}`, text: `Invoice ${c.invoiceNo} (${c.customer}, RM${c.outstanding.toFixed(2)} unpaid) has had no follow-up for ${RULES.financeReceivables.value.followUpDays} days or is past its follow-up date` });
  if (age) {
    const covered = (f.arCases ?? []).filter(finArActive).reduce((n, c) => n + c.outstanding, 0);
    const gap = Math.round((age.ar.over90 - covered) * 100) / 100;
    if (gap >= 0.005) raw.push({ key: 'ar:uncovered', text: `RM${gap.toFixed(2)} of customer invoices over 90 days has no invoice case (wrong payer, dispute, refusal or bad debt)` });
  }
  const exceptions = raw.map((e) => ({ ...e, explained: close?.explanations.find((x) => x.key === e.key)?.text ?? null }));
  const bankPackOpen = finPackItems(f, 'bank', period, s).filter((i) => i.period === period && i.status !== 'reviewed' && i.status !== 'sent').length;
  return { period, blockers, exceptions, bankPackOpen, done };
}

/**
 * Customer receipts checked on the bank statement (Fauzan, 1 Nov 2026: "create a system that automatically check with
 * bank statements to verify it"). Every receipt recorded on an invoice case waits until Prima finds money in on the
 * loaded statement of the account it was paid into: the same amount, within the matching days, a reference on the line
 * if more than one fits. Only then does the unpaid amount go down. Nobody confirms a receipt by hand.
 */
export function finMatchReceipts(statements: FinStatement[], cases: FinArCase[], matchDays: number, at: IsoDateTime) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let matched = 0;
  const out = cases.map((c) => {
    if (!c.receipts?.some((r) => !r.matched)) return c;
    let outstanding = c.outstanding;
    const receipts = c.receipts.map((r) => {
      if (r.matched) return r;
      const cands: { st: (typeof sts)[number]; i: number }[] = [];
      for (const st of sts)
        if (st.bankId === r.bankId)
          st.lines.forEach((l, i) => {
            if (!l.match && l.amount > 0 && Math.abs(l.amount - r.amount) < 0.005 && Math.abs(daysBetween(l.date, r.on)) <= matchDays) cands.push({ st, i });
          });
      const ref = norm(r.ref);
      const byRef = ref.length >= 4 ? cands.filter(({ st, i }) => norm(`${st.lines[i].ref} ${st.lines[i].description}`).includes(ref)) : [];
      const pick = byRef.length === 1 ? byRef[0] : byRef.length === 0 && cands.length === 1 ? cands[0] : null;
      if (!pick) return r;
      const line = pick.st.lines[pick.i];
      pick.st.lines[pick.i] = { ...line, match: { kind: 'receipt', caseId: c.id, receiptId: r.id, by: 'Prima (automatic)', at } };
      outstanding = Math.round(Math.max(0, outstanding - r.amount) * 100) / 100;
      matched += 1;
      return { ...r, matched: { statementId: pick.st.id, lineId: line.id, date: line.date } };
    });
    const recovered = outstanding <= 0.005 && c.status === 'open';
    return {
      ...c,
      receipts,
      outstanding,
      status: recovered ? ('recovered' as const) : c.status,
      log: receipts
        .filter((r, i) => r.matched && !c.receipts![i].matched)
        .reduce((log, r) => [...log, { kind: 'payment', text: `RM${r.amount.toFixed(2)} (${r.ref}) found on the bank statement ${r.matched!.date}`, by: 'Prima (automatic)', byId: 'prima:auto', at }], c.log),
    };
  });
  return { statements: sts, cases: out, matched };
}

/** Takes back receipts matched to a statement that is replaced or a line that is unmatched; the unpaid amount goes back up. */
export function finUnmatchReceipts(cases: FinArCase[], hit: (m: { statementId: Id; lineId: Id }) => boolean) {
  return cases.map((c) => {
    const back = (c.receipts ?? []).filter((r) => r.matched && hit(r.matched));
    if (!back.length) return c;
    const add = back.reduce((n, r) => n + r.amount, 0);
    return {
      ...c,
      outstanding: Math.round(Math.min(c.amount, c.outstanding + add) * 100) / 100,
      status: c.status === 'recovered' ? ('open' as const) : c.status,
      receipts: c.receipts!.map((r) => (back.includes(r) ? { ...r, matched: null } : r)),
    };
  });
}

export function finArActive(c: FinArCase): boolean {
  return ['open', 'reissue_pending', 'provision_pending', 'writeoff_pending'].includes(c.status);
}
/** An active case with no follow-up for 30 days, or past the follow-up date the team set. */
export function finArStale(c: FinArCase, now: IsoDateTime): boolean {
  if (!finArActive(c)) return false;
  const last = [c.opened.at, ...c.log.map((l) => l.at)].sort().pop()!;
  const today = dateOf(now);
  return (toMs(now) - toMs(last)) / 86_400_000 > RULES.financeReceivables.value.followUpDays || (!!c.nextOn && c.nextOn < today && last.slice(0, 10) < c.nextOn);
}

export function ageTotal(b: { current: number; d1to30: number; d31to60: number; d61to90: number; over90: number }): number {
  return Math.round((b.current + b.d1to30 + b.d31to60 + b.d61to90 + b.over90) * 100) / 100;
}

function lastBy(steps: FinStep[], kinds: FinStep['step'][]): FinStep | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].step === 'reopened' || steps[i].step === 'returned') return null;
    if (kinds.includes(steps[i].step)) return steps[i];
  }
  return null;
}
/** The preparer of the current round (after the last return or reopening). */
const preparerOf = (steps: FinStep[]) => lastBy(steps, ['prepared', 'resubmitted']);
const reviewerOf = (steps: FinStep[]) => lastBy(steps, ['reviewed']);
const approverOf = (steps: FinStep[]) => lastBy(steps, ['approved']);
/** For a payment, the person who first raised it stays its preparer after a return. */
function paymentPreparers(p: FinPayment): Id[] {
  return [...new Set(p.steps.filter((s) => s.step === 'prepared' || s.step === 'resubmitted').map((s) => s.byId))];
}

// ---------- Check after payment (Fauzan, 1 Nov 2026) ----------

export type FinAfterPaymentCheck = { key: string; label: string; ok: boolean | null; detail: string };
/**
 * Fauzan, 1 Nov 2026: "automate a system that checks all the required [items] with the data submitted and the data
 * proven, like the bank statement". Every released payment is checked again, by Prima and not by a person, against its
 * own record (approvals, separation of duties, documents, the payee check at release) and against the bank statement
 * line that shows the money leaving. `ok: null` means the proof is not in yet (no statement line matched).
 */
export function finAfterPayment(f: FinStatus, p: FinPayment, s: FinSettingsValues = finDefaults()): { status: 'pass' | 'fail' | 'review' | 'waiting'; checks: FinAfterPaymentCheck[] } {
  const checks: FinAfterPaymentCheck[] = [];
  const add = (key: string, label: string, ok: boolean | null, detail = '') => checks.push({ key, label, ok, detail });
  const preparers = paymentPreparers(p);
  const reviewer = reviewerOf(p.steps);
  const approver = approverOf(p.steps);
  const releaser = lastBy(p.steps, ['released']);
  add(
    'approvals',
    'Reviewed and approved by two other people, each with a comment',
    !!reviewer && !!approver && !preparers.includes(reviewer.byId) && !preparers.includes(approver.byId) && reviewer.byId !== approver.byId && !!reviewer.comment.trim() && !!approver.comment.trim(),
    !reviewer || !approver ? 'a review or an approval is missing' : '',
  );
  add(
    'release',
    'Released by someone who did not prepare or approve it',
    !!releaser && !preparers.includes(releaser.byId) && releaser.byId !== approver?.byId,
    releaser ? '' : 'no release recorded',
  );
  if (approver && p.releasedOn) add('order', 'Released on or after the day it was approved', p.releasedOn >= dateOf(approver.at), `approved ${dateOf(approver.at)}, released ${p.releasedOn}`);
  if (p.expiresOn) add('lapse', 'Released before the approval lapsed', !!p.releasedOn && p.releasedOn < p.expiresOn, `approval valid until ${p.expiresOn}`);
  add('evidence', 'Supporting document attached', p.evidence.length > 0);
  const rejected = p.external?.decisions.find((d) => d.decision === 'rejected');
  if (p.external) add('external', 'No rejection in the linked Teams or SharePoint approval', !rejected, rejected ? `${rejected.approver}: ${rejected.comment}` : '');
  if (p.payeeId)
    add(
      'payee',
      'The bank portal showed the verified payee account at release',
      !!p.releaseCheck && !!p.payeeBank && p.releaseCheck.accountLast4 === p.payeeBank.accountLast4,
      p.releaseCheck ? `portal: ****${p.releaseCheck.accountLast4} ${p.releaseCheck.accountName}` : 'no portal check recorded',
    );
  if (p.payeeKind === 'supplier') add('einvoice', "Supplier's e-Invoice reference recorded", !!p.eInvoiceRef, p.eInvoiceRef ? '' : 'no e-Invoice UUID on the payment');
  // The bank statement is the proof that the money left as approved.
  const st = p.cleared ? (f.statements ?? []).find((x) => x.id === p.cleared!.statementId) : null;
  const line = st?.lines.find((l) => l.id === p.cleared!.lineId);
  if (!p.cleared) add('bank', 'Seen leaving the bank on the statement', null, 'waiting for the bank statement');
  else if (!st || !line) add('bank', 'Seen leaving the bank on the statement', false, 'the matched statement line is no longer on the loaded statement');
  else {
    const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ref = norm(p.bankRef ?? '');
    add('bank', 'Seen leaving the bank on the statement', true, `${line.date} ${line.description}`);
    add('bankAccount', 'Paid from the approved bank account', st.bankId === p.bankId);
    // Insider test (1 Nov 2026): the releaser types the payee's verified account into Prima, but the bank portal could
    // pay someone else. The statement line normally shows who was paid: the verified account name must be on it, or a
    // person compares the two before the close.
    if (p.payeeBank) {
      const want = norm(p.payeeBank.accountName);
      const head = want.slice(0, Math.min(want.length, 10));
      const seen = norm(line.description);
      add(
        'bankPayee',
        "The statement shows the verified payee's name",
        head.length >= 3 && seen.includes(head) ? true : null,
        seen.includes(head) ? '' : `statement says "${line.description}", verified name ${p.payeeBank.accountName}: a person must compare them`,
      );
    }
    add('bankAmount', 'The bank took exactly the approved amount', Math.abs(line.amount + p.amount) < 0.005, `bank RM${(-line.amount).toFixed(2)}, approved RM${p.amount.toFixed(2)}`);
    const gap = p.releasedOn ? Math.abs(daysBetween(p.releasedOn, line.date)) : 999;
    add('bankDate', 'The bank date agrees with the release date', gap <= Math.max(3, s.matchDays), `released ${p.releasedOn}, bank ${line.date}`);
    // Review finding (Arisha main, 1 Nov 2026): containment let a reference "1" match "BANK-REFERENCE-123456". Only an
    // exact match of the whole reference, or of one whole word of the bank's description, passes; a partial or short
    // match is ambiguous and waits for a person to compare; no overlap at all fails.
    const lineRef = norm(line.ref);
    const words = [lineRef, ...line.description.split(/\s+/).map(norm)].filter(Boolean);
    const exact = ref.length >= 4 && words.includes(ref);
    const partial = !!ref && words.some((w) => w.includes(ref) || ref.includes(w));
    add(
      'bankRef',
      "The bank's reference agrees with the one recorded at release",
      exact ? true : partial ? null : false,
      `recorded ${p.bankRef || '(none)'}, bank ${line.ref || '(none)'}${!exact && partial ? ': only partly the same, a person must compare them' : ''}`,
    );
  }
  // 'review': the proof is in but ambiguous, so a person compares it; 'waiting': the statement is not loaded yet.
  const status = checks.some((c) => c.ok === false) ? 'fail' : checks.some((c) => c.ok === null && c.key !== 'bank') ? 'review' : checks.some((c) => c.ok === null) ? 'waiting' : 'pass';
  return { status, checks };
}

// ---------- Teams and SharePoint approvals (Fauzan, 31 Oct 2026) ----------

const APPROVAL_HOSTS = ['sharepoint.com', 'teams.microsoft.com', 'teams.cloud.microsoft', 'approvals.teams.microsoft.com'];

/**
 * A link to the request in SharePoint or the approval in Teams, with each approver's decision as shown there. Every
 * decision carries the approver's comment, approve or reject (the group's approval rule).
 */
export function parseExternalApproval(user: User, input: Record<string, unknown>, now: IsoDateTime) {
  const system = input.system === 'teams' || input.system === 'sharepoint' ? input.system : null;
  if (!system) throw new BadRequest('Say whether the approval is in Teams or SharePoint.');
  const url = text(input.url, 'The link', 10, 1000);
  let host = '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('not https');
    host = u.hostname.toLowerCase();
  } catch {
    throw new BadRequest('The link must be an https address copied from SharePoint or Teams.');
  }
  if (!APPROVAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
    throw new BadRequest('Only links to SharePoint (sharepoint.com) or Microsoft Teams can be linked as approvals.');
  const requestRef = noSecrets(text(input.requestRef, 'The request number or title', 2, 120), 'The request number');
  const raw = Array.isArray(input.decisions) ? input.decisions : [];
  if (raw.length > 10) throw new BadRequest('At most 10 approvers.');
  const decisions = raw.map((d, i) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const decision: 'approved' | 'rejected' | null = o.decision === 'approved' || o.decision === 'rejected' ? o.decision : null;
    if (!decision) throw new BadRequest(`Approver ${i + 1}: approved or rejected?`);
    const comment = typeof o.comment === 'string' ? o.comment.trim() : '';
    if (!comment) throw new BadRequest(`Approver ${i + 1} has no comment. Every approver comments, approve or reject; ask them to add one in Teams.`);
    return {
      approver: text(o.approver, `Approver ${i + 1}'s name`, 2, 120),
      decision,
      comment: comment.slice(0, 500),
      decidedOn: isoDate(o.decidedOn, `Approver ${i + 1}'s date`),
    };
  });
  const out: FinExternalApproval = { system, url, requestRef, decisions, recordedBy: user.name, recordedById: user.id, recordedAt: now };
  return out;
}

// ---------- The service ----------

export interface FinPaymentInput {
  payeeId?: unknown;
  payee?: unknown;
  payeeKind?: unknown;
  purpose?: unknown;
  amount?: unknown;
  dueOn?: unknown;
  bankId?: unknown;
  sqlRef?: unknown;
  evidence?: unknown;
  eInvoiceRef?: unknown;
  subject?: unknown;
  budgetLine?: unknown;
  /** An approved payment request from the company head (Fauzan, 1 Nov 2026). */
  requestId?: unknown;
  /** A due date on the regular payments list (Fauzan, 2 Nov 2026). */
  regularId?: unknown;
  regularPeriod?: unknown;
  /** A posted Procurement purchase whose three-way match passed (suggestion 10). */
  purchaseId?: unknown;
  /** Approved in Prima or in Teams, one only, chosen when prepared (Fauzan, 2 Nov 2026: "In both. But can use one for an approval"). */
  approvalMethod?: unknown;
  /** The supplier's own invoice number, and why it is not a duplicate when Prima finds a similar payment (2 Nov 2026). */
  invoiceNo?: unknown;
  notDuplicate?: unknown;
}

/** Procurement purchases ready for Finance to pay (Fauzan, 2 Nov 2026: suggestion 10, three-way match). */
export function finPurchasesToPay(f: FinStatus, purs: PurRequest[], sups: PurSupplier[]) {
  const live = new Set((f.payments ?? []).filter((p) => p.purchaseId && !['cancelled', 'returned'].includes(p.status)).map((p) => p.purchaseId));
  return purs
    .filter((r) => r.companyId === f.companyId && r.status === 'posted' && r.match?.ok && r.invoice && !live.has(r.id))
    .map((r) => {
      const sup = sups.find((x) => x.id === r.chosenSupplierId);
      const last4 = (sup?.bank.account ?? '').replace(/\D/g, '').slice(-4);
      return {
        id: r.id,
        ref: r.ref,
        title: r.title,
        supplier: sup?.name ?? '',
        amount: r.invoice!.amount,
        invoiceNo: r.invoice!.number,
        sqlRef: r.posted?.sqlRef ?? '',
        postedAt: r.posted?.at ?? null,
        payeeId: (f.payees ?? []).find((p) => p.status !== 'blocked' && p.accountLast4 === last4 && last4)?.id ?? null,
        accountLast4: last4,
      };
    });
}

export type FinPaymentAction = 'review' | 'approve' | 'return' | 'resubmit' | 'release' | 'cancel' | 'link';
export type FinCloseAction = 'evidence' | 'explain' | 'prepare' | 'review' | 'approve' | 'return' | 'reopen';

/** What a resubmission changed, for the step history (Arisha main's review, 2 Nov 2026). */
export function finPaymentChanges(
  p: Pick<FinPayment, 'payeeId' | 'payee' | 'purpose' | 'amount' | 'dueOn' | 'bankId' | 'sqlRef' | 'evidence' | 'invoiceNo' | 'subject' | 'budgetLine'>,
  n: Pick<FinPayment, 'payeeId' | 'payee' | 'purpose' | 'amount' | 'dueOn' | 'bankId' | 'sqlRef' | 'evidence' | 'invoiceNo' | 'subject' | 'budgetLine'>,
) {
  const out: string[] = [];
  if (p.payeeId !== n.payeeId) out.push(`payee ${p.payee} to ${n.payee}`);
  if (Math.abs(p.amount - n.amount) >= 0.005) out.push(`amount RM${p.amount.toFixed(2)} to RM${n.amount.toFixed(2)}`);
  if (p.purpose !== n.purpose) out.push(`purpose "${p.purpose}" to "${n.purpose}"`);
  if (p.dueOn !== n.dueOn) out.push(`due ${p.dueOn} to ${n.dueOn}`);
  if (p.bankId !== n.bankId) out.push('bank account');
  if (p.sqlRef !== n.sqlRef) out.push(`SQL Account ${p.sqlRef} to ${n.sqlRef}`);
  if ((p.invoiceNo ?? null) !== (n.invoiceNo ?? null)) out.push(`invoice ${p.invoiceNo ?? '-'} to ${n.invoiceNo ?? '-'}`);
  if ((p.subject ?? 'finance') !== (n.subject ?? 'finance')) out.push(`subject ${p.subject ?? 'finance'} to ${n.subject}`);
  if ((p.budgetLine ?? null) !== (n.budgetLine ?? null)) out.push(`budget line ${p.budgetLine ?? '-'} to ${n.budgetLine ?? '-'}`);
  const docs = n.evidence.filter((e) => !p.evidence.includes(e));
  if (docs.length) out.push(`documents added: ${docs.join(', ')}`);
  return out;
}

export class FinanceDeskService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    /** Whether the Teams approval connection is switched on (API: TEAMS_APPROVALS_READ=true; off by default). */
    private teamsApprovals = false,
  ) {}

  private now(): IsoDateTime {
    return this.clock();
  }
  private today(): IsoDate {
    return dateOf(this.clock());
  }
  private prevPeriod(period: string): string {
    const [y, m] = period.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  /** The month being closed: last month. */
  closePeriod(): string {
    return this.prevPeriod(this.today().slice(0, 7));
  }

  actor(user: User): FinActor {
    const a = finActor(user);
    if (!a) throw new AccessDenied('view', '(finance)');
    return a;
  }

  async companies(user: User): Promise<Id[]> {
    return tenantCompanyIds(user, await this.store.list('grants'), this.today());
  }

  /** The group Finance settings in force (Fauzan, 1 Nov 2026: the Finance Director sets them). */
  async settings(store: Store = this.store): Promise<FinSettingsValues> {
    return finSettingsOf(await store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`));
  }

  /** What is set, by whom, and the defaults, for the Finance settings screen. Every Finance person may read them. */
  async settingsView(user: User) {
    const a = this.actor(user);
    const row = await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
    return {
      values: finSettingsOf(row),
      defaults: finDefaults(),
      limits: FIN_SETTING_LIMITS,
      set: row?.settings?.set ?? null,
      history: (row?.settings?.history ?? []).slice(-12),
      canSet: isLead(a),
      /** Which team handles each company (Fauzan, 2 Nov 2026: the FD decides, it changes every year). */
      teams: isLead(a)
        ? await (async () => {
            const nameOf = await this.companyNamer();
            return (await this.store.list('finStatus', { companyId: await this.companies(user) }))
              .map((f) => ({ companyId: f.companyId, name: nameOf(f.companyId), team: f.team }))
              .sort((x, y) => x.name.localeCompare(y.name));
          })()
        : [],
      /** P78: companies with no Finance books yet; the Finance Director or the CEO starts them. */
      noBooks: isLead(a)
        ? await (async () => {
            const ids = await this.companies(user);
            const [rows, companies] = await Promise.all([this.store.list('finStatus', { companyId: ids }), this.store.list('companies', { id: ids })]);
            return companies
              .filter((c) => !rows.some((f) => f.companyId === c.id))
              .map((c) => ({ companyId: c.id, name: c.name }))
              .sort((x, y) => x.name.localeCompare(y.name));
          })()
        : [],
      /** Whether payments may be set to be approved in Teams (the connection is switched on). */
      teamsReady: this.teamsApprovals,
    };
  }

  /** The Finance Director (or the CEO) changes group Finance settings, with a comment; every change is kept. */
  async setSettings(user: User, input: Record<string, unknown>) {
    return this.store.transaction(async (tx) => {
      const a = this.actor(user);
      if (!isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO sets Finance settings)');
      const id = `fin-${GROUP_EMPLOYER_ID}`;
      await tx.lock?.('finStatus', id);
      const row = await tx.get('finStatus', id);
      if (!row) throw new NotFound('Group Finance settings');
      const comment = requireComment(input.comment, 'change the settings (why)');
      const raw = (input.values ?? {}) as Record<string, unknown>;
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequest('Send the settings as an object.');
      const next: Partial<FinSettingsValues> = { ...(row.settings?.values ?? {}) };
      const changed: string[] = [];
      const teamMoves: { id: Id; team: number }[] = [];
      for (const [k, v] of Object.entries(raw)) {
        if (k === 'teams') {
          // Fauzan, 2 Nov 2026: the FD decides which team handles which company; it changes every year.
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('Send the teams as company: team.');
          const ids = await this.companies(user);
          for (const [cid, t] of Object.entries(v as Record<string, unknown>)) {
            const team = Number(t);
            if (!ids.includes(cid)) throw new NotFound('Company books');
            if (!Number.isInteger(team) || team < 1 || team > FIN_TEAMS) throw new BadRequest(`Team: a number from 1 to ${FIN_TEAMS}.`);
            teamMoves.push({ id: `fin-${cid}`, team });
          }
          continue;
        }
        if (k === 'approvalMethod') {
          if (v !== 'prima' && v !== 'teams') throw new BadRequest("Approve payments in: choose 'prima' or 'teams'.");
          if (v === 'teams' && !this.teamsApprovals)
            throw new BadRequest('The Teams approval connection is not switched on yet, so payments stay approved in Prima.');
          next.approvalMethod = v;
          changed.push(`payments approved in ${v === 'teams' ? 'Teams' : 'Prima'}`);
          continue;
        }
        if (k === 'selfBilledBy') {
          const t = text(v, 'Who issues self-billed e-Invoices', 3, 200);
          next.selfBilledBy = t;
          changed.push(`self-billed by ${t}`);
          continue;
        }
        const lim = FIN_SETTING_LIMITS[k as keyof typeof FIN_SETTING_LIMITS];
        if (!lim) throw new BadRequest(`Unknown setting ${k}.`);
        const n = typeof v === 'number' ? v : Number(v);
        const whole = !['varianceMinRm', 'sstThreshold', 'variancePct', 'pettyVoucherMax', 'pettyFloatMax'].includes(k);
        if (!Number.isFinite(n) || n < lim[0] || n > lim[1] || (whole && !Number.isInteger(n)))
          throw new BadRequest(`${lim[2]}: give ${whole ? 'a whole number' : 'a number'} from ${lim[0]} to ${lim[1]}.`);
        (next as Record<string, number>)[k] = n;
        changed.push(`${lim[2]} ${n}`);
      }
      for (const m of teamMoves) {
        await tx.lock?.('finStatus', m.id);
        const f = await tx.get('finStatus', m.id);
        if (!f) throw new NotFound('Company books');
        if (f.team === m.team) continue;
        await tx.update('finStatus', m.id, { team: m.team });
        changed.push(`${f.companyId} from team ${f.team} to team ${m.team}`);
      }
      if (!changed.length) throw new BadRequest('Nothing to change.');
      if (teamMoves.length && !Object.keys(raw).some((k) => k !== 'teams')) {
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'finance.teams.set', entity: 'fin_status', entityId: id, summary: `Finance teams changed: ${changed.join('; ')}. ${comment}`.slice(0, 900) });
        return finSettingsOf(row);
      }
      const set = { by: user.name, byId: user.id, at: this.now(), comment };
      const settings = { values: next, set, history: [...(row.settings?.history ?? []), ...(row.settings ? [{ values: row.settings.values, set: row.settings.set }] : [])].slice(-50) };
      await tx.update('finStatus', id, { settings });
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'finance.settings.set', entity: 'fin_status', entityId: id, summary: `Finance settings changed: ${changed.join('; ')}. ${comment}`.slice(0, 900) });
      return finSettingsOf({ settings });
    });
  }

  /**
   * P78: add a company bank account to its Finance record (the team leader, the Finance Director or the CEO). Only the
   * last four digits are kept. Balances, the reconciliation date and open items come from SQL Account and the bank
   * statements afterwards; until then the account shows as never reconciled.
   */
  async addBankAccount(user: User, companyId: Id, input: Record<string, unknown>): Promise<FinBankAccount> {
    return this.store.transaction(async (tx) => {
      const a = this.actor(user);
      if (!(isLead(a) || a.kind === 'leader')) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO adds a bank account)');
      const f = await this.row(tx, user, a, companyId);
      const bank = noSecrets(text(input.bank, 'Bank', 2, 60), 'Bank');
      const last4 = typeof input.last4 === 'string' ? input.last4.replace(/\s/g, '') : '';
      if (!/^\d{4}$/.test(last4)) throw new BadRequest('Give the last 4 digits of the account number (only those are kept).');
      const purpose = (['operating', 'payroll', 'collection'] as const).find((p) => p === input.purpose);
      if (!purpose) throw new BadRequest('Say what the account is for: operating, payroll or collection.');
      const accountMasked = `****${last4}`;
      if (f.banks.some((b) => b.bank.toLowerCase() === bank.toLowerCase() && b.accountMasked === accountMasked)) throw new BadRequest('That account is already on the list.');
      let n = f.banks.length + 1;
      while (f.banks.some((b) => b.id === `fb-${f.companyId}-${n}`)) n += 1;
      const acct: FinBankAccount = { id: `fb-${f.companyId}-${n}`, bank, accountMasked, purpose, glBalance: 0, statementBalance: 0, reconciledTo: null, openItems: 0 };
      await tx.update('finStatus', f.id, { banks: [...f.banks, acct] });
      await this.log(tx, user, f, 'finance.bank.added', `Bank account ${bank} ${accountMasked} (${purpose}) added to the books.`);
      return acct;
    });
  }

  /**
   * P78: start the Finance books for a company that has none yet (one added after go-live), so its payments, checks and
   * month-end close can be kept. The Finance Director or the CEO chooses the team and the financial year end; the rest
   * starts empty and shows Unknown until SQL Account figures arrive.
   */
  async startBooks(user: User, companyId: Id, input: Record<string, unknown>): Promise<FinStatus> {
    return this.store.transaction(async (tx) => {
      const a = this.actor(user);
      if (!isLead(a)) throw new AccessDenied('view', "(the Finance Director or the CEO starts a company's books)");
      if (typeof companyId !== 'string' || companyId.length > 120 || !(await this.companies(user)).includes(companyId)) throw new NotFound('Company');
      const co = await tx.get('companies', companyId);
      if (!co) throw new NotFound('Company');
      const id = `fin-${companyId}`;
      await tx.lock?.('finStatus', id);
      if (await tx.get('finStatus', id)) throw new BadRequest('This company already has Finance books.');
      const team = Number(input.team);
      if (!Number.isInteger(team) || team < 1 || team > FIN_TEAMS) throw new BadRequest(`Team: a number from 1 to ${FIN_TEAMS}.`);
      const fyEnd = typeof input.fyEnd === 'string' ? input.fyEnd.trim() : '';
      const m = /^(\d{2})-(\d{2})$/.exec(fyEnd);
      const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > days[Number(m[1]) - 1])
        throw new BadRequest('Financial year end: the month and day, such as 12-31.');
      const f: FinStatus = {
        id,
        companyId,
        team,
        fyEnd,
        sqlLastAt: null,
        closedTo: null,
        banks: [],
        posting: { period: this.closePeriod(), billed: 0, billedPosted: 0, staffPayPaid: false, staffPayPosted: false, guardPayPaid: false, guardPayPosted: false, supplierBillsUnposted: 0 },
        tests: Object.entries(FIN_FS_LABELS).map(([tid, label]) => ({ id: tid, label, diff: null })),
        arOver90: 0,
        apOverdue: 0,
        audit: [],
        tax: [],
      };
      await tx.insert('finStatus', f);
      await this.log(tx, user, f, 'finance.books.started', `Finance books started for ${co.name}: Team ${team}, year ends ${fyEnd}.`);
      return f;
    });
  }

  /** Locks and reads one company's finance row, checking the person may act on it. */
  async row(tx: Store, user: User, a: FinActor, companyId: Id): Promise<FinStatus> {
    if (typeof companyId !== 'string' || companyId.length > 120) throw new NotFound('Company books');
    if (!(await this.companies(user)).includes(companyId)) throw new NotFound('Company books');
    await tx.lock?.('finStatus', `fin-${companyId}`);
    const f0 = await tx.get('finStatus', `fin-${companyId}`);
    if (!f0 || (a.team != null && f0.team !== a.team)) throw new NotFound('Company books');
    if (!actsOn(a, f0)) throw new AccessDenied('view', '(finance: view only)');
    // Lapsed approvals go back to the preparer by themselves; saved and logged the first time anyone acts on the books.
    const { f, lapsed } = finApplyLapses(f0, this.today(), await this.settings(tx), this.now());
    if (lapsed.length) {
      await tx.update('finStatus', f.id, { payments: f.payments, ...(f.requests ? { requests: f.requests } : {}) });
      for (const p of lapsed)
        await tx.audit({ at: this.now(), actor: FIN_AUTO.by, companyId: f.companyId === GROUP_EMPLOYER_ID ? null : f.companyId, action: 'finance.payment.lapsed', entity: 'fin_status', entityId: f.id, summary: `Payment ${p.id} to ${p.payee} RM${p.amount.toFixed(2)}: ${p.steps[p.steps.length - 1].comment}` });
    }
    return f;
  }

  private step(user: User, step: FinStep['step'], comment: string): FinStep {
    return { step, by: user.name, byId: user.id, at: this.now(), comment };
  }

  async log(tx: Store, user: User, f: FinStatus, action: string, summary: string) {
    await tx.audit({
      at: this.now(),
      actor: user.name,
      companyId: f.companyId === GROUP_EMPLOYER_ID ? null : f.companyId,
      action,
      entity: 'fin_status',
      entityId: f.id,
      summary,
    });
  }

  /** Company names for messages (the group employer by its central name). */
  async companyNamer(store: Store = this.store): Promise<(id: Id) => string> {
    const companies = await store.list('companies');
    return (id: Id) => centralEmployerName(id) ?? companies.find((c) => c.id === id)?.name ?? id;
  }

  // ----- Read -----

  /** Payments, the close and the bank and payment packs for every company the person sees. */
  async desk(user: User) {
    const a = this.actor(user);
    const ids = await this.companies(user);
    const [rows, companies, s, contracts] = await Promise.all([this.store.list('finStatus', { companyId: ids }), this.store.list('companies', { id: ids }), this.settings(), ids.length ? this.store.list('contracts', { companyId: ids }) : Promise.resolve([])]);
    const purs = ids.length ? await this.store.list('purRequests', { companyId: ids }) : [];
    const sups = ids.length ? await this.store.list('purSuppliers', { companyId: ids }) : [];
    const now = this.now();
    const today = this.today();
    const period = this.closePeriod();
    const nameOf = (id: Id) => centralEmployerName(id) ?? companies.find((c) => c.id === id)?.name ?? id;
    const group = rows.find((f) => f.companyId === GROUP_EMPLOYER_ID) ?? (await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`));
    const icName = await this.companyNamer();
    const mine = rows.filter((f) => a.team == null || f.team === a.team);
    const out = mine
      .map((f0) => {
        const f = finApplyLapses(f0, today, s, now).f;
        const close = (f.closes ?? []).find((c) => c.period === period) ?? null;
        const acts = actsOn(a, f);
        const payments = (f.payments ?? [])
          .filter((p) => !['released', 'cancelled'].includes(p.status) || daysBetween(p.steps[p.steps.length - 1].at.slice(0, 10), today) <= 60)
          .map((p) => ({
            ...p,
            bank: f.banks.find((b) => b.id === p.bankId) ?? null,
            expiresOn: this.expiresOn(p, s),
            budget: finBudgetCheck(f, p),
            watch: finPaymentWatch(p),
            may: acts ? this.paymentMay(user, a, f, p, s) : [],
            // Bank mandate (2 Nov 2026): who on the account's mandate may be named as the second approver at release.
            mandate: (() => {
              const m = p.status === 'approved' ? finMandateOf(f, p.bankId) : null;
              return m ? { id: m.id, rule: m.rule, twoAbove: m.twoAbove, approvers: m.people.filter((x) => x.role !== 'portal_maker' && x.userId).map((x) => ({ userId: x.userId!, name: x.name, limit: x.limit })) } : null;
            })(),
          }));
        const check = finCloseCheck(f, close, period, now, s, contracts.filter((c) => c.companyId === f.companyId), group, icName);
        return {
          companyId: f.companyId,
          companyName: nameOf(f.companyId),
          team: f.team,
          banks: f.banks.map((b: FinBankAccount) => ({ id: b.id, bank: b.bank, accountMasked: b.accountMasked, purpose: b.purpose })),
          payments,
          close: { period, record: close, status: close?.status ?? 'open', check, may: acts ? this.closeMay(user, a, close, check) : [] },
          bank: finPackItems(f, 'bank', period, s, now).filter((i) => i.period === period),
          payment: finPackItems(f, 'payment', period, s, now).filter((i) => i.period === period),
          monthly: finPackItems(f, 'monthly', period, s, now).filter((i) => i.period === period),
          payees: (f.payees ?? []).map((x) => ({ id: x.id, name: x.name, kind: x.kind, status: x.status, bank: x.bank, accountLast4: x.accountLast4 })),
          cash: finCashNeed(f, today),
          // Purchases ready to pay (suggestion 10): three-way match passed and posted in SQL Account, no live payment yet.
          purchases: finPurchasesToPay(f, purs, sups),
          requests: (f.requests ?? []).filter((r) => r.status === 'approved' && !r.paymentId).map((r) => ({ id: r.id, title: r.title, amount: r.amount, payee: r.payee, subject: r.subject, dueOn: r.dueOn })),
          canAct: acts,
        };
      })
      .sort((x, y) => x.team - y.team || x.companyName.localeCompare(y.companyName));
    return {
      actor: a,
      me: user.id,
      period,
      rule: { ...RULES.financePayments.value, approvalExpiryDays: s.approvalExpiryDays },
      settings: s,
      teamsReady: this.teamsApprovals,
      companies: out,
    };
  }

  /** The day an approval lapses if the payment is not released (Fauzan, 1 Nov 2026: 30 days, the FD may change it). */
  /** Where a new or resubmitted payment is approved: Teams only while the connection is on, otherwise Prima. */
  /** The preparer may pick Prima or Teams for this payment; the Finance Director's setting is the default. */
  private methodChosen(v: unknown, s: FinSettingsValues): FinApprovalMethod {
    if (v == null || v === '') return this.methodFor(s);
    if (v !== 'prima' && v !== 'teams') throw new BadRequest("Approve in: choose 'prima' or 'teams'.");
    if (v === 'teams' && !this.teamsApprovals) throw new BadRequest('The Teams approval connection is not switched on yet, so this payment is approved in Prima.');
    return v;
  }

  private methodFor(s: FinSettingsValues): FinApprovalMethod {
    return s.approvalMethod === 'teams' && this.teamsApprovals ? 'teams' : 'prima';
  }

  private expiresOn(p: FinPayment, s: FinSettingsValues): IsoDate | null {
    if (p.status !== 'approved') return null;
    // Review finding (Arisha main, 1 Nov 2026): raising the setting from 30 to 60 days revived lapsed approvals. The
    // lapse day is now fixed when approved; older approvals without it never get longer than the rule's 30 days.
    if (p.expiresOn) return p.expiresOn;
    const at = approverOf(p.steps)?.at;
    const days = Math.min(s.approvalExpiryDays, RULES.financePayments.value.approvalExpiryDays);
    return at ? dateOf(fromMs(toMs(at) + days * 86_400_000)) : null;
  }

  private paymentMay(user: User, a: FinActor, f: FinStatus, p: FinPayment, s: FinSettingsValues = finDefaults()): FinPaymentAction[] {
    const may: FinPaymentAction[] = [];
    const exp = this.expiresOn(p, s);
    const expired = !!exp && this.today() >= exp;
    const prepared = paymentPreparers(p).includes(user.id);
    const reviewer = reviewerOf(p.steps)?.byId;
    const approver = approverOf(p.steps)?.byId;
    // A payment approved in Teams is never approved in Prima as well (Fauzan, 1 Nov 2026: one place, not both).
    const inPrima = (p.approvalMethod ?? 'prima') === 'prima' && !p.requestId;
    // The COO only approves or returns COO-subject payments that Finance has reviewed; he never reviews, releases,
    // cancels or links.
    if (a.kind === 'coo') {
      if (p.status === 'reviewed' && p.needs === 'coo' && !prepared && reviewer !== user.id) may.push(...(inPrima ? (['approve', 'return'] as const) : (['return'] as const)));
      if (expired && p.needs === 'coo') may.push('return');
      return may;
    }
    const reviews = isLead(a) || ((a.kind === 'leader' || a.kind === 'deputy') && a.team === f.team);
    // Standards review (1 Nov 2026): whoever entered or changed the payee's bank details does not review, approve or
    // release payments to that payee (keeping the supplier master apart from paying), and the preparer does not record
    // the release (starting a payment and executing it are kept apart).
    const payeeEditor = !!p.payeeId && (f.payees ?? []).find((x) => x.id === p.payeeId)?.entered.byId === user.id;
    if (p.status === 'prepared' && reviews && !prepared && !payeeEditor) may.push('review', 'return');
    if (p.status === 'reviewed' && finCoversApproval(a, p.needs) && !prepared && reviewer !== user.id && !payeeEditor) may.push(...(inPrima ? (['approve', 'return'] as const) : (['return'] as const)));
    if (p.status === 'returned' && prepared) may.push('resubmit');
    if (p.status === 'approved' && !expired && approver !== user.id && !prepared && !payeeEditor && a.kind !== 'viewer') may.push('release');
    // An approval not released in time goes back: whoever may approve it, or the team's reviewers, return it.
    if (expired && (finCoversApproval(a, p.needs) || reviews)) may.push('return');
    if (['prepared', 'reviewed', 'returned', 'approved'].includes(p.status) && (prepared || isLead(a) || a.kind === 'leader')) may.push('cancel');
    if (['prepared', 'reviewed', 'returned', 'approved'].includes(p.status) && a.kind !== 'viewer') may.push('link');
    return may;
  }

  private closeMay(user: User, a: FinActor, c: FinClose | null, check: FinCloseCheck): FinCloseAction[] {
    const status = c?.status ?? 'open';
    const preparer = c ? preparerOf(c.steps)?.byId : undefined;
    const reviewer = c ? reviewerOf(c.steps)?.byId : undefined;
    const may: FinCloseAction[] = [];
    if (status === 'open') {
      may.push('evidence', 'explain');
      if (!check.blockers.length && check.exceptions.every((e) => e.explained)) may.push('prepare');
    }
    if (status === 'prepared' && (isLead(a) || a.kind === 'leader' || a.kind === 'deputy') && preparer !== user.id) may.push('review', 'return');
    if (status === 'reviewed' && isLead(a) && preparer !== user.id && reviewer !== user.id) {
      if (!check.blockers.length && !check.bankPackOpen && check.exceptions.every((e) => e.explained)) may.push('approve');
      may.push('return');
    }
    if (status === 'approved' && isLead(a)) may.push('reopen');
    return may;
  }

  // ----- Payments -----

  private paymentFields(f: FinStatus, input: FinPaymentInput) {
    const r = RULES.financePayments.value;
    // Part 2 (31 Oct 2026): every payment goes to a payee from the company's payee list; the name and type come from it.
    const payeeId = typeof input.payeeId === 'string' ? input.payeeId : '';
    const master = (f.payees ?? []).find((x) => x.id === payeeId);
    if (!master) throw new BadRequest("Choose the payee from this company's payee list (add and verify a new payee first).");
    if (master.status === 'blocked') throw new BadRequest(`${master.name} is blocked from payment.`);
    const payee = master.name;
    const payeeKind = master.kind;
    const purpose = noSecrets(text(input.purpose, 'Purpose', 3, 300), 'Purpose');
    const amount = typeof input.amount === 'number' ? input.amount : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequest('Amount must be more than RM0.00.');
    if (Math.round(amount * 100) !== Math.round(amount * 100 * 1000) / 1000) throw new BadRequest('Amount has at most 2 decimal places (sen).');
    if (amount > r.maxAmount) throw new BadRequest(`Amount above RM${r.maxAmount.toLocaleString('en-MY')} must be split or handled outside Prima.`);
    const dueOn = isoDate(input.dueOn, 'Due date');
    const bankId = typeof input.bankId === 'string' ? input.bankId : '';
    if (!f.banks.some((b) => b.id === bankId)) throw new BadRequest("Choose one of this company's bank accounts to pay from.");
    const sqlRef = text(input.sqlRef, 'SQL Account document number', 2, 40);
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new BadRequest('Attach at least one supporting document (invoice, approval or claim).');
    if (input.evidence.length > r.maxEvidence) throw new BadRequest(`At most ${r.maxEvidence} supporting documents.`);
    const evidence = input.evidence.map((e, i) => noSecrets(text(e, `Document ${i + 1}`, 2, 300), `Document ${i + 1}`));
    // e-Invoice (1 Nov 2026): the supplier's validated e-Invoice UUID, or the self-billed one, when there is one.
    const eInvoiceRef = typeof input.eInvoiceRef === 'string' && input.eInvoiceRef.trim() ? text(input.eInvoiceRef, 'e-Invoice UUID', 10, 80) : null;
    // Subject (Fauzan, 1 Nov 2026): decides who approves. Missing = finance (older records and the default).
    const subject = input.subject == null || input.subject === '' ? 'finance' : (input.subject as FinSubject);
    if (!FIN_SUBJECTS.includes(subject)) throw new BadRequest(`Subject must be one of ${FIN_SUBJECTS.join(', ')}.`);
    // The supplier's own invoice number (2 Nov 2026): the same invoice is never paid twice, in any company.
    const invoiceNo = typeof input.invoiceNo === 'string' && input.invoiceNo.trim() ? noSecrets(text(input.invoiceNo, "Supplier's invoice number", 2, 60), 'Invoice number') : null;
    const budgetLine = input.budgetLine == null || input.budgetLine === '' ? null : (input.budgetLine as FinPlanLine);
    if (budgetLine && (!(FIN_PLAN_LINES as readonly string[]).includes(budgetLine) || budgetLine === 'revenue')) throw new BadRequest(`Budget line must be one of ${FIN_PLAN_LINES.filter((x) => x !== 'revenue').join(', ')}.`);
    return { payee, payeeKind, payeeId, purpose, amount: Math.round(amount * 100) / 100, dueOn, bankId, sqlRef, evidence, eInvoiceRef, invoiceNo, subject, budgetLine };
  }

  /**
   * Insider test (Fauzan, 1 Nov 2026: "the staff who want to steal"): a clerk could add a payee with their own account,
   * or change a supplier's account to theirs, and then prepare the payment to it, leaving only the call-back between
   * them and the money. Whoever entered or last changed a payee's bank details does not prepare payments to it either.
   */
  private notPayeeEditor(user: User, f: FinStatus, payeeId: Id) {
    const payee = (f.payees ?? []).find((x) => x.id === payeeId);
    if (payee?.entered.byId === user.id)
      throw new AccessDenied('view', `(you entered or changed ${payee.name}'s bank details; someone else in the team prepares payments to it)`);
  }

  /**
   * Duplicate check (Fauzan, 2 Nov 2026, suggestion 9: "same supplier, number or amount" across all companies). The
   * same SQL Account document in this company, or the same supplier invoice number anywhere, is refused. The same
   * supplier and amount within the duplicate window, in any company the person can see, is refused unless the preparer
   * says why it is not a duplicate; the reason stays on the payment for the reviewer and approver.
   */
  private async duplicateCheck(
    tx: Store,
    user: User,
    f: FinStatus,
    fields: { payee: string; payeeId: Id; amount: number; sqlRef: string; dueOn: IsoDate; invoiceNo: string | null },
    except: Id | null,
    reason: unknown,
    reg: { regularId?: Id | null; regularPeriod?: string | null } = {},
  ): Promise<string | null> {
    const same = (f.payments ?? []).find((p) => p.id !== except && !['cancelled', 'returned'].includes(p.status) && p.sqlRef.toLowerCase() === fields.sqlRef.toLowerCase());
    if (same) throw new BadRequest(`This looks like a duplicate of ${same.id} (${same.payee}, RM${same.amount.toFixed(2)}, ${same.sqlRef}, ${same.status}): the same SQL Account document. Cancel that one first if this is really a second payment.`);
    const ids = await this.companies(user);
    const rows = [f, ...(await tx.list('finStatus', { companyId: ids })).filter((x) => x.companyId !== f.companyId && ids.includes(x.companyId))];
    const d = finDuplicateAcross(rows, { companyId: f.companyId, ...fields, ...reg }, except);
    if (d.hard) throw new BadRequest(`Duplicate invoice: ${d.hard}`);
    if (!d.soft) return null;
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < RULES.financePayments.value.reasonMin)
      throw new BadRequest(`This looks like a duplicate: ${d.soft} If it is really a separate payment, say why (for example a different invoice and month).`);
    return `${why.slice(0, 300)} [similar: ${d.soft}]`;
  }

  /** Someone in the company's Finance team (or the Finance Director or the CEO) asks for a payment. */
  async createPayment(user: User, companyId: Id, input: FinPaymentInput) {
    return this.store.transaction(async (tx) => {
      const a = this.actor(user);
      const f = await this.row(tx, user, a, companyId);
      // A payment for a company head's approved request (Fauzan, 1 Nov 2026): same amount, and what it is for comes from
      // the request, so whoever prepares it cannot choose another approver.
      const req = input.requestId == null || input.requestId === '' ? null : (f.requests ?? []).find((r) => r.id === input.requestId);
      if (input.requestId != null && input.requestId !== '' && !req) throw new NotFound('Payment request');
      if (req && (req.status !== 'approved' || req.paymentId)) throw new BadRequest(`Request ${req.id} is ${req.paymentId ? 'already being paid' : req.status.replace('_', ' ')}; only an approved request is paid.`);
      if (req && Math.abs(Number(input.amount) - req.amount) >= 0.005) throw new BadRequest(`The payment must be the approved RM${req.amount.toFixed(2)} of request ${req.id}.`);
      // A due date on the regular payments list (Fauzan, 2 Nov 2026): exactly the due amount, to the listed payee, and
      // the subject (so the approver) comes from the list.
      const reg = input.regularId == null || input.regularId === '' ? null : finRegularForPayment(f, input.regularId, input.regularPeriod, this.today());
      if (reg && req) throw new BadRequest('A payment pays either a request or a regular payment, not both.');
      if (reg?.d.bill?.byId === user.id) throw new AccessDenied('view', `(you recorded the ${reg.d.period} bill for ${reg.r.name}; someone else prepares its payment)`);
      if (reg && Math.abs(Number(input.amount) - reg.expected) >= 0.005) throw new BadRequest(`The payment must be the RM${reg.expected.toFixed(2)} due for ${reg.r.name} ${reg.d.period}.`);
      // A Procurement purchase (Fauzan, 2 Nov 2026: suggestion 10, three-way match): only one whose order, goods received
      // and supplier invoice matched and that is posted in SQL Account; exactly the invoice amount, once, to the supplier's
      // account that Procurement verified.
      const pur = input.purchaseId == null || input.purchaseId === '' ? null : await tx.get('purRequests', String(input.purchaseId));
      if (input.purchaseId != null && input.purchaseId !== '' && (!pur || pur.companyId !== f.companyId)) throw new NotFound('Purchase');
      if (pur) {
        if (req || reg) throw new BadRequest('A payment pays a purchase, a request or a regular payment, one only.');
        if (pur.status !== 'posted' || !pur.match?.ok || !pur.invoice) throw new BadRequest(`${pur.ref} is not ready to pay: the three-way match must pass and the invoice be posted in SQL Account first.`);
        const taken = (f.payments ?? []).find((x) => x.purchaseId === pur.id && !['cancelled', 'returned'].includes(x.status));
        if (taken) throw new BadRequest(`${pur.ref} is already being paid by ${taken.id} (${taken.status}).`);
        if (Math.abs(Number(input.amount) - pur.invoice.amount) >= 0.005) throw new BadRequest(`The payment must be the supplier's invoice RM${pur.invoice.amount.toFixed(2)} for ${pur.ref}.`);
        const sup = pur.chosenSupplierId ? await tx.get('purSuppliers', pur.chosenSupplierId) : null;
        const payee = (f.payees ?? []).find((x) => x.id === input.payeeId);
        const supLast4 = (sup?.bank.account ?? '').replace(/\D/g, '').slice(-4);
        if (!sup || !payee || !supLast4 || payee.accountLast4 !== supLast4)
          throw new BadRequest(`Pay ${sup?.name ?? 'the supplier'} at the account Procurement verified (ending ${supLast4 || '?'}); the payee chosen ends ${payee?.accountLast4 ?? '?'}.`);
        // Procurement & Inventory is a department the COO monitors: the COO or the CEO approves its payments (Fauzan, 1 Nov 2026).
        // The purchase's own papers are the evidence unless Finance adds more (A13-style fill, nothing typed twice).
        const papers = [`Purchase ${pur.ref}: PO ${pur.po?.ref ?? ''}`, `Goods received by ${pur.grn?.by ?? ''}`, `Supplier invoice ${pur.invoice.number}`, `SQL Account ${pur.posted?.sqlRef ?? ''}`];
        const given = Array.isArray(input.evidence) ? input.evidence.filter((x) => typeof x === 'string' && x.trim()) : [];
        input = { ...input, evidence: given.length ? given : papers, subject: 'inventory', invoiceNo: input.invoiceNo || pur.invoice.number, eInvoiceRef: input.eInvoiceRef || pur.invoice.eInvoiceUuid || undefined };
      }
      const fields = this.paymentFields(f, req ? { ...input, subject: req.subject } : reg ? { ...input, payeeId: reg.r.payeeId, bankId: input.bankId ?? reg.r.bankId, subject: reg.r.subject } : input);
      this.notPayeeEditor(user, f, fields.payeeId);
      const notDuplicate = await this.duplicateCheck(tx, user, f, fields, null, input.notDuplicate, reg ? { regularId: reg.r.id, regularPeriod: reg.d.period } : {});
      const payments = f.payments ?? [];
      const id = `pay-${f.companyId}-${this.today().replace(/-/g, '')}-${String(payments.length + 1).padStart(3, '0')}`;
      const p: FinPayment = {
        id,
        companyId: f.companyId,
        period: this.today().slice(0, 7),
        ...fields,
        needs: finApproverFor(fields.subject),
        approvalMethod: this.methodChosen(input.approvalMethod, await this.settings(tx)),
        status: 'prepared',
        steps: [this.step(user, 'prepared', req ? `For request ${req.id} (${req.title})` : pur ? `For purchase ${pur.ref} (three-way match passed, SQL Account ${pur.posted?.sqlRef ?? ''})` : '')],
        bankRef: null,
        releasedOn: null,
        ...(req ? { requestId: req.id } : {}),
        ...(reg ? { regularId: reg.r.id, regularPeriod: reg.d.period } : {}),
        ...(pur ? { purchaseId: pur.id } : {}),
        ...(notDuplicate ? { notDuplicate } : {}),
      };
      const requests = req
        ? (f.requests ?? []).map((r) => (r.id === req.id ? { ...r, paymentId: id, steps: [...r.steps, { step: 'payment_linked' as const, by: user.name, byId: user.id, at: this.now(), comment: `Payment ${id} prepared` }] } : r))
        : undefined;
      const regular = reg ? finRegularLink(f.regular ?? [], reg.r.id, reg.d.period, id, addDays(this.today(), 40)) : undefined;
      await tx.update('finStatus', f.id, { payments: [...payments, p], ...(requests ? { requests } : {}), ...(regular ? { regular } : {}) });
      await this.log(tx, user, f, 'finance.payment.prepared', `Payment ${id} to ${p.payee} RM${p.amount.toFixed(2)} (${p.sqlRef}) prepared; needs ${p.needs}.`);
      return p;
    });
  }

  /**
   * Automation A4 and lighter check L1 (Fauzan, 2 Nov 2026): the Finance Director (or the CEO) approves several reviewed
   * regular payments (instalments, bills, EPF, PERKESO, PCB, zakat) on one screen with one comment. Each payment is
   * still approved on its own, with the same checks: never one the approver prepared or reviewed, and the amount is the
   * due amount from the checked list. Anything that cannot be approved is listed with the reason, the rest go through.
   */
  async approveRegularBatch(user: User, companyId: Id, input: { paymentIds?: unknown; comment?: unknown }) {
    const a = this.actor(user);
    if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO approves regular payments together)');
    const comment = requireComment(input.comment, 'approve these payments');
    const ids = Array.isArray(input.paymentIds) ? [...new Set(input.paymentIds.filter((x): x is string => typeof x === 'string'))].slice(0, 100) : [];
    if (!ids.length) throw new BadRequest('Choose the payments to approve.');
    const f = await this.store.get('finStatus', `fin-${companyId}`);
    const approved: Id[] = [];
    const refused: { id: Id; reason: string }[] = [];
    for (const id of ids) {
      const p = (f?.payments ?? []).find((x) => x.id === id);
      if (!p || !p.regularId) {
        refused.push({ id, reason: 'Not a payment from the regular payments list' });
        continue;
      }
      if (p.status !== 'reviewed') {
        refused.push({ id, reason: `It is ${p.status}, not reviewed` });
        continue;
      }
      try {
        await this.doPaymentStep(user, a, companyId, id, 'approve', { comment: `${comment} (approved together with ${ids.length - 1} other regular payment(s))` });
        approved.push(id);
      } catch (e) {
        refused.push({ id, reason: (e as Error).message });
      }
    }
    return { approved, refused };
  }

  /** Review, approve, return, resubmit, release or cancel a payment. */
  async paymentStep(user: User, companyId: Id, paymentId: Id, action: FinPaymentAction, input: Record<string, unknown> = {}) {
    return this.doPaymentStep(user, this.actor(user), companyId, paymentId, action, input);
  }

  private async doPaymentStep(user: User, a: FinActor, companyId: Id, paymentId: Id, action: FinPaymentAction, input: Record<string, unknown>) {
    return this.store.transaction(async (tx) => {
      const f = await this.row(tx, user, a, companyId);
      const payments = f.payments ?? [];
      const p = payments.find((x) => x.id === paymentId);
      if (!p) throw new NotFound('Payment');
      if (!['review', 'approve', 'return', 'resubmit', 'release', 'cancel', 'link'].includes(action)) throw new BadRequest('Unknown payment action.');
      const autoReturn = p.status === 'returned' && p.steps[p.steps.length - 1].byId === FIN_AUTO.byId ? p.steps[p.steps.length - 1] : null;
      if (autoReturn && (action === 'release' || action === 'return')) throw new RefusedAfterSave(`${autoReturn.comment} It has gone back to the preparer.`);
      const s = await this.settings(tx);
      const may = this.paymentMay(user, a, f, p, s);
      if (!may.includes(action)) {
        const exp = this.expiresOn(p, s);
        if (action === 'release' && exp && this.today() >= exp)
          throw new BadRequest(`The approval lapsed on ${exp} (not released within ${s.approvalExpiryDays} days). Return it for a fresh approval.`);
        throw new AccessDenied('view', this.paymentRefusal(user, a, f, p, action));
      }
      let next: FinPayment;
      let summary: string;
      if (action === 'review') {
        const comment = requireComment(input.comment, 'review');
        next = { ...p, status: 'reviewed', steps: [...p.steps, this.step(user, 'reviewed', comment)] };
        summary = `reviewed: ${comment}`;
        // Fauzan, 1 Nov 2026: the company head's request was approved by the COO (or the FD); that is the approval of this
        // payment, copied with its comment, never given twice. Separation of duties still holds against this payment.
        if (p.requestId) {
          const req = (f.requests ?? []).find((r) => r.id === p.requestId);
          const ok = [...(req?.steps ?? [])].reverse().find((x) => x.step === 'approved');
          // Only a return after an approval (a lapse, or held at release) needs the chain to approve it again.
          const firstApproved = p.steps.findIndex((x) => x.step === 'approved');
          const lastReturn = firstApproved < 0 ? undefined : [...p.steps.slice(firstApproved)].reverse().find((x) => x.step === 'returned');
          if (!req || req.status !== 'approved' || !ok || (lastReturn && ok.at <= lastReturn.at))
            throw new BadRequest(`Request ${p.requestId} must be approved again by the whole chain before this payment goes on.`);
          if (paymentPreparers(p).includes(ok.byId) || ok.byId === user.id)
            throw new AccessDenied('view', '(whoever approved the request does not also prepare or review its payment)');
          const payee = p.payeeId ? (f.payees ?? []).find((x) => x.id === p.payeeId) : null;
          if (p.payeeId && payee?.status !== 'verified') throw new BadRequest(`${p.payee}'s bank details are not verified. Review after verification.`);
          next = {
            ...next,
            status: 'approved',
            payeeBank: payee ? { bank: payee.bank, accountLast4: payee.accountLast4, accountName: payee.accountName, rev: payee.history.length } : (p.payeeBank ?? null),
            expiresOn: dateOf(fromMs(toMs(this.now()) + s.approvalExpiryDays * 86_400_000)),
            steps: [...next.steps, { step: 'approved', by: ok.by, byId: ok.byId, at: this.now(), comment: `Request ${req.id} approved ${ok.at.slice(0, 10)}: ${ok.comment}` }],
          };
          summary = `reviewed (${comment}); approved by ${ok.by} on request ${req.id}`;
        }
      } else if (action === 'approve') {
        const comment = requireComment(input.comment, 'approve');
        const rejectedBy = p.external?.decisions.find((d) => d.decision === 'rejected');
        if (rejectedBy) throw new BadRequest(`${rejectedBy.approver} rejected this request in ${p.external!.system === 'teams' ? 'Teams' : 'SharePoint'}: ${rejectedBy.comment}`);
        const payee = p.payeeId ? (f.payees ?? []).find((x) => x.id === p.payeeId) : null;
        if (p.payeeId && payee?.status !== 'verified')
          throw new BadRequest(`${p.payee}'s bank details are not verified${payee?.status === 'pending' ? ' (changed or new; someone must call back to check them)' : ''}. Approve after verification.`);
        // Duplicate check again with everything the approver can see (the Finance Director and the CEO see every company).
        {
          const ids = await this.companies(user);
          const rows = [f, ...(await tx.list('finStatus', { companyId: ids })).filter((x) => x.companyId !== f.companyId && ids.includes(x.companyId))];
          const d = finDuplicateAcross(rows, { companyId: f.companyId, payee: p.payee, payeeId: p.payeeId ?? '', amount: p.amount, dueOn: p.dueOn, invoiceNo: p.invoiceNo ?? null, regularId: p.regularId, regularPeriod: p.regularPeriod }, p.id);
          if (d.hard) throw new BadRequest(`Do not approve: ${d.hard}`);
          if (d.soft && !p.notDuplicate) throw new BadRequest(`Do not approve yet: ${d.soft} Return it so the preparer says why it is not a duplicate.`);
        }
        next = {
          ...p,
          status: 'approved',
          payeeBank: payee ? { bank: payee.bank, accountLast4: payee.accountLast4, accountName: payee.accountName, rev: payee.history.length } : (p.payeeBank ?? null),
          expiresOn: dateOf(fromMs(toMs(this.now()) + s.approvalExpiryDays * 86_400_000)),
          steps: [...p.steps, this.step(user, 'approved', comment)],
        };
        summary = `approved (${p.needs === 'coo' ? 'COO' : 'Finance'} subject ${p.subject ?? 'finance'}): ${comment}`;
      } else if (action === 'return') {
        const reason = requireReason(input.comment, 'return it');
        next = { ...p, status: 'returned', steps: [...p.steps, this.step(user, 'returned', reason)] };
        summary = `returned: ${reason}`;
      } else if (action === 'resubmit') {
        // Arisha main's review (2 Nov 2026): a correction never loses evidence. Documents already attached stay; new ones
        // are added. What changed is written into the resubmitted step, next to the earlier steps, which all stay.
        const added = Array.isArray(input.evidence) ? input.evidence.filter((e) => !p.evidence.includes(e as string)) : [];
        const fields = this.paymentFields(f, { ...p, ...input, evidence: [...p.evidence, ...added] });
        this.notPayeeEditor(user, f, fields.payeeId);
        if (p.regularId) {
          const r = (f.regular ?? []).find((x) => x.id === p.regularId);
          const d = r?.dues.find((x) => x.period === p.regularPeriod);
          const due = r && d ? (r.amount ?? d.bill?.amount ?? null) : null;
          if (!r || fields.payeeId !== r.payeeId || fields.subject !== r.subject || due == null || Math.abs(fields.amount - due) >= 0.005)
            throw new BadRequest(`This pays ${r?.name ?? p.regularId} ${p.regularPeriod}: the payee, subject and RM${due?.toFixed(2) ?? '?'} come from the regular payments list.`);
        }
        // An advance or a petty cash top-up keeps its amount and payee (the advance record and the vouchers say them).
        const adv = (f.advances ?? []).find((x) => x.paymentId === p.id);
        const top = (f.pettyCash ?? []).flatMap((x) => x.topUps.map((t) => ({ t, x }))).find((y) => y.t.paymentId === p.id);
        if (adv && (Math.abs(fields.amount - adv.amount) >= 0.005 || fields.payeeId !== p.payeeId)) throw new BadRequest(`This pays advance ${adv.id}: RM${adv.amount.toFixed(2)} to ${adv.name}. Cancel it and add a new advance to change it.`);
        if (top && (Math.abs(fields.amount - top.t.amount) >= 0.005 || fields.payeeId !== top.x.payeeId)) throw new BadRequest(`This tops up petty cash ${top.x.office} for exactly RM${top.t.amount.toFixed(2)} of vouchers to ${top.x.custodian}.`);
        const notDuplicate = await this.duplicateCheck(tx, user, f, fields, p.id, input.notDuplicate ?? p.notDuplicate?.split(' [similar:')[0], { regularId: p.regularId, regularPeriod: p.regularPeriod });
        const changes = finPaymentChanges(p, fields);
        const note = [typeof input.comment === 'string' ? input.comment.trim() : '', changes.length ? `Changed: ${changes.join('; ')}` : ''].filter(Boolean).join('. ').slice(0, 500);
        next = { ...p, ...fields, notDuplicate, needs: finApproverFor(fields.subject), approvalMethod: p.approvalMethod === 'teams' && !this.teamsApprovals ? 'prima' : (p.approvalMethod ?? this.methodFor(s)), status: 'prepared', steps: [...p.steps, this.step(user, 'resubmitted', note)] };
        summary = `resubmitted, needs ${next.needs}`;
      } else if (action === 'release') {
        if (p.teams?.verdict === 'rejected') throw new BadRequest('Hold this payment: it was rejected in Teams. Return or cancel it.');
        const bankRef = noSecrets(text(input.bankRef, "The bank's reference", 4, 60), "The bank's reference");
        const releasedOn = isoDate(input.releasedOn ?? this.today(), 'Release date');
        if (releasedOn > this.today()) throw new BadRequest('The release date cannot be in the future.');
        const approvedOn = approverOf(p.steps) ? dateOf(approverOf(p.steps)!.at) : null;
        if (approvedOn && releasedOn < approvedOn) throw new BadRequest(`The release date cannot be before the approval (${approvedOn}).`);
        const note = typeof input.comment === 'string' ? input.comment.trim().slice(0, 500) : '';
        // Review finding (Arisha main, 1 Nov 2026): a Teams or SharePoint rejection linked after approval did not stop
        // the release. The linked approval is checked again here.
        const rejected = p.external?.decisions.find((d) => d.decision === 'rejected');
        if (rejected)
          throw new BadRequest(`Hold this payment: ${rejected.approver} rejected the request in ${p.external!.system === 'teams' ? 'Teams' : 'SharePoint'} (${rejected.comment}). Return or cancel it.`);
        // Paid to the right person: the payee must still be verified with the same details as when approved, and the
        // releaser types the last 4 digits and the account name the bank portal shows; both must match.
        let releaseCheck: FinPayment['releaseCheck'] = null;
        if (p.payeeId) {
          const payee = (f.payees ?? []).find((x) => x.id === p.payeeId);
          if (!payee || payee.status !== 'verified')
            throw new BadRequest(`Hold this payment: ${p.payee}'s bank details are ${payee?.status ?? 'missing'} and must be verified again.`);
          const snap = p.payeeBank;
          // Review finding (1 Nov 2026): a change of the account name alone, verified again, still released on the old
          // approval. The approval now covers the payee's whole revision: any change after approval needs a new one.
          if (
            !snap ||
            snap.accountLast4 !== payee.accountLast4 ||
            snap.bank !== payee.bank ||
            snap.accountName !== payee.accountName ||
            (snap.rev ?? 0) !== payee.history.length
          )
            throw new BadRequest(`Hold this payment: ${p.payee}'s bank details changed after approval. Return it for a fresh approval.`);
          const last4 = typeof input.accountLast4 === 'string' ? input.accountLast4.trim() : '';
          const name = typeof input.accountName === 'string' ? input.accountName.trim() : '';
          if (!/^\d{4}$/.test(last4) || name.length < 2) throw new BadRequest('Type the last 4 digits and the account name the bank portal shows for this payee.');
          if (last4 !== payee.accountLast4) throw new BadRequest(`Stop: the bank portal account ends ${last4}, but ${p.payee}'s verified account ends ${payee.accountLast4}. Do not release.`);
          const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
          // Review finding (Arisha main, 1 Nov 2026): a punctuation-only name such as "**" normalised to "" and matched
          // everything. Now both names need real letters, and must be equal, or one a prefix (bank truncation) covering at least 10 characters and 60% of the name.
          const seen = norm(name);
          const known = norm(payee.accountName);
          const short = Math.min(seen.length, known.length);
          if (seen.length < 3 || !(seen === known || (short >= Math.max(10, Math.ceil(known.length * 0.6)) && (seen.startsWith(known) || known.startsWith(seen)))))
            throw new BadRequest(`Stop: the bank shows the account name "${name}", but the verified name is "${payee.accountName}". Do not release.`);
          releaseCheck = { accountLast4: last4, accountName: name.slice(0, 120) };
        }
        // Bank mandate (Fauzan, 2 Nov 2026): with a checked mandate on the account, the releaser is on it, and the second
        // approver is named when the bank needs two.
        const users = new Map((await tx.list('users')).map((u) => [u.id, u]));
        const { co } = finMandateRelease(f, p, user, input.coApproverId, (id) => users.get(id), this.today());
        next = { ...p, status: 'released', bankRef, releasedOn, releaseCheck, steps: [...p.steps, this.step(user, 'released', co ? `${note}${note ? ' ' : ''}(second approver in the bank: ${co})`.trim() : note)] };
        summary = `released in the bank portal on ${releasedOn}, bank ref ${bankRef}`;
      } else if (action === 'link') {
        const external = parseExternalApproval(user, input, this.now());
        // Insider test (1 Nov 2026): linking again replaced the whole record, so a rejection copied from Teams could be
        // wiped by linking the same payment with no decisions. A recorded rejection stays; return or cancel the payment.
        const was = p.external?.decisions.find((d) => d.decision === 'rejected');
        if (was && !external.decisions.some((d) => d.decision === 'rejected' && d.approver === was.approver && d.comment === was.comment))
          throw new BadRequest(`${was.approver}'s rejection (${was.comment}) is recorded and stays. Return or cancel this payment instead of linking it again.`);
        next = { ...p, external, steps: [...p.steps, this.step(user, 'evidence', `${external.system} approval ${external.requestRef}: ${external.url}`)] };
        summary = `linked to ${external.system} approval ${external.requestRef} (${external.decisions.map((d) => `${d.approver} ${d.decision}`).join('; ') || 'no decision yet'})`;
      } else {
        const reason = requireReason(input.comment, 'cancel it');
        next = { ...p, status: 'cancelled', steps: [...p.steps, this.step(user, 'cancelled', reason)] };
        summary = `cancelled: ${reason}`;
      }
      let requests = f.requests;
      if (p.requestId && action === 'return' && p.status === 'approved') requests = finReturnRequest(requests, p, { by: user.name, byId: user.id }, this.now(), next.steps[next.steps.length - 1].comment);
      if (p.requestId && action === 'cancel')
        requests = (requests ?? []).map((r) => (r.id === p.requestId ? { ...r, paymentId: null, steps: [...r.steps, { step: 'payment_linked' as const, by: user.name, byId: user.id, at: this.now(), comment: `Payment ${p.id} cancelled` }] } : r));
      const regular = p.regularId && p.regularPeriod && action === 'cancel' ? finRegularLink(f.regular ?? [], p.regularId, p.regularPeriod, null, addDays(this.today(), 40)) : undefined;
      // A cancelled petty cash top-up frees its vouchers; a cancelled advance payment cancels the advance.
      const pettyCash = action === 'cancel' ? finPettyFreeTopUp(f, p.id) : undefined;
      const advances = action === 'cancel' && (f.advances ?? []).some((x) => x.paymentId === p.id && x.status === 'open') ? (f.advances ?? []).map((x) => (x.paymentId === p.id && x.status === 'open' ? { ...x, status: 'cancelled' as const } : x)) : undefined;
      await tx.update('finStatus', f.id, { payments: payments.map((x) => (x.id === p.id ? next : x)), ...(requests !== f.requests ? { requests } : {}), ...(regular ? { regular } : {}), ...(pettyCash ? { pettyCash } : {}), ...(advances ? { advances } : {}) });
      await this.log(tx, user, f, `finance.payment.${action}`, `Payment ${p.id} to ${p.payee} RM${next.amount.toFixed(2)} ${summary}`.slice(0, 900));
      return next;
    });
  }

  private paymentRefusal(user: User, a: FinActor, f: FinStatus, p: FinPayment, action: FinPaymentAction): string {
    const prepared = paymentPreparers(p).includes(user.id);
    if (action === 'approve' && (p.approvalMethod ?? 'prima') === 'teams')
      return '(this payment is approved in Teams, as the Finance Director or the CEO set; Prima records the Teams result, it is never approved twice)';
    if ((action === 'review' || action === 'approve') && prepared) return '(nobody reviews or approves a payment they prepared)';
    if (action === 'approve' && reviewerOf(p.steps)?.byId === user.id) return '(the reviewer cannot also approve)';
    if (action === 'approve' && !finCoversApproval(a, p.needs))
      return p.needs === 'coo' ? '(the COO or the CEO approves payments for the departments the COO monitors)' : '(only the Finance Director or the CEO approves Finance payments)';
    if (action === 'release' && approverOf(p.steps)?.byId === user.id) return '(nobody releases a payment they approved)';
    if (action === 'release' && prepared) return '(nobody records the release of a payment they prepared)';
    if (['review', 'approve', 'release'].includes(action) && p.payeeId && (f.payees ?? []).find((x) => x.id === p.payeeId)?.entered.byId === user.id)
      return "(nobody reviews, approves or releases a payment to a payee whose bank details they entered or changed)";
    if (action === 'review' && a.kind === 'data_entry') return '(the deputy or the team leader reviews)';
    return `(payment is ${p.status}; ${action} is not open to you)`;
  }

  // ----- The month-end close -----

  async closeStep(user: User, companyId: Id, action: FinCloseAction, input: Record<string, unknown> = {}) {
    return this.store.transaction(async (tx) => {
      const a = this.actor(user);
      const f = await this.row(tx, user, a, companyId);
      const period = this.closePeriod();
      if (input.period != null && input.period !== period) throw new BadRequest(`Only ${period} can be closed now.`);
      const closes = f.closes ?? [];
      const existing = closes.find((c) => c.period === period) ?? null;
      const c: FinClose = existing ?? { id: `close-${f.companyId}-${period}`, period, status: 'open', bankRecRefs: [], explanations: [], steps: [] };
      const s = await this.settings(tx);
      const contracts = (await tx.list('contracts', { companyId: [f.companyId] })).filter((x) => x.companyId === f.companyId);
      const group = f.companyId === GROUP_EMPLOYER_ID ? f : await tx.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
      const icName = await this.companyNamer(tx);
      const check = finCloseCheck(f, c, period, this.now(), s, contracts, group, icName);
      if (!['evidence', 'explain', 'prepare', 'review', 'approve', 'return', 'reopen'].includes(action)) throw new BadRequest('Unknown close action.');
      const may = this.closeMay(user, a, c, check);
      if (!may.includes(action)) {
        if (action === 'prepare' && c.status === 'open')
          throw new BadRequest(
            [...check.blockers, ...check.exceptions.filter((e) => !e.explained).map((e) => `Explain: ${e.text}.`)].join(' ') || 'Not ready to prepare.',
          );
        // Review finding (Arisha main, 1 Nov 2026): an exception that appears after review (a new bank line, a stale
        // invoice case) must also be explained before the financials are approved.
        const unexplained = check.exceptions.filter((e) => !e.explained);
        if (action === 'approve' && c.status === 'reviewed' && isLead(a) && (check.blockers.length || check.bankPackOpen || unexplained.length))
          throw new BadRequest(
            [...check.blockers, ...unexplained.map((e) => `Explain: ${e.text}.`), check.bankPackOpen ? `${check.bankPackOpen} bank pack item(s) not reviewed yet.` : '']
              .join(' ')
              .trim(),
          );
        const preparer = preparerOf(c.steps)?.byId;
        const reviewer = reviewerOf(c.steps)?.byId;
        throw new AccessDenied(
          'view',
          (action === 'review' || action === 'approve') && preparer === user.id
            ? '(nobody reviews or approves a close they prepared)'
            : action === 'approve' && reviewer === user.id
              ? '(the reviewer cannot also approve)'
              : action === 'approve' || action === 'reopen'
                ? '(only the Finance Director or the CEO approves or reopens a close)'
                : `(close is ${c.status}; ${action} is not open to you)`,
        );
      }
      let next: FinClose = c;
      let summary = '';
      if (action === 'evidence') {
        const bankId = typeof input.bankId === 'string' ? input.bankId : '';
        const bank = f.banks.find((b) => b.id === bankId);
        if (!bank) throw new BadRequest('Choose one of this company’s bank accounts.');
        const ref = noSecrets(text(input.ref, 'The reconciliation report (file name or SharePoint link)', 3, 300), 'The reconciliation report');
        next = {
          ...c,
          bankRecRefs: [...c.bankRecRefs.filter((r) => r.bankId !== bankId), { bankId, ref, by: user.name, byId: user.id, at: this.now() }],
          steps: [...c.steps, this.step(user, 'evidence', `${bank.bank} ${bank.accountMasked}: ${ref}`)],
        };
        summary = `bank reconciliation attached for ${bank.bank} ${bank.accountMasked}`;
      } else if (action === 'explain') {
        const key = typeof input.key === 'string' ? input.key : '';
        const ex = check.exceptions.find((e) => e.key === key);
        if (!ex) throw new BadRequest('That exception is not open for this month.');
        const why = requireReason(input.text, 'accept this exception');
        next = {
          ...c,
          explanations: [...c.explanations.filter((e) => e.key !== key), { key, text: why, by: user.name, byId: user.id, at: this.now() }],
          steps: [...c.steps, this.step(user, 'explained', `${ex.text}: ${why}`)],
        };
        summary = `exception explained: ${ex.text}`;
      } else if (action === 'prepare') {
        next = { ...c, status: 'prepared', steps: [...c.steps, this.step(user, 'prepared', typeof input.comment === 'string' ? input.comment.trim().slice(0, 500) : '')] };
        summary = 'prepared for review';
      } else if (action === 'review') {
        const comment = requireComment(input.comment, 'review');
        next = { ...c, status: 'reviewed', steps: [...c.steps, this.step(user, 'reviewed', comment)] };
        summary = `reviewed: ${comment}`;
      } else if (action === 'approve') {
        const comment = requireComment(input.comment, 'approve');
        next = { ...c, status: 'approved', steps: [...c.steps, this.step(user, 'approved', comment)] };
        summary = `APPROVED FINANCIALS: ${comment}`;
      } else if (action === 'return') {
        const reason = requireReason(input.comment, 'return it');
        next = { ...c, status: 'open', steps: [...c.steps, this.step(user, 'returned', reason)] };
        summary = `returned: ${reason}`;
      } else {
        const reason = requireReason(input.comment, 'reopen it');
        next = { ...c, status: 'open', steps: [...c.steps, this.step(user, 'reopened', reason)] };
        summary = `reopened: ${reason}`;
      }
      await tx.update('finStatus', f.id, { closes: existing ? closes.map((x) => (x.id === c.id ? next : x)) : [...closes, next] });
      await this.log(tx, user, f, `finance.close.${action}`, `Close ${period}: ${summary}`.slice(0, 900));
      return { ...next, check: finCloseCheck(f, next, period, this.now(), s, contracts, group, icName) };
    });
  }

  // ----- The COO's approvals (Fauzan, 1 Nov 2026: approval by subject matter) -----

  /**
   * Payments for the departments the COO monitors: those Finance has reviewed and that wait for him, plus the last 60
   * days of the ones already decided. Only what he needs to decide: no bank account numbers, closes, packs or payees.
   */
  async cooDesk(user: User) {
    if (!isFinCoo(user)) throw new AccessDenied('view', '(COO payment approvals)');
    const ids = await this.companies(user);
    const [rows, companies, s] = await Promise.all([this.store.list('finStatus', { companyId: ids }), this.store.list('companies', { id: ids }), this.settings()]);
    const today = this.today();
    const nameOf = (id: Id) => centralEmployerName(id) ?? companies.find((c) => c.id === id)?.name ?? id;
    const payments = rows
      .flatMap((f) =>
        (f.payments ?? [])
          .filter((p) => p.needs === 'coo')
          .filter((p) => p.status === 'reviewed' || p.status === 'approved' || daysBetween(p.steps[p.steps.length - 1].at.slice(0, 10), today) <= 60)
          .map((p) => ({
            id: p.id,
            companyId: f.companyId,
            companyName: nameOf(f.companyId),
            subject: p.subject ?? 'finance',
            payee: p.payee,
            payeeKind: p.payeeKind,
            purpose: p.purpose,
            amount: p.amount,
            dueOn: p.dueOn,
            sqlRef: p.sqlRef,
            evidence: p.evidence,
            external: p.external ?? null,
            status: p.status,
            steps: p.steps,
            expiresOn: this.expiresOn(p, s),
            may: this.paymentMay(user, COO_ACTOR, f, p, s),
          })),
      )
      .sort((x, y) => (x.status === 'reviewed' ? 0 : 1) - (y.status === 'reviewed' ? 0 : 1) || x.dueOn.localeCompare(y.dueOn));
    return { me: user.id, subjects: RULES.financePayments.value.cooSubjects, payments };
  }

  /** The COO approves or returns a COO-subject payment, always with a comment; nothing else is open to him. */
  async cooStep(user: User, companyId: Id, paymentId: Id, action: 'approve' | 'return', input: Record<string, unknown> = {}) {
    if (!isFinCoo(user)) throw new AccessDenied('view', '(COO payment approvals)');
    if (action !== 'approve' && action !== 'return') throw new BadRequest('The COO approves or returns a payment.');
    return this.doPaymentStep(user, COO_ACTOR, companyId, paymentId, action, input);
  }

  async cooHome(user: User): Promise<HomeItem[]> {
    if (!isFinCoo(user)) return [];
    const d = await this.cooDesk(user);
    const waiting = d.payments.filter((p) => p.may.includes('approve'));
    if (!waiting.length) return [];
    const total = waiting.reduce((n, p) => n + p.amount, 0);
    return [
      {
        tone: 'warn',
        tag: 'Payments',
        title: `${waiting.length} ${waiting.length === 1 ? 'payment' : 'payments'} to approve, RM${total.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
        detail: 'Reviewed by Finance for the departments you monitor. Give a comment to approve or return.',
        go: { view: 'finance' },
      },
    ];
  }

  // ----- Home -----

  /** What is waiting for this person: payments to review, approve or release, and closes to review or approve. */
  async home(user: User): Promise<HomeItem[]> {
    const a = finActor(user);
    if (!a || a.kind === 'viewer') return [];
    const d = await this.desk(user);
    const count = { review: 0, approve: 0, release: 0, closeReview: 0, closeApprove: 0, lapsed: 0 };
    const slow = { review: [] as string[], approve: [] as string[], close: [] as string[] };
    const short: string[] = [];
    const watched: string[] = [];
    let approveRm = 0;
    for (const c of d.companies) {
      for (const p of c.payments) {
        // Each person is reminded of their own level only: the CEO of CEO-level payments, the Finance Director of
        // Director-level ones, the team leader of leader-level ones. They can still act on lower levels on the screen.
        // Since 1 Nov 2026 the Finance Director is reminded of every payment to approve; the CEO of large ones.
        const ownLevel = a.kind === 'director' || (a.kind === 'ceo' && p.amount >= RULES.financePayments.value.ceoNoticeFrom) ? p.needs : 'none';
        if (p.may.includes('review') && (a.kind === 'leader' || a.kind === 'deputy')) count.review += 1;
        if (p.may.includes('approve') && p.needs === ownLevel) {
          count.approve += 1;
          approveRm += p.amount;
        }
        if (p.may.includes('release') && a.kind !== 'ceo') count.release += 1;
        if (p.status === 'returned' && p.steps[p.steps.length - 1].byId === FIN_AUTO.byId && paymentPreparers(p).includes(user.id)) count.lapsed += 1;
        if (isLead(a) && p.watch.length && p.releasedOn && daysBetween(p.releasedOn, this.today()) <= 31) watched.push(`${c.companyName} ${p.id} (${lastBy(p.steps, ['released'])?.by ?? ''})`);
        // Slow steps (Fauzan, 1 Nov 2026: "3. Ok"): a payment waiting too long for review or approval is shown to the
        // FD and the CEO, whoever has to act on it.
        if (isLead(a) && (p.status === 'prepared' || p.status === 'reviewed')) {
          const since = p.steps[p.steps.length - 1].at.slice(0, 10);
          if (daysBetween(since, this.today()) >= d.settings.escalateAfterDays) (p.status === 'prepared' ? slow.review : slow.approve).push(`${c.companyName} ${p.id}`);
        }
      }
      if (c.close.may.includes('review') && (a.kind === 'leader' || a.kind === 'deputy')) count.closeReview += 1;
      if (c.close.may.includes('approve')) count.closeApprove += 1;
      if (a.kind !== 'data_entry') for (const x of c.cash) if (x.short7) short.push(`${c.companyName} ${x.bank} short RM${x.short7.toFixed(2)}`);
      const closeBy = nextMonthDay(d.period, d.settings.closeApproveByDay);
      if (isLead(a) && (c.close.status === 'prepared' || c.close.status === 'reviewed') && this.today() > closeBy) slow.close.push(`${c.companyName} (${c.close.status})`);
    }
    const items: HomeItem[] = [];
    const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    if (count.approve)
      items.push({
        tone: 'warn',
        tag: 'Finance',
        title: `${s(count.approve, 'payment', 'payments')} to approve, RM${approveRm.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`,
        detail: 'Give a comment to approve. The bank portal pays; record the bank reference after release.',
        go: { view: 'finance' },
      });
    if (count.review)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(count.review, 'payment', 'payments')} to review`, detail: 'Prepared by your team', go: { view: 'finance' } });
    if (count.release && (a.kind === 'leader' || a.kind === 'deputy' || a.kind === 'director'))
      items.push({ tone: 'info', tag: 'Finance', title: `${s(count.release, 'approved payment', 'approved payments')} to release in the bank portal`, detail: 'Record the bank reference once paid', go: { view: 'finance' } });
    if (count.lapsed)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(count.lapsed, 'approval', 'approvals')} lapsed and came back to you`, detail: `Not released within ${d.settings.approvalExpiryDays} days; resubmit for a fresh approval`, go: { view: 'finance' } });
    const list = (xs: string[]) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? ` and ${xs.length - 4} more` : '');
    if (short.length)
      items.push({ tone: 'crit', tag: 'Finance', title: `${s(short.length, 'bank account', 'bank accounts')} short of cash for payments due in 7 days`, detail: list(short), go: { view: 'finance' } });
    if (watched.length)
      items.push({ tone: 'info', tag: 'Finance', title: `${s(watched.length, 'payment', 'payments')} reviewed and released by the same person in the last month`, detail: `Allowed; shown to watch. ${list(watched)}`, go: { view: 'finance' } });
    if (slow.review.length)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(slow.review.length, 'payment', 'payments')} waiting ${d.settings.escalateAfterDays}+ days for review`, detail: list(slow.review), go: { view: 'finance' } });
    if (slow.approve.length)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(slow.approve.length, 'payment', 'payments')} waiting ${d.settings.escalateAfterDays}+ days for approval`, detail: list(slow.approve), go: { view: 'finance' } });
    if (slow.close.length)
      items.push({ tone: 'crit', tag: 'Finance', title: `${s(slow.close.length, 'month-end close', 'month-end closes')} for ${d.period} not approved by day ${d.settings.closeApproveByDay}`, detail: list(slow.close), go: { view: 'finance' } });
    if (count.closeApprove)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(count.closeApprove, 'month-end close', 'month-end closes')} ready for approval`, detail: `For ${d.period}`, go: { view: 'finance' } });
    if (count.closeReview)
      items.push({ tone: 'warn', tag: 'Finance', title: `${s(count.closeReview, 'month-end close', 'month-end closes')} to review`, detail: `For ${d.period}`, go: { view: 'finance' } });
    return items;
  }
}