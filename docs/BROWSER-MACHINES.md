# Per-agent browser machines

How the browser service (`apps/browser/service.py`) gives each agent its own persistent,
isolated browser "computer" that stays signed in between tasks and interacts like a person.
This is for the user's own authorized automation (their accounts, public research). It adds
**no** anonymizer/Tor routing and **no** anti-ban evasion: every host guard, egress hop,
approval gate and secret protection described in [AGENT-RUNTIME.md](AGENT-RUNTIME.md) §16 and
the service docstring is unchanged.

## The model

- **A machine = one agent.** Each agent gets one Camoufox **persistent-context** browser
  (`AsyncCamoufox(persistent_context=True, user_data_dir=…)`), keyed by agent id. Its profile
  (cookies, localStorage, IndexedDB) lives on disk under `BROWSER_PROFILES_DIR`
  (`/data/browser-profiles/<agent>`), a **persistent named volume** (`browserprofiles`), **not
  tmpfs** — so the agent stays signed in across tasks and across service restarts.
- **A tab = one task.** A browsing task opens a page (tab) in its agent's machine. Several of
  the agent's tasks share the one machine (and its cookies). `close_for_task` closes the
  **tab**, not the machine; the machine stays warm for the agent's next task.
- **A pool, LRU, idle-reap.** At most `BROWSER_MAX_LIVE` (default 6) machines **run** at once.
  When an agent needs to browse and its machine isn't running, it is launched from its profile.
  If the pool is full, the **least-recently-used idle** machine is closed (its profile stays on
  disk) to make room. If every running machine is busy (an action in flight, or a tab held for
  an approval), the caller gets `503` and the agent-side client waits a few seconds and retries,
  then tells the agent "all browsers are in use". An idle machine with no open tabs is stopped
  after `BROWSER_MACHINE_IDLE` (default 600 s); idle tabs are reaped after
  `BROWSER_IDLE_SECONDS` (600 s). A tab/machine held for a pending approval survives up to
  `BROWSER_HOLD_MAX` (7200 s), as before.
- **Deterministic identity.** Each machine's OS, screen size, window size and locale are
  derived from a hash of the agent id (`_identity`), so "agent X" looks like the same computer
  every time. The per-launch anti-fingerprint noise (canvas/audio/font seeds) that Camoufox
  randomizes is left alone; the stable surfaces plus the persistent profile are what make the
  machine recognisably the same. Turn the spoof off with `BROWSER_FINGERPRINT=0`.
- **The P31 "browse on my PC" path is separate.** A task with a device drives the person's real
  Chrome/Edge over the CDP relay (`_open_on_pc`). That machine is standalone (`remote=True`),
  never enters the pool, is never launched or stopped by us, and uses no server profile. All the
  same page guards (allowed hosts, private-address block, pacing) still apply.

## Human interaction

Layered on top of Camoufox's own humanized cursor (kept — it is the engine-level feature), all
bounded and env-toggleable, all off when the corresponding env is `0`:

- **Typing** (`BROWSER_HUMAN_TYPING`, on): non-secret `type` focuses the field itself and types
  key by key with a jittered cadence (`BROWSER_HUMAN_TYPE_MS_MIN`/`MAX`, default 60–160 ms,
  longer after spaces/punctuation) and the occasional small backspace-correct
  (`BROWSER_HUMAN_TYPO_RATE`); the final text is always exact. **Secrets keep the protected
  path** (`fill` into the marked password field): no char-timing side channel, and the
  `data-agentic-secret` guard and "password only into a password field" check are unchanged.
- **Clicking** (`BROWSER_HUMAN_CLICK`, on): before a click, scroll into view, walk a Bézier
  cursor path to the element with a slight overshoot and correction, hover, dwell
  (`BROWSER_HUMAN_CLICK_DWELL_MS`), then click. The `SUBMIT_NEEDS_APPROVAL` gate is unchanged.
- **Scrolling** (`BROWSER_HUMAN_SCROLL`, on): one scroll is done in several small wheel steps.
- **The honest concurrency limit.** Camoufox's humanized cursor deadlocks once 3+ contexts click
  at the same instant, so **every real click across the whole pool is serialized by one global
  gate** (`_click_gate`). Machines otherwise run in parallel, but only one click happens at a
  time; this is the real cap, not the 6 machines. A further tab for the *same* agent beyond
  `BROWSER_TABS_PER_MACHINE` (default 2) waits, because 3+ live pages in one Firefox process
  stall (measured).

## The "clicks the field several times" fix

Agents used to click a text field (to focus) and then `type` (which already focuses), and,
seeing no visible change after the click, click it again — robotic. Fixed by:

- `type` focuses the field itself, so no pre-click is ever needed;
- a `click` on a text field returns an observation that says the field is now focused and to
  call `type` next;
- a `click` on an already-focused field is a no-op (no second click);
- the `browser_click` / `browser_type` tool descriptions tell the model to call `type` directly.

## Env knobs (browser service)

| Env | Default | Meaning |
|---|---|---|
| `BROWSER_MAX_LIVE` | 6 (`BROWSER_MAX_SESSIONS` fallback) | machines running at once |
| `BROWSER_PROFILES_DIR` | `/data/browser-profiles` | persistent profile root (a volume) |
| `BROWSER_MACHINE_IDLE` | 600 | seconds before an empty machine is stopped |
| `BROWSER_IDLE_SECONDS` | 600 | seconds before an idle tab is reaped |
| `BROWSER_HOLD_MAX` | 7200 | max hold for a pending approval |
| `BROWSER_TABS_PER_MACHINE` | 2 (`BROWSER_PER_PROCESS` fallback) | concurrent tabs per machine |
| `BROWSER_FINGERPRINT` | true | stable per-agent OS/screen/UA identity |
| `BROWSER_LOCALE` | `en-US,en` | browser language per machine |
| `BROWSER_HUMANIZE` | true | Camoufox humanized cursor (safe now, see gate) |
| `BROWSER_HUMAN_TYPING` | true | key-by-key typing |
| `BROWSER_HUMAN_TYPE_MS_MIN` / `_MAX` | 60 / 160 | per-char delay range (ms) |
| `BROWSER_HUMAN_TYPO_RATE` | 0.02 | chance of a backspace-corrected typo per char |
| `BROWSER_HUMAN_CLICK` | true | Bézier cursor path + hover + dwell before a click |
| `BROWSER_HUMAN_CLICK_DWELL_MS` | 120 | dwell before clicking (ms) |
| `BROWSER_HUMAN_SCROLL` | true | multi-step scrolling |

Tests set `BROWSER_HUMAN_TYPING=0` (and friends) for speed/determinism.

## RAM

Up to ~6 persistent Firefoxes, one per agent, at ~400–600 MB each. `docker-compose.yml` sets the
browser service `mem_limit: 4g` (and `shm_size: 2gb`), which fits the 23 GB VPS alongside
postgres (1.5 g), worker (1.5 g), api (1 g) and ollama (1.5 g). The global click gate means they
never all work at the same instant. The `browserprofiles` volume grows with cookies/cache; it is
not part of the restic backup (an agent can simply sign in again, and P21 saved logins are
backed up separately, encrypted).
