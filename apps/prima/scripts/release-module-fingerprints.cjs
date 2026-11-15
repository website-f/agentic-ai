#!/usr/bin/env node
/**
 * Release list (A3, Fauzan 11 Nov 2026: install all 25 database parts). Builds a DISPOSABLE localhost database, installs
 * the base schema and every release module in manifest order, and records what each module adds to the catalogue
 * (tables with row security and app-role rights, columns, constraints, policies, functions, triggers), with a hash of
 * each policy's expressions and roles, each constraint, function and trigger definition (Fauzan's audit of 4b708ae, P1).
 * Names and definitions only, never data. Writes apps/api/src/release-module-fingerprints.ts, which the read-only release check compares against.
 *   DATABASE_URL=postgres://postgres:<pw>@localhost:5432/postgres node scripts/release-module-fingerprints.cjs [--check]
 * --check fails when the committed file differs (CI). Never point this at staging or live data.
 */
const {Client}=require('pg');const {readFileSync,writeFileSync}=require('node:fs');const {resolve}=require('node:path');
const ROOT=resolve(__dirname,'..');const base=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/postgres';
if(!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(base).hostname))throw Error('Disposable localhost database required');
const DB='prima_release_fingerprints',OWNER='prima_release_fp_owner';
const url=(role)=>{const u=new URL(base);u.pathname='/'+DB;if(role){u.username=role;u.password='local-test-only';}return u.toString();};
const manifest=JSON.parse(readFileSync(resolve(ROOT,'db/release-manifest.json'),'utf8'));
const OUT=resolve(ROOT,'apps/api/src/release-module-fingerprints.ts');
// The modules with their own reviewed readiness checks keep them; every other module gets a fingerprint.
// Agentic Office: item_register_v2 (the office's QR item register part two, P85) has its own readiness check too; it
// changes item_register entries (both hand-checked, so no fingerprint is split).
const DEDICATED=new Set(['procurement','rental_corrections','cleanup','metrics','job_email','item_register','item_register_v2','central_admin_walls','central_admin_panel','central_admin_delegations','central_admin_legal_holds']);
const Q=`
SELECT 'table:'||c.relname AS k, concat_ws(',', 'kind='||c.relkind::text, 'rls='||c.relrowsecurity::text, 'force='||c.relforcerowsecurity::text,
  'app='||concat(CASE WHEN has_table_privilege('prima_app',c.oid,'SELECT') THEN 'S' END, CASE WHEN has_table_privilege('prima_app',c.oid,'INSERT') THEN 'I' END,
  CASE WHEN has_table_privilege('prima_app',c.oid,'UPDATE') THEN 'U' END, CASE WHEN has_table_privilege('prima_app',c.oid,'DELETE') THEN 'D' END)) AS v
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind IN ('r','p','v','m')
UNION ALL SELECT 'column:'||c.relname||'.'||a.attname, format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
UNION ALL SELECT 'constraint:'||c.relname||'.'||k.conname, k.contype::text||',def='||md5(pg_get_constraintdef(k.oid)) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima'
UNION ALL SELECT 'policy:'||c.relname||'.'||p.polname, p.polcmd::text||','||CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END
  ||',roles='||coalesce((SELECT string_agg(CASE WHEN r=0 THEN 'public' WHEN r=c.relowner THEN 'table-owner' ELSE pg_get_userbyid(r)::text END,'+' ORDER BY 1) FROM unnest(p.polroles) r),'')
  ||',using='||coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'none')||',check='||coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'none')
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima'
UNION ALL SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', 'definer='||p.prosecdef::text||',app='||has_function_privilege('prima_app',p.oid,'EXECUTE')::text
  ||',def='||CASE WHEN p.prokind IN ('f','p') THEN md5(pg_get_functiondef(p.oid)) ELSE p.prokind::text END FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima'
UNION ALL SELECT 'trigger:'||c.relname||'.'||t.tgname, 'enabled='||(t.tgenabled IN ('O','A'))::text||',def='||md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND NOT t.tgisinternal`;
const snap=async(c)=>new Map((await c.query(Q)).rows.map(r=>[r.k,r.v]));
(async()=>{
 const admin=new Client({connectionString:base});await admin.connect();
 try{await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
  if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount)await admin.query('CREATE ROLE prima_app NOLOGIN');
  if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[OWNER])).rowCount)await admin.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD 'local-test-only'`);
  await admin.query(`GRANT prima_app TO ${OWNER}`);await admin.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);}finally{await admin.end();}
 const c=new Client({connectionString:url(OWNER)});await c.connect();const owners=new Map(),fp={};
 try{
  await c.query(readFileSync(resolve(ROOT,manifest.base.path),'utf8'));let before=await snap(c);
  for(const m of manifest.modules){await c.query(readFileSync(resolve(ROOT,m.path),'utf8'));const after=await snap(c);
   for(const [k,v] of after){if(!before.has(k))owners.set(k,m.id);else if(before.get(k)!==v&&owners.has(k)&&owners.get(k)!==m.id&&!(DEDICATED.has(m.id)&&DEDICATED.has(owners.get(k))))throw Error(`${m.id} changes ${k} owned by ${owners.get(k)}; split the fingerprint by hand`);}
   for(const k of before.keys())if(!after.has(k)&&owners.has(k))throw Error(`${m.id} removes ${k} owned by ${owners.get(k)}`);
   before=after;}
  for(const m of manifest.modules)if(!DEDICATED.has(m.id))fp[m.id]=Object.fromEntries([...owners].filter(([,id])=>id===m.id).map(([k])=>[k,before.get(k)]).sort(([a],[b])=>a<b?-1:1));
 }finally{await c.end();const a=new Client({connectionString:base});await a.connect();try{await a.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);}finally{await a.end();}}
 for(const [id,f] of Object.entries(fp))if(!Object.keys(f).some(k=>k.startsWith('table:')||k.startsWith('policy:')))throw Error(`${id} adds no table or policy; it cannot be detected`);
 const text=`// GENERATED by scripts/release-module-fingerprints.cjs from db/release-manifest.json on a disposable local database.\n// Do not edit by hand. Names and catalogue properties only, never data.\nexport const FINGERPRINT_QUERY = ${JSON.stringify(Q.trim())};\nexport const MODULE_FINGERPRINTS: Record<string, Record<string, string>> = ${JSON.stringify(fp,null,1)};\n`;
 if(process.argv.includes('--check')){if(readFileSync(OUT,'utf8')!==text){console.error('release-module-fingerprints.ts is out of date: run node scripts/release-module-fingerprints.cjs');process.exitCode=1;}else console.log('fingerprints match');}
 else{writeFileSync(OUT,text);console.log(`wrote ${Object.keys(fp).length} module fingerprints`);}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
