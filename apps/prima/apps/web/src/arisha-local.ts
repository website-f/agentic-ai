import { tr, type Lang } from './i18n';
import { SCREEN_GUIDES, screenGuide, type GuideFocus, type ScreenGuide } from './arisha-screens';

/**
 * P90 (Fitri, 9 Nov 2026: "the Arisha response is really slow ... enhance the algorithm for a faster response"):
 * Arisha answers screen questions at once from the written screen guide (arisha-screens.data.ts), without asking the
 * AI. The quick buttons ("Teach me this screen", "What should I do now?", "Explain the words on this screen") and a
 * question that clearly matches a guide task, word, tab or screen are answered here, in a few milliseconds; anything
 * else, or "Ask Arisha more", still goes to the AI, with only the guides this matcher picks (GuideFocus) instead of
 * the whole menu. Deterministic: lower-case, accents and punctuation dropped, Malay work words mapped to the guide's
 * English, simple word endings dropped, then a weighted word overlap (task title, button names, steps) with a small
 * typo allowance. Static guide text only: no record values, names or other screen content are read or sent.
 */

export type QuickKey = 'q1' | 'q2' | 'q3';
export interface LocalChip { view: string; task: number; label: string }
export interface LocalReply {
  text: string;
  /** Guide tasks offered as buttons: pressing one shows its steps at once. */
  chips: LocalChip[];
}

// ---------------------------------------------------------------- words

const STOP = new Set(
  (
    'a an the to of on in at for from by with and or but is are am be been was were do does did done can could should would will ' +
    'shall may might must i me my mine we us our you your it its this that these those there here what which who whom whose ' +
    'how when where why please pls want need get got go going some any one thing things about into out up just also then than ' +
    'so if not no yes have has had let lets make sure way able know tell show me screen page app prima arisha ' +
    // Malay
    'saya aku kita kami anda awak kau dia nak hendak mahu mau ingin boleh bole macam mana bagaimana camne cara apa apakah ' +
    'ini itu tu di ke dari daripada dengan dgn untuk utk dan atau yang yg ada adalah tak tidak pun lah kah je sahaja saja ' +
    'sila tolong perlu patut harus kena dalam pada kat dekat sini situ nya bila jika kalau tentang mengenai skrin halaman ' +
    'muka sistem buat membuat ni camana mcm'
  ).split(' '),
);

