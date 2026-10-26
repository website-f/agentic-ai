# ruff: noqa: E501
"""P50 CRM integrations: read another system's data into a CRM object, and keep it fresh.

- rest: a JSON API (GET), with a key (bearer, basic, a header or a query parameter), the list
  inside the answer (`records_path`, e.g. "data.items"), each record's id (`id_path`) and paging
  (page, offset, cursor, Link header, Stripe's starting_after).
- csv: a CSV address (a published Google Sheet, an export link).
- webhook: the other system POSTs records to /api/crm/hooks/<token>.

Fields are found from the data itself (`infer`: sampled records, types guessed) and confirmed
by the person; a key that shows up later is added on its own (type guessed). Records are
matched by the other system's id, so a sync updates rather than duplicates.

Every request is checked and pinned by the SSRF guard (no internal addresses), redirects are
not followed, and at most MAX_PAGES pages / MAX_RECORDS records are read per sync. Secrets are
encrypted at rest and never shown again.
"""

import csv
import hashlib
import io
import json
import logging
import re
import secrets as pysecrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import crypto
from ...core.ssrf import BlockedURL, pinned
from ...engine import client as engine_client
from ...models import CrmConnector, CrmField, CrmObject, CrmRecord
from .fields import FieldError, at_path, coerce, flatten, guess, slug

log = logging.getLogger("agentic.crm.connectors")

MAX_PAGES = 25
MAX_RECORDS = 5000
MAX_BYTES = 8 * 1024 * 1024
MAX_FIELDS = 60
SAMPLE = 200
TIMEOUT = 30.0
USER_AGENT = "AgenticOffice-CRM/1.0"

PRESETS: list[dict[str, Any]] = [
    {"key": "rest", "name": "Any system with a JSON API", "kind": "rest", "icon": "plugs-connected",
     "help": "Paste the address that lists the records, and the key if it needs one.",
     "config": {"url": "", "auth": {"type": "bearer"}, "records_path": "", "id_path": "id", "pagination": {"type": "none"}}},
    {"key": "csv", "name": "A CSV file address", "kind": "csv", "icon": "file-csv",
     "help": "Any address that gives a CSV file, such as an export link.", "config": {"url": ""}},
    {"key": "google_sheet", "name": "Google Sheets", "kind": "csv", "icon": "table",
     "help": "In the sheet: Share > Anyone with the link can view. Paste the sheet's address; the tab is read as a table.",
     "config": {"url": ""}},
    {"key": "webhook", "name": "Another system sends us records", "kind": "webhook", "icon": "webhooks-logo",
     "help": "You get an address to paste into the other system. Each record it sends (JSON) lands here.", "config": {"id_path": "id"}},
    {"key": "shopify", "name": "Shopify orders", "kind": "rest", "icon": "storefront",
     "help": "Shopify admin > Settings > Apps > Develop apps: create an app with read_orders, then copy its Admin API access token.",
     "config": {"url": "https://YOUR-SHOP.myshopify.com/admin/api/2024-10/orders.json?status=any&limit=250",
                "auth": {"type": "header", "name": "X-Shopify-Access-Token"}, "records_path": "orders", "id_path": "id",
                "pagination": {"type": "link"}}},
    {"key": "woocommerce", "name": "WooCommerce orders", "kind": "rest", "icon": "shopping-cart",
     "help": "WooCommerce > Settings > Advanced > REST API: add a Read key. Username = consumer key, key = consumer secret.",
     "config": {"url": "https://YOUR-SITE/wp-json/wc/v3/orders?per_page=100", "auth": {"type": "basic"},
                "records_path": "", "id_path": "id", "pagination": {"type": "page", "param": "page"}}},
    {"key": "hubspot", "name": "HubSpot contacts", "kind": "rest", "icon": "address-book",
     "help": "HubSpot > Settings > Integrations > Private apps: create one with crm.objects.contacts.read and copy its token.",
     "config": {"url": "https://api.hubapi.com/crm/v3/objects/contacts?limit=100", "auth": {"type": "bearer"},
                "records_path": "results", "id_path": "id", "pagination": {"type": "cursor", "param": "after", "cursor_path": "paging.next.after"}}},
    {"key": "stripe", "name": "Stripe customers", "kind": "rest", "icon": "credit-card",
     "help": "Stripe Dashboard > Developers > API keys: use a restricted key that can read customers.",
     "config": {"url": "https://api.stripe.com/v1/customers?limit=100", "auth": {"type": "bearer"},
                "records_path": "data", "id_path": "id", "pagination": {"type": "stripe"}}},
    {"key": "airtable", "name": "Airtable table", "kind": "rest", "icon": "table",
     "help": "Airtable > Developer hub: a personal access token that can read the base. Address: https://api.airtable.com/v0/BASE_ID/TABLE_NAME",
     "config": {"url": "https://api.airtable.com/v0/BASE_ID/TABLE_NAME", "auth": {"type": "bearer"},
                "records_path": "records", "id_path": "id", "pagination": {"type": "cursor", "param": "offset", "cursor_path": "offset"}}},
]  # fmt: skip
PRESET_KEYS = {p["key"] for p in PRESETS}


