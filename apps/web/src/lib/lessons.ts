/** P92: lessons people taught the agents (when they corrected them), and the daily digest
 * of what the office learned. Owners and admins edit and forget; whoever taught a lesson can
 * undo it; staff see the lessons of their own AI. */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";

export type LessonVia = "send_back" | "ask_human" | "denial" | "chat" | "remember" | "edit";

export interface Lesson {
  id: string;
  text: string;
  topic: string;
  topic_label: string;
  when: string | null;
  do: string | null;
  dont: string | null;
  field: string | null;
  example: string | null;
  agent_id: string | null;
  agent_name: string | null;
  private: boolean;
  via: LessonVia | null;
  taught_by: string;
  taught_by_name: string;
  taught_at: string;
  /** How many times people taught this point (2+ is a mistake that repeats). */
  taught: number;
  uses: number;
  last_used_at: string | null;
  task_id: string | null;
  folded_into: string | null;
  state: "active" | "ended";
  end_reason: string | null;
  ended_at: string | null;
  superseded_by: string | null;
  can_edit: boolean;
  can_undo: boolean;
}

export interface LessonList {
  items: Lesson[];
  topics: { key: string; label: string; count: number }[];
  agents: { id: string; name: string; count: number }[];
  can_edit: boolean;
}

export interface LessonDigest {
  day: string;
  previous: string;
  next: string | null;
  lessons: Lesson[];
  repeated: Lesson[];
  skills: { skill_id: string; name: string; version: number; note: string | null; auto: boolean; at: string }[];
  folds: { id: string; name: string; status: string; note: string | null }[];
  totals: { lessons: number; replaced: number; repeated: number; skills: number };
}

/** What the "Noted for next time" note carries (task event data, chat answer meta). */
export interface NotedLesson {
  lesson_id: string;
  text: string;
  action?: "added" | "replaced" | "confirmed";
  topic?: string | null;
  replaced?: string | null;
}

export interface LessonFilters {
  topic?: string;
  agent?: string;
  state?: "active" | "ended" | "all";
}

export const lessonKeys = {
  all: ["lessons"] as const,
  list: (f: LessonFilters) => ["lessons", "list", f.topic ?? "", f.agent ?? "", f.state ?? "active"] as const,
  digest: (day?: string) => ["lessons", "digest", day ?? "today"] as const,
};

export const lessonsQuery = (f: LessonFilters = {}) =>
  queryOptions({
    queryKey: lessonKeys.list(f),
    queryFn: () => {
      const q = new URLSearchParams();
      if (f.topic) q.set("topic", f.topic);
      if (f.agent) q.set("agent_id", f.agent);
      if (f.state && f.state !== "active") q.set("state", f.state);
      const s = q.toString();
      return api<LessonList>(`/api/lessons${s ? `?${s}` : ""}`);
    },
    staleTime: 15_000,
  });

export const digestQuery = (day?: string) =>
  queryOptions({
    queryKey: lessonKeys.digest(day),
    queryFn: () => api<LessonDigest>(`/api/learning/digest${day ? `?day=${encodeURIComponent(day)}` : ""}`),
    staleTime: 15_000,
  });

export type LessonEdit = Partial<Pick<Lesson, "text" | "when" | "do" | "dont" | "field" | "example">>;

export const editLesson = (id: string, body: LessonEdit) => api<Lesson>(`/api/lessons/${id}`, "PATCH", body);
export const forgetLesson = (id: string) => api<Lesson>(`/api/lessons/${id}/forget`, "POST");
export const undoLesson = (id: string) =>
  api<{ lesson: Lesson; restored: Lesson | null }>(`/api/lessons/${id}/undo`, "POST");

/** How the person taught it, in plain words. */
export const VIA_LABEL: Record<LessonVia, string> = {
  send_back: msg("sent the work back"),
  ask_human: msg("answered its question"),
  denial: msg("turned a request down"),
  chat: msg("corrected it in chat"),
  remember: msg("asked it to remember"),
  edit: msg("edited the lesson"),
};
