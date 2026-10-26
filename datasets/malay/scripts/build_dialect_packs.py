"""Build the app's compact dialect packs from ../dialects/ (fetch_dialects.py) into
apps/api/agentic/i18n/dialects/data/<code>.json.

Each pack: a lexicon (dialect word -> standard Malay meaning), short example sentences with
their standard Malay, and standard <-> dialect question pairs. A lexicon entry is marked
`distinct` when the dialect form is rare in formal Malay (corpus_formal.txt), so the app only
glosses words a standard reader would not know.

    python -m uv run --no-project --with pyarrow python scripts/build_dialect_packs.py
"""

import ast
import collections
import json
import pathlib
import re

import pyarrow.parquet as pq

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIALECTS = ROOT / "dialects"
OUT = ROOT.parent.parent / "apps" / "api" / "agentic" / "i18n" / "dialects" / "data"

# pack code -> (dictionary file, instructions file)
PACKS = {
    "pasar": (None, "local-malay"),
    "kelantan": ("kelantan", "kelantan"),
    "terengganu": ("terengganu", "terengganu"),
    "kedah": ("kedah", "kedah"),
    "perak": ("perak", "perak"),
    "pahang": ("pahang", "pahang"),
    "negeri_sembilan": ("sembilan", "negeri-sembilan"),
    "melaka": ("melaka", "melaka"),
    "johor": ("johor", "johor"),
    "sabah": ("sabah", "sabah"),
    "sarawak": ("sarawak", "sarawak"),
}
MAX_LEXICON = 900
MAX_EXAMPLES = 400
MAX_PAIRS = 250
WORD = re.compile(r"[a-zA-Z']+")


def formal_counts() -> collections.Counter:
    c: collections.Counter = collections.Counter()
    with (ROOT / "corpus_formal.txt").open(encoding="utf-8", errors="replace") as f:
        for line in f:
            c.update(w.lower() for w in WORD.findall(line))
    return c


def clean_meaning(raw: str) -> str:
    s = str(raw or "").replace("\r", "")
    m = re.search(r"Bahasa Malaysia:\s*([^\n]+)", s)
    if m:
        s = m.group(1)
    s = s.split("\n")[0]
    s = re.split(r"\b(?:cth|contoh|e\.g|eg|example)\b[:.]?", s, flags=re.I)[0]
    s = re.sub(r"^\s*(?:ie|i\.e)\.?\s*", "", s, flags=re.I)
    s = s.split("(")[0].replace(";", ", ")
    s = " ".join(s.split()).strip(" .,:-")
    return s.lower()[:60]


CLEAN = re.compile(r"^[a-z0-9' -]+$")


def clean_word(raw: str) -> str:
    s = " ".join(str(raw or "").split()).strip(" .,:-\"'").lower()
    return s if CLEAN.match(s) and len(s) <= 40 else ""


def examples_of(raw: str) -> list[tuple[str, str]]:
    try:
        d = ast.literal_eval(raw) if isinstance(raw, str) else raw
    except (ValueError, SyntaxError):
        return []
    text = str((d or {}).get("contoh_ayat") or "")
    out = []
    for dial, std in re.findall(r'"([^"\n]{8,200})"\s*\n?\s*\(([^)\n]{8,220})\)', text):
        if "�" not in dial:
            out.append((dial.strip(), std.strip()))
    return out


def build(code: str, dict_file: str | None, instr_file: str, formal: collections.Counter) -> dict:
    lexicon: dict[str, dict] = {}
    examples: list[tuple[str, str]] = []
    if dict_file:
        for row in pq.read_table(DIALECTS / "dictionary" / f"{dict_file}.parquet").to_pylist():
            word, meaning = clean_word(row.get("left")), clean_meaning(row.get("right"))
            if not word or not meaning or word == meaning or word in lexicon:
                continue
            first = word.split()[0]
            lexicon[word] = {
                "d": word,
                "s": meaning,
                "distinct": " " in word or formal[first] < 20,
            }
            examples += examples_of(row.get("dictionary"))
    pairs, pairs_all = [], []
    used: collections.Counter = collections.Counter()
    path = DIALECTS / "instructions" / f"{instr_file}.jsonl"
    with path.open(encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            ms, dial = d["ms"].strip(), d["dialect"].strip()
            for w in WORD.findall(dial.lower()):
                used[w] += 1
            pairs_all.append({"d": dial, "s": ms})
            if 30 <= len(dial) <= 700 and len(ms) <= 700 and "�" not in dial:
                pairs.append({"d": dial, "s": ms})
    seen, ex = set(), []
    for dial, std in examples:
        if dial.lower() not in seen and CLEAN.match(re.sub(r"[^a-z0-9' -]", "", dial.lower()) or "x"):
            seen.add(dial.lower())
            ex.append({"d": dial, "s": std})
    # Core vocabulary first: the words most used in real text written in the dialect.
    text = " ".join(p["d"].lower() for p in pairs_all)
    for e in lexicon.values():
        if " " in e["d"]:
            e["n"] = len(re.findall(r"" + re.escape(e["d"]) + r"", text))
        else:
            e["n"] = used[e["d"]]
    lex = sorted(lexicon.values(), key=lambda e: (-e["n"], not e["distinct"], len(e["d"])))
    return {
        "code": code,
        "lexicon": lex[:MAX_LEXICON],
        "examples": ex[:MAX_EXAMPLES],
        "pairs": sorted(pairs, key=lambda p: len(p["d"]))[:MAX_PAIRS],
        "source": "mesolitica/Malay-Dialect-Dictionary, mesolitica/Malay-Dialect-Instructions",
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    formal = formal_counts()
    for code, (dict_file, instr_file) in PACKS.items():
        pack = build(code, dict_file, instr_file, formal)
        (OUT / f"{code}.json").write_text(
            json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        distinct = sum(1 for e in pack["lexicon"] if e["distinct"])
        print(
            f"{code}: {len(pack['lexicon'])} words ({distinct} distinct), "
            f"{len(pack['examples'])} examples, {len(pack['pairs'])} pairs"
        )


if __name__ == "__main__":
    main()
