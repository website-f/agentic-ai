"""Telegram Bot API: the few calls we need. Long polling, so it works on a laptop with no
public URL (no webhook, no domain). Messages are sent as plain text: no markup to escape."""

from typing import Any

from ..core.config import settings
from ..engine import client as http

MAX_TEXT = 4000  # Telegram's limit is 4096


class TelegramError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


async def call(
    token: str, method: str, params: dict[str, Any] | None = None, timeout: float = 20
) -> Any:
    url = f"{settings.telegram_api_base.rstrip('/')}/bot{token}/{method}"
    async with http._client(timeout=timeout + 10) as c:  # noqa: SLF001 - shared transport hook
        r = await c.post(url, json=params or {})
    try:
        data = r.json()
    except ValueError as e:
        raise TelegramError(f"Telegram answered {r.status_code}.", r.status_code) from e
    if not data.get("ok"):
        # Never echo the URL: it contains the bot token.
        raise TelegramError(
            str(data.get("description") or f"Telegram answered {r.status_code}."), r.status_code
        )
    return data.get("result")


async def get_me(token: str) -> dict[str, Any]:
    return await call(token, "getMe", timeout=10)


async def send_message(
    token: str, chat_id: str | int, text: str, buttons: list[list[dict[str, str]]] | None = None
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text[:MAX_TEXT],
        "disable_web_page_preview": True,
    }
    if buttons:
        params["reply_markup"] = {"inline_keyboard": buttons}
    return await call(token, "sendMessage", params, timeout=10)


async def edit_message(token: str, chat_id: str | int, message_id: int, text: str) -> None:
    await call(
        token,
        "editMessageText",
        {"chat_id": chat_id, "message_id": message_id, "text": text[:MAX_TEXT]},
        timeout=10,
    )


async def answer_callback(token: str, callback_id: str, text: str) -> None:
    await call(
        token,
        "answerCallbackQuery",
        {"callback_query_id": callback_id, "text": text[:190]},
        timeout=10,
    )


async def get_updates(token: str, offset: int, timeout: int = 20) -> list[dict[str, Any]]:
    return (
        await call(
            token,
            "getUpdates",
            {
                "offset": offset,
                "timeout": timeout,
                "allowed_updates": ["message", "callback_query"],
            },
            timeout=timeout,
        )
        or []
    )


async def delete_webhook(token: str) -> None:
    await call(token, "deleteWebhook", {"drop_pending_updates": False}, timeout=10)
