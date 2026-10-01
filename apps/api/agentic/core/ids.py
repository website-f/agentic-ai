"""Prefixed, sortable IDs: `ws_01j9...`, `us_01j9...`. Prefix tells you the type at a glance."""

from ulid import ULID


def new_id(prefix: str) -> str:
    return f"{prefix}_{str(ULID()).lower()}"
