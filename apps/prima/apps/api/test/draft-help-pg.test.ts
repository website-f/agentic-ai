// Drafting help audit on a real local PostgreSQL (throwaway database; the test resets it). Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { verifyChain } from '@prima/core';
import { DraftHelpService } from '../src/draft-help';
import { DraftHelpController, draftHelpAudit } from '../src/draft-help.controller';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
delete process.env.DRAFT_HELP_ENABLED;

const form = { title: 'PRIVATE_JOB_TITLE', jobKind: 'RENOVATION', details: { Scope: 'PRIVATE_SCOPE' }, measurements: { 'Panjang (m)': 7.2 } };
const out = { sections: [{ title: 'Kerja roboh', lines: [{ item: 'Buka siling', qty: 43.2, unit: 'm2', working: '7.2 x 6.0', basis: 'measured', optional: false }] }], notes: [] };

describe('drafting help on PostgreSQL', () => {
  let db: Db;
  before(async () => { await resetDb(URL); db = new Db(); });
  after(async () => { await db.onModuleDestroy(); });

  it('commits the start before the model is called, keeps only hashes, and the audit chain stays whole', async () => {
    let seenStart = false;
    const svc = new DraftHelpService({
      suggest: async () => {
        // A separate connection sees the committed start: the model call is not inside a transaction.
        const r = await db.pool.query("SELECT data FROM prima.audit WHERE data->>'action'='draft.help.started' ORDER BY seq DESC LIMIT 1");
        seenStart = r.rowCount === 1;
        return out;
      },
    }, draftHelpAudit(db));
    const user = await db.asUser('u-asset-mm', async (_s, u) => u);
    const r = await svc.suggest(user, 'bq', { consent: 'draft-help-v1', form }, '2026-11-05');
    assert.ok(seenStart);
    const rows = await db.pool.query("SELECT data FROM prima.audit WHERE data->>'entityId'=$1 ORDER BY seq", [r.suggestionId]);
    assert.deepEqual(rows.rows.map((x) => x.data.action), ['draft.help.started', 'draft.help.terminal']);
    assert.equal(rows.rows[1].data.actor, 'u-asset-mm');
    assert.equal(JSON.parse(rows.rows[1].data.summary).outcome, 'success');
    const all = await db.pool.query('SELECT data FROM prima.audit ORDER BY seq');
    assert.ok(!JSON.stringify(all.rows).includes('PRIVATE_'), 'no form text in the audit');
    assert.equal(verifyChain(all.rows.map((x) => x.data)), null);
  });

  it('writes the audit under the database wall for a company manager (post) and Finance (bill)', async () => {
    const post = { bm: 'JAWATAN KOSONG: Pengawal Keselamatan', en: 'Pengawal Keselamatan (Security Guard)' };
    const svc = new DraftHelpService({ suggest: async (input) => input.kind === 'job-post' ? post : { fields: { billerName: { raw: 'SYARIKAT AIR CONTOH BHD' }, accountNo: { raw: null }, billNo: { raw: null }, billDate: { raw: null }, dueDate: { raw: null }, periodFrom: { raw: null }, periodTo: { raw: null }, amountDue: { raw: 'RM88.00' } } } }, draftHelpAudit(db));
    const cm = await db.asUser('u-cm-sasa', async (_s, u) => u);
    const fin = await db.asUser('u-finance-am', async (_s, u) => u);
    const a = await svc.suggest(cm, 'job-post', { consent: 'draft-help-v1', form: { title: 'Pengawal Keselamatan', employer: 'Syarikat Contoh Sdn Bhd' } }, '2026-11-05');
    const b = await svc.suggest(fin, 'bill', { consent: 'draft-help-v1', form: { text: 'SYARIKAT AIR CONTOH BHD\nJumlah RM88.00' } }, '2026-11-05');
    for (const r of [a, b]) {
      const rows = await db.pool.query("SELECT data FROM prima.audit WHERE data->>'entityId'=$1 ORDER BY seq", [r.suggestionId]);
      assert.equal(rows.rowCount, 2);
    }
    await assert.rejects(svc.suggest(cm, 'bill', { consent: 'draft-help-v1', form: { text: 'x' } }, '2026-11-05'), { message: 'FORBIDDEN' });
  });

  it('the endpoint is off by default and still refuses people outside the team', async () => {
    const c = new DraftHelpController(db);
    assert.deepEqual(await c.status('u-asset-mm'), { on: false, kinds: [], consentVersion: 'draft-help-v1' });
    await assert.rejects(c.suggest('u-asset-mm', 'bq', { consent: 'draft-help-v1', form }), (e: { getStatus(): number }) => e.getStatus() === 503);
    await assert.rejects(c.suggest('u-fauzan', 'bq', { consent: 'draft-help-v1', form }), (e: { getStatus(): number }) => e.getStatus() === 403);
  });
});
