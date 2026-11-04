bash <<'PRIMA_BOOTSTRAP'
# Prima staging: one-time link between GitHub and Azure. Paste the whole file into Azure Cloud Shell (Bash), signed
# in as a subscription Owner (or Owner of rg-prima-staging-sea) who is also allowed to manage the two Prima app
# registrations in Microsoft Entra. It takes about 3 minutes. It costs nothing, but it IS NOT READ-ONLY. It:
#
#  Microsoft Entra (sign-in) settings, changed only where they differ:
#  - makes "Prima Secure API - Staging" issue version 2 tokens;
#  - lets "Prima Secure App - Staging" (the website) ask for the API's access_as_user scope, and grants admin consent;
#  - adds https://<website>/ to the website registration's single-page-app sign-in addresses (existing ones kept);
#  - turns on "assignment required" for the website, so only assigned people can sign in, and assigns the CEO by the
#    verified CEO object ID below (never "whoever runs this script").
#
#  GitHub deployment identity:
#  - creates the app registration "prima-github-deploy-staging" if missing, with NO password or secret: GitHub proves
#    itself per run through a federated credential that only accepts runs on the main branch of this repository;
#  - gives it only what deploying and the read-only check need, each on the single resource concerned:
#      Reader on rg-prima-staging-sea (read settings for the check), AcrPush on acrprimastagingsea,
#      Key Vault Reader on kv-prima-staging-sea (secret NAMES only, never values), and a custom role
#      "Prima Staging Deployer" on ca-prima-api-staging, swa-prima-staging, cae-prima-staging-sea and
#      id-prima-staging-app only: it can change the API's image and read the website's deployment token. It can NOT
#      list any app's or job's secrets, and it has NO permission on the database setup job or its identity
#      (id-prima-staging-dbsetup), because that job holds the database administrator login. Migrations are run by the
#      CEO with infra/run-db-migration.sh;
#  - removes from this identity (only) an earlier resource-group-wide Contributor or Key Vault Secrets Officer role,
#    and the deployer role on the setup job and its identity, if an earlier version of this script gave them.
#
#  Budget: creates the e-mail alert budget "prima-staging-monthly" (USD 64; alerts at 50%, 80%, 100% and forecast
#  100% to subscription Owners) only if no budget of that name exists. A budget only sends e-mails; it never stops
#  anything.
#
# It does NOT create, change or delete the database, Key Vault or its secrets, the registry, the Container Apps
# environment, the API, the setup job, the website, or the identities id-prima-staging-app and
# id-prima-staging-dbsetup (their access is left exactly as it is). It stops if any of them is missing.
# It is safe to run again: every step checks first and only adds what is missing.
# At the end it prints IDs only (no passwords, keys or tokens) for infra/staging.env.
set -euo pipefail
RG=rg-prima-staging-sea
REPO=fauzan4377/prima-secure-app
# The CEO's Microsoft Entra object ID, verified by the CEO on 28 Oct 2026.
CEO=98cc4e91-fb99-4f21-82e9-4535d9cda167
ACR=acrprimastagingsea
KV=kv-prima-staging-sea
API_APP=ca-prima-api-staging
CAE=cae-prima-staging-sea
SWA=swa-prima-staging
APP_ID_NAME=id-prima-staging-app
SETUP_ID_NAME=id-prima-staging-dbsetup
SETUP_JOB=${SETUP_JOB:-caj-prima-dbsetup-staging}
DEPLOY_NAME=prima-github-deploy-staging
ROLE_NAME="Prima Staging Deployer"
GRAPH=https://graph.microsoft.com/v1.0
say() { printf '\n== %s\n' "$*"; }
retry() { for _ in 1 2 3 4 5 6; do "$@" && return 0; sleep 10; done; "$@"; }
id_of() { az "$@" --query id -o tsv 2>/dev/null || true; }

say "Finding the subscription that holds $RG"
SUB=""
for s in $(az account list --query "[?state=='Enabled'].id" -o tsv); do
  if [ "$(az group exists -n "$RG" --subscription "$s")" = true ]; then SUB=$s; break; fi
done
[ -n "$SUB" ] || { echo "Resource group $RG was not found in your subscriptions. Stopping."; exit 1; }
az account set -s "$SUB"
TENANT=$(az account show --query tenantId -o tsv)
SCOPE=$(az group show -n "$RG" --query id -o tsv)
echo "Subscription $SUB"

