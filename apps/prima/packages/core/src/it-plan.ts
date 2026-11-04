// The IT team's work plan (Fauzan, 28 Oct 2026): the IT Manager makes sure the team's work is planned properly for the
// week, the month and the year. The regular work (servicing, six-month health inspections, renewals, access reviews, tender closing
// dates) is laid out from the registers; the manager gives each piece to someone as a job with a due date, and the plan
// shows each person's load and anything due that nobody has been given.

import { RULES } from './rules';
import { addDays } from './time';
import type { Id, IsoDate, ItAccount, ItAsset, ItAssetInspection, ItDomain, ItJob, ItJobKind, ItTenderTask, User } from './types';

export type PlanSpan = 'week' | 'month' | 'year';

/** A piece of regular work the registers say is due, which should be given to someone as a job. */
export interface PlanDue {
  key: string;
  what: 'service' | 'check' | 'domain' | 'ssl' | 'access' | 'tender';
  title: string;
  detail: string;
  dueOn: IsoDate;
  /** Due before today and not yet given. */
  overdue: boolean;
  jobKind: ItJobKind;
  technical: boolean;
  /** The job that covers it, when one was given from the plan. */
  jobId: Id | null;
  assignee: string | null;
  /** Tenders are planned on the tender itself: who owns it. */
  owner?: string | null;
}

export interface PlanBucket {
  from: IsoDate;
  to: IsoDate;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dow(d: IsoDate): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}
/** Monday of the week the date falls in. */
export function weekStart(d: IsoDate): IsoDate {
  return addDays(d, -((dow(d) + 6) % 7));
}
function addMonths(d: IsoDate, m: number): IsoDate {
  const [y, mo, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
const label = (d: IsoDate) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The period the plan covers, split into days (week), weeks (month) or months (year). */
export function planPeriod(span: PlanSpan, anchor: IsoDate): { from: IsoDate; to: IsoDate; buckets: PlanBucket[]; title: string } {
  if (span === 'week') {
    const from = weekStart(anchor);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { from: d, to: d, label: `${DAYS[dow(d)]} ${label(d)}` };
    });
    return { from, to: addDays(from, 6), buckets, title: `Week of ${label(from)} ${from.slice(0, 4)}` };
  }
  if (span === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const to = addDays(addMonths(from, 1), -1);
    const buckets: PlanBucket[] = [];
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
      const a = w < from ? from : w;
      const b = addDays(w, 6) > to ? to : addDays(w, 6);
      buckets.push({ from: a, to: b, label: `${label(a)} to ${label(b)}` });
    }
    return { from, to, buckets, title: `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` };
  }
  const from = `${anchor.slice(0, 4)}-01-01`;
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const a = addMonths(from, i);
    return { from: a, to: addDays(addMonths(a, 1), -1), label: `${MONTHS[i]} ${from.slice(0, 4)}` };
  });
  return { from, to: `${anchor.slice(0, 4)}-12-31`, buckets, title: `Year ${from.slice(0, 4)}` };
}

/** The first day of the next week, month or year. There is no fixed date to give out the plan (Fauzan, 28 Oct 2026). */
export function planNext(span: PlanSpan, today: IsoDate): IsoDate {
  if (span === 'week') return addDays(weekStart(today), 7);
  if (span === 'month') return addMonths(`${today.slice(0, 7)}-01`, 1);
  return `${Number(today.slice(0, 4)) + 1}-01-01`;
}

/** When regular work falls due: every `months` from `first`; anything already past is due today (once). */
function occurrences(first: IsoDate, months: number, today: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let i = 0;
  let d = first;
  if (d < today) {
    out.push(today);
    while (d < today && i < 60) d = addMonths(first, months * ++i);
  }
  for (; d <= to && i < 120; d = addMonths(first, months * ++i)) out.push(d);
  return out;
}

/**
 * The regular work due in [from, to], grouped so the plan stays readable: servicing and six-month health inspections are one piece of
 * work per owner a month; each domain, certificate and access review is its own piece.
 */
