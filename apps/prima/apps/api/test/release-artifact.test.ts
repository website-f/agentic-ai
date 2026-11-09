import assert from 'node:assert/strict';import {it} from 'node:test';import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,dirname} from 'node:path';
import {releaseArtifact,releaseRoot,MODULE_SPECS,OPTIONAL_MODULE_SPECS,selectedModuleSql,optionalModuleSql,sha256} from '../src/release-artifact';import {readFileSync} from 'node:fs';import {moduleBody} from '../src/module-install';
// Agentic Office: upstream's seven modules first, then the modules the office database already has installed.
it('complete artifact pins base, the seven authorized modules and the office-installed modules, in order',()=>{const a=releaseArtifact();assert.equal(a.manifest.modules.length,17);assert.deepEqual(a.manifest.modules.slice(0,7).map(x=>x.id),['procurement','rental_corrections','cleanup','metrics','job_email','item_register','item_register_v2']);assert.deepEqual(a.manifest.modules.map(x=>x.id),MODULE_SPECS.map(x=>x.id));assert.match(a.sha256,/^[a-f0-9]{64}$/);});
it('missing or changed SQL fails closed, not just base hash',()=>{const d=mkdtempSync(resolve(tmpdir(),'prima-artifact-'));try{for(const p of ['db/release-manifest.json','db/migrations/001_init.sql',...MODULE_SPECS.map(x=>x.path)]){mkdirSync(dirname(resolve(d,p)),{recursive:true});copyFileSync(resolve(releaseRoot(),p),resolve(d,p));}assert.ok(releaseArtifact(d));writeFileSync(resolve(d,MODULE_SPECS[3].path),'changed');assert.throws(()=>releaseArtifact(d),/does not match/);}finally{rmSync(d,{recursive:true,force:true});}});
it('only pinned outer transaction is removed, inner guarded blocks stay intact',()=>{assert.equal(moduleBody('-- reviewed\nBEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;'),'\nDO $$ BEGIN PERFORM 1; END $$;\n');assert.throws(()=>moduleBody('CREATE TABLE danger(id text)'),/transactional/);});

it('optional catalog support never authorizes an unmanifested module install',()=>{for(const m of OPTIONAL_MODULE_SPECS) assert.throws(()=>selectedModuleSql(m.id),/Unknown release module/);});
// P96 guard pay (Fauzan, 8 Nov 2026): installed later, as its own step; Prima takes over guard pay on 1 August 2027.
it('pay formulas and guard pay are optional with pinned bytes, never mandatory',()=>{
 assert.deepEqual(OPTIONAL_MODULE_SPECS.map(m=>[m.id,m.path,m.sha256,[...m.requires]]),[
  ['pay_formulas','db/modules/pay-formulas-v1.sql','38718470f582cb438a08d42d6131187aa55c0613e3aa58a924836f77cfbfda72',[]],
  ['guard_pay','db/modules/guard-pay-v1.sql','c6ca56b61b076181eba45bd1c1c88d766c9339b981e45c41154b8fee0c32d8a1',['pay_formulas']]]);
 const a=releaseArtifact();
 for(const m of OPTIONAL_MODULE_SPECS){
  assert.equal(sha256(readFileSync(resolve(releaseRoot(),m.path))),m.sha256,m.path+' bytes changed');
  assert(!a.manifest.modules.some(x=>x.id===m.id||x.path===m.path),m.id+' must not be in the release manifest');
  assert(!MODULE_SPECS.some(x=>(x.id as string)===m.id),m.id+' must not be mandatory');
  const o=optionalModuleSql(m.id);assert.equal(o.module.sha256,m.sha256);assert.equal(o.artifact.sha256,a.sha256);
 }
 assert.throws(()=>optionalModuleSql('procurement'),/Unknown optional module/);
});
it('a changed optional module file is refused',()=>{const d=mkdtempSync(resolve(tmpdir(),'prima-optional-'));try{for(const p of ['db/release-manifest.json','db/migrations/001_init.sql',...MODULE_SPECS.map(x=>x.path),...OPTIONAL_MODULE_SPECS.map(x=>x.path)]){mkdirSync(dirname(resolve(d,p)),{recursive:true});copyFileSync(resolve(releaseRoot(),p),resolve(d,p));}assert.ok(optionalModuleSql('guard_pay',d));writeFileSync(resolve(d,OPTIONAL_MODULE_SPECS[1].path),'changed');assert.throws(()=>optionalModuleSql('guard_pay',d),/pinned hash/);assert.ok(releaseArtifact(d));}finally{rmSync(d,{recursive:true,force:true});}});
