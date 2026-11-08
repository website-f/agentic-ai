import { FIN_SUBJECTS } from "./finance";
import { finApproverFor } from "./finance";
import { isoDate } from "./finance";
import { noSecrets } from "./finance";
import { requireComment } from "./finance";
import { requireReason } from "./finance";
import { text } from "./finance";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import { AccessDenied } from "./access";
import { centralEmployerName } from "./access";
import { isOwnerAdmin } from "./access";
import { tenantCompanyIds } from "./access";
import type { HomeItem } from "./service";
import type { FinRequest } from "./types";
import type { FinRequestStep } from "./types";
import type { FinStatus } from "./types";
import type { FinSubject } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";


export type FinRequestAction = 'head' | 'verify' | 'approve' | 'return' | 'resubmit' | 'cancel';

const LABEL: Record<FinSubject, string> = {
  finance: 'Finance',
  operations: 'Operations',
  it: 'IT',
  fwm: 'Foreign Worker Management',
  inventory: 'Procurement & Inventory',
  transport: 'Transport',
  goodwill: 'Goodwill Empire',
};

/** Who heads the department a request belongs to; null = no department step (Finance). */
export function finRequestHeadFits(user: User, r: Pick<FinRequest, 'subject' | 'sector'>): boolean {
  if (user.role !== 'pwvsb_officer' && user.role !== 'director') return false;
  switch (r.subject) {
    case 'operations':
      return r.sector === 'government' ? user.opsTier === 'ogm' : user.opsTier === 'ops_director';
    case 'inventory':
    case 'goodwill':
      return user.opsTier === 'ogm';
    case 'it':
      return user.department === 'it' && user.itRole === 'manager';
    case 'fwm':
      return user.department === 'fwm' && user.fwmRole === 'manager';
    case 'transport':
      return user.department === 'transport' && !user.financeRole;
    default:
      return false;
  }
}
/** Whether the Payment requests screen belongs in this person's menu: a department head, a Finance checker, or a final approver. */
export function finRequestInMenu(user: User): boolean {
  if (user.integration) return false;
  if (user.role === 'company_manager') return true;
  if ((['operations', 'inventory', 'it', 'fwm', 'transport'] as FinSubject[]).some((subject) => finRequestHeadFits(user, { subject, sector: 'government' }) || finRequestHeadFits(user, { subject, sector: 'private' })))
    return true;
  if (user.role === 'pwvsb_officer' && (user.leadership === 'finance_director' || (user.department === 'finance' && (user.financeRole === 'leader' || user.financeRole === 'deputy'))))
    return true;
  return (user.opsTier === 'ceo' || user.opsTier === 'coo') && (user.role === 'director' || user.role === 'pwvsb_officer');
}
export function finRequestHasHead(subject: FinSubject): boolean {
  return ['operations', 'inventory', 'goodwill', 'it', 'fwm', 'transport'].includes(subject);
}
const HEAD_NAME: Partial<Record<FinSubject, string>> = {
  inventory: 'Operations General Manager', goodwill: 'Operations General Manager',
  it: 'IT Manager',
  fwm: 'FWM Manager',
  transport: 'Head of Transport',
};
export function finRequestHeadName(r: Pick<FinRequest, 'subject' | 'sector'>): string | null {
  if (!finRequestHasHead(r.subject)) return null;
  if (r.subject === 'operations') return r.sector === 'government' ? 'Operations General Manager (government)' : 'Operations Director (private)';
  return HEAD_NAME[r.subject] ?? null;
}

const isCeo = (u: User) => u.opsTier === 'ceo' && (u.role === 'director' || u.role === 'pwvsb_officer');
const isCoo = (u: User) => u.opsTier === 'coo' && u.role === 'pwvsb_officer';
const isFd = (u: User) => u.role === 'pwvsb_officer' && u.leadership === 'finance_director';
const finChecker = (u: User, f: FinStatus) =>
  isFd(u) || (u.role === 'pwvsb_officer' && u.department === 'finance' && u.financeTeam === f.team && (u.financeRole === 'leader' || u.financeRole === 'deputy'));
