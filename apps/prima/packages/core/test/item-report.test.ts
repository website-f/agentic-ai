// P98 (Fitri, 11 Nov 2026: "Import ... Excel, CSV, PDF ... check all the columns and put them in, with all the
// records there"): the three stock reports an accounting package prints, rebuilt from where each piece of text sits on
// the page, plus the same lists as Excel and CSV. Every fixture is synthetic: made-up companies, items and suppliers in
// the layout of the real reports (title block, repeated page header, groups, second units, supplier cost lines, wrapped
// codes, negative balances, a movement ledger with "... Continued" and totals).
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  decodeCard,
  decodeUnits,
  encodeCard,
  encodeUnits,
  generateDataset,
  itemCategoryGuess,
  itemListRow,
  itemsFromTable,
  mergeItemFiles,
  myt,
  parseCsv,
  primaCodeOf,
  readXlsx,
  reportFromGrid,
  reportFromPdf,
  splitJoined,
  toCsv,
  typeLabelCode,
  typeLabelPayload,
  withOrgLinks,
  ITEM_LIST_COLUMNS,
  type PdfPageText,
  type ItemListOutcome,
} from '../src';

/** A page from lines of [y, [x, width, text]...] at one font size (PDF points, y up). */
function page(size: number, lines: [number, [number, number, string][]][]): PdfPageText {
  return { pieces: lines.flatMap(([y, ps]) => ps.map(([x, w, text]) => ({ x, y, w, size, text }))) };
}

// ----- 1. A stock item list (two pages) -----
const LIST_HEAD: [number, [number, number, string][]] = [684, [[38, 46, 'Item Code'], [162, 49, 'Description'], [327, 53, 'Stock Group'], [393, 21, 'UOM'], [442, 20, 'Rate'], [505, 19, 'Cost'], [561, 21, 'Price']]];
const item = (y: number, code: string, desc: string, group: [number, number, string][], uom: string, rate: string, cost: string, price: string): [number, [number, number, string][]] => [
  y,
  [[38, code.length * 5, code], [162, desc.length * 5, desc], ...group, [396, 20, uom], [457, 5, rate], [505, 17, cost], [564, 17, price]],
];
const LIST: PdfPageText[] = [
  page(9, [
    [758, [[38, 35, 'Item Group'], [116, 2, ':'], [125, 7, 'All'], [518, 65, '02/10/26 4:12 PM']]],
    [750, [[38, 32, 'Item Code'], [116, 2, ':'], [125, 7, 'All'], [558, 25, 'ADMIN']]],
    [721, [[252, 124, 'STOCK ITEM LIST']]],
    [703, [[38, 237, 'SYNTHETIC TRADING SDN BHD(000000-X)'], [533, 50, 'Page 1 of 2']]],
    LIST_HEAD,
    [662, [[38, 52, 'AKSESORI']]],
    item(651, 'TEST LOGO - ALPHA', 'TEST LOGO - ALPHA', [[339, 41, 'AKSESORI']], 'UNIT', '1', '3.00', '3.45'),
    [639, [[38, 71, 'POINT CLOCKING'], [115, 20, 'NO 1'], [162, 71, 'POINT CLOCKING'], [238, 20, 'NO 1'], [339, 41, 'AKSESORI'], [396, 20, 'UNIT'], [457, 5, '1'], [505, 17, '0.00'], [564, 17, '0.00']]],
    item(627, 'BALL PEN - BLUE', 'BALL PEN - BLUE', [[339, 41, 'AKSESORI']], 'BOX', '1', '41.90', '0.00'),
    [615, [[396, 15, 'PCS'], [457, 5, '1'], [505, 17, '0.70'], [564, 17, '0.81']]],
    [598, [[59, 67, 'Purchase Price Tag'], [136, 56, 'Company Name'], [278, 12, 'Qty'], [331, 17, 'UOM'], [374, 32, 'Unit Cost'], [431, 30, 'Discount']]],
    [584, [[117, 127, 'SYNTH SUPPLY SDN BHD'], [286, 4, '0'], [329, 18, 'PCS'], [389, 20, '0.65']]],
    [566, [[38, 64, 'UNIFORM M']]],
    [554, [[38, 245, 'WHITE SLEEVE- ZED MWHITE SLEEVE-ZED M'], [329, 39, 'UNIFORM'], [373, 7, 'M'], [396, 20, 'UNIT'], [457, 5, '1'], [505, 17, '0.00'], [564, 17, '0.00']]],
    [536, [[38, 87, 'BAHAN PENCUCI']]],
    item(524, 'SABUN LANTAI PINE', 'SABUN LANTAI PINE 5 LITER HIJAU PEKAT', [[311, 28, 'BAHAN'], [344, 36, 'PENCUCI']], 'BTL', '1', '22.00', '25.30'),
    [40, [[551, 9, '1']]],
  ]),
  page(9, [
    [757, [[518, 65, '02/10/26 4:12 PM']]],
    [721, [[252, 124, 'STOCK ITEM LIST']]],
    [703, [[38, 237, 'SYNTHETIC TRADING SDN BHD(000000-X)'], [533, 50, 'Page 2 of 2']]],
    LIST_HEAD,
    [662, [[38, 41, 'OTHERS']]],
    item(651, 'SET KIT A', 'SET KIT A', [[347, 33, 'OTHERS']], 'SET', '1', '12.00', '0.00'),
    [641, [[162, 90, '(PEN, RULER, FILE)']]],
    item(629, 'RACUN RUMPUT', 'RACUN RUMPUT', [[347, 33, 'OTHERS']], 'LITER', '1', '10.05', '12.75'),
    [617, [[396, 24, 'TONG'], [452, 10, '20'], [495, 27, '201.00'], [554, 27, '231.15']]],
    [600, [[383, 45, 'Total Items'], [434, 3, ':'], [474, 15, '7']]],
  ]),
];

