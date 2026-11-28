"""P148c (Fitri, 28 Nov 2026: "the AI response must be super fast"): where the time goes
between a person's message and the first word of the answer.

A trace is opened per chat turn or task step (`begin`) and carried in a context variable, so
every pre-step (memory recall, the scope check, the prompt, the tool list, the gateway's
member walk) can time itself with `step("name")` without being handed anything; steps that
run side by side (asyncio.gather) land in the same trace. `mark("name")` notes a moment once
(the provider call going out, its first byte, the first word shown).

Recording is always on (a few perf_counter reads); the structured log line is written only
with AGENTIC_AI_TIMING=1 (or the logger at DEBUG), so the live server stays quiet unless
someone is measuring. The last traces are also kept in memory (`recent`) for the tests.
"""

import contextlib
import json
import logging
import os
import time
from collections import deque
from collections.abc import Iterator
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("agentic.ai.timing")

KEEP = 50  # traces kept in memory for the tests and a debugging shell


def enabled() -> bool:
    return os.environ.get("AGENTIC_AI_TIMING", "").lower() in ("1", "true", "on", "yes") or (
        log.isEnabledFor(logging.DEBUG)
    )


@dataclass
class Trace:
    kind: str  # chat | task | api
    t0: float = field(default_factory=time.perf_counter)
    # (step, started ms after t0, took ms): in the order they finished.
    steps: list[tuple[str, float, float]] = field(default_factory=list)
    marks: dict[str, float] = field(default_factory=dict)
    info: dict[str, Any] = field(default_factory=dict)

    def now_ms(self) -> float:
        return (time.perf_counter() - self.t0) * 1000

    def mark(self, name: str) -> None:
        self.marks.setdefault(name, round(self.now_ms(), 2))

    def took(self, name: str) -> float:
        """Total ms spent in steps called `name` (0 when it never ran)."""
        return sum(ms for n, _, ms in self.steps if n == name)

    def span(self, name: str) -> tuple[float, float] | None:
        """(start, end) ms of the first step called `name`."""
        for n, start, ms in self.steps:
            if n == name:
                return start, start + ms
        return None

    def summary(self) -> dict[str, Any]:
        per: dict[str, float] = {}
        for n, _, ms in self.steps:
            per[n] = round(per.get(n, 0.0) + ms, 2)
        return {"kind": self.kind, "steps": per, "marks": self.marks, **self.info}


_current: ContextVar[Trace | None] = ContextVar("ai_timing", default=None)
recent: deque[Trace] = deque(maxlen=KEEP)


def current() -> Trace | None:
    return _current.get()


def begin(kind: str, **info: Any) -> tuple[Trace, Token[Trace | None]]:
    tr = Trace(kind=kind, info=dict(info))
    return tr, _current.set(tr)


def detach(token: Token[Trace | None]) -> None:
    """Stop tracing here (a task created meanwhile keeps its own copy of the trace)."""
    with contextlib.suppress(ValueError):
        _current.reset(token)


def end(tr: Trace, token: Token[Trace | None] | None = None, **info: Any) -> None:
    tr.info.update(info)
    tr.info.setdefault("total_ms", round(tr.now_ms(), 2))
    recent.append(tr)
    if token is not None:
        with contextlib.suppress(ValueError):  # reset from another context: just drop it
            _current.reset(token)
    if enabled():
        log.info("ai.timing %s", json.dumps(tr.summary(), default=str))


@contextlib.contextmanager
def trace(kind: str, **info: Any) -> Iterator[Trace]:
    tr, token = begin(kind, **info)
    try:
        yield tr
    finally:
        end(tr, token)


@contextlib.contextmanager
def step(name: str) -> Iterator[None]:
    """Time a block into the current trace (nothing at all without one)."""
    tr = _current.get()
    if tr is None:
        yield
        return
    t = time.perf_counter()
    try:
        yield
    finally:
        tr.steps.append(
            (name, round((t - tr.t0) * 1000, 2), round((time.perf_counter() - t) * 1000, 2))
        )


def record(name: str, since: float) -> None:
    """A step that began at perf_counter() value `since` and ends now."""
    tr = _current.get()
    if tr is not None:
        tr.steps.append(
            (
                name,
                round((since - tr.t0) * 1000, 2),
                round((time.perf_counter() - since) * 1000, 2),
            )
        )


def mark(name: str) -> None:
    tr = _current.get()
    if tr is not None:
        tr.mark(name)
