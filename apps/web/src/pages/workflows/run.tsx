/** Running a job through a workflow (P11): start it, watch each step, take the decisions. */
import {
  ArrowClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, CircleDashedIcon, CircleNotchIcon, FlowArrowIcon,
  HandIcon, HourglassIcon, PaperclipIcon, PlayIcon, ProhibitIcon, SealCheckIcon, StopIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ApprovalCard } from "@/components/approval-card";
import { FilePicker } from "@/components/file-drop";
import { LoadMore } from "@/components/load-more";
import { Markdown } from "@/components/markdown";
import { ObjectivePicker, RunObjectiveLink } from "@/components/objective-bits";
import { IconTile, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { fileUrl, uploadFile } from "@/lib/documents";
import { usePagedList } from "@/lib/paged";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, approvalsQuery, workKeys } from "@/lib/work";
import { meQuery } from "@/lib/queries";
import {
  RUN_STATUS, runKeys, runQuery, STEP_LABEL,
  type Run, type RunStep, type RunSummary, type StepStatus, type Workflow,
} from "@/lib/workflows";

import { Canvas } from "./canvas";

const ANY = "__any";
const RUN_TONE_TILE: Record<Run["status"], Tone> = { running: "info", waiting: "warn", done: "ok", failed: "danger", cancelled: "neutral" };

/** Documents a step drafted, mentioned by id, become links to them. */
const linkDocs = (md: string) => md.replace(/`?\b(dc_[0-9a-z]{20,30})\b`?/g, `[${t("open the document")}](/documents?d=$1)`);

// ---------------------------------------------------------------- start

