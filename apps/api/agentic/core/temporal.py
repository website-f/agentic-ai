"""Lazily connected, process-wide Temporal client."""

import asyncio

from temporalio.client import Client

from .config import settings

_client: Client | None = None
_lock = asyncio.Lock()


async def temporal_client() -> Client:
    global _client
    async with _lock:
        if _client is None:
            _client = await Client.connect(
                settings.temporal_address, namespace=settings.temporal_namespace
            )
        return _client
