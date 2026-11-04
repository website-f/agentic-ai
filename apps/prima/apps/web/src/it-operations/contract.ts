// Proposed/frozen transport contract for local implementation. RM decimal input, exact 2dp only; no guessed rate.
export type AssetKind='LAPTOP'|'DESKTOP'|'PHONE'|'TABLET'|'PRINTER'|'NETWORK'|'CCTV'|'OTHER';
export type OperationKind='rental_rates'|'rental_bill'|'rental_history'|'asset_inspection';
// Existing itAct gateway, owner-pinned client; operationalReceipt/operationalAbandon have same terminal semantics as manual equivalents.
export type Inputs={
 operationalBoard:{};
 operationalReceipt:{requestId:string;kind:OperationKind};
 operationalAbandon:{requestId:string;kind:OperationKind};
 setRentalRates:{requestId:string;expectedVersion:number;effectiveOn:string;currency:'MYR';monthly:Partial<Record<AssetKind,number>>;evidence:string;note:string};
 prepareRentalBill:{requestId:string;companyId:string;period:string;invoiceRef:string;rateId:string;assetRefs:{id:string;version:string}[];evidence:string};
 recordRentalHistory:{requestId:string;companyId:string;period:string;invoiceRef:string;amount:number;currency:'MYR';evidence:string;note:string};
 recordAssetInspection:{requestId:string;jobId:string;assetId:string;expectedVersion:number;inspectedOn:string;condition:'healthy'|'attention'|'unsafe';findings:string;evidence:string;followUp:string};
};
// effectiveOn must be the FIRST DAY of a real month (monthly basis; no proration/tax engine).
// Billing: select explicit in_use/repair assets with linked ownerId===companyId; unlinked stock not billable.
// rateId must match latest effective rate applicable to period; assetRefs must still match current hashes.
// Each company+period has at most one current/historical bill; no edits/replacement after issue.
export interface OperationalBoard {
 serviceId:'it-manual';userId:string;configuration:'ready'|'setup_required';problems:string[];
 canSetRates:boolean;canPrepareBill:boolean;canRecordHistory:boolean;canInspect:boolean;
 ratesVersion:number;
 rateVersions:{id:string;version:number;effectiveOn:string;currency:'MYR';monthly:Partial<Record<AssetKind,number>>;evidence:string;note:string;byId:string;at:string}[];
 companies:{id:string;name:string}[];
 jobs:{id:string;title:string}[];
 assets:{id:string;tag:string;model:string;kind:AssetKind;ownerId:string;status:string;billingVersion:string;billingEligible:boolean;inspectionVersion:number;lastInspectionOn:string|null;nextInspectionOn:string|null;inspectionState:'initial_check_needed'|'due'|'scheduled';inspectionReviewStatus:'recorded_unreviewed'|'linked_job_accepted'|'returned'|null;lastCondition:'healthy'|'attention'|'unsafe'|null}[];
 bills:Bill[]; // Existing ItRentalBill plus snapshot fields below.
 inspections:{id:string;jobId:string;reviewStatus:'recorded_unreviewed'|'linked_job_accepted'|'returned';assetId:string;version:number;inspectedOn:string;nextDueOn:string;condition:'healthy'|'attention'|'unsafe';findings:string;evidence:string;followUp:string;byId:string;at:string}[];
}
// Bills add source:'configured_rates'|'historical_record', currency:'MYR', rateId:string|null,
// rateVersion:number|null, rateEffectiveOn:string|null, assetSnapshot:[{id,tag,kind,ownerId,status,version}],
// evidence:string,note:string,requestId:string,createdById:string; paid remains null at creation.
// Historical total is actual entered amount, lines:[], no fictitious rate snapshot or inferred paid state.
// Every save/recovery result serviceId,userId,requestId,kind,terminal:'committed'|'rejected',
// recordId:string|null,version:number|null,message:string|null,replayed:boolean (lookup found:boolean).

export interface Bill {
 rentalCorrectionState?:'current'|'replacement'|'unverified';originalBillId?:string;correctionReplacementId?:string;id:string;companyId:string;period:string;invoiceRef:string;total:number;source:'configured_rates'|'historical_record'|'legacy_unverified';currency:'MYR'|null;rateId:string|null;rateVersion:number|null;rateEffectiveOn:string|null;lines:{kind:AssetKind;count:number;rate:number;amount:number}[];evidence:string;note:string;issuedAt:string;createdById:string;paid:{ref:string;at:string;by:string}|null;assetSnapshot:{id:string;tag:string;kind:AssetKind;ownerId:string;status:string;version:string}[];}
