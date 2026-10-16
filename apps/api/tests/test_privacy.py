"""P33 privacy gateway: real data never reaches a cloud AI provider.

A fake OpenAI-compatible provider CAPTURES every request body it is sent. Providers are told
apart by their key (all on the fake hosts the SSRF guard lets through in tests):

    cloud-key-1    an untrusted cloud provider (good.fake)
    trusted-key-2  a trusted cloud provider (flaky.fake)
    local-key-3    a provider on this server (tier "local", broken.fake)

The fake echoes the placeholders it was sent: its reply names the person it saw and, when
tools are offered, calls browser_type with the IC placeholder it saw, so the tests can prove
the reply and the tool arguments come back with the real values.
"""

import json
import re

import httpx
import pytest
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.engine import client as engine_client
from agentic.engine import gateway, privacy
from agentic.models import CompanyKit, LLMCall, Workspace

from .conftest import csrf, setup_owner

SENT: list[dict] = []

IC_DASH = "900101-14-5678"
IC_PLAIN = "850215105432"
PASSPORT = "A12345678"
CARD = "4111 1111 1111 1111"
BANK = "5123 4567 8901"
EMAIL = "siti.aminah@majujaya.my"
PHONE = "012-345 6789"
PERSON = "Siti Aminah binti Kassim"
COMPANY_GENERIC = "XYZ Trading Sdn Bhd"
BRANCH = "Maju Jaya Holdings"
TENDER = "QT260000000027691"
AMOUNT = "RM 12,500.00"

TEXT = (
    f"Prepare the tender {TENDER} for {BRANCH}. Contact {PERSON} ({EMAIL}, {PHONE}); "
    f"Siti will sign. Her MyKad is {IC_DASH}, her husband's {IC_PLAIN}, passport {PASSPORT}. "
    f"Pay the deposit of {AMOUNT} by card {CARD} or to bank account no: {BANK}. "
    f"The supplier is {COMPANY_GENERIC}."
)
REAL = [
    IC_DASH,
    IC_PLAIN,
    PASSPORT,
    CARD,
    BANK,
    EMAIL,
    PHONE,
    PERSON,
    "Siti",
    COMPANY_GENERIC,
    BRANCH,
    TENDER,
]
PH = re.compile(r"\[([A-Z]+)_([A-Z2-7]{5,})\]")


def _key(request: httpx.Request) -> str:
    return request.headers.get("authorization", "").removeprefix("Bearer ")


def fake_provider(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/images/generations"):
        body = json.loads(request.content)
        SENT.append({"key": _key(request), "path": path, "body": body})
        png = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
            "IQAAAABJRU5ErkJggg=="
        )
        return httpx.Response(
            200, json={"data": [{"b64_json": png, "revised_prompt": body["prompt"]}]}
        )
    if not path.endswith("/chat/completions"):
        return httpx.Response(404, json={"error": "no route"})
    body = json.loads(request.content)
    SENT.append({"key": _key(request), "path": path, "body": body})
    raw = json.dumps(body, ensure_ascii=False)
    seen: dict[str, str] = {}
    for k, c in PH.findall(raw):
        seen.setdefault(k, f"[{k}_{c}]")  # the first one of each kind
    person = seen.get("PERSON", "nobody")
    msg: dict = {"content": f"Done. I wrote to {person}'s address."}
    if body.get("tools"):
        msg = {
            "content": f"Typing the IC for {person.strip('[]').lower()}.",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {
                        "name": "browser_type",
                        "arguments": json.dumps(
                            {"selector": "#ic", "text": seen.get("IC", "none")}
                        ),
                    },
                }
            ],
        }
    usage = {"prompt_tokens": 100, "completion_tokens": 20}
    return httpx.Response(
        200,
        json={
            "model": body["model"],
            "usage": usage,
            "choices": [{"finish_reason": "stop", "message": msg}],
        },
    )


@pytest.fixture(autouse=True)
def fake_transport():
    SENT.clear()
    privacy.invalidate()
    engine_client.use_transport(httpx.MockTransport(fake_provider))
    yield
    engine_client.use_transport(None)
    privacy.invalidate()


