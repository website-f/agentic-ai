// Merdeka Network IT policies, the records part (Fitri package Part Q6-Q24, Fauzan's answers 13-14 Nov 2026): purchase
// requests from any department, the technical assessment, quote details and recommendation, Finance's budget check,
// receiving (GRN) and quarantine, register details before handover, the disposal record with three approvals, the data
// wipe log, refurbishment and end-of-life reviews, the rental agreement per company, the Microsoft 365 account register
// and requests, new domains and domain security, and the IP register. One table (prima.it_policy_recs) holds them;
// each record keeps an append-only history. Records are what IT and the approvers wrote: a ticked box or a saved
// setting is never proof that Microsoft 365, a registrar or a vendor did anything. Synthetic test data only.
import { AccessDenied } from './access';
import { BadRequest, NotFound } from './service';
import type { PrimaService } from './service';
import type { Store } from './store';
import { RULES } from './rules';
import { addDays, dateOf, daysBetween, toMs } from './time';
import { registerWall } from './walls';
import type { Id, IsoDate, IsoDateTime, ItAsset, ItAssetKind, ItProof, ItPurchase, User } from './types';
import type { ProofInput } from './service';
import { isWorkingDay } from './it-policies';

export type ItPolicyKind =
  | 'settings'
  | 'request'
  | 'assessment'
  | 'quoteInfo'
  | 'budget'
  | 'grn'
  | 'assetDetail'
  | 'disposal'
  | 'wipe'
  | 'refurb'
  | 'eol'
  | 'agreement'
  | 'rentalReturn'
  | 'm365'
  | 'acctReq'
  | 'domainReq'
  | 'domainSec'
  | 'ip'
  | 'webProject';
export const IT_POLICY_KINDS: ItPolicyKind[] = ['settings', 'request', 'assessment', 'quoteInfo', 'budget', 'grn', 'assetDetail', 'disposal', 'wipe', 'refurb', 'eol', 'agreement', 'rentalReturn', 'm365', 'acctReq', 'domainReq', 'domainSec', 'ip', 'webProject'];

export interface ItPolicyStep {
  byId: Id;
  by: string;
  at: IsoDateTime;
  reason: string;
  decision?: 'approve' | 'reject';
}

/** One policy record. `d` holds the fields of its kind (see the ops below); `history` only grows. */
export interface ItPolicyRec {
  id: Id;
  kind: ItPolicyKind;
  ref: string;
  status: string;
  at: IsoDateTime;
  byId: Id;
  by: string;
  version: number;
  purchaseId?: Id | null;
  assetId?: Id | null;
  companyId?: Id | null;
  requesterId?: Id | null;
  /** Account requests: the line manager who supports it (they read and update it under the database wall). */
  lineManagerId?: Id | null;
  d: Record<string, unknown>;
  proof?: ItProof[];
  history: { at: IsoDateTime; byId: Id; by: string; action: string; note: string }[];
}

/** Who acts on IT policy records beyond IT itself: CoS/DCoS (M365 approvals), Finance (budget), company heads
 *  (disposal of their devices), the COO and CEO (disposal HQ, domains, IP decommissioning), the PDPA officer (wipe log, read). */
export function itPolicyParty(u: User): boolean {
  if (u.integration) return false;
  return (
    u.opsTier === 'coo' ||
    u.opsTier === 'ceo' ||
    u.leadership === 'cos' ||
    u.leadership === 'deputy_cos' ||
    u.leadership === 'finance_director' ||
    u.department === 'finance' ||
    u.department === 'pdpa' ||
    u.role === 'company_manager'
  );
}
registerWall('it_policy_party', itPolicyParty);

const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : NaN);
const yn = (v: unknown): 'yes' | 'no' | 'unknown' => (v === 'yes' || v === true ? 'yes' : v === 'no' || v === false ? 'no' : 'unknown');
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const monthsBetween = (a: IsoDate, b: IsoDate) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) - (Number(b.slice(8, 10)) < Number(a.slice(8, 10)) ? 1 : 0);

/** A name that looks like a person rather than a company (registrant must be the company). */
export function looksLikePerson(name: string): boolean {
  return !/(sdn\.? ?bhd|berhad|\bbhd\b|enterprise|plt|limited|\bltd\b|group|holdings|network|corporation|\bcorp\b|company)/i.test(name);
}

/** Q8: physical and online quote counts against the IT-BUY settings, and expired quotes. */
export function quoteCheck(quotes: { type: 'physical' | 'online'; expiresOn?: IsoDate | null }[], today: IsoDate) {
  const r = RULES.itBuy.value;
  const physical = quotes.filter((q) => q.type === 'physical').length;
  const online = quotes.filter((q) => q.type === 'online').length;
  const expired = quotes.filter((q) => q.expiresOn && q.expiresOn < today).length;
  return { physical, online, expired, enough: physical >= r.quotesNeeded && online >= r.onlineChecksNeeded, need: { physical: r.quotesNeeded, online: r.onlineChecksNeeded } };
}

/** Q19: billing periods of an agreement for a year (monthly 12, quarterly 4, yearly 1). */
export function agreementBillPeriods(billing: 'monthly' | 'quarterly' | 'yearly', year: number): { period: string; months: string[] }[] {
  const m = (i: number) => `${year}-${String(i).padStart(2, '0')}`;
  if (billing === 'yearly') return [{ period: `${year}`, months: Array.from({ length: 12 }, (_, i) => m(i + 1)) }];
  if (billing === 'quarterly') return [1, 4, 7, 10].map((q, i) => ({ period: `${year}-Q${i + 1}`, months: [m(q), m(q + 1), m(q + 2)] }));
  return Array.from({ length: 12 }, (_, i) => ({ period: m(i + 1), months: [m(i + 1)] }));
}

/** Q19: accessories missing on return. */
export const RETURN_ACCESSORIES = ['adapter', 'cable', 'dock', 'bag', 'keyboardMouse'] as const;
export function missingAccessories(issued: string[], returned: Record<string, boolean>): string[] {
  return issued.filter((a) => !returned[a]);
}

/** Q18: end-of-life months for a device kind. */
export function endOfLifeMonths(kind: ItAssetKind): number {
  const e = RULES.it.value.endOfLifeMonths;
  return e[kind] ?? e.default;
}

const workingDaysSince = (from: IsoDateTime | IsoDate, today: IsoDate) => {
  let c = 0;
  for (let d = addDays(String(from).slice(0, 10), 1); d <= today; d = addDays(d, 1)) if (isWorkingDay(d, new Set())) c++;
  return c;
};

/** V-X6: where an ICT disposal is against its working-day targets (inspect 3, approvals 2, wipe + certificate 2, whole 7). */
export function itDisposalTimes(r: ItPolicyRec, recs: ItPolicyRec[], today: IsoDate): { id: Id; ref: string; status: string; stage: 'inspect' | 'approve' | 'wipe' | null; days: number; target: number; late: boolean; whole: { days: number; target: number; late: boolean } } {
  const t = RULES.it.value.disposalStageWorkingDays;
  const when = (a: string) => r.history.find((h) => h.action === a)?.at ?? null;
  const wiped = recs.some((w) => w.kind === 'wipe' && w.assetId === r.assetId && w.at >= r.at);
  const closed = ['disposed', 'rejected', 'repaired'].includes(r.status);
  let stage: 'inspect' | 'approve' | 'wipe' | null = null;
  let since: string = r.at;
  let target = 0;
  if (r.status === 'asked') { stage = 'inspect'; target = t.inspect; }
  else if (['inspected', 'manager', 'head', 'hq'].includes(r.status)) { stage = 'approve'; since = when('inspected') ?? r.at; target = t.approve; }
  else if (r.status === 'approved' && !wiped) { stage = 'wipe'; since = r.history.filter((h) => h.action !== 'create').at(-1)?.at ?? r.at; target = t.wipe; }
  const days = stage ? workingDaysSince(since, today) : 0;
  const wholeDays = workingDaysSince(r.at, today);
  return { id: r.id, ref: r.ref, status: r.status, stage: closed ? null : stage, days, target, late: !closed && !!stage && days > target, whole: { days: wholeDays, target: t.whole, late: !closed && !(r.status === 'approved' && wiped) && wholeDays > t.whole } };
}

/** V9: approved account requests with no account on the register (approval reference) after the target working days. */
export function itAccountsLate(recs: ItPolicyRec[], today: IsoDate) {
  const refs = new Set(recs.filter((r) => r.kind === 'm365').map((r) => String(r.d.approvalRef ?? '')));
  return recs
    .filter((r) => r.kind === 'acctReq' && r.status === 'approved' && !refs.has(r.ref))
    .map((r) => {
      const ok = (r.d.cos as ItPolicyStep | undefined)?.at ?? (r.d.verify as ItPolicyStep | undefined)?.at ?? r.at;
      return { id: r.id, ref: r.ref, approvedAt: ok, days: workingDaysSince(ok, today) };
    })
    .filter((x) => x.days > RULES.it.value.accountReadyWorkingDays);
}

/** V9: a new domain made active with no IP register row naming it after the target working days. */
export function itIpLate(recs: ItPolicyRec[], today: IsoDate) {
  const ip = recs.filter((r) => r.kind === 'ip');
  return recs
    .filter((r) => r.kind === 'domainReq' && r.status === 'active')
    .map((r) => ({ id: r.id, name: String(r.d.name), changedAt: r.history.find((h) => h.action === 'active')?.at ?? r.at }))
    .filter((x) => !ip.some((p) => String(p.d.name ?? '').toLowerCase().includes(x.name) || String(p.d.description ?? '').toLowerCase().includes(x.name)))
    .map((x) => ({ ...x, days: workingDaysSince(x.changedAt, today) }))
    .filter((x) => x.days > RULES.it.value.ipRegisterWorkingDays);
}

/** Q16: the disposal steps in order. */
export const DISPOSAL_STEPS = ['asked', 'inspected', 'manager', 'head', 'hq', 'approved', 'disposed'] as const;

/** Q24: the five IT policies and five circulars, effective 18 Nov 2026 (Q-X9). Copies are loaded by HR in the policy library. */
export const IT_POLICY_DOCS: { code: string; title: string; kind: 'policy' | 'circular' }[] = [
  { code: 'IT-POL-001', title: 'Dasar Pengurusan Harta Intelek', kind: 'policy' },
  { code: 'IT-POL-PROC', title: 'Dasar Perolehan dan Pengurusan Inventori IT', kind: 'policy' },
  { code: 'IT-POL-M365', title: 'Dasar Pengurusan Domain dan Akaun Pengguna Microsoft 365', kind: 'policy' },
  { code: 'IT-POL-004', title: 'Dasar Pengurusan Tiket Sokongan IT', kind: 'policy' },
  { code: 'IT-POL-005', title: 'Dasar Pelupusan Peralatan IT dan Pengurusan Kitaran Hayat Aset IT', kind: 'policy' },
  { code: 'MN/CIR/IT/001/2026', title: 'Tadbir Urus Harta Intelek Korporat', kind: 'circular' },
  { code: 'MN/CIR/IT/002/2026', title: 'Tadbir Urus Akaun Microsoft 365', kind: 'circular' },
  { code: 'MN/CIR/IT/003/2026', title: 'Perolehan IT dan Kawalan Aset', kind: 'circular' },
  { code: 'MN/CIR/IT/004/2026', title: 'Penggunaan Wajib Sistem Tiket Sokongan IT', kind: 'circular' },
  { code: 'MN/CIR/IT/005/2026', title: 'Pelupusan Aset IT dan Perlindungan Data', kind: 'circular' },
];
export const IT_POLICY_EFFECTIVE: IsoDate = '2026-11-18';

