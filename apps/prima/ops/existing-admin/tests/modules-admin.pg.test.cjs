// Disposable PostgreSQL rehearsal ONLY. Never run against Azure/staging.
// Requires existing `pg`; this file does not install dependencies or provision cloud resources.
const {before,after,it}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {Client}=require('pg');
const {migrateExistingAdminBase:migrateBase,OLD,NEXT}=require('../base/existing-admin-transition.cjs');
const source={old:fs.readFileSync(__dirname+'/../base/live.sql','utf8'),next:fs.readFileSync(__dirname+'/../base/candidate.sql','utf8')};
const base=new URL(process.env.TEST_POSTGRES_URL||'postgres://postgres:localdev@localhost:5432/postgres');
if(!['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname))throw Error('Disposable localhost PostgreSQL required');
const OWNER='primaadmin';let admin,c,created=false;
const input={expectedOwner:OWNER,profile:'azure-primaadmin-observed-2026-11-02',confirm:'MIGRATE_EXACT_EXISTING_PRIMAADMIN_BASE_ONLY',oldSha:OLD,newSha:NEXT};
// Deliberate test transport mapping: SQL runs on localhost appdb; production metadata gate
// is exercised separately by unit negatives. This does NOT demonstrate Azure connectivity.
const adapter=(failAfterDDL=false)=>({connection:{stream:{encrypted:true,authorized:true}},connectionParameters:{port:5432,host:'psql-prima-staging-sea.postgres.database.azure.com',database:'appdb',user:OWNER},query:async(sql,args)=>{const r=await c.query(sql,args);if(failAfterDDL&&sql.includes('-- Prima Secure App'))throw Error('Injected after-DDL failure');return r;}});
before(async()=>{admin=new Client({connectionString:base.toString()});await admin.connect();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname='appdb'")).rows[0].n,0,'Refuse to replace an existing local appdb');
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1)',[[OWNER,'prima_app','prima_api']])).rows[0].n,0,'Fresh disposable cluster required; never modify pre-existing roles');
 for(const [name,attrs]of [[OWNER,"LOGIN CREATEDB CREATEROLE INHERIT PASSWORD 'local-test-only'"],['prima_app','NOLOGIN NOCREATEDB NOCREATEROLE'],['prima_api',"LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD 'local-test-only'"]])await admin.query(`CREATE ROLE ${name} ${attrs} NOSUPERUSER ${name===OWNER?"BYPASSRLS":"NOBYPASSRLS"}`);
 await admin.query('GRANT prima_app TO prima_api');await admin.query(`GRANT prima_app TO ${OWNER} WITH INHERIT FALSE, SET TRUE`);
 await admin.query(`CREATE DATABASE appdb OWNER ${OWNER}`);created=true;
 const u=new URL(base);u.pathname='/appdb';u.username=OWNER;u.password='local-test-only';c=new Client({connectionString:u.toString()});await c.connect();
 await c.query(source.old);await c.query('GRANT USAGE ON SCHEMA prima TO prima_api');await c.query('GRANT SELECT ON prima.users,prima.grants,prima.schema_info TO prima_api');await c.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[OLD]);
 await c.query("SELECT set_config('app.company_ids','co-synthetic',false)");
 await c.query(`INSERT INTO prima.users VALUES('u-kept','{"id":"u-kept","entraOid":"11111111-1111-4111-8111-111111111111"}');INSERT INTO prima.grants VALUES('g-kept','co-synthetic','{"id":"g-kept","userId":"u-kept","companyId":"co-synthetic"}');INSERT INTO prima.audit VALUES(1,'co-synthetic','{"seq":1,"action":"synthetic.preserved","hash":"unchanged"}');INSERT INTO prima.people VALUES('p-kept','co-synthetic','{"id":"p-kept","companyId":"co-synthetic"}');`);
});
after(async()=>{await runtime?.end();await c?.end();if(created)await admin.query('DROP DATABASE appdb WITH (FORCE)');await admin?.end();});

