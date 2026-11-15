// Part Z (Fitri package, duty map gaps, Fauzan 14 Nov 2026: "Add any that still missing in prima app"): the records the
// companies' and central units' checklists keep that Prima did not have yet, in one register engine. Each kind names who
// keeps it, who checks it (never the person who prepared it: the manager checks what the support staff prepared), its
// fields, an optional period and date window for the "not recorded yet" reminder, and whether it is confidential.
// Records only: no provider is connected (ePerolehan, FWCMS, AffinMax, Merchantrade, INFOTECH, William, GEP, TrackerHero
// and factoring providers stay manual). No IC numbers, bank account numbers or worker names: staff numbers only.
import { AccessDenied, isGroupLeader } from './access';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween, toMs } from './time';
import { lineManagerOf } from './work';
import type { Id, IsoDate, IsoDateTime, User } from './types';

export type RegField = { k: string; l: string; t?: 'text' | 'number' | 'date' | 'select' | 'yn' | 'area'; o?: readonly string[]; req?: boolean };
/** Who keeps (adds and edits) a kind. */
export type RegKeeper = 'company_office' | 'company_manager' | 'om' | 'finance' | 'hr' | 'fwm' | 'audit' | 'asset' | 'central_admin';
/** Who checks: the company manager, the line manager, a Finance team leader, the Asset Director or the welfare approver. */
export type RegChecker = 'company_manager' | 'line_manager' | 'finance_leader' | 'asset_director' | 'welfare_approver' | 'none';
export interface RegKindSpec {
  kind: string;
  item: string;
  label: string;
  scope: 'company' | 'group';
  keeper: RegKeeper;
  checker: RegChecker;
  /** Extra readers beyond the keeper, checker, group leaders and ACT. */
  readers?: RegKeeper[];
  fields: RegField[];
  /** A record is expected every period; inside the window (from-to day) a missing one is a reminder. */
  every?: 'week' | 'month';
  window?: [number, number];
  confidential?: boolean;
}
const STAFF_NO: RegField = { k: 'staffNo', l: 'No. pekerja (bukan nama)', req: true };
const REF: RegField = { k: 'ref', l: 'Rujukan / fail' };
const NOTE: RegField = { k: 'note', l: 'Catatan', t: 'area' };

