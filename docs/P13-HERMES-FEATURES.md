# P13 — Features ported from Hermes Agent (2026-10-03)

Hermes Agent (NousResearch, MIT) was studied and its most valuable ideas re-implemented for our
platform (credited in THIRD_PARTY_NOTICES). Hermes itself is cloned at `Qbot_Main/_ref/hermes-agent`
for reference only — none of its code is in this repo.

## 1. Untrusted-content defences — `core/threats.py`
Scoped scanner (all ⊂ context ⊂ strict) for prompt-injection and exfiltration, with
invisible-unicode detection and NFKC folding of look-alike characters. Strict scope blocks
agent-written text that would enter a system prompt (core memory, brain facts, skill saves);
context scope flags fetched pages and tool results with a caution line (they stay fenced as
data, never blocked). Tests: `test_threats.py`.

## 2. Goal loop — `agents/goals.py`, Task.goal/goal_tries (migration 0014)
A task can carry a "done when…". When it finishes, the agent's model judges the result against
the goal; if not met and under `MAX_GOAL_TRIES` (4), the agent is nudged with what is missing and
the same work continues. Set in the new-task dialog ("Keep going until"). Tests: `test_goals.py`.

## 3. Web search — `agents/websearch.py`, tool `web_search`
Backends tried in order: SearXNG (self-hosted, keyless), Brave, Tavily (keys), then a keyless
DuckDuckGo fallback so search works with no setup. SSRF-guarded like web_fetch. Config in
`core/config.py` (searxng_url / brave_search_key / tavily_key). Tests: `test_websearch.py`.

## 4. Vision — `agents/vision.py`, tool `view_image`
An agent looks at an uploaded image and answers about it, falling back to the file's OCR text
when no vision model is available. Tests: `test_vision.py`.

## 5. MCP client — `agents/mcp.py`, `api/routers/mcp_servers.py`, McpServer (migration 0015)
Connect external MCP servers over HTTP (admin, "MCP tools" page). Their tools are reached through
three static bridge tools — `tool_search`, `tool_describe`, `tool_call` — so schemas never fill
the prompt; `tool_call` is approval-gated (high risk). The bridge is offered only when a server is
connected. HTTP only — the office never spawns local processes from a model's request. Auth headers
are envelope-encrypted. Tests: `test_mcp.py`.

## 6. Code sandbox — `apps/sandbox/`, `agents/codetool.py`, tool `run_python`
A separate, hardened container (`deploy/sandbox.Dockerfile`) on an `internal: true` network with
NO internet, NO database and NO secrets. Each run is a fresh subprocess with CPU, memory, process
and file-size rlimits and a wall-clock timeout, in an ephemeral workdir. Input files go in by id;
files written to ./out come back as generated office files. `run_python` is approval-gated and only
offered when `AGENTIC_SANDBOX_URL` is set. Verified against the live container: no internet, cannot
reach Postgres, no secrets in env, CPU/memory/time all enforced; openpyxl/matplotlib/pillow/docx
available. Tests: `test_codetool.py` (isolation checked against the running container).
