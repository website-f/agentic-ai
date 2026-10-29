"""P55: bring in a skill someone published in the open Agent Skills format (a SKILL.md with
name and description frontmatter, as in the public skill collections on GitHub).

A link to the SKILL.md (a GitHub page is turned into its raw file) or the pasted text is
read, checked against the format and the safety scan, and always queued as a proposal: an
outside skill is never published straight away, whoever imports it. Only the SKILL.md comes
in; scripts or reference files a skill points to are not fetched (the proposal says so).
"""

import re

from .format import MAX_BODY, SkillFormatError, parse, slug
from .learn_source import SourceError, fetch

_GITHUB_BLOB = re.compile(r"^https://github\.com/([^/]+)/([^/]+)/blob/(.+)$")
_GITHUB_TREE = re.compile(r"^https://github\.com/([^/]+)/([^/]+)/tree/(.+?)/?$")
_POINTS_ELSEWHERE = re.compile(r"\b(scripts?|references?|assets?)/[\w./-]+", re.I)


def raw_url(url: str) -> str:
    """A GitHub page of a SKILL.md, or of its folder, as the raw file's address."""
    url = url.strip()
    if m := _GITHUB_BLOB.match(url):
        return f"https://raw.githubusercontent.com/{m[1]}/{m[2]}/{m[3]}"
    if m := _GITHUB_TREE.match(url):
        return f"https://raw.githubusercontent.com/{m[1]}/{m[2]}/{m[3]}/SKILL.md"
    return url


async def read(url: str | None, text: str | None) -> tuple[str, str, str, str]:
    """(name, description, body, note) from a link or pasted SKILL.md. Raises
    SkillFormatError (bad file) or SourceError (could not fetch)."""
    if url:
        if not url.startswith("https://"):
            raise SourceError("Use an https:// link to the SKILL.md.")
        text = await fetch(raw_url(url))
    meta, body = parse(text or "")
    name = slug(str(meta.get("name") or ""))
    description = " ".join(str(meta.get("description") or "").split())
    if not name or not description:
        raise SkillFormatError(
            "That is not a SKILL.md: it needs frontmatter with a name and a description."
        )
    if len(description) > 300:
        description = description[:297].rsplit(" ", 1)[0] + "..."
    if "when to use" not in body.lower():
        body = f"## When to use\n{description}\n\n{body}"
    if len(body) > MAX_BODY:
        raise SkillFormatError("This skill is too long to import (over 12,000 characters).")
    note = f"Imported from {url}." if url else "Imported from a pasted SKILL.md."
    if _POINTS_ELSEWHERE.search(body):
        note += " It mentions scripts or reference files, which were not brought in."
    return name, description, body, note
