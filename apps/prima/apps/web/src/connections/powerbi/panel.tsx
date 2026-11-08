import { useEffect, useState } from 'react';
import type { Adapter, ProviderPanelProps } from '../contract';
import { powerBiAdapterCore, type PowerBiClient, type PowerBiView } from './adapter';

/**
 * Explicit "Prepare report" only; nothing is requested on mount. This is NOT in-app embedding: that needs the
 * powerbi-client package and the browser's own MSAL token for Report.Read.All (owner's registration step). Until
 * then the panel only offers the clearly labelled link that opens the Power BI service.
 */
function makePowerBiPanel(client: PowerBiClient) {
  return function PowerBiPanel({ userId, selection, evidence, signal, cancel, fail }: ProviderPanelProps) {
    const [view, setView] = useState<PowerBiView | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { const clear = () => { setView(null); setBusy(false); }; signal.addEventListener('abort', clear, { once: true }); return () => signal.removeEventListener('abort', clear); }, [signal]);
    if (!evidence || evidence.userId !== userId || evidence.selection.resourceKey !== selection.resourceKey) return null;
    async function prepare() {
      setBusy(true);
      try { const v = await client.embed(userId, selection.resourceKey, signal); if (!signal.aborted) setView(v); }
      catch { if (!signal.aborted) fail(); }
      finally { if (!signal.aborted) setBusy(false); }
    }
    return <div style={{ marginTop: 12 }}>
      <p className="small muted">Reports open under your own Microsoft account, so Power BI's own permissions and row-level security decide what you see. Prima never publishes reports to the web.</p>
      <button className="btn" disabled={busy} onClick={() => void prepare()}>Prepare this report</button>
      {busy && <> <span role="status">Checking this report for you… </span><button className="btn btn-sm" onClick={cancel}>Cancel request</button></>}
      <p className="notice" data-tone="info">Limitation: the report is not shown inside Prima yet. This opens it in the Power BI service in a new tab, signed in as you.</p>
      {view && <p className="small">
        Checked for you at <time dateTime={view.checkedAt}>{view.checkedAt}</time>.{' '}
        <a href={view.openInService.url} target="_blank" rel="noopener noreferrer">{view.openInService.label}</a>
      </p>}
    </div>;
  }
}

export function powerBiAdapter(client: PowerBiClient): Adapter {
  return { ...powerBiAdapterCore(client), ProviderPanel: makePowerBiPanel(client) };
}
