// P90: a table in a PDF (a list printed from the old system, a report saved as PDF) read back into rows and columns, on
// the phone or PC with no outside service. The text reader (pdf-text.ts) gives words in reading order; a table also needs
// where each piece of text sits. This follows the page's text and position operators (BT/ET, Tm, Td, TD, T*, TL, Tf,
// cm, q/Q), places every string drawn at its point on the page, groups the strings into lines by height, and finds the
// columns as the left edges that most lines share. A scanned PDF is a picture: it has no text to read and gives no rows.

import { pdfFontsOf, pdfLiteral, pdfObjectsOf, pdfWords, type PdfFontMap } from './pdf-text';

type Inflate = (b: Uint8Array) => Promise<Uint8Array>;
type M = [number, number, number, number, number, number];

interface Piece {
  x: number;
  y: number;
  /** Estimated right edge (no font widths are read: half the font size per character). */
  right: number;
  size: number;
  text: string;
  page: number;
}

const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID: M = [1, 0, 0, 1, 0, 0];

/**
 * The width of a text in ems, estimated with the widths of a common sans-serif (no font metrics are read): close enough
 * to tell a letter drawn on its own ("W" then "orker") from the space between two words.
 */
function textWidth(t: string): number {
  let w = 0;
  for (const ch of t) {
    if (ch === ' ') w += 0.28;
    else if (/[WMmw@]/.test(ch)) w += 0.88;
    else if (/[iljtfrI.,:;'!|()[\]-]/.test(ch)) w += 0.3;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.56;
    else w += 0.52;
  }
  return w;
}

/** Every string drawn on one page stream, with its place on the page. */
function piecesOf(s: string, fonts: Map<string, PdfFontMap | null>, page: number): Piece[] {
  const out: Piece[] = [];
  const stack: M[] = [];
  let ctm: M = ID;
  let tm: M = ID;
  let lm: M = ID;
  let font: PdfFontMap | null = null;
  let size = 10;
  let leading = 0;
  let parts: (string | number | { name: string } | { arr: (string | number)[] })[] = [];
  let arr: (string | number)[] | null = null;
  const draw = (text: string) => {
    if (!text.trim()) return;
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[2], m[3]) || 1;
    const fs = size * scale;
    out.push({ x: m[4], y: m[5], right: m[4] + textWidth(text) * fs, size: fs, text, page });
  };
  const nums = () => parts.filter((p): p is number => typeof p === 'number');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') {
      const [t, j] = pdfLiteral(s, i);
      const w = pdfWords(t, font);
      if (arr) arr.push(w);
      else parts.push(w);
      i = j;
      continue;
    }
    if (ch === '[') {
      arr = [];
      i++;
      continue;
    }
    if (ch === ']') {
      if (arr) parts.push({ arr });
      arr = null;
      i++;
      continue;
    }
    if (ch === '<' && s[i + 1] === '<') {
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
      const w = pdfWords(raw, font);
      if (arr) arr.push(w);
      else parts.push(w);
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
        const n = Number(m[0]);
        if (arr) arr.push(n);
        else parts.push(n);
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z'"*]/.test(ch)) {
      const op = /^[A-Za-z'"*]+/.exec(s.slice(i, i + 10))![0];
      i += op.length;
      const n = nums();
      const strings = () => parts.filter((p): p is string => typeof p === 'string').join('');
      const nextLine = () => {
        lm = mul([1, 0, 0, 1, 0, -leading], lm);
        tm = lm;
      };
      switch (op) {
        case 'q':
          stack.push(ctm);
          break;
        case 'Q':
          ctm = stack.pop() ?? ID;
          break;
        case 'cm':
          if (n.length >= 6) ctm = mul(n.slice(-6) as M, ctm);
          break;
        case 'BT':
          tm = lm = ID;
          break;
        case 'Tf': {
          const f = parts.find((p): p is { name: string } => typeof p === 'object' && 'name' in p);
          font = f ? (fonts.get(f.name) ?? null) : null;
          if (n.length) size = Math.abs(n[n.length - 1]) || size;
          break;
        }
        case 'TL':
          if (n.length) leading = n[n.length - 1];
          break;
        case 'Tm':
          if (n.length >= 6) tm = lm = n.slice(-6) as M;
          break;
        case 'Td':
        case 'TD':
          if (n.length >= 2) {
            if (op === 'TD') leading = -n[n.length - 1];
            lm = mul([1, 0, 0, 1, n[n.length - 2], n[n.length - 1]], lm);
            tm = lm;
          }
          break;
        case 'T*':
          nextLine();
          break;
        case 'Tj':
          draw(strings());
          break;
        case "'":
        case '"':
          nextLine();
          draw(strings());
          break;
        case 'TJ': {
          const a = parts.find((p): p is { arr: (string | number)[] } => typeof p === 'object' && 'arr' in p)?.arr ?? [];
          let t = '';
          for (const p of a) t += typeof p === 'string' ? p : p < -200 ? ' ' : '';
          draw(t);
          break;
        }
      }
      parts = [];
      continue;
    }
    i++;
  }
  return out;
}

