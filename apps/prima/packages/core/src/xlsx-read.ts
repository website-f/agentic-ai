// P81: read an Excel workbook (.xlsx) in the browser, without a spreadsheet library. An .xlsx is a zip of XML parts:
// the sheet list (xl/workbook.xml and its relations), the shared strings, the styles (to know which numbers are dates)
// and one XML part per sheet. Only cell values are read; formulas give their last computed value, as Excel saved it.
// The caller passes the raw-deflate decoder (the browser's DecompressionStream, or zlib in tests), so core stays free
// of platform code. The file is data only: nothing in it is run.

import { excelSerialDate } from './import-align';

export type InflateRaw = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

const MAX_CELLS = 400_000;

/** The files inside a zip, by name, decompressed on demand. */
function unzip(buf: Uint8Array, inflateRaw: InflateRaw): Map<string, () => Promise<Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: the last record with signature 0x06054b50 (a comment of up to 64 KB may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new XlsxError('This is not an Excel (.xlsx) file. Save it as .xlsx or CSV and try again.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError('The Excel file is damaged. Open it in Excel, save it again and retry.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name, async () => {
      if (dv.getUint32(local, true) !== 0x04034b50) throw new XlsxError('The Excel file is damaged. Open it in Excel, save it again and retry.');
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new XlsxError('This Excel file uses a compression Prima cannot read. Save it as .xlsx or CSV and try again.');
    });
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, name, dec, hex) =>
      name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
    )
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** The text of every <t> inside a fragment (rich text runs joined; phonetic runs skipped). */
function textOf(xml: string): string {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of plain.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) out += m[1] ? unescapeXml(m[1]) : '';
  return out;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

/** "B12" to the zero-based column (1). */
function colOf(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Built-in number formats that are dates (14-22, 27-36, 45-47, 50-58), and custom ones with day, month or year codes. */
function dateStyles(styles: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    custom.set(id, attr(m[0], 'formatCode') ?? '');
  }
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
    const code = custom.get(id);
    if (!code) return false;
    // Strip quoted text, escapes and colours, then look for d, m or y codes (but not only h:mm:ss).
    const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
    return /[dy]/i.test(bare) || (/m/i.test(bare) && !/[hs]/i.test(bare));
  };
  const out = new Set<number>();
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    if (isDate(Number(attr(m[0], 'numFmtId') ?? 0))) out.add(i);
    i++;
  }
  return out;
}

/** Excel stores numbers like 0.1+0.2 as 0.30000000000000004; show them as typed. */
function tidyNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || !/[.eE]/.test(v)) return v;
  return String(Number(n.toPrecision(15)));
}

/** Every sheet of an .xlsx workbook, as rows of cell text. Date cells come out as YYYY-MM-DD. */
export async function readXlsx(bytes: Uint8Array, inflateRaw: InflateRaw): Promise<XlsxSheet[]> {
  const files = unzip(bytes, inflateRaw);
  const dec = new TextDecoder();
  const read = async (name: string) => {
    const f = files.get(name) ?? files.get(name.replace(/^\//, ''));
    return f ? dec.decode(await f()) : '';
  };
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new XlsxError('This is not an Excel workbook. Save it as .xlsx or CSV and try again.');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const t = attr(m[0], 'Target');
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
  }
  const shared: string[] = [];
  const sst = await read('xl/sharedStrings.xml');
  for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)) shared.push(m[1] ? textOf(m[1]) : '');
  const dates = dateStyles(await read('xl/styles.xml'));
  const sheets: XlsxSheet[] = [];
  let cells = 0;
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet ${sheets.length + 1}`;
    const rid = attr(m[0], 'r:id') ?? /\sr?\w*:id="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const path = target.get(rid);
    if (!path) continue;
    const xml = await read(path);
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const body = r[2] ?? '';
      const rowNo = Number(attr(`<row${r[1] ?? ''}>`, 'r') ?? rows.length + 1);
      const row: string[] = [];
      let next = 0;
      for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const ref = attr(tag, 'r');
        const col = ref ? colOf(ref) : next;
        next = col + 1;
        if (col > 300) continue;
        const inner = c[2] ?? '';
        const t = attr(tag, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let text = '';
        if (t === 's') text = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') text = textOf(inner);
        else if (t === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (t === 'str' || t === 'e') text = v !== undefined ? unescapeXml(v) : '';
        else if (v !== undefined) {
          const s = Number(attr(tag, 's') ?? 0);
          text = dates.has(s) ? (excelSerialDate(Number(v), true) ?? tidyNumber(v)) : tidyNumber(v);
        }
        while (row.length < col) row.push('');
        row[col] = text;
        if (++cells > MAX_CELLS) throw new XlsxError('The workbook is too big. Copy the sheet you need into a new file of up to 500 rows.');
      }
      while (rows.length < rowNo - 1) rows.push([]);
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new XlsxError('The workbook has no sheets Prima can read.');
  return sheets;
}
