# IT import (T9 slice 1): handover to Arisha main

Status on this branch: code and tests only. Not merged, not deployed, no migration, no AI. From this handover, PR #31 and any import or Arisha AI work belong to Arisha main (Fauzan, 31 Oct 2026).

## What it does

The CEO pastes rows copied from Excel or chooses a CSV file, reviews a preview, and approves the batch once. It covers open help requests (`tickets`) and open IT jobs (`jobs`) only. It creates new items only and never updates, merges or deletes anything. Only the CEO's own account may use it: `arishaLeader(user) === 'ceo'`, which checks the exact ID `u-fauzan` and the CEO role. Every other user gets 403, including on retries of a batch that was already imported.

## Endpoints

Both go through the existing IT action route: `POST /api/it/act/:action`, which calls `PrimaService.itAct`. The body is JSON.

| Action | Body | Writes |
|---|---|---|
| `importPreview` | `{ kind: 'tickets' \| 'jobs', text, source }` | nothing |
| `importApprove` | `{ kind, text, source, batchId, previewToken, skipRows: number[] }` | items, plus audit lines, in one transaction |

- `text`: the table with its heading row first. At most 200,000 characters and 200 rows.
- `source`: 3 to 200 characters. It says where the rows came from, such as a file name, an email subject and date, or a SharePoint link.
- Nothing is cut short. A longer `source` is refused, and so is a `batchId` or `previewToken` that is too long. A cell that is too long is an error on its row: title over 120, requester over 80, or detail over 1,000 characters (`IT_IMPORT_MAX_LEN`).
- `batchId`: chosen by the client and matching `[A-Za-z0-9-]{8,80}`. The web app uses `crypto.randomUUID()` for each preview.
- `previewToken`: the `previewToken` from the preview response, sent back unchanged.
- `skipRows`: sheet row numbers that the CEO chose to leave out. A number that is not in the batch is refused.

## Preview shape (`ItImportPreview`, `packages/core/src/it-import.ts`)

`{ kind, source, headings, mapping, missingColumns, problems, rows, ready, previewToken }`

- `mapping` shows which heading was read as which field. Required columns: tickets need title, requester, channel and priority. Jobs need title, doer, dueOn and priority.
- `problems` lists faults with the whole table. Examples: a quote mark that is never closed, two columns read as the same field, or no rows under the heading row. Any problem sets `ready` to 0, and approval is refused.
- `rows[]`: `{ row, sourceRef, errors, warnings, duplicateOf, ticket? | job? }`.
  - `row` is the row number in the sheet, with the heading as row 1. Blank rows still count, and a quoted cell that runs over several lines stays one row.
  - `sourceRef` is `"<source>, row N"`. It is stored on the created item.
  - CSV layout faults are errors on that row, not guesses. They are: a quote mark inside a cell that is not quoted, text after a closing quote, and more cells than the heading row has (often a comma that needs quotes). In Excel (tab-separated) pastes, a quote mark inside a cell is read as a literal character.
  - `duplicateOf` marks a row that repeats an earlier row in the batch, or an open item already in Prima. Such rows are left out.
- `previewToken` is a SHA-256 over the input (kind, source, text) and everything the preview shows, except warnings and the clock time given to rows raised today.

## Approval rules (`PrimaService.itImportApprove`)

1. The CEO check runs first, on every call.
2. The batchId and token formats are checked, then the transaction takes `lock('itSettings','it')`, so imports run one at a time.
3. If items already carry this `importBatchId`:
   - When their stored `importToken` and `importInput` (a SHA-256 of kind, source and text) match the call, and it leaves out the same rows, it returns the original receipt unchanged: `{ already: true, created, skipped }`.
   - A retry that leaves out different rows is refused.
   - Otherwise, or when the batch ID was used for the other kind, it is refused with "already imported with different rows". Nothing is created.
