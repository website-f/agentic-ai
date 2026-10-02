"""Egress guard for user-supplied URLs (ported from CrawlOps services/ssrf.py).

A provider base URL is typed by a person, so it must not be able to point the server
at cloud metadata (169.254.169.254), loopback, private ranges, or our own containers.
Every A/AAAA record is checked, so a hostname that resolves to an internal IP is
caught too. AGENTIC_PRIVATE_HOSTS_ALLOWED lets a later local model host (Ollama on
the LAN) through on purpose.

DNS rebinding: a name that answers with a public IP for the check and a private one for
the connection would slip past a check-then-connect guard. `pinned()` therefore returns a
URL that connects to the exact IP that was checked, with the original Host header and TLS
server name, so certificates are still verified against the real host name.
"""

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

from .config import settings


class BlockedURL(ValueError):
    pass


def _public(ip: str) -> bool:
    """Only globally routable unicast addresses. is_global also rules out shared/CGNAT
    (100.64.0.0/10, Tailscale), documentation and benchmarking ranges."""
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def _allowed_hosts() -> set[str]:
    return {h.strip().lower() for h in settings.private_hosts_allowed.split(",") if h.strip()}


async def guard_url(url: str) -> str | None:
    """Raise BlockedURL for internal targets. Returns the vetted IP to connect to, or None
    when there is nothing to pin (an IP literal, or a host allowed to be private)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https"):
        raise BlockedURL("Use an http:// or https:// address.")
    if u.username or u.password:
        raise BlockedURL("Put the key in the key field, not in the URL.")
    host = (u.hostname or "").lower()
    if not host:
        raise BlockedURL("That address has no host name.")
    if host in _allowed_hosts():
        return None
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not _public(host):
            raise BlockedURL(f"{host} is a private address, which is not allowed.")
        return None
    port = u.port or (443 if u.scheme == "https" else 80)
    try:
        ips = await _resolve(host, port)
    except socket.gaierror as e:
        raise BlockedURL(f"Could not find {host}. Check the address.") from e
    for ip in ips:
        if not _public(ip):
            raise BlockedURL(f"{host} points to a private address ({ip}), which is not allowed.")
    if not ips:
        raise BlockedURL(f"Could not find {host}. Check the address.")
    return ips[0]


async def _resolve(host: str, port: int) -> list[str]:
    """Every address the name resolves to (tests replace this)."""
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    return [str(i[4][0]) for i in infos]


async def pinned(url: str) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Guard `url`, then return (url, headers, httpx extensions) that reach the vetted IP."""
    ip = await guard_url(url)
    if ip is None:
        return url, {}, {}
    u = urlparse(url)
    netloc = (f"[{ip}]" if ":" in ip else ip) + (f":{u.port}" if u.port else "")
    ext: dict[str, Any] = {"sni_hostname": u.hostname} if u.scheme == "https" else {}
    return u._replace(netloc=netloc).geturl(), {"Host": u.netloc}, ext
