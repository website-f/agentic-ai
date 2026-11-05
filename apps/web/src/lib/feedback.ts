/** P73 feedback (api/routers/feedback.py): the floating button on every page and the
 * developer's Feedbacks page. English keys (msg) are rendered with t(). */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";
import { api } from "@/lib/api";

export type FeedbackKind = "screenshot" | "general";
export type FeedbackCategory = "bug" | "confusing" | "not_needed" | "idea" | "praise" | "other";
export type FeedbackStatus = "new" | "planned" | "in_progress" | "done" | "wont_do";

export interface HouseRule {
  id: string;
  title: string;
  body: string;
  /** The page it is about ("/tasks"), or "" for every page. */
  page: string;
}

export interface FeedbackConfig {
  enabled: boolean;
  developer: boolean;
  rules: HouseRule[];
}

export interface MyFeedback {
  id: string;
  kind: FeedbackKind;
  category: FeedbackCategory;
  note: string;
  page_path: string;
  page_title: string;
  status: FeedbackStatus;
  dev_note: string;
  has_screenshot: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeedbackItem extends MyFeedback {
  user_id: string | null;
  author_name: string;
  author_email: string | null;
  author_role: string;
  marks: number;
  context: Record<string, string>;
  screenshot_bytes: number;
  handled_by: string | null;
  resolved_at: string | null;
}

export interface FeedbackList {
  items: FeedbackItem[];
  counts: Partial<Record<FeedbackStatus, number>>;
  total: number;
}

export interface FeedbackIn {
  kind: FeedbackKind;
  category: FeedbackCategory;
  note: string;
  page_path: string;
  page_title: string;
  marks: number;
  screenshot?: string | null;
  context: { viewport: string; language: string; theme: string; browser: string; company?: string };
}

export const feedbackKeys = {
  all: ["feedback"] as const,
  config: ["feedback", "config"] as const,
  mine: ["feedback", "mine"] as const,
  list: (f: { status?: string; category?: string; q?: string }) => ["feedback", "list", f] as const,
};

export const feedbackConfigQuery = queryOptions({
  queryKey: feedbackKeys.config,
  queryFn: () => api<FeedbackConfig>("/api/feedback/config"),
  staleTime: 60_000,
  retry: false,
});

export const myFeedbackQuery = queryOptions({
  queryKey: feedbackKeys.mine,
  queryFn: () => api<MyFeedback[]>("/api/feedback/mine"),
  staleTime: 15_000,
});

export function feedbackListQuery(f: { status?: string; category?: string; q?: string }) {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  if (f.q) p.set("q", f.q);
  const qs = p.toString();
  return queryOptions({
    queryKey: feedbackKeys.list(f),
    queryFn: () => api<FeedbackList>(`/api/feedback${qs ? `?${qs}` : ""}`),
    refetchInterval: 60_000,
  });
}

export const sendFeedback = (body: FeedbackIn) => api<{ id: string; status: FeedbackStatus }>("/api/feedback", "POST", body);
export const updateFeedback = (id: string, body: { status?: FeedbackStatus; dev_note?: string }) =>
  api<MyFeedback>(`/api/feedback/${encodeURIComponent(id)}`, "PATCH", body);
export const deleteFeedback = (id: string) => api<void>(`/api/feedback/${encodeURIComponent(id)}`, "DELETE");
export type RuleDraft = Omit<HouseRule, "id"> & { id?: string };
export const saveFeedbackConfig = (body: { enabled?: boolean; rules?: RuleDraft[] }) =>
  api<FeedbackConfig>("/api/feedback/config", "PUT", body);
export const screenshotUrl = (id: string) => `/api/feedback/${encodeURIComponent(id)}/screenshot`;

export const CATEGORIES: { value: FeedbackCategory; label: string; hint: string; tone: "danger" | "warn" | "neutral" | "info" | "ok" | "accent" }[] = [
  { value: "bug", label: msg("Not working"), hint: msg("Something is broken or does nothing."), tone: "danger" },
  { value: "confusing", label: msg("Hard to use"), hint: msg("Confusing, hard to find or hard to navigate."), tone: "warn" },
  { value: "not_needed", label: msg("Not needed"), hint: msg("A button, field or step nobody needs."), tone: "neutral" },
  { value: "idea", label: msg("Idea"), hint: msg("Something that would make your work easier."), tone: "info" },
  { value: "praise", label: msg("Works well"), hint: msg("Something you like: keep it."), tone: "ok" },
  { value: "other", label: msg("Other"), hint: msg("Anything else."), tone: "accent" },
];

export const STATUSES: { value: FeedbackStatus; label: string; tone: "info" | "warn" | "accent" | "ok" | "neutral" }[] = [
  { value: "new", label: msg("New"), tone: "info" },
  { value: "planned", label: msg("Planned"), tone: "accent" },
  { value: "in_progress", label: msg("In progress"), tone: "warn" },
  { value: "done", label: msg("Done"), tone: "ok" },
  { value: "wont_do", label: msg("Won't do"), tone: "neutral" },
];

export const categoryOf = (v: string) => CATEGORIES.find((c) => c.value === v) ?? CATEGORIES[CATEGORIES.length - 1]!;
export const statusOf = (v: string) => STATUSES.find((s) => s.value === v) ?? STATUSES[0]!;
