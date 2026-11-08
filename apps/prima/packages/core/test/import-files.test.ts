// P90: lists kept in Word and PDF read back into rows and columns, then matched. Synthetic files built here.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EXTRA_IMPORTS, extractPdfTable, prepareSheet, readDocxTables, smartMatch, type AlignField } from '../src';

const inflate = async (b: Uint8Array) => new Uint8Array(inflateRawSync(b));

/** A minimal zip (the container of .docx and .xlsx). */
function zip(parts: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, xml] of Object.entries(parts)) {
    const raw = enc.encode(xml);
    const data = deflateRawSync(raw);
    const n = enc.encode(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, Buffer.from(n), data);
    centrals.push(ch, Buffer.from(n));
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** A one-font PDF whose page draws each [x, y, text] (PDF points, y up), uncompressed, as a PDF printer writes it. */
function pdf(pages: [number, number, string][][]): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let id = 4;
  for (const items of pages) {
    const content = ['1 0 0 -1 0 842 cm', 'BT', '/F1 9 Tf'];
    // Flipped page (y down), as Word prints: each line placed with Tm.
    for (const [x, y, t] of items) content.push(`1 0 0 -1 ${x} ${y} Tm (${t.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`);
    content.push('ET');
    const stream = content.join('\n');
    objs[id] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objs[id + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id} 0 R >>`;
    pageIds.push(id + 1);
    id += 2;
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  for (let i = 1; i < objs.length; i++) if (objs[i]) out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  out += 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
  return new TextEncoder().encode(out);
}

const FW = EXTRA_IMPORTS.fwWorker.fields as AlignField[];

describe('Word tables', () => {
  it('reads each table as a sheet, cells spanning columns keep the columns in line', async () => {
    const cell = (t: string, span = 1) => `<w:tc>${span > 1 ? `<w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>` : ''}<w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const row = (...c: string[]) => `<w:tr>${c.join('')}</w:tr>`;
    const doc = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Senarai pekerja</w:t></w:r></w:p><w:tbl>' +
        row(cell('Nama'), cell('No. Pasport'), cell('Tamat PLKS')) +
        row(cell('Ram Synthetic'), cell('PA1234567'), cell('15/04/2027')) +
        row(cell('Catatan: semua aktif', 2), cell('')) +
        '</w:tbl></w:body></w:document>',
    });
    const sheets = await readDocxTables(doc, inflate);
    expect(sheets).toEqual([
      {
        name: 'Table 1',
        rows: [
          ['Nama', 'No. Pasport', 'Tamat PLKS'],
          ['Ram Synthetic', 'PA1234567', '15/04/2027'],
          ['Catatan: semua aktif', '', ''],
        ],
      },
    ]);
    await expect(readDocxTables(zip({ 'word/document.xml': '<w:document><w:body><w:p/></w:body></w:document>' }), inflate)).rejects.toThrow(/no table/);
  });
});

describe('PDF tables', () => {
  it('reads a printed list back into its columns, across pages, and matches it', async () => {
    const header: [number, number, string][] = [
      [40, 100, 'Bil'],
      [70, 100, 'Nama Pekerja'],
      [200, 100, 'No. Pasport'],
      [300, 100, 'Tarikh Lahir'],
      [400, 100, 'Tamat PLKS'],
    ];
    const line = (y: number, n: string, name: string, pp: string, dob: string, plks: string): [number, number, string][] => [
      [40, y, n],
      [70, y, name],
      [200, y, pp],
      [300, y, dob],
      [400, y, plks],
    ];
    const file = pdf([
      [[40, 60, 'SENARAI PEKERJA ASING'], ...header, ...line(115, '1', 'Ram Synthetic', 'PA1234567', '12/03/1988', '15/04/2027'), ...line(130, '2', 'Hari Testlama', 'PB7654321', '23/07/1992', '01/05/2027')],
      [...header, ...line(115, '3', 'Suman Mockrai', 'PA5555555', '05/11/1985', '30/06/2027'), [280, 800, 'Muka 2']],
    ]);
    const rows = await extractPdfTable(file, inflate);
    expect(rows[0]).toEqual(['SENARAI PEKERJA ASING']);
    expect(rows[1]).toEqual(['Bil', 'Nama Pekerja', 'No. Pasport', 'Tarikh Lahir', 'Tamat PLKS']);
    expect(rows[2]).toEqual(['1', 'Ram Synthetic', 'PA1234567', '12/03/1988', '15/04/2027']);
    const prep = prepareSheet(rows, FW);
    // The header printed again on page 2 is left out; the page number is a one-cell line.
    expect(prep.table.filter((r) => r[1] && /Synthetic|Testlama|Mockrai/.test(r[1])).length).toBe(3);
    expect(prep.droppedRows.length).toBe(1);
    const m = smartMatch(prep.table, FW, { headerRow: 0 });
    expect(m.columns.map((c) => c.field)).toEqual([null, 'name', 'passportNo', 'dob', 'permitExpiresOn']);
  });

  it('a file that is not a PDF gives no rows', async () => {
    expect(await extractPdfTable(new TextEncoder().encode('hello'), inflate)).toEqual([]);
  });
});
