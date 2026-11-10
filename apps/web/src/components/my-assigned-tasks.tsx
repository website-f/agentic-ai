/**
 * P97: "Assigned to me": the tasks people gave me, for the workspace (my desk). New ones
 * first (with Accept), then by due date (overdue in red), each with its next step in one tap
 * (Accept, Start, Mark done). A tap on a task opens it on the board's sheet, where the person
 * comments, adds files, says what they wait for or hands a step to their AI.
 *
 * Reads GET /api/me/assigned-tasks; live task events refresh it (its key is under "tasks").
 * Drop it anywhere: <MyAssignedTasks /> (a titled card), or <MyAssignedTasks bare limit={3} />
 * for just the rows. `useAssignedCount()` gives the badge number (new + overdue).
 */
import { ArrowRightIcon, CheckCircleIcon, TrayArrowDownIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { PersonAvatar } from "@/components/person-avatar";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { assignedTasksQuery, PERSON_STATUS } from "@/lib/people";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { STATUS_INFO, type Task } from "@/lib/work";
import { DueChip, NextStepButton } from "@/pages/tasks/team-views";

/** How many of my tasks want me now: new (not taken yet) and overdue. */
export function useAssignedCount(): number {
  const { data } = useQuery(assignedTasksQuery);
  return data ? data.counts.new + data.counts.overdue : 0;
}

export function MyAssignedTasks({ limit = 6, bare, className }: { limit?: number; bare?: boolean; className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data, isLoading, error } = useQuery(assignedTasksQuery);
  const items = data?.items ?? [];
  const counts = data?.counts;
  const open = (task: Task) => navigate({ to: "/tasks", search: { task: task.id, who: "assigned" } });
  const rows = (
    <>
      {isLoading ? (
        <div className="grid gap-2 p-3">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : error ? (
        <p role="alert" className="p-3 text-[13px] text-danger">{errorMessage(error)}</p>
      ) : !items.length ? (
        <p className="flex items-center gap-2 p-4 text-[13px] text-muted">
          <CheckCircleIcon size={18} weight="duotone" className="shrink-0 text-ok" /> {t("Nothing given to you right now.")}
        </p>
      ) : (
        <ul className="grid min-w-0 divide-y divide-border">
          {items.slice(0, limit).map((task) => (
            <li key={task.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <button type="button" onClick={() => open(task)} className="flex min-h-11 min-w-0 flex-1 basis-52 items-center gap-2.5 text-left">
                <PersonAvatar name={task.created_by_name ?? "?"} size="sm" />
                <span className="grid min-w-0 gap-0.5">
                  <span className="line-clamp-2 text-[13.5px] font-medium break-words">{task.title}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {task.created_by_name ? <span className="truncate">{t("From {name}", { name: task.created_by_name })}</span> : null}
                    <Pill tone={task.status === "triage" ? "info" : STATUS_INFO[task.status].tone}>{t(PERSON_STATUS[task.status] ?? STATUS_INFO[task.status].label)}</Pill>
                    <DueChip task={task} />
                  </span>
                </span>
              </button>
              <NextStepButton task={task} meId={me.user.id} />
            </li>
          ))}
        </ul>
      )}
      {items.length > limit ? (
        <Link to="/tasks" search={{ who: "assigned" }} className="flex min-h-11 items-center justify-center gap-1 border-t border-border text-[12.5px] font-medium text-accent hover:bg-surface-2/50">
          {t("See all {n}", { n: items.length })} <ArrowRightIcon size={13} />
        </Link>
      ) : null}
    </>
  );
  if (bare) return <div className={className}>{rows}</div>;
  return (
    <section aria-labelledby="my-assigned-title" className={cn("min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface", className)}>
      <header className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <TrayArrowDownIcon size={17} weight="duotone" className="shrink-0 text-accent" />
        <h2 id="my-assigned-title" className="min-w-0 flex-1 truncate text-[14px] font-semibold">{t("Assigned to me")}</h2>
        {counts?.new ? <Pill tone="info">{counts.new === 1 ? t("1 new") : t("{n} new", { n: counts.new })}</Pill> : null}
        {counts?.overdue ? <Pill tone="danger">{counts.overdue === 1 ? t("1 overdue") : t("{n} overdue", { n: counts.overdue })}</Pill> : null}
        <Link to="/tasks" search={{ who: "assigned" }} className="shrink-0 text-[12.5px] font-medium text-accent hover:underline">{t("Open board")}</Link>
      </header>
      {rows}
    </section>
  );
}
