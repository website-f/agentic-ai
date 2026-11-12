// K8 / N1 (Fauzan, 11 Nov 2026: "Do also AI data manager and file manager, so it sends to correct places when bulk data
// are loaded"): the rules that propose where a bulk file goes. Nothing here saves anything.
//
//  - Data manager: one spreadsheet (staff, sites, items, clients, workers ...). Every record kind the person may write is
//    scored against the file with the P90 column matcher (import-match.ts smartMatch: header words in English and Malay,
//    typos, what the values look like, the best whole assignment). The best fit is proposed with the field of every
//    column; a column the matcher is unsure of is HELD for the person to place. Rows that look wrong (a needed value
//    missing, a date or number that cannot be read, an IC or email that is malformed) or repeated are flagged.
//  - File manager: many files at once (certificates, permits, contracts, photos). The document type comes from the file
//    name and type; the person it belongs to from a staff number, passport or IC number, or a full name in the file name,
//    matched against the people this person keeps files for (on the server). An unsure match is held.
//  - A person confirms every plan before anything is saved: the import or staff directory steps that follow are the
//    record's own, with their own permission checks and approvals.
//  - The optional AI (Arisha on Azure OpenAI, switched off) gets only column headings, value SHAPES ("999999-99-9999",
//    "Aa Aa") and file-name shapes with document words; never a value, a name or an ID number (bulkAiRequest,
//    fileAiRequest; proven by test). It only suggests; the rule-based matcher here works on day one without it.

import { normHeader, type AlignField } from './import-align';
import { dateOrderOf, smartMatch, valueShape, isoDateOf, normIc, type SmartLevel } from './import-match';

// ---------- Destinations ----------

/** Where a bulk file can go: an import kind (org-import.ts) or the staff directory (staff-directory.ts). */
export interface BulkTarget {
  /** The import kind, or 'staffDirectory'. */
  kind: string;
  label: string;
  /** The screen that keeps the record. */
  screen: string;
  /** Who keeps it (from the record's import spec). */
  keptBy: string;
  /** Who confirms the load: the record's keeper, or for staff data HR then the HR Director. */
  confirmBy: string;
  companyScoped: boolean;
  fields: AlignField[];
}

export const STAFF_DIRECTORY_KIND = 'staffDirectory';

/** The staff directory's columns as a destination (the CSV headings the staff directory reads). */
export const STAFF_DIRECTORY_TARGET: BulkTarget = {
  kind: STAFF_DIRECTORY_KIND,
  label: 'Staff directory (office staff and mailboxes)',
  screen: 'Staff directory',
  keptBy: 'HR',
  confirmBy: 'HR sends it; the HR Director or the CEO approves it',
  companyScoped: false,
  fields: [
    { key: 'group', label: 'Group (company, central unit or region)', type: 'select', required: true, options: [['company', 'company'], ['central_unit', 'central_unit'], ['operations_region', 'operations_region']], words: ['group', 'kumpulan', 'jenis unit'] },
    { key: 'org_unit', label: 'Company, unit or region', type: 'text', required: true, words: ['org unit', 'company', 'unit', 'nama syarikat', 'syarikat', 'jabatan', 'department', 'region', 'wilayah'] },
    { key: 'name', label: 'Name', type: 'text', required: true, words: ['name', 'nama', 'nama kakitangan', 'staff name', 'nama penuh', 'full name'] },
    { key: 'title', label: 'Job title', type: 'text', words: ['title', 'job title', 'jawatan', 'position', 'designation'] },
    { key: 'email', label: 'Email (mailbox)', type: 'text', words: ['email', 'emel', 'mailbox', 'e mail', 'alamat emel'] },
    { key: 'account_type', label: 'Account type', type: 'text', words: ['account type', 'jenis akaun'] },
    { key: 'entra_status', label: 'Entra status', type: 'text', words: ['entra status', 'status entra id', 'status entra'] },
    { key: 'verified', label: 'Verified', type: 'text', words: ['verified', 'status pengesahan', 'disahkan'] },
    { key: 'account_status', label: 'Account status', type: 'text', words: ['account status', 'status akaun'] },
  ],
};

