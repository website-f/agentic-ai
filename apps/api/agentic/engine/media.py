"""Voice and pictures (P18): the two non-chat model groups, which provider models fill them,
what they cost, and the small helpers the gateway and channels share.

- "transcribe": speech to text (OpenAI-compatible POST /audio/transcriptions). Used for
  WhatsApp and Telegram voice notes and the dashboard microphone.
- "image": picture generation (POST /images/generations), used by the generate_image tool.

Both groups start empty. When the workspace has a Groq or OpenAI provider, their speech and
image models are added once: when the group is first created, or when such a provider is
added while the group is still empty. A person who empties a group keeps it empty.
"""

import re
from decimal import Decimal
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AIProvider, ModelGroup

TRANSCRIBE = "transcribe"
IMAGE = "image"
GROUPS: tuple[tuple[str, str, str], ...] = (
    (
        TRANSCRIBE,
        "Speech to text",
        "Turns voice notes (WhatsApp, Telegram) and the dashboard microphone into text. "
        "Whisper models, e.g. Groq whisper-large-v3-turbo or OpenAI gpt-4o-mini-transcribe.",
    ),
    (
        IMAGE,
        "Image generation",
        "Makes pictures for agents (generate_image). OpenAI gpt-image-1 or dall-e-3. Each "
        "picture costs money, so agents ask a person first.",
    ),
)
NAMES = frozenset(g[0] for g in GROUPS)
# Groups that never answer a chat prompt (agents, the playground and the tester skip them).
NOT_CHAT = frozenset({"embed", *NAMES})

# Known speech and image models of the providers that offer them, best first.
SUGGESTED: dict[str, dict[str, tuple[str, ...]]] = {
    TRANSCRIBE: {
        "groq": ("whisper-large-v3-turbo", "whisper-large-v3"),
        "openai": ("gpt-4o-mini-transcribe", "whisper-1"),
    },
    IMAGE: {"openai": ("gpt-image-1", "dall-e-3")},
}
_HOSTS = {"api.groq.com": "groq", "api.openai.com": "openai"}

# Published list prices (USD), checked 2026-10. Speech is billed by audio length, pictures
# per image, so llm_calls carries an estimate; anything not listed is shown as unpriced.
PER_MINUTE: dict[str, Decimal] = {
    "whisper-large-v3-turbo": Decimal("0.000667"),  # Groq: $0.04 per hour
    "whisper-large-v3": Decimal("0.00185"),  # Groq: $0.111 per hour
    "distil-whisper-large-v3-en": Decimal("0.000333"),
    "whisper-1": Decimal("0.006"),
    "gpt-4o-transcribe": Decimal("0.006"),
    "gpt-4o-mini-transcribe": Decimal("0.003"),
}
GROQ_MIN_SECONDS = 10  # Groq bills at least 10 seconds per request
PER_IMAGE: dict[tuple[str, str], Decimal] = {
    ("gpt-image-1", "square"): Decimal("0.042"),  # quality "medium"
    ("gpt-image-1", "wide"): Decimal("0.063"),
    ("gpt-image-1-mini", "square"): Decimal("0.011"),
    ("gpt-image-1-mini", "wide"): Decimal("0.015"),
    ("dall-e-3", "square"): Decimal("0.040"),  # quality "standard"
    ("dall-e-3", "wide"): Decimal("0.080"),
    ("dall-e-2", "square"): Decimal("0.020"),
}

MAX_AUDIO_SECONDS = 10 * 60
MAX_AUDIO_MB = 25

AUDIO_EXT = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
}


def bare_mime(mime: str) -> str:
    return (mime or "").split(";", 1)[0].strip().lower()


def is_audio(mime: str) -> bool:
    m = bare_mime(mime)
    return m.startswith("audio/") or m in ("video/webm", "video/mp4")


def audio_filename(mime: str) -> str:
    """Providers tell formats apart by the file name, so it must carry the right ending."""
    return f"voice.{AUDIO_EXT.get(bare_mime(mime), 'ogg')}"


def _bare(model: str) -> str:
    return model.lower().rsplit("/", 1)[-1].split(":", 1)[0]


def transcribe_cost(model: str, seconds: float | None, tier: str) -> Decimal | None:
    if tier in ("free", "local"):
        return Decimal(0)
    per_min = PER_MINUTE.get(_bare(model))
    if per_min is None or seconds is None:
        return None
    if _bare(model).startswith(("whisper-large", "distil-whisper")):
        seconds = max(seconds, GROQ_MIN_SECONDS)
    return (per_min * Decimal(str(seconds)) / Decimal(60)).quantize(Decimal("0.000001"))


# ---------------------------------------------------------------- picture sizes

SHAPES = ("square", "landscape", "portrait")
_WXH = re.compile(r"^(\d{3,4})x(\d{3,4})$")


def image_size(model: str, shape: str) -> str:
    """The size string this model accepts for a shape (or a WxH it was given)."""
    if _WXH.match(shape or ""):
        return shape
    bare = _bare(model)
    if shape == "landscape":
        return "1792x1024" if bare == "dall-e-3" else "1536x1024"
    if shape == "portrait":
        return "1024x1792" if bare == "dall-e-3" else "1024x1536"
    return "1024x1024"


def image_quality(model: str) -> str | None:
    """Middle quality: good enough for office use at a sensible price."""
    bare = _bare(model)
    if bare.startswith("gpt-image"):
        return "medium"
    if bare == "dall-e-3":
        return "standard"
    return None


def image_cost(model: str, size: str, tier: str) -> Decimal | None:
    if tier in ("free", "local"):
        return Decimal(0)
    bare = _bare(model)
    shape = "square" if size in ("1024x1024", "512x512", "256x256") else "wide"
    return PER_IMAGE.get((bare, shape))


# ---------------------------------------------------------------- filling the groups


def provider_kind(p: AIProvider) -> str | None:
    if p.preset in ("groq", "openai"):
        return p.preset
    return _HOSTS.get((urlparse(p.base_url).hostname or "").lower())


async def fill_groups(db: AsyncSession, workspace_id: str, groups: list[ModelGroup]) -> bool:
    """Give empty voice/picture groups the known models of this workspace's Groq and OpenAI
    providers. Returns True if anything was added (and committed)."""
    empty = [g for g in groups if g.name in NAMES and not g.members]
    if not empty:
        return False
    providers = (
        await db.scalars(
            select(AIProvider)
            .where(AIProvider.workspace_id == workspace_id)
            .order_by(AIProvider.priority, AIProvider.created_at)
        )
    ).all()
    kinds = [(p, provider_kind(p)) for p in providers]
    changed = False
    for g in empty:
        members = [
            {"provider_id": p.id, "model_id": model}
            for p, kind in kinds
            if kind
            for model in SUGGESTED[g.name].get(kind, ())
        ]
        # Cheapest first: Groq's free whisper before OpenAI's paid models.
        members.sort(key=lambda m: 0 if "whisper-large" in m["model_id"] else 1)
        if members:
            g.members = members
            changed = True
    if changed:
        await db.commit()
    return changed


async def fill_after_new_provider(db: AsyncSession, provider: AIProvider) -> None:
    """A Groq or OpenAI provider was just added: fill the voice/picture groups that are
    still empty."""
    if provider_kind(provider) is None:
        return
    workspace_id = provider.workspace_id
    rows = list(
        (
            await db.scalars(
                select(ModelGroup).where(
                    ModelGroup.workspace_id == workspace_id, ModelGroup.name.in_(NAMES)
                )
            )
        ).all()
    )
    await fill_groups(db, workspace_id, rows)
