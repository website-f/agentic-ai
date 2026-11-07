/* Synthetic API only. Real Chromium IndexedDB, CryptoKey structured cloning and WebCrypto. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root = path.resolve(__dirname, '..');
const compiled = name => ts.transpileModule(fs.readFileSync(path.join(root, 'apps/web/src/duty', name+'.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const script = `
const modules = {};
const A = {accountId:'synthetic-account-A',companyId:'synthetic-company-A',siteId:'synthetic-site-A',deviceId:'synthetic-device-A',enrollmentId:'synthetic-enrollment-A'};
window.fixture = {context:A, mode:'online', calls:[], pause:null};
class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
const api = {dutyDevice: async () => { if(fixture.pause) await fixture.pause; if(fixture.mode === 'offline') throw new TypeError('offline'); return {offlineContext:structuredClone(fixture.context),inside:[{name:'SYNTHETIC VISITOR'}],tasks:[]}; }};
for (const key of ['addPostLog','gateIn','gateOut','doSiteTask']) api[key] = async (...args) => {
 if (fixture.mode === 'offline') throw new TypeError('offline');
 if (fixture.mode === 'expired') throw new ApiError('Expired',401);
 if (fixture.mode === 'refused') throw new ApiError('Refused',403);
 const body = args.at(-1);
 if(JSON.stringify(body.offlineContext)!==JSON.stringify(fixture.context)) throw new ApiError('Wrong context',403);
 fixture.calls.push({key,args}); return {ok:true};
};
const require = id => id === '@prima/core' ? {fromMs:ms=>new Date(ms).toISOString()} : id === '../api' ? {api,ApiError} : modules.context;
{ const exports = {}; ${compiled('context')} modules.context=exports; }
{ const exports = {}; ${compiled('offline')} modules.offline=exports; }
window.o=modules.offline; window.c=modules.context;
window.bind = async (context=A) => {fixture.context=structuredClone(context); fixture.mode='online';await o.loadDuty();};
window.job = (n,kind='post') => kind==='post'?{kind,body:{staffNo:'SYNTHETIC',pin:'1234',kind:'routine',text:'Synthetic '+n}}:{kind:'gateIn',body:{staffNo:'SYNTHETIC',pin:'1234',kind:'vehicle',vehicle:{plate:'TEST-'+n}}};
window.dbname=()=> 'prima-duty-device-v2-'+encodeURIComponent(c.contextKey(fixture.context));
window.store = (name,mode,op,dbName=dbname()) => new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onsuccess=()=>{const db=r.result;const t=db.transaction(name,mode);const req=op(t.objectStore(name));t.oncomplete=()=>{db.close();resolve(req.result)};t.onerror=()=>reject(t.error)};r.onerror=()=>reject(r.error)});
`;
(async()=>{
 const tooling = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
 const { chromium } = tooling.chromium ? tooling : tooling.default;
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic offline regression</title><script>'+script+'</script>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 server.unref();
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),headless:true,args:['--no-sandbox']});
 let count=0; const pass=n=>{count++;console.log('PASS '+n)};
 try {
 const context=await browser.newContext();
 const page=await context.newPage(); const url=`http://127.0.0.1:${server.address().port}`; await page.goto(url);
 await page.evaluate(async()=>{await bind();fixture.mode='offline';await o.submit(job(1,'gateIn'));});
 assert.equal(await page.evaluate(async()=> (await o.outbox(fixture.context.siteId))[0].label),'Gate in: TEST-1');pass('original enrollment decrypts its own queued record');
 const original=await page.evaluate(()=>fixture.context);
 for(const field of ['accountId','companyId','siteId','deviceId','enrollmentId']) {
  await page.evaluate(async({original,field})=>{c.invalidateDutyContext(false);await bind({...original,[field]:'synthetic-other-'+field});}, {original,field});
  assert.equal(await page.evaluate(async()=> (await o.outbox(fixture.context.siteId)).length),0);
  assert.equal(await page.evaluate(async()=> (await o.flush()).sent),0);
  // Online load populates only the new context, never the original cached list.
  await page.evaluate(async()=>{await store('meta','readwrite',s=>s.delete('duty'));});
  assert.equal(await page.evaluate(()=>o.cachedDuty()),null);
  pass(field+' isolates queue/cache/send');
 }
 await page.evaluate(async original=>{c.invalidateDutyContext(false);await bind(original);},original);
 assert.equal(await page.evaluate(async()=> (await o.outbox(fixture.context.siteId)).length),1);pass('switching back retains original record and key');
 await page.evaluate(()=>c.invalidateDutyContext(false));
 assert.equal(await page.evaluate(()=>o.cachedDuty()),null);
 assert.equal(await page.evaluate(async()=> (await o.flush()).sent),0);pass('logout locks retained queue and cache');
 await page.evaluate(async original=>{await bind(original);fixture.context={...original,siteId:'server-reassigned'};},original);
 assert.match(await page.evaluate(async()=>{try{await o.flush()}catch(e){return e.message}}),/enrollment changed/);pass('server reassignment preflight prevents resend');
 await page.evaluate(async original=>{c.invalidateDutyContext(false);await bind(original);fixture.mode='expired';},original);
 await page.evaluate(async()=>{try{await o.flush()}catch{}});
 assert.equal(await page.evaluate(async()=> (await o.outbox(fixture.context.siteId))[0].status),'waiting');pass('401 does not permanently refuse or delete pending record');
 await page.evaluate(()=>fixture.mode='online');
 assert.equal(await page.evaluate(async()=> (await o.flush()).sent),1);
 assert.deepEqual(await page.evaluate(()=>fixture.calls[0].args[0].offlineContext),original);pass('authorized replay carries full originating context');
 // Concurrent independent modules/tabs with a fresh namespace and no existing key.
 const tabs=await Promise.all(Array.from({length:6},()=>context.newPage()));
 await Promise.all(tabs.map(p=>p.goto(url)));
 const fresh={...original,enrollmentId:'synthetic-race-enrollment'};
 await Promise.all(tabs.map(p=>p.evaluate(cxt=>{fixture.context=cxt;c.bindDutyContext(cxt,c.contextGeneration());fixture.mode='offline';},fresh)));
 await Promise.all(tabs.map((p,i)=>p.evaluate(async i=>{await Promise.all([o.submit(job(i+'a')),o.submit(job(i+'b'))])},i)));
 const rows=await tabs[0].evaluate(()=>o.outbox(fixture.context.siteId));
 assert.equal(rows.length,12);assert.ok(rows.every(r=>r.status==='waiting'&&!r.error));pass('six tabs / twelve concurrent first writes retain one usable key');
 const key=await tabs[0].evaluate(async()=>{const k=await store('meta','readonly',s=>s.get('key'));return {extractable:k.extractable,algorithm:k.algorithm.name}});
 assert.deepEqual(key,{extractable:false,algorithm:'AES-GCM'});pass('native IndexedDB retains non-exportable AES-GCM CryptoKey');
 // Tampering authenticated metadata must not reveal or send contents.
 await tabs[0].evaluate(async()=>{const rows=await store('outbox','readonly',s=>s.getAll()); rows[0].createdAt='2000-01-01T00:00:00Z';await store('outbox','readwrite',s=>s.put(rows[0]));});
 assert.equal((await tabs[0].evaluate(()=>o.outbox(fixture.context.siteId))).filter(r=>r.status==='refused').length,1);pass('row metadata tampering fails authenticated decryption');
 // Copy ciphertext AND key between contexts: AAD must still reject it.
 await page.evaluate(async({original,fresh})=>{c.invalidateDutyContext(false);await bind(original);const from='prima-duty-device-v2-'+encodeURIComponent(c.contextKey(fresh));const rows=await store('outbox','readonly',s=>s.getAll(),from);const key=await store('meta','readonly',s=>s.get('key'),from);await store('meta','readwrite',s=>s.put(key,'key'));await store('outbox','readwrite',s=>s.put(rows[1]));}, {original,fresh});
 assert.equal((await page.evaluate(()=>o.outbox(fixture.context.siteId)))[0].status,'refused');pass('cross-context copied key and ciphertext rejected by AAD');
 // Cross-tab invalidation locks every other tab, without deleting data.
 await tabs[0].evaluate(()=>c.invalidateDutyContext());
 await tabs[1].waitForFunction(()=>{try{c.dutyLease();return false}catch{return true}});
 assert.equal(await tabs[1].evaluate(async()=> (await o.outbox(fixture.context.siteId)).length),0);pass('logout broadcasts fail-closed lock across tabs');
 // A browser reload cannot restore an authenticated lease from storage.
 await page.reload();assert.equal(await page.evaluate(()=>o.cachedDuty()),null);pass('reload requires fresh online identity verification');
 // Preserve legacy DB bytes; never infer provenance from legacy cache or outbox.
 await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('prima-duty-device',1);r.onupgradeneeded=()=>r.result.createObjectStore('outbox',{keyPath:'clientRef'});r.onsuccess=()=>{const db=r.result,t=db.transaction('outbox','readwrite');t.objectStore('outbox').put({clientRef:'legacy-synthetic',data:'opaque'});t.oncomplete=()=>{db.close();resolve()}};r.onerror=()=>reject(r.error)});await bind();});
 assert.equal(await page.evaluate(async()=> (await store('outbox','readonly',s=>s.getAll(),'prima-duty-device')).length),1);pass('legacy unbound records preserved, never migrated or flushed');
 console.log(`RESULT ${count} browser regression checks passed`);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
