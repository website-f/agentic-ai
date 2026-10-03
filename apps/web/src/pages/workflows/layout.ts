/** Tidy up: lay a graph out top to bottom in layers, like a flowchart. A step sits one row
 * below the lowest step leading into it (longest path), so arrows point down and a shared
 * End lands at the bottom. Connections that loop back are ignored for the layering.
 * Same rule as the server's procedure.layout, so drafts and tidied graphs look alike. */
import type { Graph, WNode } from "@/lib/workflows";

export function tidy(graph: Graph, gapX = 290, gapY = 170): Graph {
  const flow = graph.nodes.filter((n) => n.type !== "note");
  const notes = graph.nodes.filter((n) => n.type === "note");
  if (!flow.length) return graph;
  const ids = new Set(flow.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  // Drop back edges (found by a depth-first walk from the starts) so the rest is acyclic.
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  let roots = flow.filter((n) => n.type === "start").map((n) => n.id);
  if (!roots.length) roots = flow.filter((n) => !edges.some((e) => e.to === n.id)).map((n) => n.id);
  if (!roots.length) roots = [flow[0]!.id];
  const state = new Map<string, number>();
  const forward: [string, string][] = [];
  const walk = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) continue; // back edge
      forward.push([id, to]);
      if (s === 0) walk(to);
    }
    state.set(id, 2);
  };
  for (const r of roots) if (!state.get(r)) walk(r);
  for (const n of flow) if (!state.get(n.id)) walk(n.id);

  // Longest path from the roots over the forward edges.
  const preds = new Map<string, string[]>();
  for (const [a, b] of forward) preds.set(b, [...(preds.get(b) ?? []), a]);
  const level = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const ps = preds.get(id) ?? [];
    const lv = ps.length ? Math.max(...ps.map((p) => depth(p, seen) + 1)) : 0;
    level.set(id, lv);
    return lv;
  };
  for (const n of flow) depth(n.id, new Set());
  // End steps share the bottom row.
  const bottom = Math.max(...level.values());
  for (const n of flow) if (n.type === "end") level.set(n.id, bottom);

  const rows = new Map<number, WNode[]>();
  for (const n of flow) rows.set(level.get(n.id)!, [...(rows.get(level.get(n.id)!) ?? []), n]);
  // Keep siblings in the order their parents sit, to limit crossing arrows.
  const order = new Map<string, number>();
  for (const lv of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(lv)!;
    const score = (n: WNode) => {
      const ps = (preds.get(n.id) ?? []).map((p) => order.get(p) ?? 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    row.sort((a, b) => score(a) - score(b));
    row.forEach((n, i) => order.set(n.id, i));
  }
  const widest = Math.max(...[...rows.values()].map((r) => r.length));
  const placed = new Map<string, { x: number; y: number }>();
  for (const [lv, row] of rows) {
    const offset = ((widest - row.length) * gapX) / 2;
    row.forEach((n, i) => placed.set(n.id, { x: Math.round(60 + offset + i * gapX), y: 60 + lv * gapY }));
  }
  // Notes go in a column to the right of the flow.
  const right = 60 + widest * gapX + 40;
  notes.forEach((n, i) => placed.set(n.id, { x: right, y: 60 + i * 130 }));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, ...placed.get(n.id) })) };
}
