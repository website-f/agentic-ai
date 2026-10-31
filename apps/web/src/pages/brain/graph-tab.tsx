import { CornersOutIcon, GraphIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { graphQuery, KIND_INFO, type GraphData, type GraphKind } from "@/lib/brain";

type Node = GraphData["nodes"][number] & SimulationNodeDatum;
type Edge = SimulationLinkDatum<Node>;

const radius = (n: Node) => 5 + Math.min(9, Math.sqrt(n.degree) * 2.4);

/** Resolve a CSS variable (series colours differ per theme). */
function cssColor(el: Element, value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m?.[1] ? getComputedStyle(el).getPropertyValue(m[1]).trim() || "#888" : value;
}

/** The view of the infinite canvas: world point p is drawn at p * k + (x, y). */
interface View { k: number; x: number; y: number }
const MIN_K = 0.2;
const MAX_K = 4;
const DRAG_PX = 4; // moved less than this: a click, not a drag

export function GraphTab({ onOpenPage }: { onOpenPage: (path: string) => void }) {
  const t = useT();
  const { data, isLoading, error } = useQuery(graphQuery);
  const navigate = useNavigate();
  // P56: an agent opens its profile, a fact the Facts tab; a page opens as before.
  const open = (n: Node) => {
    if (n.kind === "agent_node" && n.agent_id) void navigate({ to: "/agents/$agentId", params: { agentId: n.agent_id } });
    else if (n.kind === "fact") void navigate({ to: "/brain", search: { tab: "facts" } as never });
    else onOpenPage(n.path);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const nodesRef = useRef<Node[]>([]);
  // P56: pan, zoom and drag. The view and the drawing live in refs so a gesture never
  // re-renders React; `redraw` and `sim` are set by the drawing effect.
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const redraw = useRef<() => void>(() => {});
  const sim = useRef<Simulation<Node, Edge> | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "node" | "pinch"; node?: Node; startX: number; startY: number; moved: boolean; dist?: number; k?: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data || !size.w || !size.h) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;

    const nodes: Node[] = data.nodes.map((n) => ({ ...n }));
    const edges: Edge[] = data.edges.map((e) => ({ source: e.source, target: e.target }));
    nodesRef.current = nodes;
    const labelAll = nodes.length <= 24;

    const draw = () => {
      const { k, x, y } = view.current;
      const root = document.documentElement;
      const surface = cssColor(root, "var(--surface)");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = cssColor(root, "var(--border)");
      ctx.beginPath();
      for (const e of edges) {
        const s = e.source as Node;
        const d = e.target as Node;
        ctx.moveTo(s.x ?? 0, s.y ?? 0);
        ctx.lineTo(d.x ?? 0, d.y ?? 0);
      }
      ctx.stroke();
      for (const n of nodes) {
        const r = radius(n);
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
        ctx.fillStyle = cssColor(root, KIND_INFO[n.kind].color);
        ctx.fill();
        ctx.lineWidth = 2 / k; // surface ring so overlapping dots stay distinct
        ctx.strokeStyle = surface;
        ctx.stroke();
      }
      // Labels keep their size on screen; zoomed in, every dot gets one.
      ctx.font = `500 ${11.5 / k}px Geist Variable, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const every = labelAll || k >= 1.4;
      for (const n of nodes) {
        if (!every && n.degree < 2) continue;
        const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
        const ly = (n.y ?? 0) + radius(n) + 3 / k;
        ctx.lineWidth = 3 / k;
        ctx.strokeStyle = surface;
        ctx.strokeText(label, n.x ?? 0, ly);
        ctx.fillStyle = cssColor(root, "var(--text-muted)");
        ctx.fillText(label, n.x ?? 0, ly);
      }
    };
    redraw.current = draw;

    // Spread to the canvas: fewer nodes get longer links, and labels get room to breathe.
    const spread = Math.min(size.w, size.h) / Math.sqrt(Math.max(4, nodes.length));
    const s = forceSimulation(nodes)
      .force("link", forceLink<Node, Edge>(edges).id((d) => d.id).distance(Math.max(80, spread * 0.9)).strength(0.5))
      .force("charge", forceManyBody().strength(-Math.max(260, spread * 4)))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("x", forceX(size.w / 2).strength(0.03))
      .force("y", forceY(size.h / 2).strength(0.05))
      .force("collide", forceCollide<Node>((n) => radius(n) + 26));
    sim.current = s;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      s.stop();
      s.tick(300);
      draw();
    } else {
      s.on("tick", draw);
    }
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      s.stop();
      sim.current = null;
      theme.disconnect();
    };
  }, [data, size]);

  // Wheel zoom around the pointer (a listener of its own: React's is passive and cannot
  // stop the page from scrolling while you zoom).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt only reads refs
  }, [data, size.w > 0]);

  function zoomAt(sx: number, sy: number, factor: number) {
    const v = view.current;
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
    // Keep the world point under (sx, sy) where it is.
    view.current = { k, x: sx - ((sx - v.x) * k) / v.k, y: sy - ((sy - v.y) * k) / v.k };
    setZoom(k);
    redraw.current();
  }

  /** Fit every dot in view (and the start view). */
  function fit() {
    const nodes = nodesRef.current;
    if (!nodes.length || !size.w) return;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 50;
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(size.w / (maxX - minX), size.h / (maxY - minY), 1.5)));
    view.current = { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k };
    setZoom(k);
    redraw.current();
  }

  const local = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    return { sx: clientX - (rect?.left ?? 0), sy: clientY - (rect?.top ?? 0) };
  };

  const hitTest = (clientX: number, clientY: number): { node: Node; x: number; y: number } | null => {
    const { sx, sy } = local(clientX, clientY);
    const { k, x: vx, y: vy } = view.current;
    const wx = (sx - vx) / k;
    const wy = (sy - vy) / k;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      const d = Math.hypot((n.x ?? 0) - wx, (n.y ?? 0) - wy);
      if (d < radius(n) + 8 / k && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best ? { node: best, x: sx, y: sy } : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", startX: 0, startY: 0, moved: true, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: view.current.k };
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    gesture.current = hit
      ? { kind: "node", node: hit.node, startX: e.clientX, startY: e.clientY, moved: false }
      : { kind: "pan", startX: e.clientX, startY: e.clientY, moved: false };
    setHover(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const last = pointers.current.get(e.pointerId);
    if (!g || !last) {
      setHover(hitTest(e.clientX, e.clientY));
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = local((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      zoomAt(mid.sx, mid.sy, ((g.k ?? 1) * (d / (g.dist || d))) / view.current.k);
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_PX) return;
    g.moved = true;
    if (g.kind === "pan") {
      view.current = { ...view.current, x: view.current.x + e.clientX - last.x, y: view.current.y + e.clientY - last.y };
      redraw.current();
    } else if (g.node) {
      const { sx, sy } = local(e.clientX, e.clientY);
      const { k, x, y } = view.current;
      g.node.fx = (sx - x) / k;
      g.node.fy = (sy - y) / k;
      sim.current?.alphaTarget(0.25).restart();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) return; // the other finger of a pinch is still down
    gesture.current = null;
    if (!g) return;
    if (g.kind === "node" && g.node) {
      if (!g.moved) open(g.node);
      g.node.fx = null; // let it settle where it was dropped, among its links
      g.node.fy = null;
      sim.current?.alphaTarget(0);
    }
  };

  const legend = useMemo(() => {
    const counts = new Map<GraphKind, number>();
    for (const n of data?.nodes ?? []) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return [...counts.entries()];
  }, [data]);

  if (isLoading) return <Skeleton className="h-[min(64dvh,40rem)] min-h-80 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.nodes.length) {
    return <EmptyState icon={GraphIcon} title={t("Nothing learned yet")} body={t("The graph shows what your agents learned and how wiki pages link together. It fills in as they work.")} />;
  }

  const tool = "grid size-9 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg";
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul aria-label={t("Legend")} className="flex flex-wrap gap-1.5">
          {legend.map(([kind, n]) => (
            <li key={kind} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12px] text-muted">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: KIND_INFO[kind].color }} />
              {t(KIND_INFO[kind].label)} <span className="font-medium text-fg tabular">{n}</span>
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] text-muted">{t("Drag to move around, scroll or pinch to zoom, drag a dot to move it, tap a dot to open it.")}</p>
      </div>
      <div ref={wrap} className="relative h-[min(70dvh,44rem)] min-h-80 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]"
        style={{ backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h }}
          className={cn("block touch-none select-none", gesture.current?.kind === "pan" ? "cursor-grabbing" : hover ? "cursor-pointer" : "cursor-grab")}
          role="img"
          aria-label={t("Graph of {pages} pages and {links} links. The Pages tab lists the same pages.", { pages: data.nodes.length, links: data.edges.length })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => { if (!gesture.current) setHover(null); }}
        />
        <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface/95 shadow-[var(--shadow-soft)] backdrop-blur">
          <button type="button" className={tool} aria-label={t("Zoom in")} title={t("Zoom in")} onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)}><PlusIcon size={16} /></button>
          <button type="button" className={tool} aria-label={t("Zoom out")} title={t("Zoom out")} onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)}><MinusIcon size={16} /></button>
          <button type="button" className={cn(tool, "border-t border-border")} aria-label={t("Fit everything")} title={t("Fit everything")} onClick={fit}><CornersOutIcon size={16} /></button>
        </div>
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-surface/90 px-1.5 py-0.5 text-[11px] text-muted tabular">{Math.round(zoom * 100)}%</span>
        {hover ? (
          <div className="pointer-events-none absolute z-10 max-w-64 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12.5px] shadow-[var(--shadow-pop)]"
            style={{ left: Math.max(4, Math.min(hover.x + 12, size.w - 200)), top: Math.max(hover.y - 44, 4) }}>
            <p className="font-medium break-words">{hover.node.title}</p>
            {hover.node.path ? <p className="truncate font-mono text-[11px] text-muted">{hover.node.path}</p> : <p className="text-[11px] text-muted">{t(KIND_INFO[hover.node.kind].label)}</p>}
            <p className="text-muted">{hover.node.degree === 1 ? t("1 link · click to open") : t("{n} links · click to open", { n: hover.node.degree })}</p>
          </div>
        ) : null}
      </div>
      {data.unresolved.length ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3.5 py-2.5 text-[12.5px] break-words text-muted">
          <span className="font-medium text-fg">{t("Linked but not written yet:")}</span> {data.unresolved.length > 12 ? t("{list} and {n} more.", { list: data.unresolved.slice(0, 12).join(", "), n: data.unresolved.length - 12 }) : `${data.unresolved.join(", ")}.`}
        </p>
      ) : null}
    </div>
  );
}
