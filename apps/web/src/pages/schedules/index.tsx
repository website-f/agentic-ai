import {
  ArrowClockwiseIcon, CalendarCheckIcon, CheckCircleIcon, GearSixIcon, HeartbeatIcon, PauseCircleIcon, PlayIcon, PlusIcon,
  TrashIcon, WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, t, useT } from "@/i18n";
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
  type RunStatus,
  type Schedule,
} from "@/lib/teams";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const TABS = ["schedules", "runs", "incidents", "system"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { schedules: msg("Schedules"), runs: msg("Run ledger"), incidents: msg("Incidents"), system: msg("System jobs") };
/** Run states as shown (the API sends the key). */
const RUN_WORD: Record<RunStatus, string> = { claimed: msg("Claimed"), running: msg("Running"), completed: msg("Completed"), failed: msg("Failed") };

function RowsSkeleton({ rows = 3, h = "h-16" }: { rows?: number; h?: string }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`${h} rounded-none`} />)}
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "Set up by Aina from chat": a person here, or the agent itself when someone asked it. */
function setUpBy(s: Schedule): string | null {
  const o = s.origin;
  if (!o) return null;
  const who = o.person_name ?? t("a person");
  if (o.via === "chat") return t("Set up by {name} from chat", { name: who });
  if (o.via === "task") return t("Set up by {name} through a task", { name: who });
  return o.person_name ? t("Set up by {name}", { name: o.person_name }) : null;
}

