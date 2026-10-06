"""The egress proxy (apps/egress/egress.py): address rules, allow-list, ports, and real
CONNECT / plain-http handling against a local test server.

No network and no Docker: names resolve through a fake resolver, and every upstream
connection is handed to a local server, recording which vetted address the proxy chose.

Run:  cd apps/api && uv run pytest ../egress/tests -q
"""

import asyncio
import importlib.util
import io
import ipaddress
import json
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "egress.py"
_spec = importlib.util.spec_from_file_location("egress_proxy", SRC)
assert _spec and _spec.loader
eg = importlib.util.module_from_spec(_spec)
sys.modules["egress_proxy"] = eg
_spec.loader.exec_module(eg)


# ---------------------------------------------------------------- address rules

PRIVATE = [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",  # cloud metadata
    "100.64.0.1",  # CGNAT / Tailscale
    "100.127.255.254",
    "0.0.0.0",  # noqa: S104
    "255.255.255.255",
    "224.0.0.1",  # multicast
    "192.0.2.1",  # documentation
    "198.18.0.1",  # benchmarking
    "240.0.0.1",  # reserved
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",  # IPv4-mapped
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::7f00:1",  # IPv4-compatible ::127.0.0.1
    "64:ff9b::a00:1",  # NAT64 of 10.0.0.1
    "64:ff9b::a9fe:a9fe",  # NAT64 of 169.254.169.254
    "2002:a00:1::1",  # 6to4 of 10.0.0.1
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",  # Teredo
    "2001:db8::1",  # documentation
]
PUBLIC = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.215.14",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
]


@pytest.mark.parametrize("ip", PRIVATE)
def test_private_addresses_are_refused(ip):
    assert eg.public_ip(ip) is False


@pytest.mark.parametrize("ip", PUBLIC)
def test_public_addresses_pass(ip):
    assert eg.public_ip(ip) is True


@pytest.mark.parametrize(
    ("raw", "ip"),
    [
        ("2130706433", "127.0.0.1"),  # decimal
        ("0x7f000001", "127.0.0.1"),  # hex
        ("0X7F.0.0.1", "127.0.0.1"),
        ("0177.0.0.1", "127.0.0.1"),  # octal
        ("127.1", "127.0.0.1"),  # short form
        ("0x7f.1", "127.0.0.1"),
        ("10.1", "10.0.0.1"),
        ("0251.0376.0251.0376", "169.254.169.254"),
        ("0xa9fea9fe", "169.254.169.254"),
        ("169.254.169.254.", "169.254.169.254"),  # trailing dot
        ("0", "0.0.0.0"),  # noqa: S104
        ("[::1]", "::1"),
        ("[::ffff:127.0.0.1]", "::ffff:7f00:1"),
        ("[0:0:0:0:0:ffff:7f00:1]", "::ffff:7f00:1"),
    ],
)
def test_numeric_forms_are_read_as_addresses(raw, ip):
    host, literal = eg.normalize_host(raw)
    assert literal is not None and host == literal
    assert ipaddress.ip_address(literal) == ipaddress.ip_address(ip)
    assert eg.public_ip(literal) is False


@pytest.mark.parametrize(
    "raw",
    [
        "999.1.1.1",  # overflow
        "1.2.3.4.5",  # numeric last label
        "0x1ffffffff",
        "1.2.3.08",  # 08 is not octal: still numeric, refused
        "%31%32%37.0.0.1",
        "exa mple.com",
        "a..b",
        "[fe80::1%25eth0]",
        "[fe80::1%eth0]",
        "[::1",
        "-bad.example",
        "",
        ".",
        "x" * 300,
    ],
)
def test_malformed_hosts_are_refused(raw):
    with pytest.raises(eg.Denied):
        eg.normalize_host(raw)


def test_names_are_normalised():
    assert eg.normalize_host("Example.COM.") == ("example.com", None)
    assert eg.normalize_host("LOCALHOST..") == ("localhost", None)
    assert eg.normalize_host("1e100.net") == ("1e100.net", None)
    assert eg.normalize_host("_dmarc.example.org") == ("_dmarc.example.org", None)


@pytest.mark.parametrize(
    ("auth", "default", "want"),
    [
        ("example.com:443", None, ("example.com", 443)),
        ("[::1]:443", None, ("[::1]", 443)),
        ("example.com", 80, ("example.com", 80)),
        ("[2606:4700::1]", 80, ("[2606:4700::1]", 80)),
    ],
)
def test_authority(auth, default, want):
    assert eg.split_authority(auth, default) == want


