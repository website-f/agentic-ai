// Site visit and briefing tracker (Marketing item AH13, Fauzan 23 Nov 2026 "Build"). Many government tenders let only
// the person named on the company's MOF certificate attend the briefing or site visit, and a bid without the attendance
// slip is rejected. Marketing cannot go in the company's place, so the company names its person on day 1, Prima chases
// until someone is named, and the slip is kept. Pure functions; the service checks who may act.
import { RULES } from './rules';
import { daysBetween } from './time';
import type { IsoDate, Tender, TenderAttendance, TenderAttendanceKind } from './types';

export const ATTENDANCE_LABEL: Record<TenderAttendanceKind, string> = { BRIEFING: 'Briefing', SITE_VISIT: 'Site visit' };

/** NAME: nobody named yet. NAMED: named, date ahead. RECORD: the date has come, record whether they went. DONE / MISSED. */
export type AttendanceState = 'NAME' | 'NAMED' | 'RECORD' | 'DONE' | 'MISSED';

export interface AttendanceItem {
  kind: TenderAttendanceKind;
  label: string;
  on: IsoDate | null;
  mandatory: boolean;
  mofNamedOnly: boolean;
  place: string;
  /** Days from today to the date; negative once it has passed; null when no date is recorded. */
  days: number | null;
  state: AttendanceState;
  entry: TenderAttendance | null;
}

/** The briefing and the site visit recorded on a tender, each with what still has to happen. */
export function tenderAttendance(t: Tender, today: IsoDate): AttendanceItem[] {
  const r = t.record ?? {};
  const out: AttendanceItem[] = [];
  for (const [kind, ev] of [
    ['BRIEFING', r.briefing],
    ['SITE_VISIT', r.siteVisit],
  ] as const) {
    if (!ev) continue;
    const entry = (t.attendance ?? []).find((a) => a.kind === kind) ?? null;
    const days = ev.on ? daysBetween(today, ev.on) : null;
    const state: AttendanceState = entry?.result
      ? entry.result.attended
        ? 'DONE'
        : 'MISSED'
      : days != null && days <= 0
        ? 'RECORD'
        : entry
          ? 'NAMED'
          : 'NAME';
    out.push({ kind, label: ATTENDANCE_LABEL[kind], on: ev.on, mandatory: ev.mandatory, mofNamedOnly: !!ev.mofNamedOnly, place: ev.place ?? '', days, state, entry });
  }
  return out;
}

/**
 * What stops a bid from being lodged: a mandatory briefing or site visit whose date has passed with no record that the
 * company went. A missed mandatory one means the buyer will reject the bid, so it is not lodged.
 */
export function attendanceGaps(t: Tender, today: IsoDate): string[] {
  return tenderAttendance(t, today)
    .filter((a) => a.mandatory && a.on && a.on <= today && a.state !== 'DONE')
    .map((a) => (a.state === 'MISSED' ? `${a.label} on ${a.on} was missed` : `record the ${a.label.toLowerCase()} attendance slip`));
}

/** Within the urgent window a mandatory date with nobody named goes to the COO as well. */
export function attendanceUrgent(a: AttendanceItem): boolean {
  return a.mandatory && a.state === 'NAME' && a.days != null && a.days <= RULES.marketingDesk.value.visitUrgentDays;
}
