# Arms Control and CMS gaps (23 Nov 2026)

Asked for: Fauzan, 23 Nov 2026 ("Do the gap", on the department check study note
https://claude.ai/artifact/6LEp25nwPTj6vQewngymus), built as recommended. Mock data only. Database module listed below.

| Item | What changed | Where |
| --- | --- | --- |
| B1 | The Amra of a vault (usually an admin executive) and anyone on its written authorised list issue, return and count at that vault only. They see Arms with only their vaults; they raise no requests and see no jobs. | `keepsVault`, `holdsArmsKeeperWall` (special-ops.ts); `issueFirearm`, `returnFirearm`, `countVault`, `arms`, `keptVaultCompanyIds` (service.ts); `db/modules/arms-keeper-v1.sql` |
| B2 | The written authorised list is matched by staff record, not the typed name; the Amra is always authorised at their own vault; adding or removing a line goes by staff record (two people with one name stay two lines). | `armsIssueCheck` (checks.ts); `vaultAuth`, `vaultAuthRemove` |
| B3 | Replacement for the rest of a CMS shift: after the person on a seat clocks out early, Arms Control puts someone on a new seat from now to the end, with a reason and the usual law and rest checks. The first person keeps their hours. | `replaceCmsSeat`; Roster tab "Replace for the rest" |
| B4 | Upload a CMS roster (Excel saved as CSV: date, start, post HC/MO, seat, staff). Each line goes through the roster checks; refused lines come back with the reason. | `uploadCmsRoster`; Roster tab "Upload roster" |
| B5 | Firearm key-in already refuses a duplicate serial or RFID tag (V16); the Upload button files papers to the archive, it does not load firearms. The buy reconcile now checks serial and tag again when it creates the firearms. | `firearmIdentity`; reconcile in `armsRequestStep` |
| D1 | The Arms Control Manager (head of Arms Control in the org chart) decides: passing or returning requests, arms policy and CMS settings, the RFID switch, lowering a damage category, reuse after repair (the Assistant only when the Manager reported or repaired it), jacket specification, trade store approval, clocking CMS staff out. The Assistant prepares. With no head named, every Arms Control officer keeps these. | `decidesForArmsControl` |
| D2 | The RFID scan is compulsory at a vault, for issue and return, once every firearm on its register is tagged (rule ARMS-RFID-VAULT). | `armsRfidRequired(vaultId)` |
| D3 | From 1 January 2027 an armed duty needs the licence category recorded (rule ARMS-LICENCE-CATEGORY); before that a missing category only warns. | `issueFindings` |

## Database module

- `db/modules/arms-keeper-v1.sql` (new, not on the release list): run after `special-ops-v1.sql`, and again whenever
  `special-ops-v1.sql` is run again (it replaces that module's `arms_wall` policy on vaults, firearms, arms_movements
  and ammo_stocks). Repeat-safe. Everyone who held the arms wall keeps exactly what they had.
- `arms-policies-v1.sql` (Part R, already on main) is still off the release list; run it too.

## Tests (local, 23-24 Nov 2026)

- Core (Vitest, mock data): 2,796 of 2,796, including `packages/core/test/arms-cms-gaps.test.ts` (10).
- API on local PostgreSQL 16: `apps/api/test/arms-keeper-pg.test.ts` passes (the Amra sees only their vault, a removed
  authorisation closes it, other executives and companies see nothing); the Special Ops and RLS suites pass. 12 tests in
  arrival-cash, exceptional-guard-cash, payroll-repair and staff-pay-statutory fail the same way on main without this change.
- CMS app 92 of 92. Web type check passes.

## Review on 23 November 2026 (after merge)

- **Name the Amra by staff record.** Until now a vault's Amra was a typed name only, so the keeper access (B1) had no way to be switched on in the app. "Lantik Amra / Pelesen A" on the arms policy panel lets the company manager name the Amra or the A licence holder from the staff record, with a reason. Nobody names themselves, the person must be active staff of that company, and a blank person clears the post. The licence itself stays a readiness check, so someone can be named while their AMRA licence is being applied for.
- **Vault keepers table.** The panel lists each vault with its Amra, A licence holder and written authorised list. An Amra typed by name only shows "(name only, not linked)".
- **Vaults picked by name.** The vault forms (access, log, inspection, change, extinguisher, trade store) offer a list of vault names instead of asking for a vault id.
- **Phone width.** On the Arms screen the vault cards' Count now button spilled past the screen edge at 390 px. Card buttons now wrap below the text on phones.

No new database module.
