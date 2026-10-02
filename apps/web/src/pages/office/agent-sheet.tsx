import { BrowserIcon, ChatsCircleIcon, EyeIcon, KanbanIcon, PaperPlaneRightIcon, PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { AgentLive, AgentOutcome } from "@/components/agent-live";
import { ApprovalCard } from "@/components/approval-card";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { WebTaskDialog } from "@/components/web-task-dialog";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { agentQuery, approvalsQuery, STATUS_INFO, taskQuery, workKeys } from "@/lib/work";
import type { OfficeAgent } from "@/office/types";

export const STATE_INFO: Record<OfficeAgent["state"], { label: string; tone: "accent" | "warn" | "neutral" | "info" | "danger" }> = {
  working: { label: "Working", tone: "accent" },
  waiting_approval: { label: "Waiting on you", tone: "warn" },
  in_meeting: { label: "In a meeting", tone: "accent" },
  idle: { label: "In the breakroom", tone: "info" },
  error: { label: "Stuck on an error", tone: "danger" },
  paused: { label: "Paused", tone: "neutral" },
};

type Tab = "monitor" | "work" | "chat";
const TABS: { id: Tab; label: string; icon: typeof EyeIcon }[] = [
  { id: "monitor", label: "Monitor", icon: EyeIcon },
  { id: "work", label: "Work", icon: KanbanIcon },
  { id: "chat", label: "Chat", icon: ChatsCircleIcon },
];

export function AgentSheet({ agent, departmentName, canWrite, canDecide, onClose }: {
  agent: OfficeAgent;
  departmentName: string | null;
  canWrite: boolean;
  canDecide: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: approvals = [] } = useQuery(approvalsQuery("pending"));
  const mine = approvals.filter((a) => a.agent_id === agent.id);
  const task = useQuery({ ...taskQuery(agent.task?.id ?? ""), enabled: !!agent.task });
  const full = useQuery(agentQuery(agent.id));
  const [tab, setTab] = useState<Tab>("monitor");
  const [browsing, setBrowsing] = useState(false);
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
  const state = STATE_INFO[agent.state];
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
          <Pill tone={state.tone}>{state.label}</Pill>
        </span>
      }
      actions={
        <>
          {canWrite ? <Button size="sm" asChild><Link to="/tasks" search={{ new: 1, agent: agent.id }}><PlusIcon size={14} weight="bold" /> Give a task</Link></Button> : null}
          {canWrite && full.data ? <Button size="sm" variant="outline" onClick={() => setBrowsing(true)}><BrowserIcon size={14} /> Browse for me</Button> : null}
          {canWrite ? (
            <Button size="sm" variant="outline" loading={pause.isPending} onClick={() => pause.mutate()}>
              {agent.status === "paused" ? <><PlayIcon size={14} /> Resume</> : <><PauseIcon size={14} /> Pause</>}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild><Link to="/agents/$agentId" params={{ agentId: agent.id }}>Profile</Link></Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {/* Anything the agent needs decided is pinned here, above the tabs, so it is never buried. */}
        {mine.length ? (
          <section className="grid gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 p-3">
            <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-warn">
              Waiting on you <span className="grid size-[18px] place-items-center rounded-full bg-warn text-[11px] font-bold text-white">{mine.length}</span>
            </h3>
            {mine.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={canDecide} showTask={false} />)}
          </section>
        ) : null}

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <Tabs.List aria-label={`${agent.name} panel`} className="mb-4 flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <Tabs.Trigger key={t.id} value={t.id}
                className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
                <t.icon size={15} weight="duotone" /> {t.label}
                {t.id === "work" && agent.task ? <span className="size-1.5 rounded-full bg-accent" /> : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* Monitor: live screen (browser / what it is doing) + step by step. */}
          <Tabs.Content value="monitor" className="outline-none">
            <AgentLive agentId={agent.id} name={agent.name} />
          </Tabs.Content>

          {/* Work: the task it is on now, and everything it has produced. */}
          <Tabs.Content value="work" className="grid grid-cols-[minmax(0,1fr)] gap-5 outline-none">
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold text-muted">Working on now</h3>
              {agent.task ? (
                <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/tasks" search={{ task: agent.task.id }} className="text-[13.5px] font-medium text-accent hover:underline">{agent.task.title}</Link>
                    <Pill tone={STATUS_INFO[agent.task.status as keyof typeof STATUS_INFO]?.tone ?? "neutral"}>{STATUS_INFO[agent.task.status as keyof typeof STATUS_INFO]?.label ?? agent.task.status}</Pill>
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
                  No task right now.{canWrite ? " Give it one, or ask it to browse for you." : ""}
                </p>
              )}
            </section>
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold text-muted">What it produced</h3>
              <AgentOutcome agentId={agent.id} name={agent.name} />
            </section>
          </Tabs.Content>

          {/* Chat: a quick question or instruction, saved under Chat. */}
          <Tabs.Content value="chat" className="outline-none">
            {canWrite ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) chat.mutate(); }} className="flex gap-2">
                  <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`A quick question for ${agent.name}`} aria-label={`Message ${agent.name}`} />
                  <Button type="submit" size="icon" aria-label="Send" loading={chat.isPending} disabled={!message.trim()}><PaperPlaneRightIcon size={16} /></Button>
                </form>
                {reply ? <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{reply}</Markdown></div> : null}
                <p className="text-[12px] text-muted">A quick chat. For work that needs tools or your approval, use <Link to="/tasks" search={{ new: 1, agent: agent.id }} className="text-accent hover:underline">a task</Link> or Browse for me. The full conversation is on the <Link to="/chat" search={{ agent: agent.id }} className="text-accent hover:underline">Chat page</Link>.</p>
              </div>
            ) : <p className="text-[13px] text-muted">You do not have permission to message agents.</p>}
          </Tabs.Content>
        </Tabs.Root>
      </div>
      {browsing && full.data ? <WebTaskDialog agent={full.data} open onOpenChange={setBrowsing} /> : null}
    </SideSheet>
  );
}
