"""Validated workspace-level runtime settings."""

import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

DEFAULT_MAX_TASK_MODEL_CALLS = 30
HARD_MAX_TASK_MODEL_CALLS = 200


def max_task_model_calls(settings: Mapping[str, Any] | None) -> int:
    """Return the safe model-call allowance for one task run."""
    raw = (settings or {}).get("max_task_model_calls", DEFAULT_MAX_TASK_MODEL_CALLS)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = DEFAULT_MAX_TASK_MODEL_CALLS
    return max(1, min(HARD_MAX_TASK_MODEL_CALLS, value))


# ---------------------------------------------------------------- P92 the system sender

SYSTEM_MAIL = "system_mail"
DEFAULT_SENDER_NAME = "No Reply"
_ADDRESS = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,63}$")


@dataclass(frozen=True)
class SystemMail:
    """Workspace.settings["system_mail"]: the mailbox sign-in emails come from.

    enabled          the switch for every system email
    address          the Microsoft 365 mailbox (a user or shared mailbox) they are sent as
    from_name        the name shown (Microsoft shows the mailbox's own display name)
    first_login      email a temporary password to someone who has never signed in
    forgot_password  "Email me a sign-in password" for people who signed in before
    """

    enabled: bool = False
    address: str = ""
    from_name: str = DEFAULT_SENDER_NAME
    first_login: bool = True
    forgot_password: bool = True

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.address)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def valid_address(value: str) -> bool:
    return len(value) <= 254 and bool(_ADDRESS.match(value))


def system_mail(settings: Mapping[str, Any] | None) -> SystemMail:
    """The stored setting, read leniently (a bad value reads as off)."""
    raw = (settings or {}).get(SYSTEM_MAIL)
    if not isinstance(raw, Mapping):
        return SystemMail()
    address = str(raw.get("address") or "").strip().lower()
    name = str(raw.get("from_name") or "").strip()[:80] or DEFAULT_SENDER_NAME
    return SystemMail(
        enabled=raw.get("enabled") is True and valid_address(address),
        address=address if valid_address(address) else "",
        from_name=name,
        first_login=raw.get("first_login") is not False,
        forgot_password=raw.get("forgot_password") is not False,
    )


def clean_system_mail(
    *, enabled: bool, address: str, from_name: str, first_login: bool, forgot_password: bool
) -> SystemMail:
    """What an owner saves. Raises ValueError("address") or ValueError("from_name")."""
    address = address.strip().lower()
    name = " ".join(from_name.split())
    if address and not valid_address(address):
        raise ValueError("address")
    if enabled and not address:
        raise ValueError("address")
    if len(name) > 80 or any(c in name for c in '<>"\r\n'):
        raise ValueError("from_name")
    return SystemMail(
        enabled=enabled,
        address=address,
        from_name=name or DEFAULT_SENDER_NAME,
        first_login=first_login,
        forgot_password=forgot_password,
    )


# ---------------------------------------------------------------- P147 Copilot first

COPILOT_FIRST = "copilot_first"
DEFAULT_COPILOT_PROMPT_CHARS = 6000
MIN_COPILOT_PROMPT_CHARS = 1000
MAX_COPILOT_PROMPT_CHARS = 20000


@dataclass(frozen=True)
class CopilotFirst:
    """Workspace.settings["copilot_first"] (owner/admin, off by default): a person's own AI
    asks Microsoft 365 Copilot first for plain answers (no tools), as that person, when they
    have a Copilot licence and allowed it; our AI engine answers everything else.

    on                the switch
    max_prompt_chars  longer questions (with their conversation) go to our engine
    use_retrieval     the m365_search tool (Copilot Retrieval API) for SharePoint / OneDrive
    """

    on: bool = False
    max_prompt_chars: int = DEFAULT_COPILOT_PROMPT_CHARS
    use_retrieval: bool = True

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def copilot_first(settings: Mapping[str, Any] | None) -> CopilotFirst:
    """The stored setting, read leniently (a bad value reads as off / the default)."""
    raw = (settings or {}).get(COPILOT_FIRST)
    if not isinstance(raw, Mapping):
        return CopilotFirst()
    try:
        chars = int(raw.get("max_prompt_chars", DEFAULT_COPILOT_PROMPT_CHARS))
    except (TypeError, ValueError):
        chars = DEFAULT_COPILOT_PROMPT_CHARS
    return CopilotFirst(
        on=raw.get("on") is True,
        max_prompt_chars=max(MIN_COPILOT_PROMPT_CHARS, min(MAX_COPILOT_PROMPT_CHARS, chars)),
        use_retrieval=raw.get("use_retrieval") is not False,
    )
