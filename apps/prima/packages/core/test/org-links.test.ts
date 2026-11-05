// Key once, every department is told (connect-departments, 2 Nov 2026). Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  ORG_FLOWS,
  ORG_FLOW_OPENS,
  openFor,
  PrimaService,
  fanOut,
  flowsFor,
  generateDataset,
  myt,
  withOrgLinks,
  withoutHandOvers,
  type AuditEntry,
  type RecordValues,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh(links = true) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const base = new MemoryStore(ds);
  const store = links ? withOrgLinks(base) : base;
  const svc = new PrimaService(store, () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, store, svc, user };
}

const joiner: RecordValues = {
  staffNo: 'SYN-0001',
  name: 'Synthetic Joiner',
  jobTitle: 'Admin Executive',
  branchId: 'br-pwvsb-hq',
  employmentType: 'permanent',
  hiredOn: '2026-11-01',
  nationality: 'MY',
  idFull: '900101011234',
  gender: 'F',
  dob: '1990-01-01',
  phone: '012-345 6789',
  basicPay: 3000,
  payReason: 'Offer letter',
  status: 'active',
};

describe('hand-overs between departments', () => {
  it('HR keys a joiner once; IT, Finance and the Chief of Staff office each get a named to-do', async () => {
    const { ds, svc, user } = fresh();
    await svc.saveRecord(user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    const tasks = ds.orgTasks.filter((t) => t.flowId === 'staff_join');
    expect(tasks.map((t) => t.desk).sort()).toEqual(['chief_of_staff', 'finance', 'hr', 'it']);
    // Review W2: HR's own next step after keying the joiner, addressed to HR including the keyer.
    const hr = tasks.find((t) => t.desk === 'hr')!;
    expect(hr.userIds).toContain('u-pwvsb-hr');
    expect(hr.kind).toBe('todo');
    const it = tasks.find((t) => t.desk === 'it')!;
    expect(it.kind).toBe('todo');
    expect(it.dueOn).toBe('2026-10-29');
    expect(it.userIds).toContain('u-it-mgr');
    expect(it.unassigned).toBe(false);
    // The hand-over links the keyed record; it never copies the audit summary or personal details.
    expect(it.entity).toBe('officeStaff');
    expect(JSON.stringify(ds.orgTasks)).not.toContain('900101011234');
    expect(JSON.stringify(ds.orgTasks)).not.toContain('3000');
    expect(ds.orgEvents.filter((e) => e.flowId === 'staff_join')).toHaveLength(1);
    expect(ds.orgNotices.filter((n) => n.taskId === it.id).map((n) => n.userId)).toEqual(it.userIds);
  });

  it('only the named receiver closes a to-do, with a note, once', async () => {
    const { svc, user, ds } = fresh();
    await svc.saveRecord(user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    const t = ds.orgTasks.find((x) => x.flowId === 'staff_join' && x.desk === 'finance')!;
    const fin = t.userIds[0];
    const other = ds.users.find((u) => u.id !== fin && !t.userIds.includes(u.id) && !u.integration)!.id;
    const box = await svc.orgLinks.inbox(user(fin));
    expect(box.items.some((r) => r.task.id === t.id && r.unread)).toBe(true);
    expect(box.channels.email).toBe('not connected');
    await expect(svc.orgLinks.close(user(other), t.id, 'done', 'not mine')).rejects.toThrow(/not found/);
    await expect(svc.orgLinks.close(user(fin), t.id, 'done', '')).rejects.toThrow(/what was done/);
    const closed = await svc.orgLinks.close(user(fin), t.id, 'done', 'Added to staff payroll, ref PR-SYN');
    expect(closed.status).toBe('done');
    expect(closed.closed?.byId).toBe(fin);
    await expect(svc.orgLinks.close(user(fin), t.id, 'done', 'again')).rejects.toThrow(/already closed/);
    expect(ds.audit.at(-1)!.action).toBe('org.handover.close');
    expect((await svc.orgLinks.inbox(user(fin))).unread).toBe(box.unread - 1);
  });

  it("IT's joining hand-over closes from the HR/IT joining request, never from a note alone", async () => {
    const { svc, user, ds } = fresh();
    await svc.saveRecord(user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    const t = ds.orgTasks.find((x) => x.flowId === 'staff_join' && x.desk === 'it')!;
    const it = user('u-it-mgr');
    const state = async () => (await svc.orgLinks.inbox(it)).items.find((r) => r.task.id === t.id)!.joining;
    // No request yet: neither done nor not needed, whatever the note says.
    expect(await state()).toEqual({ state: 'missing', requestId: null, view: 'hr-it-intake' });
    await expect(svc.orgLinks.close(it, t.id, 'done', 'Account and laptop LT-SYN ready')).rejects.toThrow(/has not opened/);
    await expect(svc.orgLinks.close(it, t.id, 'not_needed', 'Not needed')).rejects.toThrow(/has not opened/);
    const base = {
      id: 'hrit-syn-1', workflow: 'onboard', subject: { kind: 'hr_person', id: t.entityId }, subjectLabel: 'Synthetic', targetUserId: null,
      companyId: t.companyId, createdById: 'u-pwvsb-hr', createdAt: t.at, version: 2, hash: 'h', history: [],
      proposedRole: 'pwvsb_officer', startOn: '2026-11-10', reason: 'Joining', collectedDetails: null, selfDetails: null,
      technical: { tenantId: null, oid: null, upnLabel: '', evidenceRef: '', recordedById: null, delegationId: null }, status: 'submitted',
    } as unknown as (typeof ds.hrItRequests)[number];
    // Opened but IT's identity record is not on it: still refused.
    ds.hrItRequests.push(base);
    expect((await state())!.state).toBe('waiting');
    await expect(svc.orgLinks.close(it, t.id, 'done', 'Account ready')).rejects.toThrow(/Record the Microsoft identity there first/);
    // A request for another person, or another company, does not count.
    ds.hrItRequests.splice(0, ds.hrItRequests.length, { ...base, subject: { kind: 'hr_person', id: 'someone-else' }, technical: { ...base.technical, oid: 'x', recordedById: 'u-it-lead' } });
    expect((await state())!.state).toBe('missing');
    // HR cancelled: not needed is allowed, done is not.
    ds.hrItRequests.splice(0, ds.hrItRequests.length, { ...base, status: 'cancelled' });
    await expect(svc.orgLinks.close(it, t.id, 'done', 'Account ready')).rejects.toThrow(/cancelled/);
    // IT recorded the identity on the submitted request: done is allowed.
    ds.hrItRequests.splice(0, ds.hrItRequests.length, { ...base, technical: { ...base.technical, oid: '11111111-2222-4333-8444-555555555555', recordedById: 'u-it-lead' } });
    expect((await state())!.state).toBe('ready');
    // Identity prepared is not the account or device being ready: the words say so (review of d7d472d).
    await expect(svc.orgLinks.close(it, t.id, 'not_needed', 'Not needed')).rejects.toThrow(/does not create or check the account, licence or device/);
    expect((await svc.orgLinks.close(it, t.id, 'done', 'Identity recorded on the joining request')).status).toBe('done');
  });

  it("HR's own joining to-do prompts the HR/IT request and closes once it is open", async () => {
    // Review of the combined candidate (W2): nothing prompted HR to open the request IT works from.
    const { svc, user, ds } = fresh();
    const hrUser = user('u-pwvsb-hr');
    await svc.saveRecord(hrUser, 'officeStaff', null, 'pwvsb', joiner);
    const t = ds.orgTasks.find((x) => x.flowId === 'staff_join' && x.desk === 'hr')!;
    expect(t.userIds).toContain(hrUser.id);
    expect(t.dueOn).toBe('2026-10-27');
    expect((await svc.orgLinks.inbox(hrUser)).items.find((r) => r.task.id === t.id)!.joining!.state).toBe('missing');
    await expect(svc.orgLinks.close(hrUser, t.id, 'done', 'Told IT by phone')).rejects.toThrow(/Open the HR\/IT joining request/);
    const base = {
      id: 'hrit-syn-2', workflow: 'onboard', subject: { kind: 'hr_person', id: t.entityId }, subjectLabel: 'Synthetic', targetUserId: null,
      companyId: t.companyId, createdById: hrUser.id, createdAt: t.at, version: 1, hash: 'h', history: [],
      proposedRole: 'pwvsb_officer', startOn: '2026-11-10', reason: 'Joining', collectedDetails: null, selfDetails: null,
      technical: { tenantId: null, oid: null, upnLabel: '', evidenceRef: '', recordedById: null, delegationId: null }, status: 'submitted',
    } as unknown as (typeof ds.hrItRequests)[number];
    ds.hrItRequests.push(base);
    await expect(svc.orgLinks.close(hrUser, t.id, 'not_needed', 'Not needed')).rejects.toThrow(/You can mark this done/);
    expect((await svc.orgLinks.close(hrUser, t.id, 'done', 'Joining request hrit-syn-2 opened')).status).toBe('done');
  });

  it('the inbox counts every hand-over and pages through all of them (301 tasks)', async () => {
    // Review of d7d472d: 301 overdue tasks showed and counted 300, and the rest could not be reached.
    const { ds, svc, user } = fresh();
    const fin = user('u-fin-lead-1') ?? ds.users.find((u) => u.department === 'finance' && !u.integration)!;
    for (let i = 0; i < 301; i++)
      ds.orgTasks.push({
        id: `ot-syn-${i}`, eventId: `oe-syn-${i}`, flowId: 'pay_change', at: myt('2026-10-01', '09:00'), companyId: 'pwvsb', entity: 'payChange', entityId: `pc-${i}`,
        desk: 'finance', userIds: [fin.id], kind: 'todo', title: 'Synthetic', task: 'Synthetic', from: 'HR', dueOn: '2026-10-05', status: 'open', closed: null, unassigned: false,
      } as (typeof ds.orgTasks)[number]);
    const first = await svc.orgLinks.inbox(fin);
    expect(first.total).toBe(301);
    expect(first.open).toBe(301);
    expect(first.overdue).toBe(301);
    expect(first.items).toHaveLength(100);
    const seen = new Set(first.items.map((r) => r.task.id));
    let next = first.nextOffset;
    while (next != null) {
      const p = await svc.orgLinks.inbox(fin, { offset: next });
      expect(p.total).toBe(301);
      for (const r of p.items) seen.add(r.task.id);
      next = p.nextOffset;
    }
    expect(seen.size).toBe(301);
  });

  it('each hand-over opens its record only for a receiver who can see that company', async () => {
    const { svc, user, ds } = fresh();
    await svc.saveRecord(user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    const box = await svc.orgLinks.inbox(user('u-it-mgr'));
    const row = box.items.find((r) => r.task.flowId === 'staff_join')!;
    const t = row.task;
    const grants = ds.grants;
    const it = user('u-it-mgr');
    // Either a link to the People screen with the person, or an honest refusal when IT has no sight of that company.
    if ('refused' in row.open) expect(row.open.refused).toMatch(/do not have access/);
    else expect(row.open).toEqual({ view: 'people', screen: 'People', exact: true, personId: t.entityId });
    expect(grants).toBeDefined();
    // Pure rule: another company's record is refused; a case opens the case; a system feed opens nothing.
    expect(openFor({ flowId: 'case_serious', companyId: 'co-x', entity: 'case', entityId: 'case-1' }, it, () => false)).toEqual({ refused: expect.stringMatching(/do not have access/) });
    expect(openFor({ flowId: 'case_serious', companyId: 'co-x', entity: 'case', entityId: 'case-1' }, it, () => true)).toEqual({ view: 'cases', screen: 'Cases', exact: true, caseId: 'case-1' });
    // A screen that cannot select one record opens at its list and says which record to look for; it never claims exact.
    expect(openFor({ flowId: 'credit_loan', companyId: null, entity: 'credit_loan', entityId: 'loan-7' }, it, () => true)).toEqual({ view: 'credit', screen: 'Credit', exact: false, find: 'credit_loan loan-7' });
    expect(openFor({ flowId: 'credit_loan', companyId: null, entity: 'x', entityId: 'l' }, { ...it, integration: { kind: 'test' } } as never, () => true)).toHaveProperty('refused');
    expect(openFor({ flowId: 'unknown', companyId: null, entity: 'x', entityId: 'l' }, it, () => true)).toHaveProperty('refused');
  });

  it('every flow that starts from an action has a screen to open', () => {
    expect(ORG_FLOWS.filter((f) => f.actions.length && !ORG_FLOW_OPENS[f.id]).map((f) => f.id)).toEqual([]);
    // Exact opening only where the screen takes that record: People by person, Cases by case.
    for (const [id, o] of Object.entries(ORG_FLOW_OPENS))
      if (o.route) expect({ id, ok: (o.route === 'personId' && o.view === 'people') || (o.route === 'caseId' && o.view === 'cases') }).toEqual({ id, ok: true });
  });

  it('ACT and leadership see the counts and late list; staff see the map only', async () => {
    const { svc, user } = fresh();
    await svc.saveRecord(user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    const act = await svc.orgLinks.map(user('u-audit'));
    expect(act.oversee).toBe(true);
    expect(act.flows.find((f) => f.id === 'staff_join')!.counts).toEqual({ total: 4, open: 4, overdue: 0 });
    const staff = await svc.orgLinks.map(user('u-it-ex1'));
    expect(staff.oversee).toBe(false);
    expect(staff.flows.every((f) => f.counts === null)).toBe(true);
    expect(staff.late).toEqual([]);
    const later = new PrimaService((svc as unknown as { store: MemoryStore }).store, () => myt('2026-11-20', '09:00'));
    const sig = await later.orgLinks.actSignals();
    expect(sig.find((s) => s.key === 'handover_late')!.count).toBe(4);
  });

  it('is off without the switch, and silent inside an import', async () => {
    const off = fresh(false);
    await off.svc.saveRecord(off.user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner);
    expect(off.ds.orgTasks).toHaveLength(0);
    const on = fresh();
    await withoutHandOvers(on.store, () => on.svc.saveRecord(on.user('u-pwvsb-hr'), 'officeStaff', null, 'pwvsb', joiner));
    expect(on.ds.orgTasks).toHaveLength(0);
  });

  it('never routes confidential lines, even if a flow names them', () => {
    for (const a of ['grc.whistle', 'grc.whistle.route', 'arms.issue', 'hr.case_open', 'pdpa.request', 'staff.face_register']) expect(flowsFor(a)).toEqual([]);
    expect(ORG_FLOWS.flatMap((f) => f.actions).filter((a) => flowsFor(a).length === 0 && a)).toEqual([]);
  });

  it('is deterministic per audit entry, so a replay writes nothing twice; filters by severity', () => {
    const { ds } = fresh();
    const entry = (severity: string): [AuditEntry, Record<string, unknown>] => [
      { seq: 77, at: NOW, actor: 'Synthetic OM', companyId: 'co-sasa', action: 'case.raise', entity: 'case', entityId: 'c-syn', summary: 'x', prevHash: '', hash: '' },
      { severity },
    ];
    expect(fanOut(...entry('P3').slice(0, 1) as [AuditEntry], ds.users, { severity: 'P3' }).tasks).toHaveLength(0);
    const a = fanOut(entry('P1')[0], ds.users, { severity: 'P1' });
    const b = fanOut(entry('P1')[0], ds.users, { severity: 'P1' });
    expect(a.tasks.map((t) => t.id)).toEqual(b.tasks.map((t) => t.id));
    expect(a.tasks.map((t) => t.desk).sort()).toEqual(['chief_of_staff', 'cms', 'coo']);
    expect(new Set(a.notices.map((n) => n.id)).size).toBe(a.notices.length);
  });

  it('a P1 or P2 case raised through the service reaches CMS, the Chief of Staff and the COO; P3 and P4 do not', async () => {
    // Review of the combined candidate (W1): the filter used to test 'high'/'critical', which no case ever has.
    const { ds, svc } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const doc = (n: string) => ({ kind: 'document' as const, name: `report-${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic ${n}`).toString('base64')}` });
    const raise = (severity: 'P1' | 'P2' | 'P3' | 'P4') =>
      svc.raiseCase(ds.users.find((u) => u.id === 'u-cm-sasa')!, { companyId: 'co-sasa', siteId: site.id, type: 'COMPLAINT', severity, title: `Synthetic ${severity}`, description: '', proof: [doc(severity)] });
    for (const sev of ['P1', 'P2', 'P3', 'P4'] as const) {
      const c = await raise(sev);
      const desks = ds.orgTasks.filter((t) => t.flowId === 'case_serious' && t.entityId === c.id).map((t) => t.desk).sort();
      expect(desks, sev).toEqual(sev === 'P1' || sev === 'P2' ? ['chief_of_staff', 'cms', 'coo'] : []);
    }
  });

  it('tells the client’s company office, never another company', () => {
    const { ds } = fresh();
    const e: AuditEntry = { seq: 9, at: NOW, actor: 'Synthetic Finance', companyId: 'co-sasa', action: 'credit.loan', entity: 'credit_loan', entityId: 'l-syn', summary: 'x', prevHash: '', hash: '' };
    const office = fanOut(e, ds.users, null).tasks.find((t) => t.desk === 'company_office')!;
    for (const id of office.userIds) expect(ds.users.find((u) => u.id === id)!.companyIds).toContain('co-sasa');
    expect(office.userIds.length).toBeGreaterThan(0);
  });

  it('sends a Finance hand-over to the team assigned to that company, or the Finance Director when none is set (G5)', async () => {
    // Fauzan, 3 Nov 2026 (whole-organisation review G5); ported from #63 with its database twin.
    const { ds, store } = fresh();
    const fd = ds.users.find((u) => u.leadership === 'finance_director')!.id;
    const e: AuditEntry = { seq: 11, at: NOW, actor: 'Synthetic Finance', companyId: 'co-sasa', action: 'client.add', entity: 'clientAccount', entityId: 'ca-syn', summary: 'x', prevHash: '', hash: '' };
    const finOf = (team: number | null) => fanOut(e, ds.users, null, team).tasks.find((t) => t.desk === 'finance')!.userIds.sort();
    expect(finOf(3)).toEqual(['u-fin-t3-lead']);
    expect(finOf(1)).toEqual(['u-fin-t1-dep', 'u-fin-t1-lead']);
    expect(finOf(null)).toEqual([fd]);
    expect(finOf(9)).toEqual([fd]); // a team with nobody in it yet
    expect(await store.get('finStatus', 'fin-co-sasa')).toBeTruthy();
    await store.update('finStatus', 'fin-co-sasa', { team: 2 });
    await store.audit({ at: NOW, actor: 'Synthetic Finance', companyId: 'co-sasa', action: 'client.add', entity: 'clientAccount', entityId: 'ca-syn2', summary: 'x' });
    const t = ds.orgTasks.find((x) => x.entityId === 'ca-syn2' && x.desk === 'finance')!;
    expect(t.userIds).toEqual(['u-fin-t2-lead']);
    expect(t.unassigned).toBe(false);
  });

  it('keeps a company-office line unassigned when nobody is on that desk, and writes none for a central employer', () => {
    const { ds } = fresh();
    const e = (companyId: string): AuditEntry => ({ seq: 10, at: NOW, actor: 'Synthetic Finance', companyId, action: 'credit.loan', entity: 'credit_loan', entityId: 'l-syn', summary: 'x', prevHash: '', hash: '' });
    // A security company whose office has nobody today (review of the combined candidate, G4).
    const empty = ds.users.filter((u) => !(u.companyIds.includes('co-sasa') && (u.role === 'company_manager' || u.role === 'admin_exec')));
    const office = fanOut(e('co-sasa'), empty, null).tasks.find((t) => t.desk === 'company_office');
    expect(office).toBeDefined();
    expect(office!.unassigned).toBe(true);
    expect(office!.userIds).toEqual([]);
    for (const central of ['pwvsb', 'merdeka']) expect(fanOut(e(central), ds.users, null).tasks.some((t) => t.desk === 'company_office')).toBe(false);
  });
});

describe('Hand-overs to the office that runs a company', () => {
  // Review of #56 at 8b0c33f: an office that runs another company (Company office, set by the Chief of Staff or CEO)
  // gains access to it, so the run company's office lines must reach that office too, not stay unassigned.
  const e = (companyId: string, entityId: string): AuditEntry => ({ seq: 12, at: NOW, actor: 'Synthetic Finance', companyId, action: 'credit.loan', entity: 'credit_loan', entityId, summary: 'x', prevHash: '', hash: '' });
  const office = (ds: ReturnType<typeof fresh>['ds'], companyId: string) =>
    ds.users.filter((u) => (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(companyId));

  it('fanOut names the running office (head and executives without a branch) alongside the company’s own', () => {
    const { ds } = fresh();
    const parent = ds.companies.find((c) => c.id !== 'co-sasa' && office(ds, c.id).some((u) => !u.branchId))!.id;
    // The run company's own office is empty, as it usually is (no licence or not enough work of its own).
    const users = ds.users.filter((u) => !office(ds, 'co-sasa').includes(u));
    const branchy = { ...office(ds, parent).find((u) => !u.branchId)!, id: 'u-syn-branch-head', branchId: 'br-syn' };
    const all = [...users, branchy];
    const without = fanOut(e('co-sasa', 'l-run0'), all, null).tasks.find((t) => t.desk === 'company_office')!;
    expect(without.unassigned).toBe(true);
    const out = fanOut(e('co-sasa', 'l-run1'), all, null, null, parent);
    const task = out.tasks.find((t) => t.desk === 'company_office')!;
    const want = office(ds, parent).filter((u) => !u.branchId && !u.accessClosedFrom).map((u) => u.id).sort();
    expect(want.length).toBeGreaterThan(0);
    expect(task.unassigned).toBe(false);
    expect([...task.userIds].sort()).toEqual(want);
    expect(task.userIds).not.toContain('u-syn-branch-head');
    // A notice goes to each of them (an info line), so the running office is told.
    const told = out.notices.filter((n) => n.taskId === task.id).map((n) => n.userId).sort();
    expect(told).toEqual(want);
  });

  it('reads the run link from the store, and ignores a link through an office that is itself run by another', async () => {
    const { ds, store } = fresh();
    const parent = ds.companies.find((c) => c.id !== 'co-sasa' && office(ds, c.id).some((u) => !u.branchId))!.id;
    const own = office(ds, 'co-sasa').map((u) => u.id);
    (ds as unknown as Record<string, unknown>).companyRunLinks = [{ id: 'co-sasa', companyId: 'co-sasa', runByCompanyId: parent }];
    await store.audit({ at: NOW, actor: 'Synthetic Finance', companyId: 'co-sasa', action: 'credit.loan', entity: 'credit_loan', entityId: 'l-run2', summary: 'x' });
    const t = ds.orgTasks.find((x) => x.entityId === 'l-run2' && x.desk === 'company_office')!;
    const runners = office(ds, parent).filter((u) => !u.branchId && !u.accessClosedFrom).map((u) => u.id);
    expect([...t.userIds].sort()).toEqual([...new Set([...own, ...runners])].filter((id) => !ds.users.find((u) => u.id === id)!.accessClosedFrom).sort());
    // The parent is itself run by another office: no chain, the same rule as the access check.
    (ds as unknown as Record<string, unknown>).companyRunLinks = [
      { id: 'co-sasa', companyId: 'co-sasa', runByCompanyId: parent },
      { id: parent, companyId: parent, runByCompanyId: 'co-sasa' },
    ];
    await store.audit({ at: NOW, actor: 'Synthetic Finance', companyId: 'co-sasa', action: 'credit.loan', entity: 'credit_loan', entityId: 'l-run3', summary: 'x' });
    const t3 = ds.orgTasks.find((x) => x.entityId === 'l-run3' && x.desk === 'company_office')!;
    for (const id of t3.userIds) expect(ds.users.find((u) => u.id === id)!.companyIds).toContain('co-sasa');
  });
});

describe('Hand-overs switched off', () => {
  it('the inbox and map say off and never read the hand-over tables (they may not be installed)', async () => {
    const { svc, store, user } = fresh(false);
    const read: string[] = [];
    const list = store.list.bind(store);
    (store as unknown as { list: typeof store.list }).list = ((table: string, ...rest: unknown[]) => {
      read.push(table);
      if (table.startsWith('org')) throw new Error('relation does not exist');
      return (list as (...a: unknown[]) => unknown)(table, ...rest);
    }) as typeof store.list;
    const box = await svc.orgLinks.inbox(user('u-coo'));
    expect(box).toMatchObject({ off: true, items: [], total: 0, open: 0, overdue: 0, nextOffset: null });
    const map = await svc.orgLinks.map(user('u-coo'));
    expect(map.off).toBe(true);
    expect(map.flows.length).toBeGreaterThan(0);
    expect(read.filter((t) => t.startsWith('org'))).toEqual([]);
  });
});