/** A destination as the data manager proposes it. */
export interface DestinationGuess {
  kind: string;
  label: string;
  /** 0..1: how well the file fits this destination. */
  fit: number;
  /** Columns matched (and with what confidence) out of the columns that hold values. */
  matched: number;
  columns: number;
  requiredMatched: number;
  required: number;
  level: SmartLevel;
  /** Plain words: why this destination. */
  why: string;
}

/** Words in a file name that point at a destination ("senarai pekerja asing.xlsx", "site list.csv"). */
const NAME_HINTS: [RegExp, string[]][] = [
  [/\b(staff|staf|kakitangan|pekerja pejabat|office staff|emel|email|outlook)\b/, ['staffDirectory', 'officeStaff']],
  [/\b(pekerja asing|foreign|fwm|nepal|plks|permit)\b/, ['fwWorker', 'fwPaper']],
  [/\b(site|sites|tapak|lokasi)\b/, ['site', 'post', 'checkpoint']],
  [/\b(client|clients|pelanggan|klien)\b/, ['client']],
  [/\b(contract|contracts|kontrak)\b/, ['contract']],
  [/\b(item|items|stock|stok|barang|inventory|inventori)\b/, ['itemList', 'itemType', 'itemStock', 'stockItem']],
  [/\b(vehicle|kenderaan|fleet|kereta)\b/, ['vehicle']],
  [/\b(supplier|pembekal|vendor)\b/, ['purSupplier', 'armsSupplier']],
  [/\b(holiday|cuti umum)\b/, ['publicHoliday']],
  [/\b(training|latihan|kursus)\b/, ['staffTraining']],
  [/\b(laptop|komputer|computer|it asset|aset it)\b/, ['itAsset']],
];

/** The destination kinds a file name points at. */
export function nameHints(fileName: string): string[] {
  const n = normHeader(fileName.replace(/\.[a-z0-9]{1,5}$/i, ''));
  return [...new Set(NAME_HINTS.filter(([re]) => re.test(n)).flatMap(([, k]) => k))];
}

/** Columns that hold at least one value. */
function filledColumns(table: string[][]): number[] {
  const width = Math.max(0, ...table.map((r) => r.length));
  const out: number[] = [];
  for (let c = 0; c < width; c++) if (table.slice(1).some((r) => String(r[c] ?? '').trim())) out.push(c);
  return out;
}

/**
 * Every destination scored against a prepared table (header row first): the share of the file's columns it can place
 * (weighted by the matcher's confidence), how many of its needed fields the file holds, and a small lift when the file
 * name says so. Best first. The table is read here only; nothing leaves the device.
 */
export function rankDestinations(table: string[][], targets: BulkTarget[], fileName = ''): DestinationGuess[] {
  const filled = filledColumns(table);
  const hints = new Set(nameHints(fileName));
  const out = targets.map((t) => {
    const m = smartMatch(table, t.fields, { headerRow: 0 });
    const placed = m.columns.filter((c) => c.field && filled.includes(c.index));
    const weight = placed.reduce((n, c) => n + (c.level === 'sure' ? 1 : c.level === 'likely' ? 0.8 : 0.45), 0);
    const required = t.fields.filter((f) => f.required).length;
    const requiredMatched = t.fields.filter((f) => f.required && placed.some((c) => c.field === f.key)).length;
    const colFit = filled.length ? weight / filled.length : 0;
    const reqFit = required ? requiredMatched / required : placed.length ? 1 : 0;
    // A destination that cannot get its needed fields from the file is never a good fit, however many columns match.
    const fit = Math.max(0, Math.min(1, 0.55 * colFit + 0.45 * reqFit + (hints.has(t.kind) ? 0.08 : 0) - (required && requiredMatched < required ? 0.15 : 0)));
    const names = placed.slice(0, 4).map((c) => `"${c.header}"`);
    const why = placed.length
      ? `${placed.length} of ${filled.length} columns match ${t.label}${names.length ? ` (${names.join(', ')}${placed.length > names.length ? ', …' : ''})` : ''}; ${requiredMatched} of ${required} needed fields found.${hints.has(t.kind) ? ' The file name says so too.' : ''}`
      : `No column matches ${t.label}.`;
    return { kind: t.kind, label: t.label, fit: Math.round(fit * 100) / 100, matched: placed.length, columns: filled.length, requiredMatched, required, level: 'check' as SmartLevel, why };
  });
  out.sort((a, b) => b.fit - a.fit || b.matched - a.matched || a.label.localeCompare(b.label));
  // Sure only when the best clearly leads and has every needed field; unsure guesses are held for the person.
  out.forEach((g, i) => {
    const gap = i === 0 ? g.fit - (out[1]?.fit ?? 0) : 0;
    g.level = i === 0 && g.fit >= 0.72 && gap >= 0.1 && g.requiredMatched === g.required ? 'sure' : g.fit >= 0.5 && g.requiredMatched === g.required ? 'likely' : 'check';
  });
  return out;
}

