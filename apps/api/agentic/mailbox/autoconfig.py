"""P122: an email address in, its mail server out ("one click, no server settings").

Fitri, 21 Nov 2026: "for others I don't want 'set up a server' or anything, because end users
will use it by simply clicking a button."

A person types only their address. The server works out where its IMAP (and SMTP) server is,
and whether the provider wants an app password, in this order:

1. Well-known providers by the address's domain (KNOWN: Gmail, Outlook.com/Hotmail, Yahoo,
   AOL, iCloud, Zoho, GMX, mail.com, Yandex, Fastmail, Proton). Gmail and Outlook.com go to
   the Google and Microsoft sign-in buttons instead (OAuth: no password at all; Microsoft
   turned password sign-in off for Outlook.com in 2024).
2. At the same time, asked in parallel (each at most TIMEOUT seconds):
   - the domain's own Thunderbird autoconfig file, https only:
     https://autoconfig.<domain>/mail/config-v1.1.xml, then
     https://<domain>/.well-known/autoconfig/mail/config-v1.1.xml,
   - Thunderbird's ISPDB: https://autoconfig.thunderbird.net/v1.1/<domain>,
   - the domain's MX records (DNS over HTTPS: Cloudflare, then Google).
   An MX at Google (Workspace) or Microsoft 365 wins over everything else: those mailboxes
   connect with the Google / Microsoft buttons. Then the autoconfig files in that order.
3. The MX host's provider (MX_KNOWN: Zoho, GoDaddy, Hostinger, Titan, IONOS, Yahoo, Yandex,
   Fastmail), else the ISPDB entry for the MX host's domain (what Thunderbird does).
4. Company hosting (cPanel, DirectAdmin, Plesk: most Malaysian hosts): the MX host when it is
   inside the domain, else mail.<domain>, when it resolves to a public address. Marked as a
   guess; the sign-in test right after confirms it.
5. Nothing: the page opens the folded "Advanced" fields.

Every request goes through the SSRF-guarded fetch the agents use (agents/tools.fetch_url:
every hop checked and pinned to a public address, never a private one), with short timeouts,
and the answer is cached per domain (CACHE_FOR; a miss for less). No address or password is
ever sent anywhere: only the domain name.
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, replace
from typing import Any, Literal

from . import imap

TIMEOUT = 4.0
CACHE_FOR = 6 * 3600.0
MISS_FOR = 600.0
MAX_XML = 200_000

Security = Literal["ssl", "starttls"]
PasswordKind = Literal["app", "app_if_2fa", "normal", "none"]
OAuth = Literal["google", "microsoft"]


@dataclass(frozen=True)
class Server:
    host: str
    port: int
    security: Security

    def out(self) -> dict[str, Any]:
        return {"host": self.host, "port": self.port, "security": self.security}


@dataclass(frozen=True)
class Found:
    """Where a domain's mail lives. `provider` is the key kept on the account row."""

    source: Literal["known", "autoconfig", "ispdb", "mx", "guess", "none"]
    provider: str = "other"
    name: str = ""
    imap: Server | None = None
    smtp: Server | None = None
    oauth: OAuth | None = None
    login: PasswordKind = "normal"  # what the provider wants: app password, normal, none
    app_key_url: str | None = None  # where to create an app password
    # %EMAILLOCALPART% (iCloud): the user name is the part before the @.
    local_user: bool = False
    # A note the page shows (its text lives in the web app): imap_off, proton, no_imap.
    note: str | None = None


def _p(
    provider: str,
    name: str,
    host: str,
    smtp: str,
    smtp_port: int = 465,
    **kw: Any,
) -> Found:
    return Found(
        "known",
        provider,
        name,
        Server(host, 993, "ssl"),
        Server(smtp, smtp_port, "ssl" if smtp_port == 465 else "starttls"),
        **kw,
    )


