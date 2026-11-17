/**
 * P109: the tasks page as a calendar. Month or week; each task sits on the days from its start
 * to its due date (a due date alone: that day). Pick a day to see its tasks in the side panel
 * (below on phones); drag a task to another day to move it (start and due move together).
 * Loaded only when this view is opened (board.tsx lazy-loads it).
 */
import { CaretLeftIcon, CaretRightIcon, CalendarBlankIcon, CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { AssigneeFace, assigneeName } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { isoDay, spanOf } from "@/lib/people-tasks";
import { cn } from "@/lib/utils";
import { STATUS_INFO, workKeys, type Task } from "@/lib/work";

import { ChecklistBar } from "./people-detail";
import { statusText, url, type ViewFilters } from "./team-views";

type Mode = "month" | "week";
const DAY = 86_400_000;

/** Monday of the week `d` is in, at midnight. */
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);

/** The days shown: six weeks around the month, or one week. */
export function visibleDays(anchor: Date, mode: Mode): Date[] {
  const first = mode === "month" ? mondayOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : mondayOf(anchor);
  return Array.from({ length: mode === "month" ? 42 : 7 }, (_, i) => addDays(first, i));
}

/** The tasks on a day: those whose span covers it. */
export function tasksOn(tasks: Task[], day: Date): Task[] {
  const start = day.getTime();
  const end = start + DAY - 1;
  return tasks.filter((t) => {
    const s = spanOf(t);
    return !!s && s.start.getTime() <= end && s.end.getTime() >= start;
  });
}

const TONE: Record<string, string> = {
  neutral: "border-l-muted/50 bg-surface-2/80",
  info: "border-l-info bg-info/10",
  accent: "border-l-accent bg-accent-soft/70",
  warn: "border-l-warn bg-warn/10",
  ok: "border-l-ok bg-ok/10 text-muted line-through",
  danger: "border-l-danger bg-danger/10",
};

