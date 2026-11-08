import type { IsoDate, LeaveRequest } from './types';

export interface MedicalLeavePolicy {
  version: string;
  jurisdiction: 'EA' | 'SABAH' | 'SARAWAK' | 'MY_COMMON' | 'UNKNOWN';
  year: string;
  independent: boolean;
  reviewRequired: boolean;
  note: string | null;
}
const EA_STATES = new Set(['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Pulau Pinang', 'Perak', 'Perlis', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Putrajaya', 'Labuan']);
/** Full calendar-year balances only. No invented proration/reset in the 2025 Sabah/Sarawak transition. */
export function medicalLeavePolicy(on: IsoDate, state?: string | null): MedicalLeavePolicy {
  const year = on.slice(0, 4);
  const jurisdiction = state === 'Sabah' ? 'SABAH' : state === 'Sarawak' ? 'SARAWAK' : state && EA_STATES.has(state) ? 'EA' : !state && +year >= 2026 ? 'MY_COMMON' : 'UNKNOWN';
  const transition = (jurisdiction === 'SABAH' || jurisdiction === 'SARAWAK') && year === '2025';
  const reviewRequired = transition || jurisdiction === 'UNKNOWN';
  const independent = jurisdiction === 'EA' ? +year >= 2023 : +year >= 2026;
  return {
    version: `${jurisdiction}-${reviewRequired ? 'REVIEW' : independent ? 'SEPARATE-60' : 'HISTORIC-SHARED-60'}-${year}`,
    jurisdiction, year, independent, reviewRequired,
    note: transition ? 'HR/legal review required for the 2025 Sabah/Sarawak transition. No proration or new 60-day allowance is inferred.' : jurisdiction === 'UNKNOWN' ? 'HR/legal review required: historical work jurisdiction is not established.' : null,
  };
}
/** Calendar anniversaries, not average-day approximations: exactly 2/5 years gets the next band. */
export function medicalSickDays(hiredOn: IsoDate, on: IsoDate): number {
  const anniversary = (years: number) => `${+hiredOn.slice(0, 4) + years}${hiredOn.slice(4)}`;
  return on >= anniversary(5) ? 22 : on >= anniversary(2) ? 18 : 14;
}

export function medicalLeaveUsage(requests: LeaveRequest[], on: IsoDate, state?: string | null) {
  const policy = medicalLeavePolicy(on, state);
  const notes = policy.note ? [policy.note] : [];
  const start = `${policy.year}-01-01`, end = `${policy.year}-12-31`;
  const medical = requests.filter(q => (q.kind === 'SICK' || q.kind === 'HOSPITAL') && q.status !== 'rejected' && q.from <= end && q.to >= start);
  const unique = new Map<string, LeaveRequest>();
  for (const q of medical) {
    const old = unique.get(q.id);
    if (old && JSON.stringify(old) !== JSON.stringify(q)) notes.push('Conflicting duplicate medical leave records need HR review.');
    else unique.set(q.id, q);
  }
  const rows = [...unique.values()];
  for (const q of rows) {
    if (q.status === 'approved' && (q.from < start || q.to > end)) notes.push('Cross-year medical leave needs reviewed day allocation; no automatic proration is applied.');
    if (q.status === 'approved' && q.medicalPolicy && q.medicalPolicy.jurisdiction !== policy.jurisdiction && q.medicalPolicy.jurisdiction !== 'MY_COMMON' && policy.jurisdiction !== 'MY_COMMON')
      notes.push('A work-jurisdiction change needs HR/legal review before applying a historical balance.');
  }
  const approved = rows.filter(q => q.status === 'approved');
  for (let i = 0; i < approved.length; i++) for (let j = i + 1; j < approved.length; j++)
    if (approved[i].from <= approved[j].to && approved[j].from <= approved[i].to) notes.push('Overlapping approved medical leave needs HR review; the same day must not be consumed twice.');
  const sum = (kind: 'SICK' | 'HOSPITAL', status: 'approved' | 'pending') => rows.filter(q => q.kind === kind && q.status === status && q.from >= start && q.to <= end).reduce((n, q) => n + q.days, 0);
  const sickTaken = sum('SICK', 'approved'), hospitalTaken = sum('HOSPITAL', 'approved');
  return { policy: { ...policy, reviewRequired: notes.length > 0, note: [...new Set(notes)].join(' ') || null }, sickTaken, hospitalTaken,
    hospitalConsumed: policy.independent ? hospitalTaken : sickTaken + hospitalTaken,
    sickPending: sum('SICK', 'pending'), hospitalPending: sum('HOSPITAL', 'pending') };
}
