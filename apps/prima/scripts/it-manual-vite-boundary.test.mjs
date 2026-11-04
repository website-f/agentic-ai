// Actual Vite module-boundary regression; no browser, server listener or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=await readFile(resolve(root,'scripts/it-manual-browser-smoke.mjs'),'utf8');
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
