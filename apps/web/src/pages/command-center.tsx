import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  CpuIcon,
  TreeStructureIcon,
  UserPlusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Page, PageHeader, Section } from "@/components/page";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { meQuery, systemStatusQuery } from "@/lib/queries";
import { cn, greeting } from "@/lib/utils";

function SystemPanel() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery(systemStatusQuery);

  if (isLoading) {
    return (
      <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
        Could not load system status. {errorMessage(error)}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <ul className="divide-y divide-border">
        {data.components.map((c) => (
          <li key={c.name} className="flex items-center gap-3 px-4 py-3">
            {c.ok ? (
              <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-ok" />
            ) : (
              <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{c.name}</p>
              <p className="truncate text-[12.5px] text-muted" title={c.detail}>
                {c.detail}
              </p>
            </div>
            {c.latency_ms !== null ? (
              <span className="font-mono text-[12px] text-muted tabular">{c.latency_ms} ms</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border bg-surface-2/50 px-4 py-2 text-[12px] text-muted">
        <span>Version {data.version}</span>
        <span>Checked {new Date(dataUpdatedAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: number | undefined; to: string }) {
  return (
    <Link to={to} className="group rounded-[var(--radius-md)] px-1 py-1">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-0.5 text-[26px] leading-none font-semibold tabular group-hover:text-accent">
        {value ?? "-"}
      </p>
    </Link>
  );
}

function Step({ done, title, body, to, cta, soon }: { done: boolean; title: string; body: string; to: string; cta: string; soon?: string }) {
  return (
    <li className="flex items-start gap-3 py-3.5">
      {done ? (
        <CheckCircleIcon size={20} weight="fill" className="mt-px shrink-0 text-ok" />
      ) : (
        <CircleIcon size={20} className="mt-px shrink-0 text-border" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13.5px] font-medium", done && "text-muted line-through decoration-border")}>{title}</p>
        <p className="text-[12.5px] text-muted">{body}</p>
      </div>
      {soon ? (
        <Pill>{soon}</Pill>
      ) : done ? null : (
        <Link to={to} className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent hover:underline">
          {cta} <ArrowRightIcon size={14} />
        </Link>
      )}
    </li>
  );
}

export function CommandCenterPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data } = useQuery(systemStatusQuery);
  const counts = data?.counts;
  const firstName = me.user.name.split(" ")[0];

  let statusPill: ReactNode = <Pill>Checking</Pill>;
  if (data) {
    statusPill = data.ok ? (
      <Pill tone="ok" live>All systems running</Pill>
    ) : (
      <Pill tone="danger" live>Needs attention</Pill>
    );
  }

  return (
    <Page>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${me.workspace.name}. Here is how the office is doing.`}
        actions={statusPill}
      />

      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4 sm:grid-cols-4">
        <Stat label="Agents" value={counts?.agents} to="/agents" />
        <Stat label="Working now" value={counts?.tasks_running} to="/tasks" />
        <Stat label="Waiting on you" value={counts?.approvals_pending} to="/approvals" />
        <Stat label="To review" value={counts?.tasks_review} to="/tasks" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Section title="Getting started" description="The order that gets your first agent working.">
          <ol className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface px-4">
            <Step
              done={(counts?.branches ?? 0) > 0}
              title="Create a branch for each company"
              body="Departments (Finance, Research, Operations and more) are added for you."
              to="/organization"
              cta="Add branch"
            />
            <Step
              done={(counts?.members ?? 0) > 1}
              title="Invite your team"
              body="Give each person a role: operators run work, approvers decide on it."
              to="/settings/members"
              cta="Add member"
            />
            <Step
              done={(counts?.providers ?? 0) > 0}
              title="Connect AI providers"
              body="Paste your Groq, OpenRouter, Mistral, HuggingFace, DeepSeek or OpenAI keys and test them."
              to="/ai-engine"
              cta="Connect"
            />
            <Step
              done={(counts?.agents ?? 0) > 0}
              title="Create your first agent"
              body="Place it in a department, give it SOPs and permissions, then give it a task."
              to="/agents/new"
              cta="New agent"
            />
          </ol>
        </Section>

        <Section title="System" description="Refreshes every 15 seconds.">
          <SystemPanel />
        </Section>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { to: "/organization", icon: TreeStructureIcon, label: "Organization", body: "Branches and departments" },
          { to: "/settings/members", icon: UserPlusIcon, label: "Members", body: "People and their roles" },
          { to: "/agents", icon: UsersThreeIcon, label: "Agents", body: `${counts?.agents ?? 0} on staff` },
        ].map(({ to, icon: IconCmp, label, body }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
          >
            <IconCmp size={20} className="text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">{label}</span>
              <span className="block text-[12.5px] text-muted">{body}</span>
            </span>
            <ArrowRightIcon size={15} className="text-muted" />
          </Link>
        ))}
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-[12px] text-muted">
        <CpuIcon size={14} /> Temporal UI for workflow debugging runs at localhost:8502.
      </p>
    </Page>
  );
}