// ----- 2. A stock quantity balance (one page) -----
const BAL: PdfPageText[] = [
  page(8, [
    [804, [[505, 55, 'Date : 10/11/2026']]],
    [798, [[30, 201, 'Stock Qty Balance as at 10/11/2026']]],
    [785, [[30, 101, '(with multi-UOM)']]],
    [757, [[30, 91, 'SYNTHETIC TRADING SDN BHD'], [516, 44, 'User: TESTER']]],
    [739, [[339, 25, 'MULTI'], [428, 24, 'x Rate'], [494, 27, '= BASE']]],
    [725, [[30, 39, 'Item Code'], [115, 43, 'Description'], [302, 14, 'Qty'], [319, 20, 'UOM'], [368, 37, 'Loose Qty'], [499, 18, 'SQty'], [521, 26, 'S.UOM']]],
    [710, [[30, 65, '160 ENGINE PLUG'], [115, 84, '160 ENGINE PLUG COIL'], [513, 4, '5'], [521, 18, 'UNIT']]],
    [701, [[30, 17, 'COIL']]],
    [689, [[30, 85, 'TEST LOGO - ALPHA'], [115, 85, 'TEST LOGO - ALPHA'], [498, 19, '9,773'], [521, 18, 'UNIT']]],
    [675, [[30, 167, 'BALL PEN - BLUE BALL PEN - BLUE'], [504, 13, '120'], [521, 18, 'PCS']]],
    [661, [[30, 60, 'REVENUE - SUB'], [115, 90, 'REVENUE - SUB'], [508, 9, '-71'], [521, 18, 'UNIT']]],
    [646, [[30, 49, 'Total Items: 4'], [426, 26, 'TOTAL'], [482, 36, '9,827.00']]],
    [630, [[30, 49, 'Stock Group: All']]],
    [37, [[551, 9, '1']]],
  ]),
];

