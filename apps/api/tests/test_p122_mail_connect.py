# ruff: noqa: E501
"""P122 (Fitri, 21 Nov 2026): Work and Personal on the Microsoft 365 page, and connecting
another email account from the address alone.

- Work: the main Microsoft account, extra ones on a company domain or in the company's tenant,
  and the shared mailboxes the person may use (now also for staff, not only admins).
- Personal: outlook.com / hotmail and other companies' domains.
- The mail server of an address is found without any server settings: well-known providers,
  Thunderbird autoconfig (the domain's own, then the ISPDB), MX at Google / Microsoft sent to
  their sign-in buttons, MX providers, then company hosting (mail.<domain>). The HTTP is
  mocked here: nothing real is called."""

import json

import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.mailbox import autoconfig, imap
from agentic.microsoft import domains
from agentic.models import SharedMailbox

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import connect, ms_query
from .test_office_roles import as_role
from .test_p63_microsoft_signin import OTHER_TENANT, configure, sso  # noqa: F401
from .test_p109_mail_accounts import fake_imap  # noqa: F401
from .test_p118_more_accounts import connect_another

XML = """<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="{domain}">
    <domain>{domain}</domain>
    <displayName>Example Hosting</displayName>
    <incomingServer type="pop3">
      <hostname>pop.%EMAILDOMAIN%</hostname><port>995</port><socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.plain.example</hostname><port>143</port><socketType>plain</socketType>
      <username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname><port>993</port><socketType>SSL</socketType>
      <username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.%EMAILDOMAIN%</hostname><port>587</port><socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>"""


def dns(*mx: str) -> str:
    return json.dumps(
        {
            "Status": 0,
            "Answer": [{"type": 15, "data": f"{i * 10} {h}."} for i, h in enumerate(mx, 1)],
        }
    )


@pytest.fixture
def web(monkeypatch):
    """The outside world: {url: body}; anything else is "not found". Records every URL."""
    pages: dict[str, str] = {}
    asked: list[str] = []
    public: set[str] = set()

    async def fetch(url: str, accept: str = "") -> str | None:
        asked.append(url)
        return pages.get(url)

    async def resolves_public(host: str) -> bool:
        asked.append(f"dns:{host}")
        return host in public

    monkeypatch.setattr(autoconfig, "fetch", fetch)
    monkeypatch.setattr(autoconfig, "resolves_public", resolves_public)
    autoconfig.clear_cache()
    yield {"pages": pages, "asked": asked, "public": public}
    autoconfig.clear_cache()


async def test_well_known_providers_need_no_lookup(web):
    y = await autoconfig.discover("Ali@Yahoo.com.my")
    assert y["imap"] == {"host": "imap.mail.yahoo.com", "port": 993, "security": "ssl"}
    assert y["password"] == "app" and y["app_password_url"].startswith("https://login.yahoo.com/")
    assert (
        y["provider"] == "yahoo" and y["source"] == "known" and y["username"] == "ali@yahoo.com.my"
    )
    ic = await autoconfig.discover("siti@icloud.com")
    assert (
        ic["username"] == "siti"
        and ic["password"] == "app"
        and ic["smtp"]["security"] == "starttls"
    )
    assert (await autoconfig.discover("a@aol.com"))["provider"] == "aol"
    z = await autoconfig.discover("a@zoho.com")
    assert z["password"] == "app_if_2fa" and z["note"] == "imap_off"
    # Gmail and Outlook.com / Hotmail: their own sign-in buttons.
    assert (await autoconfig.discover("a@gmail.com"))["oauth"] == "google"
    h = await autoconfig.discover("a@hotmail.co.uk")
    assert h["oauth"] == "microsoft" and h["password"] == "none"
    p = await autoconfig.discover("a@proton.me")
    assert p["found"] is False and p["note"] == "proton"
    assert web["asked"] == []  # nothing fetched for any of them


