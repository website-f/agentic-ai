/** The workflow canvas: an infinite, zoomable board of step cards joined by arrows.
 *
 * Moving around works like n8n or a CAD tool (see lib/viewport): drag empty space, the middle
 * mouse button or Space + drag to pan; the mouse wheel zooms at the pointer (Shift + wheel
 * pans sideways, a trackpad's two-finger scroll pans, pinch zooms); + / - / 0 and Shift+1
 * zoom, reset and fit. On touch one finger pans with momentum, two fingers pinch, a
 * double tap zooms in, a tap selects and a long press picks a card up to move it.
 * Drag a card to move it (snaps to a 20px grid); Shift + drag on the board selects several.
 * Drag from a card's bottom dot to another card to connect them (or tap the dot, then tap
 * the card), or onto empty space to add the next step right there.
 * No graph library: DOM cards on a transformed layer, with an SVG layer for the arrows. */
import {
  ArrowsInIcon, CornersOutIcon, MapTrifoldIcon, MinusIcon, PlusIcon, TrashIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { IconTile } from "@/components/page";
import { cn } from "@/lib/utils";
import { createViewport, toWorld, type Camera, type Rect, type Viewport } from "@/lib/viewport";
import type { Graph, StepStatus, WEdge, WNode } from "@/lib/workflows";

import { itemFor, subtitle, TONE_VAR } from "./library";

export const NODE_W = 240;
export const NODE_H = 76;
const NOTE_W = 220;
const GRID = 20;
const LIMITS = { min: 0.1, max: 4 };
const VIEW_KEY = "agentic.wf.view.";

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

type Pt = { x: number; y: number };
type Sel = { kind: "node" | "edge"; id: string } | null;
type Drag =
  | { kind: "move"; id: string; pointerId: number; start: Pt; client: Pt; orig: Record<string, Pt>; click: boolean }
  | { kind: "link"; from: string; pointerId: number; client: Pt }
  | null;

const width = (n: WNode) => (n.type === "note" ? NOTE_W : NODE_W);
const snap = (v: number) => Math.round(v / GRID) * GRID;
/** Dots every 20px, thinned out (x5) when zoomed far out so the board never turns to noise. */
function gridStep(k: number) {
  let g = GRID * k;
  while (g < 12) g *= 5;
  return g;
}
/** Android Chrome nudges a tap onto the nearest element that listens for clicks (touch
 * adjustment); a card must listen itself, or taps on it slide onto its connect dot. */
const noop = () => {};
const tapTarget = (el: HTMLElement | null) => {
  if (!el) return;
  el.addEventListener("click", noop);
  return () => el.removeEventListener("click", noop);
};
const transformOf = (c: Camera) => `translate(${c.x}px, ${c.y}px) scale(${c.k})`;

function loadView(key?: string): Camera | null {
  if (!key) return null;
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY + key) ?? "null") as Camera | null;
    return v && [v.x, v.y, v.k].every((n) => typeof n === "number" && Number.isFinite(n)) && v.k > 0 ? v : null;
  } catch {
    return null;
  }
}

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
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + width(n));
    y1 = Math.max(y1, n.y + NODE_H);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function Canvas({
  graph, onChange, selected, onSelect, readOnly, status, taken, className,
  onBeginChange, onDropItem, onQuickAdd, onInsertOnEdge, issues, agentNames, fill, fitSignal, empty,
  viewKey, multi, onMulti,
}: {
  graph: Graph;
  onChange: (g: Graph) => void;
  selected: Sel;
  /** "press": picked up to drag (on phones the editor waits for a tap before opening the sheet). */
  onSelect: (s: Sel, how?: "press") => void;
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
  /** Remember the pan and zoom under this key for the browser session. */
  viewKey?: string;
  /** Several steps picked at once (Shift + drag on the board, Shift + click). */
  multi?: string[];
  onMulti?: (ids: string[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport | null>(null);
  const [saved] = useState(() => loadView(viewKey));
  const [view, setView] = useState<Camera>(() => saved ?? { x: 40, y: 40, k: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag>(null);
  const [linkAt, setLinkAt] = useState<Pt | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [mini, setMini] = useState(true);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const picked = useMemo(() => new Set(multi ?? []), [multi]);

  // The latest props, for handlers that live outside React's render (the viewport, window listeners).
  const latest = useRef({ graph, byId, onChange, onSelect, onBeginChange, onQuickAdd, onInsertOnEdge, onMulti, readOnly, selected, multi, armed, viewKey });
  useLayoutEffect(() => {
    latest.current = { graph, byId, onChange, onSelect, onBeginChange, onQuickAdd, onInsertOnEdge, onMulti, readOnly, selected, multi, armed, viewKey };
  });
  const hoverRef = useRef<string | null>(null);

  const world = useCallback((cx: number, cy: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    return toWorld(vp.current?.get() ?? { x: 0, y: 0, k: 1 }, { x: cx - r.left, y: cy - r.top });
  }, []);

  /** Join two steps (a decision's branches start labelled; people rename them). */
  const connect = useCallback((from: string, to: string) => {
    const { graph: g, byId: ids, onBeginChange: begin, onChange: change } = latest.current;
    const a = ids[from];
    const b = ids[to];
    if (!a || !b || from === to || b.type === "start" || b.type === "note" || a.type === "end" || a.type === "note") return false;
    if (g.edges.some((ed) => ed.from === from && ed.to === to)) return false;
    begin?.();
    const outs = g.edges.filter((ed) => ed.from === from).length;
    const label = a.type === "decision"
      ? a.action === "approval" ? (outs ? "rejected" : "approved") : outs === 0 ? "yes" : outs === 1 ? "no" : `option ${outs + 1}`
      : "";
    change({ ...g, edges: [...g.edges, { id: `e${Date.now().toString(36)}`, from, to, label }] });
    return true;
  }, []);

  // ------------------------------------------------ dragging a card or a connection

  // Listeners go on synchronously (not in an effect): a quick tap's pointerup can arrive
  // before React would have committed, and it must still end the drag.
  const detach = useRef<(() => void) | null>(null);
  useEffect(() => () => detach.current?.(), []);
  const startDrag = useCallback((drag: NonNullable<Drag>) => {
    detach.current?.();
    setDrag(drag);
    let frame = 0;
    let pending: PointerEvent | null = null;
    let moved = false;
    let delta = { x: 0, y: 0 };
    const process = () => {
      frame = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      const L = latest.current;
      if (drag.kind === "move") {
        if (!moved) {
          if (Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) < 3) return;
          moved = true;
          L.onBeginChange?.();
        }
        const p = world(e.clientX, e.clientY);
        const anchor = drag.orig[drag.id] ?? { x: 0, y: 0 };
        // Snap the card being dragged to 10px while moving (20px on drop); the rest follow it.
        delta = { x: Math.round((anchor.x + p.x - drag.start.x) / 10) * 10 - anchor.x, y: Math.round((anchor.y + p.y - drag.start.y) / 10) * 10 - anchor.y };
        L.onChange({ ...L.graph, nodes: L.graph.nodes.map((n) => (drag.orig[n.id] ? { ...n, x: drag.orig[n.id]!.x + delta.x, y: drag.orig[n.id]!.y + delta.y } : n)) });
      } else {
        if (!moved && Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) > 6) moved = true;
        setLinkAt(world(e.clientX, e.clientY));
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.node);
        const id = hit instanceof HTMLElement ? hit.dataset.node! : null;
        hoverRef.current = id;
        setHoverNode(id);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      pending = e;
      if (!frame) frame = requestAnimationFrame(process);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      cancelAnimationFrame(frame);
      if (pending) process();
      const L = latest.current;
      const cancelled = e.type === "pointercancel";
      if (drag.kind === "move" && moved) {
        const anchor = drag.orig[drag.id] ?? { x: 0, y: 0 };
        const d = { x: snap(anchor.x + delta.x) - anchor.x, y: snap(anchor.y + delta.y) - anchor.y };
        L.onChange({ ...L.graph, nodes: L.graph.nodes.map((n) => (drag.orig[n.id] ? { ...n, x: drag.orig[n.id]!.x + d.x, y: drag.orig[n.id]!.y + d.y } : n)) });
      } else if (drag.kind === "move" && drag.click && !cancelled && !L.multi?.includes(drag.id)) {
        L.onSelect({ kind: "node", id: drag.id }); // a click, not a drag: open it
      }
      if (drag.kind === "link" && !cancelled) {
        const to = hoverRef.current;
        if (to && to !== drag.from) connect(drag.from, to);
        else if (!moved) setArmed(drag.from); // a tap on the dot: now tap the step to connect
        else if (!to && L.onQuickAdd) {
          const r = box.current!.getBoundingClientRect();
          L.onQuickAdd(drag.from, world(e.clientX, e.clientY), { x: e.clientX - r.left, y: e.clientY - r.top });
        }
      }
      hoverRef.current = null;
      setHoverNode(null);
      setLinkAt(null);
      setDrag(null);
      stop();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (detach.current === stop) detach.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    detach.current = stop;
  }, [world, connect]);


  const beginMove = useCallback((pointerId: number, id: string, client: Pt, click = false) => {
    const { graph: g, multi: m } = latest.current;
    const ids = m?.includes(id) ? m : [id];
    const orig: Record<string, Pt> = {};
    for (const n of g.nodes) if (ids.includes(n.id)) orig[n.id] = { x: n.x, y: n.y };
    startDrag({ kind: "move", id, pointerId, start: world(client.x, client.y), client, orig, click });
  }, [world, startDrag]);

  // ------------------------------------------------ the viewport (pan, zoom, gestures)

  useLayoutEffect(() => {
    const el = box.current!;
    let saveTimer = 0;
    const paint = (c: Camera) => {
      // Straight to the DOM in the same frame; React catches up with setView for the rest.
      if (layer.current) layer.current.style.transform = transformOf(c);
      // Handles keep a usable size on screen when zoomed far out (CSS reads --wf-inv).
      layer.current?.style.setProperty("--wf-inv", String(1 / c.k));
      const g = gridStep(c.k);
      el.style.backgroundSize = `${g}px ${g}px`;
      el.style.backgroundPosition = `${c.x}px ${c.y}px`;
    };
    const v = createViewport(el, {
      initial: loadView(latest.current.viewKey) ?? { x: 40, y: 40, k: 1 },
      limits: LIMITS,
      onChange: (c) => {
        paint(c);
        setView(c);
        const key = latest.current.viewKey;
        if (key) {
          window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => {
            try { sessionStorage.setItem(VIEW_KEY + key, JSON.stringify(c)); } catch { /* storage blocked */ }
          }, 250);
        }
      },
      contentBounds: () => (latest.current.graph.nodes.length ? bounds(latest.current.graph.nodes) : null),
      fitOptions: { pad: 56, maxK: 1.1 },
      canNudge: () => !latest.current.selected,
      wheelCapture: fill ? "always" : "focus",
      onTap: ({ target, shiftKey }) => {
        const L = latest.current;
        const nodeEl = target.closest<HTMLElement>("[data-node]");
        const edgeEl = target.closest<Element>("[data-edge]");
        if (nodeEl?.dataset.node) {
          const id = nodeEl.dataset.node;
          if (L.armed) {
            connect(L.armed, id);
            setArmed(null);
            return;
          }
          L.onMulti?.([]);
          L.onSelect({ kind: "node", id });
          return;
        }
        if (edgeEl) {
          L.onSelect({ kind: "edge", id: edgeEl.getAttribute("data-edge")! });
          return;
        }
        if (L.armed) {
          setArmed(null);
          return;
        }
        if (!shiftKey) {
          L.onSelect(null);
          if (L.multi?.length) L.onMulti?.([]);
        }
      },
      // Touch: a long press on a card picks it up (so scrolling never drags cards by accident).
      onLongPress: (e, target) => {
        const id = target.closest<HTMLElement>("[data-node]")?.dataset.node;
        const L = latest.current;
        if (!id) return false;
        if (!L.multi?.includes(id)) {
          L.onMulti?.([]);
          L.onSelect({ kind: "node", id }, "press");
        }
        if (L.readOnly) return false;
        beginMove(e.pointerId, id, { x: e.clientX, y: e.clientY });
        return true;
      },
      onMarquee: !latest.current.onMulti || latest.current.readOnly ? undefined : (r, done) => {
        const L = latest.current;
        if (!L.onMulti) return;
        if (!done) {
          setMarquee(r);
          return;
        }
        setMarquee(null);
        if (!r) return;
        const c = v.get();
        const a = toWorld(c, { x: r.x, y: r.y });
        const b = toWorld(c, { x: r.x + r.w, y: r.y + r.h });
        const ids = L.graph.nodes.filter((n) => n.x < b.x && n.x + width(n) > a.x && n.y < b.y && n.y + NODE_H > a.y).map((n) => n.id);
        const all = [...new Set([...(L.multi ?? []), ...ids])];
        if (all.length === 1) {
          L.onMulti([]);
          L.onSelect({ kind: "node", id: all[0]! });
        } else {
          L.onSelect(null);
          L.onMulti(all);
        }
      },
    });
    vp.current = v;
    paint(v.get());
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => {
      window.clearTimeout(saveTimer);
      ro.disconnect();
      v.destroy();
      vp.current = null;
    };
    // One viewport for the canvas's lifetime; it reads the latest props through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fit = useCallback((animate = 0) => {
    const nodes = latest.current.graph.nodes;
    if (nodes.length) vp.current?.fit(bounds(nodes), { animate });
  }, []);

  // Fit once the first time the board has a size and steps (unless this session saved a view).
  const fitted = useRef(!!saved);
  useEffect(() => {
    if (!fitted.current && graph.nodes.length && size.w > 0 && size.h > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, graph.nodes.length, size.w, size.h]);
  useEffect(() => {
    if (fitSignal) {
      const t = requestAnimationFrame(() => fit(280));
      return () => cancelAnimationFrame(t);
    }
    // Only an explicit request re-fits; the graph changing must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Mouse and pen press a card directly; touch goes through the viewport (tap / long press / pan).
  const startMove = useCallback((e: React.PointerEvent, n: WNode) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // no text selection while dragging
    const L = latest.current;
    if (L.armed) {
      connect(L.armed, n.id);
      setArmed(null);
      return;
    }
    if (e.shiftKey && L.onMulti && !L.readOnly) {
      const cur = new Set(L.multi ?? []);
      if (L.selected?.kind === "node") cur.add(L.selected.id);
      if (cur.has(n.id)) cur.delete(n.id);
      else cur.add(n.id);
      L.onSelect(null);
      L.onMulti([...cur]);
      return;
    }
    if (!L.multi?.includes(n.id)) {
      if (L.multi?.length) L.onMulti?.([]);
      L.onSelect({ kind: "node", id: n.id }, L.readOnly ? undefined : "press");
    }
    if (L.readOnly) return;
    beginMove(e.pointerId, n.id, { x: e.clientX, y: e.clientY }, true);
  }, [beginMove, connect]);
  const startLink = useCallback((e: React.PointerEvent, n: WNode) => {
    e.stopPropagation();
    e.preventDefault();
    if (latest.current.readOnly) return;
    if (latest.current.armed === n.id) {
      setArmed(null);
      return;
    }
    setArmed(null);
    startDrag({ kind: "link", from: n.id, pointerId: e.pointerId, client: { x: e.clientX, y: e.clientY } });
    setLinkAt(world(e.clientX, e.clientY));
  }, [world, startDrag]);
  const pickEdge = useCallback((e: React.PointerEvent, id: string) => {
    if (e.pointerType === "touch") return; // a tap selects it (via the viewport); a drag pans
    e.stopPropagation();
    latest.current.onSelect({ kind: "edge", id });
  }, []);
  const insertOnEdge = useCallback((ed: WEdge, at: Pt) => latest.current.onInsertOnEdge?.(ed, at), []);
  const removeEdge = useCallback((id: string) => {
    const L = latest.current;
    L.onBeginChange?.();
    L.onChange({ ...L.graph, edges: L.graph.edges.filter((x) => x.id !== id) });
    L.onSelect(null);
  }, []);

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
  const b = bounds(graph.nodes);
  const g0 = gridStep(view.k);
  const center = { x: size.w / 2, y: size.h / 2 };

  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40", fill ? "h-full" : "h-[clamp(22rem,62dvh,44rem)]", className)}>
      <div
        ref={box}
        role="application"
        aria-label="Workflow board"
        aria-roledescription="canvas"
        tabIndex={0}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="absolute inset-0 cursor-grab touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset [-webkit-touch-callout:none]"
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklab, var(--border) 85%, var(--text-muted)) 1px, transparent 1px)",
          backgroundSize: `${g0}px ${g0}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div ref={layer} className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ transform: transformOf(view) }}>
          <BoardContent graph={graph} byId={byId} selected={selected} picked={picked} status={status} taken={taken} issues={issues}
            agentNames={agentNames} readOnly={readOnly} linkingFrom={drag?.kind === "link" ? drag.from : null} hoverNode={hoverNode} armed={armed}
            hasInsert={!!onInsertOnEdge} startMove={startMove} startLink={startLink} pickEdge={pickEdge} insertOnEdge={insertOnEdge} removeEdge={removeEdge} />
          {linkFrom && linkAt ? (
            <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1} aria-hidden>
              <path d={`M ${linkFrom.x + width(linkFrom) / 2} ${linkFrom.y + NODE_H} C ${linkFrom.x + width(linkFrom) / 2} ${linkFrom.y + NODE_H + 60}, ${linkAt.x} ${linkAt.y - 60}, ${linkAt.x} ${linkAt.y}`}
                fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : null}
        </div>
        {marquee ? (
          <div aria-hidden className="pointer-events-none absolute rounded-[3px] border border-accent bg-accent/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
        ) : null}
      </div>

      {!graph.nodes.length && empty ? <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">{empty}</div> : null}

      {armed ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
          <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-accent/40 bg-surface/95 py-1 pr-1 pl-3 text-[12.5px] shadow-[var(--shadow-soft)] backdrop-blur">
            Tap the step to connect to
            <button type="button" onClick={() => setArmed(null)} className="h-7 rounded-full px-2.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg">Cancel</button>
          </span>
        </div>
      ) : (multi?.length ?? 0) > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
          <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface/95 py-1 pr-1 pl-3 text-[12.5px] shadow-[var(--shadow-soft)] backdrop-blur">
            {multi!.length} steps selected <span className="text-muted max-sm:hidden">· drag one to move them all · Delete removes them</span>
            <button type="button" onClick={() => onMulti?.([])} className="h-7 rounded-full px-2.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg">Clear</button>
          </span>
        </div>
      ) : null}

      {/* zoom controls */}
      <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface/95 p-0.5 shadow-[var(--shadow-soft)] backdrop-blur">
        <CtlButton label="Zoom out (-)" onClick={() => vp.current?.zoomBy(1 / 1.25, center, 160)}><MinusIcon size={14} /></CtlButton>
        <button type="button" onClick={() => vp.current?.zoomTo(1, center, 180)} className="h-9 min-w-12 rounded-sm px-1 text-[12px] font-medium tabular text-muted hover:bg-surface-2 hover:text-fg" title="Reset to 100% (0)" aria-label={`Zoom ${Math.round(view.k * 100)}%. Reset to 100%`}>
          {Math.round(view.k * 100)}%
        </button>
        <CtlButton label="Zoom in (+)" onClick={() => vp.current?.zoomBy(1.25, center, 160)}><PlusIcon size={14} /></CtlButton>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <CtlButton label="Fit to screen (Shift+1)" onClick={() => fit(280)}><CornersOutIcon size={15} /></CtlButton>
        {size.w > 520 ? <CtlButton label={mini ? "Hide map" : "Show map"} onClick={() => setMini((m) => !m)} active={mini}><MapTrifoldIcon size={15} /></CtlButton> : null}
      </div>

      {/* minimap: click or drag to move the view */}
      {mini && graph.nodes.length > 1 && size.w > 520 ? (
        <Minimap nodes={graph.nodes} view={view} size={size} bounds={b} status={status}
          onCenter={(p, animate) => vp.current?.centerOn(p, { animate })} />
      ) : null}
      {readOnly && graph.nodes.length ? (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-full border border-border bg-surface/90 px-2 py-0.5 text-[11px] text-muted backdrop-blur max-sm:hidden">
          <ArrowsInIcon size={11} /> Drag to pan · pinch or Ctrl+scroll to zoom
        </span>
      ) : null}
    </div>
  );
}

/** The cards, arrows and labels. Memoised: panning and zooming only move the layer above it,
 * so a 50-step workflow does not re-render on every frame of a gesture. */
const BoardContent = memo(function BoardContent({
  graph, byId, selected, picked, status, taken, issues, agentNames, readOnly, linkingFrom, hoverNode, armed, hasInsert,
  startMove, startLink, pickEdge, insertOnEdge, removeEdge,
}: {
  graph: Graph; byId: Record<string, WNode>; selected: Sel; picked: Set<string>;
  status?: Record<string, StepStatus>; taken?: Set<string>; issues?: Set<string>; agentNames?: Record<string, string>;
  readOnly?: boolean; linkingFrom: string | null; hoverNode: string | null; armed: string | null; hasInsert: boolean;
  startMove: (e: React.PointerEvent, n: WNode) => void;
  startLink: (e: React.PointerEvent, n: WNode) => void;
  pickEdge: (e: React.PointerEvent, id: string) => void;
  insertOnEdge: (ed: WEdge, at: Pt) => void;
  removeEdge: (id: string) => void;
}) {
  const edgeColor = "color-mix(in oklab, var(--border) 45%, var(--text-muted))";
  const selEdge = selected?.kind === "edge" ? graph.edges.find((ed) => ed.id === selected.id) : null;
  const connecting = linkingFrom ?? armed;
  return (
    <>
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
          const d = pathOf(a, z);
          return (
            <g key={ed.id}>
              <path d={d} fill="none" stroke={on ? "var(--accent)" : edgeColor} strokeWidth={on ? 2.5 : 1.75}
                strokeDasharray={fromNote ? "5 5" : undefined} markerEnd={`url(#${on ? "wf-arrow-on" : "wf-arrow"})`} />
              <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer"
                data-vp="item" data-edge={ed.id} onPointerDown={(e) => pickEdge(e, ed.id)} />
            </g>
          );
        })}
      </svg>

      {/* Branch labels, as pills you can click */}
      {graph.edges.map((ed) => {
        const a = byId[ed.from];
        const z = byId[ed.to];
        if (!a || !z || !ed.label) return null;
        const m = midOf(a, z);
        const on = selected?.kind === "edge" && selected.id === ed.id;
        return (
          <button key={`l-${ed.id}`} type="button" data-vp="item" data-edge={ed.id} onPointerDown={(e) => pickEdge(e, ed.id)}
            className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap shadow-sm",
              on || taken?.has(ed.id) ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg")}
            style={{ left: m.x, top: m.y }}>
            {ed.label}
          </button>
        );
      })}

      {graph.nodes.map((n) => {
        const on = (selected?.kind === "node" && selected.id === n.id) || picked.has(n.id);
        const run = status?.[n.id];
        const item = itemFor(n);
        const sub = subtitle(n, n.agent_id ? agentNames?.[n.agent_id] : null);
        const target = !!connecting && connecting !== n.id && (hoverNode === n.id || (!!armed && n.type !== "start" && n.type !== "note"));
        if (n.type === "note") {
          return (
            <div key={n.id} ref={tapTarget} data-node={n.id} data-vp="item" onPointerDown={(e) => startMove(e, n)}
              className={cn("absolute rounded-[var(--radius-sm)] border bg-[color-mix(in_oklab,var(--warn)_12%,var(--surface))] px-3 py-2.5 shadow-[var(--shadow-soft)]",
                on ? "border-warn ring-2 ring-warn/30" : "border-warn/30", readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing")}
              style={{ left: n.x, top: n.y, width: NOTE_W, minHeight: NODE_H }}>
              <p className="text-[12.5px] font-semibold break-words">{n.title || "Note"}</p>
              {n.body ? <p className="mt-0.5 text-[12px] leading-snug break-words whitespace-pre-wrap text-muted">{n.body}</p> : null}
            </div>
          );
        }
        return (
          <div key={n.id} ref={tapTarget} data-node={n.id} data-vp="item" onPointerDown={(e) => startMove(e, n)}
            className={cn(
              "group absolute flex items-start gap-2.5 rounded-[var(--radius-md)] border bg-surface p-2.5 pr-3 shadow-[var(--shadow-soft)] transition-[box-shadow,border-color]",
              run && RUN_LOOK[run] ? RUN_LOOK[run] : on ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/40",
              target && (hoverNode === n.id ? "ring-2 ring-accent" : "ring-2 ring-accent/25"),
              readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
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
              // A span that is not focusable: Android Chrome's touch adjustment prefers focusable
              // elements inside a card, so a focusable dot would steal taps meant for the card.
              <span role="button" data-vp="ignore" aria-label={`Connect ${n.title || item.label} to the next step`} onPointerDown={(e) => startLink(e, n)}
                style={{ scale: `clamp(${armed === n.id ? 1.25 : 1}, calc(var(--wf-inv, 1) * 0.55), 2.6)` }}
                className={cn("absolute -bottom-[9px] left-1/2 grid size-[18px] origin-top -translate-x-1/2 touch-none place-items-center rounded-full border-2 border-surface bg-accent text-accent-fg shadow group-hover:opacity-100 before:absolute before:-inset-3 before:content-['']",
                  armed === n.id ? "opacity-100 ring-4 ring-accent/30" : "opacity-80")}>
                <PlusIcon size={10} weight="bold" />
              </span>
            ) : null}
          </div>
        );
      })}

      {/* A selected connection: insert a step in it, or remove it */}
      {selEdge && !readOnly && byId[selEdge.from] && byId[selEdge.to] ? (() => {
        const m = midOf(byId[selEdge.from]!, byId[selEdge.to]!);
        return (
          <div data-vp="ignore" className="absolute flex -translate-x-1/2 translate-y-3 gap-1" style={{ left: m.x, top: m.y }} onPointerDown={(e) => e.stopPropagation()}>
            {hasInsert ? (
              <button type="button" onClick={() => insertOnEdge(selEdge, m)} className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-[12px] font-medium shadow-[var(--shadow-soft)] hover:border-accent hover:text-accent">
                <PlusIcon size={12} weight="bold" /> Insert step
              </button>
            ) : null}
            <button type="button" aria-label="Remove connection" onClick={() => removeEdge(selEdge.id)}
              className="grid size-8 place-items-center rounded-full border border-border bg-surface shadow-[var(--shadow-soft)] hover:border-danger hover:text-danger">
              <TrashIcon size={13} />
            </button>
          </div>
        );
      })() : null}
    </>
  );
});

function CtlButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn("grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg", active && "text-accent")}>
      {children}
    </button>
  );
}

function Minimap({ nodes, view, size, bounds: b, status, onCenter }: {
  nodes: WNode[]; view: Camera; size: { w: number; h: number }; bounds: { x: number; y: number; w: number; h: number };
  status?: Record<string, StepStatus>; onCenter: (p: Pt, animate?: number) => void;
}) {
  const W = 176;
  const H = 112;
  const pad = 40;
  const s = Math.min(W / (b.w + pad * 2), H / (b.h + pad * 2));
  const ox = (W - (b.w + pad * 2) * s) / 2 - (b.x - pad) * s;
  const oy = (H - (b.h + pad * 2) * s) / 2 - (b.y - pad) * s;
  const vx = (-view.x / view.k) * s + ox;
  const vy = (-view.y / view.k) * s + oy;
  const dragging = useRef(false);
  const at = (e: React.PointerEvent<SVGSVGElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
  };
  const end = (e: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };
  return (
    <svg width={W} height={H} role="img"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        dragging.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        onCenter(at(e), 180);
      }}
      onPointerMove={(e) => { if (dragging.current) onCenter(at(e)); }}
      onPointerUp={end} onPointerCancel={end}
      className="absolute right-3 bottom-3 cursor-pointer touch-none rounded-[var(--radius-sm)] border border-border bg-surface/95 shadow-[var(--shadow-soft)] backdrop-blur active:cursor-grabbing" aria-label="Map of the workflow. Click or drag to move the view.">
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