// ----- 3. A stock card (two pages, one item over the page break) -----
const CARD_HEAD: [number, [number, number, string][]] = [
  646,
  [[38, 26, 'Stk Grp'], [84, 37, 'Item Code'], [139, 29, 'Location'], [181, 20, 'Batch'], [227, 24, 'Project'], [268, 16, 'Date'], [308, 26, 'Doc No'], [365, 39, 'Description'], [476, 22, 'Qty In'], [510, 27, 'Qty Out'], [556, 29, 'Bal Qty']],
];
const CARD: PdfPageText[] = [
  page(8, [
    [757, [[38, 16, 'Date'], [109, 3, ':'], [122, 23, 'From :'], [147, 42, '01/01/2026'], [194, 55, 'To 31/10/2026']]],
    [729, [[38, 37, 'Item Code'], [109, 3, ':'], [122, 8, 'All'], [276, 76, 'Stock Card']]],
    [715, [[268, 93, 'As At 31/10/2026']]],
    [670, [[38, 240, 'SYNTHETIC TRADING SDN BHD (000000-X)'], [526, 55, 'Page 1 of 2']]],
    CARD_HEAD,
    [628, [[40, 212, '160 ENGINE PLUG COIL160 ENGINE PLUG COIL']]],
    [614, [[84, 44, '160 ENGINE'], [268, 33, '01/01/26'], [365, 48, '(Balance b/d)'], [580, 4, '0']]],
    [602, [[268, 33, '20/04/26'], [308, 35, 'GR-00163'], [365, 68, 'SYNTH MACHINERY &'], [496, 4, '5'], [580, 4, '5']]],
    [590, [[268, 33, '15/05/26'], [308, 35, 'GR-00175'], [365, 68, 'SYNTH MACHINERY &'], [496, 4, '5'], [575, 9, '10']]],
    [578, [[268, 33, '15/09/26'], [308, 33, 'AJ-00048'], [365, 62, 'Stock Adjustment'], [533, 4, '5'], [580, 4, '5']]],
    [561, [[491, 9, '10'], [533, 4, '5']]],
    [546, [[40, 85, 'TEST LOGO - ALPHA'], [146, 85, 'TEST LOGO - ALPHA']]],
    [532, [[84, 39, 'TEST LOGO'], [268, 33, '01/01/26'], [365, 48, '(Balance b/d)'], [575, 9, '20']]],
    [520, [[268, 33, '10/02/26'], [308, 35, 'GR-00087'], [365, 67, 'SYNTH DESIGNERS &'], [487, 13, '200'], [571, 13, '220']]],
    [508, [[268, 33, '06/04/26'], [308, 36, 'DO-00408'], [365, 77, 'SYNTH CLIENT ONE'], [524, 13, '200'], [575, 9, '20']]],
  ]),
  page(8, [
    [739, [[276, 76, 'Stock Card']]],
    [706, [[38, 240, 'SYNTHETIC TRADING SDN BHD (000000-X)'], [526, 55, 'Page 2 of 2']]],
    [683, CARD_HEAD[1]],
    [666, [[40, 85, 'TEST LOGO - ALPHA'], [146, 85, 'TEST LOGO - ALPHA'], [541, 40, '... Continued']]],
    [652, [[268, 33, '15/07/26'], [308, 36, 'DO-00625'], [365, 69, 'SYNTH CLIENT TWO'], [533, 4, '3'], [575, 9, '17']]],
    [640, [[491, 9, '200'], [524, 13, '203']]],
    [620, [[40, 60, 'REVENUE - SUB'], [146, 60, 'REVENUE - SUB']]],
    [606, [[84, 44, 'REVENUE - S'], [268, 33, '01/01/26'], [365, 48, '(Balance b/d)'], [580, 4, '0']]],
    [594, [[268, 33, '12/02/26'], [308, 36, 'DO-00280'], [365, 51, 'SYNTH CLIENT ONE'], [529, 9, '71'], [571, 13, '-71']]],
    [580, [[496, 4, '0'], [529, 9, '71']]],
    [560, [[50, 58, 'Grand Total'], [472, 26, '210'], [511, 26, '279']]],
  ]),
];

