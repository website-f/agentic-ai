"""P92: system emails (sign-in passwords) sent as one office mailbox through Microsoft Graph.

The office's own Microsoft app (Integration(kind="microsoft"), else AGENTIC_MS_CLIENT_ID /
_SECRET / _TENANT) signs in app-only (client credentials, auth.app_token) and calls
`POST /users/{address}/sendMail` with `saveToSentItems: false`, so no copy of a password stays
in the mailbox. The app needs the Mail.Send *application* permission with admin consent, best
limited to that one mailbox (Exchange Online RBAC for Applications; docs/SYSTEM_EMAIL_SETUP.md).

One attempt per call (plus one token refresh on a 401): callers decide about retries (the bulk
send waits out a 429). Every failure is a `SendError` whose str() is a sentence for the owner,
never Graph's raw answer, and never contains the message body.
"""

import logging
import urllib.parse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import Msg
from . import app, auth, http
from .errors import MicrosoftError, NotConfigured

log = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"
DEFAULT_RETRY_AFTER = 60.0
MAX_RETRY_AFTER = 300.0
_NO_MAILBOX_CODES = frozenset(
    {"ErrorInvalidUser", "MailboxNotEnabledForRESTAPI", "ResourceNotFound", "ErrorItemNotFound"}
)


class SendError(Exception):
    """kind: not_configured | app_refused | denied | no_mailbox | bad_recipient | throttled |
    unavailable | failed. `retry_after` (seconds) is set for throttled."""

    def __init__(self, message: Msg, kind: str, status: int = 0, retry_after: float = 0.0):
        super().__init__(message)
        self.message = message
        self.kind = kind
        self.status = status
        self.retry_after = retry_after


NOT_CONFIGURED = Msg(
    "The office's Microsoft app is not set up yet (Channels > Microsoft 365), so it cannot "
    "send email."
)


def tenant_for(cfg: app.AppConfig, sender: str) -> str:
    """The tenant to ask for the app-only token: the configured one, the one an admin consented
    in, else the sender address's own domain (Microsoft accepts a verified domain there)."""
    return cfg.app_tenant() or sender.rpartition("@")[2]


def _retry_after(r: httpx.Response) -> float:
    try:
        wait = float(r.headers.get("retry-after", ""))
    except ValueError:
        wait = DEFAULT_RETRY_AFTER
    return max(1.0, min(MAX_RETRY_AFTER, wait))


def _graph_code(r: httpx.Response) -> str:
    try:
        err = (r.json() or {}).get("error") or {}
    except ValueError:
        return ""
    return str(err.get("code") or "") if isinstance(err, dict) else ""


def _mapped(r: httpx.Response, sender: str, to: str) -> SendError:
    """Graph's answer in plain words."""
    status, code = r.status_code, _graph_code(r)
    if status == 401:
        return SendError(
            Msg(
                "Microsoft did not accept the office's app. Check the app's client secret on "
                "Channels > Microsoft 365."
            ),
            "app_refused",
            status,
        )
    if status == 403:
        return SendError(
            Msg(
                "The office's Microsoft app is not allowed to send mail as {address} yet: give it "
                "the Mail.Send application permission (see the setup steps). If you limited the "
                "app to one mailbox, make sure it is this one.",
                address=sender,
            ),
            "denied",
            status,
        )
    if status == 404 or code in _NO_MAILBOX_CODES:
        return SendError(
            Msg(
                "Microsoft 365 has no mailbox for {address}. Check the address: it must be a "
                "mailbox (a person's or a shared one) in your company's Microsoft 365.",
                address=sender,
            ),
            "no_mailbox",
            status,
        )
    if status == 429:
        return SendError(
            Msg(
                "Microsoft is limiting how fast the office sends email. Try again in a few minutes."
            ),
            "throttled",
            status,
            _retry_after(r),
        )
    if status >= 500:
        return SendError(
            Msg(
                "Microsoft's mail service is having trouble right now. Try again in a few minutes."
            ),
            "unavailable",
            status,
            _retry_after(r) if r.headers.get("retry-after") else 0.0,
        )
    if status == 400 and code == "ErrorInvalidRecipients":
        return SendError(
            Msg("Microsoft could not send to {email}: the address looks wrong.", email=to),
            "bad_recipient",
            status,
        )
    return SendError(
        Msg("Microsoft did not send the email ({status} {code}).", status=status, code=code or "-"),
        "failed",
        status,
    )


def message(*, sender: str, from_name: str, to: str, to_name: str, subject: str, html: str) -> dict:
    """The sendMail body. No tracking, no images: one HTML part."""
    who = {"emailAddress": {"address": sender, "name": from_name}}
    return {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": html},
            "toRecipients": [{"emailAddress": {"address": to, "name": to_name}}],
            "from": who,
            "replyTo": [who],
            # Out-of-office and other automatic replies are not sent back to this mailbox.
            "internetMessageHeaders": [{"name": "X-Auto-Response-Suppress", "value": "All"}],
        },
        "saveToSentItems": False,
    }


async def send(
    db: AsyncSession,
    workspace_id: str,
    *,
    sender: str,
    from_name: str,
    to: str,
    to_name: str,
    subject: str,
    html: str,
) -> None:
    """Send one email as `sender`. Raises SendError."""
    cfg = await app.load(db, workspace_id)
    if not cfg.configured:
        raise SendError(NOT_CONFIGURED, "not_configured")
    tenant = tenant_for(cfg, sender)
    url = f"{GRAPH}/users/{urllib.parse.quote(sender, safe='@')}/sendMail"
    body = message(
        sender=sender, from_name=from_name, to=to, to_name=to_name, subject=subject, html=html
    )
    for attempt in range(2):
        try:
            token = await auth.app_token(db, workspace_id, tenant, force=attempt > 0)
        except NotConfigured as e:
            raise SendError(NOT_CONFIGURED, "not_configured") from e
        except MicrosoftError as e:
            raise SendError(
                Msg("Microsoft refused the office app's sign-in: {why}", why=str(e)[:240]),
                "app_refused",
                e.status,
            ) from e
        try:
            async with http.client() as c:
                r = await c.post(url, json=body, headers={"Authorization": f"Bearer {token}"})
        except httpx.TransportError as e:
            raise SendError(
                Msg("Could not reach Microsoft to send the email. Try again in a few minutes."),
                "unavailable",
            ) from e
        if r.status_code in (401, 403) and attempt == 0:
            # A stale cached token: once more with a new one. 403 too: a token taken before the
            # admin granted Mail.Send (Application) lacks the role for up to an hour (P96).
            continue
        if r.status_code < 300:
            return
        err = _mapped(r, sender, to)
        log.warning("system mail not sent: Graph %s %s", r.status_code, err.kind)
        raise err
