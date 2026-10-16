"""P34: Microsoft 365 / Outlook through Microsoft Graph.

Microsoft Graph ONLY, never EWS: Exchange Online starts disabling EWS on 1 Oct 2026 and
turns it off for good on 1 Apr 2027.

Modules:

- `app`: the workspace's Entra ID app (client id, secret, tenant), its public addresses
  (OAuth redirect, webhook) and whether webhooks can work at all (public https base).
- `auth`: delegated sign-in for a person's own mailbox (auth code + PKCE, state bound to the
  starting person AND their browser session), access tokens (Valkey, refreshed on expiry,
  `reconnect_needed` on invalid_grant), app-only tokens for shared mailboxes (client
  credentials) and the admin-consent step that tells us the customer's tenant id.
- `graph`: the Graph client the mail features use (`Graph`, `for_account`, `for_mailbox`):
  retries on 429/503 with Retry-After, typed errors, helpers for mail, attachments, drafts,
  calendar, free/busy and subscriptions.
- `sync`: real-time sync. Change-notification subscriptions on each inbox; the webhook only
  queues work; the worker runs a DELTA query per mailbox (never trusting the payload),
  stores metadata in `MailItem` (idempotent by Graph message id) and calls
  `hooks.on_new_mail`. Polling every 3 minutes when webhooks are unavailable.
- `hooks`: `on_new_mail(item)`, the seam the mail features implement.
- `access`: who sees which mailbox (personal: its owner only; shared: owner/admin, the
  company's branch managers, the assigned agent's owner) and which AI may use it.
"""
