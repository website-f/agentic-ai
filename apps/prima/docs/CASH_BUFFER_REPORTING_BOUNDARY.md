# Special cash buffer: reporting boundary

User direction, 7 November 2026: amounts of cash given by CEO/COO to cash-buffer recipients must not appear in man-hours or payslips because these are special cases.

The daily-cash workflow is a separate Finance ledger (`FinStatus.dailyCash`), not a payroll allowance, advance or deduction. Keep its amounts out of `siteHoursBoard`, staff payslips and guard payslips. These views read attendance/rosters or their approved payroll runs only, never the daily-cash ledger. Matching a recipient name or site must not join a cash-buffer amount into wages. Existing source boundaries already enforce this; no monetary history is deleted or rewritten.

Retain FD approval, preparer separation, Director Office cash listing and receipt upload, CEO/COO custody/payout, withdrawal reconciliation and audit. Ordinary staff do not acquire Finance access. Actual worked hours remain in attendance and man-hours, and independently owed salary remains on its proper payslip. This does not determine statutory/tax treatment or authorise suppressing legally required wage records.

Regression: `packages/core/test/cash-buffer-reporting.test.ts` exercises both CEO and COO disbursement and compares nonempty paid staff/guard payslips and man-hours before/after. It also verifies cash amount, approval and logs retained, payroll and attendance unmodified, and unauthorised payout rejected.
