// Runs the real load tools with unsafe destinations and proves they stop before any connection or request
// (Arisha review, 3 Nov 2026). A local listener stands in for "somewhere else" and counts every connection it gets.
// Run: node --test docs/reviews/whole-org-2026-11-03/tools/target.test.mjs   (synthetic, local only)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { localApiBase, localDbConfig, localFetch, Refused } from './target.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
let trap;
let trapPort;
let hits = 0;
before(async () => {
  trap = net.createServer((s) => {
    hits++;
    s.destroy();
  });
  await new Promise((r) => trap.listen(0, '127.0.0.1', r));
  trapPort = trap.address().port;
});
after(() => trap.close());

const run = (tool, env) =>
  new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'BASE' && k !== 'DATABASE_URL' && k !== 'STRESS_DISPOSABLE_DB'));
    const p = spawn(process.execPath, [dir + tool, dir + '../evidence/should-not-exist.json'], { env: { ...clean, ...env } });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, err }));
  });

describe('load tools refuse unsafe destinations before connecting', () => {
  const ok = { STRESS_DISPOSABLE_DB: 'yes' };
  const cases = [
    ['pgload.mjs', { ...ok, DATABASE_URL: `postgres://postgres@localhost:5432/prima_stress?host=127.0.0.1&port=${0}` }, /query settings/],
    ['pgload.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@db.example.com:5432/prima_stress' }, /local database only/],
    ['pgload.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@localhost:5432/prima' }, /database name/],
    ['pgload.mjs', { DATABASE_URL: 'postgres://postgres@localhost:5432/prima_stress' }, /STRESS_DISPOSABLE_DB/],
    ['pgload.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@localhost:5432/prima_stress', PGHOST: '127.0.0.1' }, /unset PGHOST/],
    ['guardsetup.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@localhost:5432/prima_stress?host=127.0.0.1&port=PORT' }, /query settings/],
    ['guardsetup.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@localhost:5432/prima_stress?hostaddr=127.0.0.1' }, /query settings/],
    ['guardload.mjs', { ...ok, BASE: 'http://127.0.0.2:PORT' }, /local API only/],
    ['guardload.mjs', { ...ok, BASE: 'http://localhost:PORT/?next=http://example.com' }, /server address only/],
    ['guardload.mjs', { ...ok, BASE: 'http://user:pw@localhost:PORT' }, /user info/],
    ['guardload.mjs', { ...ok, DATABASE_URL: 'postgres://postgres@localhost:PORT/prima_stress?host=127.0.0.1' }, /query settings/],
    ['conc-coo-20.mjs', { BASE: 'http://127.0.0.2:PORT' }, /local API only/],
    ['conc-coo-20.mjs', { BASE: 'https://localhost:PORT' }, /plain http/],
  ];
  for (const [tool, env, why] of cases) {
    it(`${tool} ${JSON.stringify(env).replace(/"STRESS_DISPOSABLE_DB":"yes",?/, '')}`, async () => {
      const e = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replaceAll('PORT', String(trapPort))]));
      const before = hits;
      const r = await run(tool, e);
      assert.equal(r.code, 2, r.err);
      assert.match(r.err, why);
      assert.equal(hits, before, 'no connection was made');
    });
  }
});

describe('target checks', () => {
  it('accepts only plain local destinations', () => {
    const env = { STRESS_DISPOSABLE_DB: 'yes' };
    assert.deepEqual(localDbConfig('postgres://postgres:pw@localhost:5432/prima_stress', env), { host: 'localhost', port: 5432, database: 'prima_stress', user: 'postgres', password: 'pw' });
    for (const u of ['postgres://x@localhost/prima_stress?options=-c', 'postgres://x@localhost/prima_stress#h', 'mysql://localhost/prima_stress', 'postgres://x@127.0.0.2/prima_stress', 'postgres://x@localhost/prima_stressx;drop'])
      assert.throws(() => localDbConfig(u, env), Refused, u);
    assert.equal(localApiBase('http://localhost:3077'), 'http://localhost:3077');
    assert.equal(localApiBase('http://[::1]:3077/'), 'http://[::1]:3077');
    for (const b of ['http://localhost.evil.example:3077', 'http://0.0.0.0:3077', 'file:///etc/passwd', 'http://localhost:3077/api'])
      assert.throws(() => localApiBase(b), Refused, b);
  });

  it('refuses a redirect from the local API to anywhere else', async () => {
    const hop = http.createServer((_q, s) => {
      s.writeHead(302, { location: `http://127.0.0.1:${trapPort}/x` });
      s.end();
    });
    await new Promise((r) => hop.listen(0, '127.0.0.1', r));
    const before = hits;
    const api = localFetch(`http://127.0.0.1:${hop.address().port}`);
    await assert.rejects(api('/api/home'));
    assert.throws(() => api('//evil.example/api/x'), Refused);
    assert.throws(() => api('https://evil.example/api/x'), Refused);
    assert.equal(hits, before);
    hop.close();
  });
});
