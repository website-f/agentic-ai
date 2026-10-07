/** Chat: pick an agent (or pick up a recent conversation); the chat itself opens full screen
 * at /chat/$agentId. */
import { ArrowRightIcon, ChatsCircleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { chatRoute } from "@/components/chat/links";
import { SessionIcon, type ChatSession } from "@/components/chat/sessions";
import { EmptyState, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, type Agent } from "@/lib/work";

/** GET /api/chat/recent: the person's own latest conversations, across their agents. */
interface RecentChat extends ChatSession {
  agent: { id: string; name: string; color: string; role: string; private: boolean; is_twin: boolean };
}

export function ChatPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: agents, isLoading } = useQuery(agentsQuery);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  // Colleagues' agents the viewer only watches can't be chatted with (the API answers 404).
  const active = useMemo(() => (agents ?? []).filter((a) => a.status !== "retired" && !a.view_only), [agents]);
  const shown = active.filter((a) => `${a.name} ${a.role} ${a.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  // One request for the latest conversations across every agent you chat with.
  const { data: recentRows = [] } = useQuery({
    queryKey: ["chat", "recent"],
    queryFn: () => api<RecentChat[]>("/api/chat/recent?limit=12"),
  });
  const recent = recentRows.slice(0, 6).map((s) => ({ s, agent: s.agent }));
  const open = (a: Pick<Agent, "id">, session?: string) => navigate(chatRoute(a.id, { from: "/chat", session }));

  if (isLoading) {
    return (
      <Page>
        <Skeleton className="h-14 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-md)]" />)}</div>
      </Page>
    );
  }
  if (!active.length) {
    return (
      <Page>
        <PageHeader title={t("Chat")} />
        <EmptyState icon={ChatsCircleIcon} title={t("No agents to talk to yet")} body={t("Create an agent, then chat with it here or from its profile.")}
          action={<Button asChild>{staffOnly(me.permissions) ? <Link to="/twin">{t("Meet your AI twin")}</Link> : <Link to="/agents/new">{t("New agent")}</Link>}</Button>} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t("Chat")} description={t("Talk to any agent directly. Actions that need approval become tasks.")} />

      {recent.length && !q ? (
        <Section title={t("Recent conversations")}>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map(({ s, agent }) => (
              <li key={s.id} className="min-w-0">
                <button type="button" onClick={() => open(agent, s.id)}
                  className="group flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-2/50">
                  <AgentAvatar name={agent.name} color={agent.color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{s.title || t("Conversation")}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                      <SessionIcon s={s} /> <span className="truncate">{agent.name} · {timeAgo(s.updated_at)}</span>
                    </span>
                  </span>
                  <ArrowRightIcon size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title={t("Agents")}
        actions={
          <label className="relative block w-full sm:w-64">
            <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find an agent")} aria-label={t("Find an agent")} type="search"
              className="h-10 w-full rounded-sm border border-border bg-surface pr-3 pl-9 text-[13.5px] transition-colors placeholder:text-muted/80 focus-visible:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden" />
          </label>
        }
      >
        <ul data-guide="chat.agents" aria-label={t("Agents")} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => {
            const working = a.current_task?.status === "running";
            return (
              <li key={a.id} className="min-w-0">
                <button type="button" onClick={() => open(a)}
                  className="group flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-3 text-left transition-colors hover:border-accent/40 hover:bg-surface-2/50">
                  <AgentAvatar name={a.name} color={a.color} size="md" working={working} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[14px] font-medium">{a.name}</span>
                      {a.status === "paused" ? <Pill className="shrink-0 px-1.5 py-0 text-[10.5px]">{t("Paused")}</Pill>
                        : working ? <Pill tone="accent" className="shrink-0 px-1.5 py-0 text-[10.5px]">{t("Working")}</Pill> : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{a.role} · {a.branch_name}</span>
                  </span>
                  <ChatsCircleIcon size={18} className={cn("shrink-0 text-muted transition-colors group-hover:text-accent")} />
                </button>
              </li>
            );
          })}
          {!shown.length ? <li className="col-span-full px-3 py-8 text-center text-[13px] text-muted">{t("No agent matches \"{q}\".", { q })}</li> : null}
        </ul>
      </Section>
    </Page>
  );
}
