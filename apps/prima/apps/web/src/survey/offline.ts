// Offline site survey (Fauzan, 4 Nov 2026, staff usability rule 5): the phone keeps the survey and its photos until it
// has a signal, then sends them. Kept in the browser's own database on this phone (IndexedDB), never in the page
// cache. Each survey belongs to the person who made it: another sign-in on the same phone neither sees nor sends it.
//
// Locked on the phone (Fauzan, 5 Nov 2026: "Do encryption"). Every survey, photo and saved list is encrypted with
// AES-256-GCM before it is written. Each person on the phone has their own key, made on the phone by the browser as a
// non-exportable key: the app can use it but nobody can read it out, not even the app. The encryption is tied to the
// survey number and its owner, so a record cannot be moved to another person or changed without the phone noticing.
// Only the survey number, owner, state and time stay readable, so the phone can list and send without unlocking all.
// When the browser offers no encryption (an unsafe http page), nothing is written to the phone at all.
import { sha256Hex } from '@prima/core';
import { ApiError, api, type SiteSurveySetup } from '../api';

export type SurveyUnit = 'm' | 'm2' | 'unit';
export interface FormPost {
  name: string;
  coverHours: 8 | 12 | 24;
  shiftHours: 8 | 12;
  guardsPerShift: number;
  armed: boolean;
}
export interface SurveyForm {
  companyId: string;
  target: 'lead' | 'site' | 'new';
  leadId: string;
  siteId: string;
  place: string;
  address: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  details: {
    siteType: string;
    operatingHours: string;
    perimeterM: string;
    areaM2: string;
    floors: string;
    entrances: string;
    vehicleGates: string;
    cctvCameras: string;
    lighting: 'good' | 'poor' | 'none';
    fence: 'full' | 'partial' | 'none';
    alarm: boolean;
    guardhouse: boolean;
  };
  measures: { label: string; value: string; unit: SurveyUnit }[];
  risks: string[];
  riskNote: string;
  posts: FormPost[];
  findings: string;
  /** Why there are no photos, where photography is not allowed (protected place, client rule). */
  noPhotoReason?: string;
  redoOf: string | null;
}
export interface LocalPhoto {
  key: string;
  sha256: string;
  bytes: number;
  caption: string;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
}
export type LocalState = 'draft' | 'ready' | 'sending' | 'refused' | 'sent';
export interface LocalSurvey {
  id: string;
  ownerId: string;
  state: LocalState;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: number;
  form: SurveyForm;
  photos: LocalPhoto[];
  /** The server already holds the survey itself; only photos may still be missing. Content can no longer change. */
  serverReceived: boolean;
  ref: string | null;
  error: string | null;
  tries: number;
  nextTryAt: number;
  sentAt: number | null;
}

export function blankForm(companyId = ''): SurveyForm {
  return {
    companyId,
    target: 'new',
    leadId: '',
    siteId: '',
    place: '',
    address: '',
    lat: null,
    lng: null,
    accuracyM: null,
    details: { siteType: 'other', operatingHours: '', perimeterM: '', areaM2: '', floors: '', entrances: '', vehicleGates: '', cctvCameras: '', lighting: 'good', fence: 'full', alarm: false, guardhouse: false },
    measures: [],
    risks: [],
    riskNote: '',
    posts: [{ name: 'Pintu utama', coverHours: 24, shiftHours: 12, guardsPerShift: 1, armed: false }],
    findings: '',
    noPhotoReason: '',
    redoOf: null,
  };
}

// ---------- The phone's own database ----------

const DB = 'prima-offline';
const SURVEYS = 'surveys';
const PHOTOS = 'surveyPhotos';
const KV = 'kv';
const KEYS = 'keys';
let dbp: Promise<IDBDatabase | null> | null = null;
/** Used only when this browser has no database (some private windows): the survey lasts while the app is open. */
const memory = { surveys: new Map<string, LocalSurvey>(), photos: new Map<string, string>(), kv: new Map<string, unknown>() };

function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      if (!globalThis.crypto?.subtle) return resolve(null); // no encryption here: keep surveys only while the app is open
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        // Version 1 kept surveys unlocked. It was never released to staff; anything it left is test data and is wiped.
        if (ev.oldVersion === 1) for (const name of [SURVEYS, PHOTOS, KV]) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        if (!db.objectStoreNames.contains(SURVEYS)) db.createObjectStore(SURVEYS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: 'k' });
        if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'ownerId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

