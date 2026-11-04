// Disposable PostgreSQL rehearsal ONLY. Never run against Azure/staging.
// Requires existing `pg`; this file does not install dependencies or provision cloud resources.
const {before,after,it}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {Client}=require('pg');
const {migrateExistingAdminBase:migrateBase,OLD,NEXT}=require('../base/existing-admin-transition.cjs');
const source={old:fs.readFileSync(__dirname+'/../base/live.sql','utf8'),next:fs.readFileSync(__dirname+'/../base/candidate.sql','utf8')};
const {base,tls,localHost,localPort}=require('./local-test-config.cjs');
if(!['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname))throw Error('Disposable localhost PostgreSQL required');
const OWNER='primaadmin';let admin,c,created=false,ownerBefore,membersBefore;const rowsBefore={};
const input={expectedOwner:OWNER,confirm:'MIGRATE_EXACT_EXISTING_PRIMAADMIN_BASE_ONLY',profile:'azure-primaadmin-observed-2026-11-02',oldSha:OLD,newSha:NEXT};
// Deliberate test transport mapping: SQL runs on localhost appdb; production metadata gate
// is exercised separately by unit negatives. This does NOT demonstrate Azure connectivity.
const adapter=(failAfterDDL=false)=>({connection:{stream:{encrypted:true,authorized:true}},connectionParameters:{port:5432,host:'psql-prima-staging-sea.postgres.database.azure.com',database:'appdb',user:OWNER},query:async(sql,args)=>{const r=await c.query(sql,args);if(failAfterDDL&&sql.includes('-- Prima Secure App'))throw Error('Injected after-DDL failure');return r;}});
before(async()=>{admin=new Client({connectionString:base.toString(),ssl:tls});await admin.connect();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname='appdb'")).rows[0].n,0,'Refuse to replace an existing local appdb');
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1)',[[OWNER,'prima_app','prima_api']])).rows[0].n,0,'Fresh disposable cluster required; never modify pre-existing roles');
 await admin.query("CREATE ROLE primaadmin LOGIN CREATEDB CREATEROLE INHERIT NOSUPERUSER BYPASSRLS PASSWORD 'local-test-only'");
 await admin.query('CREATE ROLE prima_app NOLOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS');
 await admin.query("CREATE ROLE prima_api LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD 'local-test-only'");
 await admin.query('GRANT prima_app TO prima_api');
 await admin.query('GRANT prima_app TO primaadmin WITH INHERIT FALSE, SET TRUE');
 await admin.query(`CREATE DATABASE appdb OWNER ${OWNER}`);created=true;
 const u=new URL(base);u.pathname='/appdb';u.username=OWNER;u.password='local-test-only';c=new Client({connectionString:u.toString(),ssl:tls});await c.connect();
 ownerBefore=(await admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig FROM pg_roles WHERE rolname='primaadmin'")).rows;membersBefore=(await admin.query("SELECT * FROM pg_auth_members WHERE roleid='primaadmin'::regrole OR member='primaadmin'::regrole ORDER BY roleid,member,grantor")).rows;
 await c.query(source.old);await c.query('GRANT USAGE ON SCHEMA prima TO prima_api');await c.query('GRANT SELECT ON prima.users,prima.grants,prima.schema_info TO prima_api');await c.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[OLD]);
 await c.query("SELECT set_config('app.company_ids','co-synthetic',false)");
 await c.query(`INSERT INTO prima.users VALUES('u-kept','{"id":"u-kept","entraOid":"11111111-1111-4111-8111-111111111111"}');INSERT INTO prima.grants VALUES('g-kept','co-synthetic','{"id":"g-kept","userId":"u-kept","companyId":"co-synthetic"}');INSERT INTO prima.audit VALUES(1,'co-synthetic','{"seq":1,"action":"synthetic.preserved","hash":"unchanged"}');INSERT INTO prima.people VALUES('p-kept','co-synthetic','{"id":"p-kept","companyId":"co-synthetic"}');`);
});
after(async()=>{await c?.end();if(created)await admin.query('DROP DATABASE appdb WITH (FORCE)');await admin?.end();});
async function refusesDrift(setup,restore,code){await c.query(setup);try{const r=await migrateBase(adapter(),input,source);assert.equal(r.code,code,JSON.stringify(r));assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,OLD);}finally{await c.query(restore);}}

