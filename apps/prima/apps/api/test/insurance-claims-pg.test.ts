// Masterplan row 61 (Fauzan, 3 Nov 2026): insurance claim steps through the restricted login and the company wall.
// Synthetic seed data on a throwaway local PostgreSQL; DATABASE_URL must point at it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('insurance claims on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps the wall, one acceptance, and a Finance receipt by someone other than the acceptor', async () => {
    const today = nowMyt().slice(0, 10);
    const { pol, fd, fin } = await db.asUser('u-fauzan', async (_svc, _u, store) => {
      const pols = await store.list('insurancePolicies', { companyId: ['co-sasa'] });
      const users = await store.list('users', {});
      const st = (await store.list('finStatus', { companyId: ['co-sasa'] }))[0];
      return {
        pol: pols.find((p) => p.startsOn <= today && today <= p.expiresOn)!,
        fd: users.find((u) => u.leadership === 'finance_director')!.id,
        fin: users.filter((u) => u.department === 'finance' && u.financeTeam === st.team)[0].id,
      };
    });
    await db.asUser('u-bm-sasa-1', (svc, u) =>
      svc.saveRecord(u, 'insuranceClaim', null, 'co-sasa', { policyId: pol.id, ref: 'CLM-PG-1', what: 'PG synthetic incident', incidentOn: today, amountClaimed: 1_000 }),
    );
    const id = await db.asUser('u-bm-sasa-1', async (_svc, _u, store) => (await store.list('insuranceClaims', { companyId: ['co-sasa'] })).find((c) => c.ref === 'CLM-PG-1')!.id);
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.insuranceClaimAct(u, id, 'notify', { on: today, insurerRef: 'X', how: 'Email' })), /not found/i);
    const act = (who: string, action: string, body: Record<string, unknown>) => db.asUser(who, (svc, u) => svc.insuranceClaimAct(u, id, action, body));
    await act('u-bm-sasa-1', 'notify', { on: today, insurerRef: 'INS-PG', how: 'Email' });
    const docs = await db.asUser('u-bm-sasa-1', async (svc, u) => (await svc.insurance(u)).claims.find((r) => r.claim.id === id)!.missingDocs);
    for (const name of docs) await act('u-bm-sasa-1', 'add_doc', { name, ref: 'PG-DOC' });
    await act('u-bm-sasa-1', 'submit', { on: today });
    await act('u-bm-sasa-1', 'offer', { amount: 1_000, ref: 'OFF-PG', on: today });
    const both = await Promise.allSettled([act('u-cm-sasa', 'accept', { note: 'Full amount' }), act('u-cm-sasa', 'accept', { note: 'Full amount again' })]);
    assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
    const paid = await Promise.allSettled([act(fd, 'received', { bankRef: 'ST-PG', on: today }), act(fin, 'received', { bankRef: 'ST-PG', on: today })]);
    assert.equal(paid.filter((r) => r.status === 'fulfilled').length, 1);
    const actions = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === id).map((a) => a.action));
    for (const a of ['insurance.claim.notify', 'insurance.claim.submit', 'insurance.claim.accept', 'insurance.claim.received']) assert.ok(actions.includes(a), a);
  });
});
