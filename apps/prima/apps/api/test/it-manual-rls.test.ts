/** Disposable local PostgreSQL only; never Azure. Full schema applied as a NON-superuser owner. */
import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { Client, type PoolClient } from 'pg';
import { ItManualService, PrimaService, generateDataset, MemoryStore, type User } from '@prima/core';
import { PgStore } from '../src/pg-store';
import { migrationSql } from '../src/schema';
import { itManualProblems } from '../src/it-manual-readiness';
const BASE=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/prima_test';
const root=new URL(BASE);
if(!['localhost','127.0.0.1','::1','[::1]'].includes(root.hostname))throw Error('Manual RLS tests require a disposable localhost database');
const DB='prima_it_manual_rls_test',ADMIN='prima_it_manual_owner_test';
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
describe('manual IT database boundaries',()=>{
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
   for(const u of users)await a.query('INSERT INTO prima.users(id,data) VALUES($1,$2)',[u.id,{...u,name:u.id}]);
   for(const [table,row] of [
    ['it_accounts',{id:'acc',name:'Existing system',ownerId:'ceo',owner:'ceo',access:[],reviewedOn:null,mfa:null,masterKeptAt:'',kind:'other',note:''}],
    ['it_onboarding',{id:'join',kind:'join',personName:'Synthetic',jobTitle:'Test',ownerId:'co-a',on:'2026-11-02',ownerStaffId:'it-a',steps:[]}],
    ['it_assets',{id:'asset',tag:'TEST',serial:'TEST',model:'Synthetic',kind:'LAPTOP',ownerId:'co-a',boughtOn:'2026-01-01',status:'spare',assignedTo:null}]
   ] as const)await a.query(`INSERT INTO prima.${table}(id,data) VALUES($1,$2)`,[row.id,row]);
  }finally{await a.end();}
 });
 after(async()=>{const c=await connect(BASE);try{await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);}finally{await c.end();}});
 it('readiness accepts only the reviewed catalog boundaries',async()=>{assert.deepEqual(await as('it-a',c=>itManualProblems(c)),[]);});
 it('mixed roles and forged wall/company IDs do not disclose registers',async()=>{
  for(const id of ['company','integration','closed','unknown','hr','chief'])for(const t of ['it_accounts','it_onboarding','it_assets'])assert.equal((await as(id,c=>c.query(`SELECT id FROM prima.${t}`))).rowCount,0,id+':'+t);
  for(const id of ['it-a','it-lead','ceo','coo','audit'])for(const t of ['it_accounts','it_onboarding','it_assets'])assert.equal((await as(id,c=>c.query(`SELECT id FROM prima.${t}`))).rowCount,1,id+':'+t);
  assert.equal((await as('fd',c=>c.query('SELECT id FROM prima.it_assets'))).rowCount,1);
  assert.equal((await as('fd',c=>c.query('SELECT id FROM prima.it_accounts'))).rowCount,0);
 });
 it('HR and Finance board/plan derived register counts match denied-row MemoryStore projections',async()=>{
  const now='2026-11-01T08:00:00Z';
  for(const id of ['hr','fd']){
   const actual=await as(id,async c=>{const store=new PgStore(c as unknown as PoolClient),u=(await store.get('users',id)) as User,s=new PrimaService(store,()=>now);return{board:await s.itBoard(u),plan:await s.itPlan(u,'year','2026-11-01')};});
   const ds=generateDataset({today:'2026-11-01',now});const u={id,name:id,title:'Synthetic role',role:'pwvsb_officer',companyIds:[],siteIds:[],...users.find(u=>u.id===id)} as User;
   ds.users=[u];ds.itAccounts=[];ds.itOnboarding=[];ds.itDomains=[];ds.itTickets=[];ds.itTenderTasks=[];ds.itAccessRequests=[];ds.itCodeHolders=[];ds.itJobs=[];ds.itPurchases=[];ds.itAssets=[];
   const s=new PrimaService(new MemoryStore(ds),()=>now),memory=await s.itBoard(u),plan=await s.itPlan(u,'year','2026-11-01');
   for(const key of ['accessWaiting','accessReviewDue','onboardingLate','domainsCrit','domainsUnknown','ticketsOpen','ticketsLate','ticketsUnassigned'] as const)assert.equal(actual.board.kpis?.[key],memory.kpis?.[key],id+':'+key);
   assert.deepEqual(actual.board.accounts,[]);assert.deepEqual(actual.board.onboarding,[]);
   assert.deepEqual(actual.plan.dues.filter(d=>['access','domain','ssl','tender'].includes(d.what)),plan.dues.filter(d=>['access','domain','ssl','tender'].includes(d.what)));
   if(id==='hr'){assert.equal(actual.board.kpis?.assets,0);assert.deepEqual(actual.board.byKind,[]);assert.deepEqual(actual.plan.dues,[]);}else{assert.equal(actual.board.kpis?.assets,1);assert.deepEqual(actual.plan.jobs,[]);}
  }
 });
 it('IT metadata cannot grant access, spoof CEO ownership, or forge record identity',async()=>{
  for(const patch of [{access:[{userId:'it-a',level:'admin'}]},{ownerId:'it-a'},{mfa:true},{masterKeptAt:'changed'},{reviewedOn:'2026-11-01'},{id:'forged'}])await assert.rejects(as('it-a',c=>update(c,'it_accounts','acc',patch)));
  await assert.rejects(as('it-a',c=>update(c,'it_onboarding','join',{personName:'changed'})));
  await assert.rejects(as('it-a',c=>update(c,'it_assets','asset',{ownerId:'co-b'})));
  await assert.rejects(as('it-b',c=>update(c,'it_onboarding','join',{steps:[{key:'a'}]})));
  assert.equal((await as('ceo',c=>update(c,'it_accounts','acc',{access:[{userId:'it-a',level:'operator'}],reviewedOn:'2026-11-01'}))).rowCount,1);
 });
 it('guidance requires actual distinct IT Manager checker, not forged mutable metadata',async()=>{
  const manual={kind:'guidance',createdById:'it-a',createdAt:'2026-11-01T00:00:00Z',companyId:null,unitLabel:'',version:1,state:'guidance_given',connection:'not_connected',receipts:[],itResponsibleId:'it-a',guidanceById:'it-a',checkedById:null,evidence:'synthetic evidence',guidanceNote:'synthetic note'};
  const row={id:'guide',name:'Guidance',kind:'other',ownerId:'ceo',owner:'ceo',masterKeptAt:'',mfa:null,access:[],reviewedOn:null,note:'',manual};
  const admin=await connect(url.toString());try{await admin.query('INSERT INTO prima.it_accounts(id,data) VALUES($1,$2)',[row.id,row]);}finally{await admin.end();}
  const next=(actor:string)=>({...manual,version:2,state:'manually_checked',checkedById:actor,receipts:[{requestId:request,userId:actor,hash:'a'.repeat(64),version:2}]});
  await assert.rejects(as('it-a',c=>update(c,'it_accounts','guide',{manual:next('it-a')})));
  await assert.rejects(as('it-lead',c=>update(c,'it_accounts','guide',{manual:{...next('it-lead'),checkedById:'ceo'}})));
  await assert.rejects(as('it-lead',c=>update(c,'it_accounts','guide',{manual:next('it-lead')})));
  assert.equal((await as('it-mgr',c=>update(c,'it_accounts','guide',{manual:next('it-mgr')}))).rowCount,1);
 });
 it('checklist SQL guards require one exact evidence-bearing actor/version transition and safe reopening',async()=>{
  const id='evidence-checklist',steps=[{key:'a',label:'Closure evidence',doneAt:null,by:null},{key:'b',label:'Device return',doneAt:null,by:null}];
  const admin=await connect(url.toString());try{await admin.query('INSERT INTO prima.it_onboarding(id,data) VALUES($1,$2)',[id,{id,kind:'leave',personName:'Synthetic',jobTitle:'Test',ownerId:'co-a',on:'2026-11-02',ownerStaffId:'it-a',steps}]);}finally{await admin.end();}
  const initialSteps=[['identity','Confirm leaving instruction and date'],['accounts','Record external account closure evidence'],['device','Record device return'],['prima','Refer Prima closure to authorized HR/CEO'],['handover','Record handover evidence']].map(([key,label])=>({key,label,doneAt:null,by:null}));
  const initial={id:'normal-open-intake',kind:'leave',personName:'Synthetic',jobTitle:'Test role',on:'2026-11-02',ownerId:'unlinked',ownerStaffId:'it-a',steps:initialSteps,manual:{kind:'intake',companyId:null,unitLabel:'Synthetic unlinked unit',receipts:[],version:1,state:'recorded',connection:'not_connected',createdById:'it-a',createdAt:'2026-11-01T00:00:00Z'}};
  await as('it-a',c=>c.query('INSERT INTO prima.it_onboarding(id,data) VALUES($1,$2)',[initial.id,initial]));
  await assert.rejects(as('it-a',c=>c.query('INSERT INTO prima.it_onboarding(id,data) VALUES($1,$2)',['forged-done',{...initial,id:'forged-done',steps:initialSteps.map((x,i)=>i===1?{...x,doneAt:'2026-11-01T00:00:00Z',by:'it-a'}:x)}])));

  const done={...steps[0],doneAt:'2026-11-01T08:30:00Z',by:'it-a',byId:'it-a',evidenceRef:'Synthetic closure receipt',version:1,changedById:'it-a',changedAt:'2026-11-01T08:30:00Z',reopenReason:null};
  for(const patch of[{evidenceRef:null},{evidenceRef:'  '},{evidenceRef:123},{version:'1'},{version:9007199254740992},{version:0},{changedById:'it-b'},{byId:'it-b'},{label:'Forged label'},{changedAt:null}])await assert.rejects(as('it-a',c=>update(c,'it_onboarding',id,{steps:[{...done,...patch},steps[1]]})));
  await assert.rejects(as('it-b',c=>update(c,'it_onboarding',id,{steps:[done,steps[1]]})));
  await assert.rejects(as('it-a',c=>update(c,'it_onboarding',id,{steps:[done,{...done,key:'b',label:'Device return'}]})));
  await as('it-a',c=>update(c,'it_onboarding',id,{steps:[done,steps[1]]}));
  await assert.rejects(as('it-a',c=>update(c,'it_onboarding',id,{steps:[{...done,evidenceRef:'Silent changed evidence'},steps[1]]})));
  const reopen={...done,doneAt:null,by:null,byId:null,evidenceRef:null,version:2,reopenReason:'Correct closure evidence'};
  await assert.rejects(as('it-a',c=>update(c,'it_onboarding',id,{steps:[{...reopen,reopenReason:''},steps[1]]})));
  await assert.rejects(as('it-a',c=>update(c,'it_onboarding',id,{steps:[{...reopen,reopenReason:123},steps[1]]})));
  await as('it-a',c=>update(c,'it_onboarding',id,{steps:[reopen,steps[1]]}));
  const actor={...users[0],name:'it-a'} as User;
  const results=await Promise.allSettled(['Receipt one','Receipt two'].map(e=>as('it-a',async c=>new PrimaService(new PgStore(c as unknown as PoolClient),()=> '2026-11-01T08:30:00Z').setItOnboardingStep(actor,id,'a',true,e,2))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const stored=await as('it-a',async c=>(await c.query('SELECT data FROM prima.it_onboarding WHERE id=$1',[id])).rows[0].data);
  assert.equal(stored.steps[0].version,3);assert.ok(['Receipt one','Receipt two'].includes(stored.steps[0].evidenceRef));
 });
 it('readiness refuses a missing trigger, disabled RLS, or loosened owner policy',async()=>{
  for(const sql of ['DROP TRIGGER it_register_guard ON prima.it_accounts','ALTER TABLE prima.it_accounts DISABLE ROW LEVEL SECURITY',"CREATE POLICY extra_receipt_read ON prima.it_manual_receipts FOR SELECT USING (true)"]){
   const c=await connect(url.toString());try{await c.query('BEGIN');await c.query(sql);assert.notDeepEqual(await itManualProblems(c),[]);}finally{await c.query('ROLLBACK');await c.end();}
  }
 });
 it('manual stock permits recognized IT staff, but not fabricated disposal or purchase',async()=>{
  const row={id:'opening-stock',tag:'SYNTHETIC-OPENING',serial:'SERIAL-OPENING',kind:'LAPTOP',model:'Test',ownerId:'unlinked',boughtOn:'',assignedTo:null,status:'spare',purchaseId:null,disposal:null,maintenance:[],manual:{kind:'asset',createdById:'it-lead',createdAt:'2026-11-01T00:00:00Z',companyId:null,unitLabel:'',version:1,state:'recorded',connection:'not_connected',provenance:'existing_stock',receipts:[]}};
  const put=(c:Client,x:any)=>c.query('INSERT INTO prima.it_assets(id,data) VALUES($1,$2)',[x.id,x]);
  assert.equal((await as('it-a',c=>put(c,{...row,id:'opening-executive',tag:'SYNTHETIC-OPENING-EXEC',serial:'SERIAL-OPENING-EXEC',manual:{...row.manual,createdById:'it-a'}}))).rowCount,1);
  await assert.rejects(as('it-lead',c=>put(c,{...row,status:'disposed'})));
  await assert.rejects(as('it-lead',c=>put(c,{...row,purchaseId:'invented'})));
  await as('it-lead',c=>put(c,row));
  await assert.rejects(as('it-lead',c=>put(c,{...row,id:'duplicate-opening-serial',tag:'SYNTHETIC-DUPLICATE',serial:'SERIAL-OPENING-EXEC'})),/Serial is invalid or already recorded/);
 });
 it('raw omitted-manual stock cannot bypass admission; legitimate received purchase still works',async()=>{
  const row={id:'purchase-asset',tag:'SYNTHETIC',serial:'',kind:'LAPTOP',model:'Test',ownerId:'co-a',boughtOn:'2026-01-01',assignedTo:null,status:'spare',purchaseId:'purchase'};
  const insert=(c:Client)=>c.query('INSERT INTO prima.it_assets(id,data) VALUES($1,$2)',[row.id,row]);
  await assert.rejects(as('it-a',insert));
  const c=await connect(url.toString());try{await c.query('INSERT INTO prima.it_purchases(id,data) VALUES($1,$2)',['purchase',{id:'purchase',ownerId:'co-a',status:'received',received:{assetIds:[row.id]}}]);}finally{await c.end();}
  await assert.rejects(as('wrong-it-role',insert));
  await as('it-a',insert);
 });
 it('receipt ownership, immutable outcome, and shape are enforced',async()=>{
  await as('it-a',c=>insertReceipt(c));
  assert.equal((await as('it-b',c=>c.query('SELECT id FROM prima.it_manual_receipts'))).rowCount,0);
  await assert.rejects(as('it-b',c=>insertReceipt(c,receipt('it-a','22222222-2222-4222-8222-222222222222'))));
  await assert.rejects(as('it-a',c=>update(c,'it_manual_receipts',receipt().id,{outcome:'rejected'})));
  await assert.rejects(as('it-a',c=>c.query('DELETE FROM prima.it_manual_receipts')));
  await assert.rejects(as('it-a',c=>insertReceipt(c,{...receipt('it-a','33333333-3333-4333-8333-333333333333'),hash:'forged'})));
 });
 it('actual service concurrent retries create one record and one durable receipt',async()=>{
  const input={requestId:'55555555-5555-4555-8555-555555555555',name:'Synthetic system',kind:'other',companyId:null,unitLabel:'',note:'Synthetic note'};
  const create=()=>as('it-a',async c=>{const store=new PgStore(c as unknown as PoolClient);const user=(await store.get('users','it-a')) as User;return new ItManualService(store,()=> '2026-11-01T00:00:00+08:00').create(user,'system',input);});
  const results=await Promise.all([create(),create()]);assert.equal(results[0].recordId,results[1].recordId);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
  assert.equal((await as('it-a',c=>c.query('SELECT id FROM prima.it_manual_receipts WHERE id=$1',['it-a:'+input.requestId]))).rowCount,1);
  const failInput={...input,requestId:'66666666-6666-4666-8666-666666666666',name:'Synthetic rollback'};
  const admin=await connect(url.toString());try{await admin.query("CREATE FUNCTION prima.synthetic_manual_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.data->>'action'='it.manual.system.create' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_manual_audit_fail BEFORE INSERT ON prima.audit FOR EACH ROW EXECUTE FUNCTION prima.synthetic_manual_audit_fail()");}finally{await admin.end();}
  try{await assert.rejects(as('it-a',async c=>{const store=new PgStore(c as unknown as PoolClient);return new ItManualService(store,()=> '2026-11-01T00:00:00+08:00').create((await store.get('users','it-a')) as User,'system',failInput);}));}
  finally{const admin=await connect(url.toString());try{await admin.query('DROP TRIGGER synthetic_manual_audit_fail ON prima.audit; DROP FUNCTION prima.synthetic_manual_audit_fail()');}finally{await admin.end();}}
  assert.equal((await as('it-a',c=>c.query("SELECT id FROM prima.it_accounts WHERE data->>'name'=$1",[failInput.name]))).rowCount,0);
  assert.equal((await as('it-a',c=>c.query('SELECT id FROM prima.it_manual_receipts WHERE id=$1',['it-a:'+failInput.requestId]))).rowCount,0);
 });
 it('central employers (PWVSB, Merdeka, Goodwill, Sasa Team) are offered and accepted for manual records; an unknown company is refused',async()=>{
  const svc=(c:Client)=>{const store=new PgStore(c as unknown as PoolClient);return {store,service:new ItManualService(store,()=> '2026-11-01T00:00:00+08:00')};};
  const board=await as('it-a',async c=>{const {store,service}=svc(c);return service.board((await store.get('users','it-a')) as User);});
  for(const id of ['pwvsb','merdeka','goodwill','sasateam','pgl'])assert.ok(board.companies.some(x=>x.id===id),id);
  for(const [n,companyId] of ['goodwill','sasateam'].entries()){
   const input={requestId:`7777777${n}-7777-4777-8777-777777777777`,name:`Synthetic ${companyId} system`,kind:'other',companyId,unitLabel:'',note:'Synthetic note'};
   const r=await as('it-a',async c=>{const {store,service}=svc(c);return service.create((await store.get('users','it-a')) as User,'system',input);}) as {terminal?:string};
   assert.equal(r.terminal,'committed');
   assert.equal((await as('it-a',c=>c.query("SELECT data#>>'{manual,companyId}' AS co FROM prima.it_accounts WHERE data->>'name'=$1",[input.name]))).rows[0].co,companyId);
  }
  const bad=await as('it-a',async c=>{const {store,service}=svc(c);return service.create((await store.get('users','it-a')) as User,'system',{requestId:'78787878-7878-4878-8878-787878787878',name:'Synthetic unknown',kind:'other',companyId:'not-a-company',unitLabel:'',note:'Synthetic note'});}) as {terminal?:string};
  assert.equal(bad.terminal,'rejected');
 });
 it('rollback removes both mutation and receipt; concurrent receipt IDs commit once',async()=>{
  const r=receipt('it-a','44444444-4444-4444-8444-444444444444');
  await assert.rejects(as('it-a',async c=>{await update(c,'it_assets','asset',{status:'repair'});await insertReceipt(c,r);throw Error('synthetic failure');}));
  assert.equal((await as('it-a',c=>c.query('SELECT data FROM prima.it_assets WHERE id=$1',['asset']))).rows[0].data.status,'spare');
  assert.equal((await as('it-a',c=>c.query('SELECT id FROM prima.it_manual_receipts WHERE id=$1',[r.id]))).rowCount,0);
  const both=await Promise.allSettled([as('it-a',c=>insertReceipt(c,r)),as('it-a',c=>insertReceipt(c,r))]);assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
 });
});
