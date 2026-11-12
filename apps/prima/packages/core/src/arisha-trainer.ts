// K9 / N2 (Fauzan, 11 Nov 2026: "Arisha AI inside the app trains the staff"): Arisha teaches staff how to use Prima.
//
// On every screen a staff member can ask "how do I ...?" and get the steps for their own role, from the written screen
// guides (the web app's arisha-screens.data.ts, the only source of steps), and take a short first-time walk-through for
// their role. Arisha only explains: she never saves, approves or sends anything, and she sees the person's role and the
// screen they are on, never their records or anyone else's. Without the AI (switched off until Azure OpenAI is set up,
// Fauzan's go-ahead, D7) the guide steps are shown directly, so it works on day one. In Bahasa Melayu by default.
//
// This file holds the deterministic parts: the role a person trains as, the walk-through for each role, the guard that
// refuses questions about records (another department's above all), and the minimal brief the AI would get.

import type { User } from './types';

export type TrainerLang = 'en' | 'ms' | 'mix';

/** The role a person trains as: decides the walk-through and which department's records are their own. */
export type TrainerRole =
  | 'leadership'
  | 'company'
  | 'site'
  | 'guard'
  | 'hr'
  | 'finance'
  | 'it'
  | 'operations'
  | 'fwm'
  | 'act'
  | 'cms'
  | 'arms'
  | 'procurement'
  | 'transport'
  | 'asset'
  | 'legal'
  | 'pdpa'
  | 'chief_of_staff'
  | 'director_office'
  | 'office';

export const TRAINER_ROLE_LABEL: Record<TrainerRole, { en: string; ms: string }> = {
  leadership: { en: 'Group leadership', ms: 'Kepimpinan kumpulan' },
  company: { en: 'Company office (manager and admin executives)', ms: 'Pejabat syarikat (pengurus dan eksekutif pentadbiran)' },
  site: { en: 'Site and patrol officer', ms: 'Pegawai tapak dan rondaan' },
  guard: { en: 'Guard', ms: 'Pengawal' },
  hr: { en: 'HR', ms: 'HR' },
  finance: { en: 'Finance', ms: 'Kewangan' },
  it: { en: 'IT', ms: 'IT' },
  operations: { en: 'Operations', ms: 'Operasi' },
  fwm: { en: 'Foreign Worker Management', ms: 'Pengurusan Pekerja Asing' },
  act: { en: 'ACT (audit, compliance and transformation)', ms: 'ACT (audit, pematuhan dan transformasi)' },
  cms: { en: 'CMS control room', ms: 'Bilik kawalan CMS' },
  arms: { en: 'Arms Control', ms: 'Kawalan Senjata' },
  procurement: { en: 'Procurement and stores', ms: 'Perolehan dan stor' },
  transport: { en: 'Transport', ms: 'Pengangkutan' },
  asset: { en: 'Asset Management', ms: 'Pengurusan Aset' },
  legal: { en: 'Legal', ms: 'Perundangan' },
  pdpa: { en: 'PDPA office', ms: 'Pejabat PDPA' },
  chief_of_staff: { en: 'Chief of Staff office', ms: 'Pejabat Ketua Staf' },
  director_office: { en: 'Director Office', ms: 'Pejabat Pengarah' },
  office: { en: 'Office staff', ms: 'Kakitangan pejabat' },
};

