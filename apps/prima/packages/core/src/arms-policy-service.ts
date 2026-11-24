// Arms, vault, licence and bulletproof jacket policies (Fitri package Part R, papers sent 13-14 Nov 2026; Fauzan's answers
// R-X1..R-X11, 13 Nov 2026 23:44Z and 14 Nov 2026 00:24Z). The group's own arms paperwork made into Prima records:
// firearm damage, inspection and reuse confirmation; personal arms licence applications and renewals; new vault
// applications, written vault access, the manual vault log and vault inspections; the firearm purchase form, the police
// application pack, submission and follow-up, the approval letter, receiving; bulletproof jackets (register, purchase
// checks, receiving, issue and return, inspection, quarantine, loss, disposal); dealer licence preparation and the
// trading readiness list (trading stays OFF). One table (prima.arms_policy_recs, behind the arms wall) holds them, each
// with an append-only history. Prima records what the police, KDN, BOMBA and the council did; it never says a licence or
// approval exists until its reference, date and a copy are recorded. Synthetic test data only.
import { AccessDenied, can, canRunCms, GOV_OPS_COMPANY_ID, isGroupRole, seesArmsDetail } from './access';
import { holdsArmsWall, decidesForArmsControl, ARMS_MANAGER_ONLY } from './special-ops';
import { BadRequest, NotFound } from './service';
import type { PrimaService, ProofInput } from './service';
import type { Store } from './store';
import { RULES } from './rules';
import { addDays, dateOf, daysBetween, toMs } from './time';
import type { Finding } from './checks';
import type { ArmsLicenceCategory, ArmsRequest, Credential, Firearm, FirearmStatus, Id, IsoDate, IsoDateTime, ItProof, Person, Site, User, Vault } from './types';

export type ArmsPolicyKind =
  | 'settings'
  | 'damage'
  | 'inspect'
  | 'statusLog'
  | 'repair'
  | 'licenceApp'
  | 'vaultApp'
  | 'vaultChange'
  | 'vaultLog'
  | 'vaultInspect'
  | 'buyPack'
  | 'armsGrn'
  | 'armsBudget'
  | 'jacket'
  | 'jacketBuy'
  | 'jacketGrn'
  | 'jacketInspect'
  | 'dealerApp'
  | 'readiness'
  | 'monthly'
  | 'extinguisher';

export interface ArmsPolicyStep {
  byId: Id;
  by: string;
  at: IsoDateTime;
  reason: string;
}

export interface ArmsPolicyRec {
  id: Id;
  kind: ArmsPolicyKind;
  ref: string;
  status: string;
  at: IsoDateTime;
  byId: Id;
  by: string;
  version: number;
  companyId: Id | null;
  firearmId?: Id | null;
  vaultId?: Id | null;
  personId?: Id | null;
  requestId?: Id | null;
  d: Record<string, unknown>;
  proof?: ItProof[];
  history: { at: IsoDateTime; byId: Id; by: string; action: string; note: string }[];
}

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const n = (v: unknown) => Math.round(Number(v) * 100) / 100;
const int = (v: unknown) => Math.floor(Number(v));
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The 16 arms papers (R23), shown read-only until HR loads the signed BM and checked English copies. */
export const ARMS_POLICY_DOCS: { code: string; title: string; inForce: IsoDate }[] = [
  { code: 'JA-UP-BK/2026', title: 'Pekeliling Permohonan Bilik Kebal', inForce: '2026-11-01' },
  { code: 'POL-PERS (bilik kebal)', title: 'Polisi Prosedur Permohonan Bilik Kebal', inForce: '2026-11-18' },
  { code: 'Carta 1 (bilik kebal)', title: 'Info grafik Permohonan Bilik Kebal Syarikat', inForce: '2026-11-18' },
  { code: 'JA-UP-LSA/2026', title: 'Pekeliling Permohonan Lesen Senjata Api', inForce: '2026-11-01' },
  { code: 'POL-PERS (pelesenan)', title: 'Polisi Prosedur Permohonan Pelesenan Persenjataan', inForce: '2026-11-18' },
  { code: 'Carta 1 (pelesenan)', title: 'Info grafik Permohonan Pelesenan Persenjataan', inForce: '2026-11-18' },
  { code: 'PKL-PERS (pembelian)', title: 'Pekeliling Tatacara Pembelian Senjata Api dan Peluru', inForce: '2026-11-18' },
  { code: 'POL-PERS (pembelian)', title: 'Polisi Pembelian Senjata Api dan Peluru', inForce: '2026-11-18' },
  { code: 'SOP-PERS (pembelian)', title: 'SOP Pembelian Senjata Api dan Peluru', inForce: '2026-11-18' },
  { code: 'Carta alir pembelian', title: 'Carta Alir Pembelian Senjata Api', inForce: '2026-11-18' },
  { code: 'PMPKSA/HQ', title: 'Pekeliling Penyelenggaraan, Pemeriksaan dan Pelaporan Kerosakan Senjata Api', inForce: '2026-11-01' },
  { code: 'POL-PERS (penyelenggaraan)', title: 'Polisi Pengurusan dan Penyelenggaraan Senjata Api', inForce: '2026-11-18' },
  { code: 'SOP kerosakan', title: 'SOP Kerosakan dan Penyelenggaraan Senjata', inForce: '2026-11-18' },
  { code: 'PKL-PERS (jaket)', title: 'Pekeliling Pembelian dan Kawalan Jaket Kalis Peluru', inForce: '2026-11-18' },
  { code: 'POL-PERS (jaket)', title: 'Polisi Pembelian dan Kawalan Jaket Kalis Peluru', inForce: '2026-11-18' },
  { code: 'SOP-PERS (jaket)', title: 'SOP Pembelian Jaket Kalis Peluru', inForce: '2026-11-18' },
];

/** Starting document lists (R8, R9, R14, R28); Arms Control edits each one as a setting with a reason. */
export const ARMS_DOC_LISTS = {
  licence: ['application_form', 'ic_copy', 'supporting_documents', 'company_support_letter', 'police_extra'],
  vault: ['application_letter', 'company_registration', 'council_address_approval', 'location_plan', 'vault_plan', 'security_documents', 'police_extra'],
  pack: ['application_letter', 'pol128_lampiran_a', 'applicant_ic', 'pelesen_a_book', 'kdn_licence', 'm_and_a', 'kwsp', 'perkeso', 'borang_24', 'borang_49', 'bank_statements_3m', 'income_tax_3y', 'contract', 'duty_statement', 'company_profile', 'strong_room_plan', 'photos_vault_firearms'],
  dealer: ['company_papers', 'place_of_business', 'store_plan_and_approval', 'directors_details', 'police_forms'],
} as const;

/** V14 (arms briefing minutes 20 Oct 2026): monthly firearm records start with November 2026 (due before the 28th). */
export const ARMS_MONTHLY_FROM = '2026-11';
export const DAMAGE_CATEGORIES = ['LIGHT', 'MEDIUM', 'CRITICAL'] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];
const CAT_RANK: Record<DamageCategory, number> = { LIGHT: 1, MEDIUM: 2, CRITICAL: 3 };

/** The licence category each duty needs (R-X4). */
export function licenceNeededFor(site: Pick<Site, 'armed'> | null, jobKind: 'BODYGUARD' | 'CIT' | 'CDM' | 'CASH_VAULT' | null): ArmsLicenceCategory | null {
  if (jobKind === 'BODYGUARD') return 'BODYGUARD';
  if (jobKind) return 'CNU';
  return site?.armed ? 'CNU' : null;
}

/** A person's valid arms licence of one category: FIREARM_PERMIT with that category, not expired, not suspended. */
export function validLicence(creds: Credential[], personId: Id, cat: ArmsLicenceCategory, today: IsoDate): Credential | null {
  return (
    creds
      .filter((c) => c.personId === personId && c.type === 'FIREARM_PERMIT' && c.licenceCategory === cat && (c.licenceState ?? 'active') === 'active' && (!c.expiresOn || c.expiresOn >= today))
      .sort((a, b) => String(b.expiresOn).localeCompare(String(a.expiresOn)))[0] ?? null
  );
}

/** Jacket item category in the item register (R19); jackets are not firearms (R-X8). */
export const JACKET_CATEGORY = 'ballistic_vest' as const;
export const JACKET_RECEIVE_CHECKS = ['quantity', 'brand', 'model', 'size', 'condition', 'label', 'serial', 'productDocs', 'testCertificate', 'warranty', 'matchesPo'] as const;
export const JACKET_INSPECT_CHECKS = ['outside', 'carrier', 'stitching', 'fasteners', 'label', 'serial', 'panel', 'dampOrDamage', 'dateWarranty'] as const;
export const JACKET_BUY_CHECKLIST = ['need', 'location', 'guards', 'held', 'spec', 'competentPerson', 'quotes', 'comparison', 'productDocs', 'warranty', 'delivery', 'budget', 'approval'] as const;
export const FIREARM_INSPECT_CHECKS = ['outerClean', 'rustCrackWear', 'serialMatch', 'statusNotes', 'noIsolationNeeded'] as const;
export const VAULT_STEPS = ['council', 'sent_ipd', 'ipd_registered', 'inspection_letter', 'inspections', 'supported', 'approved', 'access_set', 'done'] as const;
export const LICENCE_STAGES = ['thumbprint', 'biometric', 'eligibility', 'investigation', 'interview'] as const;
export const READINESS_LINES = ['dealerLicence', 'tradeStore', 'policeViewSharedVault', 'counselOpinion', 'kdnCircular2017', 'importRoute', 'stockInsurance', 'sqlAccounts', 'staffLicences'] as const;

