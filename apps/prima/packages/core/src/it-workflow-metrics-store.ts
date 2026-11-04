import type {Store} from './store';
import {withItRecordLock} from './it-manual';
import type {MetricPort} from './it-workflow-metrics';
import type {MetricCalendar,MetricReceipt,MetricRef,MetricStream,MetricTarget} from './it-workflow-metrics-types';
/** Production is blocked until the separate catalog verifier is installed and passes. */
export class StoreMetricPort implements MetricPort {
 constructor(readonly domain:Store){}
 problems(){return this.domain.workflowMetricProblems?.()??Promise.resolve(['WORKFLOW_METRICS_NOT_CONFIGURED']);}
 transaction<T>(ownerId:string,run:(tx:MetricPort)=>Promise<T>):Promise<T>{return withItRecordLock(this.domain,'metrics:'+ownerId,tx=>run(new StoreMetricPort(tx)));}
 async lockRequest(ownerId:string,requestId:string){await this.domain.lock?.('itSettings','it-manual:metric-request:'+ownerId+':'+requestId);}
 async lockStream(id:string){await this.domain.lock?.('itSettings','it-manual:metric-stream:'+id);await this.domain.lock?.('itMetricStreams',id);}
 async stream(id:string){return await this.domain.get('itMetricStreams',id)??null;}
 streams(){return this.domain.list('itMetricStreams',{});}
 async nextSegment(ref:MetricRef){if(!this.domain.workflowMetricNextSegment)throw Error('Workflow segment authority adapter unavailable.');const value=await this.domain.workflowMetricNextSegment(ref);if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid workflow coverage segment.');return value;}
 async receipt(ownerId:string,requestId:string){const row=await this.domain.get('itMetricReceipts',ownerId+':'+requestId);return row?.receipt??null;}
 async putStream(stream:MetricStream){if(await this.domain.get('itMetricStreams',stream.id))await this.domain.update('itMetricStreams',stream.id,(({id:_,...patch})=>patch)(stream));else await this.domain.insert('itMetricStreams',stream);}
 async putReceipt(receipt:MetricReceipt){await this.domain.insert('itMetricReceipts',{id:receipt.userId+':'+receipt.requestId,receipt});}
 async target(ref:MetricRef){return (await this.targets()).filter(t=>t.workflow===ref.workflow&&t.stage===ref.stage&&t.complexity===ref.complexity).sort((a,b)=>b.version-a.version)[0]??null;}
 async targets(){return (await this.domain.list('itMetricTargets',{})).map(r=>r.target);}
 async appendTarget(target:MetricTarget){await this.domain.insert('itMetricTargets',{id:target.id+':'+target.version,target});}
 async calendar():Promise<MetricCalendar|null>{return (await this.domain.list('itMetricCalendars',{})).map(r=>r.calendar).sort((a,b)=>b.version-a.version)[0]??null;}
 async audit(e:{actorId:string;at:string;action:string;streamId:string;requestId:string;version:number}){await this.domain.audit({at:e.at,actor:e.actorId,companyId:null,action:e.action,entity:'itMetricStreams',entityId:e.streamId,summary:JSON.stringify({requestId:e.requestId,version:e.version})});}
}
