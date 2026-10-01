"""Brain pages: save, delete, index, and keep the git vault in step.

Postgres holds the truth the dashboard and agents read; every change is also committed to
the workspace's git vault. Edits made directly in the vault (Obsidian) come back in through
`sync_from_vault`, which the nightly dream runs and people can trigger from the dashboard.

All writes for one workspace hold a Postgres advisory lock for the whole transaction, so
the API and the worker never interleave git commits.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import BrainChunk, BrainLink, BrainPage, Branch, Workspace
from ..services import events
from . import embed, vault
from .pages import (
    MAX_PAGE_CHARS,
    PathError,
    chunks_of,
    digest,
    kind_of,
    links_of,
    name_of,
    normalize_path,
    parse_frontmatter,
    split_branch,
    title_of,
)

AGENTS_MD = """# How this vault works

This is the shared memory of the office. People and AI agents both read and write it.
It is plain markdown, so it also opens in Obsidian.

## Layout
- `wiki/` knowledge pages: `entities/` (people, companies, products), `topics/`,
  `decisions/` (what was decided and why), `howto/`
- `raw/` sources kept as they were (pasted documents, fetched pages). Do not edit.
- `branches/<company>/wiki/` pages that belong to one company only
- `agents/<name>/MEMORY.md` and `USER.md` each agent's core memory (capped)
- `DREAMS/` the nightly diary of what the brain merged or corrected
- `log.md` one line per event. `index.md` map of the wiki, rebuilt every night.

## Rules
- One topic per page. Link related pages with [[page-name]].
- Put the source and date on anything that can go out of date.
- Decisions: what, why, who decided, when.
"""

LOG_MD = "# Log\n\nOne line per event, newest last.\n\n"


@dataclass
class Author:
    actor: str  # user:<id> | agent:<id> | system
    name: str

    def git(self) -> str:
        kind, _, ident = self.actor.partition(":")
        who = f"{self.name} (agent)" if kind == "agent" else self.name
        return f"{who} <{kind}-{ident or 'system'}@agentic.local>"


SYSTEM = Author("system", "Agentic Office")


async def lock(db: AsyncSession, workspace_id: str) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"vault:{workspace_id}"}
    )


async def _branch_for(db: AsyncSession, ws: Workspace, path: str) -> str | None:
    slug, _ = split_branch(path)
    if slug is None:
        return None
    b = await db.scalar(select(Branch).where(Branch.workspace_id == ws.id, Branch.slug == slug))
    if b is None:
        raise PathError(f"There is no company with the short name '{slug}'.")
    return b.id


async def _index(db: AsyncSession, page: BrainPage) -> None:
    """Rebuild this page's chunks (keyword + vector) and outgoing links."""
    await db.execute(delete(BrainChunk).where(BrainChunk.page_id == page.id))
    await db.execute(delete(BrainLink).where(BrainLink.src_page_id == page.id))
    _, content = parse_frontmatter(page.body)
    pieces = chunks_of(page.title, content)
    vectors = await embed.embed([f"{page.title}. {h}\n{t}" for h, t in pieces])
    for i, (heading, body) in enumerate(pieces):
        db.add(
            BrainChunk(
                page_id=page.id,
                workspace_id=page.workspace_id,
                branch_id=page.branch_id,
                kind=page.kind,
                idx=i,
                heading=heading,
                text=body,
                embedding=vectors[i] if vectors else None,
            )
        )
    for name in links_of(content):
        if name and name != page.name:
            db.add(
                BrainLink(workspace_id=page.workspace_id, src_page_id=page.id, dst_name=name[:200])
            )


def _fill(page: BrainPage, path: str, body: str) -> None:
    meta, content = parse_frontmatter(body)
    page.path = path
    page.name = name_of(path)
    page.kind = kind_of(path)
    page.title = title_of(path, meta, content)
    page.frontmatter = meta
    page.body = body
    page.hash = digest(body)


async def _upsert(
    db: AsyncSession, ws: Workspace, path: str, body: str, author: Author
) -> tuple[BrainPage, bool]:
    if len(body) > MAX_PAGE_CHARS:
        raise PathError(f"Pages are limited to {MAX_PAGE_CHARS:,} characters.")
    page = await db.scalar(
        select(BrainPage).where(BrainPage.workspace_id == ws.id, BrainPage.path == path)
    )
    if page is not None and page.hash == digest(body):
        return page, False
    branch_id = await _branch_for(db, ws, path)
    if page is None:
        page = BrainPage(workspace_id=ws.id, branch_id=branch_id)
        db.add(page)
    page.branch_id = branch_id
    page.updated_by = author.actor
    _fill(page, path, body)
    await db.flush()
    await _index(db, page)
    return page, True


async def _seed(db: AsyncSession, ws: Workspace) -> None:
    """First use: the vault's rules file, an empty log and index."""
    have = await db.scalar(
        select(func.count()).select_from(BrainPage).where(BrainPage.workspace_id == ws.id)
    )
    if have:
        return
    files = {"AGENTS.md": AGENTS_MD, "log.md": LOG_MD, "index.md": "# Index\n\nNothing here yet.\n"}
    pages = [(await _upsert(db, ws, p, b, SYSTEM))[0] for p, b in files.items()]
    await asyncio.to_thread(vault.commit, ws.slug, files, SYSTEM.git(), "Start the vault")
    for p in pages:
        p.vault_hash = p.hash


async def ensure_vault(db: AsyncSession, ws: Workspace) -> None:
    await lock(db, ws.id)
    await _seed(db, ws)
    await db.commit()


