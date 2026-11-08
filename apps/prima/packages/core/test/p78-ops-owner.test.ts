import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

// P78 (Agentic Office): on the Operations screens the owner (Prima's CEO record) enters what the company enters: signed
// contracts and their mobilisation, new clients, roster shifts, cases and branches, for any company he sees. Approvals,
// closing a case and locking attendance stay with their own people. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const PILOTS = ['co-sasa', 'co-arsh', 'co-inas'];

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // Only the pilot companies have sites in the mock data: make Inas one where the owner holds a monitoring grant only,
  // as for a company outside the pilot.
  for (const g of ds.grants) if (g.userId === 'u-fauzan' && g.companyId === 'co-inas') g.scope = 'monitor';
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const other = ds.companies.find((c) => c.id === 'co-inas')!;
  return { ds, svc, other };
}

describe('P78 owner on the Operations screens', () => {
  it('records a signed contract for any company and runs its mobilisation; a company manager still cannot for another company', async () => {
    const { ds, svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const board = await svc.contracts(owner);
    expect(board.canAdd.map((c) => c.companyId)).toEqual(expect.arrayContaining(PILOTS));
    const site = ds.sites.find((s) => s.companyId === 'co-arsh')!;
    const input = {
      companyId: 'co-arsh',
      clientAccountId: null,
      clientName: 'Synthetic Mall Bhd',
      siteIds: [site.id],
      startOn: addDays(TODAY, 30),
      endOn: addDays(TODAY, 395),
      billingMethod: 'M1' as const,
      rate: 9.5,
      fixedFee: null,
      signedRef: 'LOA/P78/1',
      proof: [{ kind: 'document' as const, name: 'signed-contract.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 Synthetic signed contract').toString('base64')}` }],
    };
    const c = await svc.addContract(owner, input);
    expect(c.state).toBe('awarded');
    const moved = await svc.contractStep(owner, c.id, 'mobilise');
    expect(moved.state).toBe('mobilising');
    // The signed copy already ticks its own item; the owner records the next open item, with proof.
    const item = moved.mobilisation.find((i) => i.status === 'open' && !i.auto && i.check !== 'cms_activation')!;
    expect((await svc.setMobItem(owner, c.id, item.id, 'done', '', null, [{ kind: 'document', name: 'mobilisation-step.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 Mobilisation step').toString('base64')}` }])).mobilisation.find((i) => i.id === item.id)!.status).toBe('done');
    const cmSasa = await svc.user('u-cm-sasa');
    await expect(svc.addContract(cmSasa, { ...input, signedRef: 'LOA/P78/2' })).rejects.toBeInstanceOf(AccessDenied);
    const audit = await svc['store'].list('audit', {});
    expect(audit.some((a) => a.action === 'contract.add' && a.actor === owner.name)).toBe(true);
  });

  it('opens a new client for any company, with or without its sites', async () => {
    const { svc, other } = fresh();
    const owner = await svc.user('u-fauzan');
    const board = await svc.clientBoard(owner);
    expect(board.canAdd.length).toBeGreaterThan(0);
    const acct = await svc.addClientAccount(owner, { companyId: other!.id, name: 'Synthetic Hospital Bhd', siteIds: [], contractEndsOn: null });
    expect(acct.stage).toBe('onboarding');
  });

  it('adds roster shifts from the post pattern, once only, for a company outside the pilot; a guard cannot', async () => {
    const { ds, svc, other } = fresh();
    const owner = await svc.user('u-fauzan');
    const post = ds.posts.find((p) => p.companyId === other!.id)!;
    const from = addDays(TODAY, 40);
    const before = (await svc.roster(owner, post.siteId, from, 3)).shifts.length;
    const r = await svc.addShifts(owner, post.siteId, { postId: post.id, from, days: 3 });
    const perDay = ({ A: 2, B: 3, C: 1, D: 1, E: 1 } as const)[post.shiftStructure];
    expect(r.added).toBeLessThanOrEqual(3 * perDay * post.guardsPerShift);
    expect(r.added).toBeGreaterThan(0);
    const after = await svc.roster(owner, post.siteId, from, 3);
    expect(after.shifts.length).toBe(before + r.added);
    expect(after.canEdit).toBe(true);
    const fresh1 = after.shifts.filter((s) => !s.personId && s.status === 'draft');
    expect(fresh1.length).toBeGreaterThanOrEqual(r.added);
    // Adding the same days again adds nothing.
    await expect(svc.addShifts(owner, post.siteId, { postId: post.id, from, days: 3 })).rejects.toThrow(/already on the roster/);
    // Own times, one extra guard.
    const extra = await svc.addShifts(owner, post.siteId, { postId: post.id, from, days: 1, start: '09:00', end: '18:00', guards: 1 });
    expect(extra.added).toBe(1);
    await expect(svc.addShifts(owner, post.siteId, { postId: post.id, from: addDays(TODAY, -1), days: 1 })).rejects.toThrow(/today onwards/);
    await expect(svc.addShifts(owner, post.siteId, { postId: post.id, from, days: 1, start: '25:00', end: '07:00' })).rejects.toThrow(/HH:MM/);
    const audit = await svc['store'].list('audit', {});
    expect(audit.filter((a) => a.action === 'roster.add').length).toBe(2);
    const ae = await svc.user('u-ae-arsh');
    await expect(svc.addShifts(ae, post.siteId, { postId: post.id, from, days: 1 })).rejects.toThrow();
  });

  it('raises a case for a company outside the pilot but does not close it', async () => {
    const { ds, svc, other } = fresh();
    const owner = await svc.user('u-fauzan');
    const site = ds.sites.find((s) => s.companyId === other!.id)!;
    const proof = [{ kind: 'document' as const, name: 'Report.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 report').toString('base64')}` }];
    const c = await svc.raiseCase(owner, {
      companyId: other!.id,
      siteId: site.id,
      type: 'COMPLAINT',
      severity: 'P3',
      title: 'Client complaint about the gate',
      description: 'Synthetic.',
      proof,
    });
    expect(c.companyId).toBe(other!.id);
    await expect(svc.updateCase(owner, c.id, 'close', 'done')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('proposes a branch as company staff do; approving settlements stays with the company manager', async () => {
    const { svc } = fresh();
    const owner = await svc.user('u-fauzan');
    const board = await svc.branchBoard(owner);
    expect(board.canAdd.length).toBeGreaterThan(0);
    const b = await svc.addBranch(owner, board.canAdd[0].id, { name: 'Synthetic Kuantan', state: 'Pahang', model: 'A' });
    expect(b.status).toBe('proposed');
  });
});
