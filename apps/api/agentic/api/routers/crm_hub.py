# ruff: noqa: E501
"""P50 the universal CRM (agentic/crm/hub). The workspace owner's; others only through a grant
(an object to view or edit, minus hidden fields; the dashboard).

Structure (owner): objects, fields, templates, built-in sources, connectors, access.
Records and views: anyone with the object (edit grant to change records).

GET  /api/crm                                   what this person sees, plus (owner) discovery
POST /api/crm/templates/{key} | /builtins/{source} | /objects
GET|PATCH|DELETE /api/crm/objects/{key}   POST /api/crm/reset (start over)
POST /api/crm/objects/{key}/fields     PATCH|DELETE /api/crm/fields/{id}
POST /api/crm/objects/{key}/query      GET /api/crm/objects/{key}/options
POST /api/crm/objects/{key}/records    GET|PATCH|DELETE /api/crm/objects/{key}/records/{id}
POST /api/crm/objects/{key}/import     GET /api/crm/objects/{key}/export.csv
POST /api/crm/objects/{key}/views      PATCH|DELETE /api/crm/views/{id}
GET  /api/crm/dashboard   POST /api/crm/widgets   PATCH|DELETE /api/crm/widgets/{id}
GET|POST /api/crm/connectors   POST /api/crm/connectors/test   POST .../{id}/sync | .../{id}/new-address   PATCH|DELETE .../{id}
POST /api/crm/hooks/{token}  (the other system; no session)
GET  /api/crm/access   PUT /api/crm/access/{user_id}   GET /api/crm/people
"""

import csv
import io
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...crm.hub import builtins, connectors, engine, templates
from ...crm.hub.engine import Access, CrmError
from ...crm.hub.fields import TYPES, as_text, clean_choices, slug
from ...models import (
    AuditLog,
    CrmAccess,
    CrmConnector,
    CrmField,
    CrmObject,
    CrmRecord,
    CrmView,
    CrmWidget,
    Membership,
    User,
)
from ...services import audit
from ...services.text import csv_safe
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/crm", tags=["crm"])

ICONS = 80  # any short icon name; the app maps unknown ones to a cube
COLOR = r"^#[0-9a-fA-F]{6}$"
MAX_OBJECTS = 60
MAX_FIELDS = 80
MAX_WIDGETS = 40
PAGE = 200


def _fail(e: CrmError) -> Exception:
    err = api_error(
        e.status, e.code, e.message, **{k: v for k, v in e.vars.items() if k != "fields"}
    )
    if isinstance(e.vars.get("fields"), dict) and isinstance(err.detail, dict):
        err.detail["fields"] = e.vars["fields"]  # shown next to each input
    return err


async def _access(db: AsyncSession, p: Principal) -> Access:
    return await engine.access_of(db, p.workspace_id, p.user.id, p.role)


def _owner(a: Access) -> None:
    if not a.owner:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "crm_owner_only",
            "Only the owner can change how the CRM is set up.",
        )


async def _object(
    db: AsyncSession, p: Principal, key: str, need: str = "view"
) -> tuple[CrmObject, Access]:
    a = await _access(db, p)
    obj = await db.scalar(
        select(CrmObject).where(CrmObject.workspace_id == p.workspace_id, CrmObject.key == key)
    )
    if obj is None or not a.sees(obj) or (obj.archived and not a.owner):
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_object_not_found", "That is not in your CRM."
        )
    if need == "edit" and not a.edits(obj):
        raise api_error(
            status.HTTP_403_FORBIDDEN, "crm_read_only", "You can look at this but not change it."
        )
    if need == "owner":
        _owner(a)
    return obj, a


def _obj_out(o: CrmObject, a: Access, count: int | None = None) -> dict[str, Any]:
    return {
        "id": o.id, "key": o.key, "name": o.name, "singular": o.singular or o.name, "description": o.description,
        "icon": o.icon, "color": o.color, "kind": o.kind, "source": o.source, "title_field": o.title_field,
        "position": o.position, "archived": o.archived, "connector_id": o.connector_id, "count": count,
        "can_edit": a.edits(o) and o.kind != "builtin", "can_add_fields": a.owner,
        "link": builtins.SOURCES[o.source].link if o.source in builtins.SOURCES else None,
    }  # fmt: skip


def _field_out(f: CrmField) -> dict[str, Any]:
    return {
        "id": f.id, "key": f.key, "label": f.label, "type": f.type, "options": f.options or {},
        "required": f.required, "hidden": f.hidden, "builtin": f.builtin, "source_path": f.source_path, "position": f.position,
    }  # fmt: skip


def _view_out(v: CrmView) -> dict[str, Any]:
    return {
        "id": v.id,
        "name": v.name,
        "kind": v.kind,
        "config": v.config or {},
        "position": v.position,
    }


async def _count(db: AsyncSession, o: CrmObject) -> int:
    if o.kind == "builtin" and o.source in builtins.SOURCES:
        return await builtins.SOURCES[o.source].count(db, o.workspace_id)
    return int(
        await db.scalar(
            select(func.count()).select_from(CrmRecord).where(CrmRecord.object_id == o.id)
        )
        or 0
    )


async def _visible_fields(db: AsyncSession, obj: CrmObject, a: Access) -> list[CrmField]:
    hidden = a.hidden(obj)
    return [f for f in await engine.fields_of(db, obj) if f.key not in hidden]


# ---------------------------------------------------------------- the CRM as a whole


@router.get("")
async def overview(
    p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    a = await _access(db, p)
    if not a.any:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "crm_no_access",
            "The CRM is the owner's. Ask the owner to share it with you.",
        )
    objs = (
        await db.scalars(
            select(CrmObject)
            .where(CrmObject.workspace_id == p.workspace_id)
            .order_by(CrmObject.position, CrmObject.created_at)
        )
    ).all()
    out: dict[str, Any] = {
        "access": {"owner": a.owner, "dashboard": a.dashboard},
        "objects": [
            _obj_out(o, a, await _count(db, o))
            for o in objs
            if a.sees(o) and (a.owner or not o.archived)
        ],
    }
    if a.owner:
        out["discover"] = await builtins.discover(db, p.workspace_id)
        out["templates"] = [
            {"key": k, "name": t["name"], "description": t["description"], "icon": t["icon"],
             "objects": [templates.OBJECTS[x][1] for x in t["objects"]], "builtins": t["builtins"]}
            for k, t in templates.TEMPLATES.items()
        ]  # fmt: skip
        out["field_types"] = list(TYPES)
    return out


