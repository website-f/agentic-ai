"""Mask secret values in text that leaves the app for logs or traces.

Covers `password=...` style pairs, bearer tokens, provider keys (sk-..., gsk_..., pk-/sk-lf-),
Telegram bot tokens, card numbers and Malaysian IC numbers.
"""

import re

_PAIR = re.compile(
    r"(?i)\b(password|passwd|pwd|kata laluan|api[_ -]?key|secret|token|authorization)"
    r"(\s*[:=]\s*|\s+is\s+)(\"[^\"]*\"|'[^']*'|\S+)"
)
_VALUES = re.compile(
    r"(?i)(\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*"
    r"|\b(?:sk|pk|gsk|xai|hf)[-_][A-Za-z0-9_-]{12,}"
    r"|\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"  # Telegram bot token
    r"|\b\d{6}-\d{2}-\d{4}\b"  # IC number
    r"|\b(?:\d[ -]?){13,19}\b)"  # card number
)


def redact(text: str) -> str:
    text = _VALUES.sub("[redacted]", text)  # first, so "Bearer <token>" goes as a whole
    return _PAIR.sub(
        lambda m: (
            m.group(0) if m.group(3) == "[redacted]" else f"{m.group(1)}{m.group(2)}[redacted]"
        ),
        text,
    )
