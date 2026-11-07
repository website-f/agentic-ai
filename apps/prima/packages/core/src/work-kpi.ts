import { isActHead, isHrDirector, visibleCompanyIds } from './access';
import { RULES } from './rules';
import { toMs } from './time';
import type { AuthorityGrant, Dataset, Id, IsoDate, IsoDateTime, User } from './types';

/**
 * Workflow KPIs for every department (Fauzan, 1 Nov 2026, restarted 5 Nov 2026: "Start now").
 *
 * - Speed and quality only, for now ("kpi scope will be bigger, but for now we need speed and quality to be measured").
 * - Time runs from when the work reaches the person (the previous step of the record), never from a start/stop button,
 *   and is counted in office minutes (Monday to Friday, HR-STAFF-HOURS, Malaysia time).
 * - Each person is timed on their own part only. Approvals are not timed ("their work end at their part of work").
 * - Staff work (doing, preparing, rework) is kept apart from checking work (reviewing, verifying, signing off).
 * - People are listed by name, never ranked. Targets are PROVISIONAL and versioned; each result is held against the
 *   target version in force when the step happened. What Prima does not record stays unknown, never zero or a pass.
 * - KPIs only inform. They never change access, grants or pay.
 * - Read-only: computed from records Prima already keeps, so nothing new is stored and no database change is needed.
 *
 * IT (Fauzan, 5 Nov 2026): this arrival-time view is the IT KPI; the staff start/pause board (it-workflow-metrics) is a
 * personal work log only, not a KPI.
 *
 * Finance payments and closes are measured by the Finance KPI view on the Finance branch (finance-kpi.ts); the same
 * rules apply, and this view lists Finance only for the steps of other departments' records that Finance does.
 */

/**
 * Every department (Fauzan, 5 Nov 2026: "Kpi will be done for all"). A department shows on the screen once a workflow
 * adapter covers it; each module adds its adapter with registerWorkKpiAdapter (docs/WORK_KPI_ADAPTER.md).
 */
export const WORK_KPI_DEPTS = [
  'it', 'operations', 'fwm', 'hr', 'chief_of_staff', 'pdpa', 'client_relations', 'finance',
  'arms_control', 'cms', 'transport', 'asset', 'procurement', 'director_office', 'legal', 'act', 'company_office',
] as const;
export type WorkKpiDept = (typeof WORK_KPI_DEPTS)[number];
export const WORK_KPI_DEPT_LABEL: Record<WorkKpiDept, string> = {
  it: 'IT',
  operations: 'Operations',
  fwm: 'Foreign Worker Management',
  hr: 'HR',
  chief_of_staff: 'Chief of Staff office',
  pdpa: 'PDPA',
  client_relations: 'Client relations',
  finance: 'Finance',
  arms_control: 'Arms Control',
  cms: 'CMS command centre',
  transport: 'Transport',
  asset: 'Asset Management',
  procurement: 'Procurement and Inventory',
  director_office: 'Director Office',
  legal: 'Legal and company secretary',
  act: 'ACT (Audit, Compliance and Transformation)',
  company_office: 'Company offices',
};

/** work = doing or redoing the job; check = reviewing, verifying or signing off someone else's work. */
export type WorkKpiKind = 'work' | 'check';

export interface WorkKpiSample {
  dept: WorkKpiDept;
  workflow: string;
  stage: string;
  kind: WorkKpiKind;
  recordId: Id;
  companyId: Id | null;
  byId: Id | null;
  by: string;
  /** When the work reached this person: the previous step of the record. */
  arrivedAt: IsoDateTime;
  doneAt: IsoDateTime;
  minutes: number;
  targetMinutes: number | null;
  /** A due time the record itself carries (a case SLA, a task due date); it wins over a minutes target. */
  dueAt: IsoDateTime | null;
  targetVersion: number | null;
  /**
   * How the minutes are counted: office minutes (the default), or round the clock for desks manned 24 hours a day,
   * such as the CMS command centre, where an alarm at 2 am is the night shift's work.
   */
  clock?: 'office' | 'round_the_clock';
}

