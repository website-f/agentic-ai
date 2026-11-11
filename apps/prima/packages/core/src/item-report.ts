// P98 (Fitri, 11 Nov 2026: "Import to import the whole file (Excel, CSV, PDF) ... the algorithm must be advanced enough
// to check all the columns and put them in, with all the records there"): the item lists and stock reports an
// accounting package prints, read into Prima's item catalogue, whatever the file.
//
// Three kinds of report are read as they are printed, and any other list with item columns is read as a table:
//  - a stock item list: Item Code | Description | Stock Group | UOM | Rate | Cost | Price, items under group headings,
//    a second unit on its own line (BOX then PCS), the last supplier cost lines under an item, "Total Items : N";
//  - a stock quantity balance: Item Code | Description | ... | Base Qty | Base UOM, long codes wrapped onto 2-3 lines,
//    negative balances, "Total Items: N";
//  - a stock card (movement ledger): a heading per item ("CODE DESCRIPTION"), then Date | Doc No | Description |
//    Qty In | Qty Out | Bal Qty rows, the first "(Balance b/d)", a total line per item, "... Continued" across pages.
//
// A PDF is read on the server (pdfjs-dist gives each piece of text with its place on the page): pieces are grouped
// into lines, the header line is found, the columns are placed from the header's positions, a line that only carries
// the rest of a wrapped code or name is joined to the line above, and what is printed on every page (title, company,
// date, "Page N of M", the header again) is dropped. Excel, CSV and Word tables arrive as rows of cells. Both then go
// through the same reading (itemsFromTable): the person may change any column's field first. Items with the same code
// in several files become one item (mergeItemFiles). Nothing here saves anything: the import (kind itemList) sends each
// item through the Items screen's own actions, with their permission checks.

import { findHeader, composeHeader, headerMatch, isTotalsRow, smartMatch } from './import-match';
import { normHeader, type AlignField } from './import-align';
import { itemCategoryOf, itemCodeOf } from './item-import';
import { type ItemCategory } from './items';

// ---------- Fields ----------

export type ItemReportField =
  | 'itemCode'
  | 'itemName'
  | 'stockGroup'
  | 'uom'
  | 'uomRate'
  | 'unitCost'
  | 'unitPrice'
  | 'balanceQty'
  | 'multiQty'
  | 'looseQty'
  | 'moveDate'
  | 'docNo'
  | 'docParty'
  | 'qtyIn'
  | 'qtyOut'
  | 'runningBal'
  | 'stockLocation'
  | 'batch'
  | 'itemSize'
  | 'itemColour'
  | 'itemBarcode'
  | 'itemNote';

/** The fields a column of an item list may hold, with the words lists use for them in English and Malay. */
export const ITEM_REPORT_FIELDS: (AlignField & { key: ItemReportField })[] = [
  { key: 'itemCode', label: 'Item code', type: 'text', words: ['item code', 'kod item', 'kod barang', 'kod stok', 'stock code', 'sku', 'part no', 'part number', 'product code', 'kod produk', 'code', 'kod', 'item no', 'no item', 'itemcode'] },
  { key: 'itemName', label: 'Description', type: 'text', words: ['description', 'keterangan', 'item name', 'nama barang', 'nama item', 'item description', 'perihal', 'butiran', 'perkara', 'product', 'produk', 'item', 'barang', 'nama'] },
  { key: 'stockGroup', label: 'Stock group', type: 'text', words: ['stock group', 'kumpulan', 'kumpulan stok', 'group', 'item group', 'stk grp', 'category', 'kategori', 'jenis', 'jenis barang', 'class', 'kelas'] },
  { key: 'uom', label: 'Unit (UOM)', type: 'text', words: ['uom', 'unit', 'unit of measure', 'unit ukuran', 's uom', 'base uom', 'unit asas', 'ukuran', 'satuan'] },
  { key: 'uomRate', label: 'Units in this UOM (rate)', type: 'number', words: ['rate', 'x rate', 'kadar', 'factor', 'faktor', 'conversion', 'nisbah', 'per pack'] },
  { key: 'unitCost', label: 'Cost', type: 'number', words: ['cost', 'kos', 'unit cost', 'kos seunit', 'ref cost', 'purchase cost', 'kos belian', 'harga kos', 'cost price'] },
  { key: 'unitPrice', label: 'Price', type: 'number', words: ['price', 'harga', 'selling price', 'harga jual', 'ref price', 'unit price', 'harga seunit', 'sale price'] },
  { key: 'balanceQty', label: 'Quantity in stock', type: 'number', words: ['qty', 'quantity', 'kuantiti', 'balance', 'baki', 'baki stok', 'stock balance', 'on hand', 'qty on hand', 'base sqty', 'sqty', 'stock qty', 'balance qty', 'jumlah stok', 'stok', 'stock', 'bal'] },
  { key: 'multiQty', label: 'Quantity in the other unit', type: 'number', words: ['multi qty', 'multi', 'qty multi'] },
  { key: 'looseQty', label: 'Loose quantity', type: 'number', words: ['loose qty', 'loose', 'kuantiti lepas'] },
  { key: 'moveDate', label: 'Date', type: 'date', words: ['date', 'tarikh', 'doc date', 'tarikh dokumen', 'trans date'] },
  { key: 'docNo', label: 'Document no.', type: 'text', words: ['doc no', 'document no', 'doc number', 'no dokumen', 'reference', 'ref', 'rujukan', 'no rujukan', 'invoice no', 'do no'] },
  { key: 'docParty', label: 'From or to (document)', type: 'text', words: ['supplier', 'pembekal', 'customer', 'pelanggan', 'party', 'company name', 'from to', 'particulars', 'keterangan dokumen'] },
  { key: 'qtyIn', label: 'Quantity in', type: 'number', words: ['qty in', 'in', 'masuk', 'kuantiti masuk', 'received', 'terima', 'stock in'] },
  { key: 'qtyOut', label: 'Quantity out', type: 'number', words: ['qty out', 'out', 'keluar', 'kuantiti keluar', 'issued', 'dikeluarkan', 'stock out'] },
  { key: 'runningBal', label: 'Balance after the line', type: 'number', words: ['bal qty', 'balance qty', 'running balance', 'baki kuantiti', 'baki selepas'] },
  { key: 'stockLocation', label: 'Location', type: 'text', words: ['location', 'lokasi', 'store', 'stor', 'gudang', 'warehouse', 'tempat'] },
  { key: 'batch', label: 'Batch', type: 'text', words: ['batch', 'lot', 'batch no', 'no batch', 'kelompok'] },
  { key: 'itemSize', label: 'Size', type: 'text', words: ['size', 'saiz'] },
  { key: 'itemColour', label: 'Colour', type: 'text', words: ['colour', 'color', 'warna'] },
  { key: 'itemBarcode', label: 'Barcode', type: 'text', words: ['barcode', 'kod bar', 'ean', 'upc'] },
  { key: 'itemNote', label: 'Note', type: 'text', words: ['note', 'notes', 'catatan', 'remark', 'remarks', 'ulasan'] },
];

export const ITEM_REPORT_FIELD_LABEL: Record<ItemReportField, string> = Object.fromEntries(ITEM_REPORT_FIELDS.map((f) => [f.key, f.label])) as Record<ItemReportField, string>;

