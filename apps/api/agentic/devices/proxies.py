"""P60: the company's own outbound proxies (e.g. a Webshare list) as a third way out for the
agents' browsers, beside this server and a company computer (devices/tunnel.py).

The list is pasted on Settings > Web connections, one per line, `host:port:user:password` (the
way Webshare lists them) or `http://user:password@host:port`, and kept encrypted in the
workspace's settings; the passwords never come back to the page. A site keeps one proxy (sticky
per workspace and site), so it sees one steady address rather than a new one per page; a proxy
that cannot be reached is set aside for a while and the next one is used. Switching happens only
when a proxy itself is down, never because a site refused or blocked a request.

Settings ("web_proxy"): {on, sites (["*"] = every site not sent elsewhere), list_enc}.
"""

import asyncio
import base64
import contextlib
import json
import re
import time
import zlib
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote, urlparse

from ..core import crypto
from ..core.valkey import valkey
from ..models import Workspace
from . import core

SETTINGS_KEY = "web_proxy"
MAX_PROXIES = 100
CONNECT_TIMEOUT = 10.0
BAD_FOR = 600  # seconds a proxy that could not be reached is set aside
TRIES = 3  # proxies tried for one connection before giving up
_LINE = re.compile(r"^([A-Za-z0-9.-]+):(\d{1,5}):([^:\s]+):(\S+)$")


@dataclass(frozen=True)
class Proxy:
    host: str
    port: int
    user: str
    password: str

    @property
    def key(self) -> str:
        return f"{self.host}:{self.port}"

    def url(self) -> str:
        return f"http://{self.user}:{self.password}@{self.host}:{self.port}"


class ProxyListError(ValueError):
    pass


def parse(text: str) -> list[Proxy]:
    """The pasted list: `host:port:user:password` lines or proxy URLs; blank lines and #
    comments skipped. Raises ProxyListError naming the first line it cannot read."""
    out: list[Proxy] = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "://" in line:
            u = urlparse(line)
            if u.scheme not in ("http", "https") or not u.hostname or not u.port:
                raise ProxyListError(f"Line {n} is not a proxy address.")
            p = Proxy(u.hostname, u.port, unquote(u.username or ""), unquote(u.password or ""))
        else:
            m = _LINE.match(line)
            if m is None:
                raise ProxyListError(f"Line {n} is not host:port:user:password.")
            p = Proxy(m[1], int(m[2]), m[3], m[4])
        if not 0 < p.port < 65536:
            raise ProxyListError(f"Line {n} has a wrong port.")
        if p.key not in {x.key for x in out}:
            out.append(p)
    if len(out) > MAX_PROXIES:
        raise ProxyListError(f"At most {MAX_PROXIES} proxies.")
    return out


def _aad(workspace_id: str) -> str:
    return f"web_proxy:{workspace_id}"


@dataclass(frozen=True)
class Setting:
    on: bool
    sites: list[str]  # ["*"] = every site not sent elsewhere
    proxies: list[Proxy]

    def covers(self, host: str) -> bool:
        return (
            self.on and bool(self.proxies) and ("*" in self.sites or core.host_in(host, self.sites))
        )


def setting(ws: Workspace | None) -> Setting:
    raw = ((ws.settings if ws else None) or {}).get(SETTINGS_KEY) or {}
    proxies: list[Proxy] = []
    if ws is not None and raw.get("list_enc"):
        with contextlib.suppress(Exception):  # an unreadable list counts as none
            proxies = [Proxy(**p) for p in json.loads(crypto.decrypt(raw["list_enc"], _aad(ws.id)))]
    sites = ["*"] if raw.get("sites") in (None, ["*"], "*") else core.tunnel_hosts(raw["sites"])
    return Setting(bool(raw.get("on")), sites or ["*"], proxies)


def save(ws: Workspace, on: bool, sites: list[str], proxies: list[Proxy] | None) -> None:
    """Store the setting; `proxies` None keeps the saved list."""
    raw = dict((ws.settings or {}).get(SETTINGS_KEY) or {})
    raw["on"] = on
    raw["sites"] = ["*"] if not sites or "*" in sites else core.tunnel_hosts(sites)
    if proxies is not None:
        raw["list_enc"] = crypto.encrypt(json.dumps([p.__dict__ for p in proxies]), _aad(ws.id))
    ws.settings = {**(ws.settings or {}), SETTINGS_KEY: raw}