export interface WorkKpiOutcome {
  dept: WorkKpiDept;
  workflow: string;
  recordId: Id;
  companyId: Id | null;
  /** Whose work a return counts against (never the checker's). */
  preparer: string | null;
  finishedAt: IsoDateTime;
  /** null = Prima does not keep this for the record. */
  returns: number | null;
  reopens: number | null;
  evidenceComplete: boolean | null;
  requesterConfirmed: boolean | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Office minutes

/**
 * Office minutes between two moments: only Monday to Friday within office hours (HR-STAFF-HOURS, 8.30 am to 5.30 pm
 * Malaysia time) count, so work arriving at 5 pm and done at 9 am the next working day took 60 office minutes. Public
 * holidays given as Malaysia dates (YYYY-MM-DD) do not count; Prima keeps no holiday calendar yet, so none are given.
 */
export function officeMinutes(a: IsoDateTime, b: IsoDateTime, holidays: readonly IsoDate[] = []): number {
  const start = toMs(a);
  const end = toMs(b);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return 0;
  const MYT = 8 * 3_600_000;
  const DAY = 86_400_000;
  const [sh, sm] = RULES.staffHours.value.start.split(':').map(Number);
  const [eh, em] = RULES.staffHours.value.end.split(':').map(Number);
  const off = new Set(holidays);
  let total = 0;
  for (let day = Math.floor((start + MYT) / DAY); day <= Math.floor((end + MYT) / DAY); day += 1) {
    const d = new Date(day * DAY);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || off.has(d.toISOString().slice(0, 10))) continue;
    const open = day * DAY - MYT + (sh * 60 + sm) * 60_000;
    const close = day * DAY - MYT + (eh * 60 + em) * 60_000;
    total += Math.max(0, Math.min(close, end) - Math.max(open, start));
  }
  return Math.round(total / 60_000);
}

