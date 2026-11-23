import { sha256Hex } from './audit';
import { redactPersonal } from './draft-help';
import type { IsoDate, User } from './types';

/**
 * Key-in helper, "Isi automatik" (Fauzan, 23 Nov 2026: "Use system more than ai" and "ai must also be there to help
 * key in more needed. Staff do minimal work"). A form is filled in this order and each later step only touches the
 * fields still empty:
 *
 *   1. prima   what Prima already holds (the host form passes it in)
 *   2. import  a checked Excel list (the normal import, not this file)
 *   3. phone   the words of the paper, read on the phone for free, then found here by fixed rules
 *   4. helper  the online reader, only for fields the rules left empty, only for papers that may be sent
 *
 * Nothing here saves a record. Every value that came from a paper is marked to check, and the form is ready to save
 * only when the person has confirmed each one. A value the reader is unsure of stays empty; nothing is guessed. Staff
 * screens say "Isi automatik" and never name an AI product (staff usability rule 4).
 */

export type KeyInOrigin = 'typed' | 'prima' | 'import' | 'phone' | 'helper';
export type KeyInFieldType = 'date' | 'money' | 'number' | 'text' | 'month' | 'year';

export interface KeyInFieldSpec {
  name: string;
  type: KeyInFieldType;
  /** Words printed beside the value, Malay and English, lower case. The value is looked for on the same line. */
  near: string[];
  /** Words that mean the line is about something else (for example "sub-total" for a total). */
  not?: string[];
  /**
   * A line that holds several different values: take the first or the last (a period "Januari 2026 hingga Julai
   * 2026" gives its first month to "from" and its last to "to"). Without it a line with two values is not trusted.
   */
  pick?: 'first' | 'last';
  label: { bm: string; en: string };
}

/** Papers whose printed values may go to the online reader when the phone and the rules could not find them. */
export type KeyInPaper = 'receipt' | 'quote' | 'invoice' | 'permit' | 'licence' | 'insurance' | 'certificate' | 'fuel';
/**
 * Papers that are NEVER sent to the online reader: the person keys them in, or the phone reads them and the rules
 * find the dates. Consent forms stay with the PDPA officer; medical papers, firearm papers, investigation and speak-up
 * papers and bank statements never leave Prima. 'statement' is an EPF, SOCSO, HRD, tax, SST or accounts paper (the
 * KDN renewal pack, AG21): it lists staff pay and numbers, so it is read on the device only. Contracts, letters and any paper Prima does not know the kind of
 * ('other': Fauzan, 23 Nov 2026, "Make it read all type of document") are read the same way: on the phone and by the
 * rules only, because nobody has checked what such a paper may hold.
 */
export type KeyInLocalOnlyPaper = 'consent' | 'medical' | 'firearm' | 'investigation' | 'speak-up' | 'bank-statement' | 'statement' | 'contract' | 'letter' | 'other';
export type KeyInAnyPaper = KeyInPaper | KeyInLocalOnlyPaper;

export const KEY_IN_LOCAL_ONLY: readonly KeyInLocalOnlyPaper[] = ['consent', 'medical', 'firearm', 'investigation', 'speak-up', 'bank-statement', 'statement', 'contract', 'letter', 'other'];