/** The role a person trains as, from their stored staff record. */
export function trainerRoleOf(u: Pick<User, 'role' | 'department' | 'leadership' | 'opsTier'>): TrainerRole {
  if (u.role === 'guard') return 'guard';
  if (u.role === 'supervisor') return 'site';
  if (u.role === 'company_manager' || u.role === 'admin_exec') return 'company';
  if (u.role === 'director' || u.leadership || u.opsTier === 'ceo' || u.opsTier === 'coo') return 'leadership';
  switch (u.department) {
    case 'hr':
      return 'hr';
    case 'finance':
      return 'finance';
    case 'it':
      return 'it';
    case 'operations':
      return 'operations';
    case 'fwm':
      return 'fwm';
    case 'audit':
      return 'act';
    case 'cms':
      return 'cms';
    case 'arms_control':
      return 'arms';
    case 'procurement':
      return 'procurement';
    case 'transport':
      return 'transport';
    case 'asset':
      return 'asset';
    case 'legal':
      return 'legal';
    case 'pdpa':
      return 'pdpa';
    case 'chief_of_staff':
      return 'chief_of_staff';
    case 'director_office':
      return 'director_office';
    default:
      return 'office';
  }
}

// ---------- The first-time walk-through ----------

/** One line per screen for the walk-through: what this person does there. Static text, no data. */
export const TOUR_SCREEN_TEXT: Record<string, { en: string; ms: string }> = {
  home: { en: 'Your first screen: what needs you today. Press a card to go straight to the work.', ms: 'Skrin pertama anda: apa yang perlu anda buat hari ini. Tekan kad untuk terus ke kerja itu.' },
  mine: { en: 'Your own duty, details and papers.', ms: 'Tugas, butiran dan dokumen anda sendiri.' },
  clock: { en: 'Clock in when you start and clock out when you finish, on your phone.', ms: 'Daftar masuk bila mula kerja dan daftar keluar bila habis, di telefon anda.' },
  work: { en: 'Your tasks for the day: mark each one done, or say why it is late.', ms: 'Tugasan anda hari ini: tandakan setiap satu selesai, atau nyatakan sebab lewat.' },
  claims: { en: 'Send your claims with the receipt; follow them until they are paid.', ms: 'Hantar tuntutan anda bersama resit; ikuti sehingga dibayar.' },
  memos: { en: 'Notices from management: read them and confirm you have read them.', ms: 'Notis daripada pengurusan: baca dan sahkan anda sudah membacanya.' },
  meetings: { en: 'Meetings you are invited to, their minutes and your action points.', ms: 'Mesyuarat yang anda dijemput, minitnya dan tindakan anda.' },
  grc: { en: 'Speak up safely about a problem; your report is kept confidential.', ms: 'Laporkan masalah dengan selamat; laporan anda dirahsiakan.' },
  items: { en: 'Items and equipment you hold: scan to receive, return or report.', ms: 'Barang dan peralatan yang anda pegang: imbas untuk terima, pulangkan atau lapor.' },
  cases: { en: 'Report an incident at a site and follow it to closing, with proof.', ms: 'Laporkan insiden di tapak dan ikuti sehingga ditutup, dengan bukti.' },
  hr: { en: 'HR across the group: staff, leave, cases and hiring.', ms: 'HR seluruh kumpulan: kakitangan, cuti, kes dan pengambilan.' },
  'staff-directory': { en: 'The office staff list and their mailboxes; HR loads it, the HR Director approves it.', ms: 'Senarai kakitangan pejabat dan peti mel mereka; HR memuatkannya, Pengarah HR meluluskannya.' },
  'bulk-load': { en: 'Load a spreadsheet or many files at once; Prima proposes where each goes and you confirm.', ms: 'Muatkan hamparan atau banyak fail sekali gus; Prima mencadangkan ke mana setiap satu pergi dan anda mengesahkan.' },
  staffclock: { en: 'Office staff clock-in times and photos to look at.', ms: 'Masa daftar masuk kakitangan pejabat dan foto untuk disemak.' },
  people: { en: 'Guards and officers: their details, papers and history.', ms: 'Pengawal dan pegawai: butiran, dokumen dan sejarah mereka.' },
  staffpay: { en: 'Office staff payroll: prepare, check and approve each month.', ms: 'Gaji kakitangan pejabat: sedia, semak dan lulus setiap bulan.' },
  finance: { en: 'Finance work: payments, bank, ledger and month-end.', ms: 'Kerja kewangan: bayaran, bank, lejar dan akhir bulan.' },
  payreq: { en: 'Payment requests waiting for you.', ms: 'Permohonan bayaran yang menunggu anda.' },
  credit: { en: 'PWVSB credit to the companies and its repayments.', ms: 'Kredit PWVSB kepada syarikat dan bayaran baliknya.' },
  guardpay: { en: 'Guard pay runs (trial only).', ms: 'Larian gaji pengawal (percubaan sahaja).' },
  it: { en: 'IT requests and jobs: pick one up, fix it, record what you did.', ms: 'Permintaan dan kerja IT: ambil satu, baiki, rekod apa yang dibuat.' },
  'hr-it-intake': { en: 'Staff joining, moving or leaving: their accounts and devices.', ms: 'Kakitangan masuk, bertukar atau berhenti: akaun dan peranti mereka.' },
  'it-procurement': { en: 'IT purchases from request to delivery.', ms: 'Pembelian IT dari permintaan hingga penghantaran.' },
  connections: { en: 'Your Microsoft 365 connections.', ms: 'Sambungan Microsoft 365 anda.' },
  websites: { en: 'The group websites and their checks.', ms: 'Laman web kumpulan dan semakannya.' },
  ops: { en: 'Your region at a glance: sites, guards and open matters.', ms: 'Wilayah anda sepintas lalu: tapak, pengawal dan perkara terbuka.' },
  sites: { en: 'Sites, their posts and their client.', ms: 'Tapak, pos dan pelanggannya.' },
  roster: { en: 'Who works where and when; publish the roster.', ms: 'Siapa bertugas di mana dan bila; terbitkan jadual.' },
  attendance: { en: 'Who came to work, who did not, and the follow-up.', ms: 'Siapa hadir, siapa tidak, dan tindakan susulan.' },
  fwm: { en: 'Foreign workers: permits, passports and their renewal tasks.', ms: 'Pekerja asing: permit, pasport dan tugasan pembaharuannya.' },
  hostels: { en: 'Hostels, their bills and utility charges.', ms: 'Asrama, bilnya dan caj utiliti.' },
  fwcost: { en: 'Foreign worker costs charged to the companies.', ms: 'Kos pekerja asing yang dicaj kepada syarikat.' },
  arrivalcash: { en: 'Cash given to workers on arrival.', ms: 'Wang tunai yang diberi kepada pekerja semasa tiba.' },
  act: { en: 'ACT work: findings, audits and investigations.', ms: 'Kerja ACT: penemuan, audit dan siasatan.' },
  audit: { en: 'The audit trail: who changed what and when.', ms: 'Jejak audit: siapa ubah apa dan bila.' },
  selfaudit: { en: 'The yearly self-audit of each company.', ms: 'Audit kendiri tahunan setiap syarikat.' },
  cms: { en: 'The control room: alarms, dispatch and call-backs.', ms: 'Bilik kawalan: penggera, penghantaran dan panggilan semula.' },
  cmsready: { en: 'CMS readiness of each site.', ms: 'Kesediaan CMS setiap tapak.' },
  arms: { en: 'Firearms: issue, return and the vault count.', ms: 'Senjata api: keluar, pulang dan kiraan bilik kebal.' },
  purchasing: { en: 'Purchase requests, quotations and suppliers.', ms: 'Permohonan pembelian, sebut harga dan pembekal.' },
  sitestock: { en: 'Stock and fittings kept at sites.', ms: 'Stok dan kelengkapan yang disimpan di tapak.' },
  fleet: { en: 'Vehicles: requests, fuel and service.', ms: 'Kenderaan: permohonan, minyak dan servis.' },
  assets: { en: 'Assets, rentals and their payments.', ms: 'Aset, sewaan dan bayarannya.' },
  governance: { en: 'Mandates and board approvals.', ms: 'Mandat dan kelulusan lembaga.' },
  corporate: { en: 'Company secretary filings.', ms: 'Pemfailan setiausaha syarikat.' },
  pdpa: { en: 'Personal data requests and cases.', ms: 'Permintaan dan kes data peribadi.' },
  requests: { en: 'Requests waiting for your decision.', ms: 'Permohonan yang menunggu keputusan anda.' },
  doa: { en: "The Director Office's letters, approvals and follow-ups.", ms: 'Surat, kelulusan dan tindakan susulan Pejabat Pengarah.' },
  commercial: { en: 'Tenders and quotations.', ms: 'Tender dan sebut harga.' },
  company: { en: "Your company's day: sites, guards and open matters.", ms: 'Hari syarikat anda: tapak, pengawal dan perkara terbuka.' },
  office: { en: 'Company office work shared out to the executives.', ms: 'Kerja pejabat syarikat yang diagihkan kepada eksekutif.' },
  overview: { en: 'Every company in the group at a glance.', ms: 'Semua syarikat dalam kumpulan sepintas lalu.' },
  reports: { en: 'Monthly and summary reports.', ms: 'Laporan bulanan dan ringkasan.' },
};

