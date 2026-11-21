"""P109: reading another email account over IMAP (stdlib imaplib, run in a thread).

Only encrypted connections: implicit TLS ("ssl", port 993) or STARTTLS ("starttls", port
143); a plain-text password is never sent. The host a person types is checked like any other
outside address (core/ssrf.guard_url: no private, loopback or metadata addresses) and the
connection goes to the exact address that was checked, with the certificate verified against
the host name.

Messages are only read (BODY.PEEK: nothing is marked read, moved or deleted).

`open_box(cfg)` is what the backup and the "Test" button use; tests replace it with a fake.
"""

import asyncio
import imaplib
import re
import socket
import ssl
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..core.ssrf import BlockedURL, guard_url
from ..i18n import Msg

TIMEOUT = 30.0

# Where the common providers keep IMAP (the page shows what each needs on the provider's side).
PRESETS: dict[str, dict[str, Any]] = {
    "gmail": {"host": "imap.gmail.com", "port": 993, "security": "ssl"},
    "yahoo": {"host": "imap.mail.yahoo.com", "port": 993, "security": "ssl"},
    "outlook": {"host": "outlook.office365.com", "port": 993, "security": "ssl"},
    # P122: more providers the page finds from the address alone (mailbox/autoconfig.py).
    "aol": {"host": "imap.aol.com", "port": 993, "security": "ssl"},
    "icloud": {"host": "imap.mail.me.com", "port": 993, "security": "ssl"},
    "zoho": {"host": "imap.zoho.com", "port": 993, "security": "ssl"},
    "gmx": {"host": "imap.gmx.com", "port": 993, "security": "ssl"},
    "yandex": {"host": "imap.yandex.com", "port": 993, "security": "ssl"},
    "cpanel": {"host": "", "port": 993, "security": "ssl"},
    "other": {"host": "", "port": 993, "security": "ssl"},
}
PORTS = frozenset({993, 143, 585, 1143, 9993})


class ImapError(Exception):
    """A sentence for the person (Msg), never the server's raw answer with secrets."""


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    security: str  # ssl | starttls
    username: str
    password: str


@dataclass
class Folder:
    name: str
    flags: frozenset[str]

    @property
    def skip(self) -> bool:
        """Trash, spam and drafts are not backed up."""
        low = {f.lower() for f in self.flags}
        if low & {"\\trash", "\\junk", "\\drafts", "\\noselect", "\\nonexistent"}:
            return True
        n = self.name.lower().rsplit("/", 1)[-1].rsplit(".", 1)[-1]
        return n in {"trash", "spam", "junk", "drafts", "deleted items", "deleted messages", "bin"}

    @property
    def everything(self) -> bool:
        """Gmail's All Mail holds every message once (labels are views of it)."""
        return "\\all" in {f.lower() for f in self.flags}


_LIST = re.compile(rb'^\((?P<flags>[^)]*)\) (?P<sep>"[^"]*"|NIL) (?P<name>.+)$')


def parse_list(line: bytes) -> Folder | None:
    m = _LIST.match(line or b"")
    if not m:
        return None
    raw = m.group("name").strip()
    if raw.startswith(b'"') and raw.endswith(b'"'):
        raw = raw[1:-1].replace(b'\\"', b'"').replace(b"\\\\", b"\\")
    flags = frozenset(f.decode("ascii", "replace") for f in m.group("flags").split())
    return Folder(raw.decode("utf-8", "replace"), flags)


def _quote(name: str) -> str:
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


class _Pinned(imaplib.IMAP4_SSL):
    """IMAP over TLS to the address that was checked, the certificate checked against the
    host name."""

    def __init__(self, host: str, ip: str | None, port: int, **kw: Any) -> None:
        self._pin = ip
        super().__init__(host, port, **kw)

    def _create_socket(self, timeout: float | None) -> socket.socket:
        sock = socket.create_connection((self._pin or self.host, self.port), timeout)
        return self.ssl_context.wrap_socket(sock, server_hostname=self.host)


class _PinnedPlain(imaplib.IMAP4):
    def __init__(self, host: str, ip: str | None, port: int, **kw: Any) -> None:
        self._pin = ip
        super().__init__(host, port, **kw)

    def _create_socket(self, timeout: float | None) -> socket.socket:
        return socket.create_connection((self._pin or self.host, self.port), timeout)


