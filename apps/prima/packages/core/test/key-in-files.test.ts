import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  KEY_IN_FILE_RULE,
  keyInDocxWords,
  keyInExcelDate,
  keyInFileKind,
  keyInFileWords,
  keyInHtmlWords,
  keyInPdfLines,
  keyInPdfPageIsPicture,
  keyInRtfWords,
  keyInRulesRead,
  keyInZipList,
  type KeyInInflate,
} from '../src';

// Synthetic files only. A small zip writer builds Word, Excel and PowerPoint files the way Office does.
const enc = (s: string) => new TextEncoder().encode(s);
const inflate: KeyInInflate = async (data, max) => new Uint8Array(inflateRawSync(data, { maxOutputLength: max }));

function zip(parts: Record<string, string>, opts: { store?: boolean; locked?: boolean } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = enc(text);
    const data = opts.store ? raw : new Uint8Array(deflateRawSync(raw));
    const n = enc(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, opts.locked ? 1 : 0, true);
    local.setUint16(8, opts.store ? 0 : 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, n.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(8, opts.locked ? 1 : 0, true);
    cd.setUint16(10, opts.store ? 0 : 8, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, n.length, true);
    cd.setUint32(42, at, true);
    chunks.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(cd.buffer), n);
    at += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(parts).length, true);
  end.setUint16(10, Object.keys(parts).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, at, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const DOCX = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>SEBUT HARGA</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Tarikh: </w:t></w:r><w:r><w:t>12/11/2026</w:t></w:r></w:p>
<w:p><w:r><w:t>No. Sebut Harga: QT-2026/0457</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Pakaian seragam &amp; kasut</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>RM 900.00</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Jumlah Besar</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>RM 1,250.50</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Sah sehingga 12 Disember 2026</w:t></w:r></w:p></w:body></w:document>`;

describe('key-in files: what kind of file it is', () => {
  const kind = (name: string, type: string, head: number[] | string) => keyInFileKind(name, type, typeof head === 'string' ? enc(head) : new Uint8Array(head));
  it('goes by the first bytes before the name', () => {
    expect(kind('scan.docx', '', '%PDF-1.7')).toBe('pdf');
    expect(kind('paper', '', [0xff, 0xd8, 0xff, 0xe0])).toBe('image');
    expect(kind('paper.txt', 'text/plain', [0x89, 0x50, 0x4e, 0x47])).toBe('image');
    expect(kind('old.docx', '', [0xd0, 0xcf, 0x11, 0xe0])).toBe('old-office');
    expect(kind('a.rtf', '', '{\\rtf1')).toBe('rtf');
  });
  it('tells Word, Excel, PowerPoint and OpenDocument apart', () => {
    const pk = [0x50, 0x4b, 0x03, 0x04];
    expect(kind('a.docx', '', pk)).toBe('word');
    expect(kind('a.xlsx', '', pk)).toBe('excel');
    expect(kind('a.pptx', '', pk)).toBe('slides');
    expect(kind('a.odt', '', pk)).toBe('opendoc');
  });
  it('knows text, web pages, photos by name, and admits what it does not know', () => {
    expect(kind('a.csv', '', 'a,b')).toBe('text');
    expect(kind('a.html', '', '<html>')).toBe('html');
    expect(kind('a.heic', 'image/heic', [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])).toBe('image');
    expect(kind('a.doc', '', [1, 2, 3])).toBe('old-office');
    expect(kind('a.bin', '', [0, 1, 2, 3])).toBe('unknown');
    expect(kind('notes', '', 'Tarikh: 1/2/2026')).toBe('text');
  });
});

describe('key-in files: Word', () => {
  it('keeps a table row on one line so the rules find the total', async () => {
    const words = keyInDocxWords(DOCX);
    expect(words).toContain('Jumlah Besar\tRM 1,250.50');
    expect(words).toContain('Pakaian seragam & kasut');
    const got = await keyInFileWords(zip({ 'word/document.xml': DOCX }), 'quote.docx', '', inflate);
    expect(got.problem).toBeNull();
    const found = Object.fromEntries(keyInRulesRead('quote', got.words!).map((f) => [f.name, f.value]));
    expect(found).toEqual({ paperDate: '2026-11-12', amount: 1250.5, ref: 'QT-2026/0457', validUntil: '2026-12-12' });
  });
  it('reads a Word file whatever its name says, stored or packed', async () => {
    const got = await keyInFileWords(zip({ 'word/document.xml': DOCX }, { store: true }), 'renamed.zip.bin', '', inflate);
    expect(got.kind).toBe('word');
    expect(got.words).toContain('SEBUT HARGA');
  });
});

describe('key-in files: Excel', () => {
  const shared = `<sst><si><t>Invoice No</t></si><si><t>INV-88012</t></si><si><t>Date</t></si><si><r><t>Grand </t></r><r><t>Total</t></r></si><si><t>Due date</t></si></sst>`;
  const styles = `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;
  const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46338</v></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" s="2"><v>46368</v></c></row>
<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" s="3"><v>4820.5</v></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t>Qty</t></is></c><c r="B5"><v>12</v></c><c r="C5"/></row></sheetData></worksheet>`;
  it('turns day numbers into dates and money into printed figures', async () => {
    expect(keyInExcelDate(46338)).toBe('2026-11-12');
    const file = zip({ 'xl/workbook.xml': '<workbook/>', 'xl/sharedStrings.xml': shared, 'xl/styles.xml': styles, 'xl/worksheets/sheet1.xml': sheet });
    const got = await keyInFileWords(file, 'invoice.xlsx', '', inflate);
    expect(got.words).toBe('Invoice No\tINV-88012\nDate\t2026-11-12\nDue date\t2026-12-12\nGrand Total\t4820.50\nQty\t12');
    const found = Object.fromEntries(keyInRulesRead('invoice', got.words!).map((f) => [f.name, f.value]));
    expect(found).toEqual({ paperDate: '2026-11-12', amount: 4820.5, ref: 'INV-88012', dueOn: '2026-12-12' });
  });
});

