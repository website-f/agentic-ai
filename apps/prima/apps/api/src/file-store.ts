import { createHash } from 'node:crypto';
import { BadRequest, type Store } from '@prima/core';

// Cloud file storage for photos and documents captured in the app (audit build order, 5 Nov 2026).
//
// Photos from the in-app camera, proof documents and clock-in pictures arrive as data URLs and used to be kept inside
// the database rows. With FILE_STORE=azure-blob the API keeps the bytes in a private Azure Blob container instead and
// the row keeps only a short reference. Reading a row puts the exact same data URL back, after checking its SHA-256,
// so every screen, permission check and record hash works unchanged. SharePoint files are opened by link and never
// copied here (staff usability rule 6): this store holds only what the app itself captures.
//
// It is OFF by default. Nothing is sent anywhere until the CEO creates the storage account, gives the API's managed
// identity access to the one container and sets the settings below (docs/FILE_STORAGE.md).

/** The prefix of a stored-file reference. A client can never write a string that starts with it. */
export const FILE_REF_PREFIX = 'prima-file:v1:';

/** Only these file kinds leave the row; anything else (an SVG test picture, a short value) stays where it is. */
const KINDS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' } as const;
type Mime = keyof typeof KINDS;
const MIME_OF: Record<string, Mime> = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
const DATA_URL = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/;
const REF = /^prima-file:v1:([A-Za-z]{1,60})\/([A-Za-z0-9_-]{1,64})\/([0-9a-f]{64})\.(jpg|png|pdf)$/;
/**
 * The only records whose files move. Other tables keep their files in the row because database rules hash or compare
 * their stored JSON (IT purchases and procurement packets, IT cleanup roots and archives): a reference there would
 * no longer match the hash the service computed from the file, and those writes would be refused. A table joins this
 * list only after checking that no database rule reads its stored file values.
 */
export const FILE_TABLES: ReadonlySet<string> = new Set(['evidencePhotos', 'evidenceDocs', 'staffClocks', 'itJobs']);
/** Smaller values stay in the row: moving them saves nothing. */
export const MIN_MOVE_CHARS = 2048;
/** The largest file the store hands back (the API body limit is 3 MB). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Where file bytes live. Names are always `<table>/<company or group>/<sha256>.<ext>`. */
export interface FileBackend {
  readonly label: string;
  /** Write once. A name that already exists is left as it is (the name is the content's hash). */
  put(name: string, bytes: Buffer, mime: string): Promise<void>;
  get(name: string): Promise<Buffer>;
  /** Proves the API can write and read the container; run once at start-up in production. */
  check(): Promise<void>;
}

export interface FileStoreConfig {
  account: string;
  container: string;
  clientId: string | null;
}

/**
 * Reads the file store settings. Returns null when the store is off (the default). A half-filled or wrong setting
 * stops the API from starting rather than quietly keeping files somewhere unexpected.
 */
export function fileStoreConfig(env: NodeJS.ProcessEnv = process.env): FileStoreConfig | null {
  const mode = (env.FILE_STORE ?? 'off').trim().toLowerCase();
  if (mode === '' || mode === 'off') return null;
  if (mode !== 'azure-blob') throw new Error('FILE_STORE must be off or azure-blob.');
  const account = (env.FILE_STORE_ACCOUNT ?? '').trim();
  const container = (env.FILE_STORE_CONTAINER ?? 'evidence').trim();
  const clientId = (env.FILE_STORE_CLIENT_ID ?? '').trim() || null;
  if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error('FILE_STORE_ACCOUNT must be a storage account name (3-24 lower-case letters or digits).');
  if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,62}$/.test(container)) throw new Error('FILE_STORE_CONTAINER must be a valid container name.');
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
    throw new Error('FILE_STORE_CLIENT_ID must be a managed identity client ID.');
  return { account, container, clientId };
}

type Fetch = typeof fetch;

/**
 * Azure Blob Storage through its REST API, signed in with the Container App's managed identity: no storage key or
 * connection string exists anywhere. Azure encrypts every blob at rest (AES-256) and the API only talks HTTPS.
 */