describe('P98 PDF stock reports', () => {
  it('reads a stock item list: groups, a second unit, the supplier cost line, wrapped and joined text, the declared total', () => {
    const t = reportFromPdf(LIST);
    expect(t.layout).toBe('itemList');
    expect(t.title).toBe('STOCK ITEM LIST');
    expect(t.asOf).toBe('2026-10-02');
    expect(t.company).toBe('SYNTHETIC TRADING SDN BHD');
    expect(t.declaredTotal).toBe(7);
    expect(t.preset).toEqual(['itemCode', 'itemName', 'stockGroup', 'uom', 'uomRate', 'unitCost', 'unitPrice']);
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => i.code)).toEqual(['TEST LOGO - ALPHA', 'POINT CLOCKING NO 1', 'BALL PEN - BLUE', 'WHITE SLEEVE- ZED M', 'SABUN LANTAI PINE', 'SET KIT A', 'RACUN RUMPUT']);
    expect(r.items.length).toBe(t.declaredTotal);
    const by = new Map(r.items.map((i) => [i.code, i]));
    expect(by.get('BALL PEN - BLUE')!.units).toEqual([
      { uom: 'BOX', rate: 1, cost: '41.90', price: '0.00' },
      { uom: 'PCS', rate: 1, cost: '0.70', price: '0.81' },
    ]);
    expect(by.get('BALL PEN - BLUE')!.lastCost).toEqual({ cost: '0.65', uom: 'PCS', supplier: 'SYNTH SUPPLY SDN BHD' });
    expect(by.get('WHITE SLEEVE- ZED M')!.name).toBe('WHITE SLEEVE-ZED M');
    expect(by.get('WHITE SLEEVE- ZED M')!.group).toBe('UNIFORM M');
    expect(by.get('SABUN LANTAI PINE')!.group).toBe('BAHAN PENCUCI');
    expect(by.get('SABUN LANTAI PINE')!.name).toBe('SABUN LANTAI PINE 5 LITER HIJAU PEKAT');
    expect(by.get('SET KIT A')!.name).toBe('SET KIT A (PEN, RULER, FILE)');
    expect(by.get('RACUN RUMPUT')!.units.map((u) => [u.uom, u.rate])).toEqual([
      ['LITER', 1],
      ['TONG', 20],
    ]);
    expect(r.counts).toMatchObject({ extraUnits: 2, supplierLines: 1, groupHeadings: 4 });
    expect(r.skipped).toEqual([]);
    // Page titles, the header again and the page number are dropped, not read as items.
    expect(t.dropped.repeated).toBeGreaterThanOrEqual(6);
  });

  it('reads a stock quantity balance: two-line header, codes wrapped onto the next line, a negative balance', () => {
    const t = reportFromPdf(BAL);
    expect(t.layout).toBe('qtyBalance');
    expect(t.asOf).toBe('2026-11-10');
    expect(t.header).toEqual(['Item Code', 'Description', 'Qty', 'MULTI UOM', 'Loose Qty', 'x Rate', '= BASE SQty', 'S.UOM']);
    expect(t.declaredTotal).toBe(4);
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => [i.code, i.qty, i.qtyUom])).toEqual([
      ['160 ENGINE PLUG COIL', 5, 'UNIT'],
      ['TEST LOGO - ALPHA', 9773, 'UNIT'],
      ['BALL PEN - BLUE', 120, 'PCS'],
      ['REVENUE - SUB', -71, 'UNIT'],
    ]);
    expect(r.items.reduce((a, i) => a + (i.qty ?? 0), 0)).toBe(9827);
  });

  it('reads a stock card: headings, opening balance, in and out, the item that runs over the page, totals left out', () => {
    const t = reportFromPdf(CARD);
    expect(t.layout).toBe('stockCard');
    expect(t.asOf).toBe('2026-10-31');
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => [i.code, i.name])).toEqual([
      ['160 ENGINE PLUG COIL', '160 ENGINE PLUG COIL'],
      ['TEST LOGO - ALPHA', 'TEST LOGO - ALPHA'],
      ['REVENUE - SUB', 'REVENUE - SUB'],
    ]);
    const [a, b, c] = r.items;
    expect(a.card).toEqual({ from: '2026-01-01', to: '2026-09-15', opening: 0, in: 10, out: 5, balance: 5, lines: 3, docs: { GR: 2, AJ: 1 } });
    expect(b.card).toMatchObject({ opening: 20, in: 200, out: 203, balance: 17, lines: 3, docs: { GR: 1, DO: 2 } });
    expect(c.qty).toBe(-71);
    expect(r.counts.ledgerLines).toBe(7);
    // Client names on delivery orders are never kept: only counts of documents by kind.
    expect(JSON.stringify(r.items)).not.toContain('SYNTH CLIENT');
  });

  it('splits a code and name printed in one piece where the first word comes again', () => {
    expect(splitJoined('ADD LOGO - JATIWIRA ADD LOGO - JATIWIRA', 30, 197, 115)).toEqual(['ADD LOGO - JATIWIRA', 'ADD LOGO - JATIWIRA']);
    expect(splitJoined('WHITE SHORT SLEEVE- AYU MWHITE SHORT SLEEVE-AYU M', 38, 283, 162)).toEqual(['WHITE SHORT SLEEVE- AYU M', 'WHITE SHORT SLEEVE-AYU M']);
  });
});

