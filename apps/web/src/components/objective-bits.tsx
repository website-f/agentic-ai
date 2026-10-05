/** P21 objectives on tasks: the picker (new-task dialog, task sheet), the chip on board cards,
 * the task sheet's "For objective / this request cost" panel, and (P23) a workflow run's link. */
import { CoinsIcon, PencilSimpleIcon, TargetIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Trans } from "@/components/trans";
import { Select } from "@/components/ui/select";
import { locale, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { objectiveKeys, objectivesQuery, pickerOptions, rm, STATUS, type RequestCost, type TaskObjective } from "@/lib/objectives";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";
import { runKeys, setRunObjective } from "@/lib/workflows";

const NONE = "__none";

/** "For objective…" select: active objectives the person sees, nested ones indented. Renders
 * nothing when there are none (the field would only be noise). */
export function ObjectivePicker({
  value,
  onChange,
  branchId,
  enabled = true,
  label: labelIn,
  hint: hintIn,
  bare,
  currentLabel,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Only objectives for every company or this one (the task's company). */
  branchId?: string | null;
  enabled?: boolean;
  label?: string;
  hint?: string | null;
  /** Just the select, no label or hint (inline editors). */
  bare?: boolean;
  /** The title of the current value, when it may no longer be active (kept selectable). */
  currentLabel?: string;
}) {
  const t = useT();
  const label = labelIn ?? t("For objective (optional)");
  const hint = hintIn === undefined ? t("Agents see why the work matters, and its cost counts toward the objective.") : hintIn;
  const { data = [] } = useQuery({ ...objectivesQuery("active"), enabled });
  const options = pickerOptions(data, branchId);
  if (value && currentLabel && !options.some((o) => o.value === value)) options.push({ value, label: currentLabel });
  if (!options.length && !value) return null;
  const select = (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      label={label}
      className="w-full min-w-0"
      options={[{ value: NONE, label: t("No objective") }, ...options]}
    />
  );
  if (bare) return select;
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {select}
      {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** The objective a task serves, as a small chip (board cards). */
export function ObjectiveChip({ title, className }: { title: string; className?: string }) {
  const t = useT();
  return (
    <span title={t("For objective: {title}", { title })} className={cn("inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border px-1.5 py-px text-[11px] text-muted", className)}>
      <TargetIcon size={11} weight="bold" className="shrink-0 text-accent" aria-hidden />
      <span className="truncate">{title}</span>
    </span>
  );
}

/** P23: a workflow run's objective in the run's header: a chip (opens the objective) with
 * Change, or "Link to an objective" when it has none. Changing it moves the run's step tasks. */
export function RunObjectiveLink({
  runId,
  branchId,
  objective,
  canWrite,
}: {
  runId: string;
  branchId: string | null | undefined;
  objective: { id: string; title: string } | null;
  canWrite: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const link = useMutation({
    mutationFn: (objective_id: string | null) => setRunObjective(runId, objective_id),
    onSuccess: (run, id) => {
      qc.setQueryData(runKeys.one(runId), run);
      qc.invalidateQueries({ queryKey: runKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: objectiveKeys.all });
      setEditing(false);
      toast.success(id ? t("The run and its steps now count toward the objective.") : t("Unlinked from the objective."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { data: active = [] } = useQuery({ ...objectivesQuery("active"), enabled: canWrite });
  const canLink = canWrite && pickerOptions(active, branchId).length > 0;
  if (!objective && !canLink) return null;

  if (editing) {
    return (
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
          <ObjectivePicker bare value={objective?.id ?? null} currentLabel={objective?.title} branchId={branchId} onChange={(id) => link.mutate(id)} />
        </div>
        <Button size="sm" variant="outline" className="pointer-coarse:min-h-9" disabled={link.isPending} onClick={() => setEditing(false)}>{t("Done")}</Button>
      </div>
    );
  }
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1">
      {objective ? (
        <Link to="/objectives" search={{ o: objective.id }} className="inline-flex min-h-9 max-w-full min-w-0 items-center hover:[&>span]:border-accent/50">
          <ObjectiveChip title={objective.title} className="py-0.5 text-[12px]" />
        </Link>
      ) : null}
      {canWrite ? (
        <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 pointer-coarse:min-h-9" onClick={() => setEditing(true)} aria-label={objective ? t("Change objective") : t("Link to an objective")}>
          {objective ? <><PencilSimpleIcon size={13} /> {t("Change")}</> : <><TargetIcon size={13} /> {t("Link to an objective")}</>}
        </Button>
      ) : null}
    </span>
  );
}

/** Task sheet: which objective the task serves (change it in place) and what the whole request
 * (this task, what it handed out, helpers and colleague questions) cost so far. */
export function TaskObjectivePanel({
  taskId,
  branchId,
  objective,
  request,
  canWrite,
}: {
  taskId: string;
  branchId: string | null | undefined;
  objective: TaskObjective | null | undefined;
  request: RequestCost | null | undefined;
  canWrite: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const link = useMutation({
    mutationFn: (objective_id: string | null) => api(`/api/tasks/${taskId}`, "PATCH", { objective_id }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: workKeys.task(taskId) });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: objectiveKeys.all });
      setEditing(false);
      toast.success(id ? t("Linked to the objective.") : t("Unlinked from the objective."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { data: active = [] } = useQuery({ ...objectivesQuery("active"), enabled: canWrite });
  const canLink = canWrite && pickerOptions(active, branchId).length > 0;
  if (!objective && !canLink && !(request && request.usd > 0)) return null;
  const many = (request?.tasks ?? 0) > 1;

  return (
    <section aria-label={t("Objective and cost")} className="grid min-w-0 grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
      {objective || canLink ? (
        <div className="grid min-w-0 gap-2 px-3.5 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <TargetIcon size={17} weight="duotone" className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              {objective ? (
                <>
                  <p className="text-[11.5px] text-muted">{t("For objective")}</p>
                  <Link to="/objectives" search={{ o: objective.id }} className="-my-1 flex min-h-9 items-center py-1 text-[13.5px] font-medium break-words hover:text-accent">
                    {objective.title}
                  </Link>
                  {objective.target || objective.parent_title ? (
                    <p className="text-[12.5px] break-words text-muted">
                      {objective.target}
                      {objective.target && objective.parent_title ? " · " : ""}
                      {objective.parent_title ? t("part of {title}", { title: objective.parent_title }) : ""}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="pt-0.5 text-[13px] text-muted">{t("Not linked to an objective. Link it so the agent knows why it matters and the cost is counted.")}</p>
              )}
            </div>
            {objective && objective.status !== "active" ? <Pill tone={STATUS[objective.status].tone} className="shrink-0">{t(STATUS[objective.status].label)}</Pill> : null}
            {canWrite && !editing ? (
              <Button size="sm" variant="ghost" className="shrink-0 pointer-coarse:min-h-9" onClick={() => setEditing(true)} aria-label={objective ? t("Change objective") : t("Link to an objective")}>
                <PencilSimpleIcon size={14} /> {objective ? t("Change") : t("Link it")}
              </Button>
            ) : null}
          </div>
          {editing ? (
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <ObjectivePicker bare value={objective?.id ?? null} currentLabel={objective?.title} branchId={branchId} onChange={(id) => link.mutate(id)} />
              <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => setEditing(false)}>{t("Done")}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {request ? (
        <p className="flex min-w-0 items-start gap-2.5 px-3.5 py-2.5 text-[13px]" title={t("US${usd} · {tokens} tokens", { usd: request.usd.toFixed(4), tokens: request.tokens.toLocaleString(locale()) })}>
          <CoinsIcon size={16} weight="duotone" className="mt-px shrink-0 text-muted" aria-hidden />
          <span className="min-w-0">
            <Trans
              text={many ? t("This request cost {cost} across {n} tasks") : t("This task cost {cost}")}
              values={{ cost: <span className="font-semibold tabular">{rm(request.usd)}</span>, n: <span className="tabular">{request.tasks}</span> }}
            />
            {many && request.root_task_id !== taskId ? (
              <> · <Link to="/tasks" search={{ task: request.root_task_id }} className="text-accent hover:underline">{t("open the request")}</Link></>
            ) : null}
          </span>
        </p>
      ) : null}
    </section>
  );
}
