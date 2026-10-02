import { EyeIcon, PaperPlaneRightIcon, PauseIcon, PlayIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { approvalsQuery, STATUS_INFO, taskQuery, workKeys } from "@/lib/work";
import type { OfficeAgent } from "@/office/types";

export const STATE_INFO: Record<OfficeAgent["state"], { label: string; tone: "accent" | "warn" | "neutral" | "info" | "danger" }> = {
  working: { label: "Working", tone: "accent" },
  waiting_approval: { label: "Waiting on you", tone: "warn" },
  in_meeting: { label: "In a meeting", tone: "accent" },
  idle: { label: "In the breakroom", tone: "info" },
  error: { label: "Stuck on an error", tone: "danger" },
  paused: { label: "Paused", tone: "neutral" },
};

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
  const events = (task.data?.events ?? []).slice(-6).reverse();

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
          {canWrite ? (
            <Button size="sm" variant="outline" loading={pause.isPending} onClick={() => pause.mutate()}>
              {agent.status === "paused" ? <><PlayIcon size={14} /> Resume</> : <><PauseIcon size={14} /> Pause</>}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" asChild><Link to="/monitor" search={{ agent: agent.id }}><EyeIcon size={14} /> Full monitor</Link></Button>
          <Button size="sm" variant="ghost" asChild><Link to="/agents/$agentId" params={{ agentId: agent.id }}>Profile</Link></Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        {mine.length ? (
          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Waiting on you</h3>
            {mine.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={canDecide} showTask={false} />)}
          </section>
        ) : null}

        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">Right now</h3>
          <AgentLive agentId={agent.id} name={agent.name} />
        </section>

        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">Current work</h3>
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
          ) : <p className="text-[13px] text-muted">No task right now.</p>}
        </section>

        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">What came out of it</h3>
          <AgentOutcome agentId={agent.id} name={agent.name} />
        </section>

        {canWrite ? (
          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Ask {agent.name}</h3>
            <form onSubmit={(e) => { e.preventDefault(); if (message.trim()) chat.mutate(); }} className="flex gap-2">
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A quick question or instruction" aria-label={`Message ${agent.name}`} />
              <Button type="submit" size="icon" aria-label="Send" loading={chat.isPending} disabled={!message.trim()}><PaperPlaneRightIcon size={16} /></Button>
            </form>
            {reply ? <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{reply}</Markdown></div> : null}
            <p className="text-[12px] text-muted">Chats are saved under Chat. Anything that needs approval belongs in a task.</p>
          </section>
        ) : null}
      </div>
    </SideSheet>
  );
}
