const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {generateDataset,MemoryStore,PrimaService,demoPin,myt,AccessDenied}=require(process.env.CORE_DIST || path.resolve(__dirname,'../packages/core/dist'));
(async()=>{
 const today='2026-10-26',now=myt(today,'10:30'),ds=generateDataset({today,now});
 const svc=new PrimaService(new MemoryStore(ds),()=>now),dev=await svc.user('u-dev-sasa-001');
 assert.equal((await svc.dutyDevice(dev)).offlineContext,null);
 dev.dutyEnrollment={deviceId:'synthetic-device',enrollmentId:'synthetic-enrollment'};
 const origin=(await svc.dutyDevice(dev)).offlineContext;assert.equal(origin.accountId,dev.id);
 const person=ds.people.find(p=>p.companyId===origin.companyId&&p.status==='active'&&p.staffNo&&p.pinHash);
 const sign={staffNo:person.staffNo,pin:demoPin(person.staffNo)};
 const post={...sign,kind:'routine',text:'Synthetic offline binding test',clientRef:'synthetic-context-post',recordedAt:now,offlineContext:origin};
 const saved=await svc.addPostLog(dev,post);assert.equal(saved.siteId,origin.siteId);
 let checks=2;
 for(const field of Object.keys(origin)){
  const wrong={...origin,[field]:'synthetic-wrong'};
  for(const run of [()=>svc.addPostLog(dev,{...post,offlineContext:wrong}),()=>svc.gateIn(dev,{...sign,kind:'vehicle',offlineContext:wrong}),()=>svc.gateOut(dev,'synthetic-gate',{...sign,offlineContext:wrong}),()=>svc.doSiteTask(dev,'synthetic-task',{...sign,result:'done',offlineContext:wrong})]){
   await assert.rejects(run(),AccessDenied);checks++;
  }
 }
 // Checks precede idempotent response: a prior matching clientRef must not bypass re-enrollment.
 dev.dutyEnrollment.enrollmentId='synthetic-reenrollment';await assert.rejects(svc.addPostLog(dev,post),AccessDenied);checks++;
 dev.dutyEnrollment=null;await assert.rejects(svc.addPostLog(dev,post),AccessDenied);checks++;
 assert.equal(ds.postLogs.filter(p=>p.id===saved.id).length,1);
 const ts=require(process.env.TYPESCRIPT_PATH||'typescript');const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../apps/api/src/duty-offline-context.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({BadRequestException:Error})});
 const parse=exports.dutyOfflineContext;assert.equal(JSON.stringify(parse(origin)),JSON.stringify(origin));assert.equal(parse(undefined),undefined);checks+=2;
 for(const value of [null,[],{},'bad',{...origin,siteId:''},{...origin,enrollmentId:null},{...origin,accountId:'x'.repeat(201)}]){assert.throws(()=>parse(value));checks++;}
 // Execute the actual controller methods against a mocked Db port: catches DTO fields dropped before the service.
 const controllerExports={};
 const decorator=()=>()=>{};
 const nest=new Proxy({}, {get:(_,key)=>key.endsWith('Exception')?Error:decorator});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../apps/api/src/controllers.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports:controllerExports,require:id=>{
  if(id==='@nestjs/common')return nest;
  if(id==='@prima/core')return require(process.env.CORE_DIST || path.resolve(__dirname,'../packages/core/dist'));
  if(id==='./duty-offline-context')return {dutyOfflineContext:parse};
  if(id==='./web-connectors')return {WebConnectors:class{}};
  if(id==='./arisha')return {IdentityToken:class{}};
  if(id==='./auth')return {UserId:decorator};
  return {};
 }});
 const forwarded=[];const port=new Proxy({}, {get:(_,method)=>(...args)=>{forwarded.push({method,body:args.at(-1)});return Promise.resolve()}});
 const controller=new controllerExports.AppController({asUser:(_uid,fn)=>fn(port,dev)});
 const base={...sign,offlineContext:origin};
 const routes=[b=>controller.addPostLog(dev.id,{...b,kind:'routine',text:'Synthetic'}),b=>controller.gateIn(dev.id,{...b,kind:'paper_log',paper:{coversDate:today,lines:1}}),b=>controller.gateOut(dev.id,'synthetic',b),b=>controller.doSiteTask(dev.id,'synthetic',{...b,result:'done'})];
 for(const route of routes){await route(base);assert.equal(JSON.stringify(forwarded.at(-1).body.offlineContext),JSON.stringify(origin));assert.throws(()=>route({...base,offlineContext:null}));checks+=2;}
 console.log(`PASS ${checks} compiled-core replay authorization, request parser and mocked controller checks; no DB/network calls`);
})().catch(e=>{console.error(e);process.exitCode=1});
