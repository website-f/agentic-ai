
import { dateOf, fromMs, type ItJob, type User } from '@prima/core';
import type { DelegatedActor } from './delegated';
import type { JobEmailAccess } from './job-email';

/**
 * Who may attach Outlook emails to an IT job, and who may see them (IT jobs first, Arisha main 31 Oct 2026).
 * The database checks the same rule again (prima.job_email_job_access in job-email-v2.sql); a test runs both on the
 * same people and jobs, so a change here must also be a new SQL version.
 *  - Attach: the assignee, the person who gave the job, the IT Manager, the IT Lead and the COO, while not cancelled.
 *  - View (and remove one's own): those, plus the CEO, ACT and HR / Chief of Staff, who only look.
 *  - Integration and closed accounts: nothing. Unknown job: nothing.
 */
export type JobEmailNeed = 'view' | 'attach';
type RuleUser = Pick<User, 'id' | 'department' | 'itRole' | 'opsTier' | 'integration' | 'accessClosedFrom'>;

export function itJobEmailRule(user: RuleUser, job: Pick<ItJob, 'assigneeId' | 'givenById' | 'status'> | null, need: JobEmailNeed, now: Date): boolean {
  if (!job || user.integration) return false;
  if (user.accessClosedFrom && user.accessClosedFrom <= dateOf(fromMs(now.getTime()))) return false;
  const core = job.assigneeId === user.id || job.givenById === user.id
    || (user.department === 'it' && (user.itRole === 'manager' || user.itRole === 'lead')) || user.opsTier === 'coo';
  if (need === 'attach') return job.status !== 'cancelled' && core;
  return core || user.opsTier === 'ceo' || user.department === 'audit' || user.department === 'hr' || user.department === 'chief_of_staff';
}

/** The JobEmailAccess for IT jobs; the owner wires it with a lookup into the IT jobs store. */
export function itJobEmailAccess(getJob: (id: string) => Promise<ItJob | null>, clock: () => Date = () => new Date()): JobEmailAccess {
  const check = async (actor: DelegatedActor, jobId: string, need: JobEmailNeed) => itJobEmailRule(actor.user, await getJob(jobId), need, clock());
  return { canAttach: (a, j) => check(a, j, 'attach'), canView: (a, j) => check(a, j, 'view') };
}
