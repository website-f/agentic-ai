/** Disposable localhost PostgreSQL only. Mixed production service paths under a NOINHERIT login. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {before,after,it} from 'node:test';
import {Client} from 'pg';
import {Db} from '../src/db';
import {resetDb} from '../src/reset-db';
const BASE=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/prima_test';
const parsed=new URL(BASE);if(!['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname))throw Error('Ticket tests require disposable localhost PostgreSQL');
const LOGIN='prima_ticket_refs_test';let db:Db;const owner=new Client({connectionString:BASE});
const now='2026-11-01T08:00:00Z';
before(async()=>{await resetDb(BASE);await owner.connect();if(!(await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[LOGIN])).rowCount)await owner.query(`CREATE ROLE ${LOGIN} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'local-ticket-test-only'`);await owner.query(`GRANT prima_app TO ${LOGIN}`);await owner.query(`GRANT USAGE ON SCHEMA prima TO ${LOGIN}`);await owner.query(`GRANT SELECT ON prima.users,prima.grants TO ${LOGIN}`);const url=new URL(BASE);url.username=LOGIN;url.password='local-ticket-test-only';process.env.DATABASE_URL=url.toString();db=new Db();});
after(async()=>{if(db)await db.onModuleDestroy();await owner.end();process.env.DATABASE_URL=BASE;});
it('restricted login mixed ordinary, website and import writers allocate unique refs at the same clock',async()=>{
 const role=(await db.pool.query('SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolinherit:false});
 const text='Title,Requester,Channel,Urgency,About\nSynthetic PG imported unique,Test person,email,P3,Device';const input={kind:'tickets' as const,text,source:'Synthetic PG fixture.csv'};
 const preview=await db.asUser('u-fauzan',(s,u)=>s.itImportPreview(u,input),()=>now);assert.equal(preview.rows[0].errors.length,0);
 const before=new Set((await owner.query('SELECT id FROM prima.it_tickets')).rows.map(r=>r.id));
 await Promise.all([
  ...Array.from({length:8},(_,i)=>db.asUser('u-it-ex1',(s,u)=>s.raiseItTicket(u,{category:'OTHER',priority:'P3',title:`Synthetic PG ordinary ${i}`,detail:''}),()=>now)),
  db.asUser('u-ae-arsh',(s,u)=>s.websites.act(u,'raiseIssue',{companyId:'co-arsh',description:'Synthetic PG website unique',severity:'normal'}),()=>now),
  db.asUser('u-fauzan',(s,u)=>s.itImportApprove(u,{...input,batchId:'synthetic-pg-mixed-001',previewToken:preview.previewToken,skipRows:[]}),()=>now)
 ]);
 const rows=(await owner.query('SELECT id,data FROM prima.it_tickets')).rows.filter(r=>!before.has(r.id));assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.data.ref)).size,10);assert.equal(new Set(rows.map(r=>r.id)).size,10);
});
it('failed transaction leaves no allocated ticket and preserves legacy refs',async()=>{
 const before=(await owner.query('SELECT id,data FROM prima.it_tickets ORDER BY id')).rows;
 await assert.rejects(db.asUser('u-it-ex1',async(s,u)=>{await s.raiseItTicket(u,{category:'OTHER',priority:'P3',title:'Synthetic rollback ticket',detail:''});throw Error('synthetic rollback');},()=>now));
 assert.deepEqual((await owner.query('SELECT id,data FROM prima.it_tickets ORDER BY id')).rows,before);
});
/** Trusted-server ticket JSON policy tested through production service, NOT claimed as per-action SQL RLS. */
it('linked website resolution/check races preserve version and independent checker under restricted service login',async()=>{
 const x:any=await db.asUser('u-ae-arsh',(s,u)=>s.websites.act(u,'raiseIssue',{companyId:'co-arsh',description:'Synthetic PG independent website check',severity:'normal'}),()=>now);
 // Assignment does not invent a company grant. Prove the existing tenant boundary first.
 await assert.rejects(db.asUser('u-it-mgr',(s,u)=>s.itAct(u,'assignTicket',{id:x.itTicketId,toId:'u-it-ex1'}),()=>now),/Linked website issue scope not found/);
 // Disposable fixture-only grants support the workflow and its company-scoped audit.
 // No production role, assignment policy, or RLS visibility is widened.
 for(const userId of ['u-it-mgr','u-it-ex1']){const id=`test-linked-website-scope-${userId}`;await owner.query("INSERT INTO prima.grants(id,company_id,data) VALUES($1,'co-arsh',$2)",[id,{id,userId,companyId:'co-arsh',scope:'monitor',basis:'Disposable linked website policy test only',validFrom:'2026-11-01',validTo:'2026-11-02'}]);}
 await db.asUser('u-it-mgr',(s,u)=>s.itAct(u,'assignTicket',{id:x.itTicketId,toId:'u-it-ex1'}),()=>now);
 await db.asUser('u-it-ex1',(s,u)=>s.itTicketStep(u,x.itTicketId,'resolve','Synthetic evidence recorded'),()=>now);
 const confirm=(uid:string,fixed:unknown=true)=>db.asUser(uid,(s,u)=>s.itAct(u,'confirmTicket',{id:x.itTicketId,fixed,note:'Synthetic independent check',expectedResolutionVersion:1}),()=>now);
 await assert.rejects(confirm('u-it-mgr'));await assert.rejects(confirm('u-ae-arsh','false'));
 const outcomes=await Promise.allSettled([confirm('u-ae-arsh'),confirm('u-ae-arsh')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 let row=(await owner.query('SELECT data FROM prima.it_tickets WHERE id=$1',[x.itTicketId])).rows[0].data;
 assert.equal(row.webResolutionVersion,1);assert.equal(row.webResolution.resolverId,'u-it-ex1');assert.equal(row.webHistory.filter((h:any)=>h.action==='confirm').length,1);
 await db.asUser('u-it-mgr',(s,u)=>s.itAct(u,'reopenWebTicket',{id:x.itTicketId,note:'Synthetic Manager recheck',expectedResolutionVersion:1}),()=>now);
 row=(await owner.query('SELECT data FROM prima.it_tickets WHERE id=$1',[x.itTicketId])).rows[0].data;
 assert.equal(row.status,'open');assert.equal(row.confirmedAt,null);assert.ok(row.webHistory.some((h:any)=>h.resolution==='Synthetic evidence recorded'));
 await owner.query("DELETE FROM prima.grants WHERE id='test-linked-website-scope-u-it-mgr'");
 await assert.rejects(db.asUser('u-it-mgr',(s,u)=>s.itAct(u,'assignTicket',{id:x.itTicketId,toId:'u-it-ex1'}),()=>now),/Linked website issue scope not found/);
});
