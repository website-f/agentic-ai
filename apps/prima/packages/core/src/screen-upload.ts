// Upload on every screen works like Import (Fitri, 24 Nov 2026: "for upload make sure it is the same as import where
// after upload it checks all the columns, nicely done, can sort, and then save it nicely, so it's very flexible and can
// receive any kind of old file uploaded to be put into records").
//
// The toolbar's Upload reads the file on the device, then asks: which of THIS screen's records is it? Every record the
// screen loads from a file (its importable record forms and its own import kinds, SCREEN_TOOLS) is scored against the
// file's header with the import matcher (import-match.ts: English and Malay words, short forms, typos, value shapes).
// The best fit is proposed; the person may pick another. The rows then go through the same import as the screen's own
// Import button (ImportDrawer: column check, row check by the server's own save, all or none, receipt and audit).
// Nothing here decides who may write: the server checks every row exactly as it does for Import and Add.
import { COMPANY_FIELD, cleanGrid, type AlignField } from './import-align';
import { prepareSheet, smartMatch } from './import-match';
import { IMPORTABLE_KINDS, importSpec, parseCsv, type ImportKind } from './org-import';
import { SCREEN_TOOLS } from './screen-tools';

/** The fields of an importable record as the matcher reads them (the same spec the server checks with). */
export function importFields(kind: ImportKind): AlignField[] {
  const spec = importSpec(kind);
  return [
    ...spec.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type as AlignField['type'],
      required: !!f.required,
      restricted: !!f.restricted,
      // The browser matches a select by its label, as the import template sends it.
      options: f.type === 'select' ? (f.options ?? []).map(([, l]): [string, string] => [l, l]) : undefined,
      words: f.words,
    })),
    ...(spec.companyScoped ? [{ key: COMPANY_FIELD, label: 'Company', type: 'text' as const }] : []),
  ];
}

/** The records a screen's Upload may load rows into: its importable record forms, then its own import kinds. */
export function screenImportKinds(screen: string): ImportKind[] {
  const t = SCREEN_TOOLS[screen];
  if (!t || t.none) return [];
  const out: ImportKind[] = [];
  for (const k of [...(t.records ?? []), ...(t.imports ?? [])] as ImportKind[]) if (IMPORTABLE_KINDS.includes(k) && !out.includes(k)) out.push(k);
  return out;
}

export const UPLOAD_RULE = {
  /** Rows read for scoring; the whole sheet still goes to the import. */
  scoreRows: 200,
  /** Sheets of one workbook looked at. */
  maxSheets: 12,
  /** At or above: a good fit (old files rarely hold every needed field; the row check asks for the rest). */
  good: 0.45,
  /** At or above (and below good): offered, marked to check. */
  maybe: 0.22,
};

/** File types read as rows here on the device. Anything else (a scan, a photo, a zip) is a file, not rows. */
const TABLE_EXT = /\.(xlsx|xlsm|xls|csv|tsv|txt|docx|pdf)$/i;
export function isTableFile(name: string): boolean {
  return TABLE_EXT.test(String(name ?? '').trim());
}

export type KindFitLevel = 'good' | 'maybe' | 'poor';

export interface KindFit {
  kind: ImportKind;
  label: string;
  /** 0..1: how well the file's columns fit this record. */
  score: number;
  level: KindFitLevel;
  /** The sheet the score is for (the best sheet of the file for this record). */
  sheet: number;
  /** Data rows under the header of that sheet. */
  rows: number;
  /** Labels of the fields a column was found for. */
  found: string[];
  /** Labels of the needed fields no column was found for. */
  missing: string[];
  /** Columns of the file with something in them. */
  columns: number;
}

type Sheet = { name: string; rows: string[][] };

