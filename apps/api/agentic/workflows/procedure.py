"""Compile a workflow graph into a readable numbered procedure, and validate/draft graphs.

A workflow is guidance, not code: the compiled text is layered into an agent's prompt the way
an SOP is. This module turns the node/edge graph into ordered steps an agent can follow.

Node types: start, step (work an agent does), handoff (work passed to a colleague), decision
(branches), input (a person supplies information), wait (a pause), end, and note (a sticky note
on the canvas; never run, never compiled). A step's `action` says what kind of office work it
is, so the agent doing it gets the right instructions (see ACTIONS).
"""

import json
from typing import Any

NODE_TYPES = ("start", "step", "decision", "handoff", "input", "wait", "end", "note")
MAX_NODES = 100
MAX_EDGES = 200
WAIT_UNITS = {"minutes": 60, "hours": 3600, "days": 86400}

# What each kind of step is, and the one-line instruction the agent doing it receives.
ACTIONS: dict[str, tuple[str, str]] = {
    "task": ("Agent task", ""),
    "research": ("Research", "Research it on the web; give sources (links) for every fact."),
    "read": (
        "Read files",
        "Read the job's files and pull out exactly the facts this step asks for.",
    ),
    "write": ("Write", "Write the text in full, ready to use; keep facts to what you were given."),
    "summarise": ("Summarise", "Summarise briefly: key points, figures, dates and decisions."),
    "translate": ("Translate", "Translate faithfully; keep names, numbers and formatting."),
    "analyse": (
        "Analyse data",
        "Analyse the data (use run_python for any calculation) and report figures.",
    ),
    "calculate": (
        "Calculate",
        "Work out the figures exactly (calculator or run_python); show the totals.",
    ),
    "check": (
        "Check",
        "Check the work for errors, gaps and inconsistencies; list each issue found.",
    ),
    "classify": (
        "Sort",
        "Sort or label the items into the categories asked for; say why for each.",
    ),
    "plan": ("Plan", "Make a dated plan: who does what, by when."),
    "email": (
        "Draft email",
        "Draft the email (subject and body). Do not send it; a person sends it.",
    ),
    "reply": ("Reply", "Draft a reply to the customer or sender: clear, polite, complete."),
    "message": ("Message team", "Write the message for the team, short and clear."),
    "meeting": (
        "Prepare meeting",
        "Prepare the meeting: agenda, attendees, materials and questions.",
    ),
    "template": (
        "Fill template",
        "Draft the document from the right template (draft_document) and check it.",
    ),
    "pack": (
        "Prepare pack",
        "Gather and check each item the submission pack needs (pack_status, pack_attach).",
    ),
    "report": (
        "Publish report",
        "Publish the result as a report (publish_report) with a short summary.",
    ),
    "spreadsheet": (
        "Spreadsheet",
        "Build or update the spreadsheet (run_python with openpyxl) and attach it.",
    ),
    "browse": (
        "Look up online",
        "Look it up on the website with the browser; note exactly what you saw.",
    ),
    "form": (
        "Fill web form",
        "Fill in the web form with the browser; a person approves before submitting.",
    ),
    "approval": ("Approval", ""),
}
DECISION_ACTIONS = {"approval"}


