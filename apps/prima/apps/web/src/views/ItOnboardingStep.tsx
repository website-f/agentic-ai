import{useState}from'react';
import type{ItOnboarding}from'@prima/core';
export function ItOnboardingStep({step,canTick,busy,onSave}:{step:ItOnboarding['steps'][number];canTick:boolean;busy:boolean;onSave:(done:boolean,evidence:string,version:number)=>void}){
 const[evidence,setEvidence]=useState('');const[admitted,setAdmitted]=useState(()=>step.version??0);const version=step.version??0;const stale=version!==admitted;
 return <div className="card small"><strong>{step.label}</strong><p>Use a work reference or short evidence comment, never passwords, tokens or recovery codes. Recording is not proof of external account closure.</p><p>{step.doneAt?'Staff-reported completion — not independently checked':'Not recorded'}{step.by?` · ${step.by}`:''}{step.doneAt?` · ${step.doneAt}`:''}</p>
 {step.doneAt&&<p>Evidence: {step.evidenceRef||'Missing legacy evidence — review needed'}</p>}
 {stale&&<><p role="alert">This step changed. Discard the old draft and review the current recorded evidence before another action.</p><button className="btn" disabled={busy} onClick={()=>{setEvidence('');setAdmitted(version)}}>Discard draft and review current step</button></>}
 {canTick&&<form onSubmit={e=>{e.preventDefault();if(!busy&&!stale&&evidence.trim().length>=3&&evidence.trim().length<=500)onSave(!step.doneAt,evidence.trim(),admitted)}}><label className="field">{step.doneAt?'Reopening reason':'Evidence reference / work comment'}<input value={evidence} minLength={3} maxLength={500} required disabled={busy||stale} onChange={e=>setEvidence(e.target.value)}/></label><button className="btn" disabled={busy||stale||evidence.trim().length<3}>{step.doneAt?'Reopen recorded step':'Record step with evidence'}</button></form>}
 </div>;
}
