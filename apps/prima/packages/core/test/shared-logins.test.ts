// Shared login list (Fauzan, 23 Nov 2026): Prima keeps the list only, never a password. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { CENTRAL_EMPLOYER_IDS, UNIT_HEAD_KEYS, unitHeadsOf, MemoryStore, PrimaService, RULES, SHARED_LOGIN_DEPARTMENTS, SHARED_LOGIN_MASTER, generateDataset, myt, workingDaysAfter } from '../src';

const DAY = '2026-11-23';
function setup(today = DAY) {
  const ds = generateDataset({ today: DAY, now: myt(DAY, '09:00') });
  let now = myt(today, '09:00');
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, as: (id: string) => svc.user(id), at: (d: string) => (now = myt(d, '09:00')) };
}
const ssm = { system: 'SSM e-Info (synthetic)', url: 'https://portal.example.test/login?x=1', companyId: 'co-sasa', place: 'microsoft_tile', ownerId: 'u-cm-sasa', backupId: 'u-ae-sasa', userIds: ['u-pwvsb-hr'], lastChanged: '2026-11-01', note: 'Used for yearly returns' };

describe('Heads of central departments and companies', () => {
  it('come from the job on the sign-in or the head named in the organisation chart, from the server only', () => {
    const ds = generateDataset({ today: DAY, now: myt(DAY, '09:00') });
    const u = (id: string) => ({ ...ds.users.find((x) => x.id === id)! });
    expect(unitHeadsOf(u('u-ogm')).sort()).toEqual(['c_goodwill', 'd_operations', 'd_procurement']);
    expect(unitHeadsOf(u('u-pwvsb-arms')).sort()).toEqual(['d_arms_control', 'd_cms']);
    // An unknown key, a security company (headed by its Company Manager) and odd values are dropped.
    expect(unitHeadsOf({ ...u('u-legal'), headOf: ['d_legal', 'c_co-sasa', 'd_nowhere', 7 as unknown as string] })).toEqual(['d_legal']);
    // A closed account, a company office sign-in and a system feed head nothing, whatever headOf says.
    expect(unitHeadsOf({ ...u('u-legal'), accessClosedFrom: '2026-11-01' })).toEqual([]);
    expect(unitHeadsOf({ ...u('u-cm-sasa'), headOf: ['d_legal'] })).toEqual([]);
    expect(unitHeadsOf({ ...u('u-legal'), integration: 'planner' })).toEqual([]);
    expect(UNIT_HEAD_KEYS.length).toBe(16 + CENTRAL_EMPLOYER_IDS.length);
  });
});

