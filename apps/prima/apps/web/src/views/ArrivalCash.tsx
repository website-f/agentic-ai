import { Select } from '../SearchSelect';
import { useState } from 'react';
import { useApp } from '../App';
import { api } from '../api';
import { ErrorNotice, useLoad, useAction } from '../ui';
import { readAsDataUrl } from './Proof';
type View=Awaited<ReturnType<typeof api.finArrivalCash>>;
type Row=View['rows'][number];
export function ArrivalCashView() {
  const {me,companyId}=useApp();
  const [company,setCompany]=useState(companyId);
  return <div className="page arrival-cash"><style>{`.arrival-cash .stack{display:flex;flex-direction:column;gap:12px}.arrival-cash label{display:flex;flex-direction:column;gap:4px}.arrival-cash input:not([type=checkbox]),.arrival-cash select{box-sizing:border-box;max-width:100%;width:100%;min-width:0}.arrival-cash input[type=checkbox]{align-self:flex-start}.arrival-cash .panel{min-width:0;overflow-wrap:anywhere}.arrival-cash button{max-width:100%;white-space:normal}`}</style><h2>Arrival cash advances</h2><label>Company<Select className="select" aria-label="Arrival company" value={company} onChange={e=>setCompany(e.target.value)}>{me.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label><ArrivalCompany key={company} companyId={company}/></div>;
}
function ArrivalCompany({companyId}:{companyId:string}) {
  const {data,error,reload}=useLoad(()=>api.finArrivalCash(companyId),[companyId]);
  if(error)return <ErrorNotice error={error}/>;
  if(!data)return <p>Loading arrival records…</p>;
  return <section><p className="notice">{data.gate}</p><p>FWM requests each amount and purpose. The CEO decides each request. Only actual cash handover creates an amount owed. A missing genuine signed receipt stays pending and holds recovery. No bank account is needed. Recovery begins in the first wage month, over the months FWM sets, within a reviewed lawful cap.</p>
    {data.canRequest && <RequestForm view={data} reload={reload}/>}
    {data.rows.map(r=><ArrivalRow key={r.id} row={r} view={data} reload={reload}/>)}
  </section>;
}
function RequestForm({view,row,reload}:{view:View;row?:Row;reload:()=>void}) {
  const act=useAction(), [values,set]=useState<Record<string,string>>({personId:row?.personId??'',siteId:row?.siteId??'',arrivedOn:row?.arrivedOn??'',months:row?String(row.months):''});
  const [confirmed,confirm]=useState(false);
  const field=(key:string,label:string,type='text')=><label>{label}<input className="input" step={type==='number'?'any':undefined} type={type} value={values[key]??''} onChange={e=>set({...values,[key]:e.target.value})} disabled={!!row && ['months','arrivedOn'].includes(key)}/></label>;
  return <form className="panel stack" onSubmit={async e=>{e.preventDefault();if(await act.run(()=>api.finControlAction(view.companyId,'arrivalcash','request',{...values,id:row?.id,amount:Number(values.amount),months:Number(values.months),awaitingPlks:confirmed,withoutWages:confirmed,recentArrivalConfirmed:confirmed}),'Request recorded; Finance can see it. No amount is owed yet.'))reload();}}>
    <h3>{row?'Request another handout':'New arrival request'}</h3>
    <label>Worker<Select className="select" aria-label="Worker" value={values.personId} disabled={!!row} onChange={e=>set({...values,personId:e.target.value})}><option value="">Select worker</option>{view.workers.map(p=><option key={p.id} value={p.id}>{p.staffNo} · {p.name}</option>)}</Select></label>
    <label>Site<Select className="select" aria-label="Site" value={values.siteId} disabled={!!row} onChange={e=>set({...values,siteId:e.target.value})}><option value="">Select site</option>{view.sites.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
    {field('arrivedOn','Actual arrival date','date')}{field('months','FWM recovery months','number')}{field('requestId','Unique request reference')}{field('amount','Amount (RM)','number')}{field('purpose','Purpose')}
    <label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/> I checked recent arrival, awaiting PLKS and no wages. No fixed 60-day rule is assumed.</label>
    <button className="btn" disabled={!confirmed||act.busy}>Submit request</button><ErrorNotice error={act.error}/>
  </form>;
}
function ArrivalRow({row:r,view,reload}:{row:Row;view:View;reload:()=>void}) {
  const act=useAction(),[v,set]=useState<Record<string,string>>({}),[checked,check]=useState(false),[doc,setDoc]=useState<{name:string;data:string}|null>(null);
  const field=(key:string,label:string,type='text')=><label>{label}<input className="input" step={type==='number'?'any':undefined} type={type} value={v[key]??''} onChange={e=>set({...v,[key]:e.target.value})}/></label>;
  const go=async(action:string,input:Record<string,unknown>)=>{if(await act.run(()=>api.finControlAction(view.companyId,'arrivalcash',action,{id:r.id,...input}),'Record saved; Finance notice recorded.'))reload();};
  const download=async(id:string)=>{await act.run(async()=>{const d=await api.finArrivalCashEvidence(view.companyId,id);const a=document.createElement('a');a.href=d.data;a.download=d.name;a.click();},'Evidence retrieved.');};
  return <article className="panel stack"><h3>{r.name} · RM{r.balance.toFixed(2)} owed</h3><p>{r.id} · Arrival {r.arrivedOn} · {r.months} recovery months · {r.policy?'Review recorded':'Finance/legal review pending'}</p>
    {r.requests.map(q=><div className="panel" key={q.id}><h4>{q.id} · RM{q.amount.toFixed(2)} · {q.purpose}</h4><p>{q.decision?(q.decision.approved?'CEO approved':'Refused'):'Awaiting CEO decision'}{q.decision?` · ${q.decision.reason}`:''}{q.handover?` · Handed over ${q.handover.on}, receipt ${q.handover.evidence ?? 'pending'}`:''}</p>
      {q.handover?.evidence&&<button className="btn" onClick={()=>void download(q.handover!.evidence!)}>Download signed receipt</button>}
      {view.canRequest&&q.handover&&!q.handover.evidence&&<><p>Actual cash is owed. Signed acknowledgement is pending; recovery is held.</p><button className="btn" disabled={act.busy||!doc||!checked} onClick={()=>void go('receipt',{requestId:q.id,signedByPersonId:r.personId,amount:q.handover!.amount,reference:q.handover!.reference,transactionSpecific:checked,evidence:doc})}>Attach genuine signed receipt</button></>}
      {view.canDecide&&!q.decision&&<>{field(`reason-${q.id}`,'Decision reason')}<button className="btn" disabled={act.busy} onClick={()=>void go('decide',{requestId:q.id,personId:r.personId,amount:q.amount,approved:true,reason:v[`reason-${q.id}`]})}>Approve</button><button className="btn" disabled={act.busy} onClick={()=>void go('decide',{requestId:q.id,personId:r.personId,amount:q.amount,approved:false,reason:v[`reason-${q.id}`]})}>Refuse</button></>}
      {view.canRequest&&q.decision?.approved&&!q.handover&&!r.repayments.length&&<>{field('on','Actual handover date','date')}{field('reference','Payment reference')}<button className="btn" disabled={act.busy||(!!doc&&!checked)||!r.policy} onClick={()=>void go('handover',{requestId:q.id,personId:r.personId,signedByPersonId:r.personId,amount:q.amount,on:v.on,reference:v.reference,actualDisbursementConfirmed:true,transactionSpecific:checked,evidence:doc})}>{doc?'Record handover with signed receipt':'Record actual handover — receipt pending'}</button></>}
    </div>)}
    {(view.canRequest||view.canReview)&&<><label>Evidence (genuine receipt or review)<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={async e=>{const f=e.target.files?.[0];if(f)setDoc({name:f.name,data:await readAsDataUrl(f)});}}/></label><label><input type="checkbox" checked={checked} onChange={e=>check(e.target.checked)}/> I verified the evidence for this exact transaction or review. A receipt was genuinely supplied by the worker for this payment; no stored signature is pasted.</label></>}
    {view.canReview&&!r.policy&&<><h4>Finance/legal review</h4><p>Confirm eligibility, advance limits and permissions, repayment terms, wage basis and all deductions against applicable law. Enter the reviewed cap; this screen does not establish a legal exemption.</p>{field('capPercent','Reviewed cap percentage','number')}{field('fromPeriod','Effective month','month')}{field('toPeriod','Expiry month','month')}{field('recoveryAccount','Reviewed arrival receivable account')}{field('financeRef','Finance decision reference')}{field('legalRef','Legal review reference')}<button className="btn" disabled={act.busy||!checked||!doc} onClick={()=>void go('review',{...v,capPercent:Number(v.capPercent),basis:'gross-all-deductions',financeLegalConfirmed:checked,evidence:doc})}>Record policy review</button></>}
    {r.policy&&<button className="btn" onClick={()=>void download(r.policy!.evidence)}>Download review evidence</button>}
    <h4>Finance notices and recovery history</h4>{r.notices.map((n,i)=><p key={i}>{n.at} · {n.event} · {n.reference} · {n.by}</p>)}{r.repayments.map(p=><p key={p.runId}>{p.period} · RM{p.amount.toFixed(2)} deducted · payroll {p.runId}</p>)}
    {view.canRequest&&!r.repayments.length&&<RequestForm view={view} row={r} reload={reload}/>}<ErrorNotice error={act.error}/>
  </article>;
}
