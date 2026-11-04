// Live monthly price estimate for Prima staging, from Microsoft's public Azure Retail Prices API (Southeast Asia, USD,
// pay-as-you-go list prices). For information only: the earlier fixed RM 300 cap was withdrawn by the CEO (28 Oct 2026),
// so it never blocks anything. It warns when an item cannot be priced, and when the month (with 8% service tax at a
// cautious exchange rate) is above NOTICE_MYR, so the figure is looked at. The Azure budget alerts stay in place.
// Usage: node infra/staging-price.mjs   (NOTICE_MYR and USD_MYR may be set to override 300 and 4.70)
const REGION = 'southeastasia';
const NOTICE_MYR = Number(process.env.NOTICE_MYR ?? 300);
const USD_MYR = Number(process.env.USD_MYR ?? 4.7);
const TAX = 0.08;
const HOURS = 730;
const ACTIVE_HOURS = 50; // busy hours a month for the API; the rest of the month one copy is kept idle
const API_VCPU = 0.5;
const API_GIB = 1;
const JOB_SECONDS = 20 * 60; // 20 setup-job runs a month, about a minute each

/** Each line of the bill: what it is, how to find its meter, and how much of it a month in the meter's base unit. */
const ITEMS = [
  {
    name: 'Database computer: PostgreSQL Flexible Server Burstable B1ms, 730 h',
    filter: `serviceName eq 'Azure Database for PostgreSQL'`,
    pick: (r) => /flexible/i.test(r.productName) && /burstable/i.test(r.productName) && /\bb1ms\b/i.test(`${r.skuName} ${r.meterName}`),
    qty: { hour: HOURS },
  },
  {
    name: 'Database disk: 32 GiB',
    filter: `serviceName eq 'Azure Database for PostgreSQL'`,
    pick: (r) => /flex/i.test(r.productName) && /storage/i.test(r.productName) && /data stored/i.test(r.meterName) && !/backup|snapshot|ssd v2|premium ssd v2/i.test(`${r.productName} ${r.meterName}`),
    qty: { 'gb/month': 32 },
  },
  {
    name: 'API kept awake: idle 0.5 vCPU',
    filter: `serviceName eq 'Azure Container Apps' and contains(meterName,'Idle')`,
    pick: (r) => /vcpu idle/i.test(r.meterName) && !/dedicated|flex/i.test(`${r.meterName} ${r.productName}`),
    qty: { second: (HOURS - ACTIVE_HOURS) * 3600 * API_VCPU, hour: (HOURS - ACTIVE_HOURS) * API_VCPU },
  },
  {
    name: 'API kept awake: idle 1 GiB memory',
    filter: `serviceName eq 'Azure Container Apps' and contains(meterName,'Idle')`,
    pick: (r) => /memory idle/i.test(r.meterName) && !/dedicated|flex/i.test(`${r.meterName} ${r.productName}`),
    qty: { 'gib second': (HOURS - ACTIVE_HOURS) * 3600 * API_GIB, second: (HOURS - ACTIVE_HOURS) * 3600 * API_GIB },
  },
  {
    name: 'API busy hours and setup job: vCPU',
    filter: `serviceName eq 'Azure Container Apps' and contains(meterName,'Active')`,
    pick: (r) => /vcpu active/i.test(r.meterName) && !/dedicated|flex/i.test(`${r.meterName} ${r.productName}`),
    qty: { second: ACTIVE_HOURS * 3600 * API_VCPU + JOB_SECONDS * 0.5, hour: ACTIVE_HOURS * API_VCPU + (JOB_SECONDS * 0.5) / 3600 },
  },
  {
    name: 'API busy hours and setup job: memory',
    filter: `serviceName eq 'Azure Container Apps' and contains(meterName,'Active')`,
    pick: (r) => /memory active/i.test(r.meterName) && !/dedicated|flex/i.test(`${r.meterName} ${r.productName}`),
    qty: { 'gib second': ACTIVE_HOURS * 3600 * API_GIB + JOB_SECONDS, second: ACTIVE_HOURS * 3600 * API_GIB + JOB_SECONDS },
  },
  {
    name: 'Image store: Container Registry Basic',
    filter: `serviceName eq 'Container Registry' and skuName eq 'Basic'`,
    pick: (r) => /registry unit/i.test(r.meterName),
    qty: { day: HOURS / 24 },
  },
  {
    name: 'Passwords vault: Key Vault Standard, 10,000 operations',
    filter: `serviceName eq 'Key Vault' and skuName eq 'Standard'`,
    pick: (r) => /^operations$/i.test(r.meterName),
    qty: { '': 10_000 },
  },
  {
    name: 'Files: Blob Storage Hot LRS, 5 GiB',
    filter: `serviceName eq 'Storage' and skuName eq 'Hot LRS' and contains(productName,'General Block Blob v2')`,
    pick: (r) => /hot lrs data stored/i.test(r.meterName) && !/hierarchical/i.test(r.productName),
    qty: { 'gb/month': 5 },
  },
  {
    name: 'Private database address: Private DNS zone',
    filter: `serviceName eq 'Azure DNS' and contains(meterName,'Private Zone')`,
    pick: () => true,
    qty: { month: 1, '': 1 },
    anyRegion: true,
  },
];

/** Free under Microsoft's monthly allowances or free services; shown so the bill is complete. */
const FREE = [
  'Logs: Log Analytics, about 3 GiB a month (first 5 GiB a month free)',
  'Internet traffic out: about 5 GiB a month (first 100 GiB a month free)',
  'Website: Static Web Apps Free plan',
  'Virtual network, identities, database backups up to the disk size',
  'API requests: about 1 million a month (first 2 million free)',
];

