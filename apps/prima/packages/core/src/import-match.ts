// P90: "Import from any file" (Fitri, 9 Nov 2026): the column matcher that runs in the browser, before anything is sent.
//
// Every office keeps its old records in its own spreadsheet: other column names (Malay, English, short forms, typos),
// another order, dates typed day-first or month-first or as Excel serials, a title above the table, a totals row under
// it, "Name (Passport)" in one column. Fitri asked for machine-learning style checking (numpy, pandas) that is fast. This
// is the same kind of work done in TypeScript, in the browser, with no network: for every field of the record and every
// column of the sheet it scores
//   (a) the header: words normalised and mapped to concepts through an English/Malay dictionary and short forms
//       ("No. Pasport", "Passport No", "Paspot" are one concept), then Jaro-Winkler for typos, and P81's own matcher;
//   (b) the values: a profile of the column (dates and their order, Excel serials, Malaysian IC, passport, phone, email,
//       money, number, plate, yes/no, country, a known list such as branch names, how unique, how filled) against
//       what the field holds (a date of birth is decades ago, an expiry is near today, a staff number is unique);
// then solves which column goes to which field for the whole sheet at once (the Hungarian method: each column used once,
// each field once, the best total), and gives every match a confidence. Low-confidence matches are flagged for the
// person to confirm. Nothing here is saved: the server checks every row through the record's own save afterwards.

import { COMPANY_FIELD, HEADER_WORDS, excelSerialDate, headerScore, matchOption, normBool, normHeader, normMoney, type AlignField, type MatchHow } from './import-align';

export type SmartHow = MatchHow | 'values' | 'remembered' | 'ai';
export type SmartLevel = 'sure' | 'likely' | 'check';

/** What a column's values mostly are. */
export type ValueKind =
  | 'date'
  | 'serial'
  | 'ic'
  | 'passport'
  | 'phone'
  | 'email'
  | 'money'
  | 'integer'
  | 'number'
  | 'plate'
  | 'bool'
  | 'country'
  | 'personName'
  | 'code'
  | 'text';

export interface ColumnProfile {
  index: number;
  header: string;
  /** Non-empty cells / rows. */
  fill: number;
  /** Distinct values / non-empty cells. */
  unique: number;
  /** Share of non-empty cells of each kind (a cell may count for more than one, e.g. an IC is also a code). */
  kinds: Partial<Record<ValueKind, number>>;
  /** The kind most cells are, when at least 60% are. */
  main: ValueKind | null;
  /** For day/month/year dates: which order the column uses ('dmy' unless a value proves 'mdy'). */
  dateOrder: 'dmy' | 'mdy' | null;
  /** True when no value tells day-first from month-first (all days 12 or under). */
  dateOrderGuessed: boolean;
  /** Median year of the dates, when the column has dates. */
  medianYear: number | null;
  /** Up to 3 non-empty values. */
  sample: string[];
  /** Up to 40 distinct non-empty values (for checking against a list of choices). Stays in the browser. */
  values: string[];
}

export interface SmartColumn {
  index: number;
  header: string;
  field: string | null;
  how: SmartHow | null;
  /** 0..1, the match's own score. */
  score: number;
  /** 0..1, the score less any doubt (a close second choice). */
  confidence: number;
  level: SmartLevel | null;
  /** Plain words: why this column was matched. */
  why: string;
  /** The next best fields for this column. */
  alternatives: { field: string; score: number }[];
  profile: ColumnProfile;
}

export interface SmartMatch {
  headerRow: number;
  columns: SmartColumn[];
  /** Required fields no column is matched to. */
  missing: string[];
  /** Matches the person should confirm. */
  toCheck: number;
}

// ---------- Words ----------

/**
 * Header words to concepts. English, Malay, short forms and common misspellings of one idea map to one concept, so
 * "Tkh Tamat Paspot", "Passport Expiry" and "Exp. Date (Passport)" all read as {passport, expiry, date}.
 */
