# Work KPIs across departments

Status: draft PR. Not merged and not deployed. It adds no database change.

## What the owner decided

- 1 Nov 2026: measure speed and quality for now. Time runs from when the work reaches the person. There is no start or stop button. Targets are in office minutes, "optimum but reasonable". Approvals are not timed. The KPIs are kept by the team leader, the Finance Director, the CEO, the COO, the ACT Director and the HR department.
- 5 Nov 2026: "Start now". This lifts the 1 Nov hold on KPI timing.
- 5 Nov 2026: Fauzan chose the arrival-time measure as the IT KPI; the staff start/pause timer board is a personal work log only.
- 5 Nov 2026: Fauzan approved the v1 targets below and confirmed that "team leader" means each department's head or lead.

## What this change does

`packages/core/src/work-kpi.ts` builds a read-only monthly view, `GET /kpi/work?period=YYYY-MM`, and the web screen **Work KPIs**. Everything is calculated from records Prima already keeps.

| Department | Workflow | Timed step (kind) | Arrives at | Target, v1 (approved) |
|---|---|---|---|---|
| IT | Help request | resolve (work) | when raised | P1 60, P2 240, P3 960 min |
| Operations | Case | acknowledge (work) | when opened | 15 min |
| Operations | Case | resolve (work) | the previous step | the case's own SLA time |
| Operations | Case | sign-off per level (check) | the previous sign-off | 60 min |
| FWM | Task to OM | do (work) | when created | the task's own due date |
| FWM | Task to OM | review (check) | when done | 120 min |
| FWM | Hostel bill | check (check) | the request | 120 min |
| Finance | Hostel bill | payment slip (work) | the COO approval | 480 min |
| HR | Staff claim | HR check (check) | the CoS approval | 240 min |
| Finance | Staff claim | payment (work) | the decision | 960 min |
| PDPA | Case | each step (work) | the previous step | 480 min |
| Client relations | Onboarding | each step (work) | the previous step | none yet |
| Chief of Staff office | Office expense | approvals only, so nothing is timed | | quality only |

Quality is shown per workflow: items finished, first time right, returns, reopens, proof complete and requester confirmed. If Prima does not keep a value, it shows as **Unknown**. It is never shown as zero or as a pass.

Office minutes count Monday to Friday, 8.30 am to 5.30 pm Malaysia time (HR-STAFF-HOURS). Prima has no holiday calendar yet, so public holidays still count.

## Who sees it

The access check is `workKpiScope`. The server enforces it, including on direct API calls.

- **Every department:** the CEO, the COO, the ACT Director, the HR department, and the HR Director (the CoS and the Deputy CoS).
- **Own department only:** the Finance Director and Finance team leaders see Finance. The IT Manager and IT Lead see IT. The FWM Manager and Deputy see FWM. The PDPA officer sees PDPA. The Operations Director sees Operations and Client relations.
- **Own companies only:** the OGM, the Regional OMs and company managers see Operations and Client relations.
- **No standing view:** staff, executives and integrations do not see the KPIs. HR shows staff their KPIs in a review.

People are listed by name and never ranked. The KPIs never change access, grants or pay.

## Open for the owner and department heads

1. Recalibrate the targets after the first month of real use (as a new version).
2. Finance payments and month-end closes stay in the Finance KPI view, which is on the Finance branch (PR #49) and not merged.
3. IT KPI measure (Fauzan, 5 Nov 2026): the arrival-time measure in this view is the IT KPI. The IT timer board already on main (`it-workflow-metrics`, start/pause by staff) stays only as a personal work log and is not a KPI. It is left unchanged in this PR.
4. Leave decisions, quotations and vehicle requests are approvals, so they are not timed.
