"""Voice input for the dashboard (P18): the chat microphone records in the browser and sends
the recording here; the transcript comes back to fill the message box, so the person reads it
before sending. Nothing is stored.

The body is the raw recording (application/octet-stream, like file uploads: the CSRF guard
allows that type on this path and still checks the token). `X-File-Type` carries the
recording's real type (audio/webm, audio/mp4, audio/ogg ...).
"""

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.db import get_db
from ...core.valkey import valkey
from ...engine import client, gateway, media
from ..deps import Principal, api_error, require

router = APIRouter(prefix="/api", tags=["media"])

PER_WINDOW = 30  # recordings per person per window
WINDOW = 600


class TranscriptOut(BaseModel):
    text: str
    language: str | None
    seconds: float | None
    model: str
    provider: str


@router.post("/transcribe")
async def transcribe(
    request: Request,
    language: str | None = Query(default=None, pattern="^[a-z]{2}$"),
    seconds: float | None = Query(default=None, ge=0, le=3600),
    principal: Principal = Depends(require("work.write")),
    db: AsyncSession = Depends(get_db),
) -> TranscriptOut:
    mime = request.headers.get("x-file-type", "")[:120]
    if not media.is_audio(mime):
        raise api_error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "not_audio",
            "Send a voice recording (audio/webm, audio/ogg, audio/mp4, audio/mpeg or audio/wav).",
        )
    key = f"transcribe:{principal.workspace_id}:{principal.user.id}"
    count = int(await valkey().incr(key))
    if count == 1:
        await valkey().expire(key, WINDOW)
    if count > PER_WINDOW:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too_many_recordings",
            "That is a lot of recordings in a short time. Wait a few minutes and try again.",
        )
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > client.MAX_AUDIO_BYTES:
            raise api_error(
                status.HTTP_413_CONTENT_TOO_LARGE,
                "recording_too_large",
                f"Voice recordings can be up to {media.MAX_AUDIO_MB} MB.",
            )
    try:
        t = await gateway.transcribe(
            db,
            principal.workspace_id,
            bytes(data),
            mime=mime,
            language=language,
            seconds=seconds,
            task="audio.transcribe",
        )
    except gateway.MediaRejected as e:
        raise api_error(status.HTTP_400_BAD_REQUEST, "bad_recording", str(e)) from e
    except gateway.NotConfigured as e:
        raise api_error(status.HTTP_409_CONFLICT, "no_transcribe_model", str(e)) from e
    except gateway.GatewayUnavailable as e:
        raise api_error(status.HTTP_502_BAD_GATEWAY, "no_model_available", str(e)) from e
    return TranscriptOut(
        text=t.text,
        language=t.language,
        seconds=t.seconds,
        model=t.model,
        provider=t.provider_name,
    )
