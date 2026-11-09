// P91 (Fitri, 9 Nov 2026: "the add side must be flexible as we are moving from the old system to the new one"): more
// master records from Operations, Security, Equipment and HR that staff bring from old spreadsheets. Each row goes
// through the screen's own add, with that add's own permission check, exactly like the P90 kinds in org-import.ts:
//
//  - staffTraining: a course a staff member or guard attended (recordTraining: HR, or the guard's company head).
//  - guardPaper: a guard's KDN card, eSIMS vetting, CSG or TNG (recordGuardPaper: HR, or the guard's company head).
//    Guards themselves still come from the JA feed; a paper is only recorded for a guard already in Prima.
//  - fuelCard: a fuel or subsidy card kept for a vehicle (addVehicleCard: Transport; only the last 4 digits are kept).
//  - cmsDevice: a device at a site for CMS readiness (saveCmsReadinessDevice: whoever records that site's readiness).
//  - siteKitItem: a line of a site's fittings plan (saveSiteKit: the OM who manages the site).
//
// Not here, on purpose: guard loans and advances (each is a live request the Chief of Staff and the CEO approve and
// Finance pays out; a history row would skip that), foreign worker paper renewals (the copy must be attached), worker
// placements (charges follow). See docs/P91_ADD_IMPORT_OPS.md.
//
// Rows name people, vehicles and sites the way old lists do (staff number or name, plate, site code or name); a row
// that names nothing in Prima, or more than one, is refused with plain words. The same record already in Prima is
// refused too, so a second file with overlapping rows does not double them.

import { CMS_DEVICE_KINDS } from './cms-readiness';
import { normHeader } from './import-align';
import { CREDENTIAL_LABEL } from './rules';
import { SITE_KIT_CATEGORY_LABEL, SITE_KIT_OWNER_LABEL, type SiteKitCategory, type SiteKitOwner } from './site-kit';
import type { Store } from './store';
import type { CmsDeviceKind, CmsReadinessValue, CredentialType, FuelType, Id, IsoDate, User } from './types';
import type { ImportSpec } from './org-import';

export type P91ImportKind = 'staffTraining' | 'guardPaper' | 'fuelCard' | 'cmsDevice' | 'siteKitItem';
export const P91_IMPORT_KINDS: readonly P91ImportKind[] = Object.freeze(['staffTraining', 'guardPaper', 'fuelCard', 'cmsDevice', 'siteKitItem'] as P91ImportKind[]);
export const isP91Kind = (k: string): k is P91ImportKind => (P91_IMPORT_KINDS as readonly string[]).includes(k);

/** The screen's own add calls the P91 kinds use (PrimaService has them all). */
export interface P91ImportSaver {
  recordTraining(
    user: User,
    input: { personId: Id; course: string; provider: string; from: IsoDate; to: IsoDate; hours: number; cost: number | null; hrdRef: string | null; certificateRef: string | null },
    opts?: { imported?: boolean },
  ): Promise<{ id: Id }>;
  recordGuardPaper(user: User, input: { personId: Id; type: CredentialType; number: string; issuedOn: IsoDate; expiresOn: IsoDate | null }, opts?: { imported?: boolean }): Promise<{ id: Id }>;
  addVehicleCard(
    user: User,
    vehicleId: Id,
    input: { kind: 'FUEL' | 'SUBSIDY'; issuer: string; last4: string; fuel: FuelType; monthlyLimitRm?: number | null; monthlyQuotaLitres?: number | null; holder: string; since: IsoDate; reason: string },
  ): Promise<unknown>;
  saveCmsReadinessDevice(
    user: User,
    siteId: Id,
    input: { kind: CmsDeviceKind; brand: string; model: string; count: number; owner: 'client' | 'company'; clientChoiceRef: string; vendorName: string; vendorPhone: string; linkMethod: string; linkConfirmed: CmsReadinessValue; note: string },
  ): Promise<unknown>;
  importSiteKitItem(
    user: User,
    siteId: Id,
    item: { name: string; category: SiteKitCategory; required: number; owner: SiteKitOwner; note: string; atEnd: 'take_back' | 'hand_over'; handOverRef: string },
  ): Promise<{ id: Id }>;
}

