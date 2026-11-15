"""P105: the two Azure AI Foundry models share the work at the top of the chat groups.

Fitri (15 Nov 2026) put Azure AI Foundry (DeepSeek-V4.1-Flash-1017) and Azure AI Foundry 2
(the arisha-gpt41-mini deployment) first in smart, fast and bulk and asked for both to be the
main AI, taking turns. A group's members can now be marked "shared" (they take turns, see
agentic/engine/rotation.py). This marks those two shared, in every group whose FIRST TWO
members are exactly those two models (either order) on two Azure providers, and only when no
member of the group is marked shared yet: any other choice the owner made is left alone.

Data only (members is JSONB). Downgrade removes the shared marks again (older code ignores
them anyway).

Revision ID: 0065
Revises: 0064
Create Date: 2026-11-15 18:00:00
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POOL = {"DeepSeek-V4.1-Flash-1017", "arisha-gpt41-mini"}


def _azure(provider: sa.Row | None) -> bool:
    if provider is None:
        return False
    return provider.preset == "azure-foundry" or "azure.com" in (provider.base_url or "").lower()


def _members(raw: object) -> list[dict]:
    if isinstance(raw, str):
        raw = json.loads(raw)
    return list(raw) if isinstance(raw, list) else []


def upgrade() -> None:
    conn = op.get_bind()
    providers = {
        r.id: r for r in conn.execute(sa.text("SELECT id, preset, base_url FROM ai_providers"))
    }
    for g in conn.execute(sa.text("SELECT id, members FROM model_groups")).all():
        members = _members(g.members)
        if len(members) < 2 or any(m.get("shared") for m in members):
            continue
        first, second = members[0], members[1]
        if {first.get("model_id"), second.get("model_id")} != POOL:
            continue
        if first.get("provider_id") == second.get("provider_id"):
            continue
        if not (
            _azure(providers.get(first.get("provider_id")))
            and _azure(providers.get(second.get("provider_id")))
        ):
            continue
        members[0] = {**first, "shared": True}
        members[1] = {**second, "shared": True}
        conn.execute(
            sa.text("UPDATE model_groups SET members = CAST(:m AS jsonb) WHERE id = :id"),
            {"m": json.dumps(members), "id": g.id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for g in conn.execute(sa.text("SELECT id, members FROM model_groups")).all():
        members = _members(g.members)
        if not any(m.get("shared") for m in members):
            continue
        plain = [{k: v for k, v in m.items() if k != "shared"} for m in members]
        conn.execute(
            sa.text("UPDATE model_groups SET members = CAST(:m AS jsonb) WHERE id = :id"),
            {"m": json.dumps(plain), "id": g.id},
        )
