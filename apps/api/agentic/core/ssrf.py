"""Egress guard for user-supplied URLs (ported from CrawlOps services/ssrf.py).

A provider base URL is typed by a person, so it must not be able to point the server
at cloud metadata (169.254.169.254), loopback, private ranges, or our own containers.
Every A/AAAA record is checked, so a hostname that resolves to an internal IP is
caught too. AGENTIC_PRIVATE_HOSTS_ALLOWED lets a later local model host (Ollama on
the LAN) through on purpose.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from .config import settings


class BlockedURL(ValueError):
    pass


def _public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def _allowed_hosts() -> set[str]:
    return {h.strip().lower() for h in settings.private_hosts_allowed.split(",") if h.strip()}


async def guard_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https"):
        raise BlockedURL("Use an http:// or https:// address.")
    if u.username or u.password:
        raise BlockedURL("Put the key in the key field, not in the URL.")
    host = (u.hostname or "").lower()
    if not host:
        raise BlockedURL("That address has no host name.")
    if host in _allowed_hosts():
        return
    try:
        ipaddress.ip_address(host)
        if not _public(host):
            raise BlockedURL(f"{host} is a private address, which is not allowed.")
        return
    except ValueError:
        pass
    port = u.port or (443 if u.scheme == "https" else 80)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise BlockedURL(f"Could not find {host}. Check the address.") from e
    for info in infos:
        ip = str(info[4][0])
        if not _public(ip):
            raise BlockedURL(f"{host} points to a private address ({ip}), which is not allowed.")
