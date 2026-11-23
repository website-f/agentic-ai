// Upload works like Import (Fitri, 24 Nov 2026): the screen's records are scored against the file's columns, the best
// is proposed, the matcher maps the columns. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  COMPANY_FIELD,
  IMPORTABLE_KINDS,
  RECORD_KINDS,
  SCREEN_TOOLS,
  UPLOAD_RULE,
  importFields,
  importSpec,
  isTableFile,
  pastedRows,
  rankImportKinds,
  screenImportKinds,
  smartMatch,
  prepareSheet,
  type ImportKind,
} from '../src';

const sheet = (rows: string[][], name = 'Sheet1') => ({ name, rows });

describe('screen upload: which records a screen loads', () => {
  it('offers only importable records, the screen’s own import kinds included, each once', () => {
    for (const screen of Object.keys(SCREEN_TOOLS)) {
      const kinds = screenImportKinds(screen);
      expect(new Set(kinds).size, screen).toBe(kinds.length);
      for (const k of kinds) expect(IMPORTABLE_KINDS, `${screen}: ${k}`).toContain(k);
    }
    expect(screenImportKinds('sites')).toEqual(['site', 'post', 'checkpoint']);
    expect(screenImportKinds('fleet')).toEqual(['vehicle', 'fuelCard']);
    expect(screenImportKinds('people')).toEqual(['officeStaff', 'guardPaper']);
    expect(screenImportKinds('hr')).toContain('leaveEntitlement');
  });

  it('never offers the arms register kinds or company master data, which keep their reviewed paths', () => {
    const arms = screenImportKinds('arms');
    for (const k of ['vault', 'firearm', 'dealerLicence', 'armsAgreement'] as ImportKind[]) expect(arms).not.toContain(k);
    expect(arms).toEqual(['armsSupplier', 'supplierItem']);
    expect(screenImportKinds('company')).toEqual(['licence']);
  });

  it('gives read-only screens and the site device nothing to load', () => {
    for (const s of ['home', 'audit', 'reports', 'attendance', 'sop', 'device', 'no-such-screen']) expect(screenImportKinds(s), s).toEqual([]);
  });

  it('every own import kind on a screen is importable', () => {
    for (const [screen, t] of Object.entries(SCREEN_TOOLS)) for (const k of t.imports ?? []) expect(IMPORTABLE_KINDS, `${screen}: ${k}`).toContain(k);
  });
});

