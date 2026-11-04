import { useEffect, useMemo, useRef, useState } from 'react';
import { mailboxSetupMarker, requestMailboxSetup } from './setup-request';
import { validOutlookMessageLink, previewStillCurrent } from './job-emails-client';
import type { EmailSnapshot, JobEmailClient, JobEmailPreview, JobEmailView } from './job-emails-client';

/**
 * "Outlook emails on this job" panel, for the job screen's owner to mount. Staff keep sending in Outlook; here they
 * paste the link of ONE email from their own Outlook, check the preview, and attach it. Prima reads nothing else
 * from the mailbox. Opening the panel reads only Prima's own stored copies, never Microsoft.
 */
const inputError = (e: unknown) => {
  const status = (e as { status?: unknown })?.status;
  return status === 400 || status === 403 || status === 409 ? String((e as Error).message || 'That was refused.') : null;
};
const who = (a: { name: string; address: string }) => a.name ? `${a.name} <${a.address}>` : a.address;

function Email({ s }: { s: EmailSnapshot }) {
  return <div style={{ minWidth: 0 }}>
    <p className="small" style={{ overflowWrap: 'anywhere', margin: 0 }}>
      <strong>{s.subject || '(no subject)'}</strong><br />
      {s.from && <>From: {who(s.from)}<br /></>}
      {s.to.length > 0 && <>To: {s.to.map(who).join(', ')}<br /></>}
      {s.cc.length > 0 && <>Cc: {s.cc.map(who).join(', ')}<br /></>}
      {s.sentAt && <>Sent: <time dateTime={s.sentAt}>{s.sentAt}</time></>}
    </p>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{s.body}</pre>
    {s.bodyTruncated && <p className="small muted">The message is long; only the first part was copied. Open it in Outlook for the rest.</p>}
    {s.hasAttachments && <p className="small muted">This email has files in Outlook. Prima does not copy them.</p>}
  </div>;
}

