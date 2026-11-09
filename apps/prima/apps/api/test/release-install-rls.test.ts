/** Actual disposable PostgreSQL only: never points at staging or live data. */
import assert from 'node:assert/strict';
import {before,after,it} from 'node:test';
import {Client,Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {releaseArtifact,releaseRoot,type ReleaseModuleId} from '../src/release-artifact';
import {installSelectedModule} from '../src/module-install';
import {releaseCatalogState} from '../src/release-catalog';
const base=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/prima_test';
if(!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(base).hostname))throw Error('Disposable localhost database required');
const DB='prima_release_install_test',OWNER='prima_release_install_owner',RUNTIME='prima_release_install_api';
const url=(role:string)=>{const u=new URL(base);u.pathname='/'+DB;u.username=role;u.password='local-test-only';return u.toString();};
const artifact=releaseArtifact();let owner:Client,pool:Pool;const oldLogin=process.env.PRIMA_API_DB_USER;
const input=(id:ReleaseModuleId)=>({id,releaseSha256:artifact.sha256,moduleSha256:artifact.manifest.modules.find(m=>m.id===id)!.sha256,confirm:'INSTALL_SELECTED_MODULE'});
const state=()=>releaseCatalogState(pool,{baseSha256:artifact.manifest.base.sha256});
before(async()=>{const admin=new Client({connectionString:base});await admin.connect();try{
 await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
 if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount)await admin.query('CREATE ROLE prima_app NOLOGIN');
 for(const [role,attributes]of [[OWNER,'CREATEDB CREATEROLE'],[RUNTIME,'NOCREATEDB NOCREATEROLE NOINHERIT']]){
  if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await admin.query(`CREATE ROLE ${role} LOGIN ${attributes} NOSUPERUSER NOBYPASSRLS PASSWORD 'local-test-only'`);
  await admin.query(`GRANT prima_app TO ${role}`);
 }
 await admin.query(`GRANT ${RUNTIME} TO ${OWNER}`);
 await admin.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
 }finally{await admin.end();}
 owner=new Client({connectionString:url(OWNER)});await owner.connect();await owner.query(readFileSync(resolve(releaseRoot(),artifact.manifest.base.path),'utf8'));
 await owner.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[artifact.manifest.base.sha256]);
 process.env.PRIMA_API_DB_USER=RUNTIME;pool=new Pool({connectionString:url(RUNTIME),max:1});
});
after(async()=>{if(oldLogin===undefined)delete process.env.PRIMA_API_DB_USER;else process.env.PRIMA_API_DB_USER=oldLogin;await pool?.end();await owner?.end();const c=new Client({connectionString:base});await c.connect();try{await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);}finally{await c.end();}});
it('base-only is not release-ready; each explicit selected install verifies and all eight yield restricted runtime readiness',async()=>{
 assert.equal((await state()).ready,false);
 for(const m of artifact.manifest.modules){const result=await installSelectedModule(owner,input(m.id));assert.equal(result.status,'installed');const current=await state();if(m.id!==artifact.manifest.modules.at(-1)!.id)assert.equal(current.ready,false);}
 const ready=await state();assert.deepEqual(ready.codes,[]);assert.equal(ready.ready,true);
 for(const m of artifact.manifest.modules)assert.equal((await installSelectedModule(owner,input(m.id))).status,'already_installed');
});
it('drift refuses replay without repair and read-only readiness fails closed',async()=>{
 await owner.query('ALTER TABLE prima.job_email_attachments DISABLE ROW LEVEL SECURITY');
 try{assert.equal((await state()).ready,false);await assert.rejects(installSelectedModule(owner,input('job_email')));assert.equal((await owner.query("SELECT relrowsecurity FROM pg_class WHERE oid='prima.job_email_attachments'::regclass")).rows[0].relrowsecurity,false);}finally{await owner.query('ALTER TABLE prima.job_email_attachments ENABLE ROW LEVEL SECURITY');}
 assert.equal((await state()).ready,true);
});
it('schema owner never passes restricted runtime proof, including prior SET ROLE disguise',async()=>{
 const adminPool=new Pool({connectionString:url(OWNER),max:1});try{assert.equal((await releaseCatalogState(adminPool,{baseSha256:artifact.manifest.base.sha256})).ready,false);const c=await adminPool.connect();await c.query(`SET ROLE ${RUNTIME}`);c.release();assert.equal((await releaseCatalogState(adminPool,{baseSha256:artifact.manifest.base.sha256})).ready,false);}finally{await adminPool.end();}
});
it('existing v1/partial mail marker refuses fresh v2 install without replacing existing data',async()=>{
 // A separate disposable schema state, after the all-five tests; no production records or reset command.
 await owner.query('DROP SCHEMA prima CASCADE');await owner.query(readFileSync(resolve(releaseRoot(),artifact.manifest.base.path),'utf8'));await owner.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[artifact.manifest.base.sha256]);
 await owner.query('CREATE TABLE prima.job_email_attachments(id text primary key,data jsonb not null)');await owner.query("INSERT INTO prima.job_email_attachments VALUES('preserved','{}')");
 await assert.rejects(installSelectedModule(owner,input('job_email')));assert.equal((await owner.query('SELECT id FROM prima.job_email_attachments')).rows[0].id,'preserved');
});
// P96 guard pay (Fauzan, 8 Nov 2026): the pay formulas and guard pay modules are optional, installed later as their own step.
it('optional pay modules: guard pay needs pay formulas, install once, again is a no-op, drift refused, no DELETE or TRUNCATE',async()=>{
 const {OPTIONAL_MODULE_SPECS}=await import('../src/release-artifact');const {OPTIONAL_CONFIRM}=await import('../src/module-install');
 const opt=(id:ReleaseModuleId)=>({id,releaseSha256:artifact.sha256,moduleSha256:OPTIONAL_MODULE_SPECS.find(m=>m.id===id)!.sha256,confirm:OPTIONAL_CONFIRM});
 await owner.query('DROP SCHEMA prima CASCADE');await owner.query(readFileSync(resolve(releaseRoot(),artifact.manifest.base.path),'utf8'));await owner.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[artifact.manifest.base.sha256]);
 await assert.rejects(installSelectedModule(owner,opt('guard_pay')));
 assert.equal((await owner.query("SELECT to_regclass('prima.guard_pay_runs') AS t")).rows[0].t,null);
 await assert.rejects(installSelectedModule(owner,{...opt('pay_formulas'),confirm:'INSTALL_SELECTED_MODULE'}));
 assert.equal((await installSelectedModule(owner,opt('pay_formulas'))).status,'installed');
 assert.equal((await installSelectedModule(owner,opt('pay_formulas'))).status,'already_installed');
 assert.equal((await installSelectedModule(owner,opt('guard_pay'))).status,'installed');
 assert.equal((await installSelectedModule(owner,opt('guard_pay'))).status,'already_installed');
 await owner.query('ALTER TABLE prima.guard_loans NO FORCE ROW LEVEL SECURITY');
 try{await assert.rejects(installSelectedModule(owner,opt('guard_pay')));assert.equal((await owner.query("SELECT relforcerowsecurity FROM pg_class WHERE oid='prima.guard_loans'::regclass")).rows[0].relforcerowsecurity,false);}finally{await owner.query('ALTER TABLE prima.guard_loans FORCE ROW LEVEL SECURITY');}
 assert.equal((await installSelectedModule(owner,opt('guard_pay'))).status,'already_installed');
 const c=await pool.connect();try{for(const t of ['pay_formulas','site_hours_approvals','guard_pay_runs','guard_pay_advances','guard_loans','statutory_versions'])for(const sql of [`DELETE FROM prima.${t}`,`TRUNCATE prima.${t}`]){await c.query('BEGIN');try{await c.query('SET LOCAL ROLE prima_app');await assert.rejects(c.query(sql),/permission denied/,sql);}finally{await c.query('ROLLBACK');}}}finally{c.release();}
});
