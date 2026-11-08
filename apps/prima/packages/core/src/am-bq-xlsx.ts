import type { AmBqLine } from "./types";
import type { AmBqSection } from "./types";


export interface BqWorkbookInput {
  title: string;
  location?: string;
  sections?: AmBqSection[];
  lines: Pick<AmBqLine, 'item' | 'unit' | 'qty' | 'section' | 'calc' | 'optional'>[];
  contingencyPct?: number;
  notes?: string[];
  drawings?: { ref: string; title: string }[];
}

const UNIT_SHOWN: Record<string, string> = { m2: 'm²', m3: 'm³' };

/** Letters for a 1-based column number (1 = A). */
const col = (n: number) => String.fromCharCode(64 + n);

const esc = (s: string) =>
  s
    // Characters XML 1.0 cannot carry.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Text is always written as an inline string, never as a formula, so typed text such as "=..." stays text. */
type Cell = { t: 's'; v: string; s?: number } | { t: 'n'; v: number; s?: number } | { t: 'f'; v: string; s?: number } | { t: 'blank'; s: number };

// Style indexes, matching styles() below.
const S = { plain: 0, bold: 1, title: 2, head: 3, money: 4, input: 5, pct: 6, wrap: 7, boldMoney: 8, qty: 9 };

class SheetXml {
  rows = new Map<number, Map<number, Cell>>();
  set(r: number, c: number, cell: Cell) {
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    this.rows.get(r)!.set(c, cell);
  }
  xml(widths: number[]): string {
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const rows = [...this.rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, cells]) => {
        const cs = [...cells.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([c, cell]) => {
            const ref = `${col(c)}${r}`;
            const s = cell.s ? ` s="${cell.s}"` : '';
            if (cell.t === 'blank') return `<c r="${ref}"${s}/>`;
            if (cell.t === 'n') return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
            if (cell.t === 'f') return `<c r="${ref}"${s}><f>${esc(cell.v)}</f></c>`;
            return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${r}">${cs}</row>`;
      })
      .join('');
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      // Print each sheet one page wide.
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      `<cols>${cols}</cols><sheetData>${rows}</sheetData>` +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>'
    );
  }
}