async def add_provider(
    c: httpx.AsyncClient, name: str, host: str, key: str, tier: str = "paid", preset=None
) -> dict:
    r = await c.post(
        "/api/ai/providers",
        json={
            "name": name,
            "base_url": f"https://{host}/v1",
            "api_key": key,
            "tier": tier,
            "preset": preset,
        },
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def set_group(c: httpx.AsyncClient, name: str, *providers: dict) -> None:
    r = await c.put(
        f"/api/ai/groups/{name}",
        json={"members": [{"provider_id": p["id"], "model_id": "m-1"} for p in providers]},
        headers=csrf(c),
    )
    assert r.status_code == 200, r.text


async def office(c: httpx.AsyncClient) -> dict:
    """An owner, a company, a member with a name/email, a company kit; returns ids."""
    await setup_owner(c)
    b = (await c.post("/api/branches", json={"name": BRANCH}, headers=csrf(c))).json()
    r = await c.post(
        "/api/members",
        json={"email": EMAIL, "name": PERSON, "role": "viewer"},
        headers=csrf(c),
    )
    assert r.status_code == 201, r.text
    async with SessionLocal() as db:
        ws = await db.scalar(select(Workspace))
        db.add(
            CompanyKit(
                branch_id=b["id"],
                workspace_id=ws.id,
                data={
                    "legal_name": "Maju Jaya Engineering Sdn. Bhd.",
                    "reg_no": "201901012345",
                    "address": "No 12, Jalan Ampang\n50450 Kuala Lumpur",
                    "bank_name": "Maybank",
                    "bank_account": "514011223344",
                    "signatory_name": "Ahmad Faizal",
                },
            )
        )
        await db.commit()
        ws_id = ws.id
    return {"ws": ws_id, "branch": b, "temp": r.json()["temp_password"]}


async def ask(ws_id: str, text: str = TEXT, **kw) -> gateway.GatewayReply:
    async with SessionLocal() as db:
        return await gateway.chat(
            db, ws_id, "smart", [{"role": "user", "content": text}], task="test", **kw
        )


def sent_text(i: int = -1) -> str:
    return json.dumps(SENT[i]["body"], ensure_ascii=False)


# ---------------------------------------------------------------- the detector on its own


def detector(firsts=(), literals=(), **cats) -> privacy.Detector:
    return privacy.Detector(list(literals), list(firsts), {**privacy.DEFAULT_CATEGORIES, **cats})


def test_patterns_find_ids_contacts_and_references():
    m = privacy.Masker(detector())
    out = m.text(TEXT)
    for v in (IC_DASH, IC_PLAIN, PASSPORT, CARD, BANK, EMAIL, PHONE, COMPANY_GENERIC, TENDER):
        assert v not in out, v
    assert AMOUNT in out  # amounts are not masked by default
    kinds = {k for k, _ in PH.findall(out)}
    assert {"IC", "PASSPORT", "CARD", "BANKACC", "EMAIL", "PHONE", "COMPANY", "REF"} <= kinds
    # Not every long number is a card or an IC: Luhn and the birth date are checked.
    assert m.text("order 4111 1111 1111 1112 and id 901301145678") == (
        "order 4111 1111 1111 1112 and id 901301145678"
    )
    assert "[PHONE_" in m.text("call +60 12-345 6789 or +44 20 7946 0958")
    assert "[REF_" in m.text("Invoice no: INV-2026-0042 and PO #88123")


def test_known_names_are_word_bounded_and_longest_wins():
    d = detector(firsts=["Ali"], literals=[("PERSON", "Ali bin Abu"), ("COMPANY", "Alibaba")])
    m = privacy.Masker(d)
    out = m.text("Ali bin Abu met Ali at Alibaba; Alibaba's deal. ali stays lowercase.")
    assert "Ali" not in out.replace("ali stays", "")
    assert out.count("[PERSON_") == 2 and out.count("[COMPANY_") == 2
    assert "ali stays lowercase" in out
    # "Ali" inside "Alibaba" alone is never a person.
    assert privacy.Masker(detector(firsts=["Ali"])).text("Alibaba Group") == "Alibaba Group"


def test_placeholders_are_stable_and_unmask_is_tolerant():
    a, b = privacy.Masker(detector()), privacy.Masker(detector())
    one, two = a.text(f"IC {IC_DASH}"), b.text(f"again {IC_PLAIN} then {IC_DASH}")
    ph = PH.search(one).group(0)
    assert ph in two  # the same value is the same placeholder in another call
    assert a.text(f"IC {IC_DASH.replace('-', '')}") == f"IC {ph}"  # either way of writing it
    code = ph.strip("[]")
    for said in (ph, code, code.lower(), f"[{code.lower()}]"):
        assert privacy.unmask(f"x {said}'s y", a.mapping) == f"x {IC_DASH}'s y"
    assert privacy.unmask("[PERSON_ZZZZZ] stays", a.mapping) == "[PERSON_ZZZZZ] stays"
    # Tool-call arguments: inside the JSON strings, escaped properly.
    m = privacy.Masker(detector(literals=[("ADDRESS", 'No 1 "A" Jalan\nKL 50000')]))
    masked = m.json_text(json.dumps({"to": 'No 1 "A" Jalan\nKL 50000', "n": 3}))
    assert "Jalan" not in masked
    assert json.loads(privacy.unmask_json(masked, m.mapping)) == {
        "to": 'No 1 "A" Jalan\nKL 50000',
        "n": 3,
    }


def test_json_replies_stay_valid_json_when_unmasked():
    real = 'No 1 "A" Jalan\nKL 50000'
    m = privacy.Masker(detector(literals=[("ADDRESS", real)]))
    ph = m.text(real)
    for reply in (f'{{"to": "{ph}"}}', f'```json\n{{"to": "{ph}"}}\n```'):
        out = privacy.unmask_json_reply(reply, m.mapping)
        assert json.loads(out[out.find("{") : out.rfind("}") + 1]) == {"to": real}


def test_categories_switch_detectors():
    off = privacy.Masker(detector(ids=False, amounts=True))
    out = off.text(f"IC {IC_DASH} costs {AMOUNT}")
    assert IC_DASH in out and AMOUNT not in out and "[AMOUNT_" in out


# ---------------------------------------------------------------- through the gateway


async def test_cloud_provider_sees_only_placeholders_and_replies_come_back_real(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)

    r = await ask(o["ws"])
    raw = sent_text()
    for v in REAL + ["Maju Jaya Engineering", "Ahmad Faizal", "owner@example.com"]:
        assert v not in raw, f"{v!r} reached the provider"
    assert AMOUNT in raw  # amounts stay
    assert PERSON in r.content and "[PERSON_" not in r.content  # the reply is real again

    async with SessionLocal() as db:
        row = (await db.scalars(select(LLMCall).order_by(LLMCall.id.desc()))).first()
    assert row.masked >= 12 and row.data_level == "standard"


async def test_tool_call_arguments_are_restored_before_tools_run(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    tools = [{"type": "function", "function": {"name": "browser_type", "parameters": {}}}]
    r = await ask(o["ws"], f"Type {PERSON}'s IC {IC_DASH} into the form.", tools=tools)
    assert IC_DASH not in sent_text() and PERSON not in sent_text()
    assert SENT[-1]["body"]["tools"] == tools  # tool schemas are never touched
    args = json.loads(r.tool_calls[0]["function"]["arguments"])
    assert args == {"selector": "#ic", "text": IC_DASH}
    assert PERSON.lower() in r.content.lower()


async def test_image_parts_pass_and_their_text_is_masked(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    async with SessionLocal() as db:
        await gateway.chat(
            db,
            o["ws"],
            "smart",
            [{"role": "user", "content": [{"type": "text", "text": f"IC {IC_DASH}"}, image]}],
            task="test",
        )
    sent = SENT[-1]["body"]["messages"]
    parts = next(m for m in sent if m["role"] == "user")["content"]
    assert IC_DASH not in parts[0]["text"] and parts[1] == image


async def test_the_model_is_told_about_placeholders_only_when_something_was_masked(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    async with SessionLocal() as db:
        await gateway.chat(
            db,
            o["ws"],
            "smart",
            [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": f"IC {IC_DASH}"},
            ],
            task="test",
        )
        legend_sent = SENT[-1]["body"]["messages"]
        await gateway.chat(
            db,
            o["ws"],
            "smart",
            [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": "Hello there."},
            ],
            task="test",
        )
        plain_sent = SENT[-1]["body"]["messages"]
    # Appended to the existing system message (never a second one), only when something was hidden.
    assert [m["role"] for m in legend_sent] == ["system", "user"]
    assert privacy.LEGEND in legend_sent[0]["content"]
    assert privacy.LEGEND not in plain_sent[0]["content"]


async def test_same_value_same_placeholder_across_calls(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    await ask(o["ws"], f"First: {PERSON}, {IC_DASH}")
    await ask(o["ws"], f"Second, later: {IC_DASH} belongs to {PERSON}")
    first, second = set(PH.findall(sent_text(0))), set(PH.findall(sent_text(1)))
    assert first == second and len(first) == 2


async def test_local_provider_is_not_masked(client):
    o = await office(client)
    local = await add_provider(client, "Own Ollama", "broken.fake", "local-key-3", tier="local")
    await set_group(client, "smart", local)
    await ask(o["ws"])
    assert IC_DASH in sent_text() and PERSON in sent_text()


async def test_masking_off_is_passthrough(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    r = await client.put("/api/ai-engine/privacy", json={"masking": False}, headers=csrf(client))
    assert r.status_code == 200 and r.json()["masking"] is False
    await ask(o["ws"])
    assert IC_DASH in sent_text() and PERSON in sent_text()


async def test_confidential_company_uses_trusted_providers_only(client):
    o = await office(client)
    bid = o["branch"]["id"]
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    trusted = await add_provider(client, "Trusted", "flaky.fake", "trusted-key-2")
    assert cloud["trusted"] is False and trusted["trusted"] is False
    r = await client.patch(
        f"/api/ai/providers/{trusted['id']}", json={"trusted": True}, headers=csrf(client)
    )
    assert r.json()["trusted"] is True
    await set_group(client, "smart", cloud, trusted)
    r = await client.patch(
        f"/api/branches/{bid}", json={"data_level": "confidential"}, headers=csrf(client)
    )
    assert r.status_code == 200 and r.json()["data_level"] == "confidential"

    reply = await ask(o["ws"], branch_id=bid)
    assert [s["key"] for s in SENT] == ["trusted-key-2"]  # the untrusted one was never asked
    assert IC_DASH not in sent_text()  # still masked: trusted is not local
    assert any("not trusted" in str(a.get("skipped")) for a in reply.attempts)
    # Without a branch the same group starts with the untrusted provider, as before.
    await ask(o["ws"])
    assert SENT[-1]["key"] == "cloud-key-1"

    await client.patch(
        f"/api/ai/providers/{trusted['id']}", json={"trusted": False}, headers=csrf(client)
    )
    SENT.clear()
    with pytest.raises(gateway.GatewayUnavailable) as e:
        await ask(o["ws"], branch_id=bid)
    assert "Confidential" in str(e.value) and SENT == []

    async with SessionLocal() as db:
        row = (await db.scalars(select(LLMCall).where(LLMCall.branch_id == bid))).first()
    assert row is not None and row.data_level == "confidential"


async def test_local_only_company_never_leaves_the_server(client):
    o = await office(client)
    bid = o["branch"]["id"]
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    local = await add_provider(client, "Own Ollama", "broken.fake", "local-key-3", tier="local")
    await set_group(client, "smart", cloud, local)
    await client.patch(
        f"/api/branches/{bid}", json={"data_level": "local_only"}, headers=csrf(client)
    )
    await ask(o["ws"], branch_id=bid)
    assert [s["key"] for s in SENT] == ["local-key-3"]
    await set_group(client, "smart", cloud)
    with pytest.raises(gateway.GatewayUnavailable) as e:
        await ask(o["ws"], branch_id=bid)
    assert "Local only" in str(e.value)
    # Pictures cannot be masked either: a Local-only company's never go to the cloud.
    await set_group(client, "image", cloud)
    with pytest.raises(gateway.GatewayUnavailable):
        async with SessionLocal() as db:
            await gateway.generate_image(db, o["ws"], "a logo", branch_id=bid)


async def test_image_prompt_is_masked_for_a_cloud_model(client):
    o = await office(client)
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "image", cloud)
    async with SessionLocal() as db:
        pic = await gateway.generate_image(db, o["ws"], f"A banner for {BRANCH}")
    assert BRANCH not in SENT[-1]["body"]["prompt"]
    assert BRANCH in pic.revised_prompt


async def test_openrouter_asks_for_zero_data_retention(client):
    o = await office(client)
    p = await add_provider(client, "OR", "good.fake", "cloud-key-1", preset="openrouter")
    assert p["require_zdr"] is True and "zero data retention" in p["data_policy_note"]
    await set_group(client, "smart", p)
    await ask(o["ws"])
    assert SENT[-1]["body"]["provider"] == {"data_collection": "deny", "zdr": True}
    await client.patch(
        f"/api/ai/providers/{p['id']}", json={"require_zdr": False}, headers=csrf(client)
    )
    await ask(o["ws"])
    assert "provider" not in SENT[-1]["body"]


async def test_privacy_settings_preview_and_permissions(client):
    o = await office(client)
    r = await client.get("/api/ai-engine/privacy")
    assert r.status_code == 200
    body = r.json()
    assert body["masking"] is True
    assert body["categories"] == {
        "ids": True,
        "people": True,
        "companies": True,
        "amounts": False,
    }
    assert body["companies"][0] == {
        "branch_id": o["branch"]["id"],
        "name": BRANCH,
        "data_level": "standard",
        "providers_30d": [],
    }

    r = await client.post(
        "/api/ai-engine/privacy/preview", json={"text": TEXT}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert all(v not in out["masked"] for v in REAL) and AMOUNT in out["masked"]
    assert out["counts"]["ids"] >= 5 and out["counts"]["people"] >= 4
    assert out["counts"]["companies"] >= 3

    r = await client.put(
        "/api/ai-engine/privacy",
        json={"categories": {"amounts": True, "ids": False}},
        headers=csrf(client),
    )
    assert r.json()["categories"]["amounts"] is True and r.json()["masking"] is True
    masked = (
        await client.post(
            "/api/ai-engine/privacy/preview", json={"text": TEXT}, headers=csrf(client)
        )
    ).json()["masked"]
    assert IC_DASH in masked and AMOUNT not in masked
    assert (
        await client.post(
            "/api/ai-engine/privacy/preview",
            json={"text": "x" * 20001},
            headers=csrf(client),
        )
    ).status_code == 422

    # A viewer may read the settings but not change them or run the preview.
    from agentic.api.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as v:
        r = await v.post("/api/auth/login", json={"email": EMAIL, "password": o["temp"]})
        assert r.status_code == 200, r.text
        r = await v.post(
            "/api/auth/change-password",
            json={"current_password": o["temp"], "new_password": "a-long-new-password-2026"},
            headers=csrf(v),
        )
        assert r.status_code == 200, r.text
        assert (await v.get("/api/ai-engine/privacy")).status_code == 200
        assert (await v.get("/api/ai/privacy")).status_code == 200
        r = await v.post("/api/ai-engine/privacy/preview", json={"text": "hi"}, headers=csrf(v))
        assert r.status_code == 403
        r = await v.put("/api/ai-engine/privacy", json={"masking": False}, headers=csrf(v))
        assert r.status_code == 403


async def test_provider_usage_per_company(client):
    o = await office(client)
    bid = o["branch"]["id"]
    cloud = await add_provider(client, "Cloud", "good.fake", "cloud-key-1")
    await set_group(client, "smart", cloud)
    await ask(o["ws"], branch_id=bid)
    company = (await client.get("/api/ai-engine/privacy")).json()["companies"][0]
    [use] = company["providers_30d"]
    assert use["provider_id"] == cloud["id"] and use["calls"] == 1 and use["masked"] >= 12
    assert use["trusted"] is False
    providers = (await client.get("/api/ai/providers")).json()
    assert providers[0]["data_policy_note"] == "Check this provider's data policy."


PEOPLE_CASES = [
    # (text, the person value masked or None)
    ("Quotation for Encik Ahmad Faizal bin Rahman today.", "Ahmad Faizal bin Rahman"),
    ("Dear Ahmad, please confirm by Friday.", "Ahmad"),
    ("Attn: Lim Wei Ming, Procurement Unit", "Lim Wei Ming"),
    ("Contact person: Siti Aminah binti Abdullah", "Siti Aminah binti Abdullah"),
    ("Muthu a/l Rajan signed the form.", "Muthu a/l Rajan"),
    ("Dato' Sri Dr. Mahathir Hamid will attend.", "Mahathir Hamid"),
    ("Prepared by: NURUL HUDA BINTI ISMAIL", "NURUL HUDA BINTI ISMAIL"),
    ("Mr. Tan Wei Ming called.", "Tan Wei Ming"),
    ("Tan Sri Ahmad Zaki attended the launch.", "Ahmad Zaki"),
    ("Dear Sir/Madam, kindly note the changes.", None),
    ("Dear Valued Customer, thank you.", None),
    ("The Engineering Department met on Monday in Kuala Lumpur.", None),
]


@pytest.mark.parametrize(("text", "name"), PEOPLE_CASES)
def test_people_outside_the_database_are_found_by_title_patronymic_or_label(text, name):
    d = privacy.Detector([], [], {"ids": True, "people": True, "companies": True, "amounts": False})
    people = [sp.value for sp in d.find(text) if sp.kind == "PERSON"]
    assert people == ([name] if name else [])
