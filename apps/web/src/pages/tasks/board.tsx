import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  defaultDropAnimationSideEffects,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DropAnimation,
  type Over,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowClockwiseIcon, CaretRightIcon, KanbanIcon, PlusIcon, SealCheckIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient, useSuspenseQuery, type QueryKey } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { editPaged, useDebounced, usePagedList, type PagedList } from "@/lib/paged";
import { keys, meQuery } from "@/lib/queries";
import type { Branch } from "@/lib/types";
import { useFillHeight } from "@/lib/use-fill-height";
import { useIsPhone } from "@/lib/use-media";
import { cn, shortAge, timeAgo } from "@/lib/utils";
import { PRIORITY_INFO, STATUS_INFO, workKeys, type RetryFailedResult, type Task, type TaskStatus } from "@/lib/work";

import { NewTaskDialog } from "./new-task";
import { TaskSheet } from "./task-sheet";

const COLUMNS: { status: TaskStatus; hint: string; empty: string }[] = [
  { status: "triage", hint: "Not started", empty: "New tasks without an agent land here." },
  { status: "ready", hint: "Queued to run", empty: "Nothing queued." },
  { status: "running", hint: "Agents working", empty: "No agent is working right now." },
  { status: "blocked", hint: "Needs a decision", empty: "Nothing is waiting on you." },
  { status: "review", hint: "Check and accept", empty: "Nothing to review." },
  { status: "done", hint: "Accepted", empty: "Accepted work shows here." },
];

/** The status colour as a small dot beside the column name (the label carries the meaning). */
const DOT: Record<(typeof STATUS_INFO)[TaskStatus]["tone"], string> = {
  neutral: "bg-muted/60",
  info: "bg-info",
  accent: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

/** Same rules as the API (routers/tasks.py MANUAL_MOVES). Running and blocked are agent-driven. */
const MOVES: Partial<Record<TaskStatus, TaskStatus[]>> = {
  triage: ["ready", "cancelled"],
  ready: ["triage", "cancelled"],
  review: ["done", "cancelled"],
  failed: ["triage", "cancelled"],
  done: ["triage"],
  cancelled: ["triage"],
};
const canMove = (from: TaskStatus | null | undefined, to: TaskStatus) => !!from && (MOVES[from] ?? []).includes(to);

/** A short buzz where the phone supports it (Android; iOS Safari ignores it). */
const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed here */
  }
};

// ---------------------------------------------------------------- drag ids and data

type DragData = { type: "task"; status: TaskStatus; task: Task } | { type: "col"; status: TaskStatus } | { type: "tab"; status: TaskStatus };
const dataOf = (x: Active | Over | null | undefined) => x?.data.current as DragData | undefined;
const colId = (s: TaskStatus) => `col:${s}`;
const tabId = (s: TaskStatus) => `tab:${s}`;

/** Where a dragged card would land: a column and the slot in it (cards from other columns). */
interface Target {
  status: TaskStatus;
  index: number;
  via: "card" | "col" | "tab";
}

/**
 * Pointer first: over a column tab (phones) that tab wins; inside a column, the nearest card of
 * that column (or the column itself when it is empty). Keyboard drags have no pointer: the
 * nearest card or column to the moved card.
 */
const collide: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    const tab = hits.find((h) => String(h.id).startsWith("tab:"));
    if (tab) return [tab];
    const col = hits.find((h) => String(h.id).startsWith("col:"));
    if (!col) return [];
    const status = String(col.id).slice(4);
    const cards = args.droppableContainers.filter((c) => {
      const d = c.data.current as DragData | undefined;
      return d?.type === "task" && d.status === status;
    });
    if (!cards.length) return [col];
    const near = closestCenter({ ...args, droppableContainers: cards });
    return near.length ? [near[0]!] : [col];
  }
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => (c.data.current as DragData | undefined)?.type !== "tab") });
};

/** Re-sorting a column needs board positions from the API; without them the cards stay put. */
const noSort: SortingStrategy = () => null;

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

// ---------------------------------------------------------------- cards

function CompanyTag({ company }: { company: Branch }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border px-1.5 py-px text-[11px] text-muted">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: company.color }} />
      <span className="truncate">{company.name}</span>
    </span>
  );
}

