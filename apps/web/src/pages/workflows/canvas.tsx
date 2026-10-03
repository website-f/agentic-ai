/** The workflow canvas: an infinite, zoomable board of step cards joined by arrows.
 *
 * Pan by dragging the background (or scrolling), zoom with Ctrl/⌘ + scroll, pinch, or the
 * buttons; drag a card to move it (snaps to a 20px grid); drag from a card's bottom dot to
 * another card to connect them, or onto empty space to add the next step right there.
 * No graph library: DOM cards on a transformed layer, with an SVG layer for the arrows. */
import {
  ArrowsInIcon, CornersOutIcon, MapTrifoldIcon, MinusIcon, PlusIcon, TrashIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { IconTile } from "@/components/page";
import { cn } from "@/lib/utils";
import type { Graph, StepStatus, WEdge, WNode } from "@/lib/workflows";

import { itemFor, subtitle, TONE_VAR } from "./library";

export const NODE_W = 240;
export const NODE_H = 76;
const NOTE_W = 220;
const GRID = 20;
const MIN_K = 0.25;
const MAX_K = 1.6;

const RUN_LOOK: Partial<Record<StepStatus, string>> = {
  running: "border-info ring-2 ring-info/25",
  ready: "border-info",
  waiting: "border-warn ring-2 ring-warn/30",
  scheduled: "border-[var(--series-2)] ring-2 ring-[color-mix(in_oklab,var(--series-2)_25%,transparent)]",
  review: "border-warn ring-2 ring-warn/30",
  blocked: "border-warn ring-2 ring-warn/30",
  done: "border-ok",
  failed: "border-danger ring-2 ring-danger/25",
  skipped: "opacity-45",
};
const RUN_DOT: Partial<Record<StepStatus, string>> = {
  running: "bg-info animate-pulse", ready: "bg-info", waiting: "bg-warn animate-pulse", review: "bg-warn animate-pulse",
  scheduled: "bg-[var(--series-2)] animate-pulse", blocked: "bg-warn", done: "bg-ok", failed: "bg-danger",
};

type View = { x: number; y: number; k: number };
type Pt = { x: number; y: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: "move"; id: string; dx: number; dy: number; moved: boolean }
  | { kind: "link"; from: string; at: Pt }
  | null;

const width = (n: WNode) => (n.type === "note" ? NOTE_W : NODE_W);
const snap = (v: number) => Math.round(v / GRID) * GRID;

function ports(a: WNode, b: WNode) {
  const p0 = { x: a.x + width(a) / 2, y: a.y + NODE_H };
  const p3 = { x: b.x + width(b) / 2, y: b.y };
  const bend = Math.max(48, Math.min(160, Math.abs(p3.y - p0.y) / 2 + (p3.y < p0.y ? 90 : 0)));
  const p1 = { x: p0.x, y: p0.y + bend };
  const p2 = { x: p3.x, y: p3.y - bend };
  return { p0, p1, p2, p3 };
}
function pathOf(a: WNode, b: WNode) {
  const { p0, p1, p2, p3 } = ports(a, b);
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y - 6}`;
}
function midOf(a: WNode, b: WNode): Pt {
  const { p0, p1, p2, p3 } = ports(a, b);
  return { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 };
}

export function bounds(nodes: WNode[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 800, h: 500 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...nodes.map((n) => n.x + width(n))) - x, h: Math.max(...ys) + NODE_H - y };
}

export function Canvas({
  graph, onChange, selected, onSelect, readOnly, status, taken, className,
  onBeginChange, onDropItem, onQuickAdd, onInsertOnEdge, issues, agentNames, fill, fitSignal, empty,
}: {
  graph: Graph;
  onChange: (g: Graph) => void;
  selected: { kind: "node" | "edge"; id: string } | null;
  onSelect: (s: { kind: "node" | "edge"; id: string } | null) => void;
  readOnly?: boolean;
  /** During a run: each step's state, and the connections the run went along. */
  status?: Record<string, StepStatus>;
  taken?: Set<string>;
  className?: string;
  /** Called once before a change people may want to undo (a move, a new connection). */
  onBeginChange?: () => void;
  /** A library item was dropped on the board (world coordinates). */
  onDropItem?: (key: string, at: Pt) => void;
  /** A connection was dragged onto empty space: offer to add a step there. */
  onQuickAdd?: (from: string, at: Pt, screen: Pt) => void;
  onInsertOnEdge?: (edge: WEdge, at: Pt) => void;
  issues?: Set<string>;
  agentNames?: Record<string, string>;
  /** Fill the parent's height instead of a fixed one. */
  fill?: boolean;
  /** Change this number to fit the whole graph in view. */
  fitSignal?: number;
  empty?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [mini, setMini] = useState(true);
  const pinch = useRef<{ pts: Map<number, Pt>; d0: number; k0: number } | null>(null);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const world = useCallback((cx: number, cy: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    setView((v) => {
      const nk = Math.min(MAX_K, Math.max(MIN_K, k));
      return { k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk };
    });
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const b = bounds(graph.nodes);
    const pad = 80;
    const k = Math.min(1.1, Math.max(MIN_K, Math.min((size.w - pad) / (b.w + pad), (size.h - pad) / (b.h + pad))));
    setView({ k, x: (size.w - b.w * k) / 2 - b.x * k, y: (size.h - b.h * k) / 2 - b.y * k });
  }, [graph.nodes, size]);

  // Track the board's size; fit once the first time it has a size and steps.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // Wait until the board has its real size, then fit once.
    if (!fitted.current && graph.nodes.length && size.w > 0 && size.h > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, graph.nodes.length, size.w, size.h]);
  useEffect(() => {
    if (fitSignal) {
      const t = requestAnimationFrame(fit);
      return () => cancelAnimationFrame(t);
    }
    // Only an explicit request re-fits; the graph changing must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Scroll pans; Ctrl/⌘ + scroll (and trackpad pinch) zooms at the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const nk = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0022)));
          const sx = e.clientX - r.left;
          const sy = e.clientY - r.top;
          return { k: nk, x: sx - ((sx - v.x) / v.k) * nk, y: sy - ((sy - v.y) / v.k) * nk };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer moves while dragging anything.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (pinch.current?.pts.has(e.pointerId)) return;
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) > 3) setDrag({ ...drag, moved: true });
        setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
      } else if (drag.kind === "move") {
        const p = world(e.clientX, e.clientY);
        if (!drag.moved) {
          onBeginChange?.();
          setDrag({ ...drag, moved: true });
        }
        const nx = Math.round((p.x - drag.dx) / 10) * 10;
        const ny = Math.round((p.y - drag.dy) / 10) * 10;
        onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === drag.id ? { ...n, x: nx, y: ny } : n)) });
      } else {
        setDrag({ ...drag, at: world(e.clientX, e.clientY) });
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.node);
        setHoverNode(hit instanceof HTMLElement ? hit.dataset.node! : null);
      }
    };
    const up = (e: PointerEvent) => {
      if (drag.kind === "pan" && !drag.moved) onSelect(null);
      if (drag.kind === "move" && drag.moved) {
        onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === drag.id ? { ...n, x: snap(n.x), y: snap(n.y) } : n)) });
      }
      if (drag.kind === "link") {
        const to = hoverNode;
        if (to && to !== drag.from && byId[to] && byId[to]!.type !== "start" && byId[to]!.type !== "note") {
          if (!graph.edges.some((ed) => ed.from === drag.from && ed.to === to)) {
            onBeginChange?.();
            const from = byId[drag.from]!;
            const outs = graph.edges.filter((ed) => ed.from === drag.from).length;
            // A decision's branches start labelled; people rename them.
            const label = from.type === "decision"
              ? from.action === "approval" ? (outs ? "rejected" : "approved") : outs === 0 ? "yes" : outs === 1 ? "no" : `option ${outs + 1}`
              : "";
            onChange({ ...graph, edges: [...graph.edges, { id: `e${Date.now().toString(36)}`, from: drag.from, to, label }] });
          }
        } else if (!to && onQuickAdd) {
          const r = box.current!.getBoundingClientRect();
          onQuickAdd(drag.from, world(e.clientX, e.clientY), { x: e.clientX - r.left, y: e.clientY - r.top });
        }
        setHoverNode(null);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, graph, byId, hoverNode, onChange, onSelect, onBeginChange, onQuickAdd, world]);

  // Background: one pointer pans, two pinch-zoom.
  const onBoardDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const pts = new Map(pinch.current?.pts ?? []);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch.current = { pts, d0: Math.hypot(a!.x - b!.x, a!.y - b!.y), k0: view.k };
      setDrag(null);
      return;
    }
    pinch.current = { pts, d0: 0, k0: view.k };
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };
  const onBoardMove = (e: React.PointerEvent) => {
    const cur = pinch.current;
    if (!cur || !cur.pts.has(e.pointerId)) return;
    const pts = new Map(cur.pts).set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = { ...cur, pts };
    if (pts.size === 2 && cur.d0) {
      const [a, b] = [...pts.values()];
      const r = box.current!.getBoundingClientRect();
      zoomAt(cur.k0 * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / cur.d0), (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
    }
  };
  const onBoardUp = (e: React.PointerEvent) => {
    const cur = pinch.current;
    if (!cur) return;
    const pts = new Map(cur.pts);
    pts.delete(e.pointerId);
    pinch.current = pts.size ? { ...cur, pts } : null;
  };

  const startMove = (e: React.PointerEvent, n: WNode) => {
    e.stopPropagation();
    e.preventDefault(); // no text selection while dragging
    onSelect({ kind: "node", id: n.id });
    if (readOnly || (e.button !== 0 && e.pointerType === "mouse")) return;
    const p = world(e.clientX, e.clientY);
    setDrag({ kind: "move", id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false });
  };
  const startLink = (e: React.PointerEvent, n: WNode) => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly) return;
    setDrag({ kind: "link", from: n.id, at: world(e.clientX, e.clientY) });
  };

  // Library items dragged in from the palette.
  const onDragOver = (e: React.DragEvent) => {
    if (!readOnly && e.dataTransfer.types.includes("application/x-workflow-step")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const key = e.dataTransfer.getData("application/x-workflow-step");
    if (!key || readOnly) return;
    e.preventDefault();
    const p = world(e.clientX, e.clientY);
    onDropItem?.(key, { x: snap(p.x - NODE_W / 2), y: snap(p.y - NODE_H / 2) });
  };

  const linkFrom = drag?.kind === "link" ? byId[drag.from] : null;
  const edgeColor = "color-mix(in oklab, var(--border) 45%, var(--text-muted))";
  const b = bounds(graph.nodes);
  const selEdge = selected?.kind === "edge" ? graph.edges.find((ed) => ed.id === selected.id) : null;

  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40", fill ? "h-full" : "h-[clamp(22rem,62dvh,44rem)]", className)}>
      <div
        ref={box}
        role="application"
        aria-label="Workflow board"
        onPointerDown={onBoardDown}
        onPointerMove={onBoardMove}
        onPointerUp={onBoardUp}
        onPointerCancel={onBoardUp}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={cn("absolute inset-0 touch-none select-none", drag?.kind === "pan" && drag.moved ? "cursor-grabbing" : "cursor-grab")}
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklab, var(--border) 85%, var(--text-muted)) 1px, transparent 1px)",
          backgroundSize: `${GRID * view.k}px ${GRID * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1}>
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor} />
              </marker>
              <marker id="wf-arrow-on" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
              </marker>
            </defs>
            {graph.edges.map((ed) => {
              const a = byId[ed.from];
              const z = byId[ed.to];
              if (!a || !z) return null;
              const on = (selected?.kind === "edge" && selected.id === ed.id) || !!taken?.has(ed.id);
              const fromNote = a.type === "note" || z.type === "note";
              return (
                <g key={ed.id}>
                  <path d={pathOf(a, z)} fill="none" stroke={on ? "var(--accent)" : edgeColor} strokeWidth={on ? 2.5 : 1.75}
                    strokeDasharray={fromNote ? "5 5" : undefined} markerEnd={`url(#${on ? "wf-arrow-on" : "wf-arrow"})`} />
                  <path d={pathOf(a, z)} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: "edge", id: ed.id }); }} />
                </g>
              );
            })}
            {linkFrom && drag?.kind === "link" ? (
              <path d={`M ${linkFrom.x + width(linkFrom) / 2} ${linkFrom.y + NODE_H} C ${linkFrom.x + width(linkFrom) / 2} ${linkFrom.y + NODE_H + 60}, ${drag.at.x} ${drag.at.y - 60}, ${drag.at.x} ${drag.at.y}`}
                fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 5" />
            ) : null}
          </svg>

          {/* Branch labels, as pills you can click */}
          {graph.edges.map((ed) => {
            const a = byId[ed.from];
            const z = byId[ed.to];
            if (!a || !z || !ed.label) return null;
            const m = midOf(a, z);
            const on = selected?.kind === "edge" && selected.id === ed.id;
            return (
              <button key={`l-${ed.id}`} type="button" onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: "edge", id: ed.id }); }}
                className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap shadow-sm",
                  on || taken?.has(ed.id) ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg")}
                style={{ left: m.x, top: m.y }}>
                {ed.label}
              </button>
            );
          })}

          {graph.nodes.map((n) => {
            const on = selected?.kind === "node" && selected.id === n.id;
            const run = status?.[n.id];
            const item = itemFor(n);
            const sub = subtitle(n, n.agent_id ? agentNames?.[n.agent_id] : null);
            const linking = drag?.kind === "link";
            const target = linking && hoverNode === n.id && hoverNode !== drag.from;
            if (n.type === "note") {
              return (
                <div key={n.id} data-node={n.id} onPointerDown={(e) => startMove(e, n)}
                  className={cn("absolute rounded-[var(--radius-sm)] border bg-[color-mix(in_oklab,var(--warn)_12%,var(--surface))] px-3 py-2.5 shadow-[var(--shadow-soft)]",
                    on ? "border-warn ring-2 ring-warn/30" : "border-warn/30", readOnly ? "cursor-pointer" : "cursor-grab touch-none active:cursor-grabbing")}
                  style={{ left: n.x, top: n.y, width: NOTE_W, minHeight: NODE_H }}>
                  <p className="text-[12.5px] font-semibold break-words">{n.title || "Note"}</p>
                  {n.body ? <p className="mt-0.5 text-[12px] leading-snug break-words whitespace-pre-wrap text-muted">{n.body}</p> : null}
                </div>
              );
            }
            return (
              <div key={n.id} data-node={n.id} onPointerDown={(e) => startMove(e, n)}
                className={cn(
                  "group absolute flex items-start gap-2.5 rounded-[var(--radius-md)] border bg-surface p-2.5 pr-3 shadow-[var(--shadow-soft)] transition-[box-shadow,border-color]",
                  run && RUN_LOOK[run] ? RUN_LOOK[run] : on ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/40",
                  target && "ring-2 ring-accent",
                  readOnly ? "cursor-pointer" : "cursor-grab touch-none active:cursor-grabbing",
                )}
                style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H }}>
                <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: TONE_VAR[item.tone] }} />
                <IconTile icon={item.icon} tone={item.tone} size="sm" className="mt-0.5" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-[10.5px] font-semibold tracking-[0.05em] text-muted uppercase">{item.label}</span>
                  <span className="line-clamp-2 text-[13px] leading-snug font-medium break-words" title={n.title}>{n.title || item.label}</span>
                  {sub ? <span className="truncate text-[11.5px] text-muted">{sub}</span> : null}
                </div>
                {run && RUN_DOT[run] ? <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", RUN_DOT[run])} aria-label={run} /> : null}
                {issues?.has(n.id) && !run ? <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-label="Needs attention" /> : null}
                {/* ports */}
                {n.type !== "start" ? <span aria-hidden className="absolute -top-[5px] left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-surface bg-border" /> : null}
                {!readOnly && n.type !== "end" ? (
                  <button aria-label={`Connect ${n.title || item.label} to the next step`} onPointerDown={(e) => startLink(e, n)}
                    className="absolute -bottom-[9px] left-1/2 grid size-[18px] -translate-x-1/2 touch-none place-items-center rounded-full border-2 border-surface bg-accent text-accent-fg opacity-80 shadow transition-transform group-hover:scale-125 group-hover:opacity-100 before:absolute before:-inset-3 before:content-['']">
                    <PlusIcon size={10} weight="bold" />
                  </button>
                ) : null}
              </div>
            );
          })}

          {/* A selected connection: insert a step in it, or remove it */}
          {selEdge && !readOnly && byId[selEdge.from] && byId[selEdge.to] ? (() => {
            const m = midOf(byId[selEdge.from]!, byId[selEdge.to]!);
            return (
              <div className="absolute flex -translate-x-1/2 translate-y-3 gap-1" style={{ left: m.x, top: m.y }} onPointerDown={(e) => e.stopPropagation()}>
                {onInsertOnEdge ? (
                  <button type="button" onClick={() => onInsertOnEdge(selEdge, m)} className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-[12px] font-medium shadow-[var(--shadow-soft)] hover:border-accent hover:text-accent">
                    <PlusIcon size={12} weight="bold" /> Insert step
                  </button>
                ) : null}
                <button type="button" aria-label="Remove connection" onClick={() => { onBeginChange?.(); onChange({ ...graph, edges: graph.edges.filter((x) => x.id !== selEdge.id) }); onSelect(null); }}
                  className="grid size-8 place-items-center rounded-full border border-border bg-surface shadow-[var(--shadow-soft)] hover:border-danger hover:text-danger">
                  <TrashIcon size={13} />
                </button>
              </div>
            );
          })() : null}
        </div>
      </div>

      {!graph.nodes.length && empty ? <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">{empty}</div> : null}

      {/* zoom controls */}
      <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface/95 p-0.5 shadow-[var(--shadow-soft)] backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <CtlButton label="Zoom out" onClick={() => zoomAt(view.k / 1.2, size.w / 2, size.h / 2)}><MinusIcon size={14} /></CtlButton>
        <button type="button" onClick={() => zoomAt(1, size.w / 2, size.h / 2)} className="h-8 min-w-12 rounded-sm px-1 text-[12px] font-medium tabular text-muted hover:bg-surface-2 hover:text-fg" title="Reset to 100%">
          {Math.round(view.k * 100)}%
        </button>
        <CtlButton label="Zoom in" onClick={() => zoomAt(view.k * 1.2, size.w / 2, size.h / 2)}><PlusIcon size={14} /></CtlButton>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <CtlButton label="Fit to screen" onClick={fit}><CornersOutIcon size={15} /></CtlButton>
        <CtlButton label={mini ? "Hide map" : "Show map"} onClick={() => setMini((m) => !m)} active={mini}><MapTrifoldIcon size={15} /></CtlButton>
      </div>

      {/* minimap */}
      {mini && graph.nodes.length > 1 && size.w > 520 ? (
        <Minimap nodes={graph.nodes} view={view} size={size} bounds={b} status={status}
          onCenter={(p) => setView((v) => ({ ...v, x: size.w / 2 - p.x * v.k, y: size.h / 2 - p.y * v.k }))} />
      ) : null}
      {readOnly && graph.nodes.length ? (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface/90 px-2 py-0.5 text-[11px] text-muted backdrop-blur">
          <ArrowsInIcon size={11} /> Drag to pan · pinch or Ctrl+scroll to zoom
        </span>
      ) : null}
    </div>
  );
}

function CtlButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn("grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg", active && "text-accent")}>
      {children}
    </button>
  );
}

function Minimap({ nodes, view, size, bounds: b, status, onCenter }: {
  nodes: WNode[]; view: View; size: { w: number; h: number }; bounds: { x: number; y: number; w: number; h: number };
  status?: Record<string, StepStatus>; onCenter: (p: Pt) => void;
}) {
  const W = 176;
  const H = 112;
  const pad = 40;
  const s = Math.min(W / (b.w + pad * 2), H / (b.h + pad * 2));
  const ox = (W - (b.w + pad * 2) * s) / 2 - (b.x - pad) * s;
  const oy = (H - (b.h + pad * 2) * s) / 2 - (b.y - pad) * s;
  const vx = (-view.x / view.k) * s + ox;
  const vy = (-view.y / view.k) * s + oy;
  const center = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onCenter({ x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s });
  };
  return (
    <svg width={W} height={H} onPointerDown={(e) => { e.stopPropagation(); center(e); }}
      className="absolute right-3 bottom-3 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-surface/95 shadow-[var(--shadow-soft)] backdrop-blur" aria-label="Map of the workflow">
      {nodes.map((n) => {
        const it = itemFor(n);
        const st = status?.[n.id];
        const fillC = st === "done" ? "var(--ok)" : st === "failed" ? "var(--danger)" : st && ["waiting", "review", "blocked"].includes(st) ? "var(--warn)" : TONE_VAR[it.tone];
        return <rect key={n.id} x={n.x * s + ox} y={n.y * s + oy} width={Math.max(3, width(n) * s)} height={Math.max(2, NODE_H * s)} rx={2} fill={fillC} opacity={0.75} />;
      })}
      <rect x={vx} y={vy} width={(size.w / view.k) * s} height={(size.h / view.k) * s} fill="var(--accent)" fillOpacity={0.06} stroke="var(--accent)" strokeWidth={1.25} rx={3} />
    </svg>
  );
}
