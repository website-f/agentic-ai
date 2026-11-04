import {cleanupOptionalProblems} from './it-cleanup-readiness';
import {RENTAL_CORRECTION_PINS} from './rental-correction-readiness';
import type { PoolClient } from 'pg';
/** Catalog-only readiness. Never migrates, reads work payloads, or exposes database errors. */
export const IT_OPERATIONS_FUNCTION_PINS: Record<string,string> = {"it_operations_permission": "5259f8a1de8b2495687d0a393cca2b95", "it_operations_guard": "e0b5e287c27d7748d7ddd18abd6b4d1c"};
const norm=(v:unknown)=>String(v??'').replace(/::text/g,'').replace(/[\s()]/g,'');
export async function itOperationsProblems(client: Pick<PoolClient,'query'>):Promise<string[]> {
 try {
 const cleanupProblems=await cleanupOptionalProblems(client); if(cleanupProblems.length)return cleanupProblems;

  const tables=['it_rental_rates','it_asset_inspections','it_rental_bills','it_operational_receipts'];
  const rel=await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner,
    pg_has_role('prima_app',c.relowner,'USAGE') AS owns,
    has_table_privilege('prima_app',c.oid,'SELECT') AS sel,has_table_privilege('prima_app',c.oid,'INSERT') AS ins,
    has_table_privilege('prima_app',c.oid,'UPDATE') AS upd,has_table_privilege('prima_app',c.oid,'DELETE') AS del,
    has_table_privilege('prima_app',c.oid,'TRUNCATE') AS trunc
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`,[tables]);
  if(rel.rows.length!==4||rel.rows.some(r=>!r.relrowsecurity||!r.relforcerowsecurity||r.owns||!r.sel||!r.ins||r.del||r.trunc||r.upd!==(r.relname==='it_rental_bills')))return ['IT_OPERATIONS_TABLE_BOUNDARY'];
  const role=await client.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='prima_app'`);
  if(role.rows.length!==1||role.rows[0].rolsuper||role.rows[0].rolbypassrls)return ['IT_OPERATIONS_ROLE_BOUNDARY'];
  const funcs=await client.query(`SELECT p.proname,md5(p.prosrc) AS hash,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname=ANY($1)`,[Object.keys(IT_OPERATIONS_FUNCTION_PINS)]);
  if(funcs.rows.length!==2||funcs.rows.some(r=>IT_OPERATIONS_FUNCTION_PINS[r.proname]!==r.hash||r.prosecdef||r.public_exec||JSON.stringify(r.proconfig)!==JSON.stringify(['search_path=pg_catalog, prima'])))return ['IT_OPERATIONS_FUNCTION_BOUNDARY'];
  const pol=await client.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS chk
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`,[tables]);
  for(const table of tables){
   const owner=Number(rel.rows.find(r=>r.relname===table)!.relowner);const rows=pol.rows.filter(r=>r.relname===table);const receipt=table==='it_operational_receipts';
   const read=receipt?"data->>'userId'=current_setting('app.user_id',true)ANDprima.it_record_permission('manual')":"prima.it_operations_permission('read')";
   const write=receipt?read:`prima.it_record_permission('${table==='it_rental_rates'?'manager':'manual'}')`;
   const expected:Record<string,[string,string|null,string|null,number]>={it_ops_read:['r',read,null,0],it_ops_insert:['a',null,write,0],it_ops_setup:['*','true','true',owner]};
   if(table==='it_rental_bills')expected.it_ops_paid=['w',"prima.it_operations_permission('finance')","prima.it_operations_permission('finance')",0];
   if(rows.length!==Object.keys(expected).length||rows.some(r=>{const e=expected[r.polname];return !e||r.polcmd!==e[0]||!r.polpermissive||norm(r.qual)!==norm(e[1])||norm(r.chk)!==norm(e[2])||JSON.stringify(r.polroles)!==JSON.stringify([e[3]]);}))return ['IT_OPERATIONS_POLICY_BOUNDARY'];
  }
  const triggers=await client.query(`SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,p.proname,p.proowner,p.prosecdef,p.proconfig,md5(p.prosrc) hash,t.tgfoid=to_regprocedure('prima.rc_original_payment_guard()') extra_exact,t.tgfoid='prima.it_operations_guard()'::regprocedure AS exact_function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='prima' AND c.relname=ANY($1) AND NOT t.tgisinternal`,[tables]);
 triggers.rows=triggers.rows.filter(r=>r.tgname!=='ic_operational_guard');
  const extra=triggers.rows.filter(r=>r.relname==='it_rental_bills'&&r.tgname==='rental_original_payment_guard');
  if(extra.length>1||extra.some(r=>!r.extra_exact||r.proname!=='rc_original_payment_guard'||r.tgenabled!=='O'||r.tgtype!==19||!r.prosecdef||Number(r.proowner)!==Number(rel.rows.find(x=>x.relname==='it_rental_bills')!.relowner)||r.hash!==RENTAL_CORRECTION_PINS.rc_original_payment_guard||JSON.stringify(r.proconfig)!==JSON.stringify(['search_path=pg_catalog, prima'])))return ['IT_OPERATIONS_TRIGGER_BOUNDARY'];
  const base=triggers.rows.filter(r=>!extra.includes(r));
  if(base.length!==4||tables.some(t=>base.filter(r=>r.relname===t).length!==1)||base.some(r=>!r.exact_function||r.tgenabled!=='O'||r.tgtype!==23||r.proname!=='it_operations_guard'))return ['IT_OPERATIONS_TRIGGER_BOUNDARY'];
  const columns=await client.query(`SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped`,[tables]);
  if(columns.rows.length!==8||tables.some(t=>{const a=columns.rows.filter(r=>r.relname===t);return a.length!==2||!a.some(r=>r.attname==='id'&&r.type==='text'&&r.attnotnull)||!a.some(r=>r.attname==='data'&&r.type==='jsonb'&&r.attnotnull);}))return ['IT_OPERATIONS_COLUMN_BOUNDARY'];
  const keys=await client.query(`SELECT c.relname,k.convalidated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND k.contype='p'`,[tables]);
  if(keys.rows.length!==4||tables.some(t=>keys.rows.filter(r=>r.relname===t&&r.convalidated&&norm(r.definition)===norm('PRIMARY KEY (id)')).length!==1))return ['IT_OPERATIONS_IDENTITY_BOUNDARY'];
  const indexes=await client.query(`SELECT c.relname,i.relname AS name,x.indisunique,x.indisvalid,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND i.relname=ANY($1)`,[['it_rate_version_unique','it_inspection_version_unique','it_bill_period_unique']]);
  const expectedIndexes:Record<string,[string,string]>={it_rate_version_unique:['it_rental_rates',"CREATE UNIQUE INDEX it_rate_version_unique ON prima.it_rental_rates USING btree ((data ->> 'version'::text))"],it_inspection_version_unique:['it_asset_inspections',"CREATE UNIQUE INDEX it_inspection_version_unique ON prima.it_asset_inspections USING btree ((data ->> 'assetId'::text), (data ->> 'version'::text))"],it_bill_period_unique:['it_rental_bills',"CREATE UNIQUE INDEX it_bill_period_unique ON prima.it_rental_bills USING btree ((data ->> 'companyId'::text), (data ->> 'period'::text))"]};
  if(indexes.rows.length!==3||indexes.rows.some(r=>{const e=expectedIndexes[r.name];return !e||r.relname!==e[0]||!r.indisunique||!r.indisvalid||norm(r.definition)!==norm(e[1]);}))return ['IT_OPERATIONS_UNIQUENESS_BOUNDARY'];
  return [];
 }catch{return ['IT_OPERATIONS_SCHEMA_UNAVAILABLE'];}
}
