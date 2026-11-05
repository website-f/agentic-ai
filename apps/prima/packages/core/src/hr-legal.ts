// HR legal points for the directors to verify (Arisha main's review, 2 Nov 2026, relaying Fauzan's instruction).
//
// Privacy, retention and face-data points the HR build raises are listed ONLY for the authorized directors (the HR
// Director, i.e. the Chief of Staff or Deputy, and the CEO). Routine staff screens show no legal notice and are never
// blocked by these. Each point names its sources, the records it touches (worked out live), a responsible director, a
// status and its history. An open point stays "unresolved"; nothing here is ever labelled compliant.
//
// The sources are what a director starts from. They are not legal advice and have not been checked by counsel.

export type HrLegalArea = 'privacy' | 'retention' | 'biometric';

export interface HrLegalPoint {
  id: string;
  area: HrLegalArea;
  title: string;
  /** What the build does today, plainly. */
  issue: string;
  /** Where a director starts checking. */
  sources: string[];
  /** Which records it touches (worked out live by the service). */
  affects: 'faces' | 'clock_locations' | 'leavers_numbers' | 'guard_numbers' | 'faces_of_leavers';
}

export const HR_LEGAL_POINTS: HrLegalPoint[] = [
  {
    id: 'privacy-notice',
    area: 'privacy',
    title: 'Staff privacy notice and consent screen removed',
    issue:
      'The in-app privacy notice and consent step for staff was removed at the CEO’s request (1086117). Staff details, clock-in photos and locations are kept without an in-app notice. It is not restored automatically; the directors decide how notice is given.',
    sources: ['Personal Data Protection Act 2010 s.6 (consent) and s.7 (notice and choice)', 'PDPA (Amendment) Act 2024', 'docs/HR_PHASE3.md, Fauzan’s answers on the HR gaps doc'],
    affects: 'clock_locations',
  },
  {
    id: 'face-data',
    area: 'biometric',
    title: 'Face data for clock in',
    issue:
      'Registered faces (128 numbers and a photo) are kept for staff clock in. Face data is biometric. The directors confirm the basis and how staff are told, and whether a photo-only clock in stays available.',
    sources: ['PDPA (Amendment) Act 2024: biometric data as sensitive personal data', 'PDPA 2010 s.40 (sensitive personal data)', 'prima.staff_faces'],
    affects: 'faces',
  },
  {
    id: 'face-retention',
    area: 'retention',
    title: 'Faces of staff who have left',
    issue: 'There is no deletion date yet for the face of a staff member who has left. The directors set how long it is kept after the last day.',
    sources: ['PDPA 2010 s.10 (retention principle)', 'prima.staff_faces'],
    affects: 'faces_of_leavers',
  },
  {
    id: 'leaver-retention',
    area: 'retention',
    title: 'Full IC and salary account of leavers',
    issue:
      'Full IC and salary account numbers of staff who left are kept behind the HR wall with no deletion date. The employee register needs six years after leaving; the directors set the retention period and who removes them.',
    sources: ['PDPA 2010 s.10 (retention principle)', 'Employment Regulations 1957 (register of employees kept six years)', 'prima.staff_ids, prima.staff_accounts'],
    affects: 'leavers_numbers',
  },
  {
    id: 'guard-numbers-from-ja',
    area: 'privacy',
    title: 'Guards’ full numbers received from the JA app',
    issue:
      'Each licensed company employs its own guards. Their full IC and salary account now come from the JA app to PWVSB HR (slice 3G). The directors confirm the basis for each company passing them to PWVSB HR.',
    sources: ['PDPA 2010 s.8 (disclosure principle)', 'Management agreements between PWVSB and each company (masterplan V8)', 'docs/JA_GUARD_FEED.md'],
    affects: 'guard_numbers',
  },
];

export type HrLegalStatus = 'unresolved' | 'in_review' | 'resolved';

export const HR_LEGAL_STATUS_LABEL: Record<HrLegalStatus, string> = {
  unresolved: 'Unresolved',
  in_review: 'Being checked',
  resolved: 'Resolved by a director (not a compliance certificate)',
};