const DATE_OF_PAPER: KeyInFieldSpec = { name: 'paperDate', type: 'date', near: ['tarikh', 'date', 'dated', 'bertarikh'], not: ['tamat', 'expiry', 'expire', 'luput', 'due', 'valid', 'sah'], label: { bm: 'Tarikh kertas', en: 'Date on the paper' } };
const EXPIRY: KeyInFieldSpec = { name: 'expiresOn', type: 'date', near: ['tarikh tamat', 'tamat tempoh', 'tamat', 'expiry', 'expires', 'expire', 'luput', 'sah sehingga', 'sah hingga', 'valid until', 'valid till', 'valid to'], label: { bm: 'Tarikh tamat', en: 'Expiry date' } };
const REF: KeyInFieldSpec = { name: 'ref', type: 'text', near: ['ruj. kami', 'ruj kami', 'rujukan kami', 'no. rujukan', 'no rujukan', 'rujukan', 'ruj.', 'reference no', 'ref no', 'ref.', 'our ref', 'no. sijil', 'certificate no', 'no. resit', 'receipt no', 'quotation no', 'no. sebut harga'], label: { bm: 'No. rujukan', en: 'Reference no.' } };
const DUE: KeyInFieldSpec = { name: 'dueOn', type: 'date', near: ['tarikh akhir bayaran', 'tarikh akhir', 'due date', 'payment due', 'bayar sebelum', 'pay by'], label: { bm: 'Bayar sebelum', en: 'Due date' } };
const ISSUED: KeyInFieldSpec = { name: 'issuedOn', type: 'date', near: ['tarikh dikeluarkan', 'tarikh keluar', 'date of issue', 'issued on', 'issue date', 'dikeluarkan pada'], label: { bm: 'Tarikh dikeluarkan', en: 'Issue date' } };
const START: KeyInFieldSpec = { name: 'startsOn', type: 'date', near: ['tarikh mula', 'tarikh kuat kuasa', 'mula pada', 'bermula', 'start date', 'commencement date', 'effective date', 'period from', 'tempoh dari'], not: ['tamat', 'expiry', 'end date'], label: { bm: 'Tarikh mula', en: 'Start date' } };
const PERIOD_FROM: KeyInFieldSpec = { name: 'periodFrom', type: 'month', pick: 'first', near: ['bulan caruman', 'contribution month', 'tempoh', 'period', 'bagi bulan', 'for the month', 'dari', 'from'], not: ['tamat', 'expiry'], label: { bm: 'Bulan pertama', en: 'First month' } };
const PERIOD_TO: KeyInFieldSpec = { name: 'periodTo', type: 'month', pick: 'last', near: ['bulan caruman', 'contribution month', 'tempoh', 'period', 'bagi bulan', 'for the month', 'hingga', 'sehingga', 'until'], not: ['tamat', 'expiry'], label: { bm: 'Bulan terakhir', en: 'Last month' } };
const YEAR: KeyInFieldSpec = { name: 'year', type: 'year', near: ['tahun taksiran', 'year of assessment', 'tahun kewangan', 'financial year', 'tahun berakhir', 'year ended', 'tahun', 'year'], label: { bm: 'Tahun', en: 'Year' } };
const TOTAL: KeyInFieldSpec = { name: 'amount', type: 'money', near: ['jumlah besar', 'grand total', 'jumlah', 'total', 'amount due', 'amaun', 'net amount'], not: ['sub-total', 'subtotal', 'sub total', 'cukai', 'tax', 'sst', 'gst', 'diskaun', 'discount', 'baki', 'change'], label: { bm: 'Jumlah (RM)', en: 'Total (RM)' } };

export const KEY_IN_FIELDS: Record<KeyInAnyPaper, KeyInFieldSpec[]> = {
  receipt: [DATE_OF_PAPER, TOTAL, REF],
  quote: [DATE_OF_PAPER, TOTAL, REF, { name: 'validUntil', type: 'date', near: ['sah sehingga', 'sah hingga', 'valid until', 'valid till', 'validity', 'tempoh sah'], label: { bm: 'Sah sehingga', en: 'Valid until' } }],
  invoice: [DATE_OF_PAPER, TOTAL, { ...REF, near: ['no. invois', 'no invois', 'invoice no', 'inv no', 'inv.', ...REF.near] }, DUE],
  permit: [EXPIRY, ISSUED],
  licence: [EXPIRY, ISSUED, { ...REF, near: ['no. lesen', 'no lesen', 'licence no', 'license no', ...REF.near] }],
  insurance: [EXPIRY, START, { ...REF, near: ['no. polisi', 'no polisi', 'policy no', 'cover note no', ...REF.near] }, { ...TOTAL, near: ['jumlah premium', 'total premium', 'premium', ...TOTAL.near] }],
  certificate: [DATE_OF_PAPER, EXPIRY, REF],
  fuel: [
    DATE_OF_PAPER,
    TOTAL,
    { name: 'litres', type: 'number', near: ['liter', 'litre', 'litres', 'ltr', 'volume', 'isipadu'], label: { bm: 'Liter', en: 'Litres' } },
  ],
  consent: [DATE_OF_PAPER],
  medical: [DATE_OF_PAPER],
  firearm: [EXPIRY, DATE_OF_PAPER],
  investigation: [DATE_OF_PAPER],
  'speak-up': [DATE_OF_PAPER],
  'bank-statement': [DATE_OF_PAPER, { name: 'statementMonth', type: 'month', near: ['tempoh penyata', 'statement period', 'tarikh penyata', 'statement date', 'bulan', 'month'], label: { bm: 'Bulan penyata', en: 'Statement month' } }],
  statement: [PERIOD_FROM, PERIOD_TO, YEAR, DATE_OF_PAPER, REF],
  contract: [DATE_OF_PAPER, START, EXPIRY, REF],
  letter: [DATE_OF_PAPER, REF],
  // Any other paper: the values most forms ask for. A host form uses the ones it has a box for.
  other: [DATE_OF_PAPER, EXPIRY, REF, TOTAL],
};
export const KEY_IN_PAPERS = Object.keys(KEY_IN_FIELDS) as KeyInAnyPaper[];
export const isKeyInPaper = (x: unknown): x is KeyInAnyPaper => typeof x === 'string' && (KEY_IN_PAPERS as string[]).includes(x);
/** May the words of this paper go to the online reader at all? */
export const keyInOnlineAllowed = (paper: KeyInAnyPaper): paper is KeyInPaper => !(KEY_IN_LOCAL_ONLY as readonly string[]).includes(paper);