function ScheduleDialog({ s, onClose }: { s?: Schedule; onClose: () => void }) {
  const t = useT();
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: teamKeys.schedules }); toast.success(s ? t("Saved.") : t("Scheduled.")); onClose(); },
  });
  const options = [...CRON_PRESETS.map((p) => ({ value: p.cron, label: t(p.label) })), { value: "custom", label: t("Custom (cron)") }];
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={s ? t("Edit schedule") : t("New schedule")} className="sm:max-w-xl"
      description={t("Each run creates a fresh task for the agent. Failed runs retry after 5, 15 and 30 minutes.")}
      footer={<Button loading={save.isPending} disabled={!name.trim() || !agentId || !title.trim() || preview?.ok === false} onClick={() => save.mutate()}>{s ? t("Save") : t("Create schedule")}</Button>}>
      <div className="grid gap-4">
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Morning cash position")} autoFocus />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Agent")}</span>
          <Select label={t("Agent")} value={agentId} onValueChange={setAgentId} placeholder={t("Pick an agent")}
            options={agents.filter((a) => a.status === "active" && !a.view_only).map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))} />
        </div>
        <Field label={t("Task title")} value={title} onChange={(e) => setTitle(e.target.value)} hint={t("Each run's task gets the date added.")} />
        <TextareaField label={t("Brief")} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("What to do each time, and what the result should look like.")} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("When")}</span>
          <Select label={t("When")} value={custom ? "custom" : cron} onValueChange={(v) => { if (v === "custom") setCustom(true); else { setCustom(false); setCron(v); } }} options={options} />
          {custom ? <Field label={t("Cron expression")} value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" hint={t("minute hour day month weekday, e.g. 30 8 * * 1-5. At most every 15 minutes.")} /> : null}
          {preview?.ok === false ? <p role="alert" className="text-[12.5px] text-danger">{preview.error}</p> : null}
          {preview?.ok ? <p className="text-[12.5px] text-muted">{t("Next: {times}", { times: preview.next.slice(0, 3).map(when).join(" · ") })}</p> : null}
        </div>
        <SwitchField checked={review} onCheckedChange={setReview} label={t("Send results for review")} hint={t("Off: results go straight to done.")} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function SchedulesTab({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(schedulesQuery);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [removing, setRemoving] = useState<Schedule | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: teamKeys.schedules });
  const toggle = useMutation({
    mutationFn: (s: Schedule) => api<Schedule>(`/api/schedules/${s.id}`, "PATCH", { enabled: !s.enabled }),
    onSuccess: (s) => { refresh(); toast.success(s.enabled ? t("Resumed.") : t("Paused.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (s: Schedule) => api<Schedule>(`/api/schedules/${s.id}/run`, "POST"),
    onSuccess: () => { toast.success(t("Started. The run appears in the ledger.")); qc.invalidateQueries({ queryKey: ["runs"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (s: Schedule) => api<void>(`/api/schedules/${s.id}`, "DELETE"),
    onSuccess: () => { refresh(); setRemoving(null); toast.success(t("Deleted.")); },
  });
  if (isLoading) return <RowsSkeleton h="h-20" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {data.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">{data.length === 1
            ? t("1 schedule, {running} running", { running: data.filter((x) => x.enabled).length })
            : t("{n} schedules, {running} running", { n: data.length, running: data.filter((x) => x.enabled).length })}</p>
          {canWrite ? <Button data-guide="schedules.new" className="max-sm:w-full" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" /> {t("New schedule")}</Button> : null}
        </div>
      ) : null}
      {!data.length ? (
        <EmptyState icon={CalendarCheckIcon} title={t("Nothing scheduled")} body={t("Give an agent recurring work: a morning cash position, a weekly supplier check, a month-end summary.")}
          action={canWrite ? <Button data-guide="schedules.new" onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" /> {t("New schedule")}</Button> : undefined} />
      ) : (
        <ListCard data-guide="schedules.list">
          {data.map((s) => (
            <li key={s.id} className="grid min-w-0 gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <button type="button" className="flex min-w-0 items-start gap-3 rounded-sm text-left disabled:cursor-default" onClick={() => canWrite && setEditing(s)} disabled={!canWrite}>
                <AgentAvatar name={s.agent_name} color={s.agent_color} size="sm" />
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 text-[14px] font-medium break-words">{s.name}</span>
                    {s.origin?.once ? <Pill tone="info">{t("Once")}</Pill> : null}
                    {!s.enabled ? (s.origin?.once && s.last_run_at ? <Pill tone="ok">{t("Done")}</Pill> : <Pill>{t("Paused")}</Pill>) : null}
                    {s.last_status ? <Pill tone={RUN_TONE[s.last_status]}>{t("Last run {status}", { status: t(RUN_WORD[s.last_status]).toLowerCase() })}</Pill> : null}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
                    <Meta items={[s.agent_name, `${describeCron(s.cron)} (${s.timezone})`]} />
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                    <Meta items={[s.enabled && s.next_runs[0] ? t("Next {when}", { when: when(s.next_runs[0]) }) : t("Not running"), s.last_run_at ? t("last {ago}", { ago: timeAgo(s.last_run_at).toLowerCase() }) : null, setUpBy(s)]} />
                  </span>
                </span>
              </button>
              {canWrite ? (
                <div className="flex flex-wrap gap-2 max-md:pl-11">
                  <Button size="sm" variant="outline" className="max-sm:h-9" loading={run.isPending && run.variables?.id === s.id} onClick={() => run.mutate(s)}><PlayIcon size={14} weight="fill" /> {t("Run now")}</Button>
                  <Button size="sm" variant="ghost" className="max-sm:h-9" onClick={() => toggle.mutate(s)}>{s.enabled ? t("Pause") : t("Resume")}</Button>
                  <Button size="icon-sm" variant="ghost" className="hover:text-danger max-sm:size-9" aria-label={t("Delete {name}", { name: s.name })} onClick={() => setRemoving(s)}><TrashIcon size={15} /></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ListCard>
      )}
      {editing ? <ScheduleDialog s={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={t("Delete {name}?", { name: removing?.name ?? t("schedule") })}
        body={t("Future runs stop. Past runs and their tasks stay.")} confirmLabel={t("Delete")} danger
        onConfirm={async () => { if (removing) await del.mutateAsync(removing); }} />
    </div>
  );
}

function took(r: { started_at: string; finished_at: string | null }): string {
  if (!r.finished_at) return "—";
  const sec = Math.max(1, Math.round((+new Date(r.finished_at) - +new Date(r.started_at)) / 1000));
  return sec < 90 ? `${sec}s` : `${Math.round(sec / 60)}m`;
}

function RunsTab() {
  const t = useT();
  const [job, setJob] = useState("all");
  const { data, isLoading, error } = useQuery(runsQuery(job === "all" ? undefined : job));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Segmented label={t("Which jobs")} value={job} onChange={setJob} className="w-fit"
        options={[{ value: "all", label: t("All jobs") }, { value: "schedule", label: t("Schedules") }, { value: "heartbeat", label: t("Heartbeats") }]} />
      {isLoading ? <RowsSkeleton rows={5} h="h-12" /> : error || !data ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !data.length ? (
        <EmptyState icon={HeartbeatIcon} title={t("No runs yet")} body={t("Every scheduled run and heartbeat is logged here: claimed, running, then completed or failed.")} />
      ) : (
        <>
          {/* Phones: one card per run. */}
          <ListCard data-guide="schedules.list" className="md:hidden">
            {data.map((r) => {
              const d = r.detail as { started?: number; pinged?: number } | null;
              return (
                <li key={r.id} className="grid min-w-0 gap-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[13.5px] font-medium break-words">{r.job === "heartbeat" ? t("Heartbeat") : r.schedule_name ?? t("Schedule")}</span>
                    <Pill tone={RUN_TONE[r.status]} live={r.status === "running"}>{t(RUN_WORD[r.status])}</Pill>
                  </div>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted tabular">
                    <Meta items={[timeAgo(r.started_at), t("took {time}", { time: took(r) }), r.attempt > 1 ? t("attempt {n}", { n: r.attempt }) : null]} />
                  </span>
                  {r.task_id ? <Link to="/tasks" search={{ task: r.task_id }} className="min-h-6 text-[13px] break-words text-accent hover:underline">{r.task_title ?? t("Open task")}</Link> : null}
                  {r.job === "heartbeat" && d ? <span className="text-[12.5px] text-muted">{t("{started} started, {pinged} asked for work", { started: d.started ?? 0, pinged: d.pinged ?? 0 })}</span> : null}
                  {r.error ? <span className="text-[12.5px] break-words text-danger">{r.error}</span> : null}
                </li>
              );
            })}
          </ListCard>
          {/* Larger screens: the ledger as a table. */}
          <div data-guide="schedules.list" className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface max-md:hidden">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-border bg-surface-2/50 text-[12px] text-muted">
                <tr><th className="px-4 py-2.5 font-medium">{t("Job")}</th><th className="px-4 py-2.5 font-medium">{t("Status")}</th><th className="px-4 py-2.5 font-medium">{t("Started")}</th><th className="px-4 py-2.5 font-medium">{t("Took")}</th><th className="px-4 py-2.5 font-medium">{t("Result")}</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((r) => {
                  const d = r.detail as { started?: number; pinged?: number } | null;
                  return (
                    <tr key={r.id} className="align-top transition-colors hover:bg-surface-2/40">
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{r.job === "heartbeat" ? t("Heartbeat") : r.schedule_name ?? t("Schedule")}</span>
                        {r.attempt > 1 ? <span className="text-[12px] text-muted">{t("attempt {n}", { n: r.attempt })}</span> : null}
                      </td>
                      <td className="px-4 py-2.5"><Pill tone={RUN_TONE[r.status]} live={r.status === "running"}>{t(RUN_WORD[r.status])}</Pill></td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted">{timeAgo(r.started_at)}</td>
                      <td className="px-4 py-2.5 text-muted tabular">{took(r)}</td>
                      <td className="max-w-[320px] px-4 py-2.5">
                        {r.task_id ? <Link to="/tasks" search={{ task: r.task_id }} className="text-accent hover:underline">{r.task_title ?? t("Open task")}</Link> : null}
                        {r.job === "heartbeat" && d ? <span className="text-muted">{t("{started} started, {pinged} asked for work", { started: d.started ?? 0, pinged: d.pinged ?? 0 })}</span> : null}
                        {r.error ? <span className="block text-[12.5px] break-words text-danger">{r.error}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function IncidentsTab({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(incidentsQuery);
  const resolve = useMutation({
    mutationFn: (id: number) => api(`/api/incidents/${id}/resolve`, "POST"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: teamKeys.incidents }); toast.success(t("Marked resolved. It reopens if it happens again.")); },
  });
  if (isLoading) return <RowsSkeleton />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.length) return <EmptyState icon={CheckCircleIcon} title={t("No incidents")} body={t("Failures with the same cause are grouped into one incident, so fifty identical failures are one alert, not fifty.")} />;
  return (
    <ListCard>
      {data.map((i) => (
        <li key={i.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <IconTile icon={i.resolved_at ? CheckCircleIcon : WarningIcon} tone={i.resolved_at ? "neutral" : "danger"} size="sm" />
          <div className="grid min-w-0 gap-0.5">
            <p className="text-[13.5px] font-medium break-words">{i.title}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted tabular">
              <Meta items={[i.count === 1 ? t("1 time") : t("{n} times", { n: i.count }), t("first {ago}", { ago: timeAgo(i.first_seen).toLowerCase() }), t("last {ago}", { ago: timeAgo(i.last_seen).toLowerCase() }),
                i.resolved_at ? t("resolved {ago}", { ago: timeAgo(i.resolved_at).toLowerCase() }) : null]} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:col-start-2">
            {i.resolved_at ? <Pill tone="ok">{t("Resolved")}</Pill> : <Pill tone="danger">{t("Open")}</Pill>}
            {!i.resolved_at && canWrite ? <Button size="sm" variant="outline" className="max-sm:h-9" loading={resolve.isPending && resolve.variables === i.id} onClick={() => resolve.mutate(i.id)}>{t("Resolve")}</Button> : null}
          </div>
        </li>
      ))}
    </ListCard>
  );
}

function SystemTab() {
  const t = useT();
  const { data, isLoading, error, refetch, isFetching } = useQuery(systemJobsQuery);
  if (isLoading) return <RowsSkeleton rows={4} />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{t("Background jobs the platform runs for the whole workspace.")}</p>
        <Button size="sm" variant="outline" className="max-sm:h-9" loading={isFetching} onClick={() => refetch()}><ArrowClockwiseIcon size={14} /> {t("Refresh")}</Button>
      </div>
      {data.some((j) => !j.reachable) ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
          <WarningIcon size={16} weight="fill" className="mt-0.5 shrink-0" /> {t("The worker service is not reachable, so next run times are unknown.")}
        </p>
      ) : null}
      <ListCard>
        {data.map((j) => (
          <li key={j.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <IconTile icon={j.paused ? PauseCircleIcon : GearSixIcon} tone={j.paused ? "neutral" : "info"} size="sm" />
            <span className="grid min-w-0 gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[13px] font-medium"><span className="min-w-0 break-all">{j.id}</span>{j.paused ? <Pill>{t("Paused")}</Pill> : null}</span>
              <span className="block text-[12.5px] break-words text-muted">{j.description}</span>
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted tabular max-sm:col-start-2">
              <Meta items={[j.next[0] ? t("Next {when}", { when: when(j.next[0]) }) : "—", j.recent.length ? t("last {ago}", { ago: timeAgo(j.recent.at(-1)!.started_at).toLowerCase() }) : null]} />
            </span>
          </li>
        ))}
      </ListCard>
    </div>
  );
}

export function SchedulesPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  // Incidents and system jobs are the whole workspace's plumbing: workspace roles only.
  const canOrg = me.permissions.includes("org.read");
  const tabs = TABS.filter((x) => canOrg || (x !== "incidents" && x !== "system"));
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab: Tab = search.tab && tabs.includes(search.tab) ? search.tab : "schedules";
  const { data: incidents = [] } = useQuery({ ...incidentsQuery, enabled: canOrg });
  const { data: schedules } = useQuery(schedulesQuery);
  const open = incidents.filter((i) => !i.resolved_at).length;
  const go = (to: Tab) => navigate({ to: "/schedules", search: { tab: to }, replace: true });
  return (
    <Page>
      <PageHeader title={t("Schedules")} description={t("Recurring work for your agents, and a ledger of every run: when it started, how it ended, and failures grouped into incidents.")} />
      {schedules ? (
        <StatGrid className={canOrg ? undefined : "lg:grid-cols-3"}>
          <Stat label={t("Schedules")} value={schedules.length} icon={CalendarCheckIcon} tone="accent" onClick={() => go("schedules")} active={tab === "schedules"} />
          <Stat label={t("Running")} value={schedules.filter((x) => x.enabled).length} icon={PlayIcon} tone="ok" hint={t("{n} paused", { n: schedules.filter((x) => !x.enabled).length })} />
          <Stat label={t("Last run failed")} value={schedules.filter((x) => x.last_status === "failed").length} icon={WarningIcon}
            tone={schedules.some((x) => x.last_status === "failed") ? "danger" : "neutral"} hint={t("Latest run of each schedule")} onClick={() => go("runs")} active={tab === "runs"} />
          {canOrg ? (
            <Stat label={t("Open incidents")} value={open} icon={HeartbeatIcon} tone={open ? "danger" : "neutral"} hint={open ? t("Grouped failures") : t("All clear")}
              onClick={() => go("incidents")} active={tab === "incidents"} />
          ) : null}
        </StatGrid>
      ) : null}
      <Segmented<Tab> label={t("Schedule sections")} value={tab} onChange={go} className="w-fit"
        options={tabs.map((x) => ({ value: x, label: t(TAB_LABEL[x]), count: x === "incidents" && open ? open : x === "schedules" ? schedules?.length : undefined }))} />
      <div role="tabpanel" aria-label={t(TAB_LABEL[tab])} className="min-w-0">
        {tab === "schedules" ? <SchedulesTab canWrite={canWrite} />
          : tab === "runs" ? <RunsTab />
          : tab === "incidents" && canOrg ? <IncidentsTab canWrite={canWrite} />
          : tab === "system" && canOrg ? <SystemTab /> : null}
      </div>
    </Page>
  );
}
