"""The one HTTP doorway to Microsoft (login.microsoftonline.com and graph.microsoft.com).

Tests swap in a fake Microsoft: `http.transport = httpx.MockTransport(handler)`, and
`http.sleep` for a no-wait sleep so Retry-After does not slow them down.

P64: one kept-alive client per event loop, instead of a new one (and a new TLS handshake to
Microsoft, a few hundred ms from this server) for every call.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

transport: httpx.AsyncBaseTransport | None = None
sleep = asyncio.sleep
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
LIMITS = httpx.Limits(max_connections=40, max_keepalive_connections=20, keepalive_expiry=60)

_shared: dict[tuple[int, int], httpx.AsyncClient] = {}


@asynccontextmanager
async def client() -> AsyncIterator[httpx.AsyncClient]:
    """The shared client for this loop (and this transport: tests change it). Not closed on
    exit: the next call reuses its connections."""
    key = (id(asyncio.get_running_loop()), id(transport))
    c = _shared.get(key)
    if c is None or c.is_closed:
        if len(_shared) >= 8:  # loops that ended (tests): forget them, they cannot be closed here
            _shared.clear()
        c = _shared[key] = httpx.AsyncClient(timeout=TIMEOUT, transport=transport, limits=LIMITS)
    yield c
