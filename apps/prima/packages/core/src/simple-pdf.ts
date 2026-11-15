// A small text-only PDF (A4, Helvetica, one column) for printable records such as toolbox minutes (Part X6).
// No fonts are embedded; characters outside Latin-1 are replaced with '?'.

const enc = new TextEncoder();

function esc(s: string): string {
  return s
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrap(line: string, width = 95): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let cur = '';
  for (const w of line.split(' ')) {
    if ((cur + ' ' + w).trim().length > width) {
      if (cur) out.push(cur);
      cur = w.length > width ? w.slice(0, width) : w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** Lines of text to a PDF; 60 lines a page. */
export function simplePdf(lines: string[]): Uint8Array {
  const all = lines.flatMap((l) => wrap(l));
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += 60) pages.push(all.slice(i, i + 60));
  if (!pages.length) pages.push(['']);
  const objs: string[] = [];
  // 1 catalog, 2 pages, 3 font, then per page: page + content.
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((p, i) => {
    const body = ['BT', '/F1 9 Tf', '12 TL', '40 800 Td', ...p.map((l) => `(${esc(l)}) '`), 'ET'].join('\n');
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Latin-1 bytes (one byte per character) so offsets stay right.
  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 0xff;
  void enc;
  return out;
}
