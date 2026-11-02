# P57: ready for a client's NDA

Three gaps a vendor NDA showed (Merdeka Network / TRKD, 30 Oct 2026): multi-factor
authentication (clause 10); company information going only to approved outside services
(clauses 2, 7, 9, 10 and 11); and returning and deleting everything (clauses 15 and 16).

## Two-step sign-in (TOTP)
- **Turning it on:** in Settings, a person adds the key to any authenticator app (by key, or the
  `otpauth://` link) and confirms with a code. They get 10 one-time recovery codes. Turning it off
  needs their password and a code.
- **Signing in:** after the password, a 6-digit code is asked for, or a recovery code instead.
  - The challenge lasts 5 minutes.
  - A code is accepted one step either side of the current one, and a code that was already used
    is refused.
  - Five wrong codes end the challenge; ten per person in 15 minutes return 429.
- **The workspace rule (owner):** Off, Owners and admins, or Everyone. Someone it covers who has
  not set up two-step sign-in can only reach the setup screen (`2fa_required`).
  - Existing workspaces start **Off**, so nobody is locked out on deploy. Turn it on in Settings.
  - New workspaces start on **Owners and admins**.
- **Lost phone:**
  - An owner resets a member's two-step sign-in in Members. This is audited and ends that member's
    sessions.
  - For an only owner who lost both the phone and the recovery codes, use
    `agentic-admin reset-2fa <email>` on the server.
- The secret is encrypted with the master key and included in key rotation.
- Migration `0042_two_factor`.

## Approved services (the lock)
Settings > **Approved services** (owner).

- **Off** (the default): everything works as before.
- **On:** only services on the approved list are used:
  - AI providers;
  - outside file storage;
  - Telegram and WhatsApp;
  - phone notifications;
  - the web (search and browsing);
  - Microsoft 365 and Google;
  - each MCP server;
  - each CRM connection.

Anything on this server (the local AI model, its disk) needs no approval.

**What happens to an unapproved service while the lock is on:**
- an AI provider is skipped (if none is approved, the AI does not answer);
- web, Google and Microsoft tools are denied;
- messages are not sent and the bots do not reply;
- outside storage is neither read nor written;
- MCP calls and CRM syncs stop.

Each attempt is recorded as a request ("wanted 3 times, last 2 minutes ago"). Owners see it on
the page and in the bell. They **Approve** it, recording where it processes data, what data it may
receive and a note, or **Keep blocked**. Approvals are audited and can be withdrawn.

**Download the approved list** gives a CSV for the Project Specification or the client's records.

The rules live in `engine/compliance.py`, checked in the gateway, `policy.evaluate`, `deliver`, the
bots, `storage.put/get`, the Microsoft sync, `_tool_call` and `connectors.sync`.

## Export and erase this workspace
Settings > **Data and privacy** (owner).

**Export:** a ZIP containing
- every table's rows for this workspace, with secrets redacted;
- original files, the brain vault, documents and CRM CSVs;
- a README and index.

The download link is signed, works once and lasts 15 minutes. An export never downloaded is
deleted after 7 days.

**Erase:**
- The owner types the workspace name and enters their password (plus a code if two-step sign-in
  is on).
- They can export first, and can cancel until the erase starts.
- The erase runs in this order:
  1. Count everything.
  2. Revoke: sessions, accounts of people in no other workspace, every stored secret (AI keys,
     Microsoft and Google tokens revoked at the provider where possible, channel tokens, MCP, CRM,
     saved logins), linked computers, schedules and running work.
  3. Delete the files in every storage place.
  4. Delete the vault, including its git history.
  5. Delete cache keys.
  6. Delete the database rows, audit log included.
  7. Check that no row with the workspace id remains in any table.
- **Deletion certificate** (PDF and JSON):
  - what was erased, by category and by table, and what was revoked;
  - the check result;
  - providers to notify (their own retention applies);
  - what could not be removed: encrypted server backups until the cycle overwrites them, about 186
    days, which clause 15 allows.

  A SHA-256 hash of the certificate is kept server-side in `erasure_records` (no content), so the
  deletion can be proven later.
- The certificate and progress are at `/erased?id=&token=`, because the owner's account may be
  gone. The app has no mail server to email it.
- Migration `0043_export_erase`. The audit-log trigger now allows deletion only inside an erase.

## Still the vendor's job (not software)
- Get the client's written approvals for each service and location (clause 9).
- Write the Project Specification.
- Put an encrypted disk on the client's server.
- Set up monitoring and an incident procedure for the 24-hour notice (clause 8).
- Do not use the client's data in development tools.
- Make clause 14 and the Statement of Work keep the core platform as the vendor's pre-existing
  material.
