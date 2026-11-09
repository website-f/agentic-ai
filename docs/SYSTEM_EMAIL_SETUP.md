# Sign-in emails: setting up the system sender

*As of Nov 2026. Microsoft renames screens from time to time; the permission and cmdlet names below
are the ones Microsoft documents for Microsoft Graph and Exchange Online "RBAC for Applications".*

## What this does

- Someone who has **never signed in** and tries to sign in gets a **temporary password by email**
  (automatically, at most once every 10 minutes).
- Anyone in the office can press **Email me a sign-in password** on the sign-in page (first sign-in
  or a forgotten password).
- An owner or admin can email one person (Members, the person's menu) or **everyone who has not
  signed in yet** (Members, one button; about one email every 2 seconds).

The temporary password works **once**, for **24 hours**, and then the person chooses their own
password. It never replaces their current password: if someone else asks for one, the real
password keeps working. Nobody (not even the owner) ever sees the temporary password; it is only
in the email. Each address gets at most one email every 5 minutes and 5 a day.

People can also simply press **Sign in with Microsoft** and use their work account.

The emails are sent **as one mailbox** of your Microsoft 365 through the office's own Microsoft app
(the same app used for "Sign in with Microsoft", set on Channels > Microsoft 365). Nothing is
saved in that mailbox's Sent Items, and it never receives replies we read.

## Steps

### 1. Find the office's app

1. Open the **Microsoft Entra admin center** (https://entra.microsoft.com) as a Global
   Administrator (or Application Administrator + Exchange Administrator).
2. Go to **Identity > Applications > App registrations > All applications** and open the office's
   app (the one used for Sign in with Microsoft).
3. Copy the **Application (client) ID**.
4. Go to **Identity > Applications > Enterprise applications**, open the same app, and copy its
   **Object ID** (this is the *service principal's* Object ID; it is different from the Object ID
   on the App registration page).

### 2. Allow the app to send mail. Pick one way

**A. Quick way (the app can send as any mailbox in the company)**

1. In the App registration: **API permissions > Add a permission > Microsoft Graph > Application
   permissions**, tick **Mail.Send**, then **Add permissions**.
2. Press **Grant admin consent for <your company>** and confirm. The status shows a green tick.

**B. Safer way, recommended (the app can send only as the sender mailbox)**

Exchange Online "RBAC for Applications" gives the app Mail.Send for one mailbox only. Run in
PowerShell as an Exchange administrator (replace the address and the two IDs):

```powershell
Install-Module ExchangeOnlineManagement   # once per computer
Connect-ExchangeOnline

# The one mailbox the app may send as
New-ManagementScope -Name "Agentic Office sender" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'noreply@pwvsb.com'"

# Tell Exchange about the app (IDs from step 1)
New-ServicePrincipal -AppId "<Application (client) ID>" `
  -ObjectId "<Object ID from Enterprise applications>" -DisplayName "Agentic Office"

# Mail.Send for that one mailbox only
New-ManagementRoleAssignment -App "<Application (client) ID>" `
  -Role "Application Mail.Send" -CustomResourceScope "Agentic Office sender"
```

Check it (both should be as shown):

```powershell
Test-ServicePrincipalAuthorization -Identity "<Application (client) ID>" -Resource "noreply@pwvsb.com"
#  -> Application Mail.Send ... InScope : True
Test-ServicePrincipalAuthorization -Identity "<Application (client) ID>" -Resource "someone.else@pwvsb.com"
#  -> InScope : False
```

**Important:** permissions from Entra (way A) and from Exchange RBAC (way B) **add together**. If
you granted Mail.Send in Entra (way A) earlier, remove it (App registration > API permissions >
Mail.Send > Remove permission, and revoke the admin consent), otherwise the app can still send as
every mailbox. New assignments can take **30 minutes to 2 hours** to work everywhere.

### 3. The name "No Reply"

Microsoft shows the sending mailbox's **own display name** (the name typed in the office is
offered to Microsoft but Exchange uses the mailbox's display name). Two choices:

- **Recommended:** create a **shared mailbox** (free, no licence needed) in the **Exchange admin
  center > Recipients > Mailboxes > Add a shared mailbox**: display name **No Reply**, address
  for example **noreply@pwvsb.com**. Use this address in step 4, and in the step 2 B scope. Your
  own admin account stays separate.
- Or rename the display name of the mailbox you want to use (for example system.dev@pwvsb.com)
  to "No Reply" in the Microsoft 365 admin center. Everything that mailbox sends will then show
  "No Reply".

Optional: in the shared mailbox, set an automatic reply ("This mailbox is not monitored") so
anyone who replies anyway is told. The office already asks mail servers not to send automatic
replies back to it.

### 4. In the office

1. Sign in as the owner. **Settings > Sign-in emails**.
2. **Sender address**: noreply@pwvsb.com (or the mailbox you chose). **Sender name**: No Reply.
3. Turn on **Send sign-in emails**. Leave **First sign-in** and **Forgotten passwords** on (turn
   either off if you do not want it).
4. **Save**, then **Send a test email to me**. The test goes to your own address and has no
   password in it. If it fails, the message says why in plain words, for example:
   - "not allowed to send mail as ... yet": step 2 is not done (or not active yet: wait an hour);
   - "has no mailbox for ...": the address is wrong or the mailbox does not exist;
   - "did not accept the office's app": the app's client secret expired (Channels > Microsoft 365).

### 5. Let people in

- **Members** shows "N people have not signed in yet" and the button **Email sign-in passwords to
  everyone who has not signed in yet**. It asks to confirm, then sends in the background (about
  one email every 2 seconds, under Microsoft's limit of 30 a minute per mailbox) and shows sent,
  failed and skipped (switched off, no usable email, emailed in the last 5 minutes).
- Or do nothing: when a new person tries to sign in, they get their email automatically.
- One person: Members > the person's menu (...) > **Email a sign-in password**.

## Notes for the developer

- Setting: `Workspace.settings["system_mail"] = {enabled, address, from_name, first_login,
  forgot_password}` (`core/workspace_settings.py`).
- Code: `services/signin_mail.py` (codes, limits, bulk), `microsoft/sendmail.py` (Graph
  `POST /users/{address}/sendMail`, app-only token, `saveToSentItems: false`),
  `api/routers/signin_mail.py` (endpoints), migration `0054` (`users.signin_code_*`).
- The app-only token is asked from the app's tenant, the tenant an admin consented in, or else the
  sender address's domain (so a multi-tenant "organizations" app works without the admin-consent
  step).
