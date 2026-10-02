"""Print fresh secrets for .env (VPS or any non-dev install). Standard library only.

    python3 deploy/scripts/gen-secrets.py >> .env   # then remove the empty duplicates
"""

import base64
import secrets

print(f"AGENTIC_SECRET_KEY={secrets.token_urlsafe(48)}")
print(f"AGENTIC_MASTER_KEY={base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()}")
print(f"AGENTIC_DB_PASSWORD={secrets.token_urlsafe(24)}")
print(f"TEMPORAL_DB_PASSWORD={secrets.token_urlsafe(24)}")
print(f"RESTIC_PASSWORD={secrets.token_urlsafe(32)}")
print(f"AGENTIC_BROWSER_TOKEN={secrets.token_urlsafe(32)}")
