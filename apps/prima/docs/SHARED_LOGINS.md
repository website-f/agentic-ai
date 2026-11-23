# Shared login list

Status (23 Nov 2026): built on a branch. Not merged, not installed, not deployed. Fauzan said "Now build" on 23 Nov 2026
after the study "Group password vault study" (Microsoft Premium first). No Microsoft licence, vault seat or tenant
setting was bought or changed by this work.

## What it is

Prima keeps the **list** of logins a team shares: bank portals, SSM, KDN eSIMS, LHDN, EPF, SOCSO, tender portals,
supplier sites, domain registrars. For each login it records the system, the company or central department, the owner,
the backup, who else may use it, who holds the second-step phone, where the password is kept and the day it was last
changed.

Prima **never holds a password**, a PIN, a token or a recovery code. The password stays in the Microsoft shared-login
tile (My Apps) or in the vault. A note or a name that looks like a password is refused on the screen, by the server and
(for a password field) by the database. The AI helpers are never given this list.

The list does not give or remove access. IT sets the Microsoft group or the vault folder by hand. "Microsoft tile" on a
row records where the password is kept; it is not a claim that Microsoft is connected to Prima.

## Whole group (review, 23 Nov 2026)

- **Every place a login can belong to**: the 38 security companies, the 5 central companies that are not security
  companies (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team, Perfect Global Logistics) and 16 central departments,
  plus the CEO master accounts.
- **Across the group** (IT, HR, the group leaders): every company and department with how many logins it has on the list
  and how many need a change now. Places with none listed are shown first, so IT can see what is still missing.
- **Heads see their own** (helper `unitHeadsOf` in `packages/core/src/unit-heads.ts`, shared with the organisation
  chart). From the job on the sign-in: the FWM Manager and Deputy see FWM; the Asset Director sees Asset Management; the
  OGM sees Operations, Procurement and Goodwill Empire; the Inventory Manager sees Procurement; the Operations Director
  sees Operations and Sasa Team. From the head named in the organisation chart (`User.headOf`, Fauzan "Yes di", 23 Nov
  2026): for example the Arms Control Manager (Arms Control and CMS), the Head of Transport (Transport and Perfect Global
  Logistics), the PDPA Officer, the Legal Counsel and the Director Office Administrator. The demo data marks those five;
  in live use the CEO or the Chief of Staff names each head in the organisation chart. IT, HR, ACT, Finance and the
  Chief of Staff office already see the whole list.

## Banks, e-wallets and the usual portals

- Each login has a **kind of portal**. Bank and e-wallet logins also name the bank or e-wallet provider and the **last 4
  digits** of each account or wallet they reach (one login may reach many). A full account number is refused on the
  screen, by the server and by the database.
- **Across the group** shows, for each company, how many bank and e-wallet logins it has and which of the company bank
  accounts in Finance's list no bank login reaches yet (matched on the last 4 digits; shown only to those who may read
  Finance's list).
- **The usual portals** (rule SHARED-LOGIN-PORTALS, Policy: Fauzan "Yes", 23 Nov 2026): every company should have SSM,
  LHDN MyTax, LHDN e-Invoice, KWSP, PERKESO, HRD Corp, Customs MySST (sales and service tax) and a bank login; security companies also KDN eSIMS. A company
  without one shows it as missing.

## Add buttons (Fauzan, 23 Nov 2026: "Make sure it have add button to add anything more")

- **Add a login** at the top, and **+ Add** next to every company and department in "Across the group".
- **+ <portal>** next to each missing portal, and **+ <bank> ••1234** next to each bank account with no login: the form
  opens with the company, the kind and (for a bank) the bank and last 4 digits already filled in.
- **Kinds of portal** (IT and the CEO): **Add a kind of portal** for anything not on the list (for example a Majlis
  Daerah licence or a client portal), and **Change** on any kind to rename it, choose whether every company, every
  security company or no company must have one, or turn it off. A kind turned off is not offered for new logins; the
  logins that have it keep it. "Other" always stays on. Saved in table `prima.shared_login_kinds` (same module); others
  read the kinds but cannot change them, in the database too.

## Who does what

