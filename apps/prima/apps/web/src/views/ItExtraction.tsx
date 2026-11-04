import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { ExtractionPreview } from '../api/it-extraction';
import { ExtractionSession } from './it-extraction-state';
export function ItExtractionView({userId,onReview,reviewDisabled=false}:{userId:string;reviewDisabled?:boolean;onReview?:(preview:ExtractionPreview,edits:Record<string,string>)=>void}) {
 const session=useMemo(()=>new ExtractionSession(api,userId),[userId]);
 const s=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
 useEffect(()=>{session.activate();void session.load();return()=>session.dispose();},[session]);
 const ready=s.status?.enabled&&s.status.configured&&s.status.permitted&&s.status.sourceTypes.includes('paste')&&s.status.dataClasses.includes(s.dataClass);
 return <div className="page" data-no-translate>
  <h1>AI data preview</h1>
  <p className="notice" data-tone="info">Preview only. No operational records are imported, saved or approved here. Selected text is sent to Azure only after your explicit consent. Batch import remains unavailable until its separate review is complete.</p>
  <p>Paste selected IT work text. Existing structured CSV/Excel tables should use the reviewed deterministic import workflow instead. Files, mailbox reading and SharePoint content extraction are not included.</p>
  <button className="btn" disabled={s.busy} onClick={()=>void session.load()}>Refresh setup status</button>
  {!ready&&<p role="status">AI extraction is disabled, unavailable or not approved for this account/data type. Nothing is sent merely by opening this page.</p>}
  {s.error&&<p role="alert">{s.error}</p>}
  <label style={{display:'block'}}>Work type<select className="select" value={s.kind} onChange={e=>session.change({kind:e.target.value as 'tickets'|'jobs'})}><option value="tickets">Open help requests</option><option value="jobs">Open IT jobs</option></select></label>
  <label style={{display:'block'}}>Source label<input className="input" maxLength={120} value={s.label} onChange={e=>session.change({label:e.target.value})}/></label>
  <label style={{display:'block'}}>Data permission<select className="select" value={s.dataClass} onChange={e=>session.change({dataClass:e.target.value as 'synthetic'|'approved-it-work'})}><option value="synthetic">Synthetic example only</option>{s.status?.dataClasses.includes('approved-it-work')&&<option value="approved-it-work">Separately approved IT work content</option>}</select></label>
  <p className="small">Selecting “synthetic” does not make real information safe. Do not paste passwords, tokens, personal identification, bank/payroll, medical or whistleblowing details.</p>
  <label htmlFor="extract-source">Selected source text</label><textarea id="extract-source" className="input" rows={10} style={{width:'100%'}} value={s.text} onChange={e=>session.change({text:e.target.value})}/>
  <p>{[...s.text].length}/8000 characters. Editing the source clears previous preview and consent.</p>
  <label style={{display:'block'}}><input type="checkbox" checked={s.consent} disabled={!ready||s.busy} onChange={e=>session.consent(e.target.checked)}/> I approve sending exactly this selected text to Azure OpenAI Global for this one preview. Processing may occur outside Southeast Asia and incur usage charges. No monthly hard cap is implied.</label>
  <div className="row" style={{gap:8,flexWrap:'wrap',marginTop:12}}><button className="btn btn-primary" disabled={!ready||!s.consent||s.busy||!s.text.trim()||[...s.text].length>8000} onClick={()=>void session.extract()}>Generate AI preview</button><button className="btn" onClick={()=>session.cancel()}>Clear preview / cancel</button></div>
  {s.busy&&<p role="status">Working… Cancellation cannot undo an AI request already received or its charges.</p>}
  {s.preview&&<section aria-label="Extracted proposal">
   <h2>Review proposed fields</h2><p>Nothing saved. Quotes show where a value came from, not whether it is true. Edits below are local and unvalidated; no approval or import button is available.</p>
   <p className="small" style={{overflowWrap:'anywhere'}}>Source fingerprint: {s.preview.source.sha256}</p>
   {s.preview.rows.length===0&&<p>No supported rows extracted. This is not proof that the source contains no work.</p>}
   {s.preview.rows.map(row=><fieldset key={row.row} style={{minWidth:0,marginBottom:16}}><legend>Proposal {row.row}</legend>
    {row.errors.length>0&&<p role="alert">Needs correction: {row.errors.join(', ')}</p>}
    {Object.entries(row.fields).map(([field,evidence])=>{const key=`${row.row}:${field}`;const edited=Object.hasOwn(s.edits,key);return <div key={field} style={{marginBottom:12}}>
     <label style={{display:'block'}}>{field}<textarea className="input" rows={field==='detail'?3:1} style={{width:'100%'}} value={edited?s.edits[key]:evidence.raw??''} onChange={e=>session.edit(row.row,field,e.target.value)}/></label>
     <p className="small" style={{overflowWrap:'anywhere'}}>{evidence.raw===null?'No supporting source found; do not guess.':<>Original evidence [{evidence.start}–{evidence.end}]: <q>{evidence.raw}</q></>}{edited?' Edited locally — evidence has not been updated or revalidated.':''}</p>
    </div>;})}
    <p className="small">{row.warnings.join(', ')}</p>
   </fieldset>)}
   {onReview&&<button className="btn" disabled={reviewDisabled||s.busy||s.preview.rows.length===0||s.preview.rows.length>20} onClick={()=>onReview(s.preview!,s.edits)}>Review with Arisha — local only</button>}
  </section>}
 </div>;
}
