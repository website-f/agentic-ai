"""Shared Valkey (Redis-protocol) client. Valkey speaks RESP, so redis-py works unchanged."""

import redis.asyncio as aioredis

from .config import settings

_client: aioredis.Redis | None = None
_binary: aioredis.Redis | None = None


def valkey() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(settings.valkey_url, decode_responses=True)
    return _client


def valkey_bytes() -> aioredis.Redis:
    """For binary values (browser frames): no text decoding."""
    global _binary
    if _binary is None:
        _binary = aioredis.from_url(settings.valkey_url, decode_responses=False)
    return _binary


async def close_valkey() -> None:
    global _client, _binary
    for c in (_client, _binary):
        if c is not None:
            await c.aclose()
    _client = _binary = None
