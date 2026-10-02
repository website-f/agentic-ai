"""Real-model end to end (P9): Rafi signs in to the practice supplier portal with a saved
login, counts the inbox, asks the owner what to do (with options), splits the job between
helpers, and publishes one report. The script plays the owner: it answers like a person
would, after a pause so the question can be seen on screen."""
import asyncio
import json
import sys
import time

import asyncpg
import httpx

B = "http://127.0.0.1:8500"
PG = "postgresql://agentic:agentic_dev@127.0.0.1:8506/agentic"
WEB = {
    "browser_open": "allow", "browser_click": "allow", "browser_type": "allow", "browser_fill": "allow",
    "browser_select": "allow", "browser_check": "allow", "browser_scroll": "allow", "browser_back": "allow",
    "browser_read": "allow", "browser_login": "allow", "browser_submit": "ask", "browser_close": "allow",
    "split_work": "allow", "publish_report": "allow",
}
BRIEF = (
    "Sign in to our supplier portal at http://practice-portal:8080/login with the saved login "
    "'practice-portal' and check the inbox (every page). Tell me how many messages there are, how "
    "many are unread, and what kinds they are. Then ask me what I want you to do with them."
)
ANSWER = (
    "Open every invitation to quote and put them in one report: reference, agency, item, "
    "estimated value and closing date, soonest closing first. Also note which quotations we won."
)


BIG = len(sys.argv) > 2 and sys.argv[2] == "all"
if BIG:
    ANSWER = (
        "Open all 34 messages and give me one report: one row per message with date, sender, "
        "type, reference (if any) and a one-line summary of what it says or asks, newest first."
    )


async def main(label: str) -> None:
    c = httpx.AsyncClient(base_url=B, timeout=120)
    (await c.post("/api/auth/login", json={"email": "owner@example.com", "password": "agentic-test-2026"})).raise_for_status()
    h = {"x-csrf-token": c.cookies.get("agentic_csrf")}
    prov = {p["name"]: p["id"] for p in (await c.get("/api/ai/providers")).json()}
    await c.put("/api/ai/groups/smart", headers=h, json={"members": [
        {"provider_id": prov["DeepSeek"], "model_id": "deepseek-flash"},
        {"provider_id": prov["OpenAI"], "model_id": "gpt-5.4-mini"},
        {"provider_id": prov["Groq"], "model_id": "openai/gpt-oss-120b"}]})
    agents = {a["name"]: a for a in (await c.get("/api/agents")).json()}
    rafi = agents["Rafi"]
    rafi = (await c.patch(f"/api/agents/{rafi['id']}", headers=h,
                          json={"tools": {**(rafi.get("tools") or {}), **WEB}, "max_parallel_children": 4})).json()
    logins = {x["name"] for x in (await c.get("/api/vault/logins")).json()}
    if "practice-portal" not in logins:
        r = await c.post("/api/vault/logins", headers=h, json={
            "name": "practice-portal", "hosts": ["practice-portal"],
            "username": "demo.supplier", "password": "practice-only-2026"})
        r.raise_for_status()
        print("saved login practice-portal (agents never see it)")
    t = (await c.post("/api/tasks", headers=h, json={
        "title": f"Supplier portal inbox ({label})", "brief": BRIEF, "assignee_agent_id": rafi["id"],
        "requires_review": True, "start": True, "labels": ["tender"]})).json()
    print(f"task {t['id']} started; watch: {B}/monitor?agent={rafi['id']}", flush=True)
    t0, handled = time.time(), set()
    seen_children: set[str] = set()
    while time.time() - t0 < 1500:
        det = (await c.get(f"/api/tasks/{t['id']}")).json()
        for k in det["children"]:
            if k["id"] not in seen_children:
                seen_children.add(k["id"])
                print(f"  [{time.time()-t0:5.0f}s] helper task: {k['title'][:70]} -> {k['assignee_name']}", flush=True)
        pend = [a for a in (await c.get("/api/approvals")).json() if a["task_id"] in {t["id"], *seen_children}]
        for a in pend:
            if a["id"] in handled:
                continue
            handled.add(a["id"])
            if a["kind"] == "question":
                print(f"  [{time.time()-t0:5.0f}s] {a['agent_name']} asks: {a['reason'][:400]}", flush=True)
                print(f"           options: {a['args'].get('options')}", flush=True)
                await asyncio.sleep(12)  # a person reads it (and the screenshots catch it)
                await c.post(f"/api/approvals/{a['id']}", headers=h, json={"decision": "answer", "answer": ANSWER})
                print(f"  [{time.time()-t0:5.0f}s] owner answered", flush=True)
            else:
                print(f"  [{time.time()-t0:5.0f}s] approval asked by {a['agent_name']}: {a['tool_name']} {json.dumps(a['args'])[:160]}", flush=True)
                await asyncio.sleep(3)
                await c.post(f"/api/approvals/{a['id']}", headers=h, json={"decision": "approve"})
        if det["task"]["status"] in ("done", "failed", "review", "cancelled"):
            break
        await asyncio.sleep(2)
    det = (await c.get(f"/api/tasks/{t['id']}")).json()
    print(f"\nstatus {det['task']['status']} after {time.time()-t0:.0f}s")
    print("result:\n", (det["task"]["result"] or det["task"]["error"] or "")[:2500])
    print("\ntimeline:")
    for e in det["events"]:
        if e["kind"] in ("tool",):
            continue
        print("  -", e["kind"], "|", (e["actor_name"] or e["actor"])[:14], "|", e["text"][:160])
    print("children:", [(k["title"][:50], k["assignee_name"], k["status"]) for k in det["children"]])
    reps = (await c.get(f"/api/reports?task_id={t['id']}")).json()
    for r in reps:
        full = (await c.get(f"/api/reports/{r['id']}")).json()
        print(f"\nREPORT {full['title']!r}: {full['summary']}")
        for tb in full["tables"] or []:
            print("  table", tb["title"], tb["columns"], len(tb["rows"]), "rows")
            for row in tb["rows"][:20]:
                print("   ", row)
    conn = await asyncpg.connect(PG)
    ids = [t["id"]] + [k["id"] for k in det["children"]]
    rows = await conn.fetch(
        "select provider_name, model, task, count(*) n, sum(prompt_tokens) p, sum(completion_tokens) c, "
        "sum(cached_tokens) k, coalesce(sum(cost_usd),0) usd from llm_calls where task_id = any($1::text[]) "
        "group by 1,2,3 order by 1,3", ids)
    tot_tok = tot_usd = 0.0
    for r in rows:
        tot_tok += r["p"] + r["c"]
        tot_usd += float(r["usd"])
        print(f"  {r['provider_name']:15} {r['model']:22} {r['task']:18} {r['n']:3} calls {r['p']+r['c']:7} tok ({r['k']} cached) ${float(r['usd']):.4f}")
    print(f"TOTAL {int(tot_tok)} tokens, ${tot_usd:.4f} ({label})")
    leaks = await conn.fetchval(
        "select count(*) from agent_messages where task_id = any($1::text[]) and content like '%practice-only-2026%'", ids)
    ev = await conn.fetchval("select count(*) from events where data::text like '%practice-only-2026%'")
    print(f"password seen in agent messages: {leaks}, in events: {ev}")
    await conn.close()


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "run 1"))
