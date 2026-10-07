import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BrowserIcon,
  ChatsCircleIcon,
  CheckIcon,
  EyeIcon,
  FileTextIcon,
  HandIcon,
  KanbanIcon,
  LightningIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SmileyIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAccessPills } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { ChatLauncher } from "@/components/chat/chat-launcher";
import { chatRoute } from "@/components/chat/links";
import { AgentLive, AgentOutcome } from "@/components/agent-live";
import { IconTile, Page, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ActionBar, Card, CardBody, CardHeader, ListCard, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { openTaskComposer } from "@/components/task-composer/store";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import { branchesQuery, keys, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentQuery, sopsQuery, STATUS_INFO, tasksQuery, workKeys, type Agent, type ToolMode } from "@/lib/work";
import { chatGroupsQuery } from "@/pages/ai-engine/data";

import { MemoryTab } from "./memory-tab";
import { agentState } from "./roster";
import { TeamTab } from "./team-tab";
import { ToolMatrix } from "./tool-matrix";

const TABS = ["overview", "chat", "memory", "profile", "team", "permissions", "sops"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  overview: msg("Overview"),
  chat: msg("Chat"),
  memory: msg("Memory"),
  profile: msg("Profile"),
  team: msg("Team & budget"),
  permissions: msg("Permissions"),
  sops: msg("SOPs"),
};

function useSaveAgent(agent: Agent) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Agent>) => api<Agent>(`/api/agents/${agent.id}`, "PATCH", patch),
    onSuccess: (a) => {
      qc.setQueryData(workKeys.agent(a.id), a);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      toast.success(tr("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function Overview({ agent }: { agent: Agent }) {
  const t = useT();
  // A watched colleague's agent: its tasks and results are not the viewer's, so only the live view shows.
  const viewOnly = agent.view_only;
  const { data: tasks = [] } = useQuery({ ...tasksQuery, enabled: !viewOnly });
  const mine = tasks.filter((x) => x.assignee_agent_id === agent.id).slice(0, 12);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        <Section title={t("Right now")} description={t("Its screen and every step, live.")} className="grid-cols-[minmax(0,1fr)] content-start">
          <AgentLive agentId={agent.id} name={agent.name} viewOnly={viewOnly} />
        </Section>
        {viewOnly ? null : <Card className="overflow-hidden">
          <CardHeader
            icon={<IconTile icon={KanbanIcon} tone="info" size="sm" />}
            title={t("Tasks")}
            description={mine.length ? t("The latest {n} given to {name}.", { n: mine.length, name: agent.name }) : undefined}
            actions={
              <Button size="sm" variant="outline" onClick={() => openTaskComposer({ agentId: agent.id })}>
                <PlusIcon size={14} /> {t("Give a task")}
              </Button>
            }
          />
          {mine.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
              {mine.map((task) => (
                <li key={task.id}>
                  <Link to="/tasks" search={{ task: task.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13.5px] break-words">{task.title}</span>
                      <span className="block text-[12px] text-muted sm:hidden">{timeAgo(task.updated_at)}</span>
                    </span>
                    <Pill tone={STATUS_INFO[task.status].tone} className="shrink-0">
                      {t(STATUS_INFO[task.status].label)}
                    </Pill>
                    <span className="hidden w-20 shrink-0 text-right text-[12px] text-muted sm:block">{timeAgo(task.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-muted">{t("No tasks yet. Give {name} something to do.", { name: agent.name })}</p>
          )}
        </Card>}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">
        {viewOnly ? null : (
          <Section title={t("What came out of it")} description={t("Its latest finished work and reports.")} className="grid-cols-[minmax(0,1fr)] content-start">
            <AgentOutcome agentId={agent.id} name={agent.name} />
          </Section>
        )}
        <Card className="overflow-hidden">
          <CardHeader icon={<IconTile icon={SmileyIcon} tone="violet" size="sm" />} title={t("Personality")} description={t("How it thinks, writes and reports.")} />
          <CardBody>
            <p className="text-[13.5px] break-words whitespace-pre-wrap text-muted">{agent.soul || t("No personality written yet.")}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Profile({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const t = useT();
  const save = useSaveAgent(agent);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: groups = [] } = useQuery(chatGroupsQuery);
  const [d, setD] = useState({
    name: agent.name,
    role: agent.role,
    soul: agent.soul,
    branch_id: agent.branch_id,
    department_id: agent.department_id,
    model_group: agent.model_group,
  });
  const branch = branches.find((b) => b.id === d.branch_id);
  const dirty =
    JSON.stringify(d) !==
    JSON.stringify({
      name: agent.name,
      role: agent.role,
      soul: agent.soul,
      branch_id: agent.branch_id,
      department_id: agent.department_id,
      model_group: agent.model_group,
    });
  return (
    <div className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field label={t("Name")} value={d.name} disabled={!canManage} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Field label={t("Job title")} value={d.role} disabled={!canManage} onChange={(e) => setD({ ...d, role: e.target.value })} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Branch")}</span>
          <Select
            value={d.branch_id}
            disabled={!canManage}
            onValueChange={(v) => setD({ ...d, branch_id: v, department_id: null })}
            label={t("Branch")}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Department")}</span>
          <Select
            value={d.department_id ?? "none"}
            disabled={!canManage}
            onValueChange={(v) => setD({ ...d, department_id: v === "none" ? null : v })}
            label={t("Department")}
            options={[
              { value: "none", label: t("No department") },
              ...(branch?.departments ?? []).map((x) => ({
                value: x.id,
                label: x.name,
              })),
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Model group")}</span>
          <Select
            value={d.model_group}
            disabled={!canManage}
            onValueChange={(v) => setD({ ...d, model_group: v })}
            label={t("Model group")}
            options={groups.map((g) => ({ value: g.name, label: g.label }))}
          />
        </div>
      </div>
      <TextareaField
        label={t("Personality and way of working")}
        value={d.soul}
        disabled={!canManage}
        rows={9}
        onChange={(e) => setD({ ...d, soul: e.target.value })}
      />
      {canManage ? (
        <ActionBar className="justify-start">
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(d)}>
            <CheckIcon size={15} weight="bold" /> {t("Save profile")}
          </Button>
        </ActionBar>
      ) : null}
    </div>
  );
}

function Permissions({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const t = useT();
  const save = useSaveAgent(agent);
  const [tools, setTools] = useState<Record<string, ToolMode>>(agent.tools);
  const [autonomy, setAutonomy] = useState(agent.autonomy);
  const dirty = JSON.stringify(tools) !== JSON.stringify(agent.tools) || autonomy !== agent.autonomy;
  return (
    <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4">
      <ToolMatrix tools={tools} onChange={setTools} autonomy={autonomy} onAutonomy={setAutonomy} disabled={!canManage} />
      {canManage ? (
        <ActionBar className="justify-start">
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ tools, autonomy })}>
            <CheckIcon size={15} weight="bold" /> {t("Save permissions")}
          </Button>
        </ActionBar>
      ) : null}
    </div>
  );
}

function SOPs({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const t = useT();
  const save = useSaveAgent(agent);
  const { data: sops = [] } = useQuery(sopsQuery);
  const auto = sops.filter(
    (s) =>
      s.scope === "workspace" || (s.scope === "branch" && s.scope_id === agent.branch_id) || (s.scope === "department" && s.scope_id === agent.department_id),
  );
  const library = sops.filter((s) => s.scope === "library");
  const toggle = (id: string) =>
    save.mutate({
      sop_ids: agent.sop_ids.includes(id) ? agent.sop_ids.filter((x) => x !== id) : [...agent.sop_ids, id],
    });
  return (
    <div className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-6">
      <section className="grid min-w-0 gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">{t("Applied automatically")}</h2>
          <p className="text-[12.5px] text-muted">{t("From the workspace, {branch} and its department.", { branch: agent.branch_name })}</p>
        </div>
        {auto.length ? (
          <ListCard>
            {auto.map((s) => (
              <li key={s.id}>
                <Link to="/sops" search={{ sop: s.id }} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] hover:bg-surface-2/60">
                  <FileTextIcon size={16} weight="duotone" className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 font-medium break-words">{s.title}</span>
                  <span className="text-[12px] text-muted max-sm:basis-full max-sm:pl-7">
                    {s.scope_label} · v{s.version}
                  </span>
                </Link>
              </li>
            ))}
          </ListCard>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-4 text-[13px] text-muted">{t("None yet.")}</p>
        )}
      </section>
      <section className="grid min-w-0 gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">{t("Attached from the library")}</h2>
          <p className="text-[12.5px] text-muted">{t("Tick the extra SOPs {name} should follow.", { name: agent.name })}</p>
        </div>
        {library.length ? (
          <ListCard>
            {library.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--accent)]"
                    checked={agent.sop_ids.includes(s.id)}
                    disabled={!canManage || save.isPending}
                    onChange={() => toggle(s.id)}
                  />
                  <span className="min-w-0 flex-1 font-medium break-words">{s.title}</span>
                </label>
              </li>
            ))}
          </ListCard>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-4 text-[13px] text-muted">
            {t("No library SOPs yet.")}{" "}
            <Link to="/sops" className="text-accent hover:underline">
              {t("Write one")}
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

export function AgentDetailPage() {
  const t = useT();
  const { agentId } = useParams({ strict: false }) as { agentId: string };
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: agent, isLoading, error } = useQuery(agentQuery(agentId));
  // A colleague's agent the viewer only watches: no chat, tasks, browsing or edits at all.
  const viewOnly = !!agent?.view_only;
  const canWrite = me.permissions.includes("work.write") && !viewOnly;
  // The server says whether this person may change this agent (scope and ownership).
  const canManage = !!agent?.can_manage && !viewOnly;
  const live = useLive((s) => s.agentStatus[agentId]);
  const [retiring, setRetiring] = useState(false);
  // Watching only: chat and memory are the owner's; the rest stays readable.
  const tabs: readonly Tab[] = viewOnly ? TABS.filter((x) => x !== "chat" && x !== "memory") : TABS;
  const tab: Tab = search.tab && tabs.includes(search.tab) ? search.tab : "overview";

  const setStatus = useMutation({
    mutationFn: (status: Agent["status"]) => api<Agent>(`/api/agents/${agentId}`, "PATCH", { status }),
    onSuccess: (a) => {
      qc.setQueryData(workKeys.agent(a.id), a);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(a.status === "active" ? tr("{name} is back at work.", { name: a.name }) : a.status === "paused" ? tr("{name} is paused.", { name: a.name }) : tr("{name} was retired.", { name: a.name }));
      if (a.status === "retired") navigate({ to: "/agents" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading)
    return (
      <Page>
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-36 rounded-[var(--radius-md)]" />
        <Skeleton className="h-10" />
        <Skeleton className="h-72 rounded-[var(--radius-md)]" />
      </Page>
    );
  if (error || !agent)
    return (
      <Page>
        <p role="alert" className="text-danger">
          {errorMessage(error)}
        </p>
      </Page>
    );
  const state = agentState(agent, live);

  return (
    <Page>
      <Link to="/agents" className="-my-1 inline-flex h-9 w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeftIcon size={14} /> {t("Agents")}
      </Link>
      <Card className="p-4 sm:p-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <AgentAvatar name={agent.name} color={agent.color} size="lg" working={state.label === "Working"} />
            <div className="grid min-w-0 flex-1 gap-1">
              <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[20px] leading-tight font-semibold tracking-tight break-words sm:text-[22px]">
                {agent.name} <Pill tone={state.tone}>{t(state.label)}</Pill>
                <AgentAccessPills agent={agent} />
              </h1>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
                <Meta
                  items={[
                    agent.role,
                    `${agent.department_name ?? t("No department")}, ${agent.branch_name}`,
                    agent.owner_name ? t("{name}'s personal agent", { name: agent.owner_name }) : null,
                    agent.clone_of ? t("A helper, here while a big job runs") : null,
                  ]}
                />
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Pill className="font-mono">{agent.model_group}</Pill>
                {agent.role_kind === "orchestrator" ? <Pill tone="accent">{t("Leads")}</Pill> : null}
                {agent.autonomy === "auto" ? <Pill tone="accent">{t("Auto")}</Pill> : <Pill>{t("Asks first")}</Pill>}
                {agent.heartbeat ? <Pill tone="ok">{t("Heartbeat")}</Pill> : null}
                {agent.sop_ids.length ? <Pill>{t("{n} SOPs", { n: agent.sop_ids.length })}</Pill> : null}
                {agent.budget_daily_tokens || agent.budget_monthly_usd ? <Pill>{t("Budget set")}</Pill> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
            {!viewOnly ? (
              <Button asChild>
                <Link {...chatRoute(agent.id, { from: `/agents/${agentId}` })}>
                  <ChatsCircleIcon size={15} weight="fill" /> {t("Chat")}
                </Link>
              </Button>
            ) : null}
            {canWrite && agent.status === "active" ? (
              <>
                <Button variant="outline" onClick={() => openTaskComposer({ agentId: agent.id })}>
                  <PlusIcon size={15} /> {t("Give a task")}
                </Button>
                <Button variant="outline" onClick={() => openTaskComposer({ agentId: agent.id, kind: "browse" })}>
                  <BrowserIcon size={15} /> {t("Browse for me")}
                </Button>
              </>
            ) : null}
            <Button variant="outline" asChild>
              <Link to="/monitor" search={{ agent: agent.id }}>
                <EyeIcon size={15} /> {t("Watch live")}
              </Link>
            </Button>
            {canManage ? (
              <>
                {agent.status === "active" ? (
                  <Button variant="outline" onClick={() => setStatus.mutate("paused")}>
                    <PauseIcon size={15} /> {t("Pause")}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setStatus.mutate("active")}>
                    <PlayIcon size={15} /> {t("Resume")}
                  </Button>
                )}
                <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setRetiring(true)}>
                  {t("Retire")}
                </Button>
              </>
            ) : null}
          </div>
        </header>
        {agent.current_task && viewOnly ? (
          // The viewer can't open a colleague's task, so this is a plain line, not a link.
          <p
            className={cn(
              "mt-4 flex items-center gap-2.5 rounded-sm border px-3 py-2 text-[13px]",
              agent.current_task.status === "blocked" ? "border-warn/30 bg-warn/8" : "border-accent/25 bg-accent-soft/50",
            )}
          >
            {agent.current_task.status === "blocked" ? (
              <HandIcon size={16} weight="duotone" className="shrink-0 text-warn" />
            ) : (
              <LightningIcon size={16} weight="duotone" className="shrink-0 text-accent" />
            )}
            <span className="min-w-0 flex-1">
              <span className="text-muted">{agent.current_task.status === "blocked" ? t("Waiting on approval:") : t("Working on:")}</span>{" "}
              <span className="font-medium break-words">{agent.current_task.title}</span>
            </span>
          </p>
        ) : agent.current_task ? (
          <Link
            to="/tasks"
            search={{ task: agent.current_task.id }}
            className={cn(
              "mt-4 flex items-center gap-2.5 rounded-sm border px-3 py-2 text-[13px] transition-colors",
              agent.current_task.status === "blocked" ? "border-warn/30 bg-warn/8 hover:bg-warn/12" : "border-accent/25 bg-accent-soft/50 hover:bg-accent-soft",
            )}
          >
            {agent.current_task.status === "blocked" ? (
              <HandIcon size={16} weight="duotone" className="shrink-0 text-warn" />
            ) : (
              <LightningIcon size={16} weight="duotone" className="shrink-0 text-accent" />
            )}
            <span className="min-w-0 flex-1">
              <span className="text-muted">{agent.current_task.status === "blocked" ? t("Waiting on you:") : t("Working on:")}</span>{" "}
              <span className="font-medium break-words">{agent.current_task.title}</span>
            </span>
            <ArrowRightIcon size={14} className="shrink-0 text-muted" />
          </Link>
        ) : null}
        {viewOnly ? (
          <p role="note" className="mt-4 flex items-start gap-2.5 rounded-sm border border-border bg-surface-2/60 px-3 py-2.5 text-[13px] text-muted">
            <EyeIcon size={16} weight="duotone" className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              {agent.owner_name ? t("You're watching {name}. Only {owner} can instruct or change it.", { name: agent.name, owner: agent.owner_name }) : t("You're watching {name}. Only its manager can instruct or change it.", { name: agent.name })}
            </span>
          </p>
        ) : null}
      </Card>

      <Tabs.Root
        value={tab}
        onValueChange={(v) =>
          // Chat opens full screen; Back returns to this profile.
          v === "chat"
            ? navigate(chatRoute(agentId, { from: `/agents/${agentId}` }))
            : navigate({
                to: "/agents/$agentId",
                params: { agentId },
                search: { tab: v as Tab },
                replace: true,
              })
        }
      >
        <Tabs.List
          aria-label={t("{name} sections", { name: agent.name })}
          className="mb-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((k) => (
            <Tabs.Trigger
              key={k}
              value={k}
              className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg"
            >
              {t(LABELS[k])}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="outline-none">
          <Overview agent={agent} />
        </Tabs.Content>
        {viewOnly ? null : (
          <>
            <Tabs.Content value="chat" className="outline-none">
              <ChatLauncher agent={agent} canWrite={canWrite} from={`/agents/${agentId}?tab=chat`} />
            </Tabs.Content>
            <Tabs.Content value="memory" className="outline-none">
              <MemoryTab agent={agent} canWrite={canWrite} />
            </Tabs.Content>
          </>
        )}
        <Tabs.Content value="profile" className="outline-none">
          <Profile key={agent.id + agent.created_at} agent={agent} canManage={canManage} />
        </Tabs.Content>
        <Tabs.Content value="team" className="outline-none">
          <TeamTab key={agent.id + String(agent.budget_daily_tokens) + agent.role_kind + String(agent.heartbeat)} agent={agent} canManage={canManage} />
        </Tabs.Content>
        <Tabs.Content value="permissions" className="outline-none">
          <Permissions key={JSON.stringify(agent.tools) + agent.autonomy} agent={agent} canManage={canManage} />
        </Tabs.Content>
        <Tabs.Content value="sops" className="outline-none">
          <SOPs agent={agent} canManage={canManage} />
        </Tabs.Content>
      </Tabs.Root>

      <ConfirmDialog
        open={retiring}
        onOpenChange={setRetiring}
        title={t("Retire {name}?", { name: agent.name })}
        body={t("Retired agents stop working and leave the roster. Their past tasks and history stay.")}
        confirmLabel={t("Retire agent")}
        danger
        onConfirm={async () => {
          await setStatus.mutateAsync("retired");
        }}
      />
    </Page>
  );
}
