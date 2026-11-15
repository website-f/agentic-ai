# KDN licence renewal 2027 (Part W)

Source: Fitri package Part W (14 Nov 2026) and Fauzan's answers W-X1..W-X13. Rule `KDN-RENEW-2027` (Policy).
Prima records only. It never logs in to eSIMS, never lodges and never pays. Director IC numbers are never shown on
screens or exports; they stay on the signed papers inside that company's own pack. One company's papers are never
mixed with another's.

## Where

Renewals > "Pembaharuan Lesen KDN 2027" panel (`apps/web/src/views/KdnRenewal.tsx`). The general renewal list
leaves out KDN licences. Service `packages/core/src/kdn-renewal.ts`, one door `svc.kdnAct(user, op, input)`, API
`POST /renewals/kdn/:op`.

## Steps

| Item | What is built |
| --- | --- |
| W1 | Opening copies the yearly template (15 Lampiran C lines) onto the renewal. Central Admin (DCoS) changes the template or window for a year with a reason; open renewals keep their copy. |
| W2 | Each paper needs its file (PDF, or a scan of the signed hardcopy) and passes its check: 1.2/1.3 dated 1 Sep 2026 or later; 3.1/3.2 cover Jan-Jul 2026; 3.3 year 2026 with both CP204 and SST proof; 3.4 year 2026; 3.5 year 2025; 3.6 PI, PL and GPA in force on the appointment date; 3.7 the full month before the appointment; 4.1/4.2 after the counts are confirmed. 2.1 may be "not applicable" with a reason. A refused paper keeps no file. |
| W3 | Hints beside each paper from Finance regular payments (EPF, SOCSO, HRD months), the audited-to date, bank accounts, insurance and vaults. Hints only, never the paper. |
| W4 | New insurance kind Professional Indemnity (claims list, record form, required cover). |
| W5 | eSIMS update and 2(b) investigators marks; appointment inside a session, on a weekday, with the eSIMS reference and attendee; a change needs a reason; session 7 only after papers lacking. Result of the day: accepted (needs the director signature and the Finance fee reference), lacking (named papers reopen, signature, check and appointment clear), or left at the counter (flagged late). |
| W6 | Window and sessions as a setting (rule default for 2027), countdown on each row. |
| W7 | Company manager checks; a director of the same company signs (a director sign-in, or a company sign-in named on the board register), never the preparer or checker, after ticking the declaration. Signing is refused until the papers, eSIMS, 2(b), counts, check, Nepali eSIMS and SST are all done. |
| W8 | The 1.4 pledge is filed for ACT's anti-bribery programme (MACC s.17A) with year and signer. |
| W9 | CSG and TNG not-trained counts for active local guards (Nepali not counted; no credential at all = unknown); the company head confirms with a reason and the numbers are frozen. |
| W10 | FWM marks each Nepali guard entered in eSIMS; the director cannot sign until all are. |
| W11 | 2(b) on by default for every company; Central Admin turns it off for a company with a reason. |
| W12 | Finance ticks no SST arrears with the MySST reference. |
| W13 | Pendrive pack: ZIP of that company's soft copies named `<label>_<item>_<short>.pdf` plus `00_Senarai_semak.txt` (ticks, hardcopy list, appointment, the no-gift line). Company staff and Central Admin only; logged. |
| W14 | Group board: stage, papers x of 15, appointment, missing papers, SST, counts, Nepali, countdown. Late ladder: not opened by 18 Nov -> DCoS, no appointment by 23 Nov -> CoS, not accepted by 11 Dec -> CEO, on home. |

## Database

New module `db/modules/kdn-renewal-v1.sql` (table `prima.kdn_recs`: template, window, sst, esims, pledge). Not in
the release manifest: the CEO installs it with `infra/run-db-migration.sh`. Before it is installed the template and
window use the rule default, and the SST, Nepali eSIMS and setting steps are refused with a clear message.

## Tests

Core `packages/core/test/kdn-renewal.test.ts`; PostgreSQL `apps/api/test/kdn-renewal-pg.test.ts`.
