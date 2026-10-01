# syntax=docker/dockerfile:1.7
# One image for both `api` and `worker` (different commands). Build context: repo root.

FROM python:3.12-slim-bookworm AS build
COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app

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
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable


FROM python:3.12-slim-bookworm AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app \
 && apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=app:app /app /app
COPY --from=build /opt/models /opt/models
# The vault volume inherits this owner the first time Docker creates it.
RUN mkdir -p /data/vault && chown app:app /data/vault
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    AGENTIC_EMBED_CACHE=/opt/models \
    AGENTIC_VAULT_DIR=/data/vault \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1
USER app
EXPOSE 8501
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "agentic.api.main:app", "--host", "0.0.0.0", "--port", "8501", "--proxy-headers"]
