import 'reflect-metadata';
import test from 'node:test';import assert from 'node:assert/strict';
import { createSign,generateKeyPairSync } from 'node:crypto';
import { Module } from '@nestjs/common';import { NestFactory } from '@nestjs/core';
import { AuthGuard,entraSetup,resetEntraSetup,issueToken } from '../src/auth';
import { Db } from '../src/db';import { ItExtractionController } from '../src/arisha-it-extraction.controller';
import { ItExtractionPreviewService } from '../src/arisha-it-extraction';
import { extractionAudit } from '../src/arisha-it-extraction-audit';
import { AppModule } from '../src/app.module';import { MODULE_METADATA } from '@nestjs/common/constants';
test('registered HTTP preview: verified Entra/current CEO, consent, no writes/no-store',async()=>{
 const tenant='11111111-2222-3333-4444-555555555555',api='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',spa='cccccccc-1111-2222-3333-444444444444',oid='99999999-8888-7777-6666-555555555555';
 const keys=['ENTRA_TENANT_ID','ENTRA_API_CLIENT_ID','ENTRA_SPA_CLIENT_ID','ENTRA_API_APP_ID_URI','ENTRA_SCOPE','ALLOW_DEV_LOGIN','DEV_TOKEN_SECRET','LEADERSHIP_ONBOARDING_ONLY','ARISHA_ENABLED'];const saved=new Map(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
 Object.assign(process.env,{ENTRA_TENANT_ID:tenant,ENTRA_API_CLIENT_ID:api,ENTRA_SPA_CLIENT_ID:spa,ALLOW_DEV_LOGIN:'true',DEV_TOKEN_SECRET:'synthetic-only'});
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});resetEntraSetup();entraSetup(async()=>pair.publicKey);
 let user={id:'u-fauzan',name:'Synthetic CEO',role:'director',opsTier:'ceo',entraOid:oid,integration:null};let reads=0,models=0;const auditEvents:unknown[]=[];
 const db={pool:{query:async()=>({rowCount:1,rows:[{data:user}]})},asUser:async(_id:string,fn:Function)=>{reads++;return fn({},user,{audit:async(event:unknown)=>{auditEvents.push(event);}});}};
 @Module({controllers:[ItExtractionController],providers:[{provide:Db,useValue:db},AuthGuard]}) class TestModule{}
 const app=await NestFactory.create(TestModule,{logger:false});
 try{
  assert(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS,AppModule).includes(ItExtractionController));
  const controller=app.get(ItExtractionController);
  (controller as unknown as {service:ItExtractionPreviewService}).service=new ItExtractionPreviewService({extract:async()=>{models++;return{rows:[]};}},{enabled:true,arishaEnabled:true,sourceTypes:['paste'],dataClasses:['synthetic']},30000,extractionAudit(db as unknown as Db));
  await app.listen(0,'127.0.0.1');const url=await app.getUrl();
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const sec=Math.floor(Date.now()/1000);
  const head=encode({alg:'RS256',kid:'fixture'}),claims=encode({ver:'2.0',iss:`https://login.microsoftonline.com/${tenant}/v2.0`,aud:`api://${api}`,azp:spa,tid:tenant,oid,scp:'access_as_user',nbf:sec-60,exp:sec+3600});const signed=`${head}.${claims}`;const token=signed+'.'+createSign('RSA-SHA256').update(signed).sign(pair.privateKey).toString('base64url');
  const body={kind:'tickets',source:{type:'paste',label:'Fixture',text:'Synthetic only',dataClass:'synthetic'},acknowledgement:{version:'it-extraction-v1',sendToAzure:true}};
  const send=(bearer:string,data:unknown=body)=>fetch(url+'/api/arisha/it-extraction/preview',{method:'POST',headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify(data)});
  let res=await send(token);assert.equal(res.status,201);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(((await res.json()) as {operationalWrites:number}).operationalWrites,0);assert.equal(models,1);assert.equal(auditEvents.length,2);
  res=await send(token,{...body,acknowledgement:{version:'it-extraction-v1',sendToAzure:false}});assert.equal(res.status,400);assert.equal(models,1);
  res=await send(issueToken('u-fauzan'));assert.equal(res.status,403);assert.equal(models,1);
  user={...user,opsTier:'coo'};res=await send(token);assert.equal(res.status,403);assert.equal(models,1);
  user={...user,opsTier:'ceo',entraOid:'aaaaaaaa-1111-2222-3333-444444444444'};res=await send(token);assert.equal(res.status,403);assert.equal(models,1);assert(reads>=4);assert.equal(auditEvents.length,2);
 }finally{await app.close();for(const k of keys){const v=saved.get(k);if(v===undefined)delete process.env[k];else process.env[k]=v;}resetEntraSetup();}
});
