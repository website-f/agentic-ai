import { sha256Hex } from './audit';
import { finCoaFor } from './finance-ledger';
import { RULES } from './rules';
import { addDays, addMinutes, addWorkingDays, dateOf } from './time';
import type { Store } from './store';
import type { FinArCase, FinPayment, FinSign, FinStatus, Id, IsoDate, IsoDateTime } from './types';

/**
 * SQL Account posting link, Build 1 (Fauzan, 13 Nov 2026, rule FIN-SQLPOST). SQL Account stays the group's books: one
 * installation with a separate book for each company. Prima posts approved, finished records into that company's own
 * book through the vendor API only (never its tables), keeps the SQL document number it gets back and checks every
 * day that what it posted is there and agrees.
 *
 * Everything here is pure. The service (finance-sql-posting.ts) writes jobs in the same transaction that finishes the
 * record, and sends only when SQL_POSTING_ENABLED is on, a poster is installed and the company and document type are
 * switched on. No poster is installed anywhere in this repository; tests use a fake one in the test folder only.
 */

// ---------- Shared idempotency key and payload fingerprint (also used by the item register outbox) ----------

/** The placeholder book while a company's SQL Account set-up is not confirmed. */
export const SQL_BOOK_UNCONFIRMED = 'book-not-confirmed';

/** One SQL Account document: company + book + type + source + revision. Never two documents for one key. */
export function sqlPostingKey(companyId: Id, book: string | null, docType: string, source: string, revision: number): string {
  return `${companyId}|${book || SQL_BOOK_UNCONFIRMED}|${docType}|${source}|r${revision}`;
}

/** A stable fingerprint of a payload: keys sorted, so the same content always gives the same hash. */
export function sqlPayloadHash(payload: unknown): string {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return sha256Hex(JSON.stringify(norm(payload)));
}

/** The company's SQL Account book from its confirmed set-up (null until the FD or the CEO confirms it). */
export function sqlConfirmedBook(f: Pick<FinStatus, 'sqlDiscovery'> | null | undefined): string | null {
  const d = f?.sqlDiscovery;
  return d?.confirmed && d.companyFile.trim() ? d.companyFile.trim() : null;
}

// ---------- Types ----------

/** Only the first two are created in Build 1. AP_PI waits for the vendor answer on suppliers (L1 Q4). */
export type SqlDocType = 'GL_PV' | 'AR_PM' | 'AP_PI';
export const SQL_DOC_TYPES: SqlDocType[] = ['GL_PV', 'AR_PM', 'AP_PI'];
export const SQL_DOC_LABEL: Record<SqlDocType, string> = {
  GL_PV: 'Payment voucher (payment released)',
  AR_PM: 'Customer payment (receipt matched to the bank statement)',
  AP_PI: 'Purchase invoice (supplier bill)',
};
/** Built in Build 1. A supplier bill job waits for SQL support's answer on suppliers (L1 Q4). */
export const SQL_DOC_BUILT: SqlDocType[] = ['GL_PV', 'AR_PM'];

export type SqlPostingStatus =
  | 'not_ready'
  | 'ready'
  | 'sending'
  | 'posted'
  | 'rejected'
  | 'retryable_error'
  | 'outcome_unknown'
  | 'manual_review'
  | 'checked_ok'
  | 'check_failed';
export const SQL_STATUS_LABEL: Record<SqlPostingStatus, string> = {
  not_ready: 'Waiting',
  ready: 'Ready to send',
  sending: 'Sending',
  posted: 'Posted',
  rejected: 'Refused by SQL Account',
  retryable_error: 'Will try again',
  outcome_unknown: 'Unknown: being looked up',
  manual_review: 'Finance to look',
  checked_ok: 'Posted and checked',
  check_failed: 'Differs in SQL Account',
};
/** A job that is not yet in SQL Account (for the "not posted after 1 working day" list). */
export const SQL_OPEN: SqlPostingStatus[] = ['not_ready', 'ready', 'sending', 'rejected', 'retryable_error', 'outcome_unknown', 'manual_review'];
/** A job whose document is (or may be) in SQL Account: never sent again. */
export const SQL_IN_BOOK: SqlPostingStatus[] = ['posted', 'checked_ok', 'check_failed'];

