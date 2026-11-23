import type { IsoDateTime } from "./types";


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
 * P128: the published rows the middle-wage method does not give (the lowest bands), by the scheme's employer/employee
 * rates. Checked against PERKESO's "New contribution rate including SKBBK" (Appendix 1 of the text-file FAQ, June 2026)
 * for Act 4 First and Second Category and SKBBK, and the EIS rows of PERKESO's own Excel converter. A changed rate has
 * no published rows yet, so it is worked by the method alone.
 */
const PERKESO_LOW: Record<string, Record<number, [number, number]>> = {
  '0.0175/0.005': { 30: [0.4, 0.1], 100: [1.5, 0.4] },
  '0.0125/0': { 30: [0.3, 0] },
  '0.002/0.002': { 30: [0.05, 0.05], 70: [0.15, 0.15], 100: [0.2, 0.2] },
  '0/0.0075': { 30: [0, 0.2], 70: [0, 0.5] },
};

/** The bands to a wage ceiling: the published ones to RM6,000, then RM100 bands if the ceiling is raised. */
function perkesoBands(cap: number): number[] {
  const top = Math.max(30, cap);
  const out = PERKESO_BANDS.filter((b) => b < top);
  const last = out[out.length - 1] ?? 0;
  for (let b = Math.floor(last / 100) * 100 + 100; b < top; b += 100) if (b > last) out.push(b);
  out.push(top);
  return out;
}
const ROWS_CACHE = new Map<string, StatRow[]>();
/** RM amount as 1,234.56 (what toLocaleString('en-MY') gives, without its cost on every share worked out). */
const fmt = (n: number) => {
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`;
};
const fiveSenTiesToFive = (n: number) => {
  const q = Math.round(n * 100 * 1e6) / 1e6 / 5;
  const f = Math.floor(q);
  const steps = Math.abs(q - f - 0.5) < 1e-9 ? (f % 2 === 1 ? f : f + 1) : Math.round(q);
  return (steps * 5) / 100;
};

/**
 * PERKESO works each band on its middle wage: the employee's share to the nearest 5 sen, the total to the nearest 10 sen,
 * and the employer pays the rest (an employee-only scheme such as SKBBK: the employee's share alone). This reproduces
 * the published rows checked below; the lowest bands are taken as published.
 */
export function perkesoRows(erPct: number, eePct: number, cap = 6000): StatRow[] {
  const key = `${erPct}/${eePct}/${cap}`;
  const hit = ROWS_CACHE.get(key);
  if (hit) return hit;
  const low = PERKESO_LOW[`${erPct}/${eePct}`] ?? {};
  let from = 0;
  const rows = perkesoBands(cap).map((upTo) => {
    const mid = (from + upTo) / 2;
    from = upTo;
    if (low[upTo]) return { upTo, er: low[upTo][0], ee: low[upTo][1] };
    // An employee-only scheme (SKBBK) is to the nearest 5 sen, and a share exactly between two (RM1.275) goes to the one
    // ending in 5 sen (RM1.25; RM44.625 to RM44.65), as PERKESO's published SKBBK column does.
    if (!erPct) return { upTo, er: 0, ee: fiveSenTiesToFive(mid * eePct) };
    const ee = toStep(mid * eePct, 5);
    const total = toStep(mid * (erPct + eePct), 10);
    return { upTo, er: r2(total - ee), ee };
  });
  ROWS_CACHE.set(key, rows);
  return rows;
}

/**
 * P128: a PERKESO share (SOCSO, EIS or SKBBK) by the wage band, as the published tables give it: the band the wage falls
 * in, never a straight percentage of the wage. Wages above the ceiling pay the last band.
 */
export function perkesoShare(wage: number, erPct: number, eePct: number, cap = 6000): { er: number; ee: number; band: string } {
  if (!(wage > 0)) return { er: 0, ee: 0, band: 'No wages' };
  const rows = perkesoRows(erPct, eePct, cap);
  const i = rows.findIndex((r) => wage <= r.upTo + 1e-9);
  if (i < 0) {
    const last = rows[rows.length - 1];
    return { er: last.er, ee: last.ee, band: `Above RM${fmt(last.upTo)} (ceiling)` };
  }
  const from = i === 0 ? 0.01 : rows[i - 1].upTo + 0.01;
  return { er: rows[i].er, ee: rows[i].ee, band: `RM${fmt(from)}-${fmt(rows[i].upTo)}` };
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
      checkedRows: 'All 65 rows against PERKESO Appendix 1, New contribution rate including SKBBK (June 2026), on 24 Nov 2026 (P128); RM70.01-100 corrected to 1.50/0.40',
      rows: perkesoRows(0.0175, 0.005).map((r) => ({ ...r })),
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
      checkedRows: 'All 65 rows against PERKESO Appendix 1 (June 2026), Second Category employer share, on 24 Nov 2026 (P128); up to RM30 corrected to 0.30',
      rows: perkesoRows(0.0125, 0).map((r) => ({ ...r })),
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
      checkedRows: 'All 65 rows against the EIS columns of the PERKESO Excel-to-text converter (2026) on 24 Nov 2026 (P128); RM50.01-70 and RM70.01-100 corrected to 0.15 and 0.20 each. Check against the gazetted Act 800 schedule before go-live',
      rows: perkesoRows(0.002, 0.002).map((r) => ({ ...r })),
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