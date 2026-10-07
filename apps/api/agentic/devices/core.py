"""Codes, tokens, names, folders, online state, the activity log and who may use a PC."""

import hashlib
import json
import logging
import re
import secrets
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.db import SessionLocal
from ..core.security import token_hash
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import Agent, Device, DeviceActivity

log = logging.getLogger("agentic.devices")

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 8
CODE_TTL = timedelta(minutes=10)
MAX_OPEN_CODES = 5
CLAIMS_PER_IP = 10
CLAIM_WINDOW = 600  # seconds
MAX_FOLDERS = 20
MAX_FOLDER_CHARS = 400
ONLINE_TTL = 90  # seconds; the PC pings every 25 s and every message refreshes it
LAST_SEEN_EVERY = 60  # last_seen_at is written at most this often
MAX_MESSAGE = 256 * 1024  # a socket message (file bytes never travel in the socket)
MAX_UPLOAD = 25 * 1024 * 1024
FILE_TTL = 300  # uploads and downloads wait this long for the other side

METHOD_KIND = {
    "system.info": "info",
    "files.search": "search",
    "files.list": "list",
    "files.upload": "upload",
    "files.save": "save",
    "browser.open": "browser_open",
    "browser.close": "browser_close",
}
METHODS = frozenset(METHOD_KIND)
# The agent tools that use a person's PC (agents/pc_tools.py): offered and allowed only to
# that person's own AI when they have a linked computer.
PC_TOOLS = frozenset(
    {"pc_find_files", "pc_list_folder", "pc_read_file", "pc_save_to_workspace", "pc_save_to_pc"}
)
# What goes into the activity log from a call's params: places and queries, never contents.
DETAIL_KEYS = ("query", "folder", "exts", "modified_after", "path", "name", "start_url", "channel")