export const KEY_IN_RULE = {
  id: 'KEY-IN',
  consentVersion: 'key-in-v1' as const,
  /** The most paper text looked at (and, when allowed, sent). */
  maxTextChars: 12_000,
  /** Asks per person per hour; a paper already read is answered from the kept result and is not counted. */
  perUserPerHour: 60,
  /**
   * Token saving (Fauzan, 23 Nov 2026: "Make sure it use all the new technology to decrease the amount of token needed
   * to work"): only the lines near what is still empty are sent, at most this many characters, not the whole paper.
   */
  maxSentChars: 2_500,
  /** Lines kept after a line that names a field, because the value is often on the next line. */
  linesAfter: 1,
};

export const KEY_IN_LABELS = {
  bm: {
    title: 'Isi automatik',
    check: 'Semak',
    confirmAll: 'Sahkan semua',
    note: 'Nilai bertanda Semak dibaca dari kertas. Bandingkan dengan kertas, betulkan jika salah, kemudian sahkan. Tiada apa-apa disimpan sehingga anda simpan borang.',
    blank: 'Tidak dapat dibaca. Sila isi.',
    pick: 'Pilih atau ambil gambar dokumen: gambar, PDF, Word, Excel, PowerPoint, teks atau e-mel. Dokumen dibaca pada peranti anda.',
    reading: 'Sedang membaca dokumen…',
    tooBig: 'Fail terlalu besar (had 15 MB). Sila pilih fail yang lebih kecil atau isi sendiri.',
    oldOffice: 'Fail Word atau Excel lama (.doc, .xls) tidak dapat dibaca. Simpan semula sebagai PDF, .docx atau .xlsx, atau isi sendiri.',
    unknownFile: 'Jenis fail ini tidak dikenali. Simpan sebagai PDF atau ambil gambar, atau isi sendiri.',
    locked: 'Fail ini berkunci dengan kata laluan. Buka kuncinya dahulu atau isi sendiri.',
    localOnly: 'Dokumen jenis ini dibaca pada peranti anda sahaja dan tidak dihantar ke mana-mana.',
    sent: 'Jika telefon tidak dapat membaca, perkataan pada kertas dihantar ke perkhidmatan bacaan syarikat (Microsoft Azure). Nombor IC, pasport, akaun bank, telefon dan e-mel dibuang dahulu.',
  },
  en: {
    title: 'Auto-fill',
    check: 'Check',
    confirmAll: 'Confirm all',
    note: 'Values marked Check were read from the paper. Compare them with the paper, correct any that are wrong, then confirm. Nothing is saved until you save the form.',
    blank: 'Could not be read. Please fill it in.',
    pick: 'Choose a document or take its photo: photo, PDF, Word, Excel, PowerPoint, text or email. It is read on your own device.',
    reading: 'Reading the document…',
    tooBig: 'The file is too big (limit 15 MB). Choose a smaller file or fill it in yourself.',
    oldOffice: 'Old Word or Excel files (.doc, .xls) cannot be read. Save it again as PDF, .docx or .xlsx, or fill it in yourself.',
    unknownFile: 'This kind of file is not known. Save it as PDF or take a photo, or fill it in yourself.',
    locked: 'This file is locked with a password. Unlock it first or fill it in yourself.',
    localOnly: 'This kind of document is read on your own device only and is not sent anywhere.',
    sent: "If the phone cannot read it, the words on the paper are sent to the company's reading service (Microsoft Azure). IC, passport, bank account, phone numbers and emails are removed first.",
  },
};

