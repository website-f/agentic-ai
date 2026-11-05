import { AccessDenied, GROUP_EMPLOYER_ID, isActHead, isHrDirector } from './access';
import { FIN_AUTO, finActor, finDefaults, finSettingsOf, isFinCoo, type FinanceDeskService } from './finance';
import type { Store } from './store';
import { RULES } from './rules';
import { toMs } from './time';
import type { FinSettingsValues, FinStatus, FinStep, Id, IsoDateTime, User } from './types';

/**
 * Finance KPIs (Fauzan, 1 Nov 2026): speed and quality, measured from when the work reaches each person (no start/stop
 * button), and only on each person's own part: approvals are not timed. Kept to what Prima records: every step's person and time. Staff work (preparing, rework) is kept apart from
 * checking work (review, approval, release). People are listed by name, never ranked. KPIs only inform: they never
 * change access, grants or pay. Targets are the FD's Settings, PROVISIONAL until calibrated, and each result is held
 * against the target version in force when the step happened.
 *
 * Who sees them (Fauzan, 1 Nov 2026): the team leader (own team), the Finance Director, the CEO, the COO, the ACT
 * Director and the HR department.
 */
export type FinKpiStage = 'review' | 'release' | 'rework' | 'close_review';
// Approvals are not timed (Fauzan, 1 Nov 2026: "approve wait time will not be measured. their work end at their part
// of work"): each person is timed only on their own part; the release clock starts when the approval reaches Finance.
const STAGE_OF: Partial<Record<FinStep['step'], FinKpiStage>> = { reviewed: 'review', released: 'release', resubmitted: 'rework' };
const CHECKING: FinKpiStage[] = ['review', 'release', 'close_review'];

export function finKpiViewer(user: User): 'all' | { team: number } | null {
  if (user.integration) return null;
  const a = finActor(user);
  if (a?.kind === 'ceo' || a?.kind === 'director') return 'all';
  if (a?.kind === 'leader' && a.team != null) return { team: a.team };
  if (isFinCoo(user) || isActHead(user)) return 'all';
  // HR includes the Chief of Staff and the Deputy, who are the HR Director (Fauzan, 1 Nov 2026: "2. yes").
  if ((user.role === 'pwvsb_officer' && user.department === 'hr') || isHrDirector(user)) return 'all';
  // Staff have no standing view of their own KPIs: they see them only when HR calls them in for a review (Fauzan,
  // 1 Nov 2026), which the HR KPI review handles; this Finance view never opens to them.
  return null;
}

/** The settings in force at a moment: the latest version set on or before it, else the defaults. */
export function finSettingsAt(group: Pick<FinStatus, 'settings'> | null | undefined, at: IsoDateTime): FinSettingsValues {
  const st = group?.settings;
  if (!st) return finDefaults();
  const versions = [...st.history, { values: st.values, set: st.set }].filter((v) => toMs(v.set.at) <= toMs(at));
  const v = versions[versions.length - 1];
  return v ? { ...finDefaults(), ...v.values } : finDefaults();
}

/**
 * Office minutes between two moments (Fauzan, 1 Nov 2026: targets in minutes, "optimum but reasonable"): only Monday to
 * Friday within office hours (rule HR-STAFF-HOURS, 8.30 am to 5.30 pm Malaysia time) count, so work arriving at 5 pm
 * and done at 9 am the next day took 60 office minutes. Public holidays are not known to Prima yet and still count.
 */
