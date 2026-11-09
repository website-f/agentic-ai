import { Select as KSelect } from '../SearchSelect';
import {ItCleanup} from './ItCleanup';
import {ItCorrections} from './ItCorrections';
import {correctionVisible} from '../it-corrections/client';
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { PlusIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../App';
import { Chip, ErrorNotice, Loading, useLoad } from '../ui';
import { ManualSession, manualMarker, type ManualKind } from '../it-manual/session';

export function manualItVisible(user:{integration?:unknown;role:string;department?:string|null;opsTier?:string|null;itRole?:string|null}) {
  return !user.integration&&user.role!=='site_device'&&((user.role==='pwvsb_officer'&&user.department==='it'&&['manager','lead','executive'].includes(user.itRole??''))||['ceo','coo'].includes(user.opsTier??'')||['audit','hr','chief_of_staff'].includes(user.department??''));
}
type Choice={id:string;name:string;title?:string};
type Guidance={id:string;name:string;manual:{kind:'guidance';version:number;state:string;connection:'not_connected';siteOwnerUserId:string|null;itResponsibleId:string|null;siteUrl:string|null;nextReviewOn:string|null;jobId:string|null;evidence:string;guidanceNote:string;guidanceById:string|null;checkedById:string|null;unitLabel?:string;companyId?:string|null}};
type Board={serviceId:'it-manual';configuration:'ready'|'setup_required';problems?:string[];userId:string;canCreate:boolean;canCheck:boolean;canCreateAsset:boolean;staff:Choice[];itStaff:Choice[];companies:Choice[];jobs?:{id:string;title:string}[];onboarding:unknown[];accounts:Record<string,unknown>[];connection:'not_connected'};
const choices=(value:unknown):value is Choice[]=>Array.isArray(value)&&value.every(x=>x&&typeof x.id==='string'&&typeof x.name==='string');
export function decodeManualBoard(value:unknown,userId:string):Board {
  const b=value as Board;
  if(!b||b.serviceId!=='it-manual'||!['ready','setup_required'].includes(b.configuration)||b.userId!==userId||typeof b.canCreate!=='boolean'||typeof b.canCheck!=='boolean'||typeof b.canCreateAsset!=='boolean'||!Array.isArray(b.jobs)||!b.jobs.every(j=>j&&typeof j.id==='string'&&typeof j.title==='string')||!choices(b.staff)||!choices(b.itStaff)||!choices(b.companies)||!Array.isArray(b.accounts)||!Array.isArray(b.onboarding)||b.connection!=='not_connected')throw Error('Manual IT capability could not be verified.');
  if(b.configuration!=='ready'&&(b.canCreate||b.canCheck||b.canCreateAsset))throw Error('Manual IT storage protection is not ready.');
  for(const record of b.accounts){
    if(!record||typeof record.id!=='string'||typeof record.name!=='string')throw Error('Manual record identity could not be verified.');
    const m=record.manual as Guidance['manual']|undefined;
    if(m?.kind==='guidance'&&(!Number.isSafeInteger(m.version)||m.version<1||!['recorded','guidance_given','manually_checked'].includes(m.state)||m.connection!=='not_connected'||typeof m.evidence!=='string'||['siteOwnerUserId','itResponsibleId','siteUrl','nextReviewOn','jobId','guidanceById','checkedById'].some(k=>{const v=(m as unknown as Record<string,unknown>)[k];return v!==null&&typeof v!=='string';})))throw Error('Guidance record version or provenance could not be verified.');
  }
  return b;
}
const createAction:Record<ManualKind,string>={intake:'createIntake',system:'createSystem',guidance:'createGuidance',asset:'createAsset'};
export function ItManualPanel({mode,extra}:{mode:'intake'|'systems'|'assets';/** P91: shown next to the Add button (e.g. Import). */extra?:ReactNode}) {
  const {me}=useApp();const userId=me.user.id;
  const [opened,setOpened]=useState<ManualKind|null>(null);
  const [review,setReview]=useState<string|null>(null);
  const [reviewAsCheck,setReviewAsCheck]=useState(false);
  const {data,error,reload}=useLoad(async()=>decodeManualBoard(await api.itManualAct(userId,'manualBoard',{}),userId),[userId]);
  if(error)return <div className="panel it-sheet"><ErrorNotice error={error}/><button className="btn" onClick={reload}>Retry manual IT options</button></div>;
  if(!data||data.userId!==userId)return <Loading what="manual IT options for your account"/>;
  return <section className="panel it-sheet" aria-label="Manual IT records">
    {data.configuration==='setup_required'&&<p className="notice" data-tone="warn">Setup required: the protected manual IT record store is not ready. No saving or checking is enabled. IT must complete the reviewed database setup before these records can be used.</p>}
    <h3>{mode==='intake'?'Record a joining or leaving request':mode==='assets'?'Register an existing device':'Register existing systems and SharePoint guidance'}</h3>
    <p className="muted small">Manual records only. This does not create or revoke accounts, grant permissions, create a SharePoint site, or prove a connection is working. Never enter passwords, tokens or recovery codes.</p>
    {(mode==='assets'?data.canCreateAsset:data.canCreate)&&!opened&&!review&&<div className="row it-actions">{(mode==='intake'?['intake']:mode==='assets'?['asset']:['system','guidance'] as ManualKind[]).map(kind=><button className="btn btn-primary" key={kind} onClick={()=>setOpened(kind as ManualKind)}><PlusIcon size={16} weight="bold" aria-hidden="true"/> {kind==='intake'?'Add joining / leaving request':kind==='system'?'Register existing system':kind==='asset'?'Register existing device':'Record SharePoint guidance'}</button>)}{extra}</div>}
    {!(mode==='assets'?data.canCreateAsset:data.canCreate)&&<p className="muted">Read-only here. Authorized IT staff record these details; system access still follows CEO approval.</p>}
    {opened&&data.configuration==='ready'&&(opened==='asset'?data.canCreateAsset:data.canCreate)&&<ManualEditor key={`${userId}:${opened}`} kind={opened} board={data} onClose={()=>{setOpened(null);reload();}}/>}
    {mode==='systems'&&data.accounts.filter(a=>(a.manual as {kind?:unknown}|undefined)?.kind==='guidance').map(a=>{
      const record=a as unknown as Guidance,m=record.manual;
      const name=(id:string|null)=>id?data.staff.find(x=>x.id===id)?.name??data.itStaff.find(x=>x.id===id)?.name??'Linked staff record':'Not linked';
      const canRecord=data.canCreate&&(m.itResponsibleId===userId||data.canCheck);
      const canCheck=data.canCheck&&m.state==='guidance_given'&&m.guidanceById!==userId&&m.itResponsibleId!==userId;
      return <article className="card" key={record.id}>
        <h4>{record.name}</h4><p><Chip tone="unknown">Not connected</Chip> {m.state==='manually_checked'?'Manual evidence checked — not a connection test':m.state==='guidance_given'?'Guidance recorded; independent check pending':'Recorded; guidance/setup pending'}</p>
        <p className="small">Owner: {name(m.siteOwnerUserId)} · IT responsible: {name(m.itResponsibleId)} · Next review: {m.nextReviewOn||'Not scheduled'}</p>
        {!m.companyId&&<p className="small">Unlinked organization: {m.unitLabel||'Not provided'} — not a verified company association.</p>}
        <p className="small">Site/library URL: {m.siteUrl||'Pending — no URL provided'}</p>
        {m.jobId&&<p className="small">Related IT job: {data.jobs?.find(j=>j.id===m.jobId)?.title??'Linked job'} ({m.jobId})</p>}
        <p className="small">Guidance note: {m.guidanceNote||'Not recorded'}</p><p className="small">Evidence: {m.evidence||'Not recorded'}</p>
        {review===record.id&&data.configuration==='ready'&&(canRecord||canCheck)?<GuidanceUpdate key={`${userId}:${record.id}:${m.version}`} record={record} board={data} check={canCheck} defaultCheck={reviewAsCheck} onClose={()=>{setReview(null);reload();}}/>:
          !opened&&!review&&<div className="row it-actions">{canRecord&&<button className="btn" onClick={()=>{setReviewAsCheck(false);setReview(record.id);}}>Record guidance / evidence</button>}{canCheck&&<button className="btn" onClick={()=>{setReviewAsCheck(true);setReview(record.id);}}>Independently check evidence</button>}</div>}
      </article>;
    })}
    {correctionVisible(me.user)&&<><ItCorrections mode={mode}/><ItCleanup mode={mode}/></>}
    {mode==='systems'&&<p className="small"><Chip tone="unknown">Not connected</Chip> SharePoint guidance and pending URLs are administrative records, not approved tenant connections. Actual connections are managed separately.</p>}
  </section>;
}
function Select({label,value,onChange,items,optional=false}:{label:string;value:string;onChange:(value:string)=>void;items:Choice[];optional?:boolean}) {
  return <label className="field">{label}<KSelect className="select" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} required={!optional}><option value="">{optional?'Not linked / not provided':'Choose an authorized record'}</option>{items.map(x=><option key={x.id} value={x.id}>{x.name}{x.title?` — ${x.title}`:''}</option>)}</KSelect></label>;
}
function ManualEditor({kind,board,onClose}:{kind:ManualKind;board:Board;onClose:()=>void}) {
  const [,render]=useReducer(x=>x+1,0);
  const [form,setForm]=useState<Record<string,string>>({kind:'join',systemKind:'other',assetKind:'LAPTOP'});
  const [validation,setValidation]=useState('');
  const put=(key:string,value:string)=>setForm(f=>({...f,[key]:value}));
  const session=useMemo(()=>new ManualSession({
    save:async envelope=>{const {requestId,payload,id,expectedVersion}=envelope;return api.itManualAct(board.userId,id?'updateGuidance':createAction[kind],{...(payload as Record<string,unknown>),requestId,...(id?{id,expectedVersion}:{})});},
    receipt:(requestId,receiptKind)=>api.itManualAct(board.userId,'manualReceipt',{requestId,kind:receiptKind}),
    abandon:(requestId,receiptKind)=>api.itManualAct(board.userId,'manualAbandon',{requestId,kind:receiptKind})
  },manualMarker(board.userId),()=>render()),[board.userId,kind]);
  useEffect(()=>{session.start();return ()=>session.dispose();},[session]);
  const s=session.snapshot(),blocked=s.phase!=='editing';
  const field=(label:string,key:string,type='text',required=false)=><label className="field"><span className="label">{label}</span><input className="input" type={type} value={form[key]??''} required={required} maxLength={key==='note'?500:200} onChange={e=>put(key,e.target.value)}/></label>;
  function submit(e:React.FormEvent){e.preventDefault();if(blocked)return;setValidation('');
    const companyId=form.companyId||null,unitLabel=form.unitLabel?.trim()||'';
    let payload:Record<string,unknown>;
    if(kind==='intake'){
      const person=board.staff.find(x=>x.id===form.personUserId);
      if(form.personUserId&&!person){setValidation('Choose a currently authorized staff record.');return;}
      payload={kind:form.kind,personUserId:person?.id??null,personName:person?.name??form.personName?.trim(),jobTitle:form.jobTitle?.trim(),companyId,unitLabel,on:form.on,ownerStaffId:form.itResponsibleId};
    }else if(kind==='asset')payload={tag:form.tag?.trim(),serial:form.serial?.trim(),kind:form.assetKind,model:form.model?.trim(),companyId,unitLabel,location:form.location?.trim(),boughtOn:form.boughtOn||null,warrantyTo:form.warrantyTo||null};
    else if(kind==='system')payload={name:form.name?.trim(),kind:form.systemKind,companyId,unitLabel,note:form.note?.trim()};
    else payload={name:form.name?.trim(),companyId,unitLabel,siteOwnerUserId:form.siteOwnerUserId||null,itResponsibleId:form.itResponsibleId,url:form.url?.trim()||null,nextReviewOn:form.nextReviewOn||null,jobId:form.jobId||null,note:form.note?.trim()};
    void session.save(kind,payload);
  }
  return <div className="card" aria-label="Manual IT editor">
    {s.message&&<p role="status">{s.message}</p>}{validation&&<p role="alert">{validation}</p>}
    {s.pending&&<p className="small">Recovery request: <code>{s.pending.requestId}</code></p>}
    {s.phase==='uncertain'&&<div className="row it-actions"><button className="btn" onClick={()=>void session.recover()} disabled={!s.pending}>Check saved receipt</button><button className="btn" disabled={!s.pending} onClick={()=>void session.cancelPending()}>Resolve or cancel pending request safely</button></div>}
    {s.phase==='done'?<><p>Saved as an administrative record. Refresh the register to continue the existing IT workflow.</p><button className="btn" onClick={onClose}>Back to register</button></>:<form onSubmit={submit}>
      <fieldset disabled={blocked} className="it-fieldset">
        {kind==='intake'?<>
          <label className="field"><span className="label">Request type</span><select className="select" value={form.kind} onChange={e=>put('kind',e.target.value)}><option value="join">Joining</option><option value="leave">Leaving</option></select></label>
          <Select label="Existing authorized staff identity (optional)" value={form.personUserId??''} onChange={v=>put('personUserId',v)} items={board.staff} optional/>
          {!form.personUserId&&<>{field('Unlinked person name — not a verified staff account','personName','text',true)}<p className="small">This does not create a staff account or associate a typed name with an existing person.</p></>}
          {field('Job title','jobTitle','text',true)}{field('Joining / leaving date','on','date',true)}
        </>:kind==='asset'?<>
          <p className="small">Existing stock only. No purchase, cost, payment or rental record is created. The device starts unassigned.</p>
          {field('Asset tag','tag','text',true)}{field('Serial number','serial','text',true)}{field('Model','model','text',true)}
          <label className="field"><span className="label">Device type</span><KSelect className="select" value={form.assetKind} onChange={e=>put('assetKind',e.target.value)}>{['LAPTOP','DESKTOP','PHONE','TABLET','PRINTER','NETWORK','CCTV','OTHER'].map(k=><option key={k} value={k}>{k}</option>)}</KSelect></label>
          {field('Current location','location','text',true)}{field('Purchase date (optional; unknown if empty)','boughtOn','date')}{field('Warranty expiry (optional)','warrantyTo','date')}
        </>:<>{field(kind==='system'?'System name':'SharePoint guidance record name','name','text',true)}{kind==='system'&&<label className="field"><span className="label">System type</span><KSelect className="select" value={form.systemKind} onChange={e=>put('systemKind',e.target.value)}>{['m365','azure','registrar','dns','hosting','github','sql_account','network','cctv','prima','other'].map(x=><option key={x} value={x}>{x}</option>)}</KSelect></label>}</>}
        <Select label="Company (optional)" value={form.companyId??''} onChange={v=>put('companyId',v)} items={board.companies} optional/>
        {!form.companyId&&field('Unlinked organization / unit label (optional)','unitLabel')}
        {(kind==='intake'||kind==='guidance')&&<Select label="Responsible IT staff" value={form.itResponsibleId??''} onChange={v=>put('itResponsibleId',v)} items={board.itStaff}/>}
        {kind==='guidance'&&<>
          <Select label="Site owner (optional authorized staff)" value={form.siteOwnerUserId??''} onChange={v=>put('siteOwnerUserId',v)} items={board.staff} optional/>
          {field('SharePoint URL (optional; leave empty while pending)','url','url')}
          {field('Next review date (optional)','nextReviewOn','date')}
          <Select label="Related existing IT job (optional)" value={form.jobId??''} onChange={v=>put('jobId',v)} items={(board.jobs??[]).map(j=>({id:j.id,name:j.title}))} optional/>
        </>}
        {(kind==='system'||kind==='guidance')&&field('Record note / setup needed','note','text',true)}
        <div className="row it-actions"><button type="submit" className="btn btn-primary">Save manual record</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </fieldset>
      {blocked&&<p className="small">A submitted request cannot be cancelled by closing this form. Its recovery identity is preserved if you leave or reload.</p>}
    </form>}
  </div>;
}

