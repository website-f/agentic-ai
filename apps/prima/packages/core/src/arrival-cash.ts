import { AccessDenied, tenantCompanyIds } from './access';
import { BadRequest, NotFound } from './service';
import { finActor } from './finance';
import { sha256Hex } from './audit';
import type { Store } from './store';
import type { EvidenceDoc, User } from './types';
import type { GuardPayLine } from './guard-pay';

export interface Stamp { byId: string; by: string; at: string }
export interface ArrivalCashPolicy extends Stamp {
  id: string; financeRef: string; legalRef: string; evidence: string;
  capPercent: number; recoveryAccount: string; fromPeriod: string; toPeriod: string;
  /** Review explicitly covers gross wage basis and ALL deductions, including statutory deductions. */
  basis: 'gross-all-deductions';
}
export interface ArrivalCash {
  id: string; companyId: string; personId: string; siteId: string; name: string;
  arrivedOn: string; months: number; created: Stamp;
  requests: { id: string; amount: number; purpose: string; requested: Stamp;
    decision: (Stamp & { approved: boolean; reason: string }) | null;
    handover: (Stamp & { on: string; reference: string; evidence: string | null; amount: number }) | null }[];
  policy: ArrivalCashPolicy | null;
  repayments: (Stamp & { runId: string; period: string; amount: number; policyId: string })[];
  notices: (Stamp & { event: 'request' | 'decision' | 'handover' | 'review' | 'repayment'; reference: string })[];
}
const rounded = (n: number) => Math.round(n * 100) / 100;
export const arrivalBalance = (r: ArrivalCash) => rounded(r.requests.reduce((s, p) => s + (p.handover?.amount ?? 0), 0) - r.repayments.reduce((s,p) => s+p.amount,0));
const manager = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'fwm' && u.fwmRole === 'manager';
export const cashCeo = (u: User) => !u.integration && ['director','pwvsb_officer'].includes(u.role) && u.opsTier === 'ceo';
const finance = (u: User) => !u.integration && ['director','leader','deputy','data_entry'].includes(finActor(u)?.kind ?? '');
const fail = () => { throw new AccessDenied('view', '(arrival cash: scoped FWM Manager, CEO or Finance only)'); };
const text = (x: unknown, label: string) => { if (typeof x !== 'string' || !x.trim() || x.length > 300) throw new BadRequest(`${label} required (maximum 300 characters).`); return x.trim(); };
const money = (x: unknown) => { if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || !Number.isSafeInteger(Math.round(x*100)) || Math.abs(x*100-Math.round(x*100)) > 1e-6) throw new BadRequest('Use a positive exact cent amount.'); return x; };
const day = (x: unknown, today: string) => { const d = text(x,'Actual date'); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10)!==d || d>today) throw new BadRequest('Use a real date, not a future date.'); return d; };
const period = (x: unknown) => { const p = text(x,'Period'); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new BadRequest('Use YYYY-MM.'); return p; };

