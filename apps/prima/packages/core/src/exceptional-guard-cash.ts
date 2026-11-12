import { AccessDenied, tenantCompanyIds } from './access';
import { FinanceDeskService, finActor } from './finance';
import { BadRequest, NotFound, siteStateOf } from './service';
import { onOpsSide } from './ops-access';
import { dateOf } from './time';
import { sha256Hex } from './audit';
import type { Store } from './store';
import type { EvidenceDoc, FinSign, User } from './types';
import { cashDeciderStandIn, isFinanceDirector, recordStandInUse, type CashStandIn } from './cash-stand-in';

export interface ExceptionalGuardCash {
  id: string; batchId: string; workbookRef: string; companyId: string;
  personId: string; staffNo: string; name: string; siteId: string; siteName: string;
  occasion: string; amount: number; reason: string;
  request: { byId: string; by: string; at: string; evidence: string };
  approval: { id: string; byId: string; by: string; at: string; evidence: string; sha256: string;
    /** P100 B2: the Finance Director approved standing in for the CEO, under this stand-in, with this reason. */
    standIn?: { id: string; reason: string } };
  submitted: FinSign;
  status: 'submitted' | 'prepared' | 'paid' | 'reconciled' | 'superseded' | 'complete';
  supersedes: string | null;
  preparation: (FinSign & { ref: string; custodianId: string; custodian: string; amount: number }) | null;
  payout: (FinSign & { atPaid: string; amount: number; ref: string; evidence: string }) | null;
  receipt: (FinSign & { evidence: string; signedAt: string }) | null;
  reconciliation: (FinSign & { returned: number; ref: string; evidence: string }) | null;
  accounting: (FinSign & { journalRef: string; payrollRecordRef: string; evidence: string; amount: number; label: 'Salary cost – cash payment' }) | null;
  /** Absent on older accounting records whose statutory records were confirmed. */
  treatment?: { status: 'pending' } | (FinSign & { status: 'reviewed'; policyRef: string; recordRef: string; evidence: string });
  classification: 'payroll'; budgetCategory: 'Miscellaneous payroll expenses';
}
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 300) throw new BadRequest(`${label} is required (maximum 300 characters).`);
  return v.trim();
};
const amount = (v: unknown, zero = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || (zero ? v < 0 : v <= 0) || !Number.isSafeInteger(Math.round(v * 100)) || Math.abs(v * 100 - Math.round(v * 100)) > 0.00001)
    throw new BadRequest('Amount must be a finite, positive exact cent amount (return may be zero).');
  return v;
};
const cents = (v: number) => Math.round(v * 100);
const timestamp = (v: unknown, now: string) => {
  const s = str(v, 'Timestamp');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s)) || Date.parse(s) > Date.parse(now)) throw new BadRequest('Give an actual timestamp with timezone, not a future date.');
  const day = s.slice(0,10);
  if (new Date(day).toISOString().slice(0,10) !== day) throw new BadRequest('Timestamp contains an impossible date.');
  return s;
};
const doa = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'director_office';
const finance = (u: User) => !u.integration && ['director', 'leader', 'deputy', 'data_entry'].includes(finActor(u)?.kind ?? '');
const executive = (u: User) => !u.integration && ['director', 'pwvsb_officer'].includes(u.role) && u.opsTier === 'ceo';
const denied = () => { throw new AccessDenied('view', '(exceptional guard cash: authorized DOA or Finance only)'); };

