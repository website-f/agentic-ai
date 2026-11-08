# Screening case file and guard code of conduct

Package 1b of the PIKM (SIRIM code) and ISO 9001:2015 review (Fauzan, 5 Nov 2026). It is built on the HR Phase 3 draft (PR #51) and stacked on it as its own draft PR. It extends the existing HR module. It is not a separate app. Draft only: it is not merged, migrated or deployed.

## What it adds

### Screening case file (HR monitor, "Screening" panel)

- **One case per person screened.** This covers guards, officers, office staff, directors and shareholders. HR opens a case from the staff number (or picks the company and enters the name plus the last four ID digits for a director or shareholder).
- **Prima fills in what HR already holds.** A valid KDN guard card on the licence record marks KDN vetting clear. A submitted eSIMS vetting is marked pending with its reference. The ID on file is shown so HR checks the original.
- **Checks per kind of person (approved by Fauzan, 8 Nov 2026):**
  - Guard and officer: application, interview, consent, identity, KDN vetting, police, references, medical.
  - Office: application, interview, consent, identity, references, qualifications.
  - Director and shareholder: consent, identity, police, bankruptcy (MDI), SSM search.
- **Each check keeps its evidence.** A "clear" result needs the authority's reference or where the evidence is filed (interview and identity excepted). A concern, or "not needed", needs a reason. Earlier results are kept as history.
- **The HR Director (CoS or DCoS) decides**, with a reason, and never on a case they opened. The decision is "cleared" only when every check is done. "Cleared to start, KDN vetting pending" is allowed only for a guard or officer whose vetting is submitted in eSIMS while everything else is done (Fauzan, 24 Oct 2026). A concern on file needs written conditions to clear.
- **Repeat screening (approved by Fauzan, 8 Nov 2026):** every 36 months for staff and guards, every 12 months for directors and shareholders. It shows as due 60 days ahead, and HR starts it with one tap.
- **Who sees it:** HR, the HR Director and the CEO work with it. ACT reads only. Company managers, officers and staff never see screening.

### Guard code of conduct (policies)

- An HR policy now says who must read it: office staff (as before), guards and officers, or everyone.
- Guards acknowledge on their own sign-in, in the Duty screen.
- Guards without the app are recorded at a briefing. The officer (own company's guards only), the OM, the company manager or HR ticks who attended and understood. They give the briefing sheet or reference, at most 80 people at a time. The record keeps who witnessed it.
- A **material change** asks everyone again. A small correction (typo, wording) keeps the acknowledgements. Changing who must read it always counts as material.
- Existing office policies behave exactly as before.

## Database (needs the CEO-run migration)

- New table `prima.hr_screenings` in `db/migrations/001_init.sql` (HR Phase 3 section):
  - company wall;
  - read: `hr_cases` wall (HR, HR Director, CEO) or `act` wall (ACT);
  - insert and update: `hr_cases` wall only;
  - no delete grant (a case is withdrawn, never removed).
- `db/release-manifest.json` base hash updated to the new schema bytes.
- Policies and acknowledgements reuse `prima.hr_policies` and `prima.policy_acks` with new optional fields (`audience`, `ackFromVersion`, `method`, `witness`). No new columns.

## Server routes

- `GET /hr/screening`, `POST /hr/screening/:action` (open, check, decide, withdraw), `POST /hr/screening/:id/repeat`
- `POST /hr/policies` now takes `audience` and `material`
- `POST /hr/policies/:id/briefing` with `{ personIds, ref }`

## Tests

- Core: `packages/core/test/hr-screening-conduct.test.ts` (role limits, no self-decision, KDN prefill, cleared-pending rule, briefing scope, material change).
- Database: `apps/api/test/hr-screening-rls.test.ts`. Company and manager see no screening rows. ACT reads but cannot change, open or delete. Officer briefing works through the real walls.

## Decided by Fauzan (8 Nov 2026)

- The check lists per kind of person and the repeat intervals (36 and 12 months): approved as built. The PIKM code text may still change them.
- The OM and company manager may record briefings for any guard of their company, as well as officers: approved as built.
