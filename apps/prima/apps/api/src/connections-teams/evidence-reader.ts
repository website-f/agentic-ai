/** SERVER ONLY. No browser DTO, public ingestion endpoint, provider URL or Finance mutation.
 * A future adapter must independently authenticate the selected Microsoft/Power Automate evidence source.
 * This verifier cannot turn a pasted link, caller assertion, or TEAMS_APPROVALS_READ flag into approval. */
import {createHash} from 'node:crypto';
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9:_-]{1,160}$/;
const text=(x:unknown,max:number):x is string=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(x,k));
const instant=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
export interface TeamsSourceIdentity {tenantId:string;environmentId:string;flowId:string;producerObjectId:string;}
/** Construct ONLY from current Finance state, never from a request body. Identical resubmission needs a new attemptId. */
export interface TeamsPaymentAttempt {
 tenantId:string;companyId:string;paymentId:string;paymentVersion:number;attemptId:string;fingerprint:string;
 beneficiaryId:string;beneficiaryVersion:number;amountMinor:number;currency:string;reference:string;
 approvalId:string;requiredApproverOids:readonly string[];forbiddenActorOids:readonly string[];
 createdAt:string;expiresAt:string;route:'teams';
}
export interface TeamsSourceRead {authenticatedSource:TeamsSourceIdentity;observedAt:string;record:unknown;}
/** Injection is server composition, not configuration accepted from users. A production adapter is not installed by this module. */
export interface TrustedTeamsEvidenceSource {
 readonly identity:TeamsSourceIdentity;
 readSelected(approvalId:string,signal:AbortSignal):Promise<TeamsSourceRead>;
}
export interface VerifiedTeamsEvidence {
 readonly kind:'VerifiedTeamsApprovalEvidence';readonly source:Readonly<TeamsSourceIdentity>;
 readonly sourceResultId:string;readonly sourceVersion:string;readonly approvalId:string;
 readonly payment:Readonly<TeamsPaymentAttempt>;readonly decisions:readonly Readonly<{oid:string;decision:'Approve';decidedAt:string;comment:string}>[];
 readonly observedAt:string;readonly validUntil:string;readonly evidenceHash:string;
}
const issued=new WeakSet<object>();
export const isVerifiedTeamsEvidence=(x:unknown):x is VerifiedTeamsEvidence=>!!x&&typeof x==='object'&&issued.has(x);
export type TeamsReadResult={state:'Verified';evidence:VerifiedTeamsEvidence}|{state:'NotConfigured'|'Unavailable'|'Pending'|'Rejected'|'Cancelled'|'Expired'|'VerificationRequired';reason:string};
const sourceValid=(s:TeamsSourceIdentity)=>obj(s)&&exact(s as unknown as Record<string,unknown>,['tenantId','environmentId','flowId','producerObjectId'])&&GUID.test(s.tenantId)&&GUID.test(s.producerObjectId)&&ID.test(s.environmentId)&&ID.test(s.flowId);
const sourceSame=(a:TeamsSourceIdentity,b:TeamsSourceIdentity)=>sourceValid(a)&&sourceValid(b)&&['tenantId','environmentId','flowId','producerObjectId'].every(k=>a[k as keyof TeamsSourceIdentity]===b[k as keyof TeamsSourceIdentity]);
function validAttempt(p:TeamsPaymentAttempt){return obj(p)&&exact(p as unknown as Record<string,unknown>,['tenantId','companyId','paymentId','paymentVersion','attemptId','fingerprint','beneficiaryId','beneficiaryVersion','amountMinor','currency','reference','approvalId','requiredApproverOids','forbiddenActorOids','createdAt','expiresAt','route'])&&p.route==='teams'&&GUID.test(p.tenantId)&&[p.companyId,p.paymentId,p.attemptId,p.beneficiaryId,p.approvalId].every(x=>typeof x==='string'&&ID.test(x))&&Number.isSafeInteger(p.paymentVersion)&&p.paymentVersion>0&&Number.isSafeInteger(p.beneficiaryVersion)&&p.beneficiaryVersion>0&&Number.isSafeInteger(p.amountMinor)&&p.amountMinor>0&&/^[A-Z]{3}$/.test(p.currency)&&text(p.reference,160)&&HASH.test(p.fingerprint)&&Array.isArray(p.requiredApproverOids)&&p.requiredApproverOids.length>0&&p.requiredApproverOids.length<=20&&p.requiredApproverOids.every(x=>GUID.test(x))&&new Set(p.requiredApproverOids).size===p.requiredApproverOids.length&&Array.isArray(p.forbiddenActorOids)&&p.forbiddenActorOids.length<=50&&p.forbiddenActorOids.every(x=>GUID.test(x))&&p.requiredApproverOids.every(x=>!p.forbiddenActorOids.includes(x))&&Number.isFinite(instant(p.createdAt))&&instant(p.expiresAt)>instant(p.createdAt);}
export class TeamsApprovalEvidenceReader {
 constructor(private readonly source:TrustedTeamsEvidenceSource|null=null,private readonly clock:()=>Date=()=>new Date()){}
 status(){return {status:this.source&&sourceValid(this.source.identity)?'ConfiguredNotVerified' as const:'NotConfigured' as const,providerVerified:false as const,
   setupReason:this.source&&sourceValid(this.source.identity)?'SelectedEvidenceReadRequired' as const:'TrustedReaderUnavailable' as const,canApplyFinanceApproval:false as const};}
 async read(attempt:TeamsPaymentAttempt,signal?:AbortSignal):Promise<TeamsReadResult>{
  if(!this.source||!sourceValid(this.source.identity))return {state:'NotConfigured',reason:'TrustedReaderUnavailable'};
  // Defensive copy before await prevents caller mutation while evidence is being read.
  let p:TeamsPaymentAttempt;try{p=structuredClone(attempt);}catch{return {state:'VerificationRequired',reason:'InvalidCurrentAttempt'};}
  const now=this.clock().getTime();if(!Number.isFinite(now)||!validAttempt(p)||p.tenantId!==this.source.identity.tenantId)return {state:'VerificationRequired',reason:'InvalidCurrentAttempt'};
  if(instant(p.expiresAt)<=now)return {state:'Expired',reason:'CurrentAttemptExpired'};
  if(instant(p.createdAt)>now+30_000)return {state:'VerificationRequired',reason:'InvalidCurrentAttempt'};
  const sourceIdentity=Object.freeze({...this.source.identity}),deadline=AbortSignal.timeout(8000),budget=signal?AbortSignal.any([deadline,signal]):deadline;
  try{
   if(budget.aborted)return {state:'Unavailable',reason:'ReadCancelled'};
   let abort:()=>void=()=>{};
   const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('Read cancelled'));budget.addEventListener('abort',abort,{once:true});});
   let response:TeamsSourceRead;try{response=await Promise.race([this.source.readSelected(p.approvalId,budget),cancelled]);}finally{budget.removeEventListener('abort',abort);}
   if(budget.aborted)return {state:'Unavailable',reason:'ReadCancelled'};
   const checked=this.clock().getTime(),observed=instant(response.observedAt),r=response.record;
   if(!Number.isFinite(checked)||!sourceSame(response.authenticatedSource,sourceIdentity)||!sourceSame(this.source.identity,sourceIdentity)||!Number.isFinite(observed)||observed<checked-300_000||observed>checked+30_000)return {state:'VerificationRequired',reason:'UntrustedOrStaleSource'};
   if(!obj(r)||JSON.stringify(r).length>65_536||!exact(r,['tenantId','environmentId','flowId','resultId','version','approvalId','payment','outcome','completedAt','responses'])||r.tenantId!==p.tenantId||r.environmentId!==sourceIdentity.environmentId||r.flowId!==sourceIdentity.flowId||!text(r.resultId,160)||!ID.test(r.resultId)||!text(r.version,100)||r.approvalId!==p.approvalId)return {state:'VerificationRequired',reason:'InvalidEvidenceEnvelope'};
   const binding={companyId:p.companyId,paymentId:p.paymentId,paymentVersion:p.paymentVersion,attemptId:p.attemptId,fingerprint:p.fingerprint,beneficiaryId:p.beneficiaryId,beneficiaryVersion:p.beneficiaryVersion,amountMinor:p.amountMinor,currency:p.currency,reference:p.reference};
   const paymentRecord=r.payment;
   if(!obj(paymentRecord)||!exact(paymentRecord,Object.keys(binding))||Object.entries(binding).some(([k,v])=>paymentRecord[k]!==v))return {state:'VerificationRequired',reason:'PaymentAttemptMismatch'};
   if(checked>=instant(p.expiresAt))return {state:'Expired',reason:'CurrentAttemptExpired'};
   if(r.outcome==='Pending')return {state:'Pending',reason:'ApprovalNotComplete'};
   if(r.outcome==='Cancelled')return {state:'Cancelled',reason:'ApprovalCancelled'};
   if(r.outcome==='Rejected')return {state:'Rejected',reason:'ApprovalRejected'};
   if(r.outcome!=='Approved'||!Array.isArray(r.responses)||r.responses.length!==p.requiredApproverOids.length)return {state:'VerificationRequired',reason:'IncompleteDecisionSet'};
   const completed=instant(r.completedAt);if(!Number.isFinite(completed)||completed<instant(p.createdAt)||completed>observed+30_000||completed>checked+30_000||completed>instant(p.expiresAt))return {state:'VerificationRequired',reason:'InvalidDecisionTime'};
   const decisions:{oid:string;decision:'Approve';decidedAt:string;comment:string}[]=[];
   for(const x of r.responses){if(!obj(x)||!exact(x,['oid','decision','decidedAt','comment'])||typeof x.oid!=='string'||!p.requiredApproverOids.includes(x.oid)||decisions.some(d=>d.oid===x.oid)||x.decision!=='Approve'||typeof x.comment!=='string'||x.comment.length>2000||/[\u0000-\u001f\u007f]/.test(x.comment)||!Number.isFinite(instant(x.decidedAt))||instant(x.decidedAt)<instant(p.createdAt)||instant(x.decidedAt)>completed||instant(x.decidedAt)>instant(p.expiresAt))return {state:'VerificationRequired',reason:'IneligibleOrIncompleteDecision'};decisions.push({oid:x.oid,decision:'Approve',decidedAt:new Date(instant(x.decidedAt)).toISOString(),comment:x.comment});}
   const payment=Object.freeze({...p,requiredApproverOids:Object.freeze([...p.requiredApproverOids]),forbiddenActorOids:Object.freeze([...p.forbiddenActorOids])});
   const data={kind:'VerifiedTeamsApprovalEvidence' as const,source:sourceIdentity,sourceResultId:r.resultId,sourceVersion:r.version,approvalId:p.approvalId,payment,decisions:Object.freeze(decisions.map(d=>Object.freeze(d))),observedAt:new Date(observed).toISOString(),validUntil:new Date(Math.min(observed+300_000,instant(p.expiresAt))).toISOString()};
   const evidence=Object.freeze({...data,evidenceHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')});issued.add(evidence);return {state:'Verified',evidence};
  }catch{return {state:'Unavailable',reason:'EvidenceReadUnavailable'};}
 }
}

/** Finance calls this inside its transaction, then consumes (source,resultId,version) and attempt atomically with approval/audit. This helper does NOT consume replay or apply approval. */
export function teamsEvidenceMatchesCurrentAttempt(evidence:unknown,current:TeamsPaymentAttempt,now:Date):evidence is VerifiedTeamsEvidence{
 if(!isVerifiedTeamsEvidence(evidence)||!validAttempt(current)||!Number.isFinite(now.getTime())||instant(evidence.validUntil)<=now.getTime()||instant(current.expiresAt)<=now.getTime())return false;
 return Object.keys(current).every(k=>{const a=current[k as keyof TeamsPaymentAttempt],b=evidence.payment[k as keyof TeamsPaymentAttempt];return Array.isArray(a)&&Array.isArray(b)?JSON.stringify([...a].sort())===JSON.stringify([...b].sort()):a===b;});
}
