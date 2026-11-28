"""P148c: a chat answer shown word by word as the model writes it.

The chat endpoint opens a `Sink` for the turn (a context variable, like engine.acting), and
the gateway streams the provider's reply into it for the jobs a person is reading live
(TASKS). Everything else (side jobs, JSON, the scope check, memory work) never streams, even
inside the same turn.

Events are small dicts, sent to the browser one per line:
  {"t": "delta", "text": "..."}   more of the answer
  {"t": "reset"}                  forget the words shown so far (another model takes over, or
                                  the words led to a tool call rather than the answer)
  {"t": "tool", "name": "..."}    a tool is being used
  {"t": "done", ...}              the saved answer (the endpoint adds it)
  {"t": "error", ...}

The work-scope check (P36) is answered before the model is asked, so nothing is ever shown for
a request that gets refused.
"""

import asyncio
import contextlib
import re
from collections.abc import Callable, Iterable, Iterator
from contextvars import ContextVar
from typing import Any

# The jobs whose reply a person reads as it is written.
TASKS = frozenset({"agent.chat"})


class Sink:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.sent_text = False  # any words were sent since the last reset
        self.closed = False

    def put(self, event: dict[str, Any]) -> None:
        if not self.closed:
            self.queue.put_nowait(event)

    def delta(self, text: str) -> None:
        if text:
            self.sent_text = True
            self.put({"t": "delta", "text": text})

    def reset(self) -> None:
        if self.sent_text:
            self.put({"t": "reset"})
        self.sent_text = False

    def tool(self, name: str) -> None:
        self.put({"t": "tool", "name": name})

    def close(self, final: dict[str, Any] | None = None) -> None:
        """The last line (the saved answer, or what went wrong), then the end."""
        if final is not None:
            self.put(final)
        self.closed = True
        self.queue.put_nowait({"t": "_end"})


_sink: ContextVar[Sink | None] = ContextVar("ai_stream", default=None)


def current() -> Sink | None:
    return _sink.get()


def for_task(task: str, json_mode: bool = False) -> Sink | None:
    """The sink this gateway call streams into, if any."""
    s = _sink.get()
    return s if s is not None and task in TASKS and not json_mode and not s.closed else None


@contextlib.contextmanager
def attach(sink: Sink | None) -> Iterator[None]:
    token = _sink.set(sink)
    try:
        yield
    finally:
        _sink.reset(token)


_CODE = re.compile(r"[A-Za-z2-7]*")


class Unmasker:
    """P33 + streaming: a cloud model writes placeholders ([PERSON_K3QZX]); the person must
    see the real values. A placeholder never holds a space, so everything before the word
    being written is final and is shown unmasked; that last word waits for the next piece
    only while it could still be the start of a placeholder."""

    def __init__(self, unmask: Callable[[str], str], kinds: Iterable[str]) -> None:
        self._unmask = unmask
        self._kinds = tuple(k.upper() for k in kinds)
        self.raw = ""
        self.shown = ""

    def maybe_placeholder(self, tail: str) -> bool:
        t = tail.lstrip("[(\"'*`")
        if not t:
            return bool(tail)
        head, sep, code = t.partition("_")
        if sep:
            return head.upper() in self._kinds and _CODE.fullmatch(code) is not None
        return head.isalpha() and any(k.startswith(head.upper()) for k in self._kinds)

    def feed(self, text: str) -> tuple[str, bool]:
        """(text to add, True when what was shown must be replaced instead)."""
        self.raw += text
        cut = max(self.raw.rfind(" "), self.raw.rfind("\n"))
        if not self.maybe_placeholder(self.raw[cut + 1 :]):
            cut = len(self.raw) - 1
        if cut < 0:
            return "", False
        return self._advance(self._unmask(self.raw[: cut + 1]))

    def flush(self) -> tuple[str, bool]:
        return self._advance(self._unmask(self.raw))

    def _advance(self, real: str) -> tuple[str, bool]:
        if real.startswith(self.shown):
            add, self.shown = real[len(self.shown) :], real
            return add, False
        self.shown = real
        return real, True
