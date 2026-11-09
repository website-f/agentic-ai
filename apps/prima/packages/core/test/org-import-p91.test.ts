// P91: the business screens' master records import through each screen's own add, with its own permission. Synthetic
// data only: made-up companies' tenders, banks, filings, lawyers, systems and risks.
import { describe, expect, it } from 'vitest';
import {
  EXTRA_IMPORTS,
  IMPORTABLE_KINDS,
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
  normaliseTable,
  prepareSheet,
  smartMatch,
  toCsv,
  withOrgLinks,
  type AlignField,
  type ImportKind,
} from '../src';

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
function browserSide(rows: string[][], kind: ImportKind) {
  const fields = EXTRA_IMPORTS[kind as keyof typeof EXTRA_IMPORTS].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  const table = normaliseTable(prep.table, 0, m.columns, fields);
  return { csv: toCsv(table), mapping: m.columns.map((c) => c.field ?? ''), match: m };
}

const fieldOf = (b: ReturnType<typeof browserSide>, header: string) => b.match.columns.find((c) => c.header === header)?.field ?? null;

describe('P91 business imports', { timeout: 120000 }, () => {
  it('every new kind is importable and has its fields', () => {
    for (const k of ['tender', 'finBankAccount', 'corpFiling', 'corpAudit', 'legalMatter', 'bcmSystem', 'grcObligation', 'pdpaRegisterItem', 'pdpaProduct', 'regRisk'] as ImportKind[]) {
      expect(IMPORTABLE_KINDS).toContain(k);
      expect(EXTRA_IMPORTS[k as keyof typeof EXTRA_IMPORTS].fields.length).toBeGreaterThan(2);
    }
  });

  it('tenders: the admin team imports open tenders from a Malay sheet; someone else may not; a closed tender is refused', async () => {
    const { ds, svc, user } = fresh();
    const sheet = [
      ['SENARAI TENDER (SISTEM LAMA)'],
      ['Bil', 'No. Rujukan', 'Tajuk', 'Agensi', 'Sektor', 'Tarikh Tutup', 'Bil Pengawal', 'Nilai Bulanan'],
      ['1', 'SYN/T/2026/01', 'Kawalan keselamatan pejabat sintetik', 'Jabatan Sintetik', 'Kerajaan', '15/12/2026', '12', 'RM 45,000.00'],
      ['2', 'SYN/T/2026/02', 'Kawalan gudang sintetik', 'Syarikat Contoh Bhd', 'Swasta', '20/12/2026', '4', ''],
    ];
    const b = browserSide(sheet, 'tender');
    expect(fieldOf(b, 'No. Rujukan')).toBe('ref');
    expect(fieldOf(b, 'Tarikh Tutup')).toBe('closesOn');
    expect(fieldOf(b, 'Bil Pengawal')).toBe('guards');
    const denied = await svc.orgImport.preview(user('u-fwm-ex1'), 'tender', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const ae = user('u-ae-sasa');
    const p = await svc.orgImport.preview(ae, 'tender', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.problems)).toEqual([[], []]);
    await svc.orgImport.commit(ae, 'tender', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    const t = ds.tenders.filter((x) => x.ref.startsWith('SYN/T/2026/'));
    expect(t.map((x) => [x.channel, x.status, x.guards])).toEqual([
      ['GOVERNMENT', 'open', 12],
      ['PRIVATE', 'open', 4],
    ]);
    const closed = browserSide([['Ref', 'Title', 'Buyer', 'Channel', 'Closing date', 'Guards'], ['SYN/T/OLD', 'Old synthetic tender', 'Agensi Lama', 'Government', '01/01/2025', '3']], 'tender');
    const c = await svc.orgImport.preview(ae, 'tender', 'co-sasa', closed.csv, { mapping: closed.mapping });
    expect(c.canImport).toBe(false);
    expect(c.rows[0].problems.join(' ')).toMatch(/closing date/i);
  });

  it('bank accounts: the Finance team leader imports, only the last 4 digits are kept and never the full number; a Finance executive may not', async () => {
    const { ds, svc, user } = fresh();
    const lead = user('u-fin-t1-lead');
    const books = ds.finStatus.find((f) => f.team === 1)!;
    const b = browserSide(
      [
        ['Nama Bank', 'No Akaun', 'Kegunaan'],
        ['Synthetic Bank Berhad', '5123-4567-8901', 'Gaji'],
        ['Contoh Islamic Bank', '7000 1111 2222', 'Operasi'],
      ],
      'finBankAccount',
    );
    const denied = await svc.orgImport.preview(user('u-fin-t1-de1'), 'finBankAccount', books.companyId, b.csv, { mapping: b.mapping });
    expect(denied.canImport).toBe(false);
    const p = await svc.orgImport.preview(lead, 'finBankAccount', books.companyId, b.csv, { mapping: b.mapping });
    expect(p.rows.map((r) => r.problems)).toEqual([[], []]);
    expect(JSON.stringify(p)).not.toContain('512345678901');
    expect(JSON.stringify(p)).not.toContain('5123-4567-8901');
    await svc.orgImport.commit(lead, 'finBankAccount', books.companyId, b.csv, p.fingerprint, { mapping: b.mapping });
    const banks = ds.finStatus.find((f) => f.id === books.id)!.banks;
    expect(banks.filter((x) => x.bank === 'Synthetic Bank Berhad' || x.bank === 'Contoh Islamic Bank').map((x) => [x.accountMasked, x.purpose])).toEqual([
      ['****8901', 'payroll'],
      ['****2222', 'operating'],
    ]);
  });

  it('filings and legal matters: Corporate Admin imports filings, legal imports matters; the company manager may not file', async () => {
    const { ds, svc, user } = fresh();
    const f = browserSide(
      [
        ['Jenis', 'Tarikh Akhir', 'Perkara'],
        ['Annual return', '15/12/2026', ''],
        ['Penyata kewangan', '31/01/2027', 'Financial statements FY2025'],
      ],
      'corpFiling',
    );
    const denied = await svc.orgImport.preview(user('u-cm-sasa'), 'corpFiling', 'co-sasa', f.csv, { mapping: f.mapping });
    expect(denied.canImport).toBe(false);
    const dcos = user('u-dcos');
    const p = await svc.orgImport.preview(dcos, 'corpFiling', 'co-sasa', f.csv, { mapping: f.mapping });
    expect(p.rows.map((r) => r.problems)).toEqual([[], []]);
    await svc.orgImport.commit(dcos, 'corpFiling', 'co-sasa', f.csv, p.fingerprint, { mapping: f.mapping });
    const filings = ds.corpFilings.filter((x) => x.companyId === 'co-sasa' && ((x.dueOn === '2026-12-15' && x.title === 'Annual return') || x.title === 'Financial statements FY2025'));
    expect(filings.map((x) => [x.kind, x.status, x.basis.slice(0, 23)])).toEqual([
      ['ANNUAL_RETURN', 'open', 'Companies Act 2016 s.68'],
      ['FINANCIAL_STATEMENTS', 'open', 'Companies Act 2016 s.25'],
    ]);

    const m = browserSide(
      [
        ['Kes', 'Jenis Kes', 'Pihak Lawan', 'Pihak Kami', 'Jumlah Tuntutan', 'Peguam', 'Tarikh Sebutan'],
        ['Synthetic unpaid invoice claim', 'Letter of demand', 'Contoh Trading Sdn Bhd', 'Plaintif', 'RM 12,500', 'Synthetic & Co', '05/01/2027'],
      ],
      'legalMatter',
    );
    const noLegal = await svc.orgImport.preview(user('u-ae-sasa'), 'legalMatter', 'co-sasa', m.csv, { mapping: m.mapping });
    expect(noLegal.canImport).toBe(false);
    const legal = user('u-legal');
    const q = await svc.orgImport.preview(legal, 'legalMatter', 'co-sasa', m.csv, { mapping: m.mapping });
    expect(q.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(legal, 'legalMatter', 'co-sasa', m.csv, q.fingerprint, { mapping: m.mapping });
    const lm = ds.legalMatters.find((x) => x.title === 'Synthetic unpaid invoice claim')!;
    expect([lm.kind, lm.side, lm.exposure, lm.nextDate?.on, lm.status]).toEqual(['DEMAND', 'claimant', 12500, '2027-01-05', 'open']);
  });

  it('continuity systems, obligations and risks each go through their own add and its permission', async () => {
    const { ds, svc, user } = fresh();
    const sys = browserSide(
      [
        ['Sistem', 'Kesan', 'RTO (jam)', 'RPO (jam)', 'Salinan', 'Lokasi', 'Dalam Malaysia'],
        ['Synthetic Payroll Box', 'Pay cannot be prepared', '24', '4', 'Cloud', 'Synthetic cloud, Cyberjaya', 'Ya'],
      ],
      'bcmSystem',
    );
    expect((await svc.orgImport.preview(user('u-cm-sasa'), 'bcmSystem', null, sys.csv, { mapping: sys.mapping })).canImport).toBe(false);
    const it = user('u-it-lead');
    const s = await svc.orgImport.preview(it, 'bcmSystem', null, sys.csv, { mapping: sys.mapping });
    expect(s.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(it, 'bcmSystem', null, sys.csv, s.fingerprint, { mapping: sys.mapping });
    expect(ds.bcmSystems.find((x) => x.name === 'Synthetic Payroll Box')!.copies).toEqual([
      { site: 'CLOUD', where: 'Synthetic cloud, Cyberjaya', inMalaysia: true, lastBackupAt: null, lastRestoreTest: null },
    ]);

    const ob = browserSide(
      [
        ['Bidang', 'Kewajipan', 'Akta', 'Kekerapan (bulan)'],
        ['Safety and health', 'Synthetic fire drill at the office', 'Fire Services Act 1988', '12'],
      ],
      'grcObligation',
    );
    expect((await svc.orgImport.preview(user('u-fwm-ex1'), 'grcObligation', 'co-sasa', ob.csv, { mapping: ob.mapping })).canImport).toBe(false);
    const cm = user('u-cm-sasa');
    const o = await svc.orgImport.preview(cm, 'grcObligation', 'co-sasa', ob.csv, { mapping: ob.mapping });
    expect(o.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(cm, 'grcObligation', 'co-sasa', ob.csv, o.fingerprint, { mapping: ob.mapping });
    const g = ds.grcObligations.find((x) => x.title === 'Synthetic fire drill at the office')!;
    expect([g.stream, g.everyMonths, g.evidence, g.checked]).toEqual(['OSH', 12, null, null]);

    const rk = browserSide(
      [
        ['Risiko', 'Kategori', 'Pemilik Risiko', 'L', 'I', 'Kawalan Sedia Ada', 'Tindakan', 'Tarikh Siap'],
        ['Synthetic key client leaves', 'Finance', 'Company Manager', '2', '3', 'Monthly client review', '', ''],
        ['Synthetic licence lapses', 'Lesen', 'Admin Executive', '5', '5', 'Renewal reminders', '', ''],
      ],
      'regRisk',
    );
    expect((await svc.orgImport.preview(cm, 'regRisk', 'co-sasa', rk.csv, { mapping: rk.mapping })).canImport).toBe(false);
    const dir = user('u-audit');
    const r = await svc.orgImport.preview(dir, 'regRisk', 'co-sasa', rk.csv, { mapping: rk.mapping });
    // A high risk (5 x 5) needs an action and a due date, exactly as on the form.
    expect(r.rows[0].problems).toEqual([]);
    expect(r.rows[1].problems.join(' ')).toMatch(/action/);
    expect(r.canImport).toBe(false);
    const ok = await svc.orgImport.preview(dir, 'regRisk', 'co-sasa', rk.csv, { mapping: rk.mapping, skip: [r.rows[1].row] });
    await svc.orgImport.commit(dir, 'regRisk', 'co-sasa', rk.csv, ok.fingerprint, { mapping: rk.mapping, skip: [r.rows[1].row] });
    const risk = ds.regRisks.find((x) => x.title === 'Synthetic key client leaves')!;
    expect([risk.category, risk.likelihood, risk.impact]).toEqual(['financial', 2, 3]);
  });

  it('PDPA: the officer imports register entries and products; an empty impact assessment is "needed"; a product already listed is refused', async () => {
    const { ds, svc, user } = fresh();
    const reg = browserSide(
      [
        ['Aktiviti', 'Sistem', 'Subjek Data', 'Jenis Data', 'Tujuan', 'Asas', 'Tempoh Simpan'],
        ['Synthetic visitor log', 'Synthetic lobby tablet', 'Pelawat, Kakitangan', 'Name, phone, time in and out', 'Site security', 'Persetujuan', '90'],
      ],
      'pdpaRegisterItem',
    );
    expect((await svc.orgImport.preview(user('u-cm-sasa'), 'pdpaRegisterItem', null, reg.csv, { mapping: reg.mapping })).canImport).toBe(false);
    const officer = user('u-pdpa');
    const p = await svc.orgImport.preview(officer, 'pdpaRegisterItem', null, reg.csv, { mapping: reg.mapping });
    expect(p.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(officer, 'pdpaRegisterItem', null, reg.csv, p.fingerprint, { mapping: reg.mapping });
    const e = ds.pdpaRegister.find((x) => x.activity === 'Synthetic visitor log')!;
    expect([e.subjects, e.basis, e.retentionDays, e.dpia, e.companyId, e.reviewedOn]).toEqual([['visitor', 'staff'], 'CONSENT', 90, 'needed', null, null]);

    const prod = browserSide(
      [
        ['Nama Produk', 'Jual / Sewa', 'Pembekal', 'Data Peribadi'],
        ['Synthetic Dashcam X1', 'Sewa', 'Contoh Devices', 'Video, location'],
      ],
      'pdpaProduct',
    );
    expect((await svc.orgImport.preview(user('u-cm-sasa'), 'pdpaProduct', null, prod.csv, { mapping: prod.mapping })).canImport).toBe(false);
    const q = await svc.orgImport.preview(officer, 'pdpaProduct', null, prod.csv, { mapping: prod.mapping });
    expect(q.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(officer, 'pdpaProduct', null, prod.csv, q.fingerprint, { mapping: prod.mapping });
    const x = ds.products.find((y) => y.name === 'Synthetic Dashcam X1')!;
    expect([x.mode, x.personalData, x.certs]).toEqual(['RENTAL', ['Video', 'location'], []]);
    // The same product in another file is refused on its row.
    const again = browserSide([['Product', 'Mode'], ['synthetic dashcam x1', 'Rental']], 'pdpaProduct');
    const a = await svc.orgImport.preview(officer, 'pdpaProduct', null, again.csv, { mapping: again.mapping });
    expect(a.rows[0].problems.join(' ')).toMatch(/already on the list/);
  });

  it('old-system column names in Malay find their fields (as the import screen matches them)', () => {
    const b = browserSide(
      [
        ['Senarai sistem kritikal'],
        ['Nama Sistem', 'RPO (jam)', 'RTO (jam)', 'Kesan jika down', 'Lokasi Salinan', 'Di mana', 'Dalam Malaysia?'],
        ['Synthetic HR Portal', '4', '12', 'Leave and claims stop', 'Cloud', 'Synthetic cloud region', 'Ya'],
      ],
      'bcmSystem',
    );
    expect(['Nama Sistem', 'RPO (jam)', 'RTO (jam)', 'Kesan jika down', 'Lokasi Salinan', 'Di mana'].map((h) => fieldOf(b, h))).toEqual([
      'name',
      'rpoHours',
      'rtoHours',
      'impact',
      'copySite',
      'copyWhere',
    ]);
  });

  it('statutory audits: the company registers its audit with the documents asked for; FWM may not', async () => {
    const { ds, svc, user } = fresh();
    const b = browserSide(
      [
        ['Tahun Kewangan', 'Juruaudit', 'Yuran', 'Senarai Dokumen'],
        ['30/06/2023', 'Synthetic & Partners PLT', 'RM 18,000', 'Bank statements; Fixed asset list; Payroll summary'],
      ],
      'corpAudit',
    );
    expect((await svc.orgImport.preview(user('u-fwm-ex1'), 'corpAudit', 'co-sasa', b.csv, { mapping: b.mapping })).canImport).toBe(false);
    const cm = user('u-cm-sasa');
    const p = await svc.orgImport.preview(cm, 'corpAudit', 'co-sasa', b.csv, { mapping: b.mapping });
    expect(p.rows[0].problems).toEqual([]);
    await svc.orgImport.commit(cm, 'corpAudit', 'co-sasa', b.csv, p.fingerprint, { mapping: b.mapping });
    const a = ds.corpAudits.find((x) => x.companyId === 'co-sasa' && x.fyEnd === '2023-06-30')!;
    expect([a.auditorFirm, a.fee, a.pbc.map((x) => x.item), a.signed]).toEqual(['Synthetic & Partners PLT', 18000, ['Bank statements', 'Fixed asset list', 'Payroll summary'], null]);
  });
});
