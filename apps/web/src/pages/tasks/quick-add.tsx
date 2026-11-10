/**
 * P97: add a task in one line: what, for whom (a person or an AI agent), when it is due and
 * how urgent. Enter adds it. A person gets it in their workspace ("For me") with a notice; an
 * agent starts on it. "More options" opens the full task composer.
 */
import { ArrowsOutSimpleIcon, CalendarBlankIcon, FlagIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AssigneePicker, type AssigneeValue } from "@/components/assignee-picker";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { Calendar, PickerPanel } from "@/components/ui/date-picker";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { dueIn, dueLabel } from "@/lib/people";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { PRIORITY_INFO, workKeys, type Priority, type Task } from "@/lib/work";

const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export interface QuickTask {
  title: string;
  assignee: AssigneeValue;
  due: string | null;
  priority: Priority;
}

/** The body POST /api/tasks takes for a quick task. A person's task waits for them; an agent starts. */
export function quickBody(q: QuickTask) {
  const [kind, id] = q.assignee ? (q.assignee.split(/:(.*)/s) as [string, string]) : ["", ""];
  return {
    title: q.title.trim(),
    priority: q.priority,
    due_at: q.due,
    ...(kind === "user" ? { assignee_user_id: id, requires_review: false } : {}),
    ...(kind === "agent" ? { assignee_agent_id: id, start: true } : {}),
  };
}

const QUICK_DUE: { days: number; label: string }[] = [
  { days: 0, label: msg("Today") },
  { days: 1, label: msg("Tomorrow") },
  { days: 7, label: msg("In a week") },
];

/** A due date in one tap (today, tomorrow, a week) or from the calendar; 17:00 local time. */
/** `compact`: once a date is set, only the calendar icon (the due chip beside it says when). */
export function DuePicker({ value, onChange, compact }: { value: string | null; onChange: (iso: string | null) => void; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const day = value ? new Date(value) : null;
  const iso = day ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}` : null;
  return (
    <PickerPanel open={open} onOpenChange={setOpen} title={t("Due")}
      trigger={
        <button type="button" aria-label={t("Due: {value}", { value: value ? dueLabel(value, locale()) : t("No date") })}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[12.5px] hover:bg-surface-2 pointer-coarse:h-11", value && "border-accent/40 text-accent", compact && "px-2")}>
          <CalendarBlankIcon size={14} />
          {compact && value ? null : <span className="whitespace-nowrap">{value ? dueLabel(value, locale()) : t("Due")}</span>}
        </button>
      }>
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DUE.map((d) => (
            <button key={d.days} type="button" onClick={() => { onChange(dueIn(d.days)); setOpen(false); }}
              className="h-9 rounded-full border border-border px-3 text-[12.5px] hover:border-accent/40 hover:text-accent pointer-coarse:h-11">{t(d.label)}</button>
          ))}
          {value ? (
            <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="h-9 rounded-full px-3 text-[12.5px] text-muted hover:text-danger pointer-coarse:h-11">{t("No date")}</button>
          ) : null}
        </div>
        <Calendar value={iso} onChange={(d) => {
          const [y, m, dd] = d.split("-").map(Number);
          onChange(new Date(y ?? 2000, (m ?? 1) - 1, dd ?? 1, 17, 0, 0).toISOString());
          setOpen(false);
        }} />
      </div>
    </PickerPanel>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const t = useT();
  const next = PRIORITIES[(PRIORITIES.indexOf(value) + 1) % PRIORITIES.length]!;
  return (
    <button type="button" onClick={() => onChange(next)} aria-label={t("Priority: {value}. Tap to change.", { value: t(PRIORITY_INFO[value].label) })}
      className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[12.5px] hover:bg-surface-2 pointer-coarse:h-11",
        value === "high" && "border-warn/40 text-warn", value === "urgent" && "border-danger/40 text-danger", value === "low" && "text-muted")}>
      <FlagIcon size={14} weight={value === "high" || value === "urgent" ? "fill" : "regular"} />
      <span>{t(PRIORITY_INFO[value].label)}</span>
    </button>
  );
}

export function QuickAdd({ defaultAssignee = "", onAdded, autoFocus, className }: {
  defaultAssignee?: AssigneeValue;
  onAdded?: (t: Task) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState<QuickTask>({ title: "", assignee: defaultAssignee, due: null, priority: "normal" });
  const add = useMutation({
    mutationFn: () => api<Task>("/api/tasks", "POST", quickBody(q)),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(task.assignee_user_name ? t("Given to {name}.", { name: task.assignee_user_name }) : task.assignee_name ? t("{name} is on it.", { name: task.assignee_name }) : t("Task added."));
      setQ((s) => ({ ...s, title: "", due: null, priority: "normal" }));
      onAdded?.(task);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ready = q.title.trim().length > 0 && !add.isPending;
  return (
    <form data-guide="tasks.quick" onSubmit={(e) => { e.preventDefault(); if (ready) add.mutate(); }}
      className={cn("grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-2 shadow-[0_1px_2px_hsl(var(--shadow)/0.05)] focus-within:border-accent/50 focus-within:ring-3 focus-within:ring-accent/15 md:flex md:items-center", className)}>
      <label className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <PlusIcon size={16} weight="bold" className="shrink-0 text-muted" />
        <span className="sr-only">{t("New task")}</span>
        <input value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} maxLength={200} autoFocus={autoFocus}
          placeholder={t("Add a task and press Enter")} className="h-9 w-full min-w-0 bg-transparent text-[14px] placeholder:text-muted/80 focus-visible:outline-none pointer-coarse:h-11" />
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <AssigneePicker compact value={q.assignee} onChange={(v) => setQ({ ...q, assignee: v })} label={t("For whom")} className="max-w-[12rem]" />
        <DuePicker value={q.due} onChange={(due) => setQ({ ...q, due })} />
        <PriorityPicker value={q.priority} onChange={(priority) => setQ({ ...q, priority })} />
        <Button type="button" size="icon" variant="ghost" className="size-9 pointer-coarse:size-11" aria-label={t("More options")} title={t("More options")}
          onClick={() => openTaskComposer({ brief: q.title, agentId: q.assignee.startsWith("agent:") ? q.assignee.slice(6) : undefined })}>
          <ArrowsOutSimpleIcon size={15} />
        </Button>
        <Button type="submit" size="sm" disabled={!ready} loading={add.isPending} className="ml-auto h-9 pointer-coarse:h-11 md:ml-0">{t("Add")}</Button>
      </div>
    </form>
  );
}
