# Upload, Key in and Download on every screen

Fauzan, 23 Nov 2026: "After we check upload button for all tab or all deparment. Dont have upload, key in, download."

## What the check found

`docs/SCREEN_TOOLS_AUDIT.md` lists every screen and tab (88 screens, 320 tabs, seen by 25 test people on main
0943918). Before this change, Upload was missing on 264 tabs, Key in on 137, Download on 312, and 119 tabs had none of
the three.

## What was built

One toolbar sits at the top of every screen, for every office role, on every tab: **Muat naik / Upload**,
**Isi data / Key in**, **Muat turun / Download**. Guards and site devices keep their short phone screens without it.
The toolbar adds no new authority and no new database table.

| Button | What it does | Who may use it | Built on |
|---|---|---|---|
| Upload | Keeps files of any kind (PDF, photos, scans, Word, Excel, CSV, email, zip, video, voice, drawings, Outlook messages, files with no extension; up to 200 MB each, 20 at a time; only programs and scripts are refused) in "Old files and data" for the person's own unit, in the folder this screen suggests (Finance screens to Finance, Licences to Licences, pay screens to Pay and contributions, and so on). PDF, photos and office files are read on the device to suggest title, date and reference and for searching; other kinds are kept as they are and handed back to save, never shown inside Prima. The person checks. | Anyone with a unit to file for. The archive's walls decide who can open each file; staff and pay folders stay restricted. | Data and file manager (PR #145), module `archive-v1`, private file storage |
| Key in | Opens the plain record forms this screen holds (for example + Site, + Post, + Patrol checkpoint on Sites) and lists the open tab's own Add / New / Record / Request buttons. Where a screen is read-only by design (audit trail, JA data, KPIs, reports, the salary calculator) it says why and where to key in instead. | Record forms show only to the people who keep that record; the server checks again on save. A tab's own buttons are the ones that person already has. | Record form engine (`packages/core/src/records.ts`, 26 kinds) and each screen's own forms |
| Download | Gives what the person sees on the open tab (every table, every list, the figure cards) as **Excel**, **CSV** or **PDF** (CSV because payroll and EPF systems often take CSV). Excel and PDF carry a stamp: title, who downloaded it, when, and the log reference `EXP-yyyymmdd-xxxxxx`. A CSV holds only the columns and rows so another system can read it; its log reference is in the file name. | Everyone who can see the tab, because the file holds only what the server already showed them. | `packages/core/src/screen-tools.ts` (Excel and PDF writers), audit trail |

### Downloads of sensitive data

- Every download is written to the audit trail (`export.download`) **before** the file is made. If the log fails,
  there is no file.
- Pay, medical, bank, firearms, speak-up and personal-details data need a reason of at least 10 letters. The reason
  goes on the log line, and the file is stamped "SULIT / CONFIDENTIAL ... Need to know only. Do not forward."
- Which data counts as sensitive is decided by the screen (Staff payroll, Guard pay, Claims, SOCSO, Finance, Arms,
  People, Staff directory and others) and by the tab's name (any tab about pay, salary, EPF, SOCSO, PCB, advances,
  loans, medical, MC, bank, firearms, vaults or speak-up), whatever screen it is on.
- Speak-up lists are downloaded only by the people who handle speak-up reports (the head of ACT and HR's speak-up
  holders). Everyone else sees why and gets no file.
- Excel never gets a formula from screen text, and IC, phone and account numbers stay as text. In a CSV a cell starting with = + - @ gets a leading apostrophe so a spreadsheet never runs it.
- A download is what the screen shows. A statutory submission file (EPF, SOCSO, PCB) with the agency's exact layout comes from that pay screen's own export, not from this button.

## Rules for new screens

- A new screen must have an entry in `SCREEN_TOOLS` (`packages/core/src/screen-tools.ts`); a test fails otherwise.
- Mark a part of a screen that must not be downloaded with `data-no-export`.
- Record kinds: add the kind to its screen's `records` list; a test checks every kind is placed somewhere.

## Gates

- Upload works only once module `archive-v1` is installed and the private file storage is switched on (both
  already on the after-merge list from PR #145). Until then the Upload panel says so.
- Key in and Download need no module and no setting.

## Checks

- `packages/core/test/screen-tools.test.ts`: every menu screen covered, record kinds placed, sensitivity, reasons,
  speak-up refusal, log lines, Excel and PDF contents.
- `scripts/screen-tools-browser-uat.cjs` (demo build, made-up data, 1280 px and 390 px).
- `scripts/screen-tools-audit.cjs <out.json> --after` crawls every screen and tab again and fails if any tab is
  without the toolbar.
