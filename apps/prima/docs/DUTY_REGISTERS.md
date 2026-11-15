# Duty map gaps (Part Z, 14 Nov 2026)

Fauzan, 14 Nov 2026: "Add any that still missing in prima app." Each item in
`2026-11-14_duty-map-gaps-part-Z.txt` was checked against the branch first; what Prima already had was not built again.

Screen: Meetings > Mesyuarat bulanan JA Group > "Senarai tugas" (Z1, Z2) and "Daftar tugas" (Z4-Z13).
Doors: `/group-month/:op` (Z1, Z2) and `/registers/:op` (Z4-Z13). Every rule is checked on the server.

## Z1 duty checklist layout
Each line now shows its number, frequency, window, target date, actual done date, status (belum dibuka, terbuka,
lewat, menunggu semakan, dikembalikan, disemak), SOP reference, checker and who checked it. A line may name a checker
(the company manager or a director, or a unit member); the checker may accept or return that duty task, never the
person in charge. Without a named checker the line manager reviews as before.

## Z2 group monthly calendar
Seeded from the files in rule GROUP-DUTIES `calendar` (pay approval 2-3hb, pay 7hb, EPF/SOCSO/SIP 8-15hb, rent 1-7hb,
CP204/PCB/PSMB 13-15hb, advance 16-17hb / 20hb, HQ pay 20hb and 28hb, reports 28hb, SST every 2 months 25-31hb,
bills 2hb and 22hb, claims 11hb and 23hb, HP 30hb, toolbox twice a month, balances every Thursday). Unit HR or the
Director Office changes it in the app with a reason (`setCalendar`); the change is kept in the `gm-settings` record.

## Z3 licences
New licence kinds with reminder lead days: PIKM membership (60), MOF digital certificate (60), Bumiputera status (90),
bond (60), Carry & Use (90), CNU (90), AMRA (90), LHDN TCC (30), CIDB (90). KDN, MOF, PBT, insurance, Licence A, vault
approval, ISO, SSM and vendor certificates were already tracked.

## Z4-Z13 registers (one register engine)
Each register has a keeper, a checker and fields. The preparer never checks their own record; a check or return needs
a comment; a checked record is not changed (add a new one). Staff number only, never a name; IC numbers and bank
account numbers are refused. Periodic registers show "belum direkod" once their window opens.

| Item | Registers | Keeper | Checker |
|---|---|---|---|
| Z4 | Factoring (1-10hb) | Company office | Company manager |
| Z5 | School contribution, contract notice (board lists contracts ending in 90 days with no notice) | Company office | Company manager |
| Z6 | HRDF claim, PTPTN (confidential), Protégé, SME Corp | Company office | Company manager |
| Z7 | Welfare fund, kuliah dhuha, annual events | Unit HR | Welfare approver set by the CoS/DCoS; none; line manager |
| Z8 | Absconder list (confidential), KLIA intake, translation, agents, Merchantrade status (no account numbers), site audit | FWM | Line manager (Merchantrade: none) |
| Z9 | NCR, "no delete" test, hostel round, weekly ageing review | Internal Audit | Line manager |
| Z10 | Key/access card log, monthly repair budget; rental month report (homes, vacant, leaving, repairs paid against budget) | Asset Management | Asset Director |
| Z11 | New company set-up steps (board shows progress) | Company office | Company manager |
| Z12 | Manager payback | Company office | Finance leader |
| Z13 | Principal/PPD meeting, branch meeting, welfare visit, grass/rubbish schedule | Operations manager | Line manager |

Already in Prima (not built again): panel clinic, probation, PGM claims (toolbox register), yearly medical 56+, stock
counts, finance ageing, site visits with GPS (Z13 weekly round), Airbnb check-out inspection, preventive maintenance,
tenant application and move-in, complaints with photos, quotations, rent notices, zakat tenancies, quit rent and land tax.

## Not done by Prima
Records only: no factoring provider, HRDF, PTPTN, SME Corp, Merchantrade, SharePoint or Teams connection. Prima moves
no money. Real records are entered by staff after the real-data go-ahead.

## Database
New module `db/modules/duty-registers-v1.sql` (table `prima.duty_register_recs`): row-level security walls, confidential
PTPTN and absconder rows, settings row only by the CoS/DCoS and only as `reg-settings`, append-only history, fixed
identity, no delete. `group-monthly-v1.sql` gained a check that only `gm-settings` is a settings row. Neither is on
the release list; the CEO installs them.
