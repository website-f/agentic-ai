const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root=path.resolve(__dirname,'..');
const compile=n=>ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/duty',n+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
// This deliberately serializes transactions per database, supports chained request callbacks,
// CryptoKey structured cloning, add uniqueness, atomic rollback, and injected aborts.
function databaseFactory(){
 const databases=new Map();const fail=new Set();
 function connection(name){const state=databases.get(name);return {
  objectStoreNames:{contains:n=>state.stores.has(n)},createObjectStore(n){state.stores.set(n,new Map())},close(){},
  transaction(store,mode){
   const t={error:null},requests=[];let active=false,pending=0,finished=false,map;
   let finishResolve;const done=new Promise(r=>finishResolve=r);
   const previous=state.tail;state.tail=previous.then(()=>done);
   const finish=()=>{if(finished||pending)return;finished=true;
    if(fail.delete(name+':'+store)){t.error=new Error('Synthetic transaction abort');t.onabort?.();}
    else {if(mode==='readwrite')state.stores.set(store,map);t.oncomplete?.();}
    finishResolve();};
   const request=fn=>{const r={};pending++;const run=()=>setImmediate(()=>{
    if(finished)return;
    try {r.result=fn();r.onsuccess?.();pending--;setImmediate(finish)}catch(e){t.error=e;finished=true;r.onerror?.();t.onerror?.();t.onabort?.();finishResolve();}
   });if(active)run();else requests.push(run);return r;};
   t.objectStore=()=>({get:k=>request(()=>structuredClone(map.get(k))),getAll:()=>request(()=>structuredClone([...map.values()])),
    put:(v,k)=>request(()=>{k??=v.clientRef;map.set(k,structuredClone(v));return k}),
    add:(v,k)=>request(()=>{k??=v.clientRef;if(map.has(k))throw new Error('ConstraintError');map.set(k,structuredClone(v));return k}),
    delete:k=>request(()=>map.delete(k))});
   previous.then(()=>{map=structuredClone(state.stores.get(store));active=true;requests.forEach(r=>r());});return t;
  }};}
 return {databases,fail,open(name){const r={};setImmediate(()=>{const fresh=!databases.has(name);if(fresh)databases.set(name,{stores:new Map(),tail:Promise.resolve()});r.result=connection(name);if(fresh)r.onupgradeneeded?.();r.onsuccess?.();});return r;}};
}
const A={accountId:'synthetic-account-A',companyId:'synthetic-company-A',siteId:'synthetic-site-A',deviceId:'synthetic-device-A',enrollmentId:'synthetic-enrollment-A'};
const job=(n,kind='post')=>kind==='post'?{kind,body:{staffNo:'SYNTHETIC',pin:'1234',kind:'routine',text:'Synthetic '+n}}:{kind:'gateIn',body:{staffNo:'SYNTHETIC',pin:'1234',kind:'vehicle',vehicle:{plate:'TEST-'+n}}};
function tab(idb){
 const fixture={context:{...A},mode:'online',calls:[],pause:null};const modules={};
 class ApiError extends Error{constructor(message,status){super(message);this.status=status}}
 const api={dutyDevice:async()=>{if(fixture.pause)await fixture.pause;if(fixture.mode==='offline')throw new TypeError('offline');return {offlineContext:structuredClone(fixture.context),inside:[{name:'SYNTHETIC VISITOR'}],tasks:[]}}};
 for(const key of ['addPostLog','gateIn','gateOut','doSiteTask'])api[key]=async(...args)=>{
  if(fixture.mode==='offline')throw new TypeError('offline');if(fixture.mode==='expired')throw new ApiError('Expired',401);
  if(fixture.mode==='refused')throw new ApiError('Refused',403);
  assert.equal(JSON.stringify(args.at(-1).offlineContext),JSON.stringify(fixture.context));fixture.calls.push({key,args});return {ok:true};};
 const ctx=vm.createContext({require:id=>id==='@prima/core'?{fromMs:ms=>new Date(ms).toISOString()}:id==='../api'?{api,ApiError}:modules.context,indexedDB:idb,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Event,structuredClone,window:{dispatchEvent(){},addEventListener(){}},navigator:{onLine:true},setInterval(){},console});
 for(const name of ['context','offline']){ctx.exports={};vm.runInContext(compile(name),ctx);modules[name]=ctx.exports;}
 return {f:fixture,o:modules.offline,c:modules.context,async bind(c=A){fixture.context={...c};fixture.mode='online';await modules.offline.loadDuty()},dbname(){return 'prima-duty-device-v2-'+encodeURIComponent(modules.context.contextKey(fixture.context))},stores(){return idb.databases.get(this.dbname()).stores}};
}
(async()=>{
 let n=0;const pass=s=>{n++;console.log('PASS '+s)};const idb=databaseFactory(),h=tab(idb);await h.bind();h.f.mode='offline';await h.o.submit(job(1,'gateIn'));
 assert.equal((await h.o.outbox(A.siteId))[0].label,'Gate in: TEST-1');pass('original enrollment decrypts queued entry');
 for(const field of Object.keys(A)){
  h.c.invalidateDutyContext(false);await h.bind({...A,[field]:'synthetic-other'});
  assert.equal((await h.o.outbox(h.f.context.siteId)).length,0);assert.equal((await h.o.flush()).sent,0);
  h.stores().get('meta').delete('duty');assert.equal(await h.o.cachedDuty(),null);pass(field+' isolates cache, outbox and resend');
 }
 h.c.invalidateDutyContext(false);await h.bind();assert.equal((await h.o.outbox(A.siteId)).length,1);pass('original queue survives switch and re-enrollment');
 h.c.invalidateDutyContext(false);assert.equal(await h.o.cachedDuty(),null);assert.equal((await h.o.flush()).sent,0);pass('logout locks cache and queue without deletion');
 await h.bind();h.f.context={...A,siteId:'server-reassigned'};await assert.rejects(h.o.flush(),/enrollment changed/);assert.equal(h.f.calls.length,0);pass('server reassignment stops send');
 h.c.invalidateDutyContext(false);await h.bind();h.f.mode='expired';await assert.rejects(h.o.flush(),/Expired/);assert.equal((await h.o.outbox(A.siteId))[0].status,'waiting');pass('401 preserves retryable records');
 h.f.mode='online';assert.equal((await h.o.flush()).sent,1);assert.equal(JSON.stringify(h.f.calls[0].args[0].offlineContext),JSON.stringify(A));pass('authorized resend includes immutable full context');
 const fresh={...A,enrollmentId:'synthetic-race'};const tabs=Array.from({length:6},()=>tab(idb));
 for(const t of tabs){t.f.context=fresh;t.c.bindDutyContext(fresh,t.c.contextGeneration());t.f.mode='offline'}
 await Promise.all(tabs.flatMap((t,i)=>[t.o.submit(job(i+'a')),t.o.submit(job(i+'b'))]));
 const rows=await tabs[0].o.outbox(A.siteId);assert.equal(rows.length,12);assert.ok(rows.every(r=>!r.error));pass('six isolated modules, twelve concurrent first writes retain all records');
 const key=tabs[0].stores().get('meta').get('key');assert.equal(key.extractable,false);pass('stored CryptoKey non-exportable');
 const out=tabs[0].stores().get('outbox');const row=[...out.values()][0];row.createdAt='2000-01-01';
 assert.equal((await tabs[0].o.outbox(A.siteId)).filter(r=>r.status==='refused').length,1);pass('tampered row metadata rejected by AES-GCM');
 h.stores().get('outbox').set([...out.keys()][1],structuredClone([...out.values()][1]));h.stores().get('meta').set('key',key);
 assert.equal((await h.o.outbox(A.siteId))[0].status,'refused');pass('copied key and ciphertext rejected across namespaces');
 // Do not generate a replacement key when the stored key is missing.
 tabs[0].stores().get('meta').delete('key');assert.ok((await tabs[0].o.outbox(A.siteId)).every(r=>r.status==='refused'));assert.equal(tabs[0].stores().get('meta').has('key'),false);pass('decryption with missing key does not create replacement');
 const interrupted=tab(idb);interrupted.f.context={...A,enrollmentId:'interrupted'};interrupted.c.bindDutyContext(interrupted.f.context,0);interrupted.f.mode='offline';idb.fail.add(interrupted.dbname()+':meta');
 await assert.rejects(interrupted.o.submit(job('aborted')),/abort/);await interrupted.o.submit(job('retry'));assert.equal((await interrupted.o.outbox(A.siteId)).length,1);pass('aborted key initialization stores no record and retry recovers');
 // In-flight operation cannot save data under the newly signed-in identity.
 const paused=tab(idb);await paused.bind();let release;paused.f.pause=new Promise(r=>release=r);const pending=paused.o.submit(job('paused'));
 paused.c.invalidateDutyContext(false);release();await assert.rejects(pending,/context changed/);pass('account change during preflight blocks in-flight submit');
 const loading=tab(idb);await loading.bind();let releaseLoad;loading.f.pause=new Promise(r=>releaseLoad=r);const load=loading.o.loadDuty();
 loading.c.invalidateDutyContext(false);loading.c.bindDutyContext({...A,accountId:'other-current-account'},loading.c.contextGeneration());loading.f.mode='offline';releaseLoad();
 await assert.rejects(load,/Context changed/);pass('in-flight failed load cannot fall back into a newer account cache');
 const reload=tab(idb);assert.equal(await reload.o.cachedDuty(),null);pass('fresh module cannot reuse stored authenticated lease');
 const disabled=tab(databaseFactory());disabled.f.mode='offline';await assert.rejects(disabled.o.submit(job('disabled')),/disabled/);pass('missing enrollment fails closed and does not claim saved');
 console.log(`RESULT ${n} synthetic IndexedDB / real WebCrypto checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
