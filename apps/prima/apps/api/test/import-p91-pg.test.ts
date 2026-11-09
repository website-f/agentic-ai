// P91 (Fitri, 9 Nov 2026): the business screens' master records import through the real API service on PostgreSQL,
// with the company walls on. Negative authorization for each new kind: only the people who may add the record by hand
// may import it, a refused preview cannot be committed, and nothing is left behind. Synthetic seed data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRA_IMPORTS, normaliseTable, prepareSheet, smartMatch, toCsv, type AlignField, type ImportKind } from '@prima/core';
import { OrgController } from '../src/org.controller';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
process.env.PRIMA_ORG_LINKS = 'true';
const sql = (f: string) => readFileSync(resolve(process.cwd(), /[\\/]apps[\\/]api$/.test(process.cwd()) ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

/** What the browser does before sending: prepare, match, normalise. */
function browserSide(rows: string[][], kind: ImportKind) {
  const fields = EXTRA_IMPORTS[kind as keyof typeof EXTRA_IMPORTS].fields as AlignField[];
  const prep = prepareSheet(rows, fields);
  const m = smartMatch(prep.table, fields, { headerRow: prep.headerRow });
  return { csv: toCsv(normaliseTable(prep.table, 0, m.columns, fields)), mapping: m.columns.map((c) => c.field ?? '') };
}

describe('P91 business imports on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(sql('org-links-v1.sql'));
    await db.pool.query(sql('governance-registers-v1.sql'));
    await db.pool.query(sql('pdpa-register-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const count = async (q: string, p: unknown[] = []) => Number((await db.pool.query(q, p)).rows[0].n);

  /** The refused person: the preview shows no row as importable, the commit is refused, nothing is written. */
  async function refused(uid: string, kind: ImportKind, companyId: string | null, b: ReturnType<typeof browserSide>) {
    const p = await db.asUser(uid, (svc, u) => svc.orgImport.preview(u, kind, companyId, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, false, `${uid} ${kind}`);
    await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, kind, companyId, b.csv, p.fingerprint, { mapping: b.mapping })), `${uid} ${kind}`);
  }
  async function imported(uid: string, kind: ImportKind, companyId: string | null, b: ReturnType<typeof browserSide>) {
    const p = await db.asUser(uid, (svc, u) => svc.orgImport.preview(u, kind, companyId, b.csv, { mapping: b.mapping }));
    assert.equal(p.canImport, true, JSON.stringify(p.rows));
    const r = await db.asUser(uid, (svc, u) => svc.orgImport.commit(u, kind, companyId, b.csv, p.fingerprint, { mapping: b.mapping }));
    // The same file is refused a second time.
    await assert.rejects(db.asUser(uid, (svc, u) => svc.orgImport.commit(u, kind, companyId, b.csv, p.fingerprint, { mapping: b.mapping })), /already imported/);
    return r;
  }

  it('open tenders: the admin team imports; FWM and a Finance executive are refused', async () => {
    const b = browserSide(
      [
        ['No. Rujukan', 'Tajuk', 'Agensi', 'Sektor', 'Tarikh Tutup', 'Bil Pengawal'],
        ['SYN/P91/T1', 'Synthetic office guarding', 'Jabatan Sintetik', 'Kerajaan', '15/12/2027', '8'],
      ],
      'tender',
    );
    for (const uid of ['u-fwm-ex1', 'u-fin-t1-de1']) await refused(uid, 'tender', 'co-sasa', b);
    assert.equal(await count("SELECT count(*) n FROM prima.tenders WHERE data->>'ref'='SYN/P91/T1'"), 0);
    const r = await imported('u-ae-sasa', 'tender', 'co-sasa', b);
    assert.equal(r.rows, 1);
    assert.equal(await count("SELECT count(*) n FROM prima.tenders WHERE data->>'ref'='SYN/P91/T1' AND data->>'status'='open' AND data->>'channel'='GOVERNMENT'"), 1);
    assert.equal(await count("SELECT count(*) n FROM prima.org_imports WHERE data->>'kind'='tender'"), 1);
  });

  it('SSM filings: Corporate Admin imports; the company manager is refused', async () => {
    const b = browserSide([['Jenis', 'Tarikh Akhir', 'Perkara'], ['Other SSM lodgement', '30/11/2027', 'Synthetic P91 change of address']], 'corpFiling');
    await refused('u-cm-sasa', 'corpFiling', 'co-sasa', b);
    await imported('u-dcos', 'corpFiling', 'co-sasa', b);
    assert.equal(await count("SELECT count(*) n FROM prima.corp_filings WHERE data->>'title'='Synthetic P91 change of address' AND data->>'status'='open'"), 1);
  });

  it('legal matters: PWVSB legal imports; an admin executive is refused', async () => {
    const b = browserSide(
      [['Kes', 'Jenis Kes', 'Pihak Lawan', 'Pihak Kami', 'Peguam'], ['Synthetic P91 deposit claim', 'Contract dispute', 'Contoh Landlord Sdn Bhd', 'Defendan', 'Synthetic Chambers']],
      'legalMatter',
    );
    await refused('u-ae-sasa', 'legalMatter', 'co-sasa', b);
    await imported('u-legal', 'legalMatter', 'co-sasa', b);
    assert.equal(await count("SELECT count(*) n FROM prima.legal_matters WHERE data->>'title'='Synthetic P91 deposit claim' AND data->>'side'='respondent'"), 1);
  });

  it('continuity systems: IT imports; a company manager is refused', async () => {
    const b = browserSide(
      [['Sistem', 'Kesan', 'RTO', 'RPO', 'Salinan', 'Lokasi'], ['Synthetic P91 Roster Box', 'Rosters cannot be published', '8', '2', 'Own server', 'Synthetic HQ rack']],
      'bcmSystem',
    );
    await refused('u-cm-sasa', 'bcmSystem', null, b);
    await imported('u-it-lead', 'bcmSystem', null, b);
    assert.equal(await count("SELECT count(*) n FROM prima.bcm_systems WHERE data->>'name'='Synthetic P91 Roster Box'"), 1);
  });

  it('bank accounts: the Finance team leader imports, only the last 4 digits reach the database; a Finance executive is refused', async () => {
    const companyId: string = (await db.pool.query("SELECT data->>'companyId' AS c FROM prima.fin_status WHERE (data->>'team')::int = 1 ORDER BY id LIMIT 1")).rows[0].c;
    const b = browserSide([['Nama Bank', 'No Akaun', 'Kegunaan'], ['Synthetic P91 Bank', '9988-7766-5544', 'Kutipan']], 'finBankAccount');
    await refused('u-fin-t1-de1', 'finBankAccount', companyId, b);
    await imported('u-fin-t1-lead', 'finBankAccount', companyId, b);
    const row = (await db.pool.query("SELECT data FROM prima.fin_status WHERE data->>'companyId'=$1", [companyId])).rows[0].data;
    const acct = row.banks.find((x: { bank: string }) => x.bank === 'Synthetic P91 Bank');
    assert.deepEqual([acct.accountMasked, acct.purpose], ['****5544', 'collection']);
    assert.ok(!JSON.stringify(row).includes('998877665544'));
    const audit = await count("SELECT count(*) n FROM prima.audit WHERE data::text LIKE '%998877665544%' OR data::text LIKE '%9988-7766-5544%'");
    assert.equal(audit, 0);
  });

  it('obligations, risks, PDPA register entries and products: each only for its keeper', async () => {
    const ob = browserSide([['Bidang', 'Kewajipan', 'Akta', 'Kekerapan'], ['Tax', 'Synthetic P91 tax filing check', 'Income Tax Act 1967', '12']], 'grcObligation');
    await refused('u-fwm-ex1', 'grcObligation', 'co-sasa', ob);
    await imported('u-cm-sasa', 'grcObligation', 'co-sasa', ob);
    assert.equal(await count("SELECT count(*) n FROM prima.grc_obligations WHERE data->>'title'='Synthetic P91 tax filing check'"), 1);

    const rk = browserSide([['Risiko', 'Kategori', 'Pemilik', 'L', 'I', 'Kawalan'], ['Synthetic P91 supplier delay', 'Operations', 'Procurement', '2', '2', 'Two approved suppliers']], 'regRisk');
    await refused('u-cm-sasa', 'regRisk', 'co-sasa', rk);
    await imported('u-audit', 'regRisk', 'co-sasa', rk);
    assert.equal(await count("SELECT count(*) n FROM prima.reg_risks WHERE data->>'title'='Synthetic P91 supplier delay'"), 1);

    const reg = browserSide(
      [['Aktiviti', 'Sistem', 'Subjek Data', 'Jenis Data', 'Tujuan', 'Asas'], ['Synthetic P91 gate log', 'Synthetic gate app', 'Visitors', 'Name, plate', 'Site security', 'Consent']],
      'pdpaRegisterItem',
    );
    await refused('u-cm-sasa', 'pdpaRegisterItem', null, reg);
    await imported('u-pdpa', 'pdpaRegisterItem', null, reg);
    assert.equal(await count("SELECT count(*) n FROM prima.pdpa_register WHERE data->>'activity'='Synthetic P91 gate log' AND data->>'dpia'='needed'"), 1);

    const prod = browserSide([['Nama Produk', 'Jual / Sewa'], ['Synthetic P91 Body Cam', 'Jual']], 'pdpaProduct');
    await refused('u-cm-sasa', 'pdpaProduct', null, prod);
    await imported('u-pdpa', 'pdpaProduct', null, prod);
    assert.equal(await count("SELECT count(*) n FROM prima.products WHERE data->>'name'='Synthetic P91 Body Cam' AND data->>'mode'='SALE'"), 1);
  });
});

describe('P91 import routes', () => {
  it('the new kinds pass the route\'s kind check; a made-up kind is still refused', async () => {
    const c = new OrgController({ asUser: async (_id: string, fn: (s: unknown, u: unknown) => unknown) => fn({ orgImport: { template: (k: string) => ({ kind: k }) } }, { id: 'u' }) } as never);
    for (const k of ['tender', 'finBankAccount', 'corpFiling', 'corpAudit', 'legalMatter', 'bcmSystem', 'grcObligation', 'pdpaRegisterItem', 'pdpaProduct', 'regRisk'])
      assert.deepEqual(await c.template('u-signed-in', k), { kind: k });
    await assert.rejects(c.template('u-signed-in', 'govMandate'));
  });
});