const CONCEPT: Record<string, string> = {
  // numbers and codes
  no: 'number', num: 'number', number: 'number', nombor: 'number', nbr: 'number', nos: 'number',
  bil: 'rowno', sn: 'rowno', sr: 'rowno', item: 'item',
  // dates
  tarikh: 'date', tkh: 'date', trkh: 'date', date: 'date', dt: 'date', dated: 'date', on: 'date',
  lahir: 'birth', birth: 'birth', born: 'birth', dob: 'birth', kelahiran: 'birth', birthday: 'birth', umur: 'age', age: 'age',
  tamat: 'expiry', luput: 'expiry', expiry: 'expiry', expire: 'expiry', expires: 'expiry', expired: 'expiry', exp: 'expiry', expiration: 'expiry', until: 'expiry', sehingga: 'expiry', hingga: 'expiry', valid: 'expiry', end: 'end', ends: 'end', akhir: 'end',
  mula: 'start', start: 'start', starts: 'start', from: 'start', dari: 'start', effective: 'start', commencement: 'start', berkuatkuasa: 'start',
  keluar: 'issue', issue: 'issue', issued: 'issue', dikeluarkan: 'issue', isu: 'issue',
  masuk: 'join', join: 'join', joined: 'join', joining: 'join', lantikan: 'join', hired: 'join', hire: 'join', berkhidmat: 'join', lapor: 'join', arrival: 'join', tiba: 'join', kedatangan: 'join',
  beli: 'bought', bought: 'bought', purchase: 'bought', purchased: 'bought', pembelian: 'bought', acquired: 'bought',
  waranti: 'warranty', warranty: 'warranty', jaminan: 'warranty',
  // people
  nama: 'name', name: 'name', names: 'name', penuh: 'full', full: 'full',
  pekerja: 'worker', worker: 'worker', workers: 'worker', employee: 'worker', emp: 'worker', staf: 'worker', staff: 'worker', kakitangan: 'worker', pkj: 'worker', buruh: 'worker',
  pengawal: 'guard', guard: 'guard', guards: 'guard',
  ic: 'ic', kp: 'ic', nric: 'ic', mykad: 'ic', pengenalan: 'ic', identity: 'ic',
  pasport: 'passport', paspot: 'passport', passport: 'passport', passpor: 'passport', pspt: 'passport', ppt: 'passport', pp: 'passport',
  permit: 'permit', plks: 'permit', pls: 'permit', visa: 'permit', vp: 'permit', pas: 'permit', lawatan: 'permit', kerja: 'work', work: 'work',
  fomema: 'fomema', perubatan: 'medical', medical: 'medical', medic: 'medical',
  spikpa: 'spikpa', hospital: 'hospital',
  warganegara: 'nationality', kewarganegaraan: 'nationality', nationality: 'nationality', citizenship: 'nationality', negara: 'nationality', country: 'nationality', asal: 'nationality',
  jantina: 'gender', gender: 'gender', sex: 'gender',
  telefon: 'phone', tel: 'phone', phone: 'phone', hp: 'phone', handphone: 'phone', mobile: 'phone', telephone: 'phone', contact: 'phone', hubungi: 'phone',
  emel: 'email', email: 'email', mail: 'email',
  alamat: 'address', address: 'address',
  syarikat: 'company', company: 'company', majikan: 'company', employer: 'company', entity: 'company', entiti: 'company',
  cawangan: 'branch', branch: 'branch', pejabat: 'branch', office: 'branch',
  // things
  jenama: 'brand', brand: 'brand', make: 'brand', model: 'model',
  siri: 'serial', serial: 'serial', sno: 'serial',
  tag: 'tag', aset: 'asset', asset: 'asset', assets: 'asset', inventori: 'asset', inventory: 'asset',
  jenis: 'kind', type: 'kind', kind: 'kind', kategori: 'kind', category: 'kind',
  lokasi: 'location', location: 'location', tempat: 'location', bilik: 'location', room: 'location',
  harga: 'cost', price: 'cost', cost: 'cost', kos: 'cost', nilai: 'cost', value: 'cost',
  pembekal: 'supplier', supplier: 'supplier', vendor: 'supplier', vendors: 'supplier',
  akaun: 'account', account: 'account', acc: 'account', acct: 'account', ac: 'account',
  bank: 'bank',
  ssm: 'ssm', roc: 'ssm', brn: 'ssm', pendaftaran: 'registration', registration: 'registration', reg: 'registration',
  cuti: 'holiday', holiday: 'holiday', holidays: 'holiday', perayaan: 'holiday', umum: 'public', public: 'public',
  negeri: 'state', state: 'state', states: 'state',
  catatan: 'note', note: 'note', notes: 'note', remarks: 'note', remark: 'note', ulasan: 'note',
  plat: 'plate', plate: 'plate', kenderaan: 'vehicle', vehicle: 'vehicle',
  insurans: 'insurance', insurance: 'insurance', takaful: 'insurance',
  model_: 'model',
};

/** Words that say nothing about the field on their own. */
const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'to', 'for', 'by', 'dan', 'atau', 'di', 'ke', 'bagi', 'yang', 'per', 'rm', 'myr']);

function conceptsOf(s: string): string[] {
  return normHeader(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => CONCEPT[w] ?? w);
}

/** Jaro-Winkler similarity, 0..1 (typos and short forms of one word: "paspot" and "passport"). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      m++;
      break;
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < Math.min(4, a.length, b.length) && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Two word lists alike as bags of concepts (soft: a typo still counts), Dice coefficient 0..1. */
function conceptDice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Array<boolean>(b.length).fill(false);
  let hit = 0;
  for (const x of a) {
    let best = -1;
    let bestS = 0;
    b.forEach((y, j) => {
      if (used[j]) return;
      const s = x === y ? 1 : x.length >= 4 && y.length >= 4 ? jaroWinkler(x, y) : 0;
      if (s > bestS) {
        bestS = s;
        best = j;
      }
    });
    if (best >= 0 && bestS >= 0.88) {
      used[best] = true;
      hit += bestS;
    }
  }
  return (2 * hit) / (a.length + b.length);
}

/** More words for P90's new import fields, by key (the P81 table in import-align.ts holds the rest). */
export const MORE_HEADER_WORDS: Record<string, string[]> = {
  passportNo: ['passport', 'passport no', 'passport number', 'no pasport', 'no passport', 'no paspot', 'nombor pasport', 'pasport'],
  passportExpiresOn: ['passport expiry', 'passport expiry date', 'tarikh tamat pasport', 'tamat pasport', 'pasport tamat', 'passport valid until', 'luput pasport'],
  passportIssuedOn: ['passport issue date', 'tarikh keluar pasport', 'passport issued'],
  permitNo: ['permit no', 'plks no', 'no plks', 'no permit', 'vp tem no', 'work permit no', 'no pas lawatan kerja'],
  permitExpiresOn: ['permit expiry', 'plks expiry', 'tamat plks', 'tarikh tamat plks', 'tamat permit', 'work permit expiry', 'vp tem expiry', 'pas tamat', 'plks tamat'],
  permitIssuedOn: ['permit issue date', 'plks issue date', 'tarikh keluar plks'],
  fomemaExpiresOn: ['fomema', 'fomema expiry', 'fomema date', 'tarikh fomema', 'medical expiry', 'tamat fomema', 'pemeriksaan perubatan'],
  insuranceExpiresOn: ['insurance expiry', 'fw insurance', 'tamat insurans', 'insurans pekerja asing', 'foreign worker insurance', 'insurans'],
  spikpaExpiresOn: ['spikpa', 'spikpa expiry', 'tamat spikpa', 'hospital insurance'],
  branch: ['branch', 'cawangan', 'office', 'pejabat', 'state office'],
  serial: ['serial', 'serial no', 'serial number', 'no siri', 's n', 'sn', 'service tag'],
  warrantyTo: ['warranty', 'warranty until', 'warranty expiry', 'tamat waranti', 'waranti hingga'],
  ssmNo: ['ssm', 'ssm no', 'roc', 'roc no', 'company no', 'registration no', 'no pendaftaran syarikat', 'brn', 'business registration'],
  bankAccount: ['bank account', 'account no', 'no akaun', 'akaun bank', 'acc no', 'account number'],
  categories: ['category', 'categories', 'kategori', 'supplies', 'bekalan', 'jenis bekalan'],
  coiDeclared: ['conflict of interest', 'coi', 'coi declared', 'percanggahan kepentingan'],
  abcAck: ['anti bribery', 'abc', 'abc acknowledged', 'anti rasuah', 'rasuah'],
  date: ['date', 'tarikh', 'holiday date', 'tarikh cuti'],
  states: ['states', 'state', 'negeri', 'for states', 'negeri terlibat'],
  model: ['model', 'make and model', 'jenama model', 'brand model', 'device'],
};