async def save_page(
    db: AsyncSession,
    ws: Workspace,
    raw_path: str,
    body: str,
    author: Author,
    message: str | None = None,
) -> BrainPage:
    path = normalize_path(raw_path)
    body = body.replace("\r\n", "\n")
    await lock(db, ws.id)
    await _seed(db, ws)
    page, changed = await _upsert(db, ws, path, body, author)
    if changed or page.vault_hash != page.hash:
        await asyncio.to_thread(
            vault.commit, ws.slug, {path: body}, author.git(), message or f"Update {path}"
        )
        page.vault_hash = page.hash
    await db.commit()
    if changed:
        await events.publish(ws.id, "brain.page", {"path": path, "by": author.actor})
    return page


async def delete_page(db: AsyncSession, ws: Workspace, path: str, author: Author) -> bool:
    await lock(db, ws.id)
    page = await db.scalar(
        select(BrainPage).where(BrainPage.workspace_id == ws.id, BrainPage.path == path)
    )
    if page is None:
        return False
    await db.delete(page)
    await asyncio.to_thread(vault.commit, ws.slug, {path: None}, author.git(), f"Delete {path}")
    await db.commit()
    await events.publish(ws.id, "brain.page", {"path": path, "deleted": True, "by": author.actor})
    return True


async def append_log(db: AsyncSession, ws: Workspace, line: str, author: Author) -> None:
    """One line in log.md, stamped with the workspace's local time."""
    await lock(db, ws.id)
    await _seed(db, ws)
    page = await db.scalar(
        select(BrainPage).where(BrainPage.workspace_id == ws.id, BrainPage.path == "log.md")
    )
    now = datetime.now(UTC).astimezone(ZoneInfo(ws.timezone))
    body = (page.body if page else LOG_MD).rstrip("\n") + f"\n- {now:%Y-%m-%d %H:%M} · {line}\n"
    page, _ = await _upsert(db, ws, "log.md", body, author)
    await asyncio.to_thread(vault.commit, ws.slug, {"log.md": body}, author.git(), line[:72])
    page.vault_hash = page.hash
    await db.commit()


async def rebuild_index(db: AsyncSession, ws: Workspace) -> bool:
    rows = (
        await db.execute(
            select(BrainPage.path, BrainPage.name, BrainPage.title, BrainPage.kind)
            .where(
                BrainPage.workspace_id == ws.id,
                BrainPage.kind.in_(("wiki", "decision", "raw", "skill")),
            )
            .order_by(BrainPage.path)
        )
    ).all()
    lines = ["# Index", "", "Rebuilt every night by the dream. Edits here are overwritten.", ""]
    section = None
    for path, name, title, _kind in rows:
        top = "/".join(path.split("/")[:-1]) or "(top)"
        if top != section:
            lines += ["", f"## {top}"]
            section = top
        lines.append(f"- [[{name}]] {title}" if title.lower() != name else f"- [[{name}]]")
    body = "\n".join(lines).strip() + "\n"
    if not rows:
        body = "# Index\n\nNothing here yet.\n"
    page = await save_page(db, ws, "index.md", body, SYSTEM, "Rebuild the index")
    return page is not None


@dataclass
class SyncReport:
    imported: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    rewritten: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


async def sync_from_vault(db: AsyncSession, ws: Workspace) -> SyncReport:
    """Bring edits made in the vault folder (Obsidian, git pull) into the brain.

    For each file: unchanged -> nothing; changed outside and not in the dashboard -> import;
    changed in both places -> the dashboard copy wins and the outside copy is saved next to
    it as `<name>.conflict-<date>.md`. Files removed outside are removed here too.
    """
    report = SyncReport()
    await lock(db, ws.id)
    await _seed(db, ws)
    files = await asyncio.to_thread(vault.read_all, ws.slug)
    pages = {
        p.path: p
        for p in (await db.scalars(select(BrainPage).where(BrainPage.workspace_id == ws.id))).all()
    }
    outside = Author("system", "Vault (outside edit)")
    to_commit: dict[str, str | None] = {}
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    for path, body in files.items():
        try:
            path_ok = normalize_path(path) == path
        except PathError:
            path_ok = False
        if not path_ok:
            report.skipped.append(path)
            continue
        page = pages.get(path)
        h = digest(body)
        try:
            if page is None:
                page, _ = await _upsert(db, ws, path, body, outside)
                page.vault_hash = h
                report.imported.append(path)
            elif h == page.vault_hash or h == page.hash:
                page.vault_hash = h
            elif page.hash == page.vault_hash:
                page, _ = await _upsert(db, ws, path, body, outside)
                page.vault_hash = h
                report.imported.append(path)
            else:
                twin = path[:-3] + f".conflict-{stamp}.md"
                tp, _ = await _upsert(db, ws, twin, body, outside)
                tp.vault_hash = tp.hash
                to_commit[twin] = body
                to_commit[path] = page.body
                page.vault_hash = page.hash
                report.conflicts.append(path)
        except PathError:  # e.g. a branches/<slug>/ folder for a company that no longer exists
            report.skipped.append(path)
    for path, page in pages.items():
        if path in files:
            continue
        if page.vault_hash is not None and page.vault_hash == page.hash:
            await db.delete(page)
            report.deleted.append(path)
        else:  # never mirrored (or mirror failed): write it now
            to_commit[path] = page.body
            page.vault_hash = page.hash
            report.rewritten.append(path)
    if report.deleted or to_commit:
        await asyncio.to_thread(
            vault.commit,
            ws.slug,
            {**to_commit, **dict.fromkeys(report.deleted)},
            outside.git(),
            "Sync with the vault folder",
        )
    await db.commit()
    if report.imported or report.deleted or report.conflicts:
        await events.publish(ws.id, "brain.page", {"sync": True})
    return report