export type ItemReportLayout = 'itemList' | 'qtyBalance' | 'stockCard' | 'table';
export const ITEM_REPORT_LAYOUT_LABEL: Record<ItemReportLayout, string> = {
  itemList: 'Stock item list (codes, units, cost and price)',
  qtyBalance: 'Stock quantity balance',
  stockCard: 'Stock card (movements of each item)',
  table: 'Item table',
};

/** A row of a table read from a file. A PDF marks what each line is; a sheet's rows are worked out when read. */
export interface ReportRow {
  cells: string[];
  kind?: 'data' | 'group' | 'more' | 'sub' | 'heading' | 'total';
  /** The page of a PDF, or the row number of a sheet (1-based). */
  at: number;
  /** A last supplier cost line under an item (a stock item list). */
  sub?: { supplier: string; qty: string; uom: string; cost: string };
  /** An item heading of a stock card. */
  head?: { code: string; name: string };
}

export interface ReportTable {
  source: 'pdf' | 'sheet';
  layout: ItemReportLayout;
  title: string;
  company: string | null;
  /** The date the report is as at (ISO), when printed on it. */
  asOf: string | null;
  header: string[];
  rows: ReportRow[];
  /** "Total Items : 728" printed at the end, to check the count read. */
  declaredTotal: number | null;
  pages: number;
  /** Lines left out: what is printed on every page, totals, the header again. */
  dropped: { repeated: number; totals: number; blank: number };
  /** The field of each column, as the layout prints them (the person may change any). */
  preset: (ItemReportField | null)[];
}

// ---------- Numbers and dates ----------

