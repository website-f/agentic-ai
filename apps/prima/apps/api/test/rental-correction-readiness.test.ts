import assert from 'node:assert/strict';
import {it} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {rentalCorrectionProblems,RENTAL_CORRECTION_PINS} from '../src/rental-correction-readiness';
const tables=['it_rental_correction_requests','it_rental_correction_reviews','it_rental_replacements','it_rental_replacement_payments','it_rental_correction_receipts'];
function fixture():any[][]{
 const rel=tables.map(relname=>({relname,relowner:123,relrowsecurity:true,relforcerowsecurity:true,owns:false,sel:true,ins:true,upd:false,del:false,trunc:false}));
 const args:Record<string,string>={rc_hash:'d jsonb',rc_role:'uid text, need text',rc_scope:'uid text, company text',rc_visible:'company text',rc_visible_receipt:'',rc_current:'d jsonb',rc_guard:'',rc_original_payment_guard:''};
 const funcs=Object.entries(RENTAL_CORRECTION_PINS).map(([proname,hash])=>({proname,hash,args:args[proname],proowner:123,prosecdef:proname!=='rc_hash',proconfig:['search_path=pg_catalog, prima'],public_exec:false,runtime_exec:['rc_visible','rc_visible_receipt'].includes(proname)}));
 const pol=tables.flatMap(relname=>{const v=relname==='it_rental_correction_receipts'?"data->>'userId'=current_setting('app.user_id',true) AND prima.rc_visible_receipt()":"prima.rc_visible(data->>'companyId')";return [['rc_read','r',v,null,0],['rc_insert','a',null,v,0],['rc_setup','*','true','true',123]].map(([polname,polcmd,qual,chk,role])=>({relname,polname,polcmd,qual,chk,polroles:[role],polpermissive:true}));});
 const tr=[...tables.map(relname=>({relname,tgname:'rc_guard',tgenabled:'O',tgtype:31,exact_function:true})),{relname:'it_rental_bills',tgname:'rental_original_payment_guard',tgenabled:'O',tgtype:19,exact_function:true}];
 const cols=tables.flatMap(relname=>[{relname,attname:'id',type:'text',attnotnull:true},{relname,attname:'data',type:'jsonb',attnotnull:true}]);
 const keys=tables.map(relname=>({relname,convalidated:true,definition:'PRIMARY KEY (id)'}));
 const ix=[['it_rental_correction_reviews','rental_review_revision',"(data ->> 'requestId'::text), (((data ->> 'revision'::text))::bigint)"],['it_rental_replacements','rental_replacement_original',"(data ->> 'originalId'::text)"],['it_rental_replacements','rental_replacement_request',"(data ->> 'requestId'::text)"],['it_rental_replacement_payments','rental_payment_replacement',"(data ->> 'replacementId'::text)"]].map(([relname,name,expr])=>({relname,name,indisunique:true,indisvalid:true,definition:`CREATE UNIQUE INDEX ${name} ON prima.${relname} USING btree (${expr})`}));
 return[rel,[{rolsuper:false,rolbypassrls:false}],funcs,pol,tr,cols,keys,ix];
}
async function run(rows:any[][]){let i=0;return rentalCorrectionProblems({query:async(sql:string)=>({rows:sql.includes("it_cleanup_%")?[{present:false}]:rows[i++]})} as never);}
it('reviewed synthetic catalog passes, not actual PG proof',async()=>assert.deepEqual(await run(fixture()),[]));
for(const [name,mutate] of [
 ['missing table',(r:any[][])=>r[0].pop()],['owner drift',(r:any[][])=>r[0][0].relowner=999],['RLS off',(r:any[][])=>r[0][0].relforcerowsecurity=false],['runtime owns',(r:any[][])=>r[0][0].owns=true],['mutable evidence',(r:any[][])=>r[0][0].upd=true],['superuser',(r:any[][])=>r[1][0].rolsuper=true],['body drift',(r:any[][])=>r[2][0].hash='wrong'],['overload',(r:any[][])=>r[2].push(r[2][0])],['public exec',(r:any[][])=>r[2][0].public_exec=true],['internal execute leak',(r:any[][])=>r[2][0].runtime_exec=true],['function owner',(r:any[][])=>r[2][0].proowner=999],['unsafe search path',(r:any[][])=>r[2][0].proconfig=[]],['extra policy',(r:any[][])=>r[3].push(r[3][0])],['crossowner receipt',(r:any[][])=>r[3][12].qual='true'],['missing original guard',(r:any[][])=>r[4].pop()],['wrong function oid',(r:any[][])=>r[4][0].exact_function=false],['nullable payload',(r:any[][])=>r[5][1].attnotnull=false],['missing key',(r:any[][])=>r[6].pop()],['missing unique',(r:any[][])=>r[7].pop()],['invalid unique',(r:any[][])=>r[7][0].indisvalid=false]
] as const)it('fails closed '+name,async()=>{const r=fixture();mutate(r);assert.notDeepEqual(await run(r),[]);});
it('sanitized errors',async()=>assert.deepEqual(await rentalCorrectionProblems({query:async()=>{throw Error('secret');}} as never),['CLEANUP_SCHEMA_UNAVAILABLE']));
it('all SQL function body pins match actual module source',()=>{const sql=readFileSync(resolve(process.cwd(),process.cwd().endsWith('/apps/api')?'../../db/modules/rental-correction-v1.sql':'db/modules/rental-correction-v1.sql'),'utf8');for(const [name,pin]of Object.entries(RENTAL_CORRECTION_PINS)){const match=sql.match(new RegExp('CREATE OR REPLACE FUNCTION prima\\.'+name+'\\([^;]*?AS \\$\\$([\\s\\S]*?)\\$\\$;'));assert.ok(match,name);assert.equal(createHash('md5').update(match[1]).digest('hex'),pin,name);}});

it('rental aggregate qualifies derived price to avoid PLpgSQL variable ambiguity',()=>{const sql=readFileSync(resolve(process.cwd(),process.cwd().endsWith('/apps/api')?'../../db/modules/rental-correction-v1.sql':'db/modules/rental-correction-v1.sql'),'utf8');assert.ok(sql.includes("'rate',z.price,'amount',z.price*z.qty"));assert.ok(sql.includes('sum(z.price*z.qty) INTO lines,total'));});
