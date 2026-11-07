// Exact TSX evaluated with controlled React/media mocks; no physical camera/browser coverage.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/views/ScanBox.tsx'),'utf8')+'\nexport { CameraReader };\n';
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const flush=()=>new Promise(r=>setImmediate(r));
async function run(lateMedia){
 const refs=[];let effect,resolveMedia,resolveDetection,stops=0,reads=0;
 const React={useRef:x=>{const r={current:x};refs.push(r);return r},useState:x=>[x,()=>{}],useEffect:f=>{effect=f},createElement:()=>({})};
 const output={};
 vm.runInNewContext(compiled,{exports:output,React,require:id=>id==='react'?React:id==='@prima/core'?{parseScan:()=>({ok:true})}:()=>{},window:{BarcodeDetector:class{detect(){return new Promise(r=>resolveDetection=r)}}},navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolveMedia=r)}},setTimeout});
 output.CameraReader({onRead:()=>reads++});refs[0].current={play:async()=>{}};
 const cleanup=effect(),stream={getTracks:()=>[{stop:()=>stops++}]};
 if(lateMedia){cleanup();refs[0].current=null;resolveMedia(stream)}
 else {resolveMedia(stream);await flush();cleanup();refs[0].current=null;resolveDetection([{rawValue:'valid mock label'}])}
 await flush();assert.equal(stops,1);assert.equal(reads,0);
}
(async()=>{await run(true);await run(false);console.log('PASS: late camera stream stopped and late detector callback suppressed (mock APIs only).')})().catch(e=>{console.error(e);process.exitCode=1});
