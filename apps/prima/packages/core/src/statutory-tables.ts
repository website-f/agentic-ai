// EPF (KWSP) and PERKESO contribution tables, kept row by row in Prima (Fauzan, 2 Nov 2026: "Make sure epf and socso
// have table for it. Make sure the system have the information stored ... Epf or socso publish their table of
// calculation").
//
// KWSP publishes the Third Schedule of the EPF Act 1991 (Jadual Ketiga). PERKESO publishes the contribution table of the
// Employees' Social Security Act 1969 (Act 4, Third Schedule) and the Employment Insurance System Act 2017 (Act 800,
// Second Schedule). Payroll takes every EPF, SOCSO and EIS amount from the row the wage falls in, never from a bare
// percentage, so the payslip shows exactly what the published table says.
//
// Prima carries built-in copies so payroll works on day one. Each built-in table says how it was made and which
// published rows it was checked against. When KWSP or PERKESO publish a new table, HR or Finance loads it row by row
// with the month it starts and the document it came from; a second person (the Finance Director, the Chief of Staff or
// the CEO) checks it against the published PDF; only then does payroll use it, from that month. Every version is kept.
import type { IsoDateTime } from './types';

export type StatTableId = 'EPF-A' | 'EPF-E' | 'EPF-F' | 'SOCSO-1' | 'SOCSO-2' | 'EIS';

/** One row: wages above the row before and up to `upTo` pay these amounts (RM). */
export interface StatRow {
  upTo: number;
  er: number;
  ee: number;
}

export interface StatSign {
  by: string;
  byId: string;
  at: IsoDateTime;
  comment: string;
}

