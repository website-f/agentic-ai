// Actual Connections UI + StrictMode, synthetic in-memory provider only. No live service calls.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Set CI_SYNTHETIC_BROWSER=true for the synthetic-only fixture.');
const dir = await mkdtemp(resolve(root, '.connections-browser-'));
const apiCode = `
export class ApiError extends Error { constructor(message,status=500,findings=[]){super(message);this.status=status;this.findings=findings;} }
const time='2026-10-31T00:00:00.000Z';
const f=window.__connectionsFixture={configured:false,userId:'synthetic-a',setupRequests:[],mailCalls:[],m365Calls:[],mailSetup:null,calls:[],pending:[],holdNext:null,nextPatch:null};
f.release=async(index,patch={})=>{const item=f.pending[index];if(!item)throw Error('Unknown synthetic request');item.resolve({...item.value,...patch});await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));};
function respond(kind,args,value){
 const result={serviceId:'sharepoint',userId:f.userId,...value,...(f.nextPatch?.kind===kind?f.nextPatch.value:{})};
 if(f.nextPatch?.kind===kind)f.nextPatch=null;
 f.calls.push({kind,args,userId:f.userId});
 if(f.holdNext===kind){f.holdNext=null;return new Promise(resolve=>f.pending.push({resolve,value:result}));}
 return Promise.resolve(result);
}
export const api={
 m365Call:async(expectedUserId,method,path,body)=>{if(expectedUserId!==f.userId)throw Error('Wrong mail owner');if(path.startsWith('/connections/m365/')){f.m365Calls.push({method,path,body});if(method==='GET'&&path==='/connections/m365/status')return{userId:f.userId,services:['outlook','teams','sharepoint'].map(service=>({service,state:'not_configured',reason:'FeatureDisabled',resources:[],actions:[]})),teamsApprovals:{state:'not_built',canApplyApprovals:false}};if(method==='GET'&&path==='/connections/m365/matrix')throw Error('Guidance unavailable in this fixture');throw Error('Unapproved synthetic M365 action');}f.mailCalls.push({method,path,body});if(method==='GET'&&path==='/connections/mail/jobs/status')return{serviceId:'mail',userId:f.userId,status:'NotConfigured',keepDays:30,setupReason:'FeatureDisabled',providerVerified:false,setupRequest:f.mailSetup};if(method==='POST'&&path==='/connections/mail/jobs/setup'){f.mailSetup={ticketId:'mail-setup',ticketRef:'IT-MAIL-SYNTHETIC',status:'open'};return{serviceId:'mail',userId:f.userId,requestId:body.requestId,replayed:false,...f.mailSetup};}throw Error('Unapproved synthetic mail action');},
 sharePointRequestPreview:url=>respond('setupPreview',[url],{status:'RequestPreview',canonicalUrl:'https://example.sharepoint.com/sites/IT/Documents',host:'example.sharepoint.com',kind:'library'}),
 sharePointRequest:(url,requestId,expectedUserId)=>{if(expectedUserId!==f.userId)throw Error('Wrong setup owner');const receipt={requestId,id:'ticket-synthetic',reference:'IT-SYNTHETIC',status:'open',at:time};f.setupRequests.push(receipt);return respond('setupRequest',[url,requestId],receipt);},
 sharePointRequests:()=>respond('setupList',[],{requests:f.setupRequests}),
 sharePointStatus:()=>respond('configuration',[],{status:f.configured?'ConfiguredNotVerified':'NotConfigured',sites:f.configured?[{key:'site-a',name:'Synthetic A',hasApprovedLibraries:true},{key:'site-b',name:'Synthetic B',hasApprovedLibraries:true}]:[]}),
 sharePointCheck:siteKey=>respond('check',[siteKey],{status:'VerifiedForCurrentUser',siteKey,checkedAt:time}),
 sharePointLibraries:siteKey=>respond('libraries',[siteKey],{siteKey,checkedAt:time,libraries:Array.from({length:50},(_,i)=>({id:'library-'+i,name:'Synthetic library '+i})),hasMore:false}),
 sharePointItems:(siteKey,driveId)=>respond('items',[siteKey,driveId],{siteKey,driveId,checkedAt:time,items:[{id:'synthetic-file',name:'Synthetic policy.pdf',kind:'file',size:10,lastModifiedAt:time,webUrl:'https://example.sharepoint.com/sites/IT/Documents/policy.pdf'}],hasMore:false})
};`;
let server, browser;
try {
  await writeFile(resolve(dir, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(resolve(dir, 'main.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ConnectionsView}from'../apps/web/src/views/Connections';import '../apps/web/src/styles.css';function Fixture(){const[userId,setUserId]=useState('synthetic-a');window.__setConnectionUser=id=>{window.__connectionsFixture.userId=id;setUserId(id);};return <ConnectionsView key={userId} userId={userId}/>;}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
  server = await createServer({ configFile: false, root: dir, cacheDir:resolve(dir,'.vite-cache'),optimizeDeps:{entries:[resolve(dir,'main.tsx')],include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } }, plugins: [{ name: 'synthetic-connections-api', enforce: 'pre', resolveId(id, importer) { if ((id === '../api' && importer?.endsWith('/views/Connections.tsx')) || (id === './api' && importer?.endsWith('/src/ui.tsx'))) return '\0synthetic-connections-api'; }, load(id) { if (id === '\0synthetic-connections-api') return apiCode; } }] });
  await server.listen();await server.transformRequest('/main.tsx');await server.waitForRequestsIdle();
  const address = server.httpServer.address(); const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(origin + '/main.tsx'); assert.equal(response.status, 200); const entry = await response.text();
  assert(entry.includes('ConnectionsView')); assert(entry.includes('StrictMode'));
  const componentPath = entry.match(/from\s+["']([^"']*\/views\/Connections\.tsx[^"']*)["']/)?.[1]; assert(componentPath, 'Actual component import missing');
  const componentResponse = await fetch(new URL(componentPath, origin)); assert.equal(componentResponse.status, 200); const component = await componentResponse.text();
  assert(component.includes('/@id/__x00__synthetic-connections-api'), 'Actual view must use synthetic API');
  assert(!/from\s+["'][^"']*\/api\/index/.test(component), 'Real API module must not be imported');
  const uiPath = component.match(/from\s+["']([^"']*\/ui\.tsx[^"']*)["']/)?.[1]; assert(uiPath, 'Actual UI import missing');
  const uiResponse = await fetch(new URL(uiPath, origin)); assert.equal(uiResponse.status, 200); const ui = await uiResponse.text();
  assert(ui.includes('/@id/__x00__synthetic-connections-api'), 'Actual UI primitives must use synthetic API');
  assert(!/from\s+["'][^"']*\/api\/index/.test(ui), 'UI must not import real API');
  const mockResponse = await fetch(origin + '/@id/__x00__synthetic-connections-api'); assert.equal(mockResponse.status, 200); assert((await mockResponse.text()).includes('__connectionsFixture'));
  if (process.argv.includes('--server-check')) {
    console.log('Connections synthetic Vite transform passed; no browser assertions executed.');
  } else {
    if (!process.env.PLAYWRIGHT_MODULE) throw Error('PLAYWRIGHT_MODULE is required; this script never installs a browser.');
    const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    browser = await chromium.launch({ headless: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport }); const errors = []; let forbiddenRequests = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === origin && !u.pathname.startsWith('/api/')) return route.continue(); forbiddenRequests++; return route.abort(); });
      await page.goto(origin);
      const sp = page.getByRole('region', { name: 'SharePoint', exact: true });
      const mail = page.getByRole('region', { name: 'Outlook selected-email connection', exact: true });
      const bi = page.getByRole('region', { name: 'Power BI', exact: true });
      await sp.getByText('SharePoint is not configured for this app.', { exact: false }).waitFor();
      const m365 = page.getByRole('region', { name: 'Your Microsoft 365 connections', exact: true });
      for (const name of ['Outlook', 'Teams', 'SharePoint']) await m365.getByRole('status', { name: `${name} status: Not configured`, exact: true }).waitFor();
      assert.equal(await m365.getByRole('button', { name: 'Check', exact: true }).count(), 0, 'Not configured offers no Microsoft check');
      assert.equal(await page.evaluate(() => window.__connectionsFixture.m365Calls.some(c => c.method !== 'GET')), false, 'Opening the page reads Prima status only');
      await bi.getByText('Not configured', { exact: true }).waitFor(); assert.equal(await bi.getByRole('button').count(), 0);
      await mail.getByText('Not configured', { exact: true }).waitFor(); await mail.getByRole('button',{name:'Refresh Outlook setup status'}).click(); await mail.getByRole('button',{name:'Request selected-email setup'}).waitFor(); assert.equal(await mail.getByRole('button',{name:'Check my access'}).count(),0); assert.equal(await mail.getByRole('button',{name:'Send',exact:true}).count(),0);
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.some(c => c.kind !== 'configuration')), false, 'StrictMode mount must not read provider metadata');
      assert.equal(await page.getByRole('textbox').count(), 1, 'Only the explicit parse-only setup URL field; no credentials');
      assert.equal(await page.evaluate(()=>window.__connectionsFixture.mailCalls.some(c=>c.method!=='GET')),false,'Opening and refreshing Outlook only reads setup status');
      await mail.getByRole('button',{name:'Request selected-email setup'}).click(); await mail.getByText('Setup request IT-MAIL-SYNTHETIC recorded.',{exact:false}).waitFor();
      assert.equal(await mail.getByRole('button',{name:'Request selected-email setup'}).count(),0);await mail.getByRole('button',{name:'Refresh Outlook setup status'}).click();
      assert.equal(await page.evaluate(()=>window.__connectionsFixture.mailCalls.filter(c=>c.method==='POST').length),1,'Known setup ticket prevents a second request');
      assert.equal(await page.evaluate(()=>Object.keys(window.__connectionsFixture.mailCalls.find(c=>c.method==='POST').body).join(',')),'requestId','Setup never carries email content');

      await page.evaluate(() => { window.__connectionsFixture.configured = true; });
      await sp.getByRole('button', { name: 'Refresh setup status', exact: true }).click();
      const site = sp.getByRole('combobox', { name: 'Approved site', exact: true });
      await site.selectOption('site-a');
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.some(c => c.kind !== 'configuration')), false, 'Selecting a site must not read a provider');
      const check = sp.getByRole('button', { name: 'Check my access', exact: true });
      await check.focus(); await page.keyboard.press('Enter');
      await sp.getByText('Verified for you at the time shown', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__connectionsFixture.calls.filter(c => c.kind !== 'configuration').map(c => c.kind)), ['check']);
      const libraries = sp.getByRole('button', { name: 'List approved libraries', exact: true });
      await libraries.click();
      const library = sp.getByRole('combobox', { name: 'Approved library', exact: true });
      await library.waitFor(); assert.equal(await library.getByRole('option').count(), 51);
      await library.selectOption('library-49'); assert.equal(await library.inputValue(), 'library-49', 'Last approved library must remain reachable');
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.filter(c => c.kind === 'items').length), 0);
      const items = sp.getByRole('button', { name: 'List metadata', exact: true });
      await items.click(); await sp.getByText('Synthetic policy.pdf', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.find(c => c.kind === 'items').args[1]), 'library-49');
      const fileLink=sp.getByRole('link',{name:'Open in SharePoint (new tab)'});assert.equal(await fileLink.getAttribute('href'),'https://example.sharepoint.com/sites/IT/Documents/policy.pdf');assert.equal(await fileLink.getAttribute('target'),'_blank');assert.equal(await fileLink.getAttribute('rel'),'noopener noreferrer');
      assert.equal(forbiddenRequests,0,'Rendering a file link must not open it');
      // Hold an access response; a newer site/check must win even if transport ignores abort.
      await page.evaluate(() => { window.__connectionsFixture.holdNext = 'check'; }); await check.click();
      await page.waitForFunction(() => window.__connectionsFixture.pending.length === 1);
      assert.equal(await check.isEnabled(), false, 'Pending access check must disable repeat activation');
      await site.selectOption('site-b'); await check.click(); await sp.getByText('Verified for you at the time shown', { exact: true }).waitFor();
      await page.evaluate(() => window.__connectionsFixture.release(0));
      await page.waitForFunction(() => document.querySelector('#connection-sharepoint-resource')?.value === 'site-b');
      await libraries.click(); await library.selectOption('library-49');
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.filter(c => c.kind === 'libraries').at(-1).args[0]), 'site-b', 'Late old-site evidence must not drive newer metadata reads');
      // A late file result after Cancel must not revive evidence or private metadata.
      await page.evaluate(() => { window.__connectionsFixture.holdNext = 'items'; }); await items.click();
      await page.waitForFunction(() => window.__connectionsFixture.pending.length === 2);
      await sp.getByRole('button', { name: 'Cancel request', exact: true }).click();
      await page.evaluate(() => window.__connectionsFixture.release(1, { items: [{ id: 'late', name: 'LATE CANCELLED PRIVATE', kind: 'file', size: 1, lastModifiedAt: null }] }));
      await sp.getByText('Cancelled locally.', { exact: false }).waitFor();
      assert.equal(await sp.getByRole('alert').count(), 0, 'User cancellation must not report a provider failure');
      assert.equal(await sp.getByText('LATE CANCELLED PRIVATE', { exact: true }).count(), 0);
      assert.equal(await sp.getByText('Verified for you at the time shown', { exact: true }).count(), 0);
      // Both authenticated user and provider binding must fail closed.
      for (const patch of [{ userId: 'other-user' }, { serviceId: 'mail' }]) {
        await page.evaluate(value => { window.__connectionsFixture.nextPatch = { kind: 'check', value }; }, patch);
        await check.click(); await sp.getByText('Status unavailable', { exact: true }).waitFor();
        assert.equal(await sp.getByRole('button', { name: 'List approved libraries', exact: true }).count(), 0);
      }
      await check.click(); await libraries.click(); await library.selectOption('library-49');
      await page.evaluate(() => { window.__connectionsFixture.nextPatch = { kind: 'items', value: { serviceId: 'powerbi' } }; });
      await items.click(); await sp.getByText('Status unavailable', { exact: true }).waitFor();
      assert.equal(await sp.getByText('Synthetic policy.pdf', { exact: true }).count(), 0);
      // Logout/account change clears old metadata and discards an already-started old-user response.
      await check.click(); await libraries.click(); await library.selectOption('library-49');
      await page.evaluate(() => { window.__connectionsFixture.holdNext = 'items'; }); await items.click();
      await page.waitForFunction(() => window.__connectionsFixture.pending.length === 3);
      await page.evaluate(() => window.__setConnectionUser('synthetic-b'));
      await site.waitFor(); await page.waitForFunction(() => document.querySelector('#connection-sharepoint-resource')?.value === '');
      await page.evaluate(() => window.__connectionsFixture.release(2, { items: [{ id: 'old', name: 'OLD USER PRIVATE', kind: 'file', size: 1, lastModifiedAt: null }] }));
      assert.equal(await sp.getByText('OLD USER PRIVATE', { exact: true }).count(), 0);
      assert.equal(await sp.getByText('Verified for you at the time shown', { exact: true }).count(), 0);
      assert.equal(await sp.getByRole('button', { name: 'List metadata', exact: true }).count(), 0);
      await site.selectOption('site-a'); await check.click(); await libraries.click(); await library.selectOption('library-49'); await items.click();
      await sp.getByText('Synthetic policy.pdf', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__connectionsFixture.calls.at(-1).userId), 'synthetic-b');
      // Staff setup flow is parse/ticket only; it must not invoke check/list provider operations.
      const setup=page.getByRole('region',{name:'Request a SharePoint connection'});const beforeSetup=await page.evaluate(()=>window.__connectionsFixture.calls.length);
      await setup.getByLabel('SharePoint site or library link').fill('https://example.sharepoint.com/sites/IT/Documents/Forms/AllItems.aspx');
      await setup.getByRole('button',{name:'Check link format',exact:true}).click();await setup.getByText('This is a normalized request, not a verified site.',{exact:false}).waitFor();
      await setup.getByRole('button',{name:'Submit setup request to IT',exact:true}).click();await setup.getByText('IT-SYNTHETIC',{exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(start=>window.__connectionsFixture.calls.slice(start).map(c=>c.kind),beforeSetup),['setupPreview','setupRequest']);
      assert.equal(await page.evaluate(()=>localStorage.getItem('prima:sharepoint-setup:synthetic-b')),null,'Confirmed request retires only its recovery marker');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, 'Mobile/desktop page must not overflow horizontally');
      assert.equal(forbiddenRequests, 0, 'No external or real API requests permitted'); assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Connections desktop/mobile StrictMode, explicit reads, 50 libraries, races, identity binding and keyboard scenarios passed.');
  }
} finally {
  // Let Vite finish dependency transforms before closing its optimizer.
  await new Promise(done => setTimeout(done, 1000));
  if (browser) await browser.close(); if (server) await server.close(); await rm(dir, { recursive: true, force: true });
}
