# Security

Agent platforms in 2026 have a bad track record (OpenClaw: critical RCE CVEs, 1,000+ malicious marketplace skills, 135k exposed instances; Hermes: auth-bypass and memory-injection CVEs). We design against those failure modes from day one.

## 1. Authentication and roles

- Email + password (argon2id), optional TOTP, HttpOnly + Secure + SameSite=Lax session cookies, CSRF token on mutating requests.
- Optional OIDC (Authentik / Keycloak) later.
- Roles per workspace:

| Role | Can |
|---|---|
| owner | everything, including billing-level budgets and deleting the workspace |
| admin | members, AI Engine keys, policies, agents |
| operator | create and assign tasks, instruct agents, edit skills and brain |
| approver | decide approvals, review skill proposals and dream diaries |
| viewer | read only |

- Scoped API tokens for the OpenAI-compatible endpoint and integrations; no single all-powerful owner token.
- Login rate limiting and lockout (reuse CrawlOps `loginguard.py` pattern).

## 2. Policy floor

- Hardline blocklist evaluated before any mode (see AGENT-RUNTIME.md section 5). Lives in code plus a global `policies` table that only owners can edit.
- Tool modes per agent (`allow` / `ask` / `deny`); new tools default to `ask`.
- The optional "smart" LLM risk review can only escalate, never relax.
- Approval tokens for push actions are single-use, bound to one approval, expire in 10 minutes, and are stored hashed.

## 3. Prompt injection

- All untrusted content (fetched pages, uploads, emails, chat from channels) is wrapped in nonce-fenced blocks and labelled as data (CrawlOps judge pattern).
- Context files that enter the system prompt (`AGENTS.md`, `SOUL.md`, skills) pass an injection scanner on every save (Hermes pattern); suspicious content blocks the save and asks for review.
- Agents cannot change their own tool modes, policies, budgets or schedules.
- Text sent by a user through a channel binding is treated as a user message, never as a system instruction.

## 4. Network and tools

- `web.fetch` and any URL-taking tool pass an SSRF guard (reuse CrawlOps `ssrf.py`): no private, loopback, link-local or metadata ranges; DNS re-resolved and pinned per request.
- File tools are restricted to the workspace vault and upload bucket; protected paths (`.git`, `AGENTS.md`, policies) require approval.
- No shell or code-execution tool in v1. When added, it runs in a separate sandbox service with no network by default, CPU/memory/time limits, and no access to the Docker socket.
- MCP servers (if added) start with a scrubbed environment (no secrets inherited).

## 5. Secrets

- Provider keys, channel tokens, TOTP secrets, push keys: AES-256-GCM envelope encryption, per-record data key wrapped by `MASTER_KEY` (Docker secret), `key_version` for rotation.
- Keys are never returned to the browser; masked hint only. Test and model-list calls with stored keys are pinned to the stored base URL.
- Redaction pass on every log line, LLM call body, and channel delivery (keys, bearer tokens, emails optional).
- `.env` never committed; `.env.example` documents variables.

## 6. Skills and supply chain

- No open marketplace. Skills come from: built-in, our own repo (signed commit), or agent proposals approved in the review queue.
- Every skill save is scanned (secrets, injection patterns, references to blocked tools).
- Python deps hash-locked (`uv.lock`), JS deps lockfile, images pinned by digest, Renovate for updates, Trivy scan in CI, license check in CI.
- Pattern ports from upstream are reviewed code in our repo, not live dependencies on fast-moving projects.

## 7. Exposure

- Only `web` (8500) is reachable through the shared Caddy; TLS terminates there.
- Temporal UI, rustfs console, Langfuse reachable only over Tailscale.
- Security headers on `web`: CSP (no inline scripts, `connect-src 'self'`), HSTS (via Caddy), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

## 8. Audit

- `audit_log` is append-only with a hash chain; every key change, policy change, approval decision, skill approval and agent permission change is recorded with before/after.
- Activity page shows it; export to CSV for owners.

## 9. P8 security checklist (all green, 2026-10-02)

- [x] No service except `web` listens on a public interface. Dev binds everything to
  127.0.0.1; `docker-compose.vps.yml` publishes only web (127.0.0.1:8500) and the Temporal
  UI (127.0.0.1:8502), and the data network is internal (verified: Postgres has no route out).
- [x] All containers non-root, `cap_drop: ALL`, `no-new-privileges` (checked per process:
  999, 999, 1000, 1000, 10001, 10001, 10001, 101; obs services likewise).
- [x] Hardline policies covered by tests, each tried in "auto" mode with every tool on allow
  (`tests/test_security.py`: unknown tool, oversized arguments, internal addresses as
  literals and as names that resolve inside, a globally denied tool is neither offered
  nor run).
- [x] SSRF guard tests: private, loopback, link-local, CGNAT, IPv6 and IPv4-mapped
  literals; a name with one private record; DNS rebinding (the connection is pinned to
  the checked IP, Host header and TLS name kept); redirects to internal targets.
- [x] Prompt-injection suite: fetched pages and brain pages cannot close their fence
  (random tag per fence, fence-like text defused); recalled facts cannot close the
  `<memory>` block; agent core memory refuses rule overrides and secrets; skills with
  overrides are blocked by the scan.
- [x] Key exfil: a stored key is never sent to a caller-supplied URL (test endpoint and
  base URL change both covered).
- [x] Approval tokens: expired, replayed, and from a user since demoted to viewer are all
  refused; stored hashed only.
- [x] Backup restore drill completed (docs/DOCKER-AND-DEPLOY.md section 10).
- [x] Trivy: zero critical vulnerabilities in `agentic-py`, `agentic-web`, `agentic-backup`.

## 10. As built in P8 (2026-10-02)

Fixed during the review (each has a test):

| Finding | Fix |
|---|---|
| DNS rebinding: the guard checked a name, the HTTP client resolved it again | `ssrf.pinned()`: connect to the vetted IP (web_fetch and every provider call) |
| A page containing `>>>` could end its fence and talk to the model | Nonce fences (`core/fence.py`) on every untrusted block |
| A fact containing `</memory>` could close the recalled-memory block | Defused in recall lines |
| An agent could be talked into writing "ignore the rules" into its core memory, which enters every future system prompt | Core memory refuses overrides and secrets |
| 100.64.0.0/10 (CGNAT, Tailscale) counted as public | `is_global` check, IPv4-mapped IPv6 unwrapped |
| Production with a weak secret or missing master key failed late or not at all | `config.check()` refuses to start |
| A globally denied tool was still offered to the model | Hidden from the tool list |
| ~20 open browser tabs exhausted the database pool (denial of service by normal use) | Event streams hold no database connection; one Valkey subscription per process |
| Traces would have carried secret values | `core/redact.py` masks values before anything leaves |

Not built (still open): TOTP, OIDC, a master-key rotation tool, CI with Trivy on every
build (no remote repository yet). Login rate limiting is in place (5 per email, 20 per IP,
15 minutes).
