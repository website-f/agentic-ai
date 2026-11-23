// The tender watcher (Marketing item AH11, Fauzan 22-23 Nov 2026: "1 tender watcher to find tender", "Use system more
// than ai"). Once a day, while TENDER_WATCHER_ENABLED=true, the server reads the public pages of the tender sites the
// Marketing Manager or Deputy allowed after reading each site's terms, and lists the guarding notices by fixed rules
// (packages/core/src/tender-watcher.ts). No AI, no logins, no forms, no cookies, no files: one plain GET of each page the
// site's robots file allows, at most one request every few seconds to a site, https only, never to a private address.
//
//   TENDER_WATCHER_ENABLED=true        switch (off unless exactly "true")
//   TENDER_WATCHER_USER_ID             the system sign-in (default u-tender-watcher, integration tender_watcher)
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { WATCHER_AGENT, robotsAllows, watchPage, type TenderWatchOutcome, type WatchCandidate } from '@prima/core';
import { Db } from './db';

export type PageGet = (url: string) => Promise<{ status: number; type: string; body: string; location: string | null }>;
export type Wait = (ms: number) => Promise<void>;

export const WATCHER_USER_AGENT = `${WATCHER_AGENT}/1.0 (public tender notices only)`;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 20_000;
/** Pause between two requests to the same site. */
export const WATCHER_PAUSE_MS = 5_000;

/** Loopback, private, link-local, shared, multicast and other non-public addresses are never contacted. */
export function publicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return publicAddress(mapped[1]);
    return !(x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8'));
  }
  return false;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;
/** DNS lookup that refuses a name pointing at any non-public address; used for the connection itself, so it cannot be switched. */
export function safeLookup(hostname: string, options: { all?: boolean } | number | LookupCb, cb?: LookupCb) {
  const done = (typeof options === 'function' ? options : cb) as LookupCb;
  const all = typeof options === 'object' && options?.all === true;
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return done(err, '');
    if (!addrs.length || addrs.some((a) => !publicAddress(a.address))) return done(Object.assign(new Error('NOT_PUBLIC_ADDRESS'), { code: 'NOT_PUBLIC_ADDRESS' }), '');
    if (all) return done(null, addrs);
    done(null, addrs[0].address, addrs[0].family);
  });
}

/** One plain GET over https: no cookies, no credentials, size and time capped. */
export const httpsGet: PageGet = (url) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || isIP(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('NOT_ALLOWED_URL'));
    const req = request(
      u,
      { method: 'GET', lookup: safeLookup as never, timeout: TIMEOUT_MS, headers: { 'User-Agent': WATCHER_USER_AGENT, Accept: 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity' } },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('TOO_LARGE'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers['content-type'] ?? '').toLowerCase(),
            body: Buffer.concat(chunks).toString('utf8'),
            location: typeof res.headers.location === 'string' ? res.headers.location : null,
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });

const why = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  if (m === 'NOT_PUBLIC_ADDRESS') return 'not a public address';
  if (m === 'TIMEOUT') return 'no answer in 20 s';
  if (m === 'TOO_LARGE') return 'page over 1.5 MB';
  return 'could not open';
};

/** Reads one site: its robots file once per host, then each listed page the robots file allows. */
export async function readSite(urls: string[], get: PageGet, wait: Wait) {
  const pages: { url: string; outcome: TenderWatchOutcome; note: string }[] = [];
  const finds: WatchCandidate[] = [];
  const robots = new Map<string, string | null>();
  let first = true;
  const pause = async () => {
    if (!first) await wait(WATCHER_PAUSE_MS);
    first = false;
  };
  const robotsFor = async (origin: string) => {
    if (robots.has(origin)) return robots.get(origin)!;
    await pause();
    let txt: string | null;
    try {
      const r = await get(`${origin}/robots.txt`);
      txt = r.status === 200 ? r.body : r.status === 404 || r.status === 410 ? '' : null;
    } catch {
      txt = null;
    }
    robots.set(origin, txt);
    return txt;
  };
  for (const url of urls) {
    try {
      let at = new URL(url);
      const host = at.host;
      let page: Awaited<ReturnType<PageGet>> | null = null;
      let outcome: { outcome: TenderWatchOutcome; note: string } | null = null;
      for (let hop = 0; hop < 4 && !page && !outcome; hop++) {
        const txt = await robotsFor(at.origin);
        if (txt === null) outcome = { outcome: 'NOT_ALLOWED', note: 'robots file could not be read' };
        else if (!robotsAllows(txt, at.pathname + at.search)) outcome = { outcome: 'NOT_ALLOWED', note: 'robots file does not allow it' };
        else {
          await pause();
          const r = await get(at.toString());
          if (r.status >= 300 && r.status < 400 && r.location) {
            const next = new URL(r.location, at);
            if (next.protocol !== 'https:' || next.host !== host) outcome = { outcome: 'ERROR', note: 'moved to another site' };
            else at = next;
          } else page = r;
        }
      }
      if (!outcome && !page) outcome = { outcome: 'ERROR', note: 'too many redirects' };
      if (!outcome && page) {
        if (page.status !== 200) outcome = { outcome: 'ERROR', note: `HTTP ${page.status}` };
        else if (!/text\/html|application\/xhtml|text\/plain/.test(page.type)) outcome = { outcome: 'NOT_HTML', note: page.type.split(';')[0] || 'not a web page' };
        else {
          const got = watchPage(page.body, at.toString());
          finds.push(...got);
          outcome = { outcome: 'READ', note: `${got.length} guarding notice(s)` };
        }
      }
      pages.push({ url, ...outcome! });
    } catch (e) {
      pages.push({ url, outcome: 'ERROR', note: why(e) });
    }
  }
  return { pages, finds };
}

export function tenderWatcherOn(env: NodeJS.ProcessEnv = process.env) {
  return env.TENDER_WATCHER_ENABLED?.trim() === 'true';
}
const userId = () => process.env.TENDER_WATCHER_USER_ID?.trim() || 'u-tender-watcher';

/** One pass over every allowed site. A site that fails does not stop the others. */
export async function runTenderWatcher(db: Db, get: PageGet = httpsGet, wait: Wait = (ms) => new Promise((r) => setTimeout(r, ms)), clock?: () => string) {
  const plan = await db.asUser(userId(), (svc, u) => svc.tenderWatchPlan(u), clock);
  const out: { id: string; read: number; pages: number; fresh: number }[] = [];
  for (const site of plan) {
    const res = await readSite(site.urls, get, wait);
    try {
      out.push(await db.asUser(userId(), (svc, u) => svc.recordTenderWatch(u, site.id, res), clock));
    } catch (e) {
      console.error(`Tender watcher: ${site.buyer}: ${e instanceof Error ? e.message : 'not recorded'}`);
    }
  }
  return out;
}

/** Runs 15 minutes after the server starts, then every 24 hours, while the switch is on. Off otherwise. */
@Injectable()
export class TenderWatcherRunner implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  constructor(private db: Db) {}
  onModuleInit() {
    if (!tenderWatcherOn()) return;
    const tick = () => void runTenderWatcher(this.db).catch((e: unknown) => console.error(`Tender watcher: ${e instanceof Error ? e.message : 'failed'}`));
    const first = setTimeout(tick, 15 * 60_000);
    const daily = setInterval(tick, 24 * 3_600_000);
    first.unref();
    daily.unref();
    this.timers.push(first, daily);
  }
  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }
}