/** A distinct arrival advance ledger. Never writes guardLoans or exceptionalGuardCash. */
export class ArrivalCashService {
  constructor(private store: Store, private now: () => string) {}
  private async actor(tx: Store, supplied: User, companyId: string) {
    const u = await tx.get('users', supplied.id);
    if (!u || u.integration || (u.accessClosedFrom && u.accessClosedFrom <= this.now().slice(0,10)) || (!manager(u) && !cashCeo(u) && !finance(u))) return fail();
    if (!tenantCompanyIds(u, await tx.list('grants'), this.now().slice(0,10)).includes(companyId)) throw new NotFound('Company books');
    const f = await tx.get('finStatus', `fin-${companyId}`);
    if (!f || (finance(u) && finActor(u)?.team != null && finActor(u)!.team !== f.team)) throw new NotFound('Company books');
    return {u,f};
  }
  private site(u: User, id: string) { if (u.siteIds.length && !u.siteIds.includes(id)) throw new NotFound('Site'); }
  async view(user: User, companyId: string) {
    const {u,f} = await this.actor(this.store,user,companyId);
    const rows = (f.arrivalCash ?? []).filter(r => !u.siteIds.length || u.siteIds.includes(r.siteId));
    const sites=(await this.store.list('sites',{companyId})).filter(s=>!u.siteIds.length || u.siteIds.includes(s.id));
    const shifts=await this.store.list('shifts',{companyId});
    const workers=(await this.store.list('people',{companyId})).filter(p=>p.status==='active' && p.role==='guard' && p.nationality!=='MY' && (!u.siteIds.length || shifts.some(s=>s.personId===p.id && s.status==='published' && u.siteIds.includes(s.siteId)))).map(p=>({id:p.id,name:p.name,staffNo:p.staffNo}));
    return {companyId, workers, sites:sites.map(s=>({id:s.id,name:s.name})), canRequest: manager(u), canDecide: cashCeo(u), canReview: finance(u),
      rows: rows.map(r=>({...r, balance:arrivalBalance(r)})),
      gate: 'Separate recoverable arrival advances. Finance/legal review is required before live use. No 60-day rule or default deduction percentage. Finance notices are recorded here; no external notification is sent.'};
  }
  async evidence(user: User, companyId: string, id: string) {
    const view = await this.view(user,companyId);
    if (!view.rows.some(r=>r.policy?.evidence===id || r.requests.some(q=>q.handover?.evidence===id))) throw new NotFound('Arrival evidence');
    const d = await this.store.get('evidenceDocs',id);
    if (!d || d.companyId !== companyId) throw new NotFound('Arrival evidence');
    return d;
  }
  async action(user: User, companyId: string, action: string, input: Record<string,unknown>) {
    return this.store.transaction(async tx => {
      await tx.lock?.('finStatus',`fin-${companyId}`);
      const {u,f} = await this.actor(tx,user,companyId);
      const now=this.now(), stamp=():Stamp=>({byId:u.id,by:u.name,at:now});
      const rows=structuredClone(f.arrivalCash ?? []);
      let r=rows.find(x=>x.id===input.id);
      const docs:EvidenceDoc[]=[];
      const evidence=async(raw:unknown,caption:string)=>{
        const d=raw as {name?:unknown;data?:unknown};
        if (!d || typeof d.data!=='string' || d.data.length>2_000_000 || !/^data:(application\/pdf|image\/png|image\/jpeg);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d.data) || d.data.endsWith(',')) throw new BadRequest('Upload a genuine PDF, PNG or JPEG under 1.5MB.');
        const hash=sha256Hex(d.data);
        // Check all workflows, not merely this ledger: a stored signature/receipt cannot be reused.
        if ((await tx.list('evidenceDocs',{companyId})).some(x=>x.sha256===hash)) throw new BadRequest('Evidence already used; supply fresh transaction-specific evidence.');
        const id=`doc-arrival-${hash}`;
        docs.push({id,companyId,caseId:null,followUpId:null,name:text(d.name,'Filename'),mime:d.data.slice(5,d.data.indexOf(';')) as EvidenceDoc['mime'],bytes:Math.floor((d.data.length-d.data.indexOf(',')-1)*3/4),sha256:hash,data:d.data,caption,uploadedBy:u.name,receivedAt:now});
        return id;
      };
      if (action==='request') {
        if (!manager(u)) return fail();
        if (input.awaitingPlks !== true || input.withoutWages !== true || input.recentArrivalConfirmed !== true) throw new BadRequest('Confirm recent arrival, awaiting PLKS and no wages; no fixed eligibility period is assumed.');
        const personId=text(input.personId,'Worker'), siteId=text(input.siteId,'Site'); this.site(u,siteId);
        const p=await tx.get('people',personId), site=await tx.get('sites',siteId);
        if (!p || p.companyId!==companyId || p.role!=='guard' || p.status!=='active' || p.nationality==='MY' || !site || site.companyId!==companyId) throw new BadRequest('An active foreign worker and site in this company are required.');
        if (u.siteIds.length && !(await tx.list('shifts',{companyId,personId})).some(s=>s.siteId===siteId && s.status==='published')) throw new NotFound('Worker in authorized site');
        const credentials=await tx.list('credentials',{companyId,personId});
        if (credentials.some(c=>c.type==='PLKS_PERMIT' && (!c.expiresOn || c.expiresOn>=now.slice(0,10)))) throw new BadRequest('PLKS already recorded; arrival eligibility needs review.');
        const paidRuns=await tx.list('guardPayRuns',{companyId});
        if (paidRuns.some(run=>run.stage==='paid' && run.lines.some(l=>l.personId===personId && l.gross>0))) throw new BadRequest('Wages have already started; arrival requests are closed.');
        const arrivedOn=day(input.arrivedOn,now.slice(0,10));
        const months=input.months;
        if (typeof months!=='number' || !Number.isSafeInteger(months) || months<1) throw new BadRequest('FWM must set a positive whole number of recovery months.');
        const existing=rows.find(x=>x.personId===personId);
        if (existing && existing.id!==input.id) throw new BadRequest('Use the existing worker arrival record.');
        if (!r) { if (input.id) throw new NotFound('Arrival record'); r={id:`arrival-${companyId}-${rows.length+1}`,companyId,personId,siteId,name:p.name,arrivedOn,months,created:stamp(),requests:[],policy:null,repayments:[],notices:[]}; rows.push(r); }
        this.site(u,r.siteId);
        if (r.personId!==personId || r.siteId!==siteId || r.arrivedOn!==arrivedOn || r.months!==months) throw new BadRequest('Arrival identity and recovery terms are immutable; policy changes need separate review.');
        if (r.repayments.length) throw new BadRequest('Repayments have started; no further handouts on this record.');
        const requestId=text(input.requestId,'Unique request reference');
        if (rows.some(x=>x.requests.some(q=>q.id===requestId))) throw new BadRequest('Request reference already used.');
        r.requests.push({id:requestId,amount:money(input.amount),purpose:text(input.purpose,'Purpose'),requested:stamp(),decision:null,handover:null});
        r.notices.push({...stamp(),event:'request',reference:requestId});
      } else {
        if (!r) throw new NotFound('Arrival record'); this.site(u,r.siteId);
        if (action==='review') {
          if (!finance(u)) return fail();
          if (r.policy) throw new BadRequest('Policy review is immutable; changes require a separately agreed correction procedure.');
          if (input.financeLegalConfirmed!==true || input.basis!=='gross-all-deductions') throw new BadRequest('Finance must confirm legal review of gross wage basis, all deductions, eligibility, terms and required authorizations before live use.');
          const cap=input.capPercent;
          if (typeof cap!=='number' || !Number.isFinite(cap) || cap<=0 || cap>100) throw new BadRequest('Provide the reviewed lawful cap percentage; no default applies.');
          const fromPeriod=period(input.fromPeriod),toPeriod=period(input.toPeriod);
          if (toPeriod<fromPeriod) throw new BadRequest('Policy expiry precedes effective period.');
          r.policy={...stamp(),id:`${r.id}-policy`,financeRef:text(input.financeRef,'Finance review'),legalRef:text(input.legalRef,'Legal review'),capPercent:cap,recoveryAccount:text(input.recoveryAccount,'Reviewed arrival receivable account'),fromPeriod,toPeriod,basis:'gross-all-deductions',evidence:await evidence(input.evidence,`Arrival policy ${r.id}`)};
          r.notices.push({...stamp(),event:'review',reference:r.policy.id});
        } else {
          const q=r.requests.find(x=>x.id===input.requestId); if (!q) throw new NotFound('Arrival request');
          if (action==='decide') {
            if (!cashCeo(u)) return fail();
            if (q.requested.byId===u.id) throw new BadRequest('Requester cannot approve their own request.');
            if (q.decision) throw new BadRequest('Request already decided.');
            if (typeof input.approved!=='boolean') throw new BadRequest('Give an explicit approval or refusal.');
            if (input.amount!==q.amount || input.personId!==r.personId) throw new BadRequest('Decision must bind the exact worker and requested amount.');
            q.decision={...stamp(),approved:input.approved,reason:text(input.reason,'Decision reason')};
            r.notices.push({...stamp(),event:'decision',reference:q.id});
          } else if (action==='handover') {
            if (!manager(u)) return fail();
            if (r.repayments.length) throw new BadRequest('Repayments have started; no further handouts.');
            if (!q.decision?.approved || q.handover) throw new BadRequest('A fresh CEO-approved request is required.');
            if (input.amount!==q.amount || input.personId!==r.personId || input.actualDisbursementConfirmed!==true) throw new BadRequest('Confirm actual disbursement for this exact worker and amount. Approval alone is not payment.');
            if (input.evidence && (input.transactionSpecific!==true || input.signedByPersonId!==r.personId)) throw new BadRequest('Genuine worker-signed receipt must identify this request, worker and exact amount.');
            if ((await tx.list('credentials',{companyId,personId:r.personId})).some(c=>c.type==='PLKS_PERMIT' && (!c.expiresOn || c.expiresOn>=now.slice(0,10)))) throw new BadRequest('PLKS has been recorded; further arrival handouts require eligibility review.');
            if ((await tx.list('guardPayRuns',{companyId})).some(run=>run.stage==='paid' && run.lines.some(l=>l.personId===r!.personId && l.gross>0))) throw new BadRequest('Wages have started; further arrival handouts are closed.');
            const on=day(input.on,now.slice(0,10));
            if (on<q.decision.at.slice(0,10)) throw new BadRequest('Handover cannot precede approval.');
            const ref=text(input.reference,'Payment reference');
            if (rows.some(x=>x.requests.some(p=>p.handover?.reference===ref))) throw new BadRequest('Payment reference already used.');
            // This candidate is not a live activation mechanism. Review must exist before recording any real handover.
            if (!r.policy || on.slice(0,7)<r.policy.fromPeriod || on.slice(0,7)>r.policy.toPeriod) throw new BadRequest('Current Finance/legal review is required before handover.');
            q.handover={...stamp(),on,reference:ref,amount:q.amount,evidence:input.evidence ? await evidence(input.evidence,`Signed arrival receipt ${r.personId}/${q.id}/${ref}/${on}/${q.amount}`) : null};
            r.notices.push({...stamp(),event:'handover',reference:q.id});
          } else if (action==='receipt') {
            if (!manager(u)) return fail();
            if (!q.handover || q.handover.evidence) throw new BadRequest('Receipt needs an actual handover and may be supplied once only.');
            if (input.transactionSpecific!==true || input.signedByPersonId!==r.personId || input.amount!==q.handover.amount || input.reference!==q.handover.reference) throw new BadRequest('Bind the genuine receipt to this worker, payment reference and amount.');
            q.handover.evidence=await evidence(input.evidence,`Signed arrival receipt ${r.personId}/${q.id}/${q.handover.reference}/${q.handover.on}/${q.handover.amount}`);
          } else throw new BadRequest('Unknown arrival action. Settled records and receipts cannot be edited or reversed here.');
        }
      }
      for (const d of docs) await tx.insert('evidenceDocs',d);
      await tx.update('finStatus',f.id,{arrivalCash:rows});
      await tx.audit({at:now,actor:u.name,companyId,action:`arrivalcash.${action}`,entity:'fin_status',entityId:f.id,summary:`${r.id}: ${action}. Approval alone creates no debt; genuine disbursement only; separate from support and loan scheme.`});
      return r;
    });
  }
}

