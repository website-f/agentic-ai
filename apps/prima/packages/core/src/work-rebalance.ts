import { RULES } from "./rules";
import { toMs } from "./time";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { WorkTask } from "./types";


/**
 * The task's record version (Arisha main review, 2 Nov 2026): a move or readjust names the version the manager saw, and
 * the server refuses it when the task changed since, so an older screen cannot undo a newer move. Any change to who
 * holds it, its status, due time, more time asked, priority, review or the change trail gives a new version.
 */
export function workTaskVersion(t: Pick<WorkTask, 'userId' | 'status' | 'dueAt' | 'priority' | 'late' | 'review' | 'evidence' | 'changes'>): string {
  const key = [t.userId, t.status, t.dueAt, t.priority, t.late?.at ?? '', t.late?.newDueAt ?? '', t.review?.at ?? '', t.evidence?.at ?? '', String(t.changes?.length ?? 0), t.changes?.at(-1)?.at ?? ''].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return `v${(t.changes?.length ?? 0)}-${h.toString(36)}`;
}

/** One open task as the advice sees it. */
export interface RebalanceTask {
  id: Id;
  /** The record version the advice was made from (workTaskVersion). */
  version: string;
  title: string;
  priority: 'high' | 'normal';
  /** Where the task came from; follows WorkTask, so new sources (such as CEO instructions) carry through. */
  source: WorkTask['source'];
  /** The due time that counts (the new time when more time was given). */
  dueAt: IsoDateTime;
  /** When the work reached the person: created, or moved to them. */
  arrivedAt: IsoDateTime;
  state: 'open' | 'overdue' | 'returned';
  /** The workflow it belongs to, for ACT's standard time: the playbook duty id, or the source (assigned, meeting, own). */
  workflow: string;
  /** More time was already asked once. */
  moreTimeAsked: boolean;
}

/** One person in the manager's team. */
export interface RebalanceMember {
  userId: Id;
  name: string;
  title: string;
  companyId: Id | null;
  /** The role playbook key: a playbook duty is only moved to someone with the same role. */
  role: string;
  /** Leave days (approved, or asked and waiting). Dates only: never the kind of leave or the reason. */
  away: { from: IsoDate; to: IsoDate; approved: boolean }[];
  open: RebalanceTask[];
  /** Hours from arrival to done for tasks finished in the look-back window (newest first). */
  recentHours: number[];
}

export type RebalanceKind = 'cover_leave' | 'overloaded' | 'overdue_stuck' | 'at_risk';

export interface RebalanceAdvice {
  /** Stable for the same facts, so the manager's choice can name the advice it followed. */
  id: string;
  kind: RebalanceKind;
  level: 'act_now' | 'consider';
  userId: Id;
  name: string;
  taskId: Id;
  taskTitle: string;
  /** The task's record version the advice was made from; a move or readjust must still match it. */
  taskVersion: string;
  /** What Arisha suggests, in one sentence. */
  advice: string;
  /** The facts from Prima behind it. */
  why: string[];
  suggest: { action: 'reassign' | 'adjust'; toUserId: Id | null; toName: string | null; newDueAt: IsoDateTime | null };
}

export interface RebalancePerson {
  userId: Id;
  name: string;
  title: string;
  /** Open tasks, high priority counted twice. */
  load: number;
  openTasks: number;
  overdue: number;
  /** Away today or within the look-ahead, dates only. */
  awaySoon: { from: IsoDate; to: IsoDate; approved: boolean } | null;
  /** Median hours from arrival to done, last 4 weeks; null when fewer than the minimum finished tasks (UNKNOWN). */
  typicalHours: number | null;
  finishedSample: number;
  /** Room for more work compared with the team: plain words, not a score. */
  room: 'room' | 'busy' | 'overloaded' | 'away';
}

export interface RebalanceResult {
  asOf: IsoDateTime;
  teamLoadAverage: number | null;
  people: RebalancePerson[];
  advice: RebalanceAdvice[];
  rules: typeof RULES.workRebalance.value;
  /** ACT's standard hours by workflow, as used for this advice. */
  standards: Record<string, number>;
  /**
   * What the advice could not see (Arisha main review, 2 Nov 2026), so an empty list is never read as "all fine":
   * people in the line, how many have too few finished tasks for a usual time, and open tasks with no ACT timing.
   */
  coverage: { people: number; unknownUsualTime: number; openTasks: number; openWithoutActTiming: number; actTimingAvailable: boolean };
  basis: string;
}

