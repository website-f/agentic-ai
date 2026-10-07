import { BrowserIcon, ChatsCircleIcon, EyeIcon, KanbanIcon, PaperPlaneRightIcon, PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAccessPills } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { chatRoute } from "@/components/chat/links";
import { AgentLive, AgentOutcome } from "@/components/agent-live";
import { ApprovalCard } from "@/components/approval-card";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { openTaskComposer } from "@/components/task-composer/store";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { agentQuery, agentsQuery, approvalsQuery, STATUS_INFO, taskQuery, workKeys } from "@/lib/work";
import type { OfficeAgent } from "@/office/types";

export const STATE_INFO: Record<OfficeAgent["state"], { label: string; tone: "accent" | "warn" | "neutral" | "info" | "danger" }> = {
  working: { label: msg("Working"), tone: "accent" },
  waiting_approval: { label: msg("Waiting on you"), tone: "warn" },
  in_meeting: { label: msg("In a meeting"), tone: "accent" },
  idle: { label: msg("In the breakroom"), tone: "info" },
  error: { label: msg("Stuck on an error"), tone: "danger" },
  paused: { label: msg("Paused"), tone: "neutral" },
};

type Tab = "monitor" | "work" | "chat";
const TABS: { id: Tab; label: string; icon: typeof EyeIcon }[] = [
  { id: "monitor", label: msg("Monitor"), icon: EyeIcon },
  { id: "work", label: msg("Work"), icon: KanbanIcon },
  { id: "chat", label: msg("Chat"), icon: ChatsCircleIcon },
];

/** Puts link elements into a translated sentence at its {name} slots, so the word order stays Malay. */
function withLinks(text: string, links: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    return key && key in links ? <Fragment key={i}>{links[key]}</Fragment> : part;
  });
}

