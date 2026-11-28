"""P147: Microsoft 365 Copilot for a person's own AI, as that person (delegated token only).

Owner's decision (Fitri, 28 Nov 2026): the organisation has the paid Microsoft 365 Copilot add-on
for its users and accepts the Copilot Chat API while it is in Microsoft's public preview. "Copilot
first (it costs us nothing for licensed users); our AI engine only for big tasks Copilot can't
handle; only for people connected via Microsoft who have the subscription."

What Microsoft documents (learn.microsoft.com, read 28 Nov 2026):
- Chat API (preview, Graph beta): POST /beta/copilot/conversations with {} (201, {"id"}), then
  POST /beta/copilot/conversations/{id}/chat with {"message": {"text"}, "locationHint":
  {"timeZone"} (required), "additionalContext": [{"text"}] (extra grounding)}. Synchronous: one
  200 with the conversation, whose `messages` end with Copilot's answer (`text`, `attributions`).
  Text only; no actions, no files, no long-running work (gateway timeouts). Free for people with
  the Microsoft 365 Copilot add-on licence; not available without it. Delegated (work or school)
  permissions only: Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All,
  Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All (all of them).
- Retrieval API (GA): POST /v1.0/copilot/retrieval with {"queryString" (1,500 characters at
  most, one sentence), "dataSource": sharePoint | oneDriveBusiness | externalItem,
  "resourceMetadata": [...], "maximumNumberOfResults": 1-25}; answers {"retrievalHits": [{webUrl,
  extracts: [{text, relevanceScore}], resourceType, resourceMetadata}]}. Files.Read.All and
  Sites.Read.All for SharePoint and OneDrive.
- Terms of use (preview): throttling and quotas per user, tenant or API at any time ("design
  applications to anticipate throttled responses"); not for applications that are not human
  directed (bots). So only a person's own chat with their own AI uses Copilot here, never
  background work, and a 429/503 rests that person's Copilot (Valkey) and our engine answers.

Status of a person (`status`): no_microsoft (no connected work account of their own; a personal
Microsoft account never), no_scope (did not "Allow Microsoft 365 Copilot", or Microsoft refused
the token for it), no_licence (no Copilot service plan in /me/licenseDetails, or Copilot said 403),
throttled (until a time), ready. The licence check is kept in Valkey for 6 hours and on the
account (MicrosoftAccount.copilot).

Valkey keys: copilot:lic:{account} ("1"/"0", 6 h), copilot:denied:{account} (6 h),
copilot:busy:{account} (until, the rest), copilot:strikes:{account} (1 h, for the back-off),
copilot:conv:{account}:{thread} (the Copilot conversation of one chat, 12 h).
"""

import asyncio
import contextlib
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.valkey import valkey
from ..models import MicrosoftAccount
from . import access, auth, http
from .domains import CONSUMER_TENANT
from .errors import MicrosoftError

log = logging.getLogger("agentic.microsoft.copilot")

GRAPH = "https://graph.microsoft.com/v1.0"
GRAPH_BETA = "https://graph.microsoft.com/beta"
CONVERSATIONS = f"{GRAPH_BETA}/copilot/conversations"
RETRIEVAL = f"{GRAPH}/copilot/retrieval"
LICENCES = f"{GRAPH}/me/licenseDetails"

CHAT_TIMEOUT = 45.0  # seconds: a person is waiting; our engine answers after that
SEARCH_TIMEOUT = 20.0
LICENCE_TTL = 6 * 3600
CONVERSATION_TTL = 12 * 3600
STRIKES_TTL = 3600
REST_MIN, REST_MAX = 60, 1800  # the back-off after a 429/503, doubled per strike
QUERY_MAX = 1500  # the Retrieval API's limit for queryString
RESULTS_MAX = 25

NO_MICROSOFT = "no_microsoft"
NO_SCOPE = "no_scope"
NO_LICENCE = "no_licence"
THROTTLED = "throttled"
READY = "ready"
STATES = (NO_MICROSOFT, NO_SCOPE, NO_LICENCE, THROTTLED, READY)