class DeviceError(Exception):
    """A call that did not work: offline | timeout | paused | revoked | not_allowed |
    not_found | too_big | no_browser | busy | failed (the PC's own codes pass through)."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


def now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------- codes and tokens


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def norm_code(code: str) -> str:
    """Upper case, no spaces or dashes (people retype codes)."""
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())[:16]


def code_hash(code: str) -> str:
    return hashlib.sha256(norm_code(code).encode()).hexdigest()


def valid_code(code: str) -> bool:
    c = norm_code(code)
    return len(c) == CODE_LEN and all(ch in CODE_ALPHABET for ch in c)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return token_hash(token)


async def device_by_token(db: AsyncSession, token: str) -> Device | None:
    token = (token or "").strip()
    if not token or len(token) > 200:
        return None
    return await db.scalar(select(Device).where(Device.token_hash == hash_token(token)))


def bearer(headers: Mapping[str, str]) -> str:
    raw = headers.get("authorization") or ""
    return raw[7:].strip() if raw.lower().startswith("bearer ") else ""


# ---------------------------------------------------------------- names and folders


def first_name(name: str) -> str:
    return (name or "").strip().split(" ")[0] or "My"


def default_name(person: str, os_: str) -> str:
    kind = {"mac": "Mac", "windows": "Windows PC"}.get(os_, "computer")
    return f"{first_name(person)}'s {kind}"[:80]


_WIN_ABS = re.compile(r"^[A-Za-z]:[\\/]")
_CTRL = re.compile(r"[\x00-\x1f]")


def _absolute(path: str) -> bool:
    return path.startswith("/") or bool(_WIN_ABS.match(path)) or path.startswith("\\\\")


def clean_folders(raw: Any) -> list[str]:
    """Folders a person picked on the web: absolute paths, at most 20, each up to 400
    characters. Raises ValueError with a sentence for the person."""
    if not isinstance(raw, list):
        raise ValueError(Msg("Folders should be a list of paths."))
    if len(raw) > MAX_FOLDERS:
        raise ValueError(Msg("Pick at most {n} folders.", n=MAX_FOLDERS))
    out: list[str] = []
    for item in raw:
        path = str(item if item is not None else "").strip()
        if not path or len(path) > MAX_FOLDER_CHARS or _CTRL.search(path):
            raise ValueError(
                Msg("Each folder must be a path of up to {n} characters.", n=MAX_FOLDER_CHARS)
            )
        if not _absolute(path):
            raise ValueError(
                Msg("Use the full path of each folder, from the drive (C:) or from /.")
            )
        if path not in out:
            out.append(path)
    return out


def reported_folders(raw: Any) -> list[str]:
    """Folders the PC reported (hello / state): the valid ones, at most 20."""
    out: list[str] = []
    for item in raw if isinstance(raw, list) else []:
        path = str(item if item is not None else "").strip()
        if (
            path
            and len(path) <= MAX_FOLDER_CHARS
            and not _CTRL.search(path)
            and _absolute(path)
            and path not in out
        ):
            out.append(path)
        if len(out) >= MAX_FOLDERS:
            break
    return out


def short_list(raw: Any, limit: int = 10, size: int = 24) -> list[str]:
    return [str(x)[:size] for x in (raw if isinstance(raw, list) else [])[:limit] if x]


def clip(value: Any, size: int) -> str:
    return _CTRL.sub(" ", str(value or ""))[:size]


# ---------------------------------------------------------------- public addresses


def _explicit_public_url() -> str | None:
    if "public_url" in settings.model_fields_set and settings.public_url:
        return settings.public_url.rstrip("/")
    return None


_HOST = re.compile(r"^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$")


def public_base(headers: Mapping[str, str], scheme: str) -> str:
    """Where people (and their PCs) reach this server: AGENTIC_PUBLIC_URL when it is set,
    else the request's own address (behind nginx: X-Forwarded-Proto / Host)."""
    explicit = _explicit_public_url()
    if explicit:
        return explicit
    proto = (headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if proto not in ("http", "https"):
        proto = "https" if scheme in ("https", "wss") else "http"
    host = (headers.get("x-forwarded-host") or headers.get("host") or "").split(",")[0].strip()
    if not _HOST.match(host):
        return settings.public_url.rstrip("/")
    return f"{proto}://{host}"


def internal_url() -> str:
    """How the worker (and the browser service) reach the API inside the stack."""
    import os

    return (os.environ.get("AGENTIC_API_INTERNAL_URL") or settings.internal_api_url).rstrip("/")


def internal_token() -> str:
    """X-Internal-Token: proves a call came from our own worker (same app secret)."""
    import hmac

    return hmac.new(settings.secret_key.encode(), b"devices", hashlib.sha256).hexdigest()


def internal_ok(given: str | None) -> bool:
    import hmac

    return bool(given) and hmac.compare_digest(internal_token(), given or "")


# ---------------------------------------------------------------- online state (Valkey)


def online_key(device_id: str) -> str:
    return f"devices:online:{device_id}"


async def set_online(device_id: str, conn_id: str, base: str) -> None:
    await valkey().set(
        online_key(device_id), json.dumps({"conn": conn_id, "base": base}), ex=ONLINE_TTL
    )


async def touch_online(device_id: str) -> None:
    await valkey().expire(online_key(device_id), ONLINE_TTL)


async def clear_online(device_id: str, conn_id: str) -> None:
    """Only if this connection is still the one on record (a newer one may have replaced it)."""
    r = valkey()
    raw = await r.get(online_key(device_id))
    try:
        mine = raw is not None and json.loads(raw).get("conn") == conn_id
    except ValueError:
        mine = True
    if mine:
        await r.delete(online_key(device_id))


async def online_ids(ids: Iterable[str]) -> set[str]:
    ids = list(ids)
    if not ids:
        return set()
    try:
        vals = await valkey().mget([online_key(i) for i in ids])
    except Exception:  # noqa: BLE001 - shown as offline rather than failing the page
        log.warning("device online state unavailable", exc_info=True)
        return set()
    return {i for i, v in zip(ids, vals, strict=True) if v}


# ---------------------------------------------------------------- activity and events


def safe_detail(params: Mapping[str, Any] | None, extra: Mapping[str, Any] | None = None) -> dict:
    """Places, queries and counts for the activity log. Never file contents or one-time links."""
    out: dict[str, Any] = {}
    for k in DETAIL_KEYS:
        v = (params or {}).get(k)
        if v is None or v == "":
            continue
        out[k] = [clip(x, 40) for x in v[:20]] if isinstance(v, list) else clip(v, 500)
    for k, v in (extra or {}).items():
        if v is not None:
            out[k] = v if isinstance(v, int | bool) else clip(v, 500)
    return out


async def log_activity(
    db: AsyncSession,
    device: Device,
    kind: str,
    detail: dict[str, Any] | None = None,
    *,
    ok: bool = True,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> None:
    """The caller commits."""
    db.add(
        DeviceActivity(
            device_id=device.id,
            workspace_id=device.workspace_id,
            user_id=device.user_id,
            agent_id=agent_id,
            task_id=task_id,
            kind=kind[:16],
            detail=detail or {},
            ok=ok,
            ts=now(),
        )
    )


async def record(
    device_id: str,
    kind: str,
    detail: dict[str, Any],
    *,
    ok: bool,
    agent_id: str | None = None,
    task_id: str | None = None,
) -> None:
    """One activity row in its own session. Never raises: the log must not break the call."""
    try:
        async with SessionLocal() as db:
            d = await db.get(Device, device_id)
            if d is None:
                return
            if agent_id and await db.get(Agent, agent_id) is None:
                agent_id = None
            if task_id:
                from ..models import Task

                if await db.get(Task, task_id) is None:
                    task_id = None
            await log_activity(db, d, kind, detail, ok=ok, agent_id=agent_id, task_id=task_id)
            await db.commit()
    except Exception:  # noqa: BLE001
        log.warning("device activity not recorded: %s %s", device_id, kind, exc_info=True)


async def publish(device: Device, type_: str, **data: Any) -> None:
    """A live event for the device's own person only (api/scope.py PERSONAL_EVENTS)."""
    from ..services import events

    await events.publish(
        device.workspace_id, type_, {"device_id": device.id, "user_id": device.user_id, **data}
    )


# ---------------------------------------------------------------- who may use a PC


def personal(agent: Agent | None) -> bool:
    """A person's own AI: their twin or their private assistant (owner set)."""
    return bool(agent and agent.owner_user_id and (agent.is_twin or agent.private))


def _live(workspace_id: str, user_id: str) -> Any:
    return (
        select(Device)
        .where(
            Device.workspace_id == workspace_id,
            Device.user_id == user_id,
            Device.revoked_at.is_(None),
        )
        .order_by(Device.last_seen_at.desc().nulls_last(), Device.created_at.desc())
    )


async def live_devices(db: AsyncSession, workspace_id: str, user_id: str) -> list[Device]:
    return list((await db.scalars(_live(workspace_id, user_id))).all())


async def pc_ready(db: AsyncSession, agent: Agent) -> bool:
    """The agent is its person's own AI and that person has a linked computer."""
    if not personal(agent):
        return False
    q = _live(agent.workspace_id, agent.owner_user_id or "").with_only_columns(Device.id).limit(1)
    return (await db.scalar(q)) is not None


async def has_device(agent: Agent) -> bool:
    """pc_ready on its own session (policy.evaluate has none)."""
    if not personal(agent):
        return False
    async with SessionLocal() as db:
        return await pc_ready(db, agent)


def device_out(d: Device, online: bool) -> dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "os": d.os,
        "arch": d.arch,
        "version": d.version,
        "hostname": d.hostname,
        "online": online,
        "last_seen_at": d.last_seen_at,
        "folders": list(d.folders or []),
        "paused": d.paused,
        "browsers": list(d.browsers or []),
        "created_at": d.created_at,
    }
