import { AccessDenied } from "./access";
import type { FinActor } from "./finance";
import { isLead } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import type { FinCashCtx } from "./finance-cash";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { FinSign } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";


type Out<T> = { patch: Partial<FinStatus>; action: string; summary: string; result: T };
const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = (n: number) => Math.abs(n) < 0.005;
const rmf = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A signed amount in RM (balances, results and movements may be negative). */
function amount(v: unknown, what: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/,/g, '')) : Number.NaN;
  if (!Number.isFinite(n) || Math.abs(n) > 100_000_000_000) throw new BadRequest(`${what}: give an amount in RM (a minus sign for a negative).`);
  return r2(n);
}
const opt = (v: unknown, what: string) => (v === undefined || v === null || v === '' ? null : amount(v, what));
const period = (v: unknown): string => {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new BadRequest('Month (YYYY-MM).');
  return v;
};
const staff = (a: FinActor | null) => {
  if (!a || a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance staff)');
};

// ---------- 76. Statement agreement (FS-01 to FS-12) ----------

export const FIN_FS_LABELS: Record<string, string> = {
  'FS-01': 'Trial balance balances',
  'FS-02': 'Balance sheet balances',
  'FS-03': 'Profit or loss agrees with the retained earnings movement',
  'FS-04': 'Cash-flow statement rolls from opening to closing cash',
  'FS-05': 'Cash-flow closing cash agrees with the balance sheet',
  'FS-06': 'Bank in the books agrees with the reconciliations',
  'FS-07': 'Customer ledger agrees with the general ledger',
  'FS-08': 'Supplier ledger agrees with the general ledger',
  'FS-09': 'Fixed asset register agrees with the ledger',
  'FS-10': 'Stock agrees with the ledger',
  'FS-11': 'Intercompany balances agreed on both sides',
  'FS-12': 'Tax, payroll deductions, SST, loans, deposits and provisions agree with their schedules',
};
/** The tests this module works out from recorded figures (FS-06 to FS-08 come from the bank reconciliations and ageing). */
export const FIN_FS_FROM_FIGURES = ['FS-01', 'FS-02', 'FS-03', 'FS-04', 'FS-05', 'FS-09', 'FS-10', 'FS-12'];
/** Tests the close needs a result for (run, or not applicable with a reason); missing ones are close exceptions. */
export const FIN_FS_REQUIRED = ['FS-03', 'FS-04', 'FS-05', 'FS-09', 'FS-10', 'FS-11', 'FS-12'];

export type FinScheduleKind = 'income_tax' | 'payroll_deductions' | 'sst' | 'loans' | 'deposits' | 'provisions';
export const FIN_SCHEDULE_KINDS: FinScheduleKind[] = ['income_tax', 'payroll_deductions', 'sst', 'loans', 'deposits', 'provisions'];

export interface FinLedgerFigures {
  period: string;
  /** 'typed' from the SQL Account reports; 'connector' from a read-only connector read (item 71). */
  origin: 'typed' | 'connector';
  /** The sync record of the connector read, when origin is connector. */
  syncId: string | null;
  /** The SQL Account reports filed (file names or SharePoint links). */
  source: string;
  tb: { debit: number; credit: number };
  bs: { assets: number; liabilities: number; equity: number };
  /** FS-03: retained earnings at the start and end of the month, the month's result, dividends and other approved movements. */
  pl: { result: number; reOpening: number; reClosing: number; dividends: number; otherMovements: number; otherNote: string };
  /** FS-04/FS-05: the historical cash-flow statement and the balance sheet's cash. */
  cf: {
    opening: number;
    operating: number;
    investing: number;
    financing: number;
    fx: number;
    closing: number;
    bsCash: number;
    adjustment: number;
    adjustmentNote: string;
  };
  /** FS-09: the SQL Account asset register against the ledger; null with a reason when the company holds no fixed assets. */
  fa: { regCost: number; regAccDep: number; glCost: number; glAccDep: number } | null;
  faNa: string | null;
  /** FS-10: stock valuation against the ledger's inventory accounts; null with a reason when the company keeps no stock. */
  stock: { value: number; gl: number } | null;
  stockNa: string | null;
  /** FS-12: each schedule (tax, payroll deductions, SST, loans, deposits, provisions) against its ledger balance. */
  schedules: { kind: FinScheduleKind; gl: number; schedule: number; doc: string }[];
  note: string;
  prepared: FinSign;
  reviewed: FinSign | null;
}

