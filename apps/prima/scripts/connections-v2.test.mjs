// Offline tests of real Connections V2 modules; no browser sockets/provider requests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const read = path => readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
async function load(path) {
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { ConnectionCardSession } = await load('connections/session.ts');
const { createRegistry, serviceIds } = await load('connections/registry.ts');
const time = '2026-10-31T00:00:00.000Z';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; };
const config = () => ({serviceId:'sharepoint',userId:'user-a',configuration:'ConfiguredNotVerified',resources:[{resourceKey:'site-a',label:'Synthetic A'},{resourceKey:'site-b',label:'Synthetic B'}],capabilities:['checkAccess','readMetadata']});
const evidence = selection => ({serviceId:'sharepoint',userId:'user-a',selection,checkedAt:time,kind:'AccessVerified'});
function fixture(overrides={}) {
  const calls=[];
  const adapter={serviceId:'sharepoint',...Object.fromEntries(Object.entries({getConfiguration:async()=>config(),checkAccess:async selection=>evidence(selection),...overrides}).map(([name,fn])=>[name,(...args)=>{calls.push({name,args});return fn(...args);}]))};
  return {adapter,calls,session:new ConnectionCardSession('sharepoint','user-a',adapter)};
}
async function selected(f){await f.session.start();f.session.select('site-a');}

