"""P111: every organization added in the office exists in Prima too (Fitri, 17 Nov 2026: "what
organization added in agentic must exist in prima as well since its correlated").

When an organization (a branch) is added in the office, or the owner presses "Add to Prima" on
the Organization page, the office:
1. links it to the Prima company of the same name, when Prima has exactly one (its name or one
   of its other names, case and spacing ignored), and saves that in the workspace's
   "prima_companies" map (client.COMPANIES_KEY), the same map the owner sets on the Prima page;
2. else asks Prima to add the company through Prima's own route (POST /api/companies, Part N4:
   only the CEO adds a company, with its SSM number, primary state, the source document and a
   reason, as a draft the Deputy Chief of Staff checks against SSM), signed as the acting owner
   or admin, who opens Prima as its CEO record (client.opens_as_top). The name goes in capitals.
   Prima's SSM details are never invented: without them the organization stays "not linked"
   with the reason, and the owner adds them from the Organization page.

Prima adds the company at once (a draft is a record to check, not an approval to wait for), so
there is no waiting state. A company the office added is invisible to Prima's company list for
the office until Prima gives someone a grant on it (Prima shows each person the companies they
hold a grant for); the office remembers the companies it added (STATE_KEY) so the link holds.

A rename follows to Prima (Prima's company record, records/company, as the CEO record) only when
the Prima company is this organization by name (its name was the old name); a unit linked to a
central employer ("UNIT HR" is PWVSB) is never renamed in Prima, and a change of case only is
not a rename. Prima refuses a record without a valid SSM number; the organization then shows
"name differs in Prima" with Prima's reason and a retry. Nothing here deletes a Prima company.

Every outcome is saved per branch in workspace settings (STATE_KEY) for the Organization page,
and audited. Existing organizations: `python -m agentic.prima.org_link_all`.
"""

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..i18n import Msg, render
from ..models import Branch, Membership, Workspace
from ..org.names import org_key, org_name, same_org
from ..services import audit
from . import client
from .client import Company, PrimaError
from .people import name_key

# Workspace settings key: {branch id: {"state", "code", "message", "company_id", "made",
# "prima_name", "at"}}.
STATE_KEY = "prima_company_links"
# Tests that check the company map set by hand switch this off (test_p66 prima_on).
on = True

LINKED, NOT_LINKED, NAME_DIFFERS = "linked", "not_linked", "name_differs"
# Outcomes of link(): what happened (or, dry, would happen).
OUTCOMES = (
    "already", "matched", "made", "details_needed", "ambiguous", "not_ceo", "refused",
    "prima_down",
)  # fmt: skip
# Words that do not make a company code ("ARENA WIRAJAYA SDN BHD" is AW, as Prima's own codes).
_CODE_NOISE = {"SDN", "BHD", "BERHAD", "SENDIRIAN", "AND", "&", "DAN", "THE", "(M)", "M"}


@dataclass(frozen=True)
class Details:
    """What Prima needs to add a company (Part N4), typed by the owner from the SSM profile."""

    ssm_no: str
    state: str
    source_ref: str
    reason: str
    code: str = ""
    head_of_company: str = ""


def company_code(name: str) -> str:
    """A short code from the name's initials, as Prima's own: capitals and digits, 2-12."""
    words = [w for w in org_name(name).split() if w not in _CODE_NOISE]
    code = "".join(w[0] if w[0].isalpha() else re.sub(r"[^A-Z0-9]", "", w) for w in words)
    code = re.sub(r"[^A-Z0-9]", "", code)[:12]
    if len(code) < 2:
        code = re.sub(r"[^A-Z0-9]", "", org_name(name))[:12]
    return code if len(code) >= 2 else "CO"


def states(ws: Workspace | None) -> dict[str, dict]:
    raw = ((ws.settings if ws else None) or {}).get(STATE_KEY) or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): v for k, v in raw.items() if isinstance(v, dict)}


def made_companies(ws: Workspace | None) -> dict[str, str]:
    """{Prima company id: name} of the companies the office added to Prima."""
    return {
        str(s["company_id"]): str(s.get("prima_name") or s["company_id"])
        for s in states(ws).values()
        if s.get("made") and s.get("company_id")
    }


def matches(name: str, companies: list[Company]) -> list[Company]:
    """Prima's companies called exactly this (their name or another name; case, spacing and
    punctuation ignored)."""
    key = name_key(name)
    return [c for c in companies if key and key in {name_key(n) for n in (c.name, *c.aliases)}]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


async def _save(
    db: AsyncSession, ws_id: str, branch_id: str, state: dict, company_id: str | None = None
) -> None:
    """Save this branch's link state (and its Prima company in the map); the caller commits."""
    ws = await db.get(Workspace, ws_id, populate_existing=True)
    assert ws is not None
    settings = dict(ws.settings or {})
    all_states = states(ws)
    all_states[branch_id] = {**state, "at": _now()}
    settings[STATE_KEY] = all_states
    if company_id:
        settings[client.COMPANIES_KEY] = {**client.company_map(ws), branch_id: company_id}
    ws.settings = settings
    flag_modified(ws, "settings")


