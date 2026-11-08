# Controlled Excel preparation and local conversion

> Latest clarification (8 November 2026, isolated local review): the read-only library includes active unassigned extra-buffer guards for authorized company-wide DOA/Finance readers. Site-limited readers still need a published assignment within their scope. Select each authorized company; no grants or security policies are changed. Empty assignments allow list preparation only: payment intake still requires an authoritative current/next site assignment, never an invented shift.
>
> Remote acknowledgement may be a scan, photo or electronic acknowledgement genuinely supplied for this particular guard/payment/date/amount/reference (PDF, PNG or JPEG). Stored signatures may be compared for identity through existing authorized processes only; they are never exported here or pasted as receipts. Missing acknowledgement stays pending.
>
> Finance manually posts the external journal against the named site and records its unique line reference here. `post` may explicitly set `treatmentStatus: "pending"`, `statutoryRecordsConfirmed: false` with a payroll accounting/pending-treatment register reference and evidence. This records the actual expense once and keeps synthetic workflow/site accounting functional without pretending statutory treatment is settled. Completion stays blocked. Finance later uses `reviewTreatment` with the treatment decision reference, completed records reference, evidence and confirmation; the append-only review does not change or repost the journal. Treatment is externally configurable through the documented Finance/adviser decision, not a hard-coded exemption or tax calculation. The existing confirmed-records posting path remains compatible.
>
> Complete, accurate payroll/accounting records and Finance/adviser treatment review are required before live use. No automatic payslip posting, ordinary-wage deduction, false acknowledgement or suppression of required records is authorized. Earlier statements below requiring completed statutory records *before accounting* are superseded by this explicit pending path; requirements before completion/live use remain. Paid/posted corrections and reversals remain gated pending policy.


This is the separate DOA Excel workflow. It is not a guard/OM request portal and it never approves or pays anyone. Only manually requested, manually CEO-approved named guards belong in it. Support is additional payroll; ordinary wages remain payable in full. The synthetic RM150 example is neither a cap nor automatic eligibility.

## What is delivered

- `docs/templates/controlled-guard-cash-template.xlsx`: blank protected layout. Read me, Control, Guard master, Approved list and Finance handover sheets. First refresh produces the company-specific working workbook; do not manually populate its master.
- `scripts/cash_workbook.py`: local `refresh`, `seal` and `convert` commands. No network calls, credentials, automatic API submission, macros, add-ins or external workbook links.
- `scripts/cash_workbook_example.py`: generates a complete synthetic one-guard rehearsal, readable sample evidence marked NOT VALID APPROVAL, checked-scope manifest and output package. No real personal data.
- Pinned dependencies in `scripts/cash-workbook-requirements.txt`; checks in `scripts/tests/test_cash_workbook.py` and browser-to-workbook-to-intake checks in `scripts/exceptional-guard-cash-browser.mjs`.

Sheet protection (`accidental-edits-only`) helps prevent accidental edits. It is NOT encryption, authentication, tamper-proof approval or a security boundary. The separate scope manifest is a DOA checking record, not a CEO digital signature. A malicious holder could alter both; use access-controlled local storage and retain originals under the organization's evidence controls. Prima remains the authoritative server boundary for current roles, company/site access, active guard identity, published roster and replay checks. Local validation does not grant authority to the person running the script.

## Setup and synthetic rehearsal

Use Python 3.9 or later. Create the environment outside the repository or in an ignored local working directory; do not commit real exports, evidence, workbooks or JSON handovers.

```sh
python3 -m venv /path/to/local/cash-workbook-venv
/path/to/local/cash-workbook-venv/bin/python -m pip install -r scripts/cash-workbook-requirements.txt
/path/to/local/cash-workbook-venv/bin/python scripts/cash_workbook_example.py --output-dir /path/to/new/synthetic-rehearsal
/path/to/local/cash-workbook-venv/bin/python -m unittest discover -s scripts/tests -p test_cash_workbook.py -v
```

Each output path must be new. Existing files/packages are never overwritten. The synthetic example IDs cannot pass real server identity checks and must never be uploaded as a real approval. Open the blank template or synthetic workbook in Excel to inspect lookups and protected sheets. Excel calculates lookup formulas; conversion independently resolves IDs from the supplied master and does not trust cached formula values.

## Authorized refresh

1. DOA signs in with their own authorized account, selects the company in Director Office and uses **Download scoped workbook refresh**. Never use another person's session or ask OMs to re-enter guard identity already in Prima.
2. Save `cash-workbook-master.json` locally in a folder restricted to the responsible DOA/Finance personnel. The export contains guard ID, staff number, name, company, authorized published site/date assignments and minimal prior-submission references. No bank details, full identity numbers, salary, signatures, biometrics or receipt files are included. Scope is determined by the signed-in account and selected company.
3. Run the command below. For the first workbook, OMIT `--workbook`; the blank shipped template is a layout reference. For subsequent refreshes, supply the previous company workbook. Refresh keeps its approved input rows and batch/workbook references, replaces the master and regenerates lookup formulas. It refuses cross-company refresh. Changed names are resolved from the new master; changed eligibility/site assignments are checked again at conversion.

