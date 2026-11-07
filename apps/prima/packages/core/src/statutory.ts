/**
 * Statutory contributions the CEO can change by month (Fauzan, 6 Nov 2026: "Ceo can set the base salary. When new law
 * came in. Ceo have the flexibility control to set how salary is set and how the base is set base by the new law that
 * came. Even with socso or epf or add new way."). The defaults are the law as at November 2026 (KWSP Third Schedule,
 * PERKESO, SIP, LINDUNG 24 Jam, HRD Corp). A new version starts from a month, with a reason and the law reference; the
 * guard pay run and staff payroll read the version in force for the wage month. A new contribution type (a new fund or
 * levy) can be added with its employee and employer rates, wage cap and whether overtime counts. Not legal advice:
 * before real pay, the figures are checked against the published tables.
 */
import type { Id, IsoDateTime, Nationality } from './types';

export interface StatutoryOther {
  /** Short code, e.g. a new fund's name in capitals. */
  code: string;
  name: string;
  /** Employee and employer shares as a fraction of wages (0.01 = 1%). */
  eeRate: number;
  erRate: number;
  /** Wages above this are not counted (null: no cap). */
  wageCap: number | null;
  /** Whether overtime counts as wages for it. */
  includeOt: boolean;
  appliesTo: 'all' | 'malaysian' | 'foreign';
  /** No shares from this age (null: all ages). */
  maxAge: number | null;
  /** Who it is paid to, for Finance. */
  payee: string;
}

export interface StatutorySettings {
  epf: {
    eeRate: number;
    /** Employer rate up to `erLimit` wages, and above it. */
    erRateLow: number;
    erRateHigh: number;
    erLimit: number;
    /** From this age: employee and employer rates. */
    olderAge: number;
    olderEeRate: number;
    olderErRate: number;
    foreignEeRate: number;
    foreignErRate: number;
    /** Count wages in the KWSP bands (RM20 to RM5,000, RM100 above) and round up to the ringgit. */
    bands: boolean;
  };
  socso: { eeRate: number; erRate: number; wageCap: number; olderAge: number; olderErRate: number };
  eis: { eeRate: number; erRate: number; wageCap: number; minAge: number; maxAge: number; malaysiansOnly: boolean };
  /** LINDUNG 24 Jam: null rate keeps the dated rates in rule LINDUNG; a number replaces them from this version's month. */
  lindung: { rate: number | null; wageCap: number };
  hrd: { rate: number; malaysiansOnly: boolean };
  others: StatutoryOther[];
  /** The law or gazette this follows, in the CEO's words. */
  lawRef: string;
}

export interface StatutoryVersion {
  id: Id;
  /** YYYY-MM */
  effectiveFrom: string;
  settings: StatutorySettings;
  reason: string;
  setBy: string;
  setById: Id;
  setAt: IsoDateTime;
  replacedBy: Id | null;
}

export const DEFAULT_STATUTORY: StatutorySettings = {
  epf: { eeRate: 0.11, erRateLow: 0.13, erRateHigh: 0.12, erLimit: 5000, olderAge: 60, olderEeRate: 0, olderErRate: 0.04, foreignEeRate: 0.02, foreignErRate: 0.02, bands: true },
  socso: { eeRate: 0.005, erRate: 0.0175, wageCap: 6000, olderAge: 60, olderErRate: 0.0125 },
  eis: { eeRate: 0.002, erRate: 0.002, wageCap: 6000, minAge: 18, maxAge: 60, malaysiansOnly: true },
  lindung: { rate: null, wageCap: 6000 },
  hrd: { rate: 0.01, malaysiansOnly: true },
  others: [],
  lawRef: 'KWSP Act 1991 Third Schedule (foreign workers 2% from Oct 2025); SOCSO Act 1969; EIS Act 2017; LINDUNG 24 Jam; PSMB Act 2001. As at November 2026.',
};

