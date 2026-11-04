import type {ItRentalBill,ItRentalRate} from '@prima/core';
/** Append-only review records. These never execute payment, refund or provider actions. */
export type RentalCorrectionKind='propose'|'manager_review'|'finance_review'|'cancel'|'payment';
export interface RentalCorrectionRequest {
 id:string; companyId:string; originalId:string; originalHash:string; originalSnapshot:ItRentalBill;
 proposedBill:ItRentalBill; rateSnapshot:ItRentalRate; assetHashes:{id:string;hash:string}[];
 reason:string; requestedById:string; at:string; hash:string;
}
export interface RentalCorrectionReview {
 id:string; requestId:string; companyId:string; revision:number; requestHash:string;
 kind:'manager_review'|'finance_review'|'cancel'; decision:'approve'|'return'|'cancel';
 actorId:string; at:string; note:string; managerReviewId:string|null;
}
export interface RentalBillReplacement {
 id:string; companyId:string; originalId:string; requestId:string; requestHash:string;
 managerReviewId:string; financeReviewId:string; bill:ItRentalBill; at:string;
}
export interface RentalReplacementPayment {id:string;requestId:string;replacementId:string;companyId:string;expectedHash:string;byId:string;at:string;ref:string;}
export interface RentalCorrectionReceipt {id:string;userId:string;requestId:string;kind:RentalCorrectionKind;hash:string;outcome:'committed'|'rejected';recordId:string|null;version:number|null;message:string|null;at:string;}
export interface RentalCorrectionBoard {
 serviceId:'it-rental-correction';userId:string;configuration:'ready'|'setup_required';problems:string[];
 scopeNotice:string;capabilities:{canPropose:boolean;isManager:boolean;isFinance:boolean};
 bills:{id:string;companyId:string;period:string;invoiceRef:string;total:number;source:string;paid:boolean;expectedHash:string;canPropose:boolean;blockedReason:string|null;replacementId:string|null}[];
 assets:{id:string;tag:string;kind:string;companyId:string;status:string;billingVersion:string}[];
 rates:ItRentalRate[];
 requests:{request:RentalCorrectionRequest;revision:number;state:'awaiting_manager'|'awaiting_finance'|'returned'|'cancelled'|'replaced'|'blocked';blockedReason:string|null;reviews:RentalCorrectionReview[];canManagerReview:boolean;canManagerApprove:boolean;canFinanceReview:boolean;canCancel:boolean}[];
 replacements:{replacement:RentalBillReplacement;expectedHash:string;payment:RentalReplacementPayment|null;canRecordPayment:boolean}[];
}
export interface RentalCorrectionInputs {
 propose:{requestId:string;originalId:string;expectedOriginalHash:string;rateId:string;assetRefs:{id:string;version:string}[];invoiceRef:string;reason:string;evidence:string};
 manager_review:{requestId:string;id:string;expectedHash:string;expectedRevision:number;decision:'approve'|'return';note:string};
 finance_review:{requestId:string;id:string;expectedHash:string;expectedRevision:number;decision:'approve'|'return';note:string};
 cancel:{requestId:string;id:string;expectedHash:string;expectedRevision:number;note:string};
 payment:{requestId:string;replacementId:string;expectedHash:string;ref:string};
}
export const rentalCorrectionActions={propose:'rentalCorrectionPropose',manager_review:'rentalCorrectionManagerReview',finance_review:'rentalCorrectionFinanceReview',cancel:'rentalCorrectionCancel',payment:'rentalCorrectionRecordPayment'} as const;
// Board: rentalCorrectionBoard {}. Receipt/Abandon: {requestId,kind}.
// Receipt: {serviceId:'it-rental-correction',userId,requestId,kind,terminal:'committed'|'rejected',recordId,version,message,replayed}, receipt adds found.
// found:false is NOT cancellation. Explicit abandon returns commit or permanent rejection. No payload persisted in browser marker.
