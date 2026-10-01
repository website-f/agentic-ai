# Data model (Postgres 17 + pgvector)

All tables carry `workspace_id` (except global ones) and `created_at` / `updated_at`. IDs are ULIDs with a type prefix (`ag_`, `tk_`, `ap_` ...). Row-level filtering by workspace happens in the repository layer for every query.

## Identity and access

| Table | Key columns |
|---|---|
| `workspaces` | id, name, slug, timezone, settings jsonb |
| `users` | id, email, name, password_hash (argon2id), totp_secret_enc, last_login_at |
| `memberships` | workspace_id, user_id, role (`owner\|admin\|operator\|approver\|viewer`) |
| `sessions` | id, user_id, expires_at, user_agent, ip |
| `api_tokens` | id, workspace_id, name, token_hash, scopes[], expires_at, last_used_at |

## Organization and agents

| Table | Key columns |
|---|---|
| `branches` | id, workspace_id, name, slug, color, office_map, isolated bool |
| `departments` | id, branch_id, name, slug, manager_agent_id, sop_paths jsonb, room_zone |
| `agents` | id, workspace_id, branch_id, department_id, slug, name, role, role_kind (`leaf\|orchestrator`), reports_to, sop_paths jsonb, model_group, status (`active\|paused\|retired`), desk_id, avatar_sprite, max_parallel_children, max_spawn_depth, heartbeat_cron, budget_monthly_usd, budget_daily_tokens |
| `agent_tools` | agent_id, tool_name, mode (`allow\|ask\|deny`), args_policy jsonb |
| `agent_core_memory` | agent_id, kind (`memory\|user`), content, char_cap, version, vault_commit |
| `chat_sessions` | id, workspace_id, agent_id, user_id, title, model_override |
| `messages` | id, session_id, role, content, tool_calls jsonb, tokens, tsv (tsvector, GIN) |

## Work

| Table | Key columns |
|---|---|
| `tasks` | id, workspace_id, title, brief, status, priority, assignee_agent_id, created_by, parent_task_id, depth, output_schema jsonb, result jsonb, workflow_id, due_at, blocked_reason |
| `task_events` | id, task_id, type, payload jsonb, actor |
| `approvals` | id, workspace_id, task_id, agent_id, tool_name, args_preview jsonb, risk, rule_id, status (`pending\|approved\|denied\|expired`), scope (`once\|always`), decided_by, decided_at, token_hash, expires_at |
| `policies` | id, workspace_id (null = global hardline), kind (`hardline\|risk\|allowlist`), match jsonb, effect, priority |
| `schedules` | id, workspace_id, agent_id, name, cron, timezone, payload jsonb, temporal_schedule_id, enabled |
| `job_executions` | id, schedule_id, state (`claimed\|running\|completed\|failed\|unknown`), attempt, started_at, finished_at, error_class, incident_signature, output_ref |
| `incidents` | signature, workspace_id, first_seen, last_seen, count, status |
| `broadcasts` | id, workspace_id, sender_user_id, audience jsonb (`all` \| branch_ids \| department_ids \| agent_ids), mode (`announcement\|directive`), body, requires_ack |
| `broadcast_receipts` | broadcast_id, agent_id, delivered_at, ack_at, reply_ref |
| `meetings` | id, workspace_id, task_id, initiator_agent_id, participant_agent_ids jsonb, topic, status, max_rounds, token_budget, summary jsonb, session_id, decision_page_id |

## Brain

| Table | Key columns |
|---|---|
| `brain_pages` | id, workspace_id, path, title, frontmatter jsonb, body, tier (`decision\|wiki\|raw\|log`), tsv (GIN), embedding vector(384) (HNSW), vault_commit, updated_by |
| `brain_links` | from_page_id, to_page_id, kind (`wikilink\|cites\|derived_from`) |
| `brain_facts` | managed by Mem0 + our columns: valid_from, valid_to, confidence, salience, source_ref, scope (`workspace\|agent\|user`) |
| `dream_runs` | id, workspace_id, date, diary_path, changes jsonb, status (`pending_review\|accepted\|partially_reverted`) |

## Skills

| Table | Key columns |
|---|---|
| `skills` | id, workspace_id, name, description, version, trust, status (`active\|retired`), path, embedding vector(384), created_by, approved_by |
| `skill_proposals` | id, skill_id (null = new), proposed_by_agent, reason, diff, trace_ref, scan_result jsonb, eval_result jsonb, status, reviewed_by |
| `skill_usage` | skill_id, task_id, success, tokens_used, ts |

## AI Engine

| Table | Key columns |
|---|---|
| `ai_providers` | id, workspace_id, name, preset, base_url, api_key_enc, key_version, key_hint, tier, priority, enabled, health (`ok\|degraded\|down`), last_test_at, last_test_result jsonb |
| `ai_models` | id, provider_id, model_id, context_window, caps jsonb (tools, json, vision, embed, reasoning), price_in, price_out, price_cached_in, stale |
| `model_groups` | workspace_id, name, members jsonb (ordered provider/model pairs), cascade bool |
| `llm_calls` | see MEMORY-AND-TOKENS.md section 7 (partitioned monthly) |
| `llm_usage_daily` | workspace_id, day, provider, model, agent_id, calls, prompt, completion, cached, cost |
| `budgets` | scope (`workspace\|agent`), scope_id, period, limit_usd, alert_pct, pause_pct |

## Channels, events, audit

| Table | Key columns |
|---|---|
| `channels` | id, workspace_id, kind (`telegram\|webpush\|api`), config_enc, enabled |
| `bindings` | id, channel_id, match (peer / group / account), agent_id, specificity |
| `deliveries` | id, channel_id, target, payload_ref, state, attempts, last_error |
| `push_subscriptions` | id, user_id, endpoint, keys_enc, ua, last_ok_at |
| `events` | seq bigserial, workspace_id, type, payload jsonb, ts (kept 7 days, for SSE replay) |
| `audit_log` | id, workspace_id, actor, action, target, before jsonb, after jsonb, ts, prev_hash, hash (hash chain, append-only) |

## Indexes and housekeeping

- GIN on every `tsv`; HNSW (`vector_cosine_ops`) on embeddings.
- `llm_calls` partitioned by month, old partitions detached after retention.
- `events` pruned after 7 days by a nightly job.
- `audit_log` has no UPDATE/DELETE grants for the app role.
