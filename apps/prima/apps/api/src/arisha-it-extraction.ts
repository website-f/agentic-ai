import { createHash, randomUUID } from 'node:crypto';

/** Preview only: stores metadata audit events, never operational records or T9 commits. */
export const EXTRACTION_FIELDS = {
  tickets: ['title', 'category', 'priority', 'requester', 'channel', 'raisedOn', 'detail', 'itPerson'],
  jobs: ['title', 'kind', 'priority', 'technical', 'doer', 'dueOn', 'detail'],
} as const;
export type ExtractionKind = keyof typeof EXTRACTION_FIELDS;
export interface ExtractionActor { id: string; opsTier?: string | null; integration?: string | null; verifiedEntra: boolean }
export interface ExtractionConfig { enabled: boolean; arishaEnabled: boolean; sourceTypes: readonly string[]; dataClasses: readonly string[] }
export interface ExtractionModel { extract(input: { kind: ExtractionKind; text: string; signal: AbortSignal }): Promise<unknown> }
export class ExtractionError extends Error {
  constructor(public readonly code: 'DISABLED'|'FORBIDDEN'|'CONSENT_REQUIRED'|'INVALID_INPUT'|'INVALID_MODEL_OUTPUT'|'BUSY'|'MODEL_UNAVAILABLE') { super(code); }
}
export interface ExtractionAuditEvent {
  attemptId: string; actorId: string; at: string; phase: 'started'|'terminal';
  sourceSha256: string; sourceLength: number; kind: ExtractionKind;
  selfDeclaredDataClass: string; consentVersion: 'it-extraction-v1';
  outcome: 'started'|'success'|'provider_failed'|'timeout_transfer_unknown'|'invalid_model_output';
}
export interface ExtractionAudit { append(event: ExtractionAuditEvent): Promise<void> }
const missingAudit:ExtractionAudit={append:async()=>{throw new ExtractionError('MODEL_UNAVAILABLE');}};
type Evidence = { raw: string | null; start: number | null; end: number | null };
const LIMITS: Record<string,number> = { title:120, category:30, priority:2, requester:80, channel:20, raisedOn:10, detail:1000, itPerson:80, kind:20, technical:5, doer:80, dueOn:10 };
const REQUIRED = { tickets:['title','priority','requester','channel'], jobs:['title','priority','doer','dueOn','technical'] };
function object(x:unknown): x is Record<string,unknown> { return !!x && typeof x==='object' && !Array.isArray(x); }
function exact(x:unknown, keys:readonly string[]): x is Record<string,unknown> { return object(x) && Object.keys(x).length===keys.length && Object.keys(x).every(k=>keys.includes(k)); }
function deny(code:ConstructorParameters<typeof ExtractionError>[0]):never { throw new ExtractionError(code); }
export function extractionConfig(env:NodeJS.ProcessEnv=process.env):ExtractionConfig {
  const list=(v:string|undefined)=>v?.split(',').map(s=>s.trim()).filter(Boolean)??[];
  return { enabled:env.ARISHA_IT_EXTRACTION_ENABLED==='true', arishaEnabled:env.ARISHA_ENABLED==='true', sourceTypes:list(env.ARISHA_IT_EXTRACTION_SOURCE_TYPES), dataClasses:list(env.ARISHA_IT_EXTRACTION_DATA_CLASSES) };
}
export function extractionPermitted(actor:ExtractionActor):boolean { return actor.verifiedEntra && !actor.integration && actor.id==='u-fauzan' && actor.opsTier==='ceo'; }
function inputOf(raw:unknown,cfg:ExtractionConfig) {
  if(!exact(raw,['kind','source','acknowledgement']) || !['tickets','jobs'].includes(String(raw.kind)))deny('INVALID_INPUT');
  const source=raw.source, ack=raw.acknowledgement;
  if(!exact(source,['type','label','text','dataClass']) || source.type!=='paste' || !cfg.sourceTypes.includes('paste'))deny('INVALID_INPUT');
  if(typeof source.dataClass!=='string' || !['synthetic','approved-it-work'].includes(source.dataClass) || !cfg.dataClasses.includes(source.dataClass))deny('FORBIDDEN');
  if(!exact(ack,['version','sendToAzure']) || ack.version!=='it-extraction-v1' || ack.sendToAzure!==true)deny('CONSENT_REQUIRED');
  if(typeof source.label!=='string' || !source.label.trim() || source.label.length>120 || /[\u0000-\u001f\u007f]/.test(source.label))deny('INVALID_INPUT');
  if(typeof source.text!=='string' || !source.text.trim() || source.text.length>16000 || [...source.text].length>8000 || Buffer.byteLength(source.text,'utf8')>32000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source.text))deny('INVALID_INPUT');
  return {kind:raw.kind as ExtractionKind,source:{type:'paste' as const,label:source.label,text:source.text.replace(/\r\n?/g,'\n'),dataClass:source.dataClass}};
}
function realDate(v:string):boolean { if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false; const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10)===v; }
/** Evidence correctness is necessary, not a guarantee of semantic accuracy. Human review is mandatory. */
export function validateExtraction(kind:ExtractionKind,text:string,raw:unknown) {
  if(!exact(raw,['rows']) || !Array.isArray(raw.rows) || raw.rows.length>20)deny('INVALID_MODEL_OUTPUT');
  return raw.rows.map((row:unknown,index:number)=>{
    if(!exact(row,['fields']) || !exact(row.fields,EXTRACTION_FIELDS[kind]))deny('INVALID_MODEL_OUTPUT');
    const fields:Record<string,Evidence>={}, errors:string[]=[],warnings:string[]=[];
    for(const field of EXTRACTION_FIELDS[kind]) {
      const v=row.fields[field];
      if(!exact(v,['raw','start','end']))deny('INVALID_MODEL_OUTPUT');
      if(v.raw===null) { if(v.start!==null||v.end!==null)deny('INVALID_MODEL_OUTPUT');fields[field]={raw:null,start:null,end:null};if(REQUIRED[kind].includes(field))errors.push(`MISSING_${field}`);continue; }
      if(typeof v.raw!=='string'||!v.raw.trim()||v.raw.length>LIMITS[field]||typeof v.start!=='number'||typeof v.end!=='number'||!Number.isInteger(v.start)||!Number.isInteger(v.end)||v.start<0||v.end<=v.start||v.end>text.length||text.slice(v.start,v.end)!==v.raw)deny('INVALID_MODEL_OUTPUT');
      fields[field]={raw:v.raw,start:v.start,end:v.end};
      const value=v.raw.trim();
      if(field==='priority'&&!['P1','P2','P3'].includes(value))errors.push('INVALID_priority');
      if(field==='category'&&!['ACCOUNT','DEVICE','M365','NETWORK','PRIMA','OTHER'].includes(value))errors.push('REVIEW_category');
      if(field==='channel'&&!['teams','email','phone','in_person'].includes(value))errors.push('REVIEW_channel');
      if(field==='kind'&&!['task','install','check','training','access','other'].includes(value))errors.push('REVIEW_kind');
      if(field==='technical'&&!['true','false','yes','no'].includes(value))errors.push('REVIEW_technical');
      if((field==='raisedOn'||field==='dueOn')&&!realDate(value))errors.push(`INVALID_${field}`);
      if(field==='doer'||field==='itPerson')warnings.push('STAFF_MATCH_REQUIRED');
    }
    warnings.push('HUMAN_REVIEW_REQUIRED','T9_VALIDATION_REQUIRED');
    return {row:index+1,fields,errors,warnings};
  });
}
export class ItExtractionPreviewService {
  private busy=new Set<string>();
  constructor(private readonly model:ExtractionModel,private readonly cfg:ExtractionConfig,private readonly timeoutMs=30000,private readonly audit:ExtractionAudit=missingAudit){}
  status(actor:ExtractionActor){return {enabled:this.cfg.enabled&&this.cfg.arishaEnabled,permitted:extractionPermitted(actor),sourceTypes:this.cfg.sourceTypes.filter(s=>s==='paste'),dataClasses:this.cfg.dataClasses.filter(s=>['synthetic','approved-it-work'].includes(s)),previewOnly:true};}
  async preview(actor:ExtractionActor,body:unknown) {
    if(!extractionPermitted(actor))deny('FORBIDDEN');
    if(!this.cfg.enabled||!this.cfg.arishaEnabled)deny('DISABLED');
    const input=inputOf(body,this.cfg);
    if(this.busy.has(actor.id))deny('BUSY');
    this.busy.add(actor.id);
    const ctrl=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const attemptId=randomUUID(), sha256=createHash('sha256').update(input.source.text).digest('hex');
    const metadata={attemptId,actorId:actor.id,sourceSha256:sha256,sourceLength:input.source.text.length,kind:input.kind,selfDeclaredDataClass:input.source.dataClass,consentVersion:'it-extraction-v1' as const};
    let started=false, terminalAttempted=false, timedOut=false;
    const append=async(phase:ExtractionAuditEvent['phase'],outcome:ExtractionAuditEvent['outcome'])=>{
      try { await this.audit.append({...metadata,at:new Date().toISOString(),phase,outcome}); }
      catch { throw new ExtractionError('MODEL_UNAVAILABLE'); }
    };
    const terminal=async(outcome:ExtractionAuditEvent['outcome'])=>{
      // Mark before awaiting: a failed/uncertain append must never be retried as a second outcome.
      terminalAttempted=true; await append('terminal',outcome);
    };
    try {
      await append('started','started'); started=true;
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;ctrl.abort();reject(new ExtractionError('MODEL_UNAVAILABLE'));},this.timeoutMs);});
      const raw=await Promise.race([this.model.extract({kind:input.kind,text:input.source.text,signal:ctrl.signal}),deadline]);
      const rows=validateExtraction(input.kind,input.source.text,raw);
      if(timer)clearTimeout(timer);
      await terminal('success');
      return {extractionId:attemptId,kind:input.kind,source:{label:input.source.label,sha256,canonicalText:input.source.text},rows,readyForT9Preview:false,operationalWrites:0,expiresAt:new Date(Date.now()+15*60000).toISOString(),warnings:['PROPOSAL_ONLY','HUMAN_REVIEW_REQUIRED','T9_HANDOFF_DISABLED']};
    } catch(e) {
      if(started&&!terminalAttempted)await terminal(timedOut?'timeout_transfer_unknown':e instanceof ExtractionError&&e.code==='INVALID_MODEL_OUTPUT'?'invalid_model_output':'provider_failed');
      if(e instanceof ExtractionError)throw e;deny('MODEL_UNAVAILABLE');
    }
    finally {if(timer)clearTimeout(timer);ctrl.abort();this.busy.delete(actor.id);}

  }
}