export function CalendarView({ f, onOpen, canWrite }: { f: ViewFilters; onOpen: (id: string) => void; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [picked, setPicked] = useState(() => new Date());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const days = visibleDays(anchor, mode);
  const from = days[0]!;
  const to = addDays(days[days.length - 1]!, 1);
  const key = [...workKeys.tasks, "calendar", f, isoDay(from), mode] as const;
  const { data = [], isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Task[]>(url(f, { span_from: from.toISOString(), span_to: to.toISOString() })),
  });
  const move = useMutation({
    mutationFn: ({ task, day }: { task: Task; day: Date }) => {
      const span = spanOf(task)!;
      const base = new Date(task.due_at ?? task.start_at!);
      const shift = Math.round((day.getTime() - new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) / DAY) * DAY;
      const body: Record<string, string> = {};
      if (task.due_at) body.due_at = new Date(new Date(task.due_at).getTime() + shift).toISOString();
      if (task.start_at) body.start_at = new Date(span.start.getTime() + shift).toISOString();
      return api<Task>(`/api/tasks/${task.id}`, "PATCH", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(t("Moved."), { duration: 1500 });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const step = (n: number) => setAnchor((a) => (mode === "month" ? new Date(a.getFullYear(), a.getMonth() + n, 1) : addDays(a, 7 * n)));
  const title = mode === "month"
    ? anchor.toLocaleDateString(locale(), { month: "long", year: "numeric" })
    : `${days[0]!.toLocaleDateString(locale(), { day: "numeric", month: "short" })} – ${days[6]!.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}`;
  const today = new Date();
  const dayTasks = tasksOn(data, picked);
  const undated = data.length === 0 && !isLoading;
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(locale(), { weekday: "short" }));

  const onDrop = (e: DragEvent, day: Date) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/task");
    const task = data.find((x) => x.id === id);
    if (task && !sameDay(new Date(task.due_at ?? task.start_at ?? 0), day)) move.mutate({ task, day });
  };

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label={t("Calendar")} className="grid min-w-0 content-start gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-10" aria-label={t("Earlier")} onClick={() => step(-1)}><CaretLeftIcon size={15} /></Button>
            <Button variant="outline" size="icon" className="size-10" aria-label={t("Later")} onClick={() => step(1)}><CaretRightIcon size={15} /></Button>
          </div>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold capitalize">{title}</h2>
          <Button variant="ghost" size="sm" onClick={() => { setAnchor(new Date()); setPicked(new Date()); }}>{t("Today")}</Button>
          <Segmented size="sm" label={t("Calendar view")} value={mode} onChange={setMode} options={[{ value: "month", label: t("Month") }, { value: "week", label: t("Week") }]} />
        </div>
        {error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : null}
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2/50 text-center text-[11.5px] font-medium text-muted">
            {weekdays.map((w) => <span key={w} className="truncate px-1 py-1.5">{w}</span>)}
          </div>
          {isLoading ? <Skeleton className="h-96 rounded-none" /> : (
            <div className={cn("grid grid-cols-7", mode === "month" ? "auto-rows-[minmax(4.5rem,1fr)] sm:auto-rows-[minmax(6.5rem,1fr)]" : "auto-rows-[minmax(14rem,1fr)]")}>
              {days.map((d) => {
                const list = tasksOn(data, d);
                const iso = isoDay(d);
                const out = mode === "month" && d.getMonth() !== anchor.getMonth();
                const max = mode === "month" ? 3 : 12;
                return (
                  <div key={iso} role="button" tabIndex={0} aria-label={t("{day}: {n} tasks", { day: d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }), n: list.length })}
                    aria-pressed={sameDay(d, picked)}
                    onClick={() => setPicked(d)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(d); } }}
                    onDragOver={canWrite ? (e) => { e.preventDefault(); setDragOver(iso); } : undefined}
                    onDragLeave={() => setDragOver((v) => (v === iso ? null : v))}
                    onDrop={canWrite ? (e) => onDrop(e, d) : undefined}
                    className={cn("grid min-w-0 content-start gap-0.5 border-r border-b border-border/70 p-1 text-left outline-none transition-colors [&:nth-child(7n)]:border-r-0 focus-visible:bg-accent-soft/40",
                      out && "bg-surface-2/40 text-muted", sameDay(d, picked) && "bg-accent-soft/40", dragOver === iso && "bg-accent-soft ring-2 ring-accent ring-inset")}>
                    <span className={cn("mb-0.5 inline-grid size-6 place-items-center justify-self-start rounded-full text-[12px] tabular", sameDay(d, today) && "bg-accent font-semibold text-accent-fg")}>{d.getDate()}</span>
                    {list.slice(0, max).map((task) => (
                      <button key={task.id} type="button" draggable={canWrite}
                        onDragStart={(e) => { e.dataTransfer.setData("text/task", task.id); e.dataTransfer.effectAllowed = "move"; }}
                        onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                        title={task.title}
                        className={cn("hidden min-w-0 truncate rounded-[4px] border-l-[3px] px-1 py-px text-left text-[11px] leading-snug hover:brightness-95 sm:block", TONE[STATUS_INFO[task.status].tone])}>
                        {task.title}
                      </button>
                    ))}
                    {list.length ? (
                      <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                        {list.slice(0, 4).map((task) => <span key={task.id} className={cn("size-1.5 rounded-full", task.status === "done" ? "bg-ok" : "bg-accent")} />)}
                      </span>
                    ) : null}
                    {list.length > max ? <span className="hidden text-[10.5px] text-muted sm:block">{t("+{n} more", { n: list.length - max })}</span> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {canWrite ? <p className="hidden text-[11.5px] text-muted sm:block">{t("Drag a task to another day to move its dates.")}</p> : null}
      </section>

      <aside aria-label={t("Tasks on the day")} className="grid min-w-0 content-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3 lg:sticky lg:top-3">
        <h3 className="text-[13px] font-semibold capitalize">{picked.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}</h3>
        {undated ? (
          <EmptyState icon={CalendarBlankIcon} title={t("Nothing on these dates")} body={t("Tasks with a start or due date show on the calendar.")} />
        ) : !dayTasks.length ? (
          <p className="text-[13px] text-muted">{t("No tasks on this day.")}</p>
        ) : (
          <ul className="grid min-w-0 gap-1.5">
            {dayTasks.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => onOpen(task.id)}
                  className="grid min-h-11 w-full min-w-0 gap-1 rounded-[var(--radius-sm)] border border-border px-2.5 py-2 text-left hover:border-accent/40 hover:bg-surface-2/40">
                  <span className="flex min-w-0 items-start gap-2">
                    {task.status === "done" ? <CheckIcon size={14} weight="bold" className="mt-0.5 shrink-0 text-ok" /> : <AssigneeFace task={task} />}
                    <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium break-words">{task.title}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    <Pill tone={STATUS_INFO[task.status].tone}>{statusText(task, t)}</Pill>
                    <span className="truncate">{(task.assignees?.length ?? 0) > 1 ? task.assignees!.map((a) => a.name).join(", ") : assigneeName(task) ?? t("Unassigned")}</span>
                    {task.due_at ? <span className="tabular">{t("Due {when}", { when: new Date(task.due_at).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }) })}</span> : null}
                    <ChecklistBar done={task.checklist_done ?? 0} total={task.checklist_total ?? 0} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
