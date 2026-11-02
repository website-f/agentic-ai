"""P57: two-step sign-in: the workspace rule, sealed secrets, one-time codes, recovery codes,
the sign-in challenge between the password and the code, and the code-attempt limits."""

import hashlib
import json
import secrets
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from ..core import crypto, totp
from ..core.config import settings
from ..core.security import new_token, token_hash
from ..core.valkey import valkey
from ..models import User

Policy = Literal["off", "admins", "everyone"]
POLICIES: tuple[Policy, ...] = ("off", "admins", "everyone")
SETTING = "require_2fa"
# "Owners and admins": the roles that run the whole workspace (members, settings, every
# login and file). Office roles (branch manager, HOD) are covered by "everyone".
ADMIN_ROLES = frozenset({"owner", "admin"})

ISSUER = "Agentic Office"
RECOVERY_COUNT = 10
CHALLENGE_SECONDS = 300
# No look-alikes (0/o, 1/l/i): recovery codes get typed from paper.
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def policy(ws_settings: Mapping[str, Any] | None) -> Policy:
    """The workspace rule. No key (a workspace from before P57) reads as off."""
    raw = (ws_settings or {}).get(SETTING)
    return raw if raw in POLICIES else "off"


def covers(rule: Policy, role: str) -> bool:
    return rule == "everyone" or (rule == "admins" and role in ADMIN_ROLES)


def enabled(user: User) -> bool:
    return user.totp_enabled_at is not None and bool(user.totp_secret_enc)


def due(user: User, role: str, ws_settings: Mapping[str, Any] | None) -> bool:
    """The workspace asks this person for two-step sign-in and they have not set it up."""
    return covers(policy(ws_settings), role) and not enabled(user)


# ---------------------------------------------------------------- secrets and codes


def _aad(user_id: str) -> str:
    return f"user_totp:{user_id}"


def seal(user_id: str, secret: str) -> str:
    return crypto.encrypt(secret, _aad(user_id))


def unseal(user: User) -> str | None:
    if not user.totp_secret_enc:
        return None
    try:
        return crypto.decrypt(user.totp_secret_enc, _aad(user.id))
    except crypto.DecryptError:
        return None


def check_code(user: User, code: str) -> bool:
    """A current code from the person's app, never one already used: the step must be after
    the last accepted one. The caller holds the user row locked (SELECT ... FOR UPDATE) and
    commits, so two requests racing with one code cannot both win."""
    secret = unseal(user)
    if secret is None:
        return False
    step = totp.match(secret, code)
    if step is None or (user.totp_last_step is not None and step <= user.totp_last_step):
        return False
    user.totp_last_step = step
    return True


def _norm_recovery(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def _hash_recovery(user_id: str, code: str) -> str:
    # 60 random bits per code, salted with the user id: sha-256 is enough (no slow hash
    # needed for a random code, unlike a password).
    return hashlib.sha256(f"{user_id}:{_norm_recovery(code)}".encode()).hexdigest()


def new_recovery_codes(user: User) -> list[str]:
    """Fresh codes (shown once); only their hashes are kept."""
    codes = []
    for _ in range(RECOVERY_COUNT):
        raw = "".join(secrets.choice(_ALPHABET) for _ in range(12))
        codes.append(f"{raw[:4]}-{raw[4:8]}-{raw[8:]}")
    user.recovery_codes = [_hash_recovery(user.id, c) for c in codes]
    return codes


def use_recovery_code(user: User, code: str) -> bool:
    """True and the code is spent, or False. The caller holds the row lock and commits."""
    if len(_norm_recovery(code)) != 12:
        return False
    h = _hash_recovery(user.id, code)
    kept = list(user.recovery_codes or [])
    hit = next((x for x in kept if secrets.compare_digest(x, h)), None)
    if hit is None:
        return False
    kept.remove(hit)
    user.recovery_codes = kept  # a new list, so the JSONB change is saved
    return True


def start_setup(user: User) -> tuple[str, str]:
    """A new secret waiting for its first code. Returns (secret, otpauth uri)."""
    secret = totp.new_secret()
    user.totp_secret_enc = seal(user.id, secret)
    user.totp_enabled_at = None
    user.totp_last_step = None
    return secret, totp.uri(secret, user.email, ISSUER)


def turn_on(user: User) -> list[str]:
    user.totp_enabled_at = datetime.now(UTC)
    return new_recovery_codes(user)


def turn_off(user: User) -> None:
    user.totp_secret_enc = None
    user.totp_enabled_at = None
    user.totp_last_step = None
    user.recovery_codes = []


# ---------------------------------------------------------------- the sign-in challenge


def _challenge_key(token: str) -> str:
    return f"2fa:challenge:{token_hash(token)}"


async def new_challenge(user_id: str, workspace_id: str) -> str:
    """Password accepted, code still to come. Short-lived and kept only as a hash."""
    token = new_token()
    await valkey().set(
        _challenge_key(token),
        json.dumps({"user_id": user_id, "workspace_id": workspace_id, "fails": 0}),
        ex=CHALLENGE_SECONDS,
    )
    return token


async def read_challenge(token: str) -> dict[str, Any] | None:
    raw = await valkey().get(_challenge_key(token))
    return json.loads(raw) if raw else None


async def challenge_failed(token: str) -> int:
    """Count a wrong code on this challenge; past the limit the challenge is gone (the
    password must be entered again). Returns the attempts left."""
    r = valkey()
    key = _challenge_key(token)
    raw = await r.get(key)
    if not raw:
        return 0
    data = json.loads(raw)
    data["fails"] = int(data.get("fails", 0)) + 1
    left = settings.two_factor_fails_per_challenge - data["fails"]
    if left <= 0:
        await r.delete(key)
        return 0
    await r.set(key, json.dumps(data), keepttl=True)
    return left


async def drop_challenge(token: str) -> None:
    await valkey().delete(_challenge_key(token))


# ---------------------------------------------------------------- attempt limits per person


def _fail_key(user_id: str) -> str:
    return f"2fa:fail:{user_id}"


async def locked_for(user_id: str) -> int:
    """Seconds until codes are accepted again for this person; 0 = not locked."""
    r = valkey()
    fails = await r.get(_fail_key(user_id))
    if fails and int(fails) >= settings.two_factor_fails_per_user:
        return max(int(await r.ttl(_fail_key(user_id))), 1)
    return 0


async def register_failure(user_id: str) -> None:
    r = valkey()
    async with r.pipeline(transaction=True) as pipe:
        pipe.incr(_fail_key(user_id))
        pipe.expire(_fail_key(user_id), settings.login_lock_seconds, nx=True)
        await pipe.execute()


async def clear_failures(user_id: str) -> None:
    await valkey().delete(_fail_key(user_id))
