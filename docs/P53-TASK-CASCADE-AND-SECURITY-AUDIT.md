# P53: deleting a stopped task, and a full security audit

## The task that could not be deleted

Stopping or cancelling a task did not touch the sub-tasks it had started, so they stayed open
and blocked deleting the task ("A sub-task of this work is still open").

- **Cancelling a task now cancels its open sub-tasks** too, its whole tree however deep
  (`tasks._cancel_open_descendants`): each live run is stopped (best effort) and the row is
  marked cancelled either way, so nothing is left running.
- **Delete offers to clear them**: when sub-tasks are still open, the task sheet asks "Cancel
  its open sub-tasks and delete?" and deletes with `DELETE /api/tasks/{id}?cascade=true`.
- Kept on purpose: a task that is a live step of a running *workflow run* still asks you to
  cancel that run first (deleting one step would break the run).

## Security audit

Three read-only reviews (access control and tenant isolation; injection and untrusted input;
secrets, sessions and logic). Every finding below was checked against the code before it was
fixed, and each fix has a test.

### Fixed

| Severity | Issue | Fix |
|---|---|---|
| High | A manager could steer a staff member's twin into their Outlook, PC and Teams by revising its work, editing its brief, or editing or running its schedule (the task still said the owner asked). | Only the owner may give their own AI new instructions (`_guard_personal_instruction`, `_guard_schedule_owner`). |
| High | Staff could author blueprints and apply them to loosen their own twin, or rewrite blueprints managers apply to company agents. | Blueprints are created, changed, deleted and applied by `agents.manage` only (the page was already manager-only). |
| High | Two people approving or paying the same bill at once could record the payment twice. | A row lock on the money endpoints that change it (approve, payment, void, sent, correct); the status is re-checked after the lock. |
| Medium-high | Any staff member could change or delete any company's workflows, isolated companies included. | A company-scoped role changes only its own company's; staff change only workflows they made. |
| Medium | Office or shared-mailbox work on a twin used its owner's mail, PC and Teams. | A twin is never a shared mailbox's agent, and only work its owner set going gets those tools. |
| Medium | Any staff member could change or delete any company's document templates, and the built-in ones. | Scoped to their own company; built-in templates need an owner or admin. |
| Medium | A changed storage address, or a saved login's new sites, kept the saved password, which was then sent there. | Changing the address or sites needs the password typed again (as for AI provider keys). |
| Medium | A value from a web form or another system could run as a formula when the CRM export was opened in a spreadsheet. | Cells starting like a formula are quoted (`csv_safe`), in the CRM and report exports. |
| Medium | On "auto", an agent could send a Teams message steered by text it had just read. | `teams_send` always waits for the person. |
| Low | An operator could open up restricted (pay, HR) documents to the whole company. | Opening one up needs a manager. |
| Low | A CRM connector sent its key to wherever the remote API's "next page" link pointed. | Paging stays on the same server. |
| Low | The PC agent linked over plain http and kept remote control when moved to another server. | https only (except on the same machine); moving server starts with remote off. |
| Low | A non-object JSON body crashed the OpenAI-compatible API (500); a new member's temporary password could be cached. | A 400; `no-store`. |

### Reported, not changed (a decision or a larger change)

- **Agents on "auto" and outside content.** After an agent reads an email, chat or web page,
  other tools that send data out (`web_fetch`, browsing) still run on "auto". Teams sending is
  now guarded; a general rule that downgrades "auto" to "ask" after outside content is a
  behaviour change to decide on.
- **The local AI's address is allowed through the SSRF guard on any port and path** (the
  server's own `ollama`). Narrowing it to the model API needs care so the local model keeps
  working.
- **Storage targets (S3, WebDAV) do not go through the SSRF guard** (owners and admins only).
- **Read-only workspace roles can list staff members' "My workspace" files.** Partly by design
  (the owner sees them); tightening it for viewers, approvers and operators is a policy choice.
- Lower: link-code guessing is not throttled on the install routes; CRM auto-numbers can repeat
  under concurrent creates; the PC status page key travels in the URL; action-token encryption
  is bound to the approval rather than the delivery.
