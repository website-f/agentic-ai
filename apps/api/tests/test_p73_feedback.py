"""P73: feedback from the floating button, read by the developer.

The developer is an owner the operator marked (admin make-developer); only they see the
Feedbacks page, switch the button on and off, write the house rules and answer. Everyone
signed in may send while it is on, and sees only their own pieces.
"""

import base64
import re

import httpx
from sqlalchemy import select, update

from agentic import admin
from agentic.core.db import SessionLocal
from agentic.models import AuditLog, Feedback, Membership, User

from .conftest import csrf, setup_owner
from .test_office_roles import PW, as_role

# The smallest valid PNG (1x1), and a JPEG head.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
SHOT = "data:image/png;base64," + base64.b64encode(PNG).decode()


async def make_dev(email: str = "owner@example.com") -> None:
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_developer=True))
        await db.commit()


async def switch_on(c: httpx.AsyncClient, on: bool = True) -> None:
    r = await c.put("/api/feedback/config", json={"enabled": on}, headers=csrf(c))
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is on


async def test_only_the_developer_has_the_feedbacks_page(client):
    await setup_owner(client)
    me = (await client.get("/api/auth/me")).json()
    assert me["user"]["is_developer"] is False
    assert "feedback.manage" not in me["permissions"]
    # A plain owner can neither switch it on nor read anyone's feedback.
    r = await client.put("/api/feedback/config", json={"enabled": True}, headers=csrf(client))
    assert r.status_code == 403
    assert (await client.get("/api/feedback")).status_code == 403

    await make_dev()
    me = (await client.get("/api/auth/me")).json()
    assert me["user"]["is_developer"] is True
    assert "feedback.manage" in me["permissions"]
    assert "crm.access" in me["permissions"]  # still everything an owner has
    cfg = (await client.get("/api/feedback/config")).json()
    assert cfg == {"enabled": False, "developer": True, "rules": []}


async def test_developer_flag_needs_the_owner_role(client):
    """Marked as developer but not an owner (demoted by another owner): no Feedbacks page."""
    await setup_owner(client)
    viewer = await as_role(client, "vera@example.com", "viewer")
    await make_dev("vera@example.com")
    me = (await viewer.get("/api/auth/me")).json()
    assert me["user"]["is_developer"] is False
    assert (await viewer.get("/api/feedback")).status_code == 403
    await viewer.aclose()


