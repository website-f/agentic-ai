"""P114 (Fitri, 18 Nov 2026): each person decides how they hear from the office and about what.

users.prefs["notify"] = {"channels": {"app": bool, "email": bool, "telegram": bool,
"whatsapp": bool}, "events": {"approvals": bool, "my_ai": bool, "done": bool, "limit": bool,
"other": bool}, "email_other": bool}. Everything is on until the person turns it off, except
email for "other" notices (email_other, off until they turn it on, so email carries what their AI
and their approvals need and not every small notice). The "Needs you" bell in the app always
lists what waits; these switches only change what is sent.

Events:
- approvals: decisions waiting for me (I may approve or answer: my own AI, or the people I manage)
- my_ai: my AI asked for a decision or a question, or a task of mine failed
- done: a task my AI did for me is finished
- limit: my daily AI allowance is used up, or a manager gave me more
- other: everything else the office tells me (tasks given to me, mentions, schedules...)
"""

from typing import Any

from ..models import User

CHANNELS = ("app", "email", "telegram", "whatsapp")
EVENTS = ("approvals", "my_ai", "done", "limit", "other")


def validate(sub: dict[str, Any]) -> dict[str, Any]:
    """prefs.update's validator for the "notify" key."""
    from .prefs import PrefsError  # late: prefs lists this validator

    extra = set(sub) - {"channels", "events", "email_other"}
    if extra:
        raise PrefsError(f"notify does not keep {', '.join(sorted(extra))}.")
    out: dict[str, Any] = {}
    if "email_other" in sub:
        if sub["email_other"] is not None and not isinstance(sub["email_other"], bool):
            raise PrefsError("notify.email_other must be true or false.")
        out["email_other"] = sub["email_other"]
    for key, names in (("channels", CHANNELS), ("events", EVENTS)):
        if key not in sub:
            continue
        v = sub[key]
        if v is None:
            out[key] = None
            continue
        if not isinstance(v, dict) or set(v) - set(names):
            raise PrefsError(f"notify.{key} takes only {', '.join(names)}.")
        if not all(isinstance(x, bool) for x in v.values()):
            raise PrefsError(f"notify.{key} holds true or false only.")
        out[key] = dict(v)
    return out


def settings_of(user: User | None) -> dict[str, Any]:
    raw = ((user.prefs or {}) if user is not None else {}).get("notify") or {}
    ch = raw.get("channels") if isinstance(raw.get("channels"), dict) else {}
    ev = raw.get("events") if isinstance(raw.get("events"), dict) else {}
    return {
        "channels": {c: bool(ch.get(c, True)) for c in CHANNELS},
        "events": {e: bool(ev.get(e, True)) for e in EVENTS},
        "email_other": raw.get("email_other") is True,
    }


def wants(user: User | None, event: str, channel: str) -> bool:
    """Should this person get this kind of notice on this channel?"""
    s = settings_of(user)
    if channel == "email" and event not in ("approvals", "my_ai", "done", "limit"):
        if not s["email_other"]:
            return False
        event = "other"
    return s["events"].get(event, True) and s["channels"].get(channel, True)