/** What a card shows: title, why it is stuck, chips, who has it and how long ago. */
function CardContent({ task, company }: { task: Task; company?: Branch }) {
  const urgent = task.priority === "high" || task.priority === "urgent";
  return (
    <>
      <p className="line-clamp-3 text-[13.5px] leading-snug font-medium break-words">{task.title}</p>
      {task.status === "blocked" && task.blocked_reason ? (
        <p className="line-clamp-2 rounded-[6px] bg-warn/10 px-2 py-1 text-[12px] break-words text-warn">{task.blocked_reason}</p>
      ) : task.status === "failed" && task.error ? (
        <p className="line-clamp-2 rounded-[6px] bg-danger/8 px-2 py-1 text-[12px] break-words text-danger">{task.error}</p>
      ) : null}
      {task.labels?.length || urgent || task.pending_approvals || company ? (
        <span className="flex min-w-0 flex-wrap gap-1">
          {company ? <CompanyTag company={company} /> : null}
          {task.pending_approvals ? <Pill tone="warn"><SealCheckIcon size={11} weight="fill" /> {task.pending_approvals}</Pill> : null}
          {urgent ? <Pill tone={PRIORITY_INFO[task.priority].tone}>{PRIORITY_INFO[task.priority].label}</Pill> : null}
          {task.labels?.slice(0, 3).map((l) => <Pill key={l} className="max-w-full truncate">{l}</Pill>)}
        </span>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 border-t border-border/70 pt-2">
        {task.assignee_name ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <AgentAvatar name={task.assignee_name} color={task.assignee_color ?? "#888"} size="xs" working={task.status === "running"} />
            <span className="truncate">{task.assignee_name}</span>
          </span>
        ) : <span className="truncate text-[12px] text-muted italic">Unassigned</span>}
        <time dateTime={task.updated_at} title={`Updated ${timeAgo(task.updated_at).toLowerCase()}`} className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-muted tabular">{shortAge(task.updated_at)}</time>
      </div>
    </>
  );
}

const CARD =
  "relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.05)]";

/** A thin accent line in the gap above or below a card: "it goes here". */
function DropLine({ at }: { at: "before" | "after" }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]", at === "before" ? "-top-[6px]" : "-bottom-[6px]")} />
  );
}

function TaskCard({ task, onOpen, draggable, guide, company, line }: {
  task: Task;
  onOpen: () => void;
  draggable: boolean;
  guide?: string;
  company?: Branch;
  line?: "before" | "after";
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
    data: { type: "task", status: task.status, task } satisfies DragData,
  });
  return (
    <button
      ref={setNodeRef}
      data-guide={guide}
      data-task={task.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // Drag attributes only when draggable: otherwise dnd-kit adds aria-disabled, which tells
      // screen readers the card itself is disabled although it still opens the task.
      {...(draggable ? { ...listeners, ...attributes, "aria-roledescription": "draggable task" } : {})}
      onClick={onOpen}
      className={cn(
        CARD,
        "transition-[border-color,box-shadow,opacity] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none",
        // Press-and-hold to pick up on touch: the page still pans until then, never selects text
        // and never opens the iOS callout.
        draggable && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] active:cursor-grabbing",
        // The card stays in place as a dimmed slot while its lifted copy follows the pointer.
        isDragging && "border-dashed border-accent/50 bg-accent-soft/30 opacity-45 shadow-none hover:shadow-none",
      )}
    >
      {line ? <DropLine at={line} /> : null}
      <CardContent task={task} company={company} />
    </button>
  );
}

/** The copy under the finger: lifted (a touch larger, tilted, deep shadow), same width as the card. */
function LiftedCard({ task, company, reduce }: { task: Task; company?: Branch; reduce: boolean }) {
  return (
    <motion.div
      initial={reduce ? false : { scale: 1, rotate: 0 }}
      animate={reduce ? undefined : { scale: 1.03, rotate: 1.5 }}
      transition={{ type: "spring", stiffness: 520, damping: 32 }}
      className={cn(CARD, "h-full cursor-grabbing border-accent/50 shadow-[var(--shadow-pop)] ring-1 ring-accent/25")}
    >
      <CardContent task={task} company={company} />
    </motion.div>
  );
}

/** Each column pages on its own (status filter + search on the server), so a long Done column
 * loads 50 cards at a time as you scroll it while the short working columns stay complete. */
