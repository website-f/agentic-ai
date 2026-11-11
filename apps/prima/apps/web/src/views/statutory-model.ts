/**
 * P98 (Fitri, 11 Nov 2026: "the statutory rates page is not optimized: make it optimized like the salary calculator
 * page"): what the statutory rates screen shows and sends, kept apart from how it looks so it can be tested on its own.
 *
 * Nothing here is a pay rule and nothing changes what is stored. The rates in force are core's statutoryFor, exactly
 * as the pay run reads them; a change is checked with core's statutoryProblem, the same check the server makes (the
 * server stays the judge). A rate is typed in percent and sent as a fraction exactly as before P98 (Number(typed) / 100);
 * a money or age box is sent as Number(typed). scripts/statutory-model.test.cjs proves that what is sent for the same
 * typing equals what the pre-P98 form sent, and that an untouched form sends back exactly the rates in force.
 */
import { DEFAULT_STATUTORY, RULES, statutoryFor, statutoryProblem, type StatutoryOther, type StatutorySettings, type StatutoryVersion } from '@prima/core';

export type SchemeId = 'epf' | 'socso' | 'eis' | 'lindung' | 'hrd';
export type FieldKind = 'rate' | 'optRate' | 'money' | 'age' | 'flag';
export interface Field {
  /** "epf.eeRate": the scheme and the setting's own name in StatutorySettings. */
  key: string;
  scheme: SchemeId;
  /** Which group of boxes it sits in on the form. */
  group: string;
  label: string;
  kind: FieldKind;
  hint?: string;
}

export const SCHEMES: { id: SchemeId; short: string; name: string; malay: string }[] = [
  { id: 'epf', short: 'EPF', name: 'Employees Provident Fund', malay: 'KWSP' },
  { id: 'socso', short: 'SOCSO', name: 'Social security', malay: 'PERKESO' },
  { id: 'eis', short: 'EIS', name: 'Employment Insurance System', malay: 'SIP' },
  { id: 'lindung', short: 'LINDUNG 24 Jam', name: 'Non-work accident cover', malay: 'PERKESO' },
  { id: 'hrd', short: 'HRD levy', name: 'Training levy', malay: 'HRD Corp' },
];

