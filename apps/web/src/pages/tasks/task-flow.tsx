/** What a person can do with a task beyond this run: hand it to another agent, run it again,
 * put it on a schedule, or turn how it was done into a workflow. */
import { ArrowsClockwiseIcon, DotsThreeIcon, FlowArrowIcon, RepeatIcon, UserSwitchIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AgentPicker } from "@/components/task-composer/agent-picker";
import { handOffWorkflowDraft, openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { SwitchField } from "@/components/ui/switch";
import { t as tr, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { agentsQuery, workKeys, type Task, type TaskDetail } from "@/lib/work";
import type { Graph } from "@/lib/workflows";

import type { TaskX } from "./accountable";

/** A run is going (the API refuses to move it to another agent until it stops). */
const isLive = (task: TaskX) => task.status === "running" || (task.status === "blocked" && !task.restartable);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TaskFlowMenu({ task }: { task: TaskX }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const canDraft = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const [reassigning, setReassigning] = useState(false);
  const drafting = useRef<string | number | null>(null);

  const again = useMutation({
    mutationFn: () => api<Task>("/api/tasks", "POST", {
      title: task.title, brief: task.brief, priority: task.priority, requires_review: task.requires_review,
      goal: task.goal ?? null, labels: task.labels ?? [], assignee_agent_id: task.assignee_agent_id, start: !!task.assignee_agent_id,
    }),
    onSuccess: (copy) => {
      void qc.invalidateQueries({ queryKey: workKeys.tasks });
      void qc.invalidateQueries({ queryKey: keys.status });
      toast.success(t("Started again as a new task. This one keeps its result."));
      void navigate({ to: "/tasks", search: { task: copy.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toFlow = useMutation({
    mutationFn: () => api<{ graph: Graph; name: string; description: string }>(`/api/tasks/${task.id}/to-workflow`, "POST"),
    onMutate: () => {
      drafting.current = toast.loading(t("Drafting a workflow from how this task was done…"));
    },
    onSettled: () => {
      if (drafting.current !== null) toast.dismiss(drafting.current);
      drafting.current = null;
    },
    onSuccess: (d) => {
      handOffWorkflowDraft({ name: d.name, description: t("Drafted from the task: {title}", { title: d.description }).slice(0, 300), graph: d.graph });
      toast.success(t("Drafted. Check the steps and who does them, then save it as a workflow."));
      void navigate({ to: "/workflows" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const repeat = () => openTaskComposer({
    kind: "general", repeat: true, agentId: task.assignee_agent_id ?? undefined, title: task.title, brief: task.brief,
    fromTask: { id: task.id, title: task.title, brief: task.brief, agentId: task.assignee_agent_id, requiresReview: task.requires_review },
  });

  const finished = task.status === "done" || task.status === "review";
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label={t("More for this task")}>
            <DotsThreeIcon size={16} weight="bold" /> {t("More")}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<UserSwitchIcon />} onSelect={() => setReassigning(true)}>{t("Reassign")}</MenuItem>
          {finished ? <MenuItem icon={<ArrowsClockwiseIcon />} disabled={again.isPending} onSelect={() => again.mutate()}>{t("Run again")}</MenuItem> : null}
          <MenuSeparator />
          <MenuItem icon={<RepeatIcon />} onSelect={repeat}>{t("Repeat on a schedule")}</MenuItem>
          {canDraft ? (
            <MenuItem icon={<FlowArrowIcon />} disabled={toFlow.isPending} onSelect={() => toFlow.mutate()}>{t("Turn into a workflow")}</MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      {reassigning ? <ReassignDialog task={task} onClose={() => setReassigning(false)} /> : null}
    </>
  );
}

function ReassignDialog({ task, onClose }: { task: TaskX; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of && !a.view_only && a.id !== task.assignee_agent_id);
  const [picked, setPicked] = useState(usable[0]?.id ?? "");
  const agentId = usable.some((a) => a.id === picked) ? picked : usable[0]?.id ?? "";
  const name = usable.find((a) => a.id === agentId)?.name ?? "";
  const live = isLive(task);
  const startable = ["triage", "ready", "failed", "cancelled", "blocked"].includes(task.status);
  const [startNow, setStartNow] = useState(startable);

  const save = useMutation({
    mutationFn: async () => {
      if (live) {
        // Stop this run first: the API moves only work that is not running.
        await api<Task>(`/api/tasks/${task.id}/cancel`, "POST");
        for (let i = 0; ; i++) {
          const d = await api<TaskDetail>(`/api/tasks/${task.id}`);
          if (!isLive(d.task as TaskX)) break;
          if (i >= 20) throw new ApiError(409, "still_running", tr("It is still stopping. Try again in a moment."));
          await sleep(750);
        }
      }
      await api<Task>(`/api/tasks/${task.id}`, "PATCH", { assignee_agent_id: agentId });
      if (live || startNow) await api<Task>(`/api/tasks/${task.id}/start`, "POST");
    },
    onSuccess: () => {
      for (const k of [workKeys.tasks, workKeys.task(task.id), workKeys.agents, keys.status]) void qc.invalidateQueries({ queryKey: k });
      toast.success(live || startNow ? t("{name} is on it.", { name }) : t("Handed to {name}.", { name }));
      onClose();
    },
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Reassign")} className="w-[min(94vw,40rem)]"
      description={task.assignee_name ? t("Hand this task from {name} to another agent.", { name: task.assignee_name }) : t("Pick the agent that does this task.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!agentId} loading={save.isPending} onClick={() => save.mutate()}>
            <UserSwitchIcon size={15} /> {live ? t("Stop and restart with {name}", { name }) : t("Reassign")}
          </Button>
        </>
      }>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {live ? (
          <p className="rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 px-3.5 py-3 text-[13px] text-warn">
            {t("{name} is working on it now. Reassigning stops this run and starts the task again with the new agent; the conversation so far stays with the task.", { name: task.assignee_name ?? "" })}
          </p>
        ) : null}
        {usable.length ? (
          <AgentPicker agents={usable} value={agentId} onChange={setPicked} label={t("Who")} />
        ) : (
          <p className="text-[13px] text-muted">{t("No other agent you can give work to.")}</p>
        )}
        {!live ? (
          <SwitchField checked={startNow} onCheckedChange={setStartNow} label={t("Start it with {name} now", { name: name || "…" })}
            hint={startNow ? t("A fresh run starts with the new agent.") : t("It waits until you start it.")} />
        ) : null}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}
