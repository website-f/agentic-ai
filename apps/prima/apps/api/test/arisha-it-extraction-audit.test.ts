import test from 'node:test';
import assert from 'node:assert/strict';
import { ItExtractionPreviewService, type ExtractionAuditEvent } from '../src/arisha-it-extraction';
import { extractionAudit } from '../src/arisha-it-extraction-audit';
const actor={id:'u-fauzan',opsTier:'ceo',verifiedEntra:true};
const cfg={enabled:true,arishaEnabled:true,sourceTypes:['paste'],dataClasses:['synthetic']};
const body={kind:'tickets',source:{type:'paste',label:'PRIVATE_LABEL',text:'PRIVATE_SOURCE\r\nonly',dataClass:'synthetic'},acknowledgement:{version:'it-extraction-v1',sendToAzure:true}};
test('audit is required before any model transfer',async()=>{
 let calls=0;const model={extract:async()=>{calls++;return{rows:[]};}};
 for(const audit of [undefined,{append:async()=>{throw Error('PRIVATE_STORAGE');}}]){
  const svc=new ItExtractionPreviewService(model,cfg,10,audit);
  await assert.rejects(svc.preview(actor,body),{message:'MODEL_UNAVAILABLE'});
 }
 assert.equal(calls,0);
});
test('committed start precedes single model call; linked success excludes content and labels',async()=>{
 const events:ExtractionAuditEvent[]=[];let calls=0;
 const svc=new ItExtractionPreviewService({extract:async()=>{calls++;assert.equal(events.length,1);assert.equal(events[0].phase,'started');return{rows:[]};}},cfg,50,{append:async e=>{events.push(e);}});
 const result=await svc.preview(actor,body);assert.equal(calls,1);assert.equal(events.length,2);assert.equal(events[1].outcome,'success');assert.equal(events[0].attemptId,result.extractionId);assert.equal(events[1].attemptId,result.extractionId);
 assert.equal(events[0].sourceLength,'PRIVATE_SOURCE\nonly'.length);assert.equal(events[0].sourceSha256,result.source.sha256);assert.equal(events[0].selfDeclaredDataClass,'synthetic');assert(!JSON.stringify(events).includes('PRIVATE_'));
});
test('failure, refusal and timeout each produce one allowlisted terminal outcome without raw error',async()=>{
 for(const [extract,want] of [[async()=>{throw Error('PRIVATE_TOKEN');},'provider_failed'],[async()=>({unexpected:'PRIVATE_OUTPUT'}),'invalid_model_output'],[()=>new Promise(()=>{}),'timeout_transfer_unknown']] as const){
  const events:ExtractionAuditEvent[]=[];let calls=0;
  const svc=new ItExtractionPreviewService({extract:async()=>{calls++;return extract();}},cfg,5,{append:async e=>{events.push(e);}});
  await assert.rejects(svc.preview(actor,body));assert.equal(calls,1);assert.equal(events.length,2);assert.equal(events[1].outcome,want);assert(!JSON.stringify(events).includes('PRIVATE_'));
 }
});
test('uncertain terminal persistence is not retried or reported as success',async()=>{
 const events:ExtractionAuditEvent[]=[];let calls=0;
 const svc=new ItExtractionPreviewService({extract:async()=>{calls++;return{rows:[]};}},cfg,50,{append:async e=>{events.push(e);if(e.phase==='terminal')throw Error('PRIVATE_STORAGE');}});
 await assert.rejects(svc.preview(actor,body),{message:'MODEL_UNAVAILABLE'});assert.equal(calls,1);assert.equal(events.length,2);
});
test('unauthorized, unapproved class and invalid consent never create transfer events',async()=>{
 let calls=0,events=0;const svc=new ItExtractionPreviewService({extract:async()=>{calls++;return{rows:[]};}},cfg,5,{append:async()=>{events++;}});
 await assert.rejects(svc.preview({...actor,id:'u-other'},body));
 await assert.rejects(svc.preview(actor,{...body,source:{...body.source,dataClass:'approved-it-work'}}));
 await assert.rejects(svc.preview(actor,{...body,acknowledgement:{...body.acknowledgement,sendToAzure:false}}));
 assert.equal(calls,0);assert.equal(events,0);
});
test('persistent sink reauthorizes and writes only allowlisted metadata in separate asUser call',async()=>{
 let entries:any[]=[];let count=0;let user:any={id:'u-fauzan',opsTier:'ceo'};
 const db:any={asUser:async(id:string,fn:Function)=>{count++;assert.equal(id,'u-fauzan');await fn({},user,{audit:async(e:any)=>entries.push(e)});}};
 const sink=extractionAudit(db);
 const event:ExtractionAuditEvent={attemptId:'attempt-test',actorId:'u-fauzan',at:'2026-10-31T00:00:00Z',phase:'started',sourceSha256:'a'.repeat(64),sourceLength:10,kind:'tickets',selfDeclaredDataClass:'synthetic',consentVersion:'it-extraction-v1',outcome:'started'};
 await sink.append({...event,privateText:'PRIVATE'} as any);assert.equal(entries.length,1);assert.equal(entries[0].actor,'u-fauzan');assert.equal(entries[0].companyId,null);assert(!JSON.stringify(entries).includes('PRIVATE'));assert.equal(count,1);
 user={...user,opsTier:'coo'};await assert.rejects(sink.append(event));assert.equal(entries.length,1);
});