/** Every setting the CEO can change, in the order the form shows them. */
export const FIELDS: Field[] = [
  { key: 'epf.eeRate', scheme: 'epf', group: 'Malaysian workers', label: 'Employee', kind: 'rate' },
  { key: 'epf.erRateLow', scheme: 'epf', group: 'Malaysian workers', label: 'Employer, wages up to the limit', kind: 'rate' },
  { key: 'epf.erRateHigh', scheme: 'epf', group: 'Malaysian workers', label: 'Employer, wages above the limit', kind: 'rate' },
  { key: 'epf.erLimit', scheme: 'epf', group: 'Malaysian workers', label: 'Wage limit', kind: 'money', hint: 'The lower employer rate applies up to this wage' },
  { key: 'epf.olderAge', scheme: 'epf', group: 'Older workers', label: 'From age', kind: 'age' },
  { key: 'epf.olderEeRate', scheme: 'epf', group: 'Older workers', label: 'Employee, from that age', kind: 'rate' },
  { key: 'epf.olderErRate', scheme: 'epf', group: 'Older workers', label: 'Employer, from that age', kind: 'rate' },
  { key: 'epf.foreignEeRate', scheme: 'epf', group: 'Foreign workers', label: 'Employee (foreign)', kind: 'rate' },
  { key: 'epf.foreignErRate', scheme: 'epf', group: 'Foreign workers', label: 'Employer (foreign)', kind: 'rate' },
  { key: 'epf.bands', scheme: 'epf', group: 'How wages are counted', label: 'Count wages in the KWSP bands and round up to the ringgit', kind: 'flag' },
  { key: 'socso.eeRate', scheme: 'socso', group: 'Rates', label: 'Employee', kind: 'rate' },
  { key: 'socso.erRate', scheme: 'socso', group: 'Rates', label: 'Employer', kind: 'rate' },
  { key: 'socso.wageCap', scheme: 'socso', group: 'Rates', label: 'Wage cap', kind: 'money', hint: 'Wages above this are not counted' },
  { key: 'socso.olderAge', scheme: 'socso', group: 'Older workers', label: 'From age', kind: 'age' },
  { key: 'socso.olderErRate', scheme: 'socso', group: 'Older workers', label: 'Employer, from that age', kind: 'rate', hint: 'The employee pays nothing from that age' },
  { key: 'eis.eeRate', scheme: 'eis', group: 'Rates', label: 'Employee', kind: 'rate' },
  { key: 'eis.erRate', scheme: 'eis', group: 'Rates', label: 'Employer', kind: 'rate' },
  { key: 'eis.wageCap', scheme: 'eis', group: 'Rates', label: 'Wage cap', kind: 'money', hint: 'Wages above this are not counted' },
  { key: 'eis.minAge', scheme: 'eis', group: 'Who pays', label: 'From age', kind: 'age' },
  { key: 'eis.maxAge', scheme: 'eis', group: 'Who pays', label: 'Stops at age', kind: 'age' },
  { key: 'eis.malaysiansOnly', scheme: 'eis', group: 'Who pays', label: 'Malaysians only', kind: 'flag' },
  { key: 'lindung.rate', scheme: 'lindung', group: 'Rates', label: 'Employee', kind: 'optRate', hint: 'Leave empty to keep the dated rates in the LINDUNG rule' },
  { key: 'lindung.wageCap', scheme: 'lindung', group: 'Rates', label: 'Wage cap', kind: 'money', hint: 'Used only with a rate typed here' },
  { key: 'hrd.rate', scheme: 'hrd', group: 'Rates', label: 'Employer', kind: 'rate', hint: 'On basic pay and fixed allowances' },
  { key: 'hrd.malaysiansOnly', scheme: 'hrd', group: 'Rates', label: 'Malaysian employees only', kind: 'flag' },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A rate as typed in a box: 0.0175 is "1.75" (the pre-P98 form's own conversion). */
export function pctInput(n: number | null | undefined): string {
  return n == null ? '' : String(Math.round(n * 100000) / 1000);
}
/** A rate as read on screen: "1.75%". */
export function pctText(n: number | null | undefined): string {
  return n == null ? '' : `${pctInput(n)}%`;
}
/** "RM 6,000", or "RM 6,000.50" when there are sen. */
export function rmText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const v = r2(n);
  const whole = Number.isInteger(v);
  return `RM ${v.toLocaleString('en-MY', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
/** A typed amount or age with an RM, commas (thousands) or spaces taken out; empty stays empty. */
function clean(s: string): string {
  return String(s ?? '')
    .replace(/rm/gi, '')
    .replace(/[\s,]/g, '');
}
/** A typed rate with a % sign or spaces taken out. A comma is not a decimal point here: "1,75" is refused, never 175%. */
function cleanRate(s: string): string {
  return String(s ?? '').replace(/[\s%]/g, '');
}
/** A typed rate as a fraction, as before P98 (Number(typed) / 100); empty is NaN, which the checks refuse. */
export function fromPct(s: string): number {
  const t = cleanRate(s);
  return t === '' ? NaN : Number(t) / 100;
}
/** A typed amount or age, as before P98 (Number(typed)); empty is NaN. */
export function fromNum(s: string): number {
  const t = clean(s);
  return t === '' ? NaN : Number(t);
}

export type Draft = Record<string, string>;
export interface OtherDraft {
  code: string;
  name: string;
  eeRate: string;
  erRate: string;
  wageCap: string;
  includeOt: boolean;
  appliesTo: StatutoryOther['appliesTo'];
  maxAge: string;
  payee: string;
}

function read(s: StatutorySettings, key: string): unknown {
  const [a, b] = key.split('.') as [SchemeId, string];
  return (s[a] as unknown as Record<string, unknown>)[b];
}

/** The boxes filled with the given settings. */
export function draftOf(s: StatutorySettings): Draft {
  const d: Draft = {};
  for (const f of FIELDS) {
    const v = read(s, f.key);
    d[f.key] = f.kind === 'flag' ? (v ? 'yes' : 'no') : f.kind === 'rate' || f.kind === 'optRate' ? pctInput(v as number | null) : v == null ? '' : String(v);
  }
  return d;
}
export function otherDraftOf(o: StatutoryOther): OtherDraft {
  return {
    code: o.code,
    name: o.name,
    eeRate: pctInput(o.eeRate),
    erRate: pctInput(o.erRate),
    wageCap: o.wageCap == null ? '' : String(o.wageCap),
    includeOt: o.includeOt,
    appliesTo: o.appliesTo,
    maxAge: o.maxAge == null ? '' : String(o.maxAge),
    payee: o.payee,
  };
}
export const BLANK_OTHER: OtherDraft = { code: '', name: '', eeRate: '0', erRate: '0', wageCap: '', includeOt: false, appliesTo: 'all', maxAge: '', payee: '' };

function value(f: Field, typed: string): number | boolean | null {
  if (f.kind === 'flag') return typed === 'yes';
  if (f.kind === 'optRate') return cleanRate(typed) === '' ? null : fromPct(typed);
  if (f.kind === 'rate') return fromPct(typed);
  return fromNum(typed);
}

/** A new contribution as sent: a blank rate is 0 and a blank cap or age is none, as before P98. */
export function otherOf(o: OtherDraft): StatutoryOther {
  return {
    code: o.code.trim().toUpperCase(),
    name: o.name,
    eeRate: cleanRate(o.eeRate) === '' ? 0 : fromPct(o.eeRate),
    erRate: cleanRate(o.erRate) === '' ? 0 : fromPct(o.erRate),
    wageCap: clean(o.wageCap) === '' ? null : fromNum(o.wageCap),
    includeOt: o.includeOt,
    appliesTo: o.appliesTo,
    maxAge: clean(o.maxAge) === '' ? null : fromNum(o.maxAge),
    payee: o.payee,
  };
}

/** The settings to send: the starting settings with every box's value in place. */
export function settingsOf(start: StatutorySettings, d: Draft, others: OtherDraft[], lawRef: string): StatutorySettings {
  const out = { ...start, epf: { ...start.epf }, socso: { ...start.socso }, eis: { ...start.eis }, lindung: { ...start.lindung }, hrd: { ...start.hrd } };
  for (const f of FIELDS) {
    const [a, b] = f.key.split('.') as [SchemeId, string];
    (out[a] as unknown as Record<string, unknown>)[b] = value(f, d[f.key] ?? '');
  }
  return { ...out, others: others.map(otherOf), lawRef };
}

/** One box's problem, in the words of the server's check (statutory.ts statutoryProblem); null when fine. */
export function fieldProblem(f: Field, typed: string, d?: Draft): string | null {
  if (f.kind === 'flag') return null;
  const rate = f.kind === 'rate' || f.kind === 'optRate';
  const t = rate ? cleanRate(typed) : clean(typed);
  if (f.kind === 'optRate' && t === '') return null;
  if (t === '') return f.kind === 'money' ? 'Enter an amount in ringgit.' : f.kind === 'age' ? 'Enter an age.' : 'Enter a rate in percent.';
  const n = Number(t);
  if (!Number.isFinite(n)) return f.kind === 'money' ? 'Enter an amount in ringgit, like 6,000.' : f.kind === 'age' ? 'Enter an age in whole years.' : 'Enter a rate in percent, like 11 or 1.75.';
  if (rate) return n < 0 || n > 50 ? 'A rate must be between 0% and 50%.' : null;
  if (f.kind === 'money') return n <= 0 || n > 1_000_000 ? 'Enter an amount above RM 0, up to RM 1,000,000.' : null;
  if (!Number.isInteger(n) || n < 14 || n > 100) return 'An age must be a whole number from 14 to 100.';
  if (f.key === 'eis.maxAge' && d) {
    const min = Number(clean(d['eis.minAge'] ?? ''));
    if (Number.isFinite(min) && min >= n) return 'Must be above the starting age.';
  }
  return null;
}

/** A new contribution's problems by box (code, name, rates, cap, age, paid to); empty when fine. */
export function otherProblems(o: OtherDraft, all: OtherDraft[], index: number): Partial<Record<keyof OtherDraft, string>> {
  const p: Partial<Record<keyof OtherDraft, string>> = {};
  const code = o.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(code)) p.code = 'A short code in capitals, 2 to 16 letters or digits.';
  else if (['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'HRD', 'PCB'].includes(code) || all.some((x, k) => k < index && x.code.trim().toUpperCase() === code)) p.code = 'This code is already used.';
  if (o.name.trim().length < 3) p.name = 'Name it (at least 3 letters).';
  const rate = (s: string) => (cleanRate(s) === '' ? 0 : fromPct(s));
  const ee = rate(o.eeRate);
  const er = rate(o.erRate);
  if (!(ee >= 0 && ee <= 0.5)) p.eeRate = 'A rate must be between 0% and 50%.';
  if (!(er >= 0 && er <= 0.5)) p.erRate = 'A rate must be between 0% and 50%.';
  if (!p.eeRate && !p.erRate && ee === 0 && er === 0) p.erRate = 'Give the employee or the employer rate.';
  if (clean(o.wageCap) !== '') {
    const c = fromNum(o.wageCap);
    if (!(c > 0 && c <= 1_000_000)) p.wageCap = 'Enter an amount above RM 0, or leave it empty for no cap.';
  }
  if (clean(o.maxAge) !== '') {
    const a = fromNum(o.maxAge);
    if (!(Number.isInteger(a) && a >= 14 && a <= 100)) p.maxAge = 'An age from 14 to 100, or leave it empty for all ages.';
  }
  if (o.payee.trim().length < 2) p.payee = 'Say who it is paid to.';
  return p;
}

export interface Change {
  key: string;
  scheme: string;
  label: string;
  before: string;
  after: string;
}

function shown(f: Field, v: unknown): string {
  if (f.kind === 'flag') return v ? 'Yes' : 'No';
  if (f.kind === 'optRate') return v == null ? 'Dated rule' : pctText(v as number);
  if (f.kind === 'rate') return pctText(v as number);
  if (f.kind === 'money') return rmText(v as number);
  return String(v);
}
/** A new contribution on one line: "Employee 1% · Employer 2% · Cap RM 3,000 · Not on overtime · Everyone · Paid to X". */
export const otherLine = (o: StatutoryOther) =>
  [
    `Employee ${pctText(o.eeRate)}`,
    `Employer ${pctText(o.erRate)}`,
    o.wageCap != null ? `Cap ${rmText(o.wageCap)}` : 'No cap',
    o.includeOt ? 'Overtime counts' : 'Not on overtime',
    appliesText(o),
    `Paid to ${o.payee}`,
  ].join(' · ');

/** What differs between two sets of settings, setting by setting, in the form's order. */
export function changes(before: StatutorySettings, after: StatutorySettings): Change[] {
  const out: Change[] = [];
  for (const f of FIELDS) {
    const a = read(before, f.key);
    const b = read(after, f.key);
    if (a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12)) continue;
    out.push({ key: f.key, scheme: SCHEMES.find((s) => s.id === f.scheme)!.short, label: f.label, before: shown(f, a), after: shown(f, b) });
  }
  const was = new Map(before.others.map((o) => [o.code, o]));
  const now = new Map(after.others.map((o) => [o.code, o]));
  for (const [code, o] of now) {
    const p = was.get(code);
    if (!p) out.push({ key: `other.${code}`, scheme: code, label: o.name, before: 'None', after: otherLine(o) });
    else if (JSON.stringify(p) !== JSON.stringify(o)) out.push({ key: `other.${code}`, scheme: code, label: o.name, before: otherLine(p), after: otherLine(o) });
  }
  for (const [code, o] of was) if (!now.has(code)) out.push({ key: `other.${code}`, scheme: code, label: o.name, before: otherLine(o), after: 'Removed' });
  return out;
}

export interface Problem {
  /** The scheme or the new contribution's code, when the problem is in one box. */
  where?: string;
  /** True when `where` is a code typed by a person (shown as typed, never translated). */
  whereRaw?: boolean;
  /** The box's label. */
  label?: string;
  text: string;
}

/** Everything that stops a change being sent: each box, each new contribution, the reference, the reason and the month. */
export function draftProblems(
  start: StatutorySettings,
  d: Draft,
  others: OtherDraft[],
  lawRef: string,
  reason: string,
  from: string,
  earliest: string,
): Problem[] {
  const out: Problem[] = [];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) out.push({ text: 'Pick the month the change starts.' });
  else if (from < earliest) out.push({ text: 'A change can start from last month at the earliest.' });
  for (const f of FIELDS) {
    const p = fieldProblem(f, d[f.key] ?? '', d);
    if (p) out.push({ where: SCHEMES.find((s) => s.id === f.scheme)!.short, label: f.label, text: p });
  }
  others.forEach((o, i) => {
    for (const p of Object.values(otherProblems(o, others, i))) out.push(o.code.trim() ? { where: o.code.trim().toUpperCase(), whereRaw: true, text: p } : { where: 'New contribution', text: p });
  });
  if (others.length > 10) out.push({ text: 'At most 10 new contribution types.' });
  if (lawRef.trim().length < 5) out.push({ text: 'Give the law or gazette reference.' });
  if (reason.trim().length < 5) out.push({ text: 'Say why the rates change.' });
  // The server's own check, last: anything it would refuse that the boxes above did not catch.
  if (!out.length) {
    const p = statutoryProblem(settingsOf(start, d, others, lawRef));
    if (p) out.push({ text: p });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 2026" (the screen translator knows short month names). */
export function monthText(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`.trim();
}
export function prevMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export type VersionState = 'in_force' | 'scheduled' | 'earlier' | 'replaced';
export interface HistoryRow {
  v: StatutoryVersion;
  state: VersionState;
  /** Against what was in force the month before it started (the law as at November 2026 before any change). */
  changes: Change[];
}

/** The version the pay run reads for a month (statutoryFor's choice), or null for the built-in law. */
export function versionFor(versions: StatutoryVersion[], month: string): StatutoryVersion | null {
  return (
    versions
      .filter((x) => !x.replacedBy && x.effectiveFrom <= month)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.setAt.localeCompare(a.setAt))[0] ?? null
  );
}

