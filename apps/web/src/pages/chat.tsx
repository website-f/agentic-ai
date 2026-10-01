import { ChatsCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { meQuery } from "@/lib/queries";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

import { ChatPanel } from "./agents/chat-panel";

export function ChatPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: agents, isLoading } = useQuery(agentsQuery);
  const search = useSearch({ strict: false }) as { agent?: string };
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [q, setQ] = useState("");
  const active = (agents ?? []).filter((a) => a.status !== "retired");
  const shown = active.filter((a) => `${a.name} ${a.role} ${a.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const selected = active.find((a) => a.id === search.agent) ?? (phone ? undefined : active[0]);

  if (isLoading) return <Page><Skeleton className="h-96 rounded-[var(--radius-md)]" /></Page>;
  if (!active.length) {
    return (
      <Page>
        <PageHeader title="Chat" />
        <EmptyState icon={ChatsCircleIcon} title="No agents to talk to yet" body="Create an agent, then chat with it here or from its profile."
          action={<Button asChild><Link to="/agents/new">New agent</Link></Button>} />
      </Page>
    );
  }

  const list = (
    <aside className="flex min-h-0 flex-col rounded-[var(--radius-md)] border border-border bg-surface">
      <label className="relative border-b border-border p-2">
        <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent" aria-label="Find an agent"
          className="h-9 w-full rounded-sm bg-surface-2 pr-3 pl-8 text-[13px] focus-visible:outline-none" />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.map((a) => (
          <li key={a.id}>
            <button onClick={() => navigate({ to: "/chat", search: { agent: a.id } })}
              className={cn("flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left", selected?.id === a.id ? "bg-accent-soft" : "hover:bg-surface-2")}>
              <AgentAvatar name={a.name} color={a.color} size="sm" working={a.current_task?.status === "running"} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                <span className="block truncate text-[12px] text-muted">{a.role} · {a.branch_name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );

  return (
    <Page className="max-w-7xl">
      <PageHeader title="Chat" description="Talk to any agent directly. Actions that need approval become tasks." />
      {phone ? (
        selected ? (
          <div className="grid gap-2">
            <button onClick={() => navigate({ to: "/chat", search: {} })} className="w-fit text-[13px] text-accent">All agents</button>
            <ChatPanel key={selected.id} agent={selected} canWrite={me.permissions.includes("work.write")} className="h-[calc(100dvh-15rem)]" />
          </div>
        ) : <div className="h-[calc(100dvh-14rem)]">{list}</div>
      ) : (
        <div className="grid h-[calc(100dvh-13rem)] min-h-[28rem] grid-cols-[17rem_minmax(0,1fr)] gap-4">
          {list}
          {selected ? <ChatPanel key={selected.id} agent={selected} canWrite={me.permissions.includes("work.write")} /> : null}
        </div>
      )}
    </Page>
  );
}
