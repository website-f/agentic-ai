"""Skill evals: run a skill's test cases against a model and check the answers.

Checks are deterministic first (must contain, must not contain, regex, a number within a
tolerance, JSON keys, tools that must be called) and an LLM judge only for a written rubric.
Used to compare the current version of a skill with a proposed one before anyone approves it.

P17: the run is faithful to how a skill is really used. The tools the skill names are
offered as harmless stubs (nothing runs; each answers "[evaluation stub]"), for up to
STUB_ROUNDS rounds, so a procedure that says "use calc, then write_page" is judged on what
it makes the model do, not on a single text reply. A refusal never passes a case.
"""

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..brain.facts import parse_json
from ..engine import gateway

RUNNER = """You are an office assistant. Follow this procedure exactly for the request below.
Work only from the request; if information is missing, say what is missing. You may call the
tools the procedure names; then give your final answer.

<skill>
{body}
</skill>"""

JUDGE = """You grade an answer against a rubric. Return JSON only: {"pass": true, "why": "..."}"""

_NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
_GROUPED = re.compile(r"(?<=\d),(?=\d{3}\b)")  # thousands separators
STUB_ROUNDS = 3
MAX_STUBS = 12
STUB = (
    "[evaluation stub] {name} was called with {args}. This is a test: nothing ran and there "
    "is no real data. Continue as if it worked and give your final answer."
)
# Tool-call markup some models leak into plain text (DeepSeek DSML, raw tool tags).
_MARKUP = re.compile(r"</?[｜|][^>]{0,80}>|</?(tool_call|function_calls?|invoke)[^>]*>", re.I)
_REFUSAL = re.compile(
    r"^\W*(i'?m sorry|sorry|i can(no|')t|i am (not able|unable)|i'?m (not able|unable)|"
    r"as an ai|i won'?t)",
    re.I,
)


def stub_tools(body: str) -> list[dict[str, Any]]:
    """The tools a skill names, as schemas the eval model may call (they never run)."""
    from ..agents.tools import TOOLS  # late: the agent tools import the skill store

    named = set(re.findall(r"\b[a-z][a-z0-9_]{2,40}\b", body))
    return [t.schema() for name, t in TOOLS.items() if name in named][:MAX_STUBS]


def clean_output(text: str) -> str:
    return _MARKUP.sub("", text or "").strip()


def check(output: str, checks: dict[str, Any]) -> list[str]:
    """Deterministic checks. Returns the failures (empty = pass)."""
    low = output.lower()
    plain = _GROUPED.sub("", low)  # "2,000" also matches "2000" (and the other way round)
    fails: list[str] = []
    for s in checks.get("must_contain") or []:
        want = str(s).lower()
        if want not in low and _GROUPED.sub("", want) not in plain:
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
    if (
        _REFUSAL.search(output)
        and not checks.get("must_contain")
        and not checks.get("allow_refusal")
    ):
        fails.append("the answer refused instead of doing the work")
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
    messages: list[dict[str, Any]],
    task: str,
    max_tokens: int,
    json_mode: bool = False,
    tools: list[dict[str, Any]] | None = None,
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
                tools=tools or None,
            )
        except gateway.GatewayUnavailable as e:
            last = e
    raise gateway.GatewayUnavailable(str(last) if last else "No model available.", [])


async def run_case(db: AsyncSession, ws_id: str, body: str, case: dict[str, Any]) -> dict[str, Any]:
    checks = case.get("checks") or {k: v for k, v in case.items() if k not in ("title", "input")}
    tools = stub_tools(body)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": RUNNER.format(body=body)},
        {"role": "user", "content": str(case.get("input", ""))},
    ]
    called: list[str] = []
    tokens = 0
    reply = await _chat(db, ws_id, messages, "skill.eval", 900, tools=tools)
    tokens += reply.usage.prompt + reply.usage.completion
    for round_no in range(STUB_ROUNDS):
        if not reply.tool_calls:
            break
        messages.append(
            {"role": "assistant", "content": reply.content or None, "tool_calls": reply.tool_calls}
        )
        for c in reply.tool_calls:
            fn = c.get("function") or {}
            called.append(str(fn.get("name")))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": c.get("id") or "call",
                    "name": fn.get("name"),
                    "content": STUB.format(
                        name=fn.get("name"), args=str(fn.get("arguments") or "{}")[:300]
                    ),
                }
            )
        # The last round offers no tools, so the model has to answer.
        last = round_no == STUB_ROUNDS - 1
        reply = await _chat(db, ws_id, messages, "skill.eval", 900, tools=None if last else tools)
        tokens += reply.usage.prompt + reply.usage.completion
    output = clean_output(reply.content)
    fails = check(output, checks)
    for name in checks.get("must_call") or []:
        if name not in called:
            fails.append(f"did not use {name}")
    if not fails and checks.get("rubric"):
        judged = await _chat(
            db,
            ws_id,
            [
                {"role": "system", "content": JUDGE},
                {
                    "role": "user",
                    "content": f"RUBRIC:\n{checks['rubric']}\n\nANSWER:\n{output[:4000]}",
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
        "output": output[:1500],
        "called": called,
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
