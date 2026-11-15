# Foreign worker moves and hostel needs / Pindah pekerja asing dan keperluan asrama

Fitri package Part P1-P18 (Fauzan, 13-14 Nov 2026). Rules FWM-MOVE and FWM-HOSTEL-NEED in `packages/core/src/rules.ts`.
Database module `db/modules/fw-moves-v1.sql` is NOT on the release list; the CEO installs it. Until then the screens show
the hostels and stays that already exist, and the new actions say the module is not installed.

## English

**Who lives where (P1).** FWM or the OM records a stay (hostel, room, from). Placing a worker in a new hostel ends the
old stay the day before. Over capacity is allowed but shown red. Malaysians are not placed through this screen.

**Hostel details (P2).** FWM records the hostel certificate (number, expiry), the supervisor (history kept) and whether
the Nepal manager uses it. The OM sees only hostels where workers of their own sites live, with no bills.

**Moves (P3-P6).** Types: HOSTEL, SITE, BOTH, ARRIVAL. Raise at least 3 working days ahead; urgent needs a reason.
Warnings show (certificate, capacity, papers to file); a move to another company's site shows "employer stays".
Five steps: origin PIC, new PIC, FWM, the new company head, then the Operations Director (private) or OGM (government).
Nobody signs two steps. Only FWM returns a move. Release (a stock gap needs a photo and opens a damage report),
transit, receive (creates the stay and sets the work site), then FWM closes with the JA reference. A received move not
closed after 24 hours reminds FWM and climbs after the set hours. JA differences are listed for FWM to fix in JA.

**Stock, counts and checks (P14).** FWM opens a count, the OM counts, someone else verifies (never the counter), the
company head acknowledges. Weekly, monthly, audit and 90-day sweep checks need 2 photos; monthly adds a short report.
A missed check shows on the OM's Do today.

**Damage and loss (P15).** A photo is required. FWM decides. A penalty from the price list on the report date applies
only with a negligence finding and a named worker. The worker pays first; a salary deduction is an HR decision with the
Employment Act s.24 flags shown. Replace creates one hostel need.

**Repairs (P16).** Before photos. Company-paid repairs need at least 2 quotes; under 3 quotes needs the Asset
Director's reason. Critical repairs skip the wait and record when the landlord was told. FWM checks, OD/OGM approves,
Asset Management orders (a work order linked to the hostel), the OM marks done with after photos, then close. A hostel
work order cannot close before the repair is done.

**Needs (P8).** The OM raises a need; the screen shows the residents and the items already there. FWM verifies, the
OD/OGM approves or rejects with a reason (never the raiser). Asset Management sees only approved needs, with the hostel
name and address and no worker data, and buys once against the need (the purchase follows the usual COO approval
limits). The OM confirms receipt with a photo and the hostel list updates.

**Walls.** The employer's and the new site's company, FWM (not despatch), COO/CEO, group leaders and ACT (read).
Asset Management: approved needs and repairs only. Nothing is deleted.

## Bahasa Melayu

**Siapa tinggal di mana (P1).** FWM atau OM merekod penginapan. Memindah pekerja ke asrama baru menamatkan penginapan
lama sehari sebelumnya. Melebihi kapasiti dibenarkan tetapi ditunjukkan merah.

**Butiran asrama (P2).** FWM merekod sijil asrama, penyelia (sejarah disimpan) dan sama ada pengurus Nepal
menggunakannya. OM hanya melihat asrama pekerja tapaknya sendiri, tanpa bil.

**Pindah (P3-P6).** Dimohon sekurang-kurangnya 3 hari bekerja lebih awal; segera perlu sebab. Lima langkah: PIC asal,
PIC baru, FWM, ketua syarikat baru, kemudian Pengarah Operasi (swasta) atau OGM (kerajaan). Tiada siapa menandatangani
dua langkah. Hanya FWM boleh memulangkan. Lepas, dalam perjalanan, terima (penginapan dicipta), kemudian FWM menutup
dengan rujukan JA.

**Stok dan semakan (P14).** OM mengira, orang lain mengesahkan, ketua syarikat mengakui. Semakan mingguan, bulanan,
audit dan 90 hari perlu 2 gambar.

**Kerosakan dan kehilangan (P15).** Gambar wajib. Denda mengikut senarai harga hanya jika ada dapatan kecuaian dan
pekerja dinamakan. Potongan gaji ialah keputusan HR (Akta Kerja s.24).

**Pembaikan (P16).** Gambar sebelum. Sekurang-kurangnya 2 sebut harga; kurang dari 3 perlu sebab Pengarah Aset. OM
menandakan siap dengan gambar selepas.

**Keperluan (P8).** OM memohon; FWM mengesahkan; Pengarah Operasi atau OGM meluluskan dengan sebab. Pengurusan Aset
hanya melihat keperluan yang diluluskan, tanpa data pekerja, dan membeli sekali. OM mengesahkan penerimaan dengan gambar.

## Checks (14 Nov 2026)

- Core (mock store): `packages/core/test/fw-moves.test.ts` 8/8 pass.
- PostgreSQL: `apps/api/test/fw-moves-pg.test.ts` 1/1 pass (OM of another area and despatch see nothing; Asset
  Management sees the need only after approval, without residents, and cannot write it back).
- Not done: interactive browser check, staff UAT (deferred), migration (CEO).