export interface SqlPvPayload {
  docType: 'GL_PV';
  companyId: Id;
  book: string | null;
  date: IsoDate;
  payee: string;
  /** The payee's checked SQL Account code (supplier or the account to charge). */
  payeeCode: string | null;
  /** The bank account's ledger code from the approved chart of accounts mapping. */
  bankCode: string | null;
  amount: number;
  description: string;
  bankRef: string;
  /** The SQL Account bill it pays, if any: knocked off by hand in SQL Account until L1 Q3 is answered. */
  paysSqlDoc: string | null;
  ourRef: string;
}
export interface SqlArPayload {
  docType: 'AR_PM';
  companyId: Id;
  book: string | null;
  date: IsoDate;
  customer: string;
  customerCode: string | null;
  bankCode: string | null;
  amount: number;
  /** The SQL Account invoice it knocks off. */
  invoiceNo: string;
  ref: string;
  ourRef: string;
}
export type SqlPayload = SqlPvPayload | SqlArPayload;

export interface SqlAttempt {
  at: IsoDateTime;
  outcome: 'posted' | 'rejected' | 'network' | 'timeout' | 'duplicate' | 'found' | 'not_found' | 'lookup_failed' | 'changed';
  note: string;
}

export interface SqlPostingJob {
  id: Id;
  companyId: Id;
  /** The company's SQL Account book when the job was made (null when not yet confirmed). */
  book: string | null;
  docType: SqlDocType;
  sourceKind: 'payment' | 'receipt';
  /** The Prima record: payment id, or invoice case id + receipt id. */
  sourceId: string;
  revision: number;
  key: string;
  payload: SqlPayload;
  payloadHash: string;
  status: SqlPostingStatus;
  reasons: string[];
  attempts: SqlAttempt[];
  /** Network errors so far (a timeout is never counted: it is looked up, not resent). */
  tries: number;
  nextTryAt: IsoDateTime | null;
  sqlDocNo: string | null;
  sqlDocKey: string | null;
  postedAt: IsoDateTime | null;
  lastCheckedAt: IsoDateTime | null;
  checkResult: { ok: boolean; at: IsoDateTime; diffs: string[] } | null;
  createdAt: IsoDateTime;
}

export type SqlExceptionKind = 'differs' | 'stuck' | 'no_job' | 'reverse' | 'knock_off' | 'not_from_prima' | 'totals' | 'closed_period';
export const SQL_EXCEPTION_LABEL: Record<SqlExceptionKind, string> = {
  differs: 'Posted by Prima but differs or is missing in SQL Account',
  stuck: 'Not posted after 1 working day',
  no_job: 'Finished in Prima with no posting job (urgent)',
  reverse: 'Reverse or correct in SQL Account',
  knock_off: 'Knock off the bill in SQL Account by hand',
  not_from_prima: 'In SQL Account but not posted by Prima',
  totals: "Day's totals differ",
  closed_period: 'Refused: the SQL Account period is closed (Finance Director decides)',
};

export interface SqlPostingException {
  id: Id;
  companyId: Id;
  kind: SqlExceptionKind;
  /** One open exception per key (kind + job or record + day). */
  key: string;
  jobId: Id | null;
  sourceId: string | null;
  sqlDocNo: string | null;
  text: string;
  /** Who must act: Finance (codes, differences) or the Finance Director (closed period). */
  actBy: 'finance' | 'fd';
  /** 'from a pasted export' when it came from Finance's pasted SQL Account listing. */
  origin: 'prima' | 'pasted_export';
  status: 'open' | 'explained' | 'checked';
  explained: (FinSign & { reversingDocNo: string | null }) | null;
  checked: FinSign | null;
  createdAt: IsoDateTime;
}

/** Per company switch and per document type, set by the Finance Director or the CEO with a reason. Off by default. */
export interface FinSqlPostingSwitch {
  on: boolean;
  docTypes: Partial<Record<SqlDocType, boolean>>;
  changes: (FinSign & { on: boolean; docTypes: Partial<Record<SqlDocType, boolean>> })[];
}

/** An SQL Account code entered by Finance and checked by a second person (L4). */
export interface FinSqlCode {
  code: string;
  entered: FinSign;
  checked: FinSign | null;
}
export interface FinSqlCustomerCode extends FinSqlCode {
  /** The customer name as on the invoice case. */
  customer: string;
}

