/**
 * P109: the tasks page as a timeline (Gantt). A bar per task from its start to its due date
 * (a due date alone: that day), grouped by person, label or kind of work, zoomed to two weeks
 * or two months. The timeline scrolls sideways inside its frame; the page never does.
 * Loaded only when this view is opened (board.tsx lazy-loads it).
 */
import { CaretLeftIcon, CaretRightIcon, ChartBarHorizontalIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { categoryLabel, isoDay, spanOf } from "@/lib/people-tasks";
import { cn } from "@/lib/utils";
import { STATUS_INFO, workKeys, type Task } from "@/lib/work";

import { url, type ViewFilters } from "./team-views";

type Zoom = "week" | "month";
type Group = "person" | "label" | "kind";
const DAY = 86_400_000;
const ZOOM: Record<Zoom, { days: number; px: number }> = { week: { days: 14, px: 56 }, month: { days: 62, px: 22 } };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

const BAR: Record<string, string> = {
  neutral: "bg-muted/45",
  info: "bg-info",
  accent: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

/** Where a task's bar sits: whole days from the first day shown, and how many days long. */
export function barOf(t: Pick<Task, "start_at" | "due_at">, first: Date, days: number): { left: number; width: number } | null {
  const s = spanOf(t);
  if (!s) return null;
  const a = Math.floor((startOfDay(s.start).getTime() - first.getTime()) / DAY);
  const b = Math.floor((startOfDay(s.end).getTime() - first.getTime()) / DAY) + 1;
  if (b <= 0 || a >= days) return null;
  const left = Math.max(0, a);
  return { left, width: Math.max(1, Math.min(days, b) - left) };
}

/** The tasks in groups: by each person it is for (a task for two shows under both), label or kind. */
export function groupTasks(tasks: Task[], by: Group, none: string): [string, Task[]][] {
  const out = new Map<string, Task[]>();
  const put = (k: string, t: Task) => out.set(k, [...(out.get(k) ?? []), t]);
  for (const t of tasks) {
    if (by === "person") {
      const names = t.assignees?.length ? t.assignees.map((a) => a.name) : [t.assignee_user_name ?? t.assignee_name ?? none];
      names.forEach((n) => put(n, t));
    } else if (by === "label") {
      (t.labels?.length ? t.labels : [none]).forEach((l) => put(l, t));
    } else put(categoryLabel(t.category) ?? none, t);
  }
  return [...out.entries()].sort(([a], [b]) => (a === none ? 1 : b === none ? -1 : a.localeCompare(b)));
}

export function GanttView({ f, onOpen }: { f: ViewFilters; onOpen: (id: string) => void }) {
  const t = useT();
  const [zoom, setZoom] = useState<Zoom>("week");
  const [group, setGroup] = useState<Group>("person");
  const [first, setFirst] = useState(() => addDays(mondayOf(new Date()), -7));
  const { days, px } = ZOOM[zoom];
  const end = addDays(first, days);
  const { data = [], isLoading, error } = useQuery({
    queryKey: [...workKeys.tasks, "gantt", f, isoDay(first), zoom],
    queryFn: () => api<Task[]>(url(f, { span_from: first.toISOString(), span_to: end.toISOString() })),
  });
  const scroller = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());
  const todayAt = Math.floor((today.getTime() - first.getTime()) / DAY);
  // Open on today.
  useEffect(() => {
    const el = scroller.current;
    if (el && todayAt >= 0 && todayAt < days) el.scrollLeft = Math.max(0, todayAt * px - el.clientWidth / 3);
  }, [zoom, first, days, px, todayAt]);

  const shift = (n: number) => setFirst((d) => addDays(d, n * (zoom === "week" ? 7 : 28)));
  const groups = groupTasks(data, group, t(group === "person" ? "Unassigned" : group === "label" ? "No label" : "General"));
  const cols = Array.from({ length: days }, (_, i) => addDays(first, i));
  const width = days * px;

  return (
    <section aria-label={t("Timeline")} className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-10" aria-label={t("Earlier")} onClick={() => shift(-1)}><CaretLeftIcon size={15} /></Button>
          <Button variant="outline" size="icon" className="size-10" aria-label={t("Later")} onClick={() => shift(1)}><CaretRightIcon size={15} /></Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {first.toLocaleDateString(locale(), { day: "numeric", month: "short" })} – {addDays(end, -1).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setFirst(addDays(mondayOf(new Date()), -7))}>{t("Today")}</Button>
        <Segmented size="sm" label={t("Zoom")} value={zoom} onChange={setZoom} options={[{ value: "week", label: t("2 weeks") }, { value: "month", label: t("2 months") }]} />
        <Segmented size="sm" label={t("Group by")} value={group} onChange={setGroup}
          options={[{ value: "person", label: t("Person") }, { value: "label", label: t("Label") }, { value: "kind", label: t("Kind") }]} />
      </div>
      {error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : null}
      {isLoading ? <Skeleton className="h-80 rounded-[var(--radius-md)]" /> : !data.length ? (
        <EmptyState icon={ChartBarHorizontalIcon} title={t("Nothing on these dates")} body={t("Give tasks a start or due date to see them on the timeline.")} />
      ) : (
        <div className="grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface sm:grid-cols-[14rem_minmax(0,1fr)]">
          {/* Names: fixed on the left. */}
          <div className="min-w-0 border-r border-border">
            <div className="h-10 border-b border-border bg-surface-2/50" />
            {groups.map(([name, rows]) => (
              <div key={name}>
                <div className="flex h-8 items-center truncate border-b border-border/70 bg-surface-2/30 px-2.5 text-[12px] font-semibold">{name} <span className="ml-1.5 font-normal text-muted tabular">{rows.length}</span></div>
                {rows.map((task) => (
                  <button key={`${name}:${task.id}`} type="button" onClick={() => onOpen(task.id)} title={task.title}
                    className="flex h-10 w-full min-w-0 items-center border-b border-border/50 px-2.5 text-left text-[12.5px] hover:bg-surface-2/50">
                    <span className="truncate">{task.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* The timeline: scrolls sideways inside its frame. */}
          <div ref={scroller} className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
            <div className="relative" style={{ width }}>
              <div className="flex h-10 border-b border-border bg-surface-2/50">
                {cols.map((d) => (
                  <span key={isoDay(d)} style={{ width: px }}
                    className={cn("grid shrink-0 place-items-center border-r border-border/50 text-[10.5px] text-muted tabular", (d.getDay() === 0 || d.getDay() === 6) && "bg-surface-2/60", d.getTime() === today.getTime() && "font-semibold text-accent")}>
                    {zoom === "week" ? d.toLocaleDateString(locale(), { weekday: "narrow", day: "numeric" }) : d.getDate() === 1 || d.getDay() === 1 ? d.toLocaleDateString(locale(), { day: "numeric", month: d.getDate() === 1 ? "short" : undefined }) : ""}
                  </span>
                ))}
              </div>
              {todayAt >= 0 && todayAt < days ? (
                <span aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-accent/70" style={{ left: todayAt * px + px / 2 }} />
              ) : null}
              {groups.map(([name, rows]) => (
                <div key={name}>
                  <div className="h-8 border-b border-border/70 bg-surface-2/30" />
                  {rows.map((task) => {
                    const bar = barOf(task, first, days);
                    const tone = STATUS_INFO[task.status].tone;
                    return (
                      <div key={`${name}:${task.id}`} className="relative h-10 border-b border-border/50">
                        {bar ? (
                          <button type="button" onClick={() => onOpen(task.id)} title={task.title}
                            aria-label={t("{title}: {from} to {to}", { title: task.title, from: spanOf(task)!.start.toLocaleDateString(locale()), to: spanOf(task)!.end.toLocaleDateString(locale()) })}
                            className={cn("absolute top-2 h-6 min-w-2 overflow-hidden rounded-full px-2 text-left text-[11px] leading-6 font-medium text-white shadow-sm hover:brightness-110", BAR[tone])}
                            style={{ left: bar.left * px + 2, width: bar.width * px - 4 }}>
                            <span className="block truncate">{bar.width * px > 60 ? task.title : ""}</span>
                            {task.checklist_total ? (
                              <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-white/70" style={{ width: `${((task.checklist_done ?? 0) / task.checklist_total) * 100}%` }} />
                            ) : null}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
