"""Small per-person settings kept in users.prefs (P19): tutorial progress, onboarding state.

Only whitelisted top-level keys may be written. Each key holds a small JSON object; a write
merges into it one level deep (sub-keys you send replace what was there, a sub-key sent as
null is removed, sub-keys you leave out stay). Anything else in prefs is left untouched.

    await prefs.update(db, user_id, {"tutorial": {"done": ["owner.providers"]}})

To add a key: list it in KEYS and, if its shape matters, give it a validator in VALIDATORS.
"""

import json
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User

KEYS: tuple[str, ...] = ("tutorial", "onboarding", "locale")
MAX_KEY_BYTES = 8_000  # one key's object, as JSON


class PrefsError(ValueError):
    """The write was refused; the message is safe to show."""


def _short_ids(value: Any, field: str, limit: int = 200) -> list[str]:
    if not isinstance(value, list) or len(value) > limit:
        raise PrefsError(f"{field} must be a list of at most {limit} ids.")
    out: list[str] = []
    for v in value:
        if not isinstance(v, str) or not v or len(v) > 80:
            raise PrefsError(f"{field} holds short text ids only.")
        if v not in out:
            out.append(v)
    return out


def _tutorial(sub: dict[str, Any]) -> dict[str, Any]:
    allowed = {"done", "dismissed", "track"}
    extra = set(sub) - allowed
    if extra:
        raise PrefsError(f"tutorial does not keep {', '.join(sorted(extra))}.")
    out: dict[str, Any] = {}
    for k, v in sub.items():
        if v is None:
            out[k] = None
        elif k == "done":
            out[k] = _short_ids(v, "tutorial.done")
        elif k == "dismissed":
            if not isinstance(v, bool):
                raise PrefsError("tutorial.dismissed must be true or false.")
            out[k] = v
        else:  # track: the role track the person last looked at
            if v not in ("owner", "management", "staff", "approver"):
                raise PrefsError("tutorial.track is not a known track.")
            out[k] = v
    return out


def _locale(sub: dict[str, Any]) -> dict[str, Any]:
    """P22: the person's language for the app (and notices): en | ms."""
    extra = set(sub) - {"language"}
    if extra:
        raise PrefsError(f"locale does not keep {', '.join(sorted(extra))}.")
    v = sub.get("language")
    if v is not None and v not in ("en", "ms"):
        raise PrefsError("locale.language must be en or ms.")
    return {"language": v}


def saved_lang(user: User | None) -> str | None:
    """The language the person picked in the app (locale.language), if they did."""
    saved = (((user.prefs if user else None) or {}).get("locale") or {}).get("language")
    return saved if saved in ("en", "ms") else None


def lang_of(user: User | None) -> str:
    """The person's language for what the server tells them (notices, bot replies)."""
    return saved_lang(user) or "en"


async def language(db: AsyncSession, user_id: str | None) -> str:
    """lang_of() by id; English for nobody."""
    return lang_of(await db.get(User, user_id)) if user_id else "en"


VALIDATORS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "tutorial": _tutorial,
    "locale": _locale,
}


def visible(prefs: dict[str, Any] | None) -> dict[str, Any]:
    """The whitelisted part of a person's prefs, every key present (empty when unset)."""
    p = prefs or {}
    return {k: dict(p[k]) if isinstance(p.get(k), dict) else {} for k in KEYS}


def merge(current: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    """The new prefs after applying `patch`. Raises PrefsError on a key or shape not allowed."""
    if not isinstance(patch, dict) or not patch:
        raise PrefsError("Send at least one setting to change.")
    unknown = [k for k in patch if k not in KEYS]
    if unknown:
        raise PrefsError(f"Unknown setting: {', '.join(sorted(unknown))}.")
    out = dict(current or {})
    for key, sub in patch.items():
        if not isinstance(sub, dict):
            raise PrefsError(f"{key} must be an object.")
        check = VALIDATORS.get(key)
        clean = check(sub) if check else dict(sub)
        merged = dict(out.get(key) or {}) if isinstance(out.get(key), dict) else {}
        for k, v in clean.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        if len(json.dumps(merged, separators=(",", ":"))) > MAX_KEY_BYTES:
            raise PrefsError(f"{key} is too large to keep.")
        out[key] = merged
    return out


async def update(db: AsyncSession, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Merge `patch` into the person's prefs (row-locked, so two tabs do not lose a write).
    The caller commits. Returns the whitelisted view."""
    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    user.prefs = merge(user.prefs, patch)  # a new dict, so the JSONB column is marked dirty
    return visible(user.prefs)
