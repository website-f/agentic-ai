"""P125: IT support's changes wait for an owner, the developer or a global admin.

The owner (23 Nov 2026): "IT support can do most of what admins do: Organization and Members,
add members, set the hierarchy, give access (including any Prima modules). But whatever IT
support does, an owner, the developer or a global admin must approve it first; it shows on the
Approvals page with what they want approved, and only once approved does it take effect."

How it works:
- ONE place holds them: api/held_guard.py, an ASGI middleware in front of every route. For a
  signed-in IT support person, every POST / PUT / PATCH / DELETE under HELD_PREFIXES below
  (minus the few in NOT_HELD) is saved here instead of run, and answers 202
  {"held": true, "request_id", "summary"}. A new route under those prefixes is held without
  anyone remembering to (tests/test_p125_it_support.py walks the app's routes to prove it).
- What is saved is exactly what they sent (method, path, query, body); nothing about it can be
  edited afterwards, only cancelled by them, approved or declined (always with a reason) by an
  owner or global admin who is not them, or left to expire after EXPIRY_DAYS.
- Approving runs the same call again, in this process, with the APPROVER's own sign-in (their
  cookie or app token and CSRF header): their permissions decide, the audit trail names them,
  and the member rules also apply IT support's (core/security.acting_for: no owner, global
  admin or IT support role given or touched). The row is claimed first (pending -> applying in
  one UPDATE), so two approvals never run it twice. If the run fails (a check, a conflict, a
  permission), the request stays open with "Could not be applied: <why>" for a retry or a
  decline. The run's answer goes to the approver only (a new member's one-time password is
  never stored here).
- Before saving, and again before approving: IT support may not touch their own account, nor
  anyone who is an owner, global admin or IT support, nor give those roles.
"""

import json
import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.security import APPROVER_ROLES, HELD_ROLE, HIGH_ROLES
from ..i18n import Msg, Plain
from ..i18n.labels import role_label
from ..models import Branch, Department, Membership, User
from ..services import audit
from .held_models import HeldChange

log = logging.getLogger(__name__)

UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})
MAX_BODY = 2 * 1024 * 1024
EXPIRY_DAYS = 7
MAX_OPEN_PER_PERSON = 50
MIN_REASON = 3
MAX_NOTE = 1000
STALE_APPLYING = timedelta(minutes=10)

# The admin areas: (path prefix, the permission IT support needs to ask for a change there).
# A path is in an area when it IS the prefix or continues it with "/". Every state-changing
# call there by IT support is held, except NOT_HELD below.
HELD_PREFIXES: tuple[tuple[str, str], ...] = (
    # Members and invitations: add, change (role, place, manager, heads, access, Prima access
    # and modules, Library scope, branches), remove, bulk actions, imports, password and
    # Microsoft resets, emailed sign-in passwords, who reports to a manager.
    ("/api/members", "members.manage"),
    ("/api/prima-members", "members.manage"),  # a Prima person added as a member
    ("/api/prima/people", "org.manage"),  # office people linked to Prima records
    ("/api/prima/companies", "org.manage"),  # companies mapped to Prima's
    # Organization: companies (branches), departments, starter teams, review rules, the
    # office's computers, proxies and web connections, role access.
    ("/api/branches", "org.manage"),
    ("/api/departments", "org.manage"),
    ("/api/org", "org.manage"),
    # AI allowance and work scope, and other workspace-wide settings.
    ("/api/allowances", "members.manage"),
    ("/api/work-scope", "members.manage"),
    ("/api/routines/settings", "members.manage"),
    ("/api/minutes/settings", "org.manage"),
    # Security: the two-step sign-in rule, and resetting someone's two-step sign-in.
    ("/api/auth/2fa/policy", "members.manage"),
    ("/api/auth/2fa/members", "members.manage"),
    # Approved services (the compliance lock).
    ("/api/compliance", "org.manage"),
    # Integrations and channels: the Microsoft and Google apps and options, shared mailboxes,
    # Telegram / WhatsApp channels and their bindings, API tokens.
    ("/api/integrations/microsoft", "channels.manage"),
    ("/api/integrations/google", "channels.manage"),
    ("/api/channels", "channels.manage"),
    ("/api/tokens", "channels.manage"),
    # The AI engine (providers, keys, models, groups, privacy), file storage, MCP tools.
    ("/api/ai", "engine.manage"),
    ("/api/ai-engine", "engine.manage"),
    ("/api/storage", "storage.manage"),
    ("/api/mcp-servers", "mcp.manage"),
)