class ConnectorError(Exception):
    """Why reading the other system did not work, for a person."""


# ---------------------------------------------------------------- secrets


def seal(conn_id: str, secret: str) -> str:
    return crypto.encrypt(secret, f"crm:{conn_id}:secret")


def unseal(conn: CrmConnector) -> str:
    enc = (conn.config or {}).get("secret_enc")
    if not enc:
        return ""
    try:
        return crypto.decrypt(enc, f"crm:{conn.id}:secret")
    except crypto.DecryptError as e:
        raise ConnectorError("The saved key cannot be read here; enter it again.") from e


def public(conn: CrmConnector) -> dict[str, Any]:
    c = {k: v for k, v in (conn.config or {}).items() if not k.endswith("_enc")}
    c["secret_set"] = bool((conn.config or {}).get("secret_enc"))
    return c


def new_webhook_token() -> tuple[str, str]:
    token = pysecrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------- reading


def google_sheet_csv(url: str) -> str:
    """A Google Sheets address -> its CSV export address (first tab, or the one in #gid=)."""
    m = re.search(r"docs\.google\.com/spreadsheets/d/([A-Za-z0-9_\-]+)", url)
    if not m or "export?format=csv" in url or "output=csv" in url:
        return url
    gid = re.search(r"[#&?]gid=(\d+)", url)
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv&gid={gid.group(1) if gid else 0}"


def _with_param(url: str, name: str, value: Any) -> str:
    u = urlparse(url)
    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != name]
    q.append((name, str(value)))
    return urlunparse(u._replace(query=urlencode(q)))


def _auth(
    config: dict[str, Any], secret: str, url: str
) -> tuple[str, dict[str, str], httpx.BasicAuth | None]:
    auth = config.get("auth") or {}
    kind = auth.get("type") or "none"
    headers: dict[str, str] = {}
    basic = None
    if secret:
        if kind == "bearer":
            headers["Authorization"] = f"Bearer {secret}"
        elif kind == "header":
            headers[str(auth.get("name") or "X-API-Key")[:60]] = secret
        elif kind == "query":
            url = _with_param(url, str(auth.get("name") or "api_key")[:40], secret)
        elif kind == "basic":
            basic = httpx.BasicAuth(str(auth.get("username") or ""), secret)
    return url, headers, basic


