import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { azureOpenAiEndpoint, endpointShapeValid } from '../infra/arisha-readiness.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const diagnostic=join(root,'infra/arisha-readiness.mjs');
const project=(env)=>{
 const out=spawnSync(process.execPath,[diagnostic],{input:JSON.stringify({properties:{template:{containers:[{env}]}}}),encoding:'utf8',timeout:2000});
 assert.equal(out.status,0,out.stderr);return JSON.parse(out.stdout);
};
test('readiness explicitly reports absent extraction controls without claiming enabled',()=>{
 const result=project([]);
 assert.equal(result.configuration.length,9);
 for(const name of ['ARISHA_IT_EXTRACTION_ENABLED','ARISHA_IT_EXTRACTION_SOURCE_TYPES','ARISHA_IT_EXTRACTION_DATA_CLASSES']) {
  assert.deepEqual(result.configuration.find(x=>x.name===name),{name,configured:false,enabled:null});
 }
 assert.deepEqual(result.warnings,[]);
});
test('readiness emits presence, safe booleans and mismatch warning but no secret or source values',()=>{
 const result=project([
  {name:'ARISHA_ENABLED',value:'false'},
  {name:'ARISHA_IT_EXTRACTION_ENABLED',value:'true'},
  {name:'ARISHA_IT_EXTRACTION_SOURCE_TYPES',value:'PRIVATE_SOURCE_SENTINEL'},
  {name:'ARISHA_IT_EXTRACTION_DATA_CLASSES',value:'PRIVATE_CLASS_SENTINEL'},
  {name:'AZURE_OPENAI_ENDPOINT',value:'https://PRIVATE_ENDPOINT_SENTINEL'},
  {name:'AZURE_OPENAI_DEPLOYMENT',secretRef:'PRIVATE_SECRET_REFERENCE'},
  {name:'UNRELATED_SECRET',value:'PRIVATE_UNRELATED_SENTINEL'},
 ]);
 assert.equal(result.warnings.length,1);
 assert.ok(result.configuration.find(x=>x.name==='AZURE_OPENAI_DEPLOYMENT').configured);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 assert.deepEqual(project([{name:'ARISHA_ENABLED',value:'true'},{name:'ARISHA_IT_EXTRACTION_ENABLED',value:'true'}]).warnings,[]);
 assert.equal(project([{name:'ARISHA_ENABLED',value:'PRIVATE_INVALID_BOOLEAN'}]).configuration[0].enabled,null);
});
test('actual readiness shell uses projection with only a local Azure CLI stub',()=>{
 const dir=mkdtempSync(join(tmpdir(),'prima-readiness-offline-'));
 try {
  const fixture=join(dir,'fixture.json');
  writeFileSync(fixture,JSON.stringify({properties:{template:{containers:[{env:[{name:'ARISHA_IT_EXTRACTION_DATA_CLASSES',value:'PRIVATE_CLASS'}]}]}}}));
  writeFileSync(join(dir,'az'),'#!/bin/bash\nprintf "%s\\n" "$*" >> "$STUB_AZ_LOG"\nif [[ "$*" == "containerapp show -g rg-prima-staging-sea -n ca-prima-api-staging -o json" ]]; then cat "$STUB_FIXTURE"; else echo "{}"; fi\n',{mode:0o700});
  const log=join(dir,'az.log');
  const out=spawnSync('/bin/bash',[join(root,'infra/check-arisha-readiness.sh')],{env:{PATH:`${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,STUB_FIXTURE:fixture,STUB_AZ_LOG:log},encoding:'utf8',timeout:3000});
  assert.equal(out.status,0,out.stderr);
  assert.match(out.stdout,/ARISHA_IT_EXTRACTION_DATA_CLASSES/);
  assert.doesNotMatch(out.stdout,/PRIVATE_CLASS/);
  assert.match(out.stdout,/"endpointShapeValid": null/);
  assert.match(readFileSync(log,'utf8'),/containerapp show/);
  const syntax=spawnSync('/bin/bash',['-n',join(root,'infra/check-arisha-readiness.sh')],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('diagnostic Azure parser exactly matches application parser without evaluating application source',()=>{
 const app=readFileSync(join(root,'apps/api/src/arisha-transport.ts'),'utf8');
 const diagnosticSource=readFileSync(diagnostic,'utf8');
 const body=(source,signature)=>{
  const start=source.indexOf(signature);assert.ok(start>=0);
  const begin=source.indexOf('{',start);const end=source.indexOf('\n}',begin);assert.ok(end>=0);
  return source.slice(begin,end+2);
 };
 assert.equal(body(diagnosticSource,'export function azureOpenAiEndpoint(value)'),body(app,'export function azureOpenAiEndpoint(value: string): string | null'));
});
test('endpoint shape follows WHATWG normalization and strict application Azure policy',()=>{
 for(const value of ['https://synthetic.openai.azure.com',' HTTPS://SYNTHETIC.OPENAI.AZURE.COM:443/ ','https://a.b.openai.azure.com','https://synthetic.openai.azure.com/.']) {
  assert.ok(azureOpenAiEndpoint(value));assert.equal(project([{name:'AZURE_OPENAI_ENDPOINT',value}]).endpointShapeValid,true);
 }
 for(const value of ['https://nonazure.invalid','https://openai.azure.com','https://synthetic.openai.azure.com.evil.invalid','http://synthetic.openai.azure.com','https://u:p@synthetic.openai.azure.com','https://synthetic.openai.azure.com:444','https://synthetic.openai.azure.com/path','https://synthetic.openai.azure.com/?x=PRIVATE','https://synthetic.openai.azure.com/#PRIVATE','malformed PRIVATE']) {
  assert.equal(azureOpenAiEndpoint(value),null);const result=project([{name:'AZURE_OPENAI_ENDPOINT',value}]);assert.equal(result.endpointShapeValid,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|nonazure|synthetic/);
 }
});
test('unset, blank and unresolved secret-reference endpoints remain unknown',()=>{
 for(const env of [[],[{name:'AZURE_OPENAI_ENDPOINT',value:''}],[{name:'AZURE_OPENAI_ENDPOINT',value:'  '}],[{name:'AZURE_OPENAI_ENDPOINT',secretRef:'PRIVATE_REFERENCE'}],[{name:'AZURE_OPENAI_ENDPOINT',value:'https://synthetic.openai.azure.com',secretRef:'PRIVATE_REFERENCE'}]]) {
  const result=project(env);assert.equal(result.endpointShapeValid,null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REFERENCE|synthetic/);
 }
 assert.equal(endpointShapeValid(null),null);
});
test('malformed diagnostic input fails with static output only',()=>{
 const out=spawnSync(process.execPath,[diagnostic],{input:'PRIVATE_MALFORMED_JSON',encoding:'utf8',timeout:2000});
 assert.equal(out.status,1);assert.equal(out.stdout,'');assert.doesNotMatch(out.stderr,/PRIVATE/);
});
test('oversized input and jq failures cannot disclose input or child stderr',()=>{
 const tooLarge=spawnSync(process.execPath,[diagnostic],{input:'PRIVATE'+'x'.repeat(4*1024*1024),encoding:'utf8',timeout:2000});
 assert.equal(tooLarge.status,1);assert.equal(tooLarge.stdout,'');assert.doesNotMatch(tooLarge.stderr,/PRIVATE/);
 const dir=mkdtempSync(join(tmpdir(),'prima-readiness-jq-fail-'));
 try {
  writeFileSync(join(dir,'jq'),'#!/bin/sh\necho PRIVATE_JQ_ERROR >&2\nexit 1\n',{mode:0o700});
  const failed=spawnSync(process.execPath,[diagnostic],{input:JSON.stringify({properties:{template:{containers:[{env:[{name:'AZURE_OPENAI_ENDPOINT',value:'PRIVATE_ENDPOINT'}]}]}}}),env:{PATH:dir},encoding:'utf8',timeout:2000});
  assert.equal(failed.status,1);assert.equal(failed.stdout,'');assert.doesNotMatch(failed.stderr,/PRIVATE/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
