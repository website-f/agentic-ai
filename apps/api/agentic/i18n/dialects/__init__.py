"""P37: agents that speak like the person: casual Malay (bahasa pasar) and the dialects of the
states (Kelantan, Terengganu, Kedah/Utara, Perak, Pahang, Negeri Sembilan, Melaka, Johor,
Sabah, Sarawak).

A person picks how their AI speaks to them (prefs locale.speech). Cloud models are not
retrained; each reply is steered instead, on the current turn only (never the cached system
prompt):
- a short guide per dialect, written and checked by hand (pronouns, negation, question
  words, particles): it wins over the word list where they disagree;
- the dialect words for what this conversation is about, and the most used ones, from a pack
  built from mesolitica's Malay-Dialect-Dictionary and Malay-Dialect-Instructions
  (data/<code>.json, made by datasets/malay/scripts/build_dialect_packs.py);
- a few real example sentences with their standard Malay.
Words of the dialect the person types are glossed for the model, so it understands them.
Documents, letters and reports stay in standard Malay whatever the person's style.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent / "data"
WORD = re.compile(r"[a-z']+")
MAX_LEXICON = 28
MAX_EXAMPLES = 3
MAX_GLOSS = 12
MAX_EXAMPLE_CHARS = 170
# Never shown to the model as words to use at work: insults, crude and intimate words (they
# are still glossed when a person types them, so the AI understands).
_RUDE = re.compile(
    r"\b(bodoh|bangang|bengap|gila|sial|celaka|babi|lucah|seluar dalam|kemaluan|seks|"
    r"bogel|telanjang|kentut|busuk|tahi|berak|kencing|pukul|bunuh|mampus|mampos|goda|"
    r"perempuan yang|lelaki yang|merayau|curang|zina|mabuk|judi|sundal|jalang|haram)\b",
    re.I,
)


@dataclass(frozen=True)
class Style:
    code: str
    label: str  # English name (the app translates it)
    region: str
    guide: str  # hand-checked core features


STYLES: dict[str, Style] = {
    s.code: s
    for s in (
        Style(
            "pasar",
            "Casual Malay (bahasa pasar)",
            "",
            "Casual, warm, short. Use aku/kau with friends or saya/awak politely (follow the "
            "person), tak (tidak), dah (sudah), nak (hendak), je (sahaja), kat (di/pada), "
            "camne (bagaimana), apsal/kenapa, takde (tiada), pastu (selepas itu), dorang "
            "(mereka), korang (kamu semua), skang (sekarang), jap (sekejap), ok/okay, boleh, "
            "and the particles la, kan, ke, eh, weh, pun. English work words mixed in are "
            "normal (meeting, report, invoice, deadline, check).",
        ),
        Style(
            "kelantan",
            "Kelantan Malay (loghat Kelate)",
            "Kelantan",
            "ambo/kawe (saya), demo or mu (kamu), dio (dia), gapo (apa), bakpo (kenapa), "
            "guano (bagaimana), mano (mana), nok (nak), dop/tok (tidak), takdok (tiada), "
            "sokmo (selalu), pitih (duit), gak (lagi), jah (sahaja), kecek (cakap), tubik "
            "(keluar), kito (kita); final -a often becomes -o (apa→gapo, mana→mano, "
            "siapa→sapo), final -an often becomes -e (makan→make, jalan→jale).",
        ),
        Style(
            "terengganu",
            "Terengganu Malay (loghat Ganu)",
            "Terengganu",
            "aku/kite (saya, kita), mung (kamu), dia, ape (apa), bakpe (kenapa), guane "
            "(bagaimana), dok (tidak; also 'sedang'), nok (nak), buwak/wak (buat), kekgi "
            "(nanti), royak (beritahu), kelih (lihat), pahang (faham), pulok (pula), sokmo "
            "(selalu), pitih (duit); final -an often becomes -ang (makan→makang) and final "
            "-a often -e (apa→ape).",
        ),
        Style(
            "kedah",
            "Kedah / northern Malay (loghat Utara)",
            "Kedah, Perlis, Penang",
            "cek/aku (saya), hang (kamu), depa (mereka), pa (apa), awat/pasai pa (kenapa), "
            "lagu mana (bagaimana), dok (sedang; also 'tinggal'), habaq (beritahu), satgi "
            "(sekejap lagi), toksah (jangan, tak payah), sat (sekejap), cheq (saya, polite), "
            "lagu tu (macam itu), sangat→sungguh; final -r often becomes -q (pasar→pasaq, "
            "air→ayaq) and -s often becomes -ih (habis→habih).",
        ),
        Style(
            "perak",
            "Perak Malay",
            "Perak",
            "teman (saya), mike/miker (kamu), kome (kamu semua), deme (mereka), ate (jadi?, "
            "so?), peghok (kolot), gomen (kerajaan), ghodi (baiki), sio (hendak); the r is "
            "said as gh (orang→oghang, pergi→pegi), final -a often becomes -e (apa→ape).",
        ),
        Style(
            "pahang",
            "Pahang Malay",
            "Pahang",
            "kome (kamu), teman/aku (saya), deme (mereka), ape (apa), ngape (kenapa), "
            "lagu mane (bagaimana), dok (tidak/sedang), nok (nak); final -a often becomes "
            "-e and final -an often -ang, close to Terengganu and Perak speech.",
        ),
        Style(
            "negeri_sembilan",
            "Negeri Sembilan Malay (loghat Nogori)",
            "Negeri Sembilan",
            "den/ese (saya), ekau/kau (kamu), eden (saya, polite), apo (apa), baa (bagaimana), "
            "tak do (tiada), mangkali (mungkin), dogheh (cepat), monung (termenung); final -a "
            "often becomes -o (apa→apo, kita→kito) and r is said as gh (orang→oghang).",
        ),
        Style(
            "melaka",
            "Melaka Malay",
            "Melaka",
            "aku/saya, kau/engkau (kamu), dorang (mereka), apa, camne (bagaimana), tak, dah, "
            "nak; close to standard Malay with some Negeri Sembilan endings (apo, kito) and "
            "the particle 'la' at the end.",
        ),
        Style(
            "johor",
            "Johor Malay",
            "Johor",
            "aku/saya, kau (kamu), dorang (mereka), ape (apa), camne (bagaimana), tak, dah, "
            "nak, kat, je; final -a is said as a soft -e (apa→ape, saya→saye), close to the "
            "Malay of Kuala Lumpur.",
        ),
        Style(
            "sabah",
            "Sabah Malay",
            "Sabah",
            "sia/saya (saya), kau/ko (kamu), kamurang (kamu semua), durang (mereka), nda/inda "
            "(tidak), ndapapa (tak apa), bikin (buat), tingu (tengok), kasi (beri), pigi "
            "(pergi), bilang (cakap), kunuk (konon), ka/kah (question particle, e.g. 'betul "
            "ka?'), bah (agreement and emphasis: 'ok bah').",
        ),
        Style(
            "sarawak",
            "Sarawak Malay",
            "Sarawak",
            "kamek (saya), kitak (kamu), kita, sidak (mereka), nya (dia), sik (tidak), sik "
            "ada (tiada), aok (ya), polah (buat), nangga (tengok), kinek (sekarang), nar "
            "(sangat), juak (juga), kenak (kenapa), camne (bagaimana), sine (mana), dolok "
            "(dahulu), kelak (nanti).",
        ),
    )
}


def known(code: str | None) -> bool:
    return bool(code) and code in STYLES


@lru_cache(maxsize=16)
def pack(code: str) -> dict[str, Any]:
    path = DATA / f"{code}.json"
    if not path.exists():
        return {"lexicon": [], "examples": [], "pairs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _words(text: str) -> set[str]:
    return set(WORD.findall((text or "").lower()))


def _clear(e: dict[str, Any]) -> bool:
    """A lexicon entry short and clear enough to show the model."""
    s = e.get("s") or ""
    return 0 < len(s) <= 32 and len(s.split()) <= 4 and "?" not in s and "http" not in s


def _usable(e: dict[str, Any]) -> bool:
    """Clear, and fit for a workplace."""
    return _clear(e) and not _RUDE.search(e.get("s") or "")


def _lexicon_for(code: str, text: str) -> list[dict[str, Any]]:
    """The dialect words for what this conversation is about, then the most used ones."""
    words = _words(text)
    entries = [e for e in pack(code)["lexicon"] if _usable(e)]
    relevant = [e for e in entries if _words(e["s"]) & words]
    core = sorted(entries, key=lambda e: -int(e.get("n") or 0))
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for e in [*relevant[: MAX_LEXICON // 2], *core]:
        if e["d"] not in seen:
            seen.add(e["d"])
            out.append(e)
        if len(out) >= MAX_LEXICON:
            break
    return out


def _examples_for(code: str, text: str) -> list[dict[str, Any]]:
    words = _words(text)
    p = pack(code)
    pool = [
        x
        for x in [*p.get("examples", []), *p.get("pairs", [])]
        if len(x["d"]) <= MAX_EXAMPLE_CHARS and not _RUDE.search(x["s"])
    ]
    if not pool:
        return []
    ranked = sorted(pool, key=lambda x: -len(_words(x["s"]) & words))
    return ranked[:MAX_EXAMPLES]


def voice_note(code: str | None, text: str = "") -> str:
    """How to speak this turn: the guide, the words and examples that fit `text`."""
    if not known(code):
        return ""
    s = STYLES[code]  # type: ignore[index]
    where = f" from {s.region}" if s.region else ""
    lines = [
        f"(Speak {s.label}, the way a friendly colleague{where} would talk to this person. "
        f"{s.guide}",
    ]
    lex = _lexicon_for(s.code, text)
    if lex:
        lines.append(
            "Dialect words (dialect = standard Malay): "
            + "; ".join(f"{e['d']} = {e['s']}" for e in lex)
            + "."
        )
    ex = _examples_for(s.code, text)
    if ex:
        lines.append("How it sounds: " + " ".join(f"«{x['d']}» (= {x['s']})" for x in ex))
    lines.append(
        "Keep names, numbers, amounts, dates and technical terms exact. If the person writes "
        "in another language or style, follow theirs. Documents, letters, reports and "
        "anything sent outside the company stay in standard Malay.)"
    )
    return "\n".join(lines)


def gloss(code: str | None, text: str) -> str:
    """Dialect words in what the person wrote, with their standard Malay, for the model."""
    if not known(code) or code == "pasar":
        return ""
    words = _words(text)
    hits = [
        e
        for e in pack(code)["lexicon"]  # type: ignore[arg-type]
        if e.get("distinct")
        and _clear(e)
        and " " not in e["d"]
        and len(e["d"]) >= 3
        and e["d"] in words
    ]
    if not hits:
        return ""
    hits = sorted(hits, key=lambda e: -int(e.get("n") or 0))[:MAX_GLOSS]
    return (
        "(Dialect words the person used: " + "; ".join(f"{e['d']} = {e['s']}" for e in hits) + ".)"
    )


def options() -> list[dict[str, str]]:
    """For the settings page: code, English label, region."""
    return [{"code": s.code, "label": s.label, "region": s.region} for s in STYLES.values()]
