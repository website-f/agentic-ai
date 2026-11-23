/**
 * Key-in helper: the words of ANY kind of document (Fauzan, 23 Nov 2026: "Make it read all type of document").
 * Everything here runs on the person's phone or computer and is free: the file itself is never uploaded to be read.
 * Only the words go on to the rules (and, where the paper may be sent, to the online reader for fields still empty).
 *
 *   photo, scan       the phone's own text reader (apps/web/src/ocr.ts)
 *   PDF               its own text; pages that are pictures are read like photos (apps/web/src/paper-words.ts)
 *   Word, Excel,      opened here: these files are zip folders of XML, read without any outside service
 *   PowerPoint,
 *   OpenDocument
 *   text, CSV, web    read as they are
 *   page, RTF, email
 *
 * Old Word and Excel files (.doc, .xls, before 2007) and locked files cannot be read: the person is told to save the
 * file as PDF or as a new Word or Excel file, or to type the values. Nothing is guessed.
 */

export type KeyInFileKind = 'image' | 'pdf' | 'word' | 'excel' | 'slides' | 'opendoc' | 'text' | 'html' | 'rtf' | 'old-office' | 'unknown';

export const KEY_IN_FILE_RULE = {
  /** The largest file opened. */
  maxFileBytes: 15 * 1024 * 1024,
  /** The largest single part unpacked from a Word, Excel or PowerPoint file (stops a file built to fill memory). */
  maxPartBytes: 20 * 1024 * 1024,
  /** PDF pages looked at; of those, pages that are pictures read like photos. */
  maxPdfPages: 15,
  maxPdfPicturePages: 5,
  maxSheets: 5,
  maxSlides: 40,
};

/** What a file input should offer: every kind of document a phone or computer normally holds. */
export const KEY_IN_FILE_ACCEPT =
  'image/*,application/pdf,.pdf,.docx,.docm,.xlsx,.xlsm,.pptx,.odt,.ods,.odp,.txt,.csv,.tsv,.md,.json,.xml,.htm,.html,.rtf,.eml,.doc,.xls';