/** Pieces into lines (same height on the same page), each line's pieces left to right, touching pieces joined. */
function linesOf(pieces: Piece[]): Piece[][] {
  const sorted = [...pieces].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Piece[][] = [];
  for (const p of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, p.size * 0.35);
    if (last && last[0].page === p.page && Math.abs(last[0].y - p.y) <= tol) last.push(p);
    else lines.push([p]);
  }
  return lines.map((l) => {
    const xs = l.sort((a, b) => a.x - b.x);
    const merged: Piece[] = [];
    for (const p of xs) {
      const prev = merged[merged.length - 1];
      // A piece starting right where the last ended is the same cell (a word drawn in parts).
      if (prev && p.x - prev.right < p.size * 0.45) {
        prev.text = `${prev.text}${p.x - prev.right > p.size * 0.14 && !prev.text.endsWith(' ') && !p.text.startsWith(' ') ? ' ' : ''}${p.text}`;
        prev.right = Math.max(prev.right, p.right);
      } else merged.push({ ...p });
    }
    return merged;
  });
}

/**
 * The rows of the tables in a PDF: the columns are the left edges most lines with several cells share; each cell goes to
 * the column whose edge is nearest at or before it. Lines with one piece (titles, page numbers) stay as one-cell rows,
 * which the importer then skips as a title or ignores.
 */
export async function extractPdfTable(bytes: Uint8Array, inflate: Inflate): Promise<string[][]> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.indexOf('%PDF') < 0) return [];
  const objs = await pdfObjectsOf(bytes, inflate);
  const fonts = pdfFontsOf(objs);
  const pages = [...objs.values()].filter((o) => /\/Type\s*\/Page\b(?!s)/.test(o.dict));
  const pieces: Piece[] = [];
  pages.forEach((p, pageNo) => {
    const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(p.dict);
    if (!c) return;
    // The content of one page may be split over several streams: they are one stream drawn in order.
    const body = [...c[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => objs.get(Number(r[1]))?.stream ?? '').join('\n');
    if (body.length < 4_000_000) pieces.push(...piecesOf(body, fonts, pageNo));
  });
  if (pieces.length > 200_000) throw new Error('The PDF is too big. Print only the pages with the list.');
  const lines = linesOf(pieces);
  const multi = lines.filter((l) => l.length >= 2);
  if (!multi.length) return lines.map((l) => l.map((p) => p.text.trim()));
  // Column edges: cluster the left edges of cells on the fullest lines (the records; a centred heading or a wrapped
  // second line of a cell starts elsewhere); keep edges most such lines use.
  const most = Math.max(...multi.map((l) => l.length));
  const dense = multi.filter((l) => l.length >= Math.max(2, Math.ceil(most * 0.6)));
  // Records nearly always hold a digit (a date, a number, a code); headings rarely do. Their edges are the columns.
  const withDigits = dense.filter((l) => l.some((p) => /\d/.test(p.text)));
  const base = withDigits.length >= 2 ? withDigits : dense;
  const starts = base.flatMap((l) => l.map((p) => p.x)).sort((a, b) => a - b);
  const tol = 6;
  const clusters: { x: number; n: number; sum: number }[] = [];
  for (const x of starts) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.x <= tol) {
      c.n++;
      c.sum += x;
    } else clusters.push({ x, n: 1, sum: x });
  }
  const minUse = Math.max(2, Math.floor(base.length * 0.4));
  const edges = clusters.filter((c) => c.n >= minUse).map((c) => c.sum / c.n);
  if (!edges.length) return lines.map((l) => l.map((p) => p.text.trim()));
  const cellsOf = (l: Piece[]) => {
    const row: string[] = new Array(edges.length).fill('');
    for (const p of l) {
      let k = 0;
      for (let e = 0; e < edges.length; e++) if (edges[e] <= p.x + tol) k = e;
      row[k] = row[k] ? `${row[k]} ${p.text.trim()}` : p.text.trim();
    }
    return row;
  };
  // A cell with two or more lines of text draws them as separate lines; the record's other cells sit between them
  // (centred) or above them (top-aligned). Lines that close together are one record, joined column by column:
  // half a line apart or less (centred cells), or a little over one line apart when the lower line is a sparse second
  // line of some cells. Two full records one line apart stay two records.
  const out: string[][] = [];
  let band: { cells: string[]; y: number; page: number; size: number } | null = null;
  for (const l of lines) {
    const cells = cellsOf(l);
    const filled = cells.filter(Boolean).length;
    const y = l[0].y;
    const size = Math.max(...l.map((p) => p.size));
    const gap = band && band.page === l[0].page ? band.y - y : Infinity;
    const sparse = filled <= Math.max(1, Math.floor(edges.length * 0.5));
    if (band && l.length > 0 && (gap <= 0.8 * size || (gap <= 1.3 * size && sparse && filled > 0 && band.cells.filter(Boolean).length > 1))) {
      band.cells = band.cells.map((c, k) => (cells[k] ? (c ? `${c} ${cells[k]}` : cells[k]) : c));
      band.y = y;
      band.size = size;
      continue;
    }
    if (band) out.push(band.cells);
    band = { cells, y, page: l[0].page, size };
  }
  if (band) out.push(band.cells);
  return out.map((row) => {
    while (row.length && !row[row.length - 1]) row.pop();
    return row;
  });
}
