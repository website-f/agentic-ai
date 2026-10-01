import { PlusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import { branchesQuery, meQuery } from "@/lib/queries";
import { useBranch } from "@/lib/stores";
import { agentsQuery, type Agent } from "@/lib/work";

import { OrgChart } from "./org-chart";

export function agentState(a: Agent, live?: { status: string } | undefined): { label: string; tone: "accent" | "warn" | "neutral" | "info" } {
  if (a.status === "paused") return { label: "Paused", tone: "neutral" };
  if (a.current_task?.status === "blocked" || live?.status === "waiting_approval") return { label: "Waiting on you", tone: "warn" };
  if (live?.status === "in_meeting") return { label: "In a meeting", tone: "accent" };
  if (a.current_task?.status === "running" || live?.status === "working") return { label: "Working", tone: "accent" };
  return { label: "Available", tone: "info" };
}

function AgentCard({ agent }: { agent: Agent }) {
  const live = useLive((s) => s.agentStatus[agent.id]);
  const state = agentState(agent, live);
  return (
    <Link
      to="/agents/$agentId"
      params={{ agentId: agent.id }}
      className="group flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 transition-colors hover:border-accent/40"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} color={agent.color} working={state.label === "Working"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold group-hover:text-accent">{agent.name}</p>
          <p className="truncate text-[12.5px] text-muted">{agent.role}</p>
        </div>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
      <p className="line-clamp-1 text-[12.5px] text-muted">
        {agent.current_task ? <>On: <span className="text-fg">{agent.current_task.title}</span></> : agent.open_tasks ? `${agent.open_tasks} open ${agent.open_tasks === 1 ? "task" : "tasks"}` : "No open tasks"}
      </p>
      <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        <Pill className="font-mono">{agent.model_group}</Pill>
        {agent.autonomy === "auto" ? <Pill tone="accent">Auto</Pill> : null}
        {agent.role_kind === "orchestrator" ? <Pill tone="accent">Leads</Pill> : null}
        {agent.budget_daily_tokens || agent.budget_monthly_usd ? <Pill>Budget</Pill> : null}
        {agent.sop_ids.length ? <Pill>{agent.sop_ids.length} SOPs</Pill> : null}
      </div>
    </Link>
  );
}

export function AgentsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const { data: agents, isLoading, error } = useQuery(agentsQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const branchId = useBranch((s) => s.branchId);
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const { view } = useSearch({ strict: false }) as { view?: "org" };
  const navigate = useNavigate();

  const sections = useMemo(() => {
    if (!branch) return [];
    const mine = (agents ?? []).filter((a) => a.branch_id === branch.id);
    const out = branch.departments.map((d) => ({ id: d.id, name: d.name, agents: mine.filter((a) => a.department_id === d.id) }));
    const loose = mine.filter((a) => !a.department_id);
    if (loose.length) out.push({ id: "none", name: "No department", agents: loose });
    return out;
  }, [agents, branch]);
  const total = sections.reduce((n, s) => n + s.agents.length, 0);

  return (
    <Page>
      <PageHeader
        title="Agents"
        description={branch ? `The staff of ${branch.name}, by department. Switch company with the branch picker above.` : "Create a branch first, then add agents to its departments."}
        actions={canManage && branch ? (
          <Button asChild>
            <Link to="/agents/new">
              <PlusIcon size={16} weight="bold" /> New agent
            </Link>
          </Button>
        ) : null}
      />
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load agents. {errorMessage(error)}</div>
      ) : !branch ? (
        <EmptyState icon={UsersThreeIcon} title="No branches yet" body="Agents belong to a company. Create a branch in Organization first." action={<Button asChild variant="outline"><Link to="/organization">Open Organization</Link></Button>} />
      ) : total === 0 ? (
        <EmptyState
          icon={UsersThreeIcon}
          title={`No agents at ${branch.name} yet`}
          body="Start from a template like Accountant or Researcher, place it in a department, and give it your SOPs."
          action={canManage ? <Button asChild><Link to="/agents/new"><PlusIcon size={16} weight="bold" /> Create first agent</Link></Button> : undefined}
        />
      ) : (
        <div className="grid gap-6">
          <RadioGroup.Root value={view ?? "departments"} onValueChange={(v) => navigate({ to: "/agents", search: { view: v === "org" ? "org" : undefined }, replace: true })}
            aria-label="Show agents by" className="inline-flex w-fit rounded-sm border border-border p-0.5">
            {([["departments", "By department"], ["org", "Org chart"]] as const).map(([v, label]) => (
              <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-3 py-1 text-[13px] text-muted data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{label}</RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          {view === "org" ? <OrgChart agents={(agents ?? []).filter((a) => a.branch_id === branch.id && a.status !== "retired")} manage={canManage} /> : (
        <div className="grid gap-8">
          {sections.filter((s) => s.agents.length).map((s) => (
            <section key={s.id} className="grid gap-3">
              <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
                {s.name} <span className="text-[12.5px] font-normal text-muted">{s.agents.length}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.agents.map((a) => <AgentCard key={a.id} agent={a} />)}
              </div>
            </section>
          ))}
          {sections.some((s) => !s.agents.length) ? (
            <p className="text-[12.5px] text-muted">
              Empty departments: {sections.filter((s) => !s.agents.length).map((s) => s.name).join(", ")}.
            </p>
          ) : null}
        </div>
          )}
        </div>
      )}
    </Page>
  );
}