const wordsFor = (f: AlignField) => [...(f.words ?? []), ...(HEADER_WORDS[f.key] ?? []), ...(MORE_HEADER_WORDS[f.key] ?? [])];

/** Each field's words, normalised and as concepts, worked out once. */
const FIELD_WORDS = new WeakMap<AlignField, { concepts: string[][]; plain: string[]; withMore: AlignField }>();
function fieldWords(f: AlignField) {
  let w = FIELD_WORDS.get(f);
  if (!w) {
    const all = [f.key, f.label, f.label.replace(/\(.*?\)/g, ''), ...wordsFor(f)];
    w = {
      concepts: all.map(conceptsOf),
      plain: [normHeader(f.label), ...wordsFor(f).map(normHeader)].filter((x) => x.length >= 5),
      withMore: { ...f, words: [...(f.words ?? []), ...(MORE_HEADER_WORDS[f.key] ?? [])] },
    };
    FIELD_WORDS.set(f, w);
  }
  return w;
}

/** Results by header and field: a sheet asks the same pair many times (header row search, matching, sheet choice). */
const HEADER_CACHE = new Map<string, [number, MatchHow] | null>();

/** How well a header names a field: [score 0..1, how], or null. */
export function headerMatch(header: string, f: AlignField): [number, MatchHow] | null {
  const h = normHeader(header);
  if (!h) return null;
  const key = `${h}\u0000${f.key}\u0000${f.label}\u0000${(f.words ?? []).join('|')}`;
  const hit = HEADER_CACHE.get(key);
  if (hit !== undefined) return hit;
  const out = headerMatchUncached(header, h, f);
  if (HEADER_CACHE.size > 20_000) HEADER_CACHE.clear();
  HEADER_CACHE.set(key, out);
  return out;
}

function headerMatchUncached(header: string, h: string, f: AlignField): [number, MatchHow] | null {
  const fw = fieldWords(f);
  const p81 = headerScore(header, fw.withMore);
  const hc = conceptsOf(h);
  let best = 0;
  for (const wc of fw.concepts) {
    const d = conceptDice(hc, wc);
    if (d > best) best = d;
  }
  // Whole-header typo against the field's own words ("Nationalty").
  let jw = 0;
  if (h.length >= 5) for (const w of fw.plain) jw = Math.max(jw, jaroWinkler(h, w));
  const concept = best >= 0.6 ? 0.55 + 0.4 * best : 0;
  const typo = jw >= 0.9 ? 0.8 * jw : 0;
  const top = Math.max(p81?.[0] ?? 0, concept, typo);
  if (top < 0.45) return null;
  if (p81 && p81[0] >= top - 1e-9) return p81;
  return [top, concept >= typo ? 'synonym' : 'fuzzy'];
}

// ---------- Values ----------

const IC_RE = /^\d{6}-?\d{2}-?\d{4}$/;
/** Passports as Nepal, Indonesia, Bangladesh and Malaysia print them: one or two letters, then 6 to 9 digits. */
const PASSPORT_RE = /^[A-Z]{1,2}\d{6,9}[A-Z]?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PLATE_RE = /^[A-Z]{1,3}\s?\d{1,4}\s?[A-Z]{0,3}$/;
const DMY_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
const YMD_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const MONTH_WORD = /^(\d{1,2})[\s\-/.]*(jan|feb|mar|mac|apr|may|mei|jun|jul|aug|ogo|sep|oct|okt|nov|dec|dis)[a-z]*[\s\-/.,]*(\d{2}|\d{4})$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-.]+(\d{1,2}),?[\s\-.]+(\d{4})$/i;

/** Country names, adjectives and codes offices write for nationality. */
export const COUNTRY_WORDS: Record<string, string> = {
  malaysia: 'MY', malaysian: 'MY', my: 'MY', mys: 'MY', warganegara: 'MY', 'warganegara malaysia': 'MY', melayu: 'MY',
  nepal: 'NP', nepali: 'NP', nepalese: 'NP', np: 'NP', npl: 'NP',
  indonesia: 'ID', indonesian: 'ID', indon: 'ID', idn: 'ID',
  bangladesh: 'BD', bangladeshi: 'BD', bd: 'BD', bgd: 'BD',
  myanmar: 'MM', burma: 'MM', burmese: 'MM', mm: 'MM',
  india: 'IN', indian: 'IN', ind: 'IN',
  pakistan: 'PK', pakistani: 'PK', pk: 'PK',
  vietnam: 'VN', vietnamese: 'VN', vn: 'VN',
  philippines: 'PH', filipino: 'PH', ph: 'PH',
  'sri lanka': 'LK', srilanka: 'LK', 'sri lankan': 'LK', lk: 'LK',
  cambodia: 'KH', thailand: 'TH', thai: 'TH', china: 'CN', chinese: 'CN',
};

