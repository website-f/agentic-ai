// IT department gaps (Fauzan, 23 Nov 2026: "Do the gap"). Made-up staff, devices and requests only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, generateDataset, itFromHr, myt } from '../src';

const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, as: (id: string) => svc.user(id) };
}

describe('B1 leaver handed to IT', () => {
  it('a leaver HR closed shows on From HR with the devices still held, on Do today, and IT links the leaver checklist', async () => {
    const { ds, svc, as } = setup();
    const leaver = ds.users.find((u) => u.personId && u.role === 'pwvsb_officer' && u.department === 'finance' && !u.integration && !u.leadership)!;
    const asset = ds.itAssets.find((a) => a.status === 'in_use')!;
    asset.assignedTo = leaver.name;
    const hr = ds.users.find((u) => u.role === 'pwvsb_officer' && u.department === 'hr' && !u.integration)!;
    await svc.closeAccess(hr, leaver.id, { from: TODAY, reason: 'Resigned (mock)' });

    const mgr = await as('u-it-mgr');
    const board = await svc.itBoard(mgr);
    const row = board.fromHr!.find((r) => r.userId === leaver.id)!;
    expect(row.kind).toBe('leave');
    expect(row.devices.map((d) => d.tag)).toContain(asset.tag);
    expect(row.checklist).toBeNull();
    expect(row.todo.join(' ')).toMatch(/collect 1 device/);

    const home = await svc.itPolicies.homeItems(mgr);
    expect(home.some((h) => h.tag === 'Leaver' && h.detail.includes(leaver.name))).toBe(true);

    // IT starts the leaver checklist for the closed account (an open-only pick would refuse it).
    await svc.itAct(mgr, 'createIntake', {
      requestId: uuid(1), kind: 'leave', personUserId: leaver.id, personName: leaver.name, jobTitle: leaver.title ?? 'Staff', companyId: null, unitLabel: 'Finance', on: TODAY, ownerStaffId: mgr.id,
    });
    const after = (await svc.itBoard(mgr)).fromHr!.find((r) => r.userId === leaver.id)!;
    expect(after.checklist).toEqual(expect.objectContaining({ done: 0, total: 5 }));
    // A joining checklist still refuses a closed account.
    const join = (await svc.itAct(mgr, 'createIntake', { requestId: uuid(2), kind: 'join', personUserId: leaver.id, personName: leaver.name, jobTitle: 'Staff', companyId: null, unitLabel: 'Finance', on: TODAY, ownerStaffId: mgr.id })) as { terminal: string; message: string };
    expect(join.terminal).toBe('rejected');
    expect(join.message).toMatch(/currently available/);
  });

  it('a leaver drops off once the checklist is done and no device is held', () => {
    const users = [{ id: 'u1', name: 'Staff One (mock)', role: 'pwvsb_officer', companyIds: [], accessClosedFrom: '2026-11-20' }] as never;
    const steps = Array.from({ length: 5 }, (_, k) => ({ key: `s${k}`, label: 's', doneAt: NOW, by: 'IT' }));
    const onboarding = [{ id: 'o1', kind: 'leave', personName: 'x', jobTitle: 'x', ownerId: 'unlinked', on: TODAY, steps, manual: { personUserId: 'u1', createdAt: NOW } }] as never;
    expect(itFromHr({ users, accountRequests: [], onboarding, assets: [], policyRecs: [], today: TODAY })).toEqual([]);
    const assets = [{ id: 'a1', tag: 'MN-1', kind: 'LAPTOP', model: 'm', status: 'in_use', assignedTo: 'Staff One (mock)' }] as never;
    expect(itFromHr({ users, accountRequests: [], onboarding, assets, policyRecs: [], today: TODAY })[0].todo).toEqual(['collect 1 device']);
  });
});

describe('D1 one door for a new joiner', () => {
  it('an account approved in Accounts and Access shows for IT and counts as the Microsoft 365 approval, once', async () => {
    const { ds, svc, as } = setup();
    const itLead = await as('u-it-lead');
    const line = { op: 'create', template: 'admin_exec', name: 'Joiner binti Test', title: 'Admin Executive', companyId: 'co-arsh' };
    const r = await svc.accounts.submit(itLead, { items: [line], reason: 'Starts 1 Dec (mock)' });
    await svc.accounts.decide(await as('u-cos'), { requestId: r.id, approve: true, comment: 'Checked against the offer letter.' });
    const joiner = ds.users.find((u) => u.name === 'Joiner binti Test')!;

    const mgr = await as('u-it-mgr');
    const row = (await svc.itBoard(mgr)).fromHr!.find((x) => x.userId === joiner.id)!;
    expect(row.kind).toBe('join');
    expect(row.accessRequestId).toBe(r.id);
    expect(row.todo).toContain('start the joining checklist');

    // The preparer may not record it; another IT person does, with no line manager or CoS step again.
    await expect(svc.itAct(itLead, 'policyAct', { op: 'acctFromAccess', accessRequestId: r.id, userId: joiner.id })).rejects.toThrow(/Someone else in IT/);
    const rec = (await svc.itAct(mgr, 'policyAct', { op: 'acctFromAccess', accessRequestId: r.id, userId: joiner.id })) as { status: string; d: Record<string, unknown> };
    expect(rec.status).toBe('approved');
    expect((rec.d.fromAccessRequest as { id: string }).id).toBe(r.id);
    await expect(svc.itAct(mgr, 'policyAct', { op: 'acctFromAccess', accessRequestId: r.id, userId: joiner.id })).rejects.toThrow(/already exists/);
    // Only IT records it.
    await expect(svc.itAct(await as('u-cos'), 'policyAct', { op: 'acctFromAccess', accessRequestId: r.id, userId: joiner.id })).rejects.toThrow();
    const again = (await svc.itBoard(mgr)).fromHr!.find((x) => x.userId === joiner.id)!;
    expect(again.m365Approved).toBe(true);
  });
});

