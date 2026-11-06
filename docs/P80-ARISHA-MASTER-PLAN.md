# P80: Arisha AI Assistant Master Plan v1.0 measured against this system

This file checks the *Arisha AI Assistant Master Plan v1.0* (6 Nov 2026) against what the Agentic Office and Prima actually do on 6 Nov 2026.
- Each of the plan's 72 requirements is marked with one of four statuses:
  - **In place**: built and tested.
  - **Partly**: the main part exists; the gap is named.
  - **P80**: built in this round.
  - **Outside software**: hardware, contracts, policy or people decisions that code cannot settle.
- "In place" means the feature exists and its tests pass. It does **not** mean the plan's acceptance evidence has been attached. Under the plan (section 20), each company, function and release is still accepted by its business owner with evidence, and ACT reviews it.

## The design in one paragraph

Per the plan, Arisha is "a company-controlled platform around Prima Secure with a single assistant interface, a policy-enforced AI gateway, separately controlled application tools, a reliable work-event service and a versioned knowledge store". In this system that is:
- **The single assistant interface:** the office (one sign-in with Microsoft, one AI staff, one help and feedback button) plus Prima inside it, at /prima/, with Arisha in Prima's combined launcher.
- **The gateway:** the office's AI gateway (`apps/api/agentic/engine`). It masks identifiers before any cloud model (privacy.py). Each company's data level (public / confidential / local only) decides which providers may see its work. It enforces the approved-services lock (compliance.py) and budgets (teams/budget.py), and logs every call (llm_calls).
- **Prima** stays the authoritative record for tasks, approvals, HR and finance, protected by its own row-level walls and its sealed audit chain. The office never writes Prima's database; it calls Prima's API as the person, signed.

## Coverage register