def clean_graph(raw: Any) -> dict[str, Any]:
    """Keep only well-formed nodes and edges, capped. Unknown fields are dropped."""
    if not isinstance(raw, dict):
        return {"nodes": [], "edges": []}
    nodes: list[dict[str, Any]] = []
    ids: set[str] = set()
    for n in (raw.get("nodes") or [])[:MAX_NODES]:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        nid = str(n["id"])[:40]
        if nid in ids:
            continue
        ids.add(nid)
        ntype = str(n.get("type", "step"))
        ntype = ntype if ntype in NODE_TYPES else "step"
        action = str(n.get("action") or "")
        unit = str(n.get("wait_unit") or "hours")
        try:
            amount = max(1, min(int(n.get("wait_amount") or 1), 999))
        except (TypeError, ValueError):
            amount = 1
        nodes.append(
            {
                "id": nid,
                "type": ntype,
                "title": str(n.get("title", ""))[:120],
                "body": str(n.get("body", ""))[:1000],
                "role": str(n.get("role", ""))[:80],
                "x": _int(n.get("x")),
                "y": _int(n.get("y")),
                # For runs (P11): who does the step, whether a person checks its result
                # before the work moves on, and who takes a decision.
                "agent_id": str(n.get("agent_id") or "")[:40],
                "review": bool(n.get("review")),
                "decider": "agent" if n.get("decider") == "agent" else "person",
                # Work steps carry an action; a decision may be an approval; nothing else does.
                "action": action
                if (
                    ntype in ("step", "handoff")
                    and action in ACTIONS
                    and action not in DECISION_ACTIONS
                )
                or (ntype == "decision" and action in DECISION_ACTIONS)
                else "",
                "wait_amount": amount,
                "wait_unit": unit if unit in WAIT_UNITS else "hours",
            }
        )
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for e in (raw.get("edges") or [])[:MAX_EDGES]:
        if not isinstance(e, dict):
            continue
        src, dst = str(e.get("from", "")), str(e.get("to", ""))
        if src in ids and dst in ids and src != dst and (src, dst) not in seen:
            seen.add((src, dst))
            edges.append(
                {
                    "id": str(e.get("id", f"{src}-{dst}"))[:60],
                    "from": src,
                    "to": dst,
                    "label": str(e.get("label", ""))[:60],
                }
            )
    return {"nodes": nodes, "edges": edges}


def _int(v: Any) -> int:
    try:
        return max(-100_000, min(int(float(v)), 100_000))
    except (TypeError, ValueError):
        return 0


def runnable(graph: dict[str, Any]) -> dict[str, Any]:
    """The graph a run follows: notes are only for people reading the canvas."""
    keep = [n for n in graph["nodes"] if n["type"] != "note"]
    ids = {n["id"] for n in keep}
    return {
        "nodes": keep,
        "edges": [e for e in graph["edges"] if e["from"] in ids and e["to"] in ids],
    }


