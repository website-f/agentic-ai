# syntax=docker/dockerfile:1.7
# One image for both `api` and `worker` (different commands). Build context: repo root.

FROM python:3.12-slim-trixie AS build
COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app

# Meeting minutes tell speakers apart on the CPU (agentic/minutes/diarize.py, sherpa-onnx):
# pyannote segmentation-3.0 (MIT) + 3D-Speaker CAM++ zh-en (Apache-2.0), ~34 MB, pinned to
# the official sherpa-onnx release assets and checked by sha256. First, so neither lockfile
# nor code edits download them again. See THIRD_PARTY_NOTICES.md.
ARG SHERPA_RELEASES=https://github.com/k2-fsa/sherpa-onnx/releases/download
RUN <<'PY' python -
import hashlib, io, os, tarfile, urllib.request
base = os.environ["SHERPA_RELEASES"]
out = "/opt/models/speakers"
os.makedirs(out, exist_ok=True)
def get(url, sha):
    data = urllib.request.urlopen(url, timeout=300).read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise SystemExit(f"sha256 mismatch for {url}: {got}")
    return data
seg = get(f"{base}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
          "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488")
with tarfile.open(fileobj=io.BytesIO(seg), mode="r:bz2") as t:
    for name, dst in (("model.onnx", "pyannote-segmentation-3.0.onnx"),
                      ("LICENSE", "pyannote-segmentation-3.0.LICENSE")):
        data = t.extractfile(f"sherpa-onnx-pyannote-segmentation-3-0/{name}").read()
        open(f"{out}/{dst}", "wb").write(data)
if hashlib.sha256(open(f"{out}/pyannote-segmentation-3.0.onnx", "rb").read()).hexdigest() != \
        "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079":
    raise SystemExit("segmentation model checksum mismatch")
emb = get(f"{base}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
          "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2")
open(f"{out}/3dspeaker_campplus_sv_zh_en_16k-common_advanced.onnx", "wb").write(emb)
PY
RUN chmod -R a+rX /opt/models

# Dependencies first, keyed only on the lockfile, so code edits reuse this layer.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=apps/api/uv.lock,target=uv.lock \
    --mount=type=bind,source=apps/api/pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# The brain's embedding model (multilingual, 384 dims, ~220 MB), baked in so containers
# never download at runtime and work offline. Cached on the lockfile, not on code edits.
ARG EMBED_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RUN /app/.venv/bin/python -c "import sys; from fastembed import TextEmbedding; \
TextEmbedding(sys.argv[1], cache_dir='/opt/models')" "$EMBED_MODEL" \
 && find /opt/models -name '*.lock' -delete \
 && chmod -R a+rX /opt/models

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/alembic.ini ./
COPY apps/api/alembic ./alembic
COPY apps/api/agentic ./agentic
# --reinstall-package: uv keys its cached build of a local project on pyproject.toml only, so a
# change to the Python code alone would otherwise ship the previous build.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --reinstall-package agentic


FROM python:3.12-slim-trixie AS runtime
# Document Studio needs OCR for scans and photos (Tesseract, English + Malay) and a
# TrueType sans (Liberation) so generated PDFs print any Latin text. Meeting minutes need
# ffmpeg/ffprobe to pull the sound track out of a recording and cut it into chunks.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-msa fonts-liberation ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=app:app /app /app
COPY --from=build /opt/models /opt/models
# P31: the PC agent's install script templates (agentic/devices/install.py reads them here).
COPY --chown=app:app apps/pc-agent/install /app/pc-agent/install
# The vault and media volumes inherit this owner the first time Docker creates them.
RUN mkdir -p /data/vault /data/media && chown app:app /data/vault /data/media
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AGENTIC_EMBED_CACHE=/opt/models \
    AGENTIC_SPEAKER_MODELS=/opt/models/speakers \
    AGENTIC_VAULT_DIR=/data/vault \
    AGENTIC_MEDIA_DIR=/data/media \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1
USER app
EXPOSE 8501
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "agentic.api.main:app", "--host", "0.0.0.0", "--port", "8501", "--proxy-headers"]
