# Microsoft 365 / Outlook: setup guide for your Microsoft 365 admin (P34)

This guide is for the person who administers your company's Microsoft 365 (Entra ID and
Exchange Online). It takes about 15 minutes for personal Outlook, plus about 15 more if you
want the office to work through shared mailboxes such as `accounts@` or `tender@`.

Everything below uses placeholders. Replace them with your own values:

| Placeholder | What it is | Where to find it |
|---|---|---|
| `https://office.example.com` | The address of your Agentic Office server | Your browser's address bar |
| `<redirect-uri>` | Where Microsoft sends people back after sign-in | **Channels > Microsoft 365** card, "Redirect URI (Web)" (copy button) |
| `<notification-url>` | Where Microsoft pushes "new mail" notices | Same card, "Notification URL" |
| `<client-id>` | The app's Application (client) ID | Entra: the app's **Overview** page |
| `<tenant-id>` | Your Directory (tenant) ID | Entra: the app's **Overview** page |
| `<sp-object-id>` | The Object ID of the app's **Enterprise application** (service principal) | Entra: **Enterprise applications** > the app > **Overview** |
| `accounts@company.com` | A shared mailbox the office should read | Exchange admin center |

---

## What the office does with Microsoft 365

* **Each person's own Outlook** (delegated access). A person connects their own mailbox and
  calendar from **My AI** (or **My assistants** for managers). Their AI reads new mail, sorts
  it, turns invoices and requests into tasks, and drafts replies and calendar events. **Nothing
  is sent or booked until that person approves it** on the Drafts list.
* **Shared mailboxes** (application access, optional). An admin adds a shared mailbox on
  **Channels > Microsoft 365**, picks the company and the agent that handles it, and chooses
  what becomes a task (invoices, customer requests, tenders, complaints, internal mail),
  whether attachments are saved to the Library, a daily digest time and a follow-up reminder.

The office uses **Microsoft Graph** for all of this. Microsoft is retiring Exchange Web
Services (EWS) in Exchange Online (announced for October 2026; check the Exchange Team blog for
the current dates), and Graph is the supported replacement, so nothing here depends on EWS.

---

## Step 1. Register the app in Microsoft Entra

1. Sign in to the **Microsoft Entra admin center** (https://entra.microsoft.com) as at least an
   *Application Administrator* (granting consent later needs a *Privileged Role Administrator*
   or *Global Administrator*).
2. Go to **Entra ID > App registrations** and press **New registration**.
3. **Name**: something your staff will recognise on the consent screen, e.g. `Agentic Office`.
4. **Supported account types**:
   * **Accounts in this organizational directory only (Single tenant)**: the usual choice for
     one company. On the office's card, choose **Only our company** and enter your
     `<tenant-id>` (or your domain, e.g. `company.com.my`).
   * **Accounts in any organizational directory (Multitenant)**: only if staff sign in from
     several Microsoft 365 tenants (e.g. a group of companies with separate tenants). On the
     card, choose **Any work account** (tenant `organizations`). See *Publisher verification*
     below.
   * Personal Microsoft accounts (outlook.com, hotmail.com) are **not** supported.
5. **Redirect URI**: platform **Web**, value = the `<redirect-uri>` from the card, for example
   `https://office.example.com/api/integrations/microsoft/callback`. It must match exactly
   (scheme, host, path, no trailing slash differences).
6. Press **Register**. On the **Overview** page, copy the **Application (client) ID**
   (`<client-id>`) and the **Directory (tenant) ID** (`<tenant-id>`).

## Step 2. Create a client secret

1. In the app, open **Certificates & secrets > Client secrets** and press **New client secret**.
2. Give it a description (e.g. `Agentic Office 2026`) and an expiry. 12 months is a sensible
   default; Entra allows up to 24 months.
3. Copy the secret's **Value** immediately. Entra shows it only once. (The **Secret ID** next to
   it is *not* the secret and will not work.)
4. **Rotation**: put the expiry date in a shared calendar. A few weeks before it expires,
   create a second secret, paste it into the card (**Change app registration**), confirm mail
   still arrives, then delete the old secret in Entra. When a secret expires, every
   connection stops until a new one is saved, and people see "Reconnect Outlook".

## Step 3. API permissions (Microsoft Graph)

In the app, open **API permissions > Add a permission > Microsoft Graph**.

