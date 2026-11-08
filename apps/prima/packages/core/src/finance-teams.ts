import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import { fromMs } from "./time";
import { toMs } from "./time";
import type { FinPayment } from "./types";
import type { FinStatus } from "./types";
import type { FinTeamsRead } from "./types";
import type { FinTeamsRequestItem } from "./types";
import type { FinTeamsResultItem } from "./types";
import type { FinTeamsVerdict } from "./types";
import type { Id } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import { RULES } from "./rules";


/** djb2 over a canonical string; enough to bind a result to one payment revision (not a secret). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Each prepare or resubmit is a new revision: a returned-and-resubmitted payment needs a new Teams request. */
export function finPaymentRevision(p: FinPayment): number {
  return p.steps.filter((s) => s.step === 'prepared' || s.step === 'resubmitted').length;
}

/** What a Teams request must carry to be bound to exactly this payment as it is now. */
export function finTeamsFingerprint(p: FinPayment): string {
  return hash(JSON.stringify([p.id, finPaymentRevision(p), p.companyId, p.payee, p.payeeBank?.accountLast4 ?? null, p.amount.toFixed(2), p.sqlRef, p.bankId, p.subject ?? 'finance']));
}

export function finTeamsFieldsHash(r: FinTeamsResultItem): string {
  return hash(JSON.stringify(r));
}

export interface FinTeamsConfig {
  /** The Finance flow's service account (Entra object ID), from Prima's configuration, never from the list. */
  serviceAccountOid: string;
}

export interface FinTeamsCheckInput {
  result: FinTeamsResultItem;
  request: FinTeamsRequestItem | null;
  payment: FinPayment;
  f: FinStatus;
  cfg: FinTeamsConfig;
  /** Entra object IDs Prima requires (FD and CEO for Finance; COO and CEO for the COO's departments). */
  required: string[];
  /** Object IDs of people who may not approve this payment (preparers, reviewer, payee-detail editor). */
  excluded: string[];
  /** Object IDs of Finance staff (who may have created the request row). */
  financeStaff: string[];
  now: IsoDateTime;
  approvalExpiryDays: number;
}

/** Checks 1-7 and Revision 2. Returns the verdict and every failed check, in plain words. */
export function finTeamsCheck(x: FinTeamsCheckInput): { verdict: FinTeamsVerdict; failures: string[] } {
  const { result: r, request: q, payment: p } = x;
  const fail: string[] = [];
  // 1. Author: only the flow's service account wrote it.
  if (!x.cfg.serviceAccountOid || r.createdById !== x.cfg.serviceAccountOid || r.lastModifiedById !== x.cfg.serviceAccountOid)
    fail.push('Not written by the Finance flow service account');
  // 2. Never edited (a tamper signal, not proof): one version, created and modified at the same time.
  if (r.versionCount == null) fail.push('Versions could not be read');
  else if (r.versionCount !== 1) fail.push(`The result was edited (${r.versionCount} versions)`);
  if (r.createdAt !== r.modifiedAt) fail.push('The result was changed after it was written');
  // 3. Exact record: this payment, this company, this revision, and the named request row.
  const fp = finTeamsFingerprint(p);
  if (r.paymentId !== p.id || r.companyId !== p.companyId) fail.push('The result is for another payment');
  if (r.fingerprint !== fp) fail.push('The payment changed after the Teams request was made (fingerprint differs)');
  if (!q) fail.push('The request row it names was not found');
  else {
    if (q.itemId !== r.requestItemId || q.version !== r.requestVersion) fail.push('The request row or its version differs from the one the result names');
    if (q.fingerprint !== fp || q.paymentId !== p.id) fail.push('The request row does not match this payment as it is now');
    if (!x.financeStaff.includes(q.createdById)) fail.push('The request row was not created by Finance staff');
  }
  // 4. No replay: one approval and one results item, once, for one payment revision.
  const seen = (x.f.teamsSeen ?? []).filter((s) => s.approvalId === r.approvalId || s.resultItemId === r.itemId);
  if (seen.some((s) => s.paymentId !== p.id || s.fingerprint !== fp)) fail.push('This Teams approval was already used for another payment or an earlier version');
  // 5. Right people: the flow assigned exactly Prima's approvers; decisions from anyone else do not count.
  const req = [...new Set(x.required)].sort();
  const got = [...new Set(r.assignedTo)].sort();
  if (!req.length || req.join() !== got.join()) fail.push("The approvers assigned in Teams are not exactly Prima's approvers for this payment");
  const counted = r.responses.filter((s) => req.includes(s.objectId));
  if (r.responses.some((s) => !req.includes(s.objectId))) fail.push('Someone outside the required approvers responded (ignored)');
  if (counted.some((s) => x.excluded.includes(s.objectId))) fail.push('An approver prepared, reviewed or changed the payee of this payment');
  if (counted.some((s) => !s.comment.trim())) fail.push('An approver gave no comment');
  // 6. Complete.
  const rejected = counted.some((s) => s.response === 'Reject') || r.outcome === 'Reject';
  if (r.outcome !== 'Approve' && r.outcome !== 'Reject') fail.push(`The approval is ${r.outcome || 'not complete'}`);
  if (!r.completionDate) fail.push('No completion date');
  if (r.outcome === 'Approve' && !counted.some((s) => s.response === 'Approve')) fail.push('No required approver approved');
  // 7. Order and lapse: completed after the request row was saved and after this revision was prepared; not too old.
  const preparedAt = [...p.steps].reverse().find((s) => s.step === 'prepared' || s.step === 'resubmitted')?.at;
  if (r.completionDate && q && toMs(r.completionDate) <= toMs(q.modifiedAt)) fail.push('Completed before the request row was saved');
  if (r.completionDate && preparedAt && toMs(r.completionDate) <= toMs(preparedAt)) fail.push('Completed before this version of the payment was prepared');
  if (r.completionDate && toMs(x.now) - toMs(r.completionDate) >= x.approvalExpiryDays * 86_400_000) fail.push('The Teams approval is older than the approval lapse');
  if (p.approvalMethod !== 'teams') fail.push('This payment is approved in Prima, not in Teams');
  if (fail.length) return { verdict: 'not_approved', failures: fail };
  return { verdict: rejected ? 'rejected' : 'approved', failures: [] };
}

