"""Accessibility-style page snapshots with stable element references (pure, no browser).

The page side (SNAPSHOT_JS) walks the DOM, open shadow roots and same-origin iframes one level
deep and returns flat nodes: role, accessible name, state, and the index of the nearest
emitted ancestor. Every node carries a ref (e17, or f1e3 inside the first iframe) kept in a
per-page WeakMap<Element, ref>, so an element that survives a re-render keeps its ref and a
number the model picked can never silently point at a different element: either it is the
same element, or it is gone and the action says so.

This module turns those nodes into the compact indented tree the model reads (capped by an
estimate of tokens, not a fixed element count), and computes what changed since a snapshot
the model already saw (only added / removed / changed lines, or the full tree when much
changed or the page navigated). Everything here is plain Python so it is unit-tested.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

# Roles a person can act on: they always appear in the default (interactive) snapshot.
INTERACTIVE = frozenset(
    {
        "link",
        "button",
        "checkbox",
        "radio",
        "textbox",
        "searchbox",
        "combobox",
        "listbox",
        "option",
        "slider",
        "spinbutton",
        "switch",
        "tab",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "treeitem",
        "clickable",
    }
)
# Containers that get their ref shown (so they can be a snapshot scope).
SCOPES = frozenset(
    {
        "form",
        "dialog",
        "alertdialog",
        "table",
        "list",
        "navigation",
        "main",
        "region",
        "search",
        "iframe",
        "menu",
        "tablist",
        "group",
        "complementary",
        "banner",
        "contentinfo",
    }
)
# Landmarks every page has: shown only when they are named (they add a line, not meaning).
QUIET = frozenset({"main", "banner", "contentinfo", "complementary"})
CONTENT = frozenset(
    {"heading", "text", "paragraph", "img", "cell", "columnheader", "alert", "row", "listitem"}
)

DEFAULT_TOKENS = 1500
FULL_TOKENS = 3500
FULL_CHANGE = 0.4  # more than this share of lines changed: send the whole snapshot again
HISTORY = 12  # snapshots kept per session for deltas
REF_RE = re.compile(r"^(?:(f\d+))?e(\d+)$")
FRAME_RE = re.compile(r"^f\d+$")


def tokens(text: str) -> int:
    """A cheap, stable token estimate (about 4 characters per token for page labels)."""
    return len(text) // 4 + 1


def parse_ref(value: Any) -> str | None:
    """'e17', 'f1e3', 17 or '17' (old numbered views) -> a ref; None when it is not one."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return f"e{value}" if value > 0 else None
    s = str(value).strip().lower().strip("[]")
    if s.startswith("ref="):
        s = s[4:]
    if s.isdigit():
        return f"e{int(s)}" if int(s) > 0 else None
    if REF_RE.match(s) or FRAME_RE.match(s):
        return s
    return None


def frame_of(ref: str) -> str | None:
    """The iframe ref a ref lives in ('f1' for 'f1e3'), None for the top page."""
    m = REF_RE.match(ref)
    return m.group(1) if m else None


def host_matches(url: str, hosts: list[str]) -> bool:
    h = (urlparse(url).hostname or "").lower()
    return bool(h) and any(h == x.lower() or h.endswith("." + x.lower()) for x in hosts if x)


# ---------------------------------------------------------------- lines


