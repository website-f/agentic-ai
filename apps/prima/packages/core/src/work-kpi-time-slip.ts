import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Time slips on the Work KPIs screen (rule HR-TIME-SLIP; Fauzan, 5 Nov 2026: "Kpi will be done for all").
 *
 * A time slip is a staff member's own request, decided by the company or department head (or HR). The decision is an
 * approval, so it is never timed, and settling the hours after the make-up period is done by Prima itself, not by a
 * person. Nothing here is anyone's work step, so the adapter times nothing; it only tells the KPI screen why, so HR
 * and the heads see that time slips were considered and deliberately left out. Read-only, no migration.
 */
registerWorkKpiAdapter({
  id: 'hr-time-slip',
  depts: ['hr'],
  // Nothing is timed, so nothing is read (the time slip tables live in their own database module).
  tables: [],
  limits: {
    hr: {
      unknown: ['When each HR person saw a time slip notice: Prima keeps who saw it, not when'],
      notTimed: ['Decisions on time slips (company or department head, or HR)', 'Settling time slip hours after the make-up period (done by Prima, not a person)'],
    },
  },
  collect() {
    // Deliberately nothing: see above.
  },
});