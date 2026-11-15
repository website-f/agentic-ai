// Part S (Fitri package, Prisma / Asset Management office papers 2.0, Fauzan's answers S-X1..S-X40, 13-14 Nov 2026):
// office repairs from a staff request to payment and close (S1-S16, S43-S45), office inventory with check and confirm
// (S17-S31), office asset disposal (S32-S42, S47-S50), recording a building purchase (S51-S62), office rent
// collection (S63-S74) and periodic office visits (S75-S84). One door: `act(user, op, input)`. Every step checks who
// may take it here; the database module office-am-v1 adds the walls. Prima records; it never moves money, never
// applies to a bank, and never makes a rent invoice number of its own.
import { AccessDenied, assetRole, isGroupLeader } from './access';
import { BadRequest, NotFound, type ProofInput, type PrimaService } from './service';
import { RULES } from './rules';
import type { Store } from './store';
import { addDays, addWorkingDays, dateOf, daysBetween, toMs } from './time';
import type { AmUnit, AmWorkOrder, FinPayment, FinRegular, Id, IsoDate, IsoDateTime, ItProof, User } from './types';

export type OfficeAmKind =
  | 'settings'
  | 'repair'
  | 'jmb'
  | 'invItem'
  | 'invUpdate'
  | 'invAccess'
  | 'spExport'
  | 'disposal'
  | 'buildingBuy'
  | 'bldConfirm'
  | 'mgmtAgreement'
  | 'officeTenancy'
  | 'rentMonth'
  | 'visitPlan'
  | 'visit';

export interface OfficeAmRec {
  id: Id;
  kind: OfficeAmKind;
  ref: string;
  status: string;
  at: IsoDateTime;
  byId: Id;
  by: string;
  version: number;
  /** The company whose office or building it is (the company wall). */
  companyId: Id | null;
  requesterId?: Id | null;
  unitId?: Id | null;
  itemId?: Id | null;
  parentId?: Id | null;
  d: Record<string, unknown>;
  proof?: ItProof[];
  history: { at: IsoDateTime; byId: Id; by: string; action: string; note: string }[];
}

/** The papers on the policy library and the guide card (BM titles as issued; English copies to follow). */
export const OFFICE_AM_DOCS = [
  { code: 'PRWM-UPA/PKL/2026/012', title: 'Pekeliling Penyelenggaraan Pejabat 2.0' },
  { code: 'PRWM-UPA/POL/2026/012', title: 'Polisi Penyelenggaraan Pejabat 2.0' },
  { code: 'PRWM-UPA/PKL/2026/008', title: 'Pekeliling Pengurusan dan Kemaskini Inventori Pejabat' },
  { code: 'PRWM-UPA/POL/2026/008', title: 'Polisi Pengurusan dan Kemaskini Inventori Pejabat' },
  { code: 'PRWM-UPA/SOP/2026/008', title: 'SOP Pengurusan dan Kemas Kini Inventori Pejabat' },
  { code: 'PRWM-UPA/PKL/2026/009', title: 'Pekeliling Pelupusan Aset Pejabat 2.0' },
  { code: 'PRWM-UPA/SOP/2026/009', title: 'SOP Pelupusan Aset Pejabat 2.0' },
  { code: 'PRWM-UPA/POL/2026/009', title: 'Polisi Pelupusan Aset Pejabat 2.0' },
  { code: 'PRWM-UPA/POL/2026/010', title: 'Polisi Rekod Proses Pembelian Bangunan Baharu' },
  { code: 'PRWM-UPA/POL/2026/014', title: 'Polisi Kutipan Sewa Pejabat' },
  { code: 'PRWM-UPA/SOP/2026/014', title: 'SOP Kutipan Sewa Pejabat' },
  { code: 'PRWM-UPA/PKL/2026/017', title: 'Pekeliling Penyelenggaraan Berkala' },
] as const;

/** The circular's seven steps, BM with English below (S14). */
export const OFFICE_REPAIR_STEPS = [
  { bm: 'Isi borang permohonan penyelenggaraan dalam Prima.', en: 'Fill in the maintenance request in Prima.' },
  { bm: 'Unit penyelenggaraan menyemak dan melawat tapak jika perlu.', en: 'The maintenance unit checks and visits the site if needed.' },
  { bm: 'Sekurang-kurangnya 3 sebut harga dinilai.', en: 'At least 3 quotes are compared.' },
  { bm: 'Majikan meluluskan sebelum kerja bermula.', en: 'The employer approves before any work.' },
  { bm: 'Kontraktor melaksanakan kerja; pemohon mengesahkan.', en: 'The contractor does the work; the requester confirms.' },
  { bm: 'Kewangan membayar kontraktor; resit disimpan.', en: 'Finance pays the contractor; the receipt is kept.' },
  { bm: 'Laporan pembaikan ditulis dan rekod ditutup.', en: 'The repair report is written and the record closed.' },
] as const;

/** S44: the guide's examples under each level. A setting the unit can edit with a reason. */
export const DAMAGE_EXAMPLES = {
  MINOR: ['Mentol lampu', 'Bateri alat kawalan jauh', 'Skru longgar', 'Engsel pintu', 'Hos bidet', 'Paip bocor kecil', 'Semak penapis penghawa dingin', 'Pemegang pintu longgar', 'Tirai tercabut', 'Sinki tersumbat ringan', 'Kerusi longgar', 'Laci tersekat', 'Cangkuk dinding', 'Penutup suis retak', 'Getah pintu', 'Penyangkut tuala', 'Kunci laci'],
  MEDIUM: ['Soket dan suis', 'Kunci pintu', 'Floor spring', 'Tingkap', 'Jubin', 'Siling', 'Cat semula', 'CCTV', 'Akses kad', 'Kabinet terbina dalam', 'Titik data', 'Titik plag'],
  CRITICAL: ['Bekalan elektrik utama terputus', 'Litar pintas', 'Bau terbakar di panel', 'Kebakaran', 'Paip utama bocor', 'Banjir', 'Siling runtuh', 'Retak struktur', 'Bumbung bocor teruk', 'Pam dan tangki rosak', 'Sistem kebakaran rosak', 'Generator', 'Penghawa dingin berpusat', 'Bekalan air utama', 'Pagar rosak kritikal', 'Ancaman keselamatan bangunan', 'Lif terhenti dengan penumpang'],
} as const;
export const DAMAGE_LEVELS = ['MINOR', 'MEDIUM', 'CRITICAL'] as const;
export type DamageLevel = (typeof DAMAGE_LEVELS)[number];
const LEVEL_RANK: Record<DamageLevel, number> = { MINOR: 0, MEDIUM: 1, CRITICAL: 2 };
/** S3: electronic devices go to IT (Part Q). */
export const IT_DAMAGE_TYPES = ['computer', 'laptop', 'phone', 'printer', 'network', 'it_device'] as const;
export const AM_DAMAGE_TYPES = ['furniture', 'fitting', 'aircond', 'lights', 'wiring', 'plumbing', 'door', 'roof', 'safety_equipment', 'other'] as const;
/** S45: shared building areas go to the JMB. */
export const SHARED_AREAS = ['lobby', 'lift', 'stairs', 'common_pipes', 'common_lights', 'fire_system', 'roof', 'car_park', 'outside'] as const;
export const JMB_GROUPS = ['building_infrastructure', 'lift', 'shared_water', 'sewerage_sanitary', 'common_electrics', 'fire_prevention', 'roof_structure', 'outside_areas'] as const;
/** S33 / S47: the disposal criteria (the policy's extra reason included). */
export const DISPOSAL_CRITERIA = ['damaged_not_worth_repair', 'repair_above_value', 'obsolete', 'not_used', 'unsafe', 'no_function', 'no_spare_parts'] as const;
export const DISPOSAL_METHODS = ['throw_away', 'recycle', 'licensed_contractor', 'transfer', 'donation', 'sale', 'other'] as const;
/** S52: the building purchase stages and the document each needs. */
export const BUILDING_STAGES = [
  { key: 'documents', doc: 'company documents for the bank (SSM, accounts)' },
  { key: 'sent_bank', doc: 'loan application' },
  { key: 'valuation', doc: 'valuation report' },
  { key: 'decision', doc: 'bank letter' },
  { key: 'agreements', doc: 'SPA and loan agreement' },
  { key: 'handover', doc: 'hand-over checklist' },
  { key: 'registered', doc: 'title or registration copy' },
] as const;
/** S64 / S-X35: the tenant check before letting. */
export const TENANT_CHECKS = ['ssm', 'kdnLicence', 'kdnAddress', 'pbtLicence'] as const;
/** S77: the visit checklist lines (a setting the unit can extend with a reason). */
export const VISIT_LINES = ['wiring', 'lightsSwitches', 'pipesWater', 'doorsWindows', 'ceilingWalls', 'equipment', 'facilities', 'other'] as const;
export const FINDING_TYPES = ['early_damage', 'safety_risk', 'non_compliance', 'not_working', 'wearing'] as const;

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const money = (v: unknown) => Math.round(Number(v) * 100) / 100;
const int = (v: unknown) => Math.floor(Number(v));
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const period = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : '');