/** The final approver: the COO or the CEO for the COO's departments; the Finance Director or the CEO for Finance. */
export function finRequestFinalFits(u: User, subject: FinSubject): boolean {
  return finApproverFor(subject) === 'coo' ? isCoo(u) || isCeo(u) : isFd(u) || isCeo(u);
}
/**
 * The company head creates requests for their own company; the owner (P78, master administrator) may create one for
 * any company. The creator never approves it: they are in actedIds, so every later step needs someone else.
 */
const creatorFits = (u: User, companyId: Id) => (u.role === 'company_manager' && u.companyIds.includes(companyId)) || isOwnerAdmin(u);

/** Everyone who did a step on this round of the request (since the last resubmission), and the creator. */
function actedIds(r: FinRequest): Id[] {
  const ids = [r.created.byId];
  for (const s of r.steps) {
    if (s.step === 'resubmitted' || s.step === 'returned') ids.length = 1;
    else ids.push(s.byId);
  }
  return ids;
}

export function finRequestMay(user: User, f: FinStatus, r: FinRequest): FinRequestAction[] {
  const may: FinRequestAction[] = [];
  const acted = actedIds(r);
  const fresh = !acted.includes(user.id);
  if (r.status === 'head_review' && fresh && finRequestHeadFits(user, r)) may.push('head', 'return');
  if (r.status === 'finance_verify' && fresh && finChecker(user, f)) may.push('verify', 'return');
  if (r.status === 'final_approval' && fresh && finRequestFinalFits(user, r.subject)) may.push('approve', 'return');
  if (r.status === 'returned' && r.created.byId === user.id) may.push('resubmit');
  if (['head_review', 'finance_verify', 'final_approval', 'returned', 'approved'].includes(r.status) && !r.paymentId && (r.created.byId === user.id || isFd(user) || isCeo(user)))
    may.push('cancel');
  return may;
}

const firstStatus = (subject: FinSubject): FinRequest['status'] => (finRequestHasHead(subject) ? 'head_review' : 'finance_verify');

