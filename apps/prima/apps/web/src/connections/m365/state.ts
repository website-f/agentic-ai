import type { Guidance, LinkResult, M365Client, M365Service, M365Status, ServiceStatus } from './client';

type Busy = 'check' | 'disconnect' | 'link' | 'reconnect';
export interface M365State {
  owner: string;
  phase: 'idle' | 'loading';
  status: M365Status | null;
  failure: boolean;
  busy: Partial<Record<M365Service, Busy>>;
  selected: { teams: string; sharepoint: string };
  linkInput: { teams: string; sharepoint: string };
  links: { teams?: LinkResult; sharepoint?: LinkResult };
  message: Partial<Record<M365Service, string>>;
  guidance: Record<M365Service, Guidance> | null;
}
/** Starts a Microsoft sign-in again (with a claims challenge when Microsoft sent one). Leaves the page. */
export type Reauthenticate = (claims?: string) => Promise<void>;

const empty = (owner: string): M365State => ({ owner, phase: 'idle', status: null, failure: false, busy: {}, selected: { teams: '', sharepoint: '' }, linkInput: { teams: '', sharepoint: '' }, links: {}, message: {}, guidance: null });

/**
 * Per-person screen state. Opening the page reads Prima's stored status only; Microsoft is asked only when the person
 * presses Check, Reconnect or Check link. A late answer after Disconnect, a newer action or a user change is dropped.
 */
export class M365Session {
  private state: M365State;
  private listeners = new Set<() => void>();
  private generation: Record<M365Service | 'all', number> = { all: 0, outlook: 0, teams: 0, sharepoint: 0 };
  private controller: AbortController | null = null;
  private active = true;
  constructor(readonly owner: string, private client: M365Client, private reauthenticate?: Reauthenticate) { this.state = empty(owner); }

  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(p: Partial<M365State>) { if (!this.active) return; this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); }
  private setService(s: ServiceStatus) {
    if (!this.state.status) return;
    this.patch({ status: { ...this.state.status, services: this.state.status.services.map(x => (x.service === s.service ? s : x)) } });
  }
  private busy(service: M365Service, value: Busy | null) {
    const busy = { ...this.state.busy };
    if (value) busy[service] = value; else delete busy[service];
    this.patch({ busy });
  }
  private say(service: M365Service, text: string | null) {
    const message = { ...this.state.message };
    if (text) message[service] = text; else delete message[service];
    this.patch({ message });
  }
  service(service: M365Service) { return this.state.status?.services.find(s => s.service === service) ?? null; }

  start = () => { this.active = true; void this.load(); };
  dispose = () => { this.active = false; this.controller?.abort(); for (const k of Object.keys(this.generation) as (keyof typeof this.generation)[]) this.generation[k]++; };

  async load() {
    if (!this.active) return;
    const g = ++this.generation.all;
    this.controller?.abort();
    const c = (this.controller = new AbortController());
    this.patch({ phase: 'loading', failure: false });
    try {
      if (!this.state.guidance) void this.client.guidance(c.signal).then(guidance => { if (this.active) this.patch({ guidance }); }, () => {});
      const status = await this.client.status(this.owner, c.signal);
      if (g !== this.generation.all || !this.active) return;
      const selected = { ...this.state.selected };
      for (const s of ['teams', 'sharepoint'] as const) {
        const resources = status.services.find(x => x.service === s)!.resources;
        if (!resources.some(r => r.key === selected[s])) selected[s] = resources.length === 1 ? resources[0].key : '';
      }
      this.patch({ phase: 'idle', status, selected });
    } catch {
      if (g === this.generation.all && this.active) this.patch({ phase: 'idle', status: null, failure: true });
    }
  }

  select(service: 'teams' | 'sharepoint', key: string) {
    const ok = !key || !!this.service(service)?.resources.some(r => r.key === key);
    this.patch({ selected: { ...this.state.selected, [service]: ok ? key : '' } });
  }

  private async run(service: M365Service, kind: Busy, task: () => Promise<void>) {
    if (!this.active || this.state.busy[service] || !this.state.status) return;
    this.busy(service, kind);
    this.say(service, null);
    try { await task(); }
    catch { this.say(service, 'Prima could not confirm the result. Nothing was marked connected. Refresh and try again, or ask the IT desk.'); }
    finally { this.busy(service, null); }
  }

  check(service: M365Service) {
    const resourceKey = service === 'outlook' ? undefined : this.state.selected[service];
    if (service !== 'outlook' && !resourceKey) { this.say(service, 'Choose an approved team or site first.'); return Promise.resolve(); }
    return this.run(service, 'check', async () => {
      const g = this.generation[service];
      const s = await this.client.check(this.owner, service, resourceKey);
      if (g === this.generation[service] && this.active) this.setService(s);
    });
  }

  disconnect(service: M365Service) {
    if (!this.active || !this.state.status) return Promise.resolve();
    // A running check for this service, and any status read started before now, can no longer change the screen.
    this.generation[service]++;
    this.generation.all++;
    this.controller?.abort();
    if (this.state.phase === 'loading') this.patch({ phase: 'idle' });
    const busy = { ...this.state.busy }; delete busy[service]; this.patch({ busy });
    return this.run(service, 'disconnect', async () => {
      const s = await this.client.disconnect(this.owner, service);
      this.generation[service]++;
      this.generation.all++;
      this.setService(s);
      const links = { ...this.state.links }; if (service !== 'outlook') delete links[service];
      this.patch({ links });
      this.say(service, 'Prima has forgotten its check for you. This does not remove the Microsoft permission (consent) itself; to remove that, ask the IT desk. Prima never held your Microsoft password or tokens.');
    });
  }

  /** Expired, revoked or challenged: sign in to Microsoft again, then press Check. */
  reconnect(service: M365Service) {
    const s = this.service(service);
    if (!s || !this.active) return Promise.resolve();
    if (!this.reauthenticate) { this.say(service, 'Sign out of Prima and sign in again with your Microsoft account, then press Check.'); return Promise.resolve(); }
    return this.run(service, 'reconnect', async () => { await this.reauthenticate!(s.claims); });
  }

  editLink(service: 'teams' | 'sharepoint', url: string) {
    const links = { ...this.state.links }; delete links[service];
    this.patch({ linkInput: { ...this.state.linkInput, [service]: url }, links });
  }

  checkLink(service: 'teams' | 'sharepoint') {
    const url = this.state.linkInput[service].trim();
    if (!url) return Promise.resolve();
    return this.run(service, 'link', async () => {
      const g = this.generation[service];
      try {
        const r = await this.client.link(this.owner, service, url);
        if (g !== this.generation[service] || !this.active || this.state.linkInput[service].trim() !== url) return;
        this.setService(r.status);
        this.patch({ links: { ...this.state.links, [service]: r } });
      } catch (e) {
        if ((e as { status?: number }).status === 400) { this.say(service, service === 'teams' ? 'That is not a Teams channel link. In Teams use ... then "Get link to channel".' : 'Use the site or library address from the browser, not a "Share" link.'); return; }
        throw e;
      }
    });
  }
}