def _message(ans: client.Answer) -> str:
    """Prima's own reason for a refusal (its error shape is {message})."""
    try:
        data = ans.json()
    except ValueError:
        return ""
    msg = data.get("message") if isinstance(data, dict) else None
    if isinstance(msg, list):
        msg = "; ".join(str(m) for m in msg)
    return str(msg or "")[:500]


async def _as_ceo(
    db: AsyncSession, ws_id: str, user_id: str, method: str, url: str, body: bytes = b""
) -> client.Answer:
    """Ask Prima as its CEO record, for this owner or admin (they open Prima as it, P82/P109).
    Anyone else is refused here; Prima applies its own rules (only the CEO adds a company)."""
    m = await db.get(Membership, (ws_id, user_id))
    if m is None or not client.opens_as_top(m):
        raise PrimaError(
            403,
            Msg(
                "Only an owner or admin adds companies to Prima (Prima opens for them as the CEO)."
            ),
            code="not_ceo",
        )
    top = await client.top_record()
    if top is None:
        raise PrimaError(403, Msg("Prima has no CEO record to add the company."), code="not_ceo")
    ans = await client._send(method, url, top.id, "person", body, "")
    if method == "POST":
        # As client.call: several people share the CEO record, so the office's log names them.
        await audit.record(
            db,
            ws_id,
            f"user:{user_id}",
            "prima.recorded",
            target=top.id,
            after={"path": url.split("?", 1)[0], "via": "person", "status": ans.status},
        )
    return ans


async def link(
    db: AsyncSession,
    ws_id: str,
    branch: Branch,
    *,
    actor: str,
    actor_user_id: str | None = None,
    details: Details | None = None,
    found: list[Company] | None = None,
    dry: bool = False,
) -> str:
    """Link this organization to its Prima company, adding it to Prima when the details are
    given; what happened (OUTCOMES). Saves the state and commits unless dry; never raises a
    PrimaError (the refusal is the state)."""
    bid, name = branch.id, org_name(branch.name)  # kept: a rollback expires the branch
    ws = await db.get(Workspace, ws_id)
    if client.company_map(ws).get(bid):
        return "already"
    try:
        if found is None:
            found = await client.companies()
        made = made_companies(ws)
        listed = {c.id for c in found}
        known = [*found, *(Company(id=i, name=n) for i, n in made.items() if i not in listed)]
        hit = matches(name, known)
        if len(hit) == 1:
            if not dry:
                c = hit[0]
                await _save(
                    db, ws_id, bid,
                    {"state": LINKED, "code": "matched", "message": "", "company_id": c.id,
                     "made": c.id in made, "prima_name": c.name},
                    company_id=c.id,
                )  # fmt: skip
                await audit.record(
                    db, ws_id, actor, "prima.company.linked", target=bid,
                    after={"company": c.id}, note=f"{name} linked to Prima company {c.name}",
                )  # fmt: skip
                await db.commit()
            return "matched"
        if hit:
            msg = Msg(
                "More than one Prima company is called {name}. Pick the right one on the Prima "
                "page.",
                name=name,
            )
            return await _not_linked(db, ws_id, bid, "ambiguous", msg, dry)
        if details is None:
            msg = Msg(
                "Prima has no company called {name} yet. Add it to Prima with its SSM details, or "
                "link it to a Prima company on the Prima page.",
                name=name,
            )
            return await _not_linked(db, ws_id, bid, "details_needed", msg, dry)
        if dry:
            return "made"
        if not actor_user_id:
            raise PrimaError(
                403, Msg("Prima has no CEO record to add the company."), code="not_ceo"
            )
        payload = {
            "code": (details.code or company_code(name)).upper(),
            "name": name,
            "ssmNo": details.ssm_no,
            "state": details.state,
            "sourceRef": details.source_ref,
            "reason": details.reason,
        }
        if details.head_of_company:
            payload["headOfCompany"] = details.head_of_company
        body = json.dumps(payload, separators=(",", ":")).encode()
        ans = await _as_ceo(db, ws_id, actor_user_id, "POST", "/api/companies", body)
        data = ans.json() if ans.status in (200, 201) else None
        cid = str(data.get("id") or "") if isinstance(data, dict) else ""
        if not cid:
            why = _message(ans) if ans.status < 500 else ""
            if ans.status >= 500 or not why:
                raise PrimaError(
                    503, Msg("Prima is not answering right now. Try again in a minute.")
                )
            await _save(
                db, ws_id, bid,
                {"state": NOT_LINKED, "code": "refused", "message": why, "prima_said": True},
            )  # fmt: skip
            await db.commit()
            return "refused"
        await _save(
            db, ws_id, bid,
            {"state": LINKED, "code": "made", "message": "", "company_id": cid, "made": True,
             "prima_name": str(data.get("name") or name)},
            company_id=cid,
        )  # fmt: skip
        await audit.record(
            db, ws_id, actor, "prima.company.made", target=bid,
            after={"company": cid, "code": payload["code"]},
            note=f"{name} added to Prima as {cid} (draft, checked against SSM in Prima)",
        )  # fmt: skip
        await db.commit()
        return "made"
    except PrimaError as e:
        await db.rollback()
        code = e.code or ("prima_down" if e.status == 503 else "refused")
        return await _not_linked(db, ws_id, bid, code, e.message, dry)


