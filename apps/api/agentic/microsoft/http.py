"""The one HTTP doorway to Microsoft (login.microsoftonline.com and graph.microsoft.com).

Tests swap in a fake Microsoft: `http.transport = httpx.MockTransport(handler)`, and
`http.sleep` for a no-wait sleep so Retry-After does not slow them down.
"""

import asyncio

import httpx

transport: httpx.AsyncBaseTransport | None = None
sleep = asyncio.sleep
TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=transport)
