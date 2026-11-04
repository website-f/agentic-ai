# CEO company master onboarding — Arisha phase 1

**Status:** proposed code-only implementation. This adds a single company form; it is NOT permission to enter sensitive personal/financial data or automatically import files.

## What this PR enables
- The CEO opens **Group today → Companies**, clicks **Verify company** against an existing row, and enters company-level SSM details with a source document reference.
- Arisha's `record_form` / `prepare_record` can now prepare a `company` draft with `companyId` from the existing company selector; the existing CEO Save action updates the same company.
- An update **never creates a new company** and never changes immutable company ID/code, pilot status, existing cross-company links, personnel/contract mappings, or historical company references.
- Records capture company name, SSM number, incorporation date, registered/business address, main state, head of company, source document reference and manual CEO verification state. `verifiedBy`/`verifiedOn` are set by the authenticated service (not by AI text).
- Require SSM reference and source document, block duplicate SSM numbers or duplicate registered names, and disallow a verified status without incorporation date and registered address.
- Every update is an audited `record.edit.company` event. Finance Director, COO and ACT Director still get **AI chat only** and cannot modify company master records.

## Constraints
- Seeded company IDs represent existing mock scaffolding, **not** verified actual companies. Never delete and recreate a company to fill real data; changing the fixed company code is outside this feature.
- This first stage does **not** add a PDF parser, spreadsheet upload, source-document attachment, SSM portal API verification, or company shareholding/financial account/IC fields. Source reference is a text citation to a document the CEO has checked separately.
- Do not fill fields with guesses. SSM data must come from company-authorized documents. No automatic 'verified' mark from an AI response.
- Real personal records remain blocked until the data-protection, departmental RLS, offboarding, backup and privacy issues in `docs/STAGING_PREPUBLICATION_REVIEW.md` are resolved.
- This feature is not deployed merely by merging the PR. Follow the controlled `Deploy staging` process, check schema compatibility and test with dummy data.