async def test_the_domains_own_autoconfig_first_then_the_ispdb(web):
    d = "hosting.example"
    web["pages"][f"https://autoconfig.{d}/mail/config-v1.1.xml"] = XML.format(domain=d)
    r = await autoconfig.discover(f"me@{d}")
    # POP3 and a plain-text IMAP are skipped: the SSL one, with %EMAILDOMAIN% filled in.
    assert r["source"] == "autoconfig" and r["name"] == "Example Hosting"
    assert r["imap"] == {"host": f"imap.{d}", "port": 993, "security": "ssl"}
    assert r["smtp"] == {"host": f"smtp.{d}", "port": 587, "security": "starttls"}
    assert r["username"] == "me" and r["password"] == "normal"
    # Asked in parallel: the domain's two files, the ISPDB and the MX (only the domain is sent).
    assert f"https://autoconfig.thunderbird.net/v1.1/{d}" in web["asked"]
    assert not any("me@" in u for u in web["asked"])
    # Cached per domain: a second address asks nothing.
    n = len(web["asked"])
    again = await autoconfig.discover(f"you@{d}")
    assert again["username"] == "you" and len(web["asked"]) == n

    d2 = "isp.example"
    web["pages"][f"https://autoconfig.thunderbird.net/v1.1/{d2}"] = XML.format(domain=d2)
    assert (await autoconfig.discover(f"me@{d2}"))["source"] == "ispdb"
    # A broken file is simply not an answer.
    d3 = "broken.example"
    web["pages"][f"https://autoconfig.{d3}/mail/config-v1.1.xml"] = "<clientConfig><oops"
    web["pages"][f"https://cloudflare-dns.com/dns-query?name={d3}&type=MX"] = dns(f"mail.{d3}")
    web["public"].add(f"mail.{d3}")
    got = await autoconfig.discover(f"me@{d3}")
    assert got["source"] == "guess" and got["imap"]["host"] == f"mail.{d3}"


async def test_mx_at_google_or_microsoft_goes_to_their_buttons(web):
    d = "maju.example"
    web["pages"][f"https://cloudflare-dns.com/dns-query?name={d}&type=MX"] = dns(
        "aspmx.l.google.com", "alt1.aspmx.l.google.com"
    )
    web["pages"][f"https://autoconfig.{d}/mail/config-v1.1.xml"] = XML.format(domain=d)
    g = await autoconfig.discover(f"me@{d}")
    assert g["oauth"] == "google" and g["name"] == "Google Workspace" and g["source"] == "mx"
    d2 = "jaya.example"
    # Cloudflare does not answer: Google's DNS does.
    web["pages"][f"https://dns.google/resolve?name={d2}&type=MX"] = dns(
        "jaya-example.mail.protection.outlook.com"
    )
    m = await autoconfig.discover(f"me@{d2}")
    assert m["oauth"] == "microsoft" and m["name"] == "Microsoft 365"


async def test_mx_providers_the_mx_ispdb_then_company_hosting(web):
    d = "zoho-co.example"
    web["pages"][f"https://cloudflare-dns.com/dns-query?name={d}&type=MX"] = dns("mx.zoho.com")
    z = await autoconfig.discover(f"me@{d}")
    assert z["imap"]["host"] == "imappro.zoho.com" and z["provider"] == "zoho"

    d2 = "client.example"
    web["pages"][f"https://cloudflare-dns.com/dns-query?name={d2}&type=MX"] = dns(
        "mx1.bighost.com.my"
    )
    web["pages"]["https://autoconfig.thunderbird.net/v1.1/bighost.com.my"] = XML.format(
        domain="bighost.com.my"
    ).replace("imap.%EMAILDOMAIN%", "imap.bighost.com.my")
    b = await autoconfig.discover(f"me@{d2}")
    assert b["source"] == "mx" and b["imap"]["host"] == "imap.bighost.com.my"

    d3 = "kedai.com.my"
    web["pages"][f"https://cloudflare-dns.com/dns-query?name={d3}&type=MX"] = dns(f"mail.{d3}")
    web["public"].add(f"mail.{d3}")
    c = await autoconfig.discover(f"me@{d3}")
    assert c == c | {"source": "guess", "provider": "cpanel", "found": True}
    assert c["imap"] == {"host": f"mail.{d3}", "port": 993, "security": "ssl"}

    # Nothing anywhere (and mail.<domain> is not a public address): not found.
    n = await autoconfig.discover("me@nowhere.example")
    assert n["found"] is False and n["imap"] is None and "dns:mail.nowhere.example" in web["asked"]
    assert (await autoconfig.discover("me@localhost"))["found"] is False