export interface FinFsResult {
  id: string;
  label: string;
  /** The difference in RM; null when not run. */
  diff: number | null;
  /** Not applicable, with the reason (for example no stock). */
  na: string | null;
  detail: string;
  from: 'figures' | 'reconciliation' | 'intercompany' | 'reported' | 'none';
}

/** Works out the tests from a month's figures. A figure set that is not reviewed is shown but not used by the close. */
export function finFsFromFigures(x: FinLedgerFigures): FinFsResult[] {
  const out: FinFsResult[] = [];
  const add = (id: string, diff: number | null, detail: string, na: string | null = null) =>
    out.push({ id, label: FIN_FS_LABELS[id], diff: diff == null ? null : r2(diff), na, detail, from: 'figures' });
  add('FS-01', x.tb.debit - x.tb.credit, `Debits ${rmf(x.tb.debit)} less credits ${rmf(x.tb.credit)}`);
  add(
    'FS-02',
    x.bs.assets - x.bs.liabilities - x.bs.equity,
    `Assets ${rmf(x.bs.assets)} less liabilities ${rmf(x.bs.liabilities)} less equity ${rmf(x.bs.equity)}`,
  );
  const reMove = x.pl.reClosing - x.pl.reOpening;
  add(
    'FS-03',
    reMove - (x.pl.result - x.pl.dividends + x.pl.otherMovements),
    `Retained earnings moved ${rmf(r2(reMove))}; result ${rmf(x.pl.result)} less dividends ${rmf(x.pl.dividends)} plus other movements ${rmf(x.pl.otherMovements)}`,
  );
  const roll = x.cf.opening + x.cf.operating + x.cf.investing + x.cf.financing + x.cf.fx;
  add('FS-04', roll - x.cf.closing, `Opening plus operating, investing, financing and FX ${rmf(r2(roll))} against closing ${rmf(x.cf.closing)}`);
  add(
    'FS-05',
    x.cf.closing - (x.cf.bsCash + x.cf.adjustment),
    `Cash-flow closing ${rmf(x.cf.closing)} against balance sheet cash ${rmf(x.cf.bsCash)}${x.cf.adjustment ? ` with ${rmf(x.cf.adjustment)} (${x.cf.adjustmentNote})` : ''}`,
  );
  if (x.fa) {
    const c = x.fa.regCost - x.fa.glCost;
    const d = x.fa.regAccDep - x.fa.glAccDep;
    add('FS-09', zero(c) ? d : c, `Cost: register less ledger ${rmf(r2(c))}; accumulated depreciation: register less ledger ${rmf(r2(d))}`);
    if (!zero(c) && !zero(d)) out[out.length - 1].diff = r2(Math.abs(c) + Math.abs(d));
  } else add('FS-09', null, 'Not applicable', x.faNa);
  if (x.stock) add('FS-10', x.stock.value - x.stock.gl, `Stock valuation ${rmf(x.stock.value)} against inventory in the ledger ${rmf(x.stock.gl)}`);
  else add('FS-10', null, 'Not applicable', x.stockNa);
  const off = x.schedules.filter((s) => !zero(s.gl - s.schedule));
  add(
    'FS-12',
    x.schedules.length ? r2(off.reduce((n, s) => n + Math.abs(s.gl - s.schedule), 0)) : null,
    x.schedules.length
      ? off.length
        ? off.map((s) => `${s.kind.replace('_', ' ')}: ledger ${rmf(s.gl)}, schedule ${rmf(s.schedule)}`).join('; ')
        : `${x.schedules.length} schedule(s) agree`
      : 'No schedules recorded',
  );
  return out;
}

/**
 * The tests the close uses for a month: the reviewed figures where recorded (they take the place of earlier reported
 * results), FS-11 from Prima's own intercompany pairs, and otherwise what was reported from SQL Account.
 */
