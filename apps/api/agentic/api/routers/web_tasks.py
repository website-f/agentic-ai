"""Browse for me (P9): a person gives an agent a link and says what they want, and the agent
does it in its browser: read and pull out details, or interact and fill in a form.

The brief is written for the agent in a fixed shape (where, what, which values, how to
answer, the rules), so a one-line request becomes a task the agent can carry out reliably.
Form sends still go through browser_submit, which always waits for a person.
"""

from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...agents import launch, runtime
from ...agents.templates import BY_ID
from ...agents.tools import modes_for
from ...agents.vault import for_agent as logins_for
from ...core.db import get_db
from ...core.ssrf import BlockedURL, guard_url
from ...i18n.labels import agent_status_label
from ...models import Task
from ...services import audit, events
from ..agent_schemas import TaskOut
from ..deps import Principal, api_error, require
from .agents import can_manage, get_agent
from .tasks import clean_labels, task_out

router = APIRouter(prefix="/api", tags=["web-tasks"])

READ = (
    "browser_open",
    "browser_click",
    "browser_scroll",
    "browser_back",
    "browser_read",
    "browser_snapshot",
    "browser_find",
    "browser_wait",
    "browser_close",
)
INTERACT = READ + (
    "browser_type",
    "browser_fill",
    "browser_select",
    "browser_check",
    "browser_submit",
)

TENDER = INTERACT + (
    "browser_upload",
    "browser_save_page",
    "web_search",
    "web_fetch",
    "research_gather",
    "search_library",
    "search_documents",
    "company_documents",
    "read_file",
    "company_kit",
    "draft_document",
    "revise_document",
    "export_document",
    "check_document",
    "publish_research",
    "write_page",
    "publish_report",
)


