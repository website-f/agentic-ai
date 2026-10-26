"""The one-line installers: `irm https://HOST/i/CODE/win | iex` and
`curl -fsSL https://HOST/i/CODE/mac | sh` (and /linux: the same script, it checks).

The scripts are templates in apps/pc-agent/install/ (install.ps1, install.sh), read at request
time, with `{{SERVER}}` and `{{CODE}}` filled in. Where they live: AGENTIC_PC_AGENT_DIR, else
/app/pc-agent in the container, else the repo's apps/pc-agent.
"""

import os
import re
from pathlib import Path

TEMPLATES = {"win": "install.ps1", "mac": "install.sh", "linux": "install.sh"}
_SAFE_SERVER = re.compile(r"^https?://[A-Za-z0-9.\-]+(:\d{1,5})?(/[A-Za-z0-9._~\-/]*)?$")


def agent_dir() -> Path:
    env = os.environ.get("AGENTIC_PC_AGENT_DIR")
    if env:
        return Path(env)
    container = Path("/app/pc-agent")
    if container.is_dir():
        return container
    # agentic/devices/install.py -> apps/api/agentic/devices -> apps/pc-agent
    return Path(__file__).resolve().parents[3] / "pc-agent"


def safe_server(server: str) -> bool:
    """Only a plain URL goes into a script a person runs in their shell."""
    return bool(_SAFE_SERVER.match(server or ""))


def script(kind: str, server: str, code: str, remote: str = "off") -> str | None:
    """The filled-in installer, or None when the template is not on this server. `remote`:
    P42, what the person chose for seeing and using this computer from the web (off | view |
    control); running the line on the computer is their consent there."""
    name = TEMPLATES.get(kind)
    if name is None:
        return None
    path = agent_dir() / "install" / name
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    if remote not in ("off", "view", "control"):
        remote = "off"
    return (
        text.replace("{{SERVER}}", server.rstrip("/"))
        .replace("{{CODE}}", code)
        .replace("{{REMOTE}}", remote)
    )


# P52: the Windows agent as one program (apps/pc-agent/build-exe.cjs, built into the image).
EXE_NAME = "AgenticOfficePC.exe"
TRAILER_START = b"\n#AGENTIC-OFFICE-LINK#"
TRAILER_END = b"#END#"


def exe_path() -> Path | None:
    p = agent_dir() / EXE_NAME
    return p if p.is_file() else None


def exe_trailer(server: str, code: str, remote: str) -> bytes:
    """The link the .exe reads from its own last bytes when double-clicked (agent.cjs
    readTrailer). After the program's last section, so Windows ignores it."""
    import json

    data = {"server": server.rstrip("/"), "code": code, "remote": remote}
    return TRAILER_START + json.dumps(data).encode() + TRAILER_END


def _quote_ps(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _quote_sh(text: str) -> str:
    return "'" + text.replace("'", "'\\''") + "'"


def error_script(kind: str, lines: list[str]) -> str:
    """A script that only prints why it cannot install, and stops."""
    if kind == "win":
        body = "\n".join(f"Write-Host {_quote_ps(line)} -ForegroundColor Red" for line in lines)
        # `exit` would close the person's PowerShell window under `| iex`; `throw` stops here.
        return f"{body}\nthrow {_quote_ps(lines[0] if lines else 'Not installed.')}\n"
    body = "\n".join(f"echo {_quote_sh(line)} >&2" for line in lines)
    return f"#!/bin/sh\n{body}\nexit 1\n"
