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

import httpx

GRAPH = "https://graph.facebook.com/v21.0"
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
                "events": ["message", "session.status"],
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
        {"session": cfg.session, "chatId": waha_chat_id(to), "text": text},
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
class Inbound:
    message_id: str
    sender: str  # the chat to answer: 60123456789@c.us (WAHA) or 60123456789 (Meta)
    name: str
    text: str


def parse_waha(payload: dict[str, Any]) -> list[Inbound]:
    if payload.get("event") != "message":
        return []
    p = payload.get("payload") or {}
    sender = str(p.get("from") or "")
    if p.get("fromMe") or not sender or sender.endswith("@g.us") or "@" not in sender:
        return []  # our own messages, and groups, are not for us
    text = str(p.get("body") or "").strip()
    if not text:
        return []
    name = str(((p.get("_data") or {}).get("notifyName")) or (p.get("notifyName") or ""))
    return [Inbound(str(p.get("id") or ""), sender, name, text)]


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
                if m.get("type") != "text":
                    continue
                sender = str(m.get("from") or "")
                out.append(
                    Inbound(
                        str(m.get("id") or ""),
                        sender,
                        names.get(sender, ""),
                        str((m.get("text") or {}).get("body") or "").strip(),
                    )
                )
    return [m for m in out if m.text and m.sender]
