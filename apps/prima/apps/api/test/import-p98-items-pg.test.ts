// P98 (Fitri, 11 Nov 2026: "Import ... Excel, CSV, PDF ... form a QR code ... based on the code"): an old system's item
// list and stock balance read from a real PDF by the server (pdfjs-dist positions), merged by item code, and imported
// through the real API service on PostgreSQL with the item register modules and company walls on. The owner (the CEO
// record) may now import; a supervisor, a guard and another company's manager are refused before any row; a bad row
// is refused with its reason; a second import updates and never doubles stock. Synthetic files and seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ITEM_LIST_COLUMNS, itemCategoryGuess, itemListRow, itemsFromTable, mergeItemFiles, reportFromGrid, toCsv, type ItemListOutcome } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { ItemPdfError, readItemReportPdf } from '../src/item-report-pdf';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

/** A PDF whose pages draw each [x, y, text] in Helvetica 9pt (PDF points, y up), as a report printer writes it. */
function pdf(pages: [number, number, string][][]): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  let id = 4;
  for (const items of pages) {
    const content = ['BT', '/F1 9 Tf'];
    for (const [x, y, t] of items) content.push(`1 0 0 1 ${x} ${y} Tm (${t.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`);
    content.push('ET');
    const stream = content.join('\n');
    objs[id] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objs[id + 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id} 0 R >>`;
    pageIds.push(id + 1);
    id += 2;
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++)
    if (objs[i]) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 ${offsets[i] ? 'n' : 'f'} \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const HEAD: [number, number, string][] = [
  [38, 684, 'Item Code'],
  [162, 684, 'Description'],
  [327, 684, 'Stock Group'],
  [393, 684, 'UOM'],
  [442, 684, 'Rate'],
  [505, 684, 'Cost'],
  [561, 684, 'Price'],
];
const line = (y: number, code: string, desc: string, group: string, uom: string, cost: string, price: string): [number, number, string][] => [
  [38, y, code],
  [162, y, desc],
  [339, y, group],
  [396, y, uom],
  [457, y, '1'],
  [505, y, cost],
  [564, y, price],
];
/** A synthetic stock item list in the layout of the real report: title block, header on each page, groups, a second unit. */
const LIST_PDF = pdf([
  [
    [252, 721, 'STOCK ITEM LIST'],
    [518, 758, '02/10/26 4:12 PM'],
    [38, 703, 'SYNTHETIC TRADING SDN BHD'],
    [533, 703, 'Page 1 of 2'],
    ...HEAD,
    [38, 662, 'AKSESORI'],
    ...line(651, 'P98 WHISTLE', 'P98 WHISTLE CHROME', 'AKSESORI', 'UNIT', '1.00', '1.15'),
    ...line(639, 'P98 PEN - BLUE', 'P98 PEN - BLUE', 'AKSESORI', 'BOX', '41.90', '0.00'),
    [396, 627, 'PCS'],
    [457, 627, '1'],
    [505, 627, '0.70'],
    [564, 627, '0.81'],
  ],
  [
    [252, 721, 'STOCK ITEM LIST'],
    [38, 703, 'SYNTHETIC TRADING SDN BHD'],
    [533, 703, 'Page 2 of 2'],
    ...HEAD,
    [38, 662, 'BAHAN PENCUCI'],
    ...line(651, 'P98 FLOOR SOAP', 'P98 FLOOR SOAP PINE', 'BAHAN PENCUCI', 'BTL', '22.00', '25.30'),
    [383, 600, 'Total Items : 3'],
  ],
]);

const GOODWILL = 'goodwill';
const mapping = [...ITEM_LIST_COLUMNS] as string[];
const csvOf = (rows: string[][]) => toCsv([[...ITEM_LIST_COLUMNS], ...rows]);

describe('P98 item list import on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('org-links-v1.sql'));
    await db.pool.query(sql('item-register-v1.sql'));
    await db.pool.query(sql('item-register-v2.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });
  const count = async (q: string, p: unknown[] = []) => Number((await db.pool.query(q, p)).rows[0].n);

  it('reads the PDF on the server by text positions: columns, groups, the second unit, the declared total', async () => {
    const t = await readItemReportPdf(LIST_PDF);
    assert.equal(t.layout, 'itemList');
    assert.equal(t.declaredTotal, 3);
    const r = itemsFromTable(t, t.preset);
    assert.deepEqual(
      r.items.map((i) => [i.code, i.group, i.units.map((u) => u.uom).join('+')]),
      [
        ['P98 WHISTLE', 'AKSESORI', 'UNIT'],
        ['P98 PEN - BLUE', 'AKSESORI', 'BOX+PCS'],
        ['P98 FLOOR SOAP', 'BAHAN PENCUCI', 'BTL'],
      ],
    );
    await assert.rejects(readItemReportPdf(new TextEncoder().encode('not a pdf')), ItemPdfError);
  });

  it('the owner imports; others are refused before any row; a bad row is refused; a second import updates, never doubles', async () => {
    const t = await readItemReportPdf(LIST_PDF);
    const balance = reportFromGrid([
      ['Stock Qty Balance as at 10/11/2026'],
      ['Item Code', 'Description', 'Base SQty', 'S.UOM'],
      ['P98 WHISTLE', 'P98 WHISTLE CHROME', '40', 'UNIT'],
      ['P98 PEN - BLUE', 'P98 PEN - BLUE', '120', 'PCS'],
      ['P98 FLOOR SOAP', 'P98 FLOOR SOAP PINE', '-3', 'BTL'],
      ['P98 RAINCOAT', 'P98 RAINCOAT L', '7', 'PCS'],
    ]);
    const merged = mergeItemFiles([
      { file: 'list.pdf', layout: t.layout, asOf: t.asOf, items: itemsFromTable(t, t.preset).items },
      { file: 'balance.xlsx', layout: balance.layout, asOf: balance.asOf, items: itemsFromTable(balance, balance.preset).items },
    ]);
    assert.equal(merged.length, 4);
    const rows = merged.map((m) => itemListRow(m, itemCategoryGuess(m.name, m.group), 'BULK'));
    const csv = csvOf(rows);
    for (const uid of ['u-sv-sasa', 'u-guard-sasa-1', 'u-cm-sasa'])
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.preview(u, 'itemList', GOODWILL, csv, { mapping, headerRow: 0 })), /Only store staff/, uid);
    const before = await count('SELECT count(*) n FROM prima.item_skus');
    const p = await db.asUser('u-fauzan', (svc, u) => svc.orgImport.preview(u, 'itemList', GOODWILL, csv, { mapping, headerRow: 0 }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows.map((r) => r.problems)));
    assert.deepEqual(
      p.rows.map((r) => r.outcome?.action),
      ['create', 'create', 'create', 'create'],
    );
    assert.equal(await count('SELECT count(*) n FROM prima.item_skus'), before, 'the check keeps nothing');
    const r = await db.asUser('u-fauzan', (svc, u) => svc.orgImport.commit(u, 'itemList', GOODWILL, csv, p.fingerprint, { mapping, headerRow: 0 }));
    const out = r.outcomes as ItemListOutcome[];
    assert.deepEqual(
      out.map((o) => [o.code, o.stock]),
      [
        ['P98-WHISTLE', 'added'],
        ['P98-PEN-BLUE', 'added'],
        ['P98-FLOOR-SOAP', 'none'],
        ['P98-RAINCOAT', 'added'],
      ],
    );
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'sourceCode' = 'P98 PEN - BLUE' AND jsonb_array_length(data->'units') = 2"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.item_lots l JOIN prima.item_skus s ON s.id = l.data->>'skuId' WHERE s.data->>'code' = 'P98-WHISTLE' AND (l.data->>'qty')::int = 40 AND l.data->>'ownerPartyId' = $1", [GOODWILL]), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'code' = 'P98-FLOOR-SOAP' AND (data->'legacy'->>'qty')::int = -3"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.audit WHERE data->>'action' = 'org.import'"), 1);

    // Again with the whistle's balance changed: an update, the stock already there kept (never doubled), flagged.
    const again = rows.map((x) => [...x]);
    again[0][ITEM_LIST_COLUMNS.indexOf('qty')] = '55';
    const csv2 = csvOf(again);
    const p2 = await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.preview(u, 'itemList', GOODWILL, csv2, { mapping, headerRow: 0 }));
    assert.equal(p2.rows[0].outcome?.action, 'update');
    assert.equal(p2.rows[0].outcome?.stock, 'kept');
    await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.commit(u, 'itemList', GOODWILL, csv2, p2.fingerprint, { mapping, headerRow: 0 }));
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'sourceCode' LIKE 'P98 %'"), 4);
    assert.equal(await count("SELECT coalesce(sum((l.data->>'qty')::int),0) n FROM prima.item_lots l JOIN prima.item_skus s ON s.id = l.data->>'skuId' WHERE s.data->>'code' = 'P98-WHISTLE'"), 40);

    // A row Prima cannot take is refused with its reason, and the batch cannot be imported until it is left out.
    const bad = csvOf([
      ['P98 HOLSTER', 'Pistol holster', '', 'other', 'BULK', 'PCS', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['P98 ROPE', 'P98 rope 10m', '', 'tools', 'BULK', 'PCS', '', '', '', '', '2', '', '', '', '', '', '', '', ''],
    ]);
    const p3 = await db.asUser('u-fauzan', (svc, u) => svc.orgImport.preview(u, 'itemList', GOODWILL, bad, { mapping, headerRow: 0 }));
    assert.deepEqual(
      p3.rows.map((x) => x.ok),
      [false, true],
    );
    assert.match(p3.rows[0].problems.join(' '), /Arms Control/);
    assert.equal(p3.canImport, false);
    const skip = [p3.rows[0].row];
    const p4 = await db.asUser('u-fauzan', (svc, u) => svc.orgImport.preview(u, 'itemList', GOODWILL, bad, { mapping, headerRow: 0, skip }));
    assert.equal(p4.canImport, true);
    await db.asUser('u-fauzan', (svc, u) => svc.orgImport.commit(u, 'itemList', GOODWILL, bad, p4.fingerprint, { mapping, headerRow: 0, skip }));
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'code' IN ('P98-HOLSTER', 'P98-ROPE')"), 1);
  });

  it('the owner now sees Add and Import (addRights) and may register units and print their first labels; a supervisor may not', async () => {
    const board = await db.asUser('u-fauzan', (svc, u) => svc.items.board(u));
    assert.equal(board.addRights.types, true);
    assert.ok(board.addRights.parties.includes(GOODWILL));
    assert.equal(board.seesMoney, true);
    const rid = (k: string) => `p98-test-${k}-${Date.now()}`;
    const sku = (await db.asUser('u-fauzan', (svc, u) => svc.items.act(u, rid('sku'), { kind: 'sku.add', code: 'P98-RADIO-X', name: 'P98 radio X', category: 'radio', tracking: 'SERIALIZED', uom: 'PCS' }))) as {
      result: { id: string };
    };
    const reg = (await db.asUser('u-fauzan', (svc, u) => svc.items.act(u, rid('reg'), { kind: 'item.register', skuId: sku.result.id, partyId: GOODWILL, count: 2 }))) as { result: { id: string }[] };
    const printed = (await db.asUser('u-fauzan', (svc, u) => svc.items.act(u, rid('print'), { kind: 'label.print', itemIds: reg.result.map((i) => i.id) }))) as { result: { labels: unknown[] } };
    assert.equal(printed.result.labels.length, 2);
    await assert.rejects(db.asUser('u-sv-sasa', (svc, u) => svc.items.act(u, rid('sv'), { kind: 'item.register', skuId: sku.result.id, partyId: GOODWILL, count: 1 })), /Only store staff/);
    const sv = await db.asUser('u-sv-sasa', (svc, u) => svc.items.board(u));
    assert.deepEqual(sv.addRights, { types: false, parties: [] });
    // Operations see the item, never the old system's cost or price.
    assert.equal(sv.seesMoney, false);
    assert.ok(sv.skus.filter((s) => s.units?.length).every((s) => s.units!.every((x) => x.cost === null && x.price === null)));
  });
});
