import { RULES } from "./rules";
import type {
  IsoDate,
  LeaveOverrideKind,
  Person,
  PublicHoliday,
} from "./types";

/**
 * HR Phase 3, slice 3C: leave in full (Fauzan, 2 Nov 2026).
 *
 * - Maternity (98 days) and paternity (7 days) leave under the Employment Act, which HR may raise for a staff member.
 * - Public holidays per state, kept by HR, who may add more than the Act's 11.
 * - Office staff leave counts working days: Saturdays, Sundays and public holidays are not taken from the balance.
 */

/** The public holidays that apply in a state, as a set of dates. A removed holiday no longer counts. */
export function holidayDates(
  list: PublicHoliday[],
  state: string | null,
): Set<IsoDate> {
  return new Set(
    list
      .filter(
        (h) =>
          !h.removed &&
          (h.states === null || (state !== null && h.states.includes(state))),
      )
      .map((h) => h.date),
  );
}

function weekday(d: IsoDate): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

function nextDay(d: IsoDate): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Working days from `from` to `to`, both counted: Monday to Friday, less public holidays (HR-STAFF-HOURS). */
export function officeLeaveDays(
  from: IsoDate,
  to: IsoDate,
  holidays: Set<IsoDate>,
): number {
  let n = 0;
  for (let d = from; d <= to; d = nextDay(d)) {
    const w = weekday(d);
    if (w !== 0 && w !== 6 && !holidays.has(d)) n++;
  }
  return n;
}

/** Leave counted in calendar days, as the Act gives it in consecutive days. */
export const CALENDAR_DAY_LEAVE = new Set([
  "MATERNITY",
  "PATERNITY",
  "HOSPITAL",
]);

/**
 * Whether a year's list for a state meets the Act: at least 11 days, and the five fixed ones present. Shown to HR as a
 * check, never a block: HR enters the gazetted dates.
 */
export function holidayYearCheck(
  list: PublicHoliday[],
  state: string | null,
  year: string,
) {
  const r = RULES.publicHolidays.value;
  const inYear = list.filter(
    (h) =>
      !h.removed &&
      h.date.startsWith(year) &&
      (h.states === null || (state !== null && h.states.includes(state))),
  );
  const have = new Set(inYear.map((h) => h.compulsory).filter(Boolean));
  const missing = r.compulsory.filter((c) => !have.has(c));
  return {
    year,
    state,
    count: new Set(inYear.map((h) => h.date)).size,
    min: r.minPerYear,
    missing,
    ok: missing.length === 0 && inYear.length >= r.minPerYear,
  };
}

export const COMPULSORY_HOLIDAY_LABEL: Record<
  (typeof RULES.publicHolidays.value.compulsory)[number],
  string
> = {
  NATIONAL_DAY: "National Day",
  AGONG_BIRTHDAY: "Agong's birthday",
  RULER_BIRTHDAY: "Ruler's birthday or Federal Territory Day",
  LABOUR_DAY: "Labour Day",
  MALAYSIA_DAY: "Malaysia Day",
};

/** The days the Act gives for maternity and paternity leave, and whether this staff member qualifies. */
export function familyLeaveEntitlement(p: Person, today: IsoDate) {
  const r = RULES.familyLeave.value;
  const months = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.hiredOn}T00:00:00Z`)) /
      86_400_000 /
      30.44,
  );
  const serviceDays = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.hiredOn}T00:00:00Z`)) /
      86_400_000,
  );
  const maternity =
    p.gender === "M"
      ? { days: 0, note: "Not for a male employee." }
      : {
          days: r.maternityDays,
          note:
            serviceDays < r.maternityPaidMinDays
              ? `Under ${r.maternityPaidMinDays} days of service: the leave is given, the maternity allowance may not be. HR checks.`
              : (p.children ?? 0) >= r.maternityPaidUnderChildren
                ? `${p.children} children on record: the Act pays the allowance for fewer than ${r.maternityPaidUnderChildren} surviving children. HR checks.`
                : null,
        };
  const paternity =
    p.gender === "F"
      ? { days: 0, note: "Not for a female employee." }
      : p.maritalStatus && p.maritalStatus !== "married"
        ? { days: 0, note: "For a married male employee." }
        : months < r.paternityMinMonths
          ? {
              days: 0,
              note: `After ${r.paternityMinMonths} months of service.`,
            }
          : { days: r.paternityDays, note: null };
  return { maternity, paternity };
}

/** The days HR gave above the Act, if any: never below the Act's number. */
export function withOverride(
  p: Person,
  kind: LeaveOverrideKind,
  lawDays: number,
): { days: number; byHr: boolean; note: string | null } {
  const o = p.leaveOverrides?.[kind];
  if (!o || o.days <= lawDays)
    return { days: lawDays, byHr: false, note: null };
  return {
    days: o.days,
    byHr: true,
    note: `${o.days} days given by HR (${o.by}): ${o.note}`,
  };
}
