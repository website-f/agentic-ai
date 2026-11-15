import type {PoolClient} from 'pg';
import {assertRestrictedLogin} from './db';
import {itManualProblems} from './it-manual-readiness';
import {itOperationsProblems} from './it-operations-readiness';
import {procurementProblems} from './procurement-readiness';
import {rentalCorrectionProblems} from './rental-correction-readiness';
import {cleanupSchemaProblems} from './it-cleanup-readiness';
import {workflowMetricProblems} from './it-workflow-metrics-readiness';
import {jobEmailCatalogReadiness} from './connections-mail/pg-job-email-store';
import {itemRegisterProblems,itemRegisterV2Problems} from './item-register-readiness';
import {centralAdminDelegationsProblems,centralAdminLegalHoldsProblems,centralAdminPanelProblems,centralAdminWallsProblems} from './central-admin-readiness';
import {MODULE_SPECS} from './release-artifact';
import {FINGERPRINT_QUERY,MODULE_FINGERPRINTS} from './release-module-fingerprints';
import {OFFICE_MODULE_ALLOWANCES} from './office-module-allowances';

/** Every module on the release list (A3, Fauzan 11 Nov 2026: all database parts installed), in install order. */
export const RELEASE_MODULE_IDS = MODULE_SPECS.map(m=>m.id);
export type ReleaseModuleId = typeof MODULE_SPECS[number]['id'];
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
/** Modules without a hand-written readiness check: every catalogue entry the module adds (tables with row security and
 * app-role rights, columns, constraints, policies with their expressions and roles, function and trigger definitions)
 * must be present exactly as generated from the pinned SQL on a disposable database, and no other policy or trigger may
 * sit on the module's tables. Names and definitions only; reads no rows. */
export async function fingerprintProblems(client:CatalogClient,id:string):Promise<string[]>{
  const want=MODULE_FINGERPRINTS[id];if(!want)return ['RELEASE_UNKNOWN_MODULE'];
  const have=new Map((await client.query(FINGERPRINT_QUERY)).rows.map((r:{k:string;v:string})=>[r.k,r.v]));
  // Agentic Office (P105): the approved modules off the release list (db/office-non-release.json) change a few release
  // entries; exactly the values they leave (office-module-allowances.ts, generated) are accepted, nothing else.
  const allowed=(k:string)=>k in OFFICE_MODULE_ALLOWANCES&&have.get(k)===OFFICE_MODULE_ALLOWANCES[k];
  const out=Object.entries(want).filter(([k,v])=>have.get(k)!==v&&!allowed(k)).map(([k])=>`Catalogue entry ${k} is missing or changed.`);
  // Fauzan's audit of 4b708ae (P1): a policy or trigger on one of the module's tables that the pinned SQL does not
  // create (an extra allow-all policy, say) is refused too, not only a changed expected entry.
  const tables=new Set(Object.keys(want).filter(k=>k.startsWith('table:')).map(k=>k.slice(6)));
  for(const k of have.keys()){
    const m=/^(policy|trigger):([^.]+)\./.exec(k);
    // A later module may add its own policy or trigger to this module's table: that is in its fingerprint.
    if(m&&tables.has(m[2])&&!Object.values(MODULE_FINGERPRINTS).some(f=>k in f)&&!allowed(k))out.push(`Catalogue entry ${k} is not part of the release.`);
  }
  return out;
}
/** Catalog checks only. Caller supplies its transaction/role. No installation, configuration,
 * authority provisioning, or claim about the credential used by a separate running API. */
export async function moduleCatalogProblems(client:CatalogClient,id:ReleaseModuleId):Promise<string[]> {
  if(!(RELEASE_MODULE_IDS as readonly string[]).includes(id))return ['RELEASE_UNKNOWN_MODULE'];
    if(MODULE_FINGERPRINTS[id])return (await fingerprintProblems(client,id)).length?[moduleCode(id)]:[];
  try {
    if(id==='job_email')return (await jobEmailCatalogReadiness(client)).ready?[]:[moduleCode(id)];
    // The item register does not depend on the IT manual/operations tables.
    if(id==='item_register')return (await itemRegisterProblems(client)).length?[moduleCode(id)]:[];
    // Agentic Office (P85): the QR register's second part (label print log, SQL books, export files, counters) needs the
    // first in place. It is the office's own module, checked by its own hand-written readiness (no fingerprint).
    if(id==='item_register_v2')return (await itemRegisterProblems(client)).length||(await itemRegisterV2Problems(client)).length?[moduleCode(id)]:[];
    // Central Admin modules do not depend on the IT manual/operations tables; the panel needs the walls in place.
    if(id==='central_admin_walls')return (await centralAdminWallsProblems(client)).length?[moduleCode(id)]:[];
    if(id==='central_admin_delegations')return (await centralAdminDelegationsProblems(client)).length?[moduleCode(id)]:[];
    if(id==='central_admin_legal_holds')return (await centralAdminLegalHoldsProblems(client)).length?[moduleCode(id)]:[];
    if(id==='central_admin_panel')return (await centralAdminWallsProblems(client)).length||(await centralAdminPanelProblems(client)).length?[moduleCode(id)]:[];
    if((await itManualProblems(client)).length || (await itOperationsProblems(client)).length)return [moduleCode(id)];
    const checks={procurement:procurementProblems,rental_corrections:rentalCorrectionProblems,cleanup:cleanupSchemaProblems,metrics:workflowMetricProblems};
    return (await checks[id as keyof typeof checks](client)).length?[moduleCode(id)]:[];
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
