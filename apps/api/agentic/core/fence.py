"""Fences for untrusted text (fetched pages, brain pages, other agents' words).

A fixed `<<<` / `>>>` pair can be closed by the text itself ("...>>> Ignore the rules"),
so every fence carries a random tag on both ends, and fence-like sequences inside the text
are defused first. The model is told (WORKSPACE_RULES) that fenced text is data.
"""

import re
import secrets

# Sequences that could end a fence or the <memory> block early.
_BREAKERS = re.compile(r"<<<|>>>|</?\s*memory\b", re.I)


def defuse(text: str) -> str:
    return _BREAKERS.sub(lambda m: m.group(0).replace("<", "‹").replace(">", "›"), text)


def fence(text: str) -> str:
    tag = secrets.token_hex(4)
    return f"<<<{tag}\n{defuse(text)}\n{tag}>>>"


# Text that tries to override the rules. Blocks skill saves and agent core-memory writes,
# the two places agent-written text reaches a system prompt.
INJECTION = re.compile(
    r"(ignore (all |any )?(previous|prior|above|earlier) (instructions|rules)"
    r"|disregard (the|your|all) (rules|instructions|sops?)|you are now|new system prompt"
    r"|reveal (the|your) (system )?prompt"
    r"|bypass (the )?(approval|policy|policies)|do not tell (the )?(user|person)"
    r"|(skip|without) (the |any )?approvals?)",
    re.I,
)