@router.post("/templates/{key}", status_code=status.HTTP_201_CREATED)
async def use_template(
    key: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    a = await _access(db, p)
    _owner(a)
    try:
        made = await templates.apply_template(db, p.workspace_id, key, p.actor)
    except KeyError as e:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_template_not_found", "There is no such template."
        ) from e
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.template",
        target=key,
        after={"objects": [o.key for o in made]},
    )
    await db.commit()
    return {"objects": [o.key for o in made]}


@router.post("/builtins/{source}", status_code=status.HTTP_201_CREATED)
async def add_builtin(
    source: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    a = await _access(db, p)
    _owner(a)
    try:
        obj = await engine.ensure_builtin(db, p.workspace_id, source, p.actor)
    except CrmError as e:
        raise _fail(e) from e
    await templates.default_views(db, obj, await engine.fields_of(db, obj), p.actor)
    await templates.add_tiles(db, obj, p.actor)
    await db.commit()
    return _obj_out(obj, a, await _count(db, obj))


class ObjectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    singular: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=300)
    icon: str = Field(default="cube", max_length=40, pattern=r"^[a-z0-9\-]+$")
    color: str = Field(default="#13895f", pattern=COLOR)
    preset: str | None = Field(default=None, max_length=40)  # one of templates.OBJECTS


@router.post("/objects", status_code=status.HTTP_201_CREATED)
async def add_object(
    body: ObjectIn, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    a = await _access(db, p)
    _owner(a)
    n = (
        await db.scalar(
            select(func.count())
            .select_from(CrmObject)
            .where(CrmObject.workspace_id == p.workspace_id)
        )
        or 0
    )
    if n >= MAX_OBJECTS:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_too_many",
            "A CRM can hold up to {n} kinds of things.",
            n=MAX_OBJECTS,
        )
    if body.preset and body.preset in templates.OBJECTS:
        obj = await templates.add_object(
            db, p.workspace_id, templates.OBJECTS[body.preset], p.actor
        )
        await templates.add_tiles(db, obj, p.actor, await engine.fields_of(db, obj))
    else:
        key = slug(body.name, "items")
        taken = {
            k
            for (k,) in (
                await db.execute(
                    select(CrmObject.key).where(CrmObject.workspace_id == p.workspace_id)
                )
            ).all()
        }
        taken |= set(builtins.SOURCES)
        base, i = key, 2
        while key in taken:
            key, i = f"{base}_{i}", i + 1
        spec: templates.Obj = (key, body.name.strip(), (body.singular or body.name).strip(), body.icon, body.color, "name",
                               [("name", "Name", "text", {}), ("notes", "Notes", "long_text", {})])  # fmt: skip
        obj = await templates.add_object(db, p.workspace_id, spec, p.actor)
        obj.description = body.description
    await audit.record(
        db, p.workspace_id, p.actor, "crm.object_added", target=obj.key, after={"name": obj.name}
    )
    await db.commit()
    return _obj_out(obj, a, 0)


@router.get("/objects/{key}")
async def get_object(
    key: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    obj, a = await _object(db, p, key)
    views = (
        await db.scalars(
            select(CrmView)
            .where(CrmView.object_id == obj.id)
            .order_by(CrmView.position, CrmView.created_at)
        )
    ).all()
    conn = await db.get(CrmConnector, obj.connector_id) if obj.connector_id else None
    return {
        "object": _obj_out(obj, a, await _count(db, obj)),
        "fields": [_field_out(f) for f in await _visible_fields(db, obj, a)],
        "views": [_view_out(v) for v in views],
        "connector": {
            "id": conn.id,
            "name": conn.name,
            "last_sync_at": conn.last_sync_at,
            "last_status": conn.last_status,
        }
        if conn
        else None,
    }


class ObjectPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=80)
    singular: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    icon: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9\-]+$")
    color: str | None = Field(default=None, pattern=COLOR)
    title_field: str | None = Field(default=None, max_length=60)
    position: int | None = Field(default=None, ge=0, le=10_000)
    archived: bool | None = None


@router.patch("/objects/{key}")
async def change_object(
    key: str,
    body: ObjectPatch,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, a = await _object(db, p, key, "owner")
    for name, v in body.model_dump(exclude_unset=True).items():
        if name == "title_field" and v not in {f.key for f in await engine.fields_of(db, obj)}:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "crm_bad_field",
                "That field is not on this object.",
            )
        setattr(obj, name, v)
    await db.commit()
    return _obj_out(obj, a, await _count(db, obj))


@router.delete("/objects/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_object(
    key: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> None:
    """Removes it from the CRM with its own records and fields. A built-in object's office data
    is never touched (only the extra fields people added)."""
    obj, _a = await _object(db, p, key, "owner")
    await db.execute(
        delete(CrmWidget).where(
            CrmWidget.workspace_id == p.workspace_id, CrmWidget.config["object"].astext == obj.key
        )
    )
    if obj.connector_id:
        await db.execute(delete(CrmConnector).where(CrmConnector.id == obj.connector_id))
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.object_removed",
        target=obj.key,
        before={"name": obj.name, "kind": obj.kind},
    )
    await db.delete(obj)
    await db.commit()


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: Literal[True]