/** Anyone who fills forms: not guards, shared site devices, system sign-ins or closed accounts. */
export function keyInAllowed(user: User, today?: string): boolean {
  if (user.integration || user.role === 'site_device' || user.role === 'guard') return false;
  if (user.accessClosedFrom && today && user.accessClosedFrom <= today) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Values

export type KeyInValue = string | number;
export interface KeyInFound {
  name: string;
  value: KeyInValue;
  /** The exact words on the paper the value was read from. */
  raw: string;
  origin: 'phone' | 'helper';
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12,
};
function validDate(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
const DATE_PATTERNS: { re: RegExp; at: (m: RegExpExecArray) => IsoDate | null }[] = [
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, at: (m) => validDate(+m[1], +m[2], +m[3]) },
  // Malaysian papers print day first.
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g, at: (m) => validDate(+m[3], +m[2], +m[1]) },
  { re: /\b(\d{1,2})\s*([A-Za-z]{3,9})\.?,?\s*(\d{4})\b/g, at: (m) => (MONTHS[m[2].toLowerCase()] ? validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null) },
];
const MONEY = /(?:RM|MYR)?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/gi;
const NUMBER = /(?<![\d.,])(\d{1,6}(?:\.\d{1,3})?)(?![\d,]|\.\d)/g;

/** Every value of the type printed in the words, with the exact words it was read from. */
export function keyInValuesIn(type: KeyInFieldType, words: string): { value: KeyInValue; raw: string }[] {
  const out: { value: KeyInValue; raw: string; at: number }[] = [];
  if (type === 'date') {
    for (const p of DATE_PATTERNS)
      for (const m of words.matchAll(new RegExp(p.re.source, 'g'))) {
        const v = p.at(m as RegExpExecArray);
        // A longer match at the same place wins (2026-11-30 is not also read as 26-11-30).
        if (v && !out.some((o) => m.index! < o.at + o.raw.length && o.at < m.index! + m[0].length)) out.push({ value: v, raw: m[0], at: m.index! });
      }
  } else if (type === 'month' || type === 'year') {
    // Full dates first (their month or year), then "Julai 2026", "07/2026", "2026-07", then a bare year.
    const spans: { at: number; len: number }[] = [];
    const free = (at: number, len: number) => !spans.some((x) => at < x.at + x.len && x.at < at + len);
    const add = (y: number, m: number | null, raw: string, at: number) => {
      if (y < 2000 || y > 2100 || (m !== null && (m < 1 || m > 12))) return;
      if (type === 'month' && m === null) return;
      spans.push({ at, len: raw.length });
      out.push({ value: type === 'year' ? y : `${y}-${String(m).padStart(2, '0')}`, raw, at });
    };
    for (const p of DATE_PATTERNS)
      for (const m of words.matchAll(new RegExp(p.re.source, 'g'))) {
        const v = p.at(m as RegExpExecArray);
        if (v && free(m.index!, m[0].length)) add(+v.slice(0, 4), +v.slice(5, 7), m[0], m.index!);
      }
    for (const m of words.matchAll(/\b([A-Za-z]{3,9})\.?,?\s*(\d{4})\b/g)) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo && free(m.index!, m[0].length)) add(+m[2], mo, m[0], m.index!);
    }
    for (const m of words.matchAll(/(?<![\d/.-])(\d{1,2})[/-](\d{4})(?![\d/.-])/g)) if (free(m.index!, m[0].length)) add(+m[2], +m[1], m[0], m.index!);
    for (const m of words.matchAll(/(?<![\d/.-])(\d{4})-(\d{1,2})(?![\d/.-])/g)) if (free(m.index!, m[0].length)) add(+m[1], +m[2], m[0], m.index!);
    if (type === 'year') for (const m of words.matchAll(/(?<![\d/.-])(\d{4})(?![\d/.-])/g)) if (free(m.index!, m[0].length)) add(+m[1], null, m[0], m.index!);
  } else if (type === 'money') {
    for (const m of words.matchAll(MONEY)) {
      const v = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
      if (v > 0 && v < 100_000_000) out.push({ value: v, raw: m[0].trim(), at: m.index! });
    }
  } else if (type === 'number') {
    for (const m of words.matchAll(NUMBER)) out.push({ value: Number(m[1]), raw: m[0], at: m.index! });
  } else {
    const t = words.trim();
    if (t) out.push({ value: t.slice(0, 120), raw: t.slice(0, 120), at: 0 });
  }
  return out.sort((a, b) => a.at - b.at).map(({ value, raw }) => ({ value, raw }));
}

