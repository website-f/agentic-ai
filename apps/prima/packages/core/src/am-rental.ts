// Rental homes from vacant to the keys and back (Fitri package Part V, V20-V89; papers V-D6..V-D46 sent by Fauzan on
// 14 Nov 2026 with his answers V-X11..V-X37). One table, prima.am_rental_recs, behind the Asset Management wall,
// each row with an append-only history. Prima records what the team, Finance, LHDN, the tenant and the zakat body did;
// it never says money is in the bank until Finance confirms it from the bank, never says an agreement is stamped
// until the checked LHDN certificate is uploaded, and never locks a tenant out until the company's lawyer confirms in
// writing. Tenants have no Prima login: the team records what the tenant sent. Synthetic test data only.
import { AccessDenied, assetRole } from './access';
import { BadRequest, NotFound, requireApprovalReason } from './service';
import type { PrimaService, ProofInput } from './service';
import type { Store } from './store';
import { RULES } from './rules';
import { addDays, dateOf, daysBetween, fromMs, toMs, weekday } from './time';
import { addWorkingDaysExcept, workingDaysUntil } from './fw-moves';
import type { AmPayment, AmTenancy, AmUnit, Id, IsoDate, IsoDateTime, ItProof, User } from './types';

export type RentKind =
  | 'settings'
  | 'owner'
  | 'unitInfo'
  | 'listing'
  | 'agent'
  | 'application'
  | 'agreement'
  | 'collection'
  | 'bankLine'
  | 'zakat'
  | 'arrears'
  | 'moveout'
  | 'repair'
  | 'panel'
  | 'oldDeposit';

export interface RentRec {
  id: Id;
  kind: RentKind;
  unitId: Id | null;
  ref: string;
  status: string;
  d: Record<string, unknown>;
  proof: ItProof[];
  by: string;
  byId: Id;
  at: IsoDateTime;
  version: number;
  history: { at: IsoDateTime; byId: Id; by: string; action: string; note: string }[];
}

