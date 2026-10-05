"""Egress proxy: the only way out of the browser's network.

The browser container sits on an internal Docker network (no route out). Firefox is set to
send every request here: https as CONNECT host:443, plain http as an absolute-form request.
For each connection this proxy resolves the host, refuses it when ANY address it resolves to
is not globally routable (loopback, RFC 1918, link-local / cloud metadata, CGNAT, ULA,
IPv4-mapped forms of those, ...), and then connects to the exact address it checked. There
is no second DNS lookup, so a name that answers public for the check and private for the
connection (DNS rebinding) still lands on the public address. A redirect chain is no way
around it either: every hop is a new request through here.

The address rules mirror apps/api/agentic/core/ssrf.py (`_public`), plus legacy numeric
IPv4 forms (2130706433, 0x7f.1, 0177.0.0.1), trailing dots, and IPv6 transition ranges
whose embedded IPv4 address is checked too.

Settings (environment):
  EGRESS_LISTEN           host:port to listen on (default 0.0.0.0:3128)
  EGRESS_ALLOW_PORTS      ports any public host may use (default 80,443)
  EGRESS_ALLOW_HOSTS      host names allowed although private, e.g. the dev practice portal:
                          `practice-portal` (any port) or `practice-portal:8080` (that port)
  EGRESS_MAX_CONNECTIONS  connections at once (default 512); more get 503
  EGRESS_CONNECT_TIMEOUT  seconds to connect upstream (default 10)
  EGRESS_DNS_TIMEOUT      seconds to resolve (default 5)
  EGRESS_IDLE_TIMEOUT     seconds a connection may stay silent both ways (default 300)
  EGRESS_LOG_ALLOWED      true = log allowed connections too (default false)

Logs are JSON lines on stdout: host, port, resolved ip and the reason. Never a path, a
query string, a header value or a body.

Standard library only (Python 3.12+).
"""

import asyncio
import ipaddress
import json
import os
import re
import signal
import socket
import sys
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field

CHUNK = 32 * 1024
HEAD_LIMIT = 32 * 1024  # request / response head, bytes
HEAD_TIMEOUT = 15.0
RESPONSE_TIMEOUT = 60.0
MAX_CONNECT_TRIES = 4

Resolver = Callable[[str, int], Awaitable[list[str]]]


# ---------------------------------------------------------------- address rules


class Denied(Exception):
    """A request the policy refuses (status 403), or one that cannot be served (502/504)."""

    def __init__(self, reason: str, status: int = 403, ip: str | None = None) -> None:
        super().__init__(reason)
        self.reason, self.status, self.ip = reason, status, ip
        self.host: str | None = None  # the canonical host, once it is known


_NAT64 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))
_V4_COMPAT = ipaddress.ip_network("::/96")  # deprecated IPv4-compatible (::a.b.c.d)


def public_ip(ip: str) -> bool:
    """Only globally routable unicast addresses (the api's ssrf._public, stricter for IPv6).

    is_global also rules out shared/CGNAT (100.64.0.0/10), documentation, benchmarking and
    reserved ranges. IPv6 forms that carry an IPv4 address are judged by that address.
    """
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.scope_id:
            return False
        if addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        elif addr.teredo:
            return False
        elif addr.sixtofour:
            if not (addr.is_global and _public_v4(addr.sixtofour)):
                return False
        elif any(addr in n for n in _NAT64):
            addr = ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
        elif addr in _V4_COMPAT:
            return False
    return addr.is_global and not addr.is_multicast


def _public_v4(addr: ipaddress.IPv4Address) -> bool:
    return addr.is_global and not addr.is_multicast


_NUM = re.compile(r"^(0[xX][0-9a-fA-F]*|0[0-7]*|[1-9][0-9]*)$")
_NUMERICISH = re.compile(r"^(0[xX][0-9a-fA-F]*|[0-9]+)$")
_LABEL = re.compile(r"^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$")