export function StartRunDialog({ wf, onClose }: { wf: Workflow; onClose: () => void }) {
  const t = useT();
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
  const [objective, setObjective] = useState<string | null>(null);
  const branchId = branch === ANY ? null : branch;
  const { data: plan } = useQuery({
    queryKey: ["workflow-assignments", wf.id, branchId],
    queryFn: () => api<{ suggested: Record<string, string>; needs: { node_id: string; title: string; type: string; role: string }[] }>(
      `/api/workflows/${wf.id}/assignments${branchId ? `?branch_id=${branchId}` : ""}`,
    ),
  });
  // The suggestions, with whatever the person picked on top.
  const assign: Record<string, string> = { ...(plan?.suggested ?? {}), ...picked };

  // Steps go only to agents the viewer may instruct (not colleagues' agents they just watch).
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of && !a.view_only && (!branchId || a.branch_id === branchId));
  const needs = plan?.needs ?? [];
  const missing = needs.filter((n) => !assign[n.node_id]);
  const start = useMutation({
    mutationFn: () => api<Run>(`/api/workflows/${wf.id}/runs`, "POST", {
      title, input: job, branch_id: branchId, file_ids: files.map((f) => f.id), objective_id: objective,
      assign: Object.fromEntries(needs.map((n) => [n.node_id, assign[n.node_id]]).filter(([, v]) => v)),
    }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: runKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(t("Started. Each step goes to its agent; you take the decisions."));
      onClose();
      navigate({ to: "/workflows", search: { run: run.id } });
    },
  });

  return (
    <>
      <ResponsiveDialog open={!picking} onOpenChange={(o) => !o && onClose()} title={t("Run \"{name}\"", { name: wf.name })} className="w-[min(96vw,42rem)]"
        description={t("Describe the job. Each step becomes a task for its agent with everything the earlier steps found; decisions and steps marked for review wait for you.")}
        footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={missing.length > 0} loading={start.isPending} onClick={() => start.mutate()}><PlayIcon size={15} weight="fill" /> {t("Start")}</Button></>}>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Name this job (optional)")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Bina Jaya enquiry")} autoFocus />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Company")}</span>
              <Select value={branch} onValueChange={setBranch} label={t("Company")}
                options={[{ value: ANY, label: t("Any company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
            </div>
          </div>
          <TextareaField label={t("What's the job?")} rows={4} value={job} onChange={(e) => setJob(e.target.value)}
            placeholder={t("e.g. Syarikat Bina Jaya emailed asking for daily office cleaning at 3 sites in Shah Alam from January. Contact: Encik Rahim, 012-345 6789.")}
            hint={t("Every step's agent sees this, plus what the steps before it produced.")} />
          <ObjectivePicker value={objective} onChange={setObjective} branchId={branchId}
            hint={t("Each step's agent sees why the job matters, and the whole run's cost counts toward the objective.")} />
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-[12.5px]">
                <span className="min-w-0 truncate">{f.name}</span>
                <button type="button" aria-label={t("Remove {name}", { name: f.name })} className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
                  onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><XIcon size={12} /></button>
              </span>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> {t("Files for this job")}</Button>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t("Who does each step")}</legend>
            {!needs.length ? <p className="text-[12.5px] text-muted">{t("No steps need an agent. Every step is a person's decision.")}</p> : (
              <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {needs.map((n) => (
                  <li key={n.node_id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2 max-sm:grid-cols-1">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{n.title}</span>
                      <span className="block truncate text-[12px] text-muted">{n.type === "decision" ? t("An agent decides") : n.role || t("No role set")}</span>
                    </span>
                    <Select value={assign[n.node_id] ?? ""} onValueChange={(v) => setPicked((a) => ({ ...a, [n.node_id]: v }))}
                      label={t("Agent for {name}", { name: n.title })} placeholder={t("Pick an agent")}
                      options={usable.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}${branchId ? "" : `, ${a.branch_name}`}` }))} />
                  </li>
                ))}
              </ul>
            )}
            {missing.length ? <p className="text-[12px] text-warn">{t("Choose an agent for {names}.", { names: missing.map((m) => m.title).join(", ") })}</p> : null}
          </fieldset>
          <FormError message={start.error ? errorMessage(start.error) : null} />
        </div>
      </ResponsiveDialog>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title={t("Files for this job")}
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
  if (s === "scheduled") return <HourglassIcon size={18} weight="fill" className="animate-pulse text-[var(--series-2)]" />;
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
  const t = useT();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: (edge_id: string) => api<Run>(`/api/workflow-runs/${run.id}/decide`, "POST", { node_id: s.id, edge_id, note }),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(run.id), r); qc.invalidateQueries({ queryKey: runKeys.all }); toast.success(t("Decided. The run carries on.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-2">
      {s.body ? <p className="text-[13px] text-muted">{s.body}</p> : null}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Why (optional), the next step sees it")} aria-label={t("Reason")} />
      <div className="flex flex-wrap gap-2">
        {s.options.map((o) => (
          <Button key={o.edge_id} size="sm" className="h-auto min-h-9 py-1.5 whitespace-normal" variant={o.label.toLowerCase().match(/^(no|decline|reject)/) ? "outline" : "primary"}
            loading={go.isPending && go.variables === o.edge_id} onClick={() => go.mutate(o.edge_id)}>
            {o.label}{o.to_title ? <span className="font-normal opacity-75">→ {o.to_title}</span> : null}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Answer({ run, s }: { run: Run; s: RunStep }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const go = useMutation({
    mutationFn: () => api<Run>(`/api/workflow-runs/${run.id}/answer`, "POST", { node_id: s.id, text, file_ids: files.map((f) => f.id) }),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(run.id), r); qc.invalidateQueries({ queryKey: runKeys.all }); toast.success(t("Thanks. The run carries on.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Files upload as they are picked; the answer then hands them on with the text.
  const attach = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setUploading((n) => n + picked.length);
    for (const f of picked) {
      try {
        const up = await uploadFile(f, { branch_id: run.branch_id });
        setFiles((fs) => [...fs, { id: up.id, name: up.name }]);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
      setUploading((n) => n - 1);
    }
  };
  const ready = (text.trim() || files.length) && !uploading;
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (ready) go.mutate(); }}>
      {s.body ? <p className="text-[13px] text-muted">{s.body}</p> : null}
      <TextareaField label={t("Your answer")} rows={2} value={text} onChange={(e) => setText(e.target.value)} hint={t("Every later step sees it, and any files you attach.")} />
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f) => (
          <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-[12.5px]">
            <span className="min-w-0 truncate">{f.name}</span>
            <button type="button" aria-label={t("Remove {name}", { name: f.name })} className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
              onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><XIcon size={12} /></button>
          </span>
        ))}
        <input ref={input} type="file" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
        <Button size="sm" variant="ghost" type="button" loading={uploading > 0} onClick={() => input.current?.click()}>
          <PaperclipIcon size={14} /> {uploading ? t("Uploading…") : t("Attach files")}
        </Button>
      </div>
      <Button size="sm" type="submit" className="w-fit max-sm:h-9" disabled={!ready} loading={go.isPending}>{t("Send answer")}</Button>
    </form>
  );
}

function Pause({ run, s }: { run: Run; s: RunStep }) {
  const t = useT();
  const qc = useQueryClient();
  const skip = useMutation({
    mutationFn: () => api<Run>(`/api/workflow-runs/${run.id}/skip-wait`, "POST", { node_id: s.id }),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(run.id), r); toast.success(t("Moving on.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      <span>{s.until ? t("Waiting {wait}, until {date}.", { wait: s.wait, date: new Date(s.until).toLocaleString(locale()) }) : t("Waiting {wait}.", { wait: s.wait })}</span>
      <Button size="sm" variant="outline" className="h-8" loading={skip.isPending} onClick={(e) => { e.stopPropagation(); skip.mutate(); }}>{t("Move on now")}</Button>
    </div>
  );
}

function Review({ run, s }: { run: Run; s: RunStep }) {
  const t = useT();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const done = () => { qc.invalidateQueries({ queryKey: runKeys.one(run.id) }); qc.invalidateQueries({ queryKey: workKeys.tasks }); };
  const accept = useMutation({
    mutationFn: () => api(`/api/tasks/${s.task_id}/accept`, "POST"),
    onSuccess: () => { done(); toast.success(t("Accepted. The run moves on.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const back = useMutation({
    mutationFn: () => api(`/api/tasks/${s.task_id}/revise`, "POST", { feedback }),
    onSuccess: () => { done(); setFeedback(""); toast.success(t("Sent back to {name}.", { name: s.agent_name ?? "" })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-2">
      {s.output ? <div className="max-h-56 min-w-0 overflow-x-hidden overflow-y-auto rounded-sm border border-border bg-surface p-3"><Markdown className="text-[13px] [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere]">{linkDocs(s.output)}</Markdown></div> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="max-sm:h-9" loading={accept.isPending} onClick={() => accept.mutate()}><SealCheckIcon size={14} /> {t("Accept")}</Button>
        <Input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("Or say what to change…")} className="h-9 min-w-0 flex-1 basis-40" aria-label={t("Feedback")} />
        <Button size="sm" variant="outline" className="max-sm:h-9" disabled={feedback.trim().length < 3} loading={back.isPending} onClick={() => back.mutate()}>{t("Send back")}</Button>
      </div>
    </div>
  );
}

export function RunView({ id }: { id: string }) {
  const t = useT();
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
    onSuccess: (r) => { qc.setQueryData(runKeys.one(id), r); toast.success(t("Trying that step again.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api<Run>(`/api/workflow-runs/${id}/cancel`, "POST"),
    onSuccess: (r) => { qc.setQueryData(runKeys.one(id), r); qc.invalidateQueries({ queryKey: runKeys.all }); toast.success(t("Run stopped.")); },
  });
  const steps = useMemo(() => (run ? ordered(run) : []), [run]);
  const taken = useMemo(() => {
    const on = new Set<string>();
    if (!run) return on;
    const st = Object.fromEntries(run.steps.map((s) => [s.id, s]));
    for (const e of run.graph.edges) {
      const u = st[e.from];
      const v = st[e.to];
      if (!u || u.status !== "done" || !v || v.status === "pending" || v.status === "skipped") continue;
      if (u.type === "decision" && u.choice !== e.id) continue;
      on.add(e.id);
    }
    return on;
  }, [run]);

  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!run) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-14 rounded-[var(--radius-md)]" />
        <Skeleton className="h-2 rounded-full" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"><Skeleton className="h-96 rounded-[var(--radius-md)]" /><Skeleton className="h-96 rounded-[var(--radius-md)]" /></div>
      </div>
    );
  }
  const status = RUN_STATUS[run.status];
  const needs = steps.filter((s) => s.status === "waiting" || s.status === "review");
  const live = run.status === "running" || run.status === "waiting";
  // The run's files include those attached to answers; "the job as given" lists the rest.
  const answered = new Set(run.steps.flatMap((s) => (s.files ?? []).map((f) => f.id)));
  const jobFiles = run.files.filter((f) => !answered.has(f.id));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link to="/workflows" className="inline-flex min-h-9 w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeftIcon size={14} /> {t("All workflows")}</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <IconTile icon={FlowArrowIcon} tone={RUN_TONE_TILE[run.status]} size="lg" className="hidden sm:grid" />
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{t("Workflow run")}</p>
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words sm:text-[26px]">{run.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
              <Pill tone={status.tone} live={run.status === "running"}>{t(status.label)}</Pill>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <Meta items={[run.name, run.branch_name, t("started {ago}", { ago: timeAgo(run.created_at).toLowerCase() })]} />
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center">
              <RunObjectiveLink runId={run.id} branchId={run.branch_id} canWrite={!!me?.permissions.includes("work.write")}
                objective={run.objective_id ? { id: run.objective_id, title: run.objective_title ?? "" } : null} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 max-sm:[&>*]:flex-1">
          {run.workflow_id ? <Button variant="outline" size="sm" className="max-sm:h-9" asChild><Link to="/workflows" search={{ w: run.workflow_id }}><FlowArrowIcon size={14} /> {t("Workflow")}</Link></Button> : null}
          {live ? <Button variant="outline" size="sm" className="max-sm:h-9 hover:text-danger" onClick={() => setStopping(true)}><StopIcon size={14} /> {t("Stop the run")}</Button> : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-[12.5px] text-muted">
          <span>{t("Progress")}</span>
          <span className="tabular">{t("{done} of {total} steps done", { done: run.done, total: run.total })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done} aria-label={t("Steps done")}>
          <div className={cn("h-full rounded-full transition-[width] duration-500", run.status === "failed" ? "bg-danger" : run.status === "cancelled" ? "bg-muted" : "bg-accent")}
            style={{ width: `${run.total ? Math.round((run.done / run.total) * 100) : 0}%` }} />
        </div>
      </div>

      {run.error && run.status !== "done" ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] break-words text-danger"><WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" /><span className="min-w-0">{run.error}</span></p>
      ) : null}

      {needs.length || asks.length ? (
        <section aria-label={t("Needs you")} className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 p-3 sm:p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><HandIcon size={17} weight="fill" className="text-warn" /> {t("Needs you")}</h2>
          {asks.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={!!me?.permissions.includes("approvals.decide")} showTask={false} />)}
          {needs.map((s) => (
            <div key={s.id} className="grid min-w-0 gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3">
              <p className="text-[13.5px] font-medium break-words">{s.status === "review" ? t("Review: {title}", { title: s.title }) : s.type === "input" ? t("Answer: {title}", { title: s.title }) : t("Decide: {title}", { title: s.title })}
                {s.status === "review" && s.agent_name ? <span className="font-normal text-muted"> · {t("by {name}", { name: s.agent_name })}</span> : null}</p>
              {s.status === "review" ? <Review run={run} s={s} /> : s.type === "input" ? <Answer run={run} s={s} /> : <Decision run={run} s={s} />}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-2 max-xl:order-2">
          <h2 className="text-[14px] font-semibold xl:sr-only">{t("Map")}</h2>
          <Canvas graph={run.graph} onChange={() => {}} readOnly selected={sel ? { kind: "node", id: sel } : null} viewKey={`run:${run.id}`}
            onSelect={(x) => setSel(x?.kind === "node" ? x.id : null)} className="max-sm:h-[26rem]"
            status={Object.fromEntries(run.steps.map((s) => [s.id, s.status]))} taken={taken} />
        </div>
        <ol aria-label={t("Steps")} className="grid grid-cols-[minmax(0,1fr)] content-start gap-2">
          {steps.filter((s) => s.type !== "start" || s.output).map((s) => (
            <li key={s.id} onClick={() => setSel(s.id)}
              className={cn("grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[var(--radius-md)] border bg-surface p-3 transition-colors",
                sel === s.id ? "border-accent ring-2 ring-accent/15" : "border-border hover:border-accent/40")}>
              <span className="row-span-2 mt-0.5"><StepIcon s={s.status} /></span>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="min-w-0 text-[13.5px] font-medium break-words">{s.type === "start" ? t("The job") : s.title}</span>
                <span className="text-[12px] text-muted">
                  {[s.type === "decision" ? (s.decider === "agent" ? t("{name} decides", { name: s.agent_name ?? t("an agent") }) : t("you decide")) : s.type === "input" ? t("you answer") : s.type === "wait" ? s.wait : s.agent_name, t(STEP_LABEL[s.status])].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
                {s.output && s.status !== "review" ? (
                  <details open={sel === s.id} className="text-[13px]">
                    <summary className="cursor-pointer text-muted">
                      <span className="inline-block max-w-[calc(100%-1.25rem)] truncate align-bottom">{s.output.split("\n")[0]!.slice(0, 140)}</span>
                    </summary>
                    <div className="mt-1.5 max-h-72 overflow-x-hidden overflow-y-auto"><Markdown className="text-[13px] [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere]">{linkDocs(s.output)}</Markdown></div>
                  </details>
                ) : null}
                {s.files?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {s.files.map((f) => (
                      <a key={f.id} href={fileUrl(f.id)} download onClick={(e) => e.stopPropagation()}
                        className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px] hover:bg-surface-2">
                        <PaperclipIcon size={12} className="shrink-0 text-muted" /><span className="min-w-0 truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
                {s.error ? <p className="text-[12.5px] text-danger">{s.error}</p> : null}
                {s.status === "scheduled" ? <Pause run={run} s={s} /> : null}
                <div className="flex flex-wrap items-center gap-2">
                  {s.task_id ? <Link to="/tasks" search={{ task: s.task_id }} className="text-[12px] text-accent hover:underline">{t("Open the task")}</Link> : null}
                  {s.status === "failed" && s.task_id ? (
                    <Button size="sm" variant="outline" className="h-8" loading={retry.isPending} onClick={(e) => { e.stopPropagation(); retry.mutate(s.id); }}>
                      <ArrowClockwiseIcon size={13} /> {t("Try again")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      {run.input ? (
        <details className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13px]">
          <summary className="min-h-7 cursor-pointer font-medium">{t("The job as given")}</summary>
          <p className="mt-2 break-words whitespace-pre-wrap">{run.input}</p>
          {jobFiles.length ? <p className="mt-2 text-muted">{t("Files: {names}", { names: jobFiles.map((f) => f.name).join(", ") })}</p> : null}
        </details>
      ) : null}
      <ConfirmDialog open={stopping} onOpenChange={setStopping} title={t("Stop this run?")} danger confirmLabel={t("Stop it")}
        body={t("Steps in progress are cancelled and nothing further starts. Work already done stays.")} onConfirm={async () => { await cancel.mutateAsync(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- lists

export function RunList({ runs, onOpen }: { runs: RunSummary[]; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <ListCard>
      {runs.map((r) => {
        const s = RUN_STATUS[r.status];
        return (
          <ListRow key={r.id} onClick={() => onOpen(r.id)}
            leading={<IconTile icon={r.needs_you ? HandIcon : FlowArrowIcon} tone={r.needs_you ? "warn" : RUN_TONE_TILE[r.status]} size="sm" />}
            title={<span className="block whitespace-normal break-words">{r.title}</span>}
            meta={<Meta items={[r.name, r.branch_name, t("{done}/{total} steps", { done: r.done, total: r.total }), timeAgo(r.created_at)]} />}
            trailing={(
              <>
                {r.needs_you ? <Pill tone="warn">{t("{n} for you", { n: r.needs_you })}</Pill> : null}
                <Pill tone={s.tone} live={r.status === "running"}>{t(s.label)}</Pill>
              </>
            )} />
        );
      })}
    </ListCard>
  );
}

/** Every run, newest first, 20 at a time as you scroll (runs pile up; the list never caps). */
export function RecentRuns({ workflowId, onOpen }: { workflowId?: string; onOpen: (id: string) => void }) {
  const t = useT();
  const list = usePagedList<RunSummary>([...runKeys.all, "list"], "/api/workflow-runs", { workflow_id: workflowId }, { pageSize: 20 });
  const runs = list.items;
  if (!runs.length) return null;
  return (
    <section className="grid min-w-0 gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[15px] font-semibold">{t("Runs")} <span className="font-normal text-muted tabular">{list.total ?? runs.length}</span></h2>
      </div>
      <RunList runs={runs} onOpen={onOpen} />
      <LoadMore noun={t("runs")} shown={runs.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} />
    </section>
  );
}
