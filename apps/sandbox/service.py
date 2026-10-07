"""Isolated code sandbox (P13, idea from Hermes Agent's code execution).

Agents sometimes need to run a little code to do real work: add up a spreadsheet, reshape data,
draw a chart, convert a file. This service runs Python for them in a sealed box:

- it is a separate container on a private network with NO internet and NO access to the
  database, the vault or any secret; it runs as its own uid (10010), which no other service
  uses, so per-uid limits and signals never touch the api, worker, browser or egress;
- ONE run at a time: a run waits (up to SANDBOX_QUEUE_SECONDS) for the previous one to finish,
  so two companies' code never coexist and cannot read, plant or kill each other's files;
- each run is a fresh subprocess in its own session with hard CPU, memory, process and
  file-size limits and a wall-clock timeout, in a private (0700) working directory that is
  deleted afterwards; when the run ends (normally or by timeout) its whole process group is
  killed, and any process it left behind (even one that started its own session) is swept;
- the server's own files are root-owned and read-only; its process is marked non-dumpable so
  run code cannot read its environment (the token) from /proc;
- only files the code writes to ./out are returned; only stdout/stderr come back as text.

So the worst a bad or injected script can do is waste its own CPU slice (or crash this
container, which then restarts). The worker reaches this service over the private network
with a shared token; nothing else can.
"""

import base64
import binascii
import ctypes
import hmac
import os
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

TOKEN = os.environ.get("SANDBOX_TOKEN", "dev-sandbox-token")
CPU_SECONDS = int(os.environ.get("SANDBOX_CPU_SECONDS", "15"))
WALL_SECONDS = int(os.environ.get("SANDBOX_WALL_SECONDS", "30"))
MEM_MB = int(os.environ.get("SANDBOX_MEM_MB", "512"))
# How long a run waits for the one before it. The worker's client allows for this + WALL.
QUEUE_SECONDS = int(os.environ.get("SANDBOX_QUEUE_SECONDS", "45"))
# Processes + threads for the whole uid (RLIMIT_NPROC counts per uid; this uid is only ours,
# but it includes the server's own threads, ~40 at most). The container's pids_limit is the
# hard ceiling above this.
NPROC = int(os.environ.get("SANDBOX_NPROC", "96"))
WORK_ROOT = Path(os.environ.get("SANDBOX_WORK_ROOT", "/work"))
# Scratch places run code could write besides its own directory; emptied after every run.
_SCRATCH = os.environ.get("SANDBOX_SCRATCH_DIRS", "/tmp,/dev/shm")  # noqa: S108 - emptied, not used
SCRATCH_DIRS = [p for p in _SCRATCH.split(",") if p]
MAX_OUTPUT = 20_000
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_IN_BYTES = 20 * 1024 * 1024

app = FastAPI(title="agentic-sandbox")
_RUN_LOCK = threading.Lock()


def _not_dumpable() -> None:
    """Make this process non-dumpable: /proc/<pid>/environ, mem, fd become root-owned, so code
    running as the same uid cannot read the token or ptrace the server. Best effort (Linux)."""
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl(4, 0, 0, 0, 0)  # PR_SET_DUMPABLE = 4
    except (OSError, AttributeError):
        pass


