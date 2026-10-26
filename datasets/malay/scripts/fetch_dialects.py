"""Download Malaysian dialect data from Hugging Face into ../dialects/.

- mesolitica/Malay-Dialect-Dictionary: 10 states, dialect word -> standard meaning, example
  sentences with translations, a short conversation (parquet, ~10 MB in all).
- mesolitica/Malay-Dialect-Instructions: the same question in English, standard Malay and a
  dialect, for 10 states plus casual "local Malay" (bahasa pasar). Non-code files only,
  ~80 MB in all. Only the question fields are kept (the long English answers are dropped).

Both are synthetic (written with a large model from internet word lists), with no licence on
their cards: check before redistributing. The app ships only a derived, compact lexicon and
example set (scripts/build_dialect_packs.py).

    python scripts/fetch_dialects.py
"""

import json
import pathlib
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent.parent / "dialects"
BASE = "https://huggingface.co/datasets"
STATES = (
    "johor",
    "kedah",
    "kelantan",
    "melaka",
    "pahang",
    "perak",
    "sabah",
    "sarawak",
    "sembilan",
    "terengganu",
)
INSTRUCTIONS = (
    "johor",
    "kedah",
    "kelantan",
    "local-malay",
    "melaka",
    "negeri-sembilan",
    "pahang",
    "perak",
    "sabah",
    "sarawak",
    "terengganu",
)


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:  # noqa: S310 - fixed https URLs
        return r.read()


def main() -> None:
    (HERE / "dictionary").mkdir(parents=True, exist_ok=True)
    (HERE / "instructions").mkdir(parents=True, exist_ok=True)
    for s in STATES:
        out = HERE / "dictionary" / f"{s}.parquet"
        if not out.exists():
            repo = f"{BASE}/mesolitica/Malay-Dialect-Dictionary/resolve/main"
            out.write_bytes(get(f"{repo}/data/negeri_{s}_dictionary-00000-of-00001.parquet"))
        print("dictionary", s, out.stat().st_size)
    for s in INSTRUCTIONS:
        out = HERE / "instructions" / f"{s}.jsonl"
        if out.exists():
            print("instructions", s, "(have it)")
            continue
        raw = get(f"{BASE}/mesolitica/Malay-Dialect-Instructions/resolve/main/{s}-malaysia.jsonl")
        kept = 0
        with out.open("w", encoding="utf-8") as f:
            for line in raw.decode("utf-8", "replace").splitlines():
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                ms, dialect = d.get("instruction_ms"), d.get("instruction_dialect")
                if ms and dialect:
                    f.write(json.dumps({"ms": ms, "dialect": dialect}, ensure_ascii=False) + "\n")
                    kept += 1
        print("instructions", s, kept)


if __name__ == "__main__":
    main()