**Delegated permissions** (for each person's own Outlook), all required:

| Permission | Why |
|---|---|
| `openid`, `profile`, `email` | Sign the person in and know which account they connected |
| `offline_access` | Keep the connection working without signing in every hour (refresh token) |
| `User.Read` | Read the person's name and email address |
| `Mail.ReadWrite` | Read mail and save reply **drafts** in their mailbox |
| `Mail.Send` | Send a draft **after the person presses Send** in the office |
| `Calendars.ReadWrite` | Read their calendar and create events **after they confirm** |

**Application permissions** (only if you will use shared mailboxes):

| Permission | Why |
|---|---|
| `Mail.ReadWrite` | Read new mail in the shared mailboxes and save drafts there |
| `Mail.Send` | Send an approved reply from the shared mailbox |

Then press **Grant admin consent for <your organisation>**. Alternatively, press **Grant
company-wide access for shared mailboxes** on the office's card: it opens Microsoft's admin
consent page for the same app and comes back to Channels.

Granting consent also creates the app's **Enterprise application** (service principal) in your
tenant, which Step 4 needs.

> Important: Application permissions granted in Entra apply to **every mailbox in your
> organisation**. Step 4 limits the app to only the shared mailboxes you choose. Do not skip it.

## Step 4. Limit the app to the shared mailboxes (RBAC for Applications)

Exchange Online **Role Based Access Control (RBAC) for Applications** lets you give the app
mail access to a defined set of mailboxes only. It replaced *Application Access Policies*
(`New-ApplicationAccessPolicy`), which should no longer be used for new setups.

The idea: put the shared mailboxes in a group, create a **management scope** for that group,
and assign the app the **Application Mail.ReadWrite** and **Application Mail.Send** roles
**within that scope only**.

1. **Make a group of the mailboxes.** In the Exchange admin center create a **mail-enabled
   security group** (e.g. `Agentic Office mailboxes`) and add each shared mailbox as a member.
   Then get the group's distinguished name:

   ```powershell
   Connect-ExchangeOnline
   Get-DistributionGroup "Agentic Office mailboxes" | Select-Object DistinguishedName
   ```

   (Microsoft also supports scoping by an Entra **administrative unit** instead of a group; see
   the Microsoft Learn article below.)

2. **Register the app's service principal in Exchange Online.** Use the Object ID of the
   **Enterprise application** (not the App registration's object ID):

   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <sp-object-id> -DisplayName "Agentic Office"
   ```

3. **Create a management scope for the group:**

   ```powershell
   New-ManagementScope -Name "Agentic Office mailboxes" `
     -RecipientRestrictionFilter "MemberOfGroup -eq '<group DN>'"
   ```

4. **Assign the roles, scoped:**

   ```powershell
   New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.ReadWrite" `
     -CustomResourceScope "Agentic Office mailboxes"
   New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" `
     -CustomResourceScope "Agentic Office mailboxes"
   ```

5. **Test it:**

   ```powershell
   # A shared mailbox in the group: the roles should show InScope = True
   Test-ServicePrincipalAuthorization -Identity <client-id> -Resource accounts@company.com
   # Someone's personal mailbox: InScope should be False
   Test-ServicePrincipalAuthorization -Identity <client-id> -Resource someone@company.com
   ```

   Permission changes can take a while to apply in Exchange Online (Microsoft documents a
   cache of up to about two hours). Press **Test** next to each mailbox on the office's card:
   it shows exactly what Microsoft answered.

6. **Remove the tenant-wide grant.** RBAC grants and Entra grants add up: while the app still
   holds the *Application* `Mail.ReadWrite` / `Mail.Send` permissions in Entra, it can reach
   every mailbox. Once Step 5 passes, go to **Entra > App registrations > the app > API
   permissions**, and for the two **Application** Mail permissions choose **Revoke admin
   consent** and **Remove permission**. Keep the **Delegated** permissions. RBAC is then the
   only thing that lets the app into the shared mailboxes.

> The cmdlet names and parameters above are an outline. Before running them, check the current
> Microsoft Learn article **"Role Based Access Control for Applications in Exchange Online"**
> for the exact syntax and any changes.

To add another shared mailbox later: add it to the group, wait for the change to apply, then add
it on the card and press **Test**. To stop the office reading one: remove it on the card and take
it out of the group.

## Step 5. Live mail (webhooks)

Microsoft Graph can push a notice to the office the moment mail arrives (a *change
notification*). For that, the `<notification-url>` must be:

* a **public https** address reachable from the internet (Microsoft calls it, not your browser),
* with a valid TLS certificate (not self-signed),
* and it must answer Microsoft's validation request quickly, which the office does by itself.

The card shows **Live** when the server has such an address. Otherwise it shows **Checks every
3 minutes**: the office polls instead, and everything else works the same, only a little
slower. Nothing needs to be configured in Entra for webhooks; the office creates and renews the
subscriptions itself (they expire after a few days by design).

## Step 6. Enter the values in the office

On **Channels > Microsoft 365** (owners and admins):

1. Paste the **Application (client) ID** and the **Client secret value**.
2. Choose **Who may sign in**: **Only our company** (enter the tenant ID or domain) or **Any
   work account**.
3. Press **Save Microsoft 365**. The secret is stored encrypted and is never shown again; to
   change it later, use **Change app registration** (leaving the secret blank keeps the saved one).
4. For shared mailboxes: press **Add mailbox**, enter the address, pick the company and the
   agent, set the rules, save, then press **Test**.

Each person then opens **My AI** (or **My assistants**) and presses **Connect Outlook**.

---

## Publisher verification (multitenant apps)

If you registered the app as **Multitenant**, people in other tenants see the app as
**unverified** on Microsoft's consent screen, and many tenants block users from consenting to
unverified multitenant apps at all. To avoid this, complete **publisher verification**: link a
verified Microsoft AI Cloud Partner Program (formerly MPN) ID under the app's **Branding &
properties**. A single-tenant app used only inside your own company does not need it.
Alternatively, an admin in each tenant can grant admin consent for everyone.

## What data is read and stored

* **Stored**: details about each mail (sender, recipients, subject, time received, the category
  the AI gave it, what it did: task, saved attachment, draft, reminder). Attachments are stored
  only when a shared mailbox's **Save attachments** rule is on, in that company's Library folder.
* **Fetched on demand**: message bodies are read from Microsoft when the AI needs them (to sort,
  summarise or draft), not kept as a copy of the mailbox.
* **Masked**: every call to an AI model goes through the office's privacy gateway, which swaps
  names, IDs, phone numbers, emails and company names for placeholders before anything leaves
  the server, and follows each company's data level (Standard, Confidential, Local only).
* **Approved by a person**: replies are saved as drafts and calendar changes as proposals. They
  are sent or booked only when a person presses Send or Confirm in the office.
* **Tokens**: each person's Microsoft refresh token and the app's client secret are stored
  encrypted on your server and never shown in the app.

## Disconnect and revoke

* **A person**: **My AI** (or **My assistants > Settings**) > Outlook > **Disconnect**. The office
  forgets their tokens and stops reading their mailbox. Drafts already in Outlook stay there.
  A person can also remove the app from their own Microsoft account at
  https://myapplications.microsoft.com.
* **One shared mailbox**: remove it on **Channels > Microsoft 365**, and take it out of the
  RBAC group.
* **The whole integration**, at any time, in your tenant:
  * **Entra > Enterprise applications > the app > Properties**: set **Enabled for users to
    sign in?** to **No**, or delete the enterprise application;
  * delete the client secret under **App registrations > the app > Certificates & secrets**;
  * remove the Exchange RBAC assignments (`Get-ManagementRoleAssignment -RoleAssignee <client-id>`
    then `Remove-ManagementRoleAssignment`).

## Troubleshooting

| What you see | Usual cause |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | The redirect URI in Entra is not exactly the one on the card (http vs https, host name, path) |
| `AADSTS700016` (application not found in the directory) | The tenant on the card is not the one where the app is registered, or the app is single tenant and the person is from another tenant |
| `AADSTS7000215` (invalid client secret) | The **Secret ID** was pasted instead of the **Value**, or the secret expired |
| `AADSTS65001` / "Need admin approval" | Your tenant does not let users consent: grant admin consent (Step 3) |
| Shared mailbox **Test** says access denied | The mailbox is not in the RBAC group or scope yet, the roles are missing, or the change has not applied yet (wait, then test again) |
| A personal mailbox **is** reachable with app access | The Entra *Application* permissions were not removed (Step 4.6) |
| People see "Reconnect Outlook" | Their password changed, consent was revoked, or the client secret expired |
| Card says "Checks every 3 minutes" | The server has no public https address; mail still arrives, just less instantly |
