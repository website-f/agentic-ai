// Shift change as if every guard used Prima (Fauzan, 3 Nov 2026). Synthetic data, local API and database only.
// 1) per-table database reads for one guard's Duty screen and one clock-in; 2) waves of guards opening Duty at once;
// 3) waves of site devices clocking guards in at once. Results: argv[2] (JSON).
import fs from 'node:fs';
import { connectLocalDb, localFetch, orRefuse } from './target.mjs';
import { classify, tally } from './classify.mjs';
// Fail closed before any connection or request (Arisha review, 3 Nov 2026): local API and local disposable database only.
const api = await orRefuse(() => localFetch(process.env.BASE ?? 'http://localhost:3077'));
const OUT = process.argv[2] ?? 'guard-load.json';
const db = await orRefuse(() => connectLocalDb(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/prima_stress'));
const login = async (userId) => {
  const r = await api('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  if (!r.ok) throw new Error(`login ${userId} ${r.status}`);
  return (await r.json()).token;
};
const call = async (token, method, path, body) => {
  const t = performance.now();
  const r = await api(path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, kind: classify(r.status), ms: Math.round(performance.now() - t), kb: Math.round(text.length / 1024), err: r.ok ? null : text.slice(0, 160) };
};
const snap = async () => new Map((await db.query('select relname, seq_tup_read, idx_tup_fetch from pg_stat_user_tables')).rows.map((r) => [r.relname, r]));
const diff = (a, z) =>
  [...z.entries()]
    .map(([k, v]) => ({ t: k, rows: v.seq_tup_read - a.get(k).seq_tup_read + ((v.idx_tup_fetch ?? 0) - (a.get(k).idx_tup_fetch ?? 0)) }))
    .filter((x) => x.rows > 0)
    .sort((p, q) => q.rows - p.rows)
    .slice(0, 8);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { at: new Date().toISOString(), one: {}, duty: [], clock: [] };

// Guards with a shift today, and the device for that shift's site.
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const rows = (
  await db.query(
    `SELECT DISTINCT ON (s.data->>'personId') s.data->>'personId' AS pid, s.data->>'siteId' AS site, p.data->>'staffNo' AS staff
     FROM prima.shifts s JOIN prima.people p ON p.id = s.data->>'personId'
     WHERE s.data->>'date' = $1 AND p.data->>'role' = 'guard' AND p.data->>'status' = 'active'
       AND NOT EXISTS (SELECT 1 FROM prima.attendance a WHERE a.data->>'personId' = p.id AND a.data->>'clockOut' IS NULL AND a.data->>'clockIn' IS NOT NULL)
     ORDER BY s.data->>'personId'`,
    [today],
  )
).rows;
console.log('guards with a shift today, not clocked in:', rows.length);

// 1) One guard, one clock-in: database rows read.
{
  const g = rows[0];
  const tok = await login('u-g-' + g.pid);
  await pause(1500);
  let a = await snap();
  out.one.duty = await call(tok, 'GET', '/api/me/duty');
  await pause(1500);
  out.one.dutyTables = diff(a, await snap());
  const dev = await login('u-d-' + g.site);
  await pause(1500);
  a = await snap();
  out.one.clockIn = await call(dev, 'POST', '/api/device/clock-in', { staffNo: g.staff, face: null, lat: null, lng: null });
  await pause(1500);
  out.one.clockInTables = diff(a, await snap());
  console.log('one duty', out.one.duty, out.one.dutyTables.slice(0, 4));
  console.log('one clock-in', out.one.clockIn, out.one.clockInTables.slice(0, 4));
}

// 2) Waves of guards opening their Duty screen at the same moment.
let next = 1;
for (const n of [50, 100, 200]) {
  const who = rows.slice(next, next + n);
  next += n;
  const toks = [];
  for (const g of who) toks.push(await login('u-g-' + g.pid));
  const t = performance.now();
  const rs = await Promise.all(toks.map((k) => call(k, 'GET', '/api/me/duty')));
  const ms = rs.map((r) => r.ms).sort((x, y) => x - y);
  const w = { n, wallMs: Math.round(performance.now() - t), p50: ms[Math.floor(n / 2)], p95: ms[Math.floor(n * 0.95) - 1], max: ms.at(-1), tally: tally(rs), errors: [...new Set(rs.filter((r) => r.err).map((r) => `${r.status} ${r.err}`))].slice(0, 3) };
  out.duty.push(w);
  console.log('duty x', n, w);
}

// 3) Waves of devices clocking different guards in at the same moment.
for (const n of [50, 100, 200]) {
  const who = rows.slice(next, next + n);
  next += n;
  const toks = new Map();
  for (const g of who) if (!toks.has(g.site)) toks.set(g.site, await login('u-d-' + g.site));
  const t = performance.now();
  const rs = await Promise.all(who.map((g) => call(toks.get(g.site), 'POST', '/api/device/clock-in', { staffNo: g.staff, face: null, lat: null, lng: null })));
  const ms = rs.map((r) => r.ms).sort((x, y) => x - y);
  const w = { n, wallMs: Math.round(performance.now() - t), p50: ms[Math.floor(n / 2)], p95: ms[Math.floor(n * 0.95) - 1], max: ms.at(-1), tally: tally(rs), errors: [...new Set(rs.filter((r) => r.err).map((r) => `${r.status} ${r.err}`))].slice(0, 3) };
  out.clock.push(w);
  console.log('clock-in x', n, w);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
await db.end();