export class FinanceRequestService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
  ) {}

  private now(): IsoDateTime {
    return this.clock();
  }
  private today(): IsoDate {
    return dateOf(this.clock());
  }

  /** Who may see requests at all: company heads (their companies), department heads, Finance, the FD, the COO, the CEO. */
  private sees(u: User, f: FinStatus, r: FinRequest): boolean {
    if (isCeo(u) || isFd(u)) return true;
    if (isCoo(u)) return finApproverFor(r.subject) === 'coo';
    if (u.role === 'company_manager') return u.companyIds.includes(f.companyId);
    if (u.role === 'pwvsb_officer' && u.department === 'finance') return u.financeTeam === f.team;
    return finRequestHeadFits(u, r);
  }

  private async rows(user: User): Promise<FinStatus[]> {
    const ids = tenantCompanyIds(user, await this.store.list('grants'), this.today());
    return this.store.list('finStatus', { companyId: ids });
  }

  async list(user: User) {
    if (user.integration) throw new AccessDenied('view', '(payment requests)');
    const out = [];
    const rows = await this.rows(user);
    const companies = await this.store.list('companies', { id: rows.map((f) => f.companyId) });
    const nameOf = (id: Id) => centralEmployerName(id) ?? companies.find((c) => c.id === id)?.name ?? id;
    for (const f of rows)
      for (const r of f.requests ?? [])
        if (this.sees(user, f, r))
          out.push({
            ...r,
            companyName: nameOf(f.companyId),
            subjectLabel: LABEL[r.subject],
            headName: finRequestHeadName(r),
            finalName: finApproverFor(r.subject) === 'coo' ? 'COO or CEO' : 'Finance Director or CEO',
            may: finRequestMay(user, f, r),
          });
    const creates = isOwnerAdmin(user) ? rows.map((f) => f.companyId) : user.role === 'company_manager' ? user.companyIds : [];
    return {
      requests: out.sort((a, b) => b.created.at.localeCompare(a.created.at)),
      canCreate: creates,
      /** Names for the company picker (the owner may create for any company). */
      companyNames: Object.fromEntries(creates.map((id) => [id, nameOf(id)])) as Record<Id, string>,
      subjects: FIN_SUBJECTS.map((s) => ({ id: s, label: LABEL[s], head: finRequestHeadName({ subject: s, sector: s === 'operations' ? 'government' : null }), final: finApproverFor(s) === 'coo' ? 'COO or CEO' : 'Finance Director or CEO' })),
    };
  }

  private fields(input: Record<string, unknown>) {
    const subject = input.subject as FinSubject;
    if (!FIN_SUBJECTS.includes(subject)) throw new BadRequest(`Say what it is for: one of ${FIN_SUBJECTS.join(', ')}.`);
    const sector: FinRequest['sector'] = subject === 'operations' ? (input.sector === 'government' || input.sector === 'private' ? input.sector : null) : null;
    if (subject === 'operations' && !sector) throw new BadRequest('Operations: is it for government or private sites? (It decides which operations head approves.)');
    const title = noSecrets(text(input.title, 'What the payment is', 3, 160), 'Title');
    const purpose = noSecrets(text(input.purpose, 'Why it is needed', 10, 1000), 'Purpose');
    const amount = typeof input.amount === 'number' ? input.amount : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequest('Amount must be more than RM0.00.');
    if (amount > RULES.financePayments.value.maxAmount) throw new BadRequest('That amount must be split or handled outside Prima.');
    const payee = noSecrets(text(input.payee, 'Who is paid', 2, 160), 'Payee');
    const dueOn = isoDate(input.dueOn, 'Needed by');
    const calc = noSecrets(text(input.calc, 'How the amount was worked out (Finance checks it)', 5, 2000), 'Calculation');
    if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new BadRequest('Attach at least one supporting document.');
    if (input.evidence.length > 10) throw new BadRequest('At most 10 supporting documents.');
    const evidence = input.evidence.map((e, i) => noSecrets(text(e, `Document ${i + 1}`, 2, 300), `Document ${i + 1}`));
    return { subject, sector, title, purpose, amount: Math.round(amount * 100) / 100, payee, dueOn, calc, evidence };
  }

  private mk(user: User, step: FinRequestStep['step'], comment: string): FinRequestStep {
    return { step, by: user.name, byId: user.id, at: this.now(), comment };
  }

  private async load(tx: Store, user: User, companyId: Id) {
    if (typeof companyId !== 'string' || companyId.length > 120) throw new NotFound('Company');
    if (!tenantCompanyIds(user, await tx.list('grants'), this.today()).includes(companyId)) throw new NotFound('Company');
    await tx.lock?.('finStatus', `fin-${companyId}`);
    const f = await tx.get('finStatus', `fin-${companyId}`);
    if (!f) throw new NotFound('Company books');
    return f;
  }

  private async audit(tx: Store, user: User, f: FinStatus, action: string, summary: string) {
    await tx.audit({ at: this.now(), actor: user.name, companyId: f.companyId, action, entity: 'fin_status', entityId: f.id, summary: summary.slice(0, 900) });
  }

  /** The company head asks for a payment and says what it is for. */
  async create(user: User, companyId: Id, input: Record<string, unknown>) {
    return this.store.transaction(async (tx) => {
      if (!creatorFits(user, companyId)) throw new AccessDenied('view', '(the company head creates payment requests for their own company)');
      const f = await this.load(tx, user, companyId);
      const fields = this.fields(input);
      const list = f.requests ?? [];
      const r: FinRequest = {
        id: `req-${f.companyId}-${this.today().replace(/-/g, '')}-${String(list.length + 1).padStart(3, '0')}`,
        companyId: f.companyId,
        ...fields,
        status: firstStatus(fields.subject),
        created: { by: user.name, byId: user.id, at: this.now(), comment: '' },
        steps: [],
        paymentId: null,
      };
      await tx.update('finStatus', f.id, { requests: [...list, r] });
      await this.audit(tx, user, f, 'finance.request.created', `Payment request ${r.id} (${LABEL[r.subject]}${r.sector ? `, ${r.sector}` : ''}) ${r.title} RM${r.amount.toFixed(2)} to ${r.payee}.`);
      return r;
    });
  }

  async step(user: User, companyId: Id, requestId: Id, action: FinRequestAction, input: Record<string, unknown> = {}) {
    return this.store.transaction(async (tx) => {
      const f = await this.load(tx, user, companyId);
      const list = f.requests ?? [];
      const r = list.find((x) => x.id === requestId);
      if (!r || !this.sees(user, f, r)) throw new NotFound('Payment request');
      const may = finRequestMay(user, f, r);
      if (!may.includes(action)) {
        const why = actedIds(r).includes(user.id)
          ? '(nobody acts twice on one request, and the company head who created it never approves it)'
          : `(the request is ${r.status.replace('_', ' ')}; ${action} is not open to you)`;
        throw new AccessDenied('view', why);
      }
      let next: FinRequest;
      if (action === 'head') {
        next = { ...r, status: 'finance_verify', steps: [...r.steps, this.mk(user, 'head_approved', requireComment(input.comment))] };
      } else if (action === 'verify') {
        next = { ...r, status: 'final_approval', steps: [...r.steps, this.mk(user, 'verified', requireComment(input.comment, 'confirm the calculation'))] };
      } else if (action === 'approve') {
        next = { ...r, status: 'approved', steps: [...r.steps, this.mk(user, 'approved', requireComment(input.comment))] };
      } else if (action === 'return') {
        next = { ...r, status: 'returned', steps: [...r.steps, this.mk(user, 'returned', requireReason(input.comment, 'return it'))] };
      } else if (action === 'resubmit') {
        // A correction keeps every document already attached (Arisha main's review, 2 Nov 2026); new ones are added.
        const added = Array.isArray(input.evidence) ? input.evidence.filter((e) => !r.evidence.includes(e as string)) : [];
        const fields = this.fields({ ...r, ...input, evidence: [...r.evidence, ...added] });
        const changes = [
          r.title !== fields.title ? `title "${r.title}" to "${fields.title}"` : '',
          Math.abs(r.amount - fields.amount) >= 0.005 ? `amount RM${r.amount.toFixed(2)} to RM${fields.amount.toFixed(2)}` : '',
          r.payee !== fields.payee ? `payee ${r.payee} to ${fields.payee}` : '',
          r.dueOn !== fields.dueOn ? `needed by ${r.dueOn} to ${fields.dueOn}` : '',
          r.purpose !== fields.purpose ? 'purpose' : '',
          r.calc !== fields.calc ? 'calculation' : '',
          r.subject !== fields.subject || r.sector !== fields.sector ? `for ${fields.subject}${fields.sector ? ` (${fields.sector})` : ''}` : '',
          added.length ? `documents added: ${fields.evidence.filter((e) => !r.evidence.includes(e)).join(', ')}` : '',
        ].filter(Boolean);
        if (r.paymentId && Math.abs(fields.amount - r.amount) >= 0.005) throw new BadRequest('A payment is already prepared for this request; the amount cannot change. Cancel the payment first.');
        next = { ...r, ...fields, status: firstStatus(fields.subject), steps: [...r.steps, this.mk(user, 'resubmitted', [typeof input.comment === 'string' ? input.comment.trim() : '', changes.length ? `Changed: ${changes.join('; ')}` : ''].filter(Boolean).join('. ').slice(0, 500))] };
      } else {
        next = { ...r, status: 'cancelled', steps: [...r.steps, this.mk(user, 'cancelled', requireReason(input.comment, 'cancel it'))] };
      }
      await tx.update('finStatus', f.id, { requests: list.map((x) => (x.id === r.id ? next : x)) });
      await this.audit(tx, user, f, `finance.request.${action}`, `Payment request ${r.id} ${r.title} RM${next.amount.toFixed(2)}: ${action}${next.steps.length ? ` (${next.steps[next.steps.length - 1].comment})` : ''}.`);
      return next;
    });
  }

  /** Home: whoever is next on a request is told; the creator is told of returns. */
  async home(user: User): Promise<HomeItem[]> {
    if (user.integration) return [];
    let rows: FinStatus[];
    try {
      rows = await this.rows(user);
    } catch {
      return [];
    }
    let next = 0;
    let back = 0;
    for (const f of rows)
      for (const r of f.requests ?? []) {
        if (!this.sees(user, f, r)) continue;
        const may = finRequestMay(user, f, r);
        if (may.some((m) => m === 'head' || m === 'verify' || m === 'approve')) next += 1;
        if (may.includes('resubmit')) back += 1;
      }
    const items: HomeItem[] = [];
    if (next) items.push({ tone: 'warn', tag: 'Payment requests', title: `${next} payment request(s) waiting for you`, detail: 'Approve or check with a comment, or return', go: { view: 'payreq' } });
    if (back) items.push({ tone: 'warn', tag: 'Payment requests', title: `${back} payment request(s) returned to you`, detail: 'Fix and resubmit; the whole chain checks it again', go: { view: 'payreq' } });
    return items;
  }
}