# Calls under those prefixes that are NOT held, each with why (full match on the path).
NOT_HELD: tuple[tuple[str, str], ...] = (
    # Their own sign-ins and links, not the office's settings.
    (r"/api/integrations/microsoft/(connect|account|account/prefs|accounts/[^/]+)", "own"),
    (r"/api/integrations/google/(connect|account)", "own"),
    (r"/api/channels/[^/]+/link-code", "own"),
    (r"/api/channels/links/[^/]+", "own"),
    (r"/api/channels/[^/]+/whatsapp/test", "own"),  # a test message to their own WhatsApp
    # Graph's webhook: never signed in.
    (r"/api/integrations/microsoft/notify", "webhook"),
    # Checks that save nothing (reading a sheet, testing a key or a connection).
    (r"/api/members/import/(preview|check)", "check"),
    (r"/api/ai/(playground|privacy/preview|providers/test|providers/discover)", "check"),
    (r"/api/ai-engine/privacy/preview", "check"),
    (r"/api/integrations/microsoft/mailboxes/[^/]+/test", "check"),
    (r"/api/storage/[^/]+/check", "check"),
    (r"/api/org/(proxies/test|web/check|web/ask)", "check"),
    # Owner only: the route refuses everyone else (IT support included) itself.
    (r"/api/org/role-access", "owner"),
    # P127 "Sync with Prima": applies no choice of its own, only aligns reporting lines already
    # applied in the office or in Prima (prima/org_sync.py).
    (r"/api/org-chart/prima-sync", "sync"),
)
_NOT_HELD = tuple(re.compile(rx) for rx, _ in NOT_HELD)


def normal_path(path: str) -> str:
    p = re.sub(r"/{2,}", "/", path or "/")
    return p.rstrip("/") or "/"


def area_of(method: str, path: str) -> str | None:
    """The permission IT support needs to ask for this change, or None: not held."""
    if method.upper() not in UNSAFE:
        return None
    p = normal_path(path)
    if any(rx.fullmatch(p) for rx in _NOT_HELD):
        return None
    for prefix, perm in HELD_PREFIXES:
        if p == prefix or p.startswith(prefix + "/"):
            return perm
    return None


class HoldError(Exception):
    def __init__(self, status: int, code: str, message: str, **vars: Any) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.vars = status, code, message, vars

    def msg(self) -> Msg:
        return Msg(self.message, **self.vars)


# ---------------------------------------------------------------- text kept in the row


def enc(text: Any) -> Any:
    """A Msg (with Msg vars: role labels) as JSON, to render later in the reader's language."""
    if isinstance(text, Msg):
        return {
            "t": text.template,
            "v": {k: enc(v) if isinstance(v, Msg) else str(v) for k, v in text.vars.items()},
        }
    return {"p": str(text)}


def dec(data: Any) -> Msg | str:
    if not isinstance(data, dict):
        return Plain(str(data or ""))
    if "t" in data:
        vars_ = {
            k: dec(v) if isinstance(v, dict) else Plain(str(v))
            for k, v in (data.get("v") or {}).items()
        }
        return Msg(str(data["t"]), **vars_)
    return Plain(str(data.get("p", "")))


def _join(parts: list[Any]) -> Msg:
    """Several pieces in one sentence ("a, b, c"), each still translatable."""
    keys = [f"p{i}" for i in range(len(parts))]
    return Msg(", ".join("{" + k + "}" for k in keys), **dict(zip(keys, parts, strict=True)))


def _names_list(names: list[str], limit: int = 6) -> str:
    shown = [n for n in names if n][:limit]
    more = len(names) - len(shown)
    return ", ".join(shown) + (f" +{more}" if more > 0 else "")


# ---------------------------------------------------------------- who and what it is about


