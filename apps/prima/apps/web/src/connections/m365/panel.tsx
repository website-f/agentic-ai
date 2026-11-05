import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ConnectionState, M365Client, M365Service, ServiceStatus } from './client';
import { M365Session, type Reauthenticate } from './state';

const TITLE: Record<M365Service, string> = { outlook: 'Outlook', teams: 'Teams', sharepoint: 'SharePoint' };
const STATE: Record<ConnectionState, { label: string; tone: 'ok' | 'warn' | 'crit' | 'unknown' }> = {
  not_configured: { label: 'Not configured', tone: 'unknown' },
  configured: { label: 'Configured, not checked', tone: 'warn' },
  consent_needed: { label: 'Consent needed', tone: 'warn' },
  connected: { label: 'Connected', tone: 'ok' },
  expired_or_revoked: { label: 'Expired or revoked', tone: 'crit' },
  unavailable: { label: 'Unavailable', tone: 'crit' },
};
/** Plain explanations for each reason. No provider error text is ever shown. */
const REASON: Record<string, string> = {
  FeatureDisabled: 'This connection is switched off on the server. Nothing is read from Microsoft.',
  ServerConfigurationRequired: 'IT still has to finish the server setup. You cannot fix this from here.',
  NoApprovedResources: 'No team or site is approved for you yet. Ask the IT desk.',
  RoleNotEligible: 'This connection is for office staff who sign in with Microsoft.',
  MicrosoftSignInRequired: 'Sign in to Prima with your linked work Microsoft account to use this.',
  NotChecked: 'Prima has not checked with Microsoft yet. Signing in to Prima does not prove access. Press Check.',
  CheckExpired: 'The last check is more than 8 hours old. Press Check to confirm again.',
  Disconnected: 'You disconnected. Press Check to connect again.',
  Verified: 'Microsoft confirmed your access at the time shown.',
  ConsentRequired: 'Microsoft needs permission for Prima to read this. An administrator may need to approve it. Ask the IT desk.',
  ConsentRevoked: 'This worked before, but the Microsoft permission has been removed. Ask the IT desk.',
  ReauthenticationRequired: 'Microsoft wants you to sign in again (for example for MFA). Press Reconnect.',
  SessionExpired: 'Your Microsoft session has expired. Press Reconnect.',
  AccessDenied: 'Microsoft refused this for your account. Ask the owner of the team, site or mailbox.',
  NotTeamMember: 'Microsoft does not list you as a member of this team. If you only belong to one shared channel, check that channel\'s link below instead. Ask the team owner to add you to the team.',
  RateLimited: 'Microsoft asked Prima to wait before trying again.',
  ProviderUnavailable: 'Microsoft did not answer clearly. Try again later.',
  UnexpectedScopes: 'Microsoft offered more access than Prima asks for, so Prima refused it. Tell the IT desk.',
};
const LINK: Record<string, string> = {
  Verified: 'Microsoft confirmed you can open this.',
  SiteVerifiedLibraryNotApproved: 'Microsoft confirmed the site, but this library is not approved for Prima. Only the site is confirmed. Ask the IT desk if Prima should use this library.',
  SiteVerifiedLibraryNotFound: 'Microsoft confirmed the site, but did not show this library to you. Only the site is confirmed. Check the address, or ask the site owner.',
  NotAMember: 'Microsoft says you are not a member of this channel. Private and shared channels need membership. Ask the team owner.',
  NotApprovedOrNoAccess: 'Microsoft did not let Prima open this site with your account. Either the site is not approved for Prima yet, or you do not have access. Use the setup request below.',
  WrongOrganization: 'This link is not from our organization. Prima does not open it.',
  WrongCompany: 'This belongs to a company you do not work with in Prima.',
  NotApproved: 'This is not approved for Prima yet. Use the setup request below, or ask the IT desk.',
  Failed: 'The link could not be checked.',
};
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '');