export function finFsTests(
  f: Pick<FinStatus, 'tests' | 'ledgerFigures'>,
  periodAsked: string,
  ic: { status: string; diff: number }[] | null = null,
): FinFsResult[] {
  const fig = (f.ledgerFigures ?? []).find((x) => x.period === periodAsked && x.reviewed);
  const computed = fig ? finFsFromFigures(fig) : [];
  const out = new Map<string, FinFsResult>();
  for (const t of f.tests) out.set(t.id, { id: t.id, label: t.label, diff: t.diff, na: null, detail: 'Reported from SQL Account', from: 'reported' });
  for (const t of computed) out.set(t.id, t);
  if (ic && !computed.some((t) => t.id === 'FS-11')) {
    const open = ic.filter((p) => p.status === 'missing' || p.status === 'differs');
    out.set('FS-11', {
      id: 'FS-11',
      label: FIN_FS_LABELS['FS-11'],
      diff: r2(open.reduce((n, p) => n + Math.abs(p.diff), 0)),
      na: null,
      detail: ic.length
        ? `${ic.length - open.length} of ${ic.length} intercompany balance(s) agreed or explained`
        : 'No intercompany balances recorded for the month',
      from: 'intercompany',
    });
  }
  return Object.keys(FIN_FS_LABELS)
    .map((id) => out.get(id) ?? { id, label: FIN_FS_LABELS[id], diff: null, na: null, detail: 'Not run', from: 'none' as const })
    .filter((t) => t.from !== 'none' || FIN_FS_REQUIRED.includes(t.id) || ['FS-01', 'FS-02', 'FS-06'].includes(t.id));
}

function figuresFromInput(input: Record<string, unknown>): Omit<FinLedgerFigures, 'period' | 'origin' | 'syncId' | 'prepared' | 'reviewed'> {
  const o = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const tb = o(input.tb);
  const bs = o(input.bs);
  const pl = o(input.pl);
  const cf = o(input.cf);
  const fa = input.fa == null || input.fa === '' ? null : o(input.fa);
  const stock = input.stock == null || input.stock === '' ? null : o(input.stock);
  const other = amount(pl.otherMovements ?? 0, 'Other approved equity movements');
  const adj = amount(cf.adjustment ?? 0, 'Classification adjustment');
  const schedules = Array.isArray(input.schedules) ? input.schedules : [];
  if (schedules.length > 30) throw new BadRequest('At most 30 schedules.');
  return {
    source: noSecrets(text(input.source, 'The SQL Account reports filed (file name or SharePoint link)', 3, 300), 'Source'),
    tb: { debit: amount(tb.debit, 'Trial balance: total debits'), credit: amount(tb.credit, 'Trial balance: total credits') },
    bs: { assets: amount(bs.assets, 'Total assets'), liabilities: amount(bs.liabilities, 'Total liabilities'), equity: amount(bs.equity, 'Total equity') },
    pl: {
      result: amount(pl.result, 'Profit or loss for the month'),
      reOpening: amount(pl.reOpening, 'Retained earnings at the start of the month'),
      reClosing: amount(pl.reClosing, 'Retained earnings at the end of the month'),
      dividends: amount(pl.dividends ?? 0, 'Dividends'),
      otherMovements: other,
      otherNote: other ? requireReason(pl.otherNote, 'record other equity movements (prior-period change, reserve)') : '',
    },
    cf: {
      opening: amount(cf.opening, 'Cash-flow statement: opening cash'),
      operating: amount(cf.operating, 'Operating cash flow'),
      investing: amount(cf.investing, 'Investing cash flow'),
      financing: amount(cf.financing, 'Financing cash flow'),
      fx: amount(cf.fx ?? 0, 'Exchange differences'),
      closing: amount(cf.closing, 'Cash-flow statement: closing cash'),
      bsCash: amount(cf.bsCash, 'Cash and bank in the balance sheet'),
      adjustment: adj,
      adjustmentNote: adj ? requireReason(cf.adjustmentNote, 'adjust cash for classification (restricted cash, overdraft)') : '',
    },
    fa: fa
      ? {
          regCost: amount(fa.regCost, 'Asset register: cost'),
          regAccDep: amount(fa.regAccDep, 'Asset register: accumulated depreciation'),
          glCost: amount(fa.glCost, 'Ledger: fixed asset cost'),
          glAccDep: amount(fa.glAccDep, 'Ledger: accumulated depreciation'),
        }
      : null,
    faNa: fa ? null : requireReason(input.faNa, 'mark fixed assets as not applicable'),
    stock: stock ? { value: amount(stock.value, 'Stock valuation'), gl: amount(stock.gl, 'Inventory in the ledger') } : null,
    stockNa: stock ? null : requireReason(input.stockNa, 'mark stock as not applicable'),
    schedules: schedules.map((s, i) => {
      const r = o(s);
      const kind = FIN_SCHEDULE_KINDS.find((k) => k === r.kind);
      if (!kind) throw new BadRequest(`Schedule ${i + 1}: kind is one of ${FIN_SCHEDULE_KINDS.join(', ')}.`);
      return {
        kind,
        gl: amount(r.gl, `Schedule ${i + 1}: ledger balance`),
        schedule: amount(r.schedule, `Schedule ${i + 1}: schedule total`),
        doc: noSecrets(text(r.doc, `Schedule ${i + 1}: the schedule filed`, 3, 200), 'Schedule'),
      };
    }),
    note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
  };
}