async def test_send_read_answer_flow(client):
    await setup_owner(client)
    await make_dev()
    staff = await as_role(client, "vera@example.com", "viewer")

    # Off: the button is hidden and sending is refused.
    assert (await staff.get("/api/feedback/config")).json()["enabled"] is False
    r = await staff.post(
        "/api/feedback", json={"kind": "general", "note": "Hello there"}, headers=csrf(staff)
    )
    assert r.status_code == 403 and r.json()["code"] == "feedback_off"

    await switch_on(client)
    assert (await staff.get("/api/feedback/config")).json() == {
        "enabled": True,
        "developer": False,
        "rules": [],
    }

    # General feedback needs words; a screenshot needs the picture.
    r = await staff.post(
        "/api/feedback", json={"kind": "general", "note": " "}, headers=csrf(staff)
    )
    assert r.status_code == 422 and r.json()["code"] == "note_missing"
    r = await staff.post("/api/feedback", json={"kind": "screenshot"}, headers=csrf(staff))
    assert r.status_code == 422 and r.json()["code"] == "screenshot_missing"

    r = await staff.post(
        "/api/feedback",
        json={
            "kind": "screenshot",
            "category": "bug",
            "note": "This button does nothing",
            "page_path": "/tasks",
            "page_title": "Tasks",
            "marks": 2,
            "screenshot": SHOT,
            "context": {"viewport": "1440x900", "language": "en", "theme": "light"},
        },
        headers=csrf(staff),
    )
    assert r.status_code == 201, r.text
    shot_id = r.json()["id"]
    r = await staff.post(
        "/api/feedback",
        json={
            "kind": "general",
            "category": "idea",
            "note": "A dark mode for reports",
            "page_path": "/reports",
        },
        headers=csrf(staff),
    )
    assert r.status_code == 201, r.text
    idea_id = r.json()["id"]

    # The sender sees their own, newest first; never the list of everyone's.
    mine = (await staff.get("/api/feedback/mine")).json()
    assert [m["id"] for m in mine] == [idea_id, shot_id]
    assert mine[1]["has_screenshot"] is True and mine[0]["has_screenshot"] is False
    assert (await staff.get("/api/feedback")).status_code == 403
    r = await staff.patch(f"/api/feedback/{shot_id}", json={"status": "done"}, headers=csrf(staff))
    assert r.status_code == 403
    # Their own screenshot opens for them.
    r = await staff.get(f"/api/feedback/{shot_id}/screenshot")
    assert r.status_code == 200 and r.content == PNG

    # The developer reads everything, with who sent it.
    lst = (await client.get("/api/feedback")).json()
    assert lst["total"] == 2 and lst["counts"] == {"new": 2}
    item = next(i for i in lst["items"] if i["id"] == shot_id)
    assert item["author_email"] == "vera@example.com"
    assert item["author_role"] == "viewer"
    assert item["marks"] == 2 and item["screenshot_bytes"] == len(PNG)
    assert item["context"]["viewport"] == "1440x900"
    r = await client.get(f"/api/feedback/{shot_id}/screenshot")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    # Filters.
    assert [i["id"] for i in (await client.get("/api/feedback?category=idea")).json()["items"]] == [
        idea_id
    ]
    assert [i["id"] for i in (await client.get("/api/feedback?q=button")).json()["items"]] == [
        shot_id
    ]

    # Answer and move along; the sender sees both.
    r = await client.patch(
        f"/api/feedback/{shot_id}",
        json={"status": "done", "dev_note": "Fixed in the next update."},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"
    mine = {m["id"]: m for m in (await staff.get("/api/feedback/mine")).json()}
    assert mine[shot_id]["status"] == "done"
    assert mine[shot_id]["dev_note"] == "Fixed in the next update."
    lst = (await client.get("/api/feedback?status=done")).json()
    assert [i["id"] for i in lst["items"]] == [shot_id]
    assert lst["counts"] == {"new": 1, "done": 1}
    assert lst["items"][0]["resolved_at"] is not None

    # Delete.
    assert (
        await client.delete(
            f"/api/feedback/{idea_id}", headers={**csrf(client), "content-type": "application/json"}
        )
    ).status_code == 204
    assert (await client.get("/api/feedback")).json()["total"] == 1

    async with SessionLocal() as db:
        actions = set((await db.scalars(select(AuditLog.action))).all())
    assert {"feedback.config", "feedback.sent", "feedback.update", "feedback.delete"} <= actions
    await staff.aclose()


async def test_screenshots_are_checked(client):
    await setup_owner(client)
    await make_dev()
    await switch_on(client)

    async def send(shot: str) -> httpx.Response:
        return await client.post(
            "/api/feedback", json={"kind": "screenshot", "screenshot": shot}, headers=csrf(client)
        )

    # Not an image type, a lie about the type, broken base64, an SVG (could carry script).
    for bad in (
        "data:text/html;base64," + base64.b64encode(b"<script>").decode(),
        "data:image/png;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode(),
        "data:image/png;base64,@@@",
        "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode(),
    ):
        r = await send(bad)
        assert r.status_code == 422, bad
        assert r.json()["code"] == "bad_screenshot"
    jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0" + b"0" * 64).decode()
    assert (await send(jpeg)).status_code == 201


async def test_other_workspaces_never_see_it(client):
    await setup_owner(client)
    await make_dev()
    await switch_on(client)
    r = await client.post(
        "/api/feedback", json={"kind": "screenshot", "screenshot": SHOT}, headers=csrf(client)
    )
    fid = r.json()["id"]
    # The piece now belongs to another workspace: this developer must not reach it.
    from agentic.models import Workspace

    async with SessionLocal() as db:
        other = Workspace(name="Other", slug="other")
        db.add(other)
        await db.flush()
        await db.execute(update(Feedback).values(workspace_id=other.id))
        await db.commit()
    assert (await client.get("/api/feedback")).json()["total"] == 0
    assert (await client.get(f"/api/feedback/{fid}/screenshot")).status_code == 404
    r = await client.patch(f"/api/feedback/{fid}", json={"status": "done"}, headers=csrf(client))
    assert r.status_code == 404


async def test_house_rules(client):
    await setup_owner(client)
    await make_dev()
    viewer = await as_role(client, "vera@example.com", "viewer")
    r = await client.put(
        "/api/feedback/config",
        json={
            "rules": [
                {
                    "title": "Approvals",
                    "body": "Money over RM 5,000 always waits for the owner.",
                    "page": "approvals",
                },
                {"title": "", "body": ""},  # empty: dropped
                {"title": "Be kind", "body": "Feedback is about the system, never a colleague."},
            ]
        },
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    rules = r.json()["rules"]
    assert [x["title"] for x in rules] == ["Approvals", "Be kind"]
    assert rules[0]["page"] == "/approvals" and rules[1]["page"] == ""
    assert all(re.match(r"^rl_", x["id"]) for x in rules)
    # Everyone reads them, even with the button off; only the developer writes them.
    assert (await viewer.get("/api/feedback/config")).json()["rules"] == rules
    r = await viewer.put("/api/feedback/config", json={"rules": []}, headers=csrf(viewer))
    assert r.status_code == 403
    # Switching the button keeps the rules.
    await switch_on(client)
    assert (await client.get("/api/feedback/config")).json()["rules"] == rules
    await viewer.aclose()


async def test_admin_make_developer(client, capsys):
    await setup_owner(client)
    await admin.make_developer("Dev@Example.com", "The Dev", None)
    out = capsys.readouterr().out
    password = re.search(r"One-time password: (\S+)", out)
    assert password, out
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "dev@example.com"))
        assert u is not None and u.is_developer and u.must_change_password and u.name == "The Dev"
        m = (await db.scalars(select(Membership).where(Membership.user_id == u.id))).one()
        assert m.role == "owner"

    from agentic.api.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as dev:
        r = await dev.post(
            "/api/auth/login", json={"email": "dev@example.com", "password": password.group(1)}
        )
        assert r.status_code == 200, r.text
        r = await dev.post(
            "/api/auth/change-password",
            json={"current_password": password.group(1), "new_password": PW},
            headers=csrf(dev),
        )
        assert r.status_code == 200, r.text
        me = (await dev.get("/api/auth/me")).json()
        assert me["role"] == "owner" and me["user"]["is_developer"] is True
        assert "feedback.manage" in me["permissions"]

    # An existing person keeps their password and becomes owner; off again keeps the role.
    viewer = await as_role(client, "vera@example.com", "viewer")
    await viewer.aclose()
    await admin.make_developer("vera@example.com", None, None)
    assert "One-time password" not in capsys.readouterr().out
    await admin.developer_off("vera@example.com")
    async with SessionLocal() as db:
        u = await db.scalar(select(User).where(User.email == "vera@example.com"))
        assert u is not None and not u.is_developer
        m = await db.get(Membership, (m.workspace_id, u.id))
        assert m is not None and m.role == "owner"
