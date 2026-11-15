import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
export const MODULE_SPECS=[
 {id:'procurement',path:'db/modules/it-procurement-v1.sql',requires:[]},
 {id:'rental_corrections',path:'db/modules/rental-correction-v1.sql',requires:[]},
 {id:'cleanup',path:'db/modules/it-cleanup-v1.sql',requires:['procurement','rental_corrections']},
 {id:'metrics',path:'db/modules/it-workflow-metrics-v1.sql',requires:[]},
 {id:'job_email',path:'apps/api/src/connections-mail/job-email-v2.sql',requires:[]},
 // One item register (Fauzan, 6 Nov 2026; owner chose the release path for staging, 8 Nov 2026).
 {id:'item_register',path:'db/modules/item-register-v1.sql',requires:[]},
 // Agentic Office: the QR item register part two (P85, the office's own; not upstream), right after the item register.
 {id:'item_register_v2',path:'db/modules/item-register-v2.sql',requires:['item_register']},
 // All 25 other database parts on the release list (A3: Fauzan, 11 Nov 2026, "install all 25"). Order: dependencies
 // first (guard_pay after pay_formulas, panel after walls, run links after company office). The CEO runs each install.
 {id:'central_admin_walls',path:'db/modules/central-admin-walls-v1.sql',requires:[]},
 {id:'central_admin_panel',path:'db/modules/central-admin-panel-v1.sql',requires:['central_admin_walls']},
 {id:'central_admin_delegations',path:'db/modules/central-admin-delegations-v1.sql',requires:[]},
 {id:'central_admin_legal_holds',path:'db/modules/central-admin-legal-holds-v1.sql',requires:[]},
 {id:'client_codes',path:'db/modules/client-codes-v1.sql',requires:[]},
 {id:'company_office',path:'db/modules/company-office-v1.sql',requires:[]},
 {id:'company_run_links',path:'db/modules/company-run-links-v1.sql',requires:['company_office']},
 {id:'org_links',path:'db/modules/org-links-v1.sql',requires:[]},
 {id:'special_ops',path:'db/modules/special-ops-v1.sql',requires:[]},
 {id:'fw_welfare',path:'db/modules/fw-welfare-v1.sql',requires:[]},
 {id:'fw_recruit',path:'db/modules/fw-recruit-v1.sql',requires:[]},
 {id:'fw_recruitment_cost',path:'db/modules/fw-recruitment-cost-v1.sql',requires:[]},
 {id:'fw_epf_socso_recharge',path:'db/modules/fw-epf-socso-recharge-v1.sql',requires:[]},
 {id:'pay_formulas',path:'db/modules/pay-formulas-v1.sql',requires:[]},
 {id:'guard_pay',path:'db/modules/guard-pay-v1.sql',requires:['pay_formulas']},
 {id:'am_extras',path:'db/modules/am-extras-v1.sql',requires:[]},
 {id:'cleaning_ops',path:'db/modules/cleaning-ops-v1.sql',requires:[]},
 {id:'governance_registers',path:'db/modules/governance-registers-v1.sql',requires:[]},
 {id:'pdpa_register',path:'db/modules/pdpa-register-v1.sql',requires:[]},
 {id:'quality_compliance',path:'db/modules/quality-compliance-v1.sql',requires:[]},
 {id:'rba_readiness',path:'db/modules/rba-readiness-v1.sql',requires:[]},
 {id:'site_surveys',path:'db/modules/site-surveys-v1.sql',requires:[]},
 {id:'staff_directory',path:'db/modules/staff-directory-v1.sql',requires:[]},
 {id:'tender_opportunities',path:'db/modules/tender-opportunities-v1.sql',requires:[]},
 {id:'time_slip',path:'db/modules/time-slip-v1.sql',requires:[]},
 {id:'speak_up_wall',path:'db/modules/speak-up-wall-v1.sql',requires:[]},
] as const;
// Catalog-only optional modules: none since A3 (11 Nov 2026) put every module on the release list.
export const OPTIONAL_MODULE_SPECS:readonly {id:string;path:string;requires:readonly string[]}[]=[];
export type ReleaseModuleId=typeof MODULE_SPECS[number]['id'];
export type ReleaseArtifact={version:1;base:{path:string;sha256:string};modules:Array<{id:ReleaseModuleId;path:string;sha256:string;requires:readonly string[]}>};
export const releaseRoot=()=>resolve(__dirname,'../../../..');
export const sha256=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
/** Fixed packaged paths only. This verifies bytes, not database installation or provider access. */
export function releaseArtifact(root=releaseRoot()):{manifest:ReleaseArtifact;sha256:string}{
 const file=resolve(root,'db/release-manifest.json');if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error('Release artifact unavailable.');
 const bytes=readFileSync(file),m=JSON.parse(bytes.toString()) as ReleaseArtifact;
 if(m.version!==1||Object.keys(m).sort().join(',')!=='base,modules,version'||m.base?.path!=='db/migrations/001_init.sql'||Object.keys(m.base).sort().join(',')!=='path,sha256'||!HASH.test(m.base.sha256)||!Array.isArray(m.modules)||m.modules.length!==MODULE_SPECS.length)throw Error('Release manifest is invalid.');
 for(let n=0;n<MODULE_SPECS.length;n++){const s=MODULE_SPECS[n],v=m.modules[n];if(!v||Object.keys(v).sort().join(',')!=='id,path,requires,sha256'||v.id!==s.id||v.path!==s.path||JSON.stringify(v.requires)!==JSON.stringify(s.requires)||!HASH.test(v.sha256))throw Error('Release module manifest is invalid.');}
 for(const v of [m.base,...m.modules]){const p=resolve(root,v.path);if(!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink()||sha256(readFileSync(p))!==v.sha256)throw Error('Packaged release SQL does not match manifest.');}
 return {manifest:m,sha256:sha256(bytes)};
}
export function selectedModuleSql(id:ReleaseModuleId,root=releaseRoot()){const a=releaseArtifact(root),m=a.manifest.modules.find(x=>x.id===id);if(!m)throw Error('Unknown release module.');return {artifact:a,module:m,sql:readFileSync(resolve(root,m.path),'utf8')};}
