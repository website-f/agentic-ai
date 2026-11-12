import { epfShare } from "./payroll";
import { eisShare } from "./payroll";
import { socsoShare } from "./payroll";
import type { PayLawSettings } from "./pay-formulas";
import { rateFor } from "./rate-book";
import type { RateKey } from "./rate-book";
import { RATE_INFO } from "./rate-book";
import { RULES } from "./rules";
import type { StatutorySettings } from "./statutory";
import type { FinStatus } from "./types";
import type { IsoDateTime } from "./types";

/**
 * C10 (Fauzan, 11 Nov 2026: "Yes to minimum wage, OT, EPF, SOCSO, EIS. Also hostel cost and transport cost when the
 * guards are Nepali, and costs like uniform and equipment"): the cost of a quotation's guards for a month, worked from
 * the pay law in force (minimum wage, normal hours, day divisor, lowest overtime rate), the statutory rates in force,
 * and the rates entered in the rate book (C5). A missing rate is "rate not set", never zero: the check is then
 * incomplete and says which rate is missing. A price below the total cost is flagged with the reason.
 */
export type QuoteCostKey = 'wage' | 'overtime' | 'epf' | 'socso' | 'eis' | RateKey;

export interface QuoteCostLine {
  key: QuoteCostKey;
  label: string;
  /** RM per guard a month (for the guards it applies to); null when its rate is not set. */
  perGuard: number | null;
  /** How many guards it applies to. */
  guards: number;
  amount: number | null;
  note: string;
}

export interface QuoteCostCheck {
  /** The month whose rates were used (YYYY-MM). */
  month: string;
  lines: QuoteCostLine[];
  totalCost: number | null;
  price: number;
  status: 'ok' | 'below_cost' | 'incomplete';
  /** Price less cost, when the cost is known (negative: below cost). */
  margin: number | null;
  reasons: string[];
  at: IsoDateTime;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The minimum wage for the month: the announced next step once it is gazetted and in force, else the current one. */
export function quoteMinimumWage(law: PayLawSettings, month: string): number {
  const n = law.nextMinimumWage;
  return n && n.gazetted && n.from <= month ? n.amount : law.minimumWage;
}

export function quoteCostCheck(
  q: { guards: number; nepaliGuards?: number | null; hoursPerDay: number; monthlyTotal: number },
  month: string,
  law: PayLawSettings,
  st: StatutorySettings,
  fin: Pick<FinStatus, 'rateLog'> | null | undefined,
  at: IsoDateTime,
): QuoteCostCheck {
  const age = RULES.quoteCost.value.ageForStatutory;
  const nepali = Math.min(Math.max(0, Math.round(q.nepaliGuards ?? 0)), q.guards);
  const local = q.guards - nepali;
  const wage = quoteMinimumWage(law, month);
  const days = law.ordinaryRateDivisor;
  const normal = law.normalHoursDayMax;
  const hourly = wage / days / normal;
  const otHours = Math.max(0, q.hoursPerDay - normal) * days;
  const ot = r2(otHours * hourly * law.otMinNormal);
  const gross = wage + ot;
  // EPF is on basic pay (overtime is not EPF wages); SOCSO and EIS are on the wages including overtime.
  const epf = (nat: 'MY' | 'NP') => epfShare(wage, age, nat, st).er;
  const socso = socsoShare(gross, age, st).er;
  const eis = (nat: 'MY' | 'NP') => eisShare(gross, age, nat, st).er;
  const lines: QuoteCostLine[] = [
    { key: 'wage', label: 'Minimum wage', perGuard: r2(wage), guards: q.guards, amount: r2(wage * q.guards), note: `Pay law in force for ${month}` },
    {
      key: 'overtime',
      label: 'Overtime',
      perGuard: ot,
      guards: q.guards,
      amount: r2(ot * q.guards),
      note: otHours ? `${q.hoursPerDay - normal} h a day over ${normal} h, ${days} days, at ${law.otMinNormal}x the hourly rate` : `No overtime on ${q.hoursPerDay}-hour shifts`,
    },
    {
      key: 'epf',
      label: 'EPF (employer)',
      perGuard: null,
      guards: q.guards,
      amount: r2(epf('MY') * local + epf('NP') * nepali),
      note: 'On basic pay; overtime is not EPF wages',
    },
    { key: 'socso', label: 'SOCSO (employer)', perGuard: socso, guards: q.guards, amount: r2(socso * q.guards), note: 'On wages with overtime' },
    { key: 'eis', label: 'EIS (employer)', perGuard: null, guards: q.guards, amount: r2(eis('MY') * local + eis('NP') * nepali), note: 'Malaysians only' },
  ];
  const reasons: string[] = [];
  for (const key of ['hostel_np', 'transport_np', 'uniform', 'equipment'] as RateKey[]) {
    const n = RATE_INFO[key].who === 'nepali' ? nepali : q.guards;
    const r = rateFor(fin, key, month);
    if (!n) {
      lines.push({ key, label: RATE_INFO[key].label, perGuard: r?.amount ?? null, guards: 0, amount: 0, note: 'No Nepali guards on this quotation' });
      continue;
    }
    if (!r) {
      lines.push({ key, label: RATE_INFO[key].label, perGuard: null, guards: n, amount: null, note: 'Rate not set' });
      reasons.push(`${RATE_INFO[key].label}: rate not set for ${month} (Finance Director or CEO, Rate book)`);
      continue;
    }
    lines.push({ key, label: RATE_INFO[key].label, perGuard: r.amount, guards: n, amount: r2(r.amount * n), note: `Rate from ${r.from}` });
  }
  const known = lines.every((l) => l.amount != null);
  const totalCost = known ? r2(lines.reduce((s, l) => s + (l.amount ?? 0), 0)) : null;
  const margin = totalCost == null ? null : r2(q.monthlyTotal - totalCost);
  let status: QuoteCostCheck['status'] = 'ok';
  if (!known) status = 'incomplete';
  else if (q.monthlyTotal < totalCost!) {
    status = 'below_cost';
    const top = [...lines].filter((l) => (l.amount ?? 0) > 0).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 3);
    reasons.unshift(
      `Priced at ${rm(q.monthlyTotal)} a month, ${rm(-margin!)} below the cost of ${rm(totalCost!)} (${top.map((l) => `${l.label.toLowerCase()} ${rm(l.amount!)}`).join(', ')}).`,
    );
  }
  return { month, lines, totalCost, price: r2(q.monthlyTotal), status, margin, reasons, at };
}
