# Key-in helper ("Isi automatik") and the helper budget

Owner decisions (Fauzan, 23 Nov 2026, study "Where AI agents can help across Prima", instruction file
`/mnt/project-files/fitri-instructions/2026-11-23_ai-agents-across-prima-part-AG.txt`, sections AG0, AG-S, AG-K):

- "Use system more than ai. Find a way to make system do more than ai, so we minimize the token amount."
- "Although we make system more powerful, ai must also be there to help key in more needed. Staff do minimal work."
- One agent per team, and a budget cap of USD 25 per agent a month (rule `AI-AGENT-BUDGET`, Policy).

This is batch 1 of Part AG: the shared frame and the key-in helper. It is source in the repository only. Nothing is
deployed, no database module is added, and the online reader is off.

## What it does

A form is filled in this order. Each later step touches only the fields still empty.

| Step | Source | Cost | Where |
| --- | --- | --- | --- |
| 1 | What Prima already holds (the host form passes it) | free | `keyInStart` |
| 2 | A checked Excel list | free | the normal import, not this feature |
| 3 | The paper's words, read on the phone, then found by fixed rules | free | `apps/web/src/ocr.ts`, `keyInRulesRead` |
| 4 | The online reader, only for fields still empty | small | `apps/api/src/key-in.ts` |

Every value read from a paper is marked **Semak** and shows the words it was read from. The form cannot be sent until
the person confirms or corrects each one. A value typed by the person, or held by Prima, is never replaced. The helper
saves nothing: the host form saves under the person's own rights, as before.

## Every kind of document (Fauzan, 23 Nov 2026: "Make it read all type of document")

The person picks any file or takes a photo. The file is read on their own phone or computer and is never uploaded to
be read; only its words go to the rules (`packages/core/src/key-in-files.ts`, `apps/web/src/paper-words.ts`).

| File | How it is read | Cost |
| --- | --- | --- |
| Photo or scan (JPEG, PNG, WebP, GIF, BMP, and HEIC/TIFF where the browser can open them) | the text reader on the device (Tesseract) | free |
| PDF with text | its own text, rebuilt into printed lines (pdf.js, served from this website) | free |
| Scanned PDF | each picture page (up to 5) is read like a photo | free |
| Word .docx, Excel .xlsx, PowerPoint .pptx, OpenDocument .odt/.ods/.odp | opened in the browser (they are zip folders of XML); table rows stay on one line; Excel dates and money are written as printed | free |
| Text, CSV, JSON, XML, web page, RTF, email (.eml) | read as it is, scripts and settings dropped | free |
| Old .doc / .xls, locked files, unknown files, files over 15 MB | not read; the screen says what to do | - |

Limits: 15 MB a file, 15 PDF pages, 5 sheets, 40 slides, 12,000 characters of words used. The kind of file is taken
from its first bytes, so a renamed file is still read as what it is.

Kinds of paper (`KEY_IN_FIELDS`): receipt, quote, invoice, permit, licence, insurance, certificate, fuel may use the
online reader for fields still empty. Consent, medical, firearm, investigation, speak-up, bank statement, contract,
letter and **other** (any paper Prima does not know the kind of) are read on the device and by the rules only.

## What is never sent to the online reader

- Papers of these kinds, whatever the switches say: consent forms, medical papers, firearm papers, investigation
  papers, speak-up papers, bank statements, contracts, letters and papers of an unknown kind (`KEY_IN_LOCAL_ONLY`). They are read on the phone and by the rules only.
- IC, passport, bank account, card and phone numbers and emails (`keyInRedact`).
- Any field that is already filled. Only the names of the empty fields and the redacted words are sent.

## What may come back

The online reader is asked only to point at words on the paper. Prima reads the value itself. An answer is kept only
when it names a field that was asked for, its words are really on the paper as sent, and those words hold exactly one
value of the field's type (`checkKeyInOnlineOutput`). Anything else is dropped and the field stays empty.

## Switches (all needed for step 4; steps 1 to 3 always work)

