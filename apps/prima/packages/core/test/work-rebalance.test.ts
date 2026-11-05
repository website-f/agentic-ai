import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addDays,
  generateDataset,
  myt,
  rebalanceAdvice,
  rebalanceAiBrief,
  rebalanceAiNames,
  workTaskVersion,
  type RebalanceMember,
  type RebalanceTask,
} from '../src';

// Managers delegate or readjust the work of the staff under them, and Arisha advises from the data (Fauzan, 2 Nov 2026).
// Synthetic data only.

const NOW = '2026-11-02T02:00:00.000Z'; // 10:00 MYT, Monday
const at = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();
let n = 0;
const task = (p: Partial<RebalanceTask> = {}): RebalanceTask => ({
  id: `t${++n}`,
  version: `v-${n}`,
  title: `Task ${n}`,
  priority: 'normal',
  source: 'assigned',
  dueAt: at(48),
  arrivedAt: at(-24),
  state: 'open',
  moreTimeAsked: false,
  workflow: 'assigned',
  ...p,
});
const member = (id: string, p: Partial<RebalanceMember> = {}): RebalanceMember => ({
  userId: id,
  name: id,
  title: 'Executive',
  companyId: 'co-a',
  role: 'it:executive',
  away: [],
  open: [],
  recentHours: [],
  ...p,
});