@router.post("/reset")
async def reset_crm(
    body: ResetIn, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, int]:
    """Start over: every list with its records, fields and views, the dashboard, the
    connections and the sharing. The office's own data (contacts, deals, invoices...) is
    never touched: built-in lists only show it."""
    _owner(await _access(db, p))
    ws = p.workspace_id
    lists = (
        await db.scalar(
            select(func.count()).select_from(CrmObject).where(CrmObject.workspace_id == ws)
        )
        or 0
    )
    await db.execute(delete(CrmWidget).where(CrmWidget.workspace_id == ws))
    await db.execute(delete(CrmAccess).where(CrmAccess.workspace_id == ws))
    await db.execute(delete(CrmView).where(CrmView.workspace_id == ws))
    await db.execute(delete(CrmRecord).where(CrmRecord.workspace_id == ws))
    await db.execute(delete(CrmField).where(CrmField.workspace_id == ws))
    await db.execute(delete(CrmObject).where(CrmObject.workspace_id == ws))
    await db.execute(delete(CrmConnector).where(CrmConnector.workspace_id == ws))
    await audit.record(db, ws, p.actor, "crm.reset", target=ws, before={"lists": lists})
    await db.commit()
    return {"removed": lists}


# ---------------------------------------------------------------- fields


class FieldIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    type: Literal[
        "text", "long_text", "number", "money", "percent", "date", "datetime", "checkbox", "select", "multi_select",
        "email", "phone", "url", "rating", "person", "relation", "file", "auto",
    ] = "text"  # fmt: skip
    options: dict[str, Any] = Field(default_factory=dict)
    required: bool = False


def _clean_options(ftype: str, raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if ftype in ("select", "multi_select"):
        out["choices"] = clean_choices(raw.get("choices"))
    if ftype == "money":
        out["currency"] = str(raw.get("currency") or "RM")[:6]
    if ftype == "rating":
        out["max"] = max(3, min(10, int(raw.get("max") or 5)))
    if ftype == "relation":
        out["object"] = str(raw.get("object") or "")[:60]
        out["many"] = bool(raw.get("many", True))
    return out


@router.post("/objects/{key}/fields", status_code=status.HTTP_201_CREATED)
async def add_field(
    key: str,
    body: FieldIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, _a = await _object(db, p, key, "owner")
    fields = await engine.fields_of(db, obj)
    if len(fields) >= MAX_FIELDS:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_too_many_fields",
            "An object can have up to {n} fields.",
            n=MAX_FIELDS,
        )
    options = _clean_options(body.type, body.options)
    if body.type == "relation":
        target = await db.scalar(
            select(CrmObject).where(
                CrmObject.workspace_id == p.workspace_id, CrmObject.key == options["object"]
            )
        )
        if target is None:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "crm_bad_relation", "Pick what it links to."
            )
    taken = {f.key for f in fields}
    fkey, i = slug(body.label), 2
    base = fkey
    while fkey in taken:
        fkey, i = f"{base}_{i}", i + 1
    f = CrmField(workspace_id=p.workspace_id, object_id=obj.id, key=fkey, label=body.label.strip(), type=body.type,
                 options=options, required=body.required, position=max((x.position for x in fields), default=0) + 1, created_by=p.actor)  # fmt: skip
    db.add(f)
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.field_added",
        target=f"{obj.key}.{fkey}",
        after={"type": body.type},
    )
    await db.commit()
    return _field_out(f)


class FieldPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = Field(default=None, min_length=1, max_length=80)
    options: dict[str, Any] | None = None
    required: bool | None = None
    hidden: bool | None = None
    position: int | None = Field(default=None, ge=0, le=10_000)


async def _field(db: AsyncSession, p: Principal, field_id: str) -> tuple[CrmField, CrmObject]:
    f = await db.get(CrmField, field_id)
    if f is None or f.workspace_id != p.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_field_not_found", "That field is not here.")
    obj = await db.get(CrmObject, f.object_id)
    assert obj is not None
    _owner(await _access(db, p))
    return f, obj


@router.patch("/fields/{field_id}")
async def change_field(
    field_id: str,
    body: FieldPatch,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    f, _obj = await _field(db, p, field_id)
    sent = body.model_dump(exclude_unset=True)
    if f.builtin:
        sent = {k: v for k, v in sent.items() if k in ("label", "hidden", "position")}
    if "options" in sent and sent["options"] is not None:
        sent["options"] = {**(f.options or {}), **_clean_options(f.type, sent["options"])}
    for k, v in sent.items():
        setattr(f, k, v)
    await db.commit()
    return _field_out(f)


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_field(
    field_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> None:
    f, obj = await _field(db, p, field_id)
    if f.builtin:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_builtin_field",
            "This comes from the office's own data; hide it instead.",
        )
    if f.key == obj.title_field:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_title_field",
            "This is the name of each record; pick another one first.",
        )
    for r in (await db.scalars(select(CrmRecord).where(CrmRecord.object_id == obj.id))).all():
        if f.key in (r.data or {}):
            r.data = {k: v for k, v in r.data.items() if k != f.key}
    await audit.record(
        db, p.workspace_id, p.actor, "crm.field_removed", target=f"{obj.key}.{f.key}"
    )
    await db.delete(f)
    await db.commit()


# ---------------------------------------------------------------- records


class QueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q: str = Field(default="", max_length=200)
    filters: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    sort: list[dict[str, Any]] = Field(default_factory=list, max_length=5)
    limit: int = Field(default=50, ge=1, le=PAGE)
    offset: int = Field(default=0, ge=0, le=100_000)


async def _refs(
    db: AsyncSession, p: Principal, fields: list[CrmField], rows: list[dict[str, Any]]
) -> dict[str, str]:
    """Titles for the linked records and people in these rows."""
    out: dict[str, str] = {}
    people: set[str] = set()
    for f in fields:
        if f.type == "person":
            people |= {str(r["data"].get(f.key)) for r in rows if r["data"].get(f.key)}
        if f.type == "relation":
            ids = {str(x) for r in rows for x in (r["data"].get(f.key) or [])}
            if not ids:
                continue
            target = await db.scalar(
                select(CrmObject).where(
                    CrmObject.workspace_id == p.workspace_id,
                    CrmObject.key == (f.options or {}).get("object"),
                )
            )
            if target is None:
                continue
            tf = await engine.fields_of(db, target)
            for row in await engine.all_rows(db, target, tf):
                if row["id"] in ids:
                    out[row["id"]] = row["title"]
    if people:
        for u in (await db.scalars(select(User).where(User.id.in_(people)))).all():
            out[u.id] = u.name
    return out


