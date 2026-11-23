// P128 contribution files (Fitri, 24 Nov 2026) on PostgreSQL: HR, the Chief of Staff, the COO and Finance keep a file
// made from an uploaded salary sheet with the employer's finance row (no new table); the server counts every share again;
// a guard, a company manager and another company's staff are refused and nothing is written; each download is audited.
// Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { GROUP_EMPLOYER_ID } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const thisMonth = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);

const person = (o: Record<string, unknown> = {}) => ({
  row: 2,
  name: 'ALI BIN ABU (SYNTHETIC)',
  id: '900101015555',
  nationality: 'MY',
  age: 36,
  ageFrom: 'ic',
  socsoWage: 3000,
  epfWage: 3000,
  skbbkOptOut: false,
  include: true,
  ...o,
});

describe('contribution files on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  const files = async () => {
    const r = await owner.query(`SELECT data FROM prima.fin_status WHERE id = $1`, [`fin-${GROUP_EMPLOYER_ID}`]);
    return ((r.rows[0]?.data as { contributionFiles?: { id: string; status: string; rows: { socsoEr: number }[] | null }[] })?.contributionFiles ?? []);
  };
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('refuses people without a staff payroll step and writes nothing', async () => {
    const body = { companyId: GROUP_EMPLOYER_ID, period: thisMonth(), fileName: 'gaji.xlsx', employerCode: 'E12345678901', mycoid: '', rows: [person()] };
    for (const id of ['u-guard-sasa-1', 'u-cm-sasa']) {
      await assert.rejects(db.asUser(id, (svc, u) => svc.saveContributionFile(u, body)), /Not allowed|contribution files/i, id);
      await assert.rejects(db.asUser(id, (svc, u) => svc.contributionFiles(u)), /Not allowed|contribution files/i, id);
    }
    assert.deepEqual(await files(), []);
    const audit = await owner.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' LIKE 'payroll.contrib_file.%'`);
    assert.equal(audit.rows[0].n, 0);
  });

  it('keeps HR’s file with the shares counted again by the server, and audits each download', async () => {
    const body = {
      companyId: GROUP_EMPLOYER_ID,
      period: thisMonth(),
      fileName: 'gaji.xlsx',
      employerCode: 'E12345678901',
      mycoid: '',
      // A share sent from the device is ignored: the server works it out.
      rows: [{ ...person(), socsoEr: 1 }, person({ name: 'SITI (SYNTHETIC)', id: '650301085556', age: 61 })],
    };
    const rec = await db.asUser('u-pwvsb-hr', (svc, u) => svc.saveContributionFile(u, body));
    assert.equal(rec.rows?.[0].socsoEr, 51.65);
    assert.equal(rec.rows?.[1].category, 2);
    const kept = await files();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].rows?.[0].socsoEr, 51.65);
    // Finance sees it (without the people) and downloads it again; the Chief of Staff and the COO may too.
    const board = await db.asUser('u-fin-t1-lead', (svc, u) => svc.contributionFiles(u));
    assert.equal(board.records[0].id, rec.id);
    assert.equal('rows' in board.records[0], false);
    for (const id of ['u-cos', 'u-coo']) assert.equal((await db.asUser(id, (svc, u) => svc.contributionFile(u, GROUP_EMPLOYER_ID, rec.id))).rows?.length, 2, id);
    await db.asUser('u-fin-t1-lead', (svc, u) => svc.contributionFileDownloaded(u, GROUP_EMPLOYER_ID, rec.id, 'perkeso_txt'));
    assert.equal((await files())[0].status, 'downloaded');
    const audit = await owner.query(`SELECT data->>'action' AS action, data->>'summary' AS summary FROM prima.audit WHERE data->>'action' LIKE 'payroll.contrib_file.%'`);
    assert.deepEqual(audit.rows.map((r) => r.action).sort(), ['payroll.contrib_file.checked', 'payroll.contrib_file.download']);
    assert.ok(!audit.rows.some((r) => /ALI|SITI|900101|3000/.test(r.summary)), 'no person or pay in the audit summary');
    // A guard cannot read it back.
    await assert.rejects(db.asUser('u-guard-sasa-1', (svc, u) => svc.contributionFile(u, GROUP_EMPLOYER_ID, rec.id)));
  });
});
