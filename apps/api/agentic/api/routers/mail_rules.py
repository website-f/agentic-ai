"""P44: inbox rules (models.MailRule; microsoft/rules_engine runs them).

`box` is "personal" (the person's own Outlook: only they set its rules) or a shared mailbox
id (people who manage it: channels.manage AND they see and manage its company, the same
people who approve its drafts).

- GET    /api/mail/rules?box=          the rules, in order, and the kinds of mail
- POST   /api/mail/rules?box=          add one
- PATCH  /api/mail/rules/{id}          change it (also on/off and its place)
- DELETE /api/mail/rules/{id}
- POST   /api/mail/rules/preview?box=  which recent mail it would have caught (no model)
"""

from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.security import can
from ...microsoft import access
from ...microsoft.features import CATEGORIES
from ...microsoft.rules_engine import MAX_RULES, matches
from ...models import MailItem, MailRule, MicrosoftAccount, SharedMailbox
from ...services import audit
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/mail/rules", tags=["mail"])

PREVIEW_OF = 200


class When(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: str = Field(default="", alias="from", max_length=400)
    subject: str = Field(default="", max_length=400)
    categories: list[str] = Field(default_factory=list, max_length=len(CATEGORIES))
    has_attachments: bool | None = None

    @field_validator("categories")
    @classmethod
    def _kinds(cls, v: list[str]) -> list[str]:
        return [k for k in dict.fromkeys(v) if k in CATEGORIES]

    def stored(self) -> dict[str, Any]:
        return {
            "from": self.from_.strip(),
            "subject": self.subject.strip(),
            "categories": self.categories,
            "has_attachments": self.has_attachments,
        }


class Then(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_reply: str = Field(default="", max_length=2000)
    save_attachments: str = Field(default="", max_length=200)
    make_task: bool = False
    ignore: bool = False
    stop: bool = False

    @model_validator(mode="after")
    def _something(self) -> "Then":
        acts = [self.draft_reply.strip(), self.save_attachments.strip(), self.make_task]
        if self.ignore and any(acts):
            raise ValueError("A rule that ignores a mail does nothing else with it.")
        if not self.ignore and not any(acts):
            raise ValueError("Say what the rule does.")
        return self


class RuleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    when: When
    then: Then


class RulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    when: When | None = None
    then: Then | None = None


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    when: When


Box = MicrosoftAccount | SharedMailbox


async def _box(db: AsyncSession, principal: Principal, box: str) -> Box:
    if box == "personal":
        acct = await access.personal_account_of(db, principal.workspace_id, principal.user.id)
        if acct is None or acct.status == "disconnected":
            raise api_error(
                status.HTTP_404_NOT_FOUND,
                "mailbox_not_found",
                "Connect your Outlook first (My AI or My assistants).",
            )
        return acct
    mb = await db.get(SharedMailbox, box)
    if (
        mb is None
        or mb.workspace_id != principal.workspace_id
        or not can(principal.role, "channels.manage")
        or not await access.may_approve_shared(
            db,
            mb,
            workspace_id=principal.workspace_id,
            user_id=principal.user.id,
            role=principal.role,
            branch_id=principal.branch_id,
        )
    ):
        raise api_error(status.HTTP_404_NOT_FOUND, "mailbox_not_found", "That mailbox is not here.")
    return mb


async def _rule(db: AsyncSession, principal: Principal, rule_id: str) -> MailRule:
    r = await db.get(MailRule, rule_id)
    if r is None or r.workspace_id != principal.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "rule_not_found", "That rule is not here.")
    await _box(db, principal, "personal" if r.account_id else str(r.mailbox_id))
    if r.account_id:
        acct = await db.get(MicrosoftAccount, r.account_id)
        if acct is None or acct.user_id != principal.user.id:
            raise api_error(status.HTTP_404_NOT_FOUND, "rule_not_found", "That rule is not here.")
    return r


def _out(r: MailRule) -> dict[str, Any]:
    return {
        "id": r.id,
        "name": r.name,
        "enabled": r.enabled,
        "position": r.position,
        "when": r.when or {},
        "then": r.then or {},
        "matched": r.matched,
        "last_matched_at": r.last_matched_at,
        "box": "personal" if r.account_id else r.mailbox_id,
    }


def _col(box: Box) -> Any:
    return MailRule.account_id if isinstance(box, MicrosoftAccount) else MailRule.mailbox_id


@router.get("")
async def list_rules(
    box: str = Query(min_length=1, max_length=40),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    b = await _box(db, principal, box)
    rows = (
        await db.scalars(
            select(MailRule).where(_col(b) == b.id).order_by(MailRule.position, MailRule.created_at)
        )
    ).all()
    return {
        "box": {
            "id": box,
            "kind": "personal" if isinstance(b, MicrosoftAccount) else "shared",
            "address": access.address_of(b),
        },
        "rules": [_out(r) for r in rows],
        "categories": list(CATEGORIES),
        "max": MAX_RULES,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_rule(
    body: RuleIn,
    box: str = Query(min_length=1, max_length=40),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    b = await _box(db, principal, box)
    n = await db.scalar(select(func.count()).select_from(MailRule).where(_col(b) == b.id)) or 0
    if n >= MAX_RULES:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "too_many_rules",
            "A mailbox can have up to {n} rules.",
            n=MAX_RULES,
        )
    last = await db.scalar(select(func.max(MailRule.position)).where(_col(b) == b.id))
    r = MailRule(
        workspace_id=principal.workspace_id,
        account_id=b.id if isinstance(b, MicrosoftAccount) else None,
        mailbox_id=b.id if isinstance(b, SharedMailbox) else None,
        name=body.name.strip(),
        enabled=body.enabled,
        position=(last or 0) + 1 if n else 0,
        when=body.when.stored(),
        then=body.then.model_dump(),
        created_by=principal.actor,
    )
    db.add(r)
    await db.flush()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail.rule_added",
        target=r.id,
        after={"name": r.name, "box": box},
    )
    await db.commit()
    return _out(r)


@router.patch("/{rule_id}")
async def change_rule(
    rule_id: str,
    body: RulePatch,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    r = await _rule(db, principal, rule_id)
    if body.name is not None:
        r.name = body.name.strip()
    if body.enabled is not None:
        r.enabled = body.enabled
    if body.position is not None:
        r.position = body.position
    if body.when is not None:
        r.when = body.when.stored()
    if body.then is not None:
        r.then = body.then.model_dump()
    await audit.record(
        db,
        principal.workspace_id,
        principal.actor,
        "mail.rule_changed",
        target=r.id,
        after={"name": r.name, "enabled": r.enabled},
    )
    await db.commit()
    return _out(r)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: str,
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> None:
    r = await _rule(db, principal, rule_id)
    await audit.record(
        db, principal.workspace_id, principal.actor, "mail.rule_deleted", target=r.id
    )
    await db.delete(r)
    await db.commit()


@router.post("/preview")
async def preview(
    body: PreviewIn,
    box: str = Query(min_length=1, max_length=40),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Which of the box's recent mail the rule would have caught. Plain matching, no model."""
    b = await _box(db, principal, box)
    items = (
        await db.scalars(
            select(MailItem)
            .where(MailItem.mailbox_ref == b.id)
            .order_by(MailItem.received_at.desc().nulls_last())
            .limit(PREVIEW_OF)
        )
    ).all()
    when = body.when.stored()
    hit = [i for i in items if matches(when, i)]
    return {
        "checked": len(items),
        "matched": len(hit),
        "examples": [
            {
                "from": i.from_name or i.from_address,
                "subject": i.subject,
                "received_at": i.received_at,
                "category": i.category,
            }
            for i in hit[:5]
        ],
    }