/** Malay (and mixed) work words, after phrases are joined, to the guide's English words. */
const MS: Record<string, string> = {
  tambah: 'add', tambahkan: 'add', menambah: 'add', cipta: 'create', wujud: 'create', wujudkan: 'create', daftar: 'register enrol add',
  mendaftar: 'register enrol', padam: 'delete remove', buang: 'remove drop delete', hapus: 'delete remove', batal: 'cancel', batalkan: 'cancel',
  ubah: 'change edit', tukar: 'change switch', ubahsuai: 'change edit', kemaskini: 'update change', simpan: 'save', hantar: 'send submit',
  serah: 'submit hand', serahkan: 'submit hand', terima: 'accept receive', tolak: 'reject return refuse', kembalikan: 'return send back',
  pulangkan: 'return', lulus: 'approve', luluskan: 'approve', kelulusan: 'approval approve', sahkan: 'confirm verify', pengesahan: 'confirm verify',
  semak: 'check review', semakan: 'check review', periksa: 'check inspect', pemeriksaan: 'inspection check', cari: 'find search',
  lihat: 'see view look open', tengok: 'see view look', buka: 'open', tutup: 'close', cetak: 'print', imbas: 'scan', eksport: 'export',
  isi: 'fill', tulis: 'write', taip: 'type', tekan: 'press', klik: 'press click', pilih: 'choose pick', tetapkan: 'set', tanda: 'tick mark',
  tandakan: 'tick mark', rekod: 'record', merekod: 'record', catat: 'record log', mohon: 'apply request', memohon: 'apply request',
  permohonan: 'application request', tugas: 'duty task roster', jadual: 'roster schedule plan', syif: 'shift', pengawal: 'guard',
  tapak: 'site', pos: 'post', pelanggan: 'client', syarikat: 'company', cawangan: 'branch', kakitangan: 'staff people', staf: 'staff',
  pekerja: 'worker staff', kehadiran: 'attendance', hadir: 'present attendance', masuk: 'in', keluar: 'out', jam: 'clock hours',
  cuti: 'leave', gaji: 'pay salary payroll', tuntutan: 'claim', elaun: 'allowance', potongan: 'deduction', bayaran: 'payment pay',
  bayar: 'pay', invois: 'invoice', resit: 'receipt', laporan: 'report', mesyuarat: 'meeting', kes: 'case', aduan: 'complaint',
  insiden: 'incident', kecemasan: 'emergency', senjata: 'firearm arms', lesen: 'licence', dokumen: 'document', bukti: 'proof evidence',
  gambar: 'photo picture', foto: 'photo', kenderaan: 'vehicle', barang: 'item', barangan: 'item', peralatan: 'equipment', aset: 'asset',
  stok: 'stock', beli: 'buy purchase', pembelian: 'purchase procurement', perolehan: 'procurement', kontrak: 'contract', pengguna: 'user',
  akses: 'access', peranan: 'role', bahasa: 'language', minggu: 'week', hari: 'day', bulan: 'month', tahun: 'year', tarikh: 'date',
  masa: 'time', baru: 'new', baharu: 'new', semua: 'all', senarai: 'list', ringkasan: 'summary', butang: 'button', latihan: 'training',
  penilaian: 'appraisal', dasar: 'policy', polisi: 'policy', keselamatan: 'safety security', calon: 'applicant candidate',
  pendahuluan: 'advance', pinjaman: 'loan', asrama: 'hostel', pertukaran: 'transfer', jawatan: 'role position', log: 'log',
  rancang: 'plan', pelan: 'plan', penghantaran: 'delivery', kerja: 'work job', projek: 'project', mesin: 'device', peranti: 'device',
  telefon: 'phone', kata: 'word', istilah: 'word term', perkataan: 'word term', maksud: 'mean meaning', bermaksud: 'mean', erti: 'mean',
  tiada: 'missing', hilang: 'missing', kosong: 'empty', nombor: 'number', nama: 'name', alamat: 'address', muat: 'upload', turun: 'download',
  sijil: 'certificate', tamat: 'expiry end', luput: 'expiry expired', pembaharuan: 'renewal renew', baharui: 'renew', cukai: 'tax',
  akaun: 'account', kewangan: 'finance', pengarah: 'director', pengurus: 'manager', penyelia: 'supervisor', pegawai: 'officer',
  pelawat: 'visitor', ronda: 'patrol', rondaan: 'patrol', tanggungjawab: 'responsibility', tindakan: 'action', status: 'status',
  terbit: 'publish', terbitkan: 'publish', menerbitkan: 'publish', kunci: 'lock', bekerja: 'work', betul: 'fix correct', betulkan: 'fix correct',
  membetulkan: 'fix correct', baiki: 'fix repair', membaiki: 'fix repair', tugaskan: 'assign', menugaskan: 'assign', agih: 'assign',
  agihkan: 'assign', ganti: 'replace replacement', pengganti: 'replacement', lewat: 'late', ponteng: 'absent', cetakan: 'print',
  semalam: 'yesterday', kelmarin: 'yesterday', esok: 'tomorrow', kod: 'code', pindah: 'transfer move', hapuskan: 'delete', lupus: 'dispose', pelupusan: 'dispose',
};

