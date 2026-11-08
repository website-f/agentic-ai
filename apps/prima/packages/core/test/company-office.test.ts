import { describe, expect, it } from 'vitest';
import { MemoryStore, OFFICE_DESKS, PrimaService, deskOf, generateDataset, myt, suggestDesks, teamFindings, type User } from '../src';

// Each licensed company's own office (Fauzan, 2 Nov 2026): 1 Company Manager or GM and 2 to 8 executives. The head shares
// the company's work out to desks; executives hold desks with a backup; group leaders only monitor. Mock data only.
const TODAY = '2026-11-02';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00')) };
};
const exec = (id: string, companyId = 'co-x', extra: Partial<User> = {}): User => ({ id, name: id, title: 'Admin Executive', role: 'admin_exec', companyIds: [companyId], siteIds: [], ...extra });
const head = (id: string, title = 'Company Manager'): User => ({ id, name: id, title, role: 'company_manager', companyIds: ['co-x'], siteIds: [] });

describe('team size rule OFFICE-TEAM', () => {
  it('needs one head and 2 to 8 executives; nothing entered is Unknown, not green', () => {
    expect(teamFindings([], [])).toEqual([expect.objectContaining({ tone: 'neutral' })]);
    expect(teamFindings([head('h')], [exec('a'), exec('b')])).toEqual([]);
    expect(teamFindings([head('h')], Array.from({ length: 8 }, (_, i) => exec(`e${i}`)))).toEqual([]);
    expect(teamFindings([head('h')], [exec('a')]).map((f) => f.tone)).toEqual(['crit']);
    expect(teamFindings([head('h')], Array.from({ length: 9 }, (_, i) => exec(`e${i}`))).map((f) => f.tone)).toEqual(['warn']);
    expect(teamFindings([], [exec('a'), exec('b')]).map((f) => f.tone)).toEqual(['crit']);
    expect(teamFindings([head('h'), head('g', 'General Manager')], [exec('a'), exec('b')])[0].message).toMatch(/2 heads.*General Manager/);
  });

  it('suggests a split where nobody backs up their own desk', () => {
    const s = suggestDesks([exec('a'), exec('b'), exec('c')]);
    for (const d of OFFICE_DESKS) {
      expect(s[d.desk].ownerUserId).toBeTruthy();
      expect(s[d.desk].backupUserId).not.toBe(s[d.desk].ownerUserId);
    }
    expect(suggestDesks([exec('a')]).people).toEqual({ ownerUserId: 'a', backupUserId: null });
  });

  it('keeps approvals and arms with the head', () => {
    expect(deskOf({ tone: 'warn', tag: 'Approve', title: '', detail: '', go: { view: 'commercial' } })).toBe('head');
    expect(deskOf({ tone: 'crit', tag: 'Arms', title: '', detail: '', go: { view: 'arms' } })).toBe('head');
    expect(deskOf({ tone: 'warn', tag: 'Tender', title: '', detail: '', go: { view: 'commercial' } })).toBe('tenders');
    expect(deskOf({ tone: 'crit', tag: 'No-show', title: '', detail: '', go: { view: 'sites' } })).toBe('people');
  });
});

