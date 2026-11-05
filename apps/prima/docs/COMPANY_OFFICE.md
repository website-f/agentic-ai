# Company office (each licensed company's own department)

Owner decision, Fauzan, 2 Nov 2026: "Each company have 1 company manager or gm and 2 to 8 executives."

Status: draft for review. Not merged, not migrated, not deployed. Synthetic data only.

## What it does

- **The GM heads the office where there is one (Fauzan, 2 Nov 2026).** A Company Manager account beside a GM is
  shown as "Company Manager (under the GM)", may hold desks like an executive, cannot share out desks, and is flagged for
  HR to change or close.
- **Team, keyed once.** The office team is read from the sign-in accounts HR and IT already keep: a `company_manager`
  account is the head (shown as General Manager when the title says so, otherwise Company Manager); an `admin_exec`
  account without a branch is an executive. Far-branch managers (`admin_exec` with `branchId`) run branches and are not
  counted. Nothing about people is typed again here.
- **Rule OFFICE-TEAM.** One head and 2 to 8 executives. No head or fewer than 2 executives is critical; more than one
  head, or more than 8 executives, is a warning. A company with no office accounts entered yet is Unknown, never green.
- **Desks (rule OFFICE-DESK).** The company's work is split into six desks: Guards, attendance and roster; Clients,
  contracts and billing; Tenders and quotations; Licences, insurance and compliance; Cases and incidents; Office,
  purchases and claims. The head gives each desk an owner and a backup. Only the company's own head may do this
  (V12: the company controls company matters). Every change is audited with the before and after names.
- **Fair first split.** Until the head saves a split, the screen suggests one: desks go round the executives, and each
  backup is the next executive along. It is only a suggestion until saved.
