import { HandIcon, LightningIcon, PauseCircleIcon, PlusIcon, UserFocusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AgentAccessPills } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useCompanies } from "@/lib/company";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";
import { agentsQuery, type Agent } from "@/lib/work";

import { OrgChart } from "./org-chart";

export function agentState(a: Agent, live?: { status: string } | undefined): { label: string; tone: "accent" | "warn" | "neutral" | "info" } {
  if (a.status === "paused") return { label: "Paused", tone: "neutral" };
  // A watched colleague's agent waits on its own manager, not on the viewer.
  if (a.current_task?.status === "blocked" || live?.status === "waiting_approval") return { label: a.view_only ? "Waiting on approval" : "Waiting on you", tone: "warn" };
  if (live?.status === "in_meeting") return { label: "In a meeting", tone: "accent" };
  if (a.current_task?.status === "running" || live?.status === "working") return { label: "Working", tone: "accent" };
  return { label: "Available", tone: "info" };
}

function AgentCard({ agent, guide }: { agent: Agent; guide?: string }) {
  const live = useLive((s) => s.agentStatus[agent.id]);
  const state = agentState(agent, live);
  return (
    <Link
      data-guide={guide}
      to="/agents/$agentId"
      params={{ agentId: agent.id }}
      className="group flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={agent.name} color={agent.color} working={state.label === "Working"} />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug font-semibold break-words group-hover:text-accent">{agent.name}</p>
          <p className="truncate text-[12.5px] text-muted" title={agent.role}>{agent.role}</p>
        </div>
        <Pill tone={state.tone} className="shrink-0">{state.label}</Pill>
      </div>
      <p className="line-clamp-2 rounded-sm bg-surface-2/60 px-2.5 py-1.5 text-[12.5px] text-muted">
        {agent.current_task ? <>On: <span className="text-fg">{agent.current_task.title}</span></> : agent.open_tasks ? `${agent.open_tasks} open ${agent.open_tasks === 1 ? "task" : "tasks"}` : "No open tasks"}
      </p>
      <div className="mt-auto flex flex-wrap gap-1.5 text-[11.5px]">
        <Pill className="font-mono">{agent.model_group}</Pill>
        <AgentAccessPills agent={agent} />
        {agent.clone_of ? <Pill tone="info">Helper</Pill> : null}
        {agent.owner_name && !agent.is_twin ? <Pill tone="info">{agent.owner_name}&apos;s agent</Pill> : null}
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
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  // P18: staff have one agent, their AI twin; only managers add more.
  const staff = staffOnly(me.permissions);
  const twinHint = "Staff have one AI twin. Ask your manager for more agents.";
  const { data: agents, isLoading, error } = useQuery(agentsQuery);
  // "All companies" in the header shows every company the person may see, grouped by company.
  const { branches: visible, isAll, selected, isLoading: loadingCompanies } = useCompanies();
  const shown = useMemo(() => (isAll ? visible : selected ? [selected] : []), [isAll, visible, selected]);
  const branch = shown[0];
  const { view } = useSearch({ strict: false }) as { view?: "org" };
  const navigate = useNavigate();

  // Staff also see colleagues' agents (view only). When the list mixes both, offer Mine / Office.
  const [whose, setWhose] = useState<"all" | "mine" | "office">("all");
  const inBranch = useMemo(() => {
    const ids = new Set(shown.map((b) => b.id));
    return (agents ?? []).filter((a) => ids.has(a.branch_id));
  }, [agents, shown]);
  const ownCount = inBranch.filter((a) => !a.view_only).length;
  const watchCount = inBranch.length - ownCount;
  const mixed = ownCount > 0 && watchCount > 0;
  const scope = mixed ? whose : "all";

  const sections = useMemo(() => {
    const mine = inBranch.filter((a) => (scope === "mine" ? !a.view_only : scope === "office" ? a.view_only : true));
    return shown.flatMap((b) => {
      const here = mine.filter((a) => a.branch_id === b.id);
      const out = b.departments.map((d) => ({ id: d.id, name: d.name, company: b, agents: here.filter((a) => a.department_id === d.id) }));
      const loose = here.filter((a) => !a.department_id || !b.departments.some((d) => d.id === a.department_id));
      if (loose.length) out.push({ id: `none-${b.id}`, name: "No department", company: b, agents: loose });
      return out;
    });
  }, [inBranch, shown, scope]);
  const companies = useMemo(
    () => shown.map((b) => ({ company: b, sections: sections.filter((s) => s.company.id === b.id) })).filter((c) => c.sections.some((s) => s.agents.length)),
    [shown, sections],
  );
  const total = sections.reduce((n, s) => n + s.agents.length, 0);
  const firstAgentId = sections.find((s) => s.agents.length)?.agents[0]?.id;
  const statuses = useLive((s) => s.agentStatus);
  const counts = useMemo(() => {
    const here = sections.flatMap((s) => s.agents);
    const labels = here.map((a) => agentState(a, statuses[a.id]).label);
    return {
      working: labels.filter((l) => l === "Working" || l === "In a meeting").length,
      waiting: labels.filter((l) => l === "Waiting on you").length,
      watching: here.filter((a) => a.view_only).length,
      paused: labels.filter((l) => l === "Paused").length,
    };
  }, [sections, statuses]);

  return (
    <Page>
      <PageHeader
        title="Agents"
        description={!branch ? "Create a company first, then add agents to its departments."
          : `${isAll ? `The staff of all ${shown.length} companies, by company and department.` : `The staff of ${branch.name}, by department.`} Switch company with the picker at the top.${staff ? ` ${twinHint}` : ""}`}
        actions={staff ? (
          <Button asChild variant="outline" title={twinHint}>
            <Link to="/twin">
              <UserFocusIcon size={16} weight="bold" /> My twin
            </Link>
          </Button>
        ) : canManage && branch ? (
          <Button asChild data-guide="agents.new">
            <Link to="/agents/new">
              <PlusIcon size={16} weight="bold" /> New agent
            </Link>
          </Button>
        ) : null}
      />
      {isLoading || loadingCompanies ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load agents. {errorMessage(error)}</div>
      ) : !branch ? (
        <EmptyState icon={UsersThreeIcon} title="No branches yet" body="Agents belong to a company. Create a branch in Organization first." action={<Button asChild variant="outline"><Link to="/organization">Open Organization</Link></Button>} />
      ) : total === 0 ? (
        <EmptyState
          icon={UsersThreeIcon}
          title={isAll ? "No agents yet" : `No agents at ${branch.name} yet`}
          body="Start from a template like Accountant or Researcher, place it in a department, and give it your SOPs."
          action={staff ? <Button asChild><Link to="/twin"><UserFocusIcon size={16} weight="bold" /> Meet your AI twin</Link></Button> : canManage ? <Button asChild><Link to="/agents/new"><PlusIcon size={16} weight="bold" /> Create first agent</Link></Button> : undefined}
        />
      ) : (
        <>
          <StatGrid>
            <Stat label="Agents" value={total} hint={counts.watching ? `${counts.watching} you can only watch` : isAll ? `In ${companies.length} ${companies.length === 1 ? "company" : "companies"}` : `In ${sections.filter((s) => s.agents.length).length} departments`} icon={UsersThreeIcon} tone="accent" />
            <Stat label="Working now" value={counts.working} hint="On a task or in a meeting" icon={LightningIcon} tone="info" />
            <Stat label="Waiting on you" value={counts.waiting} hint={counts.waiting ? "Open Approvals to decide" : "Nothing to decide"} icon={HandIcon} tone={counts.waiting ? "warn" : "neutral"} />
            <Stat label="Paused" value={counts.paused} hint="Not taking work" icon={PauseCircleIcon} tone="neutral" />
          </StatGrid>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented
              guide="agents.org"
              label="Show agents by"
              value={view === "org" ? "org" : "departments"}
              onChange={(v) => navigate({ to: "/agents", search: { view: v === "org" ? "org" : undefined }, replace: true })}
              options={[
                { value: "departments", label: "By department", count: total },
                { value: "org", label: "Org chart" },
              ]}
              className="w-fit max-w-full"
            />
            {mixed ? (
              <Segmented
                label="Whose agents"
                value={scope}
                onChange={(v) => setWhose(v as typeof whose)}
                options={[
                  { value: "all", label: "All", count: inBranch.length },
                  { value: "mine", label: "Mine", count: ownCount },
                  { value: "office", label: "Office", count: watchCount },
                ]}
                className="w-fit max-w-full"
              />
            ) : null}
          </div>
          {view === "org" ? <OrgChart agents={inBranch.filter((a) => a.status !== "retired")} manage={canManage} /> : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
              {companies.map(({ company, sections: depts }) => {
                const H = isAll ? "h3" : "h2";
                return (
                  <div key={company.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
                    {isAll ? (
                      <h2 className="flex min-w-0 items-center gap-2.5 text-[17px] font-semibold tracking-tight">
                        <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: company.color }} />
                        <span className="min-w-0 break-words">{company.name}</span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[12px] font-medium text-muted tabular">{depts.reduce((n, s) => n + s.agents.length, 0)}</span>
                      </h2>
                    ) : null}
                    {depts.filter((s) => s.agents.length).map((s) => (
                      <section key={s.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                        <H className="flex items-center gap-2 text-[15px] font-semibold">
                          {s.name} <span className="rounded-full bg-surface-2 px-2 text-[12px] font-medium text-muted tabular">{s.agents.length}</span>
                          <span aria-hidden className="h-px flex-1 bg-border" />
                        </H>
                        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {s.agents.map((a) => <AgentCard key={a.id} agent={a} guide={a.id === firstAgentId ? "agents.card" : undefined} />)}
                        </div>
                      </section>
                    ))}
                    {depts.some((s) => !s.agents.length) ? (
                      <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-3 text-[12.5px] text-muted">
                        Empty departments{isAll ? ` at ${company.name}` : ""}: {depts.filter((s) => !s.agents.length).map((s) => s.name).join(", ")}.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
