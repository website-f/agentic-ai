# SharePoint files as proof, by link

Fauzan, 4 Nov 2026, staff usability rule 6: "SharePoint files by link, no copies." Every department and every company keeps its own SharePoint (Fauzan, 1 Nov 2026). When a step in Prima needs proof, staff can paste the link of a file that already sits there instead of uploading a copy.

## What staff see

Every proof box (cases, follow-ups, leave, claims, HR file, FWM, SOCSO, hostels, fleet, PDPA, clients, purchasing, reports, IT jobs, IT tenders and the rest that use the shared proof box) now has **Paste SharePoint link** next to **Attach document** and **Take photo**.

1. In SharePoint, open the file, choose **Copy link** and pick **People with existing access**. The plain address from the browser bar also works.
2. In Prima, press **Paste SharePoint link**, paste, press **Add link**.
3. The proof list shows the file name with "SharePoint link (opens in SharePoint)". Pressing the name opens the file in a new tab. Microsoft checks there whether that person may see it.

The screen text is in the BM, BM+English and English tables (`apps/web/src/i18n.ts`). The test link has **Use a test SharePoint link**, which adds a made-up `example.sharepoint.com` address that opens nothing real.

## What Prima keeps

Only the cleaned link, the file name taken from it, who gave it and when. No file content, no copy, no download, no sharing token. The record sits where an uploaded document would (`evidenceDocs` behind the company wall, or the IT record), with `mime: 'text/uri-list'`, `data: ''`, `bytes: 0`, `link: <cleaned link>` and a fingerprint of the cleaned link, so the same link cannot be given twice where the same file could not.

On IT boards the link is hidden like the file itself. It is fetched one at a time through the existing proof-opening action, which checks who may open it and writes "Opened the SharePoint link …" to the audit trail.

## What a link must be

Checked twice, on the phone for a quick answer and again on the server (`packages/core/src/proof-link.ts`). Nothing is fetched, no DNS lookup, no Microsoft call.

| Accepted | Refused |
| --- | --- |
| `https://<host>.sharepoint.com/sites/<site>/<library>/…/<file.ext>` (also `/teams/`) | Any other host, `http`, user/password, port |
| "People with existing access" links `/:b:/r/sites/…` (turned into the plain path) | Sharing links that carry access (`/:b:/s/…`, `/:w:/g/…`): the person is asked to copy the "People with existing access" link instead |
| Office viewer `…/_layouts/15/Doc.aspx?sourcedoc={id}` (kept by its id only) | Personal OneDrive (`<name>-my.sharepoint.com`): save the file in the department or company SharePoint |
| | Folders, libraries, `Forms/AllItems.aspx`, site pages, settings and `_api` addresses |
| | Dot segments (`/../`), encoded slashes (`%2F`, `%5C`), spaces, control characters |

Tracking values (`?csf=1&web=1&e=…`) and `#` parts are dropped.

### Narrowing to the group's SharePoint

Server setting `SHAREPOINT_PROOF_HOSTS`: a comma-separated list such as `<tenant>.sharepoint.com`. Unset means any company SharePoint host is accepted (a personal OneDrive never is). Once IT confirms the group's host name, set it so links from other organisations are refused. If it is set but no entry is a valid SharePoint host, every link is refused rather than any host accepted. No secret is involved.

## Where links are not offered

Steps that need the file itself keep upload only:

- Tender bid files (checked for the company name inside the file) and IT tender part files.
- Department report files accept either a file or a link; company report files go through the shared proof box.

For tender technical steps, a linked file's name is checked for the company name the same way an uploaded file's name is.

## What this does not do

- It does not connect Prima to SharePoint. The SharePoint Connections page (`docs/CONNECTIONS_SHAREPOINT_PILOT.md`) stays off by default and separate.
- It does not prove the file exists, has the right content, or that the reader can open it. A checker who cannot open the link should send the step back.
- It does not change who can see a record in Prima, and it does not grant anyone access in SharePoint.
- No database change: proof records are stored in the existing tables (JSON rows).

## Tests

- `packages/core/test/proof-link.test.ts`: link cleaning and every refusal; IT job proof by link (stored without a copy, hidden on the board, opening logged, outsiders refused, same link refused again); host narrowing; a case step with a link.
- Also: a case raised without a site with a link (the raise-case screen used to drop anything that was not a document there), and company and department reports sent as links.
- `apps/api/test/proof-link-hosts.test.ts`: the `SHAREPOINT_PROOF_HOSTS` setting, including the refuse-all fallback.