/** One column of the proposed plan. A held column has no field until the person places it or leaves it out. */
export interface BulkColumnPlan {
  index: number;
  header: string;
  field: string | null;
  /** The matcher's suggestion, also when held. */
  suggested: string | null;
  level: SmartLevel | null;
  held: boolean;
  why: string;
}

/** The column plan for one destination: sure and likely matches placed, unsure ones held with their suggestion. */
export function planColumns(table: string[][], target: BulkTarget): BulkColumnPlan[] {
  const m = smartMatch(table, target.fields, { headerRow: 0 });
  const filled = new Set(filledColumns(table));
  return m.columns.map((c) => {
    const held = !!c.field && c.level === 'check';
    return {
      index: c.index,
      header: c.header,
      field: held ? null : c.field,
      suggested: c.field,
      level: c.level,
      held: held && filled.has(c.index),
      why: c.why,
    };
  });
}

// ---------- Rows that look wrong or repeated ----------

export interface RowFlag {
  /** The row as the file numbers it (header row is 1). */
  row: number;
  kind: 'wrong' | 'duplicate';
  reasons: string[];
}

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
/** Field keys whose value identifies one record: two rows with the same value are the same record twice. */
const KEY_FIELD = /^(idFull|ic|icNo|passportNo|staffNo|email|code|itemCode|tag|serial|plate|regNo|ssmNo|policyNo|signedRef|permitNo)$/;

/**
 * Rows that look wrong or repeated, under a plan (field key per column index; null for a column not used). Reasons name
 * the field, never the value, so they can be kept in the load record. The record's own save checks every row again.
 */