/** Each change with its state and what it changed, newest month first (as the server lists them). */
export function history(versions: StatutoryVersion[], month: string): HistoryRow[] {
  const now = versionFor(versions, month);
  return versions.map((v) => ({
    v,
    state: v.replacedBy ? 'replaced' : now && v.id === now.id ? 'in_force' : v.effectiveFrom > month ? 'scheduled' : 'earlier',
    changes: changes(
      statutoryFor(
        versions.filter((x) => x.id !== v.id && x.effectiveFrom < v.effectiveFrom),
        prevMonth(v.effectiveFrom),
      ),
      { ...DEFAULT_STATUTORY, ...v.settings, others: v.settings.others ?? [] },
    ),
  }));
}

/** The next change already set after this month, if any. */
export function nextChange(versions: StatutoryVersion[], month: string): StatutoryVersion | null {
  return versions.filter((x) => !x.replacedBy && x.effectiveFrom > month).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
}

/** The settings a change from `from` starts with: what the pay run would read for that month today. */
export function startFor(versions: StatutoryVersion[], from: string): StatutorySettings {
  return statutoryFor(versions, from);
}

export interface RateRow {
  key: string;
  who: string;
  note?: string;
  ee: string;
  er: string;
  /** This row applies now (for the dated LINDUNG rule). */
  now?: boolean;
}
export interface Fact {
  label: string;
  value: string;
}
export interface SchemeView {
  id: SchemeId;
  short: string;
  name: string;
  malay: string;
  rows: RateRow[];
  facts: Fact[];
}

