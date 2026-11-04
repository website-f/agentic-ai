import {createHash} from 'node:crypto';
import {migrationSql} from '../src/schema';
import assert from 'node:assert/strict';
import {it} from 'node:test';
import {itManualProblems,IT_MANUAL_FUNCTION_PINS} from '../src/it-manual-readiness';
function fixture(){
 const tables=['it_onboarding','it_accounts','it_assets','it_manual_receipts'];
 const rel=tables.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true,relowner:123,owns:false,sel:true,ins:true,upd:relname!=='it_manual_receipts',del:false,trunc:false}));
 const functions=Object.entries(IT_MANUAL_FUNCTION_PINS).map(([proname,hash])=>({proname,hash,prosecdef:false,public_exec:false,proconfig:['search_path=pg_catalog, prima']}));
 const policies=tables.flatMap(relname=>{const receipt=relname==='it_manual_receipts';const read=receipt?"data->>'userId'=current_setting('app.user_id',true)ANDprima.it_record_permission('manual')":`prima.it_record_permission('${relname==='it_assets'?'asset_read':'read'}')`;const write=receipt?read:"prima.it_record_permission('write')";const update=write+(relname==='it_accounts'?"ORprima.it_record_permission('ceo')":'');return (receipt?[
 ['it_manual_owner','r',read,null,0],['it_manual_insert','a',null,write,0],['it_manual_setup','*','true','true',123]
 ]:[['it_register_read','r',read,null,0],['it_register_insert','a',null,write,0],['it_register_update','w',update,update,0],['it_register_setup','*','true','true',123]]).map(([polname,polcmd,qual,chk,role])=>({relname,polname,polcmd,qual,chk,polroles:[role],polpermissive:true}));});
 const triggers=tables.slice(0,3).map(relname=>({relname,tgenabled:'O',tgtype:23,proname:'it_register_guard',exact_function:true}));
 const checks=[{conname:'it_manual_receipt_shape',convalidated:true,expr:'prima.it_manual_receipt_valid(id,data)'}];
 const columns=tables.flatMap(relname=>[{relname,attname:'id',type:'text',attnotnull:true},{relname,attname:'data',type:'jsonb',attnotnull:true}]);const keys=tables.map(relname=>({relname,convalidated:true,definition:'PRIMARY KEY (id)'}));
 const rows=[rel,[{rolsuper:false,rolbypassrls:false}],functions,policies,triggers,checks,columns,keys];return rows;
}
async function run(rows:any[][]){let i=0;return itManualProblems({query:async(sql:string)=>({rows:sql.includes("it_cleanup_%")?[{present:false}]:rows[i++]})} as never);}
it('synthetic reviewed catalog is ready; not evidence of live SQL execution',async()=>assert.deepEqual(await run(fixture()),[]));
for(const [name,mutate] of [
 ['missing table',(r:any[][])=>r[0].pop()],['disabled FORCE RLS',(r:any[][])=>r[0][0].relforcerowsecurity=false],['receipt UPDATE grant',(r:any[][])=>r[0][3].upd=true],['bypass role',(r:any[][])=>r[1][0].rolbypassrls=true],['function changed',(r:any[][])=>r[2][0].hash='wrong'],['public function execution',(r:any[][])=>r[2][0].public_exec=true],['loose policy',(r:any[][])=>r[3][0].qual+=' OR true'],['missing per-table guard',(r:any[][])=>r[4][1].relname=r[4][0].relname],['wrong function identity',(r:any[][])=>r[4][0].exact_function=false],['unvalidated receipt shape',(r:any[][])=>r[5][0].convalidated=false],['nullable receipt data',(r:any[][])=>r[6][7].attnotnull=false],['missing unique receipt ID',(r:any[][])=>r[7].pop()]
] as const)it('fails closed: '+name,async()=>{const f=fixture();mutate(f);assert.notDeepEqual(await run(f),[]);});
it('query errors expose only a fixed unavailable code',async()=>{assert.deepEqual(await itManualProblems({query:async()=>{throw Error('synthetic private DB message');}} as never),['CLEANUP_SCHEMA_UNAVAILABLE']);});

it('onboarding CASE inside PL/pgSQL IF is parenthesized and exact guarded function stays pinned',()=>{const sql=migrationSql();const body=sql.match(/CREATE OR REPLACE FUNCTION prima\.it_register_guard\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];assert.ok(body);assert.match(body,/NEW\.data->'steps' IS DISTINCT FROM\s*\(CASE WHEN NEW\.data->>'kind'='join' THEN/);assert.match(body,/::jsonb END\) THEN\s*RAISE EXCEPTION 'New intake starts/);assert.equal(createHash('md5').update(body).digest('hex'),IT_MANUAL_FUNCTION_PINS.it_register_guard);});
