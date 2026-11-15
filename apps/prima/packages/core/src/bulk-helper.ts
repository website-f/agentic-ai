// Data manager and file manager for bulk loads (Fitri package K8 / N2, approved by Fauzan 11 Nov 2026: "so it sends
// to correct places when bulk data are loaded"). Both only SUGGEST: a person checks and corrects every suggestion, and
// nothing is saved until the normal import preview and commit (or the normal paper upload) run under that person's own
// rights. This is the fixed rule-based matcher that works with the AI switched off. An AI helper may later be added
// behind BULK_HELPER_AI_ENABLED (off; needs Azure OpenAI and Fauzan's go-ahead); bulkHelperAiBrief is all it would be
// sent: column headings and the SHAPE of a few values, never the values, names or ID numbers.
import { IMPORTABLE_KINDS } from './org-import';
import { RECORD_KINDS } from './records';
import type { FieldSpec, RecordKind } from './records';

// Agentic Office: the office's import also takes item lists and other kinds that are not record forms; the data
// manager suggests only the record forms, as upstream built it.
const RECORD_IMPORT_KINDS: readonly RecordKind[] = IMPORTABLE_KINDS.filter((k): k is RecordKind => Object.prototype.hasOwnProperty.call(RECORD_KINDS, k));

export type Confidence = 'sure' | 'unsure' | 'none';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const words = (s: string) => s.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** Malay and common spreadsheet words for field words, so "Nama Tapak" finds a site name and "Tarikh Tamat" an end date. */
const SYNONYMS: Record<string, string[]> = {
  name: ['nama', 'name'],
  code: ['kod', 'code', 'ref', 'no'],
  address: ['alamat', 'address'],
  state: ['negeri', 'state'],
  phone: ['telefon', 'tel', 'phone', 'mobile', 'hp'],
  email: ['emel', 'email', 'mail'],
  start: ['mula', 'start', 'from', 'dari'],
  end: ['tamat', 'end', 'to', 'hingga', 'expiry', 'expires', 'luput'],
  date: ['tarikh', 'date'],
  number: ['nombor', 'no', 'number', 'bil'],
  company: ['syarikat', 'company'],
  amount: ['jumlah', 'amount', 'rm', 'nilai', 'value'],
  title: ['jawatan', 'title', 'position'],
  guards: ['pengawal', 'guards'],
  type: ['jenis', 'type', 'kind'],
  site: ['tapak', 'site', 'premis', 'lokasi', 'location'],
  vehicle: ['kenderaan', 'vehicle', 'plate', 'plat'],
  staff: ['kakitangan', 'staf', 'staff', 'pekerja', 'employee'],
};

/** Each word as its concept: a known word becomes its synonym group's name, so "nama" and "name" count once. */
function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(s)) out.add(Object.entries(SYNONYMS).find(([, list]) => list.includes(w))?.[0] ?? w);
  return out;
}

/** What a value looks like, without the value itself. */
export function valueShape(v: string): 'empty' | 'date' | 'number' | 'email' | 'phone' | 'id' | 'text' {
  const s = v.trim();
  if (!s) return 'empty';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return 'date';
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return 'email';
  if (/^\+?6?0?1\d[\d\s-]{6,10}$/.test(s)) return 'phone';
  if (/^\d{6}-?\d{2}-?\d{4}$/.test(s)) return 'id';
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ''))) return 'number';
  return 'text';
}

function shapeFits(f: FieldSpec, shape: ReturnType<typeof valueShape>): boolean {
  if (shape === 'empty') return true;
  if (f.type === 'date') return shape === 'date';
  if (f.type === 'number') return shape === 'number';
  if (/email/i.test(f.key)) return shape === 'email';
  if (/phone/i.test(f.key)) return shape === 'phone' || shape === 'number';
  return true;
}

function scoreField(header: string, f: FieldSpec, shapes: ReturnType<typeof valueShape>[]): number {
  if (norm(header) && (norm(header) === norm(f.key) || norm(header) === norm(f.label))) return 100;
  const h = tokens(header);
  const t = new Set([...tokens(f.key), ...tokens(f.label)]);
  if (!h.size || !t.size) return 0;
  let common = 0;
  for (const w of h) if (t.has(w)) common++;
  let s = Math.round((60 * common) / Math.max(h.size, 1) + (20 * common) / t.size);
  const filled = shapes.filter((x) => x !== 'empty');
  if (filled.length) {
    const fit = filled.filter((x) => shapeFits(f, x)).length / filled.length;
    s = Math.round(s * (0.4 + 0.6 * fit));
  }
  return s;
}

