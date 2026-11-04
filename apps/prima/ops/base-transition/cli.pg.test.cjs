// Disposable PostgreSQL rehearsal ONLY. Never run against Azure/staging.
// Requires existing `pg`; this file does not install dependencies or provision cloud resources.
const {before,after,it}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {Client}=require('pg');
const {run,verifyArtifact}=require('./cli.cjs');const {oldSha:OLD,newSha:NEXT}=verifyArtifact();
const source={old:fs.readFileSync(__dirname+'/live.sql','utf8'),next:fs.readFileSync(__dirname+'/candidate.sql','utf8')};
const base=new URL(process.env.TEST_POSTGRES_URL||'postgres://postgres:localdev@localhost:5432/postgres');
if(!['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname))throw Error('Disposable localhost PostgreSQL required');
const OWNER='prima_base_transition_test_owner';let admin,c,created=false;
const input={expectedOwner:OWNER,confirm:'MIGRATE_EXACT_BASE_ONLY',oldSha:OLD,newSha:NEXT};
before(async()=>{admin=new Client({connectionString:base.toString()});await admin.connect();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname='appdb'")).rows[0].n,0,'Refuse to replace an existing local appdb');
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1)',[[OWNER,'prima_app','prima_api']])).rows[0].n,0,'Fresh disposable cluster required; never modify pre-existing roles');
 for(const [name,attrs]of [[OWNER,"LOGIN NOCREATEDB NOCREATEROLE INHERIT PASSWORD 'local-test-only'"],['prima_app','NOLOGIN NOCREATEDB NOCREATEROLE'],['prima_api',"LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD 'local-test-only'"]])await admin.query(`CREATE ROLE ${name} ${attrs} NOSUPERUSER NOBYPASSRLS`);
 await admin.query('GRANT prima_app TO prima_api');
 await admin.query(`CREATE DATABASE appdb OWNER ${OWNER}`);created=true;
 const u=new URL(base);u.pathname='/appdb';u.username=OWNER;u.password='local-test-only';c=new Client({connectionString:u.toString()});await c.connect();
 await c.query(source.old);await c.query('GRANT USAGE ON SCHEMA prima TO prima_api');await c.query('GRANT SELECT ON prima.users,prima.grants,prima.schema_info TO prima_api');await c.query('INSERT INTO prima.schema_info VALUES(1,$1,now())',[OLD]);
 await c.query("SELECT set_config('app.company_ids','co-synthetic',false)");
 await c.query(`INSERT INTO prima.users VALUES('u-kept','{"id":"u-kept","entraOid":"11111111-1111-4111-8111-111111111111"}');INSERT INTO prima.grants VALUES('g-kept','co-synthetic','{"id":"g-kept","userId":"u-kept","companyId":"co-synthetic"}');INSERT INTO prima.audit VALUES(1,'co-synthetic','{"seq":1,"action":"synthetic.preserved","hash":"unchanged"}');INSERT INTO prima.people VALUES('p-kept','co-synthetic','{"id":"p-kept","companyId":"co-synthetic"}');`);
});
after(async()=>{await c?.end();if(created)await admin.query('DROP DATABASE appdb WITH (FORCE)');await admin?.end();});

const HOST='psql-prima-staging-sea.postgres.database.azure.com';
const syntheticEnv={DATABASE_URL:`postgresql://${OWNER}:local-test-only@${HOST}:5432/appdb?sslmode=verify-full`};
const args=()=>{const p=verifyArtifact();return['execute','--owner',OWNER,'--artifact-sha',p.artifactSha,'--old-sha',OLD,'--new-sha',NEXT,'--runner-sha',p.runnerSha,'--confirm','MIGRATE_EXACT_BASE_ONLY'];};
// Code-only synthetic factory: actual SQL uses private localhost; expected production
// host/TLS metadata is deliberately substituted. This is NOT Azure TLS verification.
function factory({actualUser=OWNER,failAfterDDL=false,connectFailure=false,terminateAfterConnect=false}={}){
 const calls={created:0,connected:0,ended:0,ddl:0,errors:0};
 return{calls,makeClient(config){calls.created++;assert.equal(config.host,HOST);assert.equal(config.port,5432);assert.equal(config.database,'appdb');assert.equal(config.user,OWNER);assert.equal(config.options,'');assert.deepEqual(config.ssl,{rejectUnauthorized:true,servername:HOST});assert.equal(Object.hasOwn(config,'connectionString'),false);
  const u=new URL(base);u.pathname='/appdb';u.username=actualUser;u.password='local-test-only';const db=new Client({connectionString:u.toString()});
  return{connectionParameters:{host:config.host,port:config.port,database:config.database,user:config.user},connection:{stream:{encrypted:true,authorized:true}},on(event,handler){db.on(event,(error)=>{if(event==='error')calls.errors++;handler(error);});},async connect(){calls.connected++;if(connectFailure)throw Error('synthetic-private-error-do-not-print');await db.connect();if(terminateAfterConnect){await admin.query('SELECT pg_terminate_backend($1)',[db.processID]);await new Promise(resolve=>setTimeout(resolve,30));}},async query(sql,params){const r=await db.query(sql,params);if(sql.includes('-- Prima Secure App')){calls.ddl++;if(failAfterDDL)throw Error('synthetic-private-error-do-not-print');}return r;},async end(){calls.ended++;await db.end();}};
 }};
}
it('CLI plan needs no credential or client',async()=>{let made=0;const r=await run([],{}, {makeClient(){made++;throw Error('must not connect');}});assert.equal(r.status,'plan_only');assert.equal(r.liveAuthorizationGranted,false);assert.equal(made,0);});
it('wrong target, owner, port, database or TLS override refuses before client creation',async()=>{
 const bad=[syntheticEnv.DATABASE_URL.replace(HOST,'example.invalid'),syntheticEnv.DATABASE_URL.replace(':5432',':55432'),syntheticEnv.DATABASE_URL.replace('/appdb','/postgres'),syntheticEnv.DATABASE_URL.replace(OWNER,'prima_api'),syntheticEnv.DATABASE_URL.replace('verify-full','disable'),syntheticEnv.DATABASE_URL+'&options=-c%20role%3Dprima_app'];
 for(const DATABASE_URL of bad){let made=0;const r=await run(args(),{DATABASE_URL},{makeClient(){made++;throw Error('must not connect');}});assert.equal(r.stage,'preconnect');assert.equal(r.code,'EXACT_INPUT_TARGET_OR_TLS_REQUIRED');assert.equal(made,0);}
});
it('connection failure is sanitized and cleanup attempted',async()=>{const f=factory({connectFailure:true});const r=await run(args(),syntheticEnv,f);assert.equal(r.status,'outcome_unconfirmed');assert.equal(r.code,'BASE_TRANSITION_UNAVAILABLE');assert(!JSON.stringify(r).includes('synthetic-private'));assert.equal(f.calls.ended,1);});
it('actual asynchronous server termination is caught, sanitized and never executes DDL',async()=>{const f=factory({terminateAfterConnect:true});const r=await run(args(),syntheticEnv,f);assert.equal(r.status,'outcome_unconfirmed');assert.equal(r.automaticRetryAllowed,false);assert(f.calls.errors>0,'Actual pg error event must be observed');assert.equal(f.calls.ddl,0);assert.equal(f.calls.ended,1);assert(!JSON.stringify(r).includes('terminating connection'));assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,OLD);});
it('actual runtime user cannot impersonate the supplied schema owner',async()=>{const f=factory({actualUser:'prima_api'});const r=await run(args(),syntheticEnv,f);assert.equal(r.code,'OWNER_OR_TARGET_MISMATCH');assert.equal(f.calls.ended,1);assert.equal(f.calls.ddl,0);});
it('CLI execution failure after real candidate DDL rolls back bootstrap/schema and closes connection',async()=>{const f=factory({failAfterDDL:true});const r=await run(args(),syntheticEnv,f);assert.equal(r.status,'refused');assert.equal(r.stage,'apply');assert.equal(f.calls.ddl,1);assert.equal(f.calls.ended,1);assert(!JSON.stringify(r).includes('synthetic-private'));assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,OLD);assert.equal((await c.query("SELECT to_regclass('prima.hr_it_requests') AS t")).rows[0].t,null);assert.equal((await c.query("SELECT count(*)::int n FROM pg_policy WHERE polname='audit_owner_read'")).rows[0].n,0);});
it('CLI exact old→new preserves synthetic identities/grants/audit/business row, then refuses repeat',async()=>{const f=factory();const r=await run(args(),syntheticEnv,f);assert.equal(r.status,'committed',JSON.stringify(r));assert.equal(f.calls.ended,1);assert.equal((await c.query('SELECT migration_sha256 FROM prima.schema_info')).rows[0].migration_sha256,NEXT);assert.equal((await c.query("SELECT data->>'entraOid' oid FROM prima.users WHERE id='u-kept'")).rows[0].oid,'11111111-1111-4111-8111-111111111111');for(const [t,k,id]of [['grants','id','g-kept'],['audit','seq',1],['people','id','p-kept']])assert.equal((await c.query(`SELECT count(*)::int n FROM prima.${t} WHERE ${k}=$1`,[id])).rows[0].n,1);const again=factory();const repeat=await run(args(),syntheticEnv,again);assert.equal(repeat.status,'refused');assert.equal(repeat.automaticRetryAllowed,false);assert.equal(again.calls.ddl,0);assert.equal(again.calls.ended,1);});
