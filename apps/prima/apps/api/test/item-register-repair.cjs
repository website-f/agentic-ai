// Catalogue/Store wiring unit test, not a real PostgreSQL security or concurrency test.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript'), path = require('node:path');
const base = path.join(__dirname, '../src');
function load(name, deps={}) {
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(base,name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,require:id=>deps[id]??(id==='node:crypto'?require(id):{}),process});return exports;
}
const readiness=load('item-register-readiness');
const {PgStore}=load('pg-store',{'./item-register-readiness':readiness});
function client(bad,installed=true){let reads=0;return {get reads(){return reads},async query(sql,args){
  if(sql.includes('bool_and')) return {rows:[{ok:installed}]};
  if(sql.includes(' AS has,')) return {rows:[{has:true,rls:bad!=='rls',wall:bad!=='wall',rights:bad!=='rights',can_update:!['item_events','item_requests','item_docs','item_uniform_records'].some(x=>args[0]==='prima.'+x)||bad==='append',too_much:bad==='delete'}]};
  if(sql.includes('pg_index')) return {rows:[{ok:bad!=='index'}]};
  reads++; return {rows:[]};
}}}
(async()=>{
 for(const bad of ['rls','wall','rights','append','delete','index']){
  const c=client(bad);await assert.rejects(()=>new PgStore(c).list('itemLots'),/protections need setup/);assert.equal(c.reads,0);
 }
 const absent=client(null,false);assert.equal((await new PgStore(absent).list('itemLots')).length,0);assert.equal(absent.reads,0);
 const good=client(null);await new PgStore(good).list('itemLots');assert.equal(good.reads,1);
 console.log('PASS: six broken catalogue states block item reads; absent module stays off; valid mock catalogue permits read. PostgreSQL not run.');
})().catch(e=>{console.error(e);process.exitCode=1});