/** The screens each role's walk-through visits, in order; only those in the person's own menu are shown. */
export const TRAINER_TOURS: Record<TrainerRole, string[]> = {
  leadership: ['home', 'overview', 'requests', 'reports', 'meetings'],
  company: ['home', 'company', 'office', 'people', 'cases', 'claims'],
  site: ['home', 'mine', 'clock', 'cases', 'items', 'grc'],
  guard: ['mine', 'items', 'memos', 'grc'],
  hr: ['hr', 'staff-directory', 'bulk-load', 'staffclock', 'claims', 'clock'],
  finance: ['finance', 'payreq', 'staffpay', 'credit', 'clock'],
  it: ['it', 'hr-it-intake', 'it-procurement', 'connections', 'clock'],
  operations: ['ops', 'sites', 'roster', 'attendance', 'cases', 'clock'],
  fwm: ['fwm', 'hostels', 'fwcost', 'bulk-load', 'clock'],
  act: ['act', 'audit', 'selfaudit', 'grc', 'clock'],
  cms: ['cms', 'cmsready', 'arms', 'clock'],
  arms: ['arms', 'cms', 'cases', 'clock'],
  procurement: ['purchasing', 'items', 'sitestock', 'clock'],
  transport: ['fleet', 'clock', 'meetings'],
  asset: ['assets', 'clock', 'meetings'],
  legal: ['credit', 'governance', 'corporate', 'clock'],
  pdpa: ['pdpa', 'clock', 'meetings'],
  chief_of_staff: ['requests', 'claims', 'staffpay', 'clock'],
  director_office: ['doa', 'commercial', 'clock'],
  office: ['clock', 'work', 'claims', 'memos', 'meetings'],
};

