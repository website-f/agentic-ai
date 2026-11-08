
/**
 * The words in a PDF made from a computer (Word, LibreOffice, a PDF printer, most e-perolehan letters), read on the
 * phone or PC with no outside service. It reads the file's objects (also those packed in object streams), unpacks the
 * page streams with the inflate given (the browser's own), and turns the text drawn on each page back into words using
 * each font's own character map. A scanned paper is a picture and has no words to read: this returns little or
 * nothing, and the screen asks for the text to be typed or pasted.
 */

type Inflate = (b: Uint8Array) => Promise<Uint8Array>;

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

function ascii85(s: string): Uint8Array {
  const src = s.replace(/\s/g, '').replace(/^<~/, '');
  const end = src.indexOf('~>');
  const body = end >= 0 ? src.slice(0, end) : src;
  const out: number[] = [];
  let group: number[] = [];
  for (const ch of body) {
    if (ch === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    group.push(c);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

/** Unpack a stream by its filters; null when a filter is not one we read (pictures, for example). */
async function decode(dict: string, raw: Uint8Array, inflate: Inflate): Promise<Uint8Array | null> {
  const f = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  const filters = f ? (f[1].match(/\/\w+/g) ?? []).map((x) => x.slice(1)) : [];
  let data = raw;
  for (const name of filters) {
    if (name === 'FlateDecode' || name === 'Fl') data = await inflate(data);
    else if (name === 'ASCII85Decode' || name === 'A85') data = ascii85(latin1(data));
    else if (name === 'ASCIIHexDecode' || name === 'AHx') {
      const h = latin1(data).replace(/[^0-9A-Fa-f]/g, '');
      data = new Uint8Array(Math.floor(h.length / 2)).map((_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
    } else return null;
  }
  return data;
}

interface Obj {
  dict: string;
  stream: string | null;
}

/** All objects by number: plain ones and those packed in object streams. */
async function objectsOf(bytes: Uint8Array, inflate: Inflate): Promise<Map<number, Obj>> {
  const all = latin1(bytes);
  const objs = new Map<number, Obj>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  let count = 0;
  // A hostile file cannot make the device unpack without end: at most 20,000 objects and 40 MB of unpacked streams.
  let budget = 40_000_000;
  while ((m = re.exec(all)) && count++ < 20000) {
    const start = m.index + m[0].length;
    const stop = all.indexOf('endobj', start);
    if (stop < 0) break;
    let body = all.slice(start, stop);
    let stream: string | null = null;
    const sm = /stream\r?\n/.exec(body);
    if (sm) {
      const dict = body.slice(0, sm.index);
      const at = start + sm.index + sm[0].length;
      const se = all.lastIndexOf('endstream', stop);
      const skip = /\/Subtype\s*\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFax|\/JBIG2|\/Length[123]\b/.test(dict);
      if (!skip && se > at && budget > 0) {
        try {
          const d = await decode(dict, bytes.subarray(at, se), inflate);
          budget -= d?.length ?? 0;
          stream = d && budget > 0 ? latin1(d) : null;
        } catch {
          stream = null;
        }
      }
      body = dict;
    }
    objs.set(Number(m[1]), { dict: body, stream });
    re.lastIndex = stop + 6;
  }
  // Objects packed inside object streams (Word and newer PDF makers).
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? NaN);
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    if (!Number.isFinite(first)) continue;
    const nums = o.stream.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < Math.min(n, nums.length / 2); k++) {
      const num = nums[k * 2];
      const off = first + nums[k * 2 + 1];
      const next = k + 1 < n ? first + nums[k * 2 + 3] : o.stream.length;
      if (!objs.has(num)) objs.set(num, { dict: o.stream.slice(off, next), stream: null });
    }
  }
  return objs;
}

interface FontMap {
  width: 1 | 2;
  map: Map<number, string>;
}

function cmapOf(s: string): FontMap {
  const map = new Map<number, string>();
  const uni = (h: string) => {
    let out = '';
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out || String.fromCharCode(parseInt(h, 16));
  };
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(s);
  let width: 1 | 2 = cs && cs[1].length <= 2 ? 1 : 2;
  for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (!cs) width = m[1].length <= 2 ? 1 : 2;
      map.set(parseInt(m[1], 16), uni(m[2]));
    }
  for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      if (!cs) width = m[1].length <= 2 ? 1 : 2;
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 4096);
      if (m[3]) {
        const base = parseInt(m[3], 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + c - lo));
      } else {
        const list = [...(m[4] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1]));
        list.forEach((u, k) => map.set(lo + k, u));
      }
    }
  }
  return { width, map };
}

/** Font name (as used on the page, e.g. F1) to its character map, from every resource dictionary in the file. */
function fontsOf(objs: Map<number, Obj>): Map<string, FontMap | null> {
  const fonts = new Map<string, FontMap | null>();
  const ref = (s: string) => {
    const r = /^\s*(\d+)\s+\d+\s+R/.exec(s);
    return r ? objs.get(Number(r[1]))?.dict ?? '' : null;
  };
  const fontObj = (d: string): FontMap | null => {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(d);
    const s = tu ? objs.get(Number(tu[1]))?.stream : null;
    if (s) return cmapOf(s);
    return /\/Identity-H/.test(d) ? { width: 2, map: new Map() } : null;
  };
  for (const o of objs.values()) {
    const fm = /\/Font\s*(<<|\d+\s+\d+\s+R)/.exec(o.dict);
    if (!fm) continue;
    let fontDict: string;
    if (fm[1] === '<<') {
      const at = fm.index + fm[0].length;
      const close = o.dict.indexOf('>>', at);
      fontDict = o.dict.slice(at, close < 0 ? undefined : close);
    } else fontDict = ref(fm[1]) ?? '';
    for (const e of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (fonts.has(e[1])) continue;
      fonts.set(e[1], fontObj(objs.get(Number(e[2]))?.dict ?? ''));
    }
  }
  return fonts;
}

