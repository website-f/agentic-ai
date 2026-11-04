#!/usr/bin/env bash
# Read-only verification of Prima staging / Arisha Azure prerequisites.
# This script does not create resources, change settings or print secret values.
set -euo pipefail

SUBSCRIPTION="25160f28-6994-4787-be7a-df622e1088a9"
RG="rg-prima-staging-sea"
API="ca-prima-api-staging"

command -v az >/dev/null || { echo "Azure CLI is required."; exit 1; }
command -v jq >/dev/null || { echo "jq is required."; exit 1; }
command -v node >/dev/null || { echo "Node.js 20 or newer is required."; exit 1; }
az account set --subscription "$SUBSCRIPTION"

echo "=== Azure subscription ==="
az account show --query '{Name:name,Id:id,Tenant:tenantId}' -o table

echo "=== Azure OpenAI and Azure AI resources (subscription-wide) ==="
az cognitiveservices account list \
  --query "[?kind=='OpenAI' || kind=='AIServices'].{Name:name,Kind:kind,Region:location,Group:resourceGroup,Endpoint:properties.endpoint,Id:id}" -o table

echo "=== API managed identities ==="
az containerapp show -g "$RG" -n "$API" \
  --query '{Type:identity.type,SystemPrincipal:identity.principalId,UserAssigned:identity.userAssignedIdentities}' -o json

echo "=== Arisha configuration presence (never prints endpoints or deployment names) ==="
az containerapp show -g "$RG" -n "$API" -o json | node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/arisha-readiness.mjs"

echo "=== Ready container revision/image ==="
az containerapp show -g "$RG" -n "$API" \
  --query '{Latest:properties.latestRevisionName,Ready:properties.latestReadyRevisionName,Image:properties.template.containers[0].image}' -o json

echo "=== Entra accounts: view identity only, no account changes ==="
for email in nabilahjaafar@pwvsb.com faizjaafar@pwvsb.com nurshahirah@pwvsb.com; do
  az ad user show --id "$email" --query '{Name:displayName,UPN:userPrincipalName,ObjectId:id}' -o json
done

echo "READ-ONLY check complete. This does not establish any Prima DB user link, Azure OpenAI quota, access role, or cost approval."
