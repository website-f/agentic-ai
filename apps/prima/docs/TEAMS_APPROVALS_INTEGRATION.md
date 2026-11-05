# Teams approval decisions in Prima: read-only integration design (PROPOSED, 1 Nov 2026)

Status: **design only**. Nothing here is built, configured, licensed or connected. No tenant permission, app registration, flow, credential, paid service or live setting has been created or changed. Every step marked *gated* needs Fauzan's and the Finance Director's approval (and the tenant admin) before anyone does it.

Why: Fauzan (1 Nov 2026) wants the check after payment to run automatically and to see the real Teams approval decisions, instead of decisions typed into Prima by hand (today's `FinExternalApproval`, `packages/core/src/finance.ts` `parseExternalApproval`).

## Sources checked
- Power Automate **Approvals connector** (learn.microsoft.com/en-us/connectors/approvals/): actions *Create an approval*, *Start and wait for an approval*, *Wait for an approval*; outputs `name` (approval ID), `outcome`, `completionDate`, `responses[]` (responder id/email/UPN/tenant, `requestDate`, `responseDate`, `approverResponse`, `comments`), `title`, `details`, `itemLink`. Listed as a Standard connector. Approval types include Basic and "Everyone must approve" (Await all); Basic/Await-all responses are case-sensitive "Approve"/"Reject". Timestamps are UTC. Throttle 50 creates per flow per minute.
- **Teams Approvals admin** (learn.microsoft.com/en-us/microsoftteams/approval-admin): approvals live in the **default Dataverse environment** (Approval, Approval Request, Approval Response tables); template responses live in **Microsoft Forms**; the default environment has **no backup**; audit through Microsoft Purview ("Microsoft Teams approvals activities") and Dataverse auditing on the approval tables; users see only approvals they sent, received or view.
- The Microsoft Graph **beta** `approvalSolution/approvalItems` API is **not used**: beta APIs are not supported for production.
- Not confirmed from these pages, so treated as open: whether the group's Microsoft 365 licences include Power Automate use of the standard connectors for the flow owner; Dataverse Web API access and licensing for reading existing approvals.

## Recommendation
Two separate tracks. Only track A is proposed for the next Finance slice.

### Track A: new approvals started for a Prima payment (recommended)
Revised 1 Nov 2026 after Arisha main's review: the outcome Prima trusts must come from a source staff cannot write, and a matching fingerprint plus a claimed approver ID is not proof on its own.

**Two lists, two writers.**
- **Requests list** (`Prima payment approval requests`): Finance staff add a row per payment: Prima payment ID, the fingerprint (below), company, payee, last 4, amount, SQL document, bank account, subject, required approvers. Staff can write here. **Prima never reads an outcome from this list.**
- **Results list** (`Prima payment approval results`), with **broken permission inheritance**: only the flow's service account can add items; Finance staff, site owners other than the tenant admin, and Prima have **read** at most; nobody gets edit or delete. Each row holds the approval `name` (ID), `outcome`, `completionDate`, every response (approver Entra object ID and UPN, response, comment, response time), the request item ID and its SharePoint version, and the fingerprint copied from the request at the moment the approval started.

**Flow (owned by the Finance service account; no human co-owner, see Revision 2).** Triggered when a Requests item is created: reads that item once (its ID and version), runs **Start and wait for an approval** with the request's fields in `details`, then **creates one new Results item** with the connector's own outputs. It never updates a Results item and never copies an outcome typed by a person. A change to the request after the approval started is ignored by the flow and caught by Prima (version and fingerprint).

**What Prima checks before it trusts a Results item (all must hold, otherwise not approved):**
1. **Author:** the item's `createdBy` and `lastModifiedBy` (Graph v1.0 `listItem` fields) are the flow service account's Entra object ID, held in Prima's configuration, not in the list.
2. **Never edited:** the item has exactly one version (Graph v1.0 `listItem/versions`); any later version, by anyone, makes it untrusted and raises an alert for the FD.
3. **Exact record:** the fingerprint equals the payment's fingerprint now; the request item ID and version it names exist, were created by a Finance user, and the request's fields hash to the same fingerprint.
4. **No replay:** each approval ID and each Results item ID is accepted once, for one payment; Prima stores them, and a second use for another payment (or the same payment after a change) is refused.
5. **Right people:** every required approver (FD or CEO for Finance; COO or CEO for the COO's departments) responded Approve with a comment, matched by Entra object ID against Prima's own user records; no preparer, reviewer of record or payee-detail editor among them.
6. **Complete:** `outcome` is Approve and `completionDate` is present; pending, cancelled, timed out, rejected, unknown or missing fields are not approved; a Reject from anyone blocks approval and release.
7. **Order:** the approval completed after the request version it names, and before Prima's approval and release.
These checks still rest on SharePoint permissions and on the service account. Optional stronger proof, for the FD to weigh: the flow adds an HMAC of the result with a key kept in Azure Key Vault (the Key Vault connector may be a premium connector; licence to confirm), and Prima verifies it.

**Prima reads (read-only, off by default).** Prima reads only the Results list (and the named request item for check 3) through Microsoft Graph **v1.0** with a **read** grant on those two lists only (`Lists.SelectedOperations.Selected`; see Revision 2, point 6: a `Sites.Selected` grant would cover the whole site). The read job is behind a switch, `TEAMS_APPROVALS_READ=false` by default, and stays off until Arisha main and the FD review it. When it is off, or a check fails, Prima shows the typed decision as today, labelled as typed.

**Approval is not payment.** A Teams approval never marks a payment as paid. Release is still recorded in Prima by a separate person after the bank portal check, and `finAfterPayment` still needs the bank statement line.

**Audit.** Prima stores the approval ID, Results item ID and version, request item ID and version, outcome, each response with approver object ID, comment and UTC time, the checks that passed or failed, and when it read them. Re-reading the same version changes nothing.

## Revision 2 (Arisha main's review, 1 Nov 2026 10:38Z): still disabled
A service-account author and one visible version do **not** prove an approval on their own. The changes below correct the earlier text; where they differ, this section wins.

**Authority stays in Prima.** A Teams result is corroborating evidence only. It never approves, releases or marks a payment as paid; the FD, the CEO or the COO (by subject) still approves in Prima with a comment. A trusted Teams **Reject** blocks; a Teams Approve never replaces Prima's own approval.

1. **Flow ownership can be edited.** Any owner of a flow can change its definition, add owners and swap connections ([Power Automate team flows](https://learn.microsoft.com/en-us/power-automate/create-team-flows)). So: no human co-owner (the FD is not a co-owner); the flow is solution-aware, in a dedicated non-default environment, created by the Finance service account; only one named administrator holds the Environment Maker role there; staff get run-only access at most; every flow change goes through change control and Purview audit. Residual risk, stated plainly: whoever controls the service account or that environment could write a false result. That is why the result is evidence, not authority.
2. **Version history is incomplete evidence.** Versioning can be switched off or trimmed, so "one version" ([list item versions](https://learn.microsoft.com/en-us/graph/api/listitem-list-versions?view=graph-rest-1.0)) is a tamper signal, not proof. Prima also stores, at first read, the item's ETag, `createdDateTime`, `lastModifiedDateTime` and a hash of every field; any difference at a later read voids the result and alerts the FD. A result whose versions cannot be read, or whose created and modified times differ, is not trusted.
3. **Exact current-record binding.** The fingerprint adds the payment's revision (each prepare or resubmit), so a returned-and-resubmitted payment needs a new request even with the same figures. Prima re-checks the fingerprint at every Prima approve and release, not only when it reads.
4. **Authoritative approver selection.** Approvers come from Prima's rules, never from the staff-written request: Prima computes the required approvers' Entra object IDs (FD or CEO for Finance; COO or CEO for the COO's departments). The flow writes the `assignedTo` it actually used into the result; Prima requires it to equal Prima's set exactly. Responses from anyone else are ignored for approval and flagged.
5. **Cancellation and revalidation.** When a payment is returned, cancelled, changed or its approval lapses (30 days), Prima voids any Teams result for it and shows "new Teams request needed". Staff mark the request Cancelled; the flow cancels the outstanding approval (the connector's approvals are cancelable) and writes a Canceled result. A result is re-read on every sync; one that disappears or changes is void. A result older than the lapse is not accepted.
6. **Correction: `Sites.Selected` is site-wide.** A site grant lets Prima's app read every list on that site; it does not limit Prima to two lists. Instead, use `Lists.SelectedOperations.Selected` with a **read** grant on the results list and the requests list only (granted with `POST /sites/{site}/lists/{list}/permissions`), and keep those lists on a dedicated site with nothing else ([selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)). Revocation is one `DELETE` of the grant or withdrawing consent.

**Further negative tests (in addition to 1-11 above):**
12. `assignedTo` in the result differs from Prima's required approvers (added, removed or swapped): not trusted.
13. An approval by someone outside Prima's required set, even an FD-level user of another subject: ignored for approval, flagged.
14. Versioning off or versions unreadable; created and modified times differ: not trusted.
15. A result's ETag or any field changes between two reads: voided, FD alerted.
16. Payment returned and resubmitted with identical figures: the old result no longer counts (revision changed).
17. Payment cancelled, or approval lapsed, after a Teams Approve: result voided; a cancelled approval's Canceled result never counts.
18. Prima approval or release attempted while the stored fingerprint no longer matches: the Teams result is shown as void; Prima's own rules still decide.
19. Prima's app reads another list on the same site: refused (list-level grant only).
20. A Teams Approve without a Prima approval in Prima: the payment stays unapproved.

Nothing here is approved for the tenant: no environment, flow, list, grant, consent or account has been created or changed.

### Track B: existing approvals made by hand in the Teams Approvals app (assess separately)
These are in the default Dataverse environment (template responses in Forms). Reading them needs Dataverse Web API access with an application user and a security role on the approval tables, plus a licence check. It cannot bind to a Prima record unless the request carried the Prima payment ID and fingerprint. Proposal: assess only after track A works; until then, staff keep typing the decision into Prima as today (`link`), and it stays labelled as typed, not read.

## Decision (Fauzan, 1 Nov 2026 11:04Z): both ways, the FD or the CEO chooses, never both
A payment is approved either in Prima or in Teams, as set by the FD or the CEO in Finance Settings (`approvalMethod`), fixed on each payment when it is prepared. When it is Teams, Prima has no approve button for that payment and the verified Teams result (checks above) is what records the approval; Prima still holds the approver set, separation of duties, the payment revision and the release. Until this connection is on, the Teams choice is refused and every payment is approved in Prima.

## Needed before a test (all gated; nothing done)
| Item | Owner | Note |
|---|---|---|
| Environment | Tenant admin + FD | Which Power Platform environment runs the flow (the default one is where Teams approvals live, with no backup); confirm data policy allows SharePoint + Approvals connectors together |
| Flow service account | FD + tenant admin | A dedicated Finance service account owns the flow and is the only writer of the Results list; no human co-owner (Revision 2); its object ID goes into Prima's configuration |
| Licences | FD + IT | Confirm the service account's licence covers standard-connector flows; the optional HMAC needs the Key Vault connector (licence to confirm) |
| SharePoint site and lists | IT Manager + tenant admin | Dedicated Finance site; Requests list writable by Finance staff; Results list with unique permissions: add for the service account only, read for others, no edit or delete; versioning on |
| Entra app for Prima | Tenant admin | App registration, `Lists.SelectedOperations.Selected` (application) with admin consent, then a **read** grant on the two lists only; certificate in Key Vault `kv-prima-staging-sea` |
| Prima code | Claude, as a PR | Read job behind `TEAMS_APPROVALS_READ` (off), checks 1-7, replay store, alerts, with the negative tests below |

## Acceptance test (dummy data, test site only)
One dummy payment (RM1.00, test payee) in a test company. Expected results:
1. Approved in Teams by the FD with a comment: Prima shows approved with the FD's object ID and time.
2. The amount is changed in Prima afterwards: the approval no longer counts.
3. A second request is rejected: approval and release are blocked.
4. A request left pending, and one cancelled: both show not approved.
5. A Teams approver who is not the FD, CEO or COO, or who prepared the payment: refused.
6. Release still needs the bank portal check, and the check after payment still waits for the statement.
7. **Forged outcome:** a staff member types "Approve" into a Requests row, or tries to add a Results row: Prima ignores the first; the second is refused by SharePoint, and if it ever appeared, check 1 (author) fails.
8. **Changed approved row:** the tenant admin edits a Results row in the test site: check 2 (one version) fails, Prima shows not approved and alerts the FD.
9. **Replayed decision:** a genuine Results row for payment A is pointed at payment B, or reused for A after A changed: check 3 or 4 fails.
10. **Unauthorised reader:** Prima's app tries another site or list, or to write: Graph refuses (no grant); a Finance user without access to the test site cannot read Results.
11. **Switch off:** with `TEAMS_APPROVALS_READ=false`, Prima reads nothing and shows typed decisions only.

## Cost and rollback
No premium connector is proposed. The Teams approval requires no new paid service if the licence check passes; the FD confirms before anything is switched on. Rollback: set `TEAMS_APPROVALS_READ=false`, turn the flow off and remove the site grant; Prima falls back to typed decisions, which stay labelled as typed.
