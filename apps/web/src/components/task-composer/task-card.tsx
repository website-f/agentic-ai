/** A task shown in place (in a chat): its title, who has it and a status that follows the work. */
import { ArrowRightIcon, KanbanIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { AgentAvatar } from "@/components/agent-avatar";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { STATUS_INFO, taskQuery, type TaskStatus } from "@/lib/work";

/** Finished states stop the polling; the rest follow the work. */
const SETTLED: TaskStatus[] = ["done", "failed", "cancelled", "review"];

export function TaskCard({ taskId, className }: { taskId: string; className?: string }) {
  const t = useT();
  // Live events refresh it inside the app shell; the full-screen chat has none, so it polls
  // gently while the work is still going.
  const { data, isLoading, error } = useQuery({
    ...taskQuery(taskId),
    refetchInterval: (q) => (q.state.data && SETTLED.includes(q.state.data.task.status) ? false : 5000),
  });
  if (isLoading) return <Skeleton className={cn("h-16 rounded-[var(--radius-md)]", className)} />;
  if (error || !data) return null;
  const task = data.task;
  const info = STATUS_INFO[task.status];
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/30 px-3.5 py-2.5", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-accent"><KanbanIcon size={17} weight="duotone" /></span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13.5px] font-medium break-words">{task.title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
          <Pill tone={info.tone} live={task.status === "running"} className="px-1.5 py-0 text-[10.5px]">{t(info.label)}</Pill>
          {task.assignee_name ? (
            <span className="inline-flex min-w-0 items-center gap-1"><AgentAvatar name={task.assignee_name} color={task.assignee_color ?? "#888"} size="xs" /> <span className="truncate">{task.assignee_name}</span></span>
          ) : null}
        </span>
      </span>
      <Link to="/tasks" search={{ task: task.id }} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-sm px-2.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft">
        {t("Open|verb")} <ArrowRightIcon size={13} />
      </Link>
    </div>
  );
}
