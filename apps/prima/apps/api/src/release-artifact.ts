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
 {id:'item_register_v2',path:'db/modules/item-register-v2.sql',requires:['item_register']},
 // Agentic Office: the office database already has these modules installed (P85 and the combined candidate), so the
 // office release keeps them activated after upstream's seven, in the order of upstream's db/proposed `after` lists.
 {id:'central_admin_walls',path:'db/modules/central-admin-walls-v1.sql',requires:[]},
 {id:'central_admin_panel',path:'db/modules/central-admin-panel-v1.sql',requires:['central_admin_walls']},
 {id:'central_admin_delegations',path:'db/modules/central-admin-delegations-v1.sql',requires:[]},
 {id:'central_admin_legal_holds',path:'db/modules/central-admin-legal-holds-v1.sql',requires:[]},
 {id:'company_office',path:'db/modules/company-office-v1.sql',requires:[]},
 {id:'company_run_links',path:'db/modules/company-run-links-v1.sql',requires:['company_office']},
 {id:'org_links',path:'db/modules/org-links-v1.sql',requires:[]},
 {id:'special_ops',path:'db/modules/special-ops-v1.sql',requires:[]},
 {id:'fw_welfare',path:'db/modules/fw-welfare-v1.sql',requires:[]},
 {id:'fw_recruit',path:'db/modules/fw-recruit-v1.sql',requires:[]},
] as const;
// Optional modules. Never included in release activation implicitly and never in db/release-manifest.json, so the office's
// prima-setup (which installs every manifest module) never installs them. Upstream lists the four Central Admin modules
// here; the office activates those above. Guard pay (Fauzan, 8 Nov 2026): the pay formulas and guard pay database is
// installed LATER, as its own step; Prima takes over guard pay on 1 August 2027 and until then the JA Group app pays and
// Prima pay runs are side-by-side trials only. An operator installs them one at a time, pay_formulas then guard_pay, with
// the explicit optional confirmation (docs/RELEASE_MODULE_INSTALLATION.md). The bytes are pinned here, not in the manifest.
export const OPTIONAL_MODULE_SPECS=[
 {id:'pay_formulas',path:'db/modules/pay-formulas-v1.sql',sha256:'38718470f582cb438a08d42d6131187aa55c0613e3aa58a924836f77cfbfda72',requires:[]},
 {id:'guard_pay',path:'db/modules/guard-pay-v1.sql',sha256:'c6ca56b61b076181eba45bd1c1c88d766c9339b981e45c41154b8fee0c32d8a1',requires:['pay_formulas']},
 // E5 (Fauzan, 11 Nov 2026): PGL is also an employer of staff; the hand-over rule learns every central employer. Installed
 // through the CEO-run migration as its own step (needs org_links), never by the office's start-up loop.
 {id:'central_employers',path:'db/modules/central-employers-v1.sql',sha256:'29d388a4ef7b80c547ebdf9b903d59b7138499249aae435d47885223595cdd03',requires:['org_links']},
] as const satisfies readonly {readonly id:string;readonly path:string;readonly sha256:string;readonly requires:readonly string[]}[];
export type OptionalModuleId=typeof OPTIONAL_MODULE_SPECS[number]['id'];
export const isOptionalModule=(id:string):id is OptionalModuleId=>OPTIONAL_MODULE_SPECS.some(m=>m.id===id);
export type ReleaseModuleId=typeof MODULE_SPECS[number]['id'] | typeof OPTIONAL_MODULE_SPECS[number]['id'];
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
/** An optional module's pinned bytes, bound to the exact verified release. Only the explicit operator command uses this. */
export function optionalModuleSql(id:ReleaseModuleId,root=releaseRoot()){const a=releaseArtifact(root),s=OPTIONAL_MODULE_SPECS.find(x=>x.id===id);if(!s||a.manifest.modules.some(x=>x.id===id))throw Error('Unknown optional module.');const p=resolve(root,s.path);if(!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink())throw Error('Optional module SQL unavailable.');const bytes=readFileSync(p);if(sha256(bytes)!==s.sha256)throw Error('Packaged optional SQL does not match its pinned hash.');return {artifact:a,module:{id:s.id as ReleaseModuleId,path:s.path,sha256:s.sha256,requires:s.requires as readonly string[]},sql:bytes.toString('utf8')};}