const GUARD_PAPERS: CredentialType[] = ['KDN_GUARD_CARD', 'KDN_VETTING', 'CSG_TRAINING', 'TNG_TRAINING'];
const FUELS: [string, string][] = [
  ['RON95', 'Petrol RON95'],
  ['RON97', 'Petrol RON97'],
  ['DIESEL', 'Diesel'],
  ['LPG', 'LPG'],
  ['OTHER', 'Other'],
];

const whoFields = (what: string): ImportSpec['fields'] => [
  {
    key: 'staffNo',
    label: 'Staff number',
    type: 'text',
    required: true,
    help: `Or the ${what}'s name exactly as in Prima.`,
    words: ['staff no', 'no staf', 'no pekerja', 'employee no', 'emp no', 'guard no', 'no pengawal', 'staff id', 'nama', 'name'],
  },
  {
    key: 'ic',
    label: 'IC or passport number',
    type: 'text',
    restricted: true,
    help: 'Optional. Used only to check the row is the right person; it is not saved.',
    words: ['ic', 'ic no', 'no ic', 'nric', 'mykad', 'no kp', 'kad pengenalan', 'passport', 'no pasport'],
  },
];

const siteField: ImportSpec['fields'][number] = {
  key: 'site',
  label: 'Site',
  type: 'text',
  required: true,
  help: 'The site code or name as in Prima.',
  words: ['site', 'site code', 'kod tapak', 'tapak', 'lokasi', 'location', 'premis', 'premises', 'nama tapak', 'site name'],
};

