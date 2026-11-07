// CI-only real-component interaction with synthetic transport. Never calls Prima/Microsoft.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
if (process.env.CI_SYNTHETIC_BROWSER !== 'true' || !process.env.PLAYWRIGHT_MODULE) throw Error('Run only in the approved synthetic browser CI environment.');
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=await mkdtemp(resolve(root,'.it-manual-browser-'));
const harness=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ItManualPanel}from'../apps/web/src/views/ItManual';import'../apps/web/src/styles.css';
const f=window.__manual={userId:'owner-a',calls:[],lose:false,hold:false,holdBoard:false,release:null};
const board=userId=>({serviceId:'it-manual',configuration:'ready',userId,canCreate:true,canCheck:true,canCreateAsset:true,connection:'not_connected',staff:[{id:'person-1',name:userId==='owner-a'?'Synthetic A Person':'Synthetic B Person'}],itStaff:[{id:'it-1',name:'Synthetic IT'}],companies:[],jobs:[{id:'job-1',title:'Synthetic job'}],accounts:[],onboarding:[]});
window.__manualCall=async(userId,action,input)=>{
 f.calls.push({userId,action,input});if(userId!==f.userId)throw Error('Account changed');
 if(action==='manualBoard'){const result=board(userId);if(f.holdBoard)await new Promise(r=>{f.release=r});return result;}
 const receipts=JSON.parse(sessionStorage.getItem('synthetic-receipts')||'{}');
 if(action==='manualReceipt')return receipts[userId+input.requestId]||{serviceId:'it-manual',userId,kind:input.kind,found:false};
 if(action==='manualAbandon'){const result=receipts[userId+input.requestId]||{serviceId:'it-manual',userId,requestId:input.requestId,kind:input.kind,terminal:'rejected',recordId:null,version:null,message:'Synthetic attempt closed',found:true};receipts[userId+input.requestId]=result;sessionStorage.setItem('synthetic-receipts',JSON.stringify(receipts));return result;}
 const kind={createIntake:'intake',createSystem:'system',createGuidance:'guidance',createAsset:'asset'}[action];if(!kind)throw Error('Unexpected action');
 const receipt={serviceId:'it-manual',userId,requestId:input.requestId,kind,terminal:'committed',recordId:'synthetic-'+kind,version:1};
 receipts[userId+input.requestId]=receipt;sessionStorage.setItem('synthetic-receipts',JSON.stringify(receipts));
 if(f.hold)await new Promise(r=>{f.release=r});if(f.lose){f.lose=false;throw Error('Synthetic lost response');}return receipt;
};
window.__manualUser=()=>f.userId;
function Fixture(){const[mode,setMode]=useState('intake'),[revision,setRevision]=useState(0);window.__changeUser=(id,hold=false)=>{f.userId=id;f.holdBoard=hold;setRevision(v=>v+1)};return <><nav aria-label="Fixture modes">{['intake','systems','assets'].map(x=><button key={x} onClick={()=>setMode(x)}>{x}</button>)}</nav><ItManualPanel key={mode} mode={mode}/><span hidden>{revision}</span></>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
`;
let server,browser;
const diagnostics=[];
try{
 await writeFile(resolve(dir,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
 await writeFile(resolve(dir,'main.tsx'),harness);
 server=await createServer({configFile:false,root:dir,cacheDir:resolve(dir,'.vite-cache'),optimizeDeps:{entries:[resolve(dir,'main.tsx')],include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},logLevel:'error',esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{name:'manual-synthetic-only',enforce:'pre',resolveId(id,importer){if((importer?.endsWith('/src/views/ItManual.tsx')||importer?.endsWith('/src/views/ItCorrections.tsx')||importer?.endsWith('/src/views/ItCleanup.tsx'))&&id==='../App')return'\0manual-app';if(((importer?.endsWith('/src/views/ItManual.tsx')||importer?.endsWith('/src/views/ItCorrections.tsx')||importer?.endsWith('/src/views/ItCleanup.tsx'))&&id==='../api')||(importer?.endsWith('/src/ui.tsx')&&id==='./api'))return'\0manual-api';},load(id){if(id==='\0manual-app')return'export const useApp=()=>({me:{user:{id:window.__manualUser()}}});';if(id==='\0manual-api')return'export class ApiError extends Error{}; export const api={itManualAct:(...args)=>window.__manualCall(...args)};';}}]});
 await server.listen();
 const transformed=await server.transformRequest('/main.tsx');
 assert.ok(transformed?.code.includes('ItManualPanel'),'Synthetic manual fixture must transform before browser navigation');
 await server.waitForRequestsIdle();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);browser=await chromium.launch({headless:true});
 for(const viewport of[{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];let external=0;
  page.on('pageerror',e=>{errors.push(e.message);diagnostics.push({kind:'pageerror',width:viewport.width,message:e.message});});
  page.on('console',m=>{if(m.type()==='error')diagnostics.push({kind:'console',width:viewport.width,message:m.text()});});
  page.on('requestfailed',r=>diagnostics.push({kind:'requestfailed',width:viewport.width,url:r.url(),failure:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)diagnostics.push({kind:'http',width:viewport.width,status:r.status(),url:r.url()});});
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return r.continue();external++;return r.abort();});
  await page.goto(origin);
  const writes=()=>page.evaluate(()=>window.__manual.calls.filter(x=>x.action.startsWith('create')));
  const save=()=>page.getByRole('button',{name:'Save manual record',exact:true});
  const back=()=>page.getByRole('button',{name:'Back to register',exact:true}).click();
  // Keyboard submit + exact identity, not a typed-name association.
  await page.getByRole('button',{name:'Add joining / leaving request',exact:true}).click();
  await page.getByLabel('Existing authorized staff identity (optional)').selectOption('person-1');
  await page.getByLabel('Job title',{exact:true}).fill('Synthetic technician');await page.getByLabel('Joining / leaving date').fill('2026-11-02');await page.getByLabel('Responsible IT staff',{exact:true}).selectOption('it-1');
  await save().focus();await page.keyboard.press('Enter');await page.getByText('Saved as an administrative record.',{exact:false}).waitFor();
  let calls=await writes();assert.equal(calls.length,1);assert.equal(calls[0].input.personUserId,'person-1');assert.equal(calls[0].input.personName,'Synthetic A Person');await back();
  // Cancel before submission performs no write.
  await page.getByRole('button',{name:'Add joining / leaving request',exact:true}).click();await page.getByLabel('Unlinked person name — not a verified staff account').fill('Unsaved synthetic person');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await writes()).length,1);
  await page.getByRole('button',{name:'systems',exact:true}).click();await page.getByRole('button',{name:'Register existing system',exact:true}).click();await page.getByLabel('System name',{exact:true}).fill('Synthetic VPN');await page.getByLabel('Record note / setup needed').fill('Manual inventory only');await save().click();await back();
  calls=await writes();assert.equal(calls.at(-1).action,'createSystem');assert.equal(calls.at(-1).input.companyId,null);
  await page.getByRole('button',{name:'Record SharePoint guidance',exact:true}).click();await page.getByLabel('SharePoint guidance record name').fill('Synthetic pending library');await page.getByLabel('Responsible IT staff',{exact:true}).selectOption('it-1');await page.getByLabel('Related existing IT job (optional)').selectOption('job-1');await page.getByLabel('Record note / setup needed').fill('Site URL pending; no connection requested');await save().click();await back();calls=await writes();assert.equal(calls.at(-1).input.url,null);assert.equal(calls.at(-1).input.jobId,'job-1');
  await page.getByRole('button',{name:'assets',exact:true}).click();await page.getByRole('button',{name:'Register existing device',exact:true}).click();for(const[label,value]of[['Asset tag','SYN-1'],['Serial number','SYN-SERIAL'],['Model','Synthetic laptop'],['Current location','IT store']])await page.getByLabel(label,{exact:true}).fill(value);
  // Hold an acknowledged request: repeated click cannot create a second operation.
  await page.evaluate(()=>window.__manual.hold=true);await save().click();await page.waitForFunction(()=>typeof window.__manual.release==='function');assert.equal(await save().isDisabled(),true);await save().click({force:true,timeout:250}).catch(()=>{});assert.equal((await writes()).filter(x=>x.action==='createAsset').length,1);await page.evaluate(()=>{window.__manual.hold=false;window.__manual.release()});await back();calls=await writes();assert.equal(calls.at(-1).input.boughtOn,null);assert.equal('cost'in calls.at(-1).input,false);
  // Commit then lose response. Reload restores only pending ID; no second create.
  await page.getByRole('button',{name:'systems',exact:true}).click();await page.getByRole('button',{name:'Register existing system',exact:true}).click();await page.getByLabel('System name',{exact:true}).fill('Synthetic lost response');await page.getByLabel('Record note / setup needed').fill('Synthetic only');await page.evaluate(()=>window.__manual.lose=true);await save().click();await page.getByRole('button',{name:'Check saved receipt',exact:true}).waitFor();
  const marker=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.includes('manual')));assert.equal(marker.length,1);assert.equal(Object.keys(JSON.parse(marker[0][1])).sort().join(','),'kind,requestId');
  await page.reload();await page.getByRole('button',{name:'Add joining / leaving request',exact:true}).click();await page.getByRole('button',{name:'Check saved receipt',exact:true}).click();await page.getByText('Saved as an administrative record.',{exact:false}).waitFor();assert.equal((await writes()).length,0,'Recovery never issues a create');await back();
  // Same mounted panel must hide previous-owner lookups during delayed reload.
  await page.getByRole('button',{name:'Add joining / leaving request',exact:true}).click();await page.getByLabel('Existing authorized staff identity (optional)').selectOption('person-1');await page.evaluate(()=>window.__changeUser('owner-b',true));await page.getByText('Loading manual IT options for your account',{exact:false}).waitFor();assert.equal(await page.getByText('Synthetic A Person',{exact:true}).count(),0);await page.waitForFunction(()=>typeof window.__manual.release==='function');await page.evaluate(()=>{window.__manual.holdBoard=false;window.__manual.release()});await page.getByLabel('Existing authorized staff identity (optional)').waitFor();assert.equal(await page.getByRole('option',{name:'Synthetic B Person',exact:true}).count(),1);assert.equal(await page.getByRole('option',{name:'Synthetic A Person',exact:true}).count(),0);
  assert.equal(external,0);assert.deepEqual(errors,[]);await context.close();console.log(`ok manual IT four intakes, keyboard submission, cancel, duplicate prevention, reload recovery and identity isolation at ${viewport.width}px`);
 }
}catch(error){
 for(const context of browser?.contexts()??[])for(const page of context.pages()){
  try{diagnostics.push({kind:'page-snapshot',url:page.url(),body:(await page.locator('body').innerText()).slice(0,4000),actions:await page.evaluate(()=>window.__manual?.calls?.map(c=>c.action)??null)});}catch{diagnostics.push({kind:'snapshot-unavailable'});}
 }
 console.error('Synthetic manual IT failure diagnostics',JSON.stringify(diagnostics));
 throw error;
}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});}