/** Reads one Teams result into Prima. Called by the read job only, behind TEAMS_APPROVALS_READ. */
export class FinanceTeamsService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private enabled: boolean,
    private cfg: FinTeamsConfig,
  ) {}

  async record(companyId: Id, result: FinTeamsResultItem, request: FinTeamsRequestItem | null): Promise<FinTeamsRead> {
    if (!this.enabled) throw new BadRequest('The Teams approval connection is switched off (TEAMS_APPROVALS_READ).');
    return this.store.transaction(async (tx) => {
      const now = this.clock();
      await tx.lock?.('finStatus', `fin-${companyId}`);
      const f = await tx.get('finStatus', `fin-${companyId}`);
      if (!f) throw new NotFound('Company books');
      const payments = f.payments ?? [];
      const p = payments.find((x) => x.id === result.paymentId);
      if (!p) throw new NotFound('Payment');
      const users = await tx.list('users');
      const oid = (pred: (u: User) => boolean) => users.filter(pred).map((u) => u.entraOid).filter((x): x is string => !!x);
      const isCeo = (u: User) => u.opsTier === 'ceo';
      const required = RULES.financePayments.value.cooSubjects.includes(p.subject ?? 'finance') ? oid((u) => isCeo(u) || (u.opsTier === 'coo' && u.role === 'pwvsb_officer')) : oid((u) => isCeo(u) || u.leadership === 'finance_director');
      const stepIds = p.steps.filter((s) => s.step !== 'approved').map((s) => s.byId);
      const payeeEditor = (f.payees ?? []).find((x) => x.id === p.payeeId)?.entered.byId;
      const excluded = oid((u) => stepIds.includes(u.id) || u.id === payeeEditor);
      const financeStaff = oid((u) => u.department === 'finance');
      const s = RULES.financePayments.value;
      const hashNow = finTeamsFieldsHash(result);
      // Revision 2, point 2: a result that changes between two reads is void and the FD is alerted.
      const prior = p.teams && p.teams.resultItemId === result.itemId ? p.teams : null;
      let verdict: FinTeamsVerdict;
      let failures: string[];
      if (prior && (prior.etag !== result.etag || prior.fieldsHash !== hashNow)) {
        verdict = 'void';
        failures = ['The Teams result changed between two reads'];
      } else {
        ({ verdict, failures } = finTeamsCheck({ result, request, payment: p, f, cfg: this.cfg, required, excluded, financeStaff, now, approvalExpiryDays: s.approvalExpiryDays }));
      }
      const byOid = (o: string) => users.find((u) => u.entraOid === o);
      const read: FinTeamsRead = {
        approvalId: result.approvalId,
        resultItemId: result.itemId,
        requestItemId: result.requestItemId,
        requestVersion: result.requestVersion,
        fingerprint: result.fingerprint,
        etag: result.etag,
        fieldsHash: prior?.fieldsHash ?? hashNow,
        outcome: result.outcome,
        completedAt: result.completionDate,
        responses: result.responses.map((x) => ({ approver: byOid(x.objectId)?.name ?? x.upn, objectId: x.objectId, response: x.response, comment: x.comment.slice(0, 500), at: x.responseDate })),
        verdict,
        failures,
        readAt: now,
      };
      let next: FinPayment = { ...p, teams: read };
      const approver = result.responses.find((x) => x.response === 'Approve' && required.includes(x.objectId));
      const who = approver ? byOid(approver.objectId) : undefined;
      if (verdict === 'approved' && p.status === 'reviewed' && who) {
        const payee = (f.payees ?? []).find((x) => x.id === p.payeeId);
        if (!p.payeeId || payee?.status === 'verified')
          next = {
            ...next,
            status: 'approved',
            payeeBank: payee ? { bank: payee.bank, accountLast4: payee.accountLast4, accountName: payee.accountName, rev: payee.history.length } : (p.payeeBank ?? null),
            expiresOn: dateOf(fromMs(toMs(result.completionDate!) + s.approvalExpiryDays * 86_400_000)),
            steps: [...p.steps, { step: 'approved', by: who.name, byId: who.id, at: now, comment: `Approved in Teams ${result.completionDate}: ${approver!.comment}` }],
          };
      }
      const seen = verdict === 'approved' || verdict === 'rejected' ? [...(f.teamsSeen ?? []).filter((x) => x.resultItemId !== result.itemId), { approvalId: result.approvalId, resultItemId: result.itemId, paymentId: p.id, fingerprint: result.fingerprint, at: now }] : f.teamsSeen;
      await tx.update('finStatus', f.id, { payments: payments.map((x) => (x.id === p.id ? next : x)), ...(seen ? { teamsSeen: seen } : {}) });
      await tx.audit({
        at: now,
        actor: 'Prima (Teams read)',
        companyId: f.companyId === 'pwvsb' ? null : f.companyId,
        action: `finance.teams.${verdict}`,
        entity: 'fin_status',
        entityId: f.id,
        summary: `Teams result ${result.itemId} for payment ${p.id}: ${verdict}${failures.length ? ` (${failures.join('; ')})` : ''}${next.status !== p.status ? `; payment ${next.status}` : ''}.`.slice(0, 900),
      });
      return read;
    });
  }
}