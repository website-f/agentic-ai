# Suggested drafts: BQs, vacancy posts and bills (rule DRAFT-HELP)

Third audit, item 6 (Fauzan, 5 Nov 2026: "Build"). Help drafting three things on Azure OpenAI:

| Kind | Who may ask | What is sent | What comes back |
| --- | --- | --- | --- |
| `bq` | Asset Management team (`assetRole` = team) | Job title, kind, the job details the team filled in, site measurements, notes | Sections A, B, C... with lines (description, quantity, unit, working, measured or estimate, optional) and the assumptions. **Never a rate or price.** |
| `job-post` | HR, the HR Director, a company manager (the people who write the post by hand) | Title, department, headcount, category, employer, approved pay range, "How to apply", closing date | Wording in BM then English |
| `bill` (A8) | Finance staff and the Finance Director | The bill text (pasted, or read from the PDF/photo first) | Supplier, account no., bill no., bill date, due date, period, amount due, each with the exact text and where it is on the bill |

Approvers who do not write the record (CEO, Chairman, Asset Director, COO) do not get it. Guards, site devices, system feeds and closed accounts never do. Permission is checked before the switch, so an outsider cannot tell whether it is on.

## It is a suggestion only

- Nothing is saved, submitted, priced, approved or paid by the helper. The person presses **Guna cadangan ini** to copy it into the normal form, edits it and saves the form as usual. Every existing check, approver, row lock and audit stays as it is.
- Staff screens say **Cadangan draf** and never name an AI product (staff usability rule 4). The line above the button says the details go to the company's draft suggestion service (Microsoft Azure) and that no staff names, IC numbers or phone numbers are sent.
- The test link (demo) has it off and never invents a suggestion.

## Checks on what is sent (packages/core/src/draft-help.ts)

