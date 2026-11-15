// Accounts and Access (Fauzan, 15 Nov 2026): IT or HR prepares sign-ins and company access, the HR Director or the CEO
// approves, never their own. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_TEMPLATES, MemoryStore, PrimaService, generateDataset, myt, rolloutAdmits, shapeMatches } from '../src';

const NOW = myt('2026-11-15', '10:00');
const OID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function setup() {
  const ds = generateDataset({ today: '2026-11-15', now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, as: (id: string) => svc.user(id) };
}

const officeLine = { op: 'create', template: 'admin_exec', name: 'Aminah binti Test', title: 'Admin Executive', companyId: 'co-arsh', entraOid: OID };
const centralLine = { op: 'create', template: 'finance_data_entry', name: 'Rahman bin Sample', title: 'Data Entry', financeTeam: 3, access: [{ companyId: 'co-sasa', scope: 'act' }, { companyId: 'co-arsh', scope: 'monitor' }] };

describe('Accounts and Access', () => {
  it('IT prepares, the HR Director approves with a comment, and the accounts and company access go in at once', async () => {
    const { ds, svc, as } = setup();
    const itLead = await as('u-it-lead');
    const r = await svc.accounts.submit(itLead, { items: [officeLine, centralLine], reason: 'Office staff starting 18 Nov (mock)' });
    expect(r.lines).toBe(2);
    expect(ds.users.some((u) => u.name === 'Aminah binti Test')).toBe(false);
    const board = await svc.accounts.board(await as('u-cos'));
    expect(board.requests[0]).toMatchObject({ status: 'waiting', mayDecide: true });
    await expect(svc.accounts.decide(await as('u-cos'), { requestId: r.id, approve: true, comment: '' })).rejects.toThrow(/comment/);
    const d = await svc.accounts.decide(await as('u-cos'), { requestId: r.id, approve: true, comment: 'Checked against the staff list.' });
    expect(d.applied!.users).toHaveLength(2);
    expect(d.applied!.grants).toHaveLength(2);
    const office = ds.users.find((u) => u.id === d.applied!.users[0])!;
    expect(office).toMatchObject({ role: 'admin_exec', companyIds: ['co-arsh'], entraOid: OID, accountRequestId: r.id });
    const fin = ds.users.find((u) => u.id === d.applied!.users[1])!;
    expect(fin).toMatchObject({ role: 'pwvsb_officer', department: 'finance', financeRole: 'data_entry', financeTeam: 3, companyIds: [] });
    const grants = ds.grants.filter((g) => g.userId === fin.id);
    expect(grants.map((g) => [g.companyId, g.scope, g.validFrom, g.validTo])).toEqual([
      ['co-sasa', 'act', '2026-11-15', '2027-11-15'],
      ['co-arsh', 'monitor', '2026-11-15', '2027-11-15'],
    ]);
    // The new accounts are ordinary office accounts: the all-office rollout admits them; they match their kind exactly.
    expect(rolloutAdmits(office, new Set(['all_office']))).toBe(true);
    expect(shapeMatches(fin, ACCOUNT_TEMPLATES.find((t) => t.key === 'finance_data_entry')!)).toBe(true);
    expect(ds.audit.at(-1)!.action).toBe('accounts.request.approved');
    await expect(svc.accounts.decide(await as('u-fauzan'), { requestId: r.id, approve: true, comment: 'again' })).rejects.toThrow(/already approved/);
  });

  it('only IT and HR prepare; only the HR Director and the CEO approve; nobody decides their own request', async () => {
    const { svc, as } = setup();
    for (const id of ['u-cm-sasa', 'u-fd', 'u-coo', 'u-cos']) await expect(svc.accounts.submit(await as(id), { items: [officeLine], reason: 'x staff' })).rejects.toThrow(/IT or HR prepares|IT, HR/);
    const r = await svc.accounts.submit(await as('u-pwvsb-hr'), { items: [officeLine], reason: 'HR request (mock)' });
    for (const id of ['u-it-lead', 'u-pwvsb-hr', 'u-coo', 'u-vchair']) await expect(svc.accounts.decide(await as(id), { requestId: r.id, approve: true, comment: 'ok fine' })).rejects.toThrow();
    const back = await svc.accounts.decide(await as('u-fauzan'), { requestId: r.id, approve: false, comment: 'Wrong company (mock).' });
    expect(back.status).toBe('returned');
  });

  it('refuses leaders, the CEO, own accounts, duplicates and a leader change without the CEO', async () => {
    const { svc, as } = setup();
    const it = await as('u-it-lead');
    await expect(svc.accounts.submit(it, { items: [{ op: 'create', template: 'ceo', name: 'Some One', title: 'CEO' }], reason: 'mock request' })).rejects.toThrow(/kind of account/);
    await expect(svc.accounts.submit(it, { items: [{ op: 'update', userId: 'u-fauzan', name: 'Another Name' }], reason: 'mock request' })).rejects.toThrow(/CEO's own account/);
    await expect(svc.accounts.submit(it, { items: [{ op: 'update', userId: 'u-it-lead', addAccess: [{ companyId: 'co-sasa', scope: 'act' }] }], reason: 'mock request' })).rejects.toThrow(/your own account/);
    await expect(svc.accounts.submit(it, { items: [{ ...officeLine, entraOid: 'not-a-guid' }], reason: 'mock request' })).rejects.toThrow(/GUID/);
    await expect(svc.accounts.submit(it, { items: [{ ...officeLine, access: [{ companyId: 'co-sasa', scope: 'act' }] }], reason: 'mock request' })).rejects.toThrow(/own company only/);
    await expect(svc.accounts.submit(it, { items: [{ ...centralLine, access: [] }], reason: 'mock request' })).rejects.toThrow(/at least one company/);
    await svc.accounts.submit(it, { items: [officeLine], reason: 'first (mock)' });
    await expect(svc.accounts.submit(it, { items: [{ ...officeLine, name: 'Other Person' }], reason: 'second (mock)' })).rejects.toThrow(/another waiting request/);
    // Real name on a leader's sample account: the HR Director cannot approve it, the CEO can.
    const lead = await svc.accounts.submit(it, { items: [{ op: 'update', userId: 'u-coo', name: 'Real COO Name (mock)' }], reason: 'Real names on leader accounts' });
    const cos = await as('u-cos');
    expect((await svc.accounts.board(cos)).requests.find((q) => q.id === lead.id)!.mayDecide).toBe(false);
    await expect(svc.accounts.decide(cos, { requestId: lead.id, approve: true, comment: 'looks right' })).rejects.toThrow(/CEO decides/);
    // The Chief of Staff cannot approve a change to their own account; the CEO can.
    const mine = await svc.accounts.submit(it, { items: [{ op: 'update', userId: 'u-cos', title: 'Chief of Staff (real title)' }], reason: 'Title fix (mock)' });
    await expect(svc.accounts.decide(cos, { requestId: mine.id, approve: true, comment: 'mine ok' })).rejects.toThrow(/own account|CEO decides/);
    await svc.accounts.decide(await as('u-fauzan'), { requestId: lead.id, approve: true, comment: 'Confirmed name.' });
    expect((await as('u-coo')).name).toBe('Real COO Name (mock)');
  });

  it('a change adds and ends company access; ended access stops the day before', async () => {
    const { ds, svc, as } = setup();
    const target = ds.users.find((u) => u.id === 'u-pwvsb-arms')!;
    const before = ds.grants.filter((g) => g.userId === target.id && g.validTo >= '2026-11-15');
    expect(before.length).toBeGreaterThan(0);
    const end = before[0];
    const free = await svc.addCompany(await as('u-fauzan'), { code: 'SYNAA', name: 'Synthetic Access Guarding Sdn Bhd', ssmNo: '202601007777 (7777777-A)', state: 'Johor', sourceRef: 'SSM profile (mock)', reason: 'Test company (mock).' });
    const r = await svc.accounts.submit(await as('u-it-mgr'), { items: [{ op: 'update', userId: target.id, addAccess: [{ companyId: free.id, scope: 'monitor' }], endAccess: [end.id] }], reason: 'Arms access review (mock)' });
    await svc.accounts.decide(await as('u-dcos'), { requestId: r.id, approve: true, comment: 'Agreed with Arms Control.' });
    expect(ds.grants.find((g) => g.id === end.id)!.validTo).toBe('2026-11-14');
    expect(ds.grants.some((g) => g.userId === target.id && g.companyId === free.id && g.scope === 'monitor')).toBe(true);
  });

  it('IT cannot see HR records; HR links an account to an office HR record once', async () => {
    const { ds, svc, as } = setup();
    expect((await svc.accounts.board(await as('u-it-lead'))).people).toEqual([]);
    const hr = await as('u-pwvsb-hr');
    const people = (await svc.accounts.board(hr)).people;
    expect(people.length).toBeGreaterThan(0);
    const p = ds.people.find((x) => x.id === people[0].id)!;
    const r = await svc.accounts.submit(hr, { items: [{ ...officeLine, entraOid: null, companyId: p.companyId, personId: p.id, name: p.name }], reason: 'Join HR record (mock)' });
    await svc.accounts.decide(await as('u-cos'), { requestId: r.id, approve: true, comment: 'Same person.' });
    expect(ds.users.filter((u) => u.personId === p.id)).toHaveLength(1);
    await expect(svc.accounts.submit(hr, { items: [{ ...officeLine, entraOid: null, companyId: p.companyId, personId: p.id }], reason: 'again (mock)' })).rejects.toThrow(/already has an account/);
  });
});
