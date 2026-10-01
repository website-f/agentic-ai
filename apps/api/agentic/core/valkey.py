"""Shared Valkey (Redis-protocol) client. Valkey speaks RESP, so redis-py works unchanged."""

import redis.asyncio as aioredis

from .config import settings

_client: aioredis.Redis | None = None


def valkey() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(settings.valkey_url, decode_responses=True)
    return _client


async def close_valkey() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
