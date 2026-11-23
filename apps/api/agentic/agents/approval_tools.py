"""P127: Microsoft approvals (the Approvals app in Teams, SharePoint sign-offs) for a person's own
AI (their twin or private assistant), in chat and in tasks, with that person's eyes:

- m365_approvals: the approvals the person may see (the same as their Approvals page: owner and
  global admins the whole office's, branch managers and HODs their people's, everyone else their
  own), filtered: waiting for me / waiting for others / done / all, and by words;
- m365_approval: one approval opened: what it asks, who asked and when, each approver's answer
  and comment, its links (files attached in Teams are links Microsoft does not hand out: the
  person opens them in Teams);
- m365_approval_answer: PREPARE an Approve / Reject with a reason. Nothing is sent: the answer
  waits on the person's Approvals page and is sent only when they themselves press Send (never a
  manager, never the AI). It is refused for the person's own request, without a reason, and for
  an approval that is not waiting for them.

Offered and allowed exactly like the Teams tools (microsoft.access.TEAMS_TOOLS includes these):
only a person's own AI with their own Microsoft 365 connection, only when that person set the
work going (runtime.owner_asks).
"""

from typing import Any

from ..core.fence import fence
from ..microsoft import access, org_approvals
from ..microsoft.errors import MicrosoftError
from .tools import Tool, ToolContext, _threat_note

LIST_MAX = 40
FILTERS = ("waiting_for_me", "waiting_for_others", "done", "all")


