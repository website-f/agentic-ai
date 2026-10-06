# syntax=docker/dockerfile:1.7
# The browser service: Camoufox (a Firefox build made for automation) behind a small API.
# Build context: repo root.
FROM python:3.12-slim-trixie

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY apps/browser/requirements.txt /app/requirements.txt
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core fonts-liberation \
 && pip install -r /app/requirements.txt \
 && python -m playwright install-deps firefox \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app

USER app
# The browser binary lives in the app user's cache, baked in so it never downloads at run.
# Camoufox checks its profile folder exists before launch (the root file system is read-only
# at run time; compose mounts a tmpfs over it).
RUN python -m camoufox fetch && mkdir -p /home/app/.camoufox
COPY --chown=app:app apps/browser/service.py apps/browser/snapshot.py /app/
WORKDIR /app
EXPOSE 8600
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8600"]
