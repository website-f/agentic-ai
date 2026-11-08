# Contracts and site mobilisation: real use (5 Nov 2026)

Status: draft, not merged, not migrated, not deployed. Mock data only. Built on the Client CRM draft (PR #74).

## What changed from the sample screen

| Area | Before | Now |
| --- | --- | --- |
| New contract | client, sites, dates, one rate, reference | signed contract or letter of award, copy attached (required), client PO, posts and rates per post, service levels, penalties, payment and notice days, performance bond or bank guarantee |
| Mobilisation checklist | 12 items, a tick each | 28 items across W1 to W11 (26 unarmed), each with who does it (company office, Operations, HR, Finance, Arms Control) |
| Marking an item done | a tick | proof required (photo at the site or a document); opening again needs a reason; every change kept in the item's log |
| Checks the system makes itself | none | first-week roster filled for every post; every rostered guard cleared to deploy (same rules as the roster); client contacts (decides, on site, pays) on record in Clients |
| Ready-to-Operate | checks items once | checks again at signing (a guard may have lost a permit since the tick) |
| Expansion (new site, more guards, armed posts) | not covered | a signed variation that adds a site or more guards opens its own round of site items and its own Ready-to-Operate |
| Renewal | not covered (CRM warned "record the renewal in Contracts") | a renewal signed in Clients moves the contract end date by itself; Contracts can record one signed another way, with its copy |
| Clients link | contract chose a client | the client takes the contract's sites and end date; contracts without a client are flagged and can be tied to one; the client file lists contracts with progress and lets the company manager record the signed contract |

## Who does what

- Company manager: records the contract, variations and renewals; adds client-specific items; accepts the risk on a non-critical item for up to 30 days; signs Ready-to-Operate (first and each expansion); ties a contract to a client.
- Company admin executives: work every item, including recording what HR, Finance and Arms Control did, with their proof.
- Operations (OM and above, own area): work only the Operations items.
- Group leadership: watch only.

## Proposed, to confirm (decision M-1 and others)

1. Item wording, due days and which items are critical (from the V6 amendment, proposed until Operations confirms).
2. Default terms: payment 30 days, notice 30 days, service levels 60 minutes, 24 hours, report by the 7th.
3. The roster check looks at the first 7 days from the start date.
4. W7 legal items (JTKSM, PERKESO, KDN notice) are recorded as done with proof; whether a client site counts as a place of employment is still open (M-3, M-4).

## Help from the signed paper (5 Nov 2026)

Fauzan: "Make sure ai can help when signed contract or letter of award uploaded."

- In New contract the copy is attached first. "Read the attached copy" reads the words of the PDF on the phone or PC (no outside service), or the manager pastes the text.
- The fixed reader (English and Malay) proposes: kind of paper, reference, client PO, start and end date (or start plus period), monthly fee or rate per guard-hour, guards, hours a day, payment days, notice days, bond amount, replacement minutes, incident report hours and penalties. Each value shows the exact words it came from.
- Points to look at twice: penalties or liquidated damages, wide indemnity, termination at any time, notice under 30 days, payment over 60 days, bond, armed guards, no price-change clause for minimum wage, formal contract still to follow, automatic renewal, no subcontracting, insurance, dates missing, end before start, and a price more than 5% from the quotation the client accepted (when the client came from a won lead).
- Nothing is filled until the manager presses Use (or Use all), and nothing is saved until Save contract. Only the company manager can read a paper, and only for that company.
- The paper's words are not stored. The audit trail keeps the length and the SHA-256 fingerprint only. The demo does not keep the text in the browser.
- A scanned paper or photo has no words to read here (no OCR). The screen says so and asks for the text to be typed or pasted.

### Online second reading (off)

An online reader through the group's Azure OpenAI can add a second reading. It is off unless both `ARISHA_ENABLED` settings are complete and `CONTRACT_READER_ONLINE_ENABLED=true`. It sends only the paper's text, with instructions to treat it as data. A value it returns is kept only where its quoted words are really in the paper at the place given, and the value matches those words. It is a new use of AI by company managers, so it stays off until Fauzan approves it and Azure OpenAI is set up. While it runs the request holds its database transaction for up to 30 seconds.

## Database

No new table and no migration. New optional fields on the existing `contracts` JSONB rows (paper, terms, rounds, renewals, variationDocs, and per-item owner, auto, proofIds, round, extra, log). Proof uses the existing evidence tables inside the company wall.

## Tests

- Core: `packages/core/test/contracts-real-use.test.ts` plus the updated contract tests in `core.test.ts`; the paper reader in `packages/core/test/contract-reader.test.ts`, including synthetic PDFs made with LibreOffice and ReportLab.
- API: the online reader with a fake HTTP client in `apps/api/test/contract-paper-online.test.ts`.
- API against local PostgreSQL with row-level security: `apps/api/test/contracts-pg.test.ts`.
- Browser walk-through (demo build, 1280 and 390 px): project files `reviews/contracts-real-use/`.