say "Checking the existing staging resources (nothing is created here)"
ACR_ID=$(id_of acr show -g $RG -n $ACR)
KV_ID=$(id_of keyvault show -g $RG -n $KV)
API_ID=$(id_of containerapp show -g $RG -n $API_APP)
CAE_ID=$(id_of containerapp env show -g $RG -n $CAE)
SWA_ID=$(id_of staticwebapp show -g $RG -n $SWA)
APP_UAI_ID=$(id_of identity show -g $RG -n $APP_ID_NAME)
SETUP_UAI_ID=$(id_of identity show -g $RG -n $SETUP_ID_NAME)
JOB_ID=$(id_of containerapp job show -g $RG -n "$SETUP_JOB")
for pair in "registry:$ACR_ID" "key vault:$KV_ID" "API:$API_ID" "environment:$CAE_ID" "website:$SWA_ID" \
  "app identity:$APP_UAI_ID" "setup identity:$SETUP_UAI_ID" "setup job $SETUP_JOB:$JOB_ID"; do
  [ -n "${pair#*:}" ] || { echo "The ${pair%%:*} was not found in $RG. Stopping; nothing was changed."; exit 1; }
done
echo "All found."

say "Checking the CEO account"
CEO_NAME=$(az ad user show --id "$CEO" --query userPrincipalName -o tsv 2>/dev/null || true)
[ -n "$CEO_NAME" ] || { echo "No Entra user has object ID $CEO in this directory. Stopping; nothing was changed."; exit 1; }
echo "CEO: $CEO_NAME ($CEO)"

say "Microsoft sign-in registrations (changes only what differs)"
SPA=$(az ad app list --filter "displayName eq 'Prima Secure App - Staging'" --query "[0].appId" -o tsv)
API=$(az ad app list --filter "displayName eq 'Prima Secure API - Staging'" --query "[0].appId" -o tsv)
[ -n "$SPA" ] && [ -n "$API" ] || { echo "Could not find 'Prima Secure App - Staging' and 'Prima Secure API - Staging'. Stopping."; exit 1; }
API_OBJ=$(az ad app show --id "$API" --query id -o tsv)
SPA_OBJ=$(az ad app show --id "$SPA" --query id -o tsv)
API_URI=$(az ad app show --id "$API" --query "identifierUris[0]" -o tsv)
SCOPE_ID=$(az ad app show --id "$API" --query "api.oauth2PermissionScopes[?value=='access_as_user' && isEnabled].id | [0]" -o tsv)
[ -n "$API_URI" ] && [ -n "$SCOPE_ID" ] || { echo "Prima Secure API - Staging must have an Application ID URI and an enabled access_as_user scope. Stopping."; exit 1; }
if [ "$(az ad app show --id "$API" --query api.requestedAccessTokenVersion -o tsv)" != 2 ]; then
  APIBLOCK=$(az rest --method GET --uri "$GRAPH/applications/$API_OBJ?\$select=api" --query api -o json)
  az rest --method PATCH --uri "$GRAPH/applications/$API_OBJ" --headers Content-Type=application/json \
    --body "$(jq -c '{api: (. + {requestedAccessTokenVersion: 2})}' <<<"$APIBLOCK")" -o none
  echo "Changed: the API now issues version 2 tokens."
fi
if [ "$(az ad app show --id "$SPA" --query "length(requiredResourceAccess[?resourceAppId=='$API'])" -o tsv)" = 0 ]; then
  az ad app permission add --id "$SPA" --api "$API" --api-permissions "$SCOPE_ID=Scope" -o none 2>/dev/null || true
  echo "Changed: the website may now ask for the API scope."
fi
az ad sp show --id "$API" -o none 2>/dev/null || { az ad sp create --id "$API" -o none; echo "Changed: API enterprise application created."; }
az ad sp show --id "$SPA" -o none 2>/dev/null || { az ad sp create --id "$SPA" -o none; echo "Changed: website enterprise application created."; }
SPA_SP=$(az ad sp show --id "$SPA" --query id -o tsv)
API_SP=$(az ad sp show --id "$API" --query id -o tsv)
# Check the existing tenant-wide (AllPrincipals) delegated consent first; only ask for consent when access_as_user is missing.
CONSENTED=$(az rest --method GET --uri "$GRAPH/servicePrincipals/$SPA_SP/oauth2PermissionGrants" \
  --query "value[?resourceId=='$API_SP' && consentType=='AllPrincipals'].scope | join(' ', @)" -o tsv)
if [[ " $CONSENTED " == *" access_as_user "* ]]; then
  echo "Checked: admin consent for access_as_user already exists for all users."
