# ruff: noqa: E501
"""P109 the Microsoft 365 page: a person's own mail (read, reply, forward, new, attachments),
Teams chats and channels shown like Teams (and answered from the page), the calendar (week,
detail, new event, answer an invitation), Teams Approvals (or an honest "needs permission"),
and Ask AI (summaries and drafts only). Only the person's own connection, never anyone else's.
The extra Microsoft permissions are asked for only once an admin turns them on.

Microsoft and the AI are faked (httpx MockTransport); nothing real is called."""

import json

import httpx
from sqlalchemy import select

from agentic.core.db import SessionLocal
from agentic.microsoft import app as ms_app
from agentic.microsoft import http, hub
from agentic.models import AuditLog, Membership, MicrosoftAccount, User

from .conftest import csrf
from .test_agents import llm, office, temporal  # noqa: F401
from .test_microsoft import TENANT, configure, connect, ms, my_account  # noqa: F401
from .test_office_roles import as_role

ME = "oid-boss"
MAIL = {
    "id": "m1",
    "conversationId": "c1",
    "subject": "Tender pack",
    "from": {"emailAddress": {"name": "Siti", "address": "Siti@Client.example.com"}},
    "toRecipients": [{"emailAddress": {"name": "Boss", "address": "boss@maju.example.com"}}],
    "receivedDateTime": "2026-11-16T02:00:00Z",
    "isRead": False,
    "hasAttachments": True,
    "bodyPreview": "Please send the tender pack by Friday",
    "body": {
        "contentType": "html",
        "content": "<p>Please send the <b>tender pack</b> by Friday 20 Nov.</p>",
    },
    "attachments": [
        {
            "id": "att1",
            "name": "spec.pdf",
            "size": 1200,
            "contentType": "application/pdf",
            "isInline": False,
        }
    ],
}
CHAT_MSGS = {
    "value": [
        {"id": "3", "messageType": "message", "createdDateTime": "2026-11-16T03:00:00Z",
         "from": {"user": {"id": ME, "displayName": "Boss One"}},
         "body": {"contentType": "html", "content": "<p>On it <emoji alt=\"👍\"></emoji></p>"},
         "reactions": [{"reactionType": "like", "user": {"user": {"id": "u-siti"}}}]},
        {"id": "2", "messageType": "message", "createdDateTime": "2026-11-16T02:59:00Z",
         "from": {"user": {"id": "u-siti", "displayName": "Siti Aminah"}},
         "body": {"contentType": "html", "content": "<p><at id=\"0\">Boss One</at> can you check?<script>alert(1)</script><img src=\"https://graph.microsoft.com/v1.0/chats/19:c/messages/2/hostedContents/h1/$value\"><a href=\"javascript:alert(1)\">x</a></p>"},
         "mentions": [{"id": 0, "mentionText": "Boss One", "mentioned": {"user": {"id": ME}}}],
         "attachments": [{"id": "f1", "contentType": "reference", "name": "Quote.xlsx", "contentUrl": "https://maju.sharepoint.com/q.xlsx"}]},
        {"id": "1", "messageType": "systemEventMessage", "createdDateTime": "2026-11-16T02:00:00Z",
         "eventDetail": {"@odata.type": "#microsoft.graph.membersAddedEventMessageDetail",
                         "initiator": {"user": {"displayName": "Boss One"}},
                         "members": [{"displayName": "Siti Aminah"}]}},
    ]
}  # fmt: skip
CHAT = {"id": "19:c", "chatType": "oneOnOne", "topic": None,
        "members": [{"userId": ME, "displayName": "Boss One"}, {"userId": "u-siti", "displayName": "Siti Aminah"}]}  # fmt: skip


