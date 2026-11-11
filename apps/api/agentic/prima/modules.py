"""P99: Prima's modules (its screens), for "which parts of Prima may this person open".

A member's Prima access is everything their Prima role allows (the default), or a chosen list of
Prima screens (Membership.prima_modules). The choice only narrows: Prima's own role checks still
decide everything inside. The office enforces it on every call it signs for the person
(client.call: their screens and their AI), and Prima's web hides the screens not chosen.

The catalog (modules.json next to this file) is built from Prima's web source, the way routes.json
is built from its API: the menu (App.tsx NAV, nav-catalog.ts sections and groups, i18n.ts for
Malay) and, for each screen, every API call its code makes (api/http.ts paths, followed through the
screen's own imports). tests/test_p66_prima.py fails when the two drift apart.

    python -m agentic.prima.modules ../prima/apps/web/src > agentic/prima/modules.json

A call is allowed for a person with chosen screens when it is one Prima's frame makes on every
screen (`common`), or one of the calls of a chosen screen (or of the screens everyone keeps,
ALWAYS). A call no screen makes (the AI's own, a new route) is judged by its first part: allowed
when a chosen screen calls something else under it, else refused.
"""

import json
import re
import sys
from collections import defaultdict
from functools import cache
from pathlib import Path

# Everyone keeps the home screen and their own things: their details, clock, work, meetings
# and memos (a person must clock in and read notices whatever else they are given).
ALWAYS = ("home", "mine", "clock", "work", "meetings", "memos")
# Prima's frame (menu, alerts, Arisha, the drafts tray, the guide): on every screen.
_SHELL_FILES = (
    "AlertBell.tsx",
    "Arisha.tsx",
    "ArishaReviewQueue.tsx",
    "Confidential.tsx",
    "DraftHelp.tsx",
    "Launcher.tsx",
    "NavMenu.tsx",
    "Spaces.tsx",
)
# Labels the menu changes for office staff (App.tsx maps "Duty" to "My details").
_LABELS = {"mine": "My details"}
# Never followed into: the app itself and the API client (every screen imports them).
_NOT_FOLLOWED = {"App.tsx", "i18n.ts", "http.ts", "demo.ts", "index.ts", "types.ts"}
# Parts of Prima's API no office screen calls by that name (Prima's own Microsoft 365 page,
# the firearms desk and the offline queue), placed with the screen they belong to, so the AI of
# someone given that screen may use them. Anything else no screen calls (the guard's own phone
# app, which has its own sign-in) is refused to anyone with chosen screens.
_FIRST_PARTS = {
    "connections": ["connections"],
    "firearms": ["arms"],
    "ammo": ["arms"],
    "vault-watches": ["arms"],
    "websites-powerbi": ["websites"],
    "offline": ["surveys"],
}

# ---------------------------------------------------------------- building (from Prima's source)


def _template(s: str, i: int) -> tuple[str, int]:
    """The string literal starting at s[i] (', " or `), with each ${...} as \0."""
    q, out, i = s[i], [], i + 1
    while i < len(s):
        c = s[i]
        if c == "\\":
            out.append(s[i : i + 2])
            i += 2
        elif c == q:
            return "".join(out), i + 1
        elif q == "`" and s.startswith("${", i):
            depth, j = 1, i + 2
            while j < len(s) and depth:
                if s[j] in "`'\"":
                    _, j = _template(s, j)
                    continue
                depth += {"{": 1, "}": -1}.get(s[j], 0)
                j += 1
            out.append("\0")
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out), i


def _pattern(literal: str) -> str | None:
    """'/items/${id}/issue?x=1' -> 'items/:/issue'; None when it is not a plain path."""
    path = literal.split("?", 1)[0]
    if not path.startswith("/"):
        return None
    segs = []
    for seg in path.strip("/").split("/"):
        if seg == "\0" or seg.startswith("\0"):
            segs.append(":")
        elif "\0" in seg:
            segs.append(seg.split("\0", 1)[0])  # a query glued on: `/org/inbox${...}`
        else:
            segs.append(seg)
    return "/".join(segs) if segs and segs[0] else None


_CALL = re.compile(r"this\.(call|officeStrict)\b")
_MEMBER = re.compile(r"^  (?:async |readonly |private |get )*(\w+)\s*(?:<[^>\n]*>)?\s*[(:=]", re.M)


