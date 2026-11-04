# P63: Sign in with Microsoft

People sign in to the office with their work Microsoft account. The same sign-in connects their
Outlook mail, calendar and Teams, so their own AI can read, summarise and draft without a
separate "Connect Microsoft" step.

## For the admin
1. **Set up the Microsoft app once** on Channels > Microsoft 365 ([MICROSOFT-365.md](MICROSOFT-365.md)).
   Nothing new is needed in Microsoft Entra: sign-in returns to the same redirect URI the
   Outlook connection uses.
2. **Grant admin consent** (Entra, or the **Grant admin consent** button on the card). Staff then
   do not see a consent screen for mail, calendar and Teams on their first sign-in.
3. **Add people on Members** as before. Their address must be their Microsoft work address, the
   `mail` or `userPrincipalName` in Entra. Only people already in the office get in; a Microsoft
   account alone never creates anyone.
4. The card's **Sign in with Microsoft** switch is on by default. Turning it off hides the button.

## On the sign-in page
- **Sign in with Microsoft** sits above the password form.
- **When the server runs several offices:** the person types their email first, which picks the
  office and fills Microsoft's account box.
- **After Microsoft:**
  - the person lands as with a password sign-in (staff go to their AI worker, `?next=` is kept);
  - an invited person's first-password step is skipped;
  - errors come back in plain words, for example "No one with x@company.com is in this office
    yet. Ask your admin to add you...".
- **Two-step sign-in:** someone who set it up here still enters their code, unless Microsoft did
  multi-factor itself (the token's `amr` has `mfa`, as with Entra MFA or Conditional Access).

## Who gets in (microsoft/signin.py)
- **Matching:** first the Microsoft account the person connected before (tenant and object id),
  so a renamed address still finds them. Then a member of the office whose email is the
  account's `mail` or `userPrincipalName` from Graph `/me`; the organisation's admin sets both.
  The id token's optional `email` claim is never trusted, because it can be unverified.
- **Only the company's own Microsoft organisation:**
  - with a single-tenant app, Microsoft enforces this itself;
  - with a multi-tenant app ("organizations"), the token's tenant must be the one an admin
    consented in, or one members already connected from.
- **Checks on the token:** PKCE and a one-time state (10 minutes); the id token's `nonce` and
  `aud`. At most 20 sign-in starts a minute per address.
- **The mailbox connection:** kept only for people who may connect their Outlook: they have an
  AI twin, or their role has assistants.use (owner, managers). Other staff are signed in, but
  no mailbox connection is stored for them.
- **Audit:** each sign-in is logged as `auth.login`, with a note of "Microsoft" or "Microsoft
  (multi-factor)".

## Teams channel posts
The card's **Teams channel posts** switch adds `ChannelMessage.Read.All` to what sign-in asks
for. Only an admin can consent to that permission, so:
1. Add it to the app in Entra (delegated Microsoft Graph).
2. Grant admin consent.
3. Turn the switch on.
4. People sign in with Microsoft again, or reconnect.

If a person's grant lacks it, their token refresh falls back to the other permissions instead
of asking them to reconnect.

## API
- `GET /api/auth/sso` → `{microsoft}`.
- `POST /api/auth/microsoft/start {email?, next?}` → `{url}`.
  - 409 `email_needed`: several offices, and no email typed.
  - 409 `not_available`: not set up, or turned off.
- The callback is the existing `GET /api/integrations/microsoft/callback`. A sign-in state
  (`mslogin:`) is told apart from a connection (`msauth:`). It redirects to one of:
  - `/login?sso=done[&next=]` (signed in);
  - `/login?sso=code#mfa=...&email=...` (the two-step code comes next; the fragment never
    reaches a server);
  - `/login?sso_error=...`.
- `PUT /api/integrations/microsoft/options {sign_in?, teams_channels?}` (channels.manage,
  audited). `GET /api/integrations/microsoft` returns both fields.
