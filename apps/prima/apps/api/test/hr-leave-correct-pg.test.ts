import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

// Friday in Malaysia: concurrency fixtures must not become weekend-only leave on the runner's date.
const NOW = '2026-11-06T09:00:00+08:00';
const clock = () => NOW;

const doc = (n: number) => ({ kind: 'document' as const, name: `mc-${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic MC ${n}`).toString('base64')}` });

// Arisha review, 3 Nov 2026: two sends at the same moment must not both correct one refusal, or both use one MC.
describe('leave correction and MC use under PostgreSQL concurrency (synthetic)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('lets one of two simultaneous corrections of a refused sick leave through, reusing its MC documents', async () => {
    const today = await db.asUser('u-it-ex3', async (svc) => svc.now().slice(0, 10), clock);
    const mc = { kind: 'SICK' as const, from: today, to: today, reason: 'Demam (sintetik)', illness: 'Demam', clinic: 'Klinik Ujian Serentak', mcNo: 'KUS-RACE-1' };
    const personId = await db.asUser('u-it-ex3', async (_svc, u) => u.personId!, clock);
    const first = await db.asUser('u-it-ex3', (svc, u) => svc.requestLeave(u, { personId, ...mc, proof: [doc(1)] }), clock);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.decideLeave(u, first.id, false, 'Sila semak (synthetic)'), clock);
    const tries = await Promise.allSettled(
      Array.from({ length: 4 }, () => db.asUser('u-it-ex3', (svc, u) => svc.requestLeave(u, { personId, ...mc, correctsId: first.id }), clock)),
    );
    const ok = tries.filter((t) => t.status === 'fulfilled');
    assert.equal(ok.length, 1, tries.map((t) => (t.status === 'rejected' ? String((t.reason as Error).message) : 'ok')).join(' | '));
    const rows = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.leave_requests WHERE data->>'correctsId' = $1`, [first.id]);
    assert.equal(rows[0].n, 1);
    const live = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.leave_requests WHERE data->>'mcNo' = 'KUS-RACE-1' AND data->>'status' <> 'rejected'`);
    assert.equal(live[0].n, 1);
    const made = (ok[0] as PromiseFulfilledResult<{ proofIds: string[] }>).value;
    assert.deepEqual(made.proofIds, first.proofIds);
  });

  it('lets one of two simultaneous new requests with the same MC through', async () => {
    const today = await db.asUser('u-it-ex4', async (svc) => svc.now().slice(0, 10), clock);
    const personId = await db.asUser('u-it-ex4', async (_svc, u) => u.personId!, clock);
    const mc = { kind: 'SICK' as const, from: today, to: today, reason: 'Demam (sintetik)', illness: 'Demam', clinic: 'Klinik Ujian Serentak', mcNo: 'KUS-RACE-2' };
    const tries = await Promise.allSettled([1, 2, 3].map((n) => db.asUser('u-it-ex4', (svc, u) => svc.requestLeave(u, { personId, ...mc, proof: [doc(10 + n)] }), clock)));
    assert.equal(tries.filter((t) => t.status === 'fulfilled').length, 1, tries.map((t) => (t.status === 'rejected' ? String((t.reason as Error).message) : 'ok')).join(' | '));
    const live = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.leave_requests WHERE data->>'mcNo' = 'KUS-RACE-2'`);
    assert.equal(live[0].n, 1);
  });

  it('still refuses weekend-only sick leave without writing a request or MC document', async () => {
    const personId = await db.asUser('u-it-ex4', async (_svc, u) => u.personId!, clock);
    await assert.rejects(
      db.asUser('u-it-ex4', (svc, u) => svc.requestLeave(u, {
        personId, kind: 'SICK', from: '2026-11-07', to: '2026-11-08', reason: 'Demam (sintetik)',
        illness: 'Demam', clinic: 'Klinik Ujian Serentak', mcNo: 'KUS-WEEKEND', proof: [doc(99)],
      }), clock),
      /Those days are all weekends or public holidays/,
    );
    const requests = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.leave_requests WHERE data->>'mcNo' = 'KUS-WEEKEND'`);
    const documents = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.evidence_docs WHERE data->>'name' = 'mc-99.pdf'`);
    assert.equal(requests[0].n, 0);
    assert.equal(documents[0].n, 0);
  });
});
