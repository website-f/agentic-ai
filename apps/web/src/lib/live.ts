/** Live updates over server-sent events. One stream per tab, mounted by the app shell.
 * Events invalidate the queries they affect (batched), so every page stays current. */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { t } from "@/i18n";

import { brainKeys } from "./brain";
import { deviceKeys } from "./devices";
import { learningKeys } from "./learning";
import { objectiveKeys } from "./objectives";
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

/** Drop events already handled. The server numbers every event (seq > 0); a reconnect can replay
 * from an older point (the URL's ?since= wins over Last-Event-ID), and a replayed approval must
 * not toast twice. An event without a number is always let through. */
export function isNewEvent(ev: Pick<LiveEvent, "seq">, lastSeq: number): boolean {
  return typeof ev.seq !== "number" || !(ev.seq > 0) || ev.seq > lastSeq;
}

/** The stream URL, resuming after the last event seen. */
export function streamUrl(lastSeq: number): string {
  return `/api/events${lastSeq ? `?since=${lastSeq}` : ""}`;
}

let stopStream: (() => void) | null = null;

/** Sign-out: close this tab's stream and forget everything live that belonged to the person. */
export function resetLive(): void {
  stopStream?.();
  stopStream = null;
  useLive.setState({ connected: false, agentStatus: {} });
}

type Listener = (ev: LiveEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe to every live event as it arrives (the pixel office animates from these). */
export function onLiveEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const OFFICE = ["office"] as const;

const INVALIDATE: Record<string, readonly (readonly string[])[]> = {
  "task.created": [workKeys.tasks, keys.status, objectiveKeys.all],
  "task.updated": [workKeys.tasks, workKeys.agents, keys.status, OFFICE, objectiveKeys.all],
  "task.event": [workKeys.tasks],
  "task.deleted": [workKeys.tasks, keys.status, objectiveKeys.all],
  "approval.requested": [["approvals"], workKeys.tasks, keys.status, OFFICE],
  "approval.resolved": [["approvals"], workKeys.tasks, keys.status, OFFICE],
  "agent.upsert": [workKeys.agents, keys.status, OFFICE],
  "broadcast.sent": [workKeys.broadcasts],
  "broadcast.ack": [workKeys.broadcasts],
  "brain.page": [brainKeys.pages, brainKeys.graph, brainKeys.overview, ["brain", "page"]],
  "brain.dream": [brainKeys.dreams, brainKeys.overview, ["brain", "facts"]],
  "skill.proposal": [["skills"], keys.status, learningKeys.all],
  "skill.updated": [["skills"], keys.status, learningKeys.all],
  "skill.used": [["skills"]],
  "delivery.updated": [["deliveries"]],
  "meeting.updated": [teamKeys.meetings, workKeys.tasks, OFFICE],
  "meeting.turn": [teamKeys.meetings],
  "job_run.updated": [["runs"], teamKeys.schedules],
  "incident.updated": [teamKeys.incidents],
  "agent.ping": [teamKeys.pings, teamKeys.budgets],
  "file.ready": [["files"]],
  // P24 company documents: an upload moved on (unpacked, read, sorted, ready). Its files,
  // the folder tree and the upload report all refresh.
  "intake.updated": [["intake"], ["files"]],
  "document.updated": [["documents"]],
  "workflow_run.updated": [["workflow-runs"]],
  "objective.updated": [objectiveKeys.all, workKeys.tasks],
  "objective.budget": [objectiveKeys.all, ["approvals"]],
  // P31: a PC came online or went offline (device.status), or was linked, renamed, paused,
  // given folders or unlinked (device.updated). A claimed link code's poll shares the key.
  "device.status": [deviceKeys.all],
  "device.updated": [deviceKeys.all],
};

export function useLiveEvents() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let es: EventSource | null = null;
    let lastSeq = 0;
    /** lastSeq when the current stream opened: its URL resumes from there. */
    let openedAt = 0;
    let stopped = false;
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
      if (!isNewEvent(ev, lastSeq)) return; // replayed after a reconnect: already handled
      if (typeof ev.seq === "number" && ev.seq > 0) lastSeq = ev.seq;
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
        const name = d.agent_name;
        const title = d.kind === "question"
          ? (name ? t("{name} has a question", { name }) : t("An agent has a question"))
          : (name ? t("{name} needs a decision", { name }) : t("An agent needs a decision"));
        toast(title, {
          description: d.summary,
          action: { label: t("Review"), onClick: () => navigate({ to: "/approvals" }) },
          duration: 8000,
        });
      }
    };

    const open = () => {
      if (stopped) return;
      openedAt = lastSeq;
      es = new EventSource(streamUrl(lastSeq));
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
        if (stopped) return;
        if (es?.readyState === EventSource.CONNECTING && openedAt && openedAt !== lastSeq) {
          // The browser would reconnect to the same ?since= URL and replay from there: open a
          // fresh stream that resumes from the last event seen instead.
          es.close();
          clearTimeout(retry);
          retry = setTimeout(open, 3000);
        } else if (es?.readyState === EventSource.CLOSED) {
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

    const stop = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(retry);
      clearTimeout(flush);
      es?.close();
      useLive.getState().set({ connected: false });
    };

    open();
    document.addEventListener("visibilitychange", onVisible);
    stopStream = stop;
    return () => {
      stop();
      if (stopStream === stop) stopStream = null;
    };
  }, [qc, navigate]);
}