/** Add only reviewed arrival repayments. Deferred amounts remain owed; all other deductions consume cap room. */
export function applyArrivalRecovery(line: GuardPayLine, rows: ArrivalCash[], period: string): GuardPayLine {
  const applicable=rows.filter(r=>r.personId===line.personId && arrivalBalance(r)>0 && !r.repayments.some(p=>p.period===period));
  if (!applicable.length || line.gross<=0) return line;
  const out={...line,items:[...line.items],flags:[...line.flags],holds:[...(line.holds??[])],arrivalParts:[] as NonNullable<GuardPayLine['arrivalParts']>};
  for (const r of applicable) {
    if (r.requests.some(q=>q.handover && !q.handover.evidence)) {out.flags.push('Arrival handover acknowledgement remains pending; recovery deferred, ordinary wages remain payable.');continue;}
    const p=r.policy;
    if (!p || period<p.fromPeriod || period>p.toPeriod) { out.flags.push('Arrival recovery deferred pending current Finance/legal policy review; no default cap applies and ordinary wages remain payable.'); continue; }
    const total=rounded(r.requests.reduce((s,q)=>s+(q.handover?.amount??0),0));
    const due=Math.min(arrivalBalance(r), Math.ceil(total*100/r.months)/100);
    const room=Math.max(0,rounded(line.gross*p.capPercent/100-out.deductions));
    const take=rounded(Math.min(due,room));
    if (out.deductions>rounded(line.gross*p.capPercent/100)) out.holds.push('All deductions exceed the reviewed arrival recovery cap; resolve before payroll release.');
    if (take>0) {
      out.arrivalParts.push({id:r.id,amount:take,balanceBefore:arrivalBalance(r),policyId:p.id,recoveryAccount:p.recoveryAccount,totalDisbursed:total});
      out.items.push({kind:'arrival',label:`Arrival advance recovery ${r.id}`,qty:null,unit:null,rate:null,amount:-take});
      out.deductions=rounded(out.deductions+take); out.net=rounded(out.net-take);
    }
    if (take<due) out.flags.push(`Arrival recovery ${r.id}: RM${rounded(due-take).toFixed(2)} deferred; balance retained.`);
  }
  return out;
}

