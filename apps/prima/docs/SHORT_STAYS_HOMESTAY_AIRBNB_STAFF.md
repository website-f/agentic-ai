# Short stays: homestay, Airbnb and staff stays / Penginapan singkat

Fitri package Part P19-P39 (Fauzan, 14 Nov 2026, answers 30-35, 37-51 and SOP-1..4). Rule AM-SHORT-STAY. Papers:
PRWM-UPA/POL, PKL, SOP 2026/015 (staff houses), 2026/017 (homestay), 2026/018 (Airbnb), and the three draft SOPs
(A cleaning, B complaints, C inventory) in `2026-11-14_short-stay-sops-cleaning-complaints-inventory-DRAFT.txt`.
Code: `packages/core/src/short-stays.ts`. Screens: Asset Management → Short stays; Claims and requests → Staff house stay.
Database module `db/modules/short-stays-v1.sql` is NOT on the release list; the CEO installs it (it also needs
am-extras-v1). Bookings stay in `prima.am_bookings`: one booking engine, one calendar per house.

## English

**Houses (P19, P26).** A homestay house is an Asset Management property of kind HOMESTAY. The Asset Director sets beds,
most guests, keys and key method, price per night, deposit %, optional damage deposit (off by default), platforms,
the Airbnb listing and cancellation setting (moderate by default), house rules and any licence. One use at a time: a
switch to a rental tenancy is blocked while a short stay is open.

**One calendar (P28, P32, P34).** Direct, Airbnb, other-platform and staff stays all lock the same house; overlapping
nights are refused whatever the channel. Each held booking needs a "blocked on" tick for every platform the house is
listed on; an unticked platform shows red. No automatic calendar link is configured.

**Staff stays (P19-P25).** Government Operations or an HQ department asks (house or town, dates, occupants from the
staff list, key receiver, purpose). The price is shown before sending: RM300 a person a night (a dated setting). The
Asset team checks; nobody confirms their own request. Work stays are billed to the department; a private stay pays by
transfer and is confirmed once Finance sees the money. Damage: the department pays on the bill; the Asset Director
records it with a photo and a finding; the named staff member acknowledges it in Prima with the written consent
wording (Employment Act s.24); only then is it deducted once from the next staff pay. The FWM hostel rule (worker pays
first, HR decides a deduction) is unchanged.

**Direct homestay (P27-P33).** The team keys the form while talking to the customer (written PDPA consent ticked).
Prima shows the price, deposit and terms and prepares a BM / English message to copy into WhatsApp. Held for the
deposit for 3 working days. The team records payments with proof; Finance confirms each in the bank and issues the
official receipt number. The customer confirms the terms; follow-up 7 days before; preparation 2-3 days before; full
payment 3 days before check-in. Keys only when all six conditions hold (confirmed, deposit and full payment confirmed
by Finance, terms met, house inspected, the person is the customer on record); the Asset Director may release keys
with a reason when the guest shows a transfer proof. Check-out: keys counted back or a lost key recorded,
after-stay inspection with photos, house dirty for cleaning, late nights charged unless waived with a reason.

**Airbnb (P34-P39).** The Airbnb reservation is the form: confirmation code (unique), guest name, guests, dates, what
the guest paid and the Airbnb fee, plus a copy. A request must be answered within 20 hours. No deposit or receipt
steps: the guest pays Airbnb only. Keys or code only when accepted, inspected, within capacity and the person matches;
a new access code for each stay, shown to the team only and changed after check-out. Finance records each payout with
its booking lines and the earnings report, explains any difference above RM1, and confirms it in the bank; a booking
closes only after its payout is matched. Damage is claimed through Airbnb only, with a reminder 4 days before the
14-day deadline. A host cancellation needs the Asset Director's reason; a goodwill refund up to one night or RM300 is
the Asset Director's, above that the COO's.

**Complaints, cleaning, counts (SOP A-C).** Complaint numbers SC-YYYY-NNNN run in order; urgent 30 minutes, normal 24
hours, reviews of 3 stars or less logged as complaints; closed by the Asset Director or a named deputy, never by the
person named. A requesting department raises a complaint on its own stay and the team logs it. Cleaning records need
every area ticked and photos; whoever recorded the clean does not inspect. A turnover clean waits for the after-stay
inspection. Own cleaning team and 3 vendor quotes are compared side by side; the Asset Director picks with a reason.
Full inventory count every 3 months by two people; differences above RM500 go to Finance and ACT.

**Who sees what.** Asset Management team and Finance see customer details; group leaders see masked lists and tiles;
the access code is shown to the team only. Applicants and occupants see only their own requests.

## Bahasa Melayu

**Rumah.** Rumah homestay ialah harta Pengurusan Aset jenis HOMESTAY. Pengarah Aset menetapkan katil, kunci, harga
semalam, deposit, platform, penyenaraian Airbnb dan peraturan rumah. Satu kegunaan pada satu masa.

**Satu kalendar.** Tempahan terus, Airbnb, platform lain dan penginapan staf berkongsi kalendar yang sama; malam yang
bertindih ditolak.

**Rumah pekerja.** Operasi Kerajaan atau jabatan HQ memohon. Harga ditunjukkan sebelum dihantar: RM300 seorang semalam.
Pasukan Aset menyemak; pemohon tidak boleh mengesahkan permohonan sendiri. Urusan kerja dibil kepada jabatan.
Kerosakan: staf yang dinamakan mengakui dalam Prima dengan persetujuan bertulis; barulah dipotong sekali daripada gaji.

**Homestay.** Borang diisi oleh pasukan; persetujuan PDPA bertulis ditanda. Deposit dalam 3 hari bekerja. Kewangan
sahaja mengesahkan wang dan mengeluarkan resit rasmi. Kunci hanya diserah apabila keenam-enam syarat dipenuhi.

**Airbnb.** Tempahan Airbnb ialah borangnya. Jawab permintaan dalam 20 jam. Tetamu membayar Airbnb sahaja. Kod akses
baru setiap penginapan, dilihat oleh pasukan sahaja. Kewangan memadankan bayaran Airbnb. Tuntutan kerosakan melalui
Airbnb sahaja.

**Aduan, cucian, kiraan.** Nombor aduan mengikut turutan; ditutup oleh Pengarah Aset atau timbalan, bukan oleh orang
yang diadu. Kiraan penuh setiap 3 bulan oleh dua orang.

## Checks (14 Nov 2026)

- Core (mock store): `packages/core/test/short-stays.test.ts` 8/8 pass; related am-extras, asset, payroll and fw-moves
  tests 84/84 pass.
- PostgreSQL: `apps/api/test/short-stays-pg.test.ts` 1/1 pass (applicant and occupant walls, another department and a
  company manager see nothing, recovery insert only by the occupant, payroll reads recoveries).
- Not done: interactive browser check, staff UAT (deferred), migration (CEO), any Airbnb, WhatsApp or calendar link
  (stays off until separately verified).
