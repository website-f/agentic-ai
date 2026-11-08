// P90 (Fitri, 9 Nov 2026: "in roster, it loads very slow ... loading nonstop"): the roster reads only the week's shifts
// through the site and date index, and only the rostered guards and their papers, not every shift the site ever had
// and the whole company's people. Same answer as before on a real local PostgreSQL; timings printed for the report.
// Synthetic data only: the generated mock dataset, multiplied in place.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { addDays, dateOf, deployability, type Store } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

type Svc = { roster(u: unknown, siteId: string, from: string, days: number): Promise<{ shifts: { id: string; personId: string | null; findings: { code: string }[] }[]; site: { companyId: string; armed: boolean } }> };

describe('Roster reads one week, not the site history', () => {
  let db: Db;
  let siteId = '';
  let from = '';
  before(async () => {
    await resetDb(URL);
    db = new Db();
    const admin = new Client({ connectionString: URL });
    await admin.connect();
    try {
      // The busiest site, then two years of extra weeks behind it and many more guards and papers in its company.
      const site = await admin.query(`SELECT data->>'siteId' AS id, min(data->>'date') AS first FROM prima.shifts GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
      siteId = site.rows[0].id;
      await admin.query(
        `INSERT INTO prima.shifts (id, company_id, data)
         SELECT 'p90-' || g || '-' || s.id, s.company_id,
                s.data || jsonb_build_object('id', 'p90-' || g || '-' || s.id,
                  'date', to_char((s.data->>'date')::date - g * 7, 'YYYY-MM-DD'))
         FROM prima.shifts s, generate_series(1, 104) g WHERE s.data->>'siteId' = $1`,
        [siteId],
      );
      await admin.query(
        `INSERT INTO prima.people (id, company_id, data)
         SELECT 'p90-' || g || '-' || p.id, p.company_id, p.data || jsonb_build_object('id', 'p90-' || g || '-' || p.id)
         FROM prima.people p, generate_series(1, 40) g
         WHERE p.company_id = (SELECT company_id FROM prima.sites WHERE id = $1)`,
        [siteId],
      );
      await admin.query(
        `INSERT INTO prima.credentials (id, company_id, data)
         SELECT 'p90-' || g || '-' || c.id, c.company_id,
                c.data || jsonb_build_object('id', 'p90-' || g || '-' || c.id, 'personId', 'p90-' || g || '-' || (c.data->>'personId'))
         FROM prima.credentials c, generate_series(1, 40) g
         WHERE c.company_id = (SELECT company_id FROM prima.sites WHERE id = $1)`,
        [siteId],
      );
      await admin.query('ANALYZE prima.shifts; ANALYZE prima.people; ANALYZE prima.credentials;');
      const now = await admin.query(`SELECT max(data->>'date') AS last FROM prima.shifts WHERE data->>'siteId' = $1`, [siteId]);
      from = addDays(String(now.rows[0].last), -6);
    } finally {
      await admin.end();
    }
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('gives the same shifts and findings as reading everything, and is faster', async () => {
    await db.asUser('u-fauzan', async (svc, user) => {
      const store = (svc as unknown as { store: Store }).store;
      const site = (await store.get('sites', siteId))!;
      // Before P90: every shift the site had, the whole company's people and papers.
      await store.list('shifts', { siteId }); // warm the connection and caches for both
      const t0 = performance.now();
      const all = (await store.list('shifts', { siteId })).filter((s) => s.date >= from && s.date <= addDays(from, 6));
      const people = await store.list('people', { companyId: site.companyId });
      const creds = await store.list('credentials', { companyId: site.companyId });
      const oldMs = performance.now() - t0;
      const byId = new Map(people.map((p) => [p.id, p]));
      const want = new Map(all.map((s) => [s.id, s.personId && byId.get(s.personId) ? deployability(byId.get(s.personId)!, creds, s.date, site.armed).map((f) => f.code).sort() : []]));
      // The whole roster as it was read before P90 (same service steps, the old reads), for the timing.
      const inner = svc as unknown as { shiftViews(s: unknown[]): Promise<unknown[]>; canRoster(u: unknown, a: string, c: string, s: string): Promise<boolean> };
      const tOld = performance.now();
      await store.list('posts', { siteId });
      const oldShifts = (await store.list('shifts', { siteId })).filter((s) => s.date >= from && s.date <= addDays(from, 6));
      await inner.shiftViews(oldShifts);
      const oldPeople = await store.list('people', { companyId: site.companyId });
      const oldCreds = await store.list('credentials', { companyId: site.companyId });
      const oldById = new Map(oldPeople.map((p) => [p.id, p]));
      for (const s of oldShifts) if (s.personId && oldById.get(s.personId)) deployability(oldById.get(s.personId)!, oldCreds, s.date, site.armed);
      await inner.canRoster(user, 'roster.edit', site.companyId, siteId);
      await inner.canRoster(user, 'roster.publish', site.companyId, siteId);
      const oldRosterMs = performance.now() - tOld;

      const t1 = performance.now();
      const r = await (svc as unknown as Svc).roster(user, siteId, from, 7);
      const firstMs = performance.now() - t1;
      const t2 = performance.now();
      await (svc as unknown as Svc).roster(user, siteId, from, 7);
      const newMs = performance.now() - t2;
      assert.ok(r.shifts.length > 0, 'the week has shifts');
      assert.deepEqual(r.shifts.map((s) => s.id).sort(), [...want.keys()].sort());
      for (const s of r.shifts) assert.deepEqual(s.findings.map((f) => f.code).sort(), want.get(s.id), s.id);
      const sizes = { siteShifts: (await store.list('shifts', { siteId })).length, people: people.length, credentials: creds.length, weekShifts: r.shifts.length };
      console.log(`[P90 roster] data ${JSON.stringify(sizes)}; before: reads ${oldMs.toFixed(0)} ms, whole roster ${oldRosterMs.toFixed(0)} ms; now: whole roster ${firstMs.toFixed(0)} ms first, ${newMs.toFixed(0)} ms again`);
      assert.ok(newMs < oldRosterMs, 'faster than before');
      assert.ok(dateOf(from) === from);
    });
  });

  it('reads the week through the site and date index', async () => {
    const admin = new Client({ connectionString: URL });
    await admin.connect();
    try {
      const plan = await admin.query(
        `EXPLAIN SELECT data FROM prima.shifts WHERE data->>'siteId' = ANY($1) AND jsonb_typeof(data->'date') = 'string' AND data->>'date' >= $2 AND data->>'date' < $3`,
        [[siteId], from, addDays(from, 7)],
      );
      const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
      console.log(`[P90 roster] plan:\n${text}`);
      assert.match(text, /shifts_site_date_idx/);
    } finally {
      await admin.end();
    }
  });
});
