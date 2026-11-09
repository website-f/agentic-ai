/** P73: the screenshot, full screen, to draw on: circle (the default, a tap drops one), box,
 * arrow and free pen, in four colours, each mark numbered so a note can say what it means.
 * Then a kind (not working, hard to use, not needed, idea...) and a note, and send. The marks
 * are burnt into the picture the developer sees.
 * P93: on a phone it is one sheet that scrolls (picture, then the note), and a finger draws only
 * while marking: "Done, write a note" lets the picture scroll like the rest and goes to the note,
 * "Mark the picture" draws again. Send stays in a footer above the on-screen keyboard. */
import {
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CheckIcon,
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
import { useIsPhone, useMedia } from "@/lib/use-media";
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

/** P93: how big the picture is on a phone: the width it has, and at most the given height (never
 * under 200 px), keeping its shape. The height is the screen less the bars around the picture and
 * a strip of the note under it, so it is plain that the note is further down. */
export function phonePictureFit(shot: { width: number; height: number }, room: { width: number; height: number }): { w: number; h: number } {
  const s = Math.min(Math.max(1, room.width) / shot.width, Math.max(200, room.height) / shot.height);
  return { w: Math.max(1, Math.floor(shot.width * s)), h: Math.max(1, Math.floor(shot.height * s)) };
}

// Below the picture on a phone this much of the note shows before any scrolling.
const NOTE_PEEK = 76;

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
  const finger = useMedia("(pointer: coarse)"); // a touch screen: one colour button, so the tools fit
  const [tool, setTool] = useState<Tool>("circle");
  const [color, setColor] = useState(COLORS[0]!);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [note, setNote] = useState("");
  // P93: on a phone a finger on the picture draws only while marking; otherwise it scrolls (and
  // pinches) like the rest of the sheet, down to the note and Send. A mouse or a pen always draws.
  const [marking, setMarking] = useState(true);
  const area = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const footer = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fingers = useRef(new Set<number>());
  const nextId = useRef(1);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const sw = strokeOf(shot.width);

  // The picture fills the space it has, keeping its shape. On a phone: the width, and the height
  // of the window less the bars and a strip of the note (the window's height, which the on-screen
  // keyboard leaves alone, so the picture does not jump while typing).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (phone) {
        const below = footer.current?.offsetHeight ?? 68;
        const pad = 12 * 2; // px-3 on both sides
        setFit(phonePictureFit(shot, { width: r.width - pad, height: window.innerHeight - el.offsetTop - below - NOTE_PEEK }));
        return;
      }
      // Inside the area's padding (px-6, pb-6).
      const s = Math.min(Math.max(1, r.width - 48) / shot.width, Math.max(1, r.height - 24) / shot.height);
      setFit({ w: Math.max(1, Math.floor(shot.width * s)), h: Math.max(1, Math.floor(shot.height * s)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [shot, phone]);

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

  // A finger draws only while marking (phone); a second finger is a pinch, not a mark.
  const draws = (e: RPointerEvent) => !(phone && e.pointerType === "touch" && !marking);
  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !draws(e)) return;
    if (e.pointerType === "touch") {
      fingers.current.add(e.pointerId);
      if (fingers.current.size > 1) {
        setDraft(null);
        return;
      }
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = at(e);
    setDraft({ id: nextId.current++, tool, color, pts: [p, p], note: "" });
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!draft || fingers.current.size > 1) return;
    const p = at(e);
    setDraft((d) => (d ? { ...d, pts: d.tool === "pen" ? [...d.pts, p] : [d.pts[0]!, p] } : d));
  };
  const lift = (e: RPointerEvent<SVGSVGElement>) => fingers.current.delete(e.pointerId);
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    lift(e);
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

  // Phone: "Done" goes down to the note and starts it; "Mark" goes back up to the picture.
  const doneMarking = () => {
    setMarking(false);
    setDraft(null);
    noteField.current?.focus({ preventScroll: true });
    noteBox.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  const markAgain = () => {
    setMarking(true);
    scroller.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const pick = (k: Tool) => {
    setTool(k);
    setMarking(true);
  };
  const nextColor = () => setColor((c) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length]!);

  const toolButton = "grid size-8 place-items-center rounded-full transition-colors sm:size-9 pointer-coarse:size-11";
  const tools = (
    <div className="mx-auto flex w-max items-center gap-0.5 rounded-full border border-white/15 bg-neutral-900/85 p-1 text-white shadow-2xl backdrop-blur sm:gap-1">
      {TOOLS.map(({ tool: k, icon: I, label }) => (
        <button
          key={k}
          type="button"
          onClick={() => pick(k)}
          aria-pressed={tool === k}
          title={t(label)}
          aria-label={t(label)}
          className={cn(toolButton, tool === k ? "bg-white text-neutral-900" : "hover:bg-white/15")}
        >
          <I size={18} weight={tool === k ? "bold" : "regular"} />
        </button>
      ))}
      {phone || finger ? (
        // One colour button for fingers (it goes round the four colours), so every button stays 44 px.
        <button type="button" onClick={nextColor} aria-label={t("Colour: tap for the next one")} title={t("Colour: tap for the next one")} className={cn(toolButton, "hover:bg-white/15")}>
          <span className="size-6 rounded-full ring-2 ring-white" style={{ background: color }} />
        </button>
      ) : (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={t("Colour")}
              className={cn("grid size-7 place-items-center rounded-full transition-transform sm:size-8 pointer-coarse:size-11", color === c ? "scale-110" : "opacity-80 hover:opacity-100")}
            >
              <span className={cn("size-5 rounded-full ring-2", color === c ? "ring-white" : "ring-transparent")} style={{ background: c }} />
            </button>
          ))}
        </>
      )}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20 sm:mx-1" />
      <button type="button" onClick={undo} disabled={!marks.length} title={t("Undo")} aria-label={t("Undo")} className={cn(toolButton, "hover:bg-white/15 disabled:opacity-35")}>
        <ArrowCounterClockwiseIcon size={18} />
      </button>
      <button type="button" onClick={() => setMarks([])} disabled={!marks.length} title={t("Clear all marks")} aria-label={t("Clear all marks")} className={cn(toolButton, "hover:bg-white/15 disabled:opacity-35")}>
        <TrashIcon size={18} />
      </button>
    </div>
  );

  const form = (
    <div className="grid gap-4">
      <label className="grid gap-2">
        <span className="text-[12.5px] font-medium text-muted">{t("Your note")}</span>
        <textarea
          ref={noteField}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={phone ? 3 : 5}
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
                "h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors pointer-coarse:h-11 pointer-coarse:px-3.5",
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
                  className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent pointer-coarse:h-11"
                />
                <button type="button" onClick={() => setMarks((all) => all.filter((x) => x.id !== m.id))} aria-label={t("Remove this mark")} title={t("Remove this mark")}
                  className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-danger pointer-coarse:size-11">
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

  const markCount = marks.length === 1 ? t("1 mark on the screen") : marks.length ? t("{n} marks on the screen", { n: marks.length }) : t("Your screenshot is ready");
  const fingerDraws = !phone || marking;
  const picture = (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-[var(--radius-sm)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]",
        phone && marking ? "ring-2 ring-accent" : "ring-1 ring-white/15",
      )}
      style={{ width: fit.w, height: fit.h }}
    >
      <img src={shot.url} alt={t("Screenshot of {page}", { page: pageLabel })} draggable={false} className="pointer-events-none absolute inset-0 size-full select-none" />
      <svg
        ref={svg}
        data-feedback-canvas=""
        data-marking={fingerDraws ? "on" : "off"}
        viewBox={`0 0 ${shot.width} ${shot.height}`}
        preserveAspectRatio="none"
        className={cn("absolute inset-0 size-full", fingerDraws ? "cursor-crosshair touch-none" : "touch-auto")}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => {
          lift(e);
          setDraft(null);
        }}
      >
        {marks.map((m, i) => <MarkSvg key={m.id} m={m} n={i + 1} sw={sw} />)}
        {draft ? <MarkSvg m={draft} n={marks.length + 1} sw={sw} /> : null}
      </svg>
    </motion.div>
  );

  if (phone) {
    // P93 phone: one sheet that scrolls (header, tools, picture, then the note), with the Mark /
    // Done switch and Send in a footer that stays in sight, above the on-screen keyboard too.
    return (
      <div className="absolute inset-0 flex flex-col bg-neutral-950/92 backdrop-blur-sm" data-layout="phone">
        <div ref={scroller} data-feedback-scroll="" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 bg-neutral-950/85 pt-[calc(env(safe-area-inset-top)+0.5rem)] pr-[max(0.75rem,env(safe-area-inset-right))] pb-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur">
            <div className="min-w-0 text-white">
              <p className="truncate text-[14px] font-semibold">{t("Mark up this screen")}</p>
              <p className="truncate text-[12px] text-white/60">{pageLabel}</p>
            </div>
            <button type="button" onClick={onCancel} aria-label={t("Close")} title={t("Close")} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
              <XIcon size={20} />
            </button>
          </div>
          <div className="flex shrink-0 overflow-x-auto px-3 pt-1 [scrollbar-width:none]">{tools}</div>
          <p className="shrink-0 px-4 py-2 text-center text-[12.5px] text-white/75" aria-live="polite">
            {marking ? t("Marking: tap or drag on the picture.") : t("Scrolling. To draw again, tap Mark the picture.")}
          </p>
          <div ref={area} className="flex shrink-0 justify-center px-3 pb-4">{picture}</div>
          <section
            ref={noteBox}
            aria-label={t("Tell us what you see")}
            className="flex-1 scroll-mt-16 rounded-t-[var(--radius-lg)] border-t border-border bg-surface px-4 pt-4 pb-6"
            onFocus={() => setMarking(false)}
          >
            <p className="text-[14.5px] font-semibold">{t("Tell us what you see")}</p>
            <p className="mb-3 text-[12px] text-muted">{markCount}</p>
            {form}
          </section>
        </div>
        <footer ref={footer} className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)]">
          {/* One button that changes, so it keeps the keyboard's focus. */}
          <Button variant="outline" size="lg" className="min-w-0 flex-1 px-3" onClick={marking ? doneMarking : markAgain}>
            {marking ? <CheckIcon size={17} weight="bold" /> : <PencilSimpleIcon size={17} weight="bold" />}
            <span className="truncate">{marking ? t("Done, write a note") : t("Mark the picture")}</span>
          </Button>
          <Button size="lg" className="px-4" onClick={send} disabled={!canSend} loading={sending}>
            <PaperPlaneTiltIcon size={17} weight="bold" /> {t("Send")}
          </Button>
        </footer>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-row bg-neutral-950/88 backdrop-blur-sm" data-layout="wide">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
          <div className="min-w-0 text-white">
            <p className="truncate text-[13.5px] font-semibold">{t("Mark up this screen")}</p>
            <p className="truncate text-[12px] text-white/60">{pageLabel}</p>
          </div>
        </div>
        <div className="flex shrink-0 overflow-x-auto px-3 pb-3 [scrollbar-width:none]">{tools}</div>
        <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-6">{picture}</div>
      </div>

      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.12 }}
        className="flex w-[24rem] max-w-[50vw] shrink-0 flex-col border-l border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold">{t("Tell us what you see")}</p>
            <p className="text-[12px] text-muted">{markCount}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={t("Close")} title={t("Close")} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-11">
            <XIcon size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{form}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