export function JobEmails({ client, userId, jobId }: { client: JobEmailClient; userId: string; jobId: string }) {
  const [state, setState] = useState<{ configured: boolean; keepDays: number } | null>(null);
  const [emails, setEmails] = useState<JobEmailView[] | null>(null);
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<{ link: string; data: JobEmailPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain,setUncertain]=useState(false);
  const [setupRef,setSetupRef]=useState('');
  const setupMarker=useMemo(()=>mailboxSetupMarker(userId),[userId]);
  const [setupPending,setSetupPending]=useState(false);
  const pending=useRef<{kind:'attach'|'remove';id:string}|null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController(); const gen = ++generation.current;
    try{setSetupPending(!!setupMarker.get());}catch{setError('Setup recovery storage unavailable.');}
    setState(null); setEmails(null); setPreview(null); setLink(''); setError(''); setBusy(true); inFlight.current = true;
    (async () => {
      try {
        const s = await client.status(userId, controller.signal);
        if (gen !== generation.current) return;
        setState(s);
        if (s.configured) { const list = await client.list(userId, jobId, controller.signal); if (gen === generation.current) setEmails(list); }
      } catch (e) { if (gen === generation.current && !controller.signal.aborted) setError(inputError(e) ?? 'Attached emails could not be loaded. Refresh to try again.'); }
      finally { if(gen===generation.current){setBusy(false);inFlight.current=false;} }
    })();
    return () => { controller.abort(); generation.current++; };
  }, [client, userId, jobId]);

  async function run<T>(fn: () => Promise<T>, apply: (v: T) => void, write=false) {
    if (inFlight.current) return;
    const gen = generation.current;
    inFlight.current = true; setBusy(true); setError('');
    try { const v = await fn(); if (gen === generation.current) apply(v); }
    catch (e) { if (gen === generation.current) {setError(write?'The server outcome is unknown. Refresh saved copies before another change; do not assume nothing was saved.':(inputError(e) ?? 'The read could not be verified. Try again after checking your session.'));if(write)setUncertain(true);} }
    finally { if (gen === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const replace = (v: JobEmailView) => setEmails(list => [v, ...(list ?? []).filter(x => x.id !== v.id)]);

  if (!state) return <section aria-label="Outlook emails on this job"><p role="status">{error||'Reading mailbox setup status…'}</p><button className="btn" disabled={busy} onClick={()=>void run(async()=>{const next=await client.status(userId);const list=next.configured?await client.list(userId,jobId):[];return {next,list};},({next,list})=>{setState(next);setEmails(list);})}>Retry setup status</button></section>;

  return <section aria-label="Outlook emails on this job" className="panel" style={{ padding: 12, minWidth: 0 }}>
    <h3>Outlook emails on this job</h3>
    <p className="small muted">Keep sending from Outlook. To add an email here, open it in Outlook on the web, copy its link and paste it below. Prima reads only that email, from your own mailbox, and keeps a copy for {state.keepDays} days; after expiry the copy is unavailable here. Storage cleanup must also be configured by IT.</p>
    {!state.configured && <div className="notice" data-tone="info"><p>Mailbox setup is not ready. Paste an email link below to check its format locally, then request IT setup. The setup request contains no email link, message ID, subject or body.</p><label htmlFor={`job-email-setup-${jobId}`}>Outlook email link</label><input id={`job-email-setup-${jobId}`} className="input" style={{width:'100%',minWidth:0}} value={link} onChange={e=>setLink(e.target.value)} autoComplete="off" /><button className="btn" disabled={busy||!!setupRef||(!setupPending&&!validOutlookMessageLink(link.trim()))} onClick={()=>void run(async()=>{try{return await requestMailboxSetup(client,userId,setupMarker);}catch{throw Object.assign(new Error('IT setup request outcome is unknown. Check the same request again; the original identity is retained.'),{status:409});}finally{try{setSetupPending(!!setupMarker.get());}catch{setSetupPending(true);}}},r=>{setSetupRef(r.ticketRef);setLink('');})}>{setupPending?'Check the same IT setup request':'Request Outlook setup from IT'}</button>{setupRef&&<p role="status">IT reference {setupRef}. This is a request, not mailbox access. IT must approve the capability and configure Microsoft access.</p>}<p className="small muted">A valid format does not prove the message exists or belongs to this mailbox. Microsoft access is checked only after setup and explicit Preview.</p></div>}
    {state.configured&&setupPending&&<button className="btn" disabled={busy} onClick={()=>void run(()=>requestMailboxSetup(client,userId,setupMarker),r=>{setSetupRef(r.ticketRef);setSetupPending(false);})}>Check pending IT setup request</button>}
    <button className="btn" disabled={busy} onClick={()=>void run(async()=>{const next=await client.status(userId);const list=next.configured?await client.list(userId,jobId):[];return {next,list};},({next,list})=>{setState(next);setEmails(list);const p=pending.current;if(p&&list.some(x=>p.kind==='attach'?x.webLink===p.id&&x.state==='Available':x.id===p.id&&x.state==='Removed')){pending.current=null;setUncertain(false);setPreview(null);setLink('');}else if(uncertain)setError('No confirming saved result is visible yet. Keep this screen and ask IT to reconcile; do not submit a new copy.');})}>Refresh setup and saved copies</button>
    {emails?.length === 0 && <p className="small">No emails attached yet.</p>}
    {emails && emails.length > 0 && <ul style={{ listStyle: 'none', padding: 0 }}>
      {emails.map(e => <li key={e.id} className="panel" style={{ padding: 8, marginBottom: 8, minWidth: 0 }}>
        {e.state === 'Available' && e.snapshot ? <Email s={e.snapshot} /> : <p className="small">{e.state === 'Removed' ? 'Removed from this job by the person who attached it.' : `The copy is unavailable after ${state.keepDays} days; storage cleanup is separate.`}</p>}
        <p className="small muted" style={{ overflowWrap: 'anywhere' }}>Attached by {e.attachedByName} on <time dateTime={e.attachedAt}>{e.attachedAt}</time>.{' '}
          {e.state !== 'Removed' && <a href={e.webLink} target="_blank" rel="noopener noreferrer">Open in Outlook</a>}</p>
        {e.canRemove && <button className="btn btn-sm" disabled={busy||uncertain} onClick={() => {if(uncertain||inFlight.current)return;pending.current={kind:'remove',id:e.id};void run(() => client.remove(userId, jobId, e.id),v=>{replace(v);pending.current=null;},true);}}>Remove from this job</button>}
      </li>)}
    </ul>}
    {state.configured && !preview && <form onSubmit={ev => { ev.preventDefault(); if(uncertain||inFlight.current)return; const l = link.trim(); if(!validOutlookMessageLink(l)) {setError('Paste a supported link to one Outlook message.');return;} void run(() => client.preview(userId, jobId, l), data => setPreview({ link: l, data })); }}>
      <label htmlFor={`job-email-link-${jobId}`}>Link to the email in Outlook</label>
      <input id={`job-email-link-${jobId}`} className="input" value={link} onChange={ev => setLink(ev.target.value)} autoComplete="off" inputMode="url" placeholder="https://outlook.office.com/mail/…" />
      <button className="btn" type="submit" disabled={busy || uncertain || !validOutlookMessageLink(link.trim())}>Preview this email</button>
    </form>}
    {preview && <div className="panel" style={{ padding: 8, minWidth: 0 }} aria-label="Preview before attaching" role="region">
      <p className="small"><strong>Check this is the right email.</strong> Nothing is saved until you press Attach. Preview expires at {preview.data.expiresAt}; refresh the preview if expired.</p>
      <Email s={preview.data.snapshot} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy||uncertain||!previewStillCurrent(preview.data.expiresAt)} onClick={() => {if(uncertain||inFlight.current)return;if(!previewStillCurrent(preview.data.expiresAt)){setPreview(null);setError('Preview expired. Preview the email again before attaching.');return;}pending.current={kind:'attach',id:preview.data.snapshot.webLink};void run(() => client.attach(userId, jobId, preview.link, preview.data.previewToken), v => { replace(v);pending.current=null; setPreview(null); setLink(''); },true);}}>Attach to this job</button>
        <button className="btn" disabled={busy||uncertain} onClick={() => { setPreview(null); setError(''); }}>Cancel</button>
      </div>
    </div>}
    {busy && <p role="status" className="small">Working…</p>}
    {error && <p role="alert" className="notice" data-tone="crit">{error}</p>}
  </section>;
}