/** Whether surveys survive closing the app on this phone. */
export async function savesOnPhone(): Promise<boolean> {
  const db = await open();
  if (db) {
    // Ask the browser not to clear the saved surveys when the phone runs low on space.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* not offered: still saved */
    }
  }
  return !!db;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!db) return resolve(undefined);
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error ?? new Error('The phone could not save the survey.'));
        t.onabort = () => reject(t.error ?? new Error('The phone could not save the survey. It may be out of space.'));
      }),
  );
}

// ---------- Locking what is kept on the phone ----------

interface Sealed {
  iv: ArrayBuffer;
  ct: ArrayBuffer;
}
// Only found or made keys are remembered; "no key yet" is never remembered, so a lookup cannot block making the key.
const keyCache = new Map<string, Promise<CryptoKey>>();

/** This person's key on this phone, made once and never exportable. */
async function ownerKey(ownerId: string, create = true): Promise<CryptoKey | null> {
  const known = keyCache.get(ownerId);
  if (known) return known;
  if (!create) {
    const row = await tx<{ ownerId: string; key: CryptoKey }>(KEYS, 'readonly', (st) => st.get(ownerId));
    if (row?.key) keyCache.set(ownerId, Promise.resolve(row.key));
    return row?.key ?? null;
  }
  const p = (async () => {
    const row = await tx<{ ownerId: string; key: CryptoKey }>(KEYS, 'readonly', (st) => st.get(ownerId));
    if (row?.key) return row.key;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // add, not put: if two screens make a key at once, the first one saved wins and the other reads it back.
    try {
      await tx(KEYS, 'readwrite', (st) => st.add({ ownerId, key }));
      return key;
    } catch {
      const again = await tx<{ ownerId: string; key: CryptoKey }>(KEYS, 'readonly', (st) => st.get(ownerId));
      if (!again?.key) throw new Error('The phone could not lock the survey.');
      return again.key;
    }
  })();
  keyCache.set(ownerId, p);
  p.catch(() => keyCache.delete(ownerId));
  return p;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function seal(ownerId: string, bind: string, value: unknown): Promise<Sealed> {
  const key = await ownerKey(ownerId);
  if (!key) throw new Error('The phone could not lock the survey.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${ownerId}|${bind}`) }, key, enc.encode(JSON.stringify(value)));
  return { iv: iv.buffer, ct };
}

/** Opens a locked record; a record that was changed, moved to another person or has no key gives nothing. */
async function unseal<T>(ownerId: string, bind: string, box: Partial<Sealed> | undefined): Promise<T | null> {
  if (!box?.iv || !box.ct) return null;
  try {
    const key = await ownerKey(ownerId, false);
    if (!key) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(box.iv), additionalData: enc.encode(`${ownerId}|${bind}`) }, key, box.ct);
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

/** What a survey row on the phone holds: readable list fields, and the survey itself locked. */
interface SurveyRow extends Sealed {
  id: string;
  ownerId: string;
  state: LocalState;
  updatedAt: number;
}
const surveyBind = (id: string) => `survey:${id}`;
async function openRow(r: SurveyRow): Promise<LocalSurvey | null> {
  const s = await unseal<LocalSurvey>(r.ownerId, surveyBind(r.id), r);
  return s && s.id === r.id && s.ownerId === r.ownerId ? s : null;
}
async function allRows(): Promise<SurveyRow[]> {
  return (await tx<SurveyRow[]>(SURVEYS, 'readonly', (s) => s.getAll())) ?? [];
}

export async function listLocal(ownerId: string): Promise<LocalSurvey[]> {
  const db = await open();
  let all: LocalSurvey[];
  if (db) {
    const rows = (await allRows()).filter((r) => r.ownerId === ownerId);
    all = (await Promise.all(rows.map(openRow))).filter((s): s is LocalSurvey => !!s);
  } else all = [...memory.surveys.values()].filter((s) => s.ownerId === ownerId).map((s) => structuredClone(s));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** How many surveys on this phone belong to someone else (shown as a count only). */
export async function othersWaiting(ownerId: string): Promise<number> {
  const db = await open();
  const all: { ownerId: string; state: LocalState }[] = db ? await allRows() : [...memory.surveys.values()];
  return all.filter((s) => s.ownerId !== ownerId && s.state !== 'sent').length;
}

export async function getLocal(id: string): Promise<LocalSurvey | undefined> {
  const db = await open();
  if (!db) {
    const s = memory.surveys.get(id);
    return s && structuredClone(s);
  }
  const row = await tx<SurveyRow>(SURVEYS, 'readonly', (s) => s.get(id));
  return (row && (await openRow(row))) ?? undefined;
}

export async function putLocal(s: LocalSurvey): Promise<void> {
  const db = await open();
  if (!db) {
    memory.surveys.set(s.id, structuredClone(s));
    return;
  }
  const box = await seal(s.ownerId, surveyBind(s.id), s);
  const row: SurveyRow = { id: s.id, ownerId: s.ownerId, state: s.state, updatedAt: s.updatedAt, ...box };
  await tx(SURVEYS, 'readwrite', (st) => st.put(row));
}

export async function deleteLocal(s: LocalSurvey): Promise<void> {
  for (const p of s.photos) await deletePhoto(p.key);
  const db = await open();
  if (!db) memory.surveys.delete(s.id);
  else await tx(SURVEYS, 'readwrite', (st) => st.delete(s.id));
}

const photoBind = (key: string) => `photo:${key}`;
export async function putPhoto(ownerId: string, key: string, image: string): Promise<void> {
  const db = await open();
  if (!db) memory.photos.set(key, image);
  else {
    const box = await seal(ownerId, photoBind(key), image);
    await tx(PHOTOS, 'readwrite', (st) => st.put({ key, ownerId, ...box }));
  }
}

export async function getPhoto(key: string): Promise<string | null> {
  const db = await open();
  if (!db) return memory.photos.get(key) ?? null;
  const row = await tx<{ key: string; ownerId: string } & Sealed>(PHOTOS, 'readonly', (st) => st.get(key));
  if (!row) return null;
  const image = await unseal<string>(row.ownerId, photoBind(key), row);
  return typeof image === 'string' ? image : null;
}

export async function deletePhoto(key: string): Promise<void> {
  const db = await open();
  if (!db) memory.photos.delete(key);
  else await tx(PHOTOS, 'readwrite', (st) => st.delete(key));
}

/** Keeps a new photo on the phone and returns what the survey lists about it. */
export async function keepPhoto(ownerId: string, surveyId: string, p: { image: string; caption?: string; capturedAt: string; lat: number | null; lng: number | null; accuracyM: number | null }): Promise<LocalPhoto> {
  const sha256 = sha256Hex(p.image);
  const key = `${surveyId}:${sha256.slice(0, 24)}`;
  await putPhoto(ownerId, key, p.image);
  const bytes = Math.floor(((p.image.length - p.image.indexOf(',') - 1) * 3) / 4);
  return { key, sha256, bytes, caption: (p.caption ?? '').slice(0, 200), capturedAt: p.capturedAt, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM };
}

// What the phone remembers for working with no signal: who last signed in here, and their companies, leads and sites.
const OWNER = 'survey-owner';
// Only the owner's account number stays readable (to open the survey screen with no signal); their name and lists are
// locked with their key.
export async function rememberSetup(setup: SiteSurveySetup): Promise<void> {
  const db = await open();
  const id = setup.user.id;
  if (!db) {
    memory.kv.set(OWNER, { id, name: setup.user.name });
    memory.kv.set(`setup:${id}`, setup);
    return;
  }
  const rows = [
    { k: OWNER, v: { id, ...(await seal(id, 'owner', setup.user.name)) } },
    { k: `setup:${id}`, v: await seal(id, `setup:${id}`, setup) },
  ];
  for (const r of rows) await tx(KV, 'readwrite', (st) => st.put(r));
}
export async function lastOwner(): Promise<{ id: string; name: string } | null> {
  const db = await open();
  if (!db) return (memory.kv.get(OWNER) as { id: string; name: string }) ?? null;
  const v = (await tx<{ k: string; v: { id: string } & Partial<Sealed> }>(KV, 'readonly', (st) => st.get(OWNER)))?.v;
  if (!v?.id) return null;
  const name = await unseal<string>(v.id, 'owner', v);
  return typeof name === 'string' ? { id: v.id, name } : null;
}
export async function cachedSetup(userId: string): Promise<SiteSurveySetup | null> {
  const db = await open();
  if (!db) return (memory.kv.get(`setup:${userId}`) as SiteSurveySetup) ?? null;
  const v = (await tx<{ k: string; v: Partial<Sealed> }>(KV, 'readonly', (st) => st.get(`setup:${userId}`)))?.v;
  const setup = await unseal<SiteSurveySetup>(userId, `setup:${userId}`, v);
  return setup && setup.user?.id === userId ? setup : null;
}
/**
 * Signing out forgets who was here and their lists. Unsent surveys stay, still owned and locked by their maker. When
 * that person has nothing left to send, their key is destroyed, so the short "sent" records left behind can never be
 * opened again.
 */
export async function forgetOwner(): Promise<void> {
  const db = await open();
  if (!db) {
    const id = (memory.kv.get(OWNER) as { id: string } | undefined)?.id;
    memory.kv.delete(OWNER);
    if (id) memory.kv.delete(`setup:${id}`);
    return;
  }
  const id = (await tx<{ k: string; v: { id: string } }>(KV, 'readonly', (st) => st.get(OWNER)))?.v?.id;
  for (const k of [OWNER, ...(id ? [`setup:${id}`] : [])]) await tx(KV, 'readwrite', (st) => st.delete(k));
  if (!id) return;
  const rows = (await allRows()).filter((r) => r.ownerId === id);
  if (rows.some((r) => r.state !== 'sent')) return;
  const photos = ((await tx<{ key: string; ownerId: string }[]>(PHOTOS, 'readonly', (st) => st.getAll())) ?? []).filter((p) => p.ownerId === id);
  for (const r of rows) await tx(SURVEYS, 'readwrite', (st) => st.delete(r.id));
  for (const p of photos) await tx(PHOTOS, 'readwrite', (st) => st.delete(p.key));
  await tx(KEYS, 'readwrite', (st) => st.delete(id));
  keyCache.delete(id);
}

export function newSurveyId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `svy-${c.randomUUID()}`;
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `svy-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- Sending when there is a signal ----------

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** What the server receives: the form, and the list of photos without their files. */
export function surveyBody(s: LocalSurvey): Record<string, unknown> {
  const f = s.form;
  return {
    id: s.id,
    companyId: f.companyId,
    leadId: f.target === 'lead' ? f.leadId || null : null,
    siteId: f.target === 'site' ? f.siteId || null : null,
    place: f.target === 'new' ? f.place : '',
    address: f.address,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt ?? s.startedAt,
    lat: f.lat,
    lng: f.lng,
    accuracyM: f.accuracyM,
    details: {
      ...f.details,
      perimeterM: numOrNull(f.details.perimeterM),
      areaM2: numOrNull(f.details.areaM2),
      floors: numOrNull(f.details.floors),
      entrances: numOrNull(f.details.entrances),
      vehicleGates: numOrNull(f.details.vehicleGates),
      cctvCameras: numOrNull(f.details.cctvCameras),
    },
    measures: f.measures.filter((m) => m.label.trim() || m.value.trim()).map((m) => ({ label: m.label, value: numOrNull(m.value), unit: m.unit })),
    risks: f.risks,
    riskNote: f.riskNote,
    posts: f.posts,
    findings: f.findings,
    noPhotoReason: s.photos.length ? '' : (f.noPhotoReason ?? ''),
    photos: s.photos.map((p) => ({ sha256: p.sha256, bytes: p.bytes, caption: p.caption, capturedAt: p.capturedAt, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM })),
    redoOf: f.redoOf,
  };
}

export const NUMBER_LABEL = {
  perimeterM: 'Perimeter (m)',
  areaM2: 'Area (m²)',
  floors: 'Floors',
  entrances: 'Entrances for people',
  vehicleGates: 'Vehicle gates',
  cctvCameras: 'CCTV cameras now',
} as const;

/** What still stops the survey being sent, checked on the phone so the surveyor fixes it at the site. */
export function missingBits(s: LocalSurvey): string[] {
  const f = s.form;
  const out: string[] = [];
  if (!f.companyId) out.push('Choose the company.');
  if (f.target === 'lead' && !f.leadId) out.push('Choose the sales lead.');
  if (f.target === 'site' && !f.siteId) out.push('Choose the site.');
  if (f.target === 'new' && f.place.trim().length < 2) out.push('Name the place.');
  if (!f.posts.length) out.push('Add at least one guard post.');
  if (!s.photos.length && (f.noPhotoReason ?? '').trim().length < 5) out.push('Take at least one photo, or say why photos are not allowed here.');
  if (f.findings.trim().length < 3) out.push('Write what you found.');
  for (const [k, label] of Object.entries(NUMBER_LABEL)) {
    const v = f.details[k as keyof typeof NUMBER_LABEL];
    if (v.trim() && !(Number(v.replace(',', '.')) >= 0)) out.push(`Check the number for ${label}.`);
  }
  return out;
}

const RETRY_MAX_MS = 15 * 60_000;
let running: Promise<SyncResult> | null = null;
export interface SyncResult {
  sent: number;
  waiting: number;
  refused: number;
  offline: boolean;
}
/** Tells open survey screens that something on the phone changed. */
export const SURVEYS_CHANGED = 'prima:surveys-changed';
const changed = () => window.dispatchEvent(new CustomEvent(SURVEYS_CHANGED));

function isNetwork(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500 || e.status === 408 || e.status === 429 || e.status === 0;
  return true; // fetch failed: no signal, server away, request cut off
}

/**
 * Sends every finished survey of this person that is due. One run at a time; a survey that fails for lack of signal is
 * tried again later with growing gaps (30 s, 1 min, 2 min ... up to 15 min). A refusal by the server stops that survey
 * and says why, so the surveyor can fix it.
 */
export function syncSurveys(ownerId: string, force = false): Promise<SyncResult> {
  running ??= (async () => {
    const res: SyncResult = { sent: 0, waiting: 0, refused: 0, offline: false };
    try {
      const mine = await listLocal(ownerId);
      for (const s0 of mine) {
        if (s0.state !== 'ready' && s0.state !== 'sending') {
          if (s0.state === 'refused') res.refused++;
          continue;
        }
        if (!force && s0.nextTryAt > Date.now()) {
          res.waiting++;
          continue;
        }
        let s: LocalSurvey = { ...s0, state: 'sending', error: null };
        await putLocal(s);
        changed();
        try {
          let receipt = await api.siteSurveyReceive(surveyBody(s));
          s = { ...s, serverReceived: true, ref: receipt.ref };
          await putLocal(s);
          for (const n of receipt.missing) {
            const p = s.photos[n - 1];
            const image = p ? await getPhoto(p.key) : null;
            if (!image) throw new ApiError(`Photo ${n} is no longer on this phone. Ask the Project Director to return the survey, then redo it.`, 400, []);
            receipt = await api.siteSurveyPhoto(s.id, n, image);
          }
          if (receipt.status === 'receiving_photos') throw new ApiError('Some photos did not arrive. Trying again.', 503, []);
          // Delivered: the photos leave the phone; a short record stays so the surveyor sees it went.
          for (const p of s.photos) await deletePhoto(p.key);
          s = { ...s, state: 'sent', sentAt: Date.now(), tries: 0, error: null, photos: s.photos.map((p) => ({ ...p })) };
          await putLocal(s);
          res.sent++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (e instanceof ApiError && e.status === 401) {
            s = { ...s, state: 'ready', error: 'Sign in again to send this survey.' };
            await putLocal(s);
            res.waiting++;
            break;
          }
          if (isNetwork(e)) {
            const tries = s.tries + 1;
            s = { ...s, state: 'ready', tries, nextTryAt: Date.now() + Math.min(RETRY_MAX_MS, 30_000 * 2 ** Math.min(tries - 1, 5)), error: null };
            res.offline = true;
            res.waiting++;
          } else {
            s = { ...s, state: 'refused', error: msg };
            res.refused++;
          }
          await putLocal(s);
        }
        changed();
      }
      // Sent surveys are cleared from the phone after a week.
      for (const s of mine) if (s.state === 'sent' && s.sentAt && Date.now() - s.sentAt > 7 * 86_400_000) await deleteLocal(s);
    } finally {
      running = null;
    }
    return res;
  })();
  return running;
}
