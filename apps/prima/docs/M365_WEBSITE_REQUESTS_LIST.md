# Website requests list in SharePoint: set-up guide

Status (23 Nov 2026): built and tested with synthetic data; off until its settings are on the server. Prima only
**reads** the list. It never writes to SharePoint, never sends mail and never retries on its own.

## What Prima reads

The reader is `sharepoint()` in `apps/api/src/web-connectors.ts`. It reads the newest 200 items of one list, with these
columns (other columns are ignored):

| Column | Used as |
| --- | --- |
| Title | Request title |
| Kind (or RequestType) | instruction, proposal or change (anything else counts as change) |
| Detail (or Description) | Request detail |
| Website (or SiteUrl) | Which website |

The person who created the item and its link come from SharePoint itself. If the list holds 200 or more items, the
read stops with "incomplete" instead of showing part of it, so archive old items.

## Set-up steps (joint set-up day, staging first)

1. IT creates the list "Website requests" on the one approved SharePoint site, with the columns above.
2. The IT admin registers one app in Entra for this reader, with **Sites.Selected** (application) and admin consent,
   then grants it read access to that one site only. No tenant-wide SharePoint permission.
3. The IT admin types the settings straight into the staging server:
   - `ENTRA_TENANT_ID` (already set for sign-in), `WEB_GRAPH_CLIENT_ID`, `WEB_GRAPH_CLIENT_SECRET`;
   - `WEB_REQUESTS_SITE_ID` in Graph's `hostname,site-guid,web-guid` form, and `WEB_REQUESTS_LIST_ID` (a GUID).
4. The CEO switches the SharePoint connector on in Prima's website connector settings (see `docs/WEBSITE_CONNECTORS.md`).
5. Check: add one test item to the list, run the website sync, and confirm it shows in Prima's website requests.

Secrets never go in chat or documents. Use `<approved-site-id>` and `<approved-library-id>` style placeholders when writing
about it.
