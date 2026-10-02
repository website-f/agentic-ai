import { ArrowLeftIcon, CheckIcon, EyeIcon, PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { AgentLive, AgentOutcome } from "@/components/agent-live";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import { branchesQuery, keys, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { agentQuery, sopsQuery, STATUS_INFO, tasksQuery, workKeys, type Agent, type ToolMode } from "@/lib/work";
import { groupsQuery } from "@/pages/ai-engine/data";

import { ChatPanel } from "./chat-panel";
import { MemoryTab } from "./memory-tab";
import { agentState } from "./roster";
import { TeamTab } from "./team-tab";
import { ToolMatrix } from "./tool-matrix";

const TABS = ["overview", "chat", "memory", "profile", "team", "permissions", "sops"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { overview: "Overview", chat: "Chat", memory: "Memory", profile: "Profile", team: "Team & budget", permissions: "Permissions", sops: "SOPs" };

function useSaveAgent(agent: Agent) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Agent>) => api<Agent>(`/api/agents/${agent.id}`, "PATCH", patch),
    onSuccess: (a) => {
      qc.setQueryData(workKeys.agent(a.id), a);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      toast.success("Saved.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function Overview({ agent }: { agent: Agent }) {
  const { data: tasks = [] } = useQuery(tasksQuery);
  const mine = tasks.filter((t) => t.assignee_agent_id === agent.id).slice(0, 12);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="grid content-start gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">Tasks</h2>
          <Button asChild size="sm" variant="outline">
            <Link to="/tasks" search={{ new: 1, agent: agent.id }}><PlusIcon size={14} /> Give a task</Link>
          </Button>
        </div>
        {mine.length ? (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {mine.map((t) => (
              <li key={t.id}>
                <Link to="/tasks" search={{ task: t.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.title}</span>
                  <Pill tone={STATUS_INFO[t.status].tone}>{STATUS_INFO[t.status].label}</Pill>
                  <span className="hidden w-20 text-right text-[12px] text-muted sm:block">{timeAgo(t.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">
            No tasks yet. Give {agent.name} something to do.
          </p>
        )}
      </section>
      <section className="grid content-start gap-2">
        <h2 className="text-[14px] font-semibold">Personality</h2>
        <p className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-[13.5px] whitespace-pre-wrap text-muted">
          {agent.soul || "No personality written yet."}
        </p>
      </section>
    </div>
  );
}

function Profile({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const save = useSaveAgent(agent);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: groups = [] } = useQuery(groupsQuery);
  const [d, setD] = useState({ name: agent.name, role: agent.role, soul: agent.soul, branch_id: agent.branch_id, department_id: agent.department_id, model_group: agent.model_group });
  const branch = branches.find((b) => b.id === d.branch_id);
  const dirty = JSON.stringify(d) !== JSON.stringify({ name: agent.name, role: agent.role, soul: agent.soul, branch_id: agent.branch_id, department_id: agent.department_id, model_group: agent.model_group });
  return (
    <div className="grid max-w-2xl gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={d.name} disabled={!canManage} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Field label="Job title" value={d.role} disabled={!canManage} onChange={(e) => setD({ ...d, role: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Branch</span>
          <Select value={d.branch_id} disabled={!canManage} onValueChange={(v) => setD({ ...d, branch_id: v, department_id: null })} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Department</span>
          <Select value={d.department_id ?? "none"} disabled={!canManage} onValueChange={(v) => setD({ ...d, department_id: v === "none" ? null : v })} label="Department"
            options={[{ value: "none", label: "No department" }, ...(branch?.departments ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Model group</span>
          <Select value={d.model_group} disabled={!canManage} onValueChange={(v) => setD({ ...d, model_group: v })} label="Model group" options={groups.map((g) => ({ value: g.name, label: g.label }))} />
        </div>
      </div>
      <TextareaField label="Personality and way of working" value={d.soul} disabled={!canManage} rows={9} onChange={(e) => setD({ ...d, soul: e.target.value })} />
      {canManage ? (
        <Button className="w-fit" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(d)}>
          <CheckIcon size={15} weight="bold" /> Save profile
        </Button>
      ) : null}
    </div>
  );
}

function Permissions({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const save = useSaveAgent(agent);
  const [tools, setTools] = useState<Record<string, ToolMode>>(agent.tools);
  const [autonomy, setAutonomy] = useState(agent.autonomy);
  const dirty = JSON.stringify(tools) !== JSON.stringify(agent.tools) || autonomy !== agent.autonomy;
  return (
    <div className="grid max-w-3xl gap-4">
      <ToolMatrix tools={tools} onChange={setTools} autonomy={autonomy} onAutonomy={setAutonomy} disabled={!canManage} />
      {canManage ? (
        <Button className="w-fit" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ tools, autonomy })}>
          <CheckIcon size={15} weight="bold" /> Save permissions
        </Button>
      ) : null}
    </div>
  );
}

function SOPs({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const save = useSaveAgent(agent);
  const { data: sops = [] } = useQuery(sopsQuery);
  const auto = sops.filter((s) => s.scope === "workspace" || (s.scope === "branch" && s.scope_id === agent.branch_id) || (s.scope === "department" && s.scope_id === agent.department_id));
  const library = sops.filter((s) => s.scope === "library");
  const toggle = (id: string) => save.mutate({ sop_ids: agent.sop_ids.includes(id) ? agent.sop_ids.filter((x) => x !== id) : [...agent.sop_ids, id] });
  return (
    <div className="grid max-w-2xl gap-6">
      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold">Applied automatically</h2>
        {auto.length ? auto.map((s) => (
          <Link key={s.id} to="/sops" search={{ sop: s.id }} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface px-3 py-2 text-[13px] hover:bg-surface-2/60">
            <span className="font-medium">{s.title}</span><span className="text-[12px] text-muted">{s.scope_label} · v{s.version}</span>
          </Link>
        )) : <p className="text-[13px] text-muted">None yet.</p>}
      </section>
      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold">Attached from the library</h2>
        {library.length ? library.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-sm border border-border bg-surface px-3 py-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={agent.sop_ids.includes(s.id)} disabled={!canManage || save.isPending} onChange={() => toggle(s.id)} />
            <span className="font-medium">{s.title}</span>
          </label>
        )) : <p className="text-[13px] text-muted">No library SOPs yet. <Link to="/sops" className="text-accent hover:underline">Write one</Link>.</p>}
      </section>
    </div>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams({ strict: false }) as { agentId: string };
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const { data: agent, isLoading, error } = useQuery(agentQuery(agentId));
  // The server says whether this person may change this agent (scope and ownership).
  const canManage = !!agent?.can_manage;
  const live = useLive((s) => s.agentStatus[agentId]);
  const [retiring, setRetiring] = useState(false);
  const tab: Tab = search.tab && TABS.includes(search.tab) ? search.tab : "overview";

  const setStatus = useMutation({
    mutationFn: (status: Agent["status"]) => api<Agent>(`/api/agents/${agentId}`, "PATCH", { status }),
    onSuccess: (a) => {
      qc.setQueryData(workKeys.agent(a.id), a);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(a.status === "active" ? `${a.name} is back at work.` : a.status === "paused" ? `${a.name} is paused.` : `${a.name} was retired.`);
      if (a.status === "retired") navigate({ to: "/agents" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Page><Skeleton className="h-24 rounded-[var(--radius-md)]" /></Page>;
  if (error || !agent) return <Page><p role="alert" className="text-danger">{errorMessage(error)}</p></Page>;
  const state = agentState(agent, live);

  return (
    <Page>
      <Link to="/agents" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeftIcon size={14} /> Agents
      </Link>
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <AgentAvatar name={agent.name} color={agent.color} size="lg" working={state.label === "Working"} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
            {agent.name} <Pill tone={state.tone}>{state.label}</Pill>
          </h1>
          <p className="text-[13.5px] text-muted">
            {agent.role} · {agent.department_name ?? "No department"}, {agent.branch_name}
            {agent.owner_name ? ` · ${agent.owner_name}'s personal agent` : ""}
            {agent.clone_of ? " · a helper, here while a big job runs" : ""}
          </p>
          {agent.current_task ? (
            <Link to="/tasks" search={{ task: agent.current_task.id }} className="mt-1 inline-block text-[13px] text-accent hover:underline">
              {agent.current_task.status === "blocked" ? "Waiting on you: " : "Working on: "}{agent.current_task.title}
            </Link>
          ) : null}
        </div>
        <Button variant="outline" asChild><Link to="/monitor" search={{ agent: agent.id }}><EyeIcon size={15} /> Watch live</Link></Button>
        {canManage ? (
          <div className="flex gap-2">
            {agent.status === "active" ? (
              <Button variant="outline" onClick={() => setStatus.mutate("paused")}><PauseIcon size={15} /> Pause</Button>
            ) : (
              <Button variant="outline" onClick={() => setStatus.mutate("active")}><PlayIcon size={15} /> Resume</Button>
            )}
            <Button variant="ghost" onClick={() => setRetiring(true)}>Retire</Button>
          </div>
        ) : null}
      </header>

      <Tabs.Root value={tab} onValueChange={(v) => navigate({ to: "/agents/$agentId", params: { agentId }, search: { tab: v as Tab }, replace: true })}>
        <Tabs.List aria-label={`${agent.name} sections`} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((t) => (
            <Tabs.Trigger key={t} value={t} className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
              {LABELS[t]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="outline-none">
          <div className="mb-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2">
              <h2 className="text-[15px] font-semibold">Right now</h2>
              <AgentLive agentId={agent.id} name={agent.name} />
            </section>
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2">
              <h2 className="text-[15px] font-semibold">What came out of it</h2>
              <AgentOutcome agentId={agent.id} name={agent.name} />
            </section>
          </div>
          <Overview agent={agent} />
        </Tabs.Content>
        <Tabs.Content value="chat" className="outline-none"><ChatPanel agent={agent} canWrite={canWrite} className="h-[min(70dvh,44rem)]" /></Tabs.Content>
        <Tabs.Content value="memory" className="outline-none"><MemoryTab agent={agent} canWrite={canWrite} /></Tabs.Content>
        <Tabs.Content value="profile" className="outline-none"><Profile key={agent.id + agent.created_at} agent={agent} canManage={canManage} /></Tabs.Content>
        <Tabs.Content value="team" className="outline-none"><TeamTab key={agent.id + String(agent.budget_daily_tokens) + agent.role_kind + String(agent.heartbeat)} agent={agent} canManage={canManage} /></Tabs.Content>
        <Tabs.Content value="permissions" className="outline-none"><Permissions key={JSON.stringify(agent.tools) + agent.autonomy} agent={agent} canManage={canManage} /></Tabs.Content>
        <Tabs.Content value="sops" className="outline-none"><SOPs agent={agent} canManage={canManage} /></Tabs.Content>
      </Tabs.Root>

      <ConfirmDialog
        open={retiring}
        onOpenChange={setRetiring}
        title={`Retire ${agent.name}?`}
        body="Retired agents stop working and leave the roster. Their past tasks and history stay."
        confirmLabel="Retire agent"
        danger
        onConfirm={async () => { await setStatus.mutateAsync("retired"); }}
      />
    </Page>
  );
}
