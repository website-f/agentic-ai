# P93: Foreign workers: where to add, old records, and the workers' own sign-in

Fitri, 9 Nov 2026: "In Prima, for Pekerja asing (foreign workers), where do I add the old records, where is the Add
button? And these foreign workers might get their own login just for guard kind of things like check-in and so on;
please look into this."

Branch `p93-fw`. Nothing here is merged, migrated or deployed. No new database module, table or column: the new data
lives in tables that already exist (`credentials`, and the jsonb of `people`/`guard_phones` is only read).

## 1. Why Fitri saw no Add button

P90 put "Add foreign worker" and "Import from file" on the Foreign workers screen, but only for FWM staff
(`fwmRoleOf(user) === 'staff'`, a user in the FWM department who is not the despatch). Fitri usually opens Prima as the
CEO record. The CEO is a group leader, so the screen treated her as "escalation": she saw the ladder and nothing to add,
with no word about why.

P78 had already made the owner (`isOwnerAdmin`: the CEO record, director or PWVSB officer, not a system feed) a maker
on every Prima screen, FWM included ("record a renewal, send a task, record a welfare check"). P90's add came after P78
and missed the owner. **Decision:** adding a foreign worker (by hand, from the JA app, or from a file) and importing old
paper dates now uses the same `fwmMaker` check as P78: FWM staff and the owner. Nobody else was widened. Recording a
paper from its copy (`recordFwPaper`) stays with the FWM team, as the real-use rule and its test say; the owner no longer
sees the "New paper received" and "Use the JA date" buttons the server would refuse.

### Who sees what now (Foreign workers app)

| Screen | Who opens it | Add at the top | Who adds (server) | People who may not add see |
| --- | --- | --- | --- | --- |
| Foreign workers (`fwm`) | FWM, despatch (tasks), group leaders, OMs (tasks), company managers | **Add**: "Foreign worker", "Paper dates from the old system"; **Import from file**: the same two | `addFwWorker`, `addFwWorkerFromJa`, `importFwPaper`: FWM staff or the owner | "Foreign workers are added by the FWM team. Ask them, or ask the owner to give you FWM access." where the buttons would be |
| Recruitment cost (`fwcost`) | Finance, FD, CEO, leaders, FWM (placements only), company managers | **Record a placement** (FWM) | `recordFwPlacement`: FWM staff only (unchanged) | "Placements are recorded by the FWM team. Charges are drafted by Finance and approved by the Finance Director or CEO." |
| Hostels (`hostels`) | Company office, FWM, HR, Ops Director/OGM, COO, leaders | Add hostel, Import from file (P91) | `hostel` record: company desk, FWM, the owner | "Hostels and their bills are added by the company office or FWM." The empty state no longer tells them to press a button they do not have |
| Nepali EPF/SOCSO (`fwstat`) | FWM (placed workers, no money), Finance, leaders, company office | none (debit notes are Finance steps, not records) | Finance steps (unchanged) | unchanged |
| Arrival cash (`arrivalcash`) | CEO, Finance, FWM manager | none (a request is a money workflow) | FWM manager requests, CEO decides (unchanged) | unchanged |

## 2. Old records

