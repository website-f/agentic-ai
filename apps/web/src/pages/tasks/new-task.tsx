import { FileIcon, FlowArrowIcon, HourglassMediumIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { ObjectivePicker } from "@/components/objective-bits";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { meQuery } from "@/lib/queries";
import { agentsQuery, canShareTasks, VISIBILITY, workKeys, type Priority, type Task, type Visibility } from "@/lib/work";
import { runKeys, workflowsQuery, type Run } from "@/lib/workflows";

import { TaskPicker, type TaskRef } from "./accountable";

const NO_FLOW = "__none";

export function NewTaskDialog({
  open,
  onOpenChange,
  initialAgent,
  initialBrief,
  initialObjective,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialAgent?: string;
  initialBrief?: string;
  /** P21: the objective picked in advance (from an objective's "New task"). */
  initialObjective?: string;
  onCreated: (t: Task) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  // Only agents the viewer may instruct: colleagues' agents they just watch (view_only) are left out.
  const active = agents.filter((a) => a.status === "active" && !a.clone_of && !a.view_only);
  const [title, setTitle] = useState(initialBrief ? initialBrief.split("\n")[0]!.slice(0, 120) : "");
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [picked, setAgent] = useState(initialAgent ?? "none");
  // A link like ?agent=<a watched agent> falls back to triage instead of a task the API refuses.
  const agent = agents.find((a) => a.id === picked)?.view_only ? "none" : picked;
  const [priority, setPriority] = useState<Priority>("normal");
  const { data: me } = useSuspenseQuery(meQuery);
  const canShare = canShareTasks(me.permissions);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [review, setReview] = useState(true);
  const [startNow, setStartNow] = useState(true);
  const [labels, setLabels] = useState("");
  const [goal, setGoal] = useState("");
  const [objective, setObjective] = useState<string | null>(initialObjective ?? null);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [flow, setFlow] = useState(NO_FLOW);
  const [flowMode, setFlowMode] = useState<"follow" | "run">("follow");
  const [after, setAfter] = useState<TaskRef[]>([]);
  const [showAfter, setShowAfter] = useState(false);
  const { data: workflows = [] } = useQuery({ ...workflowsQuery, enabled: open });
  const navigate = useNavigate();
  const branchId = active.find((a) => a.id === agent)?.branch_id ?? null;
  const runMode = flow !== NO_FLOW && flowMode === "run";

  // Run it step by step: each step to its suggested agent, else to the agent picked here.
  const startRun = useMutation({
    mutationFn: async () => {
      const plan = await api<{ suggested: Record<string, string>; needs: { node_id: string }[] }>(
        `/api/workflows/${flow}/assignments${branchId ? `?branch_id=${branchId}` : ""}`,
      );
      const fallback = agent === "none" ? null : agent;
      const assign = Object.fromEntries(
        plan.needs.map((n) => [n.node_id, plan.suggested[n.node_id] ?? fallback]).filter(([, v]) => v),
      );
      return api<Run>(`/api/workflows/${flow}/runs`, "POST", {
        title, input: brief, branch_id: branchId, assign, file_ids: files.map((f) => f.id),
      });
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: runKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(t("Started. Each step goes to its agent; decisions come to you."));
      onOpenChange(false);
      navigate({ to: "/workflows", search: { run: run.id } });
    },
  });

  const create = useMutation({
    mutationFn: () => api<Task>("/api/tasks", "POST", {
      title, brief, priority, requires_review: review, goal: goal.trim() || null,
      labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
      assignee_agent_id: agent === "none" ? null : agent, start: agent !== "none" && startNow,
      file_ids: files.map((f) => f.id), workflow_id: flow === NO_FLOW ? null : flow,
      blocked_by: after.map((a) => a.id),
      objective_id: objective,
      ...(canShare ? { visibility } : {}),
    }),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(task.status === "blocked" ? t("Created. It starts when the tasks it waits for are done.") : task.status === "ready" || task.run_count ? t("{name} is on it.", { name: task.assignee_name ?? "" }) : t("Task created."));
      onCreated(task);
    },
  });
  const fields = create.error instanceof ApiError ? create.error.fields : {};

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("New task")}
      description={t("Say what you need and what done looks like. The agent follows its SOPs.")}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          {runMode ? (
            <Button disabled={!title.trim()} loading={startRun.isPending} onClick={() => startRun.mutate()}>
              <FlowArrowIcon size={15} /> {t("Start the workflow")}
            </Button>
          ) : (
            <Button disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              {agent !== "none" && startNow ? t("Create and start") : t("Create task")}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Field label={t("Title")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Reconcile September bank statements")} autoFocus error={fields.title} />
        <TextareaField label={t("Brief")} value={brief} onChange={(e) => setBrief(e.target.value)} rows={5}
          placeholder={t("Context, inputs, constraints and the format you want back.")} hint={t("Markdown works.")} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Assign to")}</span>
            <Select value={agent} onValueChange={setAgent} label={t("Assign to")}
              options={[{ value: "none", label: t("Nobody yet (triage)") }, ...active.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Priority")}</span>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} label={t("Priority")}
              options={[{ value: "low", label: t("Low") }, { value: "normal", label: t("Normal") }, { value: "high", label: t("High") }, { value: "urgent", label: t("Urgent") }]} />
          </div>
        </div>
        {canShare ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Who can see it")}</span>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)} label={t("Who can see it")}
              options={VISIBILITY.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) }))} />
            <span className="text-[12px] text-muted">{t("Others may look at it, read only. Only managers and owners can change this.")}</span>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-1.5">
          <span className="text-[13px] font-medium">{t("Files for the agent")} {files.length ? <span className="font-normal text-muted">({files.length})</span> : null}</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-dashed border-border bg-surface-2/40 p-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
                <FileIcon size={13} className="shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                <button type="button" aria-label={t("Remove {name}", { name: f.name })} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
              </span>
            ))}
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> {files.length ? t("Add more") : t("Attach or upload")}</Button>
          </div>
          <p className="text-[12px] text-muted">{t("Already read and summarised; the agent opens only what it needs.")}</p>
        </div>
        {workflows.length ? (
          <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border p-3">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Follow a workflow (optional)")}</span>
              <Select value={flow} onValueChange={setFlow} label={t("Workflow")}
                options={[{ value: NO_FLOW, label: t("No, just this brief") }, ...workflows.map((w) => ({ value: w.id, label: w.name, hint: w.status === "active" ? t("{n} steps · active", { n: w.steps }) : t("{n} steps", { n: w.steps }) }))]} />
            </div>
            {flow !== NO_FLOW ? (
              <>
                <Segmented label={t("How")} value={flowMode} onChange={setFlowMode} className="w-full [&>button]:flex-1 [&>button]:justify-center"
                  options={[{ value: "follow", label: t("Agent follows it") }, { value: "run", label: t("Run step by step") }]} />
                <p className="text-[12px] text-muted">
                  {flowMode === "follow"
                    ? t("The agent gets the workflow's steps with this brief and works through them, asking you where a step needs a person.")
                    : t("Each step becomes its own task for the right agent (the one picked above fills any gaps); decisions, answers and reviews come to you.")}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {!runMode ? <ObjectivePicker value={objective} onChange={setObjective} branchId={branchId} enabled={open} /> : null}
        <Field label={t("Labels (optional)")} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("e.g. tender, invoice")}
          hint={t("What kind of work this is. The company overview counts work by label per branch.")} />
        <Field label={t("Keep going until (optional)")} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder={t("e.g. all 12 invoices are reconciled and the totals match")}
          hint={t("If set, the agent keeps working and a check re-runs it until this is true (up to a few tries).")} />
        {!runMode ? (
          <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border p-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-1.5 text-[13px] font-medium"><HourglassMediumIcon size={14} className="shrink-0 text-muted" /> {t("Start after other tasks (optional)")} {after.length ? <span className="font-normal text-muted">({after.length})</span> : null}</span>
                <span className="text-[12px] text-muted">{t("It waits, then starts by itself when they are all done. If one is cancelled or fails, you decide.")}</span>
              </span>
              {!showAfter && !after.length ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowAfter(true)}>{t("Pick")}</Button> : null}
            </div>
            {showAfter || after.length ? <TaskPicker value={after} onChange={setAfter} /> : null}
          </div>
        ) : null}
        {agent !== "none" ? <SwitchField checked={startNow} onCheckedChange={setStartNow} label={after.length ? t("Start by itself when they are done") : t("Start now")} hint={after.length ? t("Off: it moves to Ready when they are done, and waits for you to start it.") : t("Otherwise it waits in Ready until you start it.")} /> : null}
        <SwitchField checked={review} onCheckedChange={setReview} label={t("I review the result")} hint={t("Finished work waits in review until you accept it or send it back.")} />
        <FormError message={create.error && !Object.keys(fields).length ? errorMessage(create.error) : startRun.error ? errorMessage(startRun.error) : null} />
      </div>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title={t("Files for this task")}
        onPick={(f) => setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
    </ResponsiveDialog>
  );
}