describe('Shared login list', () => {
  it('IT adds a login; the people on it, the Company Manager, HR and leaders see it; others do not', async () => {
    const { ds, svc, as } = setup();
    const r = await svc.sharedLogins.save(await as('u-it-lead'), ssm);
    expect(r).toMatchObject({ status: 'active', url: 'https://portal.example.test/login', owner: { id: 'u-cm-sasa' }, lastChanged: '2026-11-01' });
    expect(JSON.stringify(r)).not.toMatch(/password"|secret|token/i);
    expect(ds.audit.at(-1)).toMatchObject({ action: 'shared_login.added', companyId: null });
    for (const id of ['u-it-lead', 'u-it-mgr', 'u-cm-sasa', 'u-ae-sasa', 'u-pwvsb-hr', 'u-fauzan', 'u-coo', 'u-cos']) expect((await svc.sharedLogins.board(await as(id))).rows.map((x) => x.id)).toEqual([r.id]);
    const other = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes('co-sasa'))!;
    expect((await svc.sharedLogins.board(other)).rows).toEqual([]);
    const fin = ds.users.find((u) => u.department === 'finance' && !u.leadership && u.role === 'pwvsb_officer')!;
    expect((await svc.sharedLogins.board(fin)).rows).toEqual([]);
    // Only whoever keeps the list gets the pick lists.
    expect((await svc.sharedLogins.board(await as('u-cm-sasa'))).people).toEqual([]);
    expect((await svc.sharedLogins.board(await as('u-it-lead'))).people.length).toBeGreaterThan(10);
  });

  it('refuses a password, a bad address, the same owner and backup, and anyone but IT or the CEO', async () => {
    const { svc, as } = setup();
    const itLead = await as('u-it-lead');
    for (const note of ['password: Abc123!', 'Kata laluan = rahsia', 'PIN: 4471', 'otp - 998877']) await expect(svc.sharedLogins.save(itLead, { ...ssm, note })).rejects.toThrow(/Never type a password/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, system: 'pwd: hunter2' })).rejects.toThrow(/Never type a password/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, url: 'http://portal.example.test' })).rejects.toThrow(/https/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, url: 'https://user:secret@portal.example.test' })).rejects.toThrow(/https/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, backupId: 'u-cm-sasa' })).rejects.toThrow(/different person/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, department: 'finance' })).rejects.toThrow(/not both/);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, lastChanged: '2026-12-01' })).rejects.toThrow(/future/);
    for (const id of ['u-cm-sasa', 'u-pwvsb-hr', 'u-coo', 'u-cos', 'u-fd']) await expect(svc.sharedLogins.save(await as(id), ssm)).rejects.toThrow(/IT keeps it/);
    await svc.sharedLogins.save(itLead, ssm);
    await expect(svc.sharedLogins.save(itLead, { ...ssm, system: 'ssm E-INFO (synthetic)' })).rejects.toThrow(/already on the list/);
  });

  it('reminds 14 days before the 90 days, then marks it overdue; the owner or backup records the change', async () => {
    const { svc, as, at } = setup();
    const r = await svc.sharedLogins.save(await as('u-it-lead'), ssm);
    const row = async (id = 'u-cm-sasa') => (await svc.sharedLogins.board(await as(id))).rows[0]!;
    expect(RULES.sharedLogin.value).toMatchObject({ changeDays: 90, remindDays: 14, leaverWorkingDays: 3 });
    expect(await row()).toMatchObject({ state: 'ok', nextDue: '2027-01-30', mayRecord: true, mayEdit: false });
    expect(await svc.sharedLogins.homeItems(await as('u-cm-sasa'))).toEqual([]);
    at('2027-01-16');
    expect((await row()).state).toBe('due_soon');
    expect((await svc.sharedLogins.homeItems(await as('u-ae-sasa')))[0]).toMatchObject({ tone: 'warn', go: { view: 'shared-logins' } });
    at('2027-01-31');
    expect((await row()).state).toBe('overdue');
    expect((await svc.sharedLogins.homeItems(await as('u-cm-sasa')))[0]!.tone).toBe('crit');
    // A user who is neither owner nor backup cannot record; nor can a future or earlier day be given.
    await expect(svc.sharedLogins.recordChange(await as('u-pwvsb-hr'), { id: r.id, date: '2027-01-31', reason: '90-day change' })).rejects.toThrow(/owner, the backup or IT/);
    await expect(svc.sharedLogins.recordChange(await as('u-cm-sasa'), { id: r.id, date: '2027-02-05', reason: '90-day change' })).rejects.toThrow(/future/);
    await expect(svc.sharedLogins.recordChange(await as('u-cm-sasa'), { id: r.id, date: '2026-10-01', reason: '90-day change' })).rejects.toThrow(/earlier/);
    await expect(svc.sharedLogins.recordChange(await as('u-cm-sasa'), { id: r.id, date: '2027-01-31', reason: 'new password: Abc' })).rejects.toThrow(/Never type a password/);
    const done = await svc.sharedLogins.recordChange(await as('u-ae-sasa'), { id: r.id, date: '2027-01-31', reason: '90-day change' });
    expect(done.changes).toHaveLength(1);
    expect(await row()).toMatchObject({ state: 'ok', lastChanged: '2027-01-31', nextDue: '2027-05-01' });
    // Someone who cannot see the row is told it is not found.
    const other = (await svc.user('u-fd'));
    await expect(svc.sharedLogins.recordChange({ ...other, leadership: undefined, department: 'finance' } as typeof other, { id: r.id, reason: 'none of mine' })).rejects.toThrow(/not found/i);
  });

  it('when someone on a login leaves, the password is changed within 3 working days and they come off the row', async () => {
    const { ds, svc, as, at } = setup();
    const r = await svc.sharedLogins.save(await as('u-it-lead'), ssm);
    expect(await svc.sharedLogins.leaverList(await as('u-pwvsb-hr'), 'u-pwvsb-hr')).toMatchObject([{ id: r.id, as: 'user', owner: 'Nor Azlina binti Hashim' }]);
    await expect(svc.sharedLogins.leaverList(await as('u-cm-sasa'), 'u-ae-sasa')).rejects.toThrow(/HR, IT and the group leaders/);
    // The user's access is closed from Friday 27 Nov 2026: three working days later is Wednesday 2 Dec.
    ds.users.find((u) => u.id === 'u-pwvsb-hr')!.accessClosedFrom = '2026-11-27';
    expect(workingDaysAfter('2026-11-27', 3)).toBe('2026-12-02');
    const row = async () => (await svc.sharedLogins.board(await as('u-cm-sasa'))).rows[0]!;
    expect((await row()).state).toBe('ok');
    at('2026-11-27');
    expect(await row()).toMatchObject({ state: 'leaver', changeBy: '2026-12-02', leavers: [expect.any(String)] });
    at('2026-12-03');
    expect((await row()).state).toBe('leaver_late');
    const done = await svc.sharedLogins.recordChange(await as('u-cm-sasa'), { id: r.id, date: '2026-12-03', reason: 'Staff left' });
    expect(done.users).toEqual([]);
    expect(done.people).toEqual(['u-cm-sasa', 'u-ae-sasa']);
    expect((await row()).state).toBe('ok');
    // The owner leaves: IT is told to name a new one, and the change cannot be recorded until then.
    ds.users.find((u) => u.id === 'u-cm-sasa')!.accessClosedFrom = '2026-12-03';
    expect((await svc.sharedLogins.homeItems(await as('u-it-lead'))).map((x) => x.title)).toEqual(['1 shared login(s) need a new owner or backup']);
    // IT has no Home screen: the same reminder is among the alerts of the bell, email and Teams.
    expect((await svc.alertItems(await as('u-it-lead'))).map((x) => x.title)).toContain('1 shared login(s) need a new owner or backup');
    await expect(svc.sharedLogins.recordChange(await as('u-ae-sasa'), { id: r.id, date: '2026-12-03', reason: 'Owner left' })).rejects.toThrow(/name a new one first/);
    await expect(svc.sharedLogins.save(await as('u-it-lead'), { ...ssm, id: r.id, userIds: [] })).rejects.toThrow(/has left/);
    // IT names a new owner. The old owner still knows the password, so the change stays due until it is recorded.
    const renamed = await svc.sharedLogins.save(await as('u-it-lead'), { ...ssm, id: r.id, ownerId: 'u-ae-sasa', backupId: 'u-it-lead', userIds: [] });
    expect(renamed.changeAfter).toMatchObject({ since: '2026-12-03', names: [expect.any(String)] });
    const itRow = async () => (await svc.sharedLogins.board(await as('u-it-lead'))).rows[0]!;
    expect(await itRow()).toMatchObject({ state: 'leaver', changeBy: '2026-12-08' });
    await svc.sharedLogins.recordChange(await as('u-ae-sasa'), { id: r.id, date: '2026-12-03', reason: 'Owner left' });
    expect(await itRow()).toMatchObject({ state: 'ok', changeAfter: null });
  });

  it('the master accounts are the CEO only; own-login rows have no 90-day change; closing keeps the row', async () => {
    const { svc, as } = setup();
    const master = { system: 'Microsoft 365 admin (synthetic)', department: SHARED_LOGIN_MASTER, place: 'vault', ownerId: 'u-fauzan', backupId: 'u-coo', lastChanged: DAY };
    await expect(svc.sharedLogins.save(await as('u-it-lead'), master)).rejects.toThrow(/CEO only/);
    const m = await svc.sharedLogins.save(await as('u-fauzan'), master);
    // Not even the backup, IT or another leader sees a master row in Prima.
    for (const id of ['u-coo', 'u-it-lead', 'u-cos', 'u-pwvsb-hr']) expect((await svc.sharedLogins.board(await as(id))).rows).toEqual([]);
    expect((await svc.sharedLogins.board(await as('u-fauzan'))).rows.map((x) => x.id)).toEqual([m.id]);
    await expect(svc.sharedLogins.close(await as('u-it-lead'), { id: m.id, reason: 'not mine' })).rejects.toThrow(/CEO only/);
    await expect(svc.sharedLogins.recordChange(await as('u-coo'), { id: m.id, reason: 'not seen' })).rejects.toThrow(/not found/i);
    const own = await svc.sharedLogins.save(await as('u-it-lead'), { system: 'Bank portal makers (synthetic)', department: 'finance', place: 'own_account', ownerId: 'u-fd', backupId: 'u-coo' });
    expect(own.lastChanged).toBeNull();
    const row = (await svc.sharedLogins.board(await as('u-fd'))).rows.find((x) => x.id === own.id)!;
    expect(row).toMatchObject({ state: 'ok', nextDue: null, mayRecord: false });
    // Edit keeps the scope and the last-changed day; close keeps the row.
    await expect(svc.sharedLogins.save(await as('u-it-lead'), { ...ssm, id: own.id })).rejects.toThrow(/stays with its company or department/);
    const closed = await svc.sharedLogins.close(await as('u-it-lead'), { id: own.id, reason: 'Portal replaced' });
    expect(closed.status).toBe('closed');
    await expect(svc.sharedLogins.close(await as('u-it-lead'), { id: own.id, reason: 'again' })).rejects.toThrow(/already closed/);
    expect((await svc.sharedLogins.board(await as('u-it-lead'))).rows.find((x) => x.id === own.id)!.state).toBe('closed');
  });

  it('group-wide: every company, central company and department; each person sees only what their job needs', async () => {
    const { ds, svc, as } = setup();
    const it_ = await as('u-it-lead');
    const companies = ds.companies.map((c) => c.id);
    expect(companies.length).toBe(38);
    const depts = SHARED_LOGIN_DEPARTMENTS.filter((d) => d !== SHARED_LOGIN_MASTER);
    // IT can pick the 38 companies and the 5 central companies (PWVSB, Merdeka, Goodwill, Sasa Team, PGL).
    const board0 = await svc.sharedLogins.board(it_);
    expect(board0.companies.map((c) => c.id).sort()).toEqual([...companies, ...CENTRAL_EMPLOYER_IDS].sort());
    expect(board0.coverage.length).toBe(38 + CENTRAL_EMPLOYER_IDS.length + depts.length);
    expect(board0.coverage.every((c) => c.logins === 0)).toBe(true);
    // Usual portals (rule SHARED-LOGIN-PORTALS, Policy): a security company also needs KDN eSIMS; a central company not.
    const cov = (b: typeof board0, key: string) => b.coverage.find((c) => c.key === key)!;
    expect(cov(board0, 'c:co-sasa').missing).toEqual([...RULES.sharedLoginPortals.value.everyCompany, 'kdn']);
    expect(cov(board0, 'c:pwvsb').missing).toEqual(RULES.sharedLoginPortals.value.everyCompany);
    expect(cov(board0, 'd:fwm').missing).toEqual([]);
    await expect(svc.sharedLogins.save(it_, { system: 'Odd (synthetic)', kind: 'facebook', department: 'it', place: 'vault', ownerId: 'u-it-lead', backupId: 'u-it-mgr', lastChanged: DAY })).rejects.toThrow(/kind of portal/);
    // One login for every place, owned by IT, the Company Manager on the rows of the companies that have one.
    const cmOf = (co: string) => ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(co))?.id;
    const rowOf = new Map<string, string>();
    for (const co of [...companies, ...CENTRAL_EMPLOYER_IDS]) {
      const r = await svc.sharedLogins.save(it_, { system: `SSM e-Info ${co} (synthetic)`, kind: 'ssm', companyId: co, place: 'vault', ownerId: 'u-it-lead', backupId: cmOf(co) ?? 'u-it-mgr', lastChanged: DAY });
      rowOf.set(`c:${co}`, r.id);
    }
    for (const d of depts) {
      const r = await svc.sharedLogins.save(it_, { system: `Portal ${d} (synthetic)`, department: d, place: 'microsoft_tile', ownerId: 'u-it-lead', backupId: 'u-it-mgr', lastChanged: DAY });
      rowOf.set(`d:${d}`, r.id);
    }
    const all = [...rowOf.keys()];
    const after = await svc.sharedLogins.board(it_);
    expect(after.coverage.filter((c) => c.logins !== 1)).toEqual([]);
    expect(cov(after, 'c:co-sasa').missing).not.toContain('ssm');
    expect(cov(after, 'c:co-sasa').missing).toContain('kdn');
    expect(after.rows.find((r) => r.companyId === 'co-sasa')!.kind).toBe('ssm');
    const sees = async (id: string) => new Set((await svc.sharedLogins.board(await as(id))).rows.map((r) => [...rowOf.entries()].find(([, v]) => v === r.id)![0]));
    // IT, central HR, ACT head and the group leaders see every place.
    for (const id of ['u-it-ex1', 'u-pwvsb-hr', 'u-audit', 'u-coo', 'u-cos', 'u-fd', 'u-fauzan']) expect([...(await sees(id))].sort()).toEqual([...all].sort());
    // A Company Manager sees their own company only; the head of two companies sees both.
    expect([...(await sees('u-cm-sasa'))]).toEqual(['c:co-sasa']);
    expect([...(await sees('u-hoc-01'))].sort()).toEqual(['c:co-04', 'c:co-05']);
    // Heads of central departments and central companies see theirs.
    expect([...(await sees('u-fwm-mgr'))]).toEqual(['d:fwm']);
    expect([...(await sees('u-ogm'))].sort()).toEqual(['c:goodwill', 'd:operations', 'd:procurement']);
    expect([...(await sees('u-opsdir'))].sort()).toEqual(['c:sasateam', 'd:operations']);
    expect([...(await sees('u-asset-dir'))]).toEqual(['d:asset']);
    // Heads named in the organisation chart (headOf): Arms Control with CMS, Transport with its company, PDPA, Legal, DOA.
    expect([...(await sees('u-pwvsb-arms'))].sort()).toEqual(['d:arms_control', 'd:cms']);
    expect([...(await sees('u-transport'))].sort()).toEqual(['c:pgl', 'd:transport']);
    expect([...(await sees('u-pdpa'))]).toEqual(['d:pdpa']);
    expect([...(await sees('u-legal'))]).toEqual(['d:legal']);
    expect([...(await sees('u-pwvsb-doa'))]).toEqual(['d:director_office']);
    // Staff who are not on a row and do not head it see nothing.
    for (const id of ['u-ae-sasa', 'u-rom-central', 'u-act-aud1', 'u-fwm-ex1', 'u-fin-t1-lead', 'u-proc-store1', 'u-pwvsb-arms-asst', 'u-cms-head']) expect((await sees(id)).size).toBe(0);
    // Guards, site supervisors, site devices and system feeds have no list at all and cannot be named on one.
    for (const u of ds.users.filter((x) => x.integration || ['guard', 'supervisor', 'site_device'].includes(x.role))) {
      await expect(svc.sharedLogins.board(await as(u.id))).rejects.toThrow(/office staff only/);
      await expect(svc.sharedLogins.save(it_, { system: `Try ${u.id}`, department: 'it', place: 'vault', ownerId: 'u-it-lead', backupId: u.id, lastChanged: DAY })).rejects.toThrow(/office staff member/);
    }
    // Every office sign-in in the group opens the list without an error.
    for (const u of ds.users.filter((x) => !x.integration && !['guard', 'supervisor', 'site_device'].includes(x.role))) await svc.sharedLogins.board(await as(u.id));
  });

  it('banks and e-wallets: many per company, last 4 digits only, matched to the bank accounts Finance keeps', async () => {
    const { ds, svc, as } = setup();
    const it_ = await as('u-it-lead');
    const bank = { system: 'Maybank2E maker (synthetic)', kind: 'bank', provider: 'Maybank', companyId: 'co-sasa', place: 'vault', ownerId: 'u-cm-sasa', backupId: 'u-ae-sasa', lastChanged: DAY };
    await expect(svc.sharedLogins.save(it_, { ...bank, accounts: [] })).rejects.toThrow(/last 4 digits of at least one/);
    await expect(svc.sharedLogins.save(it_, { ...bank, accounts: ['5141 2345 6789'] })).rejects.toThrow(/never the full number/);
    await expect(svc.sharedLogins.save(it_, { ...bank, provider: 'PIN: 1234', accounts: ['1234'] })).rejects.toThrow(/Never type a password/);
    const fin = ds.finStatus.find((f) => f.companyId === 'co-sasa')!;
    expect(fin.banks.length).toBeGreaterThan(1);
    const last4 = (m: string) => m.replace(/\D/g, '').slice(-4);
    const cov = async (id: string) => (await svc.sharedLogins.board(await as(id))).coverage.find((c) => c.key === 'c:co-sasa')!;
    expect((await cov('u-fd')).bankAccounts).toMatchObject({ total: fin.banks.length, noLogin: expect.arrayContaining([expect.stringContaining(last4(fin.banks[0]!.accountMasked))]) });
    // One login can reach several accounts; a second bank and an e-wallet are separate rows of the same company.
    await svc.sharedLogins.save(it_, { ...bank, accounts: [last4(fin.banks[0]!.accountMasked)] });
    await svc.sharedLogins.save(it_, { ...bank, system: 'CIMB BizChannel (synthetic)', provider: 'CIMB', accounts: fin.banks.slice(1).map((b) => last4(b.accountMasked)) });
    await svc.sharedLogins.save(it_, { ...bank, system: "TNG eWallet business (synthetic)", kind: 'ewallet', provider: "Touch 'n Go", accounts: ['4321'] });
    const c = await cov('u-fd');
    expect(c.bankAccounts).toEqual({ total: fin.banks.length, noLogin: [] });
    expect(c).toMatchObject({ bankLogins: 2, walletLogins: 1 });
    expect(c.missing).not.toContain('bank');
    // The Sasa Company Manager gets the same view for Sasa only; another company's manager does not see Sasa.
    expect((await svc.sharedLogins.board(await as('u-cm-sasa'))).coverage.map((x) => x.key)).toEqual(['c:co-sasa']);
    expect((await svc.sharedLogins.board(await as('u-cm-arsh'))).coverage.map((x) => x.key)).toEqual(['c:co-arsh']);
  });
  it('IT or the CEO add kinds of portal and choose which every company must have; others cannot', async () => {
    const { ds, svc, as } = setup();
    const it_ = await as('u-it-lead');
    const cov = async (id: string, key = 'c:co-sasa') => (await svc.sharedLogins.board(await as(id))).coverage.find((c) => c.key === key)!;
    expect((await cov('u-it-lead')).missing).toContain('kdn');
    expect((await cov('u-it-lead', 'c:goodwill')).missing).not.toContain('kdn');
    // A new kind that every security company must have shows as missing for Sasa, not for a central company.
    const k = await svc.sharedLogins.saveKind(it_, { label: 'Majlis Daerah licence (synthetic)', usual: 'security' });
    expect(k).toMatchObject({ key: 'majlis_daerah_licence_syntheti', builtIn: false, money: false, active: true });
    expect(ds.audit.at(-1)).toMatchObject({ action: 'shared_login.kind_added', companyId: null });
    expect((await cov('u-it-lead')).missing).toContain(k.key);
    expect((await cov('u-it-lead', 'c:goodwill')).missing).not.toContain(k.key);
    // A login of the new kind fills the gap.
    await svc.sharedLogins.save(it_, { ...ssm, system: 'MD licence Sasa (synthetic)', kind: k.key });
    expect((await cov('u-it-lead')).missing).not.toContain(k.key);
    // The same name twice, an unknown kind on a login and a password in the name are refused.
    await expect(svc.sharedLogins.saveKind(it_, { label: 'majlis daerah licence (synthetic)', usual: 'none' })).rejects.toThrow(/already a kind/);
    await expect(svc.sharedLogins.save(it_, { ...ssm, system: 'X (synthetic)', kind: 'nowhere' })).rejects.toThrow(/kind of portal from the list/);
    await expect(svc.sharedLogins.saveKind(it_, { label: 'password: abc123', usual: 'none' })).rejects.toThrow(/Never type a password/);
    // A built-in kind can be changed: HRD Corp no longer usual; ePerolehan usual for every company.
    await svc.sharedLogins.act(it_, 'kind', { key: 'hrdc', label: 'HRD Corp', usual: 'none' });
    await svc.sharedLogins.act(await as('u-fauzan'), 'kind', { key: 'eperolehan', label: 'ePerolehan', usual: 'every' });
    const b = await svc.sharedLogins.board(it_);
    expect(b.usualPortals).toContain('eperolehan');
    expect(b.usualPortals).not.toContain('hrdc');
    expect((await cov('u-it-lead', 'c:goodwill')).missing).toContain('eperolehan');
    // Turned off: not offered for new logins, but a login that has it keeps it.
    await svc.sharedLogins.saveKind(it_, { key: k.key, label: k.label, usual: 'security', active: false });
    expect((await cov('u-it-lead')).missing).not.toContain(k.key);
    await expect(svc.sharedLogins.save(it_, { ...ssm, system: 'MD licence 2 (synthetic)', kind: k.key })).rejects.toThrow(/kind of portal from the list/);
    const row = b.rows.find((r) => r.kind === k.key)!;
    await svc.sharedLogins.save(it_, { ...ssm, id: row.id, system: row.system, kind: k.key, note: 'Still used' });
    await expect(svc.sharedLogins.saveKind(it_, { key: 'other', label: 'Other', usual: 'every' })).rejects.toThrow(/always stays on/);
    // Only IT and the CEO keep the kinds.
    for (const id of ['u-cm-sasa', 'u-pwvsb-hr', 'u-cos', 'u-coo']) await expect(svc.sharedLogins.saveKind(await as(id), { label: 'Client portal (synthetic)', usual: 'none' })).rejects.toThrow(/IT and the CEO/);
  });
});
