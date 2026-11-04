/** Workflow-event measurement only: not attendance, surveillance or an approval authority. */
export const metricWorkflows = ['ticket','job','asset_entry','import_review','inspection','rental_bill','procurement','onboarding','website','connection_setup'] as const;
export type MetricWorkflow = typeof metricWorkflows[number];
export type MetricStage = 'request'|'work'|'check'|'approve'|'confirm';
export type MetricMode = 'queued'|'active'|'external_wait'|'submitted'|'closed';
export type MetricAction = 'start'|'pause'|'wait'|'resume'|'submit';
export interface MetricRef { workflow:MetricWorkflow; recordId:string; stage:MetricStage; cycle:number; coverageSegment:number; complexity:'routine'|'complex'|'unclassified'; }
export interface MetricTarget {
 id:string; version:number; requestId:string; payloadHash:string; workflow:MetricWorkflow; stage:MetricStage; complexity:'routine'|'complex'|'unclassified';
 workMin:number|null; workMax:number|null; businessDueMinutes:number|null;
 provisional:boolean; reason:string; reviewedById:string; reviewedAt:string;
}
export interface MetricCalendar {
 version:number; timezone:'Asia/Kuala_Lumpur';
 /** Local weekday 0=Sunday. Windows never cross midnight; holidays are local YYYY-MM-DD. */
 weekdays:number[]; windows:{fromMinute:number;toMinute:number}[]; holidays:string[];
}
export interface MetricWaiting { reason:'requester_information'|'supplier'|'provider_permission'|'physical_access'|'other'; ownerId:string; note:string; reviewAt:string; }
/** Supplied by an audited server adapter after reloading current record and actor. Never from the browser. */
export interface MetricAuthority {
 actorId:string; ref:MetricRef; sourceVersion:string; ownerId:string;
 canView:boolean; canTrackOwn:boolean; canOversee:boolean;
 eligibleWaitOwnerIds:string[]; domainTerminal:boolean; domainTerminalAt:string|null; boundaryChanged:boolean;
 /** Quality is source-derived; unknown is not zero or a successful check. */
 quality:MetricQuality;
}
export interface MetricQuality {
 firstPassAccepted:boolean|null; returnCount:number|null; reopenedCount:number|null;
 requiredEvidenceComplete:boolean|null; errorCount:number|null;
 requesterConfirmed:boolean|null; evidenceRefs:string[];
}
export interface MetricEvent {
 id:string; streamId:string; sequence:number; requestId:string; payloadHash:string;
 actorId:string; at:string; action:MetricAction|'opened'|'domain_closed'|'boundary_unknown';
 sourceVersion:string; mode:MetricMode; waiting:MetricWaiting|null;
}
export interface MetricStream {
 id:string; ref:MetricRef; ownerId:string; sourceVersion:string;
 openedAt:string; version:number; mode:MetricMode; target:MetricTarget|null; closedQuality:MetricQuality|null; boundaryUnknown:boolean;
 calendar:MetricCalendar|null; events:MetricEvent[];
 /** Coverage begins here, never inferred backwards from old record creation times. */
 coverage:'prospective_only';
}
export interface MetricDurations {
 activeMinutes:number; queueMinutes:number; externalWaitMinutes:number; handoffWaitMinutes:number;
 elapsedMinutes:number; businessElapsedMinutes:number|null;
 /** Claimed workflow work intervals, not proof of continuous physical activity. */
 measurement:'staff_recorded_workflow_intervals'; asOf:string; clockValid:boolean;
}
export interface MetricCommand {requestId:string;streamId:string;expectedVersion:number;sourceVersion:string;action:MetricAction;waiting:MetricWaiting|null;}
export type MetricOperation = 'open'|MetricAction|'sync'|'target'|'reconcile';
export interface MetricReceipt {serviceId:'it-workflow-metrics';userId:string;requestId:string;kind:MetricOperation;terminal:'committed'|'rejected';streamId:string|null;version:number|null;payloadHash:string;at:string;}
export interface MetricBoardRow {stream:MetricStream;currentSourceVersion:string;eligibleWaitOwnerIds:string[];durations:MetricDurations|null;measurementIssue:string|null;quality:MetricQuality;canTrackOwn:boolean;allowedActions:MetricAction[];canOversee:boolean;canSyncTerminal:boolean;canReconcileBoundary:boolean;}
export interface MetricBoard {serviceId:'it-workflow-metrics';userId:string;configuration:'ready'|'setup_required';problems:string[];rows:MetricBoardRow[];}

export interface MetricTargetReview {requestId:string;workflow:MetricWorkflow;stage:MetricStage;complexity:'routine'|'complex'|'unclassified';expectedVersion:number;workMin:number|null;workMax:number|null;businessDueMinutes:number|null;provisional:boolean;reason:string;}
