/** NEW reconstruction on PR50 0129fc8; local only. MYR recording, never payment execution. */
export type ProcurementKind='po'|'receipt'|'invoice'|'advance_request'|'advance_decision'|'payment';
export interface ProcurementAuthority {id:'merdeka';version:number;financeTeam:number;configuredBy:string;configuredAt:string}
export interface ProcurementOperation {requestId:string;kind:ProcurementKind;hash:string;byId:string;version:number;at:string}
export interface ProcurementPO {id:string;revision:1;ref:string;issuedOn:string;supplier:string;purchaseHash:string;authorityVersion:number;authorityHash:string;currency:'MYR';items:{index:number;kind:import('./types').ItAssetKind;description:string;qty:number;unitPrice:number}[];total:number;evidence:string;byId:string;at:string}
export interface ProcurementDelivery {id:string;ref:string;receivedOn:string;qty:number[];location:string;evidence:string;assetIds:string[];byId:string;at:string}
export interface ProcurementInvoice {id:string;ref:string;invoiceOn:string;supplier:string;amount:number;qty:number[];unitPrices:number[];evidence:string;matched:boolean;byId:string;at:string}
export interface ProcurementDecision {requestId:string;byId:string;decision:'approve'|'reject';comment:string;at:string}
export interface ProcurementAdvance {id:string;poId:string;poRevision:number;supplier:string;amount:number;reason:string;terms:string;byId:string;at:string;coo:ProcurementDecision|null;ceo:ProcurementDecision|null}
export interface ProcurementPayment {id:string;ref:string;paidOn:string;amount:number;evidence:string;advanceId:string|null;byId:string;at:string}
export interface ProcurementPacket {id:string;version:number;po:ProcurementPO;receipts:ProcurementDelivery[];invoiceChecks:ProcurementInvoice[];advances:ProcurementAdvance[];payments:ProcurementPayment[];operations:ProcurementOperation[]}
export interface ProcurementReceipt {id:string;userId:string;requestId:string;kind:ProcurementKind;hash:string;outcome:'committed'|'rejected';recordId:string|null;version:number|null;message:string|null;at:string}
export interface ProcurementResult {serviceId:'it-procurement';userId:string;requestId:string;kind:ProcurementKind;terminal:'committed'|'rejected';recordId:string|null;version:number|null;message:string|null;replayed:boolean}
export interface ProcurementRow {purchaseId:string;ref:string;ownerId:string;status:string;source:'tracked'|'legacy_unverified'|'approved_untracked';purchaseHash:string;approvedQuote:{supplier:string;total:number;items:ProcurementPO['items']}|null;packet:ProcurementPacket|null;version:number;canIssuePO:boolean;canRecordReceipt:boolean;canCheckInvoice:boolean;canRequestAdvance:boolean;allowedAdvanceDecisionIds:string[];payableAdvanceIds:string[];normalPaymentEligible:boolean;canRecordPayment:boolean;receivedQty:number[]|null;outstandingQty:number[]|null;paidAmount:number|null;remainingAmount:number|null;problems:string[]}
export interface ProcurementBoard {serviceId:'it-procurement';userId:string;configuration:'ready'|'setup_required';problems:string[];rows:ProcurementRow[]}
export type ProcurementInput =
 | {requestId:string;purchaseId:string;expectedVersion:number;purchaseHash:string;poRef:string;issuedOn:string;evidence:string} // po: exact selected quotation copied by server, no caller supplier/price
 | {requestId:string;purchaseId:string;expectedVersion:number;ref:string;receivedOn:string;qty:number[];location:string;evidence:string}
 | {requestId:string;purchaseId:string;expectedVersion:number;ref:string;invoiceOn:string;supplier:string;amount:number;qty:number[];unitPrices:number[];evidence:string}
 | {requestId:string;purchaseId:string;expectedVersion:number;amount:number;reason:string;terms:string}
 | {requestId:string;purchaseId:string;expectedVersion:number;advanceId:string;decision:'approve'|'reject';comment:string}
 | {requestId:string;purchaseId:string;expectedVersion:number;advanceId:string|null;ref:string;paidOn:string;amount:number;evidence:string};
/** Gateway actions: procurementBoard, procurementReceipt{requestId,kind}, procurementAbandon{requestId,kind},
issuePurchaseOrder, recordPurchaseReceipt, checkPurchaseInvoice, requestPurchaseAdvance, decidePurchaseAdvance, recordPurchasePayment.
All write inputs exact keys above. Read caps server authoritative; no UI role inference. Receipt namespace owner+UUID.
Authority is app READ ONLY, default absent. Only current active Finance staff in configured team may PO/invoice/payment;
IT current ordinary manager/lead/executive receipt/request; COO->CEO distinct fresh exception decisions, never requester/self.
All events append-only; full input canonical hash binds operation UUID. Normal payment after complete actual delivery+matched latest invoice.
Partial receipts remain partial. Historical paid/received records readonly unverified. Board never creates provider readiness.
*/
