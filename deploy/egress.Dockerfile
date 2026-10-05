# syntax=docker/dockerfile:1.7
# The browser's egress proxy (apps/egress): the only way out of the browser network.
# Standard library only, no pip install. Build context: repo root.
FROM python:3.12-slim-trixie

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home app
COPY apps/egress/egress.py /app/egress.py
WORKDIR /app
USER app
EXPOSE 3128
# egress.py handles SIGTERM itself (it runs as PID 1), so no init process is needed.
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["python", "/app/egress.py", "--health"]
CMD ["python", "/app/egress.py"]
