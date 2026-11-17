/**
 * P109: tasks for people, Trello-like. Several assignees and watchers, a checklist, sub-tasks,
 * files (uploads, the office's Files and Library, screenshots), a start date and a kind of
 * work. The rules are the server's (apps/api agentic/teams/task_parts.py, routers/people_tasks.py).
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";
import type { DocFile } from "./documents";
import { workKeys, type ChecklistItem, type Task } from "./work";

/** What kind of work it is (server: task_parts.CATEGORIES; any other text is kept as typed). */
export const CATEGORIES: { value: string; label: string }[] = [
  { value: "general", label: msg("General") },
  { value: "follow_up", label: msg("Follow-up") },
  { value: "meeting", label: msg("Meeting") },
  { value: "document", label: msg("Document") },
  { value: "request", label: msg("Request") },
  { value: "review", label: msg("Review|noun") },
  { value: "admin", label: msg("Admin work") },
  { value: "finance", label: msg("Finance") },
  { value: "it", label: msg("IT") },
  { value: "site", label: msg("Site work") },
];

export const categoryLabel = (value: string | null | undefined): string | null =>
  value ? (CATEGORIES.find((c) => c.value === value)?.label ?? value.replace(/_/g, " ")) : null;

/** Someone I may add as a watcher (GET /api/team/watchable). */
export interface Watchable {
  user_id: string;
  name: string;
  branch_name: string | null;
  department_name: string | null;
  me: boolean;
  manages_me: boolean;
}

export const watchableQuery = queryOptions({
  queryKey: [...workKeys.tasks, "watchable"],
  queryFn: () => api<Watchable[]>("/api/team/watchable"),
  staleTime: 60_000,
});

export const attachmentsQuery = (taskId: string) =>
  queryOptions({
    queryKey: [...workKeys.task(taskId), "attachments"],
    queryFn: () => api<DocFile[]>(`/api/tasks/${taskId}/attachments`),
    refetchInterval: (q) => (q.state.data?.some((f) => f.status === "reading") ? 3000 : false),
  });

export const setPeople = (taskId: string, body: { assignee_user_ids?: string[]; watcher_user_ids?: string[] }) =>
  api<Task>(`/api/tasks/${taskId}/people`, "PUT", body);
export const addChecklistItem = (taskId: string, text: string) =>
  api<ChecklistItem[]>(`/api/tasks/${taskId}/checklist`, "POST", { text });
export const changeChecklistItem = (taskId: string, id: string, body: { text?: string; done?: boolean; position?: number }) =>
  api<ChecklistItem[]>(`/api/tasks/${taskId}/checklist/${id}`, "PATCH", body);
export const removeChecklistItem = (taskId: string, id: string) =>
  api<ChecklistItem[]>(`/api/tasks/${taskId}/checklist/${id}`, "DELETE");
export const addSubtask = (taskId: string, body: { title: string; assignee_user_id?: string | null; due_at?: string | null }) =>
  api<Task>(`/api/tasks/${taskId}/subtasks`, "POST", body);
export const attachFiles = (taskId: string, fileIds: string[]) =>
  api<DocFile[]>(`/api/tasks/${taskId}/files`, "POST", { file_ids: fileIds });
export const removeAttachment = (taskId: string, fileId: string) =>
  api<void>(`/api/tasks/${taskId}/attachments/${fileId}`, "DELETE");

/** A task for people (not for an agent). */
export const isPeopleTask = (t: Pick<Task, "assignee_user_id" | "assignee_agent_id">) => !!t.assignee_user_id && !t.assignee_agent_id;

/** "YYYY-MM-DD" in local time. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A local day at a given hour, as an ISO instant (start 09:00, due 17:00 by default). */
export const dayAt = (day: string, hour: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, hour, 0, 0).toISOString();
};

/** The span a task covers on a calendar or timeline: start (or due) to due (or start). */
export function spanOf(t: Pick<Task, "start_at" | "due_at">): { start: Date; end: Date } | null {
  const s = t.start_at ?? t.due_at;
  const e = t.due_at ?? t.start_at;
  if (!s || !e) return null;
  const start = new Date(s);
  const end = new Date(e);
  return end < start ? { start: end, end: start } : { start, end };
}

/** A screenshot from the clipboard (a pasted image) as a named file, or null. */
export function pastedImages(e: { clipboardData: DataTransfer | null }): File[] {
  const items = Array.from(e.clipboardData?.items ?? []);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return items
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i, n) => {
      const f = i.getAsFile();
      if (!f) return null;
      const ext = f.type.split("/")[1] || "png";
      return new File([f], `screenshot-${stamp}${n ? `-${n + 1}` : ""}.${ext}`, { type: f.type });
    })
    .filter((f): f is File => !!f);
}

/** Capture one frame of a screen, window or tab the person picks (the browser asks). */
export async function captureScreen(): Promise<File | null> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c?: MediaStreamConstraints) => Promise<MediaStream> };
  if (!md?.getDisplayMedia) return null;
  const stream = await md.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 150));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return null;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new File([blob], `screenshot-${stamp}.png`, { type: "image/png" });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export const canCaptureScreen = () =>
  typeof navigator !== "undefined" && !!(navigator.mediaDevices as { getDisplayMedia?: unknown } | undefined)?.getDisplayMedia;
