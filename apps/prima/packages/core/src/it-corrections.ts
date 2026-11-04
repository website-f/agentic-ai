import {liveItRows} from './it-cleanup-guards';
/** Bounded descriptive corrections. Never changes identity, access, payment or external state. */
import type {Store} from './store';
import type {User,ItAsset,ItAccount,ItOnboarding} from './types';
import {AccessDenied,accessClosed,isCentralEmployer} from './access';
import {BadRequest,NotFound} from './service';
import {sha256Hex} from './audit';
import {dateOf} from './time';
import {realCalendarDate,withItRecordLock} from './it-manual';
export type ItCorrectionKind='asset'|'system'|'intake';
export interface ItCorrection {version:number;at:string;byId:string;reason:string;requestId:string;previousHash:string;}
type Row=ItAsset|ItAccount|ItOnboarding;
const canonical=(x:unknown):unknown=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical((x as Record<string,unknown>)[k])])):x;
export const itCorrectionHash=(row:unknown)=>sha256Hex(JSON.stringify(canonical(row)));
const team=(u:User)=>!u.integration&&u.role==='pwvsb_officer'&&u.department==='it'&&['manager','lead','executive'].includes(u.itRole??'');
const lead=(u:User)=>team(u)&&['manager','lead'].includes(u.itRole??'');
const marker=(u:User)=>({serviceId:'it-manual' as const,userId:u.id});
const tables={asset:'itAssets',system:'itAccounts',intake:'itOnboarding'} as const;
const keys={asset:['serial','model','location','warrantyTo'],system:['name','note'],intake:['on','jobTitle','personName']} as const;
const exact=(x:Record<string,unknown>,ks:readonly string[])=>{if(Object.keys(x).length!==ks.length||ks.some(k=>!(k in x)))throw new BadRequest('Send exactly the correction fields.');};
const text=(x:unknown,name:string,max:number,min=0)=>{if(typeof x!=='string'||x.trim().length<min||x.length>max||/[\u0000-\u001f\u007f]/.test(x)||/(?:password|passwd|secret|access[_ -]?token|api[_ -]?key)\s*[:=]|bearer\s+\S+/i.test(x))throw new BadRequest(`Give ${name} without credentials (${min}–${max} characters).`);return x.trim();};
const norm=(x:string)=>x.normalize('NFKC').replace(/\s/g,'').toUpperCase();
const uuid=(x:unknown)=>{if(typeof x!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x))throw new BadRequest('A request UUID is required.');return x;};
export interface ItCorrectionView {kind:ItCorrectionKind;id:string;label:string;expectedHash:string;version:number;canEdit:boolean;blockedReason:string|null;editableFields:string[];fields:Record<string,string|null>;cleanup:{entryOrigin:'manual'|'legacy_or_import_unknown';provenance:'unknown';archiveEligible:false;reasons:string[];dependencyCompleteness:'unknown'};}
export class ItCorrectionService{
 constructor(private store:Store,private clock:()=>string){}
 private async actor(user:User,tx=this.store){const u=await tx.get('users',user.id);if(!u||accessClosed(u,dateOf(this.clock()))||!team(u))throw new AccessDenied('view','(only current IT staff may correct operational records)');return u;}
 private async visible(u:User,row:Row,kind:ItCorrectionKind,tx=this.store){const company=kind==='asset'?(row as ItAsset).ownerId:row.manual?.companyId;
  if(company===null||company==='unlinked')return row.manual?.companyId===null;
  return typeof company==='string'&&u.companyIds.includes(company)&&(kind==='asset'&&isCentralEmployer(company)||!!await tx.get('companies',company));
 }
 private capability(u:User,row:Row,kind:ItCorrectionKind){
  if(kind==='asset')return (row as ItAsset).status==='disposed'?'disposed_record':null;
  if(row.manual?.kind!==kind)return 'not_manual_record';
  if(kind==='intake'){
   const r=row as ItOnboarding;if(!lead(u)&&r.ownerStaffId!==u.id)return 'assigned_to_other_staff';
   if(r.steps.some(s=>s.doneAt!==null))return 'completed_evidence_requires_reopen_review';
  }else if(!lead(u)&&row.manual.createdById!==u.id)return 'created_by_other_staff';
  return null;
 }
 async board(user:User){user=await this.actor(user);const problems=await this.store.itManualProblems?.()??[];const rows:ItCorrectionView[]=[];
  for(const kind of ['asset','system','intake'] as const){for(const row of await liveItRows(this.store,tables[kind])){
   if(kind!=='asset'&&row.manual?.kind!==kind)continue;if(!await this.visible(user,row,kind))continue;
   const blockedReason=problems.length?'setup_required':this.capability(user,row,kind);
   const fields=Object.fromEntries(keys[kind].map(k=>[k,(row as unknown as Record<string,string|null>)[k]??null]));
   const editableFields:string[]=[...keys[kind]];
   if(kind==='intake'&&row.manual?.personUserId)editableFields.splice(editableFields.indexOf('personName'),1);
   if(kind==='system'&&((row as ItAccount).reviewedOn||(row as ItAccount).access.length))editableFields.splice(editableFields.indexOf('name'),1);
   const reasons=['requires_verified_provenance_and_separate_archive_workflow'];
   if(kind==='asset'){const a=row as ItAsset;if(a.purchaseId)reasons.push('purchase_link');reasons.push('financial_and_inspection_dependencies_not_cleared');}
   if(kind==='system'&&(row as ItAccount).access.length)reasons.push('access_records_present');
   if(kind==='intake'&&(row as ItOnboarding).steps.some(s=>s.doneAt))reasons.push('completed_evidence_present');
   if(row.manual)reasons.push('immutable_request_receipts_present');
   rows.push({kind,id:row.id,label:kind==='asset'?(row as ItAsset).tag:kind==='system'?(row as ItAccount).name:(row as ItOnboarding).personName,expectedHash:itCorrectionHash(row),version:row.correction?.version??0,canEdit:!blockedReason,blockedReason,editableFields,fields,cleanup:{entryOrigin:row.manual?'manual':'legacy_or_import_unknown',provenance:'unknown',archiveEligible:false,reasons,dependencyCompleteness:'unknown'}});
  }}return {...marker(user),configuration:problems.length?'setup_required' as const:'ready' as const,problems,scopeNotice:'Company-linked corrections require an existing company assignment. Unlinked manual records do not establish company access.',rows};
 }
 async save(user:User,kind:ItCorrectionKind,i:Record<string,unknown>){const requestId=uuid(i.requestId),hash=itCorrectionHash({action:'correction',kind,input:i});
  return withItRecordLock(this.store,'create',async tx=>{
   user=await this.actor(user,tx);if((await tx.itManualProblems?.()??[]).length)throw new BadRequest('Manual IT storage protections are not configured.');
   const receiptId=`${user.id}:${requestId}`,old=await tx.get('itManualReceipts',receiptId);
   if(old){if(old.kind!==kind||old.hash!==hash)throw new BadRequest('This request ID is permanently bound to different details.');return {...marker(user),requestId,kind,terminal:old.outcome,recordId:old.recordId,version:old.version,message:old.message,replayed:true};}
   let writing=false;
   try{return await tx.transaction(async inner=>{
    exact(i,['requestId','id','expectedHash','reason',...keys[kind]]);
    if(typeof i.id!=='string')throw new BadRequest('Choose a record.');await inner.lock?.(tables[kind],i.id);
    const row=await inner.get(tables[kind],i.id);if(!row||!await this.visible(user,row,kind,inner))throw new NotFound('Available IT record');
    const blocked=this.capability(user,row,kind);if(blocked)throw new BadRequest(`Correction blocked: ${blocked}.`);
    if(i.expectedHash!==itCorrectionHash(row))throw new BadRequest('This record changed. Reload and review before correcting.');
    const reason=text(i.reason,'a correction reason',500,3),patch:Record<string,unknown>={};
    if(kind==='asset'){
     const a=row as ItAsset;patch.serial=text(i.serial,'the serial or explicit unknown',120);patch.model=text(i.model,'the model or explicit unknown',120);patch.location=text(i.location,'the location or explicit unknown',160);
     const serial=patch.serial as string;if(serial!==a.serial&&serial&&(!/^[A-Za-z0-9._:/+\-]+$/.test(serial.normalize('NFKC').replace(/\s/g,''))||!/[A-Z0-9]/i.test(serial.normalize('NFKC'))))throw new BadRequest('A known serial needs an ASCII identifier; use explicit unknown until verified.');
     if(serial!==a.serial&&serial&&(await inner.list('itAssets',{})).some(x=>x.id!==row.id&&x.serial&&/[^\x20-\x7e]/.test(x.serial.normalize('NFKC').replace(/\s/g,''))))throw new BadRequest('Serial correction requires legacy identifier reconciliation.');
     if(serial!==a.serial&&serial&&(await inner.list('itAssets',{})).some(a=>a.id!==row.id&&a.serial&&norm(a.serial)===norm(serial)))throw new BadRequest('This serial is already recorded.');
     if(i.warrantyTo!==null&&!realCalendarDate(i.warrantyTo))throw new BadRequest('Give a real warranty date or null.');
     if(i.warrantyTo!==null&&a.boughtOn&&String(i.warrantyTo)<a.boughtOn)throw new BadRequest('Warranty cannot end before purchase.');patch.warrantyTo=i.warrantyTo;
    }else if(kind==='system'){
     const a=row as ItAccount;patch.name=text(i.name,'the system name',120,2);patch.note=text(i.note,'a note',500);
     if(patch.name!==a.name&&(a.reviewedOn||a.access.length))throw new BadRequest('Renaming a reviewed/access-bearing system requires separate review.');
    }else{
     const a=row as ItOnboarding;if(!realCalendarDate(i.on))throw new BadRequest('Give a real joining/leaving date.');patch.on=i.on;patch.jobTitle=text(i.jobTitle,'the job title',120,2);patch.personName=text(i.personName,'the person display name',120,2);
     if(a.manual?.personUserId&&patch.personName!==a.personName)throw new BadRequest('Linked identity names must be corrected through identity governance.');
    }
    if(keys[kind].every(k=>patch[k]===(row as unknown as Record<string,unknown>)[k]))throw new BadRequest('No descriptive fields changed.');
    const version=(row.correction?.version??0)+1;if(!Number.isSafeInteger(version))throw new BadRequest('Correction history needs administrative review.');
    const at=new Date(this.clock()).toISOString(),correction={version,at,byId:user.id,reason,requestId,previousHash:i.expectedHash as string};
    writing=true;await inner.update(tables[kind],row.id,{...patch,correction} as never);
    await inner.audit({at,actor:user.name,companyId:kind==='asset'?((row as ItAsset).ownerId==='unlinked'||isCentralEmployer((row as ItAsset).ownerId)?null:(row as ItAsset).ownerId):row.manual?.companyId??null,action:`it.correction.${kind}`,entity:tables[kind],entityId:row.id,summary:JSON.stringify({reason,version,changes:Object.fromEntries(keys[kind].filter(k=>patch[k]!== (row as unknown as Record<string,unknown>)[k]).map(k=>[k,{before:(row as unknown as Record<string,unknown>)[k],after:patch[k]}]))})});
    await inner.insert('itManualReceipts',{id:receiptId,userId:user.id,requestId,kind,hash,outcome:'committed',recordId:row.id,version,message:null,at});
    return {...marker(user),requestId,kind,terminal:'committed' as const,recordId:row.id,version,message:null,replayed:false};
   });}catch(e){
    if(writing)throw new Error('Correction outcome unavailable. Reconcile the request receipt before trying again.');
    if(!(e instanceof BadRequest)&&!(e instanceof NotFound)&&!(e instanceof AccessDenied))throw e;
    await tx.insert('itManualReceipts',{id:receiptId,userId:user.id,requestId,kind,hash,outcome:'rejected',recordId:null,version:null,message:e.message,at:this.clock()});
    await tx.audit({at:this.clock(),actor:user.name,companyId:null,action:'it.correction.rejected',entity:'itManualReceipts',entityId:receiptId,summary:JSON.stringify({kind,outcome:'rejected'})});
    return {...marker(user),requestId,kind,terminal:'rejected' as const,recordId:null,version:null,message:e.message,replayed:false};
   }
  });
 }
}
