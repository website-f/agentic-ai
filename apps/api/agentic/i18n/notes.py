"""What agents are told about a person's language. Model-facing, so always in English.

Never part of a system prompt (the cached prefix must stay the same for every person):
the chat note rides on the current turn only, the task line on the task's first message.
"""

from dataclasses import dataclass

from . import dialects, normalize

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


# ---------------------------------------------------------------- P97: one voice per person
# The person's language and dialect (users.prefs locale.language / locale.speech) decide how
# EVERY agent speaks to them: their own AI, team agents, private assistants (Chief of Staff),
# task answers, meeting turns and notices. A chat may pick otherwise for itself (`pick`).


@dataclass(frozen=True)
class Voice:
    lang: str  # en | ms: the language this turn is answered in (ms when a dialect applies)
    style: str | None  # a dialect code of i18n.dialects, or None for standard speech
    picked: bool = False  # chosen for this conversation, not the person's setting

    @property
    def key(self) -> str:
        """Part of the answer-reuse key (brain/answers.py)."""
        return f"{self.lang}:{self.style or 'standard'}:{'pick' if self.picked else 'auto'}"


def valid_pick(value: str | None) -> bool:
    """A chat's own choice: en, ms (standard Malay) or a dialect code."""
    return value in ("en", "ms") or dialects.known(value)


def voice_for(lang: str | None, speech: str | None, text: str, pick: str | None = None) -> Voice:
    """How to speak to this person this turn. `lang` is their app language, `speech` their
    dialect setting, `text` what they wrote, `pick` the conversation's own choice."""
    if pick == "en":
        return Voice("en", None, True)
    if pick == "ms":
        return Voice("ms", None, True)
    if pick and dialects.known(pick):
        return Voice("ms", pick, True)
    lang = normalize(lang) or "en"
    style = dialects.style_for(speech, lang, text)
    return Voice("ms", style) if style else Voice(lang, None)


def turn_note(v: Voice, text: str) -> str:
    """The note riding on this turn (chat) for voice `v`; `text` is what the person wrote."""
    if v.style:
        lead = (
            f"(Language: the person picked {dialects.STYLES[v.style].label} for this "
            "conversation.)\n"
            if v.picked
            else ""
        )
        return lead + "\n".join(
            x for x in (dialects.voice_note(v.style, text), dialects.gloss(v.style, text)) if x
        )
    if v.picked:
        tongue = "standard Malay (Bahasa Melayu)" if v.lang == "ms" else "English"
        return (
            f"(Language: the person picked {tongue} for this conversation: reply in it whatever "
            "language they write in, even if earlier replies here used another language or a "
            "dialect.)"
        )
    return f"{chat_note(v.lang)}\n{dialects.plain_note(v.lang)}"


def answer_note(v: Voice, text: str) -> str:
    """For work done for a person (a task they gave, a meeting they are in, a notice to them):
    how to word what is said to them directly. Empty when plain language is enough."""
    if not v.style:
        return ""
    out = (
        "When you answer the person directly (your final answer, notify_person messages to "
        "them): " + dialects.voice_note(v.style, text)
    )
    if g := dialects.gloss(v.style, text):
        out += "\n" + g
    return out


def reader_note(lang: str, speech: str | None) -> str:
    """How a person reads, for an agent about to write to them: "Bahasa Melayu (Kelantan
    Malay)" or "English"."""
    if lang == "ms" and dialects.known(speech):
        return f"Bahasa Melayu, in {dialects.STYLES[speech].label}"  # type: ignore[index]
    return "Bahasa Melayu" if lang == "ms" else "English"
