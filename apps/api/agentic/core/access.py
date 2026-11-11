"""P99: what a member reaches. "agentic": the office and Prima (everyone, the default).
"prima_only": they sign in on the same page and work in Prima only.

For a Prima-only person the office's API answers only what Prima needs, below; everything
else (the office's pages, agents, chat, desk, tasks, files, members, settings...) is refused
with 403 "prima_only" before any route runs (api/deps.py, on every signed-in request). Their
Prima role and the Prima screens chosen for them still apply inside Prima (prima/modules.py).
Owners (the developer is one) are never Prima only.
"""

import re

AGENTIC = "agentic"
PRIMA_ONLY = "prima_only"
ACCESS = (AGENTIC, PRIMA_ONLY)

# (methods, path) a Prima-only person may call. Signing in and out, their own password and
# two-step sign-in, their language and theme, Prima itself (status and its screens' calls,
# signed for them by the office), and the feedback button Prima's screens carry.
_OPEN: tuple[tuple[frozenset[str], re.Pattern[str]], ...] = tuple(
    (frozenset(methods.split()), re.compile(path))
    for methods, path in (
        ("GET", r"/api/auth/(me|sso|setup-status)"),
        ("POST", r"/api/auth/(login|login/2fa|logout|change-password|microsoft/start)"),
        ("POST", r"/api/auth/email-signin"),
        ("GET", r"/api/auth/2fa"),
        ("POST", r"/api/auth/2fa/(setup|confirm|disable|recovery-codes)"),
        ("GET PUT", r"/api/me/prefs"),
        ("GET", r"/api/prima/status"),
        ("GET POST", r"/api/prima/api/.*"),
        ("GET", r"/api/feedback/(config|mine)"),
        ("POST", r"/api/feedback"),
    )
)


def prima_only_allows(method: str, path: str) -> bool:
    """Whether a Prima-only person may make this call to the office's API."""
    p = path.rstrip("/") or "/"
    return any(method.upper() in ms and rx.fullmatch(p) for ms, rx in _OPEN)


def is_prima_only(access: str | None, role: str) -> bool:
    """Prima only in effect: never for an owner, whatever was saved."""
    return access == PRIMA_ONLY and role != "owner"
