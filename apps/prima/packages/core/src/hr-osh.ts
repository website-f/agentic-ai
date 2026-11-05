// HR Phase 3, OSH for office staff (Fauzan, 2 Nov 2026): the OSH coordinator, office risk assessments and DOSH reports.
import { RULES } from './rules';
import { addDays } from './time';
import type { Id, IsoDate, OfficeOsh, OshCoordinator, OshIncident, OshIncidentKind, OshOfficeAssessment, Person } from './types';

export const OSH_INCIDENT_LABEL: Record<OshIncidentKind, string> = {
  accident: 'Accident',
  dangerous_occurrence: 'Dangerous occurrence',
  poisoning: 'Occupational poisoning',
  disease: 'Occupational disease',
};

/** The DOSH form for each kind: JKKP 7 for a disease, JKKP 6 for the rest. */
export const oshForm = (k: OshIncidentKind) => (k === 'disease' ? 'JKKP 7' : 'JKKP 6');

/** Latest day for the JKKP 6 or JKKP 7 form. */
export const oshReportBy = (occurredOn: IsoDate) => addDays(occurredOn, RULES.officeOsh.value.reportDays);

/** Next review of an office risk assessment. */
export const oshNextReview = (assessedOn: IsoDate) => addDays(assessedOn, Math.round(RULES.officeOsh.value.reviewMonths * 30.44));

export interface OshEmployerRow {
  companyId: Id;
  staff: number;
  needsCoordinator: boolean;
  coordinator: OshCoordinator | null;
  assessments: (OshOfficeAssessment & { overdue: boolean })[];
  noAssessment: boolean;
  incidents: (OshIncident & { late: boolean; form: string })[];
}

/** One row per employer with active staff: the coordinator, the latest assessment of each workplace, the incidents. */
export function oshEmployers(people: Person[], records: OfficeOsh[], today: IsoDate): OshEmployerRow[] {
  const staff = new Map<Id, number>();
  for (const p of people) if (p.status === 'active') staff.set(p.companyId, (staff.get(p.companyId) ?? 0) + 1);
  const ids = [...new Set([...staff.keys(), ...records.map((r) => r.companyId)])].sort();
  return ids.map((companyId) => {
    const mine = records.filter((r) => r.companyId === companyId);
    const coordinator = (mine.filter((r) => r.kind === 'coordinator' && !r.endedOn) as OshCoordinator[]).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
    const latest = new Map<string, OshOfficeAssessment>();
    for (const a of mine.filter((r): r is OshOfficeAssessment => r.kind === 'assessment').sort((a, b) => a.assessedOn.localeCompare(b.assessedOn) || a.at.localeCompare(b.at)))
      latest.set(a.workplace.toLowerCase(), a);
    const assessments = [...latest.values()].map((a) => ({ ...a, overdue: a.nextReviewOn < today }));
    const incidents = mine
      .filter((r): r is OshIncident => r.kind === 'incident')
      .map((i) => ({ ...i, late: !i.reported && i.reportBy < today, form: oshForm(i.incident) }))
      .sort((a, b) => Number(!!a.reported) - Number(!!b.reported) || b.occurredOn.localeCompare(a.occurredOn));
    const n = staff.get(companyId) ?? 0;
    return { companyId, staff: n, needsCoordinator: n >= RULES.officeOsh.value.coordinatorMinStaff && !coordinator, coordinator, assessments, noAssessment: n > 0 && assessments.length === 0, incidents };
  });
}
