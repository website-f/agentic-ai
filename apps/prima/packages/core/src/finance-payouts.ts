import { AccessDenied } from "./access";
import { FIN_AUTO } from "./finance";
import { finActor } from "./finance";
import { finCovers } from "./finance";
import { isLead } from "./finance";
import { requireComment } from "./finance";
import type { FinActor } from "./finance";
import type { FinanceDeskService } from "./finance";
import { guardPayTotals } from "./guard-pay";
import { periodEnd } from "./payroll";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import { GROUP_EMPLOYER_ID } from "./access";
import type { Store } from "./store";
import { daysBetween } from "./time";
import type { FinSettingsValues } from "./types";
import type { FinSign } from "./types";
import type { FinStatement } from "./types";
import type { FinStatus } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import type { TableName } from "./types";
import type { HomeItem } from "./service";
import type { HomeLink } from "./service";

/*
 * Finance gaps (Fauzan, 23 Nov 2026, Finance study "Finance department in Prima: how it works and gaps"):
 *  D1  the Account Manager sits below the Finance Director and does what the FD delegates;
 *  D2  a second Finance person records salary, claim, advance and loan payouts (one prepares, another records paid);
 *  B1  each payout is looked for on the paying company's bank statement, like Finance payments;
 *  B2  the month-end "payroll paid but journal not posted" line comes from the real paid payroll, not test figures;
 *  D3  the FD confirms the Finance thresholds and sets each company's budget limit (due 18 January 2027).
 */

// ---------- D1: the Account Manager ----------

/** What the FD may delegate: look only, or act as data entry, deputy or team leader. Approving is never delegated. */
export type FinAmLevel = 'view' | 'data_entry' | 'deputy' | 'leader';
export const FIN_AM_LEVELS: FinAmLevel[] = ['view', 'data_entry', 'deputy', 'leader'];
export const FIN_AM_LEVEL_LABEL: Record<FinAmLevel, string> = {
  view: 'Look only',
  data_entry: 'Prepare and key in (like data entry)',
  deputy: 'Prepare and review (like a deputy)',
  leader: 'Prepare, review, record payments and payouts (like a team leader)',
};

export interface FinAmDelegation {
  userId: Id;
  name: string;
  level: FinAmLevel;
  /** The companies delegated; null = every company. */
  companies: Id[] | null;
  set: FinSign;
  history: { level: FinAmLevel; companies: Id[] | null; set: FinSign }[];
}

/** The Account Manager's Finance role from the FD's delegation on PWVSB's row (look only until delegated). */
export function finAmActor(group: Pick<FinStatus, 'amDelegations'> | null | undefined, userId: Id): FinActor {
  const d = (group?.amDelegations ?? []).find((x) => x.userId === userId);
  if (!d || d.level === 'view') return { kind: 'viewer', team: null, am: true, companies: d?.companies ?? null };
  return { kind: d.level, team: null, am: true, companies: d.companies };
}

/** A team leader for this company: the company's own team leader, or an Account Manager the FD delegated as leader. */
export function finLeaderFor(a: FinActor, f: Pick<FinStatus, 'team' | 'companyId'>): boolean {
  return isLead(a) || (a.kind === 'leader' && (a.am ? finCovers(a, f) : a.team === f.team));
}

// ---------- D3: the FD confirms the thresholds ----------

export interface FinSettingsConfirmation {
  /** The settings in force when confirmed (so a later change needs a fresh confirmation). */
  values: FinSettingsValues;
  sign: FinSign;
}

/** Fauzan, 23 Nov 2026: the FD confirms the limits and thresholds during the learning period, by 18 January 2027. */
export const FIN_CONFIRM_BY: IsoDate = '2027-01-18';

/** Whether the settings in force have been confirmed by the FD or the CEO since they last changed. */
export function finSettingsConfirmedNow(group: Pick<FinStatus, 'settingsConfirmed'> | null | undefined, values: FinSettingsValues): FinSettingsConfirmation | null {
  const last = (group?.settingsConfirmed ?? []).at(-1);
  if (!last) return null;
  return JSON.stringify(sortKeys(last.values)) === JSON.stringify(sortKeys(values)) ? last : null;
}
function sortKeys(v: object): Record<string, unknown> {
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
}

// ---------- D2, B1, B2: payouts ----------

