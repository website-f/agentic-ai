import { AccessDenied } from './access';
import { BadRequest, NotFound } from './service';
import { actsOn, finActor, isLead, isFinCoo } from './finance';
import type { FinActor, FinanceDeskService } from './finance';
import { RULES } from './rules';
import type { Store } from './store';
import {
  SQL_DOC_BUILT,
  SQL_DOC_LABEL,
  SQL_DOC_TYPES,
  SQL_EXCEPTION_LABEL,
  SQL_IN_BOOK,
  SQL_OPEN,
  SQL_STATUS_LABEL,
  SqlPostError,
  sqlArPayload,
  sqlCodeText,
  sqlCompare,
  sqlConfirmedBook,
  sqlCustomerCodeOf,
  sqlDayTotals,
  sqlExceptionOverdue,
  sqlJobReasons,
  sqlLookalikes,
  sqlMissingJobs,
  sqlNextTry,
  sqlParseListing,
  sqlPostingInstalled,
  sqlPvPayload,
  sqlRefreshCodes,
  sqlSourceChange,
  sqlWaitsForCodes,
  sqlWorkingDaysAfter,
} from './sql-posting';
import type { FinSqlCode, SqlAccountPoster, SqlAttempt, SqlDocType, SqlExceptionKind, SqlPayload, SqlPostedDoc, SqlPostingException, SqlPostingJob } from './sql-posting';
import { addDays, dateOf } from './time';
import type { FinSign, FinStatus, Id, IsoDate, IsoDateTime, User } from './types';
import type { HomeItem } from './service';

/** One sender at a time in this process, so two runs never send the same job twice. */
let senderBusy = false;

export interface SqlPostingOptions {
  /** SQL_POSTING_ENABLED=true on the API (off by default; needs the CEO's go-ahead). */
  enabled: boolean;
  /** The real adapter. Never installed in this repository; tests pass a fake. */
  poster: SqlAccountPoster | null;
}

/**
 * The SQL Account posting link (Fauzan, 13 Nov 2026, Build 1, rule FIN-SQLPOST): the queue, the codes, the sender,
 * the daily check and its exceptions list. Finance of a company, the Finance Director and the CEO see it; the COO sees
 * the count only. Every switch and every check needs a reason, and nobody checks their own entry.
 */
