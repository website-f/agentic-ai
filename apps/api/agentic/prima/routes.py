"""The catalog of what can be done in Prima (P66): every GET and POST its API serves to a
signed-in person, with the sentence its code documents it with, what it takes, and how the
AI may use it. Built from Prima's controllers (apps/prima/apps/api/src) and kept in
routes.json next to this file; tests/test_p66_prima.py fails when the two drift apart.

    python -m agentic.prima.routes ../prima/apps/api/src > agentic/prima/routes.json
"""

import json
import re
import sys
from functools import cache
from pathlib import Path

_CONTROLLER = re.compile(r"@Controller\('([^']*)'\)")
_ROUTE = re.compile(r"@(Get|Post)\(\s*(?:'([^']*)')?\s*\)")
_GUARD = re.compile(r"@UseGuards\((\w+)\)")
_DOC = re.compile(r"/\*\*(.*?)\*/\s*$", re.S)
_METHOD = re.compile(r"^\s*(?:async\s+)?(\w+)\s*\(", re.M)
# Only what a signed-in person can do: controllers behind Prima's AuthGuard. Signed system feeds and
# webhooks, the office's own staff list, public share links, health and sign-in are left out.
_PERSON_GUARD = "AuthGuard"
_SKIP_PATHS = ("api/auth/dev-login", "api/auth/users")


def _params(sig: str) -> dict[str, object]:
    out: dict[str, object] = {}
    q = re.findall(r"@Query\('([^']+)'\)", sig)
    if q:
        out["query"] = q
    p = re.findall(r"@Param\('([^']+)'\)", sig)
    if p:
        out["params"] = p
    b = re.search(r"@Body\(\)\s*\w+\??\s*:\s*(.+?)(?:,\s*@|\)\s*(?::\s*[^{]+)?\{\s*$)", sig, re.S)
    if b:
        out["body"] = re.sub(r"\s+", " ", b.group(1)).strip()[:300]
    elif "@Body()" in sig:
        out["body"] = "object"
    return out


def build(src: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for f in sorted(src.rglob("*.ts")):
        if f.name.endswith((".test.ts", ".d.ts")):
            continue
        text = f.read_text(encoding="utf-8")
        if "@Controller(" not in text:
            continue
        # Each controller's block runs to the next @Controller.
        starts = [m for m in _CONTROLLER.finditer(text)]
        for i, c in enumerate(starts):
            block = text[c.start() : starts[i + 1].start() if i + 1 < len(starts) else len(text)]
            head = block[: block.find("class ")]
            guard = _GUARD.search(head)
            if not guard or guard.group(1) != _PERSON_GUARD:
                continue
            for r in _ROUTE.finditer(block):
                path = "/".join(x for x in (c.group(1), r.group(2) or "") if x)
                if path.startswith(_SKIP_PATHS):
                    continue
                before = block[: r.start()]
                # The doc comment above this route's decorators (none if code comes between).
                doc = ""
                m = re.search(r"/\*\*((?:(?!\*/).)*)\*/((?:\s*@\w+\([^\n]*\))*)\s*$", before, re.S)
                if m:
                    doc = re.sub(r"\s*\n\s*\*\s?", " ", m.group(1)).strip(" *\n")
                    doc = re.sub(r"\s+", " ", doc)
                after = block[r.end() :]
                sig_end = after.find("{\n")
                sig = after[: sig_end + 1] if sig_end >= 0 else after[:600]
                name = _METHOD.search(sig)
                row: dict[str, object] = {
                    "method": r.group(1).upper(),
                    "path": path,
                    "name": name.group(1) if name else "",
                }
                if doc:
                    row["doc"] = doc[:400]
                row.update(_params(sig))
                rows.append(row)
    rows.sort(key=lambda x: (str(x["path"]), str(x["method"])))
    return rows


@cache
def catalog() -> tuple[dict[str, object], ...]:
    return tuple(json.loads((Path(__file__).with_name("routes.json")).read_text(encoding="utf-8")))


_WORD = re.compile(r"[a-z0-9]+")


def _words_of(row: dict[str, object], keys: tuple[str, ...]) -> set[str]:
    raw = " ".join(str(row.get(k, "")) for k in keys)
    return set(_WORD.findall(re.sub(r"([a-z])([A-Z])", r"\1 \2", raw).lower()))


def find(query: str, method: str = "", limit: int = 25) -> list[dict[str, object]]:
    """The catalog rows that best match the words in `query` (path, name and doc)."""
    words = [w for w in _WORD.findall(query.lower()) if len(w) > 1]
    scored = []
    for row in catalog():
        if method and row["method"] != method.upper():
            continue
        # What the action is (its path and name) counts most, its description less, a part-word
        # least. staffPay reads as "staff pay".
        head = _words_of(row, ("path", "name"))
        doc = _words_of(row, ("doc",))
        score = sum(
            4 if w in head else 1.5 if w in doc else 0.5 if any(w in h for h in head) else 0
            for w in words
        )
        if score or not words:
            scored.append((score, row))
    # Equal scores: the most direct action (the shortest path) first.
    scored.sort(key=lambda x: (-x[0], len(str(x[1]["path"])), str(x[1]["path"])))
    return [r for _, r in scored[:limit]]


if __name__ == "__main__":
    out = build(Path(sys.argv[1]))
    # Bytes, so the file is UTF-8 whatever the console's code page (Windows).
    sys.stdout.buffer.write((json.dumps(out, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
