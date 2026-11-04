/** Disposable local PostgreSQL only; never Azure. Full schema applied as a NON-superuser owner. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { before, after, describe, it } from 'node:test';
import { Client, type PoolClient } from 'pg';


import { migrationSql } from '../src/schema';
import { itOperationsProblems } from '../src/it-operations-readiness';
const BASE=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/prima_test';
const root=new URL(BASE);
if(!['localhost','127.0.0.1','::1','[::1]'].includes(root.hostname))throw Error('Manual RLS tests require a disposable localhost database');
const DB='prima_it_operations_rls_test',ADMIN='prima_it_operations_owner_test';
const url=new URL(BASE);url.pathname='/'+DB;url.username=ADMIN;url.password='local-test-only';
async function connect(cs:string){const c=new Client({connectionString:cs});await c.connect();return c;}
async function as<T>(id:string,fn:(c:Client)=>Promise<T>){const c=await connect(url.toString());try{await c.query('BEGIN');await c.query('SET LOCAL ROLE prima_app');await c.query("SELECT set_config('app.user_id',$1,true),set_config('app.company_ids','co-a',true),set_config('app.walls','asset_read,asset_write,act,offboard',true)",[id]);const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}}
const users=[
 {id:'it-a',role:'pwvsb_officer',department:'it',itRole:'executive'},
 {id:'it-b',role:'pwvsb_officer',department:'it',itRole:'executive'},
 {id:'it-lead',role:'pwvsb_officer',department:'it',itRole:'lead'},
 {id:'it-mgr',role:'pwvsb_officer',department:'it',itRole:'manager'},
 {id:'ceo',role:'pwvsb_officer',opsTier:'ceo'},
 {id:'coo',role:'pwvsb_officer',opsTier:'coo'},
 {id:'audit',role:'pwvsb_officer',department:'audit'},
 {id:'hr',role:'pwvsb_officer',department:'hr'},
 {id:'chief',role:'pwvsb_officer',department:'chief_of_staff',leadership:'chief_of_staff'},
 {id:'wrong-it-role',role:'company_manager',department:'it',itRole:'lead'},
 {id:'fd',role:'pwvsb_officer',leadership:'finance_director'},
 {id:'company',role:'company_manager',companyIds:['co-a']},
 {id:'integration',role:'pwvsb_officer',department:'it',itRole:'lead',integration:{kind:'test'}},
 {id:'closed',role:'pwvsb_officer',department:'it',itRole:'lead',accessClosedFrom:'2020-01-01'}
];
const request='11111111-1111-4111-8111-111111111111';
function receipt(userId='it-a',rid=request){return {id:`${userId}:${rid}`,userId,requestId:rid,kind:'system',hash:'a'.repeat(64),outcome:'committed',recordId:'acc',version:1,message:null,at:'2026-11-01T00:00:00Z'};}
async function insertReceipt(c:Client,r=receipt()){return c.query('INSERT INTO prima.it_manual_receipts(id,data) VALUES($1,$2)',[r.id,r]);}
async function update(c:Client,table:string,id:string,patch:object){return c.query(`UPDATE prima.${table} SET data=data || $2::jsonb WHERE id=$1`,[id,JSON.stringify(patch)]);}
describe('rental and inspection PostgreSQL boundaries',()=>{
 before(async()=>{
  const c=await connect(BASE);try{
   await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
   const r=await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[ADMIN]);if(!r.rowCount)await c.query(`CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
   if((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount)await c.query(`GRANT prima_app TO ${ADMIN} WITH ADMIN OPTION`);
   await c.query(`CREATE DATABASE ${DB} OWNER ${ADMIN}`);
  }finally{await c.end();}
  const a=await connect(url.toString());try{
   assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
   await a.query(migrationSql());await a.query(`GRANT prima_app TO ${ADMIN}`);
   await a.query("INSERT INTO prima.companies(id,data) VALUES('co-a','{\"id\":\"co-a\",\"name\":\"Synthetic\"}')");
   for(const u of users)await a.query('INSERT INTO prima.users(id,data) VALUES($1,$2)',[u.id,{...u,name:u.id}]);
   await a.query("INSERT INTO prima.it_jobs(id,data) VALUES('inspection-job','{\"id\":\"inspection-job\",\"assigneeId\":\"it-a\",\"status\":\"todo\"}')");
   for(const [table,row] of [
    ['it_accounts',{id:'acc',name:'Existing system',ownerId:'ceo',owner:'ceo',access:[],reviewedOn:null,mfa:null,masterKeptAt:'',kind:'other',note:''}],
    ['it_onboarding',{id:'join',kind:'join',personName:'Synthetic',jobTitle:'Test',ownerId:'co-a',on:'2026-11-02',ownerStaffId:'it-a',steps:[]}],
    ['it_assets',{id:'phone',tag:'PHONE',serial:'PHONE',model:'Synthetic',kind:'PHONE',ownerId:'co-a',boughtOn:'2026-01-01',status:'in_use',assignedTo:null}],
    ['it_assets',{id:'asset',tag:'TEST',serial:'TEST',model:'Synthetic',kind:'LAPTOP',ownerId:'co-a',boughtOn:'2026-01-01',status:'in_use',assignedTo:null}]
   ] as const)await a.query(`INSERT INTO prima.${table}(id,data) VALUES($1,$2)`,[row.id,row]);
  }finally{await a.end();}
 });
 after(async()=>{const c=await connect(BASE);try{await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);}finally{await c.end();}});
 const now=()=>new Date().toISOString();
 const rate=(id='rate-1',version=1)=>({id,version,effectiveOn:'2026-01-01',currency:'MYR',monthly:{LAPTOP:10,PHONE:20},evidence:'Synthetic approval',note:'No tax or proration',byId:'it-mgr',at:now()});
 const insert=(c:Client,t:string,r:any)=>c.query(`INSERT INTO prima.${t}(id,data) VALUES($1,$2)`,[r.id,r]);
 const inspection=(id='inspection-1',version=1)=>({id,assetId:'asset',jobId:'inspection-job',version,inspectedOn:'2026-01-31',nextDueOn:'2026-07-31',condition:'attention',findings:'Synthetic scratch',evidence:'Synthetic inspection',followUp:'Repair review',byId:'it-a',at:now()});
 it('exact reviewed catalog is ready under restricted app role',async()=>assert.deepEqual(await as('it-a',c=>itOperationsProblems(c)),[]));
 it('only Manager inserts rates; immutable and stale/date/precision guarded',async()=>{
  for(const id of ['it-a','it-lead','ceo','fd','integration'])await assert.rejects(as(id,c=>insert(c,'it_rental_rates',{...rate(),byId:id})));
  await assert.rejects(as('it-mgr',c=>insert(c,'it_rental_rates',{...rate(),monthly:{LAPTOP:1.001}})));
  await assert.rejects(as('it-mgr',c=>insert(c,'it_rental_rates',{...rate(),effectiveOn:'2026-01-02'})));
  assert.equal((await as('it-mgr',c=>insert(c,'it_rental_rates',rate()))).rowCount,1);
  await assert.rejects(as('it-mgr',c=>insert(c,'it_rental_rates',rate('rate-stale'))));
  await assert.rejects(as('it-mgr',c=>update(c,'it_rental_rates','rate-1',{monthly:{LAPTOP:100}})));
 });
 it('inspection requires actual actor, evidence, chronological version and clamped calendar due date',async()=>{
  for(const patch of [{byId:'it-b'},{jobId:'missing-job'},{nextDueOn:'2026-08-01'},{condition:'healthy',evidence:''},{followUp:''},{inspectedOn:'2026-02-30'}])await assert.rejects(as('it-a',c=>insert(c,'it_asset_inspections',{...inspection(),...patch})));
  assert.equal((await as('it-a',c=>insert(c,'it_asset_inspections',inspection()))).rowCount,1);
  await assert.rejects(as('it-a',c=>insert(c,'it_asset_inspections',inspection('stale'))));
  await assert.rejects(as('it-a',c=>update(c,'it_asset_inspections','inspection-1',{condition:'healthy'})));
  assert.equal((await as('it-a',c=>insert(c,'it_asset_inspections',{...inspection('inspection-2',2),inspectedOn:'2026-08-31',nextDueOn:'2027-02-28'}))).rowCount,1);
 });
 const bill=(id='bill-1')=>({id,companyId:'co-a',period:'2026-01',lines:[{kind:'LAPTOP',count:1,rate:10,amount:10}],total:10,invoiceRef:'SYNTHETIC-1',issuedBy:'it-a',issuedAt:now(),paid:null,source:'configured_rates',currency:'MYR',rateId:'rate-1',rateVersion:1,rateEffectiveOn:'2026-01-01',assetSnapshot:[{id:'asset',tag:'TEST',kind:'LAPTOP',ownerId:'co-a',status:'in_use',version:createHash('sha256').update(JSON.stringify(['asset','TEST','LAPTOP','co-a','in_use',null,0])).digest('hex')}],evidence:'Synthetic billing evidence',note:'',requestId:request,createdById:'it-a'});
 it('staff prepare immutable approved-rate bills but cannot record payment',async()=>{
  for(const patch of [{total:11},{paid:{ref:'fake'}},{rateVersion:99},{assetSnapshot:[]},{assetSnapshot:bill().assetSnapshot.map(x=>({...x,version:'0'.repeat(64)}))},{companyId:'co-b'}])await assert.rejects(as('it-a',c=>insert(c,'it_rental_bills',{...bill(),...patch})));
  assert.equal((await as('it-a',c=>insert(c,'it_rental_bills',bill()))).rowCount,1);
  await assert.rejects(as('it-b',c=>insert(c,'it_rental_bills',{...bill('duplicate'),createdById:'it-b',issuedBy:'it-b'})));
  // UPDATE USING excludes non-Finance rows: PostgreSQL correctly returns zero rows rather than throwing.
  assert.equal((await as('it-a',c=>update(c,'it_rental_bills','bill-1',{paid:{by:'it-a',at:now(),ref:'SYNTHETIC'}}))).rowCount,0);
  assert.equal((await as('it-a',c=>c.query("SELECT data->'paid' AS paid FROM prima.it_rental_bills WHERE id='bill-1'"))).rows[0].paid,null);
  await assert.rejects(as('fd',c=>update(c,'it_rental_bills','bill-1',{total:1})));
  assert.equal((await as('fd',c=>update(c,'it_rental_bills','bill-1',{paid:{by:'fd',at:now(),ref:'SYNTHETIC'}}))).rowCount,1);
  await assert.rejects(as('fd',c=>update(c,'it_rental_bills','bill-1',{paid:{by:'fd',at:now(),ref:'SECOND'}})));
 });
 it('mixed-kind billing has canonical line ordering independent of selection order',async()=>{
  const row={...bill('mixed-bill'),period:'2026-02',total:30,assetSnapshot:[{id:'phone',tag:'PHONE',kind:'PHONE',ownerId:'co-a',status:'in_use',version:createHash('sha256').update(JSON.stringify(['phone','PHONE','PHONE','co-a','in_use',null,0])).digest('hex')},...bill().assetSnapshot],lines:[{kind:'LAPTOP',count:1,rate:10,amount:10},{kind:'PHONE',count:1,rate:20,amount:20}]};
  await assert.rejects(as('it-a',c=>insert(c,'it_rental_bills',{...row,lines:[...row.lines].reverse()})));
  assert.equal((await as('it-a',c=>insert(c,'it_rental_bills',row))).rowCount,1);
 });
 it('mixed role and forged company/wall context cannot read operational data',async()=>{
  for(const id of ['hr','chief','company','closed','integration','unknown'])for(const table of ['it_rental_rates','it_asset_inspections','it_rental_bills'])assert.equal((await as(id,c=>c.query(`SELECT id FROM prima.${table}`))).rowCount,0);
 });
 it('owner receipt is immutable, fail closed and transaction rollback leaves no receipt',async()=>{
  const r={...receipt(),kind:'asset_inspection'};
  await as('it-a',c=>insert(c,'it_operational_receipts',r));
  assert.equal((await as('it-b',c=>c.query('SELECT id FROM prima.it_operational_receipts'))).rowCount,0);
  await assert.rejects(as('it-b',c=>insert(c,'it_operational_receipts',r)));
  await assert.rejects(as('it-a',c=>update(c,'it_operational_receipts',r.id,{outcome:'rejected'})));
  const second={...r,requestId:'22222222-2222-4222-8222-222222222222',id:'it-a:22222222-2222-4222-8222-222222222222'};
  await assert.rejects(as('it-a',async c=>{await insert(c,'it_operational_receipts',second);throw Error('Synthetic rollback');}));
  assert.equal((await as('it-a',c=>c.query('SELECT id FROM prima.it_operational_receipts WHERE id=$1',[second.id]))).rowCount,0);
 });
 it('concurrent duplicate rate versions serialize and only one commits',async()=>{
  const outcomes=await Promise.allSettled(['rate-2a','rate-2b'].map(id=>as('it-mgr',c=>insert(c,'it_rental_rates',rate(id,2)))));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 });
 it('inspection holds the asset row through commit against concurrent status changes',async()=>{
  const one=await connect(url.toString()),two=await connect(url.toString());
  try{
   for(const c of [one,two]){await c.query('BEGIN');await c.query('SET LOCAL ROLE prima_app');await c.query("SELECT set_config('app.user_id','it-a',true)");}
   await insert(one,'it_asset_inspections',{...inspection('locked-inspection',3),inspectedOn:'2026-08-31',nextDueOn:'2027-02-28'});
   await two.query("SET LOCAL lock_timeout='100ms'");
   await assert.rejects(update(two,'it_assets','asset',{status:'repair'}),(e:any)=>e.code==='55P03');
  }finally{await one.query('ROLLBACK');await two.query('ROLLBACK');await one.end();await two.end();}
 });
 it('readiness refuses dropped guards, widened policies and lost period uniqueness',async()=>{
  for(const sql of ['DROP TRIGGER it_operations_guard ON prima.it_rental_bills','DROP INDEX prima.it_bill_period_unique','ALTER TABLE prima.it_asset_inspections DISABLE ROW LEVEL SECURITY',"CREATE POLICY extra_ops ON prima.it_rental_rates FOR SELECT USING(true)"]){const c=await connect(url.toString());try{await c.query('BEGIN');await c.query(sql);assert.notDeepEqual(await itOperationsProblems(c),[]);}finally{await c.query('ROLLBACK');await c.end();}}
 });
});