const cleanText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, KEY_IN_RULE.maxTextChars);

/**
 * Step 3: finds the values on the paper by fixed rules. A field is filled only when exactly one line carries its
 * label words and that line holds exactly one value of the right type (for money, the last figure on the line, as
 * totals are printed). Two different answers, or none, leave the field empty for the next step or for the person.
 */
export function keyInRulesRead(paper: KeyInAnyPaper, text: string, want?: string[]): KeyInFound[] {
  const lines = cleanText(text).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 400);
  const found: KeyInFound[] = [];
  for (const spec of KEY_IN_FIELDS[paper]) {
    if (want && !want.includes(spec.name)) continue;
    const answers = new Map<string, KeyInFound>();
    for (const line of lines) {
      const low = line.toLowerCase();
      const hit = spec.near.find((w) => low.includes(w));
      if (!hit || spec.not?.some((w) => low.includes(w))) continue;
      const after = line.slice(low.indexOf(hit) + hit.length);
      if (spec.type === 'text') {
        const m = /^[\s:.#-]*([A-Za-z0-9][A-Za-z0-9/().-]{2,39})/.exec(after);
        if (m && /\d/.test(m[1])) answers.set(m[1], { name: spec.name, value: m[1], raw: m[1], origin: 'phone' });
        continue;
      }
      let vals = keyInValuesIn(spec.type, after);
      // The same month or year printed twice on a line ("01/06/2026 - 30/06/2026") is one answer.
      if (spec.type === 'month' || spec.type === 'year') vals = vals.filter((v, i) => vals.findIndex((x) => x.value === v.value) === i);
      if (!vals.length) continue;
      if (spec.type !== 'money' && !spec.pick && vals.length !== 1) continue;
      const v = spec.type === 'money' || spec.pick === 'last' ? vals[vals.length - 1] : vals[0];
      answers.set(String(v.value), { name: spec.name, value: v.value, raw: v.raw, origin: 'phone' });
    }
    if (answers.size === 1) found.push([...answers.values()][0]);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4: what may be sent, and what may come back

const PASSPORT = /(?<![A-Za-z0-9])[A-Z]{1,2}\d{6,8}(?![A-Za-z0-9])/g;
/** Bank account numbers: 9 to 17 digits in one run or in dashed or spaced groups. Amounts keep their decimal point. */
const ACCOUNT = /(?<![\d.,])\d(?:[\s-]?\d){8,16}(?![\d]|[.,]\d)/g;

/** The paper's words with IC, passport, bank account, card and phone numbers and emails removed. */
export function keyInRedact(text: string): string {
  return redactPersonal(cleanText(text), { cards: true })
    .replace(PASSPORT, '[dibuang]')
    .replace(ACCOUNT, (m) => (m.replace(/\D/g, '').length >= 9 ? '[dibuang]' : m));
}

export interface KeyInOnlineInput {
  paper: KeyInPaper;
  /** Only the fields still empty after steps 1 to 3. */
  fields: { name: string; type: KeyInFieldType; label: string }[];
  /** Redacted words of the paper. */
  text: string;
}

const VALUE_SHAPE: Record<KeyInFieldType, RegExp> = {
  date: /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+[a-z]{3,9}\s+\d{4}\b/i,
  money: /\b(?:rm|myr)\s?\d|\d[\d,]*\.\d{2}\b/i,
  number: /\d/,
  text: /[A-Za-z]{1,6}[-/]?\d{2,}/,
  month: /\b[a-z]{3,9}\s+\d{4}\b|\b\d{1,2}[/-]\d{4}\b/i,
  year: /\b(?:19|20)\d{2}\b/,
};

/**
 * The few lines of a paper worth sending for the empty fields: lines naming a field (and the line after), then lines
 * holding a value of the right shape, in paper order, up to KEY_IN_RULE.maxSentChars. The rest of the paper is not
 * sent, so a long paper costs about the same as a short one.
 */
export function keyInSnippet(paper: KeyInAnyPaper, text: string, missing: string[], maxChars = KEY_IN_RULE.maxSentChars): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const specs = KEY_IN_FIELDS[paper].filter((f) => missing.includes(f.name));
  const named = new Set<number>();
  const shaped = new Set<number>();
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    for (const f of specs) {
      if (f.near.some((w) => low.includes(w))) for (let k = i; k <= Math.min(lines.length - 1, i + KEY_IN_RULE.linesAfter); k++) named.add(k);
      else if (VALUE_SHAPE[f.type].test(line)) shaped.add(i);
    }
  });
  const pick = new Set<number>();
  let size = 0;
  for (const group of [named, shaped])
    for (const i of [...group].sort((a, b) => a - b)) {
      if (pick.has(i) || size + lines[i].length + 1 > maxChars) continue;
      pick.add(i);
      size += lines[i].length + 1;
    }
  const out = [...pick].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
  return out.length >= 10 ? out : text.slice(0, maxChars);
}

