#!/usr/bin/env bash
# Reads infra/staging.env (IDs and names only, never secrets), checks every value and adds them to the GitHub Actions
# environment. Used by the deploy and check workflows.
#
# The resource names are the ones that really exist in Azure (set up by hand on 28 Oct 2026, pre-publication review).
# They are fixed here so that no workflow can work out a different name and create a second copy of anything.
# Only staging names are accepted: nothing here can point a workflow at production.
set -euo pipefail
file=${STAGING_ENV_FILE:-infra/staging.env}
[ -f "$file" ] || { echo "::error::$file is missing. Copy infra/staging.env.example to it and fill in the IDs."; exit 1; }
declare -A v
while IFS='=' read -r key value || [ -n "$key" ]; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  [[ "$key" =~ ^[A-Z_]+$ && "$value" =~ ^[A-Za-z0-9:/._-]+$ ]] || { echo "::error::Bad line in $file: $key"; exit 1; }
  v[$key]=$value
done <"$file"
guid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
for k in AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_CLIENT_ID ENTRA_SPA_CLIENT_ID ENTRA_API_CLIENT_ID; do
  [[ "${v[$k]:-}" =~ $guid ]] || { echo "::error::$k in $file must be an ID (GUID)."; exit 1; }
done
[[ "${v[WEB_ORIGIN]:-}" =~ ^https://[a-z0-9.-]+$ ]] || { echo "::error::WEB_ORIGIN must be https://<host> with no trailing slash."; exit 1; }
[[ "${v[API_URL]:-}" =~ ^https://[a-z0-9.-]+$ ]] || { echo "::error::API_URL must be https://<host> with no trailing slash."; exit 1; }

# The real staging resources. A value in staging.env may only repeat these, never change them.
declare -A want=(
  [AZURE_LOCATION]=southeastasia
  [RG]=rg-prima-staging-sea
  [PG]=psql-prima-staging-sea
  [PG_DATABASE]=appdb
  [ACR]=acrprimastagingsea
  [CAE]=cae-prima-staging-sea
  [API_APP]=ca-prima-api-staging
  [SWA]=swa-prima-staging
  [KV]=kv-prima-staging-sea
  [APP_IDENTITY]=id-prima-staging-app
  [DBSETUP_IDENTITY]=id-prima-staging-dbsetup
)
for k in "${!want[@]}"; do
  if [ -n "${v[$k]:-}" ] && [ "${v[$k]}" != "${want[$k]}" ]; then
    echo "::error::$k in $file is ${v[$k]}, but the staging resource is ${want[$k]}. Refusing to continue."
    exit 1
  fi
  v[$k]=${want[$k]}
done
# The database setup job is the one name not given in the setup notes; it must be a staging name.
v[SETUP_JOB]=${v[SETUP_JOB]:-caj-prima-dbsetup-staging}
[[ "${v[SETUP_JOB]}" =~ ^[a-z0-9-]*staging[a-z0-9-]*$ ]] || { echo "::error::SETUP_JOB must be a staging job name."; exit 1; }
[[ "${v[API_URL]}" == "https://${v[API_APP]}."* ]] || { echo "::error::API_URL must be the address of ${v[API_APP]}."; exit 1; }

{
  for k in "${!v[@]}"; do echo "$k=${v[$k]}"; done
  echo "ENTRA_TENANT_ID=${v[AZURE_TENANT_ID]}"
  echo "AZURE_RESOURCE_GROUP=${v[RG]}"
} >>"${GITHUB_ENV:-/dev/stdout}"
