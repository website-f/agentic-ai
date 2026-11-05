import { ORG_FLOWS } from '/home/claude/prima-secure-app/packages/core/dist/index.js';
const by = {};
for (const f of ORG_FLOWS) { by[f.status ?? f.state ?? '?'] = (by[f.status ?? f.state ?? '?'] || 0) + 1; }
console.log(by, ORG_FLOWS.length);
for (const f of ORG_FLOWS) console.log([f.id, f.status ?? f.state, f.from, '->', (f.to||f.lines||[]).map?.(x=>x.desk||x).join('/'), f.label ?? f.title].join(' | '));
