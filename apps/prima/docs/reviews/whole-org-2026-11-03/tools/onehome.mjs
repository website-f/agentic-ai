import pg from '/home/claude/prima-secure-app/node_modules/pg/lib/index.js';
const c=new pg.Client({connectionString:'postgres://postgres:postgres@localhost:5432/prima_stress'});await c.connect();
const snap=async()=>(await c.query("select tup_returned,tup_fetched,xact_commit from pg_stat_database where datname='prima_stress'")).rows[0];
const BASE='http://localhost:3077';
for (const [who,path] of [['u-coo','/api/home?companyId=co-sasa'],['u-cm-sasa','/api/home?companyId=co-sasa'],['u-fauzan','/api/ops/private'],['u-it-ex1','/api/home']]) {
const r=await fetch(BASE+'/api/auth/dev-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:who})});const {token}=await r.json();
await new Promise(r=>setTimeout(r,600));
const a=await snap();const t=performance.now();
const x=await fetch(BASE+path,{headers:{authorization:'Bearer '+token}});const b=await x.text();
const ms=Math.round(performance.now()-t);await new Promise(r=>setTimeout(r,600));const z=await snap();
console.log(who,path,x.status,ms,'ms', Math.round(b.length/1024),'KB','rows read by DB',(z.tup_returned-a.tup_returned),'fetched',(z.tup_fetched-a.tup_fetched));
}
await c.end();
