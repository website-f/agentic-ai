"""Web Push (RFC 8030 + 8291 + 8292) without a push SDK: VAPID signing with `cryptography`,
payload encryption with `http_ece` (aes128gcm), delivery over our own httpx client.

The VAPID key pair is generated once per install and kept encrypted in instance_secrets.
Subscription endpoints are checked against known push services, so a forged subscription
cannot make the server call an internal address.
"""

import base64
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import http_ece
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from sqlalchemy.ext.asyncio import AsyncSession

from ..core import crypto
from ..core.config import settings
from ..engine import client as http
from ..i18n import Msg
from ..models import InstanceSecret, PushSubscription

# Push services browsers use today. Anything else is refused.
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "web.push.apple.com",
    "push.apple.com",
)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class BadSubscription(ValueError):
    pass


def check_endpoint(endpoint: str) -> None:
    parts = urlsplit(endpoint)
    host = (parts.hostname or "").lower()
    extra = {h.strip().lower() for h in settings.push_hosts_allowed.split(",") if h.strip()}
    known = any(host == h or host.endswith("." + h) for h in PUSH_HOSTS) or host in extra
    if parts.scheme != "https" or not known:
        raise BadSubscription(Msg("That is not a known browser push service."))


@dataclass
class Vapid:
    private: ec.EllipticCurvePrivateKey
    public_b64: str  # uncompressed point, base64url: what the browser's subscribe() wants


async def vapid(db: AsyncSession) -> Vapid:
    row = await db.get(InstanceSecret, "vapid")
    if row is None:
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        pub = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        row = InstanceSecret(
            name="vapid",
            value_enc=crypto.encrypt(pem, "instance_secret:vapid"),
            public=b64u(pub),
            created_at=datetime.now(UTC),
        )
        db.add(row)
        await db.commit()
    private = serialization.load_pem_private_key(
        crypto.decrypt(row.value_enc, "instance_secret:vapid").encode(), password=None
    )
    assert isinstance(private, ec.EllipticCurvePrivateKey)
    return Vapid(private, row.public or "")


def vapid_header(v: Vapid, endpoint: str) -> str:
    parts = urlsplit(endpoint)
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64u(
        json.dumps(
            {
                "aud": f"{parts.scheme}://{parts.netloc}",
                "exp": int(time.time()) + 12 * 3600,
                "sub": settings.push_contact,
            }
        ).encode()
    )
    signing_input = f"{header}.{claims}".encode()
    r, s = decode_dss_signature(v.private.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return f"vapid t={header}.{claims}.{b64u(sig)}, k={v.public_b64}"


def encrypt(payload: dict[str, Any], p256dh: str, auth: str) -> bytes:
    ephemeral = ec.generate_private_key(ec.SECP256R1())
    return http_ece.encrypt(
        json.dumps(payload).encode(),
        private_key=ephemeral,
        dh=b64u_decode(p256dh),
        auth_secret=b64u_decode(auth),
        version="aes128gcm",
    )


@dataclass
class PushResult:
    ok: bool
    gone: bool  # the subscription no longer exists: delete it
    status: int
    detail: str = ""


async def send(
    db: AsyncSession, sub: PushSubscription, payload: dict[str, Any], *, urgency: str = "high"
) -> PushResult:
    check_endpoint(sub.endpoint)
    v = await vapid(db)
    body = encrypt(payload, sub.p256dh, sub.auth)
    headers = {
        "Authorization": vapid_header(v, sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "3600",
        "Urgency": urgency,
    }
    async with http._client(timeout=15) as c:  # noqa: SLF001 - shared transport hook (tests)
        r = await c.post(sub.endpoint, content=body, headers=headers)
    if r.status_code in (200, 201, 202):
        return PushResult(True, False, r.status_code)
    return PushResult(False, r.status_code in (404, 410), r.status_code, r.text[:300])
