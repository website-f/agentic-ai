"""WhatsApp (P16): one office number, two ways to connect it.

- WAHA (self-hosted WhatsApp HTTP API, devlikeapro/waha): the office phone scans a QR code
  shown in the dashboard. Free and quick for testing and small offices. It is unofficial:
  message only people who linked themselves, never bulk-send, or WhatsApp may ban the number.
- Meta Cloud API (official): a WhatsApp Business number with a permanent token. Free-form
  text reaches someone only within 24 hours of their last message; outside that window an
  approved template is used (set its name in the channel).

People link their own WhatsApp by sending a one-time code to the office number, exactly like
Telegram, so only people who asked for it ever get messages.
"""

import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

GRAPH = "https://graph.facebook.com/v21.0"
# Appended (invisibly) to everything we send through WAHA. When the office number is the
# owner's own phone they talk to their assistant in "Message yourself", where our replies also
# arrive as the owner's own messages: the mark stops the assistant answering itself.
MARK = "\u2063"
WAHA_EVENTS = ["message.any", "session.status"]
transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake


class WhatsAppError(Exception):
    def __init__(self, message: str, status: int = 0, code: int | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class Config:
    provider: str = "waha"  # waha | meta
    # WAHA
    base_url: str = ""
    api_key: str = ""
    session: str = "default"
    webhook_secret: str = ""
    # Meta Cloud API
    phone_number_id: str = ""
    token: str = ""
    app_secret: str = ""
    verify_token: str = ""
    template: str = ""
    template_lang: str = "en"
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, raw: str) -> "Config":
        data = json.loads(raw or "{}")
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__ and k != "extra"}
        return cls(**known)

    def dump(self) -> str:
        return json.dumps({k: v for k, v in self.__dict__.items() if k != "extra"})


def digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _client(timeout: float = 20) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, transport=transport)


# ---------------------------------------------------------------- WAHA


async def _waha(cfg: Config, method: str, path: str, body: Any = None, raw: bool = False) -> Any:
    headers = {"X-Api-Key": cfg.api_key} if cfg.api_key else {}
    async with _client() as c:
        r = await c.request(method, cfg.base_url.rstrip("/") + path, json=body, headers=headers)
    if r.status_code >= 400:
        detail = r.text[:200]
        raise WhatsAppError(f"WAHA answered {r.status_code}: {detail}", r.status_code)
    if raw:
        return r
    return r.json() if r.content and "json" in r.headers.get("content-type", "") else None


async def waha_status(cfg: Config) -> dict[str, Any]:
    """{"status": STOPPED|STARTING|SCAN_QR_CODE|WORKING|FAILED, "me": {...}|None}."""
    try:
        s = await _waha(cfg, "GET", f"/api/sessions/{cfg.session}")
    except WhatsAppError as e:
        if e.status == 404:
            return {"status": "MISSING", "me": None}
        raise
    return {"status": (s or {}).get("status", "UNKNOWN"), "me": (s or {}).get("me")}


async def waha_start(cfg: Config, webhook_url: str) -> dict[str, Any]:
    """Create (or update) the session with our webhook, and start it."""
    config = {
        "webhooks": [
            {
                "url": webhook_url,
                "events": WAHA_EVENTS,
                "hmac": {"key": cfg.webhook_secret},
            }
        ]
    }
    try:
        await _waha(
            cfg, "POST", "/api/sessions", {"name": cfg.session, "start": True, "config": config}
        )
    except WhatsAppError as e:
        if e.status not in (409, 422):  # it exists: update and start it
            raise
        await _waha(
            cfg, "PUT", f"/api/sessions/{cfg.session}", {"name": cfg.session, "config": config}
        )
        try:
            await _waha(cfg, "POST", f"/api/sessions/{cfg.session}/start")
        except WhatsAppError as e2:
            if e2.status not in (409, 422):  # already started
                raise
    return await waha_status(cfg)


async def waha_ensure_webhook(cfg: Config, webhook_url: str) -> bool:
    """Bring an existing session's webhook up to date (url and events). True if changed."""
    try:
        s = await _waha(cfg, "GET", f"/api/sessions/{cfg.session}") or {}
    except WhatsAppError:
        return False
    hooks = ((s.get("config") or {}).get("webhooks")) or []
    ok = any(
        h.get("url") == webhook_url and set(h.get("events") or []) >= set(WAHA_EVENTS)
        for h in hooks
    )
    if ok:
        return False
    config = {
        **(s.get("config") or {}),
        "webhooks": [
            {"url": webhook_url, "events": WAHA_EVENTS, "hmac": {"key": cfg.webhook_secret}}
        ],
    }
    await _waha(cfg, "PUT", f"/api/sessions/{cfg.session}", {"name": cfg.session, "config": config})
    return True