export const P91_IMPORTS: Record<P91ImportKind, ImportSpec> = {
  staffTraining: {
    kind: 'staffTraining' as never,
    label: 'Training record',
    table: 'staffTraining',
    companyScoped: false,
    keptBy: 'HR, or the company head for guards',
    screen: 'HR, Training',
    note: 'Each course is recorded as HR records one by hand, for a staff member or guard already in Prima (by staff number or name). The same course on the same day for the same person is not added twice.',
    fields: [
      ...whoFields('staff member'),
      { key: 'course', label: 'Course', type: 'text', required: true, words: ['course', 'kursus', 'training', 'latihan', 'nama kursus', 'program', 'programme', 'title'] },
      { key: 'provider', label: 'Provider', type: 'text', words: ['provider', 'penganjur', 'trainer', 'training provider', 'vendor', 'institusi', 'organiser'] },
      { key: 'from', label: 'Course date', type: 'date', required: true, help: 'The first day.', words: ['from', 'start', 'start date', 'tarikh mula', 'mula', 'date', 'tarikh', 'from date', 'dari', 'tarikh kursus'] },
      { key: 'to', label: 'Last day', type: 'date', help: 'Empty for a one-day course.', words: ['to', 'end', 'end date', 'tarikh tamat', 'tamat', 'hingga', 'sampai', 'until'] },
      { key: 'hours', label: 'Hours', type: 'number', required: true, min: 0.5, max: 400, words: ['hours', 'jam', 'duration', 'tempoh', 'hrs', 'jumlah jam'] },
      { key: 'cost', label: 'Cost (RM)', type: 'number', min: 0, words: ['cost', 'kos', 'fee', 'yuran', 'amount', 'harga'] },
      { key: 'hrdRef', label: 'HRD Corp reference', type: 'text', words: ['hrd', 'hrdf', 'hrd corp', 'grant no', 'no geran'] },
      { key: 'certificateRef', label: 'Certificate number', type: 'text', words: ['certificate', 'sijil', 'cert no', 'no sijil'] },
    ],
  },
  guardPaper: {
    kind: 'guardPaper' as never,
    label: 'Guard paper',
    table: 'credentials',
    companyScoped: false,
    keptBy: 'HR, or the guard’s company head',
    screen: 'Guards',
    note: 'KDN card, eSIMS vetting, CSG or TNG for a guard already in Prima (guards come from the JA app). Each row is recorded as HR records a paper by hand. Firearm and foreign worker papers are not loaded here.',
    fields: [
      ...whoFields('guard'),
      {
        key: 'type',
        label: 'Paper',
        type: 'select',
        required: true,
        options: GUARD_PAPERS.map((t): [string, string] => [t, CREDENTIAL_LABEL[t]]),
        words: ['paper', 'document', 'dokumen', 'jenis', 'type', 'kind', 'certificate type', 'jenis sijil'],
      },
      { key: 'number', label: 'Card or certificate number', type: 'text', required: true, words: ['card no', 'no kad', 'certificate no', 'no sijil', 'reference', 'rujukan', 'esims', 'number'] },
      { key: 'issuedOn', label: 'Issued or done on', type: 'date', required: true, words: ['issued', 'issue date', 'tarikh dikeluarkan', 'tarikh keluar', 'date issued', 'done on', 'tarikh lulus'] },
      { key: 'expiresOn', label: 'Expires on', type: 'date', help: 'Needed for the KDN card; CSG and vetting do not expire.', words: ['expiry', 'expiry date', 'tarikh tamat', 'tamat tempoh', 'valid until', 'sah hingga'] },
    ],
  },
  fuelCard: {
    kind: 'fuelCard' as never,
    label: 'Fuel card',
    table: 'vehicles',
    companyScoped: false,
    keptBy: 'Transport',
    screen: 'Vehicles',
    note: 'Each card is kept for the vehicle with that plate, as Transport adds one by hand. Only the last 4 digits are kept; never put a PIN in the file.',
    fields: [
      { key: 'plate', label: 'Vehicle plate', type: 'text', required: true, words: ['plate', 'no plat', 'plat', 'no pendaftaran', 'registration', 'vehicle', 'kenderaan', 'car no'] },
      {
        key: 'kind',
        label: 'Card kind',
        type: 'select',
        options: [
          ['FUEL', 'Fuel card'],
          ['SUBSIDY', 'Subsidy card'],
        ],
        help: 'Empty means a fuel card.',
        words: ['card type', 'jenis kad', 'kind'],
      },
      { key: 'issuer', label: 'Card company or scheme', type: 'text', required: true, words: ['issuer', 'card company', 'syarikat kad', 'scheme', 'skim', 'provider', 'bank', 'company'] },
      { key: 'last4', label: 'Card number (last 4)', type: 'text', required: true, restricted: true, help: 'Only the last 4 digits are kept.', words: ['card no', 'no kad', 'card number', 'nombor kad', 'last 4'] },
      { key: 'fuel', label: 'Fuel', type: 'select', required: true, options: FUELS, words: ['fuel', 'minyak', 'bahan api', 'fuel type', 'jenis minyak'] },
      { key: 'monthlyLimitRm', label: 'Monthly limit (RM)', type: 'number', min: 0, words: ['limit', 'had', 'had bulanan', 'monthly limit', 'credit limit'] },
      { key: 'monthlyQuotaLitres', label: 'Monthly quota (litres)', type: 'number', min: 0, words: ['quota', 'kuota', 'litres', 'liter'] },
      { key: 'holder', label: 'Kept by', type: 'text', required: true, words: ['holder', 'pemegang', 'driver', 'pemandu', 'kept by', 'disimpan oleh', 'user'] },
      { key: 'since', label: 'With this vehicle since', type: 'date', required: true, words: ['since', 'sejak', 'start date', 'tarikh mula', 'issued', 'date'] },
      { key: 'reason', label: 'Reason', type: 'text', help: 'Empty: "Existing card, loaded from the old list".', words: ['reason', 'sebab', 'remark', 'catatan', 'note'] },
    ],
  },
  cmsDevice: {
    kind: 'cmsDevice' as never,
    label: 'Site device for CMS',
    table: 'sites',
    companyScoped: false,
    keptBy: 'Whoever records the site’s CMS readiness',
    screen: 'CMS readiness',
    note: 'Each device is added to the site’s CMS readiness list as it is added by hand. Prima does not connect to any device; never put a password or PIN in the file.',
    fields: [
      siteField,
      {
        key: 'kind',
        label: 'Device',
        type: 'select',
        required: true,
        options: (Object.entries(CMS_DEVICE_KINDS) as [CmsDeviceKind, { label: string }][]).map(([k, v]): [string, string] => [k, v.label]),
        words: ['device', 'peranti', 'device type', 'jenis peranti', 'equipment', 'system', 'sistem'],
      },
      { key: 'brand', label: 'Brand', type: 'text', required: true, words: ['brand', 'jenama', 'make', 'buatan'] },
      { key: 'model', label: 'Model', type: 'text', words: ['model'] },
      { key: 'count', label: 'How many', type: 'number', min: 1, max: 500, help: 'Empty means 1.', words: ['qty', 'quantity', 'kuantiti', 'bilangan', 'unit', 'units', 'count', 'jumlah'] },
      {
        key: 'owner',
        label: 'Owned by',
        type: 'select',
        options: [
          ['client', 'Client'],
          ['company', 'Our company'],
        ],
        help: 'Empty means the client.',
        words: ['owner', 'pemilik', 'milik', 'owned by'],
      },
      { key: 'clientChoiceRef', label: 'Where the client chose it', type: 'text', words: ['client choice', 'letter', 'surat', 'po', 'purchase order'] },
      { key: 'vendorName', label: 'Vendor', type: 'text', words: ['vendor', 'installer', 'pembekal', 'contractor', 'kontraktor'] },
      { key: 'vendorPhone', label: 'Vendor phone', type: 'text', words: ['vendor phone', 'tel', 'phone', 'no telefon'] },
      { key: 'linkMethod', label: 'Link method', type: 'text', words: ['link', 'protocol', 'protokol', 'integration', 'onvif'] },
      {
        key: 'linkConfirmed',
        label: 'Link confirmed by the vendor',
        type: 'select',
        options: [
          ['yes', 'Yes'],
          ['no', 'No'],
          ['unknown', 'Not known yet'],
        ],
        words: ['confirmed', 'disahkan', 'link confirmed'],
      },
      { key: 'note', label: 'Note', type: 'text', words: ['note', 'catatan', 'remark', 'remarks'] },
    ],
  },
  siteKitItem: {
    kind: 'siteKitItem' as never,
    label: 'Site fitting',
    table: 'siteKits',
    companyScoped: false,
    keptBy: 'The OM who manages the site',
    screen: 'Site stock',
    note: 'Each row adds one line to the site’s fittings plan, as the OM adds one by hand. Installs and monthly checks still need the supervisor’s photo on the screen.',
    fields: [
      siteField,
      { key: 'name', label: 'Item', type: 'text', required: true, words: ['item', 'barang', 'perkara', 'description', 'keterangan', 'asset', 'aset'] },
      {
        key: 'category',
        label: 'Kind',
        type: 'select',
        options: Object.entries(SITE_KIT_CATEGORY_LABEL) as [string, string][],
        help: 'Empty means Other.',
        words: ['category', 'kategori', 'jenis', 'type'],
      },
      { key: 'required', label: 'Needed', type: 'number', required: true, min: 0, max: 1000, words: ['qty', 'quantity', 'kuantiti', 'bilangan', 'needed', 'diperlukan', 'units', 'jumlah'] },
      {
        key: 'owner',
        label: 'Owned by',
        type: 'select',
        options: Object.entries(SITE_KIT_OWNER_LABEL) as [string, string][],
        help: 'Ours, the client’s or rented. Empty means ours.',
        words: ['owner', 'pemilik', 'milik', 'owned by'],
      },
      {
        key: 'atEnd',
        label: 'At contract end',
        type: 'select',
        options: [
          ['take_back', 'Take back'],
          ['hand_over', 'Hand over to the client'],
        ],
        help: 'Empty means take back.',
      },
      { key: 'handOverRef', label: 'Contract clause that hands it over', type: 'text', words: ['clause', 'klausa', 'fasal'] },
      { key: 'note', label: 'Note', type: 'text', words: ['note', 'catatan', 'remark', 'remarks'] },
    ],
  },
};

