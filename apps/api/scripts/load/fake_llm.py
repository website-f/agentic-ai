# ruff: noqa: S311 - a test harness: random latency
"""A fake OpenAI-compatible model for the load harness (never used by the app or CI).

Each task plays one short ePerolehan session: open the portal, click through CLICKS pages,
then answer. The reply depends only on how many tool results the conversation already has,
so retries and restarts replay the same way. LATENCY (seconds, with +-JITTER) stands in for
a real model's thinking time; RATE_LIMIT_EVERY > 0 answers every Nth call with a 429 (to
see how the gateway copes).

    python scripts/load/fake_llm.py --port 8563 --latency 2.0 --clicks 4
"""

import argparse
import asyncio
import json
import random
import time

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

OPTS = argparse.Namespace(latency=2.0, jitter=0.5, clicks=4, rate_limit_every=0, url="")
STATE = {"calls": 0, "in_flight": 0, "peak": 0, "limited": 0}


def _reply(messages: list[dict]) -> dict:
    tool_results = sum(1 for m in messages if m.get("role") == "tool")
    if tool_results == 0:
        name, args = "browser_open", {"url": OPTS.url}
    elif tool_results <= OPTS.clicks:
        name, args = "browser_click", {"ref": "e7"}
    else:
        return {"role": "assistant", "content": "Done: the tender list was checked."}
    call = {
        "id": f"call_{tool_results}_{random.randrange(1 << 30)}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }
    return {"role": "assistant", "content": "", "tool_calls": [call]}


async def completions(request: Request) -> JSONResponse:
    body = await request.json()
    STATE["calls"] += 1
    if OPTS.rate_limit_every and STATE["calls"] % OPTS.rate_limit_every == 0:
        STATE["limited"] += 1
        return JSONResponse({"error": {"message": "rate limited"}}, 429, {"retry-after": "5"})
    STATE["in_flight"] += 1
    STATE["peak"] = max(STATE["peak"], STATE["in_flight"])
    try:
        await asyncio.sleep(max(0.05, OPTS.latency + random.uniform(-OPTS.jitter, OPTS.jitter)))
        if body.get("tools"):
            msg = _reply(body.get("messages") or [])
        else:  # background jobs (learning, reflection, self-check): an empty JSON answer
            msg = {"role": "assistant", "content": "{}"}
    finally:
        STATE["in_flight"] -= 1
    prompt = sum(len(str(m.get("content") or "")) for m in body.get("messages") or []) // 4
    return JSONResponse(
        {
            "id": f"chatcmpl-{time.time_ns()}",
            "object": "chat.completion",
            "model": body.get("model") or "fake",
            "choices": [
                {
                    "index": 0,
                    "message": msg,
                    "finish_reason": "tool_calls" if msg.get("tool_calls") else "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt,
                "completion_tokens": 20,
                "total_tokens": prompt + 20,
            },
        }
    )


async def models(_: Request) -> JSONResponse:
    return JSONResponse({"object": "list", "data": [{"id": "fake-1", "object": "model"}]})


async def stats(_: Request) -> JSONResponse:
    return JSONResponse(STATE)


app = Starlette(
    routes=[
        Route("/v1/chat/completions", completions, methods=["POST"]),
        Route("/v1/models", models),
        Route("/stats", stats),
    ]
)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8563)
    p.add_argument("--latency", type=float, default=2.0)
    p.add_argument("--jitter", type=float, default=0.5)
    p.add_argument("--clicks", type=int, default=4)
    p.add_argument("--rate-limit-every", type=int, default=0)
    p.add_argument("--url", default="https://eperolehan.gov.my/home")
    a = p.parse_args()
    OPTS.__dict__.update(vars(a))
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
