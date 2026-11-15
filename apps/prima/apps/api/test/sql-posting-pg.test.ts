// SQL Account posting link (Build 1, Fauzan 13 Nov 2026) against a real local PostgreSQL: before the proposed module
// is installed nothing is queued and the screen says so; once installed (here only, on the throwaway test database) a
// released payment writes its job in the same transaction, the company wall keeps other companies out and the key must
// name its own company. Synthetic data only; the test resets the throwaway database. No SQL Account is called.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const T1 = 'pwvsb';
const PAYEE = 'payee-pwvsb-001';
const NAME = 'SYARIKAT BEKALAN PEJABAT';

async function releaseOne(db: Db, amount: number, n: number) {
  const p = await db.asUser('u-fin-t1-de1', async (svc, u) => {
    const f = await svc.finance.desk(u);
    const bankId = f.companies.find((c) => c.companyId === T1)!.banks[0].id;
    return svc.finance.createPayment(u, T1, { payeeId: PAYEE, purpose: `Synthetic supplies PG ${n}`, amount, dueOn: '2026-12-20', bankId, sqlRef: `PI-PG-${n}`, evidence: ['i.pdf'], invoiceNo: `PG-${n}` });
  });
  await db.asUser('u-fin-t1-dep', (svc, u) => svc.finance.paymentStep(u, T1, p.id, 'review', { comment: 'ok' }));
  await db.asUser('u-fd', (svc, u) => svc.finance.paymentStep(u, T1, p.id, 'approve', { comment: 'Synthetic supplies approved.' }));
  await db.asUser('u-fin-t1-de2', (svc, u) => svc.finance.paymentStep(u, T1, p.id, 'release', { bankRef: `M2U-PG-${n}`, accountLast4: '1000', accountName: NAME }));
  return p.id;
}

describe('SQL Account posting link on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
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

  it('before the module is installed a release still works, nothing is queued and the screen says not installed', async () => {
    const id = await releaseOne(db, 111.11, 1);
    const view = await db.asUser('u-fd', (svc, u) => svc.financeSqlPosting.view(u));
    assert.equal(view.installed, false);
    assert.equal((await owner.query("SELECT to_regclass('prima.sql_postings') AS t")).rows[0].t, null);
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.financeSqlPosting.setSwitch(u, T1, { on: false, reason: 'Testing the switch here.' })), /not installed/);
    assert.ok(id);
  });

  it('installed: the release writes one job in the same transaction, behind the company wall', async () => {
    const moduleSql = readFileSync(resolve(__dirname, '../../../../db/modules/sql-posting-v1.sql'), 'utf8');
    await owner.query(moduleSql);
    await owner.query(moduleSql); // repeat-safe
    const id = await releaseOne(db, 222.22, 2);
    const rows = await owner.query("SELECT company_id, data FROM prima.sql_postings WHERE data->>'sourceId' = $1", [id]);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].company_id, T1);
    assert.equal(rows.rows[0].data.status, 'not_ready');
    assert.match(rows.rows[0].data.reasons.join(' '), /switched off for this company/);

    // The FD sees it; a team that does not keep PWVSB does not; a company manager's database role cannot read it.
    const fd = await db.asUser('u-fd', (svc, u) => svc.financeSqlPosting.view(u));
    assert.ok(fd.installed && fd.companies.find((c) => c.companyId === T1)!.jobs.some((j) => j.sourceId === id));
    const t2 = await db.asUser('u-fin-t2-lead', (svc, u) => svc.financeSqlPosting.view(u));
    assert.equal(t2.installed && t2.companies.some((c) => c.companyId === T1), false);
    const seen = await db.asUser('u-cm-sasa', (_svc, _u, store) => store.list('sqlPostings'));
    assert.equal(seen.some((j) => j.companyId === T1), false);

    // The key must name the row's own company: a job can never point at another company's book.
    const bad = { ...rows.rows[0].data, id: 'sqlp-bad', key: `co-other|BOOK|GL_PV|payment:${id}|r9` };
    await assert.rejects(owner.query('INSERT INTO prima.sql_postings (id, company_id, data) VALUES ($1, $2, $3)', ['sqlp-bad', T1, bad]), /sql_postings_key_company/);
    // And one key, one row.
    const dup = { ...rows.rows[0].data, id: 'sqlp-dup' };
    await assert.rejects(owner.query('INSERT INTO prima.sql_postings (id, company_id, data) VALUES ($1, $2, $3)', ['sqlp-dup', T1, dup]), /sql_postings_key_unique/);
  });
});