async def _get(url: str, headers: dict[str, str], basic: httpx.BasicAuth | None) -> httpx.Response:
    try:
        target, pin_headers, ext = await pinned(url)
    except BlockedURL as e:
        raise ConnectorError(str(e)) from e
    try:
        async with engine_client._client(timeout=TIMEOUT) as http:  # noqa: SLF001 - shared transport hook
            r = await http.get(
                target,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json, text/csv;q=0.9, */*;q=0.5",
                    **headers,
                    **pin_headers,
                },
                auth=basic or httpx.USE_CLIENT_DEFAULT,
                extensions=ext,
                follow_redirects=False,
            )
    except httpx.HTTPError as e:
        raise ConnectorError(f"Could not reach it: {e.__class__.__name__}.") from e
    if r.status_code in (401, 403):
        raise ConnectorError(
            f"It refused the key ({r.status_code}). Check the key and its permissions."
        )
    if r.is_redirect:
        raise ConnectorError("It answered with a redirect. Use the final address.")
    if r.status_code >= 400:
        raise ConnectorError(f"It answered {r.status_code}.")
    if len(r.content) > MAX_BYTES:
        raise ConnectorError("The answer is too large. Ask for fewer records per page.")
    return r


def _records_of(body: Any, path: str) -> list[dict[str, Any]]:
    data = at_path(body, path) if path else body
    if isinstance(data, dict):
        # A single object, or an object of objects keyed by id.
        if all(isinstance(v, dict) for v in data.values()) and data:
            return [{"id": k, **v} for k, v in data.items()]
        return [data]
    if isinstance(data, list):
        return [x if isinstance(x, dict) else {"value": x} for x in data]
    raise ConnectorError("No list of records was found there. Set where the list is in the answer.")


def parse_csv(text: str) -> list[dict[str, Any]]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    out = []
    for i, row in enumerate(reader):
        if i >= MAX_RECORDS:
            break
        out.append(
            {
                (k or f"column_{j + 1}").strip(): (v or "").strip()
                for j, (k, v) in enumerate(row.items())
            }
        )
    if not out:
        raise ConnectorError("The CSV has no rows (the first row must hold the column names).")
    return out


async def fetch(kind: str, config: dict[str, Any], secret: str) -> list[dict[str, Any]]:
    """The other system's records (raw), every page, up to MAX_RECORDS."""
    url = str(config.get("url") or "").strip()
    if not url:
        raise ConnectorError("Give the address to read from.")
    if kind == "csv":
        url = google_sheet_csv(url)
        url, headers, basic = _auth(config, secret, url)
        r = await _get(url, headers, basic)
        if "html" in r.headers.get("content-type", "") and "<html" in r.text[:500].lower():
            raise ConnectorError(
                "That address gives a web page, not a CSV. For Google Sheets, share it so anyone with the link can view."
            )
        return parse_csv(r.content.decode(r.encoding or "utf-8", errors="replace"))
    if kind != "rest":
        raise ConnectorError("This connection does not read; records are sent to it.")
    page = config.get("pagination") or {}
    ptype = page.get("type") or "none"
    records: list[dict[str, Any]] = []
    next_url: str | None = url
    n = 1
    for _ in range(MAX_PAGES):
        if not next_url:
            break
        u, headers, basic = _auth(config, secret, next_url)
        r = await _get(u, headers, basic)
        try:
            body = r.json()
        except (json.JSONDecodeError, ValueError) as e:
            raise ConnectorError("It did not answer with JSON.") from e
        batch = _records_of(body, str(config.get("records_path") or ""))
        records.extend(batch)
        if len(records) >= MAX_RECORDS or not batch:
            break
        if ptype == "page":
            n += 1
            next_url = _with_param(url, str(page.get("param") or "page"), n)
        elif ptype == "offset":
            next_url = _with_param(url, str(page.get("param") or "offset"), len(records))
        elif ptype == "cursor":
            cur = at_path(body, str(page.get("cursor_path") or ""))
            next_url = _with_param(url, str(page.get("param") or "cursor"), cur) if cur else None
        elif ptype == "stripe":
            next_url = (
                _with_param(url, "starting_after", batch[-1].get("id"))
                if isinstance(body, dict) and body.get("has_more")
                else None
            )
        elif ptype == "link":
            m = re.search(r'<([^>]+)>;\s*rel="?next"?', r.headers.get("link", ""))
            next_url = m.group(1) if m else None
        else:
            next_url = None
    return records[:MAX_RECORDS]


def infer(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The fields found in the records: [{key, label, type, path, sample}], most filled first."""
    flat = [flatten(r) for r in records[:SAMPLE]]
    seen: dict[str, list[Any]] = {}
    for row in flat:
        for k, v in row.items():
            seen.setdefault(k, []).append(v)
    ranked = sorted(
        seen.items(), key=lambda kv: -sum(1 for v in kv[1] if v not in (None, "", [], {}))
    )
    out = []
    used: set[str] = set()
    for path, values in ranked[:MAX_FIELDS]:
        key = slug(path.replace(".", "_"))
        while key in used:
            key = f"{key}_x"
        used.add(key)
        label = re.sub(r"[_.]+", " ", path).strip().capitalize()[:80] or key
        out.append({"key": key, "label": label, "type": guess(values, path), "path": path,
                    "sample": next((v for v in values if v not in (None, "", [], {})), None)})  # fmt: skip
    return out


# ---------------------------------------------------------------- writing into the CRM


def _value(f: CrmField, raw: Any) -> Any:
    if f.type in ("select", "multi_select"):
        # Choices grow with the data: a new value becomes a new choice.
        items = (
            raw if isinstance(raw, list) else ([raw] if f.type == "select" else str(raw).split(","))
        )
        choices = list((f.options or {}).get("choices") or [])
        known = {c["value"].lower() for c in choices}
        for item in items:
            s = str(item).strip()[:60]
            if s and s.lower() not in known and len(choices) < 60:
                from .fields import CHOICE_COLORS

                choices.append(
                    {
                        "value": s,
                        "label": s,
                        "color": CHOICE_COLORS[len(choices) % len(CHOICE_COLORS)],
                    }
                )
                known.add(s.lower())
        f.options = {**(f.options or {}), "choices": choices}
    try:
        return coerce(f.type, f.options or {}, raw)
    except FieldError:
        return None if raw in (None, "") else str(raw)[:500]


async def upsert(
    db: AsyncSession, obj: CrmObject, records: list[dict[str, Any]], id_path: str, actor: str
) -> dict[str, int]:
    """Write records into the object: matched by their id, new fields added on the way."""
    from .engine import fields_of

    fields = await fields_of(db, obj)
    by_path = {f.source_path: f for f in fields if f.source_path}
    known_paths = set(by_path)
    flat = [flatten(r) for r in records]
    new_paths = [p for p in {k for row in flat for k in row} if p not in known_paths]
    if new_paths and len(fields) < MAX_FIELDS:
        found = {x["path"]: x for x in infer([r for r in records[:SAMPLE]])}
        pos = max((f.position for f in fields), default=0)
        used = {f.key for f in fields}
        for p in new_paths:
            if p not in found or len(fields) >= MAX_FIELDS:
                continue
            spec = found[p]
            key = spec["key"]
            while key in used:
                key = f"{key}_x"
            used.add(key)
            pos += 1
            f = CrmField(workspace_id=obj.workspace_id, object_id=obj.id, key=key, label=spec["label"], type=spec["type"],
                         options={}, source_path=p, position=pos, created_by=actor)  # fmt: skip
            db.add(f)
            fields.append(f)
            by_path[p] = f
        await db.flush()
    existing = {
        r.external_id: r
        for r in (await db.scalars(select(CrmRecord).where(CrmRecord.object_id == obj.id))).all()
        if r.external_id
    }
    created = updated = 0
    title_f = next((f for f in fields if f.key == obj.title_field), None)
    for raw, row in zip(records, flat, strict=False):
        rid = at_path(raw, id_path) if id_path else None
        ext = (
            str(rid)
            if rid not in (None, "")
            else hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()[
                :40
            ]
        )
        data: dict[str, Any] = {}
        for path, f in by_path.items():
            if path in row:
                v = _value(f, row[path])
                if v is not None:
                    data[f.key] = v
        rec = existing.get(ext)
        title = str(data.get(title_f.key, "")) if title_f else ""
        if rec is None:
            rec = CrmRecord(workspace_id=obj.workspace_id, object_id=obj.id, external_id=ext[:200], data=data,
                            title=title[:300], created_by=actor, updated_by=actor)  # fmt: skip
            db.add(rec)
            existing[ext] = rec
            created += 1
        elif rec.data != data:
            rec.data, rec.title, rec.updated_by = data, title[:300], actor
            rec.updated_at = datetime.now(UTC)
            updated += 1
    await db.flush()
    return {"created": created, "updated": updated, "received": len(records)}


async def sync(db: AsyncSession, conn: CrmConnector) -> dict[str, Any]:
    """Read the other system now and update its object. Records the outcome; commits."""
    obj = await db.get(CrmObject, conn.object_id) if conn.object_id else None
    try:
        if obj is None:
            raise ConnectorError(
                "Its CRM object was deleted. Remove this connection and add it again."
            )
        records = await fetch(conn.kind, conn.config or {}, unseal(conn))
        stats = await upsert(
            db, obj, records, str((conn.config or {}).get("id_path") or ""), f"connector:{conn.id}"
        )
        conn.last_status, conn.last_error = "ok", None
        conn.stats = {**stats, "at": datetime.now(UTC).isoformat()}
    except ConnectorError as e:
        await db.rollback()
        conn = await db.get(CrmConnector, conn.id) or conn
        conn.last_status, conn.last_error = "error", str(e)[:500]
        stats = {"error": str(e)}
    conn.last_sync_at = datetime.now(UTC)
    await db.commit()
    return stats


async def sync_due(db: AsyncSession) -> int:
    """Every connection whose time has come (the 10-minute round). Returns how many ran."""
    now = datetime.now(UTC)
    rows = (
        await db.scalars(
            select(CrmConnector).where(
                CrmConnector.enabled.is_(True), CrmConnector.kind != "webhook"
            )
        )
    ).all()
    ran = 0
    for c in rows:
        if c.last_sync_at and c.last_sync_at > now - timedelta(minutes=max(15, c.every_minutes)):
            continue
        try:
            await sync(db, c)
        except Exception:  # noqa: BLE001 - one broken connection must not stop the rest
            log.warning("crm sync failed for %s", c.id, exc_info=True)
            await db.rollback()
        ran += 1
    return ran


async def count_records(db: AsyncSession, obj: CrmObject) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(CrmRecord).where(CrmRecord.object_id == obj.id)
        )
        or 0
    )


__all__ = [
    "PRESETS",
    "ConnectorError",
    "fetch",
    "infer",
    "parse_csv",
    "public",
    "seal",
    "sync",
    "sync_due",
    "upsert",
]
