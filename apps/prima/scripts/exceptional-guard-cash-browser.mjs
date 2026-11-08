// Actual demo UI + real core, synthetic data only; no external API/provider requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const {generateDataset,myt}=require('../packages/core/dist');
if(process.env.CI_SYNTHETIC_BROWSER!=='true'||!process.env.PLAYWRIGHT_MODULE||!process.env.CASH_WORKBOOK_PYTHON) throw Error('Synthetic opt-in and pinned browser required');
const out=new URL('../artifacts/exceptional-cash/',import.meta.url);await mkdir(out,{recursive:true});
const html=await readFile(new URL('../apps/web/dist-demo/index.html',import.meta.url));
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);const browser=await chromium.launch({headless:true});
const today='2026-10-31',now=myt(today,'12:00'),ds=generateDataset({today,now,daysBack:40});
const site=ds.sites.find(s=>s.companyId==='co-sasa'&&['Selangor','Kuala Lumpur'].includes(ds.branches.find(b=>b.id===s.branchId)?.state??s.state??'')&&ds.shifts.some(sh=>sh.siteId===s.id&&sh.date===today&&ds.people.some(p=>p.id===sh.personId&&p.role==='guard'&&p.status==='active')));
const guard=ds.people.find(p=>p.role==='guard'&&p.status==='active'&&ds.shifts.some(sh=>sh.personId===p.id&&sh.siteId===site.id&&sh.date===today));
const doc=s=>({name:s+'.pdf',data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nSYNTHETIC '+s+'\n%%EOF').toString('base64')});
const input={version:1,batchId:'browser-batch',workbookRef:'Synthetic controlled Excel handover',rows:[{personId:guard.id,siteId:site.id,occasion:today,amount:150,reason:'Additional payroll support',request:{byId:'u-om-klang',at:myt(today,'08:00'),evidence:doc('OM')},approval:{id:'browser-approval',byId:'u-fauzan',at:myt(today,'09:00'),evidence:doc('CEO')}}]};
const finance=ds.users.find(u=>u.financeTeam===ds.finStatus.find(f=>f.companyId===site.companyId).team&&u.financeRole==='leader').id;
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.clock.setFixedTime(new Date(now));const errors=[];page.on('pageerror',e=>errors.push(e.message));let external=0;
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin)return r.continue();if(u.origin!=='https://fonts.googleapis.com')external++;return r.abort();});
  const as=async(uid,doa=false)=>{
    await page.setViewportSize({width:1440,height:1000});await page.goto(origin);await page.evaluate(u=>{localStorage.setItem('prima-demo-user',u);localStorage.setItem('prima-demo-all-staff','1');},uid);await page.reload();
    await page.getByRole('button',{name:/Saya setuju|I agree/}).click({timeout:2500}).catch(()=>{});await page.getByRole('button',{name:'EN',exact:true}).click({timeout:1500}).catch(()=>{});
    if(doa){await page.getByRole('button',{name:'Director Office',exact:true}).first().click();await page.getByLabel('Cash handover company').selectOption(site.companyId);}
    else {await page.getByRole('button',{name:'Finance',exact:true}).first().click();await page.getByRole('tab',{name:/^Checks/}).first().click();await page.locator('label.field:has-text("Company") select').first().selectOption(site.companyId);await page.getByRole('tab',{name:/^Paying out/}).click();}
    const panel=page.getByRole('region',{name:'Exceptional guard cash',exact:true});await panel.getByRole('heading',{name:'Exceptional guard cash',exact:true}).waitFor();await page.setViewportSize({width,height:1000});return panel;
  };
  let panel=await as('u-pwvsb-doa',true);
  assert.equal(await panel.getByLabel('Upload approved handover').isDisabled(),true);
  const local=await mkdtemp(join(tmpdir(),'prima-synthetic-workbook-'));
  try {
    const event=page.waitForEvent('download');await panel.getByRole('button',{name:'Download scoped workbook refresh',exact:true}).click();
    await (await event).saveAs(join(local,'master.json'));
    const snapshot=JSON.parse(await readFile(join(local,'master.json'),'utf8'));assert.equal(snapshot.companyId,site.companyId);assert.deepEqual(Object.keys(snapshot).sort(),['companyId','kind','master','refreshedAt','submitted','version']);
    assert(snapshot.master.every(p=>Object.keys(p).sort().join(',')==='assignments,companyId,name,personId,staffNo'));
    const run=(...args)=>execFileSync(process.env.CASH_WORKBOOK_PYTHON,['scripts/cash_workbook.py',...args],{stdio:'pipe'});
    run('refresh','--source',join(local,'master.json'),'--output',join(local,'approved.xlsx'));
    await writeFile(join(local,'input.json'),JSON.stringify(input));
    for(const kind of ['request','approval']) await writeFile(join(local,kind+'.pdf'),Buffer.from(input.rows[0][kind].evidence.data.split(',')[1],'base64'));
    execFileSync(process.env.CASH_WORKBOOK_PYTHON,['-c',`import json,sys
from openpyxl import load_workbook
from pathlib import Path
p=Path(sys.argv[1]);b=json.loads((p/'input.json').read_text());r=b['rows'][0];w=load_workbook(p/'approved.xlsx');w['Control']['B6']=b['batchId'];w['Control']['B7']=b['workbookRef']
v=[r['personId'],r['siteId'],r['occasion'],r['amount'],r['reason'],r['request']['byId'],r['request']['at'],'request.pdf',r['approval']['id'],r['approval']['byId'],r['approval']['at'],'approval.pdf']
for c,x in enumerate(v,1):w['Approved list'].cell(2,c,x)
w.save(p/'approved.xlsx')`,local]);
    const common=['--source',join(local,'master.json'),'--workbook',join(local,'approved.xlsx'),'--evidence-dir',local];
    run('seal',...common,'--evidence-checked','--checked-by','synthetic-doa','--output',join(local,'scope.json'));
    run('convert',...common,'--approved-scope',join(local,'scope.json'),'--output-dir',join(local,'converted'));
    await panel.getByLabel(/I checked each manual/).check();await panel.getByLabel('Upload approved handover').setInputFiles(join(local,'converted/handover.json'));
  } finally {await rm(local,{recursive:true,force:true});}
  await panel.getByRole('heading',{name:new RegExp(guard.staffNo)}).waitFor();assert.match(await panel.innerText(),/Actual payment: Not recorded/);
  // Replay is a refusal, never a second row.
  await panel.getByLabel('Upload approved handover').setInputFiles({name:'duplicate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});await panel.getByText(/Batch already submitted/).waitFor();assert.equal(await panel.locator('article').count(),1);
  panel=await as(finance);assert.equal(await panel.getByLabel('Upload approved handover').count(),0);
  await panel.getByLabel('Reference',{exact:true}).fill('withdrawal');await panel.getByLabel('Finance custodian account ID').fill(finance);await panel.getByRole('button',{name:'Record cash preparation and custody'}).click();
  await panel.getByLabel('Actual amount paid').fill('120');await panel.getByLabel('Reference',{exact:true}).fill('payment');await panel.getByLabel(/Actual payment timestamp/).fill(now);await panel.getByLabel('Payment or reconciliation evidence').setInputFiles({name:'payment.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC actual payment')});await panel.getByRole('button',{name:'Record actual payment',exact:true}).click();await panel.getByText(/Actual payment: RM120.00/).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Record payroll accounting'}).count(),0);
  panel=await as('u-pwvsb-doa',true);await panel.getByLabel(/Receipt signing timestamp/).fill(now);await panel.getByLabel(/This scan, photo or electronic acknowledgement/).check();await panel.getByLabel('Transaction-specific acknowledgement (scan, photo or electronic PDF)').setInputFiles({name:'signed.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC transaction-specific signed receipt')});await panel.getByRole('button',{name:'Upload signed acknowledgement'}).click();await panel.getByText(/Signed receipt: Collected/).waitFor();
  panel=await as('u-fd');await panel.getByLabel('Reference',{exact:true}).fill('deposit');await panel.getByLabel('Cash returned and counted').fill('30');await panel.getByLabel('Payment or reconciliation evidence').setInputFiles({name:'return.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC return count')});await panel.getByRole('button',{name:'Record cash return and reconciliation'}).click();
  await panel.getByLabel('Reference',{exact:true}).fill('journal-line');await panel.getByLabel('Payroll accounting / pending-treatment register reference').fill('supplemental-payroll-record');await panel.getByLabel(/I verified the manual journal/).check();await panel.getByLabel('Payment or reconciliation evidence').setInputFiles({name:'accounting.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC payroll and statutory records')});await panel.getByRole('button',{name:'Record payroll accounting'}).click();
  await panel.getByText(/Treatment: pending/).waitFor();assert.equal(await panel.getByRole('button',{name:'Mark complete'}).count(),0);assert.match(await panel.innerText(),/Salary cost – cash payment RM120.00/);
  await panel.getByLabel('Finance/adviser treatment decision reference').fill('synthetic-adviser-review');await panel.getByLabel('Completed payroll/statutory records reference').fill('synthetic-completed-records');await panel.getByLabel(/Finance.adviser review is recorded/).check();await panel.getByLabel('Payment or reconciliation evidence').setInputFiles({name:'review.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC reviewed treatment')});await panel.getByRole('button',{name:'Record Finance/adviser treatment review'}).click();await panel.getByRole('button',{name:'Mark complete'}).click();await panel.getByText(/complete · excash/).waitFor();
  const downloaded = page.waitForEvent('download'); await panel.getByRole('button',{name:'Payroll accounting evidence',exact:true}).click(); assert.equal((await downloaded).suggestedFilename(),'accounting.pdf');
  assert.match(await panel.innerText(),/Salary cost – cash payment RM120.00/);assert.equal(await panel.getByRole('button',{name:'Record actual payment',exact:true}).count(),0);
  assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'cash panel fits viewport');
  await panel.screenshot({path:new URL(`complete-${width}.png`,out).pathname});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>localStorage.setItem('prima-demo-user','u-fauzan'));await page.reload();
  await page.getByRole('button',{name:/Saya setuju|I agree/}).click({timeout:2500}).catch(()=>{});
  await page.getByRole('button',{name:'EN',exact:true}).click({timeout:1500}).catch(()=>{});
  await page.getByRole('button',{name:'Regional ops',exact:true}).first().click();
  const pnl=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Private sites: profit, pay and leave',exact:true})});
  await pnl.locator('th').filter({hasText:'Salary cost – cash payment'}).waitFor();
  const siteRow=pnl.getByRole('row').filter({has:page.getByRole('button',{name:site.name,exact:true})});await siteRow.waitFor();assert.match(await siteRow.innerText(),/RM120.00/);assert.match(await siteRow.innerText(),/journal-line/);
  await page.setViewportSize({width,height:1000});await pnl.screenshot({path:new URL(`site-pnl-${width}.png`,out).pathname});
  assert.deepEqual(errors,[]);assert.equal(external,0);await page.close();console.log(`PASS ${width}px: scoped master export → protected Excel → checked scope → conversion → DOA handover, duplicate refusal, Finance custody/payment, DOA receipt, independent return, payroll accounting, complete, site P&L amount and journal trace.`);
 }
} finally {await browser.close();server.close();}
