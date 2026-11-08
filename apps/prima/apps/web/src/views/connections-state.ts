import { type ConnectionsClient, type SharePointCheck, type SharePointItems, type SharePointLibraries, type SharePointStatus } from '../api/connections';


type Busy = 'configuration' | 'check' | 'libraries' | 'items';
export interface ConnectionsState {
  configuration: SharePointStatus | null;
  siteKey: string;
  libraryId: string;
  verification: SharePointCheck | null;
  libraries: SharePointLibraries['libraries'];
  items: SharePointItems['items'];
  libraryHasMore: boolean;
  itemHasMore: boolean;
  metadataCheckedAt: string | null;
  busy: Busy | null;
  error: string | null;
  note: string | null;
}
/** Defense in depth: only direct SharePoint HTTPS display links, never downloads/redirect handlers. */
export function sharePointBrowserUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const u = new URL(value); const path = decodeURIComponent(u.pathname);
    if (u.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.com$/.test(u.hostname) || u.username || u.password || u.port || u.search || u.hash || path.length < 2 || /[\\\u0000-\u001f\u007f]/.test(path) || /(?:^|\/)(?:_layouts|_api|_vti_bin)(?:\/|$)/i.test(path)) return;
    return u.href;
  } catch { return; }
}

const validTimestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const emptyMetadata = () => ({ verification: null, libraries: [], items: [], libraryId: '', libraryHasMore: false, itemHasMore: false, metadataCheckedAt: null });

