# Merdeka Network IT policies in Prima (Part Q, 13-14 Nov 2026)

Source: the IT department's written policies (IT-POL-001 intellectual property, the procurement and inventory policy,
the Microsoft 365 domain and account policy, IT-POL-004 support tickets, IT-POL-005 disposal and asset life) and the
five circulars MN/CIR/IT/001-005/2026, with Fauzan's answers Q-X1 to Q-X9 (13 Nov 2026 23:04Z and 23:10Z, 14 Nov 2026).
Effective 18 November 2026. Synthetic test data only. Every rule is enforced in the backend; the database walls are in
`db/modules/it-policies-v1.sql` (not yet in `db/release-manifest.json`; the CEO installs it with
`infra/run-db-migration.sh`). Until it is installed the new records cannot be saved, and the checks that depend on them
(register details before handover, the Microsoft 365 joiner step) start when it is.

Rule values are in `packages/core/src/rules.ts`: IT-WATCH (response targets, office hours, confirmation reminders,
purchase stage days, retention, refurbish / end of life / maintenance months, disposal HQ), IT-BUY (3 supplier quotes +
1 online price, unchanged by Q-X3) and IT-JOBS (no auto-confirm).

| Policy step | Screen | Rule or check |
|---|---|---|
| Q1 ticket response targets P1 15 min, P2 1 h, P3 4 h, P4 1 working day | IT > Help requests (Respons: dalam masa / lewat; Selesai for information) | IT-WATCH responseMinutes, p4ResponseWorkingDays, officeHours; public holidays from the HR holiday list |
| Q2 categories incl. Software, Security, Procurement; Security starts at P1/P2 | Help requests, My requests form | `securityPriority`; the IT Lead may lower with a reason |
| Q3 same problem within 24 h | My requests form ("Ini masalah yang sama?") | a prompt, never a block |
| Q4 root cause for P1 and Security | Help requests, resolve | refused without it |
| Q-X2 only the person closes | My requests; IT Manager "menunggu pengesahan" | reminders day 3 and 5 (IT-WATCH confirmReminderDays); IT records a confirmation given outside Prima only with proof |
| Q5 monthly service report | Help requests (IT Manager, COO, CEO), CSV | numbers only, no staff ranking |
| Q6 equipment request from any department | IT > Polisi IT > "Mohon peralatan IT"; a Procurement ticket can become one | IT turns it into an IT purchase or declines with a reason |
| Q7 technical assessment | Polisi IT > purchase > Technical assessment | IT Lead or IT Executive; spare stock shown, a reason to buy anyway |
| Q8 quotes and comparison | Polisi IT > Record quotes, Recommend | IT-BUY 3 + 1; expired quotes flagged; route (b) when the chosen supplier needs payment first |
| Q9 Finance budget check | Polisi IT > Budget check | a record by Finance, not an approver; missing check flagged |
| Q-X4b pay before delivery | purchase chip "bayaran dahulu" | approved with the purchase; flagged when undelivered after the quoted lead time. Posting the payment before receipt needs a reviewed change to the payment guard in `it-procurement-v1.sql` (ledger) |
| Q10 receiving and GRN | Polisi IT > Receive and inspect | a "no" answer is a mismatch; failed units stay in quarantine until released with a reason |
| Q11 register details before handover | Polisi IT > Butiran daftar aset; Assets > assign | refused without the item-register label, serial, purchase details (or "maklumat pembelian tiada") , custodian and location |
| Q12 lost or stolen device | My items > Peranti IT saya | P2 ticket; police report fields optional, no deadline, no flag (Q-X answer) ; IT updates the register |
| Q13 stage time frames | purchase chips (working days, "lewat") | IT-WATCH purchaseStageDays; IT Manager may change with a reason |
| Q14 documents kept | purchase "documents still missing", keep until | IT-WATCH retentionYears 5 |
| Q15 IT equipment claim | Claims, kind IT equipment | "Tiada PO IT yang diluluskan" stops approval |
| Q16 disposal | Polisi IT > Mohon pelupusan, inspection, approvals, done | repairable stays active; IT Manager, head of the company or department using it, then HQ (the COO, setting `disposalHq`); three different people; certificate, photos and a checked wipe before done; Finance records the write-off |
| Q17 data wipe log | Polisi IT > Log pemadaman data | a different IT person checks (the IT Manager when the Lead did it); reissue to another person refused without a checked wipe; PDPA officer reads only |
| Q18 refurbish and end of life | Polisi IT > Senarai semak baik pulih, Penilaian akhir hayat, Kerja berkala aset | refurbish 36 months, end of life 48 (phones and tablets 36), maintenance 6 |
| Q19 rental agreement per company | Polisi IT > Perjanjian sewaan, print view, signed copy link | values from the agreement draft answers (14 Nov 2026); the lawyer's check is not a Prima step; accessories checked on return |
| Q20 Microsoft 365 account register | Polisi IT > Akaun M365; Joining and leaving | every account has an owner; guest needs expiry; joiner step needs MFA "yes"; quarterly review shows problems first |
| Q21 account request | Polisi IT > Mohon akaun Microsoft 365 | line manager supports, IT verifies, CoS or DCoS approves; a joiner reviewed in the HR-IT intake is not asked twice; admin access stays with the CEO |
| Q22 new domain and domain security | Polisi IT > Mohon domain baharu, Keselamatan domain | CEO approves; registrar from the approved list; registrant that looks like a person is flagged; active only with the Microsoft 365 verification proof; lock or 2FA unknown shows amber |
| Q23 IP register | Polisi IT > Daftar harta intelek | where access is kept, never the password; decommission needs the CEO; trademark and copyright filings stay with the Company Secretary / Legal |
| Q24 policies and circulars | Polisi IT and the IT Guide card list the ten documents read-only | HR loads the BM copy and the checked English copy into the policy library for office staff to acknowledge (ledger) |

Who reads what (database walls): IT, ACT, the COO and the CEO read all; Finance and other IT-asset readers read purchase,
asset and agreement records; the PDPA officer reads the wipe log only; a person reads their own requests and the named
line manager reads the request they support; a company manager reads their own company's IP rows, agreements and
disposals; the CoS and DCoS read account requests and disposals. History is append-only and nothing is deleted.

Owner decision (Fauzan, 14 Nov 2026: "3., yes"): for a central device (not rented to a company) the "head" approval on a disposal is the CoS (or the DCoS).

## Part V changes (14 Nov 2026)

| Item | Where | Rule |
|---|---|---|
| V8 new website or big change | Polisi IT > Projek laman web | the company head asks (content owner and a different content approver, logo, profile, photos); IT checks within 1 working day and gives scope, cost and build days; the CEO approves (never their own request); the content owner confirms content, IT records the build, preview and internal test, the content owner does UAT, the content approver approves publishing with HTTPS on and the live address |
| V9 account and digital-record targets | Polisi IT boards, Do today | an approved account request with no account on the register, and a new active domain with no IP register row, show late after the target working days (a flag, never a block) |
| V11 purchase and disposal targets | Polisi IT boards, Do today | V-X6: stock item request to handover 5 working days (supplier lead time beyond 2 days not counted); delivery late only after the chosen quote's lead time; disposal inspect 3, approvals 2, wipe + certificate 2, whole 7 working days |
| V12 intercompany | no change | no extra approval step through intercompany (V-X7) |
| V13 process sheet | Proses (process page) | one read-only sheet per Prima workflow: steps, who, time target, papers; built from the code's own step lists |