describe('P98 sheets: Excel and CSV', () => {
  it('finds the header under a title block in Malay, matches the columns, reads group rows and second units', () => {
    const grid = [
      ['SENARAI STOK SYARIKAT CONTOH'],
      ['Sehingga 01/11/2026'],
      [],
      ['Kod Item', 'Keterangan', 'Kumpulan', 'Unit', 'Kadar', 'Kos', 'Harga', 'Baki'],
      ['AKSESORI'],
      ['WSL-01', 'Wisel krom', 'AKSESORI', 'UNIT', '1', '1.00', '1.15', '40'],
      ['PEN-B', 'Pen biru', 'AKSESORI', 'KOTAK', '1', '41.90', '0', '3'],
      ['', '', '', 'PCS', '1', '0.70', '0.81', ''],
      ['Jumlah', '', '', '', '', '', '', '43'],
    ];
    const t = reportFromGrid(grid);
    expect(t.layout).toBe('itemList');
    expect(t.asOf).toBe('2026-11-01');
    expect(t.preset).toEqual(['itemCode', 'itemName', 'stockGroup', 'uom', 'uomRate', 'unitCost', 'unitPrice', 'balanceQty']);
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => [i.code, i.qty, i.units.length, i.group])).toEqual([
      ['WSL-01', 40, 1, 'AKSESORI'],
      ['PEN-B', 3, 2, 'AKSESORI'],
    ]);
    expect(t.dropped.totals).toBe(1);
  });

  it('reads a CSV with English headers in any order, fuzzy spellings included', () => {
    const csv = 'Qty On Hand,Descripton,Item Cod,Category,UOM\r\n12,Raincoat L,RC-L,SAFETY,PCS\r\n"1,200",Floor cleaner 5L,FC-5,"BAHAN PENCUCI",BTL\r\n';
    const t = reportFromGrid(parseCsv(csv));
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => [i.code, i.name, i.qty, i.group, i.units[0]?.uom])).toEqual([
      ['RC-L', 'Raincoat L', 12, 'SAFETY', 'PCS'],
      ['FC-5', 'Floor cleaner 5L', 1200, 'BAHAN PENCUCI', 'BTL'],
    ]);
  });

  it('reads the same list from an Excel workbook', async () => {
    const file = xlsx({
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Stok" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        row(1, ['Stock Item List']) +
        row(3, ['Item Code', 'Description', 'Stock Group', 'UOM', 'Rate', 'Cost', 'Price']) +
        row(4, ['VST-R', 'Reflective vest', 'OTHERS', 'UNIT', '1', '17.00', '0.00']) +
        row(5, ['TRCH-B', 'Big torch light', 'AKSESORI', 'UNIT', '1', '19.00', '21.85']) +
        '</sheetData></worksheet>',
    });
    const sheets = await readXlsx(file, async (b) => new Uint8Array(inflateRawSync(b)));
    const t = reportFromGrid(sheets[0].rows);
    const r = itemsFromTable(t, t.preset);
    expect(r.items.map((i) => [i.code, i.units[0]])).toEqual([
      ['VST-R', { uom: 'UNIT', rate: 1, cost: '17.00', price: '0.00' }],
      ['TRCH-B', { uom: 'UNIT', rate: 1, cost: '19.00', price: '21.85' }],
    ]);
    expect(r.items.map((i) => itemCategoryGuess(i.name, i.group))).toEqual(['vest', 'torchlight']);
  });

  it('lets the person change a column: a column read as nothing becomes the quantity', () => {
    const t = reportFromGrid([
      ['Code', 'Name', 'Something'],
      ['A-1', 'Alpha item', '7'],
    ]);
    const fields = [...t.preset];
    fields[2] = 'balanceQty';
    expect(itemsFromTable(t, fields).items[0].qty).toBe(7);
  });
});