| Old record | Now | Why |
| --- | --- | --- |
| The worker (name, staff number, branch, dates, passport last 4) | Add or Import "Foreign worker" (P90), now also for the owner | |
| Paper dates of a worker added that way | On the same row (P90): "Typed in, copy not seen" | |
| **Paper dates of a worker already in Prima** (permit/PLKS, passport, FOMEMA, insurance, SPIKPA, KDN letter) | **New: Import "Paper dates from the old system"** (kind `fwPaper`, core `importFwPaper`) | See below |
| Placements (who worked under another company's job) | Recorded one by one on Recruitment cost, oldest first, real start date | Every month of a placement becomes a charge to a host and a payback; P90 decided money-carrying history is not bulk-imported |
| Levy | Not a record in Prima (a calculated figure only) | Nothing to import |
| Hostel bills, arrival cash, EPF/SOCSO debit notes | Their own forms | Money workflows with approvals and slips |
| Hostel stays (who lived where) | No add path anywhere (seed only) | Open question below |

### How an opening paper record keeps the "copy attached" rule

- It is added only where Prima holds **no** date for that paper (from a copy, typed, or the JA app). It never replaces or
  moves a date; a second row for the same paper in the same file is refused in the same check.
- It is saved as `source: 'typed'` with no copy (`docIds: []`): the screen shows "Typed in, copy not seen", exactly as a
  worker typed from an old list. The audit line says "from the old system ... (opening record, copy not yet attached)".
- The reminder ladder counts to it (so an expired permit shows as expired, not unknown).
- Nothing about the next step changes: a new or renewed paper is recorded only with its copy attached, a renewal only
  with its receipt, and a correction that moves an expiry later only with the copy. Tests check each.
- Passport numbers keep only their last 4 characters; numbers are masked in the import preview.

## 3. The workers' own sign-in

**Finding: foreign workers are guards in Prima.** Every foreign worker is a `people` record with `role: 'guard'` and a
foreign nationality, on the Guards screen like any guard. The JA app's worker feed is matched to them by company and
staff number (the passport number is never the key). So no separate "worker phone" is needed: they use the guard phone
that already exists (`#guard-phone`, `GuardPhoneApp`), with the same security:

- enrolment by an authorised person only: the people who set PINs (the company office of that company, PWVSB HR, or the
  CEO during the pilot) issue a one-time code; FWM cannot, and nobody enrols their own phone;
- face plus PIN every time (PIN hashed with `PIN_PEPPER`), five wrong tries lock the phone, per-address rate limits;
- own data only (the company wall plus `guard_phone_wall`), off unless `GUARD_PHONE=on`.

Built in P93:

- The FWM worker list shows each worker's phone sign-in: "Phone sign-in ready", "Phone code sent", "Phone not
  enrolled", "No PIN yet" or "No guard sign-in yet". It never shows a code or secret.
- Opening a worker shows "Own phone sign-in" with the existing enrol / retire card for people who may enrol (the same
  `GuardPhoneCard` as on the Guards screen), and otherwise says who does it.
- The guard phone's duty screen now also shows the guard's own reminders (papers running out, the next shift), the next
  shifts and the last clock-ins, read from the existing `/api/me/duty` with the phone's sign-in. View only, own record
  only; clocking in stays on the site device. This helps every guard, Malaysian or Nepali.

Not built, on purpose:

- **Clock-in and patrol on the phone.** The guard-phone design (handover 5 Nov 2026) keeps clock-in and clock-out on the
  shared site device (face at the site) and patrol as NFC taps there. The phone does not clock in. Changing that is
  Fauzan's decision (question 2).
- **Creating the guard sign-in.** Prima has no screen that creates a guard user; IT creates it today ("Ask IT to create
  it, then issue the code"). The FWM board shows "No guard sign-in yet" so the gap is visible (question 3).
- **Nepali text on the guard phone.** The phone is fixed bilingual (Malay · English). A Nepali line needs a checked
  translation (question 4).

## 4. For Fauzan's decision

1. **Owner adds foreign workers.** P93 lets the owner (the CEO record) add foreign workers and import old paper dates,
   following P78 ("the owner does the maker step everywhere"). Recording a paper from its copy stays FWM-only. Keep it?
2. **Check-in from the phone.** Should a foreign worker (or any guard) clock in on their own phone, with face plus PIN
   and the site geofence, instead of only on the site device? This changes the attendance proof and the fraud checks
   (the site device sees the guard at the site; a phone can be elsewhere) and needs your go-ahead.
3. **Who creates guard sign-ins.** Today IT creates them outside the screens. Should HR or the company office create a
   guard's sign-in from the guard's record (same people who set PINs)? It would be a new write path for user accounts.
4. **Nepali on the guard phone.** Add Nepali as a third line on the guard phone's short texts? Needs a native speaker
   to check each line (HR's mother-tongue policy copies say the same).
5. **Hostel stays.** There is no way to record who lives in which hostel (only test data). The utility shares and
   resident counts depend on it. A form (and import) for stays would be a new feature on the existing table.

## 5. Tests

- Core: `packages/core/test/fw-p93.test.ts` (owner may add, five others refused; board lists for makers only, numbers
  hidden from the owner; owner still refused `recordFwPaper`; paper words in English and Malay; opening records only
  where none, typed and no copy, refused for others, copy rule unchanged for new papers and later corrections; file
  import all or none; a Nepali guard enrols like any guard and the board shows each step).
- API on PostgreSQL with the company walls: `apps/api/test/fw-p93-pg.test.ts` (same negative authorisation for add and
  import, receipts and audit, the board's phone state under `guard_phone_wall`, FWM refused to issue a code, the
  company office issues it, the worker enrols and reads only their own duty).