def public(ws: Workspace | None) -> dict[str, Any]:
    st = setting(ws)
    return {
        "on": st.on,
        "sites": st.sites,
        "proxies": [
            {"key": p.key, "host": p.host, "port": p.port, "user": p.user[:2] + "…"}
            for p in st.proxies
        ],
    }


# ---------------------------------------------------------------- choosing and connecting


async def _bad(workspace_id: str) -> set[str]:
    try:
        keys = await valkey().smembers(f"proxy:bad:{workspace_id}")
    except Exception:  # noqa: BLE001 - no cache: none set aside
        return set()
    now = time.time()
    out = set()
    for k in keys:
        key, _, until = (k.decode() if isinstance(k, bytes) else str(k)).rpartition("@")
        if until and float(until) > now:
            out.add(key)
    return out


async def set_aside(workspace_id: str, p: Proxy) -> None:
    with contextlib.suppress(Exception):
        await valkey().sadd(f"proxy:bad:{workspace_id}", f"{p.key}@{time.time() + BAD_FOR}")
        await valkey().expire(f"proxy:bad:{workspace_id}", BAD_FOR * 2)


async def order(workspace_id: str, site: str, proxies: list[Proxy]) -> list[Proxy]:
    """The proxies to try for a site: its own (sticky) first, then the rest; those set aside
    as unreachable last."""
    if not proxies:
        return []
    key = f"proxy:pick:{workspace_id}:{site}"
    start = 0
    with contextlib.suppress(Exception):
        raw = await valkey().get(key)
        if raw is None:
            start = zlib.crc32(site.encode()) % len(proxies)  # the same on every restart
            await valkey().set(key, str(start), ex=7 * 86400)
        else:
            start = int(raw) % len(proxies)
    ring = proxies[start:] + proxies[:start]
    bad = await _bad(workspace_id)
    return [p for p in ring if p.key not in bad] + [p for p in ring if p.key in bad]


async def remember(workspace_id: str, site: str, proxies: list[Proxy], p: Proxy) -> None:
    """The proxy that worked becomes the site's own (after the previous one was down)."""
    with contextlib.suppress(Exception, ValueError):
        await valkey().set(f"proxy:pick:{workspace_id}:{site}", str(proxies.index(p)), ex=7 * 86400)


async def open_via(
    p: Proxy, host: str, port: int
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """A CONNECT through the proxy to host:port. Raises OSError when it fails."""
    r, w = await asyncio.wait_for(asyncio.open_connection(p.host, p.port), CONNECT_TIMEOUT)
    auth = base64.b64encode(f"{p.user}:{p.password}".encode()).decode()
    w.write(
        (
            f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n"
            f"Proxy-Authorization: Basic {auth}\r\n\r\n"
        ).encode()
    )
    await w.drain()
    try:
        head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), CONNECT_TIMEOUT)
    except Exception as e:  # noqa: BLE001 - closed, timeout
        w.close()
        raise OSError("the proxy did not answer") from e
    parts = head.split(b"\r\n", 1)[0].split(b" ")
    if len(parts) < 2 or not parts[1].startswith(b"2"):
        w.close()
        code = parts[1].decode() if len(parts) > 1 else "?"
        raise OSError(f"the proxy answered {code}")
    return r, w


async def test(p: Proxy) -> dict[str, Any]:
    """Reach a what-is-my-address page through the proxy: its address, how long it took."""
    import httpx

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(proxy=p.url(), timeout=15) as c:
            r = await c.get("https://ipv4.webshare.io/")
        ip = r.text.strip()[:60]
        ok = r.status_code == 200 and bool(ip)
        return {"key": p.key, "ok": ok, "ip": ip if ok else "", "ms": _ms(t0), "error": ""}
    except Exception as e:  # noqa: BLE001 - shown on the page
        return {"key": p.key, "ok": False, "ip": "", "ms": _ms(t0), "error": type(e).__name__}


def _ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)
