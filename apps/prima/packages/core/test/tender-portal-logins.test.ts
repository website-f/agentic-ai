// Tender portal logins on the shared login list (Marketing item AH10; Fauzan 23 Nov 2026: "use the shared login
// list", no separate store). Synthetic data only; Prima never holds a password.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, unitHeadsOf } from '../src';

const DAY = '2026-11-23';
function setup() {
  const ds = generateDataset({ today: DAY, now: myt(DAY, '09:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(DAY, '09:00'));
  const covers = (id: string) => ds.grants.some((g) => g.userId === id && g.companyId === 'co-sasa' && g.validFrom <= DAY && g.validTo >= DAY);
  const own = ds.users.find((u) => u.marketingRole === 'executive' && covers(u.id))!;
  const other = ds.users.find((u) => u.marketingRole === 'executive' && !covers(u.id))!;
  const t = ds.tenders.find((x) => x.companyId === 'co-sasa')!;
  t.desk = 'MARKETING';
  t.status = 'preparing';
  return { ds, svc, own, other, t };
}
const eperolehan = (userIds: string[]) => ({
  system: 'ePerolehan (synthetic)',
  kind: 'eperolehan',
  url: 'https://eperolehan.example.test/login',
  companyId: 'co-sasa',
  place: 'vault',
  ownerId: 'u-cm-sasa',
  backupId: 'u-ae-sasa',
  userIds,
  lastChanged: '2026-11-01',
  note: 'Digital certificate on the company token',
});

describe('Tender portal logins (AH10)', () => {
  it('the bid shows the company tender login to the executive named on it, never a password', async () => {
    const { svc, own, other, t } = setup();
    const it = await svc.user('u-it-lead');
    // Before any login is listed, IT sees that the executive covering Sasa is not named on a tender login.
    const before = (await svc.sharedLogins.board(it)).coverage.find((c) => c.key === 'c:co-sasa')!;
    expect(before.tenderLogins).toBe(0);
    expect(before.tenderStaffNotNamed).toContain(own.name);
    expect((await svc.tenderPortalLogins(own, t.id)).logins).toEqual([]);

    await svc.sharedLogins.save(it, eperolehan([]));
    // Listed, but the executive is not on it: they cannot see it, and IT is told who to add.
    expect((await svc.tenderPortalLogins(own, t.id)).logins).toEqual([]);
    expect((await svc.sharedLogins.board(it)).coverage.find((c) => c.key === 'c:co-sasa')!.tenderStaffNotNamed).toContain(own.name);

    const row = (await svc.sharedLogins.board(it)).rows[0];
    await svc.sharedLogins.save(it, { ...eperolehan([own.id]), id: row.id });
    const got = await svc.tenderPortalLogins(own, t.id);
    expect(got.logins).toHaveLength(1);
    expect(got.logins[0]).toMatchObject({ system: 'ePerolehan (synthetic)', placeLabel: 'Password vault', owner: expect.any(String), named: true });
    expect(got.namedOnAll).toBe(true);
    expect(JSON.stringify(got)).not.toMatch(/password"|secret|token"/i);
    expect((await svc.sharedLogins.board(it)).coverage.find((c) => c.key === 'c:co-sasa')!.tenderStaffNotNamed).not.toContain(own.name);
    // An executive who does not cover the company cannot ask.
    await expect(svc.tenderPortalLogins(other, t.id)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('the Marketing Manager and Deputy head Marketing for its department logins', async () => {
    const { svc } = setup();
    expect(unitHeadsOf(await svc.user('u-mkt-mgr'))).toContain('d_marketing');
    expect(unitHeadsOf(await svc.user('u-mkt-dep'))).toContain('d_marketing');
    const it = await svc.user('u-it-lead');
    await svc.sharedLogins.save(it, { system: 'Tender news subscription (synthetic)', kind: 'other', url: null, department: 'marketing', place: 'microsoft_tile', ownerId: 'u-mkt-dep', backupId: 'u-it-lead', userIds: [], lastChanged: '2026-11-01', note: '' });
    expect((await svc.sharedLogins.board(await svc.user('u-mkt-mgr'))).rows).toHaveLength(1);
  });
});
