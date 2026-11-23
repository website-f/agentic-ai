// Guard pay import (Fitri, 23 Nov 2026: "from csv, excel, pdf and other"): the older Excel file (.xls, Excel 97-2003)
// read in the browser without a spreadsheet library, as xlsx-read.ts reads the newer one. An .xls is a compound file
// (a small FAT file system) holding a "Workbook" stream of BIFF8 records. Only cell values are read: shared strings,
// text, numbers (dates by their cell format), yes/no and the last value a formula computed, as Excel saved it. Nothing in
// the file is run. Excel 5/95 files and password-protected files are refused with a plain message.

import { excelSerialDate } from './import-align';
import { XlsxError, type XlsxSheet } from './xlsx-read';

const MAX_CELLS = 400_000;
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;

/** Is this the start of an Excel 97-2003 (compound) file? */
export function isXlsFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** The named stream of a compound file, or null when there is none. */
export function cfbStream(bytes: Uint8Array, names: string[]): Uint8Array | null {
  if (!isXlsFile(bytes)) throw new XlsxError('This is not an Excel 97-2003 file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ss = 1 << dv.getUint16(0x1e, true);
  const mss = 1 << dv.getUint16(0x20, true);
  if (ss !== 512 && ss !== 4096) throw new XlsxError('This Excel file could not be read.');
  const at = (sector: number) => (sector + 1) * ss;
  const u32 = (off: number) => (off + 4 <= bytes.length ? dv.getUint32(off, true) : FREE);
  // The FAT: its sectors are listed in the header (109) and then in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4c + i * 4);
    if (s !== FREE && s !== END) fatSectors.push(s);
  }
  let difat = u32(0x44);
  for (let guard = 0; difat !== END && difat !== FREE && guard < 10_000; guard++) {
    const base = at(difat);
    for (let i = 0; i < ss / 4 - 1; i++) {
      const s = u32(base + i * 4);
      if (s !== FREE && s !== END) fatSectors.push(s);
    }
    difat = u32(base + ss - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) for (let i = 0; i < ss / 4; i++) fat.push(u32(at(s) + i * 4));
  const chain = (start: number, next: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END && s !== FREE && s < next.length && !seen.has(s); s = next[s]) {
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const read = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let n = 0;
    for (const s of chain(start, fat)) {
      if (n >= size) break;
      const part = bytes.subarray(at(s), Math.min(at(s) + ss, bytes.length));
      out.set(part.subarray(0, Math.min(part.length, size - n)), n);
      n += part.length;
    }
    return out;
  };
  // The directory: 128-byte entries (name, type, first sector, size).
  const dirSectors = chain(u32(0x30), fat);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (const s of dirSectors)
    for (let off = at(s); off + 128 <= Math.min(at(s) + ss, bytes.length); off += 128) {
      const len = dv.getUint16(off + 0x40, true);
      let name = '';
      for (let i = 0; i + 2 < len && i < 64; i += 2) name += String.fromCharCode(dv.getUint16(off + i, true));
      entries.push({ name, type: bytes[off + 0x42], start: dv.getUint32(off + 0x74, true), size: dv.getUint32(off + 0x78, true) });
    }
  const root = entries.find((e) => e.type === 5);
  const want = names.map((n) => n.toLowerCase());
  const entry = entries.find((e) => e.type === 2 && want.includes(e.name.toLowerCase()));
  if (!entry) return null;
  if (entry.size > 64_000_000) throw new XlsxError('This Excel file is too big.');
  const cutoff = u32(0x38);
  if (entry.size >= cutoff || !root) return read(entry.start, entry.size);
  // A small stream lives in the mini stream (64-byte sectors inside the root entry's stream).
  const mini = read(root.start, root.size);
  const miniFat: number[] = [];
  const mfBytes = read(u32(0x3c), u32(0x40) * ss);
  const mdv = new DataView(mfBytes.buffer, mfBytes.byteOffset, mfBytes.byteLength);
  for (let i = 0; i + 4 <= mfBytes.length; i += 4) miniFat.push(mdv.getUint32(i, true));
  const out = new Uint8Array(entry.size);
  let n = 0;
  for (const s of chain(entry.start, miniFat)) {
    if (n >= entry.size) break;
    const part = mini.subarray(s * mss, s * mss + mss);
    out.set(part.subarray(0, Math.min(part.length, entry.size - n)), n);
    n += part.length;
  }
  return out;
}

/** Excel's built-in number formats that are dates or times. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = (code: string) => /[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^(general|@)$/i.test(code.trim());

/** Reads BIFF strings that may run on into CONTINUE records (each continued run of characters starts with its own flag). */
class Chunks {
  ci = 0;
  pos = 0;
  constructor(private chunks: Uint8Array[]) {}
  private cur() {
    while (this.ci < this.chunks.length && this.pos >= this.chunks[this.ci].length) {
      this.ci++;
      this.pos = 0;
    }
    return this.chunks[this.ci];
  }
  get done() {
    return !this.cur();
  }
  u8(): number {
    const c = this.cur();
    if (!c) throw new XlsxError('This Excel file is damaged (shared text).');
    return c[this.pos++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    for (let i = 0; i < n; i++) this.u8();
  }
  chars(n: number, high: boolean): string {
    let out = '';
    let left = n;
    let wide = high;
    while (left > 0) {
      const c = this.chunks[this.ci];
      if (!c || this.pos >= c.length) {
        // A run of characters continued in the next record: it starts again with its own flag byte.
        this.ci++;
        this.pos = 0;
        if (this.ci >= this.chunks.length) throw new XlsxError('This Excel file is damaged (shared text).');
        wide = (this.chunks[this.ci][this.pos++] & 1) === 1;
        continue;
      }
      const room = Math.floor((c.length - this.pos) / (wide ? 2 : 1));
      const k = Math.min(left, Math.max(room, 0));
      if (k === 0) {
        this.pos = c.length;
        continue;
      }
      for (let i = 0; i < k; i++) {
        out += String.fromCharCode(wide ? c[this.pos] | (c[this.pos + 1] << 8) : c[this.pos]);
        this.pos += wide ? 2 : 1;
      }
      left -= k;
    }
    return out;
  }
}

/** XLUnicodeRichExtendedString (the shared string table). */
function sstString(r: Chunks): string {
  const cch = r.u16();
  const flags = r.u8();
  const rich = flags & 0x08 ? r.u16() : 0;
  const ext = flags & 0x04 ? r.u32() : 0;
  const s = r.chars(cch, (flags & 1) === 1);
  r.skip(rich * 4 + ext);
  return s;
}

/** A string at the start of a record's data: a 16-bit (BIFF8 LABEL, STRING) or 8-bit (BOUNDSHEET) count, then the flag. */
function plainString(d: Uint8Array, off: number, wideCount: boolean): string {
  const cch = wideCount ? d[off] | (d[off + 1] << 8) : d[off];
  const p = off + (wideCount ? 2 : 1);
  const high = (d[p] & 1) === 1;
  let s = '';
  for (let i = 0; i < cch; i++) {
    const q = p + 1 + i * (high ? 2 : 1);
    if (q >= d.length) break;
    s += String.fromCharCode(high ? d[q] | (d[q + 1] << 8) : d[q]);
  }
  return s;
}

/** An RK number: a 30-bit integer or the top of a double, maybe divided by 100. */
function rkValue(rk: number): number {
  let n: number;
  if (rk & 2) n = rk >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, rk & 0xfffffffc, true);
    n = buf.getFloat64(0, true);
  }
  return rk & 1 ? n / 100 : n;
}

