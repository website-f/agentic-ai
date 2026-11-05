import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, can, companiesRunBy, generateDataset, myt, officeTeam, runByCompanyId, withRunCompanies, type User } from '../src';

// Companies run by another company's office (Fauzan, 3 Nov 2026: a Company Manager also manages and monitors companies
// that sit under him, usually without a licence or without enough work of their own, and delegates their work to his
// staff). Fauzan, 3 Nov 07:42Z: "cos will set" (the CEO keeps the right as owner). A reason; one level only. Mock data only.
const TODAY = '2026-11-03';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00')) };
};
const ceo = (svc: PrimaService) => svc.user('u-fauzan');

describe('run links', () => {
  it('ignores a link to itself and a chain, so a company is run at most one level up', () => {
    const links = [
      { companyId: 'b', runByCompanyId: 'a' },
      { companyId: 'c', runByCompanyId: 'b' },
      { companyId: 'd', runByCompanyId: 'd' },
      { companyId: 'e', runByCompanyId: null },
    ];
    expect(runByCompanyId(links, 'b')).toBe('a');
    expect(runByCompanyId(links, 'c')).toBeNull();
    expect(runByCompanyId(links, 'd')).toBeNull();
    expect(runByCompanyId(links, 'e')).toBeNull();
    expect(companiesRunBy(links, ['a'])).toEqual(['b']);
    expect(companiesRunBy(links, ['b'])).toEqual([]);
  });

  it('adds run companies to office accounts only, never to branch managers, group staff or system feeds', () => {
    const links = [{ companyId: 'co-06', runByCompanyId: 'co-sasa' }];
    const base = { name: 'x', title: 'x', siteIds: [] };
    const cm: User = { ...base, id: 'cm', role: 'company_manager', companyIds: ['co-sasa'] };
    const ae: User = { ...base, id: 'ae', role: 'admin_exec', companyIds: ['co-sasa'] };
    const bm: User = { ...base, id: 'bm', role: 'admin_exec', companyIds: ['co-sasa'], branchId: 'br-1' };
    const feed: User = { ...base, id: 'f', role: 'company_manager', companyIds: ['co-sasa'], integration: true } as User;
    const sup: User = { ...base, id: 's', role: 'supervisor', companyIds: ['co-sasa'] };
    expect(withRunCompanies(cm, links).companyIds).toEqual(['co-sasa', 'co-06']);
    expect(withRunCompanies(ae, links).companyIds).toEqual(['co-sasa', 'co-06']);
    for (const u of [bm, feed, sup]) expect(withRunCompanies(u, links).companyIds).toEqual(['co-sasa']);
  });
});

describe('the Chief of Staff sets which office runs a company', () => {
  it('only the CEO, with a reason, one level, and audited', async () => {
    const { svc, ds } = fresh();
    const boss = await ceo(svc);
    for (const id of ['u-gm-sasa', 'u-cm-arsh', 'u-dcos'])
      await expect(svc.setCompanyRunBy(await svc.user(id), 'co-06', { runByCompanyId: 'co-sasa', reason: 'x' }), id).rejects.toThrow(/Not allowed/);
    // The Chief of Staff sets and ends it.
    const cos = await svc.user('u-cos');
    await svc.setCompanyRunBy(cos, 'co-07', { runByCompanyId: 'co-arsh', reason: 'Synthetic CoS decision' });
    expect(ds.audit.at(-1)).toEqual(expect.objectContaining({ action: 'office.runBy', actor: cos.name }));
    await svc.setCompanyRunBy(cos, 'co-07', { runByCompanyId: null, reason: 'Synthetic: ended' });
    await expect(svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: 'co-sasa', reason: '  ' })).rejects.toThrow(/reason/);
    await expect(svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: 'co-06', reason: 'x' })).rejects.toThrow(/own office/);
    await expect(svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: null, reason: 'x' })).rejects.toThrow(/Nothing changed/);
    await svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Board decision 3 Nov' });
    expect(ds.companyRunLinks.filter((l) => l.runByCompanyId)).toEqual([
      expect.objectContaining({ id: 'co-06', companyId: 'co-06', runByCompanyId: 'co-sasa', setById: 'u-fauzan' }),
    ]);
    expect(ds.audit.at(-1)).toEqual(expect.objectContaining({ action: 'office.runBy', companyId: 'co-06', actor: boss.name }));
    expect(ds.audit.at(-1)!.summary).toMatch(/its own office → .*Reason: Board decision 3 Nov/);
    // No chains: a run company cannot run another, and a company that runs others cannot itself be run.
    await expect(svc.setCompanyRunBy(boss, 'co-07', { runByCompanyId: 'co-06', reason: 'x' })).rejects.toThrow(/itself run by another office/);
    await expect(svc.setCompanyRunBy(boss, 'co-sasa', { runByCompanyId: 'co-arsh', reason: 'x' })).rejects.toThrow(/already runs other companies/);
    await expect(svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: 'co-sasa', reason: 'again' })).rejects.toThrow(/Nothing changed/);
    // Ending it goes back to the company's own office.
    await svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: null, reason: 'Licence granted' });
    expect(ds.companyRunLinks.find((l) => l.id === 'co-06')?.runByCompanyId).toBeNull();
    expect((await svc.user('u-gm-sasa')).companyIds).not.toContain('co-06');
  });
});

