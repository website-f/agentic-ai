// P91 (Fitri, 9 Nov 2026: "where do I add the items? Add manually, or by Excel/PDF?"): item types, units with labels
// and bulk stock imported through the real API service on PostgreSQL with the item register modules and company walls
// on. Negative authorization: only the people the Items screen lets add may import; a refused row leaves nothing.
// Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRA_IMPORTS, cleanGrid, normaliseTable, prepareSheet, smartMatch, toCsv, type AlignField } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

/** What the browser does before sending: clean, prepare, match, normalise. */
function browserSide(rows: string[][], kind: 'itemType' | 'itemUnit' | 'itemStock') {
  const fields = [...(EXTRA_IMPORTS[kind].fields as AlignField[]), { key: '__company', label: 'Company', type: 'text' as const }];
  const prep = prepareSheet(cleanGrid(rows), fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  return { csv: toCsv(normaliseTable(prep.table, 0, m.columns, fields)), mapping: m.columns.map((c) => c.field ?? '') };
}

describe('P91 items import on PostgreSQL', () => {
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

  it('store staff import item types all or none; a supervisor and a guard are refused before any row', async () => {
    const sheet = [
      ['SENARAI BARANG (SISTEM LAMA)'],
      ['Nama Barang', 'Kategori', 'Jejak', 'Unit', 'Saiz'],
      ['Baju Hujan Pengawal', 'Keselamatan', 'Setiap unit', 'helai', 'L'],
      ['Penyapu Lantai', 'Pembersihan', 'Kuantiti', 'batang', ''],
    ];
    const b = browserSide(sheet, 'itemType');
    for (const uid of ['u-sv-sasa', 'u-guard-sasa-1']) {
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.preview(u, 'itemType', null, b.csv, { mapping: b.mapping })), /Only store staff/, uid);
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, 'itemType', null, b.csv, 'a'.repeat(64), { mapping: b.mapping })), /Only store staff/, uid);
    }
    const before = await count('SELECT count(*) n FROM prima.item_skus');
    const p = await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.preview(u, 'itemType', null, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    assert.equal(await count('SELECT count(*) n FROM prima.item_skus'), before);
    const r = await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.commit(u, 'itemType', null, b.csv, p.fingerprint, { mapping: b.mapping }));
    assert.equal(r.rows, 2);
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'code'='BAJU-HUJAN-PENGAWAL-L' AND data->>'category'='safety' AND data->>'tracking'='SERIALIZED'"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.item_skus WHERE data->>'code'='PENYAPU-LANTAI' AND data->>'tracking'='BULK'"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.org_imports WHERE data->>'kind'='itemType'"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.audit WHERE data->>'action'='org.import'"), 1);
    await assert.rejects(db.asUser('u-proc-store1', (svc, u) => svc.orgImport.commit(u, 'itemType', null, b.csv, p.fingerprint, { mapping: b.mapping })), /already imported/);
  });

  it('units from an old asset list get new labels to print; a bad row stops the import; another company is refused', async () => {
    const sheet = [
      ['No. Aset', 'Jenis Barang', 'No. Siri', 'Lokasi', 'Keadaan', 'Pemegang'],
      ['P91-OLD-1', 'BAJU-HUJAN-PENGAWAL-L', 'P91-SN-1', 'Pos Synthetic A', 'Baik', 'Synthetic Holder One'],
      ['P91-OLD-2', 'Baju Hujan Pengawal', 'P91-SN-2', 'Stor', 'Baik', ''],
      ['P91-OLD-3', 'No such item', '', 'Stor', '', ''],
    ];
    const b = browserSide(sheet, 'itemUnit');
    const units = () => count('SELECT count(*) n FROM prima.item_units');
    const before = await units();
    // A Sasa supervisor (operations only) and a manager of another company may not add Sasa's items.
    for (const uid of ['u-sv-sasa', 'u-cm-arsh']) await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.preview(u, 'itemUnit', 'co-sasa', b.csv, { mapping: b.mapping })), /Only store staff/, uid);
    const p = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'itemUnit', 'co-sasa', b.csv, { mapping: b.mapping }));
    assert.deepEqual(p.rows.map((r) => [r.row, r.ok]), [[2, true], [3, true], [4, false]]);
    assert.match(p.rows[2].problems.join(' '), /not in the catalogue/);
    assert.equal(await units(), before);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'itemUnit', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping })));
    assert.equal(await units(), before);
    const ok = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'itemUnit', 'co-sasa', b.csv, { mapping: b.mapping, skip: [4] }));
    assert.equal(ok.canImport, true);
    const r = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'itemUnit', 'co-sasa', b.csv, ok.fingerprint, { mapping: b.mapping, skip: [4] }));
    assert.equal(r.recordIds.length, 2);
    assert.equal(await units(), before + 2);
    const row = (await db.pool.query("SELECT data FROM prima.item_units WHERE data->>'legacyRef'='P91-OLD-1'")).rows[0].data;
    assert.equal(row.ownerPartyId, 'co-sasa');
    assert.equal(row.state, 'quarantine');
    assert.equal(row.labelGen, 0);
    assert.equal(row.labelVerifiedAt, null);
    assert.equal(row.pendingAck, null);
    assert.equal(row.custody.kind, 'store');
    assert.deepEqual(row.legacyFrom, { where: 'Pos Synthetic A', condition: 'Baik', holder: 'Synthetic Holder One' });
    assert.equal(await count("SELECT count(*) n FROM prima.item_events WHERE data->>'kind'='register' AND data->>'itemId'=$1", [row.id]), 1);
    // The board lists them among the labels to print.
    const board = await db.asUser('u-cm-sasa', (svc, u) => svc.items.board(u));
    assert.ok(board.items.some((i) => i.id === row.id && i.labelGen === 0));
    // The same old tag cannot be registered twice for the company.
    const again = browserSide([['No. Aset', 'Jenis Barang'], ['P91-OLD-1', 'BAJU-HUJAN-PENGAWAL-L']], 'itemUnit');
    const q = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'itemUnit', 'co-sasa', again.csv, { mapping: again.mapping }));
    assert.match(q.rows[0].problems.join(' '), /already registered/);
  });

  it('bulk stock adds an opening balance to the store; only the store of that company may', async () => {
    const b = browserSide([['Kod Barang', 'Baki Stok', 'Lokasi'], ['PENYAPU-LANTAI', '12', 'Gudang Synthetic']], 'itemStock');
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'itemStock', 'goodwill', b.csv, { mapping: b.mapping })), /Only store staff/);
    const qty = async () => Number((await db.pool.query("SELECT coalesce(sum((data->>'qty')::int),0) n FROM prima.item_lots WHERE data->>'skuId'=(SELECT id FROM prima.item_skus WHERE data->>'code'='PENYAPU-LANTAI') AND data->>'ownerPartyId'='goodwill' AND data->'custody'->>'ref'='store:goodwill'")).rows[0].n);
    const had = await qty();
    const p = await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.preview(u, 'itemStock', 'goodwill', b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    assert.equal(await qty(), had);
    await db.asUser('u-proc-store1', (svc, u) => svc.orgImport.commit(u, 'itemStock', 'goodwill', b.csv, p.fingerprint, { mapping: b.mapping }));
    assert.equal(await qty(), had + 12);
  });
});