export class ArmsPolicyService {
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
  private reason(v: unknown, what = 'a reason') {
    const r = s(v, 500);
    if (r.length < 3) throw new BadRequest(`Give ${what}.`);
    return r;
  }
  private ac(u: User) {
    return !u.integration && canRunCms(u);
  }
  /** D1 (23 Nov 2026): the Arms Control Manager decides; the Assistant prepares. */
  private async mgr(u: User) {
    if (!this.ac(u)) return false;
    if (decidesForArmsControl(u, await this.store.list('users'))) return true;
    throw new AccessDenied('arms.view', `(${ARMS_MANAGER_ONLY})`);
  }
  private async handles(u: User, companyId: Id | null) {
    if (this.ac(u)) return true;
    if (!companyId) return false;
    return can(u, await this.svc.authorityGrants(), this.today(), 'arms.handle', companyId);
  }
  private async views(u: User, companyId: Id | null) {
    if (this.ac(u)) return true;
    if (!companyId) return false;
    return can(u, await this.svc.authorityGrants(), this.today(), 'arms.view', companyId);
  }
  private async head(u: User, companyId: Id | null) {
    return !!companyId && (u.role === 'company_manager' || u.role === 'director') && (await this.handles(u, companyId));
  }
  private hr(u: User) {
    return !u.integration && u.role === 'pwvsb_officer' && u.department === 'hr';
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || u.department === 'finance');
  }
  private stores(u: User) {
    // Goodwill Empire's store and procurement team keep the jackets (R-X7); Arms Control reads them (R-X8).
    return !u.integration && (u.department === 'procurement' || u.homeCompanyId === GOV_OPS_COMPANY_ID);
  }

  private async all(): Promise<ArmsPolicyRec[]> {
    return (await this.store.list('armsPolicyRecs', {})) as ArmsPolicyRec[];
  }
  private async get(id: Id, kind?: ArmsPolicyKind): Promise<ArmsPolicyRec> {
    await this.store.lock?.('armsPolicyRecs', id);
    const r = (await this.store.get('armsPolicyRecs', id)) as ArmsPolicyRec | undefined;
    if (!r || (kind && r.kind !== kind)) throw new NotFound('Record');
    return r;
  }
  private async create(user: User, kind: ArmsPolicyKind, prefix: string, rec: Partial<ArmsPolicyRec> & { d: Record<string, unknown>; status: string; companyId: Id | null }, note: string) {
    const at = this.now();
    const year = this.today().slice(0, 4);
    const count = (await this.all()).filter((r) => r.kind === kind && r.ref.startsWith(`${prefix}-${year}-`)).length + 1;
    const r: ArmsPolicyRec = {
      id: `arpol-${kind}-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      kind,
      ref: `${prefix}-${year}-${String(count).padStart(4, '0')}`,
      at,
      byId: user.id,
      by: user.name,
      version: 1,
      history: [{ at, byId: user.id, by: user.name, action: 'create', note: note.slice(0, 500) }],
      ...rec,
    } as ArmsPolicyRec;
    return this.store.transaction(async (tx) => {
      await tx.insert('armsPolicyRecs', r as never);
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: `arms.policy.${kind}`, entity: 'arms_policy', entityId: r.id, summary: `${r.ref} ${kind}: ${note}`.slice(0, 300) });
      return r;
    });
  }
  private async save(user: User, r: ArmsPolicyRec, patch: Partial<ArmsPolicyRec>, action: string, note: string) {
    const at = this.now();
    const next: Partial<ArmsPolicyRec> = { ...patch, version: r.version + 1, history: [...r.history, { at, byId: user.id, by: user.name, action, note: note.slice(0, 500) }] };
    return this.store.transaction(async (tx) => {
      await tx.update('armsPolicyRecs', r.id, next as never);
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: `arms.policy.${r.kind}.${action}`, entity: 'arms_policy', entityId: r.id, summary: `${r.ref} ${action}: ${note}`.slice(0, 300) });
      return { ...r, ...next } as ArmsPolicyRec;
    });
  }
  private proofs(user: User, v: unknown): ItProof[] {
    return Array.isArray(v) && v.length ? this.svc.itProofsFor(user, (v as ProofInput[]).slice(0, 8)) : [];
  }
  async settings(): Promise<Record<string, unknown>> {
    return ((await this.all().catch(() => [])).find((r) => r.kind === 'settings')?.d ?? {}) as Record<string, unknown>;
  }
  private async values() {
    const st = await this.settings();
    const m = { ...RULES.armsMaint.value, ...((st.maint as object) ?? {}) };
    const dmg = { ...RULES.armsDamage.value, ...((st.damage as object) ?? {}) };
    const pol = { ...RULES.armsPolicy.value, ...((st.policy as object) ?? {}) };
    const docs = { ...ARMS_DOC_LISTS, ...((st.docs as object) ?? {}) } as Record<keyof typeof ARMS_DOC_LISTS, readonly string[]>;
    return { m, dmg, pol, docs, categoryRequired: st.categoryRequired === true };
  }
  private async firearm(id: Id): Promise<Firearm> {
    await this.store.lock?.('firearms', id);
    const f = await this.store.get('firearms', id);
    if (!f) throw new NotFound('Firearm');
    return f;
  }
  private async setFirearm(user: User, f: Firearm, status: FirearmStatus, why: string, extra: Partial<Firearm> = {}) {
    await this.store.transaction(async (tx) => {
      await tx.update('firearms', f.id, { status, ...extra });
      await tx.audit({ at: this.now(), actor: user.name, companyId: f.companyId, action: 'arms.firearm_status', entity: 'firearm', entityId: f.id, summary: `${f.tag}: ${f.status} to ${status}: ${why}`.slice(0, 300) });
    });
    await this.create(user, 'statusLog', 'FST', { d: { from: f.status, to: status, why, tag: f.tag }, status, companyId: f.companyId, firearmId: f.id }, `${f.tag} ${f.status} to ${status}`);
  }

  /** One door: every arms policy action. Permissions are checked in each branch. */
  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'setSettings':
        return this.setSettings(user, i);
      // A. firearm condition
      case 'damageReport':
        return this.damageReport(user, i);
      case 'damageCategory':
        return this.damageCategory(user, i);
      case 'damageReview':
        return this.damageReview(user, i);
      case 'inspect':
        return this.inspect(user, i);
      case 'setStatus':
        return this.setStatus(user, i);
      case 'repairSent':
        return this.repair(user, i, 'sent');
      case 'repairBack':
        return this.repair(user, i, 'back');
      case 'reuse':
        return this.reuse(user, i);
      case 'negligenceLink':
        return this.negligenceLink(user, i);
      // B. licences
      case 'licenceApp':
        return this.licenceApp(user, i);
      case 'licStep':
        return this.licStep(user, i);
      case 'licState':
        return this.licState(user, i);
      case 'followUp':
        return this.followUp(user, i);
      // C. vaults
      case 'vaultApp':
        return this.vaultApp(user, i);
      case 'vaultStep':
        return this.vaultStep(user, i);
      case 'vaultChange':
        return this.vaultChange(user, i);
      case 'vaultAuth':
        return this.vaultAuth(user, i);
      case 'vaultAuthRemove':
        return this.vaultAuthRemove(user, i);
      case 'vaultKeeper':
        return this.vaultKeeper(user, i);
      case 'vaultLog':
        return this.vaultLog(user, i);
      case 'vaultBreach':
        return this.vaultBreach(user, i);
      case 'vaultInspect':
        return this.vaultInspect(user, i);
      case 'vaultActionDone':
        return this.vaultActionDone(user, i);
      // D. buying
      case 'buyForm':
        return this.buyForm(user, i);
      case 'packFile':
        return this.packFile(user, i);
      case 'ipdSent':
        return this.ipdSent(user, i);
      case 'ipdStage':
        return this.ipdStage(user, i);
      case 'approvalLetter':
        return this.approvalLetter(user, i);
      case 'order':
        return this.order(user, i);
      case 'armsGrn':
        return this.armsGrn(user, i);
      case 'grnConfirm':
        return this.grnConfirm(user, i);
      case 'armsBudget':
        return this.armsBudget(user, i);
      case 'buyFile':
        return this.buyFile(user, s(i.requestId, 120));
      // E. jackets
      case 'jacket':
        return this.jacket(user, i);
      case 'jacketBuy':
        return this.jacketBuy(user, i);
      case 'jacketBuyStep':
        return this.jacketBuyStep(user, i);
      case 'jacketGrn':
        return this.jacketGrn(user, i);
      case 'jacketIssue':
        return this.jacketIssue(user, i);
      case 'jacketReturn':
        return this.jacketReturn(user, i);
      case 'jacketHandover':
        return this.jacketHandover(user, i);
      case 'jacketInspect':
        return this.jacketInspect(user, i);
      case 'jacketDecide':
        return this.jacketDecide(user, i);
      case 'jacketLoss':
        return this.jacketLoss(user, i);
      // G. dealer preparation (trading stays off)
      case 'dealerApp':
        return this.dealerApp(user, i);
      case 'dealerStep':
        return this.dealerStep(user, i);
      case 'tradeStore':
        return this.tradeStore(user, i);
      case 'readiness':
        return this.readiness(user, i);
      case 'monthly':
        return this.monthly(user, i);
      case 'extinguisher':
        return this.extinguisher(user, i);
      case 'history':
        return this.history(user, i);
      default:
        throw new BadRequest('Unknown arms policy action.');
    }
  }

  private async setSettings(user: User, i: Record<string, unknown>) {
    if (!(await this.mgr(user))) throw new AccessDenied('arms.view', '(Arms Control keeps the arms policy settings)');
    const reason = this.reason(i.reason);
    const cur = (await this.all()).find((r) => r.kind === 'settings');
    const d: Record<string, unknown> = { ...(cur?.d ?? {}) };
    const nums = (src: unknown, base: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries((src as Record<string, unknown>) ?? {})
          .filter(([k, v]) => k in base && (v === null || Number.isFinite(Number(v))))
          .map(([k, v]) => [k, v === null ? null : Math.max(0, Math.min(3650, Math.floor(Number(v))))]),
      );
    if (i.maint && typeof i.maint === 'object') d.maint = { ...((d.maint as object) ?? {}), ...nums(i.maint, RULES.armsMaint.value) };
    if (i.damage && typeof i.damage === 'object') d.damage = { ...((d.damage as object) ?? {}), ...nums(i.damage, RULES.armsDamage.value) };
    if (i.policy && typeof i.policy === 'object') d.policy = { ...((d.policy as object) ?? {}), ...nums(i.policy, RULES.armsPolicy.value) };
    if (i.docs && typeof i.docs === 'object')
      d.docs = Object.fromEntries(
        Object.entries(i.docs as Record<string, unknown>)
          .filter(([k, v]) => k in ARMS_DOC_LISTS && Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).map((x) => s(x, 60)).filter(Boolean).slice(0, 40)]),
      );
    if (typeof i.categoryRequired === 'boolean') d.categoryRequired = i.categoryRequired;
    if (cur) return this.save(user, cur, { d }, 'settings', reason);
    return this.create(user, 'settings', 'ARSET', { d, status: 'active', companyId: null }, reason);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // A. Firearm condition, damage and maintenance (R1-R6)
  // ---------------------------------------------------------------------------------------------------------------

  private async damageReport(user: User, i: Record<string, unknown>) {
    const f = await this.firearm(s(i.firearmId, 120));
    if (!(await this.handles(user, f.companyId))) throw new AccessDenied('arms.handle', f.companyId);
    if (f.status === 'ISSUED') throw new BadRequest('Pulangkan senjata ke bilik kebal dahulu: record the return, then the damage report.');
    if (f.status === 'LOST' || f.status === 'OFF_REGISTER') throw new BadRequest('This firearm is not on the register.');
    const what = this.reason(i.what, 'what is wrong');
    const category = DAMAGE_CATEGORIES.find((c) => c === i.category) ?? null;
    const photos = this.proofs(user, i.photos);
    const d = {
      foundAt: s(i.foundAt, 30) || this.now(),
      siteId: s(i.siteId, 120) || null,
      holder: s(i.holder, 120),
      tag: f.tag,
      kind: f.kind,
      serialMasked: f.serialMasked,
      what,
      how: s(i.how, 500),
      firstAction: s(i.firstAction, 300),
      receivedBy: s(i.receivedBy, 120),
      category,
      negligence: i.negligence === true ? { facts: this.reason(i.negligenceFacts, 'the facts behind possible negligence') } : null,
      fromStatus: f.status,
      caseRef: null as string | null,
    };
    const r = await this.create(user, 'damage', 'KRS', { d, status: 'open', companyId: f.companyId, firearmId: f.id, vaultId: f.vaultId, proof: photos }, `${f.tag}: ${what}`);
    if (f.status !== 'DAMAGED') await this.setFirearm(user, f, 'DAMAGED', `${r.ref}: ${what}`);
    if (category === 'CRITICAL') return this.criticalCase(user, r, f);
    return r;
  }

  private async criticalCase(user: User, r: ArmsPolicyRec, f: Firearm) {
    const c = await this.svc.openArmsPolicyCase(user.name, { companyId: f.companyId, siteId: (r.d.siteId as Id) || null, severity: 'P1', title: `Senjata rosak (kritikal): ${f.tag}`, description: `${r.ref}: ${String(r.d.what)}. Stop use at once and isolate. The company head, the company director and Arms Control act; the COO is told.` });
    return this.save(user, r, { d: { ...r.d, caseRef: c.ref } }, 'critical', `P1 case ${c.ref}`);
  }

  private async damageCategory(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'damage');
    if (r.status === 'closed') throw new BadRequest('This report is closed.');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const cat = DAMAGE_CATEGORIES.find((c) => c === i.category);
    if (!cat) throw new BadRequest('Choose light, medium or critical.');
    const was = r.d.category as DamageCategory | null;
    if (was && CAT_RANK[cat] < CAT_RANK[was]) {
      if (!(await this.mgr(user))) throw new BadRequest('Only Arms Control lowers a damage category, with a reason. Jika ragu, naikkan kategori.');
      this.reason(i.reason, 'why the category is lowered');
    }
    const saved = await this.save(user, r, { d: { ...r.d, category: cat } }, 'category', `${was ?? 'none'} to ${cat}${i.reason ? `: ${s(i.reason, 200)}` : ''}`);
    if (cat === 'CRITICAL' && !r.d.caseRef) return this.criticalCase(user, saved, await this.firearm(r.firearmId!));
    return saved;
  }

  /** HQ (the company manager, A licence holder) reviews medium and critical damage; the company director for critical (R-X3). */
  private async damageReview(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'damage');
    if (!(await this.head(user, r.companyId))) throw new AccessDenied('arms.handle', '(the company manager, holder of the A licence, reviews)');
    if (user.id === r.byId) throw new BadRequest('Someone other than the reporter reviews.');
    const reason = this.reason(i.reason);
    const step = { byId: user.id, by: user.name, at: this.now(), reason };
    const key = user.role === 'director' ? 'directorReview' : 'headReview';
    return this.save(user, r, { d: { ...r.d, [key]: step } }, key, reason);
  }

  private async inspect(user: User, i: Record<string, unknown>) {
    const f = await this.firearm(s(i.firearmId, 120));
    if (!(await this.handles(user, f.companyId))) throw new AccessDenied('arms.handle', f.companyId);
    const checks = Object.fromEntries(FIREARM_INSPECT_CHECKS.map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const pass = Object.values(checks).every(Boolean);
    const d = { checks, result: pass ? 'pass' : 'fail', maintenance: s(i.maintenance, 500), materials: s(i.materials, 300), findings: s(i.findings, 500), tag: f.tag, on: this.today() };
    if (!pass && (d.findings as string).length < 3) throw new BadRequest('Say what the check found.');
    const r = await this.create(user, 'inspect', 'PSA', { d, status: d.result, companyId: f.companyId, firearmId: f.id, proof: this.proofs(user, i.photos) }, `${f.tag}: ${d.result}`);
    // A failed check opens the damage report with the findings copied (R3).
    if (!pass && !(await this.openDamage(f.id))) {
      await this.damageReport(user, { firearmId: f.id, what: `Pemeriksaan gagal (${r.ref}): ${d.findings}`, receivedBy: user.name, photos: [] });
    }
    return r;
  }
  private async openDamage(firearmId: Id) {
    return (await this.all()).find((r) => r.kind === 'damage' && r.firearmId === firearmId && r.status !== 'closed') ?? null;
  }

  /** Into an out-of-use status with a reason; out of it only through the reuse confirmation (R1, R5). */
  private async setStatus(user: User, i: Record<string, unknown>) {
    const f = await this.firearm(s(i.firearmId, 120));
    if (!(await this.handles(user, f.companyId))) throw new AccessDenied('arms.handle', f.companyId);
    const to = (['NEEDS_MAINTENANCE', 'UNDER_INSPECTION', 'UNUSABLE'] as const).find((k) => k === i.status);
    if (!to) throw new BadRequest('Choose needs maintenance, under inspection or unusable. Back to use only through the reuse confirmation.');
    if (f.status === 'ISSUED') throw new BadRequest('Pulangkan senjata ke bilik kebal dahulu.');
    await this.setFirearm(user, f, to, this.reason(i.reason));
    return { ok: true, status: to };
  }

  /** R4: a licensed dealer repairs it (the SERVICE arms request); the firearm shows IN_REPAIR while away. */
  private async repair(user: User, i: Record<string, unknown>, step: 'sent' | 'back') {
    const req = await this.request(s(i.requestId, 120));
    if (req.kind !== 'SERVICE') throw new BadRequest('Repairs go through a service request.');
    if (!(await this.handles(user, req.companyId))) throw new AccessDenied('arms.handle', req.companyId);
    const dealer = await this.dealerProblem(req);
    if (dealer) throw new BadRequest(dealer);
    const on = isDate(i.on) ? i.on : this.today();
    let rec = (await this.all()).find((r) => r.kind === 'repair' && r.requestId === req.id);
    if (step === 'sent') {
      if (rec) throw new BadRequest('Already sent.');
      const note = this.reason(i.note, "the dealer's receipt note");
      for (const id of req.firearmIds ?? []) {
        const f = await this.firearm(id);
        if (f.status === 'ISSUED') throw new BadRequest(`${f.tag} is issued.`);
        await this.setFirearm(user, f, 'IN_REPAIR', `${req.ref}: sent to the dealer`);
      }
      return this.create(user, 'repair', 'BPS', { d: { sentOn: on, sentBy: user.name, sentById: user.id, dealerNote: note }, status: 'sent', companyId: req.companyId, requestId: req.id, proof: this.proofs(user, i.docs) }, `${req.ref} sent`);
    }
    if (!rec || rec.status !== 'sent') throw new BadRequest('Record that it was sent first.');
    const report = this.proofs(user, i.docs);
    if (!report.length) throw new BadRequest("Attach the dealer's report.");
    rec = await this.save(user, rec, { status: 'back', d: { ...rec.d, backOn: on, backBy: user.name, backById: user.id }, proof: [...(rec.proof ?? []), ...report] }, 'back', 'returned with report');
    return rec;
  }

  /** R5: confirm before use again. Never the reporter, never the repairer; Arms Control is the independent check. */
  private async reuse(user: User, i: Record<string, unknown>) {
    const f = await this.firearm(s(i.firearmId, 120));
    if (!['MAINTENANCE', 'NEEDS_MAINTENANCE', 'UNDER_INSPECTION', 'DAMAGED', 'IN_REPAIR', 'UNUSABLE'].includes(f.status)) throw new BadRequest('This firearm is not out of use.');
    if (f.status === 'IN_REPAIR') throw new BadRequest('It is still with the dealer. Record it back first.');
    if (!this.ac(user)) throw new AccessDenied('arms.view', '(Arms Control confirms reuse as the independent check)');
    const reason = this.reason(i.reason, 'what was checked before reuse');
    const recs = await this.all();
    const dmg = recs.find((r) => r.kind === 'damage' && r.firearmId === f.id && r.status !== 'closed') ?? null;
    const repairs = recs.filter((r) => r.kind === 'repair' && r.d.sentById && r.status === 'back');
    const reqIds = new Set((await this.store.list('armsRequests', { companyId: f.companyId })).filter((q) => q.kind === 'SERVICE' && (q.firearmIds ?? []).includes(f.id)).map((q) => q.id));
    const repairers = repairs.filter((r) => reqIds.has(r.requestId!)).flatMap((r) => [r.d.sentById, r.d.backById]);
    if (dmg && (dmg.byId === user.id || repairers.includes(user.id))) throw new BadRequest('A person who did not report it and did not repair it confirms reuse.');
    // D1: the Arms Control Manager confirms; the Assistant only when the Manager reported or repaired it (independence first).
    const users = await this.store.list('users');
    if (!decidesForArmsControl(user, users)) {
      const managerInvolved = !!dmg && [dmg.byId, ...repairers].some((id) => {
        const u = users.find((x) => x.id === id);
        return !!u && u.department === 'arms_control' && decidesForArmsControl(u, users);
      });
      if (!managerInvolved) throw new AccessDenied('arms.view', `(${ARMS_MANAGER_ONLY})`);
    }
    const since = dmg?.at ?? '';
    const passed = recs.some((r) => r.kind === 'inspect' && r.firearmId === f.id && r.status === 'pass' && r.at >= since);
    if (!passed) throw new BadRequest('Record a passing inspection first (pemeriksaan selepas kerosakan atau pembaikan).');
    if (dmg) {
      const cat = dmg.d.category as DamageCategory | null;
      if (!cat) throw new BadRequest('Set the damage category first.');
      if (cat !== 'LIGHT' && !dmg.d.headReview && !dmg.d.directorReview) throw new BadRequest('The company manager (A licence holder) reviews medium and critical damage first.');
      if (cat === 'CRITICAL' && !dmg.d.directorReview) throw new BadRequest('The company director reviews critical damage first.');
    }
    await this.setFirearm(user, f, 'IN_VAULT', `reuse confirmed: ${reason}`);
    if (dmg) await this.save(user, dmg, { status: 'closed', d: { ...dmg.d, reuse: { byId: user.id, by: user.name, at: this.now(), reason } }, proof: [...(dmg.proof ?? []), ...this.proofs(user, i.docs)] }, 'closed', `pengesahan keadaan: ${reason}`);
    return { ok: true, status: 'IN_VAULT' };
  }

  /** R6: possible negligence lets HR link a discipline case (opened in HR). Never a pay deduction, never automatic. */
  private async negligenceLink(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'damage');
    if (!this.hr(user)) throw new AccessDenied('view', '(HR opens a discipline case)');
    if (!r.d.negligence) throw new BadRequest('The report does not mark possible negligence.');
    const ref = this.reason(i.hrCaseRef, 'the HR case reference');
    return this.save(user, r, { d: { ...r.d, hrCaseRef: ref } }, 'hr_case', ref);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // B. People's arms licences (R7, R8)
  // ---------------------------------------------------------------------------------------------------------------

  private async licenceApp(user: User, i: Record<string, unknown>) {
    const personId = s(i.personId, 120);
    const p = await this.store.get('people', personId);
    if (!p) throw new NotFound('Person');
    if (!(await this.handles(user, p.companyId))) throw new AccessDenied('arms.handle', p.companyId);
    const cat = (['PELESEN_A', 'AMRA', 'CNU', 'BODYGUARD', 'OTHER'] as const).find((k) => k === i.category);
    if (!cat) throw new BadRequest('Choose the licence category.');
    const type = i.type === 'RENEWAL' ? 'RENEWAL' : 'NEW';
    if ((await this.all()).some((r) => r.kind === 'licenceApp' && r.personId === p.id && r.d.category === cat && !['issued', 'refused_closed', 'closed'].includes(r.status)))
      throw new BadRequest('An application for this person and category is already open.');
    const d = { type, category: cat, categoryOther: cat === 'OTHER' ? this.reason(i.categoryOther, 'the licence name') : '', credentialId: s(i.credentialId, 120) || null, docs: {} as Record<string, string>, stages: {} as Record<string, IsoDate>, followUps: [] as unknown[], preparedById: user.id, active: p.status === 'active' };
    return this.create(user, 'licenceApp', 'LSA', { d, status: 'preparing', companyId: p.companyId, personId: p.id }, `${type} ${cat}`);
  }

  private async licStep(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'licenceApp');
    const step = s(i.step, 30);
    const today = this.today();
    const st = { byId: user.id, by: user.name, at: this.now(), reason: '' };
    const { docs } = await this.values();
    if (step === 'hr') {
      if (!this.hr(user)) throw new AccessDenied('view', '(HR confirms eligibility)');
      return this.save(user, r, { d: { ...r.d, hr: { ...st, reason: this.reason(i.reason) } } }, 'hr', 'HR confirmed');
    }
    if (step === 'records') {
      // Criminal record and drug checks: restricted (HR, Arms Control, the company manager); PDPA (L6).
      if (!this.hr(user) && !this.ac(user) && !(await this.head(user, r.companyId))) throw new AccessDenied('view', '(restricted check)');
      const proof = this.proofs(user, i.docs);
      if (!proof.length && s(i.declaration, 200).length < 3) throw new BadRequest('Attach the document or record the declaration.');
      return this.save(user, r, { d: { ...r.d, records: { ...st, reason: s(i.declaration, 200) || 'document attached', restricted: true } }, proof: [...(r.proof ?? []), ...proof] }, 'records', 'record and drug check filed (restricted)');
    }
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    if (step === 'need') {
      if (!(await this.head(user, r.companyId))) throw new BadRequest('Company management confirms the operational need.');
      return this.save(user, r, { d: { ...r.d, need: { ...st, reason: this.reason(i.reason) } } }, 'need', 'need confirmed');
    }
    if (step === 'doc') {
      const key = s(i.key, 60);
      if (!docs.licence.includes(key)) throw new BadRequest('Not on the document list.');
      const proof = this.proofs(user, i.docs);
      if (!proof.length) throw new BadRequest('Attach the document.');
      return this.save(user, r, { d: { ...r.d, docs: { ...(r.d.docs as object), [key]: proof[0].sha256 } }, proof: [...(r.proof ?? []), ...proof] }, 'doc', key);
    }
    if (step === 'check') {
      if (user.id === r.d.preparedById) throw new BadRequest('The Administration Manager checks; never the preparer.');
      if (!(await this.head(user, r.companyId)) && !this.ac(user)) throw new BadRequest('The Administration Manager (company management) checks.');
      return this.save(user, r, { d: { ...r.d, checked: { ...st, reason: this.reason(i.reason) } } }, 'check', 'checked');
    }
    if (step === 'support') {
      if (!(await this.head(user, r.companyId))) throw new BadRequest('Company management approves the support letter.');
      if (user.id === r.d.preparedById) throw new BadRequest('Not the preparer.');
      return this.save(user, r, { d: { ...r.d, support: { ...st, reason: this.reason(i.reason) } } }, 'support', 'support letter approved');
    }
    if (step === 'submit') {
      const missing = this.licenceMissing(r, docs.licence);
      if (missing.length) throw new BadRequest(`Not complete: ${missing.join(', ')}.`);
      if (!isDate(i.on) || i.on > today) throw new BadRequest('Give the submission date.');
      const ref = this.reason(i.ipdRef, 'the IPD reference');
      const proof = this.proofs(user, i.docs);
      if (!proof.length) throw new BadRequest('Attach the proof of receipt.');
      return this.save(user, r, { status: 'submitted', d: { ...r.d, submittedOn: i.on, ipdRef: ref }, proof: [...(r.proof ?? []), ...proof] }, 'submit', ref);
    }
    if (step === 'stage') {
      if (r.status !== 'submitted') throw new BadRequest('Submit it first.');
      const stage = LICENCE_STAGES.find((k) => k === i.stage);
      if (!stage || !isDate(i.on)) throw new BadRequest('Choose the stage and its date.');
      return this.save(user, r, { d: { ...r.d, stages: { ...(r.d.stages as object), [stage]: i.on } } }, 'stage', `${stage} ${i.on}`);
    }
    if (step === 'decision') {
      if (r.status !== 'submitted') throw new BadRequest('Submit it first.');
      if (i.decision === 'refused') return this.save(user, r, { status: 'refused', d: { ...r.d, refused: { ...st, reason: this.reason(i.reason, "the police's reason") } } }, 'refused', s(i.reason, 200));
      if (i.decision !== 'approved') throw new BadRequest('Approved or refused?');
      return this.save(user, r, { status: 'approved', d: { ...r.d, approvedOn: isDate(i.on) ? i.on : today } }, 'approved', 'approved by the police');
    }
    if (step === 'book') {
      if (r.status !== 'approved') throw new BadRequest('Record the approval first.');
      const number = this.reason(i.number, 'the licence number');
      if (!isDate(i.issuedOn) || !isDate(i.expiresOn) || i.expiresOn <= i.issuedOn) throw new BadRequest('Give the issue and expiry dates from the licence book (no default length).');
      const copy = this.proofs(user, i.docs);
      if (!copy.length) throw new BadRequest('Attach the licence book copy.');
      const p = (await this.store.get('people', r.personId!))!;
      // V16: never a second licence with the same number for the same person.
      const dup = (await this.store.list('credentials', { personId: p.id } as never).catch(() => [] as Credential[])).find((c) => c.personId === p.id && c.type === 'FIREARM_PERMIT' && c.number.replace(/\s+/g, '').toUpperCase() === number.replace(/\s+/g, '').toUpperCase());
      if (dup) throw new BadRequest('This licence number is already recorded for this person. Open the existing licence instead.');
      const cred: Credential = { id: `cr-fp-${p.id}-${toMs(this.now())}`, companyId: p.companyId, personId: p.id, type: 'FIREARM_PERMIT', number, issuedOn: i.issuedOn, expiresOn: i.expiresOn, licenceCategory: r.d.category as ArmsLicenceCategory, licenceCategoryOther: (r.d.categoryOther as string) || null, licenceState: 'active', recordedBy: user.name, recordedById: user.id, recordedAt: this.now(), source: 'prima' };
      await this.store.transaction(async (tx) => {
        await tx.insert('credentials', cred);
        await tx.audit({ at: this.now(), actor: user.name, companyId: p.companyId, action: 'arms.licence_issued', entity: 'credential', entityId: cred.id, summary: `${String(r.d.category)} licence ${number} to ${i.expiresOn}` });
      });
      return this.save(user, r, { status: 'issued', d: { ...r.d, credentialId: cred.id, issued: { number, issuedOn: i.issuedOn, expiresOn: i.expiresOn } }, proof: [...(r.proof ?? []), ...copy] }, 'issued', number);
    }
    if (step === 'appeal' || step === 'close') {
      if (r.status !== 'refused') throw new BadRequest('Only a refused application.');
      return this.save(user, r, { status: step === 'appeal' ? 'preparing' : 'refused_closed' }, step, this.reason(i.reason));
    }
    throw new BadRequest('Unknown step.');
  }
  licenceMissing(r: ArmsPolicyRec, list: readonly string[]): string[] {
    const out: string[] = [];
    if (!r.d.active) out.push('the person is not active staff');
    if (!r.d.hr) out.push('HR eligibility');
    if (!r.d.records) out.push('record and drug check');
    if (!r.d.need) out.push('operational need');
    for (const k of list) if (!(r.d.docs as Record<string, string>)[k]) out.push(k);
    if (!r.d.checked) out.push('Administration Manager check');
    if (!r.d.support) out.push('company support letter approval');
    return out;
  }

  /** Suspended, cancelled or back to active: no armed duty while not active (R8). */
  private async licState(user: User, i: Record<string, unknown>) {
    const c = await this.store.get('credentials', s(i.credentialId, 120));
    if (!c || c.type !== 'FIREARM_PERMIT') throw new NotFound('Arms licence');
    if (!this.ac(user) && !(await this.head(user, c.companyId))) throw new AccessDenied('arms.handle', c.companyId);
    const state = (['active', 'suspended', 'cancelled'] as const).find((k) => k === i.state);
    if (!state) throw new BadRequest('Choose active, suspended or cancelled.');
    const reason = this.reason(i.reason);
    await this.store.transaction(async (tx) => {
      await tx.update('credentials', c.id, { licenceState: state });
      await tx.audit({ at: this.now(), actor: user.name, companyId: c.companyId, action: 'arms.licence_state', entity: 'credential', entityId: c.id, summary: `${c.number}: ${state}: ${reason}` });
    });
    return { ok: true, state };
  }

  private async followUp(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120));
    if (!['licenceApp', 'vaultApp', 'buyPack', 'dealerApp'].includes(r.kind)) throw new BadRequest('Follow-ups are for applications waiting on the police.');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const outcome = this.reason(i.outcome, 'the outcome of the follow-up');
    return this.save(user, r, { d: { ...r.d, followUps: [...((r.d.followUps as unknown[]) ?? []), { on: this.today(), by: user.name, outcome }] } }, 'follow_up', outcome);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // C. Vault room (R9-R11)
  // ---------------------------------------------------------------------------------------------------------------

  private async vaultApp(user: User, i: Record<string, unknown>) {
    const companyId = s(i.companyId, 60);
    if (!(await this.head(user, companyId)) && !this.ac(user)) throw new AccessDenied('arms.handle', companyId);
    const name = this.reason(i.name, 'the vault name');
    const kind = (['COMPANY_ARMOURY', 'POLICE_STATION', 'CLIENT_SAFE'] as const).find((k) => k === i.kind) ?? 'COMPANY_ARMOURY';
    const vault: Vault = { id: `va-app-${toMs(this.now())}`, companyId, name, kind, siteId: s(i.siteId, 120) || null, state: 'APPLYING', approvalRef: '', approvalExpiresOn: null, custodian: '', lastCountAt: null, lastCountOk: null, alarmOnline: null };
    await this.store.transaction(async (tx) => {
      await tx.insert('vaults', vault);
      await tx.audit({ at: this.now(), actor: user.name, companyId, action: 'arms.vault_applying', entity: 'vault', entityId: vault.id, summary: `${name}: application started` });
    });
    const d = { steps: {} as Record<string, unknown>, docs: {} as Record<string, string>, people: { liaison: s(i.liaison, 120), vaultOfficer: s(i.vaultOfficer, 120), divisionHead: s(i.divisionHead, 120), ocpd: s(i.ocpd, 120) }, followUps: [] as unknown[], siteVault: i.siteVault === true };
    return this.create(user, 'vaultApp', 'BK', { d, status: 'council', companyId, vaultId: vault.id }, name);
  }

  private async vaultStep(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'vaultApp');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const { docs } = await this.values();
    if (i.doc) {
      const key = s(i.doc, 60);
      if (!docs.vault.includes(key)) throw new BadRequest('Not on the document list.');
      const proof = this.proofs(user, i.docs);
      if (!proof.length) throw new BadRequest('Attach the document.');
      return this.save(user, r, { d: { ...r.d, docs: { ...(r.d.docs as object), [key]: proof[0].sha256 } }, proof: [...(r.proof ?? []), ...proof] }, 'doc', key);
    }
    const step = VAULT_STEPS.find((k) => k === i.step);
    if (!step) throw new BadRequest('Choose the step.');
    const at = VAULT_STEPS.indexOf(r.status as (typeof VAULT_STEPS)[number]);
    if (r.status === 'not_supported') {
      // Not supported: find the cause, appeal, go back to the right step.
      if (!i.backTo || !VAULT_STEPS.includes(i.backTo as never)) throw new BadRequest('Say which step it goes back to after the appeal.');
      return this.save(user, r, { status: String(i.backTo) }, 'appeal', this.reason(i.reason, 'the cause and the appeal'));
    }
    if (VAULT_STEPS.indexOf(step) !== at) throw new BadRequest(`The next step is ${r.status}.`);
    if (!isDate(i.on) || i.on > this.today()) throw new BadRequest('Give the date.');
    const ref = s(i.ref, 80);
    const proof = this.proofs(user, i.docs);
    if (step === 'sent_ipd') {
      const missing = docs.vault.filter((k) => !(r.d.docs as Record<string, string>)[k] && k !== 'police_extra');
      if (missing.length) throw new BadRequest(`Documents missing: ${missing.join(', ')}.`);
    }
    if (step === 'supported' && i.supported === false) return this.save(user, r, { status: 'not_supported', d: { ...r.d, steps: { ...(r.d.steps as object), supported: { on: i.on, supported: false, cause: this.reason(i.reason, 'the cause') } } } }, 'not_supported', s(i.reason, 200));
    if ((step === 'council' || step === 'approved') && (ref.length < 3 || !proof.length)) throw new BadRequest('Give the reference and attach the letter.');
    const entry = { on: i.on, ref, by: user.name };
    const next = VAULT_STEPS[at + 1] ?? 'done';
    if (step === 'done') {
      if (!isDate(i.expiresOn)) throw new BadRequest('Give the approval expiry date.');
      const approved = (r.d.steps as Record<string, { ref: string }>).approved;
      const v = (await this.store.get('vaults', r.vaultId!))!;
      if (!(v.authorisedStaff ?? []).some((a) => !a.removedOn)) throw new BadRequest('Set the authorised list (written authorisation) first.');
      // V16: never a second vault with the same police approval number.
      const apRef = (approved?.ref ?? ref).replace(/\s+/g, '').toUpperCase();
      const twin = (await this.store.list('vaults', {})).find((x) => x.id !== v.id && x.approvalRef && x.approvalRef.replace(/\s+/g, '').toUpperCase() === apRef);
      if (twin) throw new BadRequest(`Approval ${approved?.ref ?? ref} is already on ${twin.name}.`);
      await this.store.transaction(async (tx) => {
        await tx.update('vaults', v.id, { state: 'ACTIVE', approvalRef: approved?.ref ?? ref, approvalExpiresOn: i.expiresOn as IsoDate });
        await tx.audit({ at: this.now(), actor: user.name, companyId: v.companyId, action: 'arms.vault_active', entity: 'vault', entityId: v.id, summary: `${v.name}: approval ${approved?.ref ?? ref} to ${i.expiresOn}` });
      });
      return this.save(user, r, { status: 'active', d: { ...r.d, steps: { ...(r.d.steps as object), done: entry } }, proof: [...(r.proof ?? []), ...proof] }, 'done', 'vault active');
    }
    return this.save(user, r, { status: next, d: { ...r.d, steps: { ...(r.d.steps as object), [step]: entry } }, proof: [...(r.proof ?? []), ...proof] }, step, ref || String(i.on));
  }

  private async vaultOf(id: Id) {
    await this.store.lock?.('vaults', id);
    const v = await this.store.get('vaults', id);
    if (!v) throw new NotFound('Vault');
    return v;
  }

  private async vaultChange(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.head(user, v.companyId))) throw new AccessDenied('arms.handle', '(company authority)');
    const d = { what: this.reason(i.what, 'what changes'), reason: this.reason(i.reason), policeRef: s(i.policeRef, 80), policeNeeded: i.policeNeeded === true };
    return this.create(user, 'vaultChange', 'BKU', { d, status: d.policeNeeded && !d.policeRef ? 'police_pending' : 'recorded', companyId: v.companyId, vaultId: v.id }, d.what);
  }

  /** R10: access by written authorisation, given by the A licence holder or the company manager, never by the person. */
  private async vaultAuth(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.head(user, v.companyId))) throw new AccessDenied('arms.handle', '(the A licence holder or the company manager authorises)');
    const personId = s(i.personId, 120) || null;
    const p = personId ? await this.store.get('people', personId) : undefined;
    if (personId && (!p || p.companyId !== v.companyId)) throw new BadRequest('Choose a staff member of this company.');
    const name = p?.name ?? this.reason(i.name, 'the name');
    if (user.personId && user.personId === personId) throw new BadRequest('Nobody authorises themselves.');
    if (user.name.toLowerCase() === name.toLowerCase()) throw new BadRequest('Nobody authorises themselves.');
    const letterRef = this.reason(i.letterRef, 'the authorisation letter reference');
    if (!isDate(i.letterOn)) throw new BadRequest('Give the letter date.');
    const entry = { personId, name, letterRef, letterOn: i.letterOn, givenBy: user.name, givenById: user.id, reason: this.reason(i.reason), removedOn: null, removedReason: null };
    // One active line per staff record (B2): two staff who share a name stay two lines.
    const same = (a: NonNullable<Vault['authorisedStaff']>[number]) => (personId ? a.personId === personId : !a.personId && a.name.toLowerCase() === name.toLowerCase());
    const list = [...(v.authorisedStaff ?? []).filter((a) => a.removedOn || !same(a)), entry];
    await this.writeAuth(user, v, list, `${name} authorised (${letterRef})`);
    return { ok: true, authorised: list.filter((a) => !a.removedOn).map((a) => a.name) };
  }
  private async vaultAuthRemove(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.head(user, v.companyId))) throw new AccessDenied('arms.handle', '(the A licence holder or the company manager)');
    const name = s(i.name, 120).toLowerCase();
    const personId = s(i.personId, 120) || null;
    const reason = this.reason(i.reason);
    // Removed by staff record when given; by name only when the name is on one active line (B2).
    const hit = (a: NonNullable<Vault['authorisedStaff']>[number]) => !a.removedOn && (personId ? a.personId === personId : a.name.toLowerCase() === name);
    const hits = (v.authorisedStaff ?? []).filter(hit).length;
    if (!hits) throw new BadRequest('That person is not on the authorised list.');
    if (hits > 1) throw new BadRequest('Two people on the list share this name. Choose the staff member.');
    const list = (v.authorisedStaff ?? []).map((a) => (hit(a) ? { ...a, removedOn: this.today(), removedReason: reason } : a));
    await this.writeAuth(user, v, list, `${s(i.name, 120)} removed: ${reason}`);
    return { ok: true };
  }
  /**
   * Name the vault's Amra or A licence holder by staff record (Part R7; 23 Nov 2026 review). Only the company head (the
   * company manager or a director with the company) names them, never themselves, always with a reason. A named Amra
   * then keeps that vault (arms_keeper wall). A blank person clears the post. The licence itself is checked by the
   * readiness lines, not here, so a person can be named while their AMRA licence is being applied for.
   */
  private async vaultKeeper(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.head(user, v.companyId))) throw new AccessDenied('arms.handle', '(the company manager names the Amra and the A licence holder)');
    const post = i.post === 'a_licence' ? 'a_licence' : i.post === 'amra' ? 'amra' : null;
    if (!post) throw new BadRequest('Choose the post: amra or a_licence.');
    const reason = this.reason(i.reason);
    const personId = s(i.personId, 120) || null;
    let name = '';
    if (personId) {
      const p = await this.store.get('people', personId);
      if (!p || p.companyId !== v.companyId) throw new BadRequest('Choose a staff member of this company.');
      if (p.status && p.status !== 'active') throw new BadRequest('That staff member is not active.');
      if (user.personId === personId) throw new BadRequest('Nobody names themselves.');
      name = p.name;
    }
    const patch = post === 'amra' ? { custodianPersonId: personId, custodian: name } : { aLicenceHolderPersonId: personId, aLicenceHolder: name };
    const label = post === 'amra' ? 'Amra' : 'A licence holder';
    await this.store.transaction(async (tx) => {
      await tx.update('vaults', v.id, patch as Partial<Vault>);
      await tx.audit({ at: this.now(), actor: user.name, companyId: v.companyId, action: 'arms.vault_keeper', entity: 'vault', entityId: v.id, summary: `${v.name}: ${label} ${name || 'cleared'}: ${reason}`.slice(0, 300) });
    });
    return { ok: true, vaultId: v.id, post, name: name || null };
  }
  private async writeAuth(user: User, v: Vault, list: NonNullable<Vault['authorisedStaff']>, note: string) {
    await this.store.transaction(async (tx) => {
      await tx.update('vaults', v.id, { authorisedStaff: list, authorisedUsers: list.filter((a) => !a.removedOn).map((a) => a.name) });
      await tx.audit({ at: this.now(), actor: user.name, companyId: v.companyId, action: 'arms.vault_access', entity: 'vault', entityId: v.id, summary: note.slice(0, 300) });
    });
  }

  private async vaultLog(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.handles(user, v.companyId))) throw new AccessDenied('arms.handle', v.companyId);
    const d = { person: this.reason(i.person, 'who entered'), inAt: s(i.inAt, 30) || this.now(), outAt: s(i.outAt, 30) || null, purpose: this.reason(i.purpose, 'the purpose'), witness: this.reason(i.witness, 'the witness') };
    if (d.witness.toLowerCase() === d.person.toLowerCase()) throw new BadRequest('The witness is someone else.');
    const authorised = (v.authorisedUsers ?? []).map((x) => x.toLowerCase());
    const ok = !authorised.length || authorised.includes(d.person.toLowerCase());
    const r = await this.create(user, 'vaultLog', 'LBK', { d: { ...d, authorised: ok }, status: ok ? 'logged' : 'unauthorised', companyId: v.companyId, vaultId: v.id }, `${d.person} ${d.purpose}`);
    if (!ok) await this.vaultBreach(user, { vaultId: v.id, what: `${d.person} entered and is not on the authorised list (${r.ref})` });
    return r;
  }

  /** "Akses tidak sah": a P1 case to the company head, Arms Control and CMS at once; any police report goes on the case. */
  private async vaultBreach(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.handles(user, v.companyId))) throw new AccessDenied('arms.handle', v.companyId);
    const what = this.reason(i.what, 'what happened');
    const c = await this.svc.openArmsPolicyCase(user.name, { companyId: v.companyId, siteId: v.siteId ?? null, severity: 'P1', title: `Akses tidak sah: ${v.name}`, description: `${what}. The company head, Arms Control and CMS act; a police report, if made, is recorded on this case.` });
    return { ok: true, caseRef: c.ref };
  }

  private async vaultInspect(user: User, i: Record<string, unknown>) {
    const v = await this.vaultOf(s(i.vaultId, 120));
    if (!(await this.handles(user, v.companyId))) throw new AccessDenied('arms.handle', v.companyId);
    const checks = Object.fromEntries(['inventory', 'accessList', 'approval', 'sop'].map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const actions = (Array.isArray(i.actions) ? (i.actions as Record<string, unknown>[]) : []).slice(0, 20).map((a) => ({ what: s(a.what, 300), owner: s(a.owner, 120), due: isDate(a.due) ? a.due : null, doneOn: null as IsoDate | null }));
    const failed = Object.values(checks).some((x) => !x);
    if (failed && !actions.length) throw new BadRequest('A non-compliance needs a corrective action with an owner and a date.');
    if (actions.some((a) => a.what.length < 3 || a.owner.length < 2 || !a.due)) throw new BadRequest('Each corrective action needs what, the owner and a date.');
    const serious = i.serious === true;
    const d = { checks, faults: s(i.faults, 500), actions, serious, reportToAuthority: serious ? 'for the company to decide' : null, on: this.today() };
    return this.create(user, 'vaultInspect', 'PBK', { d, status: failed ? (serious ? 'serious' : 'actions') : 'ok', companyId: v.companyId, vaultId: v.id, proof: this.proofs(user, i.photos) }, failed ? `${actions.length} action(s)` : 'ok');
  }
  private async vaultActionDone(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'vaultInspect');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const k = int(i.index);
    const actions = [...((r.d.actions as { doneOn: IsoDate | null }[]) ?? [])];
    if (!actions[k]) throw new NotFound('Action');
    actions[k] = { ...actions[k], doneOn: this.today() };
    const open = actions.some((a) => !a.doneOn);
    return this.save(user, r, { d: { ...r.d, actions }, status: open ? r.status : 'closed' }, 'action_done', this.reason(i.note, 'what was done'));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // D. Buying firearms and ammunition (R12-R18)
  // ---------------------------------------------------------------------------------------------------------------

  private async request(id: Id): Promise<ArmsRequest> {
    const r = await this.store.get('armsRequests', id);
    if (!r) throw new NotFound('Arms request');
    return r;
  }

  /** R13: a supplier with a valid dealer or service licence on file, on the purchase date. Null when fine. */
  async dealerProblem(r: Pick<ArmsRequest, 'kind' | 'supplierId'>): Promise<string | null> {
    if (r.kind !== 'ACQUIRE' && r.kind !== 'SERVICE') return null;
    if (!r.supplierId) return 'Name the licensed dealer (supplier) on the request.';
    const sup = await this.store.get('armsSuppliers', r.supplierId);
    if (!sup) return 'The supplier is not in the supplier file.';
    if (!sup.licenceRef || !sup.licenceExpiresOn) return `${sup.name}: no dealer licence on file. Only licensed dealers.`;
    if (sup.licenceExpiresOn < this.today()) return `${sup.name}: dealer licence expired ${sup.licenceExpiresOn}.`;
    return null;
  }

  /** R12: the internal purchase form on an ACQUIRE request, with what the company holds against what it needs. */
  private async buyForm(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (r.kind !== 'ACQUIRE') throw new BadRequest('The purchase form is for a buy request.');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    if (!['draft', 'submitted', 'arms_review'].includes(r.state)) throw new BadRequest('The form is filled before Arms Control passes it.');
    const gap = await this.holdings(r.companyId);
    const kind = s(i.firearmKind, 30) || null;
    const qty = Math.max(0, int(i.firearmQty) || 0);
    const need = kind ? (gap.byKind[kind]?.gap ?? 0) : 0;
    const extraReason = s(i.extraReason, 300);
    if (qty > Math.max(0, need) && extraReason.length < 3) throw new BadRequest(`The posts and jobs need ${Math.max(0, need)} more ${kind ?? 'firearm(s)'}. Give a reason to ask for more (spares, replacement).`);
    const form = {
      purpose: this.reason(i.purpose, 'the purpose'),
      firearmKind: kind,
      firearmQty: qty,
      calibre: s(i.calibre, 30) || null,
      rounds: Math.max(0, int(i.rounds) || 0),
      location: s(i.location, 200),
      namedPersonIds: Array.isArray(i.namedPersonIds) ? (i.namedPersonIds as unknown[]).map((x) => s(x, 120)).filter(Boolean).slice(0, 50) : [],
      justification: this.reason(i.justification, 'the operational justification'),
      extraReason,
    };
    await this.store.transaction(async (tx) => {
      await tx.update('armsRequests', r.id, { buyForm: form });
      await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'arms.buy_form', entity: 'arms_request', entityId: r.id, summary: `${r.ref}: ${qty} ${kind ?? ''} ${form.rounds} rounds` });
    });
    return { ok: true, form, holdings: gap };
  }

  /** Firearms held by type (in vault, issued, out of use) next to the need from signed armed posts and booked armed jobs. */
  async holdings(companyId: Id) {
    const [fs, agreements, jobs] = await Promise.all([this.store.list('firearms', { companyId }), this.store.list('armsAgreements', { companyId }), this.store.list('armedJobs', { companyId })]);
    const byKind: Record<string, { inVault: number; issued: number; outOfUse: number; gap: number }> = {};
    for (const f of fs.filter((x) => x.status !== 'LOST' && x.status !== 'OFF_REGISTER' && x.ownership !== 'TRADE')) {
      const b = (byKind[f.kind] ??= { inVault: 0, issued: 0, outOfUse: 0, gap: 0 });
      if (f.status === 'IN_VAULT') b.inVault++;
      else if (f.status === 'ISSUED') b.issued++;
      else b.outOfUse++;
    }
    const posts = agreements.filter((a) => !a.endsOn || a.endsOn >= this.today()).reduce((sum, a) => sum + (a.armedPosts || 0), 0);
    const jobsOpen = jobs.filter((j) => !['done', 'closed', 'cancelled', 'completed'].includes(String((j as { status?: string }).status ?? ''))).length;
    const usable = Object.values(byKind).reduce((sum, b) => sum + b.inVault + b.issued, 0);
    const need = posts + jobsOpen;
    for (const k of ['Shotgun', 'Revolver', 'Pistol']) (byKind[k] ??= { inVault: 0, issued: 0, outOfUse: 0, gap: 0 }).gap = Math.max(0, need - usable);
    return { posts, jobsOpen, usable, need, byKind };
  }

  private async pack(user: User, r: ArmsRequest) {
    let p = (await this.all()).find((x) => x.kind === 'buyPack' && x.requestId === r.id);
    if (!p) p = await this.create(user, 'buyPack', 'PSA', { d: { docs: {}, followUps: [], stages: {} }, status: 'preparing', companyId: r.companyId, requestId: r.id }, r.ref);
    return p;
  }
  /** R14: what Prima already holds (keyed once) and what is still missing in the police application pack. */
  async packState(r: ArmsRequest, p: ArmsPolicyRec | undefined) {
    const { docs } = await this.values();
    const filed = (p?.d.docs ?? {}) as Record<string, string>;
    const today = this.today();
    const [lic, contracts, creds, vaults] = await Promise.all([
      this.store.list('licences', { companyId: r.companyId }).catch(() => []),
      this.store.list('contracts', { companyId: r.companyId }).catch(() => []),
      this.store.list('credentials', { companyId: r.companyId }).catch(() => []),
      this.store.list('vaults', { companyId: r.companyId }),
    ]);
    const fromRecords: Record<string, string> = {};
    if ((lic as { kind?: string; expiresOn?: IsoDate | null }[]).some((l) => (!l.expiresOn || l.expiresOn >= today) && /kdn/i.test(String(l.kind ?? 'KDN')))) fromRecords.kdn_licence = 'KDN licence (company licences)';
    if ((contracts as unknown[]).length) fromRecords.contract = 'contract (contracts)';
    const holders = vaults.map((v) => v.aLicenceHolderPersonId).filter(Boolean) as Id[];
    if (holders.some((h) => validLicence(creds, h, 'PELESEN_A', today))) fromRecords.pelesen_a_book = 'Pelesen A licence (arms licences)';
    const items = docs.pack.map((k) => ({ key: k, filed: !!filed[k], fromRecords: fromRecords[k] ?? null }));
    return { items, missing: items.filter((x) => !x.filed && !x.fromRecords).map((x) => x.key) };
  }
  private async packFile(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const { docs } = await this.values();
    const key = s(i.key, 60);
    if (!docs.pack.includes(key)) throw new BadRequest('Not on the document list.');
    const proof = this.proofs(user, i.docs);
    if (!proof.length) throw new BadRequest('Attach the document.');
    const p = await this.pack(user, r);
    return this.save(user, p, { d: { ...p.d, docs: { ...(p.d.docs as object), [key]: proof[0].sha256 } }, proof: [...(p.proof ?? []), ...proof] }, 'doc', key);
  }
  private async ipdSent(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const p = await this.pack(user, r);
    const st = await this.packState(r, p);
    if (st.missing.length) throw new BadRequest(`Not complete: ${st.missing.join(', ')}.`);
    if (!isDate(i.on) || i.on > this.today()) throw new BadRequest('Give the date it was sent.');
    const proof = this.proofs(user, i.docs);
    if (!proof.length) throw new BadRequest('Attach the proof of receipt.');
    return this.save(user, p, { status: 'submitted', d: { ...p.d, sentOn: i.on, ipdRef: this.reason(i.ipdRef, 'the IPD reference') }, proof: [...(p.proof ?? []), ...proof] }, 'sent', String(i.ipdRef));
  }
  private async ipdStage(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const p = await this.pack(user, r);
    if (p.status !== 'submitted') throw new BadRequest('Record that it was sent to the IPD first.');
    const stage = (['IPD', 'IPK', 'BUKIT_AMAN', 'VISIT'] as const).find((k) => k === i.stage);
    if (!stage || !isDate(i.on)) throw new BadRequest('Choose the stage and its date.');
    return this.save(user, p, { d: { ...p.d, stages: { ...(p.d.stages as object), [stage]: { on: i.on, note: s(i.note, 300) } } }, proof: [...(p.proof ?? []), ...this.proofs(user, i.docs)] }, 'stage', `${stage} ${i.on}`);
  }

  /** R16: the approval letter's details replace the single reference; any change needs a new police approval. */
  private async approvalLetter(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (r.kind !== 'ACQUIRE') throw new BadRequest('Approval letters here are for buy requests.');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    if (!isDate(i.on) || i.on > this.today()) throw new BadRequest('Give the letter date.');
    const copy = this.proofs(user, i.docs);
    if (!copy.length) throw new BadRequest('Attach the approval letter.');
    const letter = {
      permitNo: this.reason(i.permitNo, 'the permit or licence number'),
      on: i.on,
      validUntil: isDate(i.validUntil) ? i.validUntil : null,
      firearmKind: s(i.firearmKind, 30) || null,
      firearmQty: Math.max(0, int(i.firearmQty) || 0),
      calibre: s(i.calibre, 30) || null,
      rounds: Math.max(0, int(i.rounds) || 0),
      conditions: s(i.conditions, 500),
      holderName: this.reason(i.holderName, "the licence holder's name"),
      docId: copy[0].sha256,
    };
    const p = await this.pack(user, r);
    await this.save(user, p, { status: 'approved', proof: [...(p.proof ?? []), ...copy], d: { ...p.d, letters: [...((p.d.letters as unknown[]) ?? []), letter] } }, 'letter', letter.permitNo);
    await this.store.transaction(async (tx) => {
      await tx.update('armsRequests', r.id, { approvalLetter: letter, policeApproval: r.policeApproval ?? { ref: letter.permitNo, on: letter.on } });
      await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'arms.approval_letter', entity: 'arms_request', entityId: r.id, summary: `${r.ref}: ${letter.permitNo} ${letter.on}, ${letter.firearmQty} ${letter.firearmKind ?? ''} ${letter.rounds} ${letter.calibre ?? ''}; Operations and Finance told` });
    });
    return { ok: true, letter };
  }

  /** R-X6: inside 14 days of the approval letter; after day 14 no order, receipt or reconcile on that approval. Null when fine. */
  windowProblem(r: Pick<ArmsRequest, 'kind' | 'approvalLetter' | 'ref'>, today: IsoDate, days = RULES.armsPolicy.value.buyWindowDays): string | null {
    if (r.kind !== 'ACQUIRE') return null;
    if (!r.approvalLetter) return 'Record the police approval letter (number, date, type, quantity, calibre, rounds, copy) first.';
    if (daysBetween(r.approvalLetter.on, today) > days) return `Lebih ${days} hari dari surat kelulusan (${r.approvalLetter.on}). Record a new or extended police approval before buying.`;
    if (r.approvalLetter.validUntil && r.approvalLetter.validUntil < today) return 'The police approval has expired.';
    return null;
  }
  private async order(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const w = this.windowProblem(r, this.today(), (await this.values()).pol.buyWindowDays);
    if (w) throw new BadRequest(w);
    const dealer = await this.dealerProblem(r);
    if (dealer) throw new BadRequest(dealer);
    const p = await this.pack(user, r);
    return this.save(user, p, { d: { ...p.d, order: { on: this.today(), poRef: this.reason(i.poRef, 'the order reference'), by: user.name } } }, 'order', String(i.poRef));
  }

  /** R17: receiving by an appointed officer who is not the requester; a mismatch opens a case. */
  private async armsGrn(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (r.kind !== 'ACQUIRE') throw new BadRequest('Receiving is for a buy request.');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    if ((r.raisedById && r.raisedById === user.id) || r.raisedBy === user.name) throw new BadRequest('An appointed officer who is not the requester receives.');
    const w = this.windowProblem(r, this.today(), (await this.values()).pol.buyWindowDays);
    if (w) throw new BadRequest(w);
    const L = r.approvalLetter!;
    const firearms = (Array.isArray(i.firearms) ? (i.firearms as Record<string, unknown>[]) : []).slice(0, 100).map((f) => ({ tag: s(f.tag, 30), kind: s(f.kind, 30), serial: s(f.serial, 60), rfidTag: s(f.rfidTag, 60) || null, licenceRef: s(f.licenceRef, 60), licenceExpiresOn: isDate(f.licenceExpiresOn) ? f.licenceExpiresOn : null, vaultId: s(f.vaultId, 120) }));
    if (firearms.some((f) => f.tag.length < 2 || f.serial.length < 3 || !f.vaultId)) throw new BadRequest('Each firearm received needs its tag, serial and vault.');
    if (firearms.length > L.firearmQty) throw new BadRequest(`More firearms than the approval allows (${L.firearmQty}).`);
    if (L.firearmKind && firearms.some((f) => f.kind !== L.firearmKind)) throw new BadRequest(`The approval is for ${L.firearmKind} only.`);
    const rounds = Math.max(0, int(i.roundsCounted) || 0);
    if (rounds > L.rounds) throw new BadRequest(`More rounds than the approval allows (${L.rounds}).`);
    if (rounds && L.calibre && s(i.calibre, 30) && s(i.calibre, 30).toLowerCase() !== L.calibre.toLowerCase()) throw new BadRequest(`The approval is for ${L.calibre} only.`);
    // V16: the serial is typed twice and must match; no serial twice in the group (the batch included).
    const norm = (x: string) => x.toUpperCase().replace(/\s+/g, '');
    const typed = (Array.isArray(i.firearms) ? (i.firearms as Record<string, unknown>[]) : []).slice(0, 100);
    if (typed.some((f) => norm(s(f.serialConfirm, 60)) !== norm(s(f.serial, 60)))) throw new BadRequest('Type each serial number twice; the two must match.');
    const seen = new Set<string>();
    const existing = new Set((await this.store.list('firearms', {})).map((f) => norm(f.serial ?? '')).filter(Boolean));
    for (const f of firearms) {
      const k = norm(f.serial);
      if (seen.has(k) || existing.has(k)) throw new BadRequest(`Serial ${f.serial} is already recorded. A firearm is registered once.`);
      seen.add(k);
    }
    for (const f of firearms) {
      const v = await this.store.get('vaults', f.vaultId);
      if (!v || v.companyId !== r.companyId) throw new BadRequest('Choose a vault of this company.');
      if (v.state === 'APPLYING') throw new BadRequest(`${v.name} is still being applied for. No firearm can be placed in it.`);
    }
    const checks = Object.fromEntries(['quantity', 'type', 'serials', 'deliveryOrder', 'invoice', 'condition', 'approvalLetter', 'supplier'].map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const mismatch = Object.values(checks).some((x) => !x);
    const d = { firearms, roundsCounted: rounds, calibre: L.calibre, doNo: this.reason(i.doNo, 'the delivery order number'), invoiceNo: s(i.invoiceNo, 60), checks, mismatch, note: s(i.note, 500), caseRef: null as string | null, confirmed: null as unknown };
    if (mismatch && (d.note as string).length < 3) throw new BadRequest('Say what does not match.');
    let rec = await this.create(user, 'armsGrn', 'TRM', { d, status: mismatch ? 'mismatch' : 'ok', companyId: r.companyId, requestId: r.id, proof: this.proofs(user, i.docs) }, `${r.ref}: ${firearms.length} firearm(s), ${rounds} rounds${mismatch ? ' MISMATCH' : ''}`);
    if (mismatch) {
      const c = await this.svc.openArmsPolicyCase(user.name, { companyId: r.companyId, siteId: null, severity: 'P2', title: `Penerimaan senjata tidak sepadan: ${r.ref}`, description: `${rec.ref}: ${d.note}` });
      rec = await this.save(user, rec, { d: { ...rec.d, caseRef: c.ref } }, 'case', c.ref);
    }
    return rec;
  }
  private async grnConfirm(user: User, i: Record<string, unknown>) {
    const rec = await this.get(s(i.id, 120), 'armsGrn');
    if (rec.status !== 'mismatch') throw new BadRequest('Nothing to confirm.');
    if (!(await this.head(user, rec.companyId))) throw new BadRequest('The responsible person (company manager, A licence holder) confirms.');
    return this.save(user, rec, { status: 'confirmed', d: { ...rec.d, confirmed: { byId: user.id, by: user.name, at: this.now(), reason: this.reason(i.reason) } } }, 'confirmed', s(i.reason, 200));
  }
  /** What the reconcile of a buy request may add: the receiving record, within the approval letter and window. */
  async reconcileBuy(r: ArmsRequest): Promise<{ grn: ArmsPolicyRec } | null> {
    if (r.kind !== 'ACQUIRE') return null;
    const recs = await this.all().catch(() => null);
    if (!recs) return null;
    const w = this.windowProblem(r, this.today(), (await this.values()).pol.buyWindowDays);
    if (w) throw new BadRequest(w);
    const dealer = await this.dealerProblem(r);
    if (dealer) throw new BadRequest(dealer);
    const grn = recs.filter((x) => x.kind === 'armsGrn' && x.requestId === r.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!grn) throw new BadRequest('Record the receiving check first (by an officer who is not the requester).');
    if (grn.status === 'mismatch') throw new BadRequest('The receiving mismatch is not confirmed yet.');
    return { grn };
  }
  private async armsBudget(user: User, i: Record<string, unknown>) {
    const r = await this.request(s(i.requestId, 120));
    if (!this.finance(user)) throw new AccessDenied('view', '(the company’s assigned Finance team records the budget check)');
    const p = await this.pack(user, r);
    const available = i.available === 'yes' ? 'ada' : i.available === 'no' ? 'tiada' : null;
    if (!available) throw new BadRequest('Say whether the budget is available.');
    return this.save(user, p, { d: { ...p.d, budget: { available, comment: this.reason(i.comment, 'a comment'), by: user.name, at: this.now() } } }, 'budget', available);
  }

  /** R18: the purchase file, sections A-F, what is filed and what is missing. */
  async buyFile(user: User, requestId: Id) {
    const r = await this.request(requestId);
    if (!(await this.views(user, r.companyId))) throw new AccessDenied('arms.view', r.companyId);
    const recs = (await this.all()).filter((x) => x.requestId === r.id);
    const p = recs.find((x) => x.kind === 'buyPack');
    const pack = await this.packState(r, p);
    const grn = recs.filter((x) => x.kind === 'armsGrn');
    const cases = grn.map((g) => g.d.caseRef).filter(Boolean);
    return {
      ref: r.ref,
      sections: [
        { key: 'A', title: 'Permohonan', filed: [r.buyForm ? 'borang permohonan' : null, ...(r.log ?? []).map((l) => `${l.action} by ${l.by}`)].filter(Boolean), missing: r.buyForm ? [] : ['borang permohonan'] },
        { key: 'B', title: 'Dokumen kuasa', filed: pack.items.filter((x) => x.filed || x.fromRecords).map((x) => x.key), missing: pack.missing },
        { key: 'C', title: 'Pembelian', filed: [r.approvalLetter ? `surat kelulusan ${r.approvalLetter.permitNo}` : null, p?.d.order ? 'pesanan' : null, p?.d.budget ? 'semakan bajet' : null].filter(Boolean), missing: [r.approvalLetter ? null : 'surat kelulusan', p?.d.order ? null : 'pesanan'].filter(Boolean) },
        { key: 'D', title: 'Inventori', filed: grn.map((g) => `${g.ref} ${g.status}`), missing: grn.length ? [] : ['penerimaan'] },
        { key: 'E', title: 'Semakan / audit', filed: r.state === 'verified' || r.state === 'reconciled' || r.state === 'closed' ? ['disahkan'] : [], missing: [] },
        { key: 'F', title: 'Insiden', filed: cases as string[], missing: [] },
      ],
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // E. Bulletproof jackets (R19-R22): Goodwill owns them (R-X7), item register category ballistic_vest (R-X8)
  // ---------------------------------------------------------------------------------------------------------------

  private async jacketOf(id: Id) {
    return this.get(id, 'jacket');
  }
  private async jacket(user: User, i: Record<string, unknown>) {
    if (!this.stores(user) && !this.ac(user)) throw new AccessDenied('view', '(the store team registers jackets)');
    const serial = this.reason(i.serial, 'the serial number');
    if ((await this.all()).some((r) => r.kind === 'jacket' && String(r.d.serial).toLowerCase() === serial.toLowerCase())) throw new BadRequest('A jacket with this serial is already registered.');
    const d = {
      itemToken: s(i.itemToken, 40),
      maker: this.reason(i.maker, 'the maker'),
      model: this.reason(i.model, 'the model'),
      size: s(i.size, 20),
      serial,
      level: s(i.level, 60),
      standard: s(i.standard, 60),
      madeOn: isDate(i.madeOn) ? i.madeOn : null,
      warrantyEnd: isDate(i.warrantyEnd) ? i.warrantyEnd : null,
      serviceLifeEnd: isDate(i.serviceLifeEnd) ? i.serviceLifeEnd : null,
      instructions: s(i.instructions, 500),
      receivedOn: isDate(i.receivedOn) ? i.receivedOn : this.today(),
      location: s(i.location, 120),
      holder: null as string | null,
      issues: [] as unknown[],
    };
    return this.create(user, 'jacket', 'JKP', { d, status: 'available', companyId: s(i.companyId, 60) || 'goodwill', proof: this.proofs(user, i.docs) }, `${d.model} ${serial}`);
  }
  private async jacketBuy(user: User, i: Record<string, unknown>) {
    if (user.integration) throw new AccessDenied('view', '(jacket purchase)');
    const d = {
      purRequestRef: s(i.purRequestRef, 60),
      project: this.reason(i.project, 'the project or location'),
      purpose: this.reason(i.purpose, 'the purpose'),
      guards: Math.max(0, int(i.guards) || 0),
      held: Math.max(0, int(i.held) || 0),
      needed: Math.max(0, int(i.needed) || 0),
      justification: this.reason(i.justification, 'the justification'),
      estCost: n(i.estCost) || 0,
      checklist: Object.fromEntries(JACKET_BUY_CHECKLIST.map((k) => [k, (i.checklist as Record<string, unknown> | undefined)?.[k] === true])),
      needConfirmed: null as unknown,
      specConfirmed: null as unknown,
      spec: s(i.spec, 500),
      quotes: [] as unknown[],
      chosen: null as unknown,
      requesterId: user.id,
      splitWarning: null as string | null,
    };
    d.splitWarning = await this.splitWarning(d.project, null);
    return this.create(user, 'jacketBuy', 'BJK', { d, status: 'submitted', companyId: s(i.companyId, 60) || user.companyIds[0] || 'goodwill' }, `${d.needed} jacket(s) for ${d.project}`);
  }
  private async splitWarning(_project: string, supplier: string | null) {
    const days = (await this.values()).pol.jacketSplitDays;
    const since = addDays(this.today(), -days);
    const recent = (await this.all()).filter((r) => r.kind === 'jacketBuy' && dateOf(r.at) >= since && (!supplier || (r.d.chosen as { supplier?: string } | null)?.supplier === supplier));
    return recent.length ? `Jaket diminta lagi dalam ${days} hari (${recent.map((r) => r.ref).join(', ')}): no splitting to dodge an approval limit.` : null;
  }
  private async jacketBuyStep(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'jacketBuy');
    const step = s(i.step, 20);
    const st = { byId: user.id, by: user.name, at: this.now(), reason: this.reason(i.reason ?? i.note ?? 'recorded') };
    if (step === 'need') {
      // The security / operations side confirms the need and the location.
      if (user.integration || !(user.role === 'company_manager' || user.opsTier || this.ac(user))) throw new AccessDenied('view', '(security or operations confirms the need)');
      if (user.id === r.d.requesterId) throw new BadRequest('Someone other than the requester confirms the need.');
      return this.save(user, r, { d: { ...r.d, needConfirmed: st } }, 'need', st.reason);
    }
    if (step === 'spec') {
      if (!(await this.mgr(user))) throw new AccessDenied('arms.view', '(Arms Control sets and confirms the specification)');
      const spec = this.reason(i.spec, 'the specification');
      return this.save(user, r, { d: { ...r.d, spec, specConfirmed: st } }, 'spec', spec);
    }
    if (step === 'quotes') {
      if (!this.stores(user)) throw new AccessDenied('view', '(Procurement records quotes)');
      if (!r.d.specConfirmed) throw new BadRequest('The specification is confirmed by a competent person before it goes into the quote request.');
      const quotes = (Array.isArray(i.quotes) ? (i.quotes as Record<string, unknown>[]) : []).slice(0, 10).map((q) => ({ supplier: s(q.supplier, 120), price: n(q.price), specMet: q.specMet === true, docs: q.docs === true, warrantyMonths: Math.max(0, int(q.warrantyMonths) || 0), deliveryDays: Math.max(0, int(q.deliveryDays) || 0), fit: s(q.fit, 200), terms: s(q.terms, 200) }));
      if (quotes.length < RULES.itBuy.value.quotesNeeded || quotes.some((q) => q.supplier.length < 2 || !(q.price > 0))) throw new BadRequest(`Give at least ${RULES.itBuy.value.quotesNeeded} quotes with supplier and price.`);
      return this.save(user, r, { d: { ...r.d, quotes } }, 'quotes', `${quotes.length} quotes`);
    }
    if (step === 'choose') {
      if (!this.stores(user)) throw new AccessDenied('view', '(Procurement recommends)');
      const q = ((r.d.quotes as { supplier: string; specMet: boolean; docs: boolean }[]) ?? []).find((x) => x.supplier === s(i.supplier, 120));
      if (!q) throw new BadRequest('Choose one of the recorded quotes.');
      if (!q.specMet) throw new BadRequest('Price alone cannot win: this quote does not meet the specification.');
      if (!q.docs) throw new BadRequest('A supplier who cannot give product documents cannot be chosen.');
      const warn = await this.splitWarning(String(r.d.project), q.supplier);
      return this.save(user, r, { status: 'chosen', d: { ...r.d, chosen: { supplier: q.supplier, ...st }, splitWarning: warn ?? r.d.splitWarning } }, 'choose', q.supplier);
    }
    throw new BadRequest('Unknown step.');
  }
  private async jacketGrn(user: User, i: Record<string, unknown>) {
    const b = await this.get(s(i.buyId, 120), 'jacketBuy');
    if (!this.stores(user) && !this.ac(user)) throw new AccessDenied('view', '(the store team receives)');
    if (user.id === b.d.requesterId) throw new BadRequest('An officer who is not the requester receives.');
    const checks = Object.fromEntries(JACKET_RECEIVE_CHECKS.map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const mismatch = Object.values(checks).some((x) => !x);
    if (mismatch && s(i.note, 300).length < 3) throw new BadRequest('Say what does not match; it is referred to the supplier before final acceptance.');
    const r = await this.create(user, 'jacketGrn', 'TJK', { d: { checks, mismatch, note: s(i.note, 300), qty: Math.max(0, int(i.qty) || 0) }, status: mismatch ? 'referred_to_supplier' : 'accepted', companyId: b.companyId, requestId: b.id }, mismatch ? 'mismatch' : 'accepted');
    if (!mismatch) await this.save(user, b, { status: 'received' }, 'received', r.ref);
    return r;
  }
  /** R21: issue as Lampiran D; a jacket is never passed guard to guard: it is returned and recorded, then issued again. */
  private async jacketIssue(user: User, i: Record<string, unknown>) {
    const j = await this.jacketOf(s(i.id, 120));
    if (!(await this.jacketHandler(user))) throw new AccessDenied('view', '(the officer or store team issues jackets)');
    if (j.status === 'issued') throw new BadRequest(`Jaket ini masih dengan ${String(j.d.holder)}. Pulangkan dan rekod dahulu, kemudian keluarkan semula.`);
    if (j.status !== 'available') throw new BadRequest(`This jacket is ${j.status} and cannot be issued.`);
    const guard = this.reason(i.guard, 'the guard');
    const confirm = i.guardConfirmed === true;
    const slip = this.proofs(user, i.slip);
    if (!confirm && !slip.length) throw new BadRequest("The guard confirms, or attach the signed slip photo (guards on JA).");
    const issue = { guard, staffNo: s(i.staffNo, 30), siteId: s(i.siteId, 120), on: this.today(), condition: this.reason(i.condition, 'the condition at issue'), confirmedBy: confirm ? 'guard' : 'signed slip', by: user.name, returnedOn: null as IsoDate | null, returnCondition: null as string | null };
    return this.save(user, j, { status: 'issued', d: { ...j.d, holder: guard, issues: [...((j.d.issues as unknown[]) ?? []), issue] }, proof: [...(j.proof ?? []), ...slip] }, 'issue', `${guard} at ${issue.siteId}`);
  }
  private async jacketHandler(user: User) {
    return this.stores(user) || this.ac(user) || user.role === 'supervisor' || user.role === 'company_manager';
  }
  private async jacketReturn(user: User, i: Record<string, unknown>) {
    const j = await this.jacketOf(s(i.id, 120));
    if (!(await this.jacketHandler(user))) throw new AccessDenied('view', '(the officer or store team)');
    if (j.status !== 'issued') throw new BadRequest('This jacket is not issued.');
    const condition = this.reason(i.condition, 'the condition on return');
    const issues = [...((j.d.issues as { returnedOn: IsoDate | null }[]) ?? [])];
    issues[issues.length - 1] = { ...issues[issues.length - 1], returnedOn: this.today(), returnCondition: condition } as never;
    return this.save(user, j, { status: 'available', d: { ...j.d, holder: null, issues } }, 'return', condition);
  }
  /** A shift handover in one screen: the return and the new issue are both recorded. */
  private async jacketHandover(user: User, i: Record<string, unknown>) {
    await this.jacketReturn(user, { id: i.id, condition: i.returnCondition });
    return this.jacketIssue(user, { ...i, condition: i.issueCondition ?? i.returnCondition });
  }
  private async jacketInspect(user: User, i: Record<string, unknown>) {
    const j = await this.jacketOf(s(i.id, 120));
    if (!(await this.jacketHandler(user))) throw new AccessDenied('view', '(jacket inspection)');
    const checks = Object.fromEntries(JACKET_INSPECT_CHECKS.map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const result = (['BOLEH_DIGUNAKAN', 'PERLU_PEMERIKSAAN_LANJUT', 'DIKUARANTIN', 'PERLU_DIGANTI'] as const).find((k) => k === i.result);
    if (!result) throw new BadRequest('Choose the result.');
    if (result === 'BOLEH_DIGUNAKAN' && Object.values(checks).some((x) => !x)) throw new BadRequest('A failed check cannot be "boleh digunakan".');
    const rec = await this.create(user, 'jacketInspect', 'PJK', { d: { checks, result, note: s(i.note, 300), jacketRef: j.ref }, status: result, companyId: j.companyId, requestId: j.id, proof: this.proofs(user, i.photos) }, `${j.ref}: ${result}`);
    if (result !== 'BOLEH_DIGUNAKAN' && j.status !== 'issued') await this.save(user, j, { status: 'quarantine', d: { ...j.d, quarantineBy: user.id, inspectRef: rec.ref } }, 'quarantine', result);
    if (result !== 'BOLEH_DIGUNAKAN' && j.status === 'issued') await this.save(user, j, { d: { ...j.d, recallBy: user.id, inspectRef: rec.ref } }, 'recall', `${result}: recall from ${String(j.d.holder)}`);
    return rec;
  }
  private async jacketDecide(user: User, i: Record<string, unknown>) {
    const j = await this.jacketOf(s(i.id, 120));
    if (!this.ac(user) && !this.stores(user)) throw new AccessDenied('view', '(jacket decision)');
    if (j.status !== 'quarantine') throw new BadRequest('Only a jacket in quarantine.');
    if (j.d.quarantineBy === user.id) throw new BadRequest('Someone other than the inspector decides.');
    const decision = (['reuse', 'replace', 'dispose', 'maker_repair'] as const).find((k) => k === i.decision);
    if (!decision) throw new BadRequest('Choose reuse, replace, dispose or repair by the maker (nobody repairs protective panels in-house).');
    const reason = this.reason(i.reason);
    const status = decision === 'reuse' ? 'available' : decision === 'dispose' ? 'disposed' : decision === 'replace' ? 'replaced' : 'maker_repair';
    return this.save(user, j, { status, d: { ...j.d, decision: { decision, byId: user.id, by: user.name, at: this.now(), reason } } }, decision, reason);
  }
  private async jacketLoss(user: User, i: Record<string, unknown>) {
    const j = await this.jacketOf(s(i.id, 120));
    if (!(await this.jacketHandler(user))) throw new AccessDenied('view', '(jacket loss report)');
    const d = { on: isDate(i.on) ? i.on : this.today(), place: this.reason(i.place, 'where'), holder: s(i.holder, 120) || String(j.d.holder ?? ''), what: this.reason(i.what, 'what happened'), action: this.reason(i.action, 'the action taken') };
    return this.save(user, j, { status: 'lost', d: { ...j.d, loss: d } }, 'lost', `${d.place}: ${d.what}`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // G. Dealer licence preparation and readiness (R28-R31). Trading stays OFF.
  // ---------------------------------------------------------------------------------------------------------------

  private async dealerApp(user: User, i: Record<string, unknown>) {
    const companyId = s(i.companyId, 60);
    if (!(await this.head(user, companyId))) throw new AccessDenied('arms.handle', '(the company manager prepares)');
    if ((await this.all()).some((r) => r.kind === 'dealerApp' && r.companyId === companyId && !['issued', 'closed'].includes(r.status))) throw new BadRequest('An application for this company is already open.');
    return this.create(user, 'dealerApp', 'LPS', { d: { docs: {}, followUps: [], placeOfBusiness: this.reason(i.placeOfBusiness, 'the place of business (one place per licence)') }, status: 'preparing', companyId }, String(i.placeOfBusiness));
  }
  private async dealerStep(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'dealerApp');
    if (!(await this.handles(user, r.companyId))) throw new AccessDenied('arms.handle', r.companyId ?? '(arms)');
    const step = s(i.step, 20);
    const { docs } = await this.values();
    if (step === 'doc') {
      const key = s(i.key, 60);
      if (!docs.dealer.includes(key)) throw new BadRequest('Not on the document list.');
      const proof = this.proofs(user, i.docs);
      if (!proof.length) throw new BadRequest('Attach the document.');
      return this.save(user, r, { d: { ...r.d, docs: { ...(r.d.docs as object), [key]: proof[0].sha256 } }, proof: [...(r.proof ?? []), ...proof] }, 'doc', key);
    }
    if (step === 'approve') {
      if (user.role !== 'director' || !(await this.head(user, r.companyId))) throw new BadRequest('The company director approves the submission.');
      if (user.id === r.byId) throw new BadRequest('Not the preparer.');
      return this.save(user, r, { d: { ...r.d, directorOk: { byId: user.id, by: user.name, at: this.now(), reason: this.reason(i.reason) } } }, 'approve', 'director approved');
    }
    if (step === 'submitted') {
      const missing = docs.dealer.filter((k) => !(r.d.docs as Record<string, string>)[k]);
      if (missing.length) throw new BadRequest(`Documents missing: ${missing.join(', ')}.`);
      if (!r.d.directorOk) throw new BadRequest('The company director approves the submission first.');
      if (!isDate(i.on)) throw new BadRequest('Give the date.');
      return this.save(user, r, { status: 'submitted', d: { ...r.d, submitted: { on: i.on, to: this.reason(i.to, 'to whom'), ref: this.reason(i.ref, 'the reference') } }, proof: [...(r.proof ?? []), ...this.proofs(user, i.docs)] }, 'submitted', String(i.ref));
    }
    if (step === 'inspection') {
      if (r.status !== 'submitted') throw new BadRequest('Submit it first.');
      if (!isDate(i.on)) throw new BadRequest('Give the date.');
      return this.save(user, r, { d: { ...r.d, inspection: { on: i.on, note: s(i.note, 300) } } }, 'inspection', String(i.on));
    }
    if (step === 'refused') {
      if (r.status !== 'submitted') throw new BadRequest('Submit it first.');
      return this.save(user, r, { status: 'refused', d: { ...r.d, refused: this.reason(i.reason, "the police's reason") } }, 'refused', s(i.reason, 200));
    }
    if (step === 'issued') {
      if (r.status !== 'submitted') throw new BadRequest('Submit it first.');
      const number = this.reason(i.number, 'the licence number');
      const copy = this.proofs(user, i.docs);
      if (!copy.length) throw new BadRequest('Attach the licence copy.');
      // A dealer licence is for one place of business and expires on 31 December (Arms Act s.9).
      const validUntil = `${this.today().slice(0, 4)}-12-31`;
      const existing = (await this.store.list('dealerLicences', { companyId: r.companyId! }))[0];
      await this.store.transaction(async (tx) => {
        const row = { status: 'approved' as const, reference: number, appliedOn: (r.d.submitted as { on: IsoDate }).on, expiresOn: validUntil, note: `place of business: ${String(r.d.placeOfBusiness)}`, placeOfBusiness: String(r.d.placeOfBusiness), docId: copy[0].sha256 };
        if (existing) await tx.update('dealerLicences', existing.id, row as never);
        else await tx.insert('dealerLicences', { id: `dl-${r.companyId}`, companyId: r.companyId!, ...row } as never);
        await tx.audit({ at: this.now(), actor: user.name, companyId: r.companyId, action: 'arms.dealer_licence', entity: 'dealer_licence', entityId: existing?.id ?? `dl-${r.companyId}`, summary: `Dealer licence ${number} to ${validUntil} (${String(r.d.placeOfBusiness)}); trading stays off until the CEO switches it on` });
      });
      return this.save(user, r, { status: 'issued', d: { ...r.d, issued: { number, validUntil } }, proof: [...(r.proof ?? []), ...copy] }, 'issued', number);
    }
    throw new BadRequest('Unknown step.');
  }
  private async tradeStore(user: User, i: Record<string, unknown>) {
    if (!(await this.mgr(user))) throw new AccessDenied('arms.view', '(Arms Control records the trade store approval)');
    const v = await this.vaultOf(s(i.vaultId, 120));
    const copy = this.proofs(user, i.docs);
    if (!copy.length || !isDate(i.on)) throw new BadRequest('Give the police reference, date and a copy.');
    const appr = { ref: this.reason(i.ref, 'the police reference'), on: i.on, docId: copy[0].sha256, placeOfBusiness: this.reason(i.placeOfBusiness, 'the place of business') };
    await this.store.transaction(async (tx) => {
      await tx.update('vaults', v.id, { tradeStoreApproval: appr });
      await tx.audit({ at: this.now(), actor: user.name, companyId: v.companyId, action: 'arms.trade_store', entity: 'vault', entityId: v.id, summary: `${v.name}: trade store approval ${appr.ref}` });
    });
    return { ok: true };
  }
  /** R31: a readiness line is UNKNOWN until recorded with a document; a ticked box alone is never "done". */
  private async readiness(user: User, i: Record<string, unknown>) {
    if (!this.ac(user) && user.department !== 'legal' && !this.finance(user)) throw new AccessDenied('arms.view', '(Arms Control, Legal or Finance records a readiness line)');
    const companyId = s(i.companyId, 60);
    const line = READINESS_LINES.find((k) => k === i.line);
    if (!line || line === 'dealerLicence' || line === 'tradeStore') throw new BadRequest('Choose a line (the licence and trade store lines come from their own records).');
    const copy = this.proofs(user, i.docs);
    if (!copy.length || !isDate(i.on)) throw new BadRequest('Give the reference, the date and the document.');
    const d = { line, ref: this.reason(i.ref, 'the reference'), on: i.on, note: s(i.note, 300) };
    return this.create(user, 'readiness', 'RDY', { d, status: 'recorded', companyId, proof: copy }, `${line}: ${d.ref}`);
  }
  /** Per-company trading check (R29): an approved dealer licence valid today with number, place of business and copy. */
  async tradeProblem(companyId: Id | null): Promise<string | null> {
    if (!companyId) return null;
    const lic = (await this.store.list('dealerLicences', { companyId })).find((d) => d.status === 'approved');
    const l = lic as (typeof lic & { placeOfBusiness?: string; docId?: string }) | undefined;
    if (!l || !l.reference || !l.placeOfBusiness || !l.docId) return 'Syarikat ini tiada lesen peniaga senjata yang diluluskan (nombor, tempat perniagaan dan salinan). Trading is refused.';
    if (l.expiresOn && l.expiresOn < this.today()) return `Lesen peniaga ${l.reference} tamat ${l.expiresOn}. Trading stopped for this company.`;
    return null;
  }
  async readinessList(companyId: Id) {
    const recs = (await this.all().catch(() => [])).filter((r) => r.kind === 'readiness' && r.companyId === companyId);
    const lic = await this.tradeProblem(companyId);
    const vaults = await this.store.list('vaults', { companyId });
    return READINESS_LINES.map((line) => {
      if (line === 'dealerLicence') return { line, state: lic ? 'UNKNOWN' : 'DONE', ref: lic ? null : 'dealer licence on file' };
      if (line === 'tradeStore') {
        const v = vaults.find((x) => x.tradeStoreApproval);
        return { line, state: v ? 'DONE' : 'UNKNOWN', ref: v?.tradeStoreApproval?.ref ?? null };
      }
      const r = recs.filter((x) => x.d.line === line).sort((a, b) => b.at.localeCompare(a.at))[0];
      return { line, state: r ? 'DONE' : 'UNKNOWN', ref: r ? String(r.d.ref) : null };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Checks used by the existing arms flows
  // ---------------------------------------------------------------------------------------------------------------

  /** Findings added to the issue check: vault applying, vault staff licence, the duty's licence category, maintenance. */
  async issueFindings(f: Firearm, v: Vault, person: Person, site: Site, today: IsoDate): Promise<Finding[]> {
    const out: Finding[] = [];
    const block = (code: string, message: string, ruleId = 'ARMS-ISSUE') => out.push({ level: 'block', code, message, ruleId });
    const warn = (code: string, message: string, ruleId = 'ARMS-ISSUE') => out.push({ level: 'warn', code, message, ruleId });
    if (v.state === 'APPLYING') block('VAULT_APPLYING', `${v.name} is still being applied for. No firearm is issued from it.`);
    const creds = await this.store.list('credentials', { companyId: v.companyId });
    if (v.aLicenceHolderPersonId && !validLicence(creds, v.aLicenceHolderPersonId, 'PELESEN_A', today)) block('VAULT_STAFF_LICENCE', `${v.name}: the A licence holder has no valid Pelesen A licence.`);
    if (v.custodianPersonId && !validLicence(creds, v.custodianPersonId, 'AMRA', today)) block('VAULT_STAFF_LICENCE', `${v.name}: the Amra has no valid AMRA licence.`);
    const { m, categoryRequired: switchedOn } = await this.values();
    // D3 (Fauzan, 23 Nov 2026): required from 1 January 2027 (rule ARMS-LICENCE-CATEGORY), or earlier by the switch.
    const categoryRequired = switchedOn || today >= RULES.armsLicenceCategory.value.requiredFrom;
    const needed = licenceNeededFor(site, null);
    if (needed) {
      const mine = creds.filter((c) => c.personId === person.id && c.type === 'FIREARM_PERMIT' && (!c.expiresOn || c.expiresOn >= today));
      if (mine.some((c) => c.licenceState === 'suspended' || c.licenceState === 'cancelled') && !validLicence(creds, person.id, needed, today)) block('NO_PERMIT', `${person.name}'s arms licence is suspended or cancelled. No armed duty.`, 'ARMS-ISSUE');
      else if (!validLicence(creds, person.id, needed, today)) {
        const uncategorised = mine.some((c) => !c.licenceCategory);
        if (uncategorised && !categoryRequired) warn('LICENCE_CATEGORY', `${person.name}: kategori lesen belum direkod (this duty needs ${needed}). Record it on the licence.`);
        else block('NO_PERMIT', `${person.name} has no valid ${needed} licence for this duty.`);
      }
    }
    // R-X11: maintenance every 120 days from the last maintenance record; overdue warns at issue.
    const recs = await this.all().catch(() => [] as ArmsPolicyRec[]);
    const last = recs.filter((r) => r.kind === 'inspect' && r.firearmId === f.id && r.status === 'pass').map((r) => dateOf(r.at)).sort().pop() ?? null;
    if (last && daysBetween(last, today) > m.maintenanceDays) warn('MAINTENANCE_OVERDUE', `${f.tag}: maintenance overdue (last ${last}, every ${m.maintenanceDays} days).`, 'ARMS-MAINT-DAYS');
    if (!last && recs.length) warn('MAINTENANCE_OVERDUE', `${f.tag}: no maintenance record yet (every ${m.maintenanceDays} days).`, 'ARMS-MAINT-DAYS');
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Board (R25) and home items
  // ---------------------------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------------------------
  // Part V (arms briefing 20 Oct 2026): monthly firearm record (V14), vault fire extinguisher (V15), history (V16)
  // ---------------------------------------------------------------------------------------------------------------

  /** V14: one record per firearm per month, done before the 28th (from November 2026). */
  private async monthly(user: User, i: Record<string, unknown>) {
    const f = await this.firearm(s(i.firearmId, 120));
    if (!(await this.handles(user, f.companyId))) throw new AccessDenied('arms.handle', f.companyId);
    const today = this.today();
    const month = /^\d{4}-\d{2}$/.test(String(i.month ?? '')) ? String(i.month) : today.slice(0, 7);
    if (month < ARMS_MONTHLY_FROM || month > today.slice(0, 7)) throw new BadRequest(`Monthly records start ${ARMS_MONTHLY_FROM}; not for a future month.`);
    if ((await this.all()).some((r) => r.kind === 'monthly' && r.firearmId === f.id && r.d.month === month)) throw new BadRequest(`${f.tag} already has its ${month} record.`);
    const condition = (['GOOD', 'NEEDS_ATTENTION', 'UNUSABLE'] as const).find((k) => k === i.condition);
    if (!condition) throw new BadRequest('Choose the condition: good, needs attention or unusable.');
    // "Tiada masalah" is a choice; no typing "NA".
    const noProblem = i.damage === 'TIADA_MASALAH';
    const damage = noProblem ? 'Tiada masalah' : this.reason(i.damage, 'the damage found, or choose "Tiada masalah"');
    if (/^(n\/?a|-|nil|tiada)$/i.test(damage) && !noProblem) throw new BadRequest('Choose "Tiada masalah" instead of typing NA.');
    const checkOn = isDate(i.checkOn) && i.checkOn <= today ? i.checkOn : today;
    const photo = this.proofs(user, i.photo);
    if (!photo.length) throw new BadRequest('Attach the firearm photo.');
    const maintenanceDone = i.maintenanceDone === true;
    const form = this.proofs(user, i.maintenanceForm);
    if (maintenanceDone && !form.length) throw new BadRequest('Maintenance done: attach the maintenance form.');
    const recs = await this.all();
    const ext = recs.filter((r) => r.kind === 'extinguisher' && r.vaultId === f.vaultId).sort((a, b) => a.at.localeCompare(b.at)).pop();
    if (maintenanceDone && !ext) throw new BadRequest('Maintenance done: record the vault fire extinguisher first (serial, service date, expiry).');
    const { m } = await this.values();
    const lastMaint = recs.filter((r) => r.kind === 'inspect' && r.firearmId === f.id && r.status === 'pass').map((r) => dateOf(r.at)).sort().pop() ?? null;
    const nextOn = isDate(i.nextMaintenanceOn) ? i.nextMaintenanceOn : addDays(maintenanceDone ? checkOn : (lastMaint ?? checkOn), m.maintenanceDays);
    const v = await this.store.get('vaults', f.vaultId);
    const d = {
      month,
      tag: f.tag,
      firearmKind: f.kind,
      model: s((f as Firearm & { model?: string }).model ?? i.model, 80),
      aLicenceHolder: v?.aLicenceHolderPersonId ?? v?.aLicenceHolder ?? null,
      vault: v ? { id: v.id, name: v.name } : null,
      dutyOfficer: this.reason(i.dutyOfficer, 'the duty officer'),
      condition,
      damage,
      checkOn,
      nextMaintenanceOn: nextOn,
      maintenanceDone,
      extinguisherRef: maintenanceDone ? ext!.ref : null,
      late: checkOn.slice(8) > '28' && checkOn.slice(0, 7) === month,
    };
    return this.create(user, 'monthly', 'RBS', { d, status: 'recorded', companyId: f.companyId, firearmId: f.id, vaultId: f.vaultId, proof: [...photo, ...form] }, `${f.tag} ${month}: ${condition}`);
  }

  /** V15: the vault's fire extinguisher (serial or location, last service, expiry, certificate). A safety flag, never a block on issues. */
  private async extinguisher(user: User, i: Record<string, unknown>) {
    const v = await this.store.get('vaults', s(i.vaultId, 120));
    if (!v) throw new NotFound('Vault');
    if (!(await this.handles(user, v.companyId))) throw new AccessDenied('arms.handle', v.companyId);
    if (!isDate(i.lastServiceOn) || !isDate(i.expiresOn) || i.expiresOn <= i.lastServiceOn) throw new BadRequest('Give the last service date and the expiry date (after it).');
    const cert = this.proofs(user, i.certificate);
    if (!cert.length) throw new BadRequest('Attach the extinguisher certificate copy.');
    const d = { serial: s(i.serial, 60), location: this.reason(i.location, 'where it is in the vault'), lastServiceOn: i.lastServiceOn, expiresOn: i.expiresOn, vaultName: v.name };
    return this.create(user, 'extinguisher', 'APK', { d, status: 'recorded', companyId: v.companyId, vaultId: v.id, proof: cert }, `${v.name}: extinguisher to ${i.expiresOn}`);
  }

  /** V16: "Sejarah" on a firearm, vault or licence: what changed, who and when, from the audit log. */
  private async history(user: User, i: Record<string, unknown>) {
    const entity = (['firearm', 'vault', 'credential'] as const).find((k) => k === i.entity);
    const id = s(i.id, 120);
    if (!entity || !id) throw new BadRequest('Choose the firearm, vault or licence.');
    const row = entity === 'firearm' ? await this.store.get('firearms', id) : entity === 'vault' ? await this.store.get('vaults', id) : await this.store.get('credentials', id);
    if (!row) throw new NotFound('Record');
    if (!(await this.views(user, (row as { companyId: Id }).companyId))) throw new AccessDenied('arms.view', (row as { companyId: Id }).companyId);
    const policy = (await this.all()).filter((r) => r.firearmId === id || r.vaultId === id || r.d.credentialId === id).map((r) => r.id);
    const log = await this.store.list('audit', { entityId: [id, ...policy] } as never).catch(() => []);
    return (log as { at: IsoDateTime; actor: string; action: string; summary: string }[])
      .map((a) => ({ at: a.at, by: a.actor, what: a.action, note: entity === 'firearm' && this.ac(user) ? a.summary : a.summary.replace(/\b[A-Z0-9/]{6,30}\b/g, (x) => (/\d/.test(x) ? `****${x.slice(-4)}` : x)) }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200);
  }

  /** V17: records still to fill per company (firearms, vaults, CNU / Bodyguard licences, A-licence holder and Amra on each vault). */
  private completeness(firearms: Firearm[], vaults: Vault[], creds: Credential[]) {
    const byCo = new Map<Id, { companyId: Id; firearms: number; vaults: number; licences: number; missing: string[] }>();
    const row = (cid: Id) => byCo.get(cid) ?? (byCo.set(cid, { companyId: cid, firearms: 0, vaults: 0, licences: 0, missing: [] }), byCo.get(cid)!);
    for (const f of firearms.filter((x) => x.status !== 'OFF_REGISTER' && x.ownership !== 'TRADE')) {
      const r = row(f.companyId);
      r.firearms++;
      const miss = [!f.serial && 'serial', !f.licenceRef && 'licence ref', !f.licenceExpiresOn && 'licence expiry', !f.vaultId && 'vault'].filter(Boolean);
      if (miss.length) r.missing.push(`${f.tag}: ${miss.join(', ')}`);
    }
    for (const v of vaults.filter((x) => x.state !== 'APPLYING')) {
      const r = row(v.companyId);
      r.vaults++;
      const miss = [!v.approvalRef && 'approval ref', !v.approvalExpiresOn && 'approval expiry', !(v.aLicenceHolderPersonId || v.aLicenceHolder) && 'A-licence holder', !(v.custodianPersonId || v.custodian) && 'Amra'].filter(Boolean);
      if (miss.length) r.missing.push(`${v.name}: ${miss.join(', ')}`);
    }
    for (const c of creds.filter((x) => x.type === 'FIREARM_PERMIT' && (x.licenceCategory === 'CNU' || x.licenceCategory === 'BODYGUARD'))) {
      const r = row(c.companyId);
      r.licences++;
      if (!c.expiresOn || !c.number) r.missing.push(`${c.licenceCategory} licence ${c.number || '(no number)'}: ${!c.number ? 'number' : 'expiry'}`);
    }
    return [...byCo.values()].map((r) => ({ ...r, complete: r.missing.length === 0 })).sort((a, b) => b.missing.length - a.missing.length);
  }

  async board(user: User) {
    const ac = this.ac(user);
    const groupArms = !user.integration && isGroupRole(user) && seesArmsDetail(user);
    const companies = ac || groupArms ? null : user.companyIds;
    const visible = (cid: Id | null) => (companies ? !!cid && companies.includes(cid) : true);
    const jacketsOnly = !ac && this.stores(user) && !(await this.views(user, user.companyIds[0] ?? null));
    // The arms wall (R26): Finance, HR, the CoS and PWVSB legal see none of these records; the store team sees jackets only.
    const legal = user.role === 'pwvsb_officer' && user.department === 'legal';
    if (!ac && !jacketsOnly && (!holdsArmsWall(user) || legal)) throw new AccessDenied('arms.view', '(arms policy records)');
    const recs = (await this.all().catch(() => [] as ArmsPolicyRec[])).filter((r) => (jacketsOnly ? r.kind.startsWith('jacket') : visible(r.companyId) || (ac && r.companyId === null)));
    const today = this.today();
    const { m, dmg, pol, docs } = await this.values();
    const [firearms, credentials, requests, vaults] = jacketsOnly
      ? [[], [], [], []]
      : await Promise.all([this.store.list('firearms', {}), this.store.list('credentials', {}), this.store.list('armsRequests', {}), this.store.list('vaults', {})]);
    const mine = <T extends { companyId: Id }>(xs: T[]) => xs.filter((x) => visible(x.companyId));
    const fs = mine(firearms as Firearm[]);
    const bare = (r: ArmsPolicyRec) => {
      const restricted = r.kind === 'licenceApp' && !(ac || this.hr(user) || user.role === 'company_manager');
      return { ...r, proof: (r.proof ?? []).map((f) => ({ ...f, data: '', link: undefined })), d: restricted ? { ...r.d, records: r.d.records ? { restricted: true } : null } : r.d };
    };
    const outOfUse = fs.filter((f) => ['MAINTENANCE', 'NEEDS_MAINTENANCE', 'UNDER_INSPECTION', 'DAMAGED', 'IN_REPAIR', 'UNUSABLE'].includes(f.status));
    const damage = recs.filter((r) => r.kind === 'damage' && r.status !== 'closed').map((r) => {
      const cat = r.d.category as DamageCategory | null;
      const limitH = cat === 'LIGHT' ? dmg.lightHours : cat === 'MEDIUM' ? dmg.mediumReportHours + dmg.mediumReferralWorkingDays * 24 : cat === 'CRITICAL' ? dmg.criticalMinutes / 60 : null;
      const ageH = (toMs(this.now()) - toMs(r.at)) / 3_600_000;
      return { id: r.id, ref: r.ref, tag: String(r.d.tag), category: cat, ageHours: Math.round(ageH), pastTarget: limitH != null && ageH > Math.max(limitH, 0.01) };
    });
    const lastMaint = (id: Id) => recs.filter((r) => r.kind === 'inspect' && r.firearmId === id && r.status === 'pass').map((r) => dateOf(r.at)).sort().pop() ?? null;
    const maintenance = fs
      .filter((f) => f.status !== 'LOST' && f.status !== 'OFF_REGISTER')
      .map((f) => {
        const last = lastMaint(f.id);
        const due = last ? addDays(last, m.maintenanceDays) : null;
        return { firearmId: f.id, tag: f.tag, status: f.status, last, due, state: !due ? 'no record' : due < today ? 'overdue' : daysBetween(today, due) <= m.dueSoonDays ? 'due soon' : 'ok' };
      })
      .filter((x) => x.state !== 'ok');
    const lic = (credentials as Credential[]).filter((c) => visible(c.companyId) && c.type === 'FIREARM_PERMIT');
    const expiring = lic.filter((c) => c.expiresOn && c.expiresOn >= today && daysBetween(today, c.expiresOn) <= pol.renewalLeadDays).map((c) => ({ credentialId: c.id, personId: c.personId, category: c.licenceCategory ?? null, expiresOn: c.expiresOn, renewalOpen: recs.some((r) => r.kind === 'licenceApp' && r.personId === c.personId && r.d.type === 'RENEWAL' && !['issued', 'refused_closed'].includes(r.status)) }));
    const buys = mine(requests as ArmsRequest[])
      .filter((r) => r.kind === 'ACQUIRE' && r.state !== 'closed')
      .map((r) => {
        const p = recs.find((x) => x.kind === 'buyPack' && x.requestId === r.id);
        const ups = ((p?.d.followUps as { on: IsoDate }[]) ?? []).map((x) => x.on).sort();
        const lastUp = ups.pop() ?? (p?.d.sentOn as IsoDate | undefined) ?? null;
        const days = r.approvalLetter ? daysBetween(r.approvalLetter.on, today) : null;
        return {
          requestId: r.id,
          ref: r.ref,
          state: r.state,
          waitingPolice: p?.status === 'submitted',
          lastFollowUp: lastUp,
          followUpDue: p?.status === 'submitted' && (!lastUp || daysBetween(lastUp, today) >= pol.followUpDays),
          windowDay: days,
          windowState: days == null ? null : days > pol.buyWindowDays ? 'lapsed' : days >= (pol.buyRemindDays[1] ?? 10) ? 'day 10' : days >= (pol.buyRemindDays[0] ?? 7) ? 'day 7' : 'open',
          dealerProblem: null as string | null,
        };
      });
    for (const b of buys) b.dealerProblem = await this.dealerProblem((requests as ArmsRequest[]).find((r) => r.id === b.requestId)!);
    const jackets = recs.filter((r) => r.kind === 'jacket');
    const jacketInspect = (await this.values()).m.jacketInspectDays;
    return {
      role: ac ? 'arms_control' : jacketsOnly ? 'stores' : 'company',
      docs: ARMS_POLICY_DOCS,
      docLists: docs,
      settings: { maint: m, damage: dmg, policy: pol },
      tiles: {
        licenceApps: recs.filter((r) => r.kind === 'licenceApp' && !['issued', 'refused_closed'].includes(r.status)).map((r) => ({ id: r.id, ref: r.ref, status: r.status, days: daysBetween(dateOf(r.at), today) })),
        licencesExpiring: expiring,
        vaultApps: recs.filter((r) => r.kind === 'vaultApp' && r.status !== 'active').map((r) => ({ id: r.id, ref: r.ref, status: r.status, days: daysBetween(dateOf(r.at), today) })),
        firearmsOutOfUse: outOfUse.map((f) => ({ id: f.id, tag: f.tag, status: f.status })),
        damage,
        maintenance,
        buys,
        jacketsQuarantined: jackets.filter((j) => j.status === 'quarantine').length,
        jacketsWarranty: jackets.filter((j) => j.d.warrantyEnd && daysBetween(today, String(j.d.warrantyEnd)) <= 90).map((j) => ({ id: j.id, ref: j.ref, warrantyEnd: j.d.warrantyEnd })),
        jacketInspectDays: jacketInspect,
        vaultsBlocked: mine(vaults as Vault[]).filter((v) => v.state === 'APPLYING').map((v) => ({ id: v.id, name: v.name })),
        // V14: this month's record per firearm (from November 2026): reminder from the 21st, red after the 28th.
        monthly: (() => {
          const month = today.slice(0, 7);
          if (month < ARMS_MONTHLY_FROM) return { month, due: `${month}-28`, missing: [] as { firearmId: Id; tag: string; companyId: Id }[], state: 'not started' };
          const done = new Set(recs.filter((r) => r.kind === 'monthly' && r.d.month === month).map((r) => r.firearmId));
          const missing = fs.filter((f) => !['LOST', 'OFF_REGISTER'].includes(f.status) && f.ownership !== 'TRADE' && !done.has(f.id)).map((f) => ({ firearmId: f.id, tag: f.tag, companyId: f.companyId }));
          const day = Number(today.slice(8));
          return { month, due: `${month}-28`, missing, state: !missing.length ? 'done' : day > 28 ? 'late' : day >= 21 ? 'reminder' : 'open' };
        })(),
        // Vault keepers (23 Nov 2026 review): who keeps each vault, so forms pick a vault by name.
        vaults: mine(vaults as Vault[]).map((v) => ({ id: v.id, name: v.name, companyId: v.companyId, state: v.state, amra: v.custodian || null, amraPersonId: v.custodianPersonId ?? null, aLicence: v.aLicenceHolder || null, aLicencePersonId: v.aLicenceHolderPersonId ?? null, authorised: (v.authorisedStaff ?? []).filter((a) => !a.removedOn).map((a) => ({ personId: a.personId ?? null, name: a.name })) })),
        // V15: vault fire extinguishers: warn 30 days before expiry, expired amber (a safety flag, never a block).
        extinguishers: mine(vaults as Vault[]).filter((v) => v.state !== 'APPLYING').map((v) => {
          const e = recs.filter((r) => r.kind === 'extinguisher' && r.vaultId === v.id).sort((a, b) => a.at.localeCompare(b.at)).pop();
          const exp = (e?.d.expiresOn as IsoDate | undefined) ?? null;
          return { vaultId: v.id, name: v.name, expiresOn: exp, state: !exp ? 'missing' : exp < today ? 'expired' : daysBetween(today, exp) <= 30 ? 'due soon' : 'ok' };
        }),
        // V17: records still to fill per company.
        completeness: this.completeness(fs, mine(vaults as Vault[]), lic),
        // V18: a licence renewal not submitted by its expiry date; a vault application step past its time with no follow-up.
        missedDates: [
          ...lic.filter((c) => c.expiresOn && c.expiresOn < today && !recs.some((r) => r.kind === 'licenceApp' && r.personId === c.personId && r.d.type === 'RENEWAL' && r.status !== 'draft')).map((c) => ({ kind: 'licence' as const, ref: c.number, companyId: c.companyId, since: c.expiresOn! })),
          ...recs.filter((r) => r.kind === 'vaultApp' && r.status !== 'active' && r.status !== 'not_supported').filter((r) => {
            const last = [r.at, ...r.history.map((h) => h.at)].sort().pop()!;
            return daysBetween(dateOf(last), today) > pol.followUpDays;
          }).map((r) => ({ kind: 'vault' as const, ref: r.ref, companyId: r.companyId as Id, since: dateOf([r.at, ...r.history.map((h) => h.at)].sort().pop()!) })),
        ],
      },
      records: recs.filter((r) => r.kind !== 'settings' && r.kind !== 'statusLog').map(bare),
      statusLog: recs.filter((r) => r.kind === 'statusLog').slice(-100).map(bare),
      readiness: ac ? await Promise.all([...new Set((await this.store.list('dealerLicences', {})).map((d) => d.companyId))].map(async (cid) => ({ companyId: cid, lines: await this.readinessList(cid) }))) : [],
      keepYears: { arms: pol.recordsKeepYears, jackets: pol.jacketKeepYears },
    };
  }

  async homeItems(user: User) {
    if (user.integration) return [];
    if (!this.ac(user) && !(user.role === 'company_manager' || user.role === 'director' || user.role === 'supervisor')) return [];
    const b = await this.board(user).catch(() => null);
    if (!b || b.role === 'stores') return [];
    const items: { tone: 'warn' | 'crit' | 'info'; tag: string; title: string; detail: string; go: { view: 'arms' } }[] = [];
    const go = { view: 'arms' as const };
    const t = b.tiles;
    if (t.damage.some((x) => x.category === 'CRITICAL')) items.push({ tone: 'crit', tag: 'Senjata', title: 'Senjata rosak (kritikal)', detail: t.damage.filter((x) => x.category === 'CRITICAL').map((x) => x.tag).join(', '), go });
    if (t.damage.some((x) => x.pastTarget)) items.push({ tone: 'warn', tag: 'Senjata', title: `${t.damage.filter((x) => x.pastTarget).length} damage report(s) past target`, detail: t.damage.filter((x) => x.pastTarget).map((x) => x.ref).join(', '), go });
    const lapse = t.buys.filter((x) => x.windowState === 'day 7' || x.windowState === 'day 10' || x.windowState === 'lapsed');
    if (lapse.length) items.push({ tone: lapse.some((x) => x.windowState === 'lapsed') ? 'crit' : 'warn', tag: 'Pembelian senjata', title: 'Tempoh 14 hari surat kelulusan', detail: lapse.map((x) => `${x.ref} ${x.windowState}`).join(', '), go });
    const fu = t.buys.filter((x) => x.followUpDue);
    if (fu.length) items.push({ tone: 'info', tag: 'Pembelian senjata', title: 'Susulan bulanan dengan IPD', detail: fu.map((x) => x.ref).join(', '), go });
    const renew = t.licencesExpiring.filter((x) => !x.renewalOpen);
    if (renew.length) items.push({ tone: 'warn', tag: 'Lesen senjata', title: `${renew.length} licence(s) to renew (90 days)`, detail: renew.slice(0, 3).map((x) => x.expiresOn).join(', '), go });
    const mon = t.monthly;
    if (mon.missing.length && (mon.state === 'reminder' || mon.state === 'late')) items.push({ tone: mon.state === 'late' ? 'crit' : 'warn', tag: 'Rekod bulanan senjata', title: `${mon.missing.length} firearm(s) without the ${mon.month} record (due ${mon.due})`, detail: mon.missing.slice(0, 5).map((x) => x.tag).join(', '), go });
    const ext = t.extinguishers.filter((x) => x.state !== 'ok');
    if (ext.length) items.push({ tone: 'warn', tag: 'Alat pemadam api', title: `${ext.length} vault extinguisher(s) missing, due or expired`, detail: ext.slice(0, 3).map((x) => `${x.name} ${x.state}`).join(', '), go });
    if (t.missedDates.length && (this.ac(user) || user.role === 'director' || user.role === 'company_manager')) items.push({ tone: 'crit', tag: 'Tarikh permohonan', title: `${t.missedDates.length} application date(s) missed`, detail: t.missedDates.slice(0, 3).map((x) => `${x.kind} ${x.ref}`).join(', '), go });
    const maint = t.maintenance.filter((x) => x.state === 'overdue' || x.state === 'due soon');
    if (maint.length) items.push({ tone: 'info', tag: 'Penyelenggaraan', title: `${maint.length} firearm(s) due maintenance`, detail: maint.slice(0, 5).map((x) => x.tag).join(', '), go });
    return items;
  }
}