- Only whitelisted form fields; unknown fields dropped; size limits (8,000 characters for a bill).
- IC numbers, Malaysian mobile numbers and emails are replaced with `[dibuang]` in every free-text field. On a bill, only an IC written with dashes is removed (a 12-digit utility account number can look like an IC), emails are kept (they are the supplier's), and card-like numbers are removed.
- "How to apply" is kept as written (it is published as the official contact) but refused if it holds an IC.

## Checks on what comes back

Any failed check refuses the whole suggestion (HTTP 502), so a person never sees a half-checked one.

- **BQ:** exact fields only; positive quantities; units from our list (LS, no, m, m², m³, kg, set, unit, pt, day, lot); no RM figure anywhere; no personal numbers. Prima numbers the lines (A1, A2...). A "measured" line with no working becomes an estimate. `bqSuggestionLines()` gives PR #82's line shape with `rate: null`, so rates still come only from our own past awarded quotes or the contractor (rule AM-BQ).
- **Post:** must name the job title; every RM figure inside the approved range (none at all when no range); no IC; no phone or email other than the ones in "How to apply"; no wording that limits applicants by race, religion, sex or looks.
- **Bill:** the model copies each value as printed; Prima itself finds it on the bill (exactly, or the same words with different spacing or line breaks) and refuses the whole reading if any value is not there (no invented figures). A model is never trusted to count character positions. Dates (DD/MM/YYYY, DD.MM.YYYY, DD/MM/YY, "01 Okt 2026") and amounts ("RM1,234.50") are read; credits are not amounts due; a due date before the bill date or a period ending before it starts is flagged for staff.

## Server (apps/api/src/draft-help.ts, draft-help.controller.ts)

- `GET /api/draft-help`: `{ on, kinds, consentVersion }`. `POST /api/draft-help/:kind` with `{ consent: 'draft-help-v1', form }`.
- One Azure chat-completions request per press, strict JSON schema, no tools, no history, temperature left at the model default, managed identity token (no AI key stored), redirects refused, 256 KB answer cap, 45 s limit.
- One ask at a time per person and 20 per hour per person (proposed, for cost).
- Audit: `draft.help.started` is committed before the model call, `draft.help.terminal` after (success, provider_failed, timeout, invalid_output). Only the kind, a SHA-256 of what was sent, its length and the outcome are kept: never the form text or the suggestion. No suggestion is returned when the audit cannot be written. The model is never called inside a database transaction.

## Switching it on

**Fauzan approved creating the Azure OpenAI resource on 5 Nov 2026** ("Yes approve azure open ai"). This session has no Azure access, so the resource is created by pasting `infra/create-draft-help-ai.sh` into Azure Cloud Shell as Owner of `rg-prima-staging-sea`. The script:

1. creates `oai-prima-staging-sea` (Azure OpenAI, Southeast Asia) with key sign-in turned off, so only Entra identities can call it;
2. deploys the first of `gpt-4.1-mini`, `gpt-4o-mini` that the account offers (newest generally available version not past retirement) as `prima-drafts`, Global Standard pay-per-use, capacity 20 (20,000 tokens a minute), never provisioned throughput;
3. gives `id-prima-staging-app` the *Cognitive Services OpenAI User* role on that account only;
4. prints the API settings without applying them.

Cost is per use and falls under the existing staging budget alert `prima-staging-monthly`. Confirm the model's price on Azure's pricing page before running. As a rough guide from list prices for these small models, one BQ suggestion costs well under one US cent, so a thousand suggestions a month is a few US dollars.

Turning it on is a separate, recorded step **after PR #116 is merged and deployed**: set on the API `DRAFT_HELP_ENABLED=true`, `AZURE_OPENAI_ENDPOINT` (from the script), `DRAFT_HELP_DEPLOYMENT=prima-drafts`, `AZURE_OPENAI_API_VERSION=2024-10-21` and `AZURE_OPENAI_CLIENT_ID` (the identity's client ID; staging has only a user-assigned identity). This switch is separate from `ARISHA_ENABLED`; turning on Arisha for the four leaders does not turn this on, and the reverse. Then check on synthetic data (a made-up job, post and bill) before a first real use watched by the team. Off-switch: `DRAFT_HELP_ENABLED=false`.

## Fitting it into the three screens

The three screens are on draft PRs not yet on main, so this PR adds the panel (`apps/web/src/DraftHelp.tsx`) and the server, and each screen adds one panel when the PRs are combined:

- **BQ (PR #82, `AmBq.tsx`):** under the job details and measurements. `form` = title, job kind, brief answers (labelled by question), measurements (labelled with units). `onUse` adds `lines` to the draft BQ; the existing past-rate fill then prices lines that match our past awarded quotes; everything else stays unpriced. Drafting stays blocked until the job details are complete (AM-BQ-BRIEF).
- **Vacancy post (PR #78):** next to the template draft, from `advertFacts(...)`. `onUse` puts the wording in the post text, marked as a suggestion; `checkAdvert` and the HR Director / OM approval are unchanged.
- **Bill (PR #49, regular payments, "amounts that vary"):** `form` = the bill text (or the text read from the bill on the phone). `onUse` fills the bill date, amount and reference; the bill document is still attached, the 125%/50% check and "whoever recorded it does not prepare its payment" still apply.

## New-building BQ

The prompt follows the style of the sample renovation BQ in the project files (Ringkasan / BQ / Nota; sections A to K; "Catatan / Pengiraan" working; LS for mobilisation; optional items marked *Pilihan*; contractor fills Kadar; notes end with "all quantities are estimates, contractor verifies on site"). Drawings are not sent: the team types the measurements from them.

## Tests (local runs)

- Core (vitest): `packages/core/test/draft-help.test.ts`.
- API (node:test, stand-in for Azure): `apps/api/test/draft-help.test.ts`.
- API on local PostgreSQL 16: `apps/api/test/draft-help-pg.test.ts` (start committed before the model call, no form text in the audit, chain whole, audit written under the database wall for a company manager and Finance staff, endpoint off by default, outsider refused).
