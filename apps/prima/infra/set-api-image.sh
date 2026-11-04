#!/usr/bin/env bash
# Changes only the container image of the staging API (ca-prima-api-staging), keeping every setting and secret as it
# is. Used by Deploy staging for the update and for the automatic roll-back.
#
# It sends one Azure Resource Manager PATCH with just the container list (same containers, new image), so the
# deployment identity never needs permission to list the app's secrets (Microsoft.App/containerApps/listSecrets),
# which "az containerapp update" may ask for.
# Usage: infra/set-api-image.sh <image>      (needs RG and API_APP from infra/staging-env.sh)
set -euo pipefail
image="${1:?image}"
: "${RG:?}" "${API_APP:?}"
[[ "$image" =~ ^[a-z0-9]+\.azurecr\.io/[a-z0-9._/-]+(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$ ]] || { echo "::error::Refusing image name $image"; exit 1; }
API_VERSION=2024-03-01
id=$(az containerapp show -n "$API_APP" -g "$RG" --query id -o tsv)
uri="https://management.azure.com${id}?api-version=${API_VERSION}"
containers=$(az rest --method get --uri "$uri" --query properties.template.containers -o json)
[ "$(jq length <<<"$containers")" -ge 1 ] || { echo "::error::$API_APP has no containers."; exit 1; }
body=$(jq -c --arg img "$image" '{properties: {template: {containers: (.[0].image = $img)}}}' <<<"$containers")
az rest --method patch --uri "$uri" --headers Content-Type=application/json --body "$body" -o none
echo "Requested image $image for $API_APP."