def legacy_ipv4(host: str) -> ipaddress.IPv4Address | None:
    """The address inet_aton would read from `host` (127.1, 2130706433, 0x7f.0.0.1,
    0177.0.0.1), or None when it is not a numeric form. A numeric form that overflows is
    refused, never passed on as a name."""
    parts = host.split(".")
    if not 1 <= len(parts) <= 4 or not all(_NUM.match(p) for p in parts):
        return None
    vals = []
    for p in parts:
        if p[:2].lower() == "0x":
            vals.append(int(p[2:] or "0", 16))
        elif len(p) > 1 and p[0] == "0":
            vals.append(int(p, 8))
        else:
            vals.append(int(p))
    *head, last = vals
    if any(v > 255 for v in head) or last >= 256 ** (4 - len(head)):
        raise Denied("malformed numeric address")
    n = 0
    for v in head:
        n = (n << 8) | v
    n = (n << (8 * (4 - len(head)))) | last
    return ipaddress.IPv4Address(n)


def normalize_host(raw: str) -> tuple[str, str | None]:
    """(canonical host, IP literal or None). Lower case, trailing dots dropped; anything that
    is not a plain DNS name or an IP literal is refused."""
    h = raw.strip().lower()
    if h.startswith("[") or h.endswith("]"):
        if not (h.startswith("[") and h.endswith("]")):
            raise Denied("malformed host")
        inner = h[1:-1]
        if "%" in inner:
            raise Denied("scoped IPv6 address")
        try:
            v6 = ipaddress.IPv6Address(inner)
        except ValueError as e:
            raise Denied("malformed IPv6 address") from e
        return str(v6), str(v6)
    h = h.rstrip(".")
    if not h or len(h) > 253:
        raise Denied("malformed host")
    if ":" in h:  # an unbracketed IPv6 address
        if "%" in h:
            raise Denied("scoped IPv6 address")
        try:
            return str(ipaddress.IPv6Address(h)), str(ipaddress.IPv6Address(h))
        except ValueError as e:
            raise Denied("malformed host") from e
    v4 = legacy_ipv4(h)
    if v4 is not None:
        return str(v4), str(v4)
    labels = h.split(".")
    if not all(_LABEL.match(x) for x in labels):
        raise Denied("malformed host")
    if _NUMERICISH.match(labels[-1]):  # no real top-level domain is a number
        raise Denied("malformed numeric address")
    return h, None


def split_authority(auth: str, default_port: int | None) -> tuple[str, int]:
    """host[:port] or [v6][:port] -> (raw host, port)."""
    if not auth or "@" in auth or any(c in auth for c in " \t/\\?#"):
        raise Denied("malformed authority", status=400)
    if auth.startswith("["):
        end = auth.find("]")
        if end < 0:
            raise Denied("malformed authority", status=400)
        host, rest = auth[: end + 1], auth[end + 1 :]
        if rest and not rest.startswith(":"):
            raise Denied("malformed authority", status=400)
        port_s = rest[1:] if rest else ""
    else:
        if auth.count(":") > 1:
            raise Denied("malformed authority", status=400)
        host, colon, port_s = auth.partition(":")
        if colon and not port_s:
            raise Denied("malformed authority", status=400)
    if port_s:
        if not port_s.isdigit() or len(port_s) > 5:
            raise Denied("malformed port", status=400)
        port = int(port_s)
    elif default_port is not None:
        port = default_port
    else:
        raise Denied("missing port", status=400)
    if not 1 <= port <= 65535:
        raise Denied("malformed port", status=400)
    return host, port


