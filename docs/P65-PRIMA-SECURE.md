# P65: Prima Secure in the office (Prisma)

> **Superseded in part by P66** (`docs/P66-PRISMA-ONE-SYSTEM.md`). Prima now opens with the office sign-in, and its API is reached only through the office (`/api/prisma/...`, signed per person). `/prisma-api/` and Prima's own Microsoft sign-in in the browser are gone. Where this page says otherwise, P66 wins.

Prima Secure is PWVSB Security Group's operations app: people and sites, rosters, attendance,
patrols, cases, licences, HR, claims, IT operations and more. It now lives in this repository
and deploys with the office as one system.

## Where it is
- **Code:** `apps/prima`, copied whole from `prima-secure-app` at `440aa83` (all 671 tracked files;
  `git archive`, file list verified identical).
  - Its own README, CLAUDE.md, docs, tests and Azure tooling are kept as they were.
  - `apps/prima/.gitattributes` forces LF: its SQL is hash-pinned (`db/release-manifest.json`), and
    a Windows CRLF checkout would make its API refuse to start.
- **In the browser:**
  - `/prisma/` is the app.
  - `/prisma/demo/` is a preview: the same code on sample data, in the browser only, with no sign-in.
  - `/prisma-api/` is its API (nginx strips the prefix; Prima serves `/api/...`).
- **In the office menu:** **Prisma** (`/prisma` in the office). It shows whether Prima is running and
  whether its sign-in is set up, then opens it. Prima forbids framing, and so does Microsoft
  sign-in, so it opens as its own page.

## How it runs (docker-compose.yml, profile `prima`)
- **`prima-db`:** PostgreSQL 16, its own volume (`primadata`) on an internal network. It is never
  shared with ours (Prima is built and tested on 16).
  - `deploy/prima/initdb/01-prima-roles.sh` creates, on first start, what Prima's runbook needs:
    - `prima_app`, the role row-level security runs as;
    - `prima_owner`, a NON-superuser schema owner (CREATEROLE, CREATEDB, and `prima_app` WITH ADMIN, SET);
    - the `prima` database, with PUBLIC connect revoked.
- **`prima-setup`:** a one-shot run before every start of the API (`deploy/prima/prima-setup.cjs`)
  that uses Prima's own tools:
  - `db-setup.js` as the owner: the base schema; the first clean-slate settings; the runtime
    login `prima_api`;
  - `module-install.js` for each of the 5 release modules, with the exact hashes it prints.
  - Reruns are no-ops ("already_installed"). A drifted module is refused, and the API then stays
    down rather than run on a wrong schema.
- **`prima-api`:** Prima's API (`apps/prima/Dockerfile`), `NODE_ENV=production`, as `prima_api`. It
  checks its schema and release at start and refuses otherwise. Networks: `prima` and `edge`
  (our nginx, and Microsoft's sign-in keys).
- **Web:** built in the web image (`deploy/web.Dockerfile`, a Node 22 + npm stage) with
  `PRIMA_BASE=/prisma/` and `VITE_API_URL=/prisma-api`. It has its own nginx headers: Prima's CSP
  (Microsoft sign-in, Google Fonts), and camera + location for the staff clock.
- **`deploy-vps.sh`:**
  - generates Prima's secrets into `.env` once (`deploy/scripts/prima-secrets.sh`; never changed
    after, never printed);
  - builds its image;
  - starts it as its own step after the office. If Prima fails to start, the office keeps running
    and the script says so.

Changes made to Prima for the sub-path, all of which still work at a site root:
- `vite.config.ts`: the base path, and an API path on the same site;
- `main.tsx`: the service worker is registered under the base;
- `public/sw.js`: paths relative to its scope, and it never touches another app's paths;
- `microsoft.ts`: the redirect is to the app's own address;
- the manifest and `index.html` use relative paths.

Our own service worker leaves `/prisma/` and `/prisma-api/` alone.

## Sign-in (to finish, Microsoft admin)
Prima signs people in with Microsoft itself (MSAL in the browser, tokens checked by its API). Its
app registrations are the existing "Prima Secure App" (SPA) and "Prima Secure API"; their public
IDs come from `apps/prima/infra/staging.env` into `.env` (`PRIMA_ENTRA_*`).
1. In Microsoft Entra, open **Prima Secure App**, then **Authentication**, then
   **Single-page application**, and add the redirect URI `https://agent.oriondesk.space/prisma/`.
2. Link each person's Microsoft account to their Prima user. Prima has no screen for this; its
   tool runs as the owner, and the change is audited:
   `./deploy/scripts/prima-link-user.sh <prima-user-id> <entra-object-id> "<your name>"`
   (`--unlink` in place of the object ID removes the link).

Prima's own rules still apply:
- its pilot lets IT, the COO, CEO, ACT lead, HR and the Finance Director sign in;
- its users, companies and grants start from its clean-slate seed;
- real staff data needs the owner's approval (`apps/prima/docs/ARISHA_AZURE_ACTIVATION.md`).

## The AI and Prima
- **The Library:** Prima's SOPs are imported for the agents: the 34 end-to-end workflows
  (W1–W34), business rules, record forms, screen guides and IT guides
  (docs/P65-PRIMA-KNOWLEDGE.md). Agents look them up before related work.
- **Prima's boundaries, which the agents keep:**
  - drafts and preparation only;
  - no pay, deduction, discipline or contract decision;
  - never invent rates or evidence;
  - staff send their own replies from Outlook.
- **No automatic writes into Prima.** Prima has no server-to-server access, and its rules forbid
  writes that skip its permission checks and audit chain.
  - A later step is delegated Microsoft tokens (Prima's `ENTRA_SPA_CLIENT_ID` and the office's
    app in the same tenant), which keeps Prima's own checks.
- **Arisha** (Prima's own assistant) needs Azure OpenAI with a managed identity, so it stays off here.

## Checked
- **Prima's web:** builds for `/prisma/`. Every asset and the manifest are under `/prisma/`, and
  its API calls go to `/prisma-api`. The demo build works too.
- **On PostgreSQL 16, with the role script and setup above:**
  - db-setup created the clean slate, and all 5 modules installed;
  - a second run was a no-op;
  - the API started in production mode: `/api/health` was ok, `/api/health/schema` current,
    and `/api/health/release` reported `ready: true` with every module ready;
  - protected routes answer 401 without a token.
- **Prima's core tests:** 680 of 680 passed.
- **Its API test suite:** 679 of 679 passed on a fresh PostgreSQL 16 (Linux, the suite's own
  disposable localhost database), covering row-level security, the company walls, setup,
  release install and Microsoft sign-in.
