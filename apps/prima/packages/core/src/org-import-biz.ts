// P91 (Fitri, 9 Nov 2026: "in Add we can add manually, upload files (Excel/CSV/PDF) and more"): the master records of
// the business screens (sales, finance, company secretary, compliance, governance, IT) that staff bring from the old
// system. Each row goes through the screen's own add, with that add's own permission check, exactly as P90's kinds do:
// the import never lets anyone write what they could not add by hand, and never skips an approval.
//
// Kept in its own file so the shared org-import.ts only gains a few hook lines. This file must not import values from
// org-import.ts (org-import.ts spreads these specs at load time); it throws a plain Error with a plain-words message,
// which the import shows on the row.

import { matchCompany, matchOption, normHeader } from './import-align';
import type { FieldSpec } from './records';
import type { Dataset, Id, IsoDate, User } from './types';

export type P91BizImportKind =
  | 'tender'
  | 'finBankAccount'
  | 'corpFiling'
  | 'corpAudit'
  | 'legalMatter'
  | 'bcmSystem'
  | 'grcObligation'
  | 'pdpaRegisterItem'
  | 'pdpaProduct'
  | 'regRisk';

interface BizSpec {
  kind: P91BizImportKind;
  label: string;
  table: keyof Dataset;
  companyScoped: boolean;
  keptBy: string;
  screen: string;
  fields: (FieldSpec & { words?: string[] })[];
  note?: string;
}

/** The screens' own adds the import calls (PrimaService has each of them). */
export interface BizImportSaver {
  addTender(
    user: User,
    companyId: Id,
    input: { ref: string; title: string; buyer: string; channel: 'GOVERNMENT' | 'PRIVATE'; source?: string; owner?: string; closesOn: IsoDate; guards: number; sites?: number; estMonthly?: number | null; armed?: boolean },
  ): Promise<{ id: Id }>;
  readonly finance: { addBankAccount(user: User, companyId: Id, input: Record<string, unknown>): Promise<{ id: Id }> };
  addCorpFiling(user: User, companyId: Id, input: { kind: CorpFilingKind; title: string; dueOn: IsoDate; basis: string }): Promise<{ id: Id }>;
  addCorpAudit(user: User, companyId: Id, input: { fyEnd: IsoDate; auditorFirm: string; fee: number | null; pbc: string[] }): Promise<{ id: Id }>;
  addLegalMatter(
    user: User,
    companyId: Id,
    input: { title: string; kind: LegalKind; counterparty: string; side: 'claimant' | 'respondent'; exposure: number | null; lawyer: string; nextOn: IsoDate | null; nextWhat: string },
  ): Promise<{ id: Id }>;
  addBcmSystem(user: User, input: { name: string; impact: string; rtoHours: number; rpoHours: number; copies: { site: string; where: string; inMalaysia: boolean }[] }): Promise<{ id: Id }>;
  addGrcObligation(user: User, companyId: Id, input: { stream: GrcStreamKey; title: string; basis: string; everyMonths: number }): Promise<{ id: Id }>;
  savePdpaRegisterItem(
    user: User,
    id: Id | null,
    input: {
      companyId: Id | null;
      activity: string;
      system: string;
      subjects: PdpaSubject[];
      dataKinds: string;
      sensitive: boolean;
      purpose: string;
      basis: PdpaBasis;
      retentionDays: number | null;
      disposal: string;
      sharedWith: string;
      outsideMalaysia: string;
      ownerDept: string;
      noticeGiven: boolean;
      dpia: 'not_needed' | 'needed' | 'done';
    },
  ): Promise<{ id: Id }>;
  saveProduct(
    user: User,
    input: { id?: Id | null; name: string; category: string; mode: 'SALE' | 'RENTAL' | 'BOTH'; supplier: string; personalData: string[]; retentionDays: number | null; clientConsent: boolean; notes: string },
  ): Promise<{ id: Id }>;
  readonly registers: { act(user: User, action: string, b: Record<string, unknown>): Promise<unknown> };
}