/** What step 4 would send, or null when nothing may or need be sent. */
export function keyInOnlineInput(paper: KeyInAnyPaper, text: string, missing: string[]): KeyInOnlineInput | null {
  if (!keyInOnlineAllowed(paper)) return null;
  const fields = KEY_IN_FIELDS[paper].filter((f) => missing.includes(f.name)).map((f) => ({ name: f.name, type: f.type, label: f.label.en }));
  const redacted = keyInRedact(text).trim();
  if (!fields.length || redacted.length < 10) return null;
  return { paper, fields, text: keyInSnippet(paper, redacted, missing) };
}

/** The kept-result key: the same paper and the same empty fields are never read twice. */
export function keyInHash(input: KeyInOnlineInput): string {
  return sha256Hex(JSON.stringify([input.paper, input.fields.map((f) => f.name).sort(), input.text]));
}

export const KEY_IN_ONLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['values'],
  properties: {
    values: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'raw'],
        properties: { name: { type: 'string' }, raw: { type: ['string', 'null'] } },
      },
    },
  },
} as const;

/**
 * Checks what the online reader returned. It is only asked to point at words on the paper: Prima reads the value
 * itself. An answer is kept only when it names a field that was asked for, its words are really on the paper as
 * sent, and those words hold exactly one value of the field's type. Anything else is dropped and the field stays
 * empty.
 */
export function checkKeyInOnlineOutput(input: KeyInOnlineInput, raw: unknown): KeyInFound[] {
  const list = raw && typeof raw === 'object' ? (raw as { values?: unknown }).values : null;
  if (!Array.isArray(list)) return [];
  const out = new Map<string, KeyInFound | null>();
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const { name, raw: words } = item as { name?: unknown; raw?: unknown };
    const spec = input.fields.find((f) => f.name === name);
    if (!spec || typeof words !== 'string') continue;
    const w = words.trim();
    if (!w || w.length > 120 || w.includes('[dibuang]') || !input.text.includes(w)) continue;
    const vals = keyInValuesIn(spec.type, w);
    if (vals.length !== 1) continue;
    // The same field answered twice with different values is not trusted.
    const had = out.get(spec.name);
    if (had === undefined) out.set(spec.name, { name: spec.name, value: vals[0].value, raw: w, origin: 'helper' });
    else if (had && had.value !== vals[0].value) out.set(spec.name, null);
  }
  return [...out.values()].filter((v): v is KeyInFound => !!v);
}

