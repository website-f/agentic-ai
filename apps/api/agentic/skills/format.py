"""The SKILL.md convention (agentskills.io, as used by Hermes and Claude): YAML frontmatter
with name and description, then markdown instructions. Pure functions, no I/O."""

import re
from typing import Any

from ..brain.pages import parse_frontmatter

NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_NAME = 64
MAX_DESCRIPTION = 300
MAX_BODY = 12_000
SECTIONS = ("When to use", "Steps")


class SkillFormatError(ValueError):
    pass


def slug(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", raw.strip().lower()).strip("-")
    return s[:MAX_NAME].strip("-")


def check(name: str, description: str, body: str) -> None:
    if not NAME.match(name) or len(name) > MAX_NAME:
        raise SkillFormatError("Skill names are short kebab-case, like compare-vendor-quotes.")
    if not 10 <= len(description.strip()) <= MAX_DESCRIPTION:
        raise SkillFormatError(
            "The description is one sentence (10-300 characters): what it does and when to use it."
        )
    if not body.strip():
        raise SkillFormatError("The skill needs instructions.")
    if len(body) > MAX_BODY:
        raise SkillFormatError(f"Keep a skill under {MAX_BODY:,} characters; split it if needed.")


def missing_sections(body: str) -> list[str]:
    heads = {h.strip().lower() for h in re.findall(r"^#{1,3}\s+(.+)$", body, re.M)}
    return [s for s in SECTIONS if s.lower() not in heads]


def render(meta: dict[str, Any], body: str) -> str:
    lines = ["---"]
    for k, v in meta.items():
        if v is None or v == []:
            continue
        if isinstance(v, list):
            lines.append(f"{k}: [{', '.join(str(x) for x in v)}]")
        else:
            text = str(v).replace("\n", " ")
            lines.append(f"{k}: {text}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body.strip() + "\n"


def parse(text: str) -> tuple[dict[str, Any], str]:
    meta, body = parse_frontmatter(text.replace("\r\n", "\n"))
    return meta, body.strip() + "\n"