export interface TourStep {
  /** The screen to open, or null for the opening and closing words. */
  view: string | null;
  text: string;
}

/** The walk-through for a role, in the person's language, limited to the screens in their own menu. */
export function trainerTour(role: TrainerRole, menuViews: string[], lang: TrainerLang): TourStep[] {
  const ms = lang !== 'en';
  const mine = new Set(menuViews);
  const label = TRAINER_ROLE_LABEL[role][ms ? 'ms' : 'en'];
  const steps: TourStep[] = [
    {
      view: null,
      text: ms
        ? `Selamat datang. Saya Arisha. Saya tunjukkan skrin utama untuk peranan anda (${label}). Saya hanya menerangkan: saya tidak menyimpan, meluluskan atau menghantar apa-apa untuk anda.`
        : `Welcome. I am Arisha. I will show you the main screens for your role (${label}). I only explain: I never save, approve or send anything for you.`,
    },
  ];
  for (const v of TRAINER_TOURS[role]) if (mine.has(v) && TOUR_SCREEN_TEXT[v]) steps.push({ view: v, text: TOUR_SCREEN_TEXT[v][ms ? 'ms' : 'en'] });
  steps.push({
    view: null,
    text: ms
      ? 'Itu sahaja. Bila-bila masa, tekan butang bantuan dan tanya saya "Bagaimana saya...?" pada mana-mana skrin. Saya beri langkah untuk peranan anda.'
      : 'That is all. Any time, press the help button and ask me "How do I...?" on any screen. I give you the steps for your role.',
  });
  return steps;
}

