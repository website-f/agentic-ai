import { assetRole, isGroupLeader, pdpaRole } from './access';
import { hrKeeps } from './hr';
import { RULES } from './rules';
import { keyInValuesIn } from './key-in';
import type { Id, IsoDate, User } from './types';

/**
 * Prima agent, "Pembantu" (Fauzan, 23 Nov 2026: "Make sure ai agent can help with everything. Like start new inventory
 * request when ogm instructed. What prima app give permission for the person or department can do, agent can help it
 * do. Make sure we have skill library so agent remember. Make sure library also store personalized style of each
 * staff").
 *
 * The agent turns an instruction into a filled form for one of the actions below, as the person and with no more rights
 * than the person: the form is sent through the same server action the screen uses, and the server checks it exactly
 * as if the person had filled it. The person always presses Send. The agent never approves, signs, pays, disciplines or
 * decides; those steps stay on their own screens, with the person's reason (approval-reasons rule).
 *
 * System first (Fauzan, 23 Nov 2026: "Use system more than ai"): the action, dates, times, amounts, sites, store items
 * and people are found by fixed rules against Prima's own lists, the team's skills and the person's own style. The
 * online reader is only a later step for what the rules missed (kind 'assistant' in AI_AGENT_KINDS, USD 25 cap).
 */

export type AssistantFieldType = 'text' | 'longtext' | 'date' | 'time' | 'month' | 'number' | 'choice' | 'site' | 'items' | 'receiver' | 'bool' | 'pick' | 'proof';

export interface AssistantField {
  name: string;
  type: AssistantFieldType;
  label: { bm: string; en: string };
  required?: boolean;
  /** For 'choice': each option and the words that pick it. */
  options?: { value: string; label: string; words: string[] }[];
  /** For a date pair: 'first' takes the first date said, 'last' the last one (a leave from/to). */
  pick?: 'first' | 'last';
  /** Filled from the whole instruction when nothing better is found (a reason, a title). */
  fromText?: boolean;
  /** For 'pick': the Prima list it picks from, read as the person (companies, staff, client accounts...). */
  list?: string;
  /** For 'number': what the number is, so the right one is read ("RM 250", "3 orang", "40 liter", "52000 km"). */
  unit?: 'hours' | 'rm' | 'count' | 'litres' | 'km';
  /** For 'text': a pattern read from the words (a staff number, a phone number). */
  pattern?: 'staffNo' | 'phone';
  /** For 'date': a date already passed (a receipt, a payment received); "22/11" is then this year's, not next year's. */
  past?: boolean;
  /** For 'proof': documents only (no camera photo). */
  documentsOnly?: boolean;
  /** The person's usual value is offered next time (a company, a kind). Dates, people and amounts never are. */
  keep?: boolean;
  /** Not always needed, but when the list has just one entry it is suggested (the vehicle's only card of that kind). */
  single?: boolean;
}

export interface AssistantAction {
  id: string;
  label: { bm: string; en: string };
  /** Words that mean this action, Malay and English, lower case. */
  words: string[];
  fields: AssistantField[];
  /** The screen where the full form lives, for anything the agent's form does not cover. */
  view: string;
  /** Who sees it in the agent. Only a guide: the server decides when the person sends. */
  may: (u: User) => boolean;
}

const staff = (u: User) => !u.integration && u.role !== 'site_device' && u.role !== 'guard';
const office = (u: User) => staff(u) && (u.role === 'pwvsb_officer' || u.role === 'company_manager' || u.role === 'admin_exec' || u.role === 'director' || u.role === 'supervisor');
const opsOrStore = (u: User) =>
  staff(u) && (['om', 'regional', 'ogm', 'ops_director', 'coo'].includes(u.opsTier ?? '') || u.procRole === 'manager' || u.procRole === 'executive' || isGroupLeader(u));

const TODAY_WORDS: Record<string, number> = { 'hari ini': 0, today: 0, esok: 1, tomorrow: 1, lusa: 2, 'day after tomorrow': 2, semalam: -1, yesterday: -1, kelmarin: -2 };

