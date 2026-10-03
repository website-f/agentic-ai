"""Live demo: agents help each other and learn once (P14).

Maya (Marketing) runs the team's usual ad-report script on a new ads-manager export; the export
changed format, so the script fails. She asks the software engineer for help; Eko reproduces it
in the sandbox and sends the cause and a fix, saved as a lesson. Next month the same breakage
is answered from the office memory (the free local model quotes the lesson), so Eko is not
woken and fewer tokens are spent.

Run from the repo root with the stack up:  python deploy/demo/help_scenario.py
"""

import base64
import json
import sys
import time
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8500"
EMAIL, PASSWORD = "owner@example.com", "agentic-test-2026"

SCRIPT = """import csv
rows = list(csv.DictReader(open('{file}', encoding='utf-8')))
report = {{}}
for r in rows:
    c = report.setdefault(r['campaign'], {{'spend': 0.0, 'revenue': 0.0}})
    c['spend'] += float(r['spend'])
    c['revenue'] += float(r['revenue'])
for name, c in report.items():
    print(name, 'spend', round(c['spend'], 2), 'ROAS', round(c['revenue'] / c['spend'], 2))
"""


def export(month: str, rows: list[tuple[str, str, str, str]]) -> bytes:
    # The ads manager's new export: BOM, semicolons, money as text, N/A rows.
    lines = ["date;campaign;spend;clicks;conversions;revenue"]
    for i, (camp, spend, conv, rev) in enumerate(rows, 1):
        lines.append(f"2026-{month}-{i:02d};{camp};{spend};{120 + i * 7};{conv};{rev}")
    lines.append(f"2026-{month}-28;Brand Awareness;N/A;0;0;N/A")
    return ("﻿" + "\n".join(lines) + "\n").encode()


SEPT = export("09", [
    ("Office Cleaning Promo", "RM 1,200.50", "14", "RM 4,350.00"),
    ("Office Cleaning Promo", "RM 980.00", "11", "RM 3,120.00"),
    ("Deep Clean Launch", "RM 2,450.00", "6", "RM 3,900.00"),
    ("Retargeting", "RM 410.20", "9", "RM 1,880.00"),
])
OCT = export("10", [
    ("Office Cleaning Promo", "RM 1,410.00", "16", "RM 5,020.00"),
    ("Deep Clean Launch", "RM 2,010.75", "5", "RM 2,960.00"),
    ("Retargeting", "RM 455.00", "11", "RM 2,105.50"),
])

MAYA_SOUL = (
    "You run the company's ad campaigns and report on their results. You are a marketer, not "
    "a programmer: run the team's report script as given with run_python. If code fails, do "
    "not debug it yourself: ask the software engineer for help (ask_colleague with "
    "agent='software engineer', kind='help', and the exact error as context), then apply their "
    "fix and finish the report."
)
EKO_SOUL = (
    "You are the company's software engineer. Colleagues bring you code that fails. Reproduce "
    "the problem in run_python with a small sample, find the root cause, and send back a fix "
    "they can paste as is. Be brief."
)


class Client:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def csrf(self) -> str:
        return next((c.value for c in self.jar if c.name == "agentic_csrf"), "")

    def call(self, method: str, path: str, body=None, raw: bytes | None = None, ctype: str = "application/json"):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if method != "GET" and data is None:
            data = b"{}"
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("Content-Type", ctype)
        req.add_header("x-csrf-token", self.csrf())
        try:
            with self.op.open(req, timeout=120) as r:
                txt = r.read()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{method} {path} -> {e.code} {e.read()[:300]!r}") from None


def ensure_dept(c: Client, branch: dict, name: str) -> str:
    for d in branch["departments"]:
        if d["name"] == name:
            return d["id"]
    return c.call("POST", f"/api/branches/{branch['id']}/departments", {"name": name})["id"]


def ensure_agent(c: Client, branch: dict, dept: str, name: str, role: str, soul: str) -> dict:
    for a in c.call("GET", "/api/agents"):
        if a["name"] == name:
            return a
    return c.call("POST", "/api/agents", {
        "branch_id": branch["id"], "department_id": dept, "name": name, "role": role,
        "soul": soul, "autonomy": "auto",
        "tools": {"run_python": "allow", "ask_colleague": "allow", "read_file": "allow"},
    })


def upload(c: Client, name: str, data: bytes, branch_id: str) -> str:
    q = urllib.parse.urlencode({"name": name, "branch_id": branch_id})
    return c.call("POST", f"/api/files?{q}", raw=data, ctype="application/octet-stream")["id"]


def wait(c: Client, task_id: str, timeout: int = 600) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = c.call("GET", f"/api/tasks/{task_id}")
        t = d.get("task", d)
        if t["status"] in ("done", "review", "failed", "cancelled", "blocked"):
            return d
        time.sleep(4)
    raise SystemExit(f"task {task_id} did not finish in {timeout}s")


def run(c: Client, maya: dict, branch: dict, title: str, file_name: str, data: bytes) -> str:
    fid = upload(c, file_name, data, branch["id"])
    brief = (
        f"Make the ad performance report for {title}: run our usual report script below on "
        f"the attached export ({file_name}) and give spend and ROAS per campaign, flagging "
        f"campaigns with ROAS below 2.\n\n```python\n{SCRIPT.format(file=file_name)}```"
    )
    t = c.call("POST", "/api/tasks", {
        "title": f"Ad report: {title}", "brief": brief, "assignee_agent_id": maya["id"],
        "requires_review": False, "start": True, "file_ids": [fid], "labels": ["ads"],
    })
    return t["id"]


def main() -> None:
    c = Client()
    c.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    branch = next(b for b in c.call("GET", "/api/branches") if b["name"].startswith("Qbot"))
    mkt = ensure_dept(c, branch, "Marketing")
    eng = ensure_dept(c, branch, "Engineering")
    maya = ensure_agent(c, branch, mkt, "Maya", "Marketing Executive", MAYA_SOUL)
    eko = ensure_agent(c, branch, eng, "Eko", "Software Engineer", EKO_SOUL)
    print(f"agents: Maya ({maya['id']}), Eko ({eko['id']})")

    results = {}
    for label, fname, data in (("September 2026", "ad_spend_sept.csv", SEPT),
                               ("October 2026", "ad_spend_oct.csv", OCT)):
        tid = run(c, maya, branch, label, fname, data)
        print(f"\n== {label}: task {tid}")
        d = wait(c, tid)
        results[label] = tid
        t = d.get("task", d)
        print(f"status: {t['status']} | steps: {t['steps_used']}")
        for e in d.get("events", []):
            if e["kind"] in ("delegated", "delegation_done", "memory", "hint", "tool"):
                print(f"  {e['kind']:16s} {e['text'][:140]}")
        print("result:", (t.get("result") or t.get("error") or "")[:700])
    json.dump(results, open("deploy/demo/.help_scenario_tasks.json", "w"))
    print("\nTask ids saved to deploy/demo/.help_scenario_tasks.json (token report: see below).")


if __name__ == "__main__":
    import urllib.parse  # noqa: F401 - used in upload

    sys.exit(main())
