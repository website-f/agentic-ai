"""A person's own small settings (P19): GET / PUT /api/me/prefs.

Only the whitelisted keys in services/prefs.py are read or written (tutorial, onboarding).
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...models import User
from ...services import prefs
from ..deps import Principal, api_error, current_principal

router = APIRouter(prefix="/api/me", tags=["prefs"])


@router.get("/prefs")
async def get_prefs(
    principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    user = await db.get(User, principal.user.id)
    return prefs.visible(user.prefs if user else None)


@router.put("/prefs")
async def put_prefs(
    body: dict[str, Any] = Body(...),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Merge a few settings in: {"tutorial": {"done": [...], "dismissed": true}}."""
    try:
        out = await prefs.update(db, principal.user.id, body)
    except prefs.PrefsError as e:
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "bad_prefs", str(e)) from e
    await db.commit()
    return out