export type FinPayoutSource = 'staff_pay' | 'guard_pay' | 'staff_claim' | 'guard_advance' | 'guard_loan';
export const FIN_PAYOUT_SOURCES: FinPayoutSource[] = ['staff_pay', 'guard_pay', 'staff_claim', 'guard_advance', 'guard_loan'];
export const FIN_PAYOUT_LABEL: Record<FinPayoutSource, string> = {
  staff_pay: 'Staff payroll',
  guard_pay: 'Guard payroll',
  staff_claim: 'Staff claim',
  guard_advance: 'Guard wage advance',
  guard_loan: 'Guard advance or loan',
};
/** Payroll payouts need their SQL Account journal entered and checked before the month closes (B2). */
export const FIN_PAYROLL_SOURCES: FinPayoutSource[] = ['staff_pay', 'guard_pay'];

export interface FinPayout {
  /** `${source}:${sourceId}` */
  id: Id;
  source: FinPayoutSource;
  sourceId: Id;
  label: string;
  /** What leaves the bank (net pay of the people paid by bank, or the claim, advance or loan amount). */
  amount: number;
  /** The company bank account it is paid from, picked by the preparer. */
  bankId: Id;
  prepared: FinSign;
  paid: (FinSign & { ref: string; on: IsoDate }) | null;
  /** Found on the bank statement (B1). */
  seen: { statementId: Id; lineId: Id; date: IsoDate } | null;
  /** Payroll only (B2): the SQL Account journal number, entered by Finance and checked by someone else. */
  journal: { no: string; entered: FinSign; checked: FinSign | null } | null;
}

