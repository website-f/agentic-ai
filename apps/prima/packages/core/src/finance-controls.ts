import { ArrivalCashService } from './arrival-cash';
import { ExceptionalGuardCashService } from './exceptional-guard-cash';
import { finBudgetInForce } from "./finance-plan3";
import { finBudgetRevisionAction } from "./finance-plan3";
import { finLeadAuthors } from "./finance-plan3";
import { finPlan3View } from "./finance-plan3";
import { finSeqNext } from "./finance-plan3";
import { finThreeStatementAction } from "./finance-plan3";
import { AccessDenied } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { FinanceDeskService } from "./finance";
import { ageTotal } from "./finance";
import { finArActive } from "./finance";
import { finMatchReceipts } from "./finance";
import { finUnmatchReceipts } from "./finance";
import { finArStale } from "./finance";
import { finAutoReconcile } from "./finance";
import { finBankRecResult } from "./finance";
import { finBankRecStale } from "./finance";
import { finAfterPayment } from "./finance";
import { finDefaults } from "./finance";
import { FIN_AUTO } from "./finance";
import { finActor } from "./finance";
import { finCloseCheck } from "./finance";
import { isFinCoo } from "./finance";
import { isLead } from "./finance";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinActor } from "./finance";
import { RULES } from "./rules";
import { finPurchasesToPay } from "./finance";
import { finCreditAction } from "./finance-credit";
import { finCreditHome } from "./finance-credit";
import { finCreditView } from "./finance-credit";
import { finSupplierStatementAction } from "./finance-supplier-statements";
import { finSupplierStatementHome } from "./finance-supplier-statements";
import { finSupplierStatementsView } from "./finance-supplier-statements";
import { finAssetAction } from "./finance-yearend";
import { finAuditRequestAction } from "./finance-yearend";
import { finScheduleAction } from "./finance-yearend";
import { finWhtAction } from "./finance-yearend";
import { finYearEndHome } from "./finance-yearend";
import { finYearEndView } from "./finance-yearend";
import { finBankingHome } from "./finance-banking";
import { finBankingView } from "./finance-banking";
import { finChargeAction } from "./finance-banking";
import { finFdAction } from "./finance-banking";
import { finMatchFds } from "./finance-banking";
import { finUnmatchFds } from "./finance-banking";
import { finContractEndHome } from "./finance-contract-end";
import { finContractEndView } from "./finance-contract-end";
import { finDepositAction } from "./finance-contract-end";
import { finMatchDeposits } from "./finance-contract-end";
import { finUnmatchDeposits } from "./finance-contract-end";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import { dateOf } from "./time";
import { toMs } from "./time";
import { FIN_PLAN_LINES } from "./types";
import type { Contract } from "./types";
import type { FinAgeBuckets } from "./types";
import type { FinAgeing } from "./types";
import type { FinArCase } from "./types";
import type { FinArReason } from "./types";
import type { FinEInvoice } from "./types";
import type { FinEInvoiceMonth } from "./types";
import type { FinPayee } from "./types";
import type { FinPayeeKind } from "./types";
import type { FinPlan } from "./types";
import type { FinPlanFigures } from "./types";
import type { FinPlanLine } from "./types";
import type { FinSign } from "./types";
import type { FinSst } from "./types";
import type { FinCustomsClaim } from "./types";
import type { FinSstReturn } from "./types";
import type { FinStatement } from "./types";
import type { FinStatementLine } from "./types";
import type { FinBankRec } from "./types";
import type { FinLedgerLine } from "./types";
import type { FinSettingsValues } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import { FinMatchRule } from "./types";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { jaOwns } from "./service";
import type { HomeItem } from "./service";
import type { HomeLink } from "./service";
import type { HomeTile } from "./service";
import { finTaxCalendar } from "./finance-tax-calendar";
import { finTaxFile } from "./finance-tax-calendar";
import { finAdvanceAction } from "./finance-cash";
import { finAdvanceAdd } from "./finance-cash";
import { finAdvanceOverdue } from "./finance-cash";
import { finAdvancePrecheck } from "./finance-cash";
import { finCardAction } from "./finance-cash";
import { finCashHome } from "./finance-cash";
import { finCashMine } from "./finance-cash";
import { finCashView } from "./finance-cash";
import { finMandateAction } from "./finance-cash";
import { finPettyAction } from "./finance-cash";
import { finPettyTopUpLink } from "./finance-cash";
import { finPettyTopUpPrecheck } from "./finance-cash";
import type { FinCashCtx } from "./finance-cash";
import { FIN_REGULAR_RULE } from "./finance-regular";
import { finGuaranteeAction } from "./finance-regular";
import { finHostelPaidOn } from "./finance-regular";
import { finHostelUnseen } from "./finance-regular";
import { finMatchRegular } from "./finance-regular";
import { finRegularAction } from "./finance-regular";
import { finRegularDues } from "./finance-regular";
import { finRegularExpected } from "./finance-regular";
import { finRegularHome } from "./finance-regular";
import { finRegularState } from "./finance-regular";
import { finRegularView } from "./finance-regular";
import { finUnmatchRegular } from "./finance-regular";
import type { FinRegularCtx } from "./finance-regular";
import type { FinCheckSection } from "./types";
import type { HostelBill } from "./types";
import type { StaffPayLine } from "./types";
import type { StaffPayRun } from "./types";
import { finStampAction } from "./finance-stamp";
import { finStampHome } from "./finance-stamp";
import { finStampView } from "./finance-stamp";
import { finIcAction } from "./finance-intercompany";
import { finIcExceptions } from "./finance-intercompany";
import { finIcPairs } from "./finance-intercompany";
import { finIcView } from "./finance-intercompany";
import { finCoaAction } from "./finance-ledger";
import { finFiguresAction } from "./finance-ledger";
import { finLedgerView } from "./finance-ledger";
import { finSqlApply } from "./finance-ledger";
import { finSqlBlockers } from "./finance-ledger";
import { finSqlDiscoveryAction } from "./finance-ledger";
import type { SqlAccountReader } from "./finance-ledger";
import { finCash13 } from "./finance-forecast13";
import { finCash13Action } from "./finance-forecast13";
import { finDashboardRow } from "./finance-pack";
import { finPackData } from "./finance-pack";
import { finPackReview } from "./finance-pack";
import { finDailyCashAction } from "./finance-daily-cash";
import { finDailyCashCollectorView } from "./finance-daily-cash";
import { finDailyCashHome } from "./finance-daily-cash";
import { finDailyCashView } from "./finance-daily-cash";
import type { FinDailyCashCtx } from "./finance-daily-cash";
import { finAllocateAction } from "./finance-billing";
import { finBillingAction } from "./finance-billing";
import { finGovtAction } from "./finance-billing";
import { finMatchGovt } from "./finance-billing";
import { finMoneyInHome } from "./finance-billing";
import { finMoneyInView } from "./finance-billing";
import { finUnmatchGovt } from "./finance-billing";
import type { EvidenceDoc } from "./types";
import { finDailyCashDecisions } from "./finance-daily-cash";
import { finDailyCashReceiptsDue } from "./finance-daily-cash";
import { sha256Hex } from "./audit";



const prevMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

const KINDS: FinPayeeKind[] = ['supplier', 'statutory', 'payroll', 'tax', 'intercompany', 'other'];
const round2 = (n: number) => Math.round(n * 100) / 100;

function money(v: unknown, field: string, allowNegative = false): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : Number.NaN;
  if (!Number.isFinite(n)) throw new BadRequest(`${field} must be an amount in RM.`);
  if (!allowNegative && n < 0) throw new BadRequest(`${field} cannot be negative.`);
  if (Math.abs(n) > 10_000_000_000) throw new BadRequest(`${field} is too large.`);
  return round2(n);
}

function period(v: unknown, field = 'Month'): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new BadRequest(`${field} must be a month (YYYY-MM).`);
  return v;
}

function addMonthsP(p: string, k: number): string {
  const [y, m] = p.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function lastDayOf(p: string): IsoDate {
  const [y, m] = p.split('-').map(Number);
  return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** The SST taxable period (two months) a month falls in, given the month the cycle starts. */
/** The budget and actual behind one variance key ("YYYY-MM:line"), or null when the key is not a month and line. */
/** A staff payroll counts for Finance only once its final approval is given: the VC's consent on this base, or the COO's approval in HR's
 * flow (PR #51, which renames the stage), or paid. The CoS-only 'approved' stage is not final. Kept as plain strings so either base compiles. */
const FIN_PAYROLL_FINAL: readonly string[] = ['consented', 'coo_approved', 'paid'];
export const finPayrollFinal = (stage: string): boolean => FIN_PAYROLL_FINAL.includes(stage);

export function finVarianceFigures(plan: FinPlan, key: string): { budget: number; actual: number | null } | null {
  const m = /^(\d{4})-(\d{2}):([a-z_]+)$/.exec(key);
  if (!m || Number(m[1]) !== plan.year || !(FIN_PLAN_LINES as readonly string[]).includes(m[3])) return null;
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return null;
  const line = m[3] as FinPlanLine;
  // The budget in force: approved revisions apply from their month (3 Nov 2026).
  return { budget: finBudgetInForce(plan)[line]?.[i] ?? 0, actual: plan.actuals[line]?.[i] ?? null };
}
const finSameFigures = (a: { budget: number; actual: number | null } | undefined, b: { budget: number; actual: number | null } | undefined) =>
  !!a && !!b && Math.abs(a.budget - b.budget) < 0.005 && (a.actual == null ? b.actual == null : b.actual != null && Math.abs(a.actual - b.actual) < 0.005);

/** The service tax inside a receipt that includes it (Fauzan, 1 Nov 2026: 8/108 of the payment received). */
export function finSstOnReceipt(received: number, rate: number): number {
  return Math.round(((received * rate) / (1 + rate)) * 100) / 100;
}

export function sstPeriodOf(month: string, cycleStartMonth: number): { from: string; to: string; dueOn: IsoDate } {
  const [y, m] = month.split('-').map(Number);
  const offset = (((m - cycleStartMonth) % 2) + 2) % 2;
  const from = addMonthsP(`${y}-${String(m).padStart(2, '0')}`, -offset);
  const to = addMonthsP(from, 1);
  return { from, to, dueOn: lastDayOf(addMonthsP(to, 1)) };
}

/** Late payment penalty on unpaid service tax: 10% in the first 30 days after the due date, then 15% and 15% more. */
export function sstPenalty(tax: number, dueOn: IsoDate, on: IsoDate): number {
  if (on <= dueOn || tax <= 0) return 0;
  const late = daysBetween(dueOn, on);
  const tiers = RULES.financeSst.value.penaltyTiers;
  const pct = tiers.slice(0, Math.min(tiers.length, Math.ceil(late / 30))).reduce((a, b) => a + b, 0);
  return round2(tax * pct);
}

/**
 * Reads a bank statement saved as CSV: date, description, reference, amount (money out negative) or date,
 * description, reference, debit (out), credit (in). Dates as YYYY-MM-DD or DD/MM/YYYY. A header row is skipped.
 */
/**
 * Reads the bank statement as the bank gives it (automation A7, Fauzan 2 Nov 2026): Maybank, CIMB, Public Bank, RHB,
 * Bank Islam and others export different columns. With a header row Prima finds the date, description, reference and
 * either one amount or debit/withdrawal and credit/deposit columns by their names, and ignores a balance column. Without a
 * header, 4 columns (date, description, reference, amount) or 5 (… debit, credit). Dates YYYY-MM-DD, DD/MM/YYYY,
 * DD-MM-YYYY, DD/MM/YY or "01 Oct 2026"; amounts may carry thousands commas, "RM", a trailing "-" or "DR"/"CR".
 */
export function parseStatementCsv(csv: string): Omit<FinStatementLine, 'id' | 'match'>[] {
  if (typeof csv !== 'string' || !csv.trim()) throw new BadRequest('Paste the statement as CSV.');
  if (csv.length > 400_000) throw new BadRequest('The statement is too large; load it one month at a time.');
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length > 3000) throw new BadRequest('At most 3,000 lines per statement.');
  const sep = rows.some((r) => r.includes('\t')) && !rows.some((r) => r.includes(',')) ? '\t' : rows.slice(0, 5).every((r) => r.includes(';') && !r.includes(',')) ? ';' : ',';
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === sep && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const toDate = (d: string): IsoDate | null => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(d);
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(d);
    if (m && MONTHS.includes(m[2].toUpperCase())) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(MONTHS.indexOf(m[2].toUpperCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };
  const num = (v: string) => {
    let t = (v ?? '').trim().toUpperCase().replace(/RM|,|\s/g, '');
    if (t === '' || t === '-') return 0;
    let sign = 1;
    if (t.endsWith('DR')) {
      sign = -1;
      t = t.slice(0, -2);
    } else if (t.endsWith('CR')) t = t.slice(0, -2);
    if (t.endsWith('-')) {
      sign = -sign;
      t = t.slice(0, -1);
    } else if (t.endsWith('+')) t = t.slice(0, -1);
    if (/^\(.*\)$/.test(t)) {
      sign = -sign;
      t = t.slice(1, -1);
    }
    return sign * Number(t);
  };
  // A header row: find the columns by name.
  const head = split(rows[0]).map((c) => c.toLowerCase());
  const col = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  const hasHeader = !toDate(split(rows[0])[0] ?? '') && head.some((h) => /date|tarikh/.test(h));
  const map = hasHeader
    ? {
        date: col(/^(transaction |trans\.? |posting |entry )?date|tarikh/),
        desc: col(/desc|particular|transaction$|details|keterangan|narrative/),
        ref: col(/ref|cheque|chq|no\.?$/),
        debit: col(/debit|withdraw|money out|pengeluaran/),
        credit: col(/credit|deposit|money in|deposit/),
        amount: col(/^(transaction )?amount|jumlah/),
      }
    : null;
  if (map && map.date < 0) throw new BadRequest('The header has no date column.');
  if (map && map.amount < 0 && (map.debit < 0 || map.credit < 0)) throw new BadRequest('The header needs an amount column, or both debit (withdrawal) and credit (deposit) columns.');
  const lines: Omit<FinStatementLine, 'id' | 'match'>[] = [];
  rows.forEach((r, i) => {
    if (map && i === 0) return;
    const c = split(r);
    const date = toDate(c[map ? map.date : 0] ?? '');
    if (!date) {
      if (i === 0) return; // header
      // Opening or closing balance rows and page footers in a bank export carry no date.
      if (map && !/\d/.test(c[map.date] ?? '')) return;
      throw new BadRequest(`Line ${i + 1}: the date "${c[map ? map.date : 0]}" is not a date (YYYY-MM-DD, DD/MM/YYYY or 01 Oct 2026).`);
    }
    let amount: number;
    let description: string;
    let ref: string;
    if (map) {
      amount = map.amount >= 0 && map.debit < 0 ? num(c[map.amount] ?? '') : num(c[map.credit] ?? '') - Math.abs(num(c[map.debit] ?? ''));
      description = map.desc >= 0 ? (c[map.desc] ?? '') : '';
      ref = map.ref >= 0 && map.ref !== map.desc ? (c[map.ref] ?? '') : '';
    } else {
      if (c.length === 4) amount = num(c[3]);
      else if (c.length === 5) amount = num(c[4]) - num(c[3]);
      else throw new BadRequest(`Line ${i + 1}: expected 4 columns (date, description, reference, amount) or 5 (… debit, credit), or a header row naming the columns.`);
      description = c[1] ?? '';
      ref = c[2] ?? '';
    }
    if (!Number.isFinite(amount)) throw new BadRequest(`Line ${i + 1}: the amount is not a number.`);
    lines.push({ date, description: noSecrets(description.slice(0, 200), `Line ${i + 1}`), ref: ref.slice(0, 80), amount: round2(amount) });
  });
  if (!lines.length) throw new BadRequest('No statement lines found.');
  return lines;
}

/**
 * Client payment reminders (automation A12, Fauzan 2 Nov 2026): for every open invoice case 30, 60 or 90+ days after
 * the invoice date with no reminder in the last 30 days, Prima drafts the letter with the invoice details. Staff read
 * it, send it themselves and mark it sent (a "reminder" note on the case). Nothing is sent by Prima.
 */
export function finArReminders(f: FinStatus, today: IsoDate) {
  const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (f.arCases ?? [])
    .filter((c) => finArActive(c) && c.outstanding > 0)
    .map((c) => {
      const days = daysBetween(c.invoiceDate, today);
      const last = [...c.log].reverse().find((x) => x.kind === 'reminder' || x.kind === 'demand_letter');
      const level = days >= 90 ? 3 : days >= 60 ? 2 : days >= 30 ? 1 : 0;
      return { c, days, last, level };
    })
    .filter((x) => x.level > 0 && (!x.last || daysBetween(x.last.at.slice(0, 10), today) >= 30))
    .map(({ c, days, last, level }) => ({
      caseId: c.id,
      invoiceNo: c.invoiceNo,
      customer: c.customer,
      outstanding: c.outstanding,
      days,
      level,
      lastReminder: last ? last.at.slice(0, 10) : null,
      subject: `${level === 3 ? 'Final reminder' : level === 2 ? 'Second reminder' : 'Payment reminder'}: invoice ${c.invoiceNo} (${rm(c.outstanding)})`,
      text: [
        `Dear ${c.customer},`,
        '',
        `Our records show that invoice ${c.invoiceNo} dated ${c.invoiceDate} for ${rm(c.amount)} still has ${rm(c.outstanding)} unpaid, ${days} days after the invoice date.`,
        level === 1
          ? 'We would be grateful if you could arrange payment, or let us know if there is anything about the invoice we should look at.'
          : level === 2
            ? 'This is our second reminder. Please arrange payment within 14 days, or tell us what is holding it up so we can resolve it together.'
            : 'This is our final reminder before the matter is escalated. Please settle the amount within 7 days or contact us immediately.',
        'If payment has already been made, please send us the payment reference and accept our thanks.',
        '',
        'Yours faithfully,',
        'Finance Department',
      ].join('\n'),
    }));
}

/** Learned explanations (A6): the unmatched lines of a statement a rule fits are explained by Prima. */
export function finApplyMatchRules(f: FinStatus, st: FinStatement, at: IsoDateTime): { statement: FinStatement; rules: FinMatchRule[]; applied: number } {
  const rules = (f.matchRules ?? []).map((r) => ({ ...r }));
  let applied = 0;
  const lines = st.lines.map((l) => {
    if (l.match) return l;
    const text = norm(`${l.description} ${l.ref}`);
    const fits = rules.filter((r) => (r.bankId == null || r.bankId === st.bankId) && (r.direction === 'in' ? l.amount > 0 : l.amount < 0) && Math.abs(l.amount) <= r.maxAmount + 0.005 && r.pattern.length >= 3 && text.includes(r.pattern));
    // Two rules that fit differently leave it for a person.
    if (fits.length !== 1) return l;
    fits[0].used += 1;
    applied += 1;
    return { ...l, match: { kind: 'other' as const, note: `${fits[0].note} (remembered rule)`, by: FIN_AUTO.by, byId: FIN_AUTO.byId, at, ruleId: fits[0].id } };
  });
  return { statement: { ...st, lines }, rules, applied };
}

const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * SQL Account's ledger for the bank account, exported as CSV (GL Ledger or Cash Book listing): date, document number,
 * description, then debit and credit (money in, money out), or one signed amount. Dates YYYY-MM-DD or DD/MM/YYYY.
 */
export function parseLedgerCsv(csv: string): Omit<FinLedgerLine, 'id'>[] {
  if (typeof csv !== 'string' || !csv.trim()) throw new BadRequest("Paste SQL Account's ledger for this bank account as CSV.");
  if (csv.length > 600_000) throw new BadRequest('The ledger is too large; export one month at a time.');
  const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rows.length > 5000) throw new BadRequest('At most 5,000 ledger lines per month.');
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const toDate = (d: string): IsoDate | null => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  };
  const num = (v: string) => (v === '' ? 0 : Number(v.replace(/,/g, '')));
  const out: Omit<FinLedgerLine, 'id'>[] = [];
  rows.forEach((r, i) => {
    const c = split(r);
    const date = toDate(c[0] ?? '');
    if (!date) {
      if (i === 0) return; // header
      throw new BadRequest(`Ledger line ${i + 1}: the date "${c[0]}" is not YYYY-MM-DD or DD/MM/YYYY.`);
    }
    let amount: number;
    if (c.length === 4) amount = num(c[3]);
    else if (c.length === 5) amount = num(c[3]) - num(c[4]);
    else throw new BadRequest(`Ledger line ${i + 1}: expected date, document no, description, then debit and credit (or one amount).`);
    if (!Number.isFinite(amount)) throw new BadRequest(`Ledger line ${i + 1}: the amount is not a number.`);
    out.push({ date, docNo: (c[1] ?? '').slice(0, 60), description: noSecrets((c[2] ?? '').slice(0, 200), `Ledger line ${i + 1}`), amount: round2(amount) });
  });
  if (!out.length) throw new BadRequest('No ledger lines found.');
  return out;
}

/** Which Checks section each kind of Finance home item belongs to. */
export const FIN_CHECK_SECTION_OF: Record<string, FinCheckSection> = {
  'ss.toCheck': 'out', 'ss.toReview': 'out', 'cr.overridesToSee': 'in', 'cr.balanceStale': 'in', 'ye.toPost': 'tax', 'ye.whtLate': 'tax', 'ye.whtSoon': 'tax', 'ye.whtToCheck': 'tax', 'ye.auditMine': 'tax', 'ye.auditLate': 'tax',
  verify: 'out', 'reg.late': 'out', 'reg.dueSoon': 'out', 'reg.toPay': 'out', 'reg.noBill': 'out', 'reg.toCheck': 'out', 'reg.gToCheck': 'out', 'reg.expiring': 'out',
  'reg.gExpiring': 'out', 'reg.gClaim': 'out', 'reg.gWaiting': 'out', 'reg.hostelUnseen': 'out', 'reg.hostelOverdue': 'out', 'dc.toApprove': 'out', 'dc.toPrepare': 'out',
  'dc.toTransfer': 'out', 'dc.toClose': 'out', 'dc.toSettle': 'out', 'dc.lateSettle': 'out', 'dc.differences': 'out', 'cash.mandateIssues': 'out', 'cash.mandateToCheck': 'out', 'cash.mandateMissing': 'out',
  bankFail: 'bank', 'reg.notSeen': 'bank', 'bk.fdDecide': 'bank', 'bk.fdMatured': 'bank', 'bk.fdToCheck': 'bank', 'bk.chargesOver': 'bank',
  arStale: 'in', arToReview: 'in', writeOffs: 'in', arApprove: 'in', ageReview: 'in', receiptsWaiting: 'in', 'mi.billMissing': 'in', 'mi.billToCheck': 'in',
  'mi.govtStale': 'in', 'mi.govtOverdue': 'in', 'mi.govtFollowToday': 'in', 'mi.unidentified': 'in', 'mi.unidentifiedLate': 'in', 'mi.allocToCheck': 'in',
  'ce.endsLate': 'in', 'ce.endsOpen': 'in', 'ce.depositToCheck': 'in', 'ce.retentionUpdate': 'in', 'reg.gDue': 'cash',
  'stamp.stampLate': 'in', 'stamp.stampDue': 'in', 'stamp.stampToCheck': 'in', 'stamp.refundLate': 'in', 'stamp.refundOpen': 'in',
  'cash.advOverdue': 'cash', 'cash.advToCheck': 'cash', 'cash.pettyToCheck': 'cash', 'cash.cardToCheck': 'cash', 'cash.pettyCount': 'cash', 'cash.pettyTopUp': 'cash',
  'cash.cardLoad': 'cash', 'cash.cardToReview': 'cash', 'c13.short': 'cash', 'c13.review': 'cash',
  sstLate: 'tax', sstSoon: 'tax', einvLate: 'tax', einvReview: 'tax', varOwn: 'tax', varLate: 'tax', varAccept: 'tax', budgets: 'tax', budgetNext: 'tax', 'tax.late': 'tax', 'tax.due': 'tax', icOpen: 'tax',
};

