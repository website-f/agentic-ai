# Offline site survey form

Status: draft, built 5 Nov 2026 from Fauzan's staff usability rule 5 (4 Nov 2026): "survey forms: photos and
measurements, offline, sync later, no retyping", and the release order that sends a site survey to the Project
Director. The online IT pilot passed on 5 Nov 2026 and Fauzan asked to build everything still not built, which
ends the earlier "offline after the pilot" hold for this module only. Synthetic data only. This is not merged,
migrated or deployed.

## What staff do

1. Open **Site survey** (company managers, admin executives, site officers, PWVSB operations with a grant).
2. Tap **New site survey**. Choose a sales lead, one of our sites or a new place. Record GPS, which works with no
   signal.
3. Fill in the site details and measurements: type, hours, perimeter, area, floors, entrances, vehicle gates, CCTV,
   lighting, fence, alarm, guard house, and any extra measurements.
4. Tick the risks, add the guard posts (hours a day, shift length, guards a shift, armed). The screen works out
   guards a day.
5. Take photos with the in-app camera. Each one carries a burned-in time and GPS stamp. Then write the findings.
   Where photography is not allowed (a protected place under the Protected Areas and Protected Places Act 1959,
   or a client rule), the survey can go with no photos, but only with a written reason. It then goes straight to
   the Project Director.
6. Tap **Finish and send**. With no signal, the survey waits on the phone and is sent automatically when there is
   one. It retries after 30 s, 1 min, 2 min and so on, up to every 15 min, and again when the phone comes back
   online.

If Prima is opened with no signal at all, the last person signed in on that phone still gets the survey screen.
Nothing else opens until the phone has a signal. The phone refreshes its list of leads and sites every time the
app is opened with a signal, so the survey screen works offline even if it was never opened before.

## Who decides

The Project Director decides each survey (Fauzan, 5 Nov 2026). That means the COO, the Operations General
Manager or the Operations Director, and they need a grant to the company. They accept or return a survey, always
with a reason. Nobody decides their own survey.

Accepting a survey linked to a researched sales lead fills that lead's survey step, so nobody types it again. A
lead that has not been researched only gets a note.

A returned survey can be redone. The answers are copied over and new photos are taken. Only the person who made
it can redo it, and only once.

## How sending is kept safe

- The surveyor is always the signed-in account and the trusted time is the server's. Times sent by the phone are
  shown but marked: sent later, or phone clock wrong. A phone clock that runs backwards (finish before start) is
  marked, not refused, so the survey is never stuck on the phone.
- The survey is sent once, and its content is fingerprinted with SHA-256. A resend of the same survey changes
  nothing. Different content under the same number is refused.
- Photos go one by one, so a weak signal only resends the photo that failed. Each photo must match the
  fingerprint the survey listed. The same picture cannot be used in two surveys of a company.
- A survey reaches the Project Director only when every photo has arrived.
- Surveys and photos are kept on the phone in the browser's own database (IndexedDB), never in the page cache.
  Only the person who made a survey sees or sends it. Photos are removed from the phone once the survey is sent,
  and sent records are cleared after a week. How long the server keeps survey photos is for the PDPA officer
  to set.
- Locked on the phone (Fauzan, 5 Nov 2026, "Do encryption"). Every survey, photo and saved lead/site list is
  encrypted with AES-256-GCM before it is written. Each person on the phone has their own key, made by the
  browser as non-exportable: the app can use it, but nobody can read the key out. Each record is tied to its
  survey number and owner, so a record moved to another person or changed is refused, not opened. Only the survey
  number, owner account number, state and time stay readable, so the phone can count and send surveys. On a page
  without browser encryption (unsafe http), nothing is written to the phone. Signing out destroys the key of a
  person with nothing left to send, so their old records can never be opened again.
- What this does not stop: someone who has the phone unlocked and opens Prima as that person. Staff phones still
  need a screen lock.

## Database step (needs the CEO's go-ahead)

`db/modules/site-surveys-v1.sql` is a **proposed** module and is not in `db/release-manifest.json`. It adds:

- `prima.site_surveys` and `prima.site_survey_photos`, behind the usual company wall, with row-level security
  forced.
- A guard trigger. A sent survey's content, surveyor, receive time and photo list never change. Its status only
  moves forward, it is decided once, and never by its own surveyor.
- Write-once photos: the app login can insert them but cannot change or delete them. It cannot delete surveys
  either.

Until the module is installed, the API answers survey requests with 503, "storage not switched on yet". Phones
then keep their surveys and try again later. The base schema `db/migrations/001_init.sql` is unchanged, so the
pinned release and base-transition chain is untouched.

Photos are stored in the database row for now, like the other evidence photos. The cloud file storage in draft
PR #75 can add `siteSurveyPhotos` to its file tables later.

## Tested

| Check | Result |
| --- | --- |
| Core tests (memory store) | `packages/core/test/site-surveys.test.ts`, 12 tests |
| Local PostgreSQL | `apps/api/test/site-surveys-rls.test.ts`, 3 tests |
| Browser walk-through, test version, 390 px and 1280 px | `/mnt/project-files/bundle/survey-uat/` |
| Phone lock check (raw phone database read, no survey words or photos readable; key not exportable; moved record refused) | `survey-crypto-uat.cjs` in the same folder |
| Sign-out check (key kept while a survey is unsent and the draft reopens; key, records and lists gone once all sent) | `survey-signout-uat.cjs` in the same folder |

The local PostgreSQL tests cover:

- the closed answer before install
- the company wall
- two resends at the same time
- the guard trigger, including a no-photo survey without a reason
- write-once photos
- no second decision

The browser walk-through covers a company manager filling and sending a survey, and the Operations Director
accepting it.

Not tested: a real phone in airplane mode on the server build, Microsoft sign-in renewal after a long offline
period, and real camera or GPS on iPhone and Android. The test version cannot open the camera or GPS.