/** The rates in force as tables a person reads: who, what the employee pays, what the employer pays. */
export function schemeViews(s: StatutorySettings, month: string): SchemeView[] {
  const head = (id: SchemeId) => SCHEMES.find((x) => x.id === id)!;
  const e = s.epf;
  const so = s.socso;
  const ei = s.eis;
  const rule = RULES.lindung.value;
  const ruleNow = [...rule.rates].reverse().find((r) => r.from <= month);
  return [
    {
      ...head('epf'),
      rows: [
        { key: 'low', who: 'Malaysian workers', note: `Wages up to ${rmText(e.erLimit)}`, ee: pctText(e.eeRate), er: pctText(e.erRateLow) },
        { key: 'high', who: 'Malaysian workers', note: `Wages above ${rmText(e.erLimit)}`, ee: pctText(e.eeRate), er: pctText(e.erRateHigh) },
        { key: 'older', who: `Aged ${e.olderAge} and over`, note: 'Malaysian workers', ee: pctText(e.olderEeRate), er: pctText(e.olderErRate) },
        { key: 'foreign', who: 'Foreign workers', note: 'All ages', ee: pctText(e.foreignEeRate), er: pctText(e.foreignErRate) },
      ],
      facts: [
        { label: 'Wages counted', value: e.bands ? 'In KWSP bands, rounded up to the ringgit' : 'Exact wages, to the sen' },
        { label: 'Overtime', value: 'Never counted' },
      ],
    },
    {
      ...head('socso'),
      rows: [
        { key: 'under', who: `Under ${so.olderAge}`, ee: pctText(so.eeRate), er: pctText(so.erRate) },
        { key: 'older', who: `Aged ${so.olderAge} and over`, ee: pctText(0), er: pctText(so.olderErRate) },
      ],
      facts: [{ label: 'Wage cap', value: rmText(so.wageCap) }],
    },
    {
      ...head('eis'),
      rows: [{ key: 'ages', who: `Ages ${ei.minAge} to ${ei.maxAge - 1}`, note: ei.malaysiansOnly ? 'Malaysians only' : 'Everyone', ee: pctText(ei.eeRate), er: pctText(ei.erRate) }],
      facts: [
        { label: 'Wage cap', value: rmText(ei.wageCap) },
        { label: 'Not covered', value: `Under ${ei.minAge} and from ${ei.maxAge}` },
      ],
    },
    {
      ...head('lindung'),
      rows:
        s.lindung.rate == null
          ? rule.rates.map((r) => ({ key: r.from, who: `From ${monthText(r.from)}`, note: r === ruleNow ? 'In force now' : r.from > month ? 'Coming' : 'Earlier', ee: pctText(r.rate), er: 'None', now: r === ruleNow }))
          : [{ key: 'set', who: 'All workers', note: 'Set by the CEO', ee: pctText(s.lindung.rate), er: 'None', now: true }],
      facts: [
        { label: 'Wage cap', value: rmText(s.lindung.rate == null ? rule.wageCeiling : s.lindung.wageCap) },
        { label: 'Who pays', value: 'Malaysians may opt out with a form on file; foreign workers always pay' },
      ],
    },
    {
      ...head('hrd'),
      rows: [{ key: 'levy', who: s.hrd.malaysiansOnly ? 'Malaysian employees' : 'All employees', note: 'On basic pay and fixed allowances', ee: 'None', er: pctText(s.hrd.rate) }],
      facts: [{ label: 'Paid to', value: 'HRD Corp, by the employer' }],
    },
  ];
}

