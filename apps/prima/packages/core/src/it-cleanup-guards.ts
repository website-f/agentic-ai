import {dateOf} from './time';
import {cleanupHash} from './it-cleanup-hash';
import type {Dataset,TableName} from './types';
import type {Store,Row} from './store';
import type {CleanupKind} from './it-cleanup-types';
export const CLEANUP_ROOTS={asset:'itAssets',system:'itAccounts',intake:'itOnboarding'} as const;
export const CLEANUP_DEPENDENCIES=['itAssets','itAccounts','itOnboarding','itPurchases','itProcurementPackets','itAssetInspections','itRentalBills','itRentalCorrectionRequests','itRentalReplacements','itAccessRequests','itJobs','itTickets','itImportReviews'] as const;
export function validPlanAssetRefs(x:unknown):x is {asOf:string;assets:{id:string;hash:string}[]}{if(!x||typeof x!=='object'||Array.isArray(x))return false;const r=x as Record<string,unknown>;if(Object.keys(r).length!==2||typeof r.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)||!Array.isArray(r.assets)||!r.assets.length)return false;const assets=r.assets;return assets.every((a,n)=>a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===2&&typeof a.id==='string'&&!!a.id&&typeof a.hash==='string'&&/^[0-9a-f]{64}$/.test(a.hash)&&(n===0||assets[n-1].id<a.id));}
export function cleanupReferences(table:string,value:unknown,kind:CleanupKind,record:Record<string,unknown>,trustedPlan=false):boolean{
 const raw=JSON.stringify(value);if(raw.includes(String(record.id)))return true;
 if(kind==='asset'&&['itJobs','itTickets','itImportReviews'].includes(table)){
  if(typeof record.tag==='string'&&record.tag&&raw.includes(record.tag))return true;
  if(!(table==='itJobs'&&trustedPlan)&&typeof record.ownerId==='string'&&[`inspection:${record.ownerId}:`,`service:${record.ownerId}:`].some(k=>raw.includes(k)))return true;
 }
 return kind==='system'&&table==='itJobs'&&raw.includes(`access:${record.id}:`);
}
function admitted(data:Dataset,table:string,row:unknown){if(table!=='itJobs'||!row||typeof row!=='object')return false;const j=row as Record<string,unknown>;return validPlanAssetRefs(j.planAssetRefs)&&(data.itCleanupPlanBindings??[]).some(b=>b.jobId===j.id&&b.planKey===j.planKey&&b.refsHash===cleanupHash(j.planAssetRefs));}
/** Synthetic complete-dataset dependency check. PostgreSQL uses a separately pinned complete-visibility helper. */
export function memoryCleanupDependencies(data:Dataset,kind:CleanupKind,id:string){
 const record=(data[CLEANUP_ROOTS[kind]] as unknown as Record<string,unknown>[]).find(r=>r.id===id);if(!record)return {complete:false,reasons:['record_unavailable']};
 const reasons:string[]=[];
 for(const table of CLEANUP_DEPENDENCIES){const rows=data[table];if(!Array.isArray(rows))return {complete:false,reasons:['dependency_coverage_missing']};if(rows.some(r=>!(table===CLEANUP_ROOTS[kind]&&r.id===id)&&cleanupReferences(table,r,kind,record,admitted(data,table,r))))reasons.push(`dependency_${table}`);}
 return {complete:true,reasons};
}
/** No generic read filtering: reservation, audit and receipt paths continue to see original rows. */
export async function liveItRows<T extends 'itAssets'|'itAccounts'|'itOnboarding'>(store:Store,table:T,rows?:Row<T>[]):Promise<Row<T>[]>{
 const all=rows??await store.list(table,{});if(!store.itCleanupArchived)return all;
 const kind=table==='itAssets'?'asset':table==='itAccounts'?'system':'intake';const flags=await Promise.all(all.map(r=>store.itCleanupArchived!(kind,r.id)));return all.filter((_r,n)=>!flags[n]);
}
/** Synchronous MemoryStore boundary closes a check/write microtask race; SQL owns the production equivalent. */
export function assertMemoryCleanupWrite(data:Dataset,table:TableName,value:unknown){
 if(table==='itCleanupPlanBindings')throw Error('Plan bindings are admitted only by the protected job writer.');
 const row=value as Record<string,unknown>;const archives=data.itCleanupArchives??[];let pendingBinding:Dataset['itCleanupPlanBindings'][number]|undefined;
 if(table==='itJobs'){
  const old=data.itJobs.find(j=>j.id===row.id);if(old&&old.planKey!==row.planKey)throw Error('A job plan identity cannot be converted or reassigned.');if(old&&JSON.stringify(old.planAssetRefs)!==JSON.stringify(row.planAssetRefs))throw Error('A group job inventory scope cannot be rewritten.');
  if(!old&&typeof row.planKey==='string'&&/^(inspection|service):/.test(row.planKey)){
   if(!/^(inspection|service):[^:]+:20[0-9]{2}-(0[1-9]|1[0-2])$/.test(row.planKey))throw Error('Group plan key is invalid.');
   const owner=row.planKey.split(':')[1],assets=data.itAssets.filter(a=>a.ownerId===owner&&!['disposed','disposal_pending'].includes(a.status)&&!archives.some(x=>x.kind==='asset'&&x.recordId===a.id&&x.archived)).map(a=>({id:a.id,hash:cleanupHash(a)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
   if(!assets.length||JSON.stringify(row.planAssetRefs)!==JSON.stringify({asOf:dateOf(String(row.at)),assets}))throw Error('A group job requires the current server-derived inventory scope.');
   pendingBinding={id:String(row.id),jobId:String(row.id),planKey:row.planKey,refsHash:cleanupHash(row.planAssetRefs)};
  }
 }

 for(const a of archives.filter(x=>x.archived)){
  const root=CLEANUP_ROOTS[a.kind];if(table===root&&row.id===a.recordId)throw Error('Archived IT records are read-only. Restore through the controlled workflow.');
  if((CLEANUP_DEPENDENCIES as readonly string[]).includes(table)&&cleanupReferences(table,value,a.kind,a.snapshot as Record<string,unknown>,(!!pendingBinding||admitted(data,table,value))))throw Error('An archived IT record cannot receive new operational references.');
 }
 if(pendingBinding){if(data.itCleanupPlanBindings.some(b=>b.id===pendingBinding!.id))throw Error('Plan binding identity is already reserved.');data.itCleanupPlanBindings.push(pendingBinding);}
 if(table==='itCleanupArchives'&&row.archived===true){const d=memoryCleanupDependencies(data,row.kind as CleanupKind,String(row.recordId));if(!d.complete||d.reasons.length)throw Error('Cleanup dependency protection requires review.');}
}
