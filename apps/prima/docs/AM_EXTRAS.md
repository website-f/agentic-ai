# Asset Management extras (rule AM-EXTRAS, proposed)

Fauzan, 5 Nov 2026 (third audit, item 4: "Build"). Six new tabs on the Asset Management screen. Made-up data only.
Nothing here is merged, migrated or deployed.

| Tab | What it does | Who acts |
|---|---|---|
| Contractors | The contractor list: SSM number (no duplicates), kinds of work, CIDB grade and end date, states. Shows jobs, spend, rating and on-time %. Flags an ended or ending CIDB registration, a low rating and work given to a contractor that is not approved. | The team adds and rates finished jobs. The Asset Director approves, suspends or blacklists with a reason, but not a contractor they added. |
| Finding tenants | A letting file for each empty unit, and each unit whose tenancy ends within 90 days: adverts, enquiries, viewings, offers, signing and lost reasons. When one enquiry signs, the others close as "unit let". Signing does not start billing; the tenancy is still added on the unit. | The team records. The Asset Director approves every offer, but not one they made. An offer under the asking rent needs a reason. |
| Meters | Every unit meter plus the resort, orchard and training-centre meters. A monthly reading needs a meter photo reference. A lower number is refused unless the meter was changed. Flags a reading not taken, a jump over 2x the usual, and use at an empty unit. Owner-paid bills are recorded once a month. | The team. Finance pays the bills. |
| Resort bookings | Free rooms for the next 14 nights. A booking can never take more rooms than there are, and a resort lock stops two people selling the last room. An outside booking is held 3 days, confirmed with a 30% deposit and paid in full before check-out. A group booking is billed to its company. A price under the list needs a reason. | The team books. The Asset Director sets the rooms and price list. Finance confirms payments in the bank. |
| Harvest | Each pick (kg plus a photo on the scale) is fully accounted for as sold, spoiled or kept. Every sale needs a weighing slip. Flags a price 20% under the crop's 30-day average, more than 10% spoiled, more than 5% kept or given away, and unpaid credit sales. | The team. Finance confirms cash and transfers in the bank. |
| Planned maintenance | Repeating jobs, some marked as required by law or licence (BOMBA fire equipment, the DOSH lift, the septic tank). "Raise due work orders" makes one work order per job due within 14 days, only once. A finished work order moves the plan on. | The team. Only the Asset Director pauses a statutory job. |

All six areas are visible to the team, to group leadership and to the finance staff who oversee Asset Management. Overseers do not see phone numbers. No group company sees any of it. Every step is checked on the server and written to the audit log.

## Resort front desk (added 5 Nov 2026, after research)

The resort screen now follows how hotels usually run their front office. The research and sources are in `docs/AM_RESORT_PRACTICE.md`.

- **Numbered rooms and chalets.** The Asset Director's room counts create numbered rooms (R01, C01 and so on). Each room is dirty, cleaned or inspected. A guest goes only into a room that is not dirty. Check-out leaves the room dirty. The person who cleaned a room cannot be the one who inspects it.
- **Out of order.** A room can be taken out of sale for given dates, with a reason. It is not sold on those nights, and it cannot be taken out if that would oversell a booked night or if a guest is in it.
- **Guest register.** Check-in records the guest's ID type, ID number and nationality (Innkeepers Act 1952 requires a register), and the room numbers. Only the Asset Management team sees the ID number; overseers see it masked.
- **Bill (folio).** Room charges, extras (meals, extra bed, activities, with a minus line to correct and a reason), service tax, tourism tax for foreign guests, and the state fee. The tax rates are copied onto the booking when it is made, so a later change does not alter an existing bill. Check-out needs the full bill paid.
- **Daily report**, like a night audit: rooms to sell tonight, sold, occupancy, average rate (ADR), revenue per available room (RevPAR), arrivals, departures, in-house, bookings that did not arrive, money taken today by method, unpaid in-house balances, and the month's service tax, tourism tax and state fee from stays that ended, for Finance to file.

- **House rules, set in the app** (Fauzan, 5 Nov 2026: "All four question need to be set in app"). The Asset Director sets, per resort: whether the company is registered for service tax (if not, none is charged), the MOTAC registration number and expiry (warned 60 days ahead), check-in and check-out times (a guest past check-out time is flagged), and the cancellation and no-show terms (free cancellation days, % kept for a late cancellation, % kept for a no-show). New bookings copy the terms; existing bookings keep theirs. On a cancellation or no-show the app works out what is kept and what is owed back; the team records the refund, and Finance confirms it in the bank. Every change is audited.

Sample tax rates are 8% service tax, RM10 tourism tax per room-night for foreign guests and RM3 Pahang Lestari fee per room-night. They come from published guidance and are not confirmed. Finance must check them with Customs and the state before real use.

## Database

The tables are in an optional module, `db/modules/am-extras-v1.sql`, with six jsonb tables under the Asset Management wall and no DELETE grant. It must be applied in a separately authorized migration window. Until then, the API reads nothing, refuses saves with a plain message, and the screen says "Not set up". The readiness check is `apps/api/src/am-extras-readiness.ts`.

## For Fauzan to confirm

All numbers are proposed: the 30-day CIDB warning, low rating under 3, advert within 7 days, enquiry next step within 3 days, letting from 90 days before the end, monthly meter reading and the 2x jump, the 3-day hold and 30% deposit, the sample tax rates and whether each resort is registered for service tax, the 20% price drop, 10% spoilage and 5% kept, and the 14-day lead for planned jobs.

## Links to other work

PR #82 (BQ and quotes) still takes the contractor name as free text. Once both PRs are in, quotes can be limited to approved contractors.
