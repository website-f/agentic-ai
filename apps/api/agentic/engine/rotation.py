"""P105: a group's shared models take turns, and the router remembers how each one answers.

The owner can tick "Share the work between these" on a group's leading models (a member's
`shared` flag; they are kept at the top of the list). The gateway then asks them in turns
instead of always the first one:

- Turns are weighted by recent health: a model that answers faster or fails less gets more
  of the work, a failing one a small share (enough to notice when it is well again).
- An agent's (or a task's) consecutive calls stay on the model that answered last for a few
  minutes, so the provider's prompt cache keeps paying off; a model that is failing is left.
- If the chosen model fails or rests, the next shared model is asked, then the rest of the
  list in order (the gateway's walk, unchanged).

All state is in Valkey, shared by the api and every worker: a turn counter per group, a sticky
choice per agent or task, and a smoothed answer time and failure share per provider + model
(a hash; nothing is written to the database per call). Valkey being away only costs the
rotation: the group is walked in its saved order.
"""

import logging
from dataclasses import dataclass
from typing import Any

from ..core.valkey import valkey

log = logging.getLogger("agentic.engine")

ALPHA = 0.3  # weight of the newest call in the smoothed values
HEALTH_TTL = 6 * 3600  # a model unused this long starts fresh
STICK_TTL = 300  # an agent's calls stay on one model this long after its last answer
UNHEALTHY = 0.5  # smoothed failure share above which stickiness lets go
MIN_WEIGHT = 0.05  # even a failing shared model gets a little work, so it can recover
PHI = 0.6180339887498949  # golden ratio: turn n lands at frac(n * PHI), evenly spread
# Answer times under this count as equally fast: a person does not feel 200 ms against 400 ms,
# and a turn should not swing on noise.
FLOOR_MS = 500.0

# One round trip, atomic across the api and the workers: fold one call into the averages.
_UPDATE = """
local a = tonumber(ARGV[1])
local bad = tonumber(ARGV[2])
local ms = tonumber(ARGV[3])
local f = tonumber(redis.call('HGET', KEYS[1], 'fail') or '0')
redis.call('HSET', KEYS[1], 'fail', tostring(f + a * (bad - f)))
if ms >= 0 then
  local m = redis.call('HGET', KEYS[1], 'ms')
  if m then m = tonumber(m) + a * (ms - tonumber(m)) else m = ms end
  redis.call('HSET', KEYS[1], 'ms', tostring(m))
end
redis.call('HINCRBY', KEYS[1], 'n', 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1
"""


@dataclass(frozen=True)
class Health:
    ms: float | None = None  # smoothed answer time of good answers
    fail: float = 0.0  # smoothed share of failed calls, 0..1
    n: int = 0

    @classmethod
    def parse(cls, raw: dict[str, str] | None) -> "Health":
        if not raw:
            return cls()
        try:
            return cls(
                ms=float(raw["ms"]) if raw.get("ms") else None,
                fail=float(raw.get("fail") or 0),
                n=int(raw.get("n") or 0),
            )
        except ValueError:
            return cls()

    @property
    def healthy(self) -> bool:
        return self.fail < UNHEALTHY


def key_of(m: dict[str, Any]) -> str:
    return f"{m['provider_id']}|{m['model_id']}"


def _health_key(provider_id: str, model_id: str) -> str:
    return f"ai_health:{provider_id}:{model_id}"