class _Names:
    def __init__(self) -> None:
        self.people: dict[str, str] = {}
        self.roles: dict[str, str] = {}
        self.branches: dict[str, str] = {}
        self.depts: dict[str, str] = {}

    async def load(self, db: AsyncSession, ws: str, ids: Iterable[str]) -> "_Names":
        ids = sorted({i for i in ids if isinstance(i, str) and 0 < len(i) <= 40})
        if not ids:
            return self
        for uid, name, email, role in (
            await db.execute(
                select(User.id, User.name, User.email, Membership.role)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.workspace_id == ws, User.id.in_(ids))
            )
        ).all():
            self.people[uid] = name or email
            self.roles[uid] = role
        self.branches.update(
            (
                await db.execute(
                    select(Branch.id, Branch.name).where(
                        Branch.workspace_id == ws, Branch.id.in_(ids)
                    )
                )
            ).all()
        )
        self.depts.update(
            (
                await db.execute(
                    select(Department.id, Department.name).where(
                        Department.workspace_id == ws, Department.id.in_(ids)
                    )
                )
            ).all()
        )
        return self

    def of(self, i: Any) -> str:
        s = str(i)
        return self.people.get(s) or self.branches.get(s) or self.depts.get(s) or s


def _ids_in(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        out += [v for v in value if isinstance(v, str)]
    elif isinstance(value, dict):
        for v in value.values():
            out += _ids_in(v)
    return out


def _segments(path: str) -> list[str]:
    return [s for s in normal_path(path).split("/") if s]


def targets(path: str, body: Any) -> list[str]:
    """The people a change is about: an id in the path, and user_id / user_ids in the body
    (not a manager or a member of a list a manager gets: those are about someone else)."""
    ids = list(_segments(path))
    if isinstance(body, dict):
        for k in ("user_id", "user_ids"):
            ids += _ids_in(body.get(k))
    return ids


def _roles_given(body: Any) -> set[str]:
    """Every "role" value anywhere in the body (a member, a bulk action, import rows)."""
    found: set[str] = set()
    if isinstance(body, dict):
        for k, v in body.items():
            if k == "role" and isinstance(v, str):
                found.add(v.strip().lower())
            else:
                found |= _roles_given(v)
    elif isinstance(body, list):
        for v in body:
            found |= _roles_given(v)
    return found


async def precheck(db: AsyncSession, ws: str, requester: str, path: str, body: Any) -> _Names:
    """IT support never changes their own account, anyone in a high role, or gives one. Run
    when the change is held and again before it is approved (roles may have changed)."""
    names = await _Names().load(db, ws, [*targets(path, body), *_ids_in(body)])
    touched = [i for i in targets(path, body) if i in names.roles]
    if requester in touched:
        raise HoldError(
            403,
            "own_account",
            "IT support cannot change their own account. Ask an owner or a global admin.",
        )
    if any(names.roles[i] in HIGH_ROLES for i in touched):
        raise HoldError(
            403,
            "high_role",
            "IT support cannot change an owner, a global admin or another IT support person.",
        )
    if _roles_given(body) & HIGH_ROLES:
        raise HoldError(
            403,
            "high_role",
            "IT support cannot give the owner, global admin or IT support role.",
        )
    return names


# ---------------------------------------------------------------- the summary


_SECRET = re.compile(r"password|secret|(^|_)key$|(^|_)token$|(^|_)code$", re.I)
_ID_KEYS = re.compile(r"(^|_)(id|ids|user|users|manager|branch|branches|department|head_of)$")


def _value(key: str, v: Any, names: _Names) -> Any:
    if _SECRET.search(key):
        return "••••"
    if key == "role" and isinstance(v, str):
        return role_label(v)
    if v is None:
        return Msg("(none)")
    if isinstance(v, bool):
        return Msg("yes") if v else Msg("no")
    if isinstance(v, list):
        if all(isinstance(x, str) for x in v):
            shown = [names.of(x) if _ID_KEYS.search(key) else x for x in v]
            return _names_list(shown, 12) if shown else Msg("(none)")
        return Plain(json.dumps(v, ensure_ascii=False)[:300])
    if isinstance(v, dict):
        return Plain(json.dumps(v, ensure_ascii=False)[:300])
    if isinstance(v, str) and _ID_KEYS.search(key):
        return names.of(v)
    return str(v)[:300]


def details_of(body: Any, names: _Names) -> list[dict[str, Any]]:
    if isinstance(body, dict):
        out = []
        for k, v in list(body.items())[:40]:
            if k == "rows" and isinstance(v, list):  # an import: one line per person
                for i, row in enumerate(v[:200], 1):
                    if isinstance(row, dict):
                        who = f"{row.get('name') or ''} <{row.get('email') or ''}>".strip()
                        role = row.get("role")
                        val: Any = (
                            Msg("{who} as {role}", who=who, role=role_label(role))
                            if isinstance(role, str) and role
                            else who
                        )
                        out.append({"field": f"{i}", "value": enc(val)})
                continue
            out.append({"field": str(k)[:60], "value": enc(_value(str(k), v, names))})
        return out
    if body is None:
        return []
    return [{"field": "body", "value": enc(Plain(str(body)[:300]))}]


def _person(path_id: str, names: _Names) -> str:
    return names.people.get(path_id) or path_id


def summarize(method: str, path: str, body: Any, names: _Names) -> Msg:
    """One readable line for the common changes; else what is changed and its fields."""
    seg = _segments(path)[1:]  # without "api"
    b = body if isinstance(body, dict) else {}
    m = method.upper()
    head = seg[0] if seg else ""
    if head == "members":
        rest = seg[1:]
        if not rest and m == "POST":
            return Msg(
                "Add member {name} ({email}) as {role}",
                name=Plain(str(b.get("name") or "")),
                email=Plain(str(b.get("email") or "")),
                role=role_label(str(b.get("role") or "")),
            )
        if rest == ["bulk"]:
            who = Plain(_names_list([names.of(u) for u in b.get("user_ids") or []]))
            n = len(b.get("user_ids") or [])
            action = b.get("action")
            if action == "remove":
                return Msg("Remove {n} members: {names}", n=n, names=who)
            if action == "access":
                return Msg(
                    "Change {n} members to {role}: {names}",
                    n=n,
                    role=role_label(str(b.get("role") or "")),
                    names=who,
                )
            if action == "manager":
                if b.get("manager_id"):
                    return Msg(
                        "Make {n} members report to {manager}: {names}",
                        n=n,
                        manager=Plain(names.of(b["manager_id"])),
                        names=who,
                    )
                return Msg("Make {n} members report to no one: {names}", n=n, names=who)
            return Msg("Change the Prima access of {n} members: {names}", n=n, names=who)
        if rest == ["import"]:
            rows = [r for r in b.get("rows") or [] if isinstance(r, dict)]
            return Msg(
                "Add {n} members from a sheet: {names}",
                n=len(rows),
                names=Plain(
                    _names_list([str(r.get("name") or r.get("email") or "") for r in rows])
                ),
            )
        if rest == ["import", "companies"]:
            got = [str(x) for x in b.get("names") or []]
            return Msg("Add {n} companies: {names}", n=len(got), names=Plain(_names_list(got)))
        if rest == ["signin-emails", "bulk"]:
            n = len(b.get("user_ids") or [])
            return Msg("Email sign-in passwords to {n} members", n=n)
        if rest:
            who = Plain(_person(rest[0], names))
            action = "/".join(rest[1:])
            if m == "DELETE" and not action:
                return Msg("Remove {name} from the office", name=who)
            if action == "reset-password":
                return Msg("Reset {name}'s password", name=who)
            if action == "reset-microsoft":
                return Msg("Reset {name}'s Microsoft sign-in", name=who)
            if action == "email-signin":
                return Msg("Email {name} a sign-in password", name=who)
            if action == "team":
                n = len(b.get("user_ids") or [])
                return Msg("Set the {n} people who report to {name}", n=n, name=who)
            if action == "library":
                return Msg("Change what {name} reads in the Library", name=who)
            if action == "prima-access":
                return Msg("Change {name}'s access and Prima modules", name=who)
            if not action and m == "PATCH":
                parts: list[Any] = []
                if b.get("role"):
                    parts.append(Msg("role to {role}", role=role_label(str(b["role"]))))
                if "reports_to_user_id" in b:
                    boss = b.get("reports_to_user_id")
                    parts.append(
                        Msg("manager to {manager}", manager=Plain(names.of(boss)))
                        if boss
                        else Msg("no manager")
                    )
                if "head_of" in b or "heads_department" in b:
                    parts.append(Msg("the departments they head"))
                if "access" in b or "prima_modules" in b or "prima_department" in b:
                    parts.append(Msg("access and Prima modules"))
                if any(k in b for k in ("branch_id", "department_id", "branch_ids")):
                    parts.append(Msg("company and department"))
                if "name" in b or "email" in b:
                    parts.append(Msg("name or email"))
                if "job_title" in b:
                    parts.append(Msg("job title"))
                if parts:
                    return Msg("Change {name}: {what}", name=who, what=_join(parts))
    if head == "branches":
        if len(seg) == 1 and m == "POST":
            return Msg("Add the company {name}", name=Plain(str(b.get("name") or "")))
        if len(seg) >= 2:
            branch = Plain(names.of(seg[1]))
            if len(seg) == 2 and m == "DELETE":
                return Msg("Delete the company {branch}", branch=branch)
            if len(seg) == 2 and b.get("name"):
                return Msg(
                    "Rename the company {branch} to {name}", branch=branch, name=Plain(b["name"])
                )
            if len(seg) == 2:
                return Msg("Change the company {branch}", branch=branch)
            if seg[2:] == ["departments"]:
                return Msg(
                    "Add the department {name} to {branch}",
                    name=Plain(str(b.get("name") or "")),
                    branch=branch,
                )
            if seg[2:] == ["starter-team"]:
                return Msg("Add the starter team to {branch}", branch=branch)
    if head == "departments" and len(seg) >= 2:
        dept = Plain(names.of(seg[1]))
        if len(seg) == 2 and m == "DELETE":
            return Msg("Delete the department {dept}", dept=dept)
        if len(seg) == 2 and b.get("name"):
            return Msg("Rename the department {dept} to {name}", dept=dept, name=Plain(b["name"]))
        if len(seg) == 2:
            return Msg("Change the department {dept}", dept=dept)
    if head == "allowances" and len(seg) >= 2:
        if seg[1] == "policy":
            return Msg("Change the AI allowance rules")
        who = Plain(_person(seg[1], names))
        if seg[2:] == ["give"]:
            return Msg("Give {name} more AI allowance", name=who)
        return Msg("Change {name}'s AI allowance", name=who)
    if head == "work-scope":
        return Msg("Change the work scope rule")
    if head == "auth" and seg[1:3] == ["2fa", "policy"]:
        return Msg(
            "Change the two-step sign-in rule to {policy}",
            policy=Plain(str(b.get("policy") or "")),
        )
    if head == "auth" and seg[1:3] == ["2fa", "members"] and len(seg) >= 4:
        return Msg("Reset {name}'s two-step sign-in", name=Plain(_person(seg[3], names)))
    if head == "prima" and seg[1:2] == ["people"]:
        return Msg("Link office people to their Prima records")
    fields = ", ".join(list(b)[:12]) if b else ""
    where = Plain("/" + "/".join(seg))
    verb = {"DELETE": Msg("Delete"), "POST": Msg("Add or run")}.get(m, Msg("Change"))
    if fields:
        return Msg("{verb} {path} ({fields})", verb=verb, path=where, fields=Plain(fields))
    return Msg("{verb} {path}", verb=verb, path=where)


# ---------------------------------------------------------------- saving one


def parse_body(content_type: str, raw: bytes) -> tuple[Any | None, bytes | None]:
    """(JSON, None) for a JSON body; (None, bytes) for anything else (an upload)."""
    if content_type.lower().startswith("application/json"):
        try:
            return (json.loads(raw.decode("utf-8")) if raw.strip() else {}), None
        except (UnicodeDecodeError, ValueError):
            return None, raw
    return None, (raw or None)


async def hold(
    db: AsyncSession,
    principal: Any,
    method: str,
    path: str,
    query: str,
    content_type: str,
    raw: bytes,
) -> HeldChange:
    """Save the call for approval; the caller commits (and then tells the approvers)."""
    body_json, body_raw = parse_body(content_type, raw)
    open_now = await db.scalar(
        select(HeldChange.id)
        .where(
            HeldChange.workspace_id == principal.workspace_id,
            HeldChange.requested_by == principal.user.id,
            HeldChange.status == "pending",
        )
        .offset(MAX_OPEN_PER_PERSON - 1)
        .limit(1)
    )
    if open_now is not None:
        raise HoldError(
            429,
            "too_many_requests",
            "You have {n} changes waiting already. Wait for an answer, or cancel one.",
            n=MAX_OPEN_PER_PERSON,
        )
    names = await precheck(db, principal.workspace_id, principal.user.id, path, body_json)
    text = summarize(method, path, body_json, names)
    now = datetime.now(UTC)
    row = HeldChange(
        workspace_id=principal.workspace_id,
        requested_by=principal.user.id,
        requested_role=principal.role,
        method=method.upper(),
        path=normal_path(path)[:500],
        query=query[:4000],
        content_type=content_type[:200],
        body_json=body_json,
        body_raw=body_raw,
        title=str(text)[:300],
        summary=enc(text),
        details=details_of(body_json, names),
        status="pending",
        created_at=now,
        expires_at=now + timedelta(days=EXPIRY_DAYS),
    )
    db.add(row)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "held_change.asked",
        target=row.id,
        after={"method": row.method, "path": row.path, "summary": row.title},
    )
    return row


