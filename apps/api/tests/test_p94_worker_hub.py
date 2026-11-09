"""P94: only the API process holds the PC sockets (devices/hub.py). Live, 10 Nov 2026: P92's
tunnel.py imported api/routers/devices.py, whose import used to call bridge.serve_here(), so the
worker thought it held the sockets and every agent's call to a linked PC failed as "offline"
while the PC was connected to the API. Now only starting the API app marks the process."""

import subprocess
import sys
import textwrap

from agentic.devices import core


def _run(code: str) -> str:
    out = subprocess.run(  # noqa: S603 - this interpreter, fixed code
        [sys.executable, "-c", textwrap.dedent(code)],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert out.returncode == 0, out.stderr[-3000:]
    return out.stdout.strip().splitlines()[-1]


def test_the_worker_never_thinks_it_holds_the_pc_sockets():
    # Everything the worker loads, plus the router and the tunnel code that imported it.
    assert (
        _run(
            """
            import agentic.workflows.worker
            import agentic.devices.tunnel
            import agentic.api.routers.devices
            from agentic.devices import bridge
            print(bridge.SERVE_HERE)
            """
        )
        == "False"
    )


def test_the_api_app_holds_them():
    assert (
        _run(
            """
            import agentic.api.main
            from agentic.devices import bridge
            print(bridge.SERVE_HERE)
            """
        )
        == "True"
    )


def test_version_helpers_live_in_core():
    assert core.version_tuple("0.5.1") == (0, 5, 1)
    assert core.version_tuple("0.5.0-beta") == (0, 5, 0)
    assert core.version_tuple(None) == (0,)
    assert core.version_tuple("x.y") == (0,)
    assert core.version_tuple("0.5.0") >= core.ASK_VERSION