const H = 3_600_000;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const dayOf = (t: IsoDateTime): IsoDate => new Date(toMs(t) + 8 * H).toISOString().slice(0, 10);
/** A time as people read it in Malaysia: YYYY-MM-DD HH:MM. */
const mytLabel = (t: IsoDateTime) => new Date(toMs(t) + 8 * H).toISOString().slice(0, 16).replace('T', ' ');
const loadOf = (ts: RebalanceTask[]) => ts.reduce((n, t) => n + (t.priority === 'high' ? 2 : 1), 0);
/** Whether the person is away on a day (approved leave only blocks; asked leave is a warning). */
const awayOn = (m: RebalanceMember, day: IsoDate, approvedOnly: boolean) =>
  m.away.find((a) => (!approvedOnly || a.approved) && a.from <= day && day <= a.to) ?? null;

/**
 * Arisha's advice for one manager's team. Pure: the same team and time give the same advice.
 * Moves are suggested only inside the same company, never to someone away on the due day, and a playbook duty only to
 * someone with the same role. When nobody fits, the advice is to give a new due time instead.
 */
export function rebalanceAdvice(team: RebalanceMember[], now: IsoDateTime, standards: Record<string, number> = {}): RebalanceResult {
  const r = RULES.workRebalance.value;
  const nowMs = toMs(now);
  const today = dayOf(now);
  const aheadDay = dayOf(new Date(nowMs + r.lookAheadDays * 24 * H).toISOString());

  // Load as it will be after the advice already given, so two moves do not both land on the same person.
  const planned = new Map<Id, number>(team.map((m) => [m.userId, loadOf(m.open)]));
  const present = team.filter((m) => !awayOn(m, today, true));
  const avg = present.length ? present.reduce((n, m) => n + loadOf(m.open), 0) / present.length : null;
  const overloadAt = avg === null ? Infinity : Math.max(r.overloadMin, Math.ceil(avg * r.overloadFactor));

  const people: RebalancePerson[] = team.map((m) => {
    const load = loadOf(m.open);
    const awaySoon = m.away.find((a) => a.to >= today && a.from <= aheadDay) ?? null;
    const sample = m.recentHours.slice(0, r.sampleMax);
    const typical = sample.length >= r.minFinished ? round1(median(sample)!) : null;
    const awayNow = !!awayOn(m, today, true);
    return {
      userId: m.userId,
      name: m.name,
      title: m.title,
      load,
      openTasks: m.open.length,
      overdue: m.open.filter((t) => t.state === 'overdue').length,
      awaySoon,
      typicalHours: typical,
      finishedSample: sample.length,
      room: awayNow ? 'away' : load >= overloadAt ? 'overloaded' : avg !== null && load <= Math.floor(avg) ? 'room' : 'busy',
    };
  });
  const personOf = new Map(people.map((p) => [p.userId, p]));

  /**
   * The teammate with the most room who can take this task, or null. The recipient must have no leave at all (approved
   * or asked) from today through the final due time, including a new due time the move itself would give, so cover
   * never runs onto their own leave (Arisha main review, 2 Nov 2026).
   */
  const coverFor = (from: RebalanceMember, t: RebalanceTask, extendHours: number): RebalanceMember | null => {
    const finalDue = toMs(t.dueAt) <= nowMs + r.minHoursLeft * H ? Math.max(toMs(t.dueAt), nowMs) + extendHours * H : toMs(t.dueAt);
    const lastDay = dayOf(new Date(finalDue).toISOString());
    const options = team.filter(
      (m) =>
        m.userId !== from.userId &&
        m.companyId === from.companyId &&
        !m.away.some((a) => a.from <= lastDay && a.to >= today) &&
        (t.source !== 'playbook' || m.role === from.role) &&
        (personOf.get(m.userId)?.overdue ?? 0) < r.overdueBusy &&
        (planned.get(m.userId) ?? 0) + (t.priority === 'high' ? 2 : 1) < overloadAt,
    );
    options.sort((a, b) => (planned.get(a.userId) ?? 0) - (planned.get(b.userId) ?? 0) || a.name.localeCompare(b.name));
    return options[0] ?? null;
  };
  const advice: RebalanceAdvice[] = [];
  const taken = new Set<Id>();
  const push = (m: RebalanceMember, t: RebalanceTask, kind: RebalanceKind, level: RebalanceAdvice['level'], why: string[], allowMove: boolean, extendHours: number) => {
    if (taken.has(t.id)) return;
    taken.add(t.id);
    // A fresh due time gives the work ACT's timing for it when set, else the given extension.
    const ext = standards[t.workflow] != null ? Math.ceil(standards[t.workflow]) : extendHours;
    const to = allowMove ? coverFor(m, t, ext) : null;
    const w = t.priority === 'high' ? 2 : 1;
    if (to) {
      planned.set(to.userId, (planned.get(to.userId) ?? 0) + w);
      planned.set(m.userId, (planned.get(m.userId) ?? 0) - w);
    }
    // A move of overdue work needs a fresh due time too, so the new person does not start late.
    const needsTime = !to || toMs(t.dueAt) <= nowMs + r.minHoursLeft * H;
    const base = Math.max(toMs(t.dueAt), nowMs);
    const newDueAt = needsTime ? new Date(base + ext * H).toISOString() : null;
    const verb = to
      ? `Move "${t.title}" from ${m.name} to ${to.name}${newDueAt ? `, due ${mytLabel(newDueAt)}` : ''}.`
      : `Nobody in the team fits to take "${t.title}": give ${m.name} a new due time, or talk to them about it.`;
    advice.push({
      id: `rb-${kind}-${t.id}-${t.dueAt.slice(0, 16)}`,
      kind,
      level,
      userId: m.userId,
      name: m.name,
      taskId: t.id,
      taskTitle: t.title,
      taskVersion: t.version,
      advice: verb,
      why: [...why, ...(to ? [`${to.name} has ${planned.get(to.userId)! - w} open (high priority counted twice) and has no leave from today to the due day.`] : [])],
      suggest: { action: to ? 'reassign' : 'adjust', toUserId: to?.userId ?? null, toName: to?.name ?? null, newDueAt },
    });
  };

  const byDue = (a: RebalanceTask, b: RebalanceTask) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
  const sorted = [...team].sort((a, b) => a.name.localeCompare(b.name));

  // 1. Leave: work due while the person is away goes to someone who is in.
  for (const m of sorted)
    for (const t of [...m.open].sort(byDue)) {
      const a = awayOn(m, dayOf(t.dueAt), false) ?? (awayOn(m, today, true) && t.state === 'overdue' ? awayOn(m, today, true) : null);
      if (!a) continue;
      push(
        m,
        t,
        'cover_leave',
        a.approved ? 'act_now' : 'consider',
        [`${m.name} is on leave ${a.from}${a.to !== a.from ? ` to ${a.to}` : ''}${a.approved ? '' : ' (asked, not yet approved)'} and the task is due ${mytLabel(t.dueAt)}.`],
        true,
        r.extendHours,
      );
    }

  // 2. Overdue work with no more time asked, past the grace: stuck.
  for (const m of sorted)
    for (const t of [...m.open].sort(byDue)) {
      const lateH = (nowMs - toMs(t.dueAt)) / H;
      if (t.state !== 'overdue' || lateH < r.stuckHours) continue;
      push(
        m,
        t,
        'overdue_stuck',
        'act_now',
        [`Overdue by ${Math.floor(lateH / 24) >= 1 ? `${Math.floor(lateH / 24)} day(s)` : `${Math.round(lateH)} hour(s)`}${t.moreTimeAsked ? ', and more time was already given once' : ', with no more time asked'}.`],
        (personOf.get(m.userId)?.overdue ?? 0) >= 2,
        r.extendHours,
      );
    }

  // 3. Overloaded: share out the soonest normal tasks above the team level (not playbook duties, not high priority).
  for (const m of sorted) {
    const p = personOf.get(m.userId)!;
    if (p.room !== 'overloaded' || avg === null) continue;
    const spare = m.open
      .filter((t) => t.state !== 'overdue' && t.source !== 'playbook' && t.priority === 'normal' && !taken.has(t.id))
      .sort(byDue);
    for (const t of spare) {
      if ((planned.get(m.userId) ?? 0) < overloadAt) break;
      const before = planned.get(m.userId) ?? 0;
      push(
        m,
        t,
        'overloaded',
        'consider',
        [`${m.name} has ${p.openTasks} open tasks (load ${p.load}); the team average is ${round1(avg)}.`],
        true,
        r.extendHours,
      );
      if ((planned.get(m.userId) ?? 0) === before) break; // nobody could take it: stop suggesting more
    }
  }

  // 4. Timing: less time left than the work needs. ACT's standard time for the workflow comes first (Fauzan, 2 Nov 2026:
  // ACT sets the best timing for each workflow after reviewing it); without one, the person's own usual time.
  for (const m of sorted) {
    const p = personOf.get(m.userId)!;
    for (const t of [...m.open].sort(byDue)) {
      if (t.state === 'overdue') continue;
      const std = standards[t.workflow];
      const needH = std ?? p.typicalHours;
      if (needH == null) continue;
      const leftH = (toMs(t.dueAt) - nowMs) / H;
      if (leftH >= needH * r.riskFactor || leftH > r.riskMaxHours) continue;
      const hadH = (toMs(t.dueAt) - toMs(t.arrivedAt)) / H;
      push(
        m,
        t,
        'at_risk',
        'consider',
        [
          std != null
            ? `${round1(leftH)} hour(s) left; ACT's timing for this work is ${std} hour(s).`
            : `${round1(leftH)} hour(s) left; ${m.name} usually takes about ${p.typicalHours} hour(s) from getting a task to finishing it (${p.finishedSample} finished tasks, last 4 weeks). No ACT timing is available for this work, so the person's usual time is used.`,
          `The task was given ${round1(hadH)} hour(s) in total.`,
        ],
        p.room !== 'room',
        Math.ceil(needH),
      );
    }
  }

  const order: Record<RebalanceKind, number> = { cover_leave: 0, overdue_stuck: 1, overloaded: 2, at_risk: 3 };
  advice.sort((a, b) => (a.level === b.level ? 0 : a.level === 'act_now' ? -1 : 1) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  const openAll = team.flatMap((m) => m.open);
  return {
    asOf: now,
    teamLoadAverage: avg === null ? null : round1(avg),
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    advice,
    rules: r,
    standards,
    coverage: {
      people: team.length,
      unknownUsualTime: people.filter((p) => p.typicalHours === null).length,
      openTasks: openAll.length,
      openWithoutActTiming: openAll.filter((t) => standards[t.workflow] == null).length,
      actTimingAvailable: Object.keys(standards).length > 0,
    },
    basis:
      'Arisha’s advice from Prima’s task records: due times, open tasks, finished-task times, leave dates and ACT’s timing for each workflow where set. Fixed rules; ask Arisha AI on a case when you need more. You decide; nothing moves until you act.',
  };
}

/**
 * The brief for asking Arisha AI about one case (Fauzan, 2 Nov 2026: "Use ai when needed. We use it in case basis").
 * Minimal and pseudonymised: people are Person A, B, C; no names, job titles, task titles or leave details (only whether leave falls in the next days), and
 * no free text typed by staff. The labels are swapped back to names only in the answer shown to the manager.
 */
export function rebalanceAiBrief(result: RebalanceResult, adviceId: string): { brief: string; labels: { label: string; name: string }[] } | null {
  const a = result.advice.find((x) => x.id === adviceId);
  if (!a) return null;
  const labels = result.people.map((p, i) => ({ userId: p.userId, label: `Person ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`, name: p.name }));
  const L = (id: Id | null) => labels.find((x) => x.userId === id)?.label ?? 'nobody';
  const team = result.people.map((p) => ({
    who: L(p.userId),
    openTasks: p.openTasks,
    load: p.load,
    overdue: p.overdue,
    usualHoursPerTask: p.typicalHours ?? 'UNKNOWN',
    finishedTasksMeasured: p.finishedSample,
    // Leave as a yes/no only: no dates, no approval state, no kind or reason (Arisha main review, 2 Nov 2026).
    leaveInNextDays: !!p.awaySoon,
    room: p.room,
  }));
  const kase = {
    kind: a.kind,
    level: a.level,
    person: L(a.userId),
    ruleSuggestion: { action: a.suggest.action, to: a.suggest.toUserId ? L(a.suggest.toUserId) : null, newDueAt: a.suggest.newDueAt },
  };
  const brief = [
    'A manager asks for your advice on rebalancing one piece of work in their team. Advise only: the manager decides and acts.',
    'Say in 3 to 6 short sentences whether the rule suggestion fits, what you would do instead if anything, and what the manager should check or ask the person first.',
    'Use only the facts below. UNKNOWN means not enough data, never good or bad. Do not rank people, judge their performance, or suggest discipline, pay or access changes.',
    `Time now: ${result.asOf}. Team load average: ${result.teamLoadAverage ?? 'UNKNOWN'} (high priority tasks count twice).`,
    `Case: ${JSON.stringify(kase)}`,
    `Team: ${JSON.stringify(team)}`,
  ].join('\n');
  return { brief, labels: labels.map(({ label, name }) => ({ label, name })) };
}

/** Puts the names back into the AI's answer for the manager's screen only. Longer labels first (Person A1 before Person A). */
export function rebalanceAiNames(text: string, labels: { label: string; name: string }[]): string {
  return [...labels].sort((x, y) => y.label.length - x.label.length).reduce((t, l) => t.split(l.label).join(l.name), text);
}