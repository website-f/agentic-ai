# Prima Secure App: full system documentation

This folder describes the whole Prima Secure App in plain business English: what the system is for, who uses it, the
business rules it enforces, how work flows between people and departments, and what every screen does.

It is written for the owner, department heads, reviewers and developers. It describes the code; it does not replace
the owner's decisions, the law, or counsel's advice.

## What this documentation is based on

| Item | Value |
|---|---|
| Written | 3 November 2026 |
| Source | Combined test candidate, round 5: branch `claude/combined-candidate-2026-11-03-r5`, head `f54a096` |
| Base of that candidate | `main` at `0ead549` |
| Tested tree of the candidate | commit `7453e67` (core 1292/1292, API 904/904 on local PostgreSQL, CMS 60/60, synthetic data) |

The combined candidate is `main` plus fourteen department pull requests that are **still drafts and not merged**:

| PR | What it adds |
|---|---|
| #41 | IT checking for Ops, FWM, Inventory and Transport work |
| #49 | Finance (payments, month-end close, checks, packs, daily cash, receipt wallet) |
| #51 | HR Phase 3 (joining and leaving, leave, cases, OSH, training, allowances, staff movement) |
| #52 | Central Admin (company files, renewals, panel firms, Director Office desk, legal holds, delegations) |
| #53 | Special Ops (Arms Control requests, CMS commissioning, transport trips, asset management links) |
| #54 | Government Ops (Goodwill Empire), Private Ops (Sasa Team) and Procurement & Inventory |
| #55 | ACT (Audit, Compliance and Transformation) |
| #56 | Connect departments (hand-overs, shared guide cards, import) |
| #57 | Company office (desks, owners and backups, companies run by another office) |
| #58 | Work rebalancing (managers delegate and readjust, Arisha advice) |
| #60 | Microsoft 365 Connections page |
| #61 | Branches |
| #62 | Foreign worker welfare (recruitment fees, passports, welfare talks) |
| #63 | Growth panel on the leaders' home |

Each screen page says whether the screen is **on main** or **only in the candidate** (which PR brings it).

## What this documentation does not claim

Repository code and tests do not prove deployment, database migration, tenant permissions, runtime health, security
certification or completed staff testing. In particular:

- Nothing in the candidate is merged, migrated, installed on a shared database or deployed.
- External connections (SQL Account, JA Group app, Asset Management system, WhatsApp Business, Azure OpenAI, door,
  alarm, CCTV and vehicle trackers) are **not connected**. Screens that depend on them show "Unknown" or "not
  connected", never a made-up figure.
- All records in the test version are synthetic. Real staff and company data is entered by authorised staff through
  the application.
- Rules labelled **Proposed** or **Unverified** in the rule register are not approved facts.

## How to read it

| File | What it covers |
|---|---|
| [01-overview.md](01-overview.md) | The group, what Prima does, the systems it works with, how it is built |
| [02-roles-and-access.md](02-roles-and-access.md) | Every role, who sees what, menus by department, data walls, sign-in, the pilot |
| [03-business-rules.md](03-business-rules.md) | The principles every screen follows, and the main rules by area |
| [04-workflows.md](04-workflows.md) | End-to-end flows: who starts, who checks, who approves, what happens next |
| [05-status-and-gaps.md](05-status-and-gaps.md) | What is on main, what is only in draft PRs, what is switched off or not built |
| [screens/](screens/README.md) | One section per screen: purpose, who sees it, what is on it, actions and approvals, data |
| [reference/rule-register.md](reference/rule-register.md) | Every rule in the code (151), generated from `rules.ts` |
| [reference/record-forms.md](reference/record-forms.md) | Every Add/Edit record form and its fields (26), generated |
| [reference/handover-map.md](reference/handover-map.md) | Every hand-over between departments (33 flows), generated |
| [reference/guide-cards.md](reference/guide-cards.md) | Index of the step-by-step task guide cards, generated |

The older module documents in `docs/` (IT pilot, Microsoft sign-in, staging, Arisha, Monday pilot matrix and others)
remain the detailed runbooks for their modules. This folder is the map that ties them together.

## Keeping it up to date

When a department PR merges, change its screens from "candidate only" to "on main" and update
[05-status-and-gaps.md](05-status-and-gaps.md). The four files under `reference/` are generated from the code; rebuild
them rather than editing them by hand, so they never drift from the rules the app actually enforces:

```bash
npm ci
bash scripts/docs-system-reference/run.sh
```

The generator needs the combined candidate's code (the shared guide registry and hand-over map), so on `main` it runs
once PRs #49 and #51 to #58 are merged. Run on the round 5 candidate it reproduces these files byte for byte.