export function flagRows(table: string[][], mapping: (string | null)[], target: BulkTarget, firstRow = 2): RowFlag[] {
  const fields = new Map(target.fields.map((f) => [f.key, f]));
  const placed = mapping.map((k) => (k ? fields.get(k) ?? null : null));
  const required = target.fields.filter((f) => f.required);
  // Each date column read in its own order: a month-first sheet ("12/25/1990") is not wrong.
  const order = placed.map((f, c) => (f?.type === 'date' ? (dateOrderOf(table.slice(1).map((r) => String(r[c] ?? '').trim()).filter(Boolean)).order ?? 'dmy') : 'dmy'));
  const flags: RowFlag[] = [];
  const seenRow = new Map<string, number>();
  const seenKey = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const row = firstRow + i;
    if (!cells.some((c) => String(c ?? '').trim())) return;
    const wrong: string[] = [];
    const value = (key: string) => {
      const c = placed.findIndex((f) => f?.key === key);
      return c >= 0 ? String(cells[c] ?? '').trim() : null;
    };
    for (const f of required) {
      const v = value(f.key);
      if (v !== null && !v) wrong.push(`${f.label} is empty.`);
    }
    placed.forEach((f, c) => {
      const v = String(cells[c] ?? '').trim();
      if (!f || !v) return;
      if (f.type === 'date' && !isoDateOf(v, order[c]) && !/^\d{4,5}(\.\d+)?$/.test(v)) wrong.push(`${f.label} is not a date Prima can read.`);
      else if (f.type === 'number' && !Number.isFinite(Number(v.replace(/[,\s]|^RM/gi, '')))) wrong.push(`${f.label} is not a number.`);
      else if (/email/i.test(f.key) && !EMAIL.test(v)) wrong.push(`${f.label} is not an email address.`);
      else if ((f.key === 'idFull' || f.key === 'icNo' || f.key === 'ic') && !/^\d{6}-\d{2}-\d{4}$/.test(normIc(v))) wrong.push(`${f.label} is not a 12-digit IC number.`);
      else if (f.type === 'select' && f.options?.length && !f.options.some(([k, l]) => normHeader(k) === normHeader(v) || normHeader(l) === normHeader(v)))
        wrong.push(`${f.label} is not one of the choices.`);
    });
    if (wrong.length) flags.push({ row, kind: 'wrong', reasons: wrong });
    const whole = placed.map((f, c) => (f ? normHeader(String(cells[c] ?? '')) : '')).join('|');
    const dupe: string[] = [];
    const first = seenRow.get(whole);
    if (whole.replace(/\|/g, '') && first !== undefined) dupe.push(`Same as row ${first}.`);
    else seenRow.set(whole, row);
    placed.forEach((f, c) => {
      const v = normHeader(String(cells[c] ?? ''));
      if (!f || !v || !KEY_FIELD.test(f.key) || first !== undefined) return;
      const k = `${f.key}|${v}`;
      const was = seenKey.get(k);
      if (was !== undefined) dupe.push(`${f.label} repeats row ${was}.`);
      else seenKey.set(k, row);
    });
    if (dupe.length) flags.push({ row, kind: 'duplicate', reasons: dupe });
  });
  return flags;
}

/** The plan as the staff directory reads it: its own CSV headings, the rows the person kept, in file order. */
export function staffDirectoryCsv(table: string[][], mapping: (string | null)[], leaveOut: number[] = [], firstRow = 2): string {
  const keys = STAFF_DIRECTORY_TARGET.fields.map((f) => f.key);
  const quote = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const skip = new Set(leaveOut);
  const lines = [keys.join(',')];
  table.slice(1).forEach((cells, i) => {
    if (skip.has(firstRow + i) || !cells.some((c) => String(c ?? '').trim())) return;
    lines.push(keys.map((k) => quote(String(cells[mapping.indexOf(k)] ?? '').replace(/\s+/g, ' ').trim())).join(','));
  });
  return lines.join('\n');
}

// ---------- File manager ----------

export type BulkDocType = 'certificate' | 'permit' | 'contract' | 'photo' | 'passport' | 'ic' | 'licence' | 'medical' | 'vetting' | 'training' | 'letter' | 'other';

