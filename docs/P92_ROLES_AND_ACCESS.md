# P92: Roles and access, management and HR, correcting a name or email

## The roles and what each can do by default

Two roles are new: **Management** and **HR**. Both see the whole workspace, like an admin, and
can do everything an admin can **except** the AI engine (seeing or changing it), file storage
and MCP tools. They can never make anyone an owner or reach owner-only things (Roles and access,
erasing or exporting the workspace, the developer's Feedbacks page, two-step sign-in rules).

| Area (permission) | Owner | Admin | Management | HR | Branch manager | HOD | Supervisor | Staff | Operator | Approver | Viewer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AI engine: see (`engine.view`) | yes | yes | – | – | – | – | – | – | yes | yes | yes |
| AI engine: change (`engine.manage`) | yes | yes | – | – | – | – | – | – | – | – | – |
| File storage (`storage.manage`) | yes | yes | – | – | – | – | – | – | – | – | – |
| MCP tools (`mcp.manage`) | yes | yes | – | – | – | – | – | – | – | – | – |
| Members and roles (`members.manage`) | yes | yes | yes | yes | – | – | – | – | – | – | – |
| Their own team (`team.manage`) | – | – | – | – | yes | yes | – | – | – | – | – |
| Organisation settings (`org.manage`, `org.read`) | yes | yes | yes | yes | – | – | – | – | read | read | read |
| The whole office (`office.view`) | yes | yes | yes | yes | yes | yes | yes | – | yes | yes | yes |
| Give work to the AI (`work.write`) | yes | yes | yes | yes | yes | yes | yes | yes | yes | – | – |
| Approvals (`approvals.decide`) | yes | yes | yes | yes | yes | yes | yes | yes | – | yes | – |
| AI team and agents (`agents.manage`) | yes | yes | yes | yes | yes | yes | – | – | – | – | – |
| Brain and learning (`brain.manage`) | yes | yes | yes | yes | – | – | – | – | – | – | – |
| Money: see / change (`finance.view`, `finance.manage`) | yes | yes | yes | yes | own company | – | – | – | – | – | – |
| Library files and saved logins (`vault.manage`) | yes | yes | yes | yes | yes | yes | – | – | – | – | – |
| Channels (`channels.manage`) | yes | yes | yes | yes | – | – | – | – | – | – | – |
| Audit log (`audit.read`) | yes | yes | yes | yes | – | – | – | – | – | – | – |
| Private assistants (`assistants.use`) | yes | yes | yes | yes | yes | yes | yes | – | – | – | – |
| Own AI twin (`agents.own`, `vault.own`) | – | – | – | – | – | – | – | yes | – | – | – |
| Owner only: making owners, Roles and access, CRM (shared part by part), erasure | yes | – | – | – | – | – | – | – | – | – | – |

The table lives in code in `apps/api/agentic/core/security.py` (`PERMISSIONS`). Scopes: owner,
admin, management, HR, operator, approver and viewer see the whole workspace; a branch manager
their branch, a HOD and supervisor their department, staff their own work.

Two rules that always hold:
- **Nobody but an owner gives a role with more access than their own.** Management cannot make
  an admin, an operator, an approver or a viewer (those see the AI engine), so they cannot reach
  the AI engine through someone else. They can add and change management, HR, branch managers,
  HODs, supervisors and staff.
- If the workspace asks "owners and admins" for two-step sign-in, **management and HR are asked
  too** (they manage members and passwords). Settings > Security changes that rule.

Prima: management and HR open Prima like admins do: through their own Prima staff record (linked
by their Microsoft account), else their own Prima account as central staff (`pwvsb_officer`). The
Prima role map was not widened. If Prima says it does not know their company, the owner links them
on the Prima page (People in Prima).

## Changing what a role may do

Settings > **Roles and access** (owner only). Rows are areas in plain words, columns are roles.
Turn a switch on or off and press **Save changes**. A dot marks every switch that differs from
the default; "Reset to defaults" undoes everything. On a phone: pick a role, then switch areas.

- It applies to everyone in that role **from their next click** (the server reads it on every
  request; their menu follows within a minute or on reload).
- The owner role cannot be changed; owner-only powers can never be given; "sign in and read" can
  never be taken away. Every change is written to the audit log (`org.role_access_changed`).
- Saved in the workspace settings as `role_permissions = {role: {grant: [...], revoke: [...]}}`.

## Correcting a name or email

Members page > a person's **⋯** menu > **Change name or email** (people who can manage members;
only an owner corrects an owner; never someone with more access than you).

- A new **name** changes only the name (and their Prima account's name on their next Prima visit).
- A new **email** (must be unused) also: signs them out everywhere, lets go of the Microsoft
  account the old email was linked to (their Outlook connection is disconnected and the mail it
  synced is removed) and clears their Microsoft link. They sign in again with the new email, by
  password (unchanged) or **Sign in with Microsoft**, which then links the account of the new
  email, here and in Prima. Their own Prima account keeps its id (their Prima history stays) and
  is relinked to their staff record from the new email; a Prima link that was found from the old
  Microsoft account or the old name is removed and found again. A Prima link the owner set by
  hand stays.
- **Reset Microsoft link** (same menu, when they are linked) does the same without changing the
  email: use it when the wrong Microsoft account got linked.
- Every change is in the audit log (`member.identity_changed`, `member.microsoft_reset`).

The owner changes their own email in **Settings > Change your sign-in email**, with their current
password (or right after a Microsoft sign-in, within ten minutes). Their other devices are signed
out; this one stays.

## First 10 members tomorrow: a checklist for Fitri

1. Settings > Members and roles > **Add member** (or Import): pick **Management** or **HR**.
   Check each email carefully; a wrong one can be corrected afterwards (⋯ > Change name or email).
2. Settings > **Roles and access**: look at the Management and HR columns. By default they have
   everything except AI engine, File storage and MCP tools. Turn anything off you do not want
   them to have yet (for example Money: change, Audit log), then **Save changes**.
3. If Settings > Security asks owners and admins for two-step sign-in, they will be asked too on
   their first sign-in (an authenticator app). Turn it to "off" first if you want to test without it.
4. Each person signs in with **Sign in with Microsoft** using their work email (easiest), or with
   their email and the one-time password from the add screen (or the emailed one, once sign-in
   emails are on); they set their own password on first sign-in.
5. Ask one of them to open the Members page and the AI Engine: the Members page opens, the AI
   Engine is not in their menu and its address sends them back.
6. If someone landed on the wrong Microsoft account: ⋯ > **Reset Microsoft link**, then they sign
   in with Microsoft again.