describe('the running office manages, monitors and delegates', () => {
  it('the GM heads the run company, shares its desks out to Sasa executives, and Sasa executives see it as their office', async () => {
    const { svc } = fresh();
    await svc.setCompanyRunBy(await ceo(svc), 'co-06', { runByCompanyId: 'co-sasa', reason: 'No licence; Sasa manages' });
    const gm = await svc.user('u-gm-sasa');
    expect(gm.companyIds).toContain('co-06');
    const o = await svc.companyOffice(gm, 'co-06');
    expect(o.role).toBe('head');
    expect(o.canAssign).toBe(true);
    expect(o.runBy).toEqual({ id: 'co-sasa', name: expect.any(String) });
    expect(o.team.find((t) => t.userId === 'u-gm-sasa')?.from).toBeTruthy();
    expect(o.team.map((t) => t.userId)).toEqual(expect.arrayContaining(['u-ae-sasa', 'u-ae-sasa-2', 'u-ae-sasa-3']));
    // Branch managers stay with their branches.
    expect(o.team.map((t) => t.userId)).not.toContain('u-bm-sasa-1');
    // Delegation: a Sasa executive owns a desk of the run company, another backs it up.
    await svc.setOfficeDesks(gm, 'co-06', { desks: [{ desk: 'licences', ownerUserId: 'u-ae-sasa', backupUserId: 'u-ae-sasa-2' }] });
    const ae = await svc.user('u-ae-sasa');
    expect(ae.companyIds).toContain('co-06');
    const seen = await svc.companyOffice(ae, 'co-06');
    expect(seen.role).toBe('exec');
    expect(seen.desks.find((d) => d.desk === 'licences')?.ownerUserId).toBe('u-ae-sasa');
    // The running office's own page lists the company it also runs, with the KDN licence as a fact only.
    const home = await svc.companyOffice(gm, 'co-sasa');
    expect(home.runs.map((r) => r.id)).toEqual(['co-06']);
    expect(['held', 'expired', 'unknown']).toContain(home.runs[0].kdnLicence);
    // Another company's executive is still kept out.
    await expect(svc.companyOffice(await svc.user('u-ae-arsh'), 'co-06')).rejects.toThrow();
  });

  it("a run company's own Company Manager works beside the running office's head", async () => {
    const { svc, ds } = fresh();
    await svc.setCompanyRunBy(await ceo(svc), 'co-inas', { runByCompanyId: 'co-arsh', reason: 'Not enough projects of its own' });
    const t = officeTeam(ds.users, 'co-inas', TODAY, ds.companyRunLinks);
    expect(t.heads.map((u) => u.id)).toEqual(['u-cm-arsh']);
    expect(t.besideHead.map((u) => u.id)).toContain('u-cm-inas');
    const own = await svc.companyOffice(await svc.user('u-cm-inas'), 'co-inas');
    expect(own.role).not.toBe('head');
    expect(own.team.find((x) => x.userId === 'u-cm-inas')?.job).toMatch(/under the .* office/);
    const lead = await svc.companyOffice(await svc.user('u-cm-arsh'), 'co-inas');
    expect(lead.role).toBe('head');
  });

  it('group leaders see who runs what on the consolidated page; executives are counted once', async () => {
    const { svc } = fresh();
    const boss = await ceo(svc);
    const before = await svc.companyOffices(boss);
    await svc.setCompanyRunBy(boss, 'co-06', { runByCompanyId: 'co-sasa', reason: 'Board decision' });
    const all = await svc.companyOffices(boss);
    expect(all.rows.find((r) => r.company.id === 'co-06')?.runBy?.id).toBe('co-sasa');
    expect(all.rows.find((r) => r.company.id === 'co-sasa')?.runs.map((r) => r.id)).toEqual(['co-06']);
    expect(all.totals.execs).toBe(before.totals.execs);
  });
});