const crypto=require('crypto');const {Pool}=require('pg');
const {releaseCatalogState}=require('../modules/working/apps/api/dist/src/release-catalog');
const root=require('path').resolve(__dirname,'../modules/working');const manifestText=fs.readFileSync(root+'/db/release-manifest.json','utf8');
assert.equal(crypto.createHash('sha256').update(manifestText).digest('hex'),'734f15d2d04be8e56f0ad7d562742d5a8760de9fb922b69d197c877c5f3ec3ab');
const manifest=JSON.parse(manifestText);let runtime;

async function state(pool=runtime){return releaseCatalogState(pool,{baseSha256:NEXT});}

const {installSelectedModule:strictInstall}=require('../modules/working/apps/api/dist/src/module-install');
const {installPrimaadminModule:installSelectedModule}=require('../modules/admin-module.cjs');
const wrapped={connection:adapter().connection,connectionParameters:adapter().connectionParameters,query:(...a)=>c.query(...a)};
const {spawnSync}=require('child_process');const cli=root+'/apps/api/dist/src/module-install.js';
const argsFor=id=>{const m=manifest.modules.find(m=>m.id===id);return{id,releaseSha256:'734f15d2d04be8e56f0ad7d562742d5a8760de9fb922b69d197c877c5f3ec3ab',moduleSha256:m.sha256,confirm:'INSTALL_EXACT_PRIMAADMIN_MODULE'};};
it('matching existing admin base succeeds; strict normal installer still refuses BYPASS owner',async()=>{
 const b=await migrateBase(adapter(),input,source);assert.equal(b.status,'committed',JSON.stringify(b));
 await assert.rejects(strictInstall(c,{...argsFor('procurement'),confirm:'INSTALL_SELECTED_MODULE'},root));assert.equal((await c.query("SELECT to_regclass('prima.it_procurement_packets') AS t")).rows[0].t,null);
 const u=new URL(base);u.pathname='/appdb';u.username='prima_api';u.password='local-test-only';runtime=new Pool({connectionString:u.toString(),max:1});assert.equal((await state()).ready,false);
});
it('synthetic existing SET membership alone enables planned owner role, without granting app ownership',async()=>{
 await admin.query(`GRANT prima_app TO ${OWNER} WITH INHERIT FALSE, SET TRUE`);
 const r=(await c.query(`SELECT pg_has_role(session_user,'prima_app','SET') can_set,pg_has_role('prima_api',session_user,'MEMBER') unsafe`)).rows[0];assert.deepEqual(r,{can_set:true,unsafe:false});
 await assert.rejects(installSelectedModule(wrapped,{...argsFor('procurement'),moduleSha256:'0'.repeat(64)},root));
 await assert.rejects(installSelectedModule(wrapped,argsFor('cleanup'),root));assert.equal((await c.query("SELECT to_regclass('prima.it_cleanup_nominations') AS t")).rows[0].t,null);
});
it('partial marker refuses replay and wrong base refuses before module DDL',async()=>{
 await c.query('CREATE TABLE prima.it_procurement_partial(id text)');try{await assert.rejects(installSelectedModule(wrapped,argsFor('procurement'),root));assert.equal((await c.query("SELECT to_regclass('prima.it_procurement_packets') AS t")).rows[0].t,null);}finally{await c.query('DROP TABLE prima.it_procurement_partial');}
 await c.query("UPDATE prima.schema_info SET migration_sha256=repeat('0',64)");try{await assert.rejects(installSelectedModule(wrapped,argsFor('procurement'),root));}finally{await c.query('UPDATE prima.schema_info SET migration_sha256=$1',[NEXT]);}
});
it('all five actual installer transactions pass exact catalogs; replay is no-op',async()=>{
 const before={};for(const t of ['users','grants','audit','people'])before[t]=(await c.query(`SELECT row_to_json(x)::text AS row FROM prima.${t} x ORDER BY 1`)).rows;
 for(const m of manifest.modules){const r=await installSelectedModule(wrapped,argsFor(m.id),root);assert.equal(r.status,'installed');assert.equal(r.catalogVerified,true);}
 for(const m of manifest.modules){assert.equal((await installSelectedModule(wrapped,argsFor(m.id),root)).status,'already_installed');}
 const out=await state();assert.equal(out.ready,true,JSON.stringify(out));
 for(const t of Object.keys(before))assert.deepEqual((await c.query(`SELECT row_to_json(x)::text AS row FROM prima.${t} x ORDER BY 1`)).rows,before[t]);
});
it('installed privilege drift refuses repair/replay and remains visible until explicit fixture restore',async()=>{
 await c.query('GRANT UPDATE ON prima.it_cleanup_receipts TO prima_app');try{await assert.rejects(installSelectedModule(wrapped,argsFor('cleanup'),root));assert.equal((await state()).ready,false);}finally{await c.query('REVOKE UPDATE ON prima.it_cleanup_receipts FROM prima_app');}
 assert.equal((await state()).ready,true);
});

