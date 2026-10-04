"""Tools only a personal assistant gets (P16). A module of its own so the runtime can read it
without importing the tools (which import the runtime's own tool registry)."""

ASSISTANT_ONLY = frozenset(
    {
        "company_pulse",
        "team_performance",
        "slacking_report",
        "message_agent",
        "email_search",
        "email_read",
        "email_draft_reply",
        "email_draft",
        "calendar_agenda",
        "calendar_free_slots",
        "calendar_create_event",
        "calendar_update_event",
        "calendar_cancel_event",
    }
)
