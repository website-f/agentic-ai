from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Tier = Literal["free", "paid", "local"]


def _clean_url(v: str) -> str:
    v = v.strip().rstrip("/")
    if not v.startswith(("http://", "https://")):
        raise ValueError("Start the address with https://")
    return v


class PresetOut(BaseModel):
    id: str
    name: str
    base_url: str
    tier: Tier
    priority: int
    key_url: str
    key_check: str
    key_check_fallback: str | None
    suggested_models: list[str]
    notes: str
    primary: bool


class CheckOut(BaseModel):
    ts: datetime
    ok: bool
    latency_ms: int | None


class ProviderOut(BaseModel):
    id: str
    name: str
    preset: str | None
    base_url: str
    key_hint: str
    has_key: bool
    tier: Tier
    priority: int
    enabled: bool
    health: str
    cooling_seconds: int
    # P29: models resting on their own (a per-model 403/404/429), seconds left each.
    cooling_models: dict[str, int] = {}
    last_test_at: datetime | None
    last_test_result: dict[str, Any] | None
    model_count: int
    recent_checks: list[CheckOut]


class AISettingsOut(BaseModel):
    max_task_model_calls: int
    hard_max_task_model_calls: int


class AISettingsUpdateIn(BaseModel):
    max_task_model_calls: int = Field(ge=1, le=200)


class ProviderCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    preset: str | None = None
    base_url: str = Field(max_length=300)
    api_key: str = Field(min_length=8, max_length=500)
    tier: Tier = "paid"
    enabled: bool = True

    _url = field_validator("base_url")(_clean_url)


class ProviderUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    base_url: str | None = Field(default=None, max_length=300)
    # Blank keeps the saved key. Required when base_url changes (see router).
    api_key: str | None = Field(default=None, max_length=500)
    tier: Tier | None = None
    enabled: bool | None = None

    @field_validator("base_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return _clean_url(v) if v else v


class OrderIn(BaseModel):
    ids: list[str]


class TestIn(BaseModel):
    provider_id: str | None = None
    # For a provider that is not saved yet:
    preset: str | None = None
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    tier: Tier = "paid"
    model: str | None = Field(default=None, max_length=200)
    capabilities: bool = False

    @field_validator("base_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return _clean_url(v) if v else v


class DiscoverIn(BaseModel):
    base_url: str
    api_key: str = Field(min_length=8, max_length=500)

    _url = field_validator("base_url")(_clean_url)


class ModelOut(BaseModel):
    id: str
    provider_id: str
    model_id: str
    context_window: int | None
    caps: dict[str, Any]
    price_in: float | None
    price_out: float | None
    price_cached_in: float | None
    stale: bool


class ModelUpdateIn(BaseModel):
    price_in: float | None = Field(default=None, ge=0, le=10_000)
    price_out: float | None = Field(default=None, ge=0, le=10_000)
    price_cached_in: float | None = Field(default=None, ge=0, le=10_000)
    caps: dict[str, bool] | None = None


class GroupMember(BaseModel):
    provider_id: str
    model_id: str = Field(min_length=1, max_length=200)


class GroupOut(BaseModel):
    name: str
    label: str
    description: str
    members: list[GroupMember]
    # chat | embed | transcribe | image: pickers for an agent's model offer chat groups only.
    kind: str = "chat"


class GroupUpdateIn(BaseModel):
    members: list[GroupMember] = Field(max_length=20)


class PlaygroundIn(BaseModel):
    group: str
    prompt: str = Field(min_length=1, max_length=8000)
    system: str | None = Field(default=None, max_length=4000)
    max_tokens: int = Field(default=400, ge=1, le=4000)


class PlaygroundOut(BaseModel):
    content: str
    provider_name: str
    model: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int
    cost_usd: float | None
    attempts: list[dict[str, Any]]