export function planDues(input: {
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  assets: ItAsset[];
  inspections?: ItAssetInspection[];
  domains: ItDomain[];
  accounts: ItAccount[];
  tenders: ItTenderTask[];
  jobs: ItJob[];
  ownerName: (id: Id) => string;
  staffName: (id: Id | null | undefined) => string | null;
}): PlanDue[] {
  const { from, to, today } = input;
  const rule = RULES.it.value;
  const access = RULES.itJobs.value.accessReviewDays;
  const live = input.assets.filter((a) => a.status !== 'disposed' && a.status !== 'disposal_pending');
  const due: Omit<PlanDue, 'jobId' | 'assignee' | 'overdue'>[] = [];
  // Work already overdue is placed on today, when today is in the period.
  const place = (d: IsoDate) => (d < today ? today : d);
  const inRange = (d: IsoDate) => d >= from && d <= to;

  const groups = new Map<string, { what: 'service' | 'check'; owner: Id; month: string; dueOn: IsoDate; tags: string[] }>();
  const addGroup = (what: 'service' | 'check', a: ItAsset, d: IsoDate) => {
    const on = place(d);
    if (!inRange(on)) return;
    const k = `${what==='check'?'inspection':what}:${a.ownerId}:${on.slice(0, 7)}`;
    const g = groups.get(k) ?? { what, owner: a.ownerId, month: on.slice(0, 7), dueOn: on, tags: [] };
    if (on < g.dueOn) g.dueOn = on;
    g.tags.push(a.tag);
    groups.set(k, g);
  };
  for (const a of live) {
    if (a.nextServiceOn) for (const d of occurrences(a.nextServiceOn, rule.serviceMonths, today, to)) addGroup('service', a, d);
    const inspection=(input.inspections??[]).filter(r=>r.assetId===a.id).sort((a,b)=>b.version-a.version)[0];
    const checkDue = inspection?.nextDueOn ?? today;
    for (const d of occurrences(checkDue, rule.checkMonths, today, to)) addGroup('check', a, d);
  }
  for (const [k, g] of groups) {
    const who = input.ownerName(g.owner);
    const n = g.tags.length;
    due.push({
      key: k,
      what: g.what,
      title: g.what === 'service' ? `Service ${n} item${n > 1 ? 's' : ''} (CCTV, network, printers) at ${who}` : `Six-month health inspection of ${n} IT asset${n > 1 ? 's' : ''} at ${who}`,
      detail: `${g.what === 'service' ? 'Routine service' : 'Six-month health inspection (initial check required when history is unknown)'} due ${g.month}: ${g.tags.slice(0, 30).join(', ')}${n > 30 ? ` and ${n - 30} more` : ''}.`,
      dueOn: g.dueOn,
      jobKind: 'check',
      technical: true,
    });
  }
  for (const dm of input.domains) {
    if (dm.expiresOn) {
      const on = place(addDays(dm.expiresOn, -rule.domainWarnDays));
      if (inRange(on))
        due.push({
          key: `domain:${dm.id}:${dm.expiresOn}`,
          what: 'domain',
          title: `Renew ${dm.name}`,
          detail: `${dm.kind === 'website' ? 'Website' : 'Domain'} expires ${dm.expiresOn} (registrar ${dm.registrar}); renew ${rule.domainWarnDays} days before.`,
          dueOn: on,
          jobKind: 'task',
          technical: true,
        });
    }
    if (dm.sslExpiresOn) {
      const on = place(addDays(dm.sslExpiresOn, -rule.sslWarnDays));
      if (inRange(on))
        due.push({
          key: `ssl:${dm.id}:${dm.sslExpiresOn}`,
          what: 'ssl',
          title: `Renew the certificate for ${dm.name}`,
          detail: `Certificate expires ${dm.sslExpiresOn}; renew ${rule.sslWarnDays} days before.`,
          dueOn: on,
          jobKind: 'task',
          technical: true,
        });
    }
  }
  for (const ac of input.accounts) {
    const first = ac.reviewedOn ? addDays(ac.reviewedOn, access) : today;
    for (let d = first, i = 0; d <= to && i < 10; i++, d = addDays(d, access)) {
      const on = place(d);
      if (!inRange(on)) continue;
      due.push({
        key: `access:${ac.id}:${d}`,
        what: 'access',
        title: `Prepare the access list of ${ac.name} for the CEO's review`,
        detail: `Every ${access} days the CEO confirms who may sign in to ${ac.name}. IT prepares the list; the CEO decides.`,
        dueOn: on,
        jobKind: 'access',
        technical: false,
      });
      if (d < today) break;
    }
  }
  const out: PlanDue[] = due.map((x) => {
    const job = input.jobs.find((j) => j.planKey === x.key && j.status !== 'cancelled') ?? null;
    return { ...x, overdue: false, jobId: job?.id ?? null, assignee: job?.assignee ?? null };
  });
  // Tender closing dates: planned on the tender itself (its owner), shown so the week is seen whole.
  for (const t of input.tenders) {
    if (t.stage && t.stage !== 'preparing') continue;
    const bidBy = addDays(t.closesOn, -1);
    if (!inRange(bidBy)) continue;
    const owner = input.staffName(t.ownerStaffId);
    out.push({
      key: `tender:${t.id}`,
      what: 'tender',
      title: `Bid in eP for ${t.title}`,
      detail: `Closes ${t.closesOn}; the bid goes in at least a day before.`,
      dueOn: bidBy,
      overdue: false,
      jobKind: 'task',
      technical: false,
      jobId: owner ? t.id : null,
      assignee: owner,
      owner,
    });
  }
  return out.map((x) => ({ ...x, overdue: !x.jobId && x.dueOn <= today && isOverdue(x, input, today) })).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}

