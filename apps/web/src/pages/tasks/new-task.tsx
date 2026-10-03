import { FileIcon, FlowArrowIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { agentsQuery, workKeys, type Priority, type Task } from "@/lib/work";
import { runKeys, workflowsQuery, type Run } from "@/lib/workflows";

const NO_FLOW = "__none";

export function NewTaskDialog({
  open,
  onOpenChange,
  initialAgent,
  initialBrief,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialAgent?: string;
  initialBrief?: string;
  onCreated: (t: Task) => void;
}) {
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
  const [review, setReview] = useState(true);
  const [startNow, setStartNow] = useState(true);
  const [labels, setLabels] = useState("");
  const [goal, setGoal] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [flow, setFlow] = useState(NO_FLOW);
  const [flowMode, setFlowMode] = useState<"follow" | "run">("follow");
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
      toast.success("Started. Each step goes to its agent; decisions come to you.");
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
    }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(t.status === "ready" || t.run_count ? `${t.assignee_name} is on it.` : "Task created.");
      onCreated(t);
    },
  });
  const fields = create.error instanceof ApiError ? create.error.fields : {};

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New task"
      description="Say what you need and what done looks like. The agent follows its SOPs."
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {runMode ? (
            <Button disabled={!title.trim()} loading={startRun.isPending} onClick={() => startRun.mutate()}>
              <FlowArrowIcon size={15} /> Start the workflow
            </Button>
          ) : (
            <Button disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              {agent !== "none" && startNow ? "Create and start" : "Create task"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reconcile September bank statements" autoFocus error={fields.title} />
        <TextareaField label="Brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={5}
          placeholder="Context, inputs, constraints and the format you want back." hint="Markdown works." />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Assign to</span>
            <Select value={agent} onValueChange={setAgent} label="Assign to"
              options={[{ value: "none", label: "Nobody yet (triage)" }, ...active.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Priority</span>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} label="Priority"
              options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <span className="text-[13px] font-medium">Files for the agent {files.length ? <span className="font-normal text-muted">({files.length})</span> : null}</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-dashed border-border bg-surface-2/40 p-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
                <FileIcon size={13} className="shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
              </span>
            ))}
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> {files.length ? "Add more" : "Attach or upload"}</Button>
          </div>
          <p className="text-[12px] text-muted">Already read and summarised; the agent opens only what it needs.</p>
        </div>
        {workflows.length ? (
          <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border p-3">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Follow a workflow (optional)</span>
              <Select value={flow} onValueChange={setFlow} label="Workflow"
                options={[{ value: NO_FLOW, label: "No, just this brief" }, ...workflows.map((w) => ({ value: w.id, label: w.name, hint: `${w.steps} steps${w.status === "active" ? " · active" : ""}` }))]} />
            </div>
            {flow !== NO_FLOW ? (
              <>
                <Segmented label="How" value={flowMode} onChange={setFlowMode} className="w-full [&>button]:flex-1 [&>button]:justify-center"
                  options={[{ value: "follow", label: "Agent follows it" }, { value: "run", label: "Run step by step" }]} />
                <p className="text-[12px] text-muted">
                  {flowMode === "follow"
                    ? "The agent gets the workflow's steps with this brief and works through them, asking you where a step needs a person."
                    : "Each step becomes its own task for the right agent (the one picked above fills any gaps); decisions, answers and reviews come to you."}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        <Field label="Labels (optional)" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="e.g. tender, invoice"
          hint="What kind of work this is. The company overview counts work by label per branch." />
        <Field label="Keep going until (optional)" value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. all 12 invoices are reconciled and the totals match"
          hint="If set, the agent keeps working and a check re-runs it until this is true (up to a few tries)." />
        {agent !== "none" ? <SwitchField checked={startNow} onCheckedChange={setStartNow} label="Start now" hint="Otherwise it waits in Ready until you start it." /> : null}
        <SwitchField checked={review} onCheckedChange={setReview} label="I review the result" hint="Finished work waits in review until you accept it or send it back." />
        <FormError message={create.error && !Object.keys(fields).length ? errorMessage(create.error) : startRun.error ? errorMessage(startRun.error) : null} />
      </div>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title="Files for this task"
        onPick={(f) => setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
    </ResponsiveDialog>
  );
}