- **Cover (rule OFFICE-COVER).** When a desk owner is on approved leave (from the company's existing leave records) or
  has left the office, the backup holds the desk for the day; if both are away, the work falls to the head. The backup
  sees "You hold … today" on Home.
- **All company work in one workflow (Fauzan, 2 Nov 2026: "anything that company need to do are in the company
  workflow").** The office queue joins every module's company work: the Company Manager's Home (attendance, no-shows,
  cases, quotations to approve, contracts, branches, company secretary, credit, purchases, government mandates,
  compliance, audit findings), the Admin Executive's board (tenders, quotations, licences, guard papers), insurance
  alerts, client issues, office requests to send or fix, and leave the viewer may decide. Each source is read with the
  viewer's own rights; duplicates are shown once. Each line is routed to the desk that owns its screen. Approvals and arms always stay with the head and are never shown to
  executives as their work.
- **Consolidated group view (Fauzan, 2 Nov 2026: "all data must be consolidated so management will be easier").**
  Group leaders (CEO, COO, FD, CoS, DCoS, Chairman, Vice Chairman) see every office's staffing and desk cover, plus one
  list of all offices' open work, urgent first, counted by desk and by company, each line naming the company and who
  holds it today. It is a management view built from each company's own records (V7); nothing is merged or copied.
  Leaders read it and open the line's screen; they cannot change a company's desks.
- **Clearing a desk.** Choosing "Not shared out" for an owner removes both the owner and the backup from that desk;
  the work then waits with the head. A backup without an owner is refused.
- **Group readiness uses the same findings as the company page.** A company counts as Ready only when its own page has
  no findings (for example, no desk is missing a backup).
- **Correcting a returned quotation.** On a draft or returned quotation, the preparer can correct the guards, hours,
  rate and valid-until date of the same record with a required reason (`POST /quotations/:id/correct`). The audit keeps
  old → new values and the reason, then the quotation is sent to the manager again. Nothing is recreated.
- **In-app guide (Arisha main review, section A).** The office page shows "How to do it" cards for the viewer's office
  role only: share out desks (head), my desk work, cover, prepare a quotation, approve or return (head), correct a
  returned quotation, monitor all offices (leaders). Bahasa Melayu first, with English. Each card names the screen and
  button, fields with formats and a synthetic example, where the record is, whom to ask, what is reused, the reviewer,
  the return path, and what is not built yet. It is help only and never saves or approves. The mapping is versioned
  (`OFFICE_GUIDE_VERSION` in `packages/core/src/office-guide.ts`) so Arisha can use the same role-scoped cards; a test
  checks every quoted button, field and message against the current screens and service.
- **Hand-over hook.** `PrimaService.officeDeskHolders(companyId, desk)` returns who should receive work for a desk today
  (holder, backup, head), for other modules that route work to company offices.

## Companies run by another office (draft, 3 Nov 2026)

Owner request, Fauzan, 3 Nov 2026: a Company Manager sometimes also manages and monitors other companies that sit under
him, usually companies without a licence, or with a licence but not enough projects of their own; he must be able to
monitor and manage them and delegate staff to do their work.

- **Who sets it.** The Chief of Staff (Fauzan, 3 Nov 2026: "cos will set"), and the CEO as owner and master admin; not
  the Deputy Chief of Staff and not Company Managers. On the Company offices page ("Companies run by another office"), with a required reason
  (for example the board decision). Every change is audited with before → after and the reason
  (`POST /companies/:id/office/run-by`, audit action `office.runBy`). "Its own office" ends the arrangement.
- **One level only.** A company that is run by another office cannot run others, and a company that runs others cannot be
  run. A company cannot run itself. Anything else is ignored by the reader, so a bad link never widens access.
- **What the running office gets.** The running company's office head (GM, else Company Manager) and its executives
  without a branch get the run company added to the companies they work for, through the same permission rules and the
  same PostgreSQL company wall. Branch managers, guards, supervisors, group staff and system feeds are not widened.
- **Exact scope (Arisha main review, 3 Nov 2026).** Intended, from Fauzan's "monitor and manage this also. And delegate
  staff to do the work": on the run company, each person of the running office has **exactly** the rights their own office
  role has in their own company, no more and no less. Concretely:
  - Company Manager or GM: view, roster edit and publish, attendance lock and follow-up, discipline records, cases
    (raise, update, close), site patrol and visits, insurance view, arms view and handling, **HR** guard profiles and pay,
    staff leave requests, **commercial** view, prepare and approve quotations, and desk sharing for the run company's office.
  - Admin executive (no branch): view, roster edit, cases (raise, update), insurance view, attendance follow-up, **HR**
    guard profiles and pay, leave requests, **commercial** view and prepare. Not approve, not desks.
  - Not widened: branch managers, supervisors, guards, site devices, group staff and system feeds; leave decisions and
    group HR monitoring stay with their own owners. The database wall is per company, so these service rules are what
    separate HR pay from other screens.
  - Tests: a parity test over every permission (27 actions) for the running head and executive, plus "nothing before the
    link" and "nothing for a branch manager"; HR guard profile with pay for the running head and executive, refused for
    another company's manager and a branch manager; commercial approve for the head, prepare but not approve for the
    executive (`packages/core/test/company-run-by.test.ts`).
  - Arms handling for another licensee's company is a legal matter (Arms Act 1960 and the KDN licence holder). It is
    flagged for the directors, not blocked for staff, in line with the project rule on legal flags.
- **Head and delegation.** The running office's head is the head of the run company's office and shares out its desks;
  the running office's executives can own and back up its desks (shown "from the … office"). The run company's own
  Company Manager, if any, works beside the head, like a Company Manager beside a GM. Approvals and arms stay with the head.
- **Screens.** The running office sees "Companies your office also runs" with a link to each one's office; the run
  company's office shows "Run by the … office". The group page shows who runs what. Executives are counted once in the
  group total.
- **KDN licence.** Shown as a fact from the company's existing Licences records (held, expired or not recorded). It is
  never a block, and no legal judgement is made here.
- **Upgrade.** The module also drops the policy names of the earlier review draft (751a045), so a run over that draft
  leaves only the reviewed policies; tested. No prior install is known.
- **Storage.** The links are kept in their own small table, `prima.company_run_links` (company ids, reason, who and
  when; no personal data), from the optional module `db/modules/company-run-links-v1.sql`. They must be read for each
  request before the company wall is set, so they are not on the company record (which the wall hides). Reading is open to
  the app role; writing is limited in the database to the Chief of Staff and CEO accounts and to companies on their wall; there is no
  DELETE. Catalogue check: `companyRunLinkProblems`, reported under `runLinks` in `GET /api/health/company-office`.
- **Before the module is applied** no company is run by another office, every office works only for its own company,
  and the setting is refused with a plain message. Fauzan approved this module on 3 Nov 2026
  ("Yes, via the release path"); it is installed only through the release path after the combined review.

## Sign-in (rollout, draft)

While the IT pilot is on, only pilot users sign in. The company office joins through the shared rollout switch
(`packages/core/src/rollouts.ts`, the same file as the Connect departments work). It is registered as
`registerRollout('company_office', …)` with the rule `inCompanyOfficeRollout` in `company-office.ts`.

- **Who is admitted:** each company's office head (GM or Company Manager) and admin executives, all without a branch.
- **Who is not:** branch managers, guards, supervisors, site devices, group staff and system feeds.
- **Off by default:** it starts only when the CEO adds `company_office` to `PRIMA_ROLLOUTS`.
- **Which companies join** depends on which office accounts HR and IT create for that wave. Closed accounts are refused
  before this rule is read.
- Tested in `packages/core/test/company-office-rollout.test.ts`. A local trial merge with the Connect departments
  branch also showed that the API's sign-in rule refuses the GM with no rollout started, and admits them with
  `PRIMA_ROLLOUTS=company_office`.

## Where it lives

- `packages/core/src/company-office.ts`: rules, desks, team reading, suggested split.
- `PrimaService.companyOffice`, `setOfficeDesks`, `companyOffices`, `officeDeskHolders`, Home lines.
- API: `GET /offices`, `GET /companies/:id/office`, `POST /companies/:id/office/desks`.
- Screen: Company office (`apps/web/src/views/Office.tsx`), for company heads, executives and group leaders.
- Database: optional module `db/modules/company-office-v1.sql` (table `prima.company_desks`, company wall RLS, no
  DELETE, repeat-safe). It is **not** part of `001_init.sql` and not in the release manifest, so the reviewed base schema hash does
  not change. Until it is applied in an authorized migration window, the office opens with every desk "not shared out"
  and saving is refused with a plain message. Local `db:reset` applies it for development and tests.

## Packaging proposal (not installed)

The proposal file is `db/proposed/company-office-module.json`, in the same shape as the Central Admin and hand-over
proposals. It pins the base hash and the module hash (sha256 `9fd6a945…5d834e9`), and places the install after the
five release-manifest modules. `requires` is empty. It is not in `db/release-manifest.json`, and nothing is installed.

- **Repeat-safe.** A second run keeps every row. It recreates only its own `company_wall` policy and resets the app
  role's grants to SELECT, INSERT and UPDATE.
- **Catalogue check (fixed 3 Nov 2026 after Arisha main's review).** `companyOfficeProblems` in
  `apps/api/src/company-office-readiness.ts` returns problem names, never data, and `GET /api/health/company-office`
  returns the same list. The earlier check matched substrings, so a policy reading `visible_companies() ... OR true`
  passed. It now compares each definition in full against the attested text (`COMPANY_OFFICE_ATTESTED`), using
  PostgreSQL's own normalised output. `prima.` is stripped first, so the reader's search_path does not matter.

### Attested definitions (what "ready" means)

| Object | Reviewed definition |
|---|---|
| Table | `prima.company_desks`, not owned by `prima_app`; RLS enabled and forced |
| Columns | `id text NOT NULL`, `company_id text NOT NULL`, `data jsonb NOT NULL`, in that order, nothing else |
| Policy | exactly one: `company_wall`, PERMISSIVE, roles `public`, command ALL, USING and WITH CHECK both `(company_id = ANY (prima.visible_companies()))` |
| Function binding | the policy depends (pg_depend) on `prima.visible_companies()`; that function is the base one: `RETURNS text[]`, `LANGUAGE sql`, STABLE, not SECURITY DEFINER, body `SELECT coalesce(string_to_array(nullif(current_setting('app.company_ids', true), ''), ','), ARRAY[]::text[])` |
| Constraints | exactly: `company_desks_pkey PRIMARY KEY (id)`; `company_desks_id_matches CHECK (((data ->> 'id'::text) = id))`; `company_desks_company_matches CHECK (((data ->> 'companyId'::text) = company_id))`; `company_desks_id_format CHECK ((id = ((('desk-'::text \|\| company_id) \|\| '-'::text) \|\| (data ->> 'desk'::text))))`; `company_desks_desk_known CHECK (((data ->> 'desk'::text) = ANY (ARRAY['people', 'clients', 'tenders', 'licences', 'cases', 'office'])))` |
| Indexes | exactly `company_desks_pkey` (unique btree on id) and `company_desks_company_idx` (btree on company_id) |
| Privileges | only `prima_app`: SELECT, INSERT, UPDATE; nothing for PUBLIC or anyone else; no column-level grants |
| Triggers | none |

- **Uses** `prima.visible_companies()` and the `prima_app` role from the base.
- **Switch.** There is no separate flag: the API detects the table. Before the install, every desk shows "not shared
  out" and saving is refused.
- **Rollback.** Revoke INSERT and UPDATE from the app role, which makes the office read-only. The table is kept,
  because desk splits are company records.
- Fauzan said yes on 2 Nov 2026. It is still applied only through the release path with his direct go-ahead.

## Evidence

- Core unit tests: `packages/core/test/company-office.test.ts` (in-memory store).
- PostgreSQL tests on a local PostgreSQL 16: `apps/api/test/company-office-rls.test.ts` (company wall on read and
  write, executive and other-company head refused through the API path, two simultaneous first saves serialized, module
  missing handled).
- Packaging test on a throwaway local PostgreSQL 16 (`apps/api/test/company-office-packaging.test.ts`). It checks the
  pinned bytes, that the module is missing on the base, an install as a non-superuser owner, and a second run that keeps
  rows and repairs drift. Each of 24 drifts is applied in a rolled-back transaction and must be reported:
  - `USING ... OR true` and `WITH CHECK ... OR true`; `USING (true)`; the wall dropped, made RESTRICTIVE, or limited to
    one role; an extra policy;
  - `prima.visible_companies()` replaced with another body; the wall rebound to a look-alike `public.visible_companies()`;
  - a CHECK dropped, or kept under the same name with a looser expression (two cases); an extra CHECK;
  - a column made nullable; an extra column; RLS not forced;
  - DELETE granted; UPDATE revoked; SELECT to PUBLIC; a column-level grant;
  - an index dropped; an extra index; an extra trigger.

  The same result is read under another search_path. On the dev database `db:reset` builds, the check returns no problems.
  Full API suite on PostgreSQL 16: 690/690.
- Guide accuracy test: `packages/core/test/office-guide.test.ts`.
- Companies run by another office: core tests `packages/core/test/company-run-by.test.ts` (in-memory store: link rules,
  who is widened, Chief of Staff or CEO only (not the Deputy or a head), with reason, no chains, audit, GM heads and delegates to Sasa executives, another company's
  executive refused, own Company Manager beside the head, group totals). PostgreSQL tests
  `apps/api/test/company-run-links.test.ts` on a local PostgreSQL 16: before the link the GM is refused; a head and
  the Deputy Chief of Staff are refused by the service and by the database; the Chief of Staff's id outside the wall is
  refused; DELETE is denied; after
  the Chief of Staff's link the GM heads the run company and saves a desk for a Sasa executive behind the run company's wall; a Sasa
  branch manager and another company's executive are refused; ending the link removes access; with the module missing,
  offices still open and the setting is refused. Packaging on a throwaway database as a non-superuser owner: missing on
  the base, install, repeat-safe, self-link and id-mismatch refused, 10 drift cases reported.
- Synthetic browser run on the local demo build (headless Chromium, IT pilot switched off locally only, not
  committed): executive enters a quotation and sends it; GM's empty return note is refused; GM returns it; executive's
  correction is blocked without a reason, then saved on the same record (total RM 20,700 = 6 × RM 3,450) and resent;
  GM approves; executive sees no Approve or "Share out desks"; GM sets and then clears a desk, which shows "Not shared
  out"; the CEO sees only the read-only monitor card. This is a demo-mode (in-memory) run, not PostgreSQL and not staff
  UAT.

## Open for the owner

1. Decided 2 Nov 2026: the GM is the head (Sasa). HR to change or close the Company Manager account beside the GM.
2. The six desks are a proposal; rename, merge or add desks if the companies split work differently.
3. Fauzan said yes to the database module on 2 Nov 2026; it goes through the release path after the combined review.
   Adding real office staff accounts and enabling company staff sign-in (the IT pilot
   currently limits sign-in) each need separate authorization.
4. Companies run by another office (3 Nov 2026): Fauzan decided the Chief of Staff sets it ("cos will set"); the CEO
   keeps the same right as owner. Fauzan said yes to the database module `company-run-links-v1.sql` on 3 Nov 2026;
   it goes through the release path after the combined review. One level only; the KDN licence is shown as a fact, never a block.