export class ItPolicyService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}

  private now() {
    return this.clock();
  }
  private today() {
    return dateOf(this.clock());
  }
  private it(u: User) {
    return !u.integration && u.department === 'it' && (u.itRole === 'manager' || u.itRole === 'lead' || u.itRole === 'executive');
  }
  private itManager(u: User) {
    return this.it(u) && u.itRole === 'manager';
  }
  private itLeadOrExec(u: User) {
    return this.it(u) && (u.itRole === 'lead' || u.itRole === 'executive');
  }
  private cos(u: User) {
    return !u.integration && (u.leadership === 'cos' || u.leadership === 'deputy_cos');
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || u.department === 'finance');
  }
  private reader(u: User) {
    return !u.integration && (u.department === 'it' || u.department === 'audit' || u.opsTier === 'coo' || u.opsTier === 'ceo');
  }
  private reason(v: unknown, what = 'a reason') {
    const r = s(v, 500);
    if (r.length < 3) throw new BadRequest(`Give ${what}.`);
    return r;
  }

  private async all(): Promise<ItPolicyRec[]> {
    return (await this.store.list('itPolicyRecs', {})) as ItPolicyRec[];
  }
  private async get(id: Id, kind?: ItPolicyKind): Promise<ItPolicyRec> {
    await this.store.lock?.('itPolicyRecs', id);
    const r = (await this.store.get('itPolicyRecs', id)) as ItPolicyRec | undefined;
    if (!r || (kind && r.kind !== kind)) throw new NotFound('Record');
    return r;
  }
  private async nextRef(prefix: string, kind: ItPolicyKind) {
    const year = this.today().slice(0, 4);
    const n = (await this.all()).filter((r) => r.kind === kind && r.ref.startsWith(`${prefix}-${year}-`)).length + 1;
    return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
  }
  private async create(user: User, kind: ItPolicyKind, prefix: string, rec: Partial<ItPolicyRec> & { d: Record<string, unknown>; status: string }, note: string) {
    const at = this.now();
    const r: ItPolicyRec = {
      id: `itpol-${kind}-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      kind,
      ref: await this.nextRef(prefix, kind),
      at,
      byId: user.id,
      by: user.name,
      version: 1,
      history: [{ at, byId: user.id, by: user.name, action: 'create', note }],
      ...rec,
    } as ItPolicyRec;
    return this.store.transaction(async (tx) => {
      await tx.insert('itPolicyRecs', r as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `it.policy.${kind}`, entity: 'it_policy', entityId: r.id, summary: `${r.ref} ${kind}: ${note}`.slice(0, 300) });
      return r;
    });
  }
  private async save(user: User, r: ItPolicyRec, patch: Partial<ItPolicyRec>, action: string, note: string) {
    const at = this.now();
    const next: Partial<ItPolicyRec> = { ...patch, version: r.version + 1, history: [...r.history, { at, byId: user.id, by: user.name, action, note: note.slice(0, 500) }] };
    return this.store.transaction(async (tx) => {
      await tx.update('itPolicyRecs', r.id, next as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `it.policy.${r.kind}.${action}`, entity: 'it_policy', entityId: r.id, summary: `${r.ref} ${action}: ${note}`.slice(0, 300) });
      return { ...r, ...next } as ItPolicyRec;
    });
  }
  private proofs(user: User, v: unknown): ItProof[] {
    return Array.isArray(v) && v.length ? this.svc.itProofsFor(user, (v as ProofInput[]).slice(0, 5)) : [];
  }
  async settings(): Promise<Record<string, unknown>> {
    return ((await this.all()).find((r) => r.kind === 'settings')?.d ?? {}) as Record<string, unknown>;
  }

  /** One door: every policy action. Permissions are checked in each branch. */
  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'setSettings':
        return this.setSettings(user, i);
      case 'request':
        return this.request(user, i);
      case 'requestFromTicket':
        return this.requestFromTicket(user, s(i.ticketId, 120));
      case 'requestToPurchase':
        return this.requestToPurchase(user, i);
      case 'requestDecline':
        return this.requestDecline(user, s(i.id, 120), i.reason);
      case 'assess':
        return this.assess(user, i);
      case 'quoteInfo':
        return this.quoteInfo(user, i);
      case 'recommend':
        return this.recommend(user, i);
      case 'budget':
        return this.budget(user, i);
      case 'grn':
        return this.grn(user, i);
      case 'grnRelease':
        return this.grnRelease(user, s(i.id, 120), s(i.assetId, 120), i.reason);
      case 'assetDetail':
        return this.assetDetail(user, i);
      case 'disposalAsk':
        return this.disposalAsk(user, i);
      case 'disposalInspect':
        return this.disposalInspect(user, i);
      case 'disposalDecide':
        return this.disposalDecide(user, s(i.id, 120), i.decision === 'reject' ? 'reject' : 'approve', i.reason);
      case 'disposalDone':
        return this.disposalDone(user, i);
      case 'wipe':
        return this.wipe(user, i);
      case 'wipeCheck':
        return this.wipeCheck(user, s(i.id, 120), i.reason);
      case 'wipeBackup':
        return this.wipeBackup(user, s(i.id, 120));
      case 'refurb':
        return this.refurb(user, i);
      case 'eol':
        return this.eol(user, i);
      case 'agreement':
        return this.agreement(user, i);
      case 'agreementSigned':
        return this.agreementSigned(user, i);
      case 'rentalReturn':
        return this.rentalReturn(user, i);
      case 'm365':
        return this.m365(user, i);
      case 'acctReq':
        return this.acctReq(user, i);
      case 'acctStep':
        return this.acctStep(user, s(i.id, 120), s(i.step, 20), i);
      case 'domainReq':
        return this.domainReq(user, i);
      case 'domainStep':
        return this.domainStep(user, s(i.id, 120), s(i.step, 20), i);
      case 'domainSec':
        return this.domainSec(user, i);
      case 'ip':
        return this.ip(user, i);
      case 'ipDecommission':
        return this.ipDecommission(user, s(i.id, 120), s(i.step, 10), i.reason);
      case 'webProject':
        return this.webProject(user, i);
      case 'webStep':
        return this.webStep(user, s(i.id, 120), s(i.step, 20), i);
      default:
        throw new BadRequest('Unknown IT policy action.');
    }
  }

  // ----- Settings (IT Manager, each change with a reason) -----
  private async setSettings(user: User, i: Record<string, unknown>) {
    if (!this.itManager(user)) throw new AccessDenied('view', '(the IT Manager keeps the IT policy settings)');
    const reason = this.reason(i.reason);
    const cur = (await this.all()).find((r) => r.kind === 'settings');
    const d: Record<string, unknown> = { ...(cur?.d ?? {}) };
    if (typeof i.namingConvention === 'string') d.namingConvention = s(i.namingConvention, 300);
    if (Array.isArray(i.licences)) d.licences = (i.licences as unknown[]).map((x) => s(x, 60)).filter(Boolean).slice(0, 20);
    if (i.licencesBought && typeof i.licencesBought === 'object')
      d.licencesBought = Object.fromEntries(Object.entries(i.licencesBought as Record<string, unknown>).map(([k, v]) => [s(k, 60), Math.max(0, Math.floor(Number(v) || 0))]).slice(0, 20));
    if (Array.isArray(i.registrars)) d.registrars = (i.registrars as unknown[]).map((x) => s(x, 80)).filter(Boolean).slice(0, 20);
    if (i.stageDays && typeof i.stageDays === 'object') {
      const base = RULES.it.value.purchaseStageDays as Record<string, number>;
      d.stageDays = Object.fromEntries(Object.keys(base).map((k) => [k, Math.max(1, Math.min(60, Math.floor(Number((i.stageDays as Record<string, unknown>)[k] ?? base[k]) || base[k])))]));
    }
    if (cur) return this.save(user, cur, { d }, 'settings', reason);
    return this.create(user, 'settings', 'ITSET', { d, status: 'active' }, reason);
  }

  // ----- Q6 purchase request from any department -----
  private async request(user: User, i: Record<string, unknown>, ticketId: Id | null = null) {
    if (user.integration || user.role === 'site_device') throw new AccessDenied('view', '(IT equipment requests)');
    const item = s(i.item, 120);
    const qty = Math.floor(Number(i.qty));
    if (item.length < 2) throw new BadRequest('Say what item is needed.');
    if (!(qty >= 1 && qty <= 500)) throw new BadRequest('Give the quantity.');
    const purpose = s(i.purpose, 500);
    if (purpose.length < 3) throw new BadRequest('Say what it is for.');
    const just = (['operational', 'productivity', 'compliance', 'replacement'] as const).find((k) => k === i.justification) ?? 'operational';
    const d = {
      item,
      qty,
      purpose,
      neededBy: isDate(i.neededBy) ? i.neededBy : null,
      usage: s(i.usage, 300),
      department: s(i.department, 80) || user.department || '',
      costCentre: s(i.costCentre, 60),
      priority: (['P1', 'P2', 'P3', 'P4'] as const).find((p) => p === i.priority) ?? 'P3',
      justification: just,
      replacesTag: just === 'replacement' ? s(i.replacesTag, 40) : '',
      ticketId,
    };
    const proof = this.proofs(user, i.attachment);
    return this.create(user, 'request', 'ITREQ', { d, status: 'submitted', requesterId: user.id, companyId: s(i.companyId, 60) || user.companyIds[0] || null, proof }, `${qty} x ${item}`);
  }

  private async requestFromTicket(user: User, ticketId: Id) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT turns a request into a purchase request)');
    const t = await this.store.get('itTickets', ticketId);
    if (!t || t.category !== 'PROCUREMENT') throw new NotFound('Procurement request');
    if (t.purchaseRequestId) throw new BadRequest('Already turned into a purchase request.');
    const owner = await this.store.get('users', t.raisedById);
    const r = await this.create(
      user,
      'request',
      'ITREQ',
      { d: { item: t.title, qty: 1, purpose: t.detail || t.title, neededBy: null, usage: '', department: owner?.department ?? '', costCentre: '', priority: t.priority, justification: 'operational', replacesTag: '', ticketId: t.id }, status: 'submitted', requesterId: t.raisedById, companyId: owner?.companyIds[0] ?? null },
      `from ${t.ref}`,
    );
    await this.store.transaction(async (tx) => {
      await tx.update('itTickets', t.id, { purchaseRequestId: r.id, firstResponseAt: t.firstResponseAt ?? this.now() });
    });
    return r;
  }

  private async requestToPurchase(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT turns a request into an IT purchase)');
    const r = await this.get(s(i.id, 120), 'request');
    if (r.status !== 'submitted') throw new BadRequest('This request is already handled.');
    const kind = (['LAPTOP', 'DESKTOP', 'PHONE', 'TABLET', 'PRINTER', 'NETWORK', 'CCTV', 'OTHER'] as const).find((k) => k === i.kind) ?? 'OTHER';
    const unitPrice = n(i.unitPrice);
    if (!(unitPrice > 0)) throw new BadRequest('Give the estimated unit price.');
    const p = await this.svc.raiseItPurchase(user, { ownerId: s(i.ownerId, 60) || 'merdeka', reason: `${r.ref}: ${String(r.d.purpose)}`.slice(0, 300), items: [{ kind, description: String(r.d.item), qty: Number(r.d.qty), unitPrice }] });
    return this.save(user, r, { status: 'purchase', purchaseId: p.id }, 'purchase', `${p.ref}`);
  }

  private async requestDecline(user: User, id: Id, why: unknown) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT answers equipment requests)');
    const r = await this.get(id, 'request');
    if (r.status !== 'submitted') throw new BadRequest('This request is already handled.');
    return this.save(user, r, { status: 'declined' }, 'decline', this.reason(why));
  }

  // ----- Q7 technical assessment -----
  private async purchase(id: Id): Promise<ItPurchase> {
    const p = await this.store.get('itPurchases', id);
    if (!p) throw new NotFound('IT purchase');
    return p;
  }
  private async assess(user: User, i: Record<string, unknown>) {
    if (!this.itLeadOrExec(user)) throw new AccessDenied('view', '(the IT Lead or an IT Executive assesses; the IT Manager agrees the need)');
    const p = await this.purchase(s(i.purchaseId, 120));
    const kinds = new Set(p.items.map((x) => x.kind));
    const spares = (await this.store.list('itAssets', {})).filter((a) => a.status === 'spare' && kinds.has(a.kind)).length;
    const buyAnyway = s(i.buyAnywayReason, 300);
    if (spares > 0 && buyAnyway.length < 3) throw new BadRequest(`Ada stok ganti: ${spares} unit. Give a reason to buy anyway.`);
    const d = {
      brandModel: s(i.brandModel, 120),
      spec: s(i.spec, 1000),
      compatible: yn(i.compatible),
      compatibleNote: s(i.compatibleNote, 300),
      spares,
      buyAnywayReason: buyAnyway,
      estCost: n(i.estCost),
      alternatives: s(i.alternatives, 500),
      leadTime: s(i.leadTime, 60),
      security: s(i.security, 500),
    };
    if ((d.brandModel as string).length < 2 || (d.spec as string).length < 3) throw new BadRequest('Give the recommended brand or model and the specification.');
    const cur = (await this.all()).find((r) => r.kind === 'assessment' && r.purchaseId === p.id);
    if (cur) return this.save(user, cur, { d }, 'reassess', `${d.brandModel}`);
    return this.create(user, 'assessment', 'ITASM', { d, status: 'done', purchaseId: p.id }, `${p.ref}: ${d.brandModel}`);
  }

  // ----- Q8 quote details, comparison and recommendation -----
  private async quoteInfo(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT records quotes)');
    const p = await this.purchase(s(i.purchaseId, 120));
    const quotes = (Array.isArray(i.quotes) ? (i.quotes as Record<string, unknown>[]) : []).slice(0, 10).map((q) => ({
      supplier: s(q.supplier, 120),
      type: q.type === 'online' ? ('online' as const) : ('physical' as const),
      quoteNo: s(q.quoteNo, 60),
      quoteDate: isDate(q.quoteDate) ? q.quoteDate : null,
      price: n(q.price),
      warrantyMonths: Math.max(0, Math.floor(Number(q.warrantyMonths) || 0)),
      leadDays: Math.max(0, Math.floor(Number(q.leadDays) || 0)),
      paymentTerms: s(q.paymentTerms, 120),
      contact: s(q.contact, 80),
      email: s(q.email, 120),
      expiresOn: isDate(q.expiresOn) ? q.expiresOn : null,
      link: s(q.link, 500),
      technicalFit: s(q.technicalFit, 200),
      capability: s(q.capability, 200),
      payFirst: q.payFirst === true,
      payFirstTerms: q.payFirst === true ? s(q.payFirstTerms, 300) : '',
    }));
    if (!quotes.length || quotes.some((q) => q.supplier.length < 2 || !(q.price > 0))) throw new BadRequest('Each quote needs the supplier and the price.');
    if (quotes.some((q) => q.payFirst && q.payFirstTerms.length < 3)) throw new BadRequest('A pay-first quote needs the supplier\'s payment terms (bayaran dahulu).');
    const check = quoteCheck(quotes, this.today());
    const cur = (await this.all()).find((r) => r.kind === 'quoteInfo' && r.purchaseId === p.id);
    const d = { ...(cur?.d ?? {}), quotes, check };
    if (cur) return this.save(user, cur, { d }, 'quotes', `${check.physical} physical, ${check.online} online`);
    return this.create(user, 'quoteInfo', 'ITQ', { d, status: 'open', purchaseId: p.id }, `${p.ref}: ${check.physical} physical, ${check.online} online`);
  }

  private async recommend(user: User, i: Record<string, unknown>) {
    if (!this.itLeadOrExec(user)) throw new AccessDenied('view', '(the IT Lead or an IT Executive recommends; the IT Manager does not recommend and agree the same purchase)');
    const p = await this.purchase(s(i.purchaseId, 120));
    const cur = (await this.all()).find((r) => r.kind === 'quoteInfo' && r.purchaseId === p.id);
    if (!cur) throw new BadRequest('Record the quotes first.');
    const supplier = s(i.supplier, 120);
    const q = (cur.d.quotes as { supplier: string; payFirst: boolean }[]).find((x) => x.supplier === supplier);
    if (!q) throw new BadRequest('Recommend one of the recorded quotes.');
    const reason = this.reason(i.reason, 'the reason for the recommendation');
    // Q-X4b: route (b) when the recommended supplier's terms need payment before delivery.
    return this.save(user, cur, { d: { ...cur.d, recommendation: { supplier, reason, byId: user.id, by: user.name, at: this.now() }, route: q.payFirst ? 'b' : 'a' } }, 'recommend', `${supplier}: ${reason}`);
  }

  // ----- Q9 Finance budget check -----
  private async budget(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(the assigned Merdeka Finance person records the budget check)');
    const p = await this.purchase(s(i.purchaseId, 120));
    if (p.requestedById === user.id) throw new BadRequest('Someone other than the requester records the budget check.');
    const available = i.available === 'yes' || i.available === true ? 'ada' : i.available === 'no' || i.available === false ? 'tiada' : null;
    if (!available) throw new BadRequest('Say whether the budget is available (ada / tiada).');
    const d = { available, allocation: s(i.allocation, 200), comment: this.reason(i.comment, 'a comment') };
    const cur = (await this.all()).find((r) => r.kind === 'budget' && r.purchaseId === p.id);
    if (cur) return this.save(user, cur, { d }, 'budget', `${available}: ${d.comment}`);
    return this.create(user, 'budget', 'ITBUD', { d, status: available, purchaseId: p.id }, `${p.ref} bajet ${available}`);
  }

  // ----- Q10 receiving: inspection and GRN; failed units stay in quarantine -----
  private async grn(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT receives and inspects)');
    const p = await this.purchase(s(i.purchaseId, 120));
    const checks = { packageOk: yn(i.packageOk), specOk: yn(i.specOk), physicalOk: yn(i.physicalOk), functionOk: yn(i.functionOk), accessoriesOk: yn(i.accessoriesOk) };
    if (Object.values(checks).some((v) => v === 'unknown')) throw new BadRequest('Answer each inspection check (yes or no).');
    const qty = Math.floor(Number(i.qty));
    if (!(qty >= 1)) throw new BadRequest('Give the quantity received.');
    const failedAssetIds = Array.isArray(i.failedAssetIds) ? (i.failedAssetIds as unknown[]).map((x) => s(x, 120)).filter(Boolean).slice(0, 100) : [];
    const mismatch = Object.values(checks).some((v) => v === 'no');
    const d = {
      doNo: s(i.doNo, 60),
      invoiceNo: s(i.invoiceNo, 60),
      qty,
      inspectedOn: isDate(i.inspectedOn) ? i.inspectedOn : this.today(),
      ...checks,
      note: s(i.note, 500),
      inspector: user.name,
      mismatch,
      quarantine: mismatch ? failedAssetIds : [],
      warrantyCert: s(i.warrantyCert, 300),
    };
    if ((d.doNo as string).length < 2) throw new BadRequest('Give the delivery order number.');
    if (mismatch && !(d.note as string)) throw new BadRequest('Say what does not match; Procurement and Finance are told at once.');
    return this.create(user, 'grn', 'GRN', { d, status: mismatch ? 'mismatch' : 'ok', purchaseId: p.id }, `${p.ref} DO ${d.doNo}${mismatch ? ' MISMATCH' : ''}`);
  }

  private async grnRelease(user: User, id: Id, assetId: Id, why: unknown) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT releases a unit from quarantine)');
    const r = await this.get(id, 'grn');
    const q = (r.d.quarantine as string[]) ?? [];
    if (!q.includes(assetId)) throw new BadRequest('That unit is not in quarantine.');
    return this.save(user, r, { d: { ...r.d, quarantine: q.filter((x) => x !== assetId) } }, 'release', `${assetId}: ${this.reason(why)}`);
  }

  /** Units held in quarantine by a failed receiving inspection (Q10). */
  async quarantined(): Promise<Set<Id>> {
    return new Set((await this.all().catch(() => [])).filter((r) => r.kind === 'grn').flatMap((r) => (r.d.quarantine as string[]) ?? []));
  }

  // ----- Q11 register details before handover -----
  private async assetDetail(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT keeps the asset register)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    const cur = (await this.all()).find((r) => r.kind === 'assetDetail' && r.assetId === a.id);
    const keys = ['brand', 'category', 'vendor', 'poNo', 'invoiceNo', 'department', 'amc', 'processor', 'ram', 'storage', 'os', 'conditionAtHandover', 'custodianName', 'custodianPersonId', 'location', 'ackFormLink'];
    const d: Record<string, unknown> = { ...(cur?.d ?? {}) };
    for (const k of keys) if (typeof i[k] === 'string') d[k] = s(i[k], 200);
    if (i.cost != null && i.cost !== '') {
      const c = n(i.cost);
      if (!(c >= 0)) throw new BadRequest('Give the purchase cost in RM.');
      d.cost = c;
    }
    if (isDate(i.deployedOn)) d.deployedOn = i.deployedOn;
    if (Array.isArray(i.accessories)) d.accessories = (i.accessories as unknown[]).map((x) => s(x, 40)).filter(Boolean).slice(0, 12);
    // Old assets with no purchase evidence: "maklumat pembelian tiada"; never invented.
    if (i.purchaseUnknown === true) d.purchaseUnknown = true;
    if (i.purchaseUnknown === false) d.purchaseUnknown = false;
    const note = s(i.note, 300) || 'details';
    if (cur) return this.save(user, cur, { d }, 'detail', note);
    return this.create(user, 'assetDetail', 'ITAD', { d, status: 'active', assetId: a.id }, `${a.tag}: ${note}`);
  }

  /**
   * Q11 + Q17: what stops an asset going "in use" for a person: label linked, serial, purchase details and cost (or
   * "maklumat pembelian tiada" for an old asset), custodian and location; and a checked data wipe when it goes to a
   * different person than before. Returns the problems; empty means it may be handed over.
   */
  async handoverProblems(a: ItAsset, toName: string): Promise<string[]> {
    // Before the CEO installs the module (it-policies-v1) nothing can be recorded, so the rule starts with it.
    const recs = await this.all().catch(() => null);
    if (!recs) return [];
    const det = recs.find((r) => r.kind === 'assetDetail' && r.assetId === a.id)?.d ?? null;
    const out: string[] = [];
    const labels = await this.store.list('physicalItems', { itAssetId: a.id }).catch(() => []);
    if (!labels.length) out.push('no item-register label linked');
    if (!a.serial) out.push('no serial');
    if (!det) out.push('register details missing (brand, cost, PO, vendor, invoice, custodian, location)');
    else {
      if (!det.purchaseUnknown && (!det.poNo || !det.vendor || !det.invoiceNo || det.cost == null)) out.push('purchase details missing (PO, vendor, invoice, cost), or mark "maklumat pembelian tiada"');
      if (!det.custodianName && !det.custodianPersonId) out.push('custodian missing');
      if (!det.location && !a.location) out.push('location missing');
    }
    if ((await this.quarantined()).has(a.id)) out.push('held in quarantine after a failed receiving inspection');
    const holders = ((det?.holders as { name: string; from: IsoDate }[]) ?? []).filter(Boolean);
    const last = holders[holders.length - 1];
    if (last && last.name.toLowerCase() !== toName.trim().toLowerCase()) {
      const wiped = recs.some((r) => r.kind === 'wipe' && r.assetId === a.id && r.status === 'checked' && String(r.d.doneOn ?? '') >= last.from);
      if (!wiped) out.push('a checked data wipe is needed before it goes to another person');
    }
    return out;
  }

  /** Records the new holder on the asset's register details (used by the handover). */
  async noteHolder(user: User, a: ItAsset, name: string) {
    const cur = (await this.all().catch(() => [] as ItPolicyRec[])).find((r) => r.kind === 'assetDetail' && r.assetId === a.id);
    if (!cur) return;
    const holders = ((cur.d.holders as { name: string; from: IsoDate }[]) ?? []).slice(-20);
    if (holders[holders.length - 1]?.name.toLowerCase() === name.toLowerCase()) return;
    await this.save(user, cur, { d: { ...cur.d, holders: [...holders, { name, from: this.today() }], custodianName: name } }, 'handover', name);
  }

  // ----- Q16 disposal record (one record; the item-register label retires with it) -----
  private async disposalAsk(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(anyone in IT asks for a disposal; a department asks through a device request)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    if (a.status === 'disposed') throw new BadRequest('Already disposed.');
    if ((await this.all()).some((r) => r.kind === 'disposal' && r.assetId === a.id && !['disposed', 'rejected', 'repaired'].includes(r.status))) throw new BadRequest('A disposal record is already open for this asset.');
    const reason = (['beyond_repair', 'end_of_life', 'obsolete', 'physical_damage'] as const).find((k) => k === i.reason);
    if (!reason) throw new BadRequest('Choose the reason: beyond repair, end of life, obsolete or physical damage.');
    const condition = this.reason(i.condition, 'the current condition');
    return this.create(user, 'disposal', 'DSP', { d: { reason, condition, askedById: user.id, tag: a.tag, serial: a.serial }, status: 'asked', assetId: a.id, companyId: a.ownerId }, `${a.tag}: ${reason}`);
  }

  private async disposalInspect(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT inspects)');
    const r = await this.get(s(i.id, 120), 'disposal');
    if (r.status !== 'asked') throw new BadRequest('Not waiting for inspection.');
    if (r.d.askedById === user.id) throw new BadRequest('Someone other than the person who asked inspects it.');
    const a = (await this.store.get('itAssets', r.assetId!))!;
    const repairable = i.repairable === true || i.repairable === 'yes';
    const photos = this.proofs(user, i.photos);
    const d = {
      ...r.d,
      inspectedById: user.id,
      inspectedOn: this.today(),
      warranty: a.warrantyTo && a.warrantyTo >= this.today() ? `under warranty to ${a.warrantyTo}` : a.warrantyTo ? `warranty ended ${a.warrantyTo}` : 'warranty unknown',
      repairOptions: this.reason(i.repairOptions, 'the repair options'),
      repairCost: i.repairCost == null || i.repairCost === '' ? null : n(i.repairCost),
      repairable,
    };
    if (!photos.length) throw new BadRequest('Attach photos of the equipment.');
    return this.save(user, r, { d, status: repairable ? 'repaired' : 'inspected', proof: [...(r.proof ?? []), ...photos] }, 'inspect', repairable ? 'boleh dibaiki: repair, the asset stays active' : 'tidak boleh dibaiki: to approval');
  }

  /** The head of the company or department using the device (Q-X5): its company manager; for central devices the CoS or DCoS
   *  (owner decision, Fauzan 14 Nov 2026: "3., yes"). */
  private async headOk(user: User, r: ItPolicyRec) {
    const cid = r.companyId ?? '';
    const central = cid === 'merdeka' || cid === 'pwvsb' || !cid;
    if (central) return this.cos(user);
    return user.role === 'company_manager' && user.companyIds.includes(cid);
  }

  private async disposalDecide(user: User, id: Id, decision: 'approve' | 'reject', why: unknown) {
    const r = await this.get(id, 'disposal');
    const reason = this.reason(why);
    if (user.id === r.d.askedById || user.id === r.d.inspectedById) throw new BadRequest('Nobody approves a disposal they asked for or inspected.');
    const step: ItPolicyStep = { byId: user.id, by: user.name, at: this.now(), reason, decision };
    const hq = RULES.it.value.disposalHq;
    let patch: Partial<ItPolicyRec>;
    if (r.status === 'inspected') {
      if (!this.itManager(user)) throw new BadRequest('The IT Manager approves first.');
      patch = { d: { ...r.d, manager: step }, status: decision === 'approve' ? 'manager' : 'rejected' };
    } else if (r.status === 'manager') {
      if (!(await this.headOk(user, r))) throw new BadRequest('The head of the company or department using the device approves next.');
      patch = { d: { ...r.d, head: step }, status: decision === 'approve' ? 'head' : 'rejected' };
    } else if (r.status === 'head') {
      if (user.opsTier !== hq) throw new BadRequest(`Management/HQ (the ${hq.toUpperCase()}) approves last.`);
      if ([(r.d.manager as ItPolicyStep)?.byId, (r.d.head as ItPolicyStep)?.byId].includes(user.id)) throw new BadRequest('Three different people approve a disposal.');
      patch = { d: { ...r.d, hq: step }, status: decision === 'approve' ? 'approved' : 'rejected' };
    } else throw new BadRequest('Not waiting for an approval.');
    // The asset register moves when the IT Manager records the disposal as done (only IT writes the register).
    return this.save(user, r, patch, decision, reason);
  }

  private async disposalDone(user: User, i: Record<string, unknown>) {
    if (!this.itManager(user)) throw new AccessDenied('view', '(only the IT Manager records a disposal as done)');
    const r = await this.get(s(i.id, 120), 'disposal');
    if (r.status !== 'approved') throw new BadRequest('The disposal is not approved yet.');
    const method = (['ewaste', 'tradein', 'salvage', 'takeback'] as const).find((k) => k === i.method);
    if (!method) throw new BadRequest('Choose the method: certified e-waste vendor, trade-in, parts salvage or manufacturer take-back.');
    const vendor = s(i.vendor, 120);
    const certNo = s(i.certNo, 80);
    const value = i.value === '' || i.value == null ? NaN : n(i.value);
    if (!(value >= 0)) throw new BadRequest('Type the disposal value in RM (0 is allowed when typed).');
    const cert = this.proofs(user, i.certificate);
    const photos = this.proofs(user, i.photos);
    if (vendor.length < 3 || certNo.length < 3 || !cert.length) throw new BadRequest('Give the vendor, the disposal certificate number and its file.');
    if (!photos.length) throw new BadRequest('Attach photos of the equipment.');
    if (s(i.vendorAck, 200).length < 3) throw new BadRequest('Record the vendor acknowledgement.');
    const wiped = (await this.all()).some((w) => w.kind === 'wipe' && w.assetId === r.assetId && w.status === 'checked' && w.d.reason === 'dispose');
    if (!wiped) throw new BadRequest('The data wipe record (checked by another IT person) comes first.');
    const d = { ...r.d, method, vendor, certNo, vendorAck: s(i.vendorAck, 200), value, tradeInRef: method === 'tradein' ? s(i.tradeInRef, 40) : '', writeOff: 'finance_to_record' };
    const asset = (await this.store.get('itAssets', r.assetId!))!;
    if (asset.status !== 'disposal_pending') await this.svc.setItAssetViaPolicy(user, r.assetId!, 'disposal_pending', `${r.ref}: ${String(r.d.reason).replace('_', ' ')}; approved by IT Manager, head and HQ`);
    await this.svc.setItAssetViaPolicy(user, r.assetId!, 'disposed', `${r.ref}`, method === 'ewaste' ? { contractor: vendor, noteRef: certNo } : { contractor: `${method}: ${vendor}`, noteRef: certNo });
    // The item-register label retires with the IT record: one device, one disposal record.
    await this.store.transaction(async (tx) => {
      for (const u of await tx.list('physicalItems', { itAssetId: r.assetId! })) {
        if (u.state === 'disposed') continue;
        await tx.update('physicalItems', u.id, { state: 'disposed', retiredAt: this.now(), writeOff: 'finance_to_decide', version: u.version + 1 } as never);
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'item.disposed', entity: 'item', entityId: u.id, summary: `${u.token} retired with IT disposal ${r.ref}; write-off for Finance to record.` });
      }
    });
    return this.save(user, r, { d, status: 'disposed', proof: [...(r.proof ?? []), ...cert, ...photos] }, 'disposed', `${method} ${vendor} ${certNo}`);
  }

  // ----- Q17 data wipe log -----
  private async wipe(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT wipes devices)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    const reason = (['dispose', 'return', 'reissue', 'refurbish'] as const).find((k) => k === i.reason);
    const method = (['secure_erase', 'disk_destroyed', 'factory_reset', 'not_applicable'] as const).find((k) => k === i.method);
    if (!reason || !method) throw new BadRequest('Choose why (dispose, return, reissue, refurbish) and the method.');
    const evidence = this.proofs(user, i.evidence);
    if (method !== 'not_applicable' && !evidence.length) throw new BadRequest('Attach the wipe tool report or a photo.');
    const d = { reason, method, storageSerial: s(i.storageSerial, 80), doneById: user.id, doneBy: user.name, doneOn: this.today(), backup: null, tag: a.tag };
    return this.create(user, 'wipe', 'WIPE', { d, status: 'done', assetId: a.id, proof: evidence }, `${a.tag}: ${method} (${reason})`);
  }

  private async wipeCheck(user: User, id: Id, why: unknown) {
    const r = await this.get(id, 'wipe');
    if (r.status !== 'done') throw new BadRequest('Not waiting for a check.');
    const doer = await this.store.get('users', String(r.d.doneById));
    const ok = doer?.itRole === 'lead' ? this.itManager(user) : this.it(user) && (user.itRole === 'lead' || user.itRole === 'manager');
    if (!ok || user.id === r.d.doneById) throw new BadRequest('A different IT person checks it: the IT Lead, or the IT Manager when the Lead did it.');
    return this.save(user, r, { status: 'checked', d: { ...r.d, checkedById: user.id, checkedBy: user.name } }, 'checked', this.reason(why, 'what you checked'));
  }

  /** The person or their manager ticks that business data was backed up before the wipe (Q-D14 12.3). */
  private async wipeBackup(user: User, id: Id) {
    const r = await this.get(id, 'wipe');
    if (r.d.backup) throw new BadRequest('Already ticked.');
    return this.save(user, r, { d: { ...r.d, backup: { byId: user.id, by: user.name, at: this.now() } } }, 'backup', 'backup ticked');
  }

  // ----- Q18 refurbishment and end-of-life review -----
  static readonly REFURB_CHECKS = ['hardware', 'cleaning', 'battery', 'disk', 'ramCpu', 'screenKeyboard', 'chargingPort', 'osReinstalled', 'securityUpdates', 'accountsRemoved', 'dataWiped', 'companySoftware', 'functionTest'] as const;
  private async refurb(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT refurbishes)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    const checks = Object.fromEntries(ItPolicyService.REFURB_CHECKS.map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    if (checks.dataWiped && !(await this.all()).some((w) => w.kind === 'wipe' && w.assetId === a.id && w.status === 'checked')) throw new BadRequest('The data wipe record comes first.');
    const missing = ItPolicyService.REFURB_CHECKS.filter((k) => !checks[k]);
    return this.create(user, 'refurb', 'RFB', { d: { checks, missing, partsReplaced: s(i.partsReplaced, 300), note: s(i.note, 300), on: this.today() }, status: missing.length ? 'partial' : 'done', assetId: a.id }, `${a.tag}: ${missing.length ? `${missing.length} checks open` : 'all checks done'}`);
  }

  private async eol(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT reviews end of life)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    const outcome = (['keep', 'refurbish', 'reassign', 'retire'] as const).find((k) => k === i.outcome);
    if (!outcome) throw new BadRequest('Choose: keep, refurbish and reuse, give to another person, or retire and replace.');
    return this.create(user, 'eol', 'EOL', { d: { outcome, reason: this.reason(i.reason), on: this.today() }, status: outcome, assetId: a.id }, `${a.tag}: ${outcome}`);
  }

  /** Q18 + Q11: regular work for the IT plan: refurbish, end-of-life review, register details to fill. */
  async dues(assets: ItAsset[], recs: ItPolicyRec[], today: IsoDate) {
    const r = RULES.it.value;
    const out: { assetId: Id; tag: string; what: 'refurbish' | 'eol' | 'details'; label: string }[] = [];
    for (const a of assets.filter((x) => x.status !== 'disposed' && x.status !== 'lost' && x.status !== 'stolen')) {
      const lastRefurb = recs.filter((x) => x.kind === 'refurb' && x.assetId === a.id && x.status === 'done').map((x) => String(x.d.on)).sort().pop() ?? a.boughtOn;
      if ((a.kind === 'LAPTOP' || a.kind === 'DESKTOP') && monthsBetween(lastRefurb, today) >= r.refurbishMonths) out.push({ assetId: a.id, tag: a.tag, what: 'refurbish', label: 'baik pulih' });
      const lastEol = recs.filter((x) => x.kind === 'eol' && x.assetId === a.id).map((x) => String(x.d.on)).sort().pop();
      if (monthsBetween(a.boughtOn, today) >= endOfLifeMonths(a.kind) && (!lastEol || daysBetween(lastEol, today) > 365)) out.push({ assetId: a.id, tag: a.tag, what: 'eol', label: 'penilaian akhir hayat' });
      if (!recs.some((x) => x.kind === 'assetDetail' && x.assetId === a.id)) out.push({ assetId: a.id, tag: a.tag, what: 'details', label: 'maklumat pembelian tiada: isi butiran daftar' });
    }
    return out;
  }

  // ----- Q19 rental agreement per company -----
  private async agreement(user: User, i: Record<string, unknown>) {
    if (!this.itManager(user)) throw new AccessDenied('view', '(the IT Manager keeps the rental agreements)');
    const companyId = s(i.companyId, 60);
    if (!companyId || !(await this.store.get('companies', companyId))) throw new NotFound('Company');
    const billing = (['monthly', 'quarterly', 'yearly'] as const).find((k) => k === i.billing);
    if (!billing) throw new BadRequest('Choose the billing frequency.');
    if (!isDate(i.start)) throw new BadRequest('Give the start date.');
    const num = (v: unknown, def: number, lo: number, hi: number) => {
      const x = v == null || v === '' ? def : Math.floor(Number(v));
      if (!(x >= lo && x <= hi)) throw new BadRequest('Check the numbers in the agreement.');
      return x;
    };
    // Starting values from the agreement draft (approved 14 Nov 2026); the IT Manager changes them with a reason.
    const d = {
      agreementNo: s(i.agreementNo, 40),
      start: i.start,
      end: isDate(i.end) ? i.end : null,
      rateBasis: i.rateBasis === 'year' ? 'year' : 'month',
      billing,
      paymentDays: num(i.paymentDays, 30, 1, 120),
      noticeDays: num(i.noticeDays, 30, 30, 90),
      cureDays: num(i.cureDays, 14, 1, 60),
      replaceAfterDays: num(i.replaceAfterDays, 3, 1, 30),
      defectDays: num(i.defectDays, 5, 1, 30),
      licencesSeparate: true,
      signed: null,
    };
    if ((d.agreementNo as string).length < 3) throw new BadRequest('Give the agreement number.');
    const cur = (await this.all()).find((r) => r.kind === 'agreement' && r.companyId === companyId && r.status !== 'ended');
    if (cur) return this.save(user, cur, { d: { ...d, signed: cur.d.signed ?? null } }, 'terms', this.reason(i.reason));
    return this.create(user, 'agreement', 'ITRA', { d, status: 'draft', companyId }, `${d.agreementNo} ${companyId}`);
  }

  private async agreementSigned(user: User, i: Record<string, unknown>) {
    if (!this.itManager(user)) throw new AccessDenied('view', '(the IT Manager records the signed agreement)');
    const r = await this.get(s(i.id, 120), 'agreement');
    const link = s(i.link, 500);
    if (!/^https:\/\//.test(link)) throw new BadRequest('Give the SharePoint link to the signed copy.');
    if (!isDate(i.signedOn)) throw new BadRequest('Give the signing date.');
    const signed = { link, signedOn: i.signedOn, forA: this.reason(i.forA, 'who signed for Merdeka (Pihak A)'), forB: this.reason(i.forB, 'who signed for the company (Pihak B)'), witness: s(i.witness, 120), recordedBy: user.name };
    return this.save(user, r, { d: { ...r.d, signed }, status: 'signed' }, 'signed', `signed ${signed.signedOn}`);
  }

  private async rentalReturn(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT records a returned device)');
    const a = await this.store.get('itAssets', s(i.assetId, 120));
    if (!a) throw new NotFound('IT asset');
    const det = (await this.all()).find((r) => r.kind === 'assetDetail' && r.assetId === a.id);
    const issued = ((det?.d.accessories as string[]) ?? []).length ? (det!.d.accessories as string[]) : [...RETURN_ACCESSORIES].slice(0, 2);
    const returned = Object.fromEntries(issued.map((k) => [k, (i.returned as Record<string, unknown> | undefined)?.[k] === true]));
    const missing = missingAccessories(issued, returned);
    return this.create(user, 'rentalReturn', 'RET', { d: { issued, returned, missing, condition: this.reason(i.condition, 'the condition found'), on: this.today() }, status: missing.length ? 'missing' : 'complete', assetId: a.id, companyId: a.ownerId }, `${a.tag}${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  }

  // ----- Q20 Microsoft 365 account register -----
  private async m365(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT keeps the Microsoft 365 account register)');
    const type = (['licensed', 'shared', 'service', 'guest'] as const).find((k) => k === i.type);
    if (!type) throw new BadRequest('Choose the account type.');
    const email = s(i.email, 160).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequest('Give the email address.');
    const owner = s(i.ownerName, 120);
    if (owner.length < 2) throw new BadRequest('Every account has an owner (a person), shared, service and guest included.');
    const guestExpiry = isDate(i.guestExpiry) ? i.guestExpiry : null;
    if (type === 'guest' && !guestExpiry) throw new BadRequest('A guest account needs its expiry date.');
    const d = {
      type,
      email,
      displayName: s(i.displayName, 120),
      ownerName: owner,
      ownerUserId: s(i.ownerUserId, 120) || null,
      department: s(i.department, 80),
      licence: s(i.licence, 60),
      createdOn: isDate(i.createdOn) ? i.createdOn : this.today(),
      approvalRef: s(i.approvalRef, 120),
      mfa: yn(i.mfa),
      mfaNote: 'recorded by IT',
      guestExpiry,
      onboardingId: s(i.onboardingId, 120) || null,
      training: i.trainingOn && isDate(i.trainingOn) ? { on: i.trainingOn, topics: ['login', 'MFA', 'password', 'data protection', 'acceptable use'] } : null,
      lastReviewOn: null,
    };
    const accStatus = (['active', 'blocked', 'deleted'] as const).find((k) => k === i.status) ?? 'active';
    const cur = (await this.all()).find((r) => r.kind === 'm365' && String(r.d.email) === email);
    if (cur) return this.save(user, cur, { d: { ...cur.d, ...d }, status: accStatus, companyId: s(i.companyId, 60) || cur.companyId }, 'update', s(i.note, 200) || email);
    return this.create(user, 'm365', 'M365', { d, status: accStatus, companyId: s(i.companyId, 60) || null }, email);
  }

  /** Q20: the joiner checklist's Microsoft 365 step needs the account row with MFA "yes" (recorded by IT). */
  async m365StepProblem(onboardingId: Id): Promise<string | null> {
    const all = await this.all().catch(() => null);
    if (!all) return null;
    const rows = all.filter((r) => r.kind === 'm365' && r.d.onboardingId === onboardingId);
    if (!rows.length) return 'Register the Microsoft 365 account first (Akaun M365).';
    if (!rows.some((r) => r.d.mfa === 'yes')) return 'No account is activated without MFA registration (MFA must be "yes").';
    return null;
  }

  // ----- Q21 account request: line manager supports, IT verifies, CoS approves (admin access stays with the CEO) -----
  private async acctReq(user: User, i: Record<string, unknown>) {
    if (user.integration || user.role === 'site_device') throw new AccessDenied('view', '(account requests)');
    const kind = (['newJoiner', 'shared', 'department', 'service', 'guest', 'special'] as const).find((k) => k === i.kind);
    if (!kind) throw new BadRequest('Choose what kind of account.');
    const lineManagerId = s(i.lineManagerId, 120);
    const lm = lineManagerId ? await this.store.get('users', lineManagerId) : undefined;
    if (!lm || lm.integration) throw new BadRequest('Choose the line manager who supports it.');
    if (lm.id === user.id) throw new BadRequest('Your line manager supports your request; you cannot support your own.');
    const d = {
      fullName: this.reason(i.fullName, 'the full name'),
      department: s(i.department, 80),
      jobTitle: s(i.jobTitle, 120),
      emailWanted: s(i.emailWanted, 160),
      justification: this.reason(i.justification, 'the justification'),
      apps: s(i.apps, 300),
      accessLevel: s(i.accessLevel, 60),
      kind,
      hrItIntakeId: kind === 'newJoiner' ? s(i.hrItIntakeId, 120) || null : null,
      subjectUserId: s(i.subjectUserId, 120) || null,
    };
    return this.create(user, 'acctReq', 'ACR', { d, status: 'submitted', requesterId: user.id, lineManagerId: lm.id, companyId: s(i.companyId, 60) || user.companyIds[0] || null }, `${kind}: ${d.fullName}`);
  }

  private async acctStep(user: User, id: Id, step: string, i: Record<string, unknown>) {
    const r = await this.get(id, 'acctReq');
    const reason = this.reason(i.reason);
    const st: ItPolicyStep = { byId: user.id, by: user.name, at: this.now(), reason, decision: i.decision === 'reject' ? 'reject' : 'approve' };
    if (step === 'support') {
      if (r.status !== 'submitted') throw new BadRequest('Not waiting for the line manager.');
      if (user.id !== r.lineManagerId) throw new BadRequest('The named line manager supports it.');
      if (user.id === r.requesterId || user.id === r.d.subjectUserId) throw new BadRequest('Nobody supports their own account request.');
      return this.save(user, r, { d: { ...r.d, support: st }, status: st.decision === 'approve' ? 'supported' : 'rejected' }, 'support', reason);
    }
    if (step === 'verify') {
      if (r.status !== 'supported') throw new BadRequest('The line manager supports it first.');
      if (!this.it(user) || user.id === r.requesterId) throw new BadRequest('IT verifies (not the person who asked).');
      const checks = { existingUser: yn(i.existingUser), duplicate: yn(i.duplicate), licenceFree: yn(i.licenceFree), domainOk: yn(i.domainOk) };
      // A new joiner already reviewed by the CoS in the HR-IT intake is not asked twice (Q-X6).
      const intake = r.d.kind === 'newJoiner' && r.d.hrItIntakeId ? true : false;
      return this.save(user, r, { d: { ...r.d, verify: { ...st, ...checks }, cosFromIntake: intake }, status: st.decision !== 'approve' ? 'rejected' : intake ? 'approved' : 'verified' }, 'verify', reason);
    }
    if (step === 'cos') {
      if (r.status !== 'verified') throw new BadRequest('IT verifies first.');
      if (!this.cos(user)) throw new BadRequest('The Chief of Staff (or the Deputy) approves Microsoft 365 accounts.');
      if ([r.requesterId, r.lineManagerId, r.d.subjectUserId].includes(user.id)) throw new BadRequest('Nobody approves their own account request.');
      return this.save(user, r, { d: { ...r.d, cos: st }, status: st.decision === 'approve' ? 'approved' : 'rejected' }, 'cos', reason);
    }
    throw new BadRequest('Unknown step.');
  }

  /** Q21: the quarterly access review extended to the account register: problems first. */
  m365Review(rows: ItPolicyRec[], users: User[], today: IsoDate) {
    return rows
      .filter((r) => r.kind === 'm365' && r.status !== 'deleted')
      .map((r) => {
        const p: string[] = [];
        if (!r.d.ownerName) p.push('no owner');
        if (r.d.type === 'guest' && r.d.guestExpiry && String(r.d.guestExpiry) < today) p.push('guest past expiry');
        const u = r.d.ownerUserId ? users.find((x) => x.id === r.d.ownerUserId) : undefined;
        if (u?.accessClosedFrom && u.accessClosedFrom <= today && r.status === 'active') p.push('leaver still active');
        if (r.d.mfa !== 'yes') p.push(`MFA ${String(r.d.mfa)}`);
        return { id: r.id, email: String(r.d.email), type: String(r.d.type), problems: p };
      })
      .sort((a, b) => b.problems.length - a.problems.length);
  }

  // ----- Q22 new domain and domain security -----
  private async domainReq(user: User, i: Record<string, unknown>) {
    if (user.integration) throw new AccessDenied('view', '(domain requests)');
    const name = s(i.name, 120).toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new BadRequest('Give the proposed domain name.');
    const d = { name, purpose: this.reason(i.purpose, 'the purpose'), justification: this.reason(i.justification, 'the business justification'), users: Math.max(0, Math.floor(Number(i.users) || 0)) };
    return this.create(user, 'domainReq', 'DOM', { d, status: 'submitted', requesterId: user.id, companyId: s(i.companyId, 60) || null }, name);
  }

  private async domainStep(user: User, id: Id, step: string, i: Record<string, unknown>) {
    const r = await this.get(id, 'domainReq');
    if (step === 'ceo') {
      if (r.status !== 'submitted') throw new BadRequest('Not waiting for the CEO.');
      if (user.opsTier !== 'ceo') throw new BadRequest('The CEO, owner of every domain, approves a new domain.');
      if (user.id === r.requesterId) throw new BadRequest('Nobody approves their own request.');
      const reason = this.reason(i.reason);
      return this.save(user, r, { d: { ...r.d, ceo: { byId: user.id, by: user.name, at: this.now(), reason } }, status: i.decision === 'reject' ? 'rejected' : 'approved' }, 'ceo', reason);
    }
    if (step === 'bought') {
      if (!this.it(user)) throw new BadRequest('IT records the purchase.');
      if (r.status !== 'approved') throw new BadRequest('The CEO approves first.');
      const registrars = ((await this.settings()).registrars as string[]) ?? [];
      const registrar = s(i.registrar, 80);
      if (!registrars.length || !registrars.includes(registrar)) throw new BadRequest('Choose a registrar from the approved list (the IT Manager keeps it).');
      const registrant = this.reason(i.registrant, 'the registrant (the company)');
      const d = { ...r.d, registrar, registrant, registrantFlag: looksLikePerson(registrant) ? 'registrant looks like a person, not the company' : null, autoRenew: yn(i.autoRenew), lock: yn(i.lock), twoFa: yn(i.twoFa), dns: yn(i.dns), handover: s(i.handover, 300) };
      return this.save(user, r, { d, status: 'bought' }, 'bought', `${registrar}`);
    }
    if (step === 'active') {
      if (!this.it(user)) throw new BadRequest('IT activates it.');
      if (r.status !== 'bought') throw new BadRequest('Record the purchase first.');
      const proof = this.proofs(user, i.verification);
      if (!proof.length) throw new BadRequest('A new domain is active only with the Microsoft 365 domain verification proof (screenshot).');
      return this.save(user, r, { status: 'active', proof: [...(r.proof ?? []), ...proof] }, 'active', 'verification proof attached');
    }
    throw new BadRequest('Unknown step.');
  }

  private async domainSec(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(IT records domain security)');
    const domain = s(i.domain, 120).toLowerCase();
    if (!domain) throw new BadRequest('Choose the domain.');
    const d = { domain, lock: yn(i.lock), twoFa: yn(i.twoFa), note: s(i.note, 200), recordedBy: user.name };
    const cur = (await this.all()).find((r) => r.kind === 'domainSec' && r.d.domain === domain);
    if (cur) return this.save(user, cur, { d }, 'update', `lock ${d.lock}, 2FA ${d.twoFa}`);
    return this.create(user, 'domainSec', 'DSEC', { d, status: 'recorded' }, `${domain}: lock ${d.lock}, 2FA ${d.twoFa}`);
  }

  /** Registrar lock and 2FA: "unknown" shows amber, never green. */
  static domainTone(lock: string | undefined, twoFa: string | undefined): 'ok' | 'warn' | 'crit' {
    if (lock === 'no' || twoFa === 'no') return 'crit';
    if (lock === 'yes' && twoFa === 'yes') return 'ok';
    return 'warn';
  }

  // ----- V8 new website or major redesign (IT briefing 22 Oct 2026; V-X5: the company head asks, the CEO approves) -----
  private async webProject(user: User, i: Record<string, unknown>) {
    if (user.integration) throw new AccessDenied('view', '(website requests)');
    const companyId = s(i.companyId, 60);
    if (!companyId || (!(user.role === 'company_manager' && user.companyIds.includes(companyId)) && !(user.opsTier === 'ceo' || user.opsTier === 'coo')))
      throw new AccessDenied('view', '(the head of the company asks for its new website)');
    const kind = i.kind === 'redesign' ? 'redesign' : 'new';
    const owner = (k: string, what: string) => {
      const v = s(i[k], 120);
      if (!v) throw new BadRequest(`Name the ${what}.`);
      return v;
    };
    const d = {
      kind,
      scope: this.reason(i.scope, 'the scope and functions wanted'),
      contact: this.reason(i.contact, 'the contact details to show'),
      ideas: s(i.ideas, 1000),
      profile: s(i.profile, 2000),
      businessOwnerId: owner('businessOwnerId', 'business owner'),
      contentOwnerId: owner('contentOwnerId', 'content owner'),
      technicalKeeperId: owner('technicalKeeperId', 'technical keeper (IT)'),
      contentApproverId: owner('contentApproverId', 'content approver'),
      siteName: s(i.siteName, 120),
    };
    if (d.contentOwnerId === d.contentApproverId) throw new BadRequest('The content approver is not the content owner.');
    const files = this.proofs(user, i.files);
    if (!files.length) throw new BadRequest('Attach the logo, the company profile and the photos to use.');
    return this.create(user, 'webProject', 'WEB', { d, status: 'submitted', requesterId: user.id, companyId, proof: files }, `${kind} website: ${d.siteName || companyId}`);
  }

  private async webStep(user: User, id: Id, step: string, i: Record<string, unknown>) {
    const r = await this.get(id, 'webProject');
    const reason = this.reason(i.reason ?? i.note, 'a comment');
    const sign = { byId: user.id, by: user.name, at: this.now(), reason };
    const need = (st: string, msg: string) => {
      if (r.status !== st) throw new BadRequest(msg);
    };
    if (step === 'check') {
      need('submitted', 'Not waiting for IT to check.');
      if (!this.it(user)) throw new BadRequest('IT checks the request.');
      return this.save(user, r, { d: { ...r.d, check: sign }, status: 'checked' }, 'checked', reason);
    }
    if (step === 'estimate') {
      need('checked', 'IT checks the request first.');
      if (!this.it(user)) throw new BadRequest('IT gives the scope and the cost estimate.');
      const cost = Math.round(Number(i.cost) * 100) / 100;
      const buildDays = Math.floor(Number(i.buildDays));
      if (!(cost >= 0) || !(buildDays >= 1 && buildDays <= 365)) throw new BadRequest('Give the estimated cost (RM) and the build time in working days.');
      return this.save(user, r, { d: { ...r.d, estimate: { ...sign, cost, buildDays, scope: this.reason(i.scope ?? reason, 'the IT scope') } }, status: 'estimated' }, 'estimated', `RM${cost.toFixed(2)}, ${buildDays} working days`);
    }
    if (step === 'ceo') {
      need('estimated', 'IT gives the scope and cost first.');
      if (user.opsTier !== 'ceo') throw new BadRequest('The CEO approves the cost and scope of a new website (V-X5).');
      if (user.id === r.requesterId) throw new BadRequest('Nobody approves their own request.');
      const ok = i.decision !== 'reject';
      return this.save(user, r, { d: { ...r.d, ceo: { ...sign, decision: ok ? 'approve' : 'reject' } }, status: ok ? 'approved' : 'rejected' }, 'ceo', reason);
    }
    if (step === 'content') {
      need('approved', 'The CEO approves the cost and scope first.');
      if (user.id !== r.d.contentOwnerId) throw new BadRequest('The content owner confirms the design and content.');
      return this.save(user, r, { d: { ...r.d, content: sign }, status: 'content_ok' }, 'content', reason);
    }
    if (step === 'built') {
      need('content_ok', 'The content owner confirms the design and content first.');
      if (!this.it(user)) throw new BadRequest('IT records the build and the internal test.');
      const previewUrl = s(i.previewUrl, 300);
      if (!/^https:\/\//.test(previewUrl)) throw new BadRequest('Give the preview address (https).');
      if (i.internalTest !== true) throw new BadRequest('Tick that the internal test passed.');
      return this.save(user, r, { d: { ...r.d, built: { ...sign, previewUrl } }, status: 'built' }, 'built', previewUrl);
    }
    if (step === 'uat') {
      need('built', 'IT builds and tests first.');
      if (user.id !== r.d.contentOwnerId) throw new BadRequest('The content owner tests it (UAT) before publishing.');
      const pass = i.pass === true;
      return this.save(user, r, { d: { ...r.d, uat: { ...sign, pass } }, status: pass ? 'uat_ok' : 'content_ok' }, pass ? 'uat_pass' : 'uat_fail', reason);
    }
    if (step === 'publish') {
      need('uat_ok', 'The content owner passes the UAT first.');
      if (user.id !== r.d.contentApproverId) throw new BadRequest('The content approver approves publishing.');
      if (i.https !== true) throw new BadRequest('HTTPS must be on before it goes live (required check).');
      const liveUrl = s(i.liveUrl, 300);
      if (!/^https:\/\//.test(liveUrl)) throw new BadRequest('Give the live address (https).');
      return this.save(user, r, { d: { ...r.d, publish: { ...sign, liveUrl, https: true }, quarterlyReview: 'joins the website register and its quarterly review' }, status: 'live' }, 'live', liveUrl);
    }
    throw new BadRequest('Unknown step.');
  }

  /** V8: request checked within 1 working day; build within the estimate. */
  static webProjectLate(r: ItPolicyRec, today: IsoDate): string | null {
    if (r.kind !== 'webProject') return null;
    if (r.status === 'submitted' && workingDaysSince(r.at, today) > 1) return 'not checked in 1 working day';
    const est = r.d.estimate as { buildDays: number } | undefined;
    const c = r.d.content as { at: IsoDateTime } | undefined;
    if (r.status === 'content_ok' && est && c && workingDaysSince(c.at, today) > est.buildDays) return `build past the ${est.buildDays}-day estimate`;
    return null;
  }

  // ----- Q23 IP register -----
  static readonly IP_TYPES = ['logo', 'brand_guidelines', 'company_profile', 'presentation', 'brochure', 'template', 'marketing', 'digital_media', 'source_code', 'trademark', 'copyright', 'other'] as const;
  private async ip(user: User, i: Record<string, unknown>) {
    if (!this.it(user)) throw new AccessDenied('view', '(the IT department keeps the IP register)');
    const type = ItPolicyService.IP_TYPES.find((k) => k === i.type);
    if (!type) throw new BadRequest('Choose the type.');
    const access = s(i.accessWhere, 200);
    if (/password|kata laluan|pwd\s*[:=]/i.test(access)) throw new BadRequest('Say WHERE access is kept, never the password itself.');
    const d = {
      name: this.reason(i.name, 'the asset name'),
      type,
      description: s(i.description, 500),
      custodian: s(i.custodian, 120),
      provider: s(i.provider, 120),
      registeredOn: isDate(i.registeredOn) ? i.registeredOn : null,
      expiresOn: isDate(i.expiresOn) ? i.expiresOn : null,
      accessWhere: access,
      storageLink: s(i.storageLink, 500),
      docs: s(i.docs, 300),
      outsideApproved: i.outsideApproved === true,
      filing: type === 'trademark' || type === 'copyright' ? 'filings (MyIPO) stay with the Company Secretary / Legal; recorded here only' : null,
    };
    const companyId = s(i.companyId, 60);
    if (!companyId) throw new BadRequest('Choose the owner company.');
    return this.create(user, 'ip', 'IP', { d, status: 'active', companyId }, `${d.name} (${type})`);
  }

  private async ipDecommission(user: User, id: Id, step: string, why: unknown) {
    const r = await this.get(id, 'ip');
    const reason = this.reason(why);
    if (step === 'ask') {
      if (!this.it(user)) throw new BadRequest('IT asks to decommission.');
      if (r.status !== 'active') throw new BadRequest('Not active.');
      return this.save(user, r, { status: 'decommission_asked', d: { ...r.d, decommission: { askedById: user.id, reason } } }, 'decommission_ask', reason);
    }
    if (step === 'ceo') {
      if (user.opsTier !== 'ceo') throw new BadRequest('Decommissioning needs the CEO\'s approval.');
      if (r.status !== 'decommission_asked') throw new BadRequest('Not asked.');
      return this.save(user, r, { status: 'decommissioned', d: { ...r.d, decommission: { ...(r.d.decommission as object), ceo: { byId: user.id, reason, at: this.now() } } } }, 'decommission', reason);
    }
    throw new BadRequest('Unknown step.');
  }

  // ----- Board -----
  async board(user: User) {
    const party = itPolicyParty(user);
    const reader = this.reader(user);
    const pdpa = user.department === 'pdpa';
    const recs = await this.all().catch(() => [] as ItPolicyRec[]);
    const today = this.today();
    const mine = recs.filter((r) => r.requesterId === user.id || r.lineManagerId === user.id || (r.kind === 'webProject' && (r.d.contentOwnerId === user.id || r.d.contentApproverId === user.id || r.d.businessOwnerId === user.id)));
    const bare = (r: ItPolicyRec) => ({ ...r, proof: (r.proof ?? []).map((f) => ({ ...f, data: '', link: undefined })) });
    const base = { effective: IT_POLICY_EFFECTIVE, docs: IT_POLICY_DOCS, mine: mine.map(bare) };
    if (!reader && !party) return { ...base, role: 'staff' as const };
    const visible = recs.filter((r) => {
      if (reader) return true;
      if (pdpa) return r.kind === 'wipe';
      if (this.finance(user)) return ['budget', 'quoteInfo', 'assessment', 'grn', 'disposal', 'agreement'].includes(r.kind);
      if (this.cos(user)) return r.kind === 'acctReq' || r.kind === 'disposal';
      if (user.role === 'company_manager') return ['ip', 'agreement', 'disposal', 'webProject'].includes(r.kind) && !!r.companyId && user.companyIds.includes(r.companyId);
      return false;
    });
    const [assets, users, purchases, domains] = await Promise.all([
      reader || this.finance(user) ? this.store.list('itAssets', {}) : Promise.resolve([] as ItAsset[]),
      this.store.list('users', {}),
      reader || this.finance(user) ? this.store.list('itPurchases', {}) : Promise.resolve([] as ItPurchase[]),
      reader ? this.store.list('webDomains', {}).catch(() => []) : Promise.resolve([]),
    ]);
    const settings = (recs.find((r) => r.kind === 'settings')?.d ?? {}) as Record<string, unknown>;
    const stageDays = { ...(RULES.it.value.purchaseStageDays as Record<string, number>), ...((settings.stageDays as Record<string, number>) ?? {}) };
    const m365 = visible.filter((r) => r.kind === 'm365');
    const licencesBought = (settings.licencesBought as Record<string, number>) ?? {};
    const licenceUse = Object.entries(m365.filter((r) => r.status === 'active').reduce<Record<string, number>>((acc, r) => ((acc[String(r.d.licence || 'none')] = (acc[String(r.d.licence || 'none')] ?? 0) + 1), acc), {})).map(([licence, used]) => ({ licence, used, bought: licencesBought[licence] ?? null }));
    const purchaseRows = purchases.map((p) => this.purchaseView(p, visible, stageDays, today));
    const domainRows = (domains as { name?: string; domain?: string }[]).map((d) => String(d.name ?? d.domain ?? '')).filter(Boolean);
    const sec = visible.filter((r) => r.kind === 'domainSec');
    const domainSecurity = [...new Set([...domainRows, ...sec.map((r) => String(r.d.domain))])].map((name) => {
      const r = sec.find((x) => x.d.domain === name);
      return { domain: name, lock: String(r?.d.lock ?? 'unknown'), twoFa: String(r?.d.twoFa ?? 'unknown'), tone: ItPolicyService.domainTone(r?.d.lock as string, r?.d.twoFa as string) };
    });
    const ipAuto = reader
      ? [...domainRows.map((d) => ({ name: d, type: 'domain' })), ...(await this.store.list('itAccounts', {}).catch(() => [])).map((a) => ({ name: a.name, type: 'system' }))]
      : [];
    return {
      ...base,
      role: reader ? (this.it(user) ? (user.itRole === 'manager' ? 'manager' : 'it') : 'reader') : 'party',
      settings,
      stageDays,
      records: visible.map(bare),
      purchases: purchaseRows,
      dues: reader ? await this.dues(assets, recs, today) : [],
      m365Review: reader ? this.m365Review(m365, users, today) : [],
      licenceUse,
      domainSecurity,
      ipAuto,
      noAgreement: reader || this.finance(user) ? [...new Set(assets.filter((a) => a.status === 'in_use' || a.status === 'repair').map((a) => a.ownerId))].filter((cid) => !visible.some((r) => r.kind === 'agreement' && r.companyId === cid && r.status === 'signed')) : [],
      quarantine: [...new Set(visible.filter((r) => r.kind === 'grn').flatMap((r) => (r.d.quarantine as string[]) ?? []))],
      wipeReadOnly: pdpa,
      retentionYears: RULES.it.value.retentionYears,
      disposalTimes: reader ? visible.filter((r) => r.kind === 'disposal').map((r) => itDisposalTimes(r, visible, today)).filter((x) => x.stage) : [],
      accountsLate: reader ? itAccountsLate(visible, today) : [],
      ipLate: reader ? itIpLate(visible, today) : [],
      webProjects: visible.filter((r) => r.kind === 'webProject').map((r) => ({ ...bare(r), late: ItPolicyService.webProjectLate(r, today) })),
    };
  }

  /** Q13 stage time frames (late flags) and Q14 documents kept, per purchase. */
  purchaseView(p: ItPurchase, recs: ItPolicyRec[], stageDays: Record<string, number>, today: IsoDate) {
    const of = (k: ItPolicyKind) => recs.filter((r) => r.kind === k && r.purchaseId === p.id);
    const q = of('quoteInfo')[0];
    const grn = of('grn');
    const req = recs.find((r) => r.kind === 'request' && r.purchaseId === p.id);
    const quotes = (q?.d.quotes as { type: 'physical' | 'online'; expiresOn: IsoDate | null; supplier: string; price: number; warrantyMonths: number; leadDays: number; technicalFit: string; capability: string; payFirst: boolean }[]) ?? [];
    const wd = (from: IsoDateTime) => {
      let c = 0;
      for (let d = addDays(dateOf(from), 1); d <= today; d = addDays(d, 1)) if (isWorkingDay(d, new Set())) c++;
      return c;
    };
    const stage: { key: string; since: IsoDateTime } | null =
      p.status === 'submitted'
        ? { key: 'review', since: p.at }
        : p.status === 'quoting' && !q?.d.recommendation
          ? { key: 'recommend', since: p.managerStep?.at ?? p.at }
          : ['quoting', 'coo', 'ceo', 'finance'].includes(p.status)
            ? { key: 'approve', since: ((q?.d.recommendation as { at: IsoDateTime } | undefined)?.at ?? p.managerStep?.at ?? p.at) }
            : p.status === 'procurement' || p.status === 'partially_received'
              ? { key: 'delivery', since: p.ceoStep?.at ?? p.at }
              : null;
    const days = stage ? wd(stage.since) : 0;
    // V-X6: delivery is late only after the chosen quote's own lead time (working days); the setting is the fallback.
    const chosenLead = Math.max(0, ...quotes.filter((x) => x.supplier === (q?.d.recommendation as { supplier?: string } | undefined)?.supplier).map((x) => Number(x.leadDays) || 0));
    const limit = stage?.key === 'delivery' && chosenLead > 0 ? chosenLead : (stageDays[stage?.key ?? ''] ?? 3);
    const late = stage ? days > limit : false;
    // V-X6: request to handover in 5 working days for a stock item, supplier lead time beyond 2 days not counted.
    const it = RULES.it.value;
    const wholeTarget = it.wholePurchaseWorkingDays + Math.max(0, chosenLead - it.supplierLeadFreeDays);
    const done = ['received', 'paid'].includes(p.status);
    const wholeDays = wd(p.at);
    const wholeLate = !done && !['rejected', 'cancelled'].includes(p.status) && wholeDays > wholeTarget;
    const docs = {
      request: !!req || !!p.reason,
      assessment: of('assessment').length > 0,
      quotes: quotes.filter((x) => x.type === 'physical').length >= RULES.itBuy.value.quotesNeeded,
      approvals: !!p.cooStep && !!p.ceoStep,
      po: !!p.finance?.ref || ['procurement', 'received', 'partially_received', 'paid'].includes(p.status),
      deliveryOrder: grn.some((g) => !!g.d.doNo),
      grn: grn.length > 0,
      taxInvoice: grn.some((g) => !!g.d.invoiceNo),
      warrantyCertificate: grn.some((g) => !!g.d.warrantyCert),
      userAcknowledgement: false,
      assetAssignment: p.status === 'received',
    };
    const route = (q?.d.route as string) ?? 'a';
    const leadDays = Math.max(0, ...quotes.filter((x) => x.supplier === (q?.d.recommendation as { supplier?: string } | undefined)?.supplier).map((x) => x.leadDays));
    const paidFirstUndelivered = route === 'b' && !!p.ceoStep && !grn.length && daysBetween(dateOf(p.ceoStep.at), today) > leadDays;
    return {
      purchaseId: p.id,
      ref: p.ref,
      stage: stage?.key ?? null,
      daysInStage: days,
      late,
      stageTarget: stage ? limit : null,
      whole: { days: wholeDays, target: wholeTarget, late: wholeLate },
      quotes: quoteCheck(quotes, today),
      comparison: quotes.map((x) => ({ supplier: x.supplier, type: x.type, price: x.price, warrantyMonths: x.warrantyMonths, leadDays: x.leadDays, technicalFit: x.technicalFit, capability: x.capability, expired: !!x.expiresOn && x.expiresOn < today, payFirst: x.payFirst })),
      recommendation: q?.d.recommendation ?? null,
      route,
      paidFirstUndelivered,
      budget: of('budget')[0]?.d ?? null,
      budgetMissing: !of('budget').length && ['finance', 'procurement'].includes(p.status),
      grn: grn.map((g) => ({ ref: g.ref, status: g.status, doNo: g.d.doNo, quarantine: g.d.quarantine })),
      docs,
      docsMissing: Object.entries(docs).filter(([, v]) => !v).map(([k]) => k),
      keepUntil: `${Number(p.at.slice(0, 4)) + RULES.it.value.retentionYears}${p.at.slice(4, 10)}`,
    };
  }

  /** Home items: approvals waiting (disposal, account requests, domains, IP decommission), budget checks, quarantine. */
  async homeItems(user: User) {
    if (user.integration) return [];
    const recs = await this.all().catch(() => [] as ItPolicyRec[]);
    const items: { tone: 'warn' | 'info' | 'crit'; tag: string; title: string; detail: string; go: { view: 'it' } }[] = [];
    const go = { view: 'it' as const };
    const push = (rs: ItPolicyRec[], tag: string, title: string) => rs.length && items.push({ tone: 'warn', tag, title: `${rs.length} ${title}`, detail: rs.slice(0, 3).map((r) => r.ref).join(', '), go });
    push(recs.filter((r) => r.kind === 'acctReq' && r.status === 'submitted' && r.lineManagerId === user.id), 'Akaun M365', 'account request(s) for you to support');
    if (this.cos(user)) push(recs.filter((r) => r.kind === 'acctReq' && r.status === 'verified' && r.requesterId !== user.id), 'Akaun M365', 'account request(s) for your approval');
    if (this.itManager(user)) push(recs.filter((r) => r.kind === 'disposal' && r.status === 'inspected'), 'Pelupusan', 'disposal(s) for your approval');
    const heads: ItPolicyRec[] = [];
    for (const r of recs.filter((x) => x.kind === 'disposal' && x.status === 'manager')) if (await this.headOk(user, r)) heads.push(r);
    push(heads, 'Pelupusan', 'disposal(s) of your devices for your approval');
    if (user.opsTier === RULES.it.value.disposalHq) push(recs.filter((r) => r.kind === 'disposal' && r.status === 'head'), 'Pelupusan', 'disposal(s) for HQ approval');
    if (this.it(user)) push(recs.filter((r) => r.kind === 'webProject' && ['submitted', 'checked', 'content_ok'].includes(r.status)), 'Laman web', 'new website request(s) for IT');
    push(recs.filter((r) => r.kind === 'webProject' && (((r.status === 'approved' || r.status === 'built') && r.d.contentOwnerId === user.id) || (r.status === 'uat_ok' && r.d.contentApproverId === user.id))), 'Laman web', 'new website step(s) for you');
    if (user.opsTier === 'ceo') {
      push(recs.filter((r) => r.kind === 'webProject' && r.status === 'estimated' && r.requesterId !== user.id), 'Laman web', 'new website cost and scope for your approval');
      push(recs.filter((r) => r.kind === 'domainReq' && r.status === 'submitted'), 'Domain', 'new domain request(s) for your approval');
      push(recs.filter((r) => r.kind === 'ip' && r.status === 'decommission_asked'), 'Harta intelek', 'decommissioning request(s) for your approval');
    }
    // V9 / V-X6: steps past their target show on the owner's Do today (late is a flag, never a block).
    const today = this.today();
    if (this.it(user)) {
      const times = recs.filter((r) => r.kind === 'disposal').map((r) => itDisposalTimes(r, recs, today)).filter((x) => x.late);
      const mine = times.filter((x) => x.stage === 'inspect' || x.stage === 'wipe' || (x.stage === 'approve' && this.itManager(user) && x.status === 'inspected'));
      if (mine.length) items.push({ tone: 'crit', tag: 'Pelupusan', title: `${mine.length} disposal step(s) past the target`, detail: mine.slice(0, 3).map((x) => `${x.ref} ${x.stage} ${x.days}/${x.target}`).join(', '), go });
      const acc = itAccountsLate(recs, today);
      if (acc.length) items.push({ tone: 'crit', tag: 'Akaun M365', title: `${acc.length} approved account(s) not ready in ${RULES.it.value.accountReadyWorkingDays} working days`, detail: acc.slice(0, 3).map((x) => x.ref).join(', '), go });
      const ip = itIpLate(recs, today);
      if (ip.length) items.push({ tone: 'warn', tag: 'Harta intelek', title: `${ip.length} change(s) not in the IP register after ${RULES.it.value.ipRegisterWorkingDays} working days`, detail: ip.slice(0, 3).map((x) => x.name).join(', '), go });
    }
    if (this.finance(user)) {
      push(recs.filter((r) => r.kind === 'disposal' && r.status === 'disposed' && r.d.writeOff === 'finance_to_record'), 'Hapus kira', 'IT disposal(s): record the write-off');
      const bad = recs.filter((r) => r.kind === 'grn' && r.status === 'mismatch');
      push(bad, 'Penerimaan IT', 'delivery mismatch(es) reported by IT');
    }
    return items;
  }
}
