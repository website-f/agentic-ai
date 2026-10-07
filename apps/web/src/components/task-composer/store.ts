/** One task composer for the whole app: any page opens it with what it already knows (the
 * agent, a brief, the kind of work, a link, files) and the composer does the rest. Mounted once
 * by the app shell (and the full-screen chat, which has no shell). */
import { create } from "zustand";

import type { Task } from "@/lib/work";
import type { Graph, Run } from "@/lib/workflows";

/** How the work is done: a plain task, web research, a website the agent uses, a workflow. */
export type ComposerKind = "general" | "research" | "browse" | "workflow";

export interface ComposerFile {
  id: string;
  name: string;
}

/** What the composer made, for a page that wants to show it in place (the chat does). */
export type ComposerResult =
  | { kind: "task"; task: Task }
  | { kind: "run"; run: Run }
  | { kind: "schedule"; id: string; name: string };

export interface ComposerPrefill {
  agentId?: string;
  title?: string;
  brief?: string;
  kind?: ComposerKind;
  /** Browse a website: the link to open. */
  url?: string;
  files?: ComposerFile[];
  objectiveId?: string;
  workflowId?: string;
  /** Open on Repeat (set it up as a schedule). */
  repeat?: boolean;
  /** Open the file picker straight away ("Summarise a file"). */
  pickFile?: boolean;
  /** Repeating an existing task: unchanged, the schedule is made from the task itself. */
  fromTask?: { id: string; title: string; brief: string; agentId: string | null; requiresReview: boolean };
  /** Instead of opening what was made: the opener shows it (and the composer only closes). */
  onCreated?: (r: ComposerResult) => void;
}

interface ComposerState {
  open: boolean;
  /** Bumped on every open so the form starts fresh. */
  seq: number;
  prefill: ComposerPrefill;
  openComposer: (prefill?: ComposerPrefill) => void;
  close: () => void;
}

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  seq: 0,
  prefill: {},
  openComposer: (prefill = {}) => set((s) => ({ open: true, seq: s.seq + 1, prefill })),
  close: () => set({ open: false }),
}));

/** Open the task composer from anywhere (outside React too). */
export const openTaskComposer = (prefill?: ComposerPrefill) => useComposerStore.getState().openComposer(prefill);

/** `const composer = useTaskComposer(); composer.open({ agentId })`. */
export function useTaskComposer() {
  const open = useComposerStore((s) => s.openComposer);
  return { open };
}

// ---------------------------------------------------------------- remembered on this device

const LAST_AGENT = "agentic.composer.agent";

export function lastAgent(): string | null {
  try {
    return localStorage.getItem(LAST_AGENT);
  } catch {
    return null;
  }
}

export function rememberAgent(id: string) {
  try {
    localStorage.setItem(LAST_AGENT, id);
  } catch {
    /* storage blocked: not remembered */
  }
}

// ---------------------------------------------------------------- workflow hand-off

/** A drafted workflow on its way to the workflow editor ("Turn into a workflow"). Held in
 * memory, never in the URL; the workflows page picks it up once. */
export interface WorkflowDraftHandoff {
  name: string;
  description: string;
  graph: Graph;
}

let pendingDraft: { draft: WorkflowDraftHandoff; at: number } | null = null;

export function handOffWorkflowDraft(draft: WorkflowDraftHandoff) {
  pendingDraft = { draft, at: Date.now() };
}

/** The waiting draft, if it is fresh. clearWorkflowDraft() once it is shown. */
export function peekWorkflowDraft(): WorkflowDraftHandoff | null {
  return pendingDraft && Date.now() - pendingDraft.at < 60_000 ? pendingDraft.draft : null;
}

export function clearWorkflowDraft() {
  pendingDraft = null;
}
