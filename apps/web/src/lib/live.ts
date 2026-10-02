/** Live updates over server-sent events. One stream per tab, mounted by the app shell.
 * Events invalidate the queries they affect (batched), so every page stays current. */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { brainKeys } from "./brain";
import { keys } from "./queries";
import { teamKeys } from "./teams";
import { workKeys } from "./work";

export interface LiveEvent {
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

interface LiveState {
  connected: boolean;
  /** Latest live status per agent: working | waiting_approval | idle | broadcast_received */
  agentStatus: Record<string, { status: string; task: { id: string; title: string } | null }>;
  set: (patch: Partial<Omit<LiveState, "set">>) => void;
}

export const useLive = create<LiveState>((set) => ({
  connected: false,
  agentStatus: {},
  set: (patch) => set(patch),
}));

type Listener = (ev: LiveEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe to every live event as it arrives (the pixel office animates from these). */
export function onLiveEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const OFFICE = ["office"] as const;

const INVALIDATE: Record<string, readonly (readonly string[])[]> = {
  "task.created": [workKeys.tasks, keys.status],
  "task.updated": [workKeys.tasks, workKeys.agents, keys.status, OFFICE],
  "task.event": [workKeys.tasks],
  "approval.requested": [["approvals"], workKeys.tasks, keys.status, OFFICE],
  "approval.resolved": [["approvals"], workKeys.tasks, keys.status, OFFICE],
  "agent.upsert": [workKeys.agents, keys.status, OFFICE],
  "broadcast.sent": [workKeys.broadcasts],
  "broadcast.ack": [workKeys.broadcasts],
  "brain.page": [brainKeys.pages, brainKeys.graph, brainKeys.overview, ["brain", "page"]],
  "brain.dream": [brainKeys.dreams, brainKeys.overview, ["brain", "facts"]],
  "skill.proposal": [["skills"], keys.status],
  "skill.updated": [["skills"], keys.status],
  "skill.used": [["skills"]],
  "delivery.updated": [["deliveries"]],
  "meeting.updated": [teamKeys.meetings, workKeys.tasks, OFFICE],
  "meeting.turn": [teamKeys.meetings],
  "job_run.updated": [["runs"], teamKeys.schedules],
  "incident.updated": [teamKeys.incidents],
  "agent.ping": [teamKeys.pings, teamKeys.budgets],
  "file.ready": [["files"]],
  "document.updated": [["documents"]],
};

export function useLiveEvents() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let es: EventSource | null = null;
    let lastSeq = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    let flush: ReturnType<typeof setTimeout> | undefined;

    const queue = (key: readonly string[]) => {
      pending.add(JSON.stringify(key));
      clearTimeout(flush);
      flush = setTimeout(() => {
        for (const k of pending) qc.invalidateQueries({ queryKey: JSON.parse(k) });
        pending.clear();
      }, 250);
    };

    const handle = (ev: LiveEvent) => {
      lastSeq = Math.max(lastSeq, ev.seq);
      for (const fn of listeners) fn(ev);
      for (const key of INVALIDATE[ev.type] ?? []) queue(key);
      if (ev.type.startsWith("meeting.")) {
        const id = ev.data.meeting_id;
        if (typeof id === "string") queue(teamKeys.meeting(id));
      }
      if (ev.type.startsWith("task.")) {
        const id = ev.data.task_id;
        if (typeof id === "string") queue(workKeys.task(id));
      }
      if (ev.type === "agent.status") {
        const d = ev.data as { agent_id: string; status: string; task: { id: string; title: string } | null };
        useLive.getState().set({ agentStatus: { ...useLive.getState().agentStatus, [d.agent_id]: { status: d.status, task: d.task } } });
      }
      if (ev.type === "approval.requested") {
        const d = ev.data as { agent_name?: string; summary?: string; kind?: string };
        toast(`${d.agent_name ?? "An agent"} ${d.kind === "question" ? "has a question" : "needs a decision"}`, {
          description: d.summary,
          action: { label: "Review", onClick: () => navigate({ to: "/approvals" }) },
          duration: 8000,
        });
      }
    };

    const open = () => {
      es = new EventSource(`/api/events${lastSeq ? `?since=${lastSeq}` : ""}`);
      es.onopen = () => useLive.getState().set({ connected: true });
      es.onmessage = (m) => {
        try {
          handle(JSON.parse(m.data) as LiveEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        useLive.getState().set({ connected: false });
        if (es?.readyState === EventSource.CLOSED) {
          // The server refused (e.g. signed out) or the network dropped: back off, then resume
          // from the last event we saw so nothing is missed.
          clearTimeout(retry);
          retry = setTimeout(open, 5000);
        }
      };
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && (!es || es.readyState === EventSource.CLOSED)) {
        clearTimeout(retry);
        open();
      }
    };

    open();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(retry);
      clearTimeout(flush);
      es?.close();
      useLive.getState().set({ connected: false });
    };
  }, [qc, navigate]);
}
