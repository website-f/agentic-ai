"""What agents are told about a person's language. Model-facing, so always in English.

Never part of a system prompt (the cached prefix must stay the same for every person):
the chat note rides on the current turn only, the task line on the task's first message.
"""

from . import normalize

NAMES: dict[str, str] = {
    "en": "English",
    "ms": "Bahasa Melayu (natural Malaysian Malay as said in a Malaysian office, not Indonesian)",
}


def _name(lang: str | None) -> str:
    return NAMES[normalize(lang) or "en"]


def chat_note(lang: str | None) -> str:
    """For one chat turn: answer in the person's language."""
    return (
        "(Language: reply in the language the person writes in. If that is unclear, use "
        f"{_name(lang)}, the language they chose in the app.)"
    )


def task_line(lang: str | None) -> str:
    """For the first message of a task a person created: report in the brief's language."""
    return (
        "\n\nLanguage: write your final answer and any report in the language the brief is "
        f"written in. If the brief mixes languages or is unclear, use {_name(lang)}, the "
        "language of the person who asked. A brief may also ask for a language explicitly."
    )