function styles(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2A8"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // plain
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // bold
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // title
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="center"/></xf>' + // head
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' + // money
    '<xf numFmtId="164" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>' + // input (yellow)
    '<xf numFmtId="9" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>' + // pct (yellow)
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>' + // wrap
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // bold money
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>' + // qty / unit
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

/** The three sheets' XML. Exposed for tests; use bqWorkbookXlsx for the file. */
export function bqWorkbookSheets(input: BqWorkbookInput): { ringkasan: string; bq: string; nota: string } {
  const sections = input.sections?.length ? input.sections : [{ code: 'A', title: 'KERJA' }];
  const codes = new Set(sections.map((s) => s.code));
  const lineSection = (l: BqWorkbookInput['lines'][number]) => (l.section && codes.has(l.section) ? l.section : sections[0].code);

  // --- BQ sheet
  const bq = new SheetXml();
  bq.set(1, 1, { t: 's', v: 'SENARAI KUANTITI (BQ)', s: S.title });
  bq.set(2, 1, { t: 's', v: input.title, s: S.bold });
  bq.set(3, 1, { t: 's', v: 'Sel kuning (Kadar) untuk diisi oleh kontraktor. Jumlah dikira secara automatik.' });
  ['Bil', 'Keterangan Kerja', 'Kuantiti', 'Unit', 'Kadar (RM)', 'Jumlah (RM)', 'Catatan / Pengiraan'].forEach((h, i) => bq.set(5, i + 1, { t: 's', v: h, s: S.head }));
  let r = 6;
  const totals: { code: string; title: string; cell: string }[] = [];
  for (const sec of sections) {
    const ls = input.lines.filter((l) => lineSection(l) === sec.code);
    if (!ls.length) continue;
    bq.set(r, 1, { t: 's', v: sec.code, s: S.bold });
    bq.set(r, 2, { t: 's', v: sec.title, s: S.bold });
    r++;
    const first = r;
    ls.forEach((l, i) => {
      bq.set(r, 1, { t: 's', v: `${sec.code}${i + 1}`, s: S.qty });
      bq.set(r, 2, { t: 's', v: l.item, s: S.wrap });
      bq.set(r, 3, { t: 'n', v: l.qty, s: S.qty });
      bq.set(r, 4, { t: 's', v: UNIT_SHOWN[l.unit] ?? l.unit, s: S.qty });
      bq.set(r, 5, { t: 'blank', s: S.input });
      bq.set(r, 6, { t: 'f', v: `C${r}*E${r}`, s: S.money });
      bq.set(r, 7, { t: 's', v: [l.calc ?? '', l.optional ? 'Pilihan: sebut harga berasingan' : ''].filter(Boolean).join('; '), s: S.wrap });
      r++;
    });
    bq.set(r, 2, { t: 's', v: `Jumlah Bahagian ${sec.code} (dibawa ke Ringkasan)`, s: S.bold });
    bq.set(r, 6, { t: 'f', v: `SUM(F${first}:F${r - 1})`, s: S.boldMoney });
    totals.push({ code: sec.code, title: sec.title, cell: `BQ!F${r}` });
    r += 2;
  }

  // --- Ringkasan sheet
  const sum = new SheetXml();
  sum.set(1, 1, { t: 's', v: 'RINGKASAN SENARAI KUANTITI', s: S.title });
  sum.set(2, 1, { t: 's', v: input.title, s: S.bold });
  sum.set(4, 1, { t: 's', v: 'Lokasi' });
  sum.set(4, 2, { t: 's', v: input.location ?? '' });
  sum.set(5, 1, { t: 's', v: 'Nama Kontraktor' });
  sum.set(5, 2, { t: 'blank', s: S.input });
  sum.set(6, 1, { t: 's', v: 'Tarikh Sebut Harga' });
  sum.set(6, 2, { t: 'blank', s: S.input });
  sum.set(7, 1, { t: 's', v: 'Sah Sehingga' });
  sum.set(7, 2, { t: 'blank', s: S.input });
  ['Bahagian', 'Keterangan', 'Jumlah (RM)'].forEach((h, i) => sum.set(9, i + 1, { t: 's', v: h, s: S.head }));
  let sr = 10;
  for (const t of totals) {
    sum.set(sr, 1, { t: 's', v: t.code, s: S.qty });
    sum.set(sr, 2, { t: 's', v: t.title, s: S.wrap });
    sum.set(sr, 3, { t: 'f', v: t.cell, s: S.money });
    sr++;
  }
  const sub = sr;
  sum.set(sub, 2, { t: 's', v: 'Jumlah Kecil (harga kontraktor)', s: S.bold });
  sum.set(sub, 3, { t: 'f', v: totals.length ? `SUM(C10:C${sub - 1})` : '0', s: S.boldMoney });
  sum.set(sub + 1, 2, { t: 's', v: 'Kadar kontingensi (%)' });
  sum.set(sub + 1, 3, { t: 'n', v: Math.max(0, input.contingencyPct ?? 0) / 100, s: S.pct });
  sum.set(sub + 2, 2, { t: 's', v: 'Kontingensi (simpanan pemilik, dibelanjakan hanya melalui VO)' });
  sum.set(sub + 2, 3, { t: 'f', v: `C${sub}*C${sub + 1}`, s: S.money });
  sum.set(sub + 3, 2, { t: 's', v: 'JUMLAH KESELURUHAN', s: S.bold });
  sum.set(sub + 3, 3, { t: 'f', v: `C${sub}+C${sub + 2}`, s: S.boldMoney });
  sum.set(sub + 5, 1, { t: 's', v: "Nota: Rujuk helaian 'Nota' untuk andaian kuantiti. Harga yang dibandingkan ialah Jumlah Kecil." });
  sum.set(sub + 7, 1, { t: 's', v: 'Tandatangan dan cop kontraktor:' });

  // --- Nota sheet
  const nota = new SheetXml();
  nota.set(1, 1, { t: 's', v: 'NOTA & ANDAIAN', s: S.title });
  let nr = 3;
  (input.notes ?? []).forEach((n, i) => {
    nota.set(nr, 1, { t: 'n', v: i + 1, s: S.qty });
    nota.set(nr, 2, { t: 's', v: n, s: S.wrap });
    nr++;
  });
  if (input.drawings?.length) {
    nr++;
    nota.set(nr++, 1, { t: 's', v: 'SENARAI LUKISAN', s: S.bold });
    for (const d of input.drawings) {
      nota.set(nr, 1, { t: 's', v: d.ref, s: S.qty });
      nota.set(nr, 2, { t: 's', v: d.title, s: S.wrap });
      nr++;
    }
  }

  return { ringkasan: sum.xml([12, 60, 18]), bq: bq.xml([7, 62, 10, 7, 13, 15, 40]), nota: nota.xml([10, 110]) };
}

// ---------- zip (stored, no compression) ----------

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true); // 1 Jan 1980
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The BQ for contractors as an .xlsx file (Ringkasan, BQ, Nota). The Kadar column is empty. */
export function bqWorkbookXlsx(input: BqWorkbookInput): Uint8Array {
  const enc = new TextEncoder();
  const sh = bqWorkbookSheets(input);
  const ct =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    [1, 2, 3].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const names = ['Ringkasan', 'BQ', 'Nota'];
  const wb =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>';
  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(styles()) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sh.ringkasan) },
    { name: 'xl/worksheets/sheet2.xml', data: enc.encode(sh.bq) },
    { name: 'xl/worksheets/sheet3.xml', data: enc.encode(sh.nota) },
  ]);
}