"""Runtime settings. Every variable is prefixed AGENTIC_ (see .env.example).

Defaults target local development against the compose stack's dev ports
(Postgres 8506, Valkey 8507, Temporal 8508), so `uv run` works with no .env.
"""

import base64
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
    # Channels (P6). Push services are fixed; extra hosts only for tests or self-hosted push.
    push_hosts_allowed: str = ""
    push_contact: str = "mailto:agentic@example.com"  # VAPID "sub": who push services contact
    telegram_api_base: str = "https://api.telegram.org"
    # Skills (P4): a finished task with at least this many tool calls is considered for a skill.
    skill_min_tool_calls: int = Field(default=6, ge=2, le=40)

    # Dev only: on startup with no users, create a test workspace and one login per role
    # (agentic/seed.py), so every PC that runs `docker compose up` gets the same accounts.
    dev_seed: bool = True
    seed_workspace: str = "Qbot Group"
    seed_branch: str = "Qbot Studio Sdn Bhd"
    seed_email_domain: str = "example.com"
    seed_password: str = "agentic-test-2026"  # noqa: S105 - dev-only test login

    # Connections per process. A task step can hold two at once (its own session plus the
    # llm_calls log), so the worker needs a pool of at least 2 x worker_max_activities.
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    worker_max_activities: int = Field(default=16, ge=1, le=200)

    # The browser service (Camoufox), reached by the worker only. Empty = no browser tools.
    browser_url: str = "http://browser:8600"
    browser_token: str = "dev-browser-token"  # noqa: S105 - dev default, required outside dev

    # The local backup brain (P14): a small model served by Ollama on this server, e.g.
    # http://ollama:11434/v1. Empty = none. Registered in every workspace as "Local backup".
    local_llm_url: str = ""
    local_llm_model: str = "qwen3:0.6b"

    # Where people open the app (P16): Google sign-in returns here, links in messages point here.
    public_url: str = "http://localhost:8500"
    # Google OAuth app for Gmail (P16). Can also be set in the dashboard (Channels > Google).
    google_client_id: str = ""
    google_client_secret: str = ""
    # WhatsApp through WAHA (P16): the self-hosted gateway, and how it reaches our webhook.
    waha_url: str = "http://waha:3000"
    waha_api_key: str = ""
    internal_api_url: str = "http://api:8501"

    # The code sandbox (P13): a sealed container with no internet and no secrets.
    sandbox_url: str = ""  # empty = the run_python tool is off
    sandbox_token: str = "dev-sandbox-token"  # noqa: S105 - dev default, required outside dev

    # Observability (P8, compose profile `obs`): empty host = no tracing.
    langfuse_host: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""

    login_max_fails_per_email: int = 5
    login_max_fails_per_ip: int = 20
    login_lock_seconds: int = 900

    # Web search (P13). Backends are tried in this order; the keyless DuckDuckGo fallback is
    # always last so search works with no setup. A self-hosted SearXNG is the recommended
    # private option. Set keys to use a paid API.
    searxng_url: str = ""  # e.g. http://searxng:8080 (its JSON API)
    brave_search_key: str = ""
    tavily_key: str = ""
    web_search_enabled: bool = True

    # Meeting minutes from a recording: big uploads stream to this folder (a volume shared by
    # api and worker, never Postgres). The original is deleted once its audio is extracted;
    # the small compressed audio is kept for the workspace's retention days, then purged.
    media_dir: str = "./data/media"
    minutes_max_mb: int = Field(default=1024, ge=1, le=10_240)
    minutes_max_hours: float = Field(default=4.0, gt=0, le=12)

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"


def check(s: Settings) -> None:
    """Outside dev, refuse to start on settings that would be unsafe in front of people."""
    if s.is_dev:
        return
    problems = []
    if s.secret_key == DEV_SECRET or len(s.secret_key) < 32:
        problems.append("AGENTIC_SECRET_KEY must be a random string of 32+ characters")
    try:
        key = base64.urlsafe_b64decode(s.master_key + "=" * (-len(s.master_key) % 4))
    except ValueError:
        key = b""
    if len(key) != 32:
        problems.append("AGENTIC_MASTER_KEY must be 32 random bytes, base64url encoded")
    if s.browser_token == "dev-browser-token":  # noqa: S105 - the known dev value
        problems.append("AGENTIC_BROWSER_TOKEN must be set to a random value")
    if not s.cookie_secure:
        problems.append("AGENTIC_COOKIE_SECURE must be true (serve it over HTTPS)")
    if problems:
        raise RuntimeError(f"Refusing to start with env={s.env}: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    check(s)
    return s


settings = get_settings()