/** Document types with the words file names use for them, English and Malay. */
export const BULK_DOC_TYPES: { key: BulkDocType; label: string; ms: string; words: string[] }[] = [
  { key: 'vetting', label: 'KDN vetting certificate', ms: 'Sijil tapisan KDN', words: ['vetting', 'tapisan', 'esims', 'kdn'] },
  { key: 'contract', label: 'Employment contract or agreement', ms: 'Kontrak atau perjanjian kerja', words: ['contract', 'kontrak', 'agreement', 'perjanjian', 'offer letter', 'surat tawaran', 'tawaran'] },
  { key: 'permit', label: 'Work permit or visa', ms: 'Permit kerja atau visa', words: ['permit', 'plks', 'visa', 'pas lawatan', 'vp tem', 'work pass'] },
  { key: 'passport', label: 'Passport', ms: 'Pasport', words: ['passport', 'pasport', 'paspot'] },
  { key: 'ic', label: 'Identity card (MyKad)', ms: 'Kad pengenalan (MyKad)', words: ['mykad', 'ic', 'kad pengenalan', 'identity card', 'nric', 'kp'] },
  { key: 'licence', label: 'Licence (driving, guard card)', ms: 'Lesen (memandu, kad pengawal)', words: ['licence', 'license', 'lesen', 'driving', 'memandu', 'guard card', 'kad pengawal'] },
  { key: 'medical', label: 'Medical report', ms: 'Laporan perubatan', words: ['medical', 'perubatan', 'fomema', 'health', 'kesihatan', 'checkup', 'pemeriksaan'] },
  { key: 'training', label: 'Training record', ms: 'Rekod latihan', words: ['training', 'latihan', 'kursus', 'course', 'csg', 'tng'] },
  { key: 'certificate', label: 'Certificate', ms: 'Sijil', words: ['certificate', 'cert', 'sijil', 'diploma', 'degree', 'ijazah', 'spm', 'transcript'] },
  { key: 'letter', label: 'Letter', ms: 'Surat', words: ['letter', 'surat', 'memo', 'notis', 'notice'] },
  { key: 'photo', label: 'Photo', ms: 'Gambar', words: ['photo', 'gambar', 'foto', 'pic', 'picture', 'passport photo', 'selfie', 'img', 'image'] },
  { key: 'other', label: 'Other document', ms: 'Dokumen lain', words: [] },
];
export const BULK_DOC_TYPE_KEYS = BULK_DOC_TYPES.map((d) => d.key);
const DOC_WORDS = new Set(BULK_DOC_TYPES.flatMap((d) => d.words.flatMap((w) => w.split(' '))));

/** Words of a file name: lower case, letters and digits, separators as spaces, the extension dropped. */
export function fileNameWords(name: string): string[] {
  return normHeader(
    String(name ?? '')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[_.\-+]+/g, ' '),
  )
    .split(' ')
    .filter(Boolean);
}

export interface DocTypeGuess {
  type: BulkDocType;
  level: SmartLevel;
  why: string;
}

/** The document type of a file from its name and type. A picture with no document word is a photo, likely. */
export function docTypeOf(name: string, mime: string): DocTypeGuess {
  const words = fileNameWords(name);
  const joined = ` ${words.join(' ')} `;
  const hits = BULK_DOC_TYPES.filter((d) => d.words.some((w) => joined.includes(` ${w} `)));
  if (hits.length === 1) return { type: hits[0].key, level: 'sure', why: `The file name says "${hits[0].words.find((w) => joined.includes(` ${w} `))}".` };
  if (hits.length > 1) return { type: hits[0].key, level: 'check', why: `The file name fits more than one type (${hits.map((h) => h.label.toLowerCase()).join(', ')}). Check it.` };
  if (/^image\//.test(mime)) return { type: 'photo', level: 'likely', why: 'A picture with no document word in its name.' };
  return { type: 'other', level: 'check', why: 'The file name does not say what it is. Choose the type.' };
}

/** A person a file may belong to, as the server lists them for this person (only people whose file they keep). */
export interface FileCandidate {
  id: string;
  /** What the screen shows: name and staff number. */
  label: string;
  /** Identifiers that may appear in a file name: staff number, passport, IC (matched here, on the server). */
  keys: string[];
  /** The person's name as Prima keeps it. */
  name: string;
}

export interface FilePlacement {
  personId: string | null;
  level: SmartLevel;
  why: string;
  /** Other people the name could be (ids), best first. */
  others: string[];
}

const keyNorm = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const NAME_STOP = new Set(['bin', 'binti', 'bt', 'b', 'a', 'l', 'p', 'ap', 'al', 'anak', 'a/l', 'a/p', 'mohd', 'muhammad', 'md', 'nur', 'siti', 'abdul']);

/**
 * Whose file this is: an identifier in the name (staff number, passport, IC; sure when only one person has it), else
 * every telling word of one person's name (likely when only one person fits), else held for the person to place.
 */
export function placeFile(name: string, candidates: FileCandidate[]): FilePlacement {
  const words = fileNameWords(name);
  // "SG-0001" is read as "sg 0001", "900101-14-5678" as three words: a key may span up to three words in a row.
  const spans = new Set<string>();
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 3 && i + n <= words.length; n++) spans.add(keyNorm(words.slice(i, i + n).join('')));
  const byKey = candidates.filter((c) => c.keys.some((k) => keyNorm(k).length >= 4 && /\d/.test(k) && spans.has(keyNorm(k))));
  if (byKey.length === 1) return { personId: byKey[0].id, level: 'sure', why: 'The file name holds their staff, passport or IC number.', others: [] };
  if (byKey.length > 1) return { personId: null, level: 'check', why: 'The number in the file name fits more than one person. Choose who.', others: byKey.slice(0, 5).map((c) => c.id) };
  const set = new Set(words);
  const scored = candidates
    .map((c) => {
      const parts = fileNameWords(c.name).filter((w) => w.length >= 2 && !NAME_STOP.has(w));
      const hit = parts.filter((w) => set.has(w)).length;
      return { c, hit, all: parts.length > 0 && hit === parts.length, parts: parts.length };
    })
    .filter((x) => x.hit >= 2 || (x.all && x.hit >= 1))
    .sort((a, b) => Number(b.all) - Number(a.all) || b.hit - a.hit);
  // A one-word name ("Ram") is too common to place a file on its own: offered, never chosen.
  const full = scored.filter((x) => x.all && x.parts >= 2);
  if (full.length === 1) return { personId: full[0].c.id, level: 'likely', why: 'Every part of their name is in the file name. Check it.', others: scored.filter((x) => x !== full[0]).slice(0, 4).map((x) => x.c.id) };
  if (scored.length) return { personId: null, level: 'check', why: 'Part of a name matches more than one person, or not the whole name. Choose who.', others: scored.slice(0, 5).map((x) => x.c.id) };
  return { personId: null, level: 'check', why: 'No staff number or name in the file name. Choose who.', others: [] };
}