/** Phrases joined before the words are read (Malay phrases first, then a few English ones). */
const PHRASES: [RegExp, string][] = [
  [/\bmuat naik\b/g, 'upload'], [/\bmuat turun\b/g, 'download'], [/\bkata laluan\b/g, 'password'], [/\bsebut harga\b/g, 'quote'],
  [/\bjadual tugas\b/g, 'roster'], [/\bhari ini\b/g, 'today'], [/\bkemas kini\b/g, 'update'], [/\bsenjata api\b/g, 'firearm'],
  [/\bpekerja asing\b/g, 'foreign worker'], [/\bjawatan kosong\b/g, 'vacancy'], [/\bkenaikan pangkat\b/g, 'promotion'],
  [/\bwang tunai\b/g, 'cash'], [/\bmaklum balas\b/g, 'feedback'], [/\bclock in\b/g, 'clock checkin'], [/\bclock out\b/g, 'clock checkout'],
  [/\bcheck in\b/g, 'checkin'], [/\bcheck out\b/g, 'checkout'], [/\bdaftar masuk\b/g, 'checkin'], [/\bdaftar keluar\b/g, 'checkout'],
  [/\bsign in\b/g, 'signin'], [/\blog masuk\b/g, 'signin'], [/\bsend back\b/g, 'return'], [/\btidak hadir\b/g, 'absent'],
  [/\btak hadir\b/g, 'absent'],
];

/** English words that should also find their near words in the guide. */
const SYN: Record<string, string> = {
  remove: 'delete drop', delete: 'remove', edit: 'change update', change: 'edit update', update: 'change edit', add: 'new create record',
  create: 'add new', new: 'add', view: 'see open', see: 'view open', find: 'search', search: 'find', approve: 'approval accept',
  reject: 'return refuse', pay: 'payment paid payroll', salary: 'pay payroll', staff: 'people person', employee: 'staff people',
  worker: 'staff', license: 'licence', licence: 'license', cancel: 'void', upload: 'attach', attach: 'upload', photo: 'picture',
  schedule: 'roster', timetable: 'roster', absent: 'absence', leave: 'absence', scan: 'scanner',
};

/** Accent marks left by NFD (U+0300 to U+036F), built from codes so the source stays plain ASCII. */
const MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const QUOTES = new RegExp(`['${String.fromCharCode(0x2019)}\`]`, 'g');

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS, '')
    .replace(QUOTES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The words of a guide text, for the index. */
function docWords(text: string): Set<string> {
  const out = new Set<string>();
  let s = normalise(text);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  for (const w of s.split(' ')) if (w.length > 1 && !STOP.has(w)) out.add(stem(w));
  return out;
}

/** Action words say less about what the person wants than the thing they name ("submit" a "claim"). */
const GENERIC = new Set(['add', 'submit', 'send', 'open', 'press', 'make', 'create', 'new', 'see', 'view', 'find', 'search', 'change', 'edit', 'update', 'record', 'use', 'check', 'look', 'give', 'take', 'put', 'start', 'list', 'all']);

/** One way a question word may appear in the guide, and how much a match on it counts (near words count less). */
interface Alt { w: string; f: number }
interface Group { alts: Alt[]; generic: boolean }

/** A question's words: each is a group of alternatives (the word itself, its English, its near words). */
function queryGroups(text: string): Group[] {
  let s = normalise(text);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const groups: Group[] = [];
  const seen = new Set<string>();
  for (const raw of s.split(' ')) {
    if (raw.length < 2 || STOP.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    const base = raw.length > 5 && raw.endsWith('kan') ? raw.slice(0, -3) : raw;
    const alts = new Map<string, number>([[stem(raw), 1]]);
    const put = (w: string, f: number) => alts.set(w, Math.max(alts.get(w) ?? 0, f));
    for (const w of [raw, base]) for (const e of (MS[w] ?? '').split(' ')) if (e) put(stem(e), 0.95);
    for (const [a, f] of [...alts]) for (const e of (SYN[a] ?? '').split(' ')) if (e) put(stem(e), f * 0.7);
    const list = [...alts].map(([w, f]) => ({ w, f }));
    groups.push({ alts: list, generic: list.some((a) => a.f >= 0.95 && GENERIC.has(a.w)) });
  }
  return groups;
}

/** One letter apart (changed, added or dropped). */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (i++, j++);
    else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else (i++, j++);
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How well one alternative matches a set of guide words: 1 exact, less for a shared start or a one-letter slip. */
function wordMatch(alt: string, words: Set<string>): number {
  if (words.has(alt)) return 1;
  let best = 0;
  for (const w of words) {
    const short = Math.min(alt.length, w.length);
    if (short >= 4 && (alt.startsWith(w) || w.startsWith(alt))) best = Math.max(best, 0.75);
    else if (short >= 5 && nearly(alt, w)) best = Math.max(best, 0.65);
  }
  return best;
}

// ---------------------------------------------------------------- the index

interface Doc {
  view: string;
  kind: 'task' | 'term' | 'screen' | 'tab';
  index: number;
  fields: { words: Set<string>; weight: number }[];
}

/** Quoted button and tab names in a text, with what they read on a Malay screen. */
function labelsOf(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"\n]{1,80})"/g)) {
    out.push(m[1]);
    const ms = tr(m[1], 'ms');
    if (ms !== m[1]) out.push(ms);
  }
  return out.join(' ');
}

