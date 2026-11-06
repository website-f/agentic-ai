import { MailConnectionCard } from '../connections/mail/connection-card';
import { jobEmailClient } from '../connections/mail/job-emails-client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api';
import { Chip } from '../ui';
import type { Adapter, ServiceId } from '../connections/contract';
import { createRegistry, serviceIds } from '../connections/registry';
import { ConnectionCardSession } from '../connections/session';
import { SharePointRequest } from '../connections/sharepoint/request';
import { sharePointAdapter } from '../connections/sharepoint/adapter';
import { m365Client } from '../connections/m365/client';
import { M365ConnectionsPanel } from '../connections/m365/panel';

const titles = { mail: 'Mail', sharepoint: 'SharePoint', powerbi: 'Power BI' };
export function ConnectionCard({ serviceId, userId, adapter }: { serviceId: ServiceId; userId: string; adapter?: Adapter }) {
  const session = useMemo(() => new ConnectionCardSession(serviceId, userId, adapter), [serviceId, userId, adapter]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { void session.start(); return () => session.dispose(); }, [session]);
  const configured = state.configuration?.configuration === 'ConfiguredNotVerified';
  const status = state.failure ? 'Status unavailable' : state.phase === 'loadingConfiguration' ? 'Reading setup status'
    : state.evidence ? 'Verified for you at the time shown' : state.configuration?.configuration === 'NotConfigured' ? 'Not configured'
    : configured ? 'Configured — check required' : 'Status not checked';
  const tone = state.failure ? 'crit' : state.evidence ? 'ok' : state.configuration?.configuration === 'NotConfigured' ? 'unknown' : 'warn';
  const Panel = adapter?.ProviderPanel;
  const panelCapability = adapter?.panelCapability;
  const showPanel = !!(Panel && panelCapability && configured && state.configuration?.capabilities.includes(panelCapability) && state.selection && state.evidence);
  return <section className="panel ix-conn" aria-labelledby={`connection-${serviceId}-title`}>
    <div className="ix-conn-head"><h2 id={`connection-${serviceId}-title`}>{titles[serviceId]}</h2><Chip tone={tone}>{status}</Chip></div>
    <div className="ix-conn-body">
    {state.configuration?.configuration === 'NotConfigured' && <p className="notice" data-tone="info">{titles[serviceId]} is not configured for this app. {state.configuration.reason === 'ModuleAbsent' ? 'This provider module has not been installed. No provider requests are available.' : 'Ask IT to approve the exact organization resources and authorized users, then configure server access.'}</p>}
    {state.failure && <p role="alert" className="notice" data-tone="crit">Access is unavailable or the response could not be verified. Check your Microsoft sign-in and approved access, then refresh. No prior verification or metadata is retained.</p>}
    {state.note && <p role="status" className="notice" data-tone="info">{state.note}</p>}
    {state.phase !== 'idle' && <div className="ix-actions"><p role="status" className="ix-meta">{state.phase === 'checkingAccess' ? 'Checking selected access…' : 'Reading Prima setup status only…'}</p><button className="btn btn-sm" onClick={session.cancel}>Cancel request</button></div>}
    {configured && <div className="ix-stack">
      {!state.configuration?.resources.length ? <p>No approved resources are available to this account. Ask IT to check the current resource allowlist.</p> : <>
        <div className="field"><label className="label" htmlFor={`connection-${serviceId}-resource`}>Approved {serviceId === 'sharepoint' ? 'site' : 'resource'}</label>
        <select id={`connection-${serviceId}-resource`} className="select" value={state.selection?.resourceKey ?? ''} onChange={e => session.select(e.target.value)}>
          <option value="">Choose — selection does not request metadata</option>
          {state.configuration.resources.map(r => <option key={r.resourceKey} value={r.resourceKey}>{r.label}</option>)}
        </select></div>
        <div className="ix-actions"><button className="btn btn-primary" disabled={!state.selection || state.phase !== 'idle' || !state.configuration.capabilities.includes('checkAccess')} onClick={() => void session.checkAccess()}>Check my access</button></div>
      </>}
    </div>}
    {state.evidence && <p className="ix-meta">Verified for this account and selected resource at <time dateTime={state.evidence.checkedAt}>{state.evidence.checkedAt}</time>. Access can change; this is not continuous monitoring or organization-wide connection.</p>}
    {showPanel && panelCapability === 'composeSend' && <p className="notice" data-tone="warn">Manual email action: review recipients and message, then explicitly choose Send. Checking access does not send anything. Cancellation cannot recall a submitted message. Arisha does not send autonomously.</p>}
    {showPanel && (panelCapability === 'viewReport' || panelCapability === 'embedReport') && <p className="notice" data-tone="info">Report access: opening or embedding a report requires an explicit action and current provider authorization. A report may contain sensitive organizational data. No automatic opening or AI transfer.</p>}
    {showPanel && Panel && state.selection && state.evidence && <Panel key={`${userId}:${state.epoch}`} userId={userId} selection={state.selection} evidence={state.evidence} epoch={state.epoch} signal={state.signal} cancel={session.cancel} fail={session.fail} />}
    {serviceId === 'mail' && <p className="ix-meta">{!adapter ? 'Staff keep sending in Outlook. Open an IT job to attach one selected Outlook email; mailbox setup and explicit preview are required.' : 'Manual staff email requires review and an explicit Send action in a separately authorized module.'} Autonomous replies remain Grok’s responsibility.</p>}
    {serviceId === 'powerbi' && <p className="ix-meta">{!adapter ? 'Deferred to the last phase; not a Phase 1 pilot blocker. No reports, datasets or paid connections are activated.' : 'Report viewing and embedding require their own approved provider access and explicit action.'}</p>}
    </div>
    {adapter && <div className="ix-conn-foot"><button className="btn btn-sm" disabled={state.phase !== 'idle'} onClick={() => void session.loadConfiguration()}>Refresh setup status</button></div>}
  </section>;
}
/** SharePoint metadata adapter plus existing selected-message Outlook capability; never register Mail.Send. */
export function ConnectionsView({ userId }: { userId: string }) {
  const registry = useMemo(() => createRegistry([sharePointAdapter(api)]), [userId]);
  const selectedMail = useMemo(()=>jobEmailClient((method,path,body,signal)=>api.m365Call(userId,method,path,body,signal)),[userId]);
  const m365 = useMemo(()=>m365Client((method,path,body,signal)=>api.m365Call(userId,method,path,body,signal)),[userId]);
  // Server app only: sign in to Microsoft again (with any claims challenge). The demo has no Microsoft sign-in.
  const reauthenticate = useMemo(()=>{const r=(api as { m365Reauthenticate?: (claims?: string) => Promise<void> }).m365Reauthenticate;return r?(claims?: string)=>r.call(api,claims):undefined;},[]);
  return <div className="page ix-page" data-no-translate>
    <header className="k-head"><div className="k-head-text"><h1>Connections</h1><p className="k-head-sub">Use your existing Microsoft sign-in to check approved access. These controls do not register accounts, grant consent or connect the whole organization.</p></div></header>
    <p className="notice" data-tone="info">Opening this page reads Prima setup status only. Provider reads require explicit actions. Names may be sensitive: no document body, download, import, email reply or AI transfer. Never paste passwords, tokens or client secrets here.</p>
    <M365ConnectionsPanel key={`${userId}:m365`} userId={userId} client={m365} reauthenticate={reauthenticate} />
    <section className="ix-section" aria-labelledby="connections-details-title">
    <div className="ix-section-head"><h2 id="connections-details-title">Details and setup requests</h2><p className="ix-meta">Selected Outlook email on IT jobs, SharePoint metadata and Power BI, each checked separately.</p></div>
    <div className="ix-conn-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
      {serviceIds.map(serviceId => serviceId==='mail'?<MailConnectionCard key={`${userId}:mail`} userId={userId} client={selectedMail}/>:<ConnectionCard key={`${userId}:${serviceId}`} serviceId={serviceId} userId={userId} adapter={registry.get(serviceId)} />)}
    </div>
    <SharePointRequest key={userId} client={api} userId={userId} />
    </section>
  </div>;
}