/** Record the month's figures (Finance staff) and review them (someone else: deputy, leader, FD or CEO). */
export function finFiguresAction(ctx: FinCashCtx, f: FinStatus, closePeriod: string, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx.a);
  const list = f.ledgerFigures ?? [];
  const p = period(input.period);
  if (p > closePeriod) throw new BadRequest('Figures are recorded for months that have ended.');
  const cur = list.find((x) => x.period === p);
  if (action === 'record') {
    if (cur?.reviewed && !ctx.senior) throw new BadRequest('That month is reviewed; the team leader, the FD or the CEO re-opens it.');
    const next: FinLedgerFigures = { period: p, origin: 'typed', syncId: null, ...figuresFromInput(input), prepared: ctx.sign(), reviewed: null };
    const fails = finFsFromFigures(next).filter((t) => t.diff != null && !zero(t.diff));
    return {
      patch: { ledgerFigures: [...list.filter((x) => x.period !== p), next] },
      action: 'finance.ledger.figures',
      summary: `Statement figures ${p} recorded from ${next.source}${fails.length ? `; not agreeing: ${fails.map((t) => `${t.id} ${rmf(t.diff!)}`).join(', ')}` : '; every test agrees'}.`,
      result: { figures: next, tests: finFsFromFigures(next) },
    };
  }
  if (action === 'review') {
    if (!cur) throw new NotFound('Figures for that month');
    if (cur.reviewed) throw new BadRequest('Already reviewed.');
    if (!ctx.reviewer) throw new AccessDenied('view', '(the deputy, the team leader, the FD or the CEO reviews the figures)');
    if (cur.prepared.byId === ctx.user.id) throw new AccessDenied('view', '(nobody reviews the figures they recorded)');
    const next = { ...cur, reviewed: ctx.sign(requireComment(input.comment, 'review')) };
    return {
      patch: { ledgerFigures: list.map((x) => (x.period === p ? next : x)) },
      action: 'finance.ledger.reviewed',
      summary: `Statement figures ${p} reviewed: ${next.reviewed.comment}`,
      result: next,
    };
  }
  throw new BadRequest('Unknown figures action.');
}

// ---------- 72. Chart of accounts and cost dimension mapping ----------

export type FinCoaCategory =
  | 'cash'
  | 'bank'
  | 'trade_debtors'
  | 'trade_creditors'
  | 'wages_accrual'
  | 'epf_liability'
  | 'perkeso_liability'
  | 'sst'
  | 'inventory'
  | 'fixed_assets'
  | 'accumulated_depreciation'
  | 'intercompany'
  | 'customer_deposits'
  | 'retained_earnings'
  | 'share_capital'
  | 'other_asset'
  | 'other_liability'
  | 'other_equity'
  | 'revenue'
  | 'cost_of_sales'
  | 'staff_costs'
  | 'other_expense'
  | 'other_income'
  | 'tax_expense';
/** The accounts the masterplan says each company documents (section 08, chart of accounts). */
export const FIN_COA_REQUIRED: FinCoaCategory[] = [
  'cash',
  'bank',
  'trade_debtors',
  'trade_creditors',
  'wages_accrual',
  'epf_liability',
  'perkeso_liability',
  'sst',
  'inventory',
  'fixed_assets',
  'accumulated_depreciation',
  'intercompany',
  'customer_deposits',
  'retained_earnings',
];
export const FIN_COA_CATEGORIES: FinCoaCategory[] = [
  ...FIN_COA_REQUIRED,
  'share_capital',
  'other_asset',
  'other_liability',
  'other_equity',
  'revenue',
  'cost_of_sales',
  'staff_costs',
  'other_expense',
  'other_income',
  'tax_expense',
];

