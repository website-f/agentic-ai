"""P109: tasks for people, Trello-like: several assignees and watchers, a checklist, sub-tasks,
attachments from the Files and the Library, a start date and a type of work.

- tasks.start_at: when the work starts (calendar spans and the Gantt bars run start -> due).
- tasks.category: what kind of work it is ("follow_up", "meeting", ...; free text, 40 chars).
- task_people: who a task is for (role "assignee", one or many) and who follows it ("watcher").
  tasks.assignee_user_id stays the first assignee, so every P97 path (scope, needs, moves)
  keeps working; existing people's tasks are copied in as their one assignee.
- task_checklist_items: the ticks of a task's checklist.
- task_attachments: files linked to a task (a Library guideline or another task's file is
  linked, never moved).

Additive only. Downgrade drops the three tables and the two columns (people's extra
assignees, watchers, checklists and links go; the tasks themselves stay).

Revision ID: 0067
Revises: 0066
Create Date: 2026-11-17 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("start_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("category", sa.String(40), nullable=True))
    op.create_index("ix_tasks_ws_due", "tasks", ["workspace_id", "due_at"])

    op.create_table(
        "task_people",
        sa.Column(
            "task_id",
            sa.String(40),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(40),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(12), nullable=False, server_default="assignee"),
        sa.Column("added_by", sa.String(80), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("role IN ('assignee', 'watcher')", name="ck_task_people_role"),
    )
    op.create_index("ix_task_people_user", "task_people", ["user_id", "role"])

    op.create_table(
        "task_checklist_items",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column(
            "task_id",
            sa.String(40),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.String(300), nullable=False),
        sa.Column("done", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("position", sa.Float, nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(80), nullable=False, server_default=""),
        sa.Column("done_by", sa.String(80), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_task_checklist_task", "task_checklist_items", ["task_id", "position"])

    op.create_table(
        "task_attachments",
        sa.Column(
            "task_id",
            sa.String(40),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "file_id",
            sa.String(40),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("added_by", sa.String(80), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_task_attachments_file", "task_attachments", ["file_id"])

    # Every person's task so far has its one assignee in task_people too.
    op.execute(
        "INSERT INTO task_people (task_id, user_id, role, added_by, created_at) "
        "SELECT id, assignee_user_id, 'assignee', created_by, created_at FROM tasks "
        "WHERE assignee_user_id IS NOT NULL ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.drop_index("ix_task_attachments_file", table_name="task_attachments")
    op.drop_table("task_attachments")
    op.drop_index("ix_task_checklist_task", table_name="task_checklist_items")
    op.drop_table("task_checklist_items")
    op.drop_index("ix_task_people_user", table_name="task_people")
    op.drop_table("task_people")
    op.drop_index("ix_tasks_ws_due", table_name="tasks")
    op.drop_column("tasks", "category")
    op.drop_column("tasks", "start_at")