# Microsoft 365 Copilot's service plans (Entra licensing reference, SKU Microsoft_365_Copilot):
# M365_COPILOT_BUSINESS_CHAT, M365_COPILOT_APPS, M365_COPILOT_TEAMS,
# M365_COPILOT_INTELLIGENT_SEARCH, M365_COPILOT_SHAREPOINT, M365_COPILOT_CONNECTORS, ... Any one on
# (not "Disabled") is the paid add-on; the free "Copilot Chat" has no such plan.
PLAN_PREFIX = "M365_COPILOT"
SKU_PREFIXES = ("MICROSOFT_365_COPILOT", "M365_COPILOT")


def _key(kind: str, account_id: str, extra: str = "") -> str:
    return f"copilot:{kind}:{account_id}" + (f":{extra}" if extra else "")


# ---------------------------------------------------------------- licence


def has_licence(details: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    """(licensed, the Copilot SKUs) from /me/licenseDetails' `value`."""
    skus: list[str] = []
    for d in details:
        if not isinstance(d, dict):
            continue
        sku = str(d.get("skuPartNumber") or "")
        plans = [p for p in d.get("servicePlans") or [] if isinstance(p, dict)]
        on = [
            p
            for p in plans
            if str(p.get("servicePlanName") or "").upper().startswith(PLAN_PREFIX)
            and str(p.get("provisioningStatus") or "").lower() != "disabled"
        ]
        if on or sku.upper().startswith(SKU_PREFIXES):
            skus.append(sku or str(on[0].get("servicePlanName")))
    return bool(skus), skus


def _fresh(record: dict[str, Any] | None) -> bool:
    try:
        at = datetime.fromisoformat(str((record or {}).get("checked_at")))
    except ValueError:
        return False
    return datetime.now(UTC) - at < timedelta(seconds=LICENCE_TTL)


async def licensed(
    db: AsyncSession, acct: MicrosoftAccount, *, check: bool = True, force: bool = False
) -> bool | None:
    """Does this account have Microsoft 365 Copilot? Cached 6 h (Valkey, then the account's
    last check). None: not known (`check` False, or Microsoft could not be asked now)."""
    if not force:
        cached = await valkey().get(_key("lic", acct.id))
        if cached in ("1", "0", b"1", b"0"):
            return cached in ("1", b"1")
        record = acct.copilot or {}
        if _fresh(record) and isinstance(record.get("licensed"), bool):
            await valkey().set(_key("lic", acct.id), "1" if record["licensed"] else "0", ex=600)
            return bool(record["licensed"])
    if not check:
        return None
    try:
        token = await auth.access_token(db, acct)
        async with http.client() as c:
            r = await c.get(
                LICENCES,
                headers={"Authorization": f"Bearer {token}"},
                params={"$select": "skuPartNumber,servicePlans"},
                timeout=SEARCH_TIMEOUT,
            )
    except (MicrosoftError, httpx.HTTPError):
        log.info("Copilot licence check failed for %s", acct.id, exc_info=True)
        return None
    if r.status_code >= 400:
        log.info("Copilot licence check answered %s for %s", r.status_code, acct.id)
        return None
    try:
        value = (r.json() or {}).get("value") or []
    except ValueError:
        return None
    ok, skus = has_licence(value if isinstance(value, list) else [])
    await remember_licence(db, acct, ok, skus)
    return ok


async def remember_licence(
    db: AsyncSession, acct: MicrosoftAccount, ok: bool, skus: list[str] | None = None
) -> None:
    acct.copilot = {
        "licensed": ok,
        "checked_at": datetime.now(UTC).isoformat(),
        "skus": (skus if skus is not None else (acct.copilot or {}).get("skus") or [])[:10],
    }
    await db.commit()
    await valkey().set(_key("lic", acct.id), "1" if ok else "0", ex=LICENCE_TTL)


# ---------------------------------------------------------------- status


@dataclass
class Status:
    state: str
    until: datetime | None = None
    account: MicrosoftAccount | None = field(default=None, repr=False)
    licensed: bool | None = None

    @property
    def ready(self) -> bool:
        return self.state == READY

    def out(self) -> dict[str, Any]:
        record = (self.account.copilot or {}) if self.account is not None else {}
        return {
            "state": self.state,
            "until": self.until.isoformat() if self.until else None,
            "licensed": self.licensed,
            "checked_at": record.get("checked_at"),
            "scope_ok": self.state not in (NO_MICROSOFT, NO_SCOPE),
        }


def is_personal(acct: MicrosoftAccount) -> bool:
    return (acct.tenant_id or "").lower() == CONSUMER_TENANT


async def account_of(db: AsyncSession, workspace_id: str, user_id: str) -> MicrosoftAccount | None:
    """The person's own MAIN work account, connected; never a waiting, broken or personal one."""
    acct = await access.personal_account_of(db, workspace_id, user_id)
    if acct is None or acct.status != "connected" or is_personal(acct):
        return None
    return acct


async def busy_until(account_id: str) -> datetime | None:
    raw = await valkey().get(_key("busy", account_id))
    if not raw:
        return None
    try:
        until = datetime.fromisoformat(raw.decode() if isinstance(raw, bytes) else str(raw))
    except ValueError:
        return None
    return until if until > datetime.now(UTC) else None


async def status(
    db: AsyncSession, workspace_id: str, user_id: str, *, check: bool = True
) -> Status:
    acct = await account_of(db, workspace_id, user_id)
    if acct is None:
        return Status(NO_MICROSOFT)
    if not auth.copilot_granted(acct.scopes or "") or await valkey().get(_key("denied", acct.id)):
        return Status(NO_SCOPE, account=acct)
    lic = await licensed(db, acct, check=check)
    if lic is False:
        return Status(NO_LICENCE, account=acct, licensed=False)
    until = await busy_until(acct.id)
    if until is not None:
        return Status(THROTTLED, until=until, account=acct, licensed=lic)
    if lic is None and check:
        # Microsoft could not say just now: not ready this time (asked again next time).
        return Status(NO_LICENCE, account=acct, licensed=None)
    return Status(READY, account=acct, licensed=lic)


# ---------------------------------------------------------------- what went wrong


class CopilotFailed(Exception):
    """Copilot did not give a usable answer. `kind`: throttled | forbidden | unauthorized |
    timeout | error | empty. The caller falls back to our engine."""

    def __init__(self, kind: str, detail: str = "", latency_ms: int = 0) -> None:
        super().__init__(f"{kind}: {detail}"[:300])
        self.kind = kind
        self.detail = detail[:300]
        self.latency_ms = latency_ms


async def rest(account_id: str, retry_after: float | None) -> datetime:
    """A 429/503: this person's Copilot rests (Retry-After, else 1, 2, 4... minutes, at most
    30) and our engine answers meanwhile."""
    strikes = int(await valkey().incr(_key("strikes", account_id)))
    await valkey().expire(_key("strikes", account_id), STRIKES_TTL)
    backoff = min(REST_MAX, REST_MIN * 2 ** max(0, strikes - 1))
    secs = int(max(backoff, min(REST_MAX, retry_after or 0)))
    until = datetime.now(UTC) + timedelta(seconds=secs)
    await valkey().set(_key("busy", account_id), until.isoformat(), ex=secs)
    return until


async def deny(account_id: str) -> None:
    """Microsoft refused the token for Copilot (401 after a fresh token): no_scope for 6 h, or
    until the person allows Copilot again (a new sign-in clears it)."""
    await valkey().set(_key("denied", account_id), "1", ex=LICENCE_TTL)


async def forget(account_id: str) -> None:
    """A new "Allow Microsoft 365 Copilot": start afresh (licence asked again, no rest)."""
    for kind in ("lic", "denied", "busy", "strikes"):
        await valkey().delete(_key(kind, account_id))


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return float(r.headers.get("retry-after", ""))
    except ValueError:
        return None


def _why(r: httpx.Response) -> str:
    try:
        err = (r.json() or {}).get("error") or {}
        if isinstance(err, dict):
            return f"{err.get('code') or r.status_code}: {err.get('message') or ''}"[:300]
    except ValueError:
        pass
    return f"{r.status_code}: {r.text[:200]}"


async def _post(
    db: AsyncSession, acct: MicrosoftAccount, url: str, body: dict[str, Any], timeout: float
) -> httpx.Response:
    """One POST as the person, a fresh token once on 401. 401 again: no_scope; 403: no
    licence; 429/503: the person's Copilot rests. Raises CopilotFailed for all of those."""
    t0 = time.monotonic()
    refreshed = False
    while True:
        try:
            token = await auth.access_token(db, acct, force=refreshed)
        except MicrosoftError as e:
            raise CopilotFailed("unauthorized", str(e)) from e
        try:
            async with http.client() as c:
                r = await asyncio.wait_for(
                    c.post(
                        url,
                        json=body,
                        headers={
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                        },
                        timeout=timeout,
                    ),
                    timeout + 1,
                )
        except (TimeoutError, httpx.TimeoutException) as e:
            raise CopilotFailed("timeout", f"no answer within {timeout:g} s") from e
        except httpx.HTTPError as e:
            raise CopilotFailed("error", type(e).__name__) from e
        ms = int((time.monotonic() - t0) * 1000)
        if r.status_code == 401 and not refreshed:
            refreshed = True
            continue
        if r.status_code == 401:
            await deny(acct.id)
            raise CopilotFailed("unauthorized", _why(r), ms)
        if r.status_code == 403:
            await remember_licence(db, acct, False)
            raise CopilotFailed("forbidden", _why(r), ms)
        if r.status_code in (429, 503):
            until = await rest(acct.id, _retry_after(r))
            raise CopilotFailed("throttled", f"{_why(r)} (resting until {until.isoformat()})", ms)
        return r


# ---------------------------------------------------------------- the Chat API


@dataclass
class Answer:
    text: str
    conversation_id: str
    latency_ms: int
    sources: list[dict[str, str]] = field(default_factory=list)


# Copilot marks entities (<Person>Ali</Person>, <File>x.docx</File>) and citations ([^1^]).
_ENTITY = re.compile(r"</?[A-Z][A-Za-z]{1,30}>")
_CITE = re.compile(r"\[\^\d+\^\]")
# An answer that only says it cannot help: our engine answers instead.
_REFUSAL = re.compile(
    r"^\W*(i'?m sorry|sorry,|i (?:can ?not|can'?t|am unable|am not able|couldn'?t)|"
    r"unfortunately,? i (?:can|could)|maaf)",
    re.I,
)
REFUSAL_MAX = 400


def clean(text: str) -> str:
    out = _CITE.sub("", _ENTITY.sub("", text or ""))
    return re.sub(r"[ \t]+\n", "\n", out).strip()


def refused(text: str) -> bool:
    t = (text or "").strip()
    return not t or (len(t) <= REFUSAL_MAX and bool(_REFUSAL.match(t)))


def _answer_of(data: dict[str, Any], sent: str) -> tuple[str, list[dict[str, str]]]:
    msgs = [m for m in data.get("messages") or [] if isinstance(m, dict)]
    for m in reversed(msgs):
        text = str(m.get("text") or "")
        if text.strip() and text.strip() != sent.strip():
            sources: list[dict[str, str]] = []
            for a in m.get("attributions") or []:
                if not isinstance(a, dict) or a.get("attributionType") != "citation":
                    continue
                url = str(a.get("seeMoreWebUrl") or "")
                if url.startswith("https://") and url not in {s["url"] for s in sources}:
                    sources.append({"title": str(a.get("providerDisplayName") or url), "url": url})
            return text, sources[:5]
    return "", []


async def _conversation(db: AsyncSession, acct: MicrosoftAccount, thread: str) -> str:
    key = _key("conv", acct.id, thread)
    have = await valkey().get(key)
    if have:
        return have.decode() if isinstance(have, bytes) else str(have)
    r = await _post(db, acct, CONVERSATIONS, {}, CHAT_TIMEOUT)
    if r.status_code >= 400:
        raise CopilotFailed("error", _why(r))
    cid = str((r.json() or {}).get("id") or "")
    if not cid:
        raise CopilotFailed("error", "no conversation id")
    await valkey().set(key, cid, ex=CONVERSATION_TTL)
    return cid


async def chat(
    db: AsyncSession,
    acct: MicrosoftAccount,
    thread: str,
    text: str,
    context: list[str],
    tz: str,
) -> Answer:
    """Ask Copilot as this person in the conversation of `thread` (one of our chats), made on
    first use and reused. `context` rides as additionalContext (our instructions, the
    conversation so far). Raises CopilotFailed when there is no usable answer."""
    t0 = time.monotonic()
    body: dict[str, Any] = {
        "message": {"text": text},
        "locationHint": {"timeZone": tz or "UTC"},
    }
    if context:
        body["additionalContext"] = [{"text": c} for c in context if c.strip()]
    for again in (False, True):
        cid = await _conversation(db, acct, thread)
        r = await _post(db, acct, f"{CONVERSATIONS}/{cid}/chat", body, CHAT_TIMEOUT)
        if r.status_code == 404 and not again:  # the conversation ended at Microsoft: a new one
            await valkey().delete(_key("conv", acct.id, thread))
            continue
        break
    ms = int((time.monotonic() - t0) * 1000)
    if r.status_code >= 400:
        raise CopilotFailed("error", _why(r), ms)
    try:
        data = r.json() or {}
    except ValueError as e:
        raise CopilotFailed("error", "not JSON", ms) from e
    raw, sources = _answer_of(data, text)
    answer = clean(raw)
    if refused(answer):
        raise CopilotFailed("empty", answer[:200] or "no answer", ms)
    with contextlib.suppress(Exception):  # a good answer: the back-off starts over
        await valkey().delete(_key("strikes", acct.id))
    return Answer(answer, cid, ms, sources)


# ---------------------------------------------------------------- the Retrieval API

SOURCES = {"sharepoint": ("sharePoint",), "onedrive": ("oneDriveBusiness",)}
SOURCES["both"] = SOURCES["sharepoint"] + SOURCES["onedrive"]


@dataclass
class Hit:
    title: str
    url: str
    source: str
    passages: list[str]
    score: float


async def retrieve(
    db: AsyncSession, acct: MicrosoftAccount, query: str, where: str = "both", limit: int = 8
) -> list[Hit]:
    """The passages of the person's own SharePoint / OneDrive files that answer `query`, best
    first (Microsoft trims them to what the person may open). Raises CopilotFailed."""
    q = " ".join(query.split())[:QUERY_MAX]
    limit = max(1, min(RESULTS_MAX, limit))
    hits: list[Hit] = []
    for source in SOURCES.get(where, SOURCES["both"]):
        r = await _post(
            db,
            acct,
            RETRIEVAL,
            {
                "queryString": q,
                "dataSource": source,
                "resourceMetadata": ["title", "author"],
                "maximumNumberOfResults": limit,
            },
            SEARCH_TIMEOUT,
        )
        if r.status_code >= 400:
            raise CopilotFailed("error", _why(r))
        try:
            data = r.json() or {}
        except ValueError as e:
            raise CopilotFailed("error", "not JSON") from e
        for h in data.get("retrievalHits") or []:
            if not isinstance(h, dict):
                continue
            extracts = [x for x in h.get("extracts") or [] if isinstance(x, dict)]
            extracts.sort(key=lambda x: -float(x.get("relevanceScore") or 0))
            url = str(h.get("webUrl") or "")
            meta = h.get("resourceMetadata") if isinstance(h.get("resourceMetadata"), dict) else {}
            hits.append(
                Hit(
                    title=str(meta.get("title") or url.rsplit("/", 1)[-1] or "file"),
                    url=url,
                    source="OneDrive" if source == "oneDriveBusiness" else "SharePoint",
                    passages=[str(x.get("text") or "").strip() for x in extracts if x.get("text")],
                    score=max((float(x.get("relevanceScore") or 0) for x in extracts), default=0),
                )
            )
    hits.sort(key=lambda h: -h.score)
    return hits[:limit]


# ---------------------------------------------------------------- the m365_search tool


async def search_ready(db: AsyncSession, agent: Any) -> bool:
    """P147: offer m365_search to this AI: its person's own AI (twin or private assistant),
    the owner switched Copilot first on with Microsoft 365 search, and the person allowed
    Copilot and is not known to lack the licence or to be resting. No call to Microsoft here
    (the tool itself checks the licence)."""
    from ..core.workspace_settings import copilot_first
    from ..models import Workspace

    if agent is None or agent.status == "retired" or not access.personal_ai(agent):
        return False
    ws = await db.get(Workspace, agent.workspace_id)
    cf = copilot_first(ws.settings if ws is not None else None)
    if not (cf.on and cf.use_retrieval):
        return False
    st = await status(db, agent.workspace_id, agent.owner_user_id or "", check=False)
    return st.ready