export interface FinCoaMap {
  version: number;
  /** The first month the mapping applies to. Earlier months keep the version that applied then. */
  from: string;
  accounts: { code: string; name: string; category: FinCoaCategory }[];
  /** Required groups the company does not have (for example no stock), each with a reason. */
  na: { category: FinCoaCategory; reason: string }[];
  /** Each bank account's ledger code (never one line for several accounts). */
  banks: { bankId: Id; code: string }[];
  /** Sites and contracts to SQL Account project codes (a site is not a ledger code). */
  projects: { contractId: Id; project: string }[];
  note: string;
  proposed: FinSign;
  approved: FinSign | null;
  returned: FinSign | null;
}

/** The mapping in force for a month (the latest approved version starting on or before it). */
export function finCoaFor(f: Pick<FinStatus, 'coaMaps'>, p: string): FinCoaMap | null {
  return (f.coaMaps ?? []).filter((m) => m.approved && m.from <= p).sort((a, b) => b.from.localeCompare(a.from) || b.version - a.version)[0] ?? null;
}

/** What stops a mapping being approved: required groups missing, bank accounts without a code. */
export function finCoaGaps(m: Pick<FinCoaMap, 'accounts' | 'na' | 'banks'>, bankIds: Id[]): string[] {
  const gaps: string[] = [];
  for (const c of FIN_COA_REQUIRED)
    if (!m.accounts.some((x) => x.category === c) && !m.na.some((x) => x.category === c)) gaps.push(`No account mapped to ${c.replace(/_/g, ' ')}`);
  for (const b of bankIds) if (!m.banks.some((x) => x.bankId === b)) gaps.push(`Bank account ${b} has no ledger code`);
  for (const b of m.banks)
    if (!m.accounts.some((x) => x.code === b.code && x.category === 'bank')) gaps.push(`Ledger code ${b.code} for ${b.bankId} is not mapped as a bank account`);
  return gaps;
}

function lines(v: unknown, what: string, max: number): string[][] {
  const raw = typeof v === 'string' ? v : '';
  const out = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s*[,\t|]\s*/));
  if (out.length > max) throw new BadRequest(`${what}: at most ${max} lines.`);
  return out;
}