// Arisha main review, 3 Nov 2026: the scope a running office gets over a run company is documented and tested.
// Intended (Fauzan, 3 Nov: "monitor and manage this also. And delegate staff to do the work"): exactly the same rights the
// person's own office role has in their own company, no more and no less, including HR (profiles, pay, leave) and
// commercial (prepare, approve) work. Nothing is added for the running company's other staff, branch managers or leaders.
const ACTIONS = [
  'view',
  'roster.edit',
  'roster.publish',
  'attendance.clock',
  'attendance.lock',
  'case.raise',
  'case.update',
  'case.close',
  'patrol.scan',
  'commercial.view',
  'commercial.prepare',
  'commercial.approve',
  'arms.view',
  'arms.handle',
  'hr.monitor',
  'ops.region',
  'site.patrol',
  'insurance.view',
  'cms.desk',
  'attendance.followup',
  'attendance.discipline',
  'site.visit',
  'hr.profile',
  'hr.pay',
  'leave.request',
  'leave.decide',
  'office.desks',
] as const;

describe('scope of a running office over a run company', () => {
  it('every permission on the run company equals the same person’s permission on their own company', async () => {
    const { svc, ds } = fresh();
    await svc.setCompanyRunBy(await svc.user('u-cos'), 'co-inas', { runByCompanyId: 'co-arsh', reason: 'Synthetic' });
    for (const id of ['u-cm-arsh', 'u-ae-arsh']) {
      const u = await svc.user(id);
      for (const a of ACTIONS) expect(can(u, ds.grants, TODAY, a, 'co-inas'), `${id} ${a}`).toBe(can(u, ds.grants, TODAY, a, 'co-arsh'));
    }
    // Before the link, and for a branch manager of the running company, nothing at all on the run company.
    const { svc: svc2, ds: ds2 } = fresh();
    for (const id of ['u-cm-arsh', 'u-ae-arsh']) {
      const u = await svc2.user(id);
      for (const a of ACTIONS) expect(can(u, ds2.grants, TODAY, a, 'co-inas'), `${id} ${a} before`).toBe(false);
    }
    const bm = await svc.user('u-bm-arsh-1');
    for (const a of ACTIONS) expect(can(bm, ds.grants, TODAY, a, 'co-inas'), `branch ${a}`).toBe(false);
  });

  it('HR: the running head and executives open the run company’s guard profiles with pay; nobody else of another company does', async () => {
    const { svc, ds } = fresh();
    const guard = ds.people.find((p) => p.companyId === 'co-inas' && p.role === 'guard')!;
    await expect(svc.guardProfile(await svc.user('u-cm-arsh'), guard.id)).rejects.toThrow(/Not allowed/);
    await svc.setCompanyRunBy(await svc.user('u-cos'), 'co-inas', { runByCompanyId: 'co-arsh', reason: 'Synthetic' });
    for (const id of ['u-cm-arsh', 'u-ae-arsh']) {
      const p = await svc.guardProfile(await svc.user(id), guard.id);
      expect((p as { benefits: unknown }).benefits, id).toBeTruthy();
    }
    await expect(svc.guardProfile(await svc.user('u-cm-sasa'), guard.id)).rejects.toThrow(/Not allowed/);
    await expect(svc.guardProfile(await svc.user('u-bm-arsh-1'), guard.id)).rejects.toThrow(/Not allowed/);
  });

  it('commercial: the running head may approve and executives may prepare for the run company, as in their own', async () => {
    const { svc, ds } = fresh();
    await svc.setCompanyRunBy(await svc.user('u-cos'), 'co-inas', { runByCompanyId: 'co-arsh', reason: 'Synthetic' });
    const head = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    expect(can(head, ds.grants, TODAY, 'commercial.approve', 'co-inas')).toBe(true);
    expect(can(ae, ds.grants, TODAY, 'commercial.prepare', 'co-inas')).toBe(true);
    expect(can(ae, ds.grants, TODAY, 'commercial.approve', 'co-inas')).toBe(false);
  });
});
