'use strict';
const {verifyArtifact}=require('./artifact.cjs');
const HOST='psql-prima-staging-sea.postgres.database.azure.com';
function parse(args,env,pins){
 if(args.length!==11||args[0]!=='execute')throw Error('input');const keys=['--module','--artifact-sha','--release-sha','--module-sha','--confirm'];const v={};for(let n=0;n<keys.length;n++){if(args[1+n*2]!==keys[n])throw Error('input');v[keys[n]]=args[2+n*2];}
 const {selectedModuleSql}=require('./working/apps/api/dist/src/release-artifact');const selected=selectedModuleSql(v['--module'],__dirname+'/working');
 if(v['--artifact-sha']!==pins.artifactSha||v['--release-sha']!==pins.releaseSha256||v['--module-sha']!==selected.module.sha256||v['--confirm']!=='INSTALL_EXACT_PRIMAADMIN_MODULE')throw Error('input');
 const u=new URL(env.DATABASE_URL||'');if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==HOST||(u.port&&u.port!=='5432')||u.pathname!=='/appdb'||u.hash||decodeURIComponent(u.username)!=='primaadmin'||!u.password)throw Error('target');
 const params=[...u.searchParams];if(params.length>1||params.some(([k,val])=>k!=='sslmode'||val!=='verify-full'))throw Error('tls');
 // Do not pass connectionString: its SSL/options query parameters must not override these settings.
 return {input:{id:v['--module'],releaseSha256:v['--release-sha'],moduleSha256:v['--module-sha'],confirm:v['--confirm']},config:{host:HOST,port:5432,database:'appdb',user:'primaadmin',password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true,servername:HOST},options:'',application_name:'prima-exact-admin-module',connectionTimeoutMillis:10000}};
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
  const {installPrimaadminModule}=require('./admin-module.cjs');
  result=await installPrimaadminModule(guarded,parsed.input,__dirname+'/working');
 }catch{result={status:'outcome_unconfirmed',stage:'connection_or_execution',code:'MODULE_INSTALL_UNAVAILABLE',automaticRetryAllowed:false};}
 finally{if(c)try{await c.end();}catch{result={...result,connectionCleanupConfirmed:false,automaticRetryAllowed:false};}}
 if(connectionFailed)return {status:'outcome_unconfirmed',stage:'connection_or_execution',code:'MODULE_CONNECTION_FAILED',automaticRetryAllowed:false,...(result?.connectionCleanupConfirmed===false?{connectionCleanupConfirmed:false}:{})};
 return result;
}
module.exports={run,parse};
if(require.main===module)run(process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r));if(!['plan_only','installed','already_installed'].includes(r.status)||r.connectionCleanupConfirmed===false)process.exitCode=1;}).catch(()=>{console.error('Module outcome unconfirmed; no automatic retry.');process.exitCode=1;});
