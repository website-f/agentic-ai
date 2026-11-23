# Data clean-up checker (Part AG, AG15)

Owner decision: Fauzan, 23 Nov 2026 ("Yes, build" on the AI helper study, with "Use system more than ai"). AG15 is on the
system-only list: fixed rules, no AI, nothing sent anywhere. Data collection runs to about 18 January 2027; wrong or
doubled records entered now would carry into pay, rosters and billing.

Status: source only, on a draft pull request. No database module is needed (it reads existing records only).

## What it does

`packages/core/src/data-cleanup.ts` reads the staff, site and contract records as they are now and lists each problem
by the record's number only (staff number, site code or contract reference), never a name, IC, phone or date of birth.
Each line says what is wrong and how to fix it. The person corrects the record in its usual screen and the line goes
away by itself. Because it reads the live records on every open, it is always as fresh as a nightly run.

| Rule | Level | What it finds |
| --- | --- | --- |
| STAFF-TWO-COMPANIES | check | Same person (name, date of birth and masked IC) active in two companies at once |
| STAFF-TWICE | fix | Same person entered twice in one company |
| STAFF-NUMBER-TWICE | fix | Two different people with one staff number in a company |
| STAFF-NO-START / STAFF-NO-BIRTH | fix | Start date or date of birth missing or not a real date |
| STAFF-START-BEFORE-18 | fix | Started before turning 18 or before the date of birth |
| STAFF-NO-ID / STAFF-NO-PHONE | fix | Active person with no IC or passport, or no phone |
| STAFF-GUARD-OVER-AGE | check | Active guard over the HR-AGE-MAX limit (60) |
| STAFF-BRANCH | fix | Branch on the record belongs to another company |
| SITE-NO-CONTRACT | check | Site with no live contract (renewals count) |
| SITE-CODE-TWICE | fix | Two sites with one code in a company |
| SITE-NO-POST / SITE-NO-PLACE | fix | Site with no guard post, or no address or map location |
| CONTRACT-END-BEFORE-START | fix | Contract ends before it starts |
| CONTRACT-PAST-END | check | End date passed (after renewals) but the contract is still open |
| CONTRACT-NO-SITE / CONTRACT-SITE-ELSEWHERE | fix | No site, or a site that is missing or another company's |
| CONTRACT-REF-TWICE | fix | Two contracts with one reference in a company |

Names are compared without case, punctuation or "bin/binti/a/l/a/p", so "ALI BIN ABU" and "Ali Abu" match when the
date of birth and masked IC also match. A person who has left is not a clash.

## Who sees what

- Company office (company manager, admin executives, director): their own companies. Home shows "N records to fix".
- Central HR: staff lines in every company (HR governs HR in every company).
- ACT and the group leaders: everything, with a company picker.
- Everyone else: no menu item; the API refuses.

The server reads under the person's own database walls, so the walls apply again on PostgreSQL.

## Where

Screen "Data clean-up" (`apps/web/src/views/DataCleanup.tsx`), API `GET /data-cleanup?area=&companyId=`.

## Tests

Core `packages/core/test/data-cleanup.test.ts` (9). Browser `scripts/data-cleanup-browser-uat.cjs` (24 steps, computer
and phone size, synthetic data).

## Not done

- It does not yet say who entered the record: most records do not keep their first author. Lines go to the company
  office that owns the record.
- A line that is right (for example a real secondment shown as two companies) cannot be marked "checked, correct" yet:
  that needs a small database table and the owner's go-ahead.
