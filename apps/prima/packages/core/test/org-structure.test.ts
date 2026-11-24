// Org chart and reporting lines (Fauzan, 23 Nov 2026: "Make sure every head can put who staff under it. So every task
// can be set correctly."). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, applyOrgLines, generateDataset, lineManagerOf, myt, slipApprovers, unitHeadsOf } from '../src';
import type { OrgLine, User } from '../src';

const NOW = myt('2026-11-23', '10:00');
const setup = () => {
  const ds = generateDataset({ today: '2026-11-23', now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
};
const managerOf = async (svc: PrimaService, id: string) => {
  const users = await (svc as unknown as { store: MemoryStore }).store.list('users');
  return lineManagerOf(users.find((u) => u.id === id)!, users).manager?.id ?? null;
};

describe('org chart: who sees what', () => {
  it('group leaders and HR see the whole chart; a staff member sees only their own line', async () => {
    const { svc } = setup();
    const ceo = await svc.org.chart(await svc.user('u-fauzan'));
    expect(ceo.whole).toBe(true);
    expect(ceo.canNameHeads).toBe(true);
    expect(ceo.people.some((p) => p.id === 'u-fin-t1-lead')).toBe(true);
    // Guards and site devices are not on the chart (guards stay in the JA app).
    expect(ceo.people.every((p) => p.role !== 'guard' && p.role !== 'site_device')).toBe(true);
    const ex = await svc.org.chart(await svc.user('u-it-ex1'));
    expect(ex.whole).toBe(false);
    expect(ex.canNameHeads).toBe(false);
    const ids = ex.people.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['u-it-ex1', 'u-it-lead', 'u-it-mgr']));
    expect(ids).not.toContain('u-fin-t1-lead');
    expect(ids).not.toContain('u-it-ex2');
    expect(ex.gaps).toEqual([]);
    // The IT Manager sees the whole IT team below them.
    const mgr = await svc.org.chart(await svc.user('u-it-mgr'));
    expect(mgr.people.map((p) => p.id)).toEqual(expect.arrayContaining(['u-it-lead', 'u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4']));
  });

  it('the CEO sees the gaps: units with staff but no head, and assumed lines', async () => {
    const { ds, svc } = setup();
    // As on main before any head is named (the sample may mark some heads already).
    for (const u of ds.users) delete u.headOf;
    const c = await svc.org.chart(await svc.user('u-fauzan'));
    expect(c.gaps.some((g) => /Legal: no head named/.test(g))).toBe(true);
    expect(c.gaps.some((g) => /Transport: no head named/.test(g))).toBe(true);
    // The Inventory Manager now has a line from the job (under the OGM), so it is not assumed.
    expect(c.people.find((p) => p.id === 'u-proc-manager')!.how).toBe('standard');
    expect(await managerOf(svc, 'u-proc-manager')).toBe('u-ogm');
    expect(await managerOf(svc, 'u-proc-exec')).toBe('u-proc-manager');
  });
});