/** Per-user, in-memory point-in-time checks. Never persists a 'connected' claim or auto-reads a provider. */
export class ConnectionsSession {
  private state: ConnectionsState = { configuration: null, siteKey: '', ...emptyMetadata(), busy: null, error: null, note: null };
  private generation = 0;
  private active = true;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private client: ConnectionsClient, readonly userId: string) {}
  getSnapshot = (): ConnectionsState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private patch(next: Partial<ConnectionsState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }
  private invalidate() { this.generation++; this.controller?.abort(); this.controller = null; }
  private hasSite() { return this.state.configuration?.status === 'ConfiguredNotVerified' && this.state.configuration.sites.some((s) => s.key === this.state.siteKey); }
  private verified() { return this.hasSite() && this.state.verification?.siteKey === this.state.siteKey; }
  private async run<T>(kind: Busy, task: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void) {
    if (!this.active || this.state.busy) return;
    const generation = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.patch({ busy: kind, error: null, note: null });
    try {
      const result = await task(controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      accept(result);
      this.patch({ busy: null });
    } catch {
      if (generation !== this.generation || controller.signal.aborted) return;
      // A failed request never leaves a previous green badge or stale metadata visible.
      this.patch({ ...emptyMetadata(), busy: null, error: 'Access was not verified. Check your approved site and Microsoft sign-in, then try again. No document content was retrieved.' });
    } finally { if (generation === this.generation) this.controller = null; }
  }
  async loadConfiguration() {
    if (!this.active) return;
    this.invalidate();
    this.patch({ configuration: null, siteKey: '', ...emptyMetadata(), busy: null, error: null, note: null });
    await this.run('configuration', (signal) => this.client.sharePointStatus(signal), (configuration) => {
      if (configuration.serviceId !== 'sharepoint' || configuration.userId !== this.userId || !['NotConfigured', 'ConfiguredNotVerified'].includes(configuration.status) || !Array.isArray(configuration.sites) || configuration.sites.length > 50 || configuration.sites.some(s => !s || typeof s.key !== 'string' || !s.key || typeof s.name !== 'string' || typeof s.hasApprovedLibraries !== 'boolean')) throw new Error('Invalid configuration response.');
      this.patch({ configuration: structuredClone(configuration) });
    });
  }
  initializeScope(configuration: SharePointStatus, verification: SharePointCheck) {
    this.active = true; this.invalidate();
    if (configuration.serviceId !== 'sharepoint' || configuration.userId !== this.userId || verification.serviceId !== 'sharepoint'
      || verification.userId !== this.userId || verification.status !== 'VerifiedForCurrentUser' || !validTimestamp(verification.checkedAt)
      || configuration.status !== 'ConfiguredNotVerified' || !configuration.sites.some(s => s.key === verification.siteKey)) {
      this.patch({ configuration: null, siteKey: '', ...emptyMetadata(), busy: null, error: 'Access scope is unavailable.', note: null }); return;
    }
    this.patch({ configuration: structuredClone(configuration), siteKey: verification.siteKey, ...emptyMetadata(), verification: structuredClone(verification), busy: null, error: null, note: null });
  }
  selectSite(siteKey: string) {
    this.invalidate();
    const allowed = !siteKey || this.state.configuration?.sites.some((site) => site.key === siteKey);
    this.patch({ siteKey: allowed ? siteKey : '', ...emptyMetadata(), busy: null, error: allowed ? null : 'Choose a site from the approved list.', note: null });
  }
  async checkAccess() {
    if (this.state.busy || !this.hasSite()) return;
    const siteKey = this.state.siteKey;
    this.patch(emptyMetadata());
    await this.run('check', (signal) => this.client.sharePointCheck(siteKey, signal), (verification) => {
      if (verification.serviceId !== 'sharepoint' || verification.userId !== this.userId || verification.status !== 'VerifiedForCurrentUser' || verification.siteKey !== siteKey || !validTimestamp(verification.checkedAt)) throw new Error('Mismatched check.');
      this.patch({ verification: structuredClone(verification), note: 'Access verified for this user and selected site at the time shown. Nothing was connected globally or imported.' });
    });
  }
  async listLibraries() {
    if (!this.active || this.state.busy || !this.verified() || !this.state.configuration?.sites.find(s => s.key === this.state.siteKey)?.hasApprovedLibraries) return;
    const siteKey = this.state.siteKey;
    this.patch({ libraries: [], items: [], libraryId: '', libraryHasMore: false, itemHasMore: false, metadataCheckedAt: null });
    await this.run('libraries', (signal) => this.client.sharePointLibraries(siteKey, signal), (result) => {
      if (result.serviceId !== 'sharepoint' || result.userId !== this.userId || result.siteKey !== siteKey || !validTimestamp(result.checkedAt) || !Array.isArray(result.libraries) || result.libraries.length > 50 || typeof result.hasMore !== 'boolean' || result.libraries.some(l => !l || typeof l.id !== 'string' || !l.id || typeof l.name !== 'string')) throw new Error('Mismatched libraries.');
      this.patch({ libraries: structuredClone(result.libraries), libraryHasMore: result.hasMore, metadataCheckedAt: result.checkedAt });
    });
  }
  selectLibrary(libraryId: string) {
    this.invalidate();
    const allowed = !libraryId || (this.verified() && this.state.libraries.some((library) => library.id === libraryId));
    this.patch({ ...(!allowed ? emptyMetadata() : {}), libraryId: allowed ? libraryId : '', items: [], itemHasMore: false, metadataCheckedAt: null, busy: null, error: allowed ? null : 'Choose a library from the current site list.', note: null });
  }
  async listMetadata() {
    if (!this.active || this.state.busy || !this.verified() || !this.state.configuration?.sites.find(s => s.key === this.state.siteKey)?.hasApprovedLibraries || !this.state.libraries.some((library) => library.id === this.state.libraryId)) return;
    const siteKey = this.state.siteKey; const libraryId = this.state.libraryId;
    this.patch({ items: [], itemHasMore: false, metadataCheckedAt: null });
    await this.run('items', (signal) => this.client.sharePointItems(siteKey, libraryId, signal), (result) => {
      if (result.serviceId !== 'sharepoint' || result.userId !== this.userId || result.siteKey !== siteKey || result.driveId !== libraryId || !validTimestamp(result.checkedAt) || !Array.isArray(result.items) || typeof result.hasMore !== 'boolean' || result.items.some(i => !i || typeof i.id !== 'string' || !i.id || typeof i.name !== 'string' || !['file', 'folder'].includes(i.kind) || !(i.size === null || (typeof i.size === 'number' && Number.isFinite(i.size) && i.size >= 0)) || !(i.lastModifiedAt === null || validTimestamp(i.lastModifiedAt)))) throw new Error('Mismatched metadata.');
      this.patch({ items: structuredClone(result.items.slice(0, 25).map(item => { const { webUrl, ...metadata } = item; const safe = item.kind === 'file' ? sharePointBrowserUrl(webUrl) : undefined; return { ...metadata, ...(safe ? { webUrl: safe } : {}) }; })), itemHasMore: result.hasMore || result.items.length > 25, metadataCheckedAt: result.checkedAt });
    });
  }
  cancel() {
    const setupOnly = this.state.busy === 'configuration';
    this.invalidate();
    this.patch({ ...emptyMetadata(), busy: null, error: null, note: setupOnly ? 'Setup-status read cancelled. No Microsoft metadata was requested.' : 'Cancelled locally. Any already-started metadata request may have reached Microsoft; late results are discarded. Check access again before listing.' });
  }
  dispose() { this.active = false; this.invalidate(); this.state = { configuration: null, siteKey: '', ...emptyMetadata(), busy: null, error: null, note: null }; }
}