/** The rental papers in the policy library (V40, V49, V57, V63, V68, V73, V77, V84, V89), in Prima from 18 Nov 2026. */
export const RENTAL_POLICY_DOCS: { code: string; title: string; inForce: IsoDate }[] = [
  { code: 'V-D6 Pekeliling pengiklanan', title: 'Pekeliling Pelaksanaan SOP Pengiklanan Rumah Sewaan dan Penggunaan Ejen', inForce: '2026-10-15' },
  { code: 'PRWM-UPA/POL/PRS/2026/001', title: 'Polisi Pengiklanan Rumah Sewaan', inForce: '2026-10-19' },
  { code: 'V-D8 SOP pengiklanan', title: 'SOP Pengiklanan Rumah Sewaan dan Penggunaan Ejen (+ carta alir)', inForce: '2026-10-19' },
  { code: 'PRWM-UPA/POL/PPPB/2026/008 (pekeliling)', title: 'Pekeliling Dalaman Permohonan dan Pemilihan Penyewa Baharu', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/POL/PPPB/2026/008', title: 'Polisi Permohonan dan Pemilihan Penyewa Baharu', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/SOP/PPPB/2026/008', title: 'SOP Permohonan dan Pemilihan Penyewa Baharu (+ carta alir)', inForce: '2026-11-18' },
  { code: 'AST/BOR/PS/001', title: 'Tatacara Mengisi Borang Permohonan Sewa + Syarat Penggunaan Rumah', inForce: '2026-11-18' },
  { code: 'AST/ASET/DPR/001', title: 'Deposit Payment Request', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/PKL/PPPB/2026/008', title: 'Pekeliling Dalaman Penyediaan Perjanjian Sewaan', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/POL/PPPS/2026/008', title: 'Polisi Penyediaan Perjanjian Sewaan', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/SOP/PPS/2026/008 (perjanjian)', title: 'SOP Penyediaan Perjanjian Sewaan + Tatacara Pengisian (+ carta alir)', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/PKL/KSB/2026/008', title: 'Pekeliling Kutipan Sewaan Bulanan', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/POL/KSB/2026/008', title: 'Polisi Kutipan Sewaan Bulanan', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/SOP/KSB/2026/008', title: 'SOP Kutipan Sewaan Bulanan', inForce: '2026-11-18' },
  { code: 'AST/SOP/TTRESIT/001', title: 'Tatacara Catat Maklumat pada Resit Bayaran Penyewa', inForce: '2026-11-18' },
  { code: 'AST-SOP-003 v1.0', title: 'Carta alir Monthly Rental Collection', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/SOP/PTS/2026/008', title: 'SOP Tunggakan Sewa Tiga Bulan dan Notis Pengosongan (+ carta alir, cara pengisian notis)', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/PKL/PHK/2026/008', title: 'Pekeliling Dalaman Pengurusan Penyewa Hendak Keluar', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/POL/PHK/2026/008', title: 'Polisi Pengurusan Penyewa Hendak Keluar', inForce: '2026-11-18' },
  { code: 'V-D31 SOP penyewa keluar', title: 'SOP Pengurusan Penyewa Hendak Keluar (rujukan tercetak sama dengan SOP tunggakan)', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/PKL/PPS/2026/008', title: 'Pekeliling Dalaman Penyeteman Perjanjian Sewaan', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/POL/PPS/2026/008', title: 'Polisi Penyeteman Perjanjian Sewaan', inForce: '2026-11-18' },
  { code: 'V-D35 SOP penyeteman', title: 'SOP Penyeteman Perjanjian Sewaan Secara Dalam Talian (rujukan tercetak sama dengan SOP perjanjian)', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/PKL/2026/013', title: 'Pekeliling Garis Panduan Tanggungjawab Penyelenggaraan Rumah Sewaan', inForce: '2026-10-01' },
  { code: 'PRWM-UPA/POL/2026/013', title: 'Polisi Pengurusan Penyelenggaraan dan Tanggungjawab Rumah Sewa', inForce: '2026-11-18' },
  { code: 'PRWM-UPA/SOP/2026/013', title: 'SOP Penetapan Tanggungjawab Penyelenggaraan (+ carta alir, senarai semak Pemilik vs Penyewa)', inForce: '2026-10-01' },
  { code: 'PRWM-UPA/PKL/2026/019', title: 'Pekeliling Permohonan dan Pengurusan Penyelenggaraan Rumah Sewa', inForce: '2026-10-01' },
  { code: 'PRWM-UPA/POL/2026/019', title: 'Polisi Permohonan dan Pengurusan Penyelenggaraan Rumah Sewa', inForce: '2026-10-01' },
  { code: 'PRWM-UPA/SOP/2026/019', title: 'SOP Permohonan dan Pengurusan Penyelenggaraan Rumah Sewa (+ carta alir)', inForce: '2026-10-01' },
];

export const RENT_UNIT_STATUS_BM = { KOSONG: 'Kosong', DIIKLANKAN: 'Diiklankan', DALAM_PROSES: 'Dalam Proses Sewaan', TELAH_DISEWA: 'Telah Disewa' } as const;
export const SCREEN_RESULTS = ['BERMINAT_LAYAK', 'PERLU_MAKLUMAT', 'TIDAK_LAYAK', 'TIDAK_BERMINAT'] as const;
export const APP_STATUSES = ['DITERIMA', 'MENUNGGU_DOKUMEN', 'LENGKAP', 'DINILAI', 'UNTUK_KEPUTUSAN', 'LULUS', 'TIDAK_LULUS', 'DISERAH'] as const;
export const AGREEMENT_STATUSES = ['DRAF', 'DIHANTAR', 'PINDAAN', 'VERSI_AKHIR', 'DITANDATANGANI_PENYEWA', 'DITANDATANGANI_PEMILIK', 'LENGKAP', 'DIDAFTAR_EDS', 'SEDIA_BAYARAN', 'NOTIS_DIHANTAR', 'BUKTI_PENYEWA', 'BAYARAN_DISAHKAN', 'DIBAYAR_LHDN', 'DISETEM', 'DISERAHKAN', 'DIFAILKAN'] as const;
export const COLLECTION_STATUSES = ['INVOIS_DIKELUARKAN', 'INVOIS_DIHANTAR', 'BUKTI_DITERIMA', 'DALAM_SEMAKAN', 'DISAHKAN_KEWANGAN', 'RESIT_DIKELUARKAN', 'SELESAI'] as const;
export const REPAIR_LEVELS = ['MINOR', 'MEDIUM', 'CRITICAL'] as const;
export const REPAIR_OUTCOMES = ['OWNER', 'TENANT', 'UNCLEAR'] as const;
export const FEWER_QUOTE_REASONS = ['EMERGENCY', 'SPECIALIST', 'PANEL', 'NO_OTHER_SUPPLIER', 'OTHER_SPECIAL'] as const;
export const PANEL_TRADES = ['PLUMBING', 'ELECTRICAL', 'AIRCOND', 'GENERAL'] as const;
export const PROPERTY_KINDS = ['LAND', 'BUILDING', 'HOUSE', 'OFFICE', 'SHOP'] as const;
export const BUILDING_KINDS = ['TERRACE', 'MULTI_STOREY', 'OTHER'] as const;
export const INSPECT_AREAS = ['walls_ceiling', 'floor', 'doors_windows', 'pipes_sanitary', 'lights_switches', 'cabinets_furniture', 'cleanliness'] as const;
export const REPAIR_QUESTIONS = ['atHandover', 'wornByAge', 'misuse', 'routineServicing', 'noticedVsReported', 'lateMadeWorse', 'contractorFinding', 'agreementSays'] as const;
/** V37: the screening reason is the same for everyone; these words are refused in it. */
const BANNED_SCREEN_WORDS = /\b(bangsa|kaum|agama|race|religion|ethnic|melayu|cina|india|islam|kristian|christian|hindu|buddha|muslim|chinese|malay|indian)\b/i;

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const m2 = (v: unknown) => Math.round(Number(v) * 100) / 100;
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && Number.isFinite(Date.parse(v.length === 16 ? `${v}:00+08:00` : v));
const toAt = (v: string): IsoDateTime => fromMs(Date.parse(v.length === 16 ? `${v}:00+08:00` : v));
const bool = (v: unknown) => v === true || v === 'true' || v === 'yes';
function patchOf<T extends { id: unknown }>(r: T): Omit<T, 'id'> {
  const { id: _i, ...rest } = r;
  return rest;
}
const D = <T = Record<string, unknown>>(r: RentRec) => r.d as unknown as T;

/** Office hours 8.30 am to 5.30 pm on working days (Malaysia time). */
const OPEN = 8 * 60 + 30;
const CLOSE = 17 * 60 + 30;
const isWorkDay = (d: IsoDate, h: Set<IsoDate>) => weekday(d) !== 0 && weekday(d) !== 6 && !h.has(d);
const minOf = (at: IsoDateTime) => Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
/** Office minutes between two times (both Malaysia time). */
export function officeMinutesBetween(a: IsoDateTime, b: IsoDateTime, h: Set<IsoDate>): number {
  if (toMs(b) <= toMs(a)) return 0;
  let n = 0;
  for (let d = dateOf(a); d <= dateOf(b); d = addDays(d, 1)) {
    if (!isWorkDay(d, h)) continue;
    const from = d === dateOf(a) ? Math.max(OPEN, minOf(a)) : OPEN;
    const to = d === dateOf(b) ? Math.min(CLOSE, minOf(b)) : CLOSE;
    if (to > from) n += to - from;
  }
  return n;
}
/**
 * V-X11: when the first reply to an enquiry is due. In office hours: 2 office hours and the same working day; after
 * 5.30 pm (or on a day off): by 10 am the next working day.
 */
export function firstReplyDue(at: IsoDateTime, h: Set<IsoDate>, hours = RULES.amRental.value.firstReplyOfficeHours, by = RULES.amRental.value.afterHoursReplyBy): IsoDateTime {
  const d = dateOf(at);
  const mins = minOf(at);
  if (isWorkDay(d, h) && mins < CLOSE) {
    const due = Math.min(CLOSE, Math.max(OPEN, mins) + hours * 60);
    return `${d}T${String(Math.floor(due / 60)).padStart(2, '0')}:${String(due % 60).padStart(2, '0')}:00+08:00`;
  }
  let next = addDays(d, 1);
  while (!isWorkDay(next, h)) next = addDays(next, 1);
  return `${next}T${by}:00+08:00`;
}

/** V45 / V-X21: the household income a rent needs (applicant + spouse); gaps use the band below; outside: per unit. */
export function incomeNeeded(rent: number, unitMin: number | null, bands = RULES.amRental.value.incomeBands): { need: number | null; upTo: number | null; band: string } {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || rent < first.from || rent > last.to) return { need: unitMin, upTo: null, band: unitMin == null ? 'Asset Director sets the minimum for this unit' : 'unit minimum' };
  const band = [...sorted].reverse().find((b) => rent >= b.from)!;
  return { need: band.need, upTo: band.upTo, band: `RM${band.from}-${band.to}` };
}
/** V45: the most people for a number of bedrooms (4 or more: warn above 6, never above 7). */
export function occupantLimit(bedrooms: number, occ = RULES.amRental.value.occupants, warn4 = RULES.amRental.value.occupantsWarn4Bed): { max: number | null; warnAbove: number | null } {
  if (!(bedrooms >= 1)) return { max: null, warnAbove: null };
  if (bedrooms >= 4) return { max: occ[4] ?? null, warnAbove: warn4 };
  return { max: occ[bedrooms] ?? null, warnAbove: null };
}

export class RentalService {
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
  async installed() {
    return !this.store.hasTable || (await this.store.hasTable('amRentalRecs'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Rental home records are not installed in this database yet (module am-rental-v1, run by the CEO).');
  }
  private reason(v: unknown, what = 'a reason') {
    const r = s(v, 500);
    if (r.length < 3) throw new BadRequest(`Give ${what}.`);
    return r;
  }

  // ---------- who is who ----------
  private team(u: User) {
    return !u.integration && assetRole(u) === 'team';
  }
  private needTeam(u: User, what: string) {
    if (!this.team(u)) throw new AccessDenied('view', `(the Asset Management team ${what})`);
  }
  private director(u: User) {
    return this.team(u) && u.assetRole === 'director';
  }
  private needDirector(u: User, what: string) {
    if (!this.director(u)) throw new AccessDenied('view', `(the Asset Director ${what})`);
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance'));
  }
  private needFinance(u: User, what: string) {
    if (!this.finance(u)) throw new AccessDenied('view', `(Finance ${what})`);
  }
  private chairVc(u: User) {
    return !u.integration && (u.leadership === 'chairman' || u.leadership === 'vice_chairman');
  }
  private vc(u: User) {
    return !u.integration && u.leadership === 'vice_chairman';
  }
  private ceo(u: User) {
    return !u.integration && u.opsTier === 'ceo';
  }
  private sees(u: User) {
    return !u.integration && !!assetRole(u);
  }

  // ---------- records ----------
  private async all(kind?: RentKind): Promise<RentRec[]> {
    if (!(await this.installed())) return [];
    const rows = ((await this.store.list('amRentalRecs', {}).catch(() => [])) as RentRec[]) ?? [];
    return kind ? rows.filter((r) => r.kind === kind) : rows;
  }
  private async get(id: unknown, kind: RentKind): Promise<RentRec> {
    const rid = s(id, 200);
    await this.store.lock?.('amRentalRecs', rid);
    const r = (await this.store.get('amRentalRecs', rid)) as RentRec | undefined;
    if (!r || r.kind !== kind) throw new NotFound(kind === 'application' ? 'Application' : kind === 'repair' ? 'Repair report' : 'Record');
    return structuredClone(r);
  }
  private async create(user: User, kind: RentKind, prefix: string, rec: { unitId: Id | null; status: string; d: Record<string, unknown>; proof?: ItProof[]; id?: Id; ref?: string }, note: string): Promise<RentRec> {
    await this.need();
    const at = this.now();
    const year = this.today().slice(0, 4);
    const count = (await this.all(kind)).filter((r) => r.ref.startsWith(`${prefix}/${year}/`)).length + 1;
    const r: RentRec = {
      id: rec.id ?? `rent-${kind}-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 8)}`,
      kind,
      unitId: rec.unitId,
      ref: rec.ref ?? `${prefix}/${year}/${String(count).padStart(3, '0')}`,
      status: rec.status,
      d: rec.d,
      proof: rec.proof ?? [],
      by: user.name,
      byId: user.id,
      at,
      version: 1,
      history: [{ at, byId: user.id, by: user.name, action: 'create', note: note.slice(0, 500) }],
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('amRentalRecs', r as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `asset.rental.${kind}`, entity: 'am_rental', entityId: r.id, summary: `${r.ref} ${kind}: ${note}`.slice(0, 300) });
      return r;
    });
  }
  /** One history line per save (the database refuses more). */
  private async save(user: User, r: RentRec, patch: Partial<RentRec>, action: string, note: string, tx?: Store): Promise<RentRec> {
    const at = this.now();
    const next: RentRec = { ...r, ...patch, version: r.version + 1, history: [...r.history, { at, byId: user.id, by: user.name, action, note: note.slice(0, 500) }] };
    const run = async (t: Store) => {
      await t.update('amRentalRecs', r.id, patchOf(next) as never);
      await t.audit({ at, actor: user.name, companyId: null, action: `asset.rental.${r.kind}.${action}`, entity: 'am_rental', entityId: r.id, summary: `${r.ref} ${action}: ${note}`.slice(0, 300) });
      return next;
    };
    return tx ? run(tx) : this.store.transaction(run);
  }
  private proofs(user: User, v: unknown, label?: string): ItProof[] {
    const list = Array.isArray(v) ? (v as ProofInput[]).slice(0, 12) : [];
    const out = list.length ? this.svc.itProofsFor(user, list) : [];
    return label ? out.map((p) => ({ ...p, name: `${label}: ${p.name}`.slice(0, 200) })) : out;
  }
  private needProof(user: User, v: unknown, what: string, label?: string) {
    const p = this.proofs(user, v, label);
    if (!p.length) throw new BadRequest(`Attach ${what}.`);
    return p;
  }
  private async unit(id: unknown): Promise<AmUnit> {
    const u = await this.store.get('amUnits', s(id, 120));
    if (!u) throw new NotFound('Unit');
    return u;
  }
  private async holidays() {
    return (await this.svc.itHolidays()).set;
  }
  async settings() {
    const st = (await this.all('settings'))[0];
    const v = { ...RULES.amRental.value, ...((D(st ?? ({ d: {} } as RentRec)).values as object) ?? {}) } as typeof RULES.amRental.value;
    const dd = (st?.d ?? {}) as { templates?: Record<string, { v: number; note: string; by: string; at: IsoDateTime; file?: ItProof | null }[]>; officers?: Id[]; prima?: { from: IsoDate | null } };
    return { v, templates: dd.templates ?? {}, officers: dd.officers ?? [], primaOnlyFrom: dd.prima?.from ?? null, rec: st ?? null };
  }
  private async ownerOf(u: AmUnit) {
    return (await this.all('owner')).find((o) => o.d.ownerEntity === u.ownerEntity) ?? null;
  }
  private async infoOf(unitId: Id) {
    return (await this.all('unitInfo')).find((r) => r.unitId === unitId) ?? null;
  }
  private mask(acct: unknown) {
    const a = s(acct, 40).replace(/\s/g, '');
    return a.length > 4 ? `${'*'.repeat(Math.max(0, a.length - 4))}${a.slice(-4)}` : a;
  }

  /** One door: every rental home action. Permissions are checked in each branch. */
  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'export':
        return this.exportCsv(user, i);
      case 'setSettings':
        return this.setSettings(user, i);
      case 'owner':
        return this.ownerSetup(user, i);
      case 'unitInfo':
        return this.unitInfo(user, i);
      // 1. letting (V35-V39)
      case 'listingOpen':
        return this.listingOpen(user, i);
      case 'terms':
        return this.terms(user, i);
      case 'termsDecide':
        return this.termsDecide(user, i);
      case 'advert':
        return this.advert(user, i);
      case 'enquiry':
        return this.enquiry(user, i);
      case 'enquiryStep':
        return this.enquiryStep(user, i);
      case 'correction':
        return this.correction(user, i);
      case 'takedown':
        return this.takedown(user, i);
      case 'relist':
        return this.relist(user, i);
      case 'agentPropose':
        return this.agentPropose(user, i);
      case 'agentStep':
        return this.agentStep(user, i);
      // 2. application (V42-V50)
      case 'application':
        return this.application(user, i);
      case 'appStep':
        return this.appStep(user, i);
      case 'keys':
        return this.keys(user, i);
      case 'purge':
        return this.purge(user);
      // 3. agreement and stamping (V51-V57, V74-V77)
      case 'agreementOpen':
        return this.agreementOpen(user, i);
      case 'agreementStep':
        return this.agreementStep(user, i);
      // 4. monthly collection, zakat and bank lines (V58-V63, V28, V-X25, V-X26, V-X29)
      case 'invoice':
        return this.invoice(user, i);
      case 'collectionStep':
        return this.collectionStep(user, i);
      case 'zakat':
        return this.zakat(user, i);
      case 'bankLine':
        return this.bankLine(user, i);
      case 'bankLineStep':
        return this.bankLineStep(user, i);
      // 5. arrears (V64-V68, V-X27)
      case 'arrearsOpen':
        return this.arrearsOpen(user, i);
      case 'arrearsStep':
        return this.arrearsStep(user, i);
      // 6. move-out (V69-V73, V-X28, V-X29)
      case 'moveoutOpen':
        return this.moveoutOpen(user, i);
      case 'moveoutStep':
        return this.moveoutStep(user, i);
      case 'oldDeposit':
        return this.oldDeposit(user, i);
      // 8. repairs (V78-V89, V-X31..V-X37)
      case 'repairReport':
        return this.repairReport(user, i);
      case 'repairStep':
        return this.repairStep(user, i);
      case 'panel':
        return this.panel(user, i);
      default:
        throw new BadRequest('Unknown rental action.');
    }
  }

  // =================================================================================================================
  // Settings, owner companies and unit details
  // =================================================================================================================

  private async setSettings(user: User, i: Record<string, unknown>) {
    this.needDirector(user, 'keeps the rental settings');
    const reason = this.reason(i.reason);
    const cur = (await this.all('settings'))[0];
    const d: Record<string, unknown> = structuredClone(cur?.d ?? {});
    const base = RULES.amRental.value as Record<string, unknown>;
    if (i.values && typeof i.values === 'object') {
      const vals = { ...((d.values as object) ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(i.values as Record<string, unknown>)) {
        if (!(k in base)) continue;
        if (typeof base[k] === 'number' && Number.isFinite(Number(v)) && Number(v) >= 0) vals[k] = Number(v);
        else if (k === 'platforms' && Array.isArray(v)) vals[k] = (v as unknown[]).map((x) => s(x, 40).toUpperCase()).filter(Boolean).slice(0, 12);
        else if (k === 'incomeBands' && Array.isArray(v)) vals[k] = (v as Record<string, unknown>[]).map((b) => ({ from: m2(b.from), to: m2(b.to), need: m2(b.need), upTo: m2(b.upTo) })).filter((b) => b.from > 0 && b.to >= b.from && b.need > 0);
      }
      d.values = vals;
    }
    // V52 / V66: the standard agreement and the notice template; a new version keeps the old ones.
    const tpl = s(i.template, 20);
    if (tpl) {
      if (!['agreement', 'notice', 'decision', 'stampNotice'].includes(tpl)) throw new BadRequest('Unknown template.');
      const file = this.needProof(user, i.file, 'the template file');
      const list = [...(((d.templates as Record<string, unknown[]>) ?? {})[tpl] ?? [])] as { v: number }[];
      d.templates = { ...((d.templates as object) ?? {}), [tpl]: [...list, { v: list.length + 1, note: reason, by: user.name, at: this.now(), file: { ...file[0], data: undefined } }] };
    }
    if (Array.isArray(i.officers)) d.officers = (i.officers as unknown[]).map((x) => s(x, 120)).filter(Boolean).slice(0, 20);
    if (i.primaOnlyFrom !== undefined) d.prima = { from: i.primaOnlyFrom === null ? null : isDate(i.primaOnlyFrom) ? i.primaOnlyFrom : null };
    if (cur) return this.save(user, cur, { d }, 'settings', reason);
    return this.create(user, 'settings', 'RSET', { unitId: null, status: 'active', d, id: 'rent-settings' }, reason);
  }

  /** V46 / V52 / V54 / V74: per owner company: number, bank account, e-Duti Setem role and staff, e-sign, signatories. */
  private async ownerSetup(user: User, i: Record<string, unknown>) {
    this.needDirector(user, 'records the owner companies');
    const reason = this.reason(i.reason);
    const ownerEntity = s(i.ownerEntity, 160);
    if (!ownerEntity) throw new BadRequest('Name the owner company (as on the unit).');
    const sig = Array.isArray(i.signatories) ? (i.signatories as Record<string, unknown>[]) : [];
    const signatories = sig.map((x) => {
      const kind = x.kind === 'DIRECTOR' ? 'DIRECTOR' : x.kind === 'ASSET_DIRECTOR' ? 'ASSET_DIRECTOR' : null;
      if (!kind) throw new BadRequest('A signatory is a director of the owner company, or the Asset Director with its written authority.');
      if (kind === 'ASSET_DIRECTOR' && (!s(x.authorityRef, 60) || !isDate(x.authorityOn))) throw new BadRequest("Give the owner company's written authority (reference and date) for the Asset Director to sign.");
      return { name: s(x.name, 120), post: s(x.post, 80), kind, userId: s(x.userId, 120) || null, authorityRef: s(x.authorityRef, 60) || null, authorityOn: isDate(x.authorityOn) ? x.authorityOn : null };
    });
    const d = {
      ownerEntity,
      companyNo: s(i.companyNo, 40),
      address: s(i.address, 300),
      bankName: s(i.bankName, 80),
      bankAccount: s(i.bankAccount, 40).replace(/\s/g, ''),
      edsRole: bool(i.edsRole),
      edsStaffIds: Array.isArray(i.edsStaffIds) ? (i.edsStaffIds as unknown[]).map((x) => s(x, 120)).filter(Boolean) : [],
      eSignAllowed: bool(i.eSignAllowed),
      eSignLawyerRef: s(i.eSignLawyerRef, 80) || null,
      signatories,
    };
    if (!d.bankName || !/^\d{6,20}$/.test(d.bankAccount)) throw new BadRequest("Give the owner company's bank and account number.");
    if (d.eSignAllowed && !d.eSignLawyerRef) throw new BadRequest("E-signing needs the lawyer's confirmation of the method (reference).");
    const cur = (await this.all('owner')).find((o) => o.d.ownerEntity === ownerEntity);
    if (cur) return this.save(user, cur, { d }, 'owner', reason);
    return this.create(user, 'owner', 'ROWN', { unitId: null, status: 'active', d }, `${ownerEntity}: ${reason}`);
  }

  /** V23 / V35 / V45 / V47 / V27: what Prima needs to know about a rental home. */
  private async unitInfo(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'keeps the unit details');
    const u = await this.unit(i.unitId);
    const building = BUILDING_KINDS.find((b) => b === i.building) ?? null;
    const propertyKind = PROPERTY_KINDS.find((b) => b === i.propertyKind) ?? null;
    const d = {
      bedrooms: Math.max(0, Math.floor(Number(i.bedrooms) || 0)),
      bathrooms: Math.max(0, Math.floor(Number(i.bathrooms) || 0)),
      building,
      propertyKind,
      facilities: Array.isArray(i.facilities) ? (i.facilities as unknown[]).map((x) => s(x, 60)).filter(Boolean).slice(0, 20) : [],
      availableOn: isDate(i.availableOn) ? i.availableOn : null,
      contactPhone: s(i.contactPhone, 30),
      address: s(i.address, 300),
      indahWaterOwn: i.indahWaterOwn === false ? false : true,
      minIncome: i.minIncome == null || i.minIncome === '' ? null : m2(i.minIncome),
      moveInKeys: Array.isArray(i.moveInKeys) ? (i.moveInKeys as Record<string, unknown>[]).map((k) => ({ item: s(k.item, 60), count: Math.max(0, Math.floor(Number(k.count) || 0)) })).filter((k) => k.item) : [],
    };
    if (!building || !propertyKind) throw new BadRequest('Choose the building kind (terrace, multi-storey, other) and the property kind.');
    const photos = this.proofs(user, i.photos, 'Foto unit');
    const cur = await this.infoOf(u.id);
    if (cur) return this.save(user, cur, { d: { ...cur.d, ...d }, proof: photos.length ? [...cur.proof, ...photos].slice(-30) : cur.proof }, 'unitInfo', `${u.code} details`);
    return this.create(user, 'unitInfo', 'RINFO', { unitId: u.id, status: 'active', d, proof: photos, id: `rent-info-${u.id}` }, `${u.code} details`);
  }

  // =================================================================================================================
  // 1. Letting: ready, advert, enquiries, take-down, agent (V35-V39, V-X11, V-X18, V-X19)
  // =================================================================================================================

  private async openListing(unitId: Id) {
    return (await this.all('listing')).find((l) => l.unitId === unitId && l.status !== 'CLOSED') ?? null;
  }
  private async openRepairs(unitId: Id) {
    return (await this.all('repair')).filter((r) => r.unitId === unitId && !['CLOSED', 'JMB'].includes(r.status));
  }
  /** V35: what stops this unit being advertised ("Jangan iklan lagi"). */
  async readiness(u: AmUnit, listing: RentRec | null): Promise<string[]> {
    const miss: string[] = [];
    const info = await this.infoOf(u.id);
    if (u.tenancy && u.tenancy.endOn >= this.today() && !(await this.all('moveout')).some((m) => m.unitId === u.id && m.status !== 'CLOSED')) miss.push('unit still has an active tenancy');
    if (u.status === 'maintenance' || (await this.openRepairs(u.id)).some((r) => D<{ outcome?: string }>(r).outcome === 'OWNER' || r.status !== 'CLOSED')) miss.push('repair work order not closed with after-photos');
    const t = listing ? D<{ terms?: { approved?: boolean } }>(listing).terms : null;
    if (!t?.approved) miss.push('rent and deposit approved by the Asset Director');
    if (!info) miss.push('unit details (bedrooms, bathrooms, facilities)');
    else {
      const d = D<{ bedrooms: number; bathrooms: number; availableOn: IsoDate | null; contactPhone: string; address: string; facilities: string[] }>(info);
      if (!d.bedrooms) miss.push('bedrooms');
      if (!d.bathrooms) miss.push('bathrooms');
      if (!d.availableOn) miss.push('date available to move in');
      if (!d.contactPhone) miss.push('contact number');
      if (!d.address) miss.push('address / location');
      if (!info.proof.length) miss.push('unit photos');
    }
    return miss;
  }

  private async listingOpen(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'opens a letting file');
    const u = await this.unit(i.unitId);
    if (u.type !== 'RESIDENTIAL' || u.office) throw new BadRequest('This letting file is for rental homes; offices and commercial lots use the letting file on the unit.');
    if (await this.openListing(u.id)) throw new BadRequest(`${u.code} already has an open letting file.`);
    return this.create(user, 'listing', `LET-${u.code}`, { unitId: u.id, status: 'KOSONG', d: { adverts: [], enquiries: [], corrections: [], statusLog: [{ to: 'KOSONG', at: this.now(), by: user.name }] } }, `${u.code} letting file opened`);
  }

  /** V-X18: rent, deposit and terms are proposed by the rental admin executive and approved by the Asset Director. */
  private async terms(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'proposes the rent and deposit');
    const l = await this.get(i.id, 'listing');
    const rent = m2(i.rent);
    const deposit = m2(i.deposit);
    if (!(rent > 0) || !(deposit >= 0)) throw new BadRequest('Give the monthly rent and the deposit.');
    const v = (await this.settings()).v;
    const terms = { rent, deposit, advance: m2(i.advance ?? rent), termMonths: Math.max(1, Math.floor(Number(i.termMonths) || 12)), use: s(i.use, 120) || 'untuk kediaman sahaja', renewal: s(i.renewal, 200), other: s(i.other, 600), why: s(i.why, 300), proposedBy: user.name, proposedById: user.id, approved: false };
    const u = await this.unit(l.unitId);
    if (deposit !== m2(rent * v.depositMonths) && terms.why.length < 5) throw new BadRequest(`The deposit is ${v.depositMonths} months' rent (RM${(rent * v.depositMonths).toFixed(2)}); say why it differs.`);
    if (rent < u.askingRent && terms.why.length < 5) throw new BadRequest(`RM${rent} is under the asking rent of RM${u.askingRent}; say why.`);
    return this.save(user, l, { d: { ...l.d, terms } }, 'terms', `rent RM${rent}, deposit RM${deposit} proposed`);
  }
  private async termsDecide(user: User, i: Record<string, unknown>) {
    this.needDirector(user, 'approves the rent and deposit');
    const l = await this.get(i.id, 'listing');
    const t = D<{ terms?: Record<string, unknown> & { proposedById: Id } }>(l).terms;
    if (!t) throw new BadRequest('No terms proposed.');
    if (t.proposedById === user.id) throw new BadRequest('You proposed these terms, so you cannot approve them.');
    const approve = bool(i.approve);
    const note = requireApprovalReason(s(i.note, 400), approve ? 'approve' : 'refuse');
    return this.save(user, l, { d: { ...l.d, terms: { ...t, approved: approve, decidedBy: user.name, decidedById: user.id, decidedAt: this.now(), decision: note }, readyAt: approve ? this.now() : null } }, 'termsDecide', `${approve ? 'approved' : 'refused'}: ${note}`);
  }
  /** V36: the advert text, drafted by Prima from the unit; rent, deposit and terms are locked. */
  async advertText(u: AmUnit, l: RentRec): Promise<string> {
    const info = await this.infoOf(u.id);
    const d = D<{ bedrooms?: number; bathrooms?: number; facilities?: string[]; availableOn?: IsoDate; contactPhone?: string; address?: string }>(info ?? ({ d: {} } as RentRec));
    const t = D<{ terms?: { rent: number; deposit: number; termMonths: number; use: string } }>(l).terms;
    return [
      `${u.name} untuk disewa`,
      `Lokasi: ${d.address || `${u.town}, ${u.state}`}`,
      `${d.bedrooms ?? '?'} bilik tidur, ${d.bathrooms ?? '?'} bilik air`,
      `Sewa: RM${t?.rent?.toFixed(2) ?? '-'} sebulan; deposit RM${t?.deposit?.toFixed(2) ?? '-'} + sewa sebulan pendahuluan`,
      d.facilities?.length ? `Kemudahan: ${d.facilities.join(', ')}` : '',
      `Tempoh: ${t?.termMonths ?? 12} bulan, ${t?.use ?? 'untuk kediaman sahaja'}; tiada haiwan peliharaan`,
      d.availableOn ? `Boleh masuk: ${d.availableOn}` : '',
      d.contactPhone ? `Hubungi: ${d.contactPhone}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  private async advert(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'posts adverts');
    const l = await this.get(i.id, 'listing');
    const u = await this.unit(l.unitId);
    const miss = await this.readiness(u, l);
    if (miss.length) throw new BadRequest(`Jangan iklan lagi: ${miss.join('; ')}.`);
    const v = (await this.settings()).v;
    const platform = s(i.platform, 40).toUpperCase();
    if (!v.platforms.includes(platform)) throw new BadRequest(`${platform || 'That platform'} is not on the approved list (${v.platforms.join(', ')}). The Asset Director adds platforms.`);
    const link = s(i.link, 300);
    if (!/^https?:\/\//.test(link)) throw new BadRequest('Give the advert link.');
    if (!bool(i.photosChecked)) throw new BadRequest('Tick that the photos are current, clear and show no personal or confidential details.');
    const shot = this.needProof(user, i.screenshot, 'the screenshot after posting', `Iklan ${platform}`);
    const text = await this.advertText(u, l);
    const adverts = [...((l.d.adverts as unknown[]) ?? []), { platform, link, postedAt: this.now(), by: user.name, text, takenDown: null }];
    const first = !((l.d.adverts as unknown[]) ?? []).length;
    const status = first || l.status === 'KOSONG' ? 'DIIKLANKAN' : l.status;
    const log = [...((l.d.statusLog as unknown[]) ?? []), ...(status !== l.status ? [{ to: status, at: this.now(), by: user.name }] : [])];
    return this.save(user, l, { status, d: { ...l.d, adverts, statusLog: log, firstAdvertAt: (l.d.firstAdvertAt as string) ?? this.now() }, proof: [...l.proof, ...shot] }, 'advert', `${u.code} on ${platform}`);
  }
  /** V37 / V-X11: an enquiry with its time; first reply due 2 office hours (same day) or 10 am next working day. */
  private async enquiry(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'records enquiries');
    const l = await this.get(i.id, 'listing');
    if (!isTime(i.at)) throw new BadRequest('Give the date AND time of the enquiry.');
    const name = s(i.name, 120);
    const phone = s(i.phone, 30);
    if (name.length < 2 || !/^[0-9+\-\s]{8,20}$/.test(phone)) throw new BadRequest('Give the name and a phone number.');
    const source = s(i.source, 20).toUpperCase() || 'OTHER';
    let agentId: Id | null = null;
    if (source === 'AGENT') {
      agentId = s(i.agentId, 200);
      const a = (await this.all('agent')).find((x) => x.id === agentId && x.unitId === l.unitId);
      if (!a) throw new BadRequest('Name the agent this prospect came from.');
    }
    const at = toAt(i.at as string);
    const due = firstReplyDue(at, await this.holidays());
    const enquiries = [...((l.d.enquiries as unknown[]) ?? []), { n: ((l.d.enquiries as unknown[]) ?? []).length + 1, name, phone, at, channel: s(i.channel, 20) || 'WHATSAPP', source, agentId, told: s(i.told, 300), replyDue: due, repliedAt: null, screen: null, viewingOn: null, notes: [] }];
    return this.save(user, l, { d: { ...l.d, enquiries } }, 'enquiry', `enquiry ${enquiries.length} at ${at.slice(0, 16)}`);
  }
  private async enquiryStep(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'follows up enquiries');
    const l = await this.get(i.id, 'listing');
    const list = structuredClone((l.d.enquiries as Record<string, unknown>[]) ?? []);
    const e = list.find((x) => x.n === Number(i.n));
    if (!e) throw new NotFound('Enquiry');
    const step = s(i.step, 20);
    let status = l.status;
    if (step === 'reply') {
      e.repliedAt = isTime(i.at) ? toAt(i.at as string) : this.now();
    } else if (step === 'screen') {
      const result = SCREEN_RESULTS.find((r) => r === i.result);
      if (!result) throw new BadRequest('Pick the screening result.');
      const why = s(i.reason, 300);
      if (result === 'TIDAK_LAYAK' && why.length < 3) throw new BadRequest('Give a short reason for Tidak layak (internal only).');
      if (BANNED_SCREEN_WORDS.test(why)) throw new BadRequest('The same criteria for everyone: the reason cannot name race, religion or similar.');
      e.screen = { result, reason: why, purpose: s(i.purpose, 200), occupants: Number(i.occupants) || null, job: s(i.job, 100), incomeStable: bool(i.incomeStable), stay: s(i.stay, 60), fitsRules: bool(i.fitsRules), at: this.now(), by: user.name, late: toMs(this.now()) - toMs(e.at as string) > (await this.settings()).v.screenMinutes * 60_000 };
      if (result === 'BERMINAT_LAYAK' && l.status === 'DIIKLANKAN') status = 'DALAM_PROSES';
    } else if (step === 'viewing') {
      if (!isDate(i.on)) throw new BadRequest('Give the viewing date.');
      e.viewingOn = i.on;
    } else if (step === 'note') {
      (e.notes as unknown[]).push({ at: this.now(), by: user.name, text: this.reason(i.text, 'the note') });
    } else throw new BadRequest('Unknown enquiry step.');
    const log = [...((l.d.statusLog as unknown[]) ?? []), ...(status !== l.status ? [{ to: status, at: this.now(), by: user.name }] : [])];
    return this.save(user, l, { status, d: { ...l.d, enquiries: list, statusLog: log } }, `enquiry.${step}`, `enquiry ${e.n}: ${step}`);
  }
  /** V38: a wrong figure in a live advert: corrected, logged, and the prospects who got it ticked as told. */
  private async correction(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'corrects adverts');
    const l = await this.get(i.id, 'listing');
    const field = s(i.field, 40);
    if (!field) throw new BadRequest('Say what was wrong.');
    const told = Array.isArray(i.told) ? (i.told as unknown[]).map(Number) : [];
    const corrections = [...((l.d.corrections as unknown[]) ?? []), { field, wrong: s(i.wrong, 200), right: s(i.right, 200), told, at: this.now(), by: user.name }];
    return this.save(user, l, { d: { ...l.d, corrections }, proof: [...l.proof, ...this.proofs(user, i.proof, 'Pembetulan')] }, 'correction', `${field} corrected; ${told.length} prospects told`);
  }
  /** V38: every platform taken down with its proof; Prima reminds daily until all are done. */
  private async takedown(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'takes adverts down');
    const l = await this.get(i.id, 'listing');
    const ads = structuredClone((l.d.adverts as Record<string, unknown>[]) ?? []);
    const a = ads.find((x) => x.platform === s(i.platform, 40).toUpperCase() && !x.takenDown);
    if (!a) throw new NotFound('Live advert on that platform');
    const shot = this.needProof(user, i.screenshot, 'the take-down screenshot', `Turun ${a.platform}`);
    a.takenDown = { at: this.now(), by: user.name };
    return this.save(user, l, { d: { ...l.d, adverts: ads }, proof: [...l.proof, ...shot] }, 'takedown', `${a.platform} taken down`);
  }
  /** V38: the letting falls through: back to Diiklankan only after the re-check. */
  private async relist(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'relists units');
    const l = await this.get(i.id, 'listing');
    if (l.status !== 'DALAM_PROSES') throw new BadRequest('Only a unit in Dalam Proses Sewaan goes back to Diiklankan.');
    for (const k of ['details', 'rent', 'deposit', 'photos', 'terms']) if (!bool((i.checked as Record<string, unknown>)?.[k])) throw new BadRequest(`Re-check the ${k} first (V35).`);
    const u = await this.unit(l.unitId);
    const miss = await this.readiness(u, l);
    if (miss.length) throw new BadRequest(`Jangan iklan lagi: ${miss.join('; ')}.`);
    const log = [...((l.d.statusLog as unknown[]) ?? []), { to: 'DIIKLANKAN', at: this.now(), by: user.name, why: this.reason(i.reason) }];
    return this.save(user, l, { status: 'DIIKLANKAN', d: { ...l.d, statusLog: log } }, 'relist', 'back to Diiklankan after re-check');
  }
  /** V39 / V-X19: "cadang ejen" after 30 days advertised without a tenant, or earlier when every prospect is Tidak layak. */
  agentDue(l: RentRec, today: IsoDate, days = RULES.amRental.value.agentAfterDays): string | null {
    if (!['DIIKLANKAN', 'DALAM_PROSES'].includes(l.status) || !l.d.firstAdvertAt) return null;
    const screened = ((l.d.enquiries as { screen?: { result: string } | null }[]) ?? []).filter((e) => e.screen);
    if (daysBetween(dateOf(l.d.firstAdvertAt as string), today) >= days) return `${days} days advertised without a tenant`;
    if (screened.length && screened.every((e) => e.screen!.result === 'TIDAK_LAYAK')) return 'every screened prospect is Tidak layak';
    return null;
  }
  private async agentPropose(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'proposes an agent');
    const l = await this.get(i.listingId, 'listing');
    const v = (await this.settings()).v;
    const usedBefore = bool(i.usedBefore);
    const why = this.agentDue(l, this.today(), v.agentAfterDays);
    if (!why && !usedBefore) throw new BadRequest(`An agent is offered after ${v.agentAfterDays} days advertised without a tenant, or when every screened prospect is Tidak layak.`);
    const enq = (l.d.enquiries as { screen?: { result: string } | null; viewingOn?: string | null }[]) ?? [];
    const summary = {
      firstAdvertAt: l.d.firstAdvertAt ?? null,
      platforms: ((l.d.adverts as { platform: string }[]) ?? []).map((a) => a.platform),
      enquiries: enq.length,
      viewings: enq.filter((e) => e.viewingOn).length,
      screening: Object.fromEntries(SCREEN_RESULTS.map((r) => [r, enq.filter((e) => e.screen?.result === r).length])),
      trigger: why,
    };
    const d = { listingId: l.id, name: s(i.name, 120), company: s(i.company, 120), phone: s(i.phone, 30), feeMonths: Number(i.feeMonths ?? v.agentFeeMonths), why: this.reason(i.why, 'one line on why an agent is proposed'), summary, proposedById: user.id, usedBefore, progress: [] as unknown[] };
    if (d.name.length < 2 || !d.phone) throw new BadRequest("Give the agent's name and phone.");
    return this.create(user, 'agent', 'AGT', { unitId: l.unitId, status: 'PROPOSED', d }, `agent ${d.name} proposed${usedBefore ? ' (already used without approval: flagged)' : ''}`);
  }
  private async agentStep(user: User, i: Record<string, unknown>) {
    const a = await this.get(i.id, 'agent');
    const step = s(i.step, 20);
    const d = structuredClone(a.d) as Record<string, unknown>;
    const v = (await this.settings()).v;
    if (step === 'decide') {
      this.needDirector(user, 'approves agents and their fee');
      if (d.proposedById === user.id) throw new BadRequest('You proposed this agent, so you cannot approve it.');
      const approve = bool(i.approve);
      const note = requireApprovalReason(s(i.note, 400));
      const fee = Number(i.feeMonths ?? d.feeMonths);
      if (approve && fee !== v.agentFeeMonths && note.length < 10) throw new BadRequest(`The fee is ${v.agentFeeMonths} month's rent; give the reason for a different fee.`);
      if (approve && d.usedBefore && note.length < 10) throw new BadRequest('This agent was used before approval; give the reason for approving it afterwards.');
      d.decision = { approve, note, feeMonths: fee, by: user.name, byId: user.id, at: this.now() };
      return this.save(user, a, { status: approve ? 'APPROVED' : 'REFUSED', d }, 'decide', `${approve ? 'approved' : 'refused'}: ${note}`);
    }
    this.needTeam(user, 'works with agents');
    if (step === 'progress') {
      (d.progress as unknown[]).push({ at: this.now(), by: user.name, text: this.reason(i.text, 'the progress note'), detailsGiven: bool(i.detailsGiven) });
      return this.save(user, a, { d }, 'progress', 'progress noted');
    }
    if (step === 'feeRequest') {
      if (a.status !== 'APPROVED') throw new BadRequest('No fee: the agent and its fee terms are not approved.');
      const docs = (i.docs ?? {}) as Record<string, unknown>;
      for (const k of ['approval', 'terms', 'serviceProof', 'invoice']) if (!bool(docs[k])) throw new BadRequest(`The fee needs all five papers on file: missing ${k}.`);
      // The signed tenant must have come through this agent.
      const app = (await this.all('application')).find((x) => x.unitId === a.unitId && D<{ agentId?: Id }>(x).agentId === a.id && x.status === 'DISERAH');
      if (!app) throw new BadRequest('No fee: the signed tenant did not come through this agent.');
      const u = await this.unit(a.unitId);
      const fee = m2((u.tenancy?.rent ?? 0) * Number(D<{ decision: { feeMonths: number } }>(a).decision.feeMonths));
      d.fee = { amount: fee, appId: app.id, requestedBy: user.name, requestedById: user.id, at: this.now() };
      return this.save(user, a, { status: 'FEE_REQUESTED', d, proof: [...a.proof, ...this.proofs(user, i.files, 'Bayaran ejen')] }, 'feeRequest', `fee RM${fee} asked`);
    }
    if (step === 'feeApprove') {
      if (!this.director(user)) throw new AccessDenied('view', '(the Asset Director approves the agent fee)');
      if (a.status !== 'FEE_REQUESTED') throw new BadRequest('No fee request waiting.');
      if ([d.proposedById, (d.fee as { requestedById: Id }).requestedById].includes(user.id)) throw new BadRequest('You proposed this agent or asked for the fee, so someone else approves it.');
      d.feeApproved = { by: user.name, at: this.now(), note: requireApprovalReason(s(i.note, 300)) };
      return this.save(user, a, { status: 'FEE_APPROVED', d }, 'feeApprove', 'fee approved; Finance pays');
    }
    throw new BadRequest('Unknown agent step.');
  }

  // =================================================================================================================
  // 2. Application, assessment, decision, deposit, utilities, keys (V42-V48, V-X12, V-X20..V-X22)
  // =================================================================================================================

  private related(a: RentRec, user: User) {
    return D<{ related?: { staffUserId?: Id | null } }>(a).related?.staffUserId === user.id;
  }
  private async application(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'records applications');
    const u = await this.unit(i.unitId);
    if (!bool(i.conditionsExplained)) throw new BadRequest('Tick "syarat diterangkan": the conditions are explained before the form is given.');
    const type = i.applicantType === 'COMPANY' ? 'COMPANY' : 'PERSON';
    const ap = (i.applicant ?? {}) as Record<string, unknown>;
    const name = s(ap.name, 160);
    if (name.length < 2) throw new BadRequest("Give the applicant's full name.");
    const listing = await this.openListing(u.id);
    let agentId: Id | null = null;
    if (s(i.source, 20) === 'AGENT') {
      agentId = s(i.agentId, 200);
      const e = ((listing?.d.enquiries as { agentId?: Id; screen?: unknown }[]) ?? []).find((x) => x.agentId === agentId && x.screen);
      if (!e) throw new BadRequest('An agent prospect goes through the same screening first (V37).');
    }
    const docs = this.proofs(user, i.docs, 'Dokumen');
    const d = {
      form: 'AST/BOR/PS/001',
      type,
      appliedOn: this.today(),
      moveInOn: isDate(i.moveInOn) ? i.moveInOn : null,
      purpose: s(i.purpose, 200),
      applicant: { name, ic: s(ap.ic, 20), address: s(ap.address, 300), prevAddress: s(ap.prevAddress, 300), marital: s(ap.marital, 20), phone: s(ap.phone, 30), email: s(ap.email, 120), dependants: Number(ap.dependants) || 0, employer: s(ap.employer, 160), employerAddress: s(ap.employerAddress, 300), officePhone: s(ap.officePhone, 30), job: s(ap.job, 100), net: m2(ap.net ?? 0) },
      spouse: i.spouse ? { name: s((i.spouse as Record<string, unknown>).name, 160), ic: s((i.spouse as Record<string, unknown>).ic, 20), phone: s((i.spouse as Record<string, unknown>).phone, 30), employer: s((i.spouse as Record<string, unknown>).employer, 160), job: s((i.spouse as Record<string, unknown>).job, 100), net: m2((i.spouse as Record<string, unknown>).net ?? 0) } : null,
      company: type === 'COMPANY' ? { ssmNo: s((i.company as Record<string, unknown>)?.ssmNo, 40), regAddress: s((i.company as Record<string, unknown>)?.regAddress, 300), contact: s((i.company as Record<string, unknown>)?.contact, 160), contactIc: s((i.company as Record<string, unknown>)?.contactIc, 20) } : null,
      emergency: Array.isArray(i.emergency) ? (i.emergency as Record<string, unknown>[]).slice(0, 2).map((x) => ({ name: s(x.name, 120), relation: s(x.relation, 40), phone: s(x.phone, 30) })) : [],
      occupants: Number(i.occupants) || 0,
      cars: Number(i.cars) || 0,
      motorcycles: Number(i.motorcycles) || 0,
      pets: bool(i.pets),
      heard: Array.isArray(i.heard) ? (i.heard as unknown[]).map((x) => s(x, 30)) : [],
      related: { yes: bool((i.related as Record<string, unknown>)?.yes), staffUserId: s((i.related as Record<string, unknown>)?.staffUserId, 120) || null, details: s((i.related as Record<string, unknown>)?.details, 200) },
      declarationSigned: bool(i.declarationSigned),
      annexSignedOn: isDate(i.annexSignedOn) ? i.annexSignedOn : null,
      source: s(i.source, 20) || 'DIRECT',
      agentId,
      listingId: listing?.id ?? null,
      enquiryAt: isTime(i.enquiryAt) ? toAt(i.enquiryAt as string) : this.now(),
      waits: [] as { from: IsoDateTime; to: IsoDateTime | null; missing: string[]; channel: string }[],
      steps: {} as Record<string, unknown>,
      deposits: [] as unknown[],
      utilities: {} as Record<string, unknown>,
    };
    if (d.related.yes && d.related.staffUserId === user.id) throw new BadRequest('You are related to this applicant, so someone else in the team records the application.');
    if (type === 'COMPANY' && !d.company?.ssmNo) throw new BadRequest('A company applicant gives its SSM number (company form, V-X22).');
    return this.create(user, 'application', 'APP', { unitId: u.id, status: 'DITERIMA', d, proof: docs }, `${u.code}: application from ${type === 'COMPANY' ? 'a company' : 'an applicant'}`);
  }

  /** V43 / V45: Prima's assessment sheet (pass or short per rule); the recommendation is the team's. */
  async assessment(a: RentRec, u: AmUnit) {
    const d = D<{ type: string; applicant: { net: number }; spouse: { net: number } | null; occupants: number; cars: number; motorcycles: number; pets: boolean }>(a);
    const info = await this.infoOf(u.id);
    const id = D<{ bedrooms?: number; building?: string; minIncome?: number | null }>(info ?? ({ d: {} } as RentRec));
    const v = (await this.settings()).v;
    const listing = (await this.all('listing')).find((l) => l.id === D<{ listingId: Id }>(a).listingId);
    const rent = Number(D<{ terms?: { rent: number } }>(listing ?? ({ d: {} } as RentRec)).terms?.rent ?? u.askingRent);
    if (d.type === 'COMPANY') return { rent, rules: [{ rule: 'company', ok: null as boolean | null, note: 'Company tenant: no income table or occupant limit; the Asset Director judges (V-X22).' }] };
    const household = m2(d.applicant.net + (d.spouse?.net ?? 0));
    const inc = incomeNeeded(rent, id.minIncome ?? null, v.incomeBands);
    const occ = occupantLimit(Number(id.bedrooms ?? 0), v.occupants, v.occupantsWarn4Bed);
    const park = v.parking[id.building ?? 'OTHER'] ?? v.parking.OTHER;
    return {
      rent,
      household,
      rules: [
        { rule: 'income', ok: inc.need == null ? null : household >= inc.need, note: inc.need == null ? inc.band : `${inc.band}: needs RM${inc.need}${inc.upTo ? `-${inc.upTo}` : ''}; household RM${household}${household >= (inc.need ?? 0) ? '' : ' (income short)'}` },
        { rule: 'occupants', ok: occ.max == null ? null : d.occupants <= occ.max, note: occ.max == null ? 'bedrooms not set' : `${d.occupants} people, limit ${occ.max}${occ.warnAbove && d.occupants > occ.warnAbove && d.occupants <= occ.max ? ' (above 6: warn)' : ''}` },
        { rule: 'parking', ok: d.cars <= park.cars && d.motorcycles <= park.motorcycles, note: `${d.cars} cars, ${d.motorcycles} motorcycles; ${id.building ?? 'OTHER'} allows ${park.cars} + ${park.motorcycles}` },
        { rule: 'pets', ok: !d.pets, note: d.pets ? 'has pets (no pets allowed)' : 'no pets' },
      ],
    };
  }
  /** V48: working days from the enquiry, less the days waiting for the applicant ("Menunggu Dokumen"). */
  async appClock(a: RentRec, to: IsoDate = this.today()) {
    const h = await this.holidays();
    const d = D<{ enquiryAt: IsoDateTime; waits: { from: IsoDateTime; to: IsoDateTime | null }[] }>(a);
    const total = workingDaysUntil(dateOf(d.enquiryAt), to, h);
    const waiting = d.waits.reduce((n, w) => n + workingDaysUntil(dateOf(w.from), w.to ? dateOf(w.to) : to, h), 0);
    const team = Math.max(0, total - waiting);
    return { total, waiting, team, late: team > RULES.amRental.value.wholeProcessWorkingDays };
  }
  private async appStep(user: User, i: Record<string, unknown>) {
    const a = await this.get(i.id, 'application');
    const step = s(i.step, 30);
    const d = structuredClone(a.d) as Record<string, any>;
    const u = await this.unit(a.unitId);
    const v = (await this.settings()).v;
    const note = s(i.note, 400);
    const stepAt = (k: string) => ((d.steps as Record<string, unknown>)[k] = { at: this.now(), by: user.name, byId: user.id, note });
    if (this.related(a, user)) throw new BadRequest('You are related to this applicant, so you cannot screen, assess or decide this application.');
    switch (step) {
      case 'waitDocs': {
        this.needTeam(user, 'checks applications');
        const missing = Array.isArray(i.missing) ? (i.missing as unknown[]).map((x) => s(x, 80)).filter(Boolean) : [];
        if (!missing.length) throw new BadRequest('List what is missing.');
        d.waits.push({ from: this.now(), to: null, missing, channel: s(i.channel, 20) || 'WHATSAPP' });
        return this.save(user, a, { status: 'MENUNGGU_DOKUMEN', d }, step, `waiting for ${missing.join(', ')}`);
      }
      case 'docsIn': {
        this.needTeam(user, 'checks applications');
        const w = d.waits.find((x: { to: unknown }) => !x.to);
        if (w) w.to = this.now();
        const docs = this.proofs(user, i.docs, 'Dokumen');
        return this.save(user, a, { status: 'LENGKAP', d, proof: [...a.proof, ...docs] }, step, 'documents complete');
      }
      case 'check': {
        this.needTeam(user, 'checks applications');
        if (!['DITERIMA', 'LENGKAP'].includes(a.status)) throw new BadRequest('The application is not waiting for the check.');
        if (!d.annexSignedOn || !d.declarationSigned) throw new BadRequest('The applicant signs the declaration and the conditions annex before the check.');
        if (!a.proof.length) throw new BadRequest('Attach the form and the IC copies and payslips (or the company papers).');
        stepAt('check');
        return this.save(user, a, { status: 'LENGKAP', d }, step, `checked: ${this.reason(note, 'what was checked')}`);
      }
      case 'assess': {
        this.needTeam(user, 'assesses applications');
        if (a.status !== 'LENGKAP' || !d.steps.check) throw new BadRequest('Check the application (complete, signed annex) before the assessment.');
        if (!d.annexSignedOn) throw new BadRequest('The form cannot go to assessment without the signed conditions annex.');
        const sheet = await this.assessment(a, u);
        d.assessment = { ...sheet, recommendation: this.reason(i.recommendation, "the team's written recommendation"), by: user.name, byId: user.id, at: this.now() };
        return this.save(user, a, { status: 'DINILAI', d }, step, `assessed: ${sheet.rules.map((r) => `${r.rule} ${r.ok === null ? '?' : r.ok ? 'pass' : 'short'}`).join(', ')}`);
      }
      case 'forDecision': {
        this.needTeam(user, 'sends applications for decision');
        if (a.status !== 'DINILAI') {
          // An incomplete application goes for decision only on the Asset Director's written instruction.
          if (!(this.director(user) && s(i.instruction, 300).length >= 5)) throw new BadRequest('Assess the application first; an incomplete one goes for decision only on the Asset Director\'s written instruction.');
          d.instruction = { by: user.name, at: this.now(), text: s(i.instruction, 300) };
        }
        stepAt('forDecision');
        return this.save(user, a, { status: 'UNTUK_KEPUTUSAN', d }, step, 'for decision');
      }
      case 'decide': {
        this.needDirector(user, 'decides new tenants');
        if (a.status !== 'UNTUK_KEPUTUSAN' || d.decision) throw new BadRequest('No application waiting for decision.');
        if ([(d.steps.forDecision as { byId?: Id })?.byId, (d.assessment as { byId?: Id })?.byId].includes(user.id)) throw new BadRequest('You prepared or sent this application, so someone else decides it.');
        const approve = bool(i.approve);
        d.decision = { approve, note: requireApprovalReason(note, approve ? 'approve' : 'refuse'), by: user.name, byId: user.id, at: this.now() };
        return this.save(user, a, { status: approve ? 'UNTUK_KEPUTUSAN' : 'TIDAK_LULUS', d }, step, approve ? 'approved by the Asset Director; waiting for the Chairman or Vice Chairman' : `refused: ${note}`);
      }
      case 'consent': {
        if (!this.chairVc(user)) throw new AccessDenied('view', '(the Chairman or Vice Chairman consents to a new tenant)');
        if (!d.decision?.approve || d.consent) throw new BadRequest('No approved application waiting for consent.');
        if (d.decision.byId === user.id) throw new BadRequest('You approved it, so the consent is someone else\'s.');
        const yes = i.consent !== false;
        d.consent = { yes, note: requireApprovalReason(note, 'consent'), by: user.name, byId: user.id, at: this.now() };
        return this.save(user, a, { status: yes ? 'LULUS' : 'TIDAK_LULUS', d }, step, yes ? 'consented: LULUS' : `not consented: ${note}`);
      }
      case 'told': {
        this.needTeam(user, 'tells applicants');
        if (!['LULUS', 'TIDAK_LULUS'].includes(a.status)) throw new BadRequest('There is no decision to tell yet.');
        d.told = { at: this.now(), by: user.name, channel: s(i.channel, 20) || 'WHATSAPP' };
        return this.save(user, a, { d, proof: [...a.proof, ...this.proofs(user, i.proof, 'Makluman pemohon')] }, step, 'applicant told');
      }
      case 'dpr': {
        // V46: the Deposit Payment Request, numbered DPR/YYYY/NNN, in the OWNER company's name and bank account.
        this.needTeam(user, 'issues deposit requests');
        if (a.status !== 'LULUS') throw new BadRequest('The deposit request is issued only after approval and consent.');
        if (d.dpr) throw new BadRequest(`Deposit request ${d.dpr.no} is already issued; a number is never reused.`);
        const owner = await this.ownerOf(u);
        if (!owner) throw new BadRequest(`Record the owner company ${u.ownerEntity} (number and bank account) first.`);
        const listing = (await this.all('listing')).find((l) => l.id === d.listingId);
        const t = D<{ terms?: { rent: number; deposit: number; advance: number } }>(listing ?? ({ d: {} } as RentRec)).terms;
        const rent = Number(t?.rent ?? u.askingRent);
        let deposit = Number(t?.deposit ?? rent * v.depositMonths);
        let advance = Number(t?.advance ?? rent * v.advanceMonths);
        if (i.deposit != null || i.advance != null) {
          if (!this.director(user)) throw new BadRequest("A different deposit or advance figure needs the Asset Director's reason.");
          deposit = m2(i.deposit ?? deposit);
          advance = m2(i.advance ?? advance);
          this.reason(note, 'the reason for the different figure');
        }
        const year = this.today().slice(0, 4);
        const n = (await this.all('application')).filter((x) => String((x.d.dpr as { no?: string })?.no ?? '').startsWith(`DPR/${year}/`)).length + 1;
        const od = owner.d as Record<string, string>;
        d.dpr = { no: `DPR/${year}/${String(n).padStart(3, '0')}`, on: this.today(), dueOn: isDate(i.dueOn) ? i.dueOn : addDays(this.today(), 3), rent, deposit, advance, total: m2(deposit + advance), owner: { name: od.ownerEntity, companyNo: od.companyNo, bankName: od.bankName, bankAccount: od.bankAccount }, firstInvoiceNo: s(i.firstInvoiceNo, 40) || null, how: 'Pindahan bank / FPX / CDM (slip). Tiada tunai.', note: 'Bukan resit rasmi.' };
        return this.save(user, a, { d }, step, `${d.dpr.no} RM${d.dpr.total} to ${od.ownerEntity}`);
      }
      case 'depositProof': {
        this.needTeam(user, 'records the tenant\'s proof');
        if (!d.dpr) throw new BadRequest('Issue the deposit request first.');
        const p = this.needProof(user, i.proof, "the tenant's proof of payment", 'Bukti deposit');
        d.depositProofs = [...(d.depositProofs ?? []), { at: this.now(), by: user.name, amount: m2(i.amount), ref: s(i.ref, 60) }];
        return this.save(user, a, { d, proof: [...a.proof, ...p] }, step, 'tenant proof recorded (not money received)');
      }
      case 'depositConfirm': {
        // Only Finance confirms money, from the bank records of the owner company's account; a screenshot never does.
        this.needFinance(user, 'confirms the deposit from the bank');
        if (!d.dpr) throw new BadRequest('No deposit request.');
        const result = s(i.result, 20);
        if (result === 'DALAM_SEMAKAN') {
          d.depositCheck = { at: this.now(), by: user.name, note: this.reason(note, 'what does not match') };
          return this.save(user, a, { d }, step, 'Dalam Semakan');
        }
        const amount = m2(i.amount);
        const bankRef = s(i.bankRef, 60);
        if (!(amount > 0) || !bankRef) throw new BadRequest('Give the amount seen in the bank and the statement reference.');
        const payer = ['TENANT', 'ZAKAT', 'COMPANY', 'OTHER'].includes(s(i.payer, 10)) ? s(i.payer, 10) : 'TENANT';
        d.deposits.push({ amount, bankRef, on: isDate(i.on) ? i.on : this.today(), payer, payerName: s(i.payerName, 120), by: user.name, at: this.now() });
        d.depositCheck = null;
        const got = m2(d.deposits.reduce((n2: number, x: { amount: number }) => n2 + x.amount, 0));
        d.depositFull = got + 0.001 >= d.dpr.total;
        return this.save(user, a, { d }, step, d.depositFull ? `deposit confirmed in full (RM${got})` : `part payment RM${got} of RM${d.dpr.total}; agreement stays locked`);
      }
      case 'utility': {
        // V47: TNB, Air Selangor and Indah Water in the tenant's name within 72 hours, with proof.
        this.needTeam(user, 'records the utility accounts');
        const acc = s(i.account, 10).toUpperCase();
        if (!['TNB', 'AIR', 'IWK'].includes(acc)) throw new BadRequest('Pick TNB, AIR (Air Selangor) or IWK (Indah Water).');
        if (bool(i.companyDoes)) {
          this.needDirector(user, 'approves the company changing the accounts');
          d.utilities[acc] = { by: user.name, at: this.now(), special: this.reason(note, 'the reason') };
        } else d.utilities[acc] = { by: user.name, at: this.now(), proof: this.needProof(user, i.proof, `the ${acc} account change proof`, `Utiliti ${acc}`).map((p) => ({ ...p, data: undefined })) };
        return this.save(user, a, { d }, step, `${acc} changed into the tenant's name`);
      }
      case 'handoverDate': {
        this.needTeam(user, 'agrees the handover date');
        if (!isDate(i.on)) throw new BadRequest('Give the agreed handover date.');
        d.handoverOn = i.on;
        return this.save(user, a, { d }, step, `handover on ${i.on}`);
      }
      default:
        throw new BadRequest('Unknown application step.');
    }
  }
  /** V48: what stops the keys being handed over. */
  async keysGate(a: RentRec): Promise<string[]> {
    const d = a.d as Record<string, any>;
    const miss: string[] = [];
    if (a.status !== 'LULUS') miss.push('approval and consent');
    if (!d.depositFull) miss.push('deposit and first month confirmed in full by Finance');
    const ag = (await this.all('agreement')).find((x) => D<{ appId: Id }>(x).appId === a.id);
    if (!ag || !['DISERAHKAN', 'DIFAILKAN'].includes(ag.status)) miss.push('agreement signed, stamped and the copy given');
    const info = await this.infoOf(a.unitId!);
    for (const acc of ['TNB', 'AIR', ...(D<{ indahWaterOwn?: boolean }>(info ?? ({ d: {} } as RentRec)).indahWaterOwn === false ? [] : ['IWK'])]) if (!d.utilities?.[acc]) miss.push(`${acc} proof`);
    if (!d.handoverOn) miss.push('handover date agreed');
    return miss;
  }
  private async keys(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'hands over the keys');
    const a = await this.get(i.id, 'application');
    if (a.status === 'DISERAH') throw new BadRequest('The keys are already handed over.');
    const miss = await this.keysGate(a);
    if (miss.length) {
      if (!(this.director(user) && s(i.override, 300).length >= 10)) throw new BadRequest(`Keys not yet: ${miss.join('; ')}.`);
    }
    const keys = Array.isArray(i.keys) ? (i.keys as Record<string, unknown>[]).map((k) => ({ item: s(k.item, 60), count: Math.max(0, Math.floor(Number(k.count) || 0)) })).filter((k) => k.item && k.count > 0) : [];
    if (!keys.length) throw new BadRequest('List the keys and items handed over, with counts.');
    const photos = this.needProof(user, i.photos, 'the handover photos', 'Serahan');
    const ack = this.needProof(user, i.tenantAck, "the tenant's signed acknowledgement of the keys", 'Akuan kunci');
    const d = structuredClone(a.d) as Record<string, any>;
    const u = await this.unit(a.unitId);
    const ag = (await this.all('agreement')).find((x) => D<{ appId: Id }>(x).appId === a.id);
    const f = (ag?.d.fields ?? {}) as Record<string, any>;
    const startOn: IsoDate = f.startOn ?? d.handoverOn ?? this.today();
    const months = Number(f.termMonths ?? 12);
    const tenancy: AmTenancy = {
      tenant: d.type === 'COMPANY' ? d.applicant.name : d.applicant.name,
      internal: false,
      startOn,
      endOn: addDays(addDays(startOn, Math.round(months * 30.4375)), -1),
      rent: Number(f.rent ?? d.dpr?.rent ?? u.askingRent),
      deposit: Number(f.deposit ?? d.dpr?.deposit ?? 0),
      utilityDeposit: 0,
      stamped: ag?.status === 'DISETEM' || ag?.status === 'DISERAHKAN' || ag?.status === 'DIFAILKAN' ? !!ag?.d.stamp && !!(ag.d.stamp as Record<string, unknown>).certAt : false,
      tenantPhone: d.applicant.phone || null,
      tenantEmail: d.applicant.email || null,
      lastContactOn: this.today(),
      invoices: [],
      payments: [],
      followUps: [],
      rentalAppId: a.id,
      noticeDays: Number(f.noticeDays ?? RULES.amRental.value.noticeDays),
      depositPayers: (d.deposits as { amount: number; payer: string; payerName: string }[]).map((x) => ({ amount: x.amount, payer: x.payer, payerName: x.payerName })),
    };
    d.handover = { at: this.now(), by: user.name, keys, override: miss.length ? { gaps: miss, reason: s(i.override, 300) } : null };
    const listing = (await this.all('listing')).find((l) => l.id === d.listingId);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('amUnits', u.id);
      await tx.update('amUnits', u.id, { tenancy, status: 'let', vacantSince: null });
      const next = await this.save(user, a, { status: 'DISERAH', d, proof: [...a.proof, ...photos, ...ack] }, 'keys', `keys handed over${miss.length ? ` (Asset Director override: ${miss.join('; ')})` : ''}`, tx);
      if (listing) {
        const log = [...((listing.d.statusLog as unknown[]) ?? []), { to: 'TELAH_DISEWA', at: this.now(), by: user.name }];
        await this.save(user, listing, { status: 'TELAH_DISEWA', d: { ...listing.d, statusLog: log, letAt: this.now(), appId: a.id } }, 'let', 'Telah Disewa; take every advert down today', tx);
      }
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.rental.tenancy', entity: 'am_unit', entityId: u.id, summary: `${u.code}: tenancy from ${startOn} at RM${tenancy.rent}` });
      return next;
    });
  }
  /** V22: unsuccessful applications are cleared of personal data after 6 months (the decision record stays). */
  private async purge(user: User) {
    this.needTeam(user, 'clears old applications');
    const months = (await this.settings()).v.applicationDeleteMonths;
    const cut = addDays(this.today(), -Math.round(months * 30.4375));
    const old = (await this.all('application')).filter((a) => a.status === 'TIDAK_LULUS' && a.at.slice(0, 10) <= cut && !a.d.purged);
    let n = 0;
    for (const a of old) {
      const d = a.d as Record<string, any>;
      await this.save(user, a, { d: { type: d.type, appliedOn: d.appliedOn, decision: d.decision ? { approve: d.decision.approve, by: d.decision.by, at: d.decision.at } : null, consent: d.consent ? { yes: d.consent.yes, by: d.consent.by } : null, purged: { at: this.now(), by: user.name } }, proof: [] }, 'purge', `personal data cleared after ${months} months`);
      n++;
    }
    return { cleared: n };
  }

  // =================================================================================================================
  // 3. Agreement and stamping (V51-V57, V74-V77, V-X23, V-X24, V-X30)
  // =================================================================================================================

  private async agreementOpen(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'prepares agreements');
    const a = await this.get(i.appId, 'application');
    const d = a.d as Record<string, any>;
    if (!d.depositFull) throw new BadRequest(d.dpr ? `The agreement opens only after Finance confirms the deposit in full (RM${d.dpr.total}).` : 'The agreement opens only after the deposit request is paid and confirmed by Finance.');
    if ((await this.all('agreement')).some((x) => D<{ appId: Id }>(x).appId === a.id)) throw new BadRequest('This application already has an agreement.');
    const st = await this.settings();
    const tpl = (st.templates.agreement ?? []).at(-1);
    if (!tpl) throw new BadRequest('The Asset Director uploads the standard agreement template first.');
    const u = await this.unit(a.unitId);
    const owner = await this.ownerOf(u);
    if (!owner) throw new BadRequest(`Record the owner company ${u.ownerEntity} first.`);
    const listing = (await this.all('listing')).find((l) => l.id === d.listingId);
    const t = D<{ terms?: { termMonths: number; use: string; renewal: string } }>(listing ?? ({ d: {} } as RentRec)).terms;
    const info = await this.infoOf(u.id);
    const startOn: IsoDate = d.handoverOn ?? d.moveInOn ?? addDays(this.today(), 7);
    const termMonths = Number(t?.termMonths ?? 12);
    const od = owner.d as Record<string, string>;
    const fields = {
      owner: od.ownerEntity,
      ownerNo: od.companyNo,
      bankName: od.bankName,
      bankAccount: od.bankAccount,
      tenant: d.applicant.name,
      tenantId: d.type === 'COMPANY' ? d.company.ssmNo : d.applicant.ic,
      premises: D<{ address?: string }>(info ?? ({ d: {} } as RentRec)).address || `${u.name}, ${u.town}, ${u.state}`,
      termMonths,
      startOn,
      endOn: addDays(addDays(startOn, Math.round(termMonths * 30.4375)), -1),
      rent: d.dpr.rent,
      deposit: d.dpr.deposit,
      advance: d.dpr.advance,
      total: d.dpr.total,
      depositPaidOn: d.deposits.at(-1)?.on ?? null,
      use: t?.use ?? 'untuk kediaman sahaja',
      renewal: t?.renewal || '12 bulan; sewa ditetapkan pemilik atau kadar pasaran',
      payment: 'Sewa dibayar terdahulu mulai 25 haribulan dan tidak lewat 10 haribulan setiap bulan.',
      noticeDays: RULES.amRental.value.noticeDays,
    };
    const ad = { appId: a.id, template: tpl.v, fields, approved: structuredClone(fields), versions: [{ v: 1, at: this.now(), by: user.name, fields }], changes: [] as unknown[], comments: [] as unknown[], checkNeeded: false, sign: {} as Record<string, unknown>, stamp: null };
    return this.create(user, 'agreement', `AGR-${u.code}`, { unitId: u.id, status: 'DRAF', d: ad }, `${u.code}: draft from template v${tpl.v}`);
  }
  /** V74: the earlier of LHDN's 30 days from submitting and the s.47A 30 days from signing. */
  stampDeadline(ag: RentRec): IsoDate | null {
    const sign = (ag.d.sign as { signedOn?: IsoDate }) ?? {};
    const st = (ag.d.stamp as { submittedOn?: IsoDate }) ?? {};
    const days = RULES.amRental.value.stampDeadlineDays;
    const list = [sign.signedOn ? addDays(sign.signedOn, days) : null, st.submittedOn ? addDays(st.submittedOn, days) : null].filter(Boolean) as IsoDate[];
    return list.sort()[0] ?? null;
  }
  private async agreementStep(user: User, i: Record<string, unknown>) {
    const ag = await this.get(i.id, 'agreement');
    const step = s(i.step, 30);
    const d = structuredClone(ag.d) as Record<string, any>;
    const note = s(i.note, 400);
    const u = await this.unit(ag.unitId);
    const order = AGREEMENT_STATUSES as readonly string[];
    const atLeast = (st: string) => order.indexOf(ag.status) >= order.indexOf(st);
    const owner = await this.ownerOf(u);
    switch (step) {
      case 'change': {
        // V53 / V-X24: a change is proposed, the Asset Director approves; rent, deposit or term also needs consent.
        this.needTeam(user, 'proposes agreement changes');
        if (atLeast('VERSI_AKHIR')) throw new BadRequest('The final version is set; no more changes.');
        const field = s(i.field, 30);
        if (!(field in d.fields) || ['owner', 'ownerNo', 'bankName', 'bankAccount'].includes(field)) throw new BadRequest('That field is filled by Prima from the records and cannot be changed here.');
        d.changes.push({ n: d.changes.length + 1, field, value: i.value, why: this.reason(note, 'why (and whether the tenant asked)'), tenantAsked: bool(i.tenantAsked), by: user.name, byId: user.id, at: this.now(), decision: null, consent: null });
        return this.save(user, ag, { d, status: ag.status === 'DIHANTAR' ? 'PINDAAN' : ag.status }, step, `change to ${field} proposed`);
      }
      case 'changeDecide':
      case 'changeConsent': {
        const c = d.changes.find((x: { n: number }) => x.n === Number(i.n));
        if (!c) throw new NotFound('Change');
        const money = ['rent', 'deposit', 'advance', 'total', 'termMonths', 'startOn', 'endOn'].includes(c.field);
        if (step === 'changeDecide') {
          this.needDirector(user, 'approves agreement changes');
          if (c.byId === user.id) throw new BadRequest('You proposed this change, so someone else approves it.');
          if (c.decision) throw new BadRequest('Already decided.');
          c.decision = { approve: bool(i.approve), note: requireApprovalReason(note), by: user.name, byId: user.id, at: this.now() };
        } else {
          if (!this.chairVc(user)) throw new AccessDenied('view', '(the Chairman or Vice Chairman consents to a change of rent, deposit or term)');
          if (!money || !c.decision?.approve || c.consent) throw new BadRequest('No change waiting for consent.');
          c.consent = { yes: i.consent !== false, note: requireApprovalReason(note, 'consent'), by: user.name, at: this.now() };
        }
        const applies = c.decision?.approve && (!money || c.consent?.yes);
        if (applies && !c.applied) {
          d.fields[c.field] = typeof d.fields[c.field] === 'number' ? m2(c.value) : s(c.value, 300);
          c.applied = true;
          d.checkNeeded = true;
          d.versions.push({ v: d.versions.length + 1, at: this.now(), by: user.name, fields: structuredClone(d.fields) });
        }
        return this.save(user, ag, { d }, step, `change ${c.n} ${applies ? 'applied (supervisor check needed)' : c.decision?.approve ? 'waiting for consent' : 'refused'}`);
      }
      case 'check': {
        // V52: the supervisor's check (a senior in the team, not the preparer) is required when anything differs.
        this.needTeam(user, 'checks drafts');
        if (ag.byId === user.id) throw new BadRequest('The supervisor check is by someone other than the preparer.');
        d.checkNeeded = false;
        d.checked = { by: user.name, byId: user.id, at: this.now(), v: d.versions.length };
        return this.save(user, ag, { d }, step, `supervisor checked v${d.versions.length}`);
      }
      case 'send': {
        this.needTeam(user, 'sends drafts');
        const edited = Object.keys(d.fields).some((k) => JSON.stringify(d.fields[k]) !== JSON.stringify(d.approved[k]));
        if ((d.checkNeeded || edited) && !(d.checked && d.checked.v === d.versions.length)) throw new BadRequest('A field differs from the approved application: the supervisor checks the draft before it is sent.');
        if (d.changes.some((c: { decision: unknown; applied?: boolean; field: string; consent: unknown }) => !c.decision || (c.decision && !c.applied && (c as { decision: { approve: boolean } }).decision.approve))) throw new BadRequest('A change is still waiting for a decision.');
        const p = this.needProof(user, i.proof, 'proof the draft was sent (email or WhatsApp)', `Draf v${d.versions.length} dihantar`);
        return this.save(user, ag, { status: 'DIHANTAR', d, proof: [...ag.proof, ...p] }, step, `v${d.versions.length} sent to the tenant`);
      }
      case 'comment': {
        this.needTeam(user, 'records tenant comments');
        d.comments.push({ at: this.now(), by: user.name, text: this.reason(note, "the tenant's comment") });
        return this.save(user, ag, { status: 'PINDAAN', d }, step, 'tenant comment recorded');
      }
      case 'final': {
        this.needTeam(user, 'marks the final version');
        if (ag.status !== 'DIHANTAR' && ag.status !== 'PINDAAN') throw new BadRequest('Send the draft to the tenant first.');
        if (d.changes.some((c: { decision: unknown; applied?: boolean; consent: unknown; field: string }) => !c.decision)) throw new BadRequest('A change is still waiting for the Asset Director.');
        if (d.checkNeeded && !(d.checked && d.checked.v === d.versions.length)) throw new BadRequest('The supervisor checks the changed draft first.');
        if (d.fields.rent !== d.approved.rent && !d.changes.some((c: { field: string; consent?: { yes: boolean } }) => c.field === 'rent' && c.consent?.yes)) throw new BadRequest('The rent differs from the approved rent without consent.');
        d.finalV = d.versions.length;
        return this.save(user, ag, { status: 'VERSI_AKHIR', d }, step, `v${d.finalV} untuk ditandatangani`);
      }
      case 'sign': {
        // V54 / V-X23: tenant + witness; the owner's authorised signatory + a witness (not the signatory).
        this.needTeam(user, 'records signatures');
        if (!atLeast('VERSI_AKHIR')) throw new BadRequest('Sign only the final version.');
        const party = i.party === 'OWNER' ? 'OWNER' : 'TENANT';
        const signer = s(i.signer, 120);
        const witness = s(i.witness, 120);
        if (!signer || !witness) throw new BadRequest('Give who signed and who witnessed.');
        if (signer.toLowerCase() === witness.toLowerCase()) throw new BadRequest('A witness cannot be the person signing.');
        const electronic = bool(i.electronic);
        if (electronic && !(owner?.d as { eSignAllowed?: boolean })?.eSignAllowed) throw new BadRequest('E-signing is not allowed for this owner company (setting, with the lawyer\'s confirmation).');
        if (party === 'OWNER') {
          const sigs = ((owner?.d as { signatories?: { name: string; kind: string; authorityOn: IsoDate | null }[] })?.signatories ?? []);
          const sg = sigs.find((x) => x.name.toLowerCase() === signer.toLowerCase());
          if (!sg) throw new BadRequest(`${signer} is not a recorded signatory of ${u.ownerEntity}.`);
          if (sg.kind === 'ASSET_DIRECTOR' && (!sg.authorityOn || sg.authorityOn > this.today())) throw new BadRequest("The Asset Director's written authority from the owner company is not in force.");
        }
        const p = this.needProof(user, i.proof, 'the signed copy (scan or e-signed file)', `Tandatangan ${party}`);
        d.sign[party] = { signer, witness, electronic, at: this.now(), on: isDate(i.on) ? i.on : this.today(), by: user.name };
        const both = d.sign.TENANT && d.sign.OWNER;
        if (both) d.sign.signedOn = [d.sign.TENANT.on, d.sign.OWNER.on].sort().at(-1);
        const status = both ? 'LENGKAP' : party === 'TENANT' ? 'DITANDATANGANI_PENYEWA' : 'DITANDATANGANI_PEMILIK';
        return this.save(user, ag, { status, d, proof: [...ag.proof, ...p] }, step, `${party.toLowerCase()} signed`);
      }
      case 'edsSubmit': {
        // V74: submitted in e-Duti Setem by staff the owner company named; the assessed duty from LHDN's summary.
        this.needTeam(user, 'submits for stamping');
        if (ag.status !== 'LENGKAP') throw new BadRequest('Stamping starts only when the agreement is signed by both sides.');
        const od = (owner?.d ?? {}) as { edsRole?: boolean; edsStaffIds?: Id[] };
        if (!od.edsRole) throw new BadRequest(`${u.ownerEntity} has no "Firma / Syarikat Berdaftar" role recorded in e-Duti Setem.`);
        if (!(od.edsStaffIds ?? []).includes(user.id)) throw new BadRequest(`You are not named to use ${u.ownerEntity}'s e-Duti Setem role.`);
        const ticks = (i.sheet ?? {}) as Record<string, unknown>;
        for (const k of ['state', 'date', 'landlord', 'tenant', 'copies', 'description', 'rent', 'address', 'type', 'file']) if (!bool(ticks[k])) throw new BadRequest(`Tick each line of the LHDN fill sheet: ${k} not ticked.`);
        const assessed = m2(i.assessedDuty);
        const lhdnRef = s(i.lhdnRef, 60);
        if (!(assessed >= 0) || !lhdnRef || !isDate(i.submittedOn)) throw new BadRequest('Give the submission date, the LHDN reference and the duty assessed by LHDN.');
        const p = this.needProof(user, i.proof, 'the confirmation slip and the assessment summary', 'e-DS');
        d.stamp = { submittedOn: i.submittedOn, lhdnRef, assessed, by: user.name, at: this.now(), notice: null, tenantProof: null, confirmed: null, paid: null, certAt: null, issues: [] };
        return this.save(user, ag, { status: 'SEDIA_BAYARAN', d, proof: [...ag.proof, ...p] }, step, `submitted ${lhdnRef}; duty RM${assessed}`);
      }
      case 'stampNotice': {
        this.needTeam(user, 'sends the stamp duty notice');
        if (ag.status !== 'SEDIA_BAYARAN') throw new BadRequest('Submit in e-Duti Setem first.');
        const p = this.needProof(user, i.proof, 'proof the notice was sent', 'Notis duti setem');
        d.stamp.notice = { at: this.now(), by: user.name, amount: d.stamp.assessed, bank: (owner?.d as { bankAccount?: string })?.bankAccount ?? null };
        return this.save(user, ag, { status: 'NOTIS_DIHANTAR', d, proof: [...ag.proof, ...p] }, step, `notice RM${d.stamp.assessed} sent; 24 hours to pay`);
      }
      case 'stampTenantProof': {
        this.needTeam(user, "records the tenant's proof");
        if (ag.status !== 'NOTIS_DIHANTAR') throw new BadRequest('Send the stamp duty notice first.');
        const amount = m2(i.amount);
        const p = this.needProof(user, i.proof, "the tenant's proof", 'Bukti duti penyewa');
        d.stamp.tenantProof = { at: this.now(), by: user.name, amount, mismatch: Math.abs(amount - d.stamp.assessed) > 0.001 };
        return this.save(user, ag, { status: 'BUKTI_PENYEWA', d, proof: [...ag.proof, ...p] }, step, d.stamp.tenantProof.mismatch ? `amount RM${amount} differs from the assessed RM${d.stamp.assessed}: held` : 'proof recorded (not money received)');
      }
      case 'stampConfirm': {
        // V-X30: Finance confirms the tenant's money in the bank before anything is paid to LHDN.
        this.needFinance(user, "confirms the tenant's stamp duty money");
        if (ag.status !== 'BUKTI_PENYEWA') throw new BadRequest("Record the tenant's proof first.");
        const amount = m2(i.amount);
        if (Math.abs(amount - d.stamp.assessed) > 0.001) throw new BadRequest(`The money in the bank (RM${amount}) differs from the assessed duty (RM${d.stamp.assessed}): resolve it before paying LHDN.`);
        const bankRef = s(i.bankRef, 60);
        if (!bankRef) throw new BadRequest('Give the bank statement reference.');
        d.stamp.confirmed = { at: this.now(), by: user.name, amount, bankRef };
        return this.save(user, ag, { status: 'BAYARAN_DISAHKAN', d }, step, "tenant's stamp duty confirmed in the bank");
      }
      case 'stampPay': {
        this.needFinance(user, 'pays LHDN');
        if (ag.status !== 'BAYARAN_DISAHKAN') throw new BadRequest("LHDN is paid only after Finance confirms the tenant's money in the bank.");
        if (Math.abs(m2(i.amount) - d.stamp.assessed) > 0.001) throw new BadRequest('Pay exactly the assessed duty.');
        const method = s(i.method, 30);
        if (!['FPX_BYRHASIL', 'VIRTUAL_ACCOUNT', 'CORPORATE_BANKING'].includes(method)) throw new BadRequest('Pick the payment method (FPX ByrHasil, virtual account or corporate internet banking).');
        const p = this.needProof(user, i.proof, 'the LHDN payment proof', 'Bayaran LHDN');
        d.stamp.paid = { at: this.now(), by: user.name, on: this.today(), method, keepUntil: addDays(this.today(), 365 * RULES.amRental.value.stampKeepYears + 2) };
        return this.save(user, ag, { status: 'DIBAYAR_LHDN', d, proof: [...ag.proof, ...p] }, step, 'paid to LHDN');
      }
      case 'stampCert': {
        this.needTeam(user, 'uploads the stamp certificate');
        if (ag.status !== 'DIBAYAR_LHDN') throw new BadRequest('Pay LHDN first.');
        const ticks = (i.checks ?? {}) as Record<string, unknown>;
        for (const k of ['names', 'premises', 'date', 'amount', 'readable']) if (!bool(ticks[k])) throw new BadRequest(`Check the certificate: ${k}.`);
        const p = this.needProof(user, i.proof, 'the stamp certificate and the stamped agreement', 'Sijil setem');
        d.stamp.certAt = this.now();
        d.stamp.certRef = s(i.certRef, 60);
        return this.store.transaction(async (tx) => {
          const next = await this.save(user, ag, { status: 'DISETEM', d, proof: [...ag.proof, ...p] }, step, `Disetem ${d.stamp.certRef}`, tx);
          // V24: "stamped" on a tenancy comes only from here.
          const cur = await tx.get('amUnits', u.id);
          if (cur?.tenancy && cur.tenancy.rentalAppId === d.appId) await tx.update('amUnits', u.id, { tenancy: { ...cur.tenancy, stamped: true } });
          return next;
        });
      }
      case 'lhdnIssue': {
        this.needTeam(user, 'records LHDN issues');
        if (!d.stamp) throw new BadRequest('Not submitted yet.');
        d.stamp.issues.push({ at: this.now(), by: user.name, text: this.reason(note, 'what LHDN said or what failed'), supervisorTold: bool(i.supervisorTold) });
        return this.save(user, ag, { d }, step, 'Isu LHDN');
      }
      case 'handover': {
        this.needTeam(user, 'gives the stamped copy');
        if (ag.status !== 'DISETEM') throw new BadRequest('Give the copy after it is stamped.');
        const p = this.needProof(user, i.proof, 'proof the stamped copy and start date were sent', 'Salinan bersetem');
        d.given = { at: this.now(), by: user.name, message: `Penyewaan bermula ${d.fields.startOn}; sewa RM${d.fields.rent}; bayar 25hb hingga 10hb.` };
        return this.save(user, ag, { status: 'DISERAHKAN', d, proof: [...ag.proof, ...p] }, step, 'stamped copy given with the start date');
      }
      case 'file': {
        this.needTeam(user, 'files agreements');
        if (ag.status !== 'DISERAHKAN') throw new BadRequest('Give the copy to the tenant first.');
        d.filed = { at: this.now(), by: user.name, where: this.reason(i.where, 'where the original is kept (file / cabinet)') };
        return this.save(user, ag, { status: 'DIFAILKAN', d }, step, `filed at ${d.filed.where}`);
      }
      default:
        throw new BadRequest('Unknown agreement step.');
    }
  }

  // =================================================================================================================
  // 4. Monthly collection, zakat, bank lines (V58-V63, V28, V-X13, V-X25, V-X26, V-X29)
  // =================================================================================================================

  /** The zakat approval in force for a unit and month. */
  async zakatFor(unitId: Id, period: string) {
    return (await this.all('zakat')).find((z) => z.unitId === unitId && z.status === 'active' && String(z.d.from) <= `${period}-31` && String(z.d.to) >= `${period}-01`) ?? null;
  }
  /** The payment window end for a period's invoice: the 10th of that month (window 25th of the month before to the 10th). */
  windowEnd(period: string, v = RULES.amRental.value) {
    return `${period}-${String(v.windowToDay).padStart(2, '0')}` as IsoDate;
  }
  /** V-X29: what the tenant owes for a month: their part, plus any zakat shortfall once the window has closed. */
  tenantOwes(c: RentRec, today: IsoDate) {
    const d = c.d as Record<string, any>;
    const zPaid = m2((d.confirmed ?? []).filter((x: { payer: string }) => x.payer === 'ZAKAT').reduce((n: number, x: { amount: number }) => n + x.amount, 0));
    const tPaid = m2((d.confirmed ?? []).filter((x: { payer: string }) => x.payer !== 'ZAKAT').reduce((n: number, x: { amount: number }) => n + x.amount, 0));
    const shortfall = today > this.windowEnd(d.period) ? Math.max(0, m2(d.zakatPart - zPaid)) : 0;
    return { tenantPart: d.tenantPart, zakatPart: d.zakatPart, zPaid, tPaid, shortfall, owes: Math.max(0, m2(d.tenantPart + shortfall - tPaid)) };
  }
  private async collectionOf(unitId: Id, period: string) {
    return (await this.all('collection')).find((c) => c.unitId === unitId && c.d.period === period) ?? null;
  }
  /** V58: Finance records the SQL Account invoice; it must equal the tenancy (tenant, premises, period, amount). */
  private async invoice(user: User, i: Record<string, unknown>) {
    this.needFinance(user, 'records rent invoices');
    const u = await this.unit(i.unitId);
    if (!u.tenancy) throw new BadRequest(`${u.code} has no tenant.`);
    const period = s(i.period, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequest('Give the rent month (YYYY-MM).');
    if (await this.collectionOf(u.id, period)) throw new BadRequest(`${u.code} already has the ${period} invoice.`);
    const invoiceNo = s(i.invoiceNo, 40);
    if (!invoiceNo || !isDate(i.invoiceOn)) throw new BadRequest('Give the SQL Account invoice number and date.');
    const amount = m2(i.amount);
    const flags: string[] = [];
    if (Math.abs(amount - u.tenancy.rent) > 0.001) {
      if (s(i.differenceNote, 300).length < 5) throw new BadRequest(`The invoice (RM${amount}) differs from the tenancy rent (RM${u.tenancy.rent}). Correct it in SQL Account, or explain the difference (it is flagged to Finance and the Asset Director).`);
      flags.push(`amount RM${amount} vs rent RM${u.tenancy.rent}: ${s(i.differenceNote, 300)}`);
    }
    if (s(i.tenant, 160) && s(i.tenant, 160).toLowerCase() !== u.tenancy.tenant.toLowerCase()) flags.push('tenant name differs');
    const z = await this.zakatFor(u.id, period);
    const zakatPart = z ? Math.min(amount, m2(z.d.monthly)) : 0;
    const v = (await this.settings()).v;
    const day = Number(String(i.invoiceOn).slice(8, 10));
    const late = String(i.invoiceOn) > `${addDays(`${period}-01`, -1).slice(0, 8)}${String(v.invoiceByDay).padStart(2, '0')}` || day < v.invoiceFromDay && String(i.invoiceOn).slice(0, 7) !== period;
    const d = { period, invoiceNo, invoiceOn: i.invoiceOn, amount, zakatPart, tenantPart: m2(amount - zakatPart), zakatId: z?.id ?? null, flags, late, recordedAt: this.now(), sentAt: null, proofs: [], confirmed: [], semakan: null, receipts: [], bounced: [] };
    const tenancy = u.tenancy;
    return this.store.transaction(async (tx) => {
      const r = await this.create(user, 'collection', `KUT-${u.code}-${period}`, { unitId: u.id, status: 'INVOIS_DIKELUARKAN', d, ref: `KUT-${u.code}-${period}` }, `${invoiceNo} RM${amount}${flags.length ? ' (flagged)' : ''}`);
      if (!tenancy.invoices.some((x) => x.period === period)) await tx.update('amUnits', u.id, { tenancy: { ...tenancy, invoices: [...tenancy.invoices, { period, amount, paid: 0, paidOn: null }] } });
      return r;
    });
  }
  /** Apply confirmed money to the tenancy's invoices, oldest unpaid first (V62). */
  private applyMoney(t: AmTenancy, amount: number, on: IsoDate): { invoices: AmTenancy['invoices']; applied: { period: string; amount: number }[]; left: number } {
    let left = m2(amount);
    const applied: { period: string; amount: number }[] = [];
    const invoices = [...t.invoices]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((x) => {
        const take = Math.min(left, Math.max(0, m2(x.amount - x.paid)));
        if (take <= 0) return x;
        left = m2(left - take);
        applied.push({ period: x.period, amount: take });
        return { ...x, paid: m2(x.paid + take), paidOn: on };
      });
    return { invoices, applied, left };
  }
  private async confirmMoney(user: User, c: RentRec, u: AmUnit, x: { amount: number; on: IsoDate; bankRef: string; payer: 'TENANT' | 'ZAKAT'; method: AmPayment['method']; cheque?: unknown }, tx: Store) {
    // Review of PR #141 (B1): one bank credit is counted as rent once. A statement reference already on a payment that
    // is not reversed, for any unit of the same owner company, is refused.
    const ref = x.bankRef.trim().toUpperCase();
    await tx.lock?.('amUnits', `bankref:${u.ownerEntity}:${ref}`);
    const sameOwner = (await tx.list('amUnits', {})).filter((o) => o.ownerEntity === u.ownerEntity);
    const used = sameOwner.find((o) => (o.tenancy?.payments ?? []).some((p) => !p.reversed && (p.ref ?? '').trim().toUpperCase() === ref));
    if (used) throw new BadRequest(`Bank reference ${x.bankRef} is already confirmed as a payment (${used.code}). One bank credit is counted once.`);
    const cur = (await tx.get('amUnits', u.id))!;
    const t = cur.tenancy!;
    const { invoices, applied, left } = this.applyMoney(t, x.amount, x.on);
    if (left > 0.001) throw new BadRequest(`RM${left} more than is billed; Finance handles any advance.`);
    const pay: AmPayment = { id: `pay-${u.id}-${toMs(this.now())}-${(t.payments ?? []).length + 1}`, on: x.on, amount: x.amount, method: x.method, receiptNo: `RN-${u.code}-${String((t.payments ?? []).length + 1).padStart(4, '0')}`, ref: x.bankRef, applied, by: user.name, at: this.now(), banked: { on: this.today(), slipRef: x.bankRef, by: user.name }, reversal: null, reversed: null, officialReceiptNo: null };
    await tx.update('amUnits', u.id, { tenancy: { ...t, invoices, payments: [...(t.payments ?? []), pay], lastContactOn: this.today() } });
    return { paymentId: pay.id, applied };
  }
  private async collectionStep(user: User, i: Record<string, unknown>) {
    const c = await this.get(i.id, 'collection');
    const step = s(i.step, 30);
    const d = structuredClone(c.d) as Record<string, any>;
    const u = await this.unit(c.unitId);
    switch (step) {
      case 'sent': {
        // V59: sent to the tenancy's contact (Prima picks it), with proof, within 24 hours.
        this.needTeam(user, 'sends invoices');
        const channel = i.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
        const to = channel === 'EMAIL' ? u.tenancy?.tenantEmail : u.tenancy?.tenantPhone;
        if (!to) throw new BadRequest(`The tenancy has no ${channel === 'EMAIL' ? 'email' : 'phone'}; update the tenancy contact first.`);
        const p = this.needProof(user, i.proof, 'proof of sending', `Invois ${d.period} dihantar`);
        d.sentAt = this.now();
        d.sentTo = { channel, to };
        return this.save(user, c, { status: c.status === 'INVOIS_DIKELUARKAN' ? 'INVOIS_DIHANTAR' : c.status, d, proof: [...c.proof, ...p] }, step, `sent by ${channel.toLowerCase()}`);
      }
      case 'proof': {
        // V60: the tenant's proof is recorded; it is never money received.
        this.needTeam(user, "records the tenant's proof");
        const method = ['TRANSFER', 'FPX', 'CDM', 'CHEQUE'].find((m) => m === i.method);
        if (!method) throw new BadRequest('Pick how it was paid: transfer, FPX, CDM (slip) or cheque. Cash is not accepted for rent.');
        if (!isDate(i.on) || !(m2(i.amount) > 0)) throw new BadRequest('Give the amount and the payment date.');
        if (method === 'CHEQUE' && (!s(i.chequeNo, 20) || !s(i.chequeBank, 60))) throw new BadRequest('Give the cheque number and bank.');
        const p = this.needProof(user, i.proof, method === 'CDM' ? 'the CDM slip' : "the tenant's proof", `${u.tenancy?.tenant ?? ''} ${u.code} SEWA ${d.period}`);
        d.proofs.push({ n: d.proofs.length + 1, at: this.now(), by: user.name, method, amount: m2(i.amount), on: i.on, ref: s(i.ref, 60), months: Array.isArray(i.months) ? i.months : [d.period], cheque: method === 'CHEQUE' ? { no: s(i.chequeNo, 20), bank: s(i.chequeBank, 60), date: i.on, cleared: false } : null, payer: i.payer === 'ZAKAT' ? 'ZAKAT' : 'TENANT' });
        return this.save(user, c, { status: ['INVOIS_DIKELUARKAN', 'INVOIS_DIHANTAR'].includes(c.status) ? 'BUKTI_DITERIMA' : c.status, d, proof: [...c.proof, ...p] }, step, `Bukti diterima RM${m2(i.amount)} (${method})`);
      }
      case 'confirm': {
        // V61: only Finance confirms, from the owner company's bank; a cheque only when cleared.
        this.needFinance(user, 'confirms rent in the bank');
        const result = s(i.result, 20);
        const pr = d.proofs.find((x: { n: number }) => x.n === Number(i.n)) ?? null;
        if (result === 'DALAM_SEMAKAN') {
          d.semakan = { since: d.semakan?.since ?? this.now(), by: user.name, note: this.reason(i.note, 'what does not match'), contact: null };
          return this.save(user, c, { status: 'DALAM_SEMAKAN', d }, step, 'Dalam Semakan');
        }
        const amount = m2(i.amount);
        const bankRef = s(i.bankRef, 60);
        if (!(amount > 0) || !bankRef || !isDate(i.on)) throw new BadRequest('Give the amount, date and reference seen in the bank.');
        if (pr?.cheque && !bool(i.cleared)) throw new BadRequest('A cheque counts only when it has cleared in the bank.');
        const payer = i.payer === 'ZAKAT' ? 'ZAKAT' : pr?.payer === 'ZAKAT' ? 'ZAKAT' : 'TENANT';
        const method: AmPayment['method'] = pr?.method === 'CHEQUE' ? 'CHEQUE' : pr?.method === 'CDM' ? 'CDM' : pr?.method === 'FPX' ? 'ONLINE' : 'TRANSFER';
        return this.store.transaction(async (tx) => {
          const res = await this.confirmMoney(user, c, u, { amount, on: i.on as IsoDate, bankRef, payer, method }, tx);
          if (pr?.cheque) pr.cheque.cleared = true;
          d.confirmed.push({ n: d.confirmed.length + 1, proofN: pr?.n ?? null, amount, on: i.on, bankRef, payer, at: this.now(), by: user.name, paymentId: res.paymentId, applied: res.applied, receiptNo: null });
          d.semakan = null;
          return this.save(user, c, { status: 'DISAHKAN_KEWANGAN', d }, step, `Disahkan Kewangan RM${amount} (${payer.toLowerCase()})`, tx);
        });
      }
      case 'semakanContact': {
        this.needTeam(user, 'contacts the tenant');
        if (!d.semakan) throw new BadRequest('Not in Dalam Semakan.');
        d.semakan.contact = { at: this.now(), by: user.name, answer: this.reason(i.answer, "the tenant's answer") };
        return this.save(user, c, { d }, step, 'tenant contacted');
      }
      case 'bounce': {
        this.needFinance(user, 'records a bounced cheque');
        const cf = d.confirmed.find((x: { n: number }) => x.n === Number(i.n));
        if (!cf) throw new NotFound('Confirmation');
        return this.store.transaction(async (tx) => {
          const cur = (await tx.get('amUnits', u.id))!;
          const t = cur.tenancy!;
          const invoices = t.invoices.map((x) => {
            const back = (cf.applied as { period: string; amount: number }[]).find((a) => a.period === x.period)?.amount ?? 0;
            return back ? { ...x, paid: Math.max(0, m2(x.paid - back)), paidOn: x.paid - back > 0 ? x.paidOn : null } : x;
          });
          const payments = (t.payments ?? []).map((p) => (p.id === cf.paymentId ? { ...p, reversed: { by: user.name, at: this.now(), reason: 'cheque bounced' } } : p));
          await tx.update('amUnits', u.id, { tenancy: { ...t, invoices, payments, followUps: [...(t.followUps ?? []), { id: `fu-${u.id}-${toMs(this.now())}`, on: this.today(), action: 'NOTE', note: `Cek ${cf.bankRef} tidak laku`, promiseOn: null, by: user.name, at: this.now(), approval: null }] } });
          d.bounced.push({ ...cf, at: this.now(), by: user.name });
          d.confirmed = d.confirmed.filter((x: { n: number }) => x.n !== cf.n);
          return this.save(user, c, { status: 'BUKTI_DITERIMA', d }, step, 'cheque bounced: month re-opened', tx);
        });
      }
      case 'receipt': {
        // V62 / V-X26: Finance issues the official receipt(s); a zakat tenant gets two (zakat body's part, tenant's part).
        this.needFinance(user, 'issues official receipts');
        const open = d.confirmed.filter((x: { receiptNo: string | null }) => !x.receiptNo);
        if (!open.length) throw new BadRequest('No confirmed payment waiting for a receipt.');
        return this.store.transaction(async (tx) => {
          const cur = (await tx.get('amUnits', u.id))!;
          const t = cur.tenancy!;
          let issued = (t.payments ?? []).filter((x) => x.officialReceiptNo).length;
          const payments = [...(t.payments ?? [])];
          for (const x of open) {
            issued++;
            x.receiptNo = `RR-${u.code}-${String(issued).padStart(4, '0')}`;
            x.receiptTo = x.payer === 'ZAKAT' ? `${D<{ body?: string }>((await this.all('zakat')).find((z) => z.id === d.zakatId) ?? ({ d: {} } as RentRec)).body ?? 'Badan zakat'} (untuk ${t.tenant}, ${u.code}, ${d.period})` : t.tenant;
            const k = payments.findIndex((p) => p.id === x.paymentId);
            if (k >= 0) payments[k] = { ...payments[k], officialReceiptNo: x.receiptNo };
          }
          d.receipts.push(...open.map((x: { receiptNo: string; receiptTo: string; amount: number }) => ({ no: x.receiptNo, to: x.receiptTo, amount: x.amount, at: this.now(), by: user.name })));
          await tx.update('amUnits', u.id, { tenancy: { ...t, payments } });
          return this.save(user, c, { status: 'RESIT_DIKELUARKAN', d }, step, `receipt ${open.map((x: { receiptNo: string }) => x.receiptNo).join(', ')}`, tx);
        });
      }
      case 'close': {
        this.needTeam(user, 'closes the month');
        if (c.status !== 'RESIT_DIKELUARKAN') throw new BadRequest('Finance issues the official receipt first.');
        const left = this.tenantOwes(c, this.today());
        const p = this.needProof(user, i.proof, 'proof the receipt was sent to the tenant (and a copy of the zakat receipt)', `Resit ${d.period}`);
        d.receiptSentAt = this.now();
        return this.save(user, c, { status: left.owes > 0.001 || (d.zakatPart > 0 && left.zPaid + 0.001 < d.zakatPart && this.today() <= this.windowEnd(d.period)) ? 'RESIT_DIKELUARKAN' : 'SELESAI', d, proof: [...c.proof, ...p] }, step, left.owes > 0.001 ? `receipt sent; RM${left.owes} still owed` : 'Selesai');
      }
      case 'zakatTold': {
        // V-X29: the tenant is told the same day a zakat shortfall moves to them.
        this.needTeam(user, 'tells the tenant');
        const owes = this.tenantOwes(c, this.today());
        if (!(owes.shortfall > 0)) throw new BadRequest('No zakat shortfall for this month.');
        d.shortfallTold = { at: this.now(), by: user.name, amount: owes.shortfall, channel: s(i.channel, 20) || 'WHATSAPP' };
        return this.save(user, c, { d, proof: [...c.proof, ...this.proofs(user, i.proof, 'Makluman kekurangan zakat')] }, step, `tenant told of RM${owes.shortfall} zakat shortfall`);
      }
      default:
        throw new BadRequest('Unknown collection step.');
    }
  }
  /** V28 / V-X15 / V-X29: the zakat body's approval letter on the tenancy, and its written release to the tenant. */
  private async zakat(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'records the zakat approval');
    const u = await this.unit(i.unitId);
    if (bool(i.release)) {
      const z = await this.get(i.id, 'zakat');
      const p = this.needProof(user, i.proof, "the zakat body's written release to the tenant", 'Pelepasan zakat');
      return this.save(user, z, { d: { ...z.d, release: { on: isDate(i.on) ? i.on : this.today(), ref: this.reason(i.ref, 'the release reference'), amount: i.amount === 'full' ? 'full' : m2(i.amount), by: user.name } }, proof: [...z.proof, ...p] }, 'release', 'written release to the tenant on file');
    }
    const body = s(i.body, 120);
    const monthly = m2(i.monthly);
    if (!body || !(monthly > 0) || !isDate(i.from) || !isDate(i.to) || i.to < i.from) throw new BadRequest('Give the zakat body, the approved amount per month and the from and to dates.');
    const p = this.needProof(user, i.proof, "the zakat body's approval letter", 'Surat kelulusan zakat');
    return this.create(user, 'zakat', `ZKT-${u.code}`, { unitId: u.id, status: 'active', d: { body, letterRef: s(i.letterRef, 60), monthly, from: i.from, to: i.to, refPattern: s(i.refPattern, 30) }, proof: p }, `${u.code}: ${body} RM${monthly}/month`);
  }
  /** V-X25: Finance loads the unmatched incoming lines; the team sees only date, amount and reference to identify the payer. */
  private async bankLine(user: User, i: Record<string, unknown>) {
    this.needFinance(user, 'loads unmatched bank lines');
    const lines = Array.isArray(i.lines) ? (i.lines as Record<string, unknown>[]) : [i];
    const out: RentRec[] = [];
    for (const l of lines.slice(0, 100)) {
      if (!isDate(l.on) || !(m2(l.amount) > 0)) throw new BadRequest('Each line needs a date and an amount.');
      out.push(await this.create(user, 'bankLine', 'BL', { unitId: null, status: 'UNMATCHED', d: { ownerEntity: s(l.ownerEntity, 160), on: l.on, amount: m2(l.amount), ref: s(l.ref, 80), match: null } }, `unmatched line RM${m2(l.amount)}`));
    }
    return out;
  }
  private async bankLineStep(user: User, i: Record<string, unknown>) {
    const b = await this.get(i.id, 'bankLine');
    const d = structuredClone(b.d) as Record<string, any>;
    if (i.step === 'match') {
      this.needTeam(user, 'identifies payers');
      if (b.status !== 'UNMATCHED') throw new BadRequest('Already matched.');
      const u = await this.unit(i.unitId);
      d.match = { unitId: u.id, period: s(i.period, 7), payer: i.payer === 'ZAKAT' ? 'ZAKAT' : 'TENANT', payerName: s(i.payerName, 120), how: this.reason(i.how, 'how the payer was identified'), by: user.name, at: this.now() };
      return this.save(user, b, { status: 'PROPOSED', unitId: u.id, d }, 'match', `matched to ${u.code} ${d.match.period}`);
    }
    if (i.step === 'confirm') {
      this.needFinance(user, 'confirms the match');
      if (b.status !== 'PROPOSED') throw new BadRequest('No match proposed.');
      const c = await this.collectionOf(d.match.unitId, d.match.period);
      if (!c) throw new BadRequest('No invoice recorded for that unit and month.');
      const u = await this.unit(d.match.unitId);
      return this.store.transaction(async (tx) => {
        const res = await this.confirmMoney(user, c, u, { amount: d.amount, on: d.on, bankRef: d.ref || b.ref, payer: d.match.payer, method: 'TRANSFER' }, tx);
        const cd = structuredClone(c.d) as Record<string, any>;
        cd.confirmed.push({ n: cd.confirmed.length + 1, proofN: null, amount: d.amount, on: d.on, bankRef: d.ref || b.ref, payer: d.match.payer, at: this.now(), by: user.name, paymentId: res.paymentId, applied: res.applied, receiptNo: null, bankLineId: b.id });
        await this.save(user, c, { status: 'DISAHKAN_KEWANGAN', d: cd }, 'confirm', `bank line ${b.ref} confirmed`, tx);
        return this.save(user, b, { status: 'MATCHED', d: { ...d, confirmed: { by: user.name, at: this.now() } } }, 'confirm', 'match confirmed by Finance', tx);
      });
    }
    throw new BadRequest('Unknown bank line step.');
  }

  // =================================================================================================================
  // 5. Arrears and the notice to vacate (V64-V68, V-X27)
  // =================================================================================================================

  /** V64: months of the TENANT'S part unpaid (zakat shortfall included once the window closed). */
  async tenantUnpaidMonths(u: AmUnit, today: IsoDate) {
    const t = u.tenancy;
    if (!t) return [];
    const cols = (await this.all('collection')).filter((c) => c.unitId === u.id);
    const thisMonth = today.slice(0, 7);
    return t.invoices
      .filter((x) => x.period < thisMonth || today > this.windowEnd(x.period))
      .map((x) => {
        const c = cols.find((k) => k.d.period === x.period);
        const owes = c ? this.tenantOwes(c, today).owes : m2(x.amount - x.paid);
        return { period: x.period, owes };
      })
      .filter((x) => x.owes > 0.001);
  }
  private async arrearsOpen(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'opens arrears cases');
    const u = await this.unit(i.unitId);
    if ((await this.all('arrears')).some((a) => a.unitId === u.id && a.status !== 'CLOSED')) throw new BadRequest(`${u.code} already has an open arrears case.`);
    const months = await this.tenantUnpaidMonths(u, this.today());
    const v = (await this.settings()).v;
    if (months.length < v.arrearsMonths) throw new BadRequest(`${u.code} has ${months.length} month(s) of the tenant's part unpaid; the case opens at ${v.arrearsMonths}.`);
    const cols = (await this.all('collection')).filter((c) => c.unitId === u.id && ['BUKTI_DITERIMA', 'DALAM_SEMAKAN'].includes(c.status));
    return this.create(user, 'arrears', `TGK-${u.code}`, { unitId: u.id, status: 'OPEN', d: { tenant: u.tenancy!.tenant, months, pending: cols.map((c) => ({ period: c.d.period, status: c.status })), financeAmount: null, contacts: [], log: [] } }, `${u.code}: ${months.length} months of the tenant's part unpaid`);
  }
  private async arrearsStep(user: User, i: Record<string, unknown>) {
    const a = await this.get(i.id, 'arrears');
    const step = s(i.step, 30);
    const d = structuredClone(a.d) as Record<string, any>;
    const u = await this.unit(a.unitId);
    const h = await this.holidays();
    const v = (await this.settings()).v;
    const note = s(i.note, 400);
    switch (step) {
      case 'confirm': {
        this.needFinance(user, 'confirms the arrears amount');
        if (d.pending?.length && !bool(i.pendingSettled)) throw new BadRequest('A payment is still being checked (or a cheque has not cleared): settle it before the amount is confirmed.');
        const amount = m2(i.amount);
        if (!(amount > 0)) throw new BadRequest('Give the amount from your records.');
        d.financeAmount = { amount, by: user.name, at: this.now(), months: d.months };
        return this.save(user, a, { d }, step, `Finance confirmed RM${amount}`);
      }
      case 'contact': {
        this.needTeam(user, 'contacts the tenant');
        if (!d.financeAmount) throw new BadRequest('Finance confirms the amount first; the case shows only that figure.');
        const method = ['CALL', 'WHATSAPP', 'EMAIL'].find((m) => m === i.method);
        if (!method) throw new BadRequest('Use a channel that leaves a record: a logged call, WhatsApp (with consent) or email.');
        d.contacts.push({ at: this.now(), by: user.name, method, reply: s(i.reply, 300), promiseOn: isDate(i.promiseOn) ? i.promiseOn : null });
        if (!d.payBy) d.payBy = addWorkingDaysExcept(this.today(), v.demandWorkingDays, h);
        return this.save(user, a, { status: 'DEMAND', d }, step, `asked to pay RM${d.financeAmount.amount} in full by ${d.payBy}`);
      }
      case 'paid': {
        this.needFinance(user, 'confirms payment in full');
        d.paid = { at: this.now(), by: user.name, note };
        if (a.status === 'NOTICE') {
          d.paidDuringNotice = true;
          return this.save(user, a, { status: 'PAID_IN_NOTICE', d }, step, 'paid in full during the notice: the Asset Director decides');
        }
        return this.save(user, a, { status: 'CLOSED', d }, step, 'paid in full: case closed');
      }
      case 'hold': {
        this.needDirector(user, 'holds a notice');
        d.hold = { at: this.now(), by: user.name, reason: this.reason(note, 'the reason (e.g. a dated promise to pay)') };
        return this.save(user, a, { d }, step, `notice held: ${d.hold.reason}`);
      }
      case 'notice': {
        // V66: on day 4, filled from the records; numbered per owner company.
        this.needTeam(user, 'prepares the notice');
        if (a.status !== 'DEMAND' || !d.payBy) throw new BadRequest('Contact the tenant first and give the 3 working days.');
        if (this.today() <= d.payBy) throw new BadRequest(`The notice is prepared on day 4, after ${d.payBy}.`);
        if (d.hold) throw new BadRequest('The Asset Director has held the notice.');
        const st = await this.settings();
        const tpl = (st.templates.notice ?? []).at(-1);
        if (!tpl) throw new BadRequest('The Asset Director uploads the notice template first.');
        const owner = await this.ownerOf(u);
        if (!owner) throw new BadRequest(`Record the owner company ${u.ownerEntity} first.`);
        const officer = s(i.officerId, 120);
        if (!st.officers.includes(officer)) throw new BadRequest('Pick an authorised officer from the Asset Director\'s list to sign.');
        const year = this.today().slice(0, 4);
        const od = owner.d as Record<string, string>;
        const n = (await this.all('arrears')).filter((x) => String((x.d.notice as { no?: string })?.no ?? '').startsWith(`NT/${od.companyNo || 'X'}/${year}/`)).length + 1;
        const months = d.financeAmount.months as { period: string; owes: number }[];
        const rent = u.tenancy?.rent ?? 0;
        const exact = months.length === 3 && months.every((x) => Math.abs(x.owes - rent) < 0.001) && Math.abs(d.financeAmount.amount - rent * 3) < 0.001;
        d.notice = { no: `NT/${od.companyNo || 'X'}/${year}/${String(n).padStart(3, '0')}`, template: tpl.v, owner: od.ownerEntity, ownerNo: od.companyNo, bank: od.bankAccount, bankName: od.bankName, tenant: u.tenancy?.tenant, premises: u.name, title: 'NOTIS TUNGGAKAN SEWA DAN ARAHAN PENGOSONGAN RUMAH SEWA', from: months[0]?.period, to: months.at(-1)?.period, amountText: exact ? `RM${rent.toFixed(2)} X 3 bulan` : months.map((x) => `${x.period}: RM${x.owes.toFixed(2)}`).join('; '), amount: d.financeAmount.amount, officerId: officer, preparedById: user.id, preparedBy: user.name, at: this.now(), approved: null, letterOn: null, deadline: null };
        return this.save(user, a, { d }, step, `${d.notice.no} prepared; waiting for the Asset Director`);
      }
      case 'noticeApprove': {
        this.needDirector(user, 'approves the notice');
        if (!d.notice || d.notice.approved) throw new BadRequest('No notice waiting.');
        if (d.notice.preparedById === user.id) throw new BadRequest('You prepared this notice, so someone else approves it.');
        d.notice.approved = { by: user.name, at: this.now(), note: requireApprovalReason(note) };
        return this.save(user, a, { d }, step, 'notice approved');
      }
      case 'noticeDeliver': {
        this.needTeam(user, 'delivers the notice');
        if (!d.notice?.approved) throw new BadRequest('The Asset Director approves the notice first.');
        const p = this.needProof(user, i.proof, 'the copy and proof of delivery', `Notis ${d.notice.no}`);
        const letterOn = isDate(i.letterOn) ? i.letterOn : this.today();
        d.notice.letterOn = letterOn;
        d.notice.deadline = addDays(letterOn, v.vacateDays);
        return this.save(user, a, { status: 'NOTICE', d, proof: [...a.proof, ...p] }, step, `notice delivered; vacate by ${d.notice.deadline}`);
      }
      case 'log': {
        this.needTeam(user, 'logs the notice period');
        d.log.push({ at: this.now(), by: user.name, text: this.reason(note, 'what happened') });
        return this.save(user, a, { d }, step, 'logged');
      }
      case 'day14': {
        this.needTeam(user, 'checks on day 14');
        if (a.status !== 'NOTICE' || !d.notice?.deadline) throw new BadRequest('No notice running.');
        if (this.today() < d.notice.deadline) throw new BadRequest(`Day 14 is ${d.notice.deadline}.`);
        const vacated = bool(i.vacated);
        d.day14 = { at: this.now(), by: user.name, vacated };
        if (vacated) return this.save(user, a, { status: 'VACATED', d }, step, 'vacated: move-out from the keys (V70)');
        d.referredOn = this.today();
        d.managementBy = addWorkingDaysExcept(this.today(), v.managementWorkingDays, h);
        return this.save(user, a, { status: 'REFERRED', d }, step, `not vacated: referred to the Asset Director (decide by ${d.managementBy})`);
      }
      case 'continue': {
        this.needDirector(user, 'decides after payment during the notice');
        if (a.status !== 'PAID_IN_NOTICE') throw new BadRequest('Not paid during a notice.');
        const stay = bool(i.stay);
        d.continue = { stay, by: user.name, at: this.now(), reason: requireApprovalReason(note) };
        return this.save(user, a, { status: stay ? 'CLOSED' : 'NOTICE', d }, step, stay ? 'tenancy continues: case closed' : 'tenant still leaves');
      }
      case 'decide': {
        // V-X27: lawyer's letter then court action (default), or a written payment plan; a lock-out only after the lawyer.
        this.needDirector(user, 'decides the next step');
        if (a.status !== 'REFERRED') throw new BadRequest('The case is not referred to you.');
        const route = ['LAWYER', 'PLAN', 'LOCKOUT'].find((r) => r === (i.route ?? 'LAWYER'))!;
        if (route === 'LOCKOUT' && !d.lawyerConfirm) throw new BadRequest("Locked: a lock-out only after the company's lawyer confirms in writing for this tenancy (upload the confirmation first).");
        const p = route === 'PLAN' ? this.needProof(user, i.proof, 'the payment plan signed by the tenant', 'Pelan bayaran') : [];
        d.decision = { route, by: user.name, at: this.now(), reason: requireApprovalReason(note), legalFlag: 'Recovering possession needs a court order (Specific Relief Act 1950 s.7(2), s.8); no changing locks, removing things or cutting utilities without lawful process.' };
        return this.save(user, a, { status: route === 'PLAN' ? 'PLAN' : route === 'LAWYER' ? 'LEGAL' : 'LOCKOUT_APPROVED', d, proof: [...a.proof, ...p] }, step, `decided: ${route.toLowerCase()}`);
      }
      case 'lawyerConfirm': {
        this.needDirector(user, "records the lawyer's confirmation");
        const p = this.needProof(user, i.proof, "the company lawyer's written confirmation for this tenancy", 'Pengesahan peguam');
        d.lawyerConfirm = { at: this.now(), by: user.name, ref: this.reason(i.ref, 'the letter reference') };
        return this.save(user, a, { d, proof: [...a.proof, ...p] }, step, "lawyer's written confirmation on file");
      }
      case 'lockout': {
        this.needTeam(user, 'records the lock-out');
        if (a.status !== 'LOCKOUT_APPROVED' || !d.lawyerConfirm) throw new BadRequest("The lock-out screen stays locked until the lawyer's confirmation and the Asset Director's decision.");
        const present = Array.isArray(i.present) ? (i.present as unknown[]).map((x) => s(x, 120)).filter(Boolean) : [];
        if (present.length < 2) throw new BadRequest('At least two staff are present.');
        const photos = this.needProof(user, i.photos, 'before photos and photos of the belongings', 'Lock-out');
        d.lockout = { at: this.now(), by: user.name, present, belongings: s(i.belongings, 600), keptAt: this.reason(i.keptAt, 'where the belongings are kept and how to collect them'), keysChanged: bool(i.keysChanged), utilities: s(i.utilities, 200) };
        return this.save(user, a, { status: 'LOCKED_OUT', d, proof: [...a.proof, ...photos] }, step, 'lock-out recorded; Chairman / Vice Chairman told');
      }
      case 'close': {
        this.needTeam(user, 'closes arrears cases');
        const mo = (await this.all('moveout')).find((m) => D<{ arrearsId?: Id }>(m).arrearsId === a.id);
        if (mo && mo.status !== 'CLOSED') throw new BadRequest('The case closes when the move-out file closes.');
        if (!['VACATED', 'PLAN', 'LEGAL', 'LOCKED_OUT'].includes(a.status) && !d.paid) throw new BadRequest('The case is not settled.');
        if (!bool(i.noOpenIssue) && !d.referredIssue) throw new BadRequest('Record that nothing is open, or refer the open issue to the Asset Director first.');
        return this.save(user, a, { status: 'CLOSED', d }, step, 'closed');
      }
      case 'referIssue': {
        this.needTeam(user, 'refers open issues');
        d.referredIssue = { at: this.now(), by: user.name, text: this.reason(note, 'the open issue') };
        return this.save(user, a, { d }, step, 'open issue referred to the Asset Director');
      }
      default:
        throw new BadRequest('Unknown arrears step.');
    }
  }

  // =================================================================================================================
  // 6. Moving out and the deposit (V69-V73, V31, V-X28, V-X29)
  // =================================================================================================================

  private async moveoutOpen(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'records a move-out');
    const u = await this.unit(i.unitId);
    if (!u.tenancy) throw new BadRequest(`${u.code} has no tenant.`);
    if ((await this.all('moveout')).some((m) => m.unitId === u.id && m.status !== 'CLOSED')) throw new BadRequest(`${u.code} already has a move-out file.`);
    const arrears = s(i.arrearsId, 200) ? await this.get(i.arrearsId, 'arrears') : null;
    if (arrears && arrears.status !== 'VACATED' && !['LEGAL', 'PLAN', 'LOCKED_OUT'].includes(arrears.status)) throw new BadRequest('After an arrears notice the move-out starts when the house is vacated.');
    const d: Record<string, unknown> = { arrearsId: arrears?.id ?? null, tenant: u.tenancy.tenant, deposit: u.tenancy.deposit, utilityDeposit: u.tenancy.utilityDeposit, depositPayers: u.tenancy.depositPayers ?? [] };
    if (!arrears) {
      if (!isDate(i.receivedOn) || !isDate(i.proposedOn)) throw new BadRequest('Give the date the notice was received and the proposed move-out date.');
      const need = u.tenancy.noticeDays ?? RULES.amRental.value.noticeDays;
      const days = daysBetween(i.receivedOn, i.proposedOn);
      if (days < need && s(i.shortReason, 300).length < 5) throw new BadRequest(`The notice is ${days} days, under the tenancy's ${need}: record the reason.`);
      d.notice = { receivedOn: i.receivedOn, proposedOn: i.proposedOn, days, short: days < need ? s(i.shortReason, 300) : null };
    }
    const p = arrears ? [] : this.needProof(user, i.proof, "the tenant's written notice", 'Notis keluar');
    return this.create(user, 'moveout', `KLR-${u.code}`, { unitId: u.id, status: arrears ? 'KEYS' : 'NOTICE', d, proof: p }, arrears ? `${u.code}: move-out after arrears notice` : `${u.code}: notice received`);
  }
  /** V71: keys before 2 pm: inspection the same day; from 2 pm: by the next day. */
  inspectionDue(keysAt: IsoDateTime, cutoff = RULES.amRental.value.inspectCutoff): IsoDate {
    return keysAt.slice(11, 16) < cutoff ? dateOf(keysAt) : addDays(dateOf(keysAt), 1);
  }
  /** V-X29: who a zakat-paid deposit goes back to: the zakat body, unless its written release to the tenant is on file. */
  async depositPayee(u: AmUnit, payer: string) {
    if (payer !== 'ZAKAT') return { payee: 'TENANT', release: null };
    const z = (await this.all('zakat')).filter((x) => x.unitId === u.id).find((x) => x.d.release);
    return z ? { payee: 'TENANT', release: z.d.release } : { payee: 'ZAKAT', release: null };
  }
  private async moveoutStep(user: User, i: Record<string, unknown>) {
    const m = await this.get(i.id, 'moveout');
    const step = s(i.step, 30);
    const d = structuredClone(m.d) as Record<string, any>;
    const u = await this.unit(m.unitId);
    const h = await this.holidays();
    const v = (await this.settings()).v;
    const note = s(i.note, 400);
    switch (step) {
      case 'figures': {
        this.needFinance(user, 'confirms the move-out figures');
        const months = await this.tenantUnpaidMonths(u, this.today());
        d.figures = { unpaidRent: m2(i.unpaidRent ?? months.reduce((n, x) => n + x.owes, 0)), months, utilities: m2(i.utilities ?? 0), other: m2(i.other ?? 0), by: user.name, at: this.now() };
        return this.save(user, m, { d }, step, `figures confirmed: rent RM${d.figures.unpaidRent}`);
      }
      case 'date': {
        this.needTeam(user, 'agrees the move-out date');
        if (!isDate(i.on) || !/^\d{2}:\d{2}$/.test(s(i.time, 5))) throw new BadRequest('Give the move-out date and the key handover time.');
        d.date = { on: i.on, time: s(i.time, 5), told: bool(i.told), by: user.name, at: this.now() };
        return this.save(user, m, { d }, step, `move-out ${i.on} ${s(i.time, 5)}`);
      }
      case 'keys': {
        // V70: the Key Handover Form against the move-in list; the tenant signs, the receiving officer confirms.
        this.needTeam(user, 'receives the keys');
        if (d.keys) throw new BadRequest('Keys already received.');
        if (!isTime(i.at)) throw new BadRequest('Give the date AND time of the handover.');
        const items = Array.isArray(i.items) ? (i.items as Record<string, unknown>[]).map((k) => ({ item: s(k.item, 60), count: Math.max(0, Math.floor(Number(k.count) || 0)) })) : [];
        const app = (await this.all('application')).find((a) => a.id === u.tenancy?.rentalAppId);
        const given = ((app?.d.handover as { keys?: { item: string; count: number }[] })?.keys ?? D<{ moveInKeys?: { item: string; count: number }[] }>((await this.infoOf(u.id)) ?? ({ d: {} } as RentRec)).moveInKeys ?? []) as { item: string; count: number }[];
        const missing = given.map((g) => ({ item: g.item, short: g.count - (items.find((k) => k.item === g.item)?.count ?? 0) })).filter((x) => x.short > 0);
        const sign = this.needProof(user, i.tenantSign, "the tenant's signature on the Key Handover Form", 'Borang Serahan Kunci');
        const at = toAt(i.at as string);
        d.keys = { at, items, missing, receivedBy: user.name, receivedById: user.id, inspectBy: this.inspectionDue(at, v.inspectCutoff) };
        return this.save(user, m, { status: 'INSPECTION', d, proof: [...m.proof, ...sign] }, step, `keys received ${at.slice(0, 16)}; inspect by ${d.keys.inspectBy}${missing.length ? `; missing ${missing.map((x: { item: string }) => x.item).join(', ')}` : ''}`);
      }
      case 'inspect': {
        // V71: every room photographed; each defect normal wear or tenant damage (only tenant damage is charged).
        this.needTeam(user, 'inspects the house');
        if (!d.keys) throw new BadRequest('Receive the keys first.');
        const rooms = Array.isArray(i.rooms) ? (i.rooms as Record<string, unknown>[]) : [];
        if (!rooms.length) throw new BadRequest('List the rooms, each with its photo.');
        const roomRows = rooms.map((r) => {
          const ph = this.proofs(user, r.photos, `Bilik ${s(r.room, 40)}`);
          if (!ph.length) throw new BadRequest(`Every room needs a photo: ${s(r.room, 40) || 'a room'} has none.`);
          return { room: s(r.room, 40), photo: ph.map((p) => ({ ...p, data: undefined })) };
        });
        const checks = (i.checks ?? {}) as Record<string, unknown>;
        for (const a of INSPECT_AREAS) if (!(a in checks)) throw new BadRequest(`Fill the checklist: ${a.replace('_', ' / ')}.`);
        const defects = Array.isArray(i.defects) ? (i.defects as Record<string, unknown>[]).map((x) => {
          const kind = x.kind === 'TENANT_DAMAGE' ? 'TENANT_DAMAGE' : 'NORMAL_WEAR';
          const ph = this.proofs(user, x.photos, `Kerosakan ${s(x.area, 40)}`);
          if (!ph.length) throw new BadRequest('Each defect needs a photo.');
          return { n: 0, area: s(x.area, 40), text: s(x.text, 200), kind, cost: x.cost == null ? null : m2(x.cost) };
        }).map((x, k) => ({ ...x, n: k + 1 })) : [];
        d.inspection = { at: this.now(), by: user.name, byId: user.id, rooms: roomRows, checks, defects, leftBehind: s(i.leftBehind, 400), late: this.today() > d.keys.inspectBy };
        return this.save(user, m, { status: 'UTILITIES', d }, step, `inspected: ${defects.filter((x) => x.kind === 'TENANT_DAMAGE').length} tenant damage, ${defects.filter((x) => x.kind === 'NORMAL_WEAR').length} normal wear`);
      }
      case 'utilities': {
        // V71 / V-X28: final readings; a bill not out yet holds only an estimate (the last bill).
        this.needTeam(user, 'records the final utilities');
        const rows = Array.isArray(i.accounts) ? (i.accounts as Record<string, unknown>[]) : [];
        const out = rows.map((r) => {
          const status = ['PAID', 'OWED', 'BILL_PENDING', 'NA'].find((x) => x === r.status);
          if (!status) throw new BadRequest('Each account is paid, owed (confirmed amount), bill pending or not applicable.');
          if (status === 'BILL_PENDING' && (!(m2(r.estimate) > 0) || !isDate(r.followUpOn))) throw new BadRequest('A bill not out yet holds an estimate (the last bill) and a follow-up date.');
          return { account: s(r.account, 10), reading: s(r.reading, 30), status, amount: status === 'OWED' ? m2(r.amount) : 0, estimate: status === 'BILL_PENDING' ? m2(r.estimate) : 0, followUpOn: r.followUpOn ?? null };
        });
        const photos = this.proofs(user, i.photos, 'Bacaan meter');
        if (!photos.length && out.some((x) => x.status !== 'NA')) throw new BadRequest('Photograph the final meter readings.');
        d.utilities = { at: this.now(), by: user.name, accounts: out };
        return this.save(user, m, { status: 'STATEMENT', d, proof: [...m.proof, ...photos] }, step, 'final utilities recorded');
      }
      case 'statement': {
        // V72: deposits held minus each line with its basis and proof; only tenant damage; unpaid repair charges.
        this.needTeam(user, 'prepares the deposit statement');
        if (!d.inspection || !d.utilities) throw new BadRequest('Inspect and record the utilities first.');
        if (!d.figures) throw new BadRequest('Finance confirms the unpaid rent and other figures first.');
        const lines: { kind: string; text: string; amount: number; hold?: boolean }[] = [];
        if (d.figures.unpaidRent > 0) lines.push({ kind: 'RENT', text: "Sewa tertunggak (bahagian penyewa, termasuk kekurangan zakat)", amount: d.figures.unpaidRent });
        for (const a of d.utilities.accounts) {
          if (a.status === 'OWED' && a.amount > 0) lines.push({ kind: 'UTILITY', text: `${a.account} (disahkan)`, amount: a.amount });
          if (a.status === 'BILL_PENDING') lines.push({ kind: 'HOLD', text: `${a.account} anggaran (bil akhir belum keluar)`, amount: a.estimate, hold: true });
        }
        for (const x of d.inspection.defects.filter((k: { kind: string }) => k.kind === 'TENANT_DAMAGE')) {
          if (!(x.cost > 0)) throw new BadRequest(`Give the repair cost (quote or work order) for tenant damage ${x.n}.`);
          lines.push({ kind: 'DAMAGE', text: `Kerosakan penyewa: ${x.area} ${x.text}`, amount: x.cost });
        }
        // Repair charges decided during the tenancy: unpaid -> a line; paid -> not charged again (V84).
        for (const r of (await this.all('repair')).filter((k) => k.unitId === u.id && (k.d.charge as { status?: string } | undefined)?.status === 'INVOICED')) {
          lines.push({ kind: 'REPAIR', text: `Caj pembaikan ${r.ref}`, amount: m2((r.d.charge as { amount: number }).amount) });
        }
        const extras = Array.isArray(i.other) ? (i.other as Record<string, unknown>[]) : [];
        for (const x of extras) {
          if (s(x.basis, 200).length < 3 || !this.proofs(user, x.proof).length) throw new BadRequest('No deduction without a basis and proof.');
          lines.push({ kind: 'OTHER', text: `${s(x.text, 120)} (${s(x.basis, 200)})`, amount: m2(x.amount) });
        }
        if (Array.isArray(i.normalWearCharge) && i.normalWearCharge.length) throw new BadRequest('Normal wear and tear cannot be charged.');
        const held = m2(d.deposit + d.utilityDeposit);
        const ded = m2(lines.reduce((n, x) => n + x.amount, 0));
        const payees = await Promise.all(((d.depositPayers as { amount: number; payer: string; payerName: string }[]) ?? []).map(async (x) => ({ ...x, ...(await this.depositPayee(u, x.payer)) })));
        d.statement = { at: this.now(), by: user.name, byId: user.id, held, lines, deductions: ded, refund: Math.max(0, m2(held - ded)), owed: Math.max(0, m2(ded - held)), payees, checked: null, approved: null, sentAt: null };
        return this.save(user, m, { status: 'STATEMENT', d }, step, `statement: held RM${held}, deductions RM${ded}`);
      }
      case 'statementCheck': {
        this.needFinance(user, 'checks the deposit statement');
        if (!d.statement) throw new BadRequest('No statement.');
        d.statement.checked = { by: user.name, at: this.now(), note };
        return this.save(user, m, { d }, step, 'figures checked by Finance');
      }
      case 'statementApprove': {
        this.needDirector(user, 'approves deductions and the refund');
        if (!d.statement?.checked) throw new BadRequest('Finance checks the figures first.');
        if ([d.statement.byId, d.inspection?.byId].includes(user.id)) throw new BadRequest('You inspected the house or prepared the statement, so someone else approves it.');
        d.statement.approved = { by: user.name, at: this.now(), note: requireApprovalReason(note), refundBy: addWorkingDaysExcept(this.today(), v.refundWorkingDays, h) };
        return this.save(user, m, { status: 'REFUND', d }, step, `approved; refund by ${d.statement.approved.refundBy}${d.statement.owed > 0 ? `; RM${d.statement.owed} still owed goes to the arrears follow-up` : ''}`);
      }
      case 'statementSent': {
        this.needTeam(user, 'sends the statement');
        if (!d.statement?.approved) throw new BadRequest('The Asset Director approves the statement first.');
        const p = this.needProof(user, i.proof, 'proof the statement was sent', 'Penyata deposit');
        d.statement.sentAt = this.now();
        return this.save(user, m, { d, proof: [...m.proof, ...p] }, step, 'statement sent to the tenant');
      }
      case 'dispute': {
        this.needTeam(user, 'records a dispute');
        d.dispute = { at: this.now(), by: user.name, text: this.reason(note, 'what the tenant disputes'), amount: m2(i.amount ?? 0), decided: null };
        return this.save(user, m, { d }, step, 'tenant disputes: referred to the Asset Director before any refund');
      }
      case 'disputeDecide': {
        this.needDirector(user, 'decides a dispute');
        if (!d.dispute || d.dispute.decided) throw new BadRequest('No dispute open.');
        d.dispute.decided = { by: user.name, at: this.now(), note: requireApprovalReason(note), refundUndisputed: bool(i.refundUndisputed) };
        return this.save(user, m, { d }, step, 'dispute decided');
      }
      case 'refund': {
        // V73: by bank transfer only (never cash), to the right payee (V-X29).
        this.needFinance(user, 'pays the refund');
        if (!d.statement?.approved) throw new BadRequest('The refund is paid only after the Asset Director approves the statement.');
        if (d.dispute && !d.dispute.decided) throw new BadRequest('A dispute is open: the Asset Director decides before any refund.');
        if (i.method !== 'TRANSFER') throw new BadRequest('Refunds are by bank transfer only, never cash.');
        const ref = s(i.ref, 60);
        if (!ref) throw new BadRequest('Give the payment reference.');
        const payee = s(i.payee, 10) || 'TENANT';
        const zakatOwed = (d.statement.payees as { payee: string }[]).some((x) => x.payee === 'ZAKAT');
        if (zakatOwed && payee !== 'ZAKAT' && !bool(i.tenantPartOnly)) throw new BadRequest('The zakat body paid this deposit and no written release to the tenant is on file: refund it to the zakat body.');
        d.refunds = [...(d.refunds ?? []), { at: this.now(), by: user.name, ref, payee, amount: m2(i.amount ?? d.statement.refund), late: this.today() > d.statement.approved.refundBy }];
        return this.save(user, m, { d }, step, `refund RM${m2(i.amount ?? d.statement.refund)} to ${payee.toLowerCase()} (${ref})`);
      }
      case 'heldSettle': {
        this.needFinance(user, 'settles a held bill');
        const acc = s(i.account, 10);
        const row = (d.utilities?.accounts ?? []).find((a: { account: string; status: string }) => a.account === acc && a.status === 'BILL_PENDING');
        if (!row) throw new NotFound('Held bill');
        row.final = { amount: m2(i.amount), on: this.today(), by: user.name, ref: s(i.ref, 60), settleBy: addWorkingDaysExcept(this.today(), v.heldBillSettleWorkingDays, h) };
        row.status = 'SETTLED';
        return this.save(user, m, { d }, step, `${acc} final bill RM${m2(i.amount)}; balance of the estimate refunded`);
      }
      case 'refer': {
        this.needTeam(user, 'refers open points');
        d.referred = { at: this.now(), by: user.name, text: this.reason(note, 'what is still open') };
        return this.save(user, m, { d }, step, 'open points referred to the Asset Director');
      }
      case 'close': {
        this.needTeam(user, 'closes the move-out file');
        const open: string[] = [];
        if (!d.keys) open.push('key handover');
        if (!d.inspection) open.push('inspection');
        if (!d.statement?.sentAt) open.push('deposit statement sent');
        if (d.statement && d.statement.refund > 0 && !(d.refunds ?? []).length) open.push('refund');
        if ((d.utilities?.accounts ?? []).some((a: { status: string }) => a.status === 'BILL_PENDING')) open.push('unsettled bill');
        if (open.length && !d.referred) throw new BadRequest(`Not settled: ${open.join(', ')}. Settle them or refer the open points to the Asset Director.`);
        return this.store.transaction(async (tx) => {
          const cur = (await tx.get('amUnits', u.id))!;
          await tx.update('amUnits', u.id, { tenancy: null, status: bool(i.maintenance) ? 'maintenance' : 'vacant', vacantSince: this.today() });
          if (cur.tenancy) await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'asset.rental.tenancy_end', entity: 'am_unit', entityId: u.id, summary: `${u.code}: tenancy of ${cur.tenancy.tenant} closed` });
          if (d.arrearsId) {
            const a = (await tx.get('amRentalRecs', d.arrearsId)) as RentRec | undefined;
            if (a && a.status !== 'CLOSED') await this.save(user, a, { status: 'CLOSED' }, 'close', 'closed with the move-out file', tx);
          }
          return this.save(user, m, { status: 'CLOSED', d: { ...d, closedAt: this.now(), owedToArrears: d.statement?.owed ?? 0 } }, 'close', open.length ? `closed with open points referred: ${open.join(', ')}` : 'closed', tx);
        });
      }
      default:
        throw new BadRequest('Unknown move-out step.');
    }
  }
  /** V31: old deposits loaded once per tenancy, with a second check; "tiada bukti" is flagged. */
  private async oldDeposit(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'loads old deposits');
    if (s(i.id, 200)) {
      const r = await this.get(i.id, 'oldDeposit');
      if (r.byId === user.id) throw new BadRequest('The second check is by someone else.');
      return this.save(user, r, { status: 'CHECKED', d: { ...r.d, checkedBy: user.name, checkedAt: this.now() } }, 'check', 'second check done');
    }
    const u = await this.unit(i.unitId);
    if ((await this.all('oldDeposit')).some((x) => x.unitId === u.id)) throw new BadRequest(`${u.code} already has its old deposit loaded.`);
    const p = this.proofs(user, i.proof, 'Deposit lama');
    return this.create(user, 'oldDeposit', `DPL-${u.code}`, { unitId: u.id, status: 'LOADED', d: { amount: m2(i.amount), paidOn: isDate(i.paidOn) ? i.paidOn : null, noProof: !p.length, propertyKind: s(i.propertyKind, 20) }, proof: p }, `${u.code}: old deposit RM${m2(i.amount)}${p.length ? '' : ' (tiada bukti)'}`);
  }

  // =================================================================================================================
  // 8. Repairs during the tenancy: one flow (V78-V89, V-X31..V-X37)
  // =================================================================================================================

  private async repairReport(user: User, i: Record<string, unknown>) {
    this.needTeam(user, 'records repair reports');
    const u = await this.unit(i.unitId);
    const tenantLevel = REPAIR_LEVELS.find((x) => x === i.tenantLevel) ?? 'MEDIUM';
    let level = REPAIR_LEVELS.find((x) => x === (i.level ?? tenantLevel)) ?? tenantLevel;
    const levelWhy = s(i.levelReason, 300);
    if (level !== tenantLevel && levelWhy.length < 3) throw new BadRequest("Give the reason for changing the tenant's level.");
    if (tenantLevel === 'CRITICAL' && level !== 'CRITICAL' && s(i.inspectorNote, 300).length < 5) throw new BadRequest("Lowering a critical report needs the inspector's note.");
    const location = s(i.location, 80);
    const description = s(i.description, 400);
    if (!location || description.length < 3 || !isDate(i.noticedOn)) throw new BadRequest('Give the location in the house, a short description and when it was first noticed.');
    const photos = this.proofs(user, i.photos, 'Laporan kerosakan');
    if (!photos.length && !bool(i.photosAsked)) throw new BadRequest('Attach the photos or video, or tick that they were asked from the tenant.');
    const all = (await this.all('repair')).filter((r) => r.unitId === u.id);
    // V85: a minor fault that keeps coming back is treated as medium.
    const repeat = all.filter((r) => D<{ location: string }>(r).location.toLowerCase() === location.toLowerCase() && r.at.slice(0, 10) >= addDays(this.today(), -90));
    if (level === 'MINOR' && (repeat.length || bool(i.mainSystem) || bool(i.safety) || bool(i.permanentChange) || bool(i.causeUnclear))) level = 'MEDIUM';
    // V87: a repeat within the warranty of an earlier repair goes back to that contractor first.
    const warranty = all.find((r) => {
      const w = D<{ warrantyUntil?: IsoDate; location: string }>(r);
      return w.warrantyUntil && w.warrantyUntil >= this.today() && w.location.toLowerCase() === location.toLowerCase();
    });
    const h = await this.holidays();
    const shared = bool(i.sharedArea);
    const n = all.length + 1;
    const d = {
      reportNo: `RPR-${u.code}-${String(n).padStart(3, '0')}`,
      tenancyAppId: u.tenancy?.rentalAppId ?? null,
      tenant: u.tenancy?.tenant ?? null,
      tenantLevel,
      level,
      levelWhy,
      location,
      description,
      type: s(i.type, 60),
      noticedOn: i.noticedOn,
      reportedAt: isTime(i.reportedAt) ? toAt(i.reportedAt as string) : this.now(),
      sharedArea: shared,
      inspectBy: level === 'CRITICAL' ? this.today() : addWorkingDaysExcept(this.today(), 1, h),
      accessTime: s(i.accessTime, 60),
      repeatOf: repeat.map((r) => r.ref),
      warrantyRepeatOf: warranty ? { ref: warranty.ref, contractor: (warranty.d.chosen as { contractor?: string })?.contractor ?? null } : null,
      told: [{ at: this.now(), by: user.name, what: 'registered' }],
      paused: null,
    };
    return this.create(user, 'repair', `RPR-${u.code}`, { unitId: u.id, status: shared ? 'JMB' : 'REGISTERED', d, proof: photos, ref: d.reportNo }, `${d.reportNo} ${level.toLowerCase()}${shared ? ': shared area, JMB route' : ''}${warranty ? `; under warranty of ${warranty.ref}` : ''}`);
  }
  /** V-X31: who approves a repair cost: the Asset Director; the Vice Chairman above RM5,000; the CEO above RM50,000. */
  repairChain(cost: number, r = RULES.amRental.value.repair) {
    return { director: true, vc: cost > r.vcAbove, ceo: cost > r.ceoAbove };
  }
  private async repairStep(user: User, i: Record<string, unknown>) {
    const r = await this.get(i.id, 'repair');
    const step = s(i.step, 30);
    const d = structuredClone(r.d) as Record<string, any>;
    const note = s(i.note, 400);
    const rv = (await this.settings()).v.repair;
    const h = await this.holidays();
    if (r.status === 'CLOSED') throw new BadRequest('This report is closed.');
    const told = (what: string) => d.told.push({ at: this.now(), by: user.name, what });
    switch (step) {
      case 'jmb': {
        // V86: a neighbour or shared-area fault is moved to the JMB route and closed here with a reason.
        this.needTeam(user, 'routes to the JMB');
        d.jmb = { at: this.now(), by: user.name, ref: s(i.ref, 60), reason: this.reason(note, 'the reason') };
        return this.save(user, r, { status: 'JMB', d }, step, 'moved to the JMB / neighbour route');
      }
      case 'return': {
        this.needTeam(user, 'returns incomplete reports');
        d.paused = { at: this.now(), by: user.name, missing: this.reason(note, 'what is missing') };
        return this.save(user, r, { d }, step, 'returned to the tenant for details (clock paused)');
      }
      case 'resume': {
        this.needTeam(user, 'resumes reports');
        d.paused = null;
        return this.save(user, r, { d, proof: [...r.proof, ...this.proofs(user, i.photos, 'Laporan kerosakan')] }, step, 'details received');
      }
      case 'emergency': {
        // V88: critical: the Asset Director's instruction (phone allowed) recorded the same day; one quote enough.
        this.needTeam(user, 'records the emergency instruction');
        if (d.level !== 'CRITICAL') throw new BadRequest('The emergency route is for critical damage.');
        d.emergency = { at: this.now(), by: user.name, instructedBy: this.reason(i.instructedBy, 'who instructed (the Asset Director)'), how: s(i.how, 20) || 'PHONE', reason: this.reason(note, 'the reason'), tenantToldStop: bool(i.tenantToldStop) };
        return this.save(user, r, { status: 'EMERGENCY', d }, step, 'emergency work instructed; area made safe');
      }
      case 'inspect': {
        // V79: the 8 questions with photos.
        this.needTeam(user, 'inspects');
        const answers = (i.answers ?? {}) as Record<string, unknown>;
        for (const q of REPAIR_QUESTIONS) if (q !== 'contractorFinding' && s(answers[q], 300) === '') throw new BadRequest(`Answer the inspection question: ${q}.`);
        const photos = this.needProof(user, i.photos, 'the inspection photos or video', 'Pemeriksaan');
        d.inspection = { at: this.now(), by: user.name, byId: user.id, answers: Object.fromEntries(REPAIR_QUESTIONS.map((q) => [q, s(answers[q], 300)])), finding: this.reason(i.finding, 'the written finding'), listC: bool(i.listC), structure: bool(i.structure), late: this.today() > d.inspectBy, gapDays: daysBetween(d.noticedOn, dateOf(d.reportedAt)) };
        if (d.paused) d.paused = null;
        told('inspection done');
        return this.save(user, r, { status: 'INSPECTED', d, proof: [...r.proof, ...photos] }, step, 'inspected');
      }
      case 'contractorFinding': {
        // V80 / V-X33: the contractor's written cause; the owner pays the fee first.
        this.needTeam(user, "records the contractor's finding");
        const p = this.needProof(user, i.proof, "the contractor's written finding", 'Dapatan kontraktor');
        d.contractorFinding = { at: this.now(), by: user.name, contractor: s(i.contractor, 120), cause: this.reason(i.cause, 'the cause in writing'), fee: m2(i.fee ?? 0) };
        return this.save(user, r, { d, proof: [...r.proof, ...p] }, step, 'contractor finding on file');
      }
      case 'decide': {
        // V86: OWNER / TENANT / UNCLEAR, decided before quotes; no charge without inspection, photos and a finding.
        this.needTeam(user, 'proposes who pays');
        if (!d.inspection && !d.emergency) throw new BadRequest('Inspect first (no quick decision).');
        if (!d.inspection) throw new BadRequest('After the emergency, the inspection report catches up before the decision.');
        const outcome = REPAIR_OUTCOMES.find((x) => x === i.outcome);
        if (!outcome) throw new BadRequest('Pick OWNER, TENANT or UNCLEAR.');
        if (outcome === 'TENANT' && (!r.proof.length || !d.inspection.finding)) throw new BadRequest('No charge without inspection, photos and a written finding.');
        const split = i.lateSplit ? { ownerPart: m2((i.lateSplit as Record<string, unknown>).ownerPart), tenantExtra: m2((i.lateSplit as Record<string, unknown>).tenantExtra) } : null;
        if (split && !(d.inspection.answers.lateMadeWorse && d.inspection.answers.lateMadeWorse.toLowerCase() !== 'no' && d.inspection.answers.lateMadeWorse.toLowerCase() !== 'tidak')) throw new BadRequest('A late-report split needs the inspection to find that the delay made it worse.');
        d.decision = { outcome, split, reason: this.reason(note, 'the reason and the evidence'), by: user.name, byId: user.id, at: this.now(), agreementSupports: i.agreementSupports !== false };
        return this.save(user, r, { status: outcome === 'UNCLEAR' ? 'UNCLEAR' : 'DECIDED', d }, step, `proposed: ${outcome.toLowerCase()}${split ? ' (owner part + tenant extra)' : ''}`);
      }
      case 'tenantFix': {
        // V83(a): a list B minor item fixed by the tenant, with an after-photo.
        this.needTeam(user, "records the tenant's own fix");
        if (d.level !== 'MINOR') throw new BadRequest('Only a minor item is fixed by the tenant themselves.');
        const p = this.needProof(user, i.photos, "the tenant's after-photo", 'Selepas (penyewa)');
        d.tenantFixed = { at: this.now(), by: user.name };
        told('fixed by the tenant');
        return this.save(user, r, { status: 'COMPLETED', d, proof: [...r.proof, ...p] }, step, 'fixed by the tenant');
      }
      case 'quotes': {
        // V87: at least 3 quotes, fewer only for a listed reason; a panel job from the rate list up to RM5,000.
        this.needTeam(user, 'collects quotes');
        if (d.decision?.outcome === 'UNCLEAR' || !d.decision) throw new BadRequest('Decide who pays (owner or tenant) before asking for quotes.');
        const quotes = Array.isArray(i.quotes) ? (i.quotes as Record<string, unknown>[]).map((q) => ({ contractor: s(q.contractor, 120), price: m2(q.price), days: Number(q.days) || null, materials: s(q.materials, 200), warrantyMonths: Number(q.warrantyMonths) || 0, experience: s(q.experience, 200), safety: s(q.safety, 200), scope: s(q.scope, 300) })) : [];
        if (!quotes.length) throw new BadRequest('Give at least one quote.');
        const fewer = FEWER_QUOTE_REASONS.find((x) => x === i.fewerReason) ?? null;
        if (d.warrantyRepeatOf) {
          // under warranty: back to the same contractor, no new quotes
        } else if (quotes.length < rv.quotesNeeded) {
          if (!fewer) throw new BadRequest(`${rv.quotesNeeded} quotes, or a listed reason for fewer (emergency, specialist, panel contractor, no other supplier, other special case).`);
          if (fewer === 'EMERGENCY' && !d.emergency) throw new BadRequest('The emergency reason needs the recorded emergency instruction.');
          if (fewer === 'PANEL') {
            const q = quotes[Number(i.chosen ?? 0)];
            const panel = (await this.all('panel')).find((p) => p.status === 'APPROVED' && String(p.d.contractor).toLowerCase() === q?.contractor.toLowerCase() && String(p.d.validTo) >= this.today());
            if (!panel) throw new BadRequest('That contractor is not on an approved panel in force.');
            if (q.price > rv.quoteOnlyLimit || !bool(i.fromRateList)) throw new BadRequest(`A panel job from the rate list up to RM${rv.quoteOnlyLimit} needs no more quotes; above that, or outside the list, ${rv.quotesNeeded} quotes.`);
          }
        }
        const chosen = quotes[Number(i.chosen ?? 0)];
        if (!chosen) throw new BadRequest('Pick the chosen quote.');
        const p = this.proofs(user, i.proof, 'Sebut harga');
        d.quotes = quotes;
        d.fewerReason = fewer;
        d.chosen = chosen;
        d.cost = chosen.price;
        d.approval = null;
        return this.save(user, r, { status: 'QUOTED', d, proof: [...r.proof, ...p] }, step, `${quotes.length} quote(s); chosen ${chosen.contractor} RM${chosen.price}`);
      }
      case 'approve': {
        // V82 / V87 / V-X31: category + scope + chosen quote approved together, never by the proposer.
        this.needDirector(user, 'approves rental home repairs');
        if (!d.decision || (!d.chosen && d.decision.outcome === 'OWNER')) throw new BadRequest('Nothing to approve yet: the category and the quote come first.');
        if (d.decision.outcome === 'UNCLEAR') throw new BadRequest('Unclear: no cost may be charged to anyone until the evidence decides.');
        if (d.decision.byId === user.id) throw new BadRequest('You proposed this decision, so someone else approves it.');
        const approve = bool(i.approve);
        const why = requireApprovalReason(note, approve ? 'approve' : 'refuse');
        if (!approve) {
          d.rounds = [...(d.rounds ?? []), { at: this.now(), by: user.name, reason: why, back: s(i.back, 20) || 'QUOTES' }];
          return this.save(user, r, { status: s(i.back, 20) === 'INSPECT' ? 'REGISTERED' : 'DECIDED', d: { ...d, chosen: s(i.back, 20) === 'INSPECT' ? null : d.chosen } }, step, `not approved: ${why}`);
        }
        if (d.decision.agreementSupports === false && d.decision.outcome === 'TENANT' && s(i.agreementNote, 200).length < 5) throw new BadRequest('The current agreement does not support this charge (V-X35): give your note on it.');
        const chain = this.repairChain(Number(d.cost ?? 0), rv);
        d.approval = { by: user.name, byId: user.id, at: this.now(), reason: why, cost: d.cost ?? 0, needs: chain, vc: null, ceo: null };
        const done = !chain.vc && !chain.ceo;
        return this.save(user, r, { status: done ? 'APPROVED' : 'WAITING_CONSENT', d }, step, done ? 'approved' : `approved; waiting for the ${chain.ceo ? 'Vice Chairman and the CEO' : 'Vice Chairman'}`);
      }
      case 'consent': {
        if (!d.approval) throw new BadRequest('The Asset Director approves first.');
        if (this.vc(user) && d.approval.needs.vc && !d.approval.vc) d.approval.vc = { by: user.name, at: this.now(), note: requireApprovalReason(note, 'consent') };
        else if (this.ceo(user) && d.approval.needs.ceo && !d.approval.ceo) d.approval.ceo = { by: user.name, at: this.now(), note: requireApprovalReason(note) };
        else throw new AccessDenied('view', '(the Vice Chairman above RM5,000, the CEO above RM50,000)');
        const done = (!d.approval.needs.vc || d.approval.vc) && (!d.approval.needs.ceo || d.approval.ceo);
        return this.save(user, r, { status: done ? 'APPROVED' : 'WAITING_CONSENT', d }, step, done ? 'consents complete: approved' : 'consent recorded');
      }
      case 'decisionSent': {
        // V82: written decision to the tenant before work and before any charge.
        this.needTeam(user, 'sends the written decision');
        if (!['APPROVED'].includes(r.status) && !(d.emergency && d.decision)) throw new BadRequest('The written decision goes after approval.');
        const p = this.needProof(user, i.proof, 'proof the written decision was sent', 'Keputusan bertulis');
        const fee = d.contractorFinding?.fee && d.decision.outcome === 'TENANT' ? d.contractorFinding.fee : 0;
        d.decisionSent = { at: this.now(), by: user.name, text: `${d.reportNo}: ${d.description}. Dapatan: ${d.inspection?.finding ?? '-'}. Tanggungjawab: ${d.decision.outcome === 'OWNER' ? 'pemilik' : 'penyewa'}. ${d.decision.outcome === 'TENANT' ? `Anggaran kos RM${m2(Number(d.cost ?? 0) + fee)} (bayar dalam ${rv.tenantPayDays} hari). Bantahan bertulis dalam ${rv.objectionDays} hari.` : ''}`.trim() };
        d.objectionBy = addDays(this.today(), rv.objectionDays);
        told('decision');
        return this.save(user, r, { d, proof: [...r.proof, ...p] }, step, 'written decision sent');
      }
      case 'work': {
        this.needTeam(user, 'starts the repair');
        if (d.decision?.outcome === 'UNCLEAR') throw new BadRequest('Unclear: no non-emergency work until the evidence decides.');
        if (!d.emergency && !(r.status === 'APPROVED' && d.decisionSent)) throw new BadRequest('Work starts only after approval and the written decision to the tenant (except an emergency).');
        if (!isDate(i.on)) throw new BadRequest('Give the repair date agreed with the tenant.');
        d.work = { on: i.on, by: user.name, at: this.now(), contractor: d.chosen?.contractor ?? s(i.contractor, 120), refusedAccess: bool(i.refusedAccess) };
        if (d.warrantyRepeatOf) d.work.contractor = d.warrantyRepeatOf.contractor ?? d.work.contractor;
        told(`repair on ${i.on}`);
        return this.save(user, r, { status: 'IN_PROGRESS', d, proof: [...r.proof, ...this.proofs(user, i.photos, 'Sebelum / semasa')] }, step, `repair on ${i.on}`);
      }
      case 'change': {
        // V87: scope, material or cost changes need a fresh approval.
        this.needTeam(user, 'records a change');
        if (r.status !== 'IN_PROGRESS') throw new BadRequest('No repair in progress.');
        d.changes = [...(d.changes ?? []), { at: this.now(), by: user.name, what: this.reason(note, 'what changes (scope, material or cost)'), cost: m2(i.cost ?? d.cost) }];
        d.cost = m2(i.cost ?? d.cost);
        d.decision = { ...d.decision, byId: user.id };
        d.approval = null;
        return this.save(user, r, { status: 'QUOTED', d }, step, 'change: fresh approval needed');
      }
      case 'complete': {
        // V89: checked against the approved scope, tested, after-photo, completion report, invoice.
        this.needTeam(user, 'checks the finished work');
        if (r.status !== 'IN_PROGRESS' && r.status !== 'EMERGENCY') throw new BadRequest('No repair in progress.');
        if (bool(i.sendBack)) {
          d.sentBack = [...(d.sentBack ?? []), { at: this.now(), by: user.name, why: this.reason(note, 'what is not right') }];
          return this.save(user, r, { d }, step, 'sent back to the contractor');
        }
        const after = this.needProof(user, i.after, 'the after-photo', 'Selepas');
        const report = this.needProof(user, i.report, 'the completion report', 'Laporan siap');
        const inv = this.proofs(user, i.invoice, 'Invois kontraktor');
        if (!bool(i.scopeOk) || !s(i.test, 200)) throw new BadRequest('Check against the approved scope and record the test (e.g. aircond cold, tap no leak).');
        const warrantyMonths = Number(d.chosen?.warrantyMonths ?? 0);
        d.completed = { at: this.now(), by: user.name, test: s(i.test, 200), invoice: inv.length > 0 };
        if (warrantyMonths > 0) d.warrantyUntil = addDays(this.today(), Math.round(warrantyMonths * 30.4375));
        return this.save(user, r, { status: 'COMPLETED', d, proof: [...r.proof, ...after, ...report, ...inv] }, step, 'work confirmed');
      }
      case 'pay': {
        this.needFinance(user, 'pays the contractor');
        if (r.status !== 'COMPLETED' || !d.completed) throw new BadRequest('The contractor is paid only after the work is confirmed and the papers are complete.');
        if (!d.completed.invoice) throw new BadRequest("The contractor's invoice is not on file.");
        d.paid = { at: this.now(), by: user.name, ref: this.reason(i.ref, 'the payment reference'), payer: (await this.unit(r.unitId)).ownerEntity };
        return this.save(user, r, { d }, step, 'contractor paid by the owner company');
      }
      case 'objection': {
        this.needTeam(user, 'records objections');
        if (!d.decisionSent) throw new BadRequest('No decision sent.');
        if (this.today() > d.objectionBy) throw new BadRequest(`The objection window closed on ${d.objectionBy}.`);
        d.objection = { at: this.now(), by: user.name, text: this.reason(note, "the tenant's objection"), replyBy: addWorkingDaysExcept(this.today(), rv.objectionReplyWorkingDays, h), reply: null };
        return this.save(user, r, { d }, step, 'objection recorded: no invoice while open');
      }
      case 'objectionReply': {
        this.needDirector(user, 'reviews objections');
        if (!d.objection || d.objection.reply) throw new BadRequest('No open objection.');
        d.objection.reply = { at: this.now(), by: user.name, note: requireApprovalReason(note), upheld: bool(i.upheld) };
        if (d.objection.reply.upheld) d.decision = { ...d.decision, outcome: 'OWNER' };
        return this.save(user, r, { d }, step, d.objection.reply.upheld ? 'objection upheld: owner pays' : 'objection answered: decision stands');
      }
      case 'charge': {
        // V-X32: a separate SQL Account invoice after the work is checked; 14 days; not counted in rent arrears.
        this.needFinance(user, 'invoices tenant repair charges');
        if (d.decision?.outcome !== 'TENANT' && !d.decision?.split) throw new BadRequest('Only a tenant item (or the tenant extra part) is charged.');
        if (r.status !== 'COMPLETED' && !d.tenantFixed) throw new BadRequest('The charge is invoiced after the work is checked.');
        if (d.objection && !d.objection.reply) throw new BadRequest('An objection is open: no invoice until the Asset Director replies.');
        if (!d.decisionSent) throw new BadRequest('The written decision goes to the tenant before any charge.');
        const base = d.decision.split ? d.decision.split.tenantExtra : Number(d.cost ?? 0);
        const fee = d.contractorFinding?.fee ?? 0;
        d.charge = { status: 'INVOICED', invoiceNo: this.reason(i.invoiceNo, 'the SQL Account invoice number'), amount: m2(base + fee), dueOn: addDays(this.today(), rv.tenantPayDays), by: user.name, at: this.now() };
        return this.save(user, r, { d }, step, `tenant charge RM${d.charge.amount} invoiced (not rent arrears)`);
      }
      case 'chargePaid': {
        this.needFinance(user, 'confirms the charge in the bank');
        if (d.charge?.status !== 'INVOICED') throw new BadRequest('No charge invoiced.');
        d.charge = { ...d.charge, status: 'PAID', paid: { at: this.now(), by: user.name, ref: this.reason(i.ref, 'the bank reference') } };
        return this.save(user, r, { d }, step, 'tenant charge paid');
      }
      case 'waterRefund': {
        // V-X36 as answered 14 Nov 03:12Z: no refund if the owner leak was repaired within 3 months of being found;
        // repaired later: the extra above the tenant's 3-month average, from the date found to the repair.
        this.needTeam(user, 'proposes a water refund');
        if (d.decision?.outcome !== 'OWNER') throw new BadRequest('A water refund is only for an owner leak.');
        if (!isDate(i.foundOn) || !isDate(i.repairedOn)) throw new BadRequest('Give the date the leak was found and the repair date.');
        const months = daysBetween(i.foundOn, i.repairedOn) / 30.4375;
        if (months <= rv.waterRefundMonths) throw new BadRequest(`Repaired within ${rv.waterRefundMonths} months of being found: no water refund.`);
        const avg = m2(i.avgBefore);
        const bills = Array.isArray(i.bills) ? (i.bills as Record<string, unknown>[]).map((b) => ({ month: s(b.month, 7), amount: m2(b.amount) })).filter((b) => b.month >= String(i.foundOn).slice(0, 7) && b.month <= String(i.repairedOn).slice(0, 7)) : [];
        const extra = m2(bills.reduce((n, b) => n + Math.max(0, b.amount - avg), 0));
        const p = this.needProof(user, i.proof, 'the water bills', 'Bil air');
        d.waterRefund = { foundOn: i.foundOn, repairedOn: i.repairedOn, avg, bills, extra, by: user.name, byId: user.id, at: this.now(), approved: null };
        return this.save(user, r, { d, proof: [...r.proof, ...p] }, step, `water refund RM${extra} proposed`);
      }
      case 'waterApprove': {
        this.needDirector(user, 'approves a water refund');
        if (!d.waterRefund || d.waterRefund.approved) throw new BadRequest('No water refund waiting.');
        if (d.waterRefund.byId === user.id) throw new BadRequest('You proposed it, so someone else approves it.');
        d.waterRefund.approved = { by: user.name, at: this.now(), note: requireApprovalReason(note) };
        return this.save(user, r, { d }, step, 'water refund approved');
      }
      case 'told': {
        this.needTeam(user, 'tells the tenant');
        const what = this.reason(note, 'what the tenant was told');
        d.told.push({ at: this.now(), by: user.name, what, done: bool(i.done) || (!!(d.completed || d.tenantFixed) && /done|siap|selesai|fixed/i.test(what)) });
        return this.save(user, r, { d }, step, 'tenant told');
      }
      case 'close': {
        this.needTeam(user, 'closes reports');
        if (r.status !== 'COMPLETED') throw new BadRequest('Close only when the work is confirmed.');
        if (!d.tenantFixed && !d.completed) throw new BadRequest('The completion check is missing.');
        if (!d.told.some((t: { done?: boolean; at: string }) => t.done && t.at >= (d.completed?.at ?? d.tenantFixed?.at ?? ''))) throw new BadRequest('Tell the tenant it is done before closing.');
        return this.save(user, r, { status: 'CLOSED', d: { ...d, closedAt: this.now() } }, step, 'closed');
      }
      default:
        throw new BadRequest('Unknown repair step.');
    }
  }
  /** V-X37: a panel contractor per trade, chosen once a year from 3 quotes on a fixed rate list; AD + VC consent. */
  private async panel(user: User, i: Record<string, unknown>) {
    if (s(i.id, 200)) {
      const p = await this.get(i.id, 'panel');
      const d = structuredClone(p.d) as Record<string, any>;
      if (i.step === 'approve') {
        this.needDirector(user, 'approves panel contractors');
        if (p.byId === user.id) throw new BadRequest('You proposed this panel, so someone else approves it.');
        d.approved = { by: user.name, at: this.now(), note: requireApprovalReason(s(i.note, 300)) };
        return this.save(user, p, { status: 'WAITING_VC', d }, 'approve', 'approved; waiting for the Vice Chairman');
      }
      if (i.step === 'consent') {
        if (!this.vc(user)) throw new AccessDenied('view', '(the Vice Chairman consents to panel contractors)');
        if (p.status !== 'WAITING_VC') throw new BadRequest('Not waiting for consent.');
        d.consent = { by: user.name, at: this.now(), note: requireApprovalReason(s(i.note, 300), 'consent') };
        return this.save(user, p, { status: 'APPROVED', d }, 'consent', 'panel in force');
      }
      throw new BadRequest('Unknown panel step.');
    }
    this.needTeam(user, 'proposes panel contractors');
    const trade = PANEL_TRADES.find((t) => t === i.trade);
    if (!trade) throw new BadRequest('Pick the trade: plumbing, electrical, aircond or general.');
    const quotes = Array.isArray(i.quotes) ? i.quotes : [];
    if (quotes.length < 3) throw new BadRequest('A panel is chosen from 3 quotes on the rate list.');
    const rates = Array.isArray(i.rates) ? (i.rates as Record<string, unknown>[]).map((x) => ({ item: s(x.item, 100), rate: m2(x.rate) })).filter((x) => x.item && x.rate > 0) : [];
    if (!rates.length) throw new BadRequest('Give the fixed rate list.');
    const p = this.needProof(user, i.proof, 'the 3 quotes', 'Panel');
    return this.create(user, 'panel', `PNL-${trade}`, { unitId: null, status: 'PROPOSED', d: { trade, contractor: s(i.contractor, 120), rates, year: this.today().slice(0, 4), validTo: `${this.today().slice(0, 4)}-12-31` }, proof: p }, `${trade} panel: ${s(i.contractor, 120)}`);
  }

  // =================================================================================================================
  // Board, home items and the Excel export (V32, V48, V63, V68, V73, V77, V84, V89)
  // =================================================================================================================

  async board(user: User) {
    if (!this.sees(user) && !this.finance(user) && !this.chairVc(user)) throw new AccessDenied('view', '(Asset Management, its overseers and Finance)');
    const team = this.team(user);
    const today = this.today();
    const now = this.now();
    const h = await this.holidays();
    const st = await this.settings();
    const v = st.v;
    const all = await this.all();
    const units = (await this.store.list('amUnits', {})).filter((u) => u.type === 'RESIDENTIAL' && !u.office);
    const byKind = (k: RentKind) => all.filter((r) => r.kind === k);
    const code = (id: Id | null) => units.find((u) => u.id === id)?.code ?? id ?? '';
    // PDPA (V22 / V42): only the team sees IC numbers, payslips and contact details; overseers see "complete yes/no".
    const strip = (r: RentRec) => {
      const out = { ...r, proof: team ? r.proof.map((p) => ({ ...p, data: undefined })) : [], unitCode: code(r.unitId) };
      if (!team && r.kind === 'application') {
        const d = r.d as Record<string, any>;
        out.d = { type: d.type, appliedOn: d.appliedOn, docsComplete: ['LENGKAP', 'DINILAI', 'UNTUK_KEPUTUSAN', 'LULUS', 'DISERAH'].includes(r.status), applicantName: d.applicant?.name ?? null, assessment: d.assessment ? { rules: d.assessment.rules, recommendation: d.assessment.recommendation } : null, decision: d.decision ?? null, consent: d.consent ?? null, related: d.related?.yes ? { yes: true, details: d.related.details } : null, dpr: d.dpr ? { ...d.dpr, owner: { ...d.dpr.owner, bankAccount: this.mask(d.dpr.owner.bankAccount) } } : null, depositFull: !!d.depositFull };
      }
      if (r.kind === 'owner') out.d = { ...r.d, bankAccount: this.mask(r.d.bankAccount) };
      if (r.kind === 'bankLine' && !this.finance(user)) out.d = { on: r.d.on, amount: r.d.amount, ref: r.d.ref, match: r.d.match ?? null };
      if (!team && r.kind === 'listing') out.d = { ...r.d, enquiries: ((r.d.enquiries as Record<string, unknown>[]) ?? []).map((e) => ({ n: e.n, at: e.at, source: e.source, screen: e.screen ? { result: (e.screen as { result: string }).result } : null, repliedAt: e.repliedAt, replyDue: e.replyDue })) };
      return out;
    };
    const late: { what: string; ref: string; unit: string; since: string; who: string }[] = [];
    const push = (what: string, r: RentRec, since: string, who: string) => late.push({ what, ref: r.ref, unit: code(r.unitId), since, who });
    for (const l of byKind('listing')) {
      for (const e of (l.d.enquiries as { n: number; replyDue: IsoDateTime; repliedAt: IsoDateTime | null; screen: unknown; at: IsoDateTime }[]) ?? []) {
        if (!e.repliedAt && toMs(now) > toMs(e.replyDue)) push(`first reply late (enquiry ${e.n})${toMs(now) > toMs(e.replyDue) + 3600_000 ? ': Asset Director' : ''}`, l, e.replyDue, 'team');
      }
      if (l.status === 'TELAH_DISEWA') for (const a of (l.d.adverts as { platform: string; takenDown: unknown }[]) ?? []) if (!a.takenDown) push(`advert on ${a.platform} not taken down`, l, String(l.d.letAt ?? ''), 'team');
      const ready = l.d.readyAt as IsoDateTime | undefined;
      if (ready && !l.d.firstAdvertAt && officeMinutesBetween(ready, now, h) > v.advertOfficeHours * 60) push('advert not posted within 2 office hours of ready', l, ready, 'team');
      const ag = this.agentDue(l, today, v.agentAfterDays);
      if (ag && !byKind('agent').some((a) => D<{ listingId: Id }>(a).listingId === l.id)) push(`cadang ejen: ${ag}`, l, today, 'team');
    }
    const apps = byKind('application');
    const appRows = await Promise.all(
      apps.map(async (a) => {
        const clock = ['DISERAH', 'TIDAK_LULUS'].includes(a.status) ? null : await this.appClock(a);
        if (clock?.late) push(`application past ${v.wholeProcessWorkingDays} working days (team time)`, a, a.at, 'Asset Director');
        if (a.status === 'LULUS' && !(a.d as { dpr?: unknown }).dpr) push('deposit request not issued', a, a.at, 'team');
        if ((a.d as { depositCheck?: { at: string } }).depositCheck) push('deposit Dalam Semakan', a, (a.d as { depositCheck: { at: string } }).depositCheck.at, 'Finance');
        return { ...strip(a), clock, gate: a.status === 'LULUS' ? await this.keysGate(a) : null };
      }),
    );
    for (const ag of byKind('agreement')) {
      const d = ag.d as Record<string, any>;
      const dl = this.stampDeadline(ag);
      if (dl && !['DISETEM', 'DISERAHKAN', 'DIFAILKAN'].includes(ag.status) && daysBetween(today, dl) <= 7) push(`stamping deadline ${dl}`, ag, dl, 'team');
      if (ag.status === 'LENGKAP' && d.sign?.signedOn && d.sign.signedOn < today) push('signed but not submitted in e-Duti Setem the same day', ag, d.sign.signedOn, 'team');
      if (ag.status === 'NOTIS_DIHANTAR' && toMs(now) - toMs(d.stamp.notice.at) > v.stampTenantHours * 3600_000) push('tenant has not paid the stamp duty in 24 hours', ag, d.stamp.notice.at, 'team');
      if (d.sign?.signedOn && !['DISETEM', 'DISERAHKAN', 'DIFAILKAN'].includes(ag.status)) {
        const since = daysBetween(d.sign.signedOn, today);
        if (since >= v.stampEscalateDay) push(`not stamped ${since} days after signing: Asset Director`, ag, d.sign.signedOn, 'Asset Director');
        else if (v.stampReminderDays.includes(since)) push(`reminder to the tenant (day ${since})`, ag, d.sign.signedOn, 'team');
      }
      if (ag.status === 'BAYARAN_DISAHKAN' && toMs(now) - toMs(d.stamp.confirmed.at) > 3 * 3600_000) push('LHDN not paid within 3 hours of confirmation', ag, d.stamp.confirmed.at, 'Finance');
      if (d.stamp?.issues?.length && !['DISETEM', 'DISERAHKAN', 'DIFAILKAN'].includes(ag.status)) push('Isu LHDN', ag, d.stamp.issues.at(-1).at, 'team');
    }
    const month = today.slice(0, 7);
    const nextMonth = addDays(`${month}-28`, 7).slice(0, 7);
    const cols = byKind('collection');
    const colRows = cols.map((c) => ({ ...strip(c), owes: this.tenantOwes(c, today) }));
    for (const c of cols) {
      const d = c.d as Record<string, any>;
      if (!d.sentAt && toMs(now) - toMs(d.recordedAt) > v.stepHours * 3600_000) push(`invoice not sent in 24 hours${toMs(now) - toMs(d.recordedAt) > v.sendEscalateHours * 3600_000 ? ': Asset Director' : ''}`, c, d.recordedAt, 'team');
      if (d.semakan && workingDaysUntil(dateOf(d.semakan.since), today, h) > v.dalamSemakanWorkingDays) push(`Dalam Semakan over ${v.dalamSemakanWorkingDays} working days: Asset Director and Finance Director`, c, d.semakan.since, 'Asset Director');
      if (c.status === 'DISAHKAN_KEWANGAN' && workingDaysUntil(dateOf((d.confirmed.at(-1) ?? { at: now }).at), today, h) > v.receiptWorkingDays) push('official receipt not issued in 1 working day', c, d.confirmed.at(-1).at, 'Finance');
      if (d.flags?.length) push(`invoice differs from the tenancy: ${d.flags.join('; ')}`, c, d.recordedAt, 'Finance');
      const ow = this.tenantOwes(c, today);
      if (ow.shortfall > 0 && !d.shortfallTold) push(`zakat shortfall RM${ow.shortfall} moved to the tenant: tell the tenant today`, c, this.windowEnd(d.period), 'team');
      for (const pr of d.proofs ?? []) if (!(d.confirmed ?? []).some((x: { proofN: number }) => x.proofN === pr.n) && !d.semakan && toMs(now) - toMs(pr.at) > v.stepHours * 3600_000) push('proof not confirmed by Finance in 24 hours', c, pr.at, 'Finance');
    }
    // V58 / V26: no invoice for next month by the 24th (Finance) and late on the 25th.
    const day = Number(today.slice(8, 10));
    const invoiceMissing = day >= v.invoiceFromDay ? units.filter((u) => u.tenancy && !cols.some((c) => c.unitId === u.id && c.d.period === nextMonth)).map((u) => ({ unit: u.code, period: nextMonth, late: day > v.invoiceByDay })) : [];
    for (const z of byKind('zakat')) if (z.status === 'active' && daysBetween(today, String(z.d.to)) <= v.zakatExpiryWarnDays && String(z.d.to) >= today) push(`zakat approval ends ${z.d.to}: tell the tenant`, z, String(z.d.to), 'team');
    const arrearsDue = (
      await Promise.all(units.filter((u) => u.tenancy).map(async (u) => ({ u, months: await this.tenantUnpaidMonths(u, today) })))
    )
      .filter((x) => x.months.length >= v.arrearsMonths && !byKind('arrears').some((a) => a.unitId === x.u.id && a.status !== 'CLOSED'))
      .map((x) => ({ unitId: x.u.id, unit: x.u.code, months: x.months.length, owes: m2(x.months.reduce((n, k) => n + k.owes, 0)) }));
    for (const a of byKind('arrears')) {
      const d = a.d as Record<string, any>;
      if (a.status === 'DEMAND' && d.payBy && today > d.payBy && !d.notice && !d.hold) push('day 4: prepare the notice to vacate', a, d.payBy, 'team');
      if (a.status === 'NOTICE' && d.notice?.deadline && today >= d.notice.deadline) push('day 14: check whether the house is vacated', a, d.notice.deadline, 'team');
      if (a.status === 'REFERRED' && today > d.managementBy) push('decision after the notice is late', a, d.managementBy, 'Asset Director');
      if (a.status === 'LOCKED_OUT') push('lock-out recorded: Chairman / Vice Chairman told', a, d.lockout.at, 'Chairman / Vice Chairman');
    }
    for (const m of byKind('moveout')) {
      const d = m.d as Record<string, any>;
      if (d.keys && !d.inspection && today > d.keys.inspectBy) push('keys back without inspection (2 pm rule)', m, d.keys.inspectBy, 'team');
      if (d.inspection && d.utilities && !d.statement && toMs(now) - toMs(d.utilities.at) > v.statementHours * 3600_000) push('deposit statement late (24 hours)', m, d.utilities.at, 'team');
      if (d.statement?.approved && !(d.refunds ?? []).length && today > d.statement.approved.refundBy) push('refund approved but not paid', m, d.statement.approved.refundBy, 'Finance');
      if ((d.utilities?.accounts ?? []).some((x: { status: string }) => x.status === 'BILL_PENDING') && m.status !== 'CLOSED') push('final utility bill still pending', m, d.utilities.at, 'team');
      if (d.statement?.owed > 0 && m.status === 'CLOSED') push(`RM${d.statement.owed} still owed after the deposit: arrears follow-up`, m, d.closedAt ?? '', 'team');
    }
    for (const r of byKind('repair')) {
      const d = r.d as Record<string, any>;
      if (['CLOSED', 'JMB'].includes(r.status)) continue;
      if (d.level === 'CRITICAL' && !d.emergency) push('critical damage: act at once', r, d.reportedAt, 'team');
      if (!d.inspection && !d.paused && today > d.inspectBy) push('inspection late', r, d.inspectBy, 'team');
      if (!d.approval && !d.paused && officeMinutesBetween(d.reportedAt, now, h) > 48 * 60 && d.decision?.outcome !== 'UNCLEAR') push('past 48 office hours without approval', r, d.reportedAt, 'Asset Director');
      if (r.status === 'UNCLEAR' && workingDaysUntil(dateOf(d.decision.at), today, h) > v.repair.unclearWarnWorkingDays) push(`unclear over ${v.repair.unclearWarnWorkingDays} working days`, r, d.decision.at, 'Asset Director');
      if (d.warrantyRepeatOf) push(`repeat within warranty of ${d.warrantyRepeatOf.ref}`, r, d.reportedAt, 'team');
      if (d.objection && !d.objection.reply && today > d.objection.replyBy) push('objection reply late', r, d.objection.replyBy, 'Asset Director');
      if (d.charge?.status === 'INVOICED' && today > d.charge.dueOn) push('tenant repair charge unpaid', r, d.charge.dueOn, 'team');
    }
    // V32: the Excel views: per house, per month, per property kind, and the zakat monthly list.
    const infos = byKind('unitInfo');
    const kindOf = (id: Id | null) => String(infos.find((x) => x.unitId === id)?.d.propertyKind ?? 'HOUSE');
    const perKind: Record<string, { billed: number; confirmed: number }> = {};
    for (const c of cols.filter((k) => k.d.period === month)) {
      const k = kindOf(c.unitId);
      perKind[k] = perKind[k] ?? { billed: 0, confirmed: 0 };
      perKind[k].billed = m2(perKind[k].billed + Number(c.d.amount));
      perKind[k].confirmed = m2(perKind[k].confirmed + ((c.d.confirmed as { amount: number }[]) ?? []).reduce((n, x) => n + x.amount, 0));
    }
    const zakatList = byKind('zakat').filter((z) => z.status === 'active').map((z) => {
      const c = cols.find((k) => k.unitId === z.unitId && k.d.period === month);
      const ow = c ? this.tenantOwes(c, today) : null;
      return { unit: code(z.unitId), body: z.d.body, approved: z.d.monthly, received: ow?.zPaid ?? 0, short: ow ? Math.max(0, m2(Number(c!.d.zakatPart) - ow.zPaid)) : Number(z.d.monthly), to: z.d.to, release: !!z.d.release };
    });
    const oldDeps = byKind('oldDeposit');
    const depositHeld = Object.entries(
      oldDeps.reduce<Record<string, number>>((acc, x) => ((acc[String(x.d.propertyKind || 'HOUSE')] = m2((acc[String(x.d.propertyKind || 'HOUSE')] ?? 0) + Number(x.d.amount))), acc), {}),
    ).map(([kind, total]) => ({ kind, total }));
    return {
      role: team ? (this.director(user) ? 'director' : 'team') : this.finance(user) ? 'finance' : 'oversee',
      settings: { values: v, templates: Object.fromEntries(Object.entries(st.templates).map(([k, l]) => [k, l.map((x) => ({ v: x.v, note: x.note, by: x.by, at: x.at }))])), officers: st.officers, primaOnlyFrom: st.primaOnlyFrom },
      papers: RENTAL_POLICY_DOCS,
      units: await Promise.all(
        units.map(async (u) => {
          const l = all.find((r) => r.kind === 'listing' && r.unitId === u.id && r.status !== 'CLOSED') ?? null;
          return { id: u.id, code: u.code, name: u.name, owner: u.ownerEntity, status: u.status, rentalStatus: l?.status ?? (u.tenancy ? 'TELAH_DISEWA' : 'KOSONG'), tenant: team ? u.tenancy?.tenant ?? null : u.tenancy ? 'ada penyewa' : null, rent: u.tenancy?.rent ?? null, stamped: u.tenancy?.stamped ?? null, readiness: l && ['KOSONG'].includes(l.status) ? await this.readiness(u, l) : null };
        }),
      ),
      owners: byKind('owner').map(strip),
      unitInfo: infos.map(strip),
      listings: byKind('listing').map(strip),
      agents: byKind('agent').map(strip),
      applications: appRows,
      agreements: byKind('agreement').map((a) => ({ ...strip(a), deadline: this.stampDeadline(a) })),
      collections: colRows,
      invoiceMissing,
      bankLines: byKind('bankLine').filter((b) => this.finance(user) || b.status !== 'MATCHED').map(strip),
      zakat: byKind('zakat').map(strip),
      zakatList,
      arrearsDue,
      arrears: byKind('arrears').map(strip),
      moveouts: byKind('moveout').map(strip),
      repairs: byKind('repair').map(strip),
      panels: byKind('panel').map(strip),
      oldDeposits: oldDeps.map(strip),
      depositHeld,
      perKind,
      late,
    };
  }

  /** V32: the Excel views as CSV (per house and month). */
  private async exportCsv(user: User, i: Record<string, unknown>) {
    if (!this.team(user) && !this.finance(user)) throw new AccessDenied('view', '(the Asset Management team and Finance export rent records)');
    const month = /^\d{4}-\d{2}$/.test(s(i.month, 7)) ? s(i.month, 7) : this.today().slice(0, 7);
    const units = await this.store.list('amUnits', {});
    const cols = (await this.all('collection')).filter((c) => c.d.period === month);
    const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const rows = [['unit', 'tenant', 'month', 'invoice', 'amount', 'zakat part', 'tenant part', 'confirmed', 'receipts', 'status'].map(esc).join(',')];
    for (const c of cols) {
      const u = units.find((x) => x.id === c.unitId);
      const d = c.d as Record<string, any>;
      rows.push([u?.code, u?.tenancy?.tenant, d.period, d.invoiceNo, d.amount, d.zakatPart, d.tenantPart, (d.confirmed ?? []).reduce((n: number, x: { amount: number }) => n + x.amount, 0), (d.receipts ?? []).map((x: { no: string }) => x.no).join(' '), c.status].map(esc).join(','));
    }
    return { name: `sewa-${month}.csv`, mime: 'text/csv', csv: rows.join('\n') };
  }

  /** Do today lines for the team, Finance, the Asset Director and the Chairman / Vice Chairman. */
  async homeItems(user: User): Promise<{ tone: 'crit' | 'warn' | 'info'; tag: string; title: string; detail: string; go: { view: 'assets' } }[]> {
    if (!(await this.installed())) return [];
    if (!this.team(user) && !this.finance(user) && !this.chairVc(user)) return [];
    const b = await this.board(user).catch(() => null);
    if (!b) return [];
    const mine = (who: string) => (this.director(user) ? true : this.team(user) ? who === 'team' : this.finance(user) ? who === 'Finance' : who.startsWith('Chairman'));
    return b.late
      .filter((x) => mine(x.who) || (this.director(user) && x.who === 'Asset Director'))
      .slice(0, 30)
      .map((x) => ({ tone: /critical|late|Asset Director|reply/i.test(x.what) ? ('crit' as const) : ('warn' as const), tag: 'Sewaan', title: `${x.unit}: ${x.what}`, detail: x.ref, go: { view: 'assets' as const } }));
  }
}