export function finCoaAction(
  ctx: FinCashCtx,
  f: FinStatus,
  contractIds: Id[],
  closePeriod: string,
  action: string,
  input: Record<string, unknown>,
): Out<unknown> {
  staff(ctx.a);
  const list = f.coaMaps ?? [];
  if (action === 'propose') {
    const from = period(input.from);
    const accounts = lines(input.accounts, 'Accounts', 2000).map(([code, name, cat], i) => {
      const category = FIN_COA_CATEGORIES.find((k) => k === cat?.toLowerCase().replace(/\s+/g, '_'));
      if (!code || !/^[A-Za-z0-9./-]{1,20}$/.test(code)) throw new BadRequest(`Account line ${i + 1}: the SQL Account code (letters, digits, - . /).`);
      if (!category) throw new BadRequest(`Account line ${i + 1}: the group is one of ${FIN_COA_CATEGORIES.join(', ')}.`);
      return { code, name: noSecrets(text(name, `Account line ${i + 1}: name`, 2, 120), 'Account name'), category };
    });
    if (!accounts.length) throw new BadRequest('Give at least one account: code, name, group (one per line).');
    const seen = new Set<string>();
    for (const a of accounts) {
      if (seen.has(a.code)) throw new BadRequest(`Account ${a.code} is listed twice.`);
      seen.add(a.code);
    }
    const na = lines(input.na, 'Not applicable', 20).map(([cat, ...why], i) => {
      const category = FIN_COA_REQUIRED.find((k) => k === cat?.toLowerCase().replace(/\s+/g, '_'));
      if (!category) throw new BadRequest(`Not applicable line ${i + 1}: one of ${FIN_COA_REQUIRED.join(', ')}.`);
      return { category, reason: requireReason(why.join(', '), `mark ${category} as not applicable`) };
    });
    const bankIds = f.banks.map((b) => b.id);
    // A bank line left without its code (the screen lists every account) is not mapped yet and shows as a gap.
    const banks = lines(input.banks, 'Bank accounts', 50)
      .filter(([, code]) => !!code)
      .map(([bankId, code], i) => {
        if (!bankIds.includes(bankId)) throw new BadRequest(`Bank line ${i + 1}: ${bankId} is not one of this company's bank accounts.`);
        return { bankId, code };
      });
    if (new Set(banks.map((b) => b.code)).size !== banks.length)
      throw new BadRequest('Each bank account has its own ledger code (never one line for several accounts).');
    const projects = lines(input.projects, 'Projects', 2000).map(([contractId, project], i) => {
      if (!contractIds.includes(contractId)) throw new BadRequest(`Project line ${i + 1}: ${contractId} is not a contract of this company.`);
      if (!project || !/^[A-Za-z0-9./-]{1,30}$/.test(project)) throw new BadRequest(`Project line ${i + 1}: the SQL Account project code.`);
      return { contractId, project };
    });
    const m: FinCoaMap = {
      version: list.length + 1,
      from,
      accounts,
      na,
      banks,
      projects,
      note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
      proposed: ctx.sign(),
      approved: null,
      returned: null,
    };
    if (list.some((x) => !x.approved && !x.returned)) throw new BadRequest('A mapping is already waiting for approval; approve or return it first.');
    const gaps = finCoaGaps(m, bankIds);
    return {
      patch: { coaMaps: [...list, m] },
      action: 'finance.coa.proposed',
      summary: `Chart of accounts mapping v${m.version} from ${from}: ${accounts.length} account(s), ${banks.length} bank(s), ${projects.length} project(s)${gaps.length ? `; still missing: ${gaps.join('; ')}` : ''}.`,
      result: { map: m, gaps },
    };
  }
  const v = Number(input.version);
  const cur = list.find((x) => x.version === v);
  if (!cur) throw new NotFound('Mapping version');
  if (cur.approved || cur.returned) throw new BadRequest('That version is already decided.');
  if (!ctx.a || !isLead(ctx.a)) throw new AccessDenied('view', '(the Finance Director or the CEO approves a chart of accounts mapping)');
  if (cur.proposed.byId === ctx.user.id) throw new AccessDenied('view', '(nobody approves the mapping they proposed)');
  if (action === 'approve') {
    const gaps = finCoaGaps(
      cur,
      f.banks.map((b) => b.id),
    );
    if (gaps.length) throw new BadRequest(`Not complete: ${gaps.join('; ')}.`);
    if (cur.from <= closePeriod && (f.closes ?? []).some((c) => c.period >= cur.from && c.status === 'approved'))
      throw new BadRequest('A month on or after that start is already closed; start the mapping from the next open month.');
    const next = { ...cur, approved: ctx.sign(requireComment(input.comment, 'approve')) };
    return {
      patch: { coaMaps: list.map((x) => (x.version === v ? next : x)) },
      action: 'finance.coa.approved',
      summary: `Chart of accounts mapping v${v} approved from ${cur.from}: ${next.approved.comment}`,
      result: next,
    };
  }
  if (action === 'return') {
    const next = { ...cur, returned: ctx.sign(requireReason(input.comment, 'return the mapping')) };
    return {
      patch: { coaMaps: list.map((x) => (x.version === v ? next : x)) },
      action: 'finance.coa.returned',
      summary: `Chart of accounts mapping v${v} returned: ${next.returned.comment}`,
      result: next,
    };
  }
  throw new BadRequest('Unknown mapping action.');
}

// ---------- 71. SQL Account connector (read-only, switched off) ----------

export type FinYesNo = 'yes' | 'no' | 'unknown';
export interface FinSqlDiscovery {
  /** The SQL Account company file or database name for this legal entity. */
  companyFile: string;
  deployment: 'cloud' | 'on_premises' | 'offline' | 'unknown';
  version: string;
  modules: { restApi: FinYesNo; asset: FinYesNo; project: FinYesNo; consolidation: FinYesNo; bankFeed: FinYesNo };
  /** The SQL Account partner's written confirmation of the edition, modules and API (file name or link). */
  partnerDoc: string;
  recorded: FinSign;
  confirmed: FinSign | null;
}

/** One read from SQL Account: the trial balance by account plus the report totals, with its own identity. */
export interface FinSqlSnapshot {
  /** SQL Account's own identity for this read; a read is used once. */
  externalId: string;
  companyFile: string;
  period: string;
  readAt: IsoDateTime;
  accounts: { code: string; debit: number; credit: number }[];
  figures: Record<string, unknown>;
}

export interface FinSqlSync {
  id: string;
  externalId: string;
  period: string;
  fingerprint: string;
  status: 'accepted' | 'rejected';
  reasons: string[];
  at: IsoDateTime;
}

/** The only shape a connector may have: reads, never writes. No implementation in this repository calls SQL Account. */
export interface SqlAccountReader {
  readPeriod(companyFile: string, period: string): Promise<FinSqlSnapshot>;
}