def _client_calls(http: str) -> dict[str, set[str]]:
    """Each method of Prima's API client -> the calls it makes ('GET items/:/issue')."""
    marks = [(m.start(), m.group(1)) for m in _MEMBER.finditer(http)]
    out: dict[str, set[str]] = defaultdict(set)
    for m in _CALL.finditer(http):
        j = m.end()
        if http[j] == "<":  # this.call<Awaited<...>>(
            depth = 0
            while True:
                depth += {"<": 1, ">": -1}.get(http[j], 0)
                j += 1
                if depth == 0:
                    break
        if http[j] != "(":
            continue
        j += 1
        if m.group(1) == "officeStrict":  # (expectedUserId, 'GET', '/it', ...)
            j = http.index(",", j) + 1
        a = re.compile(r"\s*(?:'(GET|POST|PUT)'|(\w+))\s*,\s*").match(http, j)
        if not a or http[a.end()] not in "'`\"":
            continue
        pattern = _pattern(_template(http, a.end())[0])
        if pattern is None:
            continue
        owner = next((n for p, n in reversed(marks) if p < m.start()), "")
        for method in [a.group(1)] if a.group(1) else ["GET", "POST"]:
            out[owner].add(f"{method} {pattern}")
    return out


_IMPORT = re.compile(r"""from\s+['"](\.[^'"]+)['"]""")
_USE = re.compile(r"\bapi\.(\w+)")


def _closure(files: dict[Path, str], start: Path) -> set[Path]:
    seen, todo = set(), [start]
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        for m in _IMPORT.finditer(files[f]):
            base = (f.parent / m.group(1)).resolve()
            for c in (
                Path(f"{base}.tsx"),
                Path(f"{base}.ts"),
                base / "index.tsx",
                base / "index.ts",
            ):
                if c in files and c.name not in _NOT_FOLLOWED:
                    todo.append(c)
                    break
    return seen


def _malay(i18n: str) -> dict[str, str]:
    """English -> Bahasa Melayu, from Prima's translation rows ['English', 'BM', mix]."""
    out: dict[str, str] = {}
    row = re.compile(
        r"""^\s*\[\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")""",
        re.M,
    )  # noqa: E501
    for m in row.finditer(i18n):
        en, ms = m.group(1) or m.group(2) or "", m.group(3) or m.group(4) or ""
        out.setdefault(en.replace("\\'", "'"), ms.replace("\\'", "'"))
    return out


def build(src: Path) -> dict[str, object]:
    """The catalog from Prima's web source (apps/prima/apps/web/src)."""
    files = {p.resolve(): p.read_text(encoding="utf-8") for p in sorted(src.rglob("*.ts*"))}
    calls = _client_calls(files[(src / "api" / "http.ts").resolve()])
    app_path = (src / "App.tsx").resolve()
    app = files[app_path]

    def used(paths: set[Path]) -> set[str]:
        return {
            c for f in paths for m in _USE.finditer(files[f]) for c in calls.get(m.group(1), ())
        }

    component = {}
    for m in re.finditer(r"import \{([^}]+)\} from '\./(views/[^']+)'", app):
        for name in m.group(1).split(","):
            component[name.strip().split(" as ")[-1]] = m.group(2)
    switch = app[app.index("const view = (() => {") :]
    switch = switch[: switch.index("})();")]
    screens: dict[str, list[str]] = {}
    for case in re.split(r"\n\s*case ", switch)[1:]:
        view = re.match(r"'([\w-]+)'", case).group(1)  # type: ignore[union-attr]
        reached: set[Path] = set()
        for comp in re.findall(r"<(\w+)", case):
            if comp in component:
                start = (app_path.parent / f"{component[comp]}.tsx").resolve()
                if start in files:
                    reached |= _closure(files, start)
        screens[view] = sorted(used(reached))
    frame: set[Path] = set()
    for name in _SHELL_FILES:
        f = (src / name).resolve()
        if f in files:
            frame |= _closure(files, f)
    common = used(frame) | {c for m in _USE.finditer(app) for c in calls.get(m.group(1), ())}

    ms = _malay(files[(src / "i18n.ts").resolve()])
    labels = dict(re.findall(r"\{\s*view: '([\w-]+)',\s*label: '([^']+)'", app))
    labels.update(re.findall(r"\{\s*\n\s*view: '([\w-]+)',\s*\n\s*label: '([^']+)'", app))
    labels.update(_LABELS)
    cat = files[(src / "nav-catalog.ts").resolve()]
    blurbs = {
        k: v1 or v2
        for k, v1, v2 in re.findall(
            r"^  '?([\w-]+)'?: \{ blurb: (?:'((?:[^'\\]|\\.)*)'|\"([^\"]*)\")", cat, re.M
        )
    }

    def words(en: str) -> dict[str, str]:
        en = en.replace("\\'", "'")
        return {"en": en, "ms": ms.get(en, en)}

    sections = cat[cat.index("export const NAV_SECTIONS") : cat.index("const WHERE")]
    apps = []
    for block in re.split(r"\n  \{\n", sections)[1:]:
        sid = re.search(r"id: '(\w+)'", block).group(1)  # type: ignore[union-attr]
        title = re.search(r"title: '([^']+)'", block).group(1)  # type: ignore[union-attr]
        blurb = re.search(r"blurb: '([^']+)'", block).group(1)  # type: ignore[union-attr]
        groups = []
        for gt, views in re.findall(r"\{ title: '([^']+)', views: \[([^\]]*)\] \}", block):
            mods = [
                {
                    "id": v,
                    "title": words(labels.get(v, v)),
                    "blurb": words(blurbs.get(v, "")),
                }
                for v in re.findall(r"'([\w-]+)'", views)
                if v in screens
            ]
            groups.append({"title": words(gt), "modules": mods})
        apps.append({"id": sid, "title": words(title), "blurb": words(blurb), "groups": groups})
    return {
        "always": list(ALWAYS),
        "common": sorted(common),
        "first_parts": _FIRST_PARTS,
        "apps": apps,
        "calls": {v: [c for c in cs if c not in common] for v, cs in sorted(screens.items())},
    }


