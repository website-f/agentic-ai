// Guard training and legal papers (Fauzan, 2 Nov 2026): HR and the guard's company head see and keep CSG, the KDN
// card, eSIMS vetting and TNG. Mock data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const svc = new PrimaService(new MemoryStore(ds), () => new Date((t += 1000)).toISOString());
  return { ds, svc };
}

describe('Guard training and legal papers', () => {
  it('shows HR every company and the company head only their own', async () => {
    const { svc } = fresh();
    const hr = await svc.guardTraining(await svc.user('u-pwvsb-hr'));
    expect(new Set(hr.summary.map((s) => s.companyId)).size).toBeGreaterThan(1);
    expect(hr.summary.every((s) => s.canManage)).toBe(true);
    const cm = await svc.guardTraining(await svc.user('u-cm-sasa'));
    expect(cm.summary.map((s) => s.companyId)).toEqual(['co-sasa']);
    const fd = await svc.guardTraining(await svc.user('u-fd'));
    expect(fd.summary.some((s) => s.canManage)).toBe(false);
    await expect(svc.guardTraining(await svc.user('u-it-ex3'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets HR and the guard’s own company head record CSG, which clears the block', async () => {
    const { svc, ds } = fresh();
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active')!;
    g.hiredOn = addDays(TODAY, -400);
    ds.credentials = ds.credentials.filter((c) => !(c.personId === g.id && c.type === 'CSG_TRAINING'));
    const row = async () => (await svc.guardTraining(await svc.user('u-pwvsb-hr'))).rows.find((r) => r.personId === g.id)!;
    expect((await row()).csg.status).toBe('OVERDUE');
    await expect(
      svc.recordGuardPaper(await svc.user('u-cm-arsh'), { personId: g.id, type: 'CSG_TRAINING', number: 'CSG-1234', issuedOn: TODAY, expiresOn: null }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.recordGuardPaper(await svc.user('u-cm-sasa'), { personId: g.id, type: 'FIREARM_PERMIT', number: 'FP-1', issuedOn: TODAY, expiresOn: addDays(TODAY, 365) }),
    ).rejects.toThrow(/Arms Control/);
    await expect(
      svc.recordGuardPaper(await svc.user('u-fd'), { personId: g.id, type: 'CSG_TRAINING', number: 'CSG-1234', issuedOn: TODAY, expiresOn: null }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const c = await svc.recordGuardPaper(await svc.user('u-cm-sasa'), { personId: g.id, type: 'CSG_TRAINING', number: 'CSG-1234', issuedOn: TODAY, expiresOn: null });
    expect(c.recordedBy).toBeTruthy();
    expect((await row()).csg.level).toBe('ok');
    await expect(
      svc.recordGuardPaper(await svc.user('u-pwvsb-hr'), { personId: g.id, type: 'KDN_GUARD_CARD', number: 'KDN-9', issuedOn: TODAY, expiresOn: null }),
    ).rejects.toThrow(/expiry/);
    await svc.recordGuardPaper(await svc.user('u-pwvsb-hr'), { personId: g.id, type: 'KDN_GUARD_CARD', number: 'KDN-9', issuedOn: TODAY, expiresOn: addDays(TODAY, 730) });
    expect((await row()).kdn.level).toBe('ok');
  });

  it('lets Operations see and keep the papers of the guards they cover: the OM their states, the Operations Director all', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const b = await svc.guardTraining(om);
    expect(b.rows.length).toBeGreaterThan(0);
    const states = new Set(om.areaStates);
    const branchState = new Map(ds.branches.map((x) => [x.id, x.state]));
    expect(b.rows.every((r) => states.has(branchState.get(ds.people.find((p) => p.id === r.personId)!.branchId) ?? ''))).toBe(true);
    const outside = ds.people.find((p) => p.role === 'guard' && p.status === 'active' && !states.has(branchState.get(p.branchId) ?? ''))!;
    await expect(
      svc.recordGuardPaper(om, { personId: outside.id, type: 'CSG_TRAINING', number: 'CSG-OUT', issuedOn: TODAY, expiresOn: null }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const inside = ds.people.find((p) => p.id === b.rows[0].personId)!;
    await svc.recordGuardPaper(om, { personId: inside.id, type: 'CSG_TRAINING', number: 'CSG-IN', issuedOn: TODAY, expiresOn: null });
    await svc.recordTraining(om, { personId: inside.id, course: 'Patrol refresher', provider: 'In-house', from: TODAY, to: TODAY, hours: 4, cost: null, hrdRef: null, certificateRef: null });
    expect((await svc.trainingRecords(om)).rows.some((r) => r.personId === inside.id)).toBe(true);
    const od = await svc.guardTraining(await svc.user('u-opsdir'));
    expect(od.total).toBeGreaterThan(b.total);
    expect(od.summary.every((x) => x.canManage)).toBe(true);
  });

  it('lets the company head record a guard’s other course, but not office staff training', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active')!;
    await svc.recordTraining(cm, { personId: g.id, course: 'CCTV operator', provider: 'In-house', from: TODAY, to: TODAY, hours: 8, cost: null, hrdRef: null, certificateRef: null });
    expect((await svc.trainingRecords(cm)).rows.some((r) => r.personId === g.id)).toBe(true);
    const office = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office' && p.status === 'active');
    if (office)
      await expect(
        svc.recordTraining(cm, { personId: office.id, course: 'Excel', provider: '', from: TODAY, to: TODAY, hours: 4, cost: null, hrdRef: null, certificateRef: null }),
      ).rejects.toBeInstanceOf(AccessDenied);
  });
});