# ---------------------------------------------------------------- deciding


def is_approver(principal: Any) -> bool:
    return principal.role in APPROVER_ROLES


async def expire_due(db: AsyncSession, workspace_id: str) -> None:
    """Pending changes past their 7 days expire (their saved body goes)."""
    await db.execute(
        update(HeldChange)
        .where(
            HeldChange.workspace_id == workspace_id,
            HeldChange.status == "pending",
            HeldChange.expires_at <= datetime.now(UTC),
        )
        .values(status="expired", body_json=None, body_raw=None)
    )


def clean_reason(text: str | None) -> str:
    reason = " ".join((text or "").split())[:MAX_NOTE]
    if len(reason) < MIN_REASON:
        raise HoldError(422, "reason_needed", "Write a short reason for your decision.")
    return reason


def check_decider(principal: Any, row: HeldChange) -> None:
    if row.requested_by == principal.user.id:
        raise HoldError(403, "own_request", "You cannot decide your own request.")
    if not is_approver(principal):
        raise HoldError(
            403,
            "not_approver",
            "Only an owner, the developer or a global admin approves IT support's changes.",
        )


def stale(row: HeldChange) -> bool:
    """A run that never finished (the server stopped mid-way): it may be declined."""
    started = row.decided_at or row.created_at
    return row.status == "applying" and datetime.now(UTC) - started > STALE_APPLYING