def fake_graph(ms_fake, seen: list) -> None:
    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.host != "graph.microsoft.com":
            return ms_fake.handler(r)
        p = r.url.path.removeprefix("/v1.0/")
        body = json.loads(r.content) if r.content else None
        seen.append((r.method, p, body))
        if p == "me/mailFolders/inbox/messages":
            return httpx.Response(200, json={"value": [MAIL]})
        if p == "me/messages/m1" and r.method == "GET":
            return httpx.Response(200, json=MAIL)
        if p in (
            "me/messages/m1/createReply",
            "me/messages/m1/createReplyAll",
            "me/messages/m1/createForward",
        ):
            return httpx.Response(201, json={"id": "d1", "webLink": "https://outlook/d1"})
        if p == "me/messages" and r.method == "POST":
            return httpx.Response(201, json={"id": "d2"})
        if p in ("me/messages/d1/send", "me/messages/d2/send"):
            return httpx.Response(202)
        if p == "me/messages/m1/attachments/att1":
            return httpx.Response(200, json={"id": "att1", "name": "spec.pdf", "size": 9})
        if p == "me/messages/m1/attachments/att1/$value":
            return httpx.Response(200, content=b"%PDF-1.4 ")
        if p == "me/chats/19:c/messages":
            return httpx.Response(200, json=CHAT_MSGS)
        if p == "me/chats/19:c":
            return httpx.Response(200, json=CHAT)
        if p == "chats/19:c/messages" and r.method == "POST":
            return httpx.Response(
                201,
                json={
                    "id": "4",
                    "messageType": "message",
                    "from": {"user": {"id": ME, "displayName": "Boss One"}},
                    "body": {"contentType": "html", "content": body["body"]["content"]},
                },
            )
        if p == "chats/19:c/messages/2/hostedContents/h1/$value":
            return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nxxxx")
        if p == "me/calendarView":
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "e1",
                            "subject": "Tender review",
                            "start": {"dateTime": "2026-11-18T02:00:00.0000000", "timeZone": "UTC"},
                            "end": {"dateTime": "2026-11-18T03:00:00.0000000", "timeZone": "UTC"},
                            "organizer": {
                                "emailAddress": {
                                    "name": "Siti",
                                    "address": "siti@client.example.com",
                                }
                            },
                        }
                    ]
                },
            )
        if p == "me/events/e1" and r.method == "GET":
            return httpx.Response(
                200,
                json={
                    "id": "e1",
                    "subject": "Tender review",
                    "start": {"dateTime": "2026-11-18T02:00:00.0000000"},
                    "end": {"dateTime": "2026-11-18T03:00:00.0000000"},
                    "body": {"content": "<p>Agenda: pricing</p>"},
                    "organizer": {
                        "emailAddress": {"name": "Siti", "address": "siti@client.example.com"}
                    },
                    "responseStatus": {"response": "notResponded"},
                },
            )
        if p == "me/events/e1/accept":
            return httpx.Response(202)
        if p == "me/events" and r.method == "POST":
            return httpx.Response(201, json={"id": "e2", "webLink": "https://outlook/e2"})
        if p == "me/messages" and r.method == "GET":  # search for meeting prep
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "m9",
                            "subject": "Pricing for tender",
                            "bodyPreview": "RM 1.2m",
                            "from": {"emailAddress": {"name": "Siti"}},
                        }
                    ]
                },
            )
        items = {
            "ap1": {
                "id": "ap1",
                "state": "Pending",
                "displayName": "Buy laptops",
                "viewPoint": {"roles": ["Approver"]},
                "owner": {"user": {"displayName": "Siti"}},
                "responseOptions": ["Approve", "Reject"],
                "createdDateTime": "2026-11-16T00:00:00Z",
            },
            "ap2": {
                "id": "ap2",
                "state": "Pending",
                "displayName": "Mine",
                "viewPoint": {"roles": ["Owner"]},
                "responseOptions": ["Approve", "Reject"],
            },
            # P122: on the second page; SharePoint's own sign-off of a file.
            "ap3": {
                "id": "ap3",
                "state": "Pending",
                "approvalType": "basicAwaitAll",
                "displayName": "Tender pricing.xlsx",
                "description": "Sign-off requested: https://maju.sharepoint.com/sites/x/a.xlsx",
                "viewPoint": {"roles": ["Approver"]},
                "createdDateTime": "2026-11-17T00:00:00Z",
            },
        }
        if r.url.path == "/beta/solutions/approval/approvalItems" and r.method == "POST":
            return httpx.Response(202)
        if r.url.path == "/beta/solutions/approval/approvalItems":
            if "skiptoken" in str(r.url):
                return httpx.Response(200, json={"value": [items["ap3"]]})
            assert r.url.params.get("$orderby") == "createdDateTime desc"
            return httpx.Response(
                200,
                json={
                    "value": [items["ap1"], items["ap2"]],
                    "@odata.nextLink": "https://graph.microsoft.com/beta/solutions/approval/"
                    "approvalItems?$skiptoken=page2",
                },
            )
        if r.method == "GET" and r.url.path.startswith("/beta/solutions/approval/approvalItems/"):
            got = items.get(r.url.path.rsplit("/", 1)[-1])
            return httpx.Response(200, json=got) if got else httpx.Response(404, json={})
        if r.url.path == "/beta/solutions/approval/approvalItems/ap1/responses":
            return httpx.Response(201, json={})
        return ms_fake.handler(r)

    http.transport = httpx.MockTransport(handler)