type PersonRow = { id: Id; companyId: Id; staffNo: string; name: string; role: string; idMasked?: string; status?: string };
type SiteRow = { id: Id; companyId: Id; code: string; name: string };

const s = (x: unknown) => (x === null || x === undefined ? '' : String(x).trim());
const fail = (m: string): never => {
  throw new Error(m);
};

/** A masked IC ("880101-**-***7") or passport ("PA****123") agrees with a full number where its digits are shown. */
export function idAgrees(masked: string, given: string): boolean {
  const m = (masked ?? '').replace(/[^0-9A-Za-z*]/g, '').toUpperCase();
  const g = (given ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!m || !g || m.length !== g.length) return false;
  for (let i = 0; i < m.length; i++) if (m[i] !== '*' && m[i] !== g[i]) return false;
  return true;
}

/** Imports the P91 kinds. One per import call (it keeps the lists it read for the rows that follow). */
export class OpsImportRows {
  private people: Promise<PersonRow[]> | null = null;
  private sites: Promise<SiteRow[]> | null = null;
  constructor(
    private store: Store,
    private saver: P91ImportSaver,
  ) {}

  private async person(v: Record<string, unknown>, guardsOnly: boolean): Promise<PersonRow> {
    this.people ??= this.store.list('people', {}) as unknown as Promise<PersonRow[]>;
    const all = (await this.people).filter((p) => (guardsOnly ? p.role !== 'office' : true));
    const who = s(v.staffNo);
    const ic = s(v.ic);
    if (!who && !ic) fail('Give the staff number or the name.');
    const k = normHeader(who);
    let hit = who ? all.filter((p) => normHeader(p.staffNo) === k) : [];
    if (!hit.length && who) hit = all.filter((p) => normHeader(p.name) === k);
    if (ic) {
      const agree = (hit.length ? hit : who ? [] : all).filter((p) => idAgrees(p.idMasked ?? '', ic));
      if (hit.length && !agree.length) fail(`The IC or passport number does not match ${hit.length === 1 ? `${hit[0].staffNo}` : `"${who.slice(0, 60)}"`} in Prima.`);
      hit = agree;
    }
    if (hit.length > 1) {
      const active = hit.filter((p) => p.status !== 'resigned' && p.status !== 'terminated');
      if (active.length === 1) hit = active;
    }
    if (hit.length !== 1)
      fail(
        hit.length
          ? `"${who.slice(0, 60)}" matches more than one person; use the staff number, or add the IC column.`
          : `No ${guardsOnly ? 'guard or officer' : 'staff member or guard'} "${(who || 'with that IC').slice(0, 60)}" in Prima${guardsOnly ? ' (guards come from the JA app)' : ''}.`,
      );
    return hit[0];
  }