export const REG_KINDS: RegKindSpec[] = [
  { kind: 'factoring', item: 'Z4', label: 'Pemfaktoran (factoring)', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['finance'], every: 'month', window: [1, 10], fields: [{ k: 'provider', l: 'Penyedia pemfaktoran', req: true }, { k: 'period', l: 'Bulan (YYYY-MM)', req: true }, { k: 'requestedOn', l: 'Tarikh mohon dana', t: 'date', req: true }, { k: 'invoices', l: 'Invois dituntut (no.)', req: true }, { k: 'amount', l: 'Amaun (RM)', t: 'number' }, { k: 'stampedBeforePpd', l: 'Invois dicop sebelum ke PPD', t: 'yn', req: true }, { k: 'status', l: 'Status', t: 'select', o: ['requested', 'approved', 'funded', 'settled', 'rejected'], req: true }, NOTE] },
  { kind: 'schoolContribution', item: 'Z5', label: 'Sumbangan sekolah (PKK/KBK)', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['finance'], fields: [{ k: 'school', l: 'Sekolah / zon', req: true }, { k: 'period', l: 'Bulan (YYYY-MM)', req: true }, { k: 'letterRef', l: 'Surat permohonan', req: true }, { k: 'scheduleRef', l: 'Jadual' }, { k: 'amount', l: 'Amaun (RM)', t: 'number', req: true }, { k: 'slipRef', l: 'Slip bayaran dipulangkan' }, NOTE] },
  { kind: 'contractNotice', item: 'Z5', label: 'Notis tamat kontrak (1-3 bulan sebelum)', scope: 'company', keeper: 'company_office', checker: 'company_manager', fields: [{ k: 'contractRef', l: 'Rujukan kontrak', req: true }, { k: 'endOn', l: 'Kontrak tamat', t: 'date', req: true }, { k: 'decision', l: 'Keputusan', t: 'select', o: ['renew', 'end'], req: true }, { k: 'noticeSentOn', l: 'Notis dihantar', t: 'date', req: true }, { k: 'letterRef', l: 'Surat notis', req: true }, NOTE] },
  { kind: 'hrdfClaim', item: 'Z6', label: 'Tuntutan HRDF kursus CSG/TNG', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['hr', 'finance'], fields: [{ k: 'course', l: 'Kursus', t: 'select', o: ['CSG', 'TNG', 'other'], req: true }, { k: 'courseRef', l: 'Rujukan kursus / kumpulan', req: true }, { k: 'claimedOn', l: 'Tarikh tuntut', t: 'date', req: true }, { k: 'amount', l: 'Amaun (RM)', t: 'number', req: true }, { k: 'status', l: 'Status', t: 'select', o: ['submitted', 'approved', 'paid', 'rejected'], req: true }, NOTE] },
  { kind: 'ptptn', item: 'Z6', label: 'Potongan gaji PTPTN (rekod sahaja)', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['hr'], confidential: true, fields: [STAFF_NO, { k: 'monthly', l: 'Potongan sebulan (RM)', t: 'number', req: true }, { k: 'from', l: 'Mula', t: 'date', req: true }, { k: 'to', l: 'Tamat', t: 'date' }, REF] },
  { kind: 'protege', item: 'Z6', label: 'Program Protégé', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['hr'], every: 'month', window: [1, 28], fields: [{ k: 'period', l: 'Bulan (YYYY-MM)', req: true }, { k: 'quota', l: 'Kuota', t: 'number', req: true }, { k: 'placed', l: 'Peserta ditempatkan', t: 'number', req: true }, { k: 'trainingPlanRef', l: 'Pelan latihan' }, { k: 'monthlyReportRef', l: 'Laporan bulanan', req: true }, NOTE] },
  { kind: 'smeCorp', item: 'Z6', label: 'Pendaftaran SME Corp', scope: 'company', keeper: 'company_office', checker: 'company_manager', fields: [{ k: 'ref', l: 'No. pendaftaran', req: true }, { k: 'expiresOn', l: 'Tamat', t: 'date' }, { k: 'status', l: 'Status', t: 'select', o: ['applied', 'registered', 'expired'], req: true }] },
  { kind: 'newCompanySetup', item: 'Z11', label: 'Senarai semak syarikat baharu', scope: 'company', keeper: 'company_office', checker: 'company_manager', readers: ['central_admin'], fields: [{ k: 'step', l: 'Langkah', t: 'select', o: ['MOF codes KBK/BMB', 'Bumiputera status', 'EPF registration', 'SOCSO registration', 'Bank account', 'Online banking', 'Bank signatories', 'Address change with CoSec', 'Stamping', 'PBT licence', 'Director changes'], req: true }, { k: 'doneOn', l: 'Siap pada', t: 'date', req: true }, { k: 'ref', l: 'Bukti (fail / rujukan)', req: true }, NOTE] },
  { kind: 'payback', item: 'Z12', label: 'Bayaran balik pengurus (payback)', scope: 'company', keeper: 'company_office', checker: 'finance_leader', readers: ['finance'], fields: [{ k: 'manager', l: 'Pengurus zon (no. pekerja)', req: true }, { k: 'invoiceRef', l: 'Invois', req: true }, { k: 'moneyInOn', l: 'Wang masuk', t: 'date', req: true }, { k: 'amount', l: 'Amaun masuk (RM)', t: 'number', req: true }, { k: 'contributions', l: 'Potongan caruman (RM)', t: 'number' }, { k: 'csgFees', l: 'Potongan yuran CSG (RM)', t: 'number' }, { k: 'paybackOn', l: 'Tarikh bayar balik', t: 'date' }, { k: 'slipRef', l: 'Slip kepada pengurus' }, { k: 'teamsRef', l: 'Semakan Ketua dalam Teams (rujukan)' }] },
  { kind: 'principalMeeting', item: 'Z13', label: 'Mesyuarat pengetua / PPD', scope: 'company', keeper: 'om', checker: 'line_manager', every: 'month', window: [1, 28], fields: [{ k: 'school', l: 'Sekolah / PPD', req: true }, { k: 'meetingOn', l: 'Tarikh', t: 'date', req: true }, { k: 'points', l: 'Perkara dibincang', t: 'area', req: true }, REF] },
  { kind: 'branchMeeting', item: 'Z13', label: 'Mesyuarat cawangan', scope: 'company', keeper: 'om', checker: 'line_manager', every: 'month', window: [1, 28], fields: [{ k: 'meetingOn', l: 'Tarikh', t: 'date', req: true }, { k: 'attended', l: 'Hadir (bilangan)', t: 'number', req: true }, { k: 'minutesRef', l: 'Minit', req: true }] },
  { kind: 'welfareVisit', item: 'Z13', label: 'Lawatan kebajikan', scope: 'company', keeper: 'om', checker: 'line_manager', fields: [STAFF_NO, { k: 'visitedOn', l: 'Tarikh', t: 'date', req: true }, { k: 'reason', l: 'Sebab lawatan', req: true }, { k: 'outcome', l: 'Hasil', t: 'area' }] },
  { kind: 'grassSchedule', item: 'Z13', label: 'Jadual potong rumput / sampah KBK', scope: 'company', keeper: 'om', checker: 'line_manager', fields: [{ k: 'site', l: 'Tapak / sekolah', req: true }, { k: 'period', l: 'Bulan (YYYY-MM)', req: true }, { k: 'dates', l: 'Tarikh dijadualkan', req: true }, { k: 'fuelAllowance', l: 'Elaun minyak (RM)', t: 'number' }, NOTE] },
  { kind: 'clubFund', item: 'Z7', label: 'Tabung kebajikan kelab JA Group', scope: 'group', keeper: 'hr', checker: 'welfare_approver', readers: ['finance'], fields: [{ k: 'gift', l: 'Jenis', t: 'select', o: ['death', 'wedding', 'newborn', 'hospital', 'other'], req: true }, STAFF_NO, { k: 'amount', l: 'Amaun (RM)', t: 'number', req: true }, { k: 'paidRef', l: 'Bukti pindahan (Kewangan)' }, NOTE] },
  { kind: 'kuliahDhuha', item: 'Z7', label: 'Kehadiran kuliah dhuha', scope: 'group', keeper: 'hr', checker: 'none', every: 'month', window: [1, 28], fields: [{ k: 'heldOn', l: 'Tarikh', t: 'date', req: true }, { k: 'attended', l: 'Hadir (bilangan)', t: 'number', req: true }, { k: 'listRef', l: 'Senarai kehadiran (fail)' }] },
  { kind: 'annualEvent', item: 'Z7', label: 'Acara tahunan', scope: 'group', keeper: 'hr', checker: 'line_manager', readers: ['finance'], fields: [{ k: 'event', l: 'Acara', t: 'select', o: ['team building', 'family day', 'iftar', 'raya', 'other'], req: true }, { k: 'on', l: 'Tarikh', t: 'date', req: true }, { k: 'budget', l: 'Bajet (RM)', t: 'number' }, { k: 'status', l: 'Status', t: 'select', o: ['planned', 'held', 'cancelled'], req: true }, NOTE] },
  { kind: 'fwBlacklist', item: 'Z8', label: 'Senarai hitam pekerja lari', scope: 'group', keeper: 'fwm', checker: 'line_manager', confidential: true, fields: [{ k: 'workerRef', l: 'No. pekerja', req: true }, { k: 'companyRef', l: 'Syarikat' }, { k: 'reportedOn', l: 'Dilapor pada', t: 'date', req: true }, { k: 'policeRef', l: 'Laporan polis / Imigresen' }, NOTE] },
  { kind: 'kliaIntake', item: 'Z8', label: 'Ketibaan KLIA (senarai semak)', scope: 'group', keeper: 'fwm', checker: 'line_manager', readers: ['finance'], fields: [{ k: 'batchRef', l: 'Kumpulan', req: true }, { k: 'arrivedOn', l: 'Tiba', t: 'date', req: true }, { k: 'workers', l: 'Bilangan pekerja', t: 'number', req: true }, { k: 'transport', l: 'Pengangkutan ke asrama diatur', t: 'yn', req: true }, { k: 'cashAdvance', l: 'Wang pendahuluan diserah (RM)', t: 'number' }, { k: 'receiptRef', l: 'Resit serahan' }, NOTE] },
  { kind: 'translation', item: 'Z8', label: 'Terjemahan (kedutaan, Wisma Putra, mahkamah)', scope: 'group', keeper: 'fwm', checker: 'line_manager', fields: [{ k: 'for', l: 'Untuk', t: 'select', o: ['embassy', 'wisma putra', 'court', 'other'], req: true }, REF, { k: 'dueOn', l: 'Perlu siap', t: 'date', req: true }, { k: 'doneOn', l: 'Siap', t: 'date' }] },
  { kind: 'fwAgent', item: 'Z8', label: 'Daftar ejen Nepal dan aduan', scope: 'group', keeper: 'fwm', checker: 'line_manager', fields: [{ k: 'agent', l: 'Ejen (syarikat)', req: true }, { k: 'licence', l: 'No. lesen ejen' }, { k: 'complaints', l: 'Aduan', t: 'area' }, { k: 'status', l: 'Status', t: 'select', o: ['active', 'under review', 'stopped'], req: true }] },
  { kind: 'merchantrade', item: 'Z8', label: 'Status akaun Merchantrade (tiada no. akaun)', scope: 'group', keeper: 'fwm', checker: 'none', readers: ['finance', 'audit'], fields: [{ k: 'workerRef', l: 'No. pekerja', req: true }, { k: 'status', l: 'Status', t: 'select', o: ['active', 'pending', 'none', 'closed'], req: true }, { k: 'checkedOn', l: 'Disemak pada', t: 'date', req: true }] },
  { kind: 'fwSiteAudit', item: 'Z8', label: 'Audit tapak dan kaunseling', scope: 'group', keeper: 'fwm', checker: 'line_manager', fields: [{ k: 'place', l: 'Tapak / asrama', req: true }, { k: 'on', l: 'Tarikh', t: 'date', req: true }, { k: 'findings', l: 'Penemuan', t: 'area', req: true }, { k: 'counselling', l: 'Nota kaunseling (tanpa nama)', t: 'area' }] },
  { kind: 'ncr', item: 'Z9', label: 'Laporan ketidakpatuhan (NCR)', scope: 'group', keeper: 'audit', checker: 'line_manager', fields: [{ k: 'ref', l: 'No. NCR', req: true }, { k: 'area', l: 'Bahagian / syarikat', req: true }, { k: 'finding', l: 'Ketidakpatuhan', t: 'area', req: true }, { k: 'raisedOn', l: 'Dibuka', t: 'date', req: true }, { k: 'owner', l: 'Pemilik tindakan', req: true }, { k: 'dueOn', l: 'Sasaran', t: 'date', req: true }, { k: 'closedOn', l: 'Ditutup', t: 'date' }] },
  { kind: 'noDeleteTest', item: 'Z9', label: 'Ujian "tiada padam" SharePoint / Teams', scope: 'group', keeper: 'audit', checker: 'line_manager', every: 'month', window: [1, 28], fields: [{ k: 'system', l: 'Sistem', t: 'select', o: ['SharePoint', 'Teams'], req: true }, { k: 'testedOn', l: 'Diuji', t: 'date', req: true }, { k: 'result', l: 'Keputusan', t: 'select', o: ['pass', 'fail'], req: true }, NOTE] },
  { kind: 'hostelRound', item: 'Z9', label: 'Pusingan asrama Nepal (Audit)', scope: 'group', keeper: 'audit', checker: 'line_manager', fields: [{ k: 'hostel', l: 'Asrama', req: true }, { k: 'on', l: 'Tarikh', t: 'date', req: true }, { k: 'findings', l: 'Penemuan', t: 'area', req: true }] },
  { kind: 'agingReview', item: 'Z9', label: 'Analisis umur penghutang mingguan', scope: 'group', keeper: 'audit', checker: 'line_manager', every: 'week', fields: [{ k: 'weekOf', l: 'Minggu (Isnin)', t: 'date', req: true }, { k: 'ref', l: 'Laporan', req: true }, { k: 'over90', l: 'Lebih 90 hari (RM)', t: 'number' }, NOTE] },
  { kind: 'keyLog', item: 'Z10', label: 'Log salinan kunci / kad akses', scope: 'group', keeper: 'asset', checker: 'asset_director', fields: [{ k: 'unit', l: 'Unit', req: true }, { k: 'item', l: 'Kunci / kad', t: 'select', o: ['key', 'access card', 'remote'], req: true }, { k: 'count', l: 'Bilangan', t: 'number', req: true }, { k: 'reason', l: 'Sebab', req: true }, { k: 'doneOn', l: 'Dibuat pada', t: 'date', req: true }, { k: 'cost', l: 'Kos (RM)', t: 'number' }] },
  { kind: 'repairBudget', item: 'Z10', label: 'Bajet pembaikan rumah sewa (bulanan)', scope: 'group', keeper: 'asset', checker: 'asset_director', readers: ['finance'], fields: [{ k: 'period', l: 'Bulan (YYYY-MM)', req: true }, { k: 'budget', l: 'Bajet (RM)', t: 'number', req: true }] },
];
export const REG_KIND_MAP = new Map(REG_KINDS.map((k) => [k.kind, k]));

