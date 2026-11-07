/**
 * Yearly public holiday list (Fauzan, 6 Nov 2026; corrected the same day: "Od or ogm. Not om set the holidays"): "Om or ogm need to set the 11 days of public holiday per years each
 * 10 December every year. Guard not working on the day still been paid 7.5 hours as follow one work day."
 *
 * Employment Act 1955 s.60D: 11 paid public holidays a year, five of them National Day, the Yang di-Pertuan Agong's
 * birthday, the Ruler's birthday or Federal Territory Day, Labour Day and Malaysia Day; the employer posts the list at
 * the workplace before the year starts. A holiday on a rest day moves to the next working day; a holiday during
 * annual leave or sick leave is a holiday, not a leave day; a guard absent without consent or a good reason on the
 * working day just before or after a holiday is not paid for it (s.60D(2)). Not legal advice.
 *
 * A list is for one company and year, either for the whole company or for one state (state holidays differ). The pay
 * run takes the state list of the guard's site, or the whole-company list when there is none.
 */
import type { Id, IsoDate, IsoDateTime } from './types';
import { addDays } from './time';

export const PUBLIC_HOLIDAYS_A_YEAR = 11;
/** The list for next year is due by this day of December (Fauzan, 6 Nov 2026); reminders start on the 1st. */
export const HOLIDAY_LIST_DUE_DAY = 10;

export interface PublicHolidayDay {
  date: IsoDate;
  label: string;
}

export interface PublicHolidayList {
  id: Id;
  companyId: Id;
  year: number;
  /** null = the whole company; otherwise the state the list is for. */
  state: string | null;
  version: number;
  days: PublicHolidayDay[];
  reason: string;
  setBy: string;
  setById: Id;
  setByTier: 'ops_director' | 'ogm';
  setAt: IsoDateTime;
  /** The id of the list that replaced this one, when it was changed. */
  replacedBy: Id | null;
  /** Labour law points found when it was set (flags only; the list is saved as chosen). */
  lawFlags: string[];
}

/** Refuse only what cannot be used; every labour law point is a flag. */
export function holidayListCheck(year: number, days: PublicHolidayDay[]): { refuse: string | null; flags: string[] } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { refuse: 'Pick the year.', flags: [] };
  if (days.length !== PUBLIC_HOLIDAYS_A_YEAR) return { refuse: `Enter exactly ${PUBLIC_HOLIDAYS_A_YEAR} public holidays (you entered ${days.length}).`, flags: [] };
  const seen = new Set<string>();
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(Date.parse(`${d.date}T00:00:00Z`)) || new Date(`${d.date}T00:00:00Z`).toISOString().slice(0, 10) !== d.date)
      return { refuse: `"${d.date}" is not a date.`, flags: [] };
    if (Number(d.date.slice(0, 4)) !== year) return { refuse: `${d.date} is not in ${year}.`, flags: [] };
    if (seen.has(d.date)) return { refuse: `${d.date} is entered twice.`, flags: [] };
    seen.add(d.date);
    if (d.label.trim().length < 3) return { refuse: `Name the holiday on ${d.date}.`, flags: [] };
  }
  const flags: string[] = [];
  const has = (mmdd: string) => seen.has(`${year}-${mmdd}`);
  const named = (re: RegExp) => days.some((d) => re.test(d.label));
  if (!has('05-01')) flags.push('Labour Day (1 May) is one of the five compulsory holidays (EA s.60D(1)(a)).');
  if (!has('08-31')) flags.push('National Day (31 August) is one of the five compulsory holidays (EA s.60D(1)(a)).');
  if (!has('09-16')) flags.push('Malaysia Day (16 September) is one of the five compulsory holidays (EA s.60D(1)(a)).');
  if (!named(/agong/i)) flags.push("The Yang di-Pertuan Agong's birthday is one of the five compulsory holidays; no holiday is named for it.");
  if (!named(/sultan|raja|ruler|yang di-pertua\b|governor|tyt|wilayah|federal territory/i))
    flags.push("The Ruler's (or Governor's) birthday, or Federal Territory Day, is one of the five compulsory holidays; no holiday is named for it.");
  return { refuse: null, flags };
}

/** The list in force for a place: the state's own list, else the whole-company list. Replaced lists are ignored. */
export function holidayListFor(lists: PublicHolidayList[], companyId: Id, year: number, state: string | null): PublicHolidayList | null {
  const live = lists.filter((l) => l.companyId === companyId && l.year === year && !l.replacedBy);
  return (state ? live.find((l) => l.state === state) : undefined) ?? live.find((l) => l.state === null) ?? null;
}

/** Holiday dates in a month (YYYY-MM) for the pay run, from the list in force. */
export function holidaysInMonth(lists: PublicHolidayList[], companyId: Id, month: string, state: string | null): PublicHolidayDay[] {
  const l = holidayListFor(lists, companyId, Number(month.slice(0, 4)), state);
  return (l?.days ?? []).filter((d) => d.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One guard's holidays after the s.60D moves: a holiday on the guard's rest day moves to the next day that is neither a
 * rest day nor another holiday. A holiday on paid annual or sick leave stays a holiday (the leave day is not used).
 */
export function guardHolidayDates(holidays: IsoDate[], restDays: Set<IsoDate>): { date: IsoDate; movedFrom: IsoDate | null }[] {
  const taken = new Set(holidays);
  const out: { date: IsoDate; movedFrom: IsoDate | null }[] = [];
  for (const h of [...holidays].sort()) {
    if (!restDays.has(h)) {
      out.push({ date: h, movedFrom: null });
      continue;
    }
    let d = addDays(h, 1);
    while (restDays.has(d) || taken.has(d)) d = addDays(d, 1);
    taken.add(d);
    out.push({ date: d, movedFrom: h });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * s.60D(2): a guard absent without consent or a good reason on the working day just before or just after a holiday is
 * not paid for that holiday. `workingDays` are the guard's rostered working days; `absentWithoutLeave` are the days of
 * those the guard missed with no approved leave or accepted excuse.
 */
export function holidayPayLost(holiday: IsoDate, workingDays: IsoDate[], absentWithoutLeave: Set<IsoDate>): boolean {
  const sorted = [...workingDays].sort();
  const before = [...sorted].reverse().find((d) => d < holiday);
  const after = sorted.find((d) => d > holiday);
  return (!!before && absentWithoutLeave.has(before)) || (!!after && absentWithoutLeave.has(after));
}

/** Whether the list for `year` is due and whether it is late, on `today`. */
export function holidayListDue(year: number, today: IsoDate): { remind: boolean; late: boolean; dueOn: IsoDate } {
  const dueOn = `${year - 1}-12-${String(HOLIDAY_LIST_DUE_DAY).padStart(2, '0')}`;
  return { remind: today >= `${year - 1}-12-01`, late: today > dueOn, dueOn };
}
