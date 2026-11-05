# Screens: commercial (leads, tenders, quotations)

Status key: **Main**, **Candidate (#nn)**, **Main, extended (#nn)**. See [screens index](README.md).

---

## Tenders & quotes (`commercial`)

**Status:** Main, extended (#52 and #63 small additions).

**Purpose.** The company admin desk for bidding papers, tenders and quotations, with the Director Office's protocol.
Bids are always in the licensed company's own name and gated by its own KDN licence, insurance and (for government) MOF
registration.

**Who sees it.** Group leaders, the Director Office, company managers and admin executives.

### Can this company bid today?

A panel at the top: KDN licence, insurance, MOF registration and other papers. An expired or missing paper blocks the bid
(`COM-TENDER-ELIGIBLE`); an expired security licence blocks new contracts (W15).

### Leads and client research

Before quoting, research the prospect: SSM search (company is live), payment record, current provider, risks, and a site
survey. A slow or unknown payer needs the company manager to **Accept** the risk. A lead another group company is chasing
shows as a conflict. A branch may originate a lead; the licensed company still contracts. Actions: **New lead**, **Save
research**, **Save survey**, **Link** a quotation, **Mark won** (needs an accepted quotation), **Lost to another**, **We
dropped it**. Leads idle 14 days are flagged.

### Tenders

Statuses: open, preparing, submitted, won, lost, no bid. For one tender:

- **Tender record and mandatory dates** (**Edit record**), with priority by the nearest buyer date: URGENT at 3 days or
  less, SHORT WINDOW at 7.
- **Papers**: **Upload papers** (notice, arahan petender, specification, forms).
- **Checklist**: drafted by the AI agent from the papers and **confirmed** by the Director Office Administrator. Only a
  tender whose checklist is checked is sent to companies.
- **Decision**: Teruskan, Tangguh (needs clarification) or Tidak layak / tidak bida, with the reason; the company manager
  or Director Office decides.
- **Price check**: average contract revenue per guard-hour from the indicative price, with reduction scenarios. Not a
  wage and not an approved bid.
- **Questions to the buyer** in writing: to send, sent waiting, answered.
- **Tender protocol**: every step in its guide section, ticked with who did it and when; untick a mistake before the bid
  is signed. A tender cannot move on with a step not done. The Director Office Administrator **Edit protocol** (add,
  remove steps).
- **Bid files**: each file named as the tender asks (TEKNIKAL, KEWANGAN, HARGA, LAIN); the app refuses a wrong name or a
  technical file whose text or properties carry the company name; the preparer confirms each technical file was checked
  page by page.
- **Signatures and submission**: the preparer signs, the company manager signs that all is verified, then **Record
  submission** with the slip. **Send back** returns it.
- Outcome: **Start preparing**, **Decide no bid**, **Mark won**, **Mark lost**.

### Joint tenders

The Director Office sets which companies enter the same tender (**Enter more companies**) and **Send to the companies**.
Each company's admin executive fills its own bid and its company manager verifies it with the submission slip. The
Director Office keeps the proof (steps, document names, slip). The CEO gets the report 24 hours after closing.

### Quotations

Statuses: draft, waiting for approval, returned for changes, approved not sent, sent to client, accepted, rejected.

- **New quotation** / **Prepare quotation** (from a tender) and **Save draft** (admin executive).
- **Correct guards, rate or date** on a draft or returned quotation, with a reason; every change is audited.
- **Send to manager for approval**; the company manager **Approve**s within written authority or **Return for changes**.
  The preparer never approves their own.
- **Mark sent to client**, **Client accepted**, **Client rejected**.
- No automatic pricing until costing rules are approved.