def _p(props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


async def _viewer(ctx: ToolContext) -> org_approvals.Viewer | str:
    acct = await access.teams_account(ctx.db, ctx.agent)
    owner = ctx.agent.owner_user_id if ctx.agent is not None else None
    if acct is None or not owner:
        return (
            "Error: there is no Microsoft 365 connection you may use for approvals. Your person "
            "connects their own account on the Microsoft 365 page."
        )
    v = await org_approvals.viewer_for(ctx.db, ctx.agent.workspace_id, owner)
    return v if v is not None else "Error: your person is not a member of this office any more."


def _when(raw: Any) -> str:
    return str(raw or "")[:16].replace("T", " ")


def _matches(r: dict[str, Any], kind: str, words: str) -> bool:
    if kind == "waiting_for_me" and not r.get("waiting_for_me"):
        return False
    if kind == "waiting_for_others" and (r.get("state") != "pending" or r.get("waiting_for_me")):
        return False
    if kind == "done" and r.get("state") == "pending":
        return False
    if words:
        text = " ".join(
            str(r.get(k) or "") for k in ("title", "description", "owner", "source")
        ).lower()
        return all(w in text for w in words.lower().split())
    return True


async def _list(ctx: ToolContext, args: dict[str, Any]) -> str:
    v = await _viewer(ctx)
    if isinstance(v, str):
        return v
    kind = str(args.get("filter") or "waiting_for_me")
    kind = kind if kind in FILTERS else "waiting_for_me"
    limit = max(1, min(int(args.get("limit") or 20), LIST_MAX))
    try:
        got = await org_approvals.visible(ctx.db, v)
    except MicrosoftError as e:
        return f"Error: {e}"
    rows = [r for r in got["items"] if _matches(r, kind, str(args.get("search") or "").strip())]
    seen = {"all": "the whole office", "scope": "your person's people", "own": "your person's own"}
    head = (
        f"{len(rows)} approval(s) ({kind.replace('_', ' ')}; showing {seen[got['view']]}"
        + (f"; {got['failed']} account(s) could not be read now" if got["failed"] else "")
        + ")."
    )
    if not rows:
        return head
    lines = []
    for r in rows[:limit]:
        flags = [r["state"]]
        if r.get("result"):
            flags.append(f"result {r['result']}")
        if r.get("waiting_for_me"):
            flags.append("WAITING FOR YOUR PERSON")
        if r.get("i_own"):
            flags.append("your person asked")
        approvers = ", ".join(a["name"] for a in r.get("approvers") or [] if a.get("name"))
        lines.append(
            f"- [{r['id']}] {r['title']} | from {r.get('owner') or '?'} "
            f"{_when(r.get('created_at'))} | {r['source']} | {', '.join(flags)}"
            + (f" | approvers: {approvers}" if approvers else "")
        )
    if len(rows) > limit:
        lines.append(f"({len(rows) - limit} more not shown)")
    out = "\n".join(lines)
    return head + "\n" + fence(out) + _threat_note(out)


async def _one(ctx: ToolContext, args: dict[str, Any]) -> str:
    approval_id = str(args.get("approval_id") or "").strip()
    if not approval_id:
        return "Error: give the approval id (from m365_approvals)."
    v = await _viewer(ctx)
    if isinstance(v, str):
        return v
    try:
        d = await org_approvals.detail(ctx.db, v, approval_id)
    except org_approvals.ApprovalProblem as e:
        return f"Error: {e.message}"
    except MicrosoftError as e:
        return f"Error: {e}"
    lines = [
        f"Title: {d['title']}",
        f"Asked by: {d.get('owner') or '?'} on {_when(d.get('created_at'))}",
        f"State: {d['state']}" + (f", result {d['result']}" if d.get("result") else ""),
        f"Made in: {d['source']}"
        + (" (every approver must approve)" if d.get("all_must_approve") else ""),
        f"Answers: {', '.join(d.get('options') or [])}",
        "Details:",
        str(d.get("description") or "(none)")[:4000],
    ]
    for p in d.get("people") or []:
        said = p.get("response") or "no answer yet"
        comment = f' "{p["comment"]}"' if p.get("comment") else ""
        lines.append(
            f"- approver {p.get('name') or '?'}: {said}{comment} {_when(p.get('answered_at'))}"
        )
    for link in d.get("links") or []:
        lines.append(f"- link: {link}")
    out = "\n".join(lines)
    if d.get("waiting_for_me") and d.get("can_answer"):
        tail = (
            "\nThis waits for your person's answer. If they tell you to, prepare it with "
            "m365_approval_answer (with their reason); they press Send themselves."
        )
    elif d.get("i_own"):
        tail = "\nYour person asked for this one; they cannot answer it themselves."
    else:
        tail = ""
    tail += (
        "\nFiles attached in Teams are not readable here: your person opens them in the "
        "Approvals app in Teams."
    )
    return fence(out) + _threat_note(out) + tail


async def _answer(ctx: ToolContext, args: dict[str, Any]) -> str:
    approval_id = str(args.get("approval_id") or "").strip()
    response = str(args.get("response") or "").strip()
    reason = str(args.get("reason") or "").strip()
    if not approval_id or not response:
        return "Error: give the approval id (from m365_approvals) and the answer (e.g. Approve)."
    if len(reason) < org_approvals.MIN_REASON:
        return (
            "Error: an answer needs your person's reason (approve or reject). Ask them for it; "
            "never make one up."
        )
    v = await _viewer(ctx)
    if isinstance(v, str):
        return v
    try:
        p = await org_approvals.prepare(ctx.db, v, ctx.agent, approval_id, response, reason)
    except org_approvals.ApprovalProblem as e:
        return f"Error: {e.message}"
    except MicrosoftError as e:
        return f"Error: {e}"
    return (
        f'Prepared "{p.response}" for "{p.title}" (answer {p.id}) with the reason given. NOTHING '
        "is sent yet: your person sees it on the Approvals page (Microsoft 365 > Approvals), "
        "was notified, and it is sent only when they press Send there."
    )


APPROVAL_TOOLS: list[Tool] = [
    Tool(
        "m365_approvals",
        "List Microsoft approvals",
        "Your person's Microsoft approvals (the Approvals app in Teams, SharePoint sign-offs, "
        "Power Automate): what waits for their answer, what they asked others for, what is done. "
        "Use it for 'what approvals are waiting for me', 'any approvals from Siti', 'which of "
        "my requests are still pending'. Owners and admins see the whole office's approvals, "
        "managers their people's. Each line starts with the approval id (for m365_approval).",
        _p(
            {
                "filter": {
                    "type": "string",
                    "enum": list(FILTERS),
                    "description": "waiting_for_me (default): waits for your person's answer; "
                    "waiting_for_others: still pending with someone else; done; all",
                },
                "search": {"type": "string", "description": "words in the title, details or name"},
                "limit": {"type": "integer", "description": "1-40, default 20"},
            },
            [],
        ),
        "low",
        "allow",
        _list,
    ),
    Tool(
        "m365_approval",
        "Read a Microsoft approval",
        "Open one Microsoft approval by its id (from m365_approvals): what it asks, who asked and "
        "when, each approver's answer and comment, and its links. Use it to summarise an "
        "approval or to help your person decide.",
        _p({"approval_id": {"type": "string"}}, ["approval_id"]),
        "low",
        "allow",
        _one,
    ),
    Tool(
        "m365_approval_answer",
        "Prepare an approval answer",
        "Prepare your person's answer to a Microsoft approval that waits for them: the answer "
        "(e.g. Approve or Reject, one of the approval's answers) and THEIR reason (required: "
        "ask them, never invent one). Use it only when your person told you which answer to "
        "give. It is NOT sent: they see it on the Approvals page and press Send themselves. "
        "Refused for their own request.",
        _p(
            {
                "approval_id": {"type": "string"},
                "response": {"type": "string", "description": "e.g. Approve or Reject"},
                "reason": {"type": "string", "description": "your person's reason"},
            },
            ["approval_id", "response", "reason"],
        ),
        "medium",
        "allow",
        _answer,
    ),
]

assert {t.name for t in APPROVAL_TOOLS} == access.APPROVAL_TOOLS
