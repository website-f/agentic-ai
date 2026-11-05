// Microsoft 365 Connections panel in a real browser, StrictMode, two synthetic identities, synthetic API only.
// No Microsoft, tenant or live service is contacted. Screenshots go to M365_UAT_DIR when set.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.CI_SYNTHETIC_BROWSER !== 'true') throw Error('Set CI_SYNTHETIC_BROWSER=true for the synthetic-only fixture.');
if (!process.env.PLAYWRIGHT_MODULE) throw Error('PLAYWRIGHT_MODULE is required; this script never installs a browser.');
const shots = process.env.M365_UAT_DIR ? resolve(process.env.M365_UAT_DIR) : null;
const dir = await mkdtemp(resolve(root, '.m365-browser-'));
// A synthetic Prima API that follows the server rules: per-person status, company-scoped teams, one call per click.
const apiCode = `
export class ApiError extends Error { constructor(message,status=500,findings=[]){super(message);this.status=status;this.findings=findings;} }
const now='2026-11-03T01:00:00.000Z',until='2026-11-03T09:00:00.000Z';
const people={'u-alya':{teams:[{key:'sasa-ops',name:'Synthetic Sasa team'}],sites:[{key:'sasa-site',name:'Synthetic Sasa site'}],member:['private','standard'],consent:true},
 'u-badri':{teams:[{key:'inas-ops',name:'Synthetic Inas team'}],sites:[],member:[],consent:false}};
const f=window.__m365={userId:'u-alya',calls:[],stored:{},hold:null,pending:[]};
const key=(s)=>f.userId+'|'+s;
function status(service){const p=people[f.userId];const resources=service==='teams'?p.teams:service==='sharepoint'?p.sites:[];
 if(service==='sharepoint'&&!resources.length)return{service,state:'not_configured',reason:'NoApprovedResources',resources:[],actions:[]};
 const r=f.stored[key(service)];if(!r)return{service,state:'configured',reason:'NotChecked',resources,actions:['check']};
 if(r==='disconnected')return{service,state:'configured',reason:'Disconnected',resources,actions:['check']};
 if(r==='consent')return{service,state:'consent_needed',reason:'ConsentRequired',resources,checkedAt:now,actions:['reconnect','disconnect']};
 return{service,state:'connected',reason:'Verified',resources,checkedAt:now,validUntil:until,resourceKey:r.resourceKey,actions:['check','disconnect']};}
const guidance={capabilities:Object.fromEntries(['outlook','teams','sharepoint'].map(s=>[s,{why:{bm:'Contoh sebab '+s,en:'Synthetic reason '+s},data:{bm:'Data contoh',en:'Synthetic data'},whereToGetLink:{bm:'Pautan contoh',en:'Synthetic link'},whoHelps:{bm:'Meja IT',en:'IT desk'},delegatedScopes:[{scope:s==='outlook'?'Mail.ReadBasic':s==='teams'?'Team.ReadBasic.All':'Sites.Selected'}]}]))};
async function handle(method,path,body){
 f.calls.push({userId:f.userId,method,path,body});
 if(f.hold===path){f.hold=null;await new Promise(r=>f.pending.push(r));}
 if(method==='GET'&&path==='/connections/m365/status')return{userId:f.userId,services:['outlook','teams','sharepoint'].map(status),teamsApprovals:{state:'not_built',canApplyApprovals:false}};
 if(method==='GET'&&path==='/connections/m365/matrix')return guidance;
 let m=path.match(/^\\/connections\\/m365\\/(outlook|teams|sharepoint)\\/check$/);
 if(m){const p=people[f.userId];if(m[1]==='outlook'&&!p.consent){f.stored[key('outlook')]='consent';return status('outlook');}
  if(f.stored[key(m[1])]!=='disconnected-late')f.stored[key(m[1])]={resourceKey:body.resourceKey};return status(m[1]);}
 m=path.match(/^\\/connections\\/m365\\/(outlook|teams|sharepoint)\\/disconnect$/);
 if(m){f.stored[key(m[1])]='disconnected';return status(m[1]);}
 if(path==='/connections/m365/teams/link'){
  if(!/^https:\\/\\/teams\\.microsoft\\.com\\/l\\/channel\\//.test(body.url))throw new ApiError('bad',400);
  const type=body.url.includes('private')?'private':body.url.includes('shared')?'shared':'standard';
  if(body.url.includes('inas')&&f.userId==='u-alya')return{service:'teams',userId:f.userId,outcome:'WrongCompany',checkedAt:now,status:status('teams')};
  if(!people[f.userId].member.includes(type))return{service:'teams',userId:f.userId,outcome:'NotAMember',checkedAt:now,status:status('teams')};
  return{service:'teams',userId:f.userId,outcome:'Verified',checkedAt:now,verifiedScope:'channel',membershipType:type,openUrl:'https://teams.microsoft.com/l/channel/19%3Asynthetic%40thread.tacv2/channel?groupId=c0000000-0000-4000-8000-000000000001&tenantId=11111111-2222-3333-4444-555555555555',resourceKey:'sasa-ops',status:status('teams')};}
 throw Error('Unapproved synthetic action '+path);
}
export const api={
 m365Call:async(expectedUserId,method,path,body)=>{if(expectedUserId!==f.userId)throw Error('Wrong owner');if(path.startsWith('/connections/m365/'))return handle(method,path,body);
  if(path==='/connections/mail/jobs/status')return{serviceId:'mail',userId:f.userId,status:'NotConfigured',keepDays:30,setupReason:'FeatureDisabled',providerVerified:false,setupRequest:null};throw Error('Unapproved mail action');},
 m365Reauthenticate:async(claims)=>{f.reauth=(f.reauth||0)+1;},
 sharePointRequestPreview:async()=>{throw Error('not used');},sharePointRequest:async()=>{throw Error('not used');},
 sharePointRequests:async()=>({serviceId:'sharepoint',userId:f.userId,requests:[]}),
 sharePointStatus:async()=>({serviceId:'sharepoint',userId:f.userId,status:'NotConfigured',sites:[]}),
 sharePointCheck:async()=>{throw Error('not used');},sharePointLibraries:async()=>{throw Error('not used');},sharePointItems:async()=>{throw Error('not used');}
};`;
let server, browser;
const results = [];
try {
  await writeFile(resolve(dir, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(resolve(dir, 'main.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ConnectionsView}from'../apps/web/src/views/Connections';import '../apps/web/src/styles.css';function Fixture(){const[userId,setUserId]=useState('u-alya');window.__setUser=id=>{window.__m365.userId=id;setUserId(id);};return <ConnectionsView key={userId} userId={userId}/>;}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
  server = await createServer({ configFile: false, root: dir, cacheDir: resolve(dir, '.vite-cache'), optimizeDeps: { entries: [resolve(dir, 'main.tsx')], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error', esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } }, plugins: [{ name: 'synthetic-m365-api', enforce: 'pre', resolveId(id, importer) { if ((id === '../api' && importer?.endsWith('/views/Connections.tsx')) || (id === './api' && importer?.endsWith('/src/ui.tsx'))) return '\0synthetic-m365-api'; }, load(id) { if (id === '\0synthetic-m365-api') return apiCode; } }] });
  await server.listen();
  // Prebundle and transform before the browser opens, so Vite never reloads the page mid-test (CI flake, 3 Nov 2026).
  await server.transformRequest('/main.tsx');
  await server.waitForRequestsIdle();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const tag = String(viewport.width);
    const page = await browser.newPage({ viewport });
    const errors = []; let outside = 0;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === origin) return route.continue(); outside++; return route.abort(); });
    const shot = async name => { if (shots) await page.screenshot({ path: resolve(shots, `${tag}-${name}.png`), fullPage: true }); };
    const step = (name, ok = true) => results.push({ viewport: tag, step: name, ok });
    await page.goto(origin);
    const panel = page.getByRole('region', { name: 'Your Microsoft 365 connections', exact: true });
    const outlook = panel.getByRole('region', { name: 'Outlook', exact: true });
    const teams = panel.getByRole('region', { name: 'Teams', exact: true });
    await outlook.getByRole('status', { name: 'Outlook status: Configured, not checked' }).waitFor();
    assert.equal(await page.evaluate(() => window.__m365.calls.every(c => c.method === 'GET')), true, 'Opening reads Prima status only');
    await shot('01-first-view'); step('A: first view shows configured, not checked; no Microsoft call');

    // A: duplicate clicks while a check is running produce one request.
    await page.evaluate(() => { window.__m365.hold = '/connections/m365/outlook/check'; });
    const check = outlook.getByRole('button', { name: 'Check', exact: true });
    await check.click();
    await page.waitForFunction(() => window.__m365.pending.length === 1);
    assert.equal(await check.isDisabled(), true, 'Check is disabled while running');
    await check.click({ force: true }).catch(() => {});
    await page.evaluate(() => window.__m365.pending.shift()());
    await outlook.getByRole('status', { name: 'Outlook status: Connected' }).waitFor();
    assert.equal(await page.evaluate(() => window.__m365.calls.filter(c => c.path === '/connections/m365/outlook/check').length), 1);
    await shot('02-outlook-connected'); step('A: duplicate click sends one check; Outlook connected with time shown');

    // A: Teams private channel (member) verified; shared channel (not a member) refused; other company refused.
    const linkBox = teams.getByRole('textbox', { name: 'Check a Teams channel link' });
    await linkBox.fill('https://teams.microsoft.com/l/channel/19%3Aprivate%40thread.tacv2/x?groupId=g&tenantId=t');
    await teams.getByRole('button', { name: 'Check link' }).click();
    await teams.getByText('Channel type: private.').waitFor();
    const open = teams.getByRole('link', { name: 'Open in Teams (new tab)' });
    assert.equal(await open.getAttribute('target'), '_blank');
    await teams.getByText('this channel only (not the whole team)', { exact: false }).waitFor();
    await teams.getByRole('status', { name: 'Teams status: Configured, not checked' }).waitFor();
    await shot('03-teams-private-verified'); step('A: private channel link verified for a member (channel only, team status unchanged); opens in Teams');
    await linkBox.fill('https://teams.microsoft.com/l/channel/19%3Ashared%40thread.tacv2/x?groupId=g&tenantId=t');
    await teams.getByRole('button', { name: 'Check link' }).click();
    await teams.getByText('you are not a member of this channel', { exact: false }).waitFor();
    await shot('04-teams-shared-not-member'); step('A: shared channel link refused (not a member)');
    await linkBox.fill('https://teams.microsoft.com/l/channel/19%3Ainas%40thread.tacv2/x?groupId=g&tenantId=t');
    await teams.getByRole('button', { name: 'Check link' }).click();
    await teams.getByText('belongs to a company you do not work with', { exact: false }).waitFor();
    step('A: other company team link refused');
    await linkBox.fill('https://example.sharepoint.com/:w:/s/x');
    await teams.getByRole('button', { name: 'Check link' }).click();
    await teams.getByText('That is not a Teams channel link', { exact: false }).waitFor();
    step('A: wrong kind of link explained');

    // A: disconnect Outlook; then reconnect by checking again.
    await outlook.getByRole('button', { name: 'Disconnect' }).click();
    await outlook.getByText('Prima has forgotten its check for you', { exact: false }).waitFor();
    await outlook.getByText('does not remove the Microsoft permission', { exact: false }).waitFor();
    await outlook.getByRole('status', { name: 'Outlook status: Configured, not checked' }).waitFor();
    await shot('05-outlook-disconnected'); step('A: disconnect forgets the check; no tokens shown');
    await outlook.getByRole('button', { name: 'Check', exact: true }).click();
    await outlook.getByRole('status', { name: 'Outlook status: Connected' }).waitFor();
    step('A: reconnect by checking again');

    // Guidance in Bahasa Melayu and English.
    await outlook.getByText('Kenapa sambungan ini? / Why this connection?').click();
    await outlook.getByText('Contoh sebab outlook').waitFor();
    step('Guidance shows BM and English');

    // Switch to identity B: nothing of A's status is visible; B's Outlook needs consent.
    await page.evaluate(() => window.__setUser('u-badri'));
    const outlookB = page.getByRole('region', { name: 'Your Microsoft 365 connections', exact: true }).getByRole('region', { name: 'Outlook', exact: true });
    await outlookB.getByRole('status', { name: 'Outlook status: Configured, not checked' }).waitFor();
    assert.equal(await page.getByText('Synthetic Sasa team').count(), 0, 'B never sees A\'s team');
    await outlookB.getByRole('button', { name: 'Check', exact: true }).click();
    await outlookB.getByRole('status', { name: 'Outlook status: Consent needed' }).waitFor();
    await outlookB.getByRole('button', { name: 'Reconnect' }).click();
    await page.waitForFunction(() => window.__m365.reauth === 1);
    await shot('06-identity-b-consent-needed'); step('B: separate status; consent needed offers Reconnect (Microsoft sign-in)');
    const teamsB = page.getByRole('region', { name: 'Teams', exact: true });
    const boxB = teamsB.getByRole('textbox', { name: 'Check a Teams channel link' });
    await boxB.fill('https://teams.microsoft.com/l/channel/19%3Aprivate%40thread.tacv2/x?groupId=g&tenantId=t');
    await teamsB.getByRole('button', { name: 'Check link' }).click();
    await teamsB.getByText('you are not a member of this channel', { exact: false }).waitFor();
    step('B: private channel refused for a non-member');
    await page.evaluate(() => window.__setUser('u-alya'));
    step('Switching back to A shows A\'s own status only');

    assert.equal(await page.getByText(/access_token|GRAPH_|client_secret/).count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(outside, 0, 'No request left the synthetic origin');
    step('No page errors, no tokens shown, no outside requests');
    await page.close();
  }
  console.log(JSON.stringify(results, null, 1));
  if (shots) await writeFile(resolve(shots, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`M365 Connections browser run passed: ${results.length} steps.`);
} finally {
  await browser?.close();
  await server?.close();
  await rm(dir, { recursive: true, force: true });
}