export interface StatTable {
  id: StatTableId;
  /** Version: 'built-in' for Prima's copy, then 'v2', 'v3' as tables are loaded. */
  version: string;
  body: 'KWSP' | 'PERKESO';
  name: string;
  /** Who it applies to. */
  appliesTo: string;
  /** First wage month (YYYY-MM) it applies to. */
  from: string;
  /** The published schedule it copies. */
  source: string;
  /**
   * built_in: Prima's copy, made by the published method and checked against the published rows named in `checkedRows`;
   * loaded: loaded from the published PDF, waiting for its check; checked: loaded and checked by a second person.
   */
  status: 'built_in' | 'loaded' | 'checked' | 'replaced';
  checkedRows: string;
  rows: StatRow[];
  /**
   * Wages above the last row: EPF is a percentage of the whole wage rounded up to the next ringgit (Third Schedule, last
   * paragraph); SOCSO and EIS stay at the last row (the RM6,000 ceiling).
   */
  above: { erPct: number; eePct: number } | 'last_row';
  loaded: StatSign | null;
  checked: StatSign | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Rounds to the nearest `step` in sen, half up. */
const toStep = (n: number, sen: number) => Math.round(Math.round(n * 100 * 1e6) / 1e6 / sen) * sen / 100;

/**
 * EPF Third Schedule bands: RM0.01 to RM10 pays nothing; then RM20 bands up to RM5,000 and RM100 bands up to RM20,000.
 * Each share is the rate on the top of the band, rounded up to the next ringgit.
 */
function epfRows(er: (top: number) => number, ee: number): StatRow[] {
  const rows: StatRow[] = [{ upTo: 10, er: 0, ee: 0 }];
  const up = (n: number) => Math.ceil(r2(n));
  for (let top = 20; top <= 5000; top += 20) rows.push({ upTo: top, er: up(top * er(top)), ee: up(top * ee) });
  for (let top = 5100; top <= 20000; top += 100) rows.push({ upTo: top, er: up(top * er(top)), ee: up(top * ee) });
  return rows;
}

/** PERKESO wage bands (Act 4 Third Schedule and Act 800 Second Schedule), to the RM6,000 ceiling from October 2024. */
const PERKESO_BANDS = [30, 50, 70, 100, 140, 200, 300, 400, ...Array.from({ length: 56 }, (_, i) => 500 + i * 100)];

/**
 * PERKESO works each band on its middle wage: the employee's share to the nearest 5 sen, the total to the nearest 10 sen,
 * and the employer pays the rest. This reproduces the published rows checked below. The two lowest bands are taken as
 * published.
 */
function perkesoRows(erPct: number, eePct: number, low: Record<number, [number, number]>): StatRow[] {
  let from = 0;
  return PERKESO_BANDS.map((upTo) => {
    const mid = (from + upTo) / 2;
    from = upTo;
    if (low[upTo]) return { upTo, er: low[upTo][0], ee: low[upTo][1] };
    const ee = toStep(mid * eePct, 5);
    const total = toStep(mid * (erPct + eePct), 10);
    return { upTo, er: r2(total - ee), ee };
  });
}

const BUILT_IN_SIGN = null;

/** Prima's built-in tables (2 Nov 2026). */
export function builtInStatTables(): StatTable[] {
  const base = { version: 'built-in', status: 'built_in' as const, loaded: BUILT_IN_SIGN, checked: BUILT_IN_SIGN };
  return [
    {
      ...base,
      id: 'EPF-A',
      body: 'KWSP',
      name: 'EPF Third Schedule, Part A',
      appliesTo: 'Malaysian citizens and permanent residents under 60',
      from: '2024-01',
      source: 'KWSP, Employees Provident Fund Act 1991, Third Schedule (Jadual Ketiga), Part A: employer 13% up to RM5,000 and 12% above, employee 11%',
      checkedRows: 'RM10.01-20.00 (3/3), RM20.01-40.00 (6/5), RM1,700.01-1,720.00 (224/190), RM4,980.01-5,000.00 (650/550), RM5,000.01-5,100.00 (612/561), RM19,900.01-20,000.00 (2,400/2,200)',
      rows: epfRows((top) => (top <= 5000 ? 0.13 : 0.12), 0.11),
      above: { erPct: 12, eePct: 11 },
    },
    {
      ...base,
      id: 'EPF-E',
      body: 'KWSP',
      name: 'EPF Third Schedule, Part E',
      appliesTo: 'Malaysian citizens aged 60 and over',
      from: '2024-01',
      source: 'KWSP Third Schedule, Part E: employer 4%, employee nothing',
      checkedRows: 'Not yet checked row by row against the published Part E: load it from KWSP before go-live',
      rows: epfRows(() => 0.04, 0),
      above: { erPct: 4, eePct: 0 },
    },
    {
      ...base,
      id: 'EPF-F',
      body: 'KWSP',
      name: 'EPF for foreign workers',
      appliesTo: 'Foreign workers (not permanent residents), mandatory from October 2025 wages',
      from: '2025-10',
      source: 'KWSP: employer 2% and employee 2% for non-Malaysian employees from October 2025 wages',
      checkedRows: 'Not yet checked row by row against the published table: load it from KWSP before go-live',
      rows: epfRows(() => 0.02, 0.02),
      above: { erPct: 2, eePct: 2 },
    },
    {
      ...base,
      id: 'SOCSO-1',
      body: 'PERKESO',
      name: 'SOCSO First Category (employment injury and invalidity)',
      appliesTo: 'Employees under 60, Malaysian and foreign',
      from: '2024-10',
      source: "PERKESO, Employees' Social Security Act 1969 (Act 4), Third Schedule, First Category: employer 1.75%, employee 0.5%, wage ceiling RM6,000 from October 2024",
      checkedRows: 'Up to RM30 (0.40/0.10), RM500.01-600 (9.65/2.75), RM1,000.01-1,100 (18.35/5.25), RM2,500.01-2,600 (44.65/12.75), RM4,000.01-4,100 (70.85/20.25), RM5,900.01-6,000 and above (104.15/29.75)',
      rows: perkesoRows(0.0175, 0.005, { 30: [0.4, 0.1] }),
      above: 'last_row',
    },
    {
      ...base,
      id: 'SOCSO-2',
      body: 'PERKESO',
      name: 'SOCSO Second Category (employment injury only)',
      appliesTo: 'Employees aged 60 and over: employer only',
      from: '2024-10',
      source: 'PERKESO Act 4 Third Schedule, Second Category: employer 1.25%, employee nothing, wage ceiling RM6,000',
      checkedRows: 'Not yet checked row by row against the published Second Category: load it from PERKESO before go-live',
      rows: perkesoRows(0.0125, 0, {}),
      above: 'last_row',
    },
    {
      ...base,
      id: 'EIS',
      body: 'PERKESO',
      name: 'Employment Insurance System (SIP)',
      appliesTo: 'Malaysian employees aged 18 to 59',
      from: '2024-10',
      source: 'PERKESO, Employment Insurance System Act 2017 (Act 800), Second Schedule: 0.2% each, wage ceiling RM6,000 from October 2024',
      checkedRows: 'Up to RM30 (0.05/0.05), RM5,900.01-6,000 and above (11.90/11.90); other rows by the same method, check against the published table before go-live',
      rows: perkesoRows(0.002, 0.002, { 30: [0.05, 0.05] }),
      above: 'last_row',
    },
  ];
}

export const STAT_TABLE_IDS: StatTableId[] = ['EPF-A', 'EPF-E', 'EPF-F', 'SOCSO-1', 'SOCSO-2', 'EIS'];

/** The table of an id in force for a wage month: the latest checked one starting on or before it, else the built-in. */
export function statTableFor(id: StatTableId, period: string, stored: StatTable[] = []): StatTable {
  const usable = stored.filter((t) => t.id === id && t.status === 'checked' && t.from <= period).sort((a, b) => b.from.localeCompare(a.from));
  return usable[0] ?? builtInStatTables().find((t) => t.id === id)!;
}

/** The employer and employee shares for a wage from a table. */
export function statShare(table: StatTable, wage: number): { er: number; ee: number; band: string } {
  if (!(wage > 0)) return { er: 0, ee: 0, band: 'No wages' };
  const i = table.rows.findIndex((r) => wage <= r.upTo + 1e-9);
  const fmt = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (i >= 0) {
    const r = table.rows[i];
    const from = i === 0 ? 0.01 : table.rows[i - 1].upTo + 0.01;
    return { er: r.er, ee: r.ee, band: `RM${fmt(from)}-${fmt(r.upTo)}` };
  }
  const last = table.rows[table.rows.length - 1];
  if (table.above === 'last_row') return { er: last.er, ee: last.ee, band: `Above RM${fmt(last.upTo)} (ceiling)` };
  return {
    er: Math.ceil(r2((wage * table.above.erPct) / 100)),
    ee: Math.ceil(r2((wage * table.above.eePct) / 100)),
    band: `Above RM${fmt(last.upTo)} (${table.above.erPct}% / ${table.above.eePct}% of the wage)`,
  };
}

/**
 * Reads a table pasted from the published PDF: one row per line as "from, to, employer, employee" or "to, employer,
 * employee" (RM, commas in numbers allowed if the columns are separated by tabs or semicolons). Rows must follow on
 * without gaps and every amount must be zero or more.
 */
export function parseStatRows(text: string): StatRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && /\d/.test(l));
  if (lines.length < 2 || lines.length > 2000) throw new Error('Paste the table: 2 to 2,000 rows.');
  const rows: StatRow[] = [];
  let lastTo = 0;
  for (const [n, line] of lines.entries()) {
    const sep = /[\t;|]/.test(line) ? /[\t;|]+/ : /,\s*|\s+/;
    const cells = line
      .split(sep)
      .map((c) => c.replace(/rm/gi, '').replace(/,/g, '').trim())
      .filter((c) => c !== '' && c !== '-');
    const nums = cells.map(Number);
    if (nums.some((x) => !Number.isFinite(x) || x < 0) || (nums.length !== 3 && nums.length !== 4))
      throw new Error(`Row ${n + 1} ("${line.slice(0, 60)}"): give from, to, employer and employee in RM.`);
    const from: number | null = nums.length === 4 ? nums[0] : null;
    const [upTo, er, ee] = nums.slice(nums.length - 3);
    if (upTo <= lastTo) throw new Error(`Row ${n + 1}: wages up to RM${upTo} do not follow on from RM${lastTo}.`);
    if (from != null && Math.abs(from - (lastTo === 0 ? from : lastTo + 0.01)) > 0.011)
      throw new Error(`Row ${n + 1}: starts at RM${from}, but the row before ended at RM${lastTo}.`);
    rows.push({ upTo: r2(upTo), er: r2(er), ee: r2(ee) });
    lastTo = upTo;
  }
  return rows;
}

