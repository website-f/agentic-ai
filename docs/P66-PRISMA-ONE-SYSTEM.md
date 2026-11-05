# P66: Prisma as one system with the office

P65 put Prima Secure (`apps/prima`) beside the office. It had its own Microsoft sign-in and its own API address (`/prisma-api/`), and the AI only had Prima's SOPs in the Library. P66 makes it one system:

- **One sign-in.** Prima opens with the office session. On a computer, **Prisma** in the menu shows Prima inside the office page, beside the office menu. On a phone, it opens full screen, because Prima has its own bottom tabs.
- **The AI works in Prima** for the person who asked, as them. It reads what they may read, and records what they may record once they approve.
- **One look.** Prima uses the office's colours, its Geist font, its corners and its light/dark setting.

## How a call reaches Prima

```
Prima screen ──/api/prisma/api/…──▶ office api ──signed──▶ prima-api ──▶ Prima's rules + RLS
AI tool ───────────────────────────▶ (agentic/prisma/client.py)
```

The office never holds a Prima password or token.

1. The office names the person by the Microsoft work account they signed in to the office with. That is `memberships.ms_tenant_id` / `ms_oid` (migration 0047), recorded after Microsoft's answer is verified at every **Sign in with Microsoft**, and whenever a mailbox is connected.
2. Each call is signed with `PRIMA_OFFICE_SECRET` using HMAC-SHA256. The office side has it as `AGENTIC_PRIMA_SECRET`; Prima has it as `OFFICE_SIGNING_SECRET`. The signature covers:
   - the time;
   - the method;
   - the path with its query;
   - the account (object ID and tenant);
   - who acted (`person` or `agent:<name>`);
   - the exact body bytes.
3. Prima checks the call in `apps/prima/apps/api/src/office.ts` and the `AuthGuard`:
   - the signature must match;
   - the call must be under 5 minutes old;
   - the tenant must be Prima's own Entra tenant.

   It then links the account exactly as it links a Microsoft token: through `userForEntra`, by `entraOid` only. Closed accounts, pilot rules and leadership-only mode are all refused the same way. Once the office headers are present, the call must verify; it never falls back to another way in.
4. From there, Prima's own roles, record rules and row-level security decide everything. A refusal comes back word for word.

**What is never reachable through the office:**
- Prima's signed system feeds (`api/integrations/...`);
- development sign-in (`api/auth/dev-login`, `api/auth/users`).

Paths are limited to a plain alphabet, so the path Prima sees is the path that was signed.

**Other details:**
- **Rate limit:** Prima limits calls per address, so the office passes on the person's own address in `X-Forwarded-For`.
- **CSRF:** Prima's screens send the office's CSRF token, like every other screen.
- **No direct way in:** `/prisma-api/` is gone. Prima can only be reached through the office.

## The AI in Prima

`agents/prisma_tools.py` adds three tools. They are offered only when Prima is set up on the server.

| Tool | What it does | Default |
|---|---|---|
| `prisma_find` | Finds the Prima action for a job: method, path, inputs, description. It searches a catalog of the 358 actions Prima's API serves (`agentic/prisma/routes.json`). | allow |
| `prisma_read` | Any GET, as the person. | allow |
| `prisma_record` | Any POST, as the person. High risk. | ask: the person approves every one, even on autonomy "auto" |

**Whose rights the AI uses:**
- Always the person who asked: the one chatting, or the person who gave the task (`allowance.person_of_task`).
- Never anyone else.
- Never for the office's own work (a mail rule, an agent's own idea), where nobody asked.

So a manager chatting with the Chief of Staff gets the manager's rights in Prima, and staff get their own.

**Prompt rules:** the prompt says Prima is here and repeats Prima's limits (`client.PROMPT_NOTE`, next to the P65 procedures note):
- follow the procedure from the Library;
- never work around a refusal;
- decisions on pay, deductions, discipline and contracts stay with the people Prima names.

**Keeping the catalog current:** the catalog is built from Prima's controllers. A test fails if it drifts from Prima's code. To rebuild it, run from `apps/api`:

```
python -m agentic.prisma.routes ../prima/apps/api/src > agentic/prisma/routes.json
```

## The look

`apps/prima/apps/web/src/styles.css` now uses the office's palette in both light and dark. Changes:

- **Colour roles:** the green accent is used for primary and for the current page. The status colours stay. Prima's violet for UNKNOWN stays, so unknown is never shown as green.
- **Fonts:** Geist and Geist Mono, from `public/fonts` (SIL OFL, `OFL-Geist.txt`). Nothing loads from Google any more.
- **Corners and menu:** the same corners, the same 12px cards, and the menu's current item in the office style.
- **Light/dark:** `public/theme-init.js` reads the office's saved `agentic.theme`, so Prima follows the office, including live when it changes.

**Server headers:**
- `/prisma/` may be framed by this site only (`frame-ancestors 'self'`). It has no Google or Microsoft hosts in its CSP.
- The office allows camera and location for this site only, for Prima's staff clock. The browser still asks first.

## Setting it up

- **Secret:** `deploy/scripts/prima-secrets.sh` adds `PRIMA_OFFICE_SECRET` to `.env`. `deploy-vps.sh` now runs it before its first config check.
- **Deploy script:** it now restarts itself when a pull changes it. A deploy that changed its own script used to carry on with the old copy.
- **Each person:**
  1. They sign in to the office once with **Sign in with Microsoft**.
  2. IT links their Microsoft account to their Prima staff record:
     ```
     ./deploy/scripts/prima-link-user.sh <prima-user-id> <entra-object-id> "<who links>"
     ```
  3. **Prisma** then opens Prima with no second sign-in. Until then, the page says what is missing.
- **Microsoft redirect URI:** not needed for the office path. Prima's own Microsoft sign-in (MSAL) is not used inside the office.

## Not covered

Prima's Microsoft-only features still need Prima's own Microsoft token, so they don't work through the office:
- the CEO's IT import review;
- the job mailbox connection (`m365Call`).

They say so when opened.

## Tests

- `apps/api/tests/test_p66_prisma.py`:
  - the shared signature test vector;
  - catalog drift;
  - path rules;
  - screens through the office, including CSRF, refusals and sign-out;
  - the AI tools: acting as the person who asked, refusing when nobody asked, and policy and offering.
- `apps/api/tests/test_p63_microsoft_signin.py`: the Microsoft account is recorded at sign-in, with or without a mailbox.
- `apps/prima/apps/api/test/office.test.ts`: the same test vector, and every tampering refused.
- `apps/prima/apps/api/test/rls.test.ts`: office sign-in through the real `AuthGuard` and database (linked, unlinked, outside the pilot, wrong tenant, old call, no secret).