class Box:
    """One open IMAP session (blocking: call through `run`)."""

    def __init__(self, conn: imaplib.IMAP4) -> None:
        self.c = conn

    def folders(self) -> list[Folder]:
        typ, data = self.c.list()
        if typ != "OK":
            raise ImapError(Msg("The mail server did not list its folders."))
        out = [parse_list(x) for x in data or [] if isinstance(x, bytes)]
        return [f for f in out if f is not None]

    def select(self, name: str) -> tuple[int, int]:
        """(UIDVALIDITY, message count) of a folder, read only."""
        typ, data = self.c.select(_quote(name), readonly=True)
        if typ != "OK":
            raise ImapError(Msg("Could not open the folder {name}.", name=name))
        exists = int((data or [b"0"])[0] or 0)
        typ, resp = self.c.response("UIDVALIDITY")
        try:
            validity = int((resp or [b"0"])[0] or 0)
        except (TypeError, ValueError):
            validity = 0
        return validity, exists

    def uids_after(self, last: int) -> list[int]:
        typ, data = self.c.uid("SEARCH", None, f"UID {last + 1}:*")
        if typ != "OK":
            raise ImapError(Msg("The mail server refused the search."))
        uids = sorted(int(x) for x in (data[0] or b"").split() if x.isdigit())
        return [u for u in uids if u > last]  # "n:*" includes the last one when none is newer

    def sizes(self, uids: list[int]) -> dict[int, int]:
        if not uids:
            return {}
        typ, data = self.c.uid("FETCH", ",".join(str(u) for u in uids), "(RFC822.SIZE)")
        out: dict[int, int] = {}
        for part in data or []:
            line = part if isinstance(part, bytes) else (part[0] if part else b"")
            m = re.search(rb"UID (\d+).*?RFC822\.SIZE (\d+)|RFC822\.SIZE (\d+).*?UID (\d+)", line)
            if m:
                uid = int(m.group(1) or m.group(4))
                out[uid] = int(m.group(2) or m.group(3))
        return out

    def fetch(self, uid: int) -> bytes:
        typ, data = self.c.uid("FETCH", str(uid), "(BODY.PEEK[])")
        if typ != "OK":
            raise ImapError(Msg("The mail server did not give message {uid}.", uid=uid))
        for part in data or []:
            if isinstance(part, tuple) and len(part) > 1 and isinstance(part[1], bytes):
                return part[1]
        return b""

    def close(self) -> None:
        try:
            self.c.logout()
        except Exception:  # noqa: BLE001,S110 - closing is best effort
            pass


def _login(cfg: Config, ip: str | None) -> Box:
    ctx = ssl.create_default_context()
    try:
        if cfg.security == "ssl":
            conn: imaplib.IMAP4 = _Pinned(cfg.host, ip, cfg.port, ssl_context=ctx, timeout=TIMEOUT)
        else:
            conn = _PinnedPlain(cfg.host, ip, cfg.port, timeout=TIMEOUT)
            conn.starttls(ssl_context=ctx)
    except (OSError, imaplib.IMAP4.error) as e:
        raise ImapError(
            Msg(
                "Could not reach {host} on port {port}. Check the server and port.",
                host=cfg.host,
                port=cfg.port,
            )
        ) from e
    try:
        conn.login(cfg.username, cfg.password)
    except imaplib.IMAP4.error as e:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001,S110
            pass
        raise ImapError(
            Msg(
                "The mail server refused the sign-in. Check the user name and use an app "
                "password if the provider asks for one."
            )
        ) from e
    return Box(conn)


async def check_host(host: str, port: int) -> str | None:
    """Refuse private and internal addresses; the address to connect to (None: as named)."""
    if port not in PORTS:
        raise ImapError(Msg("Use an IMAP port: 993 (SSL) or 143 (STARTTLS)."))
    try:
        return await guard_url(f"https://{host}:{port}/")
    except BlockedURL as e:
        raise ImapError(e.args[0] if e.args else Msg("That server is not allowed.")) from e


async def real_open(cfg: Config) -> Box:
    ip = await check_host(cfg.host, cfg.port)
    return await asyncio.to_thread(_login, cfg, ip)


# Tests swap this for a fake server.
open_box: Callable[[Config], Any] = real_open


async def run(fn: Callable[..., Any], *args: Any) -> Any:
    """A blocking Box call in a thread (a fake box's plain calls work too)."""
    return await asyncio.to_thread(fn, *args)


async def test(cfg: Config) -> int:
    """Sign in and list the folders: how many there are. Raises ImapError."""
    box = await open_box(cfg)
    try:
        return len(await run(box.folders))
    finally:
        await run(box.close)