// ---------- What Arisha refuses ----------

/** Departments as people name them, English and Malay. */
const DEPT_WORDS: Record<string, string[]> = {
  hr: ['hr', 'sumber manusia', 'human resource', 'human resources'],
  finance: ['finance', 'kewangan', 'akaun', 'accounts', 'account department'],
  it: ['it department', 'jabatan it', 'unit it', 'it team', 'pasukan it'],
  operations: ['operations', 'operasi', 'ops'],
  fwm: ['fwm', 'pekerja asing', 'foreign worker', 'foreign workers'],
  act: ['act', 'audit', 'audit dalaman', 'internal audit'],
  cms: ['cms', 'control room', 'bilik kawalan'],
  arms: ['arms control', 'kawalan senjata'],
  procurement: ['procurement', 'perolehan', 'stor', 'store'],
  transport: ['transport', 'pengangkutan'],
  asset: ['asset management', 'pengurusan aset'],
  legal: ['legal', 'perundangan', 'undang-undang'],
  pdpa: ['pdpa'],
  chief_of_staff: ['chief of staff', 'ketua staf'],
  director_office: ['director office', 'pejabat pengarah'],
};
/** Words that ask about records rather than how to use a screen. */
const RECORD_WORDS =
  /\b(records?|rekod|data|details|butiran|maklumat|salary|salaries|gaji|payslips?|slip gaji|ic|mykad|kad pengenalan|address|alamat|phone numbers?|nombor telefon|files?|fail|profiles?|profil|leave|cuti|claims?|tuntutan|payments?|bayaran|accounts?|akaun|cases?|kes|list of|senarai|bank)\b/;
/** A question that asks for data itself (show me, how much, whose), not for the steps. */
const DATA_ASK =
  /^(please |tolong |sila )?(show|tunjuk|tunjukkan|list|senaraikan|give|beri|bagi|send|hantar|tell me|beritahu|what is|what are|apakah|berapa|siapa|who|which|mana satu|cari|find|open|buka|read|baca)\b|\b('s|milik|kepunyaan|punya)\b/;
const HOW = /\b(how|macam mana|mcm mana|camana|bagaimana|cara|where do i|di mana saya|langkah|steps?)\b/;
/** Asking Arisha to act: she never does, she gives the steps. */
const ACT_ASK = /\b(approve|luluskan|lulus kan|save|simpan|submit|hantar|send|delete|padam|pay|bayar|change|ubah|tukar)\b.*\b(for me|untuk saya|for us|untuk kami)\b|^(please |tolong |sila )?(approve|luluskan|submit|padam|delete)\b/;

export interface TrainerRefusal {
  kind: 'other_department' | 'records' | 'action';
  text: string;
}

const lower = (s: string) => ` ${String(s ?? '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The department a question names, other than the person's own (null if none, or only their own). */
export function otherDepartment(question: string, role: TrainerRole): string | null {
  const q = lower(question);
  for (const [dept, words] of Object.entries(DEPT_WORDS)) {
    if (dept === role) continue;
    if (words.some((w) => q.includes(` ${w} `) || q.includes(` ${w}'s `))) return dept;
  }
  return null;
}

/**
 * Whether Arisha refuses a question, and what she says. She teaches how to use the person's own screens. She refuses
 * (1) anything about another department's records, (2) a request for records themselves ("show me Ali's leave",
 * "what is the salary of ..."); and (3) she never does the work: a request to approve, save or send for the person gets
 * the steps instead, with that said first. Deterministic, in the person's language; the server checks it again.
 */