_not_dumpable()


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
    # (The new session comes from start_new_session=True.)
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    mem = MEM_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    resource.setrlimit(resource.RLIMIT_NPROC, (NPROC, NPROC))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _kill_group(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _leftovers() -> list[int]:
    """Our uid's processes other than this server, PID 1 (tini) and `docker exec` processes
    (healthchecks, ppid 0). Runs are serialized, so between runs these can only be what run
    code left behind (e.g. a daemon that called setsid itself and escaped the process group)."""
    me, uid, found = os.getpid(), os.getuid(), []
    try:
        entries = os.listdir("/proc")
    except OSError:
        return found
    for name in entries:
        if not name.isdigit():
            continue
        pid = int(name)
        if pid in (me, 1):
            continue
        try:
            with open(f"/proc/{pid}/status") as fh:
                status = fh.read()
        except OSError:
            continue
        fields = dict(line.split(":", 1) for line in status.splitlines() if ":" in line)
        try:
            ruid = int(fields.get("Uid", "").split()[0])
            ppid = int(fields.get("PPid", "0").strip())
        except (IndexError, ValueError):
            continue
        if ruid == uid and ppid != 0:
            found.append(pid)
    return found


def _sweep(pgid: int) -> None:
    _kill_group(pgid)
    for _ in range(5):
        pids = _leftovers()
        if not pids:
            return
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        time.sleep(0.05)


def _rmtree(path: Path) -> None:
    """Remove a tree even if run code made parts of it unreadable (chmod 000)."""
    if path.is_symlink() or not path.is_dir():
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return
    try:
        os.chmod(path, 0o700)
        for root, dirs, _files in os.walk(path):
            for d in dirs:
                full = os.path.join(root, d)
                if not os.path.islink(full):
                    try:
                        os.chmod(full, 0o700)
                    except OSError:
                        pass
    except OSError:
        pass
    shutil.rmtree(path, ignore_errors=True)


def _clear_scratch() -> None:
    for d in SCRATCH_DIRS:
        root = Path(d)
        if not root.is_dir():
            continue
        try:
            entries = list(root.iterdir())
        except OSError:
            continue
        for p in entries:
            _rmtree(p)
    # Anything else under the work root (a run that escaped its own directory).
    if WORK_ROOT.is_dir():
        for p in WORK_ROOT.iterdir():
            _rmtree(p)


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/run")
def run(body: RunIn, x_sandbox_token: str = Header(default="")) -> RunOut:
    if not hmac.compare_digest(x_sandbox_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=401, detail="bad token")
    # One run at a time: no two runs (or two companies' files) ever coexist.
    if not _RUN_LOCK.acquire(timeout=QUEUE_SECONDS):
        raise HTTPException(status_code=503, detail="sandbox busy, try again shortly")
    try:
        return _run_locked(body)
    finally:
        _RUN_LOCK.release()


def _run_locked(body: RunIn) -> RunOut:
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="run-", dir=WORK_ROOT))  # mode 0700
    out_dir = work / "out"
    out_dir.mkdir(mode=0o700)
    pgid = 0
    try:
        total_in = 0
        for f in body.files:
            name = os.path.basename(f.name)[:120] or "input"
            if name in (".", ".."):
                name = "input"
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
            "MPLCONFIGDIR": str(work / ".mpl"),
            "OPENBLAS_NUM_THREADS": "1",
        }
        timed_out = False
        proc = subprocess.Popen(  # noqa: S603 - fixed argv; isolation is the container + rlimits
            [sys.executable, "-I", "main.py"],
            cwd=work,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=_limits,  # noqa: PLW1509 - set rlimits in the child
            start_new_session=True,  # its own session + process group, killed as a whole
            close_fds=True,
        )
        pgid = proc.pid  # session leader: pgid == pid
        try:
            stdout, stderr = proc.communicate(input=body.stdin.encode(), timeout=WALL_SECONDS)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            # Out of time (or a leftover process still holds the output pipes open): kill the
            # whole group and anything that escaped it, so the pipes close and nothing lingers.
            main_done = proc.poll() is not None  # exited, but a leftover held the pipes
            timed_out = not main_done
            _sweep(pgid)
            try:
                stdout, stderr = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                for pipe in (proc.stdin, proc.stdout, proc.stderr):
                    if pipe is not None:
                        pipe.close()
                proc.wait(timeout=5)
                stdout, stderr = b"", b""
            code = proc.returncode if main_done else -1
        # Normal exit too: background children of the run die with it.
        _sweep(pgid)

        files = []
        root = out_dir.resolve()
        for p in sorted(out_dir.rglob("*")):
            if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root):
                continue  # never follow a link out of the run directory
            if p.stat().st_size <= MAX_FILE_BYTES and len(files) < 20:
                files.append(
                    OutFile(
                        name=p.relative_to(out_dir).as_posix(),
                        b64=base64.b64encode(p.read_bytes()).decode(),
                    )
                )
        return RunOut(
            stdout=(stdout or b"").decode("utf-8", "replace")[:MAX_OUTPUT],
            stderr=(stderr or b"").decode("utf-8", "replace")[:MAX_OUTPUT],
            exit_code=code,
            timed_out=timed_out,
            files=files,
        )
    finally:
        if pgid:
            _sweep(pgid)
        _rmtree(work)
        _clear_scratch()