function GuidanceUpdate({record,board,check,defaultCheck,onClose}:{record:Guidance;board:Board;check:boolean;defaultCheck:boolean;onClose:()=>void}) {
  const [,render]=useReducer(x=>x+1,0);const [note,setNote]=useState(''),[evidence,setEvidence]=useState(record.manual.evidence||''),[nextReviewOn,setNextReviewOn]=useState(record.manual.nextReviewOn||'');
  const [target,setTarget]=useState(check&&defaultCheck?'manually_checked':'guidance_given');
  const session=useMemo(()=>new ManualSession({save:async envelope=>api.itManualAct(board.userId,'updateGuidance',{...(envelope.payload as Record<string,unknown>),requestId:envelope.requestId,id:envelope.id,expectedVersion:envelope.expectedVersion}),receipt:(requestId,kind)=>api.itManualAct(board.userId,'manualReceipt',{requestId,kind}),abandon:(requestId,kind)=>api.itManualAct(board.userId,'manualAbandon',{requestId,kind})},manualMarker(board.userId),()=>render()),[board.userId,record.id,record.manual.version]);
  useEffect(()=>{session.start();return()=>session.dispose();},[session]);const s=session.snapshot(),blocked=s.phase!=='editing';
  return <form aria-label="Record manual SharePoint evidence" onSubmit={e=>{e.preventDefault();if(!blocked)void session.save('guidance',{state:target,evidence:evidence.trim(),note:note.trim(),nextReviewOn:nextReviewOn||null},record.id,record.manual.version);}}>
    {s.message&&<p role="status">{s.message}</p>}{s.pending&&<p className="small">Recovery request: <code>{s.pending.requestId}</code></p>}
    {s.phase==='uncertain'&&<div className="row it-actions"><button type="button" className="btn" disabled={!s.pending} onClick={()=>void session.recover()}>Check saved receipt</button><button type="button" className="btn" disabled={!s.pending} onClick={()=>void session.cancelPending()}>Resolve or cancel pending request safely</button></div>}
    {s.phase==='done'?<button type="button" className="btn" onClick={onClose}>Back to register</button>:<fieldset disabled={blocked} className="it-fieldset">
      <p className="small">This records manual guidance and evidence only; it does not certify security or establish Microsoft connectivity.</p>
      {check&&<label className="field">Action<select value={target} onChange={e=>setTarget(e.target.value)}><option value="manually_checked">Independently check recorded evidence</option><option value="guidance_given">Record guidance (not an independent check)</option></select></label>}
      <label className="field">Evidence reference / what was inspected<input required maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
      <label className="field">Work / review note<input required maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <label className="field">Next review date<input type="date" value={nextReviewOn} onChange={e=>setNextReviewOn(e.target.value)}/></label>
      <div className="row it-actions"><button type="submit" className="btn btn-primary">Save manual evidence</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </fieldset>}
  </form>;
}
