# FWM recruitment cost: review evidence (PR #64)

This file records review evidence only. It does not authorize a merge, module install, migration, deploy or real rates. All data is synthetic.

## Exact code under test

- Branch: `claude/fw-recruitment-cost`. Base: main `0ead549`.
- Code head: the PR head that carries this file. Earlier rounds: 2f7f661, 0f4e8e4.
- `db/modules/fw-recruitment-cost-v1.sql` sha256: `f175ff8f3913a298973b2d84447ecf5690dedd097a98c97fc6262e76ccd91383`.
  - NOT registered in `db/release-manifest.json`. NOT applied by any script.
- `db/migrations/001_init.sql` sha256: `4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe` (unchanged).

## Owner decisions in the code (Fauzan, 3 Nov 2026)

| Decision | Where |
|---|---|
| Recruitment cost is charged monthly per worker. Any day in a month counts as the full month. | `RULES.fwmRecruitmentCost`, `placementInMonth` |
| The host pays FWM, and FWM pays the owner back. The FD or CEO sets both rates. | `draftFwCostMonth`, `setFwCostRate` |
| A branch can be a host, including a branch of the owner company. | `recordFwPlacement` |
| A worker under two hosts in one month: half each. Decided by Fauzan on the decision card, 4 Nov 2026 02:28Z; this replaces the earlier exchanges of 3 Nov. | `fwCostSplit` |
| The worker keeps wearing the owning company's uniform. Fauzan checked that KDN allows it. | rule text, placement form |
| A legal flag never stops the system. It goes to the CEO log, where the CEO records details. | `FW_COST_LEGAL_FLAG`, `addFwCostLegalNote`, CEO log tab |

## Review findings to fix and tests (Arisha main, 3 Nov 2026 07:47Z)

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Half or full month for a mid-month move was inconsistent. | Decided by Fauzan, 4 Nov 2026 02:28Z: half each. The code is unchanged. | core "two hosts in one month split the worker half each"; UAT step 4 |
| 2 | A placement added or ended back-dated after drafting could leave a month wrong or missing a worker. A redraft skips live rows. | Locked: a change that alters a finished month with a live (not rejected) charge is refused. A draft month must first be rejected by the FD or CEO, then corrected and redrafted. Approved, billed and paid months never change. Drafting and placement changes serialize on one PostgreSQL advisory lock. Fauzan chose "Lock charged months" (decision card, 08:55Z); no adjustments. | core "a charged month is locked"; pg `fw-cost-service-pg.test.ts` (placement racing the draft; two drafts at once; 5 repeated runs); UAT step 4a |
| 2b | CI on 49cd52c: a redraft retry after a rejection could duplicate charges (each got its own -r id). | Drafting skips any payer and month with a live charge, whatever its id; and the database now allows one live charge per payer and month (partial unique index `fw_cost_charges_one_live`). | core retry assertion; pg "two drafts of the same month at once" (6 runs); pg "one live charge per payer and month" |
| 4 | (09:24Z) CEO-only legal notes reached Finance and the FD through `rates.history`. | `rates.history` returns only the charge and payback steps. | core and pg: every non-CEO role's whole board response carries no note or legal text |
| 5 | (09:24Z) A host company manager could not see placements under its job: the owner's company wall filtered them out. | Read-only `host_read` policy on `fw_placements` for the host company. Writes stay owner-walled. The host-only view drops FWM notes, papers and the recorder, and shows a name and staff-number snapshot. The owner's staff records stay unreadable. | core host test; pg "host company manager reads placements ... and cannot change them" |
| 6 | (09:24Z) The backdated-rate guard read charges before taking the shared lock. | The lock is taken first. | pg "order 1" (rate waits while a draft lands: refused), "order 2" (draft waits while a rate lands: uses it), real race with an invariant. Tests 4-6 fail at f98466f and pass now. |
| 6b | The new race tests showed two redrafts in one second could collide on id. | Redrafts are numbered `-r1`, `-r2` under the lock. | pg suite |
| 7 | (02:04Z, 4 Nov) The FD's rate-setting response returned the whole rate row, including the CEO's legal notes. | `setFwCostRate` returns only the charge and payback steps. | core: FD response has no note; pg: "only the CEO reads the CEO log" now also checks the write response |
| 8 | (02:04Z) Host read used a `host_read` policy over whole owner placement rows, filtered only in the service. | `host_read` removed. FWM writes a separate `fw_placement_hosts` row behind the HOST's own company wall, holding who and when only (name, staff number, owner, branch, dates). A CHECK refuses note, papers or recorder fields in it. The host can no longer read any owner placement row or staff record. | pg: host reads none of the owner's `fw_placements` or `people` rows; its host-view row has exactly 10 fields; a note in that table is refused; another company cannot update it |
| 9 | (02:04Z) Browser evidence was not tied to an exact-head CI run. | `scripts/fw-recruitment-cost-browser-smoke.mjs` runs in the CI synthetic-browser job. It writes the head SHA, run id, every step, and screenshots to the artifact `fw-recruitment-cost-uat-<head sha>`. | CI synthetic-browser job |
| 10 | (03:08Z, 4 Nov) The host-view CHECK denied seven names instead of allowing exactly ten. | The CHECK now requires all ten keys and nothing else (`data ?& keys` and `data - keys = '{}'`). | pg: an extra key, a missing key and a note are refused; the exact ten pass |
| 11 | (03:08Z) The shared app role could update its own host-view rows. | The company wall on `fw_placement_hosts` is split. Read uses the wall. Insert and update need the wall plus `prima.fw_placement_writer()`, which reads the server-selected user (FWM, not despatch, account open), like the IT register checks. A trigger allows only the last day to be set, once. | pg: the host's sign-in cannot update or insert; FWM cannot change other fields; FWM cannot set the last day twice |
| 3 | Evidence was not at the exact head in the repo. | This file and `docs/fw-recruitment-cost-uat/browser-uat.cjs`. | n/a |

