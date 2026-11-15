// Part W (Fitri package, Fauzan's answers W-X1..W-X13, 14 Nov 2026): the KDN private agency licence renewal 2027 made to
// match KDN. The yearly KDN checklist (Lampiran C) as the paper list, each paper with its file and date check, hints
// from what Prima holds, the eSIMS update, the appointment in a Hari Bertemu Pelanggan session and the result of the
// day, the director's signature, Finance's no-SST-arrears tick, the CSG/TNG counts confirmed by the company head,
// Nepali guards in eSIMS, the 2(b) investigators line, the anti-corruption pledge kept for ACT, the pendrive pack and
// the group board for 31 December. Prima records only: it never logs in to eSIMS, never lodges and never pays.
import { AccessDenied, isGroupLeader } from './access';
import { isCorpAdminOwner } from './central-admin';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService, type ProofInput } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween } from './time';
import type { CompanyLicence, Id, IsoDate, IsoDateTime, RenewalCase, RenewalMark, User } from './types';
import { zipFiles } from './am-bq-xlsx';

export type KdnCheck = 'esims' | 'since' | 'pledge' | 'months' | 'year' | 'insurance' | 'statement' | 'counts' | 'declaration';
export interface KdnPaperSpec {
  item: string;
  label: string;
  name: string;
  form: 'hardcopy' | 'softcopy';
  ifApplicable?: boolean;
  check?: KdnCheck;
  since?: IsoDate;
  from?: string;
  to?: string;
  year?: number;
  count?: 'CSG' | 'TNG';
}
export interface KdnTemplate {
  year: number;
  lines: KdnPaperSpec[];
}
export interface KdnWindow {
  year: number;
  opens: IsoDate;
  closes: IsoDate;
  hours: string;
  sessions: { no: number; from: IsoDate; to: IsoDate }[];
  returnOnlySessions: number[];
  openBy: IsoDate;
  bookBy: IsoDate;
  acceptBy: IsoDate;
  place: string;
}
/** What the company recorded for one KDN paper (beside the shared done mark). */
export interface KdnPaperState {
  item: string;
  label: string;
  form: 'hardcopy' | 'softcopy';
  ifApplicable: boolean;
  /** Not applicable (2.1 only), with the reason. */
  na: string | null;
  docIds: Id[];
  docNames: string[];
  /** The date facts the check used: the paper's date, months covered, year, statement month. */
  facts: Record<string, unknown>;
}
export interface KdnCounts {
  local: number;
  nepali: number;
  csg: { notTrained: number; unknown: number };
  tng: { notTrained: number; unknown: number };
}
export interface KdnCase {
  year: number;
  /** The template lines copied when the renewal opened: a later template change never alters an open renewal. */
  lines: KdnPaperSpec[];
  esims: RenewalMark | null;
  /** 2(b): every group company holds one (W-X9); Central Admin unticks it only with a reason. */
  twoB: boolean;
  twoBOff: RenewalMark | null;
  investigators: RenewalMark | null;
  appointment: { session: number; on: IsoDate; time: string; ref: string; attendee: string; by: string; byId: Id; at: IsoDateTime } | null;
  appointmentChanges: (RenewalMark & { from: string })[];
  results: (RenewalMark & { kind: 'accepted' | 'lacking' | 'counter'; on: IsoDate; ref: string | null; lacking: string[] })[];
  /** The company manager checked the papers before the director signs. */
  checked: RenewalMark | null;
  counts: (KdnCounts & RenewalMark) | null;
  director: { name: string; position: string } | null;
}
/** Group-level and per-company KDN records kept apart from the licence row. */
export interface KdnRec {
  id: Id;
  kind: 'template' | 'window' | 'sst' | 'esims' | 'pledge';
  companyId: Id | null;
  year: number;
  d: Record<string, unknown>;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; note: string }[];
}