describe('Arisha rebalance advice (pure rules)', () => {
  it('moves work due during approved leave to the teammate with the most room, never to someone away', () => {
    const t = task({ dueAt: at(26) }); // due Tuesday
    const team = [
      member('A', { away: [{ from: '2026-11-03', to: '2026-11-04', approved: true }], open: [t] }),
      member('B', { open: [task(), task()] }),
      member('C', { open: [task()], away: [{ from: '2026-11-03', to: '2026-11-03', approved: false }] }),
      member('D', { open: [task(), task()], companyId: 'co-b' }),
    ];
    const r = rebalanceAdvice(team, NOW);
    const a = r.advice.find((x) => x.taskId === t.id)!;
    expect(a.kind).toBe('cover_leave');
    expect(a.level).toBe('act_now');
    // C has less work but has asked for leave that day; D is in another company.
    expect(a.suggest).toMatchObject({ action: 'reassign', toUserId: 'B' });
    expect(a.why.join(' ')).toMatch(/on leave 2026-11-03 to 2026-11-04/);
  });

  it('asked-but-not-approved leave is only something to consider', () => {
    const t = task({ dueAt: at(26) });
    const r = rebalanceAdvice([member('A', { away: [{ from: '2026-11-03', to: '2026-11-03', approved: false }], open: [t] }), member('B')], NOW);
    expect(r.advice[0]).toMatchObject({ kind: 'cover_leave', level: 'consider', suggest: { toUserId: 'B' } });
    expect(r.advice[0].why[0]).toMatch(/asked, not yet approved/);
  });

  it('a playbook duty only goes to the same role; with nobody fitting it advises a new due time', () => {
    const duty = task({ source: 'playbook', dueAt: at(26) });
    const r = rebalanceAdvice([member('A', { away: [{ from: '2026-11-03', to: '2026-11-03', approved: true }], open: [duty] }), member('L', { role: 'it:lead' })], NOW);
    expect(r.advice[0].suggest.action).toBe('adjust');
    expect(r.advice[0].suggest.newDueAt).not.toBeNull();
    expect(r.advice[0].advice).toMatch(/Nobody in the team fits/);
  });

  it('shares out an overloaded person’s normal tasks without piling them on one teammate', () => {
    const heavy = Array.from({ length: 9 }, (_, i) => task({ dueAt: at(30 + i) }));
    const team = [member('A', { open: heavy }), member('B', { open: [task()] }), member('C', { open: [task()] }), member('E', { open: [task(), task()] })];
    const r = rebalanceAdvice(team, NOW);
    const moves = r.advice.filter((x) => x.kind === 'overloaded');
    expect(r.people.find((p) => p.userId === 'A')!.room).toBe('overloaded');
    expect(moves.length).toBeGreaterThan(1);
    // Spread across teammates, the soonest-due tasks first.
    expect(new Set(moves.map((m) => m.suggest.toUserId)).size).toBeGreaterThan(1);
    expect(moves[0].taskId).toBe(heavy[0].id);
    // High priority and playbook duties are not suggested for sharing out.
    const r2 = rebalanceAdvice([member('A', { open: heavy.map((t) => ({ ...t, priority: 'high' as const })) }), member('B')], NOW);
    expect(r2.advice.filter((x) => x.kind === 'overloaded')).toHaveLength(0);
  });

  it('flags tasks with less time left than the person usually takes, only once the usual time is known', () => {
    const tight = task({ dueAt: at(4) });
    const known = rebalanceAdvice([member('A', { open: [tight], recentHours: [10, 12, 8] }), member('B')], NOW);
    expect(known.people.find((p) => p.userId === 'A')!.typicalHours).toBe(10);
    expect(known.advice[0]).toMatchObject({ kind: 'at_risk', taskId: tight.id });
    expect(known.advice[0].why[0]).toMatch(/usually takes about 10 hour/);
    const unknown = rebalanceAdvice([member('A', { open: [tight], recentHours: [10, 12] }), member('B')], NOW);
    expect(unknown.people.find((p) => p.userId === 'A')!.typicalHours).toBeNull();
    expect(unknown.advice).toHaveLength(0);
  });

  it('overdue work with no decision: a new due time for one, a move when they have several overdue', () => {
    const one = rebalanceAdvice([member('A', { open: [task({ dueAt: at(-30), state: 'overdue' })] }), member('B')], NOW);
    expect(one.advice[0]).toMatchObject({ kind: 'overdue_stuck', level: 'act_now', suggest: { action: 'adjust' } });
    const many = rebalanceAdvice(
      [member('A', { open: [task({ dueAt: at(-30), state: 'overdue' }), task({ dueAt: at(-28), state: 'overdue' })] }), member('B')],
      NOW,
    );
    expect(many.advice[0].suggest).toMatchObject({ action: 'reassign', toUserId: 'B' });
    // Moving overdue work always comes with a fresh due time.
    expect(many.advice[0].suggest.newDueAt).not.toBeNull();
  });

  it('uses ACT’s timing for the workflow first, then the person’s usual time', () => {
    const t = task({ dueAt: at(4), workflow: 'it-ex-queue' });
    // No usual time known, but ACT set 6 hours for this workflow: 4 hours left is tight.
    const r = rebalanceAdvice([member('A', { open: [t] }), member('B')], NOW, { 'it-ex-queue': 6 });
    expect(r.advice[0]).toMatchObject({ kind: 'at_risk', taskId: t.id });
    expect(r.advice[0].why[0]).toMatch(/ACT's timing for this work is 6 hour/);
    // ACT's 2 hours wins over a slow usual time: 4 hours left is enough.
    expect(rebalanceAdvice([member('A', { open: [t], recentHours: [10, 10, 10] }), member('B')], NOW, { 'it-ex-queue': 2 }).advice).toHaveLength(0);
    // A fresh due time gives ACT's timing for the work.
    const late = task({ dueAt: at(-30), state: 'overdue', workflow: 'it-ex-queue' });
    const r2 = rebalanceAdvice([member('A', { open: [late] }), member('B')], NOW, { 'it-ex-queue': 6 });
    expect(r2.advice[0].suggest.newDueAt).toBe(at(6));
  });

  it('the Arisha AI brief for one case carries no names, titles, task titles or leave reasons', () => {
    const t = task({ title: 'SECRET-TASK-TITLE', dueAt: at(26) });
    const team = [
      member('u1', { name: 'Aminah SYNTHETIC', title: 'SECRET-TITLE', away: [{ from: '2026-11-03', to: '2026-11-03', approved: true }], open: [t] }),
      member('u2', { name: 'Badrul SYNTHETIC', title: 'SECRET-TITLE' }),
    ];
    const r = rebalanceAdvice(team, NOW);
    const b = rebalanceAiBrief(r, r.advice[0].id)!;
    expect(b.brief).not.toMatch(/SYNTHETIC|SECRET|u1|u2/);
    expect(b.brief).toMatch(/Person A/);
    expect(b.brief).toMatch(/"to":"Person B"/);
    expect(rebalanceAiNames('Move it from Person A to Person B.', b.labels)).toBe('Move it from Aminah SYNTHETIC to Badrul SYNTHETIC.');
    expect(rebalanceAiBrief(r, 'rb-unknown')).toBeNull();
  });

  it('never suggests cover by someone with any leave from today through the final due, asked or approved', () => {
    // A is away Wednesday (approved) and has a task due Wednesday. B has asked for Tuesday off (not approved): B would hold
    // the task over a leave day, so B is skipped even though B has the most room. C takes it.
    const t = task({ dueAt: at(50) }); // Wednesday 12:00 MYT
    const team = [
      member('A', { open: [t], away: [{ from: '2026-11-04', to: '2026-11-04', approved: true }] }),
      member('B', { away: [{ from: '2026-11-03', to: '2026-11-03', approved: false }] }),
      member('C', { open: [task()] }),
    ];
    const a = rebalanceAdvice(team, NOW).advice.find((x) => x.taskId === t.id)!;
    expect(a.suggest.toUserId).toBe('C');
    // A move that also needs a new due time checks leave up to that new time: overdue work extended by 24 h to Tuesday
    // cannot go to someone away on Tuesday.
    const late = task({ dueAt: at(-30), state: 'overdue' });
    const late2 = task({ dueAt: at(-29), state: 'overdue' });
    const r2 = rebalanceAdvice([member('A', { open: [late, late2] }), member('B', { away: [{ from: '2026-11-03', to: '2026-11-03', approved: true }] })], NOW);
    expect(r2.advice.every((x) => x.suggest.toUserId !== 'B')).toBe(true);
  });

  it('the AI brief says only whether leave is coming, never its dates or approval state', () => {
    const t = task({ dueAt: at(26) });
    const r = rebalanceAdvice([member('A', { open: [t], away: [{ from: '2026-11-03', to: '2026-11-03', approved: true }] }), member('B')], NOW);
    const b = rebalanceAiBrief(r, r.advice[0].id)!;
    expect(b.brief).not.toMatch(/2026-11-03|approved|leaveSoon/);
    expect(b.brief).toMatch(/"leaveInNextDays":true/);
  });

  it('says what it could not see, so no advice is never read as all fine', () => {
    const empty = rebalanceAdvice([], NOW);
    expect(empty.advice).toHaveLength(0);
    expect(empty.coverage).toEqual({ people: 0, unknownUsualTime: 0, openTasks: 0, openWithoutActTiming: 0, actTimingAvailable: false });
    const r = rebalanceAdvice([member('A', { open: [task()] }), member('B', { recentHours: [2, 3, 4] })], NOW, { other: 5 });
    expect(r.coverage).toMatchObject({ people: 2, unknownUsualTime: 1, openTasks: 1, openWithoutActTiming: 1, actTimingAvailable: true });
  });

  it('is deterministic: the same team and time give the same advice', () => {
    const team = [member('A', { open: [task({ dueAt: at(-30), state: 'overdue' }), task({ dueAt: at(-29), state: 'overdue' })] }), member('B')];
    expect(rebalanceAdvice(team, NOW)).toEqual(rebalanceAdvice(team, NOW));
  });
});

const TODAY = '2026-11-02';
/** The task's current record version, as the manager's screen would show it. */
const ver = async (svc: PrimaService, id: string) => workTaskVersion((await svc.store.get('workTasks', id))!);
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const clock = { now: myt(TODAY, '10:00') };
  return { ds, clock, svc: new PrimaService(new MemoryStore(ds), () => clock.now) };
};

