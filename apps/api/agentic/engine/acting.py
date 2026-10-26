"""P36: the person a piece of work is for, so every model call it makes is logged against them
(llm_calls.user_id) and counts toward their daily AI allowance (teams/allowance.py).

Set once where work starts: the signed-in person of an API request (api/deps.py), the
person who gave a task (agents/runtime.py, through its first task in a delegation tree or
its schedule's author), the person in a chat. Context variables follow `await`, so every
gateway call below that point is attributed without passing the id along.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_person: ContextVar[str | None] = ContextVar("agentic_acting_person", default=None)


def current() -> str | None:
    return _person.get()


def set_person(user_id: str | None) -> None:
    """For a request: the rest of it runs for this person."""
    _person.set(user_id)


@contextmanager
def person(user_id: str | None) -> Iterator[None]:
    """For a stretch of work: runs for this person, then back to whoever it was before."""
    token = _person.set(user_id)
    try:
        yield
    finally:
        _person.reset(token)
