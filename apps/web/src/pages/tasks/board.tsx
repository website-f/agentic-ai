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
import { KanbanIcon, PlusIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { cn, shortAge, timeAgo } from "@/lib/utils";
import { PRIORITY_INFO, STATUS_INFO, tasksQuery, workKeys, type Task, type TaskStatus } from "@/lib/work";

import { NewTaskDialog } from "./new-task";
import { TaskSheet } from "./task-sheet";

const COLUMNS: { status: TaskStatus; hint: string }[] = [
  { status: "triage", hint: "Not started" },
  { status: "ready", hint: "Queued to run" },
  { status: "running", hint: "Agents working" },
  { status: "blocked", hint: "Needs a decision" },
  { status: "review", hint: "Check and accept" },
  { status: "done", hint: "Accepted" },
];

/** Same rules as the API (routers/tasks.py MANUAL_MOVES). Running and blocked are agent-driven. */
const MOVES: Partial<Record<TaskStatus, TaskStatus[]>> = {
  triage: ["ready", "cancelled"],
  ready: ["triage", "cancelled"],
  review: ["done", "cancelled"],
  failed: ["triage", "cancelled"],
  done: ["triage"],
  cancelled: ["triage"],
};

function TaskCard({ task, onOpen, draggable }: { task: Task; onOpen: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable, data: { status: task.status } });
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      // Drag attributes only when draggable: otherwise dnd-kit adds aria-disabled, which tells
      // screen readers the card itself is disabled although it still opens the task.
      {...(draggable ? { ...listeners, ...attributes } : {})}
      onClick={onOpen}
      className={cn(
        "grid w-full min-w-0 gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-left shadow-[0_1px_0_hsl(var(--shadow)/0.04)] transition-shadow hover:border-accent/40",
        draggable && "cursor-grab active:cursor-grabbing touch-manipulation",
        isDragging && "relative z-20 shadow-[var(--shadow-pop)] ring-2 ring-accent/40",
      )}
    >
      <p className="line-clamp-2 text-[13.5px] font-medium">{task.title}</p>
      {task.status === "blocked" && task.blocked_reason ? (
        <p className="line-clamp-2 text-[12px] text-warn">{task.blocked_reason}</p>
      ) : task.status === "failed" && task.error ? (
        <p className="line-clamp-2 text-[12px] text-danger">{task.error}</p>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        {task.assignee_name ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <AgentAvatar name={task.assignee_name} color={task.assignee_color ?? "#888"} size="xs" working={task.status === "running"} />
            <span className="truncate">{task.assignee_name}</span>
          </span>
        ) : <span className="truncate text-[12px] text-muted">Unassigned</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {task.pending_approvals ? <Pill tone="warn"><SealCheckIcon size={11} weight="fill" /> {task.pending_approvals}</Pill> : null}
          {task.priority === "high" || task.priority === "urgent" ? <Pill tone={PRIORITY_INFO[task.priority].tone}>{PRIORITY_INFO[task.priority].label}</Pill> : null}
          <time dateTime={task.updated_at} title={`Updated ${timeAgo(task.updated_at).toLowerCase()}`} className="whitespace-nowrap text-[11px] text-muted tabular">{shortAge(task.updated_at)}</time>
        </span>
      </div>
    </button>
  );
}

function Column({ status, hint, tasks, onOpen, canWrite, dragFrom }: { status: TaskStatus; hint: string; tasks: Task[]; onOpen: (id: string) => void; canWrite: boolean; dragFrom: TaskStatus | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const allowed = dragFrom ? (MOVES[dragFrom] ?? []).includes(status) : false;
  const info = STATUS_INFO[status];
  return (
    <section
      ref={setNodeRef}
      aria-label={info.label}
      className={cn(
        "flex w-[82vw] max-w-[19rem] shrink-0 snap-start flex-col rounded-[var(--radius-md)] border border-transparent bg-surface-2/50 sm:w-72 xl:w-auto xl:max-w-none xl:min-w-0",
        dragFrom && allowed && "border-dashed border-accent/50",
        isOver && allowed && "border-solid border-accent bg-accent-soft/40",
        dragFrom && !allowed && dragFrom !== status && "opacity-60",
      )}
    >
      <header className="grid gap-0.5 px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold">{info.label} <span className="ml-1 font-normal text-muted tabular">{tasks.length}</span></h2>
        <p className="text-[11.5px] text-muted">{hint}</p>
      </header>
      <div className="grid min-h-24 grid-cols-[minmax(0,1fr)] content-start gap-2 px-2 pb-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={() => onOpen(t.id)} draggable={canWrite && !!MOVES[t.status]} />
        ))}
      </div>
    </section>
  );
}

export function TasksPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { task?: string; new?: number; agent?: string; brief?: string };
  const { data: tasks, isLoading, error } = useQuery(tasksQuery);
  const [creating, setCreating] = useState(0);
  const [dragFrom, setDragFrom] = useState<TaskStatus | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    for (const t of tasks ?? []) m.set(t.status, [...(m.get(t.status) ?? []), t]);
    return m;
  }, [tasks]);
  const closed = [...(byStatus.get("failed") ?? []), ...(byStatus.get("cancelled") ?? [])];

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api<Task>(`/api/tasks/${id}`, "PATCH", { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: workKeys.tasks });
      const prev = qc.getQueryData<Task[]>(workKeys.tasks);
      qc.setQueryData<Task[]>(workKeys.tasks, (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(workKeys.tasks, ctx.prev);
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

  return (
    <Page className="max-w-none">
      <PageHeader
        title="Tasks"
        description="Everything your agents are working on. Drag a card to move it; agents move running work themselves."
        actions={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New task</Button> : null}
      />
      {isLoading ? (
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-72 shrink-0 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !tasks?.length ? (
        <EmptyState icon={KanbanIcon} title="No tasks yet" body="Give an agent something to do. It follows its SOPs, asks you before risky steps, and puts the result here for review."
          action={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Create first task</Button> : undefined} />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e) => setDragFrom((e.active.data.current?.status as TaskStatus) ?? null)} onDragCancel={() => setDragFrom(null)} onDragEnd={onDragEnd}>
          {/* Phones and tablets swipe between columns; wide screens see all six at once. */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 xl:mx-0 xl:grid xl:grid-cols-6 xl:overflow-visible xl:px-0">
            {COLUMNS.map((c) => (
              <Column key={c.status} status={c.status} hint={c.hint} tasks={byStatus.get(c.status) ?? []} onOpen={(id) => navigate({ to: "/tasks", search: { task: id } })} canWrite={canWrite} dragFrom={dragFrom} />
            ))}
          </div>
          {closed.length ? (
            <details className="mt-2 rounded-[var(--radius-md)] border border-border bg-surface">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[13px] font-medium">
                <WarningIcon size={15} className="text-muted" /> Failed and cancelled <span className="font-normal text-muted">{closed.length}</span>
              </summary>
              <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                {closed.map((t) => <TaskCard key={t.id} task={t} onOpen={() => navigate({ to: "/tasks", search: { task: t.id } })} draggable={false} />)}
              </div>
            </details>
          ) : null}
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
