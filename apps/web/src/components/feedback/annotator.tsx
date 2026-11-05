/** P73: the screenshot, full screen, to draw on: circle (the default, a tap drops one), box,
 * arrow and free pen, in four colours, each mark numbered so a note can say what it means.
 * Then a kind (not working, hard to use, not needed, idea...) and a note, and send. The marks
 * are burnt into the picture the developer sees. */
import {
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CircleIcon,
  MonitorIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  SquareIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { msg, useT } from "@/i18n";
import { CATEGORIES, type FeedbackCategory } from "@/lib/feedback";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

export type Tool = "circle" | "box" | "arrow" | "pen";

export interface Shot {
  canvas: HTMLCanvasElement;
  /** The picture's size in CSS pixels (the canvas is that x scale). */
  width: number;
  height: number;
  scale: number;
  url: string;
  via: "page" | "screen";
}

export interface Mark {
  id: number;
  tool: Tool;
  color: string;
  pts: [number, number][];
  note: string;
}

const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#22c55e"];
const TOOLS: { tool: Tool; icon: typeof CircleIcon; label: string }[] = [
  { tool: "circle", icon: CircleIcon, label: msg("Circle") },
  { tool: "box", icon: SquareIcon, label: msg("Box") },
  { tool: "arrow", icon: ArrowUpRightIcon, label: msg("Arrow") },
  { tool: "pen", icon: PencilSimpleIcon, label: msg("Pen") },
];

function strokeOf(width: number): number {
  return Math.max(3, Math.round(width / 320));
}

function bounds(m: Mark) {
  const xs = m.pts.map((p) => p[0]);
  const ys = m.pts.map((p) => p[1]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** Where a mark's number sits: the top-left of what it covers (an arrow: its tail). */
function badgeAt(m: Mark, sw: number): [number, number] {
  if (m.tool === "arrow") return m.pts[0]!;
  const b = bounds(m);
  if (m.tool === "circle") {
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    return [cx - ((b.x2 - b.x1) / 2) * 0.72, cy - ((b.y2 - b.y1) / 2) * 0.72 - sw];
  }
  return [b.x1, b.y1];
}

function arrowHead(m: Mark, sw: number): string {
  const [x1, y1] = m.pts[0]!;
  const [x2, y2] = m.pts[m.pts.length - 1]!;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = sw * 4.2;
  const p = (ang: number) => `${x2 - len * Math.cos(a - ang)},${y2 - len * Math.sin(a - ang)}`;
  return `${x2},${y2} ${p(0.45)} ${p(-0.45)}`;
}

function MarkSvg({ m, n, sw }: { m: Mark; n: number; sw: number }) {
  const b = bounds(m);
  const [bx, by] = badgeAt(m, sw);
  const r = sw * 2.6;
  return (
    <g>
      {m.tool === "circle" ? (
        <ellipse cx={(b.x1 + b.x2) / 2} cy={(b.y1 + b.y2) / 2} rx={Math.max(1, (b.x2 - b.x1) / 2)} ry={Math.max(1, (b.y2 - b.y1) / 2)} fill="none" stroke={m.color} strokeWidth={sw} />
      ) : m.tool === "box" ? (
        <rect x={b.x1} y={b.y1} width={Math.max(1, b.x2 - b.x1)} height={Math.max(1, b.y2 - b.y1)} rx={sw * 1.5} fill="none" stroke={m.color} strokeWidth={sw} />
      ) : m.tool === "arrow" ? (
        <>
          <line x1={m.pts[0]![0]} y1={m.pts[0]![1]} x2={m.pts[m.pts.length - 1]![0]} y2={m.pts[m.pts.length - 1]![1]} stroke={m.color} strokeWidth={sw} strokeLinecap="round" />
          <polygon points={arrowHead(m, sw)} fill={m.color} />
        </>
      ) : (
        <polyline points={m.pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={m.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <circle cx={bx} cy={by} r={r} fill={m.color} stroke="#fff" strokeWidth={sw * 0.5} />
      <text x={bx} y={by} dy="0.35em" textAnchor="middle" fontSize={r * 1.25} fontWeight={700} fill="#fff" fontFamily="system-ui, sans-serif">
        {n}
      </text>
    </g>
  );
}

/** The marks drawn into the picture itself (what is sent). */
function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], sw: number) {
  marks.forEach((m, i) => {
    const b = bounds(m);
    ctx.save();
    ctx.strokeStyle = m.color;
    ctx.fillStyle = m.color;
    ctx.lineWidth = sw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (m.tool === "circle") {
      ctx.ellipse((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, Math.max(1, (b.x2 - b.x1) / 2), Math.max(1, (b.y2 - b.y1) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.tool === "box") {
      ctx.roundRect(b.x1, b.y1, Math.max(1, b.x2 - b.x1), Math.max(1, b.y2 - b.y1), sw * 1.5);
      ctx.stroke();
    } else if (m.tool === "arrow") {
      const [x1, y1] = m.pts[0]!;
      const [x2, y2] = m.pts[m.pts.length - 1]!;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const pts = arrowHead(m, sw).split(" ").map((p) => p.split(",").map(Number));
      ctx.beginPath();
      ctx.moveTo(pts[0]![0]!, pts[0]![1]!);
      ctx.lineTo(pts[1]![0]!, pts[1]![1]!);
      ctx.lineTo(pts[2]![0]!, pts[2]![1]!);
      ctx.closePath();
      ctx.fill();
    } else {
      m.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    const [bx, by] = badgeAt(m, sw);
    const r = sw * 2.6;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = sw * 0.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${r * 1.25}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), bx, by + r * 0.05);
    ctx.restore();
  });
}

/** The picture with its marks, as a JPEG data URL small enough to send (6 MB at most). */
export function composeShot(shot: Shot, marks: Mark[]): string {
  const sw = strokeOf(shot.width);
  for (const [scale, quality] of [[shot.scale, 0.9], [shot.scale, 0.75], [1, 0.75], [1, 0.6]] as const) {
    const c = document.createElement("canvas");
    c.width = Math.round(shot.width * scale);
    c.height = Math.round(shot.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(shot.canvas, 0, 0, c.width, c.height);
    ctx.scale(scale, scale);
    drawMarks(ctx, marks, sw);
    const url = c.toDataURL("image/jpeg", quality);
    if (url.length < 7_800_000) return url;
  }
  throw new Error("The screenshot is too large to send.");
}

/** Notes per mark folded into the one note: "(1) …" lines under the general note. */
export function composeNote(note: string, marks: Mark[]): string {
  const lines = marks.map((m, i) => (m.note.trim() ? `(${i + 1}) ${m.note.trim()}` : "")).filter(Boolean);
  return [note.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

export function Annotator({
  shot,
  pageLabel,
  onCancel,
  onSend,
  onRetakeScreen,
  sending,
}: {
  shot: Shot;
  pageLabel: string;
  onCancel: () => void;
  onSend: (v: { category: FeedbackCategory; note: string; marks: Mark[] }) => void;
  /** The exact browser picture instead (desktop), when the copy missed something. */
  onRetakeScreen?: () => void;
  sending: boolean;
}) {
  const t = useT();
  const phone = useIsPhone();
  const [tool, setTool] = useState<Tool>("circle");
  const [color, setColor] = useState(COLORS[0]!);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [note, setNote] = useState("");
  // On a phone the note folds away at first, so the picture has room to be drawn on.
  const [panel, setPanel] = useState(!phone);
  const area = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const nextId = useRef(1);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const sw = strokeOf(shot.width);

  // The picture fills the space it has, keeping its shape.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / shot.width, r.height / shot.height);
      setFit({ w: Math.max(1, Math.floor(shot.width * s)), h: Math.max(1, Math.floor(shot.height * s)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot.width, shot.height]);

  const undo = useCallback(() => setMarks((m) => m.slice(0, -1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const at = (e: RPointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * shot.width;
    const y = ((e.clientY - r.top) / r.height) * shot.height;
    return [Math.max(0, Math.min(shot.width, x)), Math.max(0, Math.min(shot.height, y))];
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    setDraft({ id: nextId.current++, tool, color, pts: [p, p], note: "" });
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const p = at(e);
    setDraft((d) => (d ? { ...d, pts: d.tool === "pen" ? [...d.pts, p] : [d.pts[0]!, p] } : d));
  };
  const up = () => {
    if (!draft) return;
    const b = bounds(draft);
    const small = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) < (shot.width / Math.max(1, fit.w)) * 8;
    let done: Mark | null = draft;
    if (small) {
      // A tap: a circle around that spot. Other tools need a drag.
      if (draft.tool === "circle" || draft.tool === "box") {
        const [x, y] = draft.pts[0]!;
        const r = Math.max(24, shot.width / 30);
        done = { ...draft, pts: [[x - r, y - r * 0.8], [x + r, y + r * 0.8]] };
      } else done = null;
    }
    setDraft(null);
    if (done) setMarks((m) => [...m, done!]);
  };

  const send = () => onSend({ category: category ?? "other", note, marks });
  const canSend = !sending;

  const tools = (
    <div className="mx-auto flex w-max items-center gap-0.5 rounded-full border border-white/15 bg-neutral-900/85 p-1 text-white shadow-2xl backdrop-blur sm:gap-1">
      {TOOLS.map(({ tool: k, icon: I, label }) => (
        <button
          key={k}
          type="button"
          onClick={() => setTool(k)}
          aria-pressed={tool === k}
          title={t(label)}
          aria-label={t(label)}
          className={cn("grid size-8 place-items-center rounded-full transition-colors sm:size-9", tool === k ? "bg-white text-neutral-900" : "hover:bg-white/15")}
        >
          <I size={18} weight={tool === k ? "bold" : "regular"} />
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setColor(c)}
          aria-pressed={color === c}
          aria-label={t("Colour")}
          className={cn("grid size-7 place-items-center rounded-full transition-transform sm:size-8", color === c ? "scale-110" : "opacity-80 hover:opacity-100")}
        >
          <span className={cn("size-5 rounded-full ring-2", color === c ? "ring-white" : "ring-transparent")} style={{ background: c }} />
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
      <button type="button" onClick={undo} disabled={!marks.length} title={t("Undo")} aria-label={t("Undo")}
        className="grid size-8 place-items-center rounded-full hover:bg-white/15 disabled:opacity-35 sm:size-9">
        <ArrowCounterClockwiseIcon size={18} />
      </button>
      <button type="button" onClick={() => setMarks([])} disabled={!marks.length} title={t("Clear all marks")} aria-label={t("Clear all marks")}
        className="grid size-8 place-items-center rounded-full hover:bg-white/15 disabled:opacity-35 sm:size-9">
        <TrashIcon size={18} />
      </button>
    </div>
  );

  const form = (
    <div className="grid gap-4">
      <label className="grid gap-2">
        <span className="text-[12.5px] font-medium text-muted">{t("Your note")}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={phone ? 2 : 5}
          maxLength={3000}
          placeholder={t("For example: this button is not needed, or this page is hard to find your way around.")}
          className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[13.5px] outline-none focus:border-accent"
        />
      </label>
      <div className="grid gap-2">
        <p className="text-[12.5px] font-medium text-muted">{t("What is it about?")}</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.value} type="button" onClick={() => setCategory((v) => (v === c.value ? null : c.value))} aria-pressed={category === c.value} title={t(c.hint)}
              className={cn(
                "h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors pointer-coarse:h-9",
                category === c.value ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent/50 hover:bg-accent-soft",
              )}>
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>
      {marks.length ? (
        <div className="grid gap-2">
          <p className="text-[12.5px] font-medium text-muted">{t("Your marks")}</p>
          <ul className="grid gap-1.5">
            {marks.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold text-white" style={{ background: m.color }}>{i + 1}</span>
                <input
                  value={m.note}
                  onChange={(e) => setMarks((all) => all.map((x) => (x.id === m.id ? { ...x, note: e.target.value } : x)))}
                  placeholder={t("What about this one? (optional)")}
                  maxLength={300}
                  className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent pointer-coarse:h-10"
                />
                <button type="button" onClick={() => setMarks((all) => all.filter((x) => x.id !== m.id))} aria-label={t("Remove this mark")} title={t("Remove this mark")}
                  className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-danger">
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted">
          {t("Circle anything on the screen: tap for a quick circle, or drag. Each mark gets a number you can explain.")}
        </p>
      )}
    </div>
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-neutral-950/88 backdrop-blur-sm md:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2 md:px-5">
          <div className="min-w-0 text-white">
            <p className="truncate text-[13.5px] font-semibold">{t("Mark up this screen")}</p>
            <p className="truncate text-[12px] text-white/60">{pageLabel}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={t("Close")} title={t("Close")}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 md:hidden">
            <XIcon size={18} />
          </button>
        </div>
        <div className="flex shrink-0 overflow-x-auto px-3 pb-3 [scrollbar-width:none]">{tools}</div>
        <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3 md:px-6 md:pb-6">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
            className="relative overflow-hidden rounded-[var(--radius-sm)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)] ring-1 ring-white/15"
            style={{ width: fit.w, height: fit.h }}
          >
            <img src={shot.url} alt={t("Screenshot of {page}", { page: pageLabel })} draggable={false} className="absolute inset-0 size-full select-none" />
            <svg
              ref={svg}
              viewBox={`0 0 ${shot.width} ${shot.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full cursor-crosshair touch-none"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setDraft(null)}
            >
              {marks.map((m, i) => <MarkSvg key={m.id} m={m} n={i + 1} sw={sw} />)}
              {draft ? <MarkSvg m={draft} n={marks.length + 1} sw={sw} /> : null}
            </svg>
          </motion.div>
        </div>
      </div>

      <motion.aside
        initial={phone ? { y: 40, opacity: 0 } : { x: 40, opacity: 0 }}
        animate={{ x: 0, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.12 }}
        className={cn(
          "flex shrink-0 flex-col border-border bg-surface",
          phone ? "max-h-[52dvh] rounded-t-[var(--radius-lg)] border-t pb-[env(safe-area-inset-bottom)]" : "w-[24rem] border-l",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <button type="button" className="min-w-0 text-left" onClick={() => phone && setPanel((v) => !v)} aria-expanded={panel}>
            <p className="text-[14.5px] font-semibold">{t("Tell us what you see")}</p>
            <p className="text-[12px] text-muted">
              {marks.length === 1 ? t("1 mark on the screen") : marks.length ? t("{n} marks on the screen", { n: marks.length }) : t("Your screenshot is ready")}
              {phone && !panel ? ` · ${t("tap here to add a note")}` : ""}
            </p>
          </button>
          {phone ? null : (
            <button type="button" onClick={onCancel} aria-label={t("Close")} title={t("Close")} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
              <XIcon size={16} />
            </button>
          )}
        </div>
        {panel || !phone ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{form}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          {onRetakeScreen ? (
            <button type="button" onClick={onRetakeScreen} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg" title={t("Something missing in the picture? Let the browser take it instead.")}>
              <MonitorIcon size={14} /> {t("Exact screen capture")}
            </button>
          ) : <span />}
          <Button onClick={send} disabled={!canSend} loading={sending}>
            <PaperPlaneTiltIcon size={16} weight="bold" /> {t("Send feedback")}
          </Button>
        </div>
      </motion.aside>
    </div>
  );
}
