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
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useCompanies } from "@/lib/company";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";
import { agentsQuery, type Agent } from "@/lib/work";

import { OrgChart } from "./org-chart";

export function agentState(a: Agent, live?: { status: string } | undefined): { label: string; tone: "accent" | "warn" | "neutral" | "info" } {
  if (a.status === "paused") return { label: msg("Paused"), tone: "neutral" };
  // A watched colleague's agent waits on its own manager, not on the viewer.
  if (a.current_task?.status === "blocked" || live?.status === "waiting_approval") return { label: a.view_only ? msg("Waiting on approval") : msg("Waiting on you"), tone: "warn" };
  if (live?.status === "in_meeting") return { label: msg("In a meeting"), tone: "accent" };
  if (a.current_task?.status === "running" || live?.status === "working") return { label: msg("Working"), tone: "accent" };
  return { label: msg("Available"), tone: "info" };
}

function AgentCard({ agent, guide }: { agent: Agent; guide?: string }) {
  const t = useT();
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
        <Pill tone={state.tone} className="shrink-0">{t(state.label)}</Pill>
      </div>
      <p className="line-clamp-2 rounded-sm bg-surface-2/60 px-2.5 py-1.5 text-[12.5px] text-muted">
        {agent.current_task ? <>{t("On:")} <span className="text-fg">{agent.current_task.title}</span></> : agent.open_tasks ? (agent.open_tasks === 1 ? t("1 open task") : t("{n} open tasks", { n: agent.open_tasks })) : t("No open tasks")}
      </p>
      <div className="mt-auto flex flex-wrap gap-1.5 text-[11.5px]">
        <Pill className="font-mono">{agent.model_group}</Pill>
        <AgentAccessPills agent={agent} />
        {agent.clone_of ? <Pill tone="info">{t("Helper")}</Pill> : null}
        {agent.owner_name && !agent.is_twin ? <Pill tone="info">{t("{name}'s agent", { name: agent.owner_name })}</Pill> : null}
        {agent.autonomy === "auto" ? <Pill tone="accent">{t("Auto")}</Pill> : null}
        {agent.role_kind === "orchestrator" ? <Pill tone="accent">{t("Leads")}</Pill> : null}
        {agent.budget_daily_tokens || agent.budget_monthly_usd ? <Pill>{t("Budget")}</Pill> : null}
        {agent.sop_ids.length ? <Pill>{t("{n} SOPs", { n: agent.sop_ids.length })}</Pill> : null}
      </div>
    </Link>
  );
}

export function AgentsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  // P18: staff have one agent, their AI twin; only managers add more.
  const staff = staffOnly(me.permissions);
  const twinHint = t("Staff have one AI twin. Ask your manager for more agents.");
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
      if (loose.length) out.push({ id: `none-${b.id}`, name: t("No department"), company: b, agents: loose });
      return out;
    });
  }, [inBranch, shown, scope, t]);
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
        title={t("Agents")}
        description={!branch ? t("Create a company first, then add agents to its departments.")
          : `${isAll ? t("The staff of all {n} companies, by company and department.", { n: shown.length }) : t("The staff of {name}, by department.", { name: branch.name })} ${t("Switch company with the picker at the top.")}${staff ? ` ${twinHint}` : ""}`}
        actions={staff ? (
          <Button asChild variant="outline" title={twinHint}>
            <Link to="/twin">
              <UserFocusIcon size={16} weight="bold" /> {t("My twin")}
            </Link>
          </Button>
        ) : canManage && branch ? (
          <Button asChild data-guide="agents.new">
            <Link to="/agents/new">
              <PlusIcon size={16} weight="bold" /> {t("New agent")}
            </Link>
          </Button>
        ) : null}
      />
      {isLoading || loadingCompanies ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">{t("Could not load agents.")} {errorMessage(error)}</div>
      ) : !branch ? (
        <EmptyState icon={UsersThreeIcon} title={t("No branches yet")} body={t("Agents belong to a company. Create a branch in Organization first.")} action={<Button asChild variant="outline"><Link to="/organization">{t("Open Organization")}</Link></Button>} />
      ) : total === 0 ? (
        <EmptyState
          icon={UsersThreeIcon}
          title={isAll ? t("No agents yet") : t("No agents at {name} yet", { name: branch.name })}
          body={t("Start from a template like Accountant or Researcher, place it in a department, and give it your SOPs.")}
          action={staff ? <Button asChild><Link to="/twin"><UserFocusIcon size={16} weight="bold" /> {t("Meet your AI twin")}</Link></Button> : canManage ? <Button asChild><Link to="/agents/new"><PlusIcon size={16} weight="bold" /> {t("Create first agent")}</Link></Button> : undefined}
        />
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Agents")} value={total} hint={counts.watching ? t("{n} you can only watch", { n: counts.watching }) : isAll ? (companies.length === 1 ? t("In 1 company") : t("In {n} companies", { n: companies.length })) : t("In {n} departments", { n: sections.filter((s) => s.agents.length).length })} icon={UsersThreeIcon} tone="accent" />
            <Stat label={t("Working now")} value={counts.working} hint={t("On a task or in a meeting")} icon={LightningIcon} tone="info" />
            <Stat label={t("Waiting on you")} value={counts.waiting} hint={counts.waiting ? t("Open Approvals to decide") : t("Nothing to decide")} icon={HandIcon} tone={counts.waiting ? "warn" : "neutral"} />
            <Stat label={t("Paused")} value={counts.paused} hint={t("Not taking work")} icon={PauseCircleIcon} tone="neutral" />
          </StatGrid>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented
              guide="agents.org"
              label={t("Show agents by")}
              value={view === "org" ? "org" : "departments"}
              onChange={(v) => navigate({ to: "/agents", search: { view: v === "org" ? "org" : undefined }, replace: true })}
              options={[
                { value: "departments", label: t("By department"), count: total },
                { value: "org", label: t("Org chart") },
              ]}
              className="w-fit max-w-full"
            />
            {mixed ? (
              <Segmented
                label={t("Whose agents")}
                value={scope}
                onChange={(v) => setWhose(v as typeof whose)}
                options={[
                  { value: "all", label: t("All"), count: inBranch.length },
                  { value: "mine", label: t("Mine"), count: ownCount },
                  { value: "office", label: t("Office"), count: watchCount },
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
                        {isAll ? t("Empty departments at {company}: {list}.", { company: company.name, list: depts.filter((s) => !s.agents.length).map((s) => s.name).join(", ") }) : t("Empty departments: {list}.", { list: depts.filter((s) => !s.agents.length).map((s) => s.name).join(", ") })}
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