describe('company office', () => {
  it('reads the team from the accounts already kept, without branch managers', async () => {
    const { svc } = fresh();
    const o = await svc.companyOffice(await svc.user('u-cm-arsh'), 'co-arsh');
    expect(o.role).toBe('head');
    expect(o.canAssign).toBe(true);
    expect(o.team.map((t) => t.userId).sort()).toEqual(['u-ae-arsh', 'u-ae-arsh-2', 'u-cm-arsh']);
    expect(o.execCount).toBe(2);
    expect(o.desks.every((d) => d.state === 'unassigned')).toBe(true);
    expect(o.suggested).not.toBeNull();
    // Work items still reach the head while no desk is shared out.
    expect(o.queue.length).toBeGreaterThan(0);
  });

  it('makes the GM the head where a company has one; the Company Manager beside them cannot share out desks', async () => {
    const { svc } = fresh();
    const gm = await svc.companyOffice(await svc.user('u-gm-sasa'), 'co-sasa');
    expect(gm.role).toBe('head');
    expect(gm.canAssign).toBe(true);
    expect(gm.team.find((t) => t.userId === 'u-gm-sasa')?.job).toBe('General Manager');
    expect(gm.team.find((t) => t.userId === 'u-cm-sasa')?.job).toBe('Company Manager (under the GM)');
    expect(gm.findings.some((f) => /still has a Company Manager account beside the GM/.test(f.message))).toBe(true);
    expect(gm.execCount).toBe(3);
    const cm = await svc.user('u-cm-sasa');
    expect((await svc.companyOffice(cm, 'co-sasa')).role).toBe('exec');
    await expect(svc.setOfficeDesks(cm, 'co-sasa', { desks: [{ desk: 'people', ownerUserId: 'u-ae-sasa' }] })).rejects.toThrow(/Not allowed/);
    await svc.setOfficeDesks(await svc.user('u-gm-sasa'), 'co-sasa', { desks: [{ desk: 'people', ownerUserId: 'u-cm-sasa', backupUserId: 'u-ae-sasa' }] });
    expect(await svc.officeDeskHolders('co-sasa', 'people')).toEqual(['u-cm-sasa', 'u-ae-sasa', 'u-gm-sasa']);
  });

  it('puts everything the company has to do in its office work, once each', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const o = await svc.companyOffice(cm, 'co-arsh');
    const home = await svc.home(cm, 'co-arsh');
    // Beyond the manager's Home: tenders and licences from the executive board, insurance and clients.
    expect(o.queue.length).toBeGreaterThan(home.todo.filter((t) => t.go.view !== 'office').length);
    const views = new Set(o.queue.map((q) => q.go.view));
    for (const v of ['commercial', 'compliance']) expect(views.has(v as never)).toBe(true);
    expect(o.queue.every((q) => !q.go.companyId || q.go.companyId === 'co-arsh')).toBe(true);
    const keys = o.queue.map((q) => `${q.tag}|${q.title}|${q.go.view}|${q.go.personId ?? ''}|${q.go.caseId ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only the company head shares out desks; executives and other companies are refused', async () => {
    const { svc } = fresh();
    const desks = [{ desk: 'people', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }];
    await expect(svc.setOfficeDesks(await svc.user('u-ae-arsh'), 'co-arsh', { desks })).rejects.toThrow(/Not allowed/);
    await expect(svc.setOfficeDesks(await svc.user('u-cm-inas'), 'co-arsh', { desks })).rejects.toThrow(/Not allowed/);
    await expect(svc.setOfficeDesks(await svc.user('u-coo'), 'co-arsh', { desks })).rejects.toThrow(/Not allowed/);
    // P78: the owner (CEO record) is master administrator and may share out desks too (see p78-leadership-makers.test.ts).
  });

  it('refuses owners from another company, a backup equal to the owner and unknown desks', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    await expect(svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-inas' }] })).rejects.toThrow(/owner must be/);
    await expect(svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh' }] })).rejects.toThrow(/different person/);
    await expect(svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'payroll', ownerUserId: 'u-ae-arsh' }] })).rejects.toThrow(/Unknown desk/);
    await expect(svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-bm-arsh-1' }] })).rejects.toThrow(/owner must be/);
  });

  it('saves the split with an audit line, routes work to the desk holder and the backup covers leave', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const r = await svc.setOfficeDesks(cm, 'co-arsh', {
      desks: OFFICE_DESKS.map((d, i) => ({ desk: d.desk, ownerUserId: i % 2 ? 'u-ae-arsh-2' : 'u-ae-arsh', backupUserId: i % 2 ? 'u-ae-arsh' : 'u-ae-arsh-2' })),
      note: 'First split',
    });
    expect(r.changed).toBe(OFFICE_DESKS.length);
    const audit = ds.audit.filter((a) => a.action === 'office.desks');
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toMatch(/owner none → Siti Hajar/);
    // Saving the same split again changes nothing and writes no new audit line.
    expect((await svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }] })).changed).toBe(0);

    const ex = await svc.user('u-ae-arsh');
    const mine = await svc.companyOffice(ex, 'co-arsh');
    expect(mine.role).toBe('exec');
    expect(mine.canAssign).toBe(false);
    expect(mine.queue.every((q) => q.desk !== 'head')).toBe(true);
    expect(mine.queue.filter((q) => q.mine).every((q) => q.actingName === ex.name)).toBe(true);
    expect(await svc.officeDeskHolders('co-arsh', 'people')).toEqual(['u-ae-arsh', 'u-ae-arsh-2', 'u-cm-arsh']);

    // Siti Hajar on approved leave today: her desks pass to the backup, and the backup is told on Home.
    const personId = ds.users.find((u) => u.id === 'u-ae-arsh')!.personId!;
    ds.leaveRequests.push({
      id: 'lv-office-test', companyId: 'co-arsh', personId, kind: 'ANNUAL', from: TODAY, to: TODAY, days: 1, reason: 'Synthetic test',
      proofIds: [], requestedAt: myt(TODAY, '08:00'), requestedBy: 'test', via: 'company', status: 'approved', decidedBy: 'test', decidedAt: myt(TODAY, '08:30'), decisionNote: null,
    } as (typeof ds.leaveRequests)[number]);
    const o = await svc.companyOffice(cm, 'co-arsh');
    const people = o.desks.find((d) => d.desk === 'people')!;
    expect(people.state).toBe('cover');
    expect(people.actingUserId).toBe('u-ae-arsh-2');
    expect(await svc.officeDeskHolders('co-arsh', 'people')).toEqual(['u-ae-arsh-2', 'u-cm-arsh']);
    const home = await svc.home(await svc.user('u-ae-arsh-2'), 'co-arsh');
    expect(home.todo.some((t) => t.tag === 'Office' && /You hold Guards, attendance and roster today/.test(t.title))).toBe(true);
  });

  it('group leaders see every office and all office work in one consolidated list, read-only', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const g = await svc.companyOffices(ceo);
    expect(g.totals.companies).toBe(38);
    // Companies with no office accounts yet are Unknown (neutral), never counted as ready.
    expect(g.totals.notEntered).toBe(g.rows.filter((r) => r.heads.length + r.execCount === 0).length);
    expect(g.totals.notEntered).toBeGreaterThan(30);
    expect(g.totals.ready).toBe(0);
    expect(g.rows.find((r) => r.company.id === 'co-arsh')?.execCount).toBe(2);
    const o = await svc.companyOffice(ceo, 'co-arsh');
    expect(o.role).toBe('monitor');
    // P78: the owner may share out desks as master administrator; other leaders only monitor.
    expect(o.canAssign).toBe(true);
    // Consolidated (Fauzan, 2 Nov 2026): the leader sees the company's work, only that company's lines.
    expect(o.queue.length).toBeGreaterThan(0);
    expect(o.queue.every((q) => q.go.companyId === 'co-arsh' && !q.mine)).toBe(true);
    expect(g.totals.open).toBe(g.rows.reduce((n, r) => n + r.open, 0));
    expect(g.byDesk.reduce((n, d) => n + d.open, 0)).toBe(g.totals.open);
    expect(g.work.length).toBeGreaterThan(0);
    expect(g.work[0].tone).toBe('crit');
    expect(new Set(g.work.map((w) => w.companyId)).size).toBeGreaterThan(1);
    expect(g.work.every((w) => w.go.companyId === w.companyId)).toBe(true);
    // P78: the owner may share out desks; another group leader (the COO) still only monitors.
    await expect(svc.setOfficeDesks(await svc.user('u-coo'), 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh' }] })).rejects.toThrow(/Not allowed/);
  });

  it('refuses the office to department staff, other companies and site sign-ins', async () => {
    const { svc } = fresh();
    for (const id of ['u-it-mgr', 'u-cm-inas', 'u-sv-sasa', 'u-ae-arsh'])
      await expect(svc.companyOffice(await svc.user(id), 'co-sasa')).rejects.toThrow(/Not allowed/);
    for (const id of ['u-it-mgr', 'u-cm-sasa', 'u-ae-sasa']) await expect(svc.companyOffices(await svc.user(id))).rejects.toThrow(/leadership only/);
  });

  it('the head is told on Home about team and desk gaps', async () => {
    const { svc } = fresh();
    const h = await svc.home(await svc.user('u-cm-inas'), 'co-inas');
    expect(h.todo.some((t) => t.tag === 'Office' && /1 executive; the office needs at least 2/.test(t.title))).toBe(true);
  });

  it('clears a desk when the head saves it as not shared out, with an audit line, and the work returns to the head', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    await svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'cases', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }] });
    await expect(svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'cases', ownerUserId: null, backupUserId: 'u-ae-arsh-2' }] })).rejects.toThrow(/owner before a backup/);
    const r = await svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'cases', ownerUserId: null, backupUserId: null }] });
    expect(r.changed).toBe(1);
    const d = (await svc.companyOffice(cm, 'co-arsh')).desks.find((x) => x.desk === 'cases')!;
    expect(d.ownerUserId).toBeNull();
    expect(d.backupUserId).toBeNull();
    expect(d.state).toBe('unassigned');
    expect(d.actingUserId).toBe('u-cm-arsh');
    expect(ds.audit.filter((a) => a.action === 'office.desks').at(-1)!.summary).toMatch(/Cases and incidents: owner Siti Hajar binti Rosli → none, backup Wong Jia Hui → none/);
    // Clearing again, or clearing a desk never shared out, changes nothing.
    expect((await svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'cases', ownerUserId: null }, { desk: 'office', ownerUserId: null }] })).changed).toBe(0);
    expect(await svc.officeDeskHolders('co-arsh', 'cases')).toEqual(['u-cm-arsh']);
  });

  it('passes a desk to the backup when the owner has left, and to the head when both are away', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    await svc.setOfficeDesks(cm, 'co-arsh', { desks: [{ desk: 'tenders', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }] });
    // Owner's access closed (left the company): the backup holds it and the head is told to choose a new owner.
    ds.users.find((u) => u.id === 'u-ae-arsh')!.accessClosedFrom = TODAY;
    let o = await svc.companyOffice(cm, 'co-arsh');
    let t = o.desks.find((x) => x.desk === 'tenders')!;
    expect(t.state).toBe('cover');
    expect(t.actingUserId).toBe('u-ae-arsh-2');
    expect(o.findings.some((f) => f.tone === 'crit' && /Tenders and quotations: the owner has left/.test(f.message))).toBe(true);
    // The backup on approved leave too: the work falls to the head.
    const personId = ds.users.find((u) => u.id === 'u-ae-arsh-2')!.personId!;
    ds.leaveRequests.push({
      id: 'lv-office-away', companyId: 'co-arsh', personId, kind: 'ANNUAL', from: TODAY, to: TODAY, days: 1, reason: 'Synthetic test',
      proofIds: [], requestedAt: myt(TODAY, '08:00'), requestedBy: 'test', via: 'company', status: 'approved', decidedBy: 'test', decidedAt: myt(TODAY, '08:30'), decisionNote: null,
    } as (typeof ds.leaveRequests)[number]);
    o = await svc.companyOffice(cm, 'co-arsh');
    t = o.desks.find((x) => x.desk === 'tenders')!;
    expect(t.state).toBe('head');
    expect(t.actingUserId).toBe('u-cm-arsh');
    expect(o.team.find((m) => m.userId === 'u-ae-arsh-2')?.onLeave).toBe(true);
    expect(await svc.officeDeskHolders('co-arsh', 'tenders')).toEqual(['u-cm-arsh']);
  });

  it('never shows an office as Ready to the group while its own page still has warnings', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ceo = await svc.user('u-fauzan');
    // Every desk owned but no backups: the company page warns, so the group row must not say Ready.
    await svc.setOfficeDesks(cm, 'co-arsh', { desks: OFFICE_DESKS.map((d) => ({ desk: d.desk, ownerUserId: 'u-ae-arsh' })) });
    const own = await svc.companyOffice(cm, 'co-arsh');
    expect(own.findings.filter((f) => f.rule === 'OFFICE-COVER')).toHaveLength(OFFICE_DESKS.length);
    let row = (await svc.companyOffices(ceo)).rows.find((r) => r.company.id === 'co-arsh')!;
    expect(row.tone).toBe('warn');
    expect(row.findings).toEqual(own.findings);
    // With backups on every desk, both say Ready.
    await svc.setOfficeDesks(cm, 'co-arsh', { desks: OFFICE_DESKS.map((d) => ({ desk: d.desk, ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' })) });
    row = (await svc.companyOffices(ceo)).rows.find((r) => r.company.id === 'co-arsh')!;
    expect((await svc.companyOffice(cm, 'co-arsh')).findings).toEqual([]);
    expect(row.tone).toBe('ok');
  });
});

describe('returned quotation correction', () => {
  it('lets company staff correct guards, hours, rate and date of a returned quotation with a reason, audited', async () => {
    const { svc, ds } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const cm = await svc.user('u-cm-arsh');
    const q = await svc.createQuotation(ae, 'co-arsh', { client: 'Synthetic Client', siteName: 'Synthetic site', tenderId: null, guards: 4, hoursPerDay: 12, ratePerGuard: 2500, validDays: 30 });
    await svc.quotationAction(ae, q.id, 'submit');
    await svc.quotationAction(cm, q.id, 'return', 'Rate too low and date too short');
    const until = '2026-12-31';
    const bad = { guards: 6, hoursPerDay: 12 as const, ratePerGuard: 2800, validUntil: until, reason: '' };
    await expect(svc.correctQuotation(ae, q.id, bad)).rejects.toThrow(/Say why/);
    await expect(svc.correctQuotation(ae, q.id, { ...bad, reason: 'x', validUntil: '2026-11-01' })).rejects.toThrow(/valid-until/);
    await expect(svc.correctQuotation(await svc.user('u-cm-inas'), q.id, { ...bad, reason: 'x' })).rejects.toThrow(/Not allowed/);
    await expect(svc.correctQuotation(await svc.user('u-it-mgr'), q.id, { ...bad, reason: 'x' })).rejects.toThrow(/Not allowed/);
    const fixed = await svc.correctQuotation(ae, q.id, { ...bad, reason: 'Manager asked for 6 guards at RM2,800 until year end' });
    expect(fixed).toMatchObject({ guards: 6, ratePerGuard: 2800, monthlyTotal: 16800, validUntil: until, status: 'returned' });
    const line = ds.audit.filter((a) => a.action === 'quotation.correct').at(-1)!;
    expect(line.summary).toMatch(/Guards 4 → 6; Rate per guard 2500 → 2800; Valid until .* → 2026-12-31; Monthly total 10000 → 16800\. Reason: Manager asked/);
    await expect(svc.correctQuotation(ae, q.id, { ...bad, reason: 'again' })).rejects.toThrow(/Nothing changed/);
    // Then resubmitted and approved by another person; an approved quotation can no longer be corrected here.
    await svc.quotationAction(ae, q.id, 'submit');
    await svc.quotationAction(cm, q.id, 'approve', 'Checked corrected quotation and approved');
    await expect(svc.correctQuotation(ae, q.id, { ...bad, guards: 7, reason: 'late change' })).rejects.toThrow(/Only a draft or returned/);
  });
});