export const finPayoutId = (source: FinPayoutSource, sourceId: Id) => `${source}:${sourceId}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Looks for each paid payout on the loaded statements of the account it was paid from (exact amount, within the match window). */
export function finMatchPayouts(payouts: FinPayout[], statements: FinStatement[], s: Pick<FinSettingsValues, 'matchDays'>, at: IsoDateTime) {
  const sts = statements.map((st) => ({ ...st, lines: [...st.lines] }));
  let found = 0;
  const seenIds = new Set(sts.flatMap((st) => st.lines.flatMap((l) => (l.match?.kind === 'payout' ? [l.match.payoutId] : []))));
  const out = payouts.map((p) => {
    if (!p.paid || p.seen || seenIds.has(p.id)) return p;
    const cands: { st: (typeof sts)[number]; i: number }[] = [];
    for (const st of sts)
      if (st.bankId === p.bankId)
        st.lines.forEach((l, i) => {
          if (!l.match && l.amount < 0 && Math.abs(-l.amount - p.amount) < 0.005 && Math.abs(daysBetween(p.paid!.on, l.date)) <= s.matchDays) cands.push({ st, i });
        });
    const key = norm(p.paid.ref);
    const byRef = key.length >= 4 ? cands.filter(({ st, i }) => norm(`${st.lines[i].ref} ${st.lines[i].description}`).includes(key)) : [];
    const pick = byRef.length === 1 ? byRef[0] : byRef.length === 0 && cands.length === 1 ? cands[0] : null;
    if (!pick) return p;
    const line = pick.st.lines[pick.i];
    pick.st.lines[pick.i] = { ...line, match: { kind: 'payout', payoutId: p.id, by: FIN_AUTO.by, at } };
    found += 1;
    return { ...p, seen: { statementId: pick.st.id, lineId: line.id, date: line.date } };
  });
  return { statements: sts, payouts: out, found };
}

/** Takes back what was found on a statement that is replaced or a line that is unmatched. */
export function finUnmatchPayouts(payouts: FinPayout[], hit: (m: { statementId: Id; lineId: Id }) => boolean): FinPayout[] {
  return payouts.map((p) => (p.seen && hit(p.seen) ? { ...p, seen: null } : p));
}

/** Payouts recorded paid but not on the paying account's statement, once that month's statement is loaded. */
export function finPayoutsUnseen(f: Pick<FinStatus, 'payouts' | 'statements'>, period?: string): FinPayout[] {
  return (f.payouts ?? []).filter((p) => {
    if (!p.paid || p.seen) return false;
    if (period && p.paid.on.slice(0, 7) !== period) return false;
    return (f.statements ?? []).some((st) => st.bankId === p.bankId && st.period === p.paid!.on.slice(0, 7));
  });
}

/** The month-end close lines for payouts (B1) and payroll journals (B2), from Prima's own records. */
export function finPayoutExceptions(f: Pick<FinStatus, 'payouts' | 'statements' | 'banks'>, period: string): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const end = periodEnd(period);
  const bankName = (id: Id) => {
    const b = f.banks.find((x) => x.id === id);
    return b ? `${b.bank} ${b.accountMasked}` : 'the paying account';
  };
  for (const p of finPayoutsUnseen(f, period))
    out.push({ key: `payout:${p.id}`, text: `${p.label} RM${p.amount.toFixed(2)} recorded paid on ${p.paid!.on} (ref ${p.paid!.ref}) is not on the ${bankName(p.bankId)} statement` });
  for (const p of f.payouts ?? []) {
    if (!FIN_PAYROLL_SOURCES.includes(p.source) || !p.paid || p.paid.on > end || p.paid.on.slice(0, 7) !== period) continue;
    if (!p.journal) out.push({ key: `journal:${p.id}`, text: `${p.label} was paid but its journal is not posted in SQL Account (enter the journal number)` });
    else if (!p.journal.checked) out.push({ key: `journal:${p.id}`, text: `${p.label}: journal ${p.journal.no} is waiting for someone else to check it in SQL Account` });
  }
  for (const p of f.payouts ?? [])
    if (!p.paid && p.prepared.at.slice(0, 10) <= end && p.prepared.at.slice(0, 7) === period)
      out.push({ key: `payoutwait:${p.id}`, text: `${p.label} RM${p.amount.toFixed(2)} was prepared for payment but not recorded paid` });
  return out;
}

/** One payable record, as Finance sees it. */
export interface FinPayable {
  source: FinPayoutSource;
  sourceId: Id;
  companyId: Id;
  label: string;
  amount: number;
  /** People who may not prepare or record it (the claimant). */
  excluded: Id[];
}

/**
 * Prepares and records salary, claim, advance and loan payouts (D2), keeps them on the paying company's Finance row,
 * looks for them on the bank statement (B1) and keeps the payroll journal check (B2). The pay steps in the service
 * (staff payroll, guard payroll, claims, advances, loans) call recordPaid in their own transaction.
 */
export class FinancePayoutsService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private desk: FinanceDeskService,
  ) {}

  private now(): IsoDateTime {
    return this.clock();
  }
  private sign(user: User, comment = ''): FinSign {
    return { by: user.name, byId: user.id, at: this.now(), comment };
  }

  /** The record Finance pays, when it is ready to be paid; null otherwise. */
  async payable(store: Store, source: FinPayoutSource, sourceId: Id): Promise<FinPayable | null> {
    if (source === 'staff_pay') {
      const r = await store.get('staffPayRuns', sourceId);
      if (!r || r.stage !== 'coo_approved') return null;
      return { source, sourceId, companyId: r.companyId, label: `${FIN_PAYOUT_LABEL.staff_pay} ${r.period}`, amount: r2(r.lines.reduce((n, l) => n + l.net, 0)), excluded: [] };
    }
    if (source === 'guard_pay') {
      const r = await store.get('guardPayRuns', sourceId);
      if (!r || r.stage !== 'approved' || r.trial) return null;
      const cash = new Set((r.cash ?? []).filter((c) => c.decision?.give).map((c) => c.personId));
      return { source, sourceId, companyId: r.companyId, label: `${FIN_PAYOUT_LABEL.guard_pay} ${r.period}`, amount: guardPayTotals(r.lines.filter((l) => !cash.has(l.personId))).net, excluded: [] };
    }
    if (source === 'staff_claim') {
      const c = await store.get('staffClaims', sourceId);
      if (!c || c.status !== 'approved' || c.paid) return null;
      return { source, sourceId, companyId: c.companyId, label: `${FIN_PAYOUT_LABEL.staff_claim}: ${c.personName}, ${c.kind.toLowerCase()} ${c.date}`, amount: r2(c.allowed), excluded: [c.userId] };
    }
    if (source === 'guard_advance') {
      const a = await store.get('guardPayAdvances', sourceId);
      if (!a || a.status !== 'approved') return null;
      return { source, sourceId, companyId: a.companyId, label: `${FIN_PAYOUT_LABEL.guard_advance} ${a.period}, ${a.staffNo}`, amount: r2(a.amount), excluded: [] };
    }
    const l = await store.get('guardLoans', sourceId);
    if (!l || l.status !== 'approved') return null;
    return { source, sourceId, companyId: l.companyId, label: `${l.kind === 'loan' ? 'Guard loan' : 'Guard advance'}, ${l.staffNo}`, amount: r2(l.amount), excluded: [] };
  }

  private isSource(v: unknown): v is FinPayoutSource {
    return typeof v === 'string' && (FIN_PAYOUT_SOURCES as string[]).includes(v);
  }

  /** Step 1 (D2): a Finance person prepares the bank payment: the account it goes from, and a note. */
  async prepare(user: User, input: { source?: unknown; sourceId?: unknown; bankId?: unknown; note?: unknown }) {
    if (!this.isSource(input.source)) throw new BadRequest('Which kind of payout?');
    const source = input.source;
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId.slice(0, 160) : '';
    return this.store.transaction(async (tx) => {
      const pay = await this.payable(tx, source, sourceId);
      if (!pay) throw new BadRequest('This is not waiting to be paid (it must be approved, and not paid already).');
      const a = await this.desk.actorFor(user, tx);
      if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance prepares payouts)');
      if (pay.excluded.includes(user.id)) throw new BadRequest('Another Finance person prepares your own claim.');
      const f = await this.desk.row(tx, user, a, pay.companyId);
      const bank = f.banks.find((b) => b.id === input.bankId);
      if (!bank) throw new BadRequest('Pick the company bank account it is paid from.');
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) : '';
      const id = finPayoutId(source, sourceId);
      const list = f.payouts ?? [];
      const have = list.find((p) => p.id === id);
      if (have?.paid) throw new BadRequest('This payout is already recorded paid.');
      const row: FinPayout = { id, source, sourceId, label: pay.label, amount: pay.amount, bankId: bank.id, prepared: this.sign(user, note), paid: null, seen: null, journal: null };
      await tx.update('finStatus', f.id, { payouts: [...list.filter((p) => p.id !== id), row].slice(-600) });
      await this.desk.log(tx, user, f, 'finance.payout.prepared', `${pay.label} RM${pay.amount.toFixed(2)} prepared for payment from ${bank.bank} ${bank.accountMasked}${have ? ' (prepared again)' : ''}${note ? `: ${note}` : ''}`);
      return row;
    });
  }

  /**
   * Step 2 (D2): another Finance person, at team leader level, records it paid. Called by the pay step of the source
   * record inside its own transaction. Refused unless someone else prepared it for the same amount.
   */
  async recordPaid(tx: Store, user: User, source: FinPayoutSource, sourceId: Id, ref: string, on: IsoDate): Promise<FinPayout | null> {
    const pay = await this.payable(tx, source, sourceId);
    if (!pay) throw new BadRequest('This is not waiting to be paid.');
    const base = finActor(user);
    if (!base) throw new AccessDenied('view', '(Finance records payouts)');
    // An employer that is not one of the group's companies in Prima (Merdeka Network pays the IT staff in the pilot)
    // keeps no Finance books here: the pay step's own checks apply and nothing is matched on a statement.
    if (!(await tx.get('companies', pay.companyId)) && !(await tx.get('finStatus', `fin-${pay.companyId}`))) return null;
    const a = await this.desk.actorFor(user, tx);
    const f = await this.desk.row(tx, user, a, pay.companyId);
    if (!finLeaderFor(a, f)) throw new AccessDenied('view', "(the company's Finance team leader, an Account Manager the FD delegated as leader, the Finance Director or the CEO records a payout paid)");
    if (pay.excluded.includes(user.id)) throw new BadRequest('Another person pays your own claim.');
    const id = finPayoutId(source, sourceId);
    const list = f.payouts ?? [];
    const p = list.find((x) => x.id === id);
    if (!p) throw new BadRequest('A Finance person prepares the payment first (Finance > Checks > Paying out > Salary and claim payouts), then someone else records it paid.');
    if (p.paid) throw new BadRequest('This payout is already recorded paid.');
    if (p.prepared.byId === user.id) throw new BadRequest('Someone other than the person who prepared the payment records it paid.');
    if (Math.abs(p.amount - pay.amount) >= 0.005) throw new BadRequest(`The amount changed since it was prepared (RM${p.amount.toFixed(2)}, now RM${pay.amount.toFixed(2)}): prepare it again.`);
    const paid = { ...this.sign(user), ref, on };
    let next = list.map((x) => (x.id === id ? { ...x, paid } : x));
    const s = await this.desk.settings(tx);
    const m = finMatchPayouts(next, f.statements ?? [], s, this.now());
    next = m.payouts;
    await tx.update('finStatus', f.id, { payouts: next, ...(m.found ? { statements: m.statements } : {}) });
    await this.desk.log(tx, user, f, 'finance.payout.paid', `${p.label} RM${p.amount.toFixed(2)} recorded paid on ${on}, bank reference ${ref}${m.found ? ', found on the bank statement' : ''}`);
    return next.find((x) => x.id === id)!;
  }

  /** B2: Finance enters the SQL Account journal number of a paid payroll; someone else checks it in SQL Account. */
  async journal(user: User, companyId: Id, payoutId: Id, action: 'enter' | 'check', input: { no?: unknown; comment?: unknown }) {
    return this.store.transaction(async (tx) => {
      const a = await this.desk.actorFor(user, tx);
      if (a.kind === 'viewer' || a.kind === 'coo') throw new AccessDenied('view', '(Finance)');
      const f = await this.desk.row(tx, user, a, companyId);
      const list = f.payouts ?? [];
      const p = list.find((x) => x.id === payoutId);
      if (!p) throw new NotFound('Payout');
      if (!FIN_PAYROLL_SOURCES.includes(p.source) || !p.paid) throw new BadRequest('Only a paid payroll has a journal to post.');
      let journal: FinPayout['journal'];
      let summary: string;
      if (action === 'enter') {
        const no = typeof input.no === 'string' ? input.no.trim().slice(0, 40) : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9\-/.]{1,39}$/.test(no)) throw new BadRequest('Type the SQL Account journal number (letters, digits, - / . only).');
        if (p.journal?.checked) throw new BadRequest('The journal is already checked.');
        journal = { no, entered: this.sign(user), checked: null };
        summary = `${p.label}: SQL Account journal ${no} entered; waits for a second person's check`;
      } else {
        if (!p.journal || p.journal.checked) throw new BadRequest('No journal is waiting for a check.');
        if (p.journal.entered.byId === user.id) throw new BadRequest('Someone other than the person who entered the journal number checks it.');
        if (!(isLead(a) || a.kind === 'leader' || a.kind === 'deputy')) throw new AccessDenied('view', '(the deputy, the team leader, the Finance Director or the CEO checks)');
        const comment = requireComment(input.comment, 'check the journal (how you checked it)');
        journal = { ...p.journal, checked: this.sign(user, comment) };
        summary = `${p.label}: SQL Account journal ${p.journal.no} checked: ${comment}`;
      }
      await tx.update('finStatus', f.id, { payouts: list.map((x) => (x.id === p.id ? { ...x, journal } : x)) });
      await this.desk.log(tx, user, f, `finance.payout.journal.${action}`, summary);
      return { ...p, journal };
    });
  }

  /** What is waiting to be prepared, waiting to be recorded paid, not seen on the statement, and journals to post. */
  async view(user: User, companyId: Id) {
    const a = await this.desk.actorFor(user);
    const f = await this.store.get('finStatus', `fin-${companyId}`);
    if (!f || !(await this.desk.companies(user)).includes(companyId) || !finCovers(a, f)) throw new NotFound('Company books');
    const waiting: FinPayable[] = [];
    const add = async (source: FinPayoutSource, ids: Id[]) => {
      for (const id of ids) {
        const p = await this.payable(this.store, source, id);
        if (p && p.companyId === companyId) waiting.push(p);
      }
    };
    const own = { companyId: [companyId] };
    await add('staff_pay', (await this.store.list('staffPayRuns', own)).filter((r) => r.stage === 'coo_approved').map((r) => r.id));
    await add('staff_claim', (await this.store.list('staffClaims', own)).filter((c) => c.status === 'approved' && !c.paid).map((c) => c.id));
    if (await hasTable(this.store, 'guardPayRuns')) await add('guard_pay', (await this.store.list('guardPayRuns', own)).filter((r) => r.stage === 'approved' && !r.trial).map((r) => r.id));
    if (await hasTable(this.store, 'guardPayAdvances')) await add('guard_advance', (await this.store.list('guardPayAdvances', own)).filter((x) => x.status === 'approved').map((x) => x.id));
    if (await hasTable(this.store, 'guardLoans')) await add('guard_loan', (await this.store.list('guardLoans', own)).filter((x) => x.status === 'approved').map((x) => x.id));
    const payouts = f.payouts ?? [];
    const unseen = new Set(finPayoutsUnseen(f).map((p) => p.id));
    const acts = a.kind !== 'viewer' && a.kind !== 'coo';
    return {
      banks: f.banks.map((b) => ({ id: b.id, label: `${b.bank} ${b.accountMasked}`, purpose: b.purpose })),
      waiting: waiting.map((w) => {
        const p = payouts.find((x) => x.id === finPayoutId(w.source, w.sourceId) && !x.paid) ?? null;
        return {
          ...w,
          prepared: p ? { by: p.prepared.by, at: p.prepared.at, bankId: p.bankId, note: p.prepared.comment, amount: p.amount } : null,
          mayPrepare: acts && !w.excluded.includes(user.id),
          mayRecord: !!p && p.prepared.byId !== user.id && finLeaderFor(a, f) && !w.excluded.includes(user.id) && Math.abs(p.amount - w.amount) < 0.005,
        };
      }),
      paid: payouts
        .filter((p) => p.paid && daysBetween(p.paid.on, this.now().slice(0, 10)) <= 92)
        .sort((x, y) => y.paid!.on.localeCompare(x.paid!.on))
        .map((p) => ({
          ...p,
          notSeen: unseen.has(p.id),
          mayEnterJournal: acts && FIN_PAYROLL_SOURCES.includes(p.source) && !p.journal?.checked,
          mayCheckJournal: !!p.journal && !p.journal.checked && p.journal.entered.byId !== user.id && (isLead(a) || a.kind === 'leader' || a.kind === 'deputy'),
        })),
      rule: 'One Finance person prepares the payment (the account it goes from); another, at team leader level, records it paid with the bank reference. Prima then looks for it on the bank statement. A paid payroll needs its SQL Account journal number, checked by someone else, before the month closes.',
    };
  }

  /** Counts for Finance's home: payouts to prepare or record, not seen on the statement, and journals waiting. */
  async counts(user: User): Promise<{ toPrepare: number; toRecord: number; notSeen: number; journals: number } | null> {
    const base = finActor(user);
    if (!base || base.kind === 'viewer' && !base.am) return null;
    const a = await this.desk.actorFor(user);
    if (a.kind === 'viewer' || a.kind === 'coo') return null;
    const ids = await this.desk.companies(user);
    const rows = (await this.store.list('finStatus', { companyId: ids })).filter((f) => ids.includes(f.companyId) && finCovers(a, f));
    let notSeen = 0;
    let journals = 0;
    let toRecord = 0;
    for (const f of rows) {
      notSeen += finPayoutsUnseen(f).length;
      journals += (f.payouts ?? []).filter((p) => FIN_PAYROLL_SOURCES.includes(p.source) && p.paid && !p.journal?.checked).length;
      toRecord += (f.payouts ?? []).filter((p) => !p.paid && p.prepared.byId !== user.id && finLeaderFor(a, f)).length;
    }
    const mine = new Set(rows.map((f) => f.companyId));
    let toPrepare = 0;
    const prepared = new Set(rows.flatMap((f) => (f.payouts ?? []).filter((p) => !p.paid).map((p) => p.id)));
    const runs = (await this.store.list('staffPayRuns', { companyId: [...mine] })).filter((r) => r.stage === 'coo_approved' && mine.has(r.companyId));
    const claims = (await this.store.list('staffClaims', { companyId: [...mine] })).filter((c) => c.status === 'approved' && !c.paid && mine.has(c.companyId) && c.userId !== user.id);
    toPrepare += runs.filter((r) => !prepared.has(finPayoutId('staff_pay', r.id))).length + claims.filter((c) => !prepared.has(finPayoutId('staff_claim', c.id))).length;
    if (await hasTable(this.store, 'guardPayRuns'))
      toPrepare += (await this.store.list('guardPayRuns', { companyId: [...mine] })).filter((r) => r.stage === 'approved' && !r.trial && mine.has(r.companyId) && !prepared.has(finPayoutId('guard_pay', r.id))).length;
    return { toPrepare, toRecord, notSeen, journals };
  }
}