function cellKinds(v: string): ValueKind[] {
  const s = v.trim();
  const up = s.toUpperCase();
  const out: ValueKind[] = [];
  const bare = up.replace(/[\s-]/g, '');
  if (IC_RE.test(s)) out.push('ic');
  if (!IC_RE.test(s) && PASSPORT_RE.test(bare)) out.push('passport');
  if (EMAIL_RE.test(s)) out.push('email');
  if (/^(\+?60|0)1\d{7,9}$/.test(s.replace(/[\s()-]/g, '')) || /^(\+?60|0)[3-9]\d{7,8}$/.test(s.replace(/[\s()-]/g, '')) || /^\+\d{9,14}$/.test(s.replace(/[\s()-]/g, ''))) out.push('phone');
  if (DMY_RE.test(s) || YMD_RE.test(s) || MONTH_WORD.test(s) || /^\d{4}-\d{2}-\d{2}[T ]/.test(s)) out.push('date');
  if (/^\d{5}(\.\d+)?$/.test(s) && excelSerialDate(Number(s)) !== null) out.push('serial');
  if (/^(rm|myr)\s?-?[\d,]+(\.\d{1,2})?$/i.test(s) || /^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s) || /^-?\d+\.\d{2}$/.test(s)) out.push('money');
  if (/^-?\d+$/.test(s)) out.push('integer');
  if (normMoney(s) !== null) out.push('number');
  if (PLATE_RE.test(up) && /[A-Z]/.test(up) && /\d/.test(up) && !/^\d/.test(up) && !/^[A-Z]{1,2}\d{6,}$/.test(bare)) out.push('plate');
  if (normBool(s) !== null && !/^\d$/.test(s)) out.push('bool');
  if (COUNTRY_WORDS[normHeader(s)]) out.push('country');
  if (/^[\p{L}][\p{L}'.@/-]*(\s+[\p{L}][\p{L}'.@/-]*){1,7}$/u.test(s) && !/\d/.test(s) && s.length <= 80 && !COUNTRY_WORDS[normHeader(s)]) out.push('personName');
  if (/^[A-Z0-9][A-Z0-9/._-]{1,30}$/i.test(s) && /\d/.test(s) && !/\s/.test(s)) out.push('code');
  if (!out.length) out.push('text');
  return out;
}

/** Day-first or month-first, from the values: a day over 12 in either place settles it. */
export function dateOrderOf(values: string[]): { order: 'dmy' | 'mdy' | null; guessed: boolean } {
  let a12 = 0;
  let b12 = 0;
  let any = 0;
  for (const v of values) {
    const m = DMY_RE.exec(v.trim());
    if (!m) continue;
    any++;
    if (+m[1] > 12) a12++;
    if (+m[2] > 12) b12++;
  }
  if (!any) return { order: null, guessed: false };
  if (b12 > 0 && a12 === 0) return { order: 'mdy', guessed: false };
  return { order: 'dmy', guessed: a12 === 0 };
}

/** A date in this column's order, to ISO; Excel serials too. null when it is not a date on the calendar. */
export function isoDateOf(raw: string, order: 'dmy' | 'mdy' | null = 'dmy'): string | null {
  const v = String(raw ?? '').trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i, '').replace(/T\d{2}:\d{2}.*$/, '');
  if (!v) return null;
  const m = DMY_RE.exec(v);
  if (m) {
    const y = m[3].length === 2 ? (Number(m[3]) < 50 ? 2000 + Number(m[3]) : 1900 + Number(m[3])) : Number(m[3]);
    const [d, mo] = order === 'mdy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return calendar(y, mo, d);
  }
  const y = YMD_RE.exec(v);
  if (y) return calendar(+y[1], +y[2], +y[3]);
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelSerialDate(Number(v));
  // "1 Mac 2027", "Mar 1, 2027": the P81 reader.
  return null;
}