else
  az ad app permission admin-consent --id "$SPA" -o none 2>/dev/null && echo "Changed: admin consent granted for access_as_user." ||
    echo "(Admin consent for access_as_user is missing and could not be granted here; an Entra admin must grant it in the portal.)"
fi

WEB="https://$(az staticwebapp show -n $SWA -g $RG --query defaultHostname -o tsv)"
URIS=$(az rest --method GET --uri "$GRAPH/applications/$SPA_OBJ?\$select=spa" --query "spa.redirectUris" -o json)
URIS=${URIS:-null}
if [ "$(jq --arg u "$WEB/" 'index($u) != null' <<<"${URIS/null/[]}")" != true ]; then
  az rest --method PATCH --uri "$GRAPH/applications/$SPA_OBJ" --headers Content-Type=application/json \
    --body "$(jq -c --arg u "$WEB/" '{spa: {redirectUris: ((. // []) + [$u] | unique)}}' <<<"$URIS")" -o none
  echo "Changed: added $WEB/ as a single-page-app sign-in address."
fi

SPGRAPH=$GRAPH/servicePrincipals/$SPA_SP
if [ "$(az rest --method GET --uri "$SPGRAPH/appRoleAssignedTo" --query "length(value[?principalId=='$CEO'])" -o tsv)" = 0 ]; then
  az rest --method POST --uri "$SPGRAPH/appRoleAssignedTo" --headers Content-Type=application/json \
    --body "{\"principalId\":\"$CEO\",\"resourceId\":\"$SPA_SP\",\"appRoleId\":\"00000000-0000-0000-0000-000000000000\"}" -o none
  echo "Changed: the CEO is assigned to the website."
fi
if [ "$(az ad sp show --id "$SPA" --query appRoleAssignmentRequired -o tsv)" != true ]; then
  az rest --method PATCH --uri "$SPGRAPH" --headers Content-Type=application/json --body '{"appRoleAssignmentRequired":true}' -o none
  echo "Changed: only assigned people may sign in to the website."
fi

say "GitHub deployment identity (no password; main branch only)"
DEPLOY=$(az ad app list --filter "displayName eq '$DEPLOY_NAME'" --query "[0].appId" -o tsv)
if [ -n "$DEPLOY" ]; then
  [ "$(az ad app list --filter "displayName eq '$DEPLOY_NAME'" --query 'length(@)' -o tsv)" = 1 ] ||
    { echo "More than one app registration is called $DEPLOY_NAME. Remove the extra one in Entra first. Stopping."; exit 1; }
  echo "Checked: $DEPLOY_NAME already exists ($DEPLOY); reusing it."
else
  DEPLOY=$(az ad app create --display-name $DEPLOY_NAME --sign-in-audience AzureADMyOrg --query appId -o tsv); echo "Created: $DEPLOY_NAME."
fi
az ad sp show --id "$DEPLOY" -o none 2>/dev/null || retry az ad sp create --id "$DEPLOY" -o none
DEPLOY_SP=$(az ad sp show --id "$DEPLOY" --query id -o tsv)
if [ "$(az ad app credential list --id "$DEPLOY" --query 'length(@)' -o tsv)" != 0 ]; then
  echo "WARNING: $DEPLOY_NAME has a password or certificate. It needs none; remove it in Entra (Certificates & secrets)."
fi
# Matched by what it trusts (issuer + main-branch subject), not by name, so a credential from an earlier run is reused.
if [ "$(az ad app federated-credential list --id "$DEPLOY" --query "length([?issuer=='https://token.actions.githubusercontent.com' && subject=='repo:$REPO:ref:refs/heads/main'])" -o tsv)" = 0 ]; then
  az ad app federated-credential create --id "$DEPLOY" -o none --parameters \
    "{\"name\":\"github-main\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:$REPO:ref:refs/heads/main\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
  echo "Created: GitHub sign-in for runs on main only."
else
  echo "Checked: GitHub sign-in for runs on main already exists; reusing it."
fi
OTHER=$(az ad app federated-credential list --id "$DEPLOY" --query "[?subject!='repo:$REPO:ref:refs/heads/main'].name" -o tsv)
[ -z "$OTHER" ] || echo "WARNING: $DEPLOY_NAME also trusts: $OTHER. Remove these unless you added them on purpose."