/** What a poster gives back when it reads a document. */
export interface SqlPostedDoc {
  docNo: string;
  docKey: string;
  book: string;
  docType: SqlDocType;
  date: IsoDate;
  amount: number;
  codes: string[];
  ourRef: string | null;
}

/**
 * The only way Prima may write to SQL Account (Fauzan, 13 Nov 2026): the vendor API or SDK, one company book per call.
 * No implementation in this repository calls SQL Account; the real adapter waits for SQL support's answers (L1).
 */
export interface SqlAccountPoster {
  post(book: string, docType: SqlDocType, payload: SqlPayload, ourRef: string): Promise<{ docNo: string; docKey: string }>;
  fetch(book: string, docType: SqlDocType, docNo: string): Promise<SqlPostedDoc | null>;
  /** Look up by our reference (L1 Q5/Q6). Missing when the API cannot: an unknown outcome then goes to a person. */
  findByRef?(book: string, docType: SqlDocType, ourRef: string): Promise<SqlPostedDoc | null>;
  /** List by date (L1 Q5). Missing when the API cannot: Finance pastes the daily listing instead. */
  list?(book: string, docType: SqlDocType, from: IsoDate, to: IsoDate): Promise<SqlPostedDoc[]>;
}

/** How a poster says why a post failed. Anything else thrown is treated as a timeout after sending (never resent). */
export class SqlPostError extends Error {
  constructor(
    public kind: 'rejected' | 'closed_period' | 'network' | 'timeout' | 'duplicate',
    message: string,
  ) {
    super(message);
  }
}

// ---------- Building payloads from finished Prima records ----------

