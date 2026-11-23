"""P127: every Microsoft approval of the organisation the viewer may see, one approval opened
with its approvers and their answers, an answer with a reason, and answers a person's own AI
prepared for them to send.

Fitri (23 Nov 2026): "I only saw the approvals that has me but I didn't see all approvals from my
tenant including in Teams. so put it all. and make it I can view the approval to view the content
and attachments if any ... when in chat or task the AI agent can help with approval kind of
things."

What Microsoft offers (Graph beta, Approvals app API; checked 23 Nov 2026):
- GET /solutions/approval/approvalItems lists only the approvals the signed-in person created or
  is an approver of (`viewPoint.roles`). It is DELEGATED ONLY: "Application: Not supported", so
  there is no tenant-wide listing, with any permission or admin consent.
- The same list holds what the Approvals app in Teams shows (approvals made in Teams and
  SharePoint's built-in sign-offs). Graph says nothing about where one was made.
- approvalItem has no attachments; its relationships are `requests` (one per approver) and
  `responses` (answer, comments, who, when). Files attached in Teams are OneDrive / SharePoint
  links Graph does not return, so an approval opens with the links in its description and a link
  to the Approvals app in Teams (Microsoft documents no link to one approval).

So "all approvals" is the union of the lists of every connected Microsoft account in the office
the viewer may see (each member's own delegated token, as the Microsoft 365 page already uses
it), read in parallel (PARALLEL at a time), each account's list kept FRESH_FOR seconds and shown
stale (refreshed behind) for KEEP_FOR; one account that fails never breaks the list. The same
approval seen through several accounts is one row (by Microsoft's id).

Who sees what:
- owner (the developer is an owner) and global admins (`admin`): every approval;
- branch managers, group HODs and HODs: approvals where the requester or an approver is one of
  the people of their scope (their companies / their department, and everyone under them on the
  organization chart);
- everyone else: their own (approvals they asked for or are asked to answer), as before.

Answering: only an approver answers, never the person who asked for it, always with a reason,
always through their OWN Microsoft account. The AI only prepares an answer (ApprovalAnswer); the
person presses Send. Every answer is audited (who, which approval, the answer; never the text).
"""

import asyncio
import contextlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.scope import Scope
from ..core.db import SessionLocal
from ..core.ids import new_id
from ..core.valkey import valkey
from ..i18n import Msg
from ..models import Agent, Membership, MicrosoftAccount, User
from ..services import audit
from ..teams.branches import member_in_branches
from . import access, app, auth, graph, hub
from .approval_models import ApprovalAnswer
from .errors import MicrosoftError

log = logging.getLogger("agentic.microsoft.org_approvals")

SEE_ALL = frozenset({"owner", "admin"})
SCOPED = frozenset({"branch_manager", "group_hod", "hod"})
# The Approvals app in Teams (its Teams app id); Microsoft has no link to one approval.
TEAMS_APPROVALS_APP = "https://teams.microsoft.com/l/app/7c316234-ded0-4f95-8a83-8453d0876592"
FRESH_FOR = 60  # seconds an account's list is fresh
KEEP_FOR = 24 * 3600  # a stale list is still shown (and refreshed behind) this long
PARALLEL = 6  # accounts read at once
TOP = 300  # approvals per account, newest first
MIN_REASON = 3  # characters
DESCRIPTION_MAX = 8000
# Tests turn the behind-the-scenes refresh off (it outlives a test's event loop).
BACKGROUND = True

_FLOW = re.compile(r"powerautomate|flow\.microsoft\.com|make\.powerautomate", re.I)
_LINK = re.compile(r"https://[^\s<>\"')\]]+")
_KEEP = (
    "id",
    "displayName",
    "description",
    "state",
    "result",
    "approvalType",
    "owner",
    "approvers",
    "viewPoint",
    "responseOptions",
    "responsePrompts",
    "createdDateTime",
    "completedDateTime",
)
_refreshing: set[str] = set()
_tasks: set[asyncio.Task[Any]] = set()


