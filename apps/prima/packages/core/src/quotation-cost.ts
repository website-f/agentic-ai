import { RULES } from './rules';
import { DEFAULT_STATUTORY, type StatutorySettings } from './statutory';
import { eisShare, epfShare, socsoShare } from './payroll';
import { FIN_SITE_COST_LABEL, type FinSiteCostKind } from './finance-site-checks';

/**
 * C10 (Fauzan, 11 Nov 2026): cost checks on quotations. The monthly cost of one guard is worked out from the minimum
 * wage, overtime for the shift length, and the employer's EPF, SOCSO and EIS; plus hostel and transport for Nepali
 * guards and uniform and equipment for every guard. Each of those four uses the rate entered in the system (C5); a
 * rate not entered is "rate not set", never zero. A price below the cost is flagged with the reason; it is a flag for
 * the approver, never an automatic refusal.
 */
export interface QuotationCostCheck {
  perGuard: { local: number; nepali: number | null };
  lines: { label: string; local: number | null; nepali: number | null }[];
  monthlyCost: number | null;
  monthlyPrice: number;
  below: boolean;
  missing: string[];
  reasons: string[];
  basis: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Rest taken in each shift, unpaid (one hour), and the normal hours of a six-day week at the 45-hour limit. */
const REST_HOURS = 1;
const NORMAL_HOURS = 7.5;
const DAYS = 26;
const OT_RATE = 1.5;
const AGE = 30;

export function quotationCostCheck(
  q: { guards: number; nepaliGuards?: number; hoursPerDay: number; ratePerGuard: number },
  rates: Partial<Record<FinSiteCostKind, number>>,
  st: StatutorySettings = DEFAULT_STATUTORY,
): QuotationCostCheck {
  const nepali = Math.min(q.guards, Math.max(0, Math.round(q.nepaliGuards ?? 0)));
  const local = q.guards - nepali;
  const basic = RULES.minimumWage.value.monthly;
  const otHours = Math.max(0, q.hoursPerDay - REST_HOURS - NORMAL_HOURS) * DAYS;
  const ot = r2(otHours * (basic / DAYS / NORMAL_HOURS) * OT_RATE);
  const wages = basic + ot;
  const missing: string[] = [];
  const rate = (k: FinSiteCostKind, needed: boolean): number | null => {
    const v = rates[k];
    if (v == null) {
      if (needed) missing.push(FIN_SITE_COST_LABEL[k]);
      return null;
    }
    return v;
  };
  const uniform = rate('uniform', true);
  const equipment = rate('equipment', true);
  const hostel = rate('hostel_foreign', nepali > 0);
  const transport = rate('transport_foreign', nepali > 0);
  const lines: QuotationCostCheck['lines'] = [
    { label: `Minimum wage (RM${basic} a month)`, local: basic, nepali: nepali ? basic : null },
    { label: `Overtime, ${r2(otHours)} hours a month at ${OT_RATE}x`, local: ot, nepali: nepali ? ot : null },
    { label: 'EPF (employer)', local: epfShare(basic, AGE, 'MY', st).er, nepali: nepali ? epfShare(basic, AGE, 'NP', st).er : null },
    { label: 'SOCSO (employer)', local: socsoShare(wages, AGE, st).er, nepali: nepali ? Math.round(Math.min(wages, st.socso.wageCap) * st.socso.olderErRate * 20) / 20 : null },
    { label: 'EIS (employer)', local: eisShare(wages, AGE, 'MY', st).er, nepali: nepali ? 0 : null },
    { label: FIN_SITE_COST_LABEL.uniform, local: uniform, nepali: nepali ? uniform : null },
    { label: FIN_SITE_COST_LABEL.equipment, local: equipment, nepali: nepali ? equipment : null },
  ];
  if (nepali) {
    lines.push({ label: FIN_SITE_COST_LABEL.hostel_foreign, local: null, nepali: hostel });
    lines.push({ label: FIN_SITE_COST_LABEL.transport_foreign, local: null, nepali: transport });
  }
  const sum = (k: 'local' | 'nepali') => r2(lines.reduce((n, l) => n + (l[k] ?? 0), 0));
  const perLocal = sum('local');
  const perNepali = nepali ? sum('nepali') : null;
  const monthlyPrice = r2(q.guards * q.ratePerGuard);
  const known = r2(local * perLocal + nepali * (perNepali ?? 0));
  const monthlyCost = missing.length ? null : known;
  const reasons: string[] = [];
  if (q.ratePerGuard < perLocal || (perNepali != null && q.ratePerGuard < perNepali))
    reasons.push(`RM${q.ratePerGuard.toFixed(2)} a guard is below the cost of one guard (RM${perLocal.toFixed(2)} local${perNepali != null ? `, RM${perNepali.toFixed(2)} Nepali` : ''})`);
  if (monthlyPrice < known)
    reasons.push(`RM${monthlyPrice.toFixed(2)} a month is below the cost of RM${known.toFixed(2)}${missing.length ? ' even before the rates not set' : ''}`);
  if (missing.length) reasons.push(`Rate not set: ${missing.join(', ')}. The Finance Director enters it; the cost check is incomplete until then.`);
  return {
    perGuard: { local: perLocal, nepali: perNepali },
    lines,
    monthlyCost,
    monthlyPrice,
    below: reasons.length > (missing.length ? 1 : 0),
    missing,
    reasons,
    basis: `${q.hoursPerDay}-hour shift, ${DAYS} days, ${REST_HOURS} hour rest, ${NORMAL_HOURS} normal hours a day; minimum wage and statutory rates as in Pay law settings.`,
  };
}
