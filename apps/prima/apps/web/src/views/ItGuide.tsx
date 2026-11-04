import {useState} from 'react';
import {api} from '../api';import{useApp}from'../App';
import{Chip,ErrorNotice,Loading,useLoad}from'../ui';
import{nextJobSteps,sourceTabs,workflows,type GuideTab}from'../it-guide/catalog';
export function ItGuide({allowedTabs,onOpen}:{allowedTabs:string[];onOpen:(tab:GuideTab)=>void}){
 const{me}=useApp();const owner=me.user.id;const[expanded,setExpanded]=useState<string|null>(null);
 const{data,error,reload}=useLoad(()=>api.itGuidanceBoard(owner),[owner]);
 if(error)return <section className="panel" aria-label="Arisha AI Assistant workflow guide"><ErrorNotice error={error}/><button className="btn" onClick={reload}>Reload my authorized guidance</button></section>;
 if(!data||data.userId!==owner)return <Loading what="your authorized workflow guide"/>;
 const tabs=sourceTabs(data.board,allowedTabs),next=tabs.includes('jobs')?nextJobSteps(data.board):[];
 const counts=data.board.kpis?[data.board.kpis.jobsOpen,data.board.kpis.jobsWaitingCheck,data.board.kpis.jobsLate]:null;
 const verifiedCounts=counts?.every(n=>Number.isSafeInteger(n)&&n>=0)?counts:null;
 const open=(tab:GuideTab)=>{if(tabs.includes(tab))onOpen(tab);};
 return <section className="panel" aria-label="Arisha AI Assistant workflow guide">
  <h3>Arisha AI Assistant — step-by-step IT work guide</h3>
  <p className="notice" data-tone="info">Deterministic guidance from your authorized work snapshot, not a generated AI answer. I can explain the next step; you enter the real data and use the existing authorized action. This guide does not save, approve, provision, send messages or execute payments.</p>
  <p className="small">Snapshot read at {data.observedAt}. Refresh before decisions; live permissions and record state are checked by the actual workflow. No job revision token is supplied by this summary.</p><button className="btn" onClick={reload}>Refresh my work guidance</button>
  {verifiedCounts&&<p className="small">Authorized board summary: {verifiedCounts[0]} open jobs · {verifiedCounts[1]} waiting for checks · {verifiedCounts[2]} late. These are scoped snapshot counts, not proof of completion.</p>}
  <h4>Your permitted next job actions</h4>{!next.length&&<p>No next job action is available in this snapshot. That is not proof that all IT work is complete; check the authorized registers below.</p>}
  {next.map(j=><article className="card" key={j.id}><strong>{j.title}</strong><p>Status: {j.status} · due {j.dueOn} · next responsible person/route: {j.owner}</p><p>{j.action}</p><p className="small">{j.missing}</p><button className="btn" onClick={()=>open('jobs')}>Open Jobs to review {j.id}</button></article>)}
  <h4>Workflow catalog</h4><p className="small">These are {workflows.length} guidance groupings, not {workflows.length} verified deployed modules. Availability, tenant connections and approvals remain separate.</p>
  {workflows.map(flow=>{const accessible=flow.tab!==null&&tabs.includes(flow.tab);return <article className="card" key={flow.id}><button className="link-button" aria-expanded={expanded===flow.id} onClick={()=>setExpanded(expanded===flow.id?null:flow.id)}>{flow.title}</button> <Chip tone={accessible?'info':'unknown'}>{accessible?'Authorized screen available':'Separate setup / not available in this view'}</Chip>{expanded===flow.id&&<div><ol>{flow.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><p><strong>You will need:</strong> {flow.inputs}</p><p><strong>Doer:</strong> Enter actual data and evidence only in the permitted workflow.</p><p><strong>Monitor/checker:</strong> {flow.checker}</p><p><strong>Approver:</strong> {flow.approver}</p><p><strong>Overseer:</strong> {flow.overseer}</p>{flow.setup&&<p className="notice" data-tone="unknown">{flow.setup}</p>}{accessible?<button className="btn" onClick={()=>open(flow.tab!)}>Open authorized {flow.title} screen</button>:<p>No action is offered here. Ask the authorized owner to resolve setup or permissions; do not use another person's account.</p>}</div>}</article>})}
 </section>;
}
