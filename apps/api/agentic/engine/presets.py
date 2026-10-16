"""Known providers. All speak the OpenAI-compatible /models, /chat/completions and
/embeddings shape, so one client covers them. Endpoints were current on 2026-10-01;
providers do move these, so the UI lets every field be edited."""

from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse


@dataclass(frozen=True)
class Preset:
    id: str
    name: str
    base_url: str
    tier: str  # free | paid | local
    priority: int
    key_url: str  # where the person gets a key
    # Path (relative to base_url) or absolute URL that proves the key is valid. /models
    # is public on some providers (OpenRouter, HuggingFace router: verified 2026-10-01 by
    # a fake key listing 134 models), so those get a dedicated key endpoint.
    key_check: str = "/models"
    key_check_fallback: str | None = None
    # Tried in order when picking a model for the connection test.
    suggested_models: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""
    # P33: what the provider does with what it is sent (static, honest, shown on the page),
    # whether it starts trusted with Confidential companies, and whether zero data retention
    # is asked for on every call (OpenRouter).
    data_policy_note: str = "Check this provider's data policy."
    trusted: bool = False
    require_zdr: bool = False

    def public(self) -> dict:
        d = asdict(self)
        d["suggested_models"] = list(self.suggested_models)
        return d


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="groq",
        name="Groq",
        base_url="https://api.groq.com/openai/v1",
        tier="free",
        priority=10,
        key_url="https://console.groq.com/keys",
        suggested_models=("llama-3.1-8b-instant", "llama-3.3-70b-versatile"),
        notes="Very fast. Free tier limits reset per minute and per day.",
        data_policy_note="Check data retention on your plan.",
    ),
    Preset(
        id="openrouter",
        name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        tier="free",
        priority=20,
        key_url="https://openrouter.ai/keys",
        key_check="/key",
        suggested_models=("meta-llama/llama-3.3-70b-instruct:free", "openrouter/auto"),
        notes="One key for hundreds of models. Models ending in :free cost nothing.",
        data_policy_note=(
            "OpenRouter keeps no prompts; free endpoints may log or train - keep 'Require "
            "zero data retention' on."
        ),
        require_zdr=True,
    ),
    Preset(
        id="mistral",
        name="Mistral",
        base_url="https://api.mistral.ai/v1",
        tier="free",
        priority=30,
        key_url="https://console.mistral.ai/api-keys",
        suggested_models=("mistral-small-latest", "open-mistral-nemo"),
        notes="Has embeddings (mistral-embed).",
    ),
    Preset(
        id="huggingface",
        name="HuggingFace",
        base_url="https://router.huggingface.co/v1",
        tier="free",
        priority=40,
        key_url="https://huggingface.co/settings/tokens",
        # The router's /models is public, so it cannot prove the token works.
        key_check="https://huggingface.co/api/whoami-v2",
        suggested_models=("meta-llama/Llama-3.1-8B-Instruct", "Qwen/Qwen2.5-7B-Instruct"),
        notes="Use a token with the 'Make calls to Inference Providers' permission.",
    ),
    Preset(
        id="deepseek",
        name="DeepSeek",
        base_url="https://api.deepseek.com/v1",
        tier="paid",
        priority=50,
        key_url="https://platform.deepseek.com/api_keys",
        suggested_models=("deepseek-chat",),
        notes="Repeated prompt prefixes are cached automatically and billed lower.",
        data_policy_note=(
            "Processed and stored in China; trains on API data unless you opt out; no "
            "zero-retention option."
        ),
    ),
    Preset(
        id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        tier="paid",
        priority=60,
        key_url="https://platform.openai.com/api-keys",
        suggested_models=("gpt-4o-mini", "gpt-4.1-mini"),
        notes="Prompts over 1,024 tokens are cached automatically.",
        data_policy_note=(
            "API data is not used for training by default; may be kept briefly for abuse "
            "monitoring."
        ),
        trusted=True,
    ),
    Preset(
        id="anthropic",
        name="Anthropic",
        base_url="https://api.anthropic.com/v1",
        tier="paid",
        priority=70,
        key_url="https://console.anthropic.com/settings/keys",
        suggested_models=("claude-haiku-4-5",),
        notes="Optional. Uses Anthropic's OpenAI-compatible endpoint.",
        data_policy_note="API data is not used for training by default.",
        trusted=True,
    ),
    Preset(
        id="gemini",
        name="Gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        tier="free",
        priority=80,
        key_url="https://aistudio.google.com/apikey",
        suggested_models=("gemini-2.5-flash",),
        notes="Optional. Uses Google's OpenAI-compatible endpoint.",
        data_policy_note=(
            "Free tier: Google uses prompts to improve its products; paid tier does not."
        ),
    ),
)

BY_ID = {p.id: p for p in PRESETS}

# The six the workspace owner already uses; the page offers these first.
PRIMARY = ("groq", "openrouter", "huggingface", "mistral", "deepseek", "openai")

LOCAL_NOTE = "Runs on your own server; nothing leaves."
UNKNOWN_NOTE = "Check this provider's data policy."


def preset_of(preset_id: str | None, base_url: str = "") -> Preset | None:
    """The preset a provider was made from, or the one whose address it uses (providers
    added by hand keep the same data policy as their preset)."""
    if preset_id and preset_id in BY_ID:
        return BY_ID[preset_id]
    host = urlparse(base_url).hostname or ""
    for p in PRESETS:
        if host and host == urlparse(p.base_url).hostname:
            return p
    return None


def data_policy_note(preset_id: str | None, base_url: str, tier: str) -> str:
    if tier == "local":
        return LOCAL_NOTE
    p = preset_of(preset_id, base_url)
    return p.data_policy_note if p else UNKNOWN_NOTE