export const ASSISTANT_ACTIONS: AssistantAction[] = [
  {
    id: 'site-supplies',
    label: { bm: 'Permohonan Pesanan Barang (bekalan tapak)', en: 'Site supplies request' },
    words: ['pesanan barang', 'bekalan', 'minta barang', 'perlukan barang', 'barang untuk tapak', 'inventori', 'inventory', 'stok', 'stock', 'uniform', 'seragam', 'baju', 'seluar', 'kasut', 'tali pinggang', 'lencana', 'supplies', 'supply request', 'item request', 'items for'],
    fields: [
      { name: 'siteId', type: 'site', label: { bm: 'Tapak', en: 'Site' }, required: true },
      { name: 'lines', type: 'items', label: { bm: 'Barang dan kuantiti', en: 'Items and quantity' }, required: true },
      { name: 'receiverUserId', type: 'receiver', label: { bm: 'OM yang menerima di tapak', en: 'OM who receives at the site' } },
      { name: 'forNewSite', type: 'bool', label: { bm: 'Untuk tapak baharu', en: 'For a new site' } },
      { name: 'notes', type: 'longtext', label: { bm: 'Catatan', en: 'Notes' }, fromText: true },
    ],
    view: 'purchasing',
    may: opsOrStore,
  },
  {
    id: 'leave',
    label: { bm: 'Mohon cuti', en: 'Apply for leave' },
    words: ['cuti', 'leave', 'bercuti', 'off day', 'mc', 'sakit', 'kecemasan'],
    fields: [
      {
        name: 'kind', type: 'choice', label: { bm: 'Jenis cuti', en: 'Kind of leave' }, required: true,
        options: [
          { value: 'ANNUAL', label: 'Cuti tahunan', words: ['tahunan', 'annual', 'cuti rehat'] },
          { value: 'SICK', label: 'Cuti sakit', words: ['sakit', 'sick', 'mc'] },
          { value: 'EMERGENCY', label: 'Cuti kecemasan', words: ['kecemasan', 'emergency'] },
          { value: 'UNPAID', label: 'Cuti tanpa gaji', words: ['tanpa gaji', 'unpaid'] },
        ],
      },
      { name: 'from', type: 'date', label: { bm: 'Dari', en: 'From' }, required: true, pick: 'first' },
      { name: 'to', type: 'date', label: { bm: 'Hingga', en: 'To' }, required: true, pick: 'last' },
      { name: 'illness', type: 'text', label: { bm: 'Penyakit seperti dalam MC', en: 'Illness as on the MC' } },
      { name: 'clinic', type: 'text', label: { bm: 'Klinik / hospital', en: 'Clinic or hospital' } },
      { name: 'mcNo', type: 'text', label: { bm: 'No. siri MC (cuti sakit)', en: 'MC serial number (sick leave)' } },
      { name: 'proof', type: 'proof', label: { bm: 'MC / surat hospital (wajib untuk cuti sakit)', en: 'MC or hospital letter (needed for sick leave)' } },
      { name: 'reason', type: 'longtext', label: { bm: 'Sebab', en: 'Reason' }, required: true, fromText: true },
    ],
    view: 'mine',
    may: staff,
  },
  {
    id: 'it-help',
    label: { bm: 'Minta bantuan IT', en: 'Ask IT for help' },
    words: ['it', 'komputer', 'computer', 'laptop', 'printer', 'pencetak', 'internet', 'wifi', 'e-mel', 'email', 'outlook', 'teams', 'kata laluan', 'password', 'akaun', 'account', 'rosak', 'broken', 'tidak boleh log masuk', 'cannot log in'],
    fields: [
      {
        name: 'category', type: 'choice', label: { bm: 'Tentang', en: 'About' }, required: true,
        options: [
          { value: 'ACCOUNT', label: 'Akaun / kata laluan', words: ['kata laluan', 'password', 'akaun', 'account', 'log masuk', 'login', 'log in'] },
          { value: 'DEVICE', label: 'Peranti', words: ['laptop', 'komputer', 'computer', 'printer', 'pencetak', 'telefon', 'phone', 'skrin', 'screen'] },
          { value: 'EMAIL', label: 'E-mel', words: ['e-mel', 'email', 'outlook'] },
          { value: 'M365', label: 'Microsoft 365', words: ['teams', 'sharepoint', 'onedrive', 'word', 'excel', 'microsoft', 'm365', 'authenticator', 'mfa'] },
          { value: 'NETWORK', label: 'Rangkaian', words: ['internet', 'wifi', 'rangkaian', 'network'] },
          { value: 'PRIMA', label: 'Prima', words: ['prima'] },
          { value: 'OTHER', label: 'Lain-lain', words: [] },
        ],
      },
      {
        name: 'priority', type: 'choice', label: { bm: 'Segera', en: 'How urgent' }, required: true,
        options: [
          { value: 'P1', label: 'Kerja terhenti', words: ['terhenti', 'semua tidak boleh', 'urgent sekarang', 'down'] },
          { value: 'P2', label: 'Segera', words: ['segera', 'urgent', 'cepat'] },
          { value: 'P3', label: 'Biasa', words: [] },
          { value: 'P4', label: 'Bila sempat', words: ['bila sempat', 'tidak segera', 'when free'] },
        ],
      },
      { name: 'title', type: 'text', label: { bm: 'Apa yang rosak', en: 'What is wrong' }, required: true, fromText: true },
      { name: 'detail', type: 'longtext', label: { bm: 'Butiran', en: 'Details' }, fromText: true },
    ],
    view: 'it',
    may: staff,
  },
  {
    id: 'problem',
    label: { bm: 'Lapor masalah Prima', en: 'Report a problem with Prima' },
    words: ['lapor masalah', 'report a problem', 'prima tidak', 'prima error', 'skrin prima', 'bug', 'ralat'],
    fields: [{ name: 'what', type: 'longtext', label: { bm: 'Apa yang berlaku', en: 'What happened' }, required: true, fromText: true }],
    view: 'home',
    may: staff,
  },
  {
    id: 'time-slip',
    label: { bm: 'Slip masa (keluar sekejap)', en: 'Time slip' },
    words: ['slip masa', 'time slip', 'keluar sekejap', 'keluar pejabat', 'urusan peribadi', 'balik awal', 'datang lewat'],
    fields: [
      { name: 'date', type: 'date', label: { bm: 'Tarikh', en: 'Date' }, required: true, pick: 'first' },
      { name: 'from', type: 'time', label: { bm: 'Dari', en: 'From' }, required: true, pick: 'first' },
      { name: 'to', type: 'time', label: { bm: 'Hingga', en: 'To' }, required: true, pick: 'last' },
      { name: 'reason', type: 'longtext', label: { bm: 'Sebab', en: 'Reason' }, required: true, fromText: true },
    ],
    view: 'mine',
    may: office,
  },
  {
    id: 'ot-claim',
    label: { bm: 'Tuntutan kerja lebih masa', en: 'Overtime claim' },
    words: ['lebih masa', 'overtime', 'ot', 'kerja lebih'],
    fields: [
      { name: 'date', type: 'date', label: { bm: 'Tarikh', en: 'Date' }, required: true, pick: 'first' },
      { name: 'hours', type: 'number', label: { bm: 'Jam', en: 'Hours' }, required: true },
      {
        name: 'kind', type: 'choice', label: { bm: 'Hari', en: 'Day' }, required: true,
        options: [
          { value: 'normal', label: 'Hari biasa', words: [] },
          { value: 'restDay', label: 'Hari rehat', words: ['hari rehat', 'rest day', 'sabtu', 'ahad', 'saturday', 'sunday'] },
          { value: 'publicHoliday', label: 'Cuti umum', words: ['cuti umum', 'public holiday', 'hari raya', 'deepavali', 'krismas', 'christmas'] },
        ],
      },
      { name: 'reason', type: 'longtext', label: { bm: 'Kerja yang dibuat', en: 'Work done' }, required: true, fromText: true },
    ],
    view: 'mine',
    may: office,
  },
  {
    id: 'meeting',
    label: { bm: 'Atur mesyuarat', en: 'Set up a meeting' },
    words: ['mesyuarat', 'meeting', 'jumpa', 'perbincangan', 'taklimat', 'briefing'],
    fields: [
      { name: 'title', type: 'text', label: { bm: 'Tajuk', en: 'Title' }, required: true, fromText: true },
      { name: 'date', type: 'date', label: { bm: 'Tarikh', en: 'Date' }, required: true, pick: 'first' },
      { name: 'start', type: 'time', label: { bm: 'Mula', en: 'Starts' }, required: true, pick: 'first' },
      { name: 'end', type: 'time', label: { bm: 'Tamat', en: 'Ends' }, pick: 'last' },
      { name: 'location', type: 'text', label: { bm: 'Tempat', en: 'Where' } },
      { name: 'attendees', type: 'text', label: { bm: 'Yang hadir', en: 'Who attends' } },
      { name: 'agenda', type: 'longtext', label: { bm: 'Agenda', en: 'Agenda' }, fromText: true },
    ],
    view: 'meetings',
    may: office,
  },
  {
    id: 'help-ask',
    label: { bm: 'Minta tolong daripada pengurus', en: 'Ask my manager for help' },
    words: ['minta tolong', 'perlukan bantuan', 'need help', 'stuck', 'tersekat', 'tidak tahu cara'],
    fields: [{ name: 'text', type: 'longtext', label: { bm: 'Apa yang perlu dibantu', en: 'What you need help with' }, required: true, fromText: true }],
    view: 'work',
    may: office,
  },
  {
    id: 'my-task',
    label: { bm: 'Tambah tugas saya', en: 'Add a task for myself' },
    words: ['ingatkan saya', 'remind me', 'tugas saya', 'my task', 'kena buat', 'to do', 'todo'],
    fields: [
      { name: 'title', type: 'text', label: { bm: 'Tugas', en: 'Task' }, required: true, fromText: true },
      { name: 'date', type: 'date', label: { bm: 'Siap sebelum', en: 'Due' }, required: true, pick: 'last' },
      { name: 'time', type: 'time', label: { bm: 'Masa', en: 'Time' }, pick: 'last' },
    ],
    view: 'work',
    may: office,
  },
  // ---------- department jobs (Fauzan, 23 Nov 2026: "See from company wide, what helper can help each staff" then "Build") ----------
  {
    id: 'staff-claim',
    label: { bm: 'Tuntutan perubatan / optik / pemeriksaan', en: 'Medical, dental, optical or check-up claim' },
    words: ['tuntutan', 'tuntut', 'claim', 'klinik', 'clinic', 'doktor', 'doctor', 'gigi', 'dental', 'optik', 'optical', 'cermin mata', 'spectacles', 'pemeriksaan kesihatan', 'medical check'],
    fields: [
      { name: 'kind', type: 'choice', label: { bm: 'Jenis', en: 'Kind' }, required: true, options: [
        { value: 'MEDICAL', label: 'Perubatan', words: ['klinik', 'clinic', 'doktor', 'doctor', 'ubat', 'medical', 'perubatan'] },
        { value: 'DENTAL', label: 'Gigi', words: ['gigi', 'dental', 'dentist'] },
        { value: 'OPTICAL', label: 'Optik', words: ['optik', 'optical', 'cermin mata', 'spectacles', 'kanta'] },
        { value: 'CHECKUP', label: 'Pemeriksaan kesihatan', words: ['pemeriksaan kesihatan', 'medical check', 'check-up', 'checkup'] },
      ] },
      { name: 'date', type: 'date', past: true, label: { bm: 'Tarikh resit', en: 'Receipt date' }, required: true, pick: 'first' },
      { name: 'amount', type: 'number', unit: 'rm', label: { bm: 'Jumlah (RM)', en: 'Amount (RM)' }, required: true },
      { name: 'note', type: 'longtext', label: { bm: 'Catatan', en: 'Note' }, fromText: true },
      { name: 'proof', type: 'proof', documentsOnly: true, label: { bm: 'Resit', en: 'Receipt' }, required: true },
    ],
    view: 'claims',
    may: (u) => office(u) && !!u.personId,
  },
  {
    id: 'office-request',
    label: { bm: 'Permohonan keperluan pejabat', en: 'Office needs request' },
    words: ['keperluan pejabat', 'office supplies', 'alat tulis', 'stationery', 'bil elektrik', 'bil air', 'utiliti', 'utilities', 'sewa pejabat', 'office rent'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'category', type: 'choice', label: { bm: 'Jenis', en: 'Kind' }, required: true, options: [
        { value: 'SUPPLIES', label: 'Bekalan pejabat', words: ['alat tulis', 'stationery', 'supplies', 'bekalan', 'kertas', 'paper', 'toner'] },
        { value: 'UTILITIES', label: 'Utiliti', words: ['elektrik', 'electric', 'air', 'water', 'utiliti', 'utilities', 'internet'] },
        { value: 'RENT', label: 'Sewa', words: ['sewa', 'rent'] },
      ] },
      { name: 'period', type: 'month', label: { bm: 'Bulan', en: 'Month' }, required: true },
      { name: 'item', type: 'text', label: { bm: 'Barang / bil', en: 'Item or bill' }, required: true, fromText: true },
      { name: 'amount', type: 'number', unit: 'rm', label: { bm: 'Jumlah (RM)', en: 'Amount (RM)' }, required: true },
      { name: 'proof', type: 'proof', documentsOnly: true, label: { bm: 'Resit, sebut harga atau bil', en: 'Receipt, quotation or bill' } },
    ],
    view: 'office',
    may: (u) => staff(u) && u.role === 'company_manager',
  },
  {
    id: 'client-request',
    label: { bm: 'Catat permintaan pelanggan', en: 'Log a client request' },
    words: ['pelanggan minta', 'client asked', 'client request', 'permintaan pelanggan', 'tambah pengawal', 'more guards', 'kurang pengawal', 'fewer guards', 'acara', 'event'],
    fields: [
      { name: 'accountId', type: 'pick', list: 'clients', label: { bm: 'Pelanggan', en: 'Client' }, required: true },
      { name: 'kind', type: 'choice', label: { bm: 'Permintaan', en: 'Request' }, required: true, options: [
        { value: 'more_guards', label: 'Tambah pengawal', words: ['tambah pengawal', 'more guards', 'extra guard', 'tambah'] },
        { value: 'fewer_guards', label: 'Kurang pengawal', words: ['kurang pengawal', 'fewer guards', 'kurangkan'] },
        { value: 'temporary', label: 'Pos sementara / acara', words: ['sementara', 'temporary', 'acara', 'event', 'majlis'] },
        { value: 'schedule', label: 'Tukar waktu', words: ['waktu', 'jadual', 'schedule', 'hours', 'syif', 'shift'] },
        { value: 'other', label: 'Lain-lain', words: [] },
      ] },
      { name: 'what', type: 'longtext', label: { bm: 'Apa yang diminta', en: 'What they asked for' }, required: true, fromText: true },
      { name: 'from', type: 'text', label: { bm: 'Siapa di pihak pelanggan', en: 'Who at the client asked' }, required: true },
      { name: 'neededBy', type: 'date', label: { bm: 'Diperlukan sebelum', en: 'Needed by' }, pick: 'last' },
    ],
    view: 'clients',
    may: (u) => staff(u) && (u.role === 'company_manager' || u.role === 'admin_exec' || ['om', 'regional', 'ogm', 'ops_director', 'coo'].includes(u.opsTier ?? '')),
  },
  {
    id: 'vacancy',
    label: { bm: 'Mohon jawatan kosong', en: 'Raise a vacancy' },
    words: ['jawatan kosong', 'vacancy', 'ambil pekerja', 'hire', 'recruit', 'perlu pengawal baru', 'perlu staf'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'title', type: 'text', label: { bm: 'Jawatan', en: 'Job title' }, required: true },
      { name: 'category', type: 'choice', label: { bm: 'Kategori', en: 'Category' }, required: true, options: [
        { value: 'guard', label: 'Pengawal', words: ['pengawal', 'guard', 'guards'] },
        { value: 'officer', label: 'Pegawai peronda', words: ['pegawai peronda', 'patrol officer', 'peronda'] },
        { value: 'staff', label: 'Staf pejabat', words: ['staf', 'staff', 'eksekutif', 'executive', 'kerani', 'clerk'] },
      ] },
      { name: 'department', type: 'text', label: { bm: 'Jabatan', en: 'Department' } },
      { name: 'headcount', type: 'number', unit: 'count', label: { bm: 'Bilangan', en: 'How many' }, required: true },
      { name: 'state', type: 'text', label: { bm: 'Negeri (pengawal / peronda)', en: 'State (guards and officers)' } },
      { name: 'payFrom', type: 'number', unit: 'rm', pick: 'first', label: { bm: 'Gaji dari (RM)', en: 'Pay from (RM)' } },
      { name: 'payTo', type: 'number', unit: 'rm', pick: 'last', label: { bm: 'Gaji hingga (RM)', en: 'Pay to (RM)' } },
      { name: 'reason', type: 'longtext', label: { bm: 'Sebab', en: 'Why it is needed' }, required: true, fromText: true },
    ],
    view: 'hr',
    may: (u) => staff(u) && (hrKeeps(u) || u.role === 'company_manager'),
  },
  {
    id: 'payment-request',
    label: { bm: 'Permohonan bayaran', en: 'Payment request' },
    words: ['permohonan bayaran', 'payment request', 'minta bayar', 'bayar kepada', 'pay to', 'bayaran'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'subject', type: 'choice', keep: true, label: { bm: 'Untuk', en: 'For' }, required: true, options: [
        { value: 'finance', label: 'Kewangan', words: ['kewangan', 'finance'] },
        { value: 'operations', label: 'Operasi', words: ['operasi', 'operations', 'tapak', 'site'] },
        { value: 'it', label: 'IT', words: ['it', 'komputer', 'laptop'] },
        { value: 'fwm', label: 'Pekerja asing', words: ['pekerja asing', 'foreign worker', 'permit', 'fomema'] },
        { value: 'inventory', label: 'Perolehan', words: ['perolehan', 'procurement', 'stok', 'uniform'] },
        { value: 'transport', label: 'Pengangkutan', words: ['kenderaan', 'vehicle', 'transport', 'kereta'] },
        { value: 'goodwill', label: 'Goodwill', words: ['goodwill'] },
      ] },
      { name: 'sector', type: 'choice', label: { bm: 'Tapak kerajaan atau swasta (operasi)', en: 'Government or private sites (operations)' }, options: [
        { value: 'government', label: 'Kerajaan', words: ['kerajaan', 'government'] },
        { value: 'private', label: 'Swasta', words: ['swasta', 'private'] },
      ] },
      { name: 'title', type: 'text', label: { bm: 'Bayaran untuk', en: 'What the payment is' }, required: true, fromText: true },
      { name: 'payee', type: 'text', label: { bm: 'Dibayar kepada', en: 'Who is paid' }, required: true },
      { name: 'amount', type: 'number', unit: 'rm', label: { bm: 'Jumlah (RM)', en: 'Amount (RM)' }, required: true },
      { name: 'dueOn', type: 'date', label: { bm: 'Diperlukan sebelum', en: 'Needed by' }, required: true, pick: 'last' },
      { name: 'purpose', type: 'longtext', label: { bm: 'Kenapa perlu', en: 'Why it is needed' }, required: true, fromText: true },
      { name: 'calc', type: 'longtext', label: { bm: 'Cara kira jumlah', en: 'How the amount was worked out' }, required: true },
      { name: 'evidence', type: 'text', label: { bm: 'Dokumen sokongan (pisah dengan koma)', en: 'Supporting documents (comma between)' }, required: true },
    ],
    view: 'payreq',
    may: (u) => staff(u) && u.role === 'company_manager',
  },
  {
    id: 'police-help',
    label: { bm: 'Minta bantuan Kawalan Senjata (polis)', en: 'Police visit or call: ask Arms Control for help' },
    words: ['polis', 'police', 'balai', 'ipd', 'pemeriksaan polis', 'police check'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'kind', type: 'choice', label: { bm: 'Polis', en: 'The police' }, required: true, options: [
        { value: 'PHONE_CALL', label: 'Menelefon', words: ['telefon', 'phoned', 'call', 'called', 'menelefon'] },
        { value: 'VISIT_NOW', label: 'Datang sekarang / sudah tiba', words: ['sekarang', 'now', 'sudah tiba', 'here', 'datang sekarang'] },
        { value: 'VISIT_BOOKED', label: 'Akan datang', words: ['akan datang', 'will visit', 'will come', 'temujanji', 'appointment'] },
      ] },
      { name: 'reason', type: 'choice', label: { bm: 'Sebab', en: 'What the police want' }, required: true, options: [
        { value: 'ARMOURY_CHECK', label: 'Pemeriksaan bilik kebal / senjata', words: ['bilik kebal', 'armoury', 'senjata', 'firearm check', 'vault'] },
        { value: 'DOCUMENT_CHECK', label: 'Pemeriksaan dokumen', words: ['dokumen', 'document', 'lesen', 'licence'] },
        { value: 'FIREARM_QUERY', label: 'Pertanyaan senjata api', words: ['pertanyaan', 'query', 'tanya'] },
        { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'date', type: 'date', label: { bm: 'Tarikh lawatan (jika akan datang)', en: 'Visit date (if booked)' }, pick: 'first' },
      { name: 'time', type: 'time', label: { bm: 'Masa lawatan', en: 'Visit time' }, pick: 'first' },
      { name: 'policeUnit', type: 'text', label: { bm: 'Balai / unit polis', en: 'Police station or unit' }, required: true },
      { name: 'officer', type: 'text', label: { bm: 'Nama pegawai polis', en: 'Police officer' } },
      { name: 'asked', type: 'longtext', label: { bm: 'Apa yang polis minta', en: 'What the police asked for' }, required: true, fromText: true },
      { name: 'contactName', type: 'text', keep: true, label: { bm: 'Hubungi siapa', en: 'Who Arms Control should call' }, required: true },
      { name: 'contactPhone', type: 'text', pattern: 'phone', keep: true, label: { bm: 'Nombor telefon', en: 'Phone number' }, required: true },
    ],
    view: 'cases',
    may: (u) => staff(u) && (u.role === 'company_manager' || u.role === 'admin_exec'),
  },
  {
    id: 'leave-for',
    label: { bm: 'Masukkan cuti untuk pengawal atau staf', en: 'Enter leave for a guard or staff member' },
    words: ['cuti pengawal', 'guard leave', 'cuti untuk', 'leave for', 'masukkan cuti', 'enter leave', 'mc pengawal', 'untuk pengawal', 'untuk staf', 'for my staff', 'for the guard'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'personId', type: 'pick', list: 'people', label: { bm: 'Pengawal / staf', en: 'Guard or staff member' }, required: true },
      { name: 'kind', type: 'choice', label: { bm: 'Jenis cuti', en: 'Kind of leave' }, required: true, options: [
        { value: 'ANNUAL', label: 'Cuti tahunan', words: ['tahunan', 'annual'] },
        { value: 'SICK', label: 'Cuti sakit', words: ['sakit', 'sick', 'mc'] },
        { value: 'EMERGENCY', label: 'Cuti kecemasan', words: ['kecemasan', 'emergency'] },
        { value: 'UNPAID', label: 'Cuti tanpa gaji', words: ['tanpa gaji', 'unpaid'] },
      ] },
      { name: 'from', type: 'date', label: { bm: 'Dari', en: 'From' }, required: true, pick: 'first' },
      { name: 'to', type: 'date', label: { bm: 'Hingga', en: 'To' }, required: true, pick: 'last' },
      { name: 'illness', type: 'text', label: { bm: 'Penyakit seperti dalam MC', en: 'Illness as on the MC' } },
      { name: 'clinic', type: 'text', label: { bm: 'Klinik / hospital', en: 'Clinic or hospital' } },
      { name: 'mcNo', type: 'text', label: { bm: 'No. siri MC (cuti sakit)', en: 'MC serial number (sick leave)' } },
      { name: 'proof', type: 'proof', label: { bm: 'MC / surat hospital (wajib untuk cuti sakit)', en: 'MC or hospital letter (needed for sick leave)' } },
      { name: 'reason', type: 'longtext', label: { bm: 'Sebab', en: 'Reason' }, required: true, fromText: true },
    ],
    view: 'mine',
    may: (u) => staff(u) && (u.role === 'company_manager' || u.role === 'admin_exec' || ['om', 'regional'].includes(u.opsTier ?? '') || hrKeeps(u)),
  },
  {
    id: 'case-report',
    label: { bm: 'Lapor kes / insiden', en: 'Report a case or incident' },
    words: ['insiden', 'incident', 'kejadian', 'aduan', 'complaint', 'kes', 'case', 'kecurian', 'theft', 'kemalangan', 'accident', 'pecah masuk', 'break-in'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'siteId', type: 'pick', list: 'companySites', label: { bm: 'Tapak', en: 'Site' } },
      { name: 'type', type: 'choice', label: { bm: 'Jenis', en: 'Kind' }, required: true, options: [
        { value: 'INCIDENT', label: 'Insiden', words: ['insiden', 'incident', 'kejadian', 'kecurian', 'theft', 'kemalangan', 'accident', 'pecah masuk', 'break-in', 'gaduh', 'fight'] },
        { value: 'COMPLAINT', label: 'Aduan', words: ['aduan', 'complaint', 'complain', 'merungut'] },
        { value: 'COMPLIANCE', label: 'Pematuhan', words: ['pematuhan', 'compliance', 'tidak ikut sop', 'sop'] },
        { value: 'IDENTITY_CHECK', label: 'Semakan identiti', words: ['identiti', 'identity', 'ic palsu'] },
      ] },
      { name: 'severity', type: 'choice', label: { bm: 'Tahap', en: 'Severity' }, required: true, options: [
        { value: 'P1', label: 'P1 kritikal', words: ['kritikal', 'critical', 'cedera', 'injured', 'senjata', 'weapon'] },
        { value: 'P2', label: 'P2 tinggi', words: ['serius', 'serious', 'tinggi', 'high', 'segera', 'urgent'] },
        { value: 'P3', label: 'P3 sederhana', words: ['sederhana', 'medium'] },
        { value: 'P4', label: 'P4 rendah', words: ['kecil', 'minor', 'rendah', 'low'] },
      ] },
      { name: 'title', type: 'text', label: { bm: 'Tajuk', en: 'Title' }, required: true, fromText: true },
      { name: 'description', type: 'longtext', label: { bm: 'Apa yang berlaku', en: 'What happened' }, required: true, fromText: true },
      { name: 'proof', type: 'proof', label: { bm: 'Gambar atau dokumen', en: 'Photo or document' }, required: true },
    ],
    view: 'cases',
    may: (u) => staff(u) && (u.role === 'company_manager' || u.role === 'admin_exec' || u.role === 'supervisor' || ['om', 'regional', 'ogm', 'ops_director'].includes(u.opsTier ?? '')),
  },
  {
    id: 'uniform-guard',
    label: { bm: 'Minta uniform untuk seorang pengawal', en: 'Ask for a uniform piece for one guard' },
    words: ['uniform untuk', 'uniform for', 'seluar koyak', 'baju koyak', 'torn', 'pengawal perlukan', 'guard needs'],
    fields: [
      { name: 'staffNo', type: 'text', pattern: 'staffNo', label: { bm: 'No. staf pengawal', en: "Guard's staff number" }, required: true },
      { name: 'stockItemId', type: 'pick', list: 'uniforms', label: { bm: 'Uniform', en: 'Uniform piece' }, required: true },
      { name: 'qty', type: 'number', unit: 'count', label: { bm: 'Bilangan', en: 'Pieces' }, required: true },
      { name: 'reason', type: 'longtext', label: { bm: 'Sebab', en: 'Why' }, required: true, fromText: true },
    ],
    view: 'items',
    may: (u) => staff(u) && ['om', 'regional'].includes(u.opsTier ?? ''),
  },
  {
    id: 'purchase-request',
    label: { bm: 'Permohonan pembelian', en: 'Purchase request' },
    words: ['beli', 'buy', 'pembelian', 'purchase', 'sebut harga', 'quotation', 'perolehan', 'seunit', 'per unit', 'harga', 'price'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'title', type: 'text', label: { bm: 'Apa yang dibeli', en: 'What is being bought' }, required: true, fromText: true },
      { name: 'category', type: 'choice', label: { bm: 'Kategori', en: 'Category' }, required: true, options: [
        { value: 'UNIFORM', label: 'Uniform', words: ['uniform', 'seragam', 'baju', 'seluar', 'kasut'] },
        { value: 'GUARD_EQUIPMENT', label: 'Peralatan pengawal', words: ['lampu suluh', 'torchlight', 'baton', 'walkie', 'peralatan'] },
        { value: 'DEVICE', label: 'Peranti', words: ['peranti', 'device', 'telefon', 'phone', 'tablet'] },
        { value: 'PATROL_DEVICE', label: 'Peranti rondaan', words: ['rondaan', 'patrol', 'rfid'] },
        { value: 'CLEANING', label: 'Pembersihan', words: ['pembersihan', 'cleaning', 'sabun', 'penyapu', 'mop'] },
        { value: 'SERVICES', label: 'Perkhidmatan', words: ['perkhidmatan', 'service', 'servis', 'repair', 'baiki'] },
        { value: 'IT', label: 'IT', words: ['laptop', 'komputer', 'printer'] },
        { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'item', type: 'text', label: { bm: 'Barang', en: 'Item' }, required: true },
      { name: 'qty', type: 'number', unit: 'count', label: { bm: 'Kuantiti', en: 'Quantity' }, required: true },
      { name: 'unitPrice', type: 'number', unit: 'rm', label: { bm: 'Harga seunit (RM)', en: 'Unit price (RM)' }, required: true },
    ],
    view: 'purchasing',
    may: (u) => staff(u) && (u.role === 'company_manager' || u.role === 'admin_exec' || (u.department === 'procurement' && u.procRole !== 'storekeeper')),
  },
  {
    id: 'fwm-task',
    label: { bm: 'Hantar tugas pekerja asing kepada OM', en: 'Send a foreign worker task to the OM' },
    words: ['fomema', 'imigresen', 'jim', 'biometrik', 'biometric', 'tng', 'tugas fwm', 'pekerja asing'],
    fields: [
      { name: 'personId', type: 'pick', list: 'fwWorkers', label: { bm: 'Pekerja', en: 'Worker' }, required: true },
      { name: 'kind', type: 'choice', label: { bm: 'Tugas', en: 'Task' }, required: true, options: [
        { value: 'FOMEMA', label: 'FOMEMA', words: ['fomema', 'pemeriksaan perubatan'] },
        { value: 'JIM', label: 'Imigresen (JIM)', words: ['jim', 'imigresen', 'immigration'] },
        { value: 'TNG', label: 'TNG', words: ['tng'] },
        { value: 'BIOMETRIC', label: 'Biometrik', words: ['biometrik', 'biometric', 'cap jari'] },
        { value: 'UTILITY_CLAUSE', label: 'Klausa utiliti', words: ['utiliti', 'utility'] },
        { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'what', type: 'longtext', label: { bm: 'Apa yang OM perlu buat', en: 'What the OM needs to get done' }, required: true, fromText: true },
      { name: 'place', type: 'text', label: { bm: 'Tempat', en: 'Where' } },
      { name: 'dueOn', type: 'date', label: { bm: 'Siap sebelum', en: 'Due' }, required: true, pick: 'last' },
    ],
    view: 'fwm',
    may: (u) => staff(u) && u.department === 'fwm' && u.fwmRole !== 'despatch',
  },
  {
    id: 'vehicle-request',
    label: { bm: 'Mohon kenderaan', en: 'Ask for a vehicle' },
    words: ['kenderaan', 'vehicle', 'kereta', 'car', 'van', 'pinjam kereta', 'guna kereta'],
    fields: [
      { name: 'purpose', type: 'longtext', label: { bm: 'Untuk apa', en: 'What it is for' }, required: true, fromText: true },
      { name: 'date', type: 'date', label: { bm: 'Tarikh', en: 'Date' }, required: true, pick: 'first' },
      { name: 'start', type: 'time', label: { bm: 'Dari', en: 'From' }, required: true, pick: 'first' },
      { name: 'end', type: 'time', label: { bm: 'Hingga', en: 'To' }, required: true, pick: 'last' },
    ],
    view: 'fleet',
    may: (u) => staff(u) && u.role !== 'supervisor' && u.opsTier !== 'patrol',
  },
  {
    id: 'fuel',
    label: { bm: 'Rekod isi minyak', en: 'Record a fuel fill-up' },
    words: ['isi minyak', 'fuel', 'petrol', 'diesel', 'minyak', 'ron95', 'ron97'],
    fields: [
      { name: 'vehicleId', type: 'pick', list: 'vehicles', label: { bm: 'Kenderaan', en: 'Vehicle' }, required: true },
      { name: 'date', type: 'date', past: true, label: { bm: 'Tarikh', en: 'Date' }, required: true, pick: 'first' },
      { name: 'time', type: 'time', label: { bm: 'Masa', en: 'Time' }, required: true, pick: 'first' },
      { name: 'driver', type: 'text', keep: true, label: { bm: 'Pemandu', en: 'Driver' }, required: true },
      { name: 'paidWith', type: 'choice', keep: true, label: { bm: 'Bayar dengan', en: 'Paid with' }, required: true, options: [
        { value: 'FUEL_CARD', label: 'Kad minyak', words: ['kad minyak', 'fuel card', 'fleet card'] },
        { value: 'SUBSIDY_CARD', label: 'Kad subsidi', words: ['subsidi', 'subsidy'] },
        { value: 'CASH', label: 'Tunai', words: ['tunai', 'cash'] },
        { value: 'OWN_MONEY', label: 'Duit sendiri', words: ['duit sendiri', 'own money'] },
      ] },
      { name: 'cardId', type: 'pick', list: 'fuelCards', single: true, label: { bm: 'Kad yang digunakan (jika bayar dengan kad)', en: 'Card used (when paid by card)' } },
      { name: 'fuel', type: 'choice', keep: true, label: { bm: 'Minyak', en: 'Fuel' }, required: true, options: [
        { value: 'RON95', label: 'RON95', words: ['ron95', 'ron 95', 'petrol'] },
        { value: 'RON97', label: 'RON97', words: ['ron97', 'ron 97'] },
        { value: 'DIESEL', label: 'Diesel', words: ['diesel'] },
        { value: 'LPG', label: 'LPG', words: ['lpg', 'gas'] },
        { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'litres', type: 'number', unit: 'litres', label: { bm: 'Liter', en: 'Litres' }, required: true },
      { name: 'amountRm', type: 'number', unit: 'rm', label: { bm: 'Jumlah (RM)', en: 'Amount (RM)' }, required: true },
      { name: 'odometerKm', type: 'number', unit: 'km', label: { bm: 'Odometer (km)', en: 'Odometer (km)' }, required: true },
      { name: 'station', type: 'text', label: { bm: 'Stesen', en: 'Station' }, required: true },
      { name: 'proof', type: 'proof', documentsOnly: true, label: { bm: 'Resit', en: 'Receipt' } },
    ],
    view: 'fleet',
    may: (u) => staff(u) && u.role === 'pwvsb_officer' && u.department === 'transport',
  },
  {
    id: 'rent-payment',
    label: { bm: 'Rekod bayaran sewa', en: 'Record a rent payment' },
    words: ['sewa', 'rent', 'bayaran sewa', 'rent payment', 'penyewa', 'tenant'],
    fields: [
      { name: 'unitId', type: 'pick', list: 'units', label: { bm: 'Unit', en: 'Unit' }, required: true },
      { name: 'amount', type: 'number', unit: 'rm', label: { bm: 'Jumlah (RM)', en: 'Amount (RM)' }, required: true },
      { name: 'method', type: 'choice', label: { bm: 'Cara bayar', en: 'Paid by' }, required: true, options: [
        { value: 'TRANSFER', label: 'Pindahan', words: ['transfer', 'pindahan', 'ibg', 'duitnow'] },
        { value: 'ONLINE', label: 'Dalam talian / FPX', words: ['online', 'fpx', 'dalam talian'] },
        { value: 'CHEQUE', label: 'Cek', words: ['cek', 'cheque'] },
        { value: 'CDM', label: 'Mesin deposit tunai', words: ['cdm', 'mesin deposit'] },
        { value: 'CASH', label: 'Tunai', words: ['tunai', 'cash'] },
      ] },
      { name: 'on', type: 'date', past: true, label: { bm: 'Tarikh terima', en: 'Received on' }, required: true, pick: 'first' },
      { name: 'receiptNo', type: 'text', label: { bm: 'No. resit', en: 'Receipt number' } },
      { name: 'ref', type: 'text', label: { bm: 'Rujukan bank / no. cek (pindahan, cek)', en: 'Bank reference or cheque number (transfer, cheque)' } },
    ],
    view: 'assets',
    may: (u) => staff(u) && assetRole(u) === 'team',
  },
  {
    id: 'act-finding',
    label: { bm: 'Rekod penemuan audit', en: 'Record an audit finding' },
    words: ['penemuan', 'finding', 'audit', 'tidak patuh', 'non-compliance', 'kelemahan', 'weakness'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', label: { bm: 'Syarikat (jika ada)', en: 'Company (if any)' } },
      { name: 'area', type: 'choice', label: { bm: 'Aliran kerja', en: 'Workflow' }, required: true, options: RULES.act.value.areas.map((a) => ({ value: a.id, label: a.name, words: a.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 5).slice(0, 3) })) },
      { name: 'severity', type: 'choice', label: { bm: 'Tahap', en: 'Severity' }, required: true, options: [
        { value: 'high', label: 'Tinggi', words: ['tinggi', 'high', 'serius', 'serious'] },
        { value: 'medium', label: 'Sederhana', words: ['sederhana', 'medium'] },
        { value: 'low', label: 'Rendah', words: ['rendah', 'low', 'kecil', 'minor'] },
      ] },
      { name: 'title', type: 'text', label: { bm: 'Apa yang salah', en: 'What is wrong' }, required: true, fromText: true },
      { name: 'detail', type: 'longtext', label: { bm: 'Butiran', en: 'Details' }, fromText: true },
      { name: 'evidence', type: 'longtext', label: { bm: 'Apa yang dilihat (bukti)', en: 'What you saw (evidence)' }, required: true, fromText: true },
      { name: 'ownerUserId', type: 'pick', list: 'owners', label: { bm: 'Siapa yang membetulkan', en: 'Who fixes it' }, required: true },
    ],
    view: 'act',
    may: (u) => staff(u) && u.department === 'audit',
  },
  {
    id: 'it-purchase',
    label: { bm: 'Permohonan pembelian IT', en: 'IT purchase request' },
    words: ['beli laptop', 'buy laptop', 'laptop baru', 'new laptop', 'pembelian it', 'it purchase', 'beli printer', 'beli komputer'],
    fields: [
      { name: 'kind', type: 'choice', label: { bm: 'Jenis', en: 'Kind' }, required: true, options: [
        { value: 'LAPTOP', label: 'Laptop', words: ['laptop'] }, { value: 'DESKTOP', label: 'Desktop', words: ['desktop', 'komputer', 'pc'] },
        { value: 'PHONE', label: 'Telefon', words: ['telefon', 'phone'] }, { value: 'TABLET', label: 'Tablet', words: ['tablet', 'ipad'] },
        { value: 'PRINTER', label: 'Pencetak', words: ['printer', 'pencetak'] }, { value: 'NETWORK', label: 'Rangkaian', words: ['router', 'switch', 'wifi', 'network'] },
        { value: 'CCTV', label: 'CCTV', words: ['cctv', 'kamera'] }, { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'description', type: 'text', label: { bm: 'Penerangan', en: 'Description' }, required: true, fromText: true },
      { name: 'qty', type: 'number', unit: 'count', label: { bm: 'Kuantiti', en: 'Quantity' }, required: true },
      { name: 'unitPrice', type: 'number', unit: 'rm', label: { bm: 'Harga seunit (RM)', en: 'Unit price (RM)' }, required: true },
      { name: 'reason', type: 'longtext', label: { bm: 'Kenapa perlu', en: 'Why it is needed' }, required: true, fromText: true },
    ],
    view: 'it-procurement',
    may: (u) => staff(u) && u.department === 'it' && ['manager', 'lead', 'executive'].includes(u.itRole ?? ''),
  },
  {
    id: 'pdpa-request',
    label: { bm: 'Catat permintaan data peribadi (PDPA)', en: 'Log a personal data request (PDPA)' },
    words: ['pdpa', 'data peribadi', 'personal data', 'akses data', 'data access', 'betulkan data', 'tarik balik persetujuan'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', label: { bm: 'Syarikat yang memegang data', en: 'Company holding the data' }, required: true },
      { name: 'kind', type: 'choice', label: { bm: 'Permintaan', en: 'Request' }, required: true, options: [
        { value: 'ACCESS', label: 'Akses', words: ['akses', 'access', 'salinan', 'copy'] },
        { value: 'CORRECTION', label: 'Pembetulan', words: ['betulkan', 'correct', 'pembetulan', 'salah'] },
        { value: 'PORTABILITY', label: 'Pindah data', words: ['pindah', 'portability', 'transfer'] },
        { value: 'WITHDRAW_CONSENT', label: 'Tarik balik persetujuan', words: ['tarik balik', 'withdraw'] },
        { value: 'OBJECTION', label: 'Bantahan', words: ['bantah', 'object', 'bantahan'] },
      ] },
      { name: 'subjectName', type: 'text', label: { bm: 'Siapa yang meminta', en: 'Who asked' }, required: true },
      { name: 'subjectKind', type: 'choice', label: { bm: 'Dia ialah', en: 'They are' }, required: true, options: [
        { value: 'guard', label: 'Pengawal', words: ['pengawal', 'guard'] }, { value: 'staff', label: 'Staf', words: ['staf', 'staff'] },
        { value: 'client', label: 'Pelanggan', words: ['pelanggan', 'client'] }, { value: 'other', label: 'Lain-lain', words: [] },
      ] },
      { name: 'detail', type: 'longtext', label: { bm: 'Apa yang diminta', en: 'What they asked for' }, required: true, fromText: true },
      { name: 'receivedOn', type: 'date', past: true, label: { bm: 'Tarikh diterima', en: 'Received on' }, required: true, pick: 'first' },
    ],
    view: 'pdpa',
    may: (u) => staff(u) && pdpaRole(u) === 'officer',
  },
  {
    id: 'legal-matter',
    label: { bm: 'Buka perkara undang-undang', en: 'Open a legal matter' },
    words: ['saman', 'sue', 'lawsuit', 'mahkamah', 'court', 'peguam', 'lawyer', 'notis tuntutan', 'letter of demand', 'tuntutan undang-undang'],
    fields: [
      { name: 'companyId', type: 'pick', list: 'companies', keep: true, label: { bm: 'Syarikat', en: 'Company' }, required: true },
      { name: 'title', type: 'text', label: { bm: 'Perkara', en: 'Matter' }, required: true, fromText: true },
      { name: 'kind', type: 'choice', label: { bm: 'Jenis', en: 'Kind' }, required: true, options: [
        { value: 'LITIGATION', label: 'Litigasi', words: ['saman', 'sue', 'mahkamah', 'court', 'litigation'] },
        { value: 'DEMAND', label: 'Notis tuntutan', words: ['notis tuntutan', 'letter of demand', 'lod', 'demand'] },
        { value: 'LABOUR', label: 'Buruh / perusahaan', words: ['buruh', 'labour', 'mahkamah perusahaan', 'industrial'] },
        { value: 'REGULATORY', label: 'Pihak berkuasa', words: ['kdn', 'pihak berkuasa', 'regulator', 'kompaun', 'compound'] },
        { value: 'CONTRACT', label: 'Kontrak', words: ['kontrak', 'contract'] },
        { value: 'OTHER', label: 'Lain-lain', words: [] },
      ] },
      { name: 'counterparty', type: 'text', label: { bm: 'Pihak lain', en: 'Other party' }, required: true },
      { name: 'side', type: 'choice', label: { bm: 'Kita', en: 'We are' }, required: true, options: [
        { value: 'claimant', label: 'Menuntut', words: ['kita saman', 'we sue', 'menuntut', 'claimant'] },
        { value: 'respondent', label: 'Dituntut', words: ['disaman', 'sued', 'dituntut', 'respondent', 'kena saman'] },
      ] },
      { name: 'exposure', type: 'number', unit: 'rm', label: { bm: 'Jumlah dipertikai (RM)', en: 'Amount at stake (RM)' } },
      { name: 'lawyer', type: 'text', label: { bm: 'Peguam', en: 'Lawyers acting' }, required: true },
      { name: 'nextOn', type: 'date', label: { bm: 'Tarikh seterusnya', en: 'Next date' }, pick: 'last' },
      { name: 'nextWhat', type: 'text', label: { bm: 'Apa seterusnya', en: 'What happens next' } },
    ],
    view: 'governance',
    may: (u) => staff(u) && (u.department === 'legal' || u.role === 'company_manager'),
  },
];

export const assistantActionsFor = (u: User): AssistantAction[] => ASSISTANT_ACTIONS.filter((a) => a.may(u));
export const assistantAllowed = (u: User): boolean => staff(u) && assistantActionsFor(u).length > 0;

// ---------------------------------------------------------------------------------------------------------------
// Skill library and personal style

/**
 * A skill: how a job is done, kept so the agent remembers. A person's own skill is theirs; a team skill is published by
 * a manager or head for their department or company office, and every member's agent uses it.
 */
export interface AssistantSkill {
  id: Id;
  scope: 'me' | 'team';
  /** For 'me' the person's user id; for 'team' `dept:<department>` or `company:<companyId>`. */
  owner: string;
  name: string;
  /** Words that call it up, lower case. */
  words: string[];
  actionId: string;
  /** Values the form starts with (the person still checks them). */
  values: Record<string, unknown>;
  /** Steps or notes shown with the form. */
  note: string;
  by: string;
  byId: Id;
  at: string;
  retired?: { by: string; at: string; reason: string } | null;
}

/**
 * The person's own style: how they write and what they usually choose. Learned only from what the person confirmed
 * and sent. The person sees it, changes it and clears it; nobody else reads it (PDPA: their own data, for their use).
 */
export interface AssistantStyle {
  id: Id; // the user id
  lang: 'bm' | 'en' | 'mix' | null;
  /** A closing line the person likes at the end of notes and reasons, for example "Terima kasih." */
  signOff: string | null;
  /** 'short' keeps the person's words as they are; 'full' adds a polite opening. */
  tone: 'short' | 'full';
  /** Last value the person sent per action and field (a usual site, receiver or IT priority). */
  usual: Record<string, Record<string, unknown>>;
  /** The person's own words for things: "seluar" means a store item, "Rahman" the OM. Learned from their corrections. */
  words: { field: AssistantFieldType; said: string; value: string; label: string }[];
  updatedAt: string;
}

export type { AssistantMemoryRow } from './assistant-service';

export const ASSISTANT_RULE = {
  maxSkillsPerOwner: 200,
  maxWords: 300,
  maxUsual: 40,
  maxTextChars: 2_000,
};

export const emptyStyle = (userId: Id, at: string): AssistantStyle => ({ id: userId, lang: null, signOff: null, tone: 'short', usual: {}, words: [], updatedAt: at });

/** The team units a person's team skills come from: their central department and each company office. */
export function assistantTeams(u: User): string[] {
  const out: string[] = [];
  if (u.department) out.push(`dept:${u.department}`);
  if (u.role === 'company_manager' || u.role === 'admin_exec' || u.role === 'director') for (const c of u.companyIds) out.push(`company:${c}`);
  return out;
}
/** Who may publish a team skill for a unit: its head or manager, or a group leader. */
export function assistantMayPublish(u: User, owner: string): boolean {
  if (isGroupLeader(u)) return true;
  if (!assistantTeams(u).includes(owner)) return false;
  if (owner.startsWith('company:')) return u.role === 'company_manager' || u.role === 'director';
  return (
    u.itRole === 'manager' || u.itRole === 'lead' || u.actRole === 'lead' || u.actRole === 'manager' || u.financeRole === 'leader' || u.procRole === 'manager' ||
    !!u.leadership || (!!u.opsTier && u.opsTier !== 'patrol')
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Understanding an instruction: fixed rules only

export interface AssistantLists {
  sites?: { id: Id; name: string; code?: string }[];
  items?: { id: Id; name: string; size?: string | null }[];
  receivers?: { id: Id; name: string }[];
  /** Other Prima lists, by the field's `list` name, read as the person. */
  pick?: Record<string, { id: Id; name: string; code?: string }[]>;
}

export type AssistantOrigin = 'said' | 'skill' | 'usual' | 'words' | 'text' | 'default';
export interface AssistantDraft {
  actionId: string | null;
  /** Other actions that also fit, for the person to choose instead. */
  alternatives: string[];
  skillId: string | null;
  values: Record<string, unknown>;
  /** Where each value came from. Everything not typed by the person is checked before Send. */
  origins: Record<string, AssistantOrigin>;
  /** For the items: each line and the words it came from. */
  missing: string[];
  notes: string[];
}

export const assistantNorm = (s: string) =>
  ` ${s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9.\s/-]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()} `;
const hasWord = (text: string, w: string) => text.includes(` ${w} `) || (w.includes(' ') && text.includes(w));
const SKIP = new Set(['dan', 'untuk', 'the', 'and', 'for', 'of', 'di', 'ke', 'dari', 'set', 'sdn', 'bhd', 'site', 'tapak']);
const tokens = (s: string) => assistantNorm(s).trim().split(' ').filter((t) => t.length > 1 && !SKIP.has(t));

function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const MONTH_ONLY: Record<string, number> = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12 };

/** The dates said, in the order said: "esok", "25 Nov", "25/11", "1 Disember 2026" (a date without a year is the next one). */
export function assistantDates(text: string, today: IsoDate): IsoDate[] {
  const low = text.toLowerCase();
  const found: { at: number; d: IsoDate }[] = [];
  for (const v of keyInValuesIn('date', text)) found.push({ at: text.indexOf(v.raw), d: String(v.value) });
  const taken = (at: number) => found.some((f) => Math.abs(f.at - at) < 6);
  for (const m of low.matchAll(/\b(\d{1,2})\s*(?:hb\s*)?([a-z]{3,9})\b(?!\s*\d{4})/g)) {
    const mo = MONTH_ONLY[m[2]];
    if (!mo || taken(m.index!)) continue;
    let y = Number(today.slice(0, 4));
    const iso = (yy: number) => `${yy}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    if (iso(y) < today) y += 1;
    const d = iso(y);
    if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d) found.push({ at: m.index!, d });
  }
  for (const m of low.matchAll(/(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?![\d/.-])/g)) {
    if (taken(m.index!)) continue;
    let y = Number(today.slice(0, 4));
    const iso = (yy: number) => `${yy}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    if (iso(y) < today) y += 1;
    const d = iso(y);
    if (Number(m[2]) >= 1 && Number(m[2]) <= 12 && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d) found.push({ at: m.index!, d });
  }
  for (const [w, n] of Object.entries(TODAY_WORDS)) {
    const at = assistantNorm(low).indexOf(` ${w} `);
    if (at >= 0) found.push({ at: low.indexOf(w), d: addDays(today, n) });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.d);
}

/** The times said, in order: "9.00", "14:30", "9 pagi", "2 petang", "3pm". */
export function assistantTimes(text: string): string[] {
  const out: { at: number; t: string }[] = [];
  const low = text.toLowerCase();
  for (const m of low.matchAll(/\b(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm|pagi|tengah hari|petang|malam)?\b/g)) {
    if (!m[2] && !m[3]) continue;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const p = m[3];
    if ((p === 'pm' || p === 'petang' || p === 'malam') && h < 12) h += 12;
    if ((p === 'am' || p === 'pagi') && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    // A date like 25.11 is not a time.
    if (m[2] && !p && /^[./]\d{2,4}/.test(low.slice(m.index! + m[0].length))) continue;
    out.push({ at: m.index!, t: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` });
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.t);
}

/** The numbers said for one kind of amount: "RM 250.50", "3 orang", "40 liter", "52,000 km", "2 jam". */
export function assistantNumbers(t: string, unit: NonNullable<AssistantField['unit']>): number[] {
  const n = '(\\d[\\d,]*(?:\\.\\d{1,2})?)';
  const re =
    unit === 'rm' ? new RegExp(`(?:\\brm\\s?${n}|(?<![\\w.-])${n}\\s?(?:ringgit|rm)\\b(?!\\s?\\d))`, 'g')
    : unit === 'litres' ? new RegExp(`${n}\\s?(?:l|liter|litre|liters|litres)\\b`, 'g')
    : unit === 'km' ? new RegExp(`${n}\\s?km\\b`, 'g')
    : unit === 'count' ? /(\d{1,4})\s?(?:orang|people|persons?|pax|unit|units|helai|pasang|pcs|keping|biji|kekosongan|jawatan|posts?|pieces?|nos)\b/g
    : /(\d{1,3}(?:\.\d{1,2})?)\s?(?:jam|hours?|hrs?|h)\b/g;
  const out: number[] = [];
  for (const m of t.matchAll(re)) {
    const v = Number((m[1] ?? m[2] ?? '').replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/** A month said by name ("November", "Disember 2026"), as YYYY-MM; a month without a year is the nearest one. */
export function assistantMonth(text: string, today: IsoDate): string | null {
  const low = text.toLowerCase();
  for (const m of low.matchAll(/\b([a-z]{3,9})(?:\s+(\d{4}))?\b/g)) {
    const mo = MONTH_ONLY[m[1]];
    // "may" and "mac" are also ordinary words; they count only with a year.
    if (!mo || (['may', 'mac', 'mar'].includes(m[1]) && !m[2])) continue;
    let y = m[2] ? Number(m[2]) : Number(today.slice(0, 4));
    if (!m[2] && mo < Number(today.slice(5, 7)) - 6) y += 1;
    return `${y}-${String(mo).padStart(2, '0')}`;
  }
  return null;
}

/** The one list entry the text names best, or null when none or two fit equally. */
export function assistantMatch<T extends { id: Id; name: string; code?: string }>(text: string, list: T[], words: AssistantStyle['words'] = [], field?: AssistantFieldType): T | null {
  const t = assistantNorm(text);
  for (const w of words) if ((!field || w.field === field) && hasWord(t, assistantNorm(w.said).trim())) {
    const hit = list.find((x) => x.id === w.value);
    if (hit) return hit;
  }
  let best: { x: T; score: number } | null = null;
  let tie = false;
  // A plate or code written with or without its space or dash ("WXY 1234", "RES-006").
  const squeezed = t.replace(/[\s-]+/g, '');
  for (const x of list) {
    if (x.code && hasWord(t, assistantNorm(x.code).trim())) return x;
    const cs = x.code ? assistantNorm(x.code).replace(/[\s-]+/g, '') : '';
    if (cs.length >= 5 && /\d/.test(cs) && /[a-z]/.test(cs) && squeezed.includes(cs)) return x;
    const tk = tokens(x.name);
    if (!tk.length) continue;
    const hit = tk.filter((k) => hasWord(t, k)).length;
    const score = hit / tk.length + hit / 100;
    if (hit === 0 || score < 0.5) continue;
    if (!best || score > best.score + 1e-9) {
      best = { x, score };
      tie = false;
    } else if (Math.abs(score - best.score) < 1e-9) tie = true;
  }
  return best && !tie ? best.x : null;
}

const QTY_WORDS = '(?:helai|pasang|unit|biji|pcs|pc|set|keping|kotak|botol|pek|pair|pairs|units|nos)';

/** Store items with their quantity: "20 pasang seluar saiz 32", "kasut x5", "2 set uniform". */
/** Malay names of common store items, read as the store list's English names. */
const ITEM_WORDS: [RegExp, string][] = [
  [/ seluar /g, ' trousers '], [/ kasut /g, ' shoes '], [/ baju /g, ' shirt '], [/ kemeja /g, ' shirt '], [/ tali pinggang /g, ' belt '],
  [/ lencana /g, ' badges '], [/ topi /g, ' cap '], [/ stoking /g, ' socks '], [/ penyapu /g, ' broom '], [/ sabun /g, ' soap '],
];
/** Words that say what kind of thing an item is but not which one. */
const GENERIC_ITEM = new Set(['uniform', 'seragam', 'guard', 'pengawal', 'pair', 'set', 'full', 'item', 'barang']);

export function assistantItems(text: string, items: NonNullable<AssistantLists['items']>, words: AssistantStyle['words'] = []): { stockItemId: Id; qty: number; said: string }[] {
  let t = assistantNorm(text);
  for (const [re, en] of ITEM_WORDS) t = t.replace(re, en);
  // "seluar trousers" says it twice.
  t = t.replace(/ (\S+)(?: \1)+ /g, ' $1 ');
  const out: { stockItemId: Id; qty: number; said: string; at: number }[] = [];
  const said: { id: Id; at: number; len: number; said: string }[] = [];
  const sizeAt = (at: number, len: number) => {
    const rest = t.slice(at + len - 1, at + len + 30);
    return /^\s*(?:saiz|size|sz)?\s*([a-z0-9]{1,4})\b/.exec(rest)?.[1] ?? /^\s*(?:\S+\s+){0,2}(?:saiz|size|sz)\s*([a-z0-9]{1,4})\b/.exec(rest)?.[1] ?? null;
  };
  // The person's own words first, then each item's name without its size.
  for (const w of words.filter((x) => x.field === 'items')) {
    const k = ` ${assistantNorm(w.said).trim()} `;
    let at = t.indexOf(k);
    while (at >= 0) {
      said.push({ id: w.value, at, len: k.length, said: w.said });
      at = t.indexOf(k, at + 1);
    }
  }
  const byBase = new Map<string, NonNullable<AssistantLists['items']>>();
  for (const it of items) {
    const base = assistantNorm(it.name.replace(/\([^)]*\)/g, '')).trim();
    if (base.length < 3) continue;
    byBase.set(base, [...(byBase.get(base) ?? []), it]);
  }
  // The full name first; then a distinctive word of it ("trousers" for "Uniform trousers") when only one item has it.
  const keys: { k: string; group: NonNullable<AssistantLists['items']> }[] = [...byBase.entries()].sort((a, b) => b[0].length - a[0].length).map(([base, group]) => ({ k: ` ${base} `, group }));
  const wordUse = new Map<string, string[]>();
  for (const base of byBase.keys()) for (const w of tokens(base)) if (w.length >= 4 && !GENERIC_ITEM.has(w)) wordUse.set(w, [...(wordUse.get(w) ?? []), base]);
  for (const [w, bases] of wordUse) if (bases.length === 1 && !bases[0].split(' ').every((x) => x === w)) keys.push({ k: ` ${w} `, group: byBase.get(bases[0])! });
  for (const { k, group } of keys) {
    let at = t.indexOf(k);
    while (at >= 0) {
      if (!said.some((s) => at < s.at + s.len && s.at < at + k.length)) {
        const size = sizeAt(at, k.length);
        // A size said that the store does not have is not swapped for another size.
        const pick = size && /\d/.test(size) && group.every((g) => g.size && g.size.toLowerCase() !== size) ? null : group.length === 1 ? group[0] : group.find((g) => size && (g.size ?? '').toLowerCase() === size) ?? group.find((g) => size && assistantNorm(g.name).includes(` ${size} `)) ?? null;
        if (pick) said.push({ id: pick.id, at, len: k.length, said: k.trim() });
      }
      at = t.indexOf(k, at + 1);
    }
  }
  for (const s of said.sort((a, b) => a.at - b.at)) {
    const before = t.slice(Math.max(0, s.at - 24), s.at);
    const after = t.slice(s.at + s.len, s.at + s.len + 24);
    const q = new RegExp(`(\\d{1,4})\\s*${QTY_WORDS}?\\s*(?:[a-z]{3,12}\\s+)?$`).exec(before)?.[1] ?? /^\s*(?:saiz\s*\S+\s*)?(?:x|×)\s*(\d{1,4})\b/.exec(after)?.[1] ?? null;
    if (!q || Number(q) < 1) continue;
    if (!out.some((o) => o.stockItemId === s.id)) out.push({ stockItemId: s.id, qty: Number(q), said: s.said, at: s.at });
  }
  return out.map(({ stockItemId, qty, said: w }) => ({ stockItemId, qty, said: w }));
}

/** Picks the action: a skill's words first, then the action's own words. Ties are offered to the person. */
export function assistantPick(text: string, actions: AssistantAction[], skills: AssistantSkill[]): { actionId: string | null; skill: AssistantSkill | null; alternatives: string[] } {
  const t = assistantNorm(text);
  const live = skills.filter((s) => !s.retired && actions.some((a) => a.id === s.actionId));
  const skillHits = live.map((s) => ({ s, n: s.words.filter((w) => hasWord(t, assistantNorm(w).trim())).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (a.s.scope === 'me' ? -1 : 1));
  if (skillHits.length) return { actionId: skillHits[0].s.actionId, skill: skillHits[0].s, alternatives: [] };
  const scored = actions.map((a) => ({ id: a.id, n: a.words.reduce((m, w) => m + (hasWord(t, assistantNorm(w).trim()) ? 1 + w.split(' ').length : 0), 0) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return { actionId: null, skill: null, alternatives: [] };
  const top = scored.filter((x) => x.n === scored[0].n);
  return { actionId: top.length === 1 ? top[0].id : null, skill: null, alternatives: (top.length === 1 ? scored.slice(1, 4) : top).map((x) => x.id) };
}

/**
 * Turns the instruction into a filled form for one action, with fixed rules only. Fills in this order and never over a
 * value already found: what the instruction says, the skill's values, the person's usual values. A field left empty
 * is listed in `missing` for the person (or the online step) to fill.
 */
export function assistantUnderstand(input: {
  text: string;
  today: IsoDate;
  actions: AssistantAction[];
  skills: AssistantSkill[];
  style: AssistantStyle | null;
  lists: AssistantLists;
  /** The person chose the action themselves. */
  actionId?: string | null;
}): AssistantDraft {
  const text = input.text.slice(0, ASSISTANT_RULE.maxTextChars);
  // When the job is already chosen, a skill for that job still fills its usual values.
  const pick = input.actionId
    ? { actionId: input.actionId, skill: assistantPick(text, input.actions, input.skills.filter((k) => k.actionId === input.actionId)).skill, alternatives: [] as string[] }
    : assistantPick(text, input.actions, input.skills);
  const action = input.actions.find((a) => a.id === pick.actionId) ?? null;
  const draft: AssistantDraft = { actionId: action?.id ?? null, alternatives: pick.alternatives, skillId: pick.skill?.id ?? null, values: {}, origins: {}, missing: [], notes: [] };
  if (!action) return draft;
  const t = assistantNorm(text);
  const style = input.style;
  const words = style?.words ?? [];
  const dates = assistantDates(text, input.today);
  const times = assistantTimes(text);
  const set = (name: string, v: unknown, o: AssistantOrigin) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || name in draft.values) return;
    draft.values[name] = v;
    draft.origins[name] = o;
  };
  for (const f of action.fields) {
    if (f.type === 'date' && dates.length) {
      let d = f.pick === 'last' ? dates[dates.length - 1] : dates[0];
      // A receipt or a payment is in the past: a date without a year that fell into next year is this year's.
      if (f.past && d > input.today) d = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
      set(f.name, d, 'said');
    }
    if (f.type === 'time' && times.length && !(f.pick === 'last' && times.length < 2 && action.fields.some((g) => g.type === 'time' && g.pick === 'first'))) set(f.name, f.pick === 'last' ? times[times.length - 1] : times[0], 'said');
    if (f.type === 'number') {
      const all = assistantNumbers(text.toLowerCase(), f.unit ?? 'hours');
      if (all.length) set(f.name, f.pick === 'last' ? all[all.length - 1] : all[0], 'said');
    }
    if (f.type === 'month') {
      const m = assistantMonth(text, input.today);
      if (m) set(f.name, m, 'said');
    }
    if (f.type === 'text' && f.pattern) {
      const re = f.pattern === 'staffNo' ? /\b([a-z]{2,6}o?\d{3,6})\b/i : /(\+?6?0\d[\d -]{7,12}\d)/;
      const m = re.exec(text);
      if (m) set(f.name, f.pattern === 'staffNo' ? m[1].toUpperCase() : m[1].replace(/\s+/g, ' ').trim(), 'said');
    }
    if (f.type === 'pick' && f.list) {
      const list = input.lists.pick?.[f.list] ?? [];
      if (list.length) set(f.name, assistantMatch(text, list, words, 'pick')?.id, 'said');
    }
    if (f.type === 'choice' && f.options) {
      // The option named by the most words wins; a tie is left for the person.
      const hit = f.options.map((o) => ({ o, n: o.words.filter((w) => hasWord(t, assistantNorm(w).trim())).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
      if (hit.length && (hit.length === 1 || hit[0].n > hit[1].n)) set(f.name, hit[0].o.value, 'said');
    }
    if (f.type === 'bool' && f.name === 'forNewSite' && /tapak baharu|tapak baru|new site|mula operasi/.test(t)) set(f.name, true, 'said');
    if (f.type === 'site' && input.lists.sites?.length) set(f.name, assistantMatch(text, input.lists.sites, words, 'site')?.id, 'said');
    if (f.type === 'receiver' && input.lists.receivers?.length) set(f.name, assistantMatch(text, input.lists.receivers, words, 'receiver')?.id, 'said');
    if (f.type === 'items' && input.lists.items?.length) {
      const lines = assistantItems(text, input.lists.items, words);
      set(f.name, lines.map(({ stockItemId, qty }) => ({ stockItemId, qty })), 'said');
      if (lines.length) draft.notes.push(...lines.map((l) => `"${l.said}" x ${l.qty}`));
    }
  }
  if (pick.skill) for (const [k, v] of Object.entries(pick.skill.values)) if (action.fields.some((f) => f.name === k)) set(k, v, 'skill');
  for (const [k, v] of Object.entries(style?.usual[action.id] ?? {})) {
    const f = action.fields.find((g) => g.name === k);
    // Dates, times and the person's own words are never carried from last time.
    if (f && (f.keep || ['choice', 'site', 'receiver', 'bool'].includes(f.type))) set(k, v, 'usual');
  }
  // The only one there is to choose (one company, one vehicle) is suggested, marked to check.
  for (const f of action.fields) {
    if (f.name in draft.values) continue;
    const list = f.type === 'pick' && f.list ? input.lists.pick?.[f.list] : f.type === 'site' ? input.lists.sites : f.type === 'receiver' ? input.lists.receivers : undefined;
    if ((f.required || f.single) && list?.length === 1) set(f.name, list[0].id, 'default');
    if (f.type === 'month' && f.required) set(f.name, input.today.slice(0, 7), 'default');
  }
  for (const f of action.fields) {
    if (!f.fromText || f.name in draft.values) continue;
    let v = text.trim();
    if (f.type === 'text') v = v.split(/[.\n]/)[0].slice(0, 120).trim();
    if (f.type === 'longtext' && style?.signOff && !v.endsWith(style.signOff)) v = `${v}\n${style.signOff}`;
    set(f.name, v, 'text');
  }
  // A leave of one day ends the day it starts.
  if (action.id === 'leave' && draft.values.from && !draft.values.to) set('to', draft.values.from, 'said');
  draft.missing = action.fields.filter((f) => f.required && !(f.name in draft.values)).map((f) => f.name);
  return draft;
}

/**
 * What the person's style learns from one sent form: their usual choices and, where they corrected the agent's pick of
 * a site, item or receiver, the words they used for it. Nothing is learned from a form that was not sent.
 */
export function assistantLearn(style: AssistantStyle, input: { actionId: string; text: string; sent: Record<string, unknown>; draft: AssistantDraft; labels?: Record<string, string>; at: string }): AssistantStyle {
  const action = ASSISTANT_ACTIONS.find((a) => a.id === input.actionId);
  if (!action) return style;
  const usual = { ...style.usual };
  const keep: Record<string, unknown> = {};
  for (const f of action.fields) if ((f.keep || ['choice', 'site', 'receiver', 'bool'].includes(f.type)) && f.type !== 'proof' && input.sent[f.name] !== undefined && input.sent[f.name] !== '') keep[f.name] = input.sent[f.name];
  usual[action.id] = keep;
  const ids = Object.keys(usual);
  if (ids.length > ASSISTANT_RULE.maxUsual) delete usual[ids[0]];
  let words = [...style.words];
  const t = assistantNorm(input.text);
  for (const f of action.fields) {
    if (f.type !== 'site' && f.type !== 'receiver' && f.type !== 'pick') continue;
    const sent = input.sent[f.name];
    if (typeof sent !== 'string' || !sent || sent === input.draft.values[f.name]) continue;
    // The person picked another one than the agent: remember the instruction's words that name it, if short.
    const label = input.labels?.[sent] ?? '';
    const said = tokens(label).find((k) => hasWord(t, k));
    if (said) words = [{ field: f.type, said, value: sent, label }, ...words.filter((w) => !(w.field === f.type && w.said === said))];
  }
  // Items the agent did not find: the word right after the quantity the person typed is their word for that item
  // ("10 pants" sent as 10 x Uniform trousers 32).
  const found = new Set(((input.draft.values.lines as { stockItemId: Id }[] | undefined) ?? []).map((l) => l.stockItemId));
  for (const l of Array.isArray(input.sent.lines) ? (input.sent.lines as { stockItemId?: unknown; qty?: unknown }[]) : []) {
    if (typeof l?.stockItemId !== 'string' || found.has(l.stockItemId)) continue;
    const m = new RegExp(` ${Number(l.qty)} (?:${QTY_WORDS.slice(3, -1)} )?([a-z][a-z-]{2,20}) `).exec(t);
    if (m && !GENERIC_ITEM.has(m[1])) words = [{ field: 'items', said: m[1], value: l.stockItemId, label: input.labels?.[l.stockItemId] ?? '' }, ...words.filter((w) => !(w.field === 'items' && w.said === m[1]))];
  }
  return { ...style, usual, words: words.slice(0, ASSISTANT_RULE.maxWords), updatedAt: input.at };
}
