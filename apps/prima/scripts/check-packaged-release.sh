#!/usr/bin/env bash
# Local/CI image proof only. Never push/start an image or contact the application/provider.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
EXPECTED=$(node scripts/release-artifact.mjs "$ROOT")
TMP=$(mktemp -d)
CID=
IMAGE_ID=
cleanup() {
  if [ -n "$CID" ]; then docker rm "$CID" >/dev/null 2>&1 || true; fi
  if [ -n "$IMAGE_ID" ]; then docker image rm "$IMAGE_ID" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
# Build with the repository lockfile; no registry login/push or runtime environment/secrets.
docker build --iidfile "$TMP/image-id" .
IMAGE_ID=$(cat "$TMP/image-id")
[[ "$IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Invalid built image identity'; exit 1; }
CID=$(docker create --entrypoint /bin/false "$IMAGE_ID")
mkdir -p "$TMP/artifact/apps/api/src/connections-mail"
docker cp "$CID:/app/db" "$TMP/artifact/db"
docker cp "$CID:/app/apps/api/src/connections-mail/job-email-v2.sql" "$TMP/artifact/apps/api/src/connections-mail/job-email-v2.sql"
ACTUAL=$(node scripts/release-artifact.mjs "$TMP/artifact")
[ "$ACTUAL" = "$EXPECTED" ] || { echo 'Packaged complete release differs from reviewed source'; exit 1; }
echo "Unstarted image complete release verified: $ACTUAL"

# Verify the separately pinned explicit base-transition command without starting the image.
mkdir -p "$TMP/ops"
docker cp "$CID:/app/ops/base-transition" "$TMP/ops/base-transition"
node "$ROOT/ops/base-transition/cli.cjs" plan > "$TMP/source-transition.json"
# Candidate code is never executed on the host: compare to trusted source first.
node -e 'const fs=require("fs"),path=require("path"),source=process.argv[1],candidate=process.argv[2];if(!fs.readFileSync(path.join(source,"artifact-manifest.json")).equals(fs.readFileSync(path.join(candidate,"artifact-manifest.json"))))throw Error("Candidate base manifest differs from source");const p=require(path.join(source,"cli.cjs")).verifyArtifact(candidate);console.log(JSON.stringify({status:"plan_only",...p}));' "$ROOT/ops/base-transition" "$TMP/ops/base-transition" > "$TMP/image-transition.json"
node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.argv[1])),b=JSON.parse(fs.readFileSync(process.argv[2]));if(a.status!=="plan_only"||b.status!=="plan_only"||a.artifactSha!==b.artifactSha)process.exit(1)' "$TMP/source-transition.json" "$TMP/image-transition.json"

# Stage 2 (combined base) command: same check, compared to trusted source before any candidate code is read.
docker cp "$CID:/app/ops/combined-upgrade" "$TMP/ops/combined-upgrade"
node "$ROOT/ops/combined-upgrade/cli.cjs" plan > "$TMP/source-combined.json"
node -e 'const fs=require("fs"),path=require("path"),source=process.argv[1],candidate=process.argv[2];if(!fs.readFileSync(path.join(source,"artifact-manifest.json")).equals(fs.readFileSync(path.join(candidate,"artifact-manifest.json"))))throw Error("Candidate combined manifest differs from source");const p=require(path.join(source,"cli.cjs")).verifyArtifact(candidate);console.log(JSON.stringify({status:"plan_only",...p}));' "$ROOT/ops/combined-upgrade" "$TMP/ops/combined-upgrade" > "$TMP/image-combined.json"
node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.argv[1])),b=JSON.parse(fs.readFileSync(process.argv[2]));if(a.status!=="plan_only"||b.status!=="plan_only"||a.artifactSha!==b.artifactSha)process.exit(1)' "$TMP/source-combined.json" "$TMP/image-combined.json"

# Named compatibility/inspect entries are verified from the same unstarted image.
docker cp "$CID:/app/ops/existing-admin" "$TMP/ops/existing-admin"
node "$ROOT/ops/existing-admin/verify.cjs" > "$TMP/source-operator.json"
node "$ROOT/ops/existing-admin/verify.cjs" "$TMP/ops/existing-admin" > "$TMP/image-operator.json"
cmp "$TMP/source-operator.json" "$TMP/image-operator.json"
cat "$TMP/image-operator.json"
