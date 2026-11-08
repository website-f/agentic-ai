const {spawn}=require('node:child_process');
const {readFileSync,mkdirSync}=require('node:fs');
const {resolve,dirname}=require('node:path');
const {createServer}=require('node:http');
if(process.env.CI_SYNTHETIC_BROWSER!=='true'||!process.env.PLAYWRIGHT_MODULE)throw Error('Synthetic browser opt-in and pinned tooling required');
const key=process.argv[2], root=resolve(__dirname,'..'), out=resolve(process.env.INTEGRATION_BROWSER_OUT||'artifacts/integration-browser',key||'invalid');
const cases={finance:['finance-plan3-browser-smoke.mjs'],admin:['central-admin-browser-uat.mjs'],fwm:['fw-recruitment-cost-browser-smoke.mjs'],timeslip:['time-slip-browser-smoke.mjs'],jobposts:['hr-job-posts-browser-uat.cjs'],specialops:['special-ops-browser-uat.cjs'],cmsmaster:['cms-masterplan-browser-uat.cjs'],cmsroster:['cms-roster-handover-uat.cjs'],cmsclose:['cms-close-dialog-uat.cjs'],cmsrestart:['cms-restart-uat.cjs'],mailbi:['connections-mail-powerbi-browser.mjs'],m365:['m365-connections-browser-smoke.mjs'],staffhistory:['staff-history-browser-uat.cjs']};
if(!Object.hasOwn(cases,key))throw Error('Unknown browser journey');mkdirSync(out,{recursive:true});
const env={...process.env,NODE_PATH:dirname(dirname(process.env.PLAYWRIGHT_MODULE)),UAT_SCREENSHOTS:out,TIME_SLIP_UAT_DIR:out,M365_UAT_DIR:out,BASE_URL:'http://127.0.0.1:5180',UAT_URL:'http://127.0.0.1:5180'};
async function run(args){await new Promise((ok,bad)=>{const p=spawn(process.execPath,[resolve(__dirname,cases[key][0]),...args],{cwd:root,env,stdio:'inherit'});p.once('error',bad);p.once('exit',(code,signal)=>code===0?ok():bad(Error(`Journey ${key} failed (${code??signal})`)));});}
(async()=>{let server;try{
 if(['jobposts','specialops','cmsmaster','cmsroster'].includes(key)){
  let html=readFileSync(resolve(root,'apps/web/dist-demo/index.html'),'utf8');
  // The job-post fixture explicitly requires non-pilot company heads. Match the
  // staff-history fixture's served synthetic copy; never alter the built file.
  if(key==='jobposts'){
   const fixture=html.replace('on:!0,area:"it"','on:!1,area:"it"');
   if(fixture===html)throw Error('Pilot flag not found in synthetic job-post fixture');
   html=fixture;
  }
  server=createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(html);});await new Promise((ok,bad)=>{server.once('error',bad);server.listen(5180,'127.0.0.1',ok);});
 }
 if(['specialops','cmsmaster','cmsroster'].includes(key)){for(const width of[1280,390])await run([out,String(width)]);}
 else if(['cmsclose','cmsrestart'].includes(key))await run([resolve(root,'apps/cms'),out]);
 else if(['jobposts','staffhistory'].includes(key))await run([out]);else await run([]);
 }finally{if(server)await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
