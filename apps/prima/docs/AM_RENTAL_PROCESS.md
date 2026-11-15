# Rumah sewa / Rental homes (Part V, 14 Nov 2026)

Asset Management lets residential units of the owner companies. Prima is the record from letting to move-out (V32: no Excel). Rule values: AM-RENTAL in `packages/core/src/rules.ts` (Policy, Fauzan's answers V-X11..V-X37, 14 Nov 2026). Code: `packages/core/src/am-rental.ts`, screen Aset > Rumah sewa (`apps/web/src/views/Rental.tsx`), one door `POST /am-rental/:op`. Database module `db/modules/am-rental-v1.sql` is NOT on the release list; the CEO installs it.

Pengurusan Aset menyewakan unit kediaman syarikat pemilik. Prima ialah rekod dari iklan hingga penyewa keluar.

## Who does what / Siapa buat apa

| Step | Who |
|---|---|
| Rent, deposit, terms, platforms, agent | the rental admin executive proposes, the Asset Director approves (never the proposer) |
| New tenant | Asset Director, then Chairman or Vice Chairman consent |
| Agreement changes | Asset Director with a reason; rent, deposit or term changes go back through tenant approval |
| Owner signatory | a director of the owner company, or the Asset Director with written authority; witness is another Asset Management staff member |
| Money from the bank, deposit, refund, stamp duty to LHDN | Finance only, never from a slip alone |
| Repairs | officer proposes, Asset Director approves; Vice Chairman consent above RM5,000; CEO above RM50,000 |

## Flow / Aliran

1. **Letting (V35-V41):** unit readiness, four statuses, advert per platform within 2 office hours, enquiry list with first reply within 2 office hours, screening, viewing. Agent after 30 days without a tenant, or earlier when every screened prospect is unsuitable.
2. **Application (V42-V50):** form AST/BOR/PS/001, conditions signed before the form, documents, checks, income test on applicant + spouse income using the papers' bands (gaps use the lower band; outside RM800-2,500 the Asset Director sets a minimum; Prima warns, never refuses). Company tenants use a company form. Deposit Payment Request AST/ASET/DPR/001: 2 months' deposit + 1 month's rent to the owner company's account. All three utility accounts changed within 72 hours. Keys only through the handover gate; the tenancy record is created at keys.
3. **Agreement and stamping (V51-V57, V74-V77):** opens only after Finance confirms the deposit in full. Draft from the standard template, changes, final, signing with witnesses. e-Duti Setem submission is recorded by the team the same day (Prima does not log in); the tenant gets the duty notice and 24 hours to pay; Finance confirms the money then pays LHDN; the certificate is uploaded. A home is "stamped" only from that checked certificate (the plain records form refuses it).
4. **Monthly rent (V58-V63):** Finance raises the invoice in SQL Account (20th-24th) and records the number and date; sent within 24 hours; window to the 10th; transfer, FPX, CDM with slip or cleared cheque, no cash. Finance confirms from the bank or marks "Dalam Semakan". Unmatched bank lines are shown to the rental team as date, amount and reference only. Official receipt within 1 working day. A zakat body may pay full or part; any shortfall by the 10th moves to the tenant and counts in arrears; two receipts for a zakat tenant.
5. **Arrears (V64-V68):** 3 months confirmed the same day, tenant told, 3 working days, notice to vacate on day 4 (approved, delivered), check on day 14. The Asset Director then decides: lawyer's letter and court action (default), a written payment plan, or a lock-out only after the company's lawyer confirms in writing for that tenancy.
6. **Move-out (V69-V73):** notice and account check, key handover with the signed form, inspection and utilities (2 pm rule), deposit statement within 24 hours (checked and approved), Finance refund in 2-3 working days. A final bill not yet out holds only an estimate. A zakat-paid deposit goes back to the zakat body unless its written release is on file. Old deposits held are listed (V31).
7. **Repairs (V78-V89):** one flow with a report number and damage levels; inspection with the 8 questions; contractor check when the cause is unclear (owner pays first, added to the tenant's charge if at fault); three outcomes; 3 quotes (panel rate-list jobs up to RM5,000 need none); emergency route for critical damage; written decision; objection within 7 days, one review replied in 3 working days, no invoice while open; tenant charges invoiced separately, 14 days, never counted in rent arrears; water refund only when an owner leak is repaired more than 3 months after it was found.

## Never / Tidak sekali-kali

Prima never moves money, applies to a bank, numbers an invoice, logs in to e-Duti Setem or LHDN, or writes SQL Account tables. Full bank account numbers are masked in lists and shown only on the DPR and notice papers. IC numbers are never shown. No WhatsApp sending, Airbnb login or platform calendar link. Staff may not change locks, remove the tenant's things or cut utilities without the lawful step above.

## Records and walls

One table `prima.am_rental_recs` behind the Asset Management walls (`asset_read`, `asset_write`). History is append-only, identity fields cannot change, and nothing is deleted (trigger `prima.am_rental_guard`). The 29 rental papers are listed on the process sheet with Asset Management as owner; the documents themselves go into the policy library through the app.

## Open

- e-wallet for rental rent is not asked yet; today it is not offered (cash stays off for homes).
- The papers' templates are loaded by the Asset Director in Rumah sewa > Tetapan; Prima never fills a blank with a made-up value.
