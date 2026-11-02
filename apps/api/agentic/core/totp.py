"""P57: time-based one-time codes (RFC 6238 over RFC 4226), standard library only.

SHA-1, 6 digits, 30-second steps: what every authenticator app (Google Authenticator,
Microsoft Authenticator, Authy, 1Password) reads from an otpauth:// link by default.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

DIGITS = 6
PERIOD = 30
WINDOW = 1  # accept one step either side: a phone clock a little off still works


def new_secret() -> str:
    """160 random bits (RFC 4226's recommended length), base32 without padding."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def step_at(when: float | None = None) -> int:
    return int((time.time() if when is None else when) // PERIOD)


def code_at(secret: str, step: int) -> str:
    """RFC 4226 HOTP with dynamic truncation."""
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def clean(code: str) -> str:
    """What people paste: "123 456", "123-456" -> "123456"."""
    return "".join(ch for ch in code if ch.isdigit())


def match(secret: str, code: str, when: float | None = None) -> int | None:
    """The step this code belongs to (within the window), or None. The caller rejects a step
    at or before the last one accepted, so a code works once."""
    c = clean(code)
    if len(c) != DIGITS:
        return None
    now = step_at(when)
    found = None
    for step in range(now - WINDOW, now + WINDOW + 1):
        # Compare every candidate, so timing does not reveal which step matched.
        if hmac.compare_digest(code_at(secret, step), c):
            found = step
    return found


def uri(secret: str, account: str, issuer: str) -> str:
    """otpauth://totp/Issuer:account?secret=...&issuer=... (the Key Uri Format)."""
    label = quote(f"{issuer}:{account}", safe="@:")
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": DIGITS,
            "period": PERIOD,
        }
    )
    return f"otpauth://totp/{label}?{query}"
