"""P112: a Prima person and the office's members (prima/person_member.py).

Prima's person details (inside the office, /prima/) ask:
- GET  /api/prima-members/{person_id}: the member this person is (how: linked, email or name),
  or none, with a filled-in form to add them (name, work email, job title, the office branch
  of their Prima company, a department of the same name, the roles the asker may give).
- POST /api/prima-members/{person_id}: add them as a member, by the same path as Members > Add
  member (members.add_one: role and place rules, a one-time password for a new account, the
  audit row) and linked to Prima like every new member (prima/autolink.py), with their job
  title. Refused when a member already is that person (open them instead); a member of the
  same name only after "not the same person" is ticked. Nothing is merged.

Whoever may add members (people_manager: members.manage, or team.manage within their place)
asks; staff are refused. The person is read from Prima as the person asking each time, so
Prima's own walls decide whether they may see them, and their name and email are taken from
that read, never from the browser.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...i18n import Msg, render
from ...i18n.labels import role_label
from ...models import Membership
from ...prima import autolink, client, person_member
from ...prima.client import PrimaError
from ...prima.person_member import Match, PersonRefused, PrimaPerson
from ...services import audit
from ..deps import Principal, api_error, client_ip
from ..schemas import MemberCreateOut, Role
from . import members as members_router

router = APIRouter(prefix="/api/prima-members", tags=["members"])


class PrimaMemberAddIn(BaseModel):
    # One of the person's work emails in Prima; typed only when Prima has none.
    email: str | None = Field(default=None, max_length=254)
    role: Role = "staff"
    branch_id: str | None = Field(default=None, max_length=40)
    department_id: str | None = Field(default=None, max_length=40)
    job_title: str | None = Field(default=None, max_length=200)
    # A member has this person's name but is someone else: add them anyway.
    not_the_same: bool = False


def _prima_refusal(e: PrimaError | PersonRefused):
    if isinstance(e, PrimaError):
        return api_error(e.status, e.code or "prima_refused", e.message)
    if e.status == 404:
        return api_error(404, "person_not_found", "Prima does not show this person to you.")
    if e.status >= 500:
        return api_error(
            503, "prima_down", "Prima is not answering right now. Try again in a minute."
        )
    # Prima's own words (its walls), as Prima says them.
    return api_error(
        e.status,
        "prima_refused",
        Msg("Prima says: {reason}", reason=e.message)
        if e.message
        else Msg("Prima does not show this person to you."),
    )


async def _read(
    db: AsyncSession, principal: Principal, person_id: str, request: Request
) -> tuple[PrimaPerson, Match]:
    if not client.enabled(principal.workspace_id):
        raise api_error(404, "prima_off", "Prima is not set up on this server.")
    try:
        person = await person_member.read_person(
            db, principal.workspace_id, principal.user.id, person_id, client_ip(request)
        )
        match = await person_member.find(db, principal.workspace_id, person, await client.staff())
    except (PrimaError, PersonRefused) as e:
        raise _prima_refusal(e) from None
    return person, match


def _member_out(m: Membership, names: dict[str, str]) -> dict[str, object]:
    return {
        "user_id": m.user_id,
        "name": m.user.name,
        "email": m.user.email,
        "role": m.role,
        "role_label": render(role_label(m.role)),
        "branch_id": m.branch_id,
        "branch_name": names.get(m.branch_id or ""),
        "department_name": names.get(m.department_id or ""),
        "job_title": m.job_title,
        "active": bool(m.user.is_active),
    }


@router.get("/{person_id}")
async def member_of_person(
    person_id: str,
    request: Request,
    response: Response,
    principal: Principal = Depends(members_router.people_manager()),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    person, match = await _read(db, principal, person_id, request)
    ws = principal.workspace_id
    names = await members_router._names(db, ws)
    shown = {
        "id": person.id,
        "name": person.name,
        "emails": list(person.emails),
        "job_title": person.job_title or None,
        "company_id": person.company_id or None,
        "staff_no": person.staff_no or None,
        "department": person.department or None,
    }
    if match.member is not None and not members_router._member_in_scope(principal, match.member):
        # A member outside the asker's place: said, not shown.
        return {"status": "elsewhere", "how": match.how, "person": shown, "member": None,
                "same_name": 0, "draft": None}  # fmt: skip
    # Not a member yet (or only a member of the same name, who may be someone else): the form
    # to add them, filled in from Prima.
    draft = None if match.how in ("linked", "email") else await _draft(db, principal, person)
    return {
        "status": "member" if match.member is not None else "none",
        "how": match.how,
        "person": shown,
        "member": _member_out(match.member, names) if match.member is not None else None,
        "same_name": match.same_name,
        "draft": draft,
    }


async def _draft(db: AsyncSession, principal: Principal, person: PrimaPerson) -> dict[str, object]:
    ws = principal.workspace_id
    sc = principal.scope
    mapped = await person_member.branches_for(db, ws, person.company_id)
    pool = mapped or await person_member.all_branches(db, ws)
    pool = [b for b in pool if sc.everything or sc.in_branch(b.id)]
    depts = await person_member.departments_of(db, [b.id for b in pool])
    if sc.kind == "department":
        depts = [d for d in depts if d.id == sc.department_id]
    roles = members_router.assignable_roles(principal)
    dept = person_member.department_guess(depts, person.department)
    branch = next((d.branch_id for d in depts if d.id == dept), None) or (
        pool[0].id if len(pool) == 1 else None
    )
    return {
        "name": person.name,
        "email": person.emails[0] if person.emails else None,
        "emails": list(person.emails),
        "job_title": person.job_title or None,
        "role": "staff" if "staff" in roles else (roles[0] if roles else None),
        "roles": [{"id": r, "label": render(role_label(r))} for r in roles],
        "branch_id": branch,
        # Branches of the person's Prima company (several: the asker picks); none set yet:
        # every branch they may place people in, and `company_mapped` false.
        "branches": [{"id": b.id, "name": b.name} for b in pool],
        "company_mapped": bool(mapped),
        "department_id": dept,
        "departments": [{"id": d.id, "name": d.name, "branch_id": d.branch_id} for d in depts],
    }


@router.post("/{person_id}", status_code=status.HTTP_201_CREATED)
async def add_person(
    person_id: str,
    body: PrimaMemberAddIn,
    request: Request,
    response: Response,
    background: BackgroundTasks,
    principal: Principal = Depends(members_router.people_manager()),
    db: AsyncSession = Depends(get_db),
) -> MemberCreateOut:
    # The one-time password is shown once: never cached (as Members > Add member).
    response.headers["Cache-Control"] = "no-store"
    person, match = await _read(db, principal, person_id, request)
    if match.member is not None and (match.how != "name" or not body.not_the_same):
        if match.how == "name":
            raise api_error(
                status.HTTP_409_CONFLICT,
                "same_name",
                "{name} is already a member with this name. Open them in Members, or tick "
                '"not the same person" to add this person too.',
                name=match.member.user.name,
            )
        raise api_error(
            status.HTTP_409_CONFLICT,
            "already_member",
            "This person is already a member ({email}). Open them in Members instead.",
            email=match.member.user.email,
        )
    if match.same_name and not body.not_the_same:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "same_name",
            '{n} members have this name. Check them in Members, or tick "not the same person" '
            "to add this person too.",
            n=match.same_name,
        )
    if not person.name:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "name_required",
            "Prima has no name for this person. Add it in Prima first.",
        )
    # Their sign-in email: one of their work emails in Prima; typed only when Prima has none.
    typed = person_member.clean_email(body.email)
    if person.emails:
        email = typed or person.emails[0]
        if email not in person.emails:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "email_not_prima",
                "Use one of the work emails Prima has for this person.",
            )
    elif not typed:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "email_required",
            "Prima has no email for this person. Type their work email.",
        )
    else:
        email = typed
    # The branch of their Prima company, when the owner said which branches it is.
    mapped = await person_member.branches_for(db, principal.workspace_id, person.company_id)
    if mapped and body.branch_id and body.branch_id not in {b.id for b in mapped}:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "branch_not_company",
            "Pick a company that is this person's company in Prima.",
        )
    m, password = await members_router.add_one(
        db,
        principal,
        email=email,
        name=person.name,
        role=body.role,
        branch_id=body.branch_id,
        department_id=body.department_id,
        via="prima",
    )
    title = members_router.clean_title(
        body.job_title if body.job_title is not None else person.job_title
    )
    m.job_title = title
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "member.added_from_prima",
        target=m.user_id,
        after={
            "prima_person_id": person.id,
            "job_title": title,
            **({"not_the_same_as": match.member.user_id} if match.member is not None else {}),
            **({"same_name": match.same_name} if match.same_name else {}),
        },
    )
    await db.commit()
    await db.refresh(m)
    autolink.later(background, principal.workspace_id, [m.user_id])  # linked to Prima (P109)
    return MemberCreateOut(
        member=members_router._out(m, await members_router._names(db, principal.workspace_id)),
        temp_password=password,
    )
