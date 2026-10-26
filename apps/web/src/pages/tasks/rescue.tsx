/** P38: a way out of any stuck or failed task: stop it now, finish it myself, or run it again
 * on another AI (api/routers/task_rescue.py). */
import { ArrowsClockwiseIcon, CheckSquareOffsetIcon, StopCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { msg, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { workKeys, type Task } from "@/lib/work";

const GROUPS = [
  { value: "smart", label: msg("Smart"), hint: msg("Best quality") },
  { value: "fast", label: msg("Fast"), hint: msg("Quick and cheap") },
  { value: "bulk", label: msg("Bulk"), hint: msg("Free tiers first") },
  { value: "reasoning", label: msg("Reasoning"), hint: msg("Thinks harder, slower") },
];

function useRescue(task: Task, done: () => void) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ path, body, force }: { path: "stop" | "finish" | "retry-with"; body?: unknown; force?: boolean }) =>
      api<Task>(`/api/tasks/${task.id}/${path}${force ? "?force=true" : ""}`, "POST", body ?? {}),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.task(task.id) });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success({ stop: t("Stopped."), finish: t("Marked done with your result."), "retry-with": t("Started again.") }[v.path]);
      done();
    },
    // P51: the worker service is down: the person can still end it (a run that wakes up later
    // finds it closed and stops by itself).
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === "temporal_unavailable" && v.path !== "retry-with") {
        toast.error(e.message, { action: { label: t("End it anyway"), onClick: () => m.mutate({ ...v, force: true }) }, duration: 15_000 });
      } else toast.error(errorMessage(e));
    },
  });
  return m;
}

export function RescueActions({ task }: { task: Task }) {
  const t = useT();
  const [finishing, setFinishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState("");
  const [group, setGroup] = useState("fast");
  const close = () => {
    setFinishing(false);
    setRetrying(false);
    setResult("");
  };
  const rescue = useRescue(task, close);
  const s = task.status;
  const live = s === "running" || s === "blocked";
  if (s === "done" || s === "cancelled") return null;
  return (
    <>
      {live ? (
        <Button size="sm" variant="ghost" disabled={rescue.isPending} onClick={() => rescue.mutate({ path: "stop" })}
          title={t("Stops the run at once, even in the middle of a long step")}>
          <StopCircleIcon size={14} /> {t("Stop now")}
        </Button>
      ) : null}
      {(live || s === "failed") && task.assignee_agent_id ? (
        <Button size="sm" variant="outline" disabled={rescue.isPending} onClick={() => setRetrying(true)}>
          <ArrowsClockwiseIcon size={14} /> {t("Try another AI")}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={rescue.isPending} onClick={() => setFinishing(true)}>
        <CheckSquareOffsetIcon size={14} /> {t("I'll finish it myself")}
      </Button>

      <ResponsiveDialog open={finishing} onOpenChange={(o) => !o && close()} title={t("Finish it yourself")}
        description={t("The task is marked done with what you write here. Any run still going is stopped first, and work waiting on this task can go ahead.")}
        footer={<>
          <Button variant="outline" onClick={close}>{t("Cancel")}</Button>
          <Button disabled={!result.trim()} loading={rescue.isPending} onClick={() => rescue.mutate({ path: "finish", body: { result } })}>{t("Mark done")}</Button>
        </>}>
        <div className="grid gap-2">
          <label htmlFor={`finish-${task.id}`} className="text-[13px] font-medium">{t("What was done")}</label>
          <textarea id={`finish-${task.id}`} autoFocus rows={5} value={result} onChange={(e) => setResult(e.target.value)}
            placeholder={t("e.g. I called the supplier: delivery moved to Friday.")}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
          <FormError message={rescue.error ? errorMessage(rescue.error) : null} />
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog open={retrying} onOpenChange={(o) => !o && close()} title={t("Run it again on another AI")}
        description={t("The current run is stopped and the same agent starts again from where it was, on the AI you pick. Useful when a provider is down or the answer was weak.")}
        footer={<>
          <Button variant="outline" onClick={close}>{t("Cancel")}</Button>
          <Button loading={rescue.isPending} onClick={() => rescue.mutate({ path: "retry-with", body: { model_group: group } })}>{t("Start again")}</Button>
        </>}>
        <div className="grid gap-2">
          <Select value={group} onValueChange={setGroup} label={t("AI to use")} className="w-full"
            options={GROUPS.map((g) => ({ value: g.value, label: t(g.label), hint: t(g.hint) }))} />
          <FormError message={rescue.error ? errorMessage(rescue.error) : null} />
        </div>
      </ResponsiveDialog>
    </>
  );
}
