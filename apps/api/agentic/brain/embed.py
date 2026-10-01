"""Text embeddings, computed locally (fastembed + ONNX on CPU), so search costs no tokens.

The model loads lazily on first use and is shared by every request in the process. If it
cannot load, callers get None and search falls back to keywords and links.
"""

import asyncio
import hashlib
import logging
import math
import re
import threading
from typing import Any

from ..core.config import settings
from ..models import EMBED_DIMS

log = logging.getLogger("agentic.brain.embed")

_lock = threading.Lock()
_model: Any = None
_failed = False
_WORD = re.compile(r"\w+", re.UNICODE)


def hash_vector(text: str) -> list[float]:
    """Bag of words hashed into EMBED_DIMS buckets. Deterministic, for tests only."""
    v = [0.0] * EMBED_DIMS
    for w in _WORD.findall(text.lower()):
        v[int.from_bytes(hashlib.blake2b(w.encode(), digest_size=4).digest()) % EMBED_DIMS] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def _load() -> Any:
    global _model, _failed
    with _lock:
        if _model is None and not _failed:
            try:
                from fastembed import TextEmbedding

                _model = TextEmbedding(
                    settings.embed_model,
                    cache_dir=settings.embed_cache or None,
                    threads=settings.embed_threads,
                )
                log.info("embedding model %s loaded", settings.embed_model)
            except Exception:  # noqa: BLE001 - search degrades instead of failing
                log.warning("embedding model unavailable; keyword search only", exc_info=True)
                _failed = True
    return _model


def available() -> bool:
    return settings.embed_backend == "hash" or (
        settings.embed_backend == "local" and _load() is not None
    )


def _embed_sync(texts: list[str]) -> list[list[float]] | None:
    if settings.embed_backend == "hash":
        return [hash_vector(t) for t in texts]
    if settings.embed_backend != "local":
        return None
    model = _load()
    if model is None:
        return None
    return [vec.tolist() for vec in model.embed(texts, batch_size=16)]


async def embed(texts: list[str]) -> list[list[float]] | None:
    if not texts:
        return []
    return await asyncio.to_thread(_embed_sync, texts)


async def embed_one(text: str) -> list[float] | None:
    out = await embed([text])
    return out[0] if out else None


async def warm() -> None:
    """Load the model in the background at startup so the first search is not slow."""
    if settings.embed_backend == "local":
        await asyncio.to_thread(_load)
