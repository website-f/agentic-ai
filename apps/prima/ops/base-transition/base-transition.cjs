'use strict';
// LOCAL CANDIDATE ONLY. Explicit caller execution; never startup, never seed/login provisioning.
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const OLD='678910162fcf0d878b128df61d291f4742c836b4846c36519e8d9c934598071b';
const HOST='psql-prima-staging-sea.postgres.database.azure.com';
const NEXT='4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
class Refusal extends Error{constructor(code){super(code);this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new Refusal(code);};
function sourceModel(sql){
 const tables=new Map(),tableDefs=new Map();
 for(const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS prima\.([a-z_]+)\s*\(([\s\S]*?)\);/g)){
  const cols=[...m[2].matchAll(/\b(id|data|company_id|seq|migration_sha256|applied_at)\s+(text|jsonb|bigint|int|timestamptz)\b([^,\n]*)/g)].map(x=>({name:x[1],type:({int:'integer',timestamptz:'timestamp with time zone'})[x[2]]||x[2],notnull:/\b(PRIMARY KEY|NOT NULL)\b/.test(x[3])}));tables.set(m[1],cols);tableDefs.set(m[1],m[2]);
 }
 const tenant=sql.match(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/);
 need(tenant,'SOURCE_MODEL_INVALID');
 const tenantNames=[...tenant[1].matchAll(/'([a-z_]+)'/g)].map(m=>m[1]);
 for(const name of tenantNames)tables.set(name,[{name:'id',type:'text',notnull:true},{name:'company_id',type:'text',notnull:true},{name:'data',type:'jsonb',notnull:true}]);
 const policyRules=[...sql.matchAll(/CREATE POLICY ([a-z_]+) ON prima\.([a-z_]+)([\s\S]*?);/g)].map(m=>({name:m[2]+'.'+m[1],body:m[3]}));
 for(const name of tenantNames)tableDefs.set(name,"id text PRIMARY KEY,company_id text NOT NULL,data jsonb NOT NULL,CHECK (data->>'id'=id),CHECK (data->>'companyId'=company_id)");
 const policies=policyRules.map(r=>r.name);
 for(const t of tenantNames){policies.push(t+'.company_wall');policyRules.push({name:t+'.company_wall',body:' USING (company_id = ANY (prima.visible_companies())) WITH CHECK (company_id = ANY (prima.visible_companies()))'});}
 const funcs=[...sql.matchAll(/CREATE OR REPLACE FUNCTION prima\.([a-z_]+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].map(m=>({name:m[1],hash:md5(m[2])}));
 const rls=new Set([...tenantNames,...[...sql.matchAll(/ALTER TABLE prima\.([a-z_]+) ENABLE ROW LEVEL SECURITY/g)].map(m=>m[1])]);
 const grants=new Map([...tables.keys()].map(t=>[t,new Set()]));for(const t of tenantNames)for(const k of ['SELECT','INSERT','UPDATE'])grants.get(t).add(k);for(const m of sql.matchAll(/GRANT ([A-Z, ]+) ON (prima\.[^;]+?) TO prima_app;/g)){if(m[2].includes('(')||m[2].includes('%'))continue;for(const t of m[2].split(',').map(x=>x.trim().replace(/^prima\./,'')))for(const k of m[1].split(',').map(x=>x.trim())){need(grants.has(t),'SOURCE_GRANT_INVALID');grants.get(t).add(k);}}
 return{tables,tableDefs,tenantNames,grants,policies:policies.sort(),funcs,rls,policyRules:policyRules.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=a=>[...a].sort();
async function rows(c,tag,sql,args=[]){return(await c.query(`/* ${tag} */ ${sql}`,args)).rows;}
async function catalog(c,model,owner){
 const ts=await rows(c,'tables',`SELECT c.relname AS name,c.relkind,NOT c.relispartition AND c.relpersistence='p' AS ordinary,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname COLLATE "C"`);
 need(same(ts.map(r=>r.name),sorted(model.tables.keys()))&&ts.every(r=>r.relkind==='r'&&r.ordinary===true&&r.owner===owner&&r.rls===model.rls.has(r.name)&&r.forced===model.rls.has(r.name)),'OLD_TABLE_OR_OWNER_DRIFT');
 for(const t of ['users','grants','it_rental_bills'])need(ts.find(r=>r.name===t)?.rls===false&&ts.find(r=>r.name===t)?.forced===false,'COMPLETE_DATA_VISIBILITY_UNKNOWN');
 const cs=await rows(c,'columns',`SELECT c.relname AS tbl,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS notnull,coalesce(cardinality(a.attacl),0)=0 AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='' AND a.attcollation=(SELECT typcollation FROM pg_type WHERE oid=a.atttypid) AS plain FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 need(cs.every(r=>r.plain===true),'OLD_COLUMN_BEHAVIOUR_DRIFT');
 for(const [name,expected]of model.tables)need(same(cs.filter(r=>r.tbl===name).map(({tbl,plain,...r})=>r),expected),'OLD_COLUMN_DRIFT');
 const ps=await rows(c,'policies',`SELECT c.relname||'.'||p.polname AS name,p.polpermissive AS permissive,p.polroles=ARRAY[0::oid] AS public_role FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' ORDER BY (c.relname||'.'||p.polname) COLLATE "C"`);
 need(same(ps.map(r=>r.name),model.policies)&&ps.every(r=>r.permissive&&r.public_role),'OLD_POLICY_DRIFT');
 const fs=await rows(c,'functions',`SELECT p.proname AS name,md5(p.prosrc) AS hash,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' ORDER BY p.proname COLLATE "C",p.oid`);
 need(same(fs.map(({owner,...r})=>r),[...model.funcs].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0))&&fs.every(r=>r.owner===owner),'OLD_FUNCTION_DRIFT');
 const tr=await rows(c,'triggers',`SELECT c.relname AS tbl,t.tgname AS name,p.proname AS fn,nf.nspname AS ns,t.tgtype,t.tgenabled,t.tgqual IS NULL AS unconditional,t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr::text='' AS plain FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname='prima' AND NOT t.tgisinternal`);
 need(tr.length===1&&tr[0].tbl==='audit'&&tr[0].name==='audit_no_update'&&tr[0].fn==='audit_no_change'&&tr[0].ns==='prima'&&tr[0].tgtype===27&&tr[0].tgenabled==='O'&&tr[0].unconditional&&tr[0].plain,'OLD_TRIGGER_DRIFT');
 const stampSafety=await rows(c,'stamp_safety',`SELECT (SELECT count(*)=2 AND bool_and(convalidated AND ((contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)') OR (contype='c' AND pg_get_constraintdef(oid)='CHECK ((id = 1))'))) FROM pg_constraint WHERE conrelid='prima.schema_info'::regclass) AS constraints_ok,(SELECT count(*)=1 AND bool_and(indisprimary AND indisunique AND indisvalid AND indexprs IS NULL AND indpred IS NULL AND indnkeyatts=1 AND indkey::text='1') FROM pg_index WHERE indrelid='prima.schema_info'::regclass) AS indexes_ok`);
 need(stampSafety.length===1&&stampSafety[0].constraints_ok===true&&stampSafety[0].indexes_ok===true,'SCHEMA_STAMP_CATALOG_DRIFT');
 const hazards=await rows(c,'hazards',`SELECT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') AS events,EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima') AS rules,EXISTS(SELECT 1 FROM pg_inherits i JOIN pg_class child ON child.oid=i.inhrelid JOIN pg_class parent ON parent.oid=i.inhparent WHERE child.relnamespace='prima'::regnamespace OR parent.relnamespace='prima'::regnamespace) AS inheritance`);
 need(hazards.length===1&&!hazards[0].events&&!hazards[0].rules&&!hazards[0].inheritance,'UNREVIEWED_DATABASE_HOOK');
}


function verifyReadinessBytes(){const manifest=fs.readFileSync(path.join(__dirname,'readiness-manifest.json'));need(sha(manifest)==='294f46e3a469639265e9791d7dcb03ef9d06913dd72ba539b2edabc4565287cb','READINESS_ARTIFACT_MISMATCH');for(const f of JSON.parse(manifest).files){const p=path.join(__dirname,f.path);need(!fs.lstatSync(p).isSymbolicLink()&&sha(fs.readFileSync(p))===f.sha256,'READINESS_ARTIFACT_MISMATCH');}}
const indexNorm=s=>String(s??'').replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|::text|[\s()]/g,t=>t.startsWith("'")||t.startsWith('"')?t:'');
async function verifyOldStructures(c,model,owner){
 const names=sorted(model.tables.keys());
 for(let i=0;i<names.length;i++)await c.query(`CREATE TEMP TABLE prima_base_shape_${i} (${model.tableDefs.get(names[i])}) ON COMMIT DROP`);
 const expected=await rows(c,'expected_constraints',`SELECT c.relname AS tbl,p.contype AS type,pg_get_constraintdef(p.oid) AS definition,p.convalidated AS valid,p.condeferrable AS deferrable,p.condeferred AS deferred FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid WHERE c.relnamespace=pg_my_temp_schema() AND c.relname=ANY($1)`,[names.map((_,i)=>'prima_base_shape_'+i)]);
 const actual=await rows(c,'actual_constraints',`SELECT c.relname AS tbl,p.contype AS type,pg_get_constraintdef(p.oid) AS definition,p.convalidated AS valid,p.condeferrable AS deferrable,p.condeferred AS deferred FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima'`);
 const canon=rs=>rs.map(r=>JSON.stringify(r)).sort();
 need(expected.length>=names.length&&same(canon(actual),canon(expected.map(r=>({...r,tbl:names[Number(r.tbl.replace('prima_base_shape_',''))]})))),'OLD_CONSTRAINT_DRIFT');
 const indexes=await rows(c,'old_indexes',`SELECT c.relname AS tbl,k.relname AS name,am.amname AS method,i.indisprimary AS primary,i.indisunique AS unique,i.indnullsnotdistinct AS nulls_not_distinct,i.indoption::text AS options,i.indcollation::text AS collations,(SELECT typcollation::text FROM pg_type WHERE oid='text'::regtype) AS text_collation,i.indisvalid AND i.indisready AS valid,pg_get_expr(i.indpred,i.indrelid) AS predicate,i.indnatts=i.indnkeyatts AS no_include,ARRAY(SELECT CASE WHEN q.attnum>0 THEN a.attname ELSE pg_get_indexdef(i.indexrelid,q.ord::int,true) END FROM unnest(i.indkey::smallint[]) WITH ORDINALITY q(attnum,ord) LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=q.attnum WHERE q.ord<=i.indnkeyatts ORDER BY q.ord) AS keys,ARRAY(SELECT oc.opcname::text FROM unnest(i.indclass::oid[]) WITH ORDINALITY q(oid,n) JOIN pg_opclass oc ON oc.oid=q.oid ORDER BY q.n) AS classes FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class k ON k.oid=i.indexrelid JOIN pg_am am ON am.oid=k.relam WHERE n.nspname='prima'`);
 const want=new Map();for(const t of names)want.set(t+'_pkey',{tbl:t,method:'btree',primary:true,unique:true,keys:[t==='audit'?'seq':'id'],classes:[t==='audit'?'int8_ops':t==='schema_info'?'int4_ops':'text_ops']});
 for(const t of model.tenantNames){want.set(t+'_company_idx',{tbl:t,method:'btree',primary:false,unique:false,keys:['company_id'],classes:['text_ops']});want.set(t+'_data_idx',{tbl:t,method:'gin',primary:false,unique:false,keys:['data'],classes:['jsonb_path_ops']});}
 for(const [name,t,keys]of [['shifts_site_date_idx','shifts',["data->>'siteId'","data->>'date'"]],['shifts_person_idx','shifts',["data->>'personId'"]],['attendance_person_idx','attendance',["data->>'personId'"]]])want.set(name,{tbl:t,method:'btree',primary:false,unique:false,keys,classes:keys.map(()=> 'text_ops')});
 need(indexes.length===want.size,'OLD_INDEX_DRIFT');for(const r of indexes){const e=want.get(r.name);need(e&&r.valid&&!r.nulls_not_distinct&&r.options===e.keys.map(()=> '0').join(' ')&&r.collations===e.classes.map(c=>c==='text_ops'?r.text_collation:'0').join(' ')&&r.no_include&&r.predicate===null&&r.tbl===e.tbl&&r.method===e.method&&r.primary===e.primary&&r.unique===e.unique&&same(r.keys.map(indexNorm),e.keys.map(indexNorm))&&same(r.classes,e.classes),'OLD_INDEX_DRIFT');}
 const acls=await rows(c,'table_acl',`SELECT c.relname AS tbl,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='prima' AND c.relkind='r'`);
 const app=new Map(names.map(t=>[t,[]])),api=[];
 for(const a of acls){need(model.tables.has(a.tbl),'OLD_ACL_DRIFT');if(a.grantee===owner)continue;need(!a.grantable,'OLD_ACL_DRIFT');if(a.grantee==='prima_app')app.get(a.tbl).push(a.privilege);else if(a.grantee==='prima_api'&&a.privilege==='SELECT'&&['users','grants','schema_info'].includes(a.tbl))api.push(a.tbl);else need(false,'OLD_ACL_DRIFT');}
 for(const t of names)need(same(sorted(app.get(t)),sorted(model.grants.get(t))),'OLD_ACL_DRIFT');need(same(sorted(api),['grants','schema_info','users']),'OLD_API_READ_GRANT_DRIFT');
}

async function verifyPolicyExpressions(c,model){
 // Let PostgreSQL deparse both exact expressions. Never erase parentheses/literals to fake equality.
 need((await rows(c,'temp_free',"SELECT to_regclass('pg_temp.prima_base_policy_expected') IS NULL AS free"))[0]?.free===true,'TEMP_CONTEXT_NOT_FRESH');
 await c.query('CREATE TEMP TABLE prima_base_policy_expected(id text,company_id text,data jsonb) ON COMMIT DROP');
 for(let i=0;i<model.policyRules.length;i++)await c.query(`CREATE POLICY p${i} ON pg_temp.prima_base_policy_expected ${model.policyRules[i].body}`);
 const expected=await rows(c,'expected_policy_expr',`SELECT polname AS name,polcmd AS cmd,pg_get_expr(polqual,polrelid) AS qual,pg_get_expr(polwithcheck,polrelid) AS chk FROM pg_policy WHERE polrelid='pg_temp.prima_base_policy_expected'::regclass`);
 const actual=await rows(c,'actual_policy_expr',`SELECT c.relname||'.'||p.polname AS name,p.polcmd AS cmd,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS chk FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima'`);
 need(expected.length===model.policyRules.length&&actual.length===model.policyRules.length,'OLD_POLICY_EXPRESSION_DRIFT');
 for(let i=0;i<model.policyRules.length;i++){const a=actual.find(r=>r.name===model.policyRules[i].name),e=expected.find(r=>r.name===`p${i}`);need(a&&e&&a.cmd===e.cmd&&a.qual===e.qual&&a.chk===e.chk,'OLD_POLICY_EXPRESSION_DRIFT');}
}
async function verifyOldFunctions(c,owner){
 const list=await rows(c,'function_attributes',`SELECT p.proname AS name,l.lanname AS lang,p.prosecdef AS definer,p.proconfig AS config,p.provolatile AS volatility,p.proisstrict AS strict,p.proleakproof AS leakproof,p.proretset AS retset,p.prokind,p.proparallel,p.pronargs,p.proargtypes::text AS inputs,p.proargnames AS argnames,p.proargmodes::text[] AS modes,p.proallargtypes::text[] AS alltypes,pg_get_function_result(p.oid) AS result,p.prosupport=0 AS no_support,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,has_function_privilege('prima_app',p.oid,'EXECUTE') AS app_execute,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN (0,p.proowner,(SELECT oid FROM pg_roles WHERE rolname='prima_app')) OR a.privilege_type<>'EXECUTE' OR (a.grantee<>p.proowner AND a.is_grantable)) AS acl_exact FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='prima'`);
 need(list.length===3,'OLD_FUNCTION_ATTRIBUTES_DRIFT');
 for(const r of list){const head=r.name==='audit_head',visible=r.name==='visible_companies';need(r.lang===(visible?'sql':'plpgsql')&&r.definer===head&&same(r.config,head?['search_path=prima, pg_temp']:null)&&r.volatility===(visible?'s':'v')&&!r.strict&&!r.leakproof&&!r.retset&&r.prokind==='f'&&r.proparallel==='u'&&r.pronargs===0&&r.inputs===''&&same(r.argnames,head?['seq','hash']:null)&&same(r.modes,head?['o','o']:null)&&same(r.alltypes,head?['20','25']:null)&&r.result===(head?'record':visible?'text[]':'trigger')&&r.no_support&&r.public_execute===!head&&r.app_execute&&r.acl_exact,'OLD_FUNCTION_ATTRIBUTES_DRIFT');}
}

async function snapshot(c,table,key){const size=(await rows(c,'size_'+table,`SELECT count(*)::text AS n,coalesce(sum(octet_length(row_to_json(t)::text)),0)::text AS bytes FROM prima.${table} t`))[0];need(size&&Number(size.n)<=100000&&Number(size.bytes)<=67108864,'PRESERVATION_SNAPSHOT_LIMIT');return(await rows(c,'snapshot_'+table,`SELECT count(*)::text AS n,encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY ${key}),''),'UTF8')),'hex') AS fingerprint FROM prima.${table} t`))[0];}
async function migrateBase(c,input,source){
 let begun=false,commitSent=false,stage='validate';
 try{
  need(input?.confirm==='MIGRATE_EXACT_BASE_ONLY'&&input.oldSha===OLD&&input.newSha===NEXT&&typeof input.expectedOwner==='string'&&/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(input.expectedOwner),'CONFIRMATION_REQUIRED');
  need(c?.connectionParameters?.host===HOST&&Number(c.connectionParameters.port)===5432&&c.connectionParameters.database==='appdb'&&c.connectionParameters.user===input.expectedOwner,'CONNECTION_TARGET_MISMATCH');
  need(c.connection?.stream?.encrypted===true&&c.connection.stream.authorized===true,'VERIFIED_TLS_REQUIRED');
  verifyReadinessBytes();
  need(sha(source?.old||'')===OLD&&sha(source?.next||'')===NEXT,'SOURCE_HASH_MISMATCH');
  const model=sourceModel(source.old);need(model.tables.size>100&&model.funcs.length===3,'SOURCE_MODEL_INVALID');
  const body=source.next.replace(/^([\s\S]*?)\bBEGIN;/,(_,prefix)=>prefix).replace(/\bCOMMIT;\s*$/,'');
  need(body!==source.next&&!/\bCOMMIT;\s*$/.test(body),'SOURCE_TRANSACTION_INVALID');
  await c.query('BEGIN');begun=true;stage='precheck';
  await c.query("SET LOCAL search_path=pg_catalog");await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='60s'");
  await c.query("SELECT pg_advisory_xact_lock(hashtext('prima-reviewed-base-transition'))");
  await c.query('SELECT pg_advisory_xact_lock(4177001)');
  const owner=await rows(c,'owner',`SELECT current_database()='appdb' AS db_ok,current_user=session_user AS session_ok,current_user=$1 AS expected,NOT r.rolsuper AND NOT r.rolbypassrls AS restricted,n.nspowner=r.oid AS owns,NOT pg_has_role('prima_app',r.oid,'MEMBER') AND NOT pg_has_role('prima_api',r.oid,'MEMBER') AS isolated,pg_has_role('prima_api','prima_app','MEMBER') AS api_app_membership FROM pg_roles r JOIN pg_namespace n ON n.nspname='prima' WHERE r.rolname=current_user`,[input.expectedOwner]);
  need(owner.length===1&&Object.values(owner[0]).every(v=>v===true),'OWNER_OR_TARGET_MISMATCH');
  const schemaAcl=await rows(c,'schema_acl',`SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='prima'`);
  const exposed=schemaAcl.filter(r=>r.grantee!==input.expectedOwner);need(exposed.length===2&&exposed.every(r=>['prima_app','prima_api'].includes(r.grantee)&&r.privilege==='USAGE'&&!r.grantable)&&new Set(exposed.map(r=>r.grantee)).size===2,'SCHEMA_ACL_DRIFT');
  const createRights=await rows(c,'schema_create',`SELECT has_schema_privilege('prima_app','prima','CREATE') OR has_schema_privilege('prima_api','prima','CREATE') AS unsafe`);need(createRights.length===1&&createRights[0].unsafe===false,'SCHEMA_CREATE_DRIFT');
  const defaults=await rows(c,'default_acl',`SELECT EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND defaclnamespace IN (0,'prima'::regnamespace::oid)) AS present`);need(defaults.length===1&&defaults[0].present===false,'DEFAULT_PRIVILEGES_UNREVIEWED');

  const roles=await rows(c,'roles',`SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolcanlogin FROM pg_roles WHERE rolname IN ('prima_app','prima_api') ORDER BY rolname`);
  need(roles.length===2&&roles.every(r=>!r.rolsuper&&!r.rolbypassrls&&!r.rolcreaterole&&!r.rolcreatedb)&&roles.find(r=>r.rolname==='prima_app')?.rolcanlogin===false&&roles.find(r=>r.rolname==='prima_api')?.rolcanlogin===true,'APPLICATION_ROLE_DRIFT');
  await catalog(c,model,input.expectedOwner);
  // Hardcoded source-derived identifiers only. Locks block all old application writes for the transaction.
  await c.query('LOCK TABLE '+sorted(model.tables.keys()).map(t=>'prima."'+t+'"').join(',')+' IN ACCESS EXCLUSIVE MODE');
  await catalog(c,model,input.expectedOwner);
  const base=await rows(c,'base','SELECT id,migration_sha256 FROM prima.schema_info');need(base.length===1&&base[0].id===1&&base[0].migration_sha256===OLD,'BASE_HASH_MISMATCH');
  await verifyOldStructures(c,model,input.expectedOwner);
  await verifyPolicyExpressions(c,model);
  await verifyOldFunctions(c,input.expectedOwner);
  const bills=await rows(c,'bills',`SELECT (SELECT count(*)::text FROM (SELECT data->>'companyId',data->>'period' FROM prima.it_rental_bills WHERE data->>'companyId' IS NOT NULL AND data->>'period' IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) q) AS duplicates,(SELECT count(*)::text FROM prima.it_rental_bills WHERE jsonb_typeof(data)<>'object' OR jsonb_typeof(data->'companyId') IS DISTINCT FROM 'string' OR jsonb_typeof(data->'period') IS DISTINCT FROM 'string') AS malformed`);
  need(bills.length===1&&bills[0].duplicates==='0'&&bills[0].malformed==='0','RENTAL_DATA_RECONCILIATION_REQUIRED');
  const users=await snapshot(c,'users','id'),grants=await snapshot(c,'grants','id');need(users&&Number(users.n)>0,'EMPTY_USERS_REFUSED');
  // EXACT candidate policy, transaction-local in effect until commit. No new prima_app read right.
  stage='owner_audit_policy';
  const policy="CREATE POLICY audit_owner_read ON prima.audit FOR SELECT TO CURRENT_USER USING (true);";
  need(source.next.includes(policy),'SOURCE_POLICY_MISMATCH');await c.query(policy);
  const visibility=await rows(c,'audit_visibility',`SELECT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='prima.audit'::regclass AND p.polname='audit_owner_read' AND p.polpermissive AND p.polcmd='r' AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname=current_user)] AND pg_get_expr(p.polqual,p.polrelid)='true') AS owner_read,EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='prima.audit'::regclass AND NOT p.polpermissive AND p.polcmd IN ('*','r') AND EXISTS(SELECT 1 FROM unnest(p.polroles) x WHERE x=0 OR pg_has_role(current_user,x,'USAGE'))) AS restricted`);
  need(visibility.length===1&&visibility[0].owner_read&&!visibility[0].restricted,'AUDIT_VISIBILITY_UNPROVEN');const audit=await snapshot(c,'audit','seq');
  stage='apply';await c.query(body);
  const nextModel=sourceModel(source.next);
  const postTables=await rows(c,'post_tables',`SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname COLLATE "C"`);
  need(same(postTables.map(r=>r.name),sorted(nextModel.tables.keys()))&&postTables.every(r=>r.owner===input.expectedOwner&&r.relkind==='r'),'POST_BASE_TABLE_DRIFT');
  const postFunctions=await rows(c,'post_functions',`SELECT p.proname AS name,md5(p.prosrc) AS hash,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' ORDER BY p.proname COLLATE "C",p.oid`);
  need(same(postFunctions.map(({owner,...r})=>r),[...nextModel.funcs].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0))&&postFunctions.every(r=>r.owner===input.expectedOwner),'POST_BASE_FUNCTION_DRIFT');

  const postCodes=[...await require('./candidate-readiness-js/it-manual-readiness').itManualProblems(c),...await require('./candidate-readiness-js/it-operations-readiness').itOperationsProblems(c),...await require('./candidate-readiness-js/hr-it-readiness').hrItProblems(c)];need(postCodes.length===0,'POST_BASE_CATALOG_NOT_READY');
  stage='preservation';need(same(users,await snapshot(c,'users','id'))&&same(grants,await snapshot(c,'grants','id'))&&same(audit,await snapshot(c,'audit','seq')),'PRESERVATION_MISMATCH');
  const rolesAfter=await rows(c,'roles',`SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolcanlogin FROM pg_roles WHERE rolname IN ('prima_app','prima_api') ORDER BY rolname`);need(same(roles,rolesAfter),'APPLICATION_ROLE_CHANGED');
  const updated=await rows(c,'stamp','UPDATE prima.schema_info SET migration_sha256=$1,applied_at=now() WHERE id=1 AND migration_sha256=$2 RETURNING migration_sha256',[NEXT,OLD]);need(updated.length===1&&updated[0].migration_sha256===NEXT,'SCHEMA_STAMP_FAILED');
  stage='commit';commitSent=true;const commitResult=await c.query('COMMIT');need(commitResult?.command==='COMMIT','COMMIT_NOT_ACKNOWLEDGED');begun=false;
  return{status:'committed',baseSha256:NEXT,preservedUsers:true,preservedGrants:true,preservedAudit:true,modulesInstalled:false,needsCompatibleRelease:true};
 }catch(e){let rolledBack=false;if(begun)try{await c.query('ROLLBACK');rolledBack=true;}catch{}
  return{status:commitSent?'outcome_unconfirmed':begun&&!rolledBack?'rollback_unconfirmed':'refused',stage,code:e instanceof Refusal?e.code:'BASE_TRANSITION_FAILED',automaticRetryAllowed:false};
 }
}
module.exports={migrateBase,sourceModel,OLD,NEXT};
