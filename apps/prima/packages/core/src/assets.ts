// Fixed asset depreciation (AST-DEPN, a proposal for the Finance Director and auditors): straight line over the
// useful life, no residual value, starting the month after purchase and stopping in the month of disposal.
import { RULES } from './rules';
import type { AmAsset } from './types';

const monthIndex = (isoOrPeriod: string) => Number(isoOrPeriod.slice(0, 4)) * 12 + Number(isoOrPeriod.slice(5, 7)) - 1;

/** The period (YYYY-MM) a number of months before the given one. */
export function periodBefore(period: string, months = 1): string {
  const i = monthIndex(period) - months;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Depreciation charged on an asset up to the end of a period. */
export function accumulatedDepn(a: AmAsset, period: string): number {
  const life = RULES.fixedAssets.value.lifeYears[a.category] * 12;
  let months = monthIndex(period) - monthIndex(a.boughtOn);
  if (a.disposal?.done) months = Math.min(months, monthIndex(a.disposal.done.on) - monthIndex(a.boughtOn));
  months = Math.max(0, Math.min(life, months));
  return Math.round(((a.cost * months) / life) * 100) / 100;
}

/** The charge for one month. */
export function monthDepn(a: AmAsset, period: string): number {
  return Math.round((accumulatedDepn(a, period) - accumulatedDepn(a, periodBefore(period))) * 100) / 100;
}

export function netBookValue(a: AmAsset, period: string): number {
  return Math.round((a.cost - accumulatedDepn(a, period)) * 100) / 100;
}
