// P91: Operations, Security, Equipment and HR records load from old lists through each screen's own add, with its own
// permission. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { EXTRA_IMPORTS, IMPORTABLE_KINDS, MemoryStore, PrimaService, generateDataset, myt, normaliseTable, prepareSheet, smartMatch, toCsv, withOrgLinks, type AlignField } from '../src';
import { cardKind, fuelOf, idAgrees, paperType, P91_IMPORT_KINDS, type P91ImportKind } from '../src/org-import-ops';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = withOrgLinks(new MemoryStore(ds));
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user };
}

/** What the browser does before sending: prepare the sheet, match it, normalise the cells. */
function browserSide(rows: string[][], kind: P91ImportKind) {
  const fields = EXTRA_IMPORTS[kind].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  const table = normaliseTable(prep.table, 0, m.columns, fields);
  return { csv: toCsv(table), mapping: m.columns.map((c) => c.field ?? ''), match: m };
}

describe('P91 import kinds', { timeout: 60000 }, () => {
  it('are importable and read old-list words', () => {
    for (const k of P91_IMPORT_KINDS) expect(IMPORTABLE_KINDS).toContain(k);
    expect(paperType('Kad KDN')).toBe('KDN_GUARD_CARD');
    expect(paperType('Sijil CSG')).toBe('CSG_TRAINING');
    expect(paperType('eSIMS vetting')).toBe('KDN_VETTING');
    expect(paperType('TNG (penyelia)')).toBe('TNG_TRAINING');
    expect(paperType('lesen memandu')).toBe(null);
    expect(fuelOf('RON 95')).toBe('RON95');
    expect(fuelOf('Disel')).toBe('DIESEL');
    expect(cardKind('')).toBe('FUEL');
    expect(cardKind('Kad subsidi diesel')).toBe('SUBSIDY');
    expect(idAgrees('870825-**-***9', '870825-10-5559')).toBe(true);
    expect(idAgrees('870825-**-***9', '870825105551')).toBe(false);
  });

  it('HR loads training records from a messy sheet; the same course is not added twice', async () => {
    const { ds, svc, user } = fresh();
    const hr = user('u-pwvsb-hr');
    const sheet = [
      ['REKOD LATIHAN STAF (SISTEM LAMA)'],
      ['Bil', 'No Pekerja', 'Nama Kursus', 'Penganjur', 'Tarikh Mula', 'Tarikh Tamat', 'Jam', 'Kos (RM)', 'No Sijil'],
      ['1', 'SASA0002', 'Synthetic First Aid Basics', 'Synthetic Academy', '14/03/2025', '15/03/2025', '16', 'RM 1,200.00', 'CERT-91001'],
      ['2', 'SASA0002', 'Synthetic Fire Drill', 'Synthetic Academy', '02/04/2025', '', '4', '', ''],
      ['3', 'SASAO001', 'Synthetic Report Writing', 'Synthetic Institute', '10/05/2025', '10/05/2025', '7', '350', ''],
    ];
    const b = browserSide(sheet, 'staffTraining');
    expect(b.match.missing).toEqual([]);
    const p = await svc.orgImport.preview(hr, 'staffTraining', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => [r.row, r.ok, r.problems])).toEqual([
      [2, true, []],
      [3, true, []],
      [4, true, []],
    ]);
    const before = ds.staffTraining.length;
    const r = await svc.orgImport.commit(hr, 'staffTraining', null, b.csv, p.fingerprint, { mapping: b.mapping });
    expect(r.rows).toBe(3);
    expect(r.recordIds).toHaveLength(3);
    expect(ds.staffTraining.length).toBe(before + 3);
    const fa = ds.staffTraining.find((t) => t.course === 'Synthetic First Aid Basics')!;
    expect(fa).toMatchObject({ personId: 'pr-sasa-0002', from: '2025-03-14', to: '2025-03-15', hours: 16, cost: 1200, certificateRef: 'CERT-91001' });
    expect(ds.staffTraining.find((t) => t.course === 'Synthetic Fire Drill')!.to).toBe('2025-04-02');
    expect(ds.audit.filter((a) => a.action === 'hr.training').length).toBeGreaterThanOrEqual(3);
    expect(ds.audit.at(-1)!.action).toBe('org.import');
    // A second file with one of the same courses: that row is refused, nothing doubles.
    const again = browserSide([sheet[1], sheet[2]], 'staffTraining');
    const p2 = await svc.orgImport.preview(hr, 'staffTraining', null, again.csv, { mapping: again.mapping });
    expect(p2.rows[0].problems.join(' ')).toMatch(/already has/);
    expect(p2.canImport).toBe(false);
  });

  it('a wrong IC or an unknown staff number refuses the row', async () => {
    const { svc, user } = fresh();
    const b = browserSide(
      [
        ['Staff No', 'IC', 'Course', 'Date', 'Hours'],
        ['SASA0002', '870825-10-5551', 'Synthetic Course A', '01/02/2025', '8'],
        ['NOSUCH999', '', 'Synthetic Course B', '01/02/2025', '8'],
        ['SASA0002', '870825-10-5559', 'Synthetic Course C', '01/02/2025', '8'],
      ],
      'staffTraining',
    );
    const p = await svc.orgImport.preview(user('u-pwvsb-hr'), 'staffTraining', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.ok)).toEqual([false, false, true]);
    expect(p.rows[0].problems.join(' ')).toMatch(/IC or passport number does not match/);
    expect(p.rows[1].problems.join(' ')).toMatch(/No staff member or guard/);
    // The IC is never echoed back in full.
    expect(JSON.stringify(p)).not.toContain('870825-10-5559');
  });

  it('only those who record training may import it (Transport and a company manager for office staff are refused)', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Staff No', 'Course', 'From', 'Hours'],
        ['SASAO001', 'Synthetic Office Course', '01/02/2025', '8'],
      ],
      'staffTraining',
    );
    for (const id of ['u-transport', 'u-cm-sasa']) {
      const p = await svc.orgImport.preview(user(id), 'staffTraining', null, b.csv, { mapping: b.mapping });
      expect(p.canImport, id).toBe(false);
      await expect(svc.orgImport.commit(user(id), 'staffTraining', null, b.csv, p.fingerprint, { mapping: b.mapping }), id).rejects.toThrow();
    }
    expect(ds.staffTraining.some((t) => t.course === 'Synthetic Office Course')).toBe(false);
  });

  it('guard papers: the company head records its own guards; another company and an office staff member are refused', async () => {
    const { ds, svc, user } = fresh();
    const cm = user('u-cm-sasa');
    const other = ds.people.find((p) => p.companyId !== 'co-sasa' && p.role === 'guard' && p.status === 'active')!;
    const sheet = [
      ['Senarai Kad KDN dan CSG'],
      ['No Pengawal', 'Jenis', 'No Kad', 'Tarikh Dikeluarkan', 'Tarikh Tamat'],
      ['SASA0002', 'Kad KDN', 'KDN-91-0002', '01/06/2025', '31/05/2027'],
      ['SASA0002', 'Sijil CSG', 'CSG-91-0002', '15/01/2025', ''],
      [other.staffNo, 'Kad KDN', 'KDN-91-9999', '01/06/2025', '31/05/2027'],
      ['SASAO001', 'Kad KDN', 'KDN-91-0001', '01/06/2025', '31/05/2027'],
    ];
    const b = browserSide(sheet, 'guardPaper');
    expect(b.match.missing).toEqual([]);
    const p = await svc.orgImport.preview(cm, 'guardPaper', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.ok)).toEqual([true, true, false, false]);
    expect(p.rows[3].problems.join(' ')).toMatch(/No guard or officer/);
    await expect(svc.orgImport.commit(cm, 'guardPaper', null, b.csv, p.fingerprint, { mapping: b.mapping })).rejects.toThrow(/Nothing was imported/);
    const ok = await svc.orgImport.preview(cm, 'guardPaper', null, b.csv, { mapping: b.mapping, skip: [4, 5] });
    expect(ok.canImport).toBe(true);
    await svc.orgImport.commit(cm, 'guardPaper', null, b.csv, ok.fingerprint, { mapping: b.mapping, skip: [4, 5] });
    const papers = ds.credentials.filter((c) => c.personId === 'pr-sasa-0002' && (c.number === 'KDN-91-0002' || c.number === 'CSG-91-0002'));
    expect(papers.map((c) => [c.type, c.issuedOn, c.expiresOn]).sort()).toEqual([
      ['CSG_TRAINING', '2025-01-15', null],
      ['KDN_GUARD_CARD', '2025-06-01', '2027-05-31'],
    ]);
    // Transport may not record guard papers.
    const t = await svc.orgImport.preview(user('u-transport'), 'guardPaper', null, b.csv, { mapping: b.mapping, skip: [4, 5] });
    expect(t.canImport).toBe(false);
    await expect(svc.orgImport.commit(user('u-transport'), 'guardPaper', null, b.csv, t.fingerprint, { mapping: b.mapping, skip: [4, 5] })).rejects.toThrow();
  });

  it('fuel cards: Transport only, last 4 digits only, by plate', async () => {
    const { ds, svc, user } = fresh();
    const veh = ds.vehicles.find((v) => v.plate === 'WXY 1234')!;
    const b = browserSide(
      [
        ['No Plat', 'Syarikat Kad', 'No Kad', 'Minyak', 'Had Bulanan', 'Pemegang', 'Sejak'],
        ['wxy1234', 'Synthetic Fleet Card', '7012 3456 7890 4321', 'Disel', 'RM 800', 'Synthetic Driver', '01/03/2025'],
      ],
      'fuelCard',
    );
    expect(b.match.missing).toEqual([]);
    for (const id of ['u-cm-sasa', 'u-pwvsb-hr']) {
      const no = await svc.orgImport.preview(user(id), 'fuelCard', null, b.csv, { mapping: b.mapping });
      expect(no.canImport, id).toBe(false);
      await expect(svc.orgImport.commit(user(id), 'fuelCard', null, b.csv, no.fingerprint, { mapping: b.mapping }), id).rejects.toThrow();
    }
    const tr = user('u-transport');
    const p = await svc.orgImport.preview(tr, 'fuelCard', null, b.csv, { mapping: b.mapping });
    expect(p.rows[0].problems).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('7890 4321');
    await svc.orgImport.commit(tr, 'fuelCard', null, b.csv, p.fingerprint, { mapping: b.mapping });
    const card = ds.vehicles.find((v) => v.id === veh.id)!.cards!.find((c) => c.issuer === 'Synthetic Fleet Card')!;
    expect(card).toMatchObject({ kind: 'FUEL', last4: '4321', fuel: 'DIESEL', monthlyLimitRm: 800, holder: 'Synthetic Driver', since: '2025-03-01' });
    expect(JSON.stringify(ds.vehicles)).not.toContain('70123456');
  });

  it('CMS readiness devices: the company records its sites; Transport is refused', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Kod Tapak', 'Peranti', 'Jenama', 'Model', 'Kuantiti', 'Pemilik'],
        ['SASA-001', 'CCTV recorder', 'SynthBrand', 'NVR-16', '2', 'Client'],
        ['Menara Cheras 2', 'Alarm panel', 'SynthAlarm', '', '', ''],
        ['NOPE-999', 'Alarm panel', 'SynthAlarm', '', '', ''],
      ],
      'cmsDevice',
    );
    expect(b.match.missing).toEqual([]);
    const cm = user('u-cm-sasa');
    const p = await svc.orgImport.preview(cm, 'cmsDevice', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.ok)).toEqual([true, true, false]);
    const ok = await svc.orgImport.preview(cm, 'cmsDevice', null, b.csv, { mapping: b.mapping, skip: [4] });
    await svc.orgImport.commit(cm, 'cmsDevice', null, b.csv, ok.fingerprint, { mapping: b.mapping, skip: [4] });
    const s1 = ds.sites.find((s) => s.code === 'SASA-001')!;
    expect(s1.cmsReadiness!.devices.find((d) => d.brand === 'SynthBrand')).toMatchObject({ kind: 'CCTV_RECORDER', count: 2, owner: 'client', model: 'NVR-16', linkConfirmed: 'unknown' });
    expect(ds.sites.find((s) => s.code === 'SASA-002')!.cmsReadiness!.devices.some((d) => d.brand === 'SynthAlarm' && d.count === 1)).toBe(true);
    const t = await svc.orgImport.preview(user('u-transport'), 'cmsDevice', null, b.csv, { mapping: b.mapping, skip: [4] });
    expect(t.canImport).toBe(false);
  });

  it('site fittings: the OM adds lines to the plan of a site they manage; others are refused; a line is not added twice', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Site', 'Item', 'Kategori', 'Kuantiti', 'Pemilik'],
        ['SASA-001', 'Synthetic plastic chair', 'Chairs and tables', '4', 'Ours'],
        ['SASA-001', 'Synthetic standing fan', 'Fans and lights', '2', 'Rented'],
      ],
      'siteKitItem',
    );
    expect(b.match.missing).toEqual([]);
    for (const id of ['u-transport', 'u-pwvsb-hr']) {
      const no = await svc.orgImport.preview(user(id), 'siteKitItem', null, b.csv, { mapping: b.mapping });
      expect(no.canImport, id).toBe(false);
      await expect(svc.orgImport.commit(user(id), 'siteKitItem', null, b.csv, no.fingerprint, { mapping: b.mapping }), id).rejects.toThrow();
    }
    const om = user('u-om-klang');
    const p = await svc.orgImport.preview(om, 'siteKitItem', null, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => [r.ok, r.problems])).toEqual([
      [true, []],
      [true, []],
    ]);
    await svc.orgImport.commit(om, 'siteKitItem', null, b.csv, p.fingerprint, { mapping: b.mapping });
    const kit = ds.siteKits.find((k) => k.siteId === 'st-sasa-001')!;
    expect(kit.items.filter((i) => i.name.startsWith('Synthetic')).map((i) => [i.name, i.category, i.required, i.owner, i.atEnd])).toEqual([
      ['Synthetic plastic chair', 'furniture', 4, 'company', 'take_back'],
      ['Synthetic standing fan', 'fan_light', 2, 'rented', 'take_back'],
    ]);
    const again = browserSide(
      [
        ['Site', 'Item', 'Qty'],
        ['SASA-001', 'Synthetic plastic chair', '6'],
      ],
      'siteKitItem',
    );
    const p2 = await svc.orgImport.preview(om, 'siteKitItem', null, again.csv, { mapping: again.mapping });
    expect(p2.rows[0].problems.join(' ')).toMatch(/already on this site/);
  });
});
