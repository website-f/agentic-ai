import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CpuIcon,
  HandIcon,
  HeartbeatIcon,
  LightningIcon,
  RocketLaunchIcon,
  TreeStructureIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { IconTile, Page, PageHeader } from "@/components/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { errorMessage } from "@/lib/api";
import { meQuery, systemStatusQuery } from "@/lib/queries";
import { cn, greeting } from "@/lib/utils";

import { BudgetsCard, PingsCard } from "./command-center-teams";
import { staffOnly } from "@/lib/twin";

import { MeetTwinCard } from "./twin/meet-card";
import { TutorialBanner } from "./tutorial/banner";

function SystemPanel() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery(systemStatusQuery);

  let status: ReactNode = null;
  if (data) status = data.ok ? <Pill tone="ok" live>Healthy</Pill> : <Pill tone="danger" live>Needs attention</Pill>;

  return (
    <Card data-guide="home.health" className="flex flex-col overflow-hidden">
      <CardHeader
        icon={<IconTile icon={HeartbeatIcon} tone="ok" size="sm" />}
        title="System"
        description="Refreshes every 15 seconds."
        actions={status}
      />
      {isLoading ? (
        <div className="grid gap-2 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : error || !data ? (
        <p role="alert" className="m-4 rounded-sm border border-danger/30 bg-danger/8 p-3 text-[13.5px] text-danger">
          Could not load system status. {errorMessage(error)}
        </p>
      ) : (
        <>
          <ul className="grid flex-1 grid-cols-[minmax(0,1fr)] divide-y divide-border">
            {data.components.map((c) => (
              <li key={c.name} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                {c.ok ? (
                  <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-ok" aria-label="Running" />
                ) : (
                  <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-danger" aria-label="Down" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{c.name}</p>
                  <p className="truncate text-[12.5px] text-muted" title={c.detail}>
                    {c.detail}
                  </p>
                </div>
                {c.latency_ms !== null ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted tabular">{c.latency_ms} ms</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-surface-2/50 px-4 py-2 text-[12px] text-muted sm:px-5">
            <span>Version {data.version}</span>
            <span>Checked {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
          </div>
        </>
      )}
    </Card>
  );
}

function Step({ n, done, title, body, to, cta, soon }: { n: number; done: boolean; title: string; body: string; to: string; cta: string; soon?: string }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
      {done ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ok/12 text-ok">
          <CheckCircleIcon size={18} weight="fill" aria-label="Done" />
        </span>
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-[12.5px] font-semibold text-muted tabular">
          {n}
        </span>
      )}
      <div className="min-w-0 flex-1 basis-48">
        <p className={cn("text-[13.5px] font-medium", done && "text-muted")}>{title}</p>
        <p className="text-[12.5px] text-muted">{body}</p>
      </div>
      {soon ? (
        <Pill>{soon}</Pill>
      ) : done ? null : (
        <Link
          to={to}
          className="ml-10 inline-flex h-9 shrink-0 items-center gap-1 rounded-sm px-2 text-[13px] font-medium text-accent hover:bg-accent-soft sm:ml-0"
        >
          {cta} <ArrowRightIcon size={14} />
        </Link>
      )}
    </li>
  );
}

function GettingStarted({ counts }: { counts: Record<string, number> | undefined }) {
  const steps = [
    {
      done: (counts?.branches ?? 0) > 0,
      title: "Create a branch for each company",
      body: "Departments (Finance, Research, Operations and more) are added for you.",
      to: "/organization",
      cta: "Add branch",
    },
    {
      done: (counts?.members ?? 0) > 1,
      title: "Invite your team",
      body: "Give each person a role: operators run work, approvers decide on it.",
      to: "/settings/members",
      cta: "Add member",
    },
    {
      done: (counts?.providers ?? 0) > 0,
      title: "Connect AI providers",
      body: "Paste your Groq, OpenRouter, Mistral, HuggingFace, DeepSeek or OpenAI keys and test them.",
      to: "/ai-engine",
      cta: "Connect",
    },
    {
      done: (counts?.agents ?? 0) > 0,
      title: "Create your first agent",
      body: "Place it in a department, give it SOPs and permissions, then give it a task.",
      to: "/agents/new",
      cta: "New agent",
    },
  ];
  const finished = steps.filter((s) => s.done).length;
  const pct = Math.round((finished / steps.length) * 100);
  return (
    <Card data-guide="home.getting-started" className="overflow-hidden">
      <CardHeader
        icon={<IconTile icon={RocketLaunchIcon} size="sm" />}
        title="Getting started"
        description="The order that gets your first agent working."
        actions={counts ? <Pill tone={finished === steps.length ? "ok" : "accent"}>{finished} of {steps.length} done</Pill> : null}
      />
      <div className="px-4 pt-3 sm:px-5" aria-hidden>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
        {steps.map((s, i) => (
          <Step key={s.to} n={i + 1} {...s} />
        ))}
      </ol>
    </Card>
  );
}

export function CommandCenterPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data } = useQuery(systemStatusQuery);
  const navigate = useNavigate();
  const counts = data?.counts;
  const firstName = me.user.name.split(" ")[0];
  const waiting = counts?.approvals_pending ?? 0;
  const review = counts?.tasks_review ?? 0;
  const running = counts?.tasks_running ?? 0;

  let statusPill: ReactNode = <Pill>Checking</Pill>;
  if (data) {
    statusPill = data.ok ? (
      <Pill tone="ok" live>All systems running</Pill>
    ) : (
      <Pill tone="danger" live>Needs attention</Pill>
    );
  }

  const value = (n: number | undefined) => (counts ? n ?? 0 : <Skeleton className="h-[26px] w-10" />);

  return (
    <Page>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${me.workspace.name}. Here is how the office is doing.`}
        actions={<div className="flex items-center">{statusPill}</div>}
      />

      <TutorialBanner />

      {me.permissions.includes("agents.own") ? <MeetTwinCard /> : null}

      <StatGrid>
        <Stat
          label="Agents"
          value={value(counts?.agents)}
          hint="On staff"
          icon={UsersThreeIcon}
          tone="accent"
          onClick={() => navigate({ to: "/agents" })}
        />
        <Stat
          label="Working now"
          value={value(counts?.tasks_running)}
          hint={running ? "Tasks in progress" : "Nobody busy right now"}
          icon={LightningIcon}
          tone="info"
          onClick={() => navigate({ to: "/tasks" })}
        />
        <Stat
          label="Waiting on you"
          value={value(counts?.approvals_pending)}
          hint={waiting ? "Decisions to make" : "Nothing to decide"}
          icon={HandIcon}
          tone={waiting ? "warn" : "neutral"}
          onClick={() => navigate({ to: "/approvals" })}
        />
        <Stat
          label="To review"
          value={value(counts?.tasks_review)}
          hint={review ? "Finished work to check" : "All checked"}
          icon={ClipboardTextIcon}
          tone="violet"
          onClick={() => navigate({ to: "/tasks" })}
        />
      </StatGrid>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 empty:hidden lg:grid-cols-2 lg:[&>*:only-child]:col-span-2">
        <PingsCard canWrite={me.permissions.includes("work.write")} />
        <BudgetsCard />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {staffOnly(me.permissions) ? null : <GettingStarted counts={counts} />}
        <SystemPanel />
      </div>

      <nav data-guide="home.shortcuts" aria-label="Shortcuts" className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        {[
          { to: "/organization", icon: TreeStructureIcon, label: "Organization", body: "Branches and departments", tone: "info" as const },
          { to: "/settings/members", icon: UserPlusIcon, label: "Members", body: "People and their roles", tone: "violet" as const },
          { to: "/agents", icon: UsersThreeIcon, label: "Agents", body: `${counts?.agents ?? 0} on staff`, tone: "accent" as const },
        ].map(({ to, icon, label, body, tone }) => (
          <Link
            key={to}
            to={to}
            className="group flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
          >
            <IconTile icon={icon} tone={tone} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">{label}</span>
              <span className="block truncate text-[12.5px] text-muted">{body}</span>
            </span>
            <ArrowRightIcon size={15} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        ))}
      </nav>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <CpuIcon size={14} className="shrink-0" /> Temporal UI for workflow debugging runs at localhost:8502.
      </p>
    </Page>
  );
}