/** "9,773", "-71", "(71)", "1,234.50", "RM 3.00" as a number; null when not a number. */
export function reportNumber(raw: string): number | null {
  let v = String(raw ?? '').trim();
  if (!v) return null;
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1).trim();
  }
  v = v.replace(/^(rm|myr)\s*/i, '').replace(/[,\s]/g, '');
  if (v.endsWith('-')) {
    neg = !neg;
    v = v.slice(0, -1);
  }
  if (v.startsWith('-')) {
    neg = !neg;
    v = v.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const isNum = (s: string) => reportNumber(s) !== null;

/** dd/mm/yy or dd/mm/yyyy (as Malaysian reports print them) to ISO; null when not such a date. */
export function reportDate(raw: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(String(raw ?? '').trim());
  if (!m) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Money as text with two decimals ("41.90"); null when not a number or negative. */
function money(raw: string | number | null | undefined): string | null {
  const n = typeof raw === 'number' ? raw : reportNumber(String(raw ?? ''));
  if (n === null || !Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return n.toFixed(2);
}

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

// ---------- Report lines that are never items ----------

const PAGE_LINE = /^(page|muka surat|halaman|ms)\s*:?\s*\d+(\s*(of|\/|daripada|dari)\s*\d+)?$/i;
const CONTINUED = /\.{2,}\s*continued|\(continued\)|bersambung/i;
const TOTAL_ITEMS = /^(total\s+items?|jumlah\s+(item|barang))\s*:?\s*([\d,]+)/i;
const GRAND_TOTAL = /^(grand\s+total|jumlah\s+besar|total|jumlah|sub\s*total)\b/i;
const BALANCE_BD = /balance\s*b\s*\/?\s*[df]|baki\s*(dibawa|b\s*\/?\s*[df])|brought\s+forward|opening\s+balance|baki\s+awal/i;

/** What a report prints above its table (title, company, the date and time, who printed it, its filters). */
function titleInfo(lines: string[]): { title: string; company: string | null; asOf: string | null } {
  let title = '';
  let company: string | null = null;
  let asOf: string | null = null;
  for (const raw of lines) {
    const l = clean(raw);
    if (!l) continue;
    const at = /\b(?:as\s+at|as\s+of|sehingga|pada)\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(l) ?? /\bto\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i.exec(l);
    if (at && !asOf) asOf = reportDate(at[1]);
    if (!company && /\b(sdn\.?\s*bhd|berhad|bhd|enterprise|trading|resources|plt)\b/i.test(l)) company = l.replace(/\s*\(.*$/, '').replace(/\s*page\s+\d+.*$/i, '').trim().slice(0, 120);
    if (!title && /stock|stok|item|barang|inventory|inventori|card|kad|balance|baki|list|senarai/i.test(l) && !/\s:\s|^[^:]{1,25}:/.test(l) && l.length <= 80) title = l.replace(/\s*\(.*\)\s*$/, '').trim();
  }
  if (!asOf)
    for (const raw of lines) {
      const d = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/.exec(raw);
      if (d) {
        asOf = reportDate(d[1]);
        if (asOf) break;
      }
    }
  return { title, company, asOf };
}

// ---------- Layouts ----------

/** The layout a header names, and the field of each of its columns as that layout prints them. */
export function layoutOf(header: string[]): { layout: ItemReportLayout; preset: (ItemReportField | null)[] } {
  const h = header.map((x) => normHeader(x));
  const has = (re: RegExp) => h.some((x) => re.test(x));
  const ledger = has(/^(date|tarikh)$/) && has(/qty in|masuk/) && has(/qty out|keluar/);
  const balance = has(/sqty|base|loose|on hand|balance|baki/) && !ledger;
  const list = has(/cost|kos/) && has(/price|harga/);
  const layout: ItemReportLayout = ledger ? 'stockCard' : list ? 'itemList' : balance ? 'qtyBalance' : 'table';
  const preset = h.map((x): ItemReportField | null => {
    if (/^(item code|kod item|kod barang|stock code|code|kod|sku)$/.test(x)) return 'itemCode';
    if (/^(description|keterangan|item name|nama barang|nama item|item description)$/.test(x)) return ledger ? 'docParty' : 'itemName';
    if (/^(stock group|stk grp|group|kumpulan|category|kategori)$/.test(x)) return 'stockGroup';
    if (/^s uom$|^base uom$/.test(x)) return 'uom';
    if (/^(uom|unit)$/.test(x)) return layout === 'qtyBalance' && h.some((y) => /^s uom$|^base uom$/.test(y)) ? null : 'uom';
    if (/rate$/.test(x)) return layout === 'itemList' ? 'uomRate' : null;
    if (/^(cost|kos|unit cost)$/.test(x)) return 'unitCost';
    if (/^(price|harga|unit price)$/.test(x)) return 'unitPrice';
    if (/sqty$|^base qty$|^on hand$|^balance$|^baki( stok)?$|^(qty|quantity|kuantiti)$/.test(x)) return layout === 'qtyBalance' && /^(qty|quantity|kuantiti)$/.test(x) && h.some((y) => /sqty$/.test(y)) ? 'multiQty' : 'balanceQty';
    if (/^loose/.test(x)) return 'looseQty';
    if (/^(date|tarikh)$/.test(x)) return 'moveDate';
    if (/^doc no|^no dokumen|^reference$/.test(x)) return 'docNo';
    if (/^qty in$|^masuk$/.test(x)) return 'qtyIn';
    if (/^qty out$|^keluar$/.test(x)) return 'qtyOut';
    if (/^bal qty$|^balance qty$/.test(x)) return 'runningBal';
    if (/^(location|lokasi)$/.test(x)) return 'stockLocation';
    if (/^batch$/.test(x)) return 'batch';
    return null;
  });
  return { layout, preset };
}

// ---------- PDF: positioned text to a table ----------

/** One piece of text on a PDF page, as pdfjs gives it: x and y from the bottom left, its width and font size. */
export interface PdfPiece {
  x: number;
  y: number;
  w: number;
  size: number;
  text: string;
}
export interface PdfPageText {
  pieces: PdfPiece[];
}

interface Phrase {
  x: number;
  end: number;
  size: number;
  text: string;
}
type Line = { y: number; phrases: Phrase[] };

const NUMERIC = /^[-(]?(rm\s*)?[\d,]+(\.\d+)?\)?-?$/i;

/** Pieces to lines (by height), each line's pieces joined into phrases where only a space is between them. */
function linesOf(page: PdfPageText, stops: number[] = [], tight = false): Line[] {
  const pieces = page.pieces.filter((p) => p.text.trim() && Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; items: PdfPiece[] }[] = [];
  for (const p of pieces) {
    const tol = Math.max(1.5, 0.35 * (p.size || 8));
    const line = lines.find((l) => Math.abs(l.y - p.y) <= tol);
    if (line) line.items.push(p);
    else lines.push({ y: p.y, size: p.size, items: [p] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const items = l.items.sort((a, b) => a.x - b.x);
      const phrases: Phrase[] = [];
      for (const it of items) {
        const text = it.text.replace(/\s+/g, ' ');
        const prev = phrases[phrases.length - 1];
        const size = it.size || 8;
        if (prev) {
          const gap = it.x - prev.end;
          const numeric = NUMERIC.test(text.trim()) || NUMERIC.test(prev.text.trim());
          // Column names are joined only across a plain space: "Qty" and "UOM" side by side are two columns.
          const limit = tight ? 0.3 * size : numeric ? 0.4 * size : 0.9 * size;
          // A column that starts here (from the header) is never joined to the text before it.
          const atStop = stops.some((s) => Math.abs(it.x - s) <= 2 && prev.x < s - 2);
          if (gap >= -0.5 && gap <= limit && !atStop) {
            prev.text = `${prev.text.trimEnd()} ${text.trimStart()}`;
            prev.end = Math.max(prev.end, it.x + it.w);
            continue;
          }
        }
        phrases.push({ x: it.x, end: it.x + Math.max(it.w, 0.3 * size * text.length * 0.5), size, text });
      }
      for (const p of phrases) p.text = clean(p.text);
      return { y: l.y, phrases: phrases.filter((p) => p.text) };
    });
}

const lineText = (l: Line) => l.phrases.map((p) => p.text).join(' ');

/** How many of a line's phrases are column names of an item list. */
function headerHits(l: Line): number {
  let n = 0;
  for (const p of l.phrases) {
    if (p.text.length > 30 || isNum(p.text)) continue;
    if (ITEM_REPORT_FIELDS.some((f) => (headerMatch(p.text, f)?.[0] ?? 0) >= 0.8)) n++;
  }
  return n;
}

interface Col {
  name: string;
  x: number;
  end: number;
  /** Data in this column starts where its name starts (left aligned): a phrase reaching across it is two cells. */
  left?: boolean;
}

/** The header line's phrases as columns, with a short line above it (MULTI, = BASE) read into the names below. */
function columnsOf(head: Line, above: Line | null): Col[] {
  const cols: Col[] = head.phrases.map((p) => ({ name: p.text, x: p.x, end: p.end }));
  if (above && above.phrases.length < head.phrases.length && above.phrases.every((p) => p.text.length <= 14 && !isNum(p.text))) {
    for (const p of above.phrases) {
      const mid = (p.x + p.end) / 2;
      let best: Col | null = null;
      let dist = 40;
      for (const c of cols) {
        const d = Math.abs((c.x + c.end) / 2 - mid);
        if (d < dist) {
          dist = d;
          best = c;
        }
      }
      if (best) {
        best.name = `${p.text} ${best.name}`;
        best.x = Math.min(best.x, p.x);
        best.end = Math.max(best.end, p.end);
      } else cols.push({ name: p.text, x: p.x, end: p.end });
    }
  }
  return cols.sort((a, b) => a.x - b.x);
}

/** The column of each phrase by the most overlap with the columns' zones (the space between two names is shared). */
function zonesOf(cols: Col[]): [number, number][] {
  return cols.map((c, i) => [i === 0 ? -1e9 : (cols[i - 1].end + c.x) / 2, i === cols.length - 1 ? 1e9 : (c.end + cols[i + 1].x) / 2]);
}
function columnOf(zones: [number, number][], x: number, end: number): number {
  let best = 0;
  let most = -1;
  zones.forEach(([a, b], i) => {
    const o = Math.min(end, b) - Math.max(x, a);
    if (o > most) {
      most = o;
      best = i;
    }
  });
  return best;
}

/**
 * Code and name printed in one piece ("ADD LOGO - SASA PROADD LOGO - SASA PRO"): split where the second column starts,
 * preferring the place where the first word comes again, else by the share of the width.
 */
export function splitJoined(text: string, x: number, end: number, at: number): [string, string] {
  const share = Math.max(0, Math.min(1, (at - x) / Math.max(1, end - x)));
  const guess = Math.round(text.length * share);
  const first = text.trim().split(/\s+/)[0] ?? '';
  let cut = -1;
  if (first.length >= 2)
    for (let d = 0; d <= 5 && cut < 0; d++)
      for (const i of [guess - d, guess + d])
        if (i > 0 && i < text.length && text.slice(i).trimStart().startsWith(first) && cut < 0) cut = i;
  if (cut < 0) cut = guess;
  return [clean(text.slice(0, cut)), clean(text.slice(cut))];
}

/** A cell's text from its phrases, in order. */
const joinCell = (ps: Phrase[]) => clean(ps.map((p) => p.text).join(' '));

/**
 * The pages of a PDF report to a table. Recognises the three stock reports; anything else with an item header line
 * is read as a plain table, wrapped lines joined to the row above.
 */
export function reportFromPdf(pages: PdfPageText[]): ReportTable {
  // The header line: the first line on a page naming at least three item columns.
  let headLine: Line | null = null;
  let above: Line | null = null;
  let titleLines: string[] = [];
  for (const page of pages) {
    const lines = linesOf(page, [], true);
    // The line naming the most item columns (a short line above it, MULTI or = BASE, may name a few too).
    let k = -1;
    let most = 2;
    lines.slice(0, 60).forEach((l, i) => {
      const n = headerHits(l);
      if (n > most) {
        most = n;
        k = i;
      }
    });
    if (k >= 0) {
      headLine = lines[k];
      const prev = lines[k - 1];
      above = prev && prev.y - lines[k].y <= 3 * (lines[k].phrases[0]?.size ?? 8) && headerHits(prev) >= 1 ? prev : null;
      titleLines = lines.slice(0, k).map(lineText);
      break;
    }
  }
  if (!headLine) return emptyTable('pdf', pages.length);
  const cols = columnsOf(headLine, above);
  const header = cols.map((c) => c.name);
  const { layout, preset } = layoutOf(header);
  const info = titleInfo(titleLines);
  const headKey = normHeader(lineText(headLine));
  const aboveKey = above ? normHeader(lineText(above)) : '';
  const stops = cols.map((c) => c.x);
  const zones = zonesOf(cols);
  const ci = (f: ItemReportField) => preset.indexOf(f);
  const codeCol = ci('itemCode');
  const nameCol = layout === 'stockCard' ? -1 : ci('itemName');
  const groupCol = ci('stockGroup');
  const dateCol = ci('moveDate');
  const numCols = preset.map((f, i) => (f && ['uomRate', 'unitCost', 'unitPrice', 'balanceQty', 'multiQty', 'looseQty', 'qtyIn', 'qtyOut', 'runningBal'].includes(f) ? i : -1)).filter((i) => i >= 0);
  const rows: ReportRow[] = [];
  const dropped = { repeated: 0, totals: 0, blank: 0 };
  let declaredTotal: number | null = null;
  let sub: { zones: [number, number][]; cols: Col[] } | null = null;
  // Group names printed in the group column: a line with only one of these at the left is a group heading.
  const groupNames = new Set<string>();
  const allLines = pages.map((p) => linesOf(p, stops));
  if (groupCol >= 0)
    for (const lines of allLines)
      for (const l of lines) {
        const ps = l.phrases.filter((p) => columnOf(zones, p.x, p.end) === groupCol);
        if (ps.length && l.phrases.length >= 4) groupNames.add(normHeader(joinCell(ps)));
      }
  // Which columns are left aligned: most of their cells start where the column name starts.
  const leftHits = cols.map(() => 0);
  const cellsSeen = cols.map(() => 0);
  for (const lines of allLines.slice(0, 3)) {
    // Only the table: the lines under the page's header line.
    const hk = lines.findIndex((l) => normHeader(lineText(l)) === headKey);
    for (const l of lines.slice(hk + 1))
      for (const p of l.phrases) {
        const c = columnOf(zones, p.x, p.x + 1);
        if (columnOf(zones, p.x, p.end) !== c) continue;
        cellsSeen[c]++;
        if (Math.abs(p.x - cols[c].x) <= 3) leftHits[c]++;
      }
  }
  cols.forEach((c, i) => (c.left = cellsSeen[i] >= 3 && leftHits[i] / cellsSeen[i] >= 0.6));
  let ended = false;
  let lastData: ReportRow | null = null;
  allLines.forEach((lines, pi) => {
    const pageNo = pi + 1;
    // Everything above this page's header line is the page's own title block.
    const hk = lines.findIndex((l) => normHeader(lineText(l)) === headKey);
    let start = 0;
    if (hk >= 0) {
      dropped.repeated += hk + 1;
      start = hk + 1;
    }
    for (const line of lines.slice(start)) {
      const text = lineText(line);
      const norm = normHeader(text);
      if (ended) {
        dropped.totals++;
        continue;
      }
      if (!norm) {
        dropped.blank++;
        continue;
      }
      if (norm === headKey || (aboveKey && norm === aboveKey) || PAGE_LINE.test(text.trim()) || /\bpage\s+\d+\s+of\s+\d+\b/i.test(text)) {
        dropped.repeated++;
        continue;
      }
      const ti = TOTAL_ITEMS.exec(text.trim());
      if (ti) {
        declaredTotal = Number(ti[3].replace(/,/g, ''));
        dropped.totals++;
        ended = true;
        continue;
      }
      if (/^grand\s+total\b/i.test(text.trim())) {
        dropped.totals++;
        ended = true;
        continue;
      }
      // The page number alone at the foot of a page.
      if (line.phrases.length === 1 && /^\d{1,4}$/.test(text.trim()) && line === lines[lines.length - 1]) {
        dropped.repeated++;
        continue;
      }
      // A second, smaller header inside the table (the last supplier cost lines under an item).
      if (layout === 'itemList' && /purchase price|company name|unit cost/i.test(text) && line.phrases.length >= 3 && !line.phrases.some((p) => isNum(p.text))) {
        const sc = line.phrases.map((p) => ({ name: p.text, x: p.x, end: p.end }));
        sub = { cols: sc, zones: zonesOf(sc) };
        dropped.repeated++;
        continue;
      }
      // Cells by column; a phrase reaching across the start of a left-aligned column is split there.
      const cells: Phrase[][] = cols.map(() => []);
      for (const p of line.phrases) {
        const from = columnOf(zones, p.x, p.x + 1);
        const next = cols[from + 1];
        const own = next ? line.phrases.some((q) => q !== p && Math.abs(q.x - next.x) <= 3) : true;
        const c = next?.left && !own && p.x < next.x - 3 && p.end > next.x + 8 ? from : columnOf(zones, p.x, p.end);
        if (c === from && next?.left && !own && p.x < next.x - 3 && p.end > next.x + 8) {
          const [a, b] = splitJoined(p.text, p.x, p.end, next.x);
          cells[c].push({ ...p, text: a, end: next.x - 1 });
          if (b) cells[c + 1].push({ ...p, text: b, x: next.x });
        } else cells[c].push(p);
      }
      const values = cells.map(joinCell);
      const filled = values.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      const nums = numCols.filter((i) => values[i] && isNum(values[i]));
      const atLeft = line.phrases[0].x;
      // ----- The stock card -----
      if (layout === 'stockCard') {
        const dated = dateCol >= 0 && !!reportDate(values[dateCol]);
        if (!dated && !nums.length && atLeft < cols[dateCol >= 0 ? dateCol : 0].x - 10) {
          // An item heading: the code, then the name; or both printed in one piece.
          const ps = line.phrases.filter((p) => !CONTINUED.test(p.text));
          let code = ps[0]?.text ?? '';
          let name = ps.slice(1).map((p) => p.text).join(' ');
          if (ps.length === 1) {
            const [a, b] = halves(code);
            code = a;
            name = b;
          }
          rows.push({ cells: cols.map(() => ''), kind: 'heading', at: pageNo, head: { code: clean(code), name: clean(name || code) } });
          continue;
        }
        if (!dated && nums.length && filled.every((i) => numCols.includes(i))) {
          rows.push({ cells: values, kind: 'total', at: pageNo });
          dropped.totals++;
          continue;
        }
        rows.push({ cells: values, kind: 'data', at: pageNo });
        continue;
      }
      // ----- Lists and balances -----
      const codeText = codeCol >= 0 ? values[codeCol] : '';
      const nameText = nameCol >= 0 ? values[nameCol] : '';
      const onlyLeft = filled.every((i) => i === codeCol || i === nameCol);
      if (isTotalsRow(values) || GRAND_TOTAL.test(text.trim()) && !codeText) {
        dropped.totals++;
        continue;
      }
      // A group heading: one name at the left and nothing else, in a list that has a group column.
      if (filled.length === 1 && codeText && groupCol >= 0 && !isNum(codeText) && (groupNames.has(normHeader(codeText)) || !nameText)) {
        rows.push({ cells: values, kind: 'group', at: pageNo });
        sub = null;
        lastData = null;
        continue;
      }
      // A second unit of the item above: no code or name, a unit and figures.
      const uomCol = preset.indexOf('uom');
      if (!codeText && !nameText && uomCol >= 0 && values[uomCol] && !isNum(values[uomCol]) && nums.length >= 1) {
        rows.push({ cells: values, kind: 'more', at: pageNo });
        continue;
      }
      // A last supplier cost line under the sub-header: it never starts where the item code starts.
      if (sub && (codeCol < 0 || Math.abs(atLeft - cols[codeCol].x) > 6)) {
        const sc = sub.cols.map(() => [] as Phrase[]);
        for (const p of line.phrases) sc[columnOf(sub.zones, p.x, p.end)].push(p);
        const sv = sc.map(joinCell);
        const find = (re: RegExp) => sub!.cols.findIndex((c) => re.test(c.name));
        const pick = (re: RegExp) => {
          const i = find(re);
          return i >= 0 ? sv[i] : '';
        };
        rows.push({ cells: values, kind: 'sub', at: pageNo, sub: { supplier: pick(/company|supplier|pembekal/i), qty: pick(/^qty|kuantiti/i), uom: pick(/uom|unit$/i), cost: pick(/unit cost|cost|kos/i) } });
        continue;
      }
      // The rest of a wrapped code or name (a code on 2-3 lines, a set's contents under its name): only text at the
      // left, under the item's row. A name alone with no code above it is never an item of its own.
      if (onlyLeft && !nums.length && lastData && (codeText || nameText) && (rows[rows.length - 1] === lastData || !codeText)) {
        if (codeText) lastData.cells[codeCol] = clean(`${lastData.cells[codeCol]} ${codeText}`);
        if (nameText) lastData.cells[nameCol] = clean(`${lastData.cells[nameCol]} ${nameText}`);
        continue;
      }
      if (!codeText && !nameText) {
        dropped.blank++;
        continue;
      }
      sub = null;
      lastData = { cells: values, kind: 'data', at: pageNo };
      rows.push(lastData);
    }
  });
  return { source: 'pdf', layout, title: info.title || header.join(' | '), company: info.company, asOf: info.asOf, header, rows, declaredTotal, pages: pages.length, dropped, preset };
}

/** "CODE DESC" printed as one piece where the code repeats the name: two halves; otherwise the whole as both. */
function halves(t: string): [string, string] {
  const s = clean(t);
  // The name starts with the whole code: "RAPID TEST DIPSTICK RAPID TEST DIPSTICK (SET OF 3)".
  for (let i = s.length - 2; i >= 2; i--) {
    const head = s.slice(0, i).trim();
    if (head.length >= 2 && s.slice(i).trimStart().startsWith(head) && (s[i] === ' ' || s[i - 1] === ' ' || s.slice(i).startsWith(head))) return [head, clean(s.slice(i))];
  }
  const first = s.split(' ')[0];
  if (first.length >= 2)
    for (let i = Math.floor(s.length / 2) - 4; i <= Math.ceil(s.length / 2) + 4; i++)
      if (i > 0 && i < s.length && s.slice(i).startsWith(first) && s.slice(i).length >= 2) return [clean(s.slice(0, i)), clean(s.slice(i))];
  return [s, s];
}

function emptyTable(source: 'pdf' | 'sheet', pages: number): ReportTable {
  return { source, layout: 'table', title: '', company: null, asOf: null, header: [], rows: [], declaredTotal: null, pages, dropped: { repeated: 0, totals: 0, blank: 0 }, preset: [] };
}

// ---------- Sheets (Excel, CSV, Word) to a table ----------

/** A sheet's rows to a table: the header row found below any title block, the report's own lines worked out. */
export function reportFromGrid(grid: string[][]): ReportTable {
  const rows = grid.map((r) => r.map((c) => clean(c)));
  if (!rows.some((r) => r.some(Boolean))) return emptyTable('sheet', 1);
  const hr = findHeader(rows, ITEM_REPORT_FIELDS);
  const header = composeHeader(rows, hr).map(clean);
  const width = Math.max(header.length, ...rows.slice(hr + 1).map((r) => r.length));
  while (header.length < width) header.push('');
  const { layout, preset } = layoutOf(header);
  // Fields the layout does not settle are matched by the words and the values (fuzzy, English and Malay).
  const match = smartMatch([header, ...rows.slice(hr + 1)], ITEM_REPORT_FIELDS, { headerRow: 0 });
  const taken = new Set(preset.filter(Boolean));
  const fields = header.map((_, i) => {
    if (preset[i]) return preset[i];
    const f = match.columns.find((c) => c.index === i)?.field as ItemReportField | undefined;
    if (f && !taken.has(f)) {
      taken.add(f);
      return f;
    }
    return null;
  });
  const info = titleInfo(rows.slice(0, hr).map((r) => r.filter(Boolean).join(' ')));
  const headKey = header.map(normHeader).join('|');
  const out: ReportRow[] = [];
  const dropped = { repeated: 0, totals: 0, blank: 0 };
  let declaredTotal: number | null = null;
  for (const [k, r] of rows.slice(hr + 1).entries()) {
    const at = hr + 2 + k;
    const cells = Array.from({ length: width }, (_, i) => r[i] ?? '');
    const text = cells.filter(Boolean).join(' ');
    if (!text) {
      dropped.blank++;
      continue;
    }
    if (cells.map(normHeader).join('|') === headKey || PAGE_LINE.test(text) || /\bpage\s+\d+\s+of\s+\d+\b/i.test(text)) {
      dropped.repeated++;
      continue;
    }
    const ti = TOTAL_ITEMS.exec(text);
    if (ti) {
      declaredTotal = Number(ti[3].replace(/,/g, ''));
      dropped.totals++;
      continue;
    }
    if (isTotalsRow(cells) || /^grand\s+total\b/i.test(text)) {
      dropped.totals++;
      continue;
    }
    out.push({ cells, at });
  }
  return { source: 'sheet', layout, title: info.title || header.filter(Boolean).join(' | '), company: info.company, asOf: info.asOf, header, rows: out, declaredTotal, pages: 1, dropped, preset: fields };
}

// ---------- A table to items ----------

export interface ItemUnitPrice {
  uom: string;
  rate: number | null;
  cost: string | null;
  price: string | null;
}
export interface StockCardSummary {
  from: string | null;
  to: string | null;
  opening: number | null;
  in: number;
  out: number;
  balance: number | null;
  lines: number;
  /** Documents by their prefix: GR (goods received), DO (delivered), AJ (adjustment), other. */
  docs: Record<string, number>;
}
export interface ParsedItem {
  code: string;
  name: string;
  group: string | null;
  units: ItemUnitPrice[];
  lastCost: { cost: string; uom: string | null; supplier: string | null } | null;
  qty: number | null;
  qtyUom: string | null;
  location: string | null;
  batch: string | null;
  size: string | null;
  colour: string | null;
  barcode: string | null;
  note: string | null;
  card: StockCardSummary | null;
  /** Pages or rows the item was read from. */
  at: number[];
}
export interface ItemsRead {
  items: ParsedItem[];
  /** Rows left out, with the reason, as "page/row N: reason". */
  skipped: { at: number; reason: string }[];
  counts: { rows: number; items: number; extraUnits: number; supplierLines: number; groupHeadings: number; ledgerLines: number };
}

const emptyItem = (code: string, name: string, at: number): ParsedItem => ({
  code,
  name,
  group: null,
  units: [],
  lastCost: null,
  qty: null,
  qtyUom: null,
  location: null,
  batch: null,
  size: null,
  colour: null,
  barcode: null,
  note: null,
  card: null,
  at: [at],
});

/** The prefix of a document number (GR-00163 is GR). */
const docKind = (doc: string) => /^([A-Z]{1,4})[-/\s]?\d/i.exec(doc.trim())?.[1].toUpperCase() ?? 'other';

/**
 * The items in a table, with the field of each column as the person confirmed it. Group headings name the group of
 * the items under them; a line with a unit and figures but no code is another unit of the item above; a supplier cost
 * line is that item's last cost; a stock card's lines become each item's movement summary and closing balance.
 */
export function itemsFromTable(t: ReportTable, fields: (ItemReportField | null)[]): ItemsRead {
  const col = (f: ItemReportField) => fields.indexOf(f);
  const get = (r: ReportRow, f: ItemReportField) => {
    const i = col(f);
    return i >= 0 ? clean(r.cells[i]) : '';
  };
  const ledger = col('moveDate') >= 0 && (col('qtyIn') >= 0 || col('qtyOut') >= 0 || col('runningBal') >= 0);
  const items: ParsedItem[] = [];
  const skipped: ItemsRead['skipped'] = [];
  const counts = { rows: t.rows.length, items: 0, extraUnits: 0, supplierLines: 0, groupHeadings: 0, ledgerLines: 0 };
  let group: string | null = null;
  let cur: ParsedItem | null = null;
  const groupNames = new Set(col('stockGroup') >= 0 ? t.rows.map((r) => normHeader(get(r, 'stockGroup'))).filter(Boolean) : []);
  const unitOf = (r: ReportRow): ItemUnitPrice | null => {
    const uom = get(r, 'uom');
    if (!uom) return null;
    const rate = reportNumber(get(r, 'uomRate'));
    return { uom: uom.toUpperCase().slice(0, 20), rate: rate !== null && rate > 0 ? rate : null, cost: money(get(r, 'unitCost')), price: money(get(r, 'unitPrice')) };
  };
  const start = (code: string, name: string, at: number) => {
    const it = emptyItem(code, name, at);
    items.push(it);
    return it;
  };
  for (const r of t.rows) {
    // A sheet's rows are worked out here; a PDF's arrive marked.
    let kind = r.kind;
    const code = get(r, 'itemCode');
    const name = get(r, 'itemName');
    const filled = r.cells.filter((c) => clean(c)).length;
    if (!kind) {
      const nums = fields.filter((f, i) => f && ['uomRate', 'unitCost', 'unitPrice', 'balanceQty', 'qtyIn', 'qtyOut', 'runningBal'].includes(f) && isNum(r.cells[i] ?? '')).length;
      if (ledger) {
        const dated = !!reportDate(get(r, 'moveDate'));
        if (!dated && !nums && filled >= 1) kind = 'heading';
        else if (!dated && nums && !code && !name) kind = 'total';
        else kind = 'data';
      } else if (filled === 1 && (code || clean(r.cells[0])) && !isNum(code || r.cells[0]) && !nums && (col('stockGroup') < 0 || groupNames.has(normHeader(code || r.cells[0])))) kind = 'group';
      else if (!code && !name && get(r, 'uom') && nums) kind = 'more';
      else kind = 'data';
    }
    if (kind === 'total') continue;
    if (kind === 'group') {
      group = clean(r.cells.find((c) => clean(c)) ?? '').slice(0, 60) || null;
      counts.groupHeadings++;
      continue;
    }
    if (kind === 'heading') {
      const h = r.head ?? (() => {
        const c = code || clean(r.cells.find((x) => clean(x)) ?? '');
        const n = name || clean(r.cells.filter((x) => clean(x)).slice(1).join(' '));
        if (!n) {
          const [a, b] = halves(c);
          return { code: a, name: b };
        }
        return { code: c, name: n };
      })();
      if (!h.code && !h.name) continue;
      // "... Continued" on the next page: the same item goes on.
      if (cur && normHeader(cur.code) === normHeader(h.code)) continue;
      cur = start(h.code.slice(0, 60), h.name.slice(0, 160), r.at);
      cur.card = { from: null, to: null, opening: null, in: 0, out: 0, balance: null, lines: 0, docs: {} };
      continue;
    }
    if (kind === 'more') {
      const u = unitOf(r);
      if (cur && u) {
        cur.units.push(u);
        counts.extraUnits++;
      } else skipped.push({ at: r.at, reason: 'A unit line with no item above it.' });
      continue;
    }
    if (kind === 'sub') {
      const s = r.sub;
      const cost = s ? money(s.cost) : null;
      if (cur && s && cost && Number(cost) > 0) {
        cur.lastCost = { cost, uom: s.uom ? s.uom.toUpperCase().slice(0, 20) : null, supplier: s.supplier ? s.supplier.slice(0, 80) : (cur.lastCost?.supplier ?? null) };
      }
      counts.supplierLines++;
      continue;
    }
    // A data row.
    if (ledger) {
      // A flat ledger (a code on every line) starts a new item when the code changes.
      if (code && (!cur || (normHeader(cur.code) !== normHeader(code) && !normHeader(cur.code).startsWith(normHeader(code))))) {
        cur = start(code.slice(0, 60), (name || code).slice(0, 160), r.at);
        cur.card = { from: null, to: null, opening: null, in: 0, out: 0, balance: null, lines: 0, docs: {} };
      }
      if (!cur || !cur.card) {
        skipped.push({ at: r.at, reason: 'A movement line with no item heading above it.' });
        continue;
      }
      const card = cur.card;
      const date = reportDate(get(r, 'moveDate'));
      const doc = get(r, 'docNo');
      const party = get(r, 'docParty');
      const qin = reportNumber(get(r, 'qtyIn')) ?? 0;
      const qout = reportNumber(get(r, 'qtyOut')) ?? 0;
      const bal = reportNumber(get(r, 'runningBal'));
      if (!doc && BALANCE_BD.test(party || r.cells.join(' '))) {
        card.opening = bal ?? 0;
        if (date) card.from = date;
        if (bal !== null) card.balance = bal;
        continue;
      }
      if (!date && !doc && !qin && !qout && bal === null) continue;
      card.lines++;
      counts.ledgerLines++;
      card.in += qin;
      card.out += qout;
      if (bal !== null) card.balance = bal;
      else card.balance = (card.balance ?? card.opening ?? 0) + qin - qout;
      if (date) {
        if (!card.from || date < card.from) card.from = date;
        if (!card.to || date > card.to) card.to = date;
      }
      if (doc) {
        const k = docKind(doc);
        card.docs[k] = (card.docs[k] ?? 0) + 1;
      }
      const loc = get(r, 'stockLocation');
      if (loc && loc !== '----' && !cur.location) cur.location = loc.slice(0, 60);
      continue;
    }
    if (!code && !name) {
      skipped.push({ at: r.at, reason: 'No item code and no description.' });
      continue;
    }
    cur = start((code || '').slice(0, 60), (name || code).slice(0, 160), r.at);
    cur.group = (get(r, 'stockGroup') || group || '').slice(0, 60) || null;
    const u = unitOf(r);
    if (u) cur.units.push(u);
    const q = reportNumber(get(r, 'balanceQty'));
    if (q !== null) {
      cur.qty = q;
      cur.qtyUom = get(r, 'uom') ? get(r, 'uom').toUpperCase().slice(0, 20) : null;
    }
    const opt = (f: ItemReportField, n: number) => get(r, f).slice(0, n) || null;
    cur.location = opt('stockLocation', 60);
    cur.batch = opt('batch', 40);
    cur.size = opt('itemSize', 20);
    cur.colour = opt('itemColour', 30);
    cur.barcode = opt('itemBarcode', 40);
    cur.note = opt('itemNote', 200);
  }
  for (const it of items) {
    if (it.card && it.card.balance === null && it.card.opening !== null) it.card.balance = it.card.opening;
    if (it.card && it.qty === null) it.qty = it.card.balance;
  }
  const out = items.filter((it) => {
    if (it.code || it.name) return true;
    skipped.push({ at: it.at[0], reason: 'No item code and no description.' });
    return false;
  });
  counts.items = out.length;
  return { items: out, skipped, counts };
}

// ---------- Several files to one list ----------

export interface ItemFileRead {
  file: string;
  layout: ItemReportLayout;
  asOf: string | null;
  items: ParsedItem[];
}

export interface MergedItem extends ParsedItem {
  /** The files the item was read from. */
  files: string[];
  /** Where the quantity came from and its date. */
  qtyFrom: { file: string; layout: ItemReportLayout; asOf: string | null } | null;
  warnings: string[];
}

/** The code as written, upper case, single spaces: "ADD LOGO - ARROW". */
export const codeKey = (s: string) => clean(s).toUpperCase();
/** Letters and digits only: "ADD LOGO-ARROW" and "ADD LOGO - ARROW" both ADDLOGOARROW. */
const compact = (s: string) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const qtyRank = (l: ItemReportLayout) => (l === 'qtyBalance' ? 3 : l === 'stockCard' ? 2 : l === 'table' ? 1 : 0);

/**
 * Items with the same code across files become one: the code as written first, then the same letters and digits (when
 * only one item has them), then a code cut short in one report that starts another's code with the same name. The
 * name, group, units and costs come from the item list first; the quantity from the newest balance, else the stock
 * card's closing balance.
 */
export function mergeItemFiles(files: ItemFileRead[]): MergedItem[] {
  const out: MergedItem[] = [];
  const byKey = new Map<string, MergedItem>();
  const byCompact = new Map<string, MergedItem[]>();
  // Whose name is kept: the item list's (whole), then a balance's, then a stock card heading's.
  const nameRank = new Map<MergedItem, number>();
  const rankOf = (l: ItemReportLayout) => (l === 'itemList' ? 3 : l === 'stockCard' ? 1 : 2);
  const index = (m: MergedItem) => {
    byKey.set(codeKey(m.code || m.name), m);
    const c = compact(m.code || m.name);
    byCompact.set(c, [...(byCompact.get(c) ?? []), m]);
  };
  // The item list first: its names are whole and its codes are the codes.
  const order = [...files].sort((a, b) => (a.layout === 'itemList' ? -1 : 0) - (b.layout === 'itemList' ? -1 : 0));
  for (const f of order) {
    for (const it of f.items) {
      const key = codeKey(it.code || it.name);
      let hit = byKey.get(key) ?? null;
      if (!hit) {
        const same = byCompact.get(compact(it.code || it.name)) ?? [];
        if (same.length === 1) hit = same[0];
      }
      if (!hit && it.code && compact(it.code).length >= 8) {
        // A code cut short in this report: one item of another file has a code that starts with it and the same name.
        const c = compact(it.code);
        const n = compact(it.name);
        const cand = out.filter((m) => !m.files.includes(f.file) && compact(m.code).startsWith(c) && (compact(m.name) === n || compact(m.name).startsWith(n)));
        if (cand.length === 1) hit = cand[0];
      }
      if (!hit) {
        const m: MergedItem = { ...it, units: [...it.units], at: [...it.at], files: [f.file], qtyFrom: it.qty !== null ? { file: f.file, layout: f.layout, asOf: f.asOf } : null, warnings: [] };
        out.push(m);
        index(m);
        nameRank.set(m, rankOf(f.layout));
        continue;
      }
      if (hit.files.includes(f.file) && codeKey(hit.code || hit.name) !== key) {
        // Two items of one file whose codes differ only in spaces or signs stay two items.
        const m: MergedItem = { ...it, units: [...it.units], at: [...it.at], files: [f.file], qtyFrom: it.qty !== null ? { file: f.file, layout: f.layout, asOf: f.asOf } : null, warnings: [] };
        out.push(m);
        byKey.set(key, m);
        nameRank.set(m, rankOf(f.layout));
        continue;
      }
      if (hit.files.includes(f.file)) hit.warnings.push(`Listed more than once in ${f.file}.`);
      else hit.files.push(f.file);
      if (it.code.length > hit.code.length && compact(it.code).startsWith(compact(hit.code))) hit.code = it.code;
      const rank = rankOf(f.layout);
      if (rank > (nameRank.get(hit) ?? 0) || (rank === nameRank.get(hit) && it.name.length > hit.name.length)) {
        hit.name = it.name;
        nameRank.set(hit, rank);
      }
      hit.group ??= it.group;
      if (!hit.units.length && it.units.length) hit.units = [...it.units];
      hit.lastCost ??= it.lastCost;
      hit.card ??= it.card;
      hit.location ??= it.location;
      hit.batch ??= it.batch;
      hit.size ??= it.size;
      hit.colour ??= it.colour;
      hit.barcode ??= it.barcode;
      hit.note ??= it.note;
      if (it.qty !== null) {
        const mine = { file: f.file, layout: f.layout, asOf: f.asOf };
        const prev = hit.qtyFrom;
        const newer = !prev || (f.asOf && prev.asOf ? f.asOf > prev.asOf : qtyRank(f.layout) > qtyRank(prev.layout));
        if (prev && hit.qty !== null && hit.qty !== it.qty && f.asOf === prev.asOf) hit.warnings.push(`${f.file} says ${it.qty}, ${prev.file} says ${hit.qty} on the same date.`);
        if (newer) {
          hit.qty = it.qty;
          hit.qtyUom = it.qtyUom ?? hit.qtyUom;
          hit.qtyFrom = mine;
        }
      }
    }
  }
  for (const m of out) {
    if (m.qty !== null && m.qty < 0) m.warnings.push(`The old system shows ${m.qty}: below zero. Stock is not set; count it.`);
    else if (m.qty !== null && !Number.isInteger(m.qty)) m.warnings.push(`The old system shows ${m.qty}: not a whole number. Stock is not set; count it.`);
  }
  return out;
}

// ---------- Prima codes, categories and the import rows ----------

/** Words in item names and stock groups for Prima's categories (on top of the item import's own words). */
const NAME_CATEGORY: [RegExp, ItemCategory][] = [
  [/\b(torch|torchlight|lampu suluh|flashlight|batton light|baton light)\b/i, 'torchlight'],
  [/\b(walkie|radio|handy talkie)\b/i, 'radio'],
  [/\b(vest|rompi)\b/i, 'vest'],
  [/\b(shoe|shoes|kasut|boot|boots|sandal)\b/i, 'footwear'],
  [/\b(uniform|seragam|shirt|sleeve|kemeja|seluar|trouser|pants|jacket|jaket|baju|t shirt|tshirt|beret|berey|cap|topi|necktie|nektie|tie|belt|tali pinggang|epaulet+e|appal+et|appelet|nametag|name tag|logo|lanyard|cotar|badge|capbadge|whistle|wisel)\b/i, 'uniform'],
  [/\b(checkpoint|clocking|punch card|guard tour|patrol)\b/i, 'patrol_device'],
  [/\b(body ?cam|bodycam)\b/i, 'bodycam'],
  [/\b(phone|telefon|handphone)\b/i, 'phone'],
  [/\b(laptop|computer|komputer|printer|monitor|tablet)\b/i, 'it_device'],
  [/\b(pen|pencil|pensel|ruler|pembaris|book|buku|hardcover|file|fail|stapler|paper|kertas|envelope|sampul|stationery)\b/i, 'office'],
  [/\b(sabun|pencuci|pewangi|detergent|cleaner|clean|lantai|floor|mop|penyapu|broom|plastik sampah|garbage|tong sampah|racun|pesticide|tisu|tissue|bleach|clorox|sanitizer|hand wash|pine|wax)\b/i, 'cleaning'],
  [/\b(helmet|keledar|gloves|sarung tangan|mask|raincoat|baju hujan|ppe|cone|kon|safety|keselamatan|first aid)\b/i, 'safety'],
  [/\b(mesin|machine|engine|enjin|rumput|grass|trimmer|plug|spanner|tool|tools|alat|perkakas|blade|mata|tali|nylon|minyak|oil|baja|fertili[sz]er)\b/i, 'tools'],
  [/\b(kerusi|chair|meja|table|almari|cabinet|locker|loker|rak|rack|furniture|perabot)\b/i, 'furniture'],
];

/** Prima's category for an item: from its name first, then its stock group, else Other. */
export function itemCategoryGuess(name: string, group: string | null): ItemCategory {
  for (const [re, c] of NAME_CATEGORY) if (re.test(name)) return c;
  if (group) {
    const g = itemCategoryOf(group);
    if (g) return g;
    for (const [re, c] of NAME_CATEGORY) if (re.test(group)) return c;
    if (/uniform|seragam/i.test(group)) return 'uniform';
    if (/pencuci|kebersihan|kerbsihan|cleaning|pembersih/i.test(group)) return 'cleaning';
    if (/mesin|msin|rumput|peralatan|peralatn/i.test(group)) return 'tools';
  }
  return 'other';
}

/** The Prima code of an old code: upper case with dashes ("ADD LOGO - ARROW" is ADD-LOGO-ARROW). */
export function primaCodeOf(code: string, name: string): string {
  return itemCodeOf(code, name, '');
}

/** The payload of an item type's own QR code and barcode, made from its code: never changes while the code stays. */
export const TYPE_LABEL_PREFIX = 'PT-';
export function typeLabelPayload(code: string): string {
  return `${TYPE_LABEL_PREFIX}${String(code ?? '').toUpperCase()}`;
}
/** The item type code in a scanned type label, or null when it is not one. */
export function typeLabelCode(raw: string): string | null {
  const m = /^PT-([A-Z0-9][A-Z0-9-]{1,39})$/.exec(String(raw ?? '').trim().toUpperCase());
  return m ? m[1] : null;
}

/** The units, last cost and stock card summary as the import's cells (plain text, checked again on the server). */
export function encodeUnits(units: ItemUnitPrice[]): string {
  return units
    .slice(0, 6)
    .map((u) => [u.uom.replace(/[|:;]/g, ' '), u.rate ?? '', u.cost ?? '', u.price ?? ''].join(':'))
    .join('|');
}
export function decodeUnits(raw: string): ItemUnitPrice[] | null {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const out: ItemUnitPrice[] = [];
  for (const part of s.split('|').slice(0, 6)) {
    const [uom, rate, cost, price] = part.split(':');
    const u = clean(uom).toUpperCase();
    if (!u || u.length > 20 || !/^[A-Z0-9 .()/-]+$/.test(u)) return null;
    const r = rate ? Number(rate) : null;
    if (r !== null && (!Number.isFinite(r) || r <= 0 || r > 100000)) return null;
    const c = cost ? money(cost) : null;
    const p = price ? money(price) : null;
    if ((cost && c === null) || (price && p === null)) return null;
    out.push({ uom: u, rate: r, cost: c, price: p });
  }
  return out;
}
export function encodeCard(c: StockCardSummary | null): string {
  if (!c) return '';
  const docs = Object.entries(c.docs)
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return [`from=${c.from ?? ''}`, `to=${c.to ?? ''}`, `open=${c.opening ?? ''}`, `in=${c.in}`, `out=${c.out}`, `bal=${c.balance ?? ''}`, `lines=${c.lines}`, `docs=${docs}`].join(';');
}
export function decodeCard(raw: string): StockCardSummary | null | 'bad' {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const kv = new Map(
    s
      .split(';')
      .slice(0, 12)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
      }),
  );
  const num = (k: string, nullable = true) => {
    const v = kv.get(k) ?? '';
    if (!v) return nullable ? null : 0;
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= 1e9 ? n : NaN;
  };
  const date = (k: string) => {
    const v = kv.get(k) ?? '';
    return v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : 'bad') : null;
  };
  const docs: Record<string, number> = {};
  for (const p of (kv.get('docs') ?? '').split(',').filter(Boolean)) {
    const [k, v] = p.split('=');
    const n = Number(v);
    if (!/^[A-Za-z]{1,5}$/.test(k ?? '') || !Number.isInteger(n) || n < 0) return 'bad';
    docs[k] = n;
  }
  const c = { from: date('from'), to: date('to'), opening: num('open'), in: num('in', false) as number, out: num('out', false) as number, balance: num('bal'), lines: num('lines', false) as number, docs };
  if (c.from === 'bad' || c.to === 'bad' || [c.opening, c.in, c.out, c.balance, c.lines].some((x) => x !== null && Number.isNaN(x))) return 'bad';
  return c as StockCardSummary;
}

/** The import's columns (kind itemList), in order. */
export const ITEM_LIST_COLUMNS = ['code', 'name', 'group', 'category', 'tracking', 'unit', 'units', 'lastCost', 'lastCostUom', 'supplier', 'qty', 'qtyAsOf', 'location', 'batch', 'size', 'colour', 'barcode', 'history', 'note'] as const;

/** One merged item as a row of the import file (kind itemList). */
export function itemListRow(m: MergedItem, category: ItemCategory, tracking: 'BULK' | 'SERIALIZED'): string[] {
  const base = m.qtyUom ?? m.units[0]?.uom ?? '';
  const v: Record<(typeof ITEM_LIST_COLUMNS)[number], string> = {
    code: m.code,
    name: m.name,
    group: m.group ?? '',
    category,
    tracking,
    unit: base,
    units: encodeUnits(m.units),
    lastCost: m.lastCost?.cost ?? '',
    lastCostUom: m.lastCost?.uom ?? '',
    supplier: m.lastCost?.supplier ?? '',
    qty: m.qty === null ? '' : String(m.qty),
    qtyAsOf: m.qtyFrom?.asOf ?? '',
    location: m.location ?? '',
    batch: m.batch ?? '',
    size: m.size ?? '',
    colour: m.colour ?? '',
    barcode: m.barcode ?? '',
    history: encodeCard(m.card),
    note: m.note ?? '',
  };
  return ITEM_LIST_COLUMNS.map((k) => v[k]);
}