async def claim(db: AsyncSession, principal: Any, row: HeldChange) -> bool:
    """pending -> applying in one UPDATE: only one approval ever runs it. Commits."""
    res = await db.execute(
        update(HeldChange)
        .where(
            HeldChange.id == row.id,
            HeldChange.status == "pending",
            HeldChange.expires_at > datetime.now(UTC),
        )
        .values(
            status="applying",
            attempts=HeldChange.attempts + 1,
            decided_by=principal.user.id,
            decided_at=datetime.now(UTC),
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(res.rowcount)  # type: ignore[attr-defined]


def failure_text(status: int, data: Any) -> str:
    if isinstance(data, dict):
        msg = str(data.get("message") or data.get("detail") or "")
        fields = data.get("fields")
        if isinstance(fields, dict) and fields:
            msg = (msg + " " + "; ".join(f"{k}: {v}" for k, v in fields.items())).strip()
        if msg:
            return msg[:1000]
    return f"HTTP {status}"


def safe_result(data: Any) -> dict[str, Any]:
    """What the row keeps of a successful run: never the answer itself."""
    if isinstance(data, dict):
        return {"keys": sorted(str(k) for k in data)[:20]}
    return {}


def final(row: HeldChange) -> None:
    """Decided for good: what was sent is not kept (a key, a body)."""
    row.body_json = None
    row.body_raw = None


async def requester_role_now(db: AsyncSession, row: HeldChange) -> str | None:
    return await db.scalar(
        select(Membership.role).where(
            Membership.workspace_id == row.workspace_id, Membership.user_id == row.requested_by
        )
    )


async def tell(
    db: AsyncSession, row: HeldChange, user_ids: list[str], title: Msg, body: Msg
) -> None:
    from ..channels import deliver  # late: channels import agent modules

    for uid in user_ids:
        try:
            ids = await deliver.notify_user(
                db,
                row.workspace_id,
                uid,
                title,
                body,
                f"/approvals?tab=it&change={row.id}",
                dedupe=f"held:{row.id}:{row.status}:{uid}",
            )
            await deliver.start(ids)
        except Exception:  # noqa: BLE001 - a notice must never break the change
            log.warning("could not tell %s about held change %s", uid, row.id, exc_info=True)


async def approvers(db: AsyncSession, workspace_id: str, but: str) -> list[str]:
    return sorted(
        (
            await db.scalars(
                select(Membership.user_id)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.workspace_id == workspace_id,
                    Membership.role.in_(sorted(APPROVER_ROLES)),
                    User.is_active.is_(True),
                    Membership.user_id != but,
                )
            )
        ).all()
    )


__all__ = [
    "HELD_PREFIXES",
    "HELD_ROLE",
    "NOT_HELD",
    "HoldError",
    "area_of",
    "hold",
]