@dataclass(frozen=True)
class Policy:
    allow_ports: frozenset[int] = frozenset({80, 443})
    # host -> None (any port) or the ports it may use; these hosts may be private
    allow_hosts: Mapping[str, frozenset[int] | None] = field(default_factory=dict)

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Policy":
        ports = frozenset(
            int(p) for p in env.get("EGRESS_ALLOW_PORTS", "80,443").replace(" ", "").split(",") if p
        )
        hosts: dict[str, frozenset[int] | None] = {}
        for item in env.get("EGRESS_ALLOW_HOSTS", "").split(","):
            item = item.strip().lower()
            if not item:
                continue
            name, _, port = item.rpartition(":") if ":" in item else (item, "", "")
            name = name.rstrip(".")
            if port:
                prev = hosts.get(name, frozenset())
                if prev is not None:
                    hosts[name] = prev | {int(port)}
            else:
                hosts[name] = None
        return cls(allow_ports=ports, allow_hosts=hosts)

    def host_allowed(self, host: str, port: int) -> bool:
        """An allow-listed host on one of its ports: private addresses are fine there."""
        if host not in self.allow_hosts:
            return False
        ports = self.allow_hosts[host]
        return ports is None or port in ports


async def system_resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
    )
    return [str(i[4][0]) for i in infos]


def _order(ips: list[str]) -> list[str]:
    """Unique, IPv4 first (Docker networks are IPv4 by default; v6 would only time out)."""
    seen = list(dict.fromkeys(ips))
    return [i for i in seen if ":" not in i] + [i for i in seen if ":" in i]


async def decide(
    raw_host: str, port: int, policy: Policy, resolver: Resolver, dns_timeout: float = 5.0
) -> tuple[str, list[str]]:
    """(canonical host, the vetted addresses to connect to), or raise Denied."""
    host, literal = normalize_host(raw_host)
    try:
        return await _decide(host, literal, port, policy, resolver, dns_timeout)
    except Denied as d:
        d.host = host
        raise


async def _decide(
    host: str,
    literal: str | None,
    port: int,
    policy: Policy,
    resolver: Resolver,
    dns_timeout: float,
) -> tuple[str, list[str]]:
    trusted = policy.host_allowed(host, port)
    if not trusted and port not in policy.allow_ports:
        raise Denied(f"port {port} not allowed")
    if literal is not None:
        if not trusted and not public_ip(literal):
            raise Denied("non-public address", ip=literal)
        return host, [literal]
    if not trusted and (host == "localhost" or host.endswith(".localhost")):
        raise Denied("localhost")
    try:
        ips = await asyncio.wait_for(resolver(host, port), dns_timeout)
    except TimeoutError as e:
        raise Denied("dns timeout", status=504) from e
    except OSError as e:
        raise Denied("dns lookup failed", status=502) from e
    if not ips:
        raise Denied("dns lookup failed", status=502)
    for ip in ips:
        try:
            ok = trusted or public_ip(ip)
        except ValueError:
            ok = False
        if not ok:
            raise Denied("resolves to a non-public address", ip=ip)
    return host, _order(ips)


# ---------------------------------------------------------------- the proxy


Opener = Callable[[str, int], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]]


