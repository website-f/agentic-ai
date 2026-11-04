import type {MetricOperation} from '@prima/core';
import type {CleanupAction} from '../it-cleanup/contract';
import type {ProcurementKind} from '../it-procurement/contract';
import type {RentalCorrectionKind} from '../rental-correction/contract';
import type {HrKind} from '../hr-it/contract';
/** Identity-only recovery. No staff names, URLs, evidence, tokens or form payloads are persisted. */
export type ManualKind = 'intake' | 'system' | 'guidance' | 'asset';
export type OperationKind = 'rental_rates'|'rental_bill'|'rental_history'|'asset_inspection';
export type ReceiptKind = MetricOperation|ManualKind|OperationKind|HrKind|RentalCorrectionKind|ProcurementKind|CleanupAction;
export type PendingManual = { requestId: string; kind: ReceiptKind };
export interface ManualMarker { read(): PendingManual | null; write(value: PendingManual): void; remove(): void; claim<T>(fn: () => Promise<T>): Promise<T>; }
export interface ManualTransport { save(input: Record<string, unknown>): Promise<unknown>; receipt(requestId: string, kind: ReceiptKind): Promise<unknown>; abandon?(requestId: string, kind: ReceiptKind): Promise<unknown>; }
export type ManualState = { phase: 'editing'|'saving'|'uncertain'|'recovering'|'done'; pending: PendingManual|null; receipt: unknown; message: string };
export const validManualId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function manualMarker(userId: string, namespace:'manual-it'|'it-operations'='manual-it'): ManualMarker {
  const key='prima:'+namespace+':'+encodeURIComponent(userId);
  return {
    read(){const raw=localStorage.getItem(key);if(raw===null)return null;const p=JSON.parse(raw);if(!validManualId(p.requestId)||!['intake','system','guidance','asset','rental_rates','rental_bill','rental_history','asset_inspection'].includes(p.kind)||Object.keys(p).sort().join(',')!=='kind,requestId')throw Error('Invalid pending request marker');return p;},
    write(value){localStorage.setItem(key,JSON.stringify(value));}, remove(){localStorage.removeItem(key);},
    claim(fn){if(!navigator.locks)throw Error('Cross-tab protection is unavailable.');return navigator.locks.request(key,{ifAvailable:true},lock=>{if(!lock)throw Error('Another tab is saving this record.');return fn();});}
  };
}
export class ManualSession {
  private state:ManualState={phase:'editing',pending:null,receipt:null,message:''};
  private running=false;private disposed=false;private generation=0;
  constructor(private transport:ManualTransport,private marker:ManualMarker,private changed:()=>void,private newId:()=>string=()=>crypto.randomUUID()) {
    try {const pending=marker.read();if(pending)this.state={...this.state,phase:'uncertain',pending,message:'A previous save needs its receipt checked before a new record can be saved.'};}
    catch {this.state={...this.state,phase:'uncertain',message:'Recovery storage could not be read. Saving is blocked; do not clear browser storage to bypass recovery.'};}
  }
  snapshot(){return this.state;}
  private set(patch:Partial<ManualState>,generation=this.generation){if(!this.disposed&&generation===this.generation){this.state={...this.state,...patch};this.changed();}}
  start(){this.disposed=false;this.generation++;try{const pending=this.marker.read();if(pending)this.set({phase:'uncertain',pending,message:'A previous save needs its receipt checked.'});}catch{this.set({phase:'uncertain',message:'Recovery storage could not be read. Saving is blocked.'});}}
  dispose(){this.disposed=true;this.generation++;}
  async save(kind:ReceiptKind,payload:Record<string,unknown>,id?:string,expectedVersion?:number){
    if(this.disposed||this.running||this.state.phase!=='editing')return;
    this.running=true;const generation=this.generation;this.set({phase:'saving',message:''});
    let attempted=false;
    try {await this.marker.claim(async()=>{
      if(this.disposed||generation!==this.generation)return;
      const existing=this.marker.read();if(existing){this.set({phase:'uncertain',pending:existing,message:'Another pending request must be reconciled first.'},generation);return;}
      const pending={requestId:this.newId(),kind};if(!validManualId(pending.requestId))throw Error('Could not prepare a stable request identity.');
      this.marker.write(pending);const saved=this.marker.read();if(saved?.requestId!==pending.requestId||saved.kind!==kind)throw Error('Recovery identity could not be saved.');
      this.set({pending},generation);attempted=true;
      const result=await this.transport.save({requestId:pending.requestId,kind,payload,...(id?{id,expectedVersion}: {})});
      this.accept(result,pending,generation);
    });}
    catch(e){this.set({phase:attempted||this.state.pending?'uncertain':'editing',message:attempted?'The save result is uncertain. Check the saved receipt; do not create another record.':e instanceof Error?e.message:'Saving is blocked.'},generation);}
    finally{this.running=false;}
  }
  private accept(result:unknown,pending:PendingManual,generation:number){
    const r=result as {serviceId?:unknown;requestId?:unknown;kind?:unknown;terminal?:unknown;recordId?:unknown;version?:unknown;found?:unknown;message?:unknown}|null;
    if(!r||r.serviceId!=='it-manual'||r.requestId!==pending.requestId||r.kind!==pending.kind||r.found===false||!['committed','rejected'].includes(String(r.terminal)))throw Error('Receipt identity or terminal outcome did not match.');
    if(r.terminal==='committed'&&(typeof r.recordId!=='string'||!r.recordId||!Number.isSafeInteger(r.version)||Number(r.version)<1))throw Error('Saved record receipt is incomplete.');
    if(r.terminal==='rejected'&&(r.recordId!==null||r.version!==null))throw Error('Rejection receipt is inconsistent.');
    const current=this.marker.read();if(current&&current.requestId!==pending.requestId)throw Error('A newer pending identity must not be retired.');
    if(current?.requestId===pending.requestId)this.marker.remove();
    if(r.terminal==='rejected')this.set({phase:'editing',receipt:result,pending:null,message:`Not saved. ${typeof r.message==='string'?r.message:'Correct the details or reload the record before trying again.'}`},generation);
    else this.set({phase:'done',receipt:result,pending:null,message:'Record saved in Prima. No external account, access or SharePoint changes were performed.'},generation);
  }

  async recover(){
    if(this.disposed||this.running||!this.state.pending)return;
    this.running=true;const generation=this.generation;this.set({phase:'recovering',message:''});
    try {await this.marker.claim(async()=>{if(this.disposed||generation!==this.generation)return;const pending=this.marker.read();if(!pending)throw Error('No pending identity is available; reload the register.');this.set({pending},generation);const result=await this.transport.receipt(pending.requestId,pending.kind);this.accept(result,pending,generation);});}
    catch(e){this.set({phase:'uncertain',message:`Receipt not confirmed. The pending request is preserved. ${e instanceof Error?e.message:''}`},generation);}
    finally{this.running=false;}
  }
  async cancelPending(){
    if(this.disposed||this.running||!this.state.pending||!this.transport.abandon)return;
    this.running=true;const generation=this.generation;this.set({phase:'recovering',message:'Checking whether the request committed before closing it.'});
    try{await this.marker.claim(async()=>{if(this.disposed||generation!==this.generation)return;const pending=this.marker.read();if(!pending)throw Error('No pending identity is available.');this.set({pending},generation);const result=await this.transport.abandon!(pending.requestId,pending.kind);this.accept(result,pending,generation);});}
    catch(e){this.set({phase:'uncertain',message:`Cancellation is not confirmed. The request is preserved. ${e instanceof Error?e.message:''}`},generation);}
    finally{this.running=false;}
  }

}
