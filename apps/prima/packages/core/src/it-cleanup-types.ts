/** Controlled recoverable demo cleanup. Documentary attestation is not automatic provenance detection. */
export type CleanupKind='asset'|'system'|'intake';
export type CleanupAction='nominate'|'decide'|'restore';
export type CleanupClassification='unknown'|'verified_demo'|'real'|'mixed';
export interface CleanupNominateInput {requestId:string;kind:CleanupKind;recordId:string;expectedHash:string;originSummary:string;originProof:string;}
export interface CleanupDecideInput {requestId:string;nominationId:string;expectedVersion:number;classification:CleanupClassification;decision:'hold'|'archive';reason:string;evidenceReviewed:boolean;}
export interface CleanupRestoreInput {requestId:string;nominationId:string;expectedVersion:number;expectedArchiveVersion:number;expectedHash:string;reason:string;}
export interface CleanupEvent {requestId:string;kind:CleanupAction;hash:string;byId:string;at:string;input:CleanupNominateInput|CleanupDecideInput|CleanupRestoreInput;}
export interface CleanupDecision {classification:CleanupClassification;decision:'hold'|'archive';reason:string;evidenceReviewed:boolean;byId:string;at:string;}
export interface CleanupNomination {id:string;kind:CleanupKind;recordId:string;companyId:string;recordHash:string;creatorId:string;originSummary:string;originProof:string;nominatedById:string;at:string;version:number;status:'pending'|'held'|'archived'|'restored';classification:CleanupClassification;decision:CleanupDecision|null;history:CleanupEvent[];}
export interface CleanupArchive {id:string;kind:CleanupKind;recordId:string;companyId:string;nominationId:string;recordHash:string;version:number;archived:boolean;snapshot:unknown;history:CleanupEvent[];}
export interface CleanupReceipt {id:string;userId:string;requestId:string;kind:CleanupAction;hash:string;outcome:'committed'|'rejected';recordId:string|null;version:number|null;message:string|null;at:string;}
export interface CleanupRecordView {kind:CleanupKind;id:string;label:string;recordHash:string;archived:boolean;archiveVersion:number;provenance:CleanupClassification;canNominate:boolean;blockedReasons:string[];dependencyCompleteness:'complete'|'unknown';}
export interface CleanupNominationView extends CleanupNomination {canDecide:boolean;canArchive:boolean;canRestore:boolean;blockedReasons:string[];activeArchive:{nominationId:string;version:number;recordHash:string}|null;}
export interface CleanupBoard {serviceId:'it-cleanup';userId:string;configuration:'ready'|'setup_required';problems:string[];scopeNotice:string;records:CleanupRecordView[];nominations:CleanupNominationView[];}
export interface CleanupReceiptView {serviceId:'it-cleanup';userId:string;requestId:string;kind:CleanupAction;found:boolean;terminal:'committed'|'rejected'|null;recordId:string|null;version:number|null;message:string|null;replayed:boolean;}