export function sqlOurRef(source: string, revision: number): string {
  return `PRIMA-${source}-r${revision}`.slice(0, 60);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A payment voucher for a released payment. Null when the payment is not released (no job for drafts or approvals). */
export function sqlPvPayload(f: FinStatus, p: FinPayment, revision = 1): SqlPvPayload | null {
  if (p.status !== 'released' || !p.releasedOn) return null;
  const payee = p.payeeId ? (f.payees ?? []).find((x) => x.id === p.payeeId) : undefined;
  const map = finCoaFor(f, p.releasedOn.slice(0, 7));
  return {
    docType: 'GL_PV',
    companyId: f.companyId,
    book: sqlConfirmedBook(f),
    date: p.releasedOn,
    payee: p.payee,
    payeeCode: payee?.sqlCode?.checked ? payee.sqlCode.code : null,
    bankCode: map?.banks.find((b) => b.bankId === p.bankId)?.code ?? null,
    amount: round2(p.amount),
    description: p.purpose.slice(0, 200),
    bankRef: p.bankRef ?? '',
    paysSqlDoc: p.sqlRef?.trim() || null,
    ourRef: sqlOurRef(p.id, revision),
  };
}

export type FinArReceipt = NonNullable<FinArCase['receipts']>[number];

/** A customer payment for a receipt Prima found on the bank statement. Null until matched. */
export function sqlArPayload(f: FinStatus, c: FinArCase, r: FinArReceipt, revision = 1): SqlArPayload | null {
  if (!r.matched) return null;
  const map = finCoaFor(f, r.matched.date.slice(0, 7));
  const code = sqlCustomerCodeOf(f, c.customer);
  return {
    docType: 'AR_PM',
    companyId: f.companyId,
    book: sqlConfirmedBook(f),
    date: r.matched.date,
    customer: c.customer,
    customerCode: code?.checked ? code.code : null,
    bankCode: map?.banks.find((b) => b.bankId === r.bankId)?.code ?? null,
    amount: round2(r.amount),
    invoiceNo: c.invoiceNo,
    ref: r.ref,
    ourRef: sqlOurRef(`${c.id}.${r.id}`, revision),
  };
}

const normName = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function sqlCustomerCodeOf(f: Pick<FinStatus, 'sqlCustomerCodes'>, customer: string): FinSqlCustomerCode | undefined {
  const n = normName(customer);
  return (f.sqlCustomerCodes ?? []).find((x) => normName(x.customer) === n);
}

// ---------- Readiness: why a job cannot be sent yet ----------

export interface SqlReadyCtx {
  /** SQL_POSTING_ENABLED on the API. */
  enabled: boolean;
  /** A real adapter is installed (never in this repository). */
  posterInstalled: boolean;
}

/** Every reason a job must wait (empty when it can be sent). Codes typed but not yet checked never release it. */
export function sqlJobReasons(f: FinStatus, job: Pick<SqlPostingJob, 'docType' | 'book' | 'payload'>, ctx: SqlReadyCtx): string[] {
  const out: string[] = [];
  if (!ctx.enabled) out.push('SQL Account posting is switched off in Prima (it needs the CEO\'s go-ahead).');
  else if (!ctx.posterInstalled) out.push('No SQL Account posting adapter is installed yet (waits for SQL support\'s answers).');
  const sw = f.sqlPosting;
  if (!sw?.on) out.push('SQL Account posting is switched off for this company.');
  else if (!sw.docTypes[job.docType]) out.push(`Posting of ${SQL_DOC_LABEL[job.docType].toLowerCase()} is switched off for this company.`);
  const d = f.sqlDiscovery;
  if (!d) out.push("The company's SQL Account set-up is not recorded.");
  else {
    if (!d.confirmed) out.push('The SQL Account set-up is waiting for the Finance Director or the CEO to confirm it.');
    if (d.modules.restApi !== 'yes') out.push('SQL Account API access is not confirmed for this company.');
  }
  const book = sqlConfirmedBook(f);
  if (book && job.book && book !== job.book) out.push(`The company's SQL Account book changed from ${job.book} to ${book} after this job was made: Finance to look.`);
  if (!job.book && !book) out.push('No confirmed SQL Account book for this company.');
  const p = job.payload;
  if (!finCoaFor(f, p.date.slice(0, 7))) out.push(`No approved chart of accounts mapping for ${p.date.slice(0, 7)}.`);
  else if (!p.bankCode) out.push('The bank account has no ledger code in the approved chart of accounts mapping.');
  if (p.docType === 'GL_PV' && !p.payeeCode) out.push(`${p.payee} has no checked SQL Account code (Finance enters it, a second person checks it).`);
  if (p.docType === 'AR_PM' && !p.customerCode) out.push(`${p.customer} has no checked SQL Account customer code (Finance enters it, a second person checks it).`);
  return out;
}

/** Reasons that are only about codes (for "x documents waiting for SQL Account codes"). */
export function sqlWaitsForCodes(reasons: string[]): boolean {
  return reasons.some((r) => /SQL Account (customer )?code|ledger code|chart of accounts/.test(r));
}

/** The payload rebuilt with the codes as they are now (codes are filled in once checked; amounts never change). */
export function sqlRefreshCodes(job: SqlPostingJob, fresh: SqlPayload | null): SqlPayload | null {
  if (!fresh || fresh.docType !== job.payload.docType) return null;
  const sameMoney = fresh.amount === job.payload.amount && fresh.date === job.payload.date;
  return sameMoney ? { ...fresh, book: job.book ?? fresh.book, ourRef: job.payload.ourRef } : null;
}

// ---------- Retry timing ----------

/** When to try again after the n-th network error (5, 15, 60, 240 minutes, then the next day). Null after the last. */
export function sqlNextTry(now: IsoDateTime, tries: number): IsoDateTime | null {
  const mins = RULES.financeSqlPosting.value.retryMinutes;
  if (tries > mins.length) return null;
  return addMinutes(now, mins[tries - 1]);
}

// ---------- The daily check ----------

/** What differs between the payload Prima posted and the document read back. Empty when they agree. */
export function sqlCompare(job: SqlPostingJob, doc: SqlPostedDoc | null): string[] {
  if (!doc) return [`${job.sqlDocNo ?? 'The document'} was not found in SQL Account.`];
  const out: string[] = [];
  const p = job.payload;
  if (job.book && doc.book !== job.book) out.push(`book ${doc.book}, Prima posted to ${job.book}`);
  if (Math.abs(doc.amount - p.amount) >= 0.005) out.push(`amount RM${doc.amount.toFixed(2)}, Prima posted RM${p.amount.toFixed(2)}`);
  if (doc.date !== p.date) out.push(`date ${doc.date}, Prima posted ${p.date}`);
  const want = [p.bankCode, p.docType === 'GL_PV' ? p.payeeCode : p.customerCode].filter((x): x is string => !!x);
  const missing = want.filter((c) => !doc.codes.includes(c));
  if (missing.length) out.push(`code${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not on the document`);
  return out;
}

/** The working day after which an open job counts as stuck, or an exception as overdue for checking. */
export function sqlWorkingDaysAfter(at: IsoDateTime, days: number): IsoDate {
  return addWorkingDays(dateOf(at), days);
}

/** Per document type, for the documents posted on one day: Prima's total against the read-back total. */
export function sqlDayTotals(jobs: SqlPostingJob[], read: Map<Id, SqlPostedDoc | null>, day: IsoDate) {
  const out: { docType: SqlDocType; prima: number; sql: number; diff: number }[] = [];
  for (const t of SQL_DOC_TYPES) {
    const js = jobs.filter((j) => j.docType === t && j.postedAt && dateOf(j.postedAt) === day && SQL_IN_BOOK.includes(j.status));
    if (!js.length) continue;
    const prima = round2(js.reduce((n, j) => n + j.payload.amount, 0));
    const sql = round2(js.reduce((n, j) => n + (read.get(j.id)?.amount ?? 0), 0));
    out.push({ docType: t, prima, sql, diff: round2(sql - prima) });
  }
  return out;
}

/**
 * Finance's pasted SQL Account daily listing (CSV: document number, date, amount, reference), for when the API cannot
 * list. Rows that look like a Prima posting (same date and amount as a Prima job) but have another document number
 * are returned: probably typed by hand as well as posted by Prima.
 */
export function sqlParseListing(csv: string): { docNo: string; date: IsoDate; amount: number; ref: string }[] {
  const out: { docNo: string; date: IsoDate; amount: number; ref: string }[] = [];
  for (const raw of csv.split(/\r?\n/).slice(0, 5000)) {
    const cells = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) continue;
    const [docNo, date, amt, ref = ''] = cells;
    const amount = Number(amt.replace(/[^0-9.-]/g, ''));
    if (!docNo || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) continue;
    out.push({ docNo: docNo.slice(0, 40), date, amount: round2(amount), ref: ref.slice(0, 80) });
  }
  return out;
}