def pool_of(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [m for m in members if m.get("shared")]


def weight(h: Health, best_ms: float) -> float:
    """Faster and steadier is more work: sqrt of the speed ratio (1.0 s vs 2.0 s is about
    59/41, not 67/33) times the square of the success share."""
    ms = max(h.ms or best_ms, FLOOR_MS)
    speed = (max(best_ms, FLOOR_MS) / ms) ** 0.5
    return max(MIN_WEIGHT, speed * max(0.0, 1.0 - h.fail) ** 2)


def plan(
    members: list[dict[str, Any]],
    health: dict[str, Health],
    turn: int,
    sticky: str | None = None,
) -> list[dict[str, Any]]:
    """The order to ask the members in: the shared ones first (the sticky one when it is
    healthy, else the one whose turn it is, then the others best first), then the rest of
    the list in its order. Pure, so the tests can drive it."""
    pool = pool_of(members)
    rest = [m for m in members if not m.get("shared")]
    if len(pool) < 2:
        return pool + rest
    known = [health[k].ms for k in map(key_of, pool) if k in health and health[k].ms]
    best = min(known) if known else 1000.0
    weights = [weight(health.get(key_of(m), Health()), best) for m in pool]
    first: int | None = None
    if sticky is not None:
        for i, m in enumerate(pool):
            if key_of(m) == sticky and health.get(sticky, Health()).healthy:
                first = i
                break
    if first is None:
        u = (turn * PHI) % 1.0
        total = sum(weights)
        acc = 0.0
        first = len(pool) - 1
        for i, w in enumerate(weights):
            acc += w / total
            if u < acc:
                first = i
                break
    others = sorted((i for i in range(len(pool)) if i != first), key=lambda i: (-weights[i], i))
    return [pool[first], *(pool[i] for i in others), *rest]


def stick_key(group_id: str, agent_id: str | None, task_id: str | None) -> str | None:
    """A task's calls stay together; outside a task, an agent's (its chat)."""
    who = f"t:{task_id}" if task_id else (f"a:{agent_id}" if agent_id else None)
    return f"ai_stick:{group_id}:{who}" if who else None


async def order(
    group_id: str,
    members: list[dict[str, Any]],
    agent_id: str | None = None,
    task_id: str | None = None,
) -> list[dict[str, Any]]:
    """`plan` with the shared state read from Valkey in one round trip."""
    pool = pool_of(members)
    if len(pool) < 2:
        return pool + [m for m in members if not m.get("shared")]
    stick = stick_key(group_id, agent_id, task_id)
    try:
        pipe = valkey().pipeline(transaction=False)
        pipe.incr(f"ai_turn:{group_id}")
        for m in pool:
            pipe.hgetall(_health_key(m["provider_id"], m["model_id"]))
        if stick:
            pipe.get(stick)
        got = await pipe.execute()
    except Exception:  # noqa: BLE001 - no shared state: the saved order still works
        log.warning("rotation state unavailable; using the saved order", exc_info=True)
        return pool + [m for m in members if not m.get("shared")]
    turn = int(got[0] or 0)
    health = {key_of(m): Health.parse(raw) for m, raw in zip(pool, got[1:], strict=False)}
    sticky = got[len(pool) + 1] if stick else None
    return plan(members, health, turn, sticky)


async def note(
    provider_id: str,
    model_id: str,
    *,
    ok: bool,
    latency_ms: int | None,
    group_id: str | None = None,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> None:
    """Fold one call into the model's averages (`latency_ms` None: say nothing about speed)
    and, after a good answer, keep the agent's next calls on this model for a while."""
    try:
        pipe = valkey().pipeline(transaction=False)
        pipe.eval(
            _UPDATE,
            1,
            _health_key(provider_id, model_id),
            ALPHA,
            0 if ok else 1,
            -1 if latency_ms is None else latency_ms,
            HEALTH_TTL,
        )
        stick = stick_key(group_id, agent_id, task_id) if ok and group_id else None
        if stick:
            pipe.set(stick, f"{provider_id}|{model_id}", ex=STICK_TTL)
        await pipe.execute()
    except Exception:  # noqa: BLE001 - the answer matters more than the bookkeeping
        log.warning("could not update model health", exc_info=True)


async def health_of(provider_id: str, model_id: str) -> Health:
    try:
        return Health.parse(await valkey().hgetall(_health_key(provider_id, model_id)))
    except Exception:  # noqa: BLE001
        return Health()