@router.post("/objects/{key}/query")
async def query(
    key: str,
    body: QueryIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, a = await _object(db, p, key)
    fields = await engine.fields_of(db, obj)
    hidden = a.hidden(obj)
    rows = await engine.all_rows(db, obj, fields)
    rows = engine.strip_hidden(rows, hidden)
    visible = [f for f in fields if f.key not in hidden]
    filters = [x for x in body.filters if x.get("field") not in hidden]
    found = engine.apply(rows, visible, body.q, filters, body.sort)
    page = found[body.offset : body.offset + body.limit]
    return {"total": len(found), "rows": page, "refs": await _refs(db, p, visible, page)}


@router.get("/objects/{key}/options")
async def options(
    key: str,
    q: str = Query(default="", max_length=100),
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, str]]:
    """Records to pick for a link field."""
    obj, _a = await _object(db, p, key)
    fields = await engine.fields_of(db, obj)
    rows = engine.apply(await engine.all_rows(db, obj, fields), fields, q)
    return [{"id": r["id"], "title": r["title"]} for r in rows[:25]]


class RecordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict[str, Any] = Field(default_factory=dict)


async def _record(db: AsyncSession, obj: CrmObject, rid: str) -> CrmRecord | None:
    if obj.kind == "builtin":
        return await db.scalar(
            select(CrmRecord).where(CrmRecord.object_id == obj.id, CrmRecord.external_id == rid)
        )
    r = await db.get(CrmRecord, rid)
    return r if r is not None and r.object_id == obj.id else None


@router.get("/objects/{key}/records/{rid}")
async def get_record(
    key: str,
    rid: str,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, a = await _object(db, p, key)
    fields = await engine.fields_of(db, obj)
    row = next((r for r in await engine.all_rows(db, obj, fields) if r["id"] == rid), None)
    if row is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_record_not_found", "That record is not here."
        )
    row = engine.strip_hidden([row], a.hidden(obj))[0]
    visible = [f for f in fields if f.key not in a.hidden(obj)]
    history = (
        await db.scalars(
            select(AuditLog)
            .where(
                AuditLog.workspace_id == p.workspace_id, AuditLog.target == f"crm:{obj.key}:{rid}"
            )
            .order_by(AuditLog.ts.desc())
            .limit(30)
        )
    ).all()
    names = {
        u.id: u.name
        for u in (
            await db.scalars(
                select(User).where(User.id.in_({h.actor.removeprefix("user:") for h in history}))
            )
        ).all()
    }
    return {
        "row": row,
        "refs": await _refs(db, p, visible, [row]),
        "history": [
            {"at": h.ts, "who": names.get(h.actor.removeprefix("user:"), h.actor), "action": h.action, "changed": sorted((h.after or {}).keys())}
            for h in history
        ],
    }  # fmt: skip


def _diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    return {k: after.get(k) for k in set(before) | set(after) if before.get(k) != after.get(k)}


@router.post("/objects/{key}/records", status_code=status.HTTP_201_CREATED)
async def add_record(
    key: str,
    body: RecordIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, a = await _object(db, p, key, "edit")
    if obj.kind == "builtin":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_builtin_add",
            "Add these on their own page; the CRM shows them as they are.",
        )
    fields = await engine.fields_of(db, obj)
    values = {k: v for k, v in body.values.items() if k not in a.hidden(obj)}
    try:
        r = await engine.save(db, obj, fields, values, p.actor)
    except CrmError as e:
        raise _fail(e) from e
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.record_added",
        target=f"crm:{obj.key}:{r.id}",
        after=dict(r.data),
    )
    await db.commit()
    return {"id": r.id, "title": r.title, "data": r.data}


@router.patch("/objects/{key}/records/{rid}")
async def change_record(
    key: str,
    rid: str,
    body: RecordIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, a = await _object(db, p, key, "edit")
    fields = await engine.fields_of(db, obj)
    record = await _record(db, obj, rid)
    if record is None and obj.kind != "builtin":
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_record_not_found", "That record is not here."
        )
    if obj.kind == "builtin" and record is None:
        rows = (
            await builtins.SOURCES[str(obj.source)].rows(db, p.workspace_id)
            if obj.source in builtins.SOURCES
            else []
        )
        if not any(str(r["id"]) == rid for r in rows):
            raise api_error(
                status.HTTP_404_NOT_FOUND, "crm_record_not_found", "That record is not here."
            )
    before = dict(record.data or {}) if record else {}
    values = {k: v for k, v in body.values.items() if k not in a.hidden(obj)}
    try:
        record = await engine.save(
            db,
            obj,
            fields,
            values,
            p.actor,
            record,
            external_id=rid if obj.kind == "builtin" else None,
            partial=True,
        )
    except CrmError as e:
        raise _fail(e) from e
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.record_changed",
        target=f"crm:{obj.key}:{rid}",
        after=_diff(before, dict(record.data)),
    )
    await db.commit()
    return {"id": rid, "data": record.data}


@router.delete("/objects/{key}/records/{rid}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_record(
    key: str,
    rid: str,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> None:
    obj, _a = await _object(db, p, key, "edit")
    if obj.kind == "builtin":
        raise api_error(
            status.HTTP_409_CONFLICT, "crm_builtin_delete", "Remove these on their own page."
        )
    r = await _record(db, obj, rid)
    if r is None:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_record_not_found", "That record is not here."
        )
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.record_removed",
        target=f"crm:{obj.key}:{rid}",
        before={"title": r.title},
    )
    await db.delete(r)
    await db.commit()


class ImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csv: str = Field(min_length=1, max_length=3_000_000)
    add_fields: bool = True


