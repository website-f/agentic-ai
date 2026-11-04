import { RULES } from './rules';
import { addDays, fromMs, toMs } from './time';
import type { IsoDate, IsoDateTime, ItTenderStep, ItTenderTask } from './types';

/**
 * The timeline of an eP (ePerolehan) or government tender for the IT part (Fauzan, 28 Oct 2026). Every step has one
 * owner and a target time in minutes; its clock starts when the step before it is done, so the bid moves as fast as the
 * work allows ("the earlier we submit, the better the chances"). The closing date is only the last line: the bid goes
 * into eP at least a day before it.
 */
export function itTenderTimeline(kind: NonNullable<ItTenderTask['kind']>, closesOn: IsoDate): ItTenderStep[] {
  return RULES.itTender.value[kind].map(([key, label, owner, after, minutes]) => ({
    key,
    label,
    owner,
    after,
    minutes,
    dueOn: addDays(closesOn, key === 'result' ? 30 : -1),
    doneAt: null,
    by: null,
    note: '',
  }));
}

/** Where each step stands now: when its clock started, when it is due, how long it took, and whether it is late. */
export function itTenderClock(t: ItTenderTask, now: IsoDateTime) {
  const steps = t.steps ?? [];
  const startOf = (s: ItTenderStep): IsoDateTime | null => {
    if (!s.after) return t.foundAt ?? null;
    return steps.find((x) => x.key === s.after)?.doneAt ?? null;
  };
  const rows = steps.map((s) => {
    const start = startOf(s);
    const dueAt = start && s.minutes != null ? fromMs(toMs(start) + s.minutes * 60_000) : null;
    const tookMin = s.doneAt && start ? Math.max(0, Math.round((toMs(s.doneAt) - toMs(start)) / 60_000)) : null;
    const pastClose = !s.doneAt && s.key !== 'result' && now.slice(0, 10) > s.dueOn;
    const late = s.doneAt ? tookMin != null && s.minutes != null && tookMin > s.minutes : (!!dueAt && now > dueAt) || pastClose;
    const lateMin = !s.doneAt && dueAt && now > dueAt ? Math.round((toMs(now) - toMs(dueAt)) / 60_000) : 0;
    return { step: s, start, dueAt, tookMin, late, lateMin, ready: !s.doneAt && !!start };
  });
  const submitted = steps.find((x) => x.key === 'submit')?.doneAt ?? null;
  // The target is the longest chain from found to submitted; steps side by side (the company's papers) overlap.
  const finish = new Map<string, number>();
  const ef = (s: ItTenderStep): number => {
    if (finish.has(s.key)) return finish.get(s.key)!;
    const before = [s.after, ...(s.key === 'handover' ? ['gotdocs'] : [])]
      .map((k) => steps.find((x) => x.key === k))
      .filter((x): x is ItTenderStep => !!x);
    const v = Math.max(0, ...before.map(ef)) + (s.key === 'briefing' ? 0 : (s.minutes ?? 0));
    finish.set(s.key, v);
    return v;
  };
  const sub = steps.find((x) => x.key === 'submit');
  const target = sub ? ef(sub) : 0;
  return {
    rows,
    /** Minutes from finding the tender to the eP submission, against the target on the longest chain. */
    totalMin: submitted && t.foundAt ? Math.round((toMs(submitted) - toMs(t.foundAt)) / 60_000) : null,
    targetMin: target,
    late: rows.filter((r) => r.late && !r.step.doneAt).length,
  };
}
