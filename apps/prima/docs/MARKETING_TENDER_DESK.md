# Marketing tender desk (part 1)

Owner decisions: Fauzan, 22-23 November 2026 ("We create one marketing department that enter all tender", "Marketing
does all", "Build now"). The full decision list D1-D14 and the build items AH1-AH14 are in
`/mnt/project-files/fitri-instructions/2026-11-23_marketing-tender-department-part-AH.txt`.

Source in the repository is not deployment, migration or operational acceptance. The desk is **off** until the CEO or
the COO starts it in the app.

## What part 1 builds

- **The department.** `department: 'marketing'` with `marketingRole` manager, deputy or executive (PWVSB staff, reports
  to the COO). Planned size: 1 Manager, 1 Deputy, 7 Tender Executives, 5 to 6 companies each (rule `TENDER-MARKETING`).
- **Who covers which company.** An executive's companies are the companies they hold an active company access line
  (grant) for. The Manager and the Deputy hold a line for every company. There is no separate assignment table: IT or
  HR prepares the lines in Accounts and Access and the HR Director or the CEO approves them.
- **A new right, `tender.work`.** Only Marketing staff get it, and only for companies they cover. It lets them work a
  bid (record, papers, checklist, ticks, files, lodging). It is not `commercial.prepare`, so quotations, leads and
  price approval stay with the company.
- **The switch.** `startMarketingDesk` (CEO or COO, with a comment and a start date) stores `marketingDesk` on the
  tender protocol row. Before the start date nothing changes: companies prepare their own bids and the Director Office
  keeps the protocol.
- **After the start.**
  - Every new tender is a Marketing desk bid (`Tender.desk = 'MARKETING'`). Bids a company started earlier have no
    `desk` and are finished by that company as before.
  - The company manager is told at once and has 1 day to say "do not bid" (Tidak bida, with a reason). Silence means
    go. A "do not bid" stops the bid and is counted.
  - No "teruskan" decision and no Director Office checklist review are needed on a desk bid. The executive drafts
    the checklist from the papers and works it; the Manager may spot-check.
  - Sign-off is preparer, then the Marketing check (Manager or Deputy, with a comment, never the preparer), then the
    company manager (price and bid, with a comment). Marketing lodges and uploads the slip.
  - The Marketing Manager and Deputy keep the tender protocol, the tender sites list and the joint-entry board. The
    Director Office monitors.
- **The tracker** (`GET /api/marketing-board`, screen "Marketing"). Per company this month: tenders entered, being
  prepared, "do not bid" count; a company with nothing entered and nothing in progress is red. Bids closing in 3 days
  go to the executive and the Manager; 1 day before closing the COO is told on the home board; an approval not given
  after 1 day is listed; a company that says "do not bid" twice in a month is shown to the COO. Counts only: no prices
  and no files.

- **Reason for no entries.** For a company with nothing entered this month, the executive who covers it or a Marketing
  lead writes the reason (`POST /api/marketing-desk/no-entry-reason`). It is kept on the tender protocol row, one line
  per company and month, 24 months.
- **Working hours for each bid.** Marketing staff add the hours they worked on a desk bid (`POST
  /api/tenders/:id/hours`, quarter hours). At least one entry is needed before the bid is lodged. The board shows the
  average for bids lodged this month, for the desk and for each person. These are hours as entered by staff, not a
  timer.

- **Company paper library (AH7).** Each company keeps the papers bids usually need on "Tenders & quotes": SSM forms
  and the latest company search, company profile, bank statements by month, audited accounts by year, bank letter,
  EPF, SOCSO and SST registration, PPKKM membership, experience letters, organisation chart. Each paper has its file
  and, where it ends, an end date. Licences (KDN, MOF, MOF digital certificate, SSM annual return) stay in the licence
  register and are only shown here. Prima marks each need Ready, Ending soon (within 30 days), Expired or Missing, for
  a government bid or a private bid (rule TENDER-PAPERS, Policy. Fauzan, 23 Nov 2026: the last 3 months of bank statements
  and 1 year of audited accounts. Proposals: accounts ready from July, company search fresh for 90 days). The company office
  and the Marketing staff who cover the company add papers (`GET/POST /api/companies/:companyId/papers`); a new copy
  replaces the old one, which is kept and marked replaced, and nothing is deleted. No identity-card copies are kept.
  The company manager and admin executives get one home line when a paper is missing or ending; each open tender shows
  what is not ready; the Marketing board has a Papers column. The tender papers always decide what a bid needs.

- **Site visit and briefing tracker (AH13).** The tender record holds the briefing and the site visit (mandatory or
  not, date, place, and whether only the person named on the company's MOF certificate may attend; Marketing cannot
  go in the company's place then). From the day a date is recorded, the company manager and admin executives see
  "Name who attends" on their home until the company names its person (`POST /api/tenders/:id/attendee`); where only
  the MOF-named person may go, the company must say the person is named on the certificate. The Marketing board lists
  it too, and a mandatory one with nobody named 3 days before also goes to the COO (proposal). On or after the day,
  the attendance slip is kept, or the reason nobody went (`POST /api/tenders/:id/attendance`). A bid whose mandatory
  briefing or site visit has passed without a slip is not lodged. Stored on the tender; no new table.

- **IT tenders (AH12).** On a desk bid that needs IT work, the Marketing executive presses "Send the IT part to IT"
  (`POST /api/tenders/:id/to-it`, with the IT codes asked). IT gets a task linked to the bid on its usual timeline
  (the company must hold the codes with a MOF certificate in force), without the company-papers, eP submission and
  company-confirmation steps, which stay with Marketing. IT drafts the technical part, the IT Lead checks it, the IT
  Manager agrees the IT price with the company manager and the COO or CEO sees it, then IT hands the pack to
  Marketing. The bid cannot be lodged before that hand-over; when Marketing lodges it the IT task shows as lodged.
  Marketing sees only where IT stands, not the IT files or the IT price.

- **Items the check caught (AH14).** When the Marketing check (Manager or Deputy) sends a desk bid back, each line of
  the note is one item the first pass missed. It is kept on the tender (`checkCaught`, with who prepared the bid). The
  Marketing board shows the items caught this month, how many bids were sent back, how many lodged bids passed the
  first time, and for each person the items found on the bids they prepared. Stored on the tender; no new table.

- **Proposals (AH8).** A proposal is our own offer to a private client, without tender papers (Fauzan, 23 Nov 2026).
  After the desk starts, Marketing staff who cover a company press "New proposal" on the Marketing screen (`POST
  /api/proposals`: client, title, what we offer, contact, the date to send it by, guards, sites). It is kept as a desk
  bid with `proposal` set and channel Private, so it sits on the company's "Tenders & quotes". The company manager is
  told and may say "do not bid" within the usual notice. There is no tender protocol, no tender papers, no briefing and
  no tender file list: the executive works the fixed proposal checklist (client need, survey, posts and hours, price,
  profile, licences, experience, signed offer letter, final check; a proposal by Claude, change it if needed). Sign-off
  is the same (preparer, Marketing check, company manager approves the price), hours are needed, and "lodging" means
  sending it to the client with a copy kept. A late proposal can still be sent; it reminds Marketing, never the COO.
  The board counts proposals sent apart from tenders entered, and a proposal does not clear a company's red. Quotations
  stay with the company's admin team. Stored on the tender; no new table.

- **Reading the tender papers (AH9).** "Use system more than ai" (Fauzan, 23 Nov 2026). "Draft checklist from the
  papers" now reads the text of every uploaded PDF paper and drafts the checklist by fixed rules in Malay and English
  (`packages/core/src/tender-reader.ts`): MOF codes, Bumiputera, KDN, SSM, bank statements (with the months), audited
  accounts (with the years), bank letter, EPF and SOCSO, SST, briefing and site visit (mandatory, date), document
  purchase, experience (years), training, integrity pact, deposit, performance bond, insurance, minimum wage, offer
  validity (days), digital certificate, PPKKM, and the forms named (Lampiran, Borang). Each item says which paper it was
  found in. Items usual for that kind of tender but not found are still listed as "Not found in the papers". Papers
  the app cannot read (scanned pages, pictures) are named at the top for reading by hand. No AI is used; an AI reader
  can be plugged in later only with Fauzan's approval. The Marketing check still compares the bid with the papers.

- **AI check of the checklist against the papers.** Fauzan, 23 Nov 2026 (decision card "Yes, AI checks once, person
  answers"; "Ai service is link to prima secure already"). When the preparer signs a desk tender (not a proposal),
  Prima sends the checklist labels and, from the buyer's tender papers, only the lines that state what the bidder must
  do or send (each with the line before and after, found by fixed Malay and English words), once, to the Arisha Azure
  OpenAI connection: at most 40,000 characters (about 10,000 tokens) per tender, following Fauzan's 23 Nov 2026 rule to
  keep AI tokens low (a mini model is enough). Nothing else is sent: no staff names, no prices, no company files. The AI lists what the papers ask that
  the checklist misses or states differently, each with words quoted from a paper. Prima keeps a point only if those
  quoted words are really in that paper's full text (others are dropped and counted), at most 30. Papers with no readable text, or
  too long to send, are named so they are read by hand. The Marketing Manager or Deputy (never the preparer) answers
  every point, "Fixed" or "Not needed" with the reason (`POST /api/tenders/:id/ai-flags/:flagId`), before the Marketing
  check can approve. The AI never ticks, signs or changes the bid. If the AI cannot run, the bid goes on and the
  Marketing check reads the papers as usual; a later signature tries again. It is off until `TENDER_AI_CHECK_ENABLED=true`
  is set with the Arisha settings (`ARISHA_ENABLED` and the `AZURE_OPENAI_*` values). Stored on the tender
  (`aiCheck`); no new table. The Marketing check note can now be up to 1,500 characters.

- **Tender watcher (AH11).** Fauzan, 22-23 Nov 2026 ("1 tender watcher to find tender"; "Use system more than ai").
  The Marketing Manager or Deputy reads a site's terms and presses "Let the watcher read this site", saying what they
  read (`POST /api/tender-sources/:id/watch`). Once a day the server then reads that site's listed public pages and
  picks out guarding notices by fixed Malay and English words (`packages/core/src/tender-watcher.ts`): the notice text,
  its number, the closing date and its link. No AI, no logins, no forms, no cookies, no files: one plain GET per page,
  only where the site's robots file allows it (a robots file that cannot be read means the site is left alone), at
  least 5 seconds between requests to a site, https only, same-site redirects only, never a private or local address,
  pages up to 1.5 MB. A notice seen before is not shown again, nor one whose number is already on the opportunities
  list. Each new find waits on the site row: Marketing records it as an opportunity (checking the closing date on the
  notice) or drops it with the reason (`POST /api/tender-sources/:id/finds/:key`); the Marketing board lists new finds.
  When every page was read the run counts as the site's check; a page not read (robots file, error, PDF) keeps the site
  due for a person. PDF notices and pages behind a login are not read. It runs inside the API 15 minutes after start
  and then every 24 hours, as the system sign-in `u-tender-watcher` (integration `tender_watcher`, which IT creates on
  the live database as for WhatsApp), and only while `TENDER_WATCHER_ENABLED=true`. Stored on the tender site row; no
  new table.

- **Tender portal logins (AH10).** Fauzan, 23 Nov 2026: no separate store; they use the shared login list
  (`docs/SHARED_LOGINS.md`), which never holds a password. IT adds each company's ePerolehan login, or a buyer's tender
  or vendor portal (new kind "Buyer tender or vendor portal"), and names the Tender Executives who cover that company
  as users. On a desk bid being prepared, the executive sees "Portal login for lodging": the system, where the
  password is kept, the owner, the backup and who holds the code phone, or "ask IT" when they are not named
  (`GET /api/tenders/:id/portal-logins`). In "Across the group", IT sees for each company the Marketing executives who
  cover it but are not named on its tender login, or that it has none, with "+ ePerolehan" to add it. The Marketing
  Manager and Deputy head Marketing, so they see the Marketing department's own logins. The 90-day password change,
  the leaver list and the "no password" checks are the shared login list's own. ePerolehan is still not on the usual
  portals every company must have (rule SHARED-LOGIN-PORTALS); IT or the CEO may change that under Kinds of portal.

## What is not in part 1

Nothing from AH1 to AH14 is left out. Still gated: merge, the database modules, deployment and each switch.

## Database

The paper library is a new table in **`db/modules/company-papers-v1.sql`** (company wall, no delete, a saved paper
changes only by being marked replaced). It is NOT on `db/release-manifest.json`. Fitri runs it with
`infra/run-db-migration.sh`, staging first, only with Fauzan's go-ahead. Until then the screens say "Not installed"
and adding a paper is refused. Checked on PostgreSQL in `apps/api/test/company-papers-pg.test.ts`.

Otherwise no new table. Tenders stay behind each company's wall, so an executive reads and writes only the companies they hold a
grant for (checked on PostgreSQL in `apps/api/test/marketing-desk-pg.test.ts`).

One small add-on module, **`db/modules/marketing-accounts-v1.sql`**, replaces `prima.acc_templates()` with the same
list plus the three Marketing kinds of account. It is NOT on `db/release-manifest.json`. Fitri runs it with
`infra/run-db-migration.sh`, staging first, after `accounts-access-v1` and only with Fauzan's go-ahead. Until it is
installed the app offers the Marketing kinds but the database refuses them.

## Switching on (after merge, migration and deployment, each with Fauzan's go-ahead)

1. Install `marketing-accounts-v1` and `company-papers-v1`.
2. In Accounts and Access prepare the Manager, the Deputy and the executives, each with their company access lines.
3. The CEO or the COO opens "Marketing" and starts the desk with a start date.

## Open points for the lawyer (not blocking the build)

- The wording on related companies in Lampiran A2 and the integrity pact, before two group companies enter the same
  tender.
- The start date of the Government Procurement Act (Act 882).
- Who may submit in ePerolehan and with which digital certificate; and site visits where only the person named on the
  MOF certificate may attend.
