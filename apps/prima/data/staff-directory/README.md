# Staff directory: where it lives and what it holds

The real staff email list (office staff of the group companies, central units and regional operations) is
**personal data under PDPA and is never committed to this repository**. This folder holds only the format
(`TEMPLATE.csv`, synthetic rows) and a `.gitignore` that refuses any other file.

- **Where the real data is:** the owner's private project folder, `staff-directory/staff-directory-YYYY-MM-DD.csv`,
  made from the owner's workbook "SENARAI NAMA EMAIL OUTLOOK 1" (4 Nov 2026). Ask Fauzan for access; do not copy it
  into git, issues, PRs, chat logs or test fixtures.
- **How it gets into Prima:** the **Staff directory** screen. Central HR (or the HR Director) chooses the CSV, checks
  the preview and sends it; the HR Director (Chief of Staff or Deputy) or the CEO approves it with a comment, never the
  person who sent it. Every row goes in at once or none does, people already listed are left out, and the same rows are
  never loaded twice. Staff missing from the list are keyed in by hand on the same screen afterwards. IT sees the list
  (to fix accounts) but cannot change it. Microsoft sign-in is linked per person by Entra object ID
  (`docs/MICROSOFT_SIGN_IN.md`), never by email.

## Columns

| Column | Meaning |
|---|---|
| source_tab | Workbook tab: `HQ` (company admin teams), `UNIT` (central units), `OPERASI` (regional operations) |
| group | `company`, `central_unit` or `operations_region` |
| org_unit | Company name, central unit (e.g. UNIT IT, UNIT KEWANGAN) or region (e.g. OPERASI JOHOR) |
| name, title | As written in the workbook (Malay job titles, e.g. PENGURUS, EKSEKUTIF PENTADBIRAN) |
| email, account_type | Mailbox and its kind: Outlook HQ / Admin (work mailbox) or Outlook Personal (consumer account) |
| entra_status, verified, account_status | Status columns copied from the workbook (Aktif, Telah Disahkan, Sedang digunakan) |
| issues | `;`-separated flags, see below |

## Issue flags

| Flag | Why it matters |
|---|---|
| personal_outlook | Consumer account; cannot sign in to Prima (single-tenant check) unless IT gives a work account or a guest invite |
| email_used_more_than_once | Shared login; Prima needs one account per person for approvals, no-self-check and audit |
| no_title | Role in Prima cannot be decided; HR confirms |
| no_email, invalid_email, typo_domain | Fix in Microsoft 365 / the workbook first |
| status_missing | Status columns blank in the workbook |

## Title to Prima role (proposed, owner to confirm)

| Workbook | Prima |
|---|---|
| PENGURUS (company) | Company Manager |
| EKSEKUTIF / KERANI / PEMBANTU PENTADBIRAN (company) | Company admin executive |
| UNIT IT | IT department (Manager, Lead, 4 executives) |
| UNIT KEWANGAN leader / assistant / DE | Finance team leader / deputy / data entry |
| UNIT AUDIT | ACT |
| UNIT PENGURUSAN NEPAL | Foreign Worker Management |
| PENGURUSAN SEKOLAH PKK/KBK, OPERASI regions | Government Operations (Goodwill Empire) |
| CONTROL ROOM | CMS |
| PRISMA | Asset Management |

Bank checker/maker alert mailboxes (one pair per company) are mailboxes, not people, and never become sign-in accounts.

## Code and switch-on

| Part | Where |
|---|---|
| Rules (who may do what, checks, issue flags) | `packages/core/src/staff-directory.ts`, tests in `packages/core/test/staff-directory.test.ts` |
| API | `apps/api/src/staff-directory.controller.ts` (`GET /api/staff-directory`, `POST /api/staff-directory/:action`) |
| Database module | `db/modules/staff-directory-v1.sql` (two tables, forced row-level security, no deletes); PostgreSQL test `apps/api/test/staff-directory-rls.test.ts` |
| Screen | `apps/web/src/views/StaffDirectory.tsx`, menu "Staff directory" (HR, Chief of Staff/Deputy, CEO, IT) |

Off by default. To switch on in an environment, after the CEO approves the release: run
`db/modules/staff-directory-v1.sql` once, then set `STAFF_DIRECTORY_ENABLED=true`. Until then the screen says it is not
switched on. The directory never creates a sign-in, grant, staff record or Microsoft link.