## Results on the declared toolchain (local)

Toolchain: Node 22, PostgreSQL 16, non-superuser, FORCE RLS.

- Core (vitest): 691/691 passed, including 11 recruitment cost tests.
- API (node --test, real PostgreSQL): 692/692 passed. It includes:
  - `fw-cost-rls.test.ts`: the module is idempotent; FORCE RLS; no DELETE; the company wall holds; money shape checks.
  - `fw-cost-service-pg.test.ts`: the race tests.
  - `fw-cost-controller.test.ts`: malformed input is refused, and the actor is the signed-in user.
- Typecheck of all workspaces is clean, and `build:demo` passes.
- CI on GitHub: see the checks on the PR head.

Mocks and source inspection are not counted as database or browser results above.

## Browser UAT (Chromium, demo build)

The script is `scripts/fw-recruitment-cost-browser-smoke.mjs`. It runs in CI on every push. The artifact `fw-recruitment-cost-uat-<head sha>` holds its log (head SHA, run id, each step) and screenshots. It uses the finished month before today, so the month below is shown as M.

1. **FWM officer.**
   - Records two placements in month M.
   - Moves one worker to a second host on day 21 of M.
   - Sees the uniform note.
   - Is blocked from choosing their own company without a branch.
   - Has no Rates or Charges tab.
2. **Finance (before rates).** Drafting is refused while rates are missing. There is no rate form.
3. **FD.** Sets the charge rate to RM250 and the payback rate to RM200, from M.
4. **Finance drafts M.**
   - Arrow Shield RM125 and Inas RM125 (half each).
   - Sasa branch RM250.
   - Payback RM400.
   - No Approve button.

   4a. **FWM, back-dated placement.** A back-dated placement into drafted M is refused with a plain message.

   4b. **CEO log.** The CEO adds details in the CEO log. The FD sees neither the CEO log nor the legal text.
5. **FD approves.** A reason is required.
6. **Finance records invoice and payment.**
   - The invoice is shown as "Billed, not paid".
   - Payment cannot be saved without a slip.
   - The approver cannot record the payment.
7. **Company managers.** Arrow Shield's manager sees only its own bill, plus the workers under its job from its own host-view rows (owner shown, no FWM notes, no End button). Sasa's manager sees its payback and its branch bill.
8. **OM and phone.** The OM has no menu entry. At 390px phone width there is no horizontal scroll. There are no page errors.

## Not built, or needs the owner

- **Module install and manifest entry.** This is the release owner's step and needs authorization. Until it is installed, the page fails on a real database. Demo mode works.
- **Rates.** None are set. The FD or CEO enters them in the app.
- **Branch treasury integration (PR #61).** Not connected. The host charge id, `invoiceRef` and `total` are ready to link as a `recruitment_cost` settlement line.
- **Legal flags.** The CEO log exists only for this module. It is not linked to the directors' legal flags view (PR #52) or to a group-wide CEO log.
- **SQL Account.** The app records invoice numbers and payments. It does not post to SQL Account.
- **Adjustments for corrections to settled months.** Not built, by Fauzan's decision (08:55Z): charged months are locked.
- **Not tested.** Real Entra sign-in and Azure staging.