// Browser-safe base64 (the demo runs this service in the browser; no Node Buffer).
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toB64(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** A row update never carries its id or company (the store refuses to change them). */
function patchOf<T extends { id: unknown; companyId: unknown }>(r: T): Omit<T, 'id' | 'companyId'> {
  const { id: _id, companyId: _co, ...rest } = r;
  void _id;
  void _co;
  return rest;
}
const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const prevMonth = (d: IsoDate) => {
  const [y, m] = d.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const MONTH_BM = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const monthBm = (p: string) => `${MONTH_BM[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) (m = 1), y++;
  }
  return out;
};
const short = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/[:,]/)[0]
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');

/** The anti-bribery guide line shown on the renewal screen (W8). */
export const KDN_GIFT_LINE = {
  bm: 'Jangan beri, janji atau tawar apa-apa kepada pegawai KDN. Hadiah atau permintaan direkod dalam daftar hadiah dan dilapor kepada ACT.',
  en: 'Never give, promise or offer anything to a KDN officer. Any gift or request goes in the gifts register and is reported to ACT.',
};
/** What the director reads before signing (W7, WL3). */
export const KDN_DECLARATION = {
  bm: 'Saya mengaku bahawa semua maklumat dan dokumen yang dikemukakan adalah benar. Maklumat palsu boleh menyebabkan permohonan ditolak atau lesen dibatalkan.',
  en: 'I declare that all information and papers given are true. False information can lead to the application being refused or the licence cancelled.',
};

export class KdnRenewalService {
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
  private async hasRecs() {
    return !this.store.hasTable || (await this.store.hasTable('kdnRecs'));
  }
  private async recs(): Promise<KdnRec[]> {
    return (await this.hasRecs()) ? ((await this.store.list('kdnRecs', {}).catch(() => [])) as KdnRec[]) : [];
  }
  /** The template and window in force for a licence year: a saved setting, or the rule's default. */
  async template(year = RULES.kdnRenewal.value.template.year): Promise<KdnTemplate> {
    const saved = (await this.recs()).find((r) => r.kind === 'template' && r.year === year);
    return saved ? (saved.d as unknown as KdnTemplate) : structuredClone(RULES.kdnRenewal.value.template);
  }
  async window(year = RULES.kdnRenewal.value.window.year): Promise<KdnWindow> {
    const saved = (await this.recs()).find((r) => r.kind === 'window' && r.year === year);
    return saved ? (saved.d as unknown as KdnWindow) : structuredClone(RULES.kdnRenewal.value.window);
  }

  // ---------- who ----------
  private central(u: User) {
    return isCorpAdminOwner(u);
  }
  private companyStaff(u: User, companyId: Id) {
    return !u.integration && (u.role === 'company_manager' || u.role === 'admin_exec' || u.role === 'director') && u.companyIds.includes(companyId);
  }
  private head(u: User, companyId: Id) {
    return !u.integration && (u.role === 'company_manager' || u.role === 'director') && u.companyIds.includes(companyId);
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance'));
  }
  private fwm(u: User) {
    return !u.integration && u.role === 'pwvsb_officer' && u.department === 'fwm' && u.fwmRole !== 'despatch';
  }
  /** A director of THIS company: a director sign-in of the company, or a company sign-in named on its board register. */
  private async director(u: User, companyId: Id) {
    if (u.integration || !u.companyIds.includes(companyId)) return null;
    const profile = (await this.store.list('corpProfiles', { companyId: [companyId] }).catch(() => [])).find((p) => p.companyId === companyId);
    const named = profile?.directors.find((d) => d.name.trim().toLowerCase() === u.name.trim().toLowerCase());
    if (u.role === 'director') return { name: u.name, position: u.title || 'Pengarah' };
    if (named && (u.role === 'company_manager' || u.role === 'admin_exec')) return { name: u.name, position: 'Pengarah' };
    return null;
  }

  // ---------- the licence ----------
  private async licence(id: unknown) {
    const l = await this.store.get('licences', s(id, 120));
    if (!l || l.type !== 'KDN_LICENCE') throw new NotFound('KDN renewal');
    return l;
  }
  private async save(user: User, l: CompanyLicence, r: RenewalCase | null, action: string, summary: string, extra: Partial<CompanyLicence> = {}) {
    return this.store.transaction(async (tx) => {
      await tx.update('licences', l.id, { renewal: r, ...extra });
      await tx.audit({ at: this.now(), actor: user.name, companyId: l.companyId, action: `renewal.kdn.${action}`, entity: 'licence', entityId: l.id, summary: summary.slice(0, 300) });
      return (await tx.get('licences', l.id))!;
    });
  }
  private mark(user: User, note?: string | null): RenewalMark {
    return { by: user.name, byId: user.id, at: this.now(), note: note ?? null };
  }
  private kdn(r: RenewalCase | null | undefined): KdnCase {
    if (!r?.kdn) throw new BadRequest('Open the KDN renewal first.');
    return r.kdn;
  }

  /** W1: opening copies the template of its year; a later template change does not touch it. */
  async open(user: User, licenceId: Id) {
    const l = await this.licence(licenceId);
    if (!this.companyStaff(user, l.companyId)) throw new AccessDenied('view', '(the company renews; Central Admin monitors)');
    if (l.renewal) throw new BadRequest('This renewal is already open.');
    const t = await this.template();
    const papers = t.lines.map((x) => ({ name: `${x.item} ${x.name}`, done: null, ref: null, kdn: { item: x.item, label: x.label, form: x.form, ifApplicable: !!x.ifApplicable, na: null, docIds: [], docNames: [], facts: {} } as KdnPaperState }));
    const r: RenewalCase = {
      openedOn: this.today(),
      openedBy: user.name,
      openedById: user.id,
      papers,
      signed: null,
      fee: null,
      submitted: null,
      agencyNotes: [],
      returns: [],
      renewed: null,
      confirmed: null,
      kdn: { year: t.year, lines: structuredClone(t.lines), esims: null, twoB: true, twoBOff: null, investigators: null, appointment: null, appointmentChanges: [], results: [], checked: null, counts: null, director: null },
    };
    return this.save(user, l, r, 'open', `KDN ${t.year}: renewal opened with the KDN checklist (${t.lines.length} lines).`);
  }

  /** W2: a KDN paper is ready only with its file and a passing date check; "not applicable" needs a reason. */
  async paper(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.companyStaff(user, l.companyId)) throw new AccessDenied('view', '(the company prepares its own papers)');
    const r = structuredClone(l.renewal ?? null);
    const k = this.kdn(r);
    if (r!.signed) throw new BadRequest('The director has signed; send it back to change a paper.');
    const idx = r!.papers.findIndex((p) => p.kdn?.item === s(i.item, 10));
    if (idx < 0) throw new BadRequest('Choose a paper on the KDN checklist.');
    const p = r!.papers[idx];
    const spec = k.lines.find((x) => x.item === p.kdn!.item)!;
    if (i.untick === true) {
      p.done = null;
      p.kdn = { ...p.kdn!, na: null };
      k.checked = null;
      return this.save(user, l, r, 'paper', `${spec.item}: unticked.`);
    }
    const st = p.kdn!;
    if (i.na === true) {
      if (!spec.ifApplicable) throw new BadRequest(`${spec.item} is needed from every company.`);
      const why = s(i.reason, 300);
      if (why.length < 3) throw new BadRequest('Say why it does not apply (for example: the company holds no firearm licence).');
      p.done = this.mark(user, `not applicable: ${why}`);
      p.kdn = { ...st, na: why };
      return this.save(user, l, r, 'paper', `${spec.item}: not applicable, ${why}.`);
    }
    const proofs = Array.isArray(i.docs) ? (i.docs as ProofInput[]) : [];
    if (!proofs.length && !st.docIds.length) throw new BadRequest(spec.form === 'softcopy' ? 'Lampirkan fail PDF. (Attach the PDF.)' : 'Lampirkan imbasan salinan bertandatangan. (Attach the scan of the signed paper.)');
    const facts: Record<string, unknown> = {};
    const appt = k.appointment?.on ?? null;
    const refuse = (bm: string) => {
      throw new BadRequest(bm);
    };
    switch (spec.check) {
      case 'since': {
        if (!isDate(i.docDate)) refuse('Beri tarikh pada dokumen. (Give the date printed on the paper.)');
        if (String(i.docDate) < spec.since!) refuse(`Dokumen bertarikh ${i.docDate}: KDN mahu bertarikh ${spec.since} atau selepas. Dapatkan cetakan baharu.`);
        if (String(i.docDate) > this.today()) refuse('Tarikh dokumen tidak boleh pada masa hadapan.');
        facts.docDate = i.docDate;
        break;
      }
      case 'months': {
        if (!isMonth(i.from) || !isMonth(i.to)) refuse('Beri bulan pertama dan terakhir yang diliputi (YYYY-MM).');
        if (String(i.from) > spec.from! || String(i.to) < spec.to!) refuse(`Mesti meliputi ${monthBm(spec.from!)} hingga ${monthBm(spec.to!)}.`);
        facts.from = i.from;
        facts.to = i.to;
        break;
      }
      case 'year': {
        if (Number(i.year) !== spec.year) refuse(`KDN mahu dokumen tahun ${spec.year}.`);
        facts.year = spec.year;
        if (spec.item === '3.3' && i.both !== true) refuse('Lampirkan kedua-dua: bukti ansuran cukai CP204 2026 dan pengesahan bayaran SST 2026.');
        break;
      }
      case 'statement': {
        if (!isMonth(i.month)) refuse('Beri bulan penyata bank (YYYY-MM).');
        const need = prevMonth(appt ?? this.today());
        if (String(i.month) < need) refuse(`Penyata ${monthBm(String(i.month))} terlalu lama: KDN mahu bulan penuh sebelum janji temu (${monthBm(need)}).`);
        facts.month = i.month;
        break;
      }
      case 'insurance': {
        const on = appt ?? this.today();
        const pols = (await this.store.list('insurancePolicies', { companyId: [l.companyId] })).filter((x) => x.companyId === l.companyId && x.status !== 'cancelled' && x.startsOn <= on && x.expiresOn >= on);
        const missing = (['PROFESSIONAL_INDEMNITY', 'PUBLIC_LIABILITY', 'GROUP_PERSONAL_ACCIDENT'] as const).filter((kind) => !pols.some((x) => x.kind === kind));
        const bm = { PROFESSIONAL_INDEMNITY: 'Indemniti Profesional', PUBLIC_LIABILITY: 'Liabiliti Awam', GROUP_PERSONAL_ACCIDENT: 'Kemalangan Diri Berkumpulan' };
        if (missing.length) refuse(`Tiada polisi berkuat kuasa pada ${on}: ${missing.map((m) => bm[m]).join(', ')}.`);
        facts.on = on;
        break;
      }
      case 'counts': {
        if (!k.counts) refuse('Ketua syarikat sahkan bilangan CSG/TNG dahulu. (The company head confirms the counts first.)');
        facts.notTrained = spec.count === 'TNG' ? k.counts!.tng.notTrained : k.counts!.csg.notTrained;
        break;
      }
      case 'pledge':
      case 'esims':
      case 'declaration':
      default:
        break;
    }
    // Files are kept only once the checks pass, so a refused paper can be sent again with the same file.
    const docs = proofs.length ? await this.svc.kdnSaveDocs(user, l.companyId, proofs, spec.form === 'softcopy') : [];
    if (!docs.length && !st.docIds.length) throw new BadRequest('Lampirkan fail. (Attach the file.)');
    p.done = this.mark(user, s(i.ref, 120) || null);
    p.ref = s(i.ref, 120) || null;
    p.kdn = { ...st, na: null, docIds: [...new Set([...st.docIds, ...docs.map((d: { id: Id }) => d.id)])], docNames: [...st.docNames, ...docs.map((d: { name: string }) => d.name)], facts };
    const saved = await this.save(user, l, r, 'paper', `${spec.item} (label ${spec.label}) ready${docs.length ? ` with ${docs.length} file(s)` : ''}.`);
    if (spec.check === 'pledge') await this.filePledge(user, l.companyId, k.year, s(i.signer, 120) || null);
    return saved;
  }
  /** W8: the pledge goes in the company's anti-bribery file for ACT (MACC s.17A), with the year and the signer. */
  private async filePledge(user: User, companyId: Id, year: number, signer: string | null) {
    if (!(await this.hasRecs())) return;
    const id = `kdn-pledge-${companyId}-${year}`;
    const at = this.now();
    const cur = await this.store.get('kdnRecs', id).catch(() => undefined);
    const rec: KdnRec = { id, kind: 'pledge', companyId, year, d: { signer, filedBy: user.name }, by: user.name, byId: user.id, at, history: [...((cur as KdnRec | undefined)?.history ?? []), { at, by: user.name, note: `pledge ${year}${signer ? `, signed by ${signer}` : ''}` }] };
    await this.store.transaction(async (tx) => {
      if (cur) await tx.update('kdnRecs', id, patchOf(rec) as never);
      else await tx.insert('kdnRecs', rec as never);
      await tx.audit({ at, actor: user.name, companyId, action: 'act.antibribery.kdn_pledge', entity: 'kdn_rec', entityId: id, summary: `Ikrar Anti Rasuah ${year} filed for the anti-bribery programme (MACC s.17A).` });
    });
  }

  /** W5a / W11: eSIMS updated; private investigators updated in eSIMS. */
  async esimsStep(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.companyStaff(user, l.companyId)) throw new AccessDenied('view', '(the company records its eSIMS work)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    const on = isDate(i.on) ? String(i.on) : this.today();
    if (on > this.today()) throw new BadRequest('The date cannot be in the future.');
    if (i.what === 'investigators') {
      k.investigators = this.mark(user, on);
      return this.save(user, l, r, 'investigators', `Private investigators updated in eSIMS on ${on}.`);
    }
    k.esims = this.mark(user, on);
    return this.save(user, l, r, 'esims', `eSIMS renewal details updated and sent on ${on}.`);
  }
  /** W11: Central Admin unticks 2(b) for a company only with a reason (or ticks it back). */
  async twoB(user: User, i: Record<string, unknown>) {
    if (!this.central(user)) throw new AccessDenied('view', '(Central Admin)');
    const l = await this.licence(i.licenceId);
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason.');
    k.twoB = i.on === true;
    k.twoBOff = k.twoB ? null : this.mark(user, why);
    return this.save(user, l, r, 'two_b', `2(b) ${k.twoB ? 'on' : 'off'}: ${why}`);
  }

  private session(w: KdnWindow, no: number) {
    return w.sessions.find((x) => x.no === no) ?? null;
  }
  private weekday(d: IsoDate) {
    const n = new Date(`${d}T00:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5;
  }
  /** W5b: the appointment booked in eSIMS Janji Temu, inside a session that is still to come. */
  async appointment(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.companyStaff(user, l.companyId)) throw new AccessDenied('view', '(the company books its own appointment)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    const w = await this.window(k.year);
    const no = Number(i.session);
    const ses = this.session(w, no);
    if (!ses) throw new BadRequest('Choose the session.');
    if (!isDate(i.on) || String(i.on) < ses.from || String(i.on) > ses.to || !this.weekday(String(i.on))) throw new BadRequest(`Tarikh mesti dalam sesi ${no} (${ses.from} hingga ${ses.to}, Isnin-Jumaat).`);
    if (String(i.on) < this.today()) throw new BadRequest('That session date has passed.');
    if (w.returnOnlySessions.includes(no) && !k.results.some((x) => x.kind === 'lacking')) throw new BadRequest(`Sesi ${no} hanya untuk syarikat yang dikembalikan kerana dokumen tidak lengkap. Pilih sesi lain.`);
    const ref = s(i.ref, 60);
    if (ref.length < 3) throw new BadRequest('Give the eSIMS appointment reference.');
    const attendee = s(i.attendee, 120);
    if (attendee.length < 2) throw new BadRequest("Name who will attend (the company's own manager or admin executive).");
    if (k.appointment && !k.results.some((x) => x.at > k.appointment!.at)) {
      const why = s(i.reason, 300);
      if (why.length < 3) throw new BadRequest('Changing the appointment needs a reason.');
      k.appointmentChanges.push({ ...this.mark(user, why), from: `${k.appointment.session} ${k.appointment.on} ${k.appointment.time}` });
    }
    k.appointment = { session: no, on: String(i.on), time: s(i.time, 10) || '08:00', ref, attendee, by: user.name, byId: user.id, at: this.now() };
    return this.save(user, l, r, 'appointment', `Janji temu: sesi ${no}, ${i.on} ${k.appointment.time}, ref ${ref}, ${attendee}.`);
  }
  /** W5c: the result of the day: accepted, papers lacking (named papers back to not ready), or counter drop. */
  async result(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.companyStaff(user, l.companyId)) throw new AccessDenied('view', '(the company records the result)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    if (!k.appointment) throw new BadRequest('Record the appointment first.');
    const kind = (['accepted', 'lacking', 'counter'] as const).find((x) => x === i.kind);
    if (!kind) throw new BadRequest('Accepted, papers lacking, or left at the counter?');
    const on = isDate(i.on) ? String(i.on) : this.today();
    if (on > this.today()) throw new BadRequest('The date cannot be in the future.');
    if (kind === 'accepted') {
      if (!r.signed) throw new BadRequest('The director signs before the papers go to KDN.');
      if (!r.fee) throw new BadRequest('Record the Finance payment reference for the fee first, or "no fee".');
      k.results.push({ ...this.mark(user), kind, on, ref: s(i.ref, 80) || null, lacking: [] });
      r.submitted = { ...this.mark(user), ref: s(i.ref, 80) || `KDN ${on}`, on };
      return this.save(user, l, r, 'accepted', `KDN: lengkap, diterima on ${on}${i.ref ? `, ref ${s(i.ref, 80)}` : ''}.`);
    }
    if (kind === 'counter') {
      k.results.push({ ...this.mark(user, 'tidak disemak hari yang sama, akan lewat'), kind, on, ref: s(i.ref, 80) || null, lacking: [] });
      return this.save(user, l, r, 'counter', `Dihantar di kaunter on ${on}: not checked the same day, the renewal will be late.`);
    }
    const lacking = (Array.isArray(i.lacking) ? (i.lacking as unknown[]) : []).map((x) => s(x, 10)).filter((x) => k.lines.some((y) => y.item === x));
    if (!lacking.length) throw new BadRequest('List what KDN asked for (the checklist items).');
    for (const p of r.papers) if (p.kdn && lacking.includes(p.kdn.item)) (p.done = null), (p.kdn = { ...p.kdn, na: null, docIds: [], docNames: [], facts: {} });
    k.results.push({ ...this.mark(user, s(i.note, 300) || null), kind, on, ref: null, lacking });
    k.appointment = null;
    k.checked = null;
    r.signed = null;
    k.director = null;
    return this.save(user, l, r, 'lacking', `KDN: dokumen tidak lengkap on ${on}: ${lacking.join(', ')}. A new appointment is needed.`);
  }

  /** W9: per company, ACTIVE LOCAL guards without CSG / TNG; no record at all = unknown; Nepali guards not counted. */
  async counts(companyId: Id): Promise<KdnCounts> {
    const [people, creds] = await Promise.all([this.store.list('people', { companyId: [companyId] }), this.store.list('credentials', { companyId: [companyId] })]);
    const guards = people.filter((p) => p.companyId === companyId && p.status === 'active' && p.role !== 'office');
    const local = guards.filter((p) => p.nationality === 'MY');
    const by = new Map<Id, Set<string>>();
    for (const c of creds) if (c.issuedOn <= '2026-12-31') (by.get(c.personId) ?? by.set(c.personId, new Set()).get(c.personId)!).add(c.type);
    const tally = (type: string) => {
      let notTrained = 0;
      let unknown = 0;
      for (const p of local) {
        const mine = by.get(p.id);
        if (!mine || !mine.size) unknown++;
        else if (!mine.has(type)) notTrained++;
      }
      return { notTrained, unknown };
    };
    return { local: local.length, nepali: guards.length - local.length, csg: tally('CSG_TRAINING'), tng: tally('TNG_TRAINING') };
  }
  /** W9 (W-X7): the company head confirms the two numbers with a reason; they are frozen on the renewal. */
  async confirmCounts(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.head(user, l.companyId)) throw new AccessDenied('view', '(the company head confirms the CSG and TNG counts)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    if (r.signed) throw new BadRequest('Already signed; send it back to change the counts.');
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give a reason (for example: checked against the JA records).');
    const c = await this.counts(l.companyId);
    k.counts = { ...c, ...this.mark(user, why) };
    return this.save(user, l, r, 'counts', `CSG not trained ${c.csg.notTrained} (unknown ${c.csg.unknown}), TNG not trained ${c.tng.notTrained} (unknown ${c.tng.unknown}); ${c.nepali} Nepali guards not counted. ${why}`);
  }

  /** W10: Nepali guards of the company marked entered in eSIMS. */
  async nepali(companyId: Id) {
    const [people, recs] = await Promise.all([this.store.list('people', { companyId: [companyId] }), this.recs()]);
    const np = people.filter((p) => p.companyId === companyId && p.status === 'active' && p.role !== 'office' && p.nationality === 'NP');
    const marked = new Set(recs.filter((r) => r.kind === 'esims').map((r) => String(r.d.personId)));
    return { entered: np.filter((p) => marked.has(p.id)).length, total: np.length, missing: np.filter((p) => !marked.has(p.id)).map((p) => p.staffNo) };
  }
  async fwEsims(user: User, i: Record<string, unknown>) {
    if (!this.fwm(user)) throw new AccessDenied('view', '(FWM marks foreign guards entered in eSIMS)');
    if (!(await this.hasRecs())) throw new BadRequest('KDN records are not installed in this database yet (module kdn-renewal-v1, run by the CEO).');
    const p = await this.store.get('people', s(i.personId, 120));
    if (!p || p.nationality !== 'NP') throw new BadRequest('Choose a Nepali guard.');
    const on = isDate(i.on) ? String(i.on) : this.today();
    if (on > this.today()) throw new BadRequest('The date cannot be in the future.');
    const id = `kdn-esims-${p.id}`;
    const at = this.now();
    const cur = (await this.store.get('kdnRecs', id).catch(() => undefined)) as KdnRec | undefined;
    const rec: KdnRec = { id, kind: 'esims', companyId: p.companyId, year: RULES.kdnRenewal.value.window.year, d: { personId: p.id, staffNo: p.staffNo, on }, by: user.name, byId: user.id, at, history: [...(cur?.history ?? []), { at, by: user.name, note: `Dimasukkan dalam eSIMS ${on}` }] };
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('kdnRecs', id, patchOf(rec) as never);
      else await tx.insert('kdnRecs', rec as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'fwm.esims', entity: 'person', entityId: p.id, summary: `${p.companyId} ${p.staffNo}: entered in eSIMS on ${on}.` });
      return rec;
    });
  }

  /** W12: Finance ticks no SST arrears with JKDM for the company (MySST statement reference). */
  async sst(user: User, i: Record<string, unknown>) {
    if (!this.finance(user)) throw new AccessDenied('view', '(Finance confirms no SST arrears)');
    if (!(await this.hasRecs())) throw new BadRequest('KDN records are not installed in this database yet (module kdn-renewal-v1, run by the CEO).');
    const companyId = s(i.companyId, 60);
    if (!(await this.store.get('companies', companyId))) throw new BadRequest('Choose the company.');
    const ref = s(i.ref, 80);
    if (ref.length < 3) throw new BadRequest('Give the MySST statement reference.');
    const on = isDate(i.on) ? String(i.on) : this.today();
    if (on > this.today()) throw new BadRequest('The date cannot be in the future.');
    const year = RULES.kdnRenewal.value.window.year;
    const id = `kdn-sst-${companyId}-${year}`;
    const at = this.now();
    const cur = (await this.store.get('kdnRecs', id).catch(() => undefined)) as KdnRec | undefined;
    const rec: KdnRec = { id, kind: 'sst', companyId, year, d: { on, ref }, by: user.name, byId: user.id, at, history: [...(cur?.history ?? []), { at, by: user.name, note: `Tiada tunggakan SST (${ref}, ${on})` }] };
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('kdnRecs', id, patchOf(rec) as never);
      else await tx.insert('kdnRecs', rec as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'finance.sst_clear', entity: 'kdn_rec', entityId: id, summary: `${companyId}: no SST arrears with JKDM, MySST ${ref} on ${on}.` });
      return rec;
    });
  }
  private async sstFor(companyId: Id, year: number) {
    return (await this.recs()).find((r) => r.kind === 'sst' && r.companyId === companyId && r.year === year) ?? null;
  }

  /** W7: the company manager checks the papers before the director signs. */
  async check(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!(user.role === 'company_manager' && user.companyIds.includes(l.companyId))) throw new AccessDenied('view', '(the company manager checks the papers)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    const missing = r.papers.filter((p) => !p.done && p.kdn?.item !== '1.1' && p.kdn?.item !== 'Akhir').map((p) => p.kdn?.item);
    if (missing.length) throw new BadRequest(`Belum sedia: ${missing.join(', ')}.`);
    k.checked = this.mark(user, s(i.note, 300) || 'semak');
    return this.save(user, l, r, 'checked', `Papers checked by the company manager.`);
  }
  /** What still stops the director from signing (shown on the screen and enforced at sign). */
  async signBlocks(l: CompanyLicence) {
    const r = l.renewal;
    const k = r?.kdn;
    if (!r || !k) return ['Open the KDN renewal first.'];
    const out: string[] = [];
    // 1.1 (the eSIMS confirmation) and the declaration are signed by the director now; every other paper must be ready.
    const missing = r.papers.filter((p) => !p.done && p.kdn?.item !== '1.1' && p.kdn?.item !== 'Akhir').map((p) => p.kdn?.item);
    if (missing.length) out.push(`Papers not ready: ${missing.join(', ')}`);
    if (!k.esims) out.push('eSIMS update not recorded');
    if (k.twoB && !k.investigators) out.push('Private investigators (2(b)) not updated in eSIMS');
    if (!k.counts) out.push('CSG/TNG counts not confirmed by the company head');
    if (!k.checked) out.push('The company manager has not checked the papers');
    const np = await this.nepali(l.companyId);
    if (np.entered < np.total) out.push(`Pengawal Nepal dalam eSIMS: ${np.entered} / ${np.total}`);
    if (!(await this.sstFor(l.companyId, k.year))) out.push('SST belum disahkan (Finance)');
    return out;
  }
  /** W7, W10, W12: a director of this company signs the checklist, the eSIMS confirmation and the pledge. */
  async sign(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    const dir = await this.director(user, l.companyId);
    if (!dir) throw new AccessDenied('view', '(a director of this company signs the KDN papers)');
    const r = structuredClone(l.renewal!);
    const k = this.kdn(r);
    if (r.signed) throw new BadRequest('Already signed.');
    if (r.papers.some((p) => p.done?.byId === user.id) || k.checked?.byId === user.id) throw new BadRequest('You prepared or checked these papers, so another director signs.');
    const blocks = await this.signBlocks(l);
    if (blocks.length) throw new BadRequest(`Cannot sign yet: ${blocks.join('; ')}.`);
    if (i.declaration !== true) throw new BadRequest('Read and tick the declaration first.');
    for (const p of r.papers) if (!p.done && (p.kdn?.item === '1.1' || p.kdn?.item === 'Akhir')) p.done = this.mark(user, 'signed by the director');
    r.signed = this.mark(user, `director: ${dir.name}`);
    k.director = dir;
    return this.save(user, l, r, 'sign', `Signed by a director (${dir.name}, ${dir.position}): checklist, eSIMS confirmation and anti-corruption pledge.`);
  }

  /** W13: the pendrive pack for ONE company: soft copies renamed by KDN label, the cover list and the hardcopy list. */
  async pack(user: User, i: Record<string, unknown>) {
    const l = await this.licence(i.licenceId);
    if (!this.companyStaff(user, l.companyId) && !this.central(user)) throw new AccessDenied('view', "(the company's own staff and Central Admin)");
    const r = l.renewal;
    const k = this.kdn(r);
    const files: { name: string; data: Uint8Array }[] = [];
    const lines: string[] = [`Senarai semak KDN ${k.year} - ${l.companyId} - lesen ${l.reference}`, ''];
    for (const p of r!.papers) {
      const st = p.kdn!;
      const spec = k.lines.find((x) => x.item === st.item)!;
      lines.push(`[${p.done ? 'x' : ' '}] ${st.item} (label ${st.label}, ${st.form === 'hardcopy' ? 'HARDCOPY' : 'PDF'}) ${spec.name}${st.na ? ` - tidak berkenaan: ${st.na}` : ''}`);
      if (st.form !== 'softcopy') continue;
      let n = 0;
      for (const id of st.docIds) {
        const doc = await this.svc.kdnDoc(id);
        // Never another company's file in this company's pack.
        if (!doc || doc.companyId !== l.companyId) continue;
        n++;
        const ext = doc.mime === 'application/pdf' ? 'pdf' : doc.mime === 'image/png' ? 'png' : 'jpg';
        const name = `${st.label.padStart(2, '0')}_${st.item}_${short(spec.name)}${n > 1 ? `_${n}` : ''}.${ext}`;
        files.push({ name, data: fromB64(doc.data.slice(doc.data.indexOf(',') + 1)) });
      }
    }
    lines.push('', 'Bawa (hardcopy): 1.1 pengesahan eSIMS bertandatangan, 1.4 ikrar anti rasuah, senarai semak bertandatangan, COP SYARIKAT dengan alamat penuh ibu pejabat.');
    lines.push(`Janji temu: ${k.appointment ? `sesi ${k.appointment.session}, ${k.appointment.on} ${k.appointment.time}` : 'belum'}`);
    lines.push('', KDN_GIFT_LINE.bm);
    files.unshift({ name: '00_Senarai_semak.txt', data: new TextEncoder().encode(lines.join('\r\n')) });
    const zip = zipFiles(files);
    await this.store.transaction(async (tx) => {
      await tx.audit({ at: this.now(), actor: user.name, companyId: l.companyId, action: 'renewal.kdn.pack', entity: 'licence', entityId: l.id, summary: `KDN pack downloaded (${files.length - 1} file(s)).` });
    });
    return { name: `KDN_${k.year}_${l.companyId}.zip`, base64: toB64(zip), files: files.map((f) => f.name) };
  }

  /** W3: facts Prima holds, shown beside the paper as a hint (never the paper itself). */
  async hints(user: User, l: CompanyLicence) {
    const out: Record<string, string[]> = {};
    const fin = (await this.store.list('finStatus', { companyId: [l.companyId] }).catch(() => [])).find((f) => f.companyId === l.companyId);
    const months = monthsBetween('2026-01', '2026-07');
    const stat = (re: RegExp, item: string, label: string) => {
      const reg = (fin?.regular ?? []).find((x) => x.body && re.test(x.body));
      if (!reg) return void (out[item] = [`${label}: tiada rekod bayaran tetap dalam Kewangan`]);
      out[item] = months.filter((m) => !reg.dues.some((d) => d.period === m && (d.paymentId || d.debited))).map((m) => `${label} ${monthBm(m)} tiada rekod`);
      if (!out[item].length) out[item] = [`${label}: Jan-Jul 2026 semua direkod`];
    };
    if (fin) {
      stat(/EPF|KWSP/i, '3.1', 'KWSP');
      stat(/PERKESO|SOCSO/i, '3.2', 'PERKESO');
      stat(/HRD|PSMB/i, '3.4', 'HRD Corp');
      out['3.5'] = [fin.auditedTo ? `Akaun beraudit hingga ${fin.auditedTo.date}` : 'Tiada tarikh akaun beraudit'];
      out['3.7'] = [`${fin.banks.length} akaun bank syarikat dalam Kewangan`];
    }
    const pols = (await this.store.list('insurancePolicies', { companyId: [l.companyId] }).catch(() => [])).filter((x) => x.companyId === l.companyId && x.status !== 'cancelled');
    const latest = (kind: string) => pols.filter((x) => x.kind === kind).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0];
    out['3.6'] = (['PROFESSIONAL_INDEMNITY', 'PUBLIC_LIABILITY', 'GROUP_PERSONAL_ACCIDENT'] as const).map((kind) => {
      const p = latest(kind);
      const bm = { PROFESSIONAL_INDEMNITY: 'Indemniti Profesional', PUBLIC_LIABILITY: 'Liabiliti Awam', GROUP_PERSONAL_ACCIDENT: 'Kemalangan Diri Berkumpulan' }[kind];
      return p ? `${bm}: tamat ${p.expiresOn}` : `${bm}: tiada`;
    });
    const vaults = (await this.store.list('vaults', { companyId: [l.companyId] }).catch(() => [])).filter((v) => v.companyId === l.companyId);
    out['2.1'] = [vaults.length ? `${vaults.length} bilik kebal (lihat Pemegang Lesen A dalam Kawalan Senjata)` : 'Tiada bilik kebal: mungkin tidak berkenaan'];
    void user;
    return out;
  }

  /** The countdown on each row (W6). */
  countdown(w: KdnWindow, today: IsoDate, returned: boolean) {
    const usable = w.sessions.filter((x) => x.to >= today && (returned || !w.returnOnlySessions.includes(x.no)));
    const next = usable[0] ?? null;
    const last = w.sessions.filter((x) => x.to >= today).at(-1) ?? null;
    return {
      nextSession: next,
      lastSession: last,
      daysToNext: next ? Math.max(0, daysBetween(today, next.from)) : null,
      daysToLast: last ? Math.max(0, daysBetween(today, last.from)) : null,
      daysToClose: daysBetween(today, w.closes),
      open: today >= w.opens && today <= w.closes,
    };
  }
  private stage(l: CompanyLicence) {
    const r = l.renewal;
    const k = r?.kdn;
    if (!r || !k) return 'not_opened';
    if (r.renewed) return 'renewed';
    if (k.results.some((x) => x.kind === 'accepted')) return 'accepted';
    if (k.appointment) return 'appointment';
    if (r.signed) return 'signed';
    return 'papers';
  }

  /** W14 and the company rows: every KDN licence this person may see, with stage, papers, SST, counts and countdown. */
  async board(user: User) {
    if (user.integration) throw new AccessDenied('view', '(KDN renewal)');
    const group = isGroupLeader(user) || this.central(user) || user.opsTier === 'coo';
    const act = user.department === 'audit';
    const companies = (await this.store.list('companies', {})).filter((c) => group || act || this.companyStaff(user, c.id) || this.finance(user) || this.fwm(user));
    if (!companies.length) throw new AccessDenied('view', '(KDN renewal)');
    const ids = new Set(companies.map((c) => c.id));
    const licences = (await this.store.list('licences', { companyId: [...ids] })).filter((l) => l.type === 'KDN_LICENCE' && ids.has(l.companyId));
    const w = await this.window();
    const today = this.today();
    const recs = await this.recs();
    const rows = [];
    for (const l of licences) {
      const r = l.renewal;
      const k = r?.kdn ?? null;
      const own = this.companyStaff(user, l.companyId);
      const ready = r?.papers.filter((p) => p.done).length ?? 0;
      const returned = !!k?.results.some((x) => x.kind === 'lacking');
      const np = await this.nepali(l.companyId);
      const sst = recs.find((x) => x.kind === 'sst' && x.companyId === l.companyId && x.year === w.year) ?? null;
      const stage = this.stage(l);
      const late =
        stage === 'renewed' || stage === 'accepted'
          ? null
          : today > w.acceptBy
            ? 'CEO'
            : !k?.appointment && today > w.bookBy
              ? 'CoS'
              : stage === 'not_opened' && today > w.openBy
                ? 'DCoS'
                : null;
      rows.push({
        licenceId: l.id,
        companyId: l.companyId,
        companyName: companies.find((c) => c.id === l.companyId)?.name ?? l.companyId,
        reference: l.reference,
        expiresOn: l.expiresOn,
        stage,
        papers: { ready, of: r?.papers.length ?? (await this.template()).lines.length },
        missing: r ? r.papers.filter((p) => !p.done).map((p) => p.kdn?.item ?? p.name) : [],
        appointment: k?.appointment ?? null,
        results: k?.results ?? [],
        sst: sst ? { on: sst.d.on, ref: sst.d.ref } : null,
        counts: k?.counts ? { csg: k.counts.csg, tng: k.counts.tng, local: k.counts.local, nepali: k.counts.nepali, by: k.counts.by, at: k.counts.at } : null,
        liveCounts: own || this.head(user, l.companyId) || user.department === 'hr' ? await this.counts(l.companyId) : null,
        nepali: { entered: np.entered, total: np.total },
        twoB: k?.twoB ?? true,
        investigators: !!k?.investigators,
        esims: !!k?.esims,
        checked: !!k?.checked,
        director: k?.director ?? null,
        counter: !!k?.results.some((x) => x.kind === 'counter'),
        signBlocks: r && !r.signed ? await this.signBlocks(l) : [],
        countdown: this.countdown(w, today, returned),
        late,
        hints: own ? await this.hints(user, l) : null,
        papersDetail: own || this.central(user) ? (r?.papers ?? []).map((p) => ({ item: p.kdn?.item, label: p.kdn?.label, form: p.kdn?.form, name: p.name, done: !!p.done, na: p.kdn?.na ?? null, files: p.kdn?.docNames ?? [] })) : null,
      });
    }
    rows.sort((a, b) => (a.late ? 0 : 1) - (b.late ? 0 : 1) || a.companyName.localeCompare(b.companyName));
    const pledges = recs.filter((x) => x.kind === 'pledge' && x.year === w.year).length;
    return {
      window: w,
      template: await this.template(),
      giftLine: KDN_GIFT_LINE,
      declaration: KDN_DECLARATION,
      rows,
      pledges: { filed: pledges, of: licences.length },
      can: { central: this.central(user), finance: this.finance(user), fwm: this.fwm(user) },
    };
  }

  /** W6 / W14 home items: open the renewal from the window's opening; the escalation ladder from the group's dates. */
  async homeItems(user: User): Promise<HomeItem[]> {
    const b = await this.board(user).catch(() => null);
    if (!b) return [];
    const items: HomeItem[] = [];
    const go = { view: 'renewals' as const };
    const mine = b.rows.filter((r) => this.companyStaff(user, r.companyId));
    for (const r of mine) {
      if (r.stage === 'not_opened' && r.countdown.open) items.push({ tone: 'warn', tag: 'KDN', title: `Buka pembaharuan ${b.window.year}`, detail: `${r.companyName}: ${r.countdown.daysToClose} hari ke 31 Dis; sesi seterusnya ${r.countdown.nextSession?.from ?? '-'}`, go });
      else if (r.counter) items.push({ tone: 'warn', tag: 'KDN', title: 'Dihantar di kaunter: tidak disemak hari yang sama', detail: `${r.companyName}: akan lewat`, go });
    }
    const tier = user.opsTier === 'ceo' ? 'CEO' : user.leadership === 'cos' ? 'CoS' : this.central(user) ? 'DCoS' : null;
    const order = ['DCoS', 'CoS', 'CEO'];
    if (tier) {
      const late = b.rows.filter((r) => r.late && order.indexOf(r.late) >= order.indexOf(tier) && (tier !== 'CEO' || r.late === 'CEO'));
      if (late.length) items.push({ tone: 'crit', tag: 'KDN', title: `${late.length} syarikat belum diterima KDN`, detail: late.slice(0, 4).map((r) => r.companyName).join(', '), go });
    }
    return items;
  }

  /** Central Admin loads next year's template or window with a reason (W1, W6). */
  async setSetting(user: User, i: Record<string, unknown>) {
    if (!this.central(user)) throw new AccessDenied('view', '(Central Admin loads the KDN template)');
    if (!(await this.hasRecs())) throw new BadRequest('KDN records are not installed in this database yet (module kdn-renewal-v1, run by the CEO).');
    const kind = i.kind === 'window' ? 'window' : i.kind === 'template' ? 'template' : null;
    if (!kind) throw new BadRequest('Template or window?');
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason (for example: the KDN letter for the new year).');
    const year = Number(i.year);
    if (!Number.isInteger(year) || year < 2027 || year > 2100) throw new BadRequest('Give the licence year.');
    const d = (i.value ?? {}) as Record<string, unknown>;
    if (kind === 'template') {
      const lines = Array.isArray(d.lines) ? (d.lines as KdnPaperSpec[]) : [];
      if (!lines.length || lines.some((x) => !s(x.item, 10) || !s(x.name, 200) || !['hardcopy', 'softcopy'].includes(x.form))) throw new BadRequest('Each line needs the KDN item number, the paper and hardcopy or soft copy.');
    } else {
      const w = d as unknown as KdnWindow;
      if (!isDate(w.opens) || !isDate(w.closes) || !Array.isArray(w.sessions) || w.sessions.some((x) => !isDate(x.from) || !isDate(x.to) || x.to < x.from)) throw new BadRequest('Give the window and each session with its dates.');
    }
    const id = `kdn-${kind}-${year}`;
    const at = this.now();
    const cur = (await this.store.get('kdnRecs', id).catch(() => undefined)) as KdnRec | undefined;
    const rec: KdnRec = { id, kind, companyId: null, year, d: { ...d, year }, by: user.name, byId: user.id, at, history: [...(cur?.history ?? []), { at, by: user.name, note: why }] };
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('kdnRecs', id, patchOf(rec) as never);
      else await tx.insert('kdnRecs', rec as never);
      await tx.audit({ at, actor: user.name, companyId: null, action: `renewal.kdn.${kind}`, entity: 'kdn_rec', entityId: id, summary: `KDN ${kind} ${year} saved: ${why}` });
      return rec;
    });
  }

  /** One door for Part W. */
  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'open':
        return this.open(user, s(i.licenceId, 120));
      case 'paper':
        return this.paper(user, i);
      case 'esims':
        return this.esimsStep(user, i);
      case 'twoB':
        return this.twoB(user, i);
      case 'appointment':
        return this.appointment(user, i);
      case 'result':
        return this.result(user, i);
      case 'counts':
        return this.confirmCounts(user, i);
      case 'check':
        return this.check(user, i);
      case 'sign':
        return this.sign(user, i);
      case 'sst':
        return this.sst(user, i);
      case 'fwEsims':
        return this.fwEsims(user, i);
      case 'pack':
        return this.pack(user, i);
      case 'setSetting':
        return this.setSetting(user, i);
      default:
        throw new BadRequest('Unknown KDN renewal step.');
    }
  }
}

