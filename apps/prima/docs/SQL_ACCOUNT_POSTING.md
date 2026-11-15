# SQL Account posting link (Build 1)

Decided by Fauzan (CEO), 13 Nov 2026: SQL Account stays the group's books. Prima does the approvals, payments, claims
and checks, and **posts** the results into SQL Account. Rule `FIN-SQLPOST` (Policy).

**Status (14 Nov 2026): not connected for any company.** The code is built and tested against a fake SQL Account in
the test folder only. No adapter that calls SQL Account exists in this repository. The database module
`db/modules/sql-posting-v1.sql` is proposed, not on the release list and not installed. Nothing has been posted to a
real or copy book. This page says "connected" for a company only after a real post has been read back and checked.

## Ground rules (unchanged)

- SQL Account owns the ledger, AR, AP, tax documents, e-Invoice (MyInvois) and bank reconciliation.
- Prima posts only through the vendor API or SDK, never into SQL Account's database tables (V6 rule).
- One SQL Account installation for the group with a **separate book per company** (Fauzan, 13 Nov 2026: "Yes"). Every
  job names one company and that company's own book; the database refuses a job whose key names another company.
- The bank portal still moves money. Prima never pays.
- Every switch and check needs a reason or comment, and nobody checks their own entry.

## What Prima posts, and when

| Prima record, when finished | SQL Account document | Built |
| --- | --- | --- |
| Payment released (prepared, reviewed, approved, release recorded with the bank reference) | GL Payment Voucher in the paying company's book | Yes |
| Customer receipt found by Prima on the loaded bank statement | Customer Payment, knocking off the invoice number Prima holds | Yes |
| Supplier bill from Procurement's three-way match | Purchase Invoice | No: waits for SQL support's answer on suppliers (L1 Q4) |
| Item register movements | Stock documents | Item jobs keep their own outbox (`item_sync_jobs`); the key is now shared and uses the confirmed book |

Not posted by Prima in Build 1: client (sales) invoices, which stay raised in SQL Account (Fauzan, 13 Nov 2026: "Yes");
guard payroll (JA to Finance bank to SQL Account; guard payroll in Prima is trial only); the staff payroll journal;
intercompany, prepayment and depreciation journals.

A payment that pays a bill already in SQL Account (its "SQL Account document number") is posted as a voucher and listed
as "knock off the bill in SQL Account by hand" until SQL support says the API or SDK can do the knock-off (L1 Q3).

## The queue

- `prima.sql_postings`: one row per document, written in the same database transaction that releases the payment or
  matches the receipt. Key: company, book, document type, source, revision (unique). A repeat of the same record gives
  the same job; changed content gives the next revision.
- Statuses: waiting (`not_ready`), ready, sending, posted, refused (`rejected`), will try again (`retryable_error`),
  unknown (`outcome_unknown`), Finance to look (`manual_review`), posted and checked (`checked_ok`), differs
  (`check_failed`).
- Company wall as `fin_status`; the service narrows to the Finance team. No delete grant.

## Switches (all off by default)

1. `SQL_POSTING_ENABLED=true` on the API (only after the CEO's go-ahead).
2. Per company, "Post to SQL Account" on or off, set by the Finance Director or the CEO with a reason. It cannot be
   switched on until the company's SQL Account set-up is confirmed.
3. Per document type per company (start with payment vouchers only). Supplier bills cannot be switched on yet.

While anything is off, jobs are still made and wait with the reason, so they can be sent later in order.

## Codes needed before anything posts

A job waits, with the reason shown, until:

- the company's SQL Account set-up is confirmed with API = yes;
- the month has an approved chart of accounts mapping and the bank account has its ledger code;
- the payee has an SQL Account code (or, for receipts, the customer has a customer code), entered by Finance and
  **checked by a second person** (team leader, deputy, FD or CEO, never the one who typed it).

Once the code is checked the job becomes ready by itself. Finance home shows "x documents waiting for SQL Account codes".

## Sending

- Every 5 minutes once switched on (the timer is added with the real adapter); "Send now" for the FD or CEO.
- One company at a time, oldest first. Before sending, Prima checks the record is still finished and unchanged.
- Posted: the SQL document number is kept and shown on the payment.
- Refused: the reason is kept and shown; amounts are never changed to make it pass. A closed SQL Account period goes to
  the Finance Director.
- Network error before SQL Account answered: retried after 5, 15, 60 and 240 minutes and the next day, then Finance looks.
- Timed out after sending: never resent. Prima looks it up by its reference; if SQL Account cannot be searched that
  way, Finance checks by hand.
- Open point for the real adapter: in PostgreSQL the API runs each request in one transaction, so the sender must run
  outside the request transaction (its own connection per step) before it is switched on.

## Daily check (06:00 Malaysia time once switched on; "Check now" for reviewers)

1. Each document posted before today is read back and compared (book, amount, date, codes).
2. Jobs not posted after 1 working day.
3. Finished payments and receipts with no job (urgent: the outbox is broken).
4. Records cancelled or changed in Prima after posting: reverse or correct in SQL Account, record the reversing number.
5. Documents in SQL Account that look like Prima's but were not posted by Prima, from the API listing or from Finance's
   pasted daily listing (marked "from a pasted export").
6. Each day's totals per document type.

Each exception is explained by Finance (with a comment) and checked by someone else. Unchecked exceptions hold the
month-end close; after 3 working days they show on the Finance Director's home. The FD, CEO and COO see the count as a
key number (Unknown while posting is off or never checked).

## Keys

One key pair per company book, kept only in Azure Key Vault (names like `SQLACC-KEY-<company code>`), never in the
repository, a log, the database or chat. Use a dedicated, limited SQL Account user for the API. No key handling code
exists yet; it comes with the real adapter.

## Vendor questions (L1), to be asked in writing by Fitri with the FD

Answers are saved as the partner's written confirmation on each company's SQL Account set-up.

1. Our version and edition per company book; is the REST API licensed for each book? Cost per book?
2. Does one API key reach one company book, or can one key choose the book?
3. Supplier payments: post as GL Payment Voucher, or is there an AP payment endpoint? If neither, can the SDK (AP_SP)
   run on our in-house server?
4. Suppliers: must they be created by hand in SQL Account first?
5. Can we read back a document by its number, and list documents by date range?
6. Does the API refuse a duplicate? Which field holds our reference (Prima sends `PRIMA-<id>-r<revision>`)?
7. Does the API write to the in-house server or the cloud copy? How do the two stay in step?
8. Does posting a Sales or Purchase Invoice through the API also send it to MyInvois?
9. Sandbox or demo keys for testing.

## Switch-on order (each step after a needs the CEO's go-ahead)

a. All code with the fake (done, 14 Nov 2026) plus a PostgreSQL wall test for `prima.sql_postings` (not run yet).
b. Real adapter against the SQL sandbox; record which document types worked.
c. All companies are the pilot (Fauzan, 13 Nov 2026). Back up every company book, then one month in parallel, payments
   only: Finance keeps typing into the real book, Prima posts into a copy book, the daily check compares. A company joins
   once its codes are complete and its set-up confirmed; a company not ready is listed, not skipped.
d. Prima posts into the real books of companies whose parallel month was clean; Finance stops typing those payments by
   hand the same day. Then supplier bills, then customer receipts, each with a parallel check first.

Results log, one line per step: date | company | document types | posted | refused | differences | Fauzan OK.