# ---------------------------------------------------------------- using it


@cache
def catalog() -> dict[str, object]:
    return json.loads(Path(__file__).with_name("modules.json").read_text(encoding="utf-8"))


@cache
def ids() -> tuple[str, ...]:
    """Every Prima screen that can be chosen, in the menu's order."""
    return tuple(
        m["id"]
        for a in catalog()["apps"]  # type: ignore[union-attr]
        for g in a["groups"]
        for m in g["modules"]
    )


@cache
def titles() -> dict[str, dict[str, str]]:
    return {
        m["id"]: m["title"]
        for a in catalog()["apps"]  # type: ignore[union-attr]
        for g in a["groups"]
        for m in g["modules"]
    }


def _split(call: str) -> tuple[str, tuple[str, ...]]:
    method, path = call.split(" ", 1)
    return method, tuple(path.split("/"))


@cache
def _index() -> tuple[
    dict[tuple[str, int], list[tuple[tuple[str, ...], frozenset[str]]]],
    set[str],
    dict[str, set[str]],
]:
    """(method, length) -> [(segments, screens)], the common calls, first part -> screens."""
    cat = catalog()
    by: dict[str, set[str]] = defaultdict(set)
    for view, calls in cat["calls"].items():  # type: ignore[union-attr]
        for c in calls:
            by[c].add(view)
    for c in cat["common"]:  # type: ignore[union-attr]
        by[c].add("*")
    index: dict[tuple[str, int], list[tuple[tuple[str, ...], frozenset[str]]]] = defaultdict(list)
    first: dict[str, set[str]] = defaultdict(set)
    for c, views in by.items():
        method, segs = _split(c)
        index[(method, len(segs))].append((segs, frozenset(views)))
        first[segs[0]] |= views
    for part, views in cat.get("first_parts", {}).items():  # type: ignore[union-attr]
        first[part] |= set(views)
    return index, set(cat["common"]), first  # type: ignore[arg-type]


def screens_for(method: str, path: str) -> frozenset[str]:
    """The screens that make this call ('*' = Prima's frame, every screen). `path` is Prima's
    own ('api/items/x/issue', no query). A call no screen makes: the screens that call
    something under its first part."""
    segs = tuple(s for s in path.split("?", 1)[0].strip("/").split("/") if s)
    if segs[:1] == ("api",):
        segs = segs[1:]
    if not segs:
        return frozenset()
    index, _, first = _index()
    found: set[str] = set()
    for pat, views in index.get((method.upper(), len(segs)), ()):
        if all(p == ":" or p == s for p, s in zip(pat, segs, strict=True)):
            found |= views
    return frozenset(found or first.get(segs[0], set()))


def allows(method: str, path: str, chosen: list[str] | tuple[str, ...] | None) -> bool:
    """Whether someone with these screens chosen (None: all their role allows) may make this
    call. Prima's own checks come after, either way."""
    if chosen is None:
        return True
    views = screens_for(method, path)
    return "*" in views or bool(views & (set(chosen) | set(ALWAYS)))


def clean(chosen: list[str] | None) -> list[str] | None:
    """A chosen list as saved: known screens only, in the menu's order, the ones everyone
    keeps left out (they always come). None stays None (all)."""
    if chosen is None:
        return None
    want = set(chosen)
    return [i for i in ids() if i in want and i not in ALWAYS]


if __name__ == "__main__":
    out = build(Path(sys.argv[1]))
    sys.stdout.buffer.write((json.dumps(out, indent=1, ensure_ascii=False) + "\n").encode("utf-8"))