@pytest.mark.parametrize(
    "auth",
    [
        "example.com",
        "user@example.com:443",
        "example.com:",
        "example.com:99999",
        "::1:443",
        "a.com:44a",
        "[::1]x",
    ],
)
def test_bad_authority(auth):
    with pytest.raises(eg.Denied):
        eg.split_authority(auth, None)


def test_policy_from_env():
    p = eg.Policy.from_env(
        {
            "EGRESS_ALLOW_PORTS": "80, 443,8443",
            "EGRESS_ALLOW_HOSTS": "Practice-Portal., api.lan:8080,api.lan:9000",
        }
    )
    assert p.allow_ports == {80, 443, 8443}
    assert p.host_allowed("practice-portal", 8080)
    assert p.host_allowed("practice-portal", 1)
    assert p.host_allowed("api.lan", 8080) and p.host_allowed("api.lan", 9000)
    assert not p.host_allowed("api.lan", 22)
    assert not p.host_allowed("other", 80)
    assert eg.Policy.from_env({}).allow_ports == {80, 443}
    assert dict(eg.Policy.from_env({}).allow_hosts) == {}


def fake_dns(table):
    calls = []

    async def resolve(host, port):
        calls.append(host)
        if host not in table:
            raise OSError("no such host")
        val = table[host]
        return list(val.pop(0) if val and isinstance(val[0], list) else val)

    resolve.calls = calls  # pyright: ignore[reportFunctionMemberAccess]
    return resolve


def decide(host, port, policy=None, table=None):
    return asyncio.run(eg.decide(host, port, policy or eg.Policy(), fake_dns(table or {})))


def test_decide_public_name():
    assert decide("example.com", 443, table={"example.com": ["93.184.215.14"]}) == (
        "example.com",
        ["93.184.215.14"],
    )


def test_decide_refuses_any_private_answer():
    with pytest.raises(eg.Denied) as e:
        decide("mixed.example", 443, table={"mixed.example": ["93.184.215.14", "10.0.0.5"]})
    assert e.value.status == 403 and e.value.ip == "10.0.0.5"


@pytest.mark.parametrize(
    "ip", ["127.0.0.1", "169.254.169.254", "172.18.0.4", "::1", "::ffff:10.0.0.1", "100.100.1.1"]
)
def test_decide_refuses_names_pointing_inside(ip):
    with pytest.raises(eg.Denied) as e:
        decide("evil.example", 80, table={"evil.example": [ip]})
    assert e.value.status == 403


@pytest.mark.parametrize(
    "host", ["10.0.0.1", "2130706433", "[::1]", "[::ffff:169.254.169.254]", "0x0a000001"]
)
def test_decide_refuses_private_literals(host):
    with pytest.raises(eg.Denied):
        decide(host, 80)


def test_decide_docker_service_names():
    table = {
        n: [f"172.20.0.{i}"] for i, n in enumerate(["postgres", "valkey", "api", "temporal"], 2)
    }
    for name in table:
        with pytest.raises(eg.Denied):
            decide(name, 443, table=dict(table))
    with pytest.raises(eg.Denied) as e:  # not on the proxy's networks: no answer at all
        decide("postgres", 443)
    assert e.value.status == 502


def test_decide_localhost_without_dns():
    for h in ("localhost", "LOCALHOST.", "foo.localhost"):
        with pytest.raises(eg.Denied) as e:
            decide(h, 80, table={})
        assert e.value.reason == "localhost"


def test_decide_ports():
    t = {"example.com": ["93.184.215.14"]}
    for port in (22, 25, 3128, 6379, 5432, 8080):
        with pytest.raises(eg.Denied) as e:
            decide("example.com", port, table=dict(t))
        assert "port" in e.value.reason
    assert decide("example.com", 8443, eg.Policy(allow_ports=frozenset({443, 8443})), dict(t))[1]


def test_decide_allow_list():
    t = {"practice-portal": ["172.18.0.9"]}
    p = eg.Policy.from_env({"EGRESS_ALLOW_HOSTS": "practice-portal"})
    assert decide("practice-portal", 8080, p, dict(t)) == ("practice-portal", ["172.18.0.9"])
    assert decide("Practice-Portal.", 8080, p, dict(t))[1] == ["172.18.0.9"]
    # a port-pinned entry only opens that port
    p2 = eg.Policy.from_env({"EGRESS_ALLOW_HOSTS": "practice-portal:8080"})
    assert decide("practice-portal", 8080, p2, dict(t))[1] == ["172.18.0.9"]
    with pytest.raises(eg.Denied):
        decide("practice-portal", 5432, p2, dict(t))
    with pytest.raises(eg.Denied):  # the allow-list names a host, not its neighbours
        decide(
            "practice-portal.evil.example", 8080, p, {"practice-portal.evil.example": ["10.0.0.1"]}
        )


