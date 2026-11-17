"""P109: a person's other email accounts (IMAP, or Gmail through Google sign-in) and backing up
their attachments into the person's own Files before they move to Microsoft 365.

- `models`: ExternalMailAccount (encrypted app password, own person only), MailBackupJob.
- `imap`: TLS-only IMAP reading (read only), provider presets, the outside-address guard.
- `backup`: the resumable backup job (worker rounds), dedupe by SHA-256, inline pictures
  skipped, the "you can stop using it" notice.
"""
