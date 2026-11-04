/** Read-only diagnostic against the actual restricted API login. No migrations or credential changes. */
import {Pool} from 'pg';
import {releaseState} from './release-state';
async function main(){if(!process.env.DATABASE_URL)throw Error('Connection required');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});try{const state=await releaseState(p);console.log(JSON.stringify(state));if(!state.ready)process.exitCode=1;}finally{await p.end();}}
if(require.main===module)main().catch(()=>{console.error('Read-only release verification unavailable.');process.exitCode=1;});
