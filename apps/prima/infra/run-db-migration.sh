bash <<'PRIMA_MIGRATE'
# Prima staging: database migration, run by the CEO (or an administrator the CEO names) in Azure Cloud Shell (Bash),
# signed in with their own Azure account. This is the ONLY way the database setup job runs: GitHub's deployment
# identity has no permission to change, start or read the secrets of that job, because the job holds the database
# administrator login (db-admin-url).
#
# Before pasting, set the image the "Deploy staging" run built and stopped for (it prints this exact line):
#   export IMAGE_TAG=<40-character commit ID>
# If your setup job is not called caj-prima-dbsetup-staging, also: export SETUP_JOB=<its name>
#
# What it does, after you type MIGRATE:
#  1. checks that image prima-api:<IMAGE_TAG> exists in acrprimastagingsea (built by Deploy staging from main);
#  2. points the existing setup job at that image (its settings, identity and secrets stay as they are);
#  3. runs it once and waits. The setup (apps/api/src/db-setup.ts) adds new tables, row walls and grants, restates
#     the API login's read rights and records the schema version. It never deletes, empties or reloads records, never
#     changes the CEO's Microsoft link, and only loads the starting accounts into a database that has none.
# Then run "Deploy staging" again: it sees the new schema version and continues.
set -euo pipefail
RG=rg-prima-staging-sea
ACR=acrprimastagingsea
JOB=${SETUP_JOB:-caj-prima-dbsetup-staging}
TAG=${IMAGE_TAG:-}
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || { echo "Set IMAGE_TAG to the 40-character commit ID from the Deploy staging run first. Nothing was changed."; exit 1; }
IMAGE=$ACR.azurecr.io/prima-api:$TAG

[ "$(az acr repository show-tags -n $ACR --repository prima-api --query "contains(@, '$TAG')" -o tsv 2>/dev/null)" = true ] ||
  { echo "Image $IMAGE was not found. Run Deploy staging from main first. Nothing was changed."; exit 1; }
CURRENT=$(az containerapp job show -n "$JOB" -g $RG --query "properties.template.containers[0].image" -o tsv 2>/dev/null || true)
[ -n "$CURRENT" ] || { echo "Setup job $JOB was not found in $RG. Nothing was changed."; exit 1; }
ARGS=$(az containerapp job show -n "$JOB" -g $RG --query "join(' ', properties.template.containers[0].args || \`[]\`)" -o tsv)
[[ "$ARGS" == *db-setup* ]] || { echo "Job $JOB does not run db-setup (args: $ARGS). Stopping; nothing was changed."; exit 1; }

echo "Setup job:      $JOB"
echo "Current image:  $CURRENT"
echo "New image:      $IMAGE"
read -r -p "Type MIGRATE to run the database setup with the new image: " answer </dev/tty
[ "$answer" = MIGRATE ] || { echo "Stopped; nothing was changed."; exit 1; }

az containerapp job update -n "$JOB" -g $RG --image "$IMAGE" -o none
RUN=$(az containerapp job start -n "$JOB" -g $RG --query name -o tsv)
echo "Started run $RUN"
for _ in $(seq 1 60); do
  STATUS=$(az containerapp job execution show -n "$JOB" -g $RG --job-execution-name "$RUN" --query properties.status -o tsv)
  echo "  $STATUS"
  if [ "$STATUS" = Succeeded ]; then echo "Database setup done. Now run Deploy staging again."; exit 0; fi
  if [ "$STATUS" = Failed ]; then
    echo "Database setup FAILED. Its log is in Log Analytics (ContainerAppConsoleLogs_CL, job $JOB). The API was not changed."
    echo "To put the job back: az containerapp job update -n $JOB -g $RG --image $CURRENT"
    exit 1
  fi
  sleep 10
done
echo "Database setup did not finish in 10 minutes; check the job's runs in the Azure portal."; exit 1
PRIMA_MIGRATE