// ---------- The optional AI, minimised ----------

/**
 * A heading as the AI may see it: words Prima knows from column names and document types kept; any other word becomes
 * its shape ("Aa"), digits become 9. So a header row that is really a person's line (no header in the file) still sends
 * no name or number.
 */
export function maskHeading(heading: string, known: Set<string>): string {
  const h = String(heading ?? '').slice(0, 60);
  if (/@/.test(h)) return 'a@a.a';
  return normHeader(h)
    .split(' ')
    .filter(Boolean)
    .map((w) => (known.has(w) && !/\d/.test(w) ? w : valueShape(w)))
    .join(' ');
}

/** A file name as the AI may see it: document words kept, every other word and number reduced to its shape. */
export function maskFileName(name: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(String(name ?? ''))?.[1]?.toLowerCase() ?? '';
  const words = fileNameWords(name).slice(0, 12).map((w) => (DOC_WORDS.has(w) ? w : valueShape(w)));
  return `${words.join(' ')}${ext ? `.${ext}` : ''}`;
}

/** The request the AI gets for a data file: what is sent, exactly. No tools, no history. */
export interface BulkAiRequest {
  history: [];
  brief: string;
  tools: null;
}

/** Known heading words: the destinations' field labels and words. */
function knownWords(targets: BulkTarget[]): Set<string> {
  const out = new Set<string>();
  for (const t of targets)
    for (const f of t.fields)
      for (const s of [f.key, f.label, ...(f.words ?? [])])
        for (const w of normHeader(s.replace(/([a-z])([A-Z])/g, '$1 $2')).split(' ')) if (w && w.length > 1) out.add(w);
  return out;
}

/**
 * The minimised question for a data file: masked headings, up to three value shapes per column, the masked file name and
 * the destinations with their field keys. Built again on the server from whatever the browser sends.
 */
