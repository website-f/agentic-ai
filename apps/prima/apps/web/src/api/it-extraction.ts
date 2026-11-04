export type ExtractionKind='tickets'|'jobs';
export interface ExtractionStatus {enabled:boolean;configured:boolean;permitted:boolean;sourceTypes:string[];dataClasses:string[];previewOnly:boolean}
export interface ExtractionRequest {kind:ExtractionKind;source:{type:'paste';label:string;text:string;dataClass:'synthetic'|'approved-it-work'};acknowledgement:{version:'it-extraction-v1';sendToAzure:true}}
export interface ExtractionPreview {extractionId:string;kind:ExtractionKind;source:{label:string;sha256:string;canonicalText:string};rows:{row:number;fields:Record<string,{raw:string|null;start:number|null;end:number|null}>;errors:string[];warnings:string[]}[];readyForT9Preview:false;operationalWrites:0;expiresAt:string;warnings:string[]}
export interface ExtractionClient {itExtractionStatus(signal?:AbortSignal):Promise<ExtractionStatus>;itExtractionPreview(input:ExtractionRequest,signal?:AbortSignal):Promise<ExtractionPreview>}