/** Why the connector cannot be used for this company (empty when it can). */
export function finSqlBlockers(f: Pick<FinStatus, 'sqlDiscovery' | 'coaMaps'>, p: string, switchedOn: boolean, readerInstalled: boolean): string[] {
  const out: string[] = [];
  if (!switchedOn) out.push('The SQL Account connector is switched off for Prima (a separate, authorised change switches it on).');
  if (!readerInstalled) out.push('No SQL Account reader is installed; Finance records the figures from the SQL Account reports.');
  const d = f.sqlDiscovery;
  if (!d) out.push("The company's SQL Account edition, modules and API are not recorded.");
  else {
    if (!d.confirmed) out.push('The SQL Account set-up is waiting for the Finance Director or the CEO to confirm it.');
    if (d.modules.restApi !== 'yes') out.push('SQL Account API access is not confirmed for this company.');
    if (d.deployment === 'offline' || d.deployment === 'unknown') out.push('The SQL Account file is offline or its deployment is unknown.');
  }
  if (!finCoaFor(f, p)) out.push(`No approved chart of accounts mapping for ${p}.`);
  return out;
}

/** A stable fingerprint of a read, so the same figures are never taken twice under a new identity. */
export function finSqlFingerprint(s: FinSqlSnapshot): string {
  const body = JSON.stringify([s.companyFile, s.period, [...s.accounts].sort((a, b) => a.code.localeCompare(b.code)), s.figures]);
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) h = Math.imul(h ^ body.charCodeAt(i), 16777619);
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}-${body.length}`;
}

/**
 * Takes one connector read. Refused (and journalled as rejected) when it is for another company file or month, any
 * account is not in the approved mapping, the trial balance totals differ from its lines, or the same read was taken
 * before. Accepted reads fill the month's figures as 'connector', still waiting for a person's review.
 */
export function finSqlApply(f: FinStatus, s: FinSqlSnapshot, p: string, at: IsoDateTime, sign: FinSign): { patch: Partial<FinStatus>; sync: FinSqlSync } {
  const syncs = f.sqlSyncs ?? [];
  const fingerprint = finSqlFingerprint(s);
  const reasons: string[] = [];
  if (!f.sqlDiscovery || s.companyFile !== f.sqlDiscovery.companyFile) reasons.push('The read is for another SQL Account company file.');
  if (s.period !== p) reasons.push(`The read is for ${s.period}, not ${p}.`);
  if (syncs.some((x) => x.status === 'accepted' && (x.externalId === s.externalId || x.fingerprint === fingerprint)))
    reasons.push('This read was already taken.');
  const map = finCoaFor(f, p);
  const unmapped = s.accounts.filter((a) => !map?.accounts.some((m) => m.code === a.code)).map((a) => a.code);
  if (unmapped.length) reasons.push(`Accounts not in the approved mapping: ${unmapped.slice(0, 20).join(', ')}${unmapped.length > 20 ? ' ...' : ''}.`);
  let figures: FinLedgerFigures | null = null;
  if (!reasons.length) {
    try {
      const base = figuresFromInput({ ...s.figures, source: `SQL Account read ${s.externalId}` });
      const dr = r2(s.accounts.reduce((n, a) => n + a.debit, 0));
      const cr = r2(s.accounts.reduce((n, a) => n + a.credit, 0));
      if (!zero(dr - base.tb.debit) || !zero(cr - base.tb.credit)) reasons.push('The trial balance totals differ from the sum of its accounts.');
      figures = { period: p, origin: 'connector', syncId: null, ...base, prepared: sign, reviewed: null };
    } catch (e) {
      reasons.push(`The read is incomplete: ${(e as Error).message}`);
    }
  }
  const sync: FinSqlSync = {
    id: `sql-${f.companyId}-${String(syncs.length + 1).padStart(5, '0')}`,
    externalId: s.externalId.slice(0, 120),
    period: s.period,
    fingerprint,
    status: reasons.length ? 'rejected' : 'accepted',
    reasons,
    at,
  };
  const patch: Partial<FinStatus> = { sqlSyncs: [...syncs, sync] };
  if (!reasons.length && figures) {
    const list = f.ledgerFigures ?? [];
    if (list.some((x) => x.period === p && x.reviewed)) {
      sync.status = 'rejected';
      sync.reasons = ['That month is already reviewed; the team leader re-opens it first.'];
    } else patch.ledgerFigures = [...list.filter((x) => x.period !== p), { ...figures, syncId: sync.id }];
  }
  return { patch, sync };
}

export function finSqlDiscoveryAction(ctx: FinCashCtx, f: FinStatus, action: string, input: Record<string, unknown>): Out<unknown> {
  staff(ctx.a);
  const yn = (v: unknown, what: string): FinYesNo => {
    if (v === 'yes' || v === 'no' || v === 'unknown') return v;
    throw new BadRequest(`${what}: yes, no or unknown.`);
  };
  if (action === 'record') {
    if (!ctx.senior) throw new AccessDenied('view', '(the team leader, the Finance Director or the CEO records the SQL Account set-up)');
    const m = input.modules && typeof input.modules === 'object' ? (input.modules as Record<string, unknown>) : {};
    const deployment = (['cloud', 'on_premises', 'offline', 'unknown'] as const).find((k) => k === input.deployment);
    if (!deployment) throw new BadRequest('Deployment: cloud, on_premises, offline or unknown.');
    const d: FinSqlDiscovery = {
      companyFile: noSecrets(text(input.companyFile, 'SQL Account company file or database name', 2, 120), 'Company file'),
      deployment,
      version: text(input.version, 'SQL Account version', 1, 40),
      modules: {
        restApi: yn(m.restApi, 'API'),
        asset: yn(m.asset, 'Asset module'),
        project: yn(m.project, 'Project module'),
        consolidation: yn(m.consolidation, 'Consolidation add-on'),
        bankFeed: yn(m.bankFeed, 'Bank feed'),
      },
      partnerDoc: noSecrets(text(input.partnerDoc, "The SQL Account partner's confirmation (file name or link)", 3, 300), 'Document'),
      recorded: ctx.sign(),
      confirmed: null,
    };
    return {
      patch: { sqlDiscovery: d },
      action: 'finance.sql.discovery',
      summary: `SQL Account set-up recorded: ${d.companyFile}, ${d.deployment}, version ${d.version}, API ${d.modules.restApi}.`,
      result: d,
    };
  }
  if (action === 'confirm') {
    const d = f.sqlDiscovery;
    if (!d) throw new NotFound('SQL Account set-up');
    if (d.confirmed) throw new BadRequest('Already confirmed.');
    if (!ctx.a || !isLead(ctx.a)) throw new AccessDenied('view', '(the Finance Director or the CEO confirms the SQL Account set-up)');
    if (d.recorded.byId === ctx.user.id) throw new AccessDenied('view', '(nobody confirms the set-up they recorded)');
    const next = { ...d, confirmed: ctx.sign(requireComment(input.comment, 'confirm')) };
    return { patch: { sqlDiscovery: next }, action: 'finance.sql.confirmed', summary: `SQL Account set-up confirmed: ${next.confirmed.comment}`, result: next };
  }
  throw new BadRequest('Unknown SQL Account set-up action.');
}

/** What the Finance screen shows for the ledger: tests, figures, mappings and the connector's state. */
export function finLedgerView(f: FinStatus, closePeriod: string, ic: { status: string; diff: number }[] | null, switchedOn: boolean, readerInstalled: boolean) {
  const fig = (f.ledgerFigures ?? []).find((x) => x.period === closePeriod) ?? null;
  const pending = (f.coaMaps ?? []).find((m) => !m.approved && !m.returned) ?? null;
  return {
    period: closePeriod,
    tests: finFsTests(f, closePeriod, ic),
    figures: fig,
    figuresTests: fig ? finFsFromFigures(fig) : [],
    coa: finCoaFor(f, closePeriod),
    coaPending: pending
      ? {
          ...pending,
          gaps: finCoaGaps(
            pending,
            f.banks.map((b) => b.id),
          ),
        }
      : null,
    coaHistory: (f.coaMaps ?? []).map((m) => ({
      version: m.version,
      from: m.from,
      accounts: m.accounts.length,
      approved: m.approved,
      returned: m.returned,
      proposed: m.proposed,
    })),
    banks: f.banks.map((b) => ({ id: b.id, label: `${b.bank} ${b.accountMasked}` })),
    sql: { discovery: f.sqlDiscovery ?? null, blockers: finSqlBlockers(f, closePeriod, switchedOn, readerInstalled), syncs: (f.sqlSyncs ?? []).slice(-10) },
    categories: FIN_COA_CATEGORIES,
    required: FIN_COA_REQUIRED,
    scheduleKinds: FIN_SCHEDULE_KINDS,
  };
}