export function bulkAiRequest(input: { fileName: string; columns: { index: number; header: string; samples: string[] }[] }, targets: BulkTarget[]): BulkAiRequest {
  const known = knownWords(targets);
  const cols = input.columns.slice(0, 40).map((c) => ({
    i: Number.isInteger(c.index) ? c.index : -1,
    heading: maskHeading(c.header, known),
    shapes: [...new Set((c.samples ?? []).slice(0, 3).map((s) => valueShape(String(s ?? '').slice(0, 40))).filter(Boolean))],
  }));
  const dest = targets.slice(0, 60).map((t) => ({ kind: t.kind, label: t.label.slice(0, 80), fields: t.fields.slice(0, 40).map((f) => f.key) }));
  const brief = [
    'A bulk file is being loaded into Prima. Suggest which destination it belongs to and the field of each column.',
    'Only masked column headings and value shapes are given (A = capital letter, a = small letter, 9 = digit); never values, names or numbers.',
    'Answer with JSON only: {"kind":"<destination kind>","matches":[{"i":<column index>,"key":"<field key>"}]}. Leave out any column you are not sure of. Each field at most once. Use only the kinds and field keys listed.',
    `File name: ${maskFileName(input.fileName)}`,
    `Columns: ${JSON.stringify(cols)}`,
    `Destinations: ${JSON.stringify(dest)}`,
  ].join('\n');
  return { history: [], brief: brief.slice(0, 19_000), tools: null };
}

/** The AI's answer for a data file, checked: a listed kind, known columns and that kind's fields, each once. */
export function parseBulkAiAnswer(text: string, targets: BulkTarget[], columns: number[]): { kind: string | null; matches: { index: number; field: string }[] } {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return { kind: null, matches: [] };
  let data: { kind?: unknown; matches?: unknown };
  try {
    data = JSON.parse(m[0]);
  } catch {
    return { kind: null, matches: [] };
  }
  const t = targets.find((x) => x.kind === data?.kind);
  if (!t) return { kind: null, matches: [] };
  const keys = new Set(t.fields.map((f) => f.key));
  const usedC = new Set<number>();
  const usedF = new Set<string>();
  const matches: { index: number; field: string }[] = [];
  for (const x of Array.isArray(data.matches) ? data.matches.slice(0, 100) : []) {
    const i = Number((x as { i?: unknown })?.i);
    const key = String((x as { key?: unknown })?.key ?? '');
    if (!Number.isInteger(i) || !columns.includes(i) || !keys.has(key) || usedC.has(i) || usedF.has(key)) continue;
    usedC.add(i);
    usedF.add(key);
    matches.push({ index: i, field: key });
  }
  return { kind: t.kind, matches };
}

/** The minimised question for many files: masked file names and their types only. The AI suggests the type, never who. */
export function fileAiRequest(files: { name: string; mime: string }[]): BulkAiRequest {
  const list = files.slice(0, 100).map((f, i) => ({ i, name: maskFileName(f.name), type: /^(application\/pdf|image\/(jpeg|png))$/.test(f.mime) ? f.mime : 'other' }));
  const brief = [
    'Many files are being filed in Prima. Suggest the document type of each from its masked name and file type.',
    'Names are masked: only document words are kept; other words and numbers are shapes (A, a, 9). Never guess who a file belongs to.',
    `Answer with JSON only: {"types":[{"i":<file index>,"type":"<one of ${BULK_DOC_TYPE_KEYS.join('|')}>"}]}. Leave out any file you are not sure of.`,
    `Files: ${JSON.stringify(list)}`,
  ].join('\n');
  return { history: [], brief: brief.slice(0, 19_000), tools: null };
}

/** The AI's answer for many files, checked: known indexes and types only. */
export function parseFileAiAnswer(text: string, count: number): { index: number; type: BulkDocType }[] {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) return [];
  try {
    const data = JSON.parse(m[0]) as { types?: unknown };
    const out: { index: number; type: BulkDocType }[] = [];
    const seen = new Set<number>();
    for (const x of Array.isArray(data.types) ? data.types.slice(0, 200) : []) {
      const i = Number((x as { i?: unknown }).i);
      const type = String((x as { type?: unknown }).type ?? '') as BulkDocType;
      if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i) || !BULK_DOC_TYPE_KEYS.includes(type)) continue;
      seen.add(i);
      out.push({ index: i, type });
    }
    return out;
  } catch {
    return [];
  }
}