export interface ColumnSuggestion {
  index: number;
  header: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  confidence: Confidence;
  why: string;
}

/**
 * For each importable kind, how well the headings fit; and for the best (or chosen) kind, which field each column
 * goes to. A column below the threshold is left unmatched for the person to place. Two columns never get one field.
 */
export function suggestImportMapping(table: string[][], chosenKind?: RecordKind) {
  const header = table[0] ?? [];
  const rows = table.slice(1, 21);
  const shapesOf = (i: number) => rows.map((r) => valueShape(r[i] ?? ''));
  const mapFor = (kind: RecordKind) => {
    const fields = RECORD_KINDS[kind].fields;
    const pairs: { i: number; f: FieldSpec; s: number }[] = [];
    header.forEach((h, i) => fields.forEach((f) => pairs.push({ i, f, s: scoreField(h, f, shapesOf(i)) })));
    pairs.sort((a, b) => b.s - a.s);
    const usedCol = new Set<number>();
    const usedField = new Set<string>();
    const pick = new Map<number, { f: FieldSpec; s: number }>();
    for (const p of pairs) {
      if (p.s < 35 || usedCol.has(p.i) || usedField.has(p.f.key)) continue;
      usedCol.add(p.i);
      usedField.add(p.f.key);
      pick.set(p.i, { f: p.f, s: p.s });
    }
    const columns: ColumnSuggestion[] = header.map((h, i) => {
      const got = pick.get(i);
      if (!got) return { index: i, header: h, fieldKey: null, fieldLabel: null, confidence: 'none', why: 'No field matches this heading; place it yourself or leave it out.' };
      return {
        index: i,
        header: h,
        fieldKey: got.f.key,
        fieldLabel: got.f.label,
        confidence: got.s >= 80 ? 'sure' : 'unsure',
        why: got.s >= 100 ? 'Same name as the field.' : got.s >= 80 ? 'The heading words match the field.' : 'Partly matches; check it.',
      };
    });
    const score = [...pick.values()].reduce((n, x) => n + x.s, 0);
    const missing = fields.filter((f) => f.required && !usedField.has(f.key)).map((f) => f.label);
    return { kind, label: RECORD_KINDS[kind].label, score, columns, missing };
  };
  const ranked = RECORD_IMPORT_KINDS.map(mapFor).sort((a, b) => b.score - a.score);
  const best = chosenKind && RECORD_IMPORT_KINDS.includes(chosenKind) ? mapFor(chosenKind) : ranked[0];
  return {
    best,
    kinds: ranked.slice(0, 5).map((k) => ({ kind: k.kind, label: k.label, score: k.score })),
    rowFlags: rowFlags(table, best.columns),
  };
}

/** Rows that look wrong (a value of the wrong shape for its field) or repeat an earlier row. Row numbers as in the file. */
function rowFlags(table: string[][], columns: ColumnSuggestion[]) {
  const seen = new Map<string, number>();
  const out: { row: number; problems: string[] }[] = [];
  table.slice(1).forEach((cells, k) => {
    const row = k + 2;
    const problems: string[] = [];
    const key = cells.map((c) => c.trim().toLowerCase()).join('\u0001');
    if (cells.every((c) => !c.trim())) problems.push('Empty row.');
    else if (seen.has(key)) problems.push(`Same as row ${seen.get(key)}.`);
    else seen.set(key, row);
    for (const c of columns) {
      if (!c.fieldKey) continue;
      const spec = Object.values(RECORD_KINDS).flatMap((r) => r.fields).find((f) => f.key === c.fieldKey);
      if (spec && !shapeFits(spec, valueShape(cells[c.index] ?? ''))) problems.push(`${c.header}: does not look like a ${spec.type === 'date' ? 'date' : spec.type === 'number' ? 'number' : spec.label.toLowerCase()}.`);
    }
    if (problems.length) out.push({ row, problems: problems.slice(0, 5) });
  });
  return out.slice(0, 200);
}

/** The file again with the person's chosen columns: headings become field keys, unplaced columns are left out. */
export function applyImportMapping(table: string[][], mapping: (string | null)[]): string {
  const keep = mapping.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  const keys = keep.map((i) => mapping[i]!);
  if (new Set(keys).size !== keys.length) throw new Error('Two columns are placed on the same field.');
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [keys.join(','), ...table.slice(1).map((r) => keep.map((i) => cell(r[i] ?? '')).join(','))].join('\n');
}

