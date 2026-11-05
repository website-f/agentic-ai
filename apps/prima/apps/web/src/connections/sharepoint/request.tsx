import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ConnectionsClient } from '../../api/connections';
import { SharePointSetupSession, setupMarker } from './request-state';
export function SharePointRequest({client,userId}:{client:ConnectionsClient;userId:string}) {
 const session=useMemo(()=>new SharePointSetupSession(client,userId,setupMarker(userId)),[client,userId]);
 const s=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
 useEffect(()=>{session.start();return()=>session.dispose();},[session]);
 return <section className="panel ix-conn" aria-label="Request a SharePoint connection">
 <div className="ix-conn-head"><h2>Have a SharePoint site or library link?</h2></div><div className="ix-conn-body">
 <p className="ix-meta">Paste it to start an IT setup request. This works before SharePoint is configured. It does not connect the site, read files or grant permissions.</p>
 <div className="ix-inline-form"><div className="field"><label className="label" htmlFor="sp-request-link">SharePoint site or library link</label><input id="sp-request-link" className="input" value={s.url} disabled={s.busy||s.uncertain||!!s.receipt} onChange={e=>session.edit(e.target.value)} autoComplete="off" inputMode="url" placeholder="https://your-tenant.sharepoint.com/sites/IT" /></div>
 <button className="btn" disabled={s.busy||s.uncertain||!!s.receipt||!s.url.trim()} onClick={()=>void session.preview()}>Check link format</button></div>
 {s.preview&&<div className="notice ix-stack" data-tone="info"><p>Requested {s.preview.kind}: <code className="ix-wrap">{s.preview.canonicalUrl}</code></p><p>This is a normalized request, not a verified site. IT must confirm the exact library, authorized people and company scope, then obtain any required Microsoft admin approval.</p><div className="ix-actions"><button className="btn btn-primary" disabled={s.busy||s.uncertain||!!s.receipt} onClick={()=>void session.submit()}>Submit setup request to IT</button></div></div>}
 {s.receipt&&<p role="status" className="notice" data-tone="info">IT reference <strong>{s.receipt.reference}</strong> — {s.receipt.status}. Ticket resolution alone does not prove Microsoft connectivity; use Check my access after IT configures the site.</p>}
 {!!s.requests.length&&<ul className="ix-rows ix-rows-boxed">{s.requests.map(r=><li key={r.id} className="ix-row">{r.reference}: {r.status} (IT workflow only)</li>)}</ul>}
 {s.uncertain&&s.pending&&<p>Request identity: <code>{s.pending}</code>. Preserve this when contacting IT.</p>}
 {s.busy&&<p role="status">Working on the setup request…</p>}{s.message&&<p role="status">{s.message}</p>}
 <p className="ix-meta">Use a direct /sites/ or /teams/ link. Sharing links and URLs containing tokens are refused. Only your pending request identity is retained locally for recovery, not the pasted URL. No new administrator notification or grant is added beyond the existing IT request workflow.</p>
 </div><div className="ix-conn-foot"><button className="btn btn-sm" disabled={s.busy} onClick={()=>void session.refresh()}>Check my requests</button>{s.receipt&&<button className="btn btn-sm" disabled={s.busy} onClick={()=>session.another()}>Start another request</button>}</div>
 </section>;
}