describe('key-in files: PowerPoint, OpenDocument, web page, RTF, text', () => {
  it('reads slides and OpenDocument text', async () => {
    const pptx = zip({ 'ppt/presentation.xml': '<p/>', 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>Second</a:t></a:r></a:p>', 'ppt/slides/slide1.xml': '<a:p><a:r><a:t>Licence no: </a:t></a:r><a:r><a:t>KDN/123</a:t></a:r></a:p>' });
    expect((await keyInFileWords(pptx, 'a.pptx', '', inflate)).words).toBe('Licence no: KDN/123\n\nSecond');
    const odt = zip({ 'content.xml': '<office:text><text:p>Tarikh tamat: 30/11/2027</text:p><table:table-row><table:table-cell><text:p>Jumlah</text:p></table:table-cell><table:table-cell><text:p>RM 50.00</text:p></table:table-cell></table:table-row></office:text>' });
    const got = await keyInFileWords(odt, 'a.odt', '', inflate);
    expect(got.words).toContain('Tarikh tamat: 30/11/2027');
    expect(got.words).toContain('Jumlah\tRM 50.00');
  });
  it('reads a web page without its scripts, and an RTF without its settings', () => {
    expect(keyInHtmlWords('<html><head><title>x</title></head><body><script>steal()</script><table><tr><td>Total</td><td>RM&nbsp;12.00</td></tr></table><p>Date: 1/2/2026</p></body></html>')).toBe('Total\tRM 12.00\n\nDate: 1/2/2026');
    expect(keyInRtfWords('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Tarikh: 3/4/2026\\par Jumlah\\tab RM 9.90\\par}')).toBe('Tarikh: 3/4/2026\nJumlah\tRM 9.90');
  });
  it('reads text in UTF-8 and UTF-16', async () => {
    expect((await keyInFileWords(enc('Date,05/06/2026\r\nTotal,RM 7.00\r\n'), 'a.csv', 'text/csv', inflate)).words).toBe('Date,05/06/2026\nTotal,RM 7.00');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Ref: A12'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect((await keyInFileWords(utf16, 'a.txt', '', inflate)).words).toBe('Ref: A12');
  });
});

describe('key-in files: PDF lines', () => {
  it('puts words at the same height on one line, left to right, top first', () => {
    const lines = keyInPdfLines([
      { str: 'RM 1,250.00', x: 400, y: 500.4, h: 10 },
      { str: 'Tarikh: 12/11/2026', x: 50, y: 700, h: 10 },
      { str: 'Jumlah', x: 50, y: 500, h: 10 },
      { str: ' ', x: 60, y: 500, h: 10 },
    ]);
    expect(lines).toBe('Tarikh: 12/11/2026\nJumlah RM 1,250.00');
    expect(keyInRulesRead('receipt', lines).map((f) => f.value)).toEqual(['2026-11-12', 1250]);
  });
  it('knows a scanned page from a page with text', () => {
    expect(keyInPdfPageIsPicture(' \n ')).toBe(true);
    expect(keyInPdfPageIsPicture('Tarikh: 12/11/2026 Jumlah RM 1,250.00')).toBe(false);
  });
});

describe('key-in files: what is refused, and said plainly', () => {
  it('photos and PDFs are handed to the device readers', async () => {
    expect(await keyInFileWords(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg', 'image/jpeg', inflate)).toMatchObject({ next: 'photo', problem: null });
    expect(await keyInFileWords(enc('%PDF-1.4'), 'a.pdf', '', inflate)).toMatchObject({ next: 'pdf', problem: null });
  });
  it('old Office files, unknown files, locked files, empty files and files that are too big', async () => {
    expect((await keyInFileWords(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'a.doc', '', inflate)).problem).toBe('old-office');
    expect((await keyInFileWords(new Uint8Array([0, 1, 2, 3]), 'a.bin', '', inflate)).problem).toBe('unknown');
    expect((await keyInFileWords(zip({ 'word/document.xml': DOCX }, { locked: true }), 'a.docx', '', inflate)).problem).toBe('locked');
    expect((await keyInFileWords(zip({ 'word/document.xml': '<w:document/>' }), 'a.docx', '', inflate)).problem).toBe('empty');
    expect((await keyInFileWords(enc('PK\u0003\u0004 broken'), 'a.docx', '', inflate)).problem).toBe('unknown');
    expect((await keyInFileWords(new Uint8Array(KEY_IN_FILE_RULE.maxFileBytes + 1), 'a.txt', '', inflate)).problem).toBe('too-big');
  });
  it('a part that says it is bigger than the limit, or unpacks bigger, is not opened', async () => {
    const file = zip({ 'word/document.xml': DOCX });
    const list = keyInZipList(file);
    expect(list).toHaveLength(1);
    const tiny: KeyInInflate = async () => {
      throw new Error('too big');
    };
    expect((await keyInFileWords(file, 'a.docx', '', tiny)).words).toBeNull();
  });
});
