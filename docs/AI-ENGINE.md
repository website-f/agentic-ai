# AI Engine

> **Built in P1 (2026-10-01).** Code: `apps/api/agentic/engine/` (presets, client, errors, store, tester, gateway), `api/routers/ai_engine.py`, `core/crypto.py`, `core/ssrf.py`, `workflows/engine_activities.py`; UI in `apps/web/src/pages/ai-engine/`. Differences from the plan below: health history lives in `ai_provider_checks`; budgets moved to P7 with agents; calls are written directly (no Valkey batching yet). Verified live against all six real endpoints with fake keys: every one is rejected at step 1. HuggingFace's router `/models` turned out to be public, so its key check is `whoami-v2`.

The AI Engine is where users paste provider keys, test them, pick models, and see what every agent spends. It is a port of the CrawlOps gateway (`CrawlOps/backend/app/services/gateway.py`, `routers/ai_engine.py`, `services/crypto.py`, `frontend/src/pages/AIEngine.tsx`), upgraded for agents.

## 1. What we keep from CrawlOps

- Providers live in the DB with encrypted keys; the UI only ever sees a masked hint (`…a9F2`).
- Every provider is called through the OpenAI-compatible `/chat/completions`, `/embeddings`, `/models` shape.
- Priority-ordered fallback per task group, skipping providers in cooldown (Valkey key `ai_cooldown:<id>`, 60 s on network error, 300 s on 401/403/429/5xx).
- Reasoning-model detection: empty reply with `finish_reason=length` means hidden thinking ate the budget; retry once with a larger floor and remember it for 7 days.
- `accept` callback: a reply that fails validation (bad JSON, empty) falls through to the next provider.
- **Key exfil guard:** when testing or listing models with a *stored* key, the destination is pinned to that provider's stored `base_url`. A caller-supplied URL never receives a decrypted stored key.

## 2. What we add

| Gap in CrawlOps version | Upgrade |
|---|---|
| Test is one 2-token ping (fails on reasoning models, gives one opaque error) | 3-step test with per-step result, error classification and rate-limit readout (section 4) |
| Task groups fixed (judge, enrich, agent, embed) | User-defined **model groups**: `smart`, `fast`, `bulk`, `reasoning`, `vision`, `embed`, `tools`; each an ordered list of (provider, model) |
| No cost | `ai_models` price table (input, output, cached input per 1M tokens), editable, seeded with known prices |
| Usage row has prompt + completion only | Also cached tokens, reasoning tokens, latency, status, agent, task, workspace, cost |
| Sync DB write per call | Batched async writes via a Valkey list drained every 2 s |
| No budgets | Per-agent and per-workspace budgets with alert at 80 % and auto-pause at 100 % |
| No health view | Scheduled health check every 30 min; status chip per provider; history sparkline |
| Fernet with key derived from `SECRET_KEY` | AES-256-GCM envelope encryption, `key_version` column, master key from Docker secret, rotation command |
| No streaming | SSE streaming for agent chat |
| No capability info | Per-model flags: tools, JSON mode, vision, embeddings, context window, reasoning |

## 3. Provider presets (seeded with no keys)

| Provider | Base URL | Tier | Default priority | Key check endpoint | Notes |
|---|---|---|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | free | 10 | `GET /models` | Very low latency; returns `x-ratelimit-*` headers |
| OpenRouter | `https://openrouter.ai/api/v1` | free + paid | 20 | `GET /models` (public) **plus** key info endpoint to confirm the key and credit | `:free` model variants; pass-through provider caching |
| Mistral | `https://api.mistral.ai/v1` | free + paid | 30 | `GET /models` | Has embeddings (`mistral-embed`) |
| HuggingFace | `https://router.huggingface.co/v1` | free + paid | 40 | `GET /models`, fallback `GET https://huggingface.co/api/whoami-v2` | Router picks an inference provider per model |
| DeepSeek | `https://api.deepseek.com/v1` | paid | 50 | `GET /models` | Automatic context caching (cache-hit tokens billed lower) |
| OpenAI | `https://api.openai.com/v1` | paid | 60 | `GET /models` | Automatic prompt caching from 1,024 tokens; embeddings |
| Ollama (optional) | `http://<host>:11434/v1` | local | 5 | `GET /models` | Private-network URL allowed only for this provider type, via allowlist |
| Anthropic, Gemini (optional, disabled) | OpenAI-compatible endpoints | paid | 70+ | `GET /models` | Added later for explicit cache control |

Verify each base URL and key-check endpoint against the provider docs when P1 starts; providers change these.

