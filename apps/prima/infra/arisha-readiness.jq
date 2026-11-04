# Presence-only diagnostics. Never disclose values, secret-reference names or provider settings.
def names: ["ARISHA_ENABLED", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_CLIENT_ID", "LEADERSHIP_ONBOARDING_ONLY", "ARISHA_IT_EXTRACTION_ENABLED", "ARISHA_IT_EXTRACTION_SOURCE_TYPES", "ARISHA_IT_EXTRACTION_DATA_CLASSES"];
(.properties.template.containers[0].env // []) as $env |
[names[] as $name |
  ([$env[] | select(.name == $name)][0] // {}) as $entry |
  {name: $name,
   configured: (((($entry.value // "") | length) > 0) or ((($entry.secretRef // "") | length) > 0)),
   enabled: (if ($name == "ARISHA_ENABLED" or $name == "ARISHA_IT_EXTRACTION_ENABLED") then
     (if $entry.value == "true" then true elif $entry.value == "false" then false else null end)
     else null end)}] as $configuration |
{configuration: $configuration,
 warnings: (if ([$configuration[] | select(.name == "ARISHA_IT_EXTRACTION_ENABLED")][0].enabled == true)
   and ([$configuration[] | select(.name == "ARISHA_ENABLED")][0].enabled != true)
   then ["Extraction is enabled but chat is not explicitly enabled. Verify configuration; no setting was changed."]
   else [] end)}