const ext = (name: string) => (/\.([A-Za-z0-9]{1,6})$/.exec(name.trim())?.[1] ?? '').toLowerCase();
const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** The kind of file, from its first bytes first (a renamed file is still what it is), then its name and type. */
export function keyInFileKind(name: string, type: string, head: Uint8Array): KeyInFileKind {
  const e = ext(name);
  const t = type.toLowerCase();
  if (starts(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (starts(head, [0xff, 0xd8, 0xff]) || starts(head, [0x89, 0x50, 0x4e, 0x47]) || starts(head, [0x47, 0x49, 0x46, 0x38]) || starts(head, [0x42, 0x4d])) return 'image';
  if (starts(head, [0x52, 0x49, 0x46, 0x46]) && starts(head.subarray(8), [0x57, 0x45, 0x42, 0x50])) return 'image';
  if (starts(head.subarray(4), [0x66, 0x74, 0x79, 0x70]) && /^(heic|heif|avif)$/.test(e)) return 'image';
  if (starts(head, [0x49, 0x49, 0x2a, 0x00]) || starts(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'image';
  if (starts(head, [0xd0, 0xcf, 0x11, 0xe0])) return 'old-office';
  if (starts(head, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf';
  if (starts(head, [0x50, 0x4b, 0x03, 0x04])) {
    if (e === 'xlsx' || e === 'xlsm') return 'excel';
    if (e === 'pptx') return 'slides';
    if (e === 'odt' || e === 'ods' || e === 'odp') return 'opendoc';
    // A zip with no telling name is opened as Word first; keyInZipWords looks at what is really inside.
    return 'word';
  }
  if (t.startsWith('image/') || /^(jpg|jpeg|png|gif|bmp|webp|heic|heif|avif|tif|tiff)$/.test(e)) return 'image';
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  if (e === 'doc' || e === 'xls' || e === 'ppt') return 'old-office';
  if (t === 'text/html' || e === 'htm' || e === 'html') return 'html';
  if (e === 'rtf') return 'rtf';
  if (t.startsWith('text/') || /^(txt|csv|tsv|md|json|xml|eml|log)$/.test(e) || t === 'application/json' || t === 'message/rfc822') return 'text';
  // No name, no type: text when the first bytes are plain text.
  if (head.length && looksLikeText(head)) return 'text';
  return 'unknown';
}

function looksLikeText(b: Uint8Array): boolean {
  if (starts(b, [0xff, 0xfe]) || starts(b, [0xfe, 0xff]) || starts(b, [0xef, 0xbb, 0xbf])) return true;
  let odd = 0;
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) if (b[i] === 0 || (b[i] < 9) || (b[i] > 13 && b[i] < 32)) odd++;
  return n > 0 && odd === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Plain text, web pages, RTF

/** Bytes to text: UTF-8, or UTF-16 when the file says so. */
export function keyInDecodeText(bytes: Uint8Array): string {
  if (starts(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (starts(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(starts(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const point = (n: number) => (Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ');
export const keyInXmlText = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,6});/g, (m, e: string) =>
    e[0] === '#' ? point(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** Tidy lines: no trailing spaces, no runs of empty lines. */
const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[  ]+/g, ' ').replace(/ ?\t ?/g, '\t').replace(/\t+$/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** The words of a web page: scripts and styles dropped, one line per block, table cells kept on one line. */
export function keyInHtmlWords(html: string): string {
  return tidy(
    keyInXmlText(
      html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<\/(td|th)\s*>/gi, '\t')
        .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table|\/section|\/article)\b[^>]*>/gi, '\n')
        .replace(/<[^>]{0,2000}>/g, ' '),
    ),
  );
}

/** The words of an RTF file: control words and groups of settings dropped. */
export function keyInRtfWords(rtf: string): string {
  return tidy(
    rtf
      .replace(/\{\\\*[^{}]*\}/g, ' ')
      .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer)\b(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
      .replace(/\\(par|line|row)\b ?/g, '\n')
      .replace(/\\(tab|cell)\b ?/g, '\t')
      .replace(/\\'([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(-?\d{1,6})\??/g, (_m, n: string) => point(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
      .replace(/\\[a-zA-Z]{1,32}-?\d{0,10} ?/g, '')
      .replace(/\\([{}\\])/g, '$1')
      .replace(/[{}]/g, ''),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Word, Excel, PowerPoint and OpenDocument files: zip folders of XML

export interface KeyInZipEntry {
  name: string;
  /** 0 stored, 8 deflate. */
  method: number;
  compressedSize: number;
  size: number;
  /** Where the entry's own header starts in the file. */
  headerAt: number;
  locked: boolean;
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The list of parts in a zip file, read from its table of contents. Empty when the file is not a readable zip. */
export function keyInZipList(bytes: Uint8Array): KeyInZipEntry[] {
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65_535; i--)
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return [];
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const out: KeyInZipEntry[] = [];
  for (let n = 0; n < count && n < 5000 && at + 46 <= bytes.length && u32(bytes, at) === 0x02014b50; n++) {
    const nameLen = u16(bytes, at + 28);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(at + 46, at + 46 + nameLen));
    out.push({ name, method: u16(bytes, at + 10), compressedSize: u32(bytes, at + 20), size: u32(bytes, at + 24), headerAt: u32(bytes, at + 42), locked: (u16(bytes, at + 8) & 1) === 1 });
    at += 46 + nameLen + u16(bytes, at + 30) + u16(bytes, at + 32);
  }
  return out;
}

/** Unpacks deflate data (the browser's DecompressionStream, or zlib in tests). Must stop at `max` bytes. */
export type KeyInInflate = (data: Uint8Array, max: number) => Promise<Uint8Array>;

/** One part of a zip file as text, or null when it is missing, locked, too big or damaged. */
export async function keyInZipText(bytes: Uint8Array, entry: KeyInZipEntry | undefined, inflate: KeyInInflate): Promise<string | null> {
  if (!entry || entry.locked || entry.size > KEY_IN_FILE_RULE.maxPartBytes || (entry.method !== 0 && entry.method !== 8)) return null;
  const at = entry.headerAt;
  if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) return null;
  const from = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const data = bytes.subarray(from, from + entry.compressedSize);
  if (data.length !== entry.compressedSize) return null;
  try {
    const raw = entry.method === 0 ? data : await inflate(data, KEY_IN_FILE_RULE.maxPartBytes);
    return raw.length > KEY_IN_FILE_RULE.maxPartBytes ? null : new TextDecoder('utf-8').decode(raw);
  } catch {
    return null;
  }
}

/** Word: one line per paragraph; the cells of a table row stay on one line, so "Total" and its figure stay together. */
export function keyInDocxWords(documentXml: string): string {
  const body = documentXml
    .replace(/<w:tbl>|<w:tbl [^>]*>/g, '\u0001')
    .replace(/<\/w:tbl>/g, '\u0002');
  let out = '';
  let depth = 0;
  // Inside a table a paragraph end is a space, a cell end is a tab and a row end is a new line.
  for (const m of body.matchAll(/\u0001|\u0002|<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?: [^>]*)?\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g)) {
    const tok = m[0];
    if (tok === '\u0001') depth++;
    else if (tok === '\u0002') depth = Math.max(0, depth - 1);
    else if (m[1] != null) out += keyInXmlText(m[1]);
    else if (tok === '<w:tab/>') out += '\t';
    else if (tok === '</w:tc>') out += '\t';
    else if (tok === '</w:tr>') out += '\n';
    else if (tok === '</w:p>') out += depth ? ' ' : '\n';
    else out += depth ? ' ' : '\n';
  }
  return tidy(out);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** An Excel day number as a date (day 1 is 1 Jan 1900; Excel's false 29 Feb 1900 is allowed for). */
export function keyInExcelDate(serial: number): string | null {
  if (!(serial >= 1) || serial > 109_574) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Which cell styles are dates, from the workbook's styles part. */
export function keyInExcelDateStyles(stylesXml: string | null): Set<number> {
  const dates = new Set<number>();
  if (!stylesXml) return dates;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)) custom.set(Number(m[1]), keyInXmlText(m[2]));
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dy]/i.test(bare) && !/[#0]/.test(bare);
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b([^>]*)/g)) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0);
    if (isDate(id)) dates.add(i);
    i++;
  }
  return dates;
}

/** Excel: one line per row, cells apart by a tab; dates written as dates and money with two decimals as printed. */
export function keyInXlsxWords(sharedStringsXml: string | null, sheetXmls: string[], stylesXml: string | null = null): string {
  const shared: string[] = [];
  for (const m of (sharedStringsXml ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g))
    shared.push(keyInXmlText([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')));
  const dateStyles = keyInExcelDateStyles(stylesXml);
  const lines: string[] = [];
  for (const sheet of sheetXmls.slice(0, KEY_IN_FILE_RULE.maxSheets)) {
    for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? '';
        const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? 'n';
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        let text = '';
        if (type === 's') text = v != null ? (shared[Number(v)] ?? '') : '';
        else if (type === 'inlineStr') text = keyInXmlText([...inner.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'str' || type === 'e' || type === 'd') text = keyInXmlText(v ?? '');
        else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null && v !== '') {
          const n = Number(v);
          const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
          if (dateStyles.has(style)) text = keyInExcelDate(n) ?? v;
          // A figure with cents is shown with two decimals, the way a total is printed (1250.5 is 1250.50).
          else text = Number.isFinite(n) && !Number.isInteger(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? n.toFixed(2) : v;
        }
        if (text.trim()) cells.push(text.trim());
      }
      if (cells.length) lines.push(cells.join('\t'));
    }
    lines.push('');
  }
  return tidy(lines.join('\n'));
}

/** PowerPoint: one line per paragraph of each slide. */
export const keyInPptxWords = (slideXmls: string[]): string =>
  tidy(
    slideXmls
      .slice(0, KEY_IN_FILE_RULE.maxSlides)
      .map((x) => [...x.matchAll(/<a:t>([^<]*)<\/a:t>|<\/a:p>|<a:br\/>/g)].map((m) => (m[1] != null ? keyInXmlText(m[1]) : '\n')).join(''))
      .join('\n\n'),
  );

/** OpenDocument (LibreOffice) text, sheet or slides. */
export const keyInOpenDocWords = (contentXml: string): string =>
  tidy(
    keyInXmlText(
      contentXml
        .replace(/<text:tab\/>|<\/table:table-cell>/g, '\t')
        .replace(/<text:s\b[^>]*\/>/g, ' ')
        .replace(/<text:line-break\/>|<\/text:p>|<\/text:h>|<\/table:table-row>/g, '\n')
        // Inside a table cell the paragraph end must not break the row.
        .replace(/\n(\t)/g, '$1')
        .replace(/<[^>]{0,4000}>/g, ''),
    ),
  );

const numbered = (list: KeyInZipEntry[], re: RegExp) =>
  list
    .filter((e) => re.test(e.name))
    .sort((a, b) => Number(re.exec(a.name)?.[1] ?? 0) - Number(re.exec(b.name)?.[1] ?? 0));

/** The words of a Word, Excel, PowerPoint or OpenDocument file, whatever its name says. Null when it cannot be read. */
export async function keyInZipWords(bytes: Uint8Array, inflate: KeyInInflate): Promise<string | null> {
  const list = keyInZipList(bytes);
  if (!list.length) return null;
  const part = (name: string) => keyInZipText(bytes, list.find((e) => e.name === name), inflate);
  if (list.some((e) => e.name === 'word/document.xml')) {
    const doc = await part('word/document.xml');
    return doc == null ? null : keyInDocxWords(doc) || null;
  }
  if (list.some((e) => e.name === 'xl/workbook.xml')) {
    const sheets: string[] = [];
    for (const e of numbered(list, /^xl\/worksheets\/sheet(\d+)\.xml$/).slice(0, KEY_IN_FILE_RULE.maxSheets)) {
      const x = await keyInZipText(bytes, e, inflate);
      if (x != null) sheets.push(x);
    }
    return keyInXlsxWords(await part('xl/sharedStrings.xml'), sheets, await part('xl/styles.xml')) || null;
  }
  if (list.some((e) => e.name === 'ppt/presentation.xml')) {
    const slides: string[] = [];
    for (const e of numbered(list, /^ppt\/slides\/slide(\d+)\.xml$/).slice(0, KEY_IN_FILE_RULE.maxSlides)) {
      const x = await keyInZipText(bytes, e, inflate);
      if (x != null) slides.push(x);
    }
    return keyInPptxWords(slides) || null;
  }
  if (list.some((e) => e.name === 'content.xml')) {
    const x = await part('content.xml');
    return x == null ? null : keyInOpenDocWords(x) || null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// PDF text: rebuild the printed lines

export interface KeyInPdfItem {
  str: string;
  x: number;
  y: number;
  /** Height of the letters, to tell which words share a line. */
  h: number;
}

/**
 * A PDF gives words with their place on the page, not lines. Words at the same height are one line, read left to
 * right, so a label and its value ("Jumlah" ... "RM 1,250.00") end up on the same line for the rules.
 */
export function keyInPdfLines(items: KeyInPdfItem[]): string {
  const rows: { y: number; h: number; items: KeyInPdfItem[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const tol = Math.max(2, (it.h || 10) * 0.45);
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(' '),
    )
    .join('\n');
}

/** Does a PDF page have real text, or is it a picture of a paper (a scan) that must be read like a photo? */
export const keyInPdfPageIsPicture = (pageText: string): boolean => pageText.replace(/\s/g, '').length < 20;

// ---------------------------------------------------------------------------------------------------------------
// One answer for the screen

export type KeyInFileProblem = 'too-big' | 'old-office' | 'unknown' | 'locked' | 'empty';
export interface KeyInFileWords {
  kind: KeyInFileKind;
  /** The words, when this file could be read here. */
  words: string | null;
  /** 'photo' and 'pdf' are read by the screen (text reader, PDF reader); the rest is done here. */
  next: 'photo' | 'pdf' | null;
  problem: KeyInFileProblem | null;
}

/** Reads every kind of file that needs no reader of its own, and says what the screen must do for photos and PDFs. */
export async function keyInFileWords(bytes: Uint8Array, name: string, type: string, inflate: KeyInInflate): Promise<KeyInFileWords> {
  const kind = keyInFileKind(name, type, bytes.subarray(0, 16));
  const done = (words: string | null, problem: KeyInFileProblem | null = null): KeyInFileWords => ({ kind, words: words && words.trim() ? words : null, next: null, problem: words && words.trim() ? null : (problem ?? 'empty') });
  if (bytes.length > KEY_IN_FILE_RULE.maxFileBytes) return { kind, words: null, next: null, problem: 'too-big' };
  if (kind === 'image') return { kind, words: null, next: 'photo', problem: null };
  if (kind === 'pdf') return { kind, words: null, next: 'pdf', problem: null };
  if (kind === 'old-office') return done(null, 'old-office');
  if (kind === 'unknown') return done(null, 'unknown');
  if (kind === 'word' || kind === 'excel' || kind === 'slides' || kind === 'opendoc') {
    const list = keyInZipList(bytes);
    if (list.length && list.every((e) => e.locked || e.name.endsWith('/'))) return done(null, 'locked');
    return done(await keyInZipWords(bytes, inflate), list.length ? 'empty' : 'unknown');
  }
  const text = keyInDecodeText(bytes);
  if (kind === 'html') return done(keyInHtmlWords(text));
  if (kind === 'rtf') return done(keyInRtfWords(text));
  return done(tidy(text));
}