let INDEX: { docs: Doc[]; idf: Map<string, number> } | null = null;
function index() {
  if (INDEX) return INDEX;
  const docs: Doc[] = [];
  for (const g of SCREEN_GUIDES) {
    g.tasks.forEach((t, i) => {
      const steps = t.steps.join(' ');
      docs.push({
        view: g.view,
        kind: 'task',
        index: i,
        fields: [
          { words: docWords(t.task), weight: 3 },
          { words: docWords(labelsOf(`${t.task} ${steps}`)), weight: 2 },
          { words: docWords(steps), weight: 1 },
          // The screen's own name ("Clock", "Roster") belongs to each of its how-tos.
          { words: docWords(`${g.title} ${tr(g.title, 'ms')}`), weight: 1 },
        ],
      });
    });
    g.terms.forEach((t, i) =>
      docs.push({ view: g.view, kind: 'term', index: i, fields: [{ words: docWords(t.term), weight: 3 }, { words: docWords(t.means), weight: 1 }] }),
    );
    g.tabs.forEach((t, i) =>
      docs.push({ view: g.view, kind: 'tab', index: i, fields: [{ words: docWords(`${t.name} ${tr(t.name, 'ms')}`), weight: 3 }, { words: docWords(t.what), weight: 1 }] }),
    );
    docs.push({ view: g.view, kind: 'screen', index: 0, fields: [{ words: docWords(`${g.title} ${tr(g.title, 'ms')}`), weight: 3 }, { words: docWords(g.what), weight: 1 }] });
  }
  // How rare each word is across the guide: "press" says little, "firearm" a lot.
  const df = new Map<string, number>();
  for (const d of docs) {
    const all = new Set<string>();
    for (const f of d.fields) for (const w of f.words) all.add(w);
    for (const w of all) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [w, c] of df) idf.set(w, Math.log(1 + n / (1 + c)));
  INDEX = { docs, idf };
  return INDEX;
}

interface Scored { doc: Doc; score: number; coverage: number; strong: number }