describe('B2 IT buying stays with IT', () => {
  it('with the pilot switch off, an agreed IT purchase goes to IT quoting, not to Procurement', async () => {
    const { svc, as } = setup();
    const was = RULES.pilot.value.on;
    RULES.pilot.value.on = false;
    try {
      const exec = await as('u-it-ex1');
      const p = await svc.raiseItPurchase(exec, { ownerId: 'merdeka', reason: 'Replacement laptop (mock)', items: [{ kind: 'LAPTOP', description: 'Laptop', qty: 1, unitPrice: 3000 }] });
      const after = await svc.itPurchaseStep(await as('u-it-mgr'), p.id, 'approve', { note: 'Needed for the new executive.' });
      expect(after.status).toBe('quoting');
      expect(after.purRequestId ?? null).toBeNull();
    } finally {
      RULES.pilot.value.on = was;
    }
  });
});

describe('D2 IT tenders come from Marketing once the desk runs', () => {
  it('the IT Manager cannot add a tender of its own after the desk starts', async () => {
    const { svc, as } = setup();
    await svc.startMarketingDesk(await as('u-coo'), TODAY, 'Marketing does all tenders from today.');
    await expect(
      svc.addItTender(await as('u-it-mgr'), { title: 'Supply of laptops (mock)', buyer: 'Ministry (mock)', source: 'eP', closesOn: '2026-12-20', companyId: 'co-arsh', codes: [], items: [], docs: [] }),
    ).rejects.toThrow(/Marketing lodges every tender/);
    expect((await svc.itBoard(await as('u-it-mgr'))).tenderDeskOn).toBe(true);
  });
});

describe('B3 a company manager sees what the company rents', () => {
  it('own company devices and bills only', async () => {
    const { ds, svc } = setup();
    const cm = ds.users.find((u) => u.role === 'company_manager' && !u.integration && u.companyIds.length === 1)!;
    const cid = cm.companyIds[0];
    const [mine, other] = ds.itAssets.filter((a) => a.status === 'in_use');
    mine.ownerId = cid;
    other.ownerId = 'co-elsewhere';
    ds.itRentalBills.push({ id: `rent-${cid}-2025-01`, companyId: cid, period: '2025-01', lines: [], total: 150, invoiceRef: 'INV-1 (mock)', issuedBy: 'FD', issuedAt: NOW, paid: null } as never);
    const b = await svc.itBoard(cm);
    expect(b.role).toBeNull();
    const c = b.companyRentals!.find((x) => x.companyId === cid)!;
    expect(c.devices.map((d) => d.tag)).toContain(mine.tag);
    expect(c.devices.map((d) => d.tag)).not.toContain(other.tag);
    expect(c.bills.find((x) => x.invoiceRef === 'INV-1 (mock)')).toEqual(expect.objectContaining({ period: '2025-01', total: 150, paid: false }));
    expect(c.bills.every((x) => ds.itRentalBills.some((y) => y.companyId === cid && y.period === x.period))).toBe(true);
  });
});

describe('D3 the Finance team named for Merdeka sees IT Finance tabs', () => {
  it('a member of the named team gets the Finance view; another team does not', async () => {
    const { ds, svc } = setup();
    const fin = ds.users.filter((u) => u.role === 'pwvsb_officer' && u.department === 'finance' && u.financeTeam != null && u.financeRole && !u.integration);
    const member = fin[0];
    const otherTeam = fin.find((u) => u.financeTeam !== member.financeTeam)!;
    ds.itPurchaseFinanceAuthorities.push({ id: 'merdeka', version: 1, financeTeam: member.financeTeam!, configuredBy: 'FD (mock)', configuredAt: NOW });
    expect((await svc.itBoard(member)).role).toBe('finance');
    expect((await svc.itBoard(otherTeam)).role).toBeNull();
  });
});
