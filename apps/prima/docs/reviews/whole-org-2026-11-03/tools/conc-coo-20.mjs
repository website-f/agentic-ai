// 20 home screens for the COO at the same moment; every response is kept raw in the output file.
import fs from 'node:fs';
import { classify, tally } from './classify.mjs';
import { localFetch, orRefuse } from './target.mjs';
// Local API only, checked before any request (Arisha review, 3 Nov 2026).
const api = await orRefuse(() => localFetch(process.env.BASE ?? 'http://localhost:3077'));
const OUT = process.argv[2] ?? 'conc-coo-20.json';
const r = await api('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'u-coo' }) });
const { token } = await r.json();
const t = performance.now();
const rows = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    api('/api/home?companyId=co-sasa', { headers: { authorization: 'Bearer ' + token } }).then(async (x) => {
      const body = await x.text();
      return { i, status: x.status, kind: classify(x.status), ms: Math.round(performance.now() - t), bytes: body.length, errorBody: x.status === 200 ? null : body.slice(0, 300) };
    }),
  ),
);
const out = { at: new Date().toISOString(), base: process.env.BASE ?? 'http://localhost:3077', path: '/api/home?companyId=co-sasa', user: 'u-coo (synthetic)', tally: tally(rows), rows };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.tally));
for (const x of rows) console.log(x.status, x.kind, x.ms, 'ms', x.errorBody ?? '');