type CorpFilingKind = 'ANNUAL_RETURN' | 'FINANCIAL_STATEMENTS' | 'DIRECTOR_CHANGE' | 'BO_CHANGE' | 'SHARE_CHANGE' | 'OTHER';
type LegalKind = 'LITIGATION' | 'DEMAND' | 'LABOUR' | 'REGULATORY' | 'CONTRACT' | 'OTHER';
type GrcStreamKey = 'OSH' | 'EMPLOYEE_RELATIONS' | 'ANTI_BRIBERY' | 'TAX' | 'CONTINUITY' | 'PRIVACY' | 'INTERNAL_AUDIT' | 'SUPPLIER' | 'WELFARE' | 'FRAUD';
type PdpaSubject = 'guard' | 'staff' | 'applicant' | 'client' | 'visitor' | 'driver' | 'tenant' | 'other';
type PdpaBasis = 'CONSENT' | 'EXPLICIT_CONSENT' | 'CONTRACT' | 'LEGAL_DUTY' | 'VITAL_INTEREST' | 'JUSTICE';

/** Labels as the screens show them; Malay words and short forms staff use in old sheets after them. */
const CHANNELS: [string, string][] = [
  ['GOVERNMENT', 'Government'],
  ['PRIVATE', 'Private'],
];
const BANK_PURPOSES: [string, string][] = [
  ['operating', 'Operating'],
  ['payroll', 'Payroll'],
  ['collection', 'Collection'],
];
export const CORP_FILING_KINDS: [string, string][] = [
  ['ANNUAL_RETURN', 'Annual return'],
  ['FINANCIAL_STATEMENTS', 'Financial statements'],
  ['DIRECTOR_CHANGE', 'Change of directors'],
  ['BO_CHANGE', 'Change of beneficial owners'],
  ['SHARE_CHANGE', 'Change of shares'],
  ['OTHER', 'Other SSM lodgement'],
];
/** The rule the Add filing form fills in for the usual filings; the person may still give their own. */
const FILING_BASIS: Record<string, string> = {
  ANNUAL_RETURN: 'Companies Act 2016 s.68: within 30 days of the anniversary of incorporation',
  FINANCIAL_STATEMENTS: 'Companies Act 2016 s.259: within 30 days of circulating them to members',
};
const LEGAL_KINDS: [string, string][] = [
  ['LITIGATION', 'Court case'],
  ['DEMAND', 'Letter of demand'],
  ['LABOUR', 'Labour or industrial'],
  ['REGULATORY', 'Regulator'],
  ['CONTRACT', 'Contract dispute'],
  ['OTHER', 'Other'],
];
const LEGAL_SIDES: [string, string][] = [
  ['respondent', 'Claim against the company'],
  ['claimant', "Company's claim against them"],
];
const BCM_SITES: [string, string][] = [
  ['CLOUD', 'Cloud copy'],
  ['OWN_SERVER', 'Own server'],
  ['EMERGENCY', 'Emergency server'],
];
const GRC_STREAMS: [string, string][] = [
  ['OSH', 'Safety and health'],
  ['EMPLOYEE_RELATIONS', 'Employee relations'],
  ['ANTI_BRIBERY', 'Anti-bribery'],
  ['TAX', 'Tax'],
  ['CONTINUITY', 'Continuity'],
  ['PRIVACY', 'Privacy'],
  ['INTERNAL_AUDIT', 'Internal audit'],
  ['SUPPLIER', 'Suppliers'],
  ['WELFARE', 'Worker welfare'],
  ['FRAUD', 'Fraud checks'],
];
const PDPA_SUBJECTS: [string, string][] = [
  ['guard', 'Guards'],
  ['staff', 'Staff'],
  ['applicant', 'Job applicants'],
  ['client', 'Clients'],
  ['visitor', 'Visitors'],
  ['driver', 'Drivers'],
  ['tenant', 'Tenants'],
  ['other', 'Others'],
];
const PDPA_BASES: [string, string][] = [
  ['CONSENT', 'Consent'],
  ['EXPLICIT_CONSENT', 'Explicit consent (sensitive data)'],
  ['CONTRACT', 'Needed for the job or contract'],
  ['LEGAL_DUTY', 'Required by law'],
  ['VITAL_INTEREST', 'To protect life or health'],
  ['JUSTICE', 'Legal claims or court'],
];
const DPIA: [string, string][] = [
  ['not_needed', 'Not needed'],
  ['needed', 'Needed'],
  ['done', 'Done'],
];
const PRODUCT_MODES: [string, string][] = [
  ['SALE', 'Sold'],
  ['RENTAL', 'Rented'],
  ['BOTH', 'Sold or rented'],
];
const RISK_CATEGORIES: [string, string][] = [
  ['strategic', 'Strategy'],
  ['operational', 'Operations'],
  ['financial', 'Finance'],
  ['licence', 'Licence and regulator'],
  ['people', 'People'],
  ['technology', 'IT and data'],
  ['legal', 'Legal'],
  ['reputation', 'Reputation'],
];