export interface RegRec {
  id: Id;
  kind: string;
  /** 'co:<companyId>' or 'group'. */
  scope: string;
  companyId: Id | null;
  status: 'draft' | 'submitted' | 'checked' | 'returned' | 'closed' | 'settings';
  d: Record<string, unknown>;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; note: string }[];
}
const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Never an IC number or a bank account number in a register (staff numbers only). */
function clean(v: string, what: string) {
  if (/\b\d{6}-?\d{2}-?\d{4}\b/.test(v)) throw new BadRequest(`${what}: no IC numbers here.`);
  if (/\b\d{10,16}\b/.test(v.replace(/[\s-]/g, ''))) throw new BadRequest(`${what}: no bank account numbers here.`);
  return v;
}
function patchOf(r: RegRec): Omit<RegRec, 'id' | 'companyId'> {
  const { id: _i, companyId: _c, ...rest } = r;
  void _i;
  void _c;
  return rest;
}

export class DutyRegisterService {
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
  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('dutyRegisterRecs'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Duty registers are not installed in this database yet (module duty-registers-v1, run by the CEO).');
  }
  private async recs(): Promise<RegRec[]> {
    if (!(await this.installed())) return [];
    return (((await this.store.list('dutyRegisterRecs', {}).catch(() => [])) as RegRec[]) ?? []).filter((r) => r.status !== 'settings');
  }
  async settings(): Promise<{ welfareApproverId: Id | null }> {
    if (!(await this.installed())) return { welfareApproverId: null };
    const r = (await this.store.get('dutyRegisterRecs', 'reg-settings').catch(() => undefined)) as RegRec | undefined;
    return { welfareApproverId: r?.kind === 'settings' && r.status === 'settings' ? ((r.d.welfareApproverId as Id | null) ?? null) : null };
  }
  private spec(kind: unknown) {
    const k = REG_KIND_MAP.get(s(kind, 40));
    if (!k) throw new BadRequest('Unknown register.');
    return k;
  }

