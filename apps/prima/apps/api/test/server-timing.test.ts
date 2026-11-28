// P148d (speed): the Server-Timing header (server-timing.ts): the request, its database time and query count, the wait
// for a connection; durations and a count only. Queries outside a request run as before and are not counted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { serverTiming, timeQueries, timedConnect } from '../src/server-timing';

describe('Server-Timing', () => {
  it('names the request time, the database time with its query count, and the connection wait', async () => {
    let calls = 0;
    const client = timeQueries({
      async query(_text: string) {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return { rows: [] };
      },
    });
    assert.equal(timeQueries(client), client, 'wrapped once, however often it is checked out');
    await client.query('outside any request');
    const server = createServer((req, res) =>
      serverTiming(req as unknown as Request, res as unknown as Response, (async () => {
        const c = await timedConnect(async () => client);
        await Promise.all([c.query('a'), c.query('b')]);
        await c.query('c');
        res.end('ok');
      }) as unknown as NextFunction),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      const r = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(await r.text(), 'ok');
      const header = r.headers.get('server-timing') ?? '';
      assert.match(header, /^prima;dur=\d+\.\d, prima-db;dur=\d+\.\d;desc="3 queries", prima-pool;dur=\d+\.\d$/);
      const [total, db] = [...header.matchAll(/dur=(\d+\.\d)/g)].map((m) => Number(m[1]));
      assert.ok(db >= 9 && db <= total, 'overlapping queries count once, never more than the request');
      assert.equal(calls, 4, 'every query still ran');
    } finally {
      server.close();
    }
  });
});
