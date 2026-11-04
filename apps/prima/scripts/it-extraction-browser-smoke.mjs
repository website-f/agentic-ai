// Synthetic component-only browser test. Never loads live API, Azure or Graph.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.env.CI_SYNTHETIC_BROWSER!=='true')throw Error('Set CI_SYNTHETIC_BROWSER=true for synthetic local-only fixture.');
const dir=await mkdtemp(resolve(root,'.extraction-browser-'));
const apiCode=`export const api={
 itExtractionStatus:async()=>({enabled:true,configured:true,permitted:true,sourceTypes:['paste'],dataClasses:['synthetic'],previewOnly:true}),
 itExtractionPreview:async input=>{window.__previewCalls=(window.__previewCalls||0)+1;window.__lastSelectedText=input.source.text;return {extractionId:'synthetic',kind:input.kind,source:{label:input.source.label,sha256:'a'.repeat(64),canonicalText:input.source.text.replace(/\\r\\n?/g,'\\n')},rows:[{row:1,fields:{title:{raw:input.source.text,start:0,end:input.source.text.length},priority:{raw:null,start:null,end:null}},errors:['MISSING_priority'],warnings:['HUMAN_REVIEW_REQUIRED']}],readyForT9Preview:false,operationalWrites:0,expiresAt:'2030-01-01T00:00:00Z',warnings:[]};}
};`;
let server,browser;
try{
 await writeFile(resolve(dir,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
 await writeFile(resolve(dir,'main.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{ItExtractionView}from'../apps/web/src/views/ItExtraction';import '../apps/web/src/styles.css';createRoot(document.getElementById('root')).render(<React.StrictMode><ItExtractionView userId="u-fauzan"/></React.StrictMode>);`);
 server=await createServer({configFile:false,root:dir,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},plugins:[{name:'synthetic-extraction-api',enforce:'pre',resolveId(id,importer){if(id==='../api'&&importer?.endsWith('/views/ItExtraction.tsx'))return'\0synthetic-extraction-api';},load(id){if(id==='\0synthetic-extraction-api')return apiCode;}}]});
 await server.listen();const address=server.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
 const response=await fetch(origin+'/main.tsx');assert.equal(response.status,200);const entry=await response.text();assert(entry.includes('ItExtractionView'));
 const componentPath=entry.match(/from\s+["']([^"']*\/views\/ItExtraction\.tsx[^"']*)["']/)?.[1];assert(componentPath,'component import missing');
 const componentResponse=await fetch(new URL(componentPath,origin));assert.equal(componentResponse.status,200);
 const component=await componentResponse.text();
 assert(component.includes('/@id/__x00__synthetic-extraction-api'),'Component must use virtual synthetic API, not real API');
 assert(!/from\s+["'][^"']*\/api\/index/.test(component),'Real API module must never be imported');
 const mockResponse=await fetch(origin+'/@id/__x00__synthetic-extraction-api');assert.equal(mockResponse.status,200);assert((await mockResponse.text()).includes('__previewCalls'));await new Promise(resolve=>setTimeout(resolve,1000));if(process.argv.includes('--server-check')){console.log('Synthetic Vite harness transforms successfully; no browser assertions executed.');}
 else{
  if(!process.env.PLAYWRIGHT_MODULE)throw Error('PLAYWRIGHT_MODULE required; no browser installation performed.');
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   const page=await browser.newPage({viewport});let external=0;
   const bootErrors=[];
   page.on('pageerror',error=>{bootErrors.push(error.message);console.error('Synthetic pageerror:',error.message);});
   page.on('console',message=>{if(message.type()==='error')console.error('Synthetic consoleerror:',message.text());});
   page.on('requestfailed',request=>console.error('Synthetic requestfailed:',new URL(request.url()).pathname,request.failure()?.errorText));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin&&!u.pathname.startsWith('/api/'))return route.continue();external++;return route.abort();});
   await page.goto(origin);await page.getByLabel('Selected source text').fill('UAT printer offline');
   const generate=page.getByRole('button',{name:'Generate AI preview'});assert.equal(await generate.isEnabled(),false);
   await page.getByRole('checkbox').check();await generate.click();await page.getByRole('heading',{name:'Review proposed fields'}).waitFor();
   assert.equal(await page.evaluate(()=>window.__previewCalls),1);assert.equal(await page.evaluate(()=>window.__lastSelectedText),'UAT printer offline');
   await page.getByRole('region',{name:'Extracted proposal'}).getByRole('textbox',{name:'title',exact:true}).fill('Edited locally');await page.getByText('Edited locally — evidence has not been updated or revalidated.',{exact:false}).waitFor();
   assert.equal(await page.getByRole('button',{name:/^(Save|Import|Approve)$/}).count(),0);
   await page.getByLabel('Selected source text').fill('Different source');assert.equal(await page.getByRole('heading',{name:'Review proposed fields'}).count(),0);assert.equal(await page.getByRole('checkbox').isChecked(),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true);assert.equal(external,0);assert.deepEqual(bootErrors,[]);await page.close();
  }
  console.log('Synthetic extraction desktop/mobile consent, evidence, edits and invalidation passed.');
 }
}catch(error){console.error('Synthetic extraction harness failure:',error);throw error;}finally{await new Promise(resolve=>setTimeout(resolve,1000));if(browser)await browser.close();if(server)await server.close();await rm(dir,{recursive:true,force:true});}
