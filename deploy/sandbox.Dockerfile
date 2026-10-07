# syntax=docker/dockerfile:1.7
# The code sandbox: runs agents' Python in a sealed container (no network, no secrets).
# Build context: repo root.
#
# Its own uid (10010): api, worker, browser, egress and backup run as 10001, and per-uid
# limits (RLIMIT_NPROC) and signals must never cross between them and agents' code.
# /app (the server) is root-owned and read-only to that uid; runs live under /work (tmpfs).
FROM python:3.12-slim-trixie

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY apps/sandbox/requirements.txt /app/requirements.txt
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core \
 && pip install -r /app/requirements.txt \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10010 sandbox \
 && useradd --system --uid 10010 --gid sandbox --no-create-home sandbox \
 && mkdir /work && chown sandbox:sandbox /work && chmod 0700 /work
COPY --chown=root:root --chmod=0644 apps/sandbox/service.py /app/service.py
WORKDIR /app
USER 10010:10010
EXPOSE 8610
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8610"]
