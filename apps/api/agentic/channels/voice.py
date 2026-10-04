"""Voice notes on WhatsApp and Telegram (P18): the recording is turned into text by the
"transcribe" model group, then handled exactly as if the person had typed it. The answer
quotes what was heard, so a mis-heard word is easy to spot."""

from sqlalchemy.ext.asyncio import AsyncSession

from ..engine import client, gateway, media

MAX_BYTES = client.MAX_AUDIO_BYTES

NOT_SET_UP = (
    "Voice notes are not set up here yet: an admin can add a speech-to-text model in "
    "AI Engine > Model groups > Speech to text. Please type your message for now."
)
NOT_HEARD = "I could not make out that voice note right now. Please try again or type it."
NO_WORDS = "I could not hear any words in that voice note."
NO_DOWNLOAD = "I could not download that voice note. Please send it again or type it."
TOO_LONG = (
    f"That voice note is too long. Please keep it under {media.MAX_AUDIO_SECONDS // 60} minutes."
)


async def hear(
    db: AsyncSession,
    workspace_id: str,
    audio: bytes,
    mime: str,
    *,
    seconds: float | None = None,
    agent_id: str | None = None,
) -> tuple[str, str | None]:
    """(transcript, problem). `problem` is one line to send back instead of an answer."""
    try:
        t = await gateway.transcribe(
            db,
            workspace_id,
            audio,
            mime=mime,
            seconds=seconds,
            task="audio.transcribe",
            agent_id=agent_id,
        )
    except gateway.MediaRejected as e:
        return "", str(e)
    except gateway.NotConfigured:
        return "", NOT_SET_UP
    except gateway.GatewayUnavailable:
        return "", NOT_HEARD
    text = t.text.strip()
    return (text, None) if text else ("", NO_WORDS)


def quote(text: str, limit: int = 280) -> str:
    """What was heard, on one line, cut to a readable length."""
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"