/** How one sheet fits one record: the matcher's own assignment, weighted by its confidence. */
function fitSheet(rows: string[][], fields: AlignField[]): { score: number; rows: number; found: string[]; missing: string[]; columns: number } | null {
  const p = prepareSheet(rows.slice(0, UPLOAD_RULE.scoreRows + 25), fields, null);
  if (p.table.length < 2) return null;
  const m = smartMatch(p.table, fields, { headerRow: 0 });
  const filled = m.columns.filter((c) => c.profile.fill > 0);
  if (!filled.length) return null;
  const real = fields.filter((f) => f.key !== COMPANY_FIELD);
  let weight = 0;
  const found: string[] = [];
  for (const c of m.columns) {
    if (!c.field || c.field === COMPANY_FIELD) continue;
    // A column found by its name counts in full; one found only by what its values look like counts half.
    weight += c.confidence * (c.how === 'values' ? 0.5 : 1);
    const f = real.find((x) => x.key === c.field);
    if (f) found.push(f.label);
  }
  if (!found.length) return { score: 0, rows: p.table.length - 1, found, missing: real.filter((f) => f.required).map((f) => f.label), columns: filled.length };
  const required = real.filter((f) => f.required);
  const missing = required.filter((f) => !found.includes(f.label)).map((f) => f.label);
  // How much of the file this record explains, how much of the record the file holds, and whether the needed fields are there.
  const ofFile = Math.min(1, weight / filled.length);
  const ofRecord = Math.min(1, weight / Math.max(1, Math.min(real.length, filled.length)));
  const needed = required.length ? (required.length - missing.length) / required.length : 1;
  const score = 0.4 * ofFile + 0.25 * ofRecord + 0.35 * needed;
  return { score: Math.round(score * 1000) / 1000, rows: p.table.length - 1, found, missing, columns: filled.length };
}

/**
 * Which of these records a file holds, best first. Each record is scored on each sheet with rows; its best sheet counts.
 * Ties keep the order given (the screen's own order).
 */
export function rankImportKinds(sheets: Sheet[], kinds: readonly ImportKind[]): KindFit[] {
  const usable = sheets.slice(0, UPLOAD_RULE.maxSheets).map((s) => ({ ...s, rows: cleanGrid(s.rows) }));
  const out: (KindFit & { order: number })[] = [];
  kinds.forEach((kind, order) => {
    if (!IMPORTABLE_KINDS.includes(kind)) return;
    const spec = importSpec(kind);
    const fields = importFields(kind);
    let best: (ReturnType<typeof fitSheet> & { sheet: number }) | null = null;
    usable.forEach((s, i) => {
      if (s.rows.length < 2) return;
      const f = fitSheet(s.rows, fields);
      if (f && (!best || f.score > best.score)) best = { ...f, sheet: i };
    });
    const b = best as (ReturnType<typeof fitSheet> & { sheet: number }) | null;
    const score = b?.score ?? 0;
    const level: KindFitLevel = score >= UPLOAD_RULE.good ? 'good' : score >= UPLOAD_RULE.maybe ? 'maybe' : 'poor';
    out.push({
      kind,
      label: spec.label,
      score,
      level,
      sheet: b?.sheet ?? 0,
      rows: b?.rows ?? 0,
      found: b?.found ?? [],
      missing: b?.missing ?? fields.filter((f) => f.required).map((f) => f.label),
      columns: b?.columns ?? 0,
      order,
    });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order).map(({ order: _order, ...f }) => f);
}

/**
 * Rows pasted from Excel (tabs), a CSV, or a printed list (columns two or more spaces apart, or split by "|"). Blank
 * lines at the ends are dropped; the grid is tidied as a file's would be.
 */
export function pastedRows(text: string): string[][] {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) return [];
  const filled = lines.filter((l) => l.trim());
  let rows: string[][];
  if (lines.some((l) => l.includes('\t'))) rows = lines.map((l) => l.split('\t'));
  else if (filled.filter((l) => l.includes(',')).length >= Math.max(2, filled.length / 2)) rows = parseCsv(lines.join('\n'));
  else rows = lines.map((l) => l.trim().split(/\s{2,}|\s*\|\s*/).filter((c, i, a) => c || (i > 0 && i < a.length - 1)));
  return cleanGrid(rows);
}