export function finOfficeMinutes(a: IsoDateTime, b: IsoDateTime): number {
  const start = toMs(a);
  const end = toMs(b);
  if (!(end > start)) return 0;
  const MYT = 8 * 3_600_000;
  const [sh, sm] = RULES.staffHours.value.start.split(':').map(Number);
  const [eh, em] = RULES.staffHours.value.end.split(':').map(Number);
  let day = Math.floor((start + MYT) / 86_400_000);
  const last = Math.floor((end + MYT) / 86_400_000);
  let total = 0;
  for (; day <= last; day += 1) {
    const dow = new Date(day * 86_400_000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const open = day * 86_400_000 - MYT + (sh * 60 + sm) * 60_000;
    const close = day * 86_400_000 - MYT + (eh * 60 + em) * 60_000;
    total += Math.max(0, Math.min(close, end) - Math.max(open, start));
  }
  return Math.round(total / 60_000);
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

type Sample = { stage: FinKpiStage; byId: Id; by: string; team: number; minutes: number; target: number | null; at: IsoDateTime };

/** Every timed step in the month, with how long the work waited for that person and the target in force then. */
export function finKpiSamples(rows: FinStatus[], group: Pick<FinStatus, 'settings'> | null | undefined, period: string): Sample[] {
  const out: Sample[] = [];
  const inMonth = (at: IsoDateTime) => at.slice(0, 7) === period;
  for (const f of rows) {
    for (const p of f.payments ?? []) {
      p.steps.forEach((st, i) => {
        const stage = STAGE_OF[st.step];
        if (!stage || i === 0 || !inMonth(st.at) || st.byId === FIN_AUTO.byId) return;
        const t = finSettingsAt(group, st.at);
        const target = stage === 'review' ? t.kpiReviewMinutes : stage === 'release' ? t.kpiReleaseMinutes : t.kpiReworkMinutes;
        out.push({ stage, byId: st.byId, by: st.by, team: f.team, minutes: finOfficeMinutes(p.steps[i - 1].at, st.at), target, at: st.at });
      });
    }
    for (const c of f.closes ?? []) {
      c.steps.forEach((st, i) => {
        if (i === 0 || !inMonth(st.at)) return;
        const stage: FinKpiStage | null = st.step === 'reviewed' ? 'close_review' : null;
        if (!stage) return;
        const t = finSettingsAt(group, st.at);
        out.push({ stage, byId: st.byId, by: st.by, team: f.team, minutes: finOfficeMinutes(c.steps[i - 1].at, st.at), target: t.kpiCloseReviewMinutes, at: st.at });
      });
    }
  }
  return out;
}

/** Quality for the month: payments finished (released or cancelled) and closes approved, with every return cycle kept. */
export function finKpiQuality(rows: FinStatus[], period: string) {
  const people = new Map<Id, { by: string; team: number; finished: number; firstPass: number; returns: number; reasons: string[] }>();
  let finished = 0;
  let firstPass = 0;
  let lapses = 0;
  let returnCycles = 0;
  let closes = 0;
  let closesFirstPass = 0;
  let reopens = 0;
  for (const f of rows) {
    for (const p of f.payments ?? []) {
      const last = p.steps[p.steps.length - 1];
      if (p.status !== 'released' || last.at.slice(0, 7) !== period) continue;
      finished += 1;
      const returns = p.steps.filter((x) => x.step === 'returned' && x.byId !== FIN_AUTO.byId);
      lapses += p.steps.filter((x) => x.step === 'returned' && x.byId === FIN_AUTO.byId).length;
      returnCycles += returns.length;
      if (!returns.length) firstPass += 1;
      // A return counts against the preparer's first pass, never the checker's.
      const prep = p.steps[0];
      const row = people.get(prep.byId) ?? { by: prep.by, team: f.team, finished: 0, firstPass: 0, returns: 0, reasons: [] };
      row.finished += 1;
      if (!returns.length) row.firstPass += 1;
      row.returns += returns.length;
      row.reasons.push(...returns.map((r) => r.comment));
      people.set(prep.byId, row);
    }
    for (const c of f.closes ?? []) {
      const ap = [...c.steps].reverse().find((x) => x.step === 'approved');
      if (!ap || ap.at.slice(0, 7) !== period) continue;
      closes += 1;
      if (!c.steps.some((x) => x.step === 'returned')) closesFirstPass += 1;
      reopens += c.steps.filter((x) => x.step === 'reopened').length;
    }
  }
  return {
    payments: { finished, firstPassPct: pct(firstPass, finished), returnCycles, lapses },
    closes: { approved: closes, firstPassPct: pct(closesFirstPass, closes), reopens },
    preparers: [...people.entries()].map(([id, r]) => ({ id, by: r.by, team: r.team, finished: r.finished, firstPassPct: pct(r.firstPass, r.finished), returns: r.returns, reasons: r.reasons })),
  };
}

function summarise(xs: Sample[]) {
  const timed = xs.filter((x) => x.target != null);
  return {
    count: xs.length,
    medianMinutes: median(xs.map((x) => x.minutes)),
    targetMinutes: timed.length ? timed[timed.length - 1].target : null,
    onTimePct: timed.length ? pct(timed.filter((x) => x.minutes <= x.target!).length, timed.length) : null,
  };
}

export class FinanceKpiService {
  constructor(
    private store: Store,
    private desk: FinanceDeskService,
  ) {}

  async view(user: User, periodIn?: unknown) {
    const scope = finKpiViewer(user);
    if (!scope) throw new AccessDenied('view', '(Finance KPIs: team leader, Finance Director, CEO, COO, ACT Director and HR)');
    const period = typeof periodIn === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodIn) ? periodIn : this.desk.closePeriod();
    const [all, group] = await Promise.all([this.store.list('finStatus'), this.store.get('finStatus', `fin-${GROUP_EMPLOYER_ID}`)]);
    const rows = all.filter((f) => scope === 'all' || f.team === scope.team);
    const samples = finKpiSamples(rows, group, period);
    const quality = finKpiQuality(rows, period);
    const stages = (xs: Sample[]) =>
      (['review', 'release', 'rework', 'close_review'] as FinKpiStage[])
        .map((stage) => ({ stage, checking: CHECKING.includes(stage), ...summarise(xs.filter((x) => x.stage === stage)) }))
        .filter((x) => x.count);
    const teams = [...new Set(rows.map((f) => f.team))].sort((a, b) => a - b);
    const ids = [...new Set(samples.map((x) => x.byId))];
    const people = ids
      .map((id) => {
        const mine = samples.filter((x) => x.byId === id);
        return { id, name: mine[0].by, teams: [...new Set(mine.map((x) => x.team))], stages: stages(mine) };
      })
      // Listed by name, never ranked by speed.
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      period,
      scope: scope === 'all' ? 'all' : `team ${scope.team}`,
      provisional: true,
      targets: finSettingsOf(group),
      measuredFrom: 'when the work reaches the person (the previous step), in office minutes (Monday to Friday, 8.30 am to 5.30 pm)',
      unknown: ['Time to prepare a payment: the request arrives outside Prima (SharePoint, email), so it is not measured'],
      notTimed: ['Approvals (Finance Director, CEO, COO): not timed, by decision; each person is timed on their own part only'],
      overall: { stages: stages(samples), quality: { payments: quality.payments, closes: quality.closes } },
      teams: teams.map((t) => ({ team: t, stages: stages(samples.filter((x) => x.team === t)) })),
      people,
      preparers: quality.preparers.sort((a, b) => a.by.localeCompare(b.by)),
      note: 'For monitoring only: never used to grant access or for any automatic employment or pay decision.',
    };
  }
}
