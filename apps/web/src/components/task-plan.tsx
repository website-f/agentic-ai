/** The agent's live plan (update_plan) and what its self-check found (P19). */
import { CheckCircleIcon, CircleDashedIcon, CircleIcon, ListChecksIcon, MinusCircleIcon, SealCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";

import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { TaskEvent } from "@/lib/work";

type Step = { text: string; status: "todo" | "doing" | "done" | "skipped" };

const ICON = {
  done: <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-ok" />,
  doing: <CircleDashedIcon size={16} weight="bold" className="shrink-0 animate-spin text-accent [animation-duration:3s]" />,
  todo: <CircleIcon size={16} className="shrink-0 text-muted" />,
  skipped: <MinusCircleIcon size={16} className="shrink-0 text-muted" />,
};

export function TaskPlan({ events }: { events: TaskEvent[] }) {
  const t = useT();
  const plan = [...events].reverse().find((e) => e.kind === "plan");
  const checks = events.filter((e) => e.kind === "selfcheck");
  const steps = ((plan?.data?.steps as Step[] | undefined) ?? []).filter((s) => s && s.text);
  if (!steps.length && !checks.length) return null;
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return (
    <section className="grid min-w-0 gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
      {steps.length ? (
        <>
          <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            <ListChecksIcon size={15} weight="duotone" className="text-muted" /> {t("Plan")}
            <Pill tone={done === steps.length ? "ok" : "accent"}>{t("{done} of {total} done", { done, total: steps.length })}</Pill>
          </h3>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
          </div>
          <ol className="grid min-w-0 gap-1.5">
            {steps.map((s, i) => (
              <li key={i} className={cn("flex min-w-0 items-start gap-2 text-[13px]", s.status === "skipped" && "text-muted line-through", s.status === "doing" && "font-medium")}>
                <span className="mt-0.5">{ICON[s.status] ?? ICON.todo}</span>
                <span className="min-w-0 break-words">{s.text}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {checks.map((c) => {
        const issues = ((c.data?.issues as string[] | undefined) ?? []).filter(Boolean);
        const ok = c.data?.ok !== false;
        return (
          <div key={c.id} className={cn("grid min-w-0 gap-1 text-[12.5px]", steps.length && "border-t border-border pt-2.5")}>
            <p className={cn("flex items-center gap-1.5 font-medium", ok ? "text-ok" : "text-warn")}>
              {ok ? <SealCheckIcon size={15} weight="fill" /> : <WarningCircleIcon size={15} weight="fill" />}
              {ok ? (c.data?.checked === false ? t("Self-check skipped (no reviewer model answered)") : t("Self-check passed before hand-in")) : t("Self-check caught problems, fixed before hand-in")}
            </p>
            {issues.length ? (
              <ul className="grid gap-0.5 pl-5 text-muted">
                {issues.map((x, i) => <li key={i} className="list-disc break-words">{x}</li>)}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