// ---------------------------------------------------------------------------------------------------------------
// The form: fill only what is empty, and save only what the person confirmed

export interface KeyInField {
  name: string;
  value: KeyInValue | null;
  origin: KeyInOrigin | null;
  /** The words on the paper, for values read from it. */
  raw: string | null;
  /** Read from a paper and not yet confirmed by the person. */
  toCheck: boolean;
}

const empty = (v: unknown) => v == null || v === '';

/** The form's fields as they stand: what the person typed and what Prima already held. */
export function keyInStart(paper: KeyInAnyPaper, typed: Record<string, unknown> = {}, prima: Record<string, unknown> = {}): KeyInField[] {
  const val = (x: unknown): KeyInValue | null => (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)) ? x : null);
  return KEY_IN_FIELDS[paper].map((f) => {
    const t = val(typed[f.name]);
    if (!empty(t)) return { name: f.name, value: t, origin: 'typed', raw: null, toCheck: false };
    const p = val(prima[f.name]);
    if (!empty(p)) return { name: f.name, value: p, origin: 'prima', raw: null, toCheck: false };
    return { name: f.name, value: null, origin: null, raw: null, toCheck: false };
  });
}

/** Puts found values into EMPTY fields only. A typed value, or one Prima held, is never replaced. */
export function keyInFill(fields: KeyInField[], found: KeyInFound[]): KeyInField[] {
  return fields.map((f) => {
    if (!empty(f.value)) return f;
    const hit = found.find((x) => x.name === f.name);
    return hit ? { name: f.name, value: hit.value, origin: hit.origin, raw: hit.raw, toCheck: true } : f;
  });
}

export const keyInMissing = (fields: KeyInField[]): string[] => fields.filter((f) => empty(f.value)).map((f) => f.name);

/** The person confirms a value as read, or corrects it (a corrected value is theirs: origin 'typed'). */
export function keyInConfirm(fields: KeyInField[], name: string, corrected?: KeyInValue | null): KeyInField[] {
  return fields.map((f) => {
    if (f.name !== name) return f;
    if (corrected !== undefined && corrected !== f.value) return { name: f.name, value: empty(corrected) ? null : corrected, origin: empty(corrected) ? null : 'typed', raw: null, toCheck: false };
    return { ...f, toCheck: false };
  });
}
export const keyInConfirmAll = (fields: KeyInField[]): KeyInField[] => fields.map((f) => ({ ...f, toCheck: false }));

/** The host form may save only when no value read from a paper is still waiting to be checked. */
export const keyInReadyToSave = (fields: KeyInField[]): boolean => fields.every((f) => !f.toCheck);

export interface KeyInResult {
  paper: KeyInAnyPaper;
  origin: 'suggestion';
  unverified: true;
  savedRecords: 0;
  fields: KeyInField[];
  /** Whether the online reader was used for this answer (false when the rules were enough, or it is off or not allowed). */
  online: 'used' | 'kept' | 'not-needed' | 'not-allowed' | 'off' | 'limit' | 'failed';
}

// ---------------------------------------------------------------------------------------------------------------
// Budget (rule AI-AGENT-BUDGET) and switches

/** The helper kinds switched on, from AI_AGENT_KINDS ("key-in,contract-reader"). Empty or unset means none. */
export function aiAgentKinds(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z][a-z0-9-]{1,39}$/.test(s)))];
}

/** One "agent" for the cap is one helper kind working for one team: a central department, or a company's office. */
export function aiAgentTeam(user: Pick<User, 'companyIds' | 'department'>): string {
  return user.department ? `dept:${user.department}` : `company:${[...user.companyIds].sort()[0] ?? 'none'}`;
}