def _order(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Nodes in a sensible reading order: from the start node, depth-first, then any leftovers."""
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    out_edges: dict[str, list[dict[str, Any]]] = {}
    for e in graph.get("edges", []):
        out_edges.setdefault(e["from"], []).append(e)
    starts = [n["id"] for n in graph.get("nodes", []) if n["type"] == "start"]
    if not starts:
        incoming = {e["to"] for e in graph.get("edges", [])}
        starts = [n["id"] for n in graph.get("nodes", []) if n["id"] not in incoming] or list(
            nodes
        )[:1]
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    stack = list(reversed(starts))
    while stack:
        nid = stack.pop()
        if nid in seen or nid not in nodes:
            continue
        seen.add(nid)
        ordered.append(nodes[nid])
        for e in reversed(out_edges.get(nid, [])):
            if e["to"] not in seen:
                stack.append(e["to"])
    for n in graph.get("nodes", []):  # anything disconnected, appended at the end
        if n["id"] not in seen:
            ordered.append(n)
    return ordered


def wait_text(n: dict[str, Any]) -> str:
    amount, unit = n.get("wait_amount", 1), n.get("wait_unit", "hours")
    return f"{amount} {unit[:-1] if amount == 1 else unit}"


def compile_text(name: str, graph: dict[str, Any]) -> str:
    """The workflow as a numbered procedure an agent can read."""
    graph = runnable(clean_graph(graph))
    nodes = {n["id"]: n for n in graph["nodes"]}
    out_edges: dict[str, list[dict[str, Any]]] = {}
    for e in graph["edges"]:
        out_edges.setdefault(e["from"], []).append(e)
    ordered = _order(graph)
    num = {n["id"]: i for i, n in enumerate(ordered, 1)}
    lines = [f"Procedure: {name}"]
    tags = {
        "start": "start",
        "decision": "decision",
        "handoff": "hand off",
        "input": "ask a person",
        "wait": "wait",
        "end": "end",
    }
    for i, n in enumerate(ordered, 1):
        role = f" [{n['role']}]" if n["role"] else ""
        tag = tags.get(n["type"], "")
        if n["type"] == "step" and n.get("action") and n["action"] != "task":
            tag = ACTIONS[n["action"]][0].lower()
        if n["type"] == "decision" and n.get("action") == "approval":
            tag = "approval by a person"
        title = n["title"] or tag.capitalize() or "Step"
        head = f"{i}.{role} {title}"
        if n["type"] == "wait":
            head += f" (wait {wait_text(n)})"
        elif tag:
            head += f" ({tag})"
        lines.append(head)
        if n["body"]:
            lines.append(f"   {n['body']}")
        branches = out_edges.get(n["id"], [])
        for e in branches:
            target = nodes.get(e["to"], {})
            where = f"step {num.get(e['to'], '?')} ({target.get('title', '')})".strip()
            if e["label"]:
                lines.append(f"   → if {e['label']}: go to {where}")
            elif len(branches) > 1:
                lines.append(f"   → go to {where}")
    return "\n".join(lines)


_ACTION_KEYS = ", ".join(k for k in ACTIONS if k not in DECISION_ACTIONS)
# The graph's shape and node types; DRAFT_SYSTEM adds the style for drafting from a short
# description, intake/builders.py the rules for drafting from a company's documents.
DRAFT_SHAPE = (
    "You design office procedures as a graph that AI agents and people carry out together. "
    'Return ONLY JSON: {"nodes":[{"id","type","title","body","role","action"}],'
    '"edges":[{"from","to","label"}]}. '
    "type is one of: start, step (work an AI agent does), handoff (work passed to another "
    "department's agent), decision (the job branches), input (a person must supply "
    "information), wait (a pause; add wait_amount and wait_unit minutes|hours|days), end. "
    f"For a step, action is one of: {_ACTION_KEYS}. "
    "For an approval by a person use type decision with action approval and edges labelled "
    "approved / rejected. Give exactly one start node and at least one end node. Ids short "
    "(n1, n2...). "
)
DRAFT_SYSTEM = DRAFT_SHAPE + (
    "title: a few words. body: ONE short sentence (15 words max) saying what "
    "the step produces. role: the department or job that does it, or empty. Every decision's "
    "outgoing edges carry short labels (yes / no). Steps that can happen at the same time may "
    "branch from one node. 6 to 18 nodes. No prose."
)


def draft_prompt(description: str) -> str:
    return f"Design a procedure for this job:\n\n{description.strip()}"


def loads_lenient(text: str) -> dict[str, Any] | None:
    """Parse a drafted graph's JSON; if it was cut off mid-stream, recover the complete
    prefix. Code fences around the JSON are ignored."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0].strip()
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except ValueError:
        pass
    for end in range(len(text), 1, -1):  # trim back to the last point that parses
        if text[end - 1] in "}]":
            for close in ("", "}", "]}", "}]}"):
                try:
                    v = json.loads(text[:end] + close)
                except ValueError:
                    continue
                return v if isinstance(v, dict) else None
    return None


def tidy_draft(graph: dict[str, Any]) -> dict[str, Any]:
    """What every drafted graph needs before people see it (in place, returned):
    only a decision's branches carry labels (models like to write "next" on every arrow),
    and a reply cut off before its connections gets its steps linked in order."""
    deciders = {n["id"] for n in graph["nodes"] if n["type"] == "decision"}
    for e in graph["edges"]:
        if e["from"] not in deciders:
            e["label"] = ""
    if not graph["edges"] and len(graph["nodes"]) > 1:
        flow = [n for n in graph["nodes"] if n["type"] != "note"]
        graph["edges"] = [
            {"id": f"e{i}", "from": a["id"], "to": b["id"], "label": ""}
            for i, (a, b) in enumerate(zip(flow, flow[1:], strict=False), 1)
        ]
    return graph


def lay_out_draft(graph: dict[str, Any]) -> dict[str, Any]:
    """Top to bottom like a flowchart; notes keep their places."""
    notes = [n for n in graph["nodes"] if n["type"] == "note"]
    flow = layout(
        {"nodes": [n for n in graph["nodes"] if n["type"] != "note"], "edges": graph["edges"]}
    )
    return {"nodes": flow["nodes"] + notes, "edges": graph["edges"]}


DEFAULT_IMPROVE = "make it complete and robust for real office use"


def revise_prompt(instruction: str, graph: dict[str, Any]) -> str:
    """Ask for an improved version of an existing graph (same JSON shape back)."""
    slim = {
        "nodes": [
            {k: n[k] for k in ("id", "type", "title", "body", "role", "action") if n.get(k)}
            | (
                {"wait_amount": n["wait_amount"], "wait_unit": n["wait_unit"]}
                if n["type"] == "wait"
                else {}
            )
            for n in runnable(clean_graph(graph))["nodes"]
        ],
        "edges": [
            {k: e[k] for k in ("from", "to", "label") if e.get(k)}
            for e in runnable(clean_graph(graph))["edges"]
        ],
    }
    return (
        "Here is the current procedure graph:\n"
        f"{json.dumps(slim, ensure_ascii=False)}\n\n"
        f"Improve it as follows: {instruction.strip() or DEFAULT_IMPROVE}.\n"
        "Keep the ids of nodes you keep. Return the whole improved graph."
    )


def layout(graph: dict[str, Any], gap_x: int = 280, gap_y: int = 170) -> dict[str, Any]:
    """Top-to-bottom layers, so a drafted graph reads like a flowchart: a step sits one row
    below the lowest step leading into it (longest path; loops back are ignored) and End steps
    share the bottom row. Same rule as the editor's Tidy up."""
    nodes = graph["nodes"]
    if not nodes:
        return graph
    ids = {n["id"] for n in nodes}
    out: dict[str, list[str]] = {}
    for e in graph["edges"]:
        if e["from"] in ids and e["to"] in ids:
            out.setdefault(e["from"], []).append(e["to"])
    has_in = {t for ts in out.values() for t in ts}
    roots = (
        [n["id"] for n in nodes if n["type"] == "start"]
        or [n["id"] for n in nodes if n["id"] not in has_in]
        or [nodes[0]["id"]]
    )
    state: dict[str, int] = {}
    preds: dict[str, list[str]] = {}

    def walk(nid: str) -> None:  # depth first; edges into a node still open are loops back
        stack = [(nid, iter(out.get(nid, [])))]
        state[nid] = 1
        while stack:
            cur, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                state[cur] = 2
                stack.pop()
                continue
            if state.get(nxt) == 1:
                continue
            preds.setdefault(nxt, []).append(cur)
            if not state.get(nxt):
                state[nxt] = 1
                stack.append((nxt, iter(out.get(nxt, []))))

    for r in roots:
        if not state.get(r):
            walk(r)
    for n in nodes:
        if not state.get(n["id"]):
            walk(n["id"])
    level: dict[str, int] = {}

    def depth(nid: str, seen: frozenset[str] = frozenset()) -> int:
        if nid in level:
            return level[nid]
        if nid in seen:
            return 0
        ps = preds.get(nid, [])
        lv = max((depth(p, seen | {nid}) + 1 for p in ps), default=0)
        level[nid] = lv
        return lv

    for n in nodes:
        depth(n["id"])
    bottom = max(level.values(), default=0)
    for n in nodes:
        if n["type"] == "end":
            level[n["id"]] = bottom
    rows: dict[int, list[dict[str, Any]]] = {}
    for n in nodes:
        rows.setdefault(level[n["id"]], []).append(n)
    widest = max(len(r) for r in rows.values())
    for lv, row in rows.items():
        offset = (widest - len(row)) * gap_x / 2
        for i, n in enumerate(row):
            n["x"], n["y"] = int(60 + offset + i * gap_x), 60 + lv * gap_y
    return graph
