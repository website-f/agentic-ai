import { RULES } from "./rules";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { AmBq } from "./types";
import type { AmBqBrief } from "./types";
import type { AmBqLine } from "./types";
import type { AmBqRoute } from "./types";
import type { AmJobKind } from "./types";
import type { AmQuote } from "./types";
import type { AmWorkOrder } from "./types";
import type { IsoDate } from "./types";
import { BUILDING_WORKS_MEASURES } from "./am-bq-building";
import { NEW_BUILDING_MEASURES } from "./am-bq-building";
import { buildingWorksDraft } from "./am-bq-building";
import { newBuildingDraft } from "./am-bq-building";
import type { BuildingDraft } from "./am-bq-building";
import type { AmBqSection } from "./types";



export interface AmBqMeasure {
  key: string;
  label: string;
  unit: string;
  /** Building BQs: these must be measured before drafting (other kinds need at least one measurement). */
  required?: boolean;
  /** Must also be measured once any of these is measured (e.g. ceiling height once an extension is measured). */
  requiredIf?: string[];
}

interface TemplateItem {
  item: string;
  unit: string;
  qty: (m: Record<string, number>) => number;
}

export interface AmBqTemplate {
  kind: AmJobKind;
  label: string;
  measures: AmBqMeasure[];
  items: TemplateItem[];
  /** Building BQs (Fauzan's sample): lettered sections, workings, notes and a contingency instead of plain items. */
  building?: (m: Record<string, number>) => BuildingDraft;
}

