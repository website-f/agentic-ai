import { ArrowClockwiseIcon, CalendarCheckIcon, CheckCircleIcon, PlayIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import {
  CRON_PRESETS,
  describeCron,
  incidentsQuery,
  RUN_TONE,
  runsQuery,
  schedulesQuery,
  systemJobsQuery,
  teamKeys,
  type Schedule,
} from "@/lib/teams";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const TABS = ["schedules", "runs", "incidents", "system"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { schedules: "Schedules", runs: "Run ledger", incidents: "Incidents", system: "System jobs" };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ScheduleDialog({ s, onClose }: { s?: Schedule; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const [name, setName] = useState(s?.name ?? "");
  const [agentId, setAgentId] = useState(s?.agent_id ?? "");
  const [title, setTitle] = useState(s?.title ?? "");
  const [brief, setBrief] = useState(s?.brief ?? "");
  const [cron, setCron] = useState(s?.cron ?? CRON_PRESETS[0]?.cron ?? "0 9 * * 1-5");
  const [custom, setCustom] = useState(!!s && !CRON_PRESETS.some((p) => p.cron === s.cron));
  const [review, setReview] = useState(s?.requires_review ?? true);
  const { data: preview } = useQuery({
    queryKey: ["cron-preview", cron],
    queryFn: () => api<{ ok: boolean; next: string[]; error?: string }>(`/api/schedules/preview?cron=${encodeURIComponent(cron)}`),
    enabled: cron.trim().split(/\s+/).length === 5,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, agent_id: agentId, title, brief, cron, requires_review: review };
      return s ? api<Schedule>(`/api/schedules/${s.id}`, "PATCH", body) : api<Schedule>("/api/schedules", "POST", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: teamKeys.schedules }); toast.success(s ? "Saved." : "Scheduled."); onClose(); },
  });
  const options = [...CRON_PRESETS.map((p) => ({ value: p.cron, label: p.label })), { value: "custom", label: "Custom (cron)" }];
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={s ? "Edit schedule" : "New schedule"} className="sm:max-w-xl"
      description="Each run creates a fresh task for the agent. Failed runs retry after 5, 15 and 30 minutes."
      footer={<Button loading={save.isPending} disabled={!name.trim() || !agentId || !title.trim() || preview?.ok === false} onClick={() => save.mutate()}>{s ? "Save" : "Create schedule"}</Button>}>
      <div className="grid gap-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning cash position" autoFocus />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Agent</span>
          <Select label="Agent" value={agentId} onValueChange={setAgentId} placeholder="Pick an agent"
            options={agents.filter((a) => a.status === "active").map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))} />
        </div>
        <Field label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} hint="Each run's task gets the date added." />
        <TextareaField label="Brief" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What to do each time, and what the result should look like." />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">When</span>
          <Select label="When" value={custom ? "custom" : cron} onValueChange={(v) => { if (v === "custom") setCustom(true); else { setCustom(false); setCron(v); } }} options={options} />
          {custom ? <Field label="Cron expression" value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" hint="minute hour day month weekday, e.g. 30 8 * * 1-5. At most every 15 minutes." /> : null}
          {preview?.ok === false ? <p role="alert" className="text-[12.5px] text-danger">{preview.error}</p> : null}
          {preview?.ok ? <p className="text-[12.5px] text-muted">Next: {preview.next.slice(0, 3).map(when).join(" · ")}</p> : null}
        </div>
        <SwitchField checked={review} onCheckedChange={setReview} label="Send results for review" hint="Off: results go straight to done." />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function SchedulesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(schedulesQuery);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: teamKeys.schedules });
  const toggle = useMutation({
    mutationFn: (s: Schedule) => api<Schedule>(`/api/schedules/${s.id}`, "PATCH", { enabled: !s.enabled }),
    onSuccess: (s) => { refresh(); toast.success(s.enabled ? "Resumed." : "Paused."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (s: Schedule) => api<Schedule>(`/api/schedules/${s.id}/run`, "POST"),
    onSuccess: () => { toast.success("Started. The run appears in the ledger."); qc.invalidateQueries({ queryKey: ["runs"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (s: Schedule) => api<void>(`/api/schedules/${s.id}`, "DELETE"),
    onSuccess: () => { refresh(); setRemoving(null); toast.success("Deleted."); },
  });
  if (isLoading) return <Skeleton className="h-48 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-4">
      {canWrite ? <Button className="w-fit" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" /> New schedule</Button> : null}
      {!data.length ? (
        <EmptyState icon={CalendarCheckIcon} title="Nothing scheduled" body="Give an agent recurring work: a morning cash position, a weekly supplier check, a month-end summary." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
          {data.map((s) => (
            <li key={s.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <button className="flex min-w-0 items-start gap-3 text-left" onClick={() => canWrite && setEditing(s)} disabled={!canWrite}>
                <AgentAvatar name={s.agent_name} color={s.agent_color} size="sm" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium">{s.name}</span>
                    {!s.enabled ? <Pill>Paused</Pill> : null}
                    {s.last_status ? <Pill tone={RUN_TONE[s.last_status]}>Last run {s.last_status}</Pill> : null}
                  </span>
                  <span className="block text-[12.5px] text-muted">{s.agent_name} · {describeCron(s.cron)} ({s.timezone})</span>
                  <span className="block text-[12px] text-muted">{s.enabled && s.next_runs[0] ? `Next ${when(s.next_runs[0])}` : "Not running"}{s.last_run_at ? ` · last ${timeAgo(s.last_run_at).toLowerCase()}` : ""}</span>
                </span>
              </button>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" loading={run.isPending && run.variables?.id === s.id} onClick={() => run.mutate(s)}><PlayIcon size={14} weight="fill" /> Run now</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.enabled ? "Pause" : "Resume"}</Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setRemoving(s)}><TrashIcon size={15} /></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <ScheduleDialog s={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Delete ${removing?.name ?? "schedule"}?`}
        body="Future runs stop. Past runs and their tasks stay." confirmLabel="Delete" danger
        onConfirm={async () => { if (removing) await del.mutateAsync(removing); }} />
    </div>
  );
}

function RunsTab() {
  const [job, setJob] = useState("all");
  const { data, isLoading, error } = useQuery(runsQuery(job === "all" ? undefined : job));
  return (
    <div className="grid gap-4">
      <Select label="Which jobs" size="sm" className="w-fit" value={job} onValueChange={setJob}
        options={[{ value: "all", label: "All jobs" }, { value: "schedule", label: "Schedules" }, { value: "heartbeat", label: "Heartbeats" }]} />
      {isLoading ? <Skeleton className="h-48 rounded-[var(--radius-md)]" /> : error || !data ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !data.length ? (
        <p className="text-[13.5px] text-muted">Every scheduled run and heartbeat is logged here: claimed, running, then completed or failed.</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-muted">
              <tr><th className="px-4 py-2 font-medium">Job</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Started</th><th className="px-4 py-2 font-medium">Took</th><th className="px-4 py-2 font-medium">Result</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((r) => {
                const took = r.finished_at ? Math.max(1, Math.round((+new Date(r.finished_at) - +new Date(r.started_at)) / 1000)) : null;
                const d = r.detail as { started?: number; pinged?: number } | null;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">{r.job === "heartbeat" ? "Heartbeat" : r.schedule_name ?? "Schedule"}</span>
                      {r.attempt > 1 ? <span className="text-[12px] text-muted">attempt {r.attempt}</span> : null}
                    </td>
                    <td className="px-4 py-2.5"><Pill tone={RUN_TONE[r.status]} live={r.status === "running"}>{r.status}</Pill></td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{timeAgo(r.started_at)}</td>
                    <td className="px-4 py-2.5 text-muted tabular">{took === null ? "—" : took < 90 ? `${took}s` : `${Math.round(took / 60)}m`}</td>
                    <td className="max-w-[320px] px-4 py-2.5">
                      {r.task_id ? <Link to="/tasks" search={{ task: r.task_id }} className="text-accent hover:underline">{r.task_title ?? "Open task"}</Link> : null}
                      {r.job === "heartbeat" && d ? <span className="text-muted">{d.started ?? 0} started, {d.pinged ?? 0} asked for work</span> : null}
                      {r.error ? <span className="block text-[12.5px] text-danger">{r.error}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IncidentsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(incidentsQuery);
  const resolve = useMutation({
    mutationFn: (id: number) => api(`/api/incidents/${id}/resolve`, "POST"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: teamKeys.incidents }); toast.success("Marked resolved. It reopens if it happens again."); },
  });
  if (isLoading) return <Skeleton className="h-32 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.length) return <EmptyState icon={CheckCircleIcon} title="No incidents" body="Failures with the same cause are grouped into one incident, so fifty identical failures are one alert, not fifty." />;
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
      {data.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          <WarningIcon size={18} weight="duotone" className={i.resolved_at ? "mt-0.5 text-muted" : "mt-0.5 text-danger"} />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">{i.title}</p>
            <p className="text-[12px] text-muted tabular">
              {i.count} time{i.count === 1 ? "" : "s"} · first {timeAgo(i.first_seen).toLowerCase()} · last {timeAgo(i.last_seen).toLowerCase()}
              {i.resolved_at ? ` · resolved ${timeAgo(i.resolved_at).toLowerCase()}` : ""}
            </p>
          </div>
          {!i.resolved_at && canWrite ? <Button size="sm" variant="outline" loading={resolve.isPending && resolve.variables === i.id} onClick={() => resolve.mutate(i.id)}>Resolve</Button> : null}
          {i.resolved_at ? <Pill tone="ok">Resolved</Pill> : <Pill tone="danger">Open</Pill>}
        </li>
      ))}
    </ul>
  );
}

function SystemTab() {
  const { data, isLoading, error, refetch, isFetching } = useQuery(systemJobsQuery);
  if (isLoading) return <Skeleton className="h-32 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-3">
      {data.some((j) => !j.reachable) ? <p role="alert" className="text-[13px] text-warn">The worker service is not reachable, so next run times are unknown.</p> : null}
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {data.map((j) => (
          <li key={j.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span>
              <span className="flex items-center gap-2 font-mono text-[13px] font-medium">{j.id}{j.paused ? <Pill>Paused</Pill> : null}</span>
              <span className="block text-[12.5px] text-muted">{j.description}</span>
            </span>
            <span className="text-[12.5px] text-muted tabular">
              {j.next[0] ? `Next ${when(j.next[0])}` : "—"}
              {j.recent.length ? ` · last ${timeAgo(j.recent.at(-1)!.started_at).toLowerCase()}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="w-fit" loading={isFetching} onClick={() => refetch()}><ArrowClockwiseIcon size={14} /> Refresh</Button>
    </div>
  );
}

export function SchedulesPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab: Tab = search.tab && TABS.includes(search.tab) ? search.tab : "schedules";
  const { data: incidents = [] } = useQuery(incidentsQuery);
  const open = incidents.filter((i) => !i.resolved_at).length;
  return (
    <Page>
      <PageHeader title="Schedules" description="Recurring work for your agents, and a ledger of every run: when it started, how it ended, and failures grouped into incidents." />
      <Tabs.Root value={tab} onValueChange={(v) => navigate({ to: "/schedules", search: { tab: v as Tab }, replace: true })}>
        <Tabs.List aria-label="Schedule sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((t) => (
            <Tabs.Trigger key={t} value={t} className="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
              {TAB_LABEL[t]}
              {t === "incidents" && open ? <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-semibold text-white tabular">{open}</span> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="schedules" className="outline-none"><SchedulesTab canWrite={canWrite} /></Tabs.Content>
        <Tabs.Content value="runs" className="outline-none"><RunsTab /></Tabs.Content>
        <Tabs.Content value="incidents" className="outline-none"><IncidentsTab canWrite={canWrite} /></Tabs.Content>
        <Tabs.Content value="system" className="outline-none"><SystemTab /></Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
