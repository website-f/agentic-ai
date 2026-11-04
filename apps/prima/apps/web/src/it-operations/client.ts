import type { OperationalBoard } from './contract';
import { assetKindLabels, amountSen } from './display';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&x.length>0;
const integer=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const amount=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&Number(x.toFixed(2))===x&&Number.isSafeInteger(Math.round(x*100));
const nullableText=(x:unknown)=>x===null||text(x);
export function decodeOperationalBoard(value:unknown,userId:string):OperationalBoard {
 const b=value as OperationalBoard;
 if(!b||b.serviceId!=='it-manual'||b.userId!==userId||!['ready','setup_required'].includes(b.configuration)||!['canSetRates','canPrepareBill','canRecordHistory','canInspect'].every(k=>typeof (b as unknown as Record<string,unknown>)[k]==='boolean')||!integer(b.ratesVersion)||![b.rateVersions,b.companies,b.jobs,b.assets,b.bills,b.inspections].every(Array.isArray))throw Error('Operational IT identity or capability could not be verified.');
 if(b.configuration!=='ready'&&(b.canSetRates||b.canPrepareBill||b.canRecordHistory||b.canInspect))throw Error('Operational IT storage is not ready.');
 for(const j of b.jobs)if(!text(j.id)||!text(j.title))throw Error('Inspection job identity missing.');
 for(const c of b.companies)if(!text(c.id)||!text(c.name))throw Error('Company identity missing.');
 for(const r of b.rateVersions)if(!text(r.id)||!integer(r.version)||!text(r.effectiveOn)||r.currency!=='MYR'||!object(r.monthly)||Object.entries(r.monthly).some(([k,v])=>!(k in assetKindLabels)||!amount(v))||!text(r.byId)||!text(r.at))throw Error('Rate snapshot could not be verified.');
 for(const a of b.assets)if(!text(a.id)||!text(a.tag)||!text(a.model)||!(a.kind in assetKindLabels)||!text(a.ownerId)||!text(a.billingVersion)||typeof a.billingEligible!=='boolean'||!integer(a.inspectionVersion)||!['initial_check_needed','due','scheduled'].includes(a.inspectionState)||!(a.inspectionReviewStatus===null||['recorded_unreviewed','linked_job_accepted','returned'].includes(a.inspectionReviewStatus))||!nullableText(a.lastInspectionOn)||!nullableText(a.nextInspectionOn)||!(a.lastCondition===null||['healthy','attention','unsafe'].includes(a.lastCondition)))throw Error('Asset billing or inspection identity could not be verified.');
 for(const i of b.inspections)if(!text(i.id)||!text(i.assetId)||!text(i.jobId)||!['recorded_unreviewed','linked_job_accepted','returned'].includes(i.reviewStatus)||!integer(i.version)||!text(i.inspectedOn)||!text(i.nextDueOn)||!['healthy','attention','unsafe'].includes(i.condition)||!text(i.evidence)||!text(i.findings)||typeof i.followUp!=='string'||!text(i.byId))throw Error('Inspection evidence could not be verified.');
 for(const bill of b.bills)if(!text(bill.id)||!text(bill.companyId)||!text(bill.period)||!text(bill.invoiceRef)||!amount(bill.total)||!(bill.currency==='MYR'||(bill.source==='legacy_unverified'&&bill.currency===null))||!['configured_rates','historical_record','legacy_unverified'].includes(bill.source)||!Array.isArray(bill.lines)||bill.lines.some(l=>!integer(l.count)||!amount(l.rate)||!amount(l.amount))||!Array.isArray(bill.assetSnapshot)||bill.assetSnapshot.some(a=>!text(a.id)||!text(a.tag)||!(a.kind in assetKindLabels)||!text(a.ownerId)||!text(a.status)||!text(a.version))||!nullableText(bill.rateId)||!(bill.rateVersion===null||integer(bill.rateVersion)))throw Error('Bill snapshot could not be verified.');
 return b;
}
export function effectiveRate(board:OperationalBoard,period:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return null;return [...board.rateVersions].filter(r=>r.effectiveOn<=period+'-01').sort((a,b)=>b.effectiveOn.localeCompare(a.effectiveOn)||b.version-a.version)[0]??null;}
export function billingSelection(board:OperationalBoard,companyId:string,period:string,ids:string[]){
 const rate=effectiveRate(board,period);if(!rate)throw Error('The IT Manager must configure an effective rate for this billing month.');
 if(!board.companies.some(c=>c.id===companyId)||!ids.length||new Set(ids).size!==ids.length)throw Error('Select a verified company and its eligible devices.');
 const selected=ids.map(id=>board.assets.find(a=>a.id===id));let totalCents=0;
 for(const a of selected){if(!a||a.ownerId!==companyId||!a.billingEligible||!['in_use','repair'].includes(a.status))throw Error('Selected asset is not eligible for this company.');const n=rate.monthly[a.kind];if(n===undefined)throw Error('A selected device kind has no configured rate.');totalCents+=amountSen(n);}
 if(!Number.isSafeInteger(totalCents))throw Error('Total is too large.');return{rate,assetRefs:selected.map(a=>({id:a!.id,version:a!.billingVersion})),totalCents};
}