const BOARD_KEY: QueryKey = [...workKeys.tasks, "board"];
type BoardStatus = "triage" | "ready" | "running" | "blocked" | "review" | "done";
const useColumn = (status: string, q: string, branch: string | undefined, enabled = true) =>
  usePagedList<Task>(BOARD_KEY, "/api/tasks", { status, q, branch_id: branch }, { enabled });

interface ColumnProps {
  status: TaskStatus;
  hint: string;
  empty: string;
  list: PagedList<Task>;
  onOpen: (id: string) => void;
  canWrite: boolean;
  dragFrom: TaskStatus | null;
  hovered: boolean;
  drop: number | null;
  sortable: boolean;
  companyOf: (t: Task) => Branch | undefined;
  guideFirst?: boolean;
}

function Column({ status, hint, empty, list, onOpen, canWrite, dragFrom, hovered, drop, sortable, companyOf, guideFirst }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: colId(status), data: { type: "col", status } satisfies DragData });
  const scroller = useRef<HTMLDivElement>(null);
  const tasks = list.items;
  const allowed = canMove(dragFrom, status);
  const home = dragFrom === status;
  const info = STATUS_INFO[status];
  const lineAt = (i: number): "before" | "after" | undefined =>
    drop === null ? undefined : drop === i ? "before" : drop === tasks.length && i === tasks.length - 1 ? "after" : undefined;
  return (
    <section
      ref={setNodeRef}
      data-col={status}
      aria-label={info.label}
      className={cn(
        // Fills the screen below the toolbar; the cards scroll inside the column, header stays.
        "flex h-[var(--fill-h,24rem)] w-[84vw] max-w-[20rem] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-md)] border border-border/60 bg-surface-2/50 transition-[border-color,background-color,opacity,box-shadow] duration-150",
        "sm:w-72 xl:w-auto xl:max-w-none xl:min-w-0",
        dragFrom && allowed && "border-dashed border-accent/60",
        hovered && allowed && "border-solid border-accent bg-accent-soft/50 shadow-[0_0_0_3px_var(--accent-soft)]",
        hovered && home && sortable && "border-accent/50",
        dragFrom && !allowed && !home && "opacity-55",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-3 pt-3 pb-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[info.tone])} />
            <span className="truncate">{info.label}</span>
          </h2>
          <p className="mt-0.5 truncate pl-4 text-[11.5px] text-muted">{dragFrom && !allowed && !home ? "Can't move here" : hint}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-medium text-muted tabular ring-1 ring-border/70">{list.total ?? tasks.length}</span>
      </header>
      <div ref={scroller} data-scroll className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]">
        <SortableContext id={status} items={tasks.map((t) => t.id)} strategy={sortable ? verticalListSortingStrategy : noSort}>
          {tasks.map((t, i) => (
            <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} draggable={canWrite && !!MOVES[t.status]} guide={guideFirst && i === 0 ? "tasks.card" : undefined}
              company={companyOf(t)} line={lineAt(i)} />
          ))}
        </SortableContext>
        {!tasks.length ? (
          <p className={cn("grid min-h-24 place-items-center rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted transition-colors",
            dragFrom && allowed && "border-accent/60 text-accent", hovered && allowed && "border-solid bg-surface/70 font-medium")}>
            {dragFrom && allowed ? "Drop here" : empty}
          </p>
        ) : null}
        <LoadMore compact root={scroller} margin={240} noun="tasks" shown={tasks.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} />
      </div>
    </section>
  );
}

/** One tab of the phone column switcher. While a card is held it is also a drop target: drop
 * on it to move the card to the top of that column; hover a moment and the board slides there. */
