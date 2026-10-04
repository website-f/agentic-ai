"""Moving dev data to production: every stored secret is re-wrapped under the new master key
without being decrypted, a re-run is harmless, and the old key no longer opens anything."""

import base64
import os

import pytest
from sqlalchemy import select

from agentic import admin
from agentic.core import crypto
from agentic.core.config import settings
from agentic.core.db import SessionLocal
from agentic.models import AIProvider

from .test_agents import GOOD_KEY, llm, office, temporal  # noqa: F401


def test_rewrap_keeps_the_secret_and_drops_the_old_key():
    old, new = os.urandom(32), os.urandom(32)
    k = base64.urlsafe_b64encode(old).decode()
    token = None
    saved = settings.master_key
    try:
        settings.master_key = k
        token = crypto.encrypt("sk-live-123", "ai_provider:ap_1")
        moved = crypto.rewrap(token, "ai_provider:ap_1", old, new)
        assert moved.split(".")[2] == token.split(".")[2]  # the sealed secret is untouched
        settings.master_key = base64.urlsafe_b64encode(new).decode()
        assert crypto.decrypt(moved, "ai_provider:ap_1") == "sk-live-123"
        with pytest.raises(crypto.DecryptError):
            crypto.decrypt(token, "ai_provider:ap_1")
        with pytest.raises(crypto.DecryptError):
            crypto.rewrap(moved, "ai_provider:ap_2", new, old)  # wrong row
    finally:
        settings.master_key = saved


async def test_rotate_from_dev_moves_every_secret(client, llm, temporal):
    await office(client)  # saves a provider key with the dev-derived master key
    saved = settings.master_key
    new = base64.urlsafe_b64encode(os.urandom(32)).decode()
    try:
        settings.master_key = new
        await admin.rotate_master_key(from_dev=True)
        async with SessionLocal() as db:
            p = await db.scalar(select(AIProvider))
            assert p is not None
            assert crypto.decrypt(p.api_key_enc, p.aad) == GOOD_KEY
        await admin.rotate_master_key(from_dev=True)  # a re-run changes nothing
    finally:
        settings.master_key = saved
