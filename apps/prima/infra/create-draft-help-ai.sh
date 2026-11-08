bash <<'PRIMA_DRAFT_HELP_AI'
# Prima staging: create the Azure OpenAI resource for suggested drafts (rule DRAFT-HELP; Fauzan approved creating it
# on 5 Nov 2026). Paste the whole file into Azure Cloud Shell (Bash), signed in as Owner of rg-prima-staging-sea.
# It IS NOT READ-ONLY and it starts a pay-per-use service (charged only when someone asks for a suggestion). It:
#
#  - creates the Azure OpenAI account oai-prima-staging-sea in rg-prima-staging-sea (Southeast Asia) if missing, with
#    key sign-in TURNED OFF (only Microsoft Entra identities can call it, so there is no AI key to leak);
#  - deploys one small chat model (the first of gpt-4.1-mini, gpt-4o-mini that this account offers, newest generally
#    available version) as "prima-drafts" on Global Standard pay-per-use with a low rate limit (20 = 20,000 tokens a
#    minute), never provisioned hourly throughput;
#  - gives the API's own identity id-prima-staging-app the "Cognitive Services OpenAI User" role on THIS account only;
#  - prints the settings for the API. It does NOT change the API: suggested drafts stay off until PR #116 is merged and
#    deployed and DRAFT_HELP_ENABLED=true is set (a separate, recorded step).
#
# Costs stay under the existing staging budget alert "prima-staging-monthly". Check the model's price on
# https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/ before running.
# To remove everything it made: az cognitiveservices account delete -g rg-prima-staging-sea -n oai-prima-staging-sea
# (then purge it from "deleted resources" if the name must be reused).
set -euo pipefail

SUBSCRIPTION=25160f28-6994-4787-be7a-df622e1088a9
RG=rg-prima-staging-sea
LOCATION=${LOCATION:-southeastasia}
ACCOUNT=${ACCOUNT:-oai-prima-staging-sea}
DEPLOYMENT=prima-drafts
APP_ID_NAME=id-prima-staging-app
CAPACITY=20
MODELS="gpt-4.1-mini gpt-4o-mini"

az account set --subscription "$SUBSCRIPTION"
az group show -n "$RG" -o none

if ! az cognitiveservices account show -g "$RG" -n "$ACCOUNT" -o none 2>/dev/null; then
  echo "Creating Azure OpenAI account $ACCOUNT in $LOCATION ..."
  az cognitiveservices account create -g "$RG" -n "$ACCOUNT" -l "$LOCATION" --kind OpenAI --sku S0 \
    --custom-domain "$ACCOUNT" --yes -o none
fi
ACCOUNT_ID=$(az cognitiveservices account show -g "$RG" -n "$ACCOUNT" --query id -o tsv)
# Entra only: no keys.
az resource update --ids "$ACCOUNT_ID" --set properties.disableLocalAuth=true -o none
ENDPOINT=$(az cognitiveservices account show -g "$RG" -n "$ACCOUNT" --query properties.endpoint -o tsv)

if ! az cognitiveservices account deployment show -g "$RG" -n "$ACCOUNT" --deployment-name "$DEPLOYMENT" -o none 2>/dev/null; then
  PICK=""
  for M in $MODELS; do
    # Newest generally available version whose retirement date (if any) is still ahead.
    V=$(az cognitiveservices account list-models -g "$RG" -n "$ACCOUNT" -o json | jq -r --arg m "$M" --arg today "$(date -u +%F)" \
      '[.[] | select(.name==$m and .lifecycleStatus=="GenerallyAvailable" and ((.deprecation.inference // "9999") > $today))] | map(.version) | sort | last // empty')
    if [ -n "$V" ]; then PICK="$M $V"; break; fi
  done
  [ -n "$PICK" ] || { echo "None of $MODELS is offered to $ACCOUNT in $LOCATION. Stop here and tell the project thread which models list-models shows."; exit 1; }
  set -- $PICK
  echo "Deploying $1 version $2 as $DEPLOYMENT (Global Standard, capacity $CAPACITY) ..."
  az cognitiveservices account deployment create -g "$RG" -n "$ACCOUNT" --deployment-name "$DEPLOYMENT" \
    --model-format OpenAI --model-name "$1" --model-version "$2" --sku-name GlobalStandard --sku-capacity "$CAPACITY" -o none
fi

PRINCIPAL=$(az identity show -g "$RG" -n "$APP_ID_NAME" --query principalId -o tsv)
CLIENT_ID=$(az identity show -g "$RG" -n "$APP_ID_NAME" --query clientId -o tsv)
if [ -z "$(az role assignment list --assignee "$PRINCIPAL" --scope "$ACCOUNT_ID" --role 'Cognitive Services OpenAI User' --query '[0].id' -o tsv)" ]; then
  az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --role 'Cognitive Services OpenAI User' --scope "$ACCOUNT_ID" -o none
fi

echo
echo "=== Done. Paste this block back into the project thread (no secrets in it) ==="
az cognitiveservices account deployment show -g "$RG" -n "$ACCOUNT" --deployment-name "$DEPLOYMENT" \
  --query '{deployment:name,model:properties.model.name,version:properties.model.version,sku:sku.name,capacity:sku.capacity}' -o json
echo "keyLoginOff=$(az cognitiveservices account show -g "$RG" -n "$ACCOUNT" --query properties.disableLocalAuth -o tsv)"
echo "API settings for later (NOT applied by this script):"
echo "  DRAFT_HELP_ENABLED=true"
echo "  AZURE_OPENAI_ENDPOINT=$ENDPOINT"
echo "  DRAFT_HELP_DEPLOYMENT=$DEPLOYMENT"
echo "  AZURE_OPENAI_API_VERSION=2024-10-21"
echo "  AZURE_OPENAI_CLIENT_ID=$CLIENT_ID"
PRIMA_DRAFT_HELP_AI
