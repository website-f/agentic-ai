# syntax=docker/dockerfile:1.7
# The code sandbox: runs agents' Python in a sealed container (no network, no secrets).
# Build context: repo root.
FROM python:3.12-slim-trixie

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY apps/sandbox/requirements.txt /app/requirements.txt
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core \
 && pip install -r /app/requirements.txt \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home app \
 && mkdir /work && chown app:app /work
COPY apps/sandbox/service.py /app/service.py
WORKDIR /app
USER app
EXPOSE 8610
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8610"]