def _q(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def node_line(n: dict[str, Any]) -> str:
    """One node as the model reads it (no indentation)."""
    role = str(n.get("role") or "generic")
    name = str(n.get("name") or "")
    st: dict[str, Any] = n.get("st") or {}
    bits = [f"- {role}"]
    if name:
        bits.append(_q(name))
    if n.get("ref") and (role in INTERACTIVE or role in SCOPES):
        bits.append(f"[{n['ref']}]")
    if role == "heading" and st.get("level"):
        bits.append(f"level={st['level']}")
    if st.get("type"):
        bits.append(f"type={st['type']}")
    if st.get("password"):
        bits.append("password")
    if "value" in st and st["value"] not in (None, ""):
        bits.append(f"value={_q(str(st['value']))}")
    for flag in ("checked", "selected", "pressed"):
        if flag in st:
            v = st[flag]
            bits.append(flag if v is True else f"{flag}={v}" if v not in (False, None) else f"not {flag}")
    if "expanded" in st:
        bits.append("expanded" if st["expanded"] else "collapsed")
    for flag in ("disabled", "required", "readonly", "bold"):
        if st.get(flag):
            bits.append(flag)
    if st.get("options"):
        bits.append("options: " + " | ".join(str(o) for o in st["options"]))
    if st.get("href") and not name:
        bits.append(f"url={st['href']}")
    if st.get("cross_origin"):
        bits.append("(another site: not readable)")
    if n.get("submit"):
        bits.append("(sends the form: browser_submit)")
    return " ".join(bits)


@dataclass
class Rendered:
    lines: list[tuple[str, str]]  # (key, indented line) in page order
    omitted: int = 0
    total: int = 0

    def text(self) -> str:
        return "\n".join(line for _, line in self.lines)


def _children(nodes: list[dict[str, Any]]) -> dict[int, list[int]]:
    kids: dict[int, list[int]] = {}
    for i, n in enumerate(nodes):
        kids.setdefault(int(n.get("p", -1)), []).append(i)
    return kids


def render(
    nodes: list[dict[str, Any]],
    *,
    full: bool = False,
    budget: int | None = None,
) -> Rendered:
    """The indented tree, interactive-only unless `full`, capped at about `budget` tokens.

    Containers without anything to show are dropped. When the page is bigger than the budget,
    what is on screen goes first, then the rest in page order; ancestors of every kept node
    are kept so the tree still reads right, and the footer says how much was left out.
    """
    budget = budget or (FULL_TOKENS if full else DEFAULT_TOKENS)
    kids = _children(nodes)
    parent = [int(n.get("p", -1)) for n in nodes]

    def leafish(n: dict[str, Any]) -> bool:
        role = n.get("role")
        if role in INTERACTIVE or role == "heading" or role == "iframe":
            return True
        return full and (role in CONTENT or n.get("kind") == "t")

    # A container is shown when something under it is shown.
    shown_under: set[int] = set()
    for i in range(len(nodes) - 1, -1, -1):
        if leafish(nodes[i]) or i in shown_under:
            j = parent[i]
            while j >= 0 and j not in shown_under:
                shown_under.add(j)
                j = parent[j]
    candidates = [i for i, n in enumerate(nodes) if leafish(n)]
    keep: set[int] = set()
    spent = 0
    order = [i for i in candidates if nodes[i].get("inview")] + [
        i for i in candidates if not nodes[i].get("inview")
    ]
    omitted = 0
    for i in order:
        chain = [i]
        j = parent[i]
        while j >= 0 and j not in keep:
            chain.append(j)
            j = parent[j]
        cost = sum(tokens(node_line(nodes[k])) + 1 for k in chain if k not in keep)
        if spent + cost > budget and keep:
            omitted += 1
            continue
        keep.update(chain)
        spent += cost

    lines: list[tuple[str, str]] = []

    def walk(i: int, depth: int) -> None:
        n = nodes[i]
        show = i in keep and (leafish(n) or i in shown_under)
        # Unnamed generic containers add nothing: their children take their place.
        role = n.get("role")
        if show and not leafish(n) and not n.get("name") and (role not in SCOPES or role in QUIET):
            show = False
        if show:
            key = str(n.get("ref") or f"#{i}")
            lines.append((key, "  " * depth + node_line(n)))
        for k in kids.get(i, []):
            if k in keep:
                walk(k, depth + 1 if show else depth)

    for root in kids.get(-1, []):
        if root in keep:
            walk(root, 0)
    return Rendered(lines, omitted, len(candidates))


def footer(r: Rendered) -> str:
    if not r.omitted:
        return ""
    return (
        f"({r.omitted} more elements not shown to save tokens: use browser_find with a role, "
        "label or text, or browser_snapshot with scope set to a container's ref)"
    )


# ---------------------------------------------------------------- deltas


@dataclass
class Snap:
    rev: int
    doc: str
    url: str
    lines: list[tuple[str, str]]
    text: str = ""


@dataclass
class History:
    """The default-mode snapshots a session produced, so a later observation can say only
    what changed since the one the model last saw."""

    rev: int = 0
    snaps: list[Snap] = field(default_factory=list)

    def get(self, rev: int | None) -> Snap | None:
        if rev is None:
            return self.snaps[-1] if self.snaps else None
        return next((s for s in self.snaps if s.rev == rev), None)

    def add(self, doc: str, url: str, lines: list[tuple[str, str]], text: str) -> Snap:
        last = self.snaps[-1] if self.snaps else None
        if last and last.doc == doc and last.url == url and last.lines == lines and last.text == text:
            return last
        self.rev += 1
        snap = Snap(self.rev, doc, url, lines, text[:20_000])
        self.snaps = [*self.snaps[-(HISTORY - 1) :], snap]
        return snap


@dataclass
class Delta:
    mode: str  # full | delta | same
    added: list[str]
    removed: list[str]
    changed: list[str]
    ratio: float

    def text(self) -> str:
        out = [f"+ {x.strip()}" for x in self.added]
        out += [f"- {x.strip()}" for x in self.removed]
        out += [f"~ {x.strip()}" for x in self.changed]
        return "\n".join(out)


def diff(old: Snap | None, new: Snap, *, nav_full: bool = True) -> Delta:
    """Added / removed / changed lines between two snapshots, keyed by ref.

    Full when there is nothing to compare with, the document changed (a navigation), or more
    than FULL_CHANGE of the lines differ.
    """
    if old is None or (nav_full and (old.doc != new.doc or _base(old.url) != _base(new.url))):
        return Delta("full", [], [], [], 1.0)
    before = dict(old.lines)
    after = dict(new.lines)
    added = [line for k, line in new.lines if k not in before]
    removed = [line for k, line in old.lines if k not in after]
    changed = [line for k, line in new.lines if k in before and before[k].strip() != line.strip()]
    n = len(added) + len(removed) + len(changed)
    ratio = n / max(len(old.lines), len(new.lines), 1)
    if n == 0:
        return Delta("same", [], [], [], 0.0)
    if ratio > FULL_CHANGE:
        return Delta("full", added, removed, changed, ratio)
    return Delta("delta", added, removed, changed, ratio)


def _base(url: str) -> str:
    return url.split("#", 1)[0]


def text_delta(old: str, new: str, limit: int = 600) -> str:
    """Lines of page text that appeared since the old snapshot (status messages, results)."""
    if old == new:
        return ""
    a = [x.strip() for x in old.splitlines() if x.strip()]
    b = [x.strip() for x in new.splitlines() if x.strip()]
    seen = set(a)
    out: list[str] = []
    for op in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op[0] in ("insert", "replace"):
            out.extend(x for x in b[op[3] : op[4]] if x not in seen)
    text = "\n".join(dict.fromkeys(out))
    return text[:limit] + (" …" if len(text) > limit else "")


def _norm(s: str) -> str:
    return " ".join(s.split()).lower()


def uncovered_text(text: str, shown: list[str], limit: int = 1500) -> str:
    """The page text the tree does not already say (status lines, counts, message bodies),
    so a full view does not repeat every row and label as plain text too."""
    blob = " ".join(_norm(x) for x in shown)
    out: list[str] = []
    size = 0
    for line in text.splitlines():
        cells = [_norm(c) for c in re.split(r"\t| \| ", line) if c.strip()]
        if not cells or all(c in blob for c in cells):
            continue
        piece = " ".join(line.split())
        out.append(piece)
        size += len(piece) + 1
        if size > limit:
            break
    return "\n".join(dict.fromkeys(out))[:limit]


def find(nodes: list[dict[str, Any]], role: str = "", label: str = "", text: str = "") -> list[dict]:
    """Nodes matching a role and/or words in their name (label/text), best matches first."""
    role, label, text = role.strip().lower(), label.strip().lower(), text.strip().lower()
    out: list[tuple[int, int, dict]] = []
    for i, n in enumerate(nodes):
        r = str(n.get("role") or "").lower()
        name = str(n.get("name") or "").lower()
        if role and r != role and not (role == "textbox" and r == "searchbox"):
            continue
        want = label or text
        if want and want not in name:
            continue
        if not (role or want):
            continue
        exact = 0 if want and name == want else 1
        act = 0 if r in INTERACTIVE else 1
        out.append((exact + act, i, n))
    out.sort(key=lambda x: (x[0], x[1]))
    return [n for _, _, n in out]


def form_elements(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fields and send buttons in the shape the worker uses for approval previews."""
    out: list[dict[str, Any]] = []
    for n in nodes:
        tag = n.get("tag")
        if tag not in ("input", "textarea", "select", "button") and not n.get("submit"):
            continue
        st = n.get("st") or {}
        item: dict[str, Any] = {
            "ref": n.get("ref"),
            "tag": tag,
            "type": st.get("type") or n.get("type") or "",
            "label": n.get("name") or "",
            "submit": bool(n.get("submit")),
        }
        if "value" in st:
            item["value"] = st["value"]
        if "checked" in st:
            item["checked"] = st["checked"] is True
        if st.get("options"):
            item["options"] = st["options"]
        out.append(item)
        if len(out) >= 200:
            break
    return out


# ---------------------------------------------------------------- the page side

SNAPSHOT_JS = r"""(opts) => {
  opts = opts || {};
  const MAXN = opts.maxNodes || (opts.full ? 40000 : 12000);
  const W = window;
  const R = W.__agenticRefs || (W.__agenticRefs = {map: new WeakMap(), byRef: new Map(), made: Date.now()});
  const claimed = new Map();
  const live = (ref) => { const w = R.byRef.get(ref); const el = w && w.deref(); return el && el.isConnected ? el : null; };
  const top = document;
  if (!top.documentElement.getAttribute('data-agentic-doc'))
    top.documentElement.setAttribute('data-agentic-doc', Math.random().toString(36).slice(2, 10));
  function nextRef(doc, kind, prefix) {
    const de = doc.documentElement; const k = 'data-agentic-next-' + kind;
    let n = parseInt(de.getAttribute(k) || '0', 10) || 0;
    let r;
    do { n++; r = prefix + n; } while (claimed.has(r) || live(r));
    de.setAttribute(k, String(n));
    return r;
  }
  function refFor(el, prefix, kind, pattern) {
    let r = R.map.get(el);
    if (r && claimed.get(r) === el) return r;
    if (!r || claimed.has(r)) {
      const attr = el.getAttribute('data-agentic-ref');
      // After the registry was lost (a fresh script world), adopt the ref still on the
      // element unless another live element owns it (a cloned node carries a copy).
      if (!r && attr && pattern.test(attr) && !claimed.has(attr) && !live(attr)) r = attr;
      else r = nextRef(el.ownerDocument, kind, prefix);
      R.map.set(el, r);
    }
    claimed.set(r, el);
    R.byRef.set(r, new WeakRef(el));
    if (el.getAttribute('data-agentic-ref') !== r) el.setAttribute('data-agentic-ref', r);
    return r;
  }
  const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  const INTER = new Set(['link','button','checkbox','radio','textbox','searchbox','combobox','listbox',
    'option','slider','spinbutton','switch','tab','menuitem','menuitemcheckbox','menuitemradio','treeitem','clickable']);
  const LEAF = new Set(['link','button','combobox','listbox','textbox','searchbox','slider','spinbutton','option','checkbox','radio','switch']);
  const CONTAINER = new Set(['main','form','table','list','navigation','banner','contentinfo','complementary',
    'region','search','group','dialog','alertdialog','menu','menubar','tablist','tree','grid','toolbar','radiogroup','tabpanel']);
  const TEXTBLOCK = new Set(['P','LI','TD','TH','DT','DD','PRE','BLOCKQUOTE','LABEL','FIGCAPTION','CAPTION','LEGEND','H1','H2','H3','H4','H5','H6']);
  function roleOf(el) {
    const ex = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    if (ex && ex !== 'presentation' && ex !== 'none' && ex !== 'generic') return ex;
    const t = el.tagName.toLowerCase();
    switch (t) {
      case 'a': return el.hasAttribute('href') ? 'link' : '';
      case 'button': case 'summary': return 'button';
      case 'select': return (el.multiple || el.size > 1) ? 'listbox' : 'combobox';
      case 'textarea': return 'textbox';
      case 'input': {
        const ty = (el.getAttribute('type') || 'text').toLowerCase();
        const m = {button:'button', submit:'button', reset:'button', image:'button', checkbox:'checkbox',
          radio:'radio', range:'slider', number:'spinbutton', search:'searchbox', file:'button', hidden:''};
        return ty in m ? m[ty] : (el.hasAttribute('list') ? 'combobox' : 'textbox');
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'aside': return 'complementary';
      case 'header': return el.closest('article,aside,main,nav,section') ? '' : 'banner';
      case 'footer': return el.closest('article,aside,main,nav,section') ? '' : 'contentinfo';
      case 'form': return 'form';
      case 'dialog': return 'dialog';
      case 'table': return 'table';
      case 'tr': return 'row';
      case 'th': return 'columnheader';
      case 'td': return 'cell';
      case 'ul': case 'ol': return 'list';
      case 'li': return 'listitem';
      case 'img': return el.getAttribute('alt') === '' ? '' : 'img';
      case 'iframe': case 'frame': return 'iframe';
      case 'p': return 'paragraph';
      case 'option': return 'option';
      case 'fieldset': case 'details': return 'group';
      case 'section': return (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) ? 'region' : '';
    }
    if (el.isContentEditable && el.hasAttribute('contenteditable')) return 'textbox';
    return '';
  }
  function interactiveInside(el) {
    return !!el.querySelector('a[href],button,input,select,textarea,[role=button],[role=link],[onclick]');
  }
  // Text of an element without the text of controls inside it (a label around a select
  // would otherwise carry every option).
  function ownText(el, max) {
    let out = '';
    const walk = (n) => {
      if (out.length > (max || 80) * 2) return;
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue + ' ';
        else if (c.nodeType === 1) {
          const t = c.tagName;
          if (t === 'SELECT' || t === 'TEXTAREA' || t === 'INPUT' || t === 'SCRIPT' || t === 'STYLE' || t === 'OPTION' || t === 'BUTTON') continue;
          if (c.getAttribute('role') === 'button' || (t === 'A' && c.hasAttribute('href'))) continue;
          walk(c);
        }
      }
    };
    walk(el);
    return clean(out, max);
  }
  function labelText(l) { return ownText(l, 80); }
  function nameOf(el, role) {
    const doc = el.ownerDocument;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const s = lb.split(/\s+/).map(id => { const n = doc.getElementById(id); return n ? clean(n.innerText || n.textContent) : ''; }).join(' ').trim();
      if (s) return clean(s);
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return clean(al);
    const t = el.tagName.toLowerCase();
    if (t === 'input' || t === 'textarea' || t === 'select') {
      const ty = (el.getAttribute('type') || '').toLowerCase();
      if (ty === 'button' || ty === 'submit' || ty === 'reset') return clean(el.value || (ty === 'submit' ? 'Submit' : ty === 'reset' ? 'Reset' : ''));
      if (ty === 'image') return clean(el.alt || el.value || 'Submit');
      if (el.labels && el.labels.length) {
        const s = Array.from(el.labels).map(labelText).join(' ').trim();
        if (s) return clean(s);
      }
      if (el.placeholder) return clean(el.placeholder);
      if (el.title) return clean(el.title);
      return clean(el.getAttribute('name') || '');
    }
    if (t === 'img') return clean(el.alt || el.title);
    if (t === 'iframe' || t === 'frame') return clean(el.title || el.name);
    if (CONTAINER.has(role)) {
      // A container is named by its label only: its text changes with its content.
      if (t === 'table' && el.caption) return clean(el.caption.innerText);
      if (t === 'fieldset') { const lg = el.querySelector('legend'); if (lg) return clean(lg.innerText); }
      return clean(el.title);
    }
    if (role === 'paragraph') return ownText(el, 160);
    if (role === 'row') {
      const cells = Array.from(el.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      return clean(cells.map(c => ownText(c, 60)).filter(Boolean).join(' | '), 120);
    }
    if (role === 'listitem') return ownText(el, 100);
    if (role === 'textbox' && el.isContentEditable) return clean(el.getAttribute('title') || el.getAttribute('placeholder') || '');
    let s = clean(el.innerText || el.textContent, role === 'paragraph' || role === 'heading' ? 160 : 80);
    if (!s && (role === 'link' || role === 'button' || role === 'clickable')) {
      const img = el.querySelector('img[alt]');
      s = clean((img && img.alt) || el.title || (el.querySelector('svg title') || {}).textContent || '');
    }
    return s || clean(el.title);
  }
  const SECRET_AC = /cc-number|cc-csc|one-time-code|current-password|new-password/;
  function stateOf(el, role) {
    const st = {};
    const t = el.tagName.toLowerCase();
    const ty = (el.getAttribute('type') || '').toLowerCase();
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') st.disabled = true;
    if (el.required || el.getAttribute('aria-required') === 'true') st.required = true;
    if (el.readOnly && (t === 'input' || t === 'textarea')) st.readonly = true;
    if (t === 'input' && (ty === 'checkbox' || ty === 'radio')) st.checked = !!el.checked;
    else if (el.hasAttribute('aria-checked')) { const v = el.getAttribute('aria-checked'); st.checked = v === 'true' ? true : v === 'mixed' ? 'mixed' : false; }
    if (el.hasAttribute('aria-expanded')) st.expanded = el.getAttribute('aria-expanded') === 'true';
    else if (t === 'summary' && el.parentElement) st.expanded = !!el.parentElement.open;
    if (el.hasAttribute('aria-pressed')) { const v = el.getAttribute('aria-pressed'); st.pressed = v === 'true' ? true : v === 'mixed' ? 'mixed' : false; }
    if (el.getAttribute('aria-selected') === 'true' || (t === 'option' && el.selected)) st.selected = true;
    if (role === 'row') {
      const c0 = el.querySelector('td');
      const w = c0 ? parseInt((el.ownerDocument.defaultView || W).getComputedStyle(c0).fontWeight, 10) : 400;
      if (w >= 600) st.bold = true;
    }
    if (role === 'heading') st.level = parseInt(el.getAttribute('aria-level') || t.slice(1), 10) || undefined;
    if (t === 'input' && ty && !['text','password','checkbox','radio','submit','button','reset','image','search','hidden'].includes(ty)) st.type = ty;
    if ((t === 'input' && !['checkbox','radio','submit','button','reset','image','file'].includes(ty)) || t === 'textarea') {
      const secret = ty === 'password' || el.hasAttribute('data-agentic-secret') || SECRET_AC.test(el.getAttribute('autocomplete') || '');
      if (ty === 'password') st.password = true;
      st.value = secret ? (el.value ? '(filled, hidden)' : '') : clean(el.value, 60);
    }
    if (t === 'select') {
      const o = el.options[el.selectedIndex];
      st.value = o && o.value !== '' ? clean(o.text, 60) : '';
      st.options = Array.from(el.options).slice(0, 15).map(x => clean(x.text, 40)).filter(Boolean);
    }
    if (role === 'textbox' && el.isContentEditable && t !== 'input' && t !== 'textarea') st.value = clean(el.innerText, 60);
    if (role === 'link' && t === 'a') {
      const h = el.getAttribute('href') || '';
      if (h && !h.startsWith('javascript:')) st.href = h.slice(0, 80);
    }
    return st;
  }
  function visible(el, win) {
    if (el.checkVisibility) {
      if (el.checkVisibility({checkVisibilityCSS: true, visibilityProperty: true})) return true;
      const cs = win.getComputedStyle(el);
      return cs.display === 'contents';
    }
    const cs = win.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  const out = [];
  let visited = 0, truncated = false, authForm = null;
  const vw = W.innerWidth, vh = W.innerHeight;
  const OTP = /otp|one[- ]?time|verification code|2fa|two[- ]factor|passcode|security code|\btac\b/i;
  function emit(el, role, name, parent, prefix, kind, pattern, extra) {
    const r = el.getBoundingClientRect();
    const node = {ref: refFor(el, prefix, kind, pattern), role, name, p: parent,
      tag: el.tagName.toLowerCase(), inview: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw};
    Object.assign(node, extra || {});
    out.push(node);
    return out.length - 1;
  }
  function walk(el, parent, prefix, pattern, frameDepth, textDone, win, frameView) {
    if (truncated) return;
    if (++visited > MAXN) { truncated = true; return; }
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'HEAD') return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-agentic-overlay')) return;
    if (!visible(el, win)) return;
    let role = roleOf(el);
    const rect = el.getBoundingClientRect();
    const sized = rect.width >= 1 && rect.height >= 1;
    if (!role && !textDone && tag !== 'LABEL' && (el.hasAttribute('onclick') || (el.getAttribute('tabindex') !== null && el.tabIndex >= 0))) {
      if (!interactiveInside(el)) role = 'clickable';
    }
    if (!role && !textDone && sized && tag !== 'LABEL' && tag !== 'BODY' && tag !== 'HTML') {
      const cs = win.getComputedStyle(el);
      if (cs.cursor === 'pointer' && el.parentElement && win.getComputedStyle(el.parentElement).cursor !== 'pointer'
          && !interactiveInside(el) && clean(el.innerText, 5)) role = 'clickable';
    }
    let me = parent, nextTextDone = textDone;
    if (role === 'iframe') {
      me = emit(el, 'iframe', nameOf(el, role), parent, 'f', 'f', /^f\d+$/, {});
      const fref = out[me].ref;
      let doc = null;
      try { doc = el.contentDocument; } catch (e) { doc = null; }
      if (frameDepth === 0 && doc && doc.body) {
        const fw = doc.defaultView || win;
        walk(doc.body, me, fref + 'e', new RegExp('^' + fref + 'e\\d+$'), 1, false, fw, true);
      } else {
        out[me].st = {cross_origin: !doc};
      }
      return;
    }
    const interactive = INTER.has(role);
    if (role && (interactive || (sized && !textDone))) {
      const name = nameOf(el, role);
      const st = stateOf(el, role);
      const ty = (el.getAttribute('type') || '').toLowerCase();
      const submit = (tag === 'BUTTON' && (ty === '' || ty === 'submit') && !!el.form)
        || (tag === 'INPUT' && (ty === 'submit' || ty === 'image'));
      if (interactive && !sized && !(tag === 'INPUT' && (ty === 'checkbox' || ty === 'radio'))) {
        // zero-size control: not something a person can use
      } else {
        const extra = {st, kind: interactive ? 'i' : (role === 'heading' || role === 'paragraph' || role === 'cell' || role === 'columnheader') ? 't' : 's'};
        if (submit) extra.submit = true;
        if (tag === 'INPUT') extra.type = ty;
        me = emit(el, role, name, parent, prefix, 'e', pattern, extra);
        if (!authForm && tag === 'INPUT' && ty === 'password') authForm = 'password';
        if (!authForm && (tag === 'INPUT') && ((el.getAttribute('autocomplete') || '') === 'one-time-code' || OTP.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + name))) authForm = 'otp';
        if (TEXTBLOCK.has(tag) || role === 'heading' || role === 'row' || role === 'listitem') nextTextDone = true;
        if (LEAF.has(role)) return;
      }
    }
    if (opts.full && !nextTextDone && !textDone && me === parent) {
      if (TEXTBLOCK.has(tag)) {
        const s = ownText(el, 200);
        if (s && /[\p{L}\p{N}]/u.test(s)) out.push({role: 'text', name: s, p: me, tag: tag.toLowerCase(), kind: 't', ref: refFor(el, prefix, 'e', pattern),
          inview: rect.bottom > 0 && rect.top < vh});
        nextTextDone = true;
      } else {
        let direct = '';
        for (const c of el.childNodes) if (c.nodeType === 3) direct += c.nodeValue + ' ';
        direct = clean(direct, 200);
        if (direct && /[\p{L}\p{N}]/u.test(direct)) out.push({role: 'text', name: direct, p: me, tag: tag.toLowerCase(), kind: 't',
          ref: refFor(el, prefix, 'e', pattern), inview: rect.bottom > 0 && rect.top < vh});
      }
    }
    let kids;
    if (el.shadowRoot) kids = el.shadowRoot.children;
    else if (tag === 'SLOT') { const a = el.assignedElements({flatten: true}); kids = a.length ? a : el.children; }
    else kids = el.children;
    for (const c of kids) walk(c, me, prefix, pattern, frameDepth, nextTextDone, win, frameView);
  }
  let root = document.body, prefix = 'e', pattern = /^e\d+$/, win = W, depth = 0;
  if (opts.scope) {
    let el = live(opts.scope);
    if (!el) el = document.querySelector('[data-agentic-ref="' + opts.scope + '"]');
    if (!el) {
      const m = /^(f\d+)e\d+$/.exec(opts.scope);
      if (m) {
        const fr = live(m[1]) || document.querySelector('[data-agentic-ref="' + m[1] + '"]');
        try { el = fr && fr.contentDocument && fr.contentDocument.querySelector('[data-agentic-ref="' + opts.scope + '"]'); } catch (e) { el = null; }
      }
    }
    if (!el) return {error: 'scope ' + opts.scope + ' is not on the page now'};
    root = el;
    const m = /^(f\d+)e\d+$/.exec(opts.scope);
    if (m) { prefix = m[1] + 'e'; pattern = new RegExp('^' + m[1] + 'e\\d+$'); win = el.ownerDocument.defaultView || W; depth = 1; }
  }
  if (root) walk(root, -1, prefix, pattern, depth, false, win, false);
  return {nodes: out, doc: top.documentElement.getAttribute('data-agentic-doc'), truncated, visited,
    auth_form: authForm, registry_age: Date.now() - R.made};
}"""

# Draws the refs over the page for a screenshot (set-of-marks for vision), then removed.
MARKS_JS = r"""(show) => {
  document.querySelectorAll('[data-agentic-overlay]').forEach(e => e.remove());
  if (!show) return 0;
  const box = document.createElement('div');
  box.setAttribute('data-agentic-overlay', '1');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  let n = 0;
  const add = (el, ref, dx, dy) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
    const t = document.createElement('div');
    t.textContent = ref.replace(/^e/, '');
    t.style.cssText = 'position:fixed;font:bold 11px monospace;background:#ffd400;color:#000;padding:0 3px;' +
      'border:1px solid #000;border-radius:3px;left:' + Math.max(0, r.left + dx - 4) + 'px;top:' + Math.max(0, r.top + dy - 8) + 'px';
    box.appendChild(t); n++;
  };
  const roles = /^(a|button|input|select|textarea|summary)$/i;
  document.querySelectorAll('[data-agentic-ref]').forEach(el => {
    const ref = el.getAttribute('data-agentic-ref');
    if (/^e\d+$/.test(ref) && (roles.test(el.tagName) || el.getAttribute('role') || el.hasAttribute('onclick'))) add(el, ref, 0, 0);
    if (/^f\d+$/.test(ref)) {
      const fr = el.getBoundingClientRect();
      try {
        el.contentDocument.querySelectorAll('[data-agentic-ref]').forEach(x => {
          if (roles.test(x.tagName) || x.getAttribute('role')) add(x, x.getAttribute('data-agentic-ref'), fr.left, fr.top);
        });
      } catch (e) {}
    }
  });
  document.documentElement.appendChild(box);
  return n;
}"""