/** Finance home items for payouts (D2, B1, B2) and the FD's confirmation (D3). */
export async function finPayoutHomeItems(svc: FinancePayoutsService, desk: FinanceDeskService, store: Store, user: User, today: IsoDate): Promise<HomeItem[]> {
  const items: HomeItem[] = [];
  const go: HomeLink = { view: 'finance', tab: 'checks', section: 'out' };
  const c = await svc.counts(user).catch(() => null);
  if (c?.toRecord) items.push({ tone: 'warn', tag: 'Finance', title: `${c.toRecord} salary or claim payout(s) prepared, to record paid`, detail: 'Pay in the bank portal, then record the bank reference. Someone other than the preparer records it.', go });
  if (c?.toPrepare) items.push({ tone: 'warn', tag: 'Finance', title: `${c.toPrepare} approved payroll or claim(s) to prepare for payment`, detail: 'Pick the account it is paid from; another person records it paid', go });
  if (c?.notSeen) items.push({ tone: 'crit', tag: 'Finance', title: `${c.notSeen} payout(s) recorded paid but not on the bank statement`, detail: 'Salary, claim, advance or loan: check the bank reference and the account', go: { view: 'finance', tab: 'checks', section: 'bank' } });
  if (c?.journals) items.push({ tone: 'warn', tag: 'Finance', title: `${c.journals} paid payroll(s) without a checked SQL Account journal`, detail: 'Enter the journal number; someone else checks it. The month cannot close without it.', go });
  const a = await desk.actorOrNull(user).catch(() => null);
  if (a && isLead(a)) {
    const row = await store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`);
    const values = await desk.settings();
    if (!finSettingsConfirmedNow(row, values))
      items.push({
        tone: today > FIN_CONFIRM_BY ? 'crit' : 'warn',
        tag: 'Finance',
        title: 'Confirm the Finance limits and thresholds',
        detail: `Pack days, match window, variance, budget limits and the rest in Finance Settings: confirm them as they stand, or change them, by ${FIN_CONFIRM_BY}`,
        go: { view: 'finance', tab: 'settings' },
      });
  }
  return items;
}

async function hasTable(store: Store, name: TableName): Promise<boolean> {
  return store.hasTable ? store.hasTable(name) : true;
}

/** The Account Manager delegation, set by the FD or the CEO on PWVSB's row (D1). */
export async function finSetAmDelegation(
  tx: Store,
  desk: FinanceDeskService,
  user: User,
  input: { userId?: unknown; level?: unknown; companies?: unknown; comment?: unknown },
  now: IsoDateTime,
): Promise<FinAmDelegation> {
  const a = await desk.actorFor(user, tx);
  if (!isLead(a)) throw new AccessDenied('view', '(only the Finance Director or the CEO delegates to the Account Manager)');
  const comment = requireComment(input.comment, 'delegate (what and why)');
  const target = typeof input.userId === 'string' ? await tx.get('users', input.userId) : null;
  if (!target || target.department !== 'finance' || !target.financeAccountManager || target.integration) throw new NotFound('Account Manager');
  const level = input.level;
  if (typeof level !== 'string' || !(FIN_AM_LEVELS as string[]).includes(level)) throw new BadRequest('Pick what the Account Manager may do.');
  let companies: Id[] | null = null;
  if (input.companies != null && input.companies !== 'all') {
    if (!Array.isArray(input.companies) || !input.companies.length) throw new BadRequest('Pick the companies, or every company.');
    const ids = await desk.companies(user);
    companies = [...new Set(input.companies.map(String))];
    for (const c of companies) if (!ids.includes(c)) throw new NotFound('Company books');
    companies.sort();
  }
  const id = `fin-${GROUP_EMPLOYER_ID}`;
  await tx.lock?.('finStatus', id);
  const row = await tx.get('finStatus', id);
  if (!row) throw new NotFound('Group Finance settings');
  const set: FinSign = { by: user.name, byId: user.id, at: now, comment };
  const list = row.amDelegations ?? [];
  const prev = list.find((d) => d.userId === target.id);
  const next: FinAmDelegation = {
    userId: target.id,
    name: target.name,
    level: level as FinAmLevel,
    companies,
    set,
    history: [...(prev?.history ?? []), ...(prev ? [{ level: prev.level, companies: prev.companies, set: prev.set }] : [])].slice(-30),
  };
  await tx.update('finStatus', id, { amDelegations: [...list.filter((d) => d.userId !== target.id), next] });
  await tx.audit({
    at: now,
    actor: user.name,
    companyId: null,
    action: 'finance.am.delegate',
    entity: 'fin_status',
    entityId: id,
    summary: `Account Manager ${target.name}: ${FIN_AM_LEVEL_LABEL[level as FinAmLevel]}, ${companies ? `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} (${companies.join(', ')})` : 'every company'}. ${comment}`.slice(0, 900),
  });
  return next;
}
