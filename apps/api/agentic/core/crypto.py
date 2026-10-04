"""Envelope encryption for secrets at rest (provider keys now, channel tokens later).

Each secret gets its own random data key (DEK). The DEK encrypts the secret with
AES-256-GCM; the master key wraps the DEK. Rotating the master key only rewraps DEKs.

The record's identity is bound in as associated data (e.g. "ai_provider:ap_01j..."),
so an encrypted key copied onto another row fails to decrypt instead of leaking.

Format: v1.<b64url(nonce|wrapped_dek)>.<b64url(nonce|ciphertext)>
"""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

VERSION = "v1"


class DecryptError(Exception):
    pass


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _master_key() -> bytes:
    if settings.master_key:
        key = _b64d(settings.master_key)
        if len(key) != 32:
            raise RuntimeError("AGENTIC_MASTER_KEY must be 32 bytes, base64url encoded")
        return key
    if not settings.is_dev:
        raise RuntimeError("AGENTIC_MASTER_KEY must be set outside env=dev")
    # Dev only: derived so a fresh checkout works with zero configuration.
    return hashlib.sha256(f"agentic-dev-master:{settings.secret_key}".encode()).digest()


def encrypt(plaintext: str, aad: str) -> str:
    dek = AESGCM.generate_key(bit_length=256)
    n1, n2 = os.urandom(12), os.urandom(12)
    wrapped = AESGCM(_master_key()).encrypt(n1, dek, b"dek:" + aad.encode())
    sealed = AESGCM(dek).encrypt(n2, plaintext.encode(), aad.encode())
    return f"{VERSION}.{_b64e(n1 + wrapped)}.{_b64e(n2 + sealed)}"


def decrypt(token: str, aad: str) -> str:
    try:
        version, wrapped_b64, sealed_b64 = token.split(".")
        if version != VERSION:
            raise DecryptError(f"unknown secret format {version}")
        w, s = _b64d(wrapped_b64), _b64d(sealed_b64)
        dek = AESGCM(_master_key()).decrypt(w[:12], w[12:], b"dek:" + aad.encode())
        return AESGCM(dek).decrypt(s[:12], s[12:], aad.encode()).decode()
    except (ValueError, InvalidTag) as e:
        raise DecryptError("secret could not be decrypted (wrong master key or moved row)") from e


def dev_master_key(secret_key: str) -> bytes:
    """The key a dev install derives from its secret key (see _master_key)."""
    return hashlib.sha256(f"agentic-dev-master:{secret_key}".encode()).digest()


def rewrap(token: str, aad: str, old_key: bytes, new_key: bytes) -> str:
    """Move one secret to a new master key. Only the data key is re-wrapped; the secret
    itself is never decrypted. Raises DecryptError if `old_key` is not the right one."""
    try:
        version, wrapped_b64, sealed_b64 = token.split(".")
        if version != VERSION:
            raise DecryptError(f"unknown secret format {version}")
        w = _b64d(wrapped_b64)
        dek = AESGCM(old_key).decrypt(w[:12], w[12:], b"dek:" + aad.encode())
    except (ValueError, InvalidTag) as e:
        raise DecryptError("secret could not be unwrapped with the old master key") from e
    n1 = os.urandom(12)
    wrapped = AESGCM(new_key).encrypt(n1, dek, b"dek:" + aad.encode())
    return f"{VERSION}.{_b64e(n1 + wrapped)}.{sealed_b64}"


def hint(plaintext: str) -> str:
    """What the UI may show: the last four characters only."""
    return f"…{plaintext[-4:]}" if len(plaintext) > 8 else "…"