test('absent provider modules are honestly NotConfigured without a provider call',async()=>{
  for(const id of ['mail','powerbi']){const s=new ConnectionCardSession(id,'user-a');await s.start();s.select('invented');await s.checkAccess();assert.equal(s.getSnapshot().configuration.reason,'ModuleAbsent');assert.equal(s.getSnapshot().configuration.configuration,'NotConfigured');assert.equal(s.getSnapshot().evidence,null);}
});
test('registry is explicit and rejects duplicates, unknown providers and adapter mismatch',()=>{
  const f=fixture();assert.deepEqual(serviceIds,['mail','sharepoint','powerbi']);assert.equal(createRegistry([f.adapter]).get('mail'),undefined);
  assert.throws(()=>createRegistry([f.adapter,f.adapter]));assert.throws(()=>createRegistry([{...f.adapter,serviceId:'arbitrary'}]));assert.throws(()=>new ConnectionCardSession('mail','user-a',f.adapter));
});
test('mount/configuration and selecting a resource never check provider access or metadata',async()=>{
  const f=fixture();await selected(f);assert.deepEqual(f.calls.map(c=>c.name),['getConfiguration']);assert.equal(f.session.getSnapshot().evidence,null);
  await f.session.checkAccess();assert.deepEqual(f.calls.map(c=>c.name),['getConfiguration','checkAccess']);assert.equal(f.session.getSnapshot().evidence.selection.resourceKey,'site-a');
});
test('configuration failure remains unavailable, never falsely NotConfigured',async()=>{
  const f=fixture({getConfiguration:async()=>{throw Error('secret-token/private-url');}});await f.session.start();const s=f.session.getSnapshot();assert.equal(s.configuration,null);assert.equal(s.failure,'Unavailable');assert.equal(s.evidence,null);assert.doesNotMatch(JSON.stringify(s),/secret-token|private-url/);
});
test('configuration rejects user/provider mismatches, fake module absence, duplicate resources and invalid capabilities',async()=>{
  for(const patch of [{userId:'user-b'},{serviceId:'mail'},{reason:'ModuleAbsent'},{resources:[{resourceKey:'a',label:'A'},{resourceKey:'a',label:'B'}]},{capabilities:['write']},{configuration:'NotConfigured',resources:[],capabilities:['checkAccess']}]){
    const f=fixture({getConfiguration:async()=>({...config(),...patch})});await f.session.start();assert.equal(f.session.getSnapshot().failure,'InvalidResponse');assert.equal(f.session.getSnapshot().configuration,null);
  }
});
test('access evidence is bound to user, service, resource, child, timestamp and verification kind',async()=>{
  for(const patch of [{userId:'user-b'},{serviceId:'mail'},{selection:{resourceKey:'site-b'}},{selection:{resourceKey:'site-a',childKey:'foreign'}},{checkedAt:'not-a-date'},{kind:'Connected'}]){
    const f=fixture({checkAccess:async selection=>({...evidence(selection),...patch})});await selected(f);await f.session.checkAccess();assert.equal(f.session.getSnapshot().failure,'InvalidResponse');assert.equal(f.session.getSnapshot().evidence,null);
  }
});
test('unknown resource or missing check capability cannot trigger access calls',async()=>{
  const f=fixture();await f.session.start();f.session.select('foreign');await f.session.checkAccess();assert.equal(f.calls.length,1);
  const g=fixture({getConfiguration:async()=>({...config(),capabilities:['readMetadata']})});await selected(g);await g.session.checkAccess();assert.equal(g.calls.length,1);
});
test('repeat clicks deduplicate; cancel aborts and discards late verification',async()=>{
  const d=deferred(),f=fixture({checkAccess:()=>d.promise});await selected(f);const p=f.session.checkAccess();await f.session.checkAccess();assert.equal(f.calls.length,2);
  const signal=f.calls[1].args[1];f.session.invalidate();assert.equal(signal.aborted,true);d.resolve(evidence({resourceKey:'site-a'}));await p;assert.equal(f.session.getSnapshot().evidence,null);assert.equal(f.session.getSnapshot().phase,'idle');
});
test('site switch ignores old success and old failure cannot erase a newer successful check',async()=>{
  for(const reject of [false,true]){const d=deferred(),f=fixture({checkAccess:async s=>s.resourceKey==='site-a'?d.promise:evidence(s)});await selected(f);const p=f.session.checkAccess();f.session.select('site-b');await f.session.checkAccess();if(reject)d.reject(Error('old'));else d.resolve(evidence({resourceKey:'site-a'}));await p;assert.equal(f.session.getSnapshot().evidence.selection.resourceKey,'site-b');assert.equal(f.session.getSnapshot().failure,null);}
});
test('refresh clears previous access and rejects an earlier configuration response',async()=>{
  const d=deferred();let n=0;const f=fixture({getConfiguration:()=>++n===1?d.promise:Promise.resolve(config())});const first=f.session.start();await f.session.loadConfiguration();f.session.select('site-b');await f.session.checkAccess();d.resolve({...config(),userId:'other'});await first;assert.equal(f.session.getSnapshot().evidence.selection.resourceKey,'site-b');await f.session.loadConfiguration();assert.equal(f.session.getSnapshot().selection,null);assert.equal(f.session.getSnapshot().evidence,null);
});
test('StrictMode setup/dispose/setup restarts cleanly and rejects first generation',async()=>{
  const d=deferred();let n=0;const f=fixture({getConfiguration:()=>++n===1?d.promise:Promise.resolve(config())});const first=f.session.start();f.session.dispose();await f.session.start();d.resolve({...config(),userId:'old'});await first;assert.equal(f.session.getSnapshot().configuration.userId,'user-a');assert.equal(f.session.getSnapshot().failure,null);f.session.select('site-a');await f.session.checkAccess();assert.ok(f.session.getSnapshot().evidence);
});
test('disposed sessions erase data, reject late results and cannot act for the next user',async()=>{
  const d=deferred(),f=fixture({checkAccess:()=>d.promise});await selected(f);const old=f.session.checkAccess();f.session.dispose();f.session.select('site-b');await f.session.checkAccess();await f.session.loadConfiguration();assert.equal(f.calls.length,2);d.resolve(evidence({resourceKey:'site-a'}));await old;
  assert.equal(f.session.getSnapshot().configuration,null);assert.equal(f.session.getSnapshot().selection,null);assert.equal(f.session.getSnapshot().evidence,null);
  const next=new ConnectionCardSession('sharepoint','user-b',f.adapter);await next.start();assert.equal(next.getSnapshot().failure,'InvalidResponse');assert.equal(next.getSnapshot().evidence,null);
});
test('metadata failure invalidates access and aborts provider-panel generation',async()=>{
  const f=fixture();await selected(f);await f.session.checkAccess();const s=f.session.getSnapshot();f.session.fail();assert.equal(s.signal.aborted,true);assert.equal(f.session.getSnapshot().evidence,null);assert.equal(f.session.getSnapshot().failure,'Unavailable');assert.ok(f.session.getSnapshot().epoch>s.epoch);
});