/** Overdue: what the registers say was due before today (placed on today) and nobody has it. */
function isOverdue(x: PlanDue, input: { assets: ItAsset[]; inspections?:ItAssetInspection[]; domains: ItDomain[]; accounts: ItAccount[] }, today: IsoDate): boolean {
  const [what, id, when] = x.key.split(':');
  if (what === 'domain' || what === 'ssl') return addDays(when, -(what === 'domain' ? RULES.it.value.domainWarnDays : RULES.it.value.sslWarnDays)) < today;
  if (what === 'access') return when < today;
  if (what === 'service' || what === 'inspection') {
    const tags = input.assets.filter((a) => a.ownerId === id && a.status!=='disposed' && a.status!=='disposal_pending');
    return tags.some((a) =>
      what === 'service' ? !!a.nextServiceOn && a.nextServiceOn < today : !(input.inspections??[]).some(r=>r.assetId===a.id) || ((input.inspections??[]).filter(r=>r.assetId===a.id).sort((a,b)=>b.version-a.version)[0]?.nextDueOn??today)<today,
    );
  }
  return false;
}

/** Each person's planned jobs per bucket, with too much or nothing planned flagged. */
export function planLoad(team: Pick<User, 'id' | 'name' | 'itRole'>[], jobs: ItJob[], buckets: PlanBucket[], span: PlanSpan, today: IsoDate) {
  const cap = RULES.itPlan.value.weekCap;
  // A cap, when one is set, is per week; a day holds a fifth of it and a month about four weeks' worth. None is set now.
  const capOf = (b: PlanBucket) => (cap === null ? Infinity : span === 'week' ? Math.ceil(cap / 5) : span === 'month' ? cap : Math.round(cap * 4.3));
  return team
    .filter((u) => u.itRole !== 'manager')
    .map((u) => {
      const cells = buckets.map((b) => {
        const js = jobs.filter((j) => j.assigneeId === u.id && j.status !== 'cancelled' && j.dueOn >= b.from && j.dueOn <= b.to);
        const working = span !== 'week' || (dow(b.from) !== 0 && dow(b.from) !== 6);
        return {
          jobs: js.length,
          open: js.filter((j) => j.status !== 'accepted').length,
          over: js.length > capOf(b),
          // Nothing planned is flagged for a working week or month still ahead; single days are not flagged.
          empty: span !== 'week' && working && js.length === 0 && b.to >= today,
        };
      });
      return { id: u.id, name: u.name, itRole: u.itRole ?? null, cells, total: cells.reduce((n, c) => n + c.jobs, 0) };
    });
}