say "Deployment permissions (each on one resource; added only if missing)"
ROLE_JSON=$(jq -n --arg n "$ROLE_NAME" --arg s "$SCOPE" '{
  Name: $n,
  IsCustom: true,
  Description: "Prima staging deploy: change the API image and read the website deployment token. No secret listing, no jobs.",
  Actions: [
    "Microsoft.App/containerApps/read", "Microsoft.App/containerApps/write", "Microsoft.App/containerApps/revisions/read",
    "Microsoft.App/managedEnvironments/read", "Microsoft.App/managedEnvironments/join/action",
    "Microsoft.App/locations/*/read",
    "Microsoft.ManagedIdentity/userAssignedIdentities/read", "Microsoft.ManagedIdentity/userAssignedIdentities/assign/action",
    "Microsoft.Web/staticSites/read", "Microsoft.Web/staticSites/listSecrets/action"
  ],
  NotActions: [], DataActions: [], NotDataActions: [],
  AssignableScopes: [$s]
}')
ROLE_ID=$(az role definition list --custom-role-only true --scope "$SCOPE" --query "[?roleName=='$ROLE_NAME'].name | [0]" -o tsv)
if [ -z "$ROLE_ID" ]; then
  az role definition create --role-definition "$ROLE_JSON" -o none
  echo "Created: custom role $ROLE_NAME."
  for _ in 1 2 3 4 5 6 7 8 9; do
    ROLE_ID=$(az role definition list --custom-role-only true --scope "$SCOPE" --query "[?roleName=='$ROLE_NAME'].name | [0]" -o tsv)
    [ -n "$ROLE_ID" ] && break; sleep 10
  done