export class FinanceControlsService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private desk: FinanceDeskService,
  ) {}

  private now(): IsoDateTime {
    return this.clock();
  }
  private today(): IsoDate {
    return dateOf(this.clock());
  }
  private sign(user: User, comment = ''): FinSign {
    return { by: user.name, byId: user.id, at: this.now(), comment };
  }
  private reviewer(a: FinActor) {
    return isLead(a) || a.kind === 'leader' || a.kind === 'deputy';
  }
  private senior(a: FinActor) {
    return isLead(a) || a.kind === 'leader';
  }

  /** Runs one change on a company's finance row under its lock. */
  private async change<T>(
    user: User,
    companyId: Id,
    fn: (f: FinStatus, a: FinActor, s: FinSettingsValues) => { patch: Partial<FinStatus>; action: string; summary: string; result: T; also?: (tx: Store) => Promise<void> },
  ) {
    return this.store.transaction(async (tx) => {
      const a = this.desk.actor(user);
      const f = await this.desk.row(tx, user, a, companyId);
      const out = fn(f, a, await this.desk.settings(tx));
      if (Object.keys(out.patch).length) await tx.update('finStatus', f.id, out.patch);
      if (out.also) await out.also(tx);
      await this.desk.log(tx, user, f, out.action, out.summary.slice(0, 900));
      return out.result;
    });
  }

  // ---------- Payees: paid to the right person ----------

  async payeeAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change(user, companyId, (f, a) => {
      const payees = f.payees ?? [];
      if (action === 'add') {
        const kind = KINDS.find((k) => k === input.kind);
        if (!kind) throw new BadRequest(`Payee type must be one of: ${KINDS.join(', ')}.`);
        const name = noSecrets(text(input.name, 'Payee name', 2, 120), 'Payee name');
        const regNo = noSecrets(text(input.regNo, 'Registration number (SSM, KWSP, LHDN or Customs)', 3, 40), 'Registration number');
        const bank = text(input.bank, 'Bank', 2, 60);
        const accountLast4 = typeof input.accountLast4 === 'string' ? input.accountLast4.trim() : '';
        if (!/^\d{4}$/.test(accountLast4)) throw new BadRequest('Give only the last 4 digits of the account. The full number stays in SQL Account and the bank portal.');
        const accountName = noSecrets(text(input.accountName, 'Account name as the bank shows it', 2, 120), 'Account name');
        if (payees.some((p) => p.status !== 'blocked' && norm(p.regNo) === norm(regNo)))
          throw new BadRequest('A payee with this registration number is already on the list. Change its bank details instead.');
        const p: FinPayee = {
          id: `payee-${f.companyId}-${String(payees.length + 1).padStart(3, '0')}`,
          name,
          kind,
          regNo,
          bank,
          accountLast4,
          accountName,
          status: 'pending',
          entered: this.sign(user, typeof input.source === 'string' ? input.source.trim().slice(0, 200) : ''),
          verified: null,
          history: [],
        };
        return { patch: { payees: [...payees, p] }, action: 'finance.payee.added', summary: `Payee ${p.name} (${p.bank} ****${p.accountLast4}) added; waiting for call-back verification.`, result: p };
      }
      const p = payees.find((x) => x.id === input.payeeId);
      if (!p) throw new NotFound('Payee');
      const enteredBy = p.entered.byId;
      if (action === 'verify') {
        if (p.status !== 'pending') throw new BadRequest(`${p.name} is ${p.status}, not waiting for verification.`);
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO verifies payees)');
        if (enteredBy === user.id) throw new AccessDenied('view', '(nobody verifies bank details they entered or changed)');
        const method = (['callback', 'document', 'bank_name_check'] as const).find((m) => m === input.method);
        if (!method) throw new BadRequest('How was it verified: callback, document or bank_name_check?');
        const contact = noSecrets(text(input.contact, 'Who confirmed it on the payee side', 2, 120), 'Contact');
        const numberSource = text(input.numberSource, 'Where the phone number or document came from (not the request itself)', 5, 200);
        if (/same email|from the request|in the email|dalam emel/i.test(numberSource))
          throw new BadRequest('Call back on a number from an earlier record or the contract, never the number in the request.');
        const comment = requireComment(input.comment, 'verify');
        const next: FinPayee = { ...p, status: 'verified', verified: { ...this.sign(user, comment), method, contact, numberSource } };
        return {
          patch: { payees: payees.map((x) => (x.id === p.id ? next : x)) },
          action: 'finance.payee.verified',
          summary: `Payee ${p.name} ****${p.accountLast4} verified by ${method} with ${contact} (${numberSource}): ${comment}`,
          result: next,
        };
      }
      if (action === 'change') {
        if (p.status === 'blocked') throw new BadRequest(`${p.name} is blocked.`);
        const bank = text(input.bank, 'Bank', 2, 60);
        const accountLast4 = typeof input.accountLast4 === 'string' ? input.accountLast4.trim() : '';
        if (!/^\d{4}$/.test(accountLast4)) throw new BadRequest('Give only the last 4 digits of the new account.');
        const accountName = noSecrets(text(input.accountName, 'Account name as the bank shows it', 2, 120), 'Account name');
        const source = requireReason(input.source, 'record the change (what asked for it)');
        const next: FinPayee = {
          ...p,
          bank,
          accountLast4,
          accountName,
          status: 'pending',
          entered: this.sign(user, source),
          verified: null,
          history: [...p.history, { bank: p.bank, accountLast4: p.accountLast4, accountName: p.accountName, until: this.now(), by: user.name }],
        };
        const held = (f.payments ?? []).filter((x) => x.payeeId === p.id && ['prepared', 'reviewed', 'approved'].includes(x.status)).length;
        return {
          patch: { payees: payees.map((x) => (x.id === p.id ? next : x)) },
          action: 'finance.payee.changed',
          summary: `Payee ${p.name} bank details changed from ${p.bank} ****${p.accountLast4} to ${bank} ****${accountLast4} (${source}); ${held} payment(s) held until verified again.`,
          result: { ...next, held },
        };
      }
      if (action === 'block' || action === 'unblock') {
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO blocks payees)');
        const why = requireReason(input.comment, `${action} the payee`);
        const next: FinPayee = { ...p, status: action === 'block' ? 'blocked' : 'pending', verified: action === 'block' ? p.verified : null };
        return { patch: { payees: payees.map((x) => (x.id === p.id ? next : x)) }, action: `finance.payee.${action}`, summary: `Payee ${p.name} ${action}ed: ${why}`, result: next };
      }
      throw new BadRequest('Unknown payee action.');
    });
  }

  // ---------- Bank statements ----------

  /** Matches money out on the statement to released Prima payments from the same account (amount, then reference or date). */
  private autoMatch(f: FinStatus, st: FinStatement, user: User, ctl: FinSettingsValues) {
    const payments = [...(f.payments ?? [])];
    const taken = new Set(payments.filter((p) => p.cleared).map((p) => p.id));
    const lines = st.lines.map((l) => {
      if (l.match || l.amount >= 0) return l;
      const cands = payments.filter(
        (p) => p.status === 'released' && !taken.has(p.id) && p.bankId === st.bankId && Math.abs(p.amount + l.amount) < 0.005 && p.releasedOn,
      );
      const byRef = cands.filter((p) => p.bankRef && norm(`${l.ref} ${l.description}`).includes(norm(p.bankRef)));
      const byDate = cands.filter((p) => Math.abs(daysBetween(p.releasedOn!, l.date)) <= ctl.matchDays);
      const pick = byRef.length === 1 ? byRef[0] : byRef.length === 0 && byDate.length === 1 ? byDate[0] : null;
      if (!pick) return l;
      taken.add(pick.id);
      const i = payments.findIndex((x) => x.id === pick.id);
      payments[i] = { ...pick, cleared: { statementId: st.id, lineId: l.id, date: l.date } };
      return { ...l, match: { kind: 'payment' as const, paymentId: pick.id, by: `auto (${user.name})`, at: this.now() } };
    });
    return { statement: { ...st, lines }, payments };
  }

  // ---------- Regular payments and guarantees (Fauzan, 2 Nov 2026) ----------

  private ctx(user: User, a: FinActor): FinRegularCtx {
    return { user, a, today: this.today(), sign: (comment = '') => this.sign(user, comment), reviewer: this.reviewer(a), senior: this.senior(a) };
  }

  /**
   * What a wage month's approved staff payroll owes a body (automation A1, Fauzan 2 Nov 2026): EPF employee + employer;
   * PERKESO SOCSO + EIS (both shares) + LINDUNG 24 Jam, paid together through PERKESO; LHDN PCB; HRD Corp levy; and
   * zakat per zakat body. Null when that month is not approved yet.
   */
  private payrollOwes(runs: StaffPayRun[], wage: string, body: string): number | null {
    const run = runs.find((r) => r.period === wage);
    if (!run) return null;
    const sum = (f: (l: StaffPayLine) => number) => Math.round(run.lines.reduce((n, l) => n + f(l), 0) * 100) / 100;
    if (body === 'EPF') return sum((l) => l.epfEe + l.epfEr);
    if (body === 'PERKESO') return sum((l) => l.socsoEe + l.socsoEr + l.eisEe + l.eisEr + l.lindungEe);
    if (body === 'LHDN PCB') return sum((l) => l.pcb);
    if (body === 'HRD Corp') return sum((l) => l.hrd);
    return sum((l) => (l.zakatBody === body ? (l.zakat ?? 0) : 0));
  }

  /** Hire purchase, loans, bills, rent, insurance, statutory, zakat, tax and levies: add, check, change, end, bill, look again. */
  async regularAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    if (action === 'prepareDue') return this.prepareRegularDue(user, companyId, { items: Array.isArray(input.items) ? (input.items as { regularId: Id; period: string; sqlRef?: string }[]).slice(0, 100) : undefined });
    if (action === 'approveBatch') return this.desk.approveRegularBatch(user, companyId, input);
    const hostel = action === 'rematch' ? await this.hostelBills(companyId) : [];
    const contracts = action === 'rematch' ? await this.contractsOf([companyId]) : [];
    const runs = action === 'bill' ? (await this.store.list('staffPayRuns', { companyId: [companyId] })).filter((r) => r.companyId === companyId && finPayrollFinal(r.stage)) : [];
    const payrollOwes = (wage: string, body: string) => this.payrollOwes(runs, wage, body);
    return this.change<unknown>(user, companyId, (f, a, s) => {
      if (action === 'rematch') {
        const rg = finMatchRegular(f, f.statements ?? [], hostel, s, this.today(), this.now());
        // Deposits and retention paid back by clients (suggestion 3).
        const dp = f.clientDeposits?.length ? finMatchDeposits(rg.statements, f.clientDeposits, contracts, this.now()) : null;
        const fd = f.fixedDeposits?.length ? finMatchFds(dp?.statements ?? rg.statements, f.fixedDeposits, this.now()) : null;
        const found = rg.found + (dp?.found ?? 0) + (fd?.found ?? 0);
        return {
          also: this.stampHostel(f, hostel, rg.hostelSeen, () => false),
          patch: found
            ? { statements: fd?.statements ?? dp?.statements ?? rg.statements, regular: rg.regular, guarantees: rg.guarantees, ...(dp ? { clientDeposits: dp.deposits } : {}), ...(fd ? { fixedDeposits: fd.fds } : {}) }
            : {},
          action: 'finance.regular.rematched',
          summary: `Looked again on the loaded bank statements: ${found} direct debit(s), collateral or deposit refund(s) or hostel payment(s) found.`,
          result: { found },
        };
      }
      return finRegularAction({ ...this.ctx(user, a), payrollOwes }, f, action, input);
    });
  }

  /**
   * Automation A2 and A3 (Fauzan, 2 Nov 2026: "Yes proceed"): Prima fills in every regular transfer due within 7 days
   * (or the ones named) as a payment ready for review: payee, exact amount, account, due date, purpose, reference and
   * the bill or list as the document. EPF, PERKESO, PCB, HRD and staff zakat bills come straight from the approved
   * payroll, recorded by Prima. The person who presses the button is the preparer; review and approval stay with others.
   * Nothing is paid: the payments wait for review like any other.
   */
  async prepareRegularDue(user: User, companyId: Id, input: { items?: { regularId: Id; period: string; sqlRef?: string }[] } = {}) {
    const a = this.desk.actor(user);
    if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance staff prepare payments)');
    const today = this.today();
    const st = await this.desk.settings();
    const f0 = await this.store.get('finStatus', `fin-${companyId}`);
    if (!f0 || !(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
    const runs = (await this.store.list('staffPayRuns', { companyId: [companyId] })).filter((r) => r.companyId === companyId && finPayrollFinal(r.stage));
    const wanted = input.items?.length ? new Map(input.items.map((x) => [`${x.regularId}:${x.period}`, x])) : null;
    const candidates = (f0.regular ?? []).flatMap((r) =>
      r.status !== 'active' || r.method !== 'transfer'
        ? []
        : finRegularDues(r, addDays(today, FIN_REGULAR_RULE.aheadDays))
            .filter((d) => (wanted ? wanted.has(`${r.id}:${d.period}`) : ['due', 'late', 'no_bill'].includes(finRegularState(f0, r, d, today, st))))
            .filter((d) => !(d.paymentId && (f0.payments ?? []).some((p) => p.id === d.paymentId && p.status !== 'cancelled')))
            .map((d) => ({ r, d })),
    );
    // Bills worked out by the payroll are recorded by Prima first (A1/A2), so nobody types them.
    const fromPayroll = candidates.filter(({ r, d }) => !d.bill && r.amount == null && ((r.kind === 'statutory' && r.fromPayroll) || (r.kind === 'zakat' && r.zakatFor === 'staff')));
    const filled: string[] = [];
    if (fromPayroll.length)
      await this.change(user, companyId, (f) => {
        let regular = f.regular ?? [];
        for (const { r, d } of fromPayroll) {
          const wage = prevMonth(d.period);
          const owed = r.body ? this.payrollOwes(runs, wage, r.body) : null;
          if (owed == null || owed <= 0) continue;
          regular = regular.map((x) => (x.id !== r.id ? x : { ...x, dues: [...x.dues.filter((y) => y.period !== d.period), { ...d, bill: { by: FIN_AUTO.by, byId: FIN_AUTO.byId, at: this.now(), comment: '', amount: owed, doc: `Prima staff payroll ${wage}: ${r.body} list`, unusual: null } }] }));
          filled.push(`${r.name} ${d.period} RM${owed.toFixed(2)}`);
        }
        return { patch: filled.length ? { regular } : {}, action: 'finance.regular.bill_auto', summary: filled.length ? `Prima recorded from the approved staff payroll: ${filled.join('; ')}.` : 'No payroll amounts to record yet.', result: null };
      });
    const f = (await this.store.get('finStatus', `fin-${companyId}`))!;
    const prepared: { id: Id; regularId: Id; period: string; amount: number }[] = [];
    const skipped: { regularId: Id; period: string; name: string; reason: string }[] = [];
    for (const { r, d: d0 } of candidates) {
      const r1 = (f.regular ?? []).find((x) => x.id === r.id)!;
      const d = r1.dues.find((x) => x.period === d0.period) ?? d0;
      const amount = finRegularExpected(r1, d);
      if (amount == null) {
        skipped.push({ regularId: r.id, period: d.period, name: r.name, reason: 'The bill or contribution file is not recorded yet' });
        continue;
      }
      const sqlRef = (wanted?.get(`${r.id}:${d.period}`)?.sqlRef ?? `${r.reference} ${d.period}`).slice(0, 40);
      try {
        const p = await this.desk.createPayment(user, companyId, {
          regularId: r.id,
          regularPeriod: d.period,
          payeeId: r.payeeId,
          bankId: r.bankId,
          amount,
          dueOn: d.dueOn < today ? today : d.dueOn,
          purpose: `${r.name}, ${d.period} (${r.reference})`,
          sqlRef: sqlRef.length >= 2 ? sqlRef : `${d.period}`,
          evidence: [d.bill?.doc ?? `Regular payments list ${r.id}, checked by ${r.checked?.by ?? 'a second person'}`],
        });
        prepared.push({ id: p.id, regularId: r.id, period: d.period, amount });
      } catch (e) {
        skipped.push({ regularId: r.id, period: d.period, name: r.name, reason: (e as Error).message });
      }
    }
    return { prepared, skipped, filledFromPayroll: filled };
  }

  /** The tax and statutory calendar (A10): Finance marks a deadline filed with its reference. */
  async taxAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a) => {
      if (action !== 'file') throw new BadRequest('Unknown action.');
      return finTaxFile(f, input, this.sign(user), a.kind !== 'viewer' && a.kind !== 'coo');
    });
  }

  /** Insurance and bank guarantees: add, check, release, claim the collateral, extend, called, close. */
  /** Fixed deposits (suggestion 15): add, check, renew, uplift, close. */
  async fdAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finFdAction({ ...ctx, a }, f, action, input));
  }

  /** Bank charges (suggestion 16): what the bank agreed per account, and a month above it explained. */
  async chargeAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => {
      if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
      return finChargeAction({ ...ctx, a }, f, this.desk.closePeriod(), action, input);
    });
  }

  /** Supplier statements (suggestion 11): record the quarter's check for a big supplier, review it. */
  async supplierStatementAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finSupplierStatementAction({ ...ctx, a }, f, action, input));
  }

  /** Credit limits per private client (suggestion 4): set a limit, keep the balance, remove; see posts added after a warning. */
  async creditAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const clients = (await this.store.list('clientAccounts', { companyId: [companyId] })).filter((x) => x.companyId === companyId);
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finCreditAction({ ...ctx, a }, f, clients, action, input));
  }

  /** Withholding tax on payments to non-residents (suggestion 18): add, remit to LHDN, check. */
  async whtAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finWhtAction({ ...ctx, a }, f, action, input));
  }

  /** Prepayments and accruals (suggestion 21): add, post a month's journal, stop. */
  async scheduleAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finScheduleAction({ ...ctx, a }, f, action, input));
  }

  /** Fixed assets (suggestion 22): add, agree with SQL Account's register, dispose. */
  async assetAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finAssetAction({ ...ctx, a }, f, action, input));
  }

  /** Auditor requests (suggestion 23): add the items, mark each sent. */
  async auditAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finAuditRequestAction({ ...ctx, a }, f, action, input));
  }

  /** Client deposits and retention (suggestion 3): add, check, claim back, write off. */
  async depositAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const contracts = await this.contractsOf([companyId]);
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    const tenders = (await this.store.list('tenders', { companyId: [companyId] })).filter((t) => t.companyId === companyId);
    return this.change<unknown>(user, companyId, (f, a) => finDepositAction({ ...ctx, a }, f, contracts, action, input, tenders));
  }

  async guaranteeAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a) => finGuaranteeAction(this.ctx(user, a), f, action, input));
  }

  // ---------- Bank mandates, advances, petty cash and cards (Fauzan, 2 Nov 2026) ----------

  private async cashCtx(user: User, a: FinActor | null): Promise<FinCashCtx> {
    const users = new Map((await this.store.list('users')).map((u) => [u.id, u]));
    const st = await this.desk.settings();
    return {
      user,
      a,
      today: this.today(),
      sign: (comment = '') => this.sign(user, comment),
      reviewer: !!a && this.reviewer(a),
      senior: !!a && this.senior(a),
      userById: (id) => users.get(id),
      petty: { voucherMax: st.pettyVoucherMax, floatMax: st.pettyFloatMax },
      fs: st,
    };
  }

  /** Bank mandates: add a new version, check it (a second person), confirm it with the bank (yearly, or when someone leaves). */
  async mandateAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finMandateAction({ ...ctx, a }, f, action, input));
  }

  /**
   * Staff cash advances. 'add' prepares the advance's payment (review and approval as for any payment) and records the
   * advance against it; 'settle', 'check' and 'recover' follow.
   */
  async advanceAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const a = finActor(user);
    const ctx = await this.cashCtx(user, a);
    if (action === 'add') {
      const f0 = await this.store.get('finStatus', `fin-${companyId}`);
      if (!a || !f0 || !(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
      const pre = finAdvancePrecheck(ctx, f0, input);
      const p = await this.desk.createPayment(user, companyId, {
        payeeId: pre.payee.id,
        bankId: input.bankId,
        amount: pre.amount,
        dueOn: input.dueOn ?? this.today(),
        purpose: `Staff advance: ${pre.purpose} (settle by ${pre.settleBy})`,
        sqlRef: input.sqlRef,
        evidence: input.evidence,
        subject: input.subject,
        notDuplicate: input.notDuplicate,
      });
      return this.change<unknown>(user, companyId, (f) => finAdvanceAdd(ctx, f, pre, p.id));
    }
    const f0 = await this.store.get('finStatus', `fin-${companyId}`);
    const own = action === 'settle' && (f0?.advances ?? []).some((x) => x.id === input.advanceId && x.userId === user.id);
    if (a && !own) return this.change<unknown>(user, companyId, (f, a2) => finAdvanceAction({ ...ctx, a: a2 }, f, action, input));
    return this.ownChange(user, companyId, (f) => finAdvanceAction(ctx, f, action, input));
  }

  /** Petty cash: add a float, check it, vouchers (custodian), top-up (prepares the payment), monthly count, close. */
  async pettyAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const a = finActor(user);
    const ctx = await this.cashCtx(user, a);
    if (action === 'topup') {
      const f0 = await this.store.get('finStatus', `fin-${companyId}`);
      if (!a || !f0 || !(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
      const pre = finPettyTopUpPrecheck(ctx, f0, input.pettyId);
      const p = await this.desk.createPayment(user, companyId, {
        payeeId: pre.pc.payeeId,
        bankId: pre.pc.bankId,
        amount: pre.amount,
        dueOn: this.today(),
        purpose: `Petty cash top-up ${pre.pc.office}: ${pre.vouchers.length} voucher(s) ${pre.vouchers[0].date} to ${pre.vouchers[pre.vouchers.length - 1].date}`,
        sqlRef: typeof input.sqlRef === 'string' && input.sqlRef.trim() ? input.sqlRef : `PC-${pre.pc.id}-${pre.pc.topUps.length + 1}`,
        evidence: pre.vouchers.slice(0, RULES.financePayments.value.maxEvidence - 1).map((v) => v.receipt).concat([`Petty cash vouchers ${pre.vouchers.map((v) => v.id.split('-').pop()).join(', ')}`]),
        notDuplicate: 'Petty cash top-up for the vouchers listed',
      });
      // Re-checked under the lock: vouchers added meanwhile wait for the next top-up.
      return this.change<unknown>(user, companyId, (f) => finPettyTopUpLink(f, { ...pre, pc: (f.pettyCash ?? []).find((x) => x.id === pre.pc.id) ?? pre.pc }, p.id, this.now()));
    }
    if (a && action !== 'voucher') return this.change<unknown>(user, companyId, (f, a2) => finPettyAction({ ...ctx, a: a2 }, f, action, input));
    return this.ownChange(user, companyId, (f) => finPettyAction(ctx, f, action, input));
  }

  /** Company credit and fuel cards: add, check, load a statement, explain lines (holder), recover personal use, review. */
  async cardAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const a = finActor(user);
    const ctx = await this.cashCtx(user, a);
    const f0 = await this.store.get('finStatus', `fin-${companyId}`);
    const holder = (f0?.cards ?? []).some((c) => c.id === input.cardId && c.holderId === user.id);
    if (a && !(holder && action === 'explain')) return this.change<unknown>(user, companyId, (f, a2) => finCardAction({ ...ctx, a: a2 }, f, action, input));
    return this.ownChange(user, companyId, (f) => finCardAction(ctx, f, action, input));
  }

  /**
   * A change by the person an advance, card or float belongs to, who may be outside Finance: the row is read by id and
   * the module checks the record is theirs. Nothing else on the books is shown to them.
   */
  private async ownChange<T>(user: User, companyId: Id, fn: (f: FinStatus) => { patch: Partial<FinStatus>; action: string; summary: string; result: T }) {
    if (typeof companyId !== 'string' || companyId.length > 120) throw new NotFound('Company books');
    return this.store.transaction(async (tx) => {
      await tx.lock?.('finStatus', `fin-${companyId}`);
      const f = await tx.get('finStatus', `fin-${companyId}`);
      if (!f) throw new NotFound('Company books');
      const out = fn(f);
      if (Object.keys(out.patch).length) await tx.update('finStatus', f.id, out.patch);
      await this.desk.log(tx, user, f, out.action, out.summary.slice(0, 900));
      return out.result;
    });
  }

  // ---------- Money in: billing to invoice, government claims, unidentified receipts (Fauzan, 2 Nov 2026) ----------

  // ---------- The ledger: statement figures, chart of accounts mapping, SQL Account connector (3 Nov 2026) ----------

  /**
   * The SQL Account connector (masterplan item 71) is off. Nothing in Prima sets these: switching it on and installing a
   * reader is a separate, authorised change after the FD connects SQL Account. Tests use them with a fake reader only.
   */
  sqlConnectorOn = false;
  sqlReader: SqlAccountReader | null = null;

  /** Statement figures for FS-01 to FS-12: record (Finance staff), review (someone else). */
  async figuresAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finFiguresAction({ ...ctx, a, reviewer: this.reviewer(a), senior: this.senior(a) }, f, this.desk.closePeriod(), action, input));
  }

  /** Chart of accounts and cost dimension mapping: propose (Finance staff), approve or return (FD or CEO, not the proposer). */
  async coaAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    const contractIds = (await this.contractsOf([companyId])).map((c) => c.id);
    return this.change<unknown>(user, companyId, (f, a) => finCoaAction({ ...ctx, a }, f, contractIds, this.desk.closePeriod(), action, input));
  }

  /** SQL Account set-up (record, confirm) and, only when switched on with a reader installed, one read-only pull. */
  async sqlAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    if (action !== 'pull') return this.change<unknown>(user, companyId, (f, a) => finSqlDiscoveryAction({ ...ctx, a, senior: this.senior(a) }, f, action, input));
    const p = this.desk.closePeriod();
    const reader = this.sqlReader;
    const f0 = await this.store.get('finStatus', `fin-${companyId}`);
    const blockers = f0 ? finSqlBlockers(f0, p, this.sqlConnectorOn, !!reader) : ['Company books not found.'];
    if (blockers.length || !reader || !f0?.sqlDiscovery) throw new BadRequest(blockers.join(' '));
    const snapshot = await reader.readPeriod(f0.sqlDiscovery.companyFile, p);
    return this.change<unknown>(user, companyId, (f, a) => {
      if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
      const { patch, sync } = finSqlApply(f, snapshot, p, this.now(), { by: 'SQL Account connector (read-only)', byId: `sql:${user.id}`, at: this.now(), comment: `Pulled by ${user.name}` });
      return {
        patch,
        action: sync.status === 'accepted' ? 'finance.sql.read' : 'finance.sql.rejected',
        summary: `SQL Account read ${sync.externalId} for ${p}: ${sync.status}${sync.reasons.length ? ` (${sync.reasons.join(' ')})` : ''}.`,
        result: sync,
      };
    });
  }

  private async contractsOf(companyIds: Id[]) {
    if (!companyIds.length) return [];
    return (await this.store.list('contracts', { companyId: companyIds })).filter((c) => companyIds.includes(c.companyId));
  }

  /** Each contract's monthly invoice in SQL Account ('invoice'), or why there is none ('none', checked by someone else). */
  async billingAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const contracts = await this.contractsOf([companyId]);
    const clients = (await this.store.list('clientAccounts', { companyId: [companyId] })).filter((x) => x.companyId === companyId);
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finBillingAction({ ...ctx, a }, f, contracts, addMonthsP(this.desk.closePeriod(), -2), action, input, clients));
  }

  /** Stamp duty: add, stamped, check, cancelled (opens the refund), docs, submit, outcome, received. */
  async stampAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const contracts = await this.contractsOf([companyId]);
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finStampAction({ ...ctx, a }, f, contracts, action, input));
  }

  // ---------- Daily cash pay (Fauzan, 2 Nov 2026): Finance lists, only the FD approves, the COO or CEO pays ----------

  private isCollector(u: User) {
    return isFinCoo(u) || finActor(u)?.kind === 'ceo';
  }
  /** The Director Office lists people for cash (Fauzan, 6 Nov 2026), as for the guard pay run. */
  private isDirectorOffice(u: User) {
    return !u.integration && u.role === 'pwvsb_officer' && u.department === 'director_office';
  }
  /** Only the COO approves a stamped consent letter (Fauzan, 6 Nov 2026, decision card: "COO only"; no CEO stand-in). */
  private isConsentApprover(u: User) {
    return isFinCoo(u);
  }
  private async dailyCtx(user: User, a: FinActor | null): Promise<FinDailyCashCtx> {
    const users = new Map((await this.store.list('users')).map((u) => [u.id, u]));
    const collector = this.isCollector(user);
    return {
      user,
      a,
      collector,
      today: this.today(),
      sign: (comment = '') => this.sign(user, comment),
      userById: (id) => users.get(id),
      isCollector: (u) => this.isCollector(u),
      directorOffice: this.isDirectorOffice(user),
      consentApprover: this.isConsentApprover(user),
      tier: collector ? (isFinCoo(user) ? 'coo' : 'ceo') : null,
    };
  }

  /**
   * Finance: add, edit, submit, cancel, withdraw, bank, handover, settle; the FD: approve, return, accept_difference.
   * The COO or CEO holding the cash: received, pay, give_back (the COO is not a Finance actor, so these go through
   * the company's row directly, for companies he can see).
   */
  arrivalCashView(user: User, companyId: Id) { return new ArrivalCashService(this.store, () => this.now()).view(user, companyId); }
  arrivalCashEvidence(user: User, companyId: Id, docId: Id) { return new ArrivalCashService(this.store, () => this.now()).evidence(user, companyId, docId); }
  arrivalCashAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) { return new ArrivalCashService(this.store, () => this.now()).action(user, companyId, action, input); }
  exceptionalCashEvidence(user: User, companyId: Id, docId: Id) {
    return new ExceptionalGuardCashService(this.store, this.desk, () => this.now()).evidence(user, companyId, docId);
  }
  exceptionalCashView(user: User, companyId: Id) {
    return new ExceptionalGuardCashService(this.store, this.desk, () => this.now()).view(user, companyId);
  }
  exceptionalCashAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return new ExceptionalGuardCashService(this.store, this.desk, () => this.now()).action(user, companyId, action, input);
  }

  async dailyCashAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    if (!['receipt', 'giveBack', 'settle', 'acceptDifference', 'bank', 'cancel'].includes(action))
      throw new BadRequest('Legacy daily cash is closed to new activity. DOA submits the manually OM-requested, CEO-approved guard list through exceptional cash.');

    // How each person is paid (Fauzan, 6 Nov 2026): the Director Office lists for cash, the COO or CEO decides, the COO
    // approves a consent letter. None of them is a Finance actor, so these go through the company's row directly.
    const outside: Record<string, [(u: User) => boolean, string]> = {
      listCash: [(u) => this.isDirectorOffice(u), '(only the Director Office lists people for cash)'],
      unlistCash: [(u) => this.isDirectorOffice(u), '(only the Director Office lists people for cash)'],
      decideCash: [(u) => !u.integration && u.opsTier === 'ceo' && ['director','pwvsb_officer'].includes(u.role), '(only the CEO approves cash)'],
      approveConsent: [(u) => this.isConsentApprover(u), '(only the COO approves a consent letter)'],
    };
    if (action === 'receipt') return this.dailyCashReceipt(user, companyId, input);
    if (outside[action]) {
      const [may, why] = outside[action];
      if (!may(user)) throw new AccessDenied('view', why);
      if (!(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
      const ctx = await this.dailyCtx(user, finActor(user));
      return this.ownChange<unknown>(user, companyId, (f) => finDailyCashAction(ctx, f, action, input));
    }
    if (['received', 'pay', 'giveBack'].includes(action)) {
      if (!this.isCollector(user)) throw new AccessDenied('view', '(only the COO or the CEO collects and pays the daily cash)');
      if (!(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
      const ctx = await this.dailyCtx(user, finActor(user));
      return this.ownChange<unknown>(user, companyId, (f) => finDailyCashAction(ctx, f, action, input));
    }
    const ctx = await this.dailyCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finDailyCashAction({ ...ctx, a }, f, action, input));
  }

  /**
   * The Director Office uploads the signed receipt for a cash payment (Fauzan, 6 Nov 2026: "Signed paper of the receive
   * collected and upload as proof. Upload done by director office."). The file is kept in evidenceDocs behind the
   * company wall, with its SHA-256; the same file cannot be given twice.
   */
  private async dailyCashReceipt(user: User, companyId: Id, input: Record<string, unknown>) {
    if (!this.isDirectorOffice(user)) throw new AccessDenied('view', '(only the Director Office uploads the signed receipts)');
    if (!(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
    const data = typeof input.data === 'string' ? input.data : '';
    const m = /^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.exec(data);
    if (!m) throw new BadRequest('The signed receipt must be a PDF, JPEG or PNG file.');
    const bytes = Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4);
    const max = RULES.caseProof.value.maxDocBytes;
    if (bytes > max) throw new BadRequest(`The file is too large (over ${Math.round(max / 1000)} KB). Scan it smaller.`);
    const sha256 = sha256Hex(data);
    const name = (typeof input.name === 'string' ? input.name : '').trim().slice(0, 120) || 'Signed receipt';
    const ctx = await this.dailyCtx(user, finActor(user));
    const doc: EvidenceDoc = {
      id: `doc-${sha256.slice(0, 16)}`,
      companyId,
      caseId: null,
      followUpId: null,
      dailyCashId: typeof input.listId === 'string' ? input.listId.slice(0, 120) : null,
      name,
      mime: m[1] as EvidenceDoc['mime'],
      bytes,
      sha256,
      data,
      caption: 'Daily cash signed receipt',
      uploadedBy: user.name,
      receivedAt: this.now(),
    };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('finStatus', `fin-${companyId}`);
      const f = await tx.get('finStatus', `fin-${companyId}`);
      if (!f) throw new NotFound('Company books');
      const out = finDailyCashAction(ctx, f, 'receipt', { listId: input.listId, payoutId: input.payoutId, doc: { id: doc.id, name, sha256 } });
      if (await tx.get('evidenceDocs', doc.id)) throw new BadRequest(`"${name}" was already given as proof.`);
      await tx.insert('evidenceDocs', doc);
      await tx.update('finStatus', f.id, out.patch);
      await this.desk.log(tx, user, f, out.action, out.summary.slice(0, 900));
      return out.result;
    });
  }

  /** The COO's or CEO's own daily cash: handed to them, people to pay today, what to give back. */
  async dailyCashMine(user: User) {
    const who = { directorOffice: this.isDirectorOffice(user), collector: this.isCollector(user), consentApprover: this.isConsentApprover(user) };
    if (!who.directorOffice && !who.collector && !who.consentApprover) return { lists: [], collectors: [], decisions: [], receipts: [] };
    const ids = await this.desk.companies(user);
    const rows = (await this.store.list('finStatus', { companyId: ids })).filter((f) => ids.includes(f.companyId));
    const today = this.today();
    return {
      lists: who.collector ? rows.flatMap((f) => finDailyCashCollectorView(f, user, today).map((l) => ({ ...l, companyId: f.companyId }))) : [],
      collectors: [],
      /** People waiting for the Director Office, the COO or CEO, or the COO (Fauzan, 6 Nov 2026). */
      decisions: [] as ReturnType<typeof finDailyCashDecisions>,
      /** Cash payments waiting for the Director Office to upload the signed receipt. */
      receipts: who.directorOffice ? rows.flatMap((f) => finDailyCashReceiptsDue(f)) : [],
    };
  }

  /** Home lines for the COO or CEO holding daily cash. */
  async dailyCashCollectorHome(user: User): Promise<{ tone: 'crit' | 'warn' | 'info'; tag: string; title: string; detail: string; go: { view: 'finance' | 'doa' } }[]> {
    const { lists, decisions, receipts } = await this.dailyCashMine(user);
    // The Director Office works from its own screen; the COO and CEO from Finance.
    const go = { view: this.isDirectorOffice(user) ? ('doa' as const) : ('finance' as const) };
    const out: { tone: 'crit' | 'warn' | 'info'; tag: string; title: string; detail: string; go: { view: 'finance' | 'doa' } }[] = [];
    const need = (k: string) => decisions.reduce((n, l) => n + l.people.filter((p) => p.need === k).length, 0);
    if (need('list')) out.push({ tone: 'warn', tag: 'Finance', title: `${need('list')} person(s) asked to be paid daily in cash`, detail: 'List each one for cash with the reason, for the COO or CEO to decide', go });
    if (receipts.length) out.push({ tone: 'warn', tag: 'Finance', title: `${receipts.length} daily cash payment(s) waiting for the signed receipt`, detail: 'Collect the signed paper and upload it', go });
    if (need('decide')) out.push({ tone: 'warn', tag: 'Finance', title: `${need('decide')} daily cash request(s) to give or refuse`, detail: 'Listed by the Director Office; everyone else is paid by bank or e-wallet', go });
    if (need('consent')) out.push({ tone: 'warn', tag: 'Finance', title: `${need('consent')} consent letter(s) to approve for daily pay`, detail: "Paid into a relative's or friend's account; check the Commissioner for Oaths stamp", go });
    const confirm = lists.reduce((n, l) => n + l.toConfirm.length, 0);
    const today = lists.reduce((n, l) => n + l.dueToday.length, 0);
    const back = lists.filter((l) => l.giveBackDue).length;
    if (confirm) out.push({ tone: 'crit', tag: 'Finance', title: `${confirm} daily cash handover(s) to count and confirm`, detail: 'Count the cash Finance gave you and confirm the amount', go });
    if (today) out.push({ tone: 'warn', tag: 'Finance', title: `${today} person(s) to pay in cash today`, detail: 'Check the IC or passport, pay, and attach the signed pay sheet', go });
    if (back) out.push({ tone: 'warn', tag: 'Finance', title: `${back} daily cash list(s) ended: give back the unpaid cash`, detail: 'Finance counts it and banks it', go });
    return out;
  }

  // ---------- Intercompany and the 13-week cash forecast (Fauzan, 2 Nov 2026) ----------

  /**
   * Record this company's month-end intercompany balance ('record') or explain a difference ('explain'). The entries
   * live on PWVSB's row so both sides see each other's figure; the person must act on this company's books.
   */
  async icAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.store.transaction(async (tx) => {
      const a = this.desk.actor(user);
      const f = await this.desk.row(tx, user, a, companyId);
      await tx.lock?.('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
      const g = companyId === GROUP_EMPLOYER_ID ? f : await tx.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
      if (!g) throw new NotFound('Group books');
      const nameOf = await this.desk.companyNamer(tx);
      const known = new Set([GROUP_EMPLOYER_ID, ...(await tx.list('companies')).map((c) => c.id)]);
      const out = finIcAction(
        { user, actsOn: (id) => id === companyId, reviewer: this.reviewer(a), companyName: (id) => (known.has(id) ? nameOf(id) : null), maxPeriod: this.desk.closePeriod(), sign: (c = '') => this.sign(user, c), explainMax: (await this.desk.settings(tx)).icExplainMax },
        g,
        companyId,
        action,
        input,
      );
      await tx.update('finStatus', g.id, out.patch);
      await this.desk.log(tx, user, f, out.action, out.summary.slice(0, 900));
      return out.result;
    });
  }

  private async payRunsOf(companyId: Id) {
    return (await this.store.list('staffPayRuns', { companyId: [companyId] })).filter((r) => r.companyId === companyId);
  }

  /** The 13-week forecast: add or remove a line Finance knows about, or review the week's forecast. */
  async cash13Action(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const runs = await this.payRunsOf(companyId);
    return this.change<unknown>(user, companyId, (f, a) =>
      finCash13Action({ user, a, reviewer: this.reviewer(a), today: this.today(), sign: (c = '') => this.sign(user, c) }, f, runs, action, input),
    );
  }

  // ---------- Monthly pack and dashboard (Fauzan, 2 Nov 2026) ----------

  private async packOf(user: User, f: FinStatus, period: string, ctx: { contracts: Contract[]; group: FinStatus | null | undefined; nameOf: (id: Id) => string; s: Awaited<ReturnType<FinanceDeskService['settings']>> }) {
    const close = (f.closes ?? []).find((c) => c.period === period) ?? null;
    const check = finCloseCheck(f, close, period, this.now(), ctx.s, ctx.contracts.filter((c) => c.companyId === f.companyId), ctx.group ?? null, ctx.nameOf);
    const open = check.blockers.length + check.exceptions.filter((e) => !e.explained).length;
    return finPackData(f, { period, today: this.today(), contracts: ctx.contracts, group: ctx.group, runs: await this.payRunsOf(f.companyId), nameOf: ctx.nameOf, openExceptions: open });
  }
  private async packCtx(companyIds: Id[]) {
    return {
      contracts: await this.contractsOf(companyIds),
      group: await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`),
      nameOf: await this.desk.companyNamer(),
      s: await this.desk.settings(),
    };
  }

  /** One company's monthly pack (live until reviewed; then the figures as reviewed). */
  async pack(user: User, companyId: Id, period?: string) {
    const a = this.desk.actor(user);
    if (!(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
    const f = await this.store.get('finStatus', `fin-${companyId}`);
    if (!f || (a.team != null && f.team !== a.team)) throw new NotFound('Company books');
    const close = this.desk.closePeriod();
    const p = typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) && period <= close ? period : close;
    const reviewed = (f.packReviews ?? []).find((r) => r.period === p) ?? null;
    const data = reviewed ? reviewed.snapshot : await this.packOf(user, f, p, await this.packCtx([companyId]));
    return { data, reviewed: reviewed ? { by: reviewed.sign.by, at: reviewed.sign.at, comment: reviewed.sign.comment } : null, periods: [close, addMonthsP(close, -1), addMonthsP(close, -2)], mayReview: this.reviewer(a) && !reviewed && data.close.status === 'approved' };
  }

  /** Review the month's pack once, with a comment; the figures are kept as reviewed. */
  async packAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    if (action !== 'review') throw new BadRequest('Unknown pack action.');
    const f0 = await this.store.get('finStatus', `fin-${companyId}`);
    if (!f0) throw new NotFound('Company books');
    const period = typeof input.period === 'string' ? input.period : this.desk.closePeriod();
    const data = await this.packOf(user, f0, period, await this.packCtx([companyId]));
    return this.change<unknown>(user, companyId, (f, a) => finPackReview(a, this.reviewer(a), f, data, (c) => this.sign(user, c), input));
  }

  /** The dashboard: the key numbers for every company the person sees, for the month being closed. */
  async dashboard(user: User) {
    const a = this.desk.actor(user);
    const ids = await this.desk.companies(user);
    const rows = (await this.store.list('finStatus', { companyId: ids })).filter((f) => ids.includes(f.companyId) && (a.team == null || f.team === a.team));
    const period = this.desk.closePeriod();
    const ctx = await this.packCtx(rows.map((f) => f.companyId));
    const out: ReturnType<typeof finDashboardRow>[] = [];
    for (const f of rows) {
      const reviewed = (f.packReviews ?? []).find((r) => r.period === period) ?? null;
      out.push(finDashboardRow(reviewed ? reviewed.snapshot : await this.packOf(user, f, period, ctx), reviewed));
    }
    const sum = (k: 'cash' | 'profitMonth' | 'budgetProfitMonth' | 'profitYtd' | 'budgetProfitYtd' | 'over90' | 'collateral') => round2(out.reduce((n, r) => n + (r[k] ?? 0), 0));
    return {
      period,
      rows: out.sort((x, y) => x.company.localeCompare(y.company)),
      totals: { cash: sum('cash'), profitMonth: sum('profitMonth'), budgetProfitMonth: sum('budgetProfitMonth'), profitYtd: sum('profitYtd'), budgetProfitYtd: sum('budgetProfitYtd'), over90: sum('over90'), collateral: sum('collateral') },
      // Approved payments not yet released, due within 7 days (Fauzan, 2 Nov 2026: A17 key numbers).
      due7: round2(rows.reduce((n, f) => n + (f.payments ?? []).filter((p) => p.status === 'approved' && p.dueOn <= addDays(this.today(), 7)).reduce((m, p) => m + p.amount, 0), 0)),
      attention: {
        shortOfCash: out.filter((r) => r.firstShortWeek).length,
        closeOpen: out.filter((r) => r.closeStatus !== 'approved').length,
        over90: out.filter((r) => (r.over90 ?? 0) > 0).length,
        lossSites: out.reduce((n, r) => n + r.lossSites, 0),
      },
    };
  }

  /**
   * Key numbers on the home screen (Fauzan, 2 Nov 2026: A17 and suggestion 26): cash in the banks, payments due in 7
   * days, invoices over 90 days and companies not closed, for the companies the person sees. Never a ranking.
   */
  async keyTiles(user: User): Promise<HomeTile[]> {
    const a = finActor(user);
    if (!a) return [];
    const d = await this.dashboard(user);
    if (!d.rows.length) return [];
    const go: HomeLink = { view: 'finance', tab: 'dashboard' };
    const k = (n: number) => Math.round(n / 1000);
    // A company with no statement or ageing for the month is unknown, never counted as zero (Unknown is never fine).
    const cashUnknown = d.rows.filter((r) => r.cash == null).length;
    const ageUnknown = d.rows.filter((r) => r.over90 == null).length;
    const unknownNote = (n: number, what: string) => `${n} of ${d.rows.length} compan${d.rows.length === 1 ? 'y' : 'ies'} with no ${what} for ${d.period}`;
    return [
      {
        label: 'Cash in the banks (RM thousand)',
        value: cashUnknown === d.rows.length ? 'UNKNOWN' : k(d.totals.cash),
        tone: cashUnknown === d.rows.length ? 'neutral' : d.attention.shortOfCash ? 'warn' : cashUnknown ? 'neutral' : 'ok',
        note: cashUnknown ? unknownNote(cashUnknown, 'bank statement') : d.attention.shortOfCash ? `${d.attention.shortOfCash} short within 13 weeks` : `Bank statements for ${d.period}`,
        go,
      },
      { label: 'Payments due in 7 days (RM thousand)', value: k(d.due7), tone: 'neutral', note: 'Approved, not yet released', go: { view: 'finance', tab: 'payments' } },
      {
        label: 'Invoices over 90 days (RM thousand)',
        value: ageUnknown === d.rows.length ? 'UNKNOWN' : k(d.totals.over90),
        tone: ageUnknown === d.rows.length ? 'neutral' : d.totals.over90 ? 'warn' : ageUnknown ? 'neutral' : 'ok',
        note: ageUnknown ? unknownNote(ageUnknown, 'ageing') : `${d.attention.over90} compan${d.attention.over90 === 1 ? 'y' : 'ies'}`,
        go,
      },
      { label: `Companies not closed for ${d.period}`, value: d.attention.closeOpen, tone: d.attention.closeOpen ? 'warn' : 'ok', note: `of ${d.rows.length}`, go: { view: 'finance', tab: 'close' } },
    ];
  }

  /** Government claims: add, follow, query, resubmit, paid (link the bank line), cancel. */
  async govtAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finGovtAction({ ...ctx, a }, f, action, input));
  }

  /** Unidentified money in: allocate it, and someone else checks the allocation. */
  async moneyInAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const ctx = await this.cashCtx(user, this.desk.actor(user));
    return this.change<unknown>(user, companyId, (f, a) => finAllocateAction({ ...ctx, a }, f, action, input));
  }

  /** My advances, cards and petty cash, for anyone (Finance or not). */
  async cashMine(user: User) {
    const ids = [...new Set([...user.companyIds, GROUP_EMPLOYER_ID])];
    const rows = await this.store.list('finStatus', { companyId: ids });
    const today = this.today();
    const fs = await this.desk.settings();
    return rows.map((f) => finCashMine(f, user.id, today, fs)).filter((x) => x.advances.length || x.cards.length || x.petty.length);
  }

  /** Overdue staff advances across every company, for central HR (Fauzan, 2 Nov 2026: shown to HR and Finance). */
  async advancesForHr(user: User) {
    if (!(user.role === 'pwvsb_officer' && user.department === 'hr') && !finActor(user)) throw new AccessDenied('view', '(HR and Finance)');
    const rows = await this.store.list('finStatus');
    const today = this.today();
    return rows.flatMap((f) =>
      (f.advances ?? []).filter((x) => finAdvanceOverdue(x, f, today)).map((x) => ({ id: x.id, companyId: f.companyId, name: x.name, purpose: x.purpose, amount: x.amount, settleBy: x.settleBy, days: daysBetween(x.settleBy, today) })),
    );
  }

  // ---------- Automatic bank reconciliation (Fauzan, 1 Nov 2026) ----------

  /**
   * Staff load the month's bank statement (Statements) and SQL Account's ledger for that account here; Prima pairs the
   * lines, carries forward last month's outstanding items, and shows whether bank and books agree. Someone else reviews.
   */
  async bankRecAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a, s) => {
      const recs = f.bankRecs ?? [];
      const save = (r: FinBankRec) => ({ bankRecs: [...recs.filter((x) => x.id !== r.id), r] });
      const result = (r: FinBankRec) => finBankRecResult((f.statements ?? []).find((x) => x.id === r.statementId)!, r, this.now());
      if (action === 'run') {
        const bank = f.banks.find((b) => b.id === input.bankId);
        if (!bank) throw new BadRequest("Choose one of this company's bank accounts.");
        const p = period(input.period);
        const st = (f.statements ?? []).find((x) => x.bankId === bank.id && x.period === p);
        if (!st) throw new BadRequest(`Load the ${p} bank statement for ${bank.bank} ${bank.accountMasked} first.`);
        const released = (f.payments ?? []).filter((x) => x.bankId === bank.id && x.releasedOn?.slice(0, 7) === p && x.steps.some((t) => t.step === 'released' && t.byId === user.id));
        if (released.length) throw new AccessDenied('view', `(you recorded ${released.length} release(s) from this account in ${p}; someone who did not pay from it reconciles it)`);
        const id = `rec-${bank.id}-${p}`;
        const prior = recs.find((x) => x.id === id);
        if (prior?.reviewed && (prior.statementVersion ?? 1) === (st.version ?? 1) && !isLead(a)) throw new AccessDenied('view', '(a reviewed reconciliation is redone only by the Finance Director or the CEO)');
        const opening = money(input.ledgerOpening, 'SQL Account opening balance for the month', true);
        const closing = money(input.ledgerClosing, 'SQL Account closing balance for the month', true);
        const parsed = parseLedgerCsv(input.ledgerCsv as string);
        const outside = parsed.find((l) => l.date.slice(0, 7) !== p);
        if (outside) throw new BadRequest(`A ledger line dated ${outside.date} is not in ${p}. Export one month at a time.`);
        const sum = round2(parsed.reduce((n, l) => n + l.amount, 0));
        if (Math.abs(round2(opening + sum) - closing) >= 0.005)
          throw new BadRequest(`The ledger does not add up: opening RM${opening.toFixed(2)} + entries RM${sum.toFixed(2)} ≠ closing RM${closing.toFixed(2)}. Check the export is complete.`);
        // Last month's items still outstanding are carried forward so they can clear this month.
        const prevP = addMonthsP(p, -1);
        const prev = recs.find((x) => x.bankId === bank.id && x.period === prevP);
        const prevSt = prev ? (f.statements ?? []).find((x) => x.id === prev.statementId) : null;
        // Review finding (Arisha main, 1 Nov 2026): items were carried from a previous month whose statement had been
        // replaced. A previous month that no longer stands is refused; the carry-forward is bound to its version.
        const prevStale = prev ? finBankRecStale(f, prev) : null;
        if (prevStale) throw new BadRequest(`Run the ${prevP} reconciliation again first: ${prevStale}.`);
        const prevRes = prev && prevSt ? finBankRecResult(prevSt, prev, this.now()) : null;
        const carried: FinLedgerLine[] = prevRes ? [...prevRes.outstanding, ...prevRes.inTransit].map((g, i) => ({ ...g, id: `${id}-c${i + 1}`, carriedFrom: g.carriedFrom ?? prevP })) : [];
        // Bank items last month that SQL Account did not have yet (charges, interest): they may be posted this month.
        const carriedBank = prevRes
          ? prevRes.bankOnly.map((l, i) => {
              const { explained: _e, ...line } = l;
              return { ...line, match: null, id: `${id}-b${i + 1}`, carriedFrom: (l as { carriedFrom?: string }).carriedFrom ?? prevP };
            })
          : [];
        const carriedNotes = prevRes
          ? prevRes.bankOnly.flatMap((l, i) => (l.explained ? [{ ...l.explained, lineId: `${id}-b${i + 1}`, note: `${l.explained.note} (from ${prevP})` }] : []))
          : [];
        const ledger: FinLedgerLine[] = [...carried, ...parsed.map((l, i) => ({ ...l, id: `${id}-g${i + 1}` }))];
        const auto = finAutoReconcile({ ...st, carried: carriedBank } as typeof st, ledger, s.matchDays).map((x) => ({ ...x, by: `auto (${user.name})`, byId: user.id, at: this.now() }));
        const rec: FinBankRec = {
          id,
          bankId: bank.id,
          period: p,
          statementId: st.id,
          ledgerOpening: opening,
          ledgerClosing: closing,
          ledger,
          carriedBank,
          pairs: auto,
          explained: carriedNotes,
          run: { ...this.sign(user), source: text(input.source, 'Where the ledger came from (SQL Account export file name)', 3, 200) },
          reviewed: null,
          rev: (prior?.rev ?? 0) + 1,
          statementVersion: st.version ?? 1,
          carriedFromRec: prev && prevSt ? { id: prev.id, rev: prev.rev ?? 1, statementVersion: prev.statementVersion ?? 1 } : null,
          contributors: [user.id],
        };
        const res = finBankRecResult(st, rec, this.now());
        return {
          patch: save(rec),
          action: 'finance.bankrec.run',
          summary: `${bank.bank} ${bank.accountMasked} ${p} reconciled automatically: ${res.matchedLines} of ${res.lines} bank lines matched to SQL Account; ${res.outstanding.length} payment(s) not yet presented, ${res.inTransit.length} deposit(s) not yet credited, ${res.bankOnly.length} bank item(s) not in SQL Account; difference RM${res.difference.toFixed(2)}.`,
          result: { rec, result: res },
        };
      }
      const rec = recs.find((x) => x.id === input.recId);
      if (!rec) throw new NotFound('Bank reconciliation');
      const st = (f.statements ?? []).find((x) => x.id === rec.statementId);
      if (!st) throw new NotFound('Bank statement');
      const stale = finBankRecStale(f, rec);
      if (stale) throw new BadRequest(`Run the ${rec.period} reconciliation again: ${stale}.`);
      if (rec.reviewed && action !== 'review') {
        if (!isLead(a)) throw new AccessDenied('view', '(this reconciliation is reviewed; only the Finance Director or the CEO reopens it)');
      }
      // Every change raises the revision and records who made it (review finding, 1 Nov 2026).
      const touched = (next: FinBankRec): FinBankRec => ({
        ...next,
        rev: (rec.rev ?? 1) + 1,
        contributors: [...new Set([...(rec.contributors ?? [rec.run.byId]), user.id])],
      });
      if (action === 'match') {
        const lineIds = Array.isArray(input.lineIds) ? (input.lineIds as unknown[]).map(String) : [];
        const ledgerIds = Array.isArray(input.ledgerIds) ? (input.ledgerIds as unknown[]).map(String) : [];
        if (!lineIds.length || !ledgerIds.length) throw new BadRequest('Choose at least one bank line and one SQL Account entry.');
        const used = new Set(rec.pairs.flatMap((x) => [...x.lineIds, ...x.ledgerIds]));
        if ([...lineIds, ...ledgerIds].some((x) => used.has(x))) throw new BadRequest('One of those is already matched. Unmatch it first.');
        const ls = lineIds.map((x) => [...(rec.carriedBank ?? []), ...st.lines].find((l) => l.id === x));
        const gs = ledgerIds.map((x) => rec.ledger.find((g) => g.id === x));
        if (ls.some((x) => !x) || gs.some((x) => !x)) throw new NotFound('Line');
        const bankSum = round2(ls.reduce((n, l) => n + l!.amount, 0));
        const bookSum = round2(gs.reduce((n, g) => n + g!.amount, 0));
        if (Math.abs(bankSum - bookSum) >= 0.005) throw new BadRequest(`They do not agree: bank RM${bankSum.toFixed(2)}, SQL Account RM${bookSum.toFixed(2)}.`);
        const note = requireComment(input.comment, 'match by hand');
        const next: FinBankRec = touched({ ...rec, pairs: [...rec.pairs, { lineIds, ledgerIds, how: 'hand', by: user.name, byId: user.id, at: this.now(), note }], reviewed: null });
        return { patch: save(next), action: 'finance.bankrec.matched', summary: `${rec.id}: ${lineIds.length} bank line(s) matched by hand to ${ledgerIds.length} SQL entr(ies), RM${bankSum.toFixed(2)}: ${note}`, result: { rec: next, result: result(next) } };
      }
      if (action === 'unmatch') {
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO unmatches)');
        const why = requireReason(input.comment, 'unmatch it');
        const lineId = String(input.lineId ?? '');
        const pair = rec.pairs.find((x) => x.lineIds.includes(lineId) || x.ledgerIds.includes(lineId));
        if (!pair) throw new BadRequest('That line is not matched.');
        const next: FinBankRec = touched({ ...rec, pairs: rec.pairs.filter((x) => x !== pair), reviewed: null });
        return { patch: save(next), action: 'finance.bankrec.unmatched', summary: `${rec.id}: match undone: ${why}`, result: { rec: next, result: result(next) } };
      }
      if (action === 'explain') {
        const lineId = String(input.lineId ?? '');
        const r = result(rec);
        if (!r.bankOnly.some((l) => l.id === lineId)) throw new BadRequest('Only a bank line with no SQL Account entry is explained (bank charges, interest, a standing order).');
        const note = requireReason(input.comment, 'say what it is and its SQL Account posting reference');
        const next: FinBankRec = touched({ ...rec, explained: [...rec.explained.filter((e) => e.lineId !== lineId), { lineId, note, by: user.name, byId: user.id, at: this.now() }], reviewed: null });
        return { patch: save(next), action: 'finance.bankrec.explained', summary: `${rec.id}: bank line ${lineId} explained: ${note}`, result: { rec: next, result: result(next) } };
      }
      if (action === 'review') {
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO reviews the reconciliation)');
        if (rec.run.byId === user.id) throw new AccessDenied('view', '(nobody reviews a reconciliation they ran)');
        // Review finding (1 Nov 2026): someone who matched by hand could review their own matching. Nobody who ran,
        // matched, unmatched or explained in it reviews it, and the review signs the revision the reviewer read.
        const made = new Set([rec.run.byId, ...(rec.contributors ?? []), ...rec.pairs.filter((x) => x.how === 'hand').map((x) => x.byId)]);
        if (made.has(user.id)) throw new AccessDenied('view', '(nobody reviews a reconciliation they changed: you matched, unmatched or explained items in it)');
        if (rec.reviewed) throw new BadRequest('Already reviewed.');
        const r = result(rec);
        if (Math.abs(r.difference) >= 0.005) throw new BadRequest(`The bank and SQL Account still differ by RM${r.difference.toFixed(2)}.`);
        if (r.unexplained.length) throw new BadRequest(`${r.unexplained.length} bank item(s) not in SQL Account still need posting or explaining.`);
        if (input.rev !== (rec.rev ?? 1)) throw new BadRequest('The reconciliation changed after you opened it. Reload and check it again before reviewing.');
        const comment = requireComment(input.comment, 'review');
        if (r.stale.length && comment.length < 10)
          throw new BadRequest(`${r.stale.length} item(s) have been outstanding for more than 60 days: say what is being done (at least 10 characters).`);
        const next: FinBankRec = { ...rec, reviewed: this.sign(user, comment) };
        return { patch: save(next), action: 'finance.bankrec.reviewed', summary: `${rec.id} reviewed: ${comment}`, result: { rec: next, result: r } };
      }
      throw new BadRequest('Unknown reconciliation action.');
    });
  }

  /** Hostel bills the company paid itself (FWM's flow), for Prima to find on its bank statement (Fauzan, 2 Nov 2026). */
  private async hostelBills(companyId: Id): Promise<HostelBill[]> {
    if (jaOwns('hostels')) return [];
    return (await this.store.list('hostelBills', { companyId: [companyId] })).filter((b) => b.companyId === companyId);
  }

  /**
   * Cross-module (Fauzan, 2 Nov 2026): what Finance finds on the bank statement is written on the hostel bill itself, so
   * FWM and the company see it was paid, from which account and on which day. `drop` names bills whose bank record no
   * longer holds (their statement replaced or the line unmatched); they lose it unless found again.
   */
  private stampHostel(f: FinStatus, bills: HostelBill[], seen: { billId: Id; statementId: Id; lineId: Id; date: IsoDate; amount: number; bankId: Id }[], drop: (b: HostelBill) => boolean) {
    const at = this.now();
    const label = (bankId: Id) => {
      const bk = f.banks.find((x) => x.id === bankId);
      return bk ? `${bk.bank} ${bk.accountMasked}` : bankId;
    };
    return async (tx: Store) => {
      for (const b of bills) {
        const hit = seen.find((x) => x.billId === b.id);
        if (hit) {
          const bankSeen = { statementId: hit.statementId, lineId: hit.lineId, date: hit.date, amount: hit.amount, bank: label(hit.bankId), at };
          await tx.update('hostelBills', b.id, { bankSeen });
          await tx.audit({ at, actor: 'Prima', companyId: b.companyId, action: 'hostel.bank_seen', entity: 'hostel_bill', entityId: b.id, summary: `${b.kind.toLowerCase()} ${b.period}: RM${hit.amount.toFixed(2)} seen leaving ${bankSeen.bank} on ${hit.date}.` });
        } else if (b.bankSeen && drop(b)) {
          await tx.update('hostelBills', b.id, { bankSeen: null });
          await tx.audit({ at, actor: 'Prima', companyId: b.companyId, action: 'hostel.bank_unseen', entity: 'hostel_bill', entityId: b.id, summary: `${b.kind.toLowerCase()} ${b.period}: no longer matched to a bank statement line.` });
        }
      }
    };
  }

  /**
   * Finance keys in a hostel bill's payment once (Fauzan, 2 Nov 2026): the account it left, the day and the bank
   * reference. The amount is the bill's, as approved by the COO; nothing else is typed. The bill is then paid for FWM
   * and the company (no slip needed), and Prima looks for it on the bank statements already loaded.
   */
  async hostelAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    if (action !== 'paid') throw new BadRequest('Unknown hostel action.');
    if (jaOwns('hostels')) throw new BadRequest('Hostel bills are kept in the JA app.');
    const hostel = await this.hostelBills(companyId);
    const bill = hostel.find((b) => b.id === input.billId);
    if (!bill) throw new NotFound('Hostel bill');
    return this.change<unknown>(user, companyId, (f, a, s) => {
      if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance staff record payments)');
      if (bill.status === 'paid') throw new BadRequest(bill.financePaid ? 'Finance has already recorded this payment.' : 'The company already marked it paid with the slip.');
      if (bill.status !== 'coo_approved') throw new BadRequest('Record the payment once the COO has approved the bill.');
      const bank = f.banks.find((b) => b.id === input.bankId);
      if (!bank) throw new BadRequest("Choose the company's bank account it was paid from.");
      const on = isoDate(input.on, 'Day paid');
      const today = this.today();
      if (on > today) throw new BadRequest('The day paid cannot be in the future.');
      if (bill.cooApproval && on < dateOf(bill.cooApproval.at)) throw new BadRequest('A bill is paid after the COO approves it, not before.');
      const ref = noSecrets(text(input.ref, 'Bank reference', 3, 60), 'Bank reference');
      // Paid for exactly the approved amount (Fauzan, 2 Nov 2026). The amount is not typed; if sent it must agree.
      if (input.amount != null && Math.abs(Number(input.amount) - bill.amount) >= 0.005) throw new BadRequest(`Pay exactly the approved RM${bill.amount.toFixed(2)}.`);
      const sign = this.sign(user);
      const financePaid = { bankId: bank.id, bank: `${bank.bank} ${bank.accountMasked}`, on, ref, amount: bill.amount, by: sign.by, byId: sign.byId, at: sign.at };
      const paid: HostelBill = { ...bill, status: 'paid', financePaid };
      const rg = finMatchRegular(f, f.statements ?? [], [paid], s, today, this.now());
      const hit = rg.hostelSeen[0];
      return {
        patch: hit ? { statements: rg.statements } : {},
        also: async (tx: Store) => {
          await tx.update('hostelBills', bill.id, { status: 'paid', financePaid });
          await tx.audit({
            at: sign.at,
            actor: user.name,
            companyId,
            action: 'hostel.paid',
            entity: 'hostel_bill',
            entityId: bill.id,
            summary: `${bill.kind.toLowerCase()} ${bill.period}: paid RM${bill.amount.toFixed(2)} from ${financePaid.bank} on ${on}, ref ${ref}, recorded by Finance.`,
          });
          if (hit) await this.stampHostel(f, [paid], [hit], () => false)(tx);
        },
        action: 'finance.hostel.paid',
        summary: `Hostel ${bill.kind.toLowerCase()} ${bill.period} RM${bill.amount.toFixed(2)} paid from ${financePaid.bank} on ${on}, ref ${ref}${hit ? '; seen on the bank statement' : ''}.`,
        result: { ok: true, seen: !!hit },
      };
    });
  }

  async statementAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const hostel = action === 'load' || action === 'unmatch' ? await this.hostelBills(companyId) : [];
    const contracts = action === 'load' ? await this.contractsOf([companyId]) : [];
    return this.change<unknown>(user, companyId, (f, a, s) => {
      const statements = f.statements ?? [];
      if (action === 'load') {
        const bank = f.banks.find((b) => b.id === input.bankId);
        if (!bank) throw new BadRequest("Choose one of this company's bank accounts.");
        const p = period(input.period);
        if (p > this.desk.closePeriod()) throw new BadRequest('Load statements for months that have ended.');
        const opening = money(input.opening, 'Opening balance', true);
        const closing = money(input.closing, 'Closing balance', true);
        // A statement starts where last month's ended; otherwise a month or some lines are missing.
        const prev = statements.find((x) => x.bankId === bank.id && x.period === addMonthsP(p, -1));
        if (prev && Math.abs(prev.closing - opening) >= 0.005)
          throw new BadRequest(`The opening balance RM${opening.toFixed(2)} is not last month's closing RM${prev.closing.toFixed(2)}. Check this is the next statement and that last month's was complete.`);
        const parsed = parseStatementCsv(input.csv as string);
        const outside = parsed.find((l) => l.date.slice(0, 7) !== p);
        if (outside) throw new BadRequest(`A line dated ${outside.date} is not in ${p}. Load one month at a time.`);
        const sum = round2(parsed.reduce((n, l) => n + l.amount, 0));
        if (Math.abs(round2(opening + sum) - closing) >= 0.005)
          throw new BadRequest(`The statement does not add up: opening RM${opening.toFixed(2)} + lines RM${sum.toFixed(2)} ≠ closing RM${closing.toFixed(2)}. Check the file is complete.`);
        const source = text(input.source, 'Where the statement came from (bank portal file name)', 3, 200);
        const id = `stmt-${bank.id}-${p}`;
        const prior = statements.find((x) => x.id === id);
        // Standards review (1 Nov 2026): the bank reconciliation is done by someone independent of paying. Whoever
        // recorded a release from this account in this month does not load its statement.
        const released = (f.payments ?? []).filter((x) => x.bankId === bank.id && x.releasedOn?.slice(0, 7) === p && x.steps.some((s) => s.step === 'released' && s.byId === user.id));
        if (released.length)
          throw new AccessDenied('view', `(you recorded ${released.length} release(s) from this account in ${p}; someone who did not pay from it loads and matches its statement)`);
        if (prior && !this.senior(a)) throw new AccessDenied('view', '(only the team leader, the Finance Director or the CEO replaces a loaded statement)');
        // Review finding (Arisha main, 1 Nov 2026): a replacement statement reused the old line ids by position, so the
        // old matches and the reconciliation's review carried over to different lines. The same file loaded again changes
        // nothing; a different one is a new version with new line ids, and a reconciliation run on the old one goes stale.
        const content = (o: number, c: number, ls: { date: string; description: string; ref: string; amount: number }[]) =>
          JSON.stringify([o, c, ls.map((l) => [l.date, l.description, l.ref, l.amount])]);
        if (prior && content(prior.opening, prior.closing, prior.lines) === content(opening, closing, parsed))
          return { patch: {}, action: 'finance.statement.unchanged', summary: `${bank.bank} ${bank.accountMasked} statement ${p}: the same statement was loaded again; nothing changed.`, result: { statement: prior, matched: prior.lines.filter((l) => l.match).length, out: prior.lines.filter((l) => l.amount < 0).length } };
        const version = prior ? (prior.version ?? 1) + 1 : 1;
        // Payments cleared by an earlier load of this statement are un-cleared first.
        const base = (f.payments ?? []).map((x) => (x.cleared?.statementId === id ? { ...x, cleared: null } : x));
        const st: FinStatement = {
          id,
          bankId: bank.id,
          period: p,
          opening,
          closing,
          lines: parsed.map((l, i) => ({ ...l, id: version === 1 ? `${id}-${i + 1}` : `${id}-v${version}-${i + 1}`, match: null })),
          loaded: { ...this.sign(user), source },
          version,
        };
        const m = this.autoMatch({ ...f, payments: base }, st, user, s);
        const matched = m.statement.lines.filter((l) => l.match).length;
        const out = m.statement.lines.filter((l) => l.amount < 0).length;
        // Customer receipts (1 Nov 2026): those found on an earlier load of this statement are taken back, then every
        // waiting receipt is looked for again on the statements now loaded.
        const rc = finMatchReceipts([...statements.filter((x) => x.id !== id), m.statement], finUnmatchReceipts(f.arCases ?? [], (x) => x.statementId === id), s.matchDays, this.now());
        // Regular payments (Fauzan, 2 Nov 2026): direct debits, guarantee collateral back and hostel bills paid.
        // Government claims (2 Nov 2026): payments found on an earlier load are taken back, then looked for again.
        const gv = f.govtClaims?.length ? finMatchGovt(rc.statements, finUnmatchGovt(f.govtClaims, (x) => x.statementId === id, this.now()), this.now()) : null;
        const back = finUnmatchRegular(f, (x) => x.statementId === id);
        const rg = finMatchRegular({ ...f, ...back }, gv?.statements ?? rc.statements, hostel, s, this.today(), this.now());
        const regPatch = f.regular?.length || f.guarantees?.length ? { regular: rg.regular, guarantees: rg.guarantees } : {};
        // Client deposits and retention paid back (suggestion 3): taken back from an earlier load, then looked for again.
        const dp = f.clientDeposits?.length ? finMatchDeposits(rg.statements, finUnmatchDeposits(f.clientDeposits, (x) => x.statementId === id), contracts, this.now()) : null;
        // Fixed deposits placed and uplifted (suggestion 15).
        const fdm = f.fixedDeposits?.length ? finMatchFds(dp?.statements ?? rg.statements, finUnmatchFds(f.fixedDeposits, (x) => x.statementId === id), this.now()) : null;
        const afterDp = fdm?.statements ?? dp?.statements ?? rg.statements;
        // Learned explanations (A6) last, on what is still unmatched in this statement.
        const mine = afterDp.find((x) => x.id === id)!;
        const ru = f.matchRules?.length ? finApplyMatchRules(f, mine, this.now()) : null;
        const finalStatements = ru ? afterDp.map((x) => (x.id === id ? ru.statement : x)) : afterDp;
        return {
          // A hostel bill found on an earlier load of this statement is found again or loses its bank record.
          also: this.stampHostel(f, hostel, rg.hostelSeen, (b) => b.bankSeen?.statementId === id),
          patch: { statements: finalStatements, payments: m.payments, ...(f.arCases?.length ? { arCases: rc.cases } : {}), ...(gv ? { govtClaims: gv.claims } : {}), ...regPatch, ...(dp ? { clientDeposits: dp.deposits } : {}), ...(fdm ? { fixedDeposits: fdm.fds } : {}), ...(ru ? { matchRules: ru.rules } : {}) },
          action: 'finance.statement.loaded',
          summary: `${bank.bank} ${bank.accountMasked} statement ${p} loaded${prior ? ' (replacing the earlier load)' : ''}: ${parsed.length} lines, ${matched} of ${out} payments out matched.`,
          result: { statement: m.statement, matched, out },
        };
      }
      if (action === 'forget') {
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO removes a remembered rule)');
        const r = (f.matchRules ?? []).find((x) => x.id === input.ruleId);
        if (!r) throw new NotFound('Rule');
        const why = requireReason(input.comment, 'remove the rule');
        return { patch: { matchRules: (f.matchRules ?? []).filter((x) => x.id !== r.id) }, action: 'finance.statement.rule_removed', summary: `Rule ${r.id} ("${r.pattern}") removed: ${why}`, result: { ok: true } };
      }
      if (action === 'applyRules') {
        let rules = f.matchRules ?? [];
        let applied = 0;
        const next = statements.map((x) => {
          if (x.period < addMonthsP(this.desk.closePeriod(), -2)) return x;
          const r = finApplyMatchRules({ ...f, matchRules: rules }, x, this.now());
          rules = r.rules;
          applied += r.applied;
          return r.statement;
        });
        return { patch: applied ? { statements: next, matchRules: rules } : {}, action: 'finance.statement.rules_applied', summary: `Remembered rules explained ${applied} bank line(s).`, result: { applied } };
      }
      const st = statements.find((x) => x.id === input.statementId);
      if (!st) throw new NotFound('Statement');
      const line = st.lines.find((l) => l.id === input.lineId);
      if (!line) throw new NotFound('Statement line');
      if (action === 'match') {
        if (line.match) throw new BadRequest('That line is already matched. Unmatch it first.');
        const p = (f.payments ?? []).find((x) => x.id === input.paymentId);
        if (!p || p.status !== 'released' || p.cleared) throw new BadRequest('Choose a released payment that is not matched yet.');
        if (p.bankId !== st.bankId) throw new BadRequest('That payment was made from another bank account.');
        if (Math.abs(p.amount + line.amount) >= 0.005) throw new BadRequest(`Amounts differ: the payment is RM${p.amount.toFixed(2)}, the bank line RM${(-line.amount).toFixed(2)}.`);
        if (p.steps.some((s) => ['prepared', 'resubmitted', 'approved', 'released'].includes(s.step) && s.byId === user.id))
          throw new AccessDenied('view', '(nobody matches by hand a payment they prepared, approved or released)');
        const comment = requireComment(input.comment, 'match by hand');
        const lines = st.lines.map((l) => (l.id === line.id ? { ...l, match: { kind: 'payment' as const, paymentId: p.id, by: user.name, at: this.now() } } : l));
        return {
          patch: {
            statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)),
            payments: (f.payments ?? []).map((x) => (x.id === p.id ? { ...x, cleared: { statementId: st.id, lineId: line.id, date: line.date } } : x)),
          },
          action: 'finance.statement.matched',
          summary: `Bank line ${line.date} RM${line.amount.toFixed(2)} matched by hand to payment ${p.id}: ${comment}`,
          result: { ok: true },
        };
      }
      // Insider test (1 Nov 2026): whoever recorded a release from this account in the statement's month does not
      // explain away or unmatch its bank lines (the same rule as loading the statement).
      const paidFrom = (f.payments ?? []).some((x) => x.bankId === st.bankId && x.releasedOn?.slice(0, 7) === st.period && x.steps.some((s) => s.step === 'released' && s.byId === user.id));
      if ((action === 'explain' || action === 'unmatch') && paidFrom)
        throw new AccessDenied('view', `(you released payments from this account in ${st.period}; someone who did not pay from it explains or unmatches its lines)`);
      if (action === 'explain') {
        // Bank charges, receipts and transfers between the company's own accounts are explained, not matched.
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO explains bank lines)');
        if (line.match) throw new BadRequest('That line is already matched.');
        const note = requireReason(input.comment, 'explain this bank line');
        const lines = st.lines.map((l) => (l.id === line.id ? { ...l, match: { kind: 'other' as const, note, by: user.name, byId: user.id, at: this.now() } } : l));
        // A6: "remember this" makes a rule from the line's words, for this account, up to a cap (default twice this amount).
        let rule: FinMatchRule | null = null;
        if (input.remember === true) {
          const words = typeof input.pattern === 'string' && input.pattern.trim() ? input.pattern : line.description.replace(/\d+/g, ' ');
          const pattern = norm(words).slice(0, 40);
          if (pattern.length < 3) throw new BadRequest('Give the words that identify this kind of line (at least 3 letters).');
          const cap = input.maxAmount == null || input.maxAmount === '' ? round2(Math.abs(line.amount) * 2) : money(input.maxAmount, 'Up to amount');
          if (cap > s.ruleMaxAmount) throw new BadRequest(`A remembered rule covers lines up to RM${s.ruleMaxAmount.toLocaleString('en-MY')}; larger ones are explained one by one.`);
          const list = f.matchRules ?? [];
          if (list.some((r) => r.pattern === pattern && r.bankId === st.bankId)) throw new BadRequest('A rule with these words is already remembered for this account.');
          rule = { id: `rule-${f.companyId}-${String(list.length + 1).padStart(3, '0')}`, bankId: st.bankId, pattern, direction: line.amount > 0 ? 'in' : 'out', maxAmount: cap, note, by: user.name, byId: user.id, at: this.now(), used: 0 };
        }
        return {
          patch: { statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)), ...(rule ? { matchRules: [...(f.matchRules ?? []), rule] } : {}) },
          action: 'finance.statement.explained',
          summary: `Bank line ${line.date} RM${line.amount.toFixed(2)} explained: ${note}${rule ? `. Remembered as rule ${rule.id}: "${rule.pattern}", money ${rule.direction}, up to RM${rule.maxAmount.toFixed(2)}` : ''}`,
          result: { ok: true, rule },
        };
      }
      if (action === 'unmatch') {
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO unmatches)');
        const why = requireReason(input.comment, 'unmatch it');
        const lines = st.lines.map((l) => (l.id === line.id ? { ...l, match: null } : l));
        return {
          patch: {
            statements: statements.map((x) => (x.id === st.id ? { ...st, lines } : x)),
            payments: (f.payments ?? []).map((x) => (x.cleared?.lineId === line.id ? { ...x, cleared: null } : x)),
            ...(line.match?.kind === 'receipt' ? { arCases: finUnmatchReceipts(f.arCases ?? [], (x) => x.lineId === line.id) } : {}),
            ...(line.match?.kind === 'regular' || line.match?.kind === 'guarantee' ? finUnmatchRegular(f, (x) => x.lineId === line.id) : {}),
            ...(line.match?.kind === 'govt' ? { govtClaims: finUnmatchGovt(f.govtClaims ?? [], (x) => x.lineId === line.id, this.now()) } : {}),
            ...(line.match?.kind === 'deposit' ? { clientDeposits: finUnmatchDeposits(f.clientDeposits ?? [], (x) => x.lineId === line.id) } : {}),
            ...(line.match?.kind === 'fd' ? { fixedDeposits: finUnmatchFds(f.fixedDeposits ?? [], (x) => x.lineId === line.id) } : {}),
          },
          ...(line.match?.kind === 'hostel' ? { also: this.stampHostel(f, hostel, [], (b) => b.bankSeen?.lineId === line.id) } : {}),
          action: 'finance.statement.unmatched',
          summary: `Bank line ${line.date} unmatched: ${why}`,
          result: { ok: true },
        };
      }
      throw new BadRequest('Unknown statement action.');
    });
  }

  // ---------- Monthly ageing ----------

  private buckets(v: unknown, what: string): FinAgeBuckets {
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      current: money(o.current ?? 0, `${what} current`),
      d1to30: money(o.d1to30 ?? 0, `${what} 1-30 days`),
      d31to60: money(o.d31to60 ?? 0, `${what} 31-60 days`),
      d61to90: money(o.d61to90 ?? 0, `${what} 61-90 days`),
      over90: money(o.over90 ?? 0, `${what} over 90 days`),
    };
  }

  async ageingAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change(user, companyId, (f, a) => {
      const list = f.ageing ?? [];
      const p = period(input.period);
      if (p > this.desk.closePeriod()) throw new BadRequest('Ageing is recorded for months that have ended.');
      const cur = list.find((x) => x.period === p);
      if (action === 'record') {
        if (cur?.reviewed && !this.senior(a)) throw new BadRequest('That month is reviewed; the team leader re-opens it.');
        const age: FinAgeing = {
          period: p,
          ar: this.buckets(input.ar, 'Customers'),
          ap: this.buckets(input.ap, 'Suppliers'),
          glAr: money(input.glAr, 'Debtors in the ledger', true),
          glAp: money(input.glAp, 'Creditors in the ledger', true),
          source: text(input.source, 'The SQL Account ageing report filed (file name or SharePoint link)', 3, 300),
          note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
          prepared: this.sign(user),
          reviewed: null,
        };
        return {
          patch: { ageing: [...list.filter((x) => x.period !== p), age] },
          action: 'finance.ageing.recorded',
          summary: `Ageing ${p}: customers RM${ageTotal(age.ar).toFixed(2)} (over 90 days RM${age.ar.over90.toFixed(2)}), suppliers RM${ageTotal(age.ap).toFixed(2)}.`,
          result: age,
        };
      }
      if (action === 'review') {
        if (!cur) throw new NotFound('Ageing');
        if (cur.reviewed) throw new BadRequest('Already reviewed.');
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy or the team leader reviews the ageing)');
        if (cur.prepared.byId === user.id) throw new AccessDenied('view', '(nobody reviews the ageing they recorded)');
        const comment = requireComment(input.comment, 'review');
        const next = { ...cur, reviewed: this.sign(user, comment) };
        return { patch: { ageing: list.map((x) => (x.period === p ? next : x)) }, action: 'finance.ageing.reviewed', summary: `Ageing ${p} reviewed: ${comment}`, result: next };
      }
      throw new BadRequest('Unknown ageing action.');
    });
  }

  // ---------- e-Invoice (LHDN MyInvois, sent from SQL Account) ----------

  /** Set whether the company must issue e-Invoices, record the month's check from SQL Account, and review it. */
  async einvoiceAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a) => {
      const ei: FinEInvoice = f.einvoice ?? { setup: null, months: [] };
      const put = (next: FinEInvoice) => ({ einvoice: next });
      if (action === 'setup') {
        // Fauzan, 1 Nov 2026: the Finance Director sets each company's e-Invoice and SST set-up (the CEO too).
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO sets up e-Invoice)');
        // Fauzan, 1 Nov 2026: each company is its own entity; the RM3 million test uses its own turnover, not group sales.
        const ev = RULES.financeEInvoice.value;
        const revenue = money(input.revenue, "The company's own annual turnover (last financial year, RM)");
        // Review finding (1 Nov 2026): required: 'true' (text) was stored as false. Only a real yes/no is taken.
        if (typeof input.required !== 'boolean') throw new BadRequest('Say whether this company must issue e-Invoices (yes or no).');
        const required = input.required;
        // Standards review (1 Nov 2026): switching a tax check off is the Finance Director's or the CEO's decision.
        if (!required && !isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO records that a company does not need e-Invoices)');
        if (!required && revenue >= ev.exemptBelow)
          throw new BadRequest(`Turnover of RM${revenue.toLocaleString('en-MY')} is RM${ev.exemptBelow.toLocaleString('en-MY')} or more: this company must issue e-Invoices.`);
        const basis = requireReason(input.basis, required && revenue < ev.exemptBelow ? 'say why it issues e-Invoices voluntarily' : 'note the basis (turnover, LHDN guidance)');
        const startOn = required ? isoDate(input.startOn, 'Date e-Invoicing started for this company') : null;
        const via = (['sql_account', 'portal', 'other'] as const).find((v) => v === input.via) ?? 'sql_account';
        const next = { ...ei, setup: { required, basis, startOn, via, revenue, set: this.sign(user) } };
        return {
          patch: put(next),
          action: 'finance.einvoice.setup',
          summary: `e-Invoice ${required ? `required from ${startOn} via ${via}` : 'not required'} (own turnover RM${revenue.toFixed(2)}): ${basis}`,
          result: next,
        };
      }
      const p = period(input.period);
      if (p > this.desk.closePeriod()) throw new BadRequest('The e-Invoice check is recorded for months that have ended.');
      const cur = ei.months.find((x) => x.period === p);
      if (action === 'record') {
        if (!ei.setup?.required) throw new BadRequest('Set the company up for e-Invoice first (team leader, Finance Director or CEO).');
        const n = (k: string, label: string) => {
          const v = Number(input[k] ?? 0);
          if (!Number.isInteger(v) || v < 0 || v > 1_000_000) throw new BadRequest(`${label}: a whole number, 0 or more.`);
          return v;
        };
        const issued = n('issued', 'Sales documents issued');
        const valid = n('valid', 'Valid');
        const invalid = n('invalid', 'Invalid');
        const submitting = n('submitting', 'Stuck in Submitting');
        const notSubmitted = n('notSubmitted', 'Not submitted');
        if (valid + invalid + submitting + notSubmitted !== issued)
          throw new BadRequest(`Valid + invalid + submitting + not submitted (${valid + invalid + submitting + notSubmitted}) must equal the documents issued (${issued}).`);
        const consolidatedNeeded = input.consolidatedNeeded === true;
        let consolidated: FinEInvoiceMonth['consolidated'] = null;
        if (typeof input.consolidatedUuid === 'string' && input.consolidatedUuid.trim()) {
          // Review finding (1 Nov 2026): any text and a future date were accepted. Only the form of the UUID is checked
          // (MyInvois' 26-character document UUID, or a standard UUID); Prima does not confirm it with MyInvois.
          const uuid = input.consolidatedUuid.trim();
          if (!/^[A-Z0-9]{26}$/.test(uuid) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))
            throw new BadRequest('The consolidated e-Invoice UUID must be the 26-character MyInvois document UUID (capital letters and digits) as SQL Account shows it.');
          const submittedOn = isoDate(input.consolidatedOn, 'Date the consolidated e-Invoice was submitted');
          if (submittedOn > this.today()) throw new BadRequest('The consolidated e-Invoice submission date cannot be in the future.');
          if (submittedOn < `${p}-01`) throw new BadRequest(`The consolidated e-Invoice for ${p} cannot be submitted before the month started.`);
          consolidated = { uuid, submittedOn };
        } else if (input.consolidatedOn != null && input.consolidatedOn !== '') {
          throw new BadRequest('Give the consolidated e-Invoice UUID with its submission date.');
        }
        const selfBilledNeeded = n('selfBilledNeeded', 'Self-billed needed');
        const selfBilledValid = n('selfBilledValid', 'Self-billed validated');
        if (selfBilledValid > selfBilledNeeded) throw new BadRequest('Self-billed validated cannot be more than needed.');
        const m: FinEInvoiceMonth = {
          period: p,
          issued,
          valid,
          invalid,
          submitting,
          notSubmitted,
          consolidatedNeeded,
          consolidated,
          largeInConsolidated: n('largeInConsolidated', 'Sales above RM10,000 in the consolidated e-Invoice'),
          selfBilledNeeded,
          selfBilledValid,
          suppliersWithout: n('suppliersWithout', 'Supplier invoices without an e-Invoice'),
          lateCancels: n('lateCancels', 'Cancelled after 72 hours'),
          source: text(input.source, 'The SQL Account MyInvois Transaction listing filed (file name or SharePoint link)', 3, 300),
          note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
          prepared: this.sign(user),
          reviewed: null,
        };
        // Review finding (1 Nov 2026): an identical retry arriving late replaced the month and cleared its review. The
        // same counts sent again change nothing; different counts for a reviewed month need it reopened first.
        const counts = (x: FinEInvoiceMonth) => {
          const { prepared: _p, reviewed: _r, rev: _v, reopened: _o, note: _n, source: _s, ...rest } = x;
          return JSON.stringify(rest);
        };
        if (cur && counts(cur) === counts(m) && cur.source === m.source)
          return { patch: {}, action: 'finance.einvoice.unchanged', summary: `e-Invoice ${p}: the same counts were sent again; nothing changed.`, result: cur };
        if (cur?.reviewed) throw new BadRequest('That month is reviewed. The team leader, the Finance Director or the CEO reopens it (with a reason) before new counts are recorded.');
        m.rev = (cur?.rev ?? 1) + (cur ? 1 : 0);
        m.reopened = cur?.reopened;
        return {
          patch: put({ ...ei, months: [...ei.months.filter((x) => x.period !== p), m] }),
          action: 'finance.einvoice.recorded',
          summary: `e-Invoice ${p}: ${valid}/${issued} valid, ${invalid} invalid, ${submitting} stuck, ${notSubmitted} not submitted; consolidated ${consolidated ? consolidated.uuid : consolidatedNeeded ? 'MISSING' : 'not needed'}.`,
          result: m,
        };
      }
      if (action === 'review') {
        if (!cur) throw new NotFound('e-Invoice check');
        if (cur.reviewed) throw new BadRequest('Already reviewed.');
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy or the team leader reviews the e-Invoice check)');
        if (cur.prepared.byId === user.id) throw new AccessDenied('view', '(nobody reviews the e-Invoice check they recorded)');
        // Review finding (1 Nov 2026): a review opened on old counts signed new ones. The reviewer signs the revision read.
        if (input.rev !== (cur.rev ?? 1)) throw new BadRequest('The counts changed after you opened them. Reload and check the new counts before reviewing.');
        const comment = requireComment(input.comment, 'review');
        const next = { ...cur, reviewed: this.sign(user, comment) };
        return { patch: put({ ...ei, months: ei.months.map((x) => (x.period === p ? next : x)) }), action: 'finance.einvoice.reviewed', summary: `e-Invoice ${p} reviewed: ${comment}`, result: next };
      }
      if (action === 'reopen') {
        if (!cur) throw new NotFound('e-Invoice check');
        if (!cur.reviewed) throw new BadRequest('That month is not reviewed; record the new counts directly.');
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO reopens a reviewed e-Invoice check)');
        const why = requireReason(input.comment, 'reopen it');
        const rev = (cur.rev ?? 1) + 1;
        const next: FinEInvoiceMonth = { ...cur, reviewed: null, rev, reopened: [...(cur.reopened ?? []), { ...this.sign(user, why), rev }] };
        return { patch: put({ ...ei, months: ei.months.map((x) => (x.period === p ? next : x)) }), action: 'finance.einvoice.reopened', summary: `e-Invoice ${p} reopened (revision ${rev}): ${why}`, result: next };
      }
      throw new BadRequest('Unknown e-Invoice action.');
    });
  }

  /** The e-Invoice set-up, the last month's check, its due date and supplier payments with no e-Invoice reference. */
  einvoiceView(f: FinStatus, s: FinSettingsValues = finDefaults()) {
    const ev = { ...RULES.financeEInvoice.value, checkByDay: s.eInvoiceCheckByDay };
    const close = this.desk.closePeriod();
    const ei = f.einvoice ?? { setup: null, months: [] };
    const dueOn = `${addMonthsP(close, 1)}-${String(ev.checkByDay).padStart(2, '0')}`;
    const consolidateBy = `${addMonthsP(close, 1)}-${String(ev.consolidateByDay).padStart(2, '0')}`;
    const record = ei.months.find((x) => x.period === close) ?? null;
    const paymentsWithout = (f.payments ?? [])
      .filter((p) => p.payeeKind === 'supplier' && !p.eInvoiceRef && !['cancelled', 'returned'].includes(p.status))
      .map((p) => ({ id: p.id, payee: p.payee, amount: p.amount, status: p.status }));
    return {
      setup: ei.setup,
      period: close,
      record,
      dueOn,
      consolidateBy,
      late: !!ei.setup?.required && !record && this.today() > dueOn,
      history: [...ei.months].sort((x, y) => y.period.localeCompare(x.period)).slice(0, 12).map((m) => ({ period: m.period, issued: m.issued, valid: m.valid, open: m.invalid + m.submitting + m.notSubmitted, reviewed: !!m.reviewed })),
      paymentsWithout,
    };
  }

  // ---------- Invoice problems and bad debt (Fauzan, 1 Nov 2026) ----------

  /**
   * One customer invoice that is stuck: wrong payer or site, dispute, refusal, insolvency. Nothing is deleted: a wrong
   * invoice is reversed by a credit note and re-issued; a debt that cannot be recovered is provided for and written off
   * with evidence and the Finance Director's or the CEO's approval. Nothing goes back into a year already audited.
   */
  async arAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a, s) => {
      const rule = RULES.financeReceivables.value;
      const cases = f.arCases ?? [];
      const today = this.today();
      const audited = f.auditedTo?.date ?? null;
      if (action === 'auditedTo') {
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO records the signed audit)');
        const date = isoDate(input.date, 'Financial year end of the latest signed audited accounts');
        if (date > today) throw new BadRequest('That year has not ended.');
        if (audited && date < audited) throw new BadRequest(`Audited accounts are already recorded to ${audited}; a signed audit is not undone.`);
        const next = { date, set: this.sign(user, requireComment(input.comment, 'record the audit report (auditor and date signed)')) };
        return { patch: { auditedTo: next }, action: 'finance.ar.audited', summary: `Audited accounts signed to ${date}: ${next.set.comment}`, result: next };
      }
      if (action === 'fdReview') {
        // Fauzan, 1 Nov 2026: after 90 days the team follows up every month and the Finance Director is told and checks it is done.
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO reviews the overdue invoices)');
        const month = today.slice(0, 7);
        const over = cases.filter((c) => finArActive(c) && daysBetween(c.invoiceDate, today) >= rule.caseFromDays);
        const stale = over.filter((c) => finArStale(c, this.now()));
        const comment = requireComment(input.comment, 'review');
        if (stale.length && comment.length < 10)
          throw new BadRequest(`${stale.length} invoice(s) have no follow-up this month: say what you have told the team (at least 10 characters).`);
        const entry = { month, sign: this.sign(user, comment), cases: over.length, unpaid: round2(over.reduce((n, c) => n + c.outstanding, 0)) };
        const list = [...(f.arReviews ?? []).filter((x) => x.month !== month), entry].slice(-24);
        return { patch: { arReviews: list }, action: 'finance.ar.fdreview', summary: `Overdue invoices reviewed for ${month}: ${over.length} over ${rule.caseFromDays} days, RM${entry.unpaid.toFixed(2)} unpaid, ${stale.length} without follow-up. ${comment}`, result: entry };
      }
      const save = (c: FinArCase) => ({ arCases: [...cases.filter((x) => x.id !== c.id), c] });
      const logOf = (kind: string, textv: string, on?: IsoDate) => ({ kind, text: textv, by: user.name, byId: user.id, at: this.now(), ...(on ? { on } : {}) });
      if (action === 'open') {
        const invoiceNo = text(input.invoiceNo, 'SQL Account invoice number', 2, 40);
        if (cases.some((c) => c.invoiceNo === invoiceNo && ['open', 'reissue_pending', 'provision_pending', 'writeoff_pending'].includes(c.status)))
          throw new BadRequest(`Invoice ${invoiceNo} already has an open case.`);
        const invoiceDate = isoDate(input.invoiceDate, 'Invoice date');
        if (invoiceDate > today) throw new BadRequest('The invoice date is in the future.');
        const amount = money(input.amount, 'Invoice amount');
        const outstanding = input.outstanding == null || input.outstanding === '' ? amount : money(input.outstanding, 'Still unpaid');
        if (outstanding > amount) throw new BadRequest('Unpaid cannot be more than the invoice.');
        const reason = (['wrong_payer', 'site_changed', 'dispute', 'refused', 'insolvent', 'govt_late', 'other'] as FinArReason[]).find((r) => r === input.reason);
        if (!reason) throw new BadRequest('Why is it stuck: wrong payer, site changed, dispute, refused, insolvent or other?');
        const c: FinArCase = {
          id: `ar-${f.companyId}-${invoiceNo.replace(/[^A-Za-z0-9]/g, '')}-${cases.length + 1}`,
          invoiceNo,
          invoiceDate,
          customer: noSecrets(text(input.customer, 'Customer billed', 2, 160), 'Customer'),
          amount,
          outstanding,
          eInvoiceUuid: typeof input.eInvoiceUuid === 'string' && input.eInvoiceUuid.trim() ? text(input.eInvoiceUuid, 'e-Invoice UUID', 10, 80) : null,
          reason,
          detail: requireReason(input.detail, 'say what happened'),
          status: 'open',
          opened: this.sign(user),
          log: [],
          nextOn: input.nextOn ? isoDate(input.nextOn, 'Next follow-up') : null,
          reissue: null,
          provision: null,
          writeOff: null,
        };
        return { patch: save(c), action: 'finance.ar.opened', summary: `Invoice case ${invoiceNo} ${c.customer} RM${outstanding.toFixed(2)} unpaid: ${reason}. ${c.detail}`, result: c };
      }
      const c = cases.find((x) => x.id === input.caseId);
      if (!c) throw new NotFound('Invoice case');
      const active = ['open', 'reissue_pending', 'provision_pending', 'writeoff_pending'].includes(c.status);
      const pendingBy = (): string | undefined => (c.status === 'reissue_pending' ? c.reissue?.requested.byId : c.status === 'provision_pending' ? c.provision?.requested.byId : c.writeOff?.requested.byId);
      if (action === 'note') {
        if (!active) throw new BadRequest('The case is closed.');
        const kind = (['follow_up', 'reminder', 'demand_letter', 'lawyer', 'call', 'meeting'] as const).find((k) => k === input.kind) ?? 'follow_up';
        const textv = requireReason(input.text, 'say what was done');
        const nextOn = input.nextOn ? isoDate(input.nextOn, 'Next follow-up') : c.nextOn;
        const next = { ...c, log: [...c.log, logOf(kind, textv)], nextOn };
        return { patch: save(next), action: 'finance.ar.note', summary: `Invoice ${c.invoiceNo}: ${kind} - ${textv}`, result: next };
      }
      if (action === 'payment') {
        // Fauzan, 1 Nov 2026: no one person marks an invoice paid. The receipt waits until Prima finds it on the bank
        // statement of the account it was paid into; only then does the unpaid amount go down.
        if (!active || c.status !== 'open') throw new BadRequest('Record payments on an open case (return the pending request first).');
        const got = money(input.amount, 'Amount received');
        const waiting = round2((c.receipts ?? []).filter((r) => !r.matched).reduce((n, r) => n + r.amount, 0));
        if (got + waiting > c.outstanding + 0.005) throw new BadRequest(`RM${got.toFixed(2)} is more than the RM${round2(c.outstanding - waiting).toFixed(2)} unpaid (RM${waiting.toFixed(2)} already waiting for the bank statement).`);
        const ref = text(input.ref, 'SQL Account receipt number', 2, 40);
        const on = isoDate(input.on ?? today, 'Date the money came in');
        if (on > today) throw new BadRequest('The date the money came in is in the future.');
        const bank = f.banks.find((b) => b.id === input.bankId);
        if (!bank) throw new BadRequest('Which of this company\'s bank accounts was it paid into?');
        const receipts = c.receipts ?? [];
        if (receipts.some((r) => norm(r.ref) === norm(ref))) throw new BadRequest(`Receipt ${ref} is already recorded on this invoice.`);
        const r = { id: `${c.id}-r${receipts.length + 1}`, amount: got, ref, on, bankId: bank.id, ...this.sign(user), matched: null };
        const m = finMatchReceipts(f.statements ?? [], cases.map((x) => (x.id === c.id ? { ...c, receipts: [...receipts, r], log: [...c.log, logOf('payment', `RM${got.toFixed(2)} recorded as received ${on} (${ref}), waiting for the bank statement`)] } : x)), s.matchDays, this.now());
        const next = m.cases.find((x) => x.id === c.id)!;
        const found = !!next.receipts!.find((x) => x.id === r.id)!.matched;
        return {
          patch: { arCases: m.cases, statements: m.statements },
          action: 'finance.ar.payment',
          summary: `Invoice ${c.invoiceNo}: RM${got.toFixed(2)} recorded as received (${ref}, ${bank.bank} ${bank.accountMasked}); ${found ? `found on the bank statement, RM${next.outstanding.toFixed(2)} unpaid` : 'waiting for the bank statement'}.`,
          result: next,
        };
      }
      if (action === 'reissue') {
        if (c.status !== 'open') throw new BadRequest('Only an open case is re-issued.');
        const method = input.method === 'cancel72h' ? 'cancel72h' : 'credit_note';
        const creditNoteDate = isoDate(input.creditNoteDate ?? today, 'Credit note date');
        if (creditNoteDate > today) throw new BadRequest('The credit note date is in the future.');
        if (audited && creditNoteDate <= audited)
          throw new BadRequest(`The accounts to ${audited} are audited and signed. Date the credit note in the current open month, never back in the audited year.`);
        if (method === 'cancel72h') {
          if (!c.eInvoiceUuid) throw new BadRequest('Only a validated e-Invoice is cancelled in MyInvois; otherwise issue a credit note.');
          if (daysBetween(c.invoiceDate, today) > 3) throw new BadRequest('After 72 hours an e-Invoice cannot be cancelled: issue a credit note.');
        }
        const creditNoteNo = method === 'credit_note' ? text(input.creditNoteNo, 'SQL Account credit note number', 2, 40) : null;
        const reissue = {
          method,
          creditNoteNo,
          creditNoteDate,
          newInvoiceNo: text(input.newInvoiceNo, 'New SQL Account invoice number', 2, 40),
          newCustomer: noSecrets(text(input.newCustomer, 'The right payer', 2, 160), 'Payer'),
          newAmount: money(input.newAmount, 'New invoice amount'),
          note: requireReason(input.note, 'say what changed (payer, site, address, PO)'),
          requested: this.sign(user),
          approved: null,
        } as NonNullable<FinArCase['reissue']>;
        if (Math.abs(reissue.newAmount - c.amount) >= 0.005 && reissue.note.length < 20) throw new BadRequest('The new invoice amount differs: explain why in the note.');
        const next: FinArCase = { ...c, status: 'reissue_pending', reissue, log: [...c.log, logOf('reissue', `${method === 'cancel72h' ? 'Cancel in MyInvois' : `Credit note ${creditNoteNo}`} and new invoice ${reissue.newInvoiceNo} to ${reissue.newCustomer}`)] };
        return { patch: save(next), action: 'finance.ar.reissue', summary: `Invoice ${c.invoiceNo} to be reversed and re-issued as ${reissue.newInvoiceNo} to ${reissue.newCustomer}.`, result: next };
      }
      if (action === 'provision') {
        if (c.status !== 'open') throw new BadRequest('Only an open case gets a provision.');
        const amount = money(input.amount, 'Provision');
        if (amount > c.outstanding + 0.005) throw new BadRequest('The provision cannot be more than the unpaid amount.');
        const why = requireReason(input.comment, 'say why it may not be paid');
        const next: FinArCase = { ...c, status: 'provision_pending', provision: { amount, requested: this.sign(user, why), approved: null }, log: [...c.log, logOf('provision', `Provision RM${amount.toFixed(2)} asked: ${why}`)] };
        return { patch: save(next), action: 'finance.ar.provision', summary: `Invoice ${c.invoiceNo}: doubtful debt provision RM${amount.toFixed(2)} asked.`, result: next };
      }
      if (action === 'writeoff') {
        if (c.status !== 'open') throw new BadRequest('Only an open case is written off.');
        const age = daysBetween(c.invoiceDate, today);
        if (age < rule.writeOffMinDays && c.reason !== 'insolvent')
          throw new BadRequest(`The invoice is ${age} days old. Bad debt is written off after ${rule.writeOffMinDays} days of recovery steps, or earlier only when the customer is insolvent.`);
        const evidence = Array.isArray(input.evidence) ? input.evidence.map((e, i) => noSecrets(text(e, `Evidence ${i + 1}`, 3, 300), `Evidence ${i + 1}`)).slice(0, 10) : [];
        if (evidence.length < s.writeOffMinEvidence)
          throw new BadRequest(`Attach at least ${s.writeOffMinEvidence} pieces of evidence of recovery steps (demand letter, lawyer's letter, liquidation or bankruptcy notice).`);
        const amount = input.amount == null || input.amount === '' ? c.outstanding : money(input.amount, 'Amount to write off');
        if (amount > c.outstanding + 0.005) throw new BadRequest('The write-off cannot be more than the unpaid amount.');
        const writeOff = {
          amount,
          evidence,
          steps: requireReason(input.steps, 'list the recovery steps taken'),
          sqlRef: text(input.sqlRef, 'SQL Account document for the write-off (credit note or journal)', 2, 40),
          requested: this.sign(user),
          approved: null,
          sstPaid: input.sstPaid == null || input.sstPaid === '' ? 0 : money(input.sstPaid, 'Service tax already paid on this invoice'),
          sstRelief: null,
        };
        const next: FinArCase = { ...c, status: 'writeoff_pending', writeOff, log: [...c.log, logOf('writeoff', `Write-off RM${amount.toFixed(2)} asked`)] };
        return { patch: save(next), action: 'finance.ar.writeoff', summary: `Invoice ${c.invoiceNo} ${c.customer}: bad debt write-off RM${amount.toFixed(2)} asked.`, result: next };
      }
      if (action === 'approve' || action === 'return') {
        if (!['reissue_pending', 'provision_pending', 'writeoff_pending'].includes(c.status)) throw new BadRequest('Nothing is waiting for approval on this case.');
        // Fauzan, 1 Nov 2026: only the Finance Director, the CEO and the COO approve anything; in Finance, the FD or the CEO.
        if (!isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO approves this)');
        if (pendingBy() === user.id) throw new AccessDenied('view', '(nobody approves what they asked for)');
        if (action === 'return') {
          const why = requireReason(input.comment, 'return it');
          const next: FinArCase = {
            ...c,
            status: 'open',
            reissue: c.status === 'reissue_pending' ? null : c.reissue,
            provision: c.status === 'provision_pending' ? null : c.provision,
            writeOff: c.status === 'writeoff_pending' ? null : c.writeOff,
            log: [...c.log, logOf('returned', why)],
          };
          return { patch: save(next), action: 'finance.ar.returned', summary: `Invoice ${c.invoiceNo}: request returned. ${why}`, result: next };
        }
        const ok = this.sign(user, requireComment(input.comment, 'approve'));
        let next: FinArCase;
        if (c.status === 'reissue_pending') next = { ...c, status: 'reissued', outstanding: 0, reissue: { ...c.reissue!, approved: ok } };
        else if (c.status === 'provision_pending') next = { ...c, status: 'open', provision: { ...c.provision!, approved: ok } };
        else {
          const outstanding = round2(c.outstanding - c.writeOff!.amount);
          next = { ...c, status: outstanding <= 0.005 ? 'written_off' : 'open', outstanding, writeOff: { ...c.writeOff!, approved: ok } };
        }
        next = { ...next, log: [...next.log, logOf('approved', ok.comment)] };
        return { patch: save(next), action: `finance.ar.approved`, summary: `Invoice ${c.invoiceNo}: ${c.status.replace('_pending', '')} approved by ${user.name}: ${ok.comment}`, result: next };
      }
      if (action === 'sstRelief') {
        if (c.status !== 'written_off' || !c.writeOff?.approved) throw new BadRequest('SST bad debt relief is claimed after the write-off is approved.');
        if (!(c.writeOff.sstPaid > 0)) throw new BadRequest('No service tax was paid on this invoice, so there is nothing to reclaim.');
        if (c.writeOff.sstRelief) throw new BadRequest('A Customs claim is already prepared for this invoice.');
        const sst = f.sst ?? { registered: true, sstNo: null, cycleStartMonth: 1, last12Months: null, returns: [] };
        const claim = this.customsClaim(user, sst, {
          kind: 'bad_debt_relief',
          amount: c.writeOff.sstPaid,
          reason: `Bad debt written off on invoice ${c.invoiceNo} (${c.customer}) after recovery steps; service tax was paid to Customs.`,
          documents: input.documents,
          caseId: c.id,
        });
        const next: FinArCase = {
          ...c,
          writeOff: { ...c.writeOff, sstRelief: { ref: claim.id, on: today, by: user.name } },
          log: [...c.log, logOf('sst_relief', `Customs claim ${claim.id} prepared for SST bad debt relief RM${c.writeOff.sstPaid.toFixed(2)}`)],
        };
        return {
          patch: { ...save(next), sst: { ...sst, claims: [...(sst.claims ?? []), claim] } },
          action: 'finance.ar.sstrelief',
          summary: `Invoice ${c.invoiceNo}: SST bad debt relief claim RM${c.writeOff.sstPaid.toFixed(2)} prepared (${claim.documents.length} documents).`,
          result: next,
        };
      }
      if (action === 'close') {
        if (c.status !== 'open') throw new BadRequest('Only an open case is closed this way.');
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO closes a case)');
        const why = requireReason(input.comment, 'say why it is settled');
        const next: FinArCase = { ...c, status: 'closed', log: [...c.log, logOf('closed', why)] };
        return { patch: save(next), action: 'finance.ar.closed', summary: `Invoice ${c.invoiceNo} case closed: ${why}`, result: next };
      }
      throw new BadRequest('Unknown invoice case action.');
    });
  }

  /** Invoice cases with their age, whether they sit in an audited year, follow-ups overdue, and ageing not covered. */
  arView(f: FinStatus) {
    const rule = RULES.financeReceivables.value;
    const today = this.today();
    const audited = f.auditedTo?.date ?? null;
    const cases = [...(f.arCases ?? [])]
      .sort((x, y) => Number(finArActive(y)) - Number(finArActive(x)) || x.invoiceDate.localeCompare(y.invoiceDate))
      .map((c) => ({ ...c, ageDays: daysBetween(c.invoiceDate, today), priorYear: !!audited && c.invoiceDate <= audited, stale: finArStale(c, this.now()) }));
    const close = this.desk.closePeriod();
    const age = (f.ageing ?? []).find((x) => x.period === close) ?? null;
    const covered = round2(cases.filter((c) => finArActive(c)).reduce((n, c) => n + c.outstanding, 0));
    const month = today.slice(0, 7);
    const over = cases.filter((c) => finArActive(c) && c.ageDays >= rule.caseFromDays);
    return {
      month,
      over90: { cases: over.length, unpaid: round2(over.reduce((n, c) => n + c.outstanding, 0)), noFollowUp: over.filter((c) => c.stale).length },
      fdReview: (f.arReviews ?? []).find((x) => x.month === month) ?? null,
      fdReviews: [...(f.arReviews ?? [])].reverse().slice(0, 6),
      auditedTo: f.auditedTo ?? null,
      cases: cases.slice(0, 200),
      ageingOver90: age ? age.ar.over90 : null,
      covered,
      uncovered: age ? Math.max(0, round2(age.ar.over90 - covered)) : null,
      rule,
    };
  }

  /** A claim to Customs with its full document pack (at least 3 documents). */
  private customsClaim(
    user: User,
    sst: FinSst,
    o: { kind: FinCustomsClaim['kind']; amount: unknown; reason: string; documents: unknown; returnId?: Id | null; caseId?: Id | null },
  ): FinCustomsClaim {
    const min = RULES.financeSst.value.claimMinDocs;
    const documents = Array.isArray(o.documents) ? o.documents.map((d, i) => noSecrets(text(d, `Document ${i + 1}`, 3, 300), `Document ${i + 1}`)).slice(0, 30) : [];
    if (documents.length < min)
      throw new BadRequest(
        `Customs needs the full documents: list at least ${min} (invoice and credit notes, the SST-02 and payment receipt, the customer's payment record, the write-off approval and recovery evidence).`,
      );
    return {
      id: `cc-${(sst.claims ?? []).length + 1}-${this.today().replace(/-/g, '')}`,
      kind: o.kind,
      amount: money(o.amount, 'Amount claimed'),
      reason: o.reason,
      documents,
      returnId: o.returnId ?? null,
      caseId: o.caseId ?? null,
      prepared: this.sign(user),
      submitted: null,
      result: null,
    };
  }

  // ---------- Service tax (SST) ----------

  async sstAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change<unknown>(user, companyId, (f, a) => {
      const rule = RULES.financeSst.value;
      const sst: FinSst = f.sst ?? { registered: false, sstNo: null, cycleStartMonth: 1, last12Months: null, returns: [] };
      const put = (next: FinSst) => ({ sst: next });
      if (action === 'setup') {
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO sets up SST)');
        const registered = input.registered === true;
        if (!registered && !isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO records that a company is not registered for SST)');
        const sstNo = registered ? noSecrets(text(input.sstNo, 'SST registration number', 5, 40), 'SST number') : null;
        const cycle = Number(input.cycleStartMonth);
        if (!Number.isInteger(cycle) || cycle < 1 || cycle > 12) throw new BadRequest('The first month of the taxable period cycle (1 to 12), as in the Customs registration letter.');
        const last12 = input.last12Months == null || input.last12Months === '' ? null : money(input.last12Months, 'Taxable services, last 12 months');
        const next = { ...sst, registered, sstNo, cycleStartMonth: cycle, last12Months: last12 };
        return { patch: put(next), action: 'finance.sst.setup', summary: `SST ${registered ? `registered ${sstNo}` : 'not registered'}, cycle from month ${cycle}.`, result: next };
      }
      if (action === 'prepare') {
        if (!sst.registered) throw new BadRequest('Set up the SST registration first.');
        const month = period(input.month, 'A month in the taxable period');
        const per = sstPeriodOf(month, sst.cycleStartMonth);
        if (per.to > this.desk.closePeriod()) throw new BadRequest(`The taxable period ${per.from} to ${per.to} has not ended yet.`);
        const id = `sst-${f.companyId}-${per.from}`;
        const cur = sst.returns.find((r) => r.id === id);
        if (cur?.filed) throw new BadRequest('That return is filed already.');
        // Fauzan, 1 Nov 2026: SST is charged to the client at 8% of the bill without SST and paid to Customs on money
        // received, so the tax on a receipt is 8/108 of it. Prima works the tax out from the money received and checks it
        // against the SST on the invoices those receipts paid; the declared tax must equal it unless explained.
        // Review finding (Arisha main, 1 Nov 2026): every new return carries both sides of the comparison; the older
        // value x rate path is only read back for returns stored before this change.
        if (input.received == null || input.received === '') throw new BadRequest('Give the money received for taxable services in the period (SST included).');
        if (input.invoiceSst == null || input.invoiceSst === '') throw new BadRequest('Give the SST shown on the invoices those receipts paid, so Prima can compare the two.');
        const received = money(input.received, 'Money received for taxable services (SST included)');
        const invoiceSst = money(input.invoiceSst, 'SST on the invoices those receipts paid');
        const byReceipts: number | null = finSstOnReceipt(received, rule.rate);
        const taxableValue = round2(received - byReceipts);
        const declared = money(input.declared, 'Service tax declared');
        const expected = byReceipts;
        const differenceNote = typeof input.differenceNote === 'string' ? input.differenceNote.trim().slice(0, 500) : '';
        const pct = `${rule.rate * 100}/${100 + rule.rate * 100}`;
        if (Math.abs(invoiceSst - byReceipts) > rule.toleranceRm && differenceNote.length < 10)
          throw new BadRequest(
            `The SST on the invoices paid (RM${invoiceSst.toFixed(2)}) does not agree with ${pct} of the money received (RM${byReceipts.toFixed(2)}). Check part payments, short payments or wrong SST on an invoice, and explain in at least 10 characters.`,
          );
        if (Math.abs(declared - expected) > rule.toleranceRm && differenceNote.length < 10)
          throw new BadRequest(
            `The declared tax RM${declared.toFixed(2)} is not ${pct} of the RM${received.toFixed(2)} received (RM${expected.toFixed(2)}). Explain the difference in at least 10 characters.`,
          );
        const ret: FinSstReturn = {
          id,
          from: per.from,
          to: per.to,
          dueOn: per.dueOn,
          taxableValue,
          received,
          invoiceSst,
          rate: rule.rate,
          declared,
          differenceNote,
          prepared: this.sign(user, text(input.source, 'The SQL Account SST listing or SST-02 draft filed', 3, 300)),
          reviewed: null,
          filed: null,
          paymentId: cur?.paymentId ?? null,
        };
        return {
          patch: put({ ...sst, returns: [...sst.returns.filter((r) => r.id !== id), ret] }),
          action: 'finance.sst.prepared',
          summary: `SST-02 ${per.from} to ${per.to}: taxable RM${taxableValue.toFixed(2)}, declared RM${declared.toFixed(2)} (expected RM${expected.toFixed(2)}), due ${per.dueOn}.`,
          result: ret,
        };
      }
      // Claims to Customs (Fauzan, 1 Nov 2026): a wrong payment, or bad debt relief (prepared from the invoice case).
      if (action === 'claim') {
        const claim = this.customsClaim(user, sst, {
          kind: 'wrong_payment',
          amount: input.amount,
          reason: requireReason(input.reason, 'say what was paid wrongly and why'),
          documents: input.documents,
          returnId: typeof input.returnId === 'string' && sst.returns.some((r) => r.id === input.returnId) ? input.returnId : null,
        });
        return { patch: put({ ...sst, claims: [...(sst.claims ?? []), claim] }), action: 'finance.sst.claim', summary: `Customs claim ${claim.id} prepared: RM${claim.amount.toFixed(2)} wrong payment.`, result: claim };
      }
      if (action === 'claimSubmit' || action === 'claimResult') {
        const claims = sst.claims ?? [];
        const cl = claims.find((x) => x.id === input.claimId);
        if (!cl) throw new NotFound('Customs claim');
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO handles Customs claims)');
        let next: typeof cl;
        if (action === 'claimSubmit') {
          if (cl.submitted) throw new BadRequest('Already submitted.');
          if (cl.prepared.byId === user.id) throw new AccessDenied('view', '(someone other than the preparer checks the documents and submits the claim)');
          next = { ...cl, submitted: { ...this.sign(user, requireComment(input.comment, 'submit')), ref: text(input.ref, 'Customs claim reference', 3, 60), on: isoDate(input.on ?? this.today(), 'Date submitted') } };
        } else {
          if (!cl.submitted) throw new BadRequest('Submit the claim first.');
          if (cl.result) throw new BadRequest('Customs has already answered.');
          const outcome = input.outcome === 'approved' ? 'approved' : input.outcome === 'rejected' ? 'rejected' : null;
          if (!outcome) throw new BadRequest('Did Customs approve or reject it?');
          const amount = outcome === 'approved' ? money(input.amount, 'Amount Customs approved') : 0;
          if (amount > cl.amount + 0.005) throw new BadRequest('Customs cannot approve more than was claimed.');
          next = { ...cl, result: { ...this.sign(user, requireComment(input.comment, 'record Customs’ answer')), outcome, amount, on: isoDate(input.on ?? this.today(), 'Date of the answer') } };
        }
        return {
          patch: put({ ...sst, claims: claims.map((x) => (x.id === cl.id ? next : x)) }),
          action: `finance.sst.${action}`,
          summary: `Customs claim ${cl.id}: ${action === 'claimSubmit' ? `submitted, ref ${next.submitted!.ref}` : `${next.result!.outcome}, RM${next.result!.amount.toFixed(2)}`}.`,
          result: next,
        };
      }
      const ret = sst.returns.find((r) => r.id === input.returnId);
      if (!ret) throw new NotFound('SST return');
      const save = (next: FinSstReturn) => put({ ...sst, returns: sst.returns.map((r) => (r.id === ret.id ? next : r)) });
      if (action === 'review') {
        if (ret.reviewed) throw new BadRequest('Already reviewed.');
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy or the team leader reviews SST returns)');
        if (ret.prepared.byId === user.id) throw new AccessDenied('view', '(nobody reviews the return they prepared)');
        const next = { ...ret, reviewed: this.sign(user, requireComment(input.comment, 'review')) };
        return { patch: save(next), action: 'finance.sst.reviewed', summary: `SST-02 ${ret.from} reviewed: ${next.reviewed!.comment}`, result: next };
      }
      if (action === 'file') {
        if (!ret.reviewed) throw new BadRequest('Review it before filing.');
        if (ret.filed) throw new BadRequest('Already filed.');
        if (!this.senior(a)) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO records the filing)');
        if (ret.prepared.byId === user.id) throw new AccessDenied('view', '(the preparer does not file their own return)');
        const ackRef = noSecrets(text(input.ackRef, 'The MySST acknowledgement number', 4, 60), 'Acknowledgement');
        const filedOn = isoDate(input.filedOn ?? this.today(), 'Filing date');
        if (filedOn > this.today()) throw new BadRequest('The filing date cannot be in the future.');
        const next = { ...ret, filed: { ...this.sign(user, requireComment(input.comment, 'record the filing')), ackRef, filedOn } };
        return { patch: save(next), action: 'finance.sst.filed', summary: `SST-02 ${ret.from} filed in MySST on ${filedOn}, ack ${ackRef}${filedOn > ret.dueOn ? ' (LATE)' : ''}.`, result: next };
      }
      if (action === 'linkPayment') {
        // The tax goes to Customs through a normal Prima payment: same separation of duties and payee verification.
        const p = (f.payments ?? []).find((x) => x.id === input.paymentId);
        if (!p || ['cancelled', 'returned'].includes(p.status)) throw new BadRequest('Choose a live payment to the Royal Malaysian Customs Department.');
        if (p.payeeKind !== 'tax') throw new BadRequest('The payment must be to a tax payee (the Royal Malaysian Customs Department).');
        if (Math.abs(p.amount - ret.declared) >= 0.005)
          throw new BadRequest(`The payment is RM${p.amount.toFixed(2)} but the return declares RM${ret.declared.toFixed(2)}. Customs must be paid exactly the declared tax.`);
        if (sst.returns.some((r) => r.id !== ret.id && r.paymentId === p.id)) throw new BadRequest('That payment already pays another return.');
        const next = { ...ret, paymentId: p.id };
        return { patch: save(next), action: 'finance.sst.payment', summary: `SST-02 ${ret.from} paid by payment ${p.id} (RM${p.amount.toFixed(2)}, ${p.status}).`, result: next };
      }
      throw new BadRequest('Unknown SST action.');
    });
  }

  /** What each SST return still needs, the expected tax and any late penalty building up. */
  sstView(f: FinStatus, s: FinSettingsValues = finDefaults()) {
    const today = this.today();
    const rule = { ...RULES.financeSst.value, threshold: s.sstThreshold };
    const sst = f.sst ?? null;
    if (!sst) return null;
    const close = this.desk.closePeriod();
    const due: { from: string; to: string; dueOn: IsoDate }[] = [];
    if (sst.registered) {
      // The last three ended taxable periods must each have a return.
      let per = sstPeriodOf(close, sst.cycleStartMonth);
      if (per.to > close) per = sstPeriodOf(addMonthsP(per.from, -1), sst.cycleStartMonth);
      for (let i = 0; i < 3; i += 1) {
        due.push(per);
        per = sstPeriodOf(addMonthsP(per.from, -1), sst.cycleStartMonth);
      }
    }
    const returns = due.map((per) => {
      const r = sst.returns.find((x) => x.from === per.from) ?? null;
      const pay = r?.paymentId ? (f.payments ?? []).find((p) => p.id === r.paymentId) ?? null : null;
      const paidOn = pay?.status === 'released' ? pay.releasedOn : null;
      const expected = r ? (r.received != null ? finSstOnReceipt(r.received, r.rate) : round2(r.taxableValue * r.rate)) : null;
      const problems: string[] = [];
      if (!r) problems.push('Not prepared');
      else {
        if (!r.reviewed) problems.push('Not reviewed');
        if (!r.filed) problems.push('Not filed in MySST');
        else if (r.filed.filedOn > per.dueOn) problems.push('Filed late');
        if (!pay) problems.push('No payment to Customs linked');
        else if (!paidOn) problems.push(`Payment ${pay.status}`);
        else if (paidOn > per.dueOn) problems.push('Paid late');
        if (pay && Math.abs(pay.amount - r.declared) >= 0.005) problems.push('Payment differs from the declared tax');
      }
      const unpaidTax = r ? (paidOn ? 0 : r.declared) : 0;
      const penalty = r ? sstPenalty(unpaidTax || (paidOn && paidOn > per.dueOn ? r.declared : 0), per.dueOn, paidOn ?? today) : 0;
      const tone: 'ok' | 'warn' | 'crit' = !problems.length ? 'ok' : today > per.dueOn ? 'crit' : 'warn';
      // Older returns were prepared on value x rate, before the receipts comparison: shown as such, kept apart.
      const basis: 'receipts' | 'legacy' | null = !r ? null : r.received != null && r.invoiceSst != null ? 'receipts' : 'legacy';
      return { ...per, record: r, expected, basis, payment: pay ? { id: pay.id, amount: pay.amount, status: pay.status, releasedOn: pay.releasedOn } : null, problems, penalty, tone };
    });
    const mustRegister = !sst.registered && (sst.last12Months ?? 0) > rule.threshold;
    return { registered: sst.registered, sstNo: sst.sstNo, cycleStartMonth: sst.cycleStartMonth, last12Months: sst.last12Months, mustRegister, returns, claims: [...(sst.claims ?? [])].reverse() };
  }

  // ---------- Budget and forecast ----------

  private figures(v: unknown, field: string): FinPlanFigures {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest(`${field}: give an amount for each month, by line.`);
    const out: FinPlanFigures = {};
    for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
      const line = FIN_PLAN_LINES.find((x) => x === k);
      if (!line) throw new BadRequest(`Unknown plan line "${k}".`);
      if (!Array.isArray(arr) || arr.length !== 12) throw new BadRequest(`${field} ${line}: 12 monthly amounts, January to December.`);
      out[line] = arr.map((n, i) => money(n, `${field} ${line} month ${i + 1}`));
    }
    if (!out.revenue) throw new BadRequest(`${field}: revenue is needed.`);
    return out;
  }

  async planAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    return this.change(user, companyId, (f, a) => {
      const year = Number(input.year);
      if (!Number.isInteger(year) || year < 2025 || year > 2035) throw new BadRequest('Which year (e.g. 2027)?');
      const plans = f.plans ?? [];
      const blank: FinPlan = {
        year,
        budget: { months: {}, assumptions: '', status: 'draft', prepared: null, approved: null, returned: null },
        actuals: {},
        forecasts: [],
        variances: [],
      };
      const plan = plans.find((p) => p.year === year) ?? blank;
      const save = (next: FinPlan) => ({ plans: [...plans.filter((p) => p.year !== year), next] });
      if (action === 'draft') {
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO prepares the budget)');
        if (plan.budget.status === 'approved' || plan.budget.status === 'submitted') throw new BadRequest(`The ${year} budget is ${plan.budget.status}; it is not changed now (use the forecast).`);
        const months = this.figures(input.months, 'Budget');
        const assumptions = text(input.assumptions, 'Assumptions (guards, rates, new contracts, wage changes)', 10, 2000);
        const authorIds = [...new Set([...(plan.budget.authorIds ?? []), ...(plan.budget.prepared ? [plan.budget.prepared.byId] : []), user.id])];
        const leadAuthors = finLeadAuthors(a, plan.budget.leadAuthors, 'budget');
        // A change to a budget already drafted names the edit it was shown (stale screens); the first draft starts at 1.
        const seq = plan.budget.prepared ? finSeqNext(plan.budget, input, 'budget') : 1;
        const next = { ...plan, budget: { ...plan.budget, months, assumptions, status: 'draft' as const, seq, prepared: this.sign(user), authorIds, leadAuthors } };
        return { patch: save(next), action: 'finance.budget.drafted', summary: `Budget ${year} drafted: revenue RM${sum(months.revenue).toFixed(2)}.`, result: next };
      }
      if (action === 'submit') {
        if (plan.budget.status !== 'draft' && plan.budget.status !== 'returned') throw new BadRequest('Only a draft or returned budget is submitted.');
        if (!plan.budget.prepared) throw new BadRequest('Draft it first.');
        const seq = finSeqNext(plan.budget, input, 'budget');
        // The recorded preparer stays; the submitter is added to the authors, so neither can approve it.
        const authorIds = [...new Set([...(plan.budget.authorIds ?? []), plan.budget.prepared.byId, user.id])];
        const next = {
          ...plan,
          budget: { ...plan.budget, status: 'submitted' as const, seq, authorIds, leadAuthors: finLeadAuthors(a, plan.budget.leadAuthors, 'budget'), submitted: this.sign(user, typeof input.comment === 'string' ? input.comment.trim().slice(0, 500) : '') },
        };
        return { patch: save(next), action: 'finance.budget.submitted', summary: `Budget ${year} submitted for approval.`, result: next };
      }
      if (action === 'approve' || action === 'return') {
        if (plan.budget.status !== 'submitted') throw new BadRequest('Only a submitted budget is approved or returned.');
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO approves the budget)');
        const authors = new Set([...(plan.budget.authorIds ?? []), plan.budget.prepared?.byId, plan.budget.submitted?.byId]);
        if (authors.has(user.id)) throw new AccessDenied('view', '(nobody approves a budget they drafted or submitted)');
        const seq = finSeqNext(plan.budget, input, 'budget');
        const next =
          action === 'approve'
            ? { ...plan, budget: { ...plan.budget, status: 'approved' as const, seq, approved: this.sign(user, requireComment(input.comment, 'approve')) } }
            : { ...plan, budget: { ...plan.budget, status: 'returned' as const, seq, returned: this.sign(user, requireReason(input.comment, 'return it')) } };
        return { patch: save(next), action: `finance.budget.${action}`, summary: `Budget ${year} ${action === 'approve' ? 'approved' : 'returned'}.`, result: next };
      }
      if (action === 'actuals') {
        const month = period(input.month);
        if (Number(month.slice(0, 4)) !== year) throw new BadRequest('That month is in another year.');
        if (month > this.desk.closePeriod()) throw new BadRequest('Actuals are recorded for months that have ended.');
        const vals = (input.values ?? {}) as Record<string, unknown>;
        const idx = Number(month.slice(5)) - 1;
        const actuals = { ...plan.actuals };
        for (const [k, v] of Object.entries(vals)) {
          const line = FIN_PLAN_LINES.find((x) => x === k);
          if (!line) throw new BadRequest(`Unknown plan line "${k}".`);
          const arr = [...(actuals[line] ?? Array(12).fill(null))];
          arr[idx] = money(v, `Actual ${line}`);
          actuals[line] = arr;
        }
        if (!Object.keys(vals).length) throw new BadRequest('Give the month’s actual figures from the SQL Account profit and loss.');
        const next = { ...plan, actuals };
        return { patch: save(next), action: 'finance.plan.actuals', summary: `Actuals ${month} recorded from SQL Account (${text(input.source, 'The SQL Account P&L filed', 3, 300)}).`, result: next };
      }
      if (action === 'forecast') {
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO re-forecasts)');
        const asOf = period(input.asOf, 'Forecast as of month');
        // Fauzan, 1 Nov 2026: "we do forecast on quarterly and yearly".
        const kind: 'quarterly' | 'yearly' | null = input.kind === 'yearly' ? 'yearly' : input.kind == null || input.kind === 'quarterly' ? 'quarterly' : null;
        if (!kind) throw new BadRequest('A forecast is quarterly or yearly.');
        if (asOf > this.desk.closePeriod()) throw new BadRequest('A forecast is made as of a month that has closed.');
        if (kind === 'quarterly') {
          if (Number(asOf.slice(0, 4)) !== year) throw new BadRequest(`A quarterly forecast for ${year} is made after a ${year} quarter closes.`);
          if (Number(asOf.slice(5)) % 3 !== 0) throw new BadRequest('A quarterly forecast is made as of a quarter end (March, June, September or December).');
        } else if (Number(asOf.slice(0, 4)) > year) throw new BadRequest(`The yearly forecast for ${year} is made before the year ends.`);
        const months = this.figures(input.months, 'Forecast');
        const note = requireReason(input.note, 'say what changed since the last forecast');
        const same = (x: (typeof plan.forecasts)[number]) => x.asOf === asOf && (x.kind ?? 'quarterly') === kind;
        const next = { ...plan, forecasts: [...plan.forecasts.filter((x) => !same(x)), { asOf, months, note, by: this.sign(user), kind }] };
        return { patch: save(next), action: 'finance.plan.forecast', summary: `${kind === 'yearly' ? 'Yearly' : 'Quarterly'} forecast ${year} as of ${asOf}: revenue RM${sum(months.revenue).toFixed(2)}. ${note}`, result: next };
      }
      if (['revise', 'submitRevision', 'approveRevision', 'returnRevision', 'withdrawRevision'].includes(action)) {
        const out = finBudgetRevisionAction({ user, a, close: this.desk.closePeriod(), sign: (c = '') => this.sign(user, c) }, plan, action, input);
        return { patch: save(out.plan), action: `finance.budget.${action}`, summary: out.summary, result: out.result };
      }
      if (['fc3Save', 'fc3Submit', 'fc3Approve', 'fc3Return', 'fc3Withdraw'].includes(action)) {
        const out = finThreeStatementAction({ user, a, close: this.desk.closePeriod(), sign: (c = '') => this.sign(user, c), reviewer: this.reviewer(a) }, f, plan, action, input);
        return { patch: save(out.plan), action: `finance.plan3.${action}`, summary: out.summary, result: out.result };
      }
      if (action === 'explain') {
        const key = text(input.key, 'Which variance', 3, 40);
        const why = requireReason(input.text, 'explain the variance');
        const figures = finVarianceFigures(plan, key);
        if (!figures) throw new BadRequest('Which variance? Give the month and line, e.g. 2026-09:revenue.');
        const next = { ...plan, variances: [...plan.variances.filter((v) => v.key !== key), { key, text: why, by: this.sign(user), figures, accepted: null }] };
        return { patch: save(next), action: 'finance.plan.variance', summary: `Variance ${key} explained: ${why}`, result: next };
      }
      if (action === 'acceptVariance') {
        if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO accepts a variance explanation)');
        const key = text(input.key, 'Which variance', 3, 40);
        const v = plan.variances.find((x) => x.key === key);
        if (!v) throw new NotFound('Variance explanation');
        if (v.accepted) throw new BadRequest('That explanation is accepted already.');
        if (v.by.byId === user.id) throw new AccessDenied('view', '(nobody accepts their own explanation)');
        const figures = finVarianceFigures(plan, key)!;
        if (!finSameFigures(v.figures, figures))
          throw new BadRequest(`The figures changed after this was explained (now budget RM${figures.budget.toFixed(2)}, actual ${figures.actual == null ? 'none' : `RM${figures.actual.toFixed(2)}`}); the team explains it again first.`);
        const comment = requireComment(input.comment, 'accept the explanation');
        const next = { ...plan, variances: plan.variances.map((x) => (x.key === key ? { ...x, accepted: { ...this.sign(user, comment), figures } } : x)) };
        return { patch: save(next), action: 'finance.plan.variance.accepted', summary: `Variance ${key} explanation accepted: ${comment}`, result: next };
      }
      throw new BadRequest('Unknown plan action.');
    });
  }

  /** Budget against actual by month, the latest forecast, and the variances still to explain. */
  planView(f: FinStatus, year: number, ctl: FinSettingsValues = finDefaults()) {
    const plan = (f.plans ?? []).find((p) => p.year === year) ?? null;
    if (!plan) return { ...finPlan3View(f, null), year, plan: null, months: [], toExplain: [], toAccept: [] as { key: string; text: string; by: string; byId: string }[], forecastDue: false, forecastsOwed: [] as { asOf: string; dueOn: string; overdue: boolean }[], yearlyDue: false, quarterEnd: false, latestForecast: null, latestKind: null };
    const close = this.desk.closePeriod();
    const latest = [...plan.forecasts].sort((a, b) => b.asOf.localeCompare(a.asOf))[0] ?? null;
    const inForce = finBudgetInForce(plan);
    const lines = FIN_PLAN_LINES.filter((l) => inForce[l] || plan.actuals[l]);
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, '0')}`;
      const rows = lines.map((l) => {
        const budget = inForce[l]?.[i] ?? 0;
        const actual = plan.actuals[l]?.[i] ?? null;
        const forecast = latest?.months[l]?.[i] ?? null;
        const diff = actual == null ? null : round2(actual - budget);
        const off = diff != null && Math.abs(diff) >= ctl.varianceMinRm && budget !== 0 && Math.abs(diff / budget) * 100 > ctl.variancePct;
        const key = `${m}:${l}`;
        // An explanation written for other figures no longer counts (older ones without figures still do).
        const v = plan.variances.find((x) => x.key === key);
        const current = !!v && (!v.figures || finSameFigures(v.figures, { budget, actual }));
        return { line: l, budget, actual, forecast, diff, off, key, explained: current ? v!.text : null, changed: !!v && !current };
      });
      return { month: m, closed: m <= close, rows };
    });
    // Fauzan, 1 Nov 2026 ("5. Yes"): every variance has an owner, the company's team leader, and a due date; the FD or the
    // CEO accepts the explanation, never the person who wrote it.
    const owner = `Team ${f.team} leader`;
    const dueOf = (m: string) => `${addMonthsP(m, 1)}-${String(ctl.varianceByDay).padStart(2, '0')}`;
    const toExplain = months.flatMap((m) =>
      m.rows.filter((r) => r.off && !r.explained).map((r) => ({ month: m.month, ...r, owner, dueOn: dueOf(m.month), overdue: this.today() > dueOf(m.month) })),
    );
    const toAccept = plan.variances
      .filter((v) => months.some((m) => m.rows.some((r) => r.key === v.key && r.off && r.explained != null)))
      .filter((v) => !v.accepted || !finSameFigures(v.accepted.figures, v.figures))
      .map((v) => ({ key: v.key, text: v.text, by: v.by.by, byId: v.by.byId }));
    // Quarterly (Fauzan, 1 Nov 2026): a re-forecast is due after each quarter-end close in the plan year, by the day
    // the FD sets. Yearly: the year's outlook is due once the year has started if none was made.
    // Review finding (Arisha main, 1 Nov 2026): a missed September forecast disappeared once October closed. Every
    // quarter of the plan year that has closed since the budget was approved (counting the quarter just before the
    // approval) stays owed until a quarterly forecast as of that quarter end is saved.
    const quarterEnd = Number(close.slice(5)) % 3 === 0;
    const qFloor = (m: string) => `${m.slice(0, 4)}-${String(Math.floor(Number(m.slice(5)) / 3) * 3).padStart(2, '0')}`.replace(/-00$/, '');
    const approvedMonth = plan.budget.approved ? dateOf(plan.budget.approved.at).slice(0, 7) : null;
    const fromQ = approvedMonth ? (qFloor(approvedMonth).length === 4 ? `${Number(approvedMonth.slice(0, 4)) - 1}-12` : qFloor(approvedMonth)) : null;
    const done = new Set(plan.forecasts.filter((x) => (x.kind ?? 'quarterly') === 'quarterly').map((x) => x.asOf));
    const forecastsOwed =
      plan.budget.status === 'approved' && fromQ
        ? ['03', '06', '09', '12']
            .map((mm) => `${year}-${mm}`)
            .filter((q) => q <= close && q >= fromQ && !done.has(q))
            .map((q) => {
              const dueOn = `${addMonthsP(q, 1)}-${String(ctl.forecastByDay).padStart(2, '0')}`;
              return { asOf: q, dueOn, overdue: this.today() > dueOn };
            })
        : [];
    const forecastDue = forecastsOwed.some((x) => x.overdue);
    const yearlyDue = plan.budget.status === 'approved' && this.today().slice(0, 4) >= String(year) && !plan.forecasts.some((x) => x.kind === 'yearly');
    return {
      year,
      plan,
      months,
      toExplain,
      toAccept,
      forecastDue,
      forecastsOwed,
      yearlyDue,
      quarterEnd: quarterEnd && Number(close.slice(0, 4)) === year,
      latestForecast: latest?.asOf ?? null,
      latestKind: latest ? (latest.kind ?? 'quarterly') : null,
      ...finPlan3View(f, plan),
    };
  }

  // ---------- Read ----------

  /** Everything the controls show for one company the person can see. */
  async view(user: User, companyId: Id, billPeriod?: string) {
    const a = this.desk.actor(user);
    if (!(await this.desk.companies(user)).includes(companyId)) throw new NotFound('Company books');
    const f = await this.store.get('finStatus', `fin-${companyId}`);
    if (!f || (a.team != null && f.team !== a.team)) throw new NotFound('Company books');
    const ctl = await this.desk.settings();
    const close = this.desk.closePeriod();
    const today = this.today();
    const ageingDueOn = `${addMonthsP(close, 1)}-${String(ctl.ageingByDay).padStart(2, '0')}`;
    const age = (f.ageing ?? []).find((x) => x.period === close) ?? null;
    const statements = f.banks.map((b) => {
      const st = (f.statements ?? []).find((x) => x.bankId === b.id && x.period === close) ?? null;
      const payments = f.payments ?? [];
      const lines = (st?.lines ?? []).map((l) => {
        const m = l.match;
        const p = m && m.kind === 'payment' ? payments.find((x) => x.id === m.paymentId) : null;
        // Paid to the right person, after the fact: the payee's name should appear on the bank line.
        const first = p ? norm(p.payee.split(/\s+/)[0] ?? '') : '';
        // A5: for money out with no match, Prima suggests released payments from this account for the same amount, nearest
        // date first; a person accepts with one press.
        const suggest =
          !m && l.amount < 0
            ? payments
                .filter((x) => x.status === 'released' && !x.cleared && x.bankId === b.id && Math.abs(x.amount + l.amount) < 0.005)
                .map((x) => ({ paymentId: x.id, payee: x.payee, amount: x.amount, releasedOn: x.releasedOn, days: x.releasedOn ? Math.abs(daysBetween(x.releasedOn, l.date)) : 99 }))
                .sort((x, y) => x.days - y.days)
                .slice(0, 3)
            : [];
        return { ...l, payee: p?.payee ?? null, nameSeen: p ? first.length < 3 || norm(`${l.description} ${l.ref}`).includes(first) : null, suggest };
      });
      return {
        bank: { id: b.id, bank: b.bank, accountMasked: b.accountMasked },
        statement: st ? { id: st.id, period: st.period, opening: st.opening, closing: st.closing, loaded: st.loaded } : null,
        // Staff-eye review (2 Nov 2026): the opening is last month's closing, filled in for the person loading.
        prevClosing: (f.statements ?? []).find((x) => x.bankId === b.id && x.period === addMonthsP(close, -1))?.closing ?? null,
        lines,
        rec: (() => {
          const rec = (f.bankRecs ?? []).find((x) => x.bankId === b.id && x.period === close);
          if (!rec || !st) return null;
          const { ledger, ...head } = rec;
          return { ...head, ledger, result: finBankRecResult(st, rec, this.now()) };
        })(),
        unmatchedOut: lines.filter((l) => l.amount < 0 && !l.match).length,
      };
    });
    const uncleared = (f.payments ?? []).filter(
      (p) => p.status === 'released' && !p.cleared && p.releasedOn && (toMs(this.now()) - toMs(`${p.releasedOn}T00:00:00+08:00`)) / 86_400_000 >= ctl.unclearedDays,
    );
    const fyEnd = f.fyEnd;
    const [y] = today.split('-').map(Number);
    let lastFy = `${y}-${fyEnd}`;
    if (lastFy >= today) lastFy = `${y - 1}-${fyEnd}`;
    const circulateBy = lastDayOf(addMonthsP(lastFy.slice(0, 7), ctl.auditCirculateMonths));
    const payees = (f.payees ?? []).map((p) => ({
      ...p,
      held: (f.payments ?? []).filter((x) => x.payeeId === p.id && p.status !== 'verified' && ['prepared', 'reviewed', 'approved'].includes(x.status)).length,
    }));
    return {
      companyId,
      period: close,
      payees,
      statements,
      matchRules: f.matchRules ?? [],
      reminders: finArReminders(f, today),
      taxCalendar: finTaxCalendar(f, Number(today.slice(0, 4)), today, ctl).filter((x) => x.status !== 'upcoming' || daysBetween(today, x.dueOn) <= 62),
      uncleared: uncleared.map((p) => ({ id: p.id, payee: p.payee, amount: p.amount, releasedOn: p.releasedOn })),
      afterPayment: (f.payments ?? [])
        .filter((p) => p.status === 'released')
        .sort((a2, b) => (b.releasedOn ?? '').localeCompare(a2.releasedOn ?? ''))
        .slice(0, 50)
        .map((p) => ({ id: p.id, payee: p.payee, amount: p.amount, releasedOn: p.releasedOn, ...finAfterPayment(f, p, ctl) })),
      ageing: { record: age, dueOn: ageingDueOn, late: !age && today > ageingDueOn, arTotal: age ? ageTotal(age.ar) : null, apTotal: age ? ageTotal(age.ap) : null },
      ageingHistory: [...(f.ageing ?? [])].sort((a2, b) => b.period.localeCompare(a2.period)).slice(0, 12).map((x) => ({ period: x.period, ar: ageTotal(x.ar), over90: x.ar.over90, ap: ageTotal(x.ap), reviewed: !!x.reviewed })),
      sst: this.sstView(f, ctl),
      einvoice: this.einvoiceView(f, ctl),
      ar: this.arView(f),
      plan: this.planView(f, Number(close.slice(0, 4)), ctl),
      nextPlan: this.planView(f, Number(close.slice(0, 4)) + 1, ctl),
      /** Who the person is in Finance, for the Budget panel's revision and forecast buttons (the service still checks every action). */
      planRole: a.kind,
      settings: ctl,
      ...finRegularView(f, today, ctl),
      cash: await (async () => {
        const users = (await this.store.list('users')).filter((u) => !u.integration && !(u.accessClosedFrom && u.accessClosedFrom <= today) && u.role !== 'guard' && u.role !== 'site_device');
        // Who can hold a card, keep petty cash or be on a bank mandate: the company's own staff first, then PWVSB central staff
        // (who also act for the companies PWVSB manages).
        const own = (u: User) => u.companyIds.includes(companyId);
        const central = (u: User) => u.companyIds.length === 0 || u.companyIds.includes(GROUP_EMPLOYER_ID);
        const people = users
          .filter((u) => own(u) || central(u))
          .sort((x, y) => Number(own(y)) - Number(own(x)) || x.name.localeCompare(y.name))
          .map((u) => ({ id: u.id, name: u.name, title: own(u) || companyId === GROUP_EMPLOYER_ID ? u.title : `PWVSB: ${u.title}` }));
        return { ...finCashView(f, await this.cashCtx(user, a)), people };
      })(),
      hostel: await (async () => {
        const bills = await this.hostelBills(companyId);
        const unseen = new Set(finHostelUnseen(f, bills, ctl, today).map((b) => b.id));
        const found = new Set((f.statements ?? []).flatMap((x) => x.lines.flatMap((l) => (l.match?.kind === 'hostel' ? [l.match.hostelBillId] : []))));
        const hostels = bills.length ? await this.store.list('hostels', { companyId: [companyId] }) : [];
        const mayRecord = a.kind !== 'viewer' && a.kind !== 'coo';
        return bills
          .filter((b) => b.status !== 'paid' || daysBetween(finHostelPaidOn(b) ?? dateOf(b.createdAt), today) <= 92)
          .sort((x, y) => Number(y.status === 'coo_approved') - Number(x.status === 'coo_approved') || y.dueOn.localeCompare(x.dueOn))
          .slice(0, 40)
          .map((b) => ({
            id: b.id,
            hostelId: b.hostelId,
            hostel: hostels.find((h) => h.id === b.hostelId)?.name ?? b.hostelId,
            kind: b.kind,
            period: b.period,
            amount: b.amount,
            dueOn: b.dueOn,
            status: b.status,
            paidOn: finHostelPaidOn(b),
            paidBy: b.financePaid ? (`Finance: ${b.financePaid.bank}, ref ${b.financePaid.ref}` as string) : b.slip ? 'Company, slip on file' : null,
            onStatement: found.has(b.id),
            unseen: unseen.has(b.id),
            overdue: b.status !== 'paid' && b.dueOn < today,
            mayRecord: mayRecord && b.status === 'coo_approved',
          }));
      })(),
      moneyIn: await (async () => {
        const contracts = await this.contractsOf([companyId]);
        const clients = (await this.store.list('clientAccounts', { companyId: [companyId] })).filter((x) => x.companyId === companyId);
        const asked = typeof billPeriod === 'string' && /^\d{4}-\d{2}$/.test(billPeriod) && billPeriod <= close && billPeriod >= addMonthsP(close, -2) ? billPeriod : close;
        return { ...finMoneyInView(f, contracts, clients, asked, today, ctl), periods: [close, addMonthsP(close, -1), addMonthsP(close, -2)], stamp: finStampView(f, contracts, today) };
      })(),
      contractEnd: finContractEndView(f, await this.contractsOf([companyId]), today, ctl, await this.store.list('tenders', { companyId: [companyId] })),
      banking: finBankingView(f, close, today, ctl),
      yearEnd: finYearEndView(f, today, ctl),
      supplierStatements: finSupplierStatementsView(f, today, ctl),
      credit: finCreditView(f, (await this.store.list('clientAccounts', { companyId: [companyId] })).filter((x) => x.companyId === companyId), today, ctl),
      intercompany: await (async () => {
        const g = companyId === GROUP_EMPLOYER_ID ? f : await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
        const nameOf = await this.desk.companyNamer();
        const companies = [GROUP_EMPLOYER_ID, ...(await this.store.list('companies')).map((c) => c.id)].filter((id) => id !== companyId).map((id) => ({ id, name: nameOf(id) }));
        const periods = [close, addMonthsP(close, -1), addMonthsP(close, -2)];
        return { pairs: finIcView(g, companyId, periods, nameOf), companies, periods, explainMax: ctl.icExplainMax };
      })(),
      cash13: finCash13(f, await this.payRunsOf(companyId), today),
      ledger: await (async () => {
        const g = companyId === GROUP_EMPLOYER_ID ? f : await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
        const ic = g ? finIcPairs(g, close).filter((x) => x.a === companyId || x.b === companyId).map((x) => ({ status: x.status, diff: x.difference ?? 0 })) : null;
        return finLedgerView(f, close, ic, this.sqlConnectorOn, !!this.sqlReader);
      })(),
      dailyCash: await (async () => {
        const users = await this.store.list('users');
        return { lists: finDailyCashView(f, today), collectors: users.filter((u) => this.isCollector(u) && !u.accessClosedFrom).map((u) => ({ id: u.id, name: `${u.name} (${u.opsTier === 'ceo' ? 'CEO' : 'COO'})` })), rules: RULES.financeDailyCash.value };
      })(),
      audit: { lastFyEnd: lastFy, circulateBy, lodgeBy: addDays(circulateBy, ctl.ssmLodgeDays), formCBy: lastDayOf(addMonthsP(lastFy.slice(0, 7), 7)) },
    };
  }

  /** Home lines for people who act: payees to verify, ageing to review, SST returns near their due date, budgets to approve. */
  /** Finance staff's home items (each opening the right section and company of the Checks tab). */
  async home(user: User) {
    return (await this.homeData(user)).items;
  }

  /**
   * Staff-eye review (Fauzan, 2 Nov 2026: "make sure its not too complicated"): what waits for this person, per company
   * and per section of the Checks tab, so the company list shows where the work is and opens on it.
   */
  async checksTodo(user: User): Promise<Record<Id, Partial<Record<FinCheckSection, number>>>> {
    const per = (await this.homeData(user)).perCompany;
    const out: Record<Id, Partial<Record<FinCheckSection, number>>> = {};
    for (const [companyId, keys] of Object.entries(per))
      for (const [k, n] of Object.entries(keys)) {
        const sec = FIN_CHECK_SECTION_OF[k];
        if (!sec) continue;
        const o = (out[companyId] ??= {});
        o[sec] = (o[sec] ?? 0) + n;
      }
    return out;
  }

  private async homeData(user: User) {
    const a = this.desk.actor(user);
    const perCompany: Record<Id, Record<string, number>> = {};
    if (a.kind === 'viewer') return { items: [] as HomeItem[], perCompany };
    const ids = await this.desk.companies(user);
    const rows = (await this.store.list('finStatus', { companyId: ids })).filter((f) => a.team == null || f.team === a.team);
    const today = this.today();
    const st = await this.desk.settings();
    const [purs, sups] = ids.length ? await Promise.all([this.store.list('purRequests', { companyId: ids }), this.store.list('purSuppliers', { companyId: ids })]) : [[], []];
    let purToPay = 0;
    const allClients = ids.length ? await this.store.list('clientAccounts', { companyId: ids }) : [];
    const cr = { overridesToSee: 0, balanceStale: 0 };
    const ss = { toCheck: 0, toReview: 0 };
    let verify = 0;
    let ageReview = 0;
    let sstSoon = 0;
    let sstLate = 0;
    let budgets = 0;
    // Next year's budget (Fauzan, 2 Nov 2026: "10 december for next year"): from 1 November until it is submitted.
    let budgetNext = 0;
    const nextYear = Number(today.slice(0, 4)) + 1;
    const budgetDue = `${today.slice(0, 4)}-12-${String(st.budgetByDecDay).padStart(2, '0')}`;
    let einvReview = 0;
    let arApprove = 0;
    let writeOffs = 0;
    let arStale = 0;
    let arToReview = 0;
    let arUnpaid = 0;
    let einvLate = 0;
    let varOwn = 0;
    let varOwnLate = 0;
    let varLate = 0;
    let varAccept = 0;
    const bankFail: string[] = [];
    let receiptsWaiting = 0;
    const reg = { toCheck: 0, toPay: 0, dueSoon: 0, late: 0, noBill: 0, notSeen: 0, expiring: 0, gToCheck: 0, gExpiring: 0, gDue: 0, gClaim: 0, gWaiting: 0, collateral: 0, hostelUnseen: 0, hostelOverdue: 0 };
    const hostelOf = new Map<Id, HostelBill[]>();
    if (!jaOwns('hostels'))
      for (const b of await this.store.list('hostelBills', { companyId: rows.map((r) => r.companyId) })) hostelOf.set(b.companyId, [...(hostelOf.get(b.companyId) ?? []), b]);
    const tax = { due: [] as string[], late: [] as string[] };
    const cctx = await this.cashCtx(user, a);
    const cash = { mandateMissing: 0, mandateIssues: [] as string[], mandateToCheck: 0, advOverdue: 0, advToCheck: 0, pettyToCheck: 0, pettyCount: 0, pettyTopUp: 0, cardToCheck: 0, cardToReview: 0, cardLoad: 0 };
    const allContracts = await this.contractsOf(rows.map((r) => r.companyId));
    const stamp = { stampLate: 0, stampDue: 0, stampToCheck: 0, refundOpen: 0, refundLate: 0 };
    const dc = { toApprove: 0, toPrepare: 0, toTransfer: 0, toClose: 0, toSettle: 0, lateSettle: 0, differences: 0 };
    const c13 = { short: [] as string[], review: 0 };
    const icGroup = await this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
    let icOpen = 0;
    const ce = { endsOpen: 0, endsLate: 0, depositToCheck: 0, retentionUpdate: 0 };
    const bk = { fdDecide: 0, fdMatured: 0, fdToCheck: 0, chargesOver: 0 };
    const ye = { whtLate: 0, whtSoon: 0, whtToCheck: 0, toPost: 0, auditMine: 0, auditLate: 0 };
    const mi = { billMissing: 0, billToCheck: 0, govtOverdue: 0, govtOverdueAmount: 0, govtStale: 0, govtFollowToday: 0, unidentified: 0, unidentifiedLate: 0, allocToCheck: 0 };
    // Counters by name, to see which company each piece of work comes from.
    const counters = (): Record<string, number> => ({
      verify, ageReview, sstSoon, sstLate, budgets, einvReview, arApprove, writeOffs, arStale, arToReview, einvLate, varOwn, varLate, varAccept, receiptsWaiting, icOpen, purToPay, budgetNext,
      bankFail: bankFail.length,
      'tax.late': tax.late.length,
      'tax.due': tax.due.length,
      'c13.short': c13.short.length,
      'c13.review': c13.review,
      'cash.mandateIssues': cash.mandateIssues.length,
      ...Object.fromEntries(Object.entries({ reg, mi, stamp, dc, cash, ce, bk, ye, cr, ss }).flatMap(([p, o]) => Object.entries(o).flatMap(([k, v]) => (typeof v === 'number' ? [[`${p}.${k}`, v]] : []))) as [string, number][]),
    });
    for (const f of rows) {
      const before = counters();
      const m = finMoneyInHome(f, { userId: user.id, reviewer: this.reviewer(a) }, allContracts, this.desk.closePeriod(), today, st);
      for (const k of Object.keys(m) as (keyof typeof m)[]) mi[k] = round2(mi[k] + m[k]);
      if (a.team == null || f.team === a.team) {
        icOpen += finIcExceptions(icGroup, f.companyId, this.desk.closePeriod()).length;
        const fc = finCash13(f, await this.payRunsOf(f.companyId), today);
        if (fc.firstShort && (a.kind === 'ceo' || a.kind === 'director' || this.reviewer(a))) c13.short.push(`${f.companyId}: week of ${fc.firstShort.from}, RM${fc.firstShort.closing.toFixed(2)}`);
        if (fc.reviewDue && this.reviewer(a) && a.kind !== 'ceo' && a.kind !== 'director' && (f.payments ?? []).length) c13.review++;
      }
      const eh = finContractEndHome(f, allContracts, today, user.id, this.reviewer(a), st);
      for (const k of Object.keys(eh) as (keyof typeof eh)[]) ce[k] += eh[k];
      const bh = finBankingHome(f, this.desk.closePeriod(), today, user.id, this.reviewer(a), st);
      for (const k of Object.keys(bh) as (keyof typeof bh)[]) bk[k] += bh[k];
      if (a.kind !== 'coo') purToPay += finPurchasesToPay(f, purs, sups).length;
      const ssh = finSupplierStatementHome(f, today, user.id, this.reviewer(a), st);
      for (const k of Object.keys(ssh) as (keyof typeof ssh)[]) ss[k] += ssh[k];
      const crh = finCreditHome(f, allClients, today, this.reviewer(a), st);
      for (const k of Object.keys(crh) as (keyof typeof crh)[]) cr[k] += crh[k];
      const yh = finYearEndHome(f, this.desk.closePeriod(), today, user.id, this.reviewer(a));
      for (const k of Object.keys(yh) as (keyof typeof yh)[]) ye[k] += yh[k];
      const dh = finDailyCashHome(f, user, a, today);
      for (const k of Object.keys(dh) as (keyof typeof dh)[]) dc[k] += dh[k];
      const sd = finStampHome(f, user.id, this.reviewer(a), today);
      for (const k of Object.keys(sd) as (keyof typeof sd)[]) stamp[k] += sd[k];
      const ch = finCashHome(f, a, { ...cctx, userId: user.id });
      for (const k of Object.keys(ch) as (keyof typeof ch)[]) {
        if (k === 'mandateIssues') cash.mandateIssues.push(...ch.mandateIssues.map((x) => `${f.companyId}: ${x}`));
        else cash[k] += ch[k];
      }
      // Tax and statutory calendar (A10): deadlines within 14 days or past, not done.
      if (a.kind !== 'ceo')
        for (const x of finTaxCalendar(f, Number(today.slice(0, 4)), today, st))
          if ((x.status === 'due' || (x.status === 'late' && daysBetween(x.dueOn, today) <= 62)) && !['epf', 'perkeso', 'pcb', 'hrd', 'cp204'].includes(x.key.split(':')[0])) (x.status === 'late' ? tax.late : tax.due).push(`${x.what} (${x.dueOn})`);
      const c = finRegularHome(f, a, user.id, today, st);
      for (const k of Object.keys(c) as (keyof typeof c)[]) reg[k] += c[k];
      const hb = hostelOf.get(f.companyId) ?? [];
      reg.hostelUnseen += finHostelUnseen(f, hb, st, today).filter((b) => daysBetween(finHostelPaidOn(b)!, today) <= 62).length;
      reg.hostelOverdue += hb.filter((b) => b.status !== 'paid' && b.status !== 'returned' && b.dueOn < today).length;
      // Fauzan, 1 Nov 2026: "verify the correct payment made must be using system who automatically check and verify when
      // bank statements uploaded". Every release in the last two months is checked against the loaded statement; a failed
      // check goes to the leaders, the Finance Director and the CEO at once, not only at the close.
      if (a.kind !== 'data_entry')
        for (const p of f.payments ?? [])
          if (p.status === 'released' && p.releasedOn && daysBetween(p.releasedOn, today) <= 62 && finAfterPayment(f, p, st).status === 'fail') bankFail.push(`${p.id} (${p.payee})`);
      for (const c of f.arCases ?? []) for (const r of c.receipts ?? []) if (!r.matched && daysBetween(r.on, today) >= st.unclearedDays) receiptsWaiting += 1;
      // Variances (Fauzan, 1 Nov 2026): the team leader owns them by the due day; the FD and the CEO see late ones and
      // accept explanations.
      for (const plan of f.plans ?? []) {
        if (plan.budget.status !== 'approved') continue;
        const pv = this.planView(f, plan.year, st);
        if (a.kind === 'leader' && f.team === a.team) {
          varOwn += pv.toExplain.length;
          varOwnLate += pv.toExplain.filter((x) => x.overdue).length;
        }
        if (isLead(a)) {
          varLate += pv.toExplain.filter((x) => x.overdue).length;
          varAccept += pv.toAccept.filter((x) => x.byId !== user.id).length;
        }
      }
      // Overdue invoices: the Finance Director is told every month and checks the team followed up (Fauzan, 1 Nov 2026).
      if (a.kind === 'director' || a.kind === 'leader') {
        const rule = RULES.financeReceivables.value;
        const over = (f.arCases ?? []).filter((c) => finArActive(c) && daysBetween(c.invoiceDate, today) >= rule.caseFromDays);
        arStale += over.filter((c) => finArStale(c, this.now())).length;
        if (a.kind === 'director' && over.length && !(f.arReviews ?? []).some((x) => x.month === today.slice(0, 7))) {
          arToReview += 1;
          arUnpaid += over.reduce((n, c) => n + c.outstanding, 0);
        }
      }
      for (const c of f.arCases ?? []) {
        const by = c.status === 'reissue_pending' ? c.reissue?.requested.byId : c.status === 'provision_pending' ? c.provision?.requested.byId : c.writeOff?.requested.byId;
        if (by === user.id) continue;
        if (c.status === 'writeoff_pending' && isLead(a)) writeOffs += 1;
        else if ((c.status === 'reissue_pending' || c.status === 'provision_pending') && a.kind === 'director') arApprove += 1;
      }
      const ev = this.einvoiceView(f, st);
      if (ev.late) einvLate += 1;
      if (this.reviewer(a)) einvReview += (f.einvoice?.months ?? []).filter((x) => !x.reviewed && x.prepared.byId !== user.id).length;
      if (this.reviewer(a)) verify += (f.payees ?? []).filter((p) => p.status === 'pending' && p.entered.byId !== user.id).length;
      if (a.kind === 'leader' || a.kind === 'deputy') ageReview += (f.ageing ?? []).filter((x) => !x.reviewed && x.prepared.byId !== user.id).length;
      const sv = this.sstView(f, st);
      for (const r of sv?.returns ?? []) {
        if (!r.problems.length) continue;
        if (today > r.dueOn) sstLate += 1;
        else if (daysBetween(today, r.dueOn) <= 14) sstSoon += 1;
      }
      if (today.slice(5) >= '11-01' && a.kind !== 'ceo' && a.kind !== 'coo' && !(f.plans ?? []).some((p) => p.year === nextYear && ['submitted', 'approved'].includes(p.budget.status))) budgetNext += 1;
      if (isLead(a))
        budgets += (f.plans ?? []).filter(
          (p) => p.budget.status === 'submitted' && p.budget.prepared?.byId !== user.id && p.budget.submitted?.byId !== user.id && !(p.budget.authorIds ?? []).includes(user.id),
        ).length;
      const after = counters();
      for (const k of Object.keys(after)) if (after[k] > (before[k] ?? 0)) (perCompany[f.companyId] ??= {})[k] = after[k] - (before[k] ?? 0);
    }
    const items: HomeItem[] = [];
    // Each item opens the Checks tab on its section, at the company with the most of that work.
    const go = (...keys: string[]): HomeLink => {
      let best: Id | undefined;
      let most = 0;
      for (const [cid, ks] of Object.entries(perCompany)) {
        const n = keys.reduce((t, k) => t + (ks[k] ?? 0), 0);
        if (n > most) [best, most] = [cid, n];
      }
      return { view: 'finance', tab: 'checks', section: FIN_CHECK_SECTION_OF[keys[0]], ...(best ? { companyId: best } : {}) };
    };
    if (sstLate && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${sstLate} SST return(s) past the due date`, detail: 'Late payment adds 10%, then 15% and 15% more', go: go('sstLate') });
    if (sstSoon && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${sstSoon} SST return(s) due within 14 days`, detail: 'Prepare, review, file in MySST and pay Customs', go: go('sstSoon') });
    if (verify && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${verify} payee bank detail(s) to verify by call-back`, detail: 'Payments to them are held until verified', go: go('verify') });
    if (arStale) items.push({ tone: 'crit', tag: 'Finance', title: `${arStale} invoice(s) over 90 days with no follow-up this month`, detail: 'Every overdue invoice is chased at least monthly (government sites included)', go: go('arStale') });
    if (arToReview)
      items.push({ tone: 'warn', tag: 'Finance', title: `Review overdue invoices for ${arToReview} company(ies) this month`, detail: `RM${arUnpaid.toLocaleString('en-MY', { maximumFractionDigits: 0 })} unpaid over 90 days; check the follow-ups and sign off`, go: go('arToReview') });
    if (writeOffs) items.push({ tone: 'warn', tag: 'Finance', title: `${writeOffs} bad debt write-off(s) waiting for your approval`, detail: 'Check the recovery evidence; approve with a comment, or return', go: go('writeOffs') });
    if (arApprove) items.push({ tone: 'warn', tag: 'Finance', title: `${arApprove} invoice re-issue(s) or provision(s) to approve`, detail: 'Credit note and new invoice, or doubtful debt', go: go('arApprove') });
    if (einvLate && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${einvLate} company(ies) with no e-Invoice check for last month`, detail: 'Count from SQL Account MyInvois Transaction', go: go('einvLate') });
    if (einvReview && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${einvReview} e-Invoice check(s) to review`, detail: 'Every sales document validated by LHDN', go: go('einvReview') });
    if (ageReview) items.push({ tone: 'warn', tag: 'Finance', title: `${ageReview} monthly ageing(s) to review`, detail: 'Agree to the ledger', go: go('ageReview') });
    if (varOwn) items.push({ tone: varOwnLate ? 'crit' : 'warn', tag: 'Finance', title: `${varOwn} budget variance(s) to explain${varOwnLate ? `, ${varOwnLate} past the due day` : ''}`, detail: `You own them; explain by day ${st.varianceByDay} of the month after`, go: go('varOwn') });
    if (varLate) items.push({ tone: 'crit', tag: 'Finance', title: `${varLate} budget variance(s) not explained by the due day`, detail: 'The team leader owns each one', go: go('varLate') });
    if (varAccept) items.push({ tone: 'warn', tag: 'Finance', title: `${varAccept} variance explanation(s) to accept`, detail: 'Accept with a comment, or ask the team to explain again', go: go('varAccept') });
    if (budgetNext)
      items.push({
        tone: today > budgetDue ? 'crit' : 'warn',
        tag: 'Finance',
        title: `${budgetNext} compan${budgetNext === 1 ? 'y' : 'ies'} without a ${nextYear} budget submitted`,
        detail: `Due by ${budgetDue}; the FD or the CEO approves it`,
        go: go('budgetNext'),
      });
    if (budgets) items.push({ tone: 'warn', tag: 'Finance', title: `${budgets} budget(s) waiting for your approval`, detail: 'Approve with a comment, or return', go: go('budgets') });
    if (bankFail.length)
      items.push({ tone: 'crit', tag: 'Finance', title: `${bankFail.length} payment(s) failed the automatic check against the bank statement`, detail: bankFail.slice(0, 4).join(', ') + (bankFail.length > 4 ? ` and ${bankFail.length - 4} more` : ''), go: go('bankFail') });
    // Regular payments and guarantees (Fauzan, 2 Nov 2026).
    if (reg.notSeen && a.kind !== 'data_entry')
      items.push({ tone: 'crit', tag: 'Finance', title: `${reg.notSeen} direct debit(s) not on the bank statement`, detail: 'Hire purchase, loan or bill: bounced, changed or stopped? Call the bank or financier', go: go('reg.notSeen') });
    if (reg.late && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${reg.late} regular payment(s) past the due date`, detail: 'Instalments, bills, EPF/SOCSO/PCB, zakat: late charges and penalties run', go: go('reg.late') });
    const few = (xs: string[]) => xs.slice(0, 3).join('; ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');
    if (tax.late.length) items.push({ tone: 'crit', tag: 'Finance', title: `${tax.late.length} tax or statutory deadline(s) passed without a filing recorded`, detail: few(tax.late), go: go('tax.late') });
    if (tax.due.length) items.push({ tone: 'warn', tag: 'Finance', title: `${tax.due.length} tax or statutory deadline(s) in the next 14 days`, detail: few(tax.due), go: go('tax.due') });
    if (reg.dueSoon && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${reg.dueSoon} regular payment(s) due today or tomorrow, not prepared yet`, detail: 'Press "Prepare all due": Prima fills them in for review', go: go('reg.dueSoon') });
    if (reg.toPay && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${reg.toPay} regular payment(s) due within 7 days to prepare`, detail: 'Press "Prepare all due" on the regular payments list: Prima fills in the payee, amount, account and document for review', go: go('reg.toPay') });
    if (reg.noBill && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${reg.noBill} bill(s) or contribution file(s) not recorded`, detail: 'Record the amount with the document; the payment must equal it', go: go('reg.noBill') });
    if (reg.toCheck || reg.gToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${reg.toCheck + reg.gToCheck} regular payment(s) or guarantee(s) to check`, detail: 'Check against the agreement, bill or letter; nobody checks their own entry', go: go('reg.toCheck', 'reg.gToCheck') });
    if (reg.expiring && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${reg.expiring} insurance polic(ies) ending within 60 days`, detail: 'Renew before cover lapses', go: go('reg.expiring') });
    // F13 (Fauzan, 11 Nov 2026): every IG and BG is followed until settled, with a reminder 30 days before it is due.
    if (reg.gDue) items.push({ tone: 'crit', tag: 'Finance', title: `${reg.gDue} IG/BG due within ${st.guaranteeRemindDays} days`, detail: 'Settle it: extend it, get the release letter or claim back the collateral', go: go('reg.gDue') });
    else if (reg.gExpiring) items.push({ tone: 'warn', tag: 'Finance', title: `${reg.gExpiring} IG/BG expiring within 60 days`, detail: 'Extend it, or get the client’s release letter', go: go('reg.gExpiring') });
    if (reg.gClaim) items.push({ tone: 'crit', tag: 'Finance', title: `${reg.gClaim} IG/BG released or expired: claim back the cash collateral`, detail: 'Send the claim to the insurer or bank with the release letter', go: go('reg.gClaim') });
    if (reg.gWaiting) items.push({ tone: 'warn', tag: 'Finance', title: `${reg.gWaiting} collateral claim(s) with no refund after 30 days`, detail: 'Follow up the insurer or bank', go: go('reg.gWaiting') });
    if (reg.hostelUnseen && a.kind !== 'data_entry')
      items.push({ tone: 'crit', tag: 'Finance', title: `${reg.hostelUnseen} hostel bill(s) marked paid but not on the company's bank statement`, detail: 'The company uploaded a slip; the money is not seen leaving its account', go: go('reg.hostelUnseen') });
    if (reg.hostelOverdue && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${reg.hostelOverdue} hostel bill(s) past the due date and not paid`, detail: 'Paid by the company through FWM; Finance monitors', go: go('reg.hostelOverdue') });
    if (receiptsWaiting && a.kind !== 'ceo')
      items.push({ tone: 'warn', tag: 'Finance', title: `${receiptsWaiting} customer receipt(s) not found on the bank statement after ${st.unclearedDays} days`, detail: 'The invoice stays unpaid until the money is seen in the bank', go: go('receiptsWaiting') });
    // Money in (Fauzan, 2 Nov 2026): contracts not billed, government claims, unidentified money in.
    if (mi.billMissing && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${mi.billMissing} contract(s) with no invoice recorded for ${this.desk.closePeriod()}`, detail: 'Record the SQL Account invoice number, or why there is none', go: go('mi.billMissing') });
    if (mi.billToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${mi.billToCheck} "no invoice" reason(s) to check`, detail: 'A month a contract was not billed; nobody checks their own', go: go('mi.billToCheck') });
    if (mi.govtStale) items.push({ tone: 'crit', tag: 'Finance', title: `${mi.govtStale} government claim(s) overdue and not followed up`, detail: 'Call the agency and record what they said', go: go('mi.govtStale') });
    else if (mi.govtOverdue && isLead(a)) items.push({ tone: 'warn', tag: 'Finance', title: `${mi.govtOverdue} government claim(s) past the expected payment date`, detail: `RM${mi.govtOverdueAmount.toLocaleString('en-MY', { minimumFractionDigits: 2 })} waiting; followed up`, go: go('mi.govtOverdue') });
    if (mi.govtFollowToday && !mi.govtStale && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${mi.govtFollowToday} government claim(s) to follow up today`, detail: 'Record who you spoke to and the next date', go: go('mi.govtFollowToday', 'mi.govtStale') });
    if (mi.unidentifiedLate) items.push({ tone: 'crit', tag: 'Finance', title: `${mi.unidentifiedLate} money-in line(s) unidentified for more than ${st.unidentifiedDays} days`, detail: 'Find the payer and allocate it to the invoice', go: go('mi.unidentifiedLate') });
    else if (mi.unidentified && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${mi.unidentified} money-in line(s) to identify`, detail: `Allocate within ${st.unidentifiedDays} days of the bank date`, go: go('mi.unidentified') });
    if (stamp.stampLate && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${stamp.stampLate} agreement(s) past the 30-day stamping limit`, detail: 'Stamp in STAMPS now; late penalties grow', go: go('stamp.stampLate') });
    if (stamp.stampDue && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${stamp.stampDue} agreement(s) to stamp within 7 days`, detail: 'Stamp in STAMPS and record the certificate', go: go('stamp.stampDue') });
    if (stamp.stampToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${stamp.stampToCheck} stamp certificate(s) to check`, detail: 'Against the STAMPS certificate; nobody checks their own', go: go('stamp.stampToCheck') });
    if (stamp.refundLate) items.push({ tone: 'crit', tag: 'Finance', title: `${stamp.refundLate} stamp duty refund(s) late`, detail: 'Cancelled agreements: submit the refund, chase LHDN or the money', go: go('stamp.refundLate') });
    else if (stamp.refundOpen && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${stamp.refundOpen} stamp duty refund(s) to submit`, detail: 'Cancelled agreements: prepare the documents; someone else submits', go: go('stamp.refundOpen') });
    // Contract ends and money held by clients (suggestions 3 and 24, A11).
    if (ce.endsLate && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${ce.endsLate} ended contract(s) with follow-ups past their date`, detail: 'Final invoice, deposit or retention, IG/BG collateral, stamp duty refund', go: go('ce.endsLate') });
    else if (ce.endsOpen && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${ce.endsOpen} ended contract(s) with follow-ups open`, detail: 'Prima listed what to do: final invoice, money held by the client, guarantees', go: go('ce.endsOpen') });
    // F8 (Fauzan, 11 Nov 2026): retention on tenders and contracts, a status update every 2 months until it is back.
    if (ce.retentionUpdate && a.kind !== 'ceo')
      items.push({ tone: 'warn', tag: 'Finance', title: `${ce.retentionUpdate} retention status update(s) due`, detail: `Ask the client where the retention stands and record it; every ${st.retentionUpdateMonths} months until it is back`, go: go('ce.retentionUpdate') });
    if (ce.depositToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${ce.depositToCheck} client deposit(s) or retention to check`, detail: 'Against the contract or the receipt; nobody checks their own', go: go('ce.depositToCheck') });
    // Fixed deposits and bank charges (suggestions 15 and 16).
    if (bk.fdMatured && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${bk.fdMatured} fixed deposit(s) matured with no decision`, detail: 'Renew it or uplift it; the bank may renew at its own rate', go: go('bk.fdMatured') });
    if (bk.fdDecide && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${bk.fdDecide} fixed deposit(s) maturing within ${st.fdMaturityAlertDays} days`, detail: 'Decide: renew (with the new rate) or uplift', go: go('bk.fdDecide') });
    if (bk.fdToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${bk.fdToCheck} fixed deposit(s) to check`, detail: "Against the bank's placement confirmation; nobody checks their own", go: go('bk.fdToCheck') });
    if (bk.chargesOver) items.push({ tone: 'warn', tag: 'Finance', title: `${bk.chargesOver} account(s) charged more than the bank agreed`, detail: 'Ask the bank for a refund, or explain why the charges are right', go: go('bk.chargesOver') });
    if (purToPay && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${purToPay} purchase(s) matched and posted, ready to pay`, detail: 'Order, goods received and invoice agree in Procurement; New payment fills it from the purchase', go: { view: 'finance', tab: 'payments' } });
    if (ss.toCheck && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${ss.toCheck} big supplier statement(s) to agree for last quarter`, detail: "Compare the supplier's statement with SQL Account; explain any difference", go: go('ss.toCheck') });
    if (ss.toReview) items.push({ tone: 'warn', tag: 'Finance', title: `${ss.toReview} supplier statement check(s) to review`, detail: 'Nobody reviews their own', go: go('ss.toReview') });
    if (cr.overridesToSee) items.push({ tone: 'warn', tag: 'Finance', title: `${cr.overridesToSee} post(s) added for clients Finance warned about`, detail: 'Over the credit limit or unpaid over 90 days; Operations gave a reason. Say what Finance does', go: go('cr.overridesToSee') });
    if (cr.balanceStale && a.kind !== 'ceo') items.push({ tone: 'info', tag: 'Finance', title: `${cr.balanceStale} client balance(s) to refresh for the credit limit`, detail: "From SQL Account's customer statement: owed now and the oldest unpaid invoice", go: go('cr.balanceStale') });
    if (ye.whtLate) items.push({ tone: 'crit', tag: 'Finance', title: `${ye.whtLate} withholding tax payment(s) to LHDN late`, detail: 'Pay it now with the 10% penalty; Prima works out the amount', go: go('ye.whtLate') });
    if (ye.whtSoon && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${ye.whtSoon} withholding tax payment(s) due to LHDN within 7 days`, detail: 'One month after paying the non-resident', go: go('ye.whtSoon') });
    if (ye.whtToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${ye.whtToCheck} withholding tax payment(s) to check`, detail: "Against LHDN's receipt and the rate; nobody checks their own", go: go('ye.whtToCheck') });
    if (ye.toPost && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${ye.toPost} prepayment or accrual month(s) to post`, detail: 'Post the journal in SQL Account and record its number', go: go('ye.toPost') });
    if (ye.auditMine) items.push({ tone: 'warn', tag: 'Finance', title: `${ye.auditMine} auditor request(s) for you to send`, detail: 'Send it to the auditor and record what was sent', go: go('ye.auditMine') });
    if (ye.auditLate && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${ye.auditLate} auditor request(s) past their due day`, detail: 'Chase the owner; the audit waits on them', go: go('ye.auditLate') });
    // Intercompany and the 13-week cash forecast (Fauzan, 2 Nov 2026).
    if (icOpen && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${icOpen} intercompany balance(s) not agreed for ${this.desk.closePeriod()}`, detail: 'Record your side, or correct it; both sides must come to RM0.00', go: go('icOpen') });
    if (c13.short.length) items.push({ tone: 'crit', tag: 'Finance', title: `${c13.short.length} company(ies) short of cash within 13 weeks`, detail: few(c13.short), go: go('c13.short') });
    if (c13.review) items.push({ tone: 'info', tag: 'Finance', title: `${c13.review} 13-week cash forecast(s) to review this week`, detail: 'Look over the weeks ahead and add what Prima cannot know', go: go('c13.review') });
    // Daily cash pay (Fauzan, 2 Nov 2026).
    if (dc.toApprove) items.push({ tone: 'crit', tag: 'Finance', title: `${dc.toApprove} daily cash list(s) to approve`, detail: 'Only the Finance Director approves; cash is prepared after', go: go('dc.toApprove') });
    if (dc.toPrepare && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${dc.toPrepare} approved daily cash list(s): prepare the cash`, detail: 'Withdraw only the pay of the people given cash and hand it to the COO or CEO', go: go('dc.toPrepare') });
    // Bank or e-wallet only (Fauzan, 6 Nov 2026).
    if (dc.toTransfer && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${dc.toTransfer} daily cash list(s) with days to pay by transfer`, detail: 'Pay each worked day to the bank account or e-wallet and record the reference', go: go('dc.toTransfer') });
    if (dc.toClose && a.kind !== 'ceo') items.push({ tone: 'info', tag: 'Finance', title: `${dc.toClose} daily cash list(s) ended: close them`, detail: 'Paid by transfer only; no cash to count', go: go('dc.toClose') });
    if (dc.toSettle && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${dc.toSettle} daily cash list(s) to settle`, detail: 'Count the unpaid cash given back and bank it', go: go('dc.toSettle') });
    if (dc.lateSettle) items.push({ tone: 'crit', tag: 'Finance', title: `${dc.lateSettle} daily cash list(s) not settled in time`, detail: 'Cash still out after the list ended', go: go('dc.lateSettle') });
    if (dc.differences) items.push({ tone: 'crit', tag: 'Finance', title: `${dc.differences} daily cash difference(s) to accept`, detail: 'Cash withdrawn not matched by payments and cash given back', go: go('dc.differences') });
    if (mi.allocToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${mi.allocToCheck} money-in allocation(s) to check`, detail: 'Against the remittance or the payer; nobody checks their own', go: go('mi.allocToCheck') });
    // Bank mandates, advances, petty cash and cards (Fauzan, 2 Nov 2026).
    if (cash.mandateIssues.length && a.kind !== 'data_entry') items.push({ tone: 'crit', tag: 'Finance', title: `${cash.mandateIssues.length} bank mandate(s) to update or confirm with the bank`, detail: few(cash.mandateIssues), go: go('cash.mandateIssues') });
    if (cash.mandateToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${cash.mandateToCheck} bank mandate(s) to check`, detail: 'Against the bank’s confirmation and the board resolution', go: go('cash.mandateToCheck') });
    if (cash.mandateMissing && isLead(a)) items.push({ tone: 'info', tag: 'Finance', title: `${cash.mandateMissing} bank account(s) with no mandate recorded`, detail: 'Record who signs and approves in the bank portal, so releases are checked against it', go: go('cash.mandateMissing') });
    if (cash.advOverdue && a.kind !== 'ceo') items.push({ tone: 'crit', tag: 'Finance', title: `${cash.advOverdue} staff advance(s) past the settle-by date`, detail: 'Chase the receipts, or recover through payroll; no new advance to them meanwhile', go: go('cash.advOverdue') });
    if (cash.advToCheck && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${cash.advToCheck} advance settlement(s) to check`, detail: 'Receipts against the amounts, and any cash paid back seen in the bank', go: go('cash.advToCheck') });
    if (cash.pettyToCheck || cash.cardToCheck) items.push({ tone: 'warn', tag: 'Finance', title: `${cash.pettyToCheck + cash.cardToCheck} petty cash float(s) or card(s) to check`, detail: 'Nobody checks their own entry', go: go('cash.pettyToCheck', 'cash.cardToCheck') });
    if (cash.pettyCount && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${cash.pettyCount} petty cash count(s) due`, detail: 'Count the cash with the custodian; someone other than the custodian records it', go: go('cash.pettyCount') });
    if (cash.pettyTopUp && a.kind !== 'ceo') items.push({ tone: 'info', tag: 'Finance', title: `${cash.pettyTopUp} petty cash float(s) half spent`, detail: 'Prepare the top-up: Prima fills it in from the vouchers', go: go('cash.pettyTopUp') });
    if (cash.cardLoad && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${cash.cardLoad} card statement(s) for last month not loaded`, detail: 'Load them so the holders can explain each line', go: go('cash.cardLoad') });
    if (cash.cardToReview && a.kind !== 'ceo') items.push({ tone: 'warn', tag: 'Finance', title: `${cash.cardToReview} card statement(s) explained and waiting for review`, detail: 'Receipts against the lines; personal use paid back', go: go('cash.cardToReview') });
    return { items, perCompany };
  }
}

function sum(a?: number[]): number {
  return round2((a ?? []).reduce((n, x) => n + x, 0));
}

export type { FinPlanLine };