function literal(s: string, i: number): [string, number] {
  // s[i] === '('
  let depth = 1;
  let out = '';
  let j = i + 1;
  while (j < s.length && depth > 0) {
    const ch = s[j];
    if (ch === '\\') {
      const n = s[j + 1];
      const esc: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (n in esc) {
        out += esc[n];
        j += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(j + 1, j + 4))![0];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        j += 1 + oct.length;
      } else if (n === '\r' || n === '\n') {
        j += n === '\r' && s[j + 2] === '\n' ? 3 : 2;
      } else {
        out += n ?? '';
        j += 2;
      }
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth > 0) out += ch;
    j++;
  }
  return [out, j];
}

/** Bytes of a string drawn on the page, turned into words with the font's map (or as Latin-1 when it has none). */
function words(raw: string, font: FontMap | null): string {
  if (!font || !font.map.size) return font?.width === 2 ? '' : raw;
  let t = '';
  if (font.width === 2) {
    for (let k = 0; k + 1 < raw.length; k += 2) t += font.map.get((raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1)) ?? '';
  } else for (const ch of raw) t += font.map.get(ch.charCodeAt(0)) ?? ch;
  return t;
}

/** The text drawn by one page stream. */
function pageText(s: string, fonts: Map<string, FontMap | null>): string {
  if (!/\bBT\b/.test(s)) return '';
  let out = '';
  let parts: (string | number | { name: string })[] = [];
  let font: FontMap | null = null;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') {
      const [t, j] = literal(s, i);
      parts.push(words(t, font));
      i = j;
      continue;
    }
    if (ch === '<' && s[i + 1] === '<') {
      // An inline dictionary (marked content): skip it.
      const j = s.indexOf('>>', i);
      i = j < 0 ? s.length : j + 2;
      continue;
    }
    if (ch === '<') {
      const j = s.indexOf('>', i);
      if (j < 0) break;
      const h = s.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, '');
      let raw = '';
      for (let k = 0; k + 2 <= h.length; k += 2) raw += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
      parts.push(words(raw, font));
      i = j + 1;
      continue;
    }
    if (ch === '/') {
      const m = /^\/[^\s/<>[\]()]*/.exec(s.slice(i, i + 128))![0];
      parts.push({ name: m.slice(1) });
      i += m.length;
      continue;
    }
    if (ch === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (/[-+.\d]/.test(ch)) {
      const m = /^[-+]?\d*\.?\d+/.exec(s.slice(i, i + 24));
      if (m) {
        parts.push(Number(m[0]));
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z'"*]/.test(ch)) {
      const op = /^[A-Za-z'"*]+/.exec(s.slice(i, i + 10))![0];
      i += op.length;
      const strings = () => parts.filter((p): p is string => typeof p === 'string').join('');
      if (op === 'Tf') {
        const n = parts.find((p): p is { name: string } => typeof p === 'object');
        font = n ? (fonts.get(n.name) ?? null) : null;
      } else if (op === 'Tj') out += strings();
      else if (op === "'" || op === '"') out += `\n${strings()}`;
      else if (op === 'TJ') {
        // Inside [...]: a large gap between pieces is a space between words.
        for (const p of parts) out += typeof p === 'string' ? p : typeof p === 'number' && p < -200 ? ' ' : '';
      } else if (op === 'Td' || op === 'TD') {
        const ty = parts[parts.length - 1];
        out += typeof ty === 'number' && Math.abs(ty) > 0.5 ? '\n' : ' ';
      } else if (op === 'T*' || op === 'ET') out += '\n';
      else if (op === 'Tm') out += ' \n';
      if (op !== 'BT') parts = [];
      continue;
    }
    i++;
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array, inflate: Inflate, maxChars = 120_000): Promise<string> {
  if (latin1(bytes.subarray(0, 1024)).indexOf('%PDF') < 0) return '';
  const objs = await objectsOf(bytes, inflate);
  const fonts = fontsOf(objs);
  // Page content streams, in page order where the file names them; otherwise every stream that draws text.
  const pages = [...objs.values()].filter((o) => /\/Type\s*\/Page\b(?!s)/.test(o.dict));
  const contentIds: number[] = [];
  for (const p of pages) {
    const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
    if (c) for (const r of c[1].matchAll(/(\d+)\s+\d+\s+R/g)) contentIds.push(Number(r[1]));
  }
  const streams = contentIds.length ? contentIds.map((id) => objs.get(id)?.stream ?? '') : [...objs.values()].map((o) => o.stream ?? '');
  let text = '';
  for (const s of streams) {
    if (!s || s.includes('begincmap')) continue;
    const t = pageText(s, fonts);
    if (t.trim()) text += `${t}\n`;
    if (text.length > maxChars) break;
  }
  return text
    .replace(/[^\S\n]+\n/g, '\n')
    // A sentence wrapped onto the next line is joined again; a new line, number or heading stays on its own.
    .replace(/([^\n.:;])\n+(?=[a-z])/g, '$1 ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}