/** Every guide entry in the person's menu, scored against the question, best first. */
function rank(question: string, view: string, menu: string[], kinds: Doc['kind'][]): Scored[] {
  const { docs, idf } = index();
  const groups = queryGroups(question);
  if (!groups.length) return [];
  const weightOf = (g: Group) => Math.max(...g.alts.map((a) => idf.get(a.w) ?? 3.5)) * (g.generic ? 0.5 : 1);
  const total = groups.reduce((n, g) => n + weightOf(g), 0);
  const allowed = new Set(SCREEN_GUIDES.filter((g) => g.view === view || menu.includes(g.title)).map((g) => g.view));
  const out: Scored[] = [];
  for (const doc of docs) {
    if (!allowed.has(doc.view) || !kinds.includes(doc.kind)) continue;
    let score = 0;
    let covered = 0;
    let strong = 0;
    for (const g of groups) {
      let best = 0;
      let bestStrong = 0;
      for (const f of doc.fields) {
        let m = 0;
        for (const a of g.alts) m = Math.max(m, wordMatch(a.w, f.words) * a.f);
        best = Math.max(best, m * f.weight);
        if (f.weight >= 2 && !g.generic) bestStrong = Math.max(bestStrong, m);
      }
      if (best > 0) {
        const w = weightOf(g);
        score += best * w;
        covered += w * Math.min(1, best);
        if (bestStrong >= 0.75) strong++;
      }
    }
    if (score <= 0) continue;
    if (doc.view === view) score *= 1.35;
    out.push({ doc, score, coverage: covered / total, strong });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- what the question asks

const RE = {
  words: /\b(words?|terms?|istilah|perkataan|jargon)\b/,
  define: /\b(what does|what do|what is meant|meaning of|means?|maksud|bermaksud|erti|definition)\b/,
  teach: /\b(teach|explain|overview|tell me about|what is this|whats this|what can i do|ajar|terang|terangkan|apa ini|apakah ini|guna untuk apa|untuk apa|apa (skrin|screen|halaman|page)|(skrin|screen|halaman|page) apa)\b/,
  screen: /\b(screen|page|skrin|halaman|this|ini|ni)\b/,
  next: /\b(what should i do|what do i do now|what next|next step|apa (yang )?(perlu|patut|harus|nak) (saya )?buat|apa saya patut buat|langkah seterusnya|nak buat apa)\b/,
  missing: /\b(why|kenapa|mengapa|missing|cannot see|cant see|can t see|dont see|do not see|not showing|tak nampak|tidak nampak|tak jumpa|tidak jumpa|tiada|tak ada|tidak ada|hilang|empty|kosong|greyed|disabled)\b/,
  whatIs: /^(what is|what are|whats|apa itu|apakah)\b/,
  chat: /^(hi|hello|hai|helo|hey|thanks|thank you|thank|terima kasih|tq|ok|okay|baik|good|bagus|salam|assalamualaikum)\b/,
  thanks: /\b(thanks|thank|terima kasih|tq)\b/,
  where: /^(where|mana|di mana|kat mana|dekat mana)\b|\bwhere (do|can|is|are|to)\b|\b(di|kat|dekat) mana\b|\bmana nak\b|\bwhich (screen|page|menu)\b/,
  // Questions about the person's own records, numbers or drafts need the AI and its scoped tools.
  tools: /\b(summary|summari[sz]e|how many|count|total|berapa|ringkasan|jumlah|prepare|sediakan|draft (a|an|the|for)|draf (untuk|baru)|my (jobs|tasks|records|numbers)|status of|figures?|angka)\b/,
};

// ---------------------------------------------------------------- the answer's words

const F: Record<string, Record<Lang, string>> = {
  who: { en: 'Who uses it', ms: 'Siapa yang menggunakannya', mix: 'Siapa guna' },
  tabs: { en: 'Tabs across the top', ms: 'Tab di bahagian atas', mix: 'Tab di atas' },
  canDo: { en: 'What you can do here (tap one for the steps)', ms: 'Apa yang boleh dibuat di sini (tekan satu untuk melihat langkahnya)', mix: 'Apa boleh buat di sini (tekan satu untuk tengok step)' },
  missing: { en: 'If a button or list is missing', ms: 'Jika butang atau senarai tiada', mix: 'Kalau button atau list tak ada' },
  words: { en: 'Words on this screen', ms: 'Istilah di skrin ini', mix: 'Istilah di screen ini' },
  noWords: { en: 'This screen has no special words to explain.', ms: 'Skrin ini tiada istilah khas untuk diterangkan.', mix: 'Screen ini tak ada istilah khas untuk diterangkan.' },
  next: {
    en: 'I cannot see your records, so here is the usual work on this screen. Tap one for the steps.',
    ms: 'Saya tidak dapat melihat rekod anda, jadi ini kerja biasa di skrin ini. Tekan satu untuk melihat langkahnya.',
    mix: 'Saya tak boleh tengok rekod anda, jadi ini kerja biasa di screen ini. Tekan satu untuk tengok step.',
  },
  onOther: { en: 'This is on the **{screen}** screen. Open it from the menu (on a phone, under "{more}").', ms: 'Ini di skrin **{screen}**. Bukanya dari menu (di telefon, di bawah "{more}").', mix: 'Ini di screen **{screen}**. Buka dari menu (di phone, bawah "{more}").' },
  where: { en: 'Open **{screen}** from the menu (on a phone, under "{more}").', ms: 'Buka **{screen}** dari menu (di telefon, di bawah "{more}").', mix: 'Buka **{screen}** dari menu (di phone, bawah "{more}").' },
  tab: { en: 'Then press the "{tab}" tab at the top.', ms: 'Kemudian tekan tab "{tab}" di bahagian atas.', mix: 'Lepas itu tekan tab "{tab}" di atas.' },
  here: { en: 'You are on this screen now.', ms: 'Anda sedang berada di skrin ini.', mix: 'Anda tengah di screen ini.' },
  also: { en: 'Also see', ms: 'Lihat juga', mix: 'Tengok juga' },
  chat: {
    en: 'Hello. Ask me how to do something on this screen, or tap one of these.',
    ms: 'Hai. Tanya saya cara membuat sesuatu di skrin ini, atau tekan salah satu di bawah.',
    mix: 'Hai. Tanya saya cara buat sesuatu di screen ini, atau tekan salah satu di bawah.',
  },
  thanks: {
    en: 'You are welcome. Ask me how to do something on this screen, or tap one of these.',
    ms: 'Sama-sama. Tanya saya cara membuat sesuatu di skrin ini, atau tekan salah satu di bawah.',
    mix: 'Sama-sama. Tanya saya cara buat sesuatu di screen ini, atau tekan salah satu di bawah.',
  },
};
const f = (k: keyof typeof F, lang: Lang, vars: Record<string, string> = {}) => F[k][lang].replace(/\{(\w+)\}/g, (_, v: string) => vars[v] ?? '');

/** Guide text as the person's screen shows it: a whole sentence the table knows, else each quoted button name. */
function shown(text: string, lang: Lang): string {
  if (lang === 'en') return text;
  const whole = tr(text, lang);
  if (whole !== text) return whole;
  return text.replace(/"([^"\n]{1,80})"/g, (all, label: string) => {
    const t = tr(label, lang);
    return t && t !== label ? `"${t}"` : all;
  });
}
const titleOf = (g: ScreenGuide, lang: Lang) => tr(g.title, lang);
const chipsOf = (g: ScreenGuide, lang: Lang, max = 8): LocalChip[] => g.tasks.slice(0, max).map((t, i) => ({ view: g.view, task: i, label: shown(t.task, lang) }));