const {spawnSync}=require('node:child_process');const {verifyArtifact}=require('../base/existing-admin-cli.cjs');
const pins=verifyArtifact();
function invoke(file,args,preload='test-local-transport.cjs'){const r=spawnSync(process.execPath,['--require',__dirname+'/'+preload,file,...args],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'',DATABASE_URL:'postgres://primaadmin:local-test-only@psql-prima-staging-sea.postgres.database.azure.com:5432/appdb'}});assert.equal(r.error,undefined);return{process:r,json:JSON.parse(r.stdout.trim())};}
const args=()=>['execute','--owner','primaadmin','--artifact-sha',pins.artifactSha,'--old-sha',pins.oldSha,'--new-sha',pins.newSha,'--runner-sha',pins.runnerSha,'--confirm','MIGRATE_EXACT_EXISTING_PRIMAADMIN_BASE_ONLY'];
it('actual spawned named base CLI refuses malformed confirmation then commits pinned base',async()=>{
 for(const t of ['users','grants','audit','people'])rowsBefore[t]=(await c.query('SELECT * FROM prima.'+t+' ORDER BY '+(t==='audit'?'seq':'id'))).rows;
 let r=invoke(__dirname+'/../base/existing-admin-cli.cjs',args().map(x=>x==='MIGRATE_EXACT_EXISTING_PRIMAADMIN_BASE_ONLY'?'wrong':x));assert.equal(r.process.status,1);assert.equal(r.json.stage,'preconnect');assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,OLD);
 r=invoke(__dirname+'/../base/existing-admin-cli.cjs',args());assert.equal(r.process.status,0,r.process.stderr+JSON.stringify(r.json));assert.equal(r.json.status,'committed');assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,NEXT);
});
it('actual spawned named base CLI refuses repeat without resetting data',async()=>{const r=invoke(__dirname+'/../base/existing-admin-cli.cjs',args());assert.equal(r.process.status,1);assert.equal(r.json.status,'refused');assert.equal(r.json.automaticRetryAllowed,false);for(const t of ['users','grants','audit','people'])assert.equal((await c.query('SELECT count(*)::int n FROM prima.'+t)).rows[0].n,1);});

it('actual spawned five named module installs and replay preserve data and yield restricted runtime catalog readiness',async()=>{
 const mod=require('node:path').resolve(__dirname,'../modules');const crypto=require('node:crypto');const expected='0e8ced620e30427a53f4e3bc66a10185443e434f0cb7864448707af32800e670';assert.equal(crypto.createHash('sha256').update(fs.readFileSync(mod+'/artifact-manifest.json')).digest('hex'),expected);
 const release='734f15d2d04be8e56f0ad7d562742d5a8760de9fb922b69d197c877c5f3ec3ab';const manifest=JSON.parse(fs.readFileSync(mod+'/working/db/release-manifest.json','utf8'));
 for(const m of manifest.modules){const a=['execute','--module',m.id,'--artifact-sha',expected,'--release-sha',release,'--module-sha',m.sha256,'--confirm','INSTALL_EXACT_PRIMAADMIN_MODULE'];const lost=m.id==='procurement';const r=invoke(mod+'/cli.cjs',a,lost?'test-commit-loss-transport.cjs':'test-local-transport.cjs');if(lost){assert.equal(r.process.status,1);assert.equal(r.json.status,'outcome_unconfirmed');assert.equal(r.json.code,'MODULE_CONNECTION_FAILED');assert.equal(r.json.automaticRetryAllowed,false);assert(!r.process.stdout.includes('synthetic-private-loss'));assert(!r.process.stderr.includes('synthetic-private-loss'));const q=await c.query("SELECT to_regclass('prima.it_procurement_packets') IS NOT NULL AS installed");assert.equal(q.rows[0].installed,true);}else{assert.equal(r.process.status,0,r.process.stderr+JSON.stringify(r.json));assert.equal(r.json.status,'installed');assert.equal(r.json.catalogVerified,true);}const repeat=invoke(mod+'/cli.cjs',a);assert.equal(repeat.process.status,0,JSON.stringify(repeat.json));assert.equal(repeat.json.status,'already_installed');assert.equal(repeat.json.catalogVerified,true);}
 const {Pool}=require('pg');const pool=new Pool({host:localHost,port:localPort,database:'appdb',user:'prima_api',password:'local-test-only',ssl:tls});
 try{const {releaseCatalogState}=require(mod+'/working/apps/api/dist/src/release-catalog');const state=await releaseCatalogState(pool,{baseSha256:NEXT});assert.equal(state.ready,true,JSON.stringify(state));}finally{await pool.end();}
 for(const t of ['users','grants','audit','people'])assert.deepEqual((await c.query('SELECT * FROM prima.'+t+' ORDER BY '+(t==='audit'?'seq':'id'))).rows,rowsBefore[t]);
 assert.deepEqual((await admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig FROM pg_roles WHERE rolname='primaadmin'")).rows,ownerBefore);
 assert.deepEqual((await admin.query("SELECT * FROM pg_auth_members WHERE roleid='primaadmin'::regrole OR member='primaadmin'::regrole ORDER BY roleid,member,grantor")).rows,membersBefore);
});
