// The tender watcher on PostgreSQL (AH11): the system sign-in reads only sites Marketing allowed, under the real
// tender-sites wall, and its finds wait for Marketing. A fake page getter stands in for the web; synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type PrimaService, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { runTenderWatcher, type PageGet } from '../src/tender-watcher-online';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const PAGE = 'https://buyer.example.gov.my/tender';
const HTML = '<ul><li>Perkhidmatan Kawalan Keselamatan (mock) BEX/T/2026/7, tutup 18/12/2026</li><li>Cleaning (mock)</li></ul>';
const get: PageGet = async (url) => (url === PAGE ? { status: 200, type: 'text/html', body: HTML, location: null } : { status: 404, type: 'text/html', body: '', location: null });

describe('Tender watcher (PostgreSQL)', () => {
  let db: Db;
  const as = <T>(id: string, fn: (svc: PrimaService, u: User) => Promise<T>) => db.asUser(id, fn, () => NOW);
  before(async () => {
    await resetDb(URL, NOW);
    const c = new Client({ connectionString: URL });
    await c.connect();
    try {
      for (const m of ['tender-opportunities-v1.sql', 'business-walls-v1.sql']) await c.query(readFileSync(resolve(__dirname, '../../../../db/modules', m), 'utf8'));
    } finally {
      await c.end();
    }
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('reads allowed sites only and leaves the finds for Marketing', async () => {
    await as('u-fauzan', (svc, u) => svc.startMarketingDesk(u, TODAY, 'Marketing does all from today'));
    const site = await as('u-mkt-mgr', (svc, u) => svc.addTenderSource(u, { buyer: 'Buyer Example (mock)', urls: [PAGE] }));
    assert.deepEqual(await runTenderWatcher(db, get, async () => {}, () => NOW), []);
    await as('u-mkt-mgr', (svc, u) => svc.setTenderSourceWatch(u, site.id, { allowed: true, note: 'Terms of use read: public notices may be read' }));
    const out = await runTenderWatcher(db, get, async () => {}, () => NOW);
    assert.deepEqual(out, [{ id: site.id, read: 1, pages: 1, found: 1, fresh: 1 }]);
    const list = await as('u-mkt-mgr', (svc, u) => svc.tenderSources(u));
    const row = list.rows.find((r) => r.id === site.id)!;
    assert.equal(row.watchFinds?.[0].ref, 'BEX/T/2026/7');
    assert.equal(row.checks[0].by, 'Tender watcher');
    // The watcher sign-in cannot do Marketing's work.
    await assert.rejects(as('u-tender-watcher', (svc, u) => svc.answerTenderWatchFind(u, site.id, row.watchFinds![0].key, { action: 'NOT_FOR_US', note: 'no' })));
    await assert.rejects(as('u-tender-watcher', (svc, u) => svc.setTenderSourceWatch(u, site.id, { allowed: true, note: 'self' })));
  });
});