function Row({ s, session, busy, message, guidance, linkInput, link, selected }: {
  s: ServiceStatus; session: M365Session; busy?: string; message?: string; guidance: ReturnType<M365Session['snapshot']>['guidance'];
  linkInput?: string; link?: ReturnType<M365Session['snapshot']>['links']['teams']; selected?: string;
}) {
  const id = `m365-${s.service}`;
  const st = STATE[s.state];
  const g = guidance?.[s.service];
  const needsResource = s.service !== 'outlook';
  const resourceName = s.resourceKey ? s.resources.find(r => r.key === s.resourceKey)?.name : undefined;
  return <section className="panel" style={{ padding: 16, minWidth: 0 }} aria-labelledby={`${id}-title`}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <h3 id={`${id}-title`} style={{ margin: 0 }}>{TITLE[s.service]}</h3>
      <span className="chip" data-tone={st.tone} role="status" aria-label={`${TITLE[s.service]} status: ${st.label}`}>{st.label}</span>
    </div>
    <p>{REASON[s.reason] ?? 'Status unknown.'}</p>
    {s.state === 'connected' && <p className="small">Checked {resourceName ? `for ${resourceName} ` : ''}at <time dateTime={s.checkedAt}>{when(s.checkedAt)}</time>. Shown until <time dateTime={s.validUntil}>{when(s.validUntil)}</time>. This is a point-in-time check, not continuous monitoring.</p>}
    {s.state !== 'connected' && s.checkedAt && <p className="small muted">Last answer from Microsoft: <time dateTime={s.checkedAt}>{when(s.checkedAt)}</time>.</p>}
    {s.retryAfterSeconds && <p className="small">Try again in about {Math.ceil(s.retryAfterSeconds / 60)} minute(s).</p>}
    {needsResource && s.resources.length > 0 && <div>
      <label htmlFor={`${id}-resource`}>{s.service === 'teams' ? 'Approved team' : 'Approved site'}</label>
      <select id={`${id}-resource`} className="select" style={{ display: 'block', width: '100%', maxWidth: 480 }} value={selected ?? ''} disabled={!!busy} onChange={e => session.select(s.service as 'teams' | 'sharepoint', e.target.value)}>
        <option value="">Choose</option>
        {s.resources.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
      </select>
    </div>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {s.actions.includes('check') && <button className="btn btn-primary" disabled={!!busy || (needsResource && !selected)} onClick={() => void session.check(s.service)}>{s.state === 'connected' ? 'Check again' : 'Check'}</button>}
      {s.actions.includes('reconnect') && <button className="btn btn-primary" disabled={!!busy} onClick={() => void session.reconnect(s.service)}>Reconnect</button>}
      {s.actions.includes('disconnect') && <button className="btn" disabled={busy === 'disconnect'} onClick={() => void session.disconnect(s.service)}>Disconnect</button>}
    </div>
    {busy && <p role="status" className="small">{busy === 'check' ? 'Asking Microsoft…' : busy === 'link' ? 'Checking the link with Microsoft…' : busy === 'reconnect' ? 'Opening Microsoft sign-in…' : 'Disconnecting…'}</p>}
    {message && <p role="status" className="notice" data-tone="info">{message}</p>}
    {(s.service === 'teams' || s.service === 'sharepoint') && s.resources.length > 0 && s.state !== 'not_configured' && <div style={{ marginTop: 12 }}>
      <label htmlFor={`${id}-link`}>{s.service === 'teams' ? 'Check a Teams channel link' : 'Check a SharePoint site or library link'}</label>
      <input id={`${id}-link`} className="input" style={{ width: '100%', minWidth: 0 }} autoComplete="off" inputMode="url" value={linkInput ?? ''} disabled={!!busy}
        placeholder={s.service === 'teams' ? 'https://teams.microsoft.com/l/channel/…' : 'https://<tenant>.sharepoint.com/sites/…'}
        onChange={e => session.editLink(s.service as 'teams' | 'sharepoint', e.target.value)} />
      <button className="btn" style={{ marginTop: 8 }} disabled={!!busy || !linkInput?.trim()} onClick={() => void session.checkLink(s.service as 'teams' | 'sharepoint')}>Check link</button>
      {link && <div className="notice" data-tone={link.outcome === 'Verified' ? 'ok' : 'warn'} role="status" style={{ marginTop: 8 }}>
        <p>{LINK[link.outcome]}</p>
        {link.outcome === 'Verified' && <p className="small">Confirmed: {link.verifiedScope === 'channel' ? 'this channel only (not the whole team)' : link.verifiedScope === 'library' ? 'this approved library' : 'the site'}. A link check does not change the connection status above.</p>}
        {link.outcome === 'Failed' && link.reason && <p className="small">{REASON[link.reason] ?? ''}{link.retryAfterSeconds ? ` Try again in about ${Math.ceil(link.retryAfterSeconds / 60)} minute(s).` : ''}</p>}
        {link.membershipType && <p className="small">Channel type: {link.membershipType}.</p>}
        {link.openUrl && <a href={link.openUrl} target="_blank" rel="noopener noreferrer">Open in Teams (new tab)</a>}
        {link.canonicalUrl && link.outcome !== 'Verified' && <p className="small" style={{ overflowWrap: 'anywhere' }}>Link checked: <code>{link.canonicalUrl}</code></p>}
      </div>}
    </div>}
    {g && <details style={{ marginTop: 12 }}>
      <summary>Kenapa sambungan ini? / Why this connection?</summary>
      <dl className="small">
        <dt>Kenapa / Why</dt><dd>{g.why.bm}<br /><span className="muted">{g.why.en}</span></dd>
        <dt>Data digunakan / Data used</dt><dd>{g.data.bm}<br /><span className="muted">{g.data.en}</span></dd>
        <dt>Pautan / Where to get the link</dt><dd>{g.whereToGetLink.bm}<br /><span className="muted">{g.whereToGetLink.en}</span></dd>
        <dt>Siapa boleh bantu / Who can help</dt><dd>{g.whoHelps.bm}<br /><span className="muted">{g.whoHelps.en}</span></dd>
        <dt>Kebenaran Microsoft / Microsoft permission</dt><dd>{g.scopes.join(', ')} (delegated, read-only)</dd>
      </dl>
    </details>}
  </section>;
}

/** One Connections entry per person for Outlook, Teams and SharePoint. */
export function M365ConnectionsPanel({ userId, client, reauthenticate }: { userId: string; client: M365Client; reauthenticate?: Reauthenticate }) {
  const session = useMemo(() => new M365Session(userId, client, reauthenticate), [userId, client, reauthenticate]);
  const s = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  useEffect(() => { session.start(); return session.dispose; }, [session]);
  return <section aria-labelledby="m365-title" style={{ marginBottom: 16 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <h2 id="m365-title">Your Microsoft 365 connections</h2>
      <button className="btn btn-sm" disabled={s.phase === 'loading'} onClick={() => void session.load()}>Refresh status</button>
    </div>
    <p className="muted">Each connection uses your own Microsoft account and only reads. Connected means Microsoft answered a check for you; signing in to Prima alone does not count. Prima never shows or keeps your Microsoft tokens. Disconnect makes Prima forget its check; it does not remove Microsoft permission. Outlook only checks that your mailbox can be reached. Staff keep sending email in Outlook.</p>
    {s.phase === 'loading' && !s.status && <p role="status">Reading Prima status…</p>}
    {s.failure && <p role="alert" className="notice" data-tone="crit">Status unavailable. Nothing is shown as connected. Refresh, or ask the IT desk.</p>}
    {s.status && s.status.userId === userId && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
      {s.status.services.map(x => <Row key={x.service} s={x} session={session} busy={s.busy[x.service]} message={s.message[x.service]} guidance={s.guidance}
        selected={x.service === 'outlook' ? undefined : s.selected[x.service]} linkInput={x.service === 'outlook' ? undefined : s.linkInput[x.service]} link={x.service === 'outlook' ? undefined : s.links[x.service]} />)}
    </div>}
    {s.status && <p className="small muted" style={{ marginTop: 8 }}>Teams Approvals evidence is not built. A chat message saying "approved" is not evidence, and Prima approvals stay in Prima. The Power Automate Approvals connector is being evaluated.</p>}
  </section>;
}
