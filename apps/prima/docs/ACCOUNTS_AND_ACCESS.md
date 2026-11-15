# Accounts and Access

Status (15 Nov 2026): built on a branch, not merged, not installed, not deployed. Fauzan approved building it on 15 Nov
2026 ("Build it now"), after the whole-system review found that Prima had no way to add an office sign-in or give
anyone access to a company.

## Why

Before this, the only accounts in Prima were the built-in sample set (107 accounts, most with sample names) and the
guard sign-ins made by the server script `guards:logins`. IT could link a Microsoft account to an existing record
(`entra:link`), and HR could close a leaver's access, but nobody could:

- add an office staff account;
- put a real name on a sample account;
- give someone access to a company, or end that access.

The staff directory bulk load does not create sign-ins either, by design. Without this screen, most staff would be
refused on 18 Nov 2026 with "not linked to a Prima staff record".

## Who does what

| Step | Who | Rule |
|---|---|---|
| Prepare a request | IT (IT Manager, IT Lead, IT Executive) or central HR | Not for your own account. |
| Approve or return | HR Director (Chief of Staff or Deputy) or the CEO | Needs a comment of 3 or more characters. Never your own request, and never a request that touches your own account. |
| Change a leader's account | The CEO approves | Leaders are the Chairman, Vice Chairman, Finance Director, CoS, DCoS, OGM, Operations Director and COO. |
| Close a leaver's access | HR (unchanged) | Stays in HR's leaving steps (`close_access`). |

The CEO's own account, system feeds, site devices and guards are never changed on this screen.

## What a request can hold

A request holds up to 200 lines. Once approved, every line goes in together, or none of them does. Each line is one of
the following.

**New account.** A new account has:

- a kind, chosen from a fixed list: company manager or GM, admin executive, OM, Regional OM, operations staff, HR, the
  IT roles, the Finance roles with their team, the FWM roles, the procurement roles, the ACT roles with their team, Arms
  Control, CMS, Transport, PDPA, Legal, DOA, Asset Management staff, and CoS office staff;
- a name and a job title;
- for company office staff, their one company;
- for central staff, the companies they may act on or only monitor;
- optionally, their Microsoft object ID, their HR record (HR only) and the staff directory line it came from.

Leader accounts are not created here. They already exist, and this screen only puts real names on them.

**Change an account.** A change can set:

- a real name or title;
- a link to a Microsoft account, if none is linked yet;
- a link to an HR record, if none is linked yet;
- company access to add or end.

Ended access stops the day before the approval day.

**From the staff directory.** IT or HR picks the kind of account for each company office line that has no account
yet. The name, title and company come from the directory.

**How long access lasts.** Company access runs for one year by default, or to a chosen date at most 3 years ahead. It
must then be renewed.

## How the data is protected

- The app role still cannot write accounts (`prima.users`) or company access (`prima.grants`).
- Approving calls `prima.apply_account_request` (module `db/modules/accounts-access-v1.sql`). It runs once, by the
  approver, and checks every rule again inside the database: allowed kinds only, never the approver's or the preparer's
  own account, a leader only with the CEO, one Microsoft account and one HR record per account, and companies that exist.
- A trigger lets the app change only the decision fields of a waiting request, so the lines cannot be altered while
  they are being approved.
- IT sees company names through `prima.acc_companies()`, because IT usually sees no company itself. IT never sees HR
  records.
- Every send and every decision is written to the audit chain.

## Installing (Fitri, staging first)

1. Run `db/modules/accounts-access-v1.sql` with `infra/run-db-migration.sh`. It needs only the base schema and is not on
   the release list.
2. Run the module as the database owner who can read every company and HR record. On Azure that is the admin role,
   because the definer function reads `prima.companies` and `prima.people` under their row rules.
3. The screen "Accounts and access" appears for IT, HR, the HR Director and the CEO.
4. Suggested first use: put real names on the sample leader accounts (the CEO approves), then send one request per
   company office from the staff directory, each with Microsoft object IDs.

## Tests

| Test | Covers |
|---|---|
| `packages/core/test/accounts-access.test.ts` | The flow, who may prepare and approve, refusals, access add and end, HR record link. |
| `apps/api/test/accounts-access-pg.test.ts` | PostgreSQL: not installed before the module; database kinds equal the app list; direct writes refused; apply refused before approval and a second time; a leader change approved by the CoS refused in the database; a changed request refused; a company manager reads nothing. |
| `scripts/accounts-access-browser-uat.cjs` | Demo build, 1280 px and 390 px: the IT Lead prepares, the CEO approves after a refused blank comment. |
