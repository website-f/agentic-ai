import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, generateDataset, guardUserId, myt } from '../src';

// J5 (Fauzan, 11 Nov 2026): guard sign-ins made in bulk with a review step; location readings kept 90 days (G9).
// Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.length === 1)!;
  const companyId = cm.companyIds[0];
  const admin = ds.users.find((u) => u.role === 'admin_exec' && u.companyIds.includes(companyId));
  return { ds, store, svc, companyId, cm: await svc.user(cm.id), admin: admin ? await svc.user(admin.id) : null, hr: await svc.user('u-pwvsb-hr') };
}

describe('J5 guard sign-ins in bulk', () => {
  it('is prepared by one person, approved by another with a comment, and makes one sign-in per guard', async () => {
    const { ds, store, svc, companyId, cm, admin, hr } = await setup();
    const maker = admin ?? hr;
    const board = await svc.guardSignInBoard(maker, companyId);
    expect(board.candidates.length).toBeGreaterThan(1);
    const pick = board.candidates.slice(0, 3).map((c) => c.personId);
    const b = await svc.prepareGuardSignIns(maker, companyId, pick, 'Synthetic first batch');
    expect(b).toMatchObject({ status: 'prepared', rows: expect.any(Array) });
    // The same guards cannot go in a second waiting batch; nobody approves their own; a comment is needed.
    await expect(svc.prepareGuardSignIns(maker, companyId, pick.slice(0, 1), '')).rejects.toThrow(/already in a batch/);
    await expect(svc.decideGuardSignIns(maker, b.id, true, 'Mine')).rejects.toBeInstanceOf(AccessDenied);
    const approver = maker.id === cm.id ? hr : cm;
    await expect(svc.decideGuardSignIns(approver, b.id, true, '')).rejects.toThrow(/comment/);
    const done = await svc.decideGuardSignIns(approver, b.id, true, 'Checked against the guard list');
    expect(done).toMatchObject({ status: 'created', created: { count: 3, skipped: [] } });
    for (const id of pick) {
      const u = await store.get('users', guardUserId(id));
      expect(u).toMatchObject({ role: 'guard', companyIds: [companyId], personId: id, siteIds: [] });
      expect(u?.department).toBeUndefined();
    }
    // They are no longer candidates; a guard who left is refused.
    expect((await svc.guardSignInBoard(maker, companyId)).candidates.some((c) => pick.includes(c.personId))).toBe(false);
    const gone = ds.people.find((p) => p.companyId === companyId && p.role === 'guard' && p.status !== 'active');
    if (gone) await expect(svc.prepareGuardSignIns(maker, companyId, [gone.id], '')).rejects.toThrow(/not active guards/);
    const audit = (await store.list('audit', {})).filter((a) => a.action.startsWith('guard.signins'));
    expect(audit.map((a) => a.action)).toEqual(['guard.signins.prepare', 'guard.signins.create']);
  });

  it('returns and cancels with a reason, and refuses the wrong roles', async () => {
    const { ds, svc, companyId, cm, admin, hr } = await setup();
    const maker = admin ?? hr;
    const c = (await svc.guardSignInBoard(maker, companyId)).candidates;
    const b = await svc.prepareGuardSignIns(maker, companyId, [c[0].personId], '');
    const approver = maker.id === cm.id ? hr : cm;
    expect(await svc.decideGuardSignIns(approver, b.id, false, 'Wait for the JA list')).toMatchObject({ status: 'returned' });
    const b2 = await svc.prepareGuardSignIns(maker, companyId, [c[0].personId], '');
    await expect(svc.cancelGuardSignIns(maker, b2.id, '')).rejects.toThrow(/reason/);
    expect(await svc.cancelGuardSignIns(maker, b2.id, 'Prepared by mistake')).toMatchObject({ status: 'cancelled' });
    // A guard, a supervisor, another company's manager and the Transport head cannot prepare or approve.
    const guard = await svc.user(ds.users.find((u) => u.role === 'guard')!.id);
    const otherCm = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(companyId));
    for (const u of [guard, await svc.user('u-transport'), ...(otherCm ? [await svc.user(otherCm.id)] : [])]) {
      await expect(svc.prepareGuardSignIns(u, companyId, [c[1].personId], '')).rejects.toBeInstanceOf(AccessDenied);
    }
    const b3 = await svc.prepareGuardSignIns(maker, companyId, [c[1].personId], '');
    await expect(svc.decideGuardSignIns(guard, b3.id, true, 'No')).rejects.toBeInstanceOf(AccessDenied);
    if (admin && admin.id !== maker.id) await expect(svc.decideGuardSignIns(admin, b3.id, true, 'No')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('keeps location readings 90 days (G9, now Policy)', () => {
    expect(RULES.staffTrackKeepDays.value).toBe(90);
    expect(RULES.staffTrackKeepDays.label).toBe('Policy');
    expect(RULES.guardPhone.value.keepPingsDays).toBe(90);
  });
});
