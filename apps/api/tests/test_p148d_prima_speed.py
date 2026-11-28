"""P148d (speed): where a Prima call's time goes, readable on the live server (Server-Timing:
the office's own part, the round trip to Prima, then Prima's own figures), and the top record
renewed in the background instead of making one call wait for Prima's whole staff list."""

import asyncio
import re
import time

import httpx

from agentic.core.config import settings
from agentic.prima import client as prima
from agentic.prima.client import StaffRecord

from . import test_p66_prima as test_p66
from .test_agents import office
from .test_p66_prima import STAFF, prima_on  # noqa: F401

CEO = {"id": "u-ceo", "name": "Fauzan", "title": "CEO", "role": "director",
       "entraOid": None, "canSignIn": True, "top": "ceo"}  # fmt: skip


async def test_a_forwarded_call_says_where_its_time_went(client, prima_on, monkeypatch):  # noqa: F811
    await office(client)
    monkeypatch.setattr(test_p66, "STAFF", [*STAFF, CEO])
    r = await client.get("/api/prima/api/leave")
    assert r.status_code == 200 and r.json()["as"] == "u-ceo"
    assert re.fullmatch(r"office;dur=\d+\.\d, prima-call;dur=\d+\.\d", r.headers["server-timing"])

    # Prima's own figures follow the office's, as Prima sent them.
    inner = prima.transport

    async def with_timing(req: httpx.Request) -> httpx.Response:
        res = await inner.handle_async_request(req)
        await res.aread()
        timing = 'prima;dur=12.5, prima-db;dur=3.0;desc="4 queries"'
        headers = {**res.headers, "server-timing": timing}
        return httpx.Response(res.status_code, content=res.content, headers=headers)

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(with_timing))
    r = await client.get("/api/prima/api/leave")
    office_part = r"office;dur=\d+\.\d, prima-call;dur=\d+\.\d, "
    prima_part = r'prima;dur=12\.5, prima-db;dur=3\.0;desc="4 queries"'
    assert re.fullmatch(office_part + prima_part, r.headers["server-timing"])
    assert r.headers["cache-control"] == "no-store"


async def test_the_top_record_is_renewed_without_making_a_call_wait(monkeypatch):
    monkeypatch.setattr(settings, "prima_url", "http://prima.test:3000")
    monkeypatch.setattr(settings, "prima_secret", "o" * 40)
    asked = asyncio.Event()
    release = asyncio.Event()
    staff = [{**CEO, "name": "Fauzan Renewed"}]

    async def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/api/office/staff"
        asked.set()
        await release.wait()
        return httpx.Response(200, json=staff)

    monkeypatch.setattr(prima, "transport", httpx.MockTransport(handler))
    old = StaffRecord(id="u-ceo", name="Fauzan", title="CEO", role="director", entra_oid=None,
                      can_sign_in=True, top="ceo")  # fmt: skip
    monkeypatch.setattr(prima, "_TOP", {settings.prima_url: (time.monotonic() - 1, old)})
    assert (await prima.top_record()) is old, "fresh: no call to Prima"

    prima._TOP[settings.prima_url] = (time.monotonic() - prima.TOP_TTL - 1, old)
    assert (await prima.top_record()) is old, "stale: answered at once with the one known"
    await asyncio.wait_for(asked.wait(), 5)
    assert (await prima.top_record()) is old, "one renewal at a time, the known one meanwhile"
    release.set()
    await asyncio.wait_for(asyncio.gather(*prima._TOP_RENEWING), 5)
    assert (await prima.top_record()).name == "Fauzan Renewed"

    # Prima had no top record: nothing to answer with, so the call waits for the list, as before.
    release.set()
    staff[:] = [CEO]
    prima._TOP[settings.prima_url] = (time.monotonic() - prima.TOP_TTL - 1, None)
    assert (await prima.top_record()).id == "u-ceo"