/** Malay and short words in old sheets, to the option key (checked before the label matcher). */
const WORDS: Record<string, string> = {
  // tender channel
  gov: 'GOVERNMENT',
  govt: 'GOVERNMENT',
  kerajaan: 'GOVERNMENT',
  awam: 'GOVERNMENT',
  swasta: 'PRIVATE',
  // bank account purpose
  operasi: 'operating',
  operation: 'operating',
  operations: 'operating',
  gaji: 'payroll',
  salary: 'payroll',
  kutipan: 'collection',
  collections: 'collection',
  // filings
  'penyata kewangan': 'FINANCIAL_STATEMENTS',
  'financial statement': 'FINANCIAL_STATEMENTS',
  'penyata tahunan': 'ANNUAL_RETURN',
  'annual returns': 'ANNUAL_RETURN',
  // legal
  mahkamah: 'LITIGATION',
  saman: 'LITIGATION',
  'notis tuntutan': 'DEMAND',
  'surat tuntutan': 'DEMAND',
  lod: 'DEMAND',
  perusahaan: 'LABOUR',
  buruh: 'LABOUR',
  industrial: 'LABOUR',
  kontrak: 'CONTRACT',
  plaintiff: 'claimant',
  plaintif: 'claimant',
  penuntut: 'claimant',
  'pihak menuntut': 'claimant',
  defendant: 'respondent',
  defendan: 'respondent',
  responden: 'respondent',
  // continuity copies
  cloud: 'CLOUD',
  awan: 'CLOUD',
  'own server': 'OWN_SERVER',
  'server sendiri': 'OWN_SERVER',
  'on premise': 'OWN_SERVER',
  'on prem': 'OWN_SERVER',
  dr: 'EMERGENCY',
  'dr site': 'EMERGENCY',
  kecemasan: 'EMERGENCY',
  // PDPA
  pengawal: 'guard',
  guards: 'guard',
  kakitangan: 'staff',
  pekerja: 'staff',
  employees: 'staff',
  pemohon: 'applicant',
  pelanggan: 'client',
  pelawat: 'visitor',
  pemandu: 'driver',
  penyewa: 'tenant',
  persetujuan: 'CONSENT',
  'undang undang': 'LEGAL_DUTY',
  legal: 'LEGAL_DUTY',
  'legal obligation': 'LEGAL_DUTY',
  jual: 'SALE',
  sale: 'SALE',
  sell: 'SALE',
  sold: 'SALE',
  sewa: 'RENTAL',
  rent: 'RENTAL',
  rental: 'RENTAL',
  // risks
  strategi: 'strategic',
  kewangan: 'financial',
  lesen: 'licence',
  manusia: 'people',
  it: 'technology',
  teknologi: 'technology',
  undang: 'legal',
  reputasi: 'reputation',
};

const pickOne = (raw: unknown, options: [string, string][]): string | null => {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const w = WORDS[normHeader(v)];
  if (w && options.some(([k]) => k === w)) return w;
  return matchOption(v, options);
};
const listOf = (raw: unknown) =>
  String(raw ?? '')
    .split(/[,;\n/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const str = (x: unknown) => String(x ?? '').trim();
const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));
const dateOrNull = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x));
function refuse(message: string): never {
  throw new Error(message);
}
function need(raw: unknown, options: [string, string][], what: string): string {
  const hit = pickOne(raw, options);
  if (!hit) refuse(`${what}: "${str(raw).slice(0, 40)}" is not one of: ${options.map(([, l]) => l).join(', ')}.`);
  return hit;
}