describe('Managers delegate and readjust work (service)', () => {
  it('the IT Lead moves an executive’s task to another executive, with a reason, and the time starts from the move', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const t = await svc.workTaskAdd(lead, { userId: 'u-it-ex1', title: 'UAT check the Inas printer', doneMeans: 'Printer prints a test page, ticket noted.', dueAt: myt(addDays(TODAY, 2), '17:00'), priority: 'normal' });
    await expect(svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex2', reason: '' })).rejects.toThrow(/reason/);
    // An advice id that Arisha never gave for this task is refused, so the audit cannot credit it.
    await expect(
      svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex2', reason: 'Ex1 is at the Klang site all week', adviceId: 'rb-test' }),
    ).rejects.toThrow(/not current/);
    const moved = await svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex2', reason: 'Ex1 is at the Klang site all week' });
    expect(moved).toMatchObject({ userId: 'u-it-ex2', userName: 'IT Executive 2 (mock)' });
    expect(moved.changes).toHaveLength(1);
    expect(moved.changes![0]).toMatchObject({ kind: 'reassign', fromUserId: 'u-it-ex1', toUserId: 'u-it-ex2', by: lead.name, adviceId: null });
    expect(ds.audit.at(-1)!).toMatchObject({ action: 'work.task_reassign' });
    expect(ds.audit.at(-1)!.summary).not.toMatch(/Arisha/);
    const ex2 = await svc.myWork(await svc.user('u-it-ex2'));
    expect(ex2.open.some((x) => x.id === t.id)).toBe(true);
    const ex1 = await svc.myWork(await svc.user('u-it-ex1'));
    expect(ex1.open.some((x) => x.id === t.id)).toBe(false);
    // The line manager of the new person still reviews it; the new person cannot review their own work.
    await svc.workTaskDone(await svc.user('u-it-ex2'), t.id, { note: 'Test page printed', ref: 'TCK-1' });
    await expect(svc.workTaskReview(await svc.user('u-it-ex2'), t.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.workTaskReview(lead, t.id, true, '')).status).toBe('accepted');
  });

  it('refuses staff moving a colleague’s work, moves outside the manager’s line, finished work and overdue work without a new time', async () => {
    const { svc, clock } = fresh();
    const lead = await svc.user('u-it-lead');
    const t = await svc.workTaskAdd(lead, { userId: 'u-it-ex1', title: 'UAT label the new laptops', doneMeans: 'Every laptop has an asset tag in Prima.', dueAt: myt(TODAY, '15:00'), priority: 'normal' });
    // A colleague cannot move it.
    await expect(svc.workTaskReassign(await svc.user('u-it-ex2'), t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex2', reason: 'I will do it' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workTaskAdjust(await svc.user('u-it-ex2'), t.id, { expectedVersion: await ver(svc, t.id), priority: 'high', reason: 'urgent one' })).rejects.toBeInstanceOf(AccessDenied);
    // Not to someone outside the manager's line (the IT Lead does not manage Finance), nor to themself.
    const fin = (await svc.store.list('users')).find((u) => u.department === 'finance')!;
    await expect(svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: fin.id, reason: 'Finance can help' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-lead', reason: 'I will do it' })).rejects.toBeInstanceOf(AccessDenied);
    // Overdue: a move needs a new due time.
    clock.now = myt(TODAY, '16:00');
    await expect(svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex3', reason: 'Ex1 is stuck on the network job' })).rejects.toThrow(/new due time/);
    const ok = await svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex3', reason: 'Ex1 is stuck on the network job', dueAt: myt(addDays(TODAY, 1), '12:00') });
    expect(ok.effectiveDueAt).toBe(myt(addDays(TODAY, 1), '12:00'));
    // Finished work is not moved.
    await svc.workTaskDone(await svc.user('u-it-ex3'), t.id, { note: 'All tagged', ref: 'TAG' });
    await expect(svc.workTaskReassign(lead, t.id, { expectedVersion: await ver(svc, t.id), toUserId: 'u-it-ex4', reason: 'Another try' })).rejects.toThrow(/Only open work/);
  });

  it('a playbook duty goes only to someone in the same role', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    await svc.teamWork(await svc.user('u-it-lead')); // opens today's playbook duties
    const duty = (await svc.store.list('workTasks', { userId: 'u-it-ex1' })).find((t) => t.source === 'playbook' && t.status === 'open' && Date.parse(t.dueAt) > Date.parse(myt(TODAY, '10:00')))!;
    expect(duty).toBeTruthy();
    await expect(svc.workTaskReassign(mgr, duty.id, { expectedVersion: await ver(svc, duty.id), toUserId: 'u-it-lead', reason: 'Lead covers today' })).rejects.toThrow(/same role/);
    expect((await svc.workTaskReassign(mgr, duty.id, { expectedVersion: await ver(svc, duty.id), toUserId: 'u-it-ex4', reason: 'Ex1 on course today' })).userId).toBe('u-it-ex4');
  });

  it('readjusts due time or priority with a reason, and refuses a change that changes nothing', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const t = await svc.workTaskAdd(lead, { userId: 'u-it-ex1', title: 'UAT update the switch firmware', doneMeans: 'Firmware version noted on the asset.', dueAt: myt(addDays(TODAY, 1), '17:00'), priority: 'normal' });
    await expect(svc.workTaskAdjust(lead, t.id, { expectedVersion: await ver(svc, t.id), priority: 'normal', reason: 'same as before' })).rejects.toThrow(/Nothing changed/);
    await expect(svc.workTaskAdjust(lead, t.id, { expectedVersion: await ver(svc, t.id), priority: 'high', reason: '' })).rejects.toThrow(/reason/);
    const r = await svc.workTaskAdjust(lead, t.id, { expectedVersion: await ver(svc, t.id), priority: 'high', dueAt: myt(addDays(TODAY, 3), '12:00'), reason: 'Vendor window moved to Thursday' });
    expect(r).toMatchObject({ priority: 'high', effectiveDueAt: myt(addDays(TODAY, 3), '12:00') });
    expect(r.changes![0]).toMatchObject({ kind: 'adjust', priorityFrom: 'normal', priorityTo: 'high' });
    expect(ds.audit.at(-1)!.action).toBe('work.task_adjust');
  });

  it('asking Arisha AI is per case, by a manager with that case, capped per day and audited without the brief', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const r = await svc.workRebalance(lead);
    expect(r.ai).toBe(false); // the API switches it on; the core never calls an AI
    expect(r.advice.length).toBeGreaterThan(0);
    const id = r.advice[0].id;
    const b = await svc.workRebalanceAiCase(lead, id);
    expect(b.brief).not.toMatch(/IT Executive/);
    expect(ds.audit.at(-1)!).toMatchObject({ action: 'work.rebalance_ai', actor: lead.name });
    expect(ds.audit.at(-1)!.summary).not.toMatch(/IT Executive/);
    // A case not in the asker's own advice is refused (an executive has no team).
    await expect(svc.workRebalanceAiCase(await svc.user('u-it-ex1'), id)).rejects.toThrow(/Reload/);
    expect(ds.audit.at(-1)!.entityId).toBe(`rebalance-ai:${lead.id}`);
    // Counted by the user id: a changed display name does not reset the count.
    for (let i = 1; i < 5; i++) await svc.workRebalanceAiCase(lead, id);
    const renamed = { ...lead, name: 'IT Lead (renamed, synthetic)' };
    ds.users.find((u) => u.id === lead.id)!.name = renamed.name;
    for (let i = 5; i < 10; i++) await svc.workRebalanceAiCase(renamed, id);
    await expect(svc.workRebalanceAiCase(renamed, id)).rejects.toThrow(/10 times today/);
    await expect(svc.workRebalanceAiCase(lead, id)).rejects.toThrow(/10 times today/);
  });

  it('the advice covers the manager’s line, shows leave dates but never the kind or reason of leave', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    // Synthetic link from an IT Executive to a person record with medical leave tomorrow.
    const ex1 = ds.users.find((u) => u.id === 'u-it-ex1')!;
    ex1.personId = 'p-synthetic-ex1';
    ds.leaveRequests.push({
      id: 'lv-synthetic',
      companyId: 'co-x',
      personId: 'p-synthetic-ex1',
      kind: 'SICK',
      from: addDays(TODAY, 1),
      to: addDays(TODAY, 1),
      days: 1,
      reason: 'SYNTHETIC-PRIVATE-REASON',
      illness: 'SYNTHETIC-ILLNESS',
      proofIds: [],
      requestedAt: myt(TODAY, '08:00'),
      requestedBy: 'x',
      via: 'company',
      status: 'approved',
      decidedBy: 'x',
      decidedAt: myt(TODAY, '09:00'),
      decisionNote: null,
    });
    const t = await svc.workTaskAdd(lead, { userId: 'u-it-ex1', title: 'UAT replace the Arrow Shield router', doneMeans: 'Router swapped and tested.', dueAt: myt(addDays(TODAY, 1), '15:00'), priority: 'normal' });
    const r = await svc.workRebalance(lead);
    expect(r.people.map((p) => p.userId).sort()).toEqual(['u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4']);
    const a = r.advice.find((x) => x.taskId === t.id)!;
    expect(a).toMatchObject({ kind: 'cover_leave', level: 'act_now', suggest: { action: 'reassign' } });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/SYNTHETIC-PRIVATE-REASON|SYNTHETIC-ILLNESS|SICK/);
    // The IT Manager sees the Lead and the executives; an executive has nobody under them.
    expect((await svc.workRebalance(await svc.user('u-it-mgr'))).people).toHaveLength(5);
    expect((await svc.workRebalance(await svc.user('u-it-ex2'))).people).toHaveLength(0);
    // Advice changes nothing by itself.
    expect((await svc.store.get('workTasks', t.id))!.userId).toBe('u-it-ex1');
    // Following it: the advice must be current for this task, and the audit credits it.
    const followed = await svc.workTaskReassign(lead, t.id, { expectedVersion: a.taskVersion, toUserId: a.suggest.toUserId!, reason: 'Cover while Ex1 is away', adviceId: a.id });
    expect(followed.changes!.at(-1)).toMatchObject({ adviceId: a.id, toUserId: a.suggest.toUserId });
    expect(ds.audit.at(-1)!.summary).toMatch(/following Arisha’s advice/);
    // The same advice cannot be used again on the newer version, nor on another task.
    const other = await svc.workTaskAdd(lead, { userId: 'u-it-ex2', title: 'UAT other task', doneMeans: 'Done and noted.', dueAt: myt(addDays(TODAY, 2), '15:00'), priority: 'normal' });
    await expect(svc.workTaskAdjust(lead, other.id, { expectedVersion: other.version, priority: 'high', reason: 'Borrowed advice', adviceId: a.id })).rejects.toThrow(/not current/);
  });

  it('binds a move or readjust to the task version the manager saw, so an older screen cannot undo a newer move', async () => {
    const { svc } = fresh();
    const lead = await svc.user('u-it-lead');
    const mgr = await svc.user('u-it-mgr');
    const t = await svc.workTaskAdd(lead, { userId: 'u-it-ex1', title: 'UAT patch the file server', doneMeans: 'Patch level noted.', dueAt: myt(addDays(TODAY, 2), '17:00'), priority: 'normal' });
    const seen = t.version;
    await expect(svc.workTaskReassign(lead, t.id, { toUserId: 'u-it-ex2', reason: 'No version given' })).rejects.toThrow(/version/);
    const first = await svc.workTaskReassign(lead, t.id, { expectedVersion: seen, toUserId: 'u-it-ex2', reason: 'Ex1 on site' });
    expect(first.version).not.toBe(seen);
    // The IT Manager's screen loaded before the Lead's move: both a move and a readjust from it are refused.
    await expect(svc.workTaskReassign(mgr, t.id, { expectedVersion: seen, toUserId: 'u-it-ex3', reason: 'Ex3 has room' })).rejects.toThrow(/changed since/);
    await expect(svc.workTaskAdjust(mgr, t.id, { expectedVersion: seen, priority: 'high', reason: 'Urgent now' })).rejects.toThrow(/changed since/);
    expect((await svc.store.get('workTasks', t.id))!.userId).toBe('u-it-ex2');
    // Asking for more time also makes a new version.
    const v2 = first.version;
    await svc.workTaskLate(await svc.user('u-it-ex2'), t.id, { reason: 'Waiting for the vendor patch', newDueAt: myt(addDays(TODAY, 3), '17:00') });
    await expect(svc.workTaskAdjust(lead, t.id, { expectedVersion: v2, priority: 'high', reason: 'Urgent now' })).rejects.toThrow(/changed since/);
  });
});