function teach(g: ScreenGuide, lang: Lang): LocalReply {
  const lines = [`**${titleOf(g, lang)}**`, shown(g.what, lang), `**${f('who', lang)}:** ${shown(g.who, lang)}`];
  if (g.tabs.length) lines.push(`**${f('tabs', lang)}:** ${g.tabs.map((t) => `"${tr(t.name, lang)}"`).join(', ')}`);
  if (g.notes) lines.push(`**${f('missing', lang)}:** ${shown(g.notes, lang)}`);
  lines.push(`**${f('canDo', lang)}:**`);
  return { text: lines.join('\n'), chips: chipsOf(g, lang) };
}

function words(g: ScreenGuide, lang: Lang): LocalReply {
  if (!g.terms.length) return { text: `${f('noWords', lang)}\n${shown(g.what, lang)}`, chips: chipsOf(g, lang, 4) };
  return { text: [`**${f('words', lang)}: ${titleOf(g, lang)}**`, ...g.terms.map((t) => `- **${shown(t.term, lang)}**: ${shown(t.means, lang)}`)].join('\n'), chips: [] };
}

function next(g: ScreenGuide, lang: Lang): LocalReply {
  const lines = [`**${titleOf(g, lang)}**`, f('next', lang)];
  if (g.notes) lines.push(`**${f('missing', lang)}:** ${shown(g.notes, lang)}`);
  return { text: lines.join('\n'), chips: chipsOf(g, lang) };
}

function missing(g: ScreenGuide, lang: Lang, related: LocalChip[]): LocalReply {
  return { text: [`**${f('missing', lang)}: ${titleOf(g, lang)}**`, shown(g.notes || g.who, lang), `**${f('who', lang)}:** ${shown(g.who, lang)}`].join('\n'), chips: related.length ? related : chipsOf(g, lang, 4) };
}