export class AzureBlobFiles implements FileBackend {
  readonly label: string;
  private token: { value: string; until: number } | null = null;
  private pending: Promise<string> | null = null;
  constructor(
    private cfg: FileStoreConfig,
    private env: NodeJS.ProcessEnv = process.env,
    private http: Fetch = fetch,
    private now: () => number = Date.now,
    private timeoutMs = 20_000,
  ) {
    this.label = `Azure Blob ${cfg.account}/${cfg.container}`;
  }

  private url(name: string): string {
    if (!/^[A-Za-z0-9_/.-]{1,200}$/.test(name) || name.includes('..')) throw new Error('Invalid file name.');
    return `https://${this.cfg.account}.blob.core.windows.net/${this.cfg.container}/${name}`;
  }

  private async bearer(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    // Many files in one request ask at once: they share one token request.
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    const endpoint = this.env.IDENTITY_ENDPOINT;
    const header = this.env.IDENTITY_HEADER;
    if (!endpoint || !header) throw new Error('This server has no managed identity, so it cannot reach file storage.');
    const url = new URL(endpoint);
    url.searchParams.set('resource', 'https://storage.azure.com/');
    url.searchParams.set('api-version', '2019-08-01');
    if (this.cfg.clientId) url.searchParams.set('client_id', this.cfg.clientId);
    const res = await this.http(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs), headers: { 'X-IDENTITY-HEADER': header } });
    if (!res.ok) throw new Error(`Managed identity refused a storage token (${res.status}).`);
    const body = (await res.json()) as { access_token?: unknown; expires_on?: unknown };
    if (typeof body?.access_token !== 'string' || !body.access_token || /[\r\n]/.test(body.access_token)) throw new Error('Managed identity gave no storage token.');
    const ends = Number(body.expires_on) * 1000 || this.now() + 30 * 60_000;
    this.token = { value: body.access_token, until: ends - 5 * 60_000 };
    return body.access_token;
  }

  private async headers(extra: Record<string, string>): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.bearer()}`, 'x-ms-version': '2023-11-03', ...extra };
  }

  async put(name: string, bytes: Buffer, mime: string): Promise<void> {
    const res = await this.http(this.url(name), {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: await this.headers({
        'x-ms-blob-type': 'BlockBlob',
        'content-type': mime,
        'content-md5': createHash('md5').update(bytes).digest('base64'),
        'if-none-match': '*',
      }),
      body: new Uint8Array(bytes),
    });
    // 409 or 412: the blob is already there. Its name is the hash of its content, and every read checks that hash.
    if (res.status === 201 || res.status === 409 || res.status === 412) return;
    throw new Error(`File storage refused to save a file (${res.status}).`);
  }

  async get(name: string): Promise<Buffer> {
    const res = await this.http(this.url(name), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs), headers: await this.headers({}) });
    if (res.status === 404) throw new Error('A stored file is missing from file storage.');
    if (!res.ok) throw new Error(`File storage refused to give a file (${res.status}).`);
    const size = Number(res.headers.get('content-length') ?? '0');
    if (size > MAX_FILE_BYTES) throw new Error('A stored file is larger than any file the app accepts.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new Error('A stored file is larger than any file the app accepts.');
    return buf;
  }

  async check(): Promise<void> {
    // Written once like every other file, so the check also works if the container is later made write-once.
    const probe = Buffer.from('prima file store check\n');
    const name = `_check/${createHash('sha256').update(probe).digest('hex')}.txt`;
    await this.put(name, probe, 'text/plain');
    const back = await this.get(name);
    if (!back.equals(probe)) throw new Error('File storage gave back a different file than it was given.');
  }
}

/** Keeps files in memory: tests and local runs only, never production. */
export class MemoryFiles implements FileBackend {
  readonly label = 'memory (tests only)';
  readonly blobs = new Map<string, Buffer>();
  puts = 0;
  gets = 0;
  async put(name: string, bytes: Buffer): Promise<void> {
    this.puts += 1;
    if (!this.blobs.has(name)) this.blobs.set(name, Buffer.from(bytes));
  }
  async get(name: string): Promise<Buffer> {
    this.gets += 1;
    const b = this.blobs.get(name);
    if (!b) throw new Error('A stored file is missing from file storage.');
    return Buffer.from(b);
  }
  async check(): Promise<void> {}
}

/** Builds the configured backend, or null when the store is off. */
export function fileBackendFromEnv(env: NodeJS.ProcessEnv = process.env): FileBackend | null {
  const cfg = fileStoreConfig(env);
  return cfg ? new AzureBlobFiles(cfg, env) : null;
}

/** FILE_STORE_CACHE_MB: whole megabytes from 0 to 1024, default 64. Anything else stops the API from starting. */
export function cacheMb(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return 64;
  if (!/^\d{1,4}$/.test(v.trim()) || Number(v) > 1024) throw new Error('FILE_STORE_CACHE_MB must be a whole number from 0 to 1024.');
  return Number(v);
}

/** Recently read files, by name. Names are content hashes, so an entry never goes stale. */
class FileCache {
  private items = new Map<string, string>();
  private size = 0;
  constructor(private maxChars: number) {}
  get(name: string): string | undefined {
    const v = this.items.get(name);
    if (v !== undefined) {
      this.items.delete(name);
      this.items.set(name, v);
    }
    return v;
  }
  set(name: string, dataUrl: string): void {
    if (dataUrl.length > this.maxChars) return;
    if (this.items.has(name)) return;
    this.items.set(name, dataUrl);
    this.size += dataUrl.length;
    for (const [k, v] of this.items) {
      if (this.size <= this.maxChars) break;
      this.items.delete(k);
      this.size -= v.length;
    }
  }
}

/** The files of one API process: the backend plus a small read cache shared by every request. */
export class FileStore {
  private cache: FileCache;
  constructor(
    readonly backend: FileBackend,
    cacheChars = cacheMb(process.env.FILE_STORE_CACHE_MB) * 1024 * 1024,
  ) {
    this.cache = new FileCache(cacheChars);
  }

  /** Wraps a request's store so file bytes go to the backend on write and come back on read. */
  wrap(store: Store): Store {
    return withFileStore(store, this);
  }

  /** Saves the bytes of a data URL and returns the reference kept in the row, or null when it stays in the row. */
  async save(table: string, scope: string, dataUrl: string): Promise<string | null> {
    const m = DATA_URL.exec(dataUrl);
    if (!m || dataUrl.length < MIN_MOVE_CHARS) return null;
    const mime = m[1] as Mime;
    const bytes = Buffer.from(m[2], 'base64');
    // Only a file that reads back exactly the same leaves the row, so a record's hash of its data URL stays true.
    if (bytes.toString('base64') !== m[2]) return null;
    const sha = createHash('sha256').update(bytes).digest('hex');
    const name = `${table}/${scope}/${sha}.${KINDS[mime]}`;
    if (this.cache.get(name) === undefined) {
      await this.backend.put(name, bytes, mime);
      this.cache.set(name, dataUrl);
    }
    return FILE_REF_PREFIX + name;
  }

  /** Gives back the data URL for a reference, after checking the bytes still have the hash in their name. */
  async load(ref: string, table: string, scope: string): Promise<string> {
    const m = REF.exec(ref);
    // A reference only opens a file of the same kind of record and the same company as the row it sits in.
    if (!m || m[1] !== table || m[2] !== scope) throw new Error('A stored file reference does not belong to this record.');
    const name = ref.slice(FILE_REF_PREFIX.length);
    const hit = this.cache.get(name);
    if (hit !== undefined) return hit;
    const bytes = await this.backend.get(name);
    if (createHash('sha256').update(bytes).digest('hex') !== m[3]) throw new Error('A stored file has changed since it was saved.');
    const dataUrl = `data:${MIME_OF[m[4]]};base64,${bytes.toString('base64')}`;
    this.cache.set(name, dataUrl);
    return dataUrl;
  }
}

/** The company a row belongs to, as used in file names; group-wide records use "group". */
function scopeOf(row: unknown): string {
  const c = row && typeof row === 'object' ? (row as { companyId?: unknown }).companyId : undefined;
  return typeof c === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c) ? c : 'group';
}

/** Calls `swap` on every string inside a value; returns a copy with the replacements, sharing what did not change. */
function mapStrings(value: unknown, swap: (s: string) => string): unknown {
  if (typeof value === 'string') return swap(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = mapStrings(v, swap);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = mapStrings(v, swap);
      if (n !== v) changed = true;
      out[k] = n;
    }
    return changed ? out : value;
  }
  return value;
}

function eachString(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const v of value) eachString(v, visit);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) eachString(v, visit);
}

/** Runs jobs a few at a time. */
async function inBatches<T>(items: T[], n: number, job: (t: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(job));
}

/** Moves file bytes out of a row before it is written. `scope` gives the company of the row as stored. */
async function outgoing(files: FileStore, table: string, scope: () => Promise<string> | string, value: unknown): Promise<unknown> {
  const urls = new Set<string>();
  eachString(value, (s) => {
    // A reference can only be made here. One sent in from outside could point at another record's file.
    if (s.startsWith(FILE_REF_PREFIX)) throw new BadRequest('This text is not allowed.');
    if (s.length >= MIN_MOVE_CHARS && s.startsWith('data:')) urls.add(s);
  });
  if (!urls.size || !FILE_TABLES.has(table)) return value;
  const where = await scope();
  const refs = new Map<string, string>();
  await inBatches([...urls], 4, async (u) => {
    const ref = await files.save(table, where, u);
    if (ref) refs.set(u, ref);
  });
  return refs.size ? mapStrings(value, (s) => refs.get(s) ?? s) : value;
}

/** Puts file bytes back into rows that were read, fetching the files of all the rows a few at a time. */
async function incoming(files: FileStore, table: string, rows: unknown[]): Promise<unknown[]> {
  if (!FILE_TABLES.has(table)) return rows;
  // Each reference is checked against the row it sits in; the same file in two rows is fetched once.
  const wanted = new Map<string, { ref: string; scope: string }>();
  const per = rows.map((row) => {
    if (!row || typeof row !== 'object') return false;
    let has = false;
    const scope = scopeOf(row);
    eachString(row, (s) => {
      if (!s.startsWith(FILE_REF_PREFIX)) return;
      has = true;
      wanted.set(`${scope}\u0000${s}`, { ref: s, scope });
    });
    return has;
  });
  if (!wanted.size) return rows;
  const urls = new Map<string, string>();
  await inBatches([...wanted], 8, async ([key, w]) => {
    urls.set(key, await files.load(w.ref, table, w.scope));
  });
  return rows.map((row, i) => {
    if (!per[i]) return row;
    const scope = scopeOf(row);
    return mapStrings(row, (s) => urls.get(`${scope}\u0000${s}`) ?? s);
  });
}
const incomingOne = async (files: FileStore, table: string, row: unknown) => (await incoming(files, table, [row]))[0];

/**
 * A store whose rows keep file references instead of file bytes. Everything the service sees is unchanged: it writes
 * data URLs and reads data URLs. Writes upload first, so a row never points at a file that is not saved; a write that
 * then fails leaves only an unused file behind, never a broken record.
 */
export function withFileStore(inner: Store, files: FileStore): Store {
  const wrapped: Store = new Proxy(inner, {
    get(target, prop, receiver) {
      const own = Reflect.get(target, prop, receiver);
      switch (prop) {
        case 'get':
          return async (table: string, id: string) => incomingOne(files, table, await (target.get as (t: string, i: string) => Promise<unknown>)(table, id));
        case 'list':
          return async (table: string, filter?: unknown) =>
            incoming(files, table, (await (target.list as (t: string, f?: unknown) => Promise<unknown[]>)(table, filter)) ?? []);
        case 'insert':
          return async (table: string, row: unknown) =>
            (target.insert as (t: string, r: unknown) => Promise<void>)(table, await outgoing(files, table, () => scopeOf(row), row));
        case 'update':
          return async (table: string, id: string, patch: unknown) => {
            // The company of an existing row cannot change, so the stored row tells where its files go. It is read
            // only when the change carries a file.
            const where = async () => scopeOf(await (target.get as (t: string, i: string) => Promise<unknown>)(table, id));
            const saved = await (target.update as (t: string, i: string, p: unknown) => Promise<unknown>)(table, id, await outgoing(files, table, where, patch));
            return incomingOne(files, table, saved);
          };
        case 'createItTicket':
          return async (body: unknown) => target.createItTicket((await outgoing(files, 'itTickets', () => scopeOf(body), body)) as never);
        case 'transaction':
        case 'cleanupTransaction':
          if (typeof own !== 'function') return own;
          return <R>(fn: (s: Store) => Promise<R>) => (own as (f: (s: Store) => Promise<R>) => Promise<R>).call(target, (s: Store) => fn(s === target ? wrapped : withFileStore(s, files)));
        default:
          return typeof own === 'function' ? own.bind(target) : own;
      }
    },
  });
  return wrapped;
}