def test_base_domain_and_consumer_domains():
    assert autoconfig.base_domain("mx1.mail.example.com.my") == "example.com.my"
    assert autoconfig.base_domain("aspmx.l.google.com") == "google.com"
    assert all(
        domains.is_consumer(d)
        for d in ["outlook.com", "hotmail.com.my", "live.co.uk", "msn.com", "yahoo.com"]
    )
    assert not domains.is_consumer("maju.com.my")


async def test_add_with_only_the_address_and_password(client, llm, temporal, fake_imap, web):
    await office(client)
    d = "hosting.example"
    web["pages"][f"https://autoconfig.{d}/mail/config-v1.1.xml"] = XML.format(domain=d)
    r = await client.post(
        "/api/mail-accounts/discover", json={"email": f"Me@{d}"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["imap"]["host"] == f"imap.{d}"
    r = await client.post(
        "/api/mail-accounts", json={"email": f"me@{d}", "password": "pw-1"}, headers=csrf(client)
    )
    assert r.status_code == 201, r.text
    a = r.json()
    assert (a["host"], a["port"], a["username"], a["status"]) == (f"imap.{d}", 993, "me", "ok")
    r = await client.post(
        "/api/mail-accounts",
        json={"email": "a@aol.com", "provider": "aol", "password": "app-pw"},
        headers=csrf(client),
    )
    assert r.status_code == 201 and r.json()["host"] == imap.PRESETS["aol"]["host"]
    r = await client.post(
        "/api/mail-accounts",
        json={"email": "me@nowhere.example", "password": "x"},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "no_server"


async def test_work_and_personal_mailboxes(client, llm, temporal, sso):
    o = await office(client)
    await configure(client)
    assert ms_query(await connect(client))["ms"] == "connected"  # owner@example.com, the main one
    for oid, email, tid in [
        ("oid-home", "me@outlook.com", domains.CONSUMER_TENANT),
        ("oid-sales", "sales@example.com", None),  # the company's domain
        ("oid-sister", "me@sister.example", None),  # another domain, the company's tenant
        ("oid-other", "me@other.example", OTHER_TENANT),  # another company
    ]:
        sso.me = {"id": oid, "mail": email, "userPrincipalName": email}
        sso.claims = {"tid": tid} if tid else {}
        await connect_another(client)
    async with SessionLocal() as db:
        ws = await _ws(db)
        db.add(
            SharedMailbox(
                workspace_id=ws,
                address="tender@example.com",
                display_name="Tender",
                branch_id=o["branch"]["id"],
            )
        )
        await db.commit()

    got = (await client.get("/api/integrations/microsoft/my-mailboxes")).json()
    assert got["company_domains"] == ["example.com"] and got["can_manage"] is True
    assert got["personal_ms_ok"] is False  # one tenant only: outlook.com cannot sign in
    assert {a["email"]: a["kind"] for a in got["accounts"]} == {
        "owner@example.com": "work",
        "me@outlook.com": "personal",
        "sales@example.com": "work",
        "me@sister.example": "work",
        "me@other.example": "personal",
    }
    assert [s["address"] for s in got["shared"]] == ["tender@example.com"]
    listed = (await client.get("/api/integrations/microsoft/accounts")).json()
    assert [a["kind"] for a in listed] == ["work", "personal", "work", "work", "personal"]

    # Staff see only the shared mailboxes the P34 rules give them (none here), with no 403.
    staff = await as_role(client, "staff@example.com", "staff", branch_id=o["branch"]["id"])
    try:
        mine = (await staff.get("/api/integrations/microsoft/my-mailboxes")).json()
        assert mine["shared"] == [] and mine["can_manage"] is False and mine["accounts"] == []
        assert mine["company_domains"] == ["example.com"]
        assert (await staff.get("/api/integrations/microsoft/mailboxes")).status_code == 403
    finally:
        await staff.aclose()


async def _ws(db) -> str:
    from agentic.models import Workspace

    return str(await db.scalar(select(Workspace.id)))