describe('screen upload: the record a file holds', () => {
  it('reads the fields from the same spec the server checks with, select choices as labels', () => {
    const f = importFields('vehicle');
    expect(f.map((x) => x.key)).toEqual([...importSpec('vehicle').fields.map((x) => x.key), COMPANY_FIELD]);
    const kind = f.find((x) => x.type === 'select');
    if (kind) for (const [v, l] of kind.options ?? []) expect(v).toBe(l);
    expect(importFields('itemType').some((x) => x.key === COMPANY_FIELD)).toBe(false);
    expect(f.filter((x) => x.required).length).toBe(RECORD_KINDS.vehicle.fields.filter((x) => x.required).length);
  });

  it('proposes vehicles for a Malay vehicle list with a title block, fuel cards for a fuel card list', () => {
    const vehicles = [
      ['SENARAI KENDERAAN SYARIKAT'],
      [],
      ['Bil', 'No. Pendaftaran', 'Jenama', 'Model', 'Tahun', 'Tamat Cukai Jalan', 'Tamat Insurans'],
      ['1', 'WXY 1234', 'Proton', 'Saga', '2019', '12/03/2027', '01/02/2027'],
      ['2', 'VBN 5678', 'Perodua', 'Myvi', '2021', '05/06/2027', '05/06/2027'],
    ];
    const r = rankImportKinds([sheet(vehicles)], screenImportKinds('fleet'));
    expect(r[0].kind).toBe('vehicle');
    expect(r[0].level).toBe('good');
    expect(r[0].found).toEqual(expect.arrayContaining(['Plate number', 'Road tax expires']));
    expect(r[0].rows).toBe(2);
    expect(r[0].score).toBeGreaterThan(r[1].score + 0.2);

    const cards = [
      ['Card No', 'Plate', 'Provider', 'Monthly limit', 'Expiry'],
      ['7083 1234 5678 9012', 'WXY 1234', 'Shell', '500', '2027-01-31'],
      ['7083 1234 5678 9013', 'VBN 5678', 'Petronas', '400', '2027-03-31'],
    ];
    const c = rankImportKinds([sheet(cards)], screenImportKinds('fleet'));
    expect(c[0].kind).toBe('fuelCard');
    expect(c[0].score).toBeGreaterThan(c[1].score);
  });

  it('tells a post list from a site list on the Sites screen', () => {
    const posts = [
      ['Site', 'Post', 'Shift', 'Guards'],
      ['KL01', 'Main gate', 'Day', '2'],
      ['KL02', 'Lobby', 'Night', '1'],
    ];
    expect(rankImportKinds([sheet(posts)], screenImportKinds('sites'))[0].kind).toBe('post');
    const sites = [
      ['Site code', 'Site name', 'Address', 'Client', 'Guards needed'],
      ['KL01', 'Menara A', 'Jalan 1', 'ABC Bhd', '4'],
      ['KL02', 'Menara B', 'Jalan 2', 'DEF Bhd', '2'],
    ];
    expect(rankImportKinds([sheet(sites)], screenImportKinds('sites'))[0].kind).toBe('site');
  });

  it('finds staff in a Malay staff list on People, and the matcher maps its columns', () => {
    const staff = [
      ['Nama', 'No. KP', 'Jawatan', 'Tarikh Mula', 'Emel', 'Telefon'],
      ['Ali bin Abu', '900101-01-1234', 'Kerani', '01/03/2020', 'ali@example.com', '012-3456789'],
      ['Siti Aminah', '920202-02-2345', 'Penyelia', '15/07/2021', 'siti@example.com', '013-4567890'],
    ];
    const r = rankImportKinds([sheet(staff)], screenImportKinds('people'));
    expect(r[0].kind).toBe('officeStaff');
    expect(r[0].level).toBe('good');
    const fields = importFields('officeStaff');
    const p = prepareSheet(staff, fields, null);
    const m = smartMatch(p.table, fields, { headerRow: 0 });
    const byHeader = Object.fromEntries(m.columns.map((c) => [c.header, c.field]));
    expect(byHeader['Nama']).toBe('name');
    expect(byHeader['Emel']).toBe('email');
  });

  it('picks the sheet of a workbook that holds the record', () => {
    const notes = [['Notes'], ['This workbook holds the fleet.'], ['Updated monthly']];
    const vehicles = [
      ['Plate number', 'Make and model', 'Road tax expires'],
      ['WXY 1234', 'Proton Saga', '2027-03-12'],
      ['VBN 5678', 'Perodua Myvi', '2027-06-05'],
    ];
    const r = rankImportKinds([sheet(notes, 'Notes'), sheet(vehicles, 'Fleet')], ['vehicle']);
    expect(r[0].sheet).toBe(1);
  });

  it('says plainly when nothing fits: an unrelated table scores poor for every record', () => {
    const r = rankImportKinds([sheet([['Foo', 'Bar', 'Baz'], ['1', '2', '3'], ['4', '5', '6']])], screenImportKinds('fleet'));
    expect(r.every((f) => f.level === 'poor')).toBe(true);
    expect(r.every((f) => f.score < UPLOAD_RULE.maybe)).toBe(true);
    expect(rankImportKinds([sheet([['only a title']])], ['vehicle'])[0]).toMatchObject({ score: 0, level: 'poor', rows: 0 });
    expect(rankImportKinds([], ['vehicle'])[0].level).toBe('poor');
  });

  it('keeps the screen order on a tie and skips kinds that are not importable', () => {
    const r = rankImportKinds([sheet([['x'], ['y']])], ['vehicle', 'fuelCard', 'firearm' as ImportKind]);
    expect(r.map((f) => f.kind)).toEqual(['vehicle', 'fuelCard']);
  });
});

describe('screen upload: files and pasted rows', () => {
  it('reads tables from spreadsheets, CSV, text, Word and PDF; anything else is kept as a file', () => {
    for (const n of ['a.xlsx', 'b.XLS', 'c.csv', 'd.tsv', 'e.txt', 'f.docx', 'g.pdf', 'h.xlsm']) expect(isTableFile(n), n).toBe(true);
    for (const n of ['scan.jpg', 'photo.png', 'old.zip', 'memo.doc', 'deck.pptx', 'noext', '']) expect(isTableFile(n), n).toBe(false);
  });

  it('reads rows pasted from Excel, a CSV or a printed list', () => {
    expect(pastedRows('Name\tIC\r\nAli\t900101011234\r\n\r\n')).toEqual([
      ['Name', 'IC'],
      ['Ali', '900101011234'],
    ]);
    expect(pastedRows('Name,Plate\n"Abu, Ali",WXY 1\nSiti,VBN 2')).toEqual([
      ['Name', 'Plate'],
      ['Abu, Ali', 'WXY 1'],
      ['Siti', 'VBN 2'],
    ]);
    expect(pastedRows('Plate      Make\nWXY 1234   Proton Saga')).toEqual([
      ['Plate', 'Make'],
      ['WXY 1234', 'Proton Saga'],
    ]);
    expect(pastedRows('| a | b |\n| 1 | 2 |')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(pastedRows('   \n\n')).toEqual([]);
  });
});