export function sqlLookalikes(jobs: SqlPostingJob[], rows: ReturnType<typeof sqlParseListing>) {
  const ours = new Set(jobs.map((j) => j.sqlDocNo).filter(Boolean));
  return rows.filter(
    (r) => !ours.has(r.docNo) && !r.ref.startsWith('PRIMA-') && jobs.some((j) => SQL_IN_BOOK.includes(j.status) && j.payload.date === r.date && Math.abs(j.payload.amount - r.amount) < 0.005),
  );
}

/** Is a job's source record still finished as it was posted? Null when it is; otherwise what changed. */
export function sqlSourceChange(f: FinStatus, job: SqlPostingJob): string | null {
  if (job.sourceKind === 'payment') {
    const p = (f.payments ?? []).find((x) => x.id === job.sourceId);
    if (!p) return 'The payment is no longer in Prima.';
    if (p.status !== 'released') return `The payment is now ${p.status}.`;
    if (Math.abs(p.amount - job.payload.amount) >= 0.005 || p.releasedOn !== job.payload.date) return 'The payment amount or release date changed.';
    return null;
  }
  const [caseId, receiptId] = job.sourceId.split('.');
  const c = (f.arCases ?? []).find((x) => x.id === caseId);
  const r = c?.receipts?.find((x) => x.id === receiptId);
  if (!c || !r) return 'The receipt is no longer in Prima.';
  if (!r.matched) return 'The receipt was unmatched from the bank statement.';
  if (Math.abs(r.amount - job.payload.amount) >= 0.005 || r.matched.date !== job.payload.date) return 'The receipt amount or date changed.';
  return null;
}

