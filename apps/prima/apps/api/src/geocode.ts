// P81 (staff check-in by place): address search and street-address lookup through OpenStreetMap Nominatim, from this
// server only (the browser never calls it). Nominatim's usage policy: an identifying User-Agent, at most one request a
// second, results cached, no search-as-you-type. So every call here goes through one queue that starts at most one
// request a second, the same question is asked once (in flight and cached), and a long queue is refused, not grown.
// NOMINATIM_URL points at a self-hosted Nominatim when the group runs one; NOMINATIM_CONTACT is the contact e-mail
// sent with each request; GEOCODE_ENABLED=false switches lookups off (addresses then show as "not looked up").

export interface GeoPlace {
  label: string;
  lat: number;
  lng: number;
  /** Nominatim's type for the result (building, road, city ...), for the list. */
  kind: string;
}

export interface GeocoderOptions {
  enabled?: boolean;
  baseUrl?: string;
  userAgent?: string;
  contact?: string | null;
  /** Countries searched (ISO codes, comma separated); Malaysia by default. */
  countries?: string;
  minIntervalMs?: number;
  ttlMs?: number;
  failTtlMs?: number;
  maxEntries?: number;
  maxQueue?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Too many lookups are already waiting: try again in a moment. */
export class GeocodeBusy extends Error {
  constructor() {
    super('Address search is busy. Try again in a few seconds.');
  }
}

/** Lookups are switched off on this server. */
export class GeocodeOff extends Error {
  constructor() {
    super('Address search is switched off on this server. Drop the pin on the map instead.');
  }
}

const SEARCH_MIN = 3;
const SEARCH_MAX = 200;

/** Same question, same key: spaces and case do not make a new request. */
export function searchKey(q: string): string {
  return `s:${q.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** Points within about 11 m share an address (4 decimal places), so a group checking in at one door asks once. */
export function reverseKey(lat: number, lng: number): string {
  return `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export class Geocoder {
  readonly enabled: boolean;
  private readonly base: string;
  private readonly ua: string;
  private readonly contact: string | null;
  private readonly countries: string;
  private readonly minIntervalMs: number;
  private readonly ttlMs: number;
  private readonly failTtlMs: number;
  private readonly maxEntries: number;
  private readonly maxQueue: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache = new Map<string, { until: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private chain: Promise<void> = Promise.resolve();
  private nextAt = 0;
  private waiting = 0;
  /** Requests actually sent to Nominatim, and answers served from the cache (for the readiness page and tests). */
  readonly stats = { sent: 0, cached: 0, refused: 0 };

  constructor(o: GeocoderOptions = {}) {
    this.enabled = o.enabled !== false;
    this.base = (o.baseUrl || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
    this.contact = o.contact?.trim() || null;
    this.ua = o.userAgent || `PrimaSecure/1.0 (staff check-in; Agentic Office${this.contact ? `; ${this.contact}` : ''})`;
    this.countries = (o.countries ?? 'my').replace(/[^a-z,]/gi, '').toLowerCase();
    this.minIntervalMs = o.minIntervalMs ?? 1_000;
    this.ttlMs = o.ttlMs ?? 7 * 24 * 3_600_000;
    this.failTtlMs = o.failTtlMs ?? 60_000;
    this.maxEntries = o.maxEntries ?? 5_000;
    this.maxQueue = o.maxQueue ?? 30;
    this.timeoutMs = o.timeoutMs ?? 8_000;
    this.fetchFn = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.now = o.now ?? (() => Date.now());
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Places matching a typed address or name (on Enter or the Search button, never per keystroke). */
  async search(q: string): Promise<GeoPlace[]> {
    if (!this.enabled) throw new GeocodeOff();
    const text = q.trim().replace(/\s+/g, ' ');
    if (text.length < SEARCH_MIN || text.length > SEARCH_MAX) return [];
    return this.cached(searchKey(text), async () => {
      const p = new URLSearchParams({ format: 'jsonv2', q: text, limit: '6', addressdetails: '0' });
      if (this.countries) p.set('countrycodes', this.countries);
      const rows = await this.get(`/search?${p}`);
      if (!Array.isArray(rows)) return null;
      return rows
        .map((r: Record<string, unknown>) => ({ label: String(r.display_name ?? ''), lat: Number(r.lat), lng: Number(r.lon), kind: String(r.type ?? r.category ?? '') }))
        .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));
    }).then((v) => (v as GeoPlace[] | null) ?? []);
  }

  /** The street address for a point, or null when none was found or the lookup failed. Never throws. */
  async reverse(lat: number, lng: number): Promise<string | null> {
    if (!this.enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    try {
      const v = await this.cached(reverseKey(lat, lng), async () => {
        const p = new URLSearchParams({ format: 'jsonv2', lat: lat.toFixed(4), lon: lng.toFixed(4), zoom: '18', addressdetails: '0' });
        const r = (await this.get(`/reverse?${p}`)) as Record<string, unknown> | null;
        if (!r || typeof r !== 'object') return null;
        return typeof r.display_name === 'string' && r.display_name ? r.display_name.slice(0, 300) : '';
      });
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  }

  /** One answer per key: from the cache, from a request already running, or from a new queued request. */
  private async cached<T>(key: string, run: () => Promise<T | null>): Promise<T | null> {
    const hit = this.cache.get(key);
    if (hit && hit.until > this.now()) {
      // Keep the most used answers at the end (least recently used goes first).
      this.cache.delete(key);
      this.cache.set(key, hit);
      this.stats.cached++;
      return hit.value as T | null;
    }
    const running = this.inflight.get(key);
    if (running) return running as Promise<T | null>;
    const p = (async () => {
      await this.slot();
      let value: T | null = null;
      try {
        value = await run();
      } catch {
        value = null;
      }
      // A failed lookup (null) is remembered briefly so a burst does not hammer the service; a real answer for a week.
      this.remember(key, value, value === null ? this.failTtlMs : this.ttlMs);
      return value;
    })();
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  private remember(key: string, value: unknown, ttl: number): void {
    this.cache.delete(key);
    this.cache.set(key, { until: this.now() + ttl, value });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
  }

  /** Waits for this request's turn: requests start at least minIntervalMs apart, across every user. */
  private slot(): Promise<void> {
    if (this.waiting >= this.maxQueue) {
      this.stats.refused++;
      return Promise.reject(new GeocodeBusy());
    }
    this.waiting++;
    const turn = this.chain.then(async () => {
      const wait = this.nextAt - this.now();
      if (wait > 0) await this.sleep(wait);
      this.nextAt = this.now() + this.minIntervalMs;
    });
    this.chain = turn.catch(() => undefined);
    return turn.finally(() => {
      this.waiting--;
    });
  }

  private async get(path: string): Promise<unknown> {
    const url = `${this.base}${path}${this.contact ? `&email=${encodeURIComponent(this.contact)}` : ''}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      this.stats.sent++;
      const res = await this.fetchFn(url, { headers: { 'User-Agent': this.ua, Accept: 'application/json', 'Accept-Language': 'en' }, signal: ctl.signal });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

export function geocoderFromEnv(env: NodeJS.ProcessEnv = process.env): Geocoder {
  return new Geocoder({
    enabled: env.GEOCODE_ENABLED?.trim().toLowerCase() !== 'false',
    baseUrl: env.NOMINATIM_URL?.trim() || undefined,
    contact: env.NOMINATIM_CONTACT ?? null,
    countries: env.GEOCODE_COUNTRIES ?? 'my',
  });
}