def test_decide_orders_ipv4_first_and_dedupes():
    t = {"dual.example": ["2606:4700::1", "93.184.215.14", "93.184.215.14"]}
    assert decide("dual.example", 443, table=t)[1] == ["93.184.215.14", "2606:4700::1"]


def test_decide_dns_timeout():
    async def slow(host, port):
        await asyncio.sleep(5)
        return ["93.184.215.14"]

    with pytest.raises(eg.Denied) as e:
        asyncio.run(eg.decide("slow.example", 443, eg.Policy(), slow, dns_timeout=0.05))
    assert e.value.status == 504


# ---------------------------------------------------------------- the proxy, live


class Upstream:
    """A local server that stands in for every site: echo for tunnels, HTTP otherwise."""

    def __init__(self):
        self.requests: list[bytes] = []
        self.port = 0

    async def handle(self, r, w):
        data = await r.read(4096)
        self.requests.append(data)
        if data.startswith(b"PING"):  # a tunnel: echo until the client stops
            while data:
                w.write(b"PONG:" + data)
                await w.drain()
                data = await r.read(4096)
        elif data:
            head, _, body = data.partition(b"\r\n\r\n")
            want = 0
            for line in head.split(b"\r\n"):
                if line.lower().startswith(b"content-length:"):
                    want = int(line.split(b":")[1])
            while len(body) < want:
                body += await r.read(4096)
            out = b"hello " + body
            w.write(
                b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\n"
                b"Connection: keep-alive\r\nKeep-Alive: timeout=5\r\n\r\n%s" % (len(out), out)
            )
            await w.drain()
        w.close()


async def run_proxy(table, policy=None, **kw):
    up = Upstream()
    server = await asyncio.start_server(up.handle, "127.0.0.1", 0)
    up.port = server.sockets[0].getsockname()[1]
    opened: list[tuple[str, int]] = []

    async def opener(ip, port):
        opened.append((ip, port))
        return await asyncio.open_connection("127.0.0.1", up.port)

    log = io.StringIO()
    proxy = eg.Proxy(policy or eg.Policy(), resolver=fake_dns(table), opener=opener, out=log, **kw)
    pserver = await asyncio.start_server(proxy.handle, "127.0.0.1", 0)
    pport = pserver.sockets[0].getsockname()[1]
    return proxy, pport, up, opened, log, (server, pserver)


async def ask(pport, raw: bytes, then: bytes | None = None) -> bytes:
    r, w = await asyncio.open_connection("127.0.0.1", pport)
    w.write(raw)
    await w.drain()
    if then is not None:
        head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 5)
        w.write(then)
        await w.drain()
        rest = await asyncio.wait_for(r.read(4096), 5)
        w.close()
        return head + rest
    data = await asyncio.wait_for(r.read(), 5)
    w.close()
    return data


TABLE = {
    "public.test": ["93.184.215.14"],
    "inside.test": ["10.1.2.3"],
    "practice-portal": ["172.18.0.9"],
}


def live(coro_fn):
    def wrapper():
        async def main():
            stack = await run_proxy(dict(TABLE))
            try:
                await coro_fn(*stack[:5])
            finally:
                for s in stack[5]:
                    s.close()

        asyncio.run(main())

    wrapper.__name__ = coro_fn.__name__
    return wrapper


@live
async def test_connect_tunnels_to_the_vetted_ip(proxy, pport, up, opened, log):
    out = await ask(
        pport, b"CONNECT public.test:443 HTTP/1.1\r\nHost: public.test:443\r\n\r\n", b"PING 1"
    )
    assert out.startswith(b"HTTP/1.1 200 Connection Established\r\n\r\n")
    assert b"PONG:PING 1" in out
    assert opened == [("93.184.215.14", 443)]