@router.post("/objects/{key}/import")
async def import_csv(
    key: str,
    body: ImportIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Rows from a CSV: columns matched to fields by name; new columns become fields (owner)."""
    obj, a = await _object(db, p, key, "edit")
    if obj.kind == "builtin":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_builtin_add",
            "Add these on their own page; the CRM shows them as they are.",
        )
    try:
        rows = connectors.parse_csv(body.csv)
    except connectors.ConnectorError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "crm_bad_csv", str(e)) from e
    fields = await engine.fields_of(db, obj)
    match = {f.label.lower(): f for f in fields} | {f.key: f for f in fields}
    columns = list(rows[0].keys())
    if body.add_fields and a.owner:
        found = {x["path"]: x for x in connectors.infer(rows)}
        pos = max((f.position for f in fields), default=0)
        for col in columns:
            if (
                col.lower() in match
                or slug(col) in match
                or col not in found
                or len(fields) >= MAX_FIELDS
            ):
                continue
            pos += 1
            f = CrmField(workspace_id=p.workspace_id, object_id=obj.id, key=slug(col), label=col[:80], type=found[col]["type"],
                         options={}, position=pos, created_by=p.actor)  # fmt: skip
            if f.key in {x.key for x in fields}:
                continue
            db.add(f)
            fields.append(f)
            match[col.lower()] = f
        await db.flush()
    from ...crm.hub.connectors import _value
    from ...crm.hub.fields import FieldError, coerce

    made, skipped, problems = 0, 0, []
    for i, row in enumerate(rows):
        values: dict[str, Any] = {}
        for col, v in row.items():
            f = match.get(col.lower()) or match.get(slug(col))
            if f is None or f.builtin or f.type == "auto":
                continue
            if f.type in ("select", "multi_select") and v:
                v = _value(f, v)  # a new choice joins the list
            try:
                coerce(f.type, f.options or {}, v)
            except FieldError as e:
                # A bad cell is left empty and reported; the rest of the row is kept.
                if len(problems) < 10:
                    problems.append(f"Row {i + 2}, {f.label}: {e} (left empty)")
                continue
            values[f.key] = v
        try:
            await engine.save(db, obj, fields, values, p.actor)
            made += 1
        except CrmError as e:
            skipped += 1
            if len(problems) < 10:
                problems.append(f"Row {i + 2}: {e.message.format(**e.vars)} (skipped)")
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.imported",
        target=obj.key,
        after={"rows": made, "skipped": skipped},
    )
    await db.commit()
    return {"added": made, "skipped": skipped, "problems": problems}


@router.get("/objects/{key}/export.csv")
async def export_csv(
    key: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> Response:
    obj, a = await _object(db, p, key)
    fields = [f for f in await engine.fields_of(db, obj) if f.key not in a.hidden(obj)]
    rows = await engine.all_rows(db, obj, fields)
    buf = io.StringIO()
    w = csv.writer(buf)
    # P52: cells (and connector-made field names) that start like a formula are quoted, so a
    # value sent in by a web form or another system cannot run when the file is opened.
    w.writerow([csv_safe(f.label) for f in fields])
    for r in rows:
        w.writerow(
            [csv_safe(as_text(f.type, f.options or {}, r["data"].get(f.key))) for f in fields]
        )
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{obj.key}.csv"',
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------- views


class ViewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["table", "board", "calendar", "cards"] = "table"
    config: dict[str, Any] = Field(default_factory=dict)
    position: int | None = Field(default=None, ge=0, le=1000)


@router.post("/objects/{key}/views", status_code=status.HTTP_201_CREATED)
async def add_view(
    key: str,
    body: ViewIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    obj, _a = await _object(db, p, key, "owner")
    last = await db.scalar(select(func.max(CrmView.position)).where(CrmView.object_id == obj.id))
    v = CrmView(workspace_id=p.workspace_id, object_id=obj.id, name=body.name, kind=body.kind, config=body.config,
                position=body.position if body.position is not None else (last or 0) + 1, created_by=p.actor)  # fmt: skip
    db.add(v)
    await db.commit()
    return _view_out(v)


class ViewPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=80)
    kind: Literal["table", "board", "calendar", "cards"] | None = None
    config: dict[str, Any] | None = None
    position: int | None = Field(default=None, ge=0, le=1000)


async def _view(db: AsyncSession, p: Principal, view_id: str) -> CrmView:
    v = await db.get(CrmView, view_id)
    if v is None or v.workspace_id != p.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_view_not_found", "That view is not here.")
    _owner(await _access(db, p))
    return v


@router.patch("/views/{view_id}")
async def change_view(
    view_id: str,
    body: ViewPatch,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    v = await _view(db, p, view_id)
    for k, val in body.model_dump(exclude_unset=True).items():
        setattr(v, k, val)
    await db.commit()
    return _view_out(v)


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_view(
    view_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> None:
    v = await _view(db, p, view_id)
    await db.delete(v)
    await db.commit()


# ---------------------------------------------------------------- dashboard


class WidgetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["number", "bar", "pie", "line", "list"] = "number"
    size: Literal["sm", "md", "lg"] = "sm"
    config: dict[str, Any] = Field(default_factory=dict)
    position: int | None = Field(default=None, ge=0, le=1000)


@router.get("/dashboard")
async def dashboard(
    p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    a = await _access(db, p)
    if not (a.owner or a.dashboard):
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "crm_no_access",
            "The CRM is the owner's. Ask the owner to share it with you.",
        )
    objs = {
        o.key: o
        for o in (
            await db.scalars(select(CrmObject).where(CrmObject.workspace_id == p.workspace_id))
        ).all()
    }
    cache: dict[str, tuple[list[CrmField], list[dict[str, Any]]]] = {}
    tiles = []
    for w in (
        await db.scalars(
            select(CrmWidget)
            .where(CrmWidget.workspace_id == p.workspace_id)
            .order_by(CrmWidget.position)
        )
    ).all():
        obj = objs.get(str((w.config or {}).get("object") or ""))
        if obj is None or not a.sees(obj) or obj.archived:
            continue
        if obj.key not in cache:
            fields = await engine.fields_of(db, obj)
            cache[obj.key] = (
                fields,
                engine.strip_hidden(await engine.all_rows(db, obj, fields), a.hidden(obj)),
            )
        fields, rows = cache[obj.key]
        cfg = w.config or {}
        hidden = a.hidden(obj)
        if cfg.get("field") in hidden or cfg.get("group_by") in hidden:
            continue
        data = engine.aggregate(rows, fields, cfg)
        if w.kind == "list":
            data["rows"] = [
                {"id": r["id"], "title": r["title"]}
                for r in engine.apply(
                    rows, fields, filters=cfg.get("filters") or [], sort=cfg.get("sort") or []
                )[:8]
            ]
        f = next((x for x in fields if x.key == cfg.get("field")), None)
        tiles.append({
            "id": w.id, "title": w.title, "kind": w.kind, "size": w.size, "config": cfg, "position": w.position,
            "object": {"key": obj.key, "name": obj.name, "icon": obj.icon, "color": obj.color},
            "money": bool(f and f.type == "money") and cfg.get("metric") in ("sum", "avg"),
            "data": data,
        })  # fmt: skip
    return {"widgets": tiles, "can_edit": a.owner}


async def _check_widget(db: AsyncSession, p: Principal, cfg: dict[str, Any]) -> None:
    obj = await db.scalar(
        select(CrmObject).where(
            CrmObject.workspace_id == p.workspace_id, CrmObject.key == str(cfg.get("object") or "")
        )
    )
    if obj is None:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "crm_bad_widget", "Pick what the tile counts."
        )
    if cfg.get("metric", "count") not in ("count", "sum", "avg"):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "crm_bad_widget", "Pick count, total or average."
        )


@router.post("/widgets", status_code=status.HTTP_201_CREATED)
async def add_widget(
    body: WidgetIn, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, str]:
    _owner(await _access(db, p))
    await _check_widget(db, p, body.config)
    n = (
        await db.scalar(
            select(func.count())
            .select_from(CrmWidget)
            .where(CrmWidget.workspace_id == p.workspace_id)
        )
        or 0
    )
    if n >= MAX_WIDGETS:
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_too_many",
            "A dashboard can hold up to {n} tiles.",
            n=MAX_WIDGETS,
        )
    w = CrmWidget(workspace_id=p.workspace_id, title=body.title, kind=body.kind, size=body.size, config=body.config,
                  position=body.position if body.position is not None else n + 1, created_by=p.actor)  # fmt: skip
    db.add(w)
    await db.commit()
    return {"id": w.id}


class WidgetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Literal["number", "bar", "pie", "line", "list"] | None = None
    size: Literal["sm", "md", "lg"] | None = None
    config: dict[str, Any] | None = None
    position: int | None = Field(default=None, ge=0, le=1000)


@router.patch("/widgets/{widget_id}")
async def change_widget(
    widget_id: str,
    body: WidgetPatch,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _owner(await _access(db, p))
    w = await db.get(CrmWidget, widget_id)
    if w is None or w.workspace_id != p.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_widget_not_found", "That tile is not here.")
    sent = body.model_dump(exclude_unset=True)
    if "config" in sent and sent["config"] is not None:
        await _check_widget(db, p, sent["config"])
    for k, v in sent.items():
        setattr(w, k, v)
    await db.commit()
    return {"id": w.id}


@router.delete("/widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_widget(
    widget_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> None:
    _owner(await _access(db, p))
    w = await db.get(CrmWidget, widget_id)
    if w is None or w.workspace_id != p.workspace_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_widget_not_found", "That tile is not here.")
    await db.delete(w)
    await db.commit()


# ---------------------------------------------------------------- integrations


def _conn_out(c: CrmConnector, obj: CrmObject | None) -> dict[str, Any]:
    return {
        "id": c.id, "name": c.name, "kind": c.kind, "preset": c.preset, "config": connectors.public(c),
        "object": {"key": obj.key, "name": obj.name} if obj else None, "every_minutes": c.every_minutes,
        "enabled": c.enabled, "last_sync_at": c.last_sync_at, "last_status": c.last_status,
        "last_error": c.last_error, "stats": c.stats or {},
    }  # fmt: skip


@router.get("/connectors")
async def list_connectors(
    p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    _owner(await _access(db, p))
    rows = (
        await db.scalars(
            select(CrmConnector)
            .where(CrmConnector.workspace_id == p.workspace_id)
            .order_by(CrmConnector.created_at)
        )
    ).all()
    out = []
    for c in rows:
        out.append(_conn_out(c, await db.get(CrmObject, c.object_id) if c.object_id else None))
    return {"connectors": out, "presets": connectors.PRESETS}


class ConnTestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["rest", "csv"]
    config: dict[str, Any] = Field(default_factory=dict)
    secret: str = Field(default="", max_length=4000)


@router.post("/connectors/test")
async def test_connector(
    body: ConnTestIn, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Read it once (nothing is saved): the fields found, and the first rows."""
    _owner(await _access(db, p))
    try:
        records = await connectors.fetch(body.kind, body.config, body.secret)
    except connectors.ConnectorError as e:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "crm_connector_failed", str(e)
        ) from e
    from ...crm.hub.fields import flatten

    return {
        "count": len(records),
        "fields": connectors.infer(records),
        "sample": [flatten(r) for r in records[:5]],
    }


