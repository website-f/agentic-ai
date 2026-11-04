import assert from 'node:assert/strict';
import {it} from 'node:test';
import {itOperationsProblems,IT_OPERATIONS_FUNCTION_PINS} from '../src/it-operations-readiness';
function fixture():any[][]{
 const tables=['it_rental_rates','it_asset_inspections','it_rental_bills','it_operational_receipts'];
 const rel=tables.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true,relowner:123,owns:false,sel:true,ins:true,upd:relname==='it_rental_bills',del:false,trunc:false}));
 const functions=Object.entries(IT_OPERATIONS_FUNCTION_PINS).map(([proname,hash])=>({proname,hash,prosecdef:false,public_exec:false,proconfig:['search_path=pg_catalog, prima']}));
 const policies=tables.flatMap(relname=>{const receipt=relname==='it_operational_receipts';const read=receipt?"data->>'userId'=current_setting('app.user_id',true)ANDprima.it_record_permission('manual')":"prima.it_operations_permission('read')";const write=receipt?read:`prima.it_record_permission('${relname==='it_rental_rates'?'manager':'manual'}')`;return [
 ['it_ops_read','r',read,null,0],['it_ops_insert','a',null,write,0],['it_ops_setup','*','true','true',123],...(relname==='it_rental_bills'?[['it_ops_paid','w',"prima.it_operations_permission('finance')","prima.it_operations_permission('finance')",0]]:[])
 ].map(([polname,polcmd,qual,chk,role])=>({relname,polname,polcmd,qual,chk,polroles:[role],polpermissive:true}));});
 const triggers=tables.map(relname=>({relname,tgenabled:'O',tgtype:23,proname:'it_operations_guard',exact_function:true}));
 const columns=tables.flatMap(relname=>[{relname,attname:'id',type:'text',attnotnull:true},{relname,attname:'data',type:'jsonb',attnotnull:true}]);const keys=tables.map(relname=>({relname,convalidated:true,definition:'PRIMARY KEY (id)'}));
 const indexes=[['it_rental_rates','it_rate_version_unique',"(data ->> 'version'::text)"],['it_asset_inspections','it_inspection_version_unique',"(data ->> 'assetId'::text), (data ->> 'version'::text)"],['it_rental_bills','it_bill_period_unique',"(data ->> 'companyId'::text), (data ->> 'period'::text)"]].map(([relname,name,expr])=>({relname,name,indisunique:true,indisvalid:true,definition:`CREATE UNIQUE INDEX ${name} ON prima.${relname} USING btree (${expr})`}));
 return [rel,[{rolsuper:false,rolbypassrls:false}],functions,policies,triggers,columns,keys,indexes];
}
async function run(rows:any[][]){let i=0;return itOperationsProblems({query:async(sql:string)=>({rows:sql.includes("it_cleanup_%")?[{present:false}]:rows[i++]})} as never);}
it('synthetic reviewed operational catalog passes; not live SQL proof',async()=>assert.deepEqual(await run(fixture()),[]));
for(const [name,mutate] of [
 ['missing table',(r:any[][])=>r[0].pop()],['disabled FORCE',(r:any[][])=>r[0][0].relforcerowsecurity=false],['mutable rates',(r:any[][])=>r[0][0].upd=true],['receipt deletion',(r:any[][])=>r[0][3].del=true],['bypass RLS',(r:any[][])=>r[1][0].rolbypassrls=true],['function drift',(r:any[][])=>r[2][0].hash='bad'],['public execute',(r:any[][])=>r[2][0].public_exec=true],['policy widening',(r:any[][])=>r[3][0].qual+=' OR true'],['missing trigger',(r:any[][])=>r[4].pop()],['wrong trigger table',(r:any[][])=>r[4][1].relname=r[4][0].relname],['nullable data',(r:any[][])=>r[5][1].attnotnull=false],['missing PK',(r:any[][])=>r[6].pop()],['missing unique index',(r:any[][])=>r[7].pop()],['wrong index expression',(r:any[][])=>r[7][0].definition=r[7][0].definition.replace('version','other')],['invalid unique index',(r:any[][])=>r[7][0].indisvalid=false]
] as const)it('fails closed: '+name,async()=>{const f=fixture();mutate(f);assert.notDeepEqual(await run(f),[]);});
it('error output omits database messages',async()=>assert.deepEqual(await itOperationsProblems({query:async()=>{throw Error('private');}} as never),['CLEANUP_SCHEMA_UNAVAILABLE']));

import {RENTAL_CORRECTION_PINS} from '../src/rental-correction-readiness';
const paymentGuard=()=>({relname:'it_rental_bills',tgname:'rental_original_payment_guard',tgenabled:'O',tgtype:19,proname:'rc_original_payment_guard',extra_exact:true,proowner:123,prosecdef:true,proconfig:['search_path=pg_catalog, prima'],hash:RENTAL_CORRECTION_PINS.rc_original_payment_guard});
it('optional rental payment guard is allowed only at exact reviewed boundary',async()=>{const f=fixture();f[4].push(paymentGuard());assert.deepEqual(await run(f),[]);});
for(const patch of [{extra_exact:false},{hash:'wrong'},{proowner:999},{prosecdef:false},{tgtype:23},{proconfig:['search_path=public']},{relname:'it_assets'}])it('rejects changed optional rental guard '+JSON.stringify(patch),async()=>{const f=fixture();f[4].push({...paymentGuard(),...patch});assert.notDeepEqual(await run(f),[]);});
