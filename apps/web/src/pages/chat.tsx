import { ArrowLeftIcon, ChatsCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
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
  const canWrite = me.permissions.includes("work.write");

  if (isLoading) {
    return (
      <Page className="max-w-7xl">
        <Skeleton className="h-14 w-64" />
        <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
          <Skeleton className="h-[28rem] rounded-[var(--radius-md)]" />
          <Skeleton className="h-[28rem] rounded-[var(--radius-md)] max-md:hidden" />
        </div>
      </Page>
    );
  }
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
    <aside aria-label="Agents" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="grid gap-2 border-b border-border p-2.5">
        <label className="relative block">
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent" aria-label="Find an agent" type="search"
            className="h-10 w-full rounded-sm border border-transparent bg-surface-2 pr-3 pl-9 text-[13.5px] transition-colors placeholder:text-muted/80 focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden" />
        </label>
        <p className="px-1 text-[11.5px] font-medium tracking-[0.06em] text-muted uppercase">{shown.length} {shown.length === 1 ? "agent" : "agents"}</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {shown.map((a) => {
          const on = selected?.id === a.id;
          const working = a.current_task?.status === "running";
          return (
            <li key={a.id}>
              <button onClick={() => navigate({ to: "/chat", search: { agent: a.id } })} aria-current={on || undefined}
                className={cn("flex min-h-12 w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors", on ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <AgentAvatar name={a.name} color={a.color} size="sm" working={working} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{a.name}</span>
                    {a.status === "paused" ? <Pill className="shrink-0 px-1.5 py-0 text-[10.5px]">Paused</Pill> : working ? <Pill tone="accent" className="shrink-0 px-1.5 py-0 text-[10.5px]">Working</Pill> : null}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{a.role} · {a.branch_name}</span>
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length ? <li className="px-3 py-8 text-center text-[13px] text-muted">No agent matches "{q}".</li> : null}
      </ul>
    </aside>
  );

  // Phone, one agent open: a compact bar instead of the page header, so the chat gets the screen.
  if (phone && selected) {
    return (
      <Page className="gap-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="All agents" onClick={() => navigate({ to: "/chat", search: {} })} className="-ml-2">
            <ArrowLeftIcon size={18} />
          </Button>
          <AgentAvatar name={selected.name} color={selected.color} size="sm" working={selected.current_task?.status === "running"} />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] leading-tight font-semibold">{selected.name}</h1>
            <p className="truncate text-[12px] text-muted">{selected.role} · {selected.branch_name}</p>
          </div>
        </div>
        <ChatPanel key={selected.id} agent={selected} canWrite={canWrite}
          className="h-[calc(100dvh-12.25rem-env(safe-area-inset-bottom))] min-h-[22rem]" />
      </Page>
    );
  }

  return (
    <Page className="max-w-7xl">
      <PageHeader title="Chat" description="Talk to any agent directly. Actions that need approval become tasks." />
      {phone ? (
        <div className="h-[calc(100dvh-17rem)] min-h-[20rem]">{list}</div>
      ) : (
        <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] grid-cols-[16rem_minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {list}
          {selected ? <ChatPanel key={selected.id} agent={selected} canWrite={canWrite} /> : null}
        </div>
      )}
    </Page>
  );
}