@live
async def test_connect_inside_is_refused_before_connecting(proxy, pport, up, opened, log):
    for target in (
        b"inside.test:443",
        b"10.1.2.3:443",
        b"169.254.169.254:443",
        b"[::ffff:127.0.0.1]:443",
        b"2130706433:443",
        b"localhost:443",
        b"public.test:22",
        b"nowhere.test:443",
    ):
        out = await ask(pport, b"CONNECT " + target + b" HTTP/1.1\r\n\r\n")
        assert out.split(b"\r\n")[0] in (b"HTTP/1.1 403 Forbidden", b"HTTP/1.1 502 Bad Gateway"), (
            target
        )
    assert opened == [] and up.requests == []
    events = [json.loads(line) for line in log.getvalue().splitlines()]
    denies = [e for e in events if e["event"] == "deny"]
    assert {
        "host": "inside.test",
        "ip": "10.1.2.3",
        "reason": "resolves to a non-public address",
    }.items() <= denies[0].items()
    assert any(e["host"] == "127.0.0.1" for e in denies)  # 2130706433, read as the address


@live
async def test_plain_http_is_rewritten_and_closed(proxy, pport, up, opened, log):
    out = await ask(
        pport,
        b"GET http://public.test/path?q=secret-token HTTP/1.1\r\nHost: public.test\r\n"
        b"Proxy-Connection: keep-alive\r\nProxy-Authorization: Basic eA==\r\n"
        b"Connection: keep-alive, X-Drop\r\n"
        b"X-Drop: 1\r\nAccept: */*\r\n\r\n",
    )
    assert out.startswith(b"HTTP/1.1 200 OK\r\n")
    head = out.split(b"\r\n\r\n")[0].lower()
    assert b"connection: close" in head and b"keep-alive" not in head
    assert out.endswith(b"hello ")
    sent = up.requests[0]
    assert sent.startswith(b"GET /path?q=secret-token HTTP/1.1\r\nHost: public.test\r\n")
    low = sent.lower()
    assert (
        b"proxy-" not in low
        and b"x-drop" not in low
        and b"connection: close" in low
        and b"accept: */*" in low
    )
    assert opened == [("93.184.215.14", 80)]


@live
async def test_plain_http_host_header_cannot_retarget(proxy, pport, up, opened, log):
    await ask(pport, b"GET http://public.test/ HTTP/1.1\r\nHost: inside.test\r\n\r\n")
    assert b"Host: public.test\r\n" in up.requests[0] and b"inside.test" not in up.requests[0]


@live
async def test_plain_http_post_body(proxy, pport, up, opened, log):
    out = await ask(
        pport,
        b"POST http://public.test/form HTTP/1.1\r\nHost: public.test\r\n"
        b"Content-Length: 5\r\n\r\nabcde",
    )
    assert out.endswith(b"hello abcde")


@live
async def test_plain_http_inside_is_refused(proxy, pport, up, opened, log):
    for url in (
        b"http://inside.test/",
        b"http://10.1.2.3/",
        b"http://169.254.169.254/latest/meta-data/?token=abc",
        b"http://[::1]/",
        b"http://0x7f.1/",
        b"http://public.test:6379/",
        b"http://postgres:5432/",
    ):
        out = await ask(pport, b"GET " + url + b" HTTP/1.1\r\nHost: x\r\n\r\n")
        assert out.split(b"\r\n")[0] in (b"HTTP/1.1 403 Forbidden", b"HTTP/1.1 502 Bad Gateway"), (
            url
        )
    assert opened == [] and up.requests == []
    assert (
        "token=abc" not in log.getvalue() and "meta-data" not in log.getvalue()
    )  # no paths in logs