export const P91_BIZ_IMPORTS: Record<P91BizImportKind, BizSpec> = {
  tender: {
    kind: 'tender',
    label: 'Open tender',
    table: 'tenders',
    companyScoped: true,
    keptBy: "The company's admin team, or the Director Office Administrator",
    screen: 'Tenders and quotes',
    note: 'Open tenders only (closing today or later), each entered as the Add tender form enters it; its protocol, papers, checks and the manager\'s signature follow as usual. A tender that has already closed is not loaded here.',
    fields: [
      { key: 'ref', label: 'Tender reference', type: 'text', required: true, words: ['tender no', 'no tender', 'tender ref', 'reference no', 'no rujukan', 'rujukan', 'no sebut harga', 'quotation no'] },
      { key: 'title', label: 'Title', type: 'text', required: true, words: ['tajuk', 'tender title', 'tajuk tender', 'project', 'projek', 'scope'] },
      { key: 'buyer', label: 'Buyer', type: 'text', required: true, words: ['agency', 'agensi', 'jabatan', 'kementerian', 'pembeli', 'client', 'pelanggan', 'issued by'] },
      { key: 'channel', label: 'Government or private', type: 'select', required: true, options: CHANNELS, words: ['sector', 'sektor', 'kerajaan swasta', 'channel', 'type'] },
      { key: 'closesOn', label: 'Closes on', type: 'date', required: true, words: ['closing date', 'tarikh tutup', 'tutup', 'close date', 'submission date', 'tarikh hantar'] },
      { key: 'guards', label: 'Guards', type: 'number', required: true, min: 1, max: 1000, words: ['bil pengawal', 'pengawal', 'manpower', 'no of guards', 'guard count', 'bilangan pengawal'] },
      { key: 'sites', label: 'Sites', type: 'number', min: 1, max: 500, words: ['bil lokasi', 'lokasi', 'premis', 'no of sites'] },
      { key: 'estMonthly', label: 'Estimated monthly value (RM)', type: 'number', min: 0, words: ['nilai bulanan', 'monthly value', 'anggaran nilai', 'estimated value'] },
      { key: 'source', label: 'Where it was found', type: 'text', words: ['source', 'sumber', 'portal', 'myprocurement', 'eperolehan'] },
      { key: 'owner', label: 'Followed by', type: 'text', words: ['owner', 'pic', 'person in charge', 'pegawai'] },
      { key: 'armed', label: 'Armed guards', type: 'bool', words: ['bersenjata', 'armed'] },
    ],
  },
  finBankAccount: {
    kind: 'finBankAccount',
    label: 'Company bank account',
    table: 'finStatus',
    companyScoped: true,
    keptBy: 'The Finance team leader, the Finance Director or the CEO',
    screen: 'Finance',
    note: "Each account is added to the company's Finance books as Add bank account adds it. Only the last 4 digits are kept. Balances and reconciliation come from SQL Account and the bank statements afterwards.",
    fields: [
      { key: 'bank', label: 'Bank', type: 'text', required: true, words: ['bank name', 'nama bank'] },
      { key: 'account', label: 'Account number', type: 'text', required: true, restricted: true, help: 'Only the last 4 digits are kept.', words: ['account no', 'acc no', 'no akaun', 'nombor akaun', 'akaun'] },
      { key: 'purpose', label: 'Used for', type: 'select', required: true, options: BANK_PURPOSES, words: ['purpose', 'tujuan', 'kegunaan', 'account type', 'jenis akaun'] },
    ],
  },
  corpFiling: {
    kind: 'corpFiling',
    label: 'SSM filing',
    table: 'corpFilings',
    companyScoped: true,
    keptBy: 'Head office Corporate Admin (the Deputy Chief of Staff)',
    screen: 'Company secretary, Filings',
    note: 'Each filing is added as Add filing adds it, open with its due date. The papers, the MBRS lodgement and the SSM receipt are recorded on the screen afterwards. An empty title or rule takes the usual wording for that filing.',
    fields: [
      { key: 'kind', label: 'Filing', type: 'select', required: true, options: CORP_FILING_KINDS, words: ['filing type', 'jenis lodgement', 'jenis', 'lodgement', 'borang'] },
      { key: 'title', label: 'Title', type: 'text', words: ['description', 'perkara', 'tajuk', 'details'] },
      { key: 'dueOn', label: 'Due on', type: 'date', required: true, words: ['due date', 'tarikh akhir', 'deadline', 'tarikh tamat'] },
      { key: 'basis', label: 'Rule that sets the deadline', type: 'text', words: ['basis', 'section', 'seksyen', 'act', 'akta', 'rule'] },
    ],
  },
  corpAudit: {
    kind: 'corpAudit',
    label: 'Statutory audit',
    table: 'corpAudits',
    companyScoped: true,
    keptBy: 'The company manager or admin executive',
    screen: 'Company secretary, Audit',
    note: 'Each audit is registered as Register an audit registers it: one per company and financial year. Its steps are recorded on the screen afterwards.',
    fields: [
      { key: 'fyEnd', label: 'Financial year end', type: 'date', required: true, words: ['year end', 'fye', 'tahun kewangan', 'akhir tahun kewangan'] },
      { key: 'auditorFirm', label: 'Audit firm', type: 'text', required: true, words: ['auditor', 'juruaudit', 'firma audit', 'audit firm'] },
      { key: 'fee', label: 'Audit fee (RM)', type: 'number', min: 0, words: ['fee', 'yuran', 'yuran audit'] },
      { key: 'pbc', label: 'Documents asked for', type: 'text', required: true, help: 'Separated by commas.', words: ['pbc', 'documents', 'dokumen', 'senarai dokumen'] },
    ],
  },
  legalMatter: {
    kind: 'legalMatter',
    label: 'Legal matter',
    table: 'legalMatters',
    companyScoped: true,
    keptBy: 'PWVSB legal or the company manager',
    screen: 'Company secretary, Legal matters',
    note: 'Each matter is opened as Open a matter opens it. Updates and fees are added on the screen afterwards.',
    fields: [
      { key: 'title', label: 'Matter', type: 'text', required: true, words: ['case', 'kes', 'perkara', 'case title', 'tajuk kes'] },
      { key: 'kind', label: 'Kind', type: 'select', required: true, options: LEGAL_KINDS, words: ['case type', 'jenis kes', 'jenis', 'type'] },
      { key: 'counterparty', label: 'Other party', type: 'text', required: true, words: ['pihak lawan', 'other side', 'opponent', 'party', 'pihak'] },
      { key: 'side', label: 'Whose claim', type: 'select', required: true, options: LEGAL_SIDES, words: ['side', 'pihak kami', 'our side', 'we are', 'role'] },
      { key: 'exposure', label: 'Amount at stake (RM)', type: 'number', min: 0, words: ['claim amount', 'jumlah tuntutan', 'quantum', 'exposure', 'amaun'] },
      { key: 'lawyer', label: 'Lawyers acting', type: 'text', required: true, words: ['solicitor', 'peguam', 'law firm', 'firma guaman', 'counsel'] },
      { key: 'nextOn', label: 'Next date', type: 'date', words: ['next hearing', 'tarikh sebutan', 'tarikh bicara', 'mention date', 'hearing date'] },
      { key: 'nextWhat', label: 'What happens then', type: 'text', words: ['next step', 'langkah seterusnya', 'status'] },
    ],
  },
  bcmSystem: {
    kind: 'bcmSystem',
    label: 'System to protect',
    table: 'bcmSystems',
    companyScoped: false,
    keptBy: 'IT',
    screen: 'Continuity',
    note: 'Each system is listed as Add system lists it, with one copy from the row. Add its other copies, backups and restore tests on the screen; until then it shows as unknown.',
    fields: [
      { key: 'name', label: 'System', type: 'text', required: true, words: ['system name', 'sistem', 'nama sistem', 'application', 'aplikasi'] },
      { key: 'impact', label: 'What breaks when it is down', type: 'text', required: true, words: ['impact', 'kesan', 'business impact', 'kesan jika down', 'kesan jika sistem down', 'impact if down', 'what breaks'] },
      { key: 'rtoHours', label: 'Back within (hours)', type: 'number', required: true, min: 0, max: 720, words: ['rto', 'recovery time', 'rto hours', 'rto jam'] },
      { key: 'rpoHours', label: 'Data lost at most (hours)', type: 'number', required: true, min: 0, max: 720, words: ['rpo', 'recovery point', 'rpo hours', 'rpo jam'] },
      { key: 'copySite', label: 'Copy kept at', type: 'select', required: true, options: BCM_SITES, words: ['backup site', 'lokasi salinan', 'copy', 'salinan', 'backup'] },
      { key: 'copyWhere', label: 'Where the copy is', type: 'text', required: true, words: ['location', 'lokasi', 'provider', 'server', 'data centre', 'di mana', 'where', 'tempat simpan', 'where kept'] },
      { key: 'copyInMalaysia', label: 'Copy in Malaysia', type: 'bool', words: ['in malaysia', 'dalam malaysia', 'malaysia'] },
    ],
  },
  grcObligation: {
    kind: 'grcObligation',
    label: 'Obligation',
    table: 'grcObligations',
    companyScoped: true,
    keptBy: 'The company, internal audit or the owner',
    screen: 'Speak up and assurance, Obligations',
    note: 'Each obligation is added as Add obligation adds it, with no proof yet: it shows as unknown until the company records its proof and internal audit checks it.',
    fields: [
      { key: 'stream', label: 'Workstream', type: 'select', required: true, options: GRC_STREAMS, words: ['area', 'bidang', 'category', 'kategori'] },
      { key: 'title', label: 'What must be done', type: 'text', required: true, words: ['obligation', 'kewajipan', 'requirement', 'keperluan', 'item'] },
      { key: 'basis', label: 'Law or policy', type: 'text', required: true, words: ['basis', 'law', 'akta', 'undang undang', 'policy', 'polisi', 'reference'] },
      { key: 'everyMonths', label: 'Every how many months', type: 'number', required: true, min: 1, max: 60, words: ['frequency', 'kekerapan', 'every', 'setiap', 'months', 'bulan'] },
    ],
  },
  pdpaRegisterItem: {
    kind: 'pdpaRegisterItem',
    label: 'Personal data register entry',
    table: 'pdpaRegister',
    companyScoped: false,
    keptBy: 'The PDPA officer, the CEO or the Chief of Staff',
    screen: 'PDPA, Register',
    note: 'Each entry is added as Add register entry adds it, not yet reviewed. An empty impact assessment is saved as "needed", so the entry shows as needing work until the PDPA officer decides.',
    fields: [
      { key: 'activity', label: 'Activity', type: 'text', required: true, words: ['processing activity', 'aktiviti', 'proses', 'activity name'] },
      { key: 'system', label: 'Kept in', type: 'text', required: true, words: ['system', 'sistem', 'where kept', 'disimpan di', 'storage'] },
      { key: 'subjects', label: 'Whose data', type: 'text', required: true, help: 'Guards, Staff, Job applicants, Clients, Visitors, Drivers, Tenants or Others; several separated by commas.', words: ['data subjects', 'subjek data', 'subjects', 'individuals'] },
      { key: 'dataKinds', label: 'Kinds of personal data', type: 'text', required: true, words: ['data', 'personal data', 'data peribadi', 'jenis data', 'data items'] },
      { key: 'sensitive', label: 'Sensitive data', type: 'bool', words: ['sensitif', 'sensitive'] },
      { key: 'purpose', label: 'Purpose', type: 'text', required: true, words: ['tujuan', 'why'] },
      { key: 'basis', label: 'Legal basis', type: 'select', required: true, options: PDPA_BASES, words: ['lawful basis', 'asas', 'asas undang undang'] },
      { key: 'retentionDays', label: 'Kept for (days)', type: 'number', min: 1, max: 36500, words: ['retention', 'tempoh simpan', 'retention days'] },
      { key: 'disposal', label: 'How it is disposed of', type: 'text', words: ['disposal', 'pelupusan'] },
      { key: 'sharedWith', label: 'Shared with', type: 'text', words: ['disclosed to', 'dikongsi dengan', 'third parties', 'pihak ketiga'] },
      { key: 'outsideMalaysia', label: 'Sent outside Malaysia', type: 'text', words: ['cross border', 'luar negara', 'transfer abroad'] },
      { key: 'ownerDept', label: 'Owning department', type: 'text', words: ['department', 'jabatan', 'owner', 'pemilik'] },
      { key: 'noticeGiven', label: 'Privacy notice given', type: 'bool', words: ['notice', 'notis privasi', 'notis'] },
      { key: 'dpia', label: 'Impact assessment', type: 'select', options: DPIA, words: ['dpia', 'pia', 'penilaian impak'] },
      { key: 'company', label: 'Company', type: 'text', help: 'Leave empty for the whole group.', words: ['syarikat', 'company name'] },
    ],
  },
  pdpaProduct: {
    kind: 'pdpaProduct',
    label: 'Product',
    table: 'products',
    companyScoped: false,
    keptBy: 'The PDPA officer',
    screen: 'PDPA, Products',
    note: 'Each product is added as Add product adds it, with no certificates yet: add each certificate with its copy on the screen. A product already on the list is refused.',
    fields: [
      { key: 'name', label: 'Product', type: 'text', required: true, words: ['product name', 'produk', 'nama produk', 'item'] },
      { key: 'category', label: 'Category', type: 'text', words: ['kategori', 'type', 'jenis'] },
      { key: 'mode', label: 'Sold or rented', type: 'select', required: true, options: PRODUCT_MODES, words: ['mode', 'jual sewa', 'sale or rental', 'kaedah'] },
      { key: 'supplier', label: 'Supplier', type: 'text', words: ['pembekal', 'vendor', 'brand', 'jenama'] },
      { key: 'personalData', label: 'Personal data it holds', type: 'text', help: 'Separated by commas.', words: ['personal data', 'data peribadi', 'data collected'] },
      { key: 'retentionDays', label: 'Kept for (days)', type: 'number', min: 1, max: 3650, words: ['retention', 'tempoh simpan'] },
      { key: 'clientConsent', label: 'Client consent needed', type: 'bool', words: ['consent', 'persetujuan'] },
      { key: 'notes', label: 'Notes', type: 'text', words: ['catatan', 'remarks', 'nota'] },
    ],
  },
  regRisk: {
    kind: 'regRisk',
    label: 'Risk',
    table: 'regRisks',
    companyScoped: true,
    keptBy: 'The ACT Director',
    screen: 'Governance registers, Risks',
    note: 'Each risk is added as Add risk adds it, with its first scores as today\'s review. A high risk needs an action and a due date, as on the form.',
    fields: [
      { key: 'title', label: 'Risk', type: 'text', required: true, words: ['risk title', 'risiko', 'risk description', 'huraian risiko'] },
      { key: 'category', label: 'Kind', type: 'select', required: true, options: RISK_CATEGORIES, words: ['category', 'kategori', 'risk category', 'jenis risiko'] },
      { key: 'ownerName', label: 'Owner', type: 'text', required: true, words: ['risk owner', 'pemilik risiko', 'pemilik', 'pic'] },
      { key: 'likelihood', label: 'Likelihood (1 to 5)', type: 'number', required: true, min: 1, max: 5, words: ['likelihood', 'kebarangkalian', 'probability', 'l'] },
      { key: 'impact', label: 'Impact (1 to 5)', type: 'number', required: true, min: 1, max: 5, words: ['impact', 'kesan', 'severity', 'i'] },
      { key: 'controls', label: 'Controls in place', type: 'text', required: true, words: ['existing controls', 'kawalan', 'kawalan sedia ada', 'mitigation in place'] },
      { key: 'action', label: 'Action', type: 'text', words: ['treatment', 'tindakan', 'mitigation plan', 'pelan tindakan'] },
      { key: 'actionDueOn', label: 'Action due on', type: 'date', words: ['due date', 'tarikh siap', 'target date'] },
    ],
  },
};

