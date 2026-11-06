import { describe, expect, it } from 'vitest';
import { generateDataset, HrItIntakeService, ItManualService, MemoryStore, PrimaService } from '../src';

// P78: the owner (Prima's CEO record) is the master administrator of IT: they may enter records and start IT work.
// IT still does the work, and checks and approvals stay with someone else (maker-checker). Sample data only.
const now = '2026-11-01T03:00:00Z';
let n = 70000;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const proof = (k: string) => ({ kind: 'document' as const, name: `${k}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + k).toString('base64')}` });
const fresh = () => {
  const ds = generateDataset({ today: '2026-11-01', now });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => now) };
};

describe('the owner as master administrator of IT (P78)', () => {
  it('the board offers the owner the maker buttons, but not the IT Manager steps', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.itBoard(ceo);
    expect(b).toMatchObject({ role: 'view', assigner: false, canRaisePurchase: true, canLogTicket: true, canGiveJob: true, canAddTender: true });
    const coo = await svc.itBoard(await svc.user('u-coo'));
    expect(coo).toMatchObject({ canRaisePurchase: false, canLogTicket: false, canGiveJob: false, canAddTender: false });
  });

  it('the owner logs a help request and gives IT a job; IT works it and the IT Manager accepts it', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const t = await svc.itAct(ceo, 'logTicket', { raisedFor: 'Site supervisor Aman', channel: 'phone', category: 'DEVICE', priority: 'P2', title: 'Tablet will not charge', detail: '' });
    expect(t).toMatchObject({ raisedFor: 'Site supervisor Aman', status: 'open' });
    const job = (await svc.itAct(ceo, 'giveJob', { kind: 'task', title: 'Replace the site tablet charger', detail: '', priority: 'P2', technical: false, assigneeId: 'u-it-ex1', dueOn: '2026-11-03' })) as { id: string; givenById: string };
    expect(job.givenById).toBe('u-fauzan');
    expect(ds.audit.some((a) => a.entityId === job.id)).toBe(true);
    // Still only to IT doers, never to the owner themselves or the IT Manager.
    await expect(svc.itAct(ceo, 'giveJob', { kind: 'task', title: 'Own job', detail: '', priority: 'P3', technical: false, assigneeId: 'u-fauzan', dueOn: '2026-11-03' })).rejects.toThrow(/IT Lead or an IT Executive/);
  });

  it('the owner asks to buy; the IT Manager agrees the need, the COO approves, and the COO (not the CEO) decides the CEO step', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex2');
    const coo = await svc.user('u-coo');
    const p = await svc.raiseItPurchase(ceo, { ownerId: 'pwvsb', reason: 'Two laptops for the control room', items: [{ kind: 'LAPTOP', description: 'Laptop 14 inch', qty: 2, unitPrice: 2500 }] });
    expect(p).toMatchObject({ status: 'submitted', requestedById: 'u-fauzan' });
    // The owner cannot agree their own need; the IT Manager does.
    await expect(svc.itPurchaseStep(ceo, p.id, 'approve', { note: 'ok' })).rejects.toThrow();
    expect((await svc.itPurchaseStep(mgr, p.id, 'approve', { note: 'Needed for the control room' })).status).toBe('quoting');
    for (const [k, supplier] of [['a', 'Supplier A'], ['b', 'Supplier B'], ['c', 'Supplier C']] as const)
      await svc.itBuyStep(ex, p.id, 'quote', { supplier, amount: 5000 + (k === 'a' ? 0 : 100), proof: [proof(k)] });
    await svc.itBuyStep(ex, p.id, 'online', { source: 'Marketplace A', ref: 'https://market-a.example/laptop', amount: 5000, proof: [proof('online')] });
    expect((await svc.itBuyStep(ex, p.id, 'submit', { index: 0 })).status).toBe('coo');
    expect((await svc.itBuyStep(coo, p.id, 'decide', { decision: 'approve' })).status).toBe('ceo');
    // The CEO asked for it: neither the CEO in Prima nor a Teams screenshot naming the CEO may approve it.
    expect((await svc.itBoard(ceo)).purchases!.find((r) => r.purchase.id === p.id)!.canDecide).toBe(false);
    await expect(svc.itBuyStep(ceo, p.id, 'decide', { decision: 'approve' })).rejects.toThrow(/COO decides the CEO step/);
    await expect(svc.itBuyStep(ex, p.id, 'teams', { teamsRef: 'Approvals: laptops', proof: [proof('t')] })).rejects.toThrow(/COO decides the CEO step/);
    const row = (await svc.itBoard(coo)).purchases!.find((r) => r.purchase.id === p.id)!;
    expect(row).toMatchObject({ canDecide: true });
    const done = await svc.itBuyStep(coo, p.id, 'decide', { decision: 'approve', note: 'In the CEO’s place' });
    expect(done).toMatchObject({ status: 'finance', ceoStep: { by: coo.name, via: 'prima', decision: 'approve' } });
  });

  it('a purchase IT asks for still goes to the CEO as before', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex2');
    const p = await svc.raiseItPurchase(ex, { ownerId: 'pwvsb', reason: 'A printer for HR', items: [{ kind: 'PRINTER', description: 'Laser printer', qty: 1, unitPrice: 900 }] });
    const row = (await svc.itBoard(await svc.user('u-coo'))).purchases!.find((r) => r.purchase.id === p.id)!;
    expect(row.waitingOn).toBe('IT Manager');
  });

  it('the owner registers an existing device, system and joiner, naming the IT person', async () => {
    const { ds, store } = fresh();
    const s = new ItManualService(store, () => now);
    const ceo = ds.users.find((u) => u.id === 'u-fauzan')!;
    const b = await s.board(ceo);
    expect(b).toMatchObject({ canCreate: true, canCreateAsset: true, canCheck: false });
    expect(b.itStaff.length).toBeGreaterThan(0);
    const asset = await s.create(ceo, 'asset', { requestId: uuid(), tag: 'OWN-001', serial: 'SER-OWN-001', kind: 'LAPTOP', model: 'Owner laptop', companyId: null, unitLabel: 'Head office', location: 'CEO office', boughtOn: null, warrantyTo: null });
    expect(asset.terminal).toBe('committed');
    const system = await s.create(ceo, 'system', { requestId: uuid(), name: 'Company registrar account', kind: 'registrar', companyId: null, unitLabel: 'Group', note: 'Recorded by the owner' });
    expect(system.terminal).toBe('committed');
    const intake = await s.create(ceo, 'intake', { requestId: uuid(), kind: 'join', personUserId: null, personName: 'New Executive', jobTitle: 'Admin executive', companyId: null, unitLabel: 'Head office', on: '2026-11-05', ownerStaffId: 'u-it-ex1' });
    expect(intake.terminal).toBe('committed');
    expect(ds.itOnboarding.find((o) => o.id === intake.recordId)?.ownerStaffId).toBe('u-it-ex1');
    // Guidance evidence is IT's work, not the owner's.
    const g = await s.create(ceo, 'guidance', { requestId: uuid(), name: 'HR SharePoint site', companyId: null, unitLabel: 'HR', siteOwnerUserId: null, itResponsibleId: 'u-it-ex1', url: null, nextReviewOn: null, jobId: null, note: 'Set up the HR library' });
    await expect(s.updateGuidance(ceo, { id: g.recordId, expectedVersion: 1, requestId: uuid(), state: 'guidance_given', evidence: 'Screenshot', note: 'Done here', nextReviewOn: null })).rejects.toThrow(/only authorized IT/);
    // The COO still only reads.
    expect(await s.board(ds.users.find((u) => u.id === 'u-coo')!)).toMatchObject({ canCreate: false, canCreateAsset: false });
  });

  it('the owner adds a domain and a website; others outside IT still cannot', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const company = ds.companies[0].id;
    const d = (await svc.websites.act(ceo, 'saveDomain', { name: 'owner-added.com.my', companyIds: [company], expiresOn: '2027-06-01' })) as { id: string };
    expect(ds.webDomains.some((x) => x.id === d.id)).toBe(true);
    const site = (await svc.websites.act(ceo, 'saveSite', { name: 'Owner site', companyId: company, url: 'https://owner-added.com.my', domainIds: [d.id] })) as { id: string };
    expect(ds.webSites.some((x) => x.id === site.id)).toBe(true);
    const board = (await svc.websites.board(ceo)) as { domains: { domain: { id: string }; canEdit: boolean }[] };
    expect(board.domains.find((x) => x.domain.id === d.id)?.canEdit).toBe(true);
    await expect(svc.websites.act(await svc.user('u-coo'), 'saveDomain', { name: 'coo-added.com.my', companyIds: [company] })).rejects.toThrow(/IT Head, the CEO/);
  });

  it('the owner prepares an HR/IT joining request for any company; someone else reviews it', async () => {
    const { ds, store } = fresh();
    store.hrItTrustedTenant = () => '11111111-1111-4111-8111-111111111111';
    const s = new HrItIntakeService(store, () => now);
    const ceo = ds.users.find((u) => u.id === 'u-fauzan')!;
    const b = await s.board(ceo);
    expect(b.capabilities.canCreate).toBe(true);
    const subject = b.subjects.find((x) => x.kind === 'hr_person');
    expect(subject).toBeTruthy();
    const r = await s.save(ceo, 'request', { operationId: uuid(), workflow: 'onboard', subject: { kind: subject!.kind, id: subject!.id }, companyId: subject!.companyId, proposedRole: 'guard', startOn: '2026-11-03', reason: 'New guard joining' });
    expect(r).toMatchObject({ terminal: 'committed' });
    const row = ds.hrItRequests.find((x) => x.createdById === 'u-fauzan')!;
    expect(row).toBeTruthy();
    // The owner cannot review their own request.
    const mine = (await s.board(ceo)).requests.find((x) => x.id === row.id)!;
    expect(mine.can).toMatchObject({ edit: true, submit: true, approveCos: false, approveHead: false, reviewHandoff: false });
  });
});