GMAIL = _p(
    "gmail",
    "Gmail",
    "imap.gmail.com",
    "smtp.gmail.com",
    oauth="google",
    login="app",
    app_key_url="https://myaccount.google.com/apppasswords",
)
OUTLOOK = _p(
    "outlook",
    "Outlook.com / Hotmail",
    "outlook.office365.com",
    "smtp-mail.outlook.com",
    587,
    oauth="microsoft",
    login="none",
)
YAHOO = _p(
    "yahoo",
    "Yahoo Mail",
    "imap.mail.yahoo.com",
    "smtp.mail.yahoo.com",
    login="app",
    app_key_url="https://login.yahoo.com/account/security/app-passwords",
)
AOL = _p(
    "aol",
    "AOL Mail",
    "imap.aol.com",
    "smtp.aol.com",
    login="app",
    app_key_url="https://login.aol.com/account/security/app-passwords",
)
ICLOUD = _p(
    "icloud",
    "iCloud Mail",
    "imap.mail.me.com",
    "smtp.mail.me.com",
    587,
    login="app",
    app_key_url="https://account.apple.com/account/manage",
    local_user=True,
)
ZOHO_URL = "https://accounts.zoho.com/home#security/app_password"
ZOHO = _p(
    "zoho",
    "Zoho Mail",
    "imap.zoho.com",
    "smtp.zoho.com",
    login="app_if_2fa",
    app_key_url=ZOHO_URL,
    note="imap_off",
)
GMX = _p("gmx", "GMX", "imap.gmx.com", "mail.gmx.com", 587, note="imap_off")
GMX_NET = _p("gmx", "GMX", "imap.gmx.net", "mail.gmx.net", 587, note="imap_off")
MAILCOM = _p("other", "mail.com", "imap.mail.com", "smtp.mail.com", 587, note="imap_off")
YANDEX = _p(
    "yandex",
    "Yandex Mail",
    "imap.yandex.com",
    "smtp.yandex.com",
    login="app",
    app_key_url="https://id.yandex.com/security/app-passwords",
)
FASTMAIL = _p("other", "Fastmail", "imap.fastmail.com", "smtp.fastmail.com", login="app")
PROTON = Found("known", "other", "Proton Mail", login="none", note="proton")
GOOGLE_WORKSPACE = replace(GMAIL, source="mx", name="Google Workspace")
MICROSOFT_365 = replace(OUTLOOK, source="mx", name="Microsoft 365")

KNOWN: dict[str, Found] = {
    "gmail.com": GMAIL,
    "googlemail.com": GMAIL,
    "outlook.com": OUTLOOK,
    "msn.com": OUTLOOK,
    "passport.com": OUTLOOK,
    "ymail.com": YAHOO,
    "rocketmail.com": YAHOO,
    "aol.com": AOL,
    "aim.com": AOL,
    "icloud.com": ICLOUD,
    "me.com": ICLOUD,
    "mac.com": ICLOUD,
    "zoho.com": ZOHO,
    "zohomail.com": ZOHO,
    "zoho.eu": replace(ZOHO, imap=Server("imap.zoho.eu", 993, "ssl")),
    "zohomail.eu": replace(ZOHO, imap=Server("imap.zoho.eu", 993, "ssl")),
    "zoho.in": replace(ZOHO, imap=Server("imap.zoho.in", 993, "ssl")),
    "zohomail.in": replace(ZOHO, imap=Server("imap.zoho.in", 993, "ssl")),
    "gmx.com": GMX,
    "gmx.us": GMX,
    "gmx.net": GMX_NET,
    "gmx.de": GMX_NET,
    "gmx.at": GMX_NET,
    "gmx.ch": GMX_NET,
    "mail.com": MAILCOM,
    "yandex.com": YANDEX,
    "yandex.ru": YANDEX,
    "ya.ru": YANDEX,
    "fastmail.com": FASTMAIL,
    "fastmail.fm": FASTMAIL,
    "proton.me": PROTON,
    "protonmail.com": PROTON,
    "pm.me": PROTON,
}
# hotmail.com, hotmail.co.uk, live.com.my, yahoo.com.my ...: by the first label.
KNOWN_BRANDS: dict[str, Found] = {
    "hotmail": OUTLOOK,
    "live": OUTLOOK,
    "outlook": OUTLOOK,
    "windowslive": OUTLOOK,
    "yahoo": YAHOO,
}

# A custom domain whose MX is at a mail provider: the provider's own server.
MX_KNOWN: list[tuple[str, Found]] = [
    ("google.com", GOOGLE_WORKSPACE),
    ("googlemail.com", GOOGLE_WORKSPACE),
    ("protection.outlook.com", MICROSOFT_365),
    ("outlook.com", MICROSOFT_365),
    ("zoho.com", replace(ZOHO, source="mx", imap=Server("imappro.zoho.com", 993, "ssl"))),
    ("zoho.eu", replace(ZOHO, source="mx", imap=Server("imappro.zoho.eu", 993, "ssl"))),
    ("zoho.in", replace(ZOHO, source="mx", imap=Server("imappro.zoho.in", 993, "ssl"))),
    ("yahoodns.net", replace(YAHOO, source="mx")),
    ("yandex.net", replace(YANDEX, source="mx")),
    ("yandex.ru", replace(YANDEX, source="mx")),
    ("messagingengine.com", replace(FASTMAIL, source="mx")),
    ("protonmail.ch", replace(PROTON, source="mx")),
    (
        "secureserver.net",
        _p("other", "GoDaddy", "imap.secureserver.net", "smtpout.secureserver.net"),
    ),
    ("hostinger.com", _p("other", "Hostinger", "imap.hostinger.com", "smtp.hostinger.com")),
    ("titan.email", _p("other", "Titan", "imap.titan.email", "smtp.titan.email")),
    ("ionos.com", _p("other", "IONOS", "imap.ionos.com", "smtp.ionos.com")),
]
MX_KNOWN = [(s, replace(f, source="mx")) for s, f in MX_KNOWN]

