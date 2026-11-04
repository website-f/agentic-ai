import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
export const MODULE_SPECS=[
 {id:'procurement',path:'db/modules/it-procurement-v1.sql',requires:[]},
 {id:'rental_corrections',path:'db/modules/rental-correction-v1.sql',requires:[]},
 {id:'cleanup',path:'db/modules/it-cleanup-v1.sql',requires:['procurement','rental_corrections']},
 {id:'metrics',path:'db/modules/it-workflow-metrics-v1.sql',requires:[]},
 {id:'job_email',path:'apps/api/src/connections-mail/job-email-v2.sql',requires:[]},
] as const;
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
