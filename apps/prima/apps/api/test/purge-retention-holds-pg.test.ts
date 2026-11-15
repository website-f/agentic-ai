// Fauzan's audit of 4b708ae (14 Nov 2026), P2: the retention clean-up keeps a site gate record or a CMS clip only while
// an OPEN legal hold names that exact record (same table, same id). A released hold, or a hold on another table that
// happens to carry the same id, no longer keeps it. Disposable local PostgreSQL, synthetic rows only, dry runs only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { purgeRetention } from '../src/purge-retention';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new globalThis.URL(URL).hostname)) throw Error('Disposable localhost database required');
const NOW = Date.parse('2026-11-15T00:00:00.000Z');
const CO = 'co-sasa';

describe('retention clean-up and legal holds (audit P2)', () => {
  let c: Client;
  const sql = (f: string) => readFileSync(join(__dirname, '../../../../db/modules', f), 'utf8');
  const hold = (id: string, tbl: string, refId: string, released: boolean) =>
    c.query('INSERT INTO prima.legal_holds (id, company_id, data) VALUES ($1, $2, $3)', [id, CO, { id, companyId: CO, tbl, refId, matterId: 'lm-synthetic', by: 'Legal (synthetic)', byId: 'u-legal-synthetic', at: '2026-01-01T00:00:00+08:00', released: released ? { by: 'Legal (synthetic)', byId: 'u-legal-synthetic', at: '2026-02-01T00:00:00+08:00' } : null }]);
  before(async () => {
    await resetDb(URL);
    c = new Client({ connectionString: URL });
    await c.connect();
    await c.query('DELETE FROM prima.gate_entries');
    await c.query('DELETE FROM prima.evidence_videos');
    for (const id of ['ge-syn-active', 'ge-syn-released', 'ge-syn-unrelated'])
      await c.query('INSERT INTO prima.gate_entries (id, company_id, data) VALUES ($1, $2, $3)', [id, CO, { id, companyId: CO, inAt: '2015-01-01T08:00:00+08:00' }]);
    for (const id of ['ev-syn-active', 'ev-syn-released', 'ev-syn-unrelated'])
      await c.query('INSERT INTO prima.evidence_videos (id, company_id, data) VALUES ($1, $2, $3)', [id, CO, { id, companyId: CO, caseId: null, keepUntil: '2026-01-01' }]);
  });
  after(async () => {
    await c.end();
  });

  it('without the legal hold module every expired record is counted', async () => {
    const r = await purgeRetention(c as never, 'synthetic test', false, NOW);
    assert.equal(r.gate, 3);
    assert.equal(r.videos, 3);
  });

  it('version 1 cannot name a gate record; version 2 can', async () => {
    await c.query(sql('central-admin-legal-holds-v1.sql'));
    await assert.rejects(hold('lh-syn-v1', 'gate_entries', 'ge-syn-active', false), /check constraint/);
    await c.query(sql('central-admin-legal-holds-v2.sql'));
    await c.query(sql('central-admin-legal-holds-v2.sql')); // repeat-safe
  });

  it('an open hold keeps its record; a released hold and a hold on another table do not', async () => {
    await hold('lh-syn-1', 'gate_entries', 'ge-syn-active', false);
    await hold('lh-syn-2', 'gate_entries', 'ge-syn-released', true);
    await hold('lh-syn-3', 'cases', 'ge-syn-unrelated', false);
    await hold('lh-syn-4', 'evidence_videos', 'ev-syn-active', false);
    await hold('lh-syn-5', 'evidence_videos', 'ev-syn-released', true);
    await hold('lh-syn-6', 'cases', 'ev-syn-unrelated', false);
    const r = await purgeRetention(c as never, 'synthetic test', false, NOW);
    assert.equal(r.gate, 2);
    assert.equal(r.videos, 2);
    assert.equal(r.applied, false);
    // A dry run deletes nothing.
    assert.equal((await c.query('SELECT count(*)::int AS n FROM prima.gate_entries')).rows[0].n, 3);
  });

  it('applying deletes exactly the unheld records and keeps the held ones', async () => {
    const r = await purgeRetention(c as never, 'synthetic test', true, NOW);
    assert.equal(r.gate, 2);
    assert.equal(r.videos, 2);
    assert.deepEqual((await c.query('SELECT id FROM prima.gate_entries ORDER BY id')).rows.map((x) => x.id), ['ge-syn-active']);
    assert.deepEqual((await c.query('SELECT id FROM prima.evidence_videos ORDER BY id')).rows.map((x) => x.id), ['ev-syn-active']);
  });
});
