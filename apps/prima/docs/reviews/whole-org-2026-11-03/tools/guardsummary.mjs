// Prints a one-screen summary of guardload result files given as arguments.
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('==', f);
  console.log(' one duty', o.one.duty.ms, 'ms', o.one.dutyTables.slice(0, 4).map((x) => x.t + ':' + x.rows).join(' '));
  console.log(' one clock-in', o.one.clockIn.ms, 'ms', o.one.clockInTables.slice(0, 4).map((x) => x.t + ':' + x.rows).join(' '));
  for (const [k, w] of [...o.duty.map((w) => ['duty', w]), ...o.clock.map((w) => ['clock-in', w])])
    console.log(' ', k, 'x' + w.n, 'all done', w.wallMs, 'ms, median', w.p50, 'p95', w.p95, JSON.stringify(w.tally), w.errors.join('|'));
}
