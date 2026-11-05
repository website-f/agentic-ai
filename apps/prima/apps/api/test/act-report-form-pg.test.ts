// ACT monthly report forms on the real PostgreSQL adapter (Arisha main review, 2 Nov 2026): the sections the ACT
// Director sets must survive a later Director Office save of the report list, which rebuilds each report without them.
// Synthetic data only; run with DATABASE_URL pointing at a throwaway local database (the test resets it).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('ACT monthly report form on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps the ACT Director form through a Director Office save, and refuses anyone else', async () => {
    const sections = ['Summary of the month', 'Tickets and speed', 'Devices and rentals', 'Help needed'];
    const checks = ['Tickets against the IT board'];
    await assert.rejects(
      db.asUser('u-act-aud1', (svc, u) => svc.setActReportForm(u, { department: 'it', sections, checks, note: 'try' })),
      /Only the ACT Director/,
    );
    const set = await db.asUser('u-audit', (svc, u) => svc.setActReportForm(u, { department: 'it', sections, checks, note: 'IT pilot form' }));
    assert.deepEqual(set.sections, sections);
    // The Director Office saves its whole list again (its form never carries sections).
    await db.asUser('u-pwvsb-doa', async (svc, u) => {
      const r = await svc.reports(u);
      const defs = r.editList!.map(({ sections: _s, checks: _c, formBy: _f, ...d }) => ({ ...d, detail: `${d.detail}`.slice(0, 300) }));
      return svc.setReportDefs(u, defs, 'Weekly list tidy-up');
    });
    const after = await db.asUser('u-audit', async (_svc, _u, store) => store.get('reportDefs', set.id));
    assert.deepEqual(after?.sections, sections);
    assert.deepEqual(after?.checks, checks);
    assert.equal(after?.dueDay, 25);
    // ACT sees it on its board through the same adapter.
    const board = await db.asUser('u-audit', (svc, u) => svc.actBoard(u));
    assert.deepEqual(board.reportForms.find((f) => f.defId === set.id)?.sections, sections);
  });

  it('keeps team limits and plain refusal wording through the adapter', async () => {
    const f = await db.asUser('u-act-aud1', (svc, u) =>
      svc.raiseActFinding(u, { companyId: 'co-arsh', area: 'BILLING', source: 'workflow_audit', title: 'Late invoices', detail: '', severity: 'low', evidence: 'October sample', ownerUserId: 'u-cm-arsh' }),
    );
    assert.equal(f.team, 1);
    await assert.rejects(
      db.asUser('u-act-enf2', (svc, u) => svc.actFindingStep(u, f.id, 'follow_up', { method: 'call', note: 'x' })),
      (e: Error) => e.name === 'AccessDenied' && /with Team 1/.test(e.message) && !/authority grant/.test(e.message),
    );
    const done = await db.asUser('u-act-enf1', (svc, u) => svc.actFindingStep(u, f.id, 'follow_up', { method: 'visit', note: 'Owner promised a plan' }));
    assert.equal(done.followUps?.length, 1);
  });
});
