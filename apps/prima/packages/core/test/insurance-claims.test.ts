import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, missingClaimDocs, myt } from '../src';

// Masterplan row 61 (Fauzan, 3 Nov 2026 "proceed work"): insurance claim steps. Synthetic data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

async function newClaim() {
  const f = fresh();
  const desk = await f.svc.user('u-bm-sasa-1');
  const pol = f.ds.insurancePolicies.find((p) => p.companyId === 'co-sasa' && p.kind === 'PUBLIC_LIABILITY')!;
  await f.svc.saveRecord(desk, 'insuranceClaim', null, 'co-sasa', {
    policyId: pol.id,
    ref: 'CLM-TEST-1',
    what: 'Client car scratched by a gate barrier (test)',
    incidentOn: '2026-10-20',
    amountClaimed: 3_000,
  });
  const claim = (await f.store.list('insuranceClaims', { companyId: ['co-sasa'] })).find((c) => c.ref === 'CLM-TEST-1')!;
  return { ...f, desk, pol, claim };
}

describe('Insurance claim steps (masterplan 61)', () => {
  it('opens as not told, and the record form can no longer type a settlement', async () => {
    const { claim, svc, desk, pol } = await newClaim();
    expect(claim.status).toBe('to_notify');
    expect(claim.openedById).toBe('u-bm-sasa-1');
    await expect(
      svc.saveRecord(desk, 'insuranceClaim', null, 'co-sasa', { policyId: pol.id, ref: 'X-2', what: 'Future incident (test)', incidentOn: '2026-11-30', amountClaimed: 10 }),
    ).rejects.toThrow(/future/);
    await svc.insuranceClaimAct(desk, claim.id, 'notify', { on: '2026-10-21', insurerRef: 'INS-77', how: 'Email to broker' });
    await expect(
      svc.saveRecord(desk, 'insuranceClaim', claim.id, 'co-sasa', { policyId: pol.id, ref: 'CLM-TEST-1', what: 'Changed', incidentOn: '2026-10-20', amountClaimed: 9_999 }),
    ).rejects.toThrow(/steps/);
  });

  it('runs notify, documents, assessment, offer, manager accepts, a different Finance person records the money', async () => {
    const { ds, claim, svc, desk } = await newClaim();
    const cm = await svc.user('u-cm-sasa');
    const fd = ds.users.find((u) => u.leadership === 'finance_director')!;
    await expect(svc.insuranceClaimAct(desk, claim.id, 'notify', { on: '2026-10-19', insurerRef: 'INS-77', how: 'Email' })).rejects.toThrow(/from 2026-10-20/);
    await svc.insuranceClaimAct(desk, claim.id, 'notify', { on: '2026-10-21', insurerRef: 'INS-77', how: 'Email to broker' });
    for (const name of ['Claim form', 'Incident report', 'Police report'])
      await svc.insuranceClaimAct(desk, claim.id, 'add_doc', { name, ref: `F-${name.length}` });
    await expect(svc.insuranceClaimAct(desk, claim.id, 'submit', { on: '2026-10-24' })).rejects.toThrow(/letter of demand/);
    await svc.insuranceClaimAct(desk, claim.id, 'add_doc', { name: "Third party's letter of demand", ref: 'LOD-1' });
    expect(missingClaimDocs('PUBLIC_LIABILITY', (await svc.insurance(cm)).claims.find((r) => r.claim.id === claim.id)!.claim.docs ?? [])).toEqual([]);
    await svc.insuranceClaimAct(desk, claim.id, 'submit', { on: '2026-10-24' });
    await svc.insuranceClaimAct(desk, claim.id, 'offer', { amount: 2_500, ref: 'DV-01', on: '2026-10-25' });
    await expect(svc.insuranceClaimAct(desk, claim.id, 'accept', { note: 'OK fine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.insuranceClaimAct(cm, claim.id, 'accept', { note: 'Fine' })).rejects.toThrow(/below the amount claimed/);
    await expect(svc.insuranceClaimAct(fd, claim.id, 'received', { bankRef: 'ST-1', on: '2026-10-26' })).rejects.toThrow(/accepted first/);
    await svc.insuranceClaimAct(cm, claim.id, 'accept', { note: 'Excess of RM500 under the policy; accept' });
    await expect(svc.insuranceClaimAct(cm, claim.id, 'received', { bankRef: 'ST-1', on: '2026-10-26' })).rejects.toBeInstanceOf(AccessDenied);
    const done = (await svc.insuranceClaimAct(fd, claim.id, 'received', { bankRef: 'ST-2026-10-26', on: '2026-10-26' })) as { status: string; settledAmount: number };
    expect(done.status).toBe('settled');
    expect(done.settledAmount).toBe(2_500);
  });

  it('records a rejection, allows one appeal by the company manager, and keeps other companies out', async () => {
    const { claim, svc, desk } = await newClaim();
    const cm = await svc.user('u-cm-sasa');
    const other = await svc.user('u-cm-inas');
    await expect(svc.insuranceClaimAct(other, claim.id, 'notify', { on: '2026-10-21', insurerRef: 'X', how: 'Email' })).rejects.toThrow(/not found/i);
    await svc.insuranceClaimAct(desk, claim.id, 'notify', { on: '2026-10-21', insurerRef: 'INS-78', how: 'Letter' });
    await svc.insuranceClaimAct(desk, claim.id, 'reject', { reason: 'Gate barrier excluded (test)', ref: 'REJ-1', on: '2026-10-25' });
    await expect(svc.insuranceClaimAct(desk, claim.id, 'appeal', { reason: 'Barrier was operated by the guard, covered' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.insuranceClaimAct(cm, claim.id, 'appeal', { reason: 'Barrier was operated by the guard, covered under clause 3' });
    await svc.insuranceClaimAct(desk, claim.id, 'reject', { reason: 'Exclusion upheld (test)', ref: 'REJ-2', on: '2026-10-26' });
    await expect(svc.insuranceClaimAct(cm, claim.id, 'appeal', { reason: 'Second appeal attempt for the test' })).rejects.toThrow(/once/);
  });
});

describe('Insurance claim record save on stale data (Arisha main, 3 Nov 2026)', () => {
  it('refuses an edit when the insurer was told after the form was opened', async () => {
    const { store, svc, desk, pol, claim } = await newClaim();
    const values = { policyId: pol.id, ref: 'CLM-TEST-1', what: 'Edited from a stale form (test)', incidentOn: '2026-10-20', amountClaimed: 9_999 };
    // The notify step commits while the stale save waits for its hold on the claim.
    store.lock = async (table, id) => {
      if (table === 'insuranceClaims' && id === claim.id) {
        store.lock = undefined;
        await svc.insuranceClaimAct(desk, claim.id, 'notify', { on: '2026-10-21', insurerRef: 'INS-1', how: 'Email' });
      }
    };
    await expect(svc.saveRecord(desk, 'insuranceClaim', claim.id, 'co-sasa', values)).rejects.toThrow(/only through its steps/);
    const cur = (await store.get('insuranceClaims', claim.id))!;
    expect(cur.status).not.toBe('to_notify');
    expect(cur.amountClaimed).toBe(3_000);
    // And a save whose pre-check passed is still refused if the step lands inside the save.
    const f = await newClaim();
    const tx0 = f.store.transaction.bind(f.store);
    f.store.transaction = async (fn) => {
      f.store.transaction = tx0;
      await f.svc.insuranceClaimAct(f.desk, f.claim.id, 'notify', { on: '2026-10-21', insurerRef: 'INS-2', how: 'Email' });
      return tx0(fn);
    };
    await expect(f.svc.saveRecord(f.desk, 'insuranceClaim', f.claim.id, 'co-sasa', { ...values, policyId: f.pol.id })).rejects.toThrow(/only through its steps/);
    expect((await f.store.get('insuranceClaims', f.claim.id))!.amountClaimed).toBe(3_000);
  });
});
