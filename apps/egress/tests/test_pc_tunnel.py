"""P58: hosts offered to the site-through-a-computer gateway (EGRESS_PC_TUNNEL).

The browser is asked for its workspace's proxy credentials (407), then the CONNECT goes to
the gateway with them: 200 tunnels through it, 409 goes out directly as before, 503 refuses.
No network: a fake gateway and a fake site on 127.0.0.1."""

import asyncio
import io

from test_egress import ask, eg, fake_dns

AUTH = b"Proxy-Authorization: Basic d3NfMTpzaWc=\r\n"
REQ = (
    b"CONNECT www.eperolehan.gov.my:443 HTTP/1.1\r\nHost: www.eperolehan.gov.my:443\r\n"
)


def _stack(gateway_answer: bytes):
    async def build():
        seen: list[bytes] = []

        async def gateway(r, w):
            head = await asyncio.wait_for(r.readuntil(b"\r\n\r\n"), 5)
            seen.append(head)
            w.write(gateway_answer)
            await w.drain()
            if gateway_answer.startswith(b"HTTP/1.1 200"):
                while data := await r.read(4096):
                    w.write(b"VIA-PC:" + data)
                    await w.drain()
            w.close()

        async def site(r, w):  # the direct way out
            data = await r.read(4096)
            w.write(b"DIRECT:" + data)
            await w.drain()
            w.close()

        gserver = await asyncio.start_server(gateway, "127.0.0.1", 0)
        gport = gserver.sockets[0].getsockname()[1]
        sserver = await asyncio.start_server(site, "127.0.0.1", 0)
        sport = sserver.sockets[0].getsockname()[1]

        async def opener(ip, port):
            if (ip, port) == ("127.0.0.1", gport):
                return await asyncio.open_connection(ip, gport)
            return await asyncio.open_connection("127.0.0.1", sport)

        proxy = eg.Proxy(
            eg.Policy(),
            resolver=fake_dns({"www.eperolehan.gov.my": ["93.184.215.14"]}),
            opener=opener,
            out=io.StringIO(),
            pc_tunnel=("127.0.0.1", gport),
            pc_tunnel_hosts=("eperolehan.gov.my",),
        )
        pserver = await asyncio.start_server(proxy.handle, "127.0.0.1", 0)
        return (
            proxy,
            pserver.sockets[0].getsockname()[1],
            seen,
            (gserver, sserver, pserver),
        )

    return build


def run(gateway_answer: bytes, test):
    async def main():
        proxy, pport, seen, servers = await _stack(gateway_answer)()
        try:
            await test(proxy, pport, seen)
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())


def test_the_browser_is_asked_for_its_credentials_first():
    async def t(proxy, pport, seen):
        out = await ask(pport, REQ + b"\r\n")
        assert out.startswith(b"HTTP/1.1 407 Proxy Authentication Required")
        assert b'Proxy-Authenticate: Basic realm="agentic"' in out
        assert seen == []  # nothing reached the gateway without credentials

    run(b"HTTP/1.1 200 Connection established\r\n\r\n", t)


def test_through_the_company_computer_when_the_gateway_tunnels():
    async def t(proxy, pport, seen):
        out = await ask(pport, REQ + AUTH + b"\r\n", b"hello")
        assert out.startswith(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        assert b"VIA-PC:hello" in out
        assert (
            b"Proxy-Authorization: Basic d3NfMTpzaWc=" in seen[0]
        )  # handed on to decide
        assert proxy.via_pc("eperolehan.gov.my") and not proxy.via_pc(
            "eperolehan.gov.my.evil"
        )

    run(b"HTTP/1.1 200 Connection established\r\n\r\n", t)


def test_not_tunnelled_goes_out_directly_as_before():
    async def t(proxy, pport, seen):
        out = await ask(pport, REQ + AUTH + b"\r\n", b"hello")
        assert out.startswith(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        assert b"DIRECT:hello" in out

    run(b"HTTP/1.1 409 Conflict\r\nContent-Length: 14\r\n\r\nnot tunnelled\n", t)


def test_refused_while_the_computer_is_unavailable():
    async def t(proxy, pport, seen):
        out = await ask(pport, REQ + AUTH + b"\r\n")
        assert out.startswith(b"HTTP/1.1 503")
        assert b"company computer: Aina's PC is offline" in out

    run(
        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 20\r\n\r\nAina's PC is offline",
        t,
    )


def test_every_site_mode_checks_the_address_first_then_routes():
    """P60 `*`: every https site is offered to the gateway, after the public-address check."""

    async def main():
        proxy, pport, seen, servers = await _stack(
            b"HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\n\r\n"
        )()
        proxy.pc_tunnel_hosts = ("*",)
        proxy.resolver = fake_dns(
            {"www.eperolehan.gov.my": ["93.184.215.14"], "inside.test": ["10.0.0.5"]}
        )
        try:
            assert proxy.via_pc("anything.example")
            out = await ask(pport, REQ + AUTH + b"\r\n", b"hello")
            assert b"DIRECT:hello" in out  # 409: out to the checked address
            bad = (
                b"CONNECT inside.test:443 HTTP/1.1\r\nHost: inside.test:443\r\n"
                + AUTH
                + b"\r\n"
            )
            out = await ask(pport, bad)
            assert out.startswith(b"HTTP/1.1 403")  # a private address never leaves
        finally:
            for s in servers:
                s.close()

    asyncio.run(main())
