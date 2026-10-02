# syntax=docker/dockerfile:1.7
# The backup service: pg_dump (same major version as the server) + restic.
# `agentic-backup loop` runs nightly; `backup`, `restore`, `snapshots`, `check` on demand.
FROM postgres:17.11-alpine3.24

# gosu (from the base image) is never used here and carries old Go CVEs: remove it.
RUN rm -f /usr/local/bin/gosu \
 && apk add --no-cache restic tini tzdata \
 && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
 && mkdir -p /repo /work /restore && chown app:app /repo /work /restore

COPY --chmod=0755 deploy/backup/agentic-backup.sh /usr/local/bin/agentic-backup

# Read-only root: restic keeps its cache on the work volume.
ENV RESTIC_CACHE_DIR=/work/cache HOME=/work
USER app
ENTRYPOINT ["/sbin/tini", "--", "agentic-backup"]
CMD ["loop"]