| Step | Who | Rule |
|---|---|---|
| Add, edit or close a login | IT; the CEO | Owner and backup are two different office staff. A login stays with its company or department. |
| Keep the master accounts | The CEO only | Rows under "CEO master accounts" are seen and changed by the CEO only, in the database too. |
| Record "password changed" | The owner, the backup, IT | The day (not in the future, not before the last change) and a reason. |
| See a login | Everyone named on it; the Company Manager of that company; the head of that central department or central company (below); IT; central HR; the group leaders, including the ACT head | Others see nothing. Guards, site officers, patrolling officers, site devices and system feeds have no list and cannot be named on one. |
| Leaving list | Central HR, IT, the group leaders | Every shared login a person is named on. |

## Rule SHARED-LOGIN (Policy)

- A shared password is changed every **90 days**. The owner and the backup see a reminder **14 days** before:
  on Home, or in the alert bell for central staff (IT, Finance, HR and others), who have no Home screen.
- When anyone named on a login leaves (their access is closed in HR's leaving steps), the password is changed within
  **3 working days**. A person who leaves on the same day the password was last changed counts too. Recording the
  change takes the leaver off the row. If the owner or the backup left, IT names a new one first; the password change
  stays due after that, because the person who left still knows the password, until the new owner records it.
- "Each person has their own login" rows have no shared password and no 90-day change. A leaver is still flagged so
  their own login is closed on the portal.
- At most 30 other users on one login.

## Leaving steps

Where HR, the HR Director or the CEO closes a person's access (People, the person's file), the screen lists the shared
logins that person is named on, with each owner and backup. The same list is under "Shared logins", "When someone
leaves". The list is not shown when the module is not installed.

## Installing (once, after everything is merged; Fauzan runs the database modules, staging first)

1. Install `db/modules/accounts-access-v1.sql` first if it is not there (IT reads company names through it).
2. Run `db/modules/shared-logins-v1.sql` with `infra/run-db-migration.sh`. It is not on the release list.
3. The screen "Shared logins" appears for office staff. Until the module is installed the screen says so and Home stays
   quiet.

## One-week test of Microsoft shared logins (IT, before anything is bought)

Uses the Business Premium accounts the group already holds. Nothing here is done by Prima.

1. In the Microsoft Entra admin centre for `<tenant-id>`, add an enterprise application for one portal and choose
   password-based sign-on. Create a security group for its users.
2. Assign the group, then enter the shared credentials for the group. Change the portal password to a long new one
   straight after, so nobody remembers it.
3. Each tester installs the My Apps Secure Sign-in extension in Edge or Chrome, opens My Apps and clicks the tile. On a
   phone, use Edge with password sign-on switched on.
4. Repeat for the 10 most-used portals. For each, record: signs in by itself; needs a captcha or SMS code; fails.
5. Note the limits met: 48 saved logins per person; phone support; portals that reject automatic filling.
6. Report the table to the CEO. Logins that fail go in the vault instead.

## Tests

| Test | Covers |
|---|---|
| `packages/core/test/shared-logins.test.ts` | Who sees and keeps the list, password-looking text refused, 90-day and leaver states, Home items, master rows, closing, heads, group-wide view, banks and e-wallets, kinds of portal added and changed by IT or the CEO only. |
| `scripts/shared-logins-browser-uat.cjs` | Browser, demo build, 1280 and 390 px: IT adds a login, a typed password is refused, the CEO records a change. |
| `scripts/shared-logins-leaver-browser-uat.cjs` | Browser, demo build, 1280 and 390 px: HR starts "Close access" and sees the person's shared logins; after closing, the owner is told by the alert bell and the login is marked for a change. |
| `scripts/shared-logins-groupwide-browser-uat.cjs` | Browser, demo build with every made-up staff member, 1280 and 390 px: IT sees 43 companies and 16 departments, adds a security company, a central company and a department login; the CEO, two Company Managers, the FWM Manager, the OGM, an FWM executive, an admin executive and a site officer each see only what their job needs. The Add buttons next to a missing portal and a bank account fill in the form; IT adds a kind of portal and it shows as missing for security companies only. |
| `apps/api/test/shared-logins-pg.test.ts` | PostgreSQL: not installed before the module; row rules for reading and adding; a password field refused; the owner may only record a change; master rows CEO only; heads read their own department or central company only; central companies on IT's pick list; kinds of portal kept by IT only, in the database too. |

## Not built

- No connection to Microsoft Entra or to a vault. Prima cannot check that a tile exists or who used it.
- Marketing (built in PR #146): the Marketing Manager and Deputy head the department; tender portal logins are described in `docs/MARKETING_TENDER_DESK.md` (AH10).