class ApprovalProblem(Exception):
    """`message` is a Msg (English in logs, the person's language when shown)."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------------------------------------------------------------- who sees what


@dataclass(frozen=True)
class Viewer:
    workspace_id: str
    user_id: str
    role: str
    scope: Scope

    @classmethod
    def of(cls, principal: Any) -> "Viewer":
        return cls(principal.workspace_id, principal.user.id, principal.role, principal.scope)

    @property
    def sees_all(self) -> bool:
        return self.role in SEE_ALL

    @property
    def view(self) -> str:
        return "all" if self.sees_all else "scope" if self.role in SCOPED else "own"


async def viewer_for(db: AsyncSession, workspace_id: str, user_id: str) -> Viewer | None:
    """The viewer for a member found by id (their AI acts with their eyes)."""
    from ..teams.people import below

    m = await db.get(Membership, (workspace_id, user_id))
    if m is None:
        return None
    team = frozenset(await below(db, workspace_id, user_id))
    return Viewer(workspace_id, user_id, m.role, Scope.of_member(m, team))


async def people_in_view(db: AsyncSession, v: Viewer) -> set[str] | None:
    """The members whose approvals this viewer sees (None: everyone's)."""
    if v.sees_all:
        return None
    out = {v.user_id}
    if v.role not in SCOPED:
        return out
    sc = v.scope
    q = select(Membership.user_id).where(Membership.workspace_id == v.workspace_id)
    if sc.kind == "branch":
        out |= set((await db.scalars(q.where(member_in_branches(sc.branch_ids)))).all())
    elif sc.kind == "department" and sc.department_id:
        out |= set((await db.scalars(q.where(Membership.department_id == sc.department_id))).all())
    return out | set(sc.team)


async def _accounts(
    db: AsyncSession, workspace_id: str, people: set[str] | None
) -> list[MicrosoftAccount]:
    """The connected Microsoft accounts (every one a member added) that may read approvals."""
    q = select(MicrosoftAccount).where(
        MicrosoftAccount.workspace_id == workspace_id,
        MicrosoftAccount.status.in_(sorted(access.USABLE_ACCOUNT)),
    )
    if people is not None:
        q = q.where(MicrosoftAccount.user_id.in_(sorted(people)))
    rows = (await db.scalars(q.order_by(MicrosoftAccount.created_at))).all()
    return [a for a in rows if auth.has_scope(a.scopes or "", app.APPROVALS_SCOPE)]


async def _oids(db: AsyncSession, workspace_id: str) -> dict[str, str]:
    """{Microsoft object id: member id} of this office (sign-in and connected accounts)."""
    out: dict[str, str] = {}
    for oid, uid in (
        await db.execute(
            select(Membership.ms_oid, Membership.user_id).where(
                Membership.workspace_id == workspace_id, Membership.ms_oid.is_not(None)
            )
        )
    ).all():
        if oid:
            out[str(oid)] = uid
    for oid, uid in (
        await db.execute(
            select(MicrosoftAccount.ms_user_id, MicrosoftAccount.user_id).where(
                MicrosoftAccount.workspace_id == workspace_id
            )
        )
    ).all():
        if oid:
            out[str(oid)] = uid
    return out


# ---------------------------------------------------------------- reading every account


def _slim(a: dict[str, Any]) -> dict[str, Any]:
    out = {k: a.get(k) for k in _KEEP if k in a}
    if isinstance(out.get("description"), str):
        out["description"] = out["description"][:DESCRIPTION_MAX]
    return out


def _key(account_id: str) -> str:
    return f"m365:approvals:{account_id}"


async def _cached(account_id: str) -> tuple[float, list[dict[str, Any]]] | None:
    try:
        raw = await valkey().get(_key(account_id))
    except Exception:  # noqa: BLE001 - no cache: ask Microsoft
        return None
    if not raw:
        return None
    try:
        got = json.loads(raw)
        return float(got["at"]), list(got["items"])
    except (ValueError, KeyError, TypeError):
        return None


async def _store(account_id: str, items: list[dict[str, Any]]) -> None:
    with contextlib.suppress(Exception):
        await valkey().set(
            _key(account_id), json.dumps({"at": time.time(), "items": items}), ex=KEEP_FOR
        )


async def forget(account_ids: list[str]) -> None:
    """After an answer: the next read asks Microsoft again."""
    with contextlib.suppress(Exception):
        if account_ids:
            await valkey().delete(*[_key(a) for a in account_ids])


async def _read_account(account_id: str) -> list[dict[str, Any]]:
    """One account's approvals, on its own database session (accounts are read in parallel
    and a token refresh writes to the database)."""
    async with SessionLocal() as s:
        acct = await s.get(MicrosoftAccount, account_id)
        if acct is None or acct.status not in access.USABLE_ACCOUNT:
            return []
        g = await graph.for_account(s, acct)
        return [_slim(a) for a in await g.approvals(TOP)]


def _behind(account_id: str) -> None:
    if not BACKGROUND or account_id in _refreshing:
        return
    _refreshing.add(account_id)

    async def run() -> None:
        try:
            await _store(account_id, await _read_account(account_id))
        except Exception:  # noqa: BLE001 - the stale list stays; next read tries again
            log.info("approvals refresh failed for account %s", account_id)
        finally:
            _refreshing.discard(account_id)

    t = asyncio.create_task(run())
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def _account_items(
    account_id: str, fresh: bool, gate: asyncio.Semaphore
) -> tuple[list[dict[str, Any]], bool]:
    """(the account's approvals, whether reading them failed)."""
    got = await _cached(account_id)
    if got is not None and not fresh:
        if time.time() - got[0] >= FRESH_FOR:
            _behind(account_id)  # shown now, refreshed behind
        return got[1], False
    try:
        async with gate:
            items = await _read_account(account_id)
    except Exception as e:  # noqa: BLE001 - one account never breaks the list
        log.info("approvals of account %s not read: %s", account_id, type(e).__name__)
        return (got[1] if got else []), True
    await _store(account_id, items)
    return items, False


@dataclass
class Entry:
    """One approval, merged over every account that returned it."""

    raw: dict[str, Any]
    roles: dict[str, set[str]] = field(default_factory=dict)  # member id -> roles
    accounts: list[tuple[str, str]] = field(default_factory=list)  # (account id, member id)
    parties: set[str] = field(default_factory=set)  # members who asked or are approvers


@dataclass
class Gathered:
    entries: dict[str, Entry]
    accounts: int
    failed: int
    oids: dict[str, str]


def _rank(a: dict[str, Any]) -> int:
    """Which copy of an approval is newest: a finished one over one still waiting."""
    return {"completed": 3, "canceled": 3, "pending": 2, "created": 1}.get(
        str(a.get("state") or "").lower(), 0
    )


def _owner_oid(a: dict[str, Any]) -> str:
    return str(((a.get("owner") or {}).get("user") or {}).get("id") or "")


def _who(part: dict[str, Any] | None) -> dict[str, str]:
    """{id, name} of an identity set (a person, or a group asked as one approver)."""
    p = part or {}
    u = p.get("user") or p.get("group") or p.get("application") or {}
    return {"id": str(u.get("id") or ""), "name": str(u.get("displayName") or "")}


def _approver_oids(a: dict[str, Any]) -> list[str]:
    out = []
    for ap in a.get("approvers") or []:
        oid = str(((ap or {}).get("user") or {}).get("id") or "")
        if oid:
            out.append(oid)
    return out


async def gather(db: AsyncSession, v: Viewer, *, fresh: bool = False) -> Gathered:
    people = await people_in_view(db, v)
    accts = await _accounts(db, v.workspace_id, people)
    oids = await _oids(db, v.workspace_id)
    gate = asyncio.Semaphore(PARALLEL)
    results = await asyncio.gather(*(_account_items(a.id, fresh, gate) for a in accts))
    entries: dict[str, Entry] = {}
    failed = 0
    for acct, (items, bad) in zip(accts, results, strict=True):
        failed += int(bad)
        for a in items:
            aid = str(a.get("id") or "")
            if not aid:
                continue
            e = entries.get(aid)
            if e is None:
                e = entries[aid] = Entry(raw=a)
            elif _rank(a) > _rank(e.raw):
                e.raw = {**a, "viewPoint": e.raw.get("viewPoint")}
            roles = {str(r).lower() for r in (a.get("viewPoint") or {}).get("roles") or []}
            e.roles.setdefault(acct.user_id, set()).update(roles)
            e.accounts.append((acct.id, acct.user_id))
            if roles:
                e.parties.add(acct.user_id)
    for e in entries.values():
        for oid in [_owner_oid(e.raw), *_approver_oids(e.raw)]:
            if oid in oids:
                e.parties.add(oids[oid])
    if people is not None:  # never more than the viewer may see
        entries = {k: e for k, e in entries.items() if e.parties & people}
    return Gathered(entries, len(accts), failed, oids)


# ---------------------------------------------------------------- rows


def source_of(a: dict[str, Any]) -> str:
    text = " ".join(str(a.get(k) or "") for k in ("displayName", "description"))
    if _FLOW.search(text):
        return "flow"  # Power Automate
    return hub.approval_source(a)


def _mine(e: Entry, v: Viewer, oids: dict[str, str]) -> tuple[bool, bool]:
    """(the viewer is an approver, the viewer asked for it)."""
    roles = e.roles.get(v.user_id, set())
    own = "owner" in roles or oids.get(_owner_oid(e.raw)) == v.user_id
    return "approver" in roles, own


def row(e: Entry, v: Viewer, oids: dict[str, str], names: dict[str, str]) -> dict[str, Any]:
    a = e.raw
    out = hub.approval_row(a)
    i_approve, i_own = _mine(e, v, oids)
    owner_uid = oids.get(_owner_oid(a))
    out.update(
        {
            "source": source_of(a),
            "i_approve": i_approve,
            "i_own": i_own,
            "waiting_for_me": i_approve and not i_own and out["state"] == "pending",
            "owner": out["owner"] or names.get(owner_uid or "", ""),
            "owner_user_id": owner_uid,
            "approvers": [
                {"name": _who(ap)["name"] or names.get(oids.get(_who(ap)["id"], ""), "")}
                for ap in a.get("approvers") or []
            ],
            "teams_link": TEAMS_APPROVALS_APP,
        }
    )
    return out


async def _names(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())


async def visible(db: AsyncSession, v: Viewer, *, fresh: bool = False) -> dict[str, Any]:
    """Every approval this viewer may see, newest first."""
    g = await gather(db, v, fresh=fresh)
    names = await _names(db, set(g.oids.values()))
    rows = [row(e, v, g.oids, names) for e in g.entries.values()]
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    mine = await _own_accounts(db, v)
    return {
        "items": rows,
        "view": v.view,
        "accounts": g.accounts,
        "failed": g.failed,
        "connected": bool(mine),
        "at": datetime.now(UTC).isoformat(),
    }


# ---------------------------------------------------------------- one approval


async def _own_accounts(db: AsyncSession, v: Viewer) -> list[MicrosoftAccount]:
    return await _accounts(db, v.workspace_id, {v.user_id})


def _not_found() -> ApprovalProblem:
    return ApprovalProblem(404, "not_found", Msg("That approval was not found."))


async def _read_one(
    db: AsyncSession, account_id: str, approval_id: str
) -> tuple[MicrosoftAccount, graph.Graph, dict[str, Any]] | None:
    acct = await db.get(MicrosoftAccount, account_id)
    if acct is None or acct.status not in access.USABLE_ACCOUNT:
        return None
    g = await graph.for_account(db, acct)
    try:
        item = await g.approval(approval_id)
    except MicrosoftError as e:
        if getattr(e, "status", 0) in (403, 404):
            return None
        raise
    if not item or str(item.get("id") or "") != approval_id:
        return None
    return acct, g, item


def _people(reqs: list[dict[str, Any]], resps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each approver with their answer (if any); answers from someone not asked come last."""
    answers: dict[str, dict[str, Any]] = {}
    for r in sorted(resps, key=lambda r: str(r.get("createdDateTime") or "")):
        who = _who(r.get("createdBy"))
        answers[who["id"] or who["name"]] = {
            "response": r.get("response") or "",
            "comment": r.get("comments") or "",
            "at": r.get("createdDateTime"),
            "name": who["name"],
        }
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for q in reqs:
        owner = (q or {}).get("owner") or {}
        who = _who(owner)
        k = who["id"] or who["name"]
        if k in seen:
            continue
        seen.add(k)
        got = answers.get(k) or {}
        out.append(
            {
                "name": who["name"],
                "group": bool(owner.get("group")),
                "reassigned": bool(q.get("isReassigned")),
                "asked_at": q.get("createdDateTime"),
                "response": got.get("response") or "",
                "comment": got.get("comment") or "",
                "answered_at": got.get("at"),
            }
        )
    for k, got in answers.items():
        if k not in seen:
            out.append(
                {
                    "name": got["name"],
                    "group": False,
                    "reassigned": False,
                    "asked_at": None,
                    "response": got["response"],
                    "comment": got["comment"],
                    "answered_at": got["at"],
                }
            )
    return out


async def detail(db: AsyncSession, v: Viewer, approval_id: str) -> dict[str, Any]:
    """One approval the viewer may see: its words, links, approvers and their answers."""
    g = await gather(db, v)
    if approval_id not in g.entries:  # made a moment ago: ask Microsoft once more
        g = await gather(db, v, fresh=True)
    e = g.entries.get(approval_id)
    if e is None:
        raise _not_found()
    # Read it through the viewer's own account first, else one of the accounts that showed it.
    order = sorted(e.accounts, key=lambda x: x[1] != v.user_id)
    got = None
    for account_id, _uid in order:
        try:
            got = await _read_one(db, account_id, approval_id)
        except MicrosoftError:
            got = None
        if got is not None:
            break
    if got is not None:
        acct, gr, item = got
        e.raw = {**_slim(item), "viewPoint": e.raw.get("viewPoint")}
        reqs: list[dict[str, Any]] = []
        resps: list[dict[str, Any]] = []
        with contextlib.suppress(MicrosoftError):
            reqs = await gr.approval_requests(approval_id)
        with contextlib.suppress(MicrosoftError):
            resps = await gr.approval_responses(approval_id)
    else:  # Microsoft did not answer now: what the list showed
        reqs, resps = [], []
    names = await _names(db, set(g.oids.values()))
    out = row(e, v, g.oids, names)
    people = _people(reqs, resps)
    my_oids = {o for o, uid in g.oids.items() if uid == v.user_id}
    answered = any(_who(r.get("createdBy"))["id"] in my_oids for r in resps)
    out.update(
        {
            "description": str(e.raw.get("description") or ""),
            "links": list(dict.fromkeys(_LINK.findall(str(e.raw.get("description") or "")))),
            "people": people or out["approvers"],
            "answered": answered,
            "can_answer": bool(out["waiting_for_me"] and not answered),
            "attachments_note": True,  # Graph returns no files: they open in Teams
            "prepared": [prepared_row(p) for p in await _prepared(db, v, approval_id=approval_id)],
        }
    )
    return out


# ---------------------------------------------------------------- answering


async def _answerable(
    db: AsyncSession, v: Viewer, approval_id: str, response: str, reason: str
) -> tuple[MicrosoftAccount, graph.Graph, dict[str, Any]]:
    """The viewer's own account in which they are asked to answer this approval, after every
    rule: a reason, not their own request, still waiting, one of its answers."""
    if len(reason.strip()) < MIN_REASON:
        raise ApprovalProblem(
            422, "reason_required", Msg("Give a reason for your answer (approve or reject).")
        )
    own_request = failed = False
    for acct in await _own_accounts(db, v):
        try:
            got = await _read_one(db, acct.id, approval_id)
        except MicrosoftError:  # another of their accounts may hold it
            failed = True
            continue
        if got is None:
            continue
        acct, g, item = got
        roles = {str(r).lower() for r in (item.get("viewPoint") or {}).get("roles") or []}
        owner = _owner_oid(item)
        if "owner" in roles or (owner and owner == acct.ms_user_id):
            own_request = True
            continue
        if "approver" not in roles:
            continue
        if str(item.get("state") or "").lower() != "pending":
            raise ApprovalProblem(
                409, "not_waiting", Msg("This approval is not waiting for an answer any more.")
            )
        options = hub.approval_row(item)["options"]
        if response not in options:
            raise ApprovalProblem(400, "bad_response", Msg("Pick one of the approval's answers."))
        return acct, g, item
    if own_request:
        raise ApprovalProblem(
            409, "own_request", Msg("You cannot answer your own request. Another approver does.")
        )
    if failed:
        raise ApprovalProblem(502, "microsoft_error", Msg("Microsoft did not answer. Try again."))
    raise ApprovalProblem(409, "not_yours", Msg("This approval is not waiting for your answer."))


async def respond(
    db: AsyncSession, v: Viewer, approval_id: str, response: str, reason: str, *, via: str = "page"
) -> dict[str, str]:
    """The viewer's own answer, sent now through their own Microsoft account."""
    acct, g, item = await _answerable(db, v, approval_id, response, reason)
    try:
        await g.respond_approval(approval_id, response, reason.strip())
    except MicrosoftError as e:
        raise ApprovalProblem(
            502, "microsoft_error", Msg("Microsoft did not take the answer. Try again.")
        ) from e
    await forget([a.id for a in await _own_accounts(db, v)])
    await audit.record(
        db,
        v.workspace_id,
        f"user:{v.user_id}",
        "m365.approval_answered",
        target=approval_id[:200],
        after={"response": response, "via": via},
    )
    await db.commit()
    return {"response": response, "title": str(item.get("displayName") or "")}


# ---------------------------------------------------------------- answers the AI prepared


def prepared_row(p: ApprovalAnswer) -> dict[str, Any]:
    return {
        "id": p.id,
        "approval_id": p.approval_id,
        "title": p.title,
        "response": p.response,
        "reason": p.reason,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


async def _prepared(
    db: AsyncSession, v: Viewer, *, approval_id: str | None = None
) -> list[ApprovalAnswer]:
    q = select(ApprovalAnswer).where(
        ApprovalAnswer.workspace_id == v.workspace_id,
        ApprovalAnswer.user_id == v.user_id,
        ApprovalAnswer.status == "pending",
    )
    if approval_id is not None:
        q = q.where(ApprovalAnswer.approval_id == approval_id)
    return list((await db.scalars(q.order_by(ApprovalAnswer.created_at.desc()))).all())


async def prepared(db: AsyncSession, v: Viewer) -> list[dict[str, Any]]:
    return [prepared_row(p) for p in await _prepared(db, v)]


async def prepare(
    db: AsyncSession,
    v: Viewer,
    agent: Agent | None,
    approval_id: str,
    response: str,
    reason: str,
) -> ApprovalAnswer:
    """An answer the person's own AI prepared: checked like a real one, sent only when the
    person presses Send. A newer one for the same approval replaces the older."""
    acct, _g, item = await _answerable(db, v, approval_id, response, reason)
    for old in await _prepared(db, v, approval_id=approval_id):
        old.status, old.decided_at = "discarded", datetime.now(UTC)
    title = str(item.get("displayName") or "")[:300]
    p = ApprovalAnswer(
        id=new_id("aa"),
        workspace_id=v.workspace_id,
        user_id=v.user_id,
        ms_account_id=acct.id,
        agent_id=agent.id if agent is not None else None,
        approval_id=approval_id[:200],
        title=title,
        response=response[:60],
        reason=reason.strip()[:2000],
    )
    db.add(p)
    await audit.record(
        db,
        v.workspace_id,
        f"agent:{agent.id}" if agent is not None else f"user:{v.user_id}",
        "m365.approval_answer_prepared",
        target=approval_id[:200],
        after={"response": response, "answer_id": p.id},
    )
    await db.commit()
    await _tell(db, v, p, agent)
    return p


async def _tell(db: AsyncSession, v: Viewer, p: ApprovalAnswer, agent: Agent | None) -> None:
    from ..channels import deliver

    with contextlib.suppress(Exception):  # a notice that fails never loses the answer
        ids = await deliver.notify_user(
            db,
            v.workspace_id,
            v.user_id,
            Msg("{name} prepared an approval answer", name=agent.name if agent else ""),
            Msg(
                "{answer}: {title}\n\nNothing is sent until you press Send.",
                answer=p.response,
                title=p.title,
            ),
            f"/mail?app=approvals&approval={p.approval_id}",
            dedupe=f"approval-answer:{p.id}",
        )
        await deliver.start(ids)


async def _own_prepared(db: AsyncSession, v: Viewer, answer_id: str) -> ApprovalAnswer:
    p = await db.get(ApprovalAnswer, answer_id)
    if p is None or p.workspace_id != v.workspace_id or p.user_id != v.user_id:
        raise ApprovalProblem(404, "not_found", Msg("That prepared answer was not found."))
    if p.status != "pending":
        raise ApprovalProblem(409, "already_done", Msg("That prepared answer was already used."))
    return p


async def send_prepared(
    db: AsyncSession, v: Viewer, answer_id: str, reason: str | None = None
) -> dict[str, str]:
    """The person pressed Send on an answer their AI prepared (they may change the reason)."""
    p = await _own_prepared(db, v, answer_id)
    if reason is not None and reason.strip():
        p.reason = reason.strip()[:2000]
    try:
        out = await respond(db, v, p.approval_id, p.response, p.reason, via="prepared")
    except ApprovalProblem as e:
        if e.code in ("not_waiting", "not_yours", "own_request", "not_found"):
            p.status, p.error, p.decided_at = "failed", str(e.message)[:500], datetime.now(UTC)
            await db.commit()
        raise
    p.status, p.decided_at = "sent", datetime.now(UTC)
    await db.commit()
    return out


async def discard_prepared(db: AsyncSession, v: Viewer, answer_id: str) -> None:
    p = await _own_prepared(db, v, answer_id)
    p.status, p.decided_at = "discarded", datetime.now(UTC)
    await audit.record(
        db,
        v.workspace_id,
        f"user:{v.user_id}",
        "m365.approval_answer_discarded",
        target=p.approval_id[:200],
    )
    await db.commit()
