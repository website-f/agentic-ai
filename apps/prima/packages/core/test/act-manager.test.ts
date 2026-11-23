import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, lineManagerOf, myt } from '../src';

// C6 (Fauzan, 11 Nov 2026): ACT Director, ACT Manager (leads the work, second checker), Team A and Team B each with an
// Auditor and an Enforcement officer. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // The demo data now carries the ACT Manager (u-act-mgr), under the ACT Director (Fauzan, 23 Nov 2026).
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};

async function fixedFinding(svc: PrimaService, severity: 'medium' | 'high') {
  const enf = await svc.user('u-act-enf1');
  const cm = await svc.user('u-cm-arsh');
  const f = await svc.raiseActFinding(enf, { companyId: 'co-arsh', area: 'ARMS', source: 'workflow_audit', title: 'Key log gap', detail: '', severity, evidence: 'Synthetic log pages', ownerUserId: cm.id });
  await svc.actFindingStep(cm, f.id, 'plan', { rootCause: 'No second signer', solution: 'Two signatures', targetOn: '2026-11-20' });
  await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'Synthetic log with two signatures' });
  return f;
}

describe('C6: the ACT Manager second-checks', () => {
  it("closes a finding only after the Auditor's check and the ACT Manager's second check", async () => {
    const { svc } = fresh();
    const aud = await svc.user('u-act-aud1');
    const mgr = await svc.user('u-act-mgr');
    const f = await fixedFinding(svc, 'medium');
    const first = await svc.actFindingStep(aud, f.id, 'check', { ok: true, note: 'Seen the log' });
    expect(first.status).toBe('fixed');
    expect(first.firstCheck!.byId).toBe(aud.id);
    // The Auditor cannot do the second check too; the other team's Auditor cannot act on it.
    await expect(svc.actFindingStep(aud, f.id, 'check', { ok: true, note: 'Again' })).rejects.toThrow(/ACT Manager second-checks/);
    await expect(svc.actFindingStep(await svc.user('u-act-aud2'), f.id, 'check', { ok: true, note: 'x' })).rejects.toThrow(/Team 1/);
    // The Manager sees it on Home and closes it.
    const board = await svc.actBoard(mgr);
    expect(board.job).toBe('manager');
    expect(board.canCheck).toBe(true);
    expect(board.structure!.manager?.id).toBe(mgr.id);
    const closed = await svc.actFindingStep(mgr, f.id, 'check', { ok: true, note: 'Second check: log matches' });
    expect(closed.status).toBe('closed');
  });

  it('never lets the ACT Manager second-check their own check, and a failed check clears the first check', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-act-mgr');
    const f = await fixedFinding(svc, 'medium');
    const first = await svc.actFindingStep(mgr, f.id, 'check', { ok: true, note: 'Seen' });
    expect(first.status).toBe('fixed');
    await expect(svc.actFindingStep(mgr, f.id, 'check', { ok: true, note: 'Again' })).rejects.toThrow(/own check/);
    const back = await svc.actFindingStep(mgr, f.id, 'check', { ok: false, note: 'One page unsigned' });
    expect(back.status).toBe('planned');
    expect(back.firstCheck).toBeNull();
  });

  it('keeps a high finding for the ACT Director', async () => {
    const { svc } = fresh();
    const f = await fixedFinding(svc, 'high');
    await svc.actFindingStep(await svc.user('u-act-aud1'), f.id, 'check', { ok: true, note: 'Seen' });
    await expect(svc.actFindingStep(await svc.user('u-act-mgr'), f.id, 'check', { ok: true, note: 'x' })).rejects.toThrow(/Director/);
    expect((await svc.actFindingStep(await svc.user('u-audit'), f.id, 'check', { ok: true, note: 'Closed by the Director' })).status).toBe('closed');
  });
});

describe('ACT reporting line (Fauzan, 23 Nov 2026)', () => {
  it('has the ACT Director lead the department and the ACT Manager report to the ACT Director', async () => {
    const { ds } = fresh();
    const mgr = ds.users.find((u) => u.id === 'u-act-mgr')!;
    const dir = ds.users.find((u) => u.id === 'u-audit')!;
    expect(lineManagerOf(mgr, ds.users).manager?.id).toBe('u-audit');
    expect(lineManagerOf(dir, ds.users).manager?.opsTier).toBe('ceo');
  });
});
