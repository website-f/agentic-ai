/** Pure, synthetic-only offline prototype. No storage, fetch, service worker or production API wiring. */
export type Owner = { tenantId: string; userId: string };
export type WorkPayload =
  | { kind: 'helpRequest'; fields: { title: string; category: 'ACCOUNT' | 'DEVICE' | 'M365' | 'NETWORK' | 'PRIMA' | 'OTHER'; priority: 'P1' | 'P2' | 'P3'; detail: string } }
  | { kind: 'jobNote'; targetId: string; baseVersion: number; fields: { note: string } };
export type Operation = {
  id: string; owner: Owner; schemaVersion: 1; payload: WorkPayload; attempt: number;
  state: 'queued' | 'sending' | 'uncertain' | 'conflict' | 'blocked' | 'synced';
  receiptId?: string; reason?: string;
};
export const OFFLINE_ACCESS_MS = 72 * 60 * 60 * 1000;
export type OfflineLease = { owner: Owner; verifiedAt: number; expiresAt: number };
/** Decision predicate only; a secure key/lease adapter must enforce access, not merely hide UI. */
export function offlineAccessAllowed(lease: OfflineLease | null, owner: Owner, now: number): boolean {
  return !!lease && sameOwner(lease.owner, owner) && Number.isFinite(now) && Number.isFinite(lease.verifiedAt) && Number.isFinite(lease.expiresAt) && lease.expiresAt > lease.verifiedAt && lease.expiresAt <= lease.verifiedAt + OFFLINE_ACCESS_MS && now >= lease.verifiedAt && now < lease.expiresAt;
}
export type Session = { owner: Owner; expiresAt: number; generation: number };
export type Outbox = {
  operations: Operation[]; session: Session | null; accessLease: OfflineLease | null;
  appOpen: boolean; online: boolean; enabled: boolean;
};
export type Outcome =
  | { kind: 'receipt'; operationId: string; owner: Owner; receiptId: string }
  | { kind: 'conflict'; operationId: string; owner: Owner }
  | { kind: 'refused'; operationId: string; owner: Owner }
  | { kind: 'unknown'; operationId: string; owner: Owner }
  | { kind: 'not-found'; operationId: string; owner: Owner };
