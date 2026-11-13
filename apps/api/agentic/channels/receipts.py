"""P43: a photo or PDF someone sends the office on WhatsApp or Telegram.

The file is always kept, in the sender's own workspace ("My workspace/From my phone"), and
read like any upload. Then:

- No caption, or a caption that only says what it is ("receipt", "resit", "bill", "invoice",
  "claim", "tuntutan", ...): it is kept, and the sender is told where.
- Any other caption is an instruction: it goes to their AI like a typed message, with a note
  that the file is in their workspace (file id), so the AI can read it.

The sender only ever reaches their own workspace and their own company; a file is data,
never an instruction (the AI reads it as a file).
"""

import logging
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..i18n import Msg
from ..models import Branch, Membership, User

log = logging.getLogger("agentic.channels.receipts")

MAX_BYTES = 15 * 1024 * 1024
PER_DAY = 40  # files one person may send in a day
KINDS = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf")
RECEIPT_WORDS = re.compile(
    r"\b(receipt|resit|bill|bil|invoice|invois|claim|claims|tuntutan|expense|belanja|"
    r"perbelanjaan|reimburse|ganti\s*balik|payable)\b",
    re.I,
)


@dataclass
class Sent:
    """What the person sent: the bytes and what their app said about them."""

    data: bytes
    name: str
    mime: str
    caption: str = ""


@dataclass
class Outcome:
    """`reply` to send back, or `chat` (text for their AI) when the caption asked for
    something else."""

    reply: Msg | str | None = None
    chat: str | None = None
    file_id: str | None = None


def wanted(mime: str) -> bool:
    return (mime or "").split(";")[0].strip().lower() in KINDS


def is_receipt(caption: str) -> bool:
    return not caption.strip() or bool(RECEIPT_WORDS.search(caption))


def safe_name(name: str, mime: str) -> str:
    base = re.sub(r"[^\w.\- ]+", "_", (name or "").strip())[:120].strip(" ._")
    ext = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
        "image/heif": ".heif",
        "application/pdf": ".pdf",
    }.get(mime.split(";")[0].strip().lower(), "")
    if not base:
        from ..services.clock import now

        base = "phone-" + now().strftime("%Y%m%d-%H%M%S")
    if ext and not base.lower().endswith(ext):
        base += ext
    return base


async def _branch_of(db: AsyncSession, workspace_id: str, m: Membership) -> str | None:
    """The sender's company: their own, else the only one there is."""
    if m.branch_id:
        return m.branch_id
    ids = (
        await db.scalars(select(Branch.id).where(Branch.workspace_id == workspace_id).limit(2))
    ).all()
    return ids[0] if len(ids) == 1 else None


async def _folder(db: AsyncSession, workspace_id: str, branch_id: str | None) -> str:
    from ..documents import provenance

    lang = await provenance.folder_lang(db, workspace_id, branch_id)
    return "Meja kerja saya/Dari telefon saya" if lang == "ms" else "My workspace/From my phone"


async def _over_limit(workspace_id: str, user_id: str) -> bool:
    from ..services.clock import now

    key = f"phonefiles:{workspace_id}:{user_id}:{now().date().isoformat()}"
    n = await valkey().incr(key)
    if n == 1:
        await valkey().expire(key, 2 * 86400)
    return n > PER_DAY


async def take(
    db: AsyncSession, workspace_id: str, user_id: str, sent: Sent, *, via: str
) -> Outcome:
    """Keep the file, then hand it to the person's AI when the caption asks for something."""
    from ..documents import service as doc_service

    mime = (sent.mime or "").split(";")[0].strip().lower()
    if not wanted(mime):
        return Outcome(Msg("I can take photos and PDF files. Send the receipt as a photo or PDF."))
    if len(sent.data) > MAX_BYTES:
        return Outcome(Msg("That file is too large. Send a file up to 15 MB."))
    if await _over_limit(workspace_id, user_id):
        return Outcome(Msg("That is a lot of files for one day. Upload the rest on the web."))
    m = await db.scalar(
        select(Membership).where(
            Membership.workspace_id == workspace_id, Membership.user_id == user_id
        )
    )
    user = await db.get(User, user_id)
    if m is None or user is None:
        return Outcome(Msg("Your account is no longer in this workspace."))
    branch_id = await _branch_of(db, workspace_id, m)
    name = safe_name(sent.name, mime)
    folder = await _folder(db, workspace_id, branch_id)
    f = await doc_service.create_file(
        db,
        workspace_id=workspace_id,
        name=name,
        data=sent.data,
        mime=mime,
        created_by=f"user:{user_id}",
        branch_id=branch_id,
        source="upload",
        origin="uploaded",
        folder=folder,
        source_path=via,
        owner_user_id=user_id,
    )
    await db.commit()
    file_id = f.id
    await _read_later(file_id)
    caption = (sent.caption or "").strip()[:1000]
    if not is_receipt(caption):
        return Outcome(
            chat=(
                f"{caption}\n\n[I sent you a file from my phone: {name} (file {file_id}), saved "
                f"in my workspace in {folder}.]"
            ),
            file_id=file_id,
        )
    return Outcome(
        Msg(
            "Saved {name} in your workspace, in {folder}. Send it again with a note to tell me "
            "what to do with it.",
            name=name,
            folder=folder,
        ),
        file_id=file_id,
    )


async def _read_later(file_id: str) -> None:
    """Index it for search like any upload (the worker, else right here)."""
    from ..agents.pc_tools import _start_reading  # noqa: PLC2701 - the shared helper

    try:
        await _start_reading(file_id)
    except Exception:  # noqa: BLE001 - search can catch up later; the file is saved
        log.info("could not start reading %s", file_id, exc_info=True)