_HOST = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_TWO_LEVEL = {"com", "co", "net", "org", "gov", "edu", "ac", "biz", "name"}


def domain_of(email: str) -> str:
    e = email.strip().lower()
    return e.rsplit("@", 1)[1].rstrip(".") if "@" in e else ""


def valid_domain(d: str) -> bool:
    return bool(_HOST.match(d))


def base_domain(host: str) -> str:
    """mx1.mail.example.com.my -> example.com.my (what ISPDB is keyed by)."""
    parts = host.strip(".").lower().split(".")
    n = 3 if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in _TWO_LEVEL else 2
    return ".".join(parts[-n:])


def known(domain: str) -> Found | None:
    return KNOWN.get(domain) or KNOWN_BRANDS.get(domain.split(".", 1)[0])


def _by_host(host: str) -> Found | None:
    """A provider recognised by its IMAP host (an autoconfig answer for Yahoo, say)."""
    for f in [*KNOWN.values(), *(f for _s, f in MX_KNOWN)]:
        if f.imap and f.imap.host == host:
            return f
    return None


def _mx_known(mx: list[str]) -> Found | None:
    for host in mx:
        for suffix, f in MX_KNOWN:
            if host == suffix or host.endswith("." + suffix):
                return f
    return None


# ------------------------------------------------------------------------------ fetching


async def fetch(url: str, accept: str = "application/xml, text/xml, */*") -> str | None:
    """GET a public URL through the SSRF-guarded fetch (every hop checked and pinned to a
    public address). None on any failure: blocked, timeout, refused, an error status."""
    from ..agents.tools import fetch_url  # late: the agents' tools import a lot

    try:
        got = await asyncio.wait_for(fetch_url(url, accept=accept, timeout=TIMEOUT), TIMEOUT + 1)
    except Exception:  # noqa: BLE001 - blocked, DNS, TLS, timeouts: simply not found
        return None
    if got is None or got.status >= 400:
        return None
    return got.body[:MAX_XML]


async def mx_hosts(domain: str) -> list[str]:
    """The domain's MX hosts, best first (DNS over HTTPS, so no resolver library)."""
    for url in (
        f"https://cloudflare-dns.com/dns-query?name={domain}&type=MX",
        f"https://dns.google/resolve?name={domain}&type=MX",
    ):
        body = await fetch(url, accept="application/dns-json")
        if body is None:
            continue
        try:
            answers = json.loads(body).get("Answer") or []
        except (ValueError, AttributeError):
            continue
        out: list[tuple[int, str]] = []
        for a in answers:
            if not isinstance(a, dict) or a.get("type") != 15:
                continue
            pref, _, host = str(a.get("data") or "").partition(" ")
            host = host.strip().rstrip(".").lower()
            if host and pref.isdigit():
                out.append((int(pref), host))
        return [h for _p, h in sorted(out)]
    return []


async def resolves_public(host: str) -> bool:
    from ..core.ssrf import BlockedURL, guard_url

    try:
        await asyncio.wait_for(guard_url(f"https://{host}"), TIMEOUT)
    except (BlockedURL, TimeoutError, OSError):
        return False
    return True


# ------------------------------------------------------------------------------ Thunderbird XML


