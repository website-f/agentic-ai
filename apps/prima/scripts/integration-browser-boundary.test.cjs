'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {localOnly}=require('./browser-local-only.cjs');
test('synthetic browser boundary permits loopback HTTP only',async()=>{
 let handler;await localOnly({route:async(pattern,h)=>{assert.equal(pattern,'**/*');handler=h;}});
 for(const [url,expected] of [['http://127.0.0.1:5180/', 'continue'],['http://localhost:1234/','continue'],['http://[::1]:1234/','continue'],['https://graph.microsoft.com/','abort'],['https://127.0.0.1.example.com/','abort'],['file:///etc/passwd','abort'],['ftp://localhost/foo','abort']]){
  let outcome;await handler({request:()=>({url:()=>url}),continue:()=>{outcome='continue'},abort:()=>{outcome='abort'}});assert.equal(outcome,expected,url);
 }
});
test('integration launcher refuses missing synthetic authorization before launch',()=>{
 const env={...process.env};delete env.CI_SYNTHETIC_BROWSER;delete env.PLAYWRIGHT_MODULE;
 const r=spawnSync(process.execPath,[require.resolve('./run-integration-browser.cjs'),'finance'],{env,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Synthetic browser opt-in/);
});
test('integration launcher refuses unrecognized journey before launch',()=>{
 const r=spawnSync(process.execPath,[require.resolve('./run-integration-browser.cjs'),'unrecognized'],{env:{...process.env,CI_SYNTHETIC_BROWSER:'true',PLAYWRIGHT_MODULE:'/tmp/nonexistent-test-tool/index.mjs'},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Unknown browser journey/);
});