function ColumnTab({ status, count, on, onPick, dragFrom, hovered }: { status: TaskStatus; count: number; on: boolean; onPick: () => void; dragFrom: TaskStatus | null; hovered: boolean }) {
  const { setNodeRef } = useDroppable({ id: tabId(status), data: { type: "tab", status } satisfies DragData, disabled: !dragFrom });
  const allowed = canMove(dragFrom, status);
  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onPick}
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-[color,background-color,box-shadow,opacity] pointer-coarse:h-9",
        on ? "text-fg" : "text-muted hover:text-fg",
        dragFrom && allowed && "text-accent ring-1 ring-accent/50 ring-inset",
        hovered && allowed && "bg-accent text-accent-fg ring-0",
        dragFrom && !allowed && dragFrom !== status && "opacity-45",
      )}
    >
      {on && !(hovered && allowed) ? (
        <motion.span layoutId="board-tab" transition={{ type: "spring", stiffness: 500, damping: 38 }}
          className="absolute inset-0 rounded-[calc(var(--radius-sm)-2px)] bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] ring-1 ring-border" />
      ) : null}
      <span className="relative">{STATUS_INFO[status].label}</span>
      <span className={cn("relative rounded-full px-1.5 text-[11px] tabular", hovered && allowed ? "bg-accent-fg/20 text-accent-fg" : on ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>{count}</span>
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="grid w-[84vw] max-w-[20rem] shrink-0 content-start gap-2 rounded-[var(--radius-md)] bg-surface-2/50 p-2 sm:w-72 xl:w-auto xl:flex-1">
          <Skeleton className="mx-1 my-1.5 h-8 w-2/3" />
          {Array.from({ length: 3 - (i % 3) }, (_, k) => <Skeleton key={k} className="h-24 rounded-[var(--radius-sm)]" />)}
        </div>
      ))}
    </div>
  );
}

/** The new position between two neighbours (board order is position ascending). */
function between(before: Task | undefined, after: Task | undefined): number | undefined {
  const b = before?.position;
  const a = after?.position;
  if (typeof b === "number" && typeof a === "number") return b === a ? undefined : (a + b) / 2;
  if (typeof a === "number" && !before) return a - 1;
  if (typeof b === "number" && !after) return b + 1;
  return undefined;
}

interface Move {
  id: string;
  task: Task;
  status: TaskStatus;
  /** Only sent when it changes (cross-column moves). */
  statusChanged: boolean;
  position?: number;
  beforeId?: string;
  afterId?: string;
  prev?: [QueryKey, unknown][];
}

