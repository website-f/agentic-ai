import { sha256Hex } from "./audit";
import { isHrDirector } from "./access";
import { assetRole } from "./access";
import type { User } from "./types";


export type DraftHelpKind = 'bq' | 'job-post' | 'bill';
export const DRAFT_HELP_KINDS: readonly DraftHelpKind[] = ['bq', 'job-post', 'bill'];

export const DRAFT_HELP_RULE = {
  id: 'DRAFT-HELP',
  /** The wording the person agreed to when asking (shown above the button). */
  consentVersion: 'draft-help-v1' as const,
  /** Proposed: asks per person per hour, to keep cost predictable. */
  perUserPerHour: 20,
  maxSourceChars: 8000,
  maxBqSections: 15,
  maxBqLines: 120,
  maxBqNotes: 20,
  maxPostChars: 1500,
};

/** BQ units the suggestion may use (as written on our BQs; "m2" is read as "m²"). */
export const BQ_UNITS = ['LS', 'no', 'm', 'm²', 'm³', 'kg', 'set', 'unit', 'pt', 'day', 'lot'] as const;
export type BqUnit = (typeof BQ_UNITS)[number];

/** Staff-screen wording. Never names an AI product (staff usability rule 4). */
export const DRAFT_HELP_LABELS = {
  bm: {
    title: 'Cadangan draf',
    ask: 'Dapatkan cadangan',
    use: 'Guna cadangan ini',
    discard: 'Buang',
    check: 'Ini cadangan sahaja. Semak dan ubah sebelum guna. Tiada apa-apa disimpan sehingga anda simpan borang.',
    sent: 'Butiran kerja dalam borang ini dihantar ke perkhidmatan cadangan draf syarikat (Microsoft Azure). Tiada nama staf, nombor IC atau nombor telefon dihantar.',
    off: 'Cadangan draf belum dihidupkan. Isi borang seperti biasa.',
    busy: 'Sila cuba sebentar lagi.',
    failed: 'Cadangan tidak dapat dibuat. Isi borang seperti biasa.',
  },
  en: {
    title: 'Suggested draft',
    ask: 'Get a suggestion',
    use: 'Use this suggestion',
    discard: 'Discard',
    check: 'This is a suggestion only. Check and change it before you use it. Nothing is saved until you save the form.',
    sent: "The job details in this form are sent to the company's draft suggestion service (Microsoft Azure). No staff names, IC numbers or phone numbers are sent.",
    off: 'Suggested drafts are not switched on yet. Fill in the form as usual.',
    busy: 'Please try again shortly.',
    failed: 'No suggestion could be made. Fill in the form as usual.',
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Who may ask

/**
 * The same people who write the record by hand: the Asset Management team for a BQ, HR (and a company manager for
 * their own company's vacancy) for a post, and Finance staff for a bill. Approvers who do not write the record do not
 * get the helper. System sign-ins and closed accounts never do.
 */
export function draftHelpAllowed(user: User, kind: DraftHelpKind, today?: string): boolean {
  if (user.integration || user.role === 'site_device' || user.role === 'guard') return false;
  if (user.accessClosedFrom && today && user.accessClosedFrom <= today) return false;
  switch (kind) {
    case 'bq':
      return assetRole(user) === 'team';
    case 'job-post':
      return (user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user) || user.role === 'company_manager';
    case 'bill':
      return user.role === 'pwvsb_officer' && (user.department === 'finance' || user.leadership === 'finance_director');
  }
}

/** The kinds this person may ask for (for the status call). Group leaders who only approve get none. */
export function draftHelpKindsFor(user: User, today?: string): DraftHelpKind[] {
  return DRAFT_HELP_KINDS.filter((k) => draftHelpAllowed(user, k, today));
}

// ---------------------------------------------------------------------------------------------------------------
// Personal data never sent

const SEP = '[\\s.\\-]?';
const MOBILE = new RegExp(`(?<![\\d+])(?:\\+?60${SEP}|0)1\\d${SEP}\\d{3,4}${SEP}\\d{4}(?!\\d)`, 'g');
const IC = new RegExp(`(?<!\\d)(\\d{2})(\\d{2})(\\d{2})${SEP}\\d{2}${SEP}\\d{4}(?!\\d)`, 'g');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Card-like runs: 13 to 19 digits, optionally in groups of four. */
const CARD = /(?<!\d)(?:\d{4}[\s-]?){3}\d{1,7}(?!\d)/g;

function icMatches(text: string): string[] {
  return [...text.matchAll(IC)]
    .filter((m) => {
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
    })
    .map((m) => m[0]);
}

export function personalNumbersIn(text: string): { ic: string[]; mobile: string[]; email: string[] } {
  return { ic: icMatches(text), mobile: [...text.matchAll(MOBILE)].map((m) => m[0]), email: [...text.matchAll(EMAIL)].map((m) => m[0]) };
}

/** Replaces IC numbers, mobile numbers and emails (and, for bills, card-like numbers) before anything is sent. */
export function redactPersonal(text: string, opts: { keepEmail?: boolean; cards?: boolean; icWithDashesOnly?: boolean } = {}): string {
  let out = text;
  // On a bill a 12-digit account number can look like an IC, so there only an IC written with dashes is removed.
  for (const ic of icMatches(out)) if (!opts.icWithDashesOnly || /^\d{6}-\d{2}-\d{4}$/.test(ic)) out = out.split(ic).join('[dibuang]');
  out = out.replace(MOBILE, '[dibuang]');
  if (!opts.keepEmail) out = out.replace(EMAIL, '[dibuang]');
  if (opts.cards) out = out.replace(CARD, (m) => (m.replace(/\D/g, '').length >= 13 ? '[dibuang]' : m));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs: only whitelisted job facts

export class DraftHelpInputError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function text(x: unknown, name: string, max: number, required = false): string {
  if (x == null || x === '') {
    if (required) throw new DraftHelpInputError(`${name} is needed.`);
    return '';
  }
  if (typeof x !== 'string' || x.length > max || CONTROL.test(x)) throw new DraftHelpInputError(`${name} is not valid.`);
  return x.replace(/\r\n?/g, '\n').trim();
}

export interface BqHelpInput {
  title: string;
  jobKind: string;
  /** The job details the team filled in (rule AM-BQ-BRIEF), by question. */
  details: Record<string, string>;
  /** Site measurements, by name, in the unit of the name (for example "Wall area (m²)"). */
  measurements: Record<string, number>;
  notes: string;
}

export interface PostHelpInput {
  title: string;
  department: string;
  headcount: number;
  category: 'staff' | 'guard' | 'officer';
  employer: string;
  payFrom: number | null;
  payTo: number | null;
  applyHow: string;
  closingDate: string | null;
}

export interface BillHelpInput {
  /** The bill's text (pasted, or read from the PDF or photo on the phone first). */
  text: string;
}

export type DraftHelpInput = { kind: 'bq'; input: BqHelpInput } | { kind: 'job-post'; input: PostHelpInput } | { kind: 'bill'; input: BillHelpInput };

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const isoDay = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;

/** Checks and trims what the screen sent; personal numbers are removed from every free-text field. */
export function draftHelpInput(kind: DraftHelpKind, raw: unknown): DraftHelpInput {
  if (!isObj(raw)) throw new DraftHelpInputError('Send the form details.');
  if (kind === 'bq') {
    const details: Record<string, string> = {};
    const d = raw.details ?? {};
    if (!isObj(d) || Object.keys(d).length > 40) throw new DraftHelpInputError('Job details are not valid.');
    for (const [k, v] of Object.entries(d)) {
      const key = text(k, 'A detail name', 80);
      const val = text(v, `Detail "${key}"`, 600);
      if (key && val) details[redactPersonal(key)] = redactPersonal(val);
    }
    const measurements: Record<string, number> = {};
    const m = raw.measurements ?? {};
    if (!isObj(m) || Object.keys(m).length > 40) throw new DraftHelpInputError('Measurements are not valid.');
    for (const [k, v] of Object.entries(m)) {
      const n = num(v);
      if (n == null || n < 0 || n > 1_000_000) throw new DraftHelpInputError(`Measurement "${k}" is not valid.`);
      measurements[redactPersonal(text(k, 'A measurement name', 80))] = n;
    }
    const input: BqHelpInput = {
      title: redactPersonal(text(raw.title, 'The job title', 200, true)),
      jobKind: text(raw.jobKind, 'The kind of job', 40, true),
      details,
      measurements,
      notes: redactPersonal(text(raw.notes, 'Notes', 2000)),
    };
    if (!Object.keys(measurements).length && !Object.keys(details).length) throw new DraftHelpInputError('Fill in the job details or a measurement first.');
    return { kind, input };
  }
  if (kind === 'job-post') {
    const category = raw.category ?? 'staff';
    if (category !== 'staff' && category !== 'guard' && category !== 'officer') throw new DraftHelpInputError('The category is not valid.');
    const headcount = num(raw.headcount) ?? 1;
    if (!Number.isInteger(headcount) || headcount < 1 || headcount > 500) throw new DraftHelpInputError('The headcount is not valid.');
    const payFrom = raw.payFrom == null ? null : num(raw.payFrom);
    const payTo = raw.payTo == null ? null : num(raw.payTo);
    if ((raw.payFrom != null && (payFrom == null || payFrom < 0)) || (raw.payTo != null && (payTo == null || payTo < 0))) throw new DraftHelpInputError('The pay is not valid.');
    if (payFrom != null && payTo != null && payTo < payFrom) throw new DraftHelpInputError('The pay range is not valid.');
    const closingDate = raw.closingDate == null || raw.closingDate === '' ? null : text(raw.closingDate, 'The closing date', 10);
    if (closingDate && !isoDay(closingDate)) throw new DraftHelpInputError('The closing date is not valid.');
    const applyHow = text(raw.applyHow, 'How to apply', 300);
    // The apply line is published as written, so the official number may stay; an IC never may.
    if (icMatches(applyHow).length) throw new DraftHelpInputError('Remove the IC number from "How to apply".');
    return {
      kind,
      input: {
        title: redactPersonal(text(raw.title, 'The job title', 120, true)),
        department: redactPersonal(text(raw.department, 'The department', 120)),
        headcount,
        category,
        employer: redactPersonal(text(raw.employer, 'The employer', 160, true)),
        payFrom,
        payTo,
        applyHow,
        closingDate,
      },
    };
  }
  const t = text(raw.text, 'The bill text', DRAFT_HELP_RULE.maxSourceChars, true);
  return { kind, input: { text: redactPersonal(t, { keepEmail: true, cards: true, icWithDashesOnly: true }) } };
}

/** Hash of exactly what was sent (kept in the audit; the text itself is not). */
export function draftHelpInputHash(input: DraftHelpInput): string {
  return sha256Hex(JSON.stringify(input));
}

// ---------------------------------------------------------------------------------------------------------------
// Outputs: checked before anyone sees them

export class DraftHelpOutputError extends Error {
  constructor(message: string) {
    super(message);
  }
}
const bad = (why: string): never => {
  throw new DraftHelpOutputError(why);
};
function exactKeys(x: unknown, keys: readonly string[]): x is Record<string, unknown> {
  return isObj(x) && Object.keys(x).length === keys.length && keys.every((k) => k in x);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BqSuggestionLine {
  /** "A1", "A2", ... given by Prima, not the model. */
  code: string;
  item: string;
  qty: number;
  unit: BqUnit;
  /** How the quantity was worked out ("7.2 x 6.0"), or "Anggaran" when estimated. */
  working: string;
  /** 'measured' when it follows from a measurement given; 'estimate' when it must be checked on site. */
  basis: 'measured' | 'estimate';
  /** Priced separately and may be left out ("Pilihan"). */
  optional: boolean;
}
export interface BqSuggestion {
  sections: { code: string; title: string; lines: BqSuggestionLine[] }[];
  notes: string[];
}

function unitOf(u: unknown): BqUnit | null {
  if (typeof u !== 'string') return null;
  const s = u.trim().replace(/^m2$/i, 'm²').replace(/^m3$/i, 'm³').replace(/^ls$/i, 'LS').replace(/^nos?\.?$/i, 'no');
  return (BQ_UNITS as readonly string[]).includes(s) ? (s as BqUnit) : null;
}
const CLEAN_LINE = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
/** A money figure anywhere in a BQ suggestion. */
const PRICE_WORDS = /\b(RM|MYR)\s?\d/i;

/**
 * A BQ suggestion. Any price, rate or amount from the model is refused (the whole answer, not just the line), so the
 * team can never mistake a model figure for a price. Quantities must be positive; units must be ours.
 */
export function checkBqSuggestion(raw: unknown): { suggestion: BqSuggestion; warnings: string[] } {
  if (!exactKeys(raw, ['sections', 'notes']) || !Array.isArray(raw.sections) || !Array.isArray(raw.notes)) bad('shape');
  const r = raw as { sections: unknown[]; notes: unknown[] };
  if (!r.sections.length || r.sections.length > DRAFT_HELP_RULE.maxBqSections) bad('sections');
  const warnings = new Set<string>(['QUANTITIES_TO_CHECK_ON_SITE', 'NO_RATES_FROM_HELPER']);
  let total = 0;
  const sections = r.sections.map((s, si) => {
    if (!exactKeys(s, ['title', 'lines']) || typeof s.title !== 'string' || !Array.isArray(s.lines)) bad('section');
    const sec = s as { title: string; lines: unknown[] };
    const code = String.fromCharCode(65 + si);
    if (!sec.title.trim() || sec.title.length > 160 || PRICE_WORDS.test(sec.title)) bad('section title');
    const lines = sec.lines.map((l, li): BqSuggestionLine => {
      if (!exactKeys(l, ['item', 'qty', 'unit', 'working', 'basis', 'optional'])) bad('line');
      const line = l as Record<string, unknown>;
      if (typeof line.item !== 'string' || !line.item.trim() || line.item.length > 400 || PRICE_WORDS.test(line.item)) bad('item');
      if (typeof line.working !== 'string' || line.working.length > 200 || /\bRM\s?\d/i.test(line.working)) bad('working');
      const qty = num(line.qty);
      if (qty == null || qty <= 0 || qty > 1_000_000) bad('qty');
      const unit = unitOf(line.unit);
      if (!unit) bad('unit');
      if (line.basis !== 'measured' && line.basis !== 'estimate') bad('basis');
      if (typeof line.optional !== 'boolean') bad('optional');
      const working = CLEAN_LINE(line.working as string, 200);
      const basis = line.basis === 'measured' && working ? 'measured' : 'estimate';
      if (basis === 'estimate') warnings.add('HAS_ESTIMATED_QUANTITIES');
      if (line.optional) warnings.add('HAS_OPTIONAL_ITEMS');
      return { code: `${code}${li + 1}`, item: CLEAN_LINE(line.item as string, 400), qty: r2(qty as number), unit: unit as BqUnit, working: working || 'Anggaran', basis, optional: line.optional as boolean };
    });
    if (!lines.length) bad('empty section');
    total += lines.length;
    return { code, title: CLEAN_LINE(sec.title, 160).toUpperCase(), lines };
  });
  if (total > DRAFT_HELP_RULE.maxBqLines) bad('too many lines');
  if (r.notes.length > DRAFT_HELP_RULE.maxBqNotes || r.notes.some((n) => typeof n !== 'string' || n.length > 400)) bad('notes');
  const notes = (r.notes as string[]).map((n) => CLEAN_LINE(n, 400)).filter(Boolean);
  // The suggestion goes back to staff screens and maybe a contractor: no personal numbers in it either.
  const all = JSON.stringify({ sections, notes });
  const found = personalNumbersIn(all);
  if (found.ic.length || found.mobile.length || found.email.length) bad('personal data');
  return { suggestion: { sections, notes }, warnings: [...warnings] };
}

/**
 * The suggestion as plain BQ lines for the Asset Management form (PR #82's AmBqLine shape): the rate is always empty
 * and comes later from our past awarded quotes or the contractor. The section goes into the item text.
 */
export function bqSuggestionLines(s: BqSuggestion): { id: string; item: string; unit: string; qty: number; rate: null; rateFrom: null; note: string }[] {
  return s.sections.flatMap((sec) =>
    sec.lines.map((l) => ({
      id: `sg-${l.code}`,
      item: `${l.code} ${l.item}${l.optional ? ' (Pilihan)' : ''}`,
      unit: l.unit === 'm²' ? 'm2' : l.unit === 'm³' ? 'm3' : l.unit,
      qty: l.qty,
      rate: null,
      rateFrom: null,
      note: l.basis === 'estimate' ? `Anggaran; sahkan di tapak. ${l.working === 'Anggaran' ? '' : l.working}`.trim() : l.working,
    })),
  );
}

export interface PostSuggestion {
  bm: string;
  en: string;
  /** BM then English, as the post template lays it out. */
  text: string;
}

const DISCRIMINATORY: RegExp[] = [
  /\b(melayu|cina|india|bumiputera|chinese|malay|indian)\s+(sahaja|only)\b/i,
  /\b(lelaki|perempuan|wanita|male|female|men|women)\s+(sahaja|only)\b/i,
  /\b(islam|muslim|christian|buddhist|hindu)\s+(sahaja|only)\b/i,
  /\b(cantik|good[- ]looking|pretty|handsome)\b/i,
];
const digitsOf = (x: string) => x.replace(/\D/g, '').replace(/^60/, '0');

/**
 * Post wording. Refused when it carries an IC, an email or a mobile number that is not the official one in "How to
 * apply", any pay figure outside the approved range (or any pay at all when no range was approved), or does not name
 * the job. Wording that limits applicants by race, religion, sex or looks is refused too (HR can still write it by
 * hand, where the existing check warns).
 */
export function checkPostSuggestion(raw: unknown, f: PostHelpInput): { suggestion: PostSuggestion; warnings: string[] } {
  if (!exactKeys(raw, ['bm', 'en'])) bad('shape');
  const r = raw as { bm: unknown; en: unknown };
  if (typeof r.bm !== 'string' || typeof r.en !== 'string') bad('shape');
  const bm = (r.bm as string).replace(/\r\n?/g, '\n').trim();
  const en = (r.en as string).replace(/\r\n?/g, '\n').trim();
  if (!bm || !en || bm.length > DRAFT_HELP_RULE.maxPostChars || en.length > DRAFT_HELP_RULE.maxPostChars || CONTROL.test(bm + en)) bad('length');
  const all = `${bm}\n${en}`;
  const found = personalNumbersIn(all);
  if (found.ic.length) bad('ic');
  const allowedPhones = new Set([...f.applyHow.matchAll(MOBILE)].map((m) => digitsOf(m[0])));
  if (found.mobile.some((m) => !allowedPhones.has(digitsOf(m)))) bad('phone');
  const allowedEmails = new Set((f.applyHow.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
  if (found.email.some((e) => !allowedEmails.has(e.toLowerCase()))) bad('email');
  if (DISCRIMINATORY.some((re) => re.test(all))) bad('discrimination');
  const title = f.title.toLowerCase();
  if (!bm.toLowerCase().includes(title) && !en.toLowerCase().includes(title)) bad('title');
  // Every RM figure must sit inside the approved range (allowances included: the helper is not told any).
  const amounts = [...all.matchAll(/RM\s?([\d,]+(?:\.\d{1,2})?)/gi)].map((m) => Number(m[1].replace(/,/g, '')));
  if (amounts.length) {
    if (f.payFrom == null) bad('pay without range');
    const hi = f.payTo ?? f.payFrom!;
    if (amounts.some((n) => n < f.payFrom! || n > hi)) bad('pay outside range');
  }
  const warnings = ['CHECK_BEFORE_SENDING_FOR_APPROVAL'];
  if (f.closingDate && !all.includes(f.closingDate.slice(0, 4))) warnings.push('CLOSING_DATE_NOT_SHOWN');
  return { suggestion: { bm, en, text: `${bm}\n\n${en}` }, warnings };
}

export const BILL_FIELDS = ['billerName', 'accountNo', 'billNo', 'billDate', 'dueDate', 'periodFrom', 'periodTo', 'amountDue'] as const;
export type BillField = (typeof BILL_FIELDS)[number];
export interface BillFieldRead {
  /** Exactly as on the bill. */
  raw: string | null;
  start: number | null;
  end: number | null;
  /** The value Prima understood: an ISO date, a number in RM, or the text. Null when it could not be understood. */
  value: string | number | null;
}
export interface BillSuggestion {
  fields: Record<BillField, BillFieldRead>;
  problems: string[];
}

const BM_MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, ogo: 8, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12,
};
/** Reads DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY, YYYY-MM-DD and "01 Okt 2026" (Malaysian bills: day first). */
export function readBillDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t))) [d, m, y] = [Number(x[1]), Number(x[2]), Number(x[3].length === 2 ? `20${x[3]}` : x[3])];
  else if ((x = /^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-,]+(\d{4})$/.exec(t)) && BM_MONTHS[x[2].toLowerCase()]) [d, m, y] = [Number(x[1]), BM_MONTHS[x[2].toLowerCase()], Number(x[3])];
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isoDay(iso) ? iso : null;
}
/** "RM1,234.50", "1234.5", "RM 88.00" → 1234.5. A trailing "CR" or a minus is a credit, not an amount due. */
export function readBillAmount(s: string): number | null {
  const t = s.trim();
  if (/-|\bCR\b/i.test(t)) return null;
  const x = /^(?:RM|MYR)?\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?$/i.exec(t);
  if (!x) return null;
  const n = Number(`${x[1].replace(/,/g, '')}${x[2] ?? ''}`);
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? r2(n) : null;
}