export class FinanceSqlPostingService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private desk: FinanceDeskService,
    private opts: SqlPostingOptions,
  ) {}

  private now(): IsoDateTime {
    return this.clock();
  }
  private today(): IsoDate {
    return this.desk.today();
  }
  private sign(user: User, comment = ''): FinSign {
    return { by: user.name, byId: user.id, at: this.now(), comment };
  }
  private ctx() {
    return { enabled: this.opts.enabled, posterInstalled: !!this.opts.poster };
  }
  private reviewer(a: FinActor) {
    return isLead(a) || a.kind === 'leader' || a.kind === 'deputy';
  }
  private actor(user: User): FinActor {
    const a = finActor(user);
    if (!a || a.kind === 'viewer') throw new AccessDenied('view', '(Finance staff, the Finance Director and the CEO)');
    return a;
  }

  /** The company rows this person's Finance role covers (a team: its own companies; FD and CEO: all). */
  private async rows(user: User, a: FinActor, tx: Store = this.store): Promise<FinStatus[]> {
    const ids = await this.desk.companies(user);
    return (await tx.list('finStatus', { companyId: ids })).filter((f) => ids.includes(f.companyId) && actsOn(a, f));
  }

  private async installed(tx: Store = this.store) {
    return sqlPostingInstalled(tx);
  }
  private notInstalled(): never {
    throw new BadRequest('The SQL Account posting link is not installed in this database yet (module sql-posting-v1, run by the CEO).');
  }

  private async jobsOf(tx: Store, companyId: Id) {
    return (await tx.list('sqlPostings', { companyId: [companyId] })).filter((j) => j.companyId === companyId);
  }
  private async exceptionsOf(tx: Store, companyId: Id) {
    return (await tx.list('sqlPostingExceptions', { companyId: [companyId] })).filter((e) => e.companyId === companyId);
  }

  private async log(tx: Store, user: User, f: FinStatus, action: string, summary: string) {
    await this.desk.log(tx, user, f, action, summary.slice(0, 900));
  }

  /** The payload as the source record stands now: codes filled in once checked; amounts and dates never change. */
  private fresh(f: FinStatus, job: SqlPostingJob): SqlPayload | null {
    if (job.sourceKind === 'payment') {
      const p = (f.payments ?? []).find((x) => x.id === job.sourceId);
      return p ? sqlPvPayload(f, p, job.revision) : null;
    }
    const [caseId, receiptId] = job.sourceId.split('.');
    const c = (f.arCases ?? []).find((x) => x.id === caseId);
    const r = c?.receipts?.find((x) => x.id === receiptId);
    return c && r ? sqlArPayload(f, c, r, job.revision) : null;
  }

  /** Re-evaluates every waiting job of a company: a job becomes ready by itself once its codes are checked. */
  private async refreshCompany(tx: Store, f: FinStatus) {
    for (const job of await this.jobsOf(tx, f.companyId)) {
      if (job.status !== 'not_ready' && job.status !== 'ready') continue;
      const change = sqlSourceChange(f, job);
      if (change) {
        await tx.update('sqlPostings', job.id, { status: 'manual_review', reasons: [`${change} Finance to look (nothing was sent).`] });
        continue;
      }
      const payload = sqlRefreshCodes(job, this.fresh(f, job)) ?? job.payload;
      const reasons = sqlJobReasons(f, { ...job, payload }, this.ctx());
      const status = reasons.length ? 'not_ready' : 'ready';
      if (status !== job.status || JSON.stringify(reasons) !== JSON.stringify(job.reasons) || JSON.stringify(payload) !== JSON.stringify(job.payload))
        await tx.update('sqlPostings', job.id, { status, reasons, payload });
    }
  }

  // ---------- The screen: Finance > Checks > SQL Account link ----------

  async view(user: User) {
    const a = this.actor(user);
    if (!(await this.installed())) return { installed: false as const, enabled: this.opts.enabled, posterInstalled: !!this.opts.poster, companies: [] };
    const names = new Map((await this.store.list('companies')).map((c) => [c.id, c.name]));
    const today = this.today();
    const companies = [];
    for (const f of await this.rows(user, a)) {
      const jobs = await this.jobsOf(this.store, f.companyId);
      const exceptions = await this.exceptionsOf(this.store, f.companyId);
      const live = jobs.map((j) => (j.status === 'not_ready' || j.status === 'ready' ? { ...j, reasons: sqlJobReasons(f, { ...j, payload: sqlRefreshCodes(j, this.fresh(f, j)) ?? j.payload }, this.ctx()) } : j));
      const posted = jobs.filter((j) => j.postedAt).sort((x, y) => y.postedAt!.localeCompare(x.postedAt!));
      const checked = jobs.filter((j) => j.lastCheckedAt).sort((x, y) => y.lastCheckedAt!.localeCompare(x.lastCheckedAt!));
      companies.push({
        companyId: f.companyId,
        name: names.get(f.companyId) ?? f.companyId,
        book: sqlConfirmedBook(f),
        on: !!f.sqlPosting?.on,
        docTypes: SQL_DOC_TYPES.map((t) => ({ docType: t, label: SQL_DOC_LABEL[t], on: !!f.sqlPosting?.docTypes[t], built: SQL_DOC_BUILT.includes(t) })),
        lastPostedAt: posted[0]?.postedAt ?? null,
        lastCheckedAt: checked[0]?.lastCheckedAt ?? null,
        counts: {
          codes: live.filter((j) => j.status === 'not_ready' && sqlWaitsForCodes(j.reasons)).length,
          waiting: live.filter((j) => j.status === 'not_ready' || j.status === 'ready' || j.status === 'retryable_error' || j.status === 'sending').length,
          refused: jobs.filter((j) => j.status === 'rejected').length,
          unknown: jobs.filter((j) => j.status === 'outcome_unknown' || j.status === 'manual_review').length,
          differences: jobs.filter((j) => j.status === 'check_failed').length,
          exceptions: exceptions.filter((e) => e.status !== 'checked').length,
        },
        jobs: live
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
          .slice(0, 200)
          .map((j) => ({ ...j, statusLabel: SQL_STATUS_LABEL[j.status], docLabel: SQL_DOC_LABEL[j.docType] })),
        exceptions: exceptions
          .filter((e) => e.status !== 'checked' || dateOf(e.createdAt) >= addDays(today, -31))
          .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
          .slice(0, 200)
          .map((e) => ({
            ...e,
            label: SQL_EXCEPTION_LABEL[e.kind],
            overdue: sqlExceptionOverdue(e, today),
            may: this.exceptionMay(user, a, e),
          })),
        payeeCodes: (f.payees ?? []).filter((p) => p.status !== 'blocked').map((p) => ({ payeeId: p.id, payee: p.name, code: p.sqlCode ?? null, mayCheck: !!p.sqlCode && !p.sqlCode.checked && p.sqlCode.entered.byId !== user.id && this.reviewer(a) })),
        customerCodes: (f.sqlCustomerCodes ?? []).map((c) => ({ ...c, mayCheck: !c.checked && c.entered.byId !== user.id && this.reviewer(a) })),
        customersWithoutCode: [...new Set((f.arCases ?? []).map((c) => c.customer))].filter((n) => !sqlCustomerCodeOf(f, n)).slice(0, 100),
      });
    }
    return {
      installed: true as const,
      enabled: this.opts.enabled,
      posterInstalled: !!this.opts.poster,
      lead: isLead(a),
      rule: RULES.financeSqlPosting.value,
      companies,
    };
  }

  private exceptionMay(user: User, a: FinActor, e: SqlPostingException): ('explain' | 'check')[] {
    if (e.status === 'open' && (e.actBy === 'finance' || isLead(a))) return ['explain'];
    if (e.status === 'explained' && e.explained?.byId !== user.id && this.reviewer(a)) return ['check'];
    return [];
  }

  /** The COO and the home key numbers: the count only ("Unknown" when posting is off or was never checked). */
  async exceptionCount(user: User): Promise<number | null> {
    const a = finActor(user);
    const coo = isFinCoo(user);
    if (!coo && (!a || a.kind === 'viewer')) return null;
    if (!(await this.installed())) return null;
    const ids = await this.desk.companies(user);
    const rows = (await this.store.list('finStatus', { companyId: ids })).filter((f) => ids.includes(f.companyId) && (coo || actsOn(a!, f)) && f.sqlPosting?.on);
    if (!rows.length) return null;
    let n = 0;
    let checked = false;
    for (const f of rows) {
      const jobs = await this.jobsOf(this.store, f.companyId);
      if (jobs.some((j) => j.lastCheckedAt)) checked = true;
      n += (await this.exceptionsOf(this.store, f.companyId)).filter((e) => e.status !== 'checked').length;
    }
    return checked || n ? n : null;
  }

  // ---------- Switches (FD or CEO, with a reason) ----------

  async setSwitch(user: User, companyId: Id, input: { on?: unknown; docTypes?: unknown; reason?: unknown }) {
    const a = this.actor(user);
    if (!isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO switches SQL Account posting)');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10) throw new BadRequest('Give a reason (at least 10 characters).');
    const on = input.on === true;
    const asked = input.docTypes && typeof input.docTypes === 'object' ? (input.docTypes as Record<string, unknown>) : {};
    const docTypes: Partial<Record<SqlDocType, boolean>> = {};
    for (const t of SQL_DOC_TYPES) {
      if (asked[t] !== true) continue;
      if (!SQL_DOC_BUILT.includes(t)) throw new BadRequest(`${SQL_DOC_LABEL[t]} waits for SQL support's answer on suppliers; it cannot be switched on yet.`);
      docTypes[t] = true;
    }
    return this.store.transaction(async (tx) => {
      if (!(await this.installed(tx))) this.notInstalled();
      const f = await this.desk.row(tx, user, a, companyId);
      if (on && !sqlConfirmedBook(f)) throw new BadRequest("Confirm the company's SQL Account set-up first (Finance > Checks > SQL Account set-up).");
      const prev = f.sqlPosting ?? { on: false, docTypes: {}, changes: [] };
      const sqlPosting = { on, docTypes, changes: [...prev.changes, { ...this.sign(user, reason), on, docTypes }].slice(-100) };
      await tx.update('finStatus', f.id, { sqlPosting });
      await this.refreshCompany(tx, { ...f, sqlPosting });
      await this.log(tx, user, f, 'finance.sqlpost.switch', `SQL Account posting ${on ? 'on' : 'off'} (${Object.keys(docTypes).join(', ') || 'no document types'}): ${reason}`);
      return sqlPosting;
    });
  }

  // ---------- Codes (L4): Finance enters, a second person checks ----------

  async codeAction(user: User, companyId: Id, action: string, input: Record<string, unknown>) {
    const a = this.actor(user);
    return this.store.transaction(async (tx) => {
      const f = await this.desk.row(tx, user, a, companyId);
      let patch: Partial<FinStatus>;
      let summary: string;
      const entered = (code: string): FinSqlCode => ({ code, entered: this.sign(user), checked: null });
      if (action === 'payeeCode' || action === 'payeeCodeCheck') {
        const payees = f.payees ?? [];
        const p = payees.find((x) => x.id === input.payeeId);
        if (!p) throw new NotFound('Payee');
        if (action === 'payeeCode') {
          const code = sqlCodeText(input.code);
          if (!code) throw new BadRequest('Type the SQL Account code (letters, digits, - / . only, up to 20 characters).');
          if (payees.some((x) => x.id !== p.id && x.sqlCode?.code === code)) throw new BadRequest(`${code} is already the code of another payee in this company.`);
          patch = { payees: payees.map((x) => (x.id === p.id ? { ...x, sqlCode: entered(code) } : x)) };
          summary = `SQL Account code ${code} entered for payee ${p.name}; waits for a second person's check`;
        } else {
          if (!p.sqlCode || p.sqlCode.checked) throw new BadRequest('No code is waiting for a check.');
          if (p.sqlCode.entered.byId === user.id) throw new AccessDenied('view', '(nobody checks a code they entered)');
          if (!this.reviewer(a)) throw new AccessDenied('view', '(the team leader, the deputy, the Finance Director or the CEO checks)');
          const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
          if (comment.length < 3) throw new BadRequest('Say how you checked it (for example "matches the supplier list in SQL Account").');
          patch = { payees: payees.map((x) => (x.id === p.id ? { ...x, sqlCode: { ...p.sqlCode!, checked: this.sign(user, comment) } } : x)) };
          summary = `SQL Account code ${p.sqlCode.code} for payee ${p.name} checked: ${comment}`;
        }
      } else if (action === 'customerCode' || action === 'customerCodeCheck') {
        const name = typeof input.customer === 'string' ? input.customer.trim().slice(0, 160) : '';
        if (name.length < 2) throw new BadRequest('Which customer (as on the invoice case)?');
        const list = f.sqlCustomerCodes ?? [];
        const have = sqlCustomerCodeOf(f, name);
        if (action === 'customerCode') {
          const code = sqlCodeText(input.code);
          if (!code) throw new BadRequest('Type the SQL Account customer code (letters, digits, - / . only, up to 20 characters).');
          if (list.some((x) => x !== have && x.code === code)) throw new BadRequest(`${code} is already the code of another customer in this company.`);
          const row = { customer: have?.customer ?? name, ...entered(code) };
          patch = { sqlCustomerCodes: have ? list.map((x) => (x === have ? row : x)) : [...list, row] };
          summary = `SQL Account customer code ${code} entered for ${row.customer}; waits for a second person's check`;
        } else {
          if (!have || have.checked) throw new BadRequest('No customer code is waiting for a check.');
          if (have.entered.byId === user.id) throw new AccessDenied('view', '(nobody checks a code they entered)');
          if (!this.reviewer(a)) throw new AccessDenied('view', '(the team leader, the deputy, the Finance Director or the CEO checks)');
          const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
          if (comment.length < 3) throw new BadRequest('Say how you checked it.');
          patch = { sqlCustomerCodes: list.map((x) => (x === have ? { ...have, checked: this.sign(user, comment) } : x)) };
          summary = `SQL Account customer code ${have.code} for ${have.customer} checked: ${comment}`;
        }
      } else throw new BadRequest('Unknown action.');
      await tx.update('finStatus', f.id, patch);
      if (await this.installed(tx)) await this.refreshCompany(tx, { ...f, ...patch });
      await this.log(tx, user, f, `finance.sqlpost.${action}`, summary);
      return { ok: true };
    });
  }

  // ---------- The sender (L5) ----------

  /** "Send now" for the Finance Director or the CEO; the API timer calls run() when switched on. */
  async sendNow(user: User) {
    const a = this.actor(user);
    if (!isLead(a)) throw new AccessDenied('view', '(the Finance Director or the CEO)');
    return this.run();
  }

  /**
   * Sends ready jobs one company at a time, oldest first. Off (nothing sent) unless SQL_POSTING_ENABLED is on and an
   * adapter is installed. A job is marked "sending" in its own transaction before the call, so a crash leaves it to be
   * looked up, never sent twice. A timeout after sending is looked up by our reference; never resent.
   */
  async run(): Promise<{ sent: number; posted: number; refused: number; retry: number; unknown: number; busy?: boolean; off?: string }> {
    const out = { sent: 0, posted: 0, refused: 0, retry: 0, unknown: 0 };
    if (!this.opts.enabled || !this.opts.poster) return { ...out, off: !this.opts.enabled ? 'SQL Account posting is switched off in Prima.' : 'No SQL Account posting adapter is installed.' };
    if (!(await this.installed())) return { ...out, off: 'The SQL Account posting link is not installed in this database yet.' };
    if (senderBusy) return { ...out, busy: true };
    senderBusy = true;
    try {
      const poster = this.opts.poster;
      const rows = (await this.store.list('finStatus')).filter((f) => f.sqlPosting?.on).sort((x, y) => x.companyId.localeCompare(y.companyId));
      for (const f0 of rows) {
        await this.store.transaction(async (tx) => {
          const f = await tx.get('finStatus', f0.id);
          if (f) await this.refreshCompany(tx, f);
        });
        const jobs = (await this.jobsOf(this.store, f0.companyId)).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
        for (const j of jobs) {
          if (j.status === 'sending' || j.status === 'outcome_unknown') {
            out.unknown += 1;
            await this.lookUp(j, poster);
            continue;
          }
          const due = j.status === 'ready' || (j.status === 'retryable_error' && (!j.nextTryAt || Date.parse(j.nextTryAt) <= Date.parse(this.now())));
          if (!due) continue;
          const claimed = await this.claim(j.id);
          if (!claimed) continue;
          out.sent += 1;
          const r = await this.sendOne(claimed, poster);
          out[r] += 1;
        }
      }
      return out;
    } finally {
      senderBusy = false;
    }
  }

  /** Re-checks the job just before sending and marks it "sending". Null when it must not be sent now. */
  private async claim(id: Id): Promise<SqlPostingJob | null> {
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sqlPostings', id);
      const j = await tx.get('sqlPostings', id);
      if (!j || !(j.status === 'ready' || j.status === 'retryable_error')) return null;
      const f = await tx.get('finStatus', `fin-${j.companyId}`);
      if (!f) return null;
      const change = sqlSourceChange(f, j);
      if (change) {
        await tx.update('sqlPostings', j.id, { status: 'manual_review', reasons: [`${change} Finance to look (nothing was sent).`], attempts: [...j.attempts, this.attempt('changed', change)] });
        return null;
      }
      const payload = sqlRefreshCodes(j, this.fresh(f, j)) ?? j.payload;
      const reasons = sqlJobReasons(f, { ...j, payload }, this.ctx());
      if (reasons.length) {
        await tx.update('sqlPostings', j.id, { status: 'not_ready', reasons, payload });
        return null;
      }
      return tx.update('sqlPostings', j.id, { status: 'sending', reasons: [], payload });
    });
  }

  private attempt(outcome: SqlAttempt['outcome'], note: string): SqlAttempt {
    return { at: this.now(), outcome, note: note.slice(0, 300) };
  }

  private async sendOne(j: SqlPostingJob, poster: SqlAccountPoster): Promise<'posted' | 'refused' | 'retry' | 'unknown'> {
    const book = j.book!;
    try {
      const r = await poster.post(book, j.docType, j.payload, j.payload.ourRef);
      await this.markPosted(j, r.docNo, r.docKey, this.attempt('posted', `Posted as ${r.docNo}`));
      return 'posted';
    } catch (e) {
      const kind = e instanceof SqlPostError ? e.kind : 'timeout';
      const msg = e instanceof SqlPostError ? e.message : 'No answer from SQL Account after sending';
      if (kind === 'rejected' || kind === 'closed_period') {
        await this.store.transaction(async (tx) => {
          await tx.update('sqlPostings', j.id, { status: 'rejected', reasons: [msg], attempts: [...j.attempts, this.attempt('rejected', msg)] });
          if (kind === 'closed_period') await this.raise(tx, j, 'closed_period', `${SQL_DOC_LABEL[j.docType]} ${j.payload.ourRef} RM${j.payload.amount.toFixed(2)} dated ${j.payload.date}: ${msg}`, 'fd');
        });
        return 'refused';
      }
      if (kind === 'network') {
        const tries = j.tries + 1;
        const next = sqlNextTry(this.now(), tries);
        await this.store.update('sqlPostings', j.id, {
          status: next ? 'retryable_error' : 'manual_review',
          tries,
          nextTryAt: next,
          reasons: [next ? `Network error before SQL Account answered; trying again at ${next.slice(11, 16)} UTC.` : 'Network errors after every retry: Finance to look.'],
          attempts: [...j.attempts, this.attempt('network', msg)],
        });
        return 'retry';
      }
      // Timeout after sending or "already there": never sent again; looked up first.
      const unknown = await this.store.update('sqlPostings', j.id, {
        status: 'outcome_unknown',
        reasons: ['SQL Account did not confirm; Prima looks it up by its reference before anything else (never sent again).'],
        attempts: [...j.attempts, this.attempt(kind === 'duplicate' ? 'duplicate' : 'timeout', msg)],
      });
      await this.lookUp(unknown, poster);
      return 'unknown';
    }
  }

  private async lookUp(j: SqlPostingJob, poster: SqlAccountPoster) {
    if (!poster.findByRef) {
      await this.store.update('sqlPostings', j.id, { status: 'manual_review', reasons: ['SQL Account cannot be searched by our reference: Finance checks in SQL Account whether it went in, then records the document number.'] });
      return;
    }
    let doc: SqlPostedDoc | null = null;
    try {
      doc = await poster.findByRef(j.book!, j.docType, j.payload.ourRef);
    } catch (e) {
      await this.store.update('sqlPostings', j.id, { status: 'outcome_unknown', attempts: [...j.attempts, this.attempt('lookup_failed', e instanceof Error ? e.message : 'lookup failed')] });
      return;
    }
    if (doc) await this.markPosted(j, doc.docNo, doc.docKey, this.attempt('found', `Found in SQL Account as ${doc.docNo}`));
    else
      await this.store.update('sqlPostings', j.id, {
        status: 'manual_review',
        reasons: ['Not found in SQL Account by our reference after an unconfirmed send: Finance checks before anything is sent again.'],
        attempts: [...j.attempts, this.attempt('not_found', 'Not found by reference')],
      });
  }

  /** Posted: keep the SQL document number and show it on the Prima record. A payment that pays a bill needs a knock-off by hand. */
  private async markPosted(j: SqlPostingJob, docNo: string, docKey: string, attempt: SqlAttempt) {
    await this.store.transaction(async (tx) => {
      await tx.update('sqlPostings', j.id, { status: 'posted', reasons: [], sqlDocNo: docNo.slice(0, 40), sqlDocKey: docKey.slice(0, 80), postedAt: this.now(), attempts: [...j.attempts, attempt] });
      const f = await tx.get('finStatus', `fin-${j.companyId}`);
      if (f && j.sourceKind === 'payment') {
        await tx.update('finStatus', f.id, { payments: (f.payments ?? []).map((p) => (p.id === j.sourceId ? { ...p, sqlPost: { docNo, on: this.today() } } : p)) });
      }
      if (j.payload.docType === 'GL_PV' && j.payload.paysSqlDoc)
        await this.raise(tx, { ...j, sqlDocNo: docNo }, 'knock_off', `${docNo} pays ${j.payload.paysSqlDoc} (${j.payload.payee} RM${j.payload.amount.toFixed(2)}): knock off the bill against this voucher in SQL Account by hand. If ${j.payload.paysSqlDoc} is a voucher already typed by hand, reverse one of them.`, 'finance');
    });
  }

  private async raise(tx: Store, j: Pick<SqlPostingJob, 'id' | 'companyId' | 'sourceId' | 'sqlDocNo'> | null, kind: SqlExceptionKind, text: string, actBy: 'finance' | 'fd', opts: { companyId?: Id; key?: string; origin?: 'prima' | 'pasted_export'; sourceId?: string } = {}) {
    const companyId = j?.companyId ?? opts.companyId!;
    const key = `${companyId}|${kind}|${opts.key ?? j?.id ?? ''}`;
    if ((await tx.list('sqlPostingExceptions', { companyId: [companyId] })).some((e) => e.key === key)) return false;
    const e: SqlPostingException = {
      id: `sqlx-${companyId}-${kind}-${(opts.key ?? j?.id ?? '').replace(/[^A-Za-z0-9.-]/g, '')}`.slice(0, 160),
      companyId,
      kind,
      key,
      jobId: j?.id ?? null,
      sourceId: j?.sourceId ?? opts.sourceId ?? null,
      sqlDocNo: j?.sqlDocNo ?? null,
      text: text.slice(0, 600),
      actBy,
      origin: opts.origin ?? 'prima',
      status: 'open',
      explained: null,
      checked: null,
      createdAt: this.now(),
    };
    await tx.insert('sqlPostingExceptions', e);
    return true;
  }

  // ---------- The daily check (L6) ----------

  /** "Check now" for Finance reviewers, the FD and the CEO; the API runs it at 06:00 when switched on. */
  async checkNow(user: User) {
    const a = this.actor(user);
    if (!this.reviewer(a)) throw new AccessDenied('view', '(the team leader, the deputy, the Finance Director or the CEO)');
    const ids = (await this.rows(user, a)).map((f) => f.companyId);
    return this.check(ids);
  }

  async check(companyIds?: Id[]) {
    if (!(await this.installed())) return { checked: 0, failed: 0, raised: 0, off: 'not installed' };
    const today = this.today();
    const poster = this.opts.enabled ? this.opts.poster : null;
    const rule = RULES.financeSqlPosting.value;
    let checked = 0;
    let failed = 0;
    let raised = 0;
    const rows = (await this.store.list('finStatus')).filter((f) => f.sqlPosting?.on && (!companyIds || companyIds.includes(f.companyId)));
    for (const f of rows) {
      const jobs = await this.jobsOf(this.store, f.companyId);
      // 1. Read back what was posted before today.
      const read = new Map<Id, SqlPostedDoc | null>();
      if (poster)
        for (const j of jobs.filter((x) => x.status === 'posted' && x.postedAt && dateOf(x.postedAt) < today && x.sqlDocNo)) {
          let doc: SqlPostedDoc | null;
          try {
            doc = await poster.fetch(j.book!, j.docType, j.sqlDocNo!);
          } catch {
            continue;
          }
          read.set(j.id, doc);
          const diffs = sqlCompare(j, doc);
          checked += 1;
          await this.store.transaction(async (tx) => {
            await tx.update('sqlPostings', j.id, { status: diffs.length ? 'check_failed' : 'checked_ok', lastCheckedAt: this.now(), checkResult: { ok: !diffs.length, at: this.now(), diffs } });
            if (diffs.length) {
              failed += 1;
              if (await this.raise(tx, j, 'differs', `${j.sqlDocNo} (${j.payload.ourRef}): ${diffs.join('; ')}.`, 'finance')) raised += 1;
            }
          });
        }
      await this.store.transaction(async (tx) => {
        const now = await this.jobsOf(tx, f.companyId);
        // 2. Not posted after 1 working day.
        for (const j of now.filter((x) => SQL_OPEN.includes(x.status) && today > sqlWorkingDaysAfter(x.createdAt, rule.stuckWorkingDays)))
          if (await this.raise(tx, j, 'stuck', `${SQL_DOC_LABEL[j.docType]} ${j.payload.ourRef} RM${j.payload.amount.toFixed(2)}: ${SQL_STATUS_LABEL[j.status]}. ${j.reasons.join(' ')}`, j.reasons.some((r) => /closed/.test(r)) ? 'fd' : 'finance')) raised += 1;
        // 3. Finished records with no job (the outbox is broken: urgent).
        const since = now.reduce<string | null>((m, j) => (!m || j.createdAt < m ? j.createdAt : m), null);
        if (since)
          for (const m of sqlMissingJobs(f, now, dateOf(since)))
            if (await this.raise(tx, null, 'no_job', m.text, 'finance', { companyId: f.companyId, key: m.source, sourceId: m.source })) raised += 1;
        // 4. Changed or cancelled in Prima after posting.
        for (const j of now.filter((x) => SQL_IN_BOOK.includes(x.status))) {
          const change = sqlSourceChange(f, j);
          if (change && (await this.raise(tx, j, 'reverse', `${j.sqlDocNo}: ${change} Reverse or correct it in SQL Account and record the reversing document number.`, 'finance'))) raised += 1;
        }
        // 6. Yesterday's totals per document type.
        const day = addDays(today, -1);
        for (const t of sqlDayTotals(now, read, day))
          if (read.size && Math.abs(t.diff) >= 0.005 && (await this.raise(tx, null, 'totals', `${day} ${SQL_DOC_LABEL[t.docType]}: Prima posted RM${t.prima.toFixed(2)}, SQL Account shows RM${t.sql.toFixed(2)}.`, 'finance', { companyId: f.companyId, key: `${t.docType}-${day}` })))
            raised += 1;
      });
      // 5. Look-alikes typed by hand, when the API can list by date.
      if (poster?.list && f.sqlDiscovery) {
        const day = addDays(today, -1);
        for (const t of SQL_DOC_BUILT) {
          let docs: SqlPostedDoc[] = [];
          try {
            docs = await poster.list(sqlConfirmedBook(f) ?? '', t, day, day);
          } catch {
            continue;
          }
          const hits = sqlLookalikes(jobs.filter((j) => j.docType === t), docs.map((d) => ({ docNo: d.docNo, date: d.date, amount: d.amount, ref: d.ourRef ?? '' })));
          await this.store.transaction(async (tx) => {
            for (const h of hits)
              if (await this.raise(tx, null, 'not_from_prima', `${h.docNo} on ${h.date} RM${h.amount.toFixed(2)} was not posted by Prima but matches a Prima posting: typed by hand as well?`, 'finance', { companyId: f.companyId, key: h.docNo }))
                raised += 1;
          });
        }
      }
    }
    return { checked, failed, raised };
  }

  /** Finance pastes SQL Account's daily document listing when the API cannot list (labelled "from a pasted export"). */
  async pasteListing(user: User, companyId: Id, csv: unknown) {
    const a = this.actor(user);
    if (typeof csv !== 'string' || csv.length > 500_000) throw new BadRequest('Paste the SQL Account listing as CSV: document number, date (YYYY-MM-DD), amount, reference.');
    const rows = sqlParseListing(csv);
    if (!rows.length) throw new BadRequest('No lines could be read. Each line: document number, date (YYYY-MM-DD), amount, reference.');
    return this.store.transaction(async (tx) => {
      if (!(await this.installed(tx))) this.notInstalled();
      const f = await this.desk.row(tx, user, a, companyId);
      const jobs = await this.jobsOf(tx, f.companyId);
      let raised = 0;
      for (const h of sqlLookalikes(jobs, rows))
        if (await this.raise(tx, null, 'not_from_prima', `${h.docNo} on ${h.date} RM${h.amount.toFixed(2)} was not posted by Prima but matches a Prima posting: typed by hand as well?`, 'finance', { companyId: f.companyId, key: h.docNo, origin: 'pasted_export' }))
          raised += 1;
      await this.log(tx, user, f, 'finance.sqlpost.paste', `SQL Account listing pasted (${rows.length} line(s)); ${raised} look-alike(s) listed`);
      return { lines: rows.length, raised };
    });
  }

  /** Explain or fix (Finance, with a comment), then checked by someone else. */
  async exceptionAction(user: User, id: Id, action: string, input: Record<string, unknown>) {
    const a = this.actor(user);
    return this.store.transaction(async (tx) => {
      if (!(await this.installed(tx))) this.notInstalled();
      const e0 = await tx.get('sqlPostingExceptions', typeof id === 'string' ? id.slice(0, 200) : '');
      if (!e0) throw new NotFound('Exception');
      const f = await this.desk.row(tx, user, a, e0.companyId);
      await tx.lock?.('sqlPostingExceptions', e0.id);
      const e = (await tx.get('sqlPostingExceptions', e0.id))!;
      const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 600) : '';
      let next: SqlPostingException;
      if (action === 'explain') {
        if (e.status !== 'open') throw new BadRequest('This exception is already explained.');
        if (e.actBy === 'fd' && !isLead(a)) throw new AccessDenied('view', '(the Finance Director decides a closed SQL Account period)');
        if (comment.length < 10) throw new BadRequest('Say what you found or fixed (at least 10 characters).');
        const reversing = typeof input.reversingDocNo === 'string' ? input.reversingDocNo.trim().slice(0, 40) : '';
        if (e.kind === 'reverse' && !reversing) throw new BadRequest('Record the SQL Account document number that reverses or corrects it.');
        next = { ...e, status: 'explained', explained: { ...this.sign(user, comment), reversingDocNo: reversing || null } };
      } else if (action === 'check') {
        if (e.status !== 'explained') throw new BadRequest('Only an explained exception is checked.');
        if (e.explained?.byId === user.id) throw new AccessDenied('view', '(nobody checks an exception they explained)');
        if (!this.reviewer(a)) throw new AccessDenied('view', '(the team leader, the deputy, the Finance Director or the CEO checks)');
        if (comment.length < 3) throw new BadRequest('Say how you checked it.');
        next = { ...e, status: 'checked', checked: this.sign(user, comment) };
      } else throw new BadRequest('Unknown action.');
      const saved = await tx.update('sqlPostingExceptions', e.id, next);
      await this.log(tx, user, f, `finance.sqlpost.exception.${action}`, `${SQL_EXCEPTION_LABEL[e.kind]}: ${e.text} ${action === 'explain' ? 'explained' : 'checked'}: ${comment}`);
      return saved;
    });
  }

  // ---------- Home items ----------

  async home(user: User): Promise<HomeItem[]> {
    const a = finActor(user);
    if (!a || a.kind === 'viewer' || !(await this.installed())) return [];
    const today = this.today();
    let codes = 0;
    let overdue = 0;
    for (const f of await this.rows(user, a)) {
      const jobs = await this.jobsOf(this.store, f.companyId);
      codes += jobs.filter((j) => j.status === 'not_ready' && sqlWaitsForCodes(sqlJobReasons(f, { ...j, payload: sqlRefreshCodes(j, this.fresh(f, j)) ?? j.payload }, this.ctx()))).length;
      overdue += (await this.exceptionsOf(this.store, f.companyId)).filter((e) => sqlExceptionOverdue(e, today)).length;
    }
    const go = { view: 'finance' as const, tab: 'checks' as const };
    const out: HomeItem[] = [];
    if (codes) out.push({ tone: 'info', tag: 'Finance', title: `${codes} document(s) waiting for SQL Account codes`, detail: 'Enter the supplier or customer code; a second person checks it', go });
    if (overdue && isLead(a)) out.push({ tone: 'warn', tag: 'Finance', title: `${overdue} SQL Account link exception(s) not checked after 3 working days`, detail: 'They hold the month-end close', go });
    return out;
  }
}

