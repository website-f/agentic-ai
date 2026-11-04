/** Public wire shapes; read readiness is not proof of deployment or complete workflow instrumentation. */
import type {MetricBoard,MetricCalendar,MetricOperation,MetricReceipt,MetricRef,MetricStage,MetricTarget,MetricWorkflow} from './it-workflow-metrics-types';
import type {metricCohorts} from './it-workflow-metrics';
export type MetricGatewayAction='metricsChoices'|'metricsBoard'|'metricsTargets'|'metricsRecovery'|'metricsOpen'|'metricsCommand'|'metricsSync'|'metricsReconcile'|'metricsReviewTarget'|'metricsReceipt'|'metricsAbandon';
export interface MetricChoicesView {serviceId:'it-workflow-metrics';userId:string;configuration:'ready'|'setup_required';problems:string[];refs:MetricRef[];choices:{ref:MetricRef;label:string}[];coverage:{workflow:MetricWorkflow;stages:MetricStage[];state:'adapter_available'|'linked_ticket_only'|'not_instrumented'}[];canReviewTargets:boolean;}
export interface MetricBoardView extends MetricBoard {cohorts:ReturnType<typeof metricCohorts>;}
export interface MetricTargetsView {serviceId:'it-workflow-metrics';userId:string;targets:MetricTarget[];calendar:MetricCalendar|null;}
export interface MetricRecoveryView {serviceId:'it-workflow-metrics';userId:string;rows:{streamId:string;ref:MetricRef;canReconcileBoundary:boolean;boundaryUnknown:boolean}[];}
export type MetricReceiptView = (MetricReceipt&{found:true;recordId:string|null})|{serviceId:'it-workflow-metrics';userId:string;requestId:string;kind:MetricOperation;found:false;terminal:null;recordId:null;version:null};
