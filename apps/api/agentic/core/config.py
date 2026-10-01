"""Runtime settings. Every variable is prefixed AGENTIC_ (see .env.example).

Defaults target local development against the compose stack's dev ports
(Postgres 8506, Valkey 8507, Temporal 8508), so `uv run` works with no .env.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-change-me"  # noqa: S105 - refused outside env=dev


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AGENTIC_", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic"
    valkey_url: str = "redis://localhost:8507/0"
    temporal_address: str = "localhost:8508"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "agentic-main"

    secret_key: str = DEV_SECRET
    # Secure cookies need HTTPS; localhost dev runs plain HTTP, so this stays off
    # until the stack sits behind TLS.
    cookie_secure: bool = False
    session_days: int = Field(default=14, ge=1, le=90)

    # 32 random bytes, base64url. Wraps every stored secret. Required outside dev.
    master_key: str = ""
    # Comma-separated hosts that may resolve to private IPs (e.g. a LAN Ollama box).
    private_hosts_allowed: str = ""

    # Brain (P3). Embeddings always run locally on CPU: no API cost, works offline.
    # local = fastembed model below | hash = word hashing (tests) | off = keyword search only
    embed_backend: str = "local"
    embed_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embed_cache: str = ""  # model folder; the Docker image bakes the model into /opt/models
    embed_threads: int = 1
    # A recalled item must match a keyword, or be at least this similar to the query (and
    # close to the best match; see brain/search.py). Measured on English/Malay office text.
    recall_min_similarity: float = 0.38
    # One git repo per workspace, laid out so Obsidian can open it as a vault.
    vault_dir: str = "./data/vault"
    dream_hour: int = Field(default=2, ge=0, le=23)  # local time of the nightly dream

    # Dev only: on startup with no users, create a test workspace and one login per role
    # (agentic/seed.py), so every PC that runs `docker compose up` gets the same accounts.
    dev_seed: bool = True
    seed_workspace: str = "Qbot Group"
    seed_branch: str = "Qbot Studio Sdn Bhd"
    seed_email_domain: str = "example.com"
    seed_password: str = "agentic-test-2026"  # noqa: S105 - dev-only test login

    login_max_fails_per_email: int = 5
    login_max_fails_per_ip: int = 20
    login_lock_seconds: int = 900

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.is_dev and s.secret_key == DEV_SECRET:
        raise RuntimeError("AGENTIC_SECRET_KEY must be set outside env=dev")
    return s


settings = get_settings()
