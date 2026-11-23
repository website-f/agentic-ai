# Office assets (Part S, in force 18 November 2026)

Source: the maintenance unit's circular and policies (Fitri package Part S1-S84) and Fauzan's answers S-X1..S-X35
(13-14 Nov 2026). Rule `AM-OFFICE` in `packages/core/src/rules.ts`; every number there is a setting the maintenance unit
changes with a reason. Service: `packages/core/src/office-am-service.ts` (one door, `officeAmAct`). Database module:
`db/modules/office-am-v1.sql` (not on the release list; the CEO installs it).

## Who does what

| Step | Who |
| --- | --- |
| Report office damage | Any office staff member (Claims and requests > Penyelenggaraan pejabat) |
| Check, visit, quotes, start, finish, close | The maintenance unit (Asset Management staff) |
| Approve a job | Asset Director, then the Vice Chairman consents, then the CEO above RM50,000 |
| Buy new furniture, fittings, air-cond, signage or renovation | The company manager, GM or a head office officer asks (Claims and requests > Beli baru / renovasi); the unit looks for a spare first, then gets 3 shop quotes and 2 online prices; the Asset Director recommends; the operations head approves (Operations Director for private-sector companies, OGM for Government Operations, Chief of Staff for head office); the CEO also approves above RM50,000 (Fauzan, 23 Nov 2026). Then the same work, confirm, pay and close steps as a repair. Needs `db/modules/office-am-buy-v1.sql` after office-am-v1 |
| Confirm the work | The person who asked (the Asset Director may stand in after day 5, with a reason) |
| Pay | Finance, in its own payments screen, never above the approved amount |
| Inventory updates | Office head and named admin executives send, the unit checks, the Asset Director confirms, the unit files |
| Disposal | Anyone in the office asks; the unit inspects; the Asset Director approves; the Vice Chairman consents at RM10,000 book value, any sale, or a gift/transfer outside the group; Finance records sale money |
| Building purchase | The CEO, Chairman or Vice Chairman instructs; the buying company, Finance and the unit record each stage; Finance covers the gap, the down payment and links the loan; the unit registers |
| Office rent | The rental PIC (Asset Management, or a managing company under an active agreement) checks the tenant and the invoice, records what arrives and banks it; Finance numbers the invoice in SQL Account and marks it paid after matching the statement |
| Visits | The unit plans, the Asset Director approves the schedule, the office representative confirms access |

## Rules that never bend

- No work before the final approval. Nobody approves, checks or confirms their own work.
- Every approval and every changed setting needs a reason.
- Targets are alerts, never a block.
- Prima records only: it never moves money, never applies to a bank, never numbers a rent invoice.
- A cheque that fails the 7-point check is returned, never banked. Rent is banked into the owner company's account only.
- IT devices go to IT (repairs as IT tickets; disposals through the IT data-wipe process). New IT items are bought through IT, never as an office buy.
- Pens, paper and files stay an office request (company manager, Chief of Staff, COO); furniture and renovation never go there.

## Not connected yet

SharePoint copy (a CSV download is logged meanwhile) and email notices (in-app only) wait for their connections.
