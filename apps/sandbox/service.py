"""Isolated code sandbox (P13, idea from Hermes Agent's code execution).

Agents sometimes need to run a little code to do real work: add up a spreadsheet, reshape data,
draw a chart, convert a file. This service runs Python for them in a sealed box:

- it is a separate container on a private network with NO internet and NO access to the
  database, the vault or any secret;
- each run is a fresh subprocess with hard CPU, memory, process and file-size limits and a
  wall-clock timeout, in a throwaway working directory that is deleted afterwards;
- only files the code writes to ./out are returned; only stdout/stderr come back as text.

So the worst a bad or injected script can do is waste its own CPU slice. The worker reaches
this service over the private network with a shared token; nothing else can.
"""

import os
import resource
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

TOKEN = os.environ.get("SANDBOX_TOKEN", "dev-sandbox-token")
CPU_SECONDS = int(os.environ.get("SANDBOX_CPU_SECONDS", "15"))
WALL_SECONDS = int(os.environ.get("SANDBOX_WALL_SECONDS", "30"))
MEM_MB = int(os.environ.get("SANDBOX_MEM_MB", "512"))
MAX_OUTPUT = 20_000
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_IN_BYTES = 20 * 1024 * 1024

app = FastAPI(title="agentic-sandbox")


class File(BaseModel):
    name: str
    b64: str  # base64 of the file's bytes


class RunIn(BaseModel):
    code: str = Field(max_length=200_000)
    files: list[File] = Field(default_factory=list, max_length=20)
    stdin: str = Field(default="", max_length=100_000)


class OutFile(BaseModel):
    name: str
    b64: str


class RunOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    files: list[OutFile]


def _limits() -> None:
    # Applied in the child before exec: CPU, address space, processes, file size, core dumps.
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    mem = MEM_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.setsid()


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/run")
def run(body: RunIn, x_sandbox_token: str = Header(default="")) -> RunOut:
    import base64
    import binascii

    if x_sandbox_token != TOKEN:
        raise HTTPException(status_code=401, detail="bad token")

    work = Path(tempfile.mkdtemp(prefix="run-", dir="/work"))
    out_dir = work / "out"
    out_dir.mkdir()
    try:
        total_in = 0
        for f in body.files:
            name = os.path.basename(f.name)[:120] or "input"
            try:
                data = base64.b64decode(f.b64, validate=True)
            except (binascii.Error, ValueError) as e:
                raise HTTPException(status_code=400, detail=f"bad base64 for {name}") from e
            total_in += len(data)
            if total_in > MAX_IN_BYTES:
                raise HTTPException(status_code=413, detail="input files too large")
            (work / name).write_bytes(data)
        (work / "main.py").write_text(body.code, encoding="utf-8")

        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": str(work),
            "TMPDIR": str(work),
            "PYTHONDONTWRITEBYTECODE": "1",
            "MPLBACKEND": "Agg",  # matplotlib without a display
            "OPENBLAS_NUM_THREADS": "1",
        }
        timed_out = False
        try:
            proc = subprocess.run(  # noqa: S603 - fixed argv; isolation is the container + rlimits
                ["python", "-I", "main.py"],
                cwd=work,
                env=env,
                input=body.stdin.encode(),
                capture_output=True,
                timeout=WALL_SECONDS,
                preexec_fn=_limits,  # noqa: PLW1509 - set rlimits in the child
                check=False,
            )
            stdout, stderr, code = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as e:
            timed_out = True
            stdout, stderr, code = e.stdout or b"", e.stderr or b"", -1

        files = []
        for p in sorted(out_dir.rglob("*")):
            if p.is_file() and p.stat().st_size <= MAX_FILE_BYTES and len(files) < 20:
                files.append(OutFile(name=p.relative_to(out_dir).as_posix(), b64=base64.b64encode(p.read_bytes()).decode()))
        return RunOut(
            stdout=stdout.decode("utf-8", "replace")[:MAX_OUTPUT],
            stderr=stderr.decode("utf-8", "replace")[:MAX_OUTPUT],
            exit_code=code,
            timed_out=timed_out,
            files=files,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
