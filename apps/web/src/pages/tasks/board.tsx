import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowClockwiseIcon, CaretRightIcon, KanbanIcon, PlusIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient, useSuspenseQuery, type QueryKey } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { editPaged, useDebounced, usePagedList, type PagedList } from "@/lib/paged";
import { keys, meQuery } from "@/lib/queries";
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

function TaskCard({ task, onOpen, draggable, guide }: { task: Task; onOpen: () => void; draggable: boolean; guide?: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable, data: { status: task.status } });
  const urgent = task.priority === "high" || task.priority === "urgent";
  return (
    <button
      ref={setNodeRef}
      data-guide={guide}
      style={{ transform: CSS.Translate.toString(transform) }}
      // Drag attributes only when draggable: otherwise dnd-kit adds aria-disabled, which tells
      // screen readers the card itself is disabled although it still opens the task.
      {...(draggable ? { ...listeners, ...attributes } : {})}
      onClick={onOpen}
      className={cn(
        "grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.05)]",
        "transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent focus-visible:outline-none",
        draggable && "cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "relative z-20 shadow-[var(--shadow-pop)] ring-2 ring-accent/40",
      )}
    >
      <p className="line-clamp-3 text-[13.5px] leading-snug font-medium break-words">{task.title}</p>
      {task.status === "blocked" && task.blocked_reason ? (
        <p className="line-clamp-2 rounded-[6px] bg-warn/10 px-2 py-1 text-[12px] break-words text-warn">{task.blocked_reason}</p>
      ) : task.status === "failed" && task.error ? (
        <p className="line-clamp-2 rounded-[6px] bg-danger/8 px-2 py-1 text-[12px] break-words text-danger">{task.error}</p>
      ) : null}
      {task.labels?.length || urgent || task.pending_approvals ? (
        <span className="flex min-w-0 flex-wrap gap-1">
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
    </button>
  );
}

/** Each column pages on its own (status filter + search on the server), so a long Done column
 * loads 50 cards at a time as you scroll it while the short working columns stay complete. */
const BOARD_KEY: QueryKey = [...workKeys.tasks, "board"];
type BoardStatus = "triage" | "ready" | "running" | "blocked" | "review" | "done";
const useColumn = (status: string, q: string, enabled = true) =>
  usePagedList<Task>(BOARD_KEY, "/api/tasks", { status, q }, { enabled });

function Column({ status, hint, empty, list, onOpen, canWrite, dragFrom, guideFirst }: { status: TaskStatus; hint: string; empty: string; list: PagedList<Task>; onOpen: (id: string) => void; canWrite: boolean; dragFrom: TaskStatus | null; guideFirst?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const scroller = useRef<HTMLDivElement>(null);
  const tasks = list.items;
  const allowed = dragFrom ? (MOVES[dragFrom] ?? []).includes(status) : false;
  const info = STATUS_INFO[status];
  return (
    <section
      ref={setNodeRef}
      data-col={status}
      aria-label={info.label}
      className={cn(
        // Fixed height (fits the screen); the cards scroll inside the column, header stays.
        "flex h-[max(20rem,calc(100dvh-27.5rem))] w-[84vw] max-w-[20rem] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-md)] border border-border/60 bg-surface-2/50 transition-colors",
        "md:h-[max(24rem,calc(100dvh-19rem))] sm:w-72 xl:w-auto xl:max-w-none xl:min-w-0",
        dragFrom && allowed && "border-dashed border-accent/60",
        isOver && allowed && "border-solid border-accent bg-accent-soft/40",
        dragFrom && !allowed && dragFrom !== status && "opacity-55",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-3 pt-3 pb-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[info.tone])} />
            <span className="truncate">{info.label}</span>
          </h2>
          <p className="mt-0.5 truncate pl-4 text-[11.5px] text-muted">{hint}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-medium text-muted tabular ring-1 ring-border/70">{list.total ?? tasks.length}</span>
      </header>
      <div ref={scroller} className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto overscroll-contain p-2">
        {tasks.map((t, i) => (
          <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} draggable={canWrite && !!MOVES[t.status]} guide={guideFirst && i === 0 ? "tasks.card" : undefined} />
        ))}
        {!tasks.length ? (
          <p className={cn("grid min-h-24 place-items-center rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted", dragFrom && allowed && "border-accent/60 text-accent")}>
            {dragFrom && allowed ? "Drop here" : empty}
          </p>
        ) : null}
        <LoadMore compact root={scroller} margin={240} noun="tasks" shown={tasks.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} />
      </div>
    </section>
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

export function TasksPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const search = useSearch({ strict: false }) as { task?: string; new?: number; agent?: string; brief?: string };
  const [creating, setCreating] = useState(0);
  const [dragFrom, setDragFrom] = useState<TaskStatus | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<TaskStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const jumpedAt = useRef(0);
  const didInit = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Search runs on the server (title, brief, agent, label), so every page of every column is
  // filtered and the counts are the true counts.
  const needle = useDebounced(q.trim());
  const triage = useColumn("triage", needle);
  const ready = useColumn("ready", needle);
  const running = useColumn("running", needle);
  const blocked = useColumn("blocked", needle);
  const review = useColumn("review", needle);
  const done = useColumn("done", needle);
  const cols: Record<BoardStatus, PagedList<Task>> = { triage, ready, running, blocked, review, done };
  const closedList = useColumn("failed,cancelled", needle);
  const failedList = useColumn("failed", needle, canWrite);
  const counts = new Map<TaskStatus, number>(Object.entries(cols).map(([s, l]) => [s as TaskStatus, l.total ?? l.items.length]));
  const lists = [...Object.values(cols), closedList];
  const isLoading = lists.some((l) => l.isLoading);
  const error = lists.find((l) => l.error)?.error ?? null;
  const anyTasks = lists.some((l) => (l.total ?? l.items.length) > 0);
  const failed = failedList.items;
  const failedTotal = failedList.total ?? failed.length;
  const closed = closedList.items;
  const closedTotal = closedList.total ?? closed.length;

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
    const target = el?.querySelector<HTMLElement>(`[data-col="${status}"]`);
    if (!el || !target || el.scrollWidth <= el.clientWidth) return;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    el.scrollBy({ left: target.getBoundingClientRect().left - el.getBoundingClientRect().left - pad, behavior: smooth && !reduce ? "smooth" : "auto" });
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

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api<Task>(`/api/tasks/${id}`, "PATCH", { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: BOARD_KEY });
      const prev = qc.getQueriesData({ queryKey: BOARD_KEY });
      const moved = lists.flatMap((l) => l.items).find((t) => t.id === id);
      // Out of every column it was in, onto the top of the column it moved to.
      editPaged<Task>(qc, BOARD_KEY, (items, page, params) => {
        const rest = items.filter((t) => t.id !== id);
        const into = String(params.status ?? "").split(",").includes(status);
        return moved && into && page === 0 ? [{ ...moved, status }, ...rest] : rest;
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
    },
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragFrom(null);
    const from = e.active.data.current?.status as TaskStatus | undefined;
    const to = e.over?.id as TaskStatus | undefined;
    if (!from || !to || from === to) return;
    if (!(MOVES[from] ?? []).includes(to)) {
      toast(`A ${STATUS_INFO[from].label.toLowerCase()} task cannot go to ${STATUS_INFO[to].label.toLowerCase()}.`);
      return;
    }
    move.mutate({ id: String(e.active.id), status: to });
  };

  const newOpen = creating > 0 || (!!search.new && canWrite);
  const closeNew = () => {
    setCreating(0);
    if (search.new) navigate({ to: "/tasks", search: {}, replace: true });
  };
  const openTask = (id: string) => navigate({ to: "/tasks", search: { task: id } });

  return (
    <Page wide>
      <PageHeader
        title="Tasks"
        description="Everything your agents are working on. Drag a card to move it (press and hold on a phone); agents move running work themselves."
        actions={canWrite ? <Button data-guide="tasks.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New task</Button> : null}
      />
      {isLoading ? (
        <BoardSkeleton />
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !anyTasks && !needle ? (
        <EmptyState icon={KanbanIcon} title="No tasks yet" body="Give an agent something to do. It follows its SOPs, asks you before risky steps, and puts the result here for review."
          action={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Create first task</Button> : undefined} />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e) => setDragFrom((e.active.data.current?.status as TaskStatus) ?? null)} onDragCancel={() => setDragFrom(null)} onDragEnd={onDragEnd}>
          <Toolbar className="xl:max-w-md">
            <SearchInput guide="tasks.search" value={q} onChange={setQ} placeholder="Filter by title, agent or label" />
            {/* Column switcher for the swipeable board; wide screens see all six columns at once. */}
            <div ref={tabs} className="min-w-0 xl:hidden">
              <Segmented size="sm" label="Board columns" value={col} onChange={jump}
                options={COLUMNS.map((c) => ({ value: c.status, label: STATUS_INFO[c.status].label, count: counts.get(c.status) ?? 0 }))} />
            </div>
          </Toolbar>
          <div
            ref={board}
            data-guide="tasks.columns"
            onScroll={onBoardScroll}
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 xl:mx-0 xl:grid xl:grid-cols-6 xl:overflow-visible xl:px-0"
          >
            {COLUMNS.map((c) => (
              <Column key={c.status} status={c.status} hint={c.hint} empty={needle ? "No match in this column." : c.empty} list={cols[c.status as BoardStatus]} onOpen={openTask} canWrite={canWrite} dragFrom={dragFrom} guideFirst={c.status === firstBusy} />
            ))}
          </div>
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
                {closed.map((t) => <TaskCard key={t.id} task={t} onOpen={() => openTask(t.id)} draggable={false} />)}
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
