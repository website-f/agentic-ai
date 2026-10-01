"""Skill evals: run a skill's test cases against a model and check the answers.

Checks are deterministic first (must contain, must not contain, regex, a number within a
tolerance, JSON keys) and an LLM judge only for a written rubric. Used to compare the current
version of a skill with a proposed one before anyone approves it.
"""

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.facts import parse_json
from ..engine import gateway

RUNNER = """You are an office assistant. Follow this procedure exactly for the request below.
Work only from the request; if information is missing, say what is missing.

<skill>
{body}
</skill>"""

JUDGE = """You grade an answer against a rubric. Return JSON only: {"pass": true, "why": "..."}"""

_NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def check(output: str, checks: dict[str, Any]) -> list[str]:
    """Deterministic checks. Returns the failures (empty = pass)."""
    low = output.lower()
    fails: list[str] = []
    for s in checks.get("must_contain") or []:
        if str(s).lower() not in low:
            fails.append(f"missing “{s}”")
    for s in checks.get("must_not_contain") or []:
        if str(s).lower() in low:
            fails.append(f"should not contain “{s}”")
    if pattern := checks.get("regex"):
        try:
            if len(str(pattern)) > 300 or not re.search(str(pattern), output, re.I):
                fails.append(f"does not match /{pattern}/")
        except re.error:
            fails.append("the regex check is invalid")
    if isinstance(num := checks.get("number"), dict) and "value" in num:
        want, tol = float(num["value"]), float(num.get("tolerance", 0.01))
        found = [float(n.replace(",", "")) for n in _NUM.findall(output)]
        if not any(abs(f - want) <= tol for f in found):
            fails.append(f"no number within {tol} of {want}")
    if keys := checks.get("json_keys"):
        start, end = output.find("{"), output.rfind("}")
        try:
            data = json.loads(output[start : end + 1]) if start >= 0 < end else None
        except ValueError:
            data = None
        if not isinstance(data, dict):
            fails.append("answer is not a JSON object")
        else:
            fails += [f"JSON has no “{k}”" for k in keys if k not in data]
    return fails


async def _chat(
    db: AsyncSession,
    ws_id: str,
    messages: list[dict[str, str]],
    task: str,
    max_tokens: int,
    json_mode: bool = False,
) -> gateway.GatewayReply:
    last: Exception | None = None
    for group in ("smart", "fast"):
        try:
            return await gateway.chat(
                db,
                ws_id,
                group,
                messages,
                task=task,
                max_tokens=max_tokens,
                temperature=0,
                json_mode=json_mode,
            )
        except gateway.GatewayUnavailable as e:
            last = e
    raise gateway.GatewayUnavailable(str(last) if last else "No model available.", [])


async def run_case(db: AsyncSession, ws_id: str, body: str, case: dict[str, Any]) -> dict[str, Any]:
    checks = case.get("checks") or {k: v for k, v in case.items() if k not in ("title", "input")}
    reply = await _chat(
        db,
        ws_id,
        [
            {"role": "system", "content": RUNNER.format(body=body)},
            {"role": "user", "content": str(case.get("input", ""))},
        ],
        "skill.eval",
        900,
    )
    fails = check(reply.content, checks)
    tokens = reply.usage.prompt + reply.usage.completion
    if not fails and checks.get("rubric"):
        judged = await _chat(
            db,
            ws_id,
            [
                {"role": "system", "content": JUDGE},
                {
                    "role": "user",
                    "content": f"RUBRIC:\n{checks['rubric']}\n\nANSWER:\n{reply.content[:4000]}",
                },
            ],
            "skill.eval.judge",
            150,
            json_mode=True,
        )
        verdict = parse_json(judged.content)
        tokens += judged.usage.prompt + judged.usage.completion
        if not verdict.get("pass"):
            fails.append(f"rubric: {str(verdict.get('why') or 'not met')[:200]}")
    return {
        "title": case.get("title", "case"),
        "pass": not fails,
        "failures": fails,
        "output": reply.content[:1500],
        "tokens": tokens,
    }


async def run_suite(
    db: AsyncSession, ws_id: str, body: str, cases: list[dict[str, Any]]
) -> dict[str, Any]:
    results = []
    for case in cases[:20]:
        try:
            results.append(await run_case(db, ws_id, body, case))
        except gateway.GatewayUnavailable as e:
            return {
                "error": str(e),
                "cases": results,
                "passed": 0,
                "total": len(cases),
                "tokens": 0,
            }
    return {
        "passed": sum(1 for r in results if r["pass"]),
        "total": len(results),
        "tokens": sum(r["tokens"] for r in results),
        "cases": results,
    }