export async function checkArrivalSnapshot(tx: Store, companyId: string, lines: GuardPayLine[], period: string) {
  const f=await tx.get('finStatus',`fin-${companyId}`), rows=f?.arrivalCash??[];
  for (const l of lines) {
    const old=l.arrivalParts??[], total=rounded(old.reduce((s,p)=>s+p.amount,0));
    const base={...l,arrivalParts:[],deductions:rounded(l.deductions-total),net:rounded(l.net+total),items:l.items.filter(x=>x.kind!=='arrival')};
    const fresh=applyArrivalRecovery(base,rows,period);
    if (JSON.stringify(fresh.arrivalParts??[])!==JSON.stringify(old) || (fresh.holds?.length??0)>(l.holds?.length??0)) throw new BadRequest('Arrival balance, review or recovery snapshot changed; return to HR and recalculate.');
  }
}
export async function recordArrivalRepayments(tx: Store, companyId: string, runId: string, period: string, lines: GuardPayLine[], user: User, at: string) {
  await tx.lock?.('finStatus',`fin-${companyId}`);
  await checkArrivalSnapshot(tx,companyId,lines,period);
  const f=await tx.get('finStatus',`fin-${companyId}`); if (!f) return;
  const rows=structuredClone(f.arrivalCash??[]); let changed=false;
  for (const line of lines) for (const part of line.arrivalParts??[]) {
    const r=rows.find(x=>x.id===part.id && x.personId===line.personId);
    if (!r || r.repayments.some(p=>p.period===period || p.runId===runId) || arrivalBalance(r)<part.amount) throw new BadRequest('Arrival repayment was already recorded or its balance changed.');
    r.repayments.push({byId:user.id,by:user.name,at,runId,period,amount:part.amount,policyId:part.policyId});
    r.notices.push({byId:user.id,by:user.name,at,event:'repayment',reference:runId}); changed=true;
  }
  if (changed) await tx.update('finStatus',f.id,{arrivalCash:rows});
}