async def _open(ip: str, port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    return await asyncio.open_connection(ip, port, limit=HEAD_LIMIT * 2)


_HOP = {
    "connection",
    "proxy-connection",
    "keep-alive",
    "proxy-authorization",
    "proxy-authenticate",
    "upgrade",
    "te",
    "trailer",
}

_REASONS = {
    200: "OK",
    400: "Bad Request",
    403: "Forbidden",
    405: "Method Not Allowed",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
}


def _parse_head(raw: bytes) -> tuple[str, list[tuple[str, str]]]:
    text = raw.decode("latin-1")
    lines = text.split("\r\n")
    first = lines[0]
    headers = []
    for line in lines[1:]:
        if not line:
            continue
        if line[0] in " \t" or ":" not in line:  # obsolete folding / junk: refuse
            raise Denied("malformed header", status=400)
        name, _, value = line.partition(":")
        if not name or name != name.strip():
            raise Denied("malformed header", status=400)
        headers.append((name, value.strip()))
    return first, headers


class Proxy:
    def __init__(
        self,
        policy: Policy,
        *,
        resolver: Resolver = system_resolve,
        opener: Opener = _open,
        max_connections: int = 512,
        connect_timeout: float = 10.0,
        dns_timeout: float = 5.0,
        idle_timeout: float = 300.0,
        log_allowed: bool = False,
        out=None,
    ) -> None:
        self.policy, self.resolver, self.opener = policy, resolver, opener
        self.max_connections = max_connections
        self.connect_timeout, self.dns_timeout, self.idle_timeout = (
            connect_timeout,
            dns_timeout,
            idle_timeout,
        )
        self.log_allowed = log_allowed
        self.out = out or sys.stdout
        self.active = 0
        self.stats = {"allowed": 0, "denied": 0, "errors": 0, "busy": 0}

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Proxy":
        return cls(
            Policy.from_env(env),
            max_connections=int(env.get("EGRESS_MAX_CONNECTIONS", "512")),
            connect_timeout=float(env.get("EGRESS_CONNECT_TIMEOUT", "10")),
            dns_timeout=float(env.get("EGRESS_DNS_TIMEOUT", "5")),
            idle_timeout=float(env.get("EGRESS_IDLE_TIMEOUT", "300")),
            log_allowed=env.get("EGRESS_LOG_ALLOWED", "false").lower() in ("1", "true", "yes"),
        )

    # -------------------------------------------------------- logging

    def log(self, event: str, **kw: object) -> None:
        rec = {"ts": round(time.time(), 3), "event": event, **kw}
        try:
            self.out.write(json.dumps(rec, separators=(",", ":")) + "\n")
            self.out.flush()
        except Exception:  # noqa: BLE001,S110 - logging must never break a connection
            pass

    # -------------------------------------------------------- helpers

    @staticmethod
    async def _reply(w: asyncio.StreamWriter, status: int, msg: str = "") -> None:
        body = (msg or _REASONS.get(status, "")).encode() + b"\n"
        head = (
            f"HTTP/1.1 {status} {_REASONS.get(status, 'Error')}\r\n"
            "Content-Type: text/plain; charset=utf-8\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n\r\n"
        ).encode()
        try:
            w.write(head + body)
            await w.drain()
        except (ConnectionError, OSError):
            pass

    @staticmethod
    async def _close(w: asyncio.StreamWriter | None) -> None:
        if w is None:
            return
        try:
            w.close()
            await asyncio.wait_for(w.wait_closed(), 2)
        except Exception:  # noqa: BLE001,S110 - already gone
            pass

    async def _connect(self, ips: list[str], port: int):
        last: Exception | None = None
        for ip in ips[:MAX_CONNECT_TRIES]:
            try:
                r, w = await asyncio.wait_for(self.opener(ip, port), self.connect_timeout)
                return r, w, ip
            except TimeoutError as e:
                last = e
            except OSError as e:
                last = e
        if isinstance(last, TimeoutError):
            raise Denied("connect timeout", status=504, ip=ips[0] if ips else None)
        raise Denied("connect failed", status=502, ip=ips[0] if ips else None)

    async def _pipe(
        self, src: asyncio.StreamReader, dst: asyncio.StreamWriter, act: list[float]
    ) -> None:
        try:
            while True:
                try:
                    data = await asyncio.wait_for(src.read(CHUNK), self.idle_timeout)
                except TimeoutError:
                    if time.monotonic() - act[0] < self.idle_timeout:
                        continue  # the other direction is busy (a download, a websocket)
                    break
                if not data:
                    break
                act[0] = time.monotonic()
                dst.write(data)
                await dst.drain()
        except (ConnectionError, OSError, asyncio.IncompleteReadError):
            pass
        finally:
            try:
                if dst.can_write_eof():
                    dst.write_eof()
            except (ConnectionError, OSError, RuntimeError):
                pass

    async def _splice(self, cr, cw, ur, uw) -> None:
        act = [time.monotonic()]
        await asyncio.gather(self._pipe(cr, uw, act), self._pipe(ur, cw, act))

    # -------------------------------------------------------- entry point

    async def handle(self, cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
        peer = cw.get_extra_info("peername")
        client = peer[0] if isinstance(peer, tuple) else "?"
        if self.active >= self.max_connections:
            self.stats["busy"] += 1
            self.log("busy", client=client, active=self.active)
            try:  # read the head first: closing on unread data would reset the reply away
                await asyncio.wait_for(cr.readuntil(b"\r\n\r\n"), 1)
            except Exception:  # noqa: BLE001,S110 - answer anyway
                pass
            await self._reply(cw, 503, "egress proxy busy")
            await self._close(cw)
            return
        self.active += 1
        uw: asyncio.StreamWriter | None = None
        method, host, port = "?", "?", 0
        try:
            try:
                raw = await asyncio.wait_for(cr.readuntil(b"\r\n\r\n"), HEAD_TIMEOUT)
            except (
                asyncio.IncompleteReadError,
                asyncio.LimitOverrunError,
                TimeoutError,
                ConnectionError,
                OSError,
            ):
                return
            first, headers = _parse_head(raw[:-4])
            parts = first.split(" ")
            if len(parts) != 3 or not parts[2].startswith("HTTP/1."):
                raise Denied("malformed request line", status=400)
            method, target, _version = parts
            if method == "CONNECT":
                host, port = split_authority(target, None)
                host, ips = await decide(host, port, self.policy, self.resolver, self.dns_timeout)
                ur, uw, ip = await self._connect(ips, port)
                self._allowed(client, method, host, port, ip)
                cw.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await cw.drain()
                await self._splice(cr, cw, ur, uw)
            elif target.lower().startswith("http://"):
                await self._forward(cr, cw, client, method, target, headers)
            elif method == "GET" and target == "/healthz":
                body = json.dumps({"ok": True, "active": self.active - 1, **self.stats})
                await self._reply(cw, 200, body)
            elif target.lower().startswith(("https://", "ws://", "wss://", "ftp://")):
                raise Denied("use CONNECT for this scheme", status=400)
            else:
                raise Denied("not a proxy request", status=400)
        except Denied as d:
            host = d.host or host
            if d.status == 403:
                self.stats["denied"] += 1
                self.log(
                    "deny",
                    client=client,
                    method=method,
                    host=str(host)[:253],
                    port=port,
                    ip=d.ip,
                    reason=d.reason,
                )
            else:
                self.stats["errors"] += 1
                self.log(
                    "error",
                    client=client,
                    method=method,
                    host=str(host)[:253],
                    port=port,
                    ip=d.ip,
                    reason=d.reason,
                    status=d.status,
                )
            await self._reply(cw, d.status, f"egress proxy: {d.reason}")
        except (ConnectionError, OSError, asyncio.IncompleteReadError):
            pass
        except Exception as e:  # noqa: BLE001 - one bad connection never stops the proxy
            self.stats["errors"] += 1
            self.log(
                "error",
                client=client,
                method=method,
                host=str(host)[:253],
                port=port,
                reason=type(e).__name__,
            )
        finally:
            self.active -= 1
            await self._close(uw)
            await self._close(cw)

    def _allowed(self, client: str, method: str, host: str, port: int, ip: str) -> None:
        self.stats["allowed"] += 1
        if self.log_allowed:
            self.log("allow", client=client, method=method, host=host, port=port, ip=ip)

    async def _forward(self, cr, cw, client, method, target, headers) -> None:
        """A plain http request: one request per connection, the upstream told to close."""
        rest = target[len("http://") :]
        cut = min(
            (i for i in (rest.find("/"), rest.find("?"), rest.find("#")) if i >= 0),
            default=len(rest),
        )
        authority, path = rest[:cut], rest[cut:].split("#", 1)[0]
        if not path.startswith("/"):
            path = "/" + path
        host, port = split_authority(authority, 80)
        if not re.fullmatch(r"[A-Z]{3,10}", method) or method == "CONNECT":
            raise Denied("method not allowed", status=405)
        host, ips = await decide(host, port, self.policy, self.resolver, self.dns_timeout)
        names = {n.lower() for n, _ in headers}
        conn_tokens = {
            t.strip().lower()
            for n, v in headers
            if n.lower() in ("connection", "proxy-connection")
            for t in v.split(",")
        }
        upgrade = "upgrade" in conn_tokens and "upgrade" in names
        out = [f"{method} {path} HTTP/1.1", f"Host: {authority}"]
        for n, v in headers:
            low = n.lower()
            if (
                low == "host"
                or low in conn_tokens
                or (low in _HOP and not (upgrade and low == "upgrade"))
            ):
                continue
            out.append(f"{n}: {v}")
        out.append("Connection: Upgrade" if upgrade else "Connection: close")
        ur, uw, ip = await self._connect(ips, port)
        self._allowed(client, method, host, port, ip)
        act = [time.monotonic()]
        body: asyncio.Task | None = None
        try:
            uw.write(("\r\n".join(out) + "\r\n\r\n").encode("latin-1"))
            await uw.drain()
            body = asyncio.create_task(self._pipe(cr, uw, act))  # the request body, if any
            while True:
                try:
                    raw = await asyncio.wait_for(ur.readuntil(b"\r\n\r\n"), RESPONSE_TIMEOUT)
                except TimeoutError as e:
                    raise Denied("upstream response timeout", status=504, ip=ip) from e
                except (asyncio.IncompleteReadError, asyncio.LimitOverrunError) as e:
                    raise Denied("bad upstream response", status=502, ip=ip) from e
                status_line, rh = _parse_head(raw[:-4])
                bits = status_line.split(" ", 2)
                code = int(bits[1]) if len(bits) > 1 and bits[1].isdigit() else 0
                if 100 <= code < 200 and code != 101:  # 100 Continue: pass on, read on
                    cw.write(raw)
                    await cw.drain()
                    continue
                break
            if code == 101 and upgrade:
                cw.write(raw)
                await cw.drain()
                await asyncio.gather(body, self._pipe(ur, cw, act))
                return
            keep = [
                f"{n}: {v}"
                for n, v in rh
                if n.lower() not in ("connection", "keep-alive", "proxy-connection")
            ]
            cw.write(
                ("\r\n".join([status_line, *keep, "Connection: close"]) + "\r\n\r\n").encode(
                    "latin-1"
                )
            )
            await cw.drain()
            # Until the upstream closes; a client that hung up gets a short grace, no more
            # (an upstream that ignores `Connection: close` must not pin the connection).
            down = asyncio.create_task(self._pipe(ur, cw, act))
            await asyncio.wait({down, body}, return_when=asyncio.FIRST_COMPLETED)
            if not down.done():
                await asyncio.wait({down}, timeout=5)
            down.cancel()
        finally:
            if body is not None:
                body.cancel()
            await self._close(uw)


# ---------------------------------------------------------------- main


def _listen_addr(env: Mapping[str, str]) -> tuple[str, int]:
    host, _, port = env.get("EGRESS_LISTEN", "0.0.0.0:3128").rpartition(":")  # noqa: S104
    return host or "0.0.0.0", int(port)  # noqa: S104 - a container port on a private network


async def serve(env: Mapping[str, str] = os.environ) -> None:
    proxy = Proxy.from_env(env)
    host, port = _listen_addr(env)
    server = await asyncio.start_server(proxy.handle, host, port, limit=HEAD_LIMIT * 2, backlog=256)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # Windows dev runs
            pass
    proxy.log(
        "start",
        listen=f"{host}:{port}",
        allow_ports=sorted(proxy.policy.allow_ports),
        allow_hosts=sorted(proxy.policy.allow_hosts),
        max_connections=proxy.max_connections,
    )
    async with server:
        await stop.wait()
    proxy.log("stop", **proxy.stats)


def health(env: Mapping[str, str] = os.environ) -> int:
    _, port = _listen_addr(env)
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=3) as s:
            s.sendall(b"GET /healthz HTTP/1.1\r\nHost: egress\r\n\r\n")
            return 0 if s.recv(64).startswith(b"HTTP/1.1 200") else 1
    except OSError:
        return 1


if __name__ == "__main__":
    if "--health" in sys.argv:
        sys.exit(health())
    asyncio.run(serve())