/** The settings in force for a wage month: the newest version starting on or before it, else the defaults. */
export function statutoryFor(versions: StatutoryVersion[], month: string): StatutorySettings {
  const v = versions
    .filter((x) => !x.replacedBy && x.effectiveFrom <= month)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.setAt.localeCompare(a.setAt))[0];
  return v ? { ...DEFAULT_STATUTORY, ...v.settings, others: v.settings.others ?? [] } : DEFAULT_STATUTORY;
}

/** Refuse only settings that cannot be counted with. */
export function statutoryProblem(x: StatutorySettings): string | null {
  const rate = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 0.5;
  const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000;
  const age = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 14 && v <= 100;
  const e = x.epf;
  if (!e || ![e.eeRate, e.erRateLow, e.erRateHigh, e.olderEeRate, e.olderErRate, e.foreignEeRate, e.foreignErRate].every(rate)) return 'Each EPF rate must be between 0% and 50%.';
  if (!money(e.erLimit) || !age(e.olderAge)) return 'Give the EPF wage limit and the older-worker age.';
  const s = x.socso;
  if (!s || ![s.eeRate, s.erRate, s.olderErRate].every(rate) || !money(s.wageCap) || !age(s.olderAge)) return 'Check the SOCSO rates, wage cap and age.';
  const i = x.eis;
  if (!i || ![i.eeRate, i.erRate].every(rate) || !money(i.wageCap) || !age(i.minAge) || !age(i.maxAge) || i.minAge >= i.maxAge) return 'Check the EIS rates, wage cap and ages.';
  if (!x.lindung || (x.lindung.rate != null && !rate(x.lindung.rate)) || !money(x.lindung.wageCap)) return 'Check the LINDUNG 24 Jam rate and wage cap.';
  if (!x.hrd || !rate(x.hrd.rate)) return 'The HRD levy rate must be between 0% and 50%.';
  if (!Array.isArray(x.others) || x.others.length > 10) return 'At most 10 new contribution types.';
  const codes = new Set<string>();
  for (const o of x.others) {
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(o.code ?? '')) return 'Give each new contribution a short code in capitals (2 to 16 letters or digits).';
    if (['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'HRD', 'PCB'].includes(o.code) || codes.has(o.code)) return `The code ${o.code} is already used.`;
    codes.add(o.code);
    if (!o.name || o.name.trim().length < 3) return `Name the contribution ${o.code}.`;
    if (!rate(o.eeRate) || !rate(o.erRate) || (o.eeRate === 0 && o.erRate === 0)) return `${o.code}: give the employee or employer rate (0% to 50%).`;
    if (o.wageCap != null && !money(o.wageCap)) return `${o.code}: the wage cap must be above RM0.`;
    if (!['all', 'malaysian', 'foreign'].includes(o.appliesTo)) return `${o.code}: say who it applies to.`;
    if (o.maxAge != null && !age(o.maxAge)) return `${o.code}: check the age.`;
    if (!o.payee || o.payee.trim().length < 2) return `${o.code}: say who it is paid to.`;
  }
  if (!x.lawRef || x.lawRef.trim().length < 5) return 'Give the law or gazette reference.';
  return null;
}

/** One new contribution type's shares for a worker. */
export function otherShare(o: StatutoryOther, wages: number, otPay: number, age: number, nationality: Nationality): { ee: number; er: number } {
  if (o.appliesTo === 'malaysian' && nationality !== 'MY') return { ee: 0, er: 0 };
  if (o.appliesTo === 'foreign' && nationality === 'MY') return { ee: 0, er: 0 };
  if (o.maxAge != null && age >= o.maxAge) return { ee: 0, er: 0 };
  const base = Math.max(0, o.includeOt ? wages : wages - otPay);
  const w = o.wageCap != null ? Math.min(base, o.wageCap) : base;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ee: r2(w * o.eeRate), er: r2(w * o.erRate) };
}