async def waha_qr(cfg: Config) -> str | None:
    """The login QR as a data: URL, while the session waits to be scanned."""
    r = await _waha(cfg, "GET", f"/api/{cfg.session}/auth/qr?format=image", raw=True)
    ctype = r.headers.get("content-type", "")
    if "json" in ctype:  # some versions answer {"mimetype","data"}
        data = r.json()
        if data.get("data"):
            return f"data:{data.get('mimetype', 'image/png')};base64,{data['data']}"
        return None
    if ctype.startswith("image/"):
        return f"data:{ctype};base64,{base64.b64encode(r.content).decode()}"
    return None


async def waha_logout(cfg: Config) -> None:
    await _waha(cfg, "POST", f"/api/sessions/{cfg.session}/logout")


def waha_chat_id(to: str) -> str:
    return to if "@" in to else f"{digits(to)}@c.us"


# ---------------------------------------------------------------- Meta Cloud API


async def _meta(cfg: Config, body: dict[str, Any]) -> dict[str, Any]:
    async with _client() as c:
        r = await c.post(
            f"{GRAPH}/{cfg.phone_number_id}/messages",
            json=body,
            headers={"Authorization": f"Bearer {cfg.token}"},
        )
    data = r.json() if r.content else {}
    if r.status_code >= 400:
        err = (data or {}).get("error", {})
        raise WhatsAppError(
            f"Meta answered {r.status_code}: {err.get('message', r.text[:200])}",
            r.status_code,
            err.get("code"),
        )
    return data


async def meta_check(cfg: Config) -> dict[str, Any]:
    async with _client() as c:
        r = await c.get(
            f"{GRAPH}/{cfg.phone_number_id}",
            params={"fields": "display_phone_number,verified_name"},
            headers={"Authorization": f"Bearer {cfg.token}"},
        )
    if r.status_code >= 400:
        raise WhatsAppError(f"Meta answered {r.status_code}: {r.text[:200]}", r.status_code)
    return r.json()


# ---------------------------------------------------------------- both


async def send_text(cfg: Config, to: str, text: str) -> str:
    """Send a text; returns the provider's message id."""
    text = text[:4000]
    if cfg.provider == "meta":
        body = {
            "messaging_product": "whatsapp",
            "to": digits(to),
            "type": "text",
            "text": {"body": text, "preview_url": False},
        }
        try:
            data = await _meta(cfg, body)
        except WhatsAppError as e:
            # 131047: outside the 24-hour window; only an approved template may start a chat.
            if e.code != 131047 or not cfg.template:
                raise
            data = await _meta(
                cfg,
                {
                    "messaging_product": "whatsapp",
                    "to": digits(to),
                    "type": "template",
                    "template": {
                        "name": cfg.template,
                        "language": {"code": cfg.template_lang or "en"},
                        "components": [
                            {"type": "body", "parameters": [{"type": "text", "text": text[:1000]}]}
                        ],
                    },
                },
            )
        return str(((data.get("messages") or [{}])[0]).get("id", ""))
    data = await _waha(
        cfg,
        "POST",
        "/api/sendText",
        {"session": cfg.session, "chatId": waha_chat_id(to), "text": text + MARK},
    )
    mid = (data or {}).get("id", "")
    return str(mid.get("_serialized", "") if isinstance(mid, dict) else mid)  # WAHA: object or str


def verify_waha(cfg: Config, body: bytes, signature: str | None) -> bool:
    if not cfg.webhook_secret:
        return False
    want = hmac.new(cfg.webhook_secret.encode(), body, hashlib.sha512).hexdigest()
    return bool(signature) and hmac.compare_digest(want, signature or "")


def verify_meta(cfg: Config, body: bytes, signature: str | None) -> bool:
    if not cfg.app_secret or not signature or not signature.startswith("sha256="):
        return False
    want = hmac.new(cfg.app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, signature.removeprefix("sha256="))


@dataclass
class Audio:
    """A voice note (P18). WAHA: the file's path on the WAHA server (always fetched from the
    channel's own WAHA address, so the API key never goes anywhere else). Meta: a media id."""

    ref: str
    mime: str
    seconds: float | None = None


@dataclass
class Inbound:
    message_id: str
    sender: str  # the chat to answer: 60123456789@c.us (WAHA) or 60123456789 (Meta)
    name: str
    text: str
    audio: Audio | None = None


def _same_number(a: str, b: str) -> bool:
    da, db = digits(a.split("@")[0]), digits(b.split("@")[0])
    return bool(da) and da == db