async def link_new(db: AsyncSession, principal, names: list[str]) -> None:
    """New organizations (an import's companies step), each linked to its Prima company of the
    same name; Prima is asked for its list once. Never raises."""
    ws_id = principal.workspace_id
    if not (on and names and client.enabled(ws_id)):
        return
    keys = {org_key(n) for n in names}
    rows = (await db.scalars(select(Branch).where(Branch.workspace_id == ws_id))).all()
    new = [b for b in rows if org_key(b.name) in keys]
    try:
        found = await client.companies()
    except PrimaError:
        found = None  # each is told "Prima is not answering" by link()
    for b in new:
        await link(
            db, ws_id, b, actor=principal.actor, actor_user_id=principal.user.id, found=found
        )


async def _not_linked(
    db: AsyncSession, ws_id: str, branch_id: str, code: str, msg: Msg, dry: bool
) -> str:
    if not dry:
        await _save(db, ws_id, branch_id, {"state": NOT_LINKED, "code": code, "message": str(msg)})
        await db.commit()
    return code


async def follow_rename(
    db: AsyncSession, ws_id: str, branch: Branch, old_name: str, *, actor: str, actor_user_id: str
) -> str:
    """A renamed organization's Prima company follows, when it is this organization by name.
    "renamed", "same" (case only), "unlinked", "other" (the Prima company has another name:
    not this organization's own, left alone) or "name_differs" (Prima refused; saved)."""
    bid, new_name = branch.id, branch.name  # kept: a rollback expires the branch
    if same_org(old_name, new_name):
        return "same"
    ws = await db.get(Workspace, ws_id)
    cid = client.company_map(ws).get(bid)
    if not cid:
        return "unlinked"
    state = states(ws).get(bid) or {}
    was = str(state.get("was") or old_name)
    try:
        found = {c.id: c.name for c in await client.companies()}
        current = found.get(cid) or made_companies(ws).get(cid) or ""
        if not (same_org(current, was) or name_key(current) == name_key(was)):
            return "other"
        form = await _as_ceo(
            db, ws_id, actor_user_id, "GET", f"/api/records/company/form?companyId={cid}"
        )
        values = form.json().get("values") if form.status == 200 else None
        if not isinstance(values, dict):
            raise _differs(form)
        keep = {
            k: v for k, v in values.items()
            if v is None or isinstance(v, (str, int, float, bool))
        }  # fmt: skip
        body = json.dumps(
            {"companyId": cid, "values": {**keep, "name": new_name}}, separators=(",", ":")
        ).encode()
        ans = await _as_ceo(db, ws_id, actor_user_id, "POST", "/api/records/company", body)
        if ans.status not in (200, 201):
            raise _differs(ans)
    except _Differs as d:
        await db.rollback()
        await _save(
            db, ws_id, bid,
            {**state, "state": NAME_DIFFERS, "code": "name_differs", "message": d.why,
             "prima_said": bool(d.why), "company_id": cid, "was": was},
        )  # fmt: skip
        await db.commit()
        return "name_differs"
    except PrimaError as e:
        await db.rollback()
        await _save(
            db, ws_id, bid,
            {**state, "state": NAME_DIFFERS, "code": e.code or "prima_down",
             "message": str(e.message), "company_id": cid, "was": was},
        )  # fmt: skip
        await db.commit()
        return "name_differs"
    await _save(
        db, ws_id, bid,
        {**state, "state": LINKED, "code": "renamed", "message": "", "company_id": cid,
         "prima_name": new_name, "was": None},
    )  # fmt: skip
    await audit.record(
        db, ws_id, actor, "prima.company.renamed", target=bid,
        before={"name": old_name}, after={"name": new_name, "company": cid},
        note=f"Prima company {cid} renamed to {new_name}",
    )  # fmt: skip
    await db.commit()
    return "renamed"


class _Differs(Exception):
    def __init__(self, why: str) -> None:
        super().__init__(why)
        self.why = why


def _differs(ans: client.Answer) -> _Differs:
    if ans.status >= 500:
        raise PrimaError(503, Msg("Prima is not answering right now. Try again in a minute."))
    return _Differs(_message(ans))


def shown(
    ws: Workspace | None, branch_id: str, company_id: str | None, lang: str | None = None
) -> dict:
    """The link state for the Organization page: linked / not_linked / name_differs, with the
    reason in the person's language (Prima's own reasons come as Prima gave them)."""
    s = states(ws).get(branch_id) or {}
    if company_id:
        state = NAME_DIFFERS if s.get("state") == NAME_DIFFERS else LINKED
    else:
        state = NOT_LINKED
    message = ""
    if state != LINKED and s.get("state") == state:
        raw = str(s.get("message") or "")
        message = raw if s.get("prima_said") else render(raw, lang) if raw else ""
    return {
        "state": state,
        "code": s.get("code") if state != LINKED or s.get("state") == LINKED else None,
        "message": message,
        "made": bool(company_id and s.get("made") and s.get("company_id") == company_id),
    }