describe('org chart: a head puts staff under them', () => {
  it('the IT Manager brings an IT Executive directly under them; work, the team board and the chart follow', async () => {
    const { svc } = setup();
    const mgr = await svc.user('u-it-mgr');
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-it-lead');
    await expect(svc.org.setLine(mgr, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: '' })).rejects.toThrow(/reason/);
    await svc.org.setLine(mgr, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'Leads the device roll-out with me' });
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-it-mgr');
    const team = await svc.teamWork(mgr);
    expect(team.people.map((p) => p.userId ?? p.id)).toContain('u-it-ex1');
    const lead = await svc.teamWork(await svc.user('u-it-lead'));
    expect(lead.people.map((p) => p.userId ?? p.id)).not.toContain('u-it-ex1');
    const chart = await svc.org.chart(mgr);
    expect(chart.people.find((p) => p.id === 'u-it-ex1')).toMatchObject({ how: 'set', managerId: 'u-it-mgr' });
    // The staff member's own work screen names the new manager.
    const mine = await svc.myWork(await svc.user('u-it-ex1'));
    expect(mine.manager?.id).toBe('u-it-mgr');
    // Back to the line from the job.
    await svc.org.setLine(mgr, { userId: 'u-it-ex1', managerId: null, reason: 'Roll-out finished' });
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-it-lead');
    const audit = await (svc as unknown as { store: MemoryStore }).store.list('audit', { action: 'org.line_set' });
    expect(audit).toHaveLength(2);
  });

  it('a head may arrange only their own line: not outside it, not above them, not themselves, and never a loop', async () => {
    const { svc } = setup();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    await expect(svc.org.setLine(mgr, { userId: 'u-fin-t1-de1', managerId: 'u-it-mgr', reason: 'Wrong team' })).rejects.toThrow(/own line/);
    await expect(svc.org.setLine(mgr, { userId: 'u-it-ex1', managerId: 'u-fd', reason: 'Outside my line' })).rejects.toThrow(/under yourself/);
    await expect(svc.org.setLine(lead, { userId: 'u-it-mgr', managerId: 'u-it-lead', reason: 'Swap' })).rejects.toThrow(/own line/);
    await expect(svc.org.setLine(lead, { userId: 'u-it-lead', managerId: 'u-coo', reason: 'Myself' })).rejects.toThrow(/own line/);
    await expect(svc.org.setLine(mgr, { userId: 'u-it-lead', managerId: 'u-it-ex2', reason: 'Loop' })).rejects.toThrow(/loop/);
    await expect(svc.org.setLine(mgr, { userId: 'u-fauzan', managerId: 'u-it-mgr', reason: 'Top' })).rejects.toThrow(/report to nobody/);
    // An executive moves nobody.
    await expect(svc.org.setLine(await svc.user('u-it-ex2'), { userId: 'u-it-ex3', managerId: 'u-it-ex2', reason: 'Help' })).rejects.toThrow(/own line/);
  });

  it('a Company Manager arranges their own office; the HR Director can move anyone across heads', async () => {
    const { svc } = setup();
    const cm = await svc.user('u-cm-sasa');
    await svc.org.setLine(cm, { userId: 'u-ae-sasa-2', managerId: 'u-bm-sasa-1', reason: 'Supports the Selangor branch' });
    expect(await managerOf(svc, 'u-ae-sasa-2')).toBe('u-bm-sasa-1');
    await expect(svc.org.setLine(cm, { userId: 'u-ae-arsh', managerId: 'u-cm-sasa', reason: 'Another company' })).rejects.toThrow(/own line/);
    const cos = await svc.user('u-cos');
    await svc.org.setLine(cos, { userId: 'u-ae-arsh', managerId: 'u-cm-sasa', reason: 'Covers Arrow Shield while the post is vacant' });
    expect(await managerOf(svc, 'u-ae-arsh')).toBe('u-cm-sasa');
  });
});

describe('org chart: naming unit heads', () => {
  it('only the CEO or the HR Director names a head, never themselves; the named head becomes the line and sees the unit', async () => {
    const { svc } = setup();
    const cos = await svc.user('u-cos');
    await expect(svc.org.setHead(await svc.user('u-it-mgr'), { unit: 'd_legal', headId: 'u-legal', reason: 'Head' })).rejects.toThrow(/CEO or the HR Director/);
    await expect(svc.org.setHead(cos, { unit: 'd_hr', headId: 'u-cos', reason: 'Myself as head' })).rejects.toThrow(/names themselves/);
    await expect(svc.org.setHead(cos, { unit: 'd_nowhere', headId: 'u-legal', reason: 'x y z' })).rejects.toThrow(/department/);
    await svc.org.setHead(cos, { unit: 'd_arms_control', headId: 'u-pwvsb-arms', deputyId: 'u-pwvsb-arms-asst', reason: 'Arms Control Manager leads the department' });
    await svc.org.setHead(cos, { unit: 'd_transport', headId: 'u-transport', reason: 'Head of Transport' });
    await svc.org.setHead(await svc.user('u-fauzan'), { unit: 'c_pgl', headId: 'u-transport', reason: 'Transport runs PGL' });
    const arms = await svc.user('u-pwvsb-arms');
    expect(unitHeadsOf(arms)).toContain('d_arms_control');
    expect(unitHeadsOf(await svc.user('u-transport'))).toEqual(expect.arrayContaining(['d_transport', 'c_pgl']));
    expect((await svc.user('u-pwvsb-arms-asst')).deputyOf).toEqual(['d_arms_control']);
    // CMS heads report to the named Arms Control head; the assistant to the head.
    expect(await managerOf(svc, 'u-cms-head')).toBe('u-pwvsb-arms');
    expect(await managerOf(svc, 'u-pwvsb-arms-asst')).toBe('u-pwvsb-arms');
    const c = await svc.org.chart(await svc.user('u-fauzan'));
    expect(c.units.find((u) => u.key === 'd_transport')!.heads.map((h) => h.id)).toEqual(['u-transport']);
    expect(c.gaps.some((g) => /Transport: no head named/.test(g))).toBe(false);
    // The named head can now arrange their unit: the Arms Control head sees the department.
    const armsChart = await svc.org.chart(arms);
    expect(armsChart.people.map((p) => p.id)).toEqual(expect.arrayContaining(['u-pwvsb-arms-asst']));
    // Clearing the name takes the mark away again.
    await svc.org.setHead(cos, { unit: 'd_arms_control', headId: null, deputyId: null, reason: 'Post vacant' });
    expect(unitHeadsOf(await svc.user('u-pwvsb-arms'))).not.toContain('d_arms_control');
  });

  it('a named department head approves time slips of their department and is its staff manager', async () => {
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const legal = ds.users.find((u) => u.id === 'u-legal')!;
    ds.users.push({ ...legal, id: 'u-legal-2', name: 'Legal Executive (mock)', title: 'Legal Executive, PWVSB', entraOid: undefined, personId: undefined });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const store = (svc as unknown as { store: MemoryStore }).store;
    const before = slipApprovers((await svc.user('u-legal-2'))!, null, true, await store.list('users'), 'head', '2026-11-23');
    expect(before.ids).not.toContain('u-legal');
    await svc.org.setHead(await svc.user('u-cos'), { unit: 'd_legal', headId: 'u-legal', reason: 'Legal Counsel heads Legal' });
    const after = slipApprovers((await svc.user('u-legal-2'))!, null, true, await store.list('users'), 'head', '2026-11-23');
    expect(after).toMatchObject({ ids: ['u-legal'], label: 'Department head' });
    expect(await managerOf(svc, 'u-legal-2')).toBe('u-legal');
  });
});

