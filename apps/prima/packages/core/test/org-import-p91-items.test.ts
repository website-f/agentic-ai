// P91 (Fitri, 9 Nov 2026: "where do I add the items? Add manually, or by Excel/PDF?"): item types, units with labels and
// bulk stock load from the old system's lists through the Items screen's own actions and permission checks. Messy
// synthetic sheets only (Malay and English headers, a title above, columns in any order).
import { describe, expect, it } from 'vitest';
import {
  EXTRA_IMPORTS,
  MemoryStore,
  cleanGrid,
  PrimaService,
  findItemType,
  generateDataset,
  itemCategoryOf,
  itemCodeOf,
  itemTrackingOf,
  itemUomOf,
  myt,
  normaliseTable,
  prepareSheet,
  smartMatch,
  toCsv,
  withOrgLinks,
  type AlignField,
  type PhysicalItem,
} from '../src';

const TODAY = '2026-11-09';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

/** What the browser does before sending: clean the grid, prepare the sheet, match it, normalise the cells. */
function browserSide(rows: string[][], kind: 'itemType' | 'itemUnit' | 'itemStock') {
  const fields = [...(EXTRA_IMPORTS[kind].fields as AlignField[]), { key: '__company', label: 'Company', type: 'text' as const }];
  const prep = prepareSheet(cleanGrid(rows), fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  const table = normaliseTable(prep.table, 0, m.columns, fields);
  return { csv: toCsv(table), mapping: m.columns.map((c) => c.field ?? ''), match: m };
}

const STORE = 'u-proc-store1'; // store staff of Goodwill and PWVSB central
const SASA_CM = 'u-cm-sasa'; // company manager of Sasa
const SASA_SV = 'u-sv-sasa'; // supervisor: hands over at his sites, never adds
const GUARD = 'u-guard-sasa-1';

describe('P91 item words', () => {
  it('reads the words old lists use', () => {
    expect(itemCategoryOf('Kasut')).toBe('footwear');
    expect(itemCategoryOf('Pakaian Seragam')).toBe('uniform');
    expect(itemCategoryOf('Walkie Talkie')).toBe('radio');
    expect(itemCategoryOf('IT devices')).toBe('it_device');
    expect(itemCategoryOf('???')).toBeNull();
    expect(itemTrackingOf('Kuantiti')).toBe('BULK');
    expect(itemTrackingOf('No. siri')).toBe('SERIALIZED');
    expect(itemTrackingOf('Each unit has its own label')).toBe('SERIALIZED');
    expect(itemUomOf('pasang')).toBe('PAIR');
    expect(itemUomOf('Botol')).toBe('BOTTLE');
    expect(itemUomOf('pcs')).toBe('PCS');
    expect(itemCodeOf('', 'Baju Kemeja Biru', 'XL')).toBe('BAJU-KEMEJA-BIRU-XL');
    expect(itemCodeOf('shirt navy l', 'x', '')).toBe('SHIRT-NAVY-L');
  });
  it('names an item type by code, name, or name and size; two of one name ask for the code', () => {
    const skus = [
      { id: 'a', code: 'SHIRT-L', name: 'Guard shirt', size: 'L' },
      { id: 'b', code: 'SHIRT-M', name: 'Guard shirt', size: 'M' },
    ] as never;
    expect(findItemType(skus, 'shirt-l').sku?.id).toBe('a');
    expect(findItemType(skus, 'Guard shirt M').sku?.id).toBe('b');
    expect(findItemType(skus, 'Guard shirt').problem).toMatch(/more than one/);
    expect(findItemType(skus, 'Radio').problem).toMatch(/not in the catalogue/);
  });
});

describe('P91 item types, units and stock from old lists', { timeout: 60000 }, () => {
  it('store staff import item types from a messy sheet; the code is made when missing; firearms refused; all or none', async () => {
    const { ds, svc, user } = fresh();
    const store = user(STORE);
    const sheet = [
      ['SENARAI BARANG STOR (SISTEM LAMA)'],
      ['Bil', 'Nama Barang', 'Kategori', 'Saiz', 'Unit', 'Jejak', 'Warna'],
      ['1', 'Baju Kemeja Pengawal', 'Pakaian seragam', 'XL', 'pcs', 'No. siri', 'Biru'],
      ['2', 'Kasut Kawad', 'Kasut', '9', 'pasang', 'Setiap unit', 'Hitam'],
      ['3', 'Sabun Lantai', 'Pembersihan', '5L', 'botol', 'Kuantiti', ''],
      ['Jumlah', '3'],
    ];
    const b = browserSide(sheet, 'itemType');
    expect(b.match.missing).toEqual([]);
    const p = await svc.orgImport.preview(store, 'itemType', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => [r.row, r.ok, r.problems])).toEqual([
      [2, true, []],
      [3, true, []],
      [4, true, []],
    ]);
    expect(ds.itemSkus.some((s) => s.code === 'BAJU-KEMEJA-PENGAWAL-XL')).toBe(false);
    const r = await svc.orgImport.commit(store, 'itemType', null, b.csv, p.fingerprint, { mapping: b.mapping });
    expect(r.rows).toBe(3);
    expect(r.recordIds).toHaveLength(3);
    const shirt = ds.itemSkus.find((s) => s.code === 'BAJU-KEMEJA-PENGAWAL-XL')!;
    expect(shirt).toMatchObject({ category: 'uniform', tracking: 'SERIALIZED', uom: 'PCS', size: 'XL', colour: 'Biru' });
    expect(ds.itemSkus.find((s) => s.code === 'KASUT-KAWAD-9')).toMatchObject({ category: 'footwear', uom: 'PAIR' });
    expect(ds.itemSkus.find((s) => s.code === 'SABUN-LANTAI-5L')).toMatchObject({ category: 'cleaning', tracking: 'BULK', uom: 'BOTTLE' });
    expect(ds.audit.filter((a) => a.action === 'item.sku.add').length).toBeGreaterThanOrEqual(3);
    expect(ds.audit.at(-1)!.action).toBe('org.import');
    // The same file again is refused.
    await expect(svc.orgImport.commit(store, 'itemType', null, b.csv, p.fingerprint, { mapping: b.mapping })).rejects.toThrow(/already imported/);
    // A firearm row is refused; the import is all or none.
    const arms = browserSide([['Item Name', 'Category', 'Tracked'], ['Pistol holster', 'Other', 'Each unit'], ['Raincoat', 'Safety', 'Each unit']], 'itemType');
    const q = await svc.orgImport.preview(store, 'itemType', null, arms.csv, { mapping: arms.mapping });
    expect(q.rows[0].ok).toBe(false);
    expect(q.rows[0].problems.join(' ')).toMatch(/Arms Control/);
    expect(q.canImport).toBe(false);
    const before = ds.itemSkus.length;
    await expect(svc.orgImport.commit(store, 'itemType', null, arms.csv, q.fingerprint, { mapping: arms.mapping })).rejects.toThrow();
    expect(ds.itemSkus.length).toBe(before);
  });

  it('a "Unit" column is the unit, not the item code; "Jejak" is how it is tracked', () => {
    const b = browserSide([['Nama Barang', 'Kategori', 'Jejak', 'Unit', 'Saiz'], ['Penyapu Lantai', 'Pembersihan', 'Kuantiti', 'batang', '']], 'itemType');
    expect(b.mapping).toEqual(['name', 'category', 'tracking', 'unit', 'size']);
  });

  it('people who may not add item types are refused before any row (supervisor, guard)', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide([['Item Name', 'Category', 'Tracked'], ['Raincoat', 'Safety', 'Each unit']], 'itemType');
    for (const id of [SASA_SV, GUARD]) {
      await expect(svc.orgImport.preview(user(id), 'itemType', null, b.csv, { mapping: b.mapping }), id).rejects.toThrow(/Only store staff/);
      await expect(svc.orgImport.commit(user(id), 'itemType', null, b.csv, 'a'.repeat(64), { mapping: b.mapping }), id).rejects.toThrow(/Only store staff/);
    }
    expect(ds.itemSkus.some((s) => s.name === 'Raincoat')).toBe(false);
  });

  it('units get new Prima IDs, wait for their labels, keep the old tag and old record, and never get a holder from the file', async () => {
    const { ds, svc, user } = fresh();
    const cm = user(SASA_CM);
    const sheet = [
      ['Inventori Aset Sasa (dari sistem lama)', '', '', '', ''],
      ['No. Aset', 'Jenis Barang', 'No. Siri', 'Lokasi', 'Keadaan', 'Pemegang'],
      ['OLD-T-0001', 'TORCH-LED', 'TL-SYN-001', 'Pos Menara A', 'Baik', 'Synthetic Guard One'],
      ['OLD-T-0002', 'LED torchlight', 'TL-SYN-002', 'Stor HQ', 'Rosak sedikit', ''],
      ['OLD-R-0007', 'radio-wt-uhf', '', 'Pos Menara A', 'Baik', 'Synthetic Guard Two'],
    ];
    const b = browserSide(sheet, 'itemUnit');
    expect(b.match.missing).toEqual([]);
    const before = ds.physicalItems.length;
    const p = await svc.orgImport.preview(cm, 'itemUnit', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => [r.row, r.ok, r.problems])).toEqual([
      [2, true, []],
      [3, true, []],
      [4, true, []],
    ]);
    expect(ds.physicalItems.length).toBe(before);
    const r = await svc.orgImport.commit(cm, 'itemUnit', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    expect(r.rows).toBe(3);
    expect(r.recordIds).toHaveLength(3);
    const units = r.recordIds.map((id) => ds.physicalItems.find((i) => i.id === id)!) as PhysicalItem[];
    const one = units.find((u) => u.legacyRef === 'OLD-T-0001')!;
    expect(one).toMatchObject({ skuId: 'sku-torch', serial: 'TL-SYN-001', ownerPartyId: 'co-sasa', state: 'quarantine', condition: 'unknown', labelGen: 0, labelVerifiedAt: null, legacyUnverified: true, pendingAck: null });
    expect(one.custody.kind).toBe('store');
    expect(one.legacyFrom).toEqual({ where: 'Pos Menara A', condition: 'Baik', holder: 'Synthetic Guard One' });
    expect(one.token).toMatch(/^P1-/);
    // On the labels to print and scan back, exactly like a manual registration.
    const board = await svc.items.board(cm);
    const todo = board.items.filter((i) => (i.labelGen ?? 1) === 0 || i.labelVerifiedAt === null).map((i) => i.id);
    for (const u of units) expect(todo).toContain(u.id);
    // The same old tag twice is refused (a second file with an overlapping row).
    const again = browserSide([['No. Aset', 'Jenis Barang'], ['OLD-T-0001', 'TORCH-LED']], 'itemUnit');
    const q = await svc.orgImport.preview(cm, 'itemUnit', 'co-sasa', again.csv, { mapping: again.mapping });
    expect(q.rows[0].problems.join(' ')).toMatch(/already registered/);
    // A BULK type is pointed to stock; an unknown type is named.
    const wrong = browserSide([['Jenis Barang', 'Kuantiti'], ['CLEAN-FLOOR-5L', '3'], ['Hovercraft', '1']], 'itemUnit');
    const w = await svc.orgImport.preview(cm, 'itemUnit', 'co-sasa', wrong.csv, { mapping: wrong.mapping });
    expect(w.rows[0].problems.join(' ')).toMatch(/import it as item stock/);
    expect(w.rows[1].problems.join(' ')).toMatch(/not in the catalogue/);
  });

  it('a Company column sends units to each owner the person handles; another company is refused', async () => {
    const { ds, svc, user } = fresh();
    const store = user(STORE);
    const sheet = [
      ['Syarikat', 'Item', 'Qty'],
      ['PWVSB (central)', 'Office chair', '2'],
      ['Sasa', 'Office chair', '1'],
    ];
    const b = browserSide(sheet, 'itemUnit');
    const p = await svc.orgImport.preview(store, 'itemUnit', null, b.csv, { mapping: b.mapping });
    expect(p.rows[0].ok).toBe(true);
    expect(p.rows[0].company?.id).toBe('pwvsb');
    expect(p.rows[1].ok).toBe(false);
    const ok = await svc.orgImport.preview(store, 'itemUnit', null, b.csv, { mapping: b.mapping, skip: [3] });
    expect(ok.canImport).toBe(true);
    const r = await svc.orgImport.commit(store, 'itemUnit', null, b.csv, ok.fingerprint, { mapping: b.mapping, skip: [3] });
    expect(r.recordIds).toHaveLength(2);
    expect(ds.physicalItems.filter((i) => r.recordIds.includes(i.id)).every((i) => i.ownerPartyId === 'pwvsb')).toBe(true);
  });

  it('bulk stock adds an opening balance to the store as Add stock does; a supervisor is refused', async () => {
    const { ds, svc, user } = fresh();
    const store = user(STORE);
    const lot = () => ds.itemLots.find((l) => l.skuId === 'sku-floor-5l' && l.ownerPartyId === 'goodwill' && l.custody.ref === 'store:goodwill');
    const had = lot()?.qty ?? 0;
    const b = browserSide([['Kod Barang', 'Baki Stok', 'Lokasi'], ['CLEAN-FLOOR-5L', '24', 'Gudang Shah Alam']], 'itemStock');
    const p = await svc.orgImport.preview(store, 'itemStock', 'goodwill', b.csv, { mapping: b.mapping });
    expect(p.canImport).toBe(true);
    await svc.orgImport.commit(store, 'itemStock', 'goodwill', b.csv, p.fingerprint, { mapping: b.mapping });
    expect(lot()!.qty).toBe(had + 24);
    const ev = ds.itemEvents.filter((e) => e.kind === 'lot_add').at(-1)!;
    expect(ev.note).toMatch(/Opening balance from the old system \(was at Gudang Shah Alam\)/);
    const units = browserSide([['Kod Barang', 'Baki Stok'], ['TORCH-LED', '5']], 'itemStock');
    const u = await svc.orgImport.preview(store, 'itemStock', 'goodwill', units.csv, { mapping: units.mapping });
    expect(u.rows[0].problems.join(' ')).toMatch(/import it as units/);
    await expect(svc.orgImport.preview(user(SASA_SV), 'itemStock', 'co-sasa', b.csv, { mapping: b.mapping })).rejects.toThrow(/Only store staff/);
    await expect(svc.orgImport.preview(user(SASA_CM), 'itemStock', 'goodwill', b.csv, { mapping: b.mapping })).rejects.toThrow(/Only store staff/);
  });

  it('a unit registered by hand keeps the scanned old code as its old tag', async () => {
    const { ds, svc, user } = fresh();
    const cm = user(SASA_CM);
    const out = (await svc.items.act(cm, 'req-p91-hand-1', { kind: 'item.register', skuId: 'sku-radio', partyId: 'co-sasa', count: 1, legacyRef: 'ASSET 00042', legacyUnverified: true })) as { result: PhysicalItem[] };
    expect(out.result[0].legacyRef).toBe('ASSET 00042');
    await expect(svc.items.act(cm, 'req-p91-hand-2', { kind: 'item.register', skuId: 'sku-radio', partyId: 'co-sasa', count: 2, legacyRef: 'ASSET 00043' })).rejects.toThrow(/names one unit/);
    await expect(svc.items.act(cm, 'req-p91-hand-3', { kind: 'item.register', skuId: 'sku-radio', partyId: 'co-sasa', count: 1, legacyRef: 'ASSET 00042' })).rejects.toThrow(/already registered/);
    expect(ds.physicalItems.filter((i) => i.legacyRef === 'ASSET 00042')).toHaveLength(1);
  });
});