export function TasksPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = !!useReducedMotion();
  const phone = useIsPhone();
  const search = useSearch({ strict: false }) as { task?: string; new?: number; agent?: string; brief?: string };
  const [creating, setCreating] = useState(0);
  const [active, setActive] = useState<Task | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<TaskStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const jumpedAt = useRef(0);
  const didInit = useRef(false);
  // True from the moment a card is lifted until just after it lands: that click is not an "open".
  const holdClicks = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragFrom = active?.status ?? null;
  const sensors = useSensors(
    // Mouse: a small nudge starts the drag, so a click still opens the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: press and hold (~0.2 s) without moving; a swipe before that scrolls as usual.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    // Keyboard: Space picks up, arrows move, Space or Enter drops, Escape cancels.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  // The header's company: one company filters the board on the server; "All" labels each card.
  const { branches, isAll, canAll, selected, select, isLoading: companiesLoading } = useCompanies();
  const branchFilter = canAll && !isAll ? selected?.id : undefined;
  // Wait for the company list, so a one-company board never first loads every company's tasks.
  const companiesReady = !companiesLoading;
  const companyById = new Map(branches.map((b) => [b.id, b]));
  const companyOf = (t: Task) => (isAll && canAll && t.branch_id ? companyById.get(t.branch_id) : undefined);

  // Search runs on the server (title, brief, agent, label), so every page of every column is
  // filtered and the counts are the true counts.
  const needle = useDebounced(q.trim());
  const triage = useColumn("triage", needle, branchFilter, companiesReady);
  const ready = useColumn("ready", needle, branchFilter, companiesReady);
  const running = useColumn("running", needle, branchFilter, companiesReady);
  const blocked = useColumn("blocked", needle, branchFilter, companiesReady);
  const review = useColumn("review", needle, branchFilter, companiesReady);
  const done = useColumn("done", needle, branchFilter, companiesReady);
  const cols: Record<BoardStatus, PagedList<Task>> = { triage, ready, running, blocked, review, done };
  const closedList = useColumn("failed,cancelled", needle, branchFilter, companiesReady);
  const failedList = useColumn("failed", needle, branchFilter, companiesReady && canWrite);
  const counts = new Map<TaskStatus, number>(Object.entries(cols).map(([s, l]) => [s as TaskStatus, l.total ?? l.items.length]));
  const lists = [...Object.values(cols), closedList];
  const isLoading = companiesLoading || lists.some((l) => l.isLoading);
  const error = lists.find((l) => l.error)?.error ?? null;
  const anyTasks = lists.some((l) => (l.total ?? l.items.length) > 0);
  const failed = failedList.items;
  const failedTotal = failedList.total ?? failed.length;
  const closed = closedList.items;
  const closedTotal = closedList.total ?? closed.length;
  // The API sends board positions: cards can be re-ordered and dropped into a chosen slot.
  const sortable = Object.values(cols).some((l) => l.items.some((t) => typeof t.position === "number"));

  const showBoard = !isLoading && !error && (anyTasks || !!needle);
  useFillHeight(board, { min: phone ? 272 : 384, gap: phone ? 12 : 20, enabled: showBoard });

  /** Relaunch every failed task shown (the API takes up to 50 per call and says what it skipped). */
  const retryFailed = async () => {
    try {
      const r = await api<RetryFailedResult>("/api/tasks/retry-failed", "POST", { task_ids: failed.map((t) => t.id) });
      const why = r.skipped[0]?.reason;
      if (r.retried) toast.success(`Retrying ${r.retried} task${r.retried === 1 ? "" : "s"}.`, why ? { description: `${r.skipped.length} not retried: ${why}` } : undefined);
      else toast.error(why ? `None retried: ${why}` : "Nothing to retry.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
    }
  };
  // On phones the board opens on the first column that has work in it, not an empty Triage.
  const firstBusy = COLUMNS.find((c) => (counts.get(c.status) ?? 0) > 0)?.status ?? "triage";
  const col = picked ?? firstBusy;

  /** Scroll the swipeable board so `status` sits at its left edge. */
  const scrollTo = (status: TaskStatus, smooth: boolean) => {
    const el = board.current;
    const t = el?.querySelector<HTMLElement>(`[data-col="${status}"]`);
    if (!el || !t || el.scrollWidth <= el.clientWidth) return;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    el.scrollBy({ left: t.getBoundingClientRect().left - el.getBoundingClientRect().left - pad, behavior: smooth && !reduce ? "smooth" : "auto" });
  };
  /** Keep the chosen tab visible in the (sideways-scrolling) column switcher. */
  const revealTab = (status: TaskStatus) => {
    const list = tabs.current?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = list?.children[COLUMNS.findIndex((c) => c.status === status)] as HTMLElement | undefined;
    if (!list || !tab) return;
    const l = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    if (l < list.scrollLeft) list.scrollTo({ left: l - 8 });
    else if (l + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: l + tab.offsetWidth - list.clientWidth + 8 });
  };
  const jump = (status: TaskStatus) => {
    jumpedAt.current = Date.now();
    setPicked(status);
    scrollTo(status, true);
    revealTab(status);
  };
  // Swiping updates the column switcher (ignored while a tap-triggered scroll is animating).
  const onBoardScroll = () => {
    const el = board.current;
    if (!el || Date.now() - jumpedAt.current < 600) return;
    const left = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0);
    let best: { s: TaskStatus; d: number } | null = null;
    for (const node of el.querySelectorAll<HTMLElement>("[data-col]")) {
      const d = Math.abs(node.getBoundingClientRect().left - left);
      if (!best || d < best.d) best = { s: node.dataset.col as TaskStatus, d };
    }
    if (best && best.s !== col) {
      setPicked(best.s);
      revealTab(best.s);
    }
  };
  // First load on a narrow screen: start on the first busy column (DOM scroll only, no state).
  const settled = !isLoading && anyTasks;
  useEffect(() => {
    if (didInit.current || !settled) return;
    didInit.current = true;
    scrollTo(firstBusy, false);
    revealTab(firstBusy);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once, when the tasks first arrive
  }, [settled]);

  // Holding a card over a column tab for a moment slides the board to that column ("spring-loaded"),
  // so the card can then be dropped into a chosen slot there.
  const hoverTab = target?.via === "tab" ? target.status : null;
  useEffect(() => {
    if (!hoverTab || hoverTab === col) return;
    const t = setTimeout(() => jump(hoverTab), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump only touches refs and state setters
  }, [hoverTab, col]);

  /** Out of every list it is in, into its new column between its new neighbours (or on top). */
  const place = (m: Move) => {
    editPaged<Task>(qc, BOARD_KEY, (items, page, params) => {
      const rest = items.filter((t) => t.id !== m.id);
      if (!String(params.status ?? "").split(",").includes(m.status)) return rest;
      const moved = { ...m.task, status: m.status, ...(m.position !== undefined ? { position: m.position } : {}) };
      const after = m.afterId ? rest.findIndex((t) => t.id === m.afterId) : -1;
      if (after >= 0) return [...rest.slice(0, after), moved, ...rest.slice(after)];
      const before = m.beforeId ? rest.findIndex((t) => t.id === m.beforeId) : -1;
      if (before >= 0) return [...rest.slice(0, before + 1), moved, ...rest.slice(before + 1)];
      return page === 0 && !m.beforeId ? [moved, ...rest] : rest;
    });
  };

  const move = useMutation({
    mutationFn: (m: Move) =>
      api<Task>(`/api/tasks/${m.id}`, "PATCH", { ...(m.statusChanged ? { status: m.status } : {}), ...(m.position !== undefined ? { position: m.position } : {}) }),
    onMutate: async (m) => {
      // A refresh that was already on its way would put the card back: cancel it, place again.
      await qc.cancelQueries({ queryKey: BOARD_KEY });
      place(m);
    },
    onError: (e, m) => {
      for (const [key, data] of m.prev ?? []) qc.setQueryData(key, data);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
    },
  });

  // While a card is held: no text selection anywhere and a grabbing hand, whatever is under it.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.classList.add("select-none");
    root.style.cursor = "grabbing";
    return () => {
      root.classList.remove("select-none");
      root.style.cursor = "";
    };
  }, [active]);

  const reset = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => (holdClicks.current = false), 300);
    setActive(null);
    setTarget(null);
    setOverStatus(null);
  };

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const d = dataOf(a);
    if (d?.type !== "task") return;
    clearTimeout(holdTimer.current);
    holdClicks.current = true;
    buzz(10);
    setActive(d.task);
  };

  /** Follow the pointer: which column is under it, and which slot the card would take there. */
  const track = ({ active: a, over }: DragMoveEvent) => {
    const from = dataOf(a);
    const d = dataOf(over);
    const next: Target | null = !over || !d || from?.type !== "task" ? null
      : d.type === "tab" ? { status: d.status, index: 0, via: "tab" }
      : d.type === "col" ? { status: d.status, index: d.status === from.status ? -1 : (cols[d.status as BoardStatus]?.items.length ?? 0), via: "col" }
      : (() => {
          if (d.status === from.status) return { status: d.status, index: -1, via: "card" as const };
          const list = cols[d.status as BoardStatus]?.items ?? [];
          if (!sortable) return { status: d.status, index: 0, via: "card" as const };
          const i = list.findIndex((t) => t.id === over.id);
          const box = a.rect.current.translated;
          const below = !!box && box.top + box.height / 2 > over.rect.top + over.rect.height / 2;
          return { status: d.status, index: Math.max(0, i + (below ? 1 : 0)), via: "card" as const };
        })();
    setOverStatus((s) => (s === (next?.status ?? null) ? s : (next?.status ?? null)));
    setTarget((t) => (t?.status === next?.status && t?.index === next?.index && t?.via === next?.via ? t : next));
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const landing = target;
    reset();
    const from = dataOf(a);
    const d = dataOf(over);
    if (from?.type !== "task" || !over || !d) return;
    const task = from.task;
    const to = d.status;
    if (to === from.status) {
      // Re-order inside the column (needs board positions from the API).
      if (d.type !== "task" || over.id === a.id || !sortable) return;
      const list = cols[to as BoardStatus]?.items ?? [];
      const oldI = list.findIndex((t) => t.id === a.id);
      const newI = list.findIndex((t) => t.id === over.id);
      if (oldI < 0 || newI < 0) return;
      const next = arrayMove(list, oldI, newI);
      const position = between(next[newI - 1], next[newI + 1]);
      if (position === undefined) return;
      const m: Move = { id: task.id, task, status: to, statusChanged: false, position, beforeId: next[newI - 1]?.id, afterId: next[newI + 1]?.id };
      m.prev = qc.getQueriesData({ queryKey: BOARD_KEY });
      place(m);
      move.mutate(m);
      return;
    }
    if (!canMove(from.status, to)) {
      toast(`A ${STATUS_INFO[from.status].label.toLowerCase()} task cannot go to ${STATUS_INFO[to].label.toLowerCase()}.`);
      return;
    }
    const list = cols[to as BoardStatus]?.items ?? [];
    const index = landing?.status === to && landing.index >= 0 ? Math.min(landing.index, list.length) : 0;
    const m: Move = {
      id: task.id, task, status: to, statusChanged: true,
      position: sortable ? between(list[index - 1], list[index]) : undefined,
      beforeId: list[index - 1]?.id, afterId: list[index]?.id,
    };
    // Placed right away (same frame as the drop) so the lifted card settles into its new slot.
    m.prev = qc.getQueriesData({ queryKey: BOARD_KEY });
    place(m);
    buzz(8);
    move.mutate(m);
    if (d.type === "tab") toast.success(`Moved to ${STATUS_INFO[to].label}.`, { duration: 1800 });
  };

  const labelOf = (id: string | number | undefined) => {
    const s = id === undefined ? "" : String(id);
    const status = s.startsWith("col:") || s.startsWith("tab:") ? (s.slice(4) as TaskStatus) : null;
    if (status) return `the ${STATUS_INFO[status].label} column`;
    const t = lists.flatMap((l) => l.items).find((x) => x.id === s);
    return t ? `"${t.title}"` : "the board";
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${labelOf(a.id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({ over }) => (over ? `Over ${labelOf(over.id)}.` : "Not over a column."),
    onDragEnd: ({ over }) => (over ? `Dropped on ${labelOf(over.id)}.` : "Dropped outside the board. Nothing moved."),
    onDragCancel: () => "Move cancelled. Nothing changed.",
  };

  const newOpen = creating > 0 || (!!search.new && canWrite);
  const closeNew = () => {
    setCreating(0);
    if (search.new) navigate({ to: "/tasks", search: {}, replace: true });
  };
  // A click that ends a drag (or a long press that lifted a card) never opens the task.
  const openTask = (id: string) => {
    if (active || holdClicks.current) return;
    navigate({ to: "/tasks", search: { task: id } });
  };
  const company = active ? companyOf(active) : undefined;

  let overlay: ReactNode = null;
  if (active) overlay = <LiftedCard task={active} company={company} reduce={reduce} />;

  return (
    <Page wide>
      <PageHeader
        title="Tasks"
        description={phone ? undefined : "Everything your agents are working on. Drag a card to move it (press and hold on a phone); agents move running work themselves."}
        // Phones: a round "+" beside the search instead of a full-width button, so the board gets the screen.
        actions={canWrite && !(phone && showBoard) ? <Button data-guide="tasks.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New task</Button> : null}
      />
      {isLoading ? (
        <BoardSkeleton />
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !anyTasks && !needle ? (
        <EmptyState icon={KanbanIcon} title={branchFilter && selected ? `No tasks at ${selected.name} yet` : "No tasks yet"} body="Give an agent something to do. It follows its SOPs, asks you before risky steps, and puts the result here for review."
          action={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Create first task</Button> : undefined} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          // Scroll the column under the card and the sideways board near their edges; never the page.
          autoScroll={{ threshold: { x: 0.14, y: 0.16 }, acceleration: 14, canScroll: (el) => el !== document.scrollingElement && el !== document.body }}
          accessibility={{ announcements, screenReaderInstructions: { draggable: "To move a task, press Space. Use the arrow keys to choose a column or a place in it, then press Space again to drop it, or Escape to cancel." } }}
          onDragStart={onDragStart}
          onDragMove={track}
          onDragOver={track}
          onDragCancel={reset}
          onDragEnd={onDragEnd}
        >
          <Toolbar className="xl:max-w-2xl">
            <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
              <SearchInput guide="tasks.search" value={q} onChange={setQ} placeholder="Filter by title, agent or label" />
              {canWrite && phone ? (
                <Button data-guide="tasks.new" size="icon" className="size-11 shrink-0 rounded-full" aria-label="New task" onClick={() => setCreating((n) => n + 1)}>
                  <PlusIcon size={18} weight="bold" />
                </Button>
              ) : null}
            </div>
            {branchFilter && selected ? (
              <button type="button" onClick={() => select(ALL_COMPANIES)} title="Show every company's tasks"
                className="inline-flex h-10 max-w-full min-w-0 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[12.5px] text-muted hover:border-accent/40 hover:text-fg pointer-coarse:h-11">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: selected.color }} />
                <span className="truncate">Only {selected.name}</span>
                <XIcon size={13} className="shrink-0" />
              </button>
            ) : null}
            {/* Column switcher for the swipeable board (and a drop target while dragging); wide screens see all six columns. */}
            <div ref={tabs} className="min-w-0 xl:hidden">
              <div role="tablist" aria-label="Board columns"
                className="flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-surface-2/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {COLUMNS.map((c) => (
                  <ColumnTab key={c.status} status={c.status} count={counts.get(c.status) ?? 0} on={c.status === col} onPick={() => jump(c.status)}
                    dragFrom={dragFrom} hovered={hoverTab === c.status} />
                ))}
              </div>
            </div>
          </Toolbar>
          <div
            ref={board}
            data-guide="tasks.columns"
            onScroll={onBoardScroll}
            className={cn(
              "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 xl:mx-0 xl:grid xl:grid-cols-6 xl:overflow-visible xl:px-0",
              // Snapping fights the edge auto-scroll while a card is held.
              active && "snap-none",
            )}
          >
            {COLUMNS.map((c) => {
              const drop = target && target.status === c.status && target.status !== dragFrom && canMove(dragFrom, c.status) && target.index >= 0 ? target.index : null;
              return (
                <Column key={c.status} status={c.status} hint={c.hint} empty={needle ? "No match in this column." : c.empty} list={cols[c.status as BoardStatus]} onOpen={openTask}
                  canWrite={canWrite} dragFrom={dragFrom} hovered={overStatus === c.status} drop={drop} sortable={sortable} companyOf={companyOf} guideFirst={c.status === firstBusy} />
              );
            })}
          </div>
          {createPortal(
            // On <body>: a transformed ancestor (page transitions) would offset a fixed overlay from the finger.
            <DragOverlay dropAnimation={reduce ? null : dropAnimation} zIndex={60}>{overlay}</DragOverlay>,
            document.body,
          )}
          {closedTotal ? (
            <details className="group min-w-0 rounded-[var(--radius-md)] border border-border bg-surface">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                <CaretRightIcon size={13} weight="bold" className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <WarningIcon size={15} weight="duotone" className="shrink-0 text-muted" /> Failed and cancelled
                <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-muted tabular">{closedTotal}</span>
              </summary>
              {canWrite && failed.length ? (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                  <p className="min-w-0 text-[12.5px] text-muted">{failedTotal} failed {failedTotal === 1 ? "task was" : "tasks were"} never retried.</p>
                  <Button size="sm" variant="outline" className="min-h-9" onClick={() => setRetrying(true)}>
                    <ArrowClockwiseIcon size={14} weight="bold" /> Retry all failed
                  </Button>
                </div>
              ) : null}
              <div className="grid max-h-[28rem] grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {closed.map((t) => (
                  <button key={t.id} type="button" onClick={() => openTask(t.id)}
                    className={cn(CARD, "transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent focus-visible:outline-none")}>
                    <CardContent task={t} company={companyOf(t)} />
                  </button>
                ))}
                <LoadMore className="col-span-full" noun="tasks" shown={closed.length} total={closedList.total} hasMore={closedList.hasMore} loading={closedList.isFetchingMore} onLoad={closedList.loadMore} />
              </div>
            </details>
          ) : null}
          <ConfirmDialog open={retrying} onOpenChange={setRetrying} title={`Retry ${failedTotal} failed task${failedTotal === 1 ? "" : "s"}?`} confirmLabel="Retry all"
            body={<>Each one starts a fresh run with its agent, continuing the same conversation.{failedTotal > 50 ? " Up to 50 start now; retry again for the rest." : ""}{needle ? " Only the tasks matching your filter are retried." : ""}</>}
            onConfirm={retryFailed} />
        </DndContext>
      )}
      {search.task ? <TaskSheet taskId={search.task} onClose={() => navigate({ to: "/tasks", search: {} })} /> : null}
      {newOpen ? (
        <NewTaskDialog key={`${creating}-${search.agent ?? ""}`} open onOpenChange={(o) => !o && closeNew()} initialAgent={search.agent} initialBrief={search.brief}
          onCreated={(t) => { setCreating(0); navigate({ to: "/tasks", search: { task: t.id } }); }} />
      ) : null}
    </Page>
  );
}
