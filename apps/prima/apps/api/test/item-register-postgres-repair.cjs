// Explicit opt-in disposable localhost database; no production/provider data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');
const {PgStore}=require('../dist/src/pg-store');
const {itemRegisterProblems}=require('../dist/src/item-register-readiness');
const {ItemService,generateDataset,myt}=require('@prima/core');
const url=process.env.ITEM_REPAIR_DATABASE_URL;
if(!url || !['localhost','127.0.0.1'].includes(new URL(url).hostname) || new URL(url).pathname!='/prima_repair_items') throw Error('Explicit disposable localhost prima_repair_items URL required');
const root=path.resolve(__dirname,'../../..'),NOW=myt('2026-11-06','10:30');
const ds=generateDataset({today:'2026-11-06',now:NOW}),user=ds.users.find(x=>x.id==='u-proc-store1');
async function connect(){const c=new Client({connectionString:url});await c.connect();return c}
async function scoped(c,company='goodwill',uid=user.id){await c.query('BEGIN');await c.query('SET LOCAL ROLE prima_app');await c.query("SELECT set_config('app.company_ids',$1,true),set_config('app.group_user',$2,true),set_config('app.user_id',$3,true)",[company,company==='goodwill'?'on':'off',uid])}
async function action(request,qty){const c=await connect();try{await scoped(c);const s=new ItemService(new PgStore(c),()=>NOW,async()=>[]);const out=await s.act(user,request,{kind:'lot.add',skuId:'sku-floor-5l',partyId:'goodwill',qty,note:'Synthetic concurrency receipt'});await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK');throw e}finally{await c.end()}}
(async()=>{
 const admin=await connect();try{
 assert.equal((await admin.query("SELECT 1 FROM pg_namespace WHERE nspname='prima'")).rowCount,0,'refuse an existing Prima schema: use a new disposable database');
 await admin.query(fs.readFileSync(path.join(root,'db/migrations/001_init.sql'),'utf8'));
 const module=fs.readFileSync(path.join(root,'db/modules/item-register-v1.sql'),'utf8');await admin.query(module);await admin.query(module);
 for(const s of ds.itemSkus) await admin.query('INSERT INTO prima.item_skus(id,party_ids,data) VALUES($1,$2,$3)',[s.id,s.partyIds,s]);
 const c=await connect();try{await scoped(c);assert.deepEqual(await itemRegisterProblems(c),[]);await c.query('ROLLBACK')}finally{await c.end()}
 const parallel=await Promise.all([action('pg-first-receipt',3),action('pg-second-receipt',5)]);
 let lots=(await admin.query("SELECT data FROM prima.item_lots WHERE data->>'skuId'='sku-floor-5l'")).rows.map(x=>x.data);
 assert.equal(lots.length,1);assert.equal(lots[0].qty,8);
 const id=lots[0].id;
 // Block the existing row after the second request can read it, then commit +5.
 const blocker=await connect();await scoped(blocker);const blockingStore=new PgStore(blocker);await blockingStore.lock('itemLots',id);
 const waiting=action('pg-stale-read-receipt',3);
 // Confirm a real advisory-lock waiter before releasing, rather than relying on a timer.
 let blocked=false;for(let n=0;n<100;n++){const q=await admin.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted");if(q.rowCount){blocked=true;break}await new Promise(r=>setTimeout(r,20))}assert.ok(blocked,'receipt must actually wait on an advisory lock');
 const old=await blockingStore.get('itemLots',id);await blockingStore.update('itemLots',id,{qty:old.qty+5,version:old.version+1});await blocker.query('COMMIT');await blocker.end();await waiting;
 assert.equal((await admin.query('SELECT data FROM prima.item_lots WHERE id=$1',[id])).rows[0].data.qty,16);
 const replay=await action('pg-stale-read-receipt',3);assert.equal(replay.replay,true);
 assert.equal((await admin.query('SELECT data FROM prima.item_lots WHERE id=$1',[id])).rows[0].data.qty,16);
 const outsider=await connect();try{await scoped(outsider,'co-unrelated','outsider');assert.equal((await outsider.query('SELECT * FROM prima.item_lots')).rowCount,0);assert.equal((await outsider.query('SELECT * FROM prima.item_requests')).rowCount,0);await outsider.query('ROLLBACK')}finally{await outsider.end()}
 for(const table of ['item_events','item_requests','item_docs','item_uniform_records']){const c=await connect();try{await scoped(c);await assert.rejects(c.query(`UPDATE prima.${table} SET data=data`),/permission denied/);await c.query('ROLLBACK')}finally{await c.end()}}
 for(const ddl of ['ALTER TABLE prima.item_lots NO FORCE ROW LEVEL SECURITY','DROP POLICY item_wall ON prima.item_lots','GRANT UPDATE ON prima.item_events TO prima_app','DROP INDEX prima.item_units_token_unique']){
 await admin.query('BEGIN');await admin.query(ddl);await admin.query('SET LOCAL ROLE prima_app');await assert.rejects(new PgStore(admin).list('itemLots'),/protections need setup/);await admin.query('ROLLBACK');
 }
 console.log('PASS actual PostgreSQL: repeat module install; forced-RLS catalogue; concurrent no-row receipts; blocked stale-read receipt; sequential replay; cross-company/request privacy; four append-only denials; four readiness drift denials. Synthetic disposable database only.');
 }finally{await admin.end()}
})().catch(e=>{console.error(e);process.exitCode=1});