/** Who a new contribution applies to, in words. */
export function appliesText(o: Pick<StatutoryOther, 'appliesTo' | 'maxAge'>): string {
  const who = o.appliesTo === 'all' ? 'Everyone' : o.appliesTo === 'malaysian' ? 'Malaysians' : 'Foreign workers';
  return o.maxAge != null ? `${who}, under ${o.maxAge}` : who;
}

/** The headline pairs for the summary: what each scheme takes from the worker and what the employer adds. */
export function glance(s: StatutorySettings, month: string): { key: string; label: string; ee: string; er: string }[] {
  const rule = RULES.lindung.value;
  const lindung = s.lindung.rate ?? [...rule.rates].reverse().find((r) => r.from <= month)?.rate ?? 0;
  return [
    { key: 'epf', label: 'EPF', ee: pctText(s.epf.eeRate), er: pctText(s.epf.erRateLow) },
    { key: 'socso', label: 'SOCSO', ee: pctText(s.socso.eeRate), er: pctText(s.socso.erRate) },
    { key: 'eis', label: 'EIS', ee: pctText(s.eis.eeRate), er: pctText(s.eis.erRate) },
    { key: 'lindung', label: 'LINDUNG', ee: pctText(lindung), er: 'None' },
    { key: 'hrd', label: 'HRD', ee: 'None', er: pctText(s.hrd.rate) },
    ...s.others.map((o) => ({ key: `o-${o.code}`, label: o.code, ee: pctText(o.eeRate), er: pctText(o.erRate) })),
  ];
}
