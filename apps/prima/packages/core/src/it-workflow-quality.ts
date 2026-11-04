/** Pure source-evidence projection. Call only after the domain adapter authorizes the record. */
import type {ItJob,ItTicket} from './types';
import type {MetricQuality} from './it-workflow-metrics-types';
export const unknownMetricQuality=():MetricQuality=>({firstPassAccepted:null,returnCount:null,reopenedCount:null,requiredEvidenceComplete:null,errorCount:null,requesterConfirmed:null,evidenceRefs:[]});
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
export function jobMetricQuality(j:ItJob):MetricQuality{
 const q=unknownMetricQuality(),returns=count(j.returns),submitted=j.log.some(e=>e.what==='submit'&&!!e.byId),accepted=j.log.some(e=>e.what==='accept'&&!!e.byId&&e.byId!==j.assigneeId);
 q.returnCount=returns;
 // Imported/legacy status without actual submission and independent acceptance events is not proof.
 if(j.status==='accepted'&&submitted&&accepted&&returns!==null)q.firstPassAccepted=returns===0;
 if(submitted)q.requiredEvidenceComplete=j.proof.length>0;
 q.evidenceRefs=j.proof.map((p,index)=>`${j.id}:proof:${index}:${p.sha256}`);return q;
}
export function ticketMetricQuality(t:ItTicket):MetricQuality{
 const q=unknownMetricQuality();q.reopenedCount=count(t.reopened);
 // A timeout, proxy confirmation or IT checker is not explicit requester satisfaction.
 const linked=t.sourceRef?.startsWith('web:');
 const requester=!!t.confirmedAt&&!t.raisedFor&&(linked?(t.webHistory??[]).some(e=>e.action==='confirm'&&e.actorId===t.raisedById&&e.at===t.confirmedAt):true);
 if(requester)q.requesterConfirmed=true;
 if(requester&&q.reopenedCount!==null)q.firstPassAccepted=q.reopenedCount===0;
 if(t.status==='resolved'&&t.resolvedById)q.requiredEvidenceComplete=t.resolution.trim().length>=3;
 q.evidenceRefs=linked?(t.webHistory??[]).filter(e=>e.action==='resolve'||e.action==='confirm'||e.action==='return').map(e=>`${t.id}:resolution:${e.resolutionVersion}:${e.action}:${e.at}`):[];
 return q;
}
