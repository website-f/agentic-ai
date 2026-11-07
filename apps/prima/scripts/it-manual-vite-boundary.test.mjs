// Actual Vite module-boundary regression; no browser, server listener or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=await readFile(resolve(root,'scripts/it-manual-browser-smoke.mjs'),'utf8');
const harness=source.match(/const harness=`([\s\S]*?)`;/)?.[1];assert.ok(harness,'Use the actual manual fixture');
function config(dir){const raw=source.match(/server=await createServer\((\{[^\n]+\})\);/)?.[1];assert.ok(raw,'Use the actual manual Vite configuration');return Function('dir','root','resolve',`return (${raw})`)(dir,root,resolve);}
function plugin(text){const match=text.match(/plugins:\[({name:'manual-synthetic-only'[\s\S]*?)\]\}\);/);assert.ok(match,'Use actual browser fixture plugin');return Function(`return (${match[1]})`)();}
async function probe(p,check){const dir=await mkdtemp(resolve(root,'.manual-boundary-'));let server;try{server=await createServer({configFile:false,root,cacheDir:resolve(dir,'.cache'),logLevel:'silent',esbuild:{jsx:'automatic'},optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false},plugins:[p]});await check(server);}finally{await server?.close();await rm(dir,{recursive:true,force:true});}}
test('all actual manual child view imports stay in the synthetic App/API boundary',async()=>{
 await probe(plugin(source),async server=>{
  for(const name of ['ItManual','ItCorrections','ItCleanup']){
   const importer=resolve(root,`apps/web/src/views/${name}.tsx`);
   assert.equal((await server.pluginContainer.resolveId('../App',importer)).id,'\0manual-app',name);
   assert.equal((await server.pluginContainer.resolveId('../api',importer)).id,'\0manual-api',name);
   const transformed=await server.transformRequest(`/apps/web/src/views/${name}.tsx`);
   assert.ok(transformed.code.includes('__x00__manual-app'),name);
   assert.ok(transformed.code.includes('__x00__manual-api'),name);
   assert.doesNotMatch(transformed.code,/from ["'][^"']*\/src\/App(?:\.tsx)?["']/);
  }
 });
});
test('negative control reproduces the old cleanup child escaping to real application modules',async()=>{
 const old=source.replaceAll("||importer?.endsWith('/src/views/ItCleanup.tsx')",'');assert.notEqual(old,source);
 await probe(plugin(old),async server=>{const importer=resolve(root,'apps/web/src/views/ItCleanup.tsx');const app=await server.pluginContainer.resolveId('../App',importer),api=await server.pluginContainer.resolveId('../api',importer);assert.ok(app.id.endsWith('/src/App.tsx'));assert.ok(api.id.includes('/src/api/'));});
});
test('manual behavior assertions and external-request refusal remain present',()=>{
 for(const text of ["assert.equal(calls.length,1)","assert.equal(calls[0].input.personUserId,'person-1')","assert.equal((await writes()).length,0,'Recovery never issues a create')","assert.equal(external,0)","assert.deepEqual(errors,[])","width:390,height:844","return r.abort()"] )assert.ok(source.includes(text),text);
});
test('manual fixture owns its Vite cache and prebundles both React JSX runtimes',()=>{
 const a=config('/tmp/manual-a'),b=config('/tmp/manual-b');
 assert.equal(a.cacheDir,resolve('/tmp/manual-a','.vite-cache'));assert.notEqual(a.cacheDir,b.cacheDir);
 assert.deepEqual(a.optimizeDeps.entries,['/tmp/manual-a/main.tsx']);
 assert.deepEqual(a.optimizeDeps.include,['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']);
});
test('actual manual fixture transforms within the synthetic boundary before browser startup',async()=>{
 const dir=await mkdtemp(resolve(root,'.manual-startup-'));let server;
 try{
  await writeFile(resolve(dir,'main.tsx'),harness);const actual=config(dir);
  server=await createServer({...actual,optimizeDeps:{entries:[],noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,preTransformRequests:false,fs:{allow:[root]}}});
  const transformed=await server.transformRequest('/main.tsx');assert.ok(transformed?.code.includes('ItManualPanel'));
  for(const name of ['ItManual','ItCorrections','ItCleanup']){
   const view=await server.transformRequest('/@fs/'+resolve(root,`apps/web/src/views/${name}.tsx`));
   assert.ok(view.code.includes('__x00__manual-app'));assert.ok(view.code.includes('__x00__manual-api'));
  }
  for(const id of ['manual-app','manual-api'])assert.ok((await server.transformRequest('\0'+id))?.code);
  const launch=source.indexOf('browser=await chromium.launch');
  for(const step of ["server.transformRequest('/main.tsx')","server.waitForRequestsIdle()"]){const at=source.indexOf(step);assert.ok(at>=0&&at<launch,step+' must complete before browser launch');}
 }finally{await server?.close();await rm(dir,{recursive:true,force:true});}
});
test('manual startup failures retain evidence without retrying or weakening interaction checks',()=>{
 for(const text of ["Synthetic manual IT failure diagnostics","kind:'pageerror'","kind:'console'","kind:'requestfailed'","kind:'http'","kind:'page-snapshot'","throw error;","assert.deepEqual(errors,[])","assert.equal(external,0)"])assert.ok(source.includes(text),text);
 assert.doesNotMatch(source,/setDefaultTimeout|setDefaultNavigationTimeout|waitForTimeout/);
});