/**
 * Where a value sits on the bill: the exact text first, then the same words with different spacing or line breaks (a
 * model often tidies spaces). Null when the text is not on the bill at all. Prima finds the place itself; a model is
 * never trusted to count character positions.
 */
export function locateOnBill(source: string, raw: string): { start: number; end: number } | null {
  const exact = source.indexOf(raw);
  if (exact >= 0) return { start: exact, end: exact + raw.length };
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
  const m = re.exec(source);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * The figures read from a bill. Each value must be text that is really on the bill (Prima finds where), otherwise the
 * whole reading is refused. A value the screen cannot understand is left empty with a problem noted; staff type it.
 */
export function checkBillSuggestion(raw: unknown, source: string): { suggestion: BillSuggestion; warnings: string[] } {
  if (!exactKeys(raw, ['fields']) || !exactKeys((raw as { fields: unknown }).fields, BILL_FIELDS)) bad('shape');
  const f = (raw as { fields: Record<string, unknown> }).fields;
  const problems: string[] = [];
  const fields = {} as Record<BillField, BillFieldRead>;
  for (const k of BILL_FIELDS) {
    const v = f[k];
    if (!exactKeys(v, ['raw'])) bad('field');
    const e = v as { raw: unknown };
    if (e.raw === null) {
      fields[k] = { raw: null, start: null, end: null, value: null };
      if (k === 'amountDue' || k === 'billerName') problems.push(`MISSING_${k}`);
      continue;
    }
    if (typeof e.raw !== 'string' || !e.raw.trim() || e.raw.length > 160) bad('evidence');
    const at = locateOnBill(source, e.raw as string);
    if (!at) bad('evidence');
    const { start, end } = at!;
    const onBill = source.slice(start, end);
    let value: string | number | null = onBill.replace(/\s+/g, ' ').trim();
    if (k === 'billDate' || k === 'dueDate' || k === 'periodFrom' || k === 'periodTo') {
      value = readBillDate(value);
      if (!value) problems.push(`UNREADABLE_${k}`);
    } else if (k === 'amountDue') {
      value = readBillAmount(value);
      if (value == null) problems.push('UNREADABLE_amountDue');
    } else if (value.includes('[dibuang]')) {
      value = null;
      problems.push(`REMOVED_${k}`);
    }
    fields[k] = { raw: onBill, start, end, value };
  }
  const d = (k: BillField) => fields[k].value as string | null;
  if (d('billDate') && d('dueDate') && d('dueDate')! < d('billDate')!) problems.push('DUE_BEFORE_BILL_DATE');
  if (d('periodFrom') && d('periodTo') && d('periodTo')! < d('periodFrom')!) problems.push('PERIOD_ENDS_BEFORE_START');
  return { suggestion: { fields, problems }, warnings: ['CONFIRM_EVERY_FIGURE', 'ATTACH_THE_BILL_AS_USUAL'] };
}

// ---------------------------------------------------------------------------------------------------------------
// What the screen receives

export interface DraftHelpResult<T = BqSuggestion | PostSuggestion | BillSuggestion> {
  suggestionId: string;
  kind: DraftHelpKind;
  /** Always a suggestion: unverified, never saved or applied by Prima. */
  origin: 'suggestion';
  unverified: true;
  savedRecords: 0;
  inputSha256: string;
  at: string;
  suggestion: T;
  warnings: string[];
}

export function checkDraftHelpOutput(input: DraftHelpInput, raw: unknown): { suggestion: BqSuggestion | PostSuggestion | BillSuggestion; warnings: string[] } {
  if (input.kind === 'bq') return checkBqSuggestion(raw);
  if (input.kind === 'job-post') return checkPostSuggestion(raw, input.input);
  return checkBillSuggestion(raw, input.input.text);
}