/** What an AI helper would be sent, if it is ever switched on: headings and value shapes only. */
export function bulkHelperAiBrief(table: string[][]) {
  const header = (table[0] ?? []).map((h) => h.slice(0, 60));
  const rows = table.slice(1, 6);
  return { headings: header, shapes: header.map((_, i) => [...new Set(rows.map((r) => valueShape(r[i] ?? '')))]) };
}

// ---------- File manager ----------

export type FilingKind = 'AGREEMENT' | 'AGREEMENT_STAMPED' | 'VETTING_CERT' | 'PERMIT' | 'PASSPORT' | 'FOMEMA' | 'CSG' | 'KDN_CARD' | 'CONTRACT' | 'PHOTO' | 'OTHER';

export const BULK_FILING_LABEL: Record<FilingKind, { label: string; place: string; direct: boolean }> = {
  AGREEMENT: { label: 'Employment agreement, signed', place: 'HR file: hiring papers', direct: true },
  AGREEMENT_STAMPED: { label: 'Employment agreement, stamped', place: 'HR file: hiring papers', direct: true },
  VETTING_CERT: { label: 'KDN vetting certificate', place: 'HR file: hiring papers', direct: true },
  PERMIT: { label: 'Work permit (PLKS)', place: 'FWM: worker papers (number and dates on the paper)', direct: false },
  PASSPORT: { label: 'Passport', place: 'FWM: worker papers', direct: false },
  FOMEMA: { label: 'FOMEMA medical', place: 'FWM: worker papers', direct: false },
  CSG: { label: 'CSG certificate', place: 'People: guard papers (record the number and dates)', direct: false },
  KDN_CARD: { label: 'KDN guard card', place: 'People: guard papers (record the number and dates)', direct: false },
  CONTRACT: { label: 'Client contract', place: 'Contracts: the contract record', direct: false },
  PHOTO: { label: 'Photo', place: 'The record it belongs to (case, visit or person)', direct: false },
  OTHER: { label: 'Other paper', place: 'Choose the record by hand', direct: false },
};

const KIND_WORDS: [FilingKind, RegExp][] = [
  ['AGREEMENT_STAMPED', /(stamp|setem|duti)/i],
  ['AGREEMENT', /(agreement|perjanjian|offer|tawaran|contract.?of.?service)/i],
  ['VETTING_CERT', /(vetting|tapisan)/i],
  ['PERMIT', /(plks|permit|visa)/i],
  ['PASSPORT', /(passport|pasport)/i],
  ['FOMEMA', /fomema/i],
  ['CSG', /\bcsg\b|certified.?security.?guard/i],
  ['KDN_CARD', /(kdn|kad.?pengawal|guard.?card)/i],
  ['CONTRACT', /(contract|kontrak|tender|loa)/i],
  ['PHOTO', /\.(jpe?g|png|heic)$/i],
];

/**
 * For each file name: the paper it looks like and the person it names (by staff number, then by the whole name).
 * A file is 'sure' only with both a staff number and a paper word; everything else is held for the person to place.
 */
export function suggestFiling(fileNames: string[], people: { id: string; name: string; staffNo: string }[]) {
  const byStaff = new Map(people.filter((p) => p.staffNo).map((p) => [norm(p.staffNo), p]));
  return fileNames.slice(0, 200).map((name) => {
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    const kind = (KIND_WORDS.find(([, re]) => re.test(name))?.[0] ?? 'OTHER') as FilingKind;
    const flat = norm(base);
    // The longest staff number found inside the name wins, so SS-00012 is never read as SS-0001.
    let person = [...byStaff.entries()].filter(([k]) => k.length >= 4 && flat.includes(k)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null;
    let how: 'staff number' | 'name' | null = person ? 'staff number' : null;
    if (!person) {
      const n = norm(base);
      const hits = people.filter((p) => p.name && norm(p.name).length >= 6 && n.includes(norm(p.name)));
      if (hits.length === 1) { person = hits[0]; how = 'name'; }
    }
    const confidence: Confidence = person && how === 'staff number' && kind !== 'OTHER' ? 'sure' : person || kind !== 'OTHER' ? 'unsure' : 'none';
    return {
      file: name,
      kind,
      kindLabel: BULK_FILING_LABEL[kind].label,
      place: BULK_FILING_LABEL[kind].place,
      direct: BULK_FILING_LABEL[kind].direct,
      personId: (person?.id ?? null) as string | null,
      personName: (person?.name ?? null) as string | null,
      confidence,
      why: person ? `Person found by ${how}.` : 'No staff number or full name in the file name: choose the person.',
    };
  });
}