export function trainerRefusal(question: string, role: TrainerRole, lang: TrainerLang): TrainerRefusal | null {
  const q = lower(question);
  const ms = lang !== 'en';
  const records = RECORD_WORDS.test(q);
  const other = otherDepartment(question, role);
  if (other && records && role !== 'leadership') {
    const name = TRAINER_ROLE_LABEL[other as TrainerRole]?.[ms ? 'ms' : 'en'] ?? other;
    return {
      kind: 'other_department',
      text: ms
        ? `Maaf, saya tidak boleh membantu dengan rekod ${name}. Saya hanya mengajar cara menggunakan skrin untuk peranan anda sendiri, dan saya tidak melihat rekod sesiapa. Untuk rekod ${name}, hubungi jabatan itu.`
        : `Sorry, I cannot help with ${name}'s records. I only teach how to use the screens for your own role, and I do not see anyone's records. For ${name}'s records, ask that department.`,
    };
  }
  if (records && DATA_ASK.test(q.trim()) && !HOW.test(q)) {
    return {
      kind: 'records',
      text: ms
        ? 'Saya tidak melihat atau memberi rekod. Saya hanya menerangkan langkah. Tanya saya "Bagaimana saya ...?" dan saya tunjukkan skrin yang perlu dibuka.'
        : 'I do not see or give out records. I only explain the steps. Ask me "How do I ...?" and I will show you the screen to open.',
    };
  }
  if (ACT_ASK.test(q.trim()))
    return {
      kind: 'action',
      text: ms
        ? 'Saya tidak boleh menekan butang untuk anda: saya tidak menyimpan, meluluskan atau menghantar apa-apa. Ini langkahnya untuk anda buat sendiri:'
        : 'I cannot press buttons for you: I never save, approve or send anything. Here are the steps to do it yourself:',
    };
  return null;
}

// ---------- The AI part (switched off) ----------

/** The most the trainer's brief may hold; POST /arisha takes at most 20,000 characters. */
export const TRAINER_BRIEF_MAX = 19_000;

/** IC numbers, phone numbers, emails and long numbers in a typed question, masked before anything leaves the device. */
export function maskQuestion(q: string): string {
  return String(q ?? '')
    .slice(0, 600)
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\d{6}-?\d{2}-?\d{4}/g, '[IC]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]');
}

/**
 * What the AI gets for a trainer question: the role (never the person), the open screen's guide text (static), the
 * question with numbers masked, and the rules. No tools, no records, no names. Under the 20,000-character limit.
 */
export function trainerBrief(input: { role: TrainerRole; screen: string; guide: string; question: string; lang: TrainerLang }): { history: []; brief: string; tools: null } {
  const ms = input.lang !== 'en';
  const head = [
    'You are Arisha, the guide inside Prima Secure. You teach staff how to use Prima for their own role, in short numbered steps that name the exact buttons.',
    'You only explain. You never save, approve, send or change anything, and you never claim to. You see only the role and the screen below, never records.',
    "Refuse anything about another department's records, or any request for records themselves; say what screen to open instead.",
    'Explain only from the guide below. If it does not cover the question, say so and suggest asking their manager.',
    ms ? 'Answer in Bahasa Melayu, plain words.' : 'Answer in English, plain words.',
    `Role: ${TRAINER_ROLE_LABEL[input.role].en}.`,
    `Screen open now: ${String(input.screen ?? '').slice(0, 80)}.`,
    `Question: ${maskQuestion(input.question)}`,
    'GUIDE:',
  ].join('\n');
  const room = TRAINER_BRIEF_MAX - head.length - 2;
  const brief = `${head}\n${String(input.guide ?? '').slice(0, Math.max(0, room))}`;
  return { history: [], brief, tools: null };
}
