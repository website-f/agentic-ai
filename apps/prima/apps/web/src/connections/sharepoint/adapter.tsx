import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ConnectionsClient, SharePointStatus } from '../../api/connections';
import type { Adapter, ProviderPanelProps } from '../contract';
import { ConnectionsSession, sharePointBrowserUrl } from '../../views/connections-state';

/** Config is local setup only. Check/list operations are never performed during render or mount. */
export function sharePointAdapter(client: ConnectionsClient): Adapter {
  let configuration: SharePointStatus | null = null;
  function Panel({ userId, selection, evidence, epoch, signal, cancel, fail }: ProviderPanelProps) {
    const session = useMemo(() => new ConnectionsSession(client, userId), [userId]);
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    useEffect(() => {
      if (signal.aborted || !configuration || !evidence) return;
      session.initializeScope(configuration, { serviceId: 'sharepoint', userId: evidence.userId, status: 'VerifiedForCurrentUser', siteKey: evidence.selection.resourceKey, checkedAt: evidence.checkedAt });
      const cancel = () => session.dispose(); signal.addEventListener('abort', cancel, { once: true });
      return () => { signal.removeEventListener('abort', cancel); session.dispose(); };
    }, [session, userId, selection.resourceKey, epoch, evidence, signal]);
    useEffect(() => { if (state.error) fail(); }, [state.error, fail]);
    const approved = configuration?.sites.find(s => s.key === selection.resourceKey)?.hasApprovedLibraries === true;
    if (!evidence) return null;
    if (!approved) return <p className="notice" data-tone="info">No approved libraries are configured for this site. A site access check does not approve libraries. Ask IT to review the exact library IDs; no library metadata is requested.</p>;
    return <div className="ix-block-gap">
      <p className="small muted">The check covers this site only. Each library request is separately authorized by the server. Only explicitly approved libraries are listed.</p>
      <button className="btn" disabled={!!state.busy || !state.verification} onClick={() => void session.listLibraries()}>List approved libraries</button>
      {state.busy && <><span role="status"> Requesting metadata… </span><button className="btn btn-sm" onClick={cancel}>Cancel request</button></>}
      {state.libraries.length > 0 && <div className="ix-block-gap">
        <label htmlFor="connection-library">Approved library</label>
        <select id="connection-library" className="select" style={{ display: 'block', width: '100%', maxWidth: 560 }} value={state.libraryId} onChange={e => session.selectLibrary(e.target.value)}>
          <option value="">Choose a library — no metadata requested by selecting</option>
          {state.libraries.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <p className="small muted">File names may be sensitive. Explicitly list at most 25 root entries; Prima does not read document bodies or transfer them to AI. A file link opens SharePoint in a new tab only when you click it; Microsoft rechecks your browser access. No imports or folder traversal.</p>
        <button className="btn" disabled={!!state.busy || !state.libraryId} onClick={() => void session.listMetadata()}>List metadata</button>
      </div>}
      {state.metadataCheckedAt && <p className="small muted">Metadata observed: <time dateTime={state.metadataCheckedAt}>{state.metadataCheckedAt}</time>. Not continuous monitoring.</p>}
      {state.items.length > 0 && <ul className="ix-list" aria-label="SharePoint root metadata">
        {state.items.map(i => <li key={i.id} className="ix-wrap"><strong>{i.name}</strong>{i.kind === 'file' && sharePointBrowserUrl(i.webUrl) && <> · <a href={sharePointBrowserUrl(i.webUrl)} target="_blank" rel="noopener noreferrer">Open in SharePoint (new tab)</a></>}<div className="small muted">{i.kind === 'folder' ? 'Folder (not opened)' : 'File (contents not read)'} · {i.size === null ? 'Size unknown' : `${i.size} bytes`} · Last modified: {i.lastModifiedAt ?? 'unknown'}</div></li>)}
      </ul>}
      {state.libraryHasMore && <p className="small">Approved library listing is bounded; no automatic pagination.</p>}
      {state.itemHasMore && <p className="small">Only the first 25 root entries are shown. No pagination or folder traversal.</p>}
      {state.libraryId && !state.items.length && !state.busy && <p className="small muted">No entries displayed. An empty display is not proof the library has no documents.</p>}
    </div>;
  }
  return {
    serviceId: 'sharepoint', panelCapability: 'readMetadata', ProviderPanel: Panel,
    async getConfiguration(signal) {
      configuration = null;
      const result = await client.sharePointStatus(signal);
      // The shell validates service/user. Never stamp a client identity onto server evidence.
      if (!Array.isArray(result.sites) || result.sites.some(s => typeof s.hasApprovedLibraries !== 'boolean')) throw new Error('Invalid configuration.');
      if (!signal.aborted) configuration = structuredClone(result);
      return { serviceId: result.serviceId, userId: result.userId, configuration: result.status,
        resources: result.sites.map(s => ({ resourceKey: s.key, label: s.name })),
        capabilities: result.status === 'ConfiguredNotVerified' ? ['checkAccess', 'readMetadata'] : [],
        reason: result.status === 'NotConfigured' ? 'ConfigurationMissing' : undefined };
    },
    async checkAccess(selection, signal) {
      const result = await client.sharePointCheck(selection.resourceKey, signal);
      if (result.status !== 'VerifiedForCurrentUser') throw new Error('Invalid access response.');
      return { serviceId: result.serviceId, userId: result.userId, selection: { resourceKey: result.siteKey }, checkedAt: result.checkedAt, kind: 'AccessVerified' };
    },
  };
}
