import assert from 'node:assert/strict';
import {it,mock,afterEach} from 'node:test';
import * as db from '../src/db';
import * as manual from '../src/it-manual-readiness';
import * as operations from '../src/it-operations-readiness';
import * as procurement from '../src/procurement-readiness';
import * as rental from '../src/rental-correction-readiness';
import * as cleanup from '../src/it-cleanup-readiness';
import * as metrics from '../src/it-workflow-metrics-readiness';
import * as mail from '../src/connections-mail/pg-job-email-store';
import {releaseCatalogState,moduleCatalogProblems,RELEASE_MODULE_IDS} from '../src/release-catalog';
const hash='a'.repeat(64);
afterEach(()=>mock.restoreAll());
function fixture(options:{base?:unknown[];fail?:string;releaseFails?:boolean;sessionChanged?:boolean}={}){
  const calls:string[]=[];let released:Error|undefined;let releaseCount=0;
  const client={query:async(sql:string)=>{calls.push(sql);if(sql===options.fail)throw new Error('SECRET database details');return {rows:sql.startsWith('SELECT session_user')?[{unchanged_login:!options.sessionChanged}]:sql.startsWith('SELECT id')?(options.base??[{id:1,migration_sha256:hash}]):[]};},release:(error?:Error)=>{releaseCount++;released=error;if(options.releaseFails)throw new Error('SECRET release details');}};
  mock.method(db,'assertRestrictedLogin',async(c:unknown)=>{assert.equal(c,client);calls.push('LOGIN');});
  for(const [mod,name] of [[manual,'itManualProblems'],[operations,'itOperationsProblems'],[procurement,'procurementProblems'],[rental,'rentalCorrectionProblems'],[cleanup,'cleanupSchemaProblems'],[metrics,'workflowMetricProblems']] as const)mock.method(mod as any,name,async()=>[]);
  mock.method(mail,'jobEmailCatalogReadiness',async()=>({ready:true}));
  return {client,calls,pool:{connect:async()=>client} as never,get released(){return released;},get releaseCount(){return releaseCount;}};
}
it('one checked-out restricted login and readonly transaction compose all five catalogs',async()=>{
  const f=fixture();const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,true);assert.deepEqual(Object.keys(r.modules),RELEASE_MODULE_IDS);assert.equal(f.releaseCount,1);
  assert.equal(f.calls[0],'BEGIN READ ONLY');assert(f.calls.indexOf('LOGIN')<f.calls.indexOf('SET LOCAL ROLE prima_app'));assert.equal(f.calls.at(-1),'ROLLBACK');assert(!f.calls.some(c=>/COMMIT|INSERT|UPDATE|DELETE|GRANT/.test(c)));
});
for(const base of [[],[{id:1,migration_sha256:'b'.repeat(64)}],[{id:2,migration_sha256:hash}],[{id:1,migration_sha256:hash},{id:1,migration_sha256:hash}]])it('missing, mismatched or ambiguous base fails closed '+JSON.stringify(base),async()=>{const f=fixture({base});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(r.codes.includes('RELEASE_BASE_NOT_READY'));});
it('invalid manifest never acquires database connection',async()=>{const r=await releaseCatalogState({connect:async()=>{throw new Error('must not connect');}},{baseSha256:'invalid'});assert.deepEqual(r.codes,['RELEASE_INVALID_MANIFEST']);});
for(const [mod,name,id] of [[procurement,'procurementProblems','procurement'],[rental,'rentalCorrectionProblems','rental_corrections'],[cleanup,'cleanupSchemaProblems','cleanup'],[metrics,'workflowMetricProblems','metrics']] as const)it('mandatory module drift '+id,async()=>{const f=fixture();mock.method(mod as any,name,async()=>['internal details']);const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert.equal(r.modules[id].ready,false);assert(!JSON.stringify(r).includes('internal details'));});
it('mail v1/missing/drift cannot pass fifth module',async()=>{const f=fixture();mock.method(mail,'jobEmailCatalogReadiness',async()=>({ready:false,reason:'private catalog detail'}));const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.modules.job_email.ready,false);assert(!JSON.stringify(r).includes('private'));});
it('manual and operations dependencies cannot be omitted',async()=>{const f=fixture();mock.method(operations,'itOperationsProblems',async()=>['bad']);for(const id of RELEASE_MODULE_IDS.filter(id=>id!=='job_email'))assert.notDeepEqual(await moduleCatalogProblems(f.client as never,id),[]);});
it('unknown module is rejected without querying',async()=>{assert.deepEqual(await moduleCatalogProblems({query:async()=>{throw Error('must not query');}} as never,'other' as never),['RELEASE_UNKNOWN_MODULE']);});
it('wrong runtime login is rejected before role switch and raw error is not returned',async()=>{const f=fixture();mock.method(db,'assertRestrictedLogin',async()=>{throw Error('SECRET wrong login');});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(!f.calls.includes('SET LOCAL ROLE prima_app'));assert(!JSON.stringify(r).includes('SECRET'));assert.equal(f.calls.at(-1),'ROLLBACK');});
it('query failure rolls back and sanitizes output',async()=>{const f=fixture({fail:'SELECT id, migration_sha256 FROM prima.schema_info'});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(!JSON.stringify(r).includes('SECRET'));assert.equal(f.releaseCount,1);});
it('failed rollback destroys pooled client and never reports ready',async()=>{const f=fixture({fail:'ROLLBACK'});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(f.released instanceof Error);assert(r.codes.includes('RELEASE_TRANSACTION_CLEANUP_FAILED'));});
it('release failure is sanitized and fails closed',async()=>{const f=fixture({releaseFails:true});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(!JSON.stringify(r).includes('SECRET'));});

it('admin session disguised by SET ROLE prima_api is refused',async()=>{const f=fixture({sessionChanged:true});const r=await releaseCatalogState(f.pool,{baseSha256:hash});assert.equal(r.ready,false);assert(!f.calls.includes('LOGIN'));assert(!f.calls.includes('SET LOCAL ROLE prima_app'));assert.equal(f.calls.at(-1),'ROLLBACK');});
