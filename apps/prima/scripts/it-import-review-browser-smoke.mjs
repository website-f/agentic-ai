// Strict synthetic browser harness. No application API, storage, Microsoft or AI transport is loaded.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Synthetic-only opt-in required');
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Installed Playwright module path required; no install performed');
const dir = await mkdtemp(resolve(root, '.review-browser-'));
let server, browser;
try {
 await writeFile(resolve(dir, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
 await writeFile(resolve(dir, 'main.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{ItImportReview}from'../apps/web/src/views/ItImportReview';import{ImportReviewSession}from'../apps/web/src/views/it-import-review-state';import '../apps/web/src/styles.css';
const mode=new URL(location.href).searchParams.get('mode');
window.__calls={preview:0,approve:0,resume:0};
let saved;
const receipt={created:['synthetic-job'],skipped:[],already:false};
const client={capability:async()=>({enabled:mode!=='blocked',permitted:true,resumable:true,immutableEvidence:true,maxProposals:20,eligibleStaffIds:['staff-a','staff-b'],reason:'Backend integration held; local review only.'}),directory:async()=>[{id:'staff-a',name:'Synthetic Exact Name',itRole:'executive'},{id:'staff-b',name:'Synthetic Exact Name',itRole:'lead'}],preview:async input=>{window.__calls.preview++;await new Promise(r=>setTimeout(r,50));saved={id:'synthetic-review',version:1,previewToken:'synthetic-token',expiresAt:new Date(Date.now()+86400000).toISOString(),rows:input.rows,errors:[],status:'review'};return saved;},approve:async()=>{window.__calls.approve++;await new Promise(r=>setTimeout(r,50));if(mode==='unknown')throw Error('Synthetic lost response');return receipt;},resume:async()=>{window.__calls.resume++;return {...saved,status:'approved',receipt};}};
const session=new ImportReviewSession(client,{id:'u-fauzan',opsTier:'ceo'});
await session.load();session.handoff({extractionId:'synthetic-extraction',kind:'jobs',source:{label:'Synthetic fixture',sha256:'a'.repeat(64),canonicalText:'Synthetic task'},rows:[{row:1,fields:{title:{raw:'Synthetic task',start:0,end:14},doer:{raw:null,start:null,end:null}},errors:[],warnings:[]}],expiresAt:new Date(Date.now()+900000).toISOString(),operationalWrites:0,readyForT9Preview:false,warnings:[]});
createRoot(document.getElementById('root')).render(<ItImportReview session={session} onBack={()=>{window.__back=true;}}/>);`);
 server = await createServer({ configFile:false, root:dir, esbuild:{jsx:'automatic'}, server:{host:'127.0.0.1',port:0,fs:{allow:[root]}} });
 await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
 const installed = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href); const {chromium} = installed.default ?? installed;
 browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 let scenarios=0;
 for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  for (const mode of ['normal','blocked','unknown']) {
   const page=await browser.newPage({viewport});const errors=[];let external=0;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return route.continue();external++;return route.abort();});
   await page.goto(origin+'/?mode='+mode);await page.getByRole('heading',{name:'Review with Arisha'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Approve this batch once (CEO)',exact:true}).isEnabled(),false);
   const picker=page.getByRole('combobox');assert.equal(await picker.locator('option').count(),3);await picker.selectOption('staff-b');
   assert.match(await picker.textContent(),/Synthetic Exact Name — lead \(staff-b\)/);
   await page.getByRole('textbox',{name:'title',exact:true}).fill('Synthetic human edit');
   await page.getByText('Human-edited; not revalidated against the source.').first().waitFor();
   if(mode==='blocked') {assert.equal(await page.getByRole('button',{name:'Validate exact batch'}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.__calls.preview),0);}
   else {
    await page.getByRole('button',{name:'Validate exact batch'}).click();await page.getByText('Review ID:',{exact:false}).waitFor();
    const approve=page.getByRole('button',{name:'Approve this batch once (CEO)',exact:true});assert(await approve.isEnabled());
    await page.getByRole('checkbox',{name:'Leave this proposal out of this batch'}).check();assert.equal(await approve.isEnabled(),false);await page.getByRole('checkbox').uncheck();
    await approve.dblclick();
    if(mode==='unknown') {await page.getByText('Approval outcome is unknown.',{exact:false}).waitFor();assert.equal(await approve.isEnabled(),false);assert.equal(await page.getByRole('button',{name:'Back / clear local review'}).isEnabled(),false);await page.getByText('Resume a saved review',{exact:true}).click();await page.getByLabel('Review ID',{exact:true}).fill('synthetic-review').catch(async e=>{console.error(await page.locator('body').ariaSnapshot());throw e;});await page.getByRole('button',{name:'Check saved review / receipt'}).click();}
    await page.getByRole('region',{name:'Import receipt'}).waitFor();assert.equal(await page.evaluate(()=>window.__calls.approve),1);assert.equal(await page.evaluate(()=>window.__calls.preview),1);
   }
   assert.deepEqual(errors,[]);assert.equal(external,0);const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))}));assert.equal(layout.scroll<=layout.width+2,true,JSON.stringify({mode,viewport,layout}));
   scenarios++;await page.close();
  }
 }
 console.log(`${scenarios} synthetic desktop/mobile review scenarios passed; no live API or external requests.`);
} finally {if(browser)await browser.close();if(server)await server.close();await rm(dir,{recursive:true,force:true});}
