"""P80: POST /internal/prima/model, one model turn for Prima's assistant Arisha
(agentic/prima/model.py). Only Prima's API calls it, signed (x-prima-*); the web server never
serves /internal/ to the outside.

The answer is one OpenAI chat completion ({choices: [{message}], usage}); a refusal is
{message} in plain words with its status (401 not Prima, 403 not linked, 413 too long, 429 the
person's AI allowance or too many questions, 503 no model, 504 too slow). Nothing of the
prompt or the answer is logged.
"""

import asyncio
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...core.db import SessionLocal
from ...engine import acting, gateway
from ...prima import model
from ...prima.model import Refused
from ...teams import allowance

router = APIRouter(tags=["prima"])
log = logging.getLogger("agentic.prima.model")


async def _within_rate(user_id: str) -> None:
    from ...core.valkey import valkey

    key = f"prima:model:rate:{user_id}:{int(time.time() // 60)}"
    try:
        n = await valkey().incr(key)
        if n == 1:
            await valkey().expire(key, 120)
    except Exception as e:  # noqa: BLE001 - no counter: refuse rather than spend unchecked
        raise Refused(503, "Arisha is not available right now. Try again in a minute.") from e
    if n > model.PER_MINUTE:
        raise Refused(429, "Arisha is answering a lot right now. Wait a minute and ask again.")


@router.post(model.PATH)
async def prima_model(request: Request) -> JSONResponse:
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    url = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    try:
        prima_user = model.verify(headers, request.method, url, body)
        if prima_user is None or not await model.once(headers["x-prima-signature"]):
            raise Refused(401, "Not allowed.")
        messages, tools, max_tokens, quick = model.parse_turn(body)
        async with SessionLocal() as db:
            who = await model.person_of(db, prima_user)
            ws, m = who.workspace, who.membership
            # The person's daily AI allowance (P36), as for every direct AI feature.
            left = await allowance.check(db, ws, m.user_id)
            if left is not None:
                raise Refused(429, left.note())
            await _within_rate(m.user_id)
            try:
                # Logged against the person (llm_calls.user_id) and their company's data level.
                with acting.person(m.user_id):
                    async with asyncio.timeout(model.TURN_SECONDS):
                        r = await gateway.chat_first(
                            db,
                            ws.id,
                            model.QUICK_GROUPS if quick else model.GROUPS,
                            messages,
                            task=model.TASK,
                            max_tokens=max_tokens,
                            temperature=0.2,
                            tools=tools,
                            branch_id=m.branch_id,
                            reasoning_effort=model.REASONING_EFFORT,
                        )
            except TimeoutError as e:
                raise Refused(
                    504, "Arisha took too long to answer. Ask a shorter question, or try again."
                ) from e
            except gateway.GatewayUnavailable as e:
                raise Refused(
                    503,
                    "No AI model in the office could answer right now. Try again in a minute; "
                    "if it keeps happening, ask the office owner to check AI Engine.",
                ) from e
    except Refused as e:
        if e.status >= 500:
            log.warning("Arisha model turn refused (%s)", e.status)  # never the prompt
        return JSONResponse({"message": e.message}, status_code=e.status)
    return JSONResponse(model.reply_json(r.content, r.tool_calls, r.usage, r.model))