export type Command = { kind: 'send' | 'reconcile'; operationId: string; owner: Owner; sessionGeneration: number; attempt: number };
export const PROTOTYPE_MAX_OPERATIONS = 50;
export const emptyOutbox = (): Outbox => ({ operations: [], session: null, accessLease: null, appOpen: false, online: false, enabled: false });
export const sameOwner = (a: Owner, b: Owner) => a.tenantId === b.tenantId && a.userId === b.userId;
const exactKeys = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).sort().join('|') === [...keys].sort().join('|');
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const bounded = (x: unknown, length: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= length;
const ownerValid = (x: Owner) => bounded(x.tenantId, 120) && bounded(x.userId, 120);
/** Narrow structural allowlist. It does NOT detect all sensitive prose; real-data storage requires a separate reviewed policy. */
export function permittedPayload(x: unknown): x is WorkPayload {
  if (!record(x) || !record(x.fields)) return false;
  const strings = Object.values(x.fields);
  // Obvious credential/secret input is refused even in a fixture. This is defense in depth, not DLP certification.
  if (strings.some(s => typeof s !== 'string' || /(?:password|passwd|secret|api[ _-]?key|bearer\s|private[ _-]?key|BEGIN.*PRIVATE KEY)/i.test(s))) return false;
  if (x.kind === 'helpRequest') return exactKeys(x, ['kind', 'fields']) && exactKeys(x.fields, ['title', 'category', 'priority', 'detail']) && bounded(x.fields.title, 120) && bounded(x.fields.detail, 1000) && ['ACCOUNT', 'DEVICE', 'M365', 'NETWORK', 'PRIMA', 'OTHER'].includes(String(x.fields.category)) && ['P1', 'P2', 'P3'].includes(String(x.fields.priority));
  if (x.kind === 'jobNote') return exactKeys(x, ['kind', 'targetId', 'baseVersion', 'fields']) && bounded(x.targetId, 120) && Number.isInteger(x.baseVersion) && Number(x.baseVersion) >= 0 && exactKeys(x.fields, ['note']) && bounded(x.fields.note, 500);
  return false;
}
/** Explicit local submit creates an immutable operation; ID is generated once, never per network attempt. */
export function enqueue(s: Outbox, owner: Owner, id: string, payload: unknown, now: number): Outbox {
  if (!ownerValid(owner) || !bounded(id, 120) || !permittedPayload(payload)) throw Error('Unsupported offline work');
  if (!s.session || !sameOwner(s.session.owner, owner)) throw Error('Different account');
  if (!offlineAccessAllowed(s.accessLease, owner, now)) throw Error('Offline access ended. Preserve queued work; sign in to unlock.');
  const old = s.operations.find(o => o.id === id && sameOwner(o.owner, owner));
  if (old) {
    if (JSON.stringify(old.payload) !== JSON.stringify(payload)) throw Error('Operation ID cannot be reused for changed content');
    return s;
  }
  if (s.operations.length >= PROTOTYPE_MAX_OPERATIONS) throw Error('Prototype queue full; preserve existing work and review online');
  return { ...s, operations: [...s.operations, { id, owner: { ...owner }, schemaVersion: 1, payload: structuredClone(payload), attempt: 0, state: 'queued' }] };
}
export function visibleOperations(s: Outbox, now: number): Operation[] {
  return s.session && offlineAccessAllowed(s.accessLease, s.session.owner, now) ? structuredClone(s.operations.filter(o => sameOwner(o.owner, s.session!.owner))) : [];
}
/** Foreground autosync eligibility only. A device's online flag is not proof the service is reachable. */
export function nextCommand(s: Outbox, now: number): Command | null {
  if (!Number.isFinite(now) || !s.enabled || !s.appOpen || !s.online || !s.session || !Number.isFinite(s.session.expiresAt) || !Number.isInteger(s.session.generation) || s.session.generation < 1 || s.session.expiresAt <= now) return null;
  const owned = s.operations.filter(o => sameOwner(o.owner, s.session!.owner));
  if (owned.some(o => o.state === 'sending')) return null;
  const op = owned.find(o => o.state === 'uncertain') ?? (offlineAccessAllowed(s.accessLease, s.session.owner, now) ? owned.find(o => o.state === 'queued') : undefined);
  return op ? { kind: op.state === 'uncertain' ? 'reconcile' : 'send', operationId: op.id, owner: { ...op.owner }, sessionGeneration: s.session.generation, attempt: op.attempt + 1 } : null;
}
/** Atomic claim must be durable before I/O in a future storage adapter; without that adapter this is test-only. */
export function claim(s: Outbox, cmd: Command, now: number): Outbox {
  const next = nextCommand(s, now);
  if (!next || JSON.stringify(next) !== JSON.stringify(cmd)) return s;
  return { ...s, operations: s.operations.map(o => o.id === cmd.operationId && sameOwner(o.owner, cmd.owner) ? { ...o, state: 'sending', attempt: cmd.attempt, reason: undefined } : o) };
}
export function settle(s: Outbox, cmd: Command, result: Outcome): Outbox {
  if (result.operationId !== cmd.operationId || !sameOwner(result.owner, cmd.owner)) return s;
  // Late responses from an ended session never unlock another account's queue.
  if (!s.session || s.session.generation !== cmd.sessionGeneration || !sameOwner(s.session.owner, cmd.owner)) return s;
  return { ...s, operations: s.operations.map(o => {
    if (o.id !== cmd.operationId || !sameOwner(o.owner, cmd.owner) || o.state !== 'sending' || o.attempt !== cmd.attempt) return o;
    if (result.kind === 'receipt' && bounded(result.receiptId, 120)) return { ...o, state: 'synced', receiptId: result.receiptId, reason: undefined };
    if (result.kind === 'conflict') return { ...o, state: 'conflict', reason: 'Server record changed. Review online; no automatic overwrite.' };
    if (result.kind === 'refused') return { ...o, state: 'blocked', reason: 'Permission or validation refused. Review online.' };
    if (result.kind === 'not-found' && cmd.kind === 'reconcile') return { ...o, state: 'queued', reason: 'Server confirmed this operation absent. Same operation ID will be used.' };
    return { ...o, state: 'uncertain', reason: 'Outcome unknown. Reconcile this operation before another send.' };
  }) };
}
/** Use on sign-out, interruption or hydration: in-flight never means safe to retry. */
export function interrupted(s: Outbox): Outbox {
  return { ...s, operations: s.operations.map(o => o.state === 'sending' ? { ...o, state: 'uncertain', reason: 'Interrupted; server receipt must be checked.' } : o) };
}
export function sessionChanged(s: Outbox, session: Session | null): Outbox {
  return { ...interrupted(s), session: session ? structuredClone(session) : null };
}
/** Cancel only an operation that has provably never been claimed. Uncertain work needs server reconciliation. */
export function discardQueued(s: Outbox, id: string, now: number): Outbox {
  if (!s.session || !offlineAccessAllowed(s.accessLease, s.session.owner, now)) return s;
  return { ...s, operations: s.operations.filter(o => !(o.id === id && sameOwner(o.owner, s.session!.owner) && o.state === 'queued' && !o.reason)) };
}