function calendar(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

/** A profile of one column's values: what they are, how unique, how filled. Reads up to 300 cells (fast on any sheet). */
export function profileColumn(index: number, header: string, values: string[]): ColumnProfile {
  const all = values.slice(0, 300).map((v) => String(v ?? '').trim());
  const filled = all.filter(Boolean);
  const counts: Partial<Record<ValueKind, number>> = {};
  for (const v of filled) for (const k of new Set(cellKinds(v))) counts[k] = (counts[k] ?? 0) + 1;
  const kinds: Partial<Record<ValueKind, number>> = {};
  for (const [k, n] of Object.entries(counts)) kinds[k as ValueKind] = filled.length ? n! / filled.length : 0;
  const order = dateOrderOf(filled);
  const years: number[] = [];
  for (const v of filled) {
    const iso = isoDateOf(v, order.order ?? 'dmy');
    if (iso && (DMY_RE.test(v) || YMD_RE.test(v) || (kinds.serial ?? 0) >= 0.6)) years.push(Number(iso.slice(0, 4)));
  }
  years.sort((a, b) => a - b);
  // The main kind: most specific first, so an IC column is "ic", not "code".
  const SPECIFIC: ValueKind[] = ['email', 'ic', 'date', 'serial', 'phone', 'plate', 'passport', 'money', 'bool', 'country', 'integer', 'number', 'code', 'personName', 'text'];
  const main = filled.length ? (SPECIFIC.find((k) => (kinds[k] ?? 0) >= 0.6) ?? null) : null;
  return {
    index,
    header,
    fill: all.length ? filled.length / all.length : 0,
    unique: filled.length ? new Set(filled.map((v) => v.toLowerCase())).size / filled.length : 0,
    kinds,
    main,
    dateOrder: order.order,
    dateOrderGuessed: order.guessed,
    medianYear: years.length ? years[Math.floor(years.length / 2)] : null,
    sample: filled.slice(0, 3),
    values: [...new Set(filled)].slice(0, 40),
  };
}

const share = (p: ColumnProfile, ...ks: ValueKind[]) => Math.min(1, Math.max(...ks.map((k) => p.kinds[k] ?? 0)));

/** What sort of value a field holds, from its type and key. */
type Want = 'date' | 'birth' | 'expiry' | 'past' | 'idFull' | 'passport' | 'phone' | 'email' | 'plate' | 'number' | 'bool' | 'choice' | 'country' | 'personName' | 'code' | 'list' | 'text';

function wantOf(f: AlignField): Want {
  const k = f.key;
  if (f.type === 'date' || /On$|Due$|Expiry$/.test(k) || k === 'date' || k === 'dob' || k === 'roadTax' || k === 'insurance' || k === 'puspakom' || k === 'permit' || k === 'warrantyTo') {
    if (k === 'dob') return 'birth';
    if (/expir|Expires|warranty|endOn|EndsOn|Due|roadTax|insurance|puspakom|permit$|validUntil/i.test(k)) return 'expiry';
    if (/hired|bought|issued|startOn|startsOn|incident|joined/i.test(k)) return 'past';
    return 'date';
  }
  if (f.type === 'number') return 'number';
  if (f.type === 'bool') return 'bool';
  if (k === 'idFull') return 'idFull';
  if (/passport/i.test(k)) return 'passport';
  if (/phone/i.test(k)) return 'phone';
  if (/email/i.test(k)) return 'email';
  if (k === 'plate') return 'plate';
  if (k === 'nationality') return 'country';
  if (f.type === 'select' || (f.type === 'ref' && f.options?.length)) return 'choice';
  if (k === 'name' || k === 'emergencyName' || k === 'keeper' || k === 'contact') return 'personName';
  if (/^(staffNo|code|tag|serial|sku|reference|policyNo|ref|ssmNo|signedRef|permitNo|bankAccount.*|epfNo|socsoNo|taxNo|ext|tagCode)$/.test(k)) return 'code';
  if (k === 'sites' || k === 'states' || k === 'categories') return 'list';
  return 'text';
}

const THIS_YEAR = new Date().getUTCFullYear();

/** 0..1: how well a column's values fit a field. `distinct` says the fit alone may place the column. */
export function valueFit(p: ColumnProfile, f: AlignField): { fit: number; distinct: boolean } {
  if (p.fill === 0) return { fit: 0, distinct: false };
  const want = wantOf(f);
  const dates = share(p, 'date', 'serial');
  const typed = Math.max(dates, share(p, 'email', 'ic', 'phone', 'money'));
  switch (want) {
    case 'birth':
    case 'expiry':
    case 'past':
    case 'date': {
      if (dates < 0.5) return { fit: dates * 0.5, distinct: false };
      const y = p.medianYear;
      let age = 0.75;
      if (y !== null) {
        if (want === 'birth') age = y <= THIS_YEAR - 16 && y >= THIS_YEAR - 75 ? 1 : 0.25;
        else if (want === 'expiry') age = y >= THIS_YEAR - 3 && y <= THIS_YEAR + 12 ? 1 : y < THIS_YEAR - 16 ? 0.15 : 0.55;
        else if (want === 'past') age = y <= THIS_YEAR + 1 && y >= THIS_YEAR - 45 ? 0.95 : 0.4;
      }
      return { fit: dates * age, distinct: want !== 'date' && age >= 0.95 };
    }
    case 'idFull':
      return { fit: Math.max(share(p, 'ic'), share(p, 'passport') * 0.9), distinct: true };
    case 'passport':
      return { fit: share(p, 'passport') * (p.unique > 0.8 ? 1 : 0.7), distinct: share(p, 'ic') < 0.2 };
    case 'phone':
      return { fit: share(p, 'phone'), distinct: true };
    case 'email':
      return { fit: share(p, 'email'), distinct: true };
    case 'plate':
      return { fit: share(p, 'plate'), distinct: true };
    case 'number':
      return { fit: dates > 0.5 && share(p, 'serial') < 0.5 ? 0.1 : share(p, 'number'), distinct: share(p, 'money') >= 0.8 && /\bRM\b/.test(f.label) };
    case 'bool':
      return { fit: share(p, 'bool'), distinct: share(p, 'bool') >= 0.9 };
    case 'country':
      return { fit: share(p, 'country'), distinct: true };
    case 'choice': {
      const opts = f.options ?? [];
      if (!opts.length) return { fit: 0.4, distinct: false };
      const vals = p.values;
      if (!vals.length) return { fit: 0.3, distinct: false };
      const hits = vals.filter((v) => matchOption(v, opts) !== null).length / vals.length;
      return { fit: typed > 0.6 ? 0.05 : hits, distinct: hits >= 1 && opts.length <= 40 };
    }
    case 'personName':
      return { fit: typed > 0.5 ? 0.05 : share(p, 'personName') * (0.6 + 0.4 * p.unique), distinct: false };
    case 'code':
      return { fit: typed > 0.6 && share(p, 'ic') < 0.5 ? 0.15 : Math.max(share(p, 'code', 'integer', 'ic', 'passport'), 0.3) * (0.5 + 0.5 * p.unique), distinct: false };
    case 'list':
      return { fit: typed > 0.5 ? 0.1 : 0.5, distinct: false };
    default:
      return { fit: typed > 0.6 ? 0.15 : 0.55, distinct: false };
  }
}

// ---------- Assignment ----------

/**
 * Hungarian method (Kuhn-Munkres, O(n^3)) on a rectangular score matrix: the assignment of rows to columns with the
 * highest total score. Returns, for each row, the column it gets (or -1).
 */
export function bestAssignment(score: number[][]): number[] {
  const rows = score.length;
  const cols = rows ? score[0].length : 0;
  const n = Math.max(rows, cols);
  if (!n) return [];
  // Costs as 1 - score, padded to a square with cost 1 (no match).
  const cost = (i: number, j: number) => (i < rows && j < cols ? 1 - score[i][j] : 1);
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] && p[j] <= rows && j <= cols) out[p[j] - 1] = j - 1;
  return out;
}

/** Below this a column is left unused. */
const MIN_SCORE = 0.42;

function combine(h: [number, MatchHow] | null, fit: { fit: number; distinct: boolean }, fillRate: number): { score: number; how: SmartHow } | null {
  if (h) {
    // The header leads; the values confirm it, or pull it down when they plainly disagree (a "Tarikh" column of names).
    const s = h[0] * 0.72 + fit.fit * 0.28 - (fit.fit < 0.2 && fillRate > 0 ? 0.12 : 0);
    return { score: Math.max(0, Math.min(1, s)), how: h[1] };
  }
  if (fit.distinct && fit.fit >= 0.8) return { score: 0.38 + 0.3 * fit.fit, how: 'values' };
  return null;
}