function components(snapshot,boundSession){
  const module={exports:{}};const code=ts.transpileModule(read('views/Connections.tsx'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const require=name=>{
    if(name==='../connections/mail/connection-card')return {MailConnectionCard:()=>React.createElement('section',{'aria-label':'Outlook selected-email connection'},React.createElement('h2',null,'Outlook — selected email on an IT job'))};if(name==='../connections/mail/job-emails-client')return {jobEmailClient:()=>({})};
    if(name==='react')return React;if(name==='../api')return {api:{}};if(name==='../ui')return {Chip:({children})=>React.createElement('span',null,children)};
    if(name==='../connections/sharepoint/request')return {SharePointRequest:()=>React.createElement('section',null,'Setup request')};
    if(name==='../connections/registry')return {createRegistry,serviceIds};
    if(name==='../connections/session')return {ConnectionCardSession:boundSession?class{constructor(){return boundSession;}}:snapshot?class{getSnapshot=()=>snapshot;subscribe=()=>()=>{};}:ConnectionCardSession};
    if(name==='../connections/sharepoint/adapter')return {sharePointAdapter:()=>fixture().adapter};throw Error(`Unexpected import ${name}`);
  };new Function('require','module','exports','React',code)(require,module,module.exports,React);return module.exports;
}
test('actual page separates selected Outlook, SharePoint, deferred Power BI and unverified Teams',()=>{
  const {ConnectionsView}=components();const html=renderToStaticMarkup(React.createElement(ConnectionsView,{userId:'user-a'}));
  for(const label of ['Outlook — selected email on an IT job','SharePoint','Power BI'])assert.ok(html.includes(`>${label}</h2>`));
  assert.match(html,/repeat\(auto-fit, minmax\(min\(100%, 320px\), 1fr\)\)/);assert.equal((html.match(/aria-labelledby="connection-/g)||[]).length,2);
  assert.equal((html.match(/This provider module has not been installed/g)||[]).length,1);
  assert.match(html,/Outlook selected-email connection/);assert.match(html,/Required for the pilot — connection not verified/);assert.match(html,/Deferred to the last phase/);assert.match(html,/Never paste passwords/);assert.doesNotMatch(html,/<input|type="password"|>Connect<|Verified for you/);
});
test('actual card reports unavailable rather than NotConfigured after a failed setup request',async()=>{
  const f=fixture({getConfiguration:async()=>{throw Error('raw-secret');}});await f.session.start();const {ConnectionCard}=components(f.session.getSnapshot());const html=renderToStaticMarkup(React.createElement(ConnectionCard,{serviceId:'sharepoint',userId:'user-a',adapter:f.adapter}));assert.match(html,/Status unavailable/);assert.doesNotMatch(html,/Not configured|raw-secret|Verified for you/);
});
test('actual card exposes scoped timestamp only after verification and escapes resource labels',async()=>{
  const f=fixture({getConfiguration:async()=>({...config(),resources:[{resourceKey:'site-a',label:'<script>secret()</script>'}]})});await selected(f);
  let {ConnectionCard}=components(f.session.getSnapshot());let html=renderToStaticMarkup(React.createElement(ConnectionCard,{serviceId:'sharepoint',userId:'user-a',adapter:f.adapter}));assert.match(html,/Configured — check required/);assert.doesNotMatch(html,/Verified for you/);assert.match(html,/&lt;script&gt;secret\(\)&lt;\/script&gt;/);
  await f.session.checkAccess();({ConnectionCard}=components(f.session.getSnapshot()));html=renderToStaticMarkup(React.createElement(ConnectionCard,{serviceId:'sharepoint',userId:'user-a',adapter:f.adapter}));assert.match(html,/Verified for you at the time shown/);assert.ok(html.includes(time));assert.match(html,/not continuous monitoring or organization-wide connection/);
});

const { ConnectionsSession, sharePointBrowserUrl } = await load('views/connections-state.ts');
function panelAdapter(client, session) {
  const module={exports:{}};
  const code=ts.transpileModule(read('connections/sharepoint/adapter.tsx'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const require=name=>{if(name==='react')return React;if(name==='../../views/connections-state')return {sharePointBrowserUrl,ConnectionsSession:session?class{constructor(){return session;}}:ConnectionsSession};throw Error(`Unexpected panel dependency ${name}`);};
  new Function('require','module','exports','React',code)(require,module,module.exports,React);
  return module.exports.sharePointAdapter(client);
}
function spFixture(approved=true){
  const calls=[];
  const configuration={serviceId:'sharepoint',userId:'user-a',status:'ConfiguredNotVerified',sites:[{key:'site-a',name:'Synthetic site',hasApprovedLibraries:approved}]};
  const verified={serviceId:'sharepoint',userId:'user-a',status:'VerifiedForCurrentUser',siteKey:'site-a',checkedAt:time};
  const client={
    sharePointStatus:async()=>{calls.push('configuration');return structuredClone(configuration);},
    sharePointCheck:async()=>{calls.push('check');return structuredClone(verified);},
    sharePointLibraries:async()=>{calls.push('libraries');return {serviceId:'sharepoint',userId:'user-a',siteKey:'site-a',checkedAt:time,libraries:[{id:'lib-a',name:'<script>library()</script>'}],hasMore:false};},
    sharePointItems:async()=>{calls.push('items');return {serviceId:'sharepoint',userId:'user-a',siteKey:'site-a',driveId:'lib-a',checkedAt:time,items:[{id:'file-a',name:'<img src=x onerror=alert(1)>',kind:'file',size:12,lastModifiedAt:time},{id:'folder-a',name:'Synthetic folder',kind:'folder',size:null,lastModifiedAt:null}],hasMore:true};},
  };
  return {client,calls,configuration,verified};
}
const panelProps=()=>({userId:'user-a',selection:{resourceKey:'site-a'},evidence:evidence({resourceKey:'site-a'}),epoch:1,signal:new AbortController().signal,cancel:()=>{throw Error('Unexpected cancellation during SSR');},fail:()=>{throw Error('Unexpected failure during SSR');}});
test('actual SharePoint panel with no approved libraries renders explanation, no controls or metadata calls',async()=>{
  const f=spFixture(false),adapter=panelAdapter(f.client);await adapter.getConfiguration(new AbortController().signal);
  const html=renderToStaticMarkup(React.createElement(adapter.ProviderPanel,panelProps()));
  assert.match(html,/No approved libraries are configured/);assert.match(html,/site access check does not approve libraries/);
  assert.doesNotMatch(html,/<button|<select|SharePoint root metadata/);assert.deepEqual(f.calls,['configuration']);
});
test('actual SharePoint panel escapes file/library names and preserves metadata-only limitations',async()=>{
  const f=spFixture(),session=new ConnectionsSession(f.client,'user-a');session.initializeScope(f.configuration,f.verified);
  await session.listLibraries();session.selectLibrary('lib-a');await session.listMetadata();
  assert.equal(session.getSnapshot().items.length,2,'Fixture must run through real scoped controller');
  const adapter=panelAdapter(f.client,session);await adapter.getConfiguration(new AbortController().signal);
  const before=[...f.calls],html=renderToStaticMarkup(React.createElement(adapter.ProviderPanel,panelProps()));
  assert.deepEqual(f.calls,before,'Rendering must not fetch provider metadata');
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/&lt;script&gt;library\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<img|<script|<iframe|href=/);
  assert.match(html,/File \(contents not read\)/);assert.match(html,/Folder \(not opened\)/);assert.match(html,/Prima does not read document bodies or transfer them to AI/);
  assert.match(html,/first 25 root entries/);assert.match(html,/Not continuous monitoring/);assert.ok(html.includes(time));
});
test('actual SharePoint panel hides all metadata without current access evidence',async()=>{
  const f=spFixture(),adapter=panelAdapter(f.client);await adapter.getConfiguration(new AbortController().signal);
  const html=renderToStaticMarkup(React.createElement(adapter.ProviderPanel,{...panelProps(),evidence:null}));assert.equal(html,'');assert.deepEqual(f.calls,['configuration']);
});

function capabilityFixture(serviceId,capabilities,panelCapability,ProviderPanel=()=>React.createElement('button',null,'Synthetic action')) {
  const calls=[];const adapter={serviceId,panelCapability,ProviderPanel,getConfiguration:async()=>({serviceId,userId:'user-a',configuration:'ConfiguredNotVerified',resources:[{resourceKey:'site-a',label:'Synthetic'}],capabilities}),checkAccess:async selection=>{calls.push('check');return {...evidence(selection),serviceId};}};
  return {adapter,calls,session:new ConnectionCardSession(serviceId,'user-a',adapter)};
}
async function capable(f){await f.session.start();f.session.select('site-a');await f.session.checkAccess();}
function renderCard(f,serviceId='mail') {const {ConnectionCard}=components(null,f.session);return renderToStaticMarkup(React.createElement(ConnectionCard,{serviceId,userId:'user-a',adapter:f.adapter}));}
test('explicit compose and report capabilities are accepted only for their own providers',async()=>{
  for(const [serviceId,capability] of [['mail','composeSend'],['powerbi','viewReport'],['powerbi','embedReport'],['sharepoint','readMetadata']]) {
    const f=capabilityFixture(serviceId,['checkAccess',capability],capability);await capable(f);assert.equal(f.session.getSnapshot().failure,null);assert.ok(f.session.getSnapshot().evidence);
    const html=renderCard(f,serviceId);assert.match(html,/Synthetic action/);assert.deepEqual(f.calls,['check'],'Rendering never performs the action');
    if(capability==='composeSend'){assert.match(html,/Cancellation cannot recall a submitted message/);assert.doesNotMatch(html,/not available in this build/);}
    if(capability==='viewReport'||capability==='embedReport')assert.match(html,/No automatic opening or AI transfer/);
    if(serviceId==='sharepoint')assert.doesNotMatch(html,/Manual email action|Report access:/);
  }
});
test('unknown, duplicate and wrong-provider action capabilities fail closed',async()=>{
  for(const [serviceId,caps,panel] of [['mail',['checkAccess','sendAnything'],'composeSend'],['sharepoint',['checkAccess','composeSend'],'composeSend'],['mail',['checkAccess','embedReport'],'embedReport'],['powerbi',['checkAccess','composeSend'],'composeSend'],['mail',['checkAccess','checkAccess'],'composeSend'],['mail',['checkAccess','composeSend'],'arbitrary'],['mail',['checkAccess'],'checkAccess']]) {
    const f=capabilityFixture(serviceId,caps,panel);await f.session.start();assert.equal(f.session.getSnapshot().failure,'InvalidResponse');assert.equal(f.session.getSnapshot().configuration,null);assert.equal(f.calls.length,0);
  }
});
test('compose panel cannot mount on readMetadata or checkAccess alone; undeclared panels fail closed',async()=>{
  for(const caps of [['checkAccess'],['checkAccess','readMetadata']]) {const f=capabilityFixture('mail',caps,'composeSend');await capable(f);assert.doesNotMatch(renderCard(f),/Synthetic action|Manual email action/);}
  const undeclared=capabilityFixture('mail',['checkAccess','composeSend'],undefined);await undeclared.session.start();assert.equal(undeclared.session.getSnapshot().failure,'InvalidResponse');
});
test('panel cancellation is neutral, clears access and aborts generation; failures remain errors',async()=>{
  let props;const f=capabilityFixture('mail',['checkAccess','composeSend'],'composeSend',p=>{props=p;return React.createElement('span',null,'Synthetic panel');});await capable(f);renderCard(f);
  const signal=props.signal;props.cancel();assert.equal(signal.aborted,true);assert.equal(f.session.getSnapshot().failure,null);assert.equal(f.session.getSnapshot().evidence,null);assert.match(f.session.getSnapshot().note,/Cancelled locally/);
  assert.match(renderCard(f),/Cancelled locally/);assert.doesNotMatch(renderCard(f),/role="alert"/);
  await f.session.checkAccess();renderCard(f);props.fail();assert.equal(f.session.getSnapshot().failure,'Unavailable');assert.equal(f.session.getSnapshot().note,null);assert.match(renderCard(f),/role="alert"/);
});
test('neutral cancel discards ignored-abort late evidence and never triggers provider action',async()=>{
  const d=deferred();const f=fixture({checkAccess:()=>d.promise});await selected(f);const pending=f.session.checkAccess();f.session.cancel();d.resolve(evidence({resourceKey:'site-a'}));await pending;
  assert.equal(f.session.getSnapshot().failure,null);assert.equal(f.session.getSnapshot().evidence,null);assert.deepEqual(f.calls.map(c=>c.name),['getConfiguration','checkAccess']);
});

test('safe file links render as explicit new-tab actions without automatic requests',async()=>{
 const f=spFixture();f.client.sharePointItems=async()=>({serviceId:'sharepoint',userId:'user-a',siteKey:'site-a',driveId:'lib-a',checkedAt:time,hasMore:false,items:[{id:'file-a',name:'Policy',kind:'file',size:1,lastModifiedAt:null,webUrl:'https://example.sharepoint.com/sites/IT/p.pdf'}]});
 const session=new ConnectionsSession(f.client,'user-a');session.initializeScope(f.configuration,f.verified);await session.listLibraries();session.selectLibrary('lib-a');await session.listMetadata();const adapter=panelAdapter(f.client,session);await adapter.getConfiguration(new AbortController().signal);const before=[...f.calls];const html=renderToStaticMarkup(React.createElement(adapter.ProviderPanel,panelProps()));assert.deepEqual(f.calls,before);assert.match(html,/href="https:\/\/example.sharepoint.com\/sites\/IT\/p.pdf"/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/Open in SharePoint \(new tab\)/);assert.doesNotMatch(html,/<iframe|download=/);
});