export interface AiPrice {
  /** US dollars per one million tokens sent and received, as on the Azure price sheet for the deployed model. */
  usdPerMTokIn: number;
  usdPerMTokOut: number;
  /**
   * The lower price for sent tokens the provider already holds from an identical start of an earlier request (prompt
   * caching). Unset means the full price: the meter never counts a saving the price sheet does not show.
   */
  usdPerMTokCached?: number;
}
/** The price must be set by hand from the price sheet; with no valid price the online step stays off. */
export function aiPrice(inValue: string | undefined, outValue: string | undefined, cachedValue?: string | undefined): AiPrice | null {
  const a = Number(inValue);
  const b = Number(outValue);
  if (!(inValue?.trim() && outValue?.trim() && Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && a < 1000 && b < 1000)) return null;
  const c = Number(cachedValue);
  return { usdPerMTokIn: a, usdPerMTokOut: b, usdPerMTokCached: cachedValue?.trim() && Number.isFinite(c) && c >= 0 && c <= a ? c : a };
}
/** Cost of one call; cached sent tokens (part of tokensIn) are counted at the cached price. */
export const aiCostUsd = (price: AiPrice, tokensIn: number, tokensOut: number, cachedIn = 0): number => {
  const cached = Math.min(Math.max(0, cachedIn), Math.max(0, tokensIn));
  return ((Math.max(0, tokensIn) - cached) * price.usdPerMTokIn + cached * (price.usdPerMTokCached ?? price.usdPerMTokIn) + Math.max(0, tokensOut) * price.usdPerMTokOut) / 1_000_000;
};

/** Answer room for one call: enough for the fields asked, never the whole allowance (fewer tokens reserved and paid). */
export const aiOutTokens = (fields: number, perField = 40, base = 30, max = 400): number => Math.min(max, base + perField * Math.max(1, fields));

/**
 * Month-to-date spend per agent, against the cap. A call is refused once the agent's spend has reached the cap; the
 * count starts again on the 1st. Before a call the worst case for that call is reserved, so two calls at once cannot
 * both slip under the cap.
 */
export class AiBudgetMeter {
  private spent = new Map<string, number>();
  constructor(private readonly capUsd: number) {}
  private key(kind: string, team: string, month: string) {
    return `${month}|${kind}|${team}`;
  }
  spentUsd(kind: string, team: string, month: string): number {
    return this.spent.get(this.key(kind, team, month)) ?? 0;
  }
  /** Reserves the worst-case cost of one call. False when it would pass the cap. */
  reserve(kind: string, team: string, month: string, worstUsd: number): boolean {
    const k = this.key(kind, team, month);
    const now = this.spent.get(k) ?? 0;
    if (!(worstUsd >= 0) || now + worstUsd > this.capUsd) return false;
    this.spent.set(k, now + worstUsd);
    return true;
  }
  /** Replaces a reservation with what the call really cost (0 when it failed before the provider answered). */
  settle(kind: string, team: string, month: string, reservedUsd: number, actualUsd: number): void {
    const k = this.key(kind, team, month);
    this.spent.set(k, Math.max(0, (this.spent.get(k) ?? 0) - reservedUsd + Math.max(0, actualUsd)));
    for (const key of this.spent.keys()) if (!key.startsWith(`${month}|`)) this.spent.delete(key);
  }
}

/**
 * Where the month-to-date spend per agent is kept. Fauzan's retest, 23 Nov 2026: a count kept only in the server's
 * memory starts again at zero after a restart, so it could pass the USD 25 cap. The online reader therefore runs only
 * with a durable budget (the database module ai-budget-v1); the memory one is for tests and the demo.
 */
export interface AiBudget {
  /** True only when the spend survives a restart and is shared by every server. */
  readonly durable: boolean;
  /** Ready to count (for the database: the module is installed). */
  ready(): Promise<boolean>;
  spentUsd(kind: string, team: string, month: string): Promise<number>;
  /** Reserves the worst case of one call. False when it would pass the cap, or the budget cannot be read. */
  reserve(kind: string, team: string, month: string, worstUsd: number): Promise<boolean>;
  /** Replaces a reservation with what the call really cost. */
  settle(kind: string, team: string, month: string, reservedUsd: number, actualUsd: number): Promise<void>;
}

/** The in-memory budget, not durable: never enough to switch the online reader on outside tests. */
export function memoryAiBudget(capUsd: number): AiBudget {
  const m = new AiBudgetMeter(capUsd);
  return {
    durable: false,
    ready: async () => true,
    spentUsd: async (k, t, mo) => m.spentUsd(k, t, mo),
    reserve: async (k, t, mo, w) => m.reserve(k, t, mo, w),
    settle: async (k, t, mo, r, a) => m.settle(k, t, mo, r, a),
  };
}