describe('P98 one list from several files', () => {
  it('merges items with the same code across the three reports; the quantity from the newest balance', () => {
    const files = [
      { file: 'list.pdf', t: reportFromPdf(LIST) },
      { file: 'balance.pdf', t: reportFromPdf(BAL) },
      { file: 'card.pdf', t: reportFromPdf(CARD) },
    ].map(({ file, t }) => ({ file, layout: t.layout, asOf: t.asOf, items: itemsFromTable(t, t.preset).items }));
    const m = mergeItemFiles(files);
    const by = new Map(m.map((x) => [x.code, x]));
    // 7 in the list; the engine plug is in the balance and the card only; REVENUE - SUB too.
    expect(m.length).toBe(9);
    const logo = by.get('TEST LOGO - ALPHA')!;
    expect(logo.files).toEqual(['list.pdf', 'balance.pdf', 'card.pdf']);
    expect(logo.qty).toBe(9773);
    expect(logo.qtyFrom).toMatchObject({ file: 'balance.pdf', asOf: '2026-11-10' });
    expect(logo.card?.balance).toBe(17);
    expect(logo.units[0]).toMatchObject({ uom: 'UNIT', cost: '3.00' });
    expect(by.get('BALL PEN - BLUE')!.files).toEqual(['list.pdf', 'balance.pdf']);
    expect(by.get('REVENUE - SUB')!.warnings.join(' ')).toMatch(/below zero/);
    expect(by.get('160 ENGINE PLUG COIL')!.files).toEqual(['balance.pdf', 'card.pdf']);
  });

  it('makes the Prima code and the label payload from the old code, and reads the encoded cells back', () => {
    expect(primaCodeOf('ADD LOGO - ARROW', '')).toBe('ADD-LOGO-ARROW');
    expect(primaCodeOf('PEWANGI/PENCUCI LANTAI', '')).toBe('PEWANGI-PENCUCI-LANTAI');
    expect(typeLabelPayload('ADD-LOGO-ARROW')).toBe('PT-ADD-LOGO-ARROW');
    expect(typeLabelCode('pt-add-logo-arrow')).toBe('ADD-LOGO-ARROW');
    expect(typeLabelCode('P1-ABCD')).toBeNull();
    const units = [
      { uom: 'BOX', rate: 1, cost: '41.90', price: '0.00' },
      { uom: 'PCS', rate: null, cost: '0.70', price: null },
    ];
    expect(decodeUnits(encodeUnits(units))).toEqual(units);
    expect(decodeUnits('BOX:x:1:1')).toBeNull();
    const card = { from: '2026-01-01', to: '2026-09-15', opening: 0, in: 10, out: 5, balance: 5, lines: 3, docs: { GR: 2, AJ: 1 } };
    expect(decodeCard(encodeCard(card))).toEqual(card);
    expect(decodeCard('from=yesterday')).toBe('bad');
  });
});

// ----- The import itself (kind itemList), on the memory store -----
const TODAY = '2026-11-11';
const NOW = myt(TODAY, '10:30');
function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, store, user };
}
const csvOf = (rows: string[][]) => toCsv([[...ITEM_LIST_COLUMNS], ...rows]);
const mapping = [...ITEM_LIST_COLUMNS];
const GOODWILL = 'goodwill';

