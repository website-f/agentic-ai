// P91 (Fitri, 9 Nov 2026: migrate the old records into Prima): training records, guard papers, fuel cards, CMS
// readiness devices and site fittings import from any file through the real API service on PostgreSQL, with the
// company walls on. Negative authorization: only the people who may add the record by hand may import it; a refused
// row leaves nothing. Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRA_IMPORTS, normaliseTable, prepareSheet, smartMatch, toCsv, type AlignField, type ImportKind } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

/** What the browser does before sending: prepare, match, normalise. */
function browserSide(rows: string[][], kind: ImportKind) {
  const fields = (EXTRA_IMPORTS as Record<string, { fields: unknown[] }>)[kind].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  return { csv: toCsv(normaliseTable(prep.table, 0, m.columns, fields)), mapping: m.columns.map((c) => c.field ?? '') };
}

describe('P91 import kinds on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('org-links-v1.sql'));
    await db.pool.query(sql('cleaning-ops-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const count = async (q: string, p: unknown[] = []) => Number((await db.pool.query(q, p)).rows[0].n);

  /** Refused for every one of these people, at the dry run and at the import; nothing is written. */
  async function refused(uids: string[], kind: ImportKind, b: { csv: string; mapping: string[] }) {
    for (const uid of uids) {
      const p = await db.asUser(uid, (svc, u) => svc.orgImport.preview(u, kind, null, b.csv, { mapping: b.mapping }));
      assert.equal(p.canImport, false, uid);
      await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, kind, null, b.csv, p.fingerprint, { mapping: b.mapping })), uid);
    }
  }

  it('HR imports training records from a messy sheet; Transport and a company manager (office staff) are refused', async () => {
    const b = browserSide(
      [
        ['REKOD LATIHAN (SISTEM LAMA)'],
        ['No Pekerja', 'Nama Kursus', 'Penganjur', 'Tarikh Mula', 'Tarikh Tamat', 'Jam', 'Kos (RM)'],
        ['SASA0002', 'Synthetic P91 First Aid', 'Synthetic Academy', '14/03/2025', '15/03/2025', '16', 'RM 1,200.00'],
        ['SASAO001', 'Synthetic P91 Report Writing', 'Synthetic Institute', '10/05/2025', '', '7', ''],
      ],
      'staffTraining',
    );
    await refused(['u-transport', 'u-cm-sasa'], 'staffTraining', b);
    assert.equal(await count("SELECT count(*) n FROM prima.staff_training WHERE data->>'course' LIKE 'Synthetic P91%'"), 0);
    const p = await db.asUser('u-pwvsb-hr', (svc, u) => svc.orgImport.preview(u, 'staffTraining', null, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    const r = await db.asUser('u-pwvsb-hr', (svc, u) => svc.orgImport.commit(u, 'staffTraining', null, b.csv, p.fingerprint, { mapping: b.mapping }));
    assert.equal(r.recordIds.length, 2);
    assert.equal(await count("SELECT count(*) n FROM prima.staff_training WHERE data->>'course' LIKE 'Synthetic P91%'"), 2);
    assert.equal(await count("SELECT count(*) n FROM prima.staff_training WHERE data->>'course'='Synthetic P91 Report Writing' AND data->>'to'='2025-05-10'"), 1);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.orgImport.commit(u, 'staffTraining', null, b.csv, p.fingerprint, { mapping: b.mapping })), /already imported/);
  });

  it('guard papers: the company head records its own guards; Transport and another company are refused', async () => {
    const b = browserSide(
      [
        ['No Pengawal', 'Jenis', 'No Kad', 'Tarikh Dikeluarkan', 'Tarikh Tamat'],
        ['SASA0002', 'Kad KDN', 'KDN-P91-0002', '01/06/2025', '31/05/2027'],
        ['SASA0002', 'Sijil CSG', 'CSG-P91-0002', '15/01/2025', ''],
      ],
      'guardPaper',
    );
    await refused(['u-transport', 'u-cm-arsh'], 'guardPaper', b);
    assert.equal(await count("SELECT count(*) n FROM prima.credentials WHERE data->>'number' LIKE '%-P91-%'"), 0);
    const p = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'guardPaper', null, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'guardPaper', null, b.csv, p.fingerprint, { mapping: b.mapping }));
    const rows = (await db.pool.query("SELECT data FROM prima.credentials WHERE data->>'number' LIKE '%-P91-%' ORDER BY data->>'type'")).rows.map((x) => x.data);
    assert.deepEqual(rows.map((c) => [c.type, c.issuedOn, c.expiresOn]), [
      ['CSG_TRAINING', '2025-01-15', null],
      ['KDN_GUARD_CARD', '2025-06-01', '2027-05-31'],
    ]);
  });

  it('fuel cards: Transport only, and only the last 4 digits are stored', async () => {
    const b = browserSide(
      [
        ['No Plat', 'Syarikat Kad', 'No Kad', 'Minyak', 'Pemegang', 'Sejak'],
        ['WXY1234', 'Synthetic P91 Fleet', '7012 3456 7890 4321', 'Disel', 'Synthetic Driver', '01/03/2025'],
      ],
      'fuelCard',
    );
    await refused(['u-cm-sasa', 'u-pwvsb-hr'], 'fuelCard', b);
    const p = await db.asUser('u-transport', (svc, u) => svc.orgImport.preview(u, 'fuelCard', null, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    await db.asUser('u-transport', (svc, u) => svc.orgImport.commit(u, 'fuelCard', null, b.csv, p.fingerprint, { mapping: b.mapping }));
    const v = (await db.pool.query("SELECT data FROM prima.vehicles WHERE data->>'plate'='WXY 1234'")).rows[0].data;
    assert.equal(v.cards.find((c: { issuer: string }) => c.issuer === 'Synthetic P91 Fleet')?.last4, '4321');
    assert.ok(!JSON.stringify(v).includes('34567890'));
  });

  it('CMS readiness devices and site fittings: only those who record them for that site', async () => {
    const dev = browserSide(
      [
        ['Kod Tapak', 'Peranti', 'Jenama', 'Kuantiti'],
        ['SASA-001', 'CCTV recorder', 'SynthP91Brand', '2'],
      ],
      'cmsDevice',
    );
    await refused(['u-transport', 'u-cm-arsh'], 'cmsDevice', dev);
    const p = await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.preview(u, 'cmsDevice', null, dev.csv, { mapping: dev.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    await db.asUser('u-cm-sasa', (svc, u) => svc.orgImport.commit(u, 'cmsDevice', null, dev.csv, p.fingerprint, { mapping: dev.mapping }));
    const site = (await db.pool.query("SELECT data FROM prima.sites WHERE data->>'code'='SASA-001'")).rows[0].data;
    assert.equal(site.cmsReadiness.devices.find((d: { brand: string }) => d.brand === 'SynthP91Brand')?.count, 2);

    const kit = browserSide(
      [
        ['Site', 'Item', 'Kategori', 'Kuantiti', 'Pemilik'],
        ['SASA-001', 'Synthetic P91 chair', 'Chairs and tables', '4', 'Ours'],
      ],
      'siteKitItem',
    );
    await refused(['u-transport', 'u-pwvsb-hr', 'u-om-johor'], 'siteKitItem', kit);
    const k = await db.asUser('u-om-klang', (svc, u) => svc.orgImport.preview(u, 'siteKitItem', null, kit.csv, { mapping: kit.mapping }));
    assert.equal(k.canImport, true, JSON.stringify(k.rows));
    await db.asUser('u-om-klang', (svc, u) => svc.orgImport.commit(u, 'siteKitItem', null, kit.csv, k.fingerprint, { mapping: kit.mapping }));
    const row = (await db.pool.query("SELECT data FROM prima.site_kits WHERE data->>'siteId'='st-sasa-001'")).rows[0].data;
    assert.deepEqual(
      row.items.filter((i: { name: string }) => i.name === 'Synthetic P91 chair').map((i: { category: string; required: number; owner: string }) => [i.category, i.required, i.owner]),
      [['furniture', 4, 'company']],
    );
  });
});