```sh
/path/to/venv/bin/python scripts/cash_workbook.py refresh \
  --source /local/restricted/cash-workbook-master.json \
  --output /local/restricted/approved-v1.xlsx
# Subsequent refresh (new file, no overwrite):
/path/to/venv/bin/python scripts/cash_workbook.py refresh \
  --source /local/restricted/new-master.json \
  --workbook /local/restricted/approved-v1.xlsx \
  --output /local/restricted/approved-v2.xlsx
```

Refresh before each handover and whenever an authorized source correction is made; local software cannot detect that a saved export is no longer current. Agree any additional periodic refresh cadence operationally—no arbitrary maximum age is treated as policy. The app rechecks current records at submission. Refresh does not write back to Prima or grant site access.

## Approved-list entry and human evidence check

In Excel, enter a unique batch ID and workbook reference in the two blue Control cells. In Approved list, use blue cells for guard/site IDs, payment occasion as text `YYYY-MM-DD`, amount in exact cents, individual reason, requesting OM account ID and request timestamp, CEO account ID and approval timestamp, unique approval line reference and evidence filenames. Identity lookups and Finance handover cells are locked. Timestamps must include timezone, for example `2026-10-31T09:00:00+08:00`. Excel dropdowns help entry but are not relied on as validation.

Keep PDF/PNG/JPEG manual evidence under a single restricted evidence directory. Enter relative filenames only. Absolute paths, parent traversal and symlinks outside the directory are rejected. Files must be nonempty, under 1.5 MB and have the expected format signature. Shared manual lists can cover multiple independently referenced rows. Real approval authenticity is a human check; the converter cannot read a CEO's intent or authenticate a scanned signature.

DOA checks every row against the actual OM request and CEO approval: named guard, company/site, amount and occasion, approver, dates and scope. The optional Supersedes row ID is only for a still-unprepared row; it requires new manual approval evidence and server validation. Never use it to hide a prepared/paid item.

After checking, close/save Excel and retain a separate checked-scope manifest:

```sh
/path/to/venv/bin/python scripts/cash_workbook.py seal \
  --source /local/restricted/new-master.json \
  --workbook /local/restricted/approved-v2.xlsx \
  --evidence-dir /local/restricted/evidence \
  --checked-by '<doa-account-reference>' --evidence-checked \
  --output /local/restricted/checked-scope-v2.json
```

Do not regenerate a manifest to bypass a discrepancy. Changed recipient, site, occasion, increased amount or any changed approval scope must be referred for fresh manual approval and a newly checked version. Keep the original request, approval, workbook and manifest. The manifest binds the exact row values and evidence hashes; it deliberately contains no embedded evidence copies. A refresh can change names/assignments without changing the approved scope, but conversion must still validate current identity/site eligibility.

## Conversion and Finance handover

```sh
/path/to/venv/bin/python scripts/cash_workbook.py convert \
  --source /local/restricted/new-master.json \
  --workbook /local/restricted/approved-v2.xlsx \
  --evidence-dir /local/restricted/evidence \
  --approved-scope /local/restricted/checked-scope-v2.json \
  --output-dir /local/restricted/new-finance-package
```

Conversion rejects edited/stale master data, absent/changed approval scope or evidence bytes, non-master recipients, wrong assignments, duplicate guard/date or approval references, prior submissions in the export, invalid dates/amounts, missing evidence and formulas in input. It validates the whole list before creating the package. Existing files are not overwritten. Output files are local owner-readable/writable (0600); directory mode is 0700. These POSIX permissions do not replace your organization's storage/access controls or Windows ACLs.

Outputs:

- `handover.json`: version 1 approved-list intake, with evidence embedded. Confidential; upload only via the scoped DOA screen. The app requires a fresh evidence-check attestation and repeats authoritative validation atomically.
- `finance-handover.xlsx`: protected static values resolved from the master, payment occasion, approved amount, approval reference and total. Labelled APPROVAL ONLY—NOT PROOF OF PAYMENT. It does not contain a receipt or prefilled signature.
- `conversion-record.json`: source, workbook, scope, JSON and Finance workbook hashes plus row count/time. Retain with originals and the resulting app batch/row IDs.

A locally converted file is not submitted and not a payment. Use approved organizational handover channels; these tools send nothing. Finance records preparation/custody, actual payment, cash return and independent reconciliation. DOA collects transaction-specific signed acknowledgements only after actual payment. Supplemental payroll/payslip/tax/contribution processing and actual ledger posting remain external, with evidence required before completion. The system counts the additional site expense once and does not deduct ordinary wages.

## Corrections after preparation

The safe defined operation is **full unpaid return**, already supported with a different Finance officer counting all prepared cash and attaching return/deposit evidence. It appends reconciliation and retains the approval/preparation; no payout, receipt or expense is invented. A partial payout follows the existing signed receipt and exact paid-plus-returned reconciliation path.

Cancellation, changing recipient/occasion/amount after preparation, paid-cash recovery, accounting reversal, statutory correction and reopening completed records remain explicitly gated. There is no approved policy specifying who authorizes each correction, independence requirements, new approval linkage, repayment evidence and supplemental payroll/tax treatment. The API rejects `cancel`, `correct` and `reverse`, and the UI explains the gate. Do not destructively edit originals or create substitute payouts. A future authorized design must use append-only linked adjustments, independent authorization and balanced site/payroll accounting; this review does not invent that policy.
