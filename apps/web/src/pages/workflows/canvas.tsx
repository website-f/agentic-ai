/** A small node-graph canvas: drag nodes, drag from a node's handle to another to connect,
 * click to select. No external graph library — DOM nodes with an SVG edge layer. */
import { XIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { NODE_COLOR, type Graph, type WNode } from "@/lib/workflows";

export const NODE_W = 216;
export const NODE_H = 76;
const PAD = 120; // extra room around the furthest node

type Drag =
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "link"; from: string; x: number; y: number }
  | null;

function point(e: { clientX: number; clientY: number }, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
}

function edgePath(a: WNode, b: WNode) {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

export function Canvas({
  graph,
  onChange,
  selected,
  onSelect,
  readOnly,
}: {
  graph: Graph;
  onChange: (g: Graph) => void;
  selected: { kind: "node" | "edge"; id: string } | null;
  onSelect: (s: { kind: "node" | "edge"; id: string } | null) => void;
  readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<string | null>(null);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));

  const width = Math.max(900, ...graph.nodes.map((n) => n.x + NODE_W)) + PAD;
  const height = Math.max(520, ...graph.nodes.map((n) => n.y + NODE_H)) + PAD;

  useLayoutEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (!box.current) return;
      const p = point(e, box.current);
      if (drag.kind === "move") {
        onChange({
          ...graph,
          nodes: graph.nodes.map((n) =>
            n.id === drag.id ? { ...n, x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) } : n,
          ),
        });
      } else {
        setDrag({ ...drag, x: p.x, y: p.y });
      }
    };
    const up = () => {
      if (drag.kind === "link" && hover && hover !== drag.from) {
        const exists = graph.edges.some((ed) => ed.from === drag.from && ed.to === hover);
        if (!exists) {
          onChange({
            ...graph,
            edges: [...graph.edges, { id: `e${Date.now().toString(36)}`, from: drag.from, to: hover, label: "" }],
          });
        }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, graph, hover, onChange]);

  const startMove = (e: React.PointerEvent, n: WNode) => {
    if (readOnly) return;
    onSelect({ kind: "node", id: n.id });
    if (!box.current) return;
    const p = point(e, box.current);
    setDrag({ kind: "move", id: n.id, dx: p.x - n.x, dy: p.y - n.y });
  };
  const startLink = (e: React.PointerEvent, n: WNode) => {
    if (readOnly) return;
    e.stopPropagation();
    if (!box.current) return;
    const p = point(e, box.current);
    setDrag({ kind: "link", from: n.id, x: p.x, y: p.y });
  };

  const linkFrom = drag?.kind === "link" ? byId[drag.from] : null;

  return (
    <div
      ref={box}
      onPointerDown={() => onSelect(null)}
      className="relative h-[clamp(24rem,60vh,42rem)] overflow-auto rounded-[var(--radius-md)] border border-border bg-surface-2/40"
      style={{ backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
    >
      <div className="relative" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
          {graph.edges.map((ed) => {
            const a = byId[ed.from];
            const b = byId[ed.to];
            if (!a || !b) return null;
            const on = selected?.kind === "edge" && selected.id === ed.id;
            const mx = (a.x + b.x) / 2 + NODE_W / 2;
            const my = (a.y + NODE_H + b.y) / 2;
            return (
              <g key={ed.id}>
                <path d={edgePath(a, b)} fill="none" stroke={on ? "var(--color-accent)" : "var(--color-border)"} strokeWidth={on ? 3 : 2} />
                <path
                  d={edgePath(a, b)} fill="none" stroke="transparent" strokeWidth={14}
                  className={cn("pointer-events-auto", !readOnly && "cursor-pointer")}
                  onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: "edge", id: ed.id }); }}
                />
                {ed.label ? (
                  <text x={mx} y={my} textAnchor="middle" className="pointer-events-none fill-fg text-[11px]"
                    style={{ paintOrder: "stroke", stroke: "var(--color-surface)", strokeWidth: 4 }}>
                    {ed.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {linkFrom && drag?.kind === "link" ? (
            <path
              d={`M ${linkFrom.x + NODE_W / 2} ${linkFrom.y + NODE_H} L ${drag.x} ${drag.y}`}
              fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="4 4"
            />
          ) : null}
        </svg>

        {graph.nodes.map((n) => {
          const on = selected?.kind === "node" && selected.id === n.id;
          return (
            <div
              key={n.id}
              onPointerDown={(e) => startMove(e, n)}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              className={cn(
                "absolute flex flex-col rounded-[var(--radius-sm)] border bg-surface px-3 py-2 shadow-[var(--shadow-soft)] select-none",
                on ? "border-accent ring-2 ring-accent/30" : "border-border",
                drag?.kind === "link" && hover === n.id && hover !== drag.from && "ring-2 ring-accent",
                readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing",
              )}
              style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H }}
            >
              <div className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: NODE_COLOR[n.type] }} />
                <span className="truncate text-[13px] font-medium">{n.title || "Untitled"}</span>
              </div>
              {n.role ? <span className="mt-0.5 truncate text-[11px] text-muted">{n.role}</span> : null}
              {n.body ? <span className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{n.body}</span> : null}
              {!readOnly ? (
                <button
                  aria-label="Drag to connect"
                  onPointerDown={(e) => startLink(e, n)}
                  className="absolute -bottom-2 left-1/2 size-4 -translate-x-1/2 rounded-full border-2 border-surface bg-accent hover:scale-125"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {!graph.nodes.length ? (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted">
          Add a step to start, or draft the whole thing from a description.
        </p>
      ) : null}
      {selected?.kind === "edge" && !readOnly ? (
        <button
          onClick={() => { onChange({ ...graph, edges: graph.edges.filter((e) => e.id !== selected.id) }); onSelect(null); }}
          className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2.5 py-1 text-[12px] shadow-[var(--shadow-soft)] hover:border-danger hover:text-danger"
        >
          <XIcon size={13} /> Remove connection
        </button>
      ) : null}
    </div>
  );
}