  private async site(v: Record<string, unknown>): Promise<SiteRow> {
    this.sites ??= this.store.list('sites', {}) as unknown as Promise<SiteRow[]>;
    const want = s(v.site);
    if (!want) fail('Give the site code or name.');
    const k = normHeader(want);
    const all = await this.sites;
    let hit = all.filter((x) => x.id === want || normHeader(x.code) === k);
    if (!hit.length) hit = all.filter((x) => normHeader(x.name) === k);
    if (!hit.length) hit = all.filter((x) => normHeader(`${x.code} ${x.name}`) === k);
    if (hit.length !== 1) fail(hit.length ? `Site "${want.slice(0, 60)}" matches more than one site; use its code.` : `Site "${want.slice(0, 60)}" is not a site in Prima.`);
    return hit[0];
  }

  async save(user: User, kind: P91ImportKind, raw: Record<string, unknown>): Promise<Id | null> {
    const v = raw;
    const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));
    if (kind === 'staffTraining') {
      const p = await this.person(v, false);
      const from = s(v.from);
      const course = s(v.course);
      const same = (await this.store.list('staffTraining', { personId: [p.id] })).some((r) => r.from === from && normHeader(r.course) === normHeader(course));
      if (same) fail(`${p.staffNo} already has "${course.slice(0, 60)}" from ${from} in Prima.`);
      const r = await this.saver.recordTraining(
        user,
        { personId: p.id, course, provider: s(v.provider), from, to: s(v.to) || from, hours: Number(v.hours), cost: num(v.cost), hrdRef: s(v.hrdRef) || null, certificateRef: s(v.certificateRef) || null },
        { imported: true },
      );
      return r.id;
    }
    if (kind === 'guardPaper') {
      const p = await this.person(v, true);
      const type = paperType(s(v.type));
      if (!type) fail(`Paper "${s(v.type).slice(0, 40)}": write KDN card, eSIMS vetting, CSG or TNG.`);
      const number = s(v.number);
      const issuedOn = s(v.issuedOn);
      const same = (await this.store.list('credentials', { personId: [p.id] })).some((c) => c.type === type && normHeader(c.number) === normHeader(number) && c.issuedOn === issuedOn);
      if (same) fail(`${p.staffNo} already has this ${CREDENTIAL_LABEL[type!]} in Prima.`);
      const r = await this.saver.recordGuardPaper(user, { personId: p.id, type: type!, number, issuedOn, expiresOn: s(v.expiresOn) || null }, { imported: true });
      return r.id;
    }
    if (kind === 'fuelCard') {
      const plate = s(v.plate);
      const k = normHeader(plate).replace(/ /g, '');
      if (!k) fail('Give the vehicle plate.');
      const vehicles = (await this.store.list('vehicles', {})) as unknown as { id: Id; plate: string }[];
      const hit = vehicles.filter((x) => normHeader(x.plate).replace(/ /g, '') === k);
      if (hit.length !== 1) fail(hit.length ? `Plate "${plate}" is on more than one vehicle.` : `No vehicle with plate "${plate.slice(0, 20)}" in Prima. Add the vehicle first.`);
      const digits = s(v.last4).replace(/\D/g, '');
      if (digits.length < 4) fail('Give the last 4 digits of the card.');
      await this.saver.addVehicleCard(user, hit[0].id, {
        kind: cardKind(s(v.kind)) as 'FUEL' | 'SUBSIDY',
        issuer: s(v.issuer),
        last4: digits.slice(-4),
        fuel: fuelOf(s(v.fuel)) as FuelType,
        monthlyLimitRm: num(v.monthlyLimitRm),
        monthlyQuotaLitres: num(v.monthlyQuotaLitres),
        holder: s(v.holder),
        since: s(v.since),
        reason: s(v.reason) || 'Existing card, loaded from the old list',
      });
      return hit[0].id;
    }
    if (kind === 'cmsDevice') {
      const site = await this.site(v);
      await this.saver.saveCmsReadinessDevice(user, site.id, {
        kind: s(v.kind) as CmsDeviceKind,
        brand: s(v.brand),
        model: s(v.model),
        count: num(v.count) ?? 1,
        owner: (s(v.owner) || 'client') as 'client' | 'company',
        clientChoiceRef: s(v.clientChoiceRef),
        vendorName: s(v.vendorName),
        vendorPhone: s(v.vendorPhone),
        linkMethod: s(v.linkMethod),
        linkConfirmed: (s(v.linkConfirmed) || 'unknown') as CmsReadinessValue,
        note: s(v.note),
      });
      return site.id;
    }
    // siteKitItem
    const site = await this.site(v);
    const r = await this.saver.importSiteKitItem(user, site.id, {
      name: s(v.name),
      category: (s(v.category) || 'other') as SiteKitCategory,
      required: Number(v.required),
      owner: (s(v.owner) || 'company') as SiteKitOwner,
      note: s(v.note),
      atEnd: s(v.atEnd) === 'hand_over' ? 'hand_over' : 'take_back',
      handOverRef: s(v.handOverRef),
    });
    return r.id;
  }
}

