# Open-source integration

"Combine everything into one system" means four different things depending on the project. Picking the right mode per project is what keeps the stack small, upgradable, and license-clean.

| Mode | Meaning | Upgrade path |
|---|---|---|
| **Service** | Run the upstream image as a container in our compose | Bump pinned image digest |
| **Library** | Pinned dependency in `uv.lock` / `pnpm-lock.yaml` | Renovate PR + tests |
| **Pattern port** | Read the upstream code in `reference/`, re-implement the idea inside our code | We own it; check upstream changelog quarterly |
| **Code lift** | Copy specific files (MIT/Apache only) into `apps/api/agentic/ports/<project>/` with the upstream LICENSE, a NOTICE line, and the upstream commit hash | Manual diff against upstream |

## Integration matrix

| Project | License | Mode | What we take |
|---|---|---|---|
| **Agno** (`agno-agi/agno`) | Apache-2.0 | Library | Agent loop, teams, tool calling, sessions, model adapters |
| **Temporal** (`temporalio/temporal`, `temporalio/sdk-python`) | MIT | Service + library | Durable workflows, signals, schedules, task queues |
| **Paperclip** (`paperclipai/paperclip`) | MIT | Pattern port | Org chart, reporting lines, heartbeats, per-agent budgets with auto-pause, review gates, activity log schema |
| **Hermes Agent** (`NousResearch/hermes-agent`) | MIT | Pattern port + selective code lift | Capped memory files with frozen snapshot, session recall, `skill_manage`, staged skill writes, curator, delegation limits, Kanban model, cron ledger, hardline blocklist, injection scanner, secret redaction. Full list in AGENT-RUNTIME.md |
| **hermes-agent-self-evolution** | MIT | Pattern port (P4+) | DSPy + GEPA trace-driven skill optimization, changes go through review |
| **OpenClaw** (`openclaw/openclaw`) | MIT | Pattern port | Dreaming with threshold promotion and diary, memory flush before compaction, bindings, approval cards (once / always), ask-on-miss, OpenAI-compatible agent endpoint. Optional later: run it isolated as a channel front-end |
| **GBrain** (`garrytan/gbrain`) | MIT | Pattern port | Hybrid retrieval recipe (vector + keyword + RRF + source-tier boost), dream-cycle tasks (dedupe, citation fix, salience, contradictions) |
| **Karpathy LLM wiki** (gist) | n/a | Pattern | Vault layout: `raw/`, `wiki/`, `index.md`, `log.md`, schema file |
| **Mem0** (`mem0ai/mem0`) | Apache-2.0 | Library | Fact extraction and storage on pgvector |
| **Hindsight** (`vectorize-io/hindsight`) | MIT | Reference only | Swap-in candidate if Mem0 recall quality is not enough; its retain/recall/reflect split informs our API |
| **Basic Memory** | AGPL-3.0 | Not embedded | We only stay format-compatible (markdown + wikilinks) so users can point it at the vault themselves |
| **agent-town** (`geezerrrr/agent-town`) | MIT | Pattern port | Phaser + Tiled office structure, "walk up and assign a task" interaction, typed event bus |
| **pixel-agents** (`pablodelucca/pixel-agents`) | MIT | Pattern port | Character state machine, BFS pathfinding, provider-adapter boundary, layout editor idea |
| **Star-Office-UI** | code MIT, art non-commercial | Idea only | State-to-room mapping. **No assets** |
| **Phaser 4** | MIT | Library | Office rendering |
| **Kenney Roguelike Indoors, JIK-A-4 MetroCity** | CC0 | Committed assets | Default production art (free-only constraint) |
| **LimeZu Modern Interiors / Modern Office** | Paid, commercial OK with credit, no redistribution | Optional private assets | Optional art upgrade only; the default build ships entirely on the CC0 packs |
| **CrawlOps AI gateway** (own code) | ours | Code lift | `gateway.py`, `ai_engine.py`, `crypto.py`, provider presets, `AIEngine.tsx` patterns |
| **shadcn/ui** | MIT | Code lift (CLI) | Components, then restyled |
| **Langfuse** | MIT core | Service (profile `obs`) | Traces, prompt versions, datasets |
| **fastembed** | Apache-2.0 | Library | Local embeddings |
| **DSPy** | MIT | Library (P4+) | Optimizer |
| **Postgres + pgvector, Valkey, rustfs, Ollama** | permissive | Service | Infra |

## Reference clones

`reference/` is git-ignored. `deploy/scripts/fetch-references.sh` clones each pattern-port project at a pinned commit so every port can cite the exact source it was based on.

```
reference/
  hermes-agent/        @<commit>
  openclaw/            @<commit>
  paperclip/           @<commit>
  gbrain/              @<commit>
  agent-town/          @<commit>
  pixel-agents/        @<commit>
  crawlops-gateway/    (copied from ../CrawlOps)
```

`reference/MANIFEST.md` records repo URL, commit, license, and which of our files were ported from it.

## License guardrails

1. Only MIT, Apache-2.0, BSD, MPL-2.0 (unmodified use), CC0, PostgreSQL code may enter `apps/` or `packages/`.
2. AGPL, SSPL, ELv2, BUSL, Sustainable Use, Commons Clause: may be studied in `reference/`, never copied, never linked.
3. Every code lift adds a line to `THIRD_PARTY_NOTICES.md` with project, license, commit, and file list.
4. CI runs a license check (`pip-licenses`, `license-checker`) and fails on disallowed licenses.
5. Paid art (LimeZu) lives in a private `assets-private/` directory or private repo, mounted at build time, never committed to the public repo.

## Version pins to set in P0

Record exact versions in `deploy/VERSIONS.md` at scaffold time: Agno, temporalio SDK, Temporal server, Temporal UI, Mem0, fastembed, FastAPI, SQLAlchemy, Phaser, React, Vite, Tailwind, Postgres image digest, Valkey image digest, rustfs digest.
