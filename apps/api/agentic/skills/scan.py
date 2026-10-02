"""Static scan of a proposed skill, run before anyone reviews it (and again after edits).

A skill is instructions every agent may follow, so it is checked like code: no secrets, no
attempts to override the rules, no tools that do not exist, nothing pointing at internal
addresses. "block" findings must be fixed before approval; "warn" findings are for the
reviewer to judge.
"""

import re
from typing import Any

from ..brain.facts import _SECRET  # same secret patterns as facts
from ..core.fence import INJECTION
from .format import MAX_BODY, missing_sections

_INJECTION = INJECTION
_INTERNAL = re.compile(
    r"(169\.254\.\d+\.\d+|\blocalhost\b|127\.0\.0\.1|\b10\.\d+\.\d+\.\d+|\b192\.168\.\d+\.\d+"
    r"|metadata\.google|file://|/etc/passwd)",
    re.I,
)
_TOOL_REF = re.compile(r"`([a-z_]{3,40})`")
_SPECIFIC = re.compile(
    r"\b(?:RM|USD|\$)\s?\d[\d,]*(?:\.\d+)?\b|\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|"
    r"Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b"
)


def scan(body: str, description: str, known_tools: set[str]) -> list[dict[str, Any]]:
    text = f"{description}\n{body}"
    out: list[dict[str, Any]] = []

    def add(level: str, code: str, message: str) -> None:
        out.append({"level": level, "code": code, "message": message})

    if _SECRET.search(text):
        add("block", "secret", "Looks like it contains a password, key, card or IC number.")
    if _INJECTION.search(text):
        add("block", "override", "Tries to override the rules or skip approvals.")
    if _INTERNAL.search(text):
        add("block", "internal_address", "Points at an internal or metadata address.")
    unknown = sorted({t for t in _TOOL_REF.findall(text) if "_" in t and t not in known_tools})
    if unknown:
        add("warn", "unknown_tool", f"Mentions tools that do not exist: {', '.join(unknown)}.")
    if missing := missing_sections(body):
        add("warn", "sections", f"Missing sections: {', '.join(missing)}.")
    if len(_SPECIFIC.findall(text)) >= 3:
        add(
            "warn",
            "too_specific",
            "Has several specific amounts or dates; skills should be general.",
        )
    if len(body) > MAX_BODY * 0.8:
        add("warn", "long", "Long for a skill; consider splitting it.")
    return out


def blocked(findings: list[dict[str, Any]]) -> bool:
    return any(f["level"] == "block" for f in findings)
