"""P33: the privacy gateway: trusted providers, OpenRouter zero data retention, each
company's data level, and how much of each model call was masked

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-16 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_providers",
        sa.Column("trusted", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "ai_providers",
        sa.Column("require_zdr", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Defaults by preset (or by address, for providers added without one): the local model,
    # OpenAI and Anthropic do not train on API data, so they start trusted; OpenRouter
    # starts with zero data retention required.
    op.execute(
        "UPDATE ai_providers SET trusted = true WHERE tier = 'local' OR name = 'Local backup' "
        "OR preset IN ('openai', 'anthropic') OR base_url LIKE 'https://api.openai.com%' "
        "OR base_url LIKE 'https://api.anthropic.com%'"
    )
    op.execute(
        "UPDATE ai_providers SET require_zdr = true WHERE preset = 'openrouter' "
        "OR base_url LIKE 'https://openrouter.ai%'"
    )
    op.add_column(
        "branches",
        sa.Column("data_level", sa.String(16), nullable=False, server_default="standard"),
    )
    op.add_column(
        "llm_calls", sa.Column("masked", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("llm_calls", sa.Column("branch_id", sa.String(40)))
    op.add_column("llm_calls", sa.Column("data_level", sa.String(16)))


def downgrade() -> None:
    op.drop_column("llm_calls", "data_level")
    op.drop_column("llm_calls", "branch_id")
    op.drop_column("llm_calls", "masked")
    op.drop_column("branches", "data_level")
    op.drop_column("ai_providers", "require_zdr")
    op.drop_column("ai_providers", "trusted")
