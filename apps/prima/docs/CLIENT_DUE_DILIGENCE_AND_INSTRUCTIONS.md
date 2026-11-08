# Client due diligence and assignment instructions

This is package 1c of the PIKM (SIRIM code) and ISO 9001:2015 review (Fauzan, 5 Nov 2026). It covers ISO 9001 8.2 (requirements for services) and 8.5.1 (controlled provision). It sits on top of the Contracts draft (PR #91) as its own draft PR, and it extends the client file and the contract. It is not a separate app.

Status: draft. It is not merged, migrated or deployed, and it uses mock data only.

## Client due diligence (Clients → client file)

- **What it records.** Before taking a client on, the company office checks seven things:
  1. who the client is (SSM search, or the government agency confirmed);
  2. that the person signing has authority;
  3. that the purpose is lawful;
  4. that the client can pay;
  5. that there is no conflict of interest;
  6. that the site risk has been assessed;
  7. what client data and CCTV the company will handle.

  Each check keeps its reference. A concern, or a check marked not needed (for example, no credit check for a government agency), needs a reason.
- **Who decides.** The company manager decides, with a reason. The options are accepted, accepted with conditions (needed when there is a concern), or declined. Admin executives work the checks. Operations OM and up, group leaders and ACT can read them.
- **Repeat.** It is reviewed again 12 months after the decision or when the contract ends if that comes first. Earlier rounds are kept.
- **Storage.** It lives on the client record (`clientAccounts.diligence`), so there is no extra form.

## Assignment instructions (Contracts → contract → Assignment instructions)

- **What they record.** For each site: the duties at every post, the site routine, who guards report to, and the emergency contacts. Operations (OM and up) or the company office writes them, and records the client's signature (name, position, date, and where the signed copy is filed).
- **Changes.** A new version clears the client's signature, so the client must sign again. A small correction (a typo or a wording fix) keeps the signature. History is kept.
- **Guards.** Guards do not see the instructions in Prima (Fauzan, 5 Nov 2026). Officers brief them at the site. The server refuses guards who ask for them.
- **Storage.** They live on the site record (`sites.instructions`).

## Mobilisation checklist

- **New W2 item.** "Client due diligence accepted by the company manager" is critical and checked by the system. It fails when diligence has not started, is still open, was declined, or its review is overdue.
- **Changed W4 item.** The old "Post orders and SOP agreed and signed with the client" item is now "Assignment instructions for every post agreed and signed by the client". It is critical and checked by the system for every site in the round, and it reopens for each expansion.
- **Certification.** Both checks run again when Ready-to-Operate is signed, like the roster and guard clearance checks.
- **Item count.** The first round now has 28 items (26 when unarmed). Contracts recorded earlier keep their saved checklist.

## Database

There is no new table and no migration. These are new optional JSONB fields on existing rows, and both tables are behind the company wall:

- `diligence` on `prima.client_accounts`;
- `instructions` on `prima.sites`.

## Tests

- Core: `packages/core/test/client-quality.test.ts` covers:
  - roles and who decides;
  - a concern needing conditions;
  - a declined client, the review falling due, and a second round;
  - post duties being required;
  - a material change versus a small correction;
  - Operations and other-company access;
  - guards being refused.

  `contracts-real-use.test.ts` now also checks both new automatic items.
- PostgreSQL with row-level security: `apps/api/test/client-quality-pg.test.ts`.

## Decided by Fauzan (5 Nov 2026)

- The seven checks and the 12-month review: approved.
- A concern: the company manager decides alone, with written conditions. No COO step.
- Guards: they do not see assignment instructions in Prima. Officers brief them.
