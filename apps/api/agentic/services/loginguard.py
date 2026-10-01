"""Brute-force protection: per-email and per-IP failure counters in Valkey."""

from ..core.config import settings
from ..core.valkey import valkey


def _keys(email: str, ip: str) -> tuple[str, str]:
    return f"login_fail:email:{email}", f"login_fail:ip:{ip}"


async def locked_for(email: str, ip: str) -> int:
    """Seconds until the next attempt is allowed; 0 means not locked."""
    k_email, k_ip = _keys(email, ip)
    r = valkey()
    fails_email, fails_ip = await r.mget(k_email, k_ip)
    if fails_email and int(fails_email) >= settings.login_max_fails_per_email:
        return max(int(await r.ttl(k_email)), 1)
    if fails_ip and int(fails_ip) >= settings.login_max_fails_per_ip:
        return max(int(await r.ttl(k_ip)), 1)
    return 0


async def register_failure(email: str, ip: str) -> None:
    r = valkey()
    async with r.pipeline(transaction=True) as pipe:
        for key in _keys(email, ip):
            pipe.incr(key)
            pipe.expire(key, settings.login_lock_seconds, nx=True)
        await pipe.execute()


async def clear(email: str) -> None:
    await valkey().delete(_keys(email, "")[0])
