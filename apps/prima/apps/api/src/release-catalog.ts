import type {PoolClient} from 'pg';
import {assertRestrictedLogin} from './db';
import {itManualProblems} from './it-manual-readiness';
import {itOperationsProblems} from './it-operations-readiness';
import {procurementProblems} from './procurement-readiness';
import {rentalCorrectionProblems} from './rental-correction-readiness';
import {cleanupSchemaProblems} from './it-cleanup-readiness';
import {workflowMetricProblems} from './it-workflow-metrics-readiness';
import {jobEmailCatalogReadiness} from './connections-mail/pg-job-email-store';

export const RELEASE_MODULE_IDS = ['procurement','rental_corrections','cleanup','metrics','job_email'] as const;
export type ReleaseModuleId = typeof RELEASE_MODULE_IDS[number];
type CatalogClient = Pick<PoolClient,'query'>;
type ReleaseClient = Pick<PoolClient,'query'|'release'>;
export interface ReleaseCatalogPool { connect():Promise<ReleaseClient> }
export interface ReleaseCatalogState {
  ready:boolean;
  baseReady:boolean;
  modules:Record<ReleaseModuleId,{ready:boolean;codes:string[]}>;
  codes:string[];
}
const moduleCode=(id:ReleaseModuleId)=>`RELEASE_${id.toUpperCase()}_NOT_READY`;
/** Catalog checks only. Caller supplies its transaction/role. No installation, configuration,
 * authority provisioning, or claim about the credential used by a separate running API. */
export async function moduleCatalogProblems(client:CatalogClient,id:ReleaseModuleId):Promise<string[]> {
  if(!RELEASE_MODULE_IDS.includes(id))return ['RELEASE_UNKNOWN_MODULE'];
  try {
    if(id==='job_email')return (await jobEmailCatalogReadiness(client)).ready?[]:[moduleCode(id)];
    if((await itManualProblems(client)).length || (await itOperationsProblems(client)).length)return [moduleCode(id)];
    const checks={procurement:procurementProblems,rental_corrections:rentalCorrectionProblems,cleanup:cleanupSchemaProblems,metrics:workflowMetricProblems};
    return (await checks[id](client)).length?[moduleCode(id)]:[];
  } catch { return [moduleCode(id)]; }
}
function emptyState():ReleaseCatalogState {
  return {ready:false,baseReady:false,modules:Object.fromEntries(RELEASE_MODULE_IDS.map(id=>[id,{ready:false,codes:[moduleCode(id)]}])) as ReleaseCatalogState['modules'],codes:[]};
}
/** One restricted-runtime, read-only transaction; byte-manifest verification is a separate
 * packaging check. Does not prove tenant consent, provider configuration, staff scope or UAT. */
export async function releaseCatalogState(pool:ReleaseCatalogPool,expected:{baseSha256:string}):Promise<ReleaseCatalogState> {
  const state=emptyState();
  if(!expected || !/^[a-f0-9]{64}$/.test(expected.baseSha256)){state.codes=['RELEASE_INVALID_MANIFEST'];return state;}
  let client:ReleaseClient|undefined;
  let rollbackFailed=false;
  try {
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    // Check the actual checked-out login before SET ROLE; never validate a different pool connection.
    const identity=await client.query('SELECT session_user = current_user AS unchanged_login');
    if(identity.rows.length!==1 || identity.rows[0].unchanged_login!==true)throw new Error('Release login boundary failed');
    await assertRestrictedLogin(client);
    await client.query('SET LOCAL ROLE prima_app');
    const base=await client.query('SELECT id, migration_sha256 FROM prima.schema_info');
    state.baseReady=base.rows.length===1 && base.rows[0].id===1 && base.rows[0].migration_sha256===expected.baseSha256;
    if(!state.baseReady)state.codes.push('RELEASE_BASE_NOT_READY');
    for(const id of RELEASE_MODULE_IDS){
      const codes=await moduleCatalogProblems(client,id);
      state.modules[id]={ready:codes.length===0,codes};
      state.codes.push(...codes);
    }
  } catch {
    state.codes.push('RELEASE_CATALOG_UNAVAILABLE');
  } finally {
    if(client){
      try { await client.query('ROLLBACK'); }
      catch { rollbackFailed=true;state.codes.push('RELEASE_TRANSACTION_CLEANUP_FAILED'); }
      try { client.release(rollbackFailed?new Error('Release catalog transaction cleanup failed'):undefined); }
      catch { state.codes.push('RELEASE_TRANSACTION_CLEANUP_FAILED'); }
    }
  }
  state.codes=[...new Set(state.codes)];
  state.ready=state.baseReady && state.codes.length===0 && RELEASE_MODULE_IDS.every(id=>state.modules[id].ready);
  return state;
}
