import { addDays } from "./time";
import type { IsoDate } from "./types";


/**
 * Reading a signed contract or letter of award (Fauzan, 5 Nov 2026: "Make sure ai can help when signed contract or
 * letter of award uploaded"). The reader proposes values for the contract form and points at clauses to look at
 * twice. Every value carries the exact words of the paper it came from (start and end in the text), so the company
 * manager can see where it was read. Nothing is saved by reading: the company manager checks each value and saves.
 *
 * The rules reader below works everywhere, with no outside service. An online reader can add values when it is
 * switched on; its values are accepted only where the quoted words are really in the paper.
 */

export type PaperField =
  | 'paperKind'
  | 'ref'
  | 'poRef'
  | 'startOn'
  | 'endOn'
  | 'monthlyFee'
  | 'ratePerHour'
  | 'guards'
  | 'hoursPerDay'
  | 'paymentDays'
  | 'noticeDays'
  | 'bondAmount'
  | 'replaceAbsentMinutes'
  | 'incidentReportHours'
  | 'penalties';

export const PAPER_FIELDS: PaperField[] = [
  'paperKind',
  'ref',
  'poRef',
  'startOn',
  'endOn',
  'monthlyFee',
  'ratePerHour',
  'guards',
  'hoursPerDay',
  'paymentDays',
  'noticeDays',
  'bondAmount',
  'replaceAbsentMinutes',
  'incidentReportHours',
  'penalties',
];

export const PAPER_FIELD_LABEL: Record<PaperField, string> = {
  paperKind: 'Kind of paper',
  ref: 'Reference',
  poRef: "Client's PO number",
  startOn: 'Start date',
  endOn: 'End date',
  monthlyFee: 'Monthly fee',
  ratePerHour: 'Rate per guard-hour',
  guards: 'Guards',
  hoursPerDay: 'Hours a day',
  paymentDays: 'Payment within (days)',
  noticeDays: 'Notice (days)',
  bondAmount: 'Bond or guarantee',
  replaceAbsentMinutes: 'Replace absent guard (minutes)',
  incidentReportHours: 'Incident report (hours)',
  penalties: 'Penalties',
};

/** One value read from the paper, with the words it came from. */
export interface PaperValue {
  field: PaperField;
  value: string;
  /** The exact words in the paper, and where they are. */
  quote: string;
  start: number;
  end: number;
  by: 'rules' | 'online';
}

export type PaperFlagCode =
  | 'PENALTY'
  | 'INDEMNITY'
  | 'TERMINATE_ANY_TIME'
  | 'SHORT_NOTICE'
  | 'LONG_PAYMENT'
  | 'BOND'
  | 'ARMED'
  | 'NO_WAGE_CLAUSE'
  | 'FORMAL_CONTRACT_TO_FOLLOW'
  | 'AUTO_RENEW'
  | 'NO_SUBCONTRACT'
  | 'INSURANCE'
  | 'DATES_MISSING'
  | 'END_BEFORE_START'
  | 'PRICE_DIFFERS'
  | 'NO_TEXT';

export interface PaperFlag {
  code: PaperFlagCode;
  level: 'warn' | 'info';
  what: string;
  quote: string | null;
  start: number | null;
  end: number | null;
}

export interface PaperReading {
  values: PaperValue[];
  flags: PaperFlag[];
  /** Characters read; the reader looks at the first 60,000 only. */
  length: number;
}

export const PAPER_TEXT_MAX = 60_000;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, mac: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, ogo: 8, ogos: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dis: 12, disember: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
function isoOf(y: number, m: number, d: number): IsoDate | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.valueOf()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Dates in the forms Malaysian papers use: 1 December 2026, 1hb Disember 2026, 01/12/2026, 01.12.2026, 2026-12-01. */
const DATE_RE =
  /\b(\d{1,2})(?:st|nd|rd|th|hb|\s*haribulan)?\s+(?:of\s+)?([A-Za-z]{3,9})[,\s]+(\d{4})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/gi;

interface Hit {
  value: string;
  start: number;
  end: number;
}

