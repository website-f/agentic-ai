import { registerWorkKpiAdapter } from "./work-kpi";


/**
 * Each company's own office on the Work KPIs screen (Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8
 * executives; 5 Nov 2026: "Kpi will be done for all"). Read-only, no migration.
 *
 * The office's work is timed where it happens, by each module's own adapter under "Company offices": licence
 * renewals, tenders and quotations, arms request corrections, and so on. This adapter adds no steps of its own:
 * sharing work out by desk is the head's decision, not a timed task. It makes the company office a department on the
 * screen and tells the head, who sees only their own companies, what is and is not measured.
 */
registerWorkKpiAdapter({
  id: 'company-office',
  depts: ['company_office'],
  tables: [],
  limits: {
    company_office: {
      unknown: ['Work a desk owner’s backup did instead of the owner is shown under whoever recorded it'],
      notTimed: ['Setting desk owners and backups (the head’s decision)'],
    },
  },
  collect() {
    // Nothing of its own: see above.
  },
});