  // ---------- who ----------
  private is(u: User, who: RegKeeper, co: Id | null): boolean {
    if (u.integration) return false;
    switch (who) {
      case 'company_office':
        return !!co && (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(co);
      case 'company_manager':
        return !!co && u.role === 'company_manager' && u.companyIds.includes(co);
      case 'om':
        return !!co && u.opsTier === 'om' && u.companyIds.includes(co);
      case 'finance':
        return u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance');
      case 'hr':
        return u.role === 'pwvsb_officer' && u.department === 'hr';
      case 'fwm':
        return u.role === 'pwvsb_officer' && u.department === 'fwm';
      case 'audit':
        return u.role === 'pwvsb_officer' && u.department === 'audit';
      case 'asset':
        return u.role === 'pwvsb_officer' && u.department === 'asset';
      case 'central_admin':
        return u.leadership === 'deputy_cos' || u.leadership === 'cos';
    }
  }
  private reads(u: User, k: RegKindSpec, co: Id | null) {
    if (u.integration) return false;
    if (this.is(u, k.keeper, co)) return true;
    if (k.confidential) return u.opsTier === 'ceo' || (u.role === 'pwvsb_officer' && u.department === 'audit') || (k.readers ?? []).some((r) => this.is(u, r, co)) || (k.keeper === 'company_office' && this.is(u, 'company_manager', co));
    return isGroupLeader(u) || (u.role === 'pwvsb_officer' && u.department === 'audit') || (k.readers ?? []).some((r) => this.is(u, r, co)) || (k.scope === 'company' && !!co && (u.role === 'company_manager' || u.role === 'director') && u.companyIds.includes(co));
  }
  private async checks(u: User, k: RegKindSpec, r: RegRec) {
    if (u.integration || u.id === r.byId || u.id === r.d.preparedById) return false;
    switch (k.checker) {
      case 'company_manager':
        return this.is(u, 'company_manager', r.companyId);
      case 'finance_leader':
        return u.financeRole === 'leader' || u.leadership === 'finance_director';
      case 'asset_director':
        return u.assetRole === 'director';
      case 'welfare_approver':
        return (await this.settings()).welfareApproverId === u.id;
      case 'line_manager': {
        const preparer = (await this.store.list('users')).find((x) => x.id === r.byId);
        return !!preparer && lineManagerOf(preparer, await this.store.list('users')).manager?.id === u.id;
      }
      case 'none':
        return false;
    }
  }

  private async save(user: User, rec: RegRec, cur: RegRec | null, note: string) {
    const next = { ...rec, history: [...(cur?.history ?? []), { at: this.now(), by: user.name, note: note.slice(0, 300) }] };
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('dutyRegisterRecs', rec.id, patchOf(next) as never);
      else await tx.insert('dutyRegisterRecs', next as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: rec.companyId, action: `register.${rec.kind}`, entity: 'duty_register_rec', entityId: rec.id, summary: note.slice(0, 300) });
      return next;
    });
  }
  private fields(k: RegKindSpec, i: Record<string, unknown>, cur?: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const f of k.fields) {
      const raw = i[f.k] ?? cur?.[f.k];
      if (raw == null || raw === '') {
        if (f.req) throw new BadRequest(`${f.l}: required.`);
        out[f.k] = null;
        continue;
      }
      if (f.t === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) throw new BadRequest(`${f.l}: a number, 0 or more.`);
        out[f.k] = Math.round(n * 100) / 100;
      } else if (f.t === 'date') {
        if (!isDate(raw)) throw new BadRequest(`${f.l}: a date.`);
        out[f.k] = raw;
      } else if (f.t === 'select' || f.t === 'yn') {
        const opts = f.t === 'yn' ? ['yes', 'no'] : (f.o ?? []);
        if (!opts.includes(String(raw))) throw new BadRequest(`${f.l}: ${opts.join(', ')}.`);
        out[f.k] = String(raw);
      } else out[f.k] = clean(s(raw, f.t === 'area' ? 2000 : 300), f.l);
      if (f.k === 'period' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(out[f.k]))) throw new BadRequest(`${f.l}: YYYY-MM.`);
    }
    if (out.staffNo && /[a-z]{3,}\s+[a-z]{3,}/i.test(String(out.staffNo))) throw new BadRequest('Give the staff number, not the name.');
    return out;
  }

  /** Add or change a record (the keeper). A checked record is not changed; a returned one is fixed and sent again. */
  async put(user: User, i: Record<string, unknown>) {
    await this.need();
    const k = this.spec(i.kind);
    const co = k.scope === 'company' ? s(i.companyId, 80) : null;
    if (k.scope === 'company' && !co) throw new BadRequest('Choose the company.');
    if (!this.is(user, k.keeper, co)) throw new AccessDenied('view', `(${k.label}: kept by ${k.keeper.replace('_', ' ')})`);
    const id = s(i.id, 160);
    const cur = id ? (((await this.store.get('dutyRegisterRecs', id).catch(() => undefined)) as RegRec | undefined) ?? null) : null;
    if (id && (!cur || cur.kind !== k.kind || cur.companyId !== co)) throw new NotFound('Register record');
    if (cur && ['checked', 'closed'].includes(cur.status)) throw new BadRequest('This record is checked; add a new one for a change.');
    const d = { ...this.fields(k, i, cur?.d), preparedBy: user.name, preparedById: user.id };
    const status: RegRec['status'] = k.checker === 'none' ? 'closed' : 'submitted';
    const rec: RegRec = { id: cur?.id ?? `reg-${k.kind}-${co ?? 'group'}-${toMs(this.now())}-${Math.random().toString(36).slice(2, 6)}`, kind: k.kind, scope: co ? `co:${co}` : 'group', companyId: co, status, d, by: cur?.by ?? user.name, byId: cur?.byId ?? user.id, at: cur?.at ?? this.now(), history: cur?.history ?? [] };
    return this.save(user, rec, cur, `${k.label}: ${cur ? 'diubah' : 'baharu'}${status === 'submitted' ? ', untuk semakan' : ''}`);
  }
  /** Check (or return with a reason): never the person who prepared it. */
  async check(user: User, i: Record<string, unknown>) {
    await this.need();
    const cur = (await this.store.get('dutyRegisterRecs', s(i.id, 160)).catch(() => undefined)) as RegRec | undefined;
    if (!cur || cur.status === 'settings') throw new NotFound('Register record');
    const k = this.spec(cur.kind);
    if (cur.status !== 'submitted') throw new BadRequest('This record is not waiting for a check.');
    if (user.id === cur.byId || user.id === cur.d.preparedById) throw new AccessDenied('view', '(nobody checks what they prepared)');
    if (!(await this.checks(user, k, cur))) {
      if (k.checker === 'welfare_approver' && !(await this.settings()).welfareApproverId) throw new BadRequest('The welfare fund approver is not set yet (the Chief of Staff sets it).');
      throw new AccessDenied('view', `(${k.label} is checked by the ${k.checker.replace('_', ' ')})`);
    }
    const verdict = s(i.verdict, 10);
    const comment = s(i.comment, 500);
    if (verdict !== 'check' && verdict !== 'return') throw new BadRequest('Check or return.');
    if (!comment) throw new BadRequest(verdict === 'check' ? 'Write a comment to check it (a short one is fine).' : 'Say why it goes back.');
    const rec: RegRec = { ...cur, status: verdict === 'check' ? 'checked' : 'returned', d: { ...cur.d, ...(verdict === 'check' ? { checkedBy: user.name, checkedOn: this.today() } : {}) } };
    return this.save(user, rec, cur, `${verdict === 'check' ? 'disemak' : 'dikembalikan'}: ${comment}`);
  }
  /** The CoS or DCoS names the welfare fund approver (a person, with a reason). */
  async setApprover(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!(user.leadership === 'cos' || user.leadership === 'deputy_cos') || user.integration) throw new AccessDenied('view', '(the Chief of Staff names the welfare fund approver)');
    const reason = s(i.reason, 300);
    if (reason.length < 3) throw new BadRequest('Say why.');
    const u = (await this.store.list('users')).find((x) => x.id === s(i.userId, 80) && !x.integration);
    if (!u) throw new BadRequest('Choose the approver.');
    const cur = ((await this.store.get('dutyRegisterRecs', 'reg-settings').catch(() => undefined)) as RegRec | undefined) ?? null;
    const rec: RegRec = { id: 'reg-settings', kind: 'settings', scope: 'group', companyId: null, status: 'settings', d: { welfareApproverId: u.id }, by: cur?.by ?? user.name, byId: cur?.byId ?? user.id, at: cur?.at ?? this.now(), history: cur?.history ?? [] };
    return this.save(user, rec, cur, `pelulus tabung kebajikan: ${u.name} (${reason})`);
  }

  /** One register: the rows the person may see, the spec, and what they may do. */
  async list(user: User, i: Record<string, unknown>) {
    const k = this.spec(i.kind);
    const co = k.scope === 'company' ? s(i.companyId, 80) || null : null;
    if (k.scope === 'company' && !co && !isGroupLeader(user) && !(user.role === 'pwvsb_officer' && ['audit', 'finance', 'hr'].includes(user.department ?? ''))) throw new BadRequest('Choose the company.');
    const rows = (await this.recs()).filter((r) => r.kind === k.kind && (!co || r.companyId === co) && this.reads(user, k, r.companyId));
    if (co && !this.reads(user, k, co)) throw new AccessDenied('view', `(${k.label})`);
    const out = [];
    for (const r of rows.sort((a, b) => b.at.localeCompare(a.at))) out.push({ id: r.id, companyId: r.companyId, status: r.status, ...r.d, canCheck: r.status === 'submitted' && (await this.checks(user, k, r)) });
    return { spec: k, rows: out, can: { add: this.is(user, k.keeper, co) } };
  }
  /** The registers a person keeps, checks or reads, with counts and what is missing this period. */
  async board(user: User, i: Record<string, unknown>) {
    const co = s(i.companyId, 80) || user.companyIds[0] || null;
    const all = await this.recs();
    const out = [];
    for (const k of REG_KINDS) {
      const scopeCo = k.scope === 'company' ? co : null;
      if (k.scope === 'company' && !scopeCo) continue;
      if (!this.reads(user, k, scopeCo)) continue;
      const rows = all.filter((r) => r.kind === k.kind && r.companyId === scopeCo);
      const waiting = [];
      for (const r of rows.filter((x) => x.status === 'submitted')) if (await this.checks(user, k, r)) waiting.push(r.id);
      out.push({ kind: k.kind, item: k.item, label: k.label, companyId: scopeCo, rows: rows.length, submitted: rows.filter((r) => r.status === 'submitted').length, toCheck: waiting.length, missing: this.missing(k, rows), keep: this.is(user, k.keeper, scopeCo) });
    }
    return { companyId: co, registers: out, newCompany: co ? await this.setupProgress(co) : null, contractsDue: co ? await this.contractsDue(user, co) : [], rentalMonth: user.department === 'asset' || isGroupLeader(user) ? await this.rentalMonth() : null };
  }
  /** "Belum direkod": a periodic register with no record this week or month once its window has opened. */
  private missing(k: RegKindSpec, rows: RegRec[]): string | null {
    if (!k.every) return null;
    const today = this.today();
    if (k.every === 'week') {
      const wd = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
      const mon = addDays(today, 1 - wd);
      return rows.some((r) => dateOf(r.at) >= mon) ? null : `minggu ${mon}`;
    }
    const month = today.slice(0, 7);
    const day = Number(today.slice(8, 10));
    if (k.window && day < k.window[0]) return null;
    return rows.some((r) => (r.d.period ?? dateOf(r.at).slice(0, 7)) === month || String(r.d.requestedOn ?? r.d.heldOn ?? r.d.meetingOn ?? r.d.testedOn ?? '').slice(0, 7) === month) ? null : `bulan ${month}`;
  }
  /** Z11: which set-up steps are done (checked) for a company. */
  private async setupProgress(co: Id) {
    const steps = (REG_KIND_MAP.get('newCompanySetup')!.fields[0].o ?? []) as string[];
    const rows = (await this.recs()).filter((r) => r.kind === 'newCompanySetup' && r.companyId === co);
    if (!rows.length) return null;
    return steps.map((st) => ({ step: st, state: rows.find((r) => r.d.step === st && r.status === 'checked') ? 'done' : rows.find((r) => r.d.step === st) ? 'to check' : 'not done' }));
  }
  /** Z5: contracts ending within 90 days without a checked termination or renewal notice (letters 1-3 months before). */
  private async contractsDue(user: User, co: Id) {
    if (!this.is(user, 'company_office', co) && !isGroupLeader(user)) return [];
    const notices = (await this.recs()).filter((r) => r.kind === 'contractNotice' && r.companyId === co);
    const contracts = (await this.store.list('contracts', { companyId: [co] }).catch(() => [])).filter((c) => c.companyId === co && ['active', 'ready', 'mobilising'].includes(c.state));
    return contracts
      .filter((c) => daysBetween(this.today(), c.endOn) <= 90 && daysBetween(this.today(), c.endOn) >= 0 && !notices.some((n) => n.d.contractRef === c.ref))
      .map((c) => ({ ref: c.ref, client: c.clientName, endOn: c.endOn, daysLeft: daysBetween(this.today(), c.endOn) }));
  }
  /** Z10: the monthly rental report (5-10hb): vacant homes, tenants leaving, repair budget against what was paid. */
  async rentalMonth(month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : this.today().slice(0, 7);
    const units = (await this.store.list('amUnits', {}).catch(() => [])) as { id: Id; type?: string; status?: string; office?: boolean; tenancy?: unknown }[];
    const homes = units.filter((u) => u.type === 'RESIDENTIAL' && !u.office);
    const recs = ((await this.store.list('amRentalRecs', {}).catch(() => [])) as { kind: string; status: string; unitId: Id; d: Record<string, unknown>; at: string }[]) ?? [];
    const leaving = recs.filter((r) => r.kind === 'moveout' && r.status !== 'closed').length;
    // What the owner companies paid contractors this month: the repair's cost once Finance recorded the payment.
    const paid = recs
      .filter((r) => r.kind === 'repair' && String((r.d.paid as { at?: string } | undefined)?.at ?? '').slice(0, 7) === m)
      .reduce((n, r) => n + Number(r.d.cost ?? 0), 0);
    const budget = (await this.recs()).filter((r) => r.kind === 'repairBudget' && r.d.period === m && r.status === 'checked').pop();
    return { month: m, homes: homes.length, vacant: homes.filter((u) => !u.tenancy).length, leaving, repairPaid: Math.round(paid * 100) / 100, repairBudget: budget ? Number(budget.d.budget) : null, over: budget ? paid > Number(budget.d.budget) : null };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (!(await this.installed())) return [];
    const items: HomeItem[] = [];
    const go = { view: 'meetings' } as HomeItem['go'];
    const b = await this.board(user, {}).catch(() => null);
    if (!b) return items;
    const toCheck = b.registers.reduce((n, r) => n + r.toCheck, 0);
    if (toCheck) items.push({ tone: 'info', tag: 'Daftar tugas', title: `${toCheck} rekod menunggu semakan anda`, detail: b.registers.filter((r) => r.toCheck).map((r) => r.label).slice(0, 3).join(', '), go });
    const miss = b.registers.filter((r) => r.keep && r.missing);
    if (miss.length) items.push({ tone: 'warn', tag: 'Daftar tugas', title: `${miss.length} daftar belum direkod`, detail: miss.map((r) => `${r.label} (${r.missing})`).slice(0, 3).join(', '), go });
    if (b.contractsDue.length) items.push({ tone: 'warn', tag: 'Notis kontrak', title: `${b.contractsDue.length} kontrak tamat dalam 90 hari tanpa notis`, detail: b.contractsDue.slice(0, 3).map((c) => `${c.ref} ${c.endOn}`).join(', '), go });
    void RULES;
    return items;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user, i);
      case 'list':
        return this.list(user, i);
      case 'put':
        return this.put(user, i);
      case 'check':
        return this.check(user, i);
      case 'setApprover':
        return this.setApprover(user, i);
      case 'rentalMonth':
        if (!(user.department === 'asset' || isGroupLeader(user)) || user.integration) throw new AccessDenied('view', '(rental report)');
        return this.rentalMonth(s(i.month, 7));
      default:
        throw new BadRequest('Unknown register action.');
    }
  }
}
export const REG_READS = ['board', 'list', 'rentalMonth'];
