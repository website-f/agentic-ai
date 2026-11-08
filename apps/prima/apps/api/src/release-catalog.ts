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
import {companyOfficeProblems,companyRunLinkProblems} from './company-office-readiness';
import {orgLinksProblems} from './org-links-readiness';
import {specialOpsModuleProblems} from './special-ops-readiness';
import {fwWelfareProblems} from './fw-welfare-readiness';
import {fwRecruitProblems} from './fw-recruit-readiness';
import {guardPayProblems,payFormulasProblems} from './pay-modules-readiness';

// Agentic Office: upstream activates the first seven; the office database already has the rest installed, so the office
// release keeps them activated (same order as release-artifact.ts MODULE_SPECS and db/release-manifest.json).
export const RELEASE_MODULE_IDS = ['procurement','rental_corrections','cleanup','metrics','job_email','item_register','item_register_v2','central_admin_walls','central_admin_panel','central_admin_delegations','central_admin_legal_holds','company_office','company_run_links','org_links','special_ops','fw_welfare','pay_formulas','guard_pay','fw_recruit'] as const;
// Upstream keeps the Central Admin modules optional (catalog-only); the office activates them above.
export const OPTIONAL_MODULE_IDS = [] as const;
export type ReleaseModuleId = typeof RELEASE_MODULE_IDS[number] | typeof OPTIONAL_MODULE_IDS[number];
type CatalogClient = Pick<PoolClient,'query'>;
type ReleaseClient = Pick<PoolClient,'query'|'release'>;
export interface ReleaseCatalogPool { connect():Promise<ReleaseClient> }
export interface ReleaseCatalogState {
  ready:boolean;
  baseReady:boolean;
  modules:Record<typeof RELEASE_MODULE_IDS[number],{ready:boolean;codes:string[]}>;
  codes:string[];
}
const moduleCode=(id:ReleaseModuleId)=>`RELEASE_${id.toUpperCase()}_NOT_READY`;
/** Catalog checks only. Caller supplies its transaction/role. No installation, configuration,
 * authority provisioning, or claim about the credential used by a separate running API. */
export async function moduleCatalogProblems(client:CatalogClient,id:ReleaseModuleId):Promise<string[]> {
  if(!([...RELEASE_MODULE_IDS,...OPTIONAL_MODULE_IDS] as readonly string[]).includes(id))return ['RELEASE_UNKNOWN_MODULE'];
  try {
    if(id==='job_email')return (await jobEmailCatalogReadiness(client)).ready?[]:[moduleCode(id)];
    // The item register does not depend on the IT manual/operations tables.
    if(id==='item_register')return (await itemRegisterProblems(client)).length?[moduleCode(id)]:[];
    // P85: the second part (label print log, SQL books, export files, counters) needs the first in place.
    if(id==='item_register_v2')return (await itemRegisterProblems(client)).length||(await itemRegisterV2Problems(client)).length?[moduleCode(id)]:[];
    // Central Admin modules do not depend on the IT manual/operations tables; the panel needs the walls in place.
    if(id==='central_admin_walls')return (await centralAdminWallsProblems(client)).length?[moduleCode(id)]:[];
    if(id==='central_admin_delegations')return (await centralAdminDelegationsProblems(client)).length?[moduleCode(id)]:[];
    if(id==='central_admin_legal_holds')return (await centralAdminLegalHoldsProblems(client)).length?[moduleCode(id)]:[];
    // The add-on modules (combined candidate, R14, and P85) have their own catalogue checks and no IT table dependency.
    if(id==='company_office')return (await companyOfficeProblems(client)).length?[moduleCode(id)]:[];
    if(id==='company_run_links')return (await companyRunLinkProblems(client)).length?[moduleCode(id)]:[];
    if(id==='org_links')return (await orgLinksProblems(client)).length?[moduleCode(id)]:[];
    if(id==='special_ops')return (await specialOpsModuleProblems(client)).length?[moduleCode(id)]:[];
    if(id==='fw_welfare')return (await fwWelfareProblems(client)).length?[moduleCode(id)]:[];
    if(id==='pay_formulas')return (await payFormulasProblems(client)).length?[moduleCode(id)]:[];
    if(id==='guard_pay')return (await payFormulasProblems(client)).length||(await guardPayProblems(client)).length?[moduleCode(id)]:[];
    if(id==='fw_recruit')return (await fwRecruitProblems(client)).length?[moduleCode(id)]:[];
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