/** Separate evidence/custody ledger. It never mutates ordinary payroll runs or posts to an external ledger. */
export class ExceptionalGuardCashService {
  constructor(private store: Store, private desk: FinanceDeskService, private now: () => string) {}
  private async actor(tx: Store, supplied: User) {
    const u = await tx.get('users', supplied.id);
    if (!u || u.integration || (u.accessClosedFrom && u.accessClosedFrom <= dateOf(this.now()))) return denied();
    return u;
  }
  private async scope(tx: Store, u: User, companyId: string) {
    const ids = tenantCompanyIds(u, await tx.list('grants'), dateOf(this.now()));
    if (!ids.includes(companyId)) throw new NotFound('Company books');
    return ids;
  }
  private async row(tx: Store, u: User, companyId: string) {
    await this.scope(tx, u, companyId);
    const f = await tx.get('finStatus', `fin-${companyId}`);
    if (!f || (finance(u) && finActor(u)?.team != null && finActor(u)!.team !== f.team)) throw new NotFound('Company books');
    return f;
  }
  private siteAllowed(u: User, siteId: string) {
    if (u.siteIds.length && !u.siteIds.includes(siteId)) throw new NotFound('Site');
  }
  async view(supplied: User, companyId: string) {
    const u = await this.actor(this.store, supplied);
    if (!doa(u) && !finance(u)) return denied();
    const f = await this.row(this.store, u, companyId);
    const sites = (await this.store.list('sites', { companyId })).filter(s => !u.siteIds.length || u.siteIds.includes(s.id));
    const shifts = await this.store.list('shifts', { companyId });
    const people = (await this.store.list('people', { companyId })).filter(p => p.companyId === companyId && p.role === 'guard' && p.status === 'active');
    return {
      version: 1 as const, companyId, refreshedAt: this.now(), canSubmit: doa(u), canFinance: finance(u),
      master: people.flatMap(p => {
        const assignments = shifts.filter(s => s.personId === p.id && s.status === 'published' && sites.some(site => site.id === s.siteId));
        return assignments.length || !u.siteIds.length ? [{ personId: p.id, staffNo: p.staffNo, name: p.name, companyId, assignments: assignments.map(s => ({ siteId: s.siteId, siteName: sites.find(site => site.id === s.siteId)!.name, date: s.date })) }] : [];
      }),
      rows: (f.exceptionalGuardCash ?? []).filter(r => !u.siteIds.length || u.siteIds.includes(r.siteId)),
      accountingGate: 'Additional payroll support · budget: Miscellaneous payroll expenses. Ordinary wages remain payable in full. Finance manually records the external journal against the named site. Treatment may remain pending during accounting; Finance/adviser review and required records are needed before completion or live use.'
    };
  }
  async evidence(supplied: User, companyId: string, docId: string) {
    const view = await this.view(supplied, companyId);
    if (!view.rows.some(r => [r.request.evidence, r.approval.evidence, r.payout?.evidence, r.receipt?.evidence, r.reconciliation?.evidence, r.accounting?.evidence, r.treatment?.status === 'reviewed' ? r.treatment.evidence : undefined].includes(docId))) throw new NotFound('Cash evidence');
    const doc = await this.store.get('evidenceDocs', docId);
    if (!doc || doc.companyId !== companyId) throw new NotFound('Cash evidence');
    return doc;
  }
  async action(supplied: User, companyId: string, action: string, input: Record<string, unknown>) {
    return this.store.transaction(async tx => {
      const u = await this.actor(tx, supplied);
      if (action === 'submit' || action === 'receipt') { if (!doa(u)) return denied(); }
      else if (!finance(u)) return denied();
      await this.scope(tx, u, companyId);
      await tx.lock?.('finStatus', `fin-${companyId}`);
      const f = await this.row(tx, u, companyId);
      const now = this.now();
      const sign = (): FinSign => ({ byId: u.id, by: u.name, at: now, comment: '' });
      let rows = [...(f.exceptionalGuardCash ?? [])];
      const docs: EvidenceDoc[] = [];
      const existingEvidence = await tx.list('evidenceDocs', { companyId });
      const document = async (raw: unknown, purpose: string, reuseManual = false) => {
        const d = obj(raw), data = strData(d.data);
        const sha256 = sha256Hex(data);
        const id = `doc-excash-${sha256}`;
        const existing = docs.find(x => x.sha256 === sha256) ?? existingEvidence.find(x => x.sha256 === sha256) ?? await tx.get('evidenceDocs', id);
        if (existing) {
          if (reuseManual && existing.companyId === companyId && existing.caption?.startsWith('Manual ')) return { id, sha256 };
          throw new BadRequest('Evidence file already used; provide transaction-specific evidence.');
        }
        const name = str(d.name, 'Evidence filename');
        docs.push({ id, companyId, caseId: null, followUpId: null, name, mime: data.slice(5, data.indexOf(';')) as EvidenceDoc['mime'], bytes: Math.floor((data.length-data.indexOf(',')-1)*3/4), sha256, data, caption: purpose, uploadedBy: u.name, receivedAt: now });
        return { id, sha256 };
      };
      let result: ExceptionalGuardCash[];
      if (action === 'submit') {
        if (input.version !== 1 || input.evidenceChecked !== true) throw new BadRequest('Use contract version 1 and attest manual evidence covers each guard, amount and occasion.');
        const batchId = str(input.batchId, 'Batch ID'), workbookRef = str(input.workbookRef, 'Controlled workbook reference');
        if (rows.some(r => r.batchId === batchId)) throw new BadRequest('Batch already submitted.');
        if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 200) throw new BadRequest('Submit 1–200 approved rows.');
        result = [];
        for (const raw of input.rows) {
          const v = obj(raw), req = obj(v.request), app = obj(v.approval);
          const personId = str(v.personId, 'Guard ID'), siteId = str(v.siteId, 'Site ID');
          this.siteAllowed(u, siteId);
          const p = await tx.get('people', personId), site = await tx.get('sites', siteId);
          if (!p || p.companyId !== companyId || p.role !== 'guard' || p.status !== 'active') throw new BadRequest('Recipient must be an active guard in this company.');
          if (!site || site.companyId !== companyId) throw new BadRequest('Site must belong to this company.');
          const occasion = str(v.occasion, 'Payment occasion date');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(occasion) || !Number.isFinite(Date.parse(occasion)) || new Date(occasion).toISOString().slice(0,10) !== occasion) throw new BadRequest('Occasion must be a real date.');
          const shifts = await tx.list('shifts', { companyId });
          const roster = shifts.filter(s => s.personId === p.id && s.status === 'published');
          const before = roster.filter(s => s.date <= occasion).map(s => s.date).sort().at(-1);
          const after = roster.filter(s => s.date >= occasion).map(s => s.date).sort()[0];
          if (!roster.some(s => s.siteId === site.id && (s.date === before || s.date === after))) throw new BadRequest('Guard/site must match the current or next authoritative roster assignment.');
          const requester = await tx.get('users', str(req.byId, 'Requesting OM'));
          if (!requester || requester.integration || requester.role !== 'pwvsb_officer' || requester.department !== 'operations' || requester.opsTier !== 'om' || !requester.areaStates?.includes(siteStateOf(site, new Map((await tx.list('branches', { companyId })).map(b => [b.id, b.state])))) || !onOpsSide(requester, site.sector)) throw new BadRequest('Manual requester must be this site’s Operations Manager.');
          await this.scope(tx, requester, companyId);
          if ((requester.accessClosedFrom && requester.accessClosedFrom <= dateOf(now))) throw new BadRequest('Requesting OM account is closed.');
          const approver = await tx.get('users', str(app.byId, 'Manual approver'));
          // P100 B2 (Fauzan, 11 Nov 2026): the CEO approves; the Finance Director only while a stand-in the CEO set covers
          // the approval day or this approval reference, with a reason, and never on a request they made or submitted.
          if (!approver || (!executive(approver) && !isFinanceDirector(approver))) throw new BadRequest('Manual approval must be from the CEO (or the Finance Director standing in).');
          await this.scope(tx, approver, companyId);
          if (approver.accessClosedFrom && approver.accessClosedFrom <= dateOf(now)) throw new BadRequest('Approver account is closed.');
          const requestedAt = timestamp(req.at, now), approvedAt = timestamp(app.at, now);
          let standIn: CashStandIn | null = null;
          let standInReason = '';
          if (!executive(approver)) {
            if ([requester.id, u.id].includes(approver.id)) throw new BadRequest('The Finance Director made or submitted this request, so cannot approve it, even standing in for the CEO.');
            standIn = await cashDeciderStandIn(tx, approver, 'exceptional', companyId, str(app.id, 'Approval row reference'), [requester.id, u.id], dateOf(approvedAt)).catch(() => null);
            if (!standIn) throw new BadRequest('The Finance Director approved without a stand-in the CEO set for that day or this approval.');
            standInReason = str(app.standInReason, 'Reason the Finance Director gave standing in for the CEO');
            if (standInReason.length < 5) throw new BadRequest('Standing in for the CEO needs a reason (at least 5 letters).');
          }
          if (dateOf(approvedAt) > occasion) throw new BadRequest('Manual approval must precede the payment occasion.');
          if (Date.parse(approvedAt) < Date.parse(requestedAt)) throw new BadRequest('Approval must follow the manual request.');
          const approvalId = str(app.id, 'Approval row reference');
          if (rows.some(r => r.approval.id === approvalId)) throw new BadRequest('Approval reference already submitted.');
          const supersedes = v.supersedes == null ? null : str(v.supersedes, 'Superseded row');
          const previous = rows.find(r => r.id === supersedes);
          if (supersedes && (!previous || previous.status !== 'submitted')) throw new BadRequest('Only an unprepared row can be superseded by new approval.');
          if (previous) this.siteAllowed(u, previous.siteId);
          if (rows.some(r => r.id !== supersedes && r.status !== 'superseded' && r.personId === p.id && r.occasion === occasion)) throw new BadRequest('Guard/payment occasion already submitted.');
          const requested = await document(req.evidence, `Manual OM request: ${batchId}/${approvalId}`, true);
          const approved = await document(app.evidence, `Manual CEO approval: ${batchId}/${approvalId}`, true);
          if (previous && previous.approval.sha256 === approved.sha256) throw new BadRequest('Changed recipient or amount needs new approval evidence.');
          const record: ExceptionalGuardCash = {
            id: `excash-${companyId}-${rows.length + 1}`, batchId, workbookRef, companyId,
            personId: p.id, staffNo: p.staffNo, name: p.name, siteId, siteName: site.name, occasion,
            amount: amount(v.amount), reason: str(v.reason, 'Exceptional support reason'),
            request: { byId: requester.id, by: requester.name, at: requestedAt, evidence: requested.id },
            approval: { id: approvalId, byId: approver.id, by: approver.name, at: approvedAt, evidence: approved.id, sha256: approved.sha256, ...(standIn ? { standIn: { id: standIn.id, reason: standInReason } } : {}) },
            submitted: sign(), status: 'submitted', supersedes, preparation: null, payout: null, receipt: null, reconciliation: null, accounting: null, classification: 'payroll', budgetCategory: 'Miscellaneous payroll expenses'
          };
          if (previous) rows = rows.map(r => r.id === previous.id ? { ...r, status: 'superseded' } : r);
          rows.push(record); result.push(record);
          if (standIn) await recordStandInUse(tx, standIn, { at: now, area: 'exceptional', companyId, ref: approvalId, byId: approver.id, by: approver.name, decision: 'approved', amount: record.amount, reason: standInReason });
        }
      } else {
        const original = rows.find(r => r.id === input.id);
        if (!original) throw new NotFound('Exceptional cash row');
        this.siteAllowed(u, original.siteId);
        const r = { ...original };
        if (['cancel', 'correct', 'reverse'].includes(action)) throw new BadRequest('Correction/reversal is gated pending an agreed independent authorization and payroll/accounting procedure. Preserve the original record and evidence. Use returnUnpaid only for wholly unpaid cash with an independent Finance count.');
        // Do not accept recipient/approval/amount edits disguised as lifecycle actions.
        if (['personId','siteId','approval','request','occasion','supersedes'].some(k => k in input)) throw new BadRequest('Approved identity and scope are immutable; submit new manual approval.');
        if (action === 'prepare' || action === 'pay') {
          const approver = await tx.get('users', r.approval.byId);
          // P100 B2: an FD approval counts only when it was recorded standing in for the CEO.
          if (!approver || !(executive(approver) || (isFinanceDirector(approver) && !!r.approval.standIn))) throw new BadRequest('Fresh CEO approval is required before any new cash handout. Historical records remain unchanged.');
          await this.scope(tx, approver, companyId);
        }
        if (action === 'prepare') {
          if (r.status !== 'submitted') throw new BadRequest('Cash already prepared or row superseded.');
          if ('amount' in input && input.amount !== r.amount) throw new BadRequest('Preparation must equal the approved amount.');
          const custodian = await tx.get('users', str(input.custodianId, 'Finance custodian'));
          if (!custodian || !finance(custodian)) throw new BadRequest('Custodian must be authorized Finance staff.');
          await this.row(tx, custodian, companyId); this.siteAllowed(custodian, r.siteId);
          r.preparation = { ...sign(), ref: str(input.ref, 'Preparation/withdrawal reference'), custodianId: custodian.id, custodian: custodian.name, amount: r.amount };
          r.status = 'prepared';
        } else if (action === 'pay') {
          if (r.status !== 'prepared' || !r.preparation) throw new BadRequest('Prepare cash once before recording actual payment.');
          if (r.preparation.custodianId !== u.id) throw new AccessDenied('view', '(only the recorded Finance custodian records actual payment)');
          const paid = amount(input.amount);
          if (cents(paid) > cents(r.amount)) throw new BadRequest('Payment exceeds manual approval; obtain new approval.');
          const atPaid = timestamp(input.atPaid, now);
          if (Date.parse(atPaid) < Date.parse(r.preparation.at) || dateOf(atPaid) !== r.occasion) throw new BadRequest('Actual payment must follow preparation and match the approved occasion.');
          const ref = str(input.ref, 'Actual payment reference');
          if (rows.some(x => x.payout?.ref === ref)) throw new BadRequest('Payment reference already recorded.');
          const evidence = await document(input.evidence, `Actual payment: ${r.id}/${ref}`);
          r.payout = { ...sign(), atPaid, amount: paid, ref, evidence: evidence.id }; r.status = 'paid';
        } else if (action === 'receipt') {
          if (!r.payout || r.receipt) throw new BadRequest('Record actual payment first; signed receipt can be uploaded only once.');
          if (input.transactionSpecific !== true || input.signedByPersonId !== r.personId || input.paymentRef !== r.payout.ref || input.amount !== r.payout.amount) throw new BadRequest('Attest a fresh transaction-specific signed acknowledgement for this guard, payment reference and amount; never paste a stored signature.');
          const signedAt = timestamp(input.signedAt, now);
          if (Date.parse(signedAt) < Date.parse(r.payout.atPaid)) throw new BadRequest('Receipt must be signed after actual payment.');
          const evidence = await document(input.evidence, `Signed acknowledgement: ${r.id}/${r.payout.ref}`);
          r.receipt = { ...sign(), evidence: evidence.id, signedAt };
        } else if (action === 'returnUnpaid') {
          if (r.status !== 'prepared' || !r.preparation || r.payout || r.reconciliation) throw new BadRequest('Only wholly unpaid prepared cash can be returned here.');
          if (r.preparation.custodianId === u.id) throw new AccessDenied('view', '(a different Finance officer must count returned cash)');
          if (amount(input.returned, true) !== r.preparation.amount) throw new BadRequest('Return and count the entire unpaid amount.');
          const evidence = await document(input.evidence, `Wholly unpaid return: ${r.id}`);
          r.reconciliation = { ...sign(), returned: r.preparation.amount, ref: str(input.ref, 'Unpaid return/deposit reference'), evidence: evidence.id }; r.status = 'reconciled';
        } else if (action === 'reconcile') {
          if (r.reconciliation || !r.preparation || !r.payout || !r.receipt) throw new BadRequest('Payment, signed receipt and preparation required before reconciliation.');
          if (r.preparation.custodianId === u.id) throw new AccessDenied('view', '(a different Finance officer must count the return and reconcile)');
          const returned = amount(input.returned, true);
          if (cents(returned) + cents(r.payout.amount) !== cents(r.preparation.amount)) throw new BadRequest('Paid plus returned must equal prepared cash; resolve the discrepancy first.');
          const evidence = await document(input.evidence, `Return/reconciliation: ${r.id}`);
          r.reconciliation = { ...sign(), returned, ref: str(input.ref, 'Return/deposit/reconciliation reference'), evidence: evidence.id }; r.status = 'reconciled';
        } else if (action === 'post') {
          if (r.accounting || r.status !== 'reconciled' || !r.payout || !r.receipt || !r.reconciliation) throw new BadRequest('Accounting requires actual payment, signed receipt and reconciliation; record only once.');
          if (input.additionalPayrollConfirmed !== true || (input.statutoryRecordsConfirmed !== true && input.treatmentStatus !== 'pending')) throw new BadRequest('Confirm additional payroll expense (ordinary wages remain payable in full) and separately completed required payroll, payslip, tax and contribution records. No statutory exemption is implied.');
          if (input.treatmentStatus !== undefined && input.treatmentStatus !== 'pending') throw new BadRequest('Use pending treatment and record the Finance/adviser review separately.');
          if (input.treatmentStatus === 'pending' && input.statutoryRecordsConfirmed === true) throw new BadRequest('Pending treatment cannot be attested complete.');
          const journalRef = str(input.journalRef, 'Unique external payroll journal line reference');
          const payrollRecordRef = str(input.payrollRecordRef, 'Supplemental payroll/statutory record reference');
          if (rows.some(x => x.accounting?.journalRef === journalRef || x.accounting?.payrollRecordRef === payrollRecordRef)) throw new BadRequest('Accounting/payroll reference already used; do not expense the payment twice.');
          const evidence = await document(input.evidence, `Additional payroll accounting and statutory records: ${r.id}`);
          if (input.treatmentStatus === 'pending') r.treatment = { status: 'pending' };
          r.accounting = { ...sign(), journalRef, payrollRecordRef, evidence: evidence.id, amount: r.payout.amount, label: 'Salary cost – cash payment' };
        } else if (action === 'reviewTreatment') {
          if (!r.accounting || r.treatment?.status !== 'pending') throw new BadRequest('Only pending treatment on a posted record can receive a review, once only.');
          if (input.statutoryRecordsConfirmed !== true) throw new BadRequest('Confirm Finance/adviser review and completion of all required payroll, payslip, tax and contribution records.');
          const policyRef = str(input.policyRef, 'Finance/adviser treatment decision reference');
          const recordRef = str(input.recordRef, 'Completed payroll/statutory records reference');
          const evidence = await document(input.evidence, `Finance/adviser treatment review: ${r.id}`);
          r.treatment = { ...sign(), status: 'reviewed', policyRef, recordRef, evidence: evidence.id };
        } else if (action === 'complete') {
          if (r.treatment?.status === 'pending') throw new BadRequest('Statutory treatment remains pending Finance/adviser review and required records.');
          if (!r.reconciliation || r.status === 'complete' || (r.payout ? (!r.accounting || !r.receipt) : (!r.preparation || r.reconciliation.returned !== r.preparation.amount))) throw new BadRequest('Required payment evidence, reconciliation and payroll accounting must be complete, once only.');
          r.status = 'complete';
        } else throw new BadRequest('Unknown exceptional cash action. Approved rows cannot be edited.');
        rows = rows.map(x => x.id === r.id ? r : x); result = [r];
      }
      // Validate the whole batch before any write. The company lock serializes duplicate submissions/payouts.
      for (const d of docs) await tx.insert('evidenceDocs', d);
      await tx.update('finStatus', f.id, { exceptionalGuardCash: rows });
      await this.desk.log(tx, u, f, `finance.exceptionalcash.${action}`, `${result.map(r => r.id).join(', ')}; manual approval is not payment; additional payroll; miscellaneous payroll expenses budget; ordinary wages unchanged.`);
      return result;
    });
  }
}
function strData(v: unknown) {
  if (typeof v !== 'string' || v.length > 2_000_000 || !/^data:(application\/pdf|image\/png|image\/jpeg);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v) || v.endsWith(',')) throw new BadRequest('Upload a transaction-specific PDF, PNG or JPEG evidence file (under 1.5 MB).');
  return v;
}