function dates(text: string): Hit[] {
  const out: Hit[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let iso: IsoDate | null = null;
    if (m[1]) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (mon) iso = isoOf(Number(m[3]), mon, Number(m[1]));
    } else if (m[4]) iso = isoOf(Number(m[6]), Number(m[5]), Number(m[4]));
    else if (m[7]) iso = isoOf(Number(m[7]), Number(m[8]), Number(m[9]));
    if (iso) out.push({ value: iso, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** The first match of a pattern, with the place of one capture group (or the whole match). */
function find(text: string, re: RegExp, group = 0): (Hit & { full: Hit }) | null {
  const m = re.exec(text);
  if (!m) return null;
  const full = { value: m[0], start: m.index, end: m.index + m[0].length };
  if (!group) return { ...full, full };
  const g = m[group];
  if (g == null) return null;
  const at = m.index + m[0].indexOf(g);
  return { value: g, start: at, end: at + g.length, full };
}

const money = (s: string) => Number(s.replace(/,/g, ''));
const RM = String.raw`RM\s?([\d,]+(?:\.\d{1,2})?)`;

/** The sentence around a place in the text, cut to at most 240 characters, for a flag's quote. */
function around(text: string, start: number, end: number): { quote: string; start: number; end: number } {
  let s = start;
  let e = end;
  while (s > 0 && start - s < 120 && !/[.\n;]/.test(text[s - 1])) s--;
  while (e < text.length && e - end < 120 && !/[.\n;]/.test(text[e])) e++;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return { quote: text.slice(s, e), start: s, end: e };
}

/** Read the paper's text with fixed rules (English and Malay). Proposals only; nothing is saved. */
export function readContractText(raw: string): PaperReading {
  const text = String(raw ?? '').slice(0, PAPER_TEXT_MAX);
  const values: PaperValue[] = [];
  const flags: PaperFlag[] = [];
  const put = (field: PaperField, value: string, h: Hit) => {
    if (!values.some((v) => v.field === field)) values.push({ field, value, quote: text.slice(h.start, h.end), start: h.start, end: h.end, by: 'rules' });
  };
  const flag = (code: PaperFlagCode, level: PaperFlag['level'], what: string, h: Hit | null) => {
    if (flags.some((f) => f.code === code)) return;
    const q = h ? around(text, h.start, h.end) : null;
    flags.push({ code, level, what, quote: q?.quote ?? null, start: q?.start ?? null, end: q?.end ?? null });
  };
  if (text.replace(/\s/g, '').length < 40) {
    flag('NO_TEXT', 'warn', 'No readable text was found. A scanned picture cannot be read here: type the details, or paste the text of the paper.', null);
    return { values, flags, length: text.length };
  }

  // The kind of paper.
  const loa = find(text, /letter of award|surat setuju terima|surat penerimaan tawaran|\bLOA\b/i);
  const agreement = find(text, /\b(?:service )?agreement\b|\bperjanjian\b|\bcontract for\b/i);
  if (loa && (!agreement || loa.start < agreement.start)) put('paperKind', 'loa', loa);
  else if (agreement) put('paperKind', 'contract', agreement);

  // References.
  const ref = find(
    text,
    /\b(?:contract|agreement|award|perjanjian|kontrak|our|ruj(?:ukan)?\.?\s*(?:kami|tuan)?|ref(?:erence)?\.?)\s*(?:no\.?|number|bil\.?|num\.?)?\s*[:.]\s*([A-Z0-9][A-Z0-9/().-]{3,40}[A-Z0-9)])/i,
    1,
  );
  if (ref) put('ref', ref.value, ref);
  const po = find(text, /(?:purchase order|\bP\.?O\b\.?|pesanan tempatan|\bL\.?O\b\.?)\s*(?:no\.?|number|bil\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9/-]{3,30})/i, 1);
  if (po && po.value !== ref?.value) put('poRef', po.value, po);

  // Dates: a start word close before a date, an end word close before a date, or a period after the start.
  const ds = dates(text);
  const near = (re: RegExp) =>
    ds.find((d) => {
      const before = text.slice(Math.max(0, d.start - 90), d.start);
      return re.test(before);
    });
  // A range written out ("1 January 2027 to 31 December 2028") is the clearest reading of both dates.
  const pair = ds.find((d, k) => ds[k + 1] && /^\s*(?:-|–|to|until|till|hingga|sehingga|sampai)\s*$/i.test(text.slice(d.end, ds[k + 1].start)));
  const start = pair ?? near(/(commenc\w*|start\w*|effective|tempoh|period|tarikh mula|w\.?e\.?f\.?|mula|bermula|berkuat ?kuasa|from|dari|daripada)\W*(?:\w+\W+){0,6}$/i);
  const end = pair ? ds[ds.indexOf(pair) + 1] : near(/(expir\w*|end\w*|until|till|to|tamat|hingga|sehingga|berakhir|ending)\W*(?:\w+\W+){0,4}$/i);
  const startOn = start ?? null;
  if (startOn) put('startOn', startOn.value, startOn);
  const endOn = end && (!startOn || end.start !== startOn.start) ? end : null;
  if (endOn) put('endOn', endOn.value, endOn);
  if (startOn && !endOn) {
    const period = find(text, /(?:period|tempoh|\bfor)\s+(?:a\s+)?(?:period\s+)?(?:of\s+)?(?:[A-Za-z]+\s+){0,3}\(?(\d{1,3})\)?\s*(months?|years?|bulan|tahun)/i, 1);
    if (period) {
      const unit = /year|tahun/i.test(period.full.value) ? 12 : 1;
      const months = Number(period.value) * unit;
      if (months > 0 && months <= 120) {
        const [y, m, d] = startOn.value.split('-').map(Number);
        const tm = m - 1 + months;
        // The day before the same date N months on; when that month is shorter, its last day.
        const ty = y + Math.floor(tm / 12);
        const tmo = (tm % 12) + 1;
        const last = new Date(Date.UTC(ty, tmo, 0)).getUTCDate();
        const endIso = d <= last ? isoOf(ty, tmo, d) : isoOf(ty, tmo, last);
        if (endIso) put('endOn', d <= last ? addDays(endIso, -1) : endIso, period.full);
      }
    }
  }
  const s = values.find((v) => v.field === 'startOn')?.value;
  const e = values.find((v) => v.field === 'endOn')?.value;
  if (!s || !e) flag('DATES_MISSING', 'warn', 'The start or end date could not be read. Type it from the paper.', null);
  else if (e <= s) flag('END_BEFORE_START', 'warn', 'The end date read is not after the start date. Check both.', null);

  // Money.
  const monthly = find(text, new RegExp(`${RM}\\s*(?:\\(?[^)]{0,80}\\)?\\s*)?(?:per month|a month|monthly|sebulan|bulanan|per bulan|setiap bulan)`, 'i'), 1);
  if (monthly) put('monthlyFee', String(money(monthly.value)), monthly);
  const hourly = find(text, new RegExp(`${RM}\\s*(?:\\(?[^)]{0,80}\\)?\\s*)?(?:per hour|an hour|per guard[- ]hour|per jam|sejam)`, 'i'), 1);
  if (hourly) put('ratePerHour', String(money(hourly.value)), hourly);

  // Manpower.
  const guards = find(text, /\b(\d{1,3})\s*(?:\([a-z ]+\)\s*)?(?:orang\s+)?(?:unarmed |armed |uniformed )?(?:security guards?|guards?|pengawal(?: keselamatan)?|anggota)\b/i, 1);
  if (guards && Number(guards.value) > 0) put('guards', String(Number(guards.value)), guards);
  const hours = find(text, /\b(8|12|24)\s*[- ]?\s*(?:hours?|jam)\b(?:\s*(?:shift|syif|per day|a day|sehari))?/i, 1);
  if (hours) put('hoursPerDay', hours.value, hours);

  // Terms.
  const pay = find(text, /(?:pay\w*|invoice\w*|bayar\w*|invois)[^.;\n]{0,80}?(?:within|dalam (?:tempoh|masa))\s*(?:[a-z-]+\s*\()?(\d{1,3})\)?\s*(?:\([a-z ]+\)\s*)?(?:calendar |working )?(?:days|hari)/i, 1);
  if (pay) put('paymentDays', pay.value, pay);
  const notice =
    find(text, /(?:[a-z-]+\s*\()?(\d{1,3})\)?\s*(?:\([a-z ]+\)\s*)?(?:days'?|hari)\s*(?:'|’)?\s*(?:prior\s+)?(?:written\s+)?notice/i, 1) ??
    find(text, /notis\s*(?:bertulis\s*)?(?:selama\s*|tidak kurang daripada\s*)?(\d{1,3})\s*(?:\([a-z ]+\)\s*)?hari/i, 1);
  if (notice) put('noticeDays', notice.value, notice);
  else {
    const months = find(text, /(?:notice of\s*|notis\s*(?:bertulis\s*)?(?:selama\s*)?)?(?:[a-z-]+\s*\()?(\d{1,2})\)?\s*(?:\([a-z ]+\)\s*)?(?:months?'?|bulan)\s*(?:prior\s+)?(?:written\s+)?(?:notice|notis)?/i, 1);
    if (months && /notice|notis/i.test(months.full.value)) put('noticeDays', String(Number(months.value) * 30), months.full);
  }
  const bond = find(text, /performance bond|bank guarantee|bon pelaksanaan|jaminan bank|security deposit|deposit keselamatan/i);
  if (bond) {
    const amt = new RegExp(RM, 'i').exec(text.slice(bond.start, bond.start + 200));
    if (amt) {
      const at = bond.start + amt.index + amt[0].indexOf(amt[1]);
      put('bondAmount', String(money(amt[1])), { value: amt[1], start: at, end: at + amt[1].length });
    }
    flag('BOND', 'info', 'The paper asks for a bond, guarantee or deposit: Finance must lodge it (item W8).', bond);
  }
  const repl = find(text, /(?:replace\w*|relief|ganti\w*)[^.;\n]{0,60}?within\s*(\d{1,3})\s*(?:minutes|mins|minit)/i, 1) ?? find(text, /dalam (?:tempoh )?(\d{1,3})\s*minit/i, 1);
  if (repl) put('replaceAbsentMinutes', repl.value, repl);
  const inc = find(text, /(?:incident|kejadian|insiden)[^.;\n]{0,80}?within\s*(\d{1,3})\s*(?:hours|jam)/i, 1) ?? find(text, /(?:incident|kejadian|insiden)[^.;\n]{0,80}?dalam (?:tempoh )?(\d{1,3})\s*jam/i, 1);
  if (inc) put('incidentReportHours', inc.value, inc);

  // Clauses to look at twice.
  const pen = find(text, /liquidated damages|\bLAD\b|penalt(?:y|ies)|\bdenda\b|ganti rugi tertentu/i);
  if (pen) {
    const q = around(text, pen.start, pen.end);
    put('penalties', q.quote.slice(0, 240), { value: q.quote, start: q.start, end: Math.min(q.end, q.start + 240) });
    flag('PENALTY', 'warn', 'Penalties or liquidated damages: check the amounts and when they apply.', pen);
  }
  const ind = find(text, /indemnif\w*[^.;\n]{0,80}(?:any|all|whatsoever)|unlimited liabilit\w*|tanggung rugi[^.;\n]{0,60}(?:semua|apa-apa)/i);
  if (ind) flag('INDEMNITY', 'warn', 'A wide indemnity or unlimited liability: check it is covered by insurance.', ind);
  const conv = find(text, /terminat\w*[^.;\n]{0,80}(?:at any time|without (?:any )?(?:cause|reason))|(?:tamat|menamatkan|penamatan)\w*[^.;\n]{0,60}(?:pada bila-bila masa|tanpa (?:apa-apa )?sebab)/i);
  if (conv) flag('TERMINATE_ANY_TIME', 'warn', 'The client may end the contract at any time or without a reason.', conv);
  const nd = values.find((v) => v.field === 'noticeDays');
  if (nd && Number(nd.value) < 30) flag('SHORT_NOTICE', 'warn', `Only ${nd.value} days' notice.`, nd);
  const pd = values.find((v) => v.field === 'paymentDays');
  if (pd && Number(pd.value) > 60) flag('LONG_PAYMENT', 'warn', `Payment within ${pd.value} days: longer than 60.`, pd);
  const armed = find(text, /\barmed\b|bersenjata|senjata api|firearm|shotgun|pistol|\brevolver\b/i);
  if (armed) flag('ARMED', 'info', 'Armed guards are mentioned: tick the armed sites so the Arms Control items open (W10).', armed);
  if (!/minimum wage|gaji minimum|price (?:adjustment|revision|review)|semakan (?:semula )?(?:harga|kadar)|revision of (?:rates|charges)|statutory (?:wage|increase)/i.test(text))
    flag('NO_WAGE_CLAUSE', 'info', 'No clause found for a price change when the minimum wage or statutory costs rise.', null);
  const formal = find(text, /subject to (?:the )?(?:signing|execution) of (?:a |the )?formal|perjanjian formal akan|tertakluk kepada (?:pemeteraian|penandatanganan)/i);
  if (formal) flag('FORMAL_CONTRACT_TO_FOLLOW', 'info', 'A formal contract is still to be signed: record this as a letter of award, then record the contract when signed.', formal);
  const auto = find(text, /automatic(?:ally)? renew\w*|renew\w* automatically|diperbaharui secara automatik/i);
  if (auto) flag('AUTO_RENEW', 'info', 'The contract renews by itself unless notice is given: note the date to decide.', auto);
  const sub = find(text, /shall not (?:sub-?contract|assign)|tidak (?:dibenarkan )?(?:men)?subkontrak/i);
  if (sub) flag('NO_SUBCONTRACT', 'info', 'No subcontracting: the guards must be our own company\'s.', sub);
  const ins = find(text, /public liability|insurans liabiliti awam|fidelity (?:guarantee|insurance)|workmen'?s compensation/i);
  if (ins) flag('INSURANCE', 'info', 'Insurance cover is named: check the amounts with the policy (item W8).', ins);
  // Points to check come before notes.
  flags.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1));
  return { values, flags, length: text.length };
}

/** Values from an online reader, kept only where the quoted words are really in the paper at the place given. */
export function checkOnlineValues(text: string, raw: unknown): PaperValue[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { values?: unknown }).values)) return [];
  const out: PaperValue[] = [];
  for (const v of (raw as { values: unknown[] }).values.slice(0, 40)) {
    if (!v || typeof v !== 'object') continue;
    const { field, value, quote, start, end } = v as Record<string, unknown>;
    if (typeof field !== 'string' || !(PAPER_FIELDS as string[]).includes(field)) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 240) continue;
    if (typeof quote !== 'string' || typeof start !== 'number' || typeof end !== 'number') continue;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length || text.slice(start, end) !== quote) continue;
    if (!validValue(field as PaperField, value.trim()) || !valueInQuote(field as PaperField, value.trim(), quote)) continue;
    out.push({ field: field as PaperField, value: value.trim(), quote, start, end, by: 'online' });
  }
  return out;
}

