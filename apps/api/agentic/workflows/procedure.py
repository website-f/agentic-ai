"""Compile a workflow graph into a readable numbered procedure, and validate/draft graphs.

A workflow is guidance, not code: the compiled text is layered into an agent's prompt the way
an SOP is. This module turns the node/edge graph into ordered steps an agent can follow.
"""

from typing import Any

NODE_TYPES = ("start", "step", "decision", "handoff", "end")
MAX_NODES = 60
MAX_EDGES = 120


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
        nodes.append(
            {
                "id": nid,
                "type": ntype if ntype in NODE_TYPES else "step",
                "title": str(n.get("title", ""))[:120],
                "body": str(n.get("body", ""))[:1000],
                "role": str(n.get("role", ""))[:80],
                "x": int(n.get("x", 0)) if str(n.get("x", "")).lstrip("-").isdigit() else 0,
                "y": int(n.get("y", 0)) if str(n.get("y", "")).lstrip("-").isdigit() else 0,
                # For runs (P11): who does the step, whether a person checks its result
                # before the work moves on, and who takes a decision.
                "agent_id": str(n.get("agent_id") or "")[:40],
                "review": bool(n.get("review")),
                "decider": "agent" if n.get("decider") == "agent" else "person",
            }
        )
    edges: list[dict[str, Any]] = []
    for e in (raw.get("edges") or [])[:MAX_EDGES]:
        if not isinstance(e, dict):
            continue
        src, dst = str(e.get("from", "")), str(e.get("to", ""))
        if src in ids and dst in ids and src != dst:
            edges.append(
                {
                    "id": str(e.get("id", f"{src}-{dst}"))[:60],
                    "from": src,
                    "to": dst,
                    "label": str(e.get("label", ""))[:60],
                }
            )
    return {"nodes": nodes, "edges": edges}


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


def compile_text(name: str, graph: dict[str, Any]) -> str:
    """The workflow as a numbered procedure an agent can read."""
    graph = clean_graph(graph)
    nodes = {n["id"]: n for n in graph["nodes"]}
    out_edges: dict[str, list[dict[str, Any]]] = {}
    for e in graph["edges"]:
        out_edges.setdefault(e["from"], []).append(e)
    ordered = _order(graph)
    num = {n["id"]: i for i, n in enumerate(ordered, 1)}
    lines = [f"Procedure: {name}"]
    for i, n in enumerate(ordered, 1):
        role = f" [{n['role']}]" if n["role"] else ""
        tag = {"start": "Start", "decision": "Decision", "handoff": "Hand off", "end": "End"}.get(
            n["type"], ""
        )
        head = f"{i}.{role} {n['title'] or tag or 'Step'}"
        if tag and n["type"] != "step":
            head += f" ({tag.lower()})"
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


DRAFT_SYSTEM = (
    "You design office procedures as a small graph. Return ONLY JSON: "
    '{"nodes":[{"id","type","title","body","role"}],"edges":[{"from","to","label"}]}. '
    "type is one of start, step, decision, handoff, end. Give one start node and at least one "
    "end node. Keep ids short (n1, n2...). title is a few words; body is ONE short sentence "
    "(15 words max). role is the department or job that does the step, or empty. For a decision "
    "node, give each outgoing edge a short label (e.g. yes / no). 6 to 15 nodes. No prose."
)


def draft_prompt(description: str) -> str:
    return f"Design a procedure for this job:\n\n{description.strip()}"
