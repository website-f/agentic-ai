/**
 * The site device's encrypted outbox (Fauzan, 6 Nov 2026): "We use memory of the device to store data until there is
 * internet. Make sure all data is encrypted."
 *
 * When the signal drops, post log lines, gate entries and gate exits are kept on the device and sent when the internet
 * comes back. Everything kept is encrypted with AES-256-GCM using a key made on this device that the browser will not
 * let any script read out (non-exportable). The full IC number, IC picture and written book pages are sealed for the
 * in-house server before they reach this outbox, so they are locked twice.
 *
 * Each entry carries its own device reference and the time it was written. The server saves a resend once, keeps the
 * device time with its own receive time, and marks entries that arrived late. An entry the server refuses (for example
 * a wrong PIN) stays on the device, shown to the guard and supervisor, and is never dropped silently.
 *
 * Limits: the app must be opened with a signal at the start of the shift (sign-in and the site's lists need the
 * server); after that the signal may drop. Not yet tested on a real phone in airplane mode.
 */
import { fromMs } from '@prima/core';
import { api, ApiError, type DoSiteTaskInput, type GateInInput, type PostLogInput } from '../api';

import { assertDutyLease, bindDutyContext, contextGeneration, contextKey, dutyLease, OfflineContextError, type DutyLease } from './context';

type Job =
  | { kind: 'post'; body: PostLogInput }
  | { kind: 'gateIn'; body: GateInInput }
  | { kind: 'gateOut'; id: string; body: { staffNo: string; pin: string; recordedAt: string } }
  | { kind: 'task'; id: string; title: string; body: DoSiteTaskInput };

interface Row {
  clientRef: string;
  kind: Job['kind'];
  /** A short line for the screen, kept encrypted with the rest. */
  createdAt: string;
  iv: Uint8Array;
  data: ArrayBuffer;
  tries: number;
  status: 'waiting' | 'refused';
  error: string | null;
}

export interface OutboxItem {
  clientRef: string;
  kind: Job['kind'];
  label: string;
  createdAt: string;
  status: Row['status'];
  error: string | null;
  tries: number;
  /** For a gate entry waiting to send: the id it will have, so the guard can still record the exit. */
  gateId: string | null;
}

// Never open or migrate the old unbound database automatically. Preserve it for supervised recovery.
const DB = 'prima-duty-device-v2-';
const OUT = 'outbox';
const META = 'meta';
const CHANGED = 'prima-duty-outbox';

let testOffline = false;
/** Test version only: behave as if the site has no internet. */
export function setTestOffline(on: boolean) {
  testOffline = on;
  window.dispatchEvent(new Event(CHANGED));
}
export const isTestOffline = () => testOffline;
export const OUTBOX_CHANGED = CHANGED;

function open(lease: DutyLease): Promise<IDBDatabase> {
  assertDutyLease(lease);
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB + encodeURIComponent(contextKey(lease.context)), 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(OUT)) db.createObjectStore(OUT, { keyPath: 'clientRef' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('This device cannot keep entries offline.'));
  });
}

async function tx<T>(lease: DutyLease, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(lease);
  try {
    return await new Promise<T>((resolve, reject) => {
      assertDutyLease(lease);
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Not saved on the device.'));
    });
  } finally {
    db.close();
  }
}

/** Generate outside the transaction, then elect exactly one winner inside a serialized read/write transaction.
 * Never await WebCrypto in an IDB transaction, and never replace an existing key. Works across tabs. */
async function deviceKey(lease: DutyLease, create: boolean): Promise<CryptoKey> {
  const have = await tx<CryptoKey | undefined>(lease, META, 'readonly', (s) => s.get('key'));
  if (have) return have;
  if (!create) throw new OfflineContextError('Encryption key unavailable. Retain this browser profile for recovery.');
  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const db = await open(lease);
  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      assertDutyLease(lease);
      const t = db.transaction(META, 'readwrite');
      const store = t.objectStore(META);
      const get = store.get('key');
      let chosen: CryptoKey;
      get.onsuccess = () => {
        chosen = get.result ?? candidate;
        if (!get.result) store.add(candidate, 'key');
      };
      t.oncomplete = () => resolve(chosen);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Encryption key was not saved.'));
    });
  } finally { db.close(); }
}
function aad(lease: DutyLease, purpose: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['prima-duty-v2', contextKey(lease.context), purpose]));
}
async function lock(lease: DutyLease, purpose: string, value: unknown): Promise<{ iv: Uint8Array; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(lease, purpose) }, await deviceKey(lease, true), new TextEncoder().encode(JSON.stringify(value)));
  assertDutyLease(lease);
  return { iv, data };
}
async function unlock<T>(lease: DutyLease, purpose: string, iv: Uint8Array, data: ArrayBuffer): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(lease, purpose) }, await deviceKey(lease, false), data);
  assertDutyLease(lease);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