async def _grant(*scopes: str) -> None:
    async with SessionLocal() as db:
        a = await db.get(MicrosoftAccount, (await my_account()).id)
        a.scopes = " ".join([a.scopes, *[f"https://graph.microsoft.com/{s}" for s in scopes]])
        await db.commit()


async def test_mail_read_reply_forward_new_and_ai_drafts(client, llm, temporal, ms):
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    seen: list = []
    fake_graph(ms, seen)

    page = (await client.get("/api/m365/mail")).json()
    assert (
        page["items"][0]["subject"] == "Tender pack"
        and page["items"][0]["from"]["address"] == "siti@client.example.com"
    )
    assert (await client.get("/api/m365/mail?folder=../x")).status_code == 400
    full = (await client.get("/api/m365/mail/m1")).json()
    assert "tender pack" in full["body_html"] and full["attachments"][0]["name"] == "spec.pdf"

    # Reply: the person's own words, sent at once; or kept as a draft.
    r = await client.post(
        "/api/m365/mail/m1/reply",
        json={"body": "Sending today.\nBoss", "reply_all": True},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["sent"] is True
    made = next(b for m, p, b in seen if p == "me/messages/m1/createReplyAll")
    assert made["comment"] == "Sending today.<br>Boss"
    assert ("POST", "me/messages/d1/send", None) in seen
    seen.clear()
    r = await client.post(
        "/api/m365/mail/m1/reply", json={"body": "Draft only", "send": False}, headers=csrf(client)
    )
    assert r.json() == {"sent": False, "draft_id": "d1", "web_link": "https://outlook/d1"}
    assert not [p for _, p, _ in seen if p.endswith("/send")]
    assert (
        await client.post(
            "/api/m365/mail/m1/forward", json={"to": ["not-an-email"]}, headers=csrf(client)
        )
    ).status_code == 422
    r = await client.post(
        "/api/m365/mail/m1/forward",
        json={"to": ["ali@maju.example.com"], "body": "FYI"},
        headers=csrf(client),
    )
    assert r.json()["sent"] is True
    r = await client.post(
        "/api/m365/mail/send",
        json={"to": ["ali@maju.example.com"], "subject": "Hi", "body": "<b>x</b>"},
        headers=csrf(client),
    )
    assert r.status_code == 200
    new = next(b for m, p, b in seen if m == "POST" and p == "me/messages")
    assert new["body"]["content"] == "&lt;b&gt;x&lt;/b&gt;"  # typed text, never HTML

    # Attachment: a download (never shown inline), or saved into the person's own Files.
    r = await client.get("/api/m365/mail/m1/attachments/att1")
    assert r.status_code == 200 and r.headers["content-type"] == "application/octet-stream"
    assert "attachment;" in r.headers["content-disposition"]

    # Ask AI: a draft for the composer (nothing sent), a summary, tasks, a new email.
    seen.clear()
    llm.say("Dear Siti,\n\nI will send it by Friday.\n\nBoss")
    r = await client.post(
        "/api/m365/ai",
        json={"action": "mail_reply", "message_id": "m1", "tone": "formal"},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["body"].startswith("Dear Siti")
    assert not [p for m, p, _ in seen if m == "POST"]  # nothing created or sent at Microsoft
    prompt = llm.requests[-1]["messages"][-1]["content"]
    assert "<<<" in prompt and "tender pack" in prompt and "formal" in prompt
    llm.say('[{"title": "Send the tender pack", "due": "2026-11-20"}, {"title": "", "due": null}]')
    r = await client.post(
        "/api/m365/ai", json={"action": "mail_tasks", "message_id": "m1"}, headers=csrf(client)
    )
    assert r.json()["tasks"] == [{"title": "Send the tender pack", "due": "2026-11-20"}]
    llm.say('{"subject": "Tender pack", "body": "Hi Ali, ..."}')
    r = await client.post(
        "/api/m365/ai",
        json={
            "action": "mail_new",
            "instructions": "ask Ali for the pack",
            "to": "ali@maju.example.com",
        },
        headers=csrf(client),
    )
    assert r.json()["subject"] == "Tender pack" and r.json()["body"] == "Hi Ali, ..."
    assert (
        await client.post("/api/m365/ai", json={"action": "mail_summary"}, headers=csrf(client))
    ).status_code == 400

    async with SessionLocal() as db:
        actions = set((await db.scalars(select(AuditLog.action))).all())
    assert {
        "m365.mail_replied",
        "m365.mail_forwarded",
        "m365.mail_sent",
        "m365.ai_asked",
    } <= actions


async def test_teams_chat_like_teams_and_reply_from_the_page(client, llm, temporal, ms):
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    seen: list = []
    fake_graph(ms, seen)

    got = (await client.get("/api/m365/teams/chats/19:c/messages")).json()
    msgs = {m["id"]: m for m in got["messages"]}
    assert [m["id"] for m in got["messages"]] == ["1", "2", "3"]  # oldest first
    assert got["chat"]["title"] == "Siti Aminah"
    assert msgs["1"]["kind"] == "system" and msgs["1"]["text"] == "Boss One added Siti Aminah"
    assert msgs["3"]["mine"] and msgs["3"]["html"] == "<p>On it 👍</p>"
    assert msgs["3"]["reactions"] == [{"emoji": "👍", "count": 1, "mine": False}]
    two = msgs["2"]
    assert not two["mine"] and two["mentions_me"]
    assert '<span data-mention="1">Boss One</span>' in two["html"]
    assert (
        "script" not in two["html"]
        and "javascript" not in two["html"]
        and "alert" not in two["html"]
    )
    assert (
        'src="/api/m365/teams/hosted?path=%2Fv1.0%2Fchats%2F19%3Ac%2Fmessages%2F2%2FhostedContents%2Fh1%2F%24value"'
        in two["html"]
    )
    assert two["files"] == [
        {
            "id": "f1",
            "name": "Quote.xlsx",
            "kind": "file",
            "url": "https://maju.sharepoint.com/q.xlsx",
        }
    ]

    # The inline picture comes through the person's own connection; other links are refused.
    r = await client.get(
        "/api/m365/teams/hosted",
        params={"path": "/v1.0/chats/19:c/messages/2/hostedContents/h1/$value"},
    )
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert (
        await client.get("/api/m365/teams/hosted", params={"path": "/v1.0/me/messages/m1/$value"})
    ).status_code == 400
    assert (
        await client.get(
            "/api/m365/teams/chats/19:c/messages",
            params={"before": "https://graph.microsoft.com/v1.0/me/messages"},
        )
    ).status_code == 400

    r = await client.post(
        "/api/m365/teams/chats/19:c/messages",
        json={"text": "Checked <ok>\nthanks"},
        headers=csrf(client),
    )
    assert r.status_code == 201 and r.json()["mine"]
    sent = next(b for m, p, b in seen if m == "POST" and p == "chats/19:c/messages")
    assert sent["body"] == {"contentType": "html", "content": "Checked &lt;ok&gt;<br>thanks"}

    llm.say("Siti asks you to check the quote; reply today.")
    r = await client.post(
        "/api/m365/ai", json={"action": "chat_about", "chat_id": "19:c"}, headers=csrf(client)
    )
    assert r.json()["text"].startswith("Siti asks")
    assert "Me: On it" in llm.requests[-1]["messages"][-1]["content"]

    # Channels: reading needs the admin's ChannelMessage.Read.All, posting ChannelMessage.Send.
    r = await client.get("/api/m365/teams/teams/t1/channels/ch1/posts")
    assert r.status_code == 409 and r.json()["code"] == "teams_channels_off"
    r = await client.post(
        "/api/m365/teams/teams/t1/channels/ch1/posts",
        json={"text": "hi", "reply_to": "p1"},
        headers=csrf(client),
    )
    assert r.status_code == 409 and r.json()["code"] == "teams_channel_send_off"


async def test_calendar_approvals_and_meeting_prep(client, llm, temporal, ms):
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    seen: list = []
    fake_graph(ms, seen)

    week = (
        await client.get(
            "/api/m365/calendar",
            params={"start": "2026-11-16T00:00:00Z", "end": "2026-11-23T00:00:00Z"},
        )
    ).json()
    assert week[0]["subject"] == "Tender review" and week[0]["start"] == "2026-11-18T02:00:00Z"
    assert (
        await client.get(
            "/api/m365/calendar",
            params={"start": "2026-11-16T00:00:00Z", "end": "2027-02-01T00:00:00Z"},
        )
    ).status_code == 400
    ev = (await client.get("/api/m365/calendar/e1")).json()
    assert ev["my_response"] == "notResponded" and "Agenda" in ev["body_html"]
    assert (
        await client.post(
            "/api/m365/calendar/e1/respond", json={"answer": "accept"}, headers=csrf(client)
        )
    ).status_code == 200
    r = await client.post(
        "/api/m365/calendar",
        json={
            "subject": "Prep",
            "start": "2026-11-17T01:00:00Z",
            "end": "2026-11-17T02:00:00Z",
            "attendees": ["ali@maju.example.com"],
            "online": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 201
    made = next(b for m, p, b in seen if m == "POST" and p == "me/events")
    assert (
        made["isOnlineMeeting"] is True
        and made["attendees"][0]["emailAddress"]["address"] == "ali@maju.example.com"
    )

    llm.say("Purpose: agree the tender price.")
    r = await client.post(
        "/api/m365/ai", json={"action": "meeting_prep", "event_id": "e1"}, headers=csrf(client)
    )
    assert r.json()["text"].startswith("Purpose")
    assert "RM 1.2m" in llm.requests[-1]["messages"][-1]["content"]  # related mail found
    llm.say(
        '{"subject": "Sync", "start": "2026-11-19T10:00", "end": "2026-11-19T11:00", "attendees": ["ali@maju.example.com", "bad"], "online": true}'
    )
    r = await client.post(
        "/api/m365/ai",
        json={"action": "event_draft", "instructions": "sync with ali thursday 10am"},
        headers=csrf(client),
    )
    ev = r.json()["event"]
    assert ev["start"] == "2026-11-19T02:00:00Z" and ev["attendees"] == [
        "ali@maju.example.com"
    ]  # Kuala Lumpur 10:00

    # Approvals: an honest "needs permission" until the admin turns it on and the person grants it.
    r = await client.get("/api/m365/approvals")
    assert (
        r.status_code == 409
        and r.json()["code"] == "approvals_off"
        and "ApprovalSolution.ReadWrite" in r.json()["message"]
    )
    await _grant(ms_app.APPROVALS_SCOPE)
    items = (await client.get("/api/m365/approvals")).json()
    # P122: every page, newest first, each marked Teams or SharePoint.
    assert [(a["id"], a["i_approve"], a["state"], a["source"]) for a in items] == [
        ("ap3", True, "pending", "sharepoint"),
        ("ap1", True, "pending", "teams"),
        ("ap2", False, "pending", "teams"),
    ]
    assert items[0]["link"] == "https://maju.sharepoint.com/sites/x/a.xlsx"
    assert items[0]["all_must_approve"] is True and items[1]["all_must_approve"] is False
    r = await client.post(
        "/api/m365/approvals/ap2/respond", json={"response": "Approve"}, headers=csrf(client)
    )
    assert r.status_code == 409  # not waiting for my answer
    r = await client.post(
        "/api/m365/approvals/ap1/respond", json={"response": "Maybe"}, headers=csrf(client)
    )
    assert r.status_code == 400
    r = await client.post(
        "/api/m365/approvals/ap1/respond",
        json={"response": "Reject", "comment": "Too many"},
        headers=csrf(client),
    )
    assert r.status_code == 200
    assert any(b == {"response": "Reject", "comments": "Too many"} for _, _, b in seen)
    r = await client.post(
        "/api/m365/approvals/nope/respond", json={"response": "Approve"}, headers=csrf(client)
    )
    assert r.status_code == 404

    # P122: a new approval in Teams, to colleagues of the same Microsoft organisation.
    acct = await my_account()
    async with SessionLocal() as db:
        ws_id = acct.workspace_id
        for uid, name, tenant in (
            ("us-aina", "Aina", acct.tenant_id),
            ("us-bob", "Bob Elsewhere", "other-tenant"),
        ):
            db.add(User(id=uid, email=f"{uid}@maju.example.com", name=name, password_hash="x"))
            await db.flush()
            db.add(
                Membership(
                    workspace_id=ws_id,
                    user_id=uid,
                    role="staff",
                    ms_oid=f"oid-{uid}",
                    ms_tenant_id=tenant,
                )
            )
        await db.commit()
    people = (await client.get("/api/m365/approvals/people")).json()
    assert people == [{"user_id": "us-aina", "name": "Aina"}]  # not another organisation's
    r = await client.post(
        "/api/m365/approvals",
        json={"title": "Buy chairs", "approvers": ["us-bob"]},
        headers=csrf(client),
    )
    assert r.status_code == 400 and r.json()["code"] == "approver_unknown"
    r = await client.post(
        "/api/m365/approvals",
        json={
            "title": "Buy chairs",
            "description": "RM 2,000",
            "approvers": ["us-aina"],
            "all_must_approve": True,
        },
        headers=csrf(client),
    )
    assert r.status_code == 202, r.text
    made = next(
        b for m, p, b in seen if m == "POST" and p == "/beta/solutions/approval/approvalItems"
    )
    assert made["approvalType"] == "basicAwaitAll" and made["displayName"] == "Buy chairs"
    assert made["approvers"] == [{"user": {"id": "oid-us-aina"}}]


async def test_only_my_own_connection_and_scopes_behind_settings(client, llm, temporal, ms):
    await office(client)
    await configure(client, tenant=TENANT)
    await connect(client)
    seen: list = []
    fake_graph(ms, seen)
    # An admin without their own connection never reaches the owner's mail through the page.
    admin = await as_role(client, "admin.p109@example.com", "admin")
    for path in (
        "/api/m365/mail",
        "/api/m365/mail/m1",
        "/api/m365/teams/chats",
        "/api/m365/calendar/e1",
        "/api/m365/approvals",
    ):
        r = await admin.get(path)
        assert r.status_code == 409 and r.json()["code"] == "microsoft_not_connected", path
    await admin.aclose()

    # The extra permissions are asked for only once an admin turns them on.
    cfg = (await client.get("/api/integrations/microsoft")).json()
    assert cfg["teams_channel_send"] is False and cfg["teams_approvals"] is False
    r = await client.post("/api/integrations/microsoft/connect", json={}, headers=csrf(client))
    assert (
        "ChannelMessage.Send" not in r.json()["url"] and "ApprovalSolution" not in r.json()["url"]
    )
    r = await client.put(
        "/api/integrations/microsoft/options",
        json={"teams_channel_send": True, "teams_approvals": True},
        headers=csrf(client),
    )
    assert r.status_code == 200 and r.json()["teams_approvals"] is True
    r = await client.post("/api/integrations/microsoft/connect", json={}, headers=csrf(client))
    assert (
        "ChannelMessage.Send" in r.json()["url"] and "ApprovalSolution.ReadWrite" in r.json()["url"]
    )
    acct = (await client.get("/api/integrations/microsoft/account")).json()
    assert acct["channel_send_ok"] is False and acct["approvals_ok"] is False


def test_safe_html_allow_list():
    out = hub.safe_html(
        '<div onclick="x()"><style>p{}</style><b>Hi</b> <a href="https://x.example">l</a><iframe src="//e"></iframe><img src="https://evil/p.png" alt="pic"></div>'
    )
    assert (
        out
        == '<div><b>Hi</b> <a href="https://x.example" target="_blank" rel="noreferrer noopener">l</a>pic</div>'
    )
    assert hub.safe_html("a < b\nc", "text") == "a &lt; b<br>c"
    assert hub.hosted_path(
        "https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m/replies/r/hostedContents/h/$value"
    )
    assert hub.hosted_path("/v1.0/chats/x/messages/y/hostedContents/../../me/$value") is None