/** The end of a Malaysia working day (5.30 pm) on a date, for records that carry a due date rather than a time. */
export function endOfOfficeDay(on: IsoDate): IsoDateTime {
  return `${on}T${RULES.staffHours.value.end}:00+08:00`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Targets

/**
 * Targets in office minutes, "optimum but reasonable" (Fauzan, 1 Nov 2026), approved by Fauzan on 5 Nov 2026. null = no target yet: the time is still measured and shown, without on-time.
 * A new version is added (never edited in place), so older results keep the target they were measured against.
 */
export interface WorkKpiTargetVersion {
  version: number;
  from: IsoDateTime;
  provisional: boolean;
  note: string;
  minutes: Record<string, number | null>;
}
export const WORK_KPI_TARGETS: readonly WorkKpiTargetVersion[] = [
  {
    version: 1,
    from: '2026-01-01T00:00:00+08:00',
    // Fauzan approved these targets and the "team leader" reading on 5 Nov 2026 ("1. Yes 2. Yes").
    provisional: false,
    note: 'Approved by the CEO on 5 Nov 2026; a new version is added when they are recalibrated after real use.',
    minutes: {
      'it.ticket.resolve_p1': 60,
      'it.ticket.resolve_p2': 240,
      'it.ticket.resolve_p3': 960,
      'operations.case.acknowledge': 15,
      'operations.case.resolve': null, // the case's own SLA time is the target
      'operations.case.sign_off': 60,
      'fwm.task.do': null, // the task's own due date is the target
      'fwm.task.review': 120,
      'fwm.hostel_bill.check': 120,
      'finance.hostel_bill.payment_slip': 480,
      'hr.staff_claim.hr_check': 240,
      'finance.staff_claim.payment': 960,
      'pdpa.case.step': 480,
      'client_relations.onboarding.step': null,
    },
  },
];

export function workKpiTargetAt(key: string, at: IsoDateTime, versions: readonly WorkKpiTargetVersion[] = WORK_KPI_TARGETS) {
  const inForce = versions.filter((v) => toMs(v.from) <= toMs(at)).sort((x, y) => x.version - y.version);
  const v = inForce[inForce.length - 1] ?? versions[0];
  if (!v) return { minutes: null, version: null };
  if (key in v.minutes) return { minutes: v.minutes[key] ?? null, version: v.version };
  // A module's own proposed target, until the owner approves it into a version of WORK_KPI_TARGETS.
  for (const a of ADAPTERS) if (a.targets && key in a.targets) return { minutes: a.targets[key] ?? null, version: 0 };
  return { minutes: null, version: v.version };
}

// ---------------------------------------------------------------------------------------------------------------------
// Adapters: one per workflow, each reading only what the record already keeps.

export type WorkKpiData = Pick<Dataset, 'itTickets' | 'cases' | 'fwmTasks' | 'hostelBills' | 'staffClaims' | 'expenseRequests' | 'pdpaCases' | 'clientAccounts'>;

interface Collect {
  samples: WorkKpiSample[];
  outcomes: WorkKpiOutcome[];
}

function sample(
  out: WorkKpiSample[],
  s: Omit<WorkKpiSample, 'minutes' | 'targetMinutes' | 'targetVersion' | 'dueAt'> & { dueAt?: IsoDateTime | null },
  holidays: readonly IsoDate[],
) {
  if (!s.arrivedAt || !s.doneAt || !(toMs(s.doneAt) >= toMs(s.arrivedAt))) return;
  const t = workKpiTargetAt(`${s.dept}.${s.workflow}.${s.stage}`, s.doneAt);
  const minutes = s.clock === 'round_the_clock' ? Math.round((toMs(s.doneAt) - toMs(s.arrivedAt)) / 60_000) : officeMinutes(s.arrivedAt, s.doneAt, holidays);
  out.push({ ...s, dueAt: s.dueAt ?? null, minutes, targetMinutes: t.minutes, targetVersion: t.version });
}

// ---------------------------------------------------------------------------------------------------------------------
// The adapter registry: every module adds one adapter for its own workflows.

/** What an adapter hands back: a timed step (from arrival) or a finished item's quality. */
export interface WorkKpiPut {
  /** One person's own part of a record, timed from arrivedAt (the previous step) to doneAt. Approvals are never put. */
  step(s: Omit<WorkKpiSample, 'minutes' | 'targetMinutes' | 'targetVersion' | 'dueAt'> & { dueAt?: IsoDateTime | null }): void;
  /** A finished item; anything Prima does not keep is null (Unknown), never 0 or true. */
  finished(o: WorkKpiOutcome): void;
}
export interface WorkKpiAdapter {
  id: string;
  /** The departments this adapter measures; a department shows on the screen once an adapter covers it. */
  depts: readonly WorkKpiDept[];
  /** The tables it reads; the service loads only these, through the viewer's own database walls. */
  tables: readonly (keyof Dataset)[];
  collect(data: Partial<Dataset>, put: WorkKpiPut): void;
  /** Proposed targets in office minutes, keyed dept.workflow.stage; shown as proposed (version 0) until approved. */
  targets?: Record<string, number | null>;
  /** What this adapter cannot measure, and what is not timed by decision, per department. */
  limits?: Partial<Record<WorkKpiDept, { unknown: string[]; notTimed: string[] }>>;
  /** The department head or lead who sees their own department (Fauzan, 5 Nov 2026: team leader = head or lead). */
  heads?: { dept: WorkKpiDept; is: (u: User) => boolean }[];
}
const ADAPTERS: WorkKpiAdapter[] = [];
/** Add (or replace, by id) a module's adapter. Call once at module load. */
export function registerWorkKpiAdapter(a: WorkKpiAdapter) {
  const i = ADAPTERS.findIndex((x) => x.id === a.id);
  if (i >= 0) ADAPTERS[i] = a;
  else ADAPTERS.push(a);
}
/** Remove an adapter by id (tests, or a module switched off). */
export function unregisterWorkKpiAdapter(id: string) {
  const i = ADAPTERS.findIndex((x) => x.id === id);
  if (i >= 0) ADAPTERS.splice(i, 1);
}
export function workKpiAdapters(): readonly WorkKpiAdapter[] {
  return ADAPTERS;
}
/** Every table the registered adapters read. */
export function workKpiTables(): (keyof Dataset)[] {
  return [...new Set(ADAPTERS.flatMap((a) => a.tables))];
}
/** Departments with at least one adapter, in the fixed order. */
export function workKpiCoveredDepts(): WorkKpiDept[] {
  const covered = new Set(ADAPTERS.flatMap((a) => a.depts));
  return WORK_KPI_DEPTS.filter((d) => covered.has(d));
}

function collect(d: Partial<Dataset>, holidays: readonly IsoDate[]): Collect {
  const samples: WorkKpiSample[] = [];
  const outcomes: WorkKpiOutcome[] = [];
  const put: WorkKpiPut = { step: (s) => sample(samples, s, holidays), finished: (o) => outcomes.push(o) };
  for (const a of ADAPTERS) a.collect(d, put);
  return { samples, outcomes };
}

function collectCore(d: Partial<WorkKpiData>, put: WorkKpiPut) {

  // IT: a request reaches IT when it is raised; IT's part ends when it is resolved. The requester confirms it.
  for (const t of d.itTickets ?? []) {
    if (!t.resolvedAt) continue;
    // A reopened request keeps only its last resolve time, so raise-to-resolve would also hold the requester's wait and
    // the first fix; its speed is unknown (the reopen still counts in quality).
    if (!(t.reopened ?? 0)) put.step({
        dept: 'it', workflow: 'ticket', stage: `resolve_${t.priority.toLowerCase()}`, kind: 'work', recordId: t.id, companyId: null,
        byId: t.resolvedById ?? t.assignedToId ?? null, by: t.resolvedBy ?? t.assignedTo ?? 'Not recorded', arrivedAt: t.at, doneAt: t.resolvedAt,
      });
    put.finished({
      dept: 'it', workflow: 'ticket', recordId: t.id, companyId: null, preparer: t.resolvedBy ?? t.assignedTo ?? null, finishedAt: t.resolvedAt,
      returns: null, reopens: t.reopened ?? 0, evidenceComplete: null, requesterConfirmed: t.status === 'resolved' ? !!t.confirmedAt : null,
    });
  }

  // Operations cases: acknowledging and resolving (office cases), and each escalation level's sign-off (site cases).
  for (const c of d.cases ?? []) {
    const ack = c.events.find((e) => e.action === 'Acknowledged');
    if (ack) put.step({ dept: 'operations', workflow: 'case', stage: 'acknowledge', kind: 'work', recordId: c.id, companyId: c.companyId, byId: null, by: ack.by, arrivedAt: c.openedAt, doneAt: ack.at });
    const resolved = [...c.events].reverse().find((e) => e.action === 'Resolved');
    if (resolved) {
      const before = [...c.events].filter((e) => toMs(e.at) < toMs(resolved.at) && e.action !== 'Note' && e.action !== 'photo' && e.action !== 'proof');
      const arrived = before[before.length - 1]?.at ?? c.openedAt;
      put.step({ dept: 'operations', workflow: 'case', stage: 'resolve', kind: 'work', recordId: c.id, companyId: c.companyId, byId: null, by: resolved.by, arrivedAt: arrived, doneAt: resolved.at, dueAt: c.slaDueAt });
    }
    let prev = c.openedAt;
    for (const s of c.signOffs ?? []) {
      // A step-in means the level below ran past its time; that wait is not the stepping-in person's, so it is not timed.
      if (!s.stepIn) put.step({ dept: 'operations', workflow: 'case', stage: 'sign_off', kind: 'check', recordId: c.id, companyId: c.companyId, byId: null, by: s.by, arrivedAt: prev, doneAt: s.at });
      prev = s.at;
    }
    const finished = [...c.events].reverse().find((e) => e.action === 'Closed') ?? (c.level === 'DONE' ? { at: c.signOffs?.[c.signOffs.length - 1]?.at } : null);
    if (finished?.at) {
      const proof = c.events.some((e) => e.action === 'proof') || (c.signOffs ?? []).some((s) => (s.proofIds ?? []).length > 0);
      put.finished({
        dept: 'operations', workflow: 'case', recordId: c.id, companyId: c.companyId, preparer: resolved?.by ?? c.owner, finishedAt: finished.at,
        returns: c.signOffs ? c.signOffs.filter((s) => s.outcome === 'sent_back').length : null, reopens: null, evidenceComplete: proof, requesterConfirmed: null,
      });
    }
  }

  // FWM tasks: the OM does the task (due on its date), then FWM reviews it.
  for (const t of d.fwmTasks ?? []) {
    if (t.doneAt) put.step({ dept: 'fwm', workflow: 'task', stage: 'do', kind: 'work', recordId: t.id, companyId: t.companyId, byId: t.doneById ?? null, by: t.doneBy ?? 'Not recorded', arrivedAt: t.createdAt, doneAt: t.doneAt, dueAt: endOfOfficeDay(t.dueOn) });
    if (t.doneAt && t.reviewedAt) put.step({ dept: 'fwm', workflow: 'task', stage: 'review', kind: 'check', recordId: t.id, companyId: t.companyId, byId: null, by: t.reviewedBy ?? 'Not recorded', arrivedAt: t.doneAt, doneAt: t.reviewedAt });
    if (t.status === 'accepted' && t.reviewedAt) {
      // Prima keeps only the latest round of a task, so earlier returns are not known.
      put.finished({ dept: 'fwm', workflow: 'task', recordId: t.id, companyId: t.companyId, preparer: t.doneBy, finishedAt: t.reviewedAt, returns: null, reopens: null, evidenceComplete: t.proofIds.length > 0, requesterConfirmed: null });
    }
  }

  // Hostel bills: FWM checks the request; the approvals are not timed; the payment slip follows the last approval.
  for (const b of d.hostelBills ?? []) {
    if (b.request && b.fwmCheck) put.step({ dept: 'fwm', workflow: 'hostel_bill', stage: 'check', kind: 'check', recordId: b.id, companyId: b.companyId, byId: b.fwmCheck.userId, by: b.fwmCheck.by, arrivedAt: b.request.at, doneAt: b.fwmCheck.at });
    if (b.cooApproval && b.slip) put.step({ dept: 'finance', workflow: 'hostel_bill', stage: 'payment_slip', kind: 'work', recordId: b.id, companyId: b.companyId, byId: b.slip.userId, by: b.slip.by, arrivedAt: b.cooApproval.at, doneAt: b.slip.at });
    if (b.status === 'paid' && b.slip) {
      put.finished({ dept: 'fwm', workflow: 'hostel_bill', recordId: b.id, companyId: b.companyId, preparer: b.request?.by ?? b.createdBy, finishedAt: b.slip.at, returns: b.returned ? 1 : 0, reopens: null, evidenceComplete: b.billDocIds.length > 0 && b.slip.docIds.length > 0, requesterConfirmed: null });
    }
  }

  // Staff claims: HR checks after the Chief of Staff's approval (approvals not timed); Finance pays after the decision.
  for (const c of d.staffClaims ?? []) {
    if (c.cosApproval && c.hrDecision) put.step({ dept: 'hr', workflow: 'staff_claim', stage: 'hr_check', kind: 'check', recordId: c.id, companyId: c.companyId, byId: c.hrDecision.userId, by: c.hrDecision.by, arrivedAt: c.cosApproval.at, doneAt: c.hrDecision.at });
    const decided = c.cooDecision ?? c.hrDecision;
    if (decided && c.paid) put.step({ dept: 'finance', workflow: 'staff_claim', stage: 'payment', kind: 'work', recordId: c.id, companyId: c.companyId, byId: c.paid.userId, by: c.paid.by, arrivedAt: decided.at, doneAt: c.paid.at });
  }

  // Office expense requests: only approvals, which are not timed; quality is whether it passed without a return.
  for (const e of d.expenseRequests ?? []) {
    const done = e.cooDecision ?? e.cosApproval;
    if (e.status === 'approved' && done) {
      put.finished({ dept: 'chief_of_staff', workflow: 'expense_request', recordId: e.id, companyId: e.companyId, preparer: e.requestedBy, finishedAt: done.at, returns: e.returned ? 1 : 0, reopens: null, evidenceComplete: e.docIds.length > 0, requesterConfirmed: null });
    }
  }

  // PDPA cases: each recorded step, timed from the step before it.
  for (const p of d.pdpaCases ?? []) {
    let prev = p.openedAt;
    for (const s of p.steps) {
      put.step({ dept: 'pdpa', workflow: 'case', stage: 'step', kind: 'work', recordId: p.id, companyId: p.companyId, byId: null, by: s.by, arrivedAt: prev, doneAt: s.at });
      prev = s.at;
    }
    if (p.status === 'closed' && p.steps.length) {
      const last = p.steps[p.steps.length - 1];
      put.finished({ dept: 'pdpa', workflow: 'case', recordId: p.id, companyId: p.companyId, preparer: p.openedBy, finishedAt: last.at, returns: null, reopens: null, evidenceComplete: p.steps.some((s) => !!s.docId), requesterConfirmed: null });
    }
  }

  // Client onboarding: each checklist step, timed from the step done before it (or the client's start date).
  for (const a of d.clientAccounts ?? []) {
    const done = a.onboarding.filter((s) => s.doneAt).sort((x, y) => toMs(x.doneAt!) - toMs(y.doneAt!));
    let prev: IsoDateTime = `${a.startedOn}T${RULES.staffHours.value.start}:00+08:00`;
    for (const s of done) {
      put.step({ dept: 'client_relations', workflow: 'onboarding', stage: 'step', kind: 'work', recordId: a.id, companyId: a.companyId, byId: null, by: s.by ?? 'Not recorded', arrivedAt: prev, doneAt: s.doneAt! });
      prev = s.doneAt!;
    }
    if (a.onboarding.length && done.length === a.onboarding.length) {
      put.finished({ dept: 'client_relations', workflow: 'onboarding', recordId: a.id, companyId: a.companyId, preparer: null, finishedAt: done[done.length - 1].doneAt!, returns: null, reopens: null, evidenceComplete: a.onboarding.every((s) => !!s.docId), requesterConfirmed: null });
    }
  }
}

/** What each department's view cannot measure yet, and what is deliberately not timed. */
export const WORK_KPI_LIMITS: Partial<Record<WorkKpiDept, { unknown: string[]; notTimed: string[] }>> = {
  it: {
    unknown: ['Speed of a reopened request: Prima keeps only the last resolve time, so it is left out of speed (the reopen still counts in quality)', 'Waiting before a request is assigned counts against the person who resolved it', 'Who resolved older requests closed before 31 Oct 2026'],
    notTimed: ['COO or CEO approvals of IT purchases'],
  },
  operations: { unknown: ['Who acknowledged by staff id: cases record the name only', 'Sign-offs made by a higher level stepping in: the wait belongs to the level below, so they are not timed'], notTimed: ['Company closing a case after the Regional OM confirms it'] },
  fwm: { unknown: ['Earlier returns of a task: Prima keeps only the latest round, so a returned-and-redone task is timed from when it was first sent'], notTimed: ['Sector and COO approvals of hostel bills'] },
  hr: { unknown: ['Leave: a decision is an approval, so it is not timed; preparing staff pay is measured on the HR branch'], notTimed: ['Chief of Staff approval of claims', 'Leave decisions'] },
  chief_of_staff: { unknown: [], notTimed: ['Chief of Staff and COO approvals of office expense requests'] },
  pdpa: { unknown: ['Which steps were the PDPA officer’s and which were others’: steps record the name only'], notTimed: [] },
  client_relations: { unknown: ['No target yet for onboarding steps'], notTimed: [] },
  finance: {
    unknown: ['Payments and month-end closes are measured in the Finance KPI view (Finance branch, not yet merged)'],
    notTimed: ['Finance Director, CEO and COO approvals'],
  },
};

/** The workflows on main: IT, Operations, FWM, HR, Chief of Staff office, PDPA, client onboarding, Finance steps. */
registerWorkKpiAdapter({
  id: 'core',
  depts: ['it', 'operations', 'fwm', 'hr', 'chief_of_staff', 'pdpa', 'client_relations', 'finance'],
  tables: ['itTickets', 'cases', 'fwmTasks', 'hostelBills', 'staffClaims', 'expenseRequests', 'pdpaCases', 'clientAccounts'],
  collect: collectCore,
  limits: WORK_KPI_LIMITS,
  heads: [
    { dept: 'finance', is: (u) => u.leadership === 'finance_director' || (u.department === 'finance' && u.financeRole === 'leader') },
    { dept: 'it', is: (u) => u.department === 'it' && (u.itRole === 'manager' || u.itRole === 'lead') },
    { dept: 'fwm', is: (u) => u.department === 'fwm' && (u.fwmRole === 'manager' || u.fwmRole === 'deputy') },
    { dept: 'pdpa', is: (u) => u.department === 'pdpa' },
  ],
});

function limitsFor(dept: WorkKpiDept) {
  const unknown: string[] = [];
  const notTimed: string[] = [];
  for (const a of ADAPTERS) {
    const l = a.limits?.[dept];
    if (l) unknown.push(...l.unknown), notTimed.push(...l.notTimed);
  }
  return { unknown: [...new Set(unknown)], notTimed: [...new Set(notTimed)] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Who sees what

export interface WorkKpiScope {
  depts: readonly WorkKpiDept[];
  /** null = every company. */
  companyIds: Id[] | null;
  label: string;
}

/**
 * Who keeps the KPIs (Fauzan, 1 Nov 2026): the team leader, the Finance Director, the CEO, the COO, the ACT Director and
 * the HR department. Across departments the team leader is each department's head or lead (confirmed by Fauzan, 5 Nov 2026), for their own
 * department only; the Finance Director sees Finance. Staff have no standing view of their own KPIs: HR shows them in a
 * review. Integrations (JA feed, door feed, Planner) never see them.
 */
export function workKpiScope(user: User, grants: AuthorityGrant[], today: IsoDate): WorkKpiScope | null {
  if (user.integration || user.accessClosed) return null;
  const all = { depts: workKpiCoveredDepts(), companyIds: null };
  if (user.role === 'director') return { ...all, label: 'All departments' };
  if (user.role === 'pwvsb_officer') {
    if (user.opsTier === 'ceo' || user.opsTier === 'coo' || isActHead(user) || isHrDirector(user) || user.department === 'hr') return { ...all, label: 'All departments' };
    // Each department's head or lead, as the department's adapters declare them.
    const covered = workKpiCoveredDepts();
    const own = covered.filter((d) => ADAPTERS.some((a) => (a.heads ?? []).some((h) => h.dept === d && h.is(user))));
    if (own.length) return { depts: own, companyIds: null, label: own.map((d) => WORK_KPI_DEPT_LABEL[d]).join(', ') };
    if (user.opsTier === 'ops_director') return { depts: ['operations', 'client_relations'], companyIds: null, label: 'Operations' };
    if (user.opsTier === 'ogm' || user.opsTier === 'regional')
      return { depts: ['operations', 'client_relations'], companyIds: visibleCompanyIds(user, grants, today), label: 'Operations, own companies' };
    return null;
  }
  // The company's head (Company Manager or GM) is the company office's team leader: own companies only.
  if (user.role === 'company_manager') {
    const depts = (['operations', 'client_relations', 'company_office'] as const).filter((d) => d !== 'company_office' || workKpiCoveredDepts().includes(d));
    return { depts, companyIds: [...user.companyIds], label: 'Own company' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The view

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

function onTime(s: WorkKpiSample): boolean | null {
  if (s.dueAt) return toMs(s.doneAt) <= toMs(s.dueAt);
  if (s.targetMinutes != null) return s.minutes <= s.targetMinutes;
  return null;
}

function stages(xs: WorkKpiSample[]) {
  const keys = [...new Set(xs.map((x) => `${x.workflow}.${x.stage}`))].sort();
  return keys.map((key) => {
    const mine = xs.filter((x) => `${x.workflow}.${x.stage}` === key);
    const judged = mine.map(onTime).filter((x): x is boolean => x != null);
    const last = mine[mine.length - 1];
    return {
      workflow: last.workflow,
      stage: last.stage,
      kind: last.kind,
      count: mine.length,
      medianMinutes: median(mine.map((x) => x.minutes)),
      targetMinutes: last.dueAt ? null : last.targetMinutes,
      target: last.dueAt ? 'the record’s own due time' : last.targetMinutes != null ? `${last.targetMinutes} ${last.clock === 'round_the_clock' ? 'minutes, round the clock' : 'office minutes'} (${last.targetVersion === 0 ? 'proposed' : `v${last.targetVersion}`})` : 'none yet',
      clock: last.clock ?? 'office',
      onTimePct: judged.length ? pct(judged.filter(Boolean).length, judged.length) : null,
    };
  });
}

function quality(xs: WorkKpiOutcome[]) {
  const keys = [...new Set(xs.map((x) => x.workflow))].sort();
  return keys.map((workflow) => {
    const mine = xs.filter((x) => x.workflow === workflow);
    const known = <K extends keyof WorkKpiOutcome>(k: K) => mine.filter((x) => x[k] != null);
    const ret = known('returns');
    const reo = known('reopens');
    const ev = known('evidenceComplete');
    const conf = known('requesterConfirmed');
    return {
      workflow,
      finished: mine.length,
      // First pass = finished with no return and no reopen, among the records where Prima knows both.
      firstPassPct: ret.length || reo.length ? pct(mine.filter((x) => (x.returns ?? 0) === 0 && (x.reopens ?? 0) === 0 && (x.returns != null || x.reopens != null)).length, mine.filter((x) => x.returns != null || x.reopens != null).length) : null,
      returns: ret.length ? ret.reduce((n, x) => n + (x.returns ?? 0), 0) : null,
      reopens: reo.length ? reo.reduce((n, x) => n + (x.reopens ?? 0), 0) : null,
      evidenceCompletePct: ev.length ? pct(ev.filter((x) => x.evidenceComplete).length, ev.length) : null,
      requesterConfirmedPct: conf.length ? pct(conf.filter((x) => x.requesterConfirmed).length, conf.length) : null,
    };
  });
}

export function inPeriod(at: IsoDateTime, period: string): boolean {
  return at.slice(0, 7) === period;
}

export function buildWorkKpi(data: Partial<Dataset>, scope: WorkKpiScope, period: string, holidays: readonly IsoDate[] = []) {
  const all = collect(data, holidays);
  const keep = <T extends { dept: WorkKpiDept; companyId: Id | null }>(x: T) =>
    scope.depts.includes(x.dept) && (scope.companyIds == null || (x.companyId != null && scope.companyIds.includes(x.companyId)));
  const samples = all.samples.filter((s) => keep(s) && inPeriod(s.doneAt, period));
  const outcomes = all.outcomes.filter((o) => keep(o) && inPeriod(o.finishedAt, period));
  const departments = scope.depts.map((dept) => {
    const mine = samples.filter((s) => s.dept === dept);
    const names = [...new Set(mine.map((s) => s.by))].sort((a, b) => a.localeCompare(b));
    return {
      dept,
      label: WORK_KPI_DEPT_LABEL[dept],
      // Staff work and checking work are shown apart.
      work: stages(mine.filter((s) => s.kind === 'work')),
      checking: stages(mine.filter((s) => s.kind === 'check')),
      quality: quality(outcomes.filter((o) => o.dept === dept)),
      // Listed by name, never ranked by speed.
      people: names.map((name) => ({ name, stages: stages(mine.filter((s) => s.by === name)) })),
      ...limitsFor(dept),
    };
  });
  const targets = WORK_KPI_TARGETS[WORK_KPI_TARGETS.length - 1];
  return {
    period,
    scope: scope.label,
    provisional: targets.provisional,
    targetsVersion: targets.version,
    targetsNote: targets.note,
    measuredFrom: 'when the work reaches the person (the record’s previous step), in office minutes: Monday to Friday, 8.30 am to 5.30 pm Malaysia time; public holidays are not known to Prima yet and still count',
    departments,
    note: 'For monitoring only: never used to grant access or for any automatic employment or pay decision.',
  };
}

export function workKpiPeriod(input: unknown, today: IsoDate): string {
  return typeof input === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(input) ? input : today.slice(0, 7);
}
