# Data and file manager for old records ("Fail & data lama")

Owner decision (Fauzan, 23 Nov 2026): "Do also a data and file manager. As staff upload all old data we have, even the
hard copy scan to computer." Built system first, as he asked the same day ("Use system more than ai"; "Staff do
minimal work"): no online reader is used by this feature.

Status: **source only, on a draft pull request.** Nothing is merged, deployed or installed. It needs three separate
go-aheads before staff can use it: the database module `archive-v1`, the file storage (already described in
`docs/FILE_STORAGE.md`, still off), and deployment.

Fauzan, 23 Nov 2026 (09:46 MYT): yes to the first two. The module is installed together with the whole build (not as a
separate step), staging first, and the file storage may be switched on. Neither has been done yet.

## What staff do

1. Open **Old files and data** and choose up to 20 files at once: PDF, photos and scans, Word, Excel, PowerPoint,
   text, CSV, email. 200 MB each at most (Fauzan, 23 Nov 2026: "Increase mb size to 200mb"; it was 25 MB).
   A file over 15 MB is kept but not read for its words on the device, so the person types its title and date.
2. Prima reads each file on the person's own phone or computer (`apps/web/src/paper-words.ts`) and the fixed rules
   suggest the folder, the date on the document, the reference and a title (`archiveSuggest`).
3. The person ticks **Checked** on the ones they looked at and presses **Save all**. Files not ticked are saved too
   and wait under **To check** (Home shows a reminder), so a large batch can be loaded first and checked after.
4. Anyone in the same unit finds a file by title, reference, file name or words inside the document, by folder and
   by year, and opens it. A file put in by mistake is **set aside** with a reason. Nothing is deleted.

## Folders

Finance; Clients and contracts; Tenders; Licences and permits; Staff files (restricted); Pay and contributions
(restricted); Company and board; Insurance; Assets and vehicles; Operations and reports; Letters and memos; Other.
The list is fixed in code (`ARCHIVE_FOLDERS`).

## Who sees a file (proposed; the owner may change it)

| File | Who |
| --- | --- |
| Any file | the person who put it in; the group leaders |
| Ordinary folders | the unit that owns it: one company's office, or one central department |
| Staff files, Pay and contributions | only the person who put it in, central HR and the group leaders |

A person files for their own central department, or else for a company office they belong to; a group leader with
neither files under the leadership office. Guards, shared site devices and system sign-ins have no file manager.
The application checks this on every action (`archiveMaySee`) and the database module checks it again with row-level
security. On companies the database is the wider backstop (any company the session may see); the application is
the stricter rule (the person's own company office).

## How a file is kept

- The bytes are **not** in the database. They go to the private file storage (`FILE_STORE=azure-blob`,
  `docs/FILE_STORAGE.md`) under `archive/<unit>/<file id>.<ext>`, signed in with the API's managed identity.
- A request may carry 3 MB, so a file travels in pieces of 1.5 MB (`start`, `parts`, `finish`). The server puts the
  pieces together write-once, **reads the file back**, and records the size and SHA-256 of what it read. The kind of
  file is taken from its first bytes. Every kind of file is kept (Fauzan, 23 Nov 2026: "Make sure all type of
  file"): zip, video, voice, drawings, Outlook messages and files with no extension are stored as they are, unread,
  and handed back only to save. Programs and scripts are refused, by name (.exe, .bat, .apk, .ps1, .js and the like)
  and by their first bytes (Windows, Linux and Mac programs under any name).
- The same file added twice for the same unit is marked a duplicate and points to the kept one.
- Every opening checks the size and SHA-256 again and writes an audit line. A file that no longer matches is not
  opened.
- The database row keeps the details, up to 6,000 characters of the document's own words for searching, who added
  it and when, and a short history of corrections. Audit actions: `archive.filed`, `archive.duplicate`,
  `archive.opened`, `archive.details`, `archive.set_aside`.
- With file storage off the screen says so and no file is accepted. Nothing is kept anywhere else.

## Database module

`db/modules/archive-v1.sql` (table `prima.archive_files`), **not** in `db/release-manifest.json`. Install only with
Fauzan's go-ahead, with `infra/run-db-migration.sh`, staging first. Repeat-safe. The app role has no DELETE; a
trigger keeps a kept file's unit, name, storage place, uploader, size and fingerprint from ever changing.

## Old data in Excel

An old Excel or CSV list is kept as a file and its words are searchable. Turning its rows into live Prima records
(staff, sites, clients, assets) is **not** done here: that goes through each module's own checked import with a dry
run, so nothing enters a live register without its rules. Linking a kept file to a record is a later step.

## Limits and unresolved gates

- Not tried against real Azure storage (the piece-by-piece calls are tested against a stand-in), on a real phone,
  or by staff.
- Search reads the newest 5,000 files a person may see and filters in the API; a database text index is a later
  step if the archive grows beyond that.
- A file is handed back in 1.5 MB pieces and saved to the device; it is not previewed inside Prima. Opening is
  logged and gives a pass that every piece asks for, so no piece is given without a logged opening. The server
  reads a stored file a few megabytes at a time and never holds a whole 200 MB file in memory.
- A 200 MB file is about 140 pieces each way; on a slow line that takes minutes. Not tried on a real line.
- Handwriting, old .doc/.xls and locked files are kept but their words cannot be read, so they are found by title,
  folder and date only.
- No retention periods are applied and no file is ever removed. Retention by kind of record needs an owner decision.
- An upload that is started and never finished leaves unused pieces in storage and a row marked `uploading`; a
  clean-up job is not written.
- Storage cost is not measured. It depends on how much the group uploads.

## Tests

- `packages/core/test/archive.test.ts` (11): suggestions, pieces, duplicates, refusals, who sees what, corrections,
  set aside, changed bytes, Home reminder.
- `apps/api/test/archive-pg.test.ts` (5, PostgreSQL with row-level security): not installed before the module; walls
  hold with the application bypassed; forged inserts, deletes and fingerprint changes refused.
- `apps/api/test/file-store.test.ts`: the Azure piece-by-piece calls against a stand-in.
- `scripts/archive-browser-uat.cjs` (26 steps, 1280 px and 390 px, demo build): add three files, duplicate, find by
  words, check, open (same bytes back), set aside.
