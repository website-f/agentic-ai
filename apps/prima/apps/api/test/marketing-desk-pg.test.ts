// Marketing desk on PostgreSQL (Fauzan, 22-23 Nov 2026). Under the real company wall a Tender Executive works a bid
// only for a company they hold a grant for; another executive and the company's own admin team are refused. Synthetic
// data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { addDays, myt, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const doc = { kind: 'document' as const, name: 'Arahan.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic').toString('base64')}` };

describe('Marketing desk (PostgreSQL)', () => {
  let db: Db;
  const as = <T>(id: string, fn: (svc: PrimaService, u: User) => Promise<T>) => db.asUser(id, fn, () => NOW);
  before(async () => {
    await resetDb(URL, NOW);
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      await c.query(readFileSync(resolve(__dirname, '../../../../db/modules/tender-opportunities-v1.sql'), 'utf8'));
    } finally {
      await c.end();
    }
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('only the CEO or the COO starts the desk', async () => {
    await assert.rejects(as('u-mkt-mgr', (svc, u) => svc.startMarketingDesk(u, TODAY, 'try')), /not allowed|denied|commercial/i);
    await assert.rejects(as('u-pwvsb-doa', (svc, u) => svc.startMarketingDesk(u, TODAY, 'try')), /not allowed|denied|commercial/i);
    const desk = await as('u-fauzan', (svc, u) => svc.startMarketingDesk(u, TODAY, 'Marketing does all from today'));
    assert.equal(desk.from, TODAY);
  });

  it('an executive works a bid only for a company they cover; the company approves', async () => {
    const board = await as('u-mkt-mgr', (svc, u) => svc.marketingBoard(u));
    assert.equal(board.deskOn, true);
    const row = board.rows.find((r) => r.companyId === 'co-sasa')!;
    const own = board.staff.find((s) => s.name === row.executives[0])!.id;
    const other = board.staff.find((s) => s.role === 'executive' && s.id !== own)!.id;
    const input = { kind: 'TENDER', ref: 'MKT-PG-1', title: 'Guarding services (mock)', buyer: 'Test Utility (mock)', channel: 'GOVERNMENT', source: 'Public portal', closesOn: addDays(TODAY, 20), guards: 10, note: '', companyIds: ['co-sasa'] };
    await assert.rejects(as(other, (svc, u) => svc.recordTenderOpportunity(u, input)));
    await as(own, (svc, u) => svc.recordTenderOpportunity(u, input));
    const t = (await as(own, (svc, u) => svc.commercial(u, 'co-sasa'))).tenders.find((r) => r.tender.ref === 'MKT-PG-1')!;
    assert.equal(t.tender.desk, 'MARKETING');
    assert.equal(t.canWork, true);
    // The wall: an executive without a grant for the company cannot even read it.
    await assert.rejects(as(other, (svc, u) => svc.commercial(u, 'co-sasa')));
    await assert.rejects(as(other, (svc, u) => svc.addTenderPapers(u, t.tender.id, 'ARAHAN', [doc])));
    // The company's admin team and the Director Office do not work a desk bid.
    await assert.rejects(as('u-ae-sasa', (svc, u) => svc.addTenderPapers(u, t.tender.id, 'ARAHAN', [doc])));
    await assert.rejects(as('u-pwvsb-doa', (svc, u) => svc.addTenderPapers(u, t.tender.id, 'ARAHAN', [doc])));
    await as(own, (svc, u) => svc.addTenderPapers(u, t.tender.id, 'ARAHAN', [doc]));
    await as(own, (svc, u) => svc.draftTenderChecklist(u, t.tender.id));
    // Marketing never sees quotations; the company manager sees the notice and may say "do not bid".
    assert.deepEqual((await as(own, (svc, u) => svc.commercial(u, 'co-sasa'))).quotations, []);
    const home = await as('u-cm-sasa', (svc, u) => svc.home(u, 'co-sasa'));
    assert.ok(home.todo.some((i) => /Marketing will bid/.test(i.title)));
    await assert.rejects(as(own, (svc, u) => svc.decideTender(u, t.tender.id, 'TIDAK_BIDA', 'not mine')));
    const stopped = await as('u-cm-sasa', (svc, u) => svc.decideTender(u, t.tender.id, 'TIDAK_BIDA', 'Site too far from our branch'));
    assert.equal(stopped.status, 'no_bid');
    // The reason for a company with no entry is kept on the shared protocol row; only staff who cover the company write it.
    await assert.rejects(as(other, (svc, u) => svc.setNoEntryReason(u, 'co-sasa', 'No suitable tender this month')));
    await assert.rejects(as('u-cm-sasa', (svc, u) => svc.setNoEntryReason(u, 'co-sasa', 'No suitable tender this month')));
    await as(own, (svc, u) => svc.setNoEntryReason(u, 'co-sasa', 'Company said do not bid: site too far'));
    const after = await as('u-mkt-dep', (svc, u) => svc.marketingBoard(u));
    assert.equal(after.rows.find((r) => r.companyId === 'co-sasa')!.reason?.byId, own);
    // Hours are recorded only on a bid still being worked on.
    await assert.rejects(as(own, (svc, u) => svc.recordTenderHours(u, t.tender.id, 1)), /no longer/);
  });
});