else
  # The role exists: keep its ID, roleName and assignableScopes, and set only its permissions to the approved list.
  # (az role definition update needs the format that "az role definition list" returns, not the create format.)
  EXISTING=$(az role definition list --name "$ROLE_NAME" --custom-role-only true --scope "$SCOPE" -o json)
  [ "$(jq length <<<"$EXISTING")" = 1 ] || { echo "Expected exactly one custom role called '$ROLE_NAME'. Stopping."; exit 1; }
  EXTRA_SCOPES=$(jq -r --arg s "$SCOPE" '.[0].assignableScopes[] | select(ascii_downcase != ($s | ascii_downcase))' <<<"$EXISTING")
  [ -z "$EXTRA_SCOPES" ] || echo "WARNING: $ROLE_NAME may also be assigned at: $EXTRA_SCOPES (kept as it is)."
  WANT=$(jq -c '.Actions' <<<"$ROLE_JSON")
  if [ "$(jq -c '[.[0].permissions[].actions[]] | sort' <<<"$EXISTING")" = "$(jq -c 'sort' <<<"$WANT")" ] &&
     [ "$(jq '[.[0].permissions[] | (.notActions + .dataActions + .notDataActions)[]] | length' <<<"$EXISTING")" = 0 ]; then
    echo "Checked: custom role $ROLE_NAME already has exactly the approved permission list."
  else
    UPDATED=$(jq -c --argjson a "$WANT" --arg d "$(jq -r .Description <<<"$ROLE_JSON")" '.[0]
      | .permissions = [{actions: $a, notActions: [], dataActions: [], notDataActions: []}] | .description = $d' <<<"$EXISTING")
    az role definition update --role-definition "$UPDATED" -o none ||
      { echo "Could not update the custom role '$ROLE_NAME' to its narrower permission list. Stopping."; exit 1; }
    echo "Changed: custom role $ROLE_NAME now has only the approved permission list."
  fi
fi
# Read the role back and refuse to go on unless it holds exactly the approved list: nothing on jobs, and no secret
# listing except the website's deployment token.
for _ in 1 2 3 4 5 6; do
  HAVE=$(az role definition list --name "$ROLE_NAME" --custom-role-only true --scope "$SCOPE" \
    --query "[0].permissions[].actions[]" -o json | jq -c 'sort')
  [ "$HAVE" = "$(jq -c '.Actions | sort' <<<"$ROLE_JSON")" ] && break; sleep 10
done
[ "$HAVE" = "$(jq -c '.Actions | sort' <<<"$ROLE_JSON")" ] ||
  { echo "Custom role $ROLE_NAME does not show the approved list yet (has: $HAVE). Stopping before any grant."; exit 1; }
BAD=$(jq -r '.[] | select(test("^microsoft\\.app/jobs/"; "i") or (test("listsecrets"; "i") and (test("^microsoft\\.web/staticsites/listsecrets/action$"; "i") | not)))' <<<"$HAVE")
[ -z "$BAD" ] || { echo "Custom role $ROLE_NAME holds forbidden actions: $BAD. Stopping."; exit 1; }
echo "Verified: $ROLE_NAME has no setup job permissions and no secret listing apart from the website deploy token."
# Grants a role on one scope unless this identity already holds it there.
grant() {
  local role=$1 scope=$2
  if [ "$(az role assignment list --assignee "$DEPLOY_SP" --role "$role" --scope "$scope" --query 'length(@)' -o tsv)" = 0 ]; then
    retry az role assignment create --assignee-object-id "$DEPLOY_SP" --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope" -o none
    echo "Granted: $role on ${scope##*/}"
  else
    echo "Already: $role on ${scope##*/}"
  fi
}
grant Reader "$SCOPE"
grant AcrPush "$ACR_ID"
grant "Key Vault Reader" "$KV_ID"
for s in "$API_ID" "$SWA_ID" "$CAE_ID" "$APP_UAI_ID"; do grant "$ROLE_NAME" "$s"; done
# Nothing on the database setup job or its identity: remove the role there if an earlier version of this script gave it.
for s in "$JOB_ID" "$SETUP_UAI_ID"; do
  if [ "$(az role assignment list --assignee "$DEPLOY_SP" --role "$ROLE_NAME" --scope "$s" --query 'length(@)' -o tsv)" != 0 ]; then
    az role assignment delete --assignee "$DEPLOY_SP" --role "$ROLE_NAME" --scope "$s" -o none
    echo "Removed: $ROLE_NAME on ${s##*/} from $DEPLOY_NAME."
  fi
done
for r in Contributor Owner "Key Vault Secrets Officer" "Key Vault Secrets User" "Key Vault Administrator"; do
  for s in "$JOB_ID" "$SETUP_UAI_ID" "$KV_ID"; do
    if [ "$(az role assignment list --assignee "$DEPLOY_SP" --role "$r" --scope "$s" --query 'length(@)' -o tsv)" != 0 ]; then
      echo "WARNING: $DEPLOY_NAME holds $r on ${s##*/}. It should not; remove it in Access control (IAM)."
    fi
  done
done
# An earlier version of this script gave the deployment identity Contributor and Key Vault Secrets Officer on the
# whole resource group. Remove those from THIS identity only (other people's access is not touched).
for r in Contributor "Key Vault Secrets Officer"; do
  if [ "$(az role assignment list --assignee "$DEPLOY_SP" --role "$r" --scope "$SCOPE" --query 'length(@)' -o tsv)" != 0 ]; then
    az role assignment delete --assignee "$DEPLOY_SP" --role "$r" --scope "$SCOPE" -o none
    echo "Removed: $r on $RG from $DEPLOY_NAME."
  fi
done

say "Budget e-mail alerts (created only if missing; never stops anything)"
BUDGET_URI="https://management.azure.com$SCOPE/providers/Microsoft.Consumption/budgets/prima-staging-monthly?api-version=2023-05-01"
if az rest --method GET --uri "$BUDGET_URI" -o none 2>/dev/null; then
  echo "Already: budget prima-staging-monthly (left as it is)."
else
  START=$(date -u +%Y-%m-01)
  az rest --method PUT -o none --headers Content-Type=application/json --uri "$BUDGET_URI" \
    --body "{\"properties\":{\"category\":\"Cost\",\"amount\":64,\"timeGrain\":\"Monthly\",\"timePeriod\":{\"startDate\":\"${START}T00:00:00Z\",\"endDate\":\"2028-12-31T00:00:00Z\"},\"notifications\":{\"a50\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":50,\"thresholdType\":\"Actual\",\"contactRoles\":[\"Owner\"]},\"a80\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":80,\"thresholdType\":\"Actual\",\"contactRoles\":[\"Owner\"]},\"a100\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":100,\"thresholdType\":\"Actual\",\"contactRoles\":[\"Owner\"]},\"f100\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":100,\"thresholdType\":\"Forecasted\",\"contactRoles\":[\"Owner\"]}}}}" \
    && echo "Created: budget prima-staging-monthly (USD 64, e-mail alerts only)." \
    || echo "(Budget not created; add it by hand if wanted: Cost Management > Budgets.)"
fi

say "Done. Copy everything between the two lines and send it to Claude (IDs only, nothing secret)"
echo "-----------------------------------------------------------------"
cat <<EOF
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_TENANT_ID=$TENANT
AZURE_CLIENT_ID=$DEPLOY
ENTRA_SPA_CLIENT_ID=$SPA
ENTRA_API_CLIENT_ID=$API
ENTRA_API_APP_ID_URI=$API_URI
WEB_ORIGIN=$WEB
API_URL=https://$(az containerapp show -n $API_APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)
SETUP_JOB=$SETUP_JOB
EOF
echo "-----------------------------------------------------------------"
PRIMA_BOOTSTRAP
