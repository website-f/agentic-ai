/**
 * P148d (speed): a Server-Timing header on every answer, so where a slow screen spends its time can be read on the live
 * server (browser dev tools, or nginx logging $upstream_http_server_timing) without a profiler:
 *   prima       the whole request inside the API (routing, the person's checks, the work, JSON);
 *   prima-db    the time at least one database query was waiting for its answer, with the number of queries;
 *   prima-pool  the wait for a free database connection.
 * What is left of `prima` after `prima-db` and `prima-pool` is the API's own work (mostly turning rows into screens).
 * Only durations and a count: no names, ids or query text.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

type Timing = { start: bigint; queries: number; inFlight: number; since: bigint; dbNs: bigint; poolNs: bigint };

const timing = new AsyncLocalStorage<Timing>();
const ms = (ns: bigint): string => (Number(ns) / 1e6).toFixed(1);

/** Express middleware: counts this request's database time and writes the header just before the answer goes out. */
export function serverTiming(_req: Request, res: Response, next: NextFunction): void {
  const t: Timing = { start: process.hrtime.bigint(), queries: 0, inFlight: 0, since: 0n, dbNs: 0n, poolNs: 0n };
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: unknown[]) {
    if (!res.headersSent) {
      const total = process.hrtime.bigint() - t.start;
      res.setHeader('Server-Timing', `prima;dur=${ms(total)}, prima-db;dur=${ms(t.dbNs)};desc="${t.queries} queries", prima-pool;dur=${ms(t.poolNs)}`);
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as Response['writeHead'];
  timing.run(t, next);
}

/** The wait for a pooled connection, counted on the request that waited. */
export async function timedConnect<C>(connect: () => Promise<C>): Promise<C> {
  const t = timing.getStore();
  if (!t) return connect();
  const at = process.hrtime.bigint();
  try {
    return await connect();
  } finally {
    t.poolNs += process.hrtime.bigint() - at;
  }
}

const WRAPPED = Symbol('prima.serverTiming');

/**
 * Counts the queries a pooled connection runs for the request in progress. Wrapped once per connection (connections are
 * reused); a query outside any request (start-up checks, scheduled runs) is not counted and runs exactly as before.
 */
export function timeQueries<C extends { query: (...a: never[]) => unknown }>(client: C): C {
  const c = client as C & { [WRAPPED]?: true };
  if (c[WRAPPED]) return client;
  const query = c.query;
  c.query = function (this: C, ...args: never[]) {
    const out = query.apply(this, args);
    const t = timing.getStore();
    if (!t || !out || typeof (out as Promise<unknown>).then !== 'function') return out;
    t.queries++;
    if (t.inFlight++ === 0) t.since = process.hrtime.bigint();
    const done = () => {
      if (--t.inFlight === 0) t.dbNs += process.hrtime.bigint() - t.since;
    };
    (out as Promise<unknown>).then(done, done);
    return out;
  } as C['query'];
  c[WRAPPED] = true;
  return client;
}
