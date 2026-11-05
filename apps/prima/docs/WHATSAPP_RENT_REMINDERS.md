# WhatsApp rent reminders (Asset Management)

Fauzan, 2 Nov 2026: "Create a connector to what app so it can communicate directly. Renter all have what app but not everyone use or monitor emails."

**State: built as a draft on PR #53. It is not merged or deployed, it is not connected to WhatsApp, and no Meta account, number, template or token exists for it.**

## What it does

**When reminders go out.** The due day is confirmed; the reminder days are PROPOSED and the Asset Director confirms them in `packages/core/src/rent-reminders.ts`.
- Rent is due on the 1st of the month (Fauzan, 2 Nov 2026, confirmed). The reminder days below are still proposed.
- A reminder goes 3 days before the due date, on the due date, 7 days late, and then every 10 days while the rent is unpaid.
- After 90 days late, WhatsApp reminders stop. The team's letter or notice of demand takes over, with the Asset Director's approval.
- Messages go out between 9 am and 6 pm Malaysia time, and at most once a day per tenant.
- Only the oldest unpaid month is chased, with the total owed.

**Who does not get them.**
- A tenant only gets reminders after agreeing. The rental team records how the tenant agreed, for example a signed form or a WhatsApp reply.
- A tenant who replies STOP or BERHENTI is never messaged again. Consent is withdrawn and anything still waiting is cancelled on every unit that tenant's number is recorded on.
- A tenant with several units gets at most one message a day, with the total worked out at the moment of sending (not when it was queued).
- Group offices and state branches are not messaged.
- A tenant with a promise-to-pay date that has not passed yet gets no late reminders until that date.
- A reminder waiting to go is cancelled once the rent is paid.

**What the team sees on the unit.**
- Each sent reminder is logged as "Automatic WhatsApp reminder".
- It does NOT count as the team's own update every 10 days, so `lastContactOn` is unchanged.
- Tenant replies are noted on the unit for the team.
- Each reminder shows its delivery state: sent, delivered, read, or failed. A failed send is retried up to 3 times.

**Where it is on screen.** Asset Management, Rent and arrears, panel "WhatsApp rent reminders". The panel has:
- whether the connector is on;
- tenants who owe rent but have not agreed, with a button to record their agreement;
- tenants who have agreed, with a Stop button;
- recent reminders;
- "Check reminders now".

## How it is built

- **Core** (`packages/core/src/rent-reminders.ts`, service `amWhatsApp*` and `amQueueRentReminders`):
  - Reminders are stored on the unit's tenancy record, so there is no new table.
  - Each reminder has a fixed id (unit, month, stage), so it is never queued twice.
  - A sender claims a waiting reminder before sending (state `sending` with a claim id), so two senders never both send it. A claim with no result after 15 minutes is released for the next pass.
  - A pass that touches several units locks them in a fixed order, so two passes cannot deadlock.
  - **Uncertain sends (round 2).** A claim with no result after 15 minutes, a timeout, a server error, or a success with no message id may mean the message went. It is marked "May or may not have gone" and never sent again on its own. Only a clear refusal (4xx) is retried. The team checks the WhatsApp Business inbox or the tenant and chooses It went, Send again or Leave it, with a note; this is audited.
  - **One a day per number** counts every unit on that number: messages sent today, sends in progress and uncertain sends from today.
- **System sign-in.** The system sign-in `u-whatsapp-link` (integration `whatsapp`) holds only the asset walls. Only this sign-in can read the outbox, which carries tenants' numbers.
- **API** (`apps/api/src/whatsapp.ts`):
  - Uses the WhatsApp Business Platform (Cloud API) to send approved template messages.
  - Meta's webhook is `GET/POST /api/integrations/whatsapp/v1/webhook`. Each call is checked with the `X-Hub-Signature-256` signature and the app secret.
  - Staff routes are under `/api/am/whatsapp`.
  - A runner starts every 30 minutes, but only when the switch is on and every setting is present.

## To switch it on (owner steps, each needs authorization)

1. Register a WhatsApp Business number for Asset Management in Meta Business Manager.
2. Get three message templates approved by Meta, with Malay first and English below. Each template's body takes these values:
   - {{1}} tenant
   - {{2}} unit
   - {{3}} amount
   - {{4}} month
   - {{5}} due date
3. Point Meta's webhook at `<staging-api-url>/api/integrations/whatsapp/v1/webhook`.
4. Set these in the API's secret settings (names only; values never go in the repository):
   - `WHATSAPP_GRAPH_VERSION`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_TEMPLATE_BEFORE`, `WHATSAPP_TEMPLATE_DUE` and `WHATSAPP_TEMPLATE_LATE`
   - optionally `WHATSAPP_TEMPLATE_LANG` (default `ms`)
   - then `WHATSAPP_RENT_REMINDERS=on`
5. The PDPA officer reviews:
   - the consent wording;
   - sending tenants' numbers to Meta.

   Meta charges per template message. The current rate for Malaysia should be checked before switching on.

## Tests (2 Nov 2026, local, mock data, fake WhatsApp)

After Arisha main's review (2 Nov, `337242b`): core `rent-reminders.test.ts` 7 tests (adds multi-unit STOP and balance, and claim release); API `whatsapp.test.ts` 6 tests (adds two concurrent passes on PostgreSQL sending one message across both units). Full suites at `eeb62a8`: core 723/723, API 705/705. Earlier first-run figures follow.


- **Core:** `packages/core/test/rent-reminders.test.ts`, 5 tests. Full core suite: 714 of 714.
- **API:** `apps/api/test/whatsapp.test.ts`, 5 tests:
  - settings and switch;
  - template message;
  - signature and webhook parsing;
  - a full pass on PostgreSQL 16 with row-level security;
  - the webhook check over HTTP.

  Full API suite: 695 of 695.
- No call left the machine.