/** Differences between two tables for the checker: rows whose amounts changed. */
export function statTableChanges(before: StatTable, after: StatTable): { band: string; before: string; after: string }[] {
  const out: { band: string; before: string; after: string }[] = [];
  for (const r of after.rows) {
    const b = statShare(before, r.upTo);
    if (Math.abs(b.er - r.er) > 0.001 || Math.abs(b.ee - r.ee) > 0.001)
      out.push({ band: `Up to RM${r.upTo.toFixed(2)}`, before: `${b.er.toFixed(2)} / ${b.ee.toFixed(2)}`, after: `${r.er.toFixed(2)} / ${r.ee.toFixed(2)}` });
  }
  return out;
}

/** A table counts as verified only when it was loaded from the published schedule and checked by a second person. */
export const statTableVerified = (t: Pick<StatTable, 'status'>) => t.status === 'checked';

/**
 * Director-only verification items for a staff pay run (Arisha main's review, 2 Nov 2026): every EPF/PERKESO table the
 * run used that is not loaded-and-checked, and every PCB that is Prima's estimate rather than LHDN's e-PCB figure. Each
 * stays "Unresolved" until the table is loaded and checked, or the PCB is entered; Prima never calls it compliant.
 */
export function staffPayDirectorChecks(run: {
  period: string;
  tables?: { id: string; version: string; status: string }[];
  lines: { name?: string; pcbSource?: string; pcb?: number }[];
}) {
  const built = builtInStatTables();
  const out: { key: string; text: string; source: string; affected: string; responsible: string; status: 'Unresolved' }[] = [];
  for (const t of run.tables ?? [])
    if (!statTableVerified(t as Pick<StatTable, 'status'>)) {
      const b = built.find((x) => x.id === t.id);
      out.push({
        key: `table:${t.id}:${t.version}`,
        text: `${b?.name ?? t.id} (${t.version}) used for ${run.period} is ${t.status === 'built_in' ? "Prima's built-in copy" : 'not checked'}, not the table loaded and checked from the published schedule`,
        source: b?.source ?? t.id,
        affected: `${run.lines.length} payroll line(s), ${run.period}`,
        responsible: 'Finance Director or Chief of Staff (load and check the published table)',
        status: 'Unresolved',
      });
    }
  const est = run.lines.filter((l) => l.pcbSource === 'estimate' && (l.pcb ?? 0) > 0);
  if (est.length)
    out.push({
      key: `pcb:${run.period}`,
      text: `${est.length} PCB amount(s) are Prima's estimate (single, no children), not LHDN's e-PCB figure`,
      source: 'Income Tax (Deduction from Remuneration) Rules 1994; LHDN e-PCB calculator',
      affected:
        est
          .map((l) => l.name ?? '')
          .filter(Boolean)
          .slice(0, 10)
          .join(', ') || `${est.length} line(s)`,
      responsible: 'Chief of Staff (HR Director) with the Finance Director',
      status: 'Unresolved',
    });
  return out;
}
