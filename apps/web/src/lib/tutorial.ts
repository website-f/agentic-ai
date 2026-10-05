/** Tutorial progress (P19) and the person's small saved settings (users.prefs). */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export type Track = "owner" | "management" | "staff" | "approver";

/** Yes/no facts read from real data by GET /api/tutorial/progress. */
export type Signal =
  | "provider" | "model_group" | "company" | "people" | "blueprint" | "workflow" | "autopilot" | "sop"
  | "agent" | "budget" | "task_created" | "task_done" | "reviewed" | "approved" | "workflow_run"
  | "schedule" | "library" | "chat" | "twin" | "work_hours" | "assistant" | "gmail" | "whatsapp" | "push";

export interface TutorialProgress {
  role: string;
  track: Track;
  signals: Partial<Record<Signal, boolean>>;
  done: string[];
  dismissed: boolean;
}

/** The whitelisted prefs keys; each holds a small object. Others may add keys server-side. */
export interface Prefs {
  tutorial: { done?: string[]; dismissed?: boolean; track?: Track };
  onboarding: Record<string, unknown>;
  /** P22: the app language this person chose. */
  locale?: { language?: "en" | "ms" | null };
}

export const tutorialKeys = {
  progress: ["tutorial", "progress"] as const,
  prefs: ["me", "prefs"] as const,
};

export const tutorialProgressQuery = queryOptions({
  queryKey: tutorialKeys.progress,
  queryFn: () => api<TutorialProgress>("/api/tutorial/progress"),
  staleTime: 30_000,
});

export const prefsQuery = queryOptions({
  queryKey: tutorialKeys.prefs,
  queryFn: () => api<Prefs>("/api/me/prefs"),
  staleTime: 60_000,
});

/** Merge a few settings into users.prefs: sub-keys you send replace, null removes one. */
export function savePrefs(patch: { [K in keyof Prefs]?: { [S in keyof Prefs[K]]?: Prefs[K][S] | null } }) {
  return api<Prefs>("/api/me/prefs", "PUT", patch);
}

/** Save prefs and keep the cached prefs and tutorial progress in step. */
export function useSavePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savePrefs,
    onMutate: async (patch) => {
      // Optimistic: lessons tick and the banner hides the moment you click.
      await qc.cancelQueries({ queryKey: tutorialKeys.progress });
      const before = qc.getQueryData<TutorialProgress>(tutorialKeys.progress);
      const t = patch.tutorial;
      if (before && t) {
        qc.setQueryData<TutorialProgress>(tutorialKeys.progress, {
          ...before,
          done: t.done === undefined ? before.done : (t.done ?? []),
          dismissed: t.dismissed === undefined ? before.dismissed : !!t.dismissed,
        });
      }
      return { before };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.before) qc.setQueryData(tutorialKeys.progress, ctx.before);
    },
    onSuccess: (prefs) => {
      qc.setQueryData(tutorialKeys.prefs, prefs);
      qc.setQueryData<TutorialProgress>(tutorialKeys.progress, (p) =>
        p ? { ...p, done: prefs.tutorial.done ?? [], dismissed: !!prefs.tutorial.dismissed } : p,
      );
    },
  });
}