class ConnField(BaseModel):
    model_config = ConfigDict(extra="ignore")  # what the test showed (a sample) may come back
    key: str = Field(max_length=60)
    label: str = Field(min_length=1, max_length=80)
    type: str = Field(max_length=20)
    path: str = Field(max_length=200)
    include: bool = True


class ConnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["rest", "csv", "webhook"]
    preset: str | None = Field(default=None, max_length=40)
    config: dict[str, Any] = Field(default_factory=dict)
    secret: str = Field(default="", max_length=4000)
    fields: list[ConnField] = Field(default_factory=list, max_length=60)
    title_field: str | None = Field(default=None, max_length=60)
    object_name: str = Field(default="", max_length=80)
    icon: str = Field(default="plugs-connected", max_length=40, pattern=r"^[a-z0-9\-]+$")
    every_minutes: int = Field(default=60, ge=15, le=10_080)


@router.post("/connectors", status_code=status.HTTP_201_CREATED)
async def add_connector(
    body: ConnIn, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    _owner(await _access(db, p))
    chosen = [f for f in body.fields if f.include and f.type in TYPES]
    title = (
        body.title_field
        if body.title_field in {f.key for f in chosen}
        else (chosen[0].key if chosen else "name")
    )
    key = slug(body.object_name or body.name, "synced")
    taken = {
        k
        for (k,) in (
            await db.execute(select(CrmObject.key).where(CrmObject.workspace_id == p.workspace_id))
        ).all()
    } | set(builtins.SOURCES)
    base, i = key, 2
    while key in taken:
        key, i = f"{base}_{i}", i + 1
    last = await db.scalar(
        select(func.max(CrmObject.position)).where(CrmObject.workspace_id == p.workspace_id)
    )
    obj = CrmObject(workspace_id=p.workspace_id, key=key, name=(body.object_name or body.name).strip()[:80], singular="",
                    icon=body.icon, color="#2f6db5", kind="synced", title_field=title, position=(last or 0) + 1, meta={}, created_by=p.actor)  # fmt: skip
    db.add(obj)
    await db.flush()
    used: set[str] = set()
    for pos, f in enumerate(chosen):
        fkey = slug(f.key or f.label)
        while fkey in used:
            fkey = f"{fkey}_x"
        used.add(fkey)
        db.add(CrmField(workspace_id=p.workspace_id, object_id=obj.id, key=fkey, label=f.label, type=f.type, options={},
                        source_path=f.path, position=pos, created_by=p.actor))  # fmt: skip
    if body.kind == "webhook" and not chosen:
        db.add(CrmField(workspace_id=p.workspace_id, object_id=obj.id, key="name", label="Name", type="text", options={},
                        source_path="name", position=0, created_by=p.actor))  # fmt: skip
    c = CrmConnector(workspace_id=p.workspace_id, name=body.name, kind=body.kind, preset=body.preset,
                     config={k: v for k, v in body.config.items() if k != "secret"}, object_id=obj.id,
                     every_minutes=body.every_minutes, created_by=p.actor)  # fmt: skip
    db.add(c)
    await db.flush()
    if body.secret:
        c.config = {**c.config, "secret_enc": connectors.seal(c.id, body.secret)}
    token = None
    if body.kind == "webhook":
        token, c.webhook_hash = connectors.new_webhook_token()
    obj.connector_id = c.id
    await templates.default_views(db, obj, await engine.fields_of(db, obj), p.actor)
    await audit.record(
        db,
        p.workspace_id,
        p.actor,
        "crm.connector_added",
        target=c.id,
        after={"name": c.name, "kind": c.kind},
    )
    await db.commit()
    stats: dict[str, Any] = {}
    if body.kind != "webhook":
        stats = await connectors.sync(db, c)
        # A failed first sync rolls back, which expires both rows: load them again.
        c = await db.get(CrmConnector, c.id) or c
        obj = await db.get(CrmObject, c.object_id) if c.object_id else None
    out = _conn_out(c, obj)
    out["sync"] = stats
    if token:
        out["webhook_path"] = f"/api/crm/hooks/{token}"  # shown once
    return out


@router.post("/connectors/{conn_id}/sync")
async def sync_connector(
    conn_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    _owner(await _access(db, p))
    c = await db.get(CrmConnector, conn_id)
    if c is None or c.workspace_id != p.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_connector_not_found", "That connection is not here."
        )
    if c.kind == "webhook":
        raise api_error(
            status.HTTP_409_CONFLICT,
            "crm_webhook_sync",
            "This one is sent records by the other system; nothing to fetch.",
        )
    stats = await connectors.sync(db, c)
    c = await db.get(CrmConnector, conn_id) or c
    out = _conn_out(c, await db.get(CrmObject, c.object_id) if c.object_id else None)
    out["sync"] = stats
    return out


@router.post("/connectors/{conn_id}/new-address")
async def new_hook_address(
    conn_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """A webhook's address is kept only as a hash, so it is shown once. Lost it: a new one
    (the old address stops working at once)."""
    _owner(await _access(db, p))
    c = await db.get(CrmConnector, conn_id)
    if c is None or c.workspace_id != p.workspace_id or c.kind != "webhook":
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_connector_not_found", "That connection is not here."
        )
    token, c.webhook_hash = connectors.new_webhook_token()
    await audit.record(db, p.workspace_id, p.actor, "crm.connector_new_address", target=c.id)
    await db.commit()
    out = _conn_out(c, await db.get(CrmObject, c.object_id) if c.object_id else None)
    out["webhook_path"] = f"/api/crm/hooks/{token}"  # shown once
    return out


class ConnPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    every_minutes: int | None = Field(default=None, ge=15, le=10_080)
    secret: str | None = Field(default=None, max_length=4000)
    config: dict[str, Any] | None = None


@router.patch("/connectors/{conn_id}")
async def change_connector(
    conn_id: str,
    body: ConnPatch,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _owner(await _access(db, p))
    c = await db.get(CrmConnector, conn_id)
    if c is None or c.workspace_id != p.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_connector_not_found", "That connection is not here."
        )
    sent = body.model_dump(exclude_unset=True)
    if sent.get("config") is not None:
        c.config = {**{k: v for k, v in sent.pop("config").items() if not k.endswith("_enc")},
                    **{k: v for k, v in (c.config or {}).items() if k.endswith("_enc")}}  # fmt: skip
    if "secret" in sent:
        secret = sent.pop("secret")
        cfg = {k: v for k, v in (c.config or {}).items() if k != "secret_enc"}
        if secret:
            cfg["secret_enc"] = connectors.seal(c.id, secret)
        c.config = cfg
    for k, v in sent.items():
        setattr(c, k, v)
    await db.commit()
    return _conn_out(c, await db.get(CrmObject, c.object_id) if c.object_id else None)


@router.delete("/connectors/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_connector(
    conn_id: str, p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> None:
    """Stops reading the other system; the records already read stay in their object."""
    _owner(await _access(db, p))
    c = await db.get(CrmConnector, conn_id)
    if c is None or c.workspace_id != p.workspace_id:
        raise api_error(
            status.HTTP_404_NOT_FOUND, "crm_connector_not_found", "That connection is not here."
        )
    if c.object_id and (obj := await db.get(CrmObject, c.object_id)) is not None:
        obj.connector_id = None
    await audit.record(
        db, p.workspace_id, p.actor, "crm.connector_removed", target=c.id, before={"name": c.name}
    )
    await db.delete(c)
    await db.commit()


HOOK_BYTES = 2 * 1024 * 1024


@router.post("/hooks/{token}")
async def webhook_in(
    token: str, request: Request, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """The other system sends one record or a list (JSON). No session: the token is the key."""
    import json

    c = await db.scalar(
        select(CrmConnector).where(CrmConnector.webhook_hash == connectors.token_hash(token))
    )
    if c is None or not c.enabled or c.kind != "webhook" or not c.object_id:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_hook_not_found", "Not found.")
    raw = await request.body()
    if len(raw) > HOOK_BYTES:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE, "too_large", "Send at most 2 MB at a time."
        )
    try:
        body = json.loads(raw or b"null")
    except ValueError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_json", "Send JSON.") from e
    records = body if isinstance(body, list) else [body]
    records = [r for r in records if isinstance(r, dict)][: connectors.MAX_RECORDS]
    obj = await db.get(CrmObject, c.object_id)
    if obj is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "crm_hook_not_found", "Not found.")
    stats = await connectors.upsert(
        db, obj, records, str((c.config or {}).get("id_path") or "id"), f"connector:{c.id}"
    )
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    c.last_sync_at, c.last_status, c.last_error = now, "ok", None
    c.stats = {**stats, "at": now.isoformat()}
    await db.commit()
    return stats


# ---------------------------------------------------------------- who else sees it


@router.get("/people")
async def people(
    p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    """The workspace's people, to pick in a person field (anyone with CRM access)."""
    a = await _access(db, p)
    if not a.any:
        raise api_error(
            status.HTTP_403_FORBIDDEN,
            "crm_no_access",
            "The CRM is the owner's. Ask the owner to share it with you.",
        )
    rows = (
        await db.execute(
            select(User.id, User.name, User.email, Membership.role)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == p.workspace_id)
            .order_by(User.name)
        )
    ).all()
    if not a.owner:  # a person field only needs names
        return [{"id": uid, "name": name} for uid, name, _, _ in rows]
    # The owner, when sharing: who is an owner already (sees everything), and their email.
    return [
        {"id": uid, "name": name, "email": email, "owner": role == "owner"}
        for uid, name, email, role in rows
    ]


@router.get("/access")
async def list_access(
    p: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> list[dict[str, Any]]:
    _owner(await _access(db, p))
    grants = (
        await db.scalars(select(CrmAccess).where(CrmAccess.workspace_id == p.workspace_id))
    ).all()
    users = {
        u.id: u
        for u in (
            await db.scalars(select(User).where(User.id.in_({g.user_id for g in grants})))
        ).all()
    }
    by_user: dict[str, dict[str, Any]] = {}
    for g in grants:
        u = users.get(g.user_id)
        entry = by_user.setdefault(
            g.user_id,
            {
                "user_id": g.user_id,
                "name": u.name if u else "-",
                "email": u.email if u else "",
                "dashboard": False,
                "objects": [],
            },
        )
        if g.object_id is None:
            entry["dashboard"] = True
        else:
            entry["objects"].append(
                {"object_id": g.object_id, "level": g.level, "hidden_fields": g.hidden_fields or []}
            )
    return list(by_user.values())


class GrantObject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    object_id: str = Field(max_length=40)
    level: Literal["view", "edit"] = "view"
    hidden_fields: list[str] = Field(default_factory=list, max_length=80)


class GrantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dashboard: bool = False
    objects: list[GrantObject] = Field(default_factory=list, max_length=MAX_OBJECTS)


@router.put("/access/{user_id}")
async def set_access(
    user_id: str,
    body: GrantIn,
    p: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Replace what one person may see in the CRM (no objects and no dashboard: nothing)."""
    _owner(await _access(db, p))
    m = await db.scalar(
        select(Membership).where(
            Membership.workspace_id == p.workspace_id, Membership.user_id == user_id
        )
    )
    if m is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "member_not_found", "That person is not here.")
    if m.role == "owner":
        raise api_error(
            status.HTTP_409_CONFLICT, "crm_owner_sees_all", "An owner already sees the whole CRM."
        )
    ids = {
        o.id
        for o in (
            await db.scalars(select(CrmObject).where(CrmObject.workspace_id == p.workspace_id))
        ).all()
    }
    await db.execute(
        delete(CrmAccess).where(
            CrmAccess.workspace_id == p.workspace_id, CrmAccess.user_id == user_id
        )
    )
    if body.dashboard:
        db.add(
            CrmAccess(
                workspace_id=p.workspace_id,
                user_id=user_id,
                object_id=None,
                level="view",
                hidden_fields=[],
                granted_by=p.actor,
            )
        )
    for g in body.objects:
        if g.object_id in ids:
            db.add(CrmAccess(workspace_id=p.workspace_id, user_id=user_id, object_id=g.object_id, level=g.level,
                             hidden_fields=list(dict.fromkeys(g.hidden_fields)), granted_by=p.actor))  # fmt: skip
    await audit.record(db, p.workspace_id, p.actor, "crm.access_changed", target=user_id,
                       after={"dashboard": body.dashboard, "objects": [g.model_dump() for g in body.objects]})  # fmt: skip
    await db.commit()
    return {
        "user_id": user_id,
        "dashboard": body.dashboard,
        "objects": [g.model_dump() for g in body.objects if g.object_id in ids],
    }