const rowPurpose = (r: Pick<Row, 'clientRef' | 'kind' | 'createdAt'>) => JSON.stringify(['outbox', r.clientRef, r.kind, r.createdAt]);

/** A new device reference: the server saves an entry with the same reference only once. */
export const newClientRef = () => `dev-${crypto.randomUUID()}`;
export const deviceNow = () => fromMs(Date.now());

/** A network problem (no signal, server unreachable or busy) is worth retrying; a refusal is not. */
function isNetwork(e: unknown): boolean {
  if (e instanceof OfflineContextError) return false;
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 502;
}

function label(job: Job): string {
  if (job.kind === 'post') return `Post log: ${job.body.text.slice(0, 60)}`;
  if (job.kind === 'gateOut') return 'Gate exit';
  if (job.kind === 'task') return `Task ${job.body.result === 'done' ? 'done' : 'not done'}: ${job.title.slice(0, 60)}`;
  const b = job.body;
  if (b.kind === 'paper_log') return `Written book page for ${b.paper?.coversDate ?? ''}`;
  return `Gate in: ${b.visitor?.name ?? b.vehicle?.plate ?? ''}${b.visitor && b.vehicle ? ` · ${b.vehicle.plate}` : ''}`;
}

async function send(job: Job, lease?: DutyLease): Promise<unknown> {
  if (lease) {
    assertDutyLease(lease);
    // Preflight detects server-side reassignment/re-enrollment. The mutation independently rechecks the context.
    const live = await api.dutyDevice();
    assertDutyLease(lease);
    if (!live.offlineContext || contextKey(live.offlineContext) !== contextKey(lease.context)) {
      bindDutyContext(null, lease.generation);
      throw new OfflineContextError('Device enrollment changed. Pending records retained; ask a supervisor for recovery.');
    }
  }
  if (testOffline || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new TypeError('offline');
  const body = { ...job.body, ...(lease ? { offlineContext: lease.context } : {}) };
  if (job.kind === 'post') return api.addPostLog(body as PostLogInput);
  if (job.kind === 'gateIn') return api.gateIn(body as GateInInput);
  if (job.kind === 'task') return api.doSiteTask(job.id, body as DoSiteTaskInput);
  return api.gateOut(job.id, body);
}

async function keep(lease: DutyLease, job: Job, clientRef: string): Promise<void> {
  const canLeave = job.kind === 'gateIn' && job.body.kind !== 'paper_log';
  const metadata = { clientRef, kind: job.kind, createdAt: deviceNow() };
  const { iv, data } = await lock(lease, rowPurpose(metadata), { job, label: label(job), canLeave });
  const row: Row = { ...metadata, iv, data, tries: 0, status: 'waiting', error: null };
  await tx(lease, OUT, 'readwrite', (s) => s.add(row));
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Sends an entry now, or keeps it on the device if there is no signal. The entry's device reference and time are set
 * here, so a later resend is the same entry.
 */
export async function submit<T>(job: Job): Promise<{ sent: true; result: T } | { sent: false; clientRef: string }> {
  // Snapshot before any await: a failed send must never be queued under a later account.
  let lease: DutyLease | undefined;
  try { lease = dutyLease(); } catch { /* online-only, no enrolled offline context */ }
  job = structuredClone(job);
  const clientRef =
    job.kind === 'gateOut' ? `${job.id}-out` : job.kind === 'task' ? `${job.id}-${deviceNow().slice(0, 10)}` : ((job.body as { clientRef?: string }).clientRef ??= newClientRef());
  if (job.kind !== 'gateOut') (job.body as { recordedAt?: string | null }).recordedAt ??= deviceNow();
  try {
    return { sent: true, result: (await send(job, lease)) as T };
  } catch (e) {
    if (!isNetwork(e)) throw e;
    if (!lease) throw new OfflineContextError('Offline recording is disabled until this device is enrolled. This entry was not saved.');
    assertDutyLease(lease);
    await keep(lease, job, clientRef);
    return { sent: false, clientRef };
  }
}

export async function outbox(siteId: string | null): Promise<OutboxItem[]> {
  let lease: DutyLease;
  try { lease = dutyLease(); } catch { return []; }
  if (siteId && siteId !== lease.context.siteId) throw new OfflineContextError('Wrong site for this outbox.');
  const rows = await tx<Row[]>(lease, OUT, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>);
  const items: OutboxItem[] = [];
  for (const r of rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    try {
      const { label: l, canLeave } = await unlock<{ label: string; canLeave?: boolean }>(lease, rowPurpose(r), r.iv, r.data);
      items.push({ clientRef: r.clientRef, kind: r.kind, label: l, createdAt: r.createdAt, status: r.status, error: r.error, tries: r.tries, gateId: canLeave ? `gate-${lease.context.siteId}-${r.clientRef}` : null });
    } catch (e) {
      assertDutyLease(lease);
      items.push({ clientRef: r.clientRef, kind: r.kind, label: 'Cannot be opened on this device', createdAt: r.createdAt, status: 'refused', error: 'Encryption verification failed. Record retained; ask a supervisor for recovery.', tries: r.tries, gateId: null });
    }
  }
  assertDutyLease(lease);
  return items;
}

let flushing: Promise<{ sent: number; left: number }> | null = null;
/** Sends what is waiting, oldest first; stops at the first network problem so the order is kept. */
export function flush(): Promise<{ sent: number; left: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let lease: DutyLease;
    try { lease = dutyLease(); } catch { return { sent: 0, left: 0 }; }
    let sent = 0;
    const rows = (await tx<Row[]>(lease, OUT, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>)).filter((r) => r.status === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const r of rows) {
      let job: Job;
      try {
        job = (await unlock<{ job: Job }>(lease, rowPurpose(r), r.iv, r.data)).job;
      } catch {
        assertDutyLease(lease);
        continue;
      }
      try {
        await send(job, lease);
        assertDutyLease(lease);
        await tx(lease, OUT, 'readwrite', (s) => s.delete(r.clientRef));
        sent += 1;
      } catch (e) {
        if (e instanceof OfflineContextError || (e instanceof ApiError && e.status === 401)) throw e;
        assertDutyLease(lease);
        if (isNetwork(e)) {
          await tx(lease, OUT, 'readwrite', (s) => s.put({ ...r, tries: r.tries + 1 }));
          break;
        }
        // Refused: kept on the device for the supervisor, never dropped silently.
        await tx(lease, OUT, 'readwrite', (s) => s.put({ ...r, tries: r.tries + 1, status: 'refused', error: e instanceof Error ? e.message : 'Refused' }));
      }
    }
    assertDutyLease(lease);
    const left = (await outbox(null)).length;
    window.dispatchEvent(new Event(CHANGED));
    return { sent, left };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** The supervisor removes a refused entry after writing it down by hand. */
export async function removeRefused(clientRef: string): Promise<void> {
  const lease = dutyLease();
  const r = await tx<Row | undefined>(lease, OUT, 'readonly', (s) => s.get(clientRef) as IDBRequest<Row | undefined>);
  if (!r || r.status !== 'refused') return;
  await tx(lease, OUT, 'readwrite', (s) => s.delete(clientRef));
  window.dispatchEvent(new Event(CHANGED));
}

/** Last known site lists (vehicles, the in-house key, who is inside), kept encrypted for when the signal drops. */
export async function cacheDuty<T>(value: T): Promise<void> {
  try {
    const lease = dutyLease();
    const { iv, data } = await lock(lease, 'cache', value);
    await tx(lease, META, 'readwrite', (s) => s.put({ iv, data }, 'duty'));
  } catch {
    /* the screen still works online */
  }
}
export async function cachedDuty<T>(): Promise<T | null> {
  try {
    const lease = dutyLease();
    const v = await tx<{ iv: Uint8Array; data: ArrayBuffer } | undefined>(lease, META, 'readonly', (s) => s.get('duty') as IDBRequest<{ iv: Uint8Array; data: ArrayBuffer } | undefined>);
    return v ? await unlock<T>(lease, 'cache', v.iv, v.data) : null;
  } catch {
    return null;
  }
}

/** The duty screen's data: from the server when there is a signal, else the last encrypted copy on the device. */
export async function loadDuty() {
  const generation = contextGeneration();
  try {
    if (testOffline) throw new TypeError('offline');
    const d = await api.dutyDevice();
    bindDutyContext(d.offlineContext, generation);
    await cacheDuty(d);
    if (contextGeneration() !== generation) throw new OfflineContextError('Context changed while loading. Reopen the duty screen.');
    return { ...d, offline: false as const };
  } catch (e) {
    if (!isNetwork(e)) throw e;
    if (contextGeneration() !== generation) throw new OfflineContextError('Context changed while loading. Pending records remain locked.');
    const c = await cachedDuty<Awaited<ReturnType<typeof api.dutyDevice>>>();
    if (!c) throw new Error('No internet, and this device has no saved site lists yet. Open the app once with a signal.');
    return { ...c, offline: true as const };
  }
}

let started = false;
/** Sends waiting entries when the signal comes back, and every 30 seconds while the app is open. */
export function startOutbox() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void flush().catch(() => window.dispatchEvent(new Event(CHANGED))));
  setInterval(() => void flush().catch(() => window.dispatchEvent(new Event(CHANGED))), 30_000);
  void flush().catch(() => window.dispatchEvent(new Event(CHANGED)));
}