| Setting | Meaning |
| --- | --- |
| `DRAFT_HELP_ENABLED=true` | master switch for drafting help |
| `AI_AGENT_KINDS` contains `key-in` | this helper kind is on (default: none) |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION` | the approved Azure OpenAI / Foundry endpoint |
| `KEY_IN_DEPLOYMENT` (or `DRAFT_HELP_DEPLOYMENT`, `AZURE_OPENAI_DEPLOYMENT`) | the model deployment, smallest that works |
| `AI_PRICE_USD_PER_MTOK_IN`, `AI_PRICE_USD_PER_MTOK_OUT` | price per million tokens, typed from the Azure price sheet |
| `AI_PRICE_USD_PER_MTOK_CACHED` | optional: the price sheet's lower price for cached input; unset counts the full price |

With no price set the online reader stays off: Prima does not guess a price. Switching it on needs the owner's go.

## Budget (rule AI-AGENT-BUDGET)

- One "agent" is one helper kind for one team: a central department, or a company office (`aiAgentTeam`).
- Before a call the worst-case cost is reserved; after it the real cost from the provider's usage figures replaces it.
  A call that would pass USD 25 for the month is not made and the field stays empty.
- The same paper with the same empty fields is read once; a second ask is answered from the kept result at no cost.
- 60 online reads per person per hour, at most 400 answer tokens per read.
- Each online read writes one audit line (`key-in.online`) with the team, paper kind, a hash, token counts and cost.
  Never the paper's words or the values.

## Known limits (unresolved gates)

- The month's spend and the kept results are held in the API's memory. A restart clears them, and two API replicas
  count separately. A durable counter needs a small database module (not written; needs the owner's go-ahead).
- The panel is on six forms so far: KDN renewal papers (AG21: 1.2 and 1.3 the paper's date; 3.1 and 3.2 the first and
  last month of the EPF or SOCSO statement; 3.3 to 3.5 the year; 3.7 the bank statement's month); the rental invoice record
  (number, date, amount); foreign worker papers (issue and expiry dates; passport and FOMEMA on the device only);
  the vehicle fill-up (litres, amount); the insurance renewal (policy number, dates, premium). Values a form carries
  over by default count as empty until the person changes them. Any `OpForm` can take it with the `keyIn` prop.
- IT purchase quotes: each quote row has its own "Isi automatik" (quote number, date, price, validity). Type checked
  only; no browser journey reaches that form yet.
- Staff receipt wallet: a PDF receipt is now read on the device like a photo (it was kept unread before). Type
  checked only.
- KDN statements (EPF, SOCSO, HRD, tax, SST, accounts: paper kind `statement`) and bank statements are read on the
  device and by the rules only, never sent to the online reader: they list staff pay and numbers. Month and year
  values are read from "Julai 2026", "07/2026", "2026-07" or a full date; a period line gives its first and last month.
- A host form passes `only` (the fields it has boxes for); other values are not shown and do not hold the save back.
- Handwriting is not read. Old Word and Excel files (.doc, .xls) and password-locked files are not read: the screen
  asks the person to save the file as PDF, .docx or .xlsx, or to type the values.
- Not tested against a live model, on a real phone, or by staff. PostgreSQL tests were not needed (no schema change).
- The Foundry resource is not linked to staging (gate G1 in Part AG).

## Tests
- `packages/core/test/key-in-files.test.ts` (14): file kinds, Word, Excel, PowerPoint, OpenDocument, web page, RTF,
  text, PDF lines, and what is refused. Synthetic files built in the test.
- `scripts/key-in-documents-browser-uat.cjs` (8 steps, in CI on the demo build): Transport records a fill-up from a
  Word receipt; values are marked Check, Confirm all clears them, an old .doc is refused with advice.
- By hand in a headless browser on the built app (23 Nov 2026, synthetic receipt): a text PDF, a scanned PDF, a Word
  file, a JPEG and a WebP were all read correctly, with no request leaving the website. Not yet a CI journey, and not
  tried on a real phone.

- `packages/core/test/key-in.test.ts` (21): who may use it, the rules reader, fill order, redaction, output checks,
  budget meter and switches.
- `apps/api/test/key-in.test.ts` (11): off by default, negative authorization, local-only papers, consent, kept
  results, cap and hourly limit, failures, the Azure call shape. A stand-in answers for Azure.

## Using fewer tokens

Fauzan, 23 Nov 2026: "Usd 25 for each agent or helper. Make sure it use all the new technology to decrease the amount of
token needed to work." The cap stays USD 25 a month for each agent (one helper kind for one team), and each online read
is kept small:

1. Rules, Prima's own records and reading on the phone come first; the online reader is asked only for fields still empty.
2. Only the lines near those fields are sent (the line naming the field and the next one, then lines with a value of the
   right shape), at most 2,500 characters (`KEY_IN_RULE.maxSentChars`), never the whole paper. Personal numbers are
   removed first.
3. The same paper with the same empty fields is answered from the kept result and is not sent again.
4. The fixed instructions and the answer schema come first and never change, so the provider's prompt caching can
   reuse them; cached tokens are counted at the cached price when `AI_PRICE_USD_PER_MTOK_CACHED` is set.
5. The answer is a strict JSON schema with room only for the fields asked (30 tokens plus 40 a field, at most 400).
6. The deployment should be a small model (a "mini" or "nano" model); the reader only copies text, it does not reason.

## Budget kept in the database

Fauzan's retest, 23 Nov 2026: "Paid AI - activation blocker: spending limits reset after a server restart. Keep it off
until budget tracking is durable." The month's spend per agent is now kept in PostgreSQL by the off-list module
`db/modules/ai-budget-v1.sql` (`prima.ai_spend`), through `apps/api/src/ai-budget.ts`:

- It survives restarts and is shared by every server. Each call first reserves its worst case under a row lock, so two
  servers cannot both slip under the USD 25 cap; the real cost then replaces the reservation. If writing the real cost
  fails, the worst case stays counted.
- The API cannot read or change the table directly: it may only call the three functions of the module.
- Until the module is installed (or if the database cannot be read), the online reader is off, whatever the other
  settings say. A budget kept only in memory never switches it on.

Tests: `apps/api/test/ai-budget-pg.test.ts` (restart, two servers at once, no direct access) and two more cases in
`apps/api/test/key-in.test.ts`.