describe('Rebalance guide cards (shared guide-card shape, PR #56)', () => {
  it('BM first with English, entered-once filled, no named person, and allowed matches the server', async () => {
    const { WORK_REBALANCE_GUIDE_CARDS, workRebalanceAllowed } = await import('../src');
    const texts = (o: unknown): { bm: string; en: string }[] =>
      o && typeof o === 'object' ? ('bm' in (o as object) && 'en' in (o as object) ? [o as { bm: string; en: string }] : Object.values(o as object).flatMap(texts)) : [];
    for (const c of WORK_REBALANCE_GUIDE_CARDS) {
      expect(c.enteredOnce.bm.length).toBeGreaterThan(10);
      for (const x of texts(c)) expect(x.bm.trim() && x.en.trim()).toBeTruthy();
      for (const s of c.sources) expect(s.askDesk === null && !!s.askName).toBe(true);
    }
    const { svc } = fresh();
    for (const id of ['u-it-lead', 'u-it-ex1', 'u-fauzan', 'u-coo']) {
      const u = await svc.user(id);
      expect(workRebalanceAllowed(u)).toBe(true);
      await expect(svc.workRebalance(u)).resolves.toBeTruthy();
    }
    const guard = (await svc.store.list('users')).find((u) => u.role === 'guard' || u.role === 'site_device')!;
    expect(workRebalanceAllowed(guard)).toBe(false);
    await expect(svc.workRebalance(guard)).rejects.toBeInstanceOf(AccessDenied);
  });
});
