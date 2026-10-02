"""Scan untrusted text for prompt-injection and exfiltration attempts (P13).

Agents read web pages, uploaded documents, other agents' words and their own saved notes.
Any of it can try to override the rules ("ignore your instructions"), hide instructions in
invisible characters, or smuggle out secrets. This scanner reports what it finds; callers
decide: brain/skill/memory writes are blocked (the text would enter a system prompt), while
fetched pages and tool results are only flagged (they are already fenced as data, and
blocking every bossy web page would break ordinary research).

Approach ported from Hermes Agent's threat_patterns.py (MIT); the office keeps its own,
shorter pattern set and drops Hermes-specific items. Scopes are cumulative:
all ⊂ context ⊂ strict. "all" is classic injection and exfiltration; "context" adds role
hijack and data-exfil phrasing for untrusted content; "strict" adds aggressive checks for
text an agent is about to save into a prompt, where a block is the right answer.
"""

import re
import unicodedata

MAX_SCAN = 65_536
_FILLER = r"(?:\w+\s+){0,8}"  # bounded; (?:\w+\s+)* backtracks badly
_SECRET_VAR = r"\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b"  # noqa: S105

# Zero-width and bidirectional characters used to hide instructions in otherwise clean text.
INVISIBLE = frozenset("​‌‍⁠⁢⁣⁤﻿‪‫‬‭‮⁦⁧⁨⁩")

# (regex, id, scope)
_PATTERNS: tuple[tuple[str, str, str], ...] = (
    # Classic injection — everywhere.
    (
        rf"ignore\s+{_FILLER}(previous|all|above|prior|earlier)\s+{_FILLER}(instructions|rules)",
        "ignore_instructions",
        "all",
    ),
    (
        rf"disregard\s+{_FILLER}(the|your|all|any)\s+{_FILLER}(instructions|rules|guidelines|sops?)",
        "disregard_rules",
        "all",
    ),
    (r"(new|updated)\s+system\s+prompt", "new_system_prompt", "all"),
    (r"system\s+prompt\s+override", "sys_prompt_override", "all"),
    (
        rf"act\s+as\s+(if|though)\s+{_FILLER}you\s+{_FILLER}(have\s+no|don'?t\s+have)\s+{_FILLER}(restrictions|limits|rules)",
        "bypass_restrictions",
        "all",
    ),
    (
        r"<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->",
        "html_comment_injection",
        "all",
    ),
    (r"<\s*div\s+style\s*=\s*[\"'][^>]{0,2048}display\s*:\s*none", "hidden_div", "all"),
    (
        rf"do\s+not\s+{_FILLER}(tell|inform|notify)\s+{_FILLER}the\s+(user|person|owner)",
        "deception_hide",
        "all",
    ),
    (rf"(skip|without|bypass)\s+{_FILLER}(the\s+|any\s+)?approvals?", "skip_approval", "all"),
    # Role hijack / rule removal — untrusted content.
    (rf"you\s+are\s+{_FILLER}now\s+(?:a|an|the)\s+", "role_hijack", "context"),
    (rf"pretend\s+{_FILLER}(you\s+are|to\s+be)\s+", "role_pretend", "context"),
    (
        rf"(reveal|output|print|show)\s+{_FILLER}(the\s+|your\s+)?(system|initial)\s+prompt",
        "leak_system_prompt",
        "context",
    ),
    (
        rf"(respond|answer|reply)\s+without\s+{_FILLER}(restrictions|limitations|filters|safety)",
        "remove_filters",
        "context",
    ),
    (
        rf"you\s+have\s+been\s+{_FILLER}(updated|upgraded|patched|reprogrammed)\s+to",
        "fake_update",
        "context",
    ),
    # Exfiltration — everywhere, except send-to-url which over-matches ordinary prose.
    (rf"curl\s+[^\n]{{0,2048}}{_SECRET_VAR}", "exfil_curl", "all"),
    (rf"wget\s+[^\n]{{0,2048}}{_SECRET_VAR}", "exfil_wget", "all"),
    (
        r"cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|id_rsa)",
        "read_secrets",
        "all",
    ),
    (
        r"(send|post|upload|transmit|exfiltrate)\s+[^\n]{0,2048}\s+(to|at)\s+https?://",
        "send_to_url",
        "strict",
    ),
    (
        rf"(include|output|print|share|paste)\s+{_FILLER}(the\s+)?(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)",
        "context_exfil",
        "strict",
    ),
    (r"authorized_keys", "ssh_backdoor", "strict"),
)

_SCOPES = {
    "all": ("all", "context", "strict"),
    "context": ("context", "strict"),
    "strict": ("strict",),
}


def _compile() -> dict[str, list[tuple[re.Pattern[str], str]]]:
    out: dict[str, list[tuple[re.Pattern[str], str]]] = {"all": [], "context": [], "strict": []}
    for pattern, pid, scope in _PATTERNS:
        for s in _SCOPES[scope]:
            out[s].append((re.compile(pattern, re.IGNORECASE), pid))
    return out


_COMPILED = _compile()


def scan(content: str, scope: str = "context") -> list[str]:
    """Threat ids found in `content` for `scope`; invisible chars as `invisible_U+XXXX`."""
    if not content:
        return []
    patterns = _COMPILED[scope]
    content = content[:MAX_SCAN]
    found = [f"invisible_U+{ord(ch):04X}" for ch in sorted(set(content) & INVISIBLE)]
    # NFKC folds full-width lookalikes (ｃａｔ → cat); it does not fold cross-script homographs.
    normalised = unicodedata.normalize("NFKC", content)
    seen: set[str] = set(found)
    for regex, pid in patterns:
        if pid not in seen and regex.search(normalised):
            found.append(pid)
            seen.add(pid)
    return found


def message(content: str, scope: str = "strict") -> str | None:
    """A sentence for the first threat found, or None. For block-on-first-hit callers."""
    found = scan(content, scope=scope)
    if not found:
        return None
    pid = found[0]
    if pid.startswith("invisible_"):
        return f"Blocked: hidden character {pid.replace('invisible_', '')} (a common way to smuggle instructions)."
    return (
        f"Blocked: this text looks like a prompt-injection or exfiltration attempt "
        f"({pid.replace('_', ' ')}). It would be saved into an agent's instructions, so it "
        "cannot contain anything that tries to override the rules or move secrets out."
    )