def parse_config(xml: str, domain: str, source: str) -> Found | None:
    """A Thunderbird config-v1.1 file: its first usable IMAP server (SSL or STARTTLS only,
    never plain text) and SMTP server."""
    from lxml import etree

    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False
    )
    try:
        root = etree.fromstring(xml.encode("utf-8", "replace"), parser=parser)  # noqa: S320
    except etree.XMLSyntaxError:
        return None
    if root is None:
        return None
    prov = root.find("emailProvider")
    if prov is None:
        return None

    def server(el: Any) -> tuple[Server, str, list[str]] | None:
        host = (el.findtext("hostname") or "").strip().lower().replace("%emaildomain%", domain)
        sock = (el.findtext("socketType") or "").strip().upper()
        try:
            port = int((el.findtext("port") or "").strip())
        except ValueError:
            return None
        sec: Security | None = (
            "ssl" if sock == "SSL" else "starttls" if sock == "STARTTLS" else None
        )
        if sec is None or not valid_domain(host):
            return None
        auths = [(a.text or "").strip().lower() for a in el.findall("authentication")]
        return Server(host, port, sec), (el.findtext("username") or "").strip(), auths

    incoming = [
        s
        for el in prov.findall("incomingServer")
        if el.get("type") == "imap" and (s := server(el)) and s[0].port in imap.PORTS
    ]
    if not incoming:
        return None
    # Prefer SSL (993) to STARTTLS, as Thunderbird does.
    incoming.sort(key=lambda s: s[0].security != "ssl")
    im, user, auths = incoming[0]
    outgoing = [
        s for el in prov.findall("outgoingServer") if el.get("type") == "smtp" and (s := server(el))
    ]
    smtp = outgoing[0][0] if outgoing else None
    same = _by_host(im.host)
    oauth_only = bool(auths) and all(a == "oauth2" for a in auths)
    name = (prov.findtext("displayShortName") or prov.findtext("displayName") or "").strip()
    if same is not None:
        return replace(same, source=source, smtp=smtp or same.smtp)  # type: ignore[arg-type]
    oauth: OAuth | None = None
    if oauth_only:
        oauth = "google" if "google" in im.host else "microsoft" if "office365" in im.host else None
        if oauth is None:
            return None  # a sign-in we cannot do
    return Found(
        source,  # type: ignore[arg-type]
        "other",
        name[:60],
        im,
        smtp,
        oauth=oauth,
        local_user=user.upper() == "%EMAILLOCALPART%",
    )


# ------------------------------------------------------------------------------ the lookup

_cache: dict[str, tuple[float, Found]] = {}


def clear_cache() -> None:
    _cache.clear()


async def _autoconfig(domain: str) -> list[Found | None]:
    urls = [
        (f"https://autoconfig.{domain}/mail/config-v1.1.xml", "autoconfig"),
        (f"https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml", "autoconfig"),
        (f"https://autoconfig.thunderbird.net/v1.1/{domain}", "ispdb"),
    ]
    bodies = await asyncio.gather(*(fetch(u) for u, _s in urls))
    return [
        parse_config(b, domain, s) if b else None for b, (_u, s) in zip(bodies, urls, strict=True)
    ]


async def lookup(domain: str) -> Found:
    """Where `domain`'s mail lives (see the module note for the order). Cached per domain."""
    domain = domain.strip().lower().rstrip(".")
    hit = _cache.get(domain)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    found = await _lookup(domain)
    if len(_cache) > 2000:
        _cache.clear()
    _cache[domain] = (
        time.monotonic() + (CACHE_FOR if found.imap or found.oauth else MISS_FOR),
        found,
    )
    return found


async def _lookup(domain: str) -> Found:
    if not valid_domain(domain):
        return Found("none")
    k = known(domain)
    if k is not None:
        return k
    configs, mx = await asyncio.gather(_autoconfig(domain), mx_hosts(domain))
    by_mx = _mx_known(mx)
    if by_mx is not None and by_mx.oauth:
        return by_mx  # Google Workspace / Microsoft 365: their own sign-in button
    for c in configs:
        if c is not None:
            return c
    if by_mx is not None:
        return by_mx
    if mx:
        base = base_domain(mx[0])
        if base != domain and valid_domain(base):
            body = await fetch(f"https://autoconfig.thunderbird.net/v1.1/{base}")
            got = parse_config(body, domain, "ispdb") if body else None
            if got is not None:
                return replace(got, source="mx")
    # Company hosting (cPanel and the like): the MX host inside the domain, else mail.<domain>.
    guesses = [h for h in mx if h.endswith("." + domain)] + [f"mail.{domain}"]
    for host in dict.fromkeys(guesses):
        if await resolves_public(host):
            return Found("guess", "cpanel", "", Server(host, 993, "ssl"))
    return Found("none")


async def discover(email: str) -> dict[str, Any]:
    """The page's answer for one address (POST /api/mail-accounts/discover)."""
    email = email.strip().lower()
    domain = domain_of(email)
    f = await lookup(domain)
    return {
        "email": email,
        "domain": domain,
        "found": f.imap is not None or f.oauth is not None,
        "source": f.source,
        "provider": f.provider,
        "name": f.name or None,
        "oauth": f.oauth,
        "imap": f.imap.out() if f.imap else None,
        "smtp": f.smtp.out() if f.smtp else None,
        "username": email.split("@", 1)[0] if f.local_user else email,
        "password": f.login,
        "app_password_url": f.app_key_url,
        "note": f.note,
    }