| ID | Requirement | Status | Where, or what is missing |
|---|---|---|---|
| R01 | 300 staff roster and devices | Partly | Staff list cleaned into an import (P80): 239 people ready, 221 rows set aside with reasons. Device roster: linked PCs (Staff computers). Missing: one reconciled roster of all 300 with devices; HR/IT own it. |
| R02 | LAN and VPN with MFA | Outside software | Two-step sign-in exists (Settings › Security, `two_factor.py`); network and VPN are IT infrastructure. |
| R03 | Single staff assistant | P80 | One sign-in (Microsoft), the office's AI staff, and Arisha back in Prima in one launcher with feedback and the page guide. |
| R04 | Eight provider adapters | P80 | Gateway presets now cover all eight families: OpenAI, Anthropic, Gemini, DeepSeek, Mistral, plus xAI Grok, Perplexity and Qwen added in P80. Each stays off until a key is added and, with the lock on, approved. |
| R05 | Task and token switcher | Partly | Per-agent model choice, provider order and fallback in the gateway. Missing: routing by evaluated task class (needs the plan's test sets, R10/R57). |
| R06 | Budgets and concurrent reservations | Partly | Daily token and monthly cost budgets per agent, with an 80% alert and a stop-and-ask at 100% (`teams/budget.py`). Missing: atomic reservation before parallel calls; billing reconciliation per provider. |
| R07 | Cloud-first to hybrid | In place | Local providers (Ollama) sit beside cloud ones behind the same interface; local is never masked and never leaves the server. |
| R08 | Local-only restricted tasks | In place | Company data level "local_only" keeps that company's work on the server's own model (gateway routing). |
| R09 | Minimum disclosure and redaction | In place | Every cloud call is masked: names, IC, passport, bank, card, phone, email, address, company and registration numbers, references (`engine/privacy.py`), restored on return. |
| R10 | Provider retention and feature review | Partly | Each provider shows its data-policy note. The approved-services lock records who approved what, for which data and location (`engine/compliance.py`). Missing: per-endpoint review records owned by Privacy/IT. |
| R11 | Prima identity and event integration | In place | Signed office→Prima calls as the person (HMAC), the owner as Prima's CEO record, staff auto-accounts (P76), and Prima's own audit chain. |
| R12 | Word drafting and recovery | Partly | Agents draft documents into the office Library and Files with versions. Missing: an Office add-in for in-place reviewed edits. |
| R13 | Excel formulas and totals | Partly | Spreadsheet reading and writing in agent tools. Missing: an add-in that recalculates and reconciles in Excel itself. |
| R14 | Other apps and accounting tools | Partly | Prima's SQL Account imports; MCP servers and web connections in the office. Each new integration is accepted separately. |
| R15 | Desktop assistance and automation | Partly | Agents' own browsers, and staff-owned linked PCs used with consent (Staff computers, live monitor). No unrestricted desktop control, as the plan requires. |
| R16 | Work steps outside Prima | Partly | Office tasks, blockers and hand-overs. Missing: linking a step done outside Prima to a Prima task. |
| R17 | Waits, errors and rework | Partly | Task blockers with named reasons (`teams/blockers.py`), review stages, and Prima's workflow timing (IT metrics). |
| R18 | Computer start, stop and sessions | Partly | Linked PCs report online state and an activity log. Missing: boot, lock and unlock events (needs the endpoint companion). |
| R19 | Collector health and offline queue | Outside software (later) | Needs the endpoint companion the plan describes. |
| R20 | AI disclosure and action audit | In place | The llm_calls log (model, tokens, cost, masked), the workspace audit log, and Prima's sealed audit chain. |
| R21 | Company and role isolation | In place | Office: companies (branches, optionally isolated) and scoped roles. Prima: forced row-level security walls per company. |
| R22 | Management evidence dashboard | Partly | Office overview, monitor and reports; Prima Home and dashboards per role. |
| R23 | Department improvement loop | Partly | Prima ACT findings with owner, due date and closure; office feedback with status. |
| R24 | Central files and official versions | P80 | SharePoint/OneDrive folders linked into the Library and kept in sync, with no copies stored. Files stay where the company keeps them. |
| R25 | Existing PC file migration | Partly | Company backup of linked PCs' shared folders (`devices/backup.py`). Migration acceptance stays with the owners. |
| R26 | Independent protected backups | Partly | A database backup before every deploy (deploy-vps.sh), plus the Prima backup before reinstall. Missing: scheduled backups, an immutable offline copy and restore rehearsals (IT). |
| R27 | New computer and staff handover | Partly | Prima HR/IT joining and leaving coordination, IT onboarding steps, and hand-overs. |
| R28 | Observation without an authored guide | Outside software (later) | Needs the observation tooling (section 10). |
| R29 | Approved knowledge store | In place | SOP drafts are never seen by agents until a person approves them. The Library index; Prima's rules and guide cards. |
| R30 | Training movies and written guides | Partly | Written guides (User Guide, Prima guides) and the page tour ("Show me on this page"). Missing: recorded lessons. |
| R31 | Practice and competency checks | Outside software (later) | |
| R32 | Replicate approved tasks | Partly | Workflows, routines and SOPs run by agents with review stages. |
| R33 | Knowledge poisoning and expiry | Partly | Approval gate on SOPs; drafts quarantined. Missing: expiry dates on lessons. |
| R34 | IT inventory, health and support | In place | Prima IT: assets, help requests with time limits, jobs and proof. |
| R35 | Six-month asset maintenance | In place | Prima IT: every asset inspected every six calendar months (rule IT, Fauzan 1 Nov 2026). |
| R36 | Controlled elevated repairs | Outside software | Endpoint management (Intune or similar) is not in place. |
| R37 | HR whereabouts and availability | Partly | Prima clock (site device with face check), leave, work from home, and declared status. |
| R38 | Fair KPI evidence and corrections | Partly | Prima appraisals and HR cases with a person's own view. |
| R39 | Health inference boundary | In place | No feature infers health from work signals. |
| R40 | Movement reminders | Outside software (later) | Needs the endpoint companion. |
| R41 | Document deletion protection | Partly | Versions in Files; Prima legal holds. |
| R42 | Exfiltration and direct AI bypass | Outside software | DLP (e.g. Purview) is an IT and licence decision. |
| R43 | Tamper and mass-change response | Outside software | |
| R44 | Supplier and bank-change control | In place | Prima: bank details changed only through the verified change flow; nobody verifies their own. |
| R45 | Approval bound to payment version | Partly | Prima payment requests and staff payroll are maker-checker, and the payer is never the approver. Missing: a hash of the approved version. |
| R46 | Bank release and reconciliation | Partly | Prima Finance checks payments against bank statements; the bank file stays with Finance. |
| R47 | Duplicates, partial and unknown jobs | Partly | Prima receipts and idempotent office calls. "Outcome unknown" is shown, never retried blindly. |
| R48 | SharePoint guide and provisioning | P80 (read) | Reading and syncing linked folders. Provisioning sites and lists is not built (needs a privileged identity; plan section 8). |
| R49 | SharePoint lifecycle and cloud boundary | Partly | Linked sources show owner, scope and last sync. The data-boundary decision belongs to management. |
| R50 | Arisha-assisted control design | Partly | Arisha explains Prima's rules on each page. Proposals stay with the owners. |
| R51 | Framework inside the system | In place | Prima's rules (RULES), approval limits, delegations and access grants are enforced in code. |
| R52 | Framework approval and rollback | Partly | Rule changes ship as reviewed releases with a rollback command. Missing: an in-app draft → review → activate flow. |
| R53 | Leave cover and human backup | Partly | Prima delegations with expiry; office agents act through their own identity, never a borrowed one. |
| R54 | Temporary access expiry | In place | Prima delegations end on their date; access is removed and hand-backs are listed. |
| R55 | Continuous reviewed improvement | Partly | Feedback → developer queue → release; SOP approval. |
| R56 | Predictive operational alerts | Partly | Rule-based early warnings: renewals, licences, payroll by the 7th, IT time limits. No ML forecasts (the plan says rules first). |
| R57 | Model quality and drift | Outside software (later) | Needs the business owners' test sets (D10). |
| R58 | Prompt injection and tool security | In place | Tool results fenced as data; Arisha's rules treat user and tool text as untrusted; server-side tool authorisation. |
| R59 | Privileged identity and revocation | Partly | Roles, two-step sign-in, removing members ends their sessions. Just-in-time admin is not built. |
| R60 | Privacy assessment and worker notice | Outside software | HR/privacy (D05). Prima keeps PDPA cases and rights requests. |
| R61 | Legal transfer, profiling and breach review | Outside software | |
| R62 | Retention, deletion and legal hold | Partly | Workspace export and erase; Prima legal holds. Per-category retention values need approval (section 21). |
| R63 | Recovery and emergency stop | Partly | Rollback command on every deploy; agents can be paused. |
| R64 | Launch training and adoption | Partly | Page guide tours, the User Guide, Arisha. |
| R65 | Secure releases and independent checks | Partly | Tests on every change; code review is manual. |
| R66 | Commercial ownership and exit | Outside software | |
| R67 | Budget, procurement and local sizing | Outside software | D07/D12. |
| R68 | Permanent support and review cadence | Outside software | |
| R69 | Accuracy of domain policy | Partly | Contract billing bases are in Prima Contracts (method 1: hours × 30.5; 2: contracted hours; 3: actual days). The foreign-worker medical cap (RM200 per eligible worker per year) is not configured yet; HR confirms eligibility first, as the plan says. |
| R70 | Role ownership and Fitri coordination | Outside software | |
| R71 | Accessible bilingual training | Partly | The office and Prima work in English and Malay; guides in both. |
| R72 | Scope-specific programme acceptance | Outside software | Owners accept each company and function with evidence. |

## Summary
- 14 in place.
- 4 built in P80.
- 38 partly in place, each with its gap named.
- 16 outside software: hardware, DLP, network, contracts, privacy decisions, staffing.
- None is claimed accepted. Acceptance is the owners' and ACT's step.

## Recommended next software steps (in the plan's order)
1. **R06:** atomic budget reservation for parallel AI calls, and a provider bill reconciliation report.
2. **R05/R57:** task classes with a small evaluation set per class, chosen by the business owners (D10).
3. **R18/R19/R40:** the endpoint companion (the PC agent already exists: extend it with session events and an offline queue).
4. **R12/R13:** an Office add-in for reviewed Word and Excel edits.
5. **R45:** bind each payment approval to a hash of the approved version.
6. **R48:** SharePoint list and library provisioning from approved templates, under a separate privileged identity.