/** The guard paper a cell names: the list's own words, or what old lists write ("Kad KDN", "Sijil CSG", "eSIMS"). */
export function paperType(raw: string): CredentialType | null {
  if ((GUARD_PAPERS as string[]).includes(raw)) return raw as CredentialType;
  const n = normHeader(raw);
  if (!n) return null;
  if (/\btng\b|supervisor|penyelia/.test(n)) return 'TNG_TRAINING';
  if (/\bcsg\b|basic training|latihan asas|kursus asas/.test(n)) return 'CSG_TRAINING';
  if (/vetting|esims|tapisan/.test(n)) return 'KDN_VETTING';
  if (/\bkdn\b|kad|card|guard card|kad pengawal/.test(n)) return 'KDN_GUARD_CARD';
  return null;
}

/** Fuel as old lists write it ("RON 95", "Petrol", "Disel"). Anything else goes to the card form's own check. */
export function fuelOf(raw: string): string {
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!n) return raw;
  if (n === 'RON95' || n === 'PETROL' || n === 'PETROLRON95' || n === 'PETROL95' || n === 'MINYAK95' || n === 'BENSIN') return 'RON95';
  if (n === 'RON97' || n === 'PETROLRON97' || n === 'PETROL97') return 'RON97';
  if (n === 'DIESEL' || n === 'DISEL' || n === 'DIESELB10' || n === 'DIESELB7') return 'DIESEL';
  if (n === 'LPG' || n === 'GAS' || n === 'NGV') return n === 'NGV' ? 'OTHER' : 'LPG';
  return raw;
}

/** Card kind: a subsidy card where the cell says so; empty or a fuel/fleet card is a fuel card. */
export function cardKind(raw: string): string {
  if (raw === 'FUEL' || raw === 'SUBSIDY') return raw;
  const n = normHeader(raw);
  if (!n) return 'FUEL';
  if (/subsid|subsidi|budi/.test(n)) return 'SUBSIDY';
  if (/fuel|fleet|minyak|petrol|kad/.test(n)) return 'FUEL';
  return raw;
}