/** The value must be what the quoted words say: the same number, the same date, or the same words. */
export function valueInQuote(field: PaperField, v: string, quote: string): boolean {
  switch (field) {
    case 'paperKind':
      return v === 'loa' ? /award|setuju terima|penerimaan|\bLOA\b/i.test(quote) : /agreement|perjanjian|contract|kontrak/i.test(quote);
    case 'startOn':
    case 'endOn':
      return dates(quote).some((d) => d.value === v) || quote.includes(v);
    case 'ref':
    case 'poRef':
    case 'penalties':
      return quote.includes(v);
    default:
      return (quote.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).some((x) => Number(x) === Number(v));
  }
}

/** A value must have the right shape for its field before it can be offered for the form. */
export function validValue(field: PaperField, v: string): boolean {
  switch (field) {
    case 'paperKind':
      return v === 'contract' || v === 'loa';
    case 'startOn':
    case 'endOn':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && isoOf(Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10))) === v;
    case 'monthlyFee':
    case 'ratePerHour':
    case 'bondAmount':
      return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;
    case 'guards':
    case 'paymentDays':
    case 'noticeDays':
    case 'replaceAbsentMinutes':
    case 'incidentReportHours':
      return /^\d{1,4}$/.test(v) && Number(v) > 0;
    case 'hoursPerDay':
      return /^\d{1,2}$/.test(v) && Number(v) > 0 && Number(v) <= 24;
    default:
      return v.length <= 240;
  }
}

/** Rules first; an online value is added only for a field the rules did not read, or shown beside a different one. */
export function mergeReadings(rules: PaperReading, online: PaperValue[]): PaperReading {
  const values = [...rules.values];
  for (const v of online) if (!values.some((x) => x.field === v.field && x.value === v.value)) values.push(v);
  return { ...rules, values };
}