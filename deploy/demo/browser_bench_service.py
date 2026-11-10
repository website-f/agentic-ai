"""Dev only (P97 bench): run the real browser service on this machine, with sessions that come
with a cdp_url driving a local Chrome/Edge (started with --remote-debugging-port), the way a
person's own PC is driven over the office's relay. The relay address check is widened to that
local browser, and the practice portal on 127.0.0.1 is allowed. Never used in production.

    python deploy/demo/browser_bench_service.py apps/browser 8661

Needs playwright, fastapi and uvicorn (the browser image's packages; camoufox not needed).
See apps/api/tests/test_p97_browser_bench.py.
"""

import os
import re
import sys

os.environ.setdefault("BROWSER_ALLOW_HOSTS", "127.0.0.1,localhost")
os.environ.setdefault("BROWSER_PROFILES_DIR", os.path.join(os.getcwd(), ".bench-profiles"))
os.environ.setdefault("BROWSER_BUDGET_HOSTS", "")
sys.path.insert(0, sys.argv[1])

import service  # noqa: E402

service.CDP_RELAY = re.compile(r"^wss?://(127\.0\.0\.1|localhost):\d+/devtools/browser/[\w-]+$")

import uvicorn  # noqa: E402

uvicorn.run(service.app, host="127.0.0.1", port=int(sys.argv[2]), log_level="warning")
