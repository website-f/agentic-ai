// Company paper library on PostgreSQL (Marketing Part AH7, Fauzan 23 Nov 2026). Under the real company wall only the
// company office and the Marketing staff who cover the company read or add its papers; nothing is deleted and a saved
// paper changes only by being marked replaced. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, statementMonths, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = () => ({ kind: 'document' as const, name: `Paper ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic paper ${n}`).toString('base64')}` });

describe('Company paper library (PostgreSQL)', () => {
  let db: Db;
  const as = <T>(id: string, fn: (svc: PrimaService, u: User) => Promise<T>) => db.asUser(id, fn, () => NOW);
  const sql = async (q: string) => {
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      return await c.query(q);
    } finally {
      await c.end();
    }
  };
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says the library is not installed until the module is run', async () => {
    const lib = await as('u-ae-sasa', (svc, u) => svc.companyPapers(u, 'co-sasa'));
    assert.equal(lib.installed, false);
    await assert.rejects(as('u-ae-sasa', (svc, u) => svc.addCompanyPaper(u, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [doc()])), /not installed/);
    await sql(readFileSync(resolve(__dirname, '../../../../db/modules/company-papers-v1.sql'), 'utf8'));
    await db.onModuleDestroy();
    db = new Db();
  });

  it('keeps papers behind the company wall and replaces instead of deleting', async () => {
    const month = statementMonths(TODAY)[0];
    const first = await as('u-ae-sasa', (svc, u) => svc.addCompanyPaper(u, 'co-sasa', { kind: 'BANK_STATEMENT', period: month }, [doc()]));
    const board = await as('u-mkt-mgr', (svc, u) => svc.marketingBoard(u));
    const row = board.rows.find((r) => r.companyId === 'co-sasa')!;
    assert.ok(row.papers, 'the board reads the library once installed');
    const own = board.staff.find((s) => s.name === row.executives[0])!.id;
    const other = board.staff.find((s) => s.role === 'executive' && s.id !== own && !board.rows.filter((r) => r.executives.includes(s.name)).some((r) => r.companyId === 'co-sasa'))!.id;
    const second = await as(own, (svc, u) => svc.addCompanyPaper(u, 'co-sasa', { kind: 'BANK_STATEMENT', period: month }, [doc()]));
    const lib = await as(own, (svc, u) => svc.companyPapers(u, 'co-sasa'));
    assert.equal(lib.papers.find((p) => p.id === first.id)!.replacedBy, second.id);
    assert.equal(lib.papers.find((p) => p.id === second.id)!.docs.length, 1);
    // Another executive and another company's office cannot read or add.
    await assert.rejects(as(other, (svc, u) => svc.companyPapers(u, 'co-sasa')));
    await assert.rejects(as(other, (svc, u) => svc.addCompanyPaper(u, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [doc()])));
    await assert.rejects(as('u-pwvsb-doa', (svc, u) => svc.addCompanyPaper(u, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [doc()])));
    // The app role cannot delete a paper or change a saved one.
    await assert.rejects(
      sql(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-sasa', true); DELETE FROM prima.company_papers WHERE id = '${first.id}'; COMMIT;`),
      /permission denied/,
    );
    const rows = await sql(`SELECT count(*)::int AS n FROM prima.company_papers WHERE company_id = 'co-sasa'`);
    assert.equal(rows.rows[0].n, 2);
    await assert.rejects(sql(`UPDATE prima.company_papers SET data = jsonb_set(data, '{title}', '"changed"') WHERE id = '${second.id}'`), /not changed/);
  });
});