export function AgentSheet({ agent, departmentName, canWrite: mayWrite, canDecide, onClose }: {
  agent: OfficeAgent;
  departmentName: string | null;
  canWrite: boolean;
  canDecide: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: approvals = [] } = useQuery(approvalsQuery("pending"));
  const mine = approvals.filter((a) => a.agent_id === agent.id);
  const full = useQuery(agentQuery(agent.id));
  const { data: roster } = useQuery(agentsQuery);
  // Staff watch colleagues' agents (view_only, from the office snapshot): no chat, tasks,
  // browsing or pausing, only the live monitor.
  const known = full.data ?? roster?.find((a) => a.id === agent.id);
  const viewOnly = agent.view_only ?? !!known?.view_only;
  const decided = agent.view_only !== undefined || !!known;
  const canWrite = mayWrite && decided && !viewOnly;
  const task = useQuery({ ...taskQuery(agent.task?.id ?? ""), enabled: !!agent.task && decided && !viewOnly });
  const tabs = viewOnly ? TABS.filter((x) => x.id !== "chat") : TABS;
  const [picked, setTab] = useState<Tab>("monitor");
  const tab: Tab = tabs.some((x) => x.id === picked) ? picked : "monitor";
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const chat = useMutation({
    mutationFn: () => api<{ reply: string }>(`/api/agents/${agent.id}/chat`, "POST", { message }),
    onSuccess: (r) => { setReply(r.reply); setMessage(""); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pause = useMutation({
    mutationFn: () => api(`/api/agents/${agent.id}`, "PATCH", { status: agent.status === "paused" ? "active" : "paused" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office"] });
      qc.invalidateQueries({ queryKey: workKeys.agents });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const state = viewOnly && agent.state === "waiting_approval" ? { label: msg("Waiting on approval"), tone: "warn" as const } : STATE_INFO[agent.state];
  const events = (task.data?.events ?? []).slice(-8).reverse();

  return (
    <SideSheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-3">
          <AgentAvatar name={agent.name} color={agent.color} size="sm" working={agent.state === "working"} />
          {agent.name}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <span>{agent.role}{departmentName ? ` · ${departmentName}` : ""}</span>
          <Pill tone={state.tone}>{t(state.label)}</Pill>
          {known ? <AgentAccessPills agent={known} /> : null}
        </span>
      }
      actions={
        <>
          {canWrite ? <Button size="sm" onClick={() => openTaskComposer({ agentId: agent.id })}><PlusIcon size={14} weight="bold" /> {t("Give a task")}</Button> : null}
          {canWrite && full.data ? <Button size="sm" variant="outline" onClick={() => openTaskComposer({ agentId: agent.id, kind: "browse" })}><BrowserIcon size={14} /> {t("Browse for me")}</Button> : null}
          {canWrite ? (
            <Button size="sm" variant="outline" loading={pause.isPending} onClick={() => pause.mutate()}>
              {agent.status === "paused" ? <><PlayIcon size={14} /> {t("Resume")}</> : <><PauseIcon size={14} /> {t("Pause")}</>}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild><Link to="/agents/$agentId" params={{ agentId: agent.id }}>{t("Profile")}</Link></Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {/* Anything the agent needs decided is pinned here, above the tabs, so it is never buried. */}
        {mine.length ? (
          <section className="grid gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 p-3">
            <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-warn">
              {t("Waiting on you")} <span className="grid size-[18px] place-items-center rounded-full bg-warn text-[11px] font-bold text-white">{mine.length}</span>
            </h3>
            {mine.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={canDecide} showTask={false} />)}
          </section>
        ) : null}

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <Tabs.List aria-label={t("{name} panel", { name: agent.name })} className="mb-4 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((x) => (
              <Tabs.Trigger key={x.id} value={x.id}
                className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
                <x.icon size={15} weight="duotone" /> {t(x.label)}
                {x.id === "work" && agent.task ? <span className="size-1.5 rounded-full bg-accent" /> : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* Monitor: live screen (browser / what it is doing) + step by step. */}
          <Tabs.Content value="monitor" className="outline-none">
            <AgentLive agentId={agent.id} name={agent.name} viewOnly={viewOnly} />
          </Tabs.Content>

          {/* Work: the task it is on now, and everything it has produced. */}
          <Tabs.Content value="work" className="grid grid-cols-[minmax(0,1fr)] gap-5 outline-none">
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold text-muted">{t("Working on now")}</h3>
              {agent.task ? (
                <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {viewOnly ? (
                      <span className="text-[13.5px] font-medium break-words">{agent.task.title}</span>
                    ) : (
                      <Link to="/tasks" search={{ task: agent.task.id }} className="text-[13.5px] font-medium text-accent hover:underline">{agent.task.title}</Link>
                    )}
                    <Pill tone={STATUS_INFO[agent.task.status as keyof typeof STATUS_INFO]?.tone ?? "neutral"}>{t(STATUS_INFO[agent.task.status as keyof typeof STATUS_INFO]?.label ?? agent.task.status)}</Pill>
                  </div>
                  {events.length ? (
                    <ol className="grid gap-1.5 border-t border-border pt-2">
                      {events.map((e) => (
                        <li key={e.id} className="text-[12.5px]">
                          <span className="text-muted">{e.text}</span> <span className="text-[11.5px] text-muted/80">· {timeAgo(e.ts).toLowerCase()}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted">
                  {t("No task right now.")}{canWrite ? ` ${t("Give it one, or ask it to browse for you.")}` : ""}
                </p>
              )}
            </section>
            {viewOnly ? (
              <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/60 px-3 py-2.5 text-[12.5px] text-muted">
                <EyeIcon size={15} weight="duotone" className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">{t("You're watching {name}. Its results go to {owner}.", { name: agent.name, owner: known?.owner_name ?? t("its manager") })}</span>
              </p>
            ) : (
              <section className="grid gap-2">
                <h3 className="text-[13px] font-semibold text-muted">{t("What it produced")}</h3>
                <AgentOutcome agentId={agent.id} name={agent.name} />
              </section>
            )}
          </Tabs.Content>

          {/* Chat: a quick question or instruction, saved under Chat (never for a watched agent). */}
          {viewOnly ? null : <Tabs.Content value="chat" className="outline-none">
            {canWrite ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                <Button asChild className="w-full sm:w-fit">
                  <Link {...chatRoute(agent.id, { from: `/office?agent=${encodeURIComponent(agent.id)}` })}>
                    <ChatsCircleIcon size={16} weight="fill" /> {t("Open full chat")}
                  </Link>
                </Button>
                <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) chat.mutate(); }} className="flex gap-2">
                  <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("A quick question for {name}", { name: agent.name })} aria-label={t("Message {name}", { name: agent.name })} />
                  <Button type="submit" size="icon" aria-label={t("Send")} loading={chat.isPending} disabled={!message.trim()}><PaperPlaneRightIcon size={16} /></Button>
                </form>
                {reply ? <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{reply}</Markdown></div> : null}
                <p className="text-[12px] text-muted">{withLinks(t("A quick chat. For work that needs tools or your approval, use {task} or Browse for me. The full conversation is on the {chat}."), {
                  task: <button type="button" onClick={() => openTaskComposer({ agentId: agent.id, brief: message })} className="text-accent hover:underline">{t("a task")}</button>,
                  chat: <Link {...chatRoute(agent.id, { from: `/office?agent=${encodeURIComponent(agent.id)}` })} className="text-accent hover:underline">{t("Chat page")}</Link>,
                })}</p>
              </div>
            ) : <p className="text-[13px] text-muted">{t("You do not have permission to message agents.")}</p>}
          </Tabs.Content>}
        </Tabs.Root>
      </div>
    </SideSheet>
  );
}
