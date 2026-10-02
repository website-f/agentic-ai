"""Validated workspace-level runtime settings."""

from collections.abc import Mapping
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
