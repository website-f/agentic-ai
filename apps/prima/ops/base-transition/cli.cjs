'use strict';
// Explicit operator entry only. Never imported by API startup. No provisioning or retries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const OLD='678910162fcf0d878b128df61d291f4742c836b4846c36519e8d9c934598071b',NEXT='4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe',RUNNER='66640286f3da6aadcc4201e23246c97e74a41acf63d9483d8cc8736bb26349fa';
const HOST='psql-prima-staging-sea.postgres.database.azure.com';
const validators=['hr-it-readiness','it-cleanup-readiness','it-manual-readiness','it-operations-readiness','it-workflow-metrics-readiness','procurement-readiness','rental-correction-readiness'];
const paths=['cli.cjs','base-transition.cjs','live.sql','candidate.sql','readiness-manifest.json',...validators.flatMap(n=>['candidate-readiness/'+n+'.ts','candidate-readiness-js/'+n+'.js'])].sort();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifyArtifact(root=__dirname){
 const read=p=>{let q=root;for(const part of p.split('/')){q=path.join(q,part);if(fs.lstatSync(q).isSymbolicLink())throw Error('artifact');}if(!fs.lstatSync(q).isFile())throw Error('artifact');return fs.readFileSync(q);};
 const bytes=read('artifact-manifest.json'),m=JSON.parse(bytes);
 if(m.version!==1||Object.keys(m).sort().join(',')!=='files,newSha,oldSha,runnerSha,version'||m.oldSha!==OLD||m.newSha!==NEXT||m.runnerSha!==RUNNER||!Array.isArray(m.files)||JSON.stringify(m.files.map(x=>x.path))!==JSON.stringify(paths))throw Error('artifact');
 for(const f of m.files)if(Object.keys(f).sort().join(',')!=='path,sha256'||!/^[a-f0-9]{64}$/.test(f.sha256)||sha(read(f.path))!==f.sha256)throw Error('artifact');
 for(const [name,pin]of [['base-transition.cjs',RUNNER],['live.sql',OLD],['candidate.sql',NEXT]])if(sha(read(name))!==pin)throw Error('artifact');
 return {artifactSha:sha(bytes),oldSha:OLD,newSha:NEXT,runnerSha:RUNNER};
}
function parse(args,env,pins){
 if(args.length!==13||args[0]!=='execute')throw Error('input');const keys=['--owner','--artifact-sha','--old-sha','--new-sha','--runner-sha','--confirm'];const v={};for(let n=0;n<keys.length;n++){if(args[1+n*2]!==keys[n])throw Error('input');v[keys[n]]=args[2+n*2];}
 if(!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(v['--owner'])||v['--artifact-sha']!==pins.artifactSha||v['--old-sha']!==OLD||v['--new-sha']!==NEXT||v['--runner-sha']!==RUNNER||v['--confirm']!=='MIGRATE_EXACT_BASE_ONLY')throw Error('input');
 const u=new URL(env.DATABASE_URL||'');if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==HOST||(u.port&&u.port!=='5432')||u.pathname!=='/appdb'||u.hash||decodeURIComponent(u.username)!==v['--owner']||!u.password)throw Error('target');
 const params=[...u.searchParams];if(params.length>1||params.some(([k,val])=>k!=='sslmode'||val!=='verify-full'))throw Error('tls');
 // Do not pass connectionString: its SSL/options query parameters must not override these settings.
 return {input:{expectedOwner:v['--owner'],oldSha:OLD,newSha:NEXT,confirm:v['--confirm']},config:{host:HOST,port:5432,database:'appdb',user:v['--owner'],password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true,servername:HOST},options:'',application_name:'prima-exact-base-transition',connectionTimeoutMillis:10000}};
}
async function run(args=[],env=process.env,{makeClient}={}){
 let pins;try{pins=verifyArtifact();}catch{return{status:'refused',stage:'preconnect',code:'PACKAGED_ARTIFACT_INVALID',automaticRetryAllowed:false};}
 if(args.length===0||(args.length===1&&args[0]==='plan'))return{status:'plan_only',...pins,target:{host:HOST,port:5432,database:'appdb'},requiresExistingOwner:true,modulesInstalled:false,liveAuthorizationGranted:false};
 let parsed;try{parsed=parse(args,env,pins);}catch{return{status:'refused',stage:'preconnect',code:'EXACT_INPUT_TARGET_OR_TLS_REQUIRED',automaticRetryAllowed:false};}
 let c,result,connectionFailed=false;try{
  c=makeClient?makeClient(parsed.config):new(require('pg').Client)(parsed.config);
  if(typeof c.on!=='function')throw Error('Unsupported connection');
  c.on('error',()=>{connectionFailed=true;}); // Never log or rethrow raw asynchronous provider errors.
  await c.connect();if(connectionFailed)throw Error('Connection unavailable');
  const guarded={get connectionParameters(){return c.connectionParameters;},get connection(){return c.connection;},query:async(...a)=>{if(connectionFailed)throw Error('Connection unavailable');const r=await c.query(...a);if(connectionFailed)throw Error('Connection unavailable');return r;}};
  const {migrateBase}=require('./base-transition.cjs');
  result=await migrateBase(guarded,parsed.input,{old:fs.readFileSync(path.join(__dirname,'live.sql'),'utf8'),next:fs.readFileSync(path.join(__dirname,'candidate.sql'),'utf8')});
 }catch{result={status:'outcome_unconfirmed',stage:'connection_or_execution',code:'BASE_TRANSITION_UNAVAILABLE',automaticRetryAllowed:false};}
 finally{if(c)try{await c.end();}catch{result={...result,connectionCleanupConfirmed:false,automaticRetryAllowed:false};}}
 if(connectionFailed)return {status:'outcome_unconfirmed',stage:'connection_or_execution',code:'BASE_CONNECTION_FAILED',automaticRetryAllowed:false,...(result?.connectionCleanupConfirmed===false?{connectionCleanupConfirmed:false}:{})};
 return result;
}
module.exports={run,verifyArtifact,parse};
if(require.main===module)run(process.argv.slice(2)).then(r=>{process.stdout.write(JSON.stringify(r)+'\n');if(!['plan_only','committed'].includes(r.status)||r.connectionCleanupConfirmed===false)process.exitCode=1;}).catch(()=>{process.stderr.write('Base transition outcome unconfirmed; do not retry automatically.\n');process.exitCode=1;});
