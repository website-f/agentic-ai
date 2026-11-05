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

1. **Who is who (P67).** The office is Prima's sign-in. Each person in the office is linked to one Prima staff record (`prisma_links`, migration 0048), one person per record:
   - **By themselves:** the first time they open Prisma, if they signed in to the office with Microsoft (`memberships.ms_oid`, migration 0047, recorded after Microsoft's answer is verified) and IT recorded that same account on a Prima record (`entraOid`).
   - **By the owner, otherwise:** **Prisma → People in Prima** lists everyone in the office beside Prima's records, with the likely record already picked. The pick is the record carrying the person's Microsoft account, or else the only record with exactly the same name, when nobody else in the office has that name. **Link all suggested** links them in one click, and any row can be changed or cleared.

   A name match is never linked without that click: a link decides whose pay, leave and HR records someone (and their AI) sees. No script is needed. `deploy/scripts/prima-link-user.sh` still records a Microsoft account on a Prima record if IT wants that.
2. Each call is signed with `PRIMA_OFFICE_SECRET` using HMAC-SHA256. The office side has it as `AGENTIC_PRIMA_SECRET`; Prima has it as `OFFICE_SIGNING_SECRET`. The signature covers:
   - the time;
   - the method;
   - the path with its query;
   - the linked Prima record;
   - who acted (`person`, `agent:<name>`, or `system` for the staff list used for linking);
   - the exact body bytes.
3. Prima checks the call in `apps/prima/apps/api/src/office.ts` and the `AuthGuard`:
   - the signature must match;
   - the call must be under 5 minutes old.

   It then applies the same sign-in rules as a Microsoft sign-in (`userForOffice`): no system feed, no closed account, the pilot, leadership-only mode. A `system` call never opens a screen or a record; it only reads the staff list (`OfficeController`, `GET api/office/staff`: id, name, title, role, the recorded Microsoft account, and whether the record may sign in). Once the office headers are present, the call must verify; it never falls back to another way in.
4. From there, Prima's own roles, record rules and row-level security decide everything. A refusal comes back word for word.

**What is never reachable through the office:**
- Prima's signed system feeds (`api/integrations/...`);
- development sign-in (`api/auth/dev-login`, `api/auth/users`);
- the office's own staff list (`api/office/...`).

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
- **Each person:** nothing to run.
  - If they sign in with Microsoft and IT recorded that account in Prima, they are linked the first time they open **Prisma**.
  - Otherwise the owner opens **Prisma → People in Prima** and clicks **Link all suggested** (or picks a record per person).
  - **Prisma** then opens Prima with no second sign-in. Until then, the page says what is missing.
- **Microsoft redirect URI:** not needed for the office path. Prima's own Microsoft sign-in (MSAL) is not used inside the office.

## Not covered

Prima's Microsoft-only features still need Prima's own Microsoft token, so they don't work through the office:
- the CEO's IT import review;
- the job mailbox connection (`m365Call`).

They say so when opened.

## P68: straight in, and a cleaner Prima

**Straight in.** Signing in to the office is enough. The first time someone opens **Prisma**, the office links them when the match is sure: their Microsoft account recorded in Prima, or the only Prima record with exactly their name while nobody else in the office has it. Their link shows as "Linked by Microsoft" or "Linked by name". The owner can change or clear any link on **People in Prima**, and links anyone without a sure match there.

**Everyone, not only the pilot.** `PRIMA_SIGNIN_EVERYONE` (default `true` in docker-compose.yml) lets every linked staff record sign in. It changes nothing else: the pilot's own workflow rules stay as they are, and closed accounts are still refused. Set it to `false` to let only the pilot group in again.

**The look, checked screen by screen** on a computer and a phone, in light and dark (`apps/prima/apps/web/src/styles.css`, `App.tsx`):
- **Menu:** grouped into sections (Today, Operations, People and HR, Business and finance, Compliance and governance, IT and systems), on the rail and in the phone's **More** sheet, which now scrolls.
- **Page head:** one left-aligned column (title, explanation, notices) instead of a title and a floating paragraph side by side.
- **Number tiles:** fill the row with lines only between tiles, no grey gaps, and long amounts wrap instead of being cut.
- **Lists:** a status tag moves under the text when there is no room, instead of running off the screen.
- **Tables:** headings in sentence case that never wrap, numbers lined up, a readable name column, and wide tables scroll inside their panel.
- **Section tabs:** scroll sideways on a phone instead of piling up in rows.
- **Buttons, fields and tabs:** a steady height (40px touch targets on phones), hover, press and focus states.
- **Phone top bar:** fits on one line; Sign out lives in **More**.
- **Panels:** text inside never touches the edge.

## Tasks and reports from Prima

An agent given a task in the office reads Prima as the person who gave the task. A scheduled task reads as whoever made the schedule. So "summarise this week's attendance and the leave waiting for co-1" works the same in a task as in chat:
1. `prisma_read api/me` gives the person's role and the companies they see.
2. The task reads `api/companies/<id>/attendance`, `api/leave`, `api/claims`, `api/staff-pay` and so on.
3. The agent writes the summary or report (a document, if asked).

`prisma_read` lists these starting points in its description.

## Tests

- `apps/api/tests/test_p66_prisma.py`:
  - the shared signature test vector;
  - catalog drift;
  - path rules;
  - screens through the office, including CSRF, refusals and sign-out;
  - who is who: sure-match suggestions, one-click linking, linking by Microsoft, a record never linked to two people, owner only;
  - the AI tools: acting as the person who asked, refusing when nobody asked, and policy and offering;
  - a task given in the office reading Prima attendance as the person who gave it.
- `apps/api/tests/test_p63_microsoft_signin.py`: the Microsoft account is recorded at sign-in, with or without a mailbox.
- `apps/prima/apps/api/test/office.test.ts`: the same test vector, and every tampering refused.
- `apps/prima/apps/api/test/rls.test.ts`: office sign-in through the real `AuthGuard` and database (a named record, a missing one, a system feed, outside the pilot, an old call, a system call refused, no secret), and the staff list for the office's system call only.

## Reinstalling Prima

A Prima release that changes Prima's base schema (`db/migrations/001_init.sql`) cannot be set up over the old database; Prima's setup refuses it. Our Prima holds only its sample data (`PRIMA_DATA_MODE=staging-pilot`), so it is reinstalled rather than run through Prima's staged base transition (`ops/base-transition`, meant for a database with real records):

```
cd /opt/agentic-ai && ./deploy/scripts/prima-reinstall.sh --yes
```

1. **Backup:** the whole Prima database is saved to `data/backups/prima-<time>.sql.gz`. If the backup fails or comes out empty, nothing is changed.
2. **Remove:** Prima's containers and its database volume are removed.
3. **Install:** the base and every module of the release manifest are installed fresh, and Prima's API is started.

Links between office people and Prima staff records keep working, because the sample records keep their ids.

To go back to a backup, restore it into a fresh `prima-db` with the previous Prima image:

```
gzip -dc data/backups/prima-<time>.sql.gz | docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile prima exec -T prima-db psql -U prima_super -d prima
```

Once Prima holds real records, use Prima's own base transition instead (`apps/prima/rehearsal/combined/CUTOVER_PLAN.md`).