// Independent bounded runtime regression additions. Actual prima_api login; no admin SET ROLE disguise.
async function actor(uid, fn){const a=await runtime.connect();try{assert.equal((await a.query("SELECT session_user=current_user AND current_user='prima_api' ok")).rows[0].ok,true);await a.query('BEGIN');await a.query('SET LOCAL ROLE prima_app');await a.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_ids','co-a',true),set_config('app.walls','',true),set_config('app.job','',true)",[uid]);return await fn(a);}finally{await a.query('ROLLBACK');a.release();}}
async function denied(uid,sql,args=[],codes=['42501']){await actor(uid,async a=>{await assert.rejects(a.query(sql,args),e=>codes.includes(e.code));});}
it('seed independent scoped actors and confirm every module definer remains isolated from runtime',async()=>{
 for(const company of ['co-a','co-b'])await c.query('INSERT INTO prima.companies VALUES($1,$2)',[company,{id:company}]);
 for(const [id,role]of [['it-a','executive'],['it-b','executive'],['lead-a','lead']])await c.query('INSERT INTO prima.users VALUES($1,$2)',[id,{id,role:'pwvsb_officer',department:'it',itRole:role,companyIds:[id==='it-b'?'co-b':'co-a']}]);
 for(const id of ['pa','pb'])await c.query('INSERT INTO prima.it_purchases VALUES($1,$2)',[id,{id,ownerId:id==='pa'?'co-a':'co-b',status:'submitted'}]);
 for(const id of ['ja','jb'])await c.query('INSERT INTO prima.it_jobs VALUES($1,$2)',[id,{id,status:'doing',assigneeId:id==='ja'?'it-a':'it-b',givenById:'lead-a',returns:0,log:[],proof:[],technical:false}]);
 const r=(await c.query("SELECT bool_and(pg_get_userbyid(p.proowner)='primaadmin') owned FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.prosecdef")).rows[0];assert.equal(r.owned,true);
 await actor('it-a',async a=>{const r=(await a.query("SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole restricted,NOT pg_has_role(current_user,'primaadmin','MEMBER') isolated FROM pg_roles WHERE rolname=current_user")).rows[0];assert.deepEqual(r,{restricted:true,isolated:true});});
});
it('BYPASS-owned procurement rental cleanup predicates retain positive own scope and negative foreign scope',async()=>{
 await actor('it-a',async a=>{for(const [sql,args]of [["SELECT prima.ip_visible($1) own,prima.ip_visible($2) foreign_scope",['pa','pb']],["SELECT prima.rc_visible($1) own,prima.rc_visible($2) foreign_scope",['co-a','co-b']],["SELECT prima.ic_scope(current_setting('app.user_id'),$1) own,prima.ic_scope(current_setting('app.user_id'),$2) foreign_scope",['co-a','co-b']]])assert.deepEqual((await a.query(sql,args)).rows[0],{own:true,foreign_scope:false});});
});
it('BYPASS-owned job mail and timing deny other assignee and recheck closed actor',async()=>{
 const ref={workflow:'job',recordId:'ja',stage:'work',cycle:1,coverageSegment:1,complexity:'unclassified'};
 await actor('it-a',async a=>{assert.deepEqual((await a.query("SELECT prima.job_email_job_access('ja','view') own,prima.job_email_job_access('jb','view') foreign_scope,prima.job_email_job_access('jb','attach') foreign_attach")).rows[0],{own:true,foreign_scope:false,foreign_attach:false});});
 await actor('it-a',async a=>assert.equal((await a.query('SELECT prima.wm_next_segment($1) n',[ref])).rows[0].n,1));
 await denied('it-b','SELECT prima.wm_next_segment($1)',[ref],['23514']);
 await c.query("UPDATE prima.users SET data=data||'{\"accessClosedFrom\":\"2000-01-01\"}'::jsonb WHERE id='it-a'");try{await actor('it-a',async a=>{assert.deepEqual((await a.query("SELECT prima.ip_visible('pa') procurement,prima.rc_visible('co-a') rental,prima.ic_scope('it-a','co-a') cleanup,prima.job_email_job_access('ja','view') mail")).rows[0],{procurement:false,rental:false,cleanup:false,mail:false});});}finally{await c.query("UPDATE prima.users SET data=data-'accessClosedFrom' WHERE id='it-a'");}
});
it('private definer data helpers and binding ledger are not callable/readable by actual runtime',async()=>{
 for(const sql of ["SELECT prima.ip_purchase_hash('{}'::jsonb)","SELECT prima.rc_current('{}'::jsonb)","SELECT prima.ic_root('asset','foreign')","SELECT prima.wm_source('{}'::jsonb)","SELECT * FROM prima.it_cleanup_plan_bindings"])await denied('it-a',sql);
});
it('malformed domain writes are rejected by guards despite BYPASS function ownership',async()=>{
 for(const table of ['it_procurement_packets','it_rental_correction_requests','it_cleanup_nominations','it_metric_streams']){await denied('it-a',`INSERT INTO prima.${table}(id,data) VALUES('forged','{}'::jsonb)`,[],['23514','42501']);assert.equal((await c.query(`SELECT count(*)::int n FROM prima.${table} WHERE id='forged'`)).rows[0].n,0);}
 await denied('it-a',"UPDATE prima.it_purchase_finance_authorities SET data='{}'::jsonb");
 await denied('it-a',"DELETE FROM prima.job_email_attachments");
});
it('installed module profile rejects changed owner vector and disguised session without changing catalogs',async()=>{
 await admin.query('ALTER ROLE primaadmin NOCREATEDB');try{await assert.rejects(installSelectedModule(wrapped,argsFor('metrics'),root));}finally{await admin.query('ALTER ROLE primaadmin CREATEDB');}
 const u=new URL(base);u.pathname='/appdb';const d=new Client({connectionString:u.toString()});await d.connect();try{await d.query('SET ROLE primaadmin');await assert.rejects(installSelectedModule({...wrapped,query:(...a)=>d.query(...a)},argsFor('metrics'),root));}finally{await d.end();}
 assert.equal((await state()).ready,true);
});
it('admin profile refuses default ACL, runtime schema CREATE and owner membership drift',async()=>{
 for(const [setup,restore]of [["ALTER DEFAULT PRIVILEGES IN SCHEMA prima GRANT SELECT ON TABLES TO prima_app","ALTER DEFAULT PRIVILEGES IN SCHEMA prima REVOKE SELECT ON TABLES FROM prima_app"],["GRANT CREATE ON SCHEMA prima TO prima_app","REVOKE CREATE ON SCHEMA prima FROM prima_app"]]){await c.query(setup);try{await assert.rejects(installSelectedModule(wrapped,argsFor('metrics'),root));}finally{await c.query(restore);}}
 await admin.query('GRANT primaadmin TO prima_api');try{await assert.rejects(installSelectedModule(wrapped,argsFor('metrics'),root));}finally{await admin.query('REVOKE primaadmin FROM prima_api');}
 assert.equal((await state()).ready,true);
});
