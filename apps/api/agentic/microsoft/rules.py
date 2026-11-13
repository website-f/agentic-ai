"""What the AI does with a shared mailbox's mail (P34). Stored on SharedMailbox.rules.

The mail features read these; this part only validates and stores them:
- create_tasks_for: categories that become a task for the assigned agent
- save_attachments: keep attachments of those mails in the company's files
- digest: a daily summary at `time` (the workspace's time zone)
- follow_up_hours: chase mail nobody answered after this many hours (0 = never)

A person's own Outlook has the same keys in MicrosoftAccount.prefs (PersonalPrefs), with
quieter defaults: no tasks and no saved attachments unless they turn them on.
"""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Category = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z_]{1,31}$")]

DEFAULT_TASK_CATEGORIES = ["invoice", "customer_request", "tender", "complaint"]


class DigestRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    time: str = Field(default="08:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class MailRules(BaseModel):
    model_config = ConfigDict(extra="forbid")

    create_tasks_for: list[Category] = Field(
        default_factory=lambda: list(DEFAULT_TASK_CATEGORIES), max_length=20
    )
    save_attachments: bool = True
    digest: DigestRule = Field(default_factory=DigestRule)
    follow_up_hours: int = Field(default=48, ge=0, le=720)


class PersonalPrefs(BaseModel):
    """A person's own Outlook (MicrosoftAccount.prefs). Unlike a shared mailbox, nothing
    becomes a task unless they ask for it: by default their mail is only sorted and
    flagged, and summed up in the morning digest."""

    model_config = ConfigDict(extra="forbid")

    digest: DigestRule = Field(default_factory=DigestRule)
    create_tasks_for: list[Category] = Field(default_factory=list, max_length=20)
    save_attachments: bool = False
    follow_up_hours: int = Field(default=48, ge=0, le=720)


def defaults() -> dict[str, Any]:
    return MailRules().model_dump()


def _merge(out: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    for k, v in (stored or {}).items():
        if k == "digest" and isinstance(v, dict):
            out["digest"] = {**out["digest"], **v}
        elif k in out:
            out[k] = v
    return out


def effective(stored: dict[str, Any] | None) -> dict[str, Any]:
    """Stored rules over the defaults (older rows may lack newer keys)."""
    return _merge(defaults(), stored)


def personal_effective(stored: dict[str, Any] | None) -> dict[str, Any]:
    """A person's stored preferences over the personal defaults."""
    return _merge(PersonalPrefs().model_dump(), stored)