/** One how-to with its numbered steps; on another screen, where to open it first. */
export function taskReply(viewOfTask: string, task: number, openView: string, lang: Lang, also: LocalChip[] = []): LocalReply | null {
  const g = screenGuide(viewOfTask);
  const t = g?.tasks[task];
  if (!g || !t) return null;
  const lines: string[] = [];
  if (viewOfTask !== openView) lines.push(f('onOther', lang, { screen: titleOf(g, lang), more: tr('More', lang) }));
  lines.push(`**${shown(t.task, lang)}**`);
  t.steps.forEach((s, i) => lines.push(`${i + 1}. ${shown(s, lang)}`));
  return { text: lines.join('\n'), chips: also };
}

function where(g: ScreenGuide, openView: string, lang: Lang, tab?: string): LocalReply {
  const lines = [`**${titleOf(g, lang)}**: ${shown(g.what, lang)}`];
  lines.push(g.view === openView ? f('here', lang) : f('where', lang, { screen: titleOf(g, lang), more: tr('More', lang) }));
  if (tab) lines.push(f('tab', lang, { tab: tr(tab, lang) }));
  return { text: lines.join('\n'), chips: chipsOf(g, lang, 4) };
}

// ---------------------------------------------------------------- answering

/**
 * An answer from the screen guide, or null when the question needs the AI (it is about the person's own records,
 * asks for a draft or numbers, or matches nothing clearly). `quick` is the quick button pressed, if any.
 */
export function localAnswer(question: string, opts: { view: string; menu: string[]; lang: Lang; quick?: QuickKey }): LocalReply | null {
  const { view, menu, lang } = opts;
  const open = screenGuide(view);
  // Read for what is asked with the Malay "how" phrases made one word, so "macam mana nak ..." is not "where".
  const q = normalise(question).replace(/\b(macam mana|mcm mana|camana|bagaimana)\b/g, 'how');
  if (opts.quick === 'q1') return open ? teach(open, lang) : null;
  if (opts.quick === 'q2') return open ? next(open, lang) : null;
  if (opts.quick === 'q3') return open ? words(open, lang) : null;
  if (!q || q.split(' ').length > 30) return null;
  if (q.split(' ').length <= 3 && RE.chat.test(q)) return { text: f(RE.thanks.test(q) ? 'thanks' : 'chat', lang), chips: open ? chipsOf(open, lang, 4) : [] };

  // "What does X mean?" or "What is X?": a word from the guide, this screen's first.
  if ((RE.define.test(q) || RE.whatIs.test(q)) && !RE.words.test(q)) {
    const best = rank(question.replace(/\b(what does|what do|what is|what are|whats|mean[s]?|meaning of|apa itu|apakah|apa|maksud|bermaksud|erti)\b/gi, ' '), view, menu, ['term'])[0];
    if (best && best.coverage >= 0.6 && best.strong > 0) {
      const g = screenGuide(best.doc.view)!;
      const t = g.terms[best.doc.index];
      const line = `**${shown(t.term, lang)}**: ${shown(t.means, lang)}`;
      return { text: best.doc.view === view ? line : `${line}\n(${titleOf(g, lang)})`, chips: [] };
    }
  }
  if (RE.tools.test(q)) return null;
  if (open && RE.words.test(q) && (RE.screen.test(q) || q.split(' ').length <= 4)) return words(open, lang);
  if (open && RE.next.test(q)) return next(open, lang);

  const ranked = rank(question, view, menu, ['task']);
  // Most of the question found in one how-to, with at least one telling word in its title or button names; a how-to
  // on another screen needs two telling words (or nearly all of the question), so one shared word never sends the
  // person to the wrong screen.
  const confident = (s: Scored | undefined) =>
    !!s && s.score >= 2.5 && ((s.coverage >= 0.6 && s.strong >= 1) || (s.coverage >= 0.5 && s.strong >= 2)) && (s.doc.view === view || s.strong >= 2 || s.coverage >= 0.9);
  // A good how-to on the open screen comes before a slightly better one elsewhere.
  const here = ranked.find((s) => s.doc.view === view);
  const lead = here && here !== ranked[0] && confident(here) && here.score >= ranked[0].score * 0.75 ? here : ranked[0];
  const tasks = lead ? [lead, ...ranked.filter((s) => s !== lead)] : ranked;
  const top = tasks[0];
  const also = (from: Scored[]) =>
    from
      .slice(1)
      .filter((s) => s.score >= top!.score * 0.7 && s.coverage >= 0.5)
      .slice(0, 3)
      .map((s) => ({ view: s.doc.view, task: s.doc.index, label: `${shown(screenGuide(s.doc.view)!.tasks[s.doc.index].task, lang)}${s.doc.view === view ? '' : ` (${titleOf(screenGuide(s.doc.view)!, lang)})`}` }));

  if (RE.where.test(q)) {
    const places = rank(question, view, menu, ['screen', 'tab']);
    const p = places[0];
    if (p && p.coverage >= 0.6 && p.strong >= 1 && (!top || p.score >= top.score * 0.8 || !confident(top))) {
      const g = screenGuide(p.doc.view)!;
      return where(g, view, lang, p.doc.kind === 'tab' ? g.tabs[p.doc.index].name : undefined);
    }
    if (confident(top)) return taskReply(top!.doc.view, top!.doc.index, view, lang, also(tasks));
    return null;
  }
  if (confident(top)) {
    // A how-to on another screen that matches no better than one here: the one here.
    return taskReply(top!.doc.view, top!.doc.index, view, lang, also(tasks));
  }
  if (open && RE.missing.test(q) && (open.notes || open.who)) return missing(open, lang, top && top.coverage >= 0.5 ? [{ view: top.doc.view, task: top.doc.index, label: shown(screenGuide(top.doc.view)!.tasks[top.doc.index].task, lang) }] : []);
  if (open && RE.teach.test(q) && RE.screen.test(q)) return teach(open, lang);
  return null;
}

