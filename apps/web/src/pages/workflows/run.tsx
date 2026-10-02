/** Running a job through a workflow (P11): start it, watch each step, take the decisions. */
import {
  ArrowClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, CircleDashedIcon, CircleNotchIcon, FlowArrowIcon,
  HandIcon, PaperclipIcon, PlayIcon, ProhibitIcon, SealCheckIcon, StopIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApprovalCard } from "@/components/approval-card";
import { FilePicker } from "@/components/file-drop";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, approvalsQuery, workKeys } from "@/lib/work";
import { meQuery } from "@/lib/queries";
import {
  RUN_STATUS, runKeys, runQuery, runsQuery, STEP_LABEL,
  type Run, type RunStep, type RunSummary, type StepStatus, type Workflow,
} from "@/lib/workflows";

import { Canvas } from "./canvas";

const ANY = "__any";

/** Documents a step drafted, mentioned by id, become links to them. */
const linkDocs = (md: string) => md.replace(/`?\b(dc_[0-9a-z]{20,30})\b`?/g, "[open the document](/documents?d=$1)");

// ---------------------------------------------------------------- start

export function StartRunDialog({ wf, onClose }: { wf: Workflow; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: agents = [] } = useQuery(agentsQuery);
  const [branch, setBranch] = useState(ANY);
  const [title, setTitle] = useState("");
  const [job, setJob] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const branchId = branch === ANY ? null : branch;
  const { data: plan } = useQuery({
    queryKey: ["workflow-assignments", wf.id, branchId],
    queryFn: () => api<{ suggested: Record<string, string>; needs: { node_id: string; title: string; type: string; role: string }[] }>(
      `/api/workflows/${wf.id}/assignments${branchId ? `?branch_id=${branchId}` : ""}`,
    ),
  });
  // The suggestions, with whatever the person picked on top.
  const assign: Record<string, string> = { ...(plan?.suggested ?? {}), ...picked };

  const usable = agents.filter((a) => a.status === "active" && !a.clone_of && (!branchId || a.branch_id === branchId));
  const needs = plan?.needs ?? [];
  const missing = needs.filter((n) => !assign[n.node_id]);
  const start = useMutation({
    mutationFn: () => api<Run>(`/api/workflows/${wf.id}/runs`, "POST", {
      title, input: job, branch_id: branchId, file_ids: files.map((f) => f.id),
      assign: Object.fromEntries(needs.map((n) => [n.node_id, assign[n.node_id]]).filter(([, v]) => v)),
    }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: runKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success("Started. Each step goes to its agent; you take the decisions.");
      onClose();
      navigate({ to: "/workflows", search: { run: run.id } });
    },
  });

  return (
    <>
      <ResponsiveDialog open={!picking} onOpenChange={(o) => !o && onClose()} title={`Run "${wf.name}"`} className="w-[min(96vw,42rem)]"
        description="Describe the job. Each step becomes a task for its agent with everything the earlier steps found; decisions and steps marked for review wait for you."
        footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={missing.length > 0} loading={start.isPending} onClick={() => start.mutate()}><PlayIcon size={15} weight="fill" /> Start</Button></>}>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name this job (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bina Jaya enquiry" autoFocus />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Company</span>
              <Select value={branch} onValueChange={setBranch} label="Company"
                options={[{ value: ANY, label: "Any company" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
            </div>
          </div>
          <TextareaField label="What's the job?" rows={4} value={job} onChange={(e) => setJob(e.target.value)}
            placeholder="e.g. Syarikat Bina Jaya emailed asking for daily office cleaning at 3 sites in Shah Alam from January. Contact: Encik Rahim, 012-345 6789."
            hint="Every step's agent sees this, plus what the steps before it produced." />
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px]">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><XIcon size={12} /></button>
              </span>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> Files for this job</Button>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Who does each step</legend>
            {!needs.length ? <p className="text-[12.5px] text-muted">No steps need an agent — every step is a person's decision.</p> : (
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {needs.map((n) => (
                  <li key={n.node_id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2 max-sm:grid-cols-1">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{n.title}</span>
                      <span className="block truncate text-[12px] text-muted">{n.type === "decision" ? "An agent decides" : n.role || "No role set"}</span>
                    </span>
                    <Select size="sm" value={assign[n.node_id] ?? ""} onValueChange={(v) => setPicked((a) => ({ ...a, [n.node_id]: v }))}
                      label={`Agent for ${n.title}`} placeholder="Pick an agent"
                      options={usable.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}${branchId ? "" : `, ${a.branch_name}`}` }))} />
                  </li>
                ))}
              </ul>
            )}
            {missing.length ? <p className="text-[12px] text-warn">Choose an agent for {missing.map((m) => m.title).join(", ")}.</p> : null}
          </fieldset>
          <FormError message={start.error ? errorMessage(start.error) : null} />
        </div>
      </ResponsiveDialog>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title="Files for this job"
        onPick={(f) => setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
    </>
  );
}

// ---------------------------------------------------------------- the run

function StepIcon({ s }: { s: StepStatus }) {
  if (s === "done") return <CheckCircleIcon size={18} weight="fill" className="text-ok" />;
  if (s === "failed") return <WarningCircleIcon size={18} weight="fill" className="text-danger" />;
  if (s === "running" || s === "ready") return <CircleNotchIcon size={18} className="animate-spin text-info" />;
  if (s === "waiting" || s === "review" || s === "blocked") return <HandIcon size={18} weight="fill" className="text-warn" />;
  if (s === "skipped") return <ProhibitIcon size={18} className="text-muted" />;
  return <CircleDashedIcon size={18} className="text-muted" />;
}

/** Steps in reading order: from the start, following the connections. */
function ordered(run: Run): RunStep[] {
  const by = Object.fromEntries(run.steps.map((s) => [s.id, s]));
  const out: RunStep[] = [];
  const seen = new Set<string>();
  const incoming = new Set(run.graph.edges.map((e) => e.to));
  const queue = run.steps.filter((s) => s.type === "start" || !incoming.has(s.id)).map((s) => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !by[id]) continue;
    seen.add(id);
    out.push(by[id]!);
    for (const e of run.graph.edges) if (e.from === id) queue.push(e.to);
  }
  return [...out, ...run.steps.filter((s) => !seen.has(s.id))];
}

function Decision({ run, s }: { run: Run; s: RunStep }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: (edge_id: string) => api<Run>(`/api/workflow-runs/${run.id}/decide`, "POST", { node_id: s.id, edge_id, note }),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(run.id), r); qc.invalidateQueries({ queryKey: runKeys.all }); toast.success("Decided. The run carries on."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-2">
      {s.body ? <p className="text-[13px] text-muted">{s.body}</p> : null}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional) — the next step sees it" aria-label="Reason" />
      <div className="flex flex-wrap gap-2">
        {s.options.map((o) => (
          <Button key={o.edge_id} size="sm" variant={o.label.toLowerCase().match(/^(no|decline|reject)/) ? "outline" : "primary"}
            loading={go.isPending && go.variables === o.edge_id} onClick={() => go.mutate(o.edge_id)}>
            {o.label}{o.to_title ? <span className="font-normal opacity-75">→ {o.to_title}</span> : null}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Review({ run, s }: { run: Run; s: RunStep }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: runKeys.one(run.id) }); qc.invalidateQueries({ queryKey: workKeys.tasks }); };
  const accept = useMutation({
    mutationFn: () => api(`/api/tasks/${s.task_id}/accept`, "POST"),
    onSuccess: () => { done(); toast.success("Accepted. The run moves on."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const back = useMutation({
    mutationFn: () => api(`/api/tasks/${s.task_id}/revise`, "POST", { feedback }),
    onSuccess: () => { done(); setFeedback(""); toast.success(`Sent back to ${s.agent_name}.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-2">
      {s.output ? <div className="max-h-56 overflow-y-auto rounded-sm border border-border bg-surface p-3"><Markdown className="text-[13px]">{linkDocs(s.output)}</Markdown></div> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}><SealCheckIcon size={14} /> Accept</Button>
        <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Or say what to change…" className="h-8 min-w-0 flex-1 basis-40" aria-label="Feedback" />
        <Button size="sm" variant="outline" disabled={feedback.trim().length < 3} loading={back.isPending} onClick={() => back.mutate()}>Send back</Button>
      </div>
    </div>
  );
}

export function RunView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: run, error } = useQuery(runQuery(id));
  const { data: me } = useQuery(meQuery);
  const blockedTasks = new Set((run?.steps ?? []).filter((s) => s.status === "blocked" && s.task_id).map((s) => s.task_id!));
  // An agent in a step stopped to ask something: answer it right here.
  const { data: approvals = [] } = useQuery({ ...approvalsQuery("pending"), enabled: blockedTasks.size > 0, refetchInterval: blockedTasks.size ? 5000 : false });
  const asks = approvals.filter((a) => blockedTasks.has(a.task_id));
  const [sel, setSel] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const retry = useMutation({
    mutationFn: (node_id: string) => api<Run>(`/api/workflow-runs/${id}/retry`, "POST", { node_id }),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(id), r); toast.success("Trying that step again."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api<Run>(`/api/workflow-runs/${id}/cancel`, "POST"),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(id), r); qc.invalidateQueries({ queryKey: runKeys.all }); toast.success("Run stopped."); },
  });
  const steps = useMemo(() => (run ? ordered(run) : []), [run]);
  const taken = useMemo(() => {
    const t = new Set<string>();
    if (!run) return t;
    const st = Object.fromEntries(run.steps.map((s) => [s.id, s]));
    for (const e of run.graph.edges) {
      const u = st[e.from];
      const v = st[e.to];
      if (!u || u.status !== "done" || !v || v.status === "pending" || v.status === "skipped") continue;
      if (u.type === "decision" && u.choice !== e.id) continue;
      t.add(e.id);
    }
    return t;
  }, [run]);

  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!run) return <div className="grid gap-4"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>;
  const status = RUN_STATUS[run.status];
  const needs = steps.filter((s) => s.status === "waiting" || s.status === "review");
  const live = run.status === "running" || run.status === "waiting";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link to="/workflows" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeftIcon size={14} /> All workflows</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-[22px] font-semibold tracking-tight">{run.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Pill tone={status.tone} live={run.status === "running"}>{status.label}</Pill>
            <span>{run.name}</span>
            {run.branch_name ? <span>· {run.branch_name}</span> : null}
            <span>· started {timeAgo(run.created_at)}</span>
            <span>· {run.done} of {run.total} steps done</span>
          </div>
        </div>
        <div className="flex gap-2">
          {run.workflow_id ? <Button variant="outline" size="sm" asChild><Link to="/workflows" search={{ w: run.workflow_id }}><FlowArrowIcon size={14} /> Workflow</Link></Button> : null}
          {live ? <Button variant="outline" size="sm" onClick={() => setStopping(true)}><StopIcon size={14} /> Stop the run</Button> : null}
        </div>
      </div>

      {run.error && run.status !== "done" ? (
        <p className="rounded-sm bg-danger/10 px-3 py-2 text-[13px] text-danger">{run.error}</p>
      ) : null}

      {needs.length || asks.length ? (
        <section aria-label="Needs you" className="grid gap-3 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><HandIcon size={17} weight="fill" className="text-warn" /> Needs you</h2>
          {asks.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={!!me?.permissions.includes("approvals.decide")} showTask={false} />)}
          {needs.map((s) => (
            <div key={s.id} className="grid gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3">
              <p className="text-[13.5px] font-medium">{s.status === "waiting" ? `Decide: ${s.title}` : `Review: ${s.title}`}
                {s.status === "review" && s.agent_name ? <span className="font-normal text-muted"> — by {s.agent_name}</span> : null}</p>
              {s.status === "waiting" ? <Decision run={run} s={s} /> : <Review run={run} s={s} />}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Canvas graph={run.graph} onChange={() => {}} readOnly selected={sel ? { kind: "node", id: sel } : null}
          onSelect={(x) => setSel(x?.kind === "node" ? x.id : null)}
          status={Object.fromEntries(run.steps.map((s) => [s.id, s.status]))} taken={taken} />
        <ol className="grid content-start grid-cols-[minmax(0,1fr)] gap-2">
          {steps.filter((s) => s.type !== "start" || s.output).map((s) => (
            <li key={s.id} onClick={() => setSel(s.id)}
              className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[var(--radius-md)] border bg-surface p-3",
                sel === s.id ? "border-accent" : "border-border")}>
              <span className="row-span-2 mt-0.5"><StepIcon s={s.status} /></span>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="truncate text-[13.5px] font-medium">{s.type === "start" ? "The job" : s.title}</span>
                <span className="text-[12px] text-muted">
                  {[s.type === "decision" ? (s.decider === "agent" ? `${s.agent_name ?? "an agent"} decides` : "you decide") : s.agent_name, STEP_LABEL[s.status]].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
                {s.output && s.status !== "review" ? (
                  <details open={sel === s.id} className="text-[13px]">
                    <summary className="cursor-pointer text-muted">
                      <span className="inline-block max-w-[calc(100%-1.25rem)] truncate align-bottom">{s.output.split("\n")[0]!.slice(0, 140)}</span>
                    </summary>
                    <div className="mt-1.5 max-h-72 overflow-y-auto"><Markdown className="text-[13px]">{linkDocs(s.output)}</Markdown></div>
                  </details>
                ) : null}
                {s.error ? <p className="text-[12.5px] text-danger">{s.error}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  {s.task_id ? <Link to="/tasks" search={{ task: s.task_id }} className="text-[12px] text-accent hover:underline">Open the task</Link> : null}
                  {s.status === "failed" && s.task_id ? (
                    <Button size="sm" variant="outline" className="h-7" loading={retry.isPending} onClick={(e) => { e.stopPropagation(); retry.mutate(s.id); }}>
                      <ArrowClockwiseIcon size={13} /> Try again
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      {run.input ? (
        <details className="rounded-[var(--radius-md)] border border-border bg-surface p-3 text-[13px]">
          <summary className="cursor-pointer font-medium">The job as given</summary>
          <p className="mt-2 whitespace-pre-wrap">{run.input}</p>
          {run.files.length ? <p className="mt-2 text-muted">Files: {run.files.map((f) => f.name).join(", ")}</p> : null}
        </details>
      ) : null}
      <ConfirmDialog open={stopping} onOpenChange={setStopping} title="Stop this run?" danger confirmLabel="Stop it"
        body="Steps in progress are cancelled and nothing further starts. Work already done stays." onConfirm={async () => { await cancel.mutateAsync(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- lists

export function RunList({ runs, onOpen }: { runs: RunSummary[]; onOpen: (id: string) => void }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      {runs.map((r) => {
        const s = RUN_STATUS[r.status];
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{r.title}</span>
                <span className="block truncate text-[12.5px] text-muted">{[r.name, r.branch_name, `${r.done}/${r.total} steps`, timeAgo(r.created_at)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="flex items-center gap-2">
                {r.needs_you ? <Pill tone="warn">{r.needs_you} for you</Pill> : null}
                <Pill tone={s.tone} live={r.status === "running"}>{s.label}</Pill>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function RecentRuns({ workflowId, onOpen }: { workflowId?: string; onOpen: (id: string) => void }) {
  const { data: runs = [] } = useQuery(runsQuery(workflowId));
  if (!runs.length) return null;
  return (
    <section className="grid gap-2">
      <h2 className="text-[15px] font-semibold">Runs</h2>
      <RunList runs={runs.slice(0, 20)} onOpen={onOpen} />
    </section>
  );
}
