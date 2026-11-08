import type { Adapter, ConfigurationView, Evidence, ResourceSelection } from '../contract';

/**
 * Mail adapter: the signed-in user's own mailbox, send only. Compose and review in Prima, then the person presses
 * Send. No inbox reading, no automatic replies, no AI sending. Runtime-import free so offline tests can load it.
 */
export type ConnectionsTransport = (method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;
export type DraftState = 'Draft' | 'Sending' | 'Accepted' | 'Failed' | 'Uncertain' | 'Discarded';
export interface DraftContent { to: string[]; cc: string[]; subject: string; body: string }
export interface DraftView extends DraftContent {
  userId: string; id: string; state: DraftState; contentHash: string; updatedAt: string;
  retryNotBefore: string | null; identityMatches: boolean;
}

/** The reviewed action this panel performs: manual compose, review and explicit Send. Never readMetadata. */
export const COMPOSE_SEND = 'composeSend' as const;

const STATES: readonly DraftState[] = ['Draft', 'Sending', 'Accepted', 'Failed', 'Uncertain', 'Discarded'];
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 10 && v.every(x => typeof x === 'string');
const invalid = (): never => { throw new Error('Invalid Mail response.'); };

/** Keeps only the fields the screen shows. A draft for anyone but the signed-in user is an invalid response. */
export function draftView(v: unknown, userId: string): DraftView {
  if (!obj(v) || v.serviceId !== 'mail' || v.userId !== userId || typeof v.id !== 'string' || !STATES.includes(v.state as DraftState) ||
      typeof v.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(v.contentHash) || !strings(v.to) || !strings(v.cc) ||
      typeof v.subject !== 'string' || typeof v.body !== 'string' || typeof v.updatedAt !== 'string' ||
      typeof v.identityMatches !== 'boolean' || !(v.retryNotBefore === null || typeof v.retryNotBefore === 'string')) return invalid();
  return { userId, id: v.id, state: v.state as DraftState, contentHash: v.contentHash, to: [...v.to], cc: [...v.cc], subject: v.subject, body: v.body,
    updatedAt: v.updatedAt, retryNotBefore: v.retryNotBefore as string | null, identityMatches: v.identityMatches };
}

export function mailClient(call: ConnectionsTransport) {
  const id = (draftId: string) => `/connections/mail/drafts/${encodeURIComponent(draftId)}`;
  return {
    status: (signal?: AbortSignal) => call('GET', '/connections/mail', undefined, signal),
    check: (key: string, signal?: AbortSignal) => call('POST', `/connections/mail/${encodeURIComponent(key)}/check`, {}, signal),
    create: async (userId: string, c: DraftContent, signal?: AbortSignal) => draftView(await call('POST', '/connections/mail/drafts', c, signal), userId),
    get: async (userId: string, draftId: string, signal?: AbortSignal) => draftView(await call('GET', id(draftId), undefined, signal), userId),
    async list(userId: string, signal?: AbortSignal): Promise<DraftView[]> {
      const r = await call('GET', '/connections/mail/drafts', undefined, signal);
      if (!obj(r) || r.serviceId !== 'mail' || r.userId !== userId || !Array.isArray(r.drafts) || r.drafts.length > 20) return invalid();
      return r.drafts.map(d => draftView(d, userId));
    },
    edit: async (userId: string, draftId: string, c: DraftContent, signal?: AbortSignal) => draftView(await call('POST', `${id(draftId)}/edit`, c, signal), userId),
    discard: async (userId: string, draftId: string, signal?: AbortSignal) => draftView(await call('POST', `${id(draftId)}/discard`, {}, signal), userId),
    /** Never retried by the client: a repeated press is answered by the server's recorded state. */
    async send(userId: string, draftId: string, reviewedHash: string, signal?: AbortSignal) {
      const r = await call('POST', `${id(draftId)}/send`, { reviewedHash }, signal);
      if (!obj(r) || typeof r.alreadyHandled !== 'boolean') return invalid();
      return { draft: draftView(r.draft, userId), alreadyHandled: r.alreadyHandled };
    },
    resolve: async (userId: string, draftId: string, sentItems: 'found' | 'not-found', signal?: AbortSignal) => draftView(await call('POST', `${id(draftId)}/resolve`, { sentItems }, signal), userId),
  };
}
export type MailClient = ReturnType<typeof mailClient>;

/** Configuration and access check only. The shell validates service, user and resource against the session. */
export function mailAdapterCore(client: MailClient): Omit<Adapter, 'ProviderPanel'> {
  return {
    serviceId: 'mail', panelCapability: COMPOSE_SEND,
    async getConfiguration(signal): Promise<ConfigurationView> {
      const r = await client.status(signal);
      if (!obj(r) || r.serviceId !== 'mail' || typeof r.userId !== 'string' || !['NotConfigured', 'ConfiguredNotVerified'].includes(r.status as string) || !Array.isArray(r.resources) ||
          r.resources.some(x => !obj(x) || typeof x.key !== 'string' || typeof x.name !== 'string')) return invalid();
      const configured = r.status === 'ConfiguredNotVerified';
      const resources = r.resources as { key: string; name: string }[];
      return {
        serviceId: 'mail', userId: r.userId, configuration: r.status as ConfigurationView['configuration'],
        resources: configured ? resources.map(x => ({ resourceKey: x.key, label: x.name })) : [],
        capabilities: configured && resources.length ? ['checkAccess', COMPOSE_SEND] : [],
        reason: !configured ? 'ConfigurationMissing' : resources.length ? undefined : 'NoApprovedResources',
      };
    },
    async checkAccess(selection: ResourceSelection, signal): Promise<Evidence> {
      const r = await client.check(selection.resourceKey, signal);
      if (!obj(r) || r.serviceId !== 'mail' || r.status !== 'VerifiedForCurrentUser' || r.proves !== 'DelegatedTokenOnly' || typeof r.userId !== 'string' ||
          typeof r.resourceKey !== 'string' || typeof r.checkedAt !== 'string') return invalid();
      return { serviceId: 'mail', userId: r.userId, selection: { resourceKey: r.resourceKey }, checkedAt: r.checkedAt, kind: 'AccessVerified' };
    },
  };
}

/** Splits a typed address line; the server does the real validation. */
export function addressList(line: string): string[] {
  return line.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
}