@live
async def test_non_proxy_requests(proxy, pport, up, opened, log):
    assert (await ask(pport, b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")).startswith(b"HTTP/1.1 400")
    assert (await ask(pport, b"GET https://public.test/ HTTP/1.1\r\n\r\n")).startswith(
        b"HTTP/1.1 400"
    )
    assert (await ask(pport, b"GET http://user:pw@public.test/ HTTP/1.1\r\n\r\n")).startswith(
        b"HTTP/1.1 400"
    )
    assert (await ask(pport, b"garbage\r\n\r\n")).startswith(b"HTTP/1.1 400")
    health = await ask(pport, b"GET /healthz HTTP/1.1\r\nHost: egress\r\n\r\n")
    assert health.startswith(b"HTTP/1.1 200") and b'"ok": true' in health
    assert opened == []


def test_dns_rebinding_connects_to_the_checked_address():
    async def main():
        # First answer public, every later answer private: the proxy must ask only once.
        table = {"rebind.test": [["93.184.215.14"], ["127.0.0.1"], ["127.0.0.1"]]}
        proxy, pport, up, opened, log, servers = await run_proxy(table)
        try:
            out = await ask(pport, b"CONNECT rebind.test:443 HTTP/1.1\r\n\r\n", b"PING")
            assert out.startswith(b"HTTP/1.1 200")
            assert opened == [("93.184.215.14", 443)]
            assert proxy.resolver.calls == ["rebind.test"]
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_allow_listed_private_host_is_reached():
    async def main():
        policy = eg.Policy.from_env({"EGRESS_ALLOW_HOSTS": "practice-portal:8080"})
        proxy, pport, up, opened, log, servers = await run_proxy(dict(TABLE), policy)
        try:
            out = await ask(
                pport,
                b"GET http://practice-portal:8080/login HTTP/1.1\r\n"
                b"Host: practice-portal:8080\r\n\r\n",
            )
            assert out.startswith(b"HTTP/1.1 200")
            assert opened == [("172.18.0.9", 8080)]
            assert up.requests[0].startswith(
                b"GET /login HTTP/1.1\r\nHost: practice-portal:8080\r\n"
            )
            out = await ask(pport, b"GET http://practice-portal:5432/ HTTP/1.1\r\n\r\n")
            assert out.startswith(b"HTTP/1.1 403")
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_connection_cap():
    async def main():
        proxy, pport, up, opened, log, servers = await run_proxy(dict(TABLE), max_connections=1)
        try:
            r1, w1 = await asyncio.open_connection("127.0.0.1", pport)  # holds the only place
            await asyncio.sleep(0.05)
            out = await ask(pport, b"CONNECT public.test:443 HTTP/1.1\r\n\r\n")
            assert out.startswith(b"HTTP/1.1 503")
            w1.close()
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_slow_head_is_dropped(monkeypatch):
    monkeypatch.setattr(eg, "HEAD_TIMEOUT", 0.1)

    async def main():
        proxy, pport, up, opened, log, servers = await run_proxy(dict(TABLE))
        try:
            r, w = await asyncio.open_connection("127.0.0.1", pport)
            w.write(b"CONNECT public.test:443 HTTP/1.1\r\n")  # never finishes the head
            await w.drain()
            assert await asyncio.wait_for(r.read(), 2) == b""
            assert opened == []
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_idle_tunnel_is_closed():
    async def main():
        proxy, pport, up, opened, log, servers = await run_proxy(dict(TABLE), idle_timeout=0.2)
        try:
            r, w = await asyncio.open_connection("127.0.0.1", pport)
            w.write(b"CONNECT public.test:443 HTTP/1.1\r\n\r\nPING")
            await w.drain()
            got = await asyncio.wait_for(r.read(), 3)  # returns once the proxy gives up
            assert got.startswith(b"HTTP/1.1 200") and b"PONG:PING" in got
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_upstream_routes_listed_hosts_and_leaves_the_rest_direct():
    """Hosts in EGRESS_UPSTREAM_HOSTS tunnel through the trusted upstream (so they exit its
    IP); the egress does not resolve or dial the site itself. Other hosts stay direct."""

    async def main():
        seen: list[bytes] = []

        async def up_handle(r, w):
            head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 5)
            seen.append(head)
            w.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await w.drain()
            while True:
                data = await r.read(4096)
                if not data:
                    break
                w.write(b"ECHO:" + data)
                await w.drain()
            w.close()

        upserver = await asyncio.start_server(up_handle, "127.0.0.1", 0)
        upport = upserver.sockets[0].getsockname()[1]
        opened: list[tuple[str, int]] = []

        async def opener(ip, port):
            opened.append((ip, port))
            return await asyncio.open_connection(ip, port)

        proxy = eg.Proxy(
            eg.Policy(),
            resolver=fake_dns({"www.eperolehan.gov.my": ["203.0.113.9"]}),
            opener=opener,
            out=io.StringIO(),
            upstream=("127.0.0.1", upport),
            upstream_hosts=("eperolehan.gov.my",),
        )
        pserver = await asyncio.start_server(proxy.handle, "127.0.0.1", 0)
        pport = pserver.sockets[0].getsockname()[1]
        try:
            req = (
                b"CONNECT www.eperolehan.gov.my:443 HTTP/1.1\r\n"
                b"Host: www.eperolehan.gov.my:443\r\n\r\n"
            )
            out = await ask(pport, req, b"hi")
            assert out.startswith(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            assert b"ECHO:hi" in out
            assert opened == [("127.0.0.1", upport)]  # dialed the upstream, not the site's IP
            assert seen and seen[0].startswith(b"CONNECT www.eperolehan.gov.my:443 ")
            assert proxy.via_upstream("www.eperolehan.gov.my")  # host and its subdomains
            assert proxy.via_upstream("eperolehan.gov.my")
            assert not proxy.via_upstream("other.test")
        finally:
            upserver.close()
            pserver.close()

    asyncio.run(main())