const numberText = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10));

/** Every sheet of an Excel 97-2003 workbook (.xls) as rows of cell text. */
export function readXls(bytes: Uint8Array): XlsxSheet[] {
  const wb = cfbStream(bytes, ['Workbook']);
  if (!wb) {
    if (cfbStream(bytes, ['Book'])) throw new XlsxError('This is an Excel 5/95 file. Open it in Excel and save it as Excel Workbook (.xlsx), then choose it again.');
    throw new XlsxError('No workbook was found in this file. Is it an Excel file?');
  }
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const records: { type: number; off: number; len: number }[] = [];
  for (let off = 0; off + 4 <= wb.length; ) {
    const type = dv.getUint16(off, true);
    const len = dv.getUint16(off + 2, true);
    records.push({ type, off: off + 4, len: Math.min(len, wb.length - off - 4) });
    off += 4 + len;
  }
  const data = (r: { off: number; len: number }) => wb.subarray(r.off, r.off + r.len);
  const sheets: { name: string; pos: number }[] = [];
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  // The workbook part: up to its EOF.
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 0x000a) break;
    const d = data(r);
    if (r.type === 0x0809 && i === 0 && d.length >= 2 && (d[0] | (d[1] << 8)) !== 0x0600) throw new XlsxError('This is an older Excel file. Open it in Excel and save it as Excel Workbook (.xlsx), then choose it again.');
    if (r.type === 0x002f) throw new XlsxError('This Excel file is protected with a password. Open it, remove the password and save it again.');
    if (r.type === 0x0085 && d.length >= 8) {
      if (d[5] === 0) sheets.push({ name: plainString(d, 6, false), pos: dv.getUint32(r.off, true) });
    } else if (r.type === 0x041e && d.length >= 4) formats.set(d[0] | (d[1] << 8), plainString(d, 2, true));
    else if (r.type === 0x00e0 && d.length >= 4) xfFormat.push(d[2] | (d[3] << 8));
    else if (r.type === 0x00fc) {
      const parts = [d];
      for (let j = i + 1; j < records.length && records[j].type === 0x003c; j++) parts.push(data(records[j]));
      const c = new Chunks(parts);
      c.skip(4);
      const unique = c.u32();
      for (let k = 0; k < unique && !c.done; k++) sst.push(sstString(c));
    }
  }
  const dateXf = (xf: number) => {
    const f = xfFormat[xf];
    if (f === undefined) return false;
    return DATE_FORMATS.has(f) || (formats.has(f) && isDateFormat(formats.get(f)!));
  };
  const out: XlsxSheet[] = [];
  let cells = 0;
  for (const sh of sheets) {
    const start = records.findIndex((r) => r.off - 4 === sh.pos);
    if (start < 0) continue;
    const grid: string[][] = [];
    const put = (row: number, col: number, v: string) => {
      if (++cells > MAX_CELLS) throw new XlsxError('This workbook is too big. Keep only the sheet you need.');
      if (row > 100_000 || col > 1000) return;
      while (grid.length <= row) grid.push([]);
      const line = grid[row];
      while (line.length < col) line.push('');
      line[col] = v;
    };
    const num = (row: number, col: number, xf: number, n: number) => put(row, col, dateXf(xf) ? (excelSerialDate(n, true) ?? numberText(n)) : numberText(n));
    let pendingFormula: [number, number] | null = null;
    for (let i = start + 1; i < records.length && records[i].type !== 0x000a; i++) {
      const r = records[i];
      const d = data(r);
      const row = d.length >= 4 ? d[0] | (d[1] << 8) : 0;
      const col = d.length >= 4 ? d[2] | (d[3] << 8) : 0;
      const xf = d.length >= 6 ? d[4] | (d[5] << 8) : 0;
      switch (r.type) {
        case 0x00fd: // LABELSST
          if (d.length >= 10) put(row, col, sst[dv.getUint32(r.off + 6, true)] ?? '');
          break;
        case 0x0204: // LABEL
          if (d.length >= 9) put(row, col, plainString(d, 6, true));
          break;
        case 0x0203: // NUMBER
          if (d.length >= 14) num(row, col, xf, dv.getFloat64(r.off + 6, true));
          break;
        case 0x027e: // RK
          if (d.length >= 10) num(row, col, xf, rkValue(dv.getUint32(r.off + 6, true)));
          break;
        case 0x00bd: {
          // MULRK: several RK cells in one row
          const n = Math.floor((d.length - 6) / 6);
          for (let k = 0; k < n; k++) {
            const o = 4 + k * 6;
            num(row, col + k, d[o] | (d[o + 1] << 8), rkValue(dv.getUint32(r.off + o + 2, true)));
          }
          break;
        }
        case 0x0205: // BOOLERR
          if (d.length >= 8) put(row, col, d[7] ? '' : d[6] ? 'TRUE' : 'FALSE');
          break;
        case 0x0006: // FORMULA: its last value
          if (d.length >= 14) {
            if (d[12] === 0xff && d[13] === 0xff) {
              if (d[6] === 0) pendingFormula = [row, col];
              else if (d[6] === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE');
            } else num(row, col, xf, dv.getFloat64(r.off + 6, true));
          }
          break;
        case 0x0207: // STRING: the text a formula just before computed
          if (pendingFormula && d.length >= 3) put(pendingFormula[0], pendingFormula[1], plainString(d, 0, true));
          pendingFormula = null;
          break;
        default:
          break;
      }
    }
    out.push({ name: sh.name, rows: grid.map((r) => r.map((c) => c ?? '')) });
  }
  if (!out.length) throw new XlsxError('No sheet was found in this Excel file.');
  return out;
}
