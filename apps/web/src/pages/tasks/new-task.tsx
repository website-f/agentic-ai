import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { agentsQuery, workKeys, type Priority, type Task } from "@/lib/work";

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
  const active = agents.filter((a) => a.status === "active" && !a.clone_of);
  const [title, setTitle] = useState(initialBrief ? initialBrief.split("\n")[0]!.slice(0, 120) : "");
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [agent, setAgent] = useState(initialAgent ?? "none");
  const [priority, setPriority] = useState<Priority>("normal");
  const [review, setReview] = useState(true);
  const [startNow, setStartNow] = useState(true);
  const [labels, setLabels] = useState("");
  const [goal, setGoal] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const branchId = active.find((a) => a.id === agent)?.branch_id ?? null;

  const create = useMutation({
    mutationFn: () => api<Task>("/api/tasks", "POST", {
      title, brief, priority, requires_review: review, goal: goal.trim() || null,
      labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
      assignee_agent_id: agent === "none" ? null : agent, start: agent !== "none" && startNow,
      file_ids: files.map((f) => f.id),
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
          <Button disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            {agent !== "none" && startNow ? "Create and start" : "Create task"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Reconcile September bank statements" autoFocus error={fields.title} />
        <TextareaField label="Brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={5}
          placeholder="Context, inputs, constraints and the format you want back." hint="Markdown works." />
        <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Files for the agent</span>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px]">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><XIcon size={12} /></button>
              </span>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> Attach or upload</Button>
          </div>
          <p className="text-[12px] text-muted">Already read and summarised; the agent opens only what it needs.</p>
        </div>
        <Field label="Labels (optional)" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="e.g. tender, invoice"
          hint="What kind of work this is. The company overview counts work by label per branch." />
        <Field label="Keep going until (optional)" value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. all 12 invoices are reconciled and the totals match"
          hint="If set, the agent keeps working and a check re-runs it until this is true (up to a few tries)." />
        {agent !== "none" ? <SwitchField checked={startNow} onCheckedChange={setStartNow} label="Start now" hint="Otherwise it waits in Ready until you start it." /> : null}
        <SwitchField checked={review} onCheckedChange={setReview} label="I review the result" hint="Finished work waits in review until you accept it or send it back." />
        <FormError message={create.error && !Object.keys(fields).length ? errorMessage(create.error) : null} />
      </div>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title="Files for this task"
        onPick={(f) => setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
    </ResponsiveDialog>
  );
}