describe("org chart: Fauzan's answers (23 Nov 2026)", () => {
  it('the CoS and the DCoS (HR Director) set what is needed: any line, heads for a while, patrol officers; never their own', async () => {
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const patrol = ds.users.find((u) => u.opsTier === 'patrol')!;
    ds.users.push({ ...patrol, id: 'u-patrol-perak', name: 'Patrolling Officer Perak (mock)', title: 'Patrolling Officer, Sasa (Perak)', entraOid: undefined, personId: undefined });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    for (const hr of ['u-cos', 'u-dcos']) {
      const u = await svc.user(hr);
      const c = await svc.org.chart(u);
      expect(c.whole).toBe(true);
      expect(c.canNameHeads).toBe(true);
      await svc.org.setLine(u, { userId: 'u-patrol-perak', managerId: 'u-om-klang', reason: `Cover Perak (${hr})` });
      await svc.org.setLine(u, { userId: 'u-it-ex1', managerId: 'u-transport', reason: 'Project cover', until: '2026-12-31' });
      await svc.org.setHead(u, { unit: 'd_marketing', headId: 'u-legal', reason: 'Acting Marketing head', until: '2026-12-31' });
      await expect(svc.org.setLine(u, { userId: hr, managerId: 'u-coo', reason: 'Own line' })).rejects.toThrow(/own line/);
      await expect(svc.org.setHead(u, { unit: 'd_hr', headId: hr, reason: 'Myself' })).rejects.toThrow(/names themselves/);
    }
    expect(await managerOf(svc, 'u-patrol-perak')).toBe('u-om-klang');
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-transport');
    // The CoS's own line is set by the DCoS (or the CEO), and the other way round.
    await svc.org.setLine(await svc.user('u-dcos'), { userId: 'u-cos', managerId: 'u-fauzan', reason: 'Reports to the CEO' });
    await svc.org.setLine(await svc.user('u-cos'), { userId: 'u-dcos', managerId: 'u-cos', reason: 'Reports to the CoS' });
  });

  it('two changes at the same time cannot make a loop: they go one after the other and the second is checked again', async () => {
    const { svc } = setup();
    const ceo = await svc.user('u-fauzan');
    const cos = await svc.user('u-cos');
    const results = await Promise.allSettled([
      svc.org.setLine(ceo, { userId: 'u-legal', managerId: 'u-transport', reason: 'Same time A' }),
      svc.org.setLine(cos, { userId: 'u-transport', managerId: 'u-legal', reason: 'Same time B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/loop/);
    // A failed change does not block the next one.
    await svc.org.setLine(ceo, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'After the refusal' });
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-it-mgr');
  });

  it('Transport runs under the OGM and the COO oversees it', async () => {
    const { svc } = setup();
    expect(await managerOf(svc, 'u-transport')).toBe('u-ogm');
    await svc.org.setHead(await svc.user('u-cos'), { unit: 'd_transport', headId: 'u-transport', reason: 'Head of Transport' });
    expect(await managerOf(svc, 'u-transport')).toBe('u-ogm');
    expect(await managerOf(svc, 'u-ogm')).toBe('u-coo');
  });

  it('a patrolling officer in a state with no OM is under the OGM until the OGM delegates any OM', async () => {
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const patrol = ds.users.find((u) => u.opsTier === 'patrol')!;
    ds.users.push({ ...patrol, id: 'u-patrol-perak', name: 'Patrolling Officer Perak (mock)', title: 'Patrolling Officer, Sasa (Perak)', entraOid: undefined, personId: undefined });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    expect(await managerOf(svc, 'u-patrol-perak')).toBe('u-ogm');
    const ogm = await svc.user('u-ogm');
    const c = await svc.org.chart(ogm);
    expect(c.managerChoices.map((m) => m.id)).toContain('u-om-klang');
    // Not under a storekeeper, and the OGM's OM pick covers patrolling officers only.
    await expect(svc.org.setLine(ogm, { userId: 'u-patrol-perak', managerId: 'u-proc-store1', reason: 'Cover Perak' })).rejects.toThrow(/OM or a Regional OM/);
    await expect(svc.org.setLine(ogm, { userId: 'u-proc-store1', managerId: 'u-om-klang', reason: 'Cover store' })).rejects.toThrow(/own line|only under/);
    await svc.org.setLine(ogm, { userId: 'u-patrol-perak', managerId: 'u-om-klang', reason: 'Klang OM covers Perak for now' });
    expect(await managerOf(svc, 'u-patrol-perak')).toBe('u-om-klang');
    // Someone else's head cannot.
    await expect(svc.org.setLine(await svc.user('u-it-mgr'), { userId: 'u-patrol-perak', managerId: 'u-it-mgr', reason: 'No reach' })).rejects.toThrow();
  });

  it('a private patrolling officer with no OM is under the Operations Director, who delegates an OM of the private side', async () => {
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const patrol = ds.users.find((u) => u.opsTier === 'patrol')!;
    ds.users.push({ ...patrol, id: 'u-patrol-perak', name: 'Patrolling Officer Perak (mock)', title: 'Patrolling Officer, Sasa (Perak)', opsSector: 'private', entraOid: undefined, personId: undefined });
    ds.users.push({ ...patrol, id: 'u-patrol-gov', name: 'Patrolling Officer Gov (mock)', title: 'Patrolling Officer, Goodwill (Perak)', opsSector: 'government', entraOid: undefined, personId: undefined });
    const govOm = ds.users.find((u) => u.id === 'u-om-klang')!;
    ds.users.push({ ...govOm, id: 'u-om-gov-only', name: 'Government OM (mock)', opsSector: 'government', entraOid: undefined, personId: undefined });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    expect(await managerOf(svc, 'u-patrol-perak')).toBe('u-opsdir');
    const od = await svc.user('u-opsdir');
    const c = await svc.org.chart(od);
    expect(c.managerChoices.map((m) => m.id)).toContain('u-om-klang');
    // OMs and Regional OMs with no side are listed for the heads.
    expect(c.gaps.some((g) => g.includes('not tied to a side'))).toBe(true);
    await expect(svc.org.setLine(od, { userId: 'u-patrol-gov', managerId: 'u-om-klang', reason: 'Not my side' })).rejects.toThrow();
    await expect(svc.org.setLine(od, { userId: 'u-patrol-perak', managerId: 'u-om-gov-only', reason: 'Other side' })).rejects.toThrow();
    await svc.org.setLine(od, { userId: 'u-patrol-perak', managerId: 'u-om-klang', reason: 'Klang OM covers Perak for now' });
    expect(await managerOf(svc, 'u-patrol-perak')).toBe('u-om-klang');
  });

  it('a role or line held for a while lapses after its last day; one person can hold several roles', async () => {
    const { svc, ds } = setup();
    const cos = await svc.user('u-cos');
    await expect(svc.org.setHead(cos, { unit: 'd_legal', headId: 'u-legal', reason: 'Acting', until: '2026-11-01' })).rejects.toThrow(/past/);
    await expect(svc.org.setHead(cos, { unit: 'd_legal', headId: 'u-legal', reason: 'Acting', until: 'soon' })).rejects.toThrow(/date/);
    await svc.org.setHead(cos, { unit: 'd_legal', headId: 'u-legal', reason: 'Legal Counsel heads Legal' });
    await svc.org.setHead(cos, { unit: 'd_pdpa', headId: 'u-legal', reason: 'Covers PDPA while the post is open', until: '2026-12-31' });
    expect((await svc.user('u-legal')).headOf).toEqual(['d_legal', 'd_pdpa']);
    const c = await svc.org.chart(await svc.user('u-fauzan'));
    expect(c.units.find((u) => u.key === 'd_pdpa')!.named?.until).toBe('2026-12-31');
    await svc.org.setLine(cos, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'Project cover', until: '2026-11-30' });
    expect(await managerOf(svc, 'u-it-ex1')).toBe('u-it-mgr');
    // After the last day the role lapses and the line goes back to the job.
    const later = new PrimaService(new MemoryStore(ds), () => myt('2027-01-01', '09:00'));
    expect((await later.user('u-legal')).headOf).toEqual(['d_legal']);
    const users = await (later as unknown as { store: MemoryStore }).store.list('users');
    expect(lineManagerOf(users.find((u) => u.id === 'u-it-ex1')!, users).manager?.id).toBe('u-it-lead');
  });
});

describe('org chart: laying lines over users', () => {
  it('the named Marketing head reports to the COO (Fauzan, 22 Nov 2026), and Marketing staff report to that head', () => {
    const users = [
      { id: 'coo', name: 'COO', title: 'COO', role: 'pwvsb_officer', companyIds: [], siteIds: [], opsTier: 'coo' },
      { id: 'cos', name: 'CoS', title: 'CoS', role: 'pwvsb_officer', companyIds: [], siteIds: [], leadership: 'cos' },
      { id: 'mh', name: 'MH', title: 'Head of Marketing', role: 'pwvsb_officer', companyIds: [], siteIds: [], headOf: ['d_marketing'] },
      { id: 'ms', name: 'MS', title: 'Marketing Executive', role: 'pwvsb_officer', companyIds: [], siteIds: [], department: 'marketing' },
    ] as unknown as User[];
    expect(lineManagerOf(users[2], users)).toEqual({ manager: users[0], assumed: false });
    expect(lineManagerOf(users[3], users).manager?.id).toBe('mh');
    const noHead = users.filter((u) => u.id !== 'mh');
    expect(lineManagerOf(noHead[2], noHead).manager?.id).toBe('coo');
  });

  it('a named head row replaces a stale mark; a closed manager is not used', () => {
    const users = [
      { id: 'a', name: 'A', title: 't', role: 'pwvsb_officer', companyIds: [], siteIds: [], department: 'legal', headOf: ['d_legal'] },
      { id: 'b', name: 'B', title: 't', role: 'pwvsb_officer', companyIds: [], siteIds: [], department: 'legal' },
      { id: 'c', name: 'C', title: 't', role: 'pwvsb_officer', companyIds: [], siteIds: [], accessClosedFrom: '2026-11-01' },
    ] as User[];
    const lines: OrgLine[] = [
      { id: 'head-d_legal', kind: 'head', unit: 'd_legal', headId: 'b', deputyId: null, reason: 'r', by: 'x', byId: 'x', at: NOW },
      { id: 'line-a', kind: 'line', userId: 'a', managerId: 'c', reason: 'r', by: 'x', byId: 'x', at: NOW },
    ];
    const out = applyOrgLines(users, lines, '2026-11-23');
    expect(out[0].headOf).toBeUndefined();
    expect(out[1].headOf).toEqual(['d_legal']);
    expect(out[0].reportsToId).toBeUndefined();
    expect(lineManagerOf(out[0], out).manager?.id).toBe('b');
  });

  it('without the database module the chart shows job lines and every change is refused', async () => {
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const store = new MemoryStore(ds);
    (store as unknown as { hasTable: (t: string) => Promise<boolean> }).hasTable = async (t: string) => t !== 'orgLines';
    const svc = new PrimaService(store, () => NOW);
    const c = await svc.org.chart(await svc.user('u-fauzan'));
    expect(c.installed).toBe(false);
    expect(c.people.every((p) => !p.canMove)).toBe(true);
    await expect(svc.org.setLine(await svc.user('u-it-mgr'), { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'Test' })).rejects.toThrow(/org-lines-v1/);
  });
});

describe('org chart: under another store wrapper', () => {
  it('a line written inside a unit of work on a wrapped store is seen straight after (the test version wraps hand-overs)', async () => {
    const { withOrgLinks } = await import('../src');
    const ds = generateDataset({ today: '2026-11-23', now: NOW });
    const svc = new PrimaService(withOrgLinks(new MemoryStore(ds)), () => NOW);
    await svc.org.setLine(await svc.user('u-it-mgr'), { userId: 'u-it-ex2', managerId: 'u-it-mgr', reason: 'Roll-out' });
    const c = await svc.org.chart(await svc.user('u-it-mgr'));
    expect(c.people.find((p) => p.id === 'u-it-ex2')).toMatchObject({ how: 'set', managerId: 'u-it-mgr' });
  });
});
