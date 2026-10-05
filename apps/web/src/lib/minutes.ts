/** Meeting minutes from a recording (Meetings > People meetings): types, queries, upload. */
import { queryOptions } from "@tanstack/react-query";

import { api, ApiError, readCookie } from "./api";

export type RecordingStatus = "uploading" | "queued" | "extracting" | "transcribing" | "writing" | "ready" | "failed";
export type MinutesLanguage = "en" | "ms";

export const ACTIVE: RecordingStatus[] = ["uploading", "queued", "extracting", "transcribing", "writing"];
export const isActive = (s: RecordingStatus) => ACTIVE.includes(s);

export interface Recording {
  id: string;
  title: string;
  status: RecordingStatus;
  stage_detail: string;
  language: MinutesLanguage;
  original_name: string;
  size: number;
  duration_seconds: number | null;
  chunks_total: number;
  chunks_done: number;
  branch_id: string | null;
  department_id: string | null;
  scope_label: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  summary: string;
  action_count: number;
  open_actions: number;
  decision_count: number;
  document_id: string | null;
  library_file_id: string | null;
  published_at: string | null;
  audio_available: boolean;
  audio_expires_at: string | null;
  cost_usd: number;
  can_edit: boolean;
}

export interface TranscriptParagraph {
  t: number;
  e: number;
  text: string;
}

export interface MinutesTopic {
  title: string;
  start: string;
  summary: string;
}

export interface Minutes {
  title: string;
  date: string;
  attendees: string[];
  agenda: string[];
  summary: string;
  topics: MinutesTopic[];
  decisions: string[];
  open_questions: string[];
  next_meeting: string;
}

export interface ActionItem {
  index: number;
  what: string;
  owner: string;
  due: string;
  due_date: string;
  owner_agent_id: string | null;
  owner_label: string;
  task_id: string | null;
}

export interface RecordingDetail extends Recording {
  heard_language: string | null;
  transcript: TranscriptParagraph[];
  minutes: Minutes | null;
  action_items: ActionItem[];
  markdown: string;
  document_status: "draft" | "review" | "approved" | null;
  document_version: number | null;
  published_stale: boolean;
}

export interface MinutesSettings {
  audio_days: number;
  max_upload_mb: number;
  max_hours: number;
}

export const minutesKeys = {
  all: ["minutes"] as const,
  list: ["minutes", "list"] as const,
  one: (id: string) => ["minutes", "one", id] as const,
  settings: ["minutes", "settings"] as const,
};

export const minutesListQuery = queryOptions({
  queryKey: minutesKeys.list,
  queryFn: () => api<Recording[]>("/api/minutes"),
  refetchInterval: (q) => (q.state.data?.some((r) => isActive(r.status)) ? 4000 : false),
});

export const minutesQuery = (id: string) =>
  queryOptions({
    queryKey: minutesKeys.one(id),
    queryFn: () => api<RecordingDetail>(`/api/minutes/${id}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? 3000 : false),
  });

export const minutesSettingsQuery = queryOptions({
  queryKey: minutesKeys.settings,
  queryFn: () => api<MinutesSettings>("/api/minutes/settings"),
  staleTime: 5 * 60_000,
});

export const audioUrl = (id: string) => `/api/minutes/${id}/audio`;
export const minutesExportUrl = (id: string, format: "pdf" | "docx") => `/api/minutes/${id}/export?format=${format}`;

export const ACCEPT = "audio/*,video/*,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.mp4,.mov,.m4v,.aac,.flac,.mkv,.3gp,.amr,.wma";
const EXT = /\.(mp3|m4a|wav|ogg|oga|opus|webm|mp4|mov|m4v|aac|flac|mkv|3gp|amr|wma|mpeg|mpga)$/i;

export function isRecording(file: File): boolean {
  return EXT.test(file.name) || file.type.startsWith("audio/") || file.type.startsWith("video/");
}

export interface UploadParams {
  title?: string;
  language: MinutesLanguage;
  branch_id?: string | null;
  department_id?: string | null;
}

/** Streams the file as the raw body (no multipart), reporting progress 0..1. XHR, because fetch
 * cannot report upload progress. Resolves with the new recording. */
export function uploadRecording(
  file: File,
  params: UploadParams,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Recording> {
  const q = new URLSearchParams({ name: file.name, language: params.language });
  if (params.title?.trim()) q.set("title", params.title.trim());
  if (params.branch_id) q.set("branch_id", params.branch_id);
  if (params.department_id) q.set("department_id", params.department_id);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/minutes/upload?${q}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-csrf-token", readCookie("agentic_csrf"));
    xhr.setRequestHeader("x-file-type", file.type || "");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: (Recording & { code?: string; message?: string }) | null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else if (xhr.status === 413 && !data?.message) reject(new ApiError(413, "file_too_large", "That recording is larger than the server accepts."));
      else reject(new ApiError(xhr.status, data?.code ?? "http_error", data?.message ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload was cut off. Check the connection and try again."));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function duration(seconds: number | null): string {
  if (!seconds) return "";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
}

/** "m:ss" or "h:mm:ss" (as the minutes write topic starts) to seconds. */
export function parseClock(text: string): number | null {
  const parts = text.replace(/[[\]]/g, "").split(":").map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export type Stage = "upload" | "extract" | "transcribe" | "write" | "ready";

/** Where in the pipeline a recording is, for the timeline. */
export function stageOf(r: Pick<Recording, "status">): Stage {
  switch (r.status) {
    case "uploading":
      return "upload";
    case "queued":
    case "extracting":
      return "extract";
    case "transcribing":
      return "transcribe";
    case "writing":
      return "write";
    default:
      return "ready";
  }
}
