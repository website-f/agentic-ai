import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arishaConfig, askArisha, IdentityToken, ArishaBusy } from '../src/arisha';
import { azureOpenAiEndpoint, ArishaTimeout, withinArishaBudget } from '../src/arisha-transport';
const cfg = {endpoint:'https://synthetic.openai.azure.com', deployment:'synthetic', apiVersion:'synthetic'};
const input = {history:[], brief:'synthetic', tools:null};
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status});
const answer = () => json({choices:[{message:{role:'assistant',content:'Synthetic answer'}}]});
const never = <T>(): Promise<T> => new Promise(()=>{});
const budgets = {overallMs:100,callMs:10};

describe('Arisha bounded Azure transport, injected mocks only',()=>{
 it('restricts configured and direct-call endpoints before credentials or provider calls',async()=>{
  assert.equal(azureOpenAiEndpoint('https://synthetic.openai.azure.com/'),cfg.endpoint);
  assert.equal(azureOpenAiEndpoint('https://synthetic.openai.azure.com:443/'),cfg.endpoint);
  for(const endpoint of ['https://nonazure.invalid','https://openai.azure.com','https://a.openai.azure.com.evil.invalid','http://a.openai.azure.com','https://u:p@a.openai.azure.com','https://a.openai.azure.com:444','https://a.openai.azure.com/path','https://a.openai.azure.com/?secret=x','https://a.openai.azure.com/#x','not-url']) {
   assert.equal(arishaConfig({ARISHA_ENABLED:'true',AZURE_OPENAI_ENDPOINT:endpoint,AZURE_OPENAI_DEPLOYMENT:'synthetic',AZURE_OPENAI_API_VERSION:'synthetic'}),null);
   let ran=false;
   await assert.rejects(askArisha({...cfg,endpoint},async()=>{ran=true;return 'PRIVATE';},input,async()=>{ran=true;return answer();}),/invalid Azure endpoint/);
   assert.equal(ran,false);
  }
 });
 it('bounds a never-resolving token acquisition without starting fetch',async()=>{
  let called=false;
  await assert.rejects(askArisha(cfg,()=>never<string>(),input,async()=>{called=true;return answer();},budgets),ArishaTimeout);
  assert.equal(called,false);
 });
 it('does not start provider work after a token resolves late following timeout',async()=>{
  let release:((value:string)=>void)|undefined, requests=0;
  const result=askArisha(cfg,()=>new Promise(resolve=>{release=resolve;}),input,async()=>{requests++;return answer();},budgets);
  await assert.rejects(result,ArishaTimeout);release?.('LATE_PRIVATE_TOKEN');
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,0);
 });
 it('bounds fetch that ignores abort and propagates signal and redirect rejection',async()=>{
  let signal:AbortSignal|undefined;
  await assert.rejects(askArisha(cfg,async()=>'SYNTHETIC',input,async(_url,init)=>{
   signal=init!.signal as AbortSignal;assert.equal(init!.redirect,'error');return never<Response>();
  },budgets),error=>error instanceof ArishaTimeout && !String(error).includes('SYNTHETIC'));
  assert.equal(signal?.aborted,true);
 });
 it('bounds stalled response-body reads and cancels the reader',async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({pull(){return never<void>();},cancel(){cancelled=true;}});
  await assert.rejects(askArisha(cfg,async()=>'SYNTHETIC',input,async()=>new Response(body),budgets),ArishaTimeout);
  assert.equal(cancelled,true);
 });
 it('bounds managed identity fetch and body independently and rejects redirects',async()=>{
  const env={IDENTITY_ENDPOINT:'http://synthetic.invalid',IDENTITY_HEADER:'PRIVATE'};
  let signal:AbortSignal|undefined;
  await assert.rejects(new IdentityToken(env,async(_url,init)=>{signal=init!.signal as AbortSignal;assert.equal(init!.redirect,'error');return never<Response>();},Date.now,10).get(),ArishaTimeout);
  assert.equal(signal?.aborted,true);
  await assert.rejects(new IdentityToken(env,async()=>new Response(new ReadableStream({pull(){return never<void>();}})),Date.now,10).get(),ArishaTimeout);
 });
 it('limits response and identity-token bytes without trusting content length',async()=>{
  await assert.rejects(askArisha(cfg,async()=>'SYNTHETIC',input,async()=>json({private:'x'.repeat(256001)})),/invalid response/);
  await assert.rejects(new IdentityToken({IDENTITY_ENDPOINT:'http://synthetic.invalid',IDENTITY_HEADER:'PRIVATE'},async()=>json({access_token:'x'.repeat(64001)})).get(),/invalid response/);
 });
 it('overall budget prevents later rounds after a delayed tool, even if the tool ignores cancellation',async()=>{
  let requests=0, release:((value:unknown)=>void)|undefined;
  const result=askArisha(cfg,async()=>'SYNTHETIC',{...input,tools:()=>new Promise(resolve=>{release=resolve;})},async()=>{
   requests++;return json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'1',type:'function',function:{name:'record_form',arguments:'{}'}}]}}]});
  },{overallMs:15,callMs:100});
  await assert.rejects(result,ArishaTimeout);
  release?.({});await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(requests,1);
 });
 it('overall timer spans multiple otherwise successful provider rounds',async()=>{
  let requests=0;
  await assert.rejects(askArisha(cfg,async()=>'SYNTHETIC',{...input,tools:async()=>({})},async()=>{
   requests++;await new Promise(resolve=>setTimeout(resolve,8));return json({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:String(requests),type:'function',function:{name:'record_form',arguments:'{}'}}]}}]});
  },{overallMs:20,callMs:100}),ArishaTimeout);
  const stopped=requests;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(requests,stopped);assert.ok(requests<6);
 });
 it('retains 429 without retries, successful answers, and does not abort completed work later',async()=>{
  let requests=0;
  await assert.rejects(askArisha(cfg,async()=>'SYNTHETIC',input,async()=>{requests++;return json({},429);}),ArishaBusy);assert.equal(requests,1);
  let signal:AbortSignal|undefined;
  const out=await askArisha(cfg,async()=>'SYNTHETIC',input,async(_url,init)=>{signal=init!.signal as AbortSignal;return answer();},{overallMs:10,callMs:10});
  assert.equal(out.text,'Synthetic answer');await new Promise(resolve=>setTimeout(resolve,15));assert.equal(signal?.aborted,false);
 });
 it('an already cancelled parent invokes no work and removes its listener',async()=>{
  const ctrl=new AbortController();ctrl.abort();let ran=false;
  await assert.rejects(withinArishaBudget(10,async()=>{ran=true;return 1;},ctrl.signal),ArishaTimeout);assert.equal(ran,false);
 });
});
