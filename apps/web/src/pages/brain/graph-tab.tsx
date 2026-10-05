import { GraphIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { graphQuery, KIND_INFO, type GraphData, type PageKind } from "@/lib/brain";

type Node = GraphData["nodes"][number] & SimulationNodeDatum;
type Edge = SimulationLinkDatum<Node>;

const radius = (n: Node) => 5 + Math.min(9, Math.sqrt(n.degree) * 2.4);

/** Resolve a CSS variable (series colours differ per theme). */
function cssColor(el: Element, value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m?.[1] ? getComputedStyle(el).getPropertyValue(m[1]).trim() || "#888" : value;
}

export function GraphTab({ onOpenPage }: { onOpenPage: (path: string) => void }) {
  const t = useT();
  const { data, isLoading, error } = useQuery(graphQuery);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);
  const nodesRef = useRef<Node[]>([]);

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodes: Node[] = data.nodes.map((n) => ({ ...n }));
    const edges: Edge[] = data.edges.map((e) => ({ source: e.source, target: e.target }));
    nodesRef.current = nodes;
    const labelAll = nodes.length <= 24;

    const draw = () => {
      const root = document.documentElement;
      const surface = cssColor(root, "var(--surface)");
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.lineWidth = 1;
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
        ctx.lineWidth = 2; // surface ring so overlapping dots stay distinct
        ctx.strokeStyle = surface;
        ctx.stroke();
      }
      ctx.font = "500 11.5px Geist Variable, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of nodes) {
        if (!labelAll && n.degree < 2) continue;
        const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
        const y = (n.y ?? 0) + radius(n) + 3;
        ctx.lineWidth = 3;
        ctx.strokeStyle = surface;
        ctx.strokeText(label, n.x ?? 0, y);
        ctx.fillStyle = cssColor(root, "var(--text-muted)");
        ctx.fillText(label, n.x ?? 0, y);
      }
    };

    // Spread to the canvas: fewer nodes get longer links, and labels get room to breathe.
    const spread = Math.min(size.w, size.h) / Math.sqrt(Math.max(4, nodes.length));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<Node, Edge>(edges).id((d) => d.id).distance(Math.max(80, spread * 0.9)).strength(0.5))
      .force("charge", forceManyBody().strength(-Math.max(260, spread * 4)))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("x", forceX(size.w / 2).strength(0.03))
      .force("y", forceY(size.h / 2).strength(0.05))
      .force("collide", forceCollide<Node>((n) => radius(n) + 26));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      sim.stop();
      sim.tick(300);
      draw();
    } else {
      sim.on("tick", draw);
    }
    // Keep everything inside the canvas.
    sim.on("tick.bounds", () => {
      for (const n of nodes) {
        const r = radius(n) + 2;
        n.x = Math.max(r, Math.min(size.w - r, n.x ?? 0));
        n.y = Math.max(r, Math.min(size.h - r - 14, n.y ?? 0));
      }
    });
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      sim.stop();
      theme.disconnect();
    };
  }, [data, size]);

  const hitTest = (clientX: number, clientY: number): { node: Node; x: number; y: number } | null => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      const d = Math.hypot((n.x ?? 0) - x, (n.y ?? 0) - y);
      if (d < radius(n) + 8 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best ? { node: best, x, y } : null;
  };

  const legend = useMemo(() => {
    const counts = new Map<PageKind, number>();
    for (const n of data?.nodes ?? []) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return [...counts.entries()];
  }, [data]);

  if (isLoading) return <Skeleton className="h-[min(64dvh,40rem)] min-h-80 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.edges.length) {
    return <EmptyState icon={GraphIcon} title={t("No links yet")} body={t("The graph shows how pages link to each other with [[page-name]]. It fills in as agents and people write linked pages.")} />;
  }

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
        <p className="text-[12.5px] text-muted tabular">{t("{pages} pages · {links} links · pick a dot to open it", { pages: data.nodes.length, links: data.edges.length })}</p>
      </div>
      <div ref={wrap} className="relative h-[min(64dvh,40rem)] min-h-80 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]"
        style={{ backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h }}
          className="block cursor-pointer touch-manipulation"
          role="img"
          aria-label={t("Graph of {pages} pages and {links} links. The Pages tab lists the same pages.", { pages: data.nodes.length, links: data.edges.length })}
          onPointerMove={(e) => setHover(hitTest(e.clientX, e.clientY))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const h = hitTest(e.clientX, e.clientY);
            if (h) onOpenPage(h.node.path);
          }}
        />
        {hover ? (
          <div className="pointer-events-none absolute z-10 max-w-64 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[12.5px] shadow-[var(--shadow-pop)]"
            style={{ left: Math.max(4, Math.min(hover.x + 12, size.w - 200)), top: Math.max(hover.y - 44, 4) }}>
            <p className="font-medium break-words">{hover.node.title}</p>
            <p className="truncate font-mono text-[11px] text-muted">{hover.node.path}</p>
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