/** What the AI gets for a question the guide could not answer alone: the guides and how-tos that match it best. */
export function guideFocus(question: string, view: string, menu: string[]): GuideFocus {
  const tasks = rank(question, view, menu, ['task']).filter((s) => s.doc.view !== view && s.coverage >= 0.4).slice(0, 3);
  const places = rank(question, view, menu, ['screen', 'tab', 'term']).filter((s) => s.doc.view !== view && s.coverage >= 0.4);
  const views = [...new Set([...tasks.map((s) => s.doc.view), ...places.map((s) => s.doc.view)])].slice(0, 6);
  return { views, tasks: tasks.map((s) => ({ view: s.doc.view, task: s.doc.index })) };
}

/** Whether the question may skip Arisha's tools (it is about using a screen, not the person's records or drafts). */
export function guideOnly(question: string, focus: GuideFocus, view: string): boolean {
  const q = normalise(question);
  if (!q || RE.tools.test(q)) return false;
  return !!screenGuide(view) && (focus.tasks.length > 0 || RE.where.test(q) || RE.teach.test(q) || RE.words.test(q) || RE.define.test(q) || RE.missing.test(q) || /\b(how|cara|macam mana|bagaimana)\b/.test(q));
}


/** Builds the word index ahead of the first question (a few hundred milliseconds on a slow phone, once). */
export function warmGuideIndex(): void {
  index();
}

/**
 * The guide's best effort when the AI is too slow, failed or was stopped: the closest how-to if one matches at all,
 * else what the open screen is for and its how-tos. Null when there is no guide to show.
 */
export function fallbackAnswer(question: string, view: string, menu: string[], lang: Lang): LocalReply | null {
  const sure = localAnswer(question, { view, menu, lang });
  if (sure) return sure;
  const best = rank(question, view, menu, ['task']).find((s) => s.coverage >= 0.4);
  if (best) return taskReply(best.doc.view, best.doc.index, view, lang);
  const open = screenGuide(view);
  return open ? teach(open, lang) : null;
}
