import type { Adapter, ConfigurationView, Evidence, ResourceSelection, ServiceId } from './contract';
export interface CardState {
  configuration: ConfigurationView | null; selection: ResourceSelection | null; evidence: Evidence | null;
  phase: 'idle' | 'loadingConfiguration' | 'checkingAccess';
  failure: 'Unavailable' | 'InvalidResponse' | null; note: string | null; epoch: number; signal: AbortSignal;
}
const capabilitiesByService: Record<ServiceId, readonly string[]> = {
  sharepoint: ['checkAccess', 'readMetadata'],
  mail: ['checkAccess', 'readMetadata', 'composeSend'],
  powerbi: ['checkAccess', 'readMetadata', 'viewReport', 'embedReport'],
};
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
export class ConnectionCardSession {
  private controller = new AbortController();
  private listeners = new Set<() => void>();
  private active = true;
  private state: CardState = { configuration: null, selection: null, evidence: null, phase: 'idle', failure: null, note: null, epoch: 0, signal: this.controller.signal };
  constructor(readonly serviceId: ServiceId, readonly userId: string, private adapter?: Adapter) {
    if (adapter && adapter.serviceId !== serviceId) throw new Error('Invalid adapter.');
    if (!adapter) this.state.configuration = { serviceId, userId, configuration: 'NotConfigured', resources: [], capabilities: [], reason: 'ModuleAbsent' };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private patch(next: Partial<CardState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(fn => fn()); }
  private reset(next: Partial<CardState> = {}) {
    this.controller.abort(); this.controller = new AbortController();
    this.patch({ evidence: null, phase: 'idle', failure: null, note: null, epoch: this.state.epoch + 1, signal: this.controller.signal, ...next });
  }
  /** StrictMode effect restart creates a new generation, not a permanently disposed instance. */
  start() { this.active = true; return this.loadConfiguration(); }
  async loadConfiguration() {
    if (!this.active) return;
    this.reset({ configuration: null, selection: null });
    if (!this.adapter) {
      this.patch({ configuration: { serviceId: this.serviceId, userId: this.userId, configuration: 'NotConfigured', resources: [], capabilities: [], reason: 'ModuleAbsent' } }); return;
    }
    const epoch = this.state.epoch; const signal = this.state.signal;
    this.patch({ phase: 'loadingConfiguration' });
    try {
      const c = await this.adapter.getConfiguration(signal);
      if (!this.active || epoch !== this.state.epoch || signal.aborted) return;
      if (!c || typeof c !== 'object' || c.reason === 'ModuleAbsent' || c.serviceId !== this.serviceId || c.userId !== this.userId || !['NotConfigured', 'ConfiguredNotVerified'].includes(c.configuration)
        || !Array.isArray(c.resources) || c.resources.length > 50 || !Array.isArray(c.capabilities)
        || c.capabilities.some(x => !capabilitiesByService[this.serviceId].includes(x))
        || new Set(c.capabilities).size !== c.capabilities.length
        || (this.adapter.ProviderPanel && (!this.adapter.panelCapability || !capabilitiesByService[this.serviceId].filter(capability => capability !== 'checkAccess').includes(this.adapter.panelCapability)))
        || c.resources.some(r => !r || typeof r.resourceKey !== 'string' || !r.resourceKey || typeof r.label !== 'string')
        || new Set(c.resources.map(r => r.resourceKey)).size !== c.resources.length
        || (c.configuration === 'NotConfigured' && (c.resources.length || c.capabilities.length))) {
        this.reset({ configuration: null, selection: null, failure: 'InvalidResponse' }); return;
      }
      this.patch({ configuration: structuredClone(c), phase: 'idle' });
    } catch { if (this.active && epoch === this.state.epoch && !signal.aborted) this.reset({ configuration: null, selection: null, failure: 'Unavailable' }); }
  }
  select(resourceKey: string) {
    if (!this.active) return;
    const allowed = this.state.configuration?.configuration === 'ConfiguredNotVerified' && this.state.configuration.resources.some(r => r.resourceKey === resourceKey);
    this.reset({ selection: allowed ? { resourceKey } : null });
  }
  async checkAccess() {
    const selection = this.state.selection;
    if (!this.active || !this.adapter || this.state.phase !== 'idle' || !selection || !this.state.configuration?.capabilities.includes('checkAccess')) return;
    this.reset(); const epoch = this.state.epoch; const signal = this.state.signal;
    this.patch({ phase: 'checkingAccess' });
    try {
      const e = await this.adapter.checkAccess(selection, signal);
      if (!this.active || epoch !== this.state.epoch || signal.aborted) return;
      if (!e || typeof e !== 'object' || e.serviceId !== this.serviceId || e.userId !== this.userId || e.kind !== 'AccessVerified' || !timestamp(e.checkedAt)
        || e.selection?.resourceKey !== selection.resourceKey || e.selection.childKey !== selection.childKey) { this.reset({ failure: 'InvalidResponse' }); return; }
      this.patch({ evidence: structuredClone(e), phase: 'idle' });
    } catch { if (this.active && epoch === this.state.epoch && !signal.aborted) this.reset({ failure: 'Unavailable' }); }
  }
  cancel = () => { if (this.active) this.reset({ note: 'Cancelled locally. Any already-started request may have reached the provider; late results are discarded. Check access again. Cancellation does not undo a submitted action.' }); };
  invalidate = () => { if (this.active) this.reset(); };
  fail = () => { if (this.active) this.reset({ failure: 'Unavailable' }); };
  dispose() { this.active = false; this.reset({ configuration: null, selection: null }); this.controller.abort(); }
}
