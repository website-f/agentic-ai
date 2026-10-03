# P14: Agents help each other, and learn once (2026-10-03)

When an agent gets stuck (a script fails, a tool errors), it asks the colleague with the
right expertise. The fix is saved as a **lesson** in the office wiki. The next time anyone
hits the same problem, the lesson is found in memory and the expert is not disturbed.

## 1. How it works

| Step | Where | What happens |
|---|---|---|
| Stuck | `agents/runtime.py` `_help_hint_once` | A tool fails (Python traceback, non-zero exit, `Error:`). The result gets **one** tip per task: "ask a colleague with kind='help'". Never for browser tools (they recover on their own) or ask_colleague itself |
| Ask by expertise | `teams/colleague.py` `find_agent` | `ask_colleague(agent="software engineer", kind="help", context=<exact error>)`. Exact name first, else the best match on role, department and template |
| Memory first | `colleague.memory_answer` | The office notes are numbered; the cheap model (local first, then `fast`) only answers `{"note": n}`, and that note is quoted verbatim. A hit means no child task and no expert tokens |
| Expert solves | `colleague.plan(kind="help")` | A child task "Help for Maya: …" for the expert, with the error, asking them to reproduce it in `run_python` and reply as `ROOT CAUSE / FIX / LESSON` |
| Learn | `colleague.remember_answer(helping=True)` | Saved to `wiki/lessons/<date>-<slug>-<id>.md` (`type: lesson`, `asked_by`, `solved_by`, "What happened", "Solution"). Recall finds it for every agent from then on |

## 2. Live demo: `deploy/demo/help_scenario.py`

Maya (Marketing Executive) runs the team's ad-report script on a new ads-manager export.
The export changed format (BOM, `;` separator, `RM 1,200.50`, `N/A` rows), so the script
fails with `KeyError: 'campaign'`. Eko (Software Engineer) is in another department.

| Run | What happened | Model calls | Cost |
|---|---|---|---|
| September, first time | Script fails → tip → Maya asks "software engineer" → Eko reproduces it in the sandbox, sends a tested fix → lesson saved → Maya finishes the report | 21 (13 Maya, 6 Eko, 2 local) | $0.0164 |
| October, the next month | Recall brings back the lesson; Maya applies it herself. **Eko is not woken** | 10 (9 Maya, 1 local) | $0.0065 |
| Both again, after the Calculator fix below | Lesson reused both times, 6 steps each | 6 + 6 | $0.0057, $0.0051 |

86-93 % of prompt tokens were cache hits. Local-model calls cost $0.

## 3. Token savings in this phase

- The memory check returns a note number (7 output tokens), not a rewritten answer.
- The tip appears once per task and only after a real failure.
- `calc` now says not to re-check numbers `run_python` already computed. That alone took a
  run from 13 steps to 6 (each step resends the conversation).
- Browser tools are not offered when no browser is configured.
- Side jobs (file summaries, page digests, memory checks) go to the free local model first.

## 4. The local backup model

`qwen3:0.6b` on Ollama, sized for a 4 GB VPS: see `docs/SMALL-SERVER.md`.

## 5. Tests

`apps/api/tests/test_helping.py`: expertise routing; help → lesson → reuse from memory with no
child task; one tip per task; local model registered once; `chat_first` order, thinking off,
and chat backup mode with no tools; no browser tools without a browser.
