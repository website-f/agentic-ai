// Deterministic mock data shaped like the real group (Fauzan, 24 Oct 2026: build with mock
// data first, real data later). 38 companies; the three pilots get full detail. All people,
// clients and sites are fictional. Same seed + same "today" always gives the same data.

import { GOV_OPS_COMPANY_ID, GROUP_EMPLOYER_ID, IT_COMPANY_ID, PRIVATE_OPS_COMPANY_ID, hasOwnStaffRecord } from './access';
import { seedItems } from './item-seed';
import { itPurchaseRequest } from './purchase';
import { appendAudit, sha256Hex } from './audit';
import { DEMO_PIN_KEEPER, demoPin, demoPinSalt } from './pin';
import { REGIONS, regionOfState } from './regions';
import { BRANCH_CHECKS, dueOf, lineManagerOf, periodOf, playbookFor } from './work';
import { RULES } from './rules';
import { itTenderTimeline } from './it-tender';
import { TENDER_GUIDE_V1, itemPart, sampleTenderReader } from './tender';
import { mondayOf, reportPeriods } from './reports';
import { simpleMinutesReader } from './meetings';
import { seedWebsites, websiteSampleUsers } from './websites-seed';
import { evaluateClockIn, evaluateClockOut, slaDue } from './checks';
import { weekdayOf } from './remote';
import { CLIENT_ONBOARD_STEPS, CLIENT_OFFBOARD_STEPS } from './clients';
import { addDays, addMinutes, dateOf, daysBetween, fromMs, myt, toMs, weekday } from './time';
import { buildStaffPayLine } from './payroll';
import { payFormulaLawCheck, standardDriverAmounts, standardGuardAmounts, type PayFormula, type PayFormulaUse } from './pay-formulas';
import { contractBilling, mobilisationFor, reviewsFor } from './contracts';
import { monthDepn, netBookValue, periodBefore } from './assets';
import type {
  WorkTask,
  BranchAction,
  BranchSettlement,
  StaffPayRun,
  ItAsset,
  ItAssetKind,
  CorpChange,
  CreditLoan,
  CreditDefault,
  GovMandate,
  LegalMatter,
  SalesLead,
  ActFinding,
  GrcObligation,
  PdpaRequest,
  PurRequest,
  PurSupplier,
  StockItem,
  ItOnboarding,
  ItPurchase,
  ItTenderTask,
  ItTicket,
  ItJob,
  ItAccount,
  AmAsset,
  AmInvoice,
  AmProperty,
  AmTenancy,
  AmUnitStatus,
  AmUnitType,
  Id,
  JaPaper,
  JaPayroll,
  JaRecord,
  CertBody,
  ProductCert,
  Meeting,
  ReportDef,
  TenderPaperKind,
  StaffClock,
  StaffClockFlag,
  Attendance,
  AuthorityGrant,
  Branch,
  Case,
  Company,
  CompanyLicence,
  Credential,
  CredentialType,
  Dataset,
  Firearm,
  IsoDate,
  IsoDateTime,
  Person,
  PublicHoliday,
  FwmTask,
  FwRecruitFile,
  HostelBill,
  LeaveKind,
  LeaveRequest,
  Post,
  Quotation,
  Severity,
  Shift,
  ShiftStructure,
  Site,
  SiteRisk,
  Tender,
  User,
  RemoteDay,
  Vault,
  ArmedJob,
  SupplierItem,
  ArmsRequest,
  InsuranceKind,
  InsurancePolicy,
  PhoneCall,
  PhoneExtension,
  SiteAlarm,
  SiteSystem,
} from './types';

// ---------- PRNG ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------- Reference lists ----------

interface Area {
  town: string;
  state: string;
  lat: number;
  lng: number;
}

const AREAS: Area[] = [
  { town: 'Shah Alam', state: 'Selangor', lat: 3.0733, lng: 101.5185 },
  { town: 'Petaling Jaya', state: 'Selangor', lat: 3.1073, lng: 101.6067 },
  { town: 'Subang Jaya', state: 'Selangor', lat: 3.0567, lng: 101.5851 },
  { town: 'Klang', state: 'Selangor', lat: 3.0449, lng: 101.4456 },
  { town: 'Cyberjaya', state: 'Selangor', lat: 2.9213, lng: 101.6559 },
  { town: 'Bangi', state: 'Selangor', lat: 2.9264, lng: 101.7782 },
  { town: 'Cheras', state: 'Kuala Lumpur', lat: 3.0901, lng: 101.7406 },
  { town: 'Kepong', state: 'Kuala Lumpur', lat: 3.2089, lng: 101.6363 },
  { town: 'Bukit Bintang', state: 'Kuala Lumpur', lat: 3.1466, lng: 101.7101 },
  { town: 'Setapak', state: 'Kuala Lumpur', lat: 3.1972, lng: 101.7148 },
  { town: 'Putrajaya', state: 'Putrajaya', lat: 2.9264, lng: 101.6964 },
  { town: 'Seremban', state: 'Negeri Sembilan', lat: 2.7258, lng: 101.9424 },
  { town: 'Melaka', state: 'Melaka', lat: 2.1896, lng: 102.2501 },
  { town: 'Johor Bahru', state: 'Johor', lat: 1.4927, lng: 103.7414 },
  { town: 'Pasir Gudang', state: 'Johor', lat: 1.4726, lng: 103.878 },
  { town: 'Iskandar Puteri', state: 'Johor', lat: 1.4216, lng: 103.6315 },
  { town: 'George Town', state: 'Pulau Pinang', lat: 5.4141, lng: 100.3288 },
  { town: 'Bayan Lepas', state: 'Pulau Pinang', lat: 5.2945, lng: 100.2593 },
  { town: 'Butterworth', state: 'Pulau Pinang', lat: 5.3991, lng: 100.3638 },
  { town: 'Ipoh', state: 'Perak', lat: 4.5975, lng: 101.0901 },
  { town: 'Kuantan', state: 'Pahang', lat: 3.8077, lng: 103.326 },
];

const MALAY_GIVEN = [
  'Ahmad',
  'Mohd Faizal',
  'Azman',
  'Hafiz',
  'Rizal',
  'Zulkifli',
  'Kamarul',
  'Shahrul',
  'Nazri',
  'Firdaus',
  'Hairul',
  'Syafiq',
  'Amirul',
  'Roslan',
  'Suhaimi',
  'Khairul',
  'Mohd Ridzuan',
  'Izzat',
  'Fadzli',
  'Nor Azlan',
  'Siti Aminah',
  'Nurul Huda',
  'Rosnah',
  'Faridah',
];
const MALAY_FATHER = [
  'Abdullah',
  'Ismail',
  'Hassan',
  'Othman',
  'Yusof',
  'Ibrahim',
  'Rahman',
  'Salleh',
  'Hamid',
  'Kassim',
  'Jaafar',
  'Mansor',
  'Ali',
  'Daud',
  'Musa',
];
const CHINESE = ['Tan Wei Ming', 'Lim Chee Keong', 'Wong Kah Wai', 'Lee Boon Hock', 'Ng Siew Lan', 'Chong Yew Seng', 'Teoh Kok Leong', 'Ong Mei Ling'];
const INDIAN_GIVEN = ['Ravi', 'Suresh', 'Ganesan', 'Muniandy', 'Kumar', 'Selvam', 'Rajendran', 'Saravanan', 'Devi', 'Kavitha'];
const INDIAN_FATHER = ['Muthu', 'Krishnan', 'Subramaniam', 'Arumugam', 'Perumal', 'Ramasamy', 'Govindasamy'];
const NEPALI_GIVEN = [
  'Ram Bahadur',
  'Bishnu',
  'Hari Prasad',
  'Krishna',
  'Dil Bahadur',
  'Suman',
  'Bikash',
  'Gopal',
  'Min Bahadur',
  'Santosh',
  'Dipendra',
  'Kamal',
  'Prem',
  'Nabin',
];
const NEPALI_FAMILY = ['Thapa', 'Gurung', 'Shrestha', 'Tamang', 'Magar', 'Rai', 'Limbu', 'Sherpa', 'Karki', 'Bhandari', 'Adhikari'];

interface SiteKind {
  kind: string;
  risk: SiteRisk;
  armed: boolean;
  names: string[];
  posts: string[];
}

const SITE_KINDS: SiteKind[] = [
  {
    kind: 'Condominium',
    risk: 'low',
    armed: false,
    names: ['Residensi Seri', 'Pangsapuri Indah', 'Kondominium Vista', 'Residensi Mutiara', 'The Arcadia'],
    posts: ['Main guardhouse', 'Lobby', 'Car park'],
  },
  {
    kind: 'Factory',
    risk: 'medium',
    armed: false,
    names: ['Kilang Elektronik', 'Precision Moulding', 'Kilang Makanan', 'Gasket Industries', 'Polimer Teknik'],
    posts: ['Main gate', 'Loading bay', 'Perimeter patrol'],
  },
  { kind: 'Warehouse', risk: 'medium', armed: false, names: ['Gudang Logistik', 'Distribution Hub', 'Cold Chain Depot'], posts: ['Gate', 'Yard patrol'] },
  {
    kind: 'Hospital',
    risk: 'medium',
    armed: false,
    names: ['Pusat Perubatan', 'Specialist Medical Centre'],
    posts: ['Emergency entrance', 'Main lobby', 'Car park'],
  },
  { kind: 'School', risk: 'low', armed: false, names: ['Sekolah Kebangsaan', 'Sekolah Menengah', 'International School'], posts: ['Main gate'] },
  { kind: 'Office tower', risk: 'low', armed: false, names: ['Menara', 'Wisma', 'Plaza'], posts: ['Lobby', 'Control room'] },
  { kind: 'Shopping mall', risk: 'medium', armed: false, names: ['Mall', 'Pusat Beli-belah'], posts: ['Control room', 'Mall patrol', 'Loading bay'] },
  { kind: 'Bank branch', risk: 'high', armed: true, names: ['Bank branch'], posts: ['Banking hall'] },
  { kind: 'Construction site', risk: 'medium', armed: false, names: ['Tapak Projek', 'Site Office'], posts: ['Site gate'] },
];

const PILOTS = [
  { code: 'SASA', name: 'Sasa Security Services Sdn Bhd', guards: 300, sites: 70, states: ['Selangor', 'Kuala Lumpur', 'Johor'] },
  { code: 'ARSH', name: 'Arrow Shield Security Sdn Bhd', guards: 190, sites: 45, states: ['Selangor', 'Pulau Pinang', 'Perak'] },
  { code: 'INAS', name: 'Inas Security and Consultancy Sdn Bhd', guards: 130, sites: 30, states: ['Kuala Lumpur', 'Negeri Sembilan', 'Melaka'] },
];

/** Shift times by structure. A: 2 x 12h, B: 3 x 8h, C: day 12h only, D: night 12h only, E: office hours. */
const STRUCTURES: Record<ShiftStructure, [string, string][]> = {
  A: [
    ['07:00', '19:00'],
    ['19:00', '07:00'],
  ],
  B: [
    ['07:00', '15:00'],
    ['15:00', '23:00'],
    ['23:00', '07:00'],
  ],
  C: [['07:00', '19:00']],
  D: [['19:00', '07:00']],
  E: [['08:00', '17:00']],
};

const MASTER_SEED = 20261024;

/** The month k months before today's month, as YYYY-MM. */
function monthsBack(today: IsoDate, k: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 - k;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

export interface SeedOptions {
  /** The demo's "today" (Malaysia date). */
  today: IsoDate;
  /** The demo's current time; defaults to 10:30 on today. */
  now?: IsoDateTime;
  /** Days of roster before and after today. */
  daysBack?: number;
  daysForward?: number;
}

const PATROL_NAMES = [
  'Mohd Rizal bin Jaafar',
  'Vinod a/l Krishnan',
  'Khairul Anuar bin Said',
  'Chong Kok Wai',
  'Saravanan a/l Ramasamy',
  'Mohd Hafizi bin Ismail',
  'Lee Chun Hong',
  'Nazri bin Abdul Ghani',
  'Muthu a/l Velu',
  'Shahrul Nizam bin Omar',
  'Ong Teck Seng',
  'Faizal bin Rahim',
  'Kumar a/l Subramaniam',
  'Zainal Abidin bin Musa',
  'Wong Kah Leong',
  'Ridzuan bin Hassan',
];

/**
 * Patrolling officers (Fauzan, 25 Oct 2026): each covers the sites of an area, above any officer stationed there,
 * and commands at most 60 guards (rule OPS-PATROL-SPAN). Some also patrol a few sites of another company in the
 * group, and those companies share the salary by guard count (rule OPS-SHARED-PAY). The mock keeps each officer
 * near 55 guards rostered today; the Sasa officer who also works for Inas in Kuala Lumpur goes over the limit, to
 * show the warning.
 */
function patrolOfficers(ds: Dataset, today: IsoDate): User[] {
  const guardsAt = (siteId: string) => new Set(ds.shifts.filter((x) => x.siteId === siteId && x.date === today && x.personId).map((x) => x.personId)).size;
  const stateOf = (s: Site) => ds.branches.find((b) => b.id === s.branchId)!.state;
  const sitesOf = (cid: string) => ds.sites.filter((s) => s.companyId === cid);
  // A Sasa officer in Kuala Lumpur also works for Inas at Inas sites there.
  const shared = sitesOf('co-inas')
    .filter((s) => stateOf(s) === 'Kuala Lumpur')
    .slice(0, 8);
  const out: User[] = [];
  let n = 0;
  for (const p of PILOTS) {
    const cid = `co-${p.code.toLowerCase()}`;
    const sites = sitesOf(cid).filter((s) => !shared.includes(s));
    const states = [...new Set(sites.map(stateOf))];
    let k = 0;
    for (const st of states) {
      let chunk: Site[] = [];
      let guards = 0;
      const flush = () => {
        if (!chunk.length) return;
        k += 1;
        out.push({
          id: `u-po-${p.code.toLowerCase()}-${k}`,
          name: PATROL_NAMES[n++ % PATROL_NAMES.length],
          title: `Patrolling Officer, ${p.name.split(' ')[0] === 'Arrow' ? 'Arrow Shield' : p.name.split(' ')[0]} (${st})`,
          role: 'supervisor',
          opsTier: 'patrol',
          homeCompanyId: cid,
          monthlySalary: 3200,
          companyIds: [cid],
          siteIds: chunk.map((s) => s.id),
        });
        chunk = [];
        guards = 0;
      };
      for (const s of sites.filter((x) => stateOf(x) === st)) {
        const g = guardsAt(s.id);
        if (guards + g > 55) flush();
        chunk.push(s);
        guards += g;
      }
      flush();
    }
  }
  // Give Inas sites to the shared officer until over the limit; the rest stay with the Inas officer in Kuala Lumpur.
  const kl = out.find((u) => u.homeCompanyId === 'co-sasa' && u.title.endsWith('(Kuala Lumpur)'));
  const inasKl = out.find((u) => u.homeCompanyId === 'co-inas' && u.title.endsWith('(Kuala Lumpur)'));
  const span = (u: User) => new Set(ds.shifts.filter((x) => u.siteIds.includes(x.siteId) && x.date === today && x.personId).map((x) => x.personId)).size;
  let given = 0;
  for (const site of shared) {
    if (kl && (given < 2 || span(kl) <= 60)) {
      kl.siteIds.push(site.id);
      given += 1;
    } else inasKl?.siteIds.push(site.id);
  }
  if (kl && given) {
    kl.companyIds.push('co-inas');
    kl.title = `Patrolling Officer, Sasa and Inas (Kuala Lumpur, ${given} Inas sites)`;
    // Working for two companies pays more (Fauzan's example).
    kl.monthlySalary = 4000;
  }
  return out;
}

/** Proposed reports to the Director Office until the Director Office Administrator sets the real list. */
export const PLACEHOLDER_REPORTS: ReportDef[] = [
  {
    id: 'ops-weekly',
    name: 'Weekly operations report',
    detail: 'Sites, manpower, no-shows, incidents and client complaints for the week.',
    from: 'company',
    frequency: 'weekly',
    dueDay: 5,
    active: true,
  },
  {
    id: 'accounts-monthly',
    name: 'Monthly management accounts',
    detail: 'Profit and loss, billing, collections and aged debtors.',
    from: 'company',
    frequency: 'monthly',
    dueDay: 10,
    active: true,
  },
  {
    id: 'hr-monthly',
    name: 'Monthly HR and statutory payments',
    detail: 'Headcount, joiners and leavers, EPF, SOCSO, EIS and PCB paid.',
    from: 'company',
    frequency: 'monthly',
    dueDay: 7,
    active: true,
  },
  {
    id: 'dept-hr-weekly',
    name: 'HR monitor summary',
    detail: 'Papers blocking guards, KDN and CSG status across the group.',
    from: 'department',
    department: 'hr',
    frequency: 'weekly',
    dueDay: 1,
    active: true,
  },
  {
    id: 'dept-arms-monthly',
    name: 'Arms and vault report',
    detail: 'Firearm counts, movements, permits and incidents.',
    from: 'department',
    department: 'arms_control',
    frequency: 'monthly',
    dueDay: RULES.monthlyReport.value.dueDay,
    sections: RULES.monthlyReport.value.sections,
    checks: RULES.monthlyReport.value.checks['arms_control'],
    active: true,
  },
  {
    id: 'dept-cos-monthly',
    name: 'Insurance report',
    detail: 'Policies, renewals, premiums and claims.',
    from: 'department',
    department: 'chief_of_staff',
    frequency: 'monthly',
    dueDay: RULES.monthlyReport.value.dueDay,
    sections: RULES.monthlyReport.value.sections,
    checks: RULES.monthlyReport.value.checks['chief_of_staff'],
    active: true,
  },
  {
    id: 'dept-ops-weekly',
    name: 'Regional operations summary',
    detail: 'Patrol gaps, escalated cases and staffing by region.',
    from: 'department',
    department: 'operations',
    frequency: 'weekly',
    dueDay: 1,
    active: true,
  },
];

/**
 * Every central department sends a monthly report (Fauzan, 2 Nov 2026), due on the 25th of the next month, on the
 * standard form the ACT Director keeps (rule RPT-MONTHLY). Arms Control and the Chief of Staff already have theirs above.
 */
export const DEPARTMENT_MONTHLY_REPORTS: ReportDef[] = (
  [
    ['operations', 'Operations'],
    ['hr', 'Human Resources'],
    ['cms', 'CMS command centre'],
    ['director_office', 'Director Office'],
    ['fwm', 'Foreign Worker Management'],
    ['pdpa', 'PDPA'],
    ['transport', 'Transport'],
    ['asset', 'Asset Management'],
    ['finance', 'Finance'],
    ['it', 'IT'],
    ['legal', 'Legal'],
    ['audit', 'ACT'],
    ['procurement', 'Procurement and Inventory'],
  ] as [NonNullable<User['department']>, string][]
).map(([department, label]) => ({
  id: `dept-${department}-monthly`,
  name: `${label} monthly report`,
  detail: 'Standard monthly department report (proposed form, ACT decides the sections).',
  from: 'department' as const,
  department,
  frequency: 'monthly' as const,
  dueDay: RULES.monthlyReport.value.dueDay,
  sections: RULES.monthlyReport.value.sections,
  checks: RULES.monthlyReport.value.checks[department] ?? [],
  active: true,
}));

/**
 * The JKR security tender QT260000000027957 as the Director Office's tender-specific checklist V2.0 (discussion of
 * 11 Oct 2026) sets it out from the ePerolehan papers: the example of what the AI agent should draft.
 */
const JKR_CHECKLIST = (
  [
    [
      'AP 1.1 / 1.6: hantar melalui eP',
      'Isi cadangan lengkap dan muat naik semua lampiran wajib pada ruang ditetapkan. Simpan bukti penghantaran berjaya sebelum tutup.',
      'AP 1.1, 1.6',
      false,
    ],
    [
      'AP 1.2: teknikal tanpa identiti syarikat',
      'Jangan letak nama, cop atau tanda syarikat dalam teknikal. Semak kepala surat, logo, brosur, sijil dan muka surat lampiran.',
      'AP 1.2',
      false,
    ],
    [
      'AP 1.3: Bahasa Malaysia dan satu tawaran',
      'Semua dokumen termasuk manual teknikal dalam Bahasa Malaysia. Satu tawaran sahaja; tiada tawaran alternatif.',
      'AP 1.3',
      false,
    ],
    ['AP 1.5: semak notis pindaan', 'Staf tender rekod versi dan tarikh; semak notifikasi serta tab notis dikemaskini sebelum penghantaran.', 'AP 1.5', false],
    [
      'AP 11.2: penandatangan Surat Akuan Pembida',
      'Nama mesti tersenarai dalam Modul Pendaftaran Pembida eP. Sediakan Surat Perwakilan Kuasa bersama akuan.',
      'AP 11.2',
      false,
    ],
    [
      'AP 13.3 / 13.4: akuan PROTEGE',
      'Arahan menyebut akuan PROTEGE, tetapi tiada tajuk berasingan dalam senarai kewangan. Dapatkan borang/lokasi muat naik dan penjelasan JKR.',
      'AP 13.3, 13.4',
      false,
    ],
    [
      'Semak semua item harga dan fi eP',
      'Tawaran dalam RM; kira semua item, kos berkaitan dan fi eP. Harga perkhidmatan ditawarkan tanpa CJCP mengikut klausa 13.1.',
      'Syarat Am 12, 13.1',
      false,
    ],
    [
      'T1: Brosur / Risalah',
      'Operasi pilih brosur peralatan yang menyokong tawaran. Semak Bahasa Malaysia dan buang tanda syarikat pembida daripada salinan teknikal.',
      'Senarai Teknikal item 1',
      true,
    ],
    [
      'T2: Sijil keahlian persatuan terkini',
      'Sijil Persatuan Perkhidmatan Kawalan Keselamatan Malaysia. Semak tempoh sah; urus identiti pada salinan teknikal mengikut AP 1.2.',
      'Senarai Teknikal item 2',
      true,
    ],
    [
      'T3: Lesen KDN yang masih sah',
      'Lesen seksyen 3, Akta Agensi Persendirian 1971 bagi urusan seksyen 2(a). Semak syarikat, aktiviti dan tarikh luput.',
      'Senarai Teknikal item 3',
      true,
    ],
    [
      'T4: Surat KDN negeri / kawasan operasi',
      'Surat kelulusan operasi terkini; semak liputan lokasi Kuala Lumpur. Patuhi larangan identiti syarikat.',
      'Senarai Teknikal item 4',
      true,
    ],
    [
      'T5: Jadual 4, kelengkapan dan peralatan',
      'PTJ muat naik. Dapatkan borang asal JKR; isi jenis, kuantiti dan butiran berdasarkan spesifikasi. Lampiran belum diperoleh.',
      'Senarai Teknikal item 5',
      true,
    ],
    [
      'F1: Pengesahan bank bagi tiga bulan penyata',
      'Bulan tepat tidak dinyatakan; Jul-Ogos-Sep 2026 ialah cadangan kerja, bukan syarat disahkan.',
      'Senarai Kewangan item 1',
      true,
    ],
    [
      'F2: Kunci kira-kira tahunan',
      'Bagi syarikat ROC, salinan mesti diaudit. Tahun yang diperlukan tidak disebut dalam senarai.',
      'Senarai Kewangan item 2',
      true,
    ],
    [
      'F3: Pengesahan jumlah yang telah dibayar',
      'Dapatkan pengesahan institusi kewangan. Tujuan dan format tidak dijelaskan; jangan gantikan dengan dokumen lain.',
      'Senarai Kewangan item 3',
      true,
    ],
    [
      'F4: Pengisytiharan maklumat syarikat [PTJ]',
      'Dapatkan borang asal; isi berdasarkan rekod SSM/MOF. Semak arahan tandatangan.',
      'Senarai Kewangan item 4',
      true,
    ],
    ['F5: Tax Compliance Certificate (TCC)', 'TCC bagi syarikat pembida; semak identiti, tempoh dan kandungan sijil.', 'Senarai Kewangan item 5', true],
    ['F6: Akuan pemerdagangan orang / buruh paksa', 'Borang PTJ. Isi maklumat sebenar dan dapatkan tandatangan yang diminta.', 'Senarai Kewangan item 6', true],
    [
      'F7: Pemberitahuan pemunya benefisial [PTJ]',
      'Isi berdasarkan rekod pemunya benefisial syarikat; lengkapkan borang asal.',
      'Senarai Kewangan item 7',
      true,
    ],
    [
      'F8: PERKESO, pendaftaran, 8A dan resit',
      'Surat pengesahan pendaftaran, Jadual Caruman Bulanan Borang 8A dan resit bayaran terbaru.',
      'Senarai Kewangan item 8',
      true,
    ],
    ['F9: KWSP A setiap pekerja', 'Borang KWSP A bagi bulan caruman terakhir.', 'Senarai Kewangan item 9', true],
    [
      'F10: Pengalaman Kerajaan Persekutuan',
      'Jumlah RM kontrak yang pernah diikat; nama agensi, rujukan, nilai dan tempoh, dengan bukti kontrak.',
      'Senarai Kewangan item 10',
      true,
    ],
    [
      'F11: Surat Akuan Pembida [PTJ]',
      'Sampel Lampiran 6; tandatangan oleh penama eP dan lampirkan Surat Perwakilan Kuasa.',
      'Senarai Kewangan item 11; AP 11.2',
      true,
    ],
    [
      'F12: Akuan syarikat berdaftar MOF / LPI',
      'Borang PTJ. Semak penandatangan dan maklumat pendaftaran; ia tidak menggantikan akuan PROTEGE.',
      'Senarai Kewangan item 12',
      true,
    ],
    ['F13: Penyata aliran tunai tiga bulan terkini', 'Borang PTJ; padankan baki dengan penyata bank.', 'Senarai Kewangan item 13', true],
    ['F14: Aset dan liabiliti [PTJ]', 'Salin angka daripada kunci kira-kira dengan tahun dan unit RM yang betul.', 'Senarai Kewangan item 14', true],
    ['F15: Kemudahan kredit [PTJ]', 'Isi kemudahan yang benar-benar tersedia; jangan cipta jumlah kredit.', 'Senarai Kewangan item 15', true],
    ['F16: Laporan bank, maklumat simpanan', 'Borang PTJ dan pengesahan bank; padankan akaun serta nilai simpanan.', 'Senarai Kewangan item 16', true],
    [
      'Liputan siang: 1 ketua + 9 pengawal, 7 pagi-7 malam',
      'Roster, pos dan pengganti untuk 10 posisi; 10 bukan jumlah pekerja keseluruhan.',
      'Spesifikasi hlm. 1',
      false,
    ],
    ['Liputan malam: 1 penolong ketua + 5 pengawal, 7 malam-7 pagi', 'Roster 6 posisi dan liputan cuti/ketidakhadiran.', 'Spesifikasi hlm. 1', false],
    [
      'Dapatkan Jadual 1 hingga Jadual 8',
      'Spesifikasi merujuk jadual ini; dokumen lengkap belum tersedia dalam set papan notis.',
      'Spesifikasi hlm. 1-2',
      false,
    ],
    ['Insurans pampasan pekerja', 'Kewangan semak kos/polisi; operasi semak pekerja dilindungi.', 'Spesifikasi hlm. 2', false],
    [
      'Laporan harian dan bulanan bergambar',
      'Laporan harian selewat-lewatnya 9 pagi hari berikut; laporan bulanan bergambar berwarna, 1 softcopy dan 1 hardcopy.',
      'Spesifikasi hlm. 2',
      false,
    ],
    ['Peralatan dan pejabat tapak', 'Rujuk Jadual 4; Pondok Pengawal 1 anggaran 9.7 m2 termasuk air/elektrik.', 'Spesifikasi hlm. 2', false],
    ['Asingkan folder Teknikal dan Kewangan', 'Contoh QT260000000027957/TEKNIKAL/T01_Brosur.pdf; bukan arahan nama fail rasmi.', 'AP 1.1-1.6', false],
    ['Semak semua 5 teknikal dan 16 kewangan pada ruang eP', 'Buka setiap fail untuk semak halaman dan kebolehbacaan.', 'Senarai Teknikal/Kewangan', false],
    ['Semak anonimitas teknikal secara visual', 'Cari nama/cap/logo pembida pada semua halaman, sijil dan brosur.', 'AP 1.2', false],
    ['Kewangan semak semua angka harga', 'Unit Hours, kuantiti, 30.5 hari, 60 bulan, fi eP dan tawaran tanpa CJCP.', 'Harga Indikatif hlm. 1', false],
  ] as [string, string, string, boolean][]
).map(([label, detail, ref, needsDocument]) => ({ label, detail, ref, needsDocument }));

/** The six questions the JKR checklist says to put to the buyer in writing before closing. */
const JKR_QUERIES: [string, string][] = [
  ['Mohon lampiran sebenar Jadual 1-8, khususnya Jadual 4 yang dirujuk oleh spesifikasi dan senarai teknikal.', 'Spesifikasi; Senarai Teknikal item 5'],
  ['Mohon borang kewangan PTJ F4, F6, F7 dan F11-F16 serta lokasi sebenar muat naik.', 'Senarai Kewangan'],
  ['Sahkan tiga bulan pengesahan bank (F1), format pengesahan, maksud jumlah yang telah dibayar (F3) dan tahun akaun beraudit.', 'Senarai Kewangan item 1-3'],
  ['Sahkan borang dan lokasi muat naik akuan PROTEGE serta sama ada akuan dan pelaksanaan terpakai.', 'AP 13.3, 13.4'],
  ['Sahkan cara memenuhi AP 1.2 bagi sijil persatuan, lesen KDN dan surat KDN tanpa mengubah kesahihan dokumen asal.', 'AP 1.2'],
  ['Sahkan tarikh mula/SST dan penggunaan lajur Hours/kuantiti harga sebelum harga akhir dimuktamadkan.', 'AP 9; Jadual Kekerapan'],
];

export function generateDataset(opts: SeedOptions): Dataset {
  const today = opts.today;
  const now = opts.now ?? myt(today, '10:30');
  const daysBack = opts.daysBack ?? 7;
  const daysForward = opts.daysForward ?? 7;
  const rng = new Rng(MASTER_SEED);

  const ds: Dataset = {
    companies: [],
    branches: [],
    sites: [],
    posts: [],
    people: [],
    credentials: [],
    licences: [],
    shifts: [],
    attendance: [],
    cases: [],
    checkpoints: [],
    scans: [],
    tenders: [],
    quotations: [],
    salesLeads: [],
    vaults: [],
    firearms: [],
    armsMovements: [],
    armedJobs: [],
    cmsShifts: [],
    cmsStaff: [],
    cmsSettings: [],
    tenderProtocols: [],
    reportDefs: [],
    reportSubmissions: [],
    tenderGroups: [],
    meetings: [],
    staffClocks: [],
    doorEvents: [],
    remoteArrangements: [],
    workTasks: [],
    workCheckIns: [],
    helpRequests: [],
    oneOnOnes: [],
    playbookSignoffs: [],
    branchChecks: [],
    branchVisits: [],
    remoteDays: [],
    socsoClaims: [],
    fwRenewals: [],
    fwmTasks: [],
    fwWelfareChecks: [],
    // Empty: the table comes with db/modules/fw-recruit-v1.sql, which a reset does not install. The browser demo adds
    // demoFwRecruitFiles() itself.
    fwRecruitFiles: [],
    locationPings: [],
    hostels: [],
    hostelStays: [],
    hostelBills: [],
    utilityCharges: [],
    claimRates: [],
    memos: [],
    pdpaCases: [],
    vehicles: [],
    products: [],
    clientAccounts: [],
    expenseRequests: [],
    companyDesks: [],
    companyRunLinks: [],
    // P81: check-in places are set by HR and managers on the Check-in places screen; none are invented here.
    checkinPlaces: [],
    checkinRules: [],
    checkinSettings: [],
    checkinEvents: [],
    jaRecords: [],
    jaSyncs: [],
    amUnits: [],
    amWorkOrders: [],
    amAssets: [],
    amDepnPostings: [],
    staffIds: [],
    staffAccounts: [],
    staffFaces: [],
    publicHolidays: [],
    allowanceTypes: [],
    flexRequests: [],
    vacancies: [],
    applicants: [],
    staffMovements: [],
    loginHandovers: [],
    hrFilings: [],
    hrCases: [],
    officeOsh: [],
    staffTraining: [],
    staffAppraisals: [],
    hrPolicies: [],
    staffOvertime: [],
    hrLegalChecks: [],
    policyAcks: [],
    actFindings: [],
    actAudits: [],
    actImprovements: [],
    amProperties: [],
    vehicleRequests: [],
    staffClaims: [],
    tripApprovals: [],
    staffPayRuns: [],
    finStatus: [],
    arishaDrafts: [],
    itemSkus: [], physicalItems: [], itemLots: [], itemEvents: [], itemMovements: [], itemCases: [], itemCounts: [], itemSyncJobs: [], itemRequests: [], itemSettings: [], itemDocs: [], uniformRecords: [],
    itImportReviews: [],
    contracts: [],
    branchSettlements: [],
    branchActions: [],
    itAssets: [],
    itDomains: [],
    payChanges: [],
    itTickets: [],
    itOnboarding: [],
    itTenderTasks: [],
    itPurchases: [],
    itJobs: [],
    itCodeHolders: [],
    itSettings: [],
    payFormulas: [],
    payFormulaUses: [],
    siteHoursApprovals: [],
    publicHolidayLists: [],
    guardPayRuns: [],
    guardPayAdvances: [],
    guardLoans: [],
    statutoryVersions: [],
    payLawVersions: [],
    itManualReceipts: [],
    itRentalBills: [],
    itRentalRates: [],
    itAssetInspections: [],
    itOperationalReceipts: [],
    itCleanupNominations: [], itCleanupArchives: [], itCleanupReceipts: [], itCleanupPlanBindings: [], orgEvents: [], orgTasks: [], orgNotices: [], orgImports: [], attendanceImports: [], attendanceDays: [], attendanceMatches: [],
    itMetricStreams: [], itMetricReceipts: [], itMetricTargets: [], itMetricCalendars: [],
    itPurchaseFinanceAuthorities: [], itProcurementPackets: [], itProcurementReceipts: [],
    itRentalCorrectionRequests: [], itRentalCorrectionReviews: [], itRentalReplacements: [], itRentalReplacementPayments: [], itRentalCorrectionReceipts: [],
    hrItRequests: [], hrItApprovals: [], hrItDelegations: [], hrItAuthorityMappings: [], hrItReceipts: [],
    confidentialityAcks: [],
    itAccounts: [],
    itAccessRequests: [],
    webCompanies: [],
    webDomains: [],
    webSites: [],
    webReviews: [],
    webChecks: [],
    webIssues: [],
    webDnsChanges: [],
    webNotices: [],
    webSettings: [],
    corpProfiles: [],
    panelFirms: [],
    delegations: [],
    criticalRoles: [],
    legalHolds: [],
    legalHoldVersions: [],
    creditLoans: [],
    creditDefaults: [],
    purSuppliers: [],
    purRequests: [],
    stockItems: [],
    stockIssues: [],
    govMandates: [],
    grcObligations: [],
    whistleReports: [],
    giftEntries: [],
    oshAssessments: [],
    pdpaDpos: [],
    pdpaRequests: [],
    bcmSystems: [],
    bcmDrills: [],
    corpAudits: [],
    legalMatters: [],
    corpFilings: [],
    corpChanges: [],
    phoneExtensions: [],
    phoneCalls: [],
    siteSystems: [],
    siteAlarms: [],
    siteDispatches: [],
    postLogs: [],
    siteVehicles: [],
    gateEntries: [],
    siteNeedsReviews: [],
    siteTasks: [],
    siteTaskLogs: [],
    evidenceVideos: [],
    attendanceFollowUps: [],
    evidencePhotos: [],
    evidenceDocs: [],
    leaveRequests: [],
    siteVisits: [],
    vaultWatches: [],
    armsSuppliers: [],
    supplierItems: [],
    dealerLicences: [],
    vaultEvents: [],
    ammoStocks: [],
    armsAgreements: [],
    armsRequests: [],
    insurancePolicies: [],
    insuranceClaims: [],
    insuranceGuarantees: [],
    users: [],
    grants: [],
    audit: [],
  };

  // ----- Companies: 3 pilots + 35 others (38 per Fauzan, 24 Oct 2026) -----
  PILOTS.forEach((p, i) => {
    ds.companies.push({
      id: `co-${p.code.toLowerCase()}`,
      code: p.code,
      name: p.name,
      isPilot: true,
      headOfCompany: ['Nor Azlina binti Hashim', 'Kenny Lau Chee Wah', 'Mohd Shukri bin Ahmad'][i],
      state: p.states[0],
      guardCount: p.guards,
      siteCount: p.sites,
    });
  });
  // The three companies that will hold the arms dealer licence (Fauzan, 25 Oct 2026). Other figures are mock.
  const DEALERS: Record<number, string> = { 4: 'Splendid Tactic Sdn Bhd', 5: 'Tiara Force Security Services Sdn Bhd', 6: 'Jaguar Force Sdn Bhd' };
  for (let n = 4; n <= 38; n++) {
    const area = rng.pick(AREAS);
    const guards = rng.int(80, 320);
    ds.companies.push({
      id: `co-${String(n).padStart(2, '0')}`,
      code: `C${String(n).padStart(2, '0')}`,
      name: DEALERS[n] ?? `Group Company ${String(n).padStart(2, '0')} (mock)`,
      isPilot: false,
      headOfCompany: '(to be named)',
      state: area.state,
      guardCount: guards,
      siteCount: Math.round(guards / rng.int(3, 5)),
    });
  }

  // ----- Company licences. Some deliberately due, overdue or unknown. -----
  for (const c of ds.companies) {
    const licenceTypes = ['KDN_LICENCE', 'MOF_REGISTRATION', 'INSURANCE', 'SSM_ANNUAL_RETURN'] as const;
    for (const type of licenceTypes) {
      const roll = rng.float();
      let expiresOn: IsoDate | null;
      if (!c.isPilot && roll < 0.06)
        expiresOn = null; // no record yet
      else if (roll < 0.1) expiresOn = addDays(today, -rng.int(3, 40));
      else if (roll < 0.3) expiresOn = addDays(today, rng.int(10, 110));
      else expiresOn = addDays(today, rng.int(130, 700));
      ds.licences.push({
        id: `lic-${c.id}-${type.toLowerCase()}`,
        companyId: c.id,
        type,
        reference:
          type === 'KDN_LICENCE'
            ? `KDN/PA/${rng.int(1000, 9999)}`
            : type === 'SSM_ANNUAL_RETURN'
              ? `${rng.int(100000, 999999)}-${String.fromCharCode(65 + rng.int(0, 25))}`
              : `${type.slice(0, 3)}-${rng.int(10000, 99999)}`,
        expiresOn,
      });
    }
  }

  // ----- Pilot detail -----
  for (const p of PILOTS) {
    let caseSeq = 1;
    const companyId = `co-${p.code.toLowerCase()}`;
    const areasForCompany = AREAS.filter((a) => p.states.includes(a.state));

    // Branches: one per state; models vary to show A/B/C.
    const branches: Branch[] = p.states.map((state, i) => ({
      id: `br-${p.code.toLowerCase()}-${i + 1}`,
      companyId,
      name: `${p.code === 'SASA' ? 'Sasa' : p.code === 'ARSH' ? 'Arrow Shield' : 'Inas'} ${state}`,
      model: (['B', 'A', 'C'] as const)[i % 3],
      state,
    }));
    ds.branches.push(...branches);

    // Sites and posts
    const sites: Site[] = [];
    for (let s = 1; s <= p.sites; s++) {
      const branch = branches[(s - 1) % branches.length];
      const area = rng.pick(areasForCompany.filter((a) => a.state === branch.state));
      // Every pilot keeps at least one armed site (its last), so arms data exists whatever the date.
      const kind = rng.chance(0.06) || (s === p.sites && !sites.some((x) => x.armed)) ? SITE_KINDS[7] : rng.pick(SITE_KINDS.filter((k) => !k.armed));
      const base = rng.pick(kind.names);
      const name = kind.kind === 'Bank branch' ? `Bank Mock ${area.town}` : `${base} ${area.town} ${s}`;
      const site: Site = {
        id: `st-${p.code.toLowerCase()}-${String(s).padStart(3, '0')}`,
        companyId,
        branchId: branch.id,
        code: `${p.code}-${String(s).padStart(3, '0')}`,
        name,
        client: kind.kind === 'Condominium' ? `${name} Joint Management Body` : `${name} (${kind.kind.toLowerCase()} client)`,
        address: `Lot ${rng.int(1, 9999)}, ${area.town}, ${area.state}`,
        lat: +(area.lat + (rng.float() - 0.5) * 0.06).toFixed(5),
        lng: +(area.lng + (rng.float() - 0.5) * 0.06).toFixed(5),
        risk: kind.risk,
        armed: kind.armed,
        geofenceM: kind.kind === 'Factory' || kind.kind === 'Warehouse' ? 300 : 150,
        // Banks ask for hourly rounds in the mock contracts; everyone else follows the group default.
        patrolIntervalMin: kind.armed ? 60 : null,
        patrolIntervalNote: kind.armed ? 'Client contract: hourly rounds' : null,
        // Government clients in the mock: public schools, government clinics, public works sites and Wisma offices.
        sector: ['Sekolah Kebangsaan', 'Sekolah Menengah', 'Pusat Perubatan', 'Tapak Projek', 'Wisma'].includes(base) ? 'government' : 'private',
      };
      sites.push(site);
      const postCount = Math.min(kind.posts.length, kind.risk === 'low' ? 1 : rng.int(1, 2));
      for (let k = 0; k < postCount; k++) {
        const structure: ShiftStructure = kind.kind === 'Bank branch' || kind.kind === 'School' ? 'E' : kind.kind === 'Office tower' && k > 0 ? 'C' : 'A';
        ds.posts.push({
          id: `${site.id}-p${k + 1}`,
          companyId,
          siteId: site.id,
          name: kind.posts[k],
          shiftStructure: structure,
          guardsPerShift: kind.risk === 'medium' && k === 0 && rng.chance(0.3) ? 2 : 1,
        });
      }
      const cpCount = rng.int(3, 5);
      for (let k = 1; k <= cpCount; k++) {
        ds.checkpoints.push({
          id: `${site.id}-cp${k}`,
          companyId,
          siteId: site.id,
          name: ['Main gate', 'Back fence', 'Car park level 1', 'Pump room', 'Loading bay', 'Rooftop door'][k - 1],
          tagCode: `${site.code}-CP${k}`,
        });
      }
    }
    ds.sites.push(...sites);

    // People: about 25% Nepali (2,000 of 8,000 group-wide)
    const people: Person[] = [];
    for (let g = 1; g <= p.guards; g++) {
      const branch = branches[(g - 1) % branches.length];
      const roll = rng.float();
      const nationality = roll < 0.25 ? 'NP' : 'MY';
      let name: string;
      if (nationality === 'NP') name = `${rng.pick(NEPALI_GIVEN)} ${rng.pick(NEPALI_FAMILY)}`;
      else if (roll < 0.85) {
        const given = rng.pick(MALAY_GIVEN);
        const female = ['Siti Aminah', 'Nurul Huda', 'Rosnah', 'Faridah'].includes(given);
        name = `${given} ${female ? 'binti' : 'bin'} ${rng.pick(MALAY_FATHER)}`;
      } else if (roll < 0.93) name = rng.pick(CHINESE);
      else {
        const given = rng.pick(INDIAN_GIVEN);
        name = `${given} ${['Devi', 'Kavitha'].includes(given) ? 'a/p' : 'a/l'} ${rng.pick(INDIAN_FATHER)}`;
      }
      const ageYears = nationality === 'NP' ? rng.int(22, 44) : rng.int(21, 59);
      const dob = addDays(today, -Math.round(ageYears * 365.25) - rng.int(0, 360));
      const role = g % 25 === 0 ? 'supervisor' : g % 40 === 1 ? 'patrol_officer' : 'guard';
      people.push({
        id: `pr-${p.code.toLowerCase()}-${String(g).padStart(4, '0')}`,
        companyId,
        branchId: branch.id,
        staffNo: `${p.code}${String(g).padStart(4, '0')}`,
        name,
        nationality,
        idMasked: nationality === 'MY' ? `${dob.slice(2, 4)}${dob.slice(5, 7)}${dob.slice(8, 10)}-**-***${rng.int(0, 9)}` : `PA****${rng.int(100, 999)}`,
        dob,
        phone: `01${rng.int(0, 9)}-${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
        role,
        status: 'active',
        hiredOn: addDays(today, -rng.int(30, 3000)),
        faceEnrolledOn: null,
      });
    }
    // One guard over the age limit and one suspended, so the checks have something to show.
    people[11].dob = addDays(today, -Math.round(61.4 * 365.25));
    people[17].status = 'suspended';
    // Faces are enrolled with written consent in the first days; about 1 in 20 is still waiting.
    for (const [i, x] of people.entries()) x.faceEnrolledOn = i % 20 === 7 ? null : addDays(x.hiredOn, 2);
    ds.people.push(...people);

    // Credentials
    const cred = (person: Person, type: CredentialType, issuedOn: IsoDate, expiresOn: IsoDate | null): Credential => ({
      id: `cr-${person.id}-${type.toLowerCase()}`,
      companyId,
      personId: person.id,
      type,
      number: `${type.slice(0, 3)}${rng.int(100000, 999999)}`,
      issuedOn,
      expiresOn,
    });
    const expiry = (lead: number) => {
      const r = rng.float();
      if (r < 0.03) return addDays(today, -rng.int(1, 45));
      if (r < 0.1) return addDays(today, rng.int(1, lead));
      return addDays(today, rng.int(lead + 1, lead + 700));
    };
    for (const person of people) {
      // New joiners often work on a pending KDN vetting submitted in eSIMS (allowed, Fauzan 24 Oct 2026).
      if (!rng.chance(0.05)) ds.credentials.push(cred(person, 'KDN_GUARD_CARD', addDays(today, -rng.int(100, 700)), expiry(60)));
      else if (rng.chance(0.8)) {
        const submitted = addDays(today, -rng.int(2, 30));
        ds.credentials.push({ ...cred(person, 'KDN_VETTING', submitted, null), number: `eSIMS-${rng.int(100000, 999999)}` });
        if (person.hiredOn > submitted) person.hiredOn = submitted;
      }
      // CSG may be done any time in the first year of work; long-serving guards mostly have it.
      const firstYear = person.hiredOn > addDays(today, -365);
      if (!rng.chance(firstYear ? 0.4 : 0.01)) {
        const done = addDays(person.hiredOn, rng.int(5, 300));
        ds.credentials.push(cred(person, 'CSG_TRAINING', done < today ? done : addDays(today, -1), null));
      }
      if (person.role === 'supervisor' && rng.chance(0.7)) ds.credentials.push(cred(person, 'TNG_TRAINING', addDays(today, -rng.int(60, 1500)), null));
      if (person.nationality === 'NP') {
        ds.credentials.push(cred(person, 'PLKS_PERMIT', addDays(today, -rng.int(30, 330)), expiry(90)));
        ds.credentials.push(cred(person, 'PASSPORT', addDays(today, -rng.int(300, 2000)), expiry(180)));
        ds.credentials.push(cred(person, 'FOMEMA', addDays(today, -rng.int(30, 330)), expiry(60)));
        ds.credentials.push(cred(person, 'FW_INSURANCE', addDays(today, -rng.int(30, 330)), expiry(60)));
      }
    }
    // Firearm permits for guards at armed sites are assigned after the roster below.

    // Roster: each slot gets a primary guard with a weekly rest day; relief guards cover rest days.
    const companyPosts = ds.posts.filter((x) => x.companyId === companyId);
    interface Slot {
      post: Post;
      start: string;
      end: string;
    }
    const slots: Slot[] = [];
    for (const post of companyPosts) {
      for (const [start, end] of STRUCTURES[post.shiftStructure]) {
        for (let k = 0; k < post.guardsPerShift; k++) slots.push({ post, start, end });
      }
    }
    const deployable = people.filter((x) => x.role !== 'supervisor');
    const primaries = deployable.slice(0, Math.min(slots.length, Math.floor(deployable.length * 0.84)));
    const relief = deployable.slice(primaries.length);
    const siteById = new Map(sites.map((s) => [s.id, s]));
    // Nepali guards work only at private-sector sites (rule FWM-PRIVATE-ONLY): swap them off government slots.
    const govSlot = (i: number) => siteById.get(slots[i].post.siteId)?.sector === 'government';
    for (let i = 0; i < primaries.length; i++) {
      if (!govSlot(i) || primaries[i].nationality === 'MY') continue;
      const j = primaries.findIndex((x, k) => x.nationality === 'MY' && !govSlot(k));
      if (j >= 0) [primaries[i], primaries[j]] = [primaries[j], primaries[i]];
    }

    const workedOn = new Map<string, Set<IsoDate>>();
    const markWorked = (pid: string, d: IsoDate) => {
      if (!workedOn.has(pid)) workedOn.set(pid, new Set());
      workedOn.get(pid)!.add(d);
    };
    let shiftSeq = 0;
    for (let off = -daysBack; off <= daysForward; off++) {
      const date = addDays(today, off);
      let reliefIdx = 0;
      slots.forEach((slot, idx) => {
        // Office-hours posts do not run on Sunday.
        if (slot.post.shiftStructure === 'E' && new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return;
        const primary = primaries[idx];
        let personId: string | null = null;
        const restDay = primary ? idx % 7 === (Date.parse(`${date}T00:00:00Z`) / 86_400_000) % 7 : true;
        if (primary && !restDay && (primary.nationality === 'MY' || !govSlot(idx))) personId = primary.id;
        else {
          for (let tries = 0; tries < relief.length; tries++) {
            const r = relief[(reliefIdx + tries) % relief.length];
            if (r.nationality !== 'MY' && govSlot(idx)) continue;
            if (!workedOn.get(r.id)?.has(date)) {
              personId = r.id;
              reliefIdx = (reliefIdx + tries + 1) % relief.length;
              break;
            }
          }
        }
        if (personId && rng.chance(0.015)) personId = null; // a few gaps nobody has filled yet
        if (personId) markWorked(personId, date);
        const start = myt(date, slot.start);
        const endDate = slot.end <= slot.start ? addDays(date, 1) : date;
        shiftSeq += 1;
        ds.shifts.push({
          id: `sh-${p.code.toLowerCase()}-${shiftSeq}`,
          companyId,
          siteId: slot.post.siteId,
          postId: slot.post.id,
          personId,
          date,
          start,
          end: myt(endDate, slot.end),
          status: off <= 3 ? 'published' : 'draft',
        });
      });
    }

    // Firearm permits for anyone rostered at an armed site (a couple missing on purpose).
    const armedPeople = new Set(ds.shifts.filter((s) => s.companyId === companyId && s.personId && siteById.get(s.siteId)?.armed).map((s) => s.personId!));
    let armedIdx = 0;
    for (const pid of armedPeople) {
      armedIdx += 1;
      if (armedIdx === 3) continue;
      const person = people.find((x) => x.id === pid)!;
      ds.credentials.push(cred(person, 'FIREARM_PERMIT', addDays(today, -rng.int(30, 300)), expiry(60)));
    }

    // Attendance for shifts that have started.
    const nowMs = toMs(now);
    const personById = new Map(people.map((x) => [x.id, x]));
    for (const s of ds.shifts) {
      if (s.companyId !== companyId || !s.personId) continue;
      const startMs = toMs(s.start);
      if (startMs > nowMs) continue;
      const site = siteById.get(s.siteId)!;
      const r = rng.float();
      if (r < 0.02) continue; // no-show: no record; dashboard derives it
      const lateMin = r < 0.07 ? rng.int(16, 55) : rng.int(-20, 8);
      const clockIn = fromMs(startMs + lateMin * 60_000);
      const outside = rng.chance(0.025);
      const lat = site.lat + (outside ? 0.01 : (rng.float() - 0.5) * 0.0008);
      const lng = site.lng + (outside ? 0.01 : (rng.float() - 0.5) * 0.0008);
      const offline = rng.chance(0.03);
      const photo = !rng.chance(0.03);
      const evalIn = evaluateClockIn({
        shift: s,
        site,
        at: clockIn,
        receivedAt: offline ? addMinutes(clockIn, rng.int(20, 180)) : addMinutes(clockIn, 0),
        lat,
        lng,
        // A few weak matches so the identity-check flag shows up in the test data.
        face: photo ? { score: rng.chance(0.015) ? 0.55 : 0.82 + rng.float() * 0.16, live: true } : null,
        faceEnrolled: !!personById.get(s.personId)?.faceEnrolledOn,
      });
      let clockOut: IsoDateTime | null = null;
      let flags = evalIn.flags;
      if (toMs(s.end) <= nowMs) {
        const early = rng.chance(0.02);
        clockOut = fromMs(toMs(s.end) + (early ? -rng.int(30, 120) : rng.int(0, 15)) * 60_000);
        flags = [...flags, ...evaluateClockOut(s, clockOut)];
      }
      ds.attendance.push({
        id: `at-${s.id}`,
        companyId,
        siteId: s.siteId,
        shiftId: s.id,
        personId: s.personId,
        deviceId: `DEV-${site.code}`,
        clockIn,
        clockOut,
        lat: +lat.toFixed(5),
        lng: +lng.toFixed(5),
        distanceM: evalIn.distanceM,
        photo,
        flags,
        locked: s.date < addDays(today, -1),
      });
    }

    // Patrol scans today on a sample of sites.
    for (const site of sites.slice(0, Math.ceil(sites.length / 2))) {
      const cps = ds.checkpoints.filter((c) => c.siteId === site.id);
      const onDuty = ds.shifts.find((s) => s.siteId === site.id && s.personId && toMs(s.start) <= nowMs && toMs(s.end) > nowMs);
      if (!onDuty) continue;
      for (let round = 0; round < 3; round++) {
        for (const cp of cps) {
          const at = fromMs(nowMs - (3 - round) * 3_600_000 + rng.int(0, 40) * 60_000);
          if (toMs(at) < toMs(onDuty.start)) continue;
          if (rng.chance(0.08)) continue; // missed checkpoint
          ds.scans.push({
            id: `sc-${cp.id}-${round}`,
            companyId,
            siteId: site.id,
            checkpointId: cp.id,
            personId: onDuty.personId!,
            at,
            method: 'NFC',
          });
        }
      }
    }
    // The other half of the sites, on their own random stream so the data above stays the same.
    // Every sixth site has stopped patrolling for the last two rounds, to show patrol gaps.
    const prng = new Rng(MASTER_SEED + 13 + PILOTS.indexOf(p));
    sites.slice(Math.ceil(sites.length / 2)).forEach((site, i) => {
      const cps = ds.checkpoints.filter((c) => c.siteId === site.id);
      const onDuty = ds.shifts.find((s) => s.siteId === site.id && s.personId && toMs(s.start) <= nowMs && toMs(s.end) > nowMs);
      if (!onDuty) return;
      for (let round = 0; round < (i % 6 === 2 ? 1 : 3); round++) {
        for (const cp of cps) {
          const at = fromMs(nowMs - (3 - round) * 3_600_000 + prng.int(0, 40) * 60_000);
          if (toMs(at) < toMs(onDuty.start)) continue;
          ds.scans.push({ id: `sc-${cp.id}-${round}`, companyId, siteId: site.id, checkpointId: cp.id, personId: onDuty.personId!, at, method: 'NFC' });
        }
      }
    });

    // Open and recent cases.
    const caseTemplates: { type: Case['type']; severity: Severity; title: string; description: string }[] = [
      {
        type: 'INCIDENT',
        severity: 'P2',
        title: 'Unknown person at loading bay',
        description: 'Guard reports a man without a pass trying the loading bay door at 02:40. Left when challenged. CCTV clip requested from client.',
      },
      {
        type: 'INCIDENT',
        severity: 'P3',
        title: 'Boom gate not closing',
        description: 'Main gate boom barrier stuck open since 06:00. Manual control in place. Client facilities informed.',
      },
      {
        type: 'COMPLAINT',
        severity: 'P3',
        title: 'Client complaint: guard on phone',
        description: 'JMB chairman reports guard using phone at lobby counter during visitor rush.',
      },
      {
        type: 'MISSED_CHECKIN',
        severity: 'P2',
        title: 'Missed patrol checkpoint round',
        description: 'Two checkpoints not scanned in the 03:00 round. Supervisor to confirm.',
      },
      {
        type: 'INCIDENT',
        severity: 'P1',
        title: 'Fire alarm triggered, level 3',
        description: 'Fire alarm panel shows zone 3. Guard on the way to check. BOMBA not yet called.',
      },
      {
        type: 'INCIDENT',
        severity: 'P4',
        title: 'Torchlight and raincoat replacement',
        description: 'Post equipment worn out. Request replacement from store.',
      },
      {
        type: 'COMPLIANCE',
        severity: 'P3',
        title: 'Guard deployed with expired KDN card',
        description: 'Roster check found a rostered guard with an expired guard card. Replace before next shift.',
      },
    ];
    const caseCount = Math.round(p.sites / 6);
    for (let k = 0; k < caseCount; k++) {
      const t = caseTemplates[k % caseTemplates.length];
      const site = rng.pick(sites);
      const opened = fromMs(nowMs - rng.int(10, 60 * 30) * 60_000);
      const status: Case['status'] = k % 4 === 0 ? 'resolved' : k % 3 === 0 ? 'acknowledged' : 'open';
      const ref = `${p.code}-C${String(caseSeq++).padStart(4, '0')}`;
      const events: Case['events'] = [{ at: opened, by: `Site device ${site.code}`, action: 'Raised' }];
      if (status !== 'open') events.push({ at: addMinutes(opened, rng.int(2, 25)), by: 'Supervisor', action: 'Acknowledged' });
      if (status === 'resolved')
        events.push({ at: addMinutes(opened, rng.int(30, 300)), by: 'Supervisor', action: 'Resolved', note: 'Handled on site. Report sent to client.' });
      ds.cases.push({
        id: `cs-${ref.toLowerCase()}`,
        ref,
        companyId,
        siteId: site.id,
        type: t.type,
        severity: t.severity,
        title: t.title,
        description: t.description,
        reportedBy: `Site device ${site.code}`,
        openedAt: opened,
        slaDueAt: slaDue(t.severity, opened),
        status,
        owner: status === 'open' ? null : 'Supervisor',
        events,
      });
    }
  }

  // ----- Tenders and quotations for the pilots (own generator, so the rest stays stable) -----
  const crng = new Rng(MASTER_SEED + 7);
  const ADMIN_EXEC: Record<string, { id: string; name: string }> = {
    SASA: { id: 'u-ae-sasa', name: 'Farah Nadia binti Kamal' },
    ARSH: { id: 'u-ae-arsh', name: 'Siti Hajar binti Rosli' },
    INAS: { id: 'u-ae-inas', name: 'Lim Mei Ling' },
  };
  const MANAGER: Record<string, { id: string; name: string }> = {
    SASA: { id: 'u-cm-sasa', name: 'Nor Azlina binti Hashim' },
    ARSH: { id: 'u-cm-arsh', name: 'Kenny Lau Chee Wah' },
    INAS: { id: 'u-cm-inas', name: 'Mohd Shukri bin Ahmad' },
  };
  const TENDERS: { channel: 'GOVERNMENT' | 'PRIVATE'; title: string; buyer: string; source: string; status: Tender['status']; closeIn: [number, number] }[] = [
    {
      channel: 'GOVERNMENT',
      title: 'Security services for district health clinics',
      buyer: 'State Health Department (mock)',
      source: 'MyProcurement',
      status: 'open',
      closeIn: [12, 30],
    },
    {
      channel: 'GOVERNMENT',
      title: 'Guarding for public secondary schools, 2027',
      buyer: 'District Education Office (mock)',
      source: 'ePerolehan',
      status: 'preparing',
      closeIn: [5, 14],
    },
    {
      channel: 'PRIVATE',
      title: 'Condominium guarding and patrol, 24 hours',
      buyer: 'Residensi Seri Melati JMB (mock)',
      source: 'Client invitation',
      status: 'preparing',
      closeIn: [7, 20],
    },
    {
      channel: 'PRIVATE',
      title: 'Warehouse and loading bay security',
      buyer: 'Logistik Pantas Sdn Bhd (mock)',
      source: 'Branch lead',
      status: 'submitted',
      closeIn: [-10, -2],
    },
    {
      channel: 'GOVERNMENT',
      title: 'Security for council offices and car parks',
      buyer: 'Municipal Council (mock)',
      source: 'MyProcurement',
      status: 'no_bid',
      closeIn: [-20, -12],
    },
    {
      channel: 'PRIVATE',
      title: 'Shopping centre security renewal',
      buyer: 'Plaza Damai Management (mock)',
      source: 'Existing client',
      status: 'won',
      closeIn: [-40, -25],
    },
  ];
  for (const p of PILOTS) {
    const companyId = `co-${p.code.toLowerCase()}`;
    const branchName = ds.branches.find((b) => b.companyId === companyId)!.name;
    const tenders: Tender[] = TENDERS.map((t, i) => {
      const guards = crng.int(4, 40);
      return {
        id: `td-${p.code.toLowerCase()}-${i + 1}`,
        companyId,
        ref: `${p.code}-T${String(i + 1).padStart(3, '0')}`,
        title: t.title,
        buyer: t.buyer,
        channel: t.channel,
        source: t.source,
        owner:
          t.channel === 'GOVERNMENT'
            ? 'Director Office Administrator'
            : t.source === 'Branch lead'
              ? `Branch Manager, ${branchName}`
              : 'COO / Private Sector team',
        closesOn: addDays(today, crng.int(t.closeIn[0], t.closeIn[1])),
        guards,
        sites: Math.max(1, Math.round(guards / crng.int(3, 8))),
        status: t.status,
        estMonthly: crng.chance(0.8) ? guards * crng.int(26, 36) * 100 : null,
      };
    });
    ds.tenders.push(...tenders);
    const ae = ADMIN_EXEC[p.code];
    const cm = MANAGER[p.code];
    const QUOTES: { client: string; site: string; tender: number | null; status: Quotation['status']; by: typeof ae; daysAgo: number; note: string }[] = [
      { client: 'Residensi Seri Melati JMB (mock)', site: 'Residensi Seri Melati', tender: 2, status: 'awaiting_approval', by: ae, daysAgo: 1, note: '' },
      { client: 'Klinik Pergigian Aman (mock)', site: 'Main clinic', tender: null, status: 'draft', by: ae, daysAgo: 0, note: '' },
      { client: 'Logistik Pantas Sdn Bhd (mock)', site: 'Warehouse 3', tender: 3, status: 'sent', by: ae, daysAgo: 12, note: '' },
      {
        client: 'Taman Industri Jaya Association (mock)',
        site: 'Industrial park gate',
        tender: null,
        status: 'returned',
        by: ae,
        daysAgo: 4,
        note: 'Night shift rate is below our cost. Recheck with the 12-hour pattern.',
      },
      { client: 'Plaza Damai Management (mock)', site: 'Plaza Damai', tender: 5, status: 'accepted', by: ae, daysAgo: 35, note: '' },
      { client: 'Sekolah Antarabangsa Cahaya (mock)', site: 'Campus', tender: null, status: 'awaiting_approval', by: cm, daysAgo: 2, note: '' },
    ];
    QUOTES.forEach((q, i) => {
      const guards = crng.int(2, 24);
      const hoursPerDay = crng.chance(0.8) ? 12 : 8;
      const ratePerGuard = (hoursPerDay === 12 ? crng.int(28, 38) : crng.int(21, 27)) * 100;
      const preparedAt = fromMs(toMs(myt(addDays(today, -q.daysAgo), '09:00')) + crng.int(0, 420) * 60_000);
      const approved = ['approved', 'sent', 'accepted', 'rejected'].includes(q.status);
      ds.quotations.push({
        id: `qt-${p.code.toLowerCase()}-${i + 1}`,
        companyId,
        ref: `${p.code}-Q${String(i + 1).padStart(4, '0')}`,
        client: q.client,
        siteName: q.site,
        tenderId: q.tender === null ? null : tenders[q.tender].id,
        guards,
        hoursPerDay,
        ratePerGuard,
        monthlyTotal: guards * ratePerGuard,
        validUntil: addDays(today, 30 - q.daysAgo),
        status: q.status,
        preparedBy: q.by.name,
        preparedById: q.by.id,
        preparedAt,
        approvedBy: approved ? cm.name : null,
        approvedAt: approved ? fromMs(toMs(preparedAt) + 26 * 3_600_000) : null,
        note: q.note,
      });
    });
  }

  // ----- Arms: one approved vault per pilot, firearms for the armed sites (V13, V14) -----
  const arng = new Rng(MASTER_SEED + 11);
  const nowMsArms = toMs(now);
  for (const [pi, p] of PILOTS.entries()) {
    const companyId = `co-${p.code.toLowerCase()}`;
    const armedSites = ds.sites.filter((s) => s.companyId === companyId && s.armed);
    if (armedSites.length === 0) continue;
    const vault: Vault = {
      id: `va-${p.code.toLowerCase()}-1`,
      companyId,
      name: `${p.code === 'SASA' ? 'Sasa' : p.code === 'ARSH' ? 'Arrow Shield' : 'Inas'} armoury 1`,
      state: p.states[0],
      approvalRef: `PDRM/SB/${arng.int(1000, 9999)}`,
      // Arrow Shield's storage approval is due soon and its alarm feed is not connected, so the checks show something.
      approvalExpiresOn: pi === 1 ? addDays(today, 45) : addDays(today, arng.int(200, 600)),
      custodian: ADMIN_EXEC[p.code].name,
      custodianRole: 'Amra, Admin Executive',
      aLicenceHolder: MANAGER[p.code].name,
      aLicenceRole: 'A licence holder, Company Manager',
      lastCountAt: myt(today, '07:05'),
      lastCountOk: true,
      alarmOnline: pi === 1 ? null : true,
    };
    ds.vaults.push(vault);
    const firearms: Firearm[] = [];
    const total = armedSites.length * 2 + 2;
    for (let k = 1; k <= total; k++) {
      firearms.push({
        id: `fa-${p.code.toLowerCase()}-${String(k).padStart(2, '0')}`,
        companyId,
        vaultId: vault.id,
        tag: `${p.code}-F${String(k).padStart(2, '0')}`,
        kind: k % 3 === 0 ? 'Revolver' : 'Shotgun',
        serialMasked: `****${arng.int(1000, 9999)}`,
        status: k === total ? 'MAINTENANCE' : 'IN_VAULT',
        licenceRef: `PDRM/FL/${arng.int(10000, 99999)}`,
        // Arms Act s.4: licences run to 30 June. One Inas licence has no record yet.
        licenceExpiresOn: pi === 2 && k === 2 ? null : '2027-06-30',
      });
    }
    ds.firearms.push(...firearms);
    const permitHolders = new Set(ds.credentials.filter((c) => c.companyId === companyId && c.type === 'FIREARM_PERMIT').map((c) => c.personId));
    const armedShifts = ds.shifts
      .filter((s) => s.companyId === companyId && s.personId && permitHolders.has(s.personId) && armedSites.some((x) => x.id === s.siteId))
      .filter((s) => toMs(s.start) <= nowMsArms && toMs(s.end) > nowMsArms - 24 * 3_600_000)
      .sort((a, b) => a.start.localeCompare(b.start));
    // Sasa keeps one firearm out past its due time so the overdue ladder shows.
    const leaveOut = pi === 0 ? [...armedShifts].reverse().find((s) => toMs(s.end) <= nowMsArms - 20 * 60_000) : undefined;
    let next = 0;
    for (const s of armedShifts) {
      const f = firearms.filter((x) => x.status === 'IN_VAULT' && x.licenceExpiresOn)[next % (firearms.length - 2)];
      next++;
      if (!f || f.status !== 'IN_VAULT') continue;
      const running = toMs(s.end) > nowMsArms;
      const out = running || s === leaveOut;
      const rounds = f.kind === 'Revolver' ? 6 : 5;
      const issuedAt = fromMs(toMs(s.start) - arng.int(5, 15) * 60_000);
      const returnedAt = out ? null : fromMs(toMs(s.end) + arng.int(5, 20) * 60_000);
      ds.armsMovements.push({
        id: `am-${f.id}-${toMs(issuedAt)}`,
        companyId,
        firearmId: f.id,
        vaultId: vault.id,
        personId: s.personId!,
        siteId: s.siteId,
        shiftId: s.id,
        rounds,
        issuedAt,
        issuedBy: vault.custodian,
        issueWitness: 'Duty supervisor (mock)',
        dueBack: s.end,
        returnedAt,
        returnedTo: returnedAt ? vault.custodian : null,
        returnWitness: returnedAt ? 'Duty supervisor (mock)' : null,
        roundsReturned: returnedAt ? rounds : null,
        caseRef: null,
      });
      if (out) f.status = 'ISSUED';
    }
  }

  // ----- Armed operations, firearm servicing, armed tenders, CMS roster (Fauzan, 25 Oct 2026) -----
  // Own random stream so everything generated above stays the same.
  const jrng = new Rng(MASTER_SEED + 17);
  for (const f of ds.firearms) {
    const k = Number(f.id.slice(-2));
    f.serviceDueOn = k % 5 === 0 ? addDays(today, -jrng.int(3, 12)) : k % 5 === 1 ? addDays(today, jrng.int(4, 25)) : addDays(today, jrng.int(60, 170));
  }
  const JOBS: Record<string, { kind: ArmedJob['kind']; client: string; detail: string; from: number; hours: number; crew: number; guns: number }[]> = {
    SASA: [
      { kind: 'CIT', client: 'Bank Mock Berhad', detail: 'Route KL-3: 6 branches, Cheras to Bukit Bintang', from: -3, hours: 5, crew: 2, guns: 2 },
      { kind: 'CIT', client: 'Bank Mock Berhad', detail: 'Route SEL-1: 5 branches, Shah Alam and Klang', from: -1, hours: 4, crew: 2, guns: 2 },
      { kind: 'CDM', client: 'Bank Mock Berhad', detail: '8 cash deposit machines, Petaling Jaya', from: -2, hours: 3, crew: 2, guns: 1 },
      { kind: 'CDM', client: 'Kedai Serbaneka (mock)', detail: '4 machines, Subang Jaya', from: 2, hours: 3, crew: 2, guns: 1 },
      { kind: 'CASH_VAULT', client: 'Bank Mock Berhad', detail: 'Cash centre, Shah Alam: counting and storage shift', from: -4, hours: 10, crew: 2, guns: 2 },
      { kind: 'BODYGUARD', client: 'Private client (mock)', detail: 'Close protection, KL city centre', from: -2, hours: 10, crew: 1, guns: 1 },
    ],
    ARSH: [
      { kind: 'CIT', client: 'Bank Utara (mock)', detail: 'Route PG-2: George Town and Butterworth', from: -2, hours: 4, crew: 2, guns: 2 },
      { kind: 'CDM', client: 'Bank Utara (mock)', detail: '6 machines, Bayan Lepas', from: 1, hours: 3, crew: 2, guns: 1 },
      { kind: 'BODYGUARD', client: 'Visiting executive (mock)', detail: 'Close protection, Penang airport to hotel', from: 3, hours: 6, crew: 1, guns: 1 },
    ],
    INAS: [
      { kind: 'BODYGUARD', client: 'Private client (mock)', detail: 'Close protection, Seremban', from: -5, hours: 4, crew: 1, guns: 1 },
      { kind: 'CDM', client: 'Bank Mock Berhad', detail: '3 machines, Melaka town', from: -1, hours: 3, crew: 2, guns: 1 },
      { kind: 'CASH_VAULT', client: 'Pajak Gadai Mock', detail: 'Pawnshop vault transfer, Melaka', from: 4, hours: 2, crew: 2, guns: 1 },
    ],
  };
  for (const p of PILOTS) {
    const companyId = `co-${p.code.toLowerCase()}`;
    const vault = ds.vaults.find((v) => v.companyId === companyId);
    const armedSite = ds.sites.find((s) => s.companyId === companyId && s.armed);
    if (!vault || !armedSite) continue;
    const holders = [...new Set(ds.credentials.filter((c) => c.companyId === companyId && c.type === 'FIREARM_PERMIT').map((c) => c.personId))];
    // Armed jobs draw on their own firearms in the same vault, so the site firearms stay as they are.
    const total = JOBS[p.code].reduce((n, j) => n + j.guns, 0) + 1;
    const pool: Firearm[] = Array.from({ length: total }, (_, k) => ({
      id: `fa-${p.code.toLowerCase()}-j${String(k + 1).padStart(2, '0')}`,
      companyId,
      vaultId: vault.id,
      tag: `${p.code}-J${String(k + 1).padStart(2, '0')}`,
      kind: k % 2 === 0 ? 'Pistol' : 'Revolver',
      serialMasked: `****${jrng.int(1000, 9999)}`,
      status: 'IN_VAULT',
      licenceRef: `PDRM/FL/${jrng.int(10000, 99999)}`,
      licenceExpiresOn: '2027-06-30',
      serviceDueOn: k === total - 1 ? addDays(today, -4) : addDays(today, jrng.int(40, 160)),
    }));
    ds.firearms.push(...pool);
    let h = 0;
    JOBS[p.code].forEach((j, i) => {
      const start = fromMs(Math.floor(nowMsArms / 1_800_000) * 1_800_000 + j.from * 3_600_000);
      const end = fromMs(toMs(start) + j.hours * 3_600_000);
      const running = toMs(start) <= nowMsArms && toMs(end) > nowMsArms;
      const done = toMs(end) <= nowMsArms;
      const crew = Array.from({ length: j.crew }, () => holders[h++ % Math.max(1, holders.length)]).filter(Boolean);
      const guns = done || running ? pool.splice(0, j.guns) : [];
      const delayed = p.code === 'SASA' && i === 1;
      const job: ArmedJob = {
        id: `aj-${p.code.toLowerCase()}-${i + 1}`,
        companyId,
        ref: `${p.code}-${j.kind}-${String(i + 1).padStart(3, '0')}`,
        kind: j.kind,
        client: j.client,
        detail: j.detail,
        start,
        end,
        crew,
        firearmIds: guns.map((g) => g.id),
        vehicle:
          j.kind === 'CIT' || j.kind === 'CDM'
            ? `Armoured van W${jrng.int(1000, 9999)}${String.fromCharCode(65 + jrng.int(0, 25))}`
            : j.kind === 'BODYGUARD'
              ? 'Client vehicle'
              : null,
        status: delayed ? 'delayed' : done ? 'completed' : running ? 'in_progress' : 'scheduled',
        lastUpdate: delayed
          ? 'Held 25 minutes at second branch; crew reports road closure'
          : done
            ? 'Completed, firearms returned'
            : running
              ? 'On route, last check-in on time'
              : 'Crew and firearms booked',
        lastUpdateAt: delayed
          ? fromMs(nowMsArms - 10 * 60_000)
          : done
            ? end
            : running
              ? fromMs(nowMsArms - jrng.int(5, 25) * 60_000)
              : fromMs(nowMsArms - 3_600_000),
      };
      ds.armedJobs.push(job);
      for (const [gi, g] of guns.entries()) {
        const issuedAt = fromMs(toMs(start) - 15 * 60_000);
        const rounds = g.kind === 'Revolver' ? 6 : 5;
        ds.armsMovements.push({
          id: `am-${g.id}-${toMs(issuedAt)}`,
          companyId,
          firearmId: g.id,
          vaultId: vault.id,
          personId: crew[gi % crew.length] ?? crew[0],
          siteId: armedSite.id,
          shiftId: null,
          rounds,
          issuedAt,
          issuedBy: vault.custodian,
          issueWitness: 'Armoury officer (mock)',
          dueBack: end,
          returnedAt: done ? fromMs(toMs(end) + 10 * 60_000) : null,
          returnedTo: done ? vault.custodian : null,
          returnWitness: done ? 'Armoury officer (mock)' : null,
          roundsReturned: done ? rounds : null,
          caseRef: null,
        });
        if (!done) g.status = 'ISSUED';
      }
    });
    const ARMED_TENDERS: Pick<Tender, 'title' | 'buyer' | 'channel' | 'source' | 'status'>[] =
      p.code === 'SASA'
        ? [
            {
              title: 'Cash-in-transit for 40 bank branches, Klang Valley',
              buyer: 'Bank Mock Berhad',
              channel: 'PRIVATE',
              source: 'Client invitation',
              status: 'preparing',
            },
            {
              title: 'Armed escort for state treasury cash movements',
              buyer: 'State Treasury (mock)',
              channel: 'GOVERNMENT',
              source: 'ePerolehan',
              status: 'open',
            },
          ]
        : p.code === 'ARSH'
          ? [
              {
                title: 'Cash deposit machine replenishment, northern region',
                buyer: 'Bank Utara (mock)',
                channel: 'PRIVATE',
                source: 'Branch lead',
                status: 'open',
              },
            ]
          : [{ title: 'Close protection for a visiting delegation', buyer: 'Embassy (mock)', channel: 'PRIVATE', source: 'Client invitation', status: 'open' }];
    ARMED_TENDERS.forEach((t, i) => {
      const guards = jrng.int(6, 30);
      ds.tenders.push({
        id: `td-${p.code.toLowerCase()}-a${i + 1}`,
        companyId,
        ref: `${p.code}-TA${String(i + 1).padStart(2, '0')}`,
        ...t,
        owner: t.channel === 'GOVERNMENT' ? 'Director Office Administrator' : 'COO / Private Sector team',
        closesOn: addDays(today, jrng.int(6, 25)),
        guards,
        sites: Math.max(1, Math.round(guards / 6)),
        estMonthly: guards * jrng.int(40, 55) * 100,
        armed: true,
      });
    });
  }
  // Tender protocol set by the Director Office Administrator (Fauzan, 25 Oct 2026). Placeholder steps until the real
  // protocol is loaded; tenders already being prepared have the first steps done.
  ds.tenderProtocols.push({
    id: 'tender',
    version: 1,
    steps: TENDER_GUIDE_V1,
    setBy: 'Nurul Huda binti Ismail',
    setAt: myt('2026-10-11', '17:00'),
    note: 'Panduan Kerja Tender V1.0, perbincangan 11 Oktober 2026 (sections 02 to 05).',
    placeholder: false,
  });
  for (const t of ds.tenders.filter((x) => x.status !== 'open' && x.status !== 'no_bid')) {
    const upTo = t.status === 'preparing' ? ['preparing'] : ['preparing', 'submitted'];
    const at = myt(addDays(today, -5), '10:00');
    t.decision = { choice: 'TERUSKAN', reason: '', by: 'Company Manager', at };
    t.protocolDone = TENDER_GUIDE_V1.filter((s) => upTo.includes(s.before) && !s.auto).map((s) =>
      s.id === 'g02_07'
        ? {
            stepId: s.id,
            version: 1,
            by: 'Admin Executive',
            at,
            note: 'Tiada taklimat atau lawatan wajib',
            proofIds: [],
            status: 'na' as const,
            ref: 'Notis tender',
            naConfirmedBy: 'Company Manager',
            naConfirmedAt: at,
          }
        : { stepId: s.id, version: 1, by: 'Admin Executive', at, note: 'Done before the protocol went into the app', proofIds: [], status: 'done' as const },
    );
  }
  // CMS command centre (Fauzan, 25 Oct 2026): every shift has 1 Head Control and 1 Monitor Officer.
  // Gaps to show: tonight's Monitor Officer seat is empty, the day after tomorrow's day shift has no Head Control,
  // and today's day-shift Monitor Officer has not clocked in.
  const cmrng = new Rng(MASTER_SEED + 29);
  const HEADS = ['Hafiz bin Rahman', 'Siti Aishah binti Omar', 'Daniel Wong', 'Priya a/p Raman'];
  const MONITORS = [
    'Amirul bin Zaki',
    'Nurul Huda binti Ali',
    'Kumar a/l Velu',
    'Tan Mei Ling',
    'Faizal bin Hassan',
    'Lee Chong Wei (mock)',
    'Rosmah binti Idris',
    'Arjun Thapa',
  ];
  [...HEADS, ...MONITORS].forEach((name, i) =>
    ds.cmsStaff.push({
      id: `cms-st-${String(i + 1).padStart(2, '0')}`,
      name,
      // Head Control staff can also sit as Monitor Officer; Monitor Officers cannot lead a shift.
      posts: i < HEADS.length ? ['HEAD_CONTROL', 'MONITOR_OFFICER'] : ['MONITOR_OFFICER'],
      ext: String(900 + i + 1),
      active: true,
    }),
  );
  ds.cmsSettings.push({
    id: 'cms',
    shiftPattern: '2x12',
    firstShiftStart: '07:00',
    headControlPerShift: 1,
    monitorOfficersPerShift: 1,
    clockInGraceMin: 15,
    handoverWithinMin: 30,
    vaultWatchCheckMin: 60,
    forwardAfterSec: 20,
    answerTargetSec: 15,
    callbackWithinMin: 15,
    alarmAckSec: 60,
    updatedAt: null,
    updatedBy: null,
  });
  let n = 0;
  for (let d = -1; d <= 6; d++) {
    const date = addDays(today, d);
    for (const [start, end] of [
      ['07:00', '19:00'],
      ['19:00', '07:00'],
    ] as const) {
      const s = myt(date, start);
      const e = end === '07:00' ? myt(addDays(date, 1), end) : myt(date, end);
      const started = toMs(s) <= nowMsArms;
      for (const post of ['HEAD_CONTROL', 'MONITOR_OFFICER'] as const) {
        const unfilled = (d === 0 && start === '19:00' && post === 'MONITOR_OFFICER') || (d === 2 && start === '07:00' && post === 'HEAD_CONTROL');
        const name = unfilled ? null : post === 'HEAD_CONTROL' ? HEADS[n % HEADS.length] : MONITORS[n % MONITORS.length];
        const noShow = d === 0 && start === '07:00' && post === 'MONITOR_OFFICER';
        ds.cmsShifts.push({
          id: `cms-${date}-${start.replace(':', '')}-12h-${post === 'HEAD_CONTROL' ? 'hc' : 'mo'}-1`,
          date,
          start: s,
          end: e,
          post,
          seat: 1,
          staffName: name,
          clockIn: name && started && !noShow ? fromMs(toMs(s) - cmrng.int(2, 12) * 60_000) : null,
          handoverAt: post === 'HEAD_CONTROL' && name && started ? fromMs(toMs(s) + cmrng.int(5, 20) * 60_000) : null,
          handoverNote: post === 'HEAD_CONTROL' && name && started ? 'Open items handed over: arms out on post, vault watch check-ins, missed calls' : null,
        });
      }
      n++;
    }
  }

  // Company IP phones. CMS is the group's phone focal point: a call not answered at the extension forwards to CMS.
  // Arrow Shield's reception rings 45 seconds before forwarding and its Penang branch does not forward at all;
  // Inas's operations room phone is offline and its Melaka branch phone has not been read from the phone system.
  const EXTENSIONS: [string, string, string, Partial<PhoneExtension>][] = [
    ['co-sasa', '201', 'Sasa HQ reception', {}],
    ['co-sasa', '202', 'Sasa operations room', {}],
    ['co-sasa', '209', 'Sasa armoury (Amra)', {}],
    ['co-sasa', '231', 'Sasa Johor Bahru branch', {}],
    ['co-arsh', '301', 'Arrow Shield HQ reception', { forwardAfterSec: 45 }],
    ['co-arsh', '302', 'Arrow Shield operations room', {}],
    ['co-arsh', '331', 'Arrow Shield Penang branch', { forwardToCms: false }],
    ['co-inas', '401', 'Inas HQ reception', {}],
    ['co-inas', '402', 'Inas operations room', { status: 'offline', lastSeenAt: fromMs(nowMsArms - 3 * 3_600_000) }],
    ['co-inas', '431', 'Inas Melaka branch', { status: 'unknown', forwardAfterSec: null, lastSeenAt: null }],
  ];
  for (const [companyId, ext, label, over] of EXTENSIONS) {
    ds.phoneExtensions.push({
      id: `ext-${companyId}-${ext}`,
      companyId,
      ext,
      label,
      forwardToCms: true,
      forwardAfterSec: 20,
      status: 'online',
      lastSeenAt: fromMs(nowMsArms - cmrng.int(1, 4) * 60_000),
      ...over,
    });
  }
  const onCms = (atMs: number) => ds.cmsShifts.filter((x) => x.staffName && x.clockIn && toMs(x.start) <= atMs && atMs < toMs(x.end)).map((x) => x.staffName!);
  const caller = () => `01${cmrng.int(0, 9)}-xxx ${cmrng.int(1000, 9999)}`;
  let callNo = 0;
  for (const x of ds.phoneExtensions) {
    if (x.status === 'unknown') continue;
    const until = x.status === 'offline' ? toMs(x.lastSeenAt!) : nowMsArms;
    for (let t = toMs(myt(today, '07:30')) + cmrng.int(0, 40) * 60_000; t < until - 10 * 60_000; t += cmrng.int(35, 110) * 60_000) {
      const fwd = x.forwardToCms ? (x.forwardAfterSec ?? 20) : null;
      const roll = cmrng.float();
      const outcome: PhoneCall['outcome'] = fwd === null || roll < 0.7 ? 'answered' : roll < 0.93 ? 'forwarded_answered' : 'forwarded_missed';
      const staff = onCms(t);
      const answered = outcome === 'answered' || (outcome === 'forwarded_answered' && staff.length > 0);
      ds.phoneCalls.push({
        id: `call-${String(++callNo).padStart(4, '0')}`,
        companyId: x.companyId,
        extensionId: x.id,
        caller: caller(),
        at: fromMs(t),
        outcome: answered ? outcome : 'forwarded_missed',
        answeredBy: outcome === 'answered' ? null : answered ? cmrng.pick(staff) : null,
        answerSec: outcome === 'answered' ? cmrng.int(3, 18) : answered ? fwd! + cmrng.int(3, 26) : null,
        callbackAt: answered ? null : fromMs(t + cmrng.int(4, 12) * 60_000),
        callbackBy: answered || !staff.length ? null : cmrng.pick(staff),
        note: answered ? null : 'Called back; message passed to the company duty officer',
      });
    }
  }
  // Two forwarded calls nobody answered and not yet called back: Sasa's 50 minutes ago (late), Inas's 6 minutes ago.
  for (const [extId, ago] of [
    ['ext-co-sasa-202', 50],
    ['ext-co-inas-401', 6],
  ] as const) {
    const x = ds.phoneExtensions.find((e) => e.id === extId)!;
    ds.phoneCalls.push({
      id: `call-${String(++callNo).padStart(4, '0')}`,
      companyId: x.companyId,
      extensionId: x.id,
      caller: caller(),
      at: fromMs(nowMsArms - ago * 60_000),
      outcome: 'forwarded_missed',
      answeredBy: null,
      answerSec: null,
      callbackAt: null,
      callbackBy: null,
      note: null,
    });
  }

  // Site CCTV recorders and alarm panels linked to CMS. Video stays at the site; CMS reads health and events.
  // About a third of sites are not linked yet (shown as not linked, never as fine). A few recorders are offline or
  // online but not recording. Alarms today: a Sasa guard SOS 3 minutes ago not acknowledged, an Inas camera
  // tampered 9 minutes ago, an Arrow Shield intrusion found to be a false alarm, and earlier events closed.
  const srng = new Rng(MASTER_SEED + 31);
  for (const site of ds.sites) {
    const linked = srng.chance(site.risk === 'high' ? 0.9 : 0.6);
    const cameras = site.risk === 'high' ? srng.int(16, 32) : srng.int(4, 12);
    const roll = srng.float();
    const status: SiteSystem['status'] = !linked ? 'unknown' : roll < 0.06 ? 'offline' : roll < 0.1 ? 'not_recording' : 'online';
    ds.siteSystems.push({
      id: `sys-${site.id}-cctv`,
      companyId: site.companyId,
      siteId: site.id,
      kind: 'CCTV',
      name: `${srng.pick(['Hikvision', 'Dahua', 'Uniview', 'Axis'])} recorder (mock)`,
      linked,
      status,
      cameras,
      camerasOnline:
        status === 'online' ? cameras - (srng.chance(0.2) ? srng.int(1, 2) : 0) : status === 'not_recording' ? cameras : status === 'offline' ? 0 : null,
      lastHeartbeatAt: !linked ? null : status === 'offline' ? fromMs(nowMsArms - srng.int(40, 300) * 60_000) : fromMs(nowMsArms - srng.int(1, 4) * 60_000),
    });
    if (site.risk !== 'low' && srng.chance(0.6))
      ds.siteSystems.push({
        id: `sys-${site.id}-alarm`,
        companyId: site.companyId,
        siteId: site.id,
        kind: 'ALARM_PANEL',
        name: `${srng.pick(['Bosch', 'Paradox', 'DSC'])} alarm panel (mock)`,
        linked: true,
        status: 'online',
        cameras: null,
        camerasOnline: null,
        lastHeartbeatAt: fromMs(nowMsArms - srng.int(1, 5) * 60_000),
      });
  }
  const linkedSite = (companyId: string, k: number) =>
    ds.siteSystems.filter((x) => x.companyId === companyId && x.kind === 'CCTV' && x.status === 'online')[k].siteId;
  const ALARMS: [string, number, SiteAlarm['kind'], string, number, Partial<SiteAlarm>][] = [
    ['co-sasa', 0, 'GUARD_SOS', 'Guard duty phone SOS button', 3, {}],
    ['co-inas', 0, 'CAMERA_TAMPER', 'Recorder: camera 3 view blocked', 9, {}],
    [
      'co-arsh',
      1,
      'INTRUSION',
      'Alarm panel zone 4, rear fence',
      25,
      { status: 'closed', verdict: 'false', note: 'Checked on camera and by the guard: monkeys on the fence' },
    ],
    ['co-sasa', 2, 'PANIC', 'Lobby panic button', 140, { status: 'closed', verdict: 'false', note: 'Pressed by a cleaner by mistake; guard confirmed' }],
    [
      'co-inas',
      1,
      'INTRUSION',
      'Alarm panel zone 1, store room',
      200,
      { status: 'acknowledged', note: 'Guard sent to check; waiting for the guard to report' },
    ],
  ];
  ALARMS.forEach(([companyId, k, kind, source, ago, over], i) => {
    const at = nowMsArms - ago * 60_000;
    const acked = over.status && over.status !== 'new';
    ds.siteAlarms.push({
      id: `alm-${String(i + 1).padStart(3, '0')}`,
      companyId,
      siteId: linkedSite(companyId, k),
      kind,
      source,
      at: fromMs(at),
      status: 'new',
      ackAt: acked ? fromMs(at + srng.int(20, 50) * 1000) : null,
      ackBy: acked ? 'Daniel Wong' : null,
      verdict: null,
      caseId: null,
      note: null,
      ...over,
    });
  });
  // An offline recorder raises its own loss-of-link alarm.
  for (const x of ds.siteSystems.filter((y) => y.status === 'offline').slice(0, 2)) {
    ds.siteAlarms.push({
      id: `alm-link-${x.siteId}`,
      companyId: x.companyId,
      siteId: x.siteId,
      kind: 'LINK_LOST',
      source: x.name,
      at: x.lastHeartbeatAt!,
      status: 'acknowledged',
      ackAt: fromMs(toMs(x.lastHeartbeatAt!) + 45_000),
      ackBy: 'Daniel Wong',
      verdict: null,
      caseId: null,
      note: 'Site guard asked to check the recorder power and network',
    });
  }

  // Attendance follow-ups (Shahirah, 25 Oct 2026): yesterday's absences at Sasa, one warned, one excused.
  {
    const attShift = new Set(ds.attendance.map((a) => a.shiftId));
    const yAbsent = ds.shifts.filter((x) => x.companyId === 'co-sasa' && x.date === addDays(today, -1) && x.personId && !attShift.has(x.id)).slice(0, 2);
    const fu = (
      x: (typeof ds.shifts)[number],
      kind: 'STAFF_ALERTED' | 'DISCIPLINE' | 'EXCUSED',
      minutes: number,
      note: string,
      by: string,
      extra: Partial<Dataset['attendanceFollowUps'][number]> = {},
    ) =>
      ds.attendanceFollowUps.push({
        id: `fu-${x.id}-no_show-${ds.attendanceFollowUps.length + 1}`,
        companyId: x.companyId,
        siteId: x.siteId,
        postId: x.postId,
        shiftId: x.id,
        attendanceId: null,
        personId: x.personId,
        date: x.date,
        issue: 'NO_SHOW',
        kind,
        at: fromMs(toMs(x.start) + minutes * 60_000),
        by,
        byDesk: by === 'Daniel Wong' ? 'cms' : 'company',
        note,
        replacementShiftId: null,
        replacementPersonId: null,
        discipline: null,
        ...extra,
      });
    if (yAbsent[0]) {
      fu(yAbsent[0], 'STAFF_ALERTED', 22, 'Called twice, no answer; told the supervisor', 'Daniel Wong');
      fu(yAbsent[0], 'DISCIPLINE', 8 * 60, 'Absent without notice, second time this month. Guard said phone was off.', 'Nor Azlina binti Hashim', {
        discipline: 'WRITTEN_WARNING',
      });
      fu(yAbsent[0], 'EXCUSED', 8 * 60 + 5, 'Post covered by the next shift holding over; absence recorded, warning given', 'Nor Azlina binti Hashim');
    }
    // One Arrow Shield guard absent three working days in a row with no word: Employment Act s.15(2) for HR to check.
    const win = [-3, -2, -1].map((d) => addDays(today, d));
    const gone = ds.people.filter((p) => p.companyId === 'co-arsh').find((p) => win.every((d) => ds.shifts.some((x) => x.personId === p.id && x.date === d)));
    if (gone) {
      const ids = new Set(ds.shifts.filter((x) => x.personId === gone.id && win.includes(x.date)).map((x) => x.id));
      ds.attendance = ds.attendance.filter((x) => !x.shiftId || !ids.has(x.shiftId));
    }
    if (yAbsent[1]) fu(yAbsent[1], 'EXCUSED', 40, 'Medical certificate from Klinik Kesihatan, received by WhatsApp', 'Ganesan a/l Perumal');
  }

  // Vault day and night watch, checked from CMS control. Inas's current watch has missed its check-ins.
  const WATCHERS = [
    'Ahmad Fauzi bin Yusof',
    'Rabindra Rai',
    'Mohd Hafiz bin Salleh',
    'Dil Kumar Gurung',
    'Saravanan a/l Muthu',
    'Khairul Anuar bin Said',
    'Bishnu Tamang',
    'Zainal bin Abidin',
    'Ravi a/l Chandran',
    'Hari Bahadur Thapa',
    'Shahrul bin Nizam',
    'Gopal a/l Krishnan',
  ];
  let wi = 0;
  for (const [vi, v] of ds.vaults.entries()) {
    wi = vi * 4; // each vault has its own watch team
    for (let d = -1; d <= 1; d++) {
      const date = addDays(today, d);
      for (const shift of ['day', 'night'] as const) {
        const start = myt(date, shift === 'day' ? '07:00' : '19:00');
        const end = shift === 'day' ? myt(date, '19:00') : myt(addDays(date, 1), '07:00');
        const running = toMs(start) <= nowMsArms && toMs(end) > nowMsArms;
        const past = toMs(end) <= nowMsArms;
        const lagging = running && v.companyId === 'co-inas';
        ds.vaultWatches.push({
          id: `vw-${v.id}-${date}-${shift}`,
          companyId: v.companyId,
          vaultId: v.id,
          date,
          shift,
          start,
          end,
          watcher: WATCHERS[wi++ % WATCHERS.length],
          clockIn: running || past ? fromMs(toMs(start) - jrng.int(3, 15) * 60_000) : null,
          lastCheckAt: past
            ? fromMs(toMs(end) - jrng.int(5, 40) * 60_000)
            : running
              ? fromMs(Math.max(toMs(start), nowMsArms - (lagging ? 95 : jrng.int(5, 40)) * 60_000))
              : null,
        });
      }
    }
  }

  // Arms suppliers (mock). One has no licence copy on file and one licence is close to expiry.
  ds.armsSuppliers.push(
    {
      id: 'sup-1',
      name: 'Senjata Jaya Sdn Bhd (mock)',
      supplies: ['Firearms', 'Ammunition'],
      licenceRef: 'PDRM/DL/2231',
      licenceExpiresOn: '2027-06-30',
      contact: 'Encik Rahim, 03-5500 1234',
      lastOrderOn: addDays(today, -40),
    },
    {
      id: 'sup-2',
      name: 'Armourer Services KL (mock)',
      supplies: ['Servicing'],
      licenceRef: 'PDRM/AS/0912',
      licenceExpiresOn: addDays(today, 21),
      contact: 'Mr Lim, 03-9200 5678',
      lastOrderOn: addDays(today, -9),
    },
    {
      id: 'sup-3',
      name: 'Peluru Utama Trading (mock)',
      supplies: ['Ammunition'],
      licenceRef: null,
      licenceExpiresOn: null,
      contact: 'Puan Aida, 04-6100 2222',
      lastOrderOn: addDays(today, -95),
    },
    {
      id: 'sup-4',
      name: 'Vault and Safe Systems (mock)',
      supplies: ['Equipment'],
      licenceRef: 'SIRIM-VS-118',
      licenceExpiresOn: addDays(today, 300),
      contact: 'Mr Raj, 03-7800 9090',
      lastOrderOn: addDays(today, -150),
    },
  );

  const ITEMS: Omit<SupplierItem, 'id'>[] = [
    {
      supplierId: 'sup-1',
      category: 'Firearm',
      name: 'Pump-action shotgun, 12 gauge',
      spec: '12 ga, 18.5 in barrel, 5+1 capacity, parkerised finish',
      unit: 'each',
      unitPrice: 3850,
      priceValidUntil: addDays(today, 70),
      leadTimeDays: 90,
      minOrder: 5,
    },
    {
      supplierId: 'sup-1',
      category: 'Firearm',
      name: 'Revolver, .38 Special',
      spec: '.38 Special, 4 in barrel, 6 rounds, stainless',
      unit: 'each',
      unitPrice: 4600,
      priceValidUntil: addDays(today, 70),
      leadTimeDays: 120,
      minOrder: 2,
    },
    {
      supplierId: 'sup-1',
      category: 'Ammunition',
      name: '12 gauge buckshot',
      spec: '00 buck, 9 pellets, 2.75 in shell',
      unit: 'box of 25',
      unitPrice: 165,
      priceValidUntil: addDays(today, -5),
      leadTimeDays: 30,
      minOrder: 20,
    },
    {
      supplierId: 'sup-3',
      category: 'Ammunition',
      name: '.38 Special round nose',
      spec: '158 gr lead round nose',
      unit: 'box of 50',
      unitPrice: 210,
      priceValidUntil: addDays(today, 40),
      leadTimeDays: 45,
      minOrder: 10,
    },
    {
      supplierId: 'sup-2',
      category: 'Servicing',
      name: 'Annual armourer service, shotgun',
      spec: 'Strip, clean, inspect, function test, report',
      unit: 'per firearm',
      unitPrice: 180,
      priceValidUntil: addDays(today, 200),
      leadTimeDays: 7,
      minOrder: null,
    },
    {
      supplierId: 'sup-2',
      category: 'Servicing',
      name: 'Annual armourer service, revolver',
      spec: 'Strip, clean, timing check, function test, report',
      unit: 'per firearm',
      unitPrice: 150,
      priceValidUntil: addDays(today, 200),
      leadTimeDays: 7,
      minOrder: null,
    },
    {
      supplierId: 'sup-4',
      category: 'Equipment',
      name: 'Gun safe, 10 long guns',
      spec: 'Steel, 2-hour fire rating, dual lock, bolt-down',
      unit: 'each',
      unitPrice: 9800,
      priceValidUntil: addDays(today, 120),
      leadTimeDays: 21,
      minOrder: 1,
    },
    {
      supplierId: 'sup-4',
      category: 'Equipment',
      name: 'Vault door alarm sensor kit',
      spec: 'Door contact, vibration sensor, CMS feed ready',
      unit: 'set',
      unitPrice: 1450,
      priceValidUntil: null,
      leadTimeDays: 14,
      minOrder: 1,
    },
  ];
  ITEMS.forEach((it, i) => ds.supplierItems.push({ id: `item-${i + 1}`, ...it }));
  // The three dealer companies: licences to be applied for. Two supply tenders wait on them.
  for (const n of [4, 5, 6]) {
    ds.dealerLicences.push({
      id: `dl-co-0${n}`,
      companyId: `co-0${n}`,
      status: 'planned',
      reference: null,
      appliedOn: null,
      expiresOn: null,
      note: "Chosen by Fauzan, 25 Oct 2026. Trade stock to be kept in the company's own vault.",
    });
  }
  ds.tenders.push(
    {
      id: 'td-c04-s1',
      companyId: 'co-04',
      ref: 'C04-TS01',
      title: 'Supply of shotgun ammunition to a state agency, 2027',
      buyer: 'State Agency (mock)',
      channel: 'GOVERNMENT',
      source: 'ePerolehan',
      owner: 'Arms Control',
      closesOn: addDays(today, 18),
      guards: 0,
      sites: 0,
      status: 'open',
      estMonthly: null,
      armed: true,
      kind: 'ARMS_SUPPLY',
    },
    {
      id: 'td-c06-s1',
      companyId: 'co-06',
      ref: 'C06-TS01',
      title: 'Supply and service of 20 firearms for a plantation group',
      buyer: 'Ladang Hijau Berhad (mock)',
      channel: 'PRIVATE',
      source: 'Client invitation',
      owner: 'Arms Control',
      closesOn: addDays(today, 26),
      guards: 0,
      sites: 0,
      status: 'preparing',
      estMonthly: null,
      armed: true,
      kind: 'ARMS_SUPPLY',
    },
  );

  // ----- Arms Control items from the V14 reread (25 Oct 2026) -----
  // Own random stream so everything generated above stays the same.
  const krng = new Rng(MASTER_SEED + 19);
  const MIN = 60_000;
  // Vault CCTV as CMS sees it: Arrow Shield's camera is live but the recorder cannot prove it is recording; Inas has no feed connected.
  for (const v of ds.vaults) {
    v.cctvOnline = v.companyId === 'co-inas' ? null : true;
    v.recordingOk = v.companyId === 'co-arsh' ? false : v.companyId === 'co-inas' ? null : true;
  }
  // Door events from each vault's access system: one per issue, return and count, plus exceptions.
  const since24 = nowMsArms - 24 * 3_600_000;
  for (const v of ds.vaults) {
    const times: number[] = [];
    for (const m of ds.armsMovements.filter((x) => x.vaultId === v.id)) {
      for (const at of [m.issuedAt, m.returnedAt]) if (at && toMs(at) >= since24 && toMs(at) <= nowMsArms) times.push(toMs(at) - krng.int(1, 3) * MIN);
    }
    if (v.lastCountAt && toMs(v.lastCountAt) <= nowMsArms) times.push(toMs(v.lastCountAt) - 2 * MIN);
    // Opening times close together are one door event.
    times.sort((a, b) => a - b);
    let last = -Infinity;
    for (const t of times) {
      if (t - last < 5 * MIN) continue;
      last = t;
      ds.vaultEvents.push({ id: `ve-${v.id}-${t}`, companyId: v.companyId, vaultId: v.id, at: fromMs(t), kind: 'DOOR_OPEN', by: v.custodian });
    }
    const busy = (t: number) => times.some((x) => Math.abs(x - t) < 40 * MIN);
    const free = (from: number) => {
      for (let t = from; t > since24; t -= 20 * MIN) if (!busy(t)) return t;
      return null;
    };
    // Sasa: the door was opened in the night with no issue, return or count recorded.
    if (v.companyId === 'co-sasa') {
      const t = free(Math.floor((nowMsArms - 4 * 3_600_000) / MIN) * MIN);
      if (t) ds.vaultEvents.push({ id: `ve-${v.id}-${t}-x`, companyId: v.companyId, vaultId: v.id, at: fromMs(t), kind: 'DOOR_OPEN', by: null });
    }
    // Arrow Shield: a card was refused at the vault door.
    if (v.companyId === 'co-arsh') {
      const t = free(Math.floor((nowMsArms - 2 * 3_600_000) / MIN) * MIN);
      if (t)
        ds.vaultEvents.push({
          id: `ve-${v.id}-${t}-d`,
          companyId: v.companyId,
          vaultId: v.id,
          at: fromMs(t),
          kind: 'ACCESS_DENIED',
          by: 'Card 0417 (not on the vault list)',
        });
    }
  }
  ds.vaultEvents.sort((a, b) => a.at.localeCompare(b.at));

  // Ammunition by calibre in each vault. Inas's last count is 2 rounds short; at Arrow Shield one person counted and checked.
  const CALIBRE: Record<Firearm['kind'], string> = { Shotgun: '12 gauge', Revolver: '.38 Special', Pistol: '9 mm' };
  for (const v of ds.vaults) {
    const kinds = [...new Set(ds.firearms.filter((f) => f.vaultId === v.id).map((f) => f.kind))];
    kinds.forEach((k, i) => {
      const ledger = krng.int(8, 30) * 25;
      const short = v.companyId === 'co-inas' && k === 'Revolver';
      const same = v.companyId === 'co-arsh' && i === 0;
      ds.ammoStocks.push({
        id: `ammo-${v.id}-${k.toLowerCase()}`,
        companyId: v.companyId,
        vaultId: v.id,
        calibre: CALIBRE[k],
        ledger,
        counted: short ? ledger - 2 : ledger,
        countedAt: v.lastCountAt,
        countedBy: v.custodian,
        checkedBy: same ? v.custodian : 'Duty supervisor (mock)',
      });
    });
  }
  // Each firearm's calibre, so rounds issued and returned move its vault's ledger (Special Ops slice 4B).
  for (const f of ds.firearms) f.calibre = CALIBRE[f.kind];
  // One Arrow Shield return came back a round short and nobody opened a case.
  const returned = ds.armsMovements.filter((m) => m.returnedAt && toMs(m.returnedAt) <= nowMsArms).sort((a, b) => b.returnedAt!.localeCompare(a.returnedAt!));
  const shortReturn = returned.find((m) => m.companyId === 'co-arsh') ?? returned[0];
  if (shortReturn) shortReturn.roundsReturned = shortReturn.rounds - 1;

  // Range practice for every guard with a firearm permit, due every 6 months (proposed rule ARMS-RANGE).
  for (const c of ds.credentials.filter((x) => x.type === 'FIREARM_PERMIT')) {
    if (ds.credentials.some((x) => x.personId === c.personId && x.type === 'RANGE_PRACTICE')) continue;
    const done = addDays(today, -krng.int(15, 205));
    ds.credentials.push({
      id: `cr-${c.personId}-range_practice`,
      companyId: c.companyId,
      personId: c.personId,
      type: 'RANGE_PRACTICE',
      number: `RANGE-${krng.int(1000, 9999)}`,
      issuedOn: done,
      expiresOn: addDays(done, 182),
    });
  }

  // Client arms agreements and armed-service insurance. One Sasa armed site working today has none; Inas has one unsigned.
  for (const p of PILOTS) {
    const companyId = `co-${p.code.toLowerCase()}`;
    const armed = ds.sites.filter((s) => s.companyId === companyId && s.armed);
    const soon = (sh: Shift) => sh.personId && toMs(sh.end) > nowMsArms && toMs(sh.start) < nowMsArms + 24 * 3_600_000;
    const workingToday = armed.find((s) => ds.shifts.some((sh) => sh.siteId === s.id && soon(sh))) ?? armed[0];
    armed.forEach((s, i) => {
      if (p.code === 'SASA' && s === workingToday) return;
      const signed = addDays(today, -krng.int(60, 600));
      ds.armsAgreements.push({
        id: `aa-${s.id}`,
        companyId,
        siteId: s.id,
        client: s.client,
        armedPosts: ds.posts.filter((x) => x.siteId === s.id).length,
        signedOn: p.code === 'INAS' && i === 0 ? null : signed,
        endsOn: addDays(signed, 730),
        insurer: 'Takaful Am (mock)',
        policyRef: `ARM-${krng.int(10000, 99999)}`,
        insuranceExpiresOn: p.code === 'ARSH' && i === 0 ? addDays(today, 20) : addDays(today, krng.int(90, 330)),
      });
    });
    const clients = new Map<string, ArmedJob>();
    for (const j of ds.armedJobs.filter((x) => x.companyId === companyId)) clients.set(`${j.client}|${j.kind}`, j);
    [...clients.values()].forEach((j, i) => {
      const signed = addDays(today, -krng.int(30, 400));
      ds.armsAgreements.push({
        id: `aa-${companyId}-job-${i + 1}`,
        companyId,
        siteId: null,
        jobKind: j.kind,
        client: j.client,
        armedPosts: j.crew.length,
        signedOn: signed,
        endsOn: addDays(signed, 730),
        insurer: 'Takaful Am (mock)',
        policyRef: `CIT-${krng.int(10000, 99999)}`,
        insuranceExpiresOn: addDays(today, krng.int(40, 300)),
      });
    });
  }

  // Police fundamentals. An Inas firearm went unaccounted for at a count 11 days ago (s.7 report clock running);
  // an Arrow Shield firearm's licence was revoked 3 days ago and it has not been deposited (s.27).
  const busyIds = new Set(ds.armsMovements.filter((m) => !m.returnedAt).map((m) => m.firearmId));
  const idle = (companyId: string) =>
    ds.firearms.find((f) => f.companyId === companyId && f.status === 'IN_VAULT' && !busyIds.has(f.id) && f.ownership !== 'TRADE' && f.licenceExpiresOn);
  const inasMissing = idle('co-inas');
  if (inasMissing) Object.assign(inasMissing, { status: 'UNVERIFIED', missingSince: myt(addDays(today, -11), '07:05') });
  const arshRevoked = idle('co-arsh');
  if (arshRevoked) arshRevoked.licenceExpiresOn = addDays(today, -3);

  // Arms requests on the ten-step path (V14 s.223).
  const hoursAgo = (h: number) => fromMs(nowMsArms - h * 3_600_000);
  const REQUESTS: Omit<ArmsRequest, 'id' | 'ref'>[] = [
    {
      companyId: 'co-sasa',
      kind: 'MOVE',
      title: 'Move 2 shotguns to the Shah Alam cash centre post for the new contract',
      state: 'arms_review',
      openedAt: hoursAgo(20),
      updatedAt: hoursAgo(6),
      raisedBy: MANAGER.SASA.name,
      dueBy: null,
      note: 'Client agreement signed; movement needs the A licence holder and a witness.',
      needsLegal: false,
    },
    {
      companyId: 'co-arsh',
      kind: 'SERVICE',
      title: 'Send overdue firearms to the armourer',
      state: 'company_auth',
      openedAt: hoursAgo(50),
      updatedAt: hoursAgo(26),
      raisedBy: ADMIN_EXEC.ARSH.name,
      dueBy: null,
      note: 'Arms Control passed; waiting for the company manager.',
      needsLegal: false,
    },
    {
      companyId: 'co-arsh',
      kind: 'TRANSFER',
      title: 'Lend 1 shotgun from Arrow Shield to Inas for a Melaka event',
      state: 'arms_review',
      openedAt: hoursAgo(9),
      updatedAt: hoursAgo(9),
      raisedBy: MANAGER.ARSH.name,
      dueBy: null,
      note: 'Firearms are not pooled between companies: a transfer needs legal review and PDRM authority.',
      needsLegal: true,
    },
    {
      companyId: 'co-inas',
      kind: 'LOSS_REPORT',
      title: 'Firearm not verified at the last count: decide whether a police loss report is needed',
      state: 'legal_check',
      openedAt: hoursAgo(30),
      updatedAt: hoursAgo(4),
      raisedBy: 'Arms Control',
      dueBy: addDays(today, 3),
      note: 'Arms Act s.7(1): report at the nearest police station within 14 days of becoming aware. Went missing at the count 11 days ago.',
      needsLegal: true,
    },
    {
      companyId: 'co-sasa',
      kind: 'DISPOSE',
      title: 'Dispose of 2 unserviceable revolvers',
      state: 'regulator_pending',
      openedAt: hoursAgo(400),
      updatedAt: hoursAgo(120),
      raisedBy: MANAGER.SASA.name,
      dueBy: null,
      note: 'Waiting for PDRM approval; firearms stay in the vault register until then.',
      needsLegal: true,
    },
    {
      companyId: 'co-04',
      kind: 'ACQUIRE',
      title: 'Buy 40 boxes of 12 gauge buckshot as trade stock',
      state: 'draft',
      openedAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
      raisedBy: 'Arms Control',
      dueBy: null,
      note: 'Cannot move past company authority until the dealer licence is approved.',
      needsLegal: true,
    },
  ];
  REQUESTS.forEach((r, i) => ds.armsRequests.push({ id: `ar-${i + 1}`, ref: `AR-${String(i + 1).padStart(4, '0')}`, ...r }));

  // Police notice for every armed job, and approval when it leaves the home state (Fauzan, 25 Oct 2026).
  // Sasa's close protection goes into Kuala Lumpur from Selangor with no police approval.
  const JOB_STATES: Record<string, string[]> = {
    'SASA-BODYGUARD-006': ['Selangor', 'Kuala Lumpur'],
    'SASA-CIT-001': ['Selangor', 'Kuala Lumpur'],
    'INAS-CASH_VAULT-003': ['Kuala Lumpur', 'Melaka'],
    'INAS-CDM-002': ['Kuala Lumpur', 'Melaka'],
  };
  for (const j of ds.armedJobs) {
    const home = ds.vaults.find((v) => v.companyId === j.companyId)?.state ?? '';
    j.states = JOB_STATES[j.ref] ?? [home];
    j.policeApproval = ['SASA-CIT-001', 'INAS-CASH_VAULT-003', 'INAS-CDM-002'].includes(j.ref)
      ? { ref: `PDRM/KL/MOV/${krng.int(100, 999)}`, on: dateOf(fromMs(toMs(j.start) - 48 * 3_600_000)) }
      : null;
  }
  for (const r of ds.armsRequests) {
    if (r.kind === 'MOVE') Object.assign(r, { fromState: 'Selangor', toState: 'Selangor', policeNotice: null, policeApproval: null });
    if (r.kind === 'TRANSFER') Object.assign(r, { fromState: 'Pulau Pinang', toState: 'Melaka', policeNotice: null, policeApproval: null });
  }

  // Other approved storage (Fauzan, 25 Oct 2026): a police station, or an arms safe (peti besi) at the client's premises. Each needs police approval.
  const sasaArmed = ds.sites.find((x) => x.companyId === 'co-sasa' && x.armed && ds.armsAgreements.some((a) => a.siteId === x.id));
  const EXTRA: { vault: Vault; guns: Firearm['kind'][] }[] = [
    {
      vault: {
        id: 'va-inas-p1',
        companyId: 'co-inas',
        name: 'Balai Polis Melaka Tengah (mock)',
        kind: 'POLICE_STATION',
        siteId: null,
        state: 'Melaka',
        approvalRef: `PDRM/MLK/SP/${krng.int(100, 999)}`,
        approvalExpiresOn: addDays(today, 240),
        custodian: ADMIN_EXEC.INAS.name,
        custodianRole: 'Amra, Admin Executive (signs firearms in and out at the station)',
        aLicenceHolder: MANAGER.INAS.name,
        aLicenceRole: 'A licence holder, Company Manager',
        lastCountAt: myt(today, '07:30'),
        lastCountOk: true,
        alarmOnline: null,
        cctvOnline: null,
        recordingOk: null,
      },
      guns: ['Shotgun', 'Shotgun'],
    },
    ...(sasaArmed
      ? [
          {
            vault: {
              id: 'va-sasa-c1',
              companyId: 'co-sasa',
              name: `Client safe, ${sasaArmed.name}`,
              kind: 'CLIENT_SAFE' as const,
              siteId: sasaArmed.id,
              state: 'Selangor',
              approvalRef: `PDRM/SEL/PB/${krng.int(100, 999)}`,
              approvalExpiresOn: addDays(today, 25),
              custodian: 'Ganesan a/l Perumal',
              custodianRole: 'Supervisor, Sasa (company staff authorised for this safe)',
              authorisedUsers: ['Ganesan a/l Perumal', MANAGER.SASA.name],
              aLicenceHolder: MANAGER.SASA.name,
              aLicenceRole: 'A licence holder, Company Manager',
              lastCountAt: myt(today, '07:10'),
              lastCountOk: true,
              alarmOnline: true,
              cctvOnline: null,
              recordingOk: null,
            },
            guns: ['Shotgun', 'Revolver'] as Firearm['kind'][],
          },
        ]
      : []),
  ];
  for (const x of EXTRA) {
    ds.vaults.push(x.vault);
    x.guns.forEach((kind, k) =>
      ds.firearms.push({
        id: `${x.vault.id.replace('va-', 'fa-')}-${k + 1}`,
        companyId: x.vault.companyId,
        vaultId: x.vault.id,
        tag: `${x.vault.id.slice(3).toUpperCase()}-${k + 1}`,
        kind,
        serialMasked: `****${krng.int(1000, 9999)}`,
        status: 'IN_VAULT',
        licenceRef: `PDRM/FL/${krng.int(10000, 99999)}`,
        licenceExpiresOn: '2027-06-30',
        serviceDueOn: addDays(today, krng.int(40, 160)),
      }),
    );
  }

  // Armed set-up per site or contract: police notified once, site vault approved, then live (Fauzan, 25 Oct 2026).
  // Arrow Shield's Bank Utara CDM contract was never notified. Sasa's client-site safe is approved.
  for (const a of ds.armsAgreements) {
    const missing = a.companyId === 'co-arsh' && a.jobKind === 'CDM';
    const safe = ds.vaults.find((v) => v.kind === 'CLIENT_SAFE' && v.siteId && v.siteId === a.siteId);
    a.setup = {
      policeNotice: missing ? null : { ref: `PDRM/NTF/${krng.int(10000, 99999)}`, on: a.signedOn ?? addDays(today, -30) },
      siteVaultId: safe?.id ?? null,
      siteVaultPlanned: !!safe,
      approval: safe ? { ref: safe.approvalRef, on: addDays(today, -340) } : null,
    };
  }
  // A new armed site being set up: KLIA Sepang. Police notified; the small site vault is not installed yet.
  ds.armsAgreements.push({
    id: 'aa-sasa-sepang',
    companyId: 'co-sasa',
    siteId: null,
    siteName: 'KLIA cargo zone, Sepang (mock, setting up)',
    client: 'Airport Cargo Mock Sdn Bhd',
    armedPosts: 4,
    signedOn: addDays(today, -6),
    endsOn: addDays(today, 724),
    insurer: 'Takaful Am (mock)',
    policyRef: `ARM-${krng.int(10000, 99999)}`,
    insuranceExpiresOn: addDays(today, 359),
    setup: { policeNotice: { ref: `PDRM/SPG/NTF/${krng.int(100, 999)}`, on: addDays(today, -4) }, siteVaultId: null, siteVaultPlanned: true, approval: null },
  });
  // Register book checked against the online register this morning, except Arrow Shield's armoury (30 hours ago).
  for (const v of ds.vaults) {
    if (v.kind === 'POLICE_STATION') continue;
    v.registerCheckedAt =
      v.companyId === 'co-arsh' && (v.kind ?? 'COMPANY_ARMOURY') === 'COMPANY_ARMOURY'
        ? fromMs(nowMsArms - 30 * 3_600_000)
        : fromMs(Math.min(nowMsArms, toMs(myt(today, '07:20'))));
  }

  // ----- Insurance (Chief of Staff insurance section, Fauzan 25 Oct 2026) -----
  // Pilots only; the other companies show Unknown. Exceptions: Sasa's personal accident cover expires in 40 days with
  // renewal not started, a motor premium due in 9 days and a client damage claim not yet reported; Arrow Shield has no
  // fidelity cover, an overdue liability premium, a motor claim open 4 months and a tender bond not released; Inas's
  // motor cover lapsed 5 days ago and a performance guarantee lapsed while its contract runs.
  const irng = new Rng(MASTER_SEED + 23);
  const INSURERS = ['Takaful Am (mock)', 'Jaminan Am Insurance (mock)', 'Perlindungan Bersatu (mock)'];
  const BROKER = 'Broker Insurans Mock Sdn Bhd';
  for (const p of PILOTS) {
    const companyId = `co-${p.code.toLowerCase()}`;
    const staff = ds.people.filter((x) => x.companyId === companyId && x.status !== 'left');
    const nepali = staff.filter((x) => x.nationality === 'NP').length;
    const kinds: { kind: InsuranceKind; sum: number; premium: number }[] = [
      { kind: 'PUBLIC_LIABILITY', sum: 5_000_000, premium: irng.int(9, 24) * 1000 },
      { kind: 'GROUP_PERSONAL_ACCIDENT', sum: 100_000, premium: staff.length * irng.int(35, 55) },
      { kind: 'GROUP_HOSPITALISATION', sum: 20_000, premium: staff.length * irng.int(180, 260) },
      { kind: 'FIDELITY_GUARANTEE', sum: 500_000, premium: irng.int(5, 14) * 1000 },
      { kind: 'MOTOR_FLEET', sum: 800_000, premium: irng.int(18, 40) * 1000 },
      { kind: 'FIRE_OFFICE', sum: 1_500_000, premium: irng.int(2, 6) * 1000 },
    ];
    if (nepali) kinds.push({ kind: 'FW_HOSPITALISATION', sum: 20_000, premium: nepali * 120 });
    if (ds.firearms.some((f) => f.companyId === companyId)) kinds.push({ kind: 'ARMED_SERVICE', sum: 3_000_000, premium: irng.int(12, 30) * 1000 });
    if (ds.armedJobs.some((j) => j.companyId === companyId && j.kind !== 'BODYGUARD'))
      kinds.push({ kind: 'CASH_IN_TRANSIT', sum: 2_000_000, premium: irng.int(25, 60) * 1000 });
    for (const k of kinds) {
      if (p.code === 'ARSH' && k.kind === 'FIDELITY_GUARANTEE') continue;
      let expiresOn = addDays(today, irng.int(90, 330));
      let renewal: InsurancePolicy['renewal'] = 'not_started';
      let premiumPaidOn: IsoDate | null = addDays(expiresOn, -365 + irng.int(3, 20));
      let premiumDueOn = addDays(expiresOn, -365 + 30);
      if (p.code === 'SASA' && k.kind === 'GROUP_PERSONAL_ACCIDENT') expiresOn = addDays(today, 40);
      if (p.code === 'INAS' && k.kind === 'MOTOR_FLEET') expiresOn = addDays(today, -5);
      if (p.code === 'INAS' && k.kind === 'FW_HOSPITALISATION') [expiresOn, renewal] = [addDays(today, 25), 'quotes'];
      if (p.code === 'SASA' && k.kind === 'MOTOR_FLEET') [premiumDueOn, premiumPaidOn] = [addDays(today, 9), null];
      if (p.code === 'ARSH' && k.kind === 'PUBLIC_LIABILITY') [premiumDueOn, premiumPaidOn] = [addDays(today, -12), null];
      if (p.code === 'SASA' && k.kind === 'GROUP_PERSONAL_ACCIDENT') premiumPaidOn = addDays(today, -300);
      ds.insurancePolicies.push({
        id: `ins-${companyId}-${k.kind.toLowerCase()}`,
        companyId,
        kind: k.kind,
        insurer: irng.pick(INSURERS),
        broker: irng.chance(0.7) ? BROKER : null,
        policyNo: `${k.kind
          .split('_')
          .map((w) => w[0])
          .join('')}-${irng.int(100000, 999999)}`,
        sumInsured: k.sum,
        premium: k.premium,
        startsOn: addDays(expiresOn, -365),
        expiresOn,
        premiumDueOn,
        premiumPaidOn: premiumPaidOn && premiumPaidOn > today ? today : premiumPaidOn,
        renewal,
      });
    }
  }
  const pol = (companyId: string, kind: InsuranceKind) => `ins-${companyId}-${kind.toLowerCase()}`;
  ds.insuranceClaims.push(
    {
      id: 'cl-sasa-1',
      companyId: 'co-sasa',
      policyId: pol('co-sasa', 'GROUP_PERSONAL_ACCIDENT'),
      ref: 'CLM-SASA-0412',
      what: 'Guard hurt his wrist stopping a trespasser',
      incidentOn: addDays(today, -10),
      notifiedOn: addDays(today, -8),
      amountClaimed: 4_800,
      status: 'documents',
      settledAmount: null,
      settledOn: null,
    },
    {
      id: 'cl-sasa-2',
      companyId: 'co-sasa',
      policyId: pol('co-sasa', 'PUBLIC_LIABILITY'),
      ref: 'CLM-SASA-0415',
      what: 'Client boom gate damaged by guard on duty',
      incidentOn: addDays(today, -40),
      notifiedOn: null,
      amountClaimed: 12_500,
      status: 'to_notify',
      settledAmount: null,
      settledOn: null,
    },
    {
      id: 'cl-sasa-3',
      companyId: 'co-sasa',
      policyId: pol('co-sasa', 'GROUP_HOSPITALISATION'),
      ref: 'CLM-SASA-0388',
      what: 'Supervisor admitted for dengue',
      incidentOn: addDays(today, -95),
      notifiedOn: addDays(today, -93),
      amountClaimed: 6_200,
      status: 'settled',
      settledAmount: 6_200,
      settledOn: addDays(today, -60),
    },
    {
      id: 'cl-arsh-1',
      companyId: 'co-arsh',
      policyId: pol('co-arsh', 'MOTOR_FLEET'),
      ref: 'CLM-ARSH-0217',
      what: 'Patrol car hit at a junction',
      incidentOn: addDays(today, -124),
      notifiedOn: addDays(today, -121),
      amountClaimed: 18_900,
      status: 'assessing',
      settledAmount: null,
      settledOn: null,
    },
    {
      id: 'cl-inas-1',
      companyId: 'co-inas',
      policyId: pol('co-inas', 'CASH_IN_TRANSIT'),
      ref: 'CLM-INAS-0091',
      what: 'Cash bag short after a CDM run',
      incidentOn: addDays(today, -22),
      notifiedOn: addDays(today, -21),
      amountClaimed: 7_000,
      status: 'assessing',
      settledAmount: null,
      settledOn: null,
    },
  );
  ds.insuranceGuarantees.push(
    {
      id: 'gt-sasa-1',
      companyId: 'co-sasa',
      kind: 'INSURANCE_GUARANTEE',
      issuer: 'Jaminan Am Insurance (mock)',
      beneficiary: 'Hospital Kerajaan Mock',
      contractRef: 'Guarding contract HKM/2025/07',
      amount: 250_000,
      fee: 3_750,
      issuedOn: addDays(today, -320),
      expiresOn: addDays(today, 45),
      contractEndsOn: addDays(today, 410),
      releasedOn: null,
    },
    {
      id: 'gt-sasa-2',
      companyId: 'co-sasa',
      kind: 'BANK_GUARANTEE',
      issuer: 'Bank Mock Berhad',
      beneficiary: 'Mall Mock Sdn Bhd',
      contractRef: 'Guarding contract MM-2026-02',
      amount: 80_000,
      fee: 1_200,
      issuedOn: addDays(today, -200),
      expiresOn: addDays(today, 530),
      contractEndsOn: addDays(today, 500),
      releasedOn: null,
    },
    {
      id: 'gt-arsh-1',
      companyId: 'co-arsh',
      kind: 'TENDER_BOND',
      issuer: 'Takaful Am (mock)',
      beneficiary: 'Majlis Bandaraya Mock',
      contractRef: 'Tender MBM/KESELAMATAN/2026/03 (not awarded)',
      amount: 20_000,
      fee: 400,
      issuedOn: addDays(today, -150),
      expiresOn: addDays(today, 30),
      contractEndsOn: addDays(today, -30),
      releasedOn: null,
    },
    {
      id: 'gt-inas-1',
      companyId: 'co-inas',
      kind: 'PERFORMANCE_BOND',
      issuer: 'Perlindungan Bersatu (mock)',
      beneficiary: 'Universiti Mock Melaka',
      contractRef: 'Guarding contract UMM/2025/11',
      amount: 120_000,
      fee: 1_800,
      issuedOn: addDays(today, -368),
      expiresOn: addDays(today, -3),
      contractEndsOn: addDays(today, 360),
      releasedOn: null,
    },
    {
      id: 'gt-inas-2',
      companyId: 'co-inas',
      kind: 'BANK_GUARANTEE',
      issuer: 'Bank Utara (mock)',
      beneficiary: 'Kilang Mock Ayer Keroh',
      contractRef: 'Guarding contract KMA-2024',
      amount: 45_000,
      fee: 675,
      issuedOn: addDays(today, -800),
      expiresOn: addDays(today, -60),
      contractEndsOn: addDays(today, -70),
      releasedOn: addDays(today, -55),
    },
  );

  // ----- Users and grants -----
  const allCompanyIds = ds.companies.map((c) => c.id);
  const pilotIds = PILOTS.map((p) => `co-${p.code.toLowerCase()}`);
  const sasaSites = ds.sites.filter((s) => s.companyId === 'co-sasa');
  const users: User[] = [
    { id: 'u-fauzan', name: 'Fauzan', title: 'Chief Executive Officer (sees everything)', role: 'director', opsTier: 'ceo', companyIds: [], siteIds: [] },
    {
      id: 'u-pwvsb-ops',
      name: 'PWVSB Operations',
      title: 'PWVSB group monitoring',
      role: 'pwvsb_officer',
      department: 'operations',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-rom-central',
      name: 'Rajesh a/l Subramaniam',
      title: 'Regional Operations Manager, Central (all companies in the region)',
      role: 'pwvsb_officer',
      department: 'operations',
      regionIds: ['central'],
      opsTier: 'regional',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-rom-north',
      name: 'Lim Wei Keong',
      title: 'Regional Operations Manager, Northern (all companies in the region)',
      role: 'pwvsb_officer',
      department: 'operations',
      regionIds: ['northern'],
      opsTier: 'regional',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-rom-south',
      name: 'Suresh a/l Muniandy',
      title: 'Regional Operations Manager, Southern (all companies in the region)',
      role: 'pwvsb_officer',
      department: 'operations',
      regionIds: ['southern'],
      opsTier: 'regional',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-om-klang',
      name: 'Azman bin Osman',
      title: 'Operations Manager, Selangor and Kuala Lumpur (all companies in the area)',
      role: 'pwvsb_officer',
      department: 'operations',
      regionIds: ['central'],
      areaStates: ['Selangor', 'Kuala Lumpur'],
      opsTier: 'om',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-om-johor',
      name: 'Tan Boon Huat',
      title: 'Operations Manager, Johor and Melaka (all companies in the area)',
      role: 'pwvsb_officer',
      department: 'operations',
      regionIds: ['southern'],
      areaStates: ['Johor', 'Melaka'],
      opsTier: 'om',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-ogm',
      name: 'Kamarul Ariffin bin Yahya',
      title: 'Operations General Manager, government sector sites (every company)',
      role: 'pwvsb_officer',
      department: 'operations',
      opsTier: 'ogm',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-opsdir',
      name: 'Leong Kah Meng',
      title: 'Operations Director, private sector sites (every company)',
      role: 'pwvsb_officer',
      department: 'operations',
      opsTier: 'ops_director',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-coo',
      name: 'Ahmad Faisal bin Zainal',
      title: 'Chief Operating Officer (every company)',
      role: 'pwvsb_officer',
      department: 'operations',
      opsTier: 'coo',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-cms-head',
      name: 'Hafiz bin Rahman',
      title: 'CMS Head Control, command centre (every company)',
      role: 'pwvsb_officer',
      department: 'cms',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-cos',
      name: 'Aisyah binti Rahman',
      title: 'Chief of Staff and HR Director, Director Office (insurance section, every company)',
      role: 'pwvsb_officer',
      department: 'chief_of_staff',
      leadership: 'cos',
      companyIds: [],
      siteIds: [],
    },
    // Transport department head (Fauzan, 26 Oct 2026): every company vehicle. Mock name.
    {
      id: 'u-transport',
      name: 'Zulkifli bin Yusof',
      title: 'Head of Transport (every company vehicle)',
      role: 'pwvsb_officer',
      department: 'transport',
      companyIds: [],
      siteIds: [],
    },
    // PDPA officer (Fauzan, 26 Oct 2026): every personal data matter, monitored by the Operations Director. Mock name.
    {
      id: 'u-pdpa',
      name: 'Siti Mariam binti Osman',
      title: 'PDPA Officer (every company), monitored by the Operations Director',
      role: 'pwvsb_officer',
      department: 'pdpa',
      companyIds: [],
      siteIds: [],
    },
    // Asset Management department (Fauzan, 26 Oct 2026): runs the group's rental units, assets, resorts and orchards.
    // Mock names. Watched by the Chairman and Vice Chairman, overseen by the CEO, finances by the Finance Director.
    {
      id: 'u-asset-dir',
      name: 'Datuk Kamarul Ariffin',
      title: 'Asset Director, Asset Management',
      role: 'pwvsb_officer',
      department: 'asset',
      assetRole: 'director',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-asset-mm',
      name: 'Rosli bin Daud',
      title: 'Maintenance Manager, Asset Management',
      role: 'pwvsb_officer',
      department: 'asset',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-asset-re1',
      name: 'Nadia binti Rahim',
      title: 'Rental Executive, Asset Management',
      role: 'pwvsb_officer',
      department: 'asset',
      companyIds: [],
      siteIds: [],
    },
    // Finance staff who oversee Asset Management's money for the Finance Director (Fauzan, 26 Oct 2026). Mock name.
    {
      id: 'u-finance-am',
      name: 'Grace Wong Mei Ling',
      title: 'Finance Executive (oversees Asset Management)',
      role: 'pwvsb_officer',
      department: 'finance',
      companyIds: [],
      siteIds: [],
    },
    // Finance (Fauzan, 27 Oct 2026): the Finance Director with 7 teams; team 1 pays staff salaries through the bank. Mock name.
    {
      id: 'u-fin-t1-lead',
      name: 'Finance Team Leader 1',
      title: 'Finance Team Leader, Team 1 (payroll and bank)',
      role: 'pwvsb_officer',
      department: 'finance',
      financeTeam: 1,
      financeRole: 'leader',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fin-t1-dep',
      name: 'Finance Deputy 1',
      title: 'Finance Deputy, Team 1',
      role: 'pwvsb_officer',
      department: 'finance',
      financeTeam: 1,
      financeRole: 'deputy',
      companyIds: [],
      siteIds: [],
    },
    ...[1, 2].map(
      (k): User => ({
        id: `u-fin-t1-de${k}`,
        name: `Finance Data Entry 1.${k}`,
        title: 'Finance Data Entry Executive, Team 1',
        role: 'pwvsb_officer',
        department: 'finance',
        financeTeam: 1,
        financeRole: 'data_entry',
        companyIds: [],
        siteIds: [],
      }),
    ),
    ...[2, 3, 4, 5, 6, 7].map(
      (t): User => ({
        id: `u-fin-t${t}-lead`,
        name: `Finance Team Leader ${t}`,
        title: `Finance Team Leader, Team ${t}`,
        role: 'pwvsb_officer',
        department: 'finance',
        financeTeam: t,
        financeRole: 'leader',
        companyIds: [],
        siteIds: [],
      }),
    ),
    // IT (Fauzan, 27 Oct 2026): 1 IT Manager, 1 IT Lead, 4 IT Executives, group staff. Mock names.
    {
      id: 'u-it-mgr',
      name: 'IT Manager (mock)',
      title: 'IT Manager, Merdeka Network (every company)',
      role: 'pwvsb_officer',
      department: 'it',
      itRole: 'manager',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-it-lead',
      name: 'IT Lead (mock)',
      title: 'IT Lead, Merdeka Network',
      role: 'pwvsb_officer',
      department: 'it',
      itRole: 'lead',
      companyIds: [],
      siteIds: [],
    },
    ...[1, 2, 3, 4].map(
      (k): User => ({
        id: `u-it-ex${k}`,
        name: `IT Executive ${k} (mock)`,
        title: 'IT Executive, Merdeka Network',
        role: 'pwvsb_officer',
        department: 'it',
        itRole: 'executive',
        companyIds: [],
        siteIds: [],
      }),
    ),
    // PWVSB credit (V8, V10): a credit officer in Finance and PWVSB's in-house legal counsel. Mock names.
    {
      id: 'u-credit',
      name: 'Credit Officer (mock)',
      title: 'Credit Officer, PWVSB financing to the companies',
      role: 'pwvsb_officer',
      department: 'finance',
      creditOfficer: true,
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-legal',
      name: 'Legal Counsel (mock)',
      title: 'Legal Counsel, PWVSB',
      role: 'pwvsb_officer',
      department: 'legal',
      companyIds: [],
      siteIds: [],
    },
    // Internal audit (V15): checks the proof behind each obligation and handles speak-up reports. Mock names.
    // ACT, Audit, Compliance and Transformation (Fauzan, 2 Nov 2026): 1 Director and 2 teams, each with 1 Auditor and
    // 1 Enforcement officer. The Director keeps the record u-audit (actRole 'lead') used by the Arisha leadership pilot.
    {
      id: 'u-audit',
      name: 'ACT Director (mock)',
      title: 'Director, Audit, Compliance and Transformation (ACT), PWVSB',
      role: 'pwvsb_officer',
      department: 'audit',
      actRole: 'lead',
      companyIds: [],
      siteIds: [],
    },
    ...([1, 2] as const).flatMap((team) => [
      {
        id: `u-act-aud${team}`,
        name: `ACT Auditor, Team ${team} (mock)`,
        title: `Auditor, ACT Team ${team}, PWVSB`,
        role: 'pwvsb_officer' as const,
        department: 'audit' as const,
        actRole: 'auditor' as const,
        actTeam: team,
        companyIds: [],
        siteIds: [],
      },
      {
        id: `u-act-enf${team}`,
        name: `ACT Enforcement Officer, Team ${team} (mock)`,
        title: `Enforcement Officer, ACT Team ${team}, PWVSB`,
        role: 'pwvsb_officer' as const,
        department: 'audit' as const,
        actRole: 'enforcement' as const,
        actTeam: team,
        companyIds: [],
        siteIds: [],
      },
    ]),
    // Procurement and Inventory (Fauzan, 27 Oct 2026): under the OGM, monitored by the COO and CEO. Mock names.
    {
      id: 'u-proc-exec',
      name: 'Procurement Executive (mock)',
      title: 'Procurement and Inventory Executive, PWVSB',
      role: 'pwvsb_officer',
      department: 'procurement',
      procRole: 'executive',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-proc-store1',
      name: 'Storekeeper 1 (mock)',
      title: 'Storekeeper, Procurement and Inventory, PWVSB',
      role: 'pwvsb_officer',
      department: 'procurement',
      procRole: 'storekeeper',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-proc-store2',
      name: 'Storekeeper 2 (mock)',
      title: 'Storekeeper, Procurement and Inventory, PWVSB',
      role: 'pwvsb_officer',
      department: 'procurement',
      procRole: 'storekeeper',
      companyIds: [],
      siteIds: [],
    },
    // The CCTV and sensor analytics feed (Fauzan, 6 Nov 2026): a system sign-in, never a person; mock until connected.
    {
      id: 'u-analytics-feed',
      name: 'CCTV and sensor analytics feed',
      title: 'System: sends AI detections from site CCTV and sensors (mock until connected)',
      role: 'pwvsb_officer',
      integration: 'analytics',
      companyIds: [],
      siteIds: [],
    },
    // The company's in-house server (Fauzan, 6 Nov 2026): collects the sealed full visitor details police may ask for.
    {
      id: 'u-inhouse-server',
      name: 'In-house records server',
      title: 'System: collects sealed gate details for the 2 to 7 year police record (mock until the server exists)',
      role: 'pwvsb_officer',
      integration: 'inhouse',
      companyIds: [],
      siteIds: [],
    },
    // The office door system's feed through CMS (Fauzan, 27 Oct 2026): a system sign-in, never a person.
    {
      id: 'u-door-sync',
      name: 'Office door feed',
      title: 'System: sends office door readings for the staff clock',
      role: 'pwvsb_officer',
      integration: 'door',
      companyIds: [],
      siteIds: [],
    },
    // Special Ops feeds (slices 4E, 4F, 4G, 2 Nov 2026): system sign-ins, never people and never on the sign-in screen.
    {
      id: 'u-cms-link',
      name: 'CMS Command Centre app link',
      title: 'System: sends CMS events and closed alarms, reads the CMS directory',
      role: 'pwvsb_officer',
      integration: 'cms',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-tracker-feed',
      name: 'Vehicle tracker feed',
      title: 'System: sends vehicle tracker positions',
      role: 'pwvsb_officer',
      integration: 'tracker',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-am-feed',
      name: 'Asset Management system feed',
      title: "System: sends the developer system's units, rents and reported payments",
      role: 'pwvsb_officer',
      integration: 'am',
      companyIds: [],
      siteIds: [],
    },
    // WhatsApp rent reminders (Fauzan, 2 Nov 2026): the sender and the WhatsApp webhook act as this system sign-in.
    {
      id: 'u-whatsapp-link',
      name: 'WhatsApp rent reminders',
      title: 'System: sends rent reminders to tenants who agreed, and records what WhatsApp reports back',
      role: 'pwvsb_officer',
      integration: 'whatsapp',
      companyIds: [],
      siteIds: [],
    },
    // The JA Group app's feed (Fauzan, 26 Oct 2026): a system sign-in, never a person and never on the sign-in screen.
    {
      id: 'u-ja-sync',
      name: 'JA Group app feed',
      title: 'System: sends payroll, foreign worker and incident data',
      role: 'pwvsb_officer',
      integration: 'ja',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-pwvsb-doa',
      name: 'Nurul Huda binti Ismail',
      title: 'Director Office Administrator (sets the tender protocol, every company)',
      role: 'pwvsb_officer',
      department: 'director_office',
      companyIds: [],
      siteIds: [],
    },
    // Group leadership who see group data (Fauzan, 26 Oct 2026): mock names.
    { id: 'u-chair', name: "Dato' Ismail bin Kassim", title: 'Chairman', role: 'pwvsb_officer', leadership: 'chairman', companyIds: [], siteIds: [] },
    { id: 'u-vchair', name: 'Tan Sri Lim Boon Huat', title: 'Vice Chairman', role: 'pwvsb_officer', leadership: 'vice_chairman', companyIds: [], siteIds: [] },
    {
      id: 'u-fd',
      name: 'Sharifah Nadia binti Syed Ali',
      title: 'Finance Director',
      role: 'pwvsb_officer',
      leadership: 'finance_director',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-dcos',
      name: 'Mohd Ridzuan bin Hamid',
      title: 'Deputy Chief of Staff and HR Director',
      role: 'pwvsb_officer',
      department: 'chief_of_staff',
      leadership: 'deputy_cos',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-cosec',
      name: 'Permata Management (mock)',
      title: 'Company secretary (monitors SSM filings, view only)',
      role: 'pwvsb_officer',
      corpSecretary: true,
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-pwvsb-hr',
      name: 'PWVSB HR',
      title: 'HR Admin, central HR (prepares; the Chief of Staff and Deputy check as HR Director)',
      role: 'pwvsb_officer',
      department: 'hr',
      companyIds: [],
      siteIds: [],
    },
    // Foreign Worker Management department (Fauzan, 26 Oct 2026): mock names.
    {
      id: 'u-fwm-mgr',
      name: 'Hairul Nizam bin Saad',
      title: 'FWM Manager, Foreign Worker Management (every company)',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'manager',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fwm-dep',
      name: 'Norhayati binti Musa',
      title: 'FWM Deputy Manager',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'deputy',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fwm-ex1',
      name: 'Prakash a/l Raman',
      title: 'FWM Executive',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'executive',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fwm-ex2',
      name: 'Farah Hanim binti Zakaria',
      title: 'FWM Executive',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'executive',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fwm-ex3',
      name: 'Mohd Hafiz bin Rahim',
      title: 'FWM Executive',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'executive',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-fwm-desp',
      name: 'Roslan bin Daud',
      title: 'FWM driver cum despatch',
      role: 'pwvsb_officer',
      department: 'fwm',
      fwmRole: 'despatch',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-pwvsb-arms',
      name: 'Zulkifli bin Hamzah',
      title: 'Arms Control Manager, Arms Control Department (every company)',
      role: 'pwvsb_officer',
      department: 'arms_control',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-pwvsb-arms-asst',
      name: 'Nur Izzati binti Kamal',
      title: 'Arms Control Assistant, Arms Control Department (every company)',
      role: 'pwvsb_officer',
      department: 'arms_control',
      companyIds: [],
      siteIds: [],
    },
    {
      id: 'u-cm-sasa',
      name: 'Nor Azlina binti Hashim',
      title: 'Company Manager, Sasa Security Services',
      role: 'company_manager',
      companyIds: ['co-sasa'],
      siteIds: [],
    },
    {
      // Fauzan, 26 Oct 2026: only one CEO and one COO in the group; each company has a Manager and a few also a General Manager.
      id: 'u-gm-sasa',
      name: 'Hamdan bin Yusof',
      title: 'General Manager, Sasa Security Services (above the Company Manager)',
      role: 'company_manager',
      companyIds: ['co-sasa'],
      siteIds: [],
    },
    {
      id: 'u-cm-arsh',
      name: 'Kenny Lau Chee Wah',
      title: 'Company Manager, Arrow Shield Security',
      role: 'company_manager',
      companyIds: ['co-arsh'],
      siteIds: [],
    },
    {
      id: 'u-cm-inas',
      name: 'Mohd Shukri bin Ahmad',
      title: 'Company Manager, Inas Security and Consultancy',
      role: 'company_manager',
      companyIds: ['co-inas'],
      siteIds: [],
    },
    {
      id: 'u-ae-arsh',
      name: 'Siti Hajar binti Rosli',
      title: 'Admin Executive, Arrow Shield Security',
      role: 'admin_exec',
      companyIds: ['co-arsh'],
      siteIds: [],
    },
    {
      id: 'u-sv-sasa',
      name: 'Ganesan a/l Perumal',
      title: 'Site Officer, Sasa (stationed at 3 sites)',
      role: 'supervisor',
      companyIds: ['co-sasa'],
      siteIds: sasaSites.slice(0, 3).map((s) => s.id),
    },
    ...patrolOfficers(ds, today),
    {
      id: 'u-dev-sasa-001',
      name: `Site device ${sasaSites[0].code}`,
      title: `Shared device at ${sasaSites[0].name}`,
      role: 'site_device',
      companyIds: ['co-sasa'],
      siteIds: [sasaSites[0].id],
    },
  ];
  ds.users.push(...users);
  websiteSampleUsers(ds);
  // Guards' own sign-ins (Fauzan, 25 Oct 2026): view only, their own record. One Malaysian and one Nepali guard
  // rostered at the first Sasa site, so the test version shows a real roster, clock record and patrol rounds.
  {
    const atSite = ds.shifts.filter((s) => s.siteId === sasaSites[0].id && s.personId && s.date <= today).map((s) => s.personId!);
    const pick = (nat: 'MY' | 'NP') => ds.people.find((p) => atSite.includes(p.id) && p.nationality === nat && p.role === 'guard');
    for (const [n, p] of [pick('MY'), pick('NP')].entries()) {
      if (!p) continue;
      ds.users.push({
        id: `u-guard-sasa-${n + 1}`,
        name: p.name,
        title: `Guard ${p.staffNo}, own view only (Sasa)`,
        role: 'guard',
        companyIds: ['co-sasa'],
        siteIds: [],
        personId: p.id,
      });
      // Patrol history for their past shifts at this site (mock data keeps only today's taps elsewhere): most rounds
      // done, a few missed or not finished, so the guard's view shows both.
      const grng = new Rng(MASTER_SEED + 101 + n);
      const cps = ds.checkpoints.filter((c) => c.siteId === sasaSites[0].id);
      const every = (sasaSites[0].patrolIntervalMin ?? RULES.patrolGapMin.value) * 60_000;
      for (const sh of ds.shifts.filter(
        (s) => s.personId === p.id && s.siteId === sasaSites[0].id && toMs(s.end) <= toMs(now) && s.date >= addDays(today, -7),
      )) {
        const a = ds.attendance.find((x) => x.shiftId === sh.id && x.clockIn);
        if (!a) continue;
        const from = toMs(a.clockIn!);
        const until = a.clockOut ? toMs(a.clockOut) : toMs(sh.end);
        for (let t = from, r = 0; t + 60_000 < until; t += every, r++) {
          const roll = grng.int(0, 99);
          if (roll < 8) continue; // round missed
          cps.forEach((cp, k) => {
            if (roll < 14 && k === cps.length - 1) return; // round not finished
            const at = t + Math.min(every - 60_000, (k + 1) * grng.int(5, 15) * 60_000);
            if (at >= until) return;
            ds.scans.push({
              id: `sc-g-${sh.id}-${r}-${cp.id}`,
              companyId: 'co-sasa',
              siteId: sasaSites[0].id,
              checkpointId: cp.id,
              personId: p.id,
              at: fromMs(at),
              method: 'NFC',
            });
          });
        }
      }
    }
  }
  // Officers see their own record too (Fauzan, 25 Oct 2026): link each stationed and patrolling officer sign-in to an
  // officer's person record in their home company, under the officer's name.
  {
    const taken = new Set(ds.users.map((u) => u.personId).filter(Boolean));
    for (const u of ds.users.filter((x) => x.role === 'supervisor' && (!x.opsTier || x.opsTier === 'patrol'))) {
      const home = u.homeCompanyId ?? u.companyIds[0];
      const want = u.opsTier === 'patrol' ? 'patrol_officer' : 'supervisor';
      const p = ds.people.find((x) => x.companyId === home && x.role === want && x.status === 'active' && !taken.has(x.id));
      if (!p) continue;
      taken.add(p.id);
      p.name = u.name;
      u.personId = p.id;
    }
  }
  const grantFrom = addDays(today, -30);
  const grantTo = addDays(today, 335);
  for (const cid of allCompanyIds) {
    const pilot = pilotIds.includes(cid);
    ds.grants.push({
      id: `gr-fauzan-${cid}`,
      userId: 'u-fauzan',
      companyId: cid,
      scope: pilot ? 'act' : 'monitor',
      basis: pilot ? 'Board mandate for pilot (to be signed)' : 'Management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    for (const dept of ['hr', 'arms', 'arms-asst', 'doa']) {
      ds.grants.push({
        id: `gr-pwvsb-${dept}-${cid}`,
        userId: `u-pwvsb-${dept}`,
        companyId: cid,
        scope: 'monitor',
        basis: 'Management agreement with PWVSB (to be verified)',
        validFrom: grantFrom,
        validTo: grantTo,
      });
    }
    for (const userId of [
      'u-chair',
      'u-vchair',
      'u-fd',
      'u-dcos',
      'u-cosec',
      'u-credit',
      'u-legal',
      'u-audit',
      'u-act-aud1',
      'u-act-enf1',
      'u-act-aud2',
      'u-act-enf2',
      'u-proc-exec',
      'u-proc-store1',
      'u-proc-store2',
      ...ds.users.filter((u) => u.department === 'finance' && u.financeTeam != null).map((u) => u.id),
    ]) {
      ds.grants.push({
        id: `gr-${userId}-${cid}`,
        userId,
        companyId: cid,
        scope: 'monitor',
        basis: 'Director Office, management agreement with PWVSB (to be verified)',
        validFrom: grantFrom,
        validTo: grantTo,
      });
    }
    for (const userId of ['u-fwm-mgr', 'u-fwm-dep', 'u-fwm-ex1', 'u-fwm-ex2', 'u-fwm-ex3', 'u-fwm-desp']) {
      ds.grants.push({
        id: `gr-${userId}-${cid}`,
        userId,
        companyId: cid,
        scope: 'monitor',
        basis: 'Management agreement with PWVSB (to be verified)',
        validFrom: grantFrom,
        validTo: grantTo,
      });
    }
    ds.grants.push({
      id: `gr-cms-${cid}`,
      userId: 'u-cms-head',
      companyId: cid,
      scope: 'monitor',
      basis: 'Management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    ds.grants.push({
      id: `gr-cos-${cid}`,
      userId: 'u-cos',
      companyId: cid,
      scope: 'monitor',
      basis: 'Director Office, management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    ds.grants.push({
      id: `gr-transport-${cid}`,
      userId: 'u-transport',
      companyId: cid,
      scope: 'monitor',
      basis: 'Transport department, management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    ds.grants.push({
      id: `gr-cms-link-${cid}`,
      userId: 'u-cms-link',
      companyId: cid,
      scope: 'monitor',
      basis: 'CMS Command Centre app link (system), Special Ops slice 4E, 2 Nov 2026',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    ds.grants.push({
      id: `gr-ja-${cid}`,
      userId: 'u-ja-sync',
      companyId: cid,
      scope: 'monitor',
      basis: 'JA Group app data feed (system), Fauzan 26 Oct 2026',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    // The analytics feed and the in-house server read each company's sites and gate records only as systems.
    ds.grants.push(
      { id: `gr-analytics-${cid}`, userId: 'u-analytics-feed', companyId: cid, scope: 'monitor', basis: 'CCTV and sensor analytics feed (system), Fauzan 6 Nov 2026', validFrom: grantFrom, validTo: grantTo },
      { id: `gr-inhouse-${cid}`, userId: 'u-inhouse-server', companyId: cid, scope: 'monitor', basis: 'In-house records server (system), Fauzan 6 Nov 2026', validFrom: grantFrom, validTo: grantTo },
    );
    ds.grants.push({
      id: `gr-pdpa-${cid}`,
      userId: 'u-pdpa',
      companyId: cid,
      scope: 'monitor',
      basis: 'PDPA officer, management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
    for (const head of ['ogm', 'opsdir', 'coo']) {
      ds.grants.push({
        id: `gr-${head}-${cid}`,
        userId: `u-${head}`,
        companyId: cid,
        scope: 'monitor',
        basis: 'Management agreement with PWVSB (to be verified)',
        validFrom: grantFrom,
        validTo: grantTo,
      });
    }
    ds.grants.push({
      id: `gr-pwvsb-${cid}`,
      userId: 'u-pwvsb-ops',
      companyId: cid,
      scope: 'monitor',
      basis: 'Management agreement with PWVSB (to be verified)',
      validFrom: grantFrom,
      validTo: grantTo,
    });
  }

  // Regional Operations Managers monitor every company with a branch (or, without site data, its base) in their region.
  // Operations Managers do the same for the states of their area.
  const opsAreas: [string, readonly string[]][] = [
    ...(['central', 'northern', 'southern'] as const).map((r): [string, readonly string[]] => [
      { central: 'u-rom-central', northern: 'u-rom-north', southern: 'u-rom-south' }[r],
      REGIONS.find((x) => x.id === r)!.states,
    ]),
    ['u-om-klang', ['Selangor', 'Kuala Lumpur']],
    ['u-om-johor', ['Johor', 'Melaka']],
  ];
  for (const [userId, states] of opsAreas) {
    for (const c of ds.companies) {
      const branchStates = ds.branches.filter((b) => b.companyId === c.id).map((b) => b.state);
      if (!(branchStates.length ? branchStates : [c.state]).some((st) => states.includes(st))) continue;
      ds.grants.push({
        id: `gr-${userId}-${c.id}`,
        userId,
        companyId: c.id,
        scope: 'monitor',
        basis: 'Management agreement with PWVSB (to be verified)',
        validFrom: grantFrom,
        validTo: grantTo,
      });
    }
  }

  // Photo evidence and site visits (Fauzan, 25 Oct 2026). Seed pictures are small drawings, not camera photos.
  {
    const nowMs = toMs(now);
    const picture = (site: (typeof ds.sites)[number], at: number, lat: number, lng: number, what: string) => {
      const t = fromMs(at);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#5b6b78"/><rect y="40" width="480" height="200" fill="#7d8e99"/><text x="240" y="150" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">${what}</text><rect y="262" width="480" height="58" fill="#000" fill-opacity=".6"/><text x="10" y="284" font-family="monospace" font-size="13" fill="#fff">${site.code} ${t.slice(0, 10)} ${t.slice(11, 19)} MYT</text><text x="10" y="306" font-family="monospace" font-size="13" fill="#fff">${lat.toFixed(5)}, ${lng.toFixed(5)} ±8 m · Prima Secure</text></svg>`;
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    };
    const photo = (site: (typeof ds.sites)[number], at: number, by: string, what: string, link: { caseId?: string; visitId?: string }, away = 0) => {
      const lat = site.lat + 0.0001 + away;
      const lng = site.lng - 0.0001;
      const image = picture(site, at, lat, lng, what);
      const dist = Math.round(Math.hypot((lat - site.lat) * 111_320, (lng - site.lng) * 111_320 * Math.cos((site.lat * Math.PI) / 180)));
      ds.evidencePhotos.push({
        id: `ev-${sha256Hex(image).slice(0, 16)}`,
        companyId: site.companyId,
        siteId: site.id,
        caseId: link.caseId ?? null,
        visitId: link.visitId ?? null,
        takenBy: by,
        capturedAt: fromMs(at),
        receivedAt: fromMs(at + 4000),
        lat,
        lng,
        accuracyM: 8,
        distanceM: dist,
        place: dist > site.geofenceM ? 'away' : 'on_site',
        time: 'ok',
        sha256: sha256Hex(image),
        bytes: image.length,
        image,
        caption: what,
        source: 'test_picture',
      });
      return ds.evidencePhotos[ds.evidencePhotos.length - 1].id;
    };
    const sasa = ds.sites.filter((s) => s.companyId === 'co-sasa');
    const sv = ds.users.find((u) => u.id === 'u-sv-sasa')!;
    const s1 = sasa[0];
    const start = nowMs - 26 * 3_600_000;
    const v1 = `vis-${s1.id}-${start}`;
    ds.siteVisits.push({
      id: v1,
      companyId: s1.companyId,
      siteId: s1.id,
      userId: sv.id,
      visitorName: sv.name,
      visitorTitle: sv.title,
      purpose: 'Routine night check',
      startedAt: fromMs(start),
      lat: s1.lat + 0.0001,
      lng: s1.lng - 0.0001,
      accuracyM: 8,
      distanceM: 16,
      place: 'on_site',
      endedAt: fromMs(start + 40 * 60_000),
      findings: 'Guard alert, logbook up to date. Back gate light not working; client told.',
      status: 'closed',
    });
    photo(s1, start + 10 * 60_000, sv.name, 'Guard post and logbook', { visitId: v1 });
    photo(s1, start + 25 * 60_000, sv.name, 'Back gate light out', { visitId: v1 });
    // A visit checked in 1.3 km from the site is shown as away, for the company to question.
    const rom = ds.users.find((u) => u.id === 'u-rom-central')!;
    const s2 = sasa[1];
    const start2 = nowMs - 50 * 60_000;
    ds.siteVisits.push({
      id: `vis-${s2.id}-${start2}`,
      companyId: s2.companyId,
      siteId: s2.id,
      userId: rom.id,
      visitorName: rom.name,
      visitorTitle: rom.title,
      purpose: 'Client meeting on patrol times',
      startedAt: fromMs(start2),
      lat: s2.lat + 0.012,
      lng: s2.lng,
      accuracyM: 12,
      distanceM: 1336,
      place: 'away',
      endedAt: null,
      findings: null,
      status: 'open',
    });
    // The newest open incident at a Sasa site carries a photo from the site.
    const inc = ds.cases
      .filter((c) => c.companyId === 'co-sasa' && c.siteId && c.type === 'INCIDENT' && c.status !== 'closed')
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
    if (inc) photo(ds.sites.find((s) => s.id === inc.siteId)!, toMs(inc.openedAt) + 3 * 60_000, inc.reportedBy, 'Damage at the scene', { caseId: inc.id });

    // Escalation ladder (Fauzan, 25 Oct 2026): officer stationed at the site (some sites only), patrolling officer,
    // Operations Manager, Regional OM, then the OGM (government site) or Operations Director (private site).
    const stateOfSite = (siteId: string) => ds.branches.find((b) => b.id === ds.sites.find((x) => x.id === siteId)!.branchId)!.state;
    const holder = (c: (typeof ds.cases)[number], level: string) => {
      const st = stateOfSite(c.siteId!);
      const gov = ds.sites.find((x) => x.id === c.siteId)!.sector === 'government';
      const u = ds.users.find((u) =>
        level === 'OFFICER'
          ? u.role === 'supervisor' && !u.opsTier && u.siteIds.includes(c.siteId!)
          : level === 'PATROL'
            ? u.opsTier === 'patrol' && u.siteIds.includes(c.siteId!)
            : level === 'OM'
              ? u.opsTier === 'om' && u.areaStates!.includes(st)
              : level === 'ROM'
                ? u.opsTier === 'regional' && REGIONS.some((r) => u.regionIds!.includes(r.id) && r.states.includes(st))
                : u.opsTier === (gov ? 'ogm' : 'ops_director'),
      );
      return u?.name ?? 'Not assigned';
    };
    const LABEL: Record<string, string> = {
      OFFICER: 'Site officer',
      PATROL: 'Patrolling officer',
      OM: 'Operations Manager',
      ROM: 'Regional Operations Manager',
    };
    const chainOf = (c: (typeof ds.cases)[number]) => {
      const stationed = ds.users.some((u) => u.role === 'supervisor' && !u.opsTier && u.siteIds.includes(c.siteId!));
      return (stationed ? ['OFFICER', 'PATROL', 'OM', 'ROM', 'HEAD'] : ['PATROL', 'OM', 'ROM', 'HEAD']) as ('OFFICER' | 'PATROL' | 'OM' | 'ROM' | 'HEAD')[];
    };
    const openSite = ds.cases.filter((c) => c.siteId && c.status !== 'closed' && c.status !== 'resolved').sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    for (const c of ds.cases.filter((x) => x.siteId)) {
      const done = c.status === 'resolved' || c.status === 'closed';
      c.level = done ? 'DONE' : chainOf(c)[0];
      c.levelSince = c.openedAt;
      c.signOffs = [];
    }
    const at = (c: (typeof ds.cases)[number], min: number) => fromMs(Math.min(nowMs - 60_000, toMs(c.openedAt) + min * 60_000));
    const NOTES = {
      verified: 'Checked at site with the guard; needs the next level to act',
      resolved: 'Dealt with at site; client informed',
      escalated: 'Big matter: client loss and damage claim; cannot be settled at Regional OM level',
    };
    /** Sign a seed case up the ladder, one level per outcome, `gap` minutes apart. */
    const climb = (c: (typeof ds.cases)[number], outcomes: ('verified' | 'resolved' | 'escalated')[], gap: number) => {
      const chain = chainOf(c);
      const gov = ds.sites.find((x) => x.id === c.siteId)!.sector === 'government';
      const name = (l: string) => (l === 'HEAD' ? (gov ? 'Operations General Manager' : 'Operations Director') : LABEL[l]);
      outcomes.forEach((outcome, i) => {
        const level = chain[i];
        const t = at(c, gap * (i + 1));
        const by = holder(c, level);
        const site = ds.sites.find((x) => x.id === c.siteId)!;
        const proofId = photo(
          site,
          toMs(t) - 120_000,
          by,
          outcome === 'escalated' ? 'Damage at the scene' : `${outcome === 'verified' ? 'Checked' : 'Done'}: ${c.ref}`,
          {
            caseId: c.id,
          },
        );
        c.signOffs!.push({ level, outcome, by, at: t, note: NOTES[outcome], proofIds: [proofId] });
        c.events.push({
          at: t,
          by,
          action: `${{ verified: 'Verified', resolved: 'Resolved', escalated: 'Escalated' }[outcome]} (${name(level)})`,
          note: `${NOTES[outcome]} → ${name(chain[i + 1])}`,
        });
        c.level = chain[i + 1];
        c.levelSince = t;
        c.status = 'escalated';
      });
    };
    // Every open case reported by a person came with a photo (rule CASE-PROOF); an SOS is sent at once without one.
    for (const c of openSite.filter((x) => x.type !== 'SOS' && !ds.evidencePhotos.some((p) => p.caseId === x.id))) {
      photo(ds.sites.find((x) => x.id === c.siteId)!, toMs(c.openedAt) + 60_000, c.reportedBy, c.title, { caseId: c.id });
    }
    const sasaOpen = openSite.filter((c) => c.companyId === 'co-sasa');
    if (sasaOpen[0]) climb(sasaOpen[0], ['verified'], 20);
    if (sasaOpen[1]) climb(sasaOpen[1], ['verified', 'verified'], 25);
    // Resolved at site and verified up to the Regional OM, who confirms it fully resolved.
    const upToRom = (c: (typeof ds.cases)[number]) =>
      chainOf(c)
        .slice(0, chainOf(c).indexOf('ROM'))
        .map((_, i) => (i === 0 ? 'resolved' : 'verified') as 'resolved' | 'verified');
    if (sasaOpen[2]) climb(sasaOpen[2], upToRom(sasaOpen[2]), 30);
    // A big matter the Regional OM escalated to the head of operations (Fauzan, 25 Oct 2026).
    const big = sasaOpen.find((c, i) => i > 2 && c.severity !== 'P4');
    if (big) climb(big, [...upToRom(big).map(() => 'verified' as const), 'escalated'], 15);
  }

  // Guard profile and leave (Fauzan, 25 Oct 2026). A separate random stream so earlier mock data stays the same.
  {
    const lrng = new Rng(MASTER_SEED + 99);
    const nowMs = toMs(now);
    const pilotIds = PILOTS.map((p) => `co-${p.code.toLowerCase()}`);
    // Mock basic pay until payroll rules and payslips arrive (minimum wage RM1,700).
    for (const p of ds.people) {
      p.basicPay = p.role === 'supervisor' ? 100 * lrng.int(26, 32) : p.role === 'patrol_officer' ? 100 * lrng.int(30, 34) : 50 * lrng.int(34, 46);
    }
    // Office staff of each pilot company: 1 manager and 3 admin executives (V7), with leave like everyone else.
    const OFFICE = [
      ['Company Manager', 6500],
      ['Admin Executive', 3200],
      ['Admin Executive', 3000],
      ['Admin Executive', 2900],
    ] as const;
    const OFFICE_NAMES = ['Noraini binti Kassim', 'Tan Mei Ling', 'Priya a/p Raman', 'Hidayah binti Salleh', 'Lim Siew Yen', 'Azura binti Hamid'];
    let on = 0;
    for (const cid of pilotIds) {
      const branch = ds.branches.find((b) => b.companyId === cid)!;
      const code = ds.companies.find((c) => c.id === cid)!.code;
      OFFICE.forEach(([title, pay], i) => {
        const dob = addDays(today, -lrng.int(26, 52) * 365);
        ds.people.push({
          id: `pr-${cid.slice(3)}-o${i + 1}`,
          companyId: cid,
          branchId: branch.id,
          staffNo: `${code}O${String(i + 1).padStart(3, '0')}`,
          name: OFFICE_NAMES[on++ % OFFICE_NAMES.length],
          nationality: 'MY',
          idMasked: `${dob.slice(2, 4)}${dob.slice(5, 7)}${dob.slice(8, 10)}-**-***${lrng.int(0, 9)}`,
          dob,
          phone: `01${lrng.int(0, 9)}-${lrng.int(100, 999)} ${lrng.int(1000, 9999)}`,
          role: 'office',
          status: 'active',
          hiredOn: addDays(today, -lrng.int(200, 3000)),
          faceEnrolledOn: null,
          basicPay: pay,
          jobTitle: title,
        });
        // The old random test PIN draw, kept so the rest of the mock data stays the same (PINs now come from pin.ts).
        lrng.int(1000, 9999);
      });
    }
    // Every staff sign-in has its own record (Fauzan, 26 Oct 2026), except the CEO, Chairman and Vice Chairman.
    // Company staff are the company's office people; PWVSB central staff are employed by PWVSB itself.
    const link = (userId: string, personId: string, title?: string) => {
      const u = ds.users.find((x) => x.id === userId);
      const p = ds.people.find((x) => x.id === personId);
      if (!u || !p) return;
      u.personId = p.id;
      p.name = u.name;
      if (title) p.jobTitle = title;
    };
    link('u-cm-sasa', 'pr-sasa-o1');
    link('u-cm-arsh', 'pr-arsh-o1');
    link('u-cm-inas', 'pr-inas-o1');
    link('u-ae-arsh', 'pr-arsh-o2');
    const srng = new Rng(MASTER_SEED + 131);
    const gmSasa = ds.users.find((u) => u.id === 'u-gm-sasa');
    if (gmSasa) {
      const branch = ds.branches.find((b) => b.companyId === 'co-sasa')!;
      ds.people.push({
        id: 'pr-sasa-o5',
        companyId: 'co-sasa',
        branchId: branch.id,
        staffNo: 'SASAO005',
        name: gmSasa.name,
        nationality: 'MY',
        idMasked: '700312-**-***5',
        dob: '1970-03-12',
        phone: '012-388 4410',
        role: 'office',
        status: 'active',
        hiredOn: addDays(today, -2900),
        faceEnrolledOn: addDays(today, -400),
        basicPay: 9500,
        jobTitle: 'General Manager',
      });
      gmSasa.personId = 'pr-sasa-o5';
    }
    let sn = 0;
    for (const u of ds.users.filter((x) => (x.role === 'pwvsb_officer' || x.role === 'director') && !x.personId)) {
      if (u.opsTier === 'ceo' || u.leadership === 'chairman' || u.leadership === 'vice_chairman') continue;
      sn += 1;
      const dob = addDays(today, -srng.int(28, 58) * 365);
      const senior = u.opsTier === 'coo' || !!u.leadership || ['regional', 'ogm', 'ops_director'].includes(u.opsTier ?? '') || u.fwmRole === 'manager';
      ds.people.push({
        id: `pr-pwvsb-${String(sn).padStart(3, '0')}`,
        companyId: GROUP_EMPLOYER_ID,
        branchId: 'br-pwvsb-hq',
        staffNo: `PWV${String(sn).padStart(3, '0')}`,
        name: u.name,
        nationality: 'MY',
        idMasked: `${dob.slice(2, 4)}${dob.slice(5, 7)}${dob.slice(8, 10)}-**-***${srng.int(0, 9)}`,
        dob,
        phone: `01${srng.int(0, 9)}-${srng.int(100, 999)} ${srng.int(1000, 9999)}`,
        role: 'office',
        status: 'active',
        hiredOn: addDays(today, -srng.int(300, 3500)),
        faceEnrolledOn: addDays(today, -srng.int(10, 300)),
        basicPay: senior ? 100 * srng.int(120, 220) : 100 * srng.int(35, 80),
        jobTitle: u.title.replace(/\s*\(.*\)$/, ''),
      });
      u.personId = `pr-pwvsb-${String(sn).padStart(3, '0')}`;
    }
    // The IT team is employed and paid by Merdeka Network Sdn Bhd (Fauzan, 28 Oct 2026).
    for (const u of ds.users.filter((x) => x.department === 'it' && x.personId)) {
      const p = ds.people.find((x) => x.id === u.personId);
      if (p) p.companyId = IT_COMPANY_ID;
    }
    // The OGM's team and the inventory and store team are employed by Goodwill Empire Sdn Bhd (Fauzan, 2 Nov 2026).
    for (const u of ds.users.filter((x) => x.personId && (x.opsTier === 'ogm' || x.department === 'procurement'))) {
      const p = ds.people.find((x) => x.id === u.personId);
      if (p) p.companyId = GOV_OPS_COMPANY_ID;
    }
    // The Operations Director's private-sector team is employed by Sasa Team Sdn Bhd (Fauzan, 2 Nov 2026).
    for (const u of ds.users.filter((x) => x.personId && (x.opsTier === 'ops_director' || (x.department === 'operations' && x.opsSector === 'private')))) {
      const p = ds.people.find((x) => x.id === u.personId);
      if (p) p.companyId = PRIVATE_OPS_COMPANY_ID;
    }
    // One pay change waiting for the Chief of Staff to verify (Fauzan, 27 Oct 2026: "need CoS verify"). Mock.
    const raise = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.jobTitle?.startsWith('Finance Data Entry'));
    if (raise?.basicPay)
      ds.payChanges.push({
        id: 'pay-seed-1',
        companyId: GROUP_EMPLOYER_ID,
        personId: raise.id,
        from: raise.basicPay,
        to: raise.basicPay + 300,
        reason: 'Yearly increment, appraisal score 4 of 5 (mock)',
        effectiveOn: `${today.slice(0, 7)}-01`,
        requestedBy: 'PWVSB HR',
        requestedById: 'u-pwvsb-hr',
        requestedAt: fromMs(toMs(now) - 5 * 3_600_000),
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        note: null,
      });
    // A tiny real PDF stands in for a scanned medical certificate.
    const mc = (n: number) => {
      const body = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (Medical certificate, test ${n}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
      return 'data:application/pdf;base64,' + btoa(body);
    };
    const year = today.slice(0, 4);
    let n = 0;
    const leave = (
      p: Person,
      kind: LeaveKind,
      from: IsoDate,
      days: number,
      status: LeaveRequest['status'],
      reason: string,
      at: number,
      withMc: boolean,
      decidedBy: string | null,
    ) => {
      n += 1;
      const id = `lv-${p.id}-${n}`;
      const proofIds: string[] = [];
      if (withMc) {
        const data = mc(n);
        const sha256 = sha256Hex(data);
        ds.evidenceDocs.push({
          id: `doc-${sha256.slice(0, 16)}`,
          companyId: p.companyId,
          caseId: null,
          followUpId: null,
          leaveId: id,
          name: `MC ${p.staffNo}.pdf`,
          mime: 'application/pdf',
          bytes: Math.floor((data.length - data.indexOf(',') - 1) * 0.75),
          sha256,
          data,
          caption: '',
          uploadedBy: `${p.name} (${p.staffNo})`,
          receivedAt: fromMs(at),
        });
        proofIds.push(`doc-${sha256.slice(0, 16)}`);
      }
      ds.leaveRequests.push({
        id,
        companyId: p.companyId,
        personId: p.id,
        kind,
        from,
        to: addDays(from, days - 1),
        days,
        reason,
        proofIds,
        requestedAt: fromMs(at),
        requestedBy: `${p.name} (${p.staffNo})`,
        via: p.role === 'office' ? 'company' : 'site_device',
        status,
        decidedBy,
        decidedAt: decidedBy ? fromMs(at + 5 * 3_600_000) : null,
        decisionNote: null,
      });
    };
    // Leave already taken this year by about a third of the pilot staff.
    for (const p of ds.people.filter((x) => pilotIds.includes(x.companyId) && x.status === 'active')) {
      if (!lrng.chance(0.35)) continue;
      const start = `${year}-01-05`;
      const span = daysBetween(start, addDays(today, -20));
      if (span < 10) continue;
      const d1 = addDays(start, lrng.int(0, span));
      const approver = p.role === 'office' ? 'PWVSB HR' : 'Azman bin Osman';
      leave(p, 'ANNUAL', d1, lrng.int(1, 4), 'approved', 'Family matters', toMs(myt(addDays(d1, -7), '09:00')), false, approver);
      if (lrng.chance(0.5)) {
        const d2 = addDays(start, lrng.int(0, span));
        leave(p, 'SICK', d2, lrng.int(1, 3), 'approved', 'Fever, clinic MC', toMs(myt(d2, '08:00')), true, approver);
        // The illness and clinic as written on the MC (Shahirah, 26 Oct 2026), picked without touching the random stream.
        const ILL = ['Acute febrile illness', 'Upper respiratory tract infection', 'Acute gastroenteritis', 'Migraine', 'Lower back pain', 'Conjunctivitis'];
        const CLINIC = ['Klinik Kesihatan Klang', 'Klinik Mediviron', 'Poliklinik Komuniti', 'Klinik Panel Sasa'];
        Object.assign(ds.leaveRequests[ds.leaveRequests.length - 1], { illness: ILL[n % ILL.length], clinic: CLINIC[n % CLINIC.length] });
      }
    }
    // Waiting for a decision: one fresh, one past 12 hours (now with the Regional OM), one reason for an absence.
    const sasaGuards = ds.people.filter((x) => x.companyId === 'co-sasa' && x.role === 'guard' && x.status === 'active');
    leave(sasaGuards[3], 'ANNUAL', addDays(today, 5), 3, 'pending', 'Balik kampung for a wedding', nowMs - 2 * 3_600_000, false, null);
    leave(sasaGuards[8], 'EMERGENCY', addDays(today, 1), 1, 'pending', 'Child in hospital', nowMs - 15 * 3_600_000, false, null);
    const absent = ds.shifts.find(
      (sh) => sh.companyId === 'co-sasa' && sh.personId && sh.date === addDays(today, -1) && !ds.attendance.some((a) => a.shiftId === sh.id),
    );
    const absentee = absent ? ds.people.find((x) => x.id === absent.personId) : undefined;
    if (absentee) leave(absentee, 'ABSENCE_REASON', absent!.date, 1, 'pending', 'Food poisoning, went to the clinic', nowMs - 3 * 3_600_000, true, null);
    // Hiring papers on file (Shahirah, 26 Oct 2026): complete for the test guard, partly for a sample, missing for the rest
    // (the checklist is new, so most files are still to be scanned in).
    const paperDoc = (p: Person, kind: string, at: number) => {
      const data = 'data:application/pdf;base64,' + btoa(`%PDF-1.1 ${kind} ${p.staffNo} (test)`);
      const sha256 = sha256Hex(data);
      const id = `doc-${sha256.slice(0, 16)}`;
      ds.evidenceDocs.push({
        id,
        companyId: p.companyId,
        caseId: null,
        followUpId: null,
        hrPersonId: p.id,
        name: `${kind} ${p.staffNo}.pdf`,
        mime: 'application/pdf',
        bytes: Math.floor((data.length - data.indexOf(',') - 1) * 0.75),
        sha256,
        data,
        caption:
          kind === 'Agreement' ? 'Employment agreement, signed' : kind === 'Stamped' ? 'Employment agreement, stamped (stamp duty)' : 'KDN vetting certificate',
        uploadedBy: 'Nor Azlina binti Hashim',
        receivedAt: fromMs(at),
      });
      return id;
    };
    const fileHiring = (p: Person, kinds: ('AGREEMENT' | 'AGREEMENT_STAMPED' | 'VETTING_CERT')[]) => {
      const at = toMs(myt(p.hiredOn < addDays(today, -30) ? addDays(p.hiredOn, 3) : addDays(today, -2), '10:00'));
      const name = { AGREEMENT: 'Agreement', AGREEMENT_STAMPED: 'Stamped', VETTING_CERT: 'Vetting' } as const;
      p.hiringDocs = kinds.map((kind) => ({ kind, docIds: [paperDoc(p, name[kind], at)], by: 'Nor Azlina binti Hashim', at: fromMs(at) }));
    };
    const testGuard = ds.people.find((x) => x.id === ds.users.find((u) => u.id === 'u-guard-sasa-1')?.personId);
    if (testGuard) fileHiring(testGuard, ['AGREEMENT', 'AGREEMENT_STAMPED', 'VETTING_CERT']);
    ds.people
      .filter((x) => pilotIds.includes(x.companyId) && x.status === 'active' && x !== testGuard)
      .filter((_, i) => i % 15 === 0)
      .forEach((x, i) =>
        fileHiring(
          x,
          i % 3 === 0 ? ['AGREEMENT'] : x.role === 'office' ? ['AGREEMENT', 'AGREEMENT_STAMPED'] : ['AGREEMENT', 'AGREEMENT_STAMPED', 'VETTING_CERT'],
        ),
      );
    // A hospital stay with its claim papers half collected, on the test guard's own file.
    if (testGuard) {
      const from = addDays(today, -12);
      const at = toMs(myt(from, '07:30'));
      leave(testGuard, 'HOSPITAL', from, 3, 'approved', 'Admitted for dengue fever', at, true, 'Azman bin Osman');
      const q = ds.leaveRequests[ds.leaveRequests.length - 1];
      const admission = paperDoc(testGuard, 'Admission', at + 3_600_000);
      q.illness = 'Dengue fever';
      q.clinic = 'Hospital Tengku Ampuan Rahimah, Klang';
      q.hospitalClaim = {
        docs: [
          { item: 'ADMISSION_LETTER', status: 'received', docIds: [admission], by: 'Nor Azlina binti Hashim', at: fromMs(at + 3_600_000) },
          { item: 'GUARANTEE_LETTER', status: 'missing', docIds: [], by: null, at: null },
          { item: 'MEDICAL_CERT', status: 'received', docIds: q.proofIds, by: q.requestedBy, at: q.requestedAt },
          { item: 'DISCHARGE_SUMMARY', status: 'missing', docIds: [], by: null, at: null },
          { item: 'ITEMISED_BILL', status: 'missing', docIds: [], by: null, at: null },
          { item: 'CLAIM_FORM', status: 'missing', docIds: [], by: null, at: null },
        ],
        stage: 'collecting',
        insurer: null,
        history: [
          { at: q.requestedAt, by: q.requestedBy, text: 'Claim opened with the MC' },
          { at: fromMs(at + 3_600_000), by: 'Nor Azlina binti Hashim', text: 'Admission letter or referral: received' },
        ],
      };
    }
    const sasaOffice = ds.people.find((x) => x.id === 'pr-sasa-o2');
    if (sasaOffice) leave(sasaOffice, 'ANNUAL', addDays(today, 10), 2, 'pending', 'School holidays with family', nowMs - 1 * 3_600_000, false, null);
  }

  // Reports to the Director Office (Fauzan, 25 Oct 2026). Proposed list until the Director Office sets its own. The
  // pilots have sent most of the last periods; a few are late or missing to show both.
  {
    ds.reportDefs.push(...PLACEHOLDER_REPORTS, ...DEPARTMENT_MONTHLY_REPORTS);
    const rrng = new Rng(MASTER_SEED + 131);
    const nowMs = toMs(now);
    const managers: Record<string, string> = { 'co-sasa': 'Nor Azlina binti Hashim', 'co-arsh': 'Kenny Lau Chee Wah', 'co-inas': 'Mohd Shukri bin Ahmad' };
    const deptBy: Record<string, string> = {
      hr: 'PWVSB HR',
      arms_control: 'Zulkifli bin Hamzah',
      chief_of_staff: 'Aisyah binti Rahman',
      operations: 'PWVSB Operations',
    };
    const pilots = ds.companies.filter((c) => c.isPilot).map((c) => c.id);
    for (const def of [...PLACEHOLDER_REPORTS, ...DEPARTMENT_MONTHLY_REPORTS]) {
      const senders: { companyId: string | null; department: NonNullable<User['department']> | null; by: string }[] =
        def.from === 'company'
          ? pilots.map((id) => ({ companyId: id, department: null, by: managers[id] ?? 'Company manager' }))
          : [{ companyId: null, department: def.department!, by: deptBy[def.department!] ?? 'Department' }];
      for (const p of reportPeriods(def, today, 5).filter((x) => x.due < today)) {
        for (const s of senders) {
          const roll = rrng.int(0, 99);
          if (roll < 10) continue; // not sent
          const lateDays = roll < 22 ? rrng.int(1, 4) : 0;
          const at = Math.min(nowMs - 3_600_000, toMs(myt(addDays(p.due, lateDays - (lateDays ? 0 : rrng.int(0, 2))), '16:00')));
          ds.reportSubmissions.push({
            id: `rs-${def.id}-${p.period}-${s.companyId ?? s.department}`,
            defId: def.id,
            period: p.period,
            companyId: s.companyId,
            department: s.department,
            by: s.by,
            at: fromMs(at),
            note: lateDays ? 'Sent late, figures waited on the bank statement' : '',
            docIds: [],
            file: null,
            // Most monthly department reports cover the whole form; some leave a section out, for ACT to see.
            ...(def.sections ? { sectionsCovered: roll < 30 ? def.sections.slice(0, -2) : def.sections } : {}),
          });
        }
      }
    }
  }

  // Meetings across the group (Fauzan, 25 Oct 2026): the weekly group management meeting, a company board meeting,
  // a company operations meeting with minutes not yet summarised, and an HR department meeting.
  {
    const monday = mondayOf(today);
    const at = (d: IsoDate, hm: string) => myt(d, hm);
    const groupMins = [
      'Tenders: 15 bids open across the pilots, 1 closing within 7 days.',
      'Reports: Inas sent the weekly operations report late again.',
      'Collections from government clients are slow in Selangor.',
      `Action: Chase Inas for the weekly report on time (Nurul Huda, by ${addDays(monday, 4)})`,
      `Action: List government debtors over 90 days (Finance, by ${addDays(monday, 7)})`,
      `Action: Confirm the second-check managers for tenders (Fauzan, by ${addDays(monday, 2)})`,
    ].join('\n');
    const sum = simpleMinutesReader.summarise(groupMins);
    ds.meetings.push(
      {
        id: 'mt-grp-last',
        companyId: null,
        department: 'director_office',
        kind: 'management',
        title: 'Group management meeting',
        organiser: 'Nurul Huda binti Ismail',
        start: at(addDays(monday, -7), '10:00'),
        end: at(addDays(monday, -7), '11:30'),
        location: 'Director Office, boardroom',
        attendees: ['Fauzan', 'Rosnah binti Abdullah', 'Ahmad Faisal bin Yusof', 'Nurul Huda binti Ismail', 'Aisyah binti Rahman'],
        agenda: '1. Tenders\n2. Reports\n3. Collections',
        status: 'held',
        minutes: { text: groupMins, by: 'Nurul Huda binti Ismail', at: at(addDays(monday, -7), '15:00'), file: null },
        summary: {
          ...sum,
          actions: sum.actions.map((a, i) => ({ ...a, done: i === 2 ? false : i === 0 })),
          reader: simpleMinutesReader.name,
          at: at(addDays(monday, -7), '15:01'),
          checkedBy: 'Nurul Huda binti Ismail',
          checkedAt: at(addDays(monday, -7), '16:00'),
        },
      },
      {
        id: 'mt-grp-next',
        companyId: null,
        department: 'director_office',
        kind: 'management',
        title: 'Group management meeting',
        organiser: 'Nurul Huda binti Ismail',
        start: at(addDays(monday, 7), '10:00'),
        end: at(addDays(monday, 7), '11:30'),
        location: 'Director Office, boardroom',
        attendees: ['Fauzan', 'Rosnah binti Abdullah', 'Ahmad Faisal bin Yusof', 'Nurul Huda binti Ismail', 'Aisyah binti Rahman'],
        agenda: '1. Actions from last week\n2. Tenders closing this month\n3. Monthly reports\n4. Collections and overdue clients',
        prep: [...RULES.meetingPrep.value.common, ...RULES.meetingPrep.value.byKind.management].map((label, i) =>
          i < 3 ? { label, done: true, by: 'Nurul Huda binti Ismail', at: at(addDays(monday, 4), '11:00') } : { label, done: false, by: null, at: null },
        ),
        status: 'scheduled',
        minutes: null,
        summary: null,
      },
      {
        id: 'mt-sasa-board',
        companyId: 'co-sasa',
        department: null,
        kind: 'board',
        title: 'Sasa board meeting, Q4',
        organiser: 'Company secretary (Sasa)',
        start: at(addDays(today, 18), '14:30'),
        end: at(addDays(today, 18), '16:30'),
        location: 'Sasa head office',
        attendees: ['Board of directors, Sasa', 'Nor Azlina binti Hashim'],
        agenda: '1. Q3 management accounts\n2. KDN licence renewal\n3. New contracts signed\n4. Any other business',
        status: 'scheduled',
        minutes: null,
        summary: null,
      },
      {
        id: 'mt-arsh-ops',
        companyId: 'co-arsh',
        department: null,
        kind: 'operations',
        title: 'Arrow Shield monthly operations meeting',
        organiser: 'Kenny Lau Chee Wah',
        start: at(addDays(today, -3), '09:30'),
        end: at(addDays(today, -3), '10:30'),
        location: 'Arrow Shield office, Penang',
        attendees: ['Kenny Lau Chee Wah', 'Siti Hajar binti Rosli', 'Regional Operations Manager, north'],
        agenda: '1. No-shows\n2. Patrol gaps\n3. Client complaints',
        status: 'held',
        minutes: {
          text: [
            'No-shows fell to 3 this month from 7.',
            'Two patrol gaps at the condominium site on night shift.',
            'Client asked for a second guard at the loading bay.',
            `Action: Brief night shift on patrol rounds (Site officer, by ${addDays(today, 2)})`,
            `Action: Quote for a second loading bay guard (Siti Hajar binti Rosli, by ${addDays(today, 5)})`,
          ].join('\n'),
          by: 'Siti Hajar binti Rosli',
          at: at(addDays(today, -3), '14:00'),
          file: null,
        },
        summary: null as Meeting['summary'],
      },
      {
        id: 'mt-hr-dept',
        companyId: null,
        department: 'hr',
        kind: 'department',
        title: 'HR monthly meeting',
        organiser: 'PWVSB HR',
        start: at(addDays(today, 4), '15:00'),
        end: at(addDays(today, 4), '16:00'),
        location: 'PWVSB HR, room 2',
        attendees: ['PWVSB HR', 'HR executives of the pilots'],
        agenda: '1. CSG first-year deadlines\n2. KDN vetting backlog',
        status: 'scheduled',
        minutes: null,
        summary: null,
      },
    );
    // The operations meeting's minutes were summarised but the Director Office has not checked the summary yet.
    const ops = ds.meetings.find((m) => m.id === 'mt-arsh-ops')!;
    const opsSum = simpleMinutesReader.summarise(ops.minutes!.text);
    ops.summary = {
      ...opsSum,
      actions: opsSum.actions.map((x) => ({ ...x, done: false })),
      reader: simpleMinutesReader.name,
      at: ops.minutes!.at,
      checkedBy: null,
      checkedAt: null,
    };
  }

  // Tender papers, AI-drafted checklist and checks (Fauzan, 25 Oct 2026): one Sasa government tender has gone through
  // the checklist and the company manager's check and waits for the second check; another has its arahan uploaded and
  // waits for the checklist to be drafted.
  {
    const nowMs = toMs(now);
    const pdf = (title: string) => {
      const body = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 120]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 80>>stream\nBT /F1 12 Tf 20 60 Td (${title}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
      return 'data:application/pdf;base64,' + btoa(body);
    };
    const doc = (t: Tender, name: string, by: string, at: number): string => {
      const data = pdf(`${t.ref} ${name} (test)`);
      const sha256 = sha256Hex(data);
      const id = `doc-${sha256.slice(0, 16)}`;
      ds.evidenceDocs.push({
        id,
        companyId: t.companyId,
        caseId: null,
        followUpId: null,
        tenderId: t.id,
        name,
        mime: 'application/pdf',
        bytes: Math.floor((data.length - data.indexOf(',') - 1) * 0.75),
        sha256,
        data,
        caption: '',
        uploadedBy: by,
        receivedAt: fromMs(at),
      });
      return id;
    };
    const gov = ds.tenders.filter((t) => t.companyId === 'co-sasa' && t.channel === 'GOVERNMENT' && !t.armed);
    const worked = gov.find((t) => t.status === 'preparing' && t.closesOn > today);
    const ae = 'Farah Nadia binti Kamal';
    if (worked) {
      const t0 = nowMs - 6 * 86_400_000;
      worked.papers = [
        { docId: doc(worked, 'Notis tender.pdf', ae, t0), kind: 'IKLAN', name: 'Notis tender.pdf', by: ae, at: fromMs(t0) },
        {
          docId: doc(worked, 'Arahan kepada petender.pdf', ae, t0 + 60_000),
          kind: 'ARAHAN',
          name: 'Arahan kepada petender.pdf',
          by: ae,
          at: fromMs(t0 + 60_000),
        },
        {
          docId: doc(worked, 'Spesifikasi perkhidmatan.pdf', ae, t0 + 120_000),
          kind: 'TEKNIKAL',
          name: 'Spesifikasi perkhidmatan.pdf',
          by: ae,
          at: fromMs(t0 + 120_000),
        },
      ];
      worked.checklist = sampleTenderReader.draft(worked, []).map((d, i) => ({ id: `ai-${i + 1}`, ...d, source: 'ai' as const }));
      worked.checklist.push({
        id: 'doa-1',
        label: 'Original bid in a sealed envelope to the tender box',
        detail: 'Hand delivery only, before 12 noon on the closing day.',
        ref: 'Arahan para 14',
        source: 'doa',
        needsDocument: false,
      });
      worked.checklistReview = {
        by: 'Nurul Huda binti Ismail',
        at: fromMs(t0 + 3_600_000),
        note: 'Checked against the arahan; added the tender box rule.',
        reader: sampleTenderReader.name,
      };
      const steps = [...TENDER_GUIDE_V1.filter((x) => !x.auto).map((x) => ({ id: x.id, label: x.label, needsDocument: x.needsDocument })), ...worked.checklist];
      worked.protocolDone = steps.map((x, i) => {
        const at = t0 + (i + 2) * 600_000;
        if (x.id === 'g02_07')
          return {
            stepId: x.id,
            version: 1,
            by: ae,
            at: fromMs(at),
            note: 'Notis tidak menyenaraikan taklimat atau lawatan tapak',
            proofIds: [],
            status: 'na' as const,
            ref: 'Notis tender',
            naConfirmedBy: 'Nor Azlina binti Hashim',
            naConfirmedAt: fromMs(at + 3_600_000),
          };
        const by = x.id === 'g04_09' ? 'Nor Azlina binti Hashim' : ae;
        return {
          stepId: x.id,
          version: 1,
          by,
          at: fromMs(at),
          note: x.id === 'g04_09' ? 'Harga versi 2 diluluskan' : 'Done',
          proofIds: x.needsDocument ? [doc(worked, `${x.label}.pdf`, by, at)] : [],
          status: 'done' as const,
        };
      });
      // Fauzan, 28 Oct 2026: each file under the name the tender asks for; no company name in the technical part.
      worked.bidFiles = (
        [
          ['bf-tek', 'TEKNIKAL', 'Dokumen Teknikal.pdf'],
          ['bf-kew', 'KEWANGAN', 'Dokumen Kewangan.pdf'],
          ['bf-hrg', 'HARGA', 'Jadual Harga.pdf'],
        ] as const
      ).map(([id, part, required], i) => {
        const at = t0 + (40 + i) * 600_000;
        return {
          id,
          part,
          required,
          docId: doc(worked, required, ae, at),
          by: ae,
          at: fromMs(at),
          scan: { readText: true, where: [] },
          ...(part === 'TEKNIKAL' ? { confirmedBy: ae, confirmedAt: fromMs(at + 300_000) } : {}),
        };
      });
      worked.decision = { choice: 'TERUSKAN', reason: 'Layak; MOF dan KDN sah hingga tarikh tutup', by: 'Nor Azlina binti Hashim', at: fromMs(t0 + 1_800_000) };
      worked.verifications = [
        {
          level: 'PREPARER',
          userId: 'u-ae-sasa',
          by: ae,
          at: fromMs(nowMs - 22 * 3_600_000),
          note: 'All items done by the guide.',
        },
        {
          level: 'MANAGER',
          userId: 'u-cm-sasa',
          by: 'Nor Azlina binti Hashim',
          at: fromMs(nowMs - 20 * 3_600_000),
          note: 'All verified by the guidelines.',
        },
      ];
    }
    const fresh = gov.find((t) => t.status === 'open' && t.closesOn > today);
    if (fresh) {
      const t0 = nowMs - 26 * 3_600_000;
      fresh.papers = [{ docId: doc(fresh, 'Arahan kepada petender.pdf', ae, t0), kind: 'ARAHAN', name: 'Arahan kepada petender.pdf', by: ae, at: fromMs(t0) }];
    }
    // The real JKR tender from the Director Office's checklist V2.0 (11 Oct 2026), with Sasa as the test bidder.
    // The JKR officer's name and contact in the PDF are left out of the app.
    if (today <= '2026-10-31') {
      const t0 = toMs(myt('2026-10-11', '15:00'));
      const doa = 'Nurul Huda binti Ismail';
      const cm = 'Nor Azlina binti Hashim';
      const jkr: Tender = {
        id: 'td-sasa-jkr',
        companyId: 'co-sasa',
        ref: 'QT260000000027957',
        title: 'Perkhidmatan kawalan keselamatan Blok A-F, Ibu Pejabat JKR Malaysia, Kuala Lumpur',
        buyer: 'Cawangan Senggara Fasiliti Bangunan JKR / Kementerian Kerja Raya',
        channel: 'GOVERNMENT',
        source: 'ePerolehan',
        owner: 'Director Office Administrator',
        closesOn: '2026-10-31',
        guards: 16,
        sites: 1,
        status: 'open',
        estMonthly: 66666.65,
        record: {
          adOn: '2026-10-10',
          officialLink: 'https://www.eperolehan.gov.my/web/epapp/notice-board',
          closesAt: '12:00',
          briefing: { on: null, mandatory: false, place: '', outcome: 'Tiada taklimat atau lawatan tapak dalam notis semasa' },
          siteVisit: null,
          docsBy: null,
          queriesBy: '2026-10-30',
          submissionMethod: 'ePerolehan, dalam talian; simpan pengesahan transaksi dan masa',
          validityDays: 270,
          contractMonths: 60,
          contractStart: '2027-02-01',
          contractEnd: '2032-01-31',
          extension: '',
          indicativeTotal: 3999999,
          indicativeSource: 'Harga Indikatif Jabatan hlm. 1 (anggaran jabatan, bukan harga diluluskan)',
          sstIncluded: false,
          priceUnit: 'Hours (jam); 12 jam sehari, 30.5 hari sebulan',
          mofCodes: ['220801'],
          kdnArea: 'Kuala Lumpur',
          bumiputeraOnly: false,
          locality: 'Terbuka, semua negeri',
          dayPosts: 10,
          nightPosts: 6,
          shiftHours: 12,
          fees: 'Fi eP 0.4% setiap invois, had RM4,800 bagi invois RM1.2 juta atau lebih',
          priceLines: [
            { item: 'Insurans pampasan pekerja', monthly: 998.25, months: 60 },
            { item: 'Laporan bulanan', monthly: 280, months: 60 },
            { item: 'Kelengkapan, peralatan, fasiliti pejabat', monthly: 1800, months: 60 },
            { item: 'Sewaan pejabat / Pondok Pengawal 1', monthly: 490, months: 60 },
            { item: 'Ketua pengawal, 1 posisi', monthly: 4392, months: 60 },
            { item: 'Penolong ketua, 1 posisi', monthly: 4392, months: 60 },
            { item: 'Pengawal siang, 9 posisi', monthly: 34916.4, months: 60 },
            { item: 'Pengawal malam, 5 posisi', monthly: 19398, months: 60 },
          ],
        },
        decision: {
          choice: 'TERUSKAN',
          reason: 'Bida atas nama Sasa (syarikat ujian); jawapan JKR diperlukan sebelum harga akhir',
          by: cm,
          at: fromMs(t0 + 3_600_000),
        },
        queries: JKR_QUERIES.map(([text, ref], i) => ({
          id: `q-${i + 1}`,
          text,
          ref,
          by: doa,
          at: fromMs(t0 + 1_800_000),
          status: 'open' as const,
          answer: '',
        })),
        checklist: JKR_CHECKLIST.map((c, i) => ({ id: `jkr-${i + 1}`, ...c, source: 'ai' as const })),
        checklistReview: null,
        plan: [
          { stepId: 'g02_02', pic: ae, due: '2026-10-27' },
          { stepId: 'g02_06', pic: ae, due: '2026-10-27' },
          { stepId: 'g04_09', pic: cm, due: '2026-10-29' },
        ],
      };
      jkr.papers = [
        ['IKLAN', 'S1 Notis dan Kenyataan Tawaran.pdf'],
        ['ARAHAN', 'S2 Syarat Am, Arahan dan Terma Kontrak.pdf'],
        ['TEKNIKAL', 'S3 Spesifikasi dan Jadual Kekerapan.pdf'],
        ['TEKNIKAL', 'S4 Senarai Semak Teknikal.pdf'],
        ['KEWANGAN', 'S4 Senarai Semak Kewangan.pdf'],
        ['KEWANGAN', 'S5 Sampel Surat Akuan Pembida.pdf'],
        ['HARGA', 'S6 Harga Indikatif Jabatan.pdf'],
      ].map(([kind, name], i) => ({ docId: doc(jkr, name, doa, t0 + i * 60_000), kind: kind as TenderPaperKind, name, by: doa, at: fromMs(t0 + i * 60_000) }));
      const at = fromMs(t0 + 2 * 3_600_000);
      jkr.protocolDone = [
        {
          stepId: 'g02_01',
          version: 1,
          by: ae,
          at,
          note: 'Set papan notis eP dimuat turun 11 Okt; Jadual 1-8 belum tersedia',
          proofIds: [],
          status: 'done',
          ref: 'S1-S6',
        },
        { stepId: 'g02_03', version: 1, by: ae, at, note: 'Kod 220801 sah', proofIds: [], status: 'done', ref: 'Notis S1' },
        { stepId: 'g02_05', version: 1, by: ae, at, note: 'Terbuka, semua negeri; tiada sekatan', proofIds: [], status: 'done', ref: 'Notis S1' },
        {
          stepId: 'g02_07',
          version: 1,
          by: ae,
          at,
          note: 'Tiada taklimat atau lawatan tapak dalam notis semasa',
          proofIds: [],
          status: 'na',
          ref: 'Notis S1',
          naConfirmedBy: null,
          naConfirmedAt: null,
        },
      ];
      ds.tenders.push(jkr);
    }
  }

  // Staff clock (Fauzan, 26 Oct 2026): every staff member clocks in on their own phone. Office staff have a base;
  // officers and operations managers move between sites and have none. Mock office locations.
  {
    const PWVSB_OFFICE = { name: 'PWVSB office, Kuala Lumpur (mock)', lat: 3.1579, lng: 101.7116, radiusM: 200 };
    const OFFICE: Record<string, { name: string; lat: number; lng: number; radiusM: number }> = {
      'co-sasa': { name: 'Sasa office, Shah Alam (mock)', lat: 3.0738, lng: 101.5183, radiusM: 200 },
      'co-arsh': { name: 'Arrow Shield office, Petaling Jaya (mock)', lat: 3.1073, lng: 101.6067, radiusM: 200 },
      'co-inas': { name: 'Inas office, Subang Jaya (mock)', lat: 3.0567, lng: 101.5851, radiusM: 200 },
    };
    const MOBILE = new Set(['patrol', 'om', 'regional', 'ogm', 'ops_director']);
    for (const u of ds.users) {
      if (u.role === 'guard' || u.role === 'site_device' || u.role === 'supervisor' || MOBILE.has(u.opsTier ?? '')) continue;
      if (u.role === 'director' || u.role === 'pwvsb_officer') u.base = PWVSB_OFFICE;
      else if (OFFICE[u.companyIds[0]]) u.base = OFFICE[u.companyIds[0]];
    }
    const nowMs = toMs(now);
    const shot = (lat: number | null, lng: number | null, at: number, extra: Partial<StaffClock['in']> = {}): StaffClock['in'] => ({
      image: '',
      sha256: sha256Hex(`test-${at}`),
      capturedAt: fromMs(at - 4_000),
      receivedAt: fromMs(at),
      lat,
      lng,
      accuracyM: lat === null ? null : 12,
      distanceM: null,
      face: null,
      source: 'test_picture',
      ...extra,
    });
    // gapFrom: minutes before now when the phone stopped reporting.
    const clockIn = (userId: string, startMin: number, opts: { away?: number; gapFrom?: number; out?: number } = {}) => {
      const u = ds.users.find((x) => x.id === userId);
      if (!u) return;
      const start = toMs(myt(today, '00:00')) + startMin * 60_000;
      if (start > nowMs) return;
      const b = u.base ?? { lat: 3.1, lng: 101.6, radiusM: 0 };
      const off = (opts.away ?? 0) / 111_000;
      const companyId = u.role === 'director' || u.role === 'pwvsb_officer' ? null : (u.homeCompanyId ?? u.companyIds[0] ?? null);
      const id = `sc-${u.id}-${start}`;
      const inShot = shot(b.lat + 0.0001 + off, b.lng, start, { distanceM: u.base ? 12 + (opts.away ?? 0) : null });
      const end = opts.out ? Math.min(nowMs, toMs(myt(today, '00:00')) + opts.out * 60_000) : nowMs;
      let last: number | null = null;
      let n = 0;
      for (let t = start + 10 * 60_000; t <= end; t += 10 * 60_000) {
        if (opts.gapFrom !== undefined && t >= nowMs - opts.gapFrom * 60_000) break;
        ds.locationPings.push({
          id: `lp-${u.id}-${t}`,
          clockId: id,
          userId: u.id,
          companyId,
          capturedAt: fromMs(t - 3_000),
          receivedAt: fromMs(t),
          lat: b.lat + off + 0.0002 * Math.sin(n),
          lng: b.lng + 0.0002 * Math.cos(n),
          accuracyM: 15,
          distanceM: u.base ? 20 + (opts.away ?? 0) : null,
        });
        last = t;
        n++;
      }
      const flags: StaffClockFlag[] = ['PHOTO_ONLY'];
      if (u.base && (opts.away ?? 0) > u.base.radiusM) flags.push('AWAY_FROM_BASE');
      ds.staffClocks.push({
        id,
        userId: u.id,
        userName: u.name,
        companyId,
        in: inShot,
        out: opts.out && toMs(myt(today, '00:00')) + opts.out * 60_000 <= nowMs ? shot(b.lat, b.lng, end, { distanceM: u.base ? 10 : null }) : null,
        flags,
        lastPingAt: last ? fromMs(last) : inShot.receivedAt,
        pings: n,
      });
    };
    clockIn('u-cm-sasa', 8 * 60 + 31);
    clockIn('u-pwvsb-doa', 8 * 60 + 45);
    clockIn('u-pwvsb-hr', 8 * 60 + 52);
    // Phone stopped reporting 45 minutes ago: shows as Unknown, not as fine.
    clockIn('u-cm-arsh', 8 * 60 + 40, { gapFrom: 45 });
    // Clocked in 1.5 km from the office.
    clockIn('u-ae-arsh', 8 * 60 + 58, { away: 1500 });
    clockIn('u-rom-central', 7 * 60 + 50);
    // Office door readings (Fauzan, 27 Oct 2026; mock feed through CMS). Everyone clocked in today came in by the door.
    const door = (u: User, direction: 'in' | 'out', ms: number) =>
      ds.doorEvents.push({
        id: `door-${u.id}-${ms}-${direction}`,
        userId: u.id,
        userName: u.name,
        companyId: u.role === 'director' || u.role === 'pwvsb_officer' ? null : (u.homeCompanyId ?? u.companyIds[0] ?? null),
        door: u.base?.name ? `${u.base.name}, main door` : 'Office main door',
        direction,
        at: fromMs(ms),
        receivedAt: fromMs(ms + 5_000),
      });
    for (const c of ds.staffClocks) {
      const u = ds.users.find((x) => x.id === c.userId)!;
      door(u, 'in', toMs(c.in.receivedAt) - 4 * 60_000);
    }
    // Sasa's manager left the office 50 minutes ago and is still signed in: CMS and HR see it.
    const cmSasa = ds.users.find((x) => x.id === 'u-cm-sasa');
    if (cmSasa && nowMs - 50 * 60_000 > toMs(myt(today, '09:00'))) door(cmSasa, 'out', nowMs - 50 * 60_000);
    // The Procurement Executive never signed out yesterday; the door shows they left at 17:52. Their next sign-in
    // closes yesterday's clock at that time.
    const proc = ds.users.find((x) => x.id === 'u-proc-exec');
    if (proc) {
      const y = addDays(today, -1);
      const start = toMs(myt(y, '08:41'));
      ds.staffClocks.push({
        id: `sc-${proc.id}-${start}`,
        userId: proc.id,
        userName: proc.name,
        companyId: null,
        in: { ...shot(3.1, 101.6, start), image: '', lat: null, lng: null, distanceM: null, source: 'login' },
        out: null,
        flags: [],
        lastPingAt: null,
        pings: 0,
        mode: 'login',
      });
      door(proc, 'in', start - 3 * 60_000);
      door(proc, 'out', toMs(myt(y, '12:58')));
      door(proc, 'in', toMs(myt(y, '13:55')));
      door(proc, 'out', toMs(myt(y, '17:52')));
    }
  }

  // Mock EPF, SOCSO and income tax numbers for office staff (2 Nov 2026), so the contribution files have them. Not real.
  {
    const nrng = new Rng(MASTER_SEED + 137);
    for (const p of ds.people.filter((x) => x.role === 'office')) {
      p.epfNo ??= String(nrng.int(10000000, 99999999));
      p.socsoNo ??= p.nationality === 'MY' ? `${p.idMasked.replace(/\D/g, '').slice(0, 6)}${nrng.int(100000, 999999)}` : `F${nrng.int(10000000, 99999999)}`;
      p.taxNo ??= `IG${nrng.int(10000000000, 99999999999)}`;
    }
  }

  // SOCSO claims (Fauzan, 26 Oct 2026). Mock SOCSO numbers and LINDUNG status for the pilots; one Sasa guard's work
  // accident reported to PERKESO with MCs on file, one Arrow Shield commuting accident not yet reported (Form 34 due).
  {
    const srng = new Rng(MASTER_SEED + 131);
    const pilot = new Set(['co-sasa', 'co-arsh', 'co-inas']);
    let optedOut = false;
    for (const p of ds.people.filter((x) => pilot.has(x.companyId))) {
      p.socsoNo = p.nationality === 'MY' ? `${p.idMasked.replace(/\D/g, '').slice(0, 6)}${srng.int(100000, 999999)}` : `F${srng.int(10000000, 99999999)}`;
      if (p.nationality === 'MY') {
        p.lindungOptOut = !optedOut && p.companyId === 'co-sasa' && p.role === 'guard' && srng.chance(0.3);
        if (p.lindungOptOut) optedOut = true;
      }
    }
    const nowMs = toMs(now);
    const guardUser = ds.users.find((u) => u.id === 'u-guard-sasa-1');
    const sasaGuard = ds.people.find((p) => p.id === guardUser?.personId);
    if (sasaGuard) {
      const incident = nowMs - 2 * 86_400_000 - 5 * 3_600_000;
      const told = incident + 40 * 60_000;
      const by = 'Nor Azlina binti Hashim';
      const d1 = dateOf(fromMs(incident));
      const pdf = (t: string) => 'data:application/pdf;base64,' + btoa(`%PDF-1.1 ${t} (test)`);
      const doc = (name: string, at: number) => {
        const data = pdf(`${sasaGuard.staffNo} ${name}`);
        const sha256 = sha256Hex(data);
        const id = `doc-${sha256.slice(0, 16)}`;
        ds.evidenceDocs.push({
          id,
          companyId: sasaGuard.companyId,
          caseId: null,
          followUpId: null,
          socsoId: `sk-${sasaGuard.id}-seed`,
          name,
          mime: 'application/pdf',
          bytes: data.length,
          sha256,
          data,
          caption: name,
          uploadedBy: by,
          receivedAt: fromMs(at),
        });
        return id;
      };
      const reported = told + 20 * 3_600_000;
      ds.socsoClaims.push({
        id: `sk-${sasaGuard.id}-seed`,
        companyId: sasaGuard.companyId,
        personId: sasaGuard.id,
        type: 'WORK_ACCIDENT',
        status: 'REPORTED',
        incidentAt: fromMs(incident),
        toldAt: fromMs(told),
        place: 'Guardhouse steps, main gate',
        description: 'Slipped on the wet guardhouse steps during the night round and hurt the left ankle. Sent to the panel clinic.',
        witnesses: 'Relief guard on the same shift',
        caseId: null,
        openedBy: by,
        openedAt: fromMs(told + 30 * 60_000),
        perkesoRef: 'ASSIST-TEST-0001',
        reportedAt: fromMs(reported),
        docs: [
          { item: 'FORM34', docIds: [doc('Form 34 (test).pdf', reported)], by, at: fromMs(reported) },
          { item: 'INCIDENT', docIds: [doc('Incident report (test).pdf', told + 3_600_000)], by, at: fromMs(told + 3_600_000) },
          { item: 'MC', docIds: [doc('MC panel clinic (test).pdf', reported)], by, at: fromMs(reported) },
        ],
        overrides: [],
        mcs: [{ from: d1, to: addDays(d1, 4), docId: null }],
        decision: null,
        amountPaid: null,
        returnToWork: null,
        closedAt: null,
        history: [
          { at: fromMs(told + 30 * 60_000), by, what: 'Claim started: Work accident' },
          { at: fromMs(told + 3_600_000), by, what: 'Incident report from the site added' },
          { at: fromMs(reported), by, what: 'Form 34 submitted in ASSIST, reference ASSIST-TEST-0001' },
          { at: fromMs(reported), by, what: `Every medical certificate added (${d1} to ${addDays(d1, 4)})`, medical: true },
          { at: fromMs(reported), by, what: `Work restriction: No patrol posts from ${d1}` },
        ],
        // Mock rehabilitation record: the clinic note keeps the guard off patrol posts until HR clears it.
        rehab: {
          rtwRequestedOn: null,
          referralOn: null,
          caseManager: null,
          plan: '',
          targetReturn: addDays(d1, 5),
          appointments: [{ id: 'ap-seed-1', at: `${addDays(d1, 4)}T10:00:00+08:00`, what: 'Panel clinic review of the ankle', by }],
          restrictions: [
            {
              id: 'rs-seed-1',
              kind: 'NO_PATROL',
              note: 'Clinic note: no walking rounds for 2 weeks',
              from: d1,
              until: addDays(d1, 14),
              setBy: by,
              setAt: fromMs(reported),
              clearedBy: null,
              clearedAt: null,
              clearNote: null,
            },
          ],
          checkIns: [],
        },
      });
    }
    const arshGuard = ds.people.find((p) => p.companyId === 'co-arsh' && p.nationality === 'NP' && p.role === 'guard');
    if (arshGuard) {
      const incident = nowMs - 31 * 3_600_000;
      const by = 'Siti Hajar binti Rosli';
      ds.socsoClaims.push({
        id: `sk-${arshGuard.id}-seed`,
        companyId: arshGuard.companyId,
        personId: arshGuard.id,
        type: 'COMMUTING',
        status: 'DRAFT',
        incidentAt: fromMs(incident),
        toldAt: fromMs(incident + 3_600_000),
        place: 'Jalan Templer, on the way to the site',
        description: 'Motorcycle skidded on the direct route from the hostel to the site before the morning shift. Grazes and a wrist injury.',
        witnesses: '',
        caseId: null,
        openedBy: by,
        openedAt: fromMs(incident + 2 * 3_600_000),
        perkesoRef: null,
        reportedAt: null,
        docs: [],
        overrides: [],
        mcs: [],
        decision: null,
        amountPaid: null,
        returnToWork: null,
        closedAt: null,
        history: [{ at: fromMs(incident + 2 * 3_600_000), by, what: 'Claim started: Commuting accident' }],
      });
    }
  }

  // Foreign Worker Management (Fauzan, 26 Oct 2026): one PLKS renewal submitted with its receipt, and tasks to the
  // area OM: one FOMEMA check waiting, one TNG training done with proof waiting for FWM to check.
  {
    const nowMs = toMs(now);
    const np = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status === 'active');
    const plks = (p: Person) =>
      ds.credentials.filter((c) => c.personId === p.id && c.type === 'PLKS_PERMIT').sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))[0];
    const doc = (owner: Person, ref: string, name: string, at: number, by: string) => {
      const data = 'data:application/pdf;base64,' + btoa(`%PDF-1.1 ${owner.staffNo} ${name} (test)`);
      const sha256 = sha256Hex(data);
      const id = `doc-${sha256.slice(0, 16)}`;
      ds.evidenceDocs.push({
        id,
        companyId: owner.companyId,
        caseId: null,
        followUpId: null,
        fwmId: ref,
        name,
        mime: 'application/pdf',
        bytes: data.length,
        sha256,
        data,
        caption: name,
        uploadedBy: by,
        receivedAt: fromMs(at),
      });
      return id;
    };
    const near = np.filter((p) => plks(p)?.expiresOn).sort((a, b) => plks(a).expiresOn!.localeCompare(plks(b).expiresOn!));
    const renewed = near.find((p) => daysBetween(today, plks(p).expiresOn!) >= 0 && daysBetween(today, plks(p).expiresOn!) <= 60);
    if (renewed) {
      const c = plks(renewed);
      const id = `fwr-${renewed.id}-plks_permit-${c.expiresOn}`;
      ds.fwRenewals.push({
        id,
        companyId: renewed.companyId,
        personId: renewed.id,
        paper: 'PLKS_PERMIT',
        expiresOn: c.expiresOn!,
        submittedOn: addDays(today, -2),
        channel: 'FWCMS',
        receiptDocIds: [doc(renewed, id, 'FWCMS renewal slip (test).pdf', nowMs - 2 * 86_400_000, 'Prakash a/l Raman')],
        note: 'Levy paid, KDN letter attached',
        by: 'Prakash a/l Raman',
        at: fromMs(nowMs - 2 * 86_400_000),
      });
    }
    const [a, b] = np.filter((p) => p !== renewed);
    const task = (p: Person, n: number, kind: FwmTask['kind'], what: string, place: string, dueOn: string, done: boolean): FwmTask => {
      const id = `fwt-${p.id}-seed-${n}`;
      const created = nowMs - (done ? 6 : 1) * 86_400_000;
      const state = ds.branches.find((x) => x.id === p.branchId)?.state ?? '';
      const om = ds.users.find((u) => u.opsTier === 'om' && u.areaStates?.includes(state)) ?? null;
      return {
        id,
        companyId: p.companyId,
        personId: p.id,
        kind,
        what,
        place,
        dueOn,
        omUserId: om?.id ?? null,
        createdBy: 'Farah Hanim binti Zakaria',
        createdAt: fromMs(created),
        status: done ? 'done' : 'open',
        proofIds: done ? [doc(p, id, 'TNG attendance sheet (test).pdf', nowMs - 86_400_000, om?.name ?? 'Nor Azlina binti Hashim')] : [],
        doneNote: done ? 'Attended both days' : null,
        doneBy: done ? (om?.name ?? 'Nor Azlina binti Hashim') : null,
        doneAt: done ? fromMs(nowMs - 86_400_000) : null,
        reviewNote: null,
        reviewedBy: null,
        reviewedAt: null,
      };
    };
    if (a)
      ds.fwmTasks.push(
        task(a, 1, 'FOMEMA', 'Bring the guard for the FOMEMA medical before the PLKS renewal', 'FOMEMA panel clinic, Klang', addDays(today, 5), false),
      );
    if (b) ds.fwmTasks.push(task(b, 2, 'TNG', 'Release the guard for the 2-day TNG training', 'PWVSB training room, Shah Alam', addDays(today, -1), true));
  }

  // ----- Hostel, bills and utility excess (Fauzan, 26 Oct 2026; mock) -----
  {
    const residents = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status === 'active').slice(0, 8);
    if (residents.length) {
      const nowMs = toMs(now);
      const month = (k: number) => addDays(`${today.slice(0, 7)}-15`, -30 * k).slice(0, 7);
      const hostel = {
        id: 'hs-sasa-klang',
        companyId: 'co-sasa',
        name: 'Asrama Sasa Klang (mock)',
        address: 'Jalan Kapar, Klang',
        beds: 12,
        tenure: 'RENTED' as const,
        sector: 'private' as const,
      };
      ds.hostels.push(hostel);
      const since = `${month(4)}-01`;
      for (const p of residents)
        ds.hostelStays.push({ id: `hst-${p.id}`, companyId: 'co-sasa', hostelId: hostel.id, personId: p.id, personName: p.name, from: since, to: null });
      const docOf = (billId: string, name: string, at: number) => {
        const data = 'data:application/pdf;base64,' + btoa(`%PDF-1.1 ${billId} ${name} (test)`);
        const sha256 = sha256Hex(data);
        const id = `doc-${sha256.slice(0, 16)}`;
        ds.evidenceDocs.push({
          id,
          companyId: 'co-sasa',
          caseId: null,
          followUpId: null,
          hostelBillId: billId,
          name,
          mime: 'application/pdf',
          bytes: data.length,
          sha256,
          data,
          caption: name,
          uploadedBy: 'Nor Azlina binti Hashim',
          receivedAt: fromMs(at),
        });
        return id;
      };
      const step = (userId: string, by: string, daysAgo: number, note = '') => ({ userId, by, at: fromMs(nowMs - daysAgo * 86_400_000), note });
      const full = (status: HostelBill['status'], daysAgo: number) => {
        const order: HostelBill['status'][] = ['requested', 'fwm_checked', 'sector_approved', 'coo_approved', 'paid'];
        const n = order.indexOf(status);
        return {
          request: n >= 0 ? step('u-cm-sasa', 'Nor Azlina binti Hashim', daysAgo + 6, 'Monthly bill') : null,
          fwmCheck: n >= 1 ? step('u-fwm-ex1', 'Farah Hanim binti Zakaria', daysAgo + 5, 'Hostel, month, beds and amount match') : null,
          sectorApproval: n >= 2 ? step('u-opsdir', 'Leong Kah Meng', daysAgo + 4) : null,
          cooApproval: n >= 3 ? step('u-coo', 'Ahmad Faisal bin Zainal', daysAgo + 3) : null,
        };
      };
      const bill = (kind: HostelBill['kind'], k: number, amount: number, status: HostelBill['status'], dueOn: string) => {
        const id = `hb-${hostel.id}-${kind.toLowerCase()}-${month(k)}`;
        const at = nowMs - (k * 30 + 2) * 86_400_000;
        const b: HostelBill = {
          id,
          companyId: 'co-sasa',
          hostelId: hostel.id,
          kind,
          period: month(k),
          amount,
          dueOn,
          status,
          billDocIds: [docOf(id, `${kind.toLowerCase()} bill ${month(k)} (test).pdf`, at)],
          ...full(status, Math.max(0, k * 30 - 20)),
          slip:
            status === 'paid'
              ? {
                  ...step('u-cm-sasa', 'Nor Azlina binti Hashim', Math.max(0, k * 30 - 22), 'Paid by online transfer'),
                  docIds: [docOf(id, `payment slip ${month(k)} (test).pdf`, at + 86_400_000)],
                }
              : null,
          returned: null,
          createdBy: 'Nor Azlina binti Hashim',
          createdAt: fromMs(at),
        };
        ds.hostelBills.push(b);
        return b;
      };
      for (const k of [3, 2]) bill('RENT', k, 3200, 'paid', `${month(k)}-07`);
      bill('RENT', 1, 3200, 'coo_approved', `${month(1)}-28`);
      bill('RENT', 0, 3200, 'due', addDays(today, 7));
      bill('WATER', 1, 150.0, 'requested', addDays(today, 3));
      // Electricity above RM30 a head: the excess is shared by bed-days, one charge per resident.
      const shareOut = (b: HostelBill, count: number, decided: boolean) => {
        const allowance = RULES.utilityAllowance.value.electricity * residents.length;
        const excess = Math.round((b.amount - allowance) * 100) / 100;
        const days = daysBetween(`${b.period}-01`, addDays(`${b.period}-28`, 4).slice(0, 7) + '-01');
        for (const p of residents)
          ds.utilityCharges.push({
            id: `uc-${b.id}-${p.id}`,
            companyId: 'co-sasa',
            personId: p.id,
            personName: p.name,
            hostelId: hostel.id,
            billId: b.id,
            kind: 'ELECTRICITY',
            period: b.period,
            bedDays: days,
            totalBedDays: days * residents.length,
            excess,
            share: Math.round((excess / residents.length) * 100) / 100,
            count,
            decision: decided ? 'NOTICE' : null,
            decidedBy: decided ? 'PWVSB HR' : null,
            decidedAt: decided ? b.createdAt : null,
            payrollMonth: null,
            noticeAck: decided ? { by: 'Farah Hanim binti Zakaria', at: b.createdAt } : null,
          });
      };
      shareOut(bill('ELECTRICITY', 3, 296.0, 'paid', `${month(3)}-20`), 1, true);
      shareOut(bill('ELECTRICITY', 2, 284.5, 'paid', `${month(2)}-20`), 2, true);
      shareOut(bill('ELECTRICITY', 1, 312.4, 'fwm_checked', addDays(today, 5)), 3, false);
      // Two workers' contracts already carry the utility clause, with the signed page on file.
      for (const p of residents.slice(0, 2)) {
        const docId = docOf(`clause-${p.id}`, `Contract utility clause ${p.staffNo} (test).pdf`, nowMs - 40 * 86_400_000);
        p.utilityClause = { docId, by: 'Farah Hanim binti Zakaria', at: fromMs(nowMs - 40 * 86_400_000) };
        p.utilityAck = { docId, by: 'Farah Hanim binti Zakaria', at: fromMs(nowMs - 40 * 86_400_000) };
      }
    }
  }

  // ----- Memos (Fauzan, 26 Oct 2026; mock): the Chief of Staff to all staff, the COO to all guards and officers -----
  ds.memos.push(
    {
      id: 'memo-seed-staff-1',
      audience: 'STAFF',
      title: 'Office hours during the year-end closing',
      body: 'All staff please submit claims for this month by the 25th so HR can close the month. Mileage claims use the rate published for the month of travel.',
      publishedBy: 'Aisyah binti Rahman',
      publishedById: 'u-cos',
      publishedAt: fromMs(toMs(now) - 2 * 86_400_000),
      reads: [{ userId: 'u-pwvsb-hr', name: 'PWVSB HR', at: fromMs(toMs(now) - 86_400_000) }],
    },
    {
      id: 'memo-seed-field-1',
      audience: 'FIELD',
      title: 'Uniform and post inspection this week',
      body: 'Patrolling officers will inspect uniforms and post books at every site this week. Keep your licence card with you on duty.',
      publishedBy: 'Ahmad Faisal bin Zainal',
      publishedById: 'u-coo',
      publishedAt: fromMs(toMs(now) - 86_400_000),
      reads: [],
    },
  );

  // ----- PDPA cases (Fauzan, 26 Oct 2026; mock): a breach due to the Commissioner today, a client consent, a post -----
  {
    const nowMs = toMs(now);
    const at = (h: number) => fromMs(nowMs - h * 3_600_000);
    ds.pdpaCases.push(
      {
        id: 'pdpa-seed-breach-1',
        kind: 'BREACH',
        companyId: 'co-sasa',
        title: 'Guard roster with IC numbers sent to the wrong WhatsApp group',
        detail: 'A site roster listing 14 guards with IC numbers was posted to a client group chat by mistake. The message was deleted after 20 minutes.',
        openedBy: 'Siti Mariam binti Osman',
        openedAt: at(50),
        status: 'open',
        steps: [{ at: at(49), by: 'Siti Mariam binti Osman', what: 'Contained: message deleted, group admin asked to clear copies.', docId: null }],
        breach: { detectedAt: at(52), affected: 14, significantHarm: true, commissionerAt: null, subjectsAt: null, contained: true },
      },
      {
        id: 'pdpa-seed-consent-1',
        kind: 'CLIENT_CONSENT',
        companyId: 'co-arsh',
        title: 'Body cameras for guards at the client site',
        detail: 'Guards would record video at the entrance. The client must agree and put up notices before use.',
        openedBy: 'Siti Mariam binti Osman',
        openedAt: at(72),
        status: 'open',
        steps: [{ at: at(70), by: 'Siti Mariam binti Osman', what: 'Advised the client on notices, retention and access.', docId: null }],
        consent: { client: 'Mock client (Arrow Shield site)', product: 'Body cameras', advisedAt: at(70), decision: 'pending', decidedAt: null },
      },
      {
        id: 'pdpa-seed-social-1',
        kind: 'SOCIAL',
        companyId: 'co-inas',
        title: "Facebook post showing a guard's face and name at a post",
        detail: 'A public post complains about a guard and shows his face and name tag. Ask for removal and reply on the page.',
        openedBy: 'Siti Mariam binti Osman',
        openedAt: at(6),
        status: 'open',
        steps: [],
        social: { platform: 'Facebook', link: 'https://example.com/mock-post', risk: 'medium' },
      },
    );
  }

  // ----- Operation claims and office requests (Fauzan, 26 Oct 2026; mock) -----
  {
    const nowMs = toMs(now);
    const ago = (h: number) => fromMs(nowMs - h * 3_600_000);
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const om = ds.users.find((u) => u.id === 'u-om-klang');
    const cm = ds.users.find((u) => u.id === 'u-cm-sasa');
    const base = { docIds: ['seed-receipts'], cosApproval: null, cooDecision: null, returned: null };
    if (om)
      ds.expenseRequests.push(
        {
          ...base,
          id: `ex-ops-${prev}-1`,
          kind: 'OPS_CLAIM',
          companyId: 'co-sasa',
          period: prev,
          category: null,
          lines: [
            { item: 'Patrol fuel', amount: 1240, note: 'Two patrol cars' },
            { item: 'Toll', amount: 186.4, note: '' },
            { item: 'Officer phone allowance', amount: 300, note: '6 officers' },
          ],
          total: 1726.4,
          userId: om.id,
          requestedBy: om.name,
          createdAt: ago(240),
          status: 'submitted',
          submittedAt: ago(30),
        },
        {
          ...base,
          id: `ex-ops-${today.slice(0, 7)}-2`,
          kind: 'OPS_CLAIM',
          companyId: 'co-sasa',
          period: today.slice(0, 7),
          category: null,
          lines: [{ item: 'Patrol fuel', amount: 610, note: 'To date' }],
          total: 610,
          userId: om.id,
          requestedBy: om.name,
          createdAt: ago(100),
          status: 'draft',
          submittedAt: null,
        },
      );
    if (cm)
      ds.expenseRequests.push({
        ...base,
        id: `ex-off-${today.slice(0, 7)}-3`,
        kind: 'OFFICE',
        companyId: 'co-sasa',
        period: today.slice(0, 7),
        category: 'SUPPLIES',
        lines: [
          { item: 'A4 paper (10 reams)', amount: 135, note: '' },
          { item: 'Box files and pens', amount: 88.5, note: '' },
        ],
        total: 223.5,
        userId: cm.id,
        requestedBy: cm.name,
        createdAt: ago(20),
        status: 'submitted',
        submittedAt: ago(20),
      });
  }

  // ----- Client board (Fauzan, 26 Oct 2026; mock): one account per pilot client, a spread of states -----
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const pilotSites = ds.sites.filter((x) => ['co-sasa', 'co-arsh', 'co-inas'].includes(x.companyId));
    const byClient = new Map<string, typeof pilotSites>();
    for (const site of pilotSites) byClient.set(`${site.companyId}|${site.client}`, [...(byClient.get(`${site.companyId}|${site.client}`) ?? []), site]);
    const pic = 'Operations Manager (mock)';
    [...byClient.entries()].forEach(([key, sites], i) => {
      const [companyId, name] = key.split('|');
      const onboarding = i % 10 === 0;
      const offboarding = !onboarding && i % 17 === 3;
      const steps = CLIENT_ONBOARD_STEPS.map(([k, label], j) => ({
        key: k,
        label,
        doneAt: onboarding && j >= 3 ? null : ago(onboarding ? 18 : 400),
        by: onboarding && j >= 3 ? null : pic,
        note: '',
        docId: null,
      }));
      ds.clientAccounts.push({
        id: `cl-${sites[0].id}`,
        companyId,
        name,
        siteIds: sites.map((x) => x.id),
        stage: onboarding ? 'onboarding' : offboarding ? 'offboarding' : 'active',
        startedOn: dateOf(ago(onboarding ? 20 : 400)),
        contractEndsOn: addDays(today, ((i * 37) % 400) - 20),
        onboarding: steps,
        offboarding: offboarding
          ? CLIENT_OFFBOARD_STEPS.map(([k, label], j) => ({ key: k, label, doneAt: j === 0 ? ago(5) : null, by: j === 0 ? pic : null, note: '', docId: null }))
          : null,
        offboardReason: offboarding ? 'Client did not renew; moved to an in-house team' : null,
        contacts: i % 4 === 0 ? [] : [{ at: ago((i * 7) % 45), by: pic, kind: 'visit' as const, note: 'Routine visit with the client PIC' }],
        reports: onboarding || i % 6 === 1 ? [] : [{ period: prev, at: ago(Number(today.slice(8, 10)) + 2), by: pic, docId: null }],
        ratings:
          i % 5 === 2
            ? []
            : [
                {
                  at: ago(20 + (i % 30)),
                  by: pic,
                  score: [5, 4, 4, 3, 2, 4, 5][i % 7],
                  comment: [5, 4, 4, 3, 2, 4, 5][i % 7] <= 2 ? 'Guards late at shift change' : '',
                },
              ],
        invoicePortal: sites[0].sector === 'government' ? 'ePerolehan' : null,
        invoices: (() => {
          if (onboarding || i % 8 === 4) return [];
          const sent = { at: ago(Math.max(1, Number(today.slice(8, 10)) - 6)), by: 'Admin executive (mock)', docId: 'seed-invoice' };
          // A few were emailed but the hand copy is not back yet.
          return [
            {
              period: prev,
              amount: 9_000 + (i % 13) * 750,
              at: sent.at,
              by: sent.by,
              hand: i % 11 === 6 ? null : sent,
              email: sent,
              portal: sites[0].sector === 'government' && i % 3 !== 0 ? sent : null,
            },
          ];
        })(),
        billing:
          i % 7 === 5
            ? null
            : {
                asOf: dateOf(ago(3)),
                invoicedTo: prev,
                overdueAmount: i % 9 === 0 ? 18_400 : 0,
                overdueDays: i % 9 === 0 ? 45 : 0,
                by: 'Admin executive (mock)',
              },
      });
    });
    // Client CRM (Fauzan, 4 Nov 2026; mock): contacts, the person in charge, client requests, renewals and lost reasons.
    // All names, numbers and emails are made up.
    {
      const POS = ['Facility Manager', 'Building Manager', 'Admin Manager', 'Estate Manager'];
      ds.clientAccounts.forEach((a, i) => {
        const slug = a.name.toLowerCase().replace(/\(mock\)/, '').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'client';
        a.origin = { kind: 'direct', id: null, ref: null };
        a.owner = i % 6 === 5 ? null : { name: 'Operations Manager (mock)', userId: null, since: dateOf(ago(300)), by: 'Operations Director (mock)' };
        a.people =
          i % 9 === 4
            ? []
            : [
                { id: `cp-${a.id}-1`, name: `Contact ${i + 1}A (mock)`, position: POS[i % POS.length], role: 'site' as const, phone: `03-0000 ${String(1000 + i).slice(-4)}`, email: `pic@${slug}.example`, main: i % 7 !== 3, addedBy: pic, addedAt: ago(390), removedAt: null, removedBy: null },
                { id: `cp-${a.id}-2`, name: `Contact ${i + 1}B (mock)`, position: 'Accounts Executive', role: 'finance' as const, phone: '', email: `accounts@${slug}.example`, main: false, addedBy: 'Admin executive (mock)', addedAt: ago(380), removedAt: null, removedBy: null },
              ];
        a.requests =
          i % 5 === 1
            ? [{ id: `cq-${a.id}-1`, kind: 'more_guards' as const, what: 'One more guard at the loading bay at night', from: `Contact ${i + 1}A (mock)`, at: ago(20), by: pic, neededBy: null, status: 'open' as const, closedAt: null, closedBy: null, outcome: null, variationRef: null }]
            : i % 5 === 3
              ? [{ id: `cq-${a.id}-1`, kind: 'temporary' as const, what: 'Two guards for the year-end event', from: `Contact ${i + 1}A (mock)`, at: ago(4), by: pic, neededBy: addDays(today, 20), status: 'open' as const, closedAt: null, closedBy: null, outcome: null, variationRef: null }]
              : [];
        a.renewals = [];
        a.renewal = null;
        // A renewal decided and offered for some clients whose contract ends soon.
        if (a.stage === 'active' && a.contractEndsOn && a.contractEndsOn >= today && daysBetween(today, a.contractEndsOn) <= 90 && i % 3 === 0)
          a.renewal = {
            id: `rn-${a.id}`,
            endsOn: a.contractEndsOn,
            openedAt: ago(15),
            decision: { choice: 'renew_new_price', pricePct: 5, reason: 'Minimum wage rise; client rated us 4 of 5', by: 'Company manager (mock)', at: ago(15) },
            proposal: i % 2 === 0 ? { at: ago(8), by: 'Admin executive (mock)', docId: 'seed-renewal-offer' } : null,
            answer: null,
            closedAt: null,
          };
        if (a.stage === 'offboarding') {
          a.lostReason = 'in_house';
          a.winBackOn = addDays(today, 180);
        }
      });
    }
    // The COO's monthly operations meetings: Sasa held with minutes, Arrow Shield scheduled, Inas not yet.
    const opsMeeting = (id: string, companyId: string, day: number, held: boolean) => ({
      id,
      companyId,
      department: null,
      kind: 'operations' as const,
      title: 'Monthly operations meeting',
      organiser: 'Ahmad Faisal bin Zainal',
      start: myt(`${today.slice(0, 7)}-${String(day).padStart(2, '0')}`, '10:00'),
      end: myt(`${today.slice(0, 7)}-${String(day).padStart(2, '0')}`, '11:30'),
      location: 'Company office',
      attendees: ['Ahmad Faisal bin Zainal', 'Operations Manager', 'Officers'],
      agenda: 'Attendance, incidents, clients, billing, staffing',
      status: held ? ('held' as const) : ('scheduled' as const),
      minutes: held
        ? {
            text: 'Attendance stable. Two client complaints closed. Billing on track.',
            by: 'Ahmad Faisal bin Zainal',
            at: myt(`${today.slice(0, 7)}-${String(day).padStart(2, '0')}`, '15:00'),
            file: null,
          }
        : null,
      summary: null,
    });
    ds.meetings.push(opsMeeting('mt-ops-sasa', 'co-sasa', 5, true), opsMeeting('mt-ops-arsh', 'co-arsh', 28, false));
  }

  // ----- Products sold or rented to clients (Fauzan, 26 Oct 2026; mock): one ready, one renewing, two blocked -----
  {
    const by = 'Siti Mariam binti Osman';
    const cert = (id: string, body: CertBody, scheme: string, status: ProductCert['status'], expiresIn: number | null, procedure: string): ProductCert => ({
      id,
      body,
      scheme,
      ref: status === 'valid' ? `${body}-${id.toUpperCase()}` : '',
      status,
      expiresOn: expiresIn === null ? null : addDays(today, expiresIn),
      procedure,
      docId: null,
      updatedBy: by,
      updatedAt: now,
    });
    const mcmcSteps =
      'Apply for MCMC certification of the communications equipment through SIRIM QAS (the certifying agency): test report, technical file, apply online, pay the fee; the certificate label goes on each unit.';
    ds.products.push(
      {
        id: 'prod-cctv',
        name: 'CCTV rental package (4G NVR)',
        category: 'CCTV',
        mode: 'RENTAL',
        supplier: 'Mock supplier',
        personalData: ['video of people', 'vehicle plates'],
        retentionDays: 30,
        clientConsent: true,
        notes: 'Signage at every entrance before recording starts.',
        certs: [cert('c1', 'MCMC', 'MCMC certification via SIRIM QAS (4G modem)', 'valid', 400, mcmcSteps)],
        updatedBy: by,
        updatedAt: now,
      },
      {
        id: 'prod-tour',
        name: 'GPS guard tour tracker',
        category: 'Tracker',
        mode: 'BOTH',
        supplier: 'Mock supplier',
        personalData: ['guard location while on duty'],
        retentionDays: 90,
        clientConsent: false,
        notes: '',
        certs: [
          cert('c2', 'MCMC', 'MCMC certification via SIRIM QAS', 'valid', 20, mcmcSteps),
          cert(
            'c3',
            'MySTI',
            'MySTI listing for government tenders',
            'applying',
            null,
            'Apply on the MySTI portal (MOSTI) with the product details and local content proof; needed for government procurement.',
          ),
        ],
        updatedBy: by,
        updatedAt: now,
      },
      {
        id: 'prod-bodycam',
        name: 'Body camera',
        category: 'Camera',
        mode: 'RENTAL',
        supplier: 'Mock supplier',
        personalData: ['video and audio of people'],
        retentionDays: 30,
        clientConsent: true,
        notes: '',
        certs: [cert('c4', 'MCMC', 'MCMC certification via SIRIM QAS (Wi-Fi)', 'not_started', null, mcmcSteps)],
        updatedBy: by,
        updatedAt: now,
      },
      {
        id: 'prod-visitor',
        name: 'Visitor management kiosk',
        category: 'Visitor system',
        mode: 'SALE',
        supplier: 'Mock supplier',
        personalData: ['names', 'IC numbers', 'photos'],
        retentionDays: null,
        clientConsent: true,
        notes: 'Retention period to be agreed.',
        certs: [
          cert(
            'c5',
            'SIRIM',
            'SIRIM product certification (power adaptor)',
            'valid',
            200,
            'Renew with SIRIM QAS before expiry: updated test report and factory audit.',
          ),
        ],
        updatedBy: by,
        updatedAt: now,
      },
    );
  }

  // ----- Fleet (Fauzan, 26 Oct 2026; mock): reminders due, one vehicle out, one request waiting -----
  {
    const nowMs = toMs(now);
    const ago = (min: number) => fromMs(nowMs - min * 60_000);
    const base = { log: [], out: null };
    ds.vehicles.push(
      {
        ...base,
        id: 'veh-sasa-1',
        companyId: 'co-sasa',
        plate: 'WXY 1234',
        model: 'Toyota Hilux (patrol)',
        kind: 'PATROL_CAR',
        renewals: { ROAD_TAX: addDays(today, 10), INSURANCE: addDays(today, 10), PUSPAKOM: addDays(today, 120) },
        odometerKm: 84_200,
        service: { dueOn: addDays(today, 40), dueKm: 90_000, lastOn: addDays(today, -140) },
        payment: { lender: 'Mock Bank', monthly: 1450, dayOfMonth: Number(addDays(today, 3).slice(8, 10)), endsOn: addDays(today, 700), paidPeriods: [] },
        tracker: { id: 'TRK-0001', lastSeen: ago(4) },
        dashcam: { id: 'CAM-0001', lastSeen: null },
        healthMonitor: true,
      },
      {
        ...base,
        id: 'veh-arsh-1',
        companyId: 'co-arsh',
        plate: 'PKM 5678',
        model: 'Nissan Urvan (guard transport)',
        kind: 'VAN',
        renewals: { ROAD_TAX: addDays(today, 200), INSURANCE: addDays(today, -2), PERMIT: addDays(today, 25) },
        odometerKm: 151_900,
        service: { dueOn: addDays(today, 60), dueKm: 155_000, lastOn: addDays(today, -100) },
        payment: null,
        tracker: { id: 'TRK-0002', lastSeen: ago(300) },
        dashcam: null,
        healthMonitor: false,
      },
      {
        ...base,
        id: 'veh-inas-1',
        companyId: 'co-inas',
        plate: 'BNH 902',
        model: 'Honda EX5 (patrol motorcycle)',
        kind: 'MOTORCYCLE',
        renewals: { ROAD_TAX: addDays(today, 90), INSURANCE: addDays(today, 90) },
        odometerKm: 30_640,
        service: { dueOn: addDays(today, 20), dueKm: 30_500, lastOn: addDays(today, -80) },
        payment: null,
        tracker: null,
        dashcam: null,
        healthMonitor: false,
      },
      {
        ...base,
        id: 'veh-pwvsb-1',
        companyId: 'pwvsb',
        plate: 'VDE 77',
        model: 'Proton X70 (pool car)',
        kind: 'CAR',
        renewals: { ROAD_TAX: addDays(today, 150), INSURANCE: addDays(today, 150) },
        odometerKm: 41_000,
        service: { dueOn: addDays(today, 70), dueKm: 50_000, lastOn: addDays(today, -60) },
        payment: null,
        tracker: { id: 'TRK-0004', lastSeen: null },
        dashcam: null,
        healthMonitor: false,
        out: { requestId: null, driver: 'Director Office despatch', driverUserId: null, at: ago(120), km: 41_000 },
        log: [{ at: ago(120), by: 'Zulkifli bin Yusof', what: 'Out to Director Office despatch at 41000 km (bank documents)', docId: null }],
      },
    );
    ds.vehicleRequests.push({
      id: 'vr-seed-1',
      companyId: 'co-inas',
      vehicleId: null,
      userId: 'u-cm-inas',
      name: ds.users.find((u) => u.id === 'u-cm-inas')?.name ?? 'Company manager',
      purpose: 'Client meeting and site inspection, Klang',
      from: fromMs(nowMs + 20 * 3_600_000),
      to: fromMs(nowMs + 26 * 3_600_000),
      status: 'requested',
      decision: null,
      requestedAt: ago(90),
    });
  }

  // ----- Staff claims (Fauzan, 26 Oct 2026; mock) -----
  {
    const last = addDays(`${today.slice(0, 7)}-15`, -30).slice(0, 7);
    const nowMs = toMs(now);
    for (const [vehicle, perKm] of [
      ['CAR', 0.6],
      ['MOTORCYCLE', 0.3],
      ['COMPANY_CAR', 0.25],
    ] as const)
      ds.claimRates.push({
        id: `cr-${last}-${vehicle.toLowerCase()}`,
        month: last,
        vehicle,
        perKm,
        setBy: 'Chief of Staff',
        setAt: fromMs(nowMs - 30 * 86_400_000),
      });
    // This month's rates are not published yet, so the Chief of Staff sees the reminder.
    const sasaO1 = ds.people.find((p) => p.id === 'pr-sasa-o1');
    if (sasaO1)
      ds.staffClaims.push({
        id: `scl-${sasaO1.id}-seed-1`,
        companyId: sasaO1.companyId,
        personId: sasaO1.id,
        personName: sasaO1.name,
        userId: 'u-cm-sasa',
        kind: 'MEDICAL',
        date: addDays(today, -4),
        amount: 120,
        allowed: 120,
        receiptIds: [],
        note: 'Clinic visit, fever',
        travel: null,
        status: 'submitted',
        cosApproval: null,
        hrDecision: null,
        createdAt: fromMs(nowMs - 3 * 86_400_000),
      });
    // Synthetic pattern for the ACT anomaly finder (masterplan item 241): the same clinic receipt claimed a second time.
    if (sasaO1)
      ds.staffClaims.push({
        id: `scl-${sasaO1.id}-seed-2`,
        companyId: sasaO1.companyId,
        personId: sasaO1.id,
        personName: sasaO1.name,
        userId: 'u-cm-sasa',
        kind: 'MEDICAL',
        date: addDays(today, -4),
        amount: 120,
        allowed: 120,
        receiptIds: [],
        note: 'Clinic visit (mock duplicate for the ACT anomaly test)',
        travel: null,
        status: 'submitted',
        cosApproval: null,
        hrDecision: null,
        createdAt: fromMs(nowMs - 2 * 86_400_000),
      });
    const arshO2 = ds.people.find((p) => p.id === 'pr-arsh-o2');
    if (arshO2)
      ds.staffClaims.push({
        id: `scl-${arshO2.id}-seed-1`,
        companyId: arshO2.companyId,
        personId: arshO2.id,
        personName: arshO2.name,
        userId: 'u-ae-arsh',
        kind: 'TRAVEL',
        date: `${last}-18`,
        amount: 163,
        allowed: 163,
        receiptIds: [],
        note: 'Tender briefing',
        travel: {
          destination: 'JKR Seremban (tender briefing)',
          preApproved: false,
          vehicle: 'CAR',
          kmClaimed: 190,
          kmSystem: 182.4,
          perKm: 0.6,
          mileage: 114,
          toll: 24,
          parking: 0,
          overnightNights: 0,
          hotel: 0,
          food: 25,
          cosReasons: ['Place not pre-approved'],
        },
        status: 'submitted',
        cosApproval: null,
        hrDecision: null,
        createdAt: fromMs(nowMs - 8 * 86_400_000),
      });
  }

  appendAudit(ds.audit, {
    at: fromMs(toMs(now) - 3_600_000),
    actor: 'system',
    companyId: null,
    action: 'seed',
    entity: 'dataset',
    entityId: 'mock',
    summary: `Mock data generated for ${ds.companies.length} companies (3 pilots in detail).`,
  });

  // ----- JA Group app feed (Fauzan, 26 Oct 2026; mock): what the JA app would send for payroll, foreign workers and incidents -----
  {
    const nowMs = toMs(now);
    const ago = (h: number) => fromMs(nowMs - h * 3_600_000);
    const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const rec = (companyId: Id, dataset: JaRecord['dataset'], externalId: string, hoursAgo: number, body: Partial<JaRecord>): JaRecord => ({
      id: `ja:${dataset}:${companyId}:${externalId}`,
      companyId,
      dataset,
      externalId,
      sourceUpdatedAt: ago(hoursAgo + 1),
      receivedAt: ago(hoursAgo),
      ...body,
    });
    ds.companies.forEach((c, i) => {
      const heads = c.guardCount || 100;
      const gross = Math.round(heads * 2_150 * 100) / 100;
      const pay = (period: string, status: JaPayroll['status']): JaPayroll => ({
        period,
        headcount: heads,
        gross,
        net: Math.round(gross * 0.86 * 100) / 100,
        employerEpf: Math.round(gross * 0.13 * 100) / 100,
        employerSocso: Math.round(heads * 37.35 * 100) / 100,
        employerEis: Math.round(Math.round(heads * 0.75) * 4.3 * 100) / 100,
        // Normal SOCSO and LINDUNG 24 Jam kept apart: about a quarter Nepali (always LINDUNG), some Malaysians opted out.
        employeeSocso: Math.round(heads * 10.75 * 100) / 100,
        employeeLindung: Math.round(Math.round(heads * 0.8) * 16.1 * 100) / 100,
        employeeEis: Math.round(Math.round(heads * 0.75) * 4.3 * 100) / 100,
        pcb: Math.round(heads * 3 * 100) / 100,
        status,
        approvedBy: status === 'draft' ? null : 'COO (JA app)',
        approvedAt: status === 'draft' ? null : `${period}-28T15:00:00+08:00`,
        paidOn: status === 'paid' ? `${today.slice(0, 7)}-0${(i % 6) + 1}` : null,
      });
      // One company left last month's payroll unpaid past the 7th, to show the flag.
      ds.jaRecords.push(rec(c.id, 'payroll', `PAY-${c.code}-${prev}`, 3, { payroll: pay(prev, c.id === 'co-arsh' ? 'approved' : 'paid') }));
      ds.jaRecords.push(rec(c.id, 'payroll', `PAY-${c.code}-${today.slice(0, 7)}`, 3, { payroll: pay(today.slice(0, 7), 'draft') }));
    });
    const papers: JaPaper[] = ['PLKS', 'PASSPORT', 'FOMEMA', 'FWIG'];
    for (const companyId of ['co-sasa', 'co-arsh', 'co-inas']) {
      // Inas's worker feed has been silent for 30 hours, so it shows as unknown, never as fine.
      const hours = companyId === 'co-inas' ? 30 : 2;
      ds.people
        .filter((p) => p.companyId === companyId && p.nationality === 'NP' && p.status === 'active')
        .forEach((p, j) => {
          const due = (k: number) => addDays(today, ((j * 37 + k * 101) % 700) - 20);
          ds.jaRecords.push(
            rec(companyId, 'worker', p.staffNo, hours, {
              worker: {
                staffNo: p.staffNo,
                name: p.name,
                nationality: 'Nepal',
                status: j % 23 === 5 ? 'home_leave' : 'active',
                serviceYear: (j % 10) + 1,
                siteCode: null,
                hostel: `Hostel ${companyId.slice(3).toUpperCase()} ${(j % 3) + 1}`,
                papers: papers.map((paper, k) => {
                  const expiresOn = due(k);
                  return { paper, expiresOn, renewalSubmittedOn: j % 4 === 0 && expiresOn < addDays(today, 60) ? addDays(today, -10) : null };
                }),
              },
            }),
          );
        });
      const sites = ds.sites.filter((x) => x.companyId === companyId);
      const kinds: [string, Severity, string][] = [
        ['Trespass', 'P2', 'Unknown man climbed the back fence at night; left when challenged.'],
        ['Theft', 'P2', 'Copper cable missing from the generator room; client informed, police report made.'],
        ['Property damage', 'P3', 'Boom gate arm hit by a lorry at the main entrance.'],
        ['Fire', 'P1', 'Small fire in a rubbish bin near the loading bay, put out by the guard.'],
        ['Injury', 'P3', 'Guard slipped on a wet stairway during patrol; first aid given.'],
        ['Suspicious person', 'P4', 'Person photographing the entrance, left when approached.'],
      ];
      kinds.forEach(([category, severity, summary], k) => {
        const site = sites[(k * 7) % Math.max(sites.length, 1)];
        const open = k % 3 !== 2;
        ds.jaRecords.push(
          rec(companyId, 'incident', `INC-${companyId.slice(3).toUpperCase()}-${1040 + k}`, 1, {
            incident: {
              occurredAt: ago(6 + k * 19),
              siteCode: site?.code ?? null,
              category,
              severity,
              status: open ? 'open' : 'closed',
              summary,
              reportedBy: 'Site guard (JA app)',
              closedAt: open ? null : ago(2 + k * 19),
            },
          }),
        );
      });
    }
    (['payroll', 'worker', 'incident'] as const).forEach((dataset, k) =>
      ds.jaSyncs.push({
        id: `jasync-${dataset}-${k}`,
        at: ago(dataset === 'payroll' ? 3 : dataset === 'worker' ? 2 : 1),
        dataset,
        received: ds.jaRecords.filter((r) => r.dataset === dataset).length + (dataset === 'worker' ? 1 : 0),
        accepted: ds.jaRecords.filter((r) => r.dataset === dataset && !(dataset === 'worker' && r.companyId === 'co-inas')).length,
        rejected: dataset === 'worker' ? [{ externalId: 'XX9999', reason: 'Company code NOPE is not in Prima.' }] : [],
        // Every company is covered in full, except Inas's worker feed, which has been silent for 30 hours.
        covered: ds.companies.map((c) => c.id).filter((id) => !(dataset === 'worker' && id === 'co-inas')),
      }),
    );
  }

  // ----- Asset Management (Fauzan, 26 Oct 2026; mock): 450 rental units, the asset register, 2 resorts, 6 orchards, 1 training facility -----
  {
    const r = new Rng(MASTER_SEED + 450);
    const types: [AmUnitType, number, string, number, number][] = [
      ['RESIDENTIAL', 180, 'Apartment', 900, 1_800],
      ['COMMERCIAL', 150, 'Shop lot', 1_400, 6_500],
      ['INDUSTRIAL', 80, 'Factory lot', 3_500, 12_000],
      ['LAND', 40, 'Land', 800, 4_000],
    ];
    const owners = ['PWVSB Properties Sdn Bhd (mock)', 'PWVSB Holdings (mock)'];
    const tenantsCo = [
      'Kedai Runcit Maju',
      'Klinik Sihat',
      'Restoran Selera Kampung',
      'Bengkel Auto Jaya',
      'Logistik Pantas',
      'Tadika Cahaya',
      'Farmasi Ceria',
      'Kilang Plastik Utama',
      'Gudang Sentosa',
      'Kafe Kopi Kita',
    ];
    const tenantsPerson = ['Encik Ahmad', 'Puan Siti', 'Mr Tan', 'Ms Priya', 'Encik Razak', 'Puan Noraini', 'Mr Lim', 'Encik Faizal'];
    // The group office and each state branch (cawangan negeri) rent a commercial unit, billed like any tenant.
    const internalTenants = ['PWVSB group office', ...[...new Set(ds.branches.map((b) => b.state))].map((st) => `State branch office, ${st}`)];
    let n = 0;
    const internalLeft = [...internalTenants];
    for (const [type, count, label, lo, hi] of types) {
      for (let i = 0; i < count; i++) {
        n++;
        const area = AREAS[(n * 7) % AREAS.length];
        const asking = Math.round(r.int(lo, hi) / 50) * 50;
        const roll = r.float();
        const internal = type === 'COMMERCIAL' && internalLeft.length > 0 && i % 9 === 0;
        const status: AmUnitStatus = internal ? 'let' : roll < 0.84 ? 'let' : roll < 0.94 ? 'vacant' : roll < 0.98 ? 'maintenance' : 'reserved';
        let tenancy: AmTenancy | null = null;
        if (status === 'let') {
          const tenant = internal
            ? internalLeft.shift()!
            : type === 'RESIDENTIAL'
              ? `${r.pick(tenantsPerson)} (${n})`
              : `${r.pick(tenantsCo)} ${type === 'LAND' ? 'Agro' : 'Enterprise'} (${n})`;
          const startOn = addDays(today, -r.int(60, 900));
          const endOn = addDays(startOn, 365 * (type === 'RESIDENTIAL' ? 1 : r.pick([2, 3])));
          const endShown = endOn < today ? addDays(today, r.int(5, 400)) : endOn;
          // Most pay on time; some fall behind 1, 2 or 3 months.
          const behind = internal ? (i % 27 === 0 ? 1 : 0) : r.chance(0.08) ? r.int(1, 3) : 0;
          const invoices: AmInvoice[] = [];
          for (let k = 5; k >= 0; k--) {
            const period = monthsBack(today, k);
            const unpaid = k < behind;
            const partial = !unpaid && k === behind && behind > 0 && r.chance(0.5);
            invoices.push({
              period,
              amount: asking,
              paid: unpaid ? 0 : partial ? Math.round(asking / 2) : k === 0 && Number(today.slice(8, 10)) < 7 && r.chance(0.5) ? 0 : asking,
              paidOn: unpaid ? null : `${period}-0${r.int(1, 9)}`,
            });
          }
          tenancy = {
            tenant,
            internal,
            startOn,
            endOn: endShown,
            rent: asking,
            deposit: asking * 2,
            utilityDeposit: Math.round(asking / 2),
            stamped: r.chance(0.95),
            // Mock contact details only (Fauzan: no real names or numbers until go-live).
            tenantPhone: `01${r.int(0, 9)}-${r.int(100, 999)} ${r.int(1000, 9999)}`,
            tenantEmail: internal ? null : `accounts.${String(n).padStart(3, '0')}@example.com`,
            lastContactOn: r.chance(0.85) ? addDays(today, -r.int(1, 200)) : null,
            invoices: invoices.map((x) => (x.paid === 0 ? { ...x, paidOn: null } : x)),
          };
        }
        ds.amUnits.push({
          id: `am-u-${String(n).padStart(3, '0')}`,
          code: `${type.slice(0, 3)}-${String(n).padStart(3, '0')}`,
          type,
          name: `${label} ${area.town} ${i + 1}`,
          town: area.town,
          state: area.state,
          ownerEntity: owners[n % owners.length],
          sizeSqft: type === 'LAND' ? r.int(10, 80) * 1000 : type === 'INDUSTRIAL' ? r.int(30, 120) * 100 : r.int(7, 30) * 100,
          askingRent: asking,
          status,
          vacantSince: status === 'vacant' ? addDays(today, -r.int(5, 200)) : null,
          insuranceExpiry: addDays(today, r.chance(0.03) ? r.int(-10, 0) : r.int(1, 400)),
          assessmentDue: addDays(today, r.chance(0.03) ? r.int(-20, 0) : r.int(10, 180)),
          quitRentDue: addDays(today, r.chance(0.02) ? r.int(-30, 0) : r.int(15, 330)),
          meters:
            type === 'LAND'
              ? []
              : [
                  {
                    kind: 'ELECTRICITY',
                    account: `TNB-${200000 + n}`,
                    payer: status === 'let' ? 'tenant' : 'owner',
                    lastReadOn: r.chance(0.9) ? addDays(today, -r.int(1, 40)) : null,
                  },
                  {
                    kind: 'WATER',
                    account: `AIR-${500000 + n}`,
                    payer: status === 'let' ? 'tenant' : 'owner',
                    lastReadOn: r.chance(0.9) ? addDays(today, -r.int(1, 40)) : null,
                  },
                ],
          tenancy,
        });
      }
    }
    // Rent recorded and followed up by the rental team (Fauzan, 27 Oct 2026; mock): cash not yet banked, a broken
    // promise to pay, and a reminder letter waiting for the Asset Director.
    {
      const thisMonth = today.slice(0, 7);
      const paidNow = ds.amUnits.filter((u) => u.tenancy?.invoices.some((i) => i.period === thisMonth && i.paid > 0)).slice(0, 6);
      paidNow.forEach((u, j) => {
        const inv = u.tenancy!.invoices.find((i) => i.period === thisMonth)!;
        const on = inv.paidOn ?? today;
        const method = (['CASH', 'TRANSFER', 'CASH', 'ONLINE', 'CHEQUE', 'TRANSFER'] as const)[j];
        u.tenancy!.payments = [
          {
            id: `pay-${u.id}-seed`,
            on,
            amount: inv.paid,
            method,
            receiptNo: `OR-${thisMonth.replace('-', '')}-${String(101 + j)}`,
            ref: method === 'CASH' ? '' : method === 'CHEQUE' ? `CHQ ${400100 + j}` : `IBG${900000 + j}`,
            applied: [{ period: thisMonth, amount: inv.paid }],
            by: 'Nadia binti Rahim',
            at: `${on}T11:00:00+08:00`,
            banked: method === 'CASH' && j === 2 ? { on, slipRef: `BIS-${7000 + j}`, by: 'Grace Wong Mei Ling' } : null,
            reversed: null,
          },
        ];
      });
      const late = ds.amUnits.filter((u) => u.tenancy && !u.tenancy.internal && u.tenancy.invoices.some((i) => i.paid < i.amount && i.period < thisMonth));
      late.slice(0, 3).forEach((u, j) => {
        const by = 'Nadia binti Rahim';
        const at = (d: number) => `${addDays(today, -d)}T10:00:00+08:00`;
        u.tenancy!.followUps =
          j === 0
            ? [
                {
                  id: `fu-${u.id}-1`,
                  on: addDays(today, -20),
                  action: 'CALL',
                  note: 'Tenant says business is slow (mock)',
                  promiseOn: null,
                  by,
                  at: at(20),
                  approval: null,
                },
                {
                  id: `fu-${u.id}-2`,
                  on: addDays(today, -19),
                  action: 'PROMISE',
                  note: 'Will pay all arrears (mock)',
                  promiseOn: addDays(today, -5),
                  by,
                  at: at(19),
                  approval: null,
                },
              ]
            : j === 1
              ? [
                  {
                    id: `fu-${u.id}-1`,
                    on: addDays(today, -2),
                    action: 'LETTER',
                    note: 'First reminder letter for 2 months unpaid (mock)',
                    promiseOn: null,
                    by,
                    at: at(2),
                    approval: null,
                  },
                ]
              : [
                  {
                    id: `fu-${u.id}-1`,
                    on: addDays(today, -6),
                    action: 'MESSAGE',
                    note: 'WhatsApp reminder sent (mock)',
                    promiseOn: null,
                    by,
                    at: at(6),
                    approval: null,
                  },
                ];
      });
    }
    // The two resorts, six fruit orchards and the training facility.
    const props: [AmProperty['kind'], string, string, string, string][] = [
      ['RESORT', 'Resort Teluk Indah (mock)', 'Kuantan', 'Pahang', '42 rooms, chalets and a function hall'],
      ['RESORT', 'Resort Bukit Damai (mock)', 'Bentong', 'Pahang', '28 rooms and a campsite'],
      ['ORCHARD', 'Durian orchard, Raub (mock)', 'Raub', 'Pahang', '12 hectares, about 1,100 trees'],
      ['ORCHARD', 'Durian orchard, Bentong (mock)', 'Bentong', 'Pahang', '8 hectares, about 700 trees'],
      ['ORCHARD', 'Mango orchard, Perlis (mock)', 'Kangar', 'Perlis', '10 hectares, harumanis'],
      ['ORCHARD', 'Rambutan orchard, Perak (mock)', 'Kuala Kangsar', 'Perak', '6 hectares'],
      ['ORCHARD', 'Pineapple farm, Johor (mock)', 'Pontian', 'Johor', '15 hectares, MD2'],
      ['ORCHARD', 'Dokong orchard, Kelantan (mock)', 'Tanah Merah', 'Kelantan', '5 hectares'],
      ['TRAINING', 'Group Training Centre (mock)', 'Seremban', 'Negeri Sembilan', 'Classrooms for 120, hostel for 60, firing range for CSG and armed training'],
    ];
    props.forEach(([kind, name, town, state, detail], j) => {
      const licences =
        kind === 'RESORT'
          ? [
              { name: 'Tourism accommodation licence (MOTAC)', expiresOn: addDays(today, j === 0 ? 24 : 210) },
              { name: 'Fire certificate (BOMBA)', expiresOn: addDays(today, 120 + j * 30) },
              { name: 'Food premises licence (PBT)', expiresOn: addDays(today, 300) },
            ]
          : kind === 'TRAINING'
            ? [
                { name: 'Fire certificate (BOMBA)', expiresOn: addDays(today, 75) },
                { name: 'Firing range approval (PDRM, to be verified)', expiresOn: addDays(today, 18) },
              ]
            : [{ name: 'Land lease or title charges', expiresOn: addDays(today, 100 + j * 40) }];
      const months = [];
      for (let k = 5; k >= 0; k--) {
        const period = monthsBack(today, k);
        const season = kind === 'ORCHARD' && [5, 6, 7, 11, 0].includes(Number(period.slice(5, 7)) % 12);
        const income =
          kind === 'RESORT' ? r.int(140, 320) * 1000 : kind === 'ORCHARD' ? (season ? r.int(30, 140) * 1000 : r.int(0, 8) * 1000) : r.int(25, 60) * 1000;
        months.push({
          period,
          income,
          cost: kind === 'RESORT' ? r.int(110, 220) * 1000 : kind === 'ORCHARD' ? r.int(8, 25) * 1000 : r.int(20, 40) * 1000,
          occupancyPct: kind === 'RESORT' ? r.int(38, 86) : null,
          harvestKg: kind === 'ORCHARD' ? (season ? r.int(4, 30) * 1000 : r.int(0, 2) * 100) : null,
          bookings: kind === 'TRAINING' ? r.int(6, 22) : null,
        });
      }
      ds.amProperties.push({ id: `am-p-${j + 1}`, kind, name, town, state, detail, licences, months });
    });
    // Maintenance work orders on units and properties.
    const jobs = [
      'Roof leak',
      'Aircond service',
      'Repaint unit',
      'Broken pipe',
      'Grass cutting',
      'Electrical fault',
      'Door lock change',
      'Septic tank service',
      'Fence repair',
      'Water pump repair',
    ];
    for (let k = 0; k < 70; k++) {
      const onUnit = k % 6 !== 0;
      const raisedOn = addDays(today, -r.int(0, 25));
      const status = r.float() < 0.45 ? 'done' : r.float() < 0.5 ? 'in_progress' : 'open';
      ds.amWorkOrders.push({
        id: `am-wo-${k + 1}`,
        unitId: onUnit ? ds.amUnits[r.int(0, ds.amUnits.length - 1)].id : null,
        propertyId: onUnit ? null : ds.amProperties[r.int(0, ds.amProperties.length - 1)].id,
        title: r.pick(jobs),
        source: r.pick(['tenant', 'tenant', 'planned', 'inspection'] as const),
        raisedOn,
        dueOn: addDays(raisedOn, r.pick([7, 14, 21, 30])),
        status,
        cost: status === 'done' ? r.int(2, 60) * 50 : null,
        contractor: r.chance(0.7) ? r.pick(['Kontraktor Bina Jaya (mock)', 'Servis Elektrik Maju (mock)', 'Paip & Air Sdn Bhd (mock)']) : null,
        doneOn: status === 'done' ? addDays(raisedOn, r.int(1, 10)) : null,
      });
    }
    // Movable (non-electronic) assets: furniture, fittings and renovations in group, branch and company offices.
    const places = ['PWVSB group office', ...internalTenants.slice(1), ...ds.companies.slice(0, 10).map((c) => `${c.name} office`), ...props.map((p) => p[1])];
    const items: [AmAsset['category'], string, number][] = [
      ['FURNITURE', 'Office desk', 650],
      ['FURNITURE', 'Office chair', 280],
      ['FURNITURE', 'Filing cabinet', 520],
      ['FURNITURE', 'Meeting table', 2_400],
      ['FURNITURE', 'Guard post chair', 180],
      ['FITTING', 'Blinds and curtains', 900],
      ['FITTING', 'Signage', 1_500],
      ['RENOVATION', 'Office partition', 8_500],
      ['OTHER', 'Steel safe (non-electronic)', 3_200],
    ];
    for (let k = 0; k < 620; k++) {
      const [category, description, cost] = items[k % items.length];
      const status = k % 97 === 3 ? 'disposal_pending' : k % 131 === 7 ? 'disposed' : 'in_use';
      ds.amAssets.push({
        id: `am-a-${k + 1}`,
        tag: `AST-${String(k + 1).padStart(5, '0')}`,
        description,
        category,
        ownerEntity: owners[k % owners.length],
        location: places[k % places.length],
        cost,
        // About one in 12 is over 10 years old and fully written off (still in use unless disposed).
        boughtOn: ((d) => (k % 12 === 5 ? addDays(today, -(3700 + ((k * 37) % 900))) : addDays(today, -d)))(r.int(30, 2500)),
        condition: r.float() < 0.7 ? 'good' : r.float() < 0.7 ? 'fair' : 'poor',
        keeper: r.pick(['Office administrator', 'Branch manager', 'Resort manager', 'Training centre manager']),
        status,
        lastCheckedOn: r.chance(0.85) ? addDays(today, -r.int(10, 330)) : r.chance(0.5) ? addDays(today, -r.int(400, 700)) : null,
      });
    }
  }

  // Written-off assets still in use: some kept after a review, one refurbished, the rest to review (Fauzan, 27 Oct 2026).
  {
    const old = ds.amAssets.filter((a) => a.status === 'in_use' && a.boughtOn < addDays(today, -3700));
    old.slice(0, 6).forEach((a, i) => {
      const on = addDays(today, -(40 + i * 30));
      a.lifeReviews =
        i === 0
          ? [{ on, decision: 'rehab', note: 'Re-upholstered and new castors (mock)', cost: 180, by: 'Rosli bin Daud', nextReviewOn: addDays(on, 365) }]
          : [{ on, decision: 'keep', note: 'Still sound, light wear (mock)', cost: null, by: 'Rosli bin Daud', nextReviewOn: addDays(on, 365) }];
    });
  }

  // Fixed assets: disposals at each step and depreciation posted in SQL Account for earlier months (AST-DEPN, test data).
  {
    const period = periodBefore(today.slice(0, 7));
    ds.amAssets.forEach((a, i) => {
      if (a.status === 'in_use') return;
      const askedAt = `${addDays(today, -20 - (i % 15))}T10:00:00+08:00`;
      const base = {
        reason: a.condition === 'poor' ? 'Broken beyond repair' : 'Replaced in the office refit',
        method: a.status === 'disposed' ? ('SALE' as const) : ('SCRAP' as const),
        estProceeds: a.status === 'disposed' ? Math.round(a.cost * 0.1) : 0,
        askedBy: 'Rosli bin Daud',
        askedById: 'u-asset-mm',
        askedAt,
        nbvAtAsk: netBookValue(a, askedAt.slice(0, 7)),
        decision: null,
        done: null,
        sqlRef: null,
      };
      if (a.status === 'disposal_pending') {
        a.disposal = i % 2 ? base : { ...base, decision: { by: 'Sharifah Nadia binti Syed Ali', at: askedAt, approve: true, note: '' } };
      } else {
        const on = addDays(today, -10 - (i % 20));
        a.disposal = {
          ...base,
          decision: { by: 'Sharifah Nadia binti Syed Ali', at: askedAt, approve: true, note: '' },
          done: { on, proceeds: base.estProceeds, party: 'Second-hand furniture dealer (mock)', proofRef: `RCPT-${i} (mock)`, by: 'Asset executive (mock)' },
          sqlRef: i % 3 ? `JV-D-${i} (mock)` : null,
        };
      }
    });
    const owners = [...new Set(ds.amAssets.map((a) => a.ownerEntity))].sort();
    for (const [k, ownerEntity] of owners.entries()) {
      for (const back of k === 0 ? [2, 1, 0] : [2, 1]) {
        const p = periodBefore(period, back);
        const amount = Math.round(ds.amAssets.filter((a) => a.ownerEntity === ownerEntity).reduce((n, a) => n + monthDepn(a, p), 0) * 100) / 100;
        ds.amDepnPostings.push({
          id: `depn-${k}-${p}`,
          ownerEntity,
          period: p,
          amount,
          sqlRef: `JV-${p}-${k + 1} (mock)`,
          by: 'Finance team (mock)',
          at: `${p}-28T17:00:00+08:00`,
        });
      }
    }
  }

  // Staff payroll (Fauzan, 27 Oct 2026): salary accounts and fixed allowances for every staff member, last month paid,
  // and this month at each step so each approver has something waiting. Test data only.
  {
    const r = new Rng(MASTER_SEED + 977);
    const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Bank Islam', 'Hong Leong Bank'];
    const staff = ds.people.filter((p) => p.role === 'office');
    staff.forEach((p, k) => {
      // LINDUNG 24 Jam choice for Malaysian staff: most stay in, some opted out, one not recorded yet so HR sees the flag.
      if (p.nationality === 'MY') p.lindungOptOut = p.id === 'pr-sasa-o3' ? undefined : p.id === 'pr-sasa-o2' || p.id === 'pr-arsh-o3' || k % 4 === 1;
      // One admin executive has no salary account yet, so HR sees the warning.
      p.bank = p.id === 'pr-inas-o4' ? null : { bank: BANKS[k % BANKS.length], accountMasked: `****${String(r.int(1000, 9999))}` };
      const pay = p.basicPay ?? 0;
      p.allowances =
        pay >= 9000
          ? [
              { label: 'Car allowance', amount: 1200 },
              { label: 'Phone allowance', amount: 200 },
            ]
          : pay >= 5000
            ? [
                { label: 'Car allowance', amount: 600 },
                { label: 'Phone allowance', amount: 150 },
              ]
            : [{ label: 'Phone allowance', amount: 100 }];
    });
    const period = today.slice(0, 7);
    const [y, m] = period.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const employers = [...new Set(staff.map((p) => p.companyId))];
    const at = (days: number, hour: number) => `${addDays(today, -days)}T${String(hour).padStart(2, '0')}:15:00+08:00`;
    const step = (by: string, byId: string, days: number, hour: number, note = '') => ({ by, byId, at: at(days, hour), note });
    const HR = ['PWVSB HR', 'u-pwvsb-hr'] as const;
    const COS = [ds.users.find((u) => u.id === 'u-cos')?.name ?? 'Chief of Staff', 'u-cos'] as const;
    const COO = [ds.users.find((u) => u.id === 'u-coo')?.name ?? 'COO', 'u-coo'] as const;
    const FIN = ['Finance Team Leader 1', 'u-fin-t1-lead'] as const;
    const daysInto = Number(today.slice(8, 10));
    const build = (cid: string, per: string) =>
      staff
        .filter((p) => p.companyId === cid && p.status === 'active' && p.hiredOn <= `${per}-28`)
        .sort((a, b) => a.staffNo.localeCompare(b.staffNo))
        .map((p) =>
          buildStaffPayLine({
            person: p,
            period: per,
            unpaidDivisor: RULES.staffPayroll.value.unpaidDivisor,
            leaves: ds.leaveRequests,
            claims: [],
          }),
        );
    employers.forEach((cid, k) => {
      const paidDay = Math.max(0, Math.min(daysInto - 1, daysInto - 2 - (k % 3)));
      ds.staffPayRuns.push({
        id: `sp-${cid}-${prev}`,
        companyId: cid,
        period: prev,
        stage: 'paid',
        lines: build(cid, prev),
        prepared: step(...HR, daysInto + 3, 10),
        submitted: step(...HR, daysInto + 2, 16),
        approved: step(...COS, daysInto + 1, 11),
        cooApproved: step(...COO, daysInto, 15, 'Approved.'),
        paid: {
          ...step(...FIN, paidDay, 10),
          bankRef: `M2U-PAY-${prev.replace('-', '')}-${String(k + 1).padStart(3, '0')}`,
          paidOn: addDays(today, -paidDay),
          pcbChecked: true,
        },
        returns: [],
      });
    });
    // This month: PWVSB waits for the Chief of Staff, Sasa for the COO, Arrow Shield for Finance, Inas is a draft.
    const plan: Record<string, StaffPayRun['stage']> = { pwvsb: 'submitted', 'co-sasa': 'approved', 'co-arsh': 'coo_approved', 'co-inas': 'draft' };
    for (const cid of employers) {
      const stage = plan[cid] ?? 'draft';
      const lines = build(cid, period);
      ds.staffPayRuns.push({
        id: `sp-${cid}-${period}`,
        companyId: cid,
        period,
        stage,
        lines,
        prepared: step(...HR, 3, 10),
        submitted: stage === 'draft' ? null : step(...HR, 2, 16),
        approved: ['approved', 'coo_approved'].includes(stage) ? step(...COS, 1, 11, 'Checked against the staff list.') : null,
        cooApproved: stage === 'coo_approved' ? step(...COO, 0, 9, 'Approved.') : null,
        paid: null,
        returns:
          cid === 'co-inas'
            ? [{ ...step(...COS, 1, 12, 'Salary account missing for one admin executive; please add it and resubmit.'), from: 'submitted' }]
            : [],
      });
    }
  }

  // Finance monitor (Fauzan, 27 Oct 2026): each company's books as SQL Account would show them, test data only.
  {
    const r = new Rng(MASTER_SEED + 1031);
    const nowMs = toMs(now);
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const prevP = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const monthEnd = (p: string) => {
      const [yy, mm] = p.split('-').map(Number);
      return `${p}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
    };
    const lastEnd = monthEnd(prevP);
    const [py, pm] = prevP.split('-').map(Number);
    const twoBack = monthEnd(pm === 1 ? `${py - 1}-12` : `${py}-${String(pm - 1).padStart(2, '0')}`);
    const addMonths = (d: string, k: number) => {
      const dt = new Date(`${d}T00:00:00Z`);
      const day = dt.getUTCDate();
      dt.setUTCDate(1);
      dt.setUTCMonth(dt.getUTCMonth() + k);
      const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
      dt.setUTCDate(Math.min(day, last));
      return dt.toISOString().slice(0, 10);
    };
    const companies = [...ds.companies].sort((a, b) => a.code.localeCompare(b.code));
    const entities: { id: string; guards: number }[] = [{ id: GROUP_EMPLOYER_ID, guards: 0 }, ...companies.map((c) => ({ id: c.id, guards: c.guardCount }))];
    const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Bank Islam'];
    const staffPaid = new Set(ds.staffPayRuns.filter((x) => x.period === prevP && x.stage === 'paid').map((x) => x.companyId));
    entities.forEach((e, k) => {
      const team = e.id === GROUP_EMPLOYER_ID ? 1 : (k % 7) + 1;
      const fyEnd = k % 5 === 3 ? '06-30' : '12-31';
      // The financial year that ended most recently.
      let fy = `${y}-${fyEnd}`;
      if (fy >= today) fy = `${y - 1}-${fyEnd}`;
      const roll = r.float();
      const sqlLastAt = roll < 0.05 ? null : roll < 0.13 ? fromMs(nowMs - r.int(50, 120) * 3_600_000) : fromMs(nowMs - r.int(1, 30) * 3_600_000);
      const closeRoll = r.float();
      const closedTo = closeRoll < 0.02 ? null : closeRoll < 0.1 ? twoBack : lastEnd;
      const banks = Array.from({ length: e.id === GROUP_EMPLOYER_ID ? 4 : r.int(2, 3) }, (_, b) => {
        const gl = Math.round(r.int(80_000, 4_000_000) * 100) / 100;
        const behind = r.chance(0.05);
        const open = behind ? r.int(4, 40) : r.int(0, 6);
        return {
          id: `fb-${e.id}-${b + 1}`,
          bank: BANKS[(k + b) % BANKS.length],
          accountMasked: `****${r.int(1000, 9999)}`,
          purpose: (['operating', 'payroll', 'collection', 'operating'] as const)[b],
          glBalance: gl,
          statementBalance: Math.round((gl + (open ? r.int(-30_000, 30_000) : 0)) * 100) / 100,
          reconciledTo: behind ? (r.chance(0.2) ? null : twoBack) : lastEnd,
          openItems: open,
        };
      });
      const billed = e.guards ? Math.round(e.guards * r.int(2600, 3100)) : 0;
      const tests = [
        ['FS-01', 'Trial balance balances'],
        ['FS-02', 'Balance sheet balances'],
        ['FS-06', 'Bank in the books agrees with the reconciliations'],
        ['FS-07', 'Customer ledger agrees with the general ledger'],
        ['FS-08', 'Supplier ledger agrees with the general ledger'],
        // Demo results for the other statement tests (masterplan item 76); real months use reviewed figures.
        ['FS-03', 'Profit or loss agrees with the retained earnings movement'],
        ['FS-04', 'Cash-flow statement rolls from opening to closing cash'],
        ['FS-05', 'Cash-flow closing cash agrees with the balance sheet'],
        ['FS-09', 'Fixed asset register agrees with the ledger'],
        ['FS-10', 'Stock agrees with the ledger'],
        ['FS-11', 'Intercompany balances agreed on both sides'],
        ['FS-12', 'Tax, payroll deductions, SST, loans, deposits and provisions agree with their schedules'],
      ].map(([id, label]) => ({
        id,
        label,
        diff:
          closedTo === null
            ? null
            : id === 'FS-06' && banks.some((b) => b.reconciledTo !== lastEnd)
              ? Math.round(r.int(1_000, 90_000) * 100) / 100
              : (id === 'FS-07' || id === 'FS-08') && r.chance(0.03)
                ? Math.round(r.int(50, 9_000) * 100) / 100
                : 0,
      }));
      const step = (st: 'todo' | 'prepared' | 'reviewed' | 'sent', daysAgo: number) =>
        st === 'todo' ? { status: st, by: null, at: null } : { status: st, by: `Finance Team ${team}`, at: fromMs(nowMs - daysAgo * 86_400_000) };
      const auditDue = addMonths(fy, 4);
      const auditPast = auditDue < today;
      const auditItems = [
        'Trial balance and general ledger',
        'Bank confirmations and reconciliations',
        'Customer and supplier ageing',
        'Fixed asset register',
        'Payroll with EPF, SOCSO, EIS and PCB reconciliation',
        'Board minutes and resolutions',
        'Loan and beneficial interest agreements',
      ].map((label, i) => {
        const st = auditPast ? (r.chance(0.99) ? 'sent' : 'reviewed') : (['todo', 'prepared', 'reviewed', 'sent'] as const)[r.int(0, 3)];
        return { id: `aud-${i + 1}`, label, dueOn: auditDue, ...step(st, r.int(5, 60)) };
      });
      const formC = addMonths(fy, 7);
      const cp204 = `${today.slice(0, 7)}-15`;
      const taxItems = [
        { id: 'tax-formc', label: `Form C for the year to ${fy}`, dueOn: formC, st: formC < today ? (r.chance(0.96) ? 'sent' : 'reviewed') : 'prepared' },
        { id: 'tax-cp204', label: `CP204 instalment ${today.slice(0, 7)}`, dueOn: cp204, st: cp204 < today ? (r.chance(0.96) ? 'sent' : 'todo') : 'todo' },
        { id: 'tax-ea', label: `EA forms to staff for ${y}`, dueOn: `${y + 1}-02-28`, st: 'todo' },
        { id: 'tax-forme', label: `Form E for ${y}`, dueOn: `${y + 1}-03-31`, st: 'todo' },
      ].map(({ st, ...i }) => ({ ...i, ...step(st as 'todo' | 'prepared' | 'reviewed' | 'sent', r.int(3, 40)) }));
      ds.finStatus.push({
        id: `fin-${e.id}`,
        companyId: e.id,
        team,
        fyEnd,
        sqlLastAt,
        closedTo,
        banks,
        posting: {
          period: prevP,
          billed,
          billedPosted: r.chance(0.85) ? billed : Math.round(billed * (0.9 + r.float() * 0.09)),
          staffPayPaid: staffPaid.has(e.id),
          staffPayPosted: staffPaid.has(e.id) ? r.chance(0.75) : false,
          guardPayPaid: e.guards > 0,
          guardPayPosted: e.guards > 0 ? r.chance(0.9) : false,
          supplierBillsUnposted: r.chance(0.3) ? r.int(1, 14) : 0,
        },
        tests,
        arOver90: e.guards ? Math.round(r.int(0, 600_000) * 100) / 100 : 0,
        apOverdue: Math.round(r.int(0, 150_000) * 100) / 100,
        audit: auditItems,
        tax: taxItems,
      });
    });
    // Finance Phase 2 (31 Oct 2026): a few payments for Team 1 at each step, so each person has something to act on.
    // Test data only; no random numbers are drawn here, so the rest of the dataset stays the same.
    {
      const t1 = ds.finStatus.filter((f) => f.team === 1).slice(0, 2);
      const DE = { by: 'Finance Data Entry 1.1', byId: 'u-fin-t1-de1' };
      const DEP = { by: 'Finance Deputy 1', byId: 'u-fin-t1-dep' };
      const LEAD = { by: 'Finance Team Leader 1', byId: 'u-fin-t1-lead' };
      const FD = { by: 'Sharifah Nadia binti Syed Ali', byId: 'u-fd' };
      const at = (h: number) => fromMs(nowMs - h * 3_600_000);
      const ymd = today.replace(/-/g, '');
      const mk = (
        f: (typeof t1)[number],
        n: number,
        payee: string,
        payeeKind: 'supplier' | 'statutory' | 'payroll' | 'tax' | 'intercompany' | 'other',
        purpose: string,
        amount: number,
        steps: { step: 'prepared' | 'reviewed' | 'approved' | 'released'; who: { by: string; byId: string }; h: number; comment: string }[],
      ) => {
        const last = steps[steps.length - 1].step;
        return {
          id: `pay-${f.companyId}-${ymd}-${String(n).padStart(3, '0')}`,
          companyId: f.companyId,
          period: today.slice(0, 7),
          payee,
          payeeKind,
          purpose,
          amount,
          dueOn: addMonths(today, 0).slice(0, 8) + '28',
          bankId: f.banks[0].id,
          sqlRef: `PV-${f.companyId.replace(/^co-/, '').toUpperCase()}-${String(1000 + n)}`,
          evidence: [`Invoice ${payee.split(' ')[0]}-${n} (mock).pdf`],
          needs: 'director' as 'leader' | 'director' | 'ceo' | 'coo',
          subject: 'finance' as 'finance' | 'transport',
          status: last,
          steps: steps.map((x) => ({ step: x.step, by: x.who.by, byId: x.who.byId, at: at(x.h), comment: x.comment })),
          bankRef: last === 'released' ? `M2U-${ymd}-${n} (mock)` : null,
          releasedOn: last === 'released' ? dateOf(at(steps[steps.length - 1].h)) : null,
          payeeId: payeeFor(f, payee),
          payeeBank:
            last === 'approved' || last === 'released'
              ? (() => {
                  const pe = f.payees!.find((x) => x.id === payeeFor(f, payee))!;
                  return { bank: pe.bank, accountLast4: pe.accountLast4, accountName: pe.accountName };
                })()
              : null,
        };
      };
      // Verified payees (paid to the right person). Uniform Maju's bank details changed and wait for a call-back.
      const PAYEES: [string, 'supplier' | 'statutory' | 'tax' | 'other', string, string][] = [
        ['Syarikat Bekalan Pejabat (mock)', 'supplier', '201901000001 (mock)', 'Maybank'],
        ['Uniform Maju Sdn Bhd (mock)', 'supplier', '201501000002 (mock)', 'CIMB Bank'],
        ['Kenderaan Ronda Sdn Bhd (mock)', 'supplier', '201801000003 (mock)', 'Public Bank'],
        ['Tenaga Nasional Berhad (mock)', 'other', '199001009294 (mock)', 'Maybank'],
        ['Lembaga Hasil Dalam Negeri (mock)', 'tax', 'LHDN (mock)', 'CIMB Bank'],
        ['KWSP (mock)', 'statutory', 'KWSP (mock)', 'Maybank'],
        ['Jabatan Kastam Diraja Malaysia (mock)', 'tax', 'RMCD (mock)', 'Bank Islam'],
      ];
      const payeeFor = (f: (typeof t1)[number], name: string) => `payee-${f.companyId}-${String(PAYEES.findIndex((x) => x[0] === name) + 1).padStart(3, '0')}`;
      t1.forEach((f) => {
        f.payees = PAYEES.map(([name, kind, regNo, bank], j) => {
          const changed = j === 1;
          return {
            id: `payee-${f.companyId}-${String(j + 1).padStart(3, '0')}`,
            name,
            kind,
            regNo,
            bank,
            accountLast4: String(1000 + j * 1111).slice(-4),
            accountName: name.replace(' (mock)', '').toUpperCase(),
            status: changed ? ('pending' as const) : ('verified' as const),
            entered: { ...(changed ? DEP : LEAD), at: at(changed ? 3 : 900), comment: changed ? 'Letter from supplier dated today asks to change account (mock)' : 'Supplier registration form (mock)' },
            verified: changed
              ? null
              : { ...DEP, at: at(890), comment: 'Confirmed by phone.', method: 'callback' as const, contact: 'Accounts clerk (mock)', numberSource: 'Number on the signed supply contract (mock)' },
            history: changed ? [{ bank: 'Maybank', accountLast4: '0001', accountName: 'UNIFORM MAJU SDN BHD', until: at(3), by: DEP.by }] : [],
          };
        });
        f.sst = { registered: f.companyId !== 'pwvsb', sstNo: f.companyId !== 'pwvsb' ? `W10-1808-3100${String(t1.indexOf(f)).padStart(4, '0')} (mock)` : null, cycleStartMonth: 1, last12Months: null, returns: [] };
        // e-Invoice (1 Nov 2026): in scope through the group (a related company has revenue of RM3 million or more).
        f.einvoice = {
          setup: {
            required: true,
            basis: 'Own turnover above RM3 million (each company is its own entity) (mock)',
            startOn: '2024-08-01',
            via: 'sql_account',
            revenue: 12_000_000,
            set: { ...LEAD, at: at(2000), comment: '' },
          },
          months: [],
        };
        // Invoice problems (1 Nov 2026): the year to 31 Dec 2025 is audited; two stuck invoices to show the process.
        f.auditedTo = { date: '2025-12-31', set: { ...FD, at: at(3000), comment: 'Audit report signed by the external auditor (mock)' } };
        const inv = (d: number) => addDays(today, -d);
        f.arCases = [
          {
            id: `ar-${f.companyId}-1`,
            invoiceNo: `IV-${f.companyId.slice(-2).toUpperCase()}-0712`,
            invoiceDate: inv(100),
            customer: 'Pengurusan Bangunan Seri (mock)',
            amount: 48_600,
            outstanding: 48_600,
            eInvoiceUuid: null,
            reason: 'wrong_payer',
            detail: 'Site management changed in June; the new managing agent pays, the old one refuses the invoice (mock).',
            status: 'open',
            opened: { ...DE, at: at(24 * 40), comment: '' },
            log: [{ kind: 'call', text: 'Called the new managing agent; they need the invoice in their name (mock).', ...DEP, at: at(24 * 35) }],
            nextOn: inv(20),
            reissue: null,
            provision: null,
            writeOff: null,
          },
          {
            id: `ar-${f.companyId}-3`,
            invoiceNo: `IV-${f.companyId.slice(-2).toUpperCase()}-0402`,
            invoiceDate: inv(210),
            customer: 'Jabatan Kerja Raya Negeri (mock)',
            amount: 136_800,
            outstanding: 136_800,
            eInvoiceUuid: null,
            reason: 'govt_late',
            detail: 'Government site: payment voucher still being processed by the department (mock).',
            status: 'open',
            opened: { ...DE, at: at(24 * 120), comment: '' },
            log: [{ kind: 'call', text: 'Department finance says the voucher is with the state treasury (mock).', ...DEP, at: at(24 * 12) }],
            nextOn: addDays(today, 18),
            reissue: null,
            provision: null,
            writeOff: null,
          },
          {
            id: `ar-${f.companyId}-2`,
            invoiceNo: `IV-${f.companyId.slice(-2).toUpperCase()}-0311`,
            invoiceDate: '2025-11-30',
            customer: 'Kilang Plastik Jaya Sdn Bhd (mock)',
            amount: 22_140,
            outstanding: 22_140,
            eInvoiceUuid: null,
            reason: 'insolvent',
            detail: 'Customer wound up; liquidator appointed (mock).',
            status: 'open',
            opened: { ...DE, at: at(24 * 200), comment: '' },
            log: [
              { kind: 'demand_letter', text: 'Letter of demand sent by the company lawyer (mock).', ...DEP, at: at(24 * 150) },
              { kind: 'lawyer', text: 'Proof of debt filed with the liquidator (mock).', ...LEAD, at: at(24 * 10) },
            ],
            nextOn: null,
            reissue: null,
            provision: null,
            writeOff: null,
          },
        ];
      });
      // Regular payments and guarantees (Fauzan, 2 Nov 2026): a sample on one company of team 1 only.
      {
        const f = t1.find((x) => x.companyId !== GROUP_EMPLOYER_ID) ?? t1[0];
        const first = `${addMonths(today, -2).slice(0, 7)}`;
        const reg = (n: number, x: Partial<NonNullable<typeof f.regular>[number]> & Pick<NonNullable<typeof f.regular>[number], 'kind' | 'name' | 'payeeId' | 'reference'>) => ({
          id: `reg-${f.companyId}-${String(n).padStart(3, '0')}`,
          companyId: f.companyId,
          payee: f.payees!.find((p) => p.id === x.payeeId)!.name,
          body: null,
          zakatFor: null,
          method: 'transfer' as const,
          bankId: f.banks[0].id,
          every: 'monthly' as const,
          dueDay: 15,
          firstDue: `${first}-15`,
          lastDue: null,
          amount: null,
          financed: null,
          expiresOn: null,
          subject: 'finance' as const,
          status: 'active' as const,
          added: { ...DE, at: at(24 * 70), comment: '' },
          checked: { ...DEP, at: at(24 * 69), comment: 'Agreed to the agreement or letter (mock)' },
          ended: null,
          dues: [],
          ...x,
        });
        const pid = (name: string) => payeeFor(f, name);
        f.regular = [
          reg(1, { kind: 'hire_purchase', name: 'Patrol van hire purchase (mock)', payeeId: pid('Kenderaan Ronda Sdn Bhd (mock)'), reference: 'HP-778812 (mock)', method: 'direct_debit', dueDay: 5, firstDue: `${first}-05`, lastDue: addDays(today, 365 * 3), amount: 2_150, financed: { principal: 98_000, instalments: 48, security: 'Van VEX 1234 (mock)' }, subject: 'transport' }),
          reg(2, { kind: 'bill', name: 'Office electricity (mock)', payeeId: pid('Tenaga Nasional Berhad (mock)'), reference: 'TNB 2200-1234 (mock)', dueDay: 20, firstDue: `${first}-20` }),
          reg(3, { kind: 'statutory', body: 'EPF', name: 'EPF contributions (mock)', payeeId: pid('KWSP (mock)'), reference: 'Employer no 12345678 (mock)' }),
          reg(4, { kind: 'statutory', body: 'LHDN PCB', name: 'PCB (monthly tax deductions) (mock)', payeeId: pid('Lembaga Hasil Dalam Negeri (mock)'), reference: 'E 1234567-08 (mock)' }),
          reg(5, { kind: 'loan', name: 'Office building loan (mock)', payeeId: pid('Syarikat Bekalan Pejabat (mock)'), reference: 'TL-55021 (mock)', method: 'direct_debit', dueDay: 1, firstDue: `${first}-01`, lastDue: addDays(today, 365 * 15), amount: 8_900, financed: { principal: 1_200_000, instalments: 240, security: 'Office lot, Shah Alam (mock)' }, status: 'pending', checked: null }),
        ];
        f.guarantees = [
          {
            id: `gtee-${f.companyId}-001`,
            companyId: f.companyId,
            kind: 'IG',
            issuer: 'Insurans Jaminan Berhad (mock)',
            number: 'IG-2025-0091 (mock)',
            beneficiary: 'Hospital client (mock)',
            purpose: 'Guarding contract 2025-2026 (mock)',
            amount: 50_000,
            collateral: 15_000,
            bankId: f.banks[0].id,
            issuedOn: addDays(today, -400),
            expiresOn: addDays(today, -20),
            status: 'active',
            added: { ...DE, at: at(24 * 400), comment: 'IG letter (mock).pdf' },
            checked: { ...DEP, at: at(24 * 399), comment: 'Agreed to the insurer letter (mock)' },
            release: null,
            claim: null,
            refund: null,
            called: null,
            extensions: [],
          },
        ];
      }
      t1.forEach((f, i) => {
        const o = i * 10;
        f.payments = [
          mk(f, o + 1, 'Syarikat Bekalan Pejabat (mock)', 'supplier', 'Office supplies, October', 4_820.5, [{ step: 'prepared', who: DE, h: 5, comment: '' }]),
          mk(f, o + 2, 'Uniform Maju Sdn Bhd (mock)', 'supplier', 'Guard uniforms, batch 3', 18_400, [
            { step: 'prepared', who: DE, h: 30, comment: '' },
            { step: 'reviewed', who: DEP, h: 20, comment: 'Matches the PO and the delivery order.' },
          ]),
          // Transport is a department the COO monitors, so the COO (or the CEO) approves it (Fauzan, 1 Nov 2026).
          {
            ...mk(f, o + 3, 'Kenderaan Ronda Sdn Bhd (mock)', 'supplier', 'Patrol vehicle lease, quarter 4', 120_000, [
              { step: 'prepared', who: DE, h: 50, comment: '' },
              { step: 'reviewed', who: DEP, h: 40, comment: 'Lease schedule checked.' },
            ]),
            subject: 'transport' as const,
            needs: 'coo' as const,
          },
          mk(f, o + 4, 'Tenaga Nasional Berhad (mock)', 'other', 'Office electricity, September', 2_310.4, [
            { step: 'prepared', who: DE, h: 70, comment: '' },
            { step: 'reviewed', who: DEP, h: 60, comment: 'Bill checked.' },
            { step: 'approved', who: LEAD, h: 50, comment: 'OK to pay.' },
          ]),
          mk(f, o + 5, 'Lembaga Hasil Dalam Negeri (mock)', 'tax', 'CP204 instalment', 35_000, [
            { step: 'prepared', who: DE, h: 200, comment: '' },
            { step: 'reviewed', who: DEP, h: 190, comment: 'Instalment per CP204 schedule.' },
            { step: 'approved', who: FD, h: 180, comment: 'Approved.' },
            { step: 'released', who: LEAD, h: 170, comment: '' },
          ]),
          ...(i === 0
            ? [
                mk(f, o + 6, 'KWSP (mock)', 'statutory', 'Group EPF contributions, October', 650_000, [
                  { step: 'prepared', who: DE, h: 10, comment: '' },
                  { step: 'reviewed', who: LEAD, h: 6, comment: 'Agrees to the payroll summary.' },
                ]),
              ]
            : []),
        ];
      });
    }
  }

  // Contracts and site mobilisation (V6 amendment): one contract per pilot client account, plus two new sites being
  // mobilised and one awarded for each pilot company. Test data only.
  {
    const nowMs = toMs(now);
    const at = (d: number) => fromMs(nowMs - d * 86_400_000);
    const done = (items: ReturnType<typeof mobilisationFor>, by: string, daysAgo: number) =>
      items.map((i) => ({ ...i, status: 'done' as const, by, at: at(daysAgo), note: '' }));
    const sla = { replaceAbsentMinutes: 60, incidentReportHours: 24, monthlyReportByDay: 7 };
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const prevP = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    let n = 0;
    const reviewLeft = new Set<string>();
    for (const a of ds.clientAccounts) {
      n += 1;
      // One new client per company still has its day 14 review to do.
      const leaveReview = a.stage === 'onboarding' && !reviewLeft.has(a.companyId);
      if (leaveReview) reviewLeft.add(a.companyId);
      const sites = ds.sites.filter((x) => a.siteIds.includes(x.id));
      const armed = sites.some((x) => x.armed);
      const posts = ds.posts.filter((p) => a.siteIds.includes(p.siteId));
      const guards = posts.reduce((k, p) => k + p.guardsPerShift, 0) || 1;
      // Rates that match last month's invoice, except a few where the invoice is short.
      const inv = a.invoices?.find((i) => i.period === prevP)?.amount ?? null;
      const rate = Math.round(((inv ?? guards * 24 * 30.5 * 10) / (guards * 24 * 30.5)) * (n % 9 === 0 ? 1.05 : 1) * 100) / 100;
      const cPosts = (posts.length ? posts : [{ id: null, name: 'Main post', guardsPerShift: 1 }]).map((p) => ({
        postId: p.id as string | null,
        label: p.name,
        guards: p.guardsPerShift,
        hoursPerDay: 24,
        armed,
        rate,
      }));
      const code = ds.companies.find((c) => c.id === a.companyId)?.code ?? 'CO';
      const startOn = a.startedOn;
      const mob = mobilisationFor(startOn, armed);
      const reviews = reviewsFor(startOn).map((r) =>
        r.dueOn <= today && !(leaveReview && r.day === 14)
          ? {
              ...r,
              doneAt: `${r.dueOn}T16:00:00+08:00`,
              by: 'Operations Manager (mock)',
              note: 'Service running to the post orders.',
              ...(r.day === 30 ? { invoiceChecked: true } : {}),
            }
          : r,
      );
      const v1 = {
        version: 1,
        effectiveFrom: startOn,
        billingMethod: 'M1' as const,
        posts: cPosts,
        fixedFee: null,
        sla,
        penalties: 'RM100 for each hour a post is unmanned after the replacement time.',
        signedRef: `${code}/CT/${String(n).padStart(4, '0')}`,
        reason: 'Original contract',
        by: 'Company Manager (mock)',
        at: `${startOn}T10:00:00+08:00`,
      };
      // One contract per company moved from Method 1 to Method 3 by a signed variation three months ago.
      const varied = n % 25 === 5;
      const v2At = addDays(`${today.slice(0, 7)}-01`, -90).slice(0, 7) + '-01';
      ds.contracts.push({
        id: `ct-${a.id}`,
        companyId: a.companyId,
        clientAccountId: a.id,
        clientName: a.name,
        siteIds: a.siteIds,
        ref: v1.signedRef,
        state: 'active',
        startOn,
        endOn: a.contractEndsOn ?? addDays(startOn, 730),
        versions:
          varied && v2At > startOn
            ? [
                v1,
                {
                  ...v1,
                  version: 2,
                  effectiveFrom: v2At,
                  billingMethod: 'M3',
                  signedRef: `${v1.signedRef}/V1`,
                  reason: 'Client asked to be billed on actual days in the month',
                  at: `${addDays(v2At, -14)}T11:00:00+08:00`,
                },
              ]
            : [v1],
        mobilisation: done(mob, 'Admin executive (mock)', Math.max(0, daysBetween(startOn, today) + 2)),
        rtoCert: { by: 'Company Manager (mock)', at: `${addDays(startOn, -1)}T17:00:00+08:00`, note: 'All critical items done.' },
        reviews,
        history: [
          { at: `${addDays(startOn, -14)}T09:00:00+08:00`, by: 'Company Manager (mock)', from: null, to: 'awarded', note: 'Contract signed' },
          { at: `${startOn}T07:00:00+08:00`, by: 'Company Manager (mock)', from: 'ready', to: 'active', note: '' },
        ],
      });
    }
    // New sites: one mobilising (starts in 4 days, two critical items still open), one just awarded (starts in 12 days).
    for (const cid of ['co-sasa', 'co-arsh', 'co-inas']) {
      const code = ds.companies.find((c) => c.id === cid)?.code ?? 'CO';
      const mk = (k: number, name: string, startIn: number, state: 'awarded' | 'mobilising', armed: boolean) => {
        const startOn = addDays(today, startIn);
        const mob = mobilisationFor(startOn, armed).map((i, j) =>
          state === 'mobilising' && i.dueOn < today && j !== 3 ? { ...i, status: 'done' as const, by: 'Admin executive (mock)', at: at(2), note: '' } : i,
        );
        const ref = `${code}/CT/N${k}`;
        ds.contracts.push({
          id: `ct-${cid}-new${k}`,
          companyId: cid,
          clientAccountId: null,
          clientName: name,
          siteIds: [],
          ref,
          state,
          startOn,
          endOn: addDays(startOn, 730),
          versions: [
            {
              version: 1,
              effectiveFrom: startOn,
              billingMethod: k === 1 ? 'M2' : 'FIXED',
              posts: [
                { postId: null, label: 'Main gate', guards: 2, hoursPerDay: 24, armed, rate: 10.5, contractedHours: 312 },
                { postId: null, label: 'Patrol', guards: 1, hoursPerDay: 12, armed: false, rate: 10.5, contractedHours: 312 },
              ],
              fixedFee: k === 1 ? null : 28_500,
              sla,
              penalties: 'RM100 for each hour a post is unmanned after the replacement time.',
              signedRef: ref,
              reason: 'Original contract',
              by: 'Company Manager (mock)',
              at: at(10),
            },
          ],
          mobilisation: mob,
          rtoCert: null,
          reviews: reviewsFor(startOn),
          history: [
            { at: at(10), by: 'Company Manager (mock)', from: null, to: 'awarded', note: k === 1 ? 'Letter of award received' : 'Contract signed' },
            ...(state === 'mobilising' ? [{ at: at(9), by: 'Company Manager (mock)', from: 'awarded' as const, to: 'mobilising' as const, note: '' }] : []),
          ],
        });
      };
      mk(1, `New client site A (${code}, mock)`, 4, 'mobilising', cid === 'co-sasa');
      mk(2, `New client site B (${code}, mock)`, 12, 'awarded', false);
    }
  }

  // Branches (V11, V12, V12.1): signed agreements, last month's settlement and what each branch did. Test data only;
  // the percentages are examples, never defaults.
  {
    const nowMs = toMs(now);
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const back = (k: number) => {
      const d = new Date(Date.UTC(y, m - 1 - k, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const prevP = back(1);
    const TERMS: Record<string, { pct?: number | null; salary?: number }> = { A: { pct: 8 }, B: { salary: 7500 }, C: { pct: 55 } };
    const MANAGERS = ['Branch Manager Selangor (mock)', 'Branch Manager KL (mock)', 'Branch Manager South (mock)', 'Branch Manager North (mock)'];
    const KINDS: [BranchAction['kind'], BranchAction['control'], string, number | null][] = [
      ['expense', 'M', 'Paid for guard post repairs', 850],
      ['roster', 'M', 'Swapped two guards between night shifts', null],
      ['purchase', 'C', 'Wants to buy 6 new radios', 4_200],
      ['client', 'M', 'Agreed a temporary extra guard for a client event', null],
      ['staff', 'C', 'Wants to hire a branch clerk', null],
      ['expense', 'M', 'Paid for uniforms alterations', 320],
    ];
    let k = 0;
    for (const b of ds.branches.filter((x) => ['co-sasa', 'co-arsh', 'co-inas'].includes(x.companyId))) {
      k += 1;
      const t = TERMS[b.model];
      // One Model C branch has no percentage in its signed agreement, so its settlement waits for contract review.
      const missing = b.id === 'br-inas-3';
      b.agreements = [
        {
          version: 1,
          effectiveFrom: `${back(14)}-01`,
          model: b.model,
          managerName: MANAGERS[k % MANAGERS.length],
          managerKind: b.model === 'B' ? 'employee' : 'partner_company',
          companyBillingSharePct: b.model === 'A' ? (t.pct ?? null) : null,
          companyNetProfitSharePct: b.model === 'C' ? (missing ? null : (t.pct ?? null)) : null,
          managerSalary: b.model === 'B' ? (t.salary ?? null) : null,
          signedRef: `${b.id.toUpperCase()}/AGR/1`,
          by: 'Company Manager (mock)',
          at: fromMs(nowMs - 400 * 86_400_000),
        },
      ];
      const siteIds = ds.sites.filter((x) => x.branchId === b.id).map((x) => x.id);
      const billing = Math.round(
        ds.contracts
          .filter((c) => c.state === 'active' && c.siteIds.some((id) => siteIds.includes(id)))
          .reduce((n, c) => n + contractBilling(c.versions[c.versions.length - 1], prevP).total, 0),
      );
      const costShare = b.model === 'A' && k % 2 === 0 ? 0.95 : 0.84;
      const mk = (period: string, status: BranchSettlement['status'], f: number) => ({
        id: `bs-${b.id}-${period}`,
        companyId: b.companyId,
        branchId: b.id,
        period,
        billing: Math.round(billing * f),
        costs: {
          wages: Math.round(billing * f * costShare * 0.82),
          statutory: Math.round(billing * f * costShare * 0.11),
          other: Math.round(billing * f * costShare * 0.07),
        },
        status,
        approvedBy: status === 'draft' ? null : 'Company Manager (mock)',
        approvedAt: status === 'draft' ? null : `${back(1)}-08T11:00:00+08:00`,
      });
      ds.branchSettlements.push(mk(back(2), 'approved', 0.98), mk(prevP, 'draft', 1));
      for (let j = 0; j < 3; j++) {
        const [kind, control, title, amount] = KINDS[(k + j) % KINDS.length];
        const age = [1, 5, 9][(k + j) % 3];
        const reviewed = j === 2 && k % 2 === 0;
        ds.branchActions.push({
          id: `ba-${b.id}-${j + 1}`,
          companyId: b.companyId,
          branchId: b.id,
          control,
          kind,
          title,
          amount,
          at: fromMs(nowMs - age * 86_400_000),
          by: b.agreements[0].managerName,
          status: reviewed ? 'accepted' : 'awaiting',
          reviewedBy: reviewed ? 'Company Manager (mock)' : null,
          reviewedAt: reviewed ? fromMs(nowMs - 86_400_000) : null,
          note: '',
        });
      }
    }
  }

  // IT (Fauzan, 27 Oct 2026): IT and electronic assets through their full lifecycle, domains and websites, help
  // requests, joining and leaving, the IT part of tenders and purchases. Test data only.
  {
    const nowMs = toMs(now);
    const ago = (h: number) => fromMs(nowMs - h * 3_600_000);
    const r = new Rng(9_027);
    const owners = [GROUP_EMPLOYER_ID, ...ds.companies.map((c) => c.id)];
    const pilots = ['co-sasa', 'co-arsh', 'co-inas'];
    const KINDS: [ItAssetKind, string, number][] = [
      ['LAPTOP', 'Lenovo ThinkPad E14', 90],
      ['DESKTOP', 'Dell OptiPlex 3000', 30],
      ['PHONE', 'Samsung Galaxy A35 (site phone)', 80],
      ['TABLET', 'Samsung Galaxy Tab A9 (site tablet)', 40],
      ['PRINTER', 'HP LaserJet MFP', 20],
      ['NETWORK', 'TP-Link Omada router', 15],
      ['CCTV', 'Hikvision 8-channel NVR', 20],
      ['OTHER', 'APC UPS 1kVA', 5],
    ];
    let n = 0;
    for (const [kind, model, count] of KINDS)
      for (let i = 0; i < count; i++) {
        n += 1;
        const ownerId = i % 3 === 0 ? GROUP_EMPLOYER_ID : i % 5 === 0 ? owners[i % owners.length] : pilots[i % pilots.length];
        const boughtDays = r.int(60, 1600);
        const roll = r.float();
        const status: ItAsset['status'] = roll < 0.04 ? 'repair' : roll < 0.06 ? 'disposal_pending' : roll < 0.16 ? 'spare' : 'in_use';
        const scheduled = ['CCTV', 'NETWORK', 'PRINTER'].includes(kind);
        const checkedDays = r.float() < 0.12 ? r.int(400, 700) : r.int(5, 300);
        ds.itAssets.push({
          id: `ita-${n}`,
          tag: `IT-${String(n).padStart(5, '0')}`,
          kind,
          model,
          serial: `SN${(100000 + n * 37).toString(36).toUpperCase()}`,
          ownerId,
          assignedTo:
            status === 'in_use' ? (['PHONE', 'TABLET', 'CCTV', 'NETWORK'].includes(kind) ? `Site ${(n % 40) + 1} (mock)` : `Staff member ${n} (mock)`) : null,
          location: status === 'in_use' ? (ownerId === GROUP_EMPLOYER_ID ? 'PWVSB office' : 'Company office or site') : 'IT store, PWVSB',
          boughtOn: addDays(today, -boughtDays),
          warrantyTo: addDays(today, -boughtDays + (kind === 'LAPTOP' ? 1095 : 365)),
          status,
          lastCheckedOn: addDays(today, -checkedDays),
          purchaseId: null,
          maintenance:
            status === 'repair'
              ? [{ at: ago(r.int(24, 240)), by: 'IT Executive 2 (mock)', kind: 'repair', note: 'Sent to the service centre', cost: 0 }]
              : scheduled
                ? [{ at: ago(r.int(500, 4000)), by: 'IT Executive 1 (mock)', kind: 'service', note: 'Routine service', cost: 120 }]
                : [],
          nextServiceOn: scheduled ? addDays(today, r.int(-20, 180)) : null,
          disposal:
            status === 'disposal_pending'
              ? { reason: 'Beyond economic repair (mock)', askedBy: 'IT Lead (mock)', askedAt: ago(r.int(24, 300)), doneBy: null, doneAt: null }
              : null,
        });
      }

    // Domains and websites: one domain and one website per pilot, the group's, and the rest per company.
    const DOMAINS = ds.companies.slice(0, 20).map((c) => c.id);
    let d = 0;
    for (const ownerId of [GROUP_EMPLOYER_ID, ...DOMAINS]) {
      const code = ownerId === GROUP_EMPLOYER_ID ? 'pwvsb' : ownerId.replace('co-', '');
      for (const kind of ['domain', 'website'] as const) {
        if (kind === 'website' && d % 3 === 2 && !pilots.includes(ownerId) && ownerId !== GROUP_EMPLOYER_ID) continue;
        d += 1;
        const roll = r.float();
        const days = roll < 0.06 ? r.int(-10, -1) : roll < 0.14 ? r.int(1, 14) : roll < 0.3 ? r.int(15, 60) : r.int(61, 700);
        const stale = r.float() < 0.1;
        const noDate = d % 17 === 0;
        ds.itDomains.push({
          id: `itd-${d}`,
          name: kind === 'domain' ? `${code}-security.com.my` : `www.${code}-security.com.my`,
          kind,
          ownerId,
          registrar: kind === 'domain' ? (d % 2 ? 'MYNIC via Exabytes' : 'Shinjiru') : 'Hosted at Exabytes (Malaysia)',
          expiresOn: noDate ? null : addDays(today, days),
          sslExpiresOn: kind === 'website' ? addDays(today, r.float() < 0.1 ? r.int(-3, 20) : r.int(30, 90)) : null,
          lastCheckAt: stale ? (d % 2 ? null : ago(r.int(30, 200))) : ago(r.int(0, 6)),
          up: kind === 'website' && !stale ? r.float() > 0.08 : null,
        });
      }
    }

    // Help requests.
    const people = ds.users.filter((u) => !u.integration && u.role !== 'site_device' && u.department !== 'it');
    const TICKETS: [ItTicket['category'], ItTicket['priority'], string][] = [
      ['M365', 'P3', 'Cannot open shared mailbox in Outlook'],
      ['DEVICE', 'P2', 'Laptop very slow after update'],
      ['PRIMA', 'P2', 'Cannot see my company in Prima'],
      ['NETWORK', 'P1', 'Office internet down'],
      ['ACCOUNT', 'P2', 'Password locked out'],
      ['M365', 'P3', 'Teach me to use Teams meetings'],
      ['DEVICE', 'P1', 'Site phone not charging'],
      ['OTHER', 'P3', 'Need a second monitor'],
      ['M365', 'P2', 'OneDrive not syncing'],
    ];
    for (let i = 0; i < 26; i++) {
      const [category, priority, title] = TICKETS[i % TICKETS.length];
      const by = people[(i * 7) % people.length];
      const ageH = r.int(1, 120);
      const st: ItTicket['status'] = i < 14 ? 'resolved' : i < 20 ? 'in_progress' : 'open';
      const sla = RULES.it.value.slaHours[priority];
      ds.itTickets.push({
        id: `it-t-${i + 1}`,
        ref: `IT-${String(i + 1).padStart(4, '0')}`,
        raisedBy: by.name,
        raisedById: by.id,
        category,
        priority,
        title,
        detail: '',
        at: ago(ageH),
        assignedTo: st === 'open' ? null : `IT Executive ${(i % 4) + 1} (mock)`,
        assignedToId: st === 'open' ? (i === 24 ? 'u-it-ex2' : null) : `u-it-ex${(i % 4) + 1}`,
        status: st,
        resolvedAt: st === 'resolved' ? fromMs(toMs(ago(ageH)) + (i % 5 === 0 ? sla + 2 : Math.max(1, sla / 3)) * 3_600_000) : null,
        resolution: st === 'resolved' ? (category === 'M365' ? 'Walked through it with the staff member' : 'Fixed and tested with the staff member') : '',
        confirmedAt: st === 'resolved' && i % 3 !== 0 ? ago(Math.max(0, ageH - 6)) : null,
        reopened: i === 15 || i === 3 ? 1 : 0,
      });
      if (i === 24) ds.itTickets[ds.itTickets.length - 1].assignedTo = 'IT Executive 2 (mock)';
    }
    // The COO's own request, so the COO's screen shows how "my requests" looks.
    ds.itTickets.push({
      id: 'it-t-coo-1',
      ref: 'IT-0027',
      raisedBy: 'Ahmad Faisal bin Zainal',
      raisedById: 'u-coo',
      category: 'M365',
      priority: 'P3',
      title: 'Set up Outlook on new phone',
      detail: '',
      at: ago(5),
      assignedTo: 'IT Executive 3 (mock)',
      assignedToId: 'u-it-ex3',
      status: 'in_progress',
      resolvedAt: null,
      resolution: '',
    });

    // Joining and leaving.
    const JOIN = [
      ['m365', 'Microsoft 365 account and mailbox'],
      ['device', 'Laptop or phone issued and tagged'],
      ['prima', 'Prima access with the right role'],
      ['training', 'Microsoft 365 training given'],
    ];
    const LEAVE = [
      ['m365', 'Microsoft 365 account blocked, mail forwarded'],
      ['device', 'Devices returned and checked'],
      ['prima', 'Prima access removed'],
    ];
    const OB: [ItOnboarding['kind'], string, string, Id, number, number][] = [
      ['join', 'New admin executive (mock)', 'Admin Executive', 'co-sasa', 2, 1],
      ['join', 'New HR executive (mock)', 'HR Executive', GROUP_EMPLOYER_ID, -1, 2],
      ['join', 'New finance data entry (mock)', 'Finance Data Entry Executive', GROUP_EMPLOYER_ID, 6, 0],
      ['leave', 'Leaving admin executive (mock)', 'Admin Executive', 'co-arsh', 1, 1],
      ['join', 'New operations manager (mock)', 'Operations Manager', 'co-inas', -6, 4],
    ];
    OB.forEach(([kind, personName, jobTitle, ownerId, offset, done], i) =>
      ds.itOnboarding.push({
        id: `itob-${i + 1}`,
        kind,
        personName,
        jobTitle,
        ownerId,
        on: addDays(today, offset),
        steps: (kind === 'join' ? JOIN : LEAVE).map(([key, label], k) => ({
          key,
          label,
          doneAt: k < done ? ago(24 * (k + 1)) : null,
          by: k < done ? 'IT Executive 1 (mock)' : null,
        })),
        ownerStaffId: i === 2 ? null : `u-it-ex${(i % 4) + 1}`,
      }),
    );

    // Purchases in every state.
    const P: [ItPurchase['status'], Id, string, string, [ItAssetKind, string, number, number][], Id][] = [
      [
        'submitted',
        'u-it-ex1',
        'IT Executive 1 (mock)',
        'Replace 5 laptops past 4 years (mock)',
        [['LAPTOP', 'Lenovo ThinkPad E14 Gen 6', 5, 3_450]],
        GROUP_EMPLOYER_ID,
      ],
      [
        'procurement',
        'u-it-ex2',
        'IT Executive 2 (mock)',
        'Site tablets for the two new co-sasa contracts',
        [['TABLET', 'Samsung Galaxy Tab A9', 4, 799]],
        'co-sasa',
      ],
      [
        'submitted',
        'u-it-lead',
        'IT Lead (mock)',
        'CCTV recorder for the Arrow Shield office',
        [
          ['CCTV', 'Hikvision 8-channel NVR', 1, 1_890],
          ['OTHER', '4TB surveillance drive', 2, 520],
        ],
        'co-arsh',
      ],
      ['procurement', 'u-it-ex3', 'IT Executive 3 (mock)', 'Printer for the Inas office', [['PRINTER', 'HP LaserJet MFP 4103', 1, 2_150]], 'co-inas'],
      ['procurement', 'u-it-ex4', 'IT Executive 4 (mock)', 'Spare site phones', [['PHONE', 'Samsung Galaxy A35', 6, 1_299]], GROUP_EMPLOYER_ID],
      ['received', 'u-it-ex1', 'IT Executive 1 (mock)', 'Network switch for PWVSB office', [['NETWORK', 'TP-Link 24-port switch', 1, 980]], GROUP_EMPLOYER_ID],
      ['rejected', 'u-it-ex2', 'IT Executive 2 (mock)', 'Gaming monitor (mock)', [['OTHER', '32-inch monitor', 1, 2_400]], GROUP_EMPLOYER_ID],
    ];
    P.forEach(([status, byId, by, reason, lines, ownerId], i) => {
      const items = lines.map(([kind, description, qty, unitPrice]) => ({ kind, description, qty, unitPrice }));
      const at = ago(24 * (9 - i));
      const after = (h: number) => fromMs(toMs(at) + h * 3_600_000);
      const past = (s: ItPurchase['status'][]) => s.includes(status);
      ds.itPurchases.push({
        id: `itp-${i + 1}`,
        ref: `ITP-${String(i + 1).padStart(4, '0')}`,
        ownerId,
        requestedBy: by,
        requestedById: byId,
        at,
        reason,
        items,
        total: items.reduce((s, x) => s + x.qty * x.unitPrice, 0),
        status,
        managerStep: past(['procurement', 'received', 'rejected'])
          ? { by: 'IT Manager (mock)', at: after(4), note: status === 'rejected' ? 'Not a work need' : '' }
          : null,
        cooStep: null,
        purRequestId: null,
        received: null,
      });
    });
    // The received purchase's switch is in the register.
    const rec = ds.itPurchases.find((p) => p.status === 'received')!;
    const sw = ds.itAssets.find((a) => a.kind === 'NETWORK' && a.status === 'spare') ?? ds.itAssets.find((a) => a.kind === 'NETWORK')!;
    sw.purchaseId = rec.id;
    rec.received = { by: rec.requestedBy, at: fromMs(toMs(rec.at) + 72 * 3_600_000), assetIds: [sw.id] };
  }

  // IT jobs given by the IT Manager and IT Lead, in every state, and the systems the CEO owns (Fauzan, 28 Oct 2026).
  {
    const nowMs = toMs(now);
    const ago = (h: number) => fromMs(nowMs - h * 3_600_000);
    const day = (d: number) => addDays(today, d);
    const NAME: Record<string, string> = {
      'u-it-mgr': 'IT Manager (mock)',
      'u-it-lead': 'IT Lead (mock)',
      'u-it-ex1': 'IT Executive 1 (mock)',
      'u-it-ex2': 'IT Executive 2 (mock)',
      'u-it-ex3': 'IT Executive 3 (mock)',
      'u-it-ex4': 'IT Executive 4 (mock)',
    };
    // A tiny picture stands in for a screenshot or a signed form.
    const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const proof = (name: string, by: string, at: string) => [{ name, mime: 'image/png' as const, bytes: 70, sha256: sha256Hex(`${PIC}${name}`), data: PIC, by, at }];
    const J: [ItJob['kind'], string, ItJob['priority'], boolean, string, string, number, number, ItJob['status'], string, number?][] = [
      // kind, title, priority, technical, doer, giver, given hours ago, due in days, status, proof name, returns
      ['install', 'Set up the CCTV recorder at the Arrow Shield office', 'P2', true, 'u-it-ex2', 'u-it-mgr', 200, -9, 'doing', ''],
      ['check', 'Yearly check of 40 laptops at PWVSB HQ', 'P3', false, 'u-it-ex1', 'u-it-mgr', 300, -4, 'doing', ''],
      ['training', 'Microsoft 365 training for the new HR executives', 'P3', false, 'u-it-ex3', 'u-it-mgr', 120, -2, 'todo', ''],
      ['task', 'Replace the toner and test the Inas office printer', 'P3', false, 'u-it-ex4', 'u-it-lead', 30, 2, 'todo', ''],
      ['access', 'Set up Teams phones for the CMS room', 'P2', true, 'u-it-ex1', 'u-it-lead', 60, 5, 'doing', ''],
      ['install', 'Install the new network switch at PWVSB office', 'P2', true, 'u-it-ex4', 'u-it-mgr', 96, 1, 'submitted', 'Switch rack photo and port test.png'],
      ['task', 'Back up the Finance shared drive and test a restore', 'P1', true, 'u-it-ex3', 'u-it-mgr', 72, 0, 'checked', 'Restore test screenshot.png'],
      ['training', 'Outlook and OneDrive training for the Sasa admin team', 'P3', false, 'u-it-ex2', 'u-it-mgr', 150, -1, 'submitted', 'Attendance sheet signed.png'],
      ['check', 'Check the 6 site tablets returned from Sasa', 'P3', false, 'u-it-ex1', 'u-it-lead', 80, 3, 'returned', 'Tablet check list.png', 1],
      ['task', 'Renew the antivirus licences for 120 PCs', 'P2', false, 'u-it-lead', 'u-it-mgr', 400, -3, 'accepted', 'Licence certificate.png'],
      ['training', 'Teams meetings training for company managers', 'P3', false, 'u-it-ex4', 'u-it-mgr', 500, -5, 'accepted', 'Attendance sheet.png'],
      ['install', 'Wi-Fi access point for the training centre', 'P2', true, 'u-it-ex2', 'u-it-lead', 360, -12, 'accepted', 'Speed test result.png', 1],
    ];
    J.forEach(([kind, title, priority, technical, doer, giver, givenH, due, status, proofName, returns = 0], i) => {
      const at = ago(givenH);
      const submittedAt = ['submitted', 'checked', 'accepted', 'returned'].includes(status) ? ago(Math.max(2, givenH / 3)) : null;
      // Two accepted jobs were submitted after the due date, so the on-time rate is honest.
      const subAt = status === 'accepted' && i === 11 ? fromMs(toMs(`${day(due + 2)}T10:00:00+08:00`)) : submittedAt;
      const log: ItJob['log'] = [];
      if (status !== 'todo') log.push({ at: ago(givenH - 4), by: NAME[doer], byId: doer, what: 'start', note: '' });
      if (kind === 'install' && status === 'doing') log.push({ at: ago(48), by: NAME[doer], byId: doer, what: 'note', note: 'Waiting for the 4TB drive from Procurement' });
      if (returns) {
        log.push({ at: ago(givenH / 2), by: NAME[doer], byId: doer, what: 'submit', note: 'Done (1 proof file)' });
        log.push({ at: ago(givenH / 2 - 3), by: 'IT Manager (mock)', byId: 'u-it-mgr', what: 'return', note: 'Only 4 of the 6 tablets are on the list' });
      }
      if (subAt && status !== 'returned') log.push({ at: subAt, by: NAME[doer], byId: doer, what: 'submit', note: 'Done and tested (1 proof file)' });
      if (status === 'checked' || (status === 'accepted' && technical)) log.push({ at: ago(Math.max(1, givenH / 3 - 2)), by: 'IT Lead (mock)', byId: 'u-it-lead', what: 'check', note: 'Checked on site' });
      if (status === 'accepted') log.push({ at: ago(Math.max(1, givenH / 4)), by: 'IT Manager (mock)', byId: 'u-it-mgr', what: 'accept', note: '' });
      ds.itJobs.push({
        id: `itj-${i + 1}`,
        ref: `ITJ-${String(i + 1).padStart(4, '0')}`,
        kind,
        title,
        detail: '',
        priority,
        technical,
        assigneeId: doer,
        assignee: NAME[doer],
        givenById: giver,
        givenBy: NAME[giver],
        at,
        dueOn: day(due),
        status,
        log,
        proof: proofName ? proof(proofName, NAME[doer], subAt ?? at) : [],
        submittedAt: status === 'returned' ? null : subAt,
        checkedBy: status === 'checked' || (status === 'accepted' && technical) ? 'IT Lead (mock)' : null,
        acceptedBy: status === 'accepted' ? 'IT Manager (mock)' : null,
        acceptedAt: status === 'accepted' ? ago(Math.max(1, givenH / 4)) : null,
        returns,
      });
    });

    const op = (id: string, level: 'operator' | 'admin' = 'operator') => ({ userId: id, name: NAME[id], level, since: day(-200), grantedBy: 'Fauzan' });
    const A: [ItAccount['kind'], string, string, boolean | null, ReturnType<typeof op>[], number | null, string][] = [
      ['m365', 'Microsoft 365 tenant (group)', 'CEO safe, sealed envelope with recovery codes', true, [op('u-it-lead', 'admin'), op('u-it-ex1'), op('u-it-ex2'), op('u-it-ex3'), op('u-it-ex4')], 40, ''],
      ['azure', 'Azure subscription (Malaysia West)', 'CEO safe', true, [op('u-it-lead', 'admin')], 20, 'Prima will run here'],
      ['registrar', 'Domain registrar account (Exabytes)', 'CEO safe', true, [op('u-it-lead'), op('u-it-ex1')], 120, 'Every .com.my domain of the group'],
      ['dns', 'Cloudflare account (DNS and hosting)', 'CEO safe', false, [op('u-it-lead', 'admin'), op('u-it-ex3')], 60, 'Turn on two-step sign-in'],
      ['github', 'GitHub organisation (websites and Prima)', 'CEO phone and safe', true, [op('u-it-lead', 'admin')], 10, ''],
      ['sql_account', 'SQL Account (system administrator)', 'CEO safe', null, [op('u-it-lead')], null, 'Finance uses it every day; IT only supports'],
      ['network', 'Office firewall and Wi-Fi (PWVSB HQ)', 'IT store, sealed', false, [op('u-it-lead', 'admin'), op('u-it-ex4')], 200, 'Owner sign-in still with the installer'],
      ['cctv', 'CCTV recorders (offices)', 'CEO safe', false, [op('u-it-ex2'), op('u-it-ex4')], 150, ''],
      ['prima', 'Prima Secure App (system administrator)', 'CEO', true, [op('u-it-lead')], 5, 'Pilot'],
    ];
    A.forEach(([kind, name, masterKeptAt, mfa, access, reviewed, note], i) =>
      ds.itAccounts.push({
        id: `itac-${i + 1}`,
        name,
        kind,
        ownerId: 'u-fauzan',
        owner: 'Fauzan',
        masterKeptAt,
        mfa,
        access,
        reviewedOn: reviewed == null ? null : day(-reviewed),
        note,
      }),
    );
    ds.itAccessRequests.push(
      {
        id: 'itar-1',
        ref: 'ACC-0001',
        accountId: 'itac-3',
        action: 'grant',
        userId: 'u-it-ex2',
        name: NAME['u-it-ex2'],
        level: 'operator',
        reason: 'Covers domain renewals while IT Executive 1 is on leave',
        askedById: 'u-it-lead',
        askedBy: NAME['u-it-lead'],
        at: ago(20),
        status: 'waiting',
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
      },
      {
        id: 'itar-2',
        ref: 'ACC-0002',
        accountId: 'itac-7',
        action: 'remove',
        userId: 'u-it-ex4',
        name: NAME['u-it-ex4'],
        level: 'operator',
        reason: 'No longer looks after the HQ network',
        askedById: 'u-it-mgr',
        askedBy: NAME['u-it-mgr'],
        at: ago(6),
        status: 'waiting',
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
      },
    );

    // Pilot round (Fauzan, 28 Oct 2026). IT Executive 1 is paired with the IT Manager and does every IT tender.
    // Merdeka's rental bills for last month: issued and paid for the pilot companies (made-up prices).
    {
      const last = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      const rates = RULES.itRental.value.monthly;
      for (const cid of [GROUP_EMPLOYER_ID, 'co-sasa', 'co-arsh', 'co-inas']) {
        const mine = ds.itAssets.filter((a) => a.ownerId === cid && (a.status === 'in_use' || a.status === 'repair'));
        const kinds = [...new Set(mine.map((a) => a.kind))].sort();
        const lines = kinds.map((kind) => {
          const count = mine.filter((a) => a.kind === kind).length;
          return { kind, count, rate: rates[kind] ?? 0, amount: count * (rates[kind] ?? 0) };
        });
        ds.itRentalBills.push({
          id: `rent-${cid}-${last}`,
          companyId: cid,
          period: last,
          lines,
          total: lines.reduce((n, l) => n + l.amount, 0),
          invoiceRef: `MN-INV-${last.replace('-', '')}-${cid.replace('co-', '').toUpperCase()}`,
          issuedBy: 'Finance Director (mock)',
          issuedAt: myt(`${last}-28`, '10:00'),
          paid: cid === 'co-inas' ? null : { by: 'Finance Director (mock)', at: myt(`${today.slice(0, 7)}-05`, '15:00'), ref: `TRF-${last.replace('-', '')}-${cid.slice(-4).toUpperCase()}` },
        });
      }
    }
    ds.itSettings.push({ id: 'it', tenderExecId: 'u-it-ex1', managerAwayFrom: null, managerAwayUntil: null, setBy: NAME['u-it-mgr'] });
    // Which group companies hold MOF IT codes is checked by the IT Manager during the pilot (Fauzan, 28 Oct 2026); PWVSB,
    // the group company, holds none. Mock records below; Arrow Shield is shown as still to check.
    const mof = (who: string) => proof(`MOF certificate ${who} (mock).png`, NAME['u-it-mgr'], ago(30));
    ds.itCodeHolders.push(
      { id: 'itch-sasa', companyId: 'co-sasa', codes: [{ code: '210101', label: 'ICT hardware (mock)' }, { code: '210102', label: 'ICT software (mock)' }, { code: '210104', label: 'ICT network and CCTV (mock)' }], expiresOn: day(320), certNo: 'MOF-357-0001 (mock)', proof: mof('Sasa'), checkedBy: NAME['u-it-mgr'], checkedAt: ago(30), note: '' },
      { id: 'itch-inas', companyId: 'co-inas', codes: [{ code: '210102', label: 'ICT software (mock)' }, { code: '210103', label: 'ICT services and maintenance (mock)' }], expiresOn: day(24), certNo: 'MOF-357-0002 (mock)', proof: mof('Inas'), checkedBy: NAME['u-it-mgr'], checkedAt: ago(28), note: '' },
      { id: 'itch-04', companyId: 'co-04', codes: [{ code: '210101', label: 'ICT hardware (mock)' }], expiresOn: day(-12), certNo: 'MOF-357-0003 (mock)', proof: mof('co-04'), checkedBy: NAME['u-it-mgr'], checkedAt: ago(26), note: '' },
      { id: 'itch-06', companyId: 'co-06', codes: [], expiresOn: null, certNo: '', proof: mof('co-06'), checkedBy: NAME['u-it-mgr'], checkedAt: ago(25), note: 'Security and cleaning codes only' },
    );

    // IT tenders from eP in every stage, each step done in a set number of minutes against its target.
    const TT: [NonNullable<ItTenderTask['kind']>, Id, string, string, string[], number, number, Record<string, number>, ItTenderTask['stage']][] = [
      // kind, company, title, buyer, codes, found hours ago, closes in days, done steps with time taken as a share of the target, stage
      ['tender', 'co-sasa', 'Supply and install CCTV at 12 district offices (mock eP)', 'Jabatan Kerja Raya (mock)', ['210104'], 3, 18, { found: 0.8, go: 1.2 }, 'preparing'],
      ['quotation', 'co-sasa', 'Supply of 40 laptops and Microsoft 365 set-up (mock eP)', 'Pejabat Daerah Petaling (mock)', ['210101'], 30, 6, { found: 1, go: 1, download: 0.6, askdocs: 1, read: 1.5 }, 'preparing'],
      ['tender', 'co-sasa', 'Network upgrade for a state hospital (mock eP)', 'Kementerian Kesihatan (mock)', ['210101', '210104'], 120, 9, { found: 1, go: 0.7, download: 1, askdocs: 1, read: 0.9, briefing: 0, draft: 1.1, check: 0.8, gotdocs: 0.6, price: 1 }, 'preparing'],
      ['quotation', 'co-inas', 'Maintenance of attendance software, 12 months (mock eP)', 'Majlis Perbandaran Kajang (mock)', ['210103'], 60, 3, { found: 1, go: 1, download: 1, askdocs: 1, read: 0.8, draft: 0.9, check: 1, gotdocs: 0.5, price: 1, leaders: 0.5, handover: 1 }, 'handed_over'],
      ['tender', 'co-sasa', 'Guard tour and visitor system for a university (mock eP)', 'Universiti awam (mock)', ['210102'], 400, -8, { found: 1, go: 1, download: 1, askdocs: 1, read: 1, draft: 0.8, check: 1, gotdocs: 0.7, price: 1, leaders: 0.7, handover: 1, submit: 1, confirm: 0.5 }, 'submitted'],
    ];
    const ITEMS = ['Technical proposal', 'Hardware and software list', 'Compliance table against the specification', 'Price schedule (IT part)', 'Company IT experience and staff CVs'];
    const DOCS = ['MOF certificate (IT codes)', 'SSM company profile', 'Latest audited accounts', 'Bank statement (3 months)'];
    TT.forEach(([kind, companyId, title, buyer, codes, foundH, closeIn, done, stage], i) => {
      const closesOn = day(closeIn);
      const foundAt = ago(foundH);
      const steps = itTenderTimeline(kind, closesOn).filter((s) => kind === 'quotation' || i === 2 || s.key !== 'briefing');
      for (const s of steps) {
        const share = done[s.key];
        if (share == null) continue;
        const startAt = s.after ? steps.find((x) => x.key === s.after)?.doneAt : foundAt;
        if (!startAt) continue;
        const at = fromMs(toMs(startAt) + Math.round((s.minutes ?? 24 * 60) * share * 60_000));
        if (at > now) continue;
        s.doneAt = at;
        s.by = s.owner === 'manager' ? NAME['u-it-mgr'] : s.owner === 'lead' ? NAME['u-it-lead'] : s.owner === 'leader' ? (ds.users.find((u) => u.opsTier === 'coo')?.name ?? 'COO') : NAME['u-it-ex1'];
        if (s.key === 'briefing') s.note = 'Attended by IT Executive 1 (mock)';
        if (s.key === 'handover') s.note = 'Company admin executive (mock)';
        if (s.key === 'submit') s.note = 'slip eP-slip.png';
      }
      const isDone = (k: string) => !!steps.find((x) => x.key === k)?.doneAt;
      const doneAt = (k: string) => steps.find((x) => x.key === k)?.doneAt ?? null;
      const partsDone = isDone('draft') ? ITEMS.length : isDone('read') ? 2 : 0;
      const docsIn = isDone('gotdocs') ? DOCS.length : isDone('askdocs') ? 2 : 0;
      ds.itTenderTasks.push({
        id: `itt-ep-${i + 1}`,
        tenderId: '',
        companyId,
        title,
        closesOn,
        buyer,
        source: 'eP (ePerolehan)',
        codes,
        kind,
        foundOn: foundAt.slice(0, 10),
        foundAt,
        foundBy: NAME['u-it-mgr'],
        steps,
        briefingOn: i === 2 ? day(-1) : null,
        items: ITEMS.map((label, k) => {
          // Fauzan, 28 Oct 2026: files are named as the tender asks (set by the IT Manager after reading the arahan).
          const fileName = isDone('read') ? `Lampiran ${'ABCDE'[k]}` : null;
          const at = doneAt('draft') ?? ago(Math.max(1, foundH / 3));
          return {
            label,
            part: itemPart(label),
            fileName,
            doneAt: k < partsDone ? at : null,
            by: k < partsDone ? NAME['u-it-ex1'] : null,
            assigneeId: 'u-it-ex1',
            dueOn: addDays(closesOn, -1),
            proof: k < partsDone ? proof(`${fileName ?? label}.png`, NAME['u-it-ex1'], doneAt('draft') ?? ago(1)) : [],
            noNameCheck: k < partsDone && itemPart(label) === 'TEKNIKAL' ? { by: NAME['u-it-ex1'], at } : null,
          };
        }),
        companyDocs: DOCS.map((label, k) => ({
          label,
          askedAt: doneAt('askdocs'),
          receivedAt: k < docsIn ? (doneAt('gotdocs') ?? doneAt('askdocs')) : null,
          by: doneAt('askdocs') ? NAME['u-it-mgr'] : null,
          proof: k < docsIn ? proof(`${label}.png`, NAME['u-it-mgr'], doneAt('askdocs')!) : [],
        })),
        stage,
        handedOver: isDone('handover') ? { by: NAME['u-it-mgr'], at: doneAt('handover')!, to: 'Company admin executive (mock)' } : null,
        ownerStaffId: 'u-it-ex1',
      });
    });

    // Buying in the pilot (rule IT-BUY): IT gets 3 quotes and an online price, the COO then the CEO approve (in Prima or
    // Teams Approvals), Finance pays, IT receives and tags. Nothing goes to Procurement yet.
    const QUOTERS = ['Supplier A Sdn Bhd (mock)', 'Supplier B Enterprise (mock)', 'Supplier C Trading (mock)'];
    const coo = ds.users.find((u) => u.opsTier === 'coo');
    const ceo = ds.users.find((u) => u.opsTier === 'ceo');
    const PILOT: Record<string, ItPurchase['status']> = { 'itp-2': 'quoting', 'itp-3': 'coo', 'itp-4': 'ceo', 'itp-5': 'finance', 'itp-6': 'received' };
    for (const p of ds.itPurchases) {
      p.purRequestId = null;
      const st = PILOT[p.id];
      if (!st) continue;
      const t0 = toMs(p.at);
      const h = (n: number) => fromMs(t0 + n * 3_600_000);
      const by = p.requestedBy;
      p.status = st;
      p.managerStep = { by: NAME['u-it-mgr'], at: h(3), note: '' };
      const nQuotes = st === 'quoting' ? 2 : 3;
      p.quotes = QUOTERS.slice(0, nQuotes).map((supplier, k) => ({ supplier, amount: Math.round(p.total * [1, 1.06, 1.11][k]), ref: `Q-${p.ref}-${k + 1}`, proof: proof(`Quotation ${supplier}.png`, by, h(20 + k)), by, at: h(20 + k) }));
      p.online = st === 'quoting' ? [] : [{ source: 'Shopee Mall (mock)', amount: Math.round(p.total * 0.97), ref: 'https://example.invalid/listing', proof: proof('Online price screenshot.png', by, h(24)), by, at: h(24) }];
      p.chosen = st === 'quoting' ? null : { index: 0, reason: '' };
      const teams = (who: string, at: string) => ({ by: who, at, note: '', via: 'teams' as const, teamsRef: `Teams Approvals: ${p.ref}`, recordedBy: by, proof: proof('Teams approval.png', by, at), decision: 'approve' as const });
      p.cooStep = ['ceo', 'finance', 'received'].includes(st) ? teams(coo?.name ?? 'COO', h(30)) : null;
      p.ceoStep = ['finance', 'received'].includes(st) ? { by: ceo?.name ?? 'CEO', at: h(34), note: '', via: 'prima', decision: 'approve' } : null;
      p.finance = st === 'finance' ? { sentBy: by, sentAt: h(35), ref: `Teams Approvals: ${p.ref}`, paidRef: null, paidOn: null, recordedBy: null } : st === 'received' ? { sentBy: by, sentAt: h(35), ref: `Teams Approvals: ${p.ref}`, paidRef: 'PV-2026-1031 (mock)', paidOn: h(48).slice(0, 10), recordedBy: by } : null;
      p.delivery = st === 'received' ? { ref: 'DO-55102 (mock)', proof: proof('Signed delivery order.png', by, h(72)), by, at: h(72) } : null;
    }

    // Pilot: staff outside IT are not on the system yet, so IT logs what they asked and how they reached IT.
    const CH: NonNullable<ItTicket['channel']>[] = ['teams', 'email', 'phone', 'in_person', 'teams'];
    ds.itTickets.forEach((t, k) => {
      if (t.raisedById === 'u-coo') {
        t.channel = 'prima';
        return;
      }
      t.raisedFor = t.raisedBy;
      t.channel = CH[k % CH.length];
      if (t.confirmedAt) t.confirmedVia = `${t.channel === 'phone' ? 'Phone call' : t.channel === 'email' ? 'Email reply' : 'Teams chat'}, recorded by ${NAME['u-it-lead']}`;
    });
  }

  // Company secretary (V9): each company's corporate record, this cycle's annual return and financial statements, and
  // corporate changes in every state. Test data until each secretary confirms it.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const r = new Rng(9_009);
    const rule = RULES.corporate.value;
    const FIRMS = ['Secretary firm A (mock)', 'Secretary firm B (mock)', 'Secretary firm C (mock)'];
    const AUDITORS = ['Audit firm 1 (mock)', 'Audit firm 2 (mock)', 'Audit firm 3 (mock)', 'Audit firm 4 (mock)'];
    const ty = Number(today.slice(0, 4));
    // The audit firm panel as staff would key it in (mock names); law firms come from the same screen.
    AUDITORS.forEach((name, i) =>
      ds.panelFirms.push({
        id: `pf-audit-${i + 1}`,
        kind: 'AUDIT',
        name,
        regNo: `AF ${String(1000 + i)} (mock)`,
        contact: 'Partner (mock)',
        feeBasis: 'Yearly fee per company (mock)',
        appointedOn: `${ty - 1}-01-15`,
        reviewOn: i === 3 ? addDays(today, -10) : `${ty + 1}-01-15`,
        status: 'active',
        addedBy: 'Deputy Chief of Staff (mock)',
        addedById: 'u-dcos',
        at: `${ty - 1}-01-15T09:00:00+08:00`,
        reviews: [],
        removed: null,
      }),
    );
    ds.companies.forEach((c, i) => {
      const incorporatedOn = `${2003 + (i % 18)}-${String((i % 12) + 1).padStart(2, '0')}-${String(((i * 7) % 27) + 1).padStart(2, '0')}`;
      const fyeMonth = [12, 6, 3, 9][i % 4];
      ds.corpProfiles.push({
        id: `cp-${c.id}`,
        companyId: c.id,
        regNo: `20${String(100000 + i * 3571).slice(0, 6)}-X (mock)`,
        incorporatedOn,
        fyeMonth,
        secretaryFirm: FIRMS[i % FIRMS.length],
        secretaryLicence: `LS${String(1000 + i * 17)} (mock)`,
        auditor: AUDITORS[i % AUDITORS.length],
        directors: [
          { name: `Director A of ${c.code} (mock)`, appointedOn: incorporatedOn },
          { name: `Director B of ${c.code} (mock)`, appointedOn: addDays(incorporatedOn, 400) },
        ],
      });
      // Annual return: the nearest anniversary, due 30 days after it.
      let anniv = `${ty}${incorporatedOn.slice(4)}`;
      if (addDays(anniv, rule.annualReturnDays) < addDays(today, -60)) anniv = `${ty + 1}${incorporatedOn.slice(4)}`;
      if (anniv.endsWith('-02-29')) anniv = anniv.replace('-02-29', '-02-28');
      const arDue = addDays(anniv, rule.annualReturnDays);
      // Financial statements: circulate within 6 months of the year end, lodge within 30 days of circulating.
      // The latest year end already passed.
      const fyeYear = new Date(Date.UTC(ty, fyeMonth, 0)).toISOString().slice(0, 10) < today ? ty : ty - 1;
      const fye = new Date(Date.UTC(fyeYear, fyeMonth, 0)).toISOString().slice(0, 10);
      const circulateBy = new Date(Date.UTC(fyeYear, fyeMonth + rule.fsCirculateMonths, 0)).toISOString().slice(0, 10);
      const fsDue = addDays(circulateBy, rule.fsLodgeDays);
      const mk = (kind: 'ANNUAL_RETURN' | 'FINANCIAL_STATEMENTS', dueOn: string, title: string, basis: string) => {
        const roll = r.float();
        const daysLeft = daysBetween(today, dueOn);
        // Most done on time; a few overdue; some lodged and still waiting for the SSM receipt.
        const status: 'open' | 'prepared' | 'lodged' | 'acknowledged' =
          daysLeft < -5
            ? roll < 0.7
              ? 'acknowledged'
              : roll < 0.8
                ? 'lodged'
                : 'open'
            : daysLeft < 20
              ? roll < 0.3
                ? 'lodged'
                : roll < 0.6
                  ? 'prepared'
                  : 'open'
              : 'open';
        const lodgedOn =
          status === 'lodged' || status === 'acknowledged' ? (daysLeft < 0 ? addDays(dueOn, -r.int(1, 10)) : addDays(today, -r.int(1, 5))) : null;
        ds.corpFilings.push({
          id: `cf-${c.id}-${kind === 'ANNUAL_RETURN' ? 'ar' : 'fs'}-${dueOn.slice(0, 4)}`,
          companyId: c.id,
          kind,
          title,
          dueOn,
          basis,
          status,
          prepared: status === 'open' ? null : { by: `${c.code} admin (mock)`, at: ago(r.int(6, 20)) },
          lodged: lodgedOn
            ? {
                by: `${c.code} admin (mock)`,
                at: `${lodgedOn}T16:00:00+08:00`,
                ref: `MBRS-${c.code}-${dueOn.slice(0, 4)}-${kind === 'ANNUAL_RETURN' ? 'AR' : 'FS'}`,
                on: lodgedOn,
              }
            : null,
          receipt:
            status === 'acknowledged'
              ? { by: `${c.code} admin (mock)`, at: `${addDays(lodgedOn!, 3)}T10:00:00+08:00`, ref: `SSM-RCPT-${c.code}-${dueOn.slice(0, 4)}` }
              : null,
          changeId: null,
        });
      };
      mk(
        'ANNUAL_RETURN',
        arDue,
        `Annual return ${anniv.slice(0, 4)}`,
        `Within ${rule.annualReturnDays} days after the incorporation anniversary (${anniv}), Companies Act 2016 s.68`,
      );
      mk(
        'FINANCIAL_STATEMENTS',
        fsDue,
        `Financial statements, year ended ${fye}`,
        `Circulate by ${circulateBy} (s.258), lodge within ${rule.fsLodgeDays} days of circulating (s.259)`,
      );
    });
    // Corporate changes for the pilots, one in each state.
    const CH: [Id, CorpChange['kind'], string, CorpChange['status'], number][] = [
      ['co-sasa', 'DIRECTOR', 'Appoint a new director (mock)', 'awaiting_pwvsb', 2],
      ['co-arsh', 'BANK_SIGNATORY', 'Add a second bank signatory (mock)', 'awaiting_pwvsb', 6],
      ['co-inas', 'SECRETARY_AUDITOR', 'Change the company secretary firm (mock)', 'approved', 4],
      ['co-sasa', 'BENEFICIAL_OWNER', 'Update beneficial owner record (mock)', 'board_done', 12],
      ['co-arsh', 'SHARES', 'Allot new shares to PWVSB (mock)', 'rejected', 9],
    ];
    CH.forEach(([companyId, kind, title, status, age], i) => {
      const at = ago(age);
      const id = `cc-${companyId}-${i + 1}`;
      const effectiveOn = addDays(today, -6);
      const filingId = status === 'board_done' ? `cf-${id}` : null;
      ds.corpChanges.push({
        id,
        companyId,
        kind,
        title,
        detail: '',
        raisedBy: 'Company Manager (mock)',
        raisedById: ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(companyId))?.id ?? 'u-cm',
        at,
        status,
        pwvsb:
          status === 'awaiting_pwvsb'
            ? null
            : {
                by: 'Mohd Ridzuan bin Hamid',
                at: fromMs(toMs(at) + 86_400_000),
                note: status === 'rejected' ? 'Shareholding plan not agreed' : '',
                clauseRef: 'Management agreement cl. 7.2 (mock)',
              },
        board:
          status === 'board_done'
            ? { by: 'Company Manager (mock)', at: ago(6), resolutionRef: `${companyId.toUpperCase()}/BR/2026/0${i + 1}`, effectiveOn }
            : null,
        filingId,
      });
      if (filingId)
        ds.corpFilings.push({
          id: filingId,
          companyId,
          kind: 'BO_CHANGE',
          title: `Notify SSM: ${title}`,
          dueOn: addDays(effectiveOn, rule.changeFileDays),
          basis: `Within ${rule.changeFileDays} days of the change (Companies Act 2016)`,
          status: 'prepared',
          prepared: { by: 'Company admin (mock)', at: ago(2) },
          lodged: null,
          receipt: null,
          changeId: id,
        });
    });
  }

  // PWVSB credit (V8, V10): financing to some companies, in every state the credit officer meets. Test data only.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const step = (by: string, byId: string, d: number, note = '') => ({ by, byId, at: ago(d), note });
    const mkLoan = (
      k: number,
      companyId: Id,
      o: Partial<CreditLoan> & { principal: number; ratePct: number; secured: boolean; termMonths: number; startDaysAgo: number; paidUpTo: number },
    ): CreditLoan => {
      const startOn = addDays(today, -o.startDaysAgo);
      const total = o.principal * (1 + (o.ratePct / 100) * (o.termMonths / 12));
      const each = Math.round((total / o.termMonths) * 100) / 100;
      return {
        id: `cl-${companyId}-${k}`,
        companyId,
        ref: `PWV/${o.kind === 'PAID_ON_BEHALF' ? 'POB' : 'LN'}/${companyId.replace('co-', '').toUpperCase()}/${k}`,
        kind: o.kind ?? 'LOAN',
        purpose: o.purpose ?? 'Working capital (mock)',
        secured: o.secured,
        principal: o.principal,
        ratePct: o.ratePct,
        startOn,
        termMonths: o.termMonths,
        agreementRef: `AGR/${companyId.toUpperCase()}/${k} (mock)`,
        templateId: o.templateId ?? 'BIA-2024',
        stamped: { ref: `STAMP-${companyId}-${k}`, on: addDays(startOn, 5) },
        collateral: o.collateral ?? { kind: 'BENEFICIAL_INTEREST', agreementRef: `BIA/${companyId.toUpperCase()} (mock)` },
        charge: o.charge ?? null,
        cureDays: 14,
        schedule: Array.from({ length: o.termMonths }, (_, i) => {
          const dueOn = addDays(startOn, Math.round((i + 1) * 30.4));
          const amount = i === o.termMonths - 1 ? Math.round((total - each * (o.termMonths - 1)) * 100) / 100 : each;
          const paid = i + 1 <= o.paidUpTo;
          return {
            no: i + 1,
            dueOn,
            amount,
            paidOn: paid ? addDays(dueOn, 2) : null,
            paidAmount: paid ? amount : 0,
            bankRef: paid ? `MBB${100000 + i * 7 + k}` : null,
          };
        }),
        disputes: o.disputes ?? [],
        deferral: null,
        status: o.status ?? 'active',
      };
    };
    const loans = [
      // Paying on time.
      mkLoan(1, 'co-sasa', {
        principal: 500_000,
        ratePct: 8,
        secured: true,
        termMonths: 36,
        startDaysAgo: 400,
        paidUpTo: 13,
        purpose: 'Radios and patrol devices (mock)',
      }),
      // Missed instalment 9 last month, past the cure period: under investigation, reconciled, waiting for the credit officer.
      mkLoan(1, 'co-arsh', { principal: 300_000, ratePct: 10, secured: true, termMonths: 24, startDaysAgo: 320, paidUpTo: 8 }),
      // A confirmed default from earlier, enforcement steps 1 and 2 done; steps 7 to 9 off.
      mkLoan(1, 'co-inas', { principal: 200_000, ratePct: 12, secured: true, termMonths: 24, startDaysAgo: 330, paidUpTo: 7 }),
      // Wages PWVSB paid on the company's behalf, recovered over 6 months; the company disputes one instalment.
      mkLoan(2, 'co-sasa', {
        kind: 'PAID_ON_BEHALF',
        purpose: "September wages paid by PWVSB on the company's behalf (mock)",
        principal: 180_000,
        ratePct: 0,
        secured: false,
        termMonths: 6,
        startDaysAgo: 70,
        paidUpTo: 1,
        collateral: { kind: 'NONE', agreementRef: null },
        disputes: [{ at: ago(4), by: 'Nor Azlina binti Hashim', note: 'Instalment 2 counted twice (mock)', closedAt: null }],
      }),
      // A new loan with a charge over company vehicles not yet lodged with SSM (day 24 of 30).
      mkLoan(2, 'co-arsh', {
        principal: 450_000,
        ratePct: 9,
        secured: true,
        termMonths: 48,
        startDaysAgo: 24,
        paidUpTo: 0,
        purpose: 'Patrol vehicles (mock)',
        templateId: 'CHG-2026',
        collateral: { kind: 'ASSET_CHARGE', agreementRef: 'Debenture over patrol vehicles (mock)' },
        charge: { createdOn: addDays(today, -24), lodgedOn: null, ssmRef: null },
      }),
      // Settled.
      mkLoan(3, 'co-sasa', { principal: 120_000, ratePct: 7, secured: true, termMonths: 12, startDaysAgo: 420, paidUpTo: 12, status: 'settled' }),
    ];
    ds.creditLoans.push(...loans);
    // Other group companies with loans, to show the group total.
    ds.companies
      .filter((c) => !['co-sasa', 'co-arsh', 'co-inas'].includes(c.id))
      .slice(0, 5)
      .forEach((c, i) =>
        ds.creditLoans.push(
          mkLoan(1, c.id, { principal: 150_000 + i * 50_000, ratePct: 8 + i, secured: true, termMonths: 36, startDaysAgo: 200 + i * 30, paidUpTo: 6 + i }),
        ),
      );
    const arsh = loans[1];
    const inas = loans[2];
    const blank = { cleared: null, suspended: null, legalConfirm: null } as const;
    ds.creditDefaults.push(
      {
        ...blank,
        id: `cd-${inas.id}-8`,
        companyId: 'co-inas',
        loanId: inas.id,
        instalmentNo: 8,
        openedAt: ago(70),
        stage: 'confirmed',
        reconciled: step('Sharifah Nadia binti Syed Ali', 'u-fd', 60, 'Maybank statement and SQL subledger to 31 Aug (mock)'),
        creditConfirm: step('Credit Officer (mock)', 'u-credit', 55),
        financeConfirm: step('Sharifah Nadia binti Syed Ali', 'u-fd', 54),
        needsLegal: true,
        legalConfirm: step('Legal Counsel (mock)', 'u-legal', 53),
        enforcement: {
          openedAt: ago(53),
          steps: RULES.credit.value.enforcementSteps.map((label, i) => ({
            no: i + 1,
            label,
            status: i < 2 ? 'done' : i >= 6 ? 'off' : 'open',
            by: i < 2 ? 'Credit Officer (mock)' : null,
            at: i < 2 ? ago(50 - i * 10) : null,
            note: i === 0 ? 'Notice ref PWV/N/INAS/1 (mock)' : i === 1 ? '30-day standstill agreed by letter (mock)' : '',
          })),
        },
      },
      {
        ...blank,
        id: `cd-${arsh.id}-9`,
        companyId: 'co-arsh',
        loanId: arsh.id,
        instalmentNo: 9,
        openedAt: ago(20),
        stage: 'investigating',
        reconciled: step('Sharifah Nadia binti Syed Ali', 'u-fd', 3, 'CIMB statement and SQL subledger to 30 Sep (mock)'),
        creditConfirm: null,
        financeConfirm: null,
        needsLegal: false,
        enforcement: null,
      },
    );
  }

  // Procurement and store (V5): suppliers, purchases in every state and the uniform store, for the three pilots. Test data.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const r = mulberry32(5150);
    const COS = {
      'co-sasa': { cm: ['u-cm-sasa', 'Nor Azlina binti Hashim'], ae: ['u-ae-sasa', 'Farah Nadia binti Kamal'], tag: 'SASA' },
      'co-arsh': { cm: ['u-cm-arsh', 'Kenny Lau Chee Wah'], ae: ['u-ae-arsh', 'Siti Hajar binti Rosli'], tag: 'ARSH' },
      'co-inas': { cm: ['u-cm-inas', 'Mohd Shukri bin Ahmad'], ae: ['u-ae-inas', 'Lim Mei Ling'], tag: 'INAS' },
    } as const;
    const fd = ['u-fd', 'Sharifah Nadia binti Syed Ali'] as const;
    const coo = ['u-coo', 'Ahmad Faisal bin Zainal'] as const;
    const STOCK: [string, StockItem['kind'], string | null, number, number][] = [
      ['Uniform shirt', 'UNIFORM', 'M', 60, 20],
      ['Uniform shirt', 'UNIFORM', 'L', 45, 20],
      ['Uniform shirt', 'UNIFORM', 'XL', 12, 15],
      ['Uniform trousers', 'UNIFORM', '32', 50, 20],
      ['Uniform trousers', 'UNIFORM', '34', 8, 15],
      ['Beret and badge set', 'UNIFORM', null, 70, 20],
      ['Safety boots', 'UNIFORM', '8', 25, 10],
      ['Raincoat', 'UNIFORM', null, 40, 15],
      ['LED torch', 'EQUIPMENT', null, 30, 10],
      ['Two-way radio', 'EQUIPMENT', null, 6, 5],
      ['NFC patrol phone (Android)', 'PATROL_DEVICE', null, 4, 3],
      ['Body camera', 'DEVICE', null, 5, 3],
      ['Translation device', 'DEVICE', null, 3, 2],
      ['NFC checkpoint token', 'PATROL_DEVICE', null, 40, 20],
      ['Floor cleaner 5 L', 'CLEANING', null, 24, 10],
      ['Mop and bucket set', 'CLEANING', null, 6, 4],
    ];
    for (const [companyId, who] of Object.entries(COS) as [keyof typeof COS, (typeof COS)[keyof typeof COS]][]) {
      const items: StockItem[] = STOCK.map(([name, kind, size, onHand, reorderAt], k) => ({
        id: `stk-${companyId}-${k + 1}`,
        companyId,
        sku: `${who.tag}-${kind.slice(0, 3)}-${String(k + 1).padStart(3, '0')}`,
        name,
        kind,
        size,
        onHand: companyId === 'co-arsh' ? Math.round(onHand * 0.7) : onHand,
        reorderAt,
        ...(kind === 'CLEANING' && name.startsWith('Floor') ? { consumable: true } : {}),
      }));
      ds.stockItems.push(...items);
      const sup = (k: number, name: string, o: Partial<PurSupplier> = {}): PurSupplier => ({
        id: `sup-${companyId}-${k}`,
        companyId,
        name,
        ssmNo: `20${10 + k}0${100000 + Math.floor(r() * 899999)}`,
        categories: k === 4 ? ['SERVICES'] : k === 3 ? ['GUARD_EQUIPMENT', 'PATROL_DEVICE'] : ['UNIFORM', 'GUARD_EQUIPMENT'],
        bank: {
          name: ['Maybank', 'CIMB', 'Public Bank', 'RHB'][k - 1],
          account: String(5_000_000_000 + Math.floor(r() * 4_000_000_000)),
          verifiedBy: fd[1],
          verifiedOn: addDays(today, -200),
        },
        coiDeclaredOn: addDays(today, -200),
        abcAckOn: addDays(today, -200),
        reviewedOn: addDays(today, -200),
        blocked: null,
        addedBy: who.ae[1],
        at: ago(210),
        ...o,
      });
      const suppliers = [
        sup(1, 'Seragam Jaya Enterprise (mock)'),
        sup(2, 'Uniform Pro Supplies Sdn Bhd (mock)'),
        sup(3, 'Komunikasi Radio Teknik Sdn Bhd (mock)'),
        companyId === 'co-sasa'
          ? sup(4, 'Kemas Laundry Services (mock)', { reviewedOn: addDays(today, -400), coiDeclaredOn: addDays(today, -400), abcAckOn: addDays(today, -400) })
          : companyId === 'co-arsh'
            ? sup(4, 'Cepat Supply Trading (mock)', { blocked: { by: fd[1], at: ago(30), note: 'Bank account changed by email without a bank letter (mock)' } })
            : sup(4, 'Baru Uniform House (mock)', { bank: { name: 'RHB', account: '2140098812345', verifiedBy: null, verifiedOn: null }, reviewedOn: null }),
      ];
      ds.purSuppliers.push(...suppliers);
      const st = (who2: readonly [string, string], d: number, note = '') => ({ by: who2[1], byId: who2[0], at: ago(d), note });
      let n = 0;
      const mk = (o: Partial<PurRequest> & { title: string; category: PurRequest['category']; lines: PurRequest['lines']; daysAgo: number }): PurRequest => {
        n += 1;
        const total = Math.round(o.lines.reduce((x, l) => x + l.qty * l.unitPrice, 0) * 100) / 100;
        const { daysAgo, ...rest } = o;
        return {
          id: `pr-${companyId}-${n}`,
          companyId,
          ref: `PR-${who.tag}-${String(n).padStart(4, '0')}`,
          total,
          raisedBy: who.ae[1],
          raisedById: who.ae[0],
          at: ago(daysAgo),
          quotes: [],
          chosenSupplierId: null,
          notLowestReason: null,
          tiers: [],
          approvals: [],
          status: 'quoting',
          rejected: null,
          po: null,
          grn: null,
          invoice: null,
          match: null,
          posted: null,
          ...rest,
        };
      };
      const q = (k: number, amount: number, d: number) => ({
        supplierId: `sup-${companyId}-${k}`,
        amount,
        ref: `Q-${k}${Math.floor(r() * 9000 + 1000)}`,
        by: who.ae[1],
        at: ago(d),
      });
      const shirtL = { item: 'Uniform shirt L', stockItemId: `stk-${companyId}-2`, qty: 100, unitPrice: 45 };
      const trousers = { item: 'Uniform trousers 34', stockItemId: `stk-${companyId}-5`, qty: 80, unitPrice: 55 };
      const radios = { item: 'Two-way radio with charger', stockItemId: `stk-${companyId}-10`, qty: 40, unitPrice: 1450 };
      const torches = { item: 'LED torch', stockItemId: `stk-${companyId}-9`, qty: 50, unitPrice: 38 };
      const reqs: PurRequest[] = [];
      if (companyId === 'co-sasa') {
        reqs.push(
          mk({ title: 'Uniform restock for new Shah Alam sites', category: 'UNIFORM', lines: [shirtL, trousers], daysAgo: 2, quotes: [q(1, 8900, 1)] }),
          mk({
            title: 'Raincoats for monsoon season',
            category: 'UNIFORM',
            lines: [{ item: 'Raincoat', stockItemId: `stk-${companyId}-8`, qty: 80, unitPrice: 32 }],
            daysAgo: 4,
            quotes: [q(1, 2480, 3), q(2, 2600, 3)],
            online: [{ source: 'Shopee (mock)', ref: 'listing 88123 (mock)', amount: 2390, by: 'Procurement Executive (mock)', at: ago(2) }],
          }),
          mk({
            title: 'Safety boots for all Klang guards',
            category: 'UNIFORM',
            lines: [{ item: 'Safety boots', stockItemId: `stk-${companyId}-7`, qty: 160, unitPrice: 89 }],
            daysAgo: 9,
            quotes: [q(1, 14400, 8), q(2, 13950, 8), q(3, 15200, 7)],
            chosenSupplierId: `sup-${companyId}-2`,
            online: [{ source: 'Lazada (mock)', ref: 'listing 55102 (mock)', amount: 14240, by: 'Procurement Executive (mock)', at: ago(8) }],
            tiers: ['coo', 'ceo'],
            approvals: [{ by: 'Ahmad Faisal bin Zainal', byId: 'u-coo', at: ago(6), note: '', tier: 'coo' }],
            status: 'awaiting_approval',
          }),
          mk({
            title: 'Torches for night shift',
            category: 'GUARD_EQUIPMENT',
            lines: [torches],
            daysAgo: 20,
            quotes: [q(3, 1850, 19)],
            chosenSupplierId: `sup-${companyId}-3`,
            tiers: ['manager'],
            approvals: [{ ...st(who.cm, 17), tier: 'manager' }],
            status: 'ordered',
            po: { ref: 'PO-SASA-0412', by: who.ae[1], at: ago(15), amount: 1850 },
          }),
          mk({
            title: 'Uniform shirts XL',
            category: 'UNIFORM',
            lines: [{ item: 'Uniform shirt XL', stockItemId: `stk-${companyId}-3`, qty: 60, unitPrice: 46 }],
            daysAgo: 30,
            quotes: [q(1, 2760, 29)],
            chosenSupplierId: `sup-${companyId}-1`,
            tiers: ['manager'],
            approvals: [{ ...st(who.cm, 27), tier: 'manager' }],
            status: 'received',
            po: { ref: 'PO-SASA-0398', by: who.ae[1], at: ago(25), amount: 2760 },
            grn: { ...st(who.ae, 12, 'Short 10 shirts, balance to follow'), qty: [50] },
            invoice: { eInvoiceUuid: 'F9D1K2W7(mock)', number: 'INV-77821', amount: 2760, by: fd[1], at: ago(5) },
            match: { ok: false, notes: ['Uniform shirt XL: ordered 60, received 50.'], by: fd[1], at: ago(5) },
          }),
          mk({
            title: 'Berets and badges',
            category: 'UNIFORM',
            lines: [{ item: 'Beret and badge set', stockItemId: `stk-${companyId}-6`, qty: 100, unitPrice: 28 }],
            daysAgo: 60,
            quotes: [q(2, 2800, 59)],
            chosenSupplierId: `sup-${companyId}-2`,
            tiers: ['manager'],
            approvals: [{ ...st(who.cm, 57), tier: 'manager' }],
            status: 'posted',
            po: { ref: 'PO-SASA-0371', by: who.ae[1], at: ago(55), amount: 2800 },
            grn: { ...st(who.ae, 45), qty: [100] },
            invoice: { eInvoiceUuid: 'A4C8M1Q9(mock)', number: 'INV-77102', amount: 2800, by: fd[1], at: ago(40) },
            match: { ok: true, notes: [], by: fd[1], at: ago(40) },
            posted: { sqlRef: 'PI-00812 (mock)', by: fd[1], at: ago(39) },
          }),
        );
      } else if (companyId === 'co-arsh') {
        reqs.push(
          mk({
            title: 'Torches for new condominium site',
            category: 'GUARD_EQUIPMENT',
            lines: [torches],
            daysAgo: 3,
            quotes: [q(3, 1900, 2), q(1, 1960, 2), q(2, 2050, 2)],
            online: [{ source: 'Shopee (mock)', ref: 'listing 77410 (mock)', amount: 1820, by: 'Procurement Executive (mock)', at: ago(2) }],
            chosenSupplierId: `sup-${companyId}-3`,
            tiers: ['coo', 'ceo'],
            status: 'awaiting_approval',
          }),
          mk({
            title: 'Uniform trousers restock',
            category: 'UNIFORM',
            lines: [trousers],
            daysAgo: 14,
            quotes: [q(1, 4400, 13)],
            chosenSupplierId: `sup-${companyId}-1`,
            tiers: ['manager'],
            approvals: [{ ...st(who.cm, 11), tier: 'manager' }],
            status: 'received',
            po: { ref: 'PO-ARSH-0220', by: who.ae[1], at: ago(10), amount: 4400 },
            grn: { ...st(who.ae, 3), qty: [80] },
          }),
          mk({
            title: 'Uniform shirts L',
            category: 'UNIFORM',
            lines: [shirtL],
            daysAgo: 8,
            quotes: [q(2, 4500, 7)],
            chosenSupplierId: `sup-${companyId}-2`,
            tiers: ['manager'],
            approvals: [{ ...st(who.cm, 5), tier: 'manager' }],
            status: 'approved',
          }),
          mk({
            title: 'Laundry service, 12 months',
            category: 'SERVICES',
            lines: [{ item: 'Uniform laundry (yearly)', stockItemId: null, qty: 1, unitPrice: 9000 }],
            daysAgo: 25,
            raisedBy: who.cm[1],
            raisedById: who.cm[0],
            quotes: [q(1, 9000, 24)],
            chosenSupplierId: `sup-${companyId}-1`,
            tiers: ['coo'],
            status: 'rejected',
            rejected: st(coo, 20, 'Needs three quotes; get two more and resubmit (mock)'),
          }),
        );
      } else {
        reqs.push(
          mk({
            title: 'Two-way radios for armed escort team',
            category: 'GUARD_EQUIPMENT',
            lines: [radios],
            daysAgo: 12,
            quotes: [q(3, 58000, 11), q(1, 61200, 11), q(2, 59900, 10)],
            chosenSupplierId: `sup-${companyId}-3`,
            tiers: ['manager', 'coo', 'ceo'],
            approvals: [
              { ...st(who.cm, 9), tier: 'manager' },
              { ...st(coo, 6), tier: 'coo' },
            ],
            status: 'awaiting_approval',
          }),
          mk({
            title: 'NFC patrol phones for 6 new sites',
            category: 'PATROL_DEVICE',
            lines: [{ item: 'Android NFC phone', stockItemId: `stk-${companyId}-11`, qty: 6, unitPrice: 980 }],
            daysAgo: 6,
            quotes: [q(3, 5880, 5), q(2, 6120, 5)],
            status: 'quoting',
          }),
        );
      }
      ds.purRequests.push(...reqs);
      // Issued items: shirts, trousers and a beret to most active guards; some to people who have since left.
      const people = ds.people.filter((p) => p.companyId === companyId);
      let issueN = 0;
      const issue = (p: (typeof people)[number], itemIdx: number, qty: number, d: number) => ({
        id: `iss-${companyId}-${++issueN}`,
        companyId,
        itemId: items[itemIdx].id,
        personId: p.id,
        personName: p.name,
        qty,
        issuedAt: ago(d),
        issuedBy: 'Storekeeper 1 (mock)',
        // Recent issues wait for the person to confirm in their own details.
        acknowledged: d > 45,
        confirmedAt: d > 45 ? ago(d - 1) : null,
        returned: null,
      });
      for (const p of people.filter((x) => x.status === 'active').slice(0, 25)) {
        const d = 30 + Math.floor(r() * 300);
        ds.stockIssues.push(issue(p, r() < 0.5 ? 0 : 1, 2, d), issue(p, 3, 2, d), issue(p, 5, 1, d));
      }
      // A body camera issued this week to each guard and officer who signs in, still waiting for them to confirm.
      for (const u of ds.users.filter((x) => x.personId && (x.role === 'guard' || x.role === 'supervisor'))) {
        const p = people.find((x) => x.id === u.personId && x.status === 'active');
        if (p) ds.stockIssues.push({ ...issue(p, 11, 1, 3), serial: `BWC-${companyId.slice(-4).toUpperCase()}-${100 + issueN}` });
      }
      // Two people who resigned last month still hold company items (to collect on exit).
      for (const p of people.filter((x) => x.status === 'active').slice(-2)) {
        p.status = 'left';
        ds.stockIssues.push(issue(p, 1, 2, 200), issue(p, 9, 1, 200));
      }
    }
    // PWVSB's own suppliers for central IT equipment, checked by Finance like any company's.
    ['Kompu Niaga Sdn Bhd (mock)', 'Sinar Digital Trading (mock)', 'TeknoMart Enterprise (mock)'].forEach((name, k) =>
      ds.purSuppliers.push({
        id: `sup-${GROUP_EMPLOYER_ID}-${k + 1}`,
        companyId: GROUP_EMPLOYER_ID,
        name,
        ssmNo: `2019010${44100 + k}`,
        categories: ['IT', 'DEVICE'],
        bank: { name: ['Maybank', 'CIMB', 'Public Bank'][k], account: String(7_100_200_300 + k * 1111), verifiedBy: 'Finance Director (mock)', verifiedOn: addDays(today, -150) },
        coiDeclaredOn: addDays(today, -150),
        abcAckOn: addDays(today, -150),
        reviewedOn: addDays(today, -150),
        blocked: null,
        addedBy: 'Procurement Executive (mock)',
        at: fromMs(nowMs - 160 * 86_400_000),
      }),
    );
    // IT needs the IT Manager agreed, bought by Procurement like any purchase (Fauzan, 27 Oct 2026).
    for (const p of ds.itPurchases.filter((x) => x.purRequestId)) {
      const seq = ds.purRequests.filter((x) => x.companyId === p.ownerId).length + 1;
      ds.purRequests.push(itPurchaseRequest(p, seq, p.managerStep!.at));
    }
  }

  // Governance (V7, V8, V12): management agreements and board mandates. Most companies have none on file yet. Test data.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const cos = { by: 'Aisyah binti Rahman', byId: 'u-cos' };
    const legal = { by: 'Legal Counsel (mock)', byId: 'u-legal' };
    const full: GovMandate['powers'] = [
      { area: 'OPERATIONS', scope: 'act', limit: null },
      { area: 'HR_PAYROLL', scope: 'act', limit: null },
      { area: 'FINANCE', scope: 'monitor', limit: null },
      { area: 'PROCUREMENT', scope: 'act', limit: 50_000 },
      { area: 'CONTRACTS', scope: 'monitor', limit: null },
      { area: 'LICENSING', scope: 'monitor', limit: null },
      { area: 'CORPORATE', scope: 'act', limit: null },
      { area: 'IT', scope: 'act', limit: null },
    ];
    const mk = (
      companyId: Id,
      k: number,
      o: Partial<GovMandate> & { validToDays: number | null; signedDaysAgo: number; confirmed: boolean; verified: boolean },
    ): GovMandate => {
      const { validToDays, signedDaysAgo, confirmed, verified, ...rest } = o;
      const tag = companyId.replace('co-', '').toUpperCase();
      return {
        id: `gm-${companyId}-${k}`,
        companyId,
        kind: 'MANAGEMENT_AGREEMENT',
        ref: `PWV/MA/${tag}/${k}`,
        title: 'Management services agreement with PWVSB (mock)',
        signedOn: addDays(today, -signedDaysAgo),
        validFrom: addDays(today, -signedDaysAgo + 1),
        validTo: validToDays === null ? null : addDays(today, validToDays),
        powers: full,
        addedBy: cos.by,
        addedById: cos.byId,
        at: ago(signedDaysAgo),
        companyConfirm: confirmed ? { by: 'Company board (mock)', byId: 'board', at: ago(signedDaysAgo - 3), resolutionRef: `BR/${tag}/2025/0${k}` } : null,
        legalVerify: verified ? { ...legal, at: ago(signedDaysAgo - 5), note: 'Signed and stamped copy matches the register (mock)' } : null,
        terminated: null,
        ...rest,
      };
    };
    ds.govMandates.push(
      mk('co-sasa', 1, { validToDays: 430, signedDaysAgo: 300, confirmed: true, verified: true }),
      mk('co-sasa', 2, {
        kind: 'BOARD_MANDATE',
        title: 'Board mandate: PWVSB Arms Control coordinates vault audits (mock)',
        powers: [{ area: 'ARMS', scope: 'monitor', limit: null }],
        validToDays: 200,
        signedDaysAgo: 160,
        confirmed: true,
        verified: true,
      }),
      mk('co-arsh', 1, { validToDays: 40, signedDaysAgo: 690, confirmed: true, verified: true }),
      mk('co-inas', 1, { validToDays: 700, signedDaysAgo: 20, confirmed: true, verified: false }),
    );
    ds.companies
      .filter((c) => !['co-sasa', 'co-arsh', 'co-inas'].includes(c.id))
      .slice(0, 8)
      .forEach((c, i) =>
        ds.govMandates.push(mk(c.id, 1, { validToDays: i === 0 ? -15 : 200 + i * 60, signedDaysAgo: 400 + i * 20, confirmed: true, verified: i !== 3 })),
      );
  }

  // Assurance (V15): obligations with proof in every state, site risk assessments, gifts and two speak-up reports. Test data.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const r = mulberry32(1515);
    const audit = { by: 'Head of Internal Audit (mock)', byId: 'u-audit' };
    const makers: Record<string, [string, string]> = {
      'co-sasa': ['u-cm-sasa', 'Nor Azlina binti Hashim'],
      'co-arsh': ['u-ae-arsh', 'Siti Hajar binti Rosli'],
      'co-inas': ['u-cm-inas', 'Mohd Shukri bin Ahmad'],
    };
    const companies = [...ds.companies.filter((c) => c.id in makers), ...ds.companies.filter((c) => !(c.id in makers)).slice(0, 5)];
    for (const c of companies) {
      const maker = makers[c.id] ?? ['u-company', 'Company admin (mock)'];
      RULES.assurance.value.obligations.forEach((o, k) => {
        const roll = r();
        const span = Math.round(o.everyMonths * 30.44);
        // About 15% never proven (unknown), some overdue, some not yet checked, one failed check per pilot.
        const evidence =
          roll < 0.15
            ? null
            : {
                on: addDays(today, -Math.round(roll < 0.3 ? span + 5 + r() * 20 : r() * span * 0.8)),
                ref: `${o.stream}/${c.id.replace('co-', '').toUpperCase()}/${k + 1} (mock)`,
                by: maker[1],
                byId: maker[0],
                at: ago(10),
              };
        const failed = c.id in makers && k === 7;
        const checked =
          evidence && (failed || r() < 0.75)
            ? { ...audit, at: ago(3), ok: !failed, note: failed ? 'SST-02 filed late and the penalty is not recorded (mock)' : '' }
            : null;
        const item: GrcObligation = {
          id: `grc-${c.id}-${k + 1}`,
          companyId: c.id,
          stream: o.stream,
          title: o.title,
          basis: o.basis,
          everyMonths: o.everyMonths,
          evidence,
          checked,
          history: [],
        };
        ds.grcObligations.push(item);
      });
    }
    for (const site of ds.sites.filter((s) => s.companyId in makers)) {
      const roll = r();
      if (roll < 0.25) continue;
      const assessedOn = addDays(today, -Math.round(roll < 0.35 ? 380 + r() * 60 : r() * 330));
      const hazards = 4 + Math.floor(r() * 8);
      ds.oshAssessments.push({
        id: `osh-${site.id}-1`,
        companyId: site.companyId,
        siteId: site.id,
        assessedOn,
        by: makers[site.companyId][1],
        hazards,
        highRisks: Math.floor(r() * 3),
        controlsRef: `HIRARC/${site.code} (mock)`,
        nextReviewOn: addDays(assessedOn, 365),
      });
    }
    ds.giftEntries.push(
      {
        id: 'gift-1',
        companyId: 'co-sasa',
        declarantId: 'u-cm-sasa',
        declarantName: 'Nor Azlina binti Hashim',
        direction: 'received',
        counterparty: 'Seragam Jaya Enterprise (mock)',
        counterpartyKind: 'SUPPLIER',
        description: 'Hari Raya hamper',
        value: 180,
        on: addDays(today, -40),
        cash: false,
        needsDecision: false,
        decision: null,
        at: ago(39),
      },
      {
        id: 'gift-2',
        companyId: 'co-arsh',
        declarantId: 'u-cm-arsh',
        declarantName: 'Kenny Lau Chee Wah',
        direction: 'received',
        counterparty: 'Residensi Seri Melati JMB (mock)',
        counterpartyKind: 'CLIENT',
        description: 'Dinner voucher for two at a hotel',
        value: 650,
        on: addDays(today, -6),
        cash: false,
        needsDecision: true,
        decision: null,
        at: ago(5),
      },
      {
        id: 'gift-3',
        companyId: 'co-inas',
        declarantId: 'u-cm-inas',
        declarantName: 'Mohd Shukri bin Ahmad',
        direction: 'received',
        counterparty: 'Uniform Pro Supplies Sdn Bhd (mock)',
        counterpartyKind: 'SUPPLIER',
        description: 'Angpau with RM300 at Chinese New Year',
        value: 300,
        on: addDays(today, -3),
        cash: true,
        needsDecision: true,
        decision: null,
        at: ago(2),
      },
      {
        id: 'gift-4',
        companyId: 'co-sasa',
        declarantId: 'u-cm-sasa',
        declarantName: 'Nor Azlina binti Hashim',
        direction: 'given',
        counterparty: 'Majlis Perbandaran (mock)',
        counterpartyKind: 'PUBLIC_OFFICIAL',
        description: 'Company calendar and diary',
        value: 45,
        on: addDays(today, -60),
        cash: false,
        needsDecision: true,
        decision: { by: 'Aisyah binti Rahman', byId: 'u-cos', at: ago(58), outcome: 'refused', note: 'No gifts to public officials, even small ones (mock)' },
        at: ago(59),
      },
    );
    ds.whistleReports.push(
      {
        id: 'wb-1',
        code: 'SU-0001-K7Q',
        at: ago(9),
        anonymous: true,
        reporterId: null,
        reporterName: null,
        companyId: 'co-arsh',
        category: 'FRAUD',
        summary:
          'A site supervisor at a Penang site signs the attendance sheet for a guard who has not come for two weeks, and the guard is still paid. (mock)',
        implicatedUserIds: [],
        handlerId: 'u-audit',
        handlerName: 'Head of Internal Audit (mock)',
        status: 'received',
        acknowledgedAt: null,
        notes: [],
        outcome: null,
        closedAt: null,
      },
      {
        id: 'wb-2',
        code: 'SU-0002-P2M',
        at: ago(20),
        anonymous: false,
        reporterId: 'u-ae-arsh',
        reporterName: 'Siti Hajar binti Rosli',
        companyId: 'co-arsh',
        category: 'BRIBERY',
        summary: 'A supplier offered a commission for every uniform order placed through them, through a person in internal audit. (mock)',
        implicatedUserIds: ['u-audit'],
        handlerId: 'u-chair',
        handlerName: "Dato' Ismail bin Kassim",
        status: 'investigating',
        acknowledgedAt: ago(18),
        notes: [{ at: ago(18), by: "Dato' Ismail bin Kassim", text: 'Asked counsel to interview the supplier (mock)' }],
        outcome: null,
        closedAt: null,
      },
    );
  }

  // PDPA rights: a DPO for some companies, and people's data requests in every state. Test data.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    ds.pdpaDpos.push(
      {
        id: 'dpo-co-sasa',
        companyId: 'co-sasa',
        name: 'Siti Mariam binti Osman',
        email: 'dpo@sasa.example',
        appointedOn: addDays(today, -150),
        notified: { on: addDays(today, -140), ref: 'JPDP/DPO/2026/0412 (mock)' },
        published: true,
      },
      {
        id: 'dpo-co-arsh',
        companyId: 'co-arsh',
        name: 'Siti Mariam binti Osman',
        email: 'dpo@arrowshield.example',
        appointedOn: addDays(today, -30),
        notified: null,
        published: false,
      },
      {
        id: 'dpo-co-inas',
        companyId: 'co-inas',
        name: 'Siti Mariam binti Osman',
        email: 'dpo@inas.example',
        appointedOn: addDays(today, -10),
        notified: null,
        published: true,
      },
    );
    const req = (n: number, o: Partial<PdpaRequest> & { receivedDaysAgo: number }): PdpaRequest => {
      const { receivedDaysAgo, ...rest } = o;
      const receivedOn = addDays(today, -receivedDaysAgo);
      return {
        id: `dsr-${n}`,
        ref: `DSR-${String(n).padStart(4, '0')}`,
        companyId: 'co-sasa',
        kind: 'ACCESS',
        subjectName: 'Former guard (mock)',
        subjectKind: 'guard',
        detail: 'Copy of attendance and pay records for 2025',
        receivedOn,
        dueOn: addDays(receivedOn, 21),
        idVerified: null,
        status: 'open',
        closed: null,
        ...rest,
      };
    };
    ds.pdpaRequests.push(
      req(1, { receivedDaysAgo: 25, companyId: 'co-arsh', idVerified: { by: 'Siti Mariam binti Osman', at: ago(20) } }),
      req(2, { receivedDaysAgo: 4, kind: 'CORRECTION', subjectName: 'Guard (mock)', detail: 'Wrong IC number on the payslip' }),
      req(3, {
        receivedDaysAgo: 12,
        kind: 'WITHDRAW_CONSENT',
        subjectName: 'Staff (mock)',
        subjectKind: 'staff',
        companyId: 'co-inas',
        detail: 'Stop location tracking on my own phone; will clock in at the office device',
      }),
      req(4, {
        receivedDaysAgo: 40,
        kind: 'PORTABILITY',
        subjectName: 'Client contact (mock)',
        subjectKind: 'client',
        detail: 'Visitor log entries for their staff',
        status: 'done',
        idVerified: { by: 'Siti Mariam binti Osman', at: ago(38) },
        closed: { by: 'Siti Mariam binti Osman', at: ago(30), note: 'CSV sent by encrypted email (mock)' },
      }),
    );
  }

  // Continuity: the systems and their three copies. Prima is not hosted yet, so every entry is test data.
  {
    const nowMs = toMs(now);
    const hAgo = (h: number) => fromMs(nowMs - h * 3_600_000);
    const copy = (
      site: 'CLOUD' | 'OWN_SERVER' | 'EMERGENCY',
      where: string,
      backupHoursAgo: number | null,
      test: { daysAgo: number; ok: boolean; hours: number; loss: number } | null,
      inMalaysia = true,
    ) => ({
      site,
      where,
      inMalaysia,
      lastBackupAt: backupHoursAgo === null ? null : hAgo(backupHoursAgo),
      lastRestoreTest: test
        ? {
            on: addDays(today, -test.daysAgo),
            ok: test.ok,
            hours: test.hours,
            dataLossMinutes: test.loss,
            by: 'IT Lead (mock)',
            note: test.ok ? '' : 'Restore stopped at 60%: the backup file was incomplete (mock)',
          }
        : null,
    });
    ds.bcmSystems.push(
      {
        id: 'bcm-prima',
        name: 'Prima Secure App (database and files)',
        impact: 'Clock-ins, patrols, cases and every screen',
        rtoHours: 4,
        rpoHours: 1,
        copies: [
          copy('CLOUD', 'Cloud region in Malaysia (mock)', 0.5, { daysAgo: 40, ok: true, hours: 2.5, loss: 20 }),
          copy('OWN_SERVER', "Fauzan's own server, Kuala Lumpur (mock)", 6, { daysAgo: 200, ok: true, hours: 5, loss: 50 }),
          copy('EMERGENCY', 'Emergency server, Johor Bahru (mock)', null, null),
        ],
      },
      {
        id: 'bcm-cms',
        name: 'CMS command centre (IP phones and recordings)',
        impact: 'Monitoring of sites, vaults and alarms',
        rtoHours: 4,
        rpoHours: 1,
        copies: [
          copy('CLOUD', 'Cloud region in Malaysia (mock)', 0.8, { daysAgo: 70, ok: true, hours: 3, loss: 30 }),
          copy('OWN_SERVER', 'CMS room server (mock)', 2, null),
        ],
      },
      {
        id: 'bcm-sql',
        name: 'SQL Account (each company)',
        impact: 'Billing, payments and the statutory accounts',
        rtoHours: 24,
        rpoHours: 24,
        copies: [
          copy('OWN_SERVER', 'Finance server, PWVSB office (mock)', 14, { daysAgo: 100, ok: false, hours: 6, loss: 0 }),
          copy('CLOUD', 'Vendor cloud backup, Singapore (mock)', 20, { daysAgo: 100, ok: true, hours: 8, loss: 600 }, false),
        ],
      },
      {
        id: 'bcm-m365',
        name: 'Microsoft 365 (email and files)',
        impact: 'Email, tender documents, Outlook deadlines',
        rtoHours: 8,
        rpoHours: 24,
        copies: [copy('CLOUD', 'Microsoft Malaysia West (mock)', 3, { daysAgo: 30, ok: true, hours: 1, loss: 0 })],
      },
    );
    ds.bcmDrills.push(
      {
        id: 'drill-1',
        playbookId: 'SITE_OFFLINE',
        on: addDays(today, -60),
        by: 'IT Lead (mock)',
        findings: 'Two site phones did not keep scans offline; app updated (mock)',
        actionsOpen: 0,
      },
      {
        id: 'drill-2',
        playbookId: 'PRIMA_DOWN',
        on: addDays(today, -420),
        by: 'IT Manager (mock)',
        findings: 'Paper sheets missing at 6 sites (mock)',
        actionsOpen: 2,
      },
    );
  }

  // Statutory audits for the latest year end, and legal matters. Test data.
  {
    const nowMs = toMs(now);
    const ago = (d: number) => fromMs(nowMs - d * 86_400_000);
    const ty = Number(today.slice(0, 4));
    const PBC = [
      'Trial balance and general ledger',
      'Bank confirmations',
      'Fixed asset register',
      'Payroll and statutory contributions',
      'Debtor ageing and contracts',
    ];
    ds.corpProfiles.slice(0, 10).forEach((p, i) => {
      const end = (y: number) => new Date(Date.UTC(y, p.fyeMonth, 0)).toISOString().slice(0, 10);
      const fyEnd = end(ty) < today ? end(ty) : end(ty - 1);
      const age = daysBetween(fyEnd, today);
      const planned = age > 20;
      const handed = (k: number) => (age > 60 + k * 10 && !(i === 1 && k === 3) ? addDays(fyEnd, 45 + k * 7) : null);
      const signed = age > 150 && i !== 1;
      ds.corpAudits.push({
        id: `audit-${p.companyId}-${fyEnd.slice(0, 4)}`,
        companyId: p.companyId,
        fyEnd,
        auditorFirm: p.auditor,
        fee: 18000 + i * 1500,
        planningOn: planned ? addDays(fyEnd, 20) : null,
        pbc: PBC.map((item, k) => ({ item, dueOn: addDays(fyEnd, 40 + k * 7), receivedOn: signed ? addDays(fyEnd, 45 + k * 7) : handed(k) })),
        adjustments:
          age > 100
            ? [{ desc: 'Accrual for October guard overtime (mock)', amount: 42000 + i * 1000, agreedBy: signed || i !== 2 ? 'Company manager (mock)' : null }]
            : [],
        signed: signed
          ? {
              on: addDays(fyEnd, 140),
              opinion: i === 4 ? 'qualified' : 'unmodified',
              ref: `AR/${fyEnd.slice(0, 4)}/${p.companyId.replace('co-', '').toUpperCase()} (mock)`,
            }
          : null,
      });
    });
    const lm = (companyId: Id, n: number, o: Partial<LegalMatter> & { title: string; kind: LegalMatter['kind'] }): LegalMatter => ({
      id: `lm-${companyId}-${n}`,
      companyId,
      ref: `LM-${companyId.replace('co-', '').toUpperCase()}-${String(n).padStart(3, '0')}`,
      counterparty: 'Mock party',
      side: 'respondent',
      exposure: null,
      lawyer: 'Tetuan Mock & Partners (mock)',
      nextDate: null,
      updates: [],
      fees: [],
      status: 'open',
      outcome: null,
      openedOn: addDays(today, -60),
      ...o,
    });
    ds.legalMatters.push(
      lm('co-sasa', 1, {
        title: 'Unfair dismissal claim by a former guard (s.20 Industrial Relations Act)',
        kind: 'LABOUR',
        counterparty: 'Former guard (mock)',
        exposure: 36000,
        nextDate: { on: addDays(today, 5), what: 'Industrial Court mention' },
        updates: [{ at: ago(10), by: 'Legal Counsel (mock)', text: 'Witness statements filed (mock)' }],
        fees: [{ on: addDays(today, -30), amount: 4500, invoiceRef: 'INV-L-221 (mock)' }],
      }),
      lm('co-sasa', 2, {
        title: 'Unpaid invoices from a mall client',
        kind: 'DEMAND',
        side: 'claimant',
        counterparty: 'Mall management (mock)',
        exposure: 128000,
        nextDate: { on: addDays(today, -3), what: 'Reply due to letter of demand' },
        openedOn: addDays(today, -45),
      }),
      lm('co-arsh', 1, {
        title: 'Client claim for a theft during the night shift',
        kind: 'CONTRACT',
        counterparty: 'Warehouse client (mock)',
        exposure: 85000,
        lawyer: 'Insurer-appointed panel lawyer (mock)',
        openedOn: addDays(today, -90),
        updates: [{ at: ago(50), by: 'Kenny Lau Chee Wah', text: 'Notified insurer under public liability (mock)' }],
      }),
      lm('co-inas', 1, {
        title: 'KDN show-cause letter on a late licence return',
        kind: 'REGULATORY',
        counterparty: 'KDN (mock)',
        nextDate: { on: addDays(today, 12), what: 'Written reply to KDN' },
        openedOn: addDays(today, -8),
      }),
      lm('co-inas', 2, {
        title: 'Labour Office claim for overtime',
        kind: 'LABOUR',
        counterparty: 'Guard (mock)',
        exposure: 4200,
        status: 'closed',
        outcome: 'Settled at RM3,100 at the Labour Office (mock)',
        openedOn: addDays(today, -200),
      }),
    );
  }

  // ----- Sales leads before quoting (V3 CRM) -----
  {
    const at = (d: number) => `${addDays(today, -d)}T10:00:00+08:00`;
    const research = (o: Partial<NonNullable<SalesLead['research']>> = {}): NonNullable<SalesLead['research']> => ({
      ssmRegNo: '2019010XXXXX (mock)',
      ssmActive: true,
      ssmCheckedOn: addDays(today, -20),
      payment: 'good',
      currentProvider: 'Another guard company (mock)',
      risks: 'None found',
      armed: false,
      by: 'Admin executive (mock)',
      at: at(20),
      ...o,
    });
    const L = (companyId: Id, n: number, o: Partial<SalesLead> & { prospect: string }): SalesLead => ({
      id: `lead-${companyId}-${n}`,
      companyId,
      ref: `LD-${companyId.replace('co-', '').toUpperCase()}-${String(n).padStart(3, '0')}`,
      sector: 'COMMERCIAL',
      source: 'Referral',
      owner: 'Company manager',
      createdAt: at(30),
      guardsEst: 6,
      estMonthly: null,
      stage: 'new',
      research: null,
      survey: null,
      riskAcceptedBy: null,
      quotationId: null,
      nextAction: null,
      notes: [],
      closed: null,
      ...o,
    });
    const accepted = ds.quotations.find((q) => q.companyId === 'co-sasa' && q.status === 'accepted');
    ds.salesLeads.push(
      L('co-sasa', 1, {
        prospect: 'Kilang Perabot Maju (mock)',
        sector: 'INDUSTRIAL',
        guardsEst: 8,
        estMonthly: 24000,
        nextAction: { on: addDays(today, 2), what: 'SSM search and payment check' },
      }),
      L('co-sasa', 2, {
        prospect: 'Pangsapuri Seri Indah JMB (mock)',
        sector: 'RESIDENTIAL',
        stage: 'researched',
        research: research({ payment: 'slow', risks: 'JMB accounts show arrears to the previous provider' }),
        guardsEst: 10,
        estMonthly: 28000,
        createdAt: at(40),
        nextAction: { on: addDays(today, -6), what: 'Site survey' },
      }),
      L('co-sasa', 3, {
        prospect: accepted?.client ?? 'Plaza Damai Management (mock)',
        stage: 'won',
        research: research(),
        survey: {
          on: addDays(today, -40),
          by: 'Operations Manager (mock)',
          guardsNeeded: accepted?.guards ?? 6,
          hoursPerDay: 12,
          note: 'Two gates, one patrol',
        },
        quotationId: accepted?.id ?? null,
        createdAt: at(60),
        closed: { on: addDays(today, -30), by: 'Nor Azlina binti Hashim', reason: 'Quotation accepted' },
      }),
      L('co-arsh', 1, {
        prospect: 'Kilang Perabot Maju (mock)',
        sector: 'INDUSTRIAL',
        stage: 'surveyed',
        research: research({ ssmCheckedOn: addDays(today, -12), at: at(12) }),
        survey: { on: addDays(today, -5), by: 'Operations Manager (mock)', guardsNeeded: 8, hoursPerDay: 12, note: 'Main gate and loading bay' },
        guardsEst: 8,
        estMonthly: 25600,
        createdAt: at(14),
        nextAction: { on: addDays(today, 3), what: 'Price the quotation' },
      }),
      L('co-arsh', 2, {
        prospect: 'Gudang Logistik Timur (mock)',
        sector: 'INDUSTRIAL',
        stage: 'dropped',
        research: research({ ssmActive: false, risks: 'SSM shows the company is being wound up' }),
        createdAt: at(50),
        closed: { on: addDays(today, -44), by: 'Kenny Lau Chee Wah', reason: 'Company being wound up per SSM search' },
      }),
      L('co-inas', 1, { prospect: 'Klinik Pergigian Sentosa (mock)', sector: 'HEALTH', guardsEst: 2, createdAt: at(25) }),
    );
  }

  // ----- ACT: workflow audits, findings at each step and improvements (Fauzan, 27 Oct 2026; test data) -----
  {
    const at = (d: number) => `${addDays(today, -d)}T10:00:00+08:00`;
    const F = (n: number, o: Partial<ActFinding> & { title: string; area: string; ownerUserId: Id; ownerName: string }): ActFinding => ({
      id: `act-f-${n}`,
      ref: `ACT-${String(n).padStart(4, '0')}`,
      companyId: null,
      source: 'workflow_audit',
      detail: '',
      severity: 'medium',
      evidence: 'Sample of records checked (mock)',
      raisedBy: 'ACT Auditor, Team 1 (mock)',
      raisedById: 'u-act-aud1',
      // The Director gave the sample findings out across both teams (Fauzan, 2 Nov 2026).
      team: n % 2 === 1 ? 1 : 2,
      raisedAt: at(20),
      dueOn: addDays(today, 10),
      plan: null,
      fix: null,
      checks: [],
      status: 'open',
      ...o,
    });
    ds.actFindings.push(
      F(1, {
        companyId: 'co-sasa',
        area: 'ATTENDANCE',
        title: 'Replacement guards rostered without a check of their KDN vetting',
        severity: 'high',
        evidence: '6 of 40 replacements in September had no vetting record at roster time (mock)',
        ownerUserId: 'u-cm-sasa',
        ownerName: 'Nor Azlina binti Hashim',
        raisedAt: at(25),
        dueOn: addDays(today, -11),
      }),
      F(2, {
        companyId: 'co-arsh',
        area: 'BILLING',
        title: 'Invoices sent after the 10th without a reason recorded',
        evidence: '3 of 12 September invoices sent on the 14th to 18th (mock)',
        ownerUserId: 'u-cm-arsh',
        ownerName: 'Kenny Lau Chee Wah',
        status: 'planned',
        plan: {
          rootCause: 'Site attendance closed late by two officers',
          solution: 'Attendance closes on the 3rd; billing starts on the 4th',
          targetOn: addDays(today, 7),
          by: 'Kenny Lau Chee Wah',
          at: at(8),
        },
      }),
      F(3, {
        area: 'PURCHASING',
        title: 'Three quotes missing on two uniform purchases above RM5,000',
        evidence: 'PR files reviewed (mock)',
        ownerUserId: 'u-cos',
        ownerName: 'Aisyah binti Rahman',
        status: 'fixed',
        plan: {
          rootCause: 'Repeat order treated as exempt',
          solution: 'Repeat orders now need 3 quotes yearly',
          targetOn: addDays(today, -2),
          by: 'Aisyah binti Rahman',
          at: at(12),
        },
        fix: { proof: 'Procedure updated and 3 quotes obtained for the October order (mock)', by: 'Aisyah binti Rahman', at: at(1) },
      }),
      F(4, {
        companyId: 'co-inas',
        area: 'LICENSING',
        title: 'CSG training not booked for guards in their 10th month',
        severity: 'low',
        source: 'monitor',
        ownerUserId: 'u-cm-inas',
        ownerName: 'Mohd Shukri bin Ahmad',
        status: 'closed',
        raisedAt: at(60),
        dueOn: addDays(today, -1),
        plan: { rootCause: 'No reminder', solution: 'Prima reminder at month 9', targetOn: addDays(today, -20), by: 'Mohd Shukri bin Ahmad', at: at(50) },
        fix: { proof: 'All 4 guards booked for CSG (mock)', by: 'Mohd Shukri bin Ahmad', at: at(30) },
        checks: [{ ok: true, note: 'Bookings seen with the training provider (mock)', by: 'ACT Auditor, Team 2 (mock)', at: at(28) }],
      }),
    );
    ds.actAudits.push(
      {
        id: 'act-a-1',
        area: 'ATTENDANCE',
        companyId: 'co-sasa',
        doneOn: addDays(today, -25),
        by: 'ACT Auditor, Team 1 (mock)',
        result: 'findings',
        note: 'Sample of 40 replacements (mock)',
        findingIds: ['act-f-1'],
      },
      {
        id: 'act-a-2',
        area: 'BILLING',
        companyId: 'co-arsh',
        doneOn: addDays(today, -20),
        by: 'ACT Auditor, Team 2 (mock)',
        result: 'findings',
        note: 'September invoices (mock)',
        findingIds: ['act-f-2'],
      },
      {
        id: 'act-a-3',
        area: 'PURCHASING',
        companyId: null,
        doneOn: addDays(today, -20),
        by: 'ACT Auditor, Team 2 (mock)',
        result: 'findings',
        note: 'Purchases above RM5,000 (mock)',
        findingIds: ['act-f-3'],
      },
      {
        id: 'act-a-4',
        area: 'ARMS',
        companyId: 'co-arsh',
        doneOn: addDays(today, -230),
        by: 'ACT Director (mock)',
        result: 'clean',
        note: 'Vault count and movement log (mock)',
        findingIds: [],
      },
      {
        id: 'act-a-5',
        area: 'PDPA',
        companyId: null,
        doneOn: addDays(today, -90),
        by: 'ACT Auditor, Team 2 (mock)',
        result: 'clean',
        note: 'Consent forms and access requests (mock)',
        findingIds: [],
      },
    );
    ds.actImprovements.push({
      id: 'act-i-1',
      ref: 'ACT-IMP-001',
      title: 'Check KDN vetting automatically before a replacement is rostered',
      benefit: 'No guard works without a vetting record; removes the repeat finding in every company',
      findingIds: ['act-f-1'],
      ownerUserId: 'u-coo',
      ownerName: 'Ahmad Faisal bin Zainal',
      ledBy: 'ACT Director (mock)',
      targetOn: addDays(today, 30),
      steps: [
        { text: 'Agree the rule with Operations and HR', doneOn: addDays(today, -5), by: 'ACT Director (mock)' },
        { text: 'Block the roster screen when vetting is missing', doneOn: null, by: null },
        { text: 'Brief all Operations Managers', doneOn: null, by: null },
      ],
      approved: { by: 'Ahmad Faisal bin Zainal', at: at(6) },
      result: null,
      createdAt: at(9),
    });
  }

  // Firearm serial numbers and RFID tags (Fauzan, 27 Oct 2026). Mock values: the full serial ends in the digits already
  // shown masked; one firearm in seven is not tagged yet, and one issue in five was picked by hand rather than scanned.
  const frng = new Rng(MASTER_SEED + 27);
  ds.firearms.forEach((f, i) => {
    f.serial = `MOCK${frng.int(100, 999)}${f.serialMasked.slice(-4)}`;
    f.rfidTag = i % 7 === 3 ? null : `E28011${(0x1000000 + i * 7919).toString(16).toUpperCase().padStart(8, '0')}${frng.int(1000, 9999)}`;
  });
  // Office staff seeded before the full staff record have its required fields (bug found 27 Oct 2026: their edit form
  // could not be saved without them).
  ds.people
    .filter((p) => p.role === 'office')
    .forEach((p, i) => {
      p.gender ??= i % 2 ? 'F' : 'M';
      p.employmentType ??= 'permanent';
    });
  // Office staff seeded before the full staff record get its required fields, so their edit form saves (bug found 27 Oct 2026).
  ds.people
    .filter((p) => p.role === 'office')
    .forEach((p, i) => {
      p.gender ??= i % 2 ? 'F' : 'M';
      p.employmentType ??= 'permanent';
      if (p.status === 'left' && !p.leaving)
        p.leaving = {
          kind: 'resigned',
          noticeOn: null,
          lastDayOn: addDays(today, -30),
          reason: 'Resigned (mock)',
          by: 'HR (mock)',
          at: `${addDays(today, -30)}T09:00:00+08:00`,
        };
    });
  const tagOf = new Map(ds.firearms.map((f) => [f.id, f.rfidTag]));
  ds.armsMovements.forEach((m, i) => {
    m.issueCheck = tagOf.get(m.firearmId) && i % 5 !== 2 ? 'rfid' : 'manual';
    m.returnCheck = m.returnedAt ? (tagOf.get(m.firearmId) ? 'rfid' : 'manual') : null;
  });

  // Public holidays (slice 3C, mock): the Act's fixed days that fall on a fixed date, for this year and next. HR enters
  // the rest of the gazetted list (Hari Raya, Chinese New Year, Deepavali and the state days) each year.
  for (const y of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
    const firstMondayJune = (() => {
      for (let d = 1; d <= 7; d++) if (new Date(Date.UTC(y, 5, d)).getUTCDay() === 1) return `${y}-06-0${d}`;
      return `${y}-06-01`;
    })();
    const fixed: [string, string, PublicHoliday['compulsory']][] = [
      [`${y}-05-01`, 'Labour Day', 'LABOUR_DAY'],
      [firstMondayJune, "Agong's birthday", 'AGONG_BIRTHDAY'],
      [`${y}-08-31`, 'National Day', 'NATIONAL_DAY'],
      [`${y}-09-16`, 'Malaysia Day', 'MALAYSIA_DAY'],
    ];
    for (const [date, name, compulsory] of fixed)
      ds.publicHolidays.push({ id: `ph-${date}`, date, name, states: null, compulsory, addedBy: 'Prima (mock)', addedById: 'mock', addedAt: `${y - 1}-12-01T09:00:00+08:00`, note: 'Fixed by the Act (mock list)', removed: null });
  }
  // Allowance list (Fauzan, 3 Nov 2026; synthetic). The ticks here are test entries only: HR sets the real list and
  // confirms each tick against the law. Existing staff allowances carry no type, so payroll figures do not change.
  for (const [id, name, frequency, usual, epf, socso] of [
    ['alw-phone', 'Phone allowance', 'monthly', 150, true, true],
    ['alw-car', 'Car allowance', 'monthly', 600, true, true],
    ['alw-travel', 'Travel allowance (test entry)', 'both', null, false, false],
    ['alw-acting', 'Acting allowance', 'both', null, true, true],
  ] as const)
    ds.allowanceTypes.push({
      id,
      name,
      frequency,
      usualAmount: usual,
      cap: null,
      epf,
      socso,
      pcb: true,
      hrd: epf,
      basis: 'Synthetic test entry: HR confirms the ticks against the law before use.',
      active: true,
      addedBy: 'Prima (mock)',
      addedById: 'mock',
      addedAt: `${today.slice(0, 4)}-01-02T09:00:00+08:00`,
      changes: [],
    });
  // Group website management: sample domains, websites, reviews and checks (Fauzan, 27 Oct 2026).
  seedWebsites(ds, today, now);
  // Working from home (Fauzan, 27 Oct 2026; mock). Two central staff work from home every weekday: the IT Executive
  // keeps every step; the Finance data entry executive has missed plans, check-ins and reports, so HR is asked to talk
  // to them. One more central application and one Arrow Shield application wait for an answer.
  {
    const nowMs = toMs(now);
    const user = (id: string) => ds.users.find((u) => u.id === id);
    const home = (u: User, metres: number) => ({
      label: 'Home (mock)',
      lat: u.base!.lat + metres / 111_000,
      lng: u.base!.lng,
      radiusM: RULES.remotePlace.value.radiusM,
    });
    const weekdays: string[] = [];
    for (let d = addDays(today, -1); weekdays.length < 8; d = addDays(d, -1)) if (weekdayOf(d) <= 5) weekdays.push(d);
    const arrange = (u: User, status: 'approved' | 'applied', appliedDaysAgo: number, reason: string, days = [1, 2, 3, 4, 5]) => {
      const applied = fromMs(nowMs - appliedDaysAgo * 86_400_000);
      const id = `wfh-${u.id}-1`;
      ds.remoteArrangements.push({
        id,
        userId: u.id,
        userName: u.name,
        companyId: u.role === 'pwvsb_officer' || u.role === 'director' ? null : (u.companyIds[0] ?? null),
        days,
        from: status === 'approved' ? addDays(today, -appliedDaysAgo + 3) : addDays(today, 7),
        to: addDays(today, 90),
        reason,
        place: home(u, 9000),
        noticeAt: applied,
        appliedAt: applied,
        answerBy: addDays(dateOf(applied), RULES.remoteAnswerDays.value),
        status,
        decidedBy: status === 'approved' ? 'Chief of Staff (mock)' : null,
        decidedAt: status === 'approved' ? fromMs(nowMs - (appliedDaysAgo - 2) * 86_400_000) : null,
        decisionNote: status === 'approved' ? 'Approved for three months, then reviewed.' : '',
      });
      // Only staff HR has allowed may work from home (Fauzan, 2 Nov 2026).
      const per = ds.people.find((p) => p.id === u.personId);
      if (per) per.wfhAllowed = { by: 'HR (mock)', byId: 'mock-hr', at: applied, note: 'Work can be done from home (mock).' };
      return id;
    };
    const clock = (u: User, date: string, inAt: string, outAt: string | null) => {
      const start = toMs(myt(date, inAt));
      if (start > nowMs) return null;
      const end = outAt ? toMs(myt(date, outAt)) : null;
      const shot = (ms: number) => ({
        image: '',
        sha256: sha256Hex(`login-${u.id}-${ms}`),
        capturedAt: fromMs(ms),
        receivedAt: fromMs(ms),
        lat: null,
        lng: null,
        accuracyM: null,
        distanceM: null,
        face: null,
        source: 'login' as const,
      });
      ds.staffClocks.push({
        id: `sc-${u.id}-${start}`,
        userId: u.id,
        userName: u.name,
        companyId: null,
        in: shot(start),
        out: end !== null && end <= nowMs ? shot(end) : null,
        flags: outAt === '23:59' ? ['NO_SIGN_OUT'] : [],
        lastPingAt: null,
        pings: 0,
        mode: 'login',
      });
      return start;
    };
    const at = (date: string, hhmm: string) => myt(date, hhmm);
    const good = user('u-it-ex1');
    const poor = user('u-fin-t1-de2');
    if (good?.base && poor?.base) {
      const goodId = arrange(good, 'approved', 40, 'Two-hour commute each way; most helpdesk and asset work is done online.');
      const poorId = arrange(poor, 'approved', 30, 'Caring for a parent at home after surgery.');
      const day = (u: User, arrangementId: string, date: string, d: Partial<RemoteDay>) =>
        ds.remoteDays.push({
          id: `rd-${u.id}-${date}`,
          userId: u.id,
          userName: u.name,
          companyId: null,
          date,
          arrangementId,
          plan: null,
          checkIns: [],
          report: null,
          review: null,
          start: { at: at(date, '08:52'), distanceM: 40, atPlace: true },
          ...d,
        });
      const tasks = (date: string, done: number, texts: string[]) =>
        texts.map((text, i) => ({
          id: `t${i + 1}`,
          text,
          status: i < done ? ('done' as const) : date === today ? ('planned' as const) : ('carried' as const),
          output: i < done ? `Done (mock output ${i + 1})` : '',
        }));
      weekdays.forEach((date, k) => {
        clock(good, date, '08:50', '17:40');
        day(good, goodId, date, {
          plan: {
            at: at(date, '09:12'),
            tasks: tasks(date, 3, [
              'Close helpdesk tickets in the queue',
              'Laptop set-up list for new staff',
              'Renew two domain records',
              'Update the M365 training slides',
            ]),
          },
          checkIns: [
            { due: '11:00', at: at(date, '11:04'), note: 'On tickets, 6 closed so far' },
            { due: '15:00', at: at(date, '15:09'), note: 'Domains renewed, on the laptop list' },
          ],
          report: {
            at: at(date, '17:31'),
            summary: 'Closed 11 tickets, finished the laptop list, renewed both domains.',
            blockers: k === 0 ? 'Waiting for Finance to approve the Microsoft renewal.' : '',
          },
          review: k === 0 ? null : { by: 'Chief of Staff (mock)', at: at(addDays(date, 1), '09:30'), verdict: 'accepted', note: '' },
        });
        // Every third day the Finance executive never signed out and sent no report.
        const noReport = k % 3 === 1;
        clock(poor, date, '09:05', noReport ? '23:59' : '17:15');
        day(poor, poorId, date, {
          plan:
            k % 2 === 0
              ? {
                  at: at(date, k === 0 ? '10:40' : '09:30'),
                  tasks: tasks(date, 2, ['Key in supplier invoices batch', 'Bank reconciliation for Team 1', 'File payment vouchers']),
                }
              : null,
          checkIns:
            k % 2 === 0
              ? [
                  { due: '11:00', at: at(date, '11:20'), note: 'Keying in invoices' },
                  { due: '15:00', at: at(date, '15:12'), note: 'On the bank reconciliation' },
                ]
              : [],
          report:
            noReport || k % 2 === 1 ? null : { at: at(date, '17:10'), summary: 'Keyed in the invoice batch and part of the reconciliation.', blockers: '' },
          review:
            k > 1 && !noReport && k % 2 === 0
              ? {
                  by: 'HR Admin (mock)',
                  at: at(addDays(date, 1), '10:00'),
                  verdict: k === 4 ? 'queried' : 'accepted',
                  note: k === 4 ? 'Only part of the reconciliation: what held it up?' : '',
                }
              : null,
          start: k === 2 ? { at: at(date, '09:06'), distanceM: 4200, atPlace: false } : { at: at(date, '09:06'), distanceM: 60, atPlace: true },
        });
      });
      if (weekdayOf(today) <= 5) {
        if (clock(good, today, '08:50', null) !== null) {
          const past = (hhmm: string) => toMs(myt(today, hhmm)) <= nowMs;
          day(good, goodId, today, {
            plan: past('09:12')
              ? {
                  at: at(today, '09:12'),
                  tasks: tasks(today, past('10:15') ? 1 : 0, [
                    'Close helpdesk tickets in the queue',
                    'Prepare the IT tender spec for Inas',
                    'Check the backups report',
                  ]),
                }
              : null,
            checkIns: past('11:04') ? [{ due: '11:00', at: at(today, '11:04'), note: 'Tickets done, on the tender spec' }] : [],
          });
          for (const hhmm of ['09:20', '09:41', '10:05', '10:22'])
            if (past(hhmm))
              appendAudit(ds.audit, {
                at: at(today, hhmm),
                actor: good.name,
                companyId: null,
                action: 'it.ticket_update',
                entity: 'it_ticket',
                entityId: `mock-${hhmm}`,
                summary: `${good.name} updated a helpdesk ticket`,
              });
        }
        if (clock(poor, today, '09:05', null) !== null) day(poor, poorId, today, { start: null });
      }
    }
    const waiting = user('u-fin-t1-de1');
    if (waiting?.base) arrange(waiting, 'applied', 5, 'Moving house next month; asking for Mondays and Fridays at home.', [1, 5]);
    const arsh = user('u-ae-arsh');
    if (arsh?.base) arrange(arsh, 'applied', 2, 'Childcare on Wednesdays.', [3]);
  }

  // Remote and branch work plan (Fauzan, 27 Oct 2026; mock, built for all staff for study). A branch manager sign-in
  // for each pilot branch; start dates; four weeks of playbook tasks with a mix of good, average and poor results;
  // manager tasks, help requests and one-to-ones; branch checklists, visits and spot checks. Its own random stream,
  // so the data above does not change.
  {
    const r = mulberry32(2710);
    const nowMs = toMs(now);
    const past = (t: string) => toMs(t) <= nowMs;
    const BRANCH_AT: Record<string, [number, number]> = {
      Selangor: [3.0738, 101.5183],
      'Kuala Lumpur': [3.139, 101.6869],
      Johor: [1.4927, 103.7414],
      'Pulau Pinang': [5.4141, 100.3288],
      Perak: [4.5975, 101.0901],
      'Negeri Sembilan': [2.7258, 101.9424],
      Melaka: [2.1896, 102.2501],
    };
    ds.branches.forEach((b, k) => {
      const [lat, lng] = BRANCH_AT[b.state] ?? [3.1, 101.6];
      const id = `u-bm-${b.id.slice(3)}`;
      const name = `${b.name} Branch Manager (mock)`;
      const personId = `pr-${b.id.slice(3)}-bm`;
      ds.people.push({
        id: personId,
        companyId: b.companyId,
        branchId: b.id,
        staffNo: `${b.id.slice(3, -2).toUpperCase()}BM${String(k + 1).padStart(2, '0')}`,
        name,
        nationality: 'MY',
        idMasked: `8${k}0512-**-***${k}`,
        dob: `198${k}-05-12`,
        phone: `012-55${k} 7${k}10`,
        role: 'office',
        status: 'active',
        hiredOn: addDays(today, -Math.round(400 + r() * 1500)),
        faceEnrolledOn: null,
        basicPay: 6500,
        jobTitle: 'Branch Manager',
      });
      ds.users.push({
        id,
        name,
        title: `Branch Manager, ${b.name} (runs the branch for the company)`,
        role: 'admin_exec',
        companyIds: [b.companyId],
        siteIds: [],
        branchId: b.id,
        personId,
        base: { name: `${b.name} branch office (mock)`, lat, lng, radiusM: 200 },
      });
    });
    ds.users.push({
      id: 'u-planner-sync',
      name: 'Microsoft Planner feed',
      title: 'System: sends task changes made in Microsoft Planner',
      role: 'pwvsb_officer',
      integration: 'planner',
      companyIds: [],
      siteIds: [],
    });
    const staff = ds.users.filter((u) => !u.integration && u.role !== 'guard' && u.role !== 'site_device' && hasOwnStaffRecord(u));
    const profileOf = (u: User): 'good' | 'average' | 'poor' => {
      if (u.id === 'u-fin-t1-de2' || u.id === 'u-bm-arsh-2') return 'poor';
      if (u.id === 'u-it-ex1') return 'good';
      const x = r();
      return x < 0.7 ? 'good' : x < 0.9 ? 'average' : 'poor';
    };
    const profile = new Map(staff.map((u) => [u.id, profileOf(u)]));
    // Start dates are HR's own records (Person.hiredOn); two newer joiners for the 3-month probation (D5).
    const hired = (u: User) => ds.people.find((p) => p.id === u.personId)?.hiredOn ?? null;
    const setHired = (id: string, days: number) => {
      const p = ds.people.find((x) => x.id === ds.users.find((u) => u.id === id)?.personId);
      if (p) p.hiredOn = addDays(today, -days);
    };
    setHired('u-it-ex4', 40);
    setHired('u-fin-t1-de1', 62);
    const companyOf = (u: User) => (u.role === 'pwvsb_officer' || u.role === 'director' ? null : (u.companyIds[0] ?? null));
    const line = (u: User) => lineManagerOf(u, ds.users).manager;

    // Playbook sign-offs: most people past probation; not the newer joiners, and not every one.
    for (const u of staff) {
      const pb = playbookFor(u);
      const mgr = line(u);
      const joined = hired(u);
      if (pb.items.length === 0 || !mgr || !joined || addDays(joined, 90) > today || u.id === 'u-fin-t1-de1') continue;
      if (u.id !== 'u-it-ex1' && u.id !== 'u-fin-t1-de2' && r() < 0.2) continue;
      ds.playbookSignoffs.push({ id: `pbs-${u.id}`, userId: u.id, companyId: companyOf(u), key: pb.key, by: mgr.name, at: myt(addDays(joined, 95), '10:00') });
    }

    // Four weeks of playbook duties, done with proof (or not) by profile.
    const weekdays: string[] = [];
    for (let dd = addDays(today, -1); weekdays.length < 20; dd = addDays(dd, -1)) if (weekdayOf(dd) <= 5) weekdays.push(dd);
    const thisWeek = periodOf('weekly', today);
    const lastMonthDay = addDays(`${today.slice(0, 7)}-01`, -1);
    const audits: { at: string; actor: string; companyId: string | null; action: string }[] = [];
    for (const u of staff) {
      const pb = playbookFor(u);
      if (pb.items.length === 0) continue;
      const p = profile.get(u.id)!;
      const onTime = p === 'good' ? 0.95 : p === 'average' ? 0.82 : 0.55;
      const mgr = line(u);
      const make = (item: (typeof pb.items)[number], date: string) => {
        const period = periodOf(item.every, date);
        const id = `wt-${u.id}-${item.id}-${period}`;
        if (ds.workTasks.some((t) => t.id === id)) return;
        const dueAt = dueOf(item, date);
        if (!past(dueAt) && period !== periodOf(item.every, today)) return;
        const x = r();
        const done = past(dueAt) ? (x < onTime ? 'on_time' : x < onTime + (1 - onTime) * 0.7 ? 'late' : 'missed') : 'open';
        const doneAt = done === 'on_time' ? toMs(dueAt) - Math.round(20 + r() * 240) * 60_000 : done === 'late' ? toMs(dueAt) + Math.round(60 + r() * 900) * 60_000 : null;
        const hasDone = doneAt !== null && doneAt <= nowMs;
        const reviewed = hasDone && doneAt! < nowMs - 86_400_000 * (0.5 + r());
        const returned = reviewed && p === 'poor' && r() < 0.15;
        ds.workTasks.push({
          id,
          userId: u.id,
          userName: u.name,
          companyId: companyOf(u),
          title: item.text,
          doneMeans: item.doneMeans,
          source: 'playbook',
          playbookItemId: item.id,
          period,
          assignedBy: null,
          assignedById: null,
          createdAt: myt(item.every === 'daily' ? date : period.length === 7 ? `${period}-01` : period, '07:00'),
          dueAt: returned ? fromMs(doneAt! + 2 * 86_400_000) : dueAt,
          priority: 'normal',
          status: returned ? 'returned' : !hasDone ? 'open' : reviewed ? 'accepted' : 'done',
          evidence: hasDone && !returned ? { at: fromMs(doneAt!), note: `Done: ${item.doneMeans.split(',')[0].toLowerCase()}`, ref: `REF-${1000 + ds.workTasks.length}` } : null,
          late: null,
          review: reviewed && mgr
            ? { by: mgr.name, at: fromMs(Math.min(nowMs, doneAt! + 18 * 3_600_000)), verdict: returned ? 'returned' : 'accepted', note: returned ? 'Not to the standard: check the figures and send again.' : '' }
            : null,
          planner: { planId: RULES.plannerPreferred.value.planId, taskId: `mock-planner-${id}`, state: 'synced', syncedAt: fromMs(nowMs - 3_600_000), plannerChangedAt: null, error: '' },
        });
        // A missed duty well in the past was left open only by the poor performers; others finished it late.
        if (done === 'missed' && p !== 'poor' && date < addDays(today, -3)) {
          const t = ds.workTasks[ds.workTasks.length - 1];
          t.status = 'accepted';
          t.evidence = { at: fromMs(toMs(dueAt) + 2 * 86_400_000), note: 'Done late', ref: '' };
          t.review = mgr ? { by: mgr.name, at: fromMs(toMs(dueAt) + 3 * 86_400_000), verdict: 'accepted', note: 'Late: keep to the time next week.' } : null;
        }
      };
      for (const item of pb.items) {
        if (item.every === 'daily') for (const dd of [...weekdays].reverse()) make(item, dd);
        else if (item.every === 'weekly') for (let k = 4; k >= 0; k--) make(item, addDays(thisWeek, -7 * k));
        else {
          make(item, lastMonthDay);
          make(item, today);
        }
      }
      // The work recorded in Prima for each role measure, by profile.
      const factor = p === 'good' ? 1.35 : p === 'average' ? 1.2 : 0.5;
      for (const mz of pb.measures)
        for (let k = 4; k >= 1; k--) {
          const wk = addDays(thisWeek, -7 * k);
          const n = Math.ceil(mz.perWeek * factor * (0.9 + r() * 0.2));
          for (let i = 0; i < n; i++) {
            const at = myt(addDays(wk, Math.floor(r() * 5)), `${String(9 + Math.floor(r() * 8)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`);
            const pre = mz.prefixes[0];
            audits.push({ at, actor: u.name, companyId: companyOf(u), action: pre.endsWith('.') ? `${pre}record` : `${pre}_update` });
          }
        }
    }
    audits.sort((a, b) => a.at.localeCompare(b.at));
    for (const a of audits)
      appendAudit(ds.audit, { ...a, entity: 'mock', entityId: `mock-${toMs(a.at)}`, summary: `${a.actor} recorded work (mock, for the role measures)` });

    // Manager tasks with a definition of done, one asked-for extension, one returned.
    const user = (id: string) => ds.users.find((x) => x.id === id)!;
    const assign = (byId: string, toId: string, title: string, doneMeans: string, dueAt: string, extra: Partial<WorkTask> = {}) => {
      const by = user(byId);
      const to = user(toId);
      if (!by || !to) return;
      const id = `wt-${to.id}-assigned-${ds.workTasks.length}`;
      ds.workTasks.push({
        id,
        userId: to.id,
        userName: to.name,
        companyId: companyOf(to),
        title,
        doneMeans,
        source: 'assigned',
        playbookItemId: null,
        period: null,
        assignedBy: by.name,
        assignedById: by.id,
        createdAt: fromMs(nowMs - 2 * 86_400_000),
        dueAt,
        priority: 'high',
        status: 'open',
        evidence: null,
        late: null,
        review: null,
        planner: { planId: RULES.plannerPreferred.value.planId, taskId: null, state: 'pending', syncedAt: null, plannerChangedAt: null, error: '' },
        ...extra,
      });
    };
    assign('u-it-lead', 'u-it-ex1', 'Prepare the IT tender spec for Inas', 'Spec sheet with 3 supplier options and prices, saved in the Inas tender record.', myt(addDays(today, 1), '17:00'));
    assign('u-cos', 'u-pwvsb-doa', 'Draft the Q4 board meeting pack', 'Agenda, last minutes and 6 papers in one file, sent to the Chief of Staff for checking.', myt(addDays(today, 2), '12:00'));
    assign('u-fin-t1-lead', 'u-fin-t1-de2', 'Redo the September bank reconciliation for Team 1', 'Reconciliation agreed to the bank statement, unmatched items listed with reasons.', fromMs(nowMs - 86_400_000), {
      createdAt: fromMs(nowMs - 6 * 86_400_000),
    });
    assign('u-fin-t1-lead', 'u-fin-t1-de1', 'Key in the Arrow Shield October supplier invoices', 'All 46 invoices keyed in, with the SQL Account numbers written on the batch sheet.', myt(addDays(today, 3), '17:00'), {
      late: { at: fromMs(nowMs - 86_400_000), reason: 'Supplier sent 12 invoices late; waiting for the originals.', newDueAt: myt(addDays(today, 4), '17:00') },
    });
    assign('u-cm-sasa', 'u-bm-sasa-3', 'Survey the new client site at Pasir Gudang', 'Site survey form with posts, hours and photos, sent to the company manager for the quotation.', myt(addDays(today, 3), '17:00'));
    assign('u-cm-arsh', 'u-bm-arsh-2', 'Chase the two unpaid Penang invoices', 'Client reply recorded on each invoice, with a promised date.', fromMs(nowMs - 2 * 86_400_000));

    // Morning check-ins today: most by 10:00, a few late, some not yet.
    if (weekdayOf(today) <= 5)
      for (const u of staff) {
        if (u.role === 'supervisor' || u.opsTier === 'patrol' || playbookFor(u).items.length === 0) continue;
        const p = profile.get(u.id)!;
        if (u.id === 'u-fin-t1-de2' || (p === 'poor' && r() < 0.6) || r() < 0.1) continue;
        const at = myt(today, p === 'average' && r() < 0.3 ? '10:20' : `0${8 + Math.floor(r() * 2)}:${String(10 + Math.floor(r() * 49)).padStart(2, '0')}`);
        if (!past(at)) continue;
        const open = ds.workTasks.filter((t) => t.userId === u.id && (t.status === 'open' || t.status === 'returned')).slice(0, 3);
        ds.workCheckIns.push({
          id: `wc-${u.id}-${today}`,
          userId: u.id,
          userName: u.name,
          companyId: companyOf(u),
          date: today,
          at,
          where: u.branchId ? 'branch' : u.base ? 'office' : 'field',
          hours: '08:30-17:30',
          priorities: open.length ? open.map((t) => t.title) : ['Clear my open work'],
          support: r() < 0.1 ? 'Need the shared folder access fixed' : '',
        });
      }
    for (const id of ['u-it-ex1']) {
      const c = ds.workCheckIns.find((x) => x.id === `wc-${id}-${today}`);
      if (c) c.where = 'home';
    }

    // Help: one waiting past 30 minutes (now with the manager's manager), two answered.
    const help = (uid: string, minsAgo: number, text: string, answer: { by: string; mins: number; text: string } | null) => {
      const u = user(uid);
      const at = fromMs(nowMs - minsAgo * 60_000);
      if (!u || dateOf(at) < addDays(today, -10)) return;
      ds.helpRequests.push({
        id: `help-${u.id}-${toMs(at)}`,
        userId: u.id,
        userName: u.name,
        companyId: companyOf(u),
        at,
        taskId: null,
        text,
        managerId: line(u)?.id ?? null,
        answer: answer ? { by: answer.by, at: fromMs(toMs(at) + answer.mins * 60_000), text: answer.text } : null,
      });
    };
    help('u-fin-t1-de1', 45, 'I cannot find the October bank statement for Team 1 in the shared folder. Who has it?', null);
    help('u-it-ex2', 26 * 60, 'The new laptop image fails at the M365 step. Is there a newer image?', { by: user('u-it-lead').name, mins: 12, text: 'Use image v3 in the IT share; v2 is retired.' });
    help('u-bm-sasa-3', 5 * 24 * 60, 'Client at Kulai wants an extra guard from Monday. Can I promise it?', { by: user('u-cm-sasa').name, mins: 50, text: 'Yes for 2 weeks; send me the request in writing for the contract change.' });

    // One-to-ones: most this week, some overdue, a few never.
    for (const u of staff) {
      const mgr = line(u);
      if (!mgr || playbookFor(u).items.length === 0) continue;
      const x = r();
      if (x > 0.9 || u.id === 'u-fin-t1-de2') continue;
      const ago = x < 0.75 ? 1 + Math.floor(r() * 6) : 9 + Math.floor(r() * 4);
      const date = addDays(today, -ago);
      ds.oneOnOnes.push({
        id: `1to1-${u.id}-${date}`,
        userId: u.id,
        userName: u.name,
        companyId: companyOf(u),
        managerId: mgr.id,
        managerName: mgr.name,
        date,
        notes: 'Went through last week’s tasks and anything stuck. No concerns raised.',
        agreed: ['Keep the daily duties on time', 'Raise blockers the same day'],
      });
    }

    // Far branches: checklists with photo proof, OM, Regional OM and ACT visits, CMS spot checks.
    const proof = (at: string, b: { state: string }) => {
      const [lat, lng] = BRANCH_AT[b.state] ?? [3.1, 101.6];
      return { sha256: sha256Hex(`branch-proof-${at}`), capturedAt: at, receivedAt: at, lat, lng };
    };
    const om = (state: string) => ds.users.find((u) => u.opsTier === 'om' && (u.areaStates ?? []).includes(state)) ?? null;
    const rom = (state: string) => ds.users.find((u) => u.opsTier === 'regional' && (u.regionIds ?? []).some((x) => regionOfState(state)?.id === x)) ?? null;
    const act = ds.users.find((u) => u.id === 'u-act-aud1')!;
    const cms = ds.users.find((u) => u.department === 'cms')!;
    for (const b of ds.branches) {
      const bm = ds.users.find((u) => u.branchId === b.id)!;
      const weak = b.id === 'br-arsh-2';
      const check = (kind: 'daily' | 'weekly' | 'monthly', period: string, at: string) => {
        if (!past(at)) return;
        const items = BRANCH_CHECKS[kind].items.map((it) => {
          const ok = r() > (weak ? 0.25 : 0.06);
          return { key: it.key, label: it.label, ok, note: ok ? '' : 'Raised with the client; follow-up booked.' };
        });
        ds.branchChecks.push({ id: `bc-${b.id}-${kind}-${period}`, branchId: b.id, companyId: b.companyId, kind, period, by: bm.name, at, items, proof: proof(at, b) });
      };
      for (const dd of [...weekdays.slice(0, 10)].reverse()) {
        const x = r();
        if (x < (weak ? 0.35 : 0.04)) continue;
        check('daily', dd, myt(dd, x < (weak ? 0.6 : 0.12) ? '11:15' : `09:${String(10 + Math.floor(r() * 45)).padStart(2, '0')}`));
      }
      if (weekdayOf(today) <= 5 && !weak && r() < 0.8) check('daily', today, myt(today, '09:35'));
      for (let k = 4; k >= 1; k--) {
        const wk = addDays(thisWeek, -7 * k);
        if (weak && k % 2 === 0) continue;
        check('weekly', wk, myt(addDays(wk, 4), '16:30'));
      }
      if (!weak) check('monthly', lastMonthDay.slice(0, 7), myt(`${lastMonthDay.slice(0, 7)}-24`, '15:00'));
      const visit = (kind: 'om' | 'rom' | 'act' | 'spot', by: User | null, daysAgo: number, result: 'ok' | 'issues', findings: string) => {
        if (!by) return;
        const at = myt(addDays(today, -daysAgo), '11:00');
        ds.branchVisits.push({
          id: `bv-${b.id}-${kind}-${toMs(at)}`,
          branchId: b.id,
          companyId: b.companyId,
          kind,
          announced: kind === 'om' || kind === 'rom',
          by: by.name,
          byId: by.id,
          at,
          result,
          findings,
          proof: kind === 'spot' ? null : proof(at, b),
        });
      };
      const o = om(b.state);
      if (o) {
        visit('om', o, 4 + Math.floor(r() * 5), 'ok', 'Visited 3 sites with the branch manager; posts covered, log books up to date.');
        if (r() < 0.7) visit('om', o, 18 + Math.floor(r() * 8), 'ok', 'Checked the branch office files and two sites.');
      }
      if (r() < 0.8 || weak) visit('rom', rom(b.state), 6 + Math.floor(r() * 20), weak ? 'issues' : 'ok', weak ? 'Daily checklists late; two sites without a supervisor at night.' : 'Branch in order.');
      if (r() < 0.4) visit('act', act, 30 + Math.floor(r() * 60), 'ok', 'Unannounced audit: cash book, attendance and armoury checked.');
      if (r() < 0.6 || weak) visit('spot', cms, 2 + Math.floor(r() * 20), weak ? 'issues' : 'ok', weak ? 'Video call at 02:10: guard at Bayan Lepas not at post.' : 'Video call: guards at post, uniform in order.');
    }
  }

  // ----- Company offices (Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8 executives). Mock names only. -----
  // Added last so every earlier generator stays stable. The other 35 companies have no office accounts yet (Unknown).
  const officeExecs: [string, string, string][] = [
    ['u-ae-sasa', 'Farah Nadia binti Kamal', 'co-sasa'],
    ['u-ae-sasa-2', 'Aina Sofea binti Rahim', 'co-sasa'],
    ['u-ae-sasa-3', 'Priya a/p Subramaniam', 'co-sasa'],
    ['u-ae-arsh-2', 'Wong Jia Hui', 'co-arsh'],
    ['u-ae-inas', 'Lim Mei Ling', 'co-inas'],
  ];
  officeExecs.forEach(([id, name, companyId], k) => {
    if (ds.users.some((u) => u.id === id)) return;
    const co = ds.companies.find((c) => c.id === companyId);
    // Every staff sign-in has its own record (Fauzan, 26 Oct 2026): the company employs its office executives.
    const personId = `pr-office-${id.slice(2)}`;
    ds.people.push({
      id: personId,
      companyId,
      branchId: ds.branches.find((b) => b.companyId === companyId)!.id,
      staffNo: `OFC${String(k + 1).padStart(3, '0')}`,
      name,
      nationality: 'MY',
      idMasked: `9${k}0${k + 1}15-**-***${k}`,
      dob: `199${k}-0${k + 1}-15`,
      phone: `012-77${k} 40${k}0`,
      role: 'office',
      status: 'active',
      hiredOn: addDays(today, -(200 + 150 * k)),
      faceEnrolledOn: null,
      basicPay: 3200,
      jobTitle: 'Admin Executive',
    });
    ds.users.push({ id, name, title: `Admin Executive, ${co?.name ?? companyId}`, role: 'admin_exec', companyIds: [companyId], siteIds: [], personId });
  });
  // Pay formulas (Fauzan, 5 Nov 2026): the three standard 12-hour guard formulas and a driver overtime formula, set by
  // the ACT Director for the whole group. Placeholder amounts (minimum wage, no allowances): ACT sets the real ones.
  {
    // From last month, so the guard pay run for last month has formulas in the test data (seed only; a real formula
    // never starts in a past month).
    const month = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const at = myt(addDays(today, -3), '10:00');
    const by = { preparedBy: 'ACT Lead (mock)', preparedById: 'u-audit', preparedAt: at, decidedBy: 'ACT Lead (mock)', decidedById: 'u-audit', decidedAt: at, decisionNote: null };
    const f = (code: string, kind: PayFormula['kind'], name: string, amounts: PayFormula['amounts']): PayFormula => ({
      id: `pf-${code.toLowerCase()}-v1`,
      code,
      version: 1,
      kind,
      name,
      effectiveFrom: month,
      amounts,
      status: 'live',
      reason: 'Standard formula (Fauzan, 5 Nov 2026). Test amounts.',
      ...by,
      lawFlags: payFormulaLawCheck(kind, amounts, month).flags,
    });
    ds.payFormulas.push(
      f('STD-12H-R2', 'guard_shift', '12-hour shift, 2 hours rest, full month', standardGuardAmounts(2)),
      f('STD-12H-R2.5', 'guard_shift', '12-hour shift, 2.5 hours rest, full month', standardGuardAmounts(2.5)),
      f('STD-12H-R3', 'guard_shift', '12-hour shift, 3 hours rest, full month', standardGuardAmounts(3)),
      f('DRV-OT', 'driver_ot', 'Driver overtime', standardDriverAmounts()),
      f('STAFF-OT', 'staff_ot', 'Staff overtime', standardDriverAmounts()),
    );
    const use = (id: string, kind: PayFormula['kind'], scope: PayFormulaUse['scope'], scopeId: string | null, formulaCode: string, reason: string): PayFormulaUse => ({
      id, kind, scope, scopeId, formulaCode, effectiveFrom: month, reason, setBy: 'ACT Lead (mock)', setById: 'u-audit', setAt: at, endedBy: null,
    });
    ds.payFormulaUses.push(use('pfu-group-guard', 'guard_shift', 'group', null, 'STD-12H-R2', 'Group default: 12-hour shift with 2 hours rest.'));
    ds.payFormulaUses.push(use('pfu-group-driver', 'driver_ot', 'group', null, 'DRV-OT', 'Group default for drivers.'));
    ds.payFormulaUses.push(use('pfu-group-staff', 'staff_ot', 'group', null, 'STAFF-OT', 'Group default overtime for all other staff.'));
    const site = ds.sites.find((s) => s.companyId === 'co-sasa');
    if (site) ds.payFormulaUses.push(use('pfu-site-example', 'guard_shift', 'site', site.id, 'STD-12H-R3', 'Example: this site gives 3 hours rest with a relief guard.'));
  }
  // Guard and officer salary accounts for the guard pay run (Fauzan, 5 Nov 2026), masked test numbers on their own
  // random stream. One Sasa guard has none, so HR sees the warning.
  {
    const r = new Rng(MASTER_SEED + 1201);
    const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Bank Islam', 'BSN'];
    ds.people
      .filter((p) => p.role !== 'office')
      .forEach((p, k) => {
        const n = r.int(1000, 9999);
        p.bank = k === 5 ? null : { bank: BANKS[k % BANKS.length], accountMasked: `****${String(n)}` };
        // Fauzan, 6 Nov 2026: an e-wallet, and a relative's account with the guard's written consent (test data).
        if (k === 7) p.bank = { bank: "Touch 'n Go eWallet (test)", accountMasked: `****${String(n)}`, kind: 'ewallet' };
        if (k === 9)
          p.bank = {
            bank: BANKS[0],
            accountMasked: `****${String(n)}`,
            holder: 'relative',
            holderName: 'Test Relative',
            relationship: 'mother',
            consent: {
              docRef: 'CONSENT-TEST-01',
              signedOn: addDays(today, -60),
              oaths: { commissioner: 'Test Commissioner for Oaths', stampRef: 'PS-TEST-0001', stampedOn: addDays(today, -59) },
              recordedBy: 'HR officer (mock)',
              recordedById: 'u-pwvsb-hr',
              recordedAt: myt(addDays(today, -59), '10:00'),
              approved: { by: 'COO (mock)', byId: 'u-coo', at: myt(addDays(today, -58), '10:00'), note: 'Letter stamped and checked (test data).' },
            },
          };
      });
  }


  // Site man-hours (Fauzan, 6 Nov 2026): two Sasa sites with a new guard on on-the-job training alongside the rostered
  // guards (hours with no shift), one of them already approved by the Operations Director. Test data only.
  {
    const month = today.slice(0, 7);
    const co = 'co-sasa';
    const postSites = new Set(ds.posts.filter((p) => p.companyId === co).map((p) => p.siteId));
    const priv = ds.sites.filter((s) => s.companyId === co && s.sector !== 'government' && postSites.has(s.id));
    const trainees = ds.people.filter((p) => p.companyId === co && p.role === 'guard' && p.status === 'active');
    const busy = new Set(ds.shifts.filter((s) => s.companyId === co && s.personId).map((s) => `${s.personId}|${s.date}`));
    const ojt = (site: Site, days: number[], tag: string) => {
      let added = 0;
      for (const off of days) {
        const date = addDays(today, -off);
        if (date.slice(0, 7) !== month) continue;
        const t = trainees.find((p) => !busy.has(`${p.id}|${date}`));
        if (!t) continue;
        busy.add(`${t.id}|${date}`);
        ds.attendance.push({
          id: `at-ojt-${tag}-${date}`,
          companyId: co,
          siteId: site.id,
          shiftId: null,
          personId: t.id,
          deviceId: `DEV-${site.code}`,
          clockIn: myt(date, '07:00'),
          clockOut: myt(date, '19:00'),
          lat: site.lat,
          lng: site.lng,
          distanceM: 0,
          photo: true,
          flags: ['NOT_ROSTERED'],
          locked: true,
        });
        added += 12;
      }
      return added;
    };
    if (priv[1]) ojt(priv[1], [1, 2, 3, 4, 5], 'a');
    if (priv[2]) {
      const h = ojt(priv[2], [1, 2, 3, 4, 5], 'b');
      if (h)
        ds.siteHoursApprovals.push({
          id: `sha-${priv[2].id}-${month}-1`,
          companyId: co,
          siteId: priv[2].id,
          month,
          extraHours: h + 24,
          cause: 'on_job_training',
          reason: 'New guard on on-the-job training alongside the rostered guard for the first week (test data).',
          approvedBy: 'Operations Director (mock)',
          approvedById: 'u-opsdir',
          approverTier: 'ops_director',
          approvedAt: myt(addDays(today, -5), '09:00'),
        });
    }
  }

  // Public holidays (Fauzan, 6 Nov 2026): Sasa's whole-company list for this year, set by the OGM. Test data: the dates
  // that move each year are placeholders, not the gazette.
  {
    const y = Number(today.slice(0, 4));
    const days: [string, string][] = [
      ['01-01', "New Year's Day"],
      ['02-01', 'Federal Territory Day'],
      ['02-17', 'Chinese New Year (test date)'],
      ['02-18', 'Chinese New Year, second day (test date)'],
      ['03-21', 'Hari Raya Aidilfitri (test date)'],
      ['03-22', 'Hari Raya Aidilfitri, second day (test date)'],
      ['05-01', 'Labour Day'],
      ['06-01', "Yang di-Pertuan Agong's birthday (test date)"],
      ['08-31', 'National Day'],
      ['09-16', 'Malaysia Day'],
      ['12-25', 'Christmas Day'],
    ];
    ds.publicHolidayLists.push({
      id: `phl-co-sasa-${y}-all-v1`,
      companyId: 'co-sasa',
      year: y,
      state: null,
      version: 1,
      days: days.map(([md, label]) => ({ date: `${y}-${md}`, label })),
      reason: 'Whole-company list for the year (test data).',
      setBy: 'OGM (mock)',
      setById: 'u-ogm',
      setByTier: 'ogm',
      setAt: myt(`${y - 1}-12-05`, '10:00'),
      replacedBy: null,
      lawFlags: [],
    });
  }

  // One item register (Fauzan, 6 Nov 2026), synthetic only.
  seedItems(ds, today, now);
  // CMS messages to site devices (Fauzan, 6 Nov 2026). A bodycam linked to the
  // Sasa site device (mock bridge); AI on CCTV saw a person at the fence 4 minutes ago and CMS sent the device an alert;
  // a sensor event at another Sasa site is acknowledged and waiting for CMS to decide.
  {
    const dev = ds.users.find((u) => u.id === 'u-dev-sasa-001');
    const site = dev && ds.sites.find((x) => x.id === dev.siteIds[0]);
    const other = ds.sites.find((x) => x.companyId === 'co-sasa' && x.id !== site?.id);
    const nowMs = toMs(now);
    if (site) {
      ds.siteSystems.push({
        id: `sys-${site.id}-bodycam-1`,
        companyId: site.companyId,
        siteId: site.id,
        kind: 'BODYCAM',
        name: 'Bodycam BC-01 (mock)',
        linked: true,
        status: 'online',
        cameras: null,
        camerasOnline: null,
        lastHeartbeatAt: fromMs(nowMs - 60_000),
      });
      const at = nowMs - 4 * 60_000;
      ds.siteAlarms.push({
        id: `alm-ai-${site.id}-seed`,
        companyId: site.companyId,
        siteId: site.id,
        kind: 'AI_CCTV',
        source: 'CCTV analytics: CAM-07 rear fence (mock)',
        at: fromMs(at),
        status: 'acknowledged',
        ackAt: fromMs(at + 40_000),
        ackBy: 'Daniel Wong',
        verdict: null,
        caseId: null,
        note: null,
        detection: { system: 'cctv', device: 'CAM-07 rear fence', label: 'Person climbing fence', confidence: 0.87, verified: false },
      });
      ds.siteDispatches.push({
        id: `dsp-${site.id}-seed-1`,
        ref: 'SASA-M0001',
        companyId: site.companyId,
        siteId: site.id,
        level: 'alert',
        title: 'Check the rear fence',
        message: 'Camera 7 shows a person at the rear fence. Go and check now. Take a photo or video of what you see.',
        proof: 'photo_or_video',
        alarmId: `alm-ai-${site.id}-seed`,
        origin: 'ai_cctv',
        sentBy: 'Daniel Wong',
        sentAt: fromMs(at + 60_000),
        receivedAt: null,
        ack: null,
        photoIds: [],
        videoIds: [],
        reply: null,
        replyAt: null,
        status: 'sent',
        closed: null,
      });
    }
    // The one-stop duty device (Fauzan, 6 Nov 2026): the site vehicle list, two post log lines and a contractor inside.
    if (site) {
      const vehicles: [string, string, 'allowed' | 'watch'][] = [
        ['WXY1234', 'Client manager car', 'allowed'],
        ['BKL8820', 'Clinic supplies lorry', 'allowed'],
        ['VBA3311', 'Reported by client: banned after theft (sample)', 'watch'],
      ];
      vehicles.forEach(([plate, label, status], i) =>
        ds.siteVehicles.push({ id: `veh-${site.id}-${i + 1}`, companyId: site.companyId, siteId: site.id, plate, label, status, source: i === 1 ? 'vehicle_system_mock' : 'company' }),
      );
      const g = ds.people.find((p) => p.companyId === site.companyId && p.status === 'active' && p.staffNo && p.role === 'guard');
      if (g) {
        const line = (mins: number, kind: 'handover' | 'routine', text: string, n: number) =>
          ds.postLogs.push({ id: `pl-${site.id}-seed-${n}`, companyId: site.companyId, siteId: site.id, at: fromMs(toMs(now) - mins * 60_000), personId: g.id, staffNo: g.staffNo!, name: g.name, kind, text, correctsId: null, photoIds: [] });
        line(150, 'handover', 'Took over from night shift. Keys 14 of 14, radio OK, nothing outstanding.', 1);
        line(60, 'routine', 'Round of the car park and rear fence done, all clear.', 2);
        ds.gateEntries.push({
          id: `gate-${site.id}-seed-1`,
          ref: `${site.code}-G0001`,
          companyId: site.companyId,
          siteId: site.id,
          kind: 'visitor',
          inAt: fromMs(toMs(now) - 45 * 60_000),
          receivedAt: fromMs(toMs(now) - 45 * 60_000),
          outAt: null,
          clientRef: 'seed-gate-0001',
          paper: null,
          // A sample has no sealed full ID, so it carries the warning a real entry would show.
          sealed: null,
          inhouse: { status: 'nothing_sealed', at: null },
          visitor: { name: 'Contractor (sample)', idKind: 'mykad', idLast4: '5521', idRead: 'scan', company: 'Sample Aircond Services', host: 'Facility office', purpose: 'Aircond servicing, level 2', faceCheck: 'match' },
          vehicle: { plate: 'BKL8820', plateRead: 'scan', listed: 'allowed' },
          photoIds: [],
          inBy: { personId: g.id, staffNo: g.staffNo!, name: g.name },
          outBy: null,
          flags: ['FULL_ID_NOT_SEALED'],
          keepUntil: `${Number(today.slice(0, 4)) + 7}${today.slice(4)}`,
        });
        // Client needs discussed by the OM and the tasks set from it (Fauzan, 6 Nov 2026).
        const om = ds.users.find((u) => u.id === 'u-om-klang');
        const by = { userId: om?.id ?? 'u-om-klang', name: om?.name ?? 'Operations Manager' };
        const setAt = fromMs(toMs(now) - 3 * 86_400_000);
        ds.siteNeedsReviews.push({
          id: `needs-${site.id}-seed-1`,
          companyId: site.companyId,
          siteId: site.id,
          at: setAt,
          by,
          clientContact: 'Facility manager (sample)',
          answers: {
            'risk.history': { answer: 'Two cable thefts at the back fence in August, at night (sample).', concern: 'high' },
            'systems.physical': { answer: 'Rear fence low near the generator; two lights out at the car park (sample).', concern: 'medium' },
            'guarding.supervision': { answer: 'Client wants an officer check every day and a patrolling officer visit weekly.', concern: 'low' },
          },
          agreed: 'Fence round every night with photo, CCTV check each morning, officer daily check, patrolling officer weekly visit (sample).',
        });
        const t = (n: number, title: string, forRole: 'guard' | 'officer' | 'patrol_officer', days: number[], byTime: string | null, proof: 'none' | 'photo', needTopic: string) =>
          ds.siteTasks.push({
            id: `task-${site.id}-seed-${n}`,
            ref: `${site.code}-T${String(n).padStart(3, '0')}`,
            companyId: site.companyId,
            siteId: site.id,
            title,
            detail: '',
            forRole,
            days,
            onDate: null,
            byTime,
            proof,
            needTopic,
            from: dateOf(setAt),
            until: null,
            status: 'active',
            setBy: by,
            setAt,
            stopped: null,
          });
        const all = [0, 1, 2, 3, 4, 5, 6];
        t(1, 'Check the CCTV screen: all cameras showing and recording', 'guard', all, '09:00', 'photo', 'systems.cctv');
        t(2, 'Walk the rear fence line and photograph any damage', 'guard', all, '22:00', 'photo', 'risk.history');
        t(3, 'Officer site check: guards awake, in uniform, post log written', 'officer', all, null, 'photo', 'guarding.supervision');
        t(4, 'Patrolling officer visit: check the post, the guards and the post log', 'patrol_officer', [weekday(today)], null, 'photo', 'guarding.supervision');
      }
    }
    if (other)
      ds.siteAlarms.push({
        id: `alm-ai-${other.id}-seed`,
        companyId: other.companyId,
        siteId: other.id,
        kind: 'AI_SENSOR',
        source: 'Sensor analytics: PIR store room (mock)',
        at: fromMs(nowMs - 12 * 60_000),
        status: 'acknowledged',
        ackAt: fromMs(nowMs - 11 * 60_000),
        ackBy: 'Daniel Wong',
        verdict: null,
        caseId: null,
        note: null,
        detection: { system: 'sensor', device: 'PIR store room', label: 'Movement after closing', confidence: 0.64, verified: false },
      });
  }

  // Test PINs are kept only as hashes, as real ones are (pin.ts); testers work them out from the staff number.
  for (const p of ds.people) if (p.staffNo) p.pinHash = DEMO_PIN_KEEPER.hash(demoPin(p.staffNo), demoPinSalt(p.id));
  return ds;
}

export type { Company, CompanyLicence, AuthorityGrant };


/**
 * Mock recruitment files for the FWM recruitment steps screen (Fauzan, 6 Nov 2026), added by the browser demo only.
 * Synthetic candidates; the demo papers are not attached, so every step says so in its note.
 */
export function demoFwRecruitFiles(today: IsoDate, now: IsoDateTime): FwRecruitFile[] {
  const by = { by: 'Prakash a/l Raman', byId: 'u-fwm-ex1', at: now };
  const base = {
    companyId: 'co-sasa',
    country: 'NP',
    history: [],
    clearedBy: null,
    clearedById: null,
    clearedAt: null,
    arrivedOn: null,
    personId: null,
    stopReason: null,
    stoppedBy: null,
    stoppedAt: null,
    ...by,
  };
  const note = 'Demo record: no paper attached in mock data.';
  return [
    {
      ...base,
      id: 'fwr-demo-1',
      candidateName: 'Candidate One (mock)',
      passportLast4: '0001',
      agency: 'UAT Recruiting Agency (mock)',
      plannedTravelOn: addDays(today, 30),
      steps: {
        AGENCY_LICENCE: { step: 'AGENCY_LICENCE', on: addDays(today, -6), passed: true, licenceNo: 'UAT-LIC-001', licenceExpiresOn: addDays(today, 200), note, docIds: [], ...by },
        INTERVIEW: { step: 'INTERVIEW', on: addDays(today, -3), passed: true, interviewer: 'Hairul Nizam bin Saad', note, docIds: [], ...by },
      },
      status: 'open',
    },
    {
      ...base,
      id: 'fwr-demo-2',
      candidateName: 'Candidate Two (mock)',
      passportLast4: '0002',
      agency: 'UAT Recruiting Agency (mock)',
      plannedTravelOn: addDays(today, 10),
      steps: {
        AGENCY_LICENCE: { step: 'AGENCY_LICENCE', on: addDays(today, -20), passed: true, licenceNo: 'UAT-LIC-001', licenceExpiresOn: addDays(today, 200), note, docIds: [], ...by },
        EMBASSY: { step: 'EMBASSY', on: addDays(today, -12), passed: true, reference: 'UAT-EMB-0002', note, docIds: [], ...by },
        INTERVIEW: { step: 'INTERVIEW', on: addDays(today, -18), passed: true, interviewer: 'Hairul Nizam bin Saad', note, docIds: [], ...by },
        AGE: { step: 'AGE', on: addDays(today, -18), passed: true, dob: '1998-04-15', age: 28, note, docIds: [], ...by },
        CONTRACT: { step: 'CONTRACT', on: addDays(today, -5), passed: true, languages: ['en', 'ms', 'ne'], note, docIds: [], ...by },
      },
      status: 'open',
    },
  ];
}
