# Prima Secure App

Group operations platform for PWVSB Security Group. This repository holds **Wave 1**:
people and site records, rosters, attendance, patrols, incidents and the case engine,
licence and permit alerts, company walls and the audit trail.

The master plan, architecture and workflows are in the project's Claude Doc
"Prima Secure App: master plan, architecture and workflows". Where code and plan differ,
the plan wins until it is changed.

> **Status (30 Oct 2026): Azure staging deployed; not approved for production or real personal data.**
> The CEO successfully signed in with Microsoft, and the separate staging-website verification workflow passed.
> The current system retains seeded/mock scaffolding; the company and staff identities and operational data must
> be verified before real-data onboarding. Arisha Azure OpenAI is still off as of the last Azure inspection.
> For the latest context and open PR/activation gates, read [CLAUDE.md](CLAUDE.md) and
> [the detailed handover](docs/CLAUDE_HANDOFF_2026-10-30.md). Always recheck current GitHub/Azure status.

## Layout

| Path | What it is |
|---|---|
| `packages/core` | Business rules, access rules, audit chain, case engine, mock data, and the `PrimaService` used by both the API and the browser demo |
| `apps/api` | NestJS API on PostgreSQL. Every request runs inside a transaction with row-level security set to the user's companies |
| `apps/web` | React PWA. Builds either the installable app (talks to the API) or a single-file test version that runs the same core in the browser |
| `db/migrations` | SQL schema, row-level security policies, append-only audit log |
| `docs/adr` | Architecture decisions |

## Run it locally

Needs Node 20+ and PostgreSQL 16.

```sh
npm install
cp apps/api/.env.example apps/api/.env   # then set your own values
export DATABASE_URL=postgres://postgres:<password>@localhost:5432/prima
export DEV_TOKEN_SECRET=<any local secret> ALLOW_DEV_LOGIN=true
npm run build -w @prima/core
npm run db:reset          # local databases only; creates mock data dated today
npm run dev:api           # http://localhost:3000
npm run dev:web           # http://localhost:5173, proxies /api to the API
```

Single-file test version (no server needed):

```sh
npm run demo:build        # apps/web/dist-demo/index.html
```

## Tests

```sh
npm test -w @prima/core                                         # rules, walls, workflows
DATABASE_URL=postgres://.../prima_test npm test -w @prima/api   # database company wall
```

The API tests reset the database they point at. Use a throwaway local database.

## Rules the code enforces

- A record belongs to exactly one company. The database refuses reads and writes outside
  the companies set for the request (`db/migrations/001_init.sql`).
- PWVSB and the Director Office see a company only through a dated authority grant;
  `act` grants allow roster and case work, closing a case stays with the company.
- Guards are blocked from rostering when papers are missing or expired, when over 60,
  when it would exceed 12 hours in a day, or overlap another shift. Rest-day and short
  rest are warnings. Rule sources are in `packages/core/src/rules.ts`.
- Missing data shows as Unknown, never as compliant.
- Every change writes a hash-chained audit entry; the audit table is append-only.
- No pay, deduction, discipline or contract decision is automated.

## Sign-in

Office staff sign in with Microsoft 365 (Entra ID). Setup steps for IT: `docs/MICROSOFT_SIGN_IN.md`;
design: `docs/adr/0004-microsoft-sign-in.md`.

## Not done yet

Device enrolment, offline queue for clock-ins, photo storage,
notifications, SQL Account read link, hostel and foreign worker workflows (Wave 2),
real data import. See the master plan, section 5.