async function rows(filter, anyRegion) {
  const full = anyRegion ? filter : `armRegionName eq '${REGION}' and ${filter}`;
  let url = `https://prices.azure.com/api/retail/prices?currencyCode='USD'&$filter=${encodeURIComponent(`${full} and priceType eq 'Consumption'`)}`;
  const out = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Azure price list answered ${res.status} for: ${full}`);
    const body = await res.json();
    out.push(...body.Items);
    url = body.NextPageLink;
  }
  return out.filter((r) => !/reservation|devtest|low priority|spot/i.test(`${r.type} ${r.skuName} ${r.productName} ${r.meterName}`));
}

/** "1 Hour" -> {size: 1, unit: 'hour'}; "10K" -> {size: 10000, unit: ''}; "1 GB/Month" -> {size: 1, unit: 'gb/month'}. */
function unitOf(uom) {
  const m = /^([\d.]+)([KM]?)\s*(.*)$/i.exec(uom.trim());
  if (!m) return null;
  const size = Number(m[1]) * (m[2].toUpperCase() === 'K' ? 1e3 : m[2].toUpperCase() === 'M' ? 1e6 : 1);
  const unit = m[3].replace(/^\/+/, '').trim().toLowerCase().replace(/s$/, '');
  return { size, unit };
}

/** Cost of qty units on a meter whose price rows may be tiered (tierMinimumUnits, in the meter's unit). */
function tiered(meterRows, qtyUnits) {
  const tiers = [...meterRows].sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
  let cost = 0;
  tiers.forEach((t, i) => {
    const from = t.tierMinimumUnits;
    const to = i + 1 < tiers.length ? tiers[i + 1].tierMinimumUnits : Infinity;
    const used = Math.max(0, Math.min(qtyUnits, to) - from);
    cost += used * t.unitPrice;
  });
  return cost;
}

const lines = [];
const problems = [];
for (const item of ITEMS) {
  const found = (await rows(item.filter, item.anyRegion)).filter(item.pick);
  const byMeter = new Map();
  for (const r of found) byMeter.set(r.meterId, [...(byMeter.get(r.meterId) ?? []), r]);
  // The meter whose unit we can measure; one meter per item.
  const choice = [...byMeter.values()].find((rs) => {
    const u = unitOf(rs[0].unitOfMeasure);
    return u && Object.hasOwn(item.qty, u.unit);
  });
  if (!choice) {
    problems.push(item.name);
    console.log(`\n!! Not priced: ${item.name}. Candidates:`);
    const all = found.length ? found : await rows(item.filter, item.anyRegion);
    const seen = new Set();
    for (const r of all) {
      const k = `${r.productName} | ${r.skuName} | ${r.meterName} | ${r.unitOfMeasure}`;
      if (seen.has(k) || seen.size >= 40) continue;
      seen.add(k);
      console.log(`   ${k} | ${r.unitPrice} | tier ${r.tierMinimumUnits}`);
    }
    continue;
  }
  const u = unitOf(choice[0].unitOfMeasure);
  const qtyUnits = item.qty[u.unit] / u.size;
  const usd = tiered(choice, qtyUnits);
  lines.push({ name: item.name, usd, meter: `${choice[0].productName} / ${choice[0].meterName}`, price: choice.map((r) => `${r.unitPrice} per ${r.unitOfMeasure}${r.tierMinimumUnits ? ` from ${r.tierMinimumUnits}` : ''}`).join('; ') });
}

console.log(`\nPrima staging, monthly estimate from the Azure Retail Prices API (${REGION}, USD list prices, ${new Date().toISOString().slice(0, 10)})\n`);
for (const l of lines) console.log(`${l.usd.toFixed(2).padStart(8)}  ${l.name}\n          meter: ${l.meter}; price: ${l.price}`);
for (const f of FREE) console.log(`${'0.00'.padStart(8)}  ${f}`);
const usd = lines.reduce((s, l) => s + l.usd, 0);
const withTax = usd * (1 + TAX);
const myr = withTax * USD_MYR;
console.log(`\n${usd.toFixed(2).padStart(8)}  USD a month before tax`);
console.log(`${withTax.toFixed(2).padStart(8)}  USD a month with ${TAX * 100}% service tax`);
console.log(`${myr.toFixed(2).padStart(8)}  RM a month at a cautious RM ${USD_MYR.toFixed(2)} per USD (review above RM ${NOTICE_MYR})`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [`### Prima staging monthly estimate (${REGION})`, '', '| USD | Item |', '| ---: | --- |', ...lines.map((l) => `| ${l.usd.toFixed(2)} | ${l.name} |`), ...FREE.map((f) => `| 0.00 | ${f} |`), `| **${usd.toFixed(2)}** | **Before tax** |`, `| **${withTax.toFixed(2)}** | **With ${TAX * 100}% tax** |`, '', `About **RM ${myr.toFixed(0)}** a month at RM ${USD_MYR.toFixed(2)} per USD; flagged for review above RM ${NOTICE_MYR} (information only).`, ''].join('\n'),
  );
}
// Information only: nothing here stops a deployment.
if (problems.length) console.log(`\n::warning::Could not price ${problems.length} item(s); the total above leaves them out.`);
if (myr > NOTICE_MYR) console.log(`\n::warning::The estimate of RM ${myr.toFixed(2)} a month is above RM ${NOTICE_MYR}; please review it.`);
else console.log(`\nAt or below RM ${NOTICE_MYR}.`);
