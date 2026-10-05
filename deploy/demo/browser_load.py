"""Load check for the browser service: N agents at once sign in to the practice portal and
open pages, like helpers do. Run inside the worker (it shares the browser's network):

docker compose exec worker python /demo/browser_load.py 5
"""

import asyncio
import os
import sys
import time

import httpx

URL = os.environ.get("AGENTIC_BROWSER_URL", "http://browser:8600")
TOKEN = os.environ.get("AGENTIC_BROWSER_TOKEN", "dev-browser-token")
PORTAL = "http://practice-portal:8080"


async def agent(c: httpx.AsyncClient, n: int, out: list) -> None:
    t0 = time.time()
    r = await c.post("/sessions", json={"task_id": f"load-{n}", "agent_id": f"a{n}"})
    if r.status_code != 200:
        out.append((n, round(time.time() - t0, 1), [("session", f"HTTP {r.status_code}: {r.text[:80]}")]))
        return
    sid = r.json()["id"]

    async def act(**body):
        r = await c.post(f"/sessions/{sid}/act", json=body)
        if r.status_code != 200:
            return {"error": f"HTTP {r.status_code}"}
        return r.json()

    def ref(obs, label):  # elements carry stable refs (e5); find the field by its label
        return next((e.get("ref") for e in obs.get("elements") or [] if label in str(e.get("label", "")).lower()), "e0")

    steps = []
    o = await act(action="goto", url=f"{PORTAL}/login")
    steps.append(("open", o.get("error")))
    user, pw, sign = ref(o, "user id"), ref(o, "password"), ref(o, "sign in")
    o = await act(action="type", ref=user, text="demo.supplier", secret=True, secret_kind="username", hosts=["practice-portal"])
    steps.append(("user", o.get("error")))
    o = await act(action="type", ref=pw, text="practice-only-2026", secret=True, secret_kind="password", hosts=["practice-portal"])
    steps.append(("pass", o.get("error")))
    o = await act(action="login_submit", ref=sign, hosts=["practice-portal"])
    steps.append(("signin", o.get("error") or o.get("title")))
    for page in (1, 2, 3):
        o = await act(action="goto", url=f"{PORTAL}/inbox?page_no={page}")
        steps.append((f"page{page}", o.get("error") or o.get("title")))
    await c.delete(f"/sessions/{sid}")
    out.append((n, round(time.time() - t0, 1), steps))


async def main(k: int) -> None:
    out: list = []
    async with httpx.AsyncClient(base_url=URL, headers={"x-browser-token": TOKEN}, timeout=120) as c:
        t0 = time.time()
        await asyncio.gather(*(agent(c, i, out) for i in range(k)))
        for n, secs, steps in sorted(out):
            # Signed in means the sign-in step and every page after it show the inbox.
            bad = [s for s in steps[3:] if "Inbox" not in str(s[1])] + [s for s in steps[:3] if s[1]]
            if steps and steps[0][0] == "session":
                bad = steps
            print(f"agent {n}: {secs}s {'OK' if not bad else 'FAILED ' + str(bad)}")
        print(f"{k} agents in {time.time() - t0:.1f}s")


asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 5))