/**
 * Match the columns of a sheet to a record's fields. `options` adds the lists a column may be checked against (branch
 * names, site codes) by field key. `remembered` is a column-header to field map the person confirmed before for the
 * same layout: those columns are matched first, as they were.
 */
export function smartMatch(
  table: string[][],
  fields: AlignField[],
  opt: { headerRow?: number | null; remembered?: Record<string, string> | null } = {},
): SmartMatch {
  const headerRow = opt.headerRow ?? findHeader(table, fields);
  const head = composeHeader(table, headerRow);
  const body = table.slice(headerRow + 1);
  const width = Math.max(head.length, ...body.map((r) => r.length), 0);
  const header = Array.from({ length: width }, (_, i) => String(head[i] ?? '').trim());
  const profiles = header.map((h, i) => profileColumn(i, h, body.map((r) => r[i] ?? '')));
  const pairs: { score: number; how: SmartHow }[][] = header.map(() => []);
  const matrix: number[][] = header.map((h, c) =>
    fields.map((f, j) => {
      const m = combine(headerMatch(h, f), valueFit(profiles[c], f), profiles[c].fill);
      pairs[c][j] = m ?? { score: 0, how: 'values' };
      // A "No." or "Bil" counter column is never a field.
      if (/^(bil|no|n|#|sn|s no|sr|item|nombor)$/.test(normHeader(h)) && share(profiles[c], 'integer') >= 0.9) return 0;
      return m && m.score >= MIN_SCORE ? m.score : 0;
    }),
  );
  // Remembered layout: those pairs score 1 and their column and field are out of the contest.
  const fixed = new Map<number, number>();
  if (opt.remembered)
    header.forEach((h, c) => {
      const key = opt.remembered![normHeader(h)];
      const j = key ? fields.findIndex((f) => f.key === key) : -1;
      if (j >= 0 && ![...fixed.values()].includes(j)) fixed.set(c, j);
    });
  for (const [c, j] of fixed) {
    matrix[c] = matrix[c].map((_, jj) => (jj === j ? 1 : 0));
    matrix.forEach((row, cc) => {
      if (cc !== c) row[j] = 0;
    });
  }
  const assigned = bestAssignment(matrix);
  const columns: SmartColumn[] = header.map((h, c) => {
    const j = assigned[c];
    const alternatives = fields
      .map((f, jj) => ({ field: f.key, score: Math.round(matrix[c][jj] * 100) / 100 }))
      .filter((x, jj) => jj !== j && x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (j < 0 || matrix[c][j] < MIN_SCORE) return { index: c, header: h, field: null, how: null, score: 0, confidence: 0, level: null, why: whyNot(profiles[c]), alternatives, profile: profiles[c] };
    const f = fields[j];
    const score = matrix[c][j];
    const remembered = fixed.has(c);
    // Doubt: another field this column could be, or another column this field could be, close behind.
    const otherField = Math.max(0, ...matrix[c].filter((_, jj) => jj !== j));
    const otherCol = Math.max(0, ...matrix.filter((_, cc) => cc !== c).map((r) => r[j]));
    const margin = score - Math.max(otherField, otherCol);
    let confidence = remembered ? 1 : Math.max(0, score - Math.max(0, 0.12 - margin));
    // A date column whose day and month cannot be told apart is read day-first, as in Malaysia: say so.
    if (profiles[c].dateOrderGuessed && f.type === 'date' && share(profiles[c], 'date') >= 0.6) confidence = Math.min(confidence, 0.79);
    const level: SmartLevel = confidence >= 0.8 ? 'sure' : confidence >= 0.62 ? 'likely' : 'check';
    const how: SmartHow = remembered ? 'remembered' : pairs[c][j].how;
    return {
      index: c,
      header: h,
      field: f.key,
      how,
      score: Math.round(score * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      level,
      why: whyMatch(how, profiles[c], f),
      alternatives,
      profile: profiles[c],
    };
  });
  const used = new Set(columns.map((c) => c.field).filter(Boolean));
  const missing = fields.filter((f) => f.required && !used.has(f.key)).map((f) => f.key);
  return { headerRow, columns, missing, toCheck: columns.filter((c) => c.level === 'check').length };
}

const KIND_WORDS: Record<ValueKind, string> = {
  date: 'dates',
  serial: 'Excel dates',
  ic: 'IC numbers',
  passport: 'passport numbers',
  phone: 'phone numbers',
  email: 'emails',
  money: 'amounts',
  integer: 'whole numbers',
  number: 'numbers',
  plate: 'plate numbers',
  bool: 'yes or no',
  country: 'countries',
  personName: 'names',
  code: 'codes',
  text: 'text',
};

function whyMatch(how: SmartHow, p: ColumnProfile, f: AlignField): string {
  const vals = p.main ? `the values are ${KIND_WORDS[p.main]}` : '';
  const order = p.dateOrder === 'mdy' ? ' (month first, as written in the file)' : p.dateOrderGuessed && p.main === 'date' ? ' (read day first; check one date)' : '';
  switch (how) {
    case 'remembered':
      return 'You matched this column last time.';
    case 'name':
      return `Same name as "${f.label}"${vals ? `; ${vals}` : ''}${order}.`;
    case 'synonym':
      return `A known word for "${f.label}"${vals ? `; ${vals}` : ''}${order}.`;
    case 'fuzzy':
      return `A close spelling of "${f.label}"${vals ? `; ${vals}` : ''}${order}.`;
    case 'values':
      return `No known column name, but ${vals || 'the values fit'}${order}. Check it.`;
    case 'ai':
      return 'Suggested by Arisha AI from the column names and value shapes only. Check it.';
    default:
      return 'You chose this.';
  }
}

function whyNot(p: ColumnProfile): string {
  if (!p.fill) return 'Empty column.';
  return p.main ? `Not used: ${KIND_WORDS[p.main]}, no field fits.` : 'Not used: no field fits.';
}

// ---------- Sheets ----------

/** A cell that is data, not a column name: a date, a number, an email, a long sentence. */
const looksLikeData = (c: string) => /^[\d\s.,/:+()-]+$/.test(c) || EMAIL_RE.test(c) || c.length > 60;

/**
 * The header row: among the first 25 rows, the one whose cells name the most fields (as P81's findHeaderRow, scored with
 * this matcher and skipping cells that are plainly data, so a long sheet is read fast).
 */
export function findHeader(table: string[][], fields: AlignField[]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(25, table.length); i++) {
    const cells = (table[i] ?? []).map((c) => String(c ?? '').trim());
    const filled = cells.filter(Boolean);
    if (!filled.length) continue;
    const named = new Map<string, number>();
    for (const cell of filled) {
      if (looksLikeData(cell)) continue;
      let top: [number, string] | null = null;
      for (const f of fields) {
        const m = headerMatch(cell, f);
        if (m && m[0] >= 0.75 && (!top || m[0] > top[0])) top = [m[0], f.key];
      }
      if (top && !named.has(top[1])) named.set(top[1], top[0]);
    }
    const total = [...named.values()].reduce((a, b) => a + b, 0);
    // A banner ("SENARAI PEKERJA ASING") names at most one field in one cell; a header names several.
    const score = named.size >= 2 || filled.length === 1 ? total : total * 0.5;
    if (score > bestScore + 1e-9) {
      best = i;
      bestScore = score;
    }
    // Rows of data follow the header: three of them without a better row and the search is over.
    if (best >= 0 && bestScore >= 1.5 && i - best >= 3) break;
  }
  return best >= 0 ? best : Math.max(0, table.findIndex((r) => r.some((c) => String(c ?? '').trim())));
}

/**
 * The header row with a merged group title above it read in: "Passport" over "No." and "Expiry" becomes "Passport No."
 * and "Passport Expiry". Only when the row above is sparser than the header (a group title), never a data row.
 */
export function composeHeader(table: string[][], headerRow: number): string[] {
  const head = (table[headerRow] ?? []).map((c) => String(c ?? '').trim());
  const above = headerRow > 0 ? (table[headerRow - 1] ?? []).map((c) => String(c ?? '').trim()) : [];
  const aboveFilled = above.filter(Boolean).length;
  const headFilled = head.filter(Boolean).length;
  if (!aboveFilled || aboveFilled >= headFilled || aboveFilled === 1 && above.length === 1) return head;
  // Spread each group title over the empty cells to its right (a merged cell keeps its text in the first cell).
  const group: string[] = [];
  let cur = '';
  for (let i = 0; i < Math.max(head.length, above.length); i++) {
    if (above[i]) cur = above[i];
    else if (!head[i]) cur = '';
    group[i] = cur;
  }
  return head.map((h, i) => (group[i] && h && normHeader(group[i]) !== normHeader(h) ? `${group[i]} ${h}` : h || group[i] || ''));
}

/** Totals and signature lines under a table ("Jumlah", "Total", "Disediakan oleh"): never records. */
export function isTotalsRow(row: string[]): boolean {
  const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (!cells.length) return false;
  const first = normHeader(cells[0]);
  return /^(jumlah|total|grand total|sub total|subtotal|jumlah besar|sum|disediakan oleh|prepared by|disahkan oleh|verified by|approved by|diluluskan oleh|tandatangan|signature)\b/.test(first) && cells.length <= Math.max(3, Math.ceil(row.length / 2));
}

/**
 * The sheet most like this record's list: the one whose header row names the most fields, with rows under it. Ties to
 * the earlier sheet.
 */
export function pickSheet(sheets: { name: string; rows: string[][] }[], fields: AlignField[]): number {
  let best = 0;
  let bestScore = -1;
  sheets.forEach((s, i) => {
    if (s.rows.length < 2) return;
    const hr = findHeader(s.rows, fields);
    const head = composeHeader(s.rows, hr);
    let named = 0;
    const seen = new Set<string>();
    for (const h of head)
      for (const f of fields) {
        const m = headerMatch(h, f);
        if (m && m[0] >= 0.7 && !seen.has(f.key)) {
          seen.add(f.key);
          named += m[0];
          break;
        }
      }
    const rows = s.rows.length - hr - 1;
    const score = named * 10 + Math.min(rows, 500) / 100;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** "Name (Passport)" in one column: split when nearly every value has a code in brackets after the text. */
const SPLIT_RE = /^(.*?[\p{L}].*?)\s*[([]\s*([A-Z0-9][A-Z0-9 /-]{3,20})\s*[)\]]\s*$/iu;

export interface PreparedSheet {
  /** The header row with group titles read in, then the rows; totals lines dropped; split columns added at the end. */
  table: string[][];
  headerRow: number;
  /** Rows of the original sheet left out as totals or signature lines (1-based, as Excel numbers them after blank rows). */
  droppedRows: number[];
  /** Columns split in two: [original header, the new column's header]. */
  splits: [string, string][];
}

/** Get a sheet ready for matching: the header row, group titles, totals lines out, "Name (Passport)" columns split. */
export function prepareSheet(rows: string[][], fields: AlignField[], headerRow?: number | null): PreparedSheet {
  const hr = headerRow ?? findHeader(rows, fields);
  const head = composeHeader(rows, hr);
  const droppedRows: number[] = [];
  const body: string[][] = [];
  rows.slice(hr + 1).forEach((r, i) => {
    if (isTotalsRow(r)) droppedRows.push(hr + 2 + i);
    else body.push(r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()));
  });
  const width = Math.max(head.length, ...body.map((r) => r.length), 0);
  const header = Array.from({ length: width }, (_, i) => head[i] ?? '');
  const splits: [string, string][] = [];
  for (let c = 0; c < width; c++) {
    const vals = body.map((r) => r[c] ?? '').filter(Boolean);
    if (vals.length < 2) continue;
    const hits = vals.filter((v) => SPLIT_RE.test(v)).length;
    if (hits / vals.length < 0.8) continue;
    const inner = vals.map((v) => SPLIT_RE.exec(v)?.[2] ?? '').filter(Boolean);
    // Only a code in the brackets (a passport or staff number), not "(Sdn Bhd)" or "(Ketua)".
    if (inner.filter((x) => /\d/.test(x)).length / inner.length < 0.8) continue;
    const name = /\(([^)]+)\)/.exec(header[c])?.[1]?.trim() || `${header[c] || `Column ${c + 1}`} (in brackets)`;
    const newHeader = name;
    header[c] = header[c].replace(/\s*\([^)]*\)\s*$/, '').trim() || header[c];
    header.push(newHeader);
    for (const r of body) {
      const m = SPLIT_RE.exec(r[c] ?? '');
      while (r.length < width) r.push('');
      r.push(m ? m[2].trim() : '');
      if (m) r[c] = m[1].trim();
    }
    splits.push([header[c], newHeader]);
  }
  return { table: [header, ...body], headerRow: 0, droppedRows, splits };
}

// ---------- Values to the form's own ----------

/** A Malaysian IC as the forms keep it: 900101-01-1234. Anything else as typed, trimmed. */
export function normIc(raw: string): string {
  const d = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\d{12}$/.test(d) ? `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : String(raw ?? '').trim();
}

/**
 * The cells of the matched columns turned into the values the server reads without doubt: dates to ISO in the column's
 * own order (so 03/04/2027 in a month-first sheet is 4 March, not 3 April), Excel serials in date fields to ISO, ICs
 * with dashes, plates in capitals, spaces tidied. Other cells are left as they are. Returns a new table.
 */
export function normaliseTable(table: string[][], headerRow: number, columns: { index: number; field: string | null; profile?: ColumnProfile }[], fields: AlignField[]): string[][] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return table.map((row, r) => {
    if (r <= headerRow) return row;
    const out = [...row];
    for (const c of columns) {
      const f = c.field ? byKey.get(c.field) : null;
      const v = String(out[c.index] ?? '').replace(/\s+/g, ' ').trim();
      if (!f || !v) {
        if (c.index < out.length) out[c.index] = v;
        continue;
      }
      if (f.type === 'date') out[c.index] = isoDateOf(v, c.profile?.dateOrder ?? 'dmy') ?? v;
      else if (f.key === 'idFull') out[c.index] = normIc(v);
      else if (f.key === 'plate') out[c.index] = v.toUpperCase();
      else if (f.key === 'nationality' && COUNTRY_WORDS[normHeader(v)]) out[c.index] = COUNTRY_WORDS[normHeader(v)];
      else out[c.index] = v;
    }
    return out;
  });
}

// ---------- Remembered layouts ----------

/** A short signature of a header row: the same layout gives the same signature. */
export function headerSignature(header: string[]): string {
  const s = header.map(normHeader).join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---------- Optional AI help, minimised ----------

/**
 * The shape of a value with nothing of the value in it: letters become A, digits 9, other characters kept, long runs
 * shortened ("AB1234567" is "AA9999999", "01/03/2027" is "99/99/9999", "Ram Bahadur" is "Aaa Aaaaaaa" shortened to
 * "Aa Aa"). This is all the AI helper may see of the values; never the values themselves.
 */
export function valueShape(v: string): string {
  const s = String(v ?? '').trim().slice(0, 40);
  if (!s) return '';
  if (EMAIL_RE.test(s)) return 'a@a.a';
  const shape = s.replace(/\p{Lu}/gu, 'A').replace(/\p{Ll}/gu, 'a').replace(/\p{N}/gu, '9');
  // A word's letters say nothing more by their length or case after the first: "Aaa Aaaaaaa" is "Aa Aa".
  return shape.replace(/\b([Aa])[Aa]{2,}\b/g, (_, a: string) => `${a}a`);
}

/** The minimised question for the AI helper: unmatched column names and value shapes, and the free fields. */
export function importAiBrief(
  kindLabel: string,
  columns: { index: number; header: string; sample: string[] }[],
  fields: { key: string; label: string; type: string }[],
): string {
  const cols = columns.slice(0, 40).map((c) => ({ i: c.index, header: c.header.slice(0, 60), shapes: [...new Set(c.sample.map(valueShape).filter(Boolean))].slice(0, 3) }));
  const fs = fields.slice(0, 60).map((f) => ({ key: f.key, label: f.label.slice(0, 80), type: f.type }));
  return [
    `A spreadsheet of "${kindLabel.slice(0, 60)}" records is being imported. Some columns could not be matched to fields by name.`,
    'Only column names and value shapes are given (A = capital letter, a = small letter, 9 = digit); never values.',
    'Answer with JSON only: {"matches":[{"i":<column index>,"key":"<field key>"}]}. Leave out any column you are not sure of.',
    'Each field at most once. Use only the field keys listed.',
    `Columns: ${JSON.stringify(cols)}`,
    `Fields: ${JSON.stringify(fs)}`,
  ].join('\n');
}

/** The AI's answer, checked: known columns and fields only, each once. Anything else is dropped. */
export function parseImportAiAnswer(text: string, columns: number[], fields: string[]): { index: number; field: string }[] {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const list = Array.isArray((data as { matches?: unknown })?.matches) ? (data as { matches: unknown[] }).matches : [];
  const out: { index: number; field: string }[] = [];
  const usedCol = new Set<number>();
  const usedField = new Set<string>();
  for (const x of list.slice(0, 100)) {
    const i = Number((x as { i?: unknown })?.i);
    const key = String((x as { key?: unknown })?.key ?? '');
    if (!Number.isInteger(i) || !columns.includes(i) || !fields.includes(key) || key === COMPANY_FIELD || usedCol.has(i) || usedField.has(key)) continue;
    usedCol.add(i);
    usedField.add(key);
    out.push({ index: i, field: key });
  }
  return out;
}