export const P91_BIZ_KINDS = Object.keys(P91_BIZ_IMPORTS) as P91BizImportKind[];

export const isBizImportKind = (k: string): k is P91BizImportKind => Object.prototype.hasOwnProperty.call(P91_BIZ_IMPORTS, k);

type Companies = { id: Id; name: string; code?: string }[];

/** One row through the screen's own add. Returns the new record's id. */
export async function saveBizRow(
  saver: BizImportSaver,
  list: (table: keyof Dataset, filter: Record<string, unknown>) => Promise<unknown[]>,
  user: User,
  kind: P91BizImportKind,
  companyId: Id | null,
  v: Record<string, unknown>,
): Promise<Id | null> {
  const cid = companyId as Id;
  switch (kind) {
    case 'tender': {
      const t = await saver.addTender(user, cid, {
        ref: str(v.ref),
        title: str(v.title),
        buyer: str(v.buyer),
        channel: need(v.channel, CHANNELS, 'Government or private') as 'GOVERNMENT' | 'PRIVATE',
        source: str(v.source),
        owner: str(v.owner),
        closesOn: str(v.closesOn),
        guards: Number(v.guards),
        sites: num(v.sites) ?? undefined,
        estMonthly: num(v.estMonthly),
        armed: v.armed === true,
      });
      return t.id;
    }
    case 'finBankAccount': {
      const digits = str(v.account).replace(/\D/g, '');
      if (digits.length < 4) refuse('Account number: give the number, or at least its last 4 digits.');
      const a = await saver.finance.addBankAccount(user, cid, { bank: str(v.bank), last4: digits.slice(-4), purpose: need(v.purpose, BANK_PURPOSES, 'Used for') });
      return a.id;
    }
    case 'corpFiling': {
      const k = need(v.kind, CORP_FILING_KINDS, 'Filing') as CorpFilingKind;
      const label = CORP_FILING_KINDS.find(([x]) => x === k)![1];
      const f = await saver.addCorpFiling(user, cid, {
        kind: k,
        title: str(v.title) || label,
        dueOn: str(v.dueOn),
        basis: str(v.basis) || FILING_BASIS[k] || 'Companies Act 2016',
      });
      return f.id;
    }
    case 'corpAudit': {
      const a = await saver.addCorpAudit(user, cid, { fyEnd: str(v.fyEnd), auditorFirm: str(v.auditorFirm), fee: num(v.fee), pbc: listOf(v.pbc) });
      return a.id;
    }
    case 'legalMatter': {
      const m = await saver.addLegalMatter(user, cid, {
        title: str(v.title),
        kind: need(v.kind, LEGAL_KINDS, 'Kind') as LegalKind,
        counterparty: str(v.counterparty),
        side: need(v.side, LEGAL_SIDES, 'Whose claim') as 'claimant' | 'respondent',
        exposure: num(v.exposure),
        lawyer: str(v.lawyer),
        nextOn: dateOrNull(v.nextOn),
        nextWhat: str(v.nextWhat),
      });
      return m.id;
    }
    case 'bcmSystem': {
      const s = await saver.addBcmSystem(user, {
        name: str(v.name),
        impact: str(v.impact),
        rtoHours: Number(v.rtoHours),
        rpoHours: Number(v.rpoHours),
        copies: [{ site: need(v.copySite, BCM_SITES, 'Copy kept at'), where: str(v.copyWhere), inMalaysia: v.copyInMalaysia === true }],
      });
      return s.id;
    }
    case 'grcObligation': {
      const o = await saver.addGrcObligation(user, cid, {
        stream: need(v.stream, GRC_STREAMS, 'Workstream') as GrcStreamKey,
        title: str(v.title),
        basis: str(v.basis),
        everyMonths: Number(v.everyMonths),
      });
      return o.id;
    }
    case 'pdpaRegisterItem': {
      const subjects = [...new Set(listOf(v.subjects).map((x) => need(x, PDPA_SUBJECTS, 'Whose data') as PdpaSubject))];
      let company: Id | null = null;
      const named = str(v.company);
      if (named) {
        const all = (await list('companies', {})) as Companies;
        const hit = matchCompany(named, all);
        if (!hit) refuse(`Company "${named.slice(0, 80)}" is not a company of the group.`);
        company = hit.id;
      }
      const days = num(v.retentionDays);
      const r = await saver.savePdpaRegisterItem(user, null, {
        companyId: company,
        activity: str(v.activity),
        system: str(v.system),
        subjects,
        dataKinds: str(v.dataKinds),
        sensitive: v.sensitive === true,
        purpose: str(v.purpose),
        basis: need(v.basis, PDPA_BASES, 'Legal basis') as PdpaBasis,
        retentionDays: days,
        disposal: str(v.disposal),
        sharedWith: str(v.sharedWith),
        outsideMalaysia: str(v.outsideMalaysia),
        ownerDept: str(v.ownerDept),
        noticeGiven: v.noticeGiven === true,
        dpia: (str(v.dpia) ? need(v.dpia, DPIA, 'Impact assessment') : 'needed') as 'not_needed' | 'needed' | 'done',
      });
      return r.id;
    }
    case 'pdpaProduct': {
      const name = str(v.name);
      const products = (await list('products', {})) as { name: string }[];
      if (name && products.some((p) => normHeader(p.name) === normHeader(name))) refuse(`Product "${name.slice(0, 80)}" is already on the list.`);
      const p = await saver.saveProduct(user, {
        id: null,
        name,
        category: str(v.category),
        mode: need(v.mode, PRODUCT_MODES, 'Sold or rented') as 'SALE' | 'RENTAL' | 'BOTH',
        supplier: str(v.supplier),
        personalData: listOf(v.personalData),
        retentionDays: num(v.retentionDays),
        clientConsent: v.clientConsent === true,
        notes: str(v.notes),
      });
      return p.id;
    }
    case 'regRisk': {
      const r = (await saver.registers.act(user, 'addRisk', {
        companyId: cid,
        title: str(v.title),
        category: need(v.category, RISK_CATEGORIES, 'Kind'),
        ownerName: str(v.ownerName),
        likelihood: num(v.likelihood),
        impact: num(v.impact),
        controls: str(v.controls),
        action: str(v.action),
        actionDueOn: dateOrNull(v.actionDueOn),
      })) as { id: Id };
      return r.id;
    }
  }
}