/** Released payments and matched receipts on or after `since` that have no job (the outbox is broken if any). */
export function sqlMissingJobs(f: FinStatus, jobs: SqlPostingJob[], since: IsoDate) {
  const have = new Set(jobs.map((j) => `${j.sourceKind}:${j.sourceId}`));
  const out: { source: string; text: string }[] = [];
  for (const p of f.payments ?? [])
    if (p.status === 'released' && p.releasedOn && dateOf([...p.steps].reverse().find((x) => x.step === 'released')?.at ?? `${p.releasedOn}T00:00:00+08:00`) >= since && !have.has(`payment:${p.id}`))
      out.push({ source: `payment:${p.id}`, text: `Payment ${p.id} to ${p.payee} RM${p.amount.toFixed(2)} released ${p.releasedOn} has no SQL Account posting job` });
  for (const c of f.arCases ?? [])
    for (const r of c.receipts ?? [])
      if (r.matched && r.matched.date >= since && !have.has(`receipt:${c.id}.${r.id}`))
        out.push({ source: `receipt:${c.id}.${r.id}`, text: `Receipt RM${r.amount.toFixed(2)} for invoice ${c.invoiceNo} matched ${r.matched.date} has no SQL Account posting job` });
  return out;
}

/** An exception is overdue once it is not checked 3 working days after it was raised. */
export function sqlExceptionOverdue(e: SqlPostingException, today: IsoDate): boolean {
  return e.status !== 'checked' && today > sqlWorkingDaysAfter(e.createdAt, RULES.financeSqlPosting.value.exceptionCheckWorkingDays);
}

/** A code typed into Prima: letters, digits and - / . only, 1 to 20 characters (SQL Account codes). */
export function sqlCodeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9./-]{0,19}$/.test(c) ? c : null;
}

export const sqlDay = (at: IsoDateTime) => dateOf(at);
export const sqlYesterday = (today: IsoDate) => addDays(today, -1);

// ---------- The outbox: written in the same transaction that finishes the record ----------

/** Whether the posting tables are installed (the in-memory store always has them). */
export async function sqlPostingInstalled(tx: Store): Promise<boolean> {
  return tx.hasTable ? tx.hasTable('sqlPostings') : true;
}

/**
 * Queues one document for a finished record. A second call for the same record and content (double tap, retry) gives
 * the same job; changed content for the same record gives the next revision (a new key). Nothing is queued when the
 * module is not installed. Never sends: the sender does that later, only when everything is switched on.
 */
export async function sqlEnqueue(tx: Store, f: FinStatus, sourceKind: SqlPostingJob['sourceKind'], sourceId: string, payload: SqlPayload | null, at: IsoDateTime): Promise<SqlPostingJob | null> {
  if (!payload || !(await sqlPostingInstalled(tx))) return null;
  const hash = sqlPayloadHash({ ...payload, payeeCode: null, customerCode: null, bankCode: null, ourRef: null });
  const mine = (await tx.list('sqlPostings', { companyId: [f.companyId] })).filter((j) => j.companyId === f.companyId && j.sourceKind === sourceKind && j.sourceId === sourceId);
  const same = mine.find((j) => j.payloadHash === hash);
  if (same) return same;
  const revision = mine.reduce((n, j) => Math.max(n, j.revision), 0) + 1;
  const book = sqlConfirmedBook(f);
  const body: SqlPayload = { ...payload, book, ourRef: sqlOurRef(sourceId, revision) };
  const key = sqlPostingKey(f.companyId, book, payload.docType, `${sourceKind}:${sourceId}`, revision);
  const job: SqlPostingJob = {
    id: `sqlp-${f.companyId}-${sourceKind}-${sourceId}-r${revision}`.slice(0, 160),
    companyId: f.companyId,
    book,
    docType: payload.docType,
    sourceKind,
    sourceId,
    revision,
    key,
    payload: body,
    payloadHash: hash,
    status: 'not_ready',
    reasons: sqlJobReasons(f, { docType: payload.docType, book, payload: body }, { enabled: false, posterInstalled: false }),
    attempts: [],
    tries: 0,
    nextTryAt: null,
    sqlDocNo: null,
    sqlDocKey: null,
    postedAt: null,
    lastCheckedAt: null,
    checkResult: null,
    createdAt: at,
  };
  await tx.insert('sqlPostings', job);
  return job;
}

/** Month-end close (rule FIN-SQLPOST): every SQL Account exception must be checked before the close goes forward. */
export async function sqlCloseBlockers(tx: Store, companyId: Id): Promise<string[]> {
  if (!(await sqlPostingInstalled(tx))) return [];
  const open = (await tx.list('sqlPostingExceptions', { companyId: [companyId] })).filter((e) => e.companyId === companyId && e.status !== 'checked');
  return open.length ? [`${open.length} SQL Account link exception(s) not explained and checked (Finance > Checks > SQL Account link).`] : [];
}