### Subscription sign-in (experimental, off by default)

Besides pasting an API key, a provider can be connected by OAuth sign-in so an existing subscription plan is used where the vendor's own tooling supports that flow (Hermes Agent does this; OpenAI's device login used by Codex-style clients is the known working case). It is stored as a provider whose credential is a refreshable token instead of a static key, and the same routing, budgets and usage logging apply. The UI states the caveats plainly: the flow is governed by the consumer plan's terms and rate limits, the vendor can change or revoke it, and it is per person, so each user connects their own account. API keys stay the recommended path.

## 4. Test connection

One button, three steps, each shown live with a status chip, timing and plain-language error.

| Step | Request | Pass when | Shows |
|---|---|---|---|
| 1. Key and reachability | `GET {base}/models` with the key | HTTP 200 and a model list | model count, latency |
| 2. Chat round-trip | `POST {base}/chat/completions` with `"Reply with the word OK"`, `max_tokens` 16 (auto-raised for reasoning models) | non-empty reply | reply text, served model, latency, prompt/completion/cached tokens, cost |
| 3. Capabilities (optional) | tiny tool-call request, JSON-mode request, and `/embeddings` if the model is in the `embed` group | each returns a valid shape | checkmarks per capability |

**Error classification** (shown as a sentence, raw body in a disclosure):

| Signal | Message shown |
|---|---|
| 401 | "The key was rejected. Check it was copied fully and is still active." |
| 403 | "The key works but this account cannot use that model or endpoint." |
| 404 on model | "This model ID does not exist for this provider. Pick one from the list." |
| 429 | "Rate limit hit. Resets in {retry-after}. Free tiers reset per minute or per day." |
| 402 / insufficient credit | "No credit left on this account." |
| 5xx | "The provider is having problems. Try again shortly." |
| timeout / DNS / TLS | "Could not reach {host}." |

**Rate-limit readout:** parse `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `retry-after` where present and show them under the result.

**Security:** test calls use the pinned stored URL for stored keys; custom URLs pass the SSRF guard (no private ranges except allowlisted Ollama hosts); test traffic is logged as `task=engine.test`, never with the key.

## 5. Model discovery and capability map

- "Fetch models" pulls `/models`, then merges with the seeded `ai_models` table (prices, context window, flags).
- Unknown models are added with flags `unknown` and can be tagged by hand.
- Free-tier model IDs churn (CrawlOps lesson): when a model 404s during routing, the engine marks it `stale`, skips it, and shows a banner on the AI Engine page.

## 6. Routing

```
resolve(group="smart", needs={tools:true}) ->
  for (provider, model) in group order:
     skip if provider disabled, cooling, over budget, or model lacks a needed capability
     call; on 401/403/429/5xx -> cool + next; on unusable reply -> next
  raise GatewayUnavailable(explain why: no key / disabled / all cooling)
```

Agents never name a provider directly; they name a group. Users reorder groups by drag and drop.

**Cascade option per group:** try the first (cheap) model, validate the answer with a deterministic check or a tiny judge, escalate to the next model only on failure. Used for `bulk` and `fast`.

## 7. Usage and cost (AI Engine > Usage)

- Tokens and cost by provider, model, agent, task, day (stacked area + table).
- Cache-hit ratio per provider (cached input / total input).
- Output-to-input ratio per agent (flags agents that ramble).
- Top 10 most expensive prompts of the week, with a link to the trace.
- Budget bars per agent with alert and pause thresholds.

## 8. API

```
GET    /api/ai/providers
POST   /api/ai/providers                 {name, base_url, api_key, tier, priority, enabled}
PUT    /api/ai/providers/{id}
DELETE /api/ai/providers/{id}
POST   /api/ai/providers/test            {provider_id | base_url+api_key, model, steps[]}  -> streamed step results
POST   /api/ai/providers/{id}/models     -> fetch + merge
GET    /api/ai/models?capability=tools
GET    /api/ai/groups        PUT /api/ai/groups/{name}
GET    /api/ai/usage?from&to&group_by=provider|model|agent|task|day
GET    /api/ai/health
```

## 9. UI (AI Engine page)

- Provider cards in priority order (drag to reorder): logo (Simple Icons where available), tier badge, masked key, health chip, last test time, monthly spend.
- Add / edit in a side sheet (bottom sheet on mobile): preset picker fills the base URL; key field with show/hide and paste button; **Test connection** runs the 3 steps inline with an animated step list.
- Model groups editor: columns per group, model chips draggable between them, capability icons on each chip.
- Usage tab with the charts above.