const m = (x: Record<string, number>, k: string) => (Number.isFinite(x[k]) && x[k] > 0 ? x[k] : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Starting items for each kind of job. Quantities come straight from what was measured on site, in the same unit, so
 * no conversion factor is assumed. The team adds, removes or edits lines before submitting.
 */
export const AM_BQ_TEMPLATES: Record<AmJobKind, AmBqTemplate> = {
  PAINTING: {
    kind: 'PAINTING',
    label: 'Painting',
    measures: [
      { key: 'wallArea', label: 'Wall area', unit: 'm2' },
      { key: 'ceilingArea', label: 'Ceiling area', unit: 'm2' },
    ],
    items: [
      { item: 'Surface preparation and sealer coat', unit: 'm2', qty: (x) => m(x, 'wallArea') + m(x, 'ceilingArea') },
      { item: 'Wall emulsion paint, two coats', unit: 'm2', qty: (x) => m(x, 'wallArea') },
      { item: 'Ceiling emulsion paint, two coats', unit: 'm2', qty: (x) => m(x, 'ceilingArea') },
      { item: 'Protect floors and fittings, clean up', unit: 'lot', qty: () => 1 },
    ],
  },
  ROOFING: {
    kind: 'ROOFING',
    label: 'Roof repair',
    measures: [
      { key: 'roofArea', label: 'Roof area to replace', unit: 'm2' },
      { key: 'gutterLength', label: 'Gutter to replace', unit: 'm' },
    ],
    items: [
      { item: 'Remove damaged roof sheets and dispose', unit: 'm2', qty: (x) => m(x, 'roofArea') },
      { item: 'Supply and fix roof sheets', unit: 'm2', qty: (x) => m(x, 'roofArea') },
      { item: 'Supply and fix gutter', unit: 'm', qty: (x) => m(x, 'gutterLength') },
      { item: 'Scaffolding and safety at height', unit: 'lot', qty: () => 1 },
    ],
  },
  PLUMBING: {
    kind: 'PLUMBING',
    label: 'Plumbing',
    measures: [
      { key: 'pipeLength', label: 'Pipe to replace', unit: 'm' },
      { key: 'fittings', label: 'Fittings and valves', unit: 'no.' },
    ],
    items: [
      { item: 'Supply and lay water pipe', unit: 'm', qty: (x) => m(x, 'pipeLength') },
      { item: 'Supply and fix fittings and valves', unit: 'no.', qty: (x) => m(x, 'fittings') },
      { item: 'Pressure test', unit: 'lot', qty: () => 1 },
      { item: 'Make good wall and floor', unit: 'lot', qty: () => 1 },
    ],
  },
  ELECTRICAL: {
    kind: 'ELECTRICAL',
    label: 'Electrical',
    measures: [
      { key: 'points', label: 'Points to rewire', unit: 'no.' },
      { key: 'cableLength', label: 'Cable to replace', unit: 'm' },
    ],
    items: [
      { item: 'Rewire lighting and power points', unit: 'no.', qty: (x) => m(x, 'points') },
      { item: 'Supply and lay cable', unit: 'm', qty: (x) => m(x, 'cableLength') },
      { item: 'Test by a competent person, with certificate', unit: 'lot', qty: () => 1 },
    ],
  },
  AIRCOND: {
    kind: 'AIRCOND',
    label: 'Air-conditioning',
    measures: [{ key: 'units', label: 'Units', unit: 'no.' }],
    items: [
      { item: 'General service of air-conditioning unit', unit: 'no.', qty: (x) => m(x, 'units') },
      { item: 'Check and report on each unit', unit: 'no.', qty: (x) => m(x, 'units') },
    ],
  },
  RENOVATION: {
    kind: 'RENOVATION',
    label: 'Inside renovation (floors, partitions)',
    measures: [
      { key: 'floorArea', label: 'Floor area', unit: 'm2' },
      { key: 'partitionArea', label: 'Partition area', unit: 'm2' },
    ],
    items: [
      { item: 'Demolish and remove existing finishes', unit: 'm2', qty: (x) => m(x, 'floorArea') },
      { item: 'Supply and lay floor tiles', unit: 'm2', qty: (x) => m(x, 'floorArea') },
      { item: 'Supply and erect partition', unit: 'm2', qty: (x) => m(x, 'partitionArea') },
      { item: 'Site clearing and debris disposal', unit: 'lot', qty: () => 1 },
    ],
  },
  LANDSCAPING: {
    kind: 'LANDSCAPING',
    label: 'Landscaping and grass cutting',
    measures: [{ key: 'area', label: 'Area', unit: 'm2' }],
    items: [
      { item: 'Grass cutting', unit: 'm2', qty: (x) => m(x, 'area') },
      { item: 'Trim, collect and dispose of cuttings', unit: 'lot', qty: () => 1 },
    ],
  },
  NEW_BUILDING: { kind: 'NEW_BUILDING', label: 'New building', measures: NEW_BUILDING_MEASURES, items: [], building: newBuildingDraft },
  BUILDING_WORKS: {
    kind: 'BUILDING_WORKS',
    label: 'Building renovation or extension (raise, extend, re-roof)',
    measures: BUILDING_WORKS_MEASURES,
    items: [],
    building: buildingWorksDraft,
  },
  OTHER: { kind: 'OTHER', label: 'Other', measures: [], items: [] },
};

export const AM_JOB_KINDS = Object.keys(AM_BQ_TEMPLATES) as AmJobKind[];

/** Item and unit as one comparable key: case, spaces and punctuation ignored. */
export function bqKey(item: string, unit: string): string {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(item)}|${n(unit)}`;
}

export interface PastRate {
  /** Median rate of the past awarded prices for this item and unit. */
  median: number;
  n: number;
  low: number;
  high: number;
  lastOn: IsoDate;
}

export interface PastPrice {
  item: string;
  unit: string;
  rate: number;
  on: IsoDate;
  contractor: string;
}

/** Every priced line of every finally approved award, from the work orders given. */
export function awardedPrices(orders: AmWorkOrder[]): PastPrice[] {
  const out: PastPrice[] = [];
  for (const w of orders) {
    const bq = w.bq;
    const award = bq?.award;
    if (!bq || !award?.final) continue;
    const quote = bq.quotes.find((q) => q.id === award.quoteId);
    if (!quote) continue;
    const on = (award.coo ?? award.director)?.at.slice(0, 10) ?? award.askedAt.slice(0, 10);
    for (const ql of quote.lines) {
      const line = bq.lines.find((l) => l.id === ql.lineId);
      if (line && ql.rate > 0) out.push({ item: line.item, unit: line.unit, rate: ql.rate, on, contractor: quote.contractor });
    }
  }
  return out;
}

/** Our own past prices by item and unit, only from the last rule months. */
export function pastRates(prices: PastPrice[], today: IsoDate): Map<string, PastRate> {
  const from = addDays(today, -Math.round(RULES.amBq.value.historyMonths * 30.44));
  const groups = new Map<string, PastPrice[]>();
  for (const p of prices) {
    if (p.on < from) continue;
    const k = bqKey(p.item, p.unit);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = new Map<string, PastRate>();
  for (const [k, ps] of groups) {
    const rates = ps.map((p) => p.rate).sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    const median = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
    out.set(k, { median: r2(median), n: rates.length, low: rates[0], high: rates.at(-1)!, lastOn: ps.map((p) => p.on).sort().at(-1)! });
  }
  return out;
}

/** Draft lines from a template and the site measurements. A line gets a rate only when we have paid for it before. */
export function draftBqLines(kind: AmJobKind, measurements: Record<string, number>, rates: Map<string, PastRate>): AmBqLine[] {
  const t = AM_BQ_TEMPLATES[kind];
  if (t.building) return draftBq(kind, measurements, rates).lines;
  return t.items
    .map((it, i) => ({ it, i, qty: r2(it.qty(measurements)) }))
    .filter((x) => x.qty > 0)
    .map(({ it, i, qty }) => {
      const past = rates.get(bqKey(it.item, it.unit));
      return {
        id: `L${i + 1}`,
        item: it.item,
        unit: it.unit,
        qty,
        rate: past ? past.median : null,
        rateFrom: past ? ('past' as const) : null,
        note: '',
      };
    });
}

/**
 * The estimate from the lines' known rates. `withContingency` adds the BQ's contingency % (building BQs): it is the
 * figure the route and the approvers use, so a contingency can never keep a job under a quotation limit.
 */
export function bqEstimate(lines: AmBqLine[], contingencyPct = 0): { known: number; unpriced: number; contingency: number; withContingency: number } {
  const known = r2(lines.reduce((n, l) => n + (l.rate == null ? 0 : l.qty * l.rate), 0));
  const contingency = r2((known * Math.max(0, contingencyPct)) / 100);
  return { known, unpriced: lines.filter((l) => l.rate == null).length, contingency, withContingency: r2(known + contingency) };
}

export interface BqRouteView {
  route: AmBqRoute;
  quotesNeeded: number;
  cooToo: boolean;
  why: string;
}

/**
 * The quotation route from the estimate. A BQ with unpriced lines has no reliable estimate, so it never goes out on a
 * single quote.
 */
export function bqRoute(estimate: number, unpriced: number): BqRouteView {
  const r = RULES.amBq.value;
  const cooToo = estimate > r.cooAbove;
  if (estimate > r.rfqUpTo)
    return { route: 'TENDER', quotesNeeded: r.quotesForRfq, cooToo, why: `Estimate above RM${r.rfqUpTo.toLocaleString('en-MY')}: open tender, at least ${r.quotesForRfq} bids.` };
  if (estimate >= r.directBelow || unpriced > 0)
    return {
      route: 'RFQ',
      quotesNeeded: r.quotesForRfq,
      cooToo,
      why: unpriced > 0 && estimate < r.directBelow ? `${unpriced} line(s) have no past price, so ${r.quotesForRfq} quotes are needed to find the price.` : `Estimate RM${r.directBelow.toLocaleString('en-MY')} to RM${r.rfqUpTo.toLocaleString('en-MY')}: ${r.quotesForRfq} quotes.`,
    };
  return { route: 'DIRECT', quotesNeeded: 1, cooToo, why: `Estimate under RM${r.directBelow.toLocaleString('en-MY')}: one quote is enough.` };
}

export function quotesNeeded(route: AmBqRoute | null): number {
  return route === 'DIRECT' ? 1 : RULES.amBq.value.quotesForRfq;
}

/** The highest amount a route may award; above it the job must go out again on the next route. */
export function routeCeiling(route: AmBqRoute): number {
  const r = RULES.amBq.value;
  return route === 'DIRECT' ? r.directBelow : route === 'RFQ' ? r.rfqUpTo : Number.POSITIVE_INFINITY;
}

export interface QuoteCheck {
  quoteId: string;
  contractor: string;
  /** Sum of qty x rate over the lines the contractor priced. */
  total: number;
  statedTotal: number;
  sumOk: boolean;
  /** The contractor wrote the grand total with our contingency added (the Jumlah Keseluruhan on the BQ sheet). */
  statedWithContingency: boolean;
  missing: string[];
  complete: boolean;
  dearer: { lineId: string; item: string; rate: number; past: number; pct: number }[];
  expired: boolean;
}

export function checkQuote(bq: Pick<AmBq, 'lines' | 'contingencyPct'>, q: AmQuote, rates: Map<string, PastRate>, today: IsoDate): QuoteCheck {
  const tol = RULES.amBq.value.dearerPct;
  let total = 0;
  const dearer: QuoteCheck['dearer'] = [];
  for (const l of bq.lines) {
    const ql = q.lines.find((x) => x.lineId === l.id);
    if (!ql) continue;
    total += ql.rate * l.qty;
    const past = rates.get(bqKey(l.item, l.unit));
    if (past && past.median > 0) {
      const pct = Math.round(((ql.rate - past.median) / past.median) * 100);
      if (pct > tol) dearer.push({ lineId: l.id, item: l.item, rate: ql.rate, past: past.median, pct });
    }
  }
  total = r2(total);
  const missing = bq.lines.filter((l) => !q.lines.some((x) => x.lineId === l.id)).map((l) => l.id);
  // A building BQ's sheet shows a grand total with our contingency added. A contractor who writes that figure has
  // still added up correctly; the price compared and awarded is always the line total, without the contingency.
  const pct = bq.contingencyPct ?? 0;
  const withC = pct > 0 && Math.abs(total - q.statedTotal) > 1 && Math.abs(r2(total * (1 + pct / 100)) - q.statedTotal) <= 1;
  return {
    quoteId: q.id,
    contractor: q.contractor,
    total,
    statedTotal: q.statedTotal,
    sumOk: Math.abs(total - q.statedTotal) <= 1 || withC,
    statedWithContingency: withC,
    missing,
    complete: missing.length === 0,
    dearer,
    expired: !!q.validUntil && q.validUntil < today,
  };
}

export interface QuoteComparison {
  checks: QuoteCheck[];
  /** The cheapest quote that prices every line, adds up and is still valid. */
  lowestId: string | null;
  enough: boolean;
}

export function compareQuotes(bq: AmBq, rates: Map<string, PastRate>, today: IsoDate): QuoteComparison {
  const checks = bq.quotes.map((q) => checkQuote(bq, q, rates, today)).sort((a, b) => a.total - b.total);
  const ok = checks.filter((c) => c.complete && c.sumOk && !c.expired);
  return { checks, lowestId: ok[0]?.quoteId ?? null, enough: bq.quotes.length >= quotesNeeded(bq.route) };
}

export interface BqAdvice {
  code: 'VO_HIGH' | 'ASK_PRICES' | 'BUNDLE' | 'SPLIT_WATCH' | 'DEARER_LINE' | 'SUM_WRONG' | 'MISSING_LINES' | 'FEW_QUOTES' | 'EXPIRED' | 'SAVING';
  text: string;
}

/**
 * Lowest-cost advice for one job: what to ask suppliers, whether to send it with other jobs at the same place, and what
 * to check in the quotes. Advice only; people decide.
 */
export function bqAdvice(
  wo: AmWorkOrder,
  bq: AmBq,
  rates: Map<string, PastRate>,
  others: AmWorkOrder[],
  today: IsoDate,
): BqAdvice[] {
  const r = RULES.amBq.value;
  const out: BqAdvice[] = [];
  const award = bq.award?.final ? bq.award : null;
  if (award) {
    const vos = (bq.variations ?? []).filter((v) => v.final).reduce((n, v) => n + v.amount, 0);
    const pct = Math.round((vos / award.total) * 100);
    if (Math.abs(pct) > r.voWarnPct)
      out.push({ code: 'VO_HIGH', text: `Variation orders so far change the price by ${pct}% of the award. Check whether the scope was right and whether the job should have gone out again.` });
    if (bq.route && award.total + vos > routeCeiling(bq.route))
      out.push({ code: 'VO_HIGH', text: `With variation orders the price is above what ${bq.route === 'DIRECT' ? 'a single quote' : 'an RFQ'} may award. The COO should see why.` });
  }
  const unpriced = bq.lines.filter((l) => l.rate == null);
  if (unpriced.length && !bq.quotes.length)
    out.push({
      code: 'ASK_PRICES',
      text:
        unpriced.length > 5
          ? `No past price for ${unpriced.length} of ${bq.lines.length} lines (for example ${unpriced.slice(0, 3).map((l) => l.item).join('; ')}). The estimate counts only priced lines, so send the BQ out for quotes rather than relying on it.`
          : `No past price for ${unpriced.map((l) => l.item).join('; ')}. Ask suppliers and check an online price before the estimate is relied on.`,
    });
  const near = others.filter(
    (o) =>
      o.id !== wo.id &&
      o.status !== 'done' &&
      !o.bq?.award?.final &&
      ((wo.unitId && o.unitId === wo.unitId) || (wo.propertyId && o.propertyId === wo.propertyId)) &&
      Math.abs(daysBetween(o.raisedOn, wo.raisedOn)) <= r.bundleDays,
  );
  if (near.length) {
    out.push({ code: 'BUNDLE', text: `${near.length} other open job(s) at the same place: ${near.map((o) => o.title).join('; ')}. Sending them out together usually gets a lower price and one visit.` });
    // Same figure the route uses: the priced lines plus each BQ's contingency.
    const est = (b: AmBq) => bqEstimate(b.lines, b.contingencyPct ?? 0).withContingency;
    const together = near.reduce((n, o) => n + (o.bq ? est(o.bq) : 0), est(bq));
    if (bqRoute(est(bq), 0).route !== bqRoute(together, 0).route)
      out.push({ code: 'SPLIT_WATCH', text: `Together these jobs come to about RM${together.toLocaleString('en-MY')}, which needs a higher route. Do not split one job to avoid quotes.` });
  }
  if (bq.quotes.length) {
    const cmp = compareQuotes(bq, rates, today);
    for (const c of cmp.checks) {
      if (!c.sumOk) out.push({ code: 'SUM_WRONG', text: `${c.contractor}: the lines add up to RM${c.total.toLocaleString('en-MY')}, not the RM${c.statedTotal.toLocaleString('en-MY')} written on the quote. Ask them to correct it.` });
      if (c.missing.length) out.push({ code: 'MISSING_LINES', text: `${c.contractor} did not price ${c.missing.length} BQ line(s). Ask them to price every line so quotes compare fairly.` });
      for (const d of c.dearer) out.push({ code: 'DEARER_LINE', text: `${c.contractor}: ${d.item} at RM${d.rate} is ${d.pct}% above our past price RM${d.past}. Negotiate this line.` });
      if (c.expired) out.push({ code: 'EXPIRED', text: `${c.contractor}: the quote is no longer valid. Ask them to confirm the price.` });
    }
    if (!cmp.enough) out.push({ code: 'FEW_QUOTES', text: `Only ${bq.quotes.length} quote(s) so far. Get ${bq.route === 'DIRECT' ? 1 : r.quotesForRfq} before choosing.` });
    const ok = cmp.checks.filter((c) => c.complete && c.sumOk && !c.expired);
    if (ok.length >= 2) {
      // What could be saved if every line were bought at the lowest price any complete quote gave for it.
      const best = bq.lines.reduce((n, l) => {
        const rs = bq.quotes.filter((q) => ok.some((c) => c.quoteId === q.id)).map((q) => q.lines.find((x) => x.lineId === l.id)?.rate ?? Infinity);
        return n + Math.min(...rs) * l.qty;
      }, 0);
      const gap = r2(ok[0].total - best);
      if (gap > 0)
        out.push({ code: 'SAVING', text: `Lowest quote is RM${ok[0].total.toLocaleString('en-MY')}. Other contractors priced some lines lower; asking ${ok[0].contractor} to match them could save about RM${gap.toLocaleString('en-MY')}.` });
    }
  }
  return out;
}

// ---------- Details needed before a BQ is built (Fauzan, 5 Nov 2026) ----------
// The Maintenance Executive or Manager records what was discussed and found on site before anything is drafted. The
// list is the same for every job, plus the questions that change the price for that kind of job.

export interface AmBriefField {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'yesno' | 'choice';
  options?: string[];
  required: boolean;
  help?: string;
}

const yes = (key: string, label: string, help?: string): AmBriefField => ({ key, label, kind: 'yesno', required: true, help });
const txt = (key: string, label: string, required = true, help?: string): AmBriefField => ({ key, label, kind: 'text', required, help });
const pick = (key: string, label: string, options: string[]): AmBriefField => ({ key, label, kind: 'choice', options, required: true });

/** Asked for every job. */
export const AM_BRIEF_COMMON: AmBriefField[] = [
  txt('need', 'What is needed', true, 'What the requester asked for and what was agreed with them.'),
  pick('requestedBy', 'Who asked for it', ['Tenant', 'Group office or branch', 'Resort, orchard or training centre', 'Inspection or planned work', 'Other']),
  txt('discussedWith', 'Discussed with (name and role)'),
  { key: 'siteVisitOn', label: 'Site visit date', kind: 'date', required: true },
  txt('condition', 'Existing condition found on site'),
  txt('cause', 'Likely cause of the problem', false),
  txt('photos', 'Before photos taken (number or reference)'),
  txt('specification', 'Materials and standard required (brand, grade, colour, size)'),
  yes('occupied', 'Is the place in use during the work?'),
  txt('access', 'Working hours and access allowed', false, 'Keys, tenant notice, quiet hours.'),
  { key: 'neededBy', label: 'Needed by', kind: 'date', required: true },
  pick('urgency', 'Urgency', ['Emergency (safety or damage now)', 'Urgent (within 7 days)', 'Normal', 'Planned']),
  txt('permits', 'Permits or safety needs (work at height, council permit, hot work)', false),
  yes('warranty', 'Is it still under a contractor warranty or defect period?', 'If yes, the original contractor fixes it first.'),
  txt('budgetNote', 'Budget known or set aside (if any)', false),
];

/** The questions that change the price for each kind of job. */
export const AM_BRIEF_BY_KIND: Record<AmJobKind, AmBriefField[]> = {
  PAINTING: [
    pick('paintArea', 'Inside or outside', ['Inside', 'Outside', 'Both']),
    txt('surfaces', 'Surfaces (walls, ceiling, doors, grilles)'),
    txt('colour', 'Colour and paint brand or grade'),
    yes('repairFirst', 'Cracks, damp or peeling to repair first?'),
    txt('height', 'Highest point to paint (storeys or metres)'),
  ],
  ROOFING: [
    txt('roofType', 'Roof material and type (metal deck, clay tile, concrete)'),
    txt('height', 'Building height (storeys)'),
    yes('leakInside', 'Water damage inside (ceiling, wiring)?'),
    yes('gutter', 'Gutters or downpipes affected?'),
  ],
  PLUMBING: [
    txt('pipe', 'Pipe material and size (PVC, copper; 15 mm, 20 mm)'),
    pick('where', 'Where the pipe runs', ['Exposed', 'In the wall', 'Under the floor', 'Underground outside']),
    yes('shutOff', 'Can the water supply be shut off during the work?'),
    yes('meterSide', 'Is the fault before the water meter (water authority side)?'),
  ],
  ELECTRICAL: [
    pick('supply', 'Supply', ['Single phase', 'Three phase']),
    txt('fault', 'Fault seen (trips, no power, burning smell, sparks)'),
    yes('dbOld', 'Distribution board old or damaged?'),
    yes('certNeeded', 'Is a test certificate by a competent person needed?'),
  ],
  AIRCOND: [
    txt('units', 'Each unit: type, brand and horsepower'),
    txt('lastService', 'Last service date and by whom', false),
    yes('notCold', 'Any unit not cold, leaking or noisy?'),
    txt('access', 'Where the outdoor units are (ground, wall bracket, roof)'),
  ],
  RENOVATION: [
    txt('scope', 'Rooms and works (floor, partition, ceiling, wiring)'),
    yes('drawings', 'Are there drawings or a layout sketch?'),
    yes('councilPermit', 'Does it need local council approval?'),
    yes('structural', 'Any structural change (walls, beams, openings)?'),
    txt('tenantFitOut', 'Tenant fit-out or owner works?'),
  ],
  LANDSCAPING: [
    pick('frequency', 'How often', ['One time', 'Monthly', 'Fortnightly', 'Weekly']),
    txt('slope', 'Slope, drains or hard-to-reach areas'),
    yes('disposal', 'Must cuttings be taken off site?'),
  ],
  NEW_BUILDING: [
    txt('use', 'What the building is for (staff quarters, store, guard house, chalet)'),
    txt('landTitle', 'Land: lot number and who owns it'),
    yes('councilPlan', 'Is the building plan approved by the local council (PBT)?', 'If no, the BQ can go out for prices, but no work starts before approval.'),
    yes('engineerDrawings', 'Are there architect or engineer drawings?'),
    txt('ground', 'Ground found on site (firm, soft, filled, slope, flood risk)'),
    yes('lorryAccess', 'Can a lorry reach the site?'),
    txt('supply', 'Water and power: where they come from and how far'),
    pick('sewer', 'Toilet waste goes to', ['New septic tank', 'Existing septic tank', 'Public sewer', 'No toilet']),
    txt('limits', 'Site limits (trees, neighbours, height limit, setback)', false),
  ],
  BUILDING_WORKS: [
    txt('scope', 'What changes (extra room, raise ceiling, new roof, floor, kitchen, toilet)'),
    yes('drawings', 'Are there drawings or a layout sketch?'),
    yes('councilPermit', 'Does it need local council approval?'),
    yes('structural', 'Any structural change (walls, beams, openings, roof)?'),
    txt('existingRoof', 'Existing roof: material, slope and height to the peak'),
    txt('supply', 'Power and water for the new parts: where they come from'),
    txt('limits', 'Site limits (trees over the roof, neighbours, height limit)', false),
    yes('occupiedRooms', 'Do people sleep or work in it during the work?'),
  ],
  OTHER: [txt('scope', 'Full scope of work, item by item')],
};

export function briefFields(kind: AmJobKind): AmBriefField[] {
  return [...AM_BRIEF_COMMON, ...AM_BRIEF_BY_KIND[kind]];
}

/** What is still missing before a BQ can be drafted: required answers and, where the job has measurements, at least one. */
export function briefMissing(brief: Pick<AmBqBrief, 'jobKind' | 'answers'> | null | undefined, measurements?: Record<string, number>): string[] {
  if (!brief) return ['The details needed for this job'];
  const out = briefFields(brief.jobKind)
    .filter((f) => f.required && !(brief.answers[f.key] ?? '').trim())
    .map((f) => f.label);
  const measures = AM_BQ_TEMPLATES[brief.jobKind].measures;
  const required = measures.filter((m) => m.required);
  if (measurements && required.length) {
    for (const m of required) if (!((measurements[m.key] ?? 0) > 0)) out.push(`${m.label} (${m.unit})`);
    for (const m of measures)
      if (!m.required && m.requiredIf?.some((k) => (measurements[k] ?? 0) > 0) && !((measurements[m.key] ?? 0) > 0)) out.push(`${m.label} (${m.unit})`);
  } else if (measurements && measures.length && !measures.some((m) => (measurements[m.key] ?? 0) > 0))
    out.push(`Site measurements (${measures.map((m) => `${m.label.toLowerCase()} in ${m.unit}`).join(', ')})`);
  return out;
}

/** Keep only known answers, trimmed; a choice must be one of its options and a yes/no must be yes or no. */
export function cleanBriefAnswers(kind: AmJobKind, answers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of briefFields(kind)) {
    const v = String(answers?.[f.key] ?? '').trim().slice(0, 500);
    if (!v) continue;
    if (f.kind === 'yesno' && v !== 'yes' && v !== 'no') throw new Error(`${f.label}: answer yes or no.`);
    if (f.kind === 'choice' && !f.options!.includes(v)) throw new Error(`${f.label}: choose one of the options.`);
    if (f.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${f.label}: give a date.`);
    out[f.key] = v;
  }
  return out;
}

/** A drafted BQ: lines, plus for building BQs the sections, title, notes and contingency. */
export interface BqDraft {
  lines: AmBqLine[];
  title?: string;
  sections?: AmBqSection[];
  notes?: string[];
  contingencyPct?: number;
}

/** Draft a BQ from a template and the site measurements. A line gets a rate only when we have paid for it before. */
export function draftBq(kind: AmJobKind, measurements: Record<string, number>, rates: Map<string, PastRate>): BqDraft {
  const t = AM_BQ_TEMPLATES[kind];
  if (t.building) {
    const d = t.building(measurements);
    return {
      title: d.title,
      sections: d.sections,
      notes: d.notes,
      contingencyPct: d.contingencyPct,
      lines: d.lines.map((l, i) => {
        const past = rates.get(bqKey(l.item, l.unit));
        return {
          id: `L${i + 1}`,
          item: l.item,
          unit: l.unit,
          qty: l.qty,
          rate: past ? past.median : null,
          rateFrom: past ? ('past' as const) : null,
          note: '',
          section: l.section,
          calc: l.calc,
          ...(l.optional ? { optional: true } : {}),
        };
      }),
    };
  }
  return { lines: draftBqLines(kind, measurements, rates) };
}