class WebTaskIn(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    instructions: str = Field(min_length=3, max_length=4000)
    mode: Literal["read", "interact", "tender"] = "read"
    values: str = Field(default="", max_length=6000)  # what to type into the form
    login: str | None = Field(default=None, max_length=80)  # a saved login's name
    output: Literal["answer", "report"] = "answer"
    title: str | None = Field(default=None, max_length=200)
    labels: list[str] = Field(default_factory=list, max_length=8)
    requires_review: bool = True


def brief_for(body: WebTaskIn) -> str:
    lines = [
        f"Open this page in your browser: {body.url}",
        "",
        "What I want:",
        body.instructions.strip(),
    ]
    if body.login:
        lines += [
            "",
            f"If the site asks you to sign in, use the saved login '{body.login}' "
            "(browser_login with submit_element).",
        ]
    if body.mode == "tender":
        lines += [
            "",
            "TENDER PREPARATION MODE — follow these stages in order:",
            "1. Verify the signed-in company and tender reference. Stop and ask a person if "
            "either differs from the request.",
            "2. Read the company's tender procedures and submission documents with "
            "company_documents, search_library and read_file. Never copy a password, PIN, "
            "security answer, OTP, certificate secret or login ID into notes or documents.",
            "3. On the portal, open the tender, check eligibility and download every tender "
            "document it offers. Downloads are saved to the company's files by themselves "
            "(folder Web downloads/<site>); read them with read_file. A button that sends a "
            "form needs browser_submit and a person's approval, even when it only searches or "
            "downloads: say exactly that in why.",
            "4. Extract every portal field and required attachment into an evidence manifest. "
            "For each value record its source: tender document, company document, portal, "
            "person, or public web source.",
            "5. Research only missing GENERAL TECHNICAL CONTENT on the public web. Prefer the "
            "buyer, Malaysian government, regulator, manufacturer and recognised standards "
            "bodies. Read the useful pages and keep their titles, URLs and access date. Web "
            "research may support methodology and standards; it must never be used to invent "
            "this company's experience, staff, certifications, equipment, price, bank facts "
            "or declarations.",
            "6. Store reusable, cited research with publish_research. This saves PDF and Word "
            "copies in AI Documents and indexes the PDF in this company's Library. Also save "
            "a concise working note at wiki/tenders/<tender-reference>-research.md. Keep "
            "observations separate from recommendations and include source URLs.",
            "7. Create these review documents with draft_document, which saves PDFs under AI "
            "documents: (a) Tender portal field manifest, showing value/source/status for every "
            "field; (b) Cadangan Teknikal, with scope, methodology, work plan, deliverables, "
            "quality, safety, risk and compliance matrix; (c) Tender submission readiness "
            "report, listing attachments, missing facts and portal actions. Export Cadangan "
            "Teknikal as DOCX too. Mark every unsupported factual value exactly [[REQUIRES "
            "HUMAN INPUT]] instead of guessing.",
            "8. Run check_document on every draft and fix drafting errors. A missing human fact "
            "is a blocker to report, not a value to fabricate.",
            "9. Only then fill portal fields whose manifest status is VERIFIED. You may draft "
            "inside the portal, but do not fill a missing or generated company fact. Attach "
            "documents with browser_upload (file_ids from company files; a person approves "
            "each upload); never upload a document the request does not allow.",
            "10. Saving, registering, uploading, declaring, signing or submitting is a "
            "transaction: use browser_submit (or browser_upload) and wait for a person's "
            "approval. Final tender submission and digital signing always require a separate "
            "explicit approval: never press the final submit (Serah/Submit), never tick the "
            "declarations, never enter a security answer or certificate PIN.",
            "11. At the last step before submission, open the offer printout the portal gives "
            "(for ePerolehan: Cetak Tawaran) and keep it as a PDF: the file it downloads is "
            "saved by itself; if it only shows a page, save that with browser_save_page. Then "
            "stop and ask a person (ask_human) to approve the final submission.",
            "12. Finish with publish_report, including links/file IDs for all created and "
            "downloaded documents and the offer PDF, a field-by-field filled/not-filled table, "
            "sources used, and every approval still needed.",
        ]
        if body.values.strip():
            lines += [
                "",
                "Person-provided tender facts (treat as evidence, but cross-check where possible):",
                body.values.strip(),
            ]
    elif body.mode == "interact":
        lines += [
            "",
            "You may click, type and fill in forms on this site to do it. Fill all the fields "
            "in one browser_fill. Sending a form waits for my approval (browser_submit): "
            "before you send, check every field against what I asked.",
        ]
        if body.values.strip():
            lines += [
                "",
                "Use exactly these values (do not invent any others):",
                body.values.strip(),
            ]
    else:
        lines += [
            "",
            "Only read: do not fill in or send any form. Open the pages you need (several if "
            "the details are spread out; split_work if there are many).",
        ]
    lines += [
        "",
        "Answer with what you found, exactly as the site shows it (names, numbers, dates), "
        "and say where on the site it came from. If something is missing or unclear, say so "
        "instead of guessing; if you need a decision, ask me (ask_human).",
    ]
    if body.output == "report":
        lines += [
            "Write it up with publish_report: a short summary, and a table with one row per "
            "item found.",
        ]
    return "\n".join(lines)


@router.post("/agents/{agent_id}/web-task", status_code=status.HTTP_201_CREATED)
async def web_task(
    agent_id: str,
    body: WebTaskIn,
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TaskOut:
    agent = await get_agent(db, principal, agent_id)
    if agent.status != "active":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "agent_inactive",
            "{name} is {status}.",
            name=agent.name,
            status=agent_status_label(agent.status),
        )
    url = body.url.strip()
    if "://" not in url:
        url = "https://" + url
    try:
        await guard_url(url)
    except BlockedURL as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_url", str(e)) from e
    body.url = url

    # The agent needs the browser for this. Give it, if this person may change the agent.
    needed = TENDER if body.mode == "tender" else INTERACT if body.mode == "interact" else READ
    needed = needed + (("browser_login",) if body.login else ())
    modes = modes_for(agent)
    if body.mode == "tender":
        gated = ("browser_submit", "browser_upload")  # always a person's approval anyway
        desired = {
            **{t: "allow" for t in needed if t not in gated},
            **{t: "ask" for t in gated},
        }
    else:
        web = dict(BY_ID["web_operator"].tools)
        desired = {t: web.get(t, "allow") for t in needed if modes.get(t) == "deny"}
    changes = {t: mode for t, mode in desired.items() if modes.get(t) != mode}
    if changes:
        if not can_manage(principal, agent):
            raise api_error(
                status.HTTP_409_CONFLICT,
                "no_browser",
                "{name} cannot use the browser yet. Ask whoever manages {name} to "
                "give it the browser tools (Permissions), or pick another agent.",
                name=agent.name,
            )
        # Tender mode is an explicit request for public research and internal drafts.
        # External transactions remain approval-gated by browser_submit.
        agent.tools = {**(agent.tools or {}), **changes}
        await audit.record(
            db,
            principal.workspace_id,
            principal.actor,
            "agent.updated",
            target=agent.id,
            after={"tools": changes},
            note="browser tools given for a web task",
        )
    if body.login and body.login not in {c.name for c in await logins_for(db, agent)}:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bad_login",
            "{name} may not use a saved login called '{login}'.",
            name=agent.name,
            login=body.login,
        )

    lowest = (
        await db.scalar(
            select(func.min(Task.position)).where(Task.workspace_id == principal.workspace_id)
        )
        or 0
    )
    title = (body.title or "").strip() or body.instructions.strip().splitlines()[0][:120]
    t = Task(
        workspace_id=principal.workspace_id,
        title=title[:200],
        brief=brief_for(body),
        priority="normal",
        assignee_agent_id=agent.id,
        branch_id=agent.branch_id,
        requires_review=body.requires_review,
        created_by=principal.actor,
        status="ready",
        position=float(lowest) - 1,
        labels=clean_labels(["web", *(["tender"] if body.mode == "tender" else []), *body.labels]),
    )
    db.add(t)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "task.created",
        target=t.id,
        after={"title": t.title, "assignee": agent.id, "web": body.mode, "url": url},
    )
    await db.commit()
    await runtime.task_event(db, t, "created", principal.actor, f"asked it to {body.mode} {url}")
    await events.publish(
        principal.workspace_id, "task.created", {"task_id": t.id, "agent_id": agent.id}
    )
    try:
        await launch.launch(db, t, principal.actor)
    except launch.LaunchError as e:
        raise api_error(e.status, e.code, e.message) from e
    await db.refresh(t)
    return await task_out(db, t)


@router.get("/agents/{agent_id}/logins")
async def agent_logins(
    agent_id: str,
    principal: Principal = Depends(require("read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    """The saved logins this agent may use (names and sites only), for the Browse for me form."""
    agent = await get_agent(db, principal, agent_id)
    return [{"name": c.name, "hosts": c.hosts} for c in await logins_for(db, agent)]
