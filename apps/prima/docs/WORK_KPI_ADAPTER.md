# Adding a module's KPIs

Fauzan, 5 Nov 2026: "Kpi will be done for all." The IT pilot phase has passed and every module is now being built. Each module adds its own KPI adapter, in its own PR, on top of `packages/core/src/work-kpi.ts` (PR #77). Nothing else in the KPI screen or API changes.

## The rules every adapter follows

1. **Time from arrival.** Each step is timed from the record's previous step, when the work reached this person, to when they finished their part. There is no start or stop button.
2. **Approvals are never timed.** Do not `put.step` an approval, consent or authorisation. Name it under `limits[dept].notTimed`.
3. **Work and checking are apart.** Use `kind: 'work'` for doing or redoing, and `kind: 'check'` for reviewing, verifying or signing off someone else's work.
4. **Blame only the right person.** If the record does not show when the work reached this person, leave the step out and say why under `limits[dept].unknown`. Two examples are a reopened item that keeps only its last finish time, and a step-in by a higher level.
5. **Unknown stays unknown.** In `put.finished`, anything the record does not keep is `null`, never `0` or `true`.
6. **Desks manned 24 hours** (CMS, the vault watch) pass `clock: 'round_the_clock'` on `put.step`, so the night shift is timed in real minutes. Everyone else is timed in office minutes.
7. **Use the record's own due time** (`dueAt`) when it has one, such as an SLA, a due date or a legal deadline.
8. **Propose targets in office minutes** under `targets` (`dept.workflow.stage`). They show as "proposed" until Fauzan approves them into a version of `WORK_KPI_TARGETS`.
9. **Name the head or lead** under `heads`, so they see their own department. The CEO, COO, ACT Director and HR already see every department.
10. **Read only, no migration.** List the tables in `tables`. The service reads them through the viewer's own database walls.
11. **Synthetic data in tests.** Add a test that shows one timed step, one approval left untimed, and one Unknown.

## Shape

```ts
registerWorkKpiAdapter({
  id: 'arms-requests',
  depts: ['arms_control'],
  tables: ['armsRequests'],
  targets: { 'arms_control.request.prepare': 120 },
  limits: { arms_control: { unknown: [], notTimed: ['Company authorisation of the request'] } },
  heads: [{ dept: 'arms_control', is: (u) => u.department === 'arms_control' && /* the head */ true }],
  collect(data, put) {
    for (const r of data.armsRequests ?? []) {
      // put.step({...}) for each person's own part; put.finished({...}) when the request is done
    }
  },
});
```

The departments already covered are listed in `WORK_KPI_DEPTS`. A department shows on the Work KPIs screen as soon as an adapter covers it.