4. Otherwise the preview is run again inside the transaction. If its token differs from `previewToken`, nothing is created and the CEO is asked to preview again. This happens when the rows, the source or the kind changed, or when Prima changed in a way that alters a row (for example, someone logged the same request by hand).
5. Table problems or missing columns are refused. Rows with errors, repeats or a skip mark are left out and listed in `skipped`. If no row is left, the call is refused.
6. The items are created as follows:
   - Tickets: status `open`, `raisedById: import-<batchId>`, with `raisedFor`, `channel` and `assignedTo` taken from the row.
   - Jobs: status `todo`, `givenBy` set to the CEO, and a log note "Imported from <sourceRef>".
   - Both carry `importBatchId`, `importToken`, `importInput` and `sourceRef`. The first item of the batch also carries `importReceipt` `{ created, skipRows, skipped }`, which is what a retry returns. These are optional JSONB fields, so no migration is needed.
7. Audit: one `it.ticket.import` or `it.job.import` line per item, and one `it.import` line for the batch (entity `it_import`, entityId = batchId, with the first 12 characters of the token).

The result is `{ batchId, already, created: refs[], skipped: { row, why }[] }`.

## Screen behaviour (`ItImport.tsx`)

- Any change to the kind, source, rows or file clears the preview. A preview or file read that finishes after a later change is dropped, so it never overwrites newer input.
- While an approval runs, the inputs, Preview and the "Leave this row out" boxes are locked. While a preview or file read is loading, Approve is disabled. Starting an approval drops any result still pending. Guards are set the instant a step starts (refs), so a click that lands before the screen updates is refused too.
- The test version (demo build only) can hold every change open with `globalThis.__primaDemoDelayMs`, which the browser check uses to test slow responses.
- Previewing the same rows again keeps the same batch ID and the rows the CEO left out. Approving again after a failed or uncertain attempt sends the same batch and skip list, so it returns the first receipt instead of importing twice.
- Each row in the preview shows its Detail.

## For AI-assisted migration

The preview is the natural place for AI to plug in. AI could produce `text` (a table with a heading row) and a `source` that names the email or file. The CEO then sees the same preview and approves it under the same rules, with no new write path. Whether AI may read company records or email at all needs its own approval. Sensitive transfers, deletes, overwrites, access changes and email sending stay separately confirmed.

## Tests

| What | Where |
|---|---|
| Parsing, dates, preview with no writes, CEO only, retry refused for non-CEO, preview binding (text, source, kind, token, a hand-logged repeat), batch ID reuse with changed rows or kind, sheet row numbers, broken CSV, approve once, audit lines, skip rows, jobs, overlong values refused not cut, original receipt on retry, retry with different skip rows refused | `packages/core/test/it-import.test.ts` (14 tests) |
| Over HTTP against a throwaway Postgres: IT Lead 403, edited rows 400, two approvals at the same moment give one import, IT Lead retry 403 with no refs leaked, reused ID with changed rows 400, stored `sourceRef`, overlong source 400, a retry returns the original receipt | `apps/api/test/http.test.ts` |
| Demo browser at 1440x1000 and 390x844: IT Lead has no Import tab, row numbers, Detail shown, a left-out row stays left out after a new preview, a late file read does not replace typed rows, Preview waits for a file read, Approve refused and disabled during a slow preview, row boxes, inputs and Preview locked during a slow approval, editing clears the preview, double click imports once, a second batch finds repeats, the panel fits the screen | `scripts/it-import-smoke.mjs` (CI job `synthetic-browser`) |

## Files

- `packages/core/src/it-import.ts`: parser, mapping, preview and fingerprints
- `packages/core/src/service.ts`: `itImportPreview` and `itImportApprove`
- `packages/core/src/types.ts`: optional import fields on `ItTicket` and `ItJob`
- `apps/web/src/views/ItImport.tsx`: the screen
- `apps/web/src/views/It.tsx`: the Import tab, shown to the CEO only
