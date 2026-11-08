# Guard cash exception — draft PR review boundary

**Local arrival-cash continuation:** publication of this earlier candidate was denied; no PR was created. The newer authorized local scope is documented in `ARRIVAL_CASH_LOCAL_REVIEW.md`. Its CEO-only wage-cash route supersedes the earlier closure statement below. No remote publication is authorized by this document.

This PR applies the tested manual guard-support implementation to the genuine current remote main, `2261e5d1103cf6ddf099375b4bde48430d5fdbd2`. The publication commit has that real commit as its parent; the earlier local snapshot history is not published. The base source tree is `dc03d674de88aced2d3722e996b6b5152aa834f6`.

This is the reviewed recovery candidate, including the latest buffer-library, remote-acknowledgement and pending-treatment clarifications. It supersedes the uncompleted publication attempt on `codex/manual-guard-cash-excel-review`; that branch and its task remain untouched. PRs #131/#132 belong to the separate Claude workstream and are not included or modified.

The approved technical scope is review and CI only. This draft is explicitly NOT ready for merge, deployment or activation without the coordinated user decision. Nothing is merged, deployed or activated. Finance operational confirmation, supplemental payroll/payslip/tax/contribution treatment and SQL Account handling remain pending. Paid/posted correction and reversal authorization remains unresolved and gated. Additional payroll support and ordinary wages payable in full are the owner's confirmed classification; that does not establish statutory compliance or authorize a payout.

Manual OM request → manual CEO approval for a named guard, amount and occasion → separate controlled DOA Excel preparation → Finance custody/payment, fresh signed receipt, independent reconciliation and once-only site expense remain the controlling boundary. The workbook is a local preparation tool, not an authentication or approval system. Read `MANUAL_GUARD_CASH_SPEC.md`, `CONTROLLED_GUARD_CASH_WORKBOOK.md` and `EXCEPTIONAL_GUARD_CASH_INTAKE.md`.

The dedicated synthetic CI job exercises protected workbook generation/refresh, scope binding, conversion and the desktop/mobile DOA-to-Finance journey. Existing full core/API/PostgreSQL, offline HTTP, module-upgrade, department browser and release-gate jobs remain intact. All tests use synthetic records; no provider connection, permission grant, security-policy change or live-data mutation is part of this PR.

## Legacy route and loan review

New daily-cash list/decision/withdrawal/payout actions are closed both in the service and reducer. The earlier recovery candidate closed ordinary guard-pay cash listings, decisions and handouts; the later owner handoff now authorizes the versioned CEO-only route described in ARRIVAL_CASH_LOCAL_REVIEW.md; historical receipt collection and Finance reconciliation remain. Existing unresolved historical cash salaries are gated rather than silently reclassified or paid twice.

The separate approved loan/advance scheme is retained: it requires HR intake, a signed loan agreement, CoS then CEO approvals, bank/e-wallet payout and its own repayment ledger. Exceptional support never writes that ledger, creates an instalment or enters the payroll calculation. A regression recalculates ordinary payroll with an existing synthetic loan before and after paid/accounted support and requires identical pay lines and unchanged loan/advance records. No broad loan cancellation or historical debt forgiveness is invented. Do not manually re-key additional support as a loan or deduction; unrelated authorized loans remain subject to their own controls.

## Publication safety

All five repository workflows were inspected against exact main and this candidate. Only `ci.yml` runs for this feature branch push and draft PR. It has read-only contents permission, no Azure login/secrets, registry push, deployment or live activation. `check-staging.yml` only has a PR price-estimate path for infrastructure changes (none here); its Azure check requires manual dispatch on main. Both deployment workflows and website verification require manual dispatch on main with owner checks; the deployments additionally require explicit confirmation. No workflow_run, pull_request_target or repository_dispatch chain exists. Release rehearsal jobs use disposable synthetic clusters or an unstarted local image. No deployment workflow is changed or invoked. The cash CI addition only installs pinned test dependencies and runs synthetic workbook/browser tests.