def parse_waha(payload: dict[str, Any]) -> list[Inbound]:
    """People's messages to the office number, plus the owner's own "Message yourself" chat
    when the office number is their phone. Groups, statuses and our own sends are skipped."""
    if payload.get("event") not in ("message", "message.any"):
        return []
    p = payload.get("payload") or {}
    text = str(p.get("body") or "").strip()
    if MARK in text:
        return []  # a message we sent
    audio = None if text else _waha_audio(p)
    if not text and audio is None:
        return []  # empty, or media other than a voice note
    me = payload.get("me") or {}
    sender = str(p.get("from") or "")
    if p.get("fromMe"):
        # Sent from the office phone itself: only its chat with itself counts.
        to = str(p.get("to") or "")
        mine = [x for x in (me.get("id"), me.get("lid")) if x]
        if not mine or not (to in mine or any(_same_number(to, m) for m in mine)):
            return []
        sender = str(me.get("id") or to)
    if not sender or "@" not in sender or sender.endswith(("@g.us", "@broadcast", "@newsletter")):
        return []
    name = str(
        ((p.get("_data") or {}).get("notifyName"))
        or (p.get("notifyName") or "")
        or me.get("pushName")
        or ""
    )
    return [Inbound(str(p.get("id") or ""), sender, name, text, audio)]


def _seconds(*values: Any) -> float | None:
    for v in values:
        try:
            if v is not None and float(v) > 0:
                return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _waha_audio(p: dict[str, Any]) -> Audio | None:
    """A voice note or audio file WAHA already downloaded (hasMedia + media.url)."""
    m = p.get("media") or {}
    if not p.get("hasMedia") or not isinstance(m, dict) or not m.get("url"):
        return None
    mime = str(m.get("mimetype") or "")
    if not mime.lower().startswith("audio/"):
        return None
    u = urlparse(str(m["url"]))
    path = u.path + (f"?{u.query}" if u.query else "")
    if not path.startswith("/api/files/"):  # WAHA serves downloaded media only there
        return None
    data = p.get("_data") or {}
    audio_msg = ((data.get("message") or {}).get("audioMessage") or {}) if data else {}
    return Audio(path, mime, _seconds(data.get("duration"), audio_msg.get("seconds")))


def parse_meta(payload: dict[str, Any]) -> list[Inbound]:
    out: list[Inbound] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            names = {
                c.get("wa_id"): (c.get("profile") or {}).get("name", "")
                for c in value.get("contacts") or []
            }
            for m in value.get("messages") or []:
                sender = str(m.get("from") or "")
                audio = None
                if m.get("type") == "audio" and (m.get("audio") or {}).get("id"):
                    a = m["audio"]
                    audio = Audio(str(a["id"]), str(a.get("mime_type") or "audio/ogg"))
                elif m.get("type") != "text":
                    continue
                out.append(
                    Inbound(
                        str(m.get("id") or ""),
                        sender,
                        names.get(sender, ""),
                        str((m.get("text") or {}).get("body") or "").strip(),
                        audio,
                    )
                )
    return [m for m in out if (m.text or m.audio) and m.sender]


# ---------------------------------------------------------------- voice notes (P18)

# Meta hands out media URLs on its own CDN; the token is only ever sent to these hosts.
META_MEDIA_HOSTS = (".fbsbx.com", ".facebook.com", ".whatsapp.net")


async def _fetch(c: httpx.AsyncClient, url: str, headers: dict[str, str], max_bytes: int) -> bytes:
    async with c.stream("GET", url, headers=headers) as r:
        if r.status_code >= 400:
            raise WhatsAppError(f"The voice note could not be downloaded ({r.status_code}).")
        data = bytearray()
        async for chunk in r.aiter_bytes():
            data.extend(chunk)
            if len(data) > max_bytes:
                raise WhatsAppError("The voice note is too large.", 413)
    return bytes(data)


async def download_audio(cfg: Config, audio: Audio, max_bytes: int) -> bytes:
    """The voice note's bytes, from WAHA (X-Api-Key) or from Meta (media id -> URL)."""
    async with _client(timeout=60) as c:
        if cfg.provider == "meta":
            auth = {"Authorization": f"Bearer {cfg.token}"}
            r = await c.get(f"{GRAPH}/{audio.ref}", headers=auth)
            if r.status_code >= 400:
                raise WhatsAppError(f"Meta answered {r.status_code} for the voice note.")
            info = r.json()
            url = str(info.get("url") or "")
            host = (urlparse(url).hostname or "").lower()
            if urlparse(url).scheme != "https" or not host.endswith(META_MEDIA_HOSTS):
                raise WhatsAppError("Meta gave an unexpected address for the voice note.")
            if int(info.get("file_size") or 0) > max_bytes:
                raise WhatsAppError("The voice note is too large.", 413)
            return await _fetch(c, url, auth, max_bytes)
        headers = {"X-Api-Key": cfg.api_key} if cfg.api_key else {}
        return await _fetch(c, cfg.base_url.rstrip("/") + audio.ref, headers, max_bytes)
