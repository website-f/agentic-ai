"""Git mirror of a workspace's brain: plain markdown + [[wikilinks]], one commit per change,
so Obsidian opens it as a vault and git gives history, blame and revert for free.

Functions here are blocking (file and git I/O); store.py calls them via asyncio.to_thread
while holding the workspace's vault lock.
"""

import io
import re
import zipfile
from collections.abc import Mapping
from pathlib import Path

from dulwich.repo import Repo

from ..core.config import settings

SKIP_DIRS = {".git", ".obsidian", ".trash"}
_SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def root(ws_slug: str) -> Path:
    if not _SAFE_SLUG.match(ws_slug):
        raise ValueError(f"bad workspace slug {ws_slug!r}")
    return Path(settings.vault_dir).resolve() / ws_slug


def _repo(ws_slug: str) -> Repo:
    path = root(ws_slug)
    if (path / ".git").is_dir():
        return Repo(str(path))
    path.mkdir(parents=True, exist_ok=True)
    repo = Repo.init(str(path))
    # Obsidian's own settings never belong in the shared history.
    (path / ".gitignore").write_text(".obsidian/\n.trash/\n", encoding="utf-8", newline="\n")
    repo.get_worktree().stage([".gitignore"])
    return repo


def _abs(ws_slug: str, rel: str) -> Path:
    base = root(ws_slug)
    p = (base / rel).resolve()
    if base not in p.parents:
        raise ValueError(f"path escapes the vault: {rel!r}")
    return p


def commit(ws_slug: str, changes: Mapping[str, str | None], author: str, message: str) -> str:
    """Write (text) or delete (None) each path, then commit. Returns the commit id."""
    repo = _repo(ws_slug)
    try:
        for rel, text in changes.items():
            p = _abs(ws_slug, rel)
            if text is None:
                p.unlink(missing_ok=True)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8", newline="\n")
        wt = repo.get_worktree()
        wt.stage(list(changes))
        sha = wt.commit(
            message=message.encode(),
            author=author.encode(),
            committer=b"Agentic Office <brain@agentic.local>",
        )
        return sha.decode()
    finally:
        repo.close()


def read_all(ws_slug: str) -> dict[str, str]:
    """Every markdown file in the vault, keyed by posix path relative to the vault root."""
    base = root(ws_slug)
    if not base.is_dir():
        return {}
    out: dict[str, str] = {}
    for p in base.rglob("*.md"):
        rel = p.relative_to(base)
        if rel.parts and rel.parts[0] in SKIP_DIRS:
            continue
        try:
            out[rel.as_posix()] = p.read_text(encoding="utf-8").replace("\r\n", "\n")
        except (OSError, UnicodeDecodeError):
            continue
    return out


def history(ws_slug: str, rel: str, limit: int = 20) -> list[dict[str, str | int]]:
    base = root(ws_slug)
    if not (base / ".git").is_dir():
        return []
    repo = Repo(str(base))
    try:
        out: list[dict[str, str | int]] = []
        for entry in repo.get_walker(paths=[rel.encode()], max_entries=limit):
            c = entry.commit
            out.append(
                {
                    "commit": c.id.decode()[:10],
                    "author": c.author.decode(errors="replace").split(" <")[0],
                    "message": c.message.decode(errors="replace").strip(),
                    "ts": c.commit_time,
                }
            )
        return out
    finally:
        repo.close()


def zip_bytes(ws_slug: str) -> bytes:
    """The vault as a zip (with its .git, so history comes along) for Obsidian on a laptop."""
    base = root(ws_slug)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if base.is_dir():
            for p in base.rglob("*"):
                rel = p.relative_to(base)
                if p.is_file() and not (rel.parts and rel.parts[0] in {".obsidian", ".trash"}):
                    z.write(p, Path(ws_slug) / rel)
    return buf.getvalue()