describe('P98 item list import (kind itemList)', () => {
  const merged = () =>
    mergeItemFiles(
      [
        { file: 'list.pdf', t: reportFromPdf(LIST) },
        { file: 'balance.pdf', t: reportFromPdf(BAL) },
      ].map(({ file, t }) => ({ file, layout: t.layout, asOf: t.asOf, items: itemsFromTable(t, t.preset).items })),
    );

  it('the owner adds new item types with their units, costs and opening stock; a second import updates, never doubles', async () => {
    const { svc, user, store } = fresh();
    const owner = user('u-fauzan');
    const rows = merged().map((m) => itemListRow(m, itemCategoryGuess(m.name, m.group), 'BULK'));
    const csv = csvOf(rows);
    const p = await svc.orgImport.preview(owner, 'itemList', GOODWILL, csv, { mapping, headerRow: 0 });
    expect(p.badRows).toBe(0);
    expect(p.canImport).toBe(true);
    expect(p.rows.every((r) => r.outcome?.action === 'create')).toBe(true);
    const r = await svc.orgImport.commit(owner, 'itemList', GOODWILL, csv, p.fingerprint, { mapping, headerRow: 0 });
    const out = r.outcomes as ItemListOutcome[];
    expect(out.length).toBe(rows.length);
    const skus = await store.list('itemSkus');
    const logo = skus.find((s) => s.sourceCode === 'TEST LOGO - ALPHA')!;
    expect(logo.code).toBe('TEST-LOGO-ALPHA');
    expect(logo.units).toEqual([{ uom: 'UNIT', rate: 1, cost: '3.00', price: '3.45' }]);
    expect(logo.legacy).toMatchObject({ qty: 9773, qtyAsOf: '2026-11-10', stocked: { partyId: GOODWILL, qty: 9773 } });
    const lots = await store.list('itemLots', { skuId: logo.id });
    expect(lots.map((l) => [l.ownerPartyId, l.qty])).toEqual([[GOODWILL, 9773]]);
    const pen = skus.find((s) => s.sourceCode === 'BALL PEN - BLUE')!;
    // The balance's stock unit is the base unit; the box is its other unit.
    expect(pen.uom).toBe('PCS');
    expect(pen.units?.map((u) => u.uom)).toEqual(['BOX', 'PCS']);
    expect(pen.lastCost).toEqual({ cost: '0.65', uom: 'PCS', supplier: 'SYNTH SUPPLY SDN BHD' });
    const racun = skus.find((s) => s.sourceCode === 'RACUN RUMPUT')!;
    expect([racun.uom, racun.uomLabel]).toEqual(['LITRE', 'LITER']);
    // A negative balance is kept as a reference and adds no stock.
    const neg = out.find((o) => o.code === 'REVENUE-SUB')!;
    expect(neg.stock).toBe('none');
    expect(neg.notes.join(' ')).toMatch(/below zero/);
    // The same list again, a quantity changed: types are updated, stock already there is kept and flagged.
    const again = rows.map((x) => [...x]);
    const qi = ITEM_LIST_COLUMNS.indexOf('qty');
    const ni = ITEM_LIST_COLUMNS.indexOf('name');
    const li = again.findIndex((x) => x[0] === 'TEST LOGO - ALPHA');
    again[li][qi] = '9000';
    again[li][ni] = 'TEST LOGO - ALPHA (EMBROIDERED)';
    const csv2 = csvOf(again);
    const p2 = await svc.orgImport.preview(owner, 'itemList', GOODWILL, csv2, { mapping, headerRow: 0 });
    expect(p2.rows.filter((x) => x.outcome?.action === 'create')).toEqual([]);
    const logoRow = p2.rows.find((x) => x.outcome?.code === 'TEST-LOGO-ALPHA')!;
    expect(logoRow.outcome).toMatchObject({ action: 'update', stock: 'kept' });
    await svc.orgImport.commit(owner, 'itemList', GOODWILL, csv2, p2.fingerprint, { mapping, headerRow: 0 });
    expect((await store.list('itemSkus')).filter((s) => s.sourceCode === 'TEST LOGO - ALPHA').map((s) => s.name)).toEqual(['TEST LOGO - ALPHA (EMBROIDERED)']);
    expect((await store.list('itemLots', { skuId: logo.id })).map((l) => l.qty)).toEqual([9773]);
  });

  it('refuses a supervisor, a guard and another company’s manager before any row, and checks every row again', async () => {
    const { svc, user } = fresh();
    const csv = csvOf([itemListRow(merged()[0], 'uniform', 'BULK')]);
    for (const id of ['u-sv-sasa', 'u-guard-sasa-1', 'u-cm-sasa'])
      await expect(svc.orgImport.preview(user(id), 'itemList', GOODWILL, csv, { mapping, headerRow: 0 }), id).rejects.toThrow(/Only store staff/);
    // Store staff of Goodwill may; a row with a category Prima does not have, or a controlled item, is refused with its reason.
    const bad = csvOf([
      ['X-1', 'Mystery thing', '', 'spaceship', 'BULK', 'PCS', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['HOL-1', 'Pistol holster', '', 'other', 'BULK', 'PCS', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['OK-1', 'Plain rope', '', 'tools', 'BULK', 'PCS', '', '', '', '', '3', '', '', '', '', '', '', '', ''],
    ]);
    const p = await svc.orgImport.preview(user('u-proc-store1'), 'itemList', GOODWILL, bad, { mapping, headerRow: 0 });
    expect(p.rows.map((r) => r.ok)).toEqual([false, false, true]);
    expect(p.rows[1].problems.join(' ')).toMatch(/Arms Control/);
    expect(p.canImport).toBe(false);
  });
});

function row(r: number, cells: string[]) {
  return `<row r="${r}">${cells.map((c, i) => `<c r="${String.fromCharCode(65 + i)}${r}" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row>`;
}

/** A minimal zip (the container of .xlsx). */
function xlsx(parts: Record<string, string>): Uint8Array {
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