export class OfficeAmService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}

  private now() {
    return this.clock();
  }
  /** A Finance payment by id (payments live in each company's Finance status record). */
  private async finPayment(id: Id): Promise<FinPayment | undefined> {
    for (const f of await this.store.list('finStatus', {})) {
      const p = (f.payments ?? []).find((x) => x.id === id);
      if (p) return p;
    }
    return undefined;
  }
  /** A Finance regular payment (loans, hire purchase) by id. */
  private async finRegular(id: Id): Promise<FinRegular | undefined> {
    for (const f of await this.store.list('finStatus', {})) {
      const r = (f.regular ?? []).find((x) => x.id === id);
      if (r) return r;
    }
    return undefined;
  }
  private today() {
    return dateOf(this.clock());
  }
  private reason(v: unknown, what = 'a reason') {
    const r = s(v, 500);
    if (r.length < 3) throw new BadRequest(`Give ${what}.`);
    return r;
  }
  // ---------- who ----------
  private team(u: User) {
    // The maintenance unit: Asset Management staff, never the Asset Director (who confirms what the unit checked).
    return !u.integration && assetRole(u) === 'team' && u.assetRole !== 'director';
  }
  private ad(u: User) {
    return !u.integration && u.assetRole === 'director';
  }
  private vc(u: User) {
    return !u.integration && u.leadership === 'vice_chairman';
  }
  private ceo(u: User) {
    return !u.integration && u.opsTier === 'ceo';
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance'));
  }
  private hrView(u: User) {
    return !u.integration && ((u.role === 'pwvsb_officer' && u.department === 'hr') || u.leadership === 'cos' || u.leadership === 'deputy_cos');
  }
  private oversee(u: User) {
    return !u.integration && (assetRole(u) !== null || isGroupLeader(u));
  }
  private head(u: User, companyId: Id | null) {
    return !u.integration && !!companyId && (u.role === 'company_manager' || u.role === 'director') && u.companyIds.includes(companyId);
  }
  private staffOf(u: User, companyId: Id | null) {
    // The company's own office staff (PWVSB officers carry every company for reading, so they are not "staff of" one).
    return !u.integration && !!companyId && ['director', 'company_manager', 'admin_exec', 'supervisor'].includes(u.role) && u.companyIds.includes(companyId);
  }

  // ---------- records ----------
  private async all(): Promise<OfficeAmRec[]> {
    return (await this.store.list('officeAmRecs', {})) as OfficeAmRec[];
  }
  private async get(id: Id, kind?: OfficeAmKind): Promise<OfficeAmRec> {
    await this.store.lock?.('officeAmRecs', id);
    const r = (await this.store.get('officeAmRecs', id)) as OfficeAmRec | undefined;
    if (!r || (kind && r.kind !== kind)) throw new NotFound('Record');
    return r;
  }
  private async create(user: User, kind: OfficeAmKind, prefix: string, rec: Partial<OfficeAmRec> & { d: Record<string, unknown>; status: string; companyId: Id | null }, note: string) {
    const at = this.now();
    const year = this.today().slice(0, 4);
    const count = (await this.all()).filter((r) => r.kind === kind && r.ref.startsWith(`${prefix}-${year}-`)).length + 1;
    const r: OfficeAmRec = {
      id: `oam-${kind}-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      kind,
      ref: `${prefix}-${year}-${String(count).padStart(4, '0')}`,
      at,
      byId: user.id,
      by: user.name,
      version: 1,
      history: [{ at, byId: user.id, by: user.name, action: 'create', note: note.slice(0, 500) }],
      ...rec,
    } as OfficeAmRec;
    return this.store.transaction(async (tx) => {
      await tx.insert('officeAmRecs', r as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `asset.office.${kind}`, entity: 'office_am', entityId: r.id, summary: `${r.ref} ${kind} [${r.companyId ?? 'group'}]: ${note}`.slice(0, 300) });
      return r;
    });
  }
  private async save(user: User, r: OfficeAmRec, patch: Partial<OfficeAmRec>, action: string, note: string) {
    const at = this.now();
    const next: Partial<OfficeAmRec> = { ...patch, version: r.version + 1, history: [...r.history, { at, byId: user.id, by: user.name, action, note: note.slice(0, 500) }] };
    return this.store.transaction(async (tx) => {
      await tx.update('officeAmRecs', r.id, next as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `asset.office.${r.kind}.${action}`, entity: 'office_am', entityId: r.id, summary: `${r.ref} ${action} [${r.companyId ?? 'group'}]: ${note}`.slice(0, 300) });
      return { ...r, ...next } as OfficeAmRec;
    });
  }
  private proofs(user: User, v: unknown): ItProof[] {
    return Array.isArray(v) && v.length ? this.svc.itProofsFor(user, (v as ProofInput[]).slice(0, 10)) : [];
  }
  async settings(): Promise<Record<string, unknown>> {
    return ((await this.all().catch(() => [])).find((r) => r.kind === 'settings')?.d ?? {}) as Record<string, unknown>;
  }
  private async values() {
    const st = await this.settings();
    const v = RULES.officeAm.value;
    const merge = <T extends object>(base: T, k: string) => ({ ...base, ...((st[k] as object) ?? {}) }) as T;
    return {
      repair: merge(v.repair, 'repair'),
      inventory: merge(v.inventory, 'inventory'),
      disposal: merge(v.disposal, 'disposal'),
      building: merge(v.building, 'building'),
      rent: merge(v.rent, 'rent'),
      visit: merge(v.visit, 'visit'),
      jmb: merge(v.jmb, 'jmb'),
      examples: { ...DAMAGE_EXAMPLES, ...((st.examples as object) ?? {}) } as Record<DamageLevel, readonly string[]>,
      visitLines: [...VISIT_LINES, ...(((st.visitLines as string[]) ?? []).filter((x) => !(VISIT_LINES as readonly string[]).includes(x)))],
    };
  }

  /** One door: every Part S action. */
  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'setSettings':
        return this.setSettings(user, i);
      // Section 1: office repairs
      case 'repairRequest':
        return this.repairRequest(user, i);
      case 'repairCheck':
        return this.repairCheck(user, i);
      case 'repairResubmit':
        return this.repairResubmit(user, i);
      case 'repairVisit':
        return this.repairVisit(user, i);
      case 'repairQuotes':
        return this.repairQuotes(user, i);
      case 'repairPick':
        return this.repairPick(user, i);
      case 'repairApprove':
        return this.repairApprove(user, i);
      case 'repairEmergency':
        return this.repairEmergency(user, i);
      case 'repairStart':
        return this.repairStart(user, i);
      case 'repairDue':
        return this.repairDue(user, i);
      case 'repairDone':
        return this.repairDone(user, i);
      case 'repairConfirm':
        return this.repairConfirm(user, i);
      case 'payLink':
        return this.payLink(user, i);
      case 'payReceipt':
        return this.payReceipt(user, i);
      case 'receiptAttach':
        return this.receiptAttach(user, i);
      case 'repairReport':
        return this.repairReport(user, i);
      case 'repairClose':
        return this.repairClose(user, i);
      case 'jmbStep':
        return this.jmbStep(user, i);
      // Section 2: office inventory
      case 'invSubmit':
        return this.invSubmit(user, i);
      case 'invCheck':
        return this.invCheck(user, i);
      case 'invConfirm':
        return this.invConfirm(user, i);
      case 'invFile':
        return this.invFile(user, i);
      case 'invResubmit':
        return this.invResubmit(user, i);
      case 'invReport':
        return this.invReport(user, i);
      case 'invAccess':
        return this.invAccessSet(user, i);
      case 'spExport':
        return this.spExport(user, i);
      // Section 3: office asset disposal
      case 'dispRequest':
        return this.dispRequest(user, i);
      case 'dispInspect':
        return this.dispInspect(user, i);
      case 'dispReport':
        return this.dispReport(user, i);
      case 'dispApprove':
        return this.dispApprove(user, i);
      case 'dispPutBack':
        return this.dispPutBack(user, i);
      case 'dispCarryOut':
        return this.dispCarryOut(user, i);
      case 'dispClose':
        return this.dispClose(user, i);
      // Section 4: building purchase
      case 'bldInstruct':
        return this.bldInstruct(user, i);
      case 'bldApproveInstruction':
        return this.bldApproveInstruction(user, i);
      case 'bldStage':
        return this.bldStage(user, i);
      case 'bldReturn':
        return this.bldReturn(user, i);
      case 'bldBankLog':
        return this.bldBankLog(user, i);
      case 'bldDecision':
        return this.bldDecision(user, i);
      case 'bldGap':
        return this.bldGap(user, i);
      case 'bldDownPayment':
        return this.bldDownPayment(user, i);
      case 'bldLoanLink':
        return this.bldLoanLink(user, i);
      case 'bldForm':
        return this.bldForm(user, i);
      case 'bldRegister':
        return this.bldRegister(user, i);
      case 'bldConfirmAsk':
        return this.bldConfirmAsk(user, i);
      case 'bldConfirmAnswer':
        return this.bldConfirmAnswer(user, i);
      case 'bldConfirmCall':
        return this.bldConfirmCall(user, i);
      case 'bldConfirmAccept':
        return this.bldConfirmAccept(user, i);
      case 'unitDetails':
        return this.unitDetails(user, i);
      case 'mgmtAgreement':
        return this.mgmtAgreement(user, i);
      // Section 6: office rent
      case 'tenancyOpen':
        return this.tenancyOpen(user, i);
      case 'tenancyCheck':
        return this.tenancyCheck(user, i);
      case 'tenancyTerms':
        return this.tenancyTerms(user, i);
      case 'rentInvoice':
        return this.rentInvoice(user, i);
      case 'rentInvoiceCheck':
        return this.rentInvoiceCheck(user, i);
      case 'rentSent':
        return this.rentSent(user, i);
      case 'rentReceived':
        return this.rentReceived(user, i);
      case 'rentHandover':
        return this.rentHandover(user, i);
      case 'rentChequeCheck':
        return this.rentChequeCheck(user, i);
      case 'rentDeposit':
        return this.rentDeposit(user, i);
      case 'rentMatch':
        return this.rentMatch(user, i);
      case 'rentBounce':
        return this.rentBounce(user, i);
      // Section 7: periodic visits
      case 'visitPlan':
        return this.visitPlan(user, i);
      case 'visitPlanApprove':
        return this.visitPlanApprove(user, i);
      case 'visitOpen':
        return this.visitOpen(user, i);
      case 'visitAccess':
        return this.visitAccess(user, i);
      case 'visitRecord':
        return this.visitRecord(user, i);
      case 'visitFinding':
        return this.visitFinding(user, i);
      case 'visitFollowUp':
        return this.visitFollowUp(user, i);
      case 'visitClose':
        return this.visitClose(user, i);
      default:
        throw new BadRequest('Unknown office action.');
    }
  }

  private async setSettings(user: User, i: Record<string, unknown>) {
    if (!this.team(user) && !this.ad(user)) throw new AccessDenied('view', '(the maintenance unit or the Asset Director keeps the settings)');
    const reason = this.reason(i.reason);
    const cur = (await this.all()).find((r) => r.kind === 'settings');
    const d: Record<string, unknown> = { ...(cur?.d ?? {}) };
    const base = RULES.officeAm.value as unknown as Record<string, Record<string, unknown>>;
    for (const k of ['repair', 'inventory', 'disposal', 'building', 'rent', 'visit', 'jmb']) {
      const src = i[k] as Record<string, unknown> | undefined;
      if (!src || typeof src !== 'object') continue;
      const ok = Object.fromEntries(Object.entries(src).filter(([x, v]) => x in base[k] && typeof base[k][x] === 'number' && Number.isFinite(Number(v)) && Number(v) >= 0).map(([x, v]) => [x, Number(v)]));
      d[k] = { ...((d[k] as object) ?? {}), ...ok };
    }
    if (i.examples && typeof i.examples === 'object')
      d.examples = Object.fromEntries(DAMAGE_LEVELS.filter((l) => Array.isArray((i.examples as Record<string, unknown>)[l])).map((l) => [l, ((i.examples as Record<string, unknown[]>)[l]).map((x) => s(x, 80)).filter(Boolean).slice(0, 40)]));
    if (Array.isArray(i.visitLines)) d.visitLines = (i.visitLines as unknown[]).map((x) => s(x, 40)).filter(Boolean).slice(0, 30);
    if (cur) return this.save(user, cur, { d }, 'settings', reason);
    return this.create(user, 'settings', 'OSET', { d, status: 'active', companyId: null }, reason);
  }

  // ===============================================================================================================
  // Section 1: office repairs (S1-S16, S43-S45)
  // ===============================================================================================================

  private async place(i: Record<string, unknown>, user: User) {
    const unitId = s(i.unitId, 120) || null;
    let companyId = s(i.companyId, 60) || null;
    let ownerCompanyId: Id | null = null;
    let label = '';
    if (unitId) {
      const u = await this.store.get('amUnits', unitId).catch(() => undefined);
      if (u) {
        label = `${u.code} ${u.name}`;
        ownerCompanyId = u.purchase?.buyingCompanyId ?? null;
        companyId = companyId ?? u.ownUse?.companyId ?? ownerCompanyId;
      } else if (this.oversee(user)) throw new BadRequest('Choose the office or unit from the list.');
    }
    // Office staff do not read the building register: they name their office, and the unit links the building at the check.
    const known = !!label;
    if (!companyId) companyId = user.companyIds[0] ?? null;
    const address = s(i.address, 300);
    if (!label && !companyId && address.length < 5) throw new BadRequest('Choose the office or unit, or give the address when it is not listed.');
    return { unitId: known ? unitId : null, companyId, ownerCompanyId, label: label || address || String(companyId), address };
  }

  /** S1-S3, S44-S45: any signed-in staff member reports office damage. */
  private async repairRequest(user: User, i: Record<string, unknown>) {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') throw new AccessDenied('view', '(staff report office damage)');
    const type = s(i.damageType, 30);
    if ((IT_DAMAGE_TYPES as readonly string[]).includes(type)) {
      // S3: IT owns electronic devices; this opens an IT ticket instead of a work order.
      const t = await this.svc.raiseItTicket(user, { category: 'DEVICE', priority: 'P3', title: `Kerosakan ${type}: ${s(i.description, 80)}`.slice(0, 120), detail: s(i.description, 1000) || type, photos: Array.isArray(i.photos) ? (i.photos as ProofInput[]) : [] });
      return { goesTo: 'IT', ticket: t };
    }
    if (!(AM_DAMAGE_TYPES as readonly string[]).includes(type)) throw new BadRequest('Choose the damage type.');
    const { examples } = await this.values();
    const example = s(i.example, 80);
    const fromExample = (DAMAGE_LEVELS.find((l) => examples[l].includes(example)) ?? null) as DamageLevel | null;
    let level = (DAMAGE_LEVELS.find((l) => l === i.level) ?? fromExample) as DamageLevel | null;
    if (!level) throw new BadRequest('Choose the damage level (minor, medium or critical).');
    if (fromExample && LEVEL_RANK[level] < LEVEL_RANK[fromExample]) throw new BadRequest(`"${example}" is ${fromExample}. A level can be raised, never lowered.`);
    if (fromExample && LEVEL_RANK[level] > LEVEL_RANK[fromExample]) this.reason(i.raiseReason, 'why the level is raised');
    const where = await this.place(i, user);
    const description = this.reason(i.description, 'a description of the damage');
    if (level === 'MINOR') {
      // S2: "Fix it yourself, no request needed". An optional note only.
      return { minor: true, message: 'Baiki sendiri, tiada permohonan diperlukan. (Fix it yourself, no request needed.)', note: s(i.fixedNote, 300) || null };
    }
    const photos = this.proofs(user, i.photos);
    if (!photos.length) throw new BadRequest('Attach at least one current photo of the damage.');
    const shared = (SHARED_AREAS as readonly string[]).includes(s(i.area, 30));
    const person = user.personId ? await this.store.get('people', user.personId).catch(() => undefined) : undefined;
    const d: Record<string, unknown> = {
      applicant: user.name,
      position: user.title ?? '',
      department: user.department ?? '',
      contact: s(i.contact, 60) || (person as { phone?: string } | undefined)?.phone || '',
      complaintOn: this.today(),
      foundOn: isDate(i.foundOn) && i.foundOn <= this.today() ? i.foundOn : this.today(),
      place: where.label,
      address: where.address,
      damageType: type,
      example,
      level,
      description,
      suggested: s(i.suggested, 300),
      earlierRef: s(i.earlierRef, 40) || null,
      video: this.proofs(user, i.video).map((p) => p.sha256),
      area: s(i.area, 30) || 'own_unit',
      fireNote: /kebakaran|fire/i.test(example) ? 'Hubungi 994 / BOMBA dahulu. Call 994 / BOMBA first.' : null,
      ownerCompanyId: where.ownerCompanyId,
    };
    if (shared) {
      // S45: a shared area is a JMB report, not a work order: no quotes, no payment by us.
      return this.create(user, 'jmb', 'JMB', { d: { ...d, group: s(i.jmbGroup, 40) || null, followUps: [] }, status: 'to_report', companyId: where.companyId, unitId: where.unitId, requesterId: user.id, proof: photos }, `${level} ${where.label}: ${description}`);
    }
    return this.create(user, 'repair', 'BPP', { d: { ...d, stage: 'submitted', rounds: [], quotes: [], approvals: {} }, status: 'submitted', companyId: where.companyId, unitId: where.unitId, requesterId: user.id, proof: photos }, `${level} ${where.label}: ${description}`);
  }

  private async repair(id: unknown) {
    return this.get(s(id, 120), 'repair');
  }
  private needTeam(user: User) {
    if (!this.team(user)) throw new AccessDenied('view', '(the maintenance unit)');
  }

  /** S4: the unit checks; returns for something missing, marks it minor, or accepts it (the work order opens). */
  private async repairCheck(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (r.status !== 'submitted') throw new BadRequest('Only a new request is checked.');
    const reason = this.reason(i.reason);
    if (i.outcome === 'return') return this.save(user, r, { status: 'on_hold', d: { ...r.d, stage: 'on_hold', hold: reason } }, 'on_hold', `incomplete: ${reason}`);
    if (i.outcome === 'minor') return this.save(user, r, { status: 'closed', d: { ...r.d, stage: 'minor', closedReason: reason } }, 'minor', `Minor - fix yourself: ${reason}`);
    if (i.outcome !== 'accept') throw new BadRequest('Accept, return or mark it minor.');
    const v = (await this.values()).repair;
    if (!r.unitId && i.unitId) {
      // The unit links the building the office named (staff do not read the building register).
      const u = await this.store.get('amUnits', s(i.unitId, 120)).catch(() => undefined);
      if (!u) throw new BadRequest('Choose the building from the register.');
      r.unitId = u.id;
      r.d = { ...r.d, place: `${u.code} ${u.name}`, ownerCompanyId: u.purchase?.buyingCompanyId ?? null };
    }
    const wo: AmWorkOrder = {
      id: `wo-office-${toMs(this.now())}-${globalThis.crypto.randomUUID().slice(0, 6)}`,
      unitId: r.unitId ?? null,
      propertyId: null,
      title: `${r.ref}: ${String(r.d.description).slice(0, 100)}`,
      source: r.d.fromVisit ? 'inspection' : 'staff',
      raisedOn: this.today(),
      dueOn: addWorkingDays(this.today(), r.d.level === 'CRITICAL' ? v.criticalResponseDays : v.repairDays + 3),
      status: 'open',
      cost: null,
      contractor: null,
      doneOn: null,
      officeRepairId: r.id,
    };
    await this.store.transaction(async (tx) => {
      await tx.insert('amWorkOrders', wo);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.workorder.office', entity: 'am_work_order', entityId: wo.id, summary: `${r.ref} accepted: ${wo.title}` });
    });
    return this.save(user, r, { status: 'checked', unitId: r.unitId ?? null, d: { ...r.d, stage: 'checked', workOrderId: wo.id, checkedBy: user.name, checkedById: user.id } }, 'accepted', reason);
  }
  private async repairResubmit(user: User, i: Record<string, unknown>) {
    const r = await this.repair(i.id);
    if (r.status !== 'on_hold') throw new BadRequest('This request is not on hold.');
    if (r.requesterId !== user.id) throw new AccessDenied('view', '(the person who asked adds what was missing)');
    const add = this.proofs(user, i.photos);
    return this.save(user, r, { status: 'submitted', d: { ...r.d, stage: 'submitted', description: s(i.description, 1000) || r.d.description, added: this.reason(i.note, 'what you added') }, proof: [...(r.proof ?? []), ...add] }, 'resubmit', s(i.note, 200));
  }
  /** S5: site visit date, then what was found plus the inspection report file. */
  private async repairVisit(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (!['checked', 'visit_set'].includes(r.status)) throw new BadRequest('Accept the request first.');
    if (r.status === 'checked') {
      if (!isDate(i.on)) throw new BadRequest('Give the visit date.');
      return this.save(user, r, { status: 'visit_set', d: { ...r.d, stage: 'visit_set', visitOn: i.on, contractorInvited: s(i.contractor, 120) || null } }, 'visit_set', String(i.on));
    }
    const report = this.proofs(user, i.docs);
    if (!report.length) throw new BadRequest('Attach the inspection report.');
    return this.save(user, r, { status: 'visited', d: { ...r.d, stage: 'visited', found: this.reason(i.found, 'what was found (the job details)'), cause: s(i.cause, 300), inspectionReport: report[0].sha256 }, proof: [...(r.proof ?? []), ...report] }, 'visited', s(i.found, 200));
  }
  /** S6-S7: three quotes (fewer only with the Asset Director's reason); the quote-only path up to RM5,000. */
  private async repairQuotes(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (!['visited', 'quoted', 'turned_down', 'checked'].includes(r.status)) throw new BadRequest('Record the site visit first (or accept the request).');
    const quotes = (Array.isArray(i.quotes) ? (i.quotes as Record<string, unknown>[]) : []).slice(0, 10).map((q) => ({ contractor: s(q.contractor, 120), price: money(q.price), scope: s(q.scope, 300), days: Math.max(0, int(q.days) || 0), warrantyMonths: Math.max(0, int(q.warrantyMonths) || 0), doc: null as string | null }));
    if (quotes.some((q) => q.contractor.length < 2 || !(q.price > 0))) throw new BadRequest('Each quote needs the contractor and the price.');
    const docs = this.proofs(user, i.docs);
    quotes.forEach((q, k) => (q.doc = docs[k]?.sha256 ?? null));
    const v = (await this.values()).repair;
    const fewer = quotes.length < v.quotesNeeded;
    return this.save(user, r, { status: 'quoted', d: { ...r.d, stage: 'quoted', quotes, fewerReason: null, pick: null, path: null }, proof: [...(r.proof ?? []), ...docs] }, 'quotes', `${quotes.length} quote(s)${fewer ? ' (fewer than 3: the Asset Director gives the reason)' : ''}`);
  }
  /** The team picks one with a reason; fewer than three need the Asset Director's reason (S-X1). */
  private async repairPick(user: User, i: Record<string, unknown>) {
    const r = await this.repair(i.id);
    if (r.status !== 'quoted') throw new BadRequest('Record the quotes first.');
    const quotes = r.d.quotes as { contractor: string; price: number }[];
    const v = (await this.values()).repair;
    if (quotes.length < v.quotesNeeded && !r.d.fewerReason) {
      if (!this.ad(user)) throw new BadRequest(`Fewer than ${v.quotesNeeded} quotes: the Asset Director gives the reason first (one contractor only, or an emergency).`);
      return this.save(user, r, { d: { ...r.d, fewerReason: { by: user.name, byId: user.id, at: this.now(), reason: this.reason(i.reason) } } }, 'fewer_quotes', s(i.reason, 200));
    }
    this.needTeam(user);
    const q = quotes.find((x) => x.contractor === s(i.contractor, 120));
    if (!q) throw new BadRequest('Pick one of the recorded quotes.');
    const lowest = Math.min(...quotes.map((x) => x.price));
    const why = this.reason(i.reason, q.price > lowest ? 'why not the lowest quote' : 'the reason for the pick');
    const path = q.price <= v.quoteOnlyUpTo ? 'quote_only' : 'bq';
    return this.save(user, r, { status: 'for_approval', d: { ...r.d, stage: 'for_approval', pick: { contractor: q.contractor, price: q.price, reason: why, by: user.name, byId: user.id }, path, approvals: {} } }, 'pick', `${q.contractor} RM${q.price.toFixed(2)} (${path})`);
  }
  /** S8: Asset Director approves, the Vice Chairman consents, and the CEO approves above RM50,000; each with a reason. */
  private async repairApprove(user: User, i: Record<string, unknown>) {
    const r = await this.repair(i.id);
    if (r.status !== 'for_approval') throw new BadRequest('Nothing to approve.');
    const pick = r.d.pick as { contractor: string; price: number; byId: Id };
    if (user.id === r.requesterId || user.id === pick.byId) throw new BadRequest('Nobody approves their own request or pick.');
    const reason = this.reason(i.reason);
    const ap = { ...(r.d.approvals as Record<string, unknown>) };
    const v = (await this.values()).repair;
    const step = { by: user.name, byId: user.id, at: this.now(), reason };
    if (i.decision === 'turn_down') {
      if (!this.ad(user) && !this.vc(user) && !this.ceo(user)) throw new AccessDenied('view', '(the approvers)');
      // Turned down = a new round of quotes; the earlier round is kept.
      const rounds = [...((r.d.rounds as unknown[]) ?? []), { quotes: r.d.quotes, pick, turnedDown: step }];
      return this.save(user, r, { status: 'turned_down', d: { ...r.d, stage: 'turned_down', rounds, quotes: [], pick: null, approvals: {} } }, 'turned_down', reason);
    }
    if (!ap.ad) {
      if (!this.ad(user)) throw new BadRequest('The Asset Director approves first.');
      ap.ad = step;
    } else if (!ap.vc) {
      if (!this.vc(user)) throw new BadRequest('The Vice Chairman consents next.');
      ap.vc = step;
    } else if (pick.price > v.ceoAbove && !ap.ceo) {
      if (!this.ceo(user)) throw new BadRequest(`Above RM${v.ceoAbove.toLocaleString('en-MY')} the CEO approves.`);
      ap.ceo = step;
    } else throw new BadRequest('Already approved.');
    const done = !!ap.ad && !!ap.vc && (pick.price <= v.ceoAbove || !!ap.ceo);
    const saved = await this.save(user, r, { status: done ? 'approved' : 'for_approval', d: { ...r.d, approvals: ap, stage: done ? 'approved' : 'for_approval', approvedAmount: done ? pick.price : null } }, done ? 'approved' : 'approval_step', reason);
    if (done) await this.woPatch(user, saved, { contractor: pick.contractor, cost: pick.price });
    return saved;
  }
  /** S-X4: critical damage: the Asset Director may approve a make-safe job on one quote with a reason. */
  private async repairEmergency(user: User, i: Record<string, unknown>) {
    const r = await this.repair(i.id);
    if (!this.ad(user)) throw new AccessDenied('view', '(the Asset Director approves a make-safe job)');
    if (r.d.level !== 'CRITICAL') throw new BadRequest('Only critical damage has a make-safe job.');
    if (r.d.makeSafe) throw new BadRequest('A make-safe job is already approved.');
    const contractor = this.reason(i.contractor, 'the contractor');
    const price = money(i.price);
    if (!(price > 0)) throw new BadRequest('Give the quote amount.');
    const step = { by: user.name, byId: user.id, at: this.now(), reason: this.reason(i.reason), contractor, price };
    return this.save(user, r, { d: { ...r.d, makeSafe: step } }, 'make_safe', `${contractor} RM${price.toFixed(2)}: ${step.reason}`);
  }
  private async woPatch(user: User, r: OfficeAmRec, patch: Partial<AmWorkOrder>) {
    const id = r.d.workOrderId as Id | undefined;
    if (!id) return;
    await this.store.transaction(async (tx) => {
      if (!(await tx.get('amWorkOrders', id))) return;
      await tx.update('amWorkOrders', id, patch);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.workorder.office', entity: 'am_work_order', entityId: id, summary: `${r.ref}: ${Object.keys(patch).join(', ')}` });
    });
  }
  /** No work before final approval: the work order moves to "in progress" only then. */
  private async repairStart(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (r.status !== 'approved') throw new BadRequest('No work starts before the final approval.');
    const saved = await this.save(user, r, { status: 'in_progress', d: { ...r.d, stage: 'in_progress', startedOn: this.today() } }, 'start', String(r.d.workOrderId ?? ''));
    await this.woPatch(user, saved, { status: 'in_progress' });
    return saved;
  }
  /** S43: the unit sets a new date per job with a reason (parts on order). */
  private async repairDue(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (!isDate(i.on)) throw new BadRequest('Give the new date.');
    return this.save(user, r, { d: { ...r.d, dueOverride: { on: i.on, reason: this.reason(i.reason) } } }, 'due', `${i.on}: ${s(i.reason, 200)}`);
  }
  /** S9: the team records the finish and after photos. */
  private async repairDone(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (r.status !== 'in_progress' && !(r.status === 'reopened')) throw new BadRequest('The job is not in progress.');
    const after = this.proofs(user, i.photos);
    if (!after.length) throw new BadRequest('Attach the after photos.');
    return this.save(user, r, { status: 'work_done', d: { ...r.d, stage: 'work_done', finishedOn: isDate(i.on) ? i.on : this.today(), afterPhotos: after.map((p) => p.sha256), doneById: user.id } }, 'work_done', 'finished');
  }
  /** The requester confirms (or says it is not fixed, which reopens it); after day 5 the Asset Director may confirm. */
  private async repairConfirm(user: User, i: Record<string, unknown>) {
    const r = await this.repair(i.id);
    if (r.status !== 'work_done') throw new BadRequest('Nothing to confirm yet.');
    const own = r.requesterId === user.id;
    const v = (await this.values()).repair;
    const waited = daysBetween(String(r.d.finishedOn), this.today());
    if (!own) {
      if (!this.ad(user)) throw new AccessDenied('view', '(the person who asked confirms)');
      if (waited < (v.confirmRemindDays[1] ?? 5)) throw new BadRequest(`The person who asked confirms; the Asset Director may confirm instead after day ${v.confirmRemindDays[1] ?? 5}.`);
    }
    if (i.fixed === false) {
      const why = this.reason(i.reason, 'what is still wrong');
      const saved = await this.save(user, r, { status: 'in_progress', d: { ...r.d, stage: 'in_progress', notFixed: [...((r.d.notFixed as unknown[]) ?? []), { by: user.name, at: this.now(), reason: why }] } }, 'not_fixed', why);
      return saved;
    }
    const reason = own ? s(i.reason, 300) || 'fixed' : this.reason(i.reason, 'why you confirm for the person');
    // The work order is marked done by the unit when it closes the job (the requester has no write on work orders).
    const saved = await this.save(user, r, { status: 'confirmed', d: { ...r.d, stage: 'confirmed', confirmed: { by: user.name, byId: user.id, at: this.now(), reason, standIn: !own } } }, 'confirmed', reason);
    // S10: the payment request goes to Finance for the approved amount (award plus approved variations only).
    // Review B3: approved variation orders on the linked work order's BQ are added; nothing else ever is.
    const award = money(r.d.approvedAmount ?? (r.d.makeSafe as { price?: number } | undefined)?.price ?? 0);
    const wo = r.d.workOrderId ? ((await this.store.get('amWorkOrders', r.d.workOrderId as Id)) as AmWorkOrder | undefined) : undefined;
    const vos = (wo?.bq?.variations ?? []).filter((x) => x.final && !x.withdrawn);
    const voSum = Math.round(vos.reduce((n, x) => n + x.amount, 0) * 100) / 100;
    const approved = Math.max(0, Math.round((award + voSum) * 100) / 100);
    const payer = r.d.structure === true && r.d.ownerCompanyId ? (r.d.ownerCompanyId as Id) : r.companyId;
    return this.save(user, saved, { status: 'payment_requested', d: { ...saved.d, stage: 'payment_requested', payRequest: { amount: approved, award, ...(vos.length ? { variations: vos.map((x) => ({ id: x.id, amount: x.amount })) } : {}), payee: (r.d.pick as { contractor?: string } | null)?.contractor ?? (r.d.makeSafe as { contractor?: string } | undefined)?.contractor ?? '', payerCompanyId: payer, at: this.now(), paymentId: null, bankRef: null } } }, 'payment_requested', `RM${approved.toFixed(2)} to Finance (${payer})${vos.length ? `: award RM${award.toFixed(2)} plus ${vos.length} approved variation order${vos.length === 1 ? '' : 's'} RM${voSum.toFixed(2)}` : ''}`);
  }
  /** Finance links the payment it raised in its own payments screen; never above the approved amount. */
  private async payLink(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance)');
    const r = await this.repair(i.id);
    const pr = r.d.payRequest as { amount: number; payee: string; payerCompanyId: Id } | undefined;
    if (!pr || r.status !== 'payment_requested') throw new BadRequest('No payment request.');
    const p = await this.finPayment(s(i.paymentId, 120));
    if (!p) throw new BadRequest('Choose the Finance payment.');
    if (p.amount > pr.amount + 0.001) throw new BadRequest(`RM${p.amount.toFixed(2)} is more than the approved RM${pr.amount.toFixed(2)}. Never more than the approved amount.`);
    if (pr.payerCompanyId && p.companyId !== pr.payerCompanyId) throw new BadRequest('The payment must be from the paying company.');
    if (pr.payee && !p.payee.toLowerCase().includes(pr.payee.toLowerCase().slice(0, 6))) throw new BadRequest('The payee is not the awarded contractor.');
    // Review B4: one Finance payment pays one repair job only.
    const at = this.now();
    const note = `${p.id} RM${p.amount.toFixed(2)}`;
    const next: Partial<OfficeAmRec> = { d: { ...r.d, payRequest: { ...pr, paymentId: p.id } }, version: r.version + 1, history: [...r.history, { at, byId: user.id, by: user.name, action: 'payment_linked', note }] };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('officeAmRecs', `finpay:${p.id}`);
      const others = (await tx.list('officeAmRecs', {})) as OfficeAmRec[];
      const used = others.find((o) => o.id !== r.id && (o.d?.payRequest as { paymentId?: Id | null } | undefined)?.paymentId === p.id);
      if (used) throw new BadRequest(`Finance payment ${p.id} is already linked to ${used.ref}. One payment pays one repair job.`);
      await tx.update('officeAmRecs', r.id, next as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `asset.office.${r.kind}.payment_linked`, entity: 'office_am', entityId: r.id, summary: `${r.ref} payment_linked [${r.companyId ?? 'group'}]: ${note}`.slice(0, 300) });
      return { ...r, ...next } as OfficeAmRec;
    });
  }
  /** When Finance releases it, the bank reference and receipt go on the work order. */
  private async payReceipt(user: User, i: Record<string, unknown>) {
    if (!this.finance(user) && !this.team(user)) throw new AccessDenied('view', '(Finance or the maintenance unit)');
    const r = await this.repair(i.id);
    const pr = r.d.payRequest as { paymentId: Id | null } | undefined;
    if (!pr?.paymentId) throw new BadRequest('Finance links the payment first.');
    const p = await this.finPayment(pr.paymentId);
    if (!p?.bankRef || !p.releasedOn) throw new BadRequest('The payment is not released yet.');
    return this.save(user, r, { status: 'paid', d: { ...r.d, stage: 'paid', payRequest: { ...pr, bankRef: p.bankRef, releasedOn: p.releasedOn }, financeReceipt: { bankRef: p.bankRef, on: p.releasedOn, amount: p.amount } } }, 'paid', `${p.bankRef} ${p.releasedOn}`);
  }
  /** S-X8 both ways: a receipt that came by Teams or email is attached too, and a difference is shown. */
  private async receiptAttach(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    const doc = this.proofs(user, i.docs);
    if (!doc.length) throw new BadRequest('Attach the receipt.');
    const amount = money(i.amount);
    const fin = r.d.financeReceipt as { amount: number; bankRef: string } | undefined;
    const differs = fin ? Math.abs(fin.amount - amount) > 0.009 || (s(i.ref, 60) && s(i.ref, 60) !== fin.bankRef) : false;
    return this.save(user, r, { d: { ...r.d, teamsReceipt: { via: i.via === 'email' ? 'email' : 'teams', amount, ref: s(i.ref, 60), doc: doc[0].sha256, differs } }, proof: [...(r.proof ?? []), ...doc] }, 'receipt', differs ? 'differs from the Finance payment' : 'attached');
  }
  private async repairReport(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    const report = { what: this.reason(i.what, 'what was done'), parts: s(i.parts, 300), cost: money(i.cost), warrantyEnd: isDate(i.warrantyEnd) ? i.warrantyEnd : null, by: user.name };
    return this.save(user, r, { d: { ...r.d, report } }, 'report', report.what);
  }
  /** S11: closes only with the four documents. */
  repairMissing(r: OfficeAmRec): string[] {
    const out: string[] = [];
    if (!(r.proof ?? []).length) out.push('damage photos');
    if (!r.d.pick && !r.d.makeSafe) out.push('the approved quote');
    if (!r.d.financeReceipt && !r.d.teamsReceipt) out.push('the payment receipt');
    if (!r.d.report) out.push('the repair report');
    return out;
  }
  private async repairClose(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.repair(i.id);
    if (r.status === 'closed') throw new BadRequest('Already closed.');
    if (r.status !== 'paid') throw new BadRequest('The job is not paid yet.');
    const missing = this.repairMissing(r);
    if (missing.length) throw new BadRequest(`Cannot close: ${missing.join(', ')} missing.`);
    const saved = await this.save(user, r, { status: 'closed', d: { ...r.d, stage: 'closed', closedOn: this.today() } }, 'closed', this.reason(i.reason ?? 'four documents filed'));
    await this.woPatch(user, saved, { status: 'done', doneOn: String(r.d.finishedOn ?? this.today()) });
    return saved;
  }
  /** S45: the unit reports to the JMB and follows up; a bill or a needed fix turns into a normal work order. */
  private async jmbStep(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.get(s(i.id, 120), 'jmb');
    const step = s(i.step, 20);
    if (step === 'reported') {
      if (!isDate(i.on)) throw new BadRequest('Give the date reported.');
      return this.save(user, r, { status: 'reported', d: { ...r.d, reported: { on: i.on, how: s(i.how, 20) || 'letter', jmbRef: s(i.jmbRef, 60), jmbName: s(i.jmbName, 120) } } }, 'reported', s(i.jmbRef, 60));
    }
    if (step === 'followUp') return this.save(user, r, { d: { ...r.d, followUps: [...((r.d.followUps as unknown[]) ?? []), { on: this.today(), note: this.reason(i.note, 'what the JMB said') }] } }, 'follow_up', s(i.note, 200));
    if (step === 'fixed') {
      const after = this.proofs(user, i.photos);
      if (!after.length) throw new BadRequest('Attach the photo after.');
      return this.save(user, r, { status: 'fixed', d: { ...r.d, fixedOn: isDate(i.on) ? i.on : this.today() }, proof: [...(r.proof ?? []), ...after] }, 'fixed', 'fixed by the JMB');
    }
    if (step === 'toWorkOrder') {
      const why = this.reason(i.reason, 'why we fix it (the JMB billed us, or it must be made safe)');
      const job = await this.create(user, 'repair', 'BPP', { d: { ...r.d, stage: 'submitted', rounds: [], quotes: [], approvals: {}, fromJmb: r.id }, status: 'submitted', companyId: r.companyId, unitId: r.unitId, requesterId: r.requesterId, proof: r.proof }, `from ${r.ref}: ${why}`);
      await this.save(user, r, { status: 'to_work_order', d: { ...r.d, repairId: job.id } }, 'to_work_order', why);
      return job;
    }
    throw new BadRequest('Unknown step.');
  }

  // ===============================================================================================================
  // Section 2: office inventory (S17-S31)
  // ===============================================================================================================

  private async canSendFor(user: User, companyId: Id) {
    if (this.team(user)) return true;
    if (!(user.role === 'company_manager' || user.role === 'admin_exec') || !this.staffOf(user, companyId)) return false;
    const off = (await this.all()).find((r) => r.kind === 'invAccess' && r.d.userId === user.id && r.status === 'off');
    return !off;
  }
  private itemFields(x: Record<string, unknown>) {
    return {
      name: s(x.name, 120),
      category: (['office', 'furniture', 'tools', 'other'] as const).find((c) => c === x.category) ?? 'office',
      serial: s(x.serial, 60) || null,
      brandModel: s(x.brandModel, 120),
      quantity: Math.max(1, int(x.quantity) || 1),
      location: s(x.location, 120),
      condition: (['new', 'good', 'worn', 'damaged'] as const).find((c) => c === x.condition) ?? 'good',
      boughtOn: isDate(x.boughtOn) ? x.boughtOn : null,
      price: x.price === undefined || x.price === '' || x.price === null ? null : money(x.price),
      responsible: s(x.responsible, 120),
      notes: s(x.notes, 300),
      itemToken: s(x.itemToken, 40) || null,
      amAssetId: s(x.amAssetId, 120) || null,
      warrantyEnd: isDate(x.warrantyEnd) ? x.warrantyEnd : null,
      assetNo: s(x.assetNo, 60) || null,
    };
  }
  /** S20-S21, S23: the office sends an update request (one item or many); the live record changes only after S22. */
  private async invSubmit(user: User, i: Record<string, unknown>) {
    const companyId = s(i.companyId, 60) || user.companyIds[0] || '';
    if (!(await this.canSendFor(user, companyId))) throw new AccessDenied('view', '(the office head and executives named for the office, or the maintenance unit)');
    const raw = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : [];
    if (!raw.length || raw.length > 500) throw new BadRequest('Send 1 to 500 lines.');
    const items = (await this.all()).filter((r) => r.kind === 'invItem');
    const docs = this.proofs(user, i.docs);
    const lines = raw.map((x, k) => {
      const itemId = s(x.itemId, 120) || null;
      const f = this.itemFields(x);
      if (itemId) {
        const cur = items.find((r) => r.id === itemId && r.companyId === companyId);
        if (!cur) throw new BadRequest(`Line ${k + 1}: the item is not in this office's inventory.`);
        const changes = Object.fromEntries(Object.entries(x).filter(([key]) => ['location', 'condition', 'responsible', 'name', 'brandModel', 'serial', 'notes', 'warrantyEnd', 'quantity'].includes(key)).map(([key]) => [key, (f as Record<string, unknown>)[key]]));
        if (!Object.keys(changes).length) throw new BadRequest(`Line ${k + 1}: nothing to change.`);
        return { k, itemId, changes, result: 'pending', duplicateOf: null as string | null, photo: null as string | null };
      }
      if (f.name.length < 2 || f.location.length < 2) throw new BadRequest(`Line ${k + 1}: give the item and its location.`);
      const photo = docs[k]?.sha256 ?? (i.firstLoad === true ? null : undefined);
      if (photo === undefined) throw new BadRequest(`Line ${k + 1}: a new item needs at least one photo.`);
      // S21: same serial, or same brand + model + location + purchase date.
      const dup = items.find((r) => r.companyId === companyId && ((f.serial && r.d.serial === f.serial) || (f.brandModel && r.d.brandModel === f.brandModel && r.d.location === f.location && r.d.boughtOn === f.boughtOn && f.boughtOn)));
      return { k, itemId: null, fields: f, result: 'pending', duplicateOf: dup?.ref ?? null, photo };
    });
    const firstLoad = i.firstLoad === true;
    return this.create(user, 'invUpdate', 'KIP', { d: { lines, firstLoad, note: s(i.note, 300), senderId: user.id }, status: 'submitted', companyId, requesterId: user.id, proof: docs }, `${lines.length} line(s)${firstLoad ? ' (first load)' : ''}`);
  }
  private async invResubmit(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'invUpdate');
    if (r.status !== 'returned_to_office') throw new BadRequest('Not returned.');
    if (r.requesterId !== user.id) throw new AccessDenied('view', '(the sender fixes it)');
    const lines = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]).map((x) => ({ ...x })) : (r.d.lines as unknown[]);
    return this.save(user, r, { status: 'submitted', d: { ...r.d, lines, fixed: this.reason(i.note, 'what you fixed') }, proof: [...(r.proof ?? []), ...this.proofs(user, i.docs)] }, 'resubmit', s(i.note, 200));
  }
  /** S22: the unit checks (or returns to the office); never its own update. */
  private async invCheck(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.get(s(i.id, 120), 'invUpdate');
    if (r.status !== 'submitted') throw new BadRequest('Nothing to check.');
    if (r.requesterId === user.id) throw new BadRequest('Nobody checks their own update.');
    if (i.outcome === 'return') return this.save(user, r, { status: 'returned_to_office', d: { ...r.d, returned: this.reason(i.reason, 'what to fix') } }, 'returned', s(i.reason, 200));
    const lines = this.lineResults(r, i);
    return this.save(user, r, { status: 'checked', d: { ...r.d, lines, checked: { by: user.name, byId: user.id, at: this.now(), reason: this.reason(i.reason ?? 'checked') } } }, 'checked', `${lines.filter((l) => l.result !== 'refused').length} line(s) on`);
  }
  private lineResults(r: OfficeAmRec, i: Record<string, unknown>) {
    const refuse = new Set(Array.isArray(i.refuseLines) ? (i.refuseLines as unknown[]).map((x) => int(x)) : []);
    return (r.d.lines as { k: number; result: string }[]).map((l) => (l.result === 'refused' ? l : { ...l, result: refuse.has(l.k) ? 'refused' : 'ok' }));
  }
  /** The Asset Director confirms (or returns to the unit); never their own. */
  private async invConfirm(user: User, i: Record<string, unknown>) {
    if (!this.ad(user)) throw new AccessDenied('view', '(the Asset Director confirms)');
    const r = await this.get(s(i.id, 120), 'invUpdate');
    if (r.status !== 'checked') throw new BadRequest('The maintenance unit checks it first.');
    if (r.requesterId === user.id || (r.d.checked as { byId: Id }).byId === user.id) throw new BadRequest('Nobody confirms their own update or check.');
    if (i.outcome === 'return') return this.save(user, r, { status: 'submitted', d: { ...r.d, backToUnit: this.reason(i.reason) } }, 'returned_to_unit', s(i.reason, 200));
    const lines = this.lineResults(r, i);
    return this.save(user, r, { status: 'confirmed', d: { ...r.d, lines, confirmed: { by: user.name, byId: user.id, at: this.now(), reason: this.reason(i.reason) } } }, 'confirmed', s(i.reason, 200));
  }
  /** The unit files it: the live inventory record changes now, with who checked and who confirmed. */
  private async invFile(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.get(s(i.id, 120), 'invUpdate');
    if (r.status !== 'confirmed') throw new BadRequest('Not confirmed yet.');
    const by = { checkedBy: (r.d.checked as { by: string }).by, confirmedBy: (r.d.confirmed as { by: string }).by, updateRef: r.ref, at: this.now() };
    const out: string[] = [];
    for (const l of r.d.lines as { result: string; itemId: Id | null; fields?: Record<string, unknown>; changes?: Record<string, unknown>; photo: string | null }[]) {
      if (l.result !== 'ok') continue;
      if (l.itemId) {
        const cur = await this.get(l.itemId, 'invItem');
        const before = Object.fromEntries(Object.keys(l.changes ?? {}).map((k) => [k, cur.d[k]]));
        const rec = await this.save(user, cur, { d: { ...cur.d, ...l.changes, lastChange: { ...by, before } }, status: 'confirmed' }, 'changed', `${r.ref}: ${Object.keys(l.changes ?? {}).join(', ')}`);
        out.push(rec.ref);
      } else {
        const rec = await this.create(user, 'invItem', 'INV', { d: { ...l.fields, photo: l.photo, confirmedBy: by, sharePoint: 'pending' }, status: r.d.firstLoad ? 'not_yet_checked' : 'confirmed', companyId: r.companyId, parentId: r.id }, `${String(l.fields?.name)} (${r.ref})`);
        out.push(rec.ref);
      }
    }
    return this.save(user, r, { status: 'filed', d: { ...r.d, filed: { by: user.name, at: this.now(), items: out } } }, 'filed', out.join(', '));
  }
  /** S27: the holder reports moved / damaged / lost / not mine; damaged also offers a repair request. */
  private async invReport(user: User, i: Record<string, unknown>) {
    const item = await this.get(s(i.itemId, 120), 'invItem');
    if (!this.staffOf(user, item.companyId) && !this.team(user)) throw new AccessDenied('view', item.companyId ?? '(office)');
    const what = (['moved', 'damaged', 'lost', 'not_mine'] as const).find((k) => k === i.what);
    if (!what) throw new BadRequest('Moved, damaged, lost or not mine?');
    const note = this.reason(i.note, 'what happened');
    const change: Record<string, unknown> = { notes: `${what}: ${note}` };
    if (what === 'moved') change.location = this.reason(i.location, 'where it is now');
    if (what === 'damaged') change.condition = 'damaged';
    const upd = await this.create(user, 'invUpdate', 'KIP', { d: { lines: [{ k: 0, itemId: item.id, changes: change, result: 'pending', duplicateOf: null, photo: null }], reported: what, note, senderId: user.id }, status: 'submitted', companyId: item.companyId, requesterId: user.id, proof: this.proofs(user, i.photos) }, `${item.ref} ${what}`);
    return { update: upd, offerRepair: what === 'damaged', lostCase: what === 'lost' ? 'Opened as an update; the unit opens the item case.' : null };
  }
  /** S24: the maintenance unit switches a person's update right off or on, with a reason. */
  private async invAccessSet(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const uid = s(i.userId, 120);
    const target = await this.store.get('users', uid).catch(() => undefined);
    if (!target) throw new NotFound('User');
    const on = i.on === true;
    const cur = (await this.all()).find((r) => r.kind === 'invAccess' && r.d.userId === uid);
    const reason = this.reason(i.reason);
    if (cur) return this.save(user, cur, { status: on ? 'on' : 'off' }, on ? 'on' : 'off', reason);
    return this.create(user, 'invAccess', 'AKS', { d: { userId: uid }, status: on ? 'on' : 'off', companyId: target.companyIds[0] ?? null }, `${target.name}: ${on ? 'on' : 'off'}: ${reason}`);
  }
  /** S31: until the SharePoint connection is on, the unit downloads the list monthly and Prima records who and when. */
  private async spExport(user: User, i: Record<string, unknown>) {
    if (!this.team(user) && !this.ad(user)) throw new AccessDenied('view', '(the maintenance unit)');
    const companyId = s(i.companyId, 60) || null;
    const items = (await this.all()).filter((r) => r.kind === 'invItem' && (!companyId || r.companyId === companyId));
    const head = ['ref', 'company', 'name', 'category', 'serial', 'brandModel', 'quantity', 'location', 'condition', 'boughtOn', 'price', 'responsible', 'status'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...items.map((r) => [r.ref, r.companyId, r.d.name, r.d.category, r.d.serial, r.d.brandModel, r.d.quantity, r.d.location, r.d.condition, r.d.boughtOn, r.d.price, r.d.responsible, r.status].map(esc).join(','))].join('\n');
    await this.create(user, 'spExport', 'SPX', { d: { scope: companyId ?? 'all', rows: items.length }, status: 'downloaded', companyId }, `${items.length} row(s) for SharePoint`);
    return { csv, rows: items.length, note: 'Upload to the approved SharePoint list and library. Prima stays the working record; if they differ, Prima wins.' };
  }

  // ===============================================================================================================
  // Section 3: office asset disposal (S32-S42, S47-S50)
  // ===============================================================================================================

  private async dispRequest(user: User, i: Record<string, unknown>) {
    const item = await this.get(s(i.itemId, 120), 'invItem');
    if (item.d.category === 'it_device' || item.d.itAssetId) throw new BadRequest('IT devices go through IT (data wipe first).');
    if (!(await this.canSendFor(user, item.companyId!)) && !this.staffOf(user, item.companyId)) throw new AccessDenied('view', item.companyId ?? '(office)');
    if ((await this.all()).some((r) => r.kind === 'disposal' && r.itemId === item.id && !['closed', 'rejected', 'put_back'].includes(r.status))) throw new BadRequest('A disposal for this item is already open.');
    const criteria = (Array.isArray(i.criteria) ? (i.criteria as unknown[]) : []).map((x) => s(x, 40)).filter((x) => (DISPOSAL_CRITERIA as readonly string[]).includes(x));
    if (!criteria.length) throw new BadRequest('Choose at least one reason from the list.');
    const photos = this.proofs(user, i.photos);
    const need = (await this.values()).disposal.photosNeeded;
    if (photos.length < need) throw new BadRequest(`Attach at least ${need} photos of the asset. Without photos the request cannot be sent.`);
    if (i.trueTick !== true) throw new BadRequest('Tick "this information is true".');
    const method = (DISPOSAL_METHODS as readonly string[]).includes(s(i.method, 30)) ? s(i.method, 30) : null;
    if (!method) throw new BadRequest('Propose a method.');
    const d = {
      type: 'office',
      applicant: user.name,
      position: user.title ?? '',
      assetName: item.d.name,
      assetNo: s(i.assetNo, 60) || item.d.assetNo || null,
      serial: item.d.serial,
      quantity: Math.max(1, int(i.quantity) || Number(item.d.quantity) || 1),
      location: item.d.location,
      responsible: item.d.responsible,
      yearBought: item.d.boughtOn ? String(item.d.boughtOn).slice(0, 4) : s(i.yearBought, 4),
      price: item.d.price,
      valueNow: i.valueNow === undefined ? null : money(i.valueNow),
      condition: s(i.condition, 30) || item.d.condition,
      criteria,
      reasonText: this.reason(i.reason, 'the reason'),
      proposedMethod: method,
      inventoryCopy: { ref: item.ref, ...item.d },
      repairRef: s(i.repairRef, 40) || null,
      notice: 'in_app',
    };
    return this.create(user, 'disposal', 'PLA', { d, status: 'submitted', companyId: item.companyId, itemId: item.id, requesterId: user.id, proof: [...photos, ...this.proofs(user, i.docs)] }, `${String(item.d.name)}: ${criteria.join(', ')}`);
  }
  private async disp(id: unknown) {
    return this.get(s(id, 120), 'disposal');
  }
  /** S35, S49: the unit (not the requester) inspects in place: not fit, reuse or move, repair, or fit (collected). */
  private async dispInspect(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.disp(i.id);
    if (r.status !== 'submitted') throw new BadRequest('Already inspected.');
    if (r.requesterId === user.id) throw new BadRequest('The requester never inspects their own request.');
    const photos = this.proofs(user, i.photos);
    if (!photos.length) throw new BadRequest('Attach the inspection photos.');
    const reason = this.reason(i.reason);
    const insp = { by: user.name, byId: user.id, at: this.now(), condition: s(i.condition, 60), reason };
    const outcome = s(i.outcome, 20);
    if (outcome === 'not_fit') return this.save(user, r, { status: 'rejected', d: { ...r.d, inspection: insp }, proof: [...(r.proof ?? []), ...photos] }, 'rejected', reason);
    if (outcome === 'reuse') return this.save(user, r, { status: 'closed', d: { ...r.d, inspection: insp, outcome: 'reuse', moveTo: s(i.moveTo, 120) || null } }, 'reuse', reason);
    if (outcome === 'repair') return this.save(user, r, { status: 'repair_proposed', d: { ...r.d, inspection: insp, outcome: 'repair' }, proof: [...(r.proof ?? []), ...photos] }, 'repair_proposed', reason);
    if (outcome !== 'fit') throw new BadRequest('Not fit, reuse, repair or fit for disposal?');
    // S36 (chart 2.0, S-X20): inspect in place, collect only if fit.
    const item = await this.get(r.itemId!, 'invItem');
    await this.save(user, item, { status: 'awaiting_disposal', d: { ...item.d, heldAt: 'Disposal holding area', beforeDisposal: item.d.location } }, 'collected', r.ref);
    return this.save(user, r, { status: 'collected', d: { ...r.d, inspection: insp, collected: { at: this.now(), by: user.name, photo: photos[0].sha256 } }, proof: [...(r.proof ?? []), ...photos] }, 'collected', 'in the disposal holding area');
  }
  private async dispReport(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.disp(i.id);
    if (!['collected', 'repair_proposed'].includes(r.status)) throw new BadRequest('Inspect and collect it first.');
    const method = (DISPOSAL_METHODS as readonly string[]).includes(s(i.method, 30)) ? s(i.method, 30) : (r.d.proposedMethod as string);
    let nbv: number | null = null;
    const amId = (r.d.inventoryCopy as { amAssetId?: string | null }).amAssetId;
    if (amId) {
      const a = await this.store.get('amAssets', amId).catch(() => undefined);
      nbv = a ? money((a as { nbv?: number }).nbv ?? a.cost) : null;
    }
    const report = { condition: this.reason(i.condition, 'the condition'), criteria: r.d.criteria, method, nbv: nbv ?? (i.valueNow === undefined ? null : money(i.valueNow)), saleMoney: i.saleMoney === undefined ? null : money(i.saleMoney), outsideGroup: i.outsideGroup === true, by: user.name, byId: user.id };
    return this.save(user, r, { status: 'for_approval', d: { ...r.d, report } }, 'report', `${method}${report.nbv != null ? `, value RM${report.nbv}` : ''}`);
  }
  /** S38 (S-X16, S-X21): Asset Director approves; the Vice Chairman consents at RM10,000 book value, a sale, or a donation/transfer outside the group. */
  private async dispApprove(user: User, i: Record<string, unknown>) {
    const r = await this.disp(i.id);
    if (r.status !== 'for_approval') throw new BadRequest('Nothing to approve.');
    if (user.id === r.requesterId) throw new BadRequest('Nobody approves their own request.');
    const rep = r.d.report as { method: string; nbv: number | null; outsideGroup: boolean; byId: Id };
    const reason = this.reason(i.reason);
    const step = { by: user.name, byId: user.id, at: this.now(), reason };
    const v = (await this.values()).disposal;
    const needVc = (rep.nbv ?? 0) >= v.vcConsentNbv || rep.method === 'sale' || ((rep.method === 'donation' || rep.method === 'transfer') && rep.outsideGroup);
    const ap = { ...((r.d.approvals as Record<string, unknown>) ?? {}) };
    if (!ap.ad) {
      if (!this.ad(user)) throw new BadRequest('The Asset Director approves.');
      if (i.decision === 'refuse') return this.save(user, r, { status: 'refused', d: { ...r.d, approvals: { ad: step }, refused: step } }, 'refused', reason);
      const method = (DISPOSAL_METHODS as readonly string[]).includes(s(i.method, 30)) ? s(i.method, 30) : rep.method;
      ap.ad = { ...step, method };
    } else if (needVc && !ap.vc) {
      if (!this.vc(user)) throw new BadRequest('The Vice Chairman consents next.');
      if (i.decision === 'refuse') return this.save(user, r, { status: 'refused', d: { ...r.d, approvals: { ...ap, vc: step }, refused: step } }, 'refused', reason);
      ap.vc = step;
    } else throw new BadRequest('Already approved.');
    const done = !!ap.ad && (!needVc || !!ap.vc);
    return this.save(user, r, { status: done ? 'approved' : 'for_approval', d: { ...r.d, approvals: ap, needVc } }, done ? 'approved' : 'approval_step', reason);
  }
  /** Refused: back to its original place or the asset store, with a photo; it stays in the inventory. */
  private async dispPutBack(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.disp(i.id);
    if (r.status !== 'refused') throw new BadRequest('Only a refused disposal is put back.');
    const photo = this.proofs(user, i.photos);
    if (!photo.length) throw new BadRequest('Attach the photo of where it is now.');
    const item = await this.get(r.itemId!, 'invItem');
    const to = i.to === 'store' ? 'Asset store' : String(item.d.beforeDisposal ?? item.d.location);
    await this.save(user, item, { status: 'confirmed', d: { ...item.d, location: to, heldAt: null } }, 'put_back', r.ref);
    return this.save(user, r, { status: 'put_back', d: { ...r.d, putBack: { to, by: user.name, photo: photo[0].sha256 } } }, 'put_back', to);
  }
  /** S39: doing, witness and evidence by method; sale money is recorded by Finance only. */
  private async dispCarryOut(user: User, i: Record<string, unknown>) {
    if (!this.team(user) && !this.finance(user)) throw new AccessDenied('view', '(the maintenance unit)');
    const r = await this.disp(i.id);
    if (r.status !== 'approved' && r.status !== 'carried_out') throw new BadRequest('Not approved.');
    const method = String((r.d.approvals as { ad: { method: string } }).ad.method);
    if (i.saleMoney !== undefined) {
      if (!this.finance(user)) throw new AccessDenied('view', '(Finance records sale money)');
      return this.save(user, r, { d: { ...r.d, saleRecorded: { amount: money(i.saleMoney), receiptNo: this.reason(i.receiptNo, 'the receipt number'), by: user.name } } }, 'sale_money', s(i.receiptNo, 60));
    }
    this.needTeam(user);
    const witness = this.reason(i.witness, 'the witness');
    if (witness.toLowerCase() === user.name.toLowerCase()) throw new BadRequest('The witness is someone else.');
    const evidence = this.proofs(user, i.docs);
    if (!evidence.length) throw new BadRequest('Attach the evidence (photo, certificate or receipt).');
    if (method === 'licensed_contractor' && (s(i.contractor, 120).length < 2 || s(i.licence, 60).length < 2)) throw new BadRequest('Give the licensed contractor and licence; attach the certificate of disposal.');
    if (i.marksRemoved !== true) throw new BadRequest('Confirm the company marks were removed (or there were none).');
    return this.save(user, r, { status: 'carried_out', d: { ...r.d, carriedOut: { on: this.today(), by: user.name, witness, contractor: s(i.contractor, 120) || null, licence: s(i.licence, 60) || null } }, proof: [...(r.proof ?? []), ...evidence] }, 'carried_out', method);
  }
  /** S40: item disposed and off the list; the linked asset's disposal goes to Finance to post (Finance decides the write-off). */
  private async dispClose(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.disp(i.id);
    if (r.status !== 'carried_out') throw new BadRequest('Carry it out first.');
    const method = String((r.d.approvals as { ad: { method: string } }).ad.method);
    if (method === 'sale' && !r.d.saleRecorded) throw new BadRequest('Finance records the sale money first.');
    const item = await this.get(r.itemId!, 'invItem');
    await this.save(user, item, { status: 'disposed', d: { ...item.d, disposedRef: r.ref, labelRetired: true } }, 'disposed', r.ref);
    const amId = (r.d.inventoryCopy as { amAssetId?: string | null }).amAssetId;
    return this.save(user, r, { status: 'closed', d: { ...r.d, closed: { on: this.today(), by: user.name, financeWriteOff: amId ? 'for Finance to post in SQL Account' : null, sharePoint: 'pending' } } }, 'closed', this.reason(i.reason ?? 'records updated'));
  }

  // ===============================================================================================================
  // Section 4: recording a building purchase (S51-S62)
  // ===============================================================================================================

  private instructor(u: User): 'ceo' | 'chairman' | 'vice_chairman' | null {
    if (u.integration) return null;
    if (u.opsTier === 'ceo') return 'ceo';
    if (u.leadership === 'chairman') return 'chairman';
    if (u.leadership === 'vice_chairman') return 'vice_chairman';
    return null;
  }
  private bldReader(u: User, companyId: Id | null) {
    // S-X26: the Asset unit, the Asset Director, FD and Finance, the buying company's head, group leaders, the CoS and the CEO.
    return !u.integration && (this.team(u) || this.ad(u) || this.finance(u) || isGroupLeader(u) || this.head(u, companyId));
  }
  /** S51 (S-X22): the CEO, the Chairman or the Vice Chairman instructs; the Asset Director may key it in, waiting for that leader. */
  private async bldInstruct(user: User, i: Record<string, unknown>) {
    const giver = (['ceo', 'chairman', 'vice_chairman'] as const).find((k) => k === i.givenBy);
    if (!giver) throw new BadRequest('Name who gave the instruction: the CEO, the Chairman or the Vice Chairman.');
    const mine = this.instructor(user) === giver;
    if (!mine && !this.ad(user)) throw new AccessDenied('view', '(the leader who gave it, or the Asset Director keying it in)');
    const companyId = s(i.companyId, 60);
    if (!(await this.store.get('companies', companyId).catch(() => undefined))) throw new BadRequest('Choose the buying company.');
    const doc = this.proofs(user, i.docs);
    if (!doc.length) throw new BadRequest('Attach the instruction (email, memo or board resolution).');
    const d = {
      givenBy: giver,
      on: isDate(i.on) ? i.on : this.today(),
      address: this.reason(i.address, 'the building address'),
      price: money(i.price),
      seller: s(i.seller, 120),
      conditions: s(i.conditions, 500),
      boardResolution: i.boardResolution === true,
      stages: {} as Record<string, unknown>,
      bankLog: [] as unknown[],
      instructions: [] as unknown[],
    };
    if (!(d.price > 0)) throw new BadRequest('Give the asking price.');
    const step = { by: user.name, byId: user.id, at: this.now(), reason: mine ? s(i.reason, 300) || 'instructed' : '' };
    return this.create(user, 'buildingBuy', 'BLD', { d: { ...d, instructionApproved: mine ? step : null }, status: mine ? 'instructed' : 'waiting_instruction', companyId, proof: doc }, `${d.address} RM${d.price}`);
  }
  private async bld(user: User, id: unknown) {
    const r = await this.get(s(id, 120), 'buildingBuy');
    if (!this.bldReader(user, r.companyId)) throw new AccessDenied('view', '(building purchase file)');
    return r;
  }
  private async bldApproveInstruction(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (r.status !== 'waiting_instruction' && r.status !== 'waiting_new_instruction') throw new BadRequest('Nothing waiting.');
    const giver = r.status === 'waiting_new_instruction' ? ((r.d.instructions as { givenBy: string }[]).at(-1)?.givenBy ?? r.d.givenBy) : r.d.givenBy;
    if (this.instructor(user) !== giver) throw new BadRequest('The leader named on the instruction approves it in their own sign-in.');
    const step = { by: user.name, byId: user.id, at: this.now(), reason: this.reason(i.reason) };
    if (r.status === 'waiting_new_instruction') return this.save(user, r, { status: 'instructed', d: { ...r.d, decision: null, stages: Object.fromEntries(Object.entries(r.d.stages as object).filter(([k]) => k === 'documents')) } }, 'new_instruction_approved', step.reason);
    return this.save(user, r, { status: 'instructed', d: { ...r.d, instructionApproved: step } }, 'instruction_approved', step.reason);
  }
  /** S52: each stage needs its document; nothing goes before the instruction is approved. */
  private async bldStage(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (!this.team(user) && !this.head(user, r.companyId) && !this.finance(user)) throw new AccessDenied('view', '(the buying company, Finance or the Asset unit)');
    if (r.status === 'waiting_instruction' || r.status === 'waiting_new_instruction') throw new BadRequest('Nothing can be entered before the instruction is approved.');
    const stage = BUILDING_STAGES.find((x) => x.key === i.stage);
    if (!stage || stage.key === 'decision') throw new BadRequest('Choose the stage (the bank decision has its own step).');
    const k = BUILDING_STAGES.indexOf(stage);
    const prev = BUILDING_STAGES.slice(0, k).find((x) => !(r.d.stages as Record<string, unknown>)[x.key]);
    if (prev) throw new BadRequest(`Finish "${prev.key}" first.`);
    if (k > BUILDING_STAGES.findIndex((x) => x.key === 'decision') && (r.d.decision as { approved?: boolean } | undefined)?.approved !== true) throw new BadRequest('The bank has not approved the loan.');
    const doc = this.proofs(user, i.docs);
    if (!doc.length) throw new BadRequest(`Attach the ${stage.doc}.`);
    if (stage.key === 'registered' && !this.team(user)) throw new AccessDenied('view', '(the Asset unit registers)');
    return this.save(user, r, { d: { ...r.d, stages: { ...(r.d.stages as object), [stage.key]: { on: isDate(i.on) ? i.on : this.today(), by: user.name, doc: doc[0].sha256, note: s(i.note, 300) } } }, proof: [...(r.proof ?? []), ...doc] }, stage.key, s(i.note, 200) || stage.doc);
  }
  private async bldReturn(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.bld(user, i.id);
    const stage = s(i.stage, 20);
    const stages = { ...(r.d.stages as Record<string, unknown>) };
    if (!stages[stage]) throw new BadRequest('That stage is not done.');
    delete stages[stage];
    return this.save(user, r, { d: { ...r.d, stages } }, 'returned', `${stage}: ${this.reason(i.reason, 'what is wrong or missing')}`);
  }
  /** S53: every contact with the bank (officer by name and role only). */
  private async bldBankLog(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (!this.team(user) && !this.head(user, r.companyId) && !this.finance(user)) throw new AccessDenied('view', '(building purchase file)');
    const e = { on: isDate(i.on) ? i.on : this.today(), how: (['call', 'email', 'meeting', 'letter'] as const).find((k) => k === i.how) ?? 'call', officer: this.reason(i.officer, "the bank officer's name and role"), what: this.reason(i.what, 'what was said or sent'), next: s(i.next, 200), by: user.name };
    return this.save(user, r, { d: { ...r.d, bankLog: [...((r.d.bankLog as unknown[]) ?? []), e] }, proof: [...(r.proof ?? []), ...this.proofs(user, i.docs)] }, 'bank_log', `${e.how}: ${e.what}`);
  }
  /** S54: approved with the loan terms, or not approved: the file waits for a NEW instruction. */
  private async bldDecision(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (!this.team(user) && !this.head(user, r.companyId) && !this.finance(user)) throw new AccessDenied('view', '(building purchase file)');
    const st = r.d.stages as Record<string, unknown>;
    if (!st.valuation) throw new BadRequest('Record the bank valuation first.');
    const letter = this.proofs(user, i.docs);
    if (!letter.length) throw new BadRequest('Attach the bank letter.');
    if (i.approved === false) {
      const why = this.reason(i.reason, "the bank's reason");
      return this.save(user, r, { status: 'waiting_new_instruction', d: { ...r.d, decision: { approved: false, reason: why, on: this.today() } }, proof: [...(r.proof ?? []), ...letter] }, 'not_approved', why);
    }
    const loan = { approved: true, amount: money(i.loanAmount), downPayment: money(i.downPayment), monthly: money(i.monthly), tenureMonths: Math.max(1, int(i.tenureMonths) || 0), rate: money(i.rate), loanType: (['term', 'bundle', 'promotion'] as const).find((k) => k === i.loanType) ?? 'term', terms: s(i.terms, 500), bank: this.reason(i.bank, 'the bank'), on: this.today() };
    if (!(loan.amount > 0) || !(loan.monthly > 0)) throw new BadRequest('Give the loan amount and the monthly payment.');
    const costs = money(i.costs ?? 0);
    const gap = Math.max(0, money(Number(r.d.price) + costs - loan.amount));
    return this.save(user, r, { status: 'approved', d: { ...r.d, decision: loan, stages: { ...st, decision: { on: this.today(), by: user.name, doc: letter[0].sha256 } }, gap: { amount: gap, costs, covered: null } }, proof: [...(r.proof ?? []), ...letter] }, 'approved', `${loan.bank} RM${loan.amount}, gap RM${gap}`);
  }
  /** A new instruction after a refusal (review, more papers, another bank) is recorded like the first. */
  private async bldNewInstruction(user: User, r: OfficeAmRec, i: Record<string, unknown>) {
    const giver = (['ceo', 'chairman', 'vice_chairman'] as const).find((k) => k === i.givenBy);
    if (!giver) throw new BadRequest('Name who gave the new instruction.');
    const mine = this.instructor(user) === giver;
    if (!mine && !this.ad(user)) throw new AccessDenied('view', '(the leader or the Asset Director)');
    const doc = this.proofs(user, i.docs);
    if (!doc.length) throw new BadRequest('Attach the new instruction.');
    const e = { givenBy: giver, on: this.today(), what: this.reason(i.what, 'what is to be done'), by: user.name };
    const saved = await this.save(user, r, { d: { ...r.d, instructions: [...((r.d.instructions as unknown[]) ?? []), e] }, proof: [...(r.proof ?? []), ...doc] }, 'new_instruction', e.what);
    if (mine) return this.save(user, saved, { status: 'instructed', d: { ...saved.d, decision: null, stages: Object.fromEntries(Object.entries(saved.d.stages as object).filter(([k]) => k === 'documents')) } }, 'new_instruction_approved', s(i.reason, 200) || e.what);
    return saved;
  }
  /** S55: Finance records how the gap is covered; Prima shows "gap covered" only then. */
  private async bldGap(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (i.newInstruction === true) return this.bldNewInstruction(user, r, i);
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance covers the gap)');
    const gap = r.d.gap as { amount: number } | undefined;
    if (!gap) throw new BadRequest('No bank approval yet.');
    return this.save(user, r, { d: { ...r.d, gap: { ...gap, covered: { by: user.name, at: this.now(), source: this.reason(i.source, 'the source of the money'), paymentRef: s(i.paymentRef, 60) } } } }, 'gap_covered', s(i.source, 200));
  }
  /** S56: the down payment (Finance's bank reference) and the schedule. */
  private async bldDownPayment(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance records the down payment)');
    const r = await this.bld(user, i.id);
    if (!(r.d.gap as { covered?: unknown } | undefined)?.covered) throw new BadRequest('The gap is not covered yet.');
    if (!isDate(i.firstOn) || !isDate(i.lastOn) || i.lastOn <= i.firstOn) throw new BadRequest('Give the first and last payment dates.');
    const dp = { bankRef: this.reason(i.bankRef, 'the bank reference'), on: isDate(i.on) ? i.on : this.today(), firstOn: i.firstOn, lastOn: i.lastOn, by: user.name };
    return this.save(user, r, { d: { ...r.d, downPayment: dp, loanSetup: { status: 'for_finance', companyId: r.companyId, bank: (r.d.decision as { bank: string }).bank, monthly: (r.d.decision as { monthly: number }).monthly, start: dp.firstOn, end: dp.lastOn, regularId: null } } }, 'down_payment', dp.bankRef);
  }
  /** On completion the LOAN goes to Finance regular payments for the buying company; Finance adds it and links it. Prima never pays it. */
  private async bldLoanLink(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance)');
    const r = await this.bld(user, i.id);
    const ls = r.d.loanSetup as { companyId: Id; regularId: Id | null } | undefined;
    if (!ls) throw new BadRequest('Record the down payment first.');
    if (ls.regularId) throw new BadRequest('The loan is already linked.');
    const reg = await this.finRegular(s(i.regularId, 120));
    if (!reg || reg.kind !== 'loan') throw new BadRequest('Choose the loan in Finance regular payments.');
    if (reg.companyId !== ls.companyId) throw new BadRequest('The loan must be on the buying company.');
    if ((await this.all()).some((x) => x.kind === 'buildingBuy' && x.id !== r.id && (x.d.loanSetup as { regularId?: Id } | undefined)?.regularId === reg.id)) throw new BadRequest('That loan is linked to another building.');
    return this.save(user, r, { d: { ...r.d, loanSetup: { ...ls, regularId: reg.id, status: 'linked' } } }, 'loan_linked', reg.id);
  }
  /** S57: the new building purchase form (most fields already in the file); SPA upload required. */
  private async bldForm(user: User, i: Record<string, unknown>) {
    const r = await this.bld(user, i.id);
    if (!this.head(user, r.companyId) && !this.team(user)) throw new AccessDenied('view', '(the buying company fills the form)');
    if (!(r.d.stages as Record<string, unknown>).agreements) throw new BadRequest('Record the agreements first.');
    const spa = this.proofs(user, i.spa);
    if (!spa.length) throw new BadRequest('Upload the SPA. Without it the form is cancelled.');
    const use = i.use === 'RENTAL' ? 'RENTAL' : i.use === 'OWN_USE' ? 'OWN_USE' : null;
    if (!use) throw new BadRequest('Own use or rental?');
    const form = {
      buildingType: (['COMMERCIAL', 'RESIDENTIAL', 'INDUSTRIAL', 'LAND'] as const).find((k) => k === i.buildingType) ?? 'COMMERCIAL',
      statusAtPurchase: (['new', 'subsale', 'under_construction'] as const).find((k) => k === i.statusAtPurchase) ?? 'new',
      keyOn: isDate(i.keyOn) ? i.keyOn : null,
      use,
      ownUse: use === 'OWN_USE' ? { companyId: s(i.useCompanyId, 60) || r.companyId, department: this.reason(i.department, 'the department using it') } : null,
      rental: use === 'RENTAL' ? { tenant: s(i.tenant, 120), rent: i.rent === undefined ? null : money(i.rent), start: isDate(i.rentStart) ? i.rentStart : null, end: isDate(i.rentEnd) ? i.rentEnd : null, paidTo: s(i.paidTo, 60) || r.companyId } : null,
      vault: i.vault === true,
      vaultRef: s(i.vaultRef, 120) || null,
      spaRef: this.reason(i.spaRef, 'the SPA reference'),
      titleNo: s(i.titleNo, 60),
      code: this.reason(i.code, 'the building code'),
      name: this.reason(i.name, 'the building name'),
      town: s(i.town, 60),
      state: s(i.state, 60),
      sizeSqft: Math.max(0, int(i.sizeSqft) || 0),
    };
    if (form.rental && form.rental.paidTo !== r.companyId) {
      // S-X23: another company collects only under an active management agreement.
      const ok = (await this.all()).some((x) => x.kind === 'mgmtAgreement' && x.status === 'active' && x.d.ownerCompanyId === r.companyId && x.d.managingCompanyId === form.rental!.paidTo);
      if (!ok) throw new BadRequest('Rent collected by another company needs an active management agreement with the owner company.');
    }
    return this.save(user, r, { status: 'form_submitted', d: { ...r.d, form }, proof: [...(r.proof ?? []), ...spa] }, 'form', `${form.use} ${form.name}`);
  }
  /** S58-S59: the Asset unit checks the documents and registers the building (rental unit, or own-use building). */
  private async bldRegister(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.bld(user, i.id);
    if (r.status !== 'form_submitted') throw new BadRequest('The company submits the form first.');
    const f = r.d.form as Record<string, unknown> & { use: 'RENTAL' | 'OWN_USE'; ownUse: { companyId: Id; department: string } | null; code: string; name: string; town: string; state: string; sizeSqft: number; buildingType: AmUnit['type']; keyOn: IsoDate | null; spaRef: string; titleNo: string; vaultRef: string | null };
    const dec = r.d.decision as { bank: string };
    const unit: AmUnit = {
      id: `amu-bld-${toMs(this.now())}`,
      code: f.code,
      type: f.buildingType,
      name: f.name,
      town: f.town,
      state: f.state,
      ownerEntity: r.companyId!,
      sizeSqft: f.sizeSqft,
      askingRent: 0,
      status: 'vacant',
      vacantSince: this.today(),
      insuranceExpiry: isDate(i.insuranceExpiry) ? i.insuranceExpiry : this.today(),
      assessmentDue: isDate(i.assessmentDue) ? i.assessmentDue : this.today(),
      quitRentDue: isDate(i.quitRentDue) ? i.quitRentDue : this.today(),
      meters: [],
      tenancy: null,
      use: f.use,
      ownUse: f.ownUse,
      purchase: { buyingCompanyId: r.companyId!, fileId: r.id, price: Number(r.d.price), on: this.today(), spaRef: f.spaRef, titleNo: f.titleNo, bank: dec.bank, loanRegularId: (r.d.loanSetup as { regularId: Id | null } | undefined)?.regularId ?? null, keyOn: f.keyOn, vaultRef: f.vaultRef },
      strata: null,
    };
    if ((await this.store.list('amUnits', {})).some((u) => u.code === unit.code)) throw new BadRequest('That building code is already used.');
    await this.store.transaction(async (tx) => {
      await tx.insert('amUnits', unit);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.building.registered', entity: 'am_unit', entityId: unit.id, summary: `${unit.code} ${unit.name} (${unit.use}) from ${r.ref}` });
    });
    return this.save(user, r, { status: 'registered', d: { ...r.d, unitId: unit.id, handoverReceived: { on: isDate(i.handoverOn) ? i.handoverOn : this.today(), by: user.name } } }, 'registered', unit.code);
  }
  /** S61 (S-X24): on the 15th Prima asks the buying company's HQ to confirm the building record. */
  private async bldConfirmAsk(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const month = period(i.period) || this.today().slice(0, 7);
    const units = (await this.store.list('amUnits', {})).filter((u) => u.purchase);
    const have = new Set((await this.all()).filter((r) => r.kind === 'bldConfirm' && r.d.period === month).map((r) => r.unitId));
    const made: string[] = [];
    for (const u of units) {
      if (have.has(u.id)) continue;
      const snap = { code: u.code, name: u.name, price: u.purchase!.price, bank: u.purchase!.bank, use: u.use ?? 'RENTAL', ownUse: u.ownUse ?? null, tenant: u.tenancy?.tenant ?? null, rent: u.tenancy?.rent ?? null, meters: u.meters };
      const r = await this.create(user, 'bldConfirm', 'SAH', { d: { period: month, snapshot: snap, askedOn: this.today() }, status: 'asked', companyId: u.purchase!.buyingCompanyId, unitId: u.id }, `${u.code} ${month}`);
      made.push(r.ref);
    }
    return { asked: made.length, refs: made };
  }
  private async bldConfirmAnswer(user: User, i: Record<string, unknown>) {
    const r = await this.get(s(i.id, 120), 'bldConfirm');
    if (!this.head(user, r.companyId)) throw new AccessDenied('view', "(the buying company's HQ confirms)");
    if (r.status !== 'asked' && r.status !== 'called') throw new BadRequest('Already answered.');
    const corrections = s(i.corrections, 1000);
    return this.save(user, r, { status: corrections ? 'corrected' : 'confirmed', d: { ...r.d, answer: { by: user.name, at: this.now(), corrections } } }, corrections ? 'corrected' : 'confirmed', corrections || 'confirmed');
  }
  private async bldConfirmCall(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.get(s(i.id, 120), 'bldConfirm');
    if (r.status !== 'asked') throw new BadRequest('Only an unanswered confirmation is called.');
    const days = (await this.values()).building.confirmCallDays;
    if (addWorkingDays(String(r.d.askedOn), days) > this.today()) throw new BadRequest(`The company has ${days} working days to confirm in Prima first.`);
    return this.save(user, r, { status: 'called', d: { ...r.d, call: { on: this.today(), by: user.name, note: this.reason(i.note, 'what was said on the call') } } }, 'called', s(i.note, 200));
  }
  private async bldConfirmAccept(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.get(s(i.id, 120), 'bldConfirm');
    if (r.status !== 'corrected') throw new BadRequest('No corrections to accept.');
    return this.save(user, r, { status: 'confirmed', d: { ...r.d, accepted: { by: user.name, at: this.now(), note: this.reason(i.note, 'what was changed on the record') } } }, 'accepted', s(i.note, 200));
  }
  /** S46, S59-S60, S63: the unit keeps the building's strata, use, office flag and meter details. */
  private async unitDetails(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const u = await this.store.get('amUnits', s(i.unitId, 120)).catch(() => undefined);
    if (!u) throw new NotFound('Unit');
    const patch: Partial<AmUnit> = {};
    if (i.strata && typeof i.strata === 'object') {
      const x = i.strata as Record<string, unknown>;
      patch.strata = { strata: x.strata === true, jmbName: s(x.jmbName, 120), jmbContact: s(x.jmbContact, 120), serviceCharge: x.serviceCharge === undefined ? null : money(x.serviceCharge), sinkingFund: x.sinkingFund === undefined ? null : money(x.sinkingFund) };
    }
    if (i.use === 'RENTAL' || i.use === 'OWN_USE') {
      patch.use = i.use;
      patch.ownUse = i.use === 'OWN_USE' ? { companyId: s(i.useCompanyId, 60), department: s(i.department, 60) } : null;
    }
    if (typeof i.office === 'boolean') patch.office = i.office;
    if (Array.isArray(i.meters)) {
      const ms = i.meters as Record<string, unknown>[];
      patch.meters = u.meters.map((m, k) => {
        const x = ms[k];
        if (!x) return m;
        return { ...m, accountHolder: s(x.accountHolder, 120) || m.accountHolder || null, depositName: s(x.depositName, 120) || m.depositName || null, deposit: x.deposit === undefined ? (m.deposit ?? null) : money(x.deposit), latestBill: isDate(x.billOn) ? { amount: money(x.billAmount), on: x.billOn } : (m.latestBill ?? null) };
      });
    }
    const reason = this.reason(i.reason);
    await this.store.transaction(async (tx) => {
      await tx.update('amUnits', u.id, patch);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.unit.details', entity: 'am_unit', entityId: u.id, summary: `${u.code}: ${Object.keys(patch).join(', ')}: ${reason}` });
    });
    return { ok: true, changed: Object.keys(patch) };
  }
  /** S-X23: a management agreement lets a managing company work the rent side of the owner's buildings. */
  private async mgmtAgreement(user: User, i: Record<string, unknown>) {
    if (!this.ad(user)) throw new AccessDenied('view', '(the Asset Director records the agreement)');
    if (i.id) {
      const r = await this.get(s(i.id, 120), 'mgmtAgreement');
      return this.save(user, r, { status: 'ended' }, 'ended', this.reason(i.reason));
    }
    const ownerCompanyId = s(i.ownerCompanyId, 60);
    const managingCompanyId = s(i.managingCompanyId, 60);
    if (!ownerCompanyId || !managingCompanyId || ownerCompanyId === managingCompanyId) throw new BadRequest('Name the owner company and a different managing company.');
    const unitIds = (Array.isArray(i.unitIds) ? (i.unitIds as unknown[]) : []).map((x) => s(x, 120)).filter(Boolean);
    if (!unitIds.length) throw new BadRequest('List the buildings covered.');
    if (!isDate(i.startOn) || !isDate(i.endOn) || i.endOn <= i.startOn) throw new BadRequest('Give the start and end dates.');
    const signed = this.proofs(user, i.docs);
    if (!signed.length) throw new BadRequest('Attach the signed agreement.');
    return this.create(user, 'mgmtAgreement', 'PJU', { d: { ownerCompanyId, managingCompanyId, unitIds, startOn: i.startOn, endOn: i.endOn, feeBasis: this.reason(i.feeBasis, 'the fee basis (entered, never preset)') }, status: 'active', companyId: ownerCompanyId, proof: signed }, `${managingCompanyId} manages ${unitIds.length} building(s) for ${ownerCompanyId}`);
  }
  /** The managing company's staff work the rent screens for the covered buildings only. */
  private async managingFor(user: User, unitId: Id | null) {
    if (!unitId) return false;
    const today = this.today();
    return (await this.all()).some((r) => r.kind === 'mgmtAgreement' && r.status === 'active' && String(r.d.startOn) <= today && String(r.d.endOn) >= today && (r.d.unitIds as Id[]).includes(unitId) && user.companyIds.includes(String(r.d.managingCompanyId)));
  }

  // ===============================================================================================================
  // Section 6: office rent collection (S63-S74)
  // ===============================================================================================================

  private async pic(user: User, unitId: Id | null) {
    // S-X34: the Asset Management rental admin executive role, or the managing company's equivalent under an agreement.
    return this.team(user) || ((user.role === 'company_manager' || user.role === 'admin_exec') && (await this.managingFor(user, unitId)));
  }
  private async tenancyOf(unitId: Id) {
    return (await this.all()).find((r) => r.kind === 'officeTenancy' && r.unitId === unitId && r.status !== 'ended') ?? null;
  }
  /** S63: an office let to a company, with the tenant's details; a group tenant is intercompany. */
  private async tenancyOpen(user: User, i: Record<string, unknown>) {
    const unitId = s(i.unitId, 120);
    const u = await this.store.get('amUnits', unitId).catch(() => undefined);
    if (!u) throw new NotFound('Unit');
    if (!(await this.pic(user, unitId))) throw new AccessDenied('view', '(the rental PIC)');
    if (await this.tenancyOf(unitId)) throw new BadRequest('This office already has an open tenancy record.');
    const tenantCompanyId = s(i.tenantCompanyId, 60) || null;
    const d = { tenant: this.reason(i.tenant, 'the tenant company'), ssm: this.reason(i.ssm, 'the SSM number'), address: s(i.address, 300), contactRole: s(i.contactRole, 60), invoiceEmail: this.reason(i.invoiceEmail, 'the email for invoices'), tenantCompanyId, intercompany: !!tenantCompanyId, checks: {} as Record<string, unknown>, terms: null, bounces: [] as IsoDate[], transferOnly: false };
    const owner = u.purchase?.buyingCompanyId ?? (await this.store.get('companies', u.ownerEntity).catch(() => undefined))?.id ?? null;
    return this.create(user, 'officeTenancy', 'SWP', { d, status: 'checking', companyId: owner, unitId }, `${u.code}: ${d.tenant}`);
  }
  private async tenancy(user: User, id: unknown) {
    const r = await this.get(s(id, 120), 'officeTenancy');
    if (!(await this.pic(user, r.unitId ?? null)) && !this.finance(user) && !this.ad(user)) throw new AccessDenied('view', '(office rent)');
    return r;
  }
  /** S64 (S-X35): each line done (with a file and expiry) or not needed (with a reason). */
  private async tenancyCheck(user: User, i: Record<string, unknown>) {
    const r = await this.tenancy(user, i.id);
    if (!(await this.pic(user, r.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    const line = TENANT_CHECKS.find((k) => k === i.line);
    if (!line) throw new BadRequest('Choose the check.');
    let entry: Record<string, unknown>;
    if (i.state === 'not_needed') entry = { state: 'not_needed', reason: this.reason(i.reason, 'why it is not needed') };
    else {
      const doc = this.proofs(user, i.docs);
      if (!doc.length) throw new BadRequest('Attach the file.');
      entry = { state: 'done', ref: s(i.ref, 60), expiresOn: isDate(i.expiresOn) ? i.expiresOn : null, doc: doc[0].sha256 };
    }
    return this.save(user, r, { d: { ...r.d, checks: { ...(r.d.checks as object), [line]: entry } } }, 'check', `${line} ${String(entry.state)}`);
  }
  private async tenancyTerms(user: User, i: Record<string, unknown>) {
    const r = await this.tenancy(user, i.id);
    if (!(await this.pic(user, r.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    const missing = TENANT_CHECKS.filter((k) => !(r.d.checks as Record<string, unknown>)[k]);
    if (missing.length) throw new BadRequest(`Finish the tenant check first: ${missing.join(', ')}.`);
    if (!isDate(i.startOn) || !isDate(i.endOn)) throw new BadRequest('Give the start and end dates.');
    const terms = { rent: money(i.rent), deposit: money(i.deposit ?? 0), startOn: i.startOn, endOn: i.endOn, dueDay: Math.min(28, Math.max(1, int(i.dueDay) || 10)), collector: r.companyId, account: this.reason(i.account, "the owner company's bank account (last 4 digits and bank)") };
    if (!(terms.rent > 0)) throw new BadRequest('Give the monthly rent.');
    return this.save(user, r, { status: 'active', d: { ...r.d, terms } }, 'terms', `RM${terms.rent}/month to ${terms.collector}`);
  }
  private async month(user: User, tenancyId: Id, p: string) {
    const t = await this.tenancy(user, tenancyId);
    if (t.status !== 'active') throw new BadRequest('Confirm the terms first.');
    let m = (await this.all()).find((r) => r.kind === 'rentMonth' && r.parentId === t.id && r.d.period === p);
    if (!m) m = await this.create(user, 'rentMonth', 'RSP', { d: { period: p, rent: (t.d.terms as { rent: number }).rent }, status: 'not_invoiced', companyId: t.companyId, unitId: t.unitId, parentId: t.id }, `${p}`);
    return { t, m };
  }
  /** S66: Finance makes the invoice in SQL Account and records its number here; Prima never numbers it. */
  private async rentInvoice(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance makes the invoice in SQL Account)');
    const p = period(i.period);
    if (!p) throw new BadRequest('Give the month (YYYY-MM).');
    const { m } = await this.month(user, s(i.tenancyId, 120), p);
    if (m.status !== 'not_invoiced' && m.status !== 'invoice_returned') throw new BadRequest('Already invoiced.');
    const inv = { no: this.reason(i.invoiceNo, 'the SQL Account invoice number'), amount: money(i.amount), on: this.today(), by: user.name };
    return this.save(user, m, { status: 'invoiced', d: { ...m.d, invoice: inv } }, 'invoiced', `${inv.no} RM${inv.amount}`);
  }
  private async rm(user: User, id: unknown) {
    const m = await this.get(s(id, 120), 'rentMonth');
    if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user) && !this.ad(user)) throw new AccessDenied('view', '(office rent)');
    return m;
  }
  /** S67: the PIC checks each invoice against the tenancy; a wrong one goes back to Finance. */
  private async rentInvoiceCheck(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    if (!(await this.pic(user, m.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    if (m.status !== 'invoiced') throw new BadRequest('Nothing to check.');
    const inv = m.d.invoice as { amount: number };
    if (i.ok === false || Math.abs(inv.amount - Number(m.d.rent)) > 0.009) {
      if (i.ok !== false) throw new BadRequest(`The invoice is RM${inv.amount}, the tenancy says RM${m.d.rent}. Send it back to Finance with the reason.`);
      return this.save(user, m, { status: 'invoice_returned', d: { ...m.d, invoiceReturned: this.reason(i.reason) } }, 'invoice_returned', s(i.reason, 200));
    }
    return this.save(user, m, { status: 'checked', d: { ...m.d, invoiceChecked: { by: user.name, on: this.today() } } }, 'invoice_checked', 'matches the tenancy');
  }
  private async rentSent(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    if (!(await this.pic(user, m.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    if (m.status !== 'checked') throw new BadRequest('Check the invoice first.');
    const file = this.proofs(user, i.docs);
    if (!file.length) throw new BadRequest('Attach the invoice file sent.');
    return this.save(user, m, { status: 'sent', d: { ...m.d, sent: { on: isDate(i.on) ? i.on : this.today(), to: this.reason(i.to, 'the address it was sent to'), doc: file[0].sha256 } }, proof: [...(m.proof ?? []), ...file] }, 'sent', s(i.to, 120));
  }
  /** S68 (S-X31): payment recorded on arrival, by type; nothing counts as paid yet. */
  private async rentReceived(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    const t = await this.get(m.parentId!, 'officeTenancy');
    if (!['sent', 'checked', 'returned', 'bounced', 'late'].includes(m.status)) throw new BadRequest('The invoice is not sent yet.');
    const method = (['CHEQUE', 'TRANSFER', 'CASH', 'EWALLET'] as const).find((k) => k === i.method);
    if (!method) throw new BadRequest('Cheque, transfer (DuitNow), cash or e-wallet?');
    if (t.d.transferOnly && method !== 'TRANSFER') throw new BadRequest('After 2 bounced cheques in 12 months this tenant pays by transfer only.');
    const amount = money(i.amount);
    if (!(amount > 0)) throw new BadRequest('Give the amount.');
    const v = (await this.values()).rent;
    const pay: Record<string, unknown> = { method, amount, on: isDate(i.on) ? i.on : this.today(), by: user.name, byId: user.id };
    if (method === 'CHEQUE') {
      const photo = this.proofs(user, i.photos);
      if (!photo.length) throw new BadRequest('Attach the photo or scan of the cheque.');
      Object.assign(pay, { chequeNo: this.reason(i.chequeNo, 'the cheque number'), bank: this.reason(i.bank, 'the bank'), chequeDate: isDate(i.chequeDate) ? i.chequeDate : null, payee: this.reason(i.payee, 'the payee name on the cheque'), photo: photo[0].sha256, receivedById: user.id });
      if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user)) throw new AccessDenied('view', '(the receiving company)');
    } else if (method === 'TRANSFER') {
      if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user)) throw new AccessDenied('view', '(office rent)');
      Object.assign(pay, { ref: this.reason(i.ref, 'the bank reference') });
    } else if (method === 'CASH') {
      // Only the rental PIC or a named Finance staff member receives cash; the official receipt number is given at once.
      if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user)) throw new AccessDenied('view', '(the rental PIC or Finance receives cash)');
      Object.assign(pay, { receiptNo: this.reason(i.receiptNo, 'the official receipt number (no receipt = not recorded)'), largeCash: amount >= v.largeCash ? `RM${amount} in cash: ask for a transfer next time.` : null });
    } else {
      if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user)) throw new AccessDenied('view', '(office rent)');
      const shot = this.proofs(user, i.photos);
      if (!shot.length) throw new BadRequest('Attach the screenshot.');
      if (i.ownerAccount !== true) throw new BadRequest("E-wallet only into the owner company's own merchant account set up by Finance, never a personal wallet.");
      Object.assign(pay, { txnId: this.reason(i.txnId, 'the transaction ID'), photo: shot[0].sha256 });
    }
    const status = method === 'CHEQUE' ? 'received' : method === 'CASH' ? 'received_cash' : 'deposited';
    return this.save(user, m, { status, d: { ...m.d, payment: pay, payments: [...((m.d.payments as unknown[]) ?? []), pay] } }, 'received', `${method} RM${amount}`);
  }
  /** S69: Finance hands the cheque to the PIC; the PIC confirms receipt in their own sign-in. */
  private async rentHandover(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    if (m.status !== 'received') throw new BadRequest('No cheque to hand over.');
    if (i.step === 'give') {
      if (!this.finance(user)) throw new AccessDenied('view', '(Finance hands over the cheque)');
      return this.save(user, m, { d: { ...m.d, handover: { givenBy: user.name, givenById: user.id, at: this.now() } } }, 'handover_given', 'cheque given to the PIC');
    }
    if (!(await this.pic(user, m.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    const h = m.d.handover as { givenById: Id } | undefined;
    if (!h) throw new BadRequest('Finance records the hand-over first.');
    if (h.givenById === user.id) throw new BadRequest('Two sign-ins: the giver and the receiver are different people.');
    return this.save(user, m, { status: 'with_pic', d: { ...m.d, handover: { ...h, takenBy: user.name, takenById: user.id, takenAt: this.now() } } }, 'handover_taken', 'cheque received by the PIC');
  }
  /** S69-S70 (S-X32): every point checked; a failing cheque is returned, never banked. */
  private async rentChequeCheck(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    if (!(await this.pic(user, m.unitId ?? null))) throw new AccessDenied('view', '(the rental PIC)');
    if (m.status !== 'with_pic') throw new BadRequest('The PIC takes the cheque first.');
    const pts = ['payer', 'payee', 'spelling', 'amount', 'date', 'number', 'matches'];
    const checks = Object.fromEntries(pts.map((k) => [k, (i.checks as Record<string, unknown> | undefined)?.[k] === true]));
    const p = m.d.payment as { chequeDate: IsoDate | null };
    if (p.chequeDate && (p.chequeDate > this.today() || daysBetween(p.chequeDate, this.today()) > 180)) checks.date = false;
    const ok = Object.values(checks).every(Boolean);
    if (ok) return this.save(user, m, { status: 'cheque_ok', d: { ...m.d, chequeCheck: { checks, by: user.name, at: this.now() } } }, 'cheque_ok', 'all points match');
    const v = (await this.values()).rent;
    return this.save(user, m, { status: 'returned', d: { ...m.d, chequeCheck: { checks, by: user.name, at: this.now() }, returned: { reason: this.reason(i.reason, 'what is wrong with the cheque'), returnBy: addWorkingDays(this.today(), v.wrongChequeReturnDays), replacementBy: addWorkingDays(this.today(), v.replacementDays), tenantTold: this.reason(i.toldHow, 'how the tenant was told (email)') } } }, 'returned', s(i.reason, 200));
  }
  /** S71: banked into the OWNER company's set account; status "deposited, waiting for clearance". */
  private async rentDeposit(user: User, i: Record<string, unknown>) {
    const m = await this.rm(user, i.id);
    if (m.status !== 'cheque_ok' && m.status !== 'received_cash') throw new BadRequest(m.status === 'returned' ? 'A cheque that failed the check is never banked.' : 'Nothing to bank.');
    const p = m.d.payment as { method: string; byId: Id };
    if (!(await this.pic(user, m.unitId ?? null)) && !this.finance(user)) throw new AccessDenied('view', '(office rent)');
    const slip = this.proofs(user, i.photos);
    if (!slip.length) throw new BadRequest('Attach the bank-in slip photo.');
    const into = s(i.accountCompanyId, 60);
    if (into && into !== m.companyId) throw new BadRequest("Rent is banked into the OWNER company's account only.");
    if (p.method === 'CASH') {
      const late = addWorkingDays(String((m.d.payment as { on: IsoDate }).on), (await this.values()).rent.cashBankDays) < this.today();
      if (late) await this.save(user, m, {}, 'cash_late', 'cash banked after 2 working days');
    }
    return this.save(user, m, { status: 'deposited', d: { ...m.d, deposited: { on: isDate(i.on) ? i.on : this.today(), slipNo: this.reason(i.slipNo, 'the slip number'), by: user.name, byId: user.id, photo: slip[0].sha256, slipSentToTenant: i.sent === true } } }, 'deposited', s(i.slipNo, 60));
  }
  /** S72: paid only when Finance matches the statement and records the SQL Account receipt; never the person who banked or received it. */
  private async rentMatch(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance matches the bank statement)');
    const m = await this.rm(user, i.id);
    if (m.status !== 'deposited') throw new BadRequest('Not deposited yet.');
    const dep = m.d.deposited as { byId: Id } | undefined;
    const pay = m.d.payment as { byId: Id };
    if (dep?.byId === user.id || pay.byId === user.id) throw new BadRequest('The person who received or banked it cannot mark it paid.');
    return this.save(user, m, { status: 'paid', d: { ...m.d, matched: { by: user.name, at: this.now(), statementRef: this.reason(i.statementRef, 'the bank statement line'), receiptNo: this.reason(i.receiptNo, 'the SQL Account official receipt number') } } }, 'paid', s(i.receiptNo, 60));
  }
  /** S-X32: a bounced cheque reverses the deposit; the month is unpaid again; 2 bounces in 12 months = transfer only. */
  private async rentBounce(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance records a bounced cheque)');
    const m = await this.rm(user, i.id);
    if (!['deposited', 'paid'].includes(m.status) || (m.d.payment as { method: string }).method !== 'CHEQUE') throw new BadRequest('Only a banked cheque bounces.');
    const t = await this.get(m.parentId!, 'officeTenancy');
    const v = (await this.values()).rent;
    const since = addDays(this.today(), -v.bounceWindowMonths * 30);
    const bounces = [...((t.d.bounces as IsoDate[]) ?? []).filter((d) => d >= since), this.today()];
    await this.save(user, t, { d: { ...t.d, bounces, transferOnly: bounces.length >= v.bounceLimit || t.d.transferOnly === true } }, 'bounce', `${bounces.length} in ${v.bounceWindowMonths} months`);
    return this.save(user, m, { status: 'bounced', d: { ...m.d, bounced: { on: this.today(), by: user.name, reason: this.reason(i.reason), charges: i.charges === undefined ? null : money(i.charges), tenantTold: this.today() }, matched: null } }, 'bounced', s(i.reason, 200));
  }
  /** S73 (S-X30): late from the 11th; the Asset Director and the tenant's head are told at 30 days. */
  rentState(m: OfficeAmRec, today: IsoDate, v = RULES.officeAm.value.rent) {
    const p = String(m.d.period);
    const lateFrom = `${p}-${String(v.lateFrom).padStart(2, '0')}`;
    const unpaid = !['paid', 'deposited'].includes(m.status);
    const late = unpaid && today >= lateFrom;
    return { late, daysLate: late ? daysBetween(lateFrom, today) + 1 : 0, tellAd: late && daysBetween(lateFrom, today) + 1 >= v.arrearsTellDays };
  }

  // ===============================================================================================================
  // Section 7: periodic office visits (S75-S84)
  // ===============================================================================================================

  private async visitPlan(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const place = s(i.place, 120);
    const kind = (['office', 'own_use', 'empty_unit'] as const).find((k) => k === i.placeKind);
    if (!kind || place.length < 2) throw new BadRequest('Choose the place (company office, own-use building, or empty rental unit).');
    const v = (await this.values()).visit;
    const months = Math.max(1, int(i.everyMonths) || v.everyMonths);
    if (months !== v.everyMonths) this.reason(i.reason, 'why this place is visited more or less often');
    return this.create(user, 'visitPlan', 'JPB', { d: { place, placeKind: kind, everyMonths: months, nextDue: isDate(i.nextDue) ? i.nextDue : addDays(this.today(), 7), inspectorRole: s(i.inspectorRole, 60) || 'maintenance unit', approved: null }, status: 'draft', companyId: s(i.companyId, 60) || null, unitId: s(i.unitId, 120) || null }, `${place} every ${months} months`);
  }
  private async visitPlanApprove(user: User, i: Record<string, unknown>) {
    if (!this.ad(user)) throw new AccessDenied('view', '(the Asset Director approves the schedule)');
    const r = await this.get(s(i.id, 120), 'visitPlan');
    return this.save(user, r, { status: 'active', d: { ...r.d, approved: { by: user.name, at: this.now(), reason: this.reason(i.reason) } } }, 'approved', s(i.reason, 200));
  }
  /** S76: open the visit on the day: inspector signed in, time and place stamps from the photo rules. */
  private async visitOpen(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const plan = await this.get(s(i.planId, 120), 'visitPlan');
    if (plan.status !== 'active') throw new BadRequest('The schedule is not approved yet.');
    const arrival = this.proofs(user, i.photos);
    if (!arrival.length) throw new BadRequest('Attach the arrival photo (time and place stamp).');
    return this.create(user, 'visit', 'LWT', { d: { planId: plan.id, place: plan.d.place, timeIn: this.now(), inspector: user.name, inspectorId: user.id, gps: s(i.gps, 60) || null, rep: null, lines: {}, findings: [] }, status: 'open', companyId: plan.companyId, unitId: plan.unitId, parentId: plan.id, proof: arrival }, String(plan.d.place));
  }
  private async visit(id: unknown) {
    return this.get(s(id, 120), 'visit');
  }
  /** The office representative who gave access confirms in their own sign-in. */
  private async visitAccess(user: User, i: Record<string, unknown>) {
    const r = await this.visit(i.id);
    if (!this.staffOf(user, r.companyId)) throw new AccessDenied('view', "(the office's own staff)");
    if (user.id === r.d.inspectorId) throw new BadRequest('The representative is someone from the office.');
    return this.save(user, r, { d: { ...r.d, rep: { by: user.name, byId: user.id, at: this.now() } } }, 'access', user.name);
  }
  /** S77: each checklist line OK / issue / not applicable; an issue needs a photo and a note. */
  private async visitRecord(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.visit(i.id);
    if (r.status !== 'open') throw new BadRequest('The visit is not open.');
    const { visitLines } = await this.values();
    const line = s(i.line, 40);
    if (!visitLines.includes(line)) throw new BadRequest('Not on the checklist.');
    const state = (['ok', 'issue', 'na'] as const).find((k) => k === i.state);
    if (!state) throw new BadRequest('OK, issue or not applicable?');
    const photo = this.proofs(user, i.photos);
    if (state === 'issue' && (!photo.length || s(i.note, 300).length < 3)) throw new BadRequest('An issue needs a photo and a note.');
    return this.save(user, r, { d: { ...r.d, lines: { ...(r.d.lines as object), [line]: { state, note: s(i.note, 300), photo: photo[0]?.sha256 ?? null } } }, proof: [...(r.proof ?? []), ...photo] }, 'line', `${line} ${state}`);
  }
  /** S78, S80, S84: a finding with level and type; work opens a normal repair job; critical marks it unsafe and alerts at once. */
  private async visitFinding(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.visit(i.id);
    if (r.status !== 'open') throw new BadRequest('The visit is not open.');
    const level = DAMAGE_LEVELS.find((l) => l === i.level);
    const type = FINDING_TYPES.find((t) => t === i.type);
    if (!level || !type) throw new BadRequest('Give the level and the type of finding.');
    const photo = this.proofs(user, i.photos);
    if (!photo.length) throw new BadRequest('Attach the photo of the finding.');
    const f: Record<string, unknown> = { k: (r.d.findings as unknown[]).length, line: s(i.line, 40), level, type, note: this.reason(i.note, 'what was found'), photo: photo[0].sha256, outcome: 'open', repairId: null };
    const shared = (SHARED_AREAS as readonly string[]).includes(s(i.area, 30));
    if (shared) {
      const j = await this.create(user, 'jmb', 'JMB', { d: { level, description: f.note, area: s(i.area, 30), place: r.d.place, followUps: [], fromVisit: r.id }, status: 'to_report', companyId: r.companyId, unitId: r.unitId, proof: photo }, `from ${r.ref}`);
      f.outcome = 'jmb';
      f.jmbId = j.id;
    } else if (i.fixedOnVisit === true) {
      // S80: a no-cost fix on the spot needs a photo only, no approval.
      f.outcome = 'fixed_on_visit';
    } else if (level !== 'MINOR' || i.needsWork === true) {
      const job = await this.create(user, 'repair', 'BPP', { d: { applicant: user.name, place: r.d.place, damageType: 'other', level, description: String(f.note), stage: 'submitted', rounds: [], quotes: [], approvals: {}, fromVisit: r.id, cause: s(i.cause, 300), suggested: s(i.action, 300), parts: s(i.parts, 300), estimate: i.estimate === undefined ? null : money(i.estimate) }, status: 'submitted', companyId: r.companyId, unitId: r.unitId, requesterId: user.id, proof: photo }, `from ${r.ref}: ${String(f.note)}`);
      f.repairId = job.id;
      f.outcome = 'repair';
    }
    let unsafe: unknown = null;
    if (level === 'CRITICAL' || type === 'safety_risk') {
      // S84: mark it unsafe, stop use where needed, alert the Asset Director, the office head and the HR OSH coordinator.
      unsafe = { marked: i.markedPhoto ? 'photo' : 'required', useStopped: i.useStopped === true, alerted: ['Asset Director', 'Company Manager / GM', 'HR OSH coordinator'], at: this.now() };
    }
    return this.save(user, r, { d: { ...r.d, findings: [...(r.d.findings as unknown[]), { ...f, unsafe }] }, proof: [...(r.proof ?? []), ...photo, ...this.proofs(user, i.markedPhoto)] }, 'finding', `${level} ${type}: ${String(f.note)}`);
  }
  /** S81: after the repair closes, a follow-up check against the approved scope; never by the person who did the work. */
  private async visitFollowUp(user: User, i: Record<string, unknown>) {
    const r = await this.visit(i.id);
    const k = int(i.finding);
    const fs = [...(r.d.findings as Record<string, unknown>[])];
    const f = fs[k];
    if (!f) throw new NotFound('Finding');
    if (i.cancel === true) {
      this.needTeam(user);
      fs[k] = { ...f, outcome: 'cancelled', cancelReason: this.reason(i.reason) };
      return this.save(user, r, { d: { ...r.d, findings: fs } }, 'finding_cancelled', s(i.reason, 200));
    }
    if (f.outcome !== 'repair' || !f.repairId) throw new BadRequest('Only a finding sent to repair has a follow-up check.');
    const job = await this.get(String(f.repairId), 'repair');
    if (job.status !== 'closed' && job.status !== 'paid' && job.status !== 'confirmed' && job.status !== 'payment_requested') throw new BadRequest('The repair job is not finished.');
    const did = [job.d.doneById, (job.d.confirmed as { byId?: Id } | undefined)?.byId].filter(Boolean);
    const contractor = !!(job.d.pick as { contractor?: string } | null)?.contractor;
    if (!contractor && did.includes(user.id)) throw new BadRequest('Another unit member or the lead confirms work the unit did itself.');
    if (!this.team(user) && !this.staffOf(user, r.companyId)) throw new AccessDenied('view', '(the unit or the office)');
    const photo = this.proofs(user, i.photos);
    if (!photo.length) throw new BadRequest('Attach the follow-up photo.');
    const checks = [...((f.checks as unknown[]) ?? []), { by: user.name, byId: user.id, at: this.now(), team: this.team(user), ok: i.ok !== false, note: s(i.note, 300) }];
    const teamOk = checks.some((c) => (c as { team: boolean; ok: boolean }).team && (c as { ok: boolean }).ok);
    const officeOk = !contractor || checks.some((c) => !(c as { team: boolean }).team && (c as { ok: boolean }).ok);
    fs[k] = { ...f, checks, outcome: i.ok === false ? 'repair' : teamOk && officeOk ? 'fixed' : 'repair' };
    return this.save(user, r, { d: { ...r.d, findings: fs }, proof: [...(r.proof ?? []), ...photo] }, 'follow_up', i.ok === false ? 'not right' : 'checked');
  }
  /** S79, S81: the report is built from the visit; closes only with every finding fixed, cancelled or with the JMB. */
  private async visitClose(user: User, i: Record<string, unknown>) {
    this.needTeam(user);
    const r = await this.visit(i.id);
    const open = (r.d.findings as { outcome: string }[]).filter((f) => !['fixed', 'fixed_on_visit', 'cancelled', 'jmb'].includes(f.outcome));
    if (open.length) throw new BadRequest(`${open.length} finding(s) still open.`);
    const { visitLines } = await this.values();
    const missing = visitLines.filter((l) => !(r.d.lines as Record<string, unknown>)[l]);
    if (missing.length) throw new BadRequest(`Checklist not finished: ${missing.join(', ')}.`);
    const plan = await this.get(r.parentId!, 'visitPlan');
    await this.save(user, plan, { d: { ...plan.d, nextDue: addDays(this.today(), Number(plan.d.everyMonths) * 30), lastVisit: this.today() } }, 'rolled', r.ref);
    return this.save(user, r, { status: 'closed', d: { ...r.d, timeOut: r.d.timeOut ?? this.now(), report: { on: this.today(), lines: r.d.lines, findings: r.d.findings, reviewedBy: user.name, note: this.reason(i.reason ?? 'reviewed') } } }, 'closed', 'preventive maintenance report filed');
  }

  // ===============================================================================================================
  // Board, targets and home items
  // ===============================================================================================================

  private hoursSince(at: IsoDateTime) {
    return (toMs(this.now()) - toMs(at)) / 3_600_000;
  }
  /** S43, S26, S48, S83: targets are alerts only, never a block. */
  private late(r: OfficeAmRec, v: Awaited<ReturnType<OfficeAmService['values']>>): string | null {
    const last = r.history.at(-1)!.at;
    const h = this.hoursSince(last);
    const wd = (n: number) => addWorkingDays(dateOf(last), n) < this.today();
    if (r.kind === 'repair') {
      if (r.d.dueOverride) return (r.d.dueOverride as { on: IsoDate }).on < this.today() ? 'past the new date' : null;
      if (r.status === 'submitted' && r.d.level === 'CRITICAL' && wd(v.repair.criticalResponseDays)) return 'critical: no response in 1 working day';
      if (r.status === 'submitted' && h > v.repair.checkHours + 16) return 'check late';
      if (r.status === 'visited' && h > v.repair.quotesHours + 16) return 'quotes late';
      if (r.status === 'for_approval' && wd(1)) return 'approval late';
      if (r.status === 'in_progress' && wd(v.repair.repairDays)) return 'repair late';
      if (r.status === 'payment_requested' && wd(v.repair.paymentDays)) return 'payment late';
      if (r.status === 'paid' && wd(v.repair.closeDays)) return 'close late';
      if (r.status === 'work_done') {
        const d = daysBetween(String(r.d.finishedOn), this.today());
        if (d >= (v.repair.confirmRemindDays[1] ?? 5)) return 'requester has not confirmed (day 5): the Asset Director may confirm';
        if (d >= (v.repair.confirmRemindDays[0] ?? 3)) return 'reminder to the requester (day 3)';
      }
    }
    if (r.kind === 'invUpdate') {
      if (r.status === 'submitted' && wd(v.inventory.checkDays)) return 'check late';
      if (r.status === 'checked' && wd(v.inventory.confirmDays)) return 'confirmation late';
      if (r.status === 'confirmed' && wd(v.inventory.fileDays)) return 'filing late';
    }
    if (r.kind === 'disposal' && !['closed', 'rejected', 'put_back'].includes(r.status) && addWorkingDays(dateOf(r.at), v.disposal.totalDays) < this.today()) return 'past 3 working days';
    if (r.kind === 'jmb' && r.status === 'reported') {
      const fu = ((r.d.followUps as { on: IsoDate }[]) ?? []).map((x) => x.on).sort().pop() ?? (r.d.reported as { on: IsoDate }).on;
      if (addWorkingDays(fu, r.d.level === 'CRITICAL' ? v.jmb.criticalFollowUpDays : v.jmb.followUpDays) <= this.today()) return 'JMB follow-up due';
    }
    if (r.kind === 'jmb' && r.status === 'to_report' && (r.d.level === 'CRITICAL' || dateOf(r.at) < this.today())) return 'report to the JMB today';
    if (r.kind === 'visit' && r.status === 'open' && addWorkingDays(dateOf(r.at), v.visit.totalDays) < this.today()) return 'visit to filing past 4 working days';
    if (r.kind === 'visitPlan' && r.status === 'active' && String(r.d.nextDue) < this.today()) return 'visit overdue';
    if (r.kind === 'bldConfirm' && r.status === 'asked' && addWorkingDays(String(r.d.askedOn), v.building.confirmCallDays) < this.today()) return 'not confirmed: call HQ';
    if (r.kind === 'rentMonth') {
      const st = this.rentState(r, this.today(), v.rent);
      if (st.tellAd) return `rent ${st.daysLate} days late: Asset Director and the tenant's head told`;
      if (st.late) return 'rent late';
      if (r.status === 'received_cash' && addWorkingDays(String((r.d.payment as { on: IsoDate }).on), v.rent.cashBankDays) < this.today()) return 'cash not banked in 2 working days';
    }
    if (r.kind === 'officeTenancy') {
      const soon = Object.entries(r.d.checks as Record<string, { expiresOn?: IsoDate | null }>).find(([, c]) => c.expiresOn && daysBetween(this.today(), c.expiresOn) <= v.rent.expiryRemindDays);
      if (soon) return `${soon[0]} expires ${soon[1].expiresOn}`;
    }
    if (r.kind === 'invItem' && r.d.warrantyEnd && daysBetween(this.today(), String(r.d.warrantyEnd)) <= v.inventory.warrantyRemindDays && String(r.d.warrantyEnd) >= this.today()) return `warranty ends ${String(r.d.warrantyEnd)}`;
    return null;
  }

  /** What each person may see: prices hidden from requesters, office heads and HR (S13, S25). */
  private view(user: User, r: OfficeAmRec): OfficeAmRec | null {
    const full = this.team(user) || this.ad(user) || this.finance(user) || isGroupLeader(user);
    const strip = (x: OfficeAmRec): OfficeAmRec => {
      const d = { ...x.d };
      for (const k of ['quotes', 'pick', 'rounds', 'approvedAmount', 'payRequest', 'financeReceipt', 'teamsReceipt', 'makeSafe', 'price', 'valueNow', 'report', 'saleRecorded']) delete d[k];
      if (d.inventoryCopy) d.inventoryCopy = { ...(d.inventoryCopy as object), price: undefined };
      return { ...x, d, proof: (x.proof ?? []).map((p) => ({ ...p, data: '' })) };
    };
    if (full) return { ...r, proof: (r.proof ?? []).map((p) => ({ ...p, data: '' })) };
    if (r.kind === 'buildingBuy' || r.kind === 'bldConfirm') return this.bldReader(user, r.companyId) || (r.kind === 'bldConfirm' && this.head(user, r.companyId)) ? r : null;
    if (r.requesterId === user.id) return strip(r);
    if (['repair', 'jmb', 'invItem', 'invUpdate', 'disposal', 'visit'].includes(r.kind) && this.head(user, r.companyId)) return strip(r);
    if (['invItem', 'invUpdate', 'disposal'].includes(r.kind) && this.hrView(user)) return strip(r);
    if (['invItem'].includes(r.kind) && this.staffOf(user, r.companyId)) return strip(r);
    return null;
  }

  async board(user: User) {
    if (user.integration) throw new AccessDenied('view', '(office records)');
    const v = await this.values();
    const recs = await this.all().catch(() => [] as OfficeAmRec[]);
    const managed = new Set<Id>();
    for (const a of recs.filter((r) => r.kind === 'mgmtAgreement' && r.status === 'active' && user.companyIds.includes(String(r.d.managingCompanyId)))) for (const u of a.d.unitIds as Id[]) managed.add(u);
    const visible: OfficeAmRec[] = [];
    for (const r of recs) {
      if (r.kind === 'settings' || r.kind === 'spExport' || r.kind === 'invAccess') continue;
      if ((r.kind === 'officeTenancy' || r.kind === 'rentMonth') && r.unitId && managed.has(r.unitId) && (user.role === 'company_manager' || user.role === 'admin_exec')) {
        visible.push({ ...r, proof: (r.proof ?? []).map((p) => ({ ...p, data: '' })) });
        continue;
      }
      const x = this.view(user, r);
      if (x) visible.push(x);
    }
    const role = this.team(user) ? 'unit' : this.ad(user) ? 'director' : this.finance(user) ? 'finance' : isGroupLeader(user) ? 'leader' : this.hrView(user) ? 'hr' : user.role === 'company_manager' ? 'office_head' : 'staff';
    const alerts = visible.map((r) => ({ id: r.id, ref: r.ref, kind: r.kind, late: this.late(r, v) })).filter((x) => x.late);
    const policyReview = addDays(RULES.officeAm.value.inForce, RULES.officeAm.value.policyReviewYears * 365);
    return {
      role,
      inForce: RULES.officeAm.value.inForce,
      docs: OFFICE_AM_DOCS,
      steps: OFFICE_REPAIR_STEPS,
      examples: v.examples,
      visitLines: v.visitLines,
      targets: { repair: v.repair, inventory: v.inventory, disposal: v.disposal, building: v.building, rent: v.rent, visit: v.visit },
      canSend: user.companyIds.length ? await this.canSendFor(user, user.companyIds[0]) : this.team(user),
      records: visible,
      mine: visible.filter((r) => r.requesterId === user.id),
      alerts,
      missing: Object.fromEntries(visible.filter((r) => r.kind === 'repair' && r.status === 'paid').map((r) => [r.id, this.repairMissing(r)])),
      policyReviewOn: policyReview,
      sharePoint: { automatic: false, note: 'SharePoint copy pending: the connection is off. Use the download and upload monthly.' },
    };
  }

  async homeItems(user: User) {
    if (user.integration) return [];
    const b = await this.board(user).catch(() => null);
    if (!b) return [];
    const go = { view: 'assets' as const };
    const items: { tone: 'warn' | 'crit' | 'info'; tag: string; title: string; detail: string; go: { view: 'assets' } }[] = [];
    const crit = b.records.filter((r) => r.kind === 'repair' && r.d.level === 'CRITICAL' && !['closed', 'paid'].includes(r.status));
    if (crit.length && (b.role === 'unit' || b.role === 'director' || b.role === 'office_head')) items.push({ tone: 'crit', tag: 'Penyelenggaraan', title: `${crit.length} kerosakan kritikal`, detail: crit.map((r) => r.ref).join(', '), go });
    if (b.alerts.length && (b.role === 'unit' || b.role === 'director')) items.push({ tone: 'warn', tag: 'Pejabat', title: `${b.alerts.length} perkara lewat sasaran`, detail: b.alerts.slice(0, 4).map((a) => `${a.ref} ${a.late}`).join('; '), go });
    const toApprove = b.records.filter((r) => (r.kind === 'repair' || r.kind === 'disposal') && r.status === 'for_approval');
    if (toApprove.length && (b.role === 'director' || user.leadership === 'vice_chairman' || user.opsTier === 'ceo')) items.push({ tone: 'info', tag: 'Lulus', title: `${toApprove.length} office job(s) to approve`, detail: toApprove.map((r) => r.ref).join(', '), go });
    const confirm = b.mine.filter((r) => r.kind === 'repair' && r.status === 'work_done');
    if (confirm.length) items.push({ tone: 'info', tag: 'Sahkan', title: 'Sahkan pembaikan siap', detail: confirm.map((r) => r.ref).join(', '), go });
    if (b.role === 'unit' && this.today() >= b.policyReviewOn) items.push({ tone: 'info', tag: 'Polisi', title: 'Semak semula polisi pejabat (2 tahun)', detail: `from ${b.policyReviewOn}`, go });
    return items